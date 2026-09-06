import { NextRequest, NextResponse } from "next/server";
import { getPolicyBySlug, upsertPolicy } from "@/lib/db/policy";
import { requireSessionUser, isResponse } from "@/lib/auth/api";

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const { agentId } = await props.params;
    const policy = await getPolicyBySlug(auth.userId, agentId);
    if (!policy) {
      return NextResponse.json(
        { error: `Policy not found for agent: ${agentId}` },
        { status: 404 },
      );
    }
    return NextResponse.json({
      agentId,
      raw: policy.raw,
      config: policy.config,
      version: policy.version,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const { agentId } = await props.params;
    const body = await request.json();
    if (!body?.raw || typeof body.raw !== "string") {
      return NextResponse.json(
        { error: "Missing raw YAML string in request body" },
        { status: 400 },
      );
    }
    const saved = await upsertPolicy(auth.userId, agentId, body.raw);
    return NextResponse.json({
      success: true,
      agentId,
      raw: saved.raw,
      config: saved.config,
      version: saved.version,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid policy YAML" },
      { status: 400 },
    );
  }
}
