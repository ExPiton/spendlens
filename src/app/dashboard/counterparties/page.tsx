import Link from "next/link";
import { listCounterparties, listAgentOptions, ALL_AGENTS } from "@/lib/db/repository";
import { requireVerifiedUser } from "@/lib/auth/dal";
import { NoAgents } from "@/components/dashboard/EmptyState";
import { AgentSwitcher } from "@/components/dashboard/AgentSwitcher";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { formatUsdcPrecise, formatPercent, formatCount, formatDateTime, formatCounterparty } from "@/lib/format";

export const metadata = { title: "Counterparties" };

interface CounterpartiesPageProps {
  searchParams: Promise<{ agentId?: string }>;
}

export default async function CounterpartiesPage(props: CounterpartiesPageProps) {
  const { user } = await requireVerifiedUser();
  const searchParams = await props.searchParams;
  const agentId = searchParams.agentId || ALL_AGENTS;

  const [options, counterparties] = await Promise.all([
    listAgentOptions(user.id),
    listCounterparties(user.id, agentId === ALL_AGENTS ? undefined : agentId),
  ]);

  if (options.length <= 1) {
    return (
      <div className="space-y-6">
        <div className="border-b border-border pb-6">
          <h1 className="text-2xl font-bold tracking-tight">Counterparties</h1>
        </div>
        <NoAgents />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-6">
        <div>
          <span className="text-xs text-muted uppercase tracking-wider font-semibold">
            Counterparties
          </span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Who your agents pay</h1>
          <p className="mt-1 text-xs text-muted">
            Spend, call volume and response quality for every address and API your agents paid, from your own ledger.
          </p>
        </div>

        <AgentSwitcher options={options} currentAgentId={agentId} />
      </div>

      {/* Main Table */}
      <div className="rounded-md border border-border bg-surface p-6">
        {/* `relative`: the last header cell holds an `sr-only` (absolutely
            positioned) label, and an absolute box escapes an `overflow` clip
            unless the clipping element is its containing block. Without it
            that label sat at the table's far right and made the whole page
            956px wide on a 390px phone. */}
        <div className="relative overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Counterparty</Th>
                <Th align="right">Spend (USDC)</Th>
                <Th align="right">Calls</Th>
                <Th align="right">Good responses</Th>
                <Th align="right">Allow / Block / Hold</Th>
                <Th>First seen (UTC)</Th>
                <Th align="right">
                  <span className="sr-only">Records</span>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {counterparties.map((cp) => {
                const isGoodQuality = cp.qualityScore >= 0.85;
                const isMediumQuality = cp.qualityScore >= 0.6;

                return (
                  <Tr key={cp.counterparty}>
                    <Td className="font-mono text-xs font-medium" title={cp.counterparty}>
                      {formatCounterparty(cp.counterparty)}
                    </Td>
                    <Td align="right">
                      <MonoNumber className="font-semibold">{formatUsdcPrecise(cp.totalSpendMicroUsdc)}</MonoNumber>
                    </Td>
                    <Td align="right">
                      <MonoNumber>{formatCount(cp.callCount)}</MonoNumber>
                    </Td>
                    <Td align="right">
                      <span
                        className={`font-mono text-xs font-bold ${
                          isGoodQuality
                            ? "text-signal"
                            : isMediumQuality
                            ? "text-held"
                            : "text-critical"
                        }`}
                      >
                        {formatPercent(cp.qualityScore)}
                      </span>
                    </Td>
                    <Td align="right">
                      <MonoNumber className="text-xs">
                        <span className="text-signal">{formatCount(cp.allowedCount)}</span> /{" "}
                        <span className="text-critical">{formatCount(cp.blockedCount)}</span> /{" "}
                        <span className="text-held">{formatCount(cp.holdCount)}</span>
                      </MonoNumber>
                    </Td>
                    <Td className="whitespace-nowrap text-muted text-xs font-mono">
                      {formatDateTime(cp.firstSeenTs)}
                    </Td>
                    <Td align="right">
                      <Link
                        href={`/dashboard/ledger?counterparty=${encodeURIComponent(cp.counterparty)}`}
                        className="whitespace-nowrap rounded-xs border border-border px-2.5 py-1 text-xs text-muted transition-slens hover:border-fg hover:text-fg"
                      >
                        Records →
                      </Link>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      </div>
    </div>
  );
}
