import { NextRequest, NextResponse } from "next/server";
import { listApiKeys, createApiKey } from "@/lib/db/api-keys";
import { getAgentRecordBySlug } from "@/lib/db/agents";
import { requireSessionUser, isResponse } from "@/lib/auth/api";
import { enforceRateLimit } from "@/lib/rate-limit";

async function resolveAgent(userId: string, agentId: string) {
  return getAgentRecordBySlug(userId, agentId);
}

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  const { agentId } = await props.params;
  const agent = await resolveAgent(auth.userId, agentId);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  return NextResponse.json({ keys: await listApiKeys(auth.userId, agent.id) });
}

/** Mint an API key for an agent. Body: `{ name }`. The plaintext is returned
 *  ONCE here and never again. */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  const { agentId } = await props.params;
  const agent = await resolveAgent(auth.userId, agentId);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  // 20 key mints/min per user — plenty for real key rotation, caps abuse of
  // a leaked session filling the table with keys.
  const limited = enforceRateLimit(`create-key:${auth.userId}`, 20);
  if ("response" in limited) return limited.response;

  try {
    const body = await request.json().catch(() => ({}));
    const { plaintext, view } = await createApiKey(
      auth.userId,
      agent.id,
      String(body?.name ?? "api key"),
    );
    return NextResponse.json({ key: plaintext, meta: view }, { status: 201 });
  } catch (err) {
    // createApiKey() only throws deliberately-worded, user-safe messages —
    // echoing err.message here is intentional, matching POST /api/agents.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create key" },
      { status: 400 },
    );
  }
}
