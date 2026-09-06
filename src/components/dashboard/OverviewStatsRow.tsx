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
 */
export function OverviewStatsRow({ stats }: { stats: OverviewStats }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Total spend" value={formatUsdcTotal(stats.totalSpendMicroUsdc)} sublabel="USDC" />
      <StatCard
        label="Unmatched"
        value={formatUsdcTotal(stats.wastedMicroUsdc)}
        sublabel={formatPercent(stats.wastedRatio)}
        tone={stats.wastedRatio > 0.15 ? "critical" : stats.wastedRatio > 0.05 ? "held" : "signal"}
      />
      <StatCard
        label="Blocked"
        value={formatCount(stats.blockedCount)}
        sublabel={`${formatUsdcPrecise(stats.blockedMicroUsdc)} USDC held`}
      />
      <StatCard
        label="Reconciliation"
        value={
          <span className="inline-flex items-center gap-2">
            <StatusDot tone={reconciliationTone(stats.reconciliationStatus)} />
            {RECONCILIATION_LABELS[stats.reconciliationStatus]}
          </span>
        }
        tone={reconciliationTone(stats.reconciliationStatus)}
        sublabel={`delta ${formatUsdcPrecise(Math.abs(stats.reconciliationDeltaMicroUsdc))}`}
      />
    </div>
  );
}
