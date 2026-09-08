import { NextRequest, NextResponse } from "next/server";
import {
  listAuthorizations,
  type AuthorizationFilters,
} from "@/lib/db/repository";
import { insertAuthorizations } from "@/lib/db/ingest";
import { getAgentRecordBySlug } from "@/lib/db/agents";
import { requireSessionUser, requireApiKey, isResponse } from "@/lib/auth/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { Decision, Quality } from "@/lib/contracts";

/** Dashboard read — session-scoped. */
export async function GET(request: NextRequest) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const filters: AuthorizationFilters = {
      agentId: searchParams.get("agentId") || undefined,
      counterparty: searchParams.get("counterparty") || undefined,
      decision: (searchParams.get("decision") as Decision) || undefined,
      quality: (searchParams.get("quality") as Quality | "any") || undefined,
      search: searchParams.get("search") || undefined,
      page: parseInt(searchParams.get("page") || "1", 10),
      pageSize: parseInt(searchParams.get("pageSize") || "50", 10),
    };
    return NextResponse.json(await listAuthorizations(auth.userId, filters));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}

/** SDK ingest — API-key authenticated. Body is `{ records: [...] }` or a single
 *  record. The key's agent is authoritative; a paused agent is rejected. */
export async function POST(request: NextRequest) {
  const key = await requireApiKey(request);
  if (isResponse(key)) return key;

  // 240 ingest calls/min per key. The SDK batches, so this is generous for
  // real use but caps a leaked key's blast radius.
  const limited = enforceRateLimit(`ingest:${key.keyId}`, 240);
  if ("response" in limited) return limited.response;

  try {
    const agent = await getAgentRecordBySlug(key.userId, key.agentSlug);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    if (agent.status === "paused") {
      return NextResponse.json(
        { error: "Agent is halted; ingest rejected" },
        { status: 423 },
      );
    }

    const body = await request.json();
    const records = Array.isArray(body?.records)
      ? body.records
      : Array.isArray(body)
        ? body
        : [body];

    const result = await insertAuthorizations(
      { userId: key.userId, agentId: agent.id, agentSlug: agent.slug },
      records,
    );
    return NextResponse.json(
      { success: true, ...result },
      { headers: limited.headers },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid authorization record" },
      { status: 400 },
    );
  }
}
