import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, requireSessionUser, isResponse } from "@/lib/auth/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { recomputeReconciliation } from "@/lib/db/repository";
import { reconcileUser } from "@/lib/reconcile";

/**
 * Runs the keyless Circle Gateway reconciliation now (instead of waiting for
 * the schedule). With an API key: that key's agent. With a session: every
 * agent of the signed-in user that has a wallet address. What
 * `npm run reconcile:arc` calls — no private key involved.
 */
export async function POST(request: NextRequest) {
  const key = await requireApiKey(request.clone());
  let userId: string;
  let agentId: string | undefined;
  if (isResponse(key)) {
    const session = await requireSessionUser();
    if (isResponse(session)) return session;
    userId = session.userId;
  } else {
    userId = key.userId;
    agentId = key.agentId;
  }

  // Each run fans out to Circle's API — keep it well under their limits.
  const limited = await enforceRateLimit(`reconcile-run:${userId}`, 6);
  if ("response" in limited) return limited.response;

  // Optional { graceSeconds } (0–3600): how recent a transfer may be and
  // still count this run. The schedule uses RECONCILE_GRACE_SECONDS (300)
  // so an in-flight ledger row can't read as a leak; a caller that knows its
  // ledger is flushed (a test run) can ask for 0.
  let graceSeconds: number | undefined;
  try {
    const body = (await request.json()) as { graceSeconds?: unknown };
    if (typeof body?.graceSeconds === "number") {
      graceSeconds = Math.min(3600, Math.max(0, body.graceSeconds));
    }
  } catch {
    // no body — defaults
  }

  try {
    const summary = await reconcileUser(userId, agentId, { graceSeconds });
    await recomputeReconciliation(userId);
    return NextResponse.json({ success: true, ...summary }, { headers: limited.headers });
  } catch (err) {
    console.error("[spendlens] POST /api/reconciliation/run failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
