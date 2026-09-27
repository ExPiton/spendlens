import "server-only";
import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./index";
import { agent as agentTable, apiKey as apiKeyTable } from "./schema";
import { API_KEY_PREFIX, generateApiKey, hashApiKey } from "@/lib/api-key";

/**
 * Per-agent bearer keys for SDK ingest. The plaintext key is shown to the user
 * exactly once at creation; only its SHA-256 hash is persisted. Pure crypto
 * lives in `@/lib/api-key`; this is the DB-bound half.
 */

export { generateApiKey, hashApiKey };

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  agentId: string;
  agentSlug: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export async function listApiKeys(
  userId: string,
  agentId?: string,
): Promise<ApiKeyView[]> {
  const where = agentId
    ? and(eq(apiKeyTable.userId, userId), eq(apiKeyTable.agentId, agentId))
    : eq(apiKeyTable.userId, userId);

  const rows = await db
    .select({
      id: apiKeyTable.id,
      name: apiKeyTable.name,
      prefix: apiKeyTable.prefix,
      agentId: apiKeyTable.agentId,
      agentSlug: agentTable.slug,
      createdAt: apiKeyTable.createdAt,
      lastUsedAt: apiKeyTable.lastUsedAt,
      revokedAt: apiKeyTable.revokedAt,
    })
    .from(apiKeyTable)
    .innerJoin(agentTable, eq(agentTable.id, apiKeyTable.agentId))
    .where(where)
    .orderBy(desc(apiKeyTable.createdAt));

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
  }));
}

export async function createApiKey(
  userId: string,
  agentId: string,
  name: string,
): Promise<{ plaintext: string; view: ApiKeyView }> {
  // Ownership check: the agent must belong to this user.
  const [owned] = await db
    .select({ slug: agentTable.slug })
    .from(agentTable)
    .where(and(eq(agentTable.id, agentId), eq(agentTable.userId, userId)))
    .limit(1);
  if (!owned) throw new Error("Agent not found");

  const { plaintext, prefix, hash } = generateApiKey();
  const [row] = await db
    .insert(apiKeyTable)
    .values({ userId, agentId, name: name.trim() || "Untitled key", prefix, keyHash: hash })
    .returning();

  return {
    plaintext,
    view: {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      agentId: row.agentId,
      agentSlug: owned.slug,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    },
  };
}

export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
  await db
    .update(apiKeyTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeyTable.id, keyId),
        eq(apiKeyTable.userId, userId),
        isNull(apiKeyTable.revokedAt),
      ),
    );
}

export interface ResolvedApiKey {
  keyId: string;
  userId: string;
  agentId: string;
  agentSlug: string;
  /** The dashboard kill switch state of the key's agent. */
  agentStatus: "active" | "paused";
}

/** Looks up an active key by its plaintext and returns the tenant + agent it
 *  authorizes. Constant-time compare on the hash. Returns null for unknown,
 *  revoked, or malformed keys. */
export async function resolveApiKey(
  plaintext: string | null | undefined,
): Promise<ResolvedApiKey | null> {
  if (!plaintext || !plaintext.startsWith(API_KEY_PREFIX)) return null;
  const hash = hashApiKey(plaintext);

  const [row] = await db
    .select({
      keyId: apiKeyTable.id,
      keyHash: apiKeyTable.keyHash,
      userId: apiKeyTable.userId,
      agentId: apiKeyTable.agentId,
      revokedAt: apiKeyTable.revokedAt,
      agentSlug: agentTable.slug,
      agentStatus: agentTable.status,
    })
    .from(apiKeyTable)
    .innerJoin(agentTable, eq(agentTable.id, apiKeyTable.agentId))
    .where(eq(apiKeyTable.keyHash, hash))
    .limit(1);

  if (!row || row.revokedAt) return null;

  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(row.keyHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return {
    keyId: row.keyId,
    userId: row.userId,
    agentId: row.agentId,
    agentSlug: row.agentSlug,
    agentStatus: row.agentStatus === "paused" ? "paused" : "active",
  };
}

export async function touchApiKey(keyId: string): Promise<void> {
  await db
    .update(apiKeyTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeyTable.id, keyId));
}
