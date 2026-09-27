import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyEngine, InMemoryPolicyStateStore } from "@/sdk/policy-engine";
import {
  ControlPlane,
  loadPolicyInput,
  requestEscalation,
  guard,
  fetchWalletSettlements,
  createSqliteLedger,
  PolicyBlocked,
  SpendlensError,
} from "@/sdk";
import { policyHash } from "@/lib/policy-hash";
import { defaultPolicyYaml, parsePolicyYaml } from "@/lib/policy-file";
import type { AuthorizationRecord, PolicyConfig } from "@/lib/contracts";

/** The default template, tightened for tests: a daily budget we can hit. */
function policy(overrides: (p: PolicyConfig) => void = () => {}): PolicyConfig {
  const { config } = parsePolicyYaml(defaultPolicyYaml("t"));
  overrides(config);
  return config;
}

const call = (over: Partial<Parameters<PolicyEngine["evaluate"]>[0]> = {}) => ({
  agentId: "t",
  taskId: null,
  counterparty: "api.example.io",
  amount: 0.003,
  resource: "https://api.example.io/x",
  now: Date.now(),
  ...over,
});

describe("counterparty canonicalization", () => {
  const CHECKSUMMED = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";

  it("a denylisted address can't be sidestepped by re-casing it", async () => {
    const lowerDeny = new PolicyEngine(policy((p) => (p.counterparties.deny = [CHECKSUMMED.toLowerCase()])));
    assert.equal((await lowerDeny.evaluate(call({ counterparty: CHECKSUMMED }))).ruleHit, "counterparties.deny");

    const upperDeny = new PolicyEngine(policy((p) => (p.counterparties.deny = [CHECKSUMMED])));
    const v = await upperDeny.evaluate(call({ counterparty: CHECKSUMMED.toLowerCase() }));
    assert.equal(v.decision, "block");
    assert.equal(v.ruleHit, "counterparties.deny");
  });

  it("verdicts carry the canonical (lowercase) counterparty for the ledger", async () => {
    const e = new PolicyEngine(policy());
    assert.equal((await e.evaluate(call({ counterparty: " API.Example.IO " }))).counterparty, "api.example.io");
  });

  it("an allowlisted address in checksum case is still trusted when paid in lowercase", async () => {
    const e = new PolicyEngine(
      policy((p) => {
        p.counterparties.allow = [CHECKSUMMED];
        p.counterparties.firstSeen = { action: "block", autoAllowBelowUsdc: 0 };
      }),
    );
    assert.equal((await e.evaluate(call({ counterparty: CHECKSUMMED.toLowerCase() }))).decision, "allow");
  });
});

describe("budgets & holds", () => {
  it("monthly budget (current UTC month) blocks once exhausted", async () => {
    const e = new PolicyEngine(
      policy((p) => {
        p.budgets = [{ scope: "month", limitUsdc: 0.01 }];
        p.perCall.maxUsdc = 1;
      }),
    );
    const now = Date.UTC(2026, 8, 15);
    assert.equal((await e.evaluate(call({ amount: 0.006, now }))).decision, "allow");
    const second = await e.evaluate(call({ amount: 0.006, now: now + 1000 }));
    assert.equal(second.ruleHit, "budgets.month");
    // A new month starts a new budget.
    assert.equal((await e.evaluate(call({ amount: 0.006, now: Date.UTC(2026, 9, 1) }))).decision, "allow");
  });

  it("an approved hold's spend counts toward the budgets (no hold-by-hold bypass)", async () => {
    const e = new PolicyEngine(
      policy((p) => {
        p.budgets = [{ scope: "day", limitUsdc: 0.01 }];
        p.perCall.maxUsdc = 1;
        p.counterparties.firstSeen = { action: "hold", autoAllowBelowUsdc: 0 };
      }),
    );
    const input = call({ counterparty: "new.io", amount: 0.008 });
    assert.equal((await e.evaluate(input)).decision, "hold");
    e.recordHoldApproved(input);
    const next = await e.evaluate(call({ counterparty: "new.io", amount: 0.008 }));
    assert.equal(next.ruleHit, "budgets.day", "the approved 0.008 was booked");
  });
});

describe("kill switch & policy identity", () => {
  it("halt blocks everything with agent.halted; resume restores", async () => {
    const e = new PolicyEngine(policy());
    e.halt();
    const v = await e.evaluate(call());
    assert.equal(v.decision, "block");
    assert.equal(v.ruleHit, "agent.halted");
    e.resume();
    assert.equal((await e.evaluate(call())).decision, "allow");
  });

  it("every verdict names the policy by hash; setPolicy swaps it live", async () => {
    const p1 = policy();
    const e = new PolicyEngine(p1);
    assert.equal((await e.evaluate(call())).policyHash, policyHash(p1));
    const p2 = policy((p) => (p.perCall.maxUsdc = 0.001));
    e.setPolicy(p2, { version: 7 });
    const v = await e.evaluate(call());
    assert.equal(v.policyHash, policyHash(p2));
    assert.equal(v.policyVersion, 7);
    assert.equal(v.ruleHit, "per_call.max_usdc");
    assert.notEqual(policyHash(p1), policyHash(p2));
  });
});

describe("counterparty entropy signal", () => {
  it("fires when an agent's spread-out traffic collapses onto one counterparty", async () => {
    const e = new PolicyEngine(
      policy((p) => {
        p.budgets = [];
        p.perCall = { maxUsdc: 1, maxCallsPerMinute: 100_000 };
        p.counterparties.firstSeen = { action: "allow", autoAllowBelowUsdc: 1 };
        p.anomaly.burnRate.action = "alert";
        p.anomaly.newCounterpartyRate = { maxPerHour: 1000, action: "alert" };
        p.anomaly.counterpartyEntropy = { windowMinutes: 60, minCalls: 20, maxDrop: 0.5, action: "block" };
      }),
      new InMemoryPolicyStateStore(),
    );
    const providers = ["a.io", "b.io", "c.io", "d.io", "e.io"];
    let t = Date.UTC(2026, 8, 1);
    // 2h of normal, evenly spread traffic (past the cold-start window).
    for (let i = 0; i < 400; i++) {
      t += 18_000;
      const v = await e.evaluate(call({ counterparty: providers[i % 5], amount: 0.001, now: t }));
      assert.equal(v.decision, "allow", `normal call ${i}`);
    }
    // Then: everything goes to one address.
    let fired: string | null = null;
    for (let i = 0; i < 2000 && !fired; i++) {
      t += 1_000;
      const v = await e.evaluate(call({ counterparty: "0xattacker", amount: 0.001, now: t }));
      if (v.decision === "block") fired = v.ruleHit;
    }
    assert.equal(fired, "anomaly.counterparty_entropy");
  });
});

describe("policy sources", () => {
  it("guard({ policy: './policy.yaml' }) reads the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "spendlens-policy-"));
    try {
      const file = join(dir, "policy.yaml");
      writeFileSync(file, defaultPolicyYaml("from-file"));
      assert.equal(loadPolicyInput(file, "test")?.agent, "from-file");
      assert.throws(() => loadPolicyInput(join(dir, "missing.yaml"), "test"), /could not read/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ControlPlane (dashboard sync)", () => {
  function server(state: { status: string; version: number; config: PolicyConfig }) {
    return (async () =>
      new Response(
        JSON.stringify({
          agent: { id: "t", status: state.status },
          policy: { version: state.version, hash: policyHash(state.config), config: state.config },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
  }

  it("fail-closed until the dashboard policy arrives, then adopts it and follows the kill switch", async () => {
    const engine = new PolicyEngine(policy());
    const state = { status: "active", version: 3, config: policy((p) => (p.perCall.maxUsdc = 0.002)) };
    const cp = new ControlPlane({
      serverUrl: "https://spendlens.test",
      apiKey: "sl_x",
      engine,
      remotePolicy: true,
      failClosed: true,
      intervalMs: 0,
      fetchFn: server(state),
      label: "test",
    });
    assert.equal((await engine.evaluate(call())).ruleHit, "policy.unavailable");
    await cp.sync();
    assert.equal(engine.getPolicyVersion(), 3);
    assert.equal((await engine.evaluate(call())).ruleHit, "per_call.max_usdc", "remote policy applied");

    state.status = "paused";
    await cp.sync();
    assert.equal((await engine.evaluate(call({ amount: 0.001 }))).ruleHit, "agent.halted");
    state.status = "active";
    await cp.sync();
    assert.equal((await engine.evaluate(call({ amount: 0.001 }))).decision, "allow");
  });

  it("guard(): an ingest response saying `paused` halts payments before signing", async () => {
    let signed = 0;
    const fetchFn = (async (url: string) => {
      if (String(url).endsWith("/api/sdk/config")) {
        return new Response(JSON.stringify({ agent: { id: "t", status: "active" }, policy: null }));
      }
      if (String(url).endsWith("/api/authorizations")) {
        return new Response("{}", { headers: { "x-spendlens-agent-status": "paused" } });
      }
      return new Response("pay", {
        status: 402,
        headers: { "x-pay-to": "api.example.io", "x-pay-amount": "0.001" },
      });
    }) as unknown as typeof fetch;
    // Route the queue's own POSTs through the same fake.
    const orig = globalThis.fetch;
    globalThis.fetch = fetchFn;
    try {
      const g = guard({
        agentId: "t",
        policy: policy(),
        apiKey: "sl_x",
        sink: "https://spendlens.test/api/authorizations",
        signer: async () => {
          signed++;
          return { paymentHeader: "sig" };
        },
        fetchFn,
        syncIntervalMs: 0,
      });
      await g.fetch("https://api.example.io/x");
      await g.drain(); // flush → server answers "paused"
      await assert.rejects(g.fetch("https://api.example.io/x"), (e: unknown) =>
        e instanceof PolicyBlocked && e.ruleHit === "agent.halted",
      );
      assert.equal(signed, 1, "the halted call was never signed");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("human escalation", () => {
  it("pending → polls until the owner approves", async () => {
    let polls = 0;
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ status: "pending", id: "e1", pollUrl: "https://s.test/api/escalate/e1" }), { status: 202 });
      }
      polls++;
      return new Response(JSON.stringify({ status: polls >= 2 ? "approved" : "pending" }));
    }) as unknown as typeof fetch;
    const r = await requestEscalation(
      { webhook: "https://s.test/api/escalate", timeoutSeconds: 5, onTimeout: "block" },
      { agentId: "t", taskId: null, counterparty: "x", resource: "r", amountUsdc: 1, ruleHit: null },
      { fetchFn, pollIntervalMs: 10 },
    );
    assert.deepEqual(r, { approved: true, reason: "decided" });
  });

  it("nobody decides → on_timeout applies", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ status: "pending", id: "e2" }), { status: 202 })) as unknown as typeof fetch;
    const r = await requestEscalation(
      { webhook: "https://s.test/api/escalate", timeoutSeconds: 1, onTimeout: "block" },
      { agentId: "t", taskId: null, counterparty: "x", resource: "r", amountUsdc: 1, ruleHit: null },
      { fetchFn, pollIntervalMs: 50 },
    );
    assert.equal(r.approved, false);
    assert.equal(r.reason, "timeout");
  });
});

describe("keyless Gateway settlements", () => {
  it("follows Link pagination, skips failed transfers, lowercases counterparties", async () => {
    const pages: Record<string, { body: unknown; link?: string }> = {
      first: {
        body: { transfers: [
          { id: "1", status: "completed", amount: "3000", toAddress: "0xAAA", fromAddress: "0xw", createdAt: "" },
          { id: "2", status: "failed", amount: "999999", toAddress: "0xaaa", fromAddress: "0xw", createdAt: "" },
        ] },
        link: '<https://gw.test/v1/x402/transfers?page=2>; rel="next"',
      },
      second: {
        body: { transfers: [
          { id: "3", status: "received", amount: "2000", toAddress: "0xaaa", fromAddress: "0xw", createdAt: "" },
        ] },
      },
    };
    const seen: string[] = [];
    const fetchFn = (async (url: string) => {
      seen.push(String(url));
      const p = String(url).includes("page=2") ? pages.second : pages.first;
      return new Response(JSON.stringify(p.body), { headers: p.link ? { link: p.link } : {} });
    }) as unknown as typeof fetch;
    const out = await fetchWalletSettlements({
      address: "0xWALLET",
      network: { chainId: 5042, gatewayApi: "https://gw.test" },
      fetchFn,
    });
    assert.deepEqual(out, [{ counterparty: "0xaaa", chainAmountMicroUsdc: 5000, settlementId: "3", chainId: 5042 }]);
    assert.match(seen[0], /from=0xwallet/);
    assert.match(seen[0], /network=eip155%3A5042/);
  });
});

describe("self-hosted SQLite ledger", () => {
  it("stores records idempotently and refuses UPDATE/DELETE", async (t) => {
    const sqlite = (process as unknown as { getBuiltinModule?: (id: string) => unknown })
      .getBuiltinModule?.("node:sqlite") as
      | { DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void } }
      | undefined;
    if (!sqlite) {
      t.skip("node:sqlite not available on this Node");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "spendlens-sqlite-"));
    const file = join(dir, "ledger.db");
    try {
      const ledger = createSqliteLedger(file);
      const rec: AuthorizationRecord = {
        id: "r1", ts: new Date().toISOString(), agentId: "t", taskId: null, counterparty: "a.io",
        resource: "x", amountMicroUsdc: 5, decision: "allow", ruleHit: null, nonce: null, chainId: 5042,
        httpStatus: 200, latencyMs: 1, bodyBytes: 1, bodySha256: null, quality: "ok", settlementId: null,
        createdAt: new Date().toISOString(), policyHash: "h", policyVersion: null,
      };
      await ledger.sink([rec]);
      await ledger.sink([rec]); // a retried batch
      assert.equal(ledger.list().length, 1);
      assert.equal(ledger.list()[0].policyHash, "h");
      ledger.close();

      const raw = new sqlite.DatabaseSync(file);
      assert.throws(() => raw.exec("UPDATE ledger SET amount_micro_usdc = 1"), /append-only/);
      assert.throws(() => raw.exec("DELETE FROM ledger"), /append-only/);
      raw.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("mainnet safety rails", () => {
  it("guard() refuses to answer a mainnet 402 with the mock signature", async () => {
    const fetchFn = (async () =>
      new Response("pay", {
        status: 402,
        headers: { "x-pay-to": "api.example.io", "x-pay-amount": "0.001", "x-pay-chain-id": "5042" },
      })) as unknown as typeof fetch;
    const g = guard({ agentId: "t", policy: policy(), fetchFn });
    await assert.rejects(g.fetch("https://api.example.io/x"), SpendlensError);
  });

  it("with ARC_NETWORK=mainnet: no policy → refuse; no signer → refuse", () => {
    const script = `
      const m = await import("@/sdk");
      const guard = m.guard ?? m.default?.guard;
      const out = [];
      try { guard({ agentId: "t", signer: async () => ({ paymentHeader: "x" }) }); out.push("no-policy:allowed"); }
      catch (e) { out.push("no-policy:" + (/policy is required/.test(e.message) ? "refused" : e.message)); }
      try { guard({ agentId: "t", policy: ${JSON.stringify(defaultPolicyYaml("t"))} }); out.push("no-signer:allowed"); }
      catch (e) { out.push("no-signer:" + (/signer. is required/.test(e.message) ? "refused" : e.message)); }
      console.log(out.join(","));
    `;
    const res = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: { ...process.env, ARC_NETWORK: "mainnet", SPENDLENS_URL: "", SPENDLENS_API_KEY: "" },
      encoding: "utf8",
    });
    assert.equal(res.trim(), "no-policy:refused,no-signer:refused");
  });
});
