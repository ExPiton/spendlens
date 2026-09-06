import type { AuthorizationRecord } from "@/lib/contracts";

/**
 * The waste query, as two lines of SQL:
 *   wasted = SUM(amount_usdc WHERE quality <> 'ok' AND decision = 'allow')
 *   ratio  = wasted / SUM(amount_usdc WHERE decision = 'allow')
 * Only paid-and-allowed calls can be "wasted" — a blocked call never spent
 * anything, so it can't count toward the ratio either way.
 */
export function computeWaste(
  records: Pick<AuthorizationRecord, "decision" | "quality" | "amountMicroUsdc">[],
): { wastedMicroUsdc: number; totalAllowedMicroUsdc: number; ratio: number } {
  const allowed = records.filter((r) => r.decision === "allow");
  const totalAllowedMicroUsdc = allowed.reduce(
    (sum, r) => sum + r.amountMicroUsdc,
    0,
  );
  const wastedMicroUsdc = allowed
    .filter((r) => r.quality !== "ok")
    .reduce((sum, r) => sum + r.amountMicroUsdc, 0);
  const ratio =
    totalAllowedMicroUsdc > 0 ? wastedMicroUsdc / totalAllowedMicroUsdc : 0;

  return { wastedMicroUsdc, totalAllowedMicroUsdc, ratio };
}
