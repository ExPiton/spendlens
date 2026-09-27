import { z } from "zod";

/** The persisted, post-resolution outcome of an authorization. */
export const DecisionSchema = z.enum([
  "allow",
  "block",
  "hold_approved",
  "hold_denied",
]);
export type Decision = z.infer<typeof DecisionSchema>;

/**
 * `classifyQuality()` has six return paths (timeout, http_error, empty,
 * schema_fail, slow, ok) — the function is the authoritative source since
 * it's the actual implementation, so "slow" is kept here alongside the
 * other five.
 */
export const QualitySchema = z.enum([
  "ok",
  "empty",
  "http_error",
  "schema_fail",
  "timeout",
  "slow",
]);
export type Quality = z.infer<typeof QualitySchema>;

/**
 * Mirrors `CREATE TABLE authorizations` field for field.
 *
 * Amounts are stored as integer micro-USDC (1 = 0.000001 USDC — Nanopayments'
 * own smallest unit) rather than floating point USDC, since float
 * accumulation drifts over enough additions — a fixed-point decimal type is
 * required for anything that sums payment amounts.
 */
export const AuthorizationRecordSchema = z.object({
  id: z.string(),
  ts: z.string().datetime({ offset: true }),
  agentId: z.string(),
  taskId: z.string().nullable(),
  counterparty: z.string(),
  resource: z.string(),
  amountMicroUsdc: z.number().int().nonnegative(),
  decision: DecisionSchema,
  ruleHit: z.string().nullable(),
  nonce: z.string().nullable(),
  chainId: z.number().int().nullable(),
  httpStatus: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  bodyBytes: z.number().int().nullable(),
  bodySha256: z.string().nullable(),
  quality: QualitySchema.nullable(),
  settlementId: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  /** SHA-256 of the canonical JSON of the policy this decision was evaluated
   *  against (`policyHash()` in `@/lib/policy-hash`). Ties every ledger row
   *  to the exact rule set that produced it — a tampered or swapped policy
   *  file shows up as a hash nobody published. Optional so records from SDKs
   *  that predate it still validate. */
  policyHash: z.string().nullable().optional(),
  /** The dashboard's version number for that policy, when the SDK got it
   *  from the server (remote policy sync); null for a purely local policy. */
  policyVersion: z.number().int().nullable().optional(),
});
export type AuthorizationRecord = z.infer<typeof AuthorizationRecordSchema>;
