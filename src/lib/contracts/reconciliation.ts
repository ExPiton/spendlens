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

/**
 * One row per (agent, Arc network, counterparty): an agent's wallet is what
 * Circle Gateway reports transfers for, so the chain side is inherently
 * per-wallet, and testnet/mainnet settlements must never be summed against
 * each other. `agentId` is the agent slug; `chainId` the Arc chain id.
 */
export const ReconciliationRecordSchema = z.object({
  agentId: z.string().nullable(),
  chainId: z.number().int().nullable(),
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
