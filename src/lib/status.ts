import type { Decision, Quality, ReconciliationStatus } from "@/lib/contracts";

/**
 * Color is a data type, not decoration. Three tones only — signal (ok/
 * allow), held (pending/waiting), critical (blocked/failed) — plus neutral
 * for "no verdict applies here." Every place a status renders in the app
 * goes through this file so the mapping only exists once.
 */
export type StatusTone = "signal" | "held" | "critical" | "neutral";

export function decisionTone(decision: Decision): StatusTone {
  switch (decision) {
    case "allow":
      return "signal";
    case "hold_approved":
      return "held";
    case "hold_denied":
    case "block":
      return "critical";
  }
}

export function qualityTone(quality: Quality | null): StatusTone {
  if (quality === null) return "neutral";
  if (quality === "ok") return "signal";
  if (quality === "slow") return "held";
  return "critical";
}

export function reconciliationTone(status: ReconciliationStatus): StatusTone {
  switch (status) {
    case "ok":
      return "signal";
    case "pending":
      return "held";
    case "critical":
      return "critical";
  }
}

export const DECISION_LABELS: Record<Decision, string> = {
  allow: "allowed",
  block: "blocked",
  hold_approved: "held · approved",
  hold_denied: "held · denied",
};

export const QUALITY_LABELS: Record<Quality, string> = {
  ok: "ok",
  empty: "empty body",
  http_error: "http error",
  schema_fail: "schema error",
  timeout: "timeout",
  slow: "slow",
};

export const RECONCILIATION_LABELS: Record<ReconciliationStatus, string> = {
  ok: "ok",
  pending: "pending",
  critical: "critical",
};

/**
 * An allow decision with bad quality shows "quality: empty" in place of a
 * rule hit rather than a blank cell — the two never appear together since a
 * rule hit only exists when a rule *acted* on the call, and a completed
 * allow call has no such rule.
 */
export function noteFor(decision: Decision, ruleHit: string | null, quality: Quality | null): string | null {
  if (ruleHit) return ruleHit;
  if (decision === "allow" && quality && quality !== "ok") return `quality: ${quality}`;
  return null;
}
