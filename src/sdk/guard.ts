import { PolicyConfig, toPolicyConfig, PolicyFileSchema, type AuthorizationRecord, type Quality } from "@/lib/contracts";
import { classifyQuality } from "@/lib/engine/classifyQuality";
import { PolicyEngine } from "./policy-engine";
import { parsePaymentChallenge, type PaymentChallenge } from "./challenge";
import { AsyncLedgerQueue, type LedgerSink } from "./queue";
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
  policy: string | PolicyConfig; // File path / YAML string or preloaded PolicyConfig
  sink?: LedgerSink;
  /** Bearer token for a hosted Spendlens ingest endpoint. Sent as
   *  `Authorization: Bearer <apiKey>` with every telemetry POST. Ignored when
   *  `sink` is not a URL string. */
  apiKey?: string;
  signer?: SignerFn;
  fetchFn?: typeof fetch;
  escalationHandler?: (challenge: PaymentChallenge, ruleHit: string | null) => Promise<boolean>;
}

export interface GuardedRequestInit extends RequestInit {
  taskId?: string;
}

async function computeSha256(text: string): Promise<string> {
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback simple hash for older environments
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, "0");
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

  constructor(options: GuardOptions) {
    this.agentId = options.agentId;
    this.customFetch = options.fetchFn || fetch;
    this.signer = options.signer;
    this.escalationHandler = options.escalationHandler;

    let config: PolicyConfig;
    if (typeof options.policy === "string") {
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

    if (options.sink) {
      this.queue = new AsyncLedgerQueue(options.sink, {
        headers: options.apiKey
          ? { Authorization: `Bearer ${options.apiKey}` }
          : undefined,
      });
    }
  }

  public getEngine(): PolicyEngine {
    return this.policyEngine;
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

    // Step 1: Initial probe request
    const probe = await this.customFetch(input, init);

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
            headers: { "Content-Type": "application/json" },
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
    let authorization: PaymentAuthorization = {
      paymentHeader: `Bearer mock_sig_${Math.random().toString(36).slice(2, 10)}`,
      nonce: challenge.nonce || `nonce_${Date.now()}`,
    };

    if (this.signer) {
      authorization = await this.signer(challenge);
    }

    // Step 6: Send request with payment authorization header
    const authHeaders = new Headers(init?.headers || {});
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
        ...init,
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
