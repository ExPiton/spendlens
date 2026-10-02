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
  /** Scenario A: how many of the 25 calls the saved policy actually stopped. */
  outcome?: "stopped" | "partial" | "missed";
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

export function ScenarioRunner({ agentId }: { agentId: string }) {
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runScenario(scenario: "A" | "B" | "C") {
    setRunningScenario(scenario);
    setResult(null);
    setError(null);

    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, agentId }),
      });

      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setResult(data);
      } else {
        setError(data?.error ?? `The simulation failed (HTTP ${res.status}).`);
      }
    } catch (err) {
      console.error(err);
      setError("Could not reach the server. Check your connection and try again.");
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
          <h2 className="mt-1 text-lg font-semibold">
            Would this agent&rsquo;s policy stop these three failures?
          </h2>
          <p className="mt-1 text-xs text-muted">
            Runs this agent&rsquo;s saved policy through the real policy engine, starting from empty budgets.
            Simulations never write to the ledger or change an agent&rsquo;s status.
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Scenario A */}
        <div className="flex flex-col justify-between rounded-xs border border-border bg-surface-2 p-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-signal">Scenario A</span>
              <span className="rounded-xs border border-critical/40 bg-critical/10 px-1.5 py-0.5 text-[11px] font-medium text-fg">
                Prompt Injection
              </span>
            </div>
            <h3 className="mt-2 text-sm font-semibold">Prompt injection redirect</h3>
            <p className="mt-1 text-xs text-muted">
              25 rapid micro-calls to an attacker-controlled address. No single call exceeds the per-call limit. The question is whether your counterparty rules catch the redirect.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-border/50">
            <Button
              variant="secondary"
              className="w-full text-xs justify-center"
              disabled={runningScenario !== null}
              onClick={() => runScenario("A")}
            >
              {runningScenario === "A" ? "Simulating…" : "Run Scenario A"}
            </Button>
          </div>
        </div>

        {/* Scenario B */}
        <div className="flex flex-col justify-between rounded-xs border border-border bg-surface-2 p-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-signal">Scenario B</span>
              <span className="rounded-xs bg-held/10 px-1.5 py-0.5 text-[11px] font-medium text-held">
                Quality Degradation
              </span>
            </div>
            <h3 className="mt-2 text-sm font-semibold">Silent quality degradation</h3>
            <p className="mt-1 text-xs text-muted">
              The provider returns 200 OK with an empty body (0 bytes). A standard payment flow keeps paying uninterrupted. Spendlens logs it as wasted spend.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-border/50">
            <Button
              variant="secondary"
              className="w-full text-xs justify-center"
              disabled={runningScenario !== null}
              onClick={() => runScenario("B")}
            >
              {runningScenario === "B" ? "Simulating…" : "Run Scenario B"}
            </Button>
          </div>
        </div>

        {/* Scenario C */}
        <div className="flex flex-col justify-between rounded-xs border border-border bg-surface-2 p-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-signal">Scenario C</span>
              <span className="rounded-xs border border-critical/40 bg-critical/10 px-1.5 py-0.5 text-[11px] font-medium text-fg">
                Key Leak / Divergence
              </span>
            </div>
            <h3 className="mt-2 text-sm font-semibold">Signing key leak</h3>
            <p className="mt-1 text-xs text-muted">
              The attacker spends using the leaked key. Arc reconciliation catches the phantom settlement between chain and ledger and, with the agent&rsquo;s wallet address on file, halts the agent.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-border/50">
            <Button
              variant="secondary"
              className="w-full text-xs justify-center"
              disabled={runningScenario !== null}
              onClick={() => runScenario("C")}
            >
              {runningScenario === "C" ? "Simulating…" : "Run Scenario C"}
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-xs border border-critical/40 bg-critical/5 p-4 text-xs text-critical" role="alert">
          {error}
        </div>
      )}

      {/* Result Output */}
      {result && (
        <div role="status" className="mt-6 rounded-xs border border-signal/30 bg-bg p-4">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-signal" />
              <span className="font-semibold text-xs text-fg">{result.title}</span>
            </div>
            {result.status === "critical" && (
              <span className="rounded-xs bg-critical px-2 py-0.5 font-mono text-[11px] font-bold text-on-critical">
                CRITICAL · ILLUSTRATION
              </span>
            )}
            {result.outcome === "stopped" && (
              <span className="rounded-xs bg-signal/15 px-2 py-0.5 font-mono text-[11px] font-bold text-signal">
                ALL STOPPED
              </span>
            )}
            {result.outcome === "partial" && (
              <span className="rounded-xs bg-held/15 px-2 py-0.5 font-mono text-[11px] font-bold text-held">
                PARTIALLY STOPPED
              </span>
            )}
            {result.outcome === "missed" && (
              <span className="rounded-xs bg-critical px-2 py-0.5 font-mono text-[11px] font-bold text-on-critical">
                NOT STOPPED
              </span>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">{result.summary}</p>

          {result.records && result.records.length > 0 && (
            <div className="mt-4 max-h-48 overflow-y-auto rounded-xs border border-border bg-surface p-2">
              <div className="text-[11px] text-muted font-mono mb-1">
                Simulated decisions ({result.records.length} records, nothing saved):
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                {result.records.slice(0, 8).map((r) => (
                  // A grid, not flex + space-between: with a long rule name on one
                  // row the amount column used to jump sideways.
                  <div
                    key={r.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.3fr)] items-center gap-3 border-b border-border/30 py-0.5"
                  >
                    <span className="truncate text-muted" title={r.counterparty}>
                      {r.counterparty}
                    </span>
                    <MonoNumber className="text-right text-fg">{formatUsdcPrecise(r.amountMicroUsdc)} USDC</MonoNumber>
                    <span className="truncate">
                      <StatusInline tone={decisionTone(r.decision)}>
                        {DECISION_LABELS[r.decision]}
                        {r.ruleHit ? ` · ${r.ruleHit}` : ""}
                      </StatusInline>
                    </span>
                  </div>
                ))}
                {result.records.length > 8 && (
                  <div className="text-center text-[11px] text-muted pt-1">
                    …and {result.records.length - 8} more
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
