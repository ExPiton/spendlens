import type { OverviewStats } from "@/lib/contracts";
import { StatCard } from "./StatCard";
import { StatusDot } from "@/components/ui/StatusPill";
import { reconciliationTone, RECONCILIATION_LABELS } from "@/lib/status";
import {
  formatCount,
  formatPercent,
  formatUsdcPrecise,
  formatUsdcTotal,
} from "@/lib/format";

/**
 * The overview screen shows exactly four numbers — no fifth stat, no chart
 * above them.
 *
 * Naming: "wasted" is money paid for a response that was empty, failed, too
 * slow or off-schema. It used to be called "unmatched", which collided with
 * reconciliation — where a mismatch means chain vs. ledger — right next to it.
 */
export function OverviewStatsRow({ stats }: { stats: OverviewStats }) {
  const notSetUp = stats.reconciledRows === 0;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Total spend" value={formatUsdcTotal(stats.totalSpendMicroUsdc)} sublabel="USDC paid" />
      <StatCard
        label="Wasted"
        value={formatUsdcTotal(stats.wastedMicroUsdc)}
        sublabel={`${formatPercent(stats.wastedRatio)} of spend`}
        tone={stats.wastedRatio > 0.15 ? "critical" : stats.wastedRatio > 0.05 ? "held" : "signal"}
      />
      <StatCard
        label="Blocked"
        value={formatCount(stats.blockedCount)}
        // Not "held" — Spendlens never takes custody of anything. A
        // blocked/hold-denied payment is stopped before it's ever signed,
        // so this is spend that was stopped, not funds sitting somewhere.
        sublabel={`${formatUsdcPrecise(stats.blockedMicroUsdc)} USDC stopped`}
      />
      <StatCard
        label="Reconciliation"
        value={
          notSetUp ? (
            <span className="text-muted">not set up</span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <StatusDot tone={reconciliationTone(stats.reconciliationStatus)} />
              {RECONCILIATION_LABELS[stats.reconciliationStatus]}
            </span>
          )
        }
        tone={notSetUp ? "neutral" : reconciliationTone(stats.reconciliationStatus)}
        sublabel={
          notSetUp
            ? "add the agent's wallet address to compare with Arc"
            : stats.reconciliationDeltaMicroUsdc === 0
              ? "chain and ledger agree"
              : `off by ${formatUsdcPrecise(stats.reconciliationDeltaMicroUsdc)} USDC`
        }
      />
    </div>
  );
}
