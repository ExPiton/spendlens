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

  const criticalRecords = records.filter((r) => r.status === "critical");
  const pendingRecords = records.filter((r) => r.status === "pending");
  const okRecords = records.filter((r) => r.status === "ok");

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="border-b border-border pb-6">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>Arc Reconciliation Audit</span>
          <span>•</span>
          <span className="font-mono text-signal">{formatPeriod(start, end)}</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Arc Gateway On-Chain Reconciliation Audit</h1>
        <p className="mt-1 text-xs text-muted">
          Comparison of the settlement records Circle Gateway batches on Arc against the local event ledger.
        </p>
      </div>

      {/* Critical Alert Banner if any critical mismatches exist */}
      {criticalRecords.length > 0 && (
        <div className="rounded-md border border-critical bg-critical/10 p-6 text-fg animate-pulse">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <h3 className="font-bold text-critical text-sm">
                  CRITICAL SECURITY ALERT: Suspected Unauthorized Signature / Key Leak
                </h3>
                <p className="mt-1 text-xs text-fg leading-relaxed">
                  A phantom settlement not recorded in the local ledger was detected on the Arc chain for {criticalRecords.length} counterpart{criticalRecords.length === 1 ? "y" : "ies"} (delta &gt; tolerance). Even if the agent&apos;s wallet policy wasn&apos;t violated, the signing key may have leaked.
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
          <span className="font-semibold text-held">Not reconciled yet:</span>{" "}
          {withoutWallet.map((a, i) => (
            <span key={a.id}>
              {i > 0 && ", "}
              <Link href={`/dashboard/agents/${a.slug}`} className="font-mono underline">
                {a.slug}
              </Link>
            </span>
          ))}{" "}
          {withoutWallet.length === 1 ? "has" : "have"} no wallet address. Add the agent&apos;s Arc wallet
          address and Spendlens checks its Circle Gateway settlements automatically — no private key needed.
        </div>
      )}

      {/* Status Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xs border border-border bg-surface p-4">
          <div className="flex items-center gap-2">
            <StatusDot tone="critical" />
            <span className="text-xs font-medium text-muted">Critical Mismatch (Unauthorized Signature)</span>
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-critical">
            {criticalRecords.length}
          </div>
          <p className="mt-1 text-[11px] text-muted">On chain, missing from the local ledger</p>
        </div>

        <div className="rounded-xs border border-border bg-surface p-4">
          <div className="flex items-center gap-2">
            <StatusDot tone="held" />
            <span className="text-xs font-medium text-muted">Pending Reconciliation</span>
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-held">
            {pendingRecords.length}
          </div>
          <p className="mt-1 text-[11px] text-muted">Allowed in the ledger, not yet settled on chain</p>
        </div>

        <div className="rounded-xs border border-border bg-surface p-4">
          <div className="flex items-center gap-2">
            <StatusDot tone="signal" />
            <span className="text-xs font-medium text-muted">Fully Matched</span>
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-signal">
            {okRecords.length}
          </div>
          <p className="mt-1 text-[11px] text-muted">Within tolerance (|delta| &le; tolerance)</p>
        </div>
      </div>

      {/* Reconciliation Table */}
      <div className="rounded-md border border-border bg-surface p-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h3 className="text-sm font-semibold">Reconciliation Table</h3>
            <p className="mt-0.5 text-xs text-muted">
              Per agent wallet and Arc chain: each counterparty&apos;s Circle Gateway settlement total
              against the ledger&apos;s paid total (allow + approved holds). Refreshed automatically on a
              schedule; transfers from the last few minutes wait for the next pass.
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
                <Th align="right">Chain Amount (Arc)</Th>
                <Th align="right">Local Ledger</Th>
                <Th align="right">Delta</Th>
                <Th>Reconciliation Status</Th>
                <Th>Settlement ID / Tx</Th>
              </Tr>
            </Thead>
            <Tbody>
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
                    <Td className="font-mono text-xs font-medium">
                      {formatCounterparty(r.counterparty)}
                    </Td>
                    <Td align="right">
                      <MonoNumber>{formatUsdcPrecise(r.chainAmountMicroUsdc)} USDC</MonoNumber>
                    </Td>
                    <Td align="right">
                      <MonoNumber>{formatUsdcPrecise(r.ledgerAmountMicroUsdc)} USDC</MonoNumber>
                    </Td>
                    <Td align="right">
                      <MonoNumber className={r.status === "critical" ? "text-critical font-bold" : ""}>
                        {r.deltaMicroUsdc > 0 ? "+" : ""}
                        {formatUsdcPrecise(r.deltaMicroUsdc)} USDC
                      </MonoNumber>
                    </Td>
                    <Td>
                      <StatusInline tone={tone}>
                        {RECONCILIATION_LABELS[r.status]}
                      </StatusInline>
                    </Td>
                    <Td className="text-muted text-xs font-mono">
                      {r.settlementId ? (
                        <span className="text-signal">{r.settlementId}</span>
                      ) : (
                        "—"
                      )}
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
