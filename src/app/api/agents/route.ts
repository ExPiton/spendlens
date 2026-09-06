import { NextResponse } from "next/server";
import { listAgents, listAgentOptions } from "@/lib/db/repository";
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
