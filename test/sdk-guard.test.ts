import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { guard } from "../src/sdk/guard";
import { PolicyBlocked } from "../src/sdk/errors";
import type { PolicyConfig, AuthorizationRecord } from "../src/lib/contracts";

const testPolicy: PolicyConfig = {
  version: 1,
  agent: "test-agent-01",
  budgets: [
    { scope: "task", limitUsdc: 1.0 },
    { scope: "hour", limitUsdc: 2.0 },
    { scope: "day", limitUsdc: 10.0 },
  ],
  perCall: {
    maxUsdc: 0.05,
    maxCallsPerMinute: 100,
  },
  counterparties: {
    mode: "allowlist",
    allow: ["api.allowed.io"],
    deny: ["api.blocked.io"],
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
    failureStatusCodes: [402, 500, 502],
    emptyBodyIsFailure: true,
    jsonSchema: null,
    maxLatencyMs: 2000,
  },
  escalation: {
    webhook: "https://ops.example.com/webhook",
    timeoutSeconds: 5,
    onTimeout: "block",
  },
};

describe("Spendlens SDK Guard Interception", () => {
  test("passes through non-402 requests directly without policy check", async () => {
    let fetchCount = 0;
    const mockFetch: typeof fetch = async () => {
      fetchCount++;
      return new Response(JSON.stringify({ hello: "world" }), { status: 200 });
    };

    const pay = guard({
      agentId: "test-agent-01",
      policy: testPolicy,
      fetchFn: mockFetch,
    });

    const res = await pay.fetch("https://api.free-endpoint.io/status");
    assert.equal(res.status, 200);
    assert.equal(fetchCount, 1);
  });

  test("intercepts 402 challenge, verifies policy, signs and completes payment", async () => {
    let probeExecuted = false;
    let paymentCallExecuted = false;
    const capturedTelemetry: AuthorizationRecord[] = [];

    const mockFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("Authorization");

      if (!authHeader) {
        probeExecuted = true;
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: {
            "x-pay-to": "api.allowed.io",
            "x-pay-amount": "0.003",
            "x-pay-currency": "USDC",
            "x-pay-nonce": "nonce_12345",
          },
        });
      }

      paymentCallExecuted = true;
      assert.equal(authHeader, "Bearer signed_arc_tx_001");
      return new Response(JSON.stringify({ data: "verified market analysis" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const pay = guard({
      agentId: "test-agent-01",
      policy: testPolicy,
      fetchFn: mockFetch,
      signer: async (challenge) => {
        assert.equal(challenge.payTo, "api.allowed.io");
        assert.equal(challenge.maxAmountRequired, 0.003);
        return { paymentHeader: "Bearer signed_arc_tx_001", nonce: challenge.nonce };
      },
      sink: (records) => {
        capturedTelemetry.push(...records);
        return Promise.resolve();
      },
    });

    const res = await pay.fetch("https://api.allowed.io/v1/market-data", {
      taskId: "task-001",
    });

    assert.equal(res.status, 200);
    assert.equal(probeExecuted, true);
    assert.equal(paymentCallExecuted, true);

    const body = await res.json();
    assert.equal(body.data, "verified market analysis");
  });

  /** A guard wired to a Spendlens server at https://spendlens.test whose
   *  policy escalates to `webhook`. Returns the Authorization header each
   *  escalation call carried (null = anonymous). */
  async function escalateTo(webhook: string): Promise<{ status: number; seenAuth: Record<string, string | null> }> {
    const seenAuth: Record<string, string | null> = {};
    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/sdk/config")) {
        return new Response(JSON.stringify({ agent: { id: "test-agent-01", status: "active" }, policy: null }));
      }
      if (url === webhook) {
        seenAuth[url] = new Headers(init?.headers).get("Authorization");
        return new Response(JSON.stringify({ approved: true }), { status: 200 });
      }
      const authHeader = new Headers(init?.headers).get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { "x-pay-to": "unknown-vendor.io", "x-pay-amount": "0.02" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const pay = guard({
      agentId: "test-agent-01",
      policy: { ...testPolicy, escalation: { ...testPolicy.escalation, webhook } },
      fetchFn: mockFetch,
      apiKey: "sl_test_key_456",
      serverUrl: "https://spendlens.test",
      syncIntervalMs: 0,
      signer: async (challenge) => ({ paymentHeader: "Bearer sig", nonce: challenge.nonce }),
    });
    const res = await pay.fetch("https://unknown-vendor.io/v1/item");
    await pay.drain();
    return { status: res.status, seenAuth };
  }

  test("REGRESSION: Spendlens's own escalation endpoint is called with the agent's API key, not anonymously", async () => {
    const webhook = "https://spendlens.test/api/escalate";
    const { status, seenAuth } = await escalateTo(webhook);
    assert.equal(status, 200);
    assert.equal(seenAuth[webhook], "Bearer sl_test_key_456");
  });

  test("REGRESSION: a third-party escalation webhook never receives the agent's API key", async () => {
    // The default webhook used to be https://example.com/...: every hold
    // handed the ingest credential to whoever runs the webhook.
    const webhook = "https://ops.example.com/webhook";
    const { status, seenAuth } = await escalateTo(webhook);
    assert.equal(status, 200);
    assert.equal(seenAuth[webhook], null, "no Authorization header on a third-party webhook");
  });

  test("a bare-origin sink posts to /api/authorizations (the dashboard snippet passes the origin)", async () => {
    const posted: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      posted.push(String(url));
      return new Response("{}");
    }) as unknown as typeof fetch;
    try {
      const pay = guard({
        agentId: "test-agent-01",
        policy: testPolicy,
        apiKey: "sl_k",
        sink: "https://spendlens.test",
        syncIntervalMs: 0,
        fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).endsWith("/api/sdk/config")) {
            return new Response(JSON.stringify({ agent: { id: "test-agent-01", status: "active" }, policy: null }));
          }
          return new Headers(init?.headers).get("Authorization")
            ? new Response("ok")
            : new Response("pay", { status: 402, headers: { "x-pay-to": "api.allowed.io", "x-pay-amount": "0.003" } });
        }) as unknown as typeof fetch,
        signer: async () => ({ paymentHeader: "sig" }),
      });
      await pay.fetch("https://api.allowed.io/x");
      await pay.drain();
      assert.ok(posted.includes("https://spendlens.test/api/authorizations"), `posted to: ${posted.join(", ")}`);
      assert.ok(!posted.includes("https://spendlens.test"), "never POSTs to the bare origin (405, records lost)");
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("the caller's own Authorization header is not overwritten by the payment header", async () => {
    let seen: Headers | null = null;
    const mockFetch: typeof fetch = async (_input, init) => {
      const h = new Headers(init?.headers);
      if (!h.get("X-Payment-Authorization")) {
        return new Response("pay", { status: 402, headers: { "x-pay-to": "api.allowed.io", "x-pay-amount": "0.003" } });
      }
      seen = h;
      return new Response("ok");
    };
    const pay = guard({
      agentId: "test-agent-01",
      policy: testPolicy,
      fetchFn: mockFetch,
      signer: async () => ({ paymentHeader: "Bearer pay-sig" }),
    });
    await pay.fetch("https://api.allowed.io/x", { headers: { Authorization: "Bearer my-own-api-token" } });
    assert.equal((seen as Headers | null)?.get("Authorization"), "Bearer my-own-api-token");
    assert.equal((seen as Headers | null)?.get("X-Payment-Authorization"), "Bearer pay-sig");
  });

  test("REGRESSION: a streamed request body survives the probe-then-pay retry intact", async () => {
    // A ReadableStream body can only be read once. The probe request used
    // to consume it, leaving the paid retry with nothing — silently
    // corrupting the actual POST once payment was authorized.
    const seenBodies: string[] = [];
    const mockFetch: typeof fetch = async (_input, init) => {
      const authHeader = new Headers(init?.headers).get("Authorization");
      seenBodies.push(
        init?.body instanceof ArrayBuffer ? new TextDecoder().decode(init.body) : "",
      );
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { "x-pay-to": "api.allowed.io", "x-pay-amount": "0.003" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const streamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello-payload"));
        controller.close();
      },
    });

    const pay = guard({
      agentId: "test-agent-01",
      policy: testPolicy,
      fetchFn: mockFetch,
      signer: async (challenge) => ({ paymentHeader: "Bearer sig", nonce: challenge.nonce }),
    });

    await pay.fetch("https://api.allowed.io/v1/submit", {
      method: "POST",
      body: streamBody,
    });

    assert.deepEqual(seenBodies, ["hello-payload", "hello-payload"]);
  });

  test("throws PolicyBlocked when 402 challenge targets a denied counterparty", async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response("Payment Required", {
        status: 402,
        headers: {
          "x-pay-to": "api.blocked.io",
          "x-pay-amount": "0.003",
        },
      });
    };

    const pay = guard({
      agentId: "test-agent-01",
      policy: testPolicy,
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await pay.fetch("https://api.blocked.io/v1/bad");
      },
      (err: unknown) => {
        assert.ok(err instanceof PolicyBlocked);
        assert.equal(err.ruleHit, "counterparties.deny");
        return true;
      },
    );
  });
});
