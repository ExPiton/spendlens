import { NextResponse } from "next/server";
import { requireSessionUser, isResponse } from "@/lib/auth/api";
import { listEscalations } from "@/lib/db/escalations";

/** The signed-in owner's held payments, newest first (session auth). */
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;
  try {
    return NextResponse.json({ escalations: await listEscalations(auth.userId) });
  } catch (err) {
    console.error("[spendlens] GET /api/escalations failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
