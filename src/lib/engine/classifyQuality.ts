import type { Quality } from "@/lib/contracts";

export interface QualityCheckInput {
  timedOut: boolean;
  status: number;
  bodyBytes: number;
  latencyMs: number;
}

export interface QualityRules {
  failureStatusCodes: number[];
  emptyBodyIsFailure: boolean;
  maxLatencyMs: number;
  /**
   * Validates the response body against `quality.json_schema`. Schema
   * validation needs the actual compiled schema, which lives outside a
   * pure function — callers inject the check; omitted entirely (no
   * `json_schema` configured) means every body passes.
   */
  validateSchema?: (bodyBytes: number) => boolean;
}

/**
 * `classifyQuality(res, rules)`. Precedence order is load-bearing —
 * timeout beats a stale status code, an empty body beats a schema check
 * that would otherwise reject it for other reasons, and so on.
 */
export function classifyQuality(
  res: QualityCheckInput,
  rules: QualityRules,
): Quality {
  if (res.timedOut) return "timeout";
  if (rules.failureStatusCodes.includes(res.status)) return "http_error";
  if (rules.emptyBodyIsFailure && res.bodyBytes === 0) return "empty";
  if (rules.validateSchema && !rules.validateSchema(res.bodyBytes)) {
    return "schema_fail";
  }
  if (res.latencyMs > rules.maxLatencyMs) return "slow";
  return "ok";
}
