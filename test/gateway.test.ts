import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { guardGateway, reconcileFromGateway, PolicyBlocked } from "@/sdk";
import type { GatewayClientLike } from "@/sdk/gateway";
import type { AuthorizationRecord } from "@/lib/contracts";

/** Minimal fake of @circle-fin/x402-batching's GatewayClient. `pay()` runs the
 *  registered before-hook (like the real one does) and either aborts or
 *  returns a PayResult. */
function fakeClient(opts: {
  payTo: string;
  amountAtomic: string;
  resourceUrl: string;
  responseBody?: unknown;
  status?: number;
  transfers?: Array<{ id: string; amount: string; toAddress: string; fromAddress: string; status: string; createdAt: string }>;
}) {
  let hook: ((ctx: any) => Promise<any>) | null = null;
  const c = {
    address: "0xagentwallet0000000000000000000000000000",
    onBeforePaymentCreation(h: (ctx: unknown) => Promise<unknown>) {
      hook = h;
      return this;
    },
    async pay<T>(url: string) {
      const ctx = {
        paymentRequired: { resource: { url: opts.resourceUrl }, accepts: [] },
        selectedRequirements: {
          scheme: "exact",
          network: "eip155:5042002",
          asset: "0x3600000000000000000000000000000000000000",
          amount: opts.amountAtomic,
          payTo: opts.payTo,
          maxTimeoutSeconds: 60,
          extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x00" },
        },
      };
      const r = (await hook?.(ctx)) as { abort?: true; reason?: string } | undefined;
      if (r?.abort) throw new Error(`Payment creation aborted: ${r.reason}`);
      return {
        data: opts.responseBody ?? { ok: 1 },
        amount: BigInt(opts.amountAtomic),
        formattedAmount: (Number(opts.amountAtomic) / 1e6).toFixed(6),
        transaction: "0xsettlementtxhash",
        status: opts.status ?? 200,
      } as { data: T; amount: bigint; formattedAmount: string; transaction: string; status: number };
    },
    async searchTransfers() {
      return { transfers: opts.transfers ?? [] };
    },
  };
  return c as unknown as GatewayClientLike;
}

const ALLOWLIST_POLICY = `version: 1
agent: t
budgets: [{ scope: task, limit_usdc: 5 }, { scope: hour, limit_usdc: 50 }, { scope: day, limit_usdc: 500 }]
per_call: { max_usdc: 0.05, max_calls_per_minute: 600 }
counterparties:
  mode: allowlist
  allow: ["api.example.io"]
  deny: ["0x000000000000000000000000000000000badc0de"]
  first_seen: { action: alert, auto_allow_below_usdc: 0.001 }
anomaly:
  burn_rate: { baseline: ewma, halflife_minutes: 15, z_threshold: 4, action: alert }
  new_counterparty_rate: { max_per_hour: 50, action: alert }
quality: { failure_status_codes: [402,500,502,503,504], empty_body_is_failure: true, json_schema: null, max_latency_ms: 4000 }
escalation: { webhook: "https://example.com/x", timeout_seconds: 30, on_timeout: block }
`;

describe("guardGateway (Nanopayments adapter)", () => {
  it("allows an in-policy payment and records it with the settlement tx", async () => {
    const recorded: AuthorizationRecord[] = [];
    const client = fakeClient({
      payTo: "api.example.io",
      amountAtomic: "3000", // 0.003 USDC
      resourceUrl: "https://api.example.io/premium",
    });
    const pay = guardGateway(client, {
      agentId: "t",
      policy: ALLOWLIST_POLICY,
      sink: async (rs) => void recorded.push(...rs),
    });

    const res = await pay.fetch("https://api.example.io/premium", { taskId: "task-1" });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 1200)); // flush queue

    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].decision, "allow");
    assert.equal(recorded[0].counterparty, "api.example.io");
    assert.equal(recorded[0].amountMicroUsdc, 3000);
    assert.equal(recorded[0].settlementId, "0xsettlementtxhash");
    assert.equal(recorded[0].chainId, 5042002);
    assert.equal(recorded[0].quality, "ok");
  });

  it("blocks a payment over the per-call ceiling and throws PolicyBlocked", async () => {
    const recorded: AuthorizationRecord[] = [];
    const client = fakeClient({
      payTo: "api.example.io",
      amountAtomic: "5000000", // 5 USDC, over max_usdc 0.05
      resourceUrl: "https://api.example.io/expensive",
    });
    const pay = guardGateway(client, {
      agentId: "t",
      policy: ALLOWLIST_POLICY,
      sink: async (rs) => void recorded.push(...rs),
    });

    await assert.rejects(
      () => pay.fetch("https://api.example.io/expensive"),
      (e: unknown) => e instanceof PolicyBlocked && e.ruleHit === "per_call.max_usdc",
    );
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].decision, "block");
    assert.equal(recorded[0].ruleHit, "per_call.max_usdc");
  });

  it("blocks a denylisted counterparty", async () => {
    const client = fakeClient({
      payTo: "0x000000000000000000000000000000000badc0de",
      amountAtomic: "2000",
      resourceUrl: "https://scam/x",
    });
    const pay = guardGateway(client, { agentId: "t", policy: ALLOWLIST_POLICY });
    await assert.rejects(
      () => pay.fetch("https://scam/x"),
      (e: unknown) => e instanceof PolicyBlocked && e.ruleHit === "counterparties.deny",
    );
  });

  it("classifies an empty response body as wasted spend", async () => {
    const recorded: AuthorizationRecord[] = [];
    const client = fakeClient({
      payTo: "api.example.io",
      amountAtomic: "3000",
      resourceUrl: "https://api.example.io/empty",
      responseBody: "",
    });
    const pay = guardGateway(client, {
      agentId: "t",
      policy: ALLOWLIST_POLICY,
      sink: async (rs) => void recorded.push(...rs),
    });
    await pay.fetch("https://api.example.io/empty");
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(recorded[0].quality, "empty");
  });
});

describe("reconcileFromGateway", () => {
  it("rolls Gateway transfers up per counterparty", async () => {
    const client = fakeClient({
      payTo: "x",
      amountAtomic: "0",
      resourceUrl: "x",
      // Gateway returns `amount` as atomic units (6-dec): "10000" = $0.01
      transfers: [
        { id: "t1", amount: "3000", toAddress: "api.example.io", fromAddress: "a", status: "completed", createdAt: "" },
        { id: "t2", amount: "5000", toAddress: "api.example.io", fromAddress: "a", status: "completed", createdAt: "" },
        { id: "t3", amount: "10000", toAddress: "other.io", fromAddress: "a", status: "completed", createdAt: "" },
      ],
    });
    const entries = await reconcileFromGateway(client, { fromAddress: "a" });
    const api = entries.find((e) => e.counterparty === "api.example.io");
    assert.equal(api?.chainAmountMicroUsdc, 8000);
    assert.equal(api?.settlementId, "t2");
    assert.equal(entries.find((e) => e.counterparty === "other.io")?.chainAmountMicroUsdc, 10000);
  });
});
