import { NextRequest, NextResponse } from "next/server";
import { getAgent, listAuthorizations } from "@/lib/db/repository";
import { getPolicyBySlug } from "@/lib/db/policy";
import { requireSessionUser, isResponse } from "@/lib/auth/api";

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const { agentId } = await props.params;
    const [agent, policy, recent] = await Promise.all([
      getAgent(auth.userId, agentId),
      getPolicyBySlug(auth.userId, agentId),
      listAuthorizations(auth.userId, { agentId, page: 1, pageSize: 20 }),
    ]);

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    return NextResponse.json({
      agent,
      policy: policy ? { raw: policy.raw, config: policy.config } : null,
      recentAuthorizations: recent.records,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}
