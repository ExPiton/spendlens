import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { agent as agentTable, policy as policyTable } from "./schema";
import type { PolicyConfig } from "@/lib/contracts";
import { defaultPolicyYaml, parsePolicyYaml } from "@/lib/policy-file";

export { defaultPolicyYaml, parsePolicyYaml };

export interface LoadedPolicy {
  raw: string;
  config: PolicyConfig;
  version: number;
  updatedAt: string;
}

async function ownedAgent(userId: string, slug: string) {
  const [row] = await db
    .select({ id: agentTable.id })
    .from(agentTable)
    .where(and(eq(agentTable.userId, userId), eq(agentTable.slug, slug)))
    .limit(1);
  return row ?? null;
}

export async function getPolicyBySlug(
  userId: string,
  slug: string,
): Promise<LoadedPolicy | null> {
  const rows = await db
    .select({
      raw: policyTable.rawYaml,
      config: policyTable.config,
      version: policyTable.version,
      updatedAt: policyTable.updatedAt,
    })
    .from(policyTable)
    .innerJoin(agentTable, eq(agentTable.id, policyTable.agentId))
    .where(and(eq(agentTable.userId, userId), eq(agentTable.slug, slug)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    raw: row.raw,
    config: row.config as PolicyConfig,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Validates and stores the YAML for an agent the user owns, bumping the
 *  version. Returns the stored, parsed result. Throws if the agent isn't
 *  theirs or the YAML is invalid. */
export async function upsertPolicy(
  userId: string,
  slug: string,
  rawYaml: string,
): Promise<LoadedPolicy> {
  const owned = await ownedAgent(userId, slug);
  if (!owned) throw new Error("Agent not found");

  const { config } = parsePolicyYaml(rawYaml);

  const [existing] = await db
    .select({ version: policyTable.version })
    .from(policyTable)
    .where(eq(policyTable.agentId, owned.id))
    .limit(1);

  const version = (existing?.version ?? 0) + 1;
  const [row] = await db
    .insert(policyTable)
    .values({
      agentId: owned.id,
      userId,
      rawYaml,
      config,
      version,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: policyTable.agentId,
      set: { rawYaml, config, version, updatedAt: new Date() },
    })
    .returning();

  return {
    raw: row.rawYaml,
    config: row.config as PolicyConfig,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}
