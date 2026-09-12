import { PolicyConfig, toPolicyConfig, PolicyFileSchema, type AuthorizationRecord, type Quality } from "@/lib/contracts";
import { classifyQuality } from "@/lib/engine/classifyQuality";
import { PolicyEngine } from "./policy-engine";
import { parsePaymentChallenge, type PaymentChallenge } from "./challenge";
import { AsyncLedgerQueue, registerAutoDrain, type LedgerSink } from "./queue";
import { PolicyBlocked, EscalationDenied } from "./errors";
import { load } from "js-yaml";

export interface PaymentAuthorization {
  paymentHeader: string; // e.g. "Bearer ..." or "Signature ..."
  nonce?: string;
  authorizationToken?: string;
}

export type SignerFn = (challenge: PaymentChallenge) => Promise<PaymentAuthorization>;

export interface GuardOptions {
  agentId: string;
  /**
   * The agent's policy — a YAML string, a preloaded `PolicyConfig`, or omitted
   * for a permissive "record everything, block nothing" default (fine to start
   * with; tighten from the Spendlens dashboard).
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
    webhook: "https://example.com/spendlens-escalation",
    timeoutSeconds: 30,
    onTimeout: "block",
  },
};

function envValue(name: string): string | undefined {
  return typeof process !== "undefined" && process.env
    ? process.env[name]
    : undefined;
}

function resolveSink(explicit: LedgerSink | undefined): LedgerSink | undefined {
  if (explicit) return explicit;
  const url = envValue("SPENDLENS_URL");
  if (!url) return undefined;
  return /\/api\/authorizations\/?$/.test(url)
    ? url
    : url.replace(/\/$/, "") + "/api/authorizations";
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

  constructor(options: GuardOptions) {
    this.agentId = options.agentId;
    this.customFetch = options.fetchFn || fetch;
    this.signer = options.signer;
    this.escalationHandler = options.escalationHandler;

    let config: PolicyConfig;
    if (options.policy === undefined) {
      config = PERMISSIVE_POLICY;
    } else if (typeof options.policy === "string") {
      try {
        const parsed = load(options.policy);
        const validated = PolicyFileSchema.parse(parsed);
        config = toPolicyConfig(validated);
      } catch (err) {
        throw new Error(`Failed to parse policy YAML: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      config = options.policy;
    }

    this.policyEngine = new PolicyEngine(config);

    const sink = resolveSink(options.sink);
    this.apiKey = options.apiKey ?? envValue("SPENDLENS_API_KEY");
    if (sink) {
      this.queue = new AsyncLedgerQueue(sink, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
      });
      registerAutoDrain(this.queue);
    }
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
    const counterparty = challenge.payTo;

    // Step 3: Evaluate policy engine
    const verdict = await this.policyEngine.evaluate({
      agentId: this.agentId,
      taskId,
      counterparty,
      amount: amountUsdc,
      resource: urlStr,
      now: nowMs,
    });

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
      let approved = false;
      if (this.escalationHandler) {
        approved = await this.escalationHandler(challenge, verdict.ruleHit);
      } else if (verdict.escalation.webhook) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), verdict.escalation.timeoutSeconds * 1000);
          const escRes = await this.customFetch(verdict.escalation.webhook, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Spendlens's own /api/escalate requires this — without it
              // every hold silently resolves to "denied" (a 401 response
              // is not `.ok`, so `approved` stays false), which defeats
              // the whole point of the escalation webhook.
              ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
            },
            body: JSON.stringify({
              agentId: this.agentId,
              taskId,
              challenge,
              verdict,
            }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (escRes.ok) {
            const data = (await escRes.json()) as { approved?: boolean };
            approved = data.approved === true;
          }
        } catch {
          approved = verdict.escalation.onTimeout === "allow";
        }
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
        };
        this.queue?.enqueue(record);
        throw new EscalationDenied("rejected");
      }
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
    try {
      const text = await resClone.text();
      bodyBytes = new TextEncoder().encode(text).length;
      bodySha256 = await computeSha256(text);
    } catch {
      // empty
    }

    const quality: Quality = classifyQuality(
      {
        timedOut,
        status: res.status,
        bodyBytes,
        latencyMs,
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
