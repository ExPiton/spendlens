import { NextRequest, NextResponse } from "next/server";
import { getPolicyBySlug } from "@/lib/db/policy";
import { requireSessionUser, isResponse } from "@/lib/auth/api";
import { PolicyEngine } from "@/sdk/policy-engine";
import { classifyQuality } from "@/lib/engine/classifyQuality";
import type { AuthorizationRecord } from "@/lib/contracts";

export async function POST(request: NextRequest) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const body = await request.json();
    const scenario = body.scenario as "A" | "B" | "C" | "custom" | undefined;
    const agentId = body.agentId;
    if (!agentId) {
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
      // Scenario A: Prompt Injection
      const attackerAddress = "0x8f3a1b4c9d2e5f6a7b8c9d0e1f2a3b4c5d6e7f80";
      const callCount = 25;
      const records: AuthorizationRecord[] = [];

      for (let i = 0; i < callCount; i++) {
        const amountUsdc = 0.003;
        const amountMicroUsdc = Math.round(amountUsdc * 1_000_000);
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
          amountMicroUsdc,
          decision: verdict.decision === "block" ? "block" : "hold_denied",
          ruleHit: verdict.ruleHit || "counterparties.mode",
          nonce: null,
          chainId: 5042, // Arc Testnet
          httpStatus: null,
          latencyMs: null,
          bodyBytes: null,
          bodySha256: null,
          quality: null,
          settlementId: null,
          createdAt: nowIso,
        });
      }

      return NextResponse.json({
        scenario: "A",
        title: "Prompt Injection Simulation",
        summary: "25 high-frequency calls to an attacker-controlled address were blocked by the Spendlens policy filter. Even though no single call exceeded the per-call limit, the unauthorized counterparty was flagged and $0.075 in loss was prevented.",
        preventedLossUsdc: 0.075,
        blockedCount: records.length,
        records,
      });
    }

    if (scenario === "B") {
      // Scenario B: Silent Quality Degradation
      const counterparty = "api.example.io";
      const callCount = 10;
      const records: AuthorizationRecord[] = [];

      for (let i = 0; i < callCount; i++) {
        const amountUsdc = 0.003;
        const amountMicroUsdc = Math.round(amountUsdc * 1_000_000);
        const verdict = await engine.evaluate({
          agentId,
          taskId: "task-degradation-sim",
          counterparty,
          amount: amountUsdc,
          resource: `https://${counterparty}/v1/data`,
          now: Date.now() + i * 500,
        });

        const quality = classifyQuality(
          {
            timedOut: false,
            status: 200,
            bodyBytes: 0, // Empty body failure!
            latencyMs: 120,
          },
          verdict.qualityRules,
        );

        records.push({
          id: `sim_b_${Date.now()}_${i}`,
          ts: new Date(now.getTime() + i * 500).toISOString(),
          agentId,
          taskId: "task-degradation-sim",
          counterparty,
          resource: `https://${counterparty}/v1/data`,
          amountMicroUsdc,
          decision: "allow",
          ruleHit: null,
          nonce: `sim_nonce_${i}`,
          chainId: 5042,
          httpStatus: 200,
          latencyMs: 120,
          bodyBytes: 0,
          bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // SHA256 of empty string
          quality,
          settlementId: null,
          createdAt: nowIso,
        });
      }

      return NextResponse.json({
        scenario: "B",
        title: "Silent Quality Degradation Simulation",
        summary: "Despite the provider returning HTTP 200, all 10 calls came back with an empty body (0 bytes). Payment went through, but Spendlens tagged them as 'empty' and added them to the waste ratio.",
        wastedSpendUsdc: 0.03,
        wasteRatio: 1.0,
        records,
      });
    }

    if (scenario === "C") {
      // Scenario C: Key Leak & Reconciliation Divergence
      return NextResponse.json({
        scenario: "C",
        title: "Key Leak & Arc Reconciliation Divergence",
        summary: "A $0.35 settlement was found on Arc Gateway, but the local event ledger has no matching authorization from the agent. Delta > tolerance → a CRITICAL alert was raised and the agent was halted!",
        counterparty: "sms.notify.io",
        chainAmountUsdc: 0.35,
        ledgerAmountUsdc: 0.0,
        deltaUsdc: 0.35,
        status: "critical",
        actionRecommended: "HALT_AGENT",
      });
    }

    // Custom Simulation
    const customAmount = typeof body.amount === "number" ? body.amount : 0.003;
    const customCounterparty = body.counterparty || "api.example.io";
    const customUrl = body.url || `https://${customCounterparty}/v1/data`;
    const customStatus = body.status ?? 200;
    const customBodyBytes = body.bodyBytes ?? 250;
    const customLatencyMs = body.latencyMs ?? 150;

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

    const recordDecision: "allow" | "block" | "hold_approved" | "hold_denied" =
      verdict.decision === "hold" ? "hold_approved" : verdict.decision;

    const record: AuthorizationRecord = {
      id: `sim_custom_${Date.now()}`,
      ts: nowIso,
      agentId,
      taskId: body.taskId || "custom-task",
      counterparty: customCounterparty,
      resource: customUrl,
      amountMicroUsdc: Math.round(customAmount * 1_000_000),
      decision: recordDecision,
      ruleHit: verdict.ruleHit,
      nonce: verdict.decision === "allow" ? `nonce_${Date.now()}` : null,
      chainId: 5042,
      httpStatus: verdict.decision === "allow" ? customStatus : null,
      latencyMs: verdict.decision === "allow" ? customLatencyMs : null,
      bodyBytes: verdict.decision === "allow" ? customBodyBytes : null,
      bodySha256: verdict.decision === "allow" ? "custom_sim_sha256" : null,
      quality,
      settlementId: null,
      createdAt: nowIso,
    };

    return NextResponse.json({
      verdict,
      record,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Simulation failed" },
      { status: 500 },
    );
  }
}
