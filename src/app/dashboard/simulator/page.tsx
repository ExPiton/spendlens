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

export default function SimulatorPage() {
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
    setIsSimulating(true);
    setCustomResult(null);

    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "research-crawler-01",
          counterparty: customCounterparty,
          url: customUrl,
          amount: parseFloat(customAmount) || 0.003,
          status: parseInt(customStatus, 10) || 200,
          bodyBytes: parseInt(customBodyBytes, 10) || 0,
          latencyMs: parseInt(customLatencyMs, 10) || 100,
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
    <div className="space-y-8">
      {/* Header */}
      <div className="border-b border-border pb-6">
        <span className="text-xs text-muted uppercase tracking-wider font-semibold">
          Live Test Environment — Simulator
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Interactive Scenario &amp; Policy Simulator</h1>
        <p className="mt-1 text-xs text-muted">
          Test Spendlens&apos;s 402 payment interception, anomaly checks, and quality analysis live.
        </p>
      </div>

      {/* 3 Core Scenarios Runner */}
      <ScenarioRunner agentId="research-crawler-01" />

      {/* Custom Request Sandbox */}
      <div className="rounded-md border border-border bg-surface p-6">
        <div className="border-b border-border pb-4">
          <h3 className="text-sm font-semibold">Custom Call Sandbox</h3>
          <p className="mt-0.5 text-xs text-muted">
            Simulate an HTTP 402 payment call with any parameters and inspect the Spendlens engine&apos;s decision.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 text-xs">
          <div>
            <label className="text-muted block mb-1">Counterparty (Domain / Address):</label>
            <input
              type="text"
              value={customCounterparty}
              onChange={(e) => setCustomCounterparty(e.target.value)}
              className="w-full rounded-xs border border-border bg-bg p-2 font-mono text-fg focus:border-signal focus:outline-none"
            />
          </div>

          <div>
            <label className="text-muted block mb-1">Target Resource URL:</label>
            <input
              type="text"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              className="w-full rounded-xs border border-border bg-bg p-2 font-mono text-fg focus:border-signal focus:outline-none"
            />
          </div>

          <div>
            <label className="text-muted block mb-1">Requested Amount (USDC):</label>
            <input
              type="text"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              className="w-full rounded-xs border border-border bg-bg p-2 font-mono text-fg focus:border-signal focus:outline-none"
            />
          </div>

          <div>
            <label className="text-muted block mb-1">HTTP Status Code:</label>
            <select
              value={customStatus}
              onChange={(e) => setCustomStatus(e.target.value)}
              className="w-full rounded-xs border border-border bg-bg p-2 font-mono text-fg focus:border-signal focus:outline-none"
            >
              <option value="200">200 OK</option>
              <option value="402">402 Payment Required</option>
              <option value="429">429 Rate Limit Exceeded</option>
              <option value="500">500 Internal Server Error</option>
              <option value="502">502 Bad Gateway</option>
              <option value="504">504 Gateway Timeout</option>
            </select>
          </div>

          <div>
            <label className="text-muted block mb-1">Response Body Size (Bytes):</label>
            <input
              type="text"
              value={customBodyBytes}
              onChange={(e) => setCustomBodyBytes(e.target.value)}
              placeholder="0 (empty) or > 0"
              className="w-full rounded-xs border border-border bg-bg p-2 font-mono text-fg focus:border-signal focus:outline-none"
            />
          </div>

          <div>
            <label className="text-muted block mb-1">Latency (ms):</label>
            <input
              type="text"
              value={customLatencyMs}
              onChange={(e) => setCustomLatencyMs(e.target.value)}
              className="w-full rounded-xs border border-border bg-bg p-2 font-mono text-fg focus:border-signal focus:outline-none"
            />
          </div>

          <div>
            <label className="text-muted block mb-1">Task ID:</label>
            <input
              type="text"
              value={customTaskId}
              onChange={(e) => setCustomTaskId(e.target.value)}
              placeholder="affects the per-task budget"
              className="w-full rounded-xs border border-border bg-bg p-2 font-mono text-fg focus:border-signal focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={handleCustomSimulate} disabled={isSimulating} className="text-xs">
            {isSimulating ? "Evaluating..." : "Run on the engine & test →"}
          </Button>
        </div>

        {/* Custom Simulation Result */}
        {customResult && "error" in customResult && (
          <div className="mt-6 rounded-xs border border-critical/40 bg-critical/5 p-4 text-xs text-critical">
            {customResult.error}
          </div>
        )}

        {customResult && "record" in customResult && (
          <div className="mt-6 rounded-xs border border-border bg-bg p-4 animate-fadeIn">
            <h4 className="text-xs font-semibold uppercase text-muted tracking-wider">
              Simulation Result &amp; Telemetry Output
            </h4>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs font-mono">
              <div className="rounded-xs bg-surface p-3">
                <span className="text-muted block text-[11px]">Decision:</span>
                <div className="mt-1">
                  <StatusInline tone={decisionTone(customResult.record.decision)}>
                    {DECISION_LABELS[customResult.record.decision]}
                  </StatusInline>
                </div>
                {customResult.verdict.ruleHit && (
                  <div className="mt-1 text-critical text-[11px]">
                    Rule: {customResult.verdict.ruleHit}
                  </div>
                )}
              </div>

              <div className="rounded-xs bg-surface p-3">
                <span className="text-muted block text-[11px]">Quality Status:</span>
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
              <div>Nonce: {customResult.record.nonce || "None (not signed)"}</div>
              <div className="mt-0.5">SHA-256 Digest: {customResult.record.bodySha256 || "None"}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
