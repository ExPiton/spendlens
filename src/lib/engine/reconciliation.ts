import type {
  AuthorizationRecord,
  ReconciliationStatus,
} from "@/lib/contracts";

/**
 * Classifies the gap between what Arc settled on-chain and what the local
 * ledger recorded as allowed. The asymmetry is the point — see the comment
 * on `ReconciliationStatusSchema` for why chain-ahead (critical) and
 * ledger-ahead (pending) are not treated the same.
 */
export function classifyReconciliation(
  chainAmountMicroUsdc: number,
  ledgerAmountMicroUsdc: number,
  toleranceMicroUsdc: number,
): { deltaMicroUsdc: number; status: ReconciliationStatus } {
  const deltaMicroUsdc = chainAmountMicroUsdc - ledgerAmountMicroUsdc;
  if (deltaMicroUsdc > toleranceMicroUsdc) {
    return { deltaMicroUsdc, status: "critical" };
  }
  if (deltaMicroUsdc < -toleranceMicroUsdc) {
    return { deltaMicroUsdc, status: "pending" };
  }
  return { deltaMicroUsdc, status: "ok" };
}

/**
 * The local side of the comparison — sum of `allow` decisions for one
 * counterparty within one settlement period. Only `allow` counts; blocked
 * and denied-hold authorizations never reached the chain.
 */
export function sumAllowedLedgerAmount(
  records: Pick<
    AuthorizationRecord,
    "counterparty" | "decision" | "amountMicroUsdc" | "ts"
  >[],
  counterparty: string,
  periodStart: string,
  periodEnd: string,
): number {
  return records
    .filter(
      (r) =>
        r.counterparty === counterparty &&
        r.decision === "allow" &&
        r.ts >= periodStart &&
        r.ts < periodEnd,
    )
    .reduce((sum, r) => sum + r.amountMicroUsdc, 0);
}
