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
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <p className="text-xs font-medium tracking-[0.14em] text-muted uppercase">
            Sample dashboard
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Four numbers. Then quiet.
          </h2>
          <p className="mt-4 text-muted">
            The screen below is rendered with the dashboard&rsquo;s real
            components on a sample dataset — not a static image.
          </p>
        </div>

        <div className="theme-dark mt-10 overflow-hidden rounded-md border border-border bg-bg text-fg">
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
              <p className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">
                Recent decisions
              </p>
              <DecisionsTable records={ledger.records} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
