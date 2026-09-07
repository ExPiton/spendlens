import { NextRequest, NextResponse } from "next/server";
import { listAgents, listAgentOptions } from "@/lib/db/repository";
import { createAgent } from "@/lib/db/agents";
import { requireSessionUser, isResponse } from "@/lib/auth/api";

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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}

/** Register an agent. Body: `{ slug, label? }`. Session-scoped. */
export async function POST(request: NextRequest) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const body = await request.json();
    const agent = await createAgent(auth.userId, {
      slug: String(body?.slug ?? ""),
      label: String(body?.label ?? body?.slug ?? ""),
      walletAddress: body?.walletAddress ? String(body.walletAddress) : null,
    });
    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create agent" },
      { status: 400 },
    );
  }
}
