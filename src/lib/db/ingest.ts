import "server-only";
import { db } from "./index";
import { authorization as authTable } from "./schema";
import { AuthorizationRecordSchema } from "@/lib/contracts";

/**
 * Writes SDK-submitted authorization records into the ledger for one agent.
 * Each record is Zod-validated first. `(agentId, externalId)` is unique, so
 * a retried batch is idempotent rather than duplicated.
 */
export async function insertAuthorizations(
  scope: { userId: string; agentId: string; agentSlug: string },
  rawRecords: unknown[],
): Promise<{ ingested: number; skipped: number }> {
  if (rawRecords.length === 0) return { ingested: 0, skipped: 0 };

  const values = rawRecords.map((raw) => {
    const rec = AuthorizationRecordSchema.parse(raw);
    return {
      externalId: rec.id,
      userId: scope.userId,
      agentId: scope.agentId,
      // The SDK sends its own agentId; the key's agent is authoritative.
      agentSlug: scope.agentSlug,
      ts: new Date(rec.ts),
      taskId: rec.taskId,
      counterparty: rec.counterparty,
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
      createdAt: new Date(rec.createdAt),
    };
  });

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
  };
}
