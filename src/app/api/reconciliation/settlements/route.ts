import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { importSettlements } from "@/lib/db/repository";
import { requireApiKey, requireSessionUser, isResponse } from "@/lib/auth/api";
import { enforceRateLimit } from "@/lib/rate-limit";

const BodySchema = z.object({
  settlements: z
    .array(
      z.object({
        counterparty: z.string().min(1),
        chainAmountMicroUsdc: z.number().int().nonnegative(),
        settlementId: z.string().nullish(),
      }),
    )
    .min(1),
});

/**
 * Feed on-chain settlement totals into reconciliation. Accepts either a
 * session (dashboard upload) or an API key (`Authorization: Bearer sl_…`,
 * useful for a cron/webhook). Body: `{ settlements: [{ counterparty,
 * chainAmountMicroUsdc, settlementId? }] }`.
 */
export async function POST(request: NextRequest) {
  let userId: string;
  const key = await requireApiKey(request.clone());
  if (isResponse(key)) {
    const session = await requireSessionUser();
    if (isResponse(session)) return session;
    userId = session.userId;
  } else {
    userId = key.userId;
  }

  const limited = enforceRateLimit(`settlements:${userId}`, 60);
  if ("response" in limited) return limited.response;

  try {
    const parsed = BodySchema.parse(await request.json());
    const count = await importSettlements(userId, parsed.settlements);
    return NextResponse.json({ success: true, imported: count });
  } catch (err) {
    console.error("[spendlens] POST /api/reconciliation/settlements failed:", err);
    return NextResponse.json({ error: "Invalid settlements payload" }, { status: 400 });
  }
}
