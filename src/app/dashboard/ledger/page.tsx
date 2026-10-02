import { listAuthorizations, listAgentOptions, ALL_AGENTS } from "@/lib/db/repository";
import { requireVerifiedUser } from "@/lib/auth/dal";
import { InteractiveDecisionsTable } from "@/components/dashboard/InteractiveDecisionsTable";
import { AgentSwitcher } from "@/components/dashboard/AgentSwitcher";
import { LedgerSearchBox } from "@/components/dashboard/LedgerSearchBox";
import { NoAgents } from "@/components/dashboard/EmptyState";
import type { Decision, Quality } from "@/lib/contracts";
import Link from "next/link";
import { listDigests } from "@/lib/digest";
import { LedgerIntegrity } from "@/components/dashboard/LedgerIntegrity";
import { ARC } from "@/lib/arc";

export const metadata = { title: "Ledger" };

interface LedgerPageProps {
  searchParams: Promise<{
    agentId?: string;
    decision?: Decision;
    quality?: Quality | "any";
    search?: string;
    page?: string;
  }>;
}

export default async function LedgerPage(props: LedgerPageProps) {
  const { user } = await requireVerifiedUser();
  const searchParams = await props.searchParams;
  const agentId = searchParams.agentId || ALL_AGENTS;
  const decision = searchParams.decision || undefined;
  const quality = searchParams.quality || undefined;
  const search = searchParams.search || undefined;
  // `?page=abc` parsed to NaN and went straight into the query's OFFSET.
  const page = Math.max(1, Number.parseInt(searchParams.page || "1", 10) || 1);
  const pageSize = 30;

  const [options, data, digests] = await Promise.all([
    listAgentOptions(user.id),
    listAuthorizations(user.id, {
      agentId,
      decision,
      quality,
      search,
      page,
      pageSize,
    }),
    listDigests(user.id, 7).catch(() => []),
  ]);

  if (options.length <= 1) {
    return (
      <div className="space-y-6">
        <div className="border-b border-border pb-6">
          <h1 className="text-2xl font-bold tracking-tight">Event ledger</h1>
        </div>
        <NoAgents />
      </div>
    );
  }

  const totalPages = Math.ceil(data.total / pageSize);

  function createFilterUrl(newParams: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    if (agentId && agentId !== ALL_AGENTS) params.set("agentId", agentId);
    if (decision) params.set("decision", decision);
    if (quality && quality !== "any") params.set("quality", quality);
    if (search) params.set("search", search);

    for (const [k, v] of Object.entries(newParams)) {
      if (v === undefined || v === "" || v === "all" || v === "any") {
        params.delete(k);
      } else {
        params.set(k, v);
      }
    }
    return `/dashboard/ledger?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-6">
        <div>
          <span className="text-xs text-muted uppercase tracking-wider font-semibold">
            Ledger
          </span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Every payment decision</h1>
          <p className="mt-1 max-w-3xl text-xs text-muted">
            Allowed, held and blocked calls, append-only. Response bodies are never stored, only their size and a
            SHA-256 digest. Times are UTC.
          </p>
        </div>

        <AgentSwitcher options={options} currentAgentId={agentId} />
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xs border border-border bg-surface p-4 text-xs">
        {/* Decision Filter */}
        <div role="group" aria-labelledby="filter-decision" className="flex flex-wrap items-center gap-2">
          <span id="filter-decision" className="text-muted">Decision:</span>
          <div className="flex flex-wrap gap-1">
            {[
              { id: undefined, label: "All" },
              { id: "allow", label: "Allow" },
              { id: "block", label: "Block" },
              { id: "hold_approved", label: "Approved" },
              { id: "hold_denied", label: "Denied" },
            ].map((item) => {
              const active = decision === item.id || (!decision && item.id === undefined);
              return (
                <Link
                  key={item.label}
                  href={createFilterUrl({ decision: item.id, page: "1" })}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-xs px-2 py-1.5 transition-slens ${
                    active
                      ? "bg-fg text-bg font-semibold"
                      : "bg-surface-2 text-muted hover:text-fg"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Quality Filter */}
        <div role="group" aria-labelledby="filter-quality" className="flex flex-wrap items-center gap-2 sm:ml-4">
          <span id="filter-quality" className="text-muted">Quality:</span>
          <div className="flex flex-wrap gap-1">
            {[
              { id: undefined, label: "All" },
              { id: "ok", label: "OK" },
              { id: "empty", label: "Empty" },
              { id: "http_error", label: "Error" },
              { id: "schema_fail", label: "Schema" },
              { id: "timeout", label: "Timeout" },
              { id: "slow", label: "Slow" },
            ].map((item) => {
              const active = quality === item.id || (!quality && item.id === undefined);
              return (
                <Link
                  key={item.label}
                  href={createFilterUrl({ quality: item.id, page: "1" })}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-xs px-2 py-1.5 transition-slens ${
                    active
                      ? "bg-fg text-bg font-semibold"
                      : "bg-surface-2 text-muted hover:text-fg"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        <LedgerSearchBox initialValue={search ?? ""} />

        <div className="ml-auto text-muted font-mono" aria-live="polite">
          <span className="text-fg font-semibold">{data.total}</span> {data.total === 1 ? "record" : "records"}
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-md border border-border bg-surface p-6">
        <InteractiveDecisionsTable records={data.records} showAgent={agentId === ALL_AGENTS} />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between border-t border-border pt-4 text-xs">
            <span className="text-muted font-mono">
              Page {page} / {totalPages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={createFilterUrl({ page: String(page - 1) })}
                  className="rounded-xs border border-border px-3 py-1.5 text-muted transition-slens hover:border-fg hover:text-fg"
                >
                  <span aria-hidden="true">← </span>Previous
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={createFilterUrl({ page: String(page + 1) })}
                  className="rounded-xs border border-border px-3 py-1.5 text-muted transition-slens hover:border-fg hover:text-fg"
                >
                  Next<span aria-hidden="true"> →</span>
                </Link>
              )}
            </div>
          </div>
        )}
      </div>

      <LedgerIntegrity digests={digests} explorerUrl={ARC.explorerUrl} />
    </div>
  );
}
