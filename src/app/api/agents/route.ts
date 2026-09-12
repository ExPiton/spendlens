import { NextRequest, NextResponse } from "next/server";
import { listAgents, listAgentOptions } from "@/lib/db/repository";
import { createAgent } from "@/lib/db/agents";
import { requireSessionUser, isResponse } from "@/lib/auth/api";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function GET() {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const [agents, options] = await Promise.all([
      listAgents(auth.userId),
      listAgentOptions(auth.userId),
    ]);
    return NextResponse.json({ agents, options });
  } catch (err) {
    console.error("[spendlens] GET /api/agents failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/** Register an agent. Body: `{ slug, label? }`. Session-scoped. */
export async function POST(request: NextRequest) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  // 20 agent creations/min per user — a real signup flow never needs more
  // than a handful; this just caps a runaway script or leaked session.
  const limited = enforceRateLimit(`create-agent:${auth.userId}`, 20);
  if ("response" in limited) return limited.response;

  try {
    const body = await request.json();
    const agent = await createAgent(auth.userId, {
      slug: String(body?.slug ?? ""),
      label: String(body?.label ?? body?.slug ?? ""),
      walletAddress: body?.walletAddress ? String(body.walletAddress) : null,
    });
    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    // createAgent() only ever throws deliberately-worded, user-safe
    // messages (e.g. "You already have an agent called X") — unlike the
    // GET handler above, echoing err.message here is intentional, not a
    // leftover leak.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create agent" },
      { status: 400 },
    );
  }
}
