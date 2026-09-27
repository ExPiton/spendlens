import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { agent as agentTable } from "@/lib/db/schema";
import { importSettlements, markReconciliationAlerted } from "@/lib/db/repository";
import { setAgentStatus } from "@/lib/db/agents";
import { fetchWalletSettlements } from "@/sdk/gateway";
import { notifyCriticalReconciliation } from "@/lib/alerts";
import { ARC } from "@/lib/arc";

/**
 * Server-side, keyless Arc reconciliation. For every agent with a wallet
 * address on file, pull the wallet's transfers straight from Circle
 * Gateway's `/v1/x402/transfers` (queryable by address — no private key
 * anywhere near Spendlens), compare per counterparty against that agent's
 * ledger on the configured Arc chain, and on a NEW critical divergence
 * (on-chain spend the ledger never recorded — a leaked key):
 *
 *   1. halt the agent (its guards block every payment before signing on
 *      their next sync) unless `RECONCILE_AUTO_HALT=false`,
 *   2. e-mail the owner (and `ALERT_WEBHOOK_URL`),
 *   3. mark the row alerted so a standing divergence alerts once.
 *
 * Transfers younger than `RECONCILE_GRACE_SECONDS` (default 300) are left
 * for the next pass: the SDK ships ledger rows asynchronously, so a payment
 * can reach Gateway a moment before its ledger row reaches us — without the
 * grace window that race would read as a key leak and halt a healthy agent.
 */

const graceMs = () => Number(process.env.RECONCILE_GRACE_SECONDS ?? 300) * 1000;
const autoHalt = () => process.env.RECONCILE_AUTO_HALT !== "false";

export interface ReconcileSummary {
  agents: number;
  rows: number;
  critical: number;
  halted: string[];
  errors: { agent: string; error: string }[];
  startedAt: string;
  finishedAt: string;
}

let lastRun: ReconcileSummary | null = null;
export const lastReconcileRun = () => lastRun;

type AgentWithWallet = {
  id: string;
  userId: string;
  slug: string;
  status: string;
  walletAddress: string | null;
  createdAt: Date;
};

async function reconcileOne(
  a: AgentWithWallet,
  summary: ReconcileSummary,
  opts: RunOptions,
): Promise<void> {
  if (!a.walletAddress) return;
  const until = new Date(Date.now() - (opts.graceSeconds !== undefined ? opts.graceSeconds * 1000 : graceMs()));
  // An agent registered inside the grace window has no settled period to
  // check yet (and Gateway rejects startDate > endDate) — next pass.
  if (until.getTime() <= a.createdAt.getTime()) return;
  const entries = await fetchWalletSettlements({
    address: a.walletAddress,
    network: ARC,
    since: a.createdAt,
    until,
  });
  const rows = await importSettlements({ userId: a.userId, agentId: a.id }, ARC.chainId, entries, {
    snapshot: true,
    periodStart: a.createdAt,
  });
  summary.agents++;
  summary.rows += rows.length;
  const fresh = rows.filter((r) => r.needsAlert);
  summary.critical += rows.filter((r) => r.status === "critical").length;
  if (fresh.length === 0) return;

  const halted: string[] = [];
  if (autoHalt() && a.status !== "paused") {
    await setAgentStatus(a.userId, a.id, "paused");
    halted.push(a.slug);
    summary.halted.push(a.slug);
  }
  await notifyCriticalReconciliation(
    a.userId,
    fresh.map((r) => ({
      agentSlug: a.slug,
      chainId: r.chainId,
      counterparty: r.counterparty,
      chainAmountMicroUsdc: r.chainAmountMicroUsdc,
      ledgerAmountMicroUsdc: r.ledgerAmountMicroUsdc,
      deltaMicroUsdc: r.deltaMicroUsdc,
    })),
    halted,
  ).catch((err) => console.error("[spendlens] critical alert delivery failed:", err));
  await markReconciliationAlerted(fresh.map((r) => r.id));
}

export interface RunOptions {
  /** Override RECONCILE_GRACE_SECONDS for this run. */
  graceSeconds?: number;
}

async function run(
  where: ReturnType<typeof and> | undefined,
  opts: RunOptions = {},
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    agents: 0,
    rows: 0,
    critical: 0,
    halted: [],
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: "",
  };
  const agents = await db
    .select({
      id: agentTable.id,
      userId: agentTable.userId,
      slug: agentTable.slug,
      status: agentTable.status,
      walletAddress: agentTable.walletAddress,
      createdAt: agentTable.createdAt,
    })
    .from(agentTable)
    .where(where ? and(isNotNull(agentTable.walletAddress), where) : isNotNull(agentTable.walletAddress));

  for (const a of agents) {
    try {
      await reconcileOne(a, summary, opts);
    } catch (err) {
      summary.errors.push({ agent: a.slug, error: err instanceof Error ? err.message : String(err) });
    }
  }
  summary.finishedAt = new Date().toISOString();
  return summary;
}

/** One tenant (dashboard "Rescan"), optionally one agent (SDK/API key). */
export function reconcileUser(
  userId: string,
  agentId?: string,
  opts: RunOptions = {},
): Promise<ReconcileSummary> {
  return run(
    agentId
      ? and(eq(agentTable.userId, userId), eq(agentTable.id, agentId))
      : and(eq(agentTable.userId, userId)),
    opts,
  );
}

/**
 * Every tenant — the scheduled job. A transaction-scoped Postgres advisory
 * lock makes it a no-op on every instance but one, so N replicas don't
 * multiply the Gateway traffic or the alerts. (Transaction-scoped because the
 * pool may hand the unlock to a different connection than the lock; the
 * xact lock is released by the holding transaction's own commit.)
 */
export async function reconcileAll(): Promise<ReconcileSummary | null> {
  return withJobLock("spendlens_reconcile", async () => {
    lastRun = await run(undefined);
    if (lastRun.errors.length) {
      console.warn(`[spendlens] reconcile: ${lastRun.errors.length} agent(s) failed`, lastRun.errors);
    }
    return lastRun;
  });
}

/** Runs `fn` only if this instance wins the named cluster-wide lock. */
export async function withJobLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${name})) as locked`,
    );
    if (!row?.locked) return null;
    return fn();
  });
}
