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
