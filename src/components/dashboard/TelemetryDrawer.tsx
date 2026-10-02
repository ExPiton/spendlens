"use client";

import { useEffect, useRef } from "react";
import type { AuthorizationRecord } from "@/lib/contracts";
import { formatDateTime, formatUsdcPrecise } from "@/lib/format";
import { StatusInline } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/Button";
import { decisionTone, DECISION_LABELS, qualityTone, QUALITY_LABELS } from "@/lib/status";
import { MonoNumber } from "@/components/ui/MonoNumber";

interface TelemetryDrawerProps {
  record: AuthorizationRecord | null;
  onClose: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function TelemetryDrawer({ record, onClose }: TelemetryDrawerProps) {
  const open = record !== null;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  // A modal has to behave like one: Escape closes it, focus moves in and stays
  // in (Tab wraps instead of walking into the page behind the backdrop), and
  // closing hands focus back to whatever opened it — otherwise a keyboard user
  // is dropped at the top of the page after every record they look at.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!record) return null;

  // Say what is actually true of THIS record: a blocked call made no payment,
  // so there is nothing to sign, hash or settle — but an allowed call with an
  // empty body did pay (the hash line used to claim "request blocked" for it).
  const noPayment = record.decision === "block" || record.decision === "hold_denied";
  const digestText =
    record.bodySha256 ||
    (noPayment
      ? "None. The payment was not made, so no response was fetched."
      : record.bodyBytes === 0
        ? "None. The provider returned an empty body (0 bytes)."
        : "Not recorded");
  const nonceText = record.nonce || (noPayment ? "None. Payment not signed (blocked)." : "Not recorded");
  const settlementText =
    record.settlementId || (noPayment ? "None. No payment was made." : "Pending / not yet reconciled");

  return (
    <div className="fade-in fixed inset-0 z-50 flex justify-end bg-ink/40 backdrop-blur-xs" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="telemetry-title"
        className="drawer-in h-full w-full max-w-lg overflow-y-auto overscroll-contain border-l border-border bg-surface p-6 shadow-2xl sm:max-w-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0">
            <span className="block truncate font-mono text-xs text-muted">{record.id}</span>
            <h2 id="telemetry-title" className="mt-1 text-lg font-semibold">
              Authorization telemetry
            </h2>
          </div>
          <Button ref={closeRef} type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-6 space-y-5 text-xs">
          <div className="rounded-xs border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between">
              <span className="text-muted">Decision</span>
              <StatusInline tone={decisionTone(record.decision)}>
                {DECISION_LABELS[record.decision]}
              </StatusInline>
            </div>
            {record.ruleHit && (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-muted">Triggered rule</span>
                <code className="rounded-xs bg-bg px-1.5 py-0.5 font-mono text-critical">
                  {record.ruleHit}
                </code>
              </div>
            )}
          </div>

          <dl className="space-y-3 divide-y divide-border/50">
            <div className="flex items-center justify-between pt-2">
              <dt className="text-muted">Timestamp (UTC)</dt>
              <dd>
                <MonoNumber>{formatDateTime(record.ts)}</MonoNumber>
              </dd>
            </div>

            <div className="flex items-center justify-between pt-2">
              <dt className="text-muted">Agent ID</dt>
              <dd className="font-mono font-medium">{record.agentId}</dd>
            </div>

            <div className="flex items-center justify-between pt-2">
              <dt className="text-muted">Task ID</dt>
              <dd className="font-mono">{record.taskId || "—"}</dd>
            </div>

            <div className="flex flex-col gap-1 pt-2">
              <dt className="text-muted">Counterparty</dt>
              <dd className="font-mono text-[11px] break-all select-all">{record.counterparty}</dd>
            </div>

            <div className="flex flex-col gap-1 pt-2">
              <dt className="text-muted">Target resource</dt>
              <dd className="font-mono text-[11px] break-all select-all">{record.resource}</dd>
            </div>

            <div className="flex items-center justify-between pt-2">
              <dt className="text-muted">Amount</dt>
              <dd className="text-right">
                <MonoNumber className="font-semibold">{formatUsdcPrecise(record.amountMicroUsdc)} USDC</MonoNumber>
                <MonoNumber className="ml-2 text-muted">({record.amountMicroUsdc} µUSDC)</MonoNumber>
              </dd>
            </div>

            <div className="flex items-center justify-between pt-2">
              <dt className="text-muted">HTTP status code</dt>
              <dd>
                <MonoNumber>{record.httpStatus !== null ? record.httpStatus : "Not sent"}</MonoNumber>
              </dd>
            </div>

            <div className="flex items-center justify-between pt-2">
              <dt className="text-muted">Latency</dt>
              <dd>
                <MonoNumber>{record.latencyMs !== null ? `${record.latencyMs} ms` : "—"}</MonoNumber>
              </dd>
            </div>

            <div className="flex items-center justify-between pt-2">
              <dt className="text-muted">Quality class</dt>
              <dd>
                {record.quality ? (
                  <StatusInline tone={qualityTone(record.quality)}>
                    {QUALITY_LABELS[record.quality]} ({record.quality})
                  </StatusInline>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </dd>
            </div>

            <div className="flex items-center justify-between pt-2">
              <dt className="text-muted">Response size</dt>
              <dd>
                <MonoNumber>{record.bodyBytes !== null ? `${record.bodyBytes} bytes` : "—"}</MonoNumber>
              </dd>
            </div>

            <div className="flex flex-col gap-1 pt-2">
              <dt className="text-muted">Response body SHA-256 digest</dt>
              <dd>
                <div className="rounded-xs bg-bg p-2 font-mono text-[11px] break-all select-all text-muted">
                  {digestText}
                </div>
                <p className="mt-1 text-[11px] text-muted italic">
                  Privacy rule: response bodies are never stored anywhere, only a 256-bit SHA digest.
                </p>
              </dd>
            </div>

            <div className="flex flex-col gap-1 pt-2">
              <dt className="text-muted">Signature nonce</dt>
              <dd className="font-mono text-[11px] break-all select-all">{nonceText}</dd>
            </div>

            <div className="flex flex-col gap-1 pt-2">
              <dt className="text-muted">
                Policy (SHA-256{record.policyVersion != null ? `, dashboard v${record.policyVersion}` : ""})
              </dt>
              <dd>
                <div className="rounded-xs bg-bg p-2 font-mono text-[11px] break-all select-all text-muted">
                  {record.policyHash || "Not recorded (older SDK)"}
                </div>
                <p className="mt-1 text-[11px] text-muted italic">
                  The exact rule set this decision was evaluated against. A hash the dashboard never issued means the
                  agent ran a policy nobody here published.
                </p>
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <dt className="text-muted">Arc settlement ID</dt>
              <dd className="min-w-0 font-mono break-all">{settlementText}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
