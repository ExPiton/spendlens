import { NextRequest, NextResponse } from "next/server";
import { getPolicyBySlug } from "@/lib/db/policy";
import { requireSessionUser, isResponse } from "@/lib/auth/api";
import { ARC } from "@/lib/arc";
import { PolicyEngine, type EvaluationVerdict } from "@/sdk/policy-engine";
import { classifyQuality } from "@/lib/engine/classifyQuality";
import type { AuthorizationRecord } from "@/lib/contracts";

/**
 * Policy simulator (session-scoped). Everything here runs the agent's REAL
 * saved policy through the REAL policy engine and reports what it actually
 * decided — the summaries are computed from those verdicts, never canned. A
 * simulation starts from empty budgets/baselines and never writes to the
 * ledger or touches an agent's status.
 */

/** "0.075", "0.072", "1.5" — micro-USDC without trailing zeros. */
const usdc = (micro: number) => (micro / 1_000_000).toFixed(6).replace(/\.?0+$/, "");
const sum = (rs: AuthorizationRecord[]) => rs.reduce((s, r) => s + r.amountMicroUsdc, 0);

/** The engine's verdict in the ledger's vocabulary. A `hold` waits for a
 *  person; in a simulation nobody answers, so it reads as held · denied. */
function asDecision(v: EvaluationVerdict["decision"]): AuthorizationRecord["decision"] {
  return v === "allow" ? "allow" : v === "block" ? "block" : "hold_denied";
}

function finiteNumber(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === "") return fallback;
  return typeof v === "number" ? v : Number(v);
}

export async function POST(request: NextRequest) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const body = await request.json();
    const scenario = body.scenario as "A" | "B" | "C" | "custom" | undefined;
    const agentId = body.agentId;
    if (typeof agentId !== "string" || !agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }

    const loaded = await getPolicyBySlug(auth.userId, agentId);
    if (!loaded) {
      return NextResponse.json(
        { error: "Policy not found for agent" },
        { status: 400 },
      );
    }

    const engine = new PolicyEngine(loaded.config);
    const now = new Date();
    const nowIso = now.toISOString();

    if (scenario === "A") {
      // Scenario A: prompt injection — 25 rapid micro-calls to an address
      // the policy has never heard of.
      const attackerAddress = "0x8f3a1b4c9d2e5f6a7b8c9d0e1f2a3b4c5d6e7f80";
      const callCount = 25;
      const records: AuthorizationRecord[] = [];

      for (let i = 0; i < callCount; i++) {
        const amountUsdc = 0.003;
        const verdict = await engine.evaluate({
          agentId,
          taskId: "task-injection-sim",
          counterparty: attackerAddress,
          amount: amountUsdc,
          resource: attackerAddress,
          now: Date.now() + i * 50,
        });

        records.push({
          id: `sim_a_${Date.now()}_${i}`,
          ts: new Date(now.getTime() + i * 50).toISOString(),
          agentId,
          taskId: "task-injection-sim",
          counterparty: attackerAddress,
          resource: attackerAddress,
          amountMicroUsdc: Math.round(amountUsdc * 1_000_000),
          decision: asDecision(verdict.decision),
          ruleHit: verdict.ruleHit,
          nonce: null,
          chainId: ARC.chainId,
          httpStatus: null,
          latencyMs: null,
          bodyBytes: null,
          bodySha256: null,
          quality: null,
          settlementId: null,
          createdAt: nowIso,
        });
      }

      const paid = records.filter((r) => r.decision === "allow");
      const stopped = records.filter((r) => r.decision !== "allow");
      const held = stopped.filter((r) => r.decision === "hold_denied").length;
      const outcome = paid.length === 0 ? "stopped" : stopped.length === 0 ? "missed" : "partial";

      const summary =
        outcome === "stopped"
          ? `All ${callCount} calls to the attacker-controlled address were stopped under this agent's current policy ` +
            `(${stopped.length - held} blocked, ${held} held for a human) — ${usdc(sum(stopped))} USDC of spend prevented.`
          : `Under this agent's current policy ${paid.length} of ${callCount} calls to the attacker-controlled address ` +
            `would have been PAID (${usdc(sum(paid))} USDC)` +
            (stopped.length > 0 ? `; only ${stopped.length} were stopped (${usdc(sum(stopped))} USDC).` : ".") +
            ` No single call exceeds the per-call limit, so what stops a redirect is the counterparty gate: set ` +
            `counterparties.mode to "allowlist", or first_seen.action to "block" / "hold" with auto_allow_below_usdc: 0.`;

      return NextResponse.json({
        scenario: "A",
        title: "Prompt Injection Simulation",
        simulated: true,
        outcome,
        summary,
        preventedLossUsdc: sum(stopped) / 1_000_000,
        lossUsdc: sum(paid) / 1_000_000,
        blockedCount: stopped.length,
        allowedCount: paid.length,
        records,
      });
    }

    if (scenario === "B") {
      // Scenario B: the provider breaks — HTTP 200 with an empty body.
      const counterparty = "api.example.io";
      const callCount = 10;
      const records: AuthorizationRecord[] = [];

      for (let i = 0; i < callCount; i++) {
        const amountUsdc = 0.003;
        const verdict = await engine.evaluate({
          agentId,
          taskId: "task-degradation-sim",
          counterparty,
          amount: amountUsdc,
          resource: `https://${counterparty}/v1/data`,
          now: Date.now() + i * 500,
        });
        const paid = verdict.decision === "allow";

        records.push({
          id: `sim_b_${Date.now()}_${i}`,
          ts: new Date(now.getTime() + i * 500).toISOString(),
          agentId,
          taskId: "task-degradation-sim",
          counterparty,
          resource: `https://${counterparty}/v1/data`,
          amountMicroUsdc: Math.round(amountUsdc * 1_000_000),
          decision: asDecision(verdict.decision),
          ruleHit: verdict.ruleHit,
          nonce: null,
          chainId: ARC.chainId,
          httpStatus: paid ? 200 : null,
          latencyMs: paid ? 120 : null,
          bodyBytes: paid ? 0 : null,
          // The empty string's SHA-256 — a real digest of a real (empty) body.
          bodySha256: paid ? "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" : null,
          quality: paid
            ? classifyQuality(
                { timedOut: false, status: 200, bodyBytes: 0, latencyMs: 120 },
                verdict.qualityRules,
              )
            : null,
          settlementId: null,
          createdAt: nowIso,
        });
      }

      const paid = records.filter((r) => r.decision === "allow");
      const wasted = paid.filter((r) => r.quality !== "ok");
      const notPaid = callCount - paid.length;
      const summary =
        paid.length === 0
          ? `Your policy stopped all ${callCount} calls before they were paid (${records[0].ruleHit ?? "policy"}), so there was no ` +
            `spend to classify. Try it on an agent whose policy allows ${counterparty}.`
          : `The provider answered HTTP 200 with an empty body (0 bytes) and the payments went through: ${wasted.length} of ` +
            `${paid.length} paid calls were classified "${wasted[0]?.quality ?? "ok"}" — ${usdc(sum(wasted))} USDC of wasted spend. ` +
            (notPaid > 0 ? `${notPaid} call(s) were stopped by your policy first. ` : "") +
            `In your real ledger these show up in the waste ratio; this simulation saves nothing.`;

      return NextResponse.json({
        scenario: "B",
        title: "Silent Quality Degradation Simulation",
        simulated: true,
        summary,
        wastedSpendUsdc: sum(wasted) / 1_000_000,
        wasteRatio: paid.length > 0 ? wasted.length / paid.length : 0,
        records,
      });
    }

    if (scenario === "C") {
      // Scenario C can't be evaluated by the engine — reconciliation compares
      // Circle Gateway's settlements with the ledger on a schedule. So this is
      // an illustration, labelled as one; nothing is changed.
      return NextResponse.json({
        scenario: "C",
        title: "Key Leak & Arc Reconciliation Divergence (illustration)",
        simulated: true,
        summary:
          "Illustration only — nothing was changed on your account and no agent was halted. If Circle Gateway showed a " +
          "0.35 USDC settlement from the agent's wallet that your ledger never recorded, Spendlens would mark that " +
          "counterparty CRITICAL on the Reconciliation screen, e-mail you, and — with RECONCILE_AUTO_HALT on (the default) — " +
          "pause the agent. This needs the agent's Arc wallet address (Agent page → Arc wallet); the check runs every " +
          "10 minutes and ignores the newest 5 minutes of settlements so in-flight ledger rows aren't mistaken for a leak.",
        counterparty: "sms.notify.io",
        chainAmountUsdc: 0.35,
        ledgerAmountUsdc: 0.0,
        deltaUsdc: 0.35,
        status: "critical",
        actionRecommended: "HALT_AGENT",
      });
    }

    // Custom simulation
    const customAmount = finiteNumber(body.amount, 0.003);
    const customStatus = finiteNumber(body.status, 200);
    const customBodyBytes = finiteNumber(body.bodyBytes, 250);
    const customLatencyMs = finiteNumber(body.latencyMs, 150);
    if (!Number.isFinite(customAmount) || customAmount < 0) {
      return NextResponse.json({ error: "Amount must be a number ≥ 0 (USDC)." }, { status: 400 });
    }
    if (!Number.isInteger(customStatus) || customStatus < 100 || customStatus > 599) {
      return NextResponse.json({ error: "HTTP status must be a whole number between 100 and 599." }, { status: 400 });
    }
    if (!Number.isInteger(customBodyBytes) || customBodyBytes < 0 || !Number.isInteger(customLatencyMs) || customLatencyMs < 0) {
      return NextResponse.json({ error: "Body size and latency must be whole numbers ≥ 0." }, { status: 400 });
    }
    const customCounterparty = String(body.counterparty || "api.example.io");
    const customUrl = String(body.url || `https://${customCounterparty}/v1/data`);

    const verdict = await engine.evaluate({
      agentId,
      taskId: body.taskId || "custom-task",
      counterparty: customCounterparty,
      amount: customAmount,
      resource: customUrl,
      now: Date.now(),
    });

    let quality = null;
    if (verdict.decision === "allow") {
      quality = classifyQuality(
        {
          timedOut: false,
          status: customStatus,
          bodyBytes: customBodyBytes,
          latencyMs: customLatencyMs,
        },
        verdict.qualityRules,
      );
    }

    const paid = verdict.decision === "allow";
    const record: AuthorizationRecord = {
      id: `sim_custom_${Date.now()}`,
      ts: nowIso,
      agentId,
      taskId: body.taskId || "custom-task",
      counterparty: customCounterparty,
      resource: customUrl,
      amountMicroUsdc: Math.round(customAmount * 1_000_000),
      decision: asDecision(verdict.decision),
      ruleHit: verdict.ruleHit,
      nonce: null,
      chainId: ARC.chainId,
      httpStatus: paid ? customStatus : null,
      latencyMs: paid ? customLatencyMs : null,
      bodyBytes: paid ? customBodyBytes : null,
      // No body was fetched, so there is no digest to show.
      bodySha256: null,
      quality,
      settlementId: null,
      createdAt: nowIso,
    };

    return NextResponse.json({
      simulated: true,
      verdict,
      record,
    });
  } catch (err) {
    console.error("[spendlens] POST /api/simulate failed:", err);
    return NextResponse.json({ error: "Simulation failed" }, { status: 500 });
  }
}
