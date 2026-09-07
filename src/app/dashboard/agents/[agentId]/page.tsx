import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVerifiedUser } from "@/lib/auth/dal";
import { getAgent, listAuthorizations } from "@/lib/db/repository";
import { getAgentRecordBySlug } from "@/lib/db/agents";
import { getPolicyBySlug } from "@/lib/db/policy";
import { listApiKeys } from "@/lib/db/api-keys";
import { StatCard } from "@/components/dashboard/StatCard";
import { WasteCallout } from "@/components/dashboard/WasteCallout";
import { InteractiveDecisionsTable } from "@/components/dashboard/InteractiveDecisionsTable";
import { ApiKeysPanel } from "@/components/dashboard/ApiKeysPanel";
import { AgentControls } from "@/components/dashboard/AgentControls";
import {
  formatUsdcTotal,
  formatPercent,
  formatCount,
  formatDateTime,
} from "@/lib/format";

interface AgentDetailPageProps {
  params: Promise<{ agentId: string }>;
}

export default async function AgentDetailPage(props: AgentDetailPageProps) {
  const { user } = await requireVerifiedUser();
  const { agentId: slug } = await props.params;

  const [agent, record, policy, ledger] = await Promise.all([
    getAgent(user.id, slug),
    getAgentRecordBySlug(user.id, slug),
    getPolicyBySlug(user.id, slug),
    listAuthorizations(user.id, { agentId: slug, page: 1, pageSize: 15 }),
  ]);

  if (!agent || !record) notFound();

  const keys = await listApiKeys(user.id, record.id);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const ingestUrl = `${appUrl}/api/authorizations`;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Link href="/dashboard/agents" className="hover:text-fg">
              ← Agent Fleet
            </Link>
            <span>•</span>
            <span className="font-mono">{agent.agentId}</span>
            <span
              className={`rounded-xs px-1.5 py-0.5 font-mono text-[10px] ${
                record.status === "paused"
                  ? "bg-critical/15 text-critical"
                  : "bg-signal/15 text-signal"
              }`}
            >
              {record.status === "paused" ? "PAUSED" : "ACTIVE"}
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            {agent.label}
          </h1>
          <p className="mt-0.5 font-mono text-xs text-muted">
            Last activity:{" "}
            {agent.lastActivityTs ? formatDateTime(agent.lastActivityTs) : "—"}
          </p>
        </div>

        <AgentControls
          agentId={record.id}
          slug={agent.agentId}
          label={agent.label}
          status={record.status}
        />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Spend"
          value={formatUsdcTotal(agent.totalSpendMicroUsdc)}
          sublabel="USDC"
        />
        <StatCard
          label="Unmatched Spend"
          value={formatUsdcTotal(agent.wastedMicroUsdc)}
          sublabel={formatPercent(agent.wastedRatio)}
          tone={agent.wastedRatio > 0.15 ? "critical" : "signal"}
        />
        <StatCard
          label="Blocked Calls"
          value={formatCount(agent.blockedCount)}
          sublabel={`${formatCount(agent.allowedCount)} successful calls`}
          tone={agent.blockedCount > 0 ? "critical" : "neutral"}
        />
        <StatCard
          label="Counterparties Reached"
          value={formatCount(agent.counterpartyCount)}
          sublabel="Distinct APIs & contracts"
        />
      </div>

      {agent.totalSpendMicroUsdc > 0 && (
        <WasteCallout
          agentName={agent.label}
          totalSpendMicroUsdc={agent.totalSpendMicroUsdc}
          wastedMicroUsdc={agent.wastedMicroUsdc}
          wastedRatio={agent.wastedRatio}
        />
      )}

      {/* API keys */}
      <ApiKeysPanel
        agentId={record.id}
        slug={agent.agentId}
        keys={keys}
        ingestUrl={ingestUrl}
        appUrl={appUrl}
      />

      {/* Policy snippet */}
      {policy && (
        <div className="rounded-md border border-border bg-surface p-6">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="text-sm font-semibold">Active Policy Limits</h3>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-muted">v{policy.version}</span>
              <Link
                href={`/dashboard/policies?agentId=${agent.agentId}`}
                className="rounded-xs border border-border px-2.5 py-1 text-xs text-muted transition-slens hover:border-fg hover:text-fg"
              >
                Edit policy →
              </Link>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 font-mono text-xs sm:grid-cols-4">
            <div>
              <span className="block text-muted">Task budget</span>
              <span className="font-semibold">
                {policy.config.budgets.find((b) => b.scope === "task")?.limitUsdc ??
                  "—"}{" "}
                USDC
              </span>
            </div>
            <div>
              <span className="block text-muted">Hourly budget</span>
              <span className="font-semibold">
                {policy.config.budgets.find((b) => b.scope === "hour")?.limitUsdc ??
                  "—"}{" "}
                USDC
              </span>
            </div>
            <div>
              <span className="block text-muted">Per-call limit</span>
              <span className="font-semibold">
                {policy.config.perCall.maxUsdc} USDC
              </span>
            </div>
            <div>
              <span className="block text-muted">Counterparty mode</span>
              <span className="font-semibold text-signal">
                {policy.config.counterparties.mode}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Recent decisions */}
      <div className="rounded-md border border-border bg-surface p-6">
        <div className="border-b border-border pb-4">
          <h3 className="text-sm font-semibold">Recent Decisions &amp; Telemetry</h3>
          <p className="mt-0.5 text-xs text-muted">
            The most recent calls made by {agent.label}.
          </p>
        </div>
        <div className="mt-4">
          {ledger.records.length > 0 ? (
            <InteractiveDecisionsTable records={ledger.records} />
          ) : (
            <p className="py-8 text-center text-sm text-muted">
              No calls recorded yet. Point the SDK at an API key above to start the
              ledger.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
