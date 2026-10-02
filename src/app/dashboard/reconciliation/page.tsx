import { listReconciliation, getLedgerPeriod } from "@/lib/db/repository";
import { requireVerifiedUser } from "@/lib/auth/dal";
import { NoAgents } from "@/components/dashboard/EmptyState";
import { RescanButton } from "@/components/dashboard/RescanButton";
import { HaltAffectedAgentsButton } from "@/components/dashboard/HaltAffectedAgentsButton";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { StatusInline, StatusDot } from "@/components/ui/StatusPill";
import { reconciliationTone, RECONCILIATION_LABELS } from "@/lib/status";
import { formatUsdcPrecise, formatCounterparty, formatPeriod } from "@/lib/format";
import { listAgentOptions } from "@/lib/db/repository";
import { listAgentRecords } from "@/lib/db/agents";
import Link from "next/link";

export const metadata = { title: "Reconciliation" };

export default async function ReconciliationPage() {
  const { user } = await requireVerifiedUser();
  const options = await listAgentOptions(user.id);
  if (options.length <= 1) {
    return (
      <div className="space-y-6">
        <div className="border-b border-border pb-6">
          <h1 className="text-2xl font-bold tracking-tight">Arc reconciliation audit</h1>
        </div>
        <NoAgents />
      </div>
    );
  }

  const [records, { start, end }, agents] = await Promise.all([
    listReconciliation(user.id),
    getLedgerPeriod(user.id),
    listAgentRecords(user.id),
  ]);
  const withoutWallet = agents.filter((a) => !a.walletAddress);

  const tolerance = formatUsdcPrecise(records[0]?.toleranceMicroUsdc ?? 50);
  const criticalRecords = records.filter((r) => r.status === "critical");
  const pendingRecords = records.filter((r) => r.status === "pending");
  const okRecords = records.filter((r) => r.status === "ok");

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="border-b border-border pb-6">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>Reconciliation</span>
          <span aria-hidden="true">•</span>
          <span className="font-mono text-signal">{formatPeriod(start, end)}</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Ledger vs. Circle Gateway on Arc</h1>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          What Circle Gateway settled from each agent&rsquo;s wallet, compared with what your ledger says was
          paid. Checked automatically every 10 minutes; the newest 5 minutes wait for the next pass so an
          in-flight ledger row isn&rsquo;t mistaken for a leak.
        </p>
      </div>

      {/* Critical Alert Banner if any critical mismatches exist */}
      {criticalRecords.length > 0 && (
        <div role="alert" className="rounded-md border border-critical bg-critical/10 p-6 text-fg">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <StatusDot tone="critical" className="mt-1.5 size-2.5" />
              <div>
                <h2 className="text-sm font-bold text-critical">
                  Unrecorded on-chain spend: possible leaked key
                </h2>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg">
                  Circle Gateway settled payments to{" "}
                  {criticalRecords.length === 1 ? "1 counterparty" : `${criticalRecords.length} counterparties`} that no
                  Spendlens-guarded call recorded. If you
                  didn&rsquo;t make them another way, treat the wallet key as leaked: halt the agent, rotate the key and
                  move the funds.
                </p>
              </div>
            </div>
            <HaltAffectedAgentsButton
              agents={criticalRecords.flatMap((r) => (r.agentId ? [r.agentId] : []))}
            />
          </div>
        </div>
      )}

      {withoutWallet.length > 0 && (
        <div className="rounded-xs border border-held/30 bg-held/5 p-4 text-xs text-fg">
          <span className="font-semibold text-held">Not checked yet:</span>{" "}
          {withoutWallet.map((a, i) => (
            <span key={a.id}>
              {i > 0 && ", "}
              <Link href={`/dashboard/agents/${a.slug}`} className="font-mono underline">
                {a.slug}
              </Link>
            </span>
          ))}{" "}
          {withoutWallet.length === 1 ? "has" : "have"} no wallet address. Add it on the agent&rsquo;s page and
          Spendlens checks that wallet&rsquo;s Circle Gateway settlements automatically. The address is enough, no
          private key.
        </div>
      )}

      {/* Status Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xs border border-border bg-surface p-4">
          <div className="flex items-center gap-2">
            <StatusDot tone="critical" />
            <span className="text-xs font-medium text-muted">Unrecorded spend</span>
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-critical">
            {criticalRecords.length}
          </div>
          <p className="mt-1 text-[11px] text-muted">Settled on chain, missing from the ledger</p>
        </div>

        <div className="rounded-xs border border-border bg-surface p-4">
          <div className="flex items-center gap-2">
            <StatusDot tone="held" />
            <span className="text-xs font-medium text-muted">Not settled yet</span>
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-held">
            {pendingRecords.length}
          </div>
          <p className="mt-1 text-[11px] text-muted">Paid in the ledger, not yet settled on chain</p>
        </div>

        <div className="rounded-xs border border-border bg-surface p-4">
          <div className="flex items-center gap-2">
            <StatusDot tone="signal" />
            <span className="text-xs font-medium text-muted">Matched</span>
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-signal">
            {okRecords.length}
          </div>
          <p className="mt-1 text-[11px] text-muted">Chain and ledger agree within {tolerance} USDC</p>
        </div>
      </div>

      {/* Reconciliation Table */}
      <div className="rounded-md border border-border bg-surface p-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h2 className="text-sm font-semibold">By agent and counterparty</h2>
            <p className="mt-0.5 text-xs text-muted">
              Settled total vs. the ledger&rsquo;s paid total (allowed + approved holds). Rescan checks now.
            </p>
          </div>
          <RescanButton />
        </div>

        <div className="mt-4 overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Agent</Th>
                <Th>Chain</Th>
                <Th>Counterparty</Th>
                <Th align="right">Settled (USDC)</Th>
                <Th align="right">Ledger (USDC)</Th>
                <Th align="right">Difference</Th>
                <Th>Status</Th>
                <Th>Last Gateway transfer</Th>
              </Tr>
            </Thead>
            <Tbody>
              {records.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-sm text-muted">
                    Nothing to compare yet. Add an agent&rsquo;s wallet address and its settlements show up here after
                    the next check.
                  </td>
                </tr>
              )}
              {records.map((r) => {
                const tone = reconciliationTone(r.status);
                return (
                  <Tr
                    key={`${r.agentId}:${r.chainId}:${r.counterparty}`}
                    className={r.status === "critical" ? "bg-critical/5" : ""}
                  >
                    <Td className="font-mono text-xs">{r.agentId ?? "—"}</Td>
                    <Td className="font-mono text-xs text-muted">
                      {r.chainId === 5042 ? "mainnet" : r.chainId === 5042002 ? "testnet" : (r.chainId ?? "—")}
                    </Td>
                    <Td className="font-mono text-xs font-medium" title={r.counterparty}>
                      {formatCounterparty(r.counterparty)}
                    </Td>
                    <Td align="right">
                      <MonoNumber>{formatUsdcPrecise(r.chainAmountMicroUsdc)}</MonoNumber>
                    </Td>
                    <Td align="right">
                      <MonoNumber>{formatUsdcPrecise(r.ledgerAmountMicroUsdc)}</MonoNumber>
                    </Td>
                    <Td align="right">
                      <MonoNumber className={r.status === "critical" ? "text-critical font-bold" : ""}>
                        {r.deltaMicroUsdc > 0 ? "+" : ""}
                        {formatUsdcPrecise(r.deltaMicroUsdc)}
                      </MonoNumber>
                    </Td>
                    <Td>
                      <StatusInline tone={tone}>
                        {RECONCILIATION_LABELS[r.status]}
                      </StatusInline>
                    </Td>
                    <Td className="max-w-40 truncate font-mono text-[11px] text-muted" title={r.settlementId ?? undefined}>
                      {r.settlementId ?? "—"}
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
