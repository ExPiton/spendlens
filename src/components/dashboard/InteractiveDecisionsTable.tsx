"use client";

import { useState } from "react";
import type { AuthorizationRecord } from "@/lib/contracts";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { StatusInline } from "@/components/ui/StatusPill";
import { decisionTone, DECISION_LABELS, noteFor, qualityTone, QUALITY_LABELS } from "@/lib/status";
import { formatResource, formatTime, formatUsdcPrecise } from "@/lib/format";
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
              <Th>Time</Th>
              {showAgent && <Th>Agent</Th>}
              <Th>Resource / Counterparty</Th>
              <Th align="right">Amount (USDC)</Th>
              <Th>Decision</Th>
              <Th>Quality</Th>
              <Th>Triggered Rule / Note</Th>
              <Th align="right">Detail</Th>
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
                    <MonoNumber className="text-muted">{formatTime(r.ts)}</MonoNumber>
                  </Td>
                  {showAgent && <Td className="text-muted">{r.agentId}</Td>}
                  <Td className="max-w-56 truncate font-mono text-xs" title={r.resource}>
                    {formatResource(r.resource)}
                  </Td>
                  <Td align="right">
                    <MonoNumber>{formatUsdcPrecise(r.amountMicroUsdc)}</MonoNumber>
                  </Td>
                  <Td>
                    <StatusInline tone={decisionTone(r.decision)}>
                      {DECISION_LABELS[r.decision]}
                    </StatusInline>
                  </Td>
                  <Td>
                    {r.quality ? (
                      <StatusInline tone={qualityTone(r.quality)}>
                        {QUALITY_LABELS[r.quality]}
                      </StatusInline>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </Td>
                  <Td className="text-muted">
                    {note ? (
                      <code className="rounded-xs bg-bg px-1.5 py-0.5 font-mono text-xs">
                        {note}
                      </code>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td align="right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRecord(r);
                      }}
                      className="rounded-xs border border-border px-2 py-0.5 text-[11px] text-muted hover:border-fg hover:text-fg"
                    >
                      Inspect
                    </button>
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
