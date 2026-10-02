import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePaymentChallenge } from "@/sdk/challenge";
import { ChallengeParseError, EscalationDenied, PolicyBlocked } from "@/sdk/errors";
import { AsyncLedgerQueue, SinkRejected } from "@/sdk/queue";
import {
  ControlPlane,
  requestEscalation,
  resolveServerUrl,
  resolveSink,
} from "@/sdk/runtime";
import { PolicyEngine } from "@/sdk/policy-engine";
import { PERMISSIVE_POLICY } from "@/sdk/guard";
import type { AuthorizationRecord } from "@/lib/contracts";

const ESC = { timeoutSeconds: 5, onTimeout: "block" as const };
const PAYLOAD = { agentId: "t", taskId: null, counterparty: "0xabc", resource: "r", amountUsdc: 1, ruleHit: null };

describe("402 challenge amounts are validated (the paid server is untrusted input)", () => {
  const cp = "0x2222222222222222222222222222222222222222";

  for (const bad of ["-5", "NaN", "Infinity", "-Infinity", "abc"]) {
    it(`rejects x-pay-amount: ${bad}`, () => {
      assert.throws(
        () => parsePaymentChallenge({ "x-pay-to": cp, "x-pay-amount": bad }),
        (e: unknown) => e instanceof ChallengeParseError,
      );
    });
  }

  it("rejects a negative amount in a JSON body and says why", () => {
    assert.throws(
      () => parsePaymentChallenge({}, JSON.stringify({ payTo: cp, amount: -50 })),
      /invalid payment amount \(-50\)/,
    );
  });

  it("rejects a negative amount in WWW-Authenticate", () => {
    assert.throws(
      () => parsePaymentChallenge({ "www-authenticate": `Nanopayment payTo="${cp}", amount="-1"` }),
      ChallengeParseError,
    );
  });

  it("still accepts ordinary and zero amounts", () => {
    assert.equal(parsePaymentChallenge({ "x-pay-to": cp, "x-pay-amount": "0.003" }).maxAmountRequired, 0.003);
    assert.equal(parsePaymentChallenge({ "x-pay-to": cp, "x-pay-amount": "0" }).maxAmountRequired, 0);
    assert.equal(parsePaymentChallenge({}, JSON.stringify({ payTo: cp, amount: "0.5" })).maxAmountRequired, 0.5);
  });
});

describe("sink URL resolution", () => {
  it("a bare origin gets the ingest path; a full or custom URL is left alone", () => {
    assert.equal(resolveSink("https://spendlens.test"), "https://spendlens.test/api/authorizations");
    assert.equal(resolveSink("https://spendlens.test/"), "https://spendlens.test/api/authorizations");
    assert.equal(resolveSink("https://spendlens.test/api/authorizations"), "https://spendlens.test/api/authorizations");
    assert.equal(resolveSink("https://collector.test/ingest/v2"), "https://collector.test/ingest/v2");
    const fn = async () => {};
    assert.equal(resolveSink(fn), fn);
  });

  it("SPENDLENS_URL is always the server: the ingest path is appended even behind a path prefix", () => {
    const prev = process.env.SPENDLENS_URL;
    try {
      process.env.SPENDLENS_URL = "https://host.test/spendlens";
      assert.equal(resolveSink(undefined), "https://host.test/spendlens/api/authorizations");
      process.env.SPENDLENS_URL = "https://host.test/";
      assert.equal(resolveSink(undefined), "https://host.test/api/authorizations");
      process.env.SPENDLENS_URL = "https://host.test/api/authorizations";
      assert.equal(resolveSink(undefined), "https://host.test/api/authorizations");
    } finally {
      if (prev === undefined) delete process.env.SPENDLENS_URL;
      else process.env.SPENDLENS_URL = prev;
    }
  });

  it("the server URL is the origin whichever way the sink was spelled", () => {
    assert.equal(resolveServerUrl(undefined, resolveSink("https://spendlens.test")), "https://spendlens.test");
    assert.equal(resolveServerUrl(undefined, resolveSink("https://spendlens.test/api/authorizations")), "https://spendlens.test");
  });
});

describe("escalation: the API key only ever goes to the Spendlens server", () => {
  function recorder(answers: (url: string, method: string) => unknown) {
    const calls: { url: string; method: string; auth: string | null }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method, auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify(answers(String(url), method)), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  }

  it("sends the key to a webhook on the trusted origin", async () => {
    const { calls, fetchFn } = recorder(() => ({ approved: true }));
    await requestEscalation({ webhook: "https://s.test/api/escalate", ...ESC }, PAYLOAD, {
      apiKey: "sl_secret", trustedOrigin: "https://s.test", fetchFn,
    });
    assert.equal(calls[0].auth, "Bearer sl_secret");
  });

  it("does not send the key to a third-party webhook", async () => {
    const { calls, fetchFn } = recorder(() => ({ approved: true }));
    await requestEscalation({ webhook: "https://hooks.thirdparty.test/x", ...ESC }, PAYLOAD, {
      apiKey: "sl_secret", trustedOrigin: "https://s.test", fetchFn,
    });
    assert.equal(calls[0].auth, null);
  });

  it("never sends the key when no trusted origin is known", async () => {
    const { calls, fetchFn } = recorder(() => ({ approved: true }));
    await requestEscalation({ webhook: "https://s.test/api/escalate", ...ESC }, PAYLOAD, { apiKey: "sl_secret", fetchFn });
    assert.equal(calls[0].auth, null);
  });

  it("refuses to follow a pollUrl on a host the webhook doesn't own (and never sends it the key)", async () => {
    const { calls, fetchFn } = recorder((url) =>
      url.startsWith("https://hooks.thirdparty.test")
        ? { status: "pending", id: "e1", pollUrl: "https://collector.attacker.test/poll" }
        : { status: "approved" },
    );
    const r = await requestEscalation({ webhook: "https://hooks.thirdparty.test/x", ...ESC }, PAYLOAD, {
      apiKey: "sl_secret", trustedOrigin: "https://s.test", fetchFn, pollIntervalMs: 5,
    });
    assert.equal(r.approved, false, "an attacker-chosen poll host must not be able to approve a payment");
    assert.equal(r.reason, "error");
    assert.ok(calls.every((c) => !c.url.includes("attacker")), "the attacker host was never contacted");
  });

  it("follows a pollUrl on the webhook's own host, key included only for the trusted origin", async () => {
    const { calls, fetchFn } = recorder((url, method) =>
      method === "POST" ? { status: "pending", id: "e1", pollUrl: "https://s.test/api/escalate/e1" } : { status: "approved" },
    );
    const r = await requestEscalation({ webhook: "https://s.test/api/escalate", ...ESC }, PAYLOAD, {
      apiKey: "sl_secret", trustedOrigin: "https://s.test", fetchFn, pollIntervalMs: 5,
    });
    assert.deepEqual(r, { approved: true, reason: "decided" });
    assert.equal(calls.find((c) => c.method === "GET")?.auth, "Bearer sl_secret");
  });
});

describe("telemetry queue: failures are visible and poisoned batches don't block the queue", () => {
  const rec = (id: string): AuthorizationRecord => ({
    id, ts: new Date().toISOString(), agentId: "t", taskId: null, counterparty: "a.io", resource: "r",
    amountMicroUsdc: 1, decision: "allow", ruleHit: null, nonce: null, chainId: null, httpStatus: 200,
    latencyMs: 1, bodyBytes: 1, bodySha256: null, quality: "ok", settlementId: null, createdAt: new Date().toISOString(),
  });

  async function withFetch<T>(impl: (url: string) => Response, fn: (calls: string[]) => Promise<T>): Promise<T> {
    const orig = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      return impl(String(url));
    }) as unknown as typeof fetch;
    try {
      return await fn(calls);
    } finally {
      globalThis.fetch = orig;
    }
  }

  it("a 404/405 (wrong sink URL) drops the batch once, reports it with a hint, and does not retry forever", async () => {
    await withFetch(() => new Response("nope", { status: 405 }), async (calls) => {
      const errors: Error[] = [];
      const q = new AsyncLedgerQueue("https://spendlens.test", { onError: (e) => errors.push(e) });
      q.enqueue(rec("1"));
      await q.drainAndStop();
      assert.equal(calls.length, 1, "sent once — not re-queued and re-sent five times");
      assert.ok(errors[0] instanceof SinkRejected);
      assert.match(errors[0].message, /405/);
      assert.match(errors[0].message, /\/api\/authorizations/);
    });
  });

  it("a 401 points at the API key", async () => {
    await withFetch(() => new Response("{}", { status: 401 }), async () => {
      const errors: Error[] = [];
      const q = new AsyncLedgerQueue("https://spendlens.test/api/authorizations", { onError: (e) => errors.push(e) });
      q.enqueue(rec("1"));
      await q.drainAndStop();
      assert.match(errors[0].message, /SPENDLENS_API_KEY/);
    });
  });

  it("a 5xx is transient: the batch is kept and retried", async () => {
    let fail = true;
    await withFetch(() => (fail ? new Response("x", { status: 503 }) : new Response("{}")), async (calls) => {
      const q = new AsyncLedgerQueue("https://spendlens.test/api/authorizations", { onError: () => {} });
      q.enqueue(rec("1"));
      await q.flush();
      assert.equal(calls.length, 1);
      fail = false;
      await q.flush();
      assert.equal(calls.length, 2, "re-sent after the outage");
      await q.drainAndStop();
      assert.equal(calls.length, 2, "and then acknowledged — nothing left to send");
    });
  });

  it("a halted agent on an older server (423) is retried, not dropped", async () => {
    await withFetch(() => new Response("{}", { status: 423 }), async (calls) => {
      const q = new AsyncLedgerQueue("https://spendlens.test/api/authorizations", { onError: () => {}, onResponse: () => {} });
      q.enqueue(rec("1"));
      await q.flush();
      await q.flush();
      assert.equal(calls.length, 2);
      await q.drainAndStop();
    });
  });
});

describe("control plane: a failed sync is explained, not silent", () => {
  it("a fail-closed agent that can't load its policy says why every payment is blocked", async () => {
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (m: unknown) => void warns.push(String(m));
    try {
      const engine = new PolicyEngine(PERMISSIVE_POLICY);
      const cp = new ControlPlane({
        serverUrl: "https://old-server.test",
        apiKey: "sl_k",
        engine,
        remotePolicy: true,
        failClosed: true,
        intervalMs: 0,
        label: "guard",
        fetchFn: (async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch,
      });
      await cp.start();
      assert.equal(engine.getHaltRule(), "policy.unavailable");
      assert.equal(warns.length, 1);
      assert.match(warns[0], /config sync failed \(404\)/);
      assert.match(warns[0], /\/api\/sdk\/config/);
      assert.match(warns[0], /explicit `policy`/);
    } finally {
      console.warn = origWarn;
    }
  });
});

describe("error messages", () => {
  it("opaque rule ids come with a hint, and ruleHit stays machine-readable", () => {
    const e = new PolicyBlocked("policy.unavailable");
    assert.equal(e.ruleHit, "policy.unavailable");
    assert.match(e.message, /SPENDLENS_API_KEY/);
    assert.match(new PolicyBlocked("agent.halted").message, /kill switch/);
    assert.equal(new PolicyBlocked("per_call.max_usdc").message, "Payment blocked by policy rule: per_call.max_usdc");
  });

  it("a webhook failure is not reported as an operator's denial", () => {
    assert.match(new EscalationDenied("unavailable").message, /could not be completed/);
    assert.doesNotMatch(new EscalationDenied("unavailable").message, /denied by operator/);
    assert.equal(new EscalationDenied("unavailable").reason, "unavailable");
  });
});

describe("FilePolicyStateStore survives SIGTERM / SIGINT", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    it(`flushes budget state on ${signal} and still terminates`, () => {
      const dir = mkdtempSync(join(tmpdir(), "spendlens-signal-"));
      dirs.push(dir);
      const file = join(dir, "state.json");
      // 60 s debounce: nothing reaches the disk unless the signal handler flushes.
      const script = `
        const m = await import("@/sdk");
        const FilePolicyStateStore = m.FilePolicyStateStore ?? m.default?.FilePolicyStateStore;
        const s = new FilePolicyStateStore(${JSON.stringify(file)}, 60000);
        s.recordCall(
          { agentId: "a1", taskId: "t1", counterparty: "api.x", amount: 2.5, resource: "r" },
          { decision: "allow", ruleHit: null, qualityRules: {}, escalation: {}, counterparty: "api.x", policyHash: "", policyVersion: null },
        );
        setTimeout(() => {}, 15000); // keep the loop alive to receive the signal
        process.kill(process.pid, "${signal}");
      `;
      const res = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        encoding: "utf8",
        timeout: 20000,
      });
      assert.equal(res.signal, signal, `the process still dies from ${signal} (stderr: ${res.stderr})`);
      assert.ok(existsSync(file), "state file was written before the process died");
      assert.equal(JSON.parse(readFileSync(file, "utf8")).taskSpends["a1:t1"], 2.5);
    });
  }
});
