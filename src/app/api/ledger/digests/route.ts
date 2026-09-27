import { NextResponse } from "next/server";
import { requireSessionUser, isResponse } from "@/lib/auth/api";
import { listDigests } from "@/lib/digest";

/** The signed-in tenant's daily ledger digests, each re-verified now. */
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;
  try {
    return NextResponse.json({ digests: await listDigests(auth.userId) });
  } catch (err) {
    console.error("[spendlens] GET /api/ledger/digests failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
