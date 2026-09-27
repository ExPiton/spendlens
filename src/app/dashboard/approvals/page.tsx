import { requireVerifiedUser } from "@/lib/auth/dal";
import { listEscalations } from "@/lib/db/escalations";
import { decideEscalationAction } from "@/app/dashboard/actions";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { formatCounterparty, formatDateTime, formatUsdcPrecise } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  pending: "text-held",
  approved: "text-signal",
  denied: "text-critical",
  expired: "text-muted",
};

export default async function ApprovalsPage() {
  const { user } = await requireVerifiedUser();
  const escalations = await listEscalations(user.id);
  const pending = escalations.filter((e) => e.status === "pending");
  const history = escalations.filter((e) => e.status !== "pending");

  return (
    <div className="space-y-8">
      <div className="border-b border-border pb-6">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          Human in the loop
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Payment approvals</h1>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          A policy rule that resolves to <code className="font-mono">hold</code> sends the payment here.
          The agent waits — nothing is signed — until you approve or deny it, or until the policy&apos;s{" "}
          <code className="font-mono">escalation.timeout_seconds</code> passes and{" "}
          <code className="font-mono">on_timeout</code> applies. Holds under{" "}
          <code className="font-mono">auto_approve_below_usdc</code> are approved without waiting.
        </p>
      </div>

      <section className="rounded-md border border-border bg-surface p-6">
        <h3 className="text-sm font-semibold">
          Waiting for you <span className="font-mono text-held">({pending.length})</span>
        </h3>
        {pending.length === 0 ? (
          <p className="mt-3 text-xs text-muted">No payments are waiting for approval.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Agent</Th>
                  <Th>Counterparty</Th>
                  <Th className="hidden xl:table-cell">Resource</Th>
                  <Th align="right">Amount</Th>
                  <Th className="hidden lg:table-cell">Rule</Th>
                  <Th>Expires</Th>
                  <Th>Decision</Th>
                </Tr>
              </Thead>
              <Tbody>
                {pending.map((e) => (
                  <Tr key={e.id}>
                    <Td className="font-mono text-xs">{e.agentSlug}</Td>
                    <Td className="font-mono text-xs">{formatCounterparty(e.counterparty)}</Td>
                    <Td
                      className="hidden max-w-xs truncate font-mono text-[11px] text-muted xl:table-cell"
                      title={e.resource}
                    >
                      {e.resource || "—"}
                    </Td>
                    <Td align="right">
                      <MonoNumber>{formatUsdcPrecise(e.amountMicroUsdc)} USDC</MonoNumber>
                    </Td>
                    <Td className="hidden font-mono text-[11px] lg:table-cell">{e.ruleHit ?? "—"}</Td>
                    <Td className="font-mono text-[11px] text-muted">{formatDateTime(e.expiresAt)}</Td>
                    <Td>
                      <form action={decideEscalationAction} className="flex gap-2">
                        <input type="hidden" name="id" value={e.id} />
                        <button
                          name="decision"
                          value="approve"
                          className="rounded-xs bg-signal px-3 py-1 text-xs font-semibold text-ink hover:opacity-90"
                        >
                          Approve
                        </button>
                        <button
                          name="decision"
                          value="deny"
                          className="rounded-xs border border-critical px-3 py-1 text-xs font-semibold text-critical hover:bg-critical/10"
                        >
                          Deny
                        </button>
                      </form>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </section>

      <section className="rounded-md border border-border bg-surface p-6">
        <h3 className="text-sm font-semibold">History</h3>
        {history.length === 0 ? (
          <p className="mt-3 text-xs text-muted">No decisions yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>When</Th>
                  <Th>Agent</Th>
                  <Th>Counterparty</Th>
                  <Th align="right">Amount</Th>
                  <Th>Outcome</Th>
                  <Th>Decided by</Th>
                </Tr>
              </Thead>
              <Tbody>
                {history.map((e) => (
                  <Tr key={e.id}>
                    <Td className="font-mono text-[11px] text-muted">{formatDateTime(e.createdAt)}</Td>
                    <Td className="font-mono text-xs">{e.agentSlug}</Td>
                    <Td className="font-mono text-xs">{formatCounterparty(e.counterparty)}</Td>
                    <Td align="right">
                      <MonoNumber>{formatUsdcPrecise(e.amountMicroUsdc)} USDC</MonoNumber>
                    </Td>
                    <Td className={`text-xs font-semibold ${STATUS_CLASS[e.status] ?? ""}`}>{e.status}</Td>
                    <Td className="font-mono text-[11px] text-muted">
                      {e.decidedBy === "auto"
                        ? "auto-approve ceiling"
                        : e.decidedBy === "halt"
                          ? "kill switch"
                          : e.decidedBy === user.id
                            ? "you"
                            : e.status === "expired"
                              ? "timed out"
                              : "—"}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
