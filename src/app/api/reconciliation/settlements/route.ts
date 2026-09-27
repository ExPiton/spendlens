import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { importSettlements } from "@/lib/db/repository";
import { getAgentRecordBySlug } from "@/lib/db/agents";
import { requireApiKey, requireSessionUser, isResponse } from "@/lib/auth/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ARC } from "@/lib/arc";

const BodySchema = z.object({
  /** Agent slug — required with a session; ignored with an API key (the
   *  key's own agent is authoritative). */
  agentId: z.string().optional(),
  /** Arc chain the settlements are from; defaults to this deployment's. */
  chainId: z.number().int().positive().optional(),
  /** True when `settlements` is the complete chain picture for the agent
   *  (ledger counterparties missing from it are treated as unsettled). */
  snapshot: z.boolean().optional(),
  settlements: z
    .array(
      z.object({
        counterparty: z.string().min(1),
        chainAmountMicroUsdc: z.number().int().nonnegative(),
        settlementId: z.string().nullish(),
        chainId: z.number().int().positive().nullish(),
      }),
    )
    .min(1),
});

/**
 * Manual / CSV feed of on-chain settlement totals for ONE agent — the
 * scheduled keyless Gateway job (`lib/reconcile`) is the primary source; this
 * is for exports and custom indexers. Accepts an API key (`Bearer sl_…`, the
 * key's agent) or a session (then `agentId` is required).
 */
export async function POST(request: NextRequest) {
  const key = await requireApiKey(request.clone());
  let userId: string;
  let agentSlug: string | undefined;
  if (isResponse(key)) {
    const session = await requireSessionUser();
    if (isResponse(session)) return session;
    userId = session.userId;
  } else {
    userId = key.userId;
    agentSlug = key.agentSlug;
  }

  const limited = await enforceRateLimit(`settlements:${userId}`, 60);
  if ("response" in limited) return limited.response;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid settlements payload" }, { status: 400 });
  }

  try {
    const slug = agentSlug ?? body.agentId;
    if (!slug) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }
    const agent = await getAgentRecordBySlug(userId, slug);
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const chainId = body.chainId ?? body.settlements.find((s) => s.chainId)?.chainId ?? ARC.chainId;
    const rows = await importSettlements({ userId, agentId: agent.id }, chainId, body.settlements, {
      snapshot: body.snapshot,
      periodStart: new Date(agent.createdAt),
    });
    return NextResponse.json(
      {
        success: true,
        imported: body.settlements.length,
        rows: rows.length,
        critical: rows.filter((r) => r.status === "critical").length,
      },
      { headers: limited.headers },
    );
  } catch (err) {
    console.error("[spendlens] POST /api/reconciliation/settlements failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
