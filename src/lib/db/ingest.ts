import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { agent as agentTable, authorization as authTable } from "./schema";
import { AuthorizationRecordSchema } from "@/lib/contracts";
import { normalizeCounterparty } from "@/lib/counterparty";

/**
 * Writes SDK-submitted authorization records into the ledger for one agent.
 * Each record is Zod-validated first. A record that fails validation is
 * skipped (not thrown on) so one malformed row in a batch can't block every
 * other valid row in it — the SDK's queue re-sends a batch verbatim on any
 * non-2xx response, so throwing here would leave the entire batch, valid
 * records included, permanently stuck retrying against a row that can never
 * become valid. `(agentId, externalId)` is unique, so a retried batch is
 * idempotent rather than duplicated.
 */
export async function insertAuthorizations(
  scope: { userId: string; agentId: string; agentSlug: string },
  rawRecords: unknown[],
): Promise<{ ingested: number; skipped: number; invalid: number }> {
  if (rawRecords.length === 0) return { ingested: 0, skipped: 0, invalid: 0 };

  const parsed = rawRecords.map((raw) => AuthorizationRecordSchema.safeParse(raw));
  const invalid = parsed.filter((p) => !p.success).length;
  if (invalid > 0) {
    console.warn(
      `[spendlens] insertAuthorizations: skipped ${invalid} record(s) that failed schema validation (agent ${scope.agentSlug})`,
    );
  }

  const values = parsed
    .filter((p): p is Extract<(typeof parsed)[number], { success: true }> => p.success)
    .map(({ data: rec }) => ({
      externalId: rec.id,
      userId: scope.userId,
      agentId: scope.agentId,
      // The SDK sends its own agentId; the key's agent is authoritative.
      agentSlug: scope.agentSlug,
      ts: new Date(rec.ts),
      taskId: rec.taskId,
      // Canonical spelling, whatever the (possibly older) SDK sent — the
      // reconciliation join against Gateway depends on it.
      counterparty: normalizeCounterparty(rec.counterparty),
      resource: rec.resource,
      amountMicroUsdc: rec.amountMicroUsdc,
      decision: rec.decision,
      ruleHit: rec.ruleHit,
      nonce: rec.nonce,
      chainId: rec.chainId,
      httpStatus: rec.httpStatus,
      latencyMs: rec.latencyMs,
      bodyBytes: rec.bodyBytes,
      bodySha256: rec.bodySha256,
      quality: rec.quality,
      settlementId: rec.settlementId,
      policyHash: rec.policyHash ?? null,
      policyVersion: rec.policyVersion ?? null,
      createdAt: new Date(rec.createdAt),
    }));

  if (values.length === 0) return { ingested: 0, skipped: 0, invalid };

  const inserted = await db
    .insert(authTable)
    .values(values)
    .onConflictDoNothing({
      target: [authTable.agentId, authTable.externalId],
    })
    .returning({ id: authTable.id });

  return {
    ingested: inserted.length,
    skipped: values.length - inserted.length,
    invalid,
  };
}

/**
 * Writes one sample "allow / ok" authorization for an agent the user owns —
 * powers the dashboard's "Send test event" button so a new user can see the
 * ledger react without wiring the SDK first.
 *
 * It is a sample, so it must not look like money: amount 0 and no chain id.
 * (It used to be 0.003 USDC on the configured Arc chain with a made-up body
 * hash — that inflated TOTAL SPEND, and as ledger spend on mainnet it made
 * reconciliation show a phantom "pending" row against the agent's wallet.)
 */
export async function sendTestEvent(userId: string, slug: string): Promise<void> {
  const [agent] = await db
    .select({ id: agentTable.id })
    .from(agentTable)
    .where(and(eq(agentTable.userId, userId), eq(agentTable.slug, slug)))
    .limit(1);
  if (!agent) throw new Error("Agent not found");

  const now = new Date();
  await db.insert(authTable).values({
    externalId: `test_${randomUUID()}`,
    userId,
    agentId: agent.id,
    agentSlug: slug,
    ts: now,
    taskId: "task-test-event",
    counterparty: "api.example.io",
    resource: "spendlens://sample-event",
    amountMicroUsdc: 0,
    decision: "allow",
    ruleHit: null,
    nonce: null,
    chainId: null,
    httpStatus: 200,
    latencyMs: 128,
    bodyBytes: 512,
    bodySha256: null,
    quality: "ok",
    settlementId: null,
    createdAt: now,
  });
}
