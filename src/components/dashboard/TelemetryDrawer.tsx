"use client";

import type { AuthorizationRecord } from "@/lib/contracts";
import { formatDateTime, formatUsdcPrecise } from "@/lib/format";
import { StatusInline } from "@/components/ui/StatusPill";
import { decisionTone, DECISION_LABELS, qualityTone, QUALITY_LABELS } from "@/lib/status";
import { MonoNumber } from "@/components/ui/MonoNumber";

interface TelemetryDrawerProps {
  record: AuthorizationRecord | null;
  onClose: () => void;
}

export function TelemetryDrawer({ record, onClose }: TelemetryDrawerProps) {
  if (!record) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-ink/40 backdrop-blur-xs transition-opacity"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-lg overflow-y-auto border-l border-border bg-surface p-6 shadow-2xl transition-transform sm:max-w-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <span className="font-mono text-xs text-muted">{record.id}</span>
            <h3 className="mt-1 text-lg font-semibold">Authorization Telemetry</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-xs border border-border p-1.5 text-xs text-muted hover:border-fg hover:text-fg"
          >
            ✕ Close
          </button>
        </div>

        <div className="mt-6 space-y-5 text-xs">
          <div className="rounded-xs border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between">
              <span className="text-muted">Decision:</span>
              <StatusInline tone={decisionTone(record.decision)}>
                {DECISION_LABELS[record.decision]}
              </StatusInline>
            </div>
            {record.ruleHit && (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-muted">Triggered Rule:</span>
                <code className="rounded-xs bg-bg px-1.5 py-0.5 font-mono text-critical">
                  {record.ruleHit}
                </code>
              </div>
            )}
          </div>

          <div className="space-y-3 divide-y divide-border/50">
            <div className="flex items-center justify-between pt-2">
              <span className="text-muted">Timestamp:</span>
              <MonoNumber>{formatDateTime(record.ts)}</MonoNumber>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-muted">Agent ID:</span>
              <span className="font-mono font-medium">{record.agentId}</span>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-muted">Task ID:</span>
              <span className="font-mono">{record.taskId || "—"}</span>
            </div>

            <div className="flex flex-col gap-1 pt-2">
              <span className="text-muted">Counterparty:</span>
              <span className="font-mono text-[11px] break-all select-all">{record.counterparty}</span>
            </div>

            <div className="flex flex-col gap-1 pt-2">
              <span className="text-muted">Target Resource:</span>
              <span className="font-mono text-[11px] break-all select-all">{record.resource}</span>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-muted">Amount:</span>
              <div className="text-right">
                <MonoNumber className="font-semibold">{formatUsdcPrecise(record.amountMicroUsdc)} USDC</MonoNumber>
                <MonoNumber className="ml-2 text-muted">({record.amountMicroUsdc} µUSDC)</MonoNumber>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-muted">HTTP Status Code:</span>
              <MonoNumber>{record.httpStatus !== null ? record.httpStatus : "Not sent"}</MonoNumber>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-muted">Latency:</span>
              <MonoNumber>{record.latencyMs !== null ? `${record.latencyMs} ms` : "—"}</MonoNumber>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-muted">Quality Class:</span>
              {record.quality ? (
                <StatusInline tone={qualityTone(record.quality)}>
                  {QUALITY_LABELS[record.quality]} ({record.quality})
                </StatusInline>
              ) : (
                <span className="text-muted">—</span>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-muted">Response Size:</span>
              <MonoNumber>{record.bodyBytes !== null ? `${record.bodyBytes} bytes` : "—"}</MonoNumber>
            </div>

            <div className="flex flex-col gap-1 pt-2">
              <span className="text-muted">Response Body SHA-256 Digest:</span>
              <div className="rounded-xs bg-bg p-2 font-mono text-[11px] break-all select-all text-muted">
                {record.bodySha256 || "No body (request blocked)"}
              </div>
              <p className="mt-0.5 text-[10px] text-muted italic">
                * Privacy rule: response bodies are never stored anywhere — only a 256-bit SHA digest is kept.
              </p>
            </div>

            <div className="flex flex-col gap-1 pt-2">
              <span className="text-muted">Signature Nonce:</span>
              <span className="font-mono text-[11px] break-all select-all">{record.nonce || "Not signed"}</span>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-muted">Arc Settlement ID:</span>
              <span className="font-mono">{record.settlementId || "Pending / not yet reconciled"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
