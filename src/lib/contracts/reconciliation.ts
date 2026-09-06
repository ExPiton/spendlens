import { z } from "zod";

/**
 * The three-way settlement classification. Note the asymmetry — it's not just
 * "mismatch vs match":
 *   - critical: chain shows MORE than the local ledger → an authorization
 *     exists on-chain that Spendlens never recorded → suspected unauthorized
 *     signature (key leak). This is the scenario the whole product exists
 *     to catch, so it is never silent.
 *   - pending: chain shows LESS than the ledger → allowed authorizations
 *     that haven't reached on-chain settlement yet. Expected/benign lag.
 *   - ok: within tolerance either way.
 */
export const ReconciliationStatusSchema = z.enum(["ok", "pending", "critical"]);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;

export const ReconciliationRecordSchema = z.object({
  counterparty: z.string(),
  periodStart: z.string().datetime({ offset: true }),
  periodEnd: z.string().datetime({ offset: true }),
  chainAmountMicroUsdc: z.number().int(),
  ledgerAmountMicroUsdc: z.number().int(),
  deltaMicroUsdc: z.number().int(),
  toleranceMicroUsdc: z.number().int().nonnegative(),
  status: ReconciliationStatusSchema,
  settlementId: z.string().nullable(),
});
export type ReconciliationRecord = z.infer<typeof ReconciliationRecordSchema>;
