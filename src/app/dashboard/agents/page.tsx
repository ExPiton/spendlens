import Link from "next/link";
import { LinkButton } from "@/components/ui/Button";
import { requireVerifiedUser } from "@/lib/auth/dal";
import { listAgents, getAgentLabels } from "@/lib/db/repository";
import { listAgentRecords } from "@/lib/db/agents";
import { NoAgents } from "@/components/dashboard/EmptyState";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { StatusInline } from "@/components/ui/StatusPill";
import { formatUsdcTotal, formatPercent, formatCount, formatDateTime } from "@/lib/format";

export const metadata = { title: "Agents" };

export default async function AgentsPage() {
  const { user } = await requireVerifiedUser();
  const [agents, labels, records] = await Promise.all([
    listAgents(user.id),
    getAgentLabels(user.id),
    listAgentRecords(user.id),
  ]);
  const statusBySlug = new Map(records.map((r) => [r.slug, r.status]));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="text-xs text-muted uppercase tracking-wider font-semibold">
            Agents
          </span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Your agents</h1>
          <p className="mt-1 text-xs text-muted">
            Spend, waste and policy outcomes for every agent making micropayments on Arc.
          </p>
        </div>
        <LinkButton href="/dashboard/agents/new" className="shrink-0">
          + New agent
        </LinkButton>
      </div>

      {agents.length === 0 && <NoAgents />}

      {/* Agents Table */}
      {agents.length > 0 && (
      <div className="rounded-md border border-border bg-surface p-6">
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Agent</Th>
                <Th>Status</Th>
                <Th align="right">Spend (USDC)</Th>
                <Th align="right">Wasted (USDC)</Th>
                <Th align="right">Waste</Th>
                <Th align="right">Allow / Block / Hold</Th>
                <Th align="right" className="hidden xl:table-cell">Payees</Th>
                <Th>Last activity (UTC)</Th>
              </Tr>
            </Thead>
            <Tbody>
              {agents.map((a) => {
                const label = labels[a.agentId] || a.agentId;
                const isHighWaste = a.wastedRatio > 0.15;

                return (
                  <Tr key={a.agentId}>
                    <Td>
                      <Link href={`/dashboard/agents/${a.agentId}`} className="group block whitespace-nowrap">
                        <span className="block text-sm font-medium group-hover:underline">{label}</span>
                        <span className="block font-mono text-[11px] text-muted">{a.agentId}</span>
                      </Link>
                    </Td>
                    <Td>
                      {statusBySlug.get(a.agentId) === "paused" ? (
                        <StatusInline tone="critical">halted</StatusInline>
                      ) : (
                        <StatusInline tone="signal">active</StatusInline>
                      )}
                    </Td>
                    <Td align="right">
                      <MonoNumber className="font-semibold">{formatUsdcTotal(a.totalSpendMicroUsdc)}</MonoNumber>
                    </Td>
                    <Td align="right">
                      <MonoNumber className={isHighWaste ? "text-critical font-bold" : "text-muted"}>
                        {formatUsdcTotal(a.wastedMicroUsdc)}
                      </MonoNumber>
                    </Td>
                    <Td align="right">
                      <span className={`font-mono text-xs ${isHighWaste ? "text-critical font-bold" : "text-signal"}`}>
                        {formatPercent(a.wastedRatio)}
                      </span>
                    </Td>
                    <Td align="right">
                      <MonoNumber className="text-xs">
                        <span className="text-signal">{formatCount(a.allowedCount)}</span> /{" "}
                        <span className="text-critical">{formatCount(a.blockedCount)}</span> /{" "}
                        <span className="text-held">{formatCount(a.holdCount)}</span>
                      </MonoNumber>
                    </Td>
                    <Td align="right" className="hidden xl:table-cell">
                      <MonoNumber className="text-xs">{a.counterpartyCount}</MonoNumber>
                    </Td>
                    <Td className="whitespace-nowrap text-muted text-xs font-mono">
                      {a.lastActivityTs ? formatDateTime(a.lastActivityTs) : "—"}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      </div>
      )}
    </div>
  );
}
