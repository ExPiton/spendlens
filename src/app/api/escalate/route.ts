import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey, isResponse } from "@/lib/auth/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getAgentRecordBySlug } from "@/lib/db/agents";
import { getPolicyBySlug } from "@/lib/db/policy";
import { recordHoldDecision } from "@/lib/db/ingest";

/**
 * Escalation webhook target. Point a policy's `escalation.webhook` at this URL
 * (`<APP_URL>/api/escalate`) with the agent's API key as a bearer token, and
 * the SDK will call it on every `hold` verdict.
 *
 *   escalation:
 *     webhook: "https://spendlens.example.com/api/escalate"
 *     timeout_seconds: 30
 *     on_timeout: block
 *     auto_approve_below_usdc: 0.05   # optional, see below
 *
 * Decision rule: auto-approve when the amount is at or below
 * `escalation.auto_approve_below_usdc`, otherwise deny. This is
 * *deliberately not* `counterparties.first_seen.auto_allow_below_usdc` — a
 * first_seen hold only ever fires for an amount *above* that ceiling (at or
 * under it, first_seen auto-allows without ever holding), so reusing it here
 * would make every first_seen hold unapprovable by construction. When
 * `auto_approve_below_usdc` isn't set, this falls back to 5x the first_seen
 * ceiling — tune it directly in the policy for real risk tolerance. Either
 * way the outcome is written to the ledger as `hold_approved` / `hold_denied`.
 */
const BodySchema = z.object({
  counterparty: z.string().min(1),
  resource: z.string().default(""),
  amountUsdc: z.number().nonnegative(),
  ruleHit: z.string().nullish(),
  taskId: z.string().nullish(),
  nonce: z.string().nullish(),
});

export async function POST(request: NextRequest) {
  const key = await requireApiKey(request);
  if (isResponse(key)) return key;

  const limited = enforceRateLimit(`escalate:${key.keyId}`, 240);
  if ("response" in limited) return limited.response;

  try {
    const input = BodySchema.parse(await request.json());

    const agent = await getAgentRecordBySlug(key.userId, key.agentSlug);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    if (agent.status === "paused") {
      // Mirrors the ingest gate — the kill switch must also stop a leaked
      // key from getting holds auto-approved via the escalation webhook.
      return NextResponse.json(
        { error: "Agent is halted; escalation rejected" },
        { status: 423 },
      );
    }

    const policy = await getPolicyBySlug(key.userId, key.agentSlug);
    const ceiling =
      policy?.config.escalation.autoApproveBelowUsdc ??
      (policy?.config.counterparties.firstSeen.autoAllowBelowUsdc ?? 0) * 5;
    const approved = input.amountUsdc > 0 && input.amountUsdc <= ceiling;
    const decision = approved ? "hold_approved" : "hold_denied";
    const reason = approved
      ? `amount $${input.amountUsdc} ≤ auto-approve ceiling $${ceiling}`
      : ceiling > 0
        ? `amount $${input.amountUsdc} exceeds auto-approve ceiling $${ceiling}`
        : "no auto-approve ceiling configured (escalation.auto_approve_below_usdc)";

    await recordHoldDecision(
      { userId: key.userId, agentId: agent.id, agentSlug: agent.slug },
      {
        decision,
        counterparty: input.counterparty,
        resource: input.resource,
        amountMicroUsdc: Math.round(input.amountUsdc * 1_000_000),
        ruleHit: input.ruleHit ?? null,
        taskId: input.taskId ?? null,
        nonce: input.nonce ?? null,
      },
    );

    return NextResponse.json(
      { approved, decision, reason },
      { headers: limited.headers },
    );
  } catch (err) {
    console.error("[spendlens] POST /api/escalate failed:", err);
    return NextResponse.json({ error: "Invalid escalation payload" }, { status: 400 });
  }
}
