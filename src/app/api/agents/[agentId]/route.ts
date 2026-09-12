import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAgent, listAuthorizations } from "@/lib/db/repository";
import { getAgentRecordBySlug, setAgentStatus } from "@/lib/db/agents";
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
    console.error("[spendlens] GET /api/agents/[agentId] failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

const PatchBodySchema = z.object({
  status: z.enum(["active", "paused"]),
});

/** Programmatic kill switch — the dashboard's "Halt agent" button was a
 *  server-action form field with no REST equivalent, so nothing outside the
 *  browser (an alerting webhook, a cron job reacting to a reconciliation
 *  mismatch, a CLI) could pause an agent without a human clicking a button.
 *  Session-scoped like the rest of this route, not API-key scoped: pausing
 *  an agent is an account-owner action, not something the agent's own key
 *  should be able to do to itself. */
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const { agentId: slug } = await props.params;
    const body = PatchBodySchema.parse(await request.json());

    const record = await getAgentRecordBySlug(auth.userId, slug);
    if (!record) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    await setAgentStatus(auth.userId, record.id, body.status);
    return NextResponse.json({ success: true, status: body.status });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Body must be { status: 'active' | 'paused' }" },
        { status: 400 },
      );
    }
    console.error("[spendlens] PATCH /api/agents/[agentId] failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 400 });
  }
}
