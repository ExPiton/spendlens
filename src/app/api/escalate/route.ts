import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser, isResponse } from "@/lib/auth/api";

export async function POST(request: NextRequest) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const body = await request.json();
    const action = body.action as "approve" | "deny";
    const authorizationId = body.authorizationId;

    if (!authorizationId || !action) {
      return NextResponse.json({ error: "Missing authorizationId or action" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      authorizationId,
      action,
      resolvedAt: new Date().toISOString(),
      decision: action === "approve" ? "hold_approved" : "hold_denied",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}
