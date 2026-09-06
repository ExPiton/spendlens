import { requireVerifiedUser } from "@/lib/auth/dal";
import { listAgentOptions, ALL_AGENTS } from "@/lib/db/repository";
import { getPolicyBySlug } from "@/lib/db/policy";
import { AgentSwitcher } from "@/components/dashboard/AgentSwitcher";
import { PolicyViewer } from "@/components/dashboard/PolicyViewer";
import { NoAgents } from "@/components/dashboard/EmptyState";

interface PoliciesPageProps {
  searchParams: Promise<{ agentId?: string }>;
}

export default async function PoliciesPage(props: PoliciesPageProps) {
  const { user } = await requireVerifiedUser();
  const searchParams = await props.searchParams;
  const options = await listAgentOptions(user.id);
  const agentOptions = options.filter((o) => o.id !== ALL_AGENTS);

  if (agentOptions.length === 0) {
    return (
      <div className="space-y-6">
        <div className="border-b border-border pb-6">
          <h1 className="text-2xl font-bold tracking-tight">Policy configuration</h1>
        </div>
        <NoAgents />
      </div>
    );
  }

  const validAgentId =
    searchParams.agentId &&
    agentOptions.some((o) => o.id === searchParams.agentId)
      ? searchParams.agentId
      : agentOptions[0].id;

  const policy = await getPolicyBySlug(user.id, validAgentId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            Declarative Policy Engine
          </span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            Policy File &amp; Rule Configuration
          </h1>
          <p className="mt-1 text-xs text-muted">
            Rules aren&apos;t hardcoded; they&apos;re stored per agent and versioned on every save.
          </p>
        </div>

        <AgentSwitcher options={agentOptions} currentAgentId={validAgentId} />
      </div>

      {policy ? (
        <PolicyViewer
          agentId={validAgentId}
          initialYaml={policy.raw}
          config={policy.config}
        />
      ) : (
        <div className="rounded-md border border-border bg-surface p-12 text-center text-muted">
          No policy file has been defined for this agent yet.
        </div>
      )}
    </div>
  );
}
