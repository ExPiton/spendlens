import type { AuthorizationRecord } from "@/lib/contracts";
import { isSpendDecision } from "./reconciliation";

/**
 * The waste query, as two lines of SQL:
 *   wasted = SUM(amount_usdc WHERE quality <> 'ok' AND decision IN ('allow','hold_approved'))
 *   ratio  = wasted / SUM(amount_usdc WHERE decision IN ('allow','hold_approved'))
 * Only calls that were actually paid can be "wasted" — a blocked or denied
 * call never spent anything, so it can't count toward the ratio either way.
 * An approved hold did spend, so it counts exactly like an `allow`.
 */
export function computeWaste(
  records: Pick<AuthorizationRecord, "decision" | "quality" | "amountMicroUsdc">[],
): { wastedMicroUsdc: number; totalAllowedMicroUsdc: number; ratio: number } {
  const spent = records.filter((r) => isSpendDecision(r.decision));
  const totalAllowedMicroUsdc = spent.reduce(
    (sum, r) => sum + r.amountMicroUsdc,
    0,
  );
  const wastedMicroUsdc = spent
    .filter((r) => r.quality !== "ok")
    .reduce((sum, r) => sum + r.amountMicroUsdc, 0);
  const ratio =
    totalAllowedMicroUsdc > 0 ? wastedMicroUsdc / totalAllowedMicroUsdc : 0;

  return { wastedMicroUsdc, totalAllowedMicroUsdc, ratio };
}
