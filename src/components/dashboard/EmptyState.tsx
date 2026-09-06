import Link from "next/link";
import { seedDemoDataAction } from "@/app/dashboard/actions";

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
        <Link
          href="/dashboard/agents/new"
          className="rounded-sm bg-fg px-4 py-2 text-sm font-medium text-bg transition-slens hover:opacity-85"
        >
          Register an agent
        </Link>
        <form action={seedDemoDataAction}>
          <button
            type="submit"
            className="rounded-sm border border-border px-4 py-2 text-sm font-medium text-fg transition-slens hover:bg-surface-2"
          >
            Load sample data
          </button>
        </form>
      </div>
    </div>
  );
}
