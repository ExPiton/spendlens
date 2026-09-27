import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey, isResponse } from "@/lib/auth/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getPolicyBySlug } from "@/lib/db/policy";
import { createEscalation } from "@/lib/db/escalations";
import { normalizeCounterparty } from "@/lib/counterparty";
import { notifyEscalation } from "@/lib/alerts";

/**
 * Escalation webhook target — human-in-the-loop approval for `hold`s. Point a
 * policy's `escalation.webhook` at `<APP_URL>/api/escalate` (new agents get
 * this by default) and the SDK sends every `hold` here with the agent's API
 * key.
 *
 *   escalation:
 *     webhook: "https://spendlens.example.com/api/escalate"
 *     timeout_seconds: 120          # how long the payment waits for a person
 *     on_timeout: block
 *     auto_approve_below_usdc: 0.005  # optional fast path, no human needed
 *
 * Decision:
 *   - agent halted (kill switch)            → denied immediately
 *   - amount ≤ auto_approve_below_usdc      → approved immediately
 *   - otherwise → queued for a person: 202 `{ status: "pending", id, pollUrl }`,
 *     the owner is e-mailed, and the SDK polls `pollUrl` until someone
 *     approves/denies it on the dashboard's Approvals page or
 *     `timeout_seconds` runs out (→ `on_timeout`).
 *
 * `auto_approve_below_usdc` is deliberately not the first_seen ceiling: a
 * first_seen hold only fires *above* that one, so reusing it would make every
 * such hold unapprovable. Nothing here writes the ledger — the SDK records the
 * `hold_approved` / `hold_denied` row for the payment it actually made.
 */
const BodySchema = z.object({
  counterparty: z.string().min(1),
  resource: z.string().default(""),
  amountUsdc: z.number().nonnegative(),
  ruleHit: z.string().nullish(),
  taskId: z.string().nullish(),
  nonce: z.string().nullish(),
});

/** Bounds on how long a hold may wait for a person. */
const MIN_WAIT_S = 10;
const MAX_WAIT_S = 24 * 60 * 60;

function pollUrlFor(request: NextRequest, id: string): string {
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
  return `${base}/api/escalate/${id}`;
}

export async function POST(request: NextRequest) {
  const key = await requireApiKey(request);
  if (isResponse(key)) return key;

  const limited = await enforceRateLimit(`escalate:${key.keyId}`, 240);
  if ("response" in limited) return limited.response;

  let input: z.infer<typeof BodySchema>;
  try {
    input = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid escalation payload" }, { status: 400 });
  }

  try {
    const policy = await getPolicyBySlug(key.userId, key.agentSlug);
    const waitSeconds = Math.min(
      MAX_WAIT_S,
      Math.max(MIN_WAIT_S, policy?.config.escalation.timeoutSeconds ?? 60),
    );
    const ceiling =
      policy?.config.escalation.autoApproveBelowUsdc ??
      (policy?.config.counterparties.firstSeen.autoAllowBelowUsdc ?? 0) * 5;

    const base = {
      userId: key.userId,
      agentId: key.agentId,
      agentSlug: key.agentSlug,
      counterparty: normalizeCounterparty(input.counterparty),
      resource: input.resource,
      amountMicroUsdc: Math.max(0, Math.round(input.amountUsdc * 1_000_000)),
      ruleHit: input.ruleHit ?? null,
      taskId: input.taskId ?? null,
      nonce: input.nonce ?? null,
      expiresAt: new Date(Date.now() + waitSeconds * 1000),
    };
    const headers = { ...limited.headers, "x-spendlens-agent-status": key.agentStatus };

    // The kill switch must also stop a leaked key from getting holds
    // approved. A plain 200 "denied" (not an error status) so no SDK
    // on_timeout: allow fallback can turn it into an approval.
    if (key.agentStatus === "paused") {
      const esc = await createEscalation({ ...base, decided: { status: "denied", by: "halt" } });
      return NextResponse.json(
        { approved: false, status: "denied", id: esc.id, reason: "agent is halted" },
        { headers },
      );
    }

    if (input.amountUsdc > 0 && input.amountUsdc <= ceiling) {
      const esc = await createEscalation({ ...base, decided: { status: "approved", by: "auto" } });
      return NextResponse.json(
        {
          approved: true,
          status: "approved",
          id: esc.id,
          reason: `amount $${input.amountUsdc} ≤ auto-approve ceiling $${ceiling}`,
        },
        { headers },
      );
    }

    const esc = await createEscalation(base);
    await notifyEscalation(key.userId, esc).catch((err) =>
      console.error("[spendlens] escalation e-mail failed:", err),
    );
    return NextResponse.json(
      {
        approved: false,
        status: "pending",
        id: esc.id,
        pollUrl: pollUrlFor(request, esc.id),
        expiresAt: esc.expiresAt,
        reason: "waiting for a human decision in the Spendlens dashboard",
      },
      { status: 202, headers },
    );
  } catch (err) {
    console.error("[spendlens] POST /api/escalate failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
