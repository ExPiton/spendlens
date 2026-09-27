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
    console.error("[spendlens] GET /api/authorizations failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// Well above anything the SDK's own queue sends in one flush (batchSize:
// 100) — just a backstop against a pathological or hostile caller forcing
// a single request to validate/insert millions of rows.
const MAX_BATCH_SIZE = 1000;

/** SDK ingest — API-key authenticated. Body is `{ records: [...] }` or a single
 *  record. The key's agent is authoritative.
 *
 *  A halted (paused) agent's records are still ACCEPTED: the audit trail must
 *  stay complete — rejecting them used to make a halted agent's spend
 *  invisible exactly when someone was investigating it. Every response
 *  carries `x-spendlens-agent-status`; on `paused` the SDK engages its kill
 *  switch and blocks all further payments before signing. */
export async function POST(request: NextRequest) {
  const key = await requireApiKey(request);
  if (isResponse(key)) return key;

  // 240 ingest calls/min per key. The SDK batches, so this is generous for
  // real use but caps a leaked key's blast radius.
  const limited = await enforceRateLimit(`ingest:${key.keyId}`, 240);
  if ("response" in limited) return limited.response;

  try {
    const agent = await getAgentRecordBySlug(key.userId, key.agentSlug);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const body = await request.json();
    const records = Array.isArray(body?.records)
      ? body.records
      : Array.isArray(body)
        ? body
        : [body];

    const statusHeader = { "x-spendlens-agent-status": agent.status };
    if (records.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Batch too large: ${records.length} records (max ${MAX_BATCH_SIZE})` },
        { status: 413, headers: statusHeader },
      );
    }

    const result = await insertAuthorizations(
      { userId: key.userId, agentId: agent.id, agentSlug: agent.slug },
      records,
    );
    return NextResponse.json(
      { success: true, agentStatus: agent.status, ...result },
      { headers: { ...limited.headers, ...statusHeader } },
    );
  } catch (err) {
    // Logged server-side for operators; the client gets a generic message
    // so a Postgres/driver error never hands back schema or connection
    // details to whoever holds the API key.
    console.error("[spendlens] POST /api/authorizations failed:", err);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
