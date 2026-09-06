import { NextResponse } from "next/server";
import { listReconciliation, recomputeReconciliation } from "@/lib/db/repository";
import { requireSessionUser, isResponse } from "@/lib/auth/api";

export async function GET() {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const records = await listReconciliation(auth.userId);
    const critical = records.filter((r) => r.status === "critical").length;
    const pending = records.filter((r) => r.status === "pending").length;
    const ok = records.filter((r) => r.status === "ok").length;

    return NextResponse.json({
      records,
      summary: {
        total: records.length,
        critical,
        pending,
        ok,
        totalDeltaMicroUsdc: records.reduce((s, r) => s + r.deltaMicroUsdc, 0),
        worstStatus: critical > 0 ? "critical" : pending > 0 ? "pending" : "ok",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}

/** Recomputes the ledger side of every counterparty and re-classifies. */
export async function POST() {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const count = await recomputeReconciliation(auth.userId);
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      recordsChecked: count,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}
