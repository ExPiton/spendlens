"use client";

import { useState } from "react";
import { ScenarioRunner } from "@/components/dashboard/ScenarioRunner";
import { Button } from "@/components/ui/Button";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { StatusInline } from "@/components/ui/StatusPill";
import { decisionTone, DECISION_LABELS, qualityTone, QUALITY_LABELS } from "@/lib/status";
import { formatUsdcPrecise } from "@/lib/format";
import type { AuthorizationRecord } from "@/lib/contracts";
import type { EvaluationVerdict } from "@/sdk/policy-engine";

type CustomSimulationResult =
  | { verdict: EvaluationVerdict; record: AuthorizationRecord }
  | { error: string };

/** Every label is tied to its control (`htmlFor` / `id`): the old markup put a
 *  bare <label> above each input, so none of the seven fields had a name. */
function SandboxField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

const CONTROL = "field w-full rounded-xs bg-bg p-2 font-mono text-fg";

export function SimulatorSandbox({ agentId }: { agentId: string }) {
  const [customCounterparty, setCustomCounterparty] = useState("api.example.io");
  const [customUrl, setCustomUrl] = useState("https://api.example.io/v1/data");
  const [customAmount, setCustomAmount] = useState("0.003");
  const [customStatus, setCustomStatus] = useState("200");
  const [customBodyBytes, setCustomBodyBytes] = useState("256");
  const [customLatencyMs, setCustomLatencyMs] = useState("140");
  const [customTaskId, setCustomTaskId] = useState("task-manual-test");
  const [isSimulating, setIsSimulating] = useState(false);
  const [customResult, setCustomResult] = useState<CustomSimulationResult | null>(null);

  async function handleCustomSimulate() {
    // Validate here instead of silently substituting defaults: "0" used to be
    // replaced by 0.003 (`parseFloat("0") || 0.003`) and "abc" by a default.
    const amount = Number(customAmount);
    const status = Number(customStatus);
    const bodyBytes = Number(customBodyBytes);
    const latencyMs = Number(customLatencyMs);
    if (customAmount.trim() === "" || !Number.isFinite(amount) || amount < 0) {
      setCustomResult({ error: "Amount must be a number ≥ 0 (USDC)." });
      return;
    }
    if (!Number.isInteger(bodyBytes) || bodyBytes < 0 || !Number.isInteger(latencyMs) || latencyMs < 0) {
      setCustomResult({ error: "Body size and latency must be whole numbers ≥ 0." });
      return;
    }

    setIsSimulating(true);
    setCustomResult(null);

    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          counterparty: customCounterparty,
          url: customUrl,
          amount,
          status,
          bodyBytes,
          latencyMs,
          taskId: customTaskId,
        }),
      });

      const data: CustomSimulationResult = await res.json();
      setCustomResult(data);
    } catch {
      setCustomResult({ error: "A connection error occurred." });
    } finally {
      setIsSimulating(false);
    }
  }

  return (
    <>
      {/* 3 Core Scenarios Runner */}
      <ScenarioRunner agentId={agentId} />

      {/* Custom Request Sandbox */}
      <div className="rounded-md border border-border bg-surface p-6">
        <div className="border-b border-border pb-4">
          <h2 className="text-sm font-semibold">Custom call sandbox</h2>
          <p className="mt-0.5 text-xs text-muted">
            Simulate an HTTP 402 payment call with any parameters and inspect the Spendlens engine&rsquo;s decision.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <SandboxField id="sim-counterparty" label="Counterparty (domain or address)">
            <input
              id="sim-counterparty"
              name="counterparty"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={customCounterparty}
              onChange={(e) => setCustomCounterparty(e.target.value)}
              className={CONTROL}
            />
          </SandboxField>

          <SandboxField id="sim-url" label="Target resource URL">
            <input
              id="sim-url"
              name="url"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              className={CONTROL}
            />
          </SandboxField>

          <SandboxField id="sim-amount" label="Requested amount (USDC)">
            <input
              id="sim-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              className={CONTROL}
            />
          </SandboxField>

          <SandboxField id="sim-status" label="HTTP status code">
            <select
              id="sim-status"
              name="status"
              value={customStatus}
              onChange={(e) => setCustomStatus(e.target.value)}
              className={CONTROL}
            >
              <option value="200">200 OK</option>
              <option value="402">402 Payment Required</option>
              <option value="429">429 Rate Limit Exceeded</option>
              <option value="500">500 Internal Server Error</option>
              <option value="502">502 Bad Gateway</option>
              <option value="504">504 Gateway Timeout</option>
            </select>
          </SandboxField>

          <SandboxField id="sim-body-bytes" label="Response body size (bytes)">
            <input
              id="sim-body-bytes"
              name="bodyBytes"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={customBodyBytes}
              onChange={(e) => setCustomBodyBytes(e.target.value)}
              placeholder="0 (empty) or more"
              className={CONTROL}
            />
          </SandboxField>

          <SandboxField id="sim-latency" label="Latency (ms)">
            <input
              id="sim-latency"
              name="latencyMs"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={customLatencyMs}
              onChange={(e) => setCustomLatencyMs(e.target.value)}
              className={CONTROL}
            />
          </SandboxField>

          <SandboxField id="sim-task" label="Task ID">
            <input
              id="sim-task"
              name="taskId"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={customTaskId}
              onChange={(e) => setCustomTaskId(e.target.value)}
              placeholder="affects the per-task budget"
              className={CONTROL}
            />
          </SandboxField>
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={handleCustomSimulate} disabled={isSimulating} className="text-xs">
            {isSimulating ? "Evaluating…" : "Run through the policy engine"}
          </Button>
        </div>

        {/* Custom Simulation Result */}
        {customResult && "error" in customResult && (
          <div role="alert" className="mt-6 rounded-xs border border-critical/40 bg-critical/5 p-4 text-xs text-critical">
            {customResult.error}
          </div>
        )}

        {customResult && "record" in customResult && (
          <div role="status" className="mt-6 rounded-xs border border-border bg-bg p-4">
            <h3 className="text-xs font-semibold uppercase text-muted tracking-wider">
              Simulation result &amp; telemetry
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs font-mono">
              <div className="rounded-xs bg-surface p-3">
                <span className="text-muted block text-[11px]">Decision:</span>
                <div className="mt-1">
                  {customResult.verdict.decision === "hold" ? (
                    // The record says hold_denied only because nobody can answer
                    // in a simulation — the engine's actual verdict is a hold.
                    <StatusInline tone="held">held · would wait for a human</StatusInline>
                  ) : (
                    <StatusInline tone={decisionTone(customResult.record.decision)}>
                      {DECISION_LABELS[customResult.record.decision]}
                    </StatusInline>
                  )}
                </div>
                {customResult.verdict.ruleHit && (
                  <div className="mt-1 text-critical text-[11px]">
                    Rule: {customResult.verdict.ruleHit}
                  </div>
                )}
              </div>

              <div className="rounded-xs bg-surface p-3">
                <span className="text-muted block text-[11px]">Quality status:</span>
                <div className="mt-1">
                  {customResult.record.quality ? (
                    <StatusInline tone={qualityTone(customResult.record.quality)}>
                      {QUALITY_LABELS[customResult.record.quality]}
                    </StatusInline>
                  ) : (
                    <span className="text-muted">Blocked / not processed</span>
                  )}
                </div>
              </div>

              <div className="rounded-xs bg-surface p-3">
                <span className="text-muted block text-[11px]">Amount:</span>
                <MonoNumber className="mt-1 block font-semibold text-fg">
                  {formatUsdcPrecise(customResult.record.amountMicroUsdc)} USDC
                </MonoNumber>
              </div>
            </div>

            <div className="mt-3 rounded-xs bg-surface p-3 text-[11px] font-mono text-muted">
              <div>Simulation only. Nothing was signed, paid or saved.</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
