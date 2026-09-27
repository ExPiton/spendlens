import type {
  AuthorizationRecord,
  Decision,
  ReconciliationStatus,
} from "@/lib/contracts";
import { normalizeCounterparty } from "@/lib/counterparty";

/**
 * The decisions that actually moved money: a plain `allow`, and a `hold`
 * that a human (or the auto-approve ceiling) then approved. Both were
 * signed, so both reach Arc settlement — leaving `hold_approved` out of the
 * ledger side made every approved hold look like an unrecorded on-chain
 * payment (a false "critical"). `block` / `hold_denied` never got signed.
 */
export const SPEND_DECISIONS: readonly Decision[] = ["allow", "hold_approved"];

export function isSpendDecision(decision: Decision): boolean {
  return decision === "allow" || decision === "hold_approved";
}

/**
 * Classifies the gap between what Arc settled on-chain and what the local
 * ledger recorded as spent. The asymmetry is the point — see the comment
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
 * The local side of the comparison — the sum of spend decisions (`allow` +
 * `hold_approved`) for one counterparty within one settlement period,
 * optionally narrowed to one agent and one Arc chain. Counterparties are
 * compared case-insensitively (see `normalizeCounterparty`).
 */
export function sumSpentLedgerAmount(
  records: (Pick<
    AuthorizationRecord,
    "counterparty" | "decision" | "amountMicroUsdc" | "ts"
  > &
    Partial<Pick<AuthorizationRecord, "agentId" | "chainId">>)[],
  counterparty: string,
  periodStart: string,
  periodEnd: string,
  scope: { agentId?: string; chainId?: number } = {},
): number {
  const cp = normalizeCounterparty(counterparty);
  const start = Date.parse(periodStart);
  const end = Date.parse(periodEnd);
  return records
    .filter((r) => {
      const ts = Date.parse(r.ts);
      return (
        normalizeCounterparty(r.counterparty) === cp &&
        isSpendDecision(r.decision) &&
        ts >= start &&
        ts < end &&
        (scope.agentId === undefined || r.agentId === scope.agentId) &&
        (scope.chainId === undefined || r.chainId === scope.chainId)
      );
    })
    .reduce((sum, r) => sum + r.amountMicroUsdc, 0);
}
