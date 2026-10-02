import { seedDemoDataAction } from "@/app/dashboard/actions";
import { Button, LinkButton } from "@/components/ui/Button";

/** Shown on every data screen until the tenant has at least one agent. */
export function NoAgents({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`rounded-md border border-border bg-surface p-8 text-center ${
        compact ? "" : "sm:p-12"
      }`}
    >
      <h2 className="text-lg font-semibold">No agents yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        Register an agent to start overseeing its spend, or load the sample dataset
        to explore every screen with realistic data first.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <LinkButton href="/dashboard/agents/new">Register an agent</LinkButton>
        <form action={seedDemoDataAction}>
          <Button type="submit" variant="secondary">
            Load sample data
          </Button>
        </form>
      </div>
    </div>
  );
}
