import { NextRequest, NextResponse } from "next/server";
import { listCounterparties, ALL_AGENTS } from "@/lib/db/repository";
import { requireSessionUser, isResponse } from "@/lib/auth/api";

export async function GET(request: NextRequest) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agentId") || undefined;
    const counterparties = await listCounterparties(
      auth.userId,
      agentId && agentId !== ALL_AGENTS ? agentId : undefined,
    );
    return NextResponse.json({ counterparties });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}
