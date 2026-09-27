import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser, isResponse } from "@/lib/auth/api";
import { decideEscalation } from "@/lib/db/escalations";

const BodySchema = z.object({ decision: z.enum(["approve", "deny"]) });

/**
 * Approve / deny a held payment (session auth — an owner decision, never the
 * agent's own API key). The waiting SDK sees it on its next poll. 409 when
 * it was already decided or has expired.
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Body must be { decision: 'approve' | 'deny' }" }, { status: 400 });
  }

  const { id } = await props.params;
  const decided = await decideEscalation(auth.userId, id, body.decision === "approve", auth.userId);
  if (!decided) {
    return NextResponse.json({ error: "Not pending (already decided, expired, or not found)" }, { status: 409 });
  }
  return NextResponse.json({ success: true, escalation: decided });
}
