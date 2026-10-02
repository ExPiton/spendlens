"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PolicyConfig } from "@/lib/contracts";
import { Button } from "@/components/ui/Button";

interface PolicyViewerProps {
  agentId: string;
  initialYaml: string;
  config: PolicyConfig;
}

export function PolicyViewer({ agentId, initialYaml, config }: PolicyViewerProps) {
  const router = useRouter();
  const [rawYaml, setRawYaml] = useState(initialYaml);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ success?: boolean; message?: string } | null>(null);

  async function handleSave() {
    setIsSaving(true);
    setSaveStatus(null);

    try {
      const res = await fetch(`/api/policies/${agentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: rawYaml }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSaveStatus({ success: true, message: `Saved as revision ${data.version}. Running agents pick it up within ~15 seconds.` });
        // The summary cards above read `config` straight from props (this
        // component's own server-rendered parent) — without a refresh they
        // silently keep showing the values from before the save, even
        // though the save itself succeeded and persisted.
        router.refresh();
      } else {
        setSaveStatus({ success: false, message: data.error || "Policy doesn’t match the schema." });
      }
    } catch {
      setSaveStatus({ success: false, message: "A connection error occurred." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Rule summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xs border border-border bg-surface p-4">
          <span className="text-[11px] text-muted uppercase">Budget Limits</span>
          <div className="mt-2 space-y-1 font-mono text-xs">
            {config.budgets.map((b) => (
              <div key={b.scope} className="flex justify-between">
                <span className="text-muted">{b.scope}:</span>
                <span className="font-semibold">{b.limitUsdc} USDC</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xs border border-border bg-surface p-4">
          <span className="text-[11px] text-muted uppercase">Per-Call Ceiling</span>
          <div className="mt-2 space-y-1 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Max amount:</span>
              <span className="font-semibold">{config.perCall.maxUsdc} USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Calls per minute:</span>
              <span className="font-semibold">{config.perCall.maxCallsPerMinute}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xs border border-border bg-surface p-4">
          <span className="text-[11px] text-muted uppercase">Counterparty Mode</span>
          <div className="mt-2 space-y-1 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Mode:</span>
              <span className="font-semibold text-signal">{config.counterparties.mode}</span>
            </div>
            {config.counterparties.mode === "allowlist" ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted">Allowed addresses:</span>
                  <span className="font-semibold">{config.counterparties.allow.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Not on the list:</span>
                  <span className="font-semibold text-held">
                    {config.counterparties.firstSeen.action === "hold" ? "hold" : "block"}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-muted">Denied addresses:</span>
                  <span className="font-semibold">{config.counterparties.deny.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">First seen:</span>
                  <span className="font-semibold text-held">{config.counterparties.firstSeen.action}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="rounded-xs border border-border bg-surface p-4">
          <span className="text-[11px] text-muted uppercase">Anomaly &amp; Escalation</span>
          <div className="mt-2 space-y-1 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-muted">EWMA z-threshold:</span>
              <span className="font-semibold">{config.anomaly.burnRate.zThreshold}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Half-life:</span>
              <span className="font-semibold">{config.anomaly.burnRate.halflifeMinutes} min</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Timeout:</span>
              <span className="font-semibold">{config.escalation.timeoutSeconds} sec</span>
            </div>
          </div>
        </div>
      </div>

      {/* YAML Editor */}
      <div className="rounded-md border border-border bg-surface p-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h2 className="text-sm font-semibold">
              <label htmlFor="policy-yaml">Policy file (YAML)</label>
            </h2>
            <p className="text-xs text-muted">
              Checked against the schema before it&rsquo;s saved; an invalid policy never replaces the current one.
            </p>
          </div>
          <Button onClick={handleSave} disabled={isSaving} className="text-xs">
            {isSaving ? "Checking…" : "Check & save"}
          </Button>
        </div>

        {saveStatus && (
          <div
            role={saveStatus.success ? "status" : "alert"}
            className={`mt-4 rounded-xs p-3 text-xs font-mono ${
              saveStatus.success
                ? "border border-signal/30 bg-signal/10 text-signal"
                : "border border-critical/30 bg-critical/10 text-critical"
            }`}
          >
            {saveStatus.message}
          </div>
        )}

        <div className="mt-4">
          <textarea
            id="policy-yaml"
            value={rawYaml}
            onChange={(e) => setRawYaml(e.target.value)}
            rows={22}
            className="field w-full rounded-xs bg-bg p-4 font-mono text-xs leading-relaxed text-fg"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}
