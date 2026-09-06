"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { StatusInline } from "@/components/ui/StatusPill";
import { decisionTone, DECISION_LABELS } from "@/lib/status";
import { formatUsdcPrecise } from "@/lib/format";
import type { Decision } from "@/lib/contracts";

interface ScenarioResult {
  scenario: string;
  title: string;
  summary: string;
  preventedLossUsdc?: number;
  wastedSpendUsdc?: number;
  blockedCount?: number;
  status?: string;
  deltaUsdc?: number;
  actionRecommended?: string;
  records?: Array<{
    id: string;
    ts: string;
    counterparty: string;
    amountMicroUsdc: number;
    decision: Decision;
    ruleHit: string | null;
  }>;
}

export function ScenarioRunner({ agentId = "research-crawler-01" }: { agentId?: string }) {
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);

  async function runScenario(scenario: "A" | "B" | "C") {
    setRunningScenario(scenario);
    setResult(null);

    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, agentId }),
      });

      if (res.ok) {
        const data = await res.json();
        setResult(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRunningScenario(null);
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs font-semibold tracking-wider text-muted uppercase">
            Interactive Failure Scenario Simulator
          </span>
          <h3 className="mt-1 text-lg font-semibold">
            Test the 3 critical scenarios existing tools miss — and Spendlens catches
          </h3>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Scenario A */}
        <div className="flex flex-col justify-between rounded-xs border border-border bg-surface-2 p-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-signal">Scenario A</span>
              <span className="rounded-xs bg-critical/10 px-1.5 py-0.5 text-[10px] font-medium text-critical">
                Prompt Injection
              </span>
            </div>
            <h4 className="mt-2 text-sm font-semibold">Prompt injection redirect</h4>
            <p className="mt-1 text-xs text-muted">
              4,000 rapid micro-calls to an attacker-controlled address. No single call exceeds the per-call limit, but the budget and unauthorized-address checks catch it.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-border/50">
            <Button
              variant="secondary"
              className="w-full text-xs justify-center"
              disabled={runningScenario !== null}
              onClick={() => runScenario("A")}
            >
              {runningScenario === "A" ? "Simulating..." : "Run Scenario A"}
            </Button>
          </div>
        </div>

        {/* Scenario B */}
        <div className="flex flex-col justify-between rounded-xs border border-border bg-surface-2 p-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-signal">Scenario B</span>
              <span className="rounded-xs bg-held/10 px-1.5 py-0.5 text-[10px] font-medium text-held">
                Quality Degradation
              </span>
            </div>
            <h4 className="mt-2 text-sm font-semibold">Silent quality degradation</h4>
            <p className="mt-1 text-xs text-muted">
              The provider returns 200 OK with an empty body (0 bytes). A standard payment flow keeps paying uninterrupted — Spendlens logs it as wasted spend.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-border/50">
            <Button
              variant="secondary"
              className="w-full text-xs justify-center"
              disabled={runningScenario !== null}
              onClick={() => runScenario("B")}
            >
              {runningScenario === "B" ? "Simulating..." : "Run Scenario B"}
            </Button>
          </div>
        </div>

        {/* Scenario C */}
        <div className="flex flex-col justify-between rounded-xs border border-border bg-surface-2 p-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-signal">Scenario C</span>
              <span className="rounded-xs bg-critical/10 px-1.5 py-0.5 text-[10px] font-medium text-critical">
                Key Leak / Divergence
              </span>
            </div>
            <h4 className="mt-2 text-sm font-semibold">Signing key leak</h4>
            <p className="mt-1 text-xs text-muted">
              The attacker spends using the leaked key. Arc reconciliation catches the phantom settlement between chain and ledger, and halts the agent.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-border/50">
            <Button
              variant="secondary"
              className="w-full text-xs justify-center"
              disabled={runningScenario !== null}
              onClick={() => runScenario("C")}
            >
              {runningScenario === "C" ? "Simulating..." : "Run Scenario C"}
            </Button>
          </div>
        </div>
      </div>

      {/* Result Output */}
      {result && (
        <div className="mt-6 rounded-xs border border-signal/30 bg-bg p-4 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-signal" />
              <span className="font-semibold text-xs text-fg">{result.title}</span>
            </div>
            {result.status === "critical" && (
              <span className="rounded-xs bg-critical px-2 py-0.5 font-mono text-[10px] font-bold text-paper">
                CRITICAL ALERT
              </span>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">{result.summary}</p>

          {result.records && result.records.length > 0 && (
            <div className="mt-4 max-h-48 overflow-y-auto rounded-xs border border-border bg-surface p-2">
              <div className="text-[10px] text-muted font-mono mb-1">
                Live telemetry stream generated ({result.records.length} records):
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                {result.records.slice(0, 8).map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 border-b border-border/30 py-0.5">
                    <span className="max-w-32 truncate text-muted" title={r.counterparty}>
                      {r.counterparty}
                    </span>
                    <MonoNumber className="text-fg">{formatUsdcPrecise(r.amountMicroUsdc)} USDC</MonoNumber>
                    <StatusInline tone={decisionTone(r.decision)}>
                      {DECISION_LABELS[r.decision]}
                      {r.ruleHit ? ` (${r.ruleHit})` : ""}
                    </StatusInline>
                  </div>
                ))}
                {result.records.length > 8 && (
                  <div className="text-center text-[10px] text-muted pt-1">
                    ... and {result.records.length - 8} more records blocked ...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
