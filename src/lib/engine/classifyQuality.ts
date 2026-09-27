import type { Quality } from "@/lib/contracts";

export interface QualityCheckInput {
  timedOut: boolean;
  status: number;
  bodyBytes: number;
  latencyMs: number;
  /** The response body text — only read by `validateSchema`, never stored. */
  body?: string;
}

export interface QualityRules {
  failureStatusCodes: number[];
  emptyBodyIsFailure: boolean;
  maxLatencyMs: number;
  /**
   * Validates the response body against `quality.json_schema` (compiled by
   * `bodyValidatorFor` in `./schema-check`). Omitted entirely (no
   * `json_schema` configured) means every body passes.
   */
  validateSchema?: (body: string) => boolean;
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
  if (rules.validateSchema && res.body !== undefined && !rules.validateSchema(res.body)) {
    return "schema_fail";
  }
  if (res.latencyMs > rules.maxLatencyMs) return "slow";
  return "ok";
}
