import "server-only";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "./index";
import {
  agent as agentTable,
  authorization as authTable,
  reconciliation as reconTable,
  type AuthorizationRow,
} from "./schema";
import {
  AgentSummarySchema,
  AuthorizationRecordSchema,
  CounterpartySummarySchema,
  OverviewStatsSchema,
  ReconciliationRecordSchema,
  type Agent,
  type AgentSummary,
  type AuthorizationRecord,
  type CounterpartySummary,
  type Decision,
  type OverviewStats,
  type Quality,
  type ReconciliationRecord,
  type ReconciliationStatus,
} from "@/lib/contracts";
import { classifyReconciliation, computeWaste } from "@/lib/engine";

/**
 * Per-tenant data access over Postgres. Function signatures mirror the old
 * in-memory `src/lib/mock/repository.ts` (the shape the dashboard was already
 * written against) with a `userId` added to every entry point for isolation.
 * Return values are still parsed through their Zod contract before leaving
 * this module.
 */

export const ALL_AGENTS = "all";

/** Safety cap on the fetch-then-compute paths. A single tenant is not expected
 *  to exceed this in the v1 window; revisit with SQL rollups if they do. */
const MAX_SCAN_ROWS = 200_000;

const TOLERANCE_MICRO_USDC = 50; // 0.00005 USDC — absorbs rounding

// ── mappers ─────────────────────────────────────────────────────────────────

function toAuthorizationRecord(r: AuthorizationRow): AuthorizationRecord {
  return AuthorizationRecordSchema.parse({
    id: r.id,
    ts: r.ts.toISOString(),
    agentId: r.agentSlug,
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
    createdAt: r.createdAt.toISOString(),
  });
}

type ScanRow = Pick<
  AuthorizationRecord,
  | "agentId"
  | "decision"
  | "quality"
  | "amountMicroUsdc"
  | "counterparty"
  | "ts"
  | "ruleHit"
>;

/** Lean projection for the aggregate screens — avoids hauling body hashes and
 *  nonces across the wire just to sum amounts. */
async function scanRows(userId: string, agentSlug?: string): Promise<ScanRow[]> {
  const where =
    agentSlug && agentSlug !== ALL_AGENTS
      ? and(eq(authTable.userId, userId), eq(authTable.agentSlug, agentSlug))
      : eq(authTable.userId, userId);

  const rows = await db
    .select({
      agentId: authTable.agentSlug,
      decision: authTable.decision,
      quality: authTable.quality,
      amountMicroUsdc: authTable.amountMicroUsdc,
      counterparty: authTable.counterparty,
      ts: authTable.ts,
      ruleHit: authTable.ruleHit,
    })
    .from(authTable)
    .where(where)
    .orderBy(asc(authTable.ts))
    .limit(MAX_SCAN_ROWS);

  return rows.map((r) => ({
    agentId: r.agentId,
    decision: r.decision as Decision,
    quality: r.quality as Quality | null,
    amountMicroUsdc: r.amountMicroUsdc,
    counterparty: r.counterparty,
    ts: r.ts.toISOString(),
    ruleHit: r.ruleHit,
  }));
}

// ── period ──────────────────────────────────────────────────────────────────

/** The span the dashboard reports over: the full extent of the tenant's
 *  ledger, or the last 30 days when it is empty. */
export async function getLedgerPeriod(
  userId: string,
): Promise<{ start: string; end: string }> {
  const [row] = await db
    .select({
      min: sql<string | Date | null>`min(${authTable.ts})`,
      max: sql<string | Date | null>`max(${authTable.ts})`,
    })
    .from(authTable)
    .where(eq(authTable.userId, userId));

  if (!row?.min || !row?.max) {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  const min = new Date(row.min);
  const max = new Date(row.max);
  return {
    start: min.toISOString(),
    end: new Date(max.getTime() + 1).toISOString(),
  };
}

// ── agents ──────────────────────────────────────────────────────────────────

export async function listAgentOptions(
  userId: string,
): Promise<{ id: string; label: string }[]> {
  const agents = await db
    .select({ slug: agentTable.slug, label: agentTable.label })
    .from(agentTable)
    .where(eq(agentTable.userId, userId))
    .orderBy(asc(agentTable.createdAt));

  return [
    { id: ALL_AGENTS, label: "All agents" },
    ...agents.map((a) => ({ id: a.slug, label: a.label })),
  ];
}

export async function getAgentLabels(
  userId: string,
): Promise<Record<string, string>> {
  const agents = await db
    .select({ slug: agentTable.slug, label: agentTable.label })
    .from(agentTable)
    .where(eq(agentTable.userId, userId));
  return Object.fromEntries(agents.map((a) => [a.slug, a.label]));
}

function summarizeAgent(agentSlug: string, records: ScanRow[]): AgentSummary {
  const { wastedMicroUsdc, totalAllowedMicroUsdc, ratio } = computeWaste(records);
  const lastActivityTs = records.reduce<string | null>(
    (latest, r) => (!latest || r.ts > latest ? r.ts : latest),
    null,
  );
  return AgentSummarySchema.parse({
    agentId: agentSlug,
    totalSpendMicroUsdc: totalAllowedMicroUsdc,
    wastedMicroUsdc,
    wastedRatio: ratio,
    allowedCount: records.filter((r) => r.decision === "allow").length,
    blockedCount: records.filter(
      (r) => r.decision === "block" || r.decision === "hold_denied",
    ).length,
    holdCount: records.filter(
      (r) => r.decision === "hold_approved" || r.decision === "hold_denied",
    ).length,
    counterpartyCount: new Set(records.map((r) => r.counterparty)).size,
    lastActivityTs,
  });
}

export async function listAgents(userId: string): Promise<AgentSummary[]> {
  const [agents, rows] = await Promise.all([
    db
      .select({ slug: agentTable.slug })
      .from(agentTable)
      .where(eq(agentTable.userId, userId))
      .orderBy(asc(agentTable.createdAt)),
    scanRows(userId),
  ]);

  const byAgent = new Map<string, ScanRow[]>();
  for (const r of rows) {
    const list = byAgent.get(r.agentId);
    if (list) list.push(r);
    else byAgent.set(r.agentId, [r]);
  }
  return agents.map((a) => summarizeAgent(a.slug, byAgent.get(a.slug) ?? []));
}

export async function getAgent(
  userId: string,
  agentSlug: string,
): Promise<Agent | null> {
  const [row] = await db
    .select({ slug: agentTable.slug, label: agentTable.label })
    .from(agentTable)
    .where(and(eq(agentTable.userId, userId), eq(agentTable.slug, agentSlug)))
    .limit(1);
  if (!row) return null;

  const records = await scanRows(userId, agentSlug);
  return { ...summarizeAgent(agentSlug, records), label: row.label };
}

// ── overview ────────────────────────────────────────────────────────────────

export async function getOverviewStats(
  userId: string,
  agentSlug: string = ALL_AGENTS,
): Promise<OverviewStats> {
  const [scoped, period, reconciliation] = await Promise.all([
    scanRows(userId, agentSlug),
    getLedgerPeriod(userId),
    listReconciliation(userId),
  ]);

  const { wastedMicroUsdc, totalAllowedMicroUsdc, ratio } = computeWaste(scoped);
  const blocked = scoped.filter(
    (r) => r.decision === "block" || r.decision === "hold_denied",
  );
  const blockedMicroUsdc = blocked.reduce((s, r) => s + r.amountMicroUsdc, 0);

  const relevant =
    agentSlug === ALL_AGENTS
      ? reconciliation
      : reconciliation.filter((r) =>
          new Set(scoped.map((s) => s.counterparty)).has(r.counterparty),
        );

  const worst: ReconciliationStatus = relevant.some((r) => r.status === "critical")
    ? "critical"
    : relevant.some((r) => r.status === "pending")
      ? "pending"
      : "ok";

  return OverviewStatsSchema.parse({
    periodStart: period.start,
    periodEnd: period.end,
    totalSpendMicroUsdc: totalAllowedMicroUsdc,
    wastedMicroUsdc,
    wastedRatio: ratio,
    blockedCount: blocked.length,
    blockedMicroUsdc,
    reconciliationStatus: worst,
    reconciliationDeltaMicroUsdc: relevant.reduce(
      (s, r) => s + r.deltaMicroUsdc,
      0,
    ),
  });
}

// ── ledger ──────────────────────────────────────────────────────────────────

export interface AuthorizationFilters {
  agentId?: string;
  counterparty?: string;
  decision?: Decision;
  quality?: Quality | "any";
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  records: T[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listAuthorizations(
  userId: string,
  filters: AuthorizationFilters = {},
): Promise<Paginated<AuthorizationRecord>> {
  const {
    agentId,
    counterparty,
    decision,
    quality,
    search,
    page = 1,
    pageSize = 50,
  } = filters;

  const conds = [eq(authTable.userId, userId)];
  if (agentId && agentId !== ALL_AGENTS) {
    conds.push(eq(authTable.agentSlug, agentId));
  }
  if (counterparty) conds.push(eq(authTable.counterparty, counterparty));
  if (decision) conds.push(eq(authTable.decision, decision));
  if (quality && quality !== "any") conds.push(eq(authTable.quality, quality));
  if (search) {
    const q = `%${search.toLowerCase()}%`;
    conds.push(
      sql`(lower(${authTable.resource}) like ${q} or lower(${authTable.counterparty}) like ${q} or lower(${authTable.agentSlug}) like ${q} or lower(coalesce(${authTable.ruleHit}, '')) like ${q})`,
    );
  }
  const where = and(...conds);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(authTable)
    .where(where);

  const rows = await db
    .select()
    .from(authTable)
    .where(where)
    .orderBy(desc(authTable.ts))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    records: rows.map(toAuthorizationRecord),
    total: count,
    page,
    pageSize,
  };
}

// ── counterparties ──────────────────────────────────────────────────────────

function summarizeCounterparty(
  counterparty: string,
  records: ScanRow[],
): CounterpartySummary {
  const withQuality = records.filter(
    (r) =>
      (r.decision === "allow" || r.decision === "hold_approved") &&
      r.quality !== null,
  );
  const okCount = withQuality.filter((r) => r.quality === "ok").length;
  const qualityScore = withQuality.length > 0 ? okCount / withQuality.length : 1;

  const totalSpendMicroUsdc = records
    .filter((r) => r.decision === "allow")
    .reduce((s, r) => s + r.amountMicroUsdc, 0);

  const firstSeenTs = records.reduce(
    (earliest, r) => (r.ts < earliest ? r.ts : earliest),
    records[0]?.ts ?? new Date().toISOString(),
  );

  return CounterpartySummarySchema.parse({
    counterparty,
    totalSpendMicroUsdc,
    callCount: records.length,
    qualityScore,
    allowedCount: records.filter((r) => r.decision === "allow").length,
    blockedCount: records.filter(
      (r) => r.decision === "block" || r.decision === "hold_denied",
    ).length,
    holdCount: records.filter(
      (r) => r.decision === "hold_approved" || r.decision === "hold_denied",
    ).length,
    firstSeenTs,
  });
}

export async function listCounterparties(
  userId: string,
  agentSlug?: string,
): Promise<CounterpartySummary[]> {
  const rows = await scanRows(userId, agentSlug);
  const groups = new Map<string, ScanRow[]>();
  for (const r of rows) {
    const list = groups.get(r.counterparty);
    if (list) list.push(r);
    else groups.set(r.counterparty, [r]);
  }
  return Array.from(groups.entries())
    .map(([cp, recs]) => summarizeCounterparty(cp, recs))
    .sort((a, b) => b.totalSpendMicroUsdc - a.totalSpendMicroUsdc);
}

export async function getCounterparty(
  userId: string,
  counterparty: string,
): Promise<CounterpartySummary | null> {
  const rows = (await scanRows(userId)).filter(
    (r) => r.counterparty === counterparty,
  );
  if (rows.length === 0) return null;
  return summarizeCounterparty(counterparty, rows);
}

// ── reconciliation ──────────────────────────────────────────────────────────

export async function listReconciliation(
  userId: string,
): Promise<ReconciliationRecord[]> {
  const rows = await db
    .select()
    .from(reconTable)
    .where(eq(reconTable.userId, userId));

  const severity: Record<string, number> = { critical: 0, pending: 1, ok: 2 };
  return rows
    .map((r) =>
      ReconciliationRecordSchema.parse({
        counterparty: r.counterparty,
        periodStart: r.periodStart.toISOString(),
        periodEnd: r.periodEnd.toISOString(),
        chainAmountMicroUsdc: r.chainAmountMicroUsdc,
        ledgerAmountMicroUsdc: r.ledgerAmountMicroUsdc,
        deltaMicroUsdc: r.deltaMicroUsdc,
        toleranceMicroUsdc: r.toleranceMicroUsdc,
        status: r.status,
        settlementId: r.settlementId,
      }),
    )
    .sort((a, b) => severity[a.status] - severity[b.status]);
}

/**
 * Rebuilds each counterparty's ledger side from `allow` decisions in the
 * current period and re-classifies against the recorded on-chain amount. A
 * counterparty seen for the first time gets a row where chain == ledger
 * (status ok) — with no Arc indexer wired up yet, "no divergence signal" is
 * the honest default. An existing row's `chainAmountMicroUsdc` is preserved,
 * so seeded/real divergences survive a recompute.
 */
export async function recomputeReconciliation(userId: string): Promise<number> {
  const [rows, period, existing] = await Promise.all([
    scanRows(userId),
    getLedgerPeriod(userId),
    db.select().from(reconTable).where(eq(reconTable.userId, userId)),
  ]);

  const start = new Date(period.start);
  const end = new Date(period.end);
  const chainByCp = new Map(existing.map((r) => [r.counterparty, r]));

  const ledgerByCp = new Map<string, number>();
  for (const r of rows) {
    if (r.decision !== "allow") continue;
    const ts = new Date(r.ts);
    if (ts < start || ts >= end) continue;
    ledgerByCp.set(
      r.counterparty,
      (ledgerByCp.get(r.counterparty) ?? 0) + r.amountMicroUsdc,
    );
  }
  for (const cp of chainByCp.keys()) {
    if (!ledgerByCp.has(cp)) ledgerByCp.set(cp, 0);
  }

  let n = 0;
  for (const [cp, ledgerAmount] of ledgerByCp) {
    const prior = chainByCp.get(cp);
    const chainAmount = prior ? prior.chainAmountMicroUsdc : ledgerAmount;
    const { deltaMicroUsdc, status } = classifyReconciliation(
      chainAmount,
      ledgerAmount,
      TOLERANCE_MICRO_USDC,
    );
    await db
      .insert(reconTable)
      .values({
        userId,
        counterparty: cp,
        periodStart: start,
        periodEnd: end,
        chainAmountMicroUsdc: chainAmount,
        ledgerAmountMicroUsdc: ledgerAmount,
        deltaMicroUsdc,
        toleranceMicroUsdc: TOLERANCE_MICRO_USDC,
        status,
        settlementId: status === "ok" ? (prior?.settlementId ?? null) : null,
      })
      .onConflictDoUpdate({
        target: [reconTable.userId, reconTable.counterparty, reconTable.periodStart],
        set: {
          periodEnd: start < end ? end : start,
          ledgerAmountMicroUsdc: ledgerAmount,
          deltaMicroUsdc,
          status,
        },
      });
    n++;
  }
  return n;
}
