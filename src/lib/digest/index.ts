import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  authorization as authTable,
  ledgerDigest as digestTable,
  type AuthorizationRow,
} from "@/lib/db/schema";
import { canonicalJson } from "@/lib/policy-hash";
import { ARC } from "@/lib/arc";

/**
 * Ledger tamper-evidence.
 *
 * Every UTC day (by server receive time, `ingestedAt`) each tenant's new
 * ledger rows are folded, in `seq` order, into a SHA-256 hash chain that
 * starts from the tenant's previous day's digest:
 *
 *   h₀ = prevDigest ?? sha256("spendlens:genesis:" + userId)
 *   hᵢ = sha256(hᵢ₋₁ ‖ sha256(canonicalJson(rowᵢ)))
 *   digest = hₙ
 *
 * Changing, removing or reordering any row — on any past day — changes that
 * day's digest and every digest after it. The database already refuses
 * UPDATE/DELETE on the ledger (migration 0004); the digest is what lets
 * someone *outside* the database check that. With `ANCHOR_PRIVATE_KEY` set,
 * each digest is also written on Arc (a 0-value self-transaction whose
 * calldata is the digest), so even whoever runs this server can't quietly
 * rewrite history: the chain has the original.
 *
 * The anchor key is Spendlens's own operator key holding only a little USDC
 * for gas — never a user's key, never user funds.
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const ANCHOR_PREFIX = "spendlens:ledger-digest:v1:";

function leaf(r: AuthorizationRow): string {
  return sha256(
    canonicalJson({
      seq: r.seq,
      id: r.id,
      externalId: r.externalId,
      agentId: r.agentId,
      agentSlug: r.agentSlug,
      ts: r.ts.toISOString(),
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
      policyHash: r.policyHash,
      policyVersion: r.policyVersion,
      createdAt: r.createdAt.toISOString(),
    }),
  );
}

export function genesis(userId: string): string {
  return sha256(`spendlens:genesis:${userId}`);
}

/** Folds rows (already in `seq` order) onto `prev`. Pure — exported for tests. */
export function chainDigest(prev: string, rows: AuthorizationRow[]): string {
  let h = prev;
  for (const r of rows) h = sha256(h + leaf(r));
  return h;
}

const dayStart = (day: string) => new Date(`${day}T00:00:00.000Z`);
const nextDay = (day: string) => new Date(dayStart(day).getTime() + 86_400_000);
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

async function rowsForDay(userId: string, day: string): Promise<AuthorizationRow[]> {
  return db
    .select()
    .from(authTable)
    .where(
      and(
        eq(authTable.userId, userId),
        gte(authTable.ingestedAt, dayStart(day)),
        lt(authTable.ingestedAt, nextDay(day)),
      ),
    )
    .orderBy(asc(authTable.seq));
}

/**
 * Seals every complete UTC day (strictly before today) that has ledger rows
 * and no digest yet, for every tenant. Idempotent. Returns digests written.
 */
export async function sealDigests(now = new Date()): Promise<number> {
  const today = utcDay(now);
  const pending = await db.execute<{ userId: string; day: string }>(sql`
    with days as (
      select a."userId" as "userId", to_char(a."ingestedAt" at time zone 'UTC', 'YYYY-MM-DD') as day
      from "authorization" a
      where a."ingestedAt" < ${dayStart(today).toISOString()}::timestamptz
      group by 1, 2
    )
    select days."userId", days.day from days
    where not exists (
      select 1 from "ledger_digest" d
      where d."userId" = days."userId" and d."day" = days.day::date
    )
    order by 1, 2
  `);

  let written = 0;
  for (const { userId, day } of pending) {
    const [prev] = await db
      .select({ digest: digestTable.digest })
      .from(digestTable)
      .where(and(eq(digestTable.userId, userId), lt(digestTable.day, day)))
      .orderBy(desc(digestTable.day))
      .limit(1);
    const rows = await rowsForDay(userId, day);
    const prevDigest = prev?.digest ?? null;
    await db
      .insert(digestTable)
      .values({
        userId,
        day,
        rowCount: rows.length,
        digest: chainDigest(prevDigest ?? genesis(userId), rows),
        prevDigest,
      })
      .onConflictDoNothing();
    written++;
  }
  return written;
}

export interface DigestView {
  day: string;
  rowCount: number;
  digest: string;
  prevDigest: string | null;
  anchorTxHash: string | null;
  anchorChainId: number | null;
  anchoredAt: string | null;
  /** Recomputed from the ledger right now and compared. */
  verified: boolean;
}

/** A tenant's recent digests, each re-verified against the live ledger. */
export async function listDigests(userId: string, limit = 30): Promise<DigestView[]> {
  const rows = await db
    .select()
    .from(digestTable)
    .where(eq(digestTable.userId, userId))
    .orderBy(desc(digestTable.day))
    .limit(limit);

  const out: DigestView[] = [];
  for (const d of rows) {
    const ledger = await rowsForDay(userId, d.day);
    const recomputed = chainDigest(d.prevDigest ?? genesis(userId), ledger);
    out.push({
      day: d.day,
      rowCount: d.rowCount,
      digest: d.digest,
      prevDigest: d.prevDigest,
      anchorTxHash: d.anchorTxHash,
      anchorChainId: d.anchorChainId,
      anchoredAt: d.anchoredAt?.toISOString() ?? null,
      verified: recomputed === d.digest && ledger.length === d.rowCount,
    });
  }
  // The chain links too: each digest must name its predecessor.
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].prevDigest !== out[i + 1].digest) out[i].verified = false;
  }
  return out;
}

/**
 * Writes un-anchored digests to Arc. No-op unless `ANCHOR_PRIVATE_KEY` is set
 * and an RPC is available for the configured network (mainnet needs
 * `ARC_MAINNET_RPC_URL`). One transaction per tenant-day, to the anchor
 * account itself, value 0, calldata = hex(ANCHOR_PREFIX + digest).
 */
export async function anchorDigests(): Promise<number> {
  const key = process.env.ANCHOR_PRIVATE_KEY;
  if (!key) return 0;
  if (!ARC.rpcUrl) {
    console.warn("[spendlens] ANCHOR_PRIVATE_KEY is set but no Arc RPC is configured — skipping anchoring");
    return 0;
  }

  const unanchored = await db
    .select()
    .from(digestTable)
    .where(isNull(digestTable.anchorTxHash))
    .orderBy(asc(digestTable.day))
    .limit(50);
  if (unanchored.length === 0) return 0;

  const { createWalletClient, createPublicClient, defineChain, http, toHex } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const chain = defineChain({
    id: ARC.chainId,
    name: ARC.network === "mainnet" ? "Arc" : "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [ARC.rpcUrl] } },
  });
  const account = privateKeyToAccount(key as `0x${string}`);
  const wallet = createWalletClient({ account, chain, transport: http(ARC.rpcUrl) });
  const reader = createPublicClient({ chain, transport: http(ARC.rpcUrl) });

  let anchored = 0;
  for (const d of unanchored) {
    try {
      const hash = await wallet.sendTransaction({
        to: account.address,
        value: BigInt(0),
        data: toHex(`${ANCHOR_PREFIX}${d.digest}`),
      });
      await reader.waitForTransactionReceipt({ hash, timeout: 60_000 });
      await db
        .update(digestTable)
        .set({ anchorTxHash: hash, anchorChainId: ARC.chainId, anchoredAt: new Date() })
        .where(eq(digestTable.id, d.id));
      anchored++;
    } catch (err) {
      console.error(`[spendlens] anchoring digest ${d.day} failed:`, err);
      break; // likely out of gas / RPC down — retry next run
    }
  }
  return anchored;
}
