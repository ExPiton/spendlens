import "server-only";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "./index";
import { escalation as escTable, type EscalationRow } from "./schema";

/**
 * Held payments waiting on a person. `/api/escalate` creates one per `hold`
 * the SDK sends; the SDK polls `/api/escalate/<id>`; the dashboard's
 * Approvals page (or the auto-approve ceiling) decides it. The decision is
 * not itself a ledger row — the SDK writes the `hold_approved` /
 * `hold_denied` ledger record for the payment it actually made or refused,
 * so the ledger never double-counts an approved hold's spend.
 */

export type EscalationStatus = "pending" | "approved" | "denied" | "expired";

export interface EscalationView {
  id: string;
  agentSlug: string;
  counterparty: string;
  resource: string;
  amountMicroUsdc: number;
  ruleHit: string | null;
  taskId: string | null;
  status: EscalationStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

function toView(r: EscalationRow): EscalationView {
  const expired = r.status === "pending" && r.expiresAt.getTime() <= Date.now();
  return {
    id: r.id,
    agentSlug: r.agentSlug,
    counterparty: r.counterparty,
    resource: r.resource,
    amountMicroUsdc: r.amountMicroUsdc,
    ruleHit: r.ruleHit,
    taskId: r.taskId,
    status: expired ? "expired" : (r.status as EscalationStatus),
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

export async function createEscalation(input: {
  userId: string;
  agentId: string;
  agentSlug: string;
  counterparty: string;
  resource: string;
  amountMicroUsdc: number;
  ruleHit: string | null;
  taskId: string | null;
  nonce: string | null;
  expiresAt: Date;
  /** Decide immediately (auto-approve ceiling, halted agent). */
  decided?: { status: "approved" | "denied"; by: string };
}): Promise<EscalationView> {
  const now = new Date();
  const [row] = await db
    .insert(escTable)
    .values({
      userId: input.userId,
      agentId: input.agentId,
      agentSlug: input.agentSlug,
      counterparty: input.counterparty,
      resource: input.resource,
      amountMicroUsdc: input.amountMicroUsdc,
      ruleHit: input.ruleHit,
      taskId: input.taskId,
      nonce: input.nonce,
      expiresAt: input.expiresAt,
      status: input.decided?.status ?? "pending",
      decidedBy: input.decided?.by ?? null,
      decidedAt: input.decided ? now : null,
    })
    .returning();
  return toView(row);
}

/** One escalation, scoped to the agent whose API key is asking. */
export async function getEscalationForAgent(
  agentId: string,
  id: string,
): Promise<EscalationView | null> {
  const [row] = await db
    .select()
    .from(escTable)
    .where(and(eq(escTable.id, id), eq(escTable.agentId, agentId)))
    .limit(1);
  return row ? toView(row) : null;
}

export async function listEscalations(
  userId: string,
  opts: { limit?: number } = {},
): Promise<EscalationView[]> {
  const rows = await db
    .select()
    .from(escTable)
    .where(eq(escTable.userId, userId))
    .orderBy(desc(escTable.createdAt))
    .limit(opts.limit ?? 100);
  return rows.map(toView);
}

export async function countPendingEscalations(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(escTable)
    .where(
      and(
        eq(escTable.userId, userId),
        eq(escTable.status, "pending"),
        sql`${escTable.expiresAt} > now()`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Approve or deny a pending, unexpired escalation the user owns. Returns the
 * updated view, or null when it doesn't exist / was already decided /
 * expired — a late click can't flip a payment the agent already gave up on.
 */
export async function decideEscalation(
  userId: string,
  id: string,
  approve: boolean,
  deciderId: string,
): Promise<EscalationView | null> {
  const [row] = await db
    .update(escTable)
    .set({
      status: approve ? "approved" : "denied",
      decidedBy: deciderId,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(escTable.id, id),
        eq(escTable.userId, userId),
        eq(escTable.status, "pending"),
        sql`${escTable.expiresAt} > now()`,
      ),
    )
    .returning();
  return row ? toView(row) : null;
}

/** Housekeeping: persist `expired` for pending rows past their deadline. */
export async function expireStaleEscalations(): Promise<number> {
  const rows = await db
    .update(escTable)
    .set({ status: "expired" })
    .where(and(eq(escTable.status, "pending"), lt(escTable.expiresAt, new Date())))
    .returning({ id: escTable.id });
  return rows.length;
}
