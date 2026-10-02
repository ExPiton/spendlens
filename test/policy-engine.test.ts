import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PolicyEngine, InMemoryPolicyStateStore } from "../src/sdk/policy-engine";
import type { PolicyConfig } from "../src/lib/contracts";

const mockPolicy: PolicyConfig = {
  version: 1,
  agent: "research-crawler-01",
  budgets: [
    { scope: "task", limitUsdc: 5.0 },
    { scope: "hour", limitUsdc: 2.0 },
    { scope: "day", limitUsdc: 20.0 },
  ],
  perCall: {
    maxUsdc: 0.05,
    maxCallsPerMinute: 600,
  },
  counterparties: {
    mode: "allowlist",
    allow: ["api.example.io", "0x1a2b3c4d5e6f7890abcdef1234567890abcdef12"],
    deny: ["malicious-api.io", "0xdeadbeef00000000000000000000000000000000"],
    firstSeen: {
      action: "hold",
      autoAllowBelowUsdc: 0.001,
    },
  },
  anomaly: {
    burnRate: {
      baseline: "ewma",
      halflifeMinutes: 15,
      zThreshold: 3.0,
      action: "hold",
    },
    newCounterpartyRate: {
      maxPerHour: 5,
      action: "alert",
    },
  },
  quality: {
    failureStatusCodes: [402, 429, 500, 502, 503, 504],
    emptyBodyIsFailure: true,
    jsonSchema: null,
    maxLatencyMs: 4000,
  },
  escalation: {
    webhook: "https://ops.example.io/hooks/spendlens",
    timeoutSeconds: 30,
    onTimeout: "block",
  },
};

/** `mode: denylist` is the only mode where first_seen's micro-payment
 *  exemption (auto_allow_below_usdc) applies — an allowlist is strict. */
const denylistPolicy: PolicyConfig = {
  ...mockPolicy,
  counterparties: {
    mode: "denylist",
    allow: ["api.example.io"],
    deny: ["malicious-api.io"],
    firstSeen: { action: "hold", autoAllowBelowUsdc: 0.001 },
  },
};

describe("PolicyEngine Evaluation Order", () => {
  test("Deny list check immediately blocks known malicious counterparties", async () => {
    const engine = new PolicyEngine(mockPolicy, new InMemoryPolicyStateStore());
    const verdict = await engine.evaluate({
      agentId: "research-crawler-01",
      counterparty: "malicious-api.io",
      amount: 0.001,
      resource: "https://malicious-api.io/v1/data",
    });

    assert.equal(verdict.decision, "block");
    assert.equal(verdict.ruleHit, "counterparties.deny");
  });

  test("Per-call limit blocks requests exceeding max_usdc", async () => {
    const engine = new PolicyEngine(mockPolicy, new InMemoryPolicyStateStore());
    const verdict = await engine.evaluate({
      agentId: "research-crawler-01",
      counterparty: "api.example.io",
      amount: 0.1, // > 0.05 limit
      resource: "https://api.example.io/v1/data",
    });

    assert.equal(verdict.decision, "block");
    assert.equal(verdict.ruleHit, "per_call.max_usdc");
  });

  test("Task budget blocks requests when accumulated task spend exceeds limit", async () => {
    const store = new InMemoryPolicyStateStore();
    const taskPolicy: PolicyConfig = {
      ...mockPolicy,
      budgets: [
        { scope: "task", limitUsdc: 0.10 },
        { scope: "hour", limitUsdc: 100.0 },
        { scope: "day", limitUsdc: 100.0 },
      ],
    };
    const engine = new PolicyEngine(taskPolicy, store);
    const taskId = "task-alpha";

    // 2 calls * 0.04 USDC = 0.08 USDC (< 0.10)
    for (let i = 0; i < 2; i++) {
      const v = await engine.evaluate({
        agentId: "research-crawler-01",
        taskId,
        counterparty: "api.example.io",
        amount: 0.04,
        resource: "https://api.example.io/v1/data",
      });
      assert.equal(v.decision, "allow");
    }

    // Next call for 0.03 USDC would push total to 0.11 USDC > 0.10 USDC limit
    const blockingVerdict = await engine.evaluate({
      agentId: "research-crawler-01",
      taskId,
      counterparty: "api.example.io",
      amount: 0.03,
      resource: "https://api.example.io/v1/data",
    });

    assert.equal(blockingVerdict.decision, "block");
    assert.equal(blockingVerdict.ruleHit, "budgets.task");
  });

  test("First-seen micro amounts are auto-allowed below threshold (denylist mode)", async () => {
    const store = new InMemoryPolicyStateStore();
    const engine = new PolicyEngine(denylistPolicy, store);

    // First seen with 0.0005 <= 0.001 auto_allow_below_usdc
    const v1 = await engine.evaluate({
      agentId: "research-crawler-01",
      counterparty: "feed.newsource.io",
      amount: 0.0005,
      resource: "https://feed.newsource.io/v1/test",
    });

    assert.equal(v1.decision, "allow");
  });

  test("First-seen counterparty with higher amount triggers configured action (hold)", async () => {
    const store = new InMemoryPolicyStateStore();
    const engine = new PolicyEngine(mockPolicy, store);

    // First seen with 0.02 > 0.001 auto_allow_below_usdc
    const v = await engine.evaluate({
      agentId: "research-crawler-01",
      counterparty: "unknown-vendor.io",
      amount: 0.02,
      resource: "https://unknown-vendor.io/v1/item",
    });

    assert.equal(v.decision, "hold");
    assert.equal(v.ruleHit, "counterparties.first_seen.action");
  });

  test("Legitimate call to allowlisted counterparty within limits is allowed", async () => {
    const engine = new PolicyEngine(mockPolicy, new InMemoryPolicyStateStore());
    const verdict = await engine.evaluate({
      agentId: "research-crawler-01",
      counterparty: "api.example.io",
      amount: 0.003,
      resource: "https://api.example.io/v1/data",
    });

    assert.equal(verdict.decision, "allow");
    assert.equal(verdict.ruleHit, null);
  });

  test("REGRESSION: an auto-allowed first-seen counterparty stays allowed on repeat calls", async () => {
    // A counterparty that isn't allowlisted, first contacted at a
    // micro-amount (auto-allowed by first_seen), used to get permanently
    // blocked from its SECOND call onward — `isSeen` becoming true tripped
    // an unconditional block instead of being treated as "already vetted".
    const engine = new PolicyEngine(denylistPolicy, new InMemoryPolicyStateStore());
    const call = () =>
      engine.evaluate({
        agentId: "research-crawler-01",
        counterparty: "feed.newsource.io",
        amount: 0.0005, // <= auto_allow_below_usdc (0.001)
        resource: "https://feed.newsource.io/v1/test",
      });

    assert.equal((await call()).decision, "allow", "first call");
    assert.equal((await call()).decision, "allow", "second call must stay allowed");
    assert.equal((await call()).decision, "allow", "third call must stay allowed");
  });

  test("REGRESSION: new_counterparty_rate only counts genuinely new counterparties, not established/allowlisted traffic", async () => {
    const policy: PolicyConfig = {
      ...mockPolicy,
      counterparties: {
        ...denylistPolicy.counterparties,
        allow: ["e1.io", "e2.io", "e3.io", "e4.io", "e5.io", "e6.io"],
      },
      anomaly: {
        ...mockPolicy.anomaly,
        newCounterpartyRate: { maxPerHour: 5, action: "block" },
      },
    };
    const engine = new PolicyEngine(policy, new InMemoryPolicyStateStore());
    let t = 1_000_000;

    // 6 calls to 6 already-established, explicitly allowlisted
    // counterparties — none of these is a "surprise".
    for (const cp of ["e1.io", "e2.io", "e3.io", "e4.io", "e5.io", "e6.io"]) {
      const v = await engine.evaluate({
        agentId: "research-crawler-01",
        counterparty: cp,
        amount: 0.001,
        resource: "r",
        now: (t += 1000),
      });
      assert.equal(v.decision, "allow", `${cp} is allowlisted, must be allowed`);
    }

    // Exactly ONE genuinely new counterparty shows up — well under the
    // max_per_hour: 5 ceiling — and must NOT be blocked.
    const v = await engine.evaluate({
      agentId: "research-crawler-01",
      counterparty: "brand-new.io",
      amount: 0.0005,
      resource: "r",
      now: (t += 1000),
    });
    assert.equal(v.decision, "allow", "1 genuinely-new counterparty must not trip a max_per_hour: 5 ceiling");
  });

  test("REGRESSION: first_seen also gates a genuinely new counterparty in denylist mode", async () => {
    // In denylist mode, first_seen used to be skipped entirely — any
    // address not on the deny list was let straight through regardless of
    // whether it had ever been seen before, defeating the product's own
    // headline scenario (a prompt-injection redirect to an attacker
    // address).
    const denylistPolicy: PolicyConfig = {
      ...mockPolicy,
      counterparties: {
        mode: "denylist",
        allow: [],
        deny: ["malicious-api.io"],
        firstSeen: { action: "block", autoAllowBelowUsdc: 0.001 },
      },
    };
    const engine = new PolicyEngine(denylistPolicy, new InMemoryPolicyStateStore());
    const verdict = await engine.evaluate({
      agentId: "research-crawler-01",
      counterparty: "attacker-controlled.io",
      amount: 0.02, // above auto_allow_below_usdc
      resource: "https://attacker-controlled.io/v1/data",
    });

    assert.equal(verdict.decision, "block");
    assert.equal(verdict.ruleHit, "counterparties.first_seen.action");
  });

  test("REGRESSION: an 'alert' action signals on the ledger instead of vanishing silently", async () => {
    const alertPolicy: PolicyConfig = {
      ...mockPolicy,
      counterparties: {
        ...denylistPolicy.counterparties,
        firstSeen: { action: "alert", autoAllowBelowUsdc: 0 },
      },
    };
    const engine = new PolicyEngine(alertPolicy, new InMemoryPolicyStateStore());
    const verdict = await engine.evaluate({
      agentId: "research-crawler-01",
      counterparty: "unverified-but-fine.io",
      amount: 0.02,
      resource: "r",
    });

    // The call still goes through (alert never blocks/holds) — but the
    // rule that fired must be visible on the resulting record, not
    // discarded.
    assert.equal(verdict.decision, "allow");
    assert.equal(verdict.ruleHit, "counterparties.first_seen.action");
  });
});

describe("counterparty gate: allowlist is strict, micro-payments earn no trust", () => {
  const ATTACKER = "0xbadbadbadbadbadbadbadbadbadbadbadbadbad0";
  const GOOD = "0x1111111111111111111111111111111111111111";
  const withCounterparties = (c: Partial<PolicyConfig["counterparties"]>): PolicyConfig => ({
    ...mockPolicy,
    budgets: [{ scope: "day", limitUsdc: 100 }],
    perCall: { maxUsdc: 10, maxCallsPerMinute: 600 },
    counterparties: { mode: "allowlist", allow: [GOOD], deny: [], firstSeen: { action: "block", autoAllowBelowUsdc: 0.001 }, ...c },
  });
  const call = (e: PolicyEngine, counterparty: string, amount: number, now?: number) =>
    e.evaluate({ agentId: "a", counterparty, amount, resource: "r", now });

  test("allowlist mode blocks a counterparty that is not listed, for every non-hold first_seen action", async () => {
    for (const action of ["block", "alert", "allow"] as const) {
      const e = new PolicyEngine(withCounterparties({ firstSeen: { action, autoAllowBelowUsdc: 0.001 } }), new InMemoryPolicyStateStore());
      const v = await call(e, ATTACKER, 0.5);
      assert.equal(v.decision, "block", `first_seen.action=${action}`);
      assert.equal(v.ruleHit, "counterparties.allowlist");
    }
  });

  test("allowlist mode + first_seen hold sends an unlisted counterparty to a human", async () => {
    const e = new PolicyEngine(withCounterparties({ firstSeen: { action: "hold", autoAllowBelowUsdc: 0.001 } }), new InMemoryPolicyStateStore());
    const v = await call(e, ATTACKER, 0.5);
    assert.equal(v.decision, "hold");
    assert.equal(v.ruleHit, "counterparties.first_seen.action");
  });

  test("allowlist mode ignores auto_allow_below_usdc: a micro-payment to an unlisted address is still gated", async () => {
    const e = new PolicyEngine(withCounterparties({}), new InMemoryPolicyStateStore());
    assert.equal((await call(e, ATTACKER, 0.0009)).decision, "block");
  });

  test("an allowlisted counterparty is allowed, and the deny list still wins over the allow list", async () => {
    const e = new PolicyEngine(withCounterparties({ deny: [GOOD] }), new InMemoryPolicyStateStore());
    assert.equal((await call(e, GOOD, 0.5)).ruleHit, "counterparties.deny");
    const f = new PolicyEngine(withCounterparties({}), new InMemoryPolicyStateStore());
    assert.equal((await call(f, GOOD, 0.5)).decision, "allow");
  });

  test("a human-approved hold vets the counterparty: the next call is not held again", async () => {
    const e = new PolicyEngine(withCounterparties({ firstSeen: { action: "hold", autoAllowBelowUsdc: 0.001 } }), new InMemoryPolicyStateStore());
    const input = { agentId: "a", counterparty: ATTACKER, amount: 0.5, resource: "r" };
    assert.equal((await e.evaluate(input)).decision, "hold");
    e.recordHoldApproved(input); // the escalation was approved and the payment made
    assert.equal((await e.evaluate(input)).decision, "allow");
  });

  test("REGRESSION: a micro-payment must not whitelist the counterparty for a later, larger one", async () => {
    // denylist mode + first_seen block: $0.0009 passes the exemption, but the
    // address is still first-seen — the $0.90 that follows used to sail through
    // because the micro-payment had marked it "seen".
    const e = new PolicyEngine(
      withCounterparties({ mode: "denylist", allow: [], firstSeen: { action: "block", autoAllowBelowUsdc: 0.001 } }),
      new InMemoryPolicyStateStore(),
    );
    const small = await call(e, ATTACKER, 0.0009);
    assert.equal(small.decision, "allow");
    assert.equal(small.autoAllowed, true);
    const big = await call(e, ATTACKER, 0.9);
    assert.equal(big.decision, "block");
    assert.equal(big.ruleHit, "counterparties.first_seen.action");
  });

  test("a payment that cleared the gate (alert) does vet the counterparty", async () => {
    const e = new PolicyEngine(
      withCounterparties({ mode: "denylist", allow: [], firstSeen: { action: "alert", autoAllowBelowUsdc: 0.001 } }),
      new InMemoryPolicyStateStore(),
    );
    const first = await call(e, ATTACKER, 0.5);
    assert.equal(first.ruleHit, "counterparties.first_seen.action");
    assert.equal(first.autoAllowed, undefined);
    assert.equal((await call(e, ATTACKER, 0.5)).ruleHit, null, "already vetted — not alerted again");
  });
});

describe("invalid amounts from a 402 are refused, never booked as spend", () => {
  const policy: PolicyConfig = {
    ...mockPolicy,
    budgets: [{ scope: "day", limitUsdc: 1 }],
    perCall: { maxUsdc: 5, maxCallsPerMinute: 600 },
    counterparties: { mode: "denylist", allow: ["api.example.io"], deny: [], firstSeen: { action: "alert", autoAllowBelowUsdc: 1 } },
  };

  for (const bad of [-50, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    test(`amount ${bad} is blocked with challenge.invalid_amount`, async () => {
      const e = new PolicyEngine(policy, new InMemoryPolicyStateStore());
      const v = await e.evaluate({ agentId: "a", counterparty: "api.example.io", amount: bad, resource: "r" });
      assert.equal(v.decision, "block");
      assert.equal(v.ruleHit, "challenge.invalid_amount");
    });
  }

  test("REGRESSION: a negative amount no longer refills the day budget", async () => {
    const e = new PolicyEngine(policy, new InMemoryPolicyStateStore());
    const t = Date.now();
    const go = (amount: number, i: number) =>
      e.evaluate({ agentId: "a", counterparty: "api.example.io", amount, resource: "r", now: t + i });
    assert.equal((await go(0.9, 0)).decision, "allow");
    await go(-50, 1); // used to be booked as -50 USDC of spend
    assert.equal((await go(0.9, 2)).decision, "block", "the 1 USDC day budget is still spent");
  });
});
