import { getOverviewStats, listAuthorizations, getPeriod } from "@/lib/mock";
import { OverviewStatsRow } from "@/components/dashboard/OverviewStatsRow";
import { DecisionsTable } from "@/components/dashboard/DecisionsTable";
import { Logo } from "@/components/brand/Logo";
import { formatPeriod } from "@/lib/format";

/**
 * Renders the actual Overview components against the seeded dataset —
 * not a screenshot. Labeled as a sample, not live, since it's demo data.
 */
export async function LivePreview() {
  const agentId = "research-crawler-01";
  const [stats, ledger] = await Promise.all([
    getOverviewStats(agentId),
    listAuthorizations({ agentId, page: 1, pageSize: 6 }),
  ]);
  const { start, end } = getPeriod();

  return (
    <section id="preview" className="scroll-mt-16 border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-28">
        <div className="max-w-2xl">
          <h2 className="text-3xl leading-tight font-semibold tracking-[-0.025em] sm:text-[2.6rem]">
            Spend, waste and risk: four numbers, then the detail.
          </h2>
          <p className="mt-5 text-muted">
            What your agents paid, how much of it bought nothing, what was stopped, and whether the chain agrees
            with your ledger. Shown here with the real dashboard components on sample data.
          </p>
        </div>

        <div translate="no" className="theme-dark shadow-window mt-14 overflow-hidden rounded-xl border border-border bg-bg text-fg">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
            <div className="flex items-center gap-3">
              <Logo size={22} />
              <span className="text-sm text-muted">{agentId}</span>
            </div>
            <span className="font-mono text-xs text-muted">{formatPeriod(start, end)}</span>
          </div>
          <div className="p-6">
            <OverviewStatsRow stats={stats} />
            <div className="mt-8">
              <p className="mb-3 text-sm font-medium text-muted">Recent decisions</p>
              <DecisionsTable records={ledger.records} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
