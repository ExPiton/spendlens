import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "./index";
import {
  agent as agentTable,
  authorization as authTable,
  policy as policyTable,
  reconciliation as reconTable,
} from "./schema";
import { defaultPolicyYaml, parsePolicyYaml } from "./policy";
import {
  AGENT_PROFILES,
  generateAuthorizations,
  generateReconciliation,
} from "@/lib/mock/seed";

/**
 * Populates a tenant with the deterministic demo dataset (the same five agents
 * and 12-day ledger the marketing page previews). Idempotent — the ledger's
 * `(agentId, externalId)` unique index absorbs re-runs.
 */
export async function seedDemoData(userId: string): Promise<void> {
  // 1. Agents + their policies.
  const slugToId = new Map<string, string>();
  const existingAgents = await db
    .select({ id: agentTable.id, slug: agentTable.slug })
    .from(agentTable)
    .where(eq(agentTable.userId, userId));
  for (const a of existingAgents) slugToId.set(a.slug, a.id);

  for (const profile of AGENT_PROFILES) {
    if (slugToId.has(profile.id)) continue;

    const raw = await policyYamlFor(profile.id);
    const { config } = parsePolicyYaml(raw);
    const [row] = await db
      .insert(agentTable)
      .values({ userId, slug: profile.id, label: profile.label })
      .returning({ id: agentTable.id });
    slugToId.set(profile.id, row.id);
    await db.insert(policyTable).values({
      agentId: row.id,
      userId,
      rawYaml: raw,
      config,
      version: 1,
      updatedAt: new Date(),
    });
  }

  // 2. Ledger.
  const records = generateAuthorizations();
  const rows = records
    .filter((r) => slugToId.has(r.agentId))
    .map((r) => ({
      externalId: r.id,
      userId,
      agentId: slugToId.get(r.agentId)!,
      agentSlug: r.agentId,
      ts: new Date(r.ts),
      taskId: r.taskId,
      counterparty: r.counterparty,
      resource: r.resource,
      amountMicroUsdc: r.amountMicroUsdc,
      decision: r.decision,
      ruleHit: r.ruleHit,
      nonce: r.nonce,
      chainId: r.chainId,
      httpStatus: r.httpStatus,
      latencyMs: r.latencyMs,
      bodyBytes: r.bodyBytes,
      bodySha256: r.bodySha256,
      quality: r.quality,
      settlementId: r.settlementId,
      createdAt: new Date(r.createdAt),
    }));

  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insert(authTable)
      .values(rows.slice(i, i + 1000))
      .onConflictDoNothing({ target: [authTable.agentId, authTable.externalId] });
  }

  // 3. Reconciliation (includes the Scenario-C critical divergence).
  const recon = generateReconciliation().map((r) => ({
    userId,
    counterparty: r.counterparty,
    periodStart: new Date(r.periodStart),
    periodEnd: new Date(r.periodEnd),
    chainAmountMicroUsdc: r.chainAmountMicroUsdc,
    ledgerAmountMicroUsdc: r.ledgerAmountMicroUsdc,
    deltaMicroUsdc: r.deltaMicroUsdc,
    toleranceMicroUsdc: r.toleranceMicroUsdc,
    status: r.status,
    settlementId: r.settlementId,
  }));
  await db
    .insert(reconTable)
    .values(recon)
    .onConflictDoNothing({
      target: [reconTable.userId, reconTable.counterparty, reconTable.periodStart],
    });
}

/** Wipes every agent (cascading to keys, policies, ledger) and reconciliation
 *  row for a tenant. The "start fresh" button. */
export async function clearTenantData(userId: string): Promise<void> {
  await db.delete(agentTable).where(eq(agentTable.userId, userId));
  await db.delete(reconTable).where(eq(reconTable.userId, userId));
}

/** True when the tenant has at least one agent. */
export async function hasAnyAgent(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: agentTable.id })
    .from(agentTable)
    .where(eq(agentTable.userId, userId))
    .limit(1);
  return Boolean(row);
}

async function policyYamlFor(slug: string): Promise<string> {
  try {
    return await readFile(
      path.join(process.cwd(), "policies", `${slug}.yaml`),
      "utf-8",
    );
  } catch {
    return defaultPolicyYaml(slug);
  }
}
