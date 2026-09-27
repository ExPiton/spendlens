import type { PolicyConfig, AuthorizationRecord, Quality } from "@/lib/contracts";
import { classifyQuality } from "@/lib/engine/classifyQuality";
import { PolicyEngine, type PolicyStateStore } from "./policy-engine";
import { parsePaymentChallenge, type PaymentChallenge } from "./challenge";
import { AsyncLedgerQueue, registerAutoDrain, type LedgerSink } from "./queue";
import { PolicyBlocked, EscalationDenied, SpendlensError } from "./errors";
import {
  ControlPlane,
  assertMainnetPolicy,
  isMainnet,
  loadPolicyInput,
  requestEscalation,
  resolveServerUrl,
  resolveSink,
} from "./runtime";

export interface PaymentAuthorization {
  paymentHeader: string; // e.g. "Bearer ..." or "Signature ..."
  nonce?: string;
  authorizationToken?: string;
}

export type SignerFn = (challenge: PaymentChallenge) => Promise<PaymentAuthorization>;

export interface GuardOptions {
  agentId: string;
  /**
   * The agent's policy — YAML text, a path to a `.yaml`/`.yml`/`.json` file
   * (`"./policy.yaml"`), or a preloaded `PolicyConfig`. Omitted: the agent's
   * dashboard policy is used and kept in sync live when SPENDLENS_URL +
   * SPENDLENS_API_KEY are set; otherwise a permissive "record everything,
   * block nothing" default — testnet only, refused on Arc mainnet.
   */
  policy?: string | PolicyConfig;
  /**
   * Where telemetry goes. A URL string posts batches to a hosted Spendlens
   * ingest endpoint. Defaults to `SPENDLENS_URL` from the environment
   * (`/api/authorizations` is appended if missing).
   */
  sink?: LedgerSink;
  /**
   * Bearer token for the hosted ingest endpoint, sent as
   * `Authorization: Bearer <apiKey>`. Defaults to `SPENDLENS_API_KEY` from the
   * environment. Ignored when `sink` is not a URL string.
   */
  apiKey?: string;
  /**
   * Produces the payment authorization once a 402 is allowed. Without one, a
   * clearly-marked mock signature is used (telemetry works, the payment will
   * not actually settle). See `createLocalSigner`.
   */
  signer?: SignerFn;
  fetchFn?: typeof fetch;
  escalationHandler?: (challenge: PaymentChallenge, ruleHit: string | null) => Promise<boolean>;
  /** Spendlens server for the kill switch / remote policy; defaults to the
   *  URL sink or `SPENDLENS_URL`. */
  serverUrl?: string;
  /** Follow the dashboard's policy. Default: true when no local `policy`. */
  remotePolicy?: boolean;
  /** Kill-switch / policy re-check interval in ms (default 15000). */
  syncIntervalMs?: number;
  /** Persist budgets/baselines across restarts (e.g. FilePolicyStateStore). */
  stateStore?: PolicyStateStore;
}

/** Permissive default: every counterparty allowed, generous limits, no holds.
 *  You still get the full ledger + quality analysis. */
export const PERMISSIVE_POLICY: PolicyConfig = {
  version: 1,
  agent: "default",
  budgets: [
    { scope: "task", limitUsdc: 1000 },
    { scope: "hour", limitUsdc: 1000 },
    { scope: "day", limitUsdc: 10000 },
  ],
  perCall: { maxUsdc: 1000, maxCallsPerMinute: 100000 },
  counterparties: {
    mode: "denylist",
    allow: [],
    deny: [],
    firstSeen: { action: "alert", autoAllowBelowUsdc: 1000 },
  },
  anomaly: {
    burnRate: { baseline: "ewma", halflifeMinutes: 15, zThreshold: 8, action: "alert" },
    newCounterpartyRate: { maxPerHour: 100000, action: "alert" },
  },
  quality: {
    failureStatusCodes: [402, 429, 500, 502, 503, 504],
    emptyBodyIsFailure: true,
    jsonSchema: null,
    maxLatencyMs: 10000,
  },
  escalation: {
    webhook: null,
    timeoutSeconds: 30,
    onTimeout: "block",
  },
};

function envValue(name: string): string | undefined {
  return typeof process !== "undefined" && process.env
    ? process.env[name]
    : undefined;
}

let warnedMockSigner = false;

export interface GuardedRequestInit extends RequestInit {
  taskId?: string;
}

/** Real SHA-256 when `crypto.subtle` is available, `""` otherwise — never a
 *  fabricated stand-in. A fake hash padded out to look like a real sha256
 *  is worse than an honest empty string: it can pass a casual "looks like a
 *  hash" check while silently not being the actual audit-trail digest of
 *  the response body, exactly where quality/reconciliation auditing needs
 *  it to be trustworthy. `guardGateway`'s `sha256Hex` already returns ""
 *  in this case; this matches it instead of disagreeing. */
async function computeSha256(text: string): Promise<string> {
  if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.subtle) {
    return "";
  }
  const msgBuffer = new TextEncoder().encode(text);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateId(): string {
  return `auth_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class SpendlensGuard {
  readonly agentId: string;
  private policyEngine: PolicyEngine;
  private queue?: AsyncLedgerQueue;
  private signer?: SignerFn;
  private customFetch: typeof fetch;
  private escalationHandler?: (challenge: PaymentChallenge, ruleHit: string | null) => Promise<boolean>;
  private apiKey?: string;
  private control?: ControlPlane;

  constructor(options: GuardOptions) {
    this.agentId = options.agentId;
    this.customFetch = options.fetchFn || fetch;
    this.signer = options.signer;
    this.escalationHandler = options.escalationHandler;

    const label = "guard";
    const localPolicy = loadPolicyInput(options.policy, label);
    const sink = resolveSink(options.sink);
    this.apiKey = options.apiKey ?? envValue("SPENDLENS_API_KEY");
    const serverUrl = resolveServerUrl(options.serverUrl, sink);
    const remotePolicy =
      Boolean(serverUrl && this.apiKey) && (options.remotePolicy ?? localPolicy === undefined);
    assertMainnetPolicy(label, localPolicy !== undefined, remotePolicy);
    if (isMainnet() && !this.signer) {
      throw new SpendlensError(
        "guard: a `signer` is required on Arc mainnet — the mock signature is testnet-only. " +
          "Pass `signer: createLocalSigner(key)` or your own, or use guardGateway() with Circle's GatewayClient.",
      );
    }

    this.policyEngine = new PolicyEngine(localPolicy ?? PERMISSIVE_POLICY, options.stateStore);

    if (serverUrl && this.apiKey) {
      this.control = new ControlPlane({
        serverUrl,
        apiKey: this.apiKey,
        engine: this.policyEngine,
        remotePolicy,
        failClosed: localPolicy === undefined,
        intervalMs: options.syncIntervalMs,
        fetchFn: this.customFetch,
        label,
      });
      this.control.start();
    }

    if (sink) {
      const control = this.control;
      this.queue = new AsyncLedgerQueue(sink, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
        onResponse: (res) =>
          control?.applyStatus(
            res.status === 423 ? "paused" : res.headers.get("x-spendlens-agent-status"),
          ),
      });
      registerAutoDrain(this.queue);
    }
  }

  /** Re-checks the dashboard now (kill switch + remote policy). */
  public async sync(): Promise<void> {
    await this.control?.sync();
  }

  public getEngine(): PolicyEngine {
    return this.policyEngine;
  }

  /** Flushes any buffered telemetry and stops the background timer. Call
   *  this before your process exits (a short-lived script or CLI agent, the
   *  most common case) — without it, whatever is still sitting in the
   *  queue's debounce window (up to `flushIntervalMs`, including any
   *  `block`/`hold_denied` records from calls that just finished) is lost
   *  silently, since the timer is unref'd specifically so it never keeps a
   *  process alive on its own. */
  public async drain(): Promise<void> {
    this.control?.stop();
    await this.queue?.drainAndStop();
  }

  public setQueue(queue: AsyncLedgerQueue): void {
    this.queue = queue;
  }

  /**
   * Drops in to replace standard `fetch(url, init)` with payment guard interception.
   */
  public async fetch(input: RequestInfo | URL, init?: GuardedRequestInit): Promise<Response> {
    const urlStr = typeof input === "string" ? input : input.toString();
    const taskId = init?.taskId || null;
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    // x402 is a challenge-response protocol: this request may need to go
    // out twice — once to discover whether payment is required (the probe
    // below), and again with a payment header once it is (step 6). A
    // ReadableStream body can only be read once, so the probe would
    // silently consume it and leave the paid retry with nothing to send;
    // buffer it up front so both attempts get their own independent copy.
    // Anything else (string, Blob, ArrayBuffer, URLSearchParams, a plain
    // FormData) is already safe to reuse as-is.
    let requestInit = init;
    if (init?.body instanceof ReadableStream) {
      const buffered = await new Response(init.body).arrayBuffer();
      requestInit = { ...init, body: buffered };
    }

    // Step 1: Initial probe request
    const probe = await this.customFetch(input, requestInit);

    // If not a 402, pass straight through
    if (probe.status !== 402) {
      return probe;
    }

    // Step 2: Parse payment challenge from headers/body
    const probeClone = probe.clone();
    let bodyText = "";
    try {
      bodyText = await probeClone.text();
    } catch {
      // ignore
    }

    const challenge = parsePaymentChallenge(probe.headers, bodyText);
    const amountUsdc = challenge.maxAmountRequired;
    const amountMicroUsdc = Math.round(amountUsdc * 1_000_000);
    if (!this.signer && isMainnet(challenge.chainId)) {
      throw new SpendlensError(
        "guard: refusing to answer an Arc mainnet 402 with the mock signature — pass a real `signer`.",
      );
    }

    // First paid call: pick up the kill switch / dashboard policy first.
    await this.control?.ready();

    // Step 3: Evaluate policy engine
    const evalInput = {
      agentId: this.agentId,
      taskId,
      counterparty: challenge.payTo,
      amount: amountUsdc,
      resource: urlStr,
      now: nowMs,
    };
    const verdict = await this.policyEngine.evaluate(evalInput);
    // Canonical (lowercased) counterparty — what the ledger stores and the
    // reconciliation joins on.
    const counterparty = verdict.counterparty;
    const policyStamp = { policyHash: verdict.policyHash, policyVersion: verdict.policyVersion };

    // Step 4a: Handle BLOCK decision
    if (verdict.decision === "block") {
      const record: AuthorizationRecord = {
        id: generateId(),
        ts: nowIso,
        agentId: this.agentId,
        taskId,
        counterparty,
        resource: urlStr,
        amountMicroUsdc,
        decision: "block",
        ruleHit: verdict.ruleHit,
        nonce: null,
        chainId: challenge.chainId ?? null,
        httpStatus: 402,
        latencyMs: null,
        bodyBytes: null,
        bodySha256: null,
        quality: null,
        settlementId: null,
        createdAt: nowIso,
        ...policyStamp,
      };
      this.queue?.enqueue(record);
      throw new PolicyBlocked(verdict.ruleHit || "unknown_rule", {
        counterparty,
        amountUsdc,
      });
    }

    // Step 4b: Handle HOLD decision
    let finalDecision: "allow" | "hold_approved" = "allow";
    if (verdict.decision === "hold") {
      let approved: boolean;
      let reason: "decided" | "timeout" | "error" = "decided";
      if (this.escalationHandler) {
        approved = await this.escalationHandler(challenge, verdict.ruleHit);
      } else {
        ({ approved, reason } = await requestEscalation(
          verdict.escalation,
          {
            agentId: this.agentId,
            taskId,
            counterparty,
            resource: urlStr,
            amountUsdc,
            ruleHit: verdict.ruleHit,
            nonce: challenge.nonce ?? null,
          },
          { apiKey: this.apiKey, fetchFn: this.customFetch },
        ));
      }

      if (!approved) {
        const record: AuthorizationRecord = {
          id: generateId(),
          ts: nowIso,
          agentId: this.agentId,
          taskId,
          counterparty,
          resource: urlStr,
          amountMicroUsdc,
          decision: "hold_denied",
          ruleHit: verdict.ruleHit,
          nonce: null,
          chainId: challenge.chainId ?? null,
          httpStatus: 402,
          latencyMs: null,
          bodyBytes: null,
          bodySha256: null,
          quality: null,
          settlementId: null,
          createdAt: nowIso,
          ...policyStamp,
        };
        this.queue?.enqueue(record);
        throw new EscalationDenied(reason === "timeout" ? "timeout" : "rejected");
      }
      // Approved → it will be paid, so it counts against every budget.
      this.policyEngine.recordHoldApproved(evalInput);
      finalDecision = "hold_approved";
    }

    // Step 5: Sign authorization (Non-custodial: agent executes signing)
    let authorization: PaymentAuthorization;
    if (this.signer) {
      authorization = await this.signer(challenge);
    } else {
      if (!warnedMockSigner) {
        warnedMockSigner = true;
        console.warn(
          "[spendlens] no `signer` provided — using a MOCK payment signature. " +
            "Policy checks, telemetry and quality analysis work, but the payment " +
            "will not actually settle. Pass `signer: createLocalSigner(privateKey)` " +
            "or your own signer for real payments.",
        );
      }
      authorization = {
        paymentHeader: `Bearer mock_sig_${Math.random().toString(36).slice(2, 10)}`,
        nonce: challenge.nonce || `nonce_${Date.now()}`,
      };
    }

    // Step 6: Send request with payment authorization header
    const authHeaders = new Headers(requestInit?.headers || {});
    authHeaders.set("Authorization", authorization.paymentHeader);
    authHeaders.set("X-Payment-Authorization", authorization.paymentHeader);
    if (authorization.nonce) {
      authHeaders.set("X-Payment-Nonce", authorization.nonce);
    }

    const t0 = Date.now();
    let res: Response;
    let timedOut = false;

    try {
      res = await this.customFetch(input, {
        ...requestInit,
        headers: authHeaders,
      });
    } catch {
      // Network failure, DNS error, or abort — folded into "timeout" since
      // the quality taxonomy has no separate network_error class.
      timedOut = true;
      res = new Response("Gateway Timeout", { status: 504 });
    }

    const latencyMs = Date.now() - t0;

    // Step 7: Classify quality & compute hash (the body itself is never stored!)
    const resClone = res.clone();
    let bodyBytes = 0;
    let bodySha256 = "";
    let responseText = "";
    try {
      responseText = await resClone.text();
      bodyBytes = new TextEncoder().encode(responseText).length;
      bodySha256 = await computeSha256(responseText);
    } catch {
      // empty
    }

    const quality: Quality = classifyQuality(
      {
        timedOut,
        status: res.status,
        bodyBytes,
        latencyMs,
        body: responseText,
      },
      verdict.qualityRules,
    );

    const record: AuthorizationRecord = {
      id: generateId(),
      ts: nowIso,
      agentId: this.agentId,
      taskId,
      counterparty,
      resource: urlStr,
      amountMicroUsdc,
      decision: finalDecision,
      ruleHit: verdict.ruleHit,
      nonce: authorization.nonce || null,
      chainId: challenge.chainId ?? null,
      httpStatus: res.status,
      latencyMs,
      bodyBytes,
      bodySha256,
      quality,
      settlementId: null,
      createdAt: nowIso,
      ...policyStamp,
    };

    this.queue?.enqueue(record);

    return res;
  }
}

/**
 * Factory function for creating a SpendlensGuard instance.
 */
export function guard(options: GuardOptions): SpendlensGuard {
  return new SpendlensGuard(options);
}
