import type { AuthorizationRecord } from "@/lib/contracts";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { StatusInline } from "@/components/ui/StatusPill";
import { decisionTone, DECISION_LABELS, noteFor } from "@/lib/status";
import { formatDateTime, formatResource, formatUsdcPrecise } from "@/lib/format";

interface DecisionsTableProps {
  records: AuthorizationRecord[];
  showAgent?: boolean;
  emptyMessage?: string;
}

/** The "Recent decisions" table: time, resource, amount, decision, and a single traceability note per row. */
export function DecisionsTable({ records, showAgent = false, emptyMessage = "No records in this range." }: DecisionsTableProps) {
  if (records.length === 0) {
    return <p className="px-1 py-6 text-sm text-muted">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <Thead>
          <Tr>
            <Th>Time (UTC)</Th>
            {showAgent && <Th>Agent</Th>}
            <Th>Resource</Th>
            <Th align="right">Amount (USDC)</Th>
            <Th>Decision</Th>
            <Th>Note</Th>
          </Tr>
        </Thead>
        <Tbody>
          {records.map((r) => {
            const note = noteFor(r.decision, r.ruleHit, r.quality);
            return (
              <Tr key={r.id}>
                <Td>
                  <MonoNumber className="whitespace-nowrap text-muted">{formatDateTime(r.ts)}</MonoNumber>
                </Td>
                {showAgent && <Td className="whitespace-nowrap font-mono text-xs text-muted">{r.agentId}</Td>}
                <Td className="max-w-56 truncate font-mono text-xs" title={r.resource}>
                  {formatResource(r.resource)}
                </Td>
                <Td align="right">
                  <MonoNumber>{formatUsdcPrecise(r.amountMicroUsdc)}</MonoNumber>
                </Td>
                <Td className="whitespace-nowrap">
                  <StatusInline tone={decisionTone(r.decision)}>
                    {DECISION_LABELS[r.decision]}
                  </StatusInline>
                </Td>
                <Td className="text-muted">
                  {note ? <MonoNumber className="text-xs">{note}</MonoNumber> : "—"}
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </div>
  );
}
