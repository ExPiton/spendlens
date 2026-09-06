import Link from "next/link";
import { requireVerifiedUser } from "@/lib/auth/dal";
import { listAgents, getAgentLabels } from "@/lib/db/repository";
import { NoAgents } from "@/components/dashboard/EmptyState";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { formatUsdcTotal, formatPercent, formatCount, formatDateTime } from "@/lib/format";

export default async function AgentsPage() {
  const { user } = await requireVerifiedUser();
  const [agents, labels] = await Promise.all([
    listAgents(user.id),
    getAgentLabels(user.id),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="text-xs text-muted uppercase tracking-wider font-semibold">
            Agent Fleet Management
          </span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Registered AI Agents</h1>
          <p className="mt-1 text-xs text-muted">
            Spend, quality, and security status for every agent making autonomous micropayments on Arc.
          </p>
        </div>
        <Link
          href="/dashboard/agents/new"
          className="shrink-0 rounded-sm bg-fg px-4 py-2 text-sm font-medium text-bg transition-slens hover:opacity-85"
        >
          + New agent
        </Link>
      </div>

      {agents.length === 0 && <NoAgents />}

      {/* Agents Table */}
      {agents.length > 0 && (
      <div className="rounded-md border border-border bg-surface p-6">
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Agent ID</Th>
                <Th>Role / Description</Th>
                <Th align="right">Total Spend</Th>
                <Th align="right">Unmatched (Wasted)</Th>
                <Th align="right">Waste Ratio</Th>
                <Th align="right">Allow / Block / Hold</Th>
                <Th align="right">Counterparties</Th>
                <Th>Last Activity</Th>
                <Th align="right">Action</Th>
              </Tr>
            </Thead>
            <Tbody>
              {agents.map((a) => {
                const label = labels[a.agentId] || a.agentId;
                const isHighWaste = a.wastedRatio > 0.15;

                return (
                  <Tr key={a.agentId}>
                    <Td className="font-mono font-medium text-xs">{a.agentId}</Td>
                    <Td className="text-muted text-xs">{label}</Td>
                    <Td align="right">
                      <MonoNumber className="font-semibold">{formatUsdcTotal(a.totalSpendMicroUsdc)} $</MonoNumber>
                    </Td>
                    <Td align="right">
                      <MonoNumber className={isHighWaste ? "text-critical font-bold" : "text-muted"}>
                        {formatUsdcTotal(a.wastedMicroUsdc)} $
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
                    <Td align="right">
                      <MonoNumber className="text-xs">{a.counterpartyCount}</MonoNumber>
                    </Td>
                    <Td className="text-muted text-xs font-mono">
                      {a.lastActivityTs ? formatDateTime(a.lastActivityTs) : "—"}
                    </Td>
                    <Td align="right">
                      <Link
                        href={`/dashboard/agents/${a.agentId}`}
                        className="rounded-xs border border-border px-2.5 py-1 text-xs text-muted transition-slens hover:border-fg hover:text-fg"
                      >
                        Inspect →
                      </Link>
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
