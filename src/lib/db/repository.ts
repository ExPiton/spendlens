import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
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
import { classifyReconciliation } from "@/lib/engine";

/**
 * Per-tenant data access over Postgres. Function signatures mirror the old
 * in-memory `src/lib/mock/repository.ts` (the shape the dashboard was already
 * written against) with a `userId` added to every entry point for isolation.
 * Return values are still parsed through their Zod contract before leaving
 * this module.
 */

export const ALL_AGENTS = "all";

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

/**
 * Every aggregate below used to be computed by pulling up to 200,000 raw
 * rows over the wire and reducing them in JS (`scanRows` + `Array.filter`/
 * `.reduce`) — capped, so a tenant past that cap got a dashboard that just
 * silently stopped counting its oldest rows, no warning, numbers that still
 * *looked* plausible while quietly being wrong. Postgres can compute every
 * one of these SUMs/COUNTs itself, at any scale, without shipping a single
 * row of raw data to Node — that's what `sum(...) filter (where ...)` and
 * `count(...) filter (where ...)` below do.
 */

function scopeByAgent(userId: string, agentSlug?: string) {
  return agentSlug && agentSlug !== ALL_AGENTS
    ? and(eq(authTable.userId, userId), eq(authTable.agentSlug, agentSlug))
    : eq(authTable.userId, userId);
}

const BLOCKED_DECISIONS = sql`(${authTable.decision} in ('block', 'hold_denied'))`;
const HOLD_DECISIONS = sql`(${authTable.decision} in ('hold_approved', 'hold_denied'))`;
/** `'allow'` and `'hold_approved'` are the two outcomes that actually carry
 *  a quality classification (the call went through) — `'block'`/`'hold_denied'`
 *  never reach the point where a response body exists to classify. */
const QUALITY_ELIGIBLE_DECISIONS = sql`(${authTable.decision} in ('allow', 'hold_approved'))`;

interface AgentAggregate {
  totalSpendMicroUsdc: number;
  wastedMicroUsdc: number;
  allowedCount: number;
  blockedCount: number;
  holdCount: number;
  counterpartyCount: number;
  lastActivityTs: string | null;
}

/** One row per agent with activity, keyed by agent slug. An agent with zero
 *  authorization rows simply has no entry — callers zero-fill from the
 *  agent list, same as the old scan-based code did. */
async function agentAggregates(
  userId: string,
  agentSlug?: string,
): Promise<Map<string, AgentAggregate>> {
  const rows = await db
    .select({
      agentSlug: authTable.agentSlug,
      totalSpend: sql<string>`coalesce(sum(${authTable.amountMicroUsdc}) filter (where ${authTable.decision} = 'allow'), 0)`,
      wasted: sql<string>`coalesce(sum(${authTable.amountMicroUsdc}) filter (where ${authTable.decision} = 'allow' and ${authTable.quality} is distinct from 'ok'), 0)`,
      allowedCount: sql<number>`(count(*) filter (where ${authTable.decision} = 'allow'))::int`,
      blockedCount: sql<number>`(count(*) filter (where ${BLOCKED_DECISIONS}))::int`,
      holdCount: sql<number>`(count(*) filter (where ${HOLD_DECISIONS}))::int`,
      counterpartyCount: sql<number>`(count(distinct ${authTable.counterparty}))::int`,
      lastActivityTs: sql<string | Date | null>`max(${authTable.ts})`,
    })
    .from(authTable)
    .where(scopeByAgent(userId, agentSlug))
    .groupBy(authTable.agentSlug);

  return new Map(
    rows.map((r) => [
      r.agentSlug,
      {
        totalSpendMicroUsdc: Number(r.totalSpend),
        wastedMicroUsdc: Number(r.wasted),
        allowedCount: r.allowedCount,
        blockedCount: r.blockedCount,
        holdCount: r.holdCount,
        counterpartyCount: r.counterpartyCount,
        lastActivityTs: r.lastActivityTs ? new Date(r.lastActivityTs).toISOString() : null,
      },
    ]),
  );
}

function toAgentSummary(agentSlug: string, agg: AgentAggregate | undefined): AgentSummary {
  return AgentSummarySchema.parse({
    agentId: agentSlug,
    totalSpendMicroUsdc: agg?.totalSpendMicroUsdc ?? 0,
    wastedMicroUsdc: agg?.wastedMicroUsdc ?? 0,
    wastedRatio:
      agg && agg.totalSpendMicroUsdc > 0 ? agg.wastedMicroUsdc / agg.totalSpendMicroUsdc : 0,
    allowedCount: agg?.allowedCount ?? 0,
    blockedCount: agg?.blockedCount ?? 0,
    holdCount: agg?.holdCount ?? 0,
    counterpartyCount: agg?.counterpartyCount ?? 0,
    lastActivityTs: agg?.lastActivityTs ?? null,
  });
}

function counterpartyAggregateColumns() {
  return {
    counterparty: authTable.counterparty,
    callCount: sql<number>`count(*)::int`,
    totalSpend: sql<string>`coalesce(sum(${authTable.amountMicroUsdc}) filter (where ${authTable.decision} = 'allow'), 0)`,
    allowedCount: sql<number>`(count(*) filter (where ${authTable.decision} = 'allow'))::int`,
    blockedCount: sql<number>`(count(*) filter (where ${BLOCKED_DECISIONS}))::int`,
    holdCount: sql<number>`(count(*) filter (where ${HOLD_DECISIONS}))::int`,
    qualityTotal: sql<number>`(count(*) filter (where ${QUALITY_ELIGIBLE_DECISIONS} and ${authTable.quality} is not null))::int`,
    qualityOk: sql<number>`(count(*) filter (where ${QUALITY_ELIGIBLE_DECISIONS} and ${authTable.quality} = 'ok'))::int`,
    firstSeenTs: sql<string | Date>`min(${authTable.ts})`,
  };
}

function toCounterpartySummary(r: {
  counterparty: string;
  callCount: number;
  totalSpend: string;
  allowedCount: number;
  blockedCount: number;
  holdCount: number;
  qualityTotal: number;
  qualityOk: number;
  firstSeenTs: string | Date;
}): CounterpartySummary {
  return CounterpartySummarySchema.parse({
    counterparty: r.counterparty,
    totalSpendMicroUsdc: Number(r.totalSpend),
    callCount: r.callCount,
    qualityScore: r.qualityTotal > 0 ? r.qualityOk / r.qualityTotal : 1,
    allowedCount: r.allowedCount,
    blockedCount: r.blockedCount,
    holdCount: r.holdCount,
    firstSeenTs: new Date(r.firstSeenTs).toISOString(),
  });
}

/** Per-counterparty `allow`-decision spend within `[start, end)`, in the
 *  same currency units the ledger uses. Feeds reconciliation's "what does
 *  the ledger say we spent this period" side. */
async function ledgerSpendByCounterparty(
  userId: string,
  start: Date,
  end: Date,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      counterparty: authTable.counterparty,
      total: sql<string>`sum(${authTable.amountMicroUsdc})`,
    })
    .from(authTable)
    .where(
      and(
        eq(authTable.userId, userId),
        eq(authTable.decision, "allow"),
        gte(authTable.ts, start),
        lt(authTable.ts, end),
      ),
    )
    .groupBy(authTable.counterparty);

  return new Map(rows.map((r) => [r.counterparty, Number(r.total)]));
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

/** Total call count and first-activity timestamp for one agent — the two
 *  numbers `isColdStart` needs to tell a real "still warming up" state from
 *  a real "anomaly rules are actively blocking" one. */
export async function getAgentActivityWindow(
  userId: string,
  agentSlug: string,
): Promise<{ totalCount: number; firstActivityTs: string | null }> {
  const [row] = await db
    .select({
      totalCount: sql<number>`count(*)::int`,
      firstActivityTs: sql<string | Date | null>`min(${authTable.ts})`,
    })
    .from(authTable)
    .where(and(eq(authTable.userId, userId), eq(authTable.agentSlug, agentSlug)));

  return {
    totalCount: row?.totalCount ?? 0,
    firstActivityTs: row?.firstActivityTs ? new Date(row.firstActivityTs).toISOString() : null,
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

export async function listAgents(userId: string): Promise<AgentSummary[]> {
  const [agents, aggMap] = await Promise.all([
    db
      .select({ slug: agentTable.slug })
      .from(agentTable)
      .where(eq(agentTable.userId, userId))
      .orderBy(asc(agentTable.createdAt)),
    agentAggregates(userId),
  ]);
  return agents.map((a) => toAgentSummary(a.slug, aggMap.get(a.slug)));
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

  const aggMap = await agentAggregates(userId, agentSlug);
  return { ...toAgentSummary(agentSlug, aggMap.get(agentSlug)), label: row.label };
}

// ── overview ────────────────────────────────────────────────────────────────

export async function getOverviewStats(
  userId: string,
  agentSlug: string = ALL_AGENTS,
): Promise<OverviewStats> {
  const where = scopeByAgent(userId, agentSlug);

  const [[agg], period, reconciliation, agentCounterparties] = await Promise.all([
    db
      .select({
        totalSpend: sql<string>`coalesce(sum(${authTable.amountMicroUsdc}) filter (where ${authTable.decision} = 'allow'), 0)`,
        wasted: sql<string>`coalesce(sum(${authTable.amountMicroUsdc}) filter (where ${authTable.decision} = 'allow' and ${authTable.quality} is distinct from 'ok'), 0)`,
        blockedCount: sql<number>`(count(*) filter (where ${BLOCKED_DECISIONS}))::int`,
        blockedMicro: sql<string>`coalesce(sum(${authTable.amountMicroUsdc}) filter (where ${BLOCKED_DECISIONS}), 0)`,
      })
      .from(authTable)
      .where(where),
    getLedgerPeriod(userId),
    listReconciliation(userId),
    // Reconciliation rows aren't per-agent, so scoping the overview to one
    // agent means filtering them down to that agent's own counterparties —
    // a cheap DISTINCT, not a row scan.
    agentSlug === ALL_AGENTS
      ? null
      : db.selectDistinct({ counterparty: authTable.counterparty }).from(authTable).where(where),
  ]);

  const totalAllowedMicroUsdc = Number(agg.totalSpend);
  const wastedMicroUsdc = Number(agg.wasted);
  const ratio = totalAllowedMicroUsdc > 0 ? wastedMicroUsdc / totalAllowedMicroUsdc : 0;
  const blockedMicroUsdc = Number(agg.blockedMicro);

  const relevant = agentCounterparties
    ? (() => {
        const set = new Set(agentCounterparties.map((c) => c.counterparty));
        return reconciliation.filter((r) => set.has(r.counterparty));
      })()
    : reconciliation;

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
    blockedCount: agg.blockedCount,
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
  /** Rows where a rule actually fired — block/hold decisions, and an
   *  `allow` that still carries an `alert`-only rule's ruleHit (see
   *  PolicyEngine.evaluate). This is the "everything the policy or anomaly
   *  system flagged" view; unlike filtering on `decision`, it also surfaces
   *  an `alert` action's signal, which never blocks or holds a call and so
   *  would otherwise show up nowhere at all. */
  flagged?: boolean;
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
    flagged,
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
  if (flagged) conds.push(sql`${authTable.ruleHit} is not null`);
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

export async function listCounterparties(
  userId: string,
  agentSlug?: string,
): Promise<CounterpartySummary[]> {
  const rows = await db
    .select(counterpartyAggregateColumns())
    .from(authTable)
    .where(scopeByAgent(userId, agentSlug))
    .groupBy(authTable.counterparty);

  return rows
    .map(toCounterpartySummary)
    .sort((a, b) => b.totalSpendMicroUsdc - a.totalSpendMicroUsdc);
}

export async function getCounterparty(
  userId: string,
  counterparty: string,
): Promise<CounterpartySummary | null> {
  const [row] = await db
    .select(counterpartyAggregateColumns())
    .from(authTable)
    .where(and(eq(authTable.userId, userId), eq(authTable.counterparty, counterparty)))
    .groupBy(authTable.counterparty);
  if (!row) return null;
  return toCounterpartySummary(row);
}

/** Which agents actually paid one of the given counterparties — reconciliation
 *  rows are per-counterparty, not per-agent, so "halt the agents behind this
 *  critical mismatch" needs this lookup to know which agents to pause. */
export async function listAgentSlugsForCounterparties(
  userId: string,
  counterparties: string[],
): Promise<string[]> {
  if (counterparties.length === 0) return [];
  const rows = await db
    .selectDistinct({ agentSlug: authTable.agentSlug })
    .from(authTable)
    .where(
      and(eq(authTable.userId, userId), inArray(authTable.counterparty, counterparties)),
    );
  return rows.map((r) => r.agentSlug);
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
  const period = await getLedgerPeriod(userId);
  const start = new Date(period.start);
  const end = new Date(period.end);

  const [ledgerByCp, existing] = await Promise.all([
    ledgerSpendByCounterparty(userId, start, end),
    db.select().from(reconTable).where(eq(reconTable.userId, userId)),
  ]);

  const chainByCp = new Map(existing.map((r) => [r.counterparty, r]));
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
        target: [reconTable.userId, reconTable.counterparty],
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

export interface SettlementEntry {
  counterparty: string;
  chainAmountMicroUsdc: number;
  settlementId?: string | null;
}

/**
 * Feeds real (or exported) on-chain settlement totals into the reconciliation
 * table for the current period, then re-classifies against the local ledger.
 * This is the seam for a Circle Gateway indexer — until one is wired up you
 * can POST settlement rows here (CSV export, a cron job, a webhook).
 */
export async function importSettlements(
  userId: string,
  entries: SettlementEntry[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const period = await getLedgerPeriod(userId);
  const start = new Date(period.start);
  const end = new Date(period.end);
  const ledgerByCp = await ledgerSpendByCounterparty(userId, start, end);

  let n = 0;
  for (const e of entries) {
    const ledgerAmount = ledgerByCp.get(e.counterparty) ?? 0;
    const chainAmount = Math.round(e.chainAmountMicroUsdc);
    const { deltaMicroUsdc, status } = classifyReconciliation(
      chainAmount,
      ledgerAmount,
      TOLERANCE_MICRO_USDC,
    );
    await db
      .insert(reconTable)
      .values({
        userId,
        counterparty: e.counterparty,
        periodStart: start,
        periodEnd: end,
        chainAmountMicroUsdc: chainAmount,
        ledgerAmountMicroUsdc: ledgerAmount,
        deltaMicroUsdc,
        toleranceMicroUsdc: TOLERANCE_MICRO_USDC,
        status,
        settlementId: e.settlementId ?? null,
      })
      .onConflictDoUpdate({
        target: [reconTable.userId, reconTable.counterparty],
        set: {
          periodEnd: end,
          chainAmountMicroUsdc: chainAmount,
          ledgerAmountMicroUsdc: ledgerAmount,
          deltaMicroUsdc,
          status,
          settlementId: e.settlementId ?? null,
        },
      });
    n++;
  }
  return n;
}
