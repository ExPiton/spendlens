import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
import { normalizeCounterparty } from "@/lib/counterparty";

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
    policyHash: r.policyHash,
    policyVersion: r.policyVersion,
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

/** Decisions that moved money — see `SPEND_DECISIONS` in the engine. An
 *  approved hold was paid exactly like an allow, so every spend total counts
 *  both; leaving `hold_approved` out under-reported spend and made each
 *  approved hold look like unrecorded on-chain spend in reconciliation. */
const SPEND_DECISIONS = sql`(${authTable.decision} in ('allow', 'hold_approved'))`;
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
      totalSpend: sql<string>`coalesce(sum(${authTable.amountMicroUsdc}) filter (where ${SPEND_DECISIONS}), 0)`,
      wasted: sql<string>`coalesce(sum(${authTable.amountMicroUsdc}) filter (where ${SPEND_DECISIONS} and ${authTable.quality} is distinct from 'ok'), 0)`,
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
    totalSpend: sql<string>`coalesce(sum(${authTable.amountMicroUsdc}) filter (where ${SPEND_DECISIONS}), 0)`,
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

/** Per-counterparty spend (`allow` + `hold_approved`) for one agent on one
 *  Arc chain — the ledger side of reconciliation. All-time: Gateway's
 *  transfer history for the wallet is all-time too (bounded below by when
 *  the agent was registered, see `lib/reconcile`). */
async function ledgerSpendByCounterparty(
  agentId: string,
  chainId: number,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      counterparty: authTable.counterparty,
      total: sql<string>`sum(${authTable.amountMicroUsdc})`,
    })
    .from(authTable)
    .where(and(eq(authTable.agentId, agentId), eq(authTable.chainId, chainId), SPEND_DECISIONS))
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

  const [[agg], period, relevant] = await Promise.all([
    db
      .select({
        totalSpend: sql<string>`coalesce(sum(${authTable.amountMicroUsdc}) filter (where ${SPEND_DECISIONS}), 0)`,
        wasted: sql<string>`coalesce(sum(${authTable.amountMicroUsdc}) filter (where ${SPEND_DECISIONS} and ${authTable.quality} is distinct from 'ok'), 0)`,
        blockedCount: sql<number>`(count(*) filter (where ${BLOCKED_DECISIONS}))::int`,
        blockedMicro: sql<string>`coalesce(sum(${authTable.amountMicroUsdc}) filter (where ${BLOCKED_DECISIONS}), 0)`,
      })
      .from(authTable)
      .where(where),
    getLedgerPeriod(userId),
    listReconciliation(userId, agentSlug),
  ]);

  const totalAllowedMicroUsdc = Number(agg.totalSpend);
  const wastedMicroUsdc = Number(agg.wasted);
  const ratio = totalAllowedMicroUsdc > 0 ? wastedMicroUsdc / totalAllowedMicroUsdc : 0;
  const blockedMicroUsdc = Number(agg.blockedMicro);

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
  if (counterparty) conds.push(eq(authTable.counterparty, normalizeCounterparty(counterparty)));
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
    .where(
      and(eq(authTable.userId, userId), eq(authTable.counterparty, normalizeCounterparty(counterparty))),
    )
    .groupBy(authTable.counterparty);
  if (!row) return null;
  return toCounterpartySummary(row);
}

// ── reconciliation ──────────────────────────────────────────────────────────

const SEVERITY: Record<string, number> = { critical: 0, pending: 1, ok: 2 };

/** Reconciliation rows for a tenant, optionally one agent, worst first. */
export async function listReconciliation(
  userId: string,
  agentSlug: string = ALL_AGENTS,
): Promise<ReconciliationRecord[]> {
  const rows = await db
    .select({ r: reconTable, slug: agentTable.slug })
    .from(reconTable)
    .innerJoin(agentTable, eq(agentTable.id, reconTable.agentId))
    .where(
      agentSlug && agentSlug !== ALL_AGENTS
        ? and(eq(reconTable.userId, userId), eq(agentTable.slug, agentSlug))
        : eq(reconTable.userId, userId),
    );

  return rows
    .map(({ r, slug }) =>
      ReconciliationRecordSchema.parse({
        agentId: slug,
        chainId: r.chainId,
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
    .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]);
}

/**
 * Re-derives the ledger side of every existing reconciliation row from the
 * current ledger and re-classifies it against the chain amount on record.
 * Only rows that already have real chain data are touched — an (agent,
 * chain, counterparty) nobody has imported settlements for yet has no chain
 * side, and inventing one ("chain == ledger") would be a fabricated number
 * in a column labelled as on-chain truth. Chain data comes from the
 * scheduled Gateway reconcile (`lib/reconcile`) or `importSettlements`.
 */
export async function recomputeReconciliation(userId: string): Promise<number> {
  const existing = await db.select().from(reconTable).where(eq(reconTable.userId, userId));
  const ledgerCache = new Map<string, Map<string, number>>();
  for (const row of existing) {
    const key = `${row.agentId}:${row.chainId}`;
    let ledger = ledgerCache.get(key);
    if (!ledger) {
      ledger = await ledgerSpendByCounterparty(row.agentId, row.chainId);
      ledgerCache.set(key, ledger);
    }
    const ledgerAmount = ledger.get(row.counterparty) ?? 0;
    const { deltaMicroUsdc, status } = classifyReconciliation(
      row.chainAmountMicroUsdc,
      ledgerAmount,
      TOLERANCE_MICRO_USDC,
    );
    await db
      .update(reconTable)
      .set({
        ledgerAmountMicroUsdc: ledgerAmount,
        deltaMicroUsdc,
        status,
        periodEnd: new Date(),
        updatedAt: new Date(),
        // A divergence that has closed can alert again if it reopens.
        ...(status !== "critical" ? { alertedAt: null } : {}),
      })
      .where(eq(reconTable.id, row.id));
  }
  return existing.length;
}

export interface SettlementEntry {
  counterparty: string;
  chainAmountMicroUsdc: number;
  settlementId?: string | null;
}

export interface ReconciledRow {
  id: string;
  agentId: string;
  chainId: number;
  counterparty: string;
  chainAmountMicroUsdc: number;
  ledgerAmountMicroUsdc: number;
  deltaMicroUsdc: number;
  status: ReconciliationStatus;
  /** Critical now, and no alert has gone out for this divergence yet. */
  needsAlert: boolean;
}

/**
 * Feeds on-chain settlement totals for ONE agent on ONE Arc chain into
 * reconciliation and re-classifies against that agent's ledger on that
 * chain. With `snapshot: true` the entries are the complete chain picture
 * (the scheduled Gateway job): every ledger counterparty missing from them
 * gets chain = 0 (→ pending). Otherwise (a manual/CSV import) only the given
 * counterparties are touched. Counterparties are canonicalized first.
 */
export async function importSettlements(
  scope: { userId: string; agentId: string },
  chainId: number,
  entries: SettlementEntry[],
  opts: { snapshot?: boolean; periodStart?: Date } = {},
): Promise<ReconciledRow[]> {
  const ledger = await ledgerSpendByCounterparty(scope.agentId, chainId);
  const chain = new Map<string, { micro: number; settlementId: string | null }>();
  for (const e of entries) {
    const cp = normalizeCounterparty(e.counterparty);
    const cur = chain.get(cp) ?? { micro: 0, settlementId: null };
    cur.micro += Math.round(e.chainAmountMicroUsdc);
    cur.settlementId = e.settlementId ?? cur.settlementId;
    chain.set(cp, cur);
  }
  if (opts.snapshot) {
    for (const cp of ledger.keys()) {
      if (!chain.has(cp)) chain.set(cp, { micro: 0, settlementId: null });
    }
  }

  const prior = new Map(
    (
      await db
        .select()
        .from(reconTable)
        .where(and(eq(reconTable.agentId, scope.agentId), eq(reconTable.chainId, chainId)))
    ).map((r) => [r.counterparty, r]),
  );

  const now = new Date();
  const out: ReconciledRow[] = [];
  for (const [counterparty, c] of chain) {
    const ledgerAmount = ledger.get(counterparty) ?? 0;
    const { deltaMicroUsdc, status } = classifyReconciliation(
      c.micro,
      ledgerAmount,
      TOLERANCE_MICRO_USDC,
    );
    const before = prior.get(counterparty);
    const alertedAt = status === "critical" ? (before?.alertedAt ?? null) : null;
    const values = {
      userId: scope.userId,
      agentId: scope.agentId,
      chainId,
      counterparty,
      periodStart: before?.periodStart ?? opts.periodStart ?? now,
      periodEnd: now,
      chainAmountMicroUsdc: c.micro,
      ledgerAmountMicroUsdc: ledgerAmount,
      deltaMicroUsdc,
      toleranceMicroUsdc: TOLERANCE_MICRO_USDC,
      status,
      settlementId: c.settlementId,
      alertedAt,
      updatedAt: now,
    };
    const [row] = await db
      .insert(reconTable)
      .values(values)
      .onConflictDoUpdate({
        target: [reconTable.agentId, reconTable.chainId, reconTable.counterparty],
        set: {
          periodEnd: values.periodEnd,
          chainAmountMicroUsdc: values.chainAmountMicroUsdc,
          ledgerAmountMicroUsdc: values.ledgerAmountMicroUsdc,
          deltaMicroUsdc: values.deltaMicroUsdc,
          status: values.status,
          settlementId: values.settlementId,
          alertedAt: values.alertedAt,
          updatedAt: now,
        },
      })
      .returning({ id: reconTable.id });
    out.push({
      id: row.id,
      agentId: scope.agentId,
      chainId,
      counterparty,
      chainAmountMicroUsdc: c.micro,
      ledgerAmountMicroUsdc: ledgerAmount,
      deltaMicroUsdc,
      status,
      needsAlert: status === "critical" && !alertedAt,
    });
  }
  return out;
}

/** Marks critical rows as alerted so the same divergence isn't re-sent. */
export async function markReconciliationAlerted(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(reconTable)
    .set({ alertedAt: new Date() })
    .where(inArray(reconTable.id, ids));
}
