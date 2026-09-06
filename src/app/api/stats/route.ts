import { NextRequest, NextResponse } from "next/server";
import { getOverviewStats, ALL_AGENTS } from "@/lib/db/repository";
import { requireSessionUser, isResponse } from "@/lib/auth/api";

export async function GET(request: NextRequest) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agentId") || ALL_AGENTS;
    return NextResponse.json(await getOverviewStats(auth.userId, agentId));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}
