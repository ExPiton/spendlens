import type { PolicyConfig, AuthorizationRecord } from "@/lib/contracts";
import { classifyQuality } from "@/lib/engine/classifyQuality";
import { normalizeCounterparty } from "@/lib/counterparty";
import { PolicyEngine, type PolicyStateStore } from "./policy-engine";
import { AsyncLedgerQueue, registerAutoDrain, type LedgerSink } from "./queue";
import { PolicyBlocked } from "./errors";
import { PERMISSIVE_POLICY } from "./guard";
import {
  ControlPlane,
  assertMainnetPolicy,
  chainIdFromNetwork,
  defaultQueueOnError,
  loadPolicyInput,
  requestEscalation,
  resolveServerUrl,
  resolveSink,
} from "./runtime";
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
 *   import { guardGateway, ARC, ARC_GATEWAY_CHAIN } from "@spendlens/sdk";
 *
 *   // Resolves to testnet unless ARC_NETWORK=mainnet is set. Mainnet has no
 *   // public RPC, so ARC.rpcUrl (from ARC_MAINNET_RPC_URL) must be passed
 *   // through — chain: "arc" alone, without rpcUrl, fails.
 *   const client = new GatewayClient({ chain: ARC_GATEWAY_CHAIN, privateKey, rpcUrl: ARC.rpcUrl });
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
  /**
   * YAML text, a path to a `.yaml`/`.yml`/`.json` file, or a preloaded
   * PolicyConfig. Omitted: the agent's dashboard policy is used (kept in
   * sync live) when SPENDLENS_URL + SPENDLENS_API_KEY are set; otherwise the
   * permissive default — which is refused on Arc mainnet.
   */
  policy?: string | PolicyConfig;
  /** Telemetry sink URL, or `SPENDLENS_URL` from the environment. */
  sink?: LedgerSink;
  /** Bearer token for the ingest endpoint, or `SPENDLENS_API_KEY` from the env. */
  apiKey?: string;
  /** Spendlens server for the kill switch / remote policy; defaults to the
   *  URL sink or `SPENDLENS_URL`. */
  serverUrl?: string;
  /** Follow the dashboard's policy. Default: true when no local `policy`. */
  remotePolicy?: boolean;
  /** How often to re-check the kill switch / policy (ms, default 15000;
   *  0 = only on first use and on ingest responses). */
  syncIntervalMs?: number;
  /** Persist budgets/baselines across restarts (e.g. FilePolicyStateStore). */
  stateStore?: PolicyStateStore;
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
  /** Re-checks the dashboard now (kill switch + remote policy). */
  sync(): Promise<void>;
  /** Flushes buffered telemetry and stops the background timers — call
   *  before a Ctrl+C or explicit `process.exit()`, which an automatic
   *  `beforeExit` drain can't cover (see `registerAutoDrain`). */
  drain(): Promise<void>;
}

function envVal(name: string): string | undefined {
  return typeof process !== "undefined" && process.env ? process.env[name] : undefined;
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

  const label = "guardGateway";
  const localPolicy = loadPolicyInput(options.policy, label);
  const sink = resolveSink(options.sink);
  const apiKey = options.apiKey ?? envVal("SPENDLENS_API_KEY");
  const serverUrl = resolveServerUrl(options.serverUrl, sink);
  const remotePolicy =
    Boolean(serverUrl && apiKey) && (options.remotePolicy ?? localPolicy === undefined);
  assertMainnetPolicy(label, localPolicy !== undefined, remotePolicy);

  const engine = new PolicyEngine(localPolicy ?? PERMISSIVE_POLICY, options.stateStore);
  const control =
    serverUrl && apiKey
      ? new ControlPlane({
          serverUrl,
          apiKey,
          engine,
          remotePolicy,
          // No local policy to fall back on: block until the dashboard's arrives.
          failClosed: localPolicy === undefined,
          intervalMs: options.syncIntervalMs,
          label,
        })
      : undefined;
  control?.start();

  const queue = sink
    ? new AsyncLedgerQueue(sink, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        onError: defaultQueueOnError(label),
        onResponse: (res) =>
          control?.applyStatus(
            res.status === 423 ? "paused" : res.headers.get("x-spendlens-agent-status"),
          ),
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
    chainId: number;
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
      policyHash: engine.getPolicyHash(),
      policyVersion: engine.getPolicyVersion(),
      ...partial,
    };
    queue?.enqueue(full);
  };

  client.onBeforePaymentCreation(async ({ paymentRequired, selectedRequirements }) => {
    const requestedMicro = Math.round(Number(selectedRequirements.amount));
    // A non-numeric amount is blocked by the policy engine (challenge.invalid_amount);
    // record 0 rather than NaN so the ledger row stays valid.
    const amountMicroUsdc = Number.isFinite(requestedMicro) ? requestedMicro : 0;
    const resource = paymentRequired.resource?.url || currentUrl || "";
    const chainId = chainIdFromNetwork(selectedRequirements.network) ?? ARC.chainId;
    const taskId = currentTaskId;
    const input = {
      agentId: options.agentId,
      taskId,
      counterparty: selectedRequirements.payTo,
      amount: Number.isFinite(requestedMicro) ? requestedMicro / 1_000_000 : Number.NaN,
      resource,
      now: Date.now(),
    };
    const verdict = await engine.evaluate(input);
    // The engine canonicalizes the address (lowercase) — record that form so
    // the ledger joins cleanly against Gateway's lowercase transfer rows.
    const counterparty = verdict.counterparty;
    pending = { verdict, counterparty, amountMicroUsdc, resource, chainId, blocked: false };
    const base = {
      counterparty,
      resource,
      amountMicroUsdc,
      chainId,
      ruleHit: verdict.ruleHit,
      policyHash: verdict.policyHash,
      policyVersion: verdict.policyVersion,
    };

    if (verdict.decision === "block") {
      pending.blocked = true;
      record({ ...base, decision: "block" }, taskId);
      return { abort: true, reason: verdict.ruleHit ?? "policy.block" };
    }
    if (verdict.decision === "hold") {
      let approved: boolean;
      if (options.escalationHandler) {
        approved = await options.escalationHandler(selectedRequirements, verdict.ruleHit);
      } else {
        ({ approved } = await requestEscalation(
          verdict.escalation,
          {
            agentId: options.agentId,
            taskId,
            counterparty,
            resource,
            amountUsdc: amountMicroUsdc / 1_000_000,
            ruleHit: verdict.ruleHit,
          },
          { apiKey, trustedOrigin: serverUrl },
        ));
      }
      if (!approved) {
        pending.blocked = true;
        record({ ...base, decision: "hold_denied" }, taskId);
        return { abort: true, reason: verdict.ruleHit ?? "policy.hold_denied" };
      }
      // Approved → it will be paid, so it counts against every budget.
      engine.recordHoldApproved(input);
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
    // First use: pick up the kill switch / dashboard policy before paying.
    await control?.ready();
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
        body: bodyText,
      },
      p.verdict.qualityRules,
    );

    record(
      {
        counterparty: p.counterparty,
        resource: url,
        amountMicroUsdc: res ? Number(res.amount) : p.amountMicroUsdc,
        chainId: p.chainId,
        decision:
          p.verdict.decision === "hold" ? "hold_approved" : "allow",
        ruleHit: p.verdict.ruleHit,
        policyHash: p.verdict.policyHash,
        policyVersion: p.verdict.policyVersion,
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

  return {
    fetch: fetchImpl,
    engine,
    sync: () => control?.sync() ?? Promise.resolve(),
    drain: async () => {
      control?.stop();
      await queue?.drainAndStop();
    },
  };
}

// ── reconciliation sources ──────────────────────────────────────────────────

export interface SettlementEntry {
  counterparty: string;
  chainAmountMicroUsdc: number;
  settlementId?: string | null;
  /** Arc chain the transfers settled on. */
  chainId?: number | null;
}

/** Transfers Circle reports as `failed` never moved money; everything else
 *  (`received` → `batched` → `confirmed` → `completed`) is a signed
 *  authorization that has settled or will — exactly what reconciliation
 *  must account for. */
const COUNTED_TRANSFER_STATUSES = new Set(["received", "batched", "confirmed", "completed"]);

function rollUp(transfers: GatewayTransfer[], chainId: number | null): SettlementEntry[] {
  const byCp = new Map<string, { micro: number; lastId: string }>();
  for (const t of transfers) {
    if (!COUNTED_TRANSFER_STATUSES.has(String(t.status).toLowerCase())) continue;
    // Gateway returns `amount` as a string of atomic USDC units (6 decimals)
    // — e.g. "10000" for $0.01 — and addresses in lowercase; normalize
    // anyway so a future casing change can't split one counterparty in two.
    const micro = Math.round(Number(t.amount));
    const cp = normalizeCounterparty(t.toAddress);
    const cur = byCp.get(cp) ?? { micro: 0, lastId: t.id };
    cur.micro += Number.isFinite(micro) ? micro : 0;
    cur.lastId = t.id;
    byCp.set(cp, cur);
  }
  return [...byCp].map(([counterparty, v]) => ({
    counterparty,
    chainAmountMicroUsdc: v.micro,
    settlementId: v.lastId,
    chainId,
  }));
}

/** A page cursor that stops advancing would otherwise spin forever. 10,000
 *  pages of 100 is 1M transfers — far past one reconciliation pass. */
const MAX_PAGES = 10_000;

/**
 * Reads the agent wallet's settlement history from Circle Gateway
 * (`GatewayClient.searchTransfers`) and rolls it up per counterparty — ready to
 * POST to `/api/reconciliation/settlements`. `failed` transfers are skipped.
 * Prefer `fetchWalletSettlements`, which needs only the wallet address.
 */
export async function reconcileFromGateway(
  client: GatewayClientLike,
  opts?: { fromAddress?: string; since?: Date; until?: Date },
): Promise<SettlementEntry[]> {
  if (typeof client.searchTransfers !== "function") {
    throw new Error("reconcileFromGateway: client has no searchTransfers()");
  }
  const from = opts?.fromAddress ?? client.address;
  const transfers: GatewayTransfer[] = [];
  let pageAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { transfers: batch, pagination } = await client.searchTransfers({
      from,
      startDate: opts?.since?.toISOString(),
      endDate: opts?.until?.toISOString(),
      pageSize: 100,
      pageAfter,
    });
    transfers.push(...batch);
    if (!pagination?.pageAfter || pagination.pageAfter === pageAfter) break;
    pageAfter = pagination.pageAfter;
  }
  return rollUp(transfers, ARC.chainId);
}

/**
 * Keyless settlement source. Circle Gateway's `/v1/x402/transfers` is
 * queryable by address alone, so reconciliation never needs the agent's
 * private key — the Spendlens server runs this on a schedule for every agent
 * with a wallet address on file, and `npm run reconcile:arc` uses it with
 * just `AGENT_ADDRESS`.
 */
export async function fetchWalletSettlements(opts: {
  address: string;
  /** Defaults to the configured Arc network (ARC_NETWORK). */
  network?: { chainId: number; gatewayApi: string };
  since?: Date;
  until?: Date;
  fetchFn?: typeof fetch;
}): Promise<SettlementEntry[]> {
  const net = opts.network ?? ARC;
  const doFetch = opts.fetchFn ?? fetch;
  const transfers: GatewayTransfer[] = [];
  let url: string | null = (() => {
    const q = new URLSearchParams({
      from: normalizeCounterparty(opts.address),
      network: `eip155:${net.chainId}`,
      pageSize: "100",
    });
    if (opts.since) q.set("startDate", opts.since.toISOString());
    if (opts.until) q.set("endDate", opts.until.toISOString());
    return `${net.gatewayApi.replace(/\/$/, "")}/v1/x402/transfers?${q}`;
  })();
  const seen = new Set<string>();

  for (let page = 0; url && page < MAX_PAGES; page++) {
    if (seen.has(url)) break;
    seen.add(url);
    // A Gateway call that never answers used to hang the scheduled reconcile
    // forever — while holding its advisory-lock transaction, so no instance
    // reconciled anything (and /api/health still said "ok").
    const res = await doFetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new Error(`Gateway transfers query failed (${res.status}): ${await res.text().catch(() => "")}`);
    }
    const body = (await res.json()) as { transfers?: GatewayTransfer[] };
    transfers.push(...(body.transfers ?? []));
    url = nextLink(res.headers.get("link"));
  }
  return rollUp(transfers, net.chainId);
}

/** RFC 5988 `Link: <…>; rel="next"` → the next page URL. */
function nextLink(header: string | null): string | null {
  if (!header) return null;
  const re = /<([^>]+)>\s*;\s*rel="([^"]+)"/g;
  for (let m = re.exec(header); m; m = re.exec(header)) {
    if (m[2] === "next") return m[1];
  }
  return null;
}
