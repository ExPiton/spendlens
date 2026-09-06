import { listAuthorizations, listAgentOptions, ALL_AGENTS } from "@/lib/db/repository";
import { requireVerifiedUser } from "@/lib/auth/dal";
import { NoAgents } from "@/components/dashboard/EmptyState";
import { AgentSwitcher } from "@/components/dashboard/AgentSwitcher";
import { InteractiveDecisionsTable } from "@/components/dashboard/InteractiveDecisionsTable";

interface AnomaliesPageProps {
  searchParams: Promise<{ agentId?: string }>;
}

export default async function AnomaliesPage(props: AnomaliesPageProps) {
  const { user } = await requireVerifiedUser();
  const searchParams = await props.searchParams;

  const options = await listAgentOptions(user.id);
  if (options.length <= 1) {
    return (
      <div className="space-y-6">
        <div className="border-b border-border pb-6">
          <h1 className="text-2xl font-bold tracking-tight">Anomaly &amp; rate monitoring</h1>
        </div>
        <NoAgents />
      </div>
    );
  }

  const agentId =
    searchParams.agentId ||
    options.find((o) => o.id !== ALL_AGENTS)?.id ||
    ALL_AGENTS;

  const incidentData = await listAuthorizations(user.id, {
    agentId,
    decision: "block",
    pageSize: 20,
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-6">
        <div>
          <span className="text-xs text-muted uppercase tracking-wider font-semibold">
            Security Layer — Anomaly Detection
          </span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Anomaly &amp; Burn-Rate Monitoring</h1>
          <p className="mt-1 text-xs text-muted">
            Behavioral anomaly detection with an exponentially weighted moving average (EWMA), catching redirection attacks.
          </p>
        </div>

        <AgentSwitcher options={options} currentAgentId={agentId} />
      </div>

      {/* 3 Core Signals */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xs border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold text-signal">Signal 1</span>
            <span className="rounded-xs bg-signal/10 px-2 py-0.5 font-mono text-[10px] text-signal">
              z-threshold: 3.0
            </span>
          </div>
          <h3 className="mt-2 font-semibold text-sm">Burn Rate</h3>
          <p className="mt-1 text-xs text-muted">
            USDC spent per unit of time. Catches prompt-injection and sudden-loop attacks (Scenario A) instantly.
          </p>
          <div className="mt-4 rounded-xs bg-surface-2 p-2 font-mono text-[11px] text-muted">
            z = (x_t - &mu;_(t-1)) / &sigma;_(t-1)
          </div>
        </div>

        <div className="rounded-xs border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold text-held">Signal 2</span>
            <span className="rounded-xs bg-held/10 px-2 py-0.5 font-mono text-[10px] text-held">
              max: 5 / hour
            </span>
          </div>
          <h3 className="mt-2 font-semibold text-sm">New Counterparty Rate</h3>
          <p className="mt-1 text-xs text-muted">
            Number of addresses and domains first seen per hour. Catches attempts to redirect the agent to unknown addresses.
          </p>
          <div className="mt-4 rounded-xs bg-surface-2 p-2 font-mono text-[11px] text-muted">
            first_seen_velocity &gt; 5/hr &rarr; Alert
          </div>
        </div>

        <div className="rounded-xs border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold text-signal">Signal 3</span>
            <span className="rounded-xs bg-signal/10 px-2 py-0.5 font-mono text-[10px] text-signal">
              Distribution Analysis
            </span>
          </div>
          <h3 className="mt-2 font-semibold text-sm">Counterparty Entropy</h3>
          <p className="mt-1 text-xs text-muted">
            How spend is distributed across addresses. Flags sudden concentration on a single address and leak patterns.
          </p>
          <div className="mt-4 rounded-xs bg-surface-2 p-2 font-mono text-[11px] text-muted">
            Entropy check &rarr; Baseline divergence
          </div>
        </div>
      </div>

      {/* Cold Start / Warmup Status */}
      <div className="rounded-md border border-border bg-surface p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Cold Start &amp; Warmup Window</h3>
            <p className="mt-0.5 text-xs text-muted">
              A warmup mechanism that prevents false alarms on first run, when there&apos;s no history yet.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xs border border-signal/20 bg-signal/10 px-3 py-1 font-mono text-xs text-signal">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            Warmup Complete (Active Protection)
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs font-mono">
          <div className="rounded-xs bg-surface-2 p-3">
            <span className="text-muted block">Warmup Threshold 1:</span>
            <span className="font-bold text-fg">First 200 Authorizations</span>
            <p className="text-[11px] text-muted mt-1 font-sans">
              Until the agent reaches 200 calls, anomaly rules only log — they don&apos;t block.
            </p>
          </div>
          <div className="rounded-xs bg-surface-2 p-3">
            <span className="text-muted block">Warmup Threshold 2:</span>
            <span className="font-bold text-fg">First 30 Minutes</span>
            <p className="text-[11px] text-muted mt-1 font-sans">
              The minimum time needed for the time-based statistical baseline to settle.
            </p>
          </div>
        </div>
      </div>

      {/* Incident Detections Table */}
      <div className="rounded-md border border-border bg-surface p-6">
        <div className="border-b border-border pb-4">
          <h3 className="text-sm font-semibold">Detected Anomalies &amp; Blocked Security Events</h3>
          <p className="mt-0.5 text-xs text-muted">
            Suspicious calls blocked by the policy filter and anomaly detection.
          </p>
        </div>
        <div className="mt-4">
          <InteractiveDecisionsTable
            records={incidentData.records}
            showAgent={agentId === ALL_AGENTS}
          />
        </div>
      </div>
    </div>
  );
}
