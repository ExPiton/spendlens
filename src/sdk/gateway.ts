import { PolicyConfig, toPolicyConfig, PolicyFileSchema, type AuthorizationRecord } from "@/lib/contracts";
import { classifyQuality } from "@/lib/engine/classifyQuality";
import { PolicyEngine } from "./policy-engine";
import { AsyncLedgerQueue, type LedgerSink } from "./queue";
import { PolicyBlocked } from "./errors";
import { PERMISSIVE_POLICY } from "./guard";
import { load } from "js-yaml";
import { ARC } from "@/lib/arc";

/**
 * Circle Nanopayments (x402 + Circle Gateway "GatewayWalletBatched" scheme)
 * adapter.
 *
 * The real buyer flow is `@circle-fin/x402-batching`'s `GatewayClient`: it holds
 * the wallet key, signs the EIP-3009 `TransferWithAuthorization` against the
 * Gateway Wallet contract, and settles in batches. It exposes an
 * `onBeforePaymentCreation` lifecycle hook — that's Spendlens's interception
 * point. This module registers the policy engine on that hook and records
 * telemetry around `client.pay()`, without depending on the package (the
 * client is typed structurally).
 *
 *   import { GatewayClient } from "@circle-fin/x402-batching/client";
 *   import { guardGateway } from "@spendlens/sdk";
 *
 *   const client = new GatewayClient({ chain: "arcTestnet", privateKey });
 *   const pay = guardGateway(client, { agentId: "research-crawler-01" });
 *   const { data } = await pay.fetch("https://api.example.io/premium");
 */

// ── structural types for @circle-fin/x402-batching's GatewayClient ───────────

interface HookRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string; // atomic USDC units (6 decimals), per x402 "exact"
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

interface PaymentCreationContext {
  paymentRequired: { resource?: { url: string }; accepts: HookRequirements[] };
  selectedRequirements: HookRequirements;
}

type BeforeHook = (
  ctx: PaymentCreationContext,
) => Promise<void | { abort: true; reason: string }>;

export interface PayResult<T = unknown> {
  data: T;
  amount: bigint;
  formattedAmount: string;
  transaction: string;
  status: number;
}

export interface GatewayTransfer {
  id: string;
  status: string;
  amount: string;
  fromAddress: string;
  toAddress: string;
  createdAt: string;
}

export interface GatewayClientLike {
  onBeforePaymentCreation(hook: BeforeHook): unknown;
  pay<T = unknown>(
    url: string,
    options?: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      body?: unknown;
      headers?: Record<string, string>;
    },
  ): Promise<PayResult<T>>;
  searchTransfers?(params?: {
    from?: string;
    to?: string;
    network?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    pageSize?: number;
    pageAfter?: string;
  }): Promise<{
    transfers: GatewayTransfer[];
    pagination?: { pageAfter?: string; next?: string };
  }>;
  readonly address?: string;
}

// ── guardGateway ────────────────────────────────────────────────────────────

export interface GuardGatewayOptions {
  agentId: string;
  /** YAML string, preloaded PolicyConfig, or omitted for the permissive default. */
  policy?: string | PolicyConfig;
  /** Telemetry sink URL, or `SPENDLENS_URL` from the environment. */
  sink?: LedgerSink;
  /** Bearer token for the ingest endpoint, or `SPENDLENS_API_KEY` from the env. */
  apiKey?: string;
  /** Called on a `hold` verdict; return true to let the payment proceed. */
  escalationHandler?: (
    requirements: HookRequirements,
    ruleHit: string | null,
  ) => Promise<boolean>;
}

export interface GuardedGateway {
  /** Policy-checked, telemetry-wrapped `client.pay()`. Throws `PolicyBlocked`
   *  when the policy denies the payment. */
  fetch<T = unknown>(
    url: string,
    options?: {
      taskId?: string;
      method?: "GET" | "POST" | "PUT" | "DELETE";
      body?: unknown;
      headers?: Record<string, string>;
    },
  ): Promise<PayResult<T>>;
  engine: PolicyEngine;
}

function resolvePolicy(policy: GuardGatewayOptions["policy"]): PolicyConfig {
  if (policy === undefined) return PERMISSIVE_POLICY;
  if (typeof policy !== "string") return policy;
  try {
    return toPolicyConfig(PolicyFileSchema.parse(load(policy)));
  } catch (err) {
    throw new Error(
      `guardGateway: invalid policy YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function envVal(name: string): string | undefined {
  return typeof process !== "undefined" && process.env ? process.env[name] : undefined;
}

function resolveSink(explicit: LedgerSink | undefined): LedgerSink | undefined {
  if (explicit) return explicit;
  const url = envVal("SPENDLENS_URL");
  if (!url) return undefined;
  return /\/api\/authorizations\/?$/.test(url)
    ? url
    : url.replace(/\/$/, "") + "/api/authorizations";
}

async function sha256Hex(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const buf = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return "";
}

const genId = () =>
  `auth_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function guardGateway(
  client: GatewayClientLike,
  options: GuardGatewayOptions,
): GuardedGateway {
  const engine = new PolicyEngine(resolvePolicy(options.policy));
  const sink = resolveSink(options.sink);
  const apiKey = options.apiKey ?? envVal("SPENDLENS_API_KEY");
  const queue = sink
    ? new AsyncLedgerQueue(sink, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      })
    : undefined;

  // pay() is 1:1 with a before-hook invocation, so a single-slot handoff is safe.
  type PendingState = {
    verdict: Awaited<ReturnType<PolicyEngine["evaluate"]>>;
    counterparty: string;
    amountMicroUsdc: number;
    resource: string;
    blocked: boolean;
  };
  let pending: PendingState | null = null;

  const record = (
    partial: Partial<AuthorizationRecord> &
      Pick<AuthorizationRecord, "counterparty" | "resource" | "amountMicroUsdc" | "decision">,
    taskId: string | null,
  ) => {
    const nowIso = new Date().toISOString();
    const full: AuthorizationRecord = {
      id: genId(),
      ts: nowIso,
      agentId: options.agentId,
      taskId,
      ruleHit: null,
      nonce: null,
      chainId: ARC.chainId,
      httpStatus: null,
      latencyMs: null,
      bodyBytes: null,
      bodySha256: null,
      quality: null,
      settlementId: null,
      createdAt: nowIso,
      ...partial,
    };
    queue?.enqueue(full);
  };

  client.onBeforePaymentCreation(async ({ paymentRequired, selectedRequirements }) => {
    const counterparty = selectedRequirements.payTo;
    const amountMicroUsdc = Math.round(Number(selectedRequirements.amount));
    const resource = paymentRequired.resource?.url ?? "";
    const verdict = await engine.evaluate({
      agentId: options.agentId,
      counterparty,
      amount: amountMicroUsdc / 1_000_000,
      resource,
      now: Date.now(),
    });
    pending = { verdict, counterparty, amountMicroUsdc, resource, blocked: false };

    if (verdict.decision === "block") {
      pending.blocked = true;
      record(
        { counterparty, resource, amountMicroUsdc, decision: "block", ruleHit: verdict.ruleHit },
        null,
      );
      return { abort: true, reason: verdict.ruleHit ?? "policy.block" };
    }
    if (verdict.decision === "hold") {
      const approved = options.escalationHandler
        ? await options.escalationHandler(selectedRequirements, verdict.ruleHit)
        : false;
      if (!approved) {
        pending.blocked = true;
        record(
          {
            counterparty,
            resource,
            amountMicroUsdc,
            decision: "hold_denied",
            ruleHit: verdict.ruleHit,
          },
          null,
        );
        return { abort: true, reason: verdict.ruleHit ?? "policy.hold_denied" };
      }
    }
  });

  async function fetchImpl<T>(
    url: string,
    opts?: {
      taskId?: string;
      method?: "GET" | "POST" | "PUT" | "DELETE";
      body?: unknown;
      headers?: Record<string, string>;
    },
  ): Promise<PayResult<T>> {
    const taskId = opts?.taskId ?? null;
    pending = null;
    const t0 = Date.now();

    let res: PayResult<T> | undefined;
    let error: unknown;
    try {
      res = await client.pay<T>(url, {
        method: opts?.method,
        body: opts?.body,
        headers: opts?.headers,
      });
    } catch (err) {
      error = err;
    }
    const latencyMs = Date.now() - t0;
    // `pending` is mutated by the onBeforePaymentCreation closure during the
    // await above; the cast tells TS not to keep it narrowed to `null`.
    const p = pending as PendingState | null;

    // Our hook aborted → policy denial.
    if (p?.blocked) {
      throw new PolicyBlocked(p.verdict.ruleHit ?? "policy", {
        counterparty: p.counterparty,
        amountUsdc: p.amountMicroUsdc / 1_000_000,
      });
    }
    if (!p) {
      // pay() failed before any 402 (network/DNS) and no hook ran.
      if (error) throw error;
      return res as PayResult<T>;
    }

    // The payment may have SETTLED even when pay() then threw — e.g. the SDK
    // couldn't JSON-parse an empty 200 body. That's the "silent quality
    // degradation" case: paid, got nothing usable.
    const settledButUnparseable =
      Boolean(error) && error instanceof SyntaxError;
    const bodyText =
      res && typeof res.data === "string"
        ? res.data
        : res
          ? JSON.stringify(res.data ?? "")
          : "";
    const bodyBytes = new TextEncoder().encode(bodyText).length;
    const quality = classifyQuality(
      {
        timedOut: Boolean(error) && !settledButUnparseable,
        status: res?.status ?? (settledButUnparseable ? 200 : 504),
        bodyBytes,
        latencyMs,
      },
      p.verdict.qualityRules,
    );

    record(
      {
        counterparty: p.counterparty,
        resource: url,
        amountMicroUsdc: res ? Number(res.amount) : p.amountMicroUsdc,
        decision:
          p.verdict.decision === "hold" ? "hold_approved" : "allow",
        ruleHit: p.verdict.ruleHit,
        httpStatus: res?.status ?? (settledButUnparseable ? 200 : null),
        latencyMs,
        bodyBytes,
        bodySha256: bodyText ? await sha256Hex(bodyText) : null,
        quality,
        settlementId: res?.transaction ?? null,
      },
      taskId,
    );

    if (error && !settledButUnparseable) throw error;
    // The payment settled; the body was just empty/unparseable. Hand back an
    // empty result rather than throwing, so the caller can decide what to do.
    return (res ?? {
      data: "" as unknown as T,
      amount: BigInt(p.amountMicroUsdc),
      formattedAmount: (p.amountMicroUsdc / 1_000_000).toFixed(6),
      transaction: "",
      status: 200,
    }) as PayResult<T>;
  }

  return { fetch: fetchImpl, engine };
}

// ── reconcileFromGateway ────────────────────────────────────────────────────

export interface SettlementEntry {
  counterparty: string;
  chainAmountMicroUsdc: number;
  settlementId?: string | null;
}

/**
 * Reads the agent wallet's on-chain settlement history from Circle Gateway
 * (`GatewayClient.searchTransfers`) and rolls it up per counterparty — ready to
 * POST to `/api/reconciliation/settlements`. This is the real Arc settlement
 * source the reconciliation screen compares the local ledger against.
 */
export async function reconcileFromGateway(
  client: GatewayClientLike,
  opts?: { fromAddress?: string; since?: Date },
): Promise<SettlementEntry[]> {
  if (typeof client.searchTransfers !== "function") {
    throw new Error("reconcileFromGateway: client has no searchTransfers()");
  }
  const from = opts?.fromAddress ?? client.address;
  const byCp = new Map<string, { micro: number; lastId: string }>();
  let pageAfter: string | undefined;

  do {
    const { transfers, pagination } = await client.searchTransfers({
      from,
      startDate: opts?.since?.toISOString(),
      pageSize: 100,
      pageAfter,
    });
    for (const t of transfers) {
      // Gateway `searchTransfers` returns `amount` as a string of atomic USDC
      // units (6 decimals) — e.g. "10000" for $0.01.
      const micro = Math.round(Number(t.amount));
      const cur = byCp.get(t.toAddress) ?? { micro: 0, lastId: t.id };
      cur.micro += Number.isFinite(micro) ? micro : 0;
      cur.lastId = t.id;
      byCp.set(t.toAddress, cur);
    }
    pageAfter = pagination?.pageAfter;
  } while (pageAfter);

  return [...byCp].map(([counterparty, v]) => ({
    counterparty,
    chainAmountMicroUsdc: v.micro,
    settlementId: v.lastId,
  }));
}
