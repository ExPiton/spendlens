"use client";

import { useState } from "react";
import type { AuthorizationRecord } from "@/lib/contracts";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { StatusInline } from "@/components/ui/StatusPill";
import { decisionTone, DECISION_LABELS, noteFor, qualityTone, QUALITY_LABELS } from "@/lib/status";
import { formatDateTime, formatResource, formatUsdcPrecise } from "@/lib/format";
import { TelemetryDrawer } from "./TelemetryDrawer";

interface InteractiveDecisionsTableProps {
  records: AuthorizationRecord[];
  showAgent?: boolean;
  emptyMessage?: string;
}

export function InteractiveDecisionsTable({
  records,
  showAgent = false,
  emptyMessage = "No records in this range.",
}: InteractiveDecisionsTableProps) {
  const [selectedRecord, setSelectedRecord] = useState<AuthorizationRecord | null>(null);

  if (records.length === 0) {
    return <p className="px-1 py-6 text-sm text-muted">{emptyMessage}</p>;
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>Time (UTC)</Th>
              {showAgent && <Th>Agent</Th>}
              <Th>Resource</Th>
              <Th align="right">Amount (USDC)</Th>
              <Th>Decision</Th>
              <Th>Quality</Th>
              <Th>Rule / note</Th>
            </Tr>
          </Thead>
          <Tbody>
            {records.map((r) => {
              const note = noteFor(r.decision, r.ruleHit, r.quality);
              return (
                <Tr
                  key={r.id}
                  className="cursor-pointer transition-colors hover:bg-surface-2/60"
                  onClick={() => setSelectedRecord(r)}
                >
                  <Td>
                    {/* The timestamp is the keyboard way in to the record (the
                        whole row is clickable for a mouse) — it replaces a
                        separate "Inspect" column that pushed the table past
                        the viewport on laptop screens. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRecord(r);
                      }}
                      aria-label={`Open the record: ${DECISION_LABELS[r.decision]}, ${formatResource(r.resource)}, ${formatDateTime(r.ts)} UTC`}
                      className="inline-flex min-h-6 items-center font-mono tabular whitespace-nowrap text-muted underline-offset-2 transition-slens hover:text-fg hover:underline"
                    >
                      {formatDateTime(r.ts)}
                    </button>
                  </Td>
                  {showAgent && <Td className="whitespace-nowrap font-mono text-xs text-muted">{r.agentId}</Td>}
                  <Td className="max-w-48 truncate font-mono text-xs" title={r.resource}>
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
                  <Td className="whitespace-nowrap">
                    {r.quality ? (
                      <StatusInline tone={qualityTone(r.quality)}>
                        {QUALITY_LABELS[r.quality]}
                      </StatusInline>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </Td>
                  <Td className="max-w-48 truncate text-muted" title={note ?? undefined}>
                    {note ? (
                      <code className="rounded-xs bg-bg px-1.5 py-0.5 font-mono text-xs">
                        {note}
                      </code>
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

      <TelemetryDrawer record={selectedRecord} onClose={() => setSelectedRecord(null)} />
    </>
  );
}
