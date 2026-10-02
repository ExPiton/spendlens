import { listAgentOptions, ALL_AGENTS } from "@/lib/db/repository";
import { requireVerifiedUser } from "@/lib/auth/dal";
import { NoAgents } from "@/components/dashboard/EmptyState";
import { AgentSwitcher } from "@/components/dashboard/AgentSwitcher";
import { SimulatorSandbox } from "@/components/dashboard/SimulatorSandbox";

export const metadata = { title: "Simulator" };

interface SimulatorPageProps {
  searchParams: Promise<{ agentId?: string }>;
}

export default async function SimulatorPage(props: SimulatorPageProps) {
  const { user } = await requireVerifiedUser();
  const searchParams = await props.searchParams;

  // The simulator runs the policy engine against one concrete agent's real
  // policy — "All agents" isn't a valid target the way it is on the other
  // dashboard screens, so it's filtered out of the picker entirely.
  const options = (await listAgentOptions(user.id)).filter((o) => o.id !== ALL_AGENTS);

  if (options.length === 0) {
    return (
      <div className="space-y-6">
        <div className="border-b border-border pb-6">
          <span className="text-xs font-semibold tracking-wider text-muted uppercase">
            Simulator
          </span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            What would your policy do?
          </h1>
        </div>
        <NoAgents />
      </div>
    );
  }

  const agentId =
    searchParams.agentId && options.some((o) => o.id === searchParams.agentId)
      ? searchParams.agentId
      : options[0].id;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs font-semibold tracking-wider text-muted uppercase">
            Simulator
          </span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            What would your policy do?
          </h1>
          <p className="mt-1 text-xs text-muted">
            Runs <span className="font-mono">{agentId}</span>&rsquo;s saved policy through the real policy engine,
            starting from empty budgets. Nothing is signed, paid or saved.
          </p>
        </div>
        <AgentSwitcher options={options} currentAgentId={agentId} />
      </div>

      <SimulatorSandbox agentId={agentId} />
    </div>
  );
}
