import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, isResponse } from "@/lib/auth/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getEscalationForAgent } from "@/lib/db/escalations";

/**
 * The SDK's poll target while a `hold` waits for a person
 * (`{ status: "pending" | "approved" | "denied" | "expired" }`). Scoped to the
 * calling key's agent — another agent's key can't read or probe it.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const key = await requireApiKey(request);
  if (isResponse(key)) return key;

  // ~1 poll / 2s per waiting payment; generous for several concurrent holds.
  const limited = await enforceRateLimit(`escalate-poll:${key.keyId}`, 600);
  if ("response" in limited) return limited.response;

  const { id } = await props.params;
  const esc = await getEscalationForAgent(key.agentId, id).catch(() => null);
  if (!esc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Halting the agent while a hold waits denies it on the next poll.
  const status = key.agentStatus === "paused" && esc.status === "pending" ? "denied" : esc.status;
  return NextResponse.json(
    {
      id: esc.id,
      status,
      approved: status === "approved",
      decidedAt: esc.decidedAt,
      expiresAt: esc.expiresAt,
    },
    { headers: { ...limited.headers, "cache-control": "no-store" } },
  );
}
