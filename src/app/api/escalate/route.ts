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
 *
 * Decision rule: auto-approve when the amount is at or below the policy's
 * `counterparties.first_seen.auto_allow_below_usdc` ceiling (the "too small to
 * bother a human" threshold), otherwise deny. Either way the outcome is
 * written to the ledger as `hold_approved` / `hold_denied`.
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

    const policy = await getPolicyBySlug(key.userId, key.agentSlug);
    const ceiling = policy?.config.counterparties.firstSeen.autoAllowBelowUsdc ?? 0;
    const approved = input.amountUsdc > 0 && input.amountUsdc <= ceiling;
    const decision = approved ? "hold_approved" : "hold_denied";
    const reason = approved
      ? `amount $${input.amountUsdc} ≤ auto-approve ceiling $${ceiling}`
      : ceiling > 0
        ? `amount $${input.amountUsdc} exceeds auto-approve ceiling $${ceiling}`
        : "no auto-approve ceiling configured (first_seen.auto_allow_below_usdc)";

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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid escalation payload" },
      { status: 400 },
    );
  }
}
