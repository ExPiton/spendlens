import Link from "next/link";
import { requireVerifiedUser } from "@/lib/auth/dal";
import {
  getOverviewStats,
  listAgentOptions,
  listAuthorizations,
  getLedgerPeriod,
  ALL_AGENTS,
} from "@/lib/db/repository";
import { OverviewStatsRow } from "@/components/dashboard/OverviewStatsRow";
import { AgentSwitcher } from "@/components/dashboard/AgentSwitcher";
import { WasteCallout } from "@/components/dashboard/WasteCallout";
import { ScenarioRunner } from "@/components/dashboard/ScenarioRunner";
import { InteractiveDecisionsTable } from "@/components/dashboard/InteractiveDecisionsTable";
import { NoAgents } from "@/components/dashboard/EmptyState";
import { formatPeriod } from "@/lib/format";

interface DashboardPageProps {
  searchParams: Promise<{ agentId?: string }>;
}

export default async function DashboardPage(props: DashboardPageProps) {
  const { user } = await requireVerifiedUser();
  const searchParams = await props.searchParams;

  const options = await listAgentOptions(user.id);
  const agentSlugs = options.filter((o) => o.id !== ALL_AGENTS);

  if (agentSlugs.length === 0) {
    return (
      <div className="space-y-8">
        <div className="border-b border-border pb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Welcome to Spendlens
          </h1>
          <p className="mt-1 text-sm text-muted">
            Your oversight layer for AI-agent micropayments on Arc.
          </p>
        </div>
        <NoAgents />
      </div>
    );
  }

  const currentAgentId = searchParams.agentId || agentSlugs[0].id;

  const [stats, ledger, period] = await Promise.all([
    getOverviewStats(user.id, currentAgentId),
    listAuthorizations(user.id, {
      agentId: currentAgentId,
      page: 1,
      pageSize: 12,
    }),
    getLedgerPeriod(user.id),
  ]);

  const { start, end } = period;
  const selectedLabel =
    options.find((o) => o.id === currentAgentId)?.label || currentAgentId;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>Spendlens Dashboard</span>
            <span>•</span>
            <span className="font-mono text-signal">{formatPeriod(start, end)}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            {currentAgentId === ALL_AGENTS
              ? "All agents — spend summary"
              : `${selectedLabel} (${currentAgentId})`}
          </h1>
        </div>

        <AgentSwitcher options={options} currentAgentId={currentAgentId} />
      </div>

      <section aria-label="Key metrics">
        <OverviewStatsRow stats={stats} />
      </section>

      <WasteCallout
        agentName={
          currentAgentId === ALL_AGENTS ? "agents across the fleet" : selectedLabel
        }
        totalSpendMicroUsdc={stats.totalSpendMicroUsdc}
        wastedMicroUsdc={stats.wastedMicroUsdc}
        wastedRatio={stats.wastedRatio}
      />

      {currentAgentId !== ALL_AGENTS && <ScenarioRunner agentId={currentAgentId} />}

      <section className="rounded-md border border-border bg-surface p-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Recent decisions &amp; telemetry
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Every micropayment call the agent made and the policy decision it received.
            </p>
          </div>
          <Link
            href={`/dashboard/ledger${
              currentAgentId !== ALL_AGENTS ? `?agentId=${currentAgentId}` : ""
            }`}
            className="rounded-xs border border-border px-3 py-1.5 text-xs text-muted transition-slens hover:border-fg hover:text-fg"
          >
            View full ledger ({ledger.total} records) →
          </Link>
        </div>

        <div className="mt-4">
          {ledger.records.length > 0 ? (
            <InteractiveDecisionsTable
              records={ledger.records}
              showAgent={currentAgentId === ALL_AGENTS}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted">
              No authorizations recorded yet for this agent. Connect it with the SDK
              using an API key from its{" "}
              <Link
                href={`/dashboard/agents/${currentAgentId}`}
                className="underline hover:text-fg"
              >
                agent page
              </Link>
              .
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
