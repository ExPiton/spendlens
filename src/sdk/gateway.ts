import { PolicyConfig, toPolicyConfig, PolicyFileSchema, type AuthorizationRecord } from "@/lib/contracts";
import { classifyQuality } from "@/lib/engine/classifyQuality";
import { PolicyEngine } from "./policy-engine";
import { AsyncLedgerQueue, registerAutoDrain, type LedgerSink } from "./queue";
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
  /** Flushes buffered telemetry and stops the background timer — call
   *  before a Ctrl+C or explicit `process.exit()`, which an automatic
   *  `beforeExit` drain can't cover (see `registerAutoDrain`). */
  drain(): Promise<void>;
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

interface EscalationConfig {
  webhook: string;
  timeoutSeconds: number;
  onTimeout: "allow" | "block" | "hold" | "alert";
}

/**
 * POSTs a `hold` challenge to the policy's escalation webhook and waits up to
 * `timeoutSeconds` for `{ approved: boolean }`. On any failure or timeout the
 * answer is `onTimeout === "allow"`. Spendlens's own `/api/escalate` speaks
 * this shape.
 */
async function askEscalationWebhook(
  escalation: EscalationConfig,
  payload: {
    agentId: string;
    counterparty: string;
    resource: string;
    amountUsdc: number;
    ruleHit: string | null;
  },
  apiKey?: string,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(
      () => controller.abort(),
      Math.max(1, escalation.timeoutSeconds) * 1000,
    );
    const res = await fetch(escalation.webhook, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return escalation.onTimeout === "allow";
    const data = (await res.json().catch(() => ({}))) as { approved?: boolean };
    return data.approved === true;
  } catch {
    return escalation.onTimeout === "allow";
  }
}

// `client.onBeforePaymentCreation` is an additive hook registry on the
// GatewayClient itself, not something guardGateway owns exclusively — the
// real Circle SDK runs every registered hook for every payment, regardless
// of which guardGateway() call made it. Wrapping the same client a second
// time doesn't create an independent policy scope: BOTH policies end up
// gating BOTH agents' payments, and the second wrapper's telemetry queue
// silently receives records that belong to the first agent. That's a
// silent correctness bug (wrong blocks, wrong ledger attribution) with no
// error to notice it by — turn it into a loud one at setup time instead.
const wrappedClients = new WeakSet<GatewayClientLike>();

export function guardGateway(
  client: GatewayClientLike,
  options: GuardGatewayOptions,
): GuardedGateway {
  if (wrappedClients.has(client)) {
    throw new Error(
      "guardGateway: this GatewayClient is already wrapped by another " +
        "guardGateway() call. Circle's onBeforePaymentCreation hook is " +
        "shared by the whole client, so a second wrap doesn't get its own " +
        "policy — both policies end up applying to both agents' payments. " +
        "Construct a separate GatewayClient per agent instead (the same " +
        "privateKey is fine to reuse across them — it's cheap, no on-chain " +
        "cost to create the client object itself).",
    );
  }
  wrappedClients.add(client);

  const engine = new PolicyEngine(resolvePolicy(options.policy));
  const sink = resolveSink(options.sink);
  const apiKey = options.apiKey ?? envVal("SPENDLENS_API_KEY");
  const queue = sink
    ? new AsyncLedgerQueue(sink, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      })
    : undefined;
  if (queue) registerAutoDrain(queue);

  // pay() is 1:1 with a before-hook invocation, so a single-slot handoff is
  // safe *as long as calls are serialized* — `fetchImpl` below enforces
  // that with a mutex, since `client.onBeforePaymentCreation` is registered
  // once for the whole client and has no per-call id to correlate against.
  // Without serialization, two concurrent `fetch()` calls could interleave
  // their hook invocations and each read back the OTHER call's verdict.
  type PendingState = {
    verdict: Awaited<ReturnType<PolicyEngine["evaluate"]>>;
    counterparty: string;
    amountMicroUsdc: number;
    resource: string;
    blocked: boolean;
  };
  let pending: PendingState | null = null;
  // Set by fetchImpl immediately before `client.pay()`, read by the hook.
  // Safe only under the same serialization guarantee as `pending`.
  let currentTaskId: string | null = null;
  // Same pattern, for when `paymentRequired.resource?.url` comes back empty
  // (the real Circle client doesn't always populate it) — falls back to the
  // URL this call was actually made with, so a blocked/held record's
  // `resource` field isn't silently blank.
  let currentUrl: string | null = null;

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
    const resource = paymentRequired.resource?.url || currentUrl || "";
    const taskId = currentTaskId;
    const verdict = await engine.evaluate({
      agentId: options.agentId,
      taskId,
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
        taskId,
      );
      return { abort: true, reason: verdict.ruleHit ?? "policy.block" };
    }
    if (verdict.decision === "hold") {
      let approved = false;
      if (options.escalationHandler) {
        approved = await options.escalationHandler(selectedRequirements, verdict.ruleHit);
      } else if (verdict.escalation?.webhook) {
        approved = await askEscalationWebhook(
          verdict.escalation,
          {
            agentId: options.agentId,
            counterparty,
            resource,
            amountUsdc: amountMicroUsdc / 1_000_000,
            ruleHit: verdict.ruleHit,
          },
          apiKey,
        );
      }
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
          taskId,
        );
        return { abort: true, reason: verdict.ruleHit ?? "policy.hold_denied" };
      }
    }
  });

  // Serializes fetchImpl invocations on this instance so the single-slot
  // `pending`/`currentTaskId` handoff with the hook above stays correct —
  // see the comment on `pending`'s declaration.
  let mutex: Promise<unknown> = Promise.resolve();

  async function fetchImpl<T>(
    url: string,
    opts?: {
      taskId?: string;
      method?: "GET" | "POST" | "PUT" | "DELETE";
      body?: unknown;
      headers?: Record<string, string>;
    },
  ): Promise<PayResult<T>> {
    const run = mutex.then(() => runFetch<T>(url, opts));
    // Chain onto the settled promise (not the original) regardless of
    // outcome, so one failed call doesn't wedge every call queued after it.
    mutex = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function runFetch<T>(
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
    currentTaskId = taskId;
    currentUrl = url;
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

    // client.pay() itself already read the settlement id off the
    // PAYMENT-RESPONSE header before throwing — but it's a local inside
    // Circle's own pay(), never returned to us alongside the thrown error,
    // so it's gone from here. Best-effort recovery: ask Gateway directly for
    // this counterparty's most recent transfer. It can still come back
    // empty if the batch hasn't posted yet — that's the one gap this can't
    // close — but it beats leaving every quality:empty record permanently
    // unmatched when the settlement is sitting right there in Gateway.
    let recoveredSettlementId: string | null = null;
    if (settledButUnparseable && client.address && client.searchTransfers) {
      try {
        const { transfers } = await client.searchTransfers({
          from: client.address,
          to: p.counterparty,
          pageSize: 1,
        });
        recoveredSettlementId = transfers[0]?.id ?? null;
      } catch {
        // best-effort only
      }
    }

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
        settlementId: res?.transaction || recoveredSettlementId,
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

  return { fetch: fetchImpl, engine, drain: () => queue?.drainAndStop() ?? Promise.resolve() };
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
  // A page cursor that stops advancing (a bug on the API side, or one that
  // hands back the same token) would otherwise spin this forever. 10,000
  // pages of 100 is 1M transfers — far beyond anything this reconciliation
  // pass is meant to process in one call.
  const MAX_PAGES = 10_000;

  for (let page = 0; page < MAX_PAGES; page++) {
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
    if (!pagination?.pageAfter || pagination.pageAfter === pageAfter) break;
    pageAfter = pagination.pageAfter;
  }

  return [...byCp].map(([counterparty, v]) => ({
    counterparty,
    chainAmountMicroUsdc: v.micro,
    settlementId: v.lastId,
  }));
}
