import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "./index";
import { agent as agentTable, policy as policyTable } from "./schema";
import { defaultEscalationWebhook, defaultPolicyYaml, parsePolicyYaml } from "@/lib/policy-file";
import { SLUG_RE, normalizeSlug } from "@/lib/slug";

export { normalizeSlug };

export interface AgentRecord {
  id: string;
  slug: string;
  label: string;
  status: "active" | "paused";
  walletAddress: string | null;
  createdAt: string;
}

function toRecord(r: typeof agentTable.$inferSelect): AgentRecord {
  return {
    id: r.id,
    slug: r.slug,
    label: r.label,
    status: r.status === "paused" ? "paused" : "active",
    walletAddress: r.walletAddress ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export function normalizeAddress(input: string | null | undefined): string | null {
  const v = (input ?? "").trim();
  if (!v) return null;
  if (!ADDRESS_RE.test(v)) throw new Error("Wallet address must be 0x + 40 hex chars.");
  return v.toLowerCase();
}

export async function listAgentRecords(userId: string): Promise<AgentRecord[]> {
  const rows = await db
    .select()
    .from(agentTable)
    .where(eq(agentTable.userId, userId))
    .orderBy(asc(agentTable.createdAt));
  return rows.map(toRecord);
}

export async function getAgentRecordBySlug(
  userId: string,
  slug: string,
): Promise<AgentRecord | null> {
  const [r] = await db
    .select()
    .from(agentTable)
    .where(and(eq(agentTable.userId, userId), eq(agentTable.slug, slug)))
    .limit(1);
  return r ? toRecord(r) : null;
}

/** Creates an agent and seeds its default policy in one transaction. */
export async function createAgent(
  userId: string,
  input: { slug: string; label: string; walletAddress?: string | null },
): Promise<AgentRecord> {
  const slug = normalizeSlug(input.slug);
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      "Agent id must be 3–50 chars, lowercase letters, numbers and hyphens.",
    );
  }
  const label = input.label.trim() || slug;
  const walletAddress = normalizeAddress(input.walletAddress);

  const [dupe] = await db
    .select({ id: agentTable.id })
    .from(agentTable)
    .where(and(eq(agentTable.userId, userId), eq(agentTable.slug, slug)))
    .limit(1);
  if (dupe) throw new Error(`You already have an agent called "${slug}".`);

  const raw = defaultPolicyYaml(slug, defaultEscalationWebhook());
  const { config } = parsePolicyYaml(raw);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(agentTable)
      .values({ userId, slug, label, walletAddress })
      .returning();
    await tx.insert(policyTable).values({
      agentId: row.id,
      userId,
      rawYaml: raw,
      config,
      version: 1,
      updatedAt: new Date(),
    });
    return toRecord(row);
  });
}

export async function setAgentWallet(
  userId: string,
  agentId: string,
  address: string | null,
): Promise<void> {
  await db
    .update(agentTable)
    .set({ walletAddress: normalizeAddress(address), updatedAt: new Date() })
    .where(and(eq(agentTable.id, agentId), eq(agentTable.userId, userId)));
}

export async function setAgentStatus(
  userId: string,
  agentId: string,
  status: "active" | "paused",
): Promise<void> {
  await db
    .update(agentTable)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(agentTable.id, agentId), eq(agentTable.userId, userId)));
}

export async function renameAgent(
  userId: string,
  agentId: string,
  label: string,
): Promise<void> {
  await db
    .update(agentTable)
    .set({ label: label.trim(), updatedAt: new Date() })
    .where(and(eq(agentTable.id, agentId), eq(agentTable.userId, userId)));
}

export async function deleteAgent(userId: string, agentId: string): Promise<void> {
  await db
    .delete(agentTable)
    .where(and(eq(agentTable.id, agentId), eq(agentTable.userId, userId)));
}
