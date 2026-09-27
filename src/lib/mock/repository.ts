import {
  AuthorizationRecordSchema,
  AgentSummarySchema,
  CounterpartySummarySchema,
  OverviewStatsSchema,
  ReconciliationRecordSchema,
  type AuthorizationRecord,
  type Decision,
  type Quality,
  type Agent,
  type AgentSummary,
  type CounterpartySummary,
  type OverviewStats,
  type ReconciliationRecord,
  type ReconciliationStatus,
} from "@/lib/contracts";
import { computeWaste } from "@/lib/engine";
import {
  AGENT_LABELS,
  AGENT_PROFILES,
  generateAuthorizations,
  generateReconciliation,
  getPeriod,
} from "./seed";

/**
 * Async, filter-object repository over the seeded dataset — every function
 * here is shaped the way a real SQLite/Postgres-backed version would be,
 * so swapping the implementation later doesn't change any caller.
 * Every return value is parsed through its Zod contract before leaving this
 * module, so a bug here fails loudly instead of shipping malformed data to
 * a page.
 */

export const ALL_AGENTS = "all";

function scopeToAgent<T extends { agentId: string }>(
  records: T[],
  agentId?: string,
): T[] {
  if (!agentId || agentId === ALL_AGENTS) return records;
  return records.filter((r) => r.agentId === agentId);
}

function worstReconciliationStatus(
  records: ReconciliationRecord[],
): ReconciliationStatus {
  if (records.some((r) => r.status === "critical")) return "critical";
  if (records.some((r) => r.status === "pending")) return "pending";
  return "ok";
}

export async function listAgentOptions(): Promise<
  { id: string; label: string }[]
> {
  return [
    { id: ALL_AGENTS, label: "All agents" },
    ...AGENT_PROFILES.map((p) => ({ id: p.id, label: p.label })),
  ];
}

export async function getOverviewStats(
  agentId: string = "research-crawler-01",
): Promise<OverviewStats> {
  const scoped = scopeToAgent(generateAuthorizations(), agentId);
  const { start, end } = getPeriod();

  const { wastedMicroUsdc, totalAllowedMicroUsdc, ratio } = computeWaste(scoped);
  const blocked = scoped.filter(
    (r) => r.decision === "block" || r.decision === "hold_denied",
  );
  const blockedMicroUsdc = blocked.reduce((sum, r) => sum + r.amountMicroUsdc, 0);

  const reconciliation = generateReconciliation().filter(
    (r) => agentId === ALL_AGENTS || r.agentId === agentId,
  );

  return OverviewStatsSchema.parse({
    periodStart: start,
    periodEnd: end,
    totalSpendMicroUsdc: totalAllowedMicroUsdc,
    wastedMicroUsdc,
    wastedRatio: ratio,
    blockedCount: blocked.length,
    blockedMicroUsdc,
    reconciliationStatus: worstReconciliationStatus(reconciliation),
    reconciliationDeltaMicroUsdc: reconciliation.reduce(
      (sum, r) => sum + r.deltaMicroUsdc,
      0,
    ),
  });
}

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

  let records = scopeToAgent(generateAuthorizations(), agentId);
  if (counterparty) records = records.filter((r) => r.counterparty === counterparty);
  if (decision) records = records.filter((r) => r.decision === decision);
  if (quality && quality !== "any") {
    records = records.filter((r) => r.quality === quality);
  }
  if (search) {
    const q = search.toLowerCase();
    records = records.filter(
      (r) =>
        r.resource.toLowerCase().includes(q) ||
        r.counterparty.toLowerCase().includes(q) ||
        r.agentId.toLowerCase().includes(q) ||
        (r.ruleHit?.toLowerCase().includes(q) ?? false),
    );
  }

  const sorted = [...records].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  const total = sorted.length;
  const start = (page - 1) * pageSize;

  return {
    records: sorted.slice(start, start + pageSize).map((r) => AuthorizationRecordSchema.parse(r)),
    total,
    page,
    pageSize,
  };
}

function summarizeAgent(agentId: string, records: AuthorizationRecord[]): AgentSummary {
  const { wastedMicroUsdc, totalAllowedMicroUsdc, ratio } = computeWaste(records);
  const lastActivityTs = records.reduce<string | null>(
    (latest, r) => (!latest || r.ts > latest ? r.ts : latest),
    null,
  );

  return AgentSummarySchema.parse({
    agentId,
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

export async function listAgents(): Promise<AgentSummary[]> {
  const all = generateAuthorizations();
  return AGENT_PROFILES.map((profile) =>
    summarizeAgent(
      profile.id,
      all.filter((r) => r.agentId === profile.id),
    ),
  );
}

export async function getAgent(agentId: string): Promise<Agent | null> {
  if (!(agentId in AGENT_LABELS)) return null;
  const records = generateAuthorizations().filter((r) => r.agentId === agentId);
  return { ...summarizeAgent(agentId, records), label: AGENT_LABELS[agentId] };
}

function summarizeCounterparty(
  counterparty: string,
  records: AuthorizationRecord[],
): CounterpartySummary {
  const withQuality = records.filter(
    (r) => (r.decision === "allow" || r.decision === "hold_approved") && r.quality !== null,
  );
  const okCount = withQuality.filter((r) => r.quality === "ok").length;
  const qualityScore = withQuality.length > 0 ? okCount / withQuality.length : 1;

  const totalSpendMicroUsdc = records
    .filter((r) => r.decision === "allow")
    .reduce((sum, r) => sum + r.amountMicroUsdc, 0);

  const firstSeenTs = records.reduce(
    (earliest, r) => (r.ts < earliest ? r.ts : earliest),
    records[0].ts,
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
  agentId?: string,
): Promise<CounterpartySummary[]> {
  const scoped = scopeToAgent(generateAuthorizations(), agentId);
  const groups = new Map<string, AuthorizationRecord[]>();
  for (const r of scoped) {
    const list = groups.get(r.counterparty);
    if (list) list.push(r);
    else groups.set(r.counterparty, [r]);
  }
  return Array.from(groups.entries())
    .map(([counterparty, records]) => summarizeCounterparty(counterparty, records))
    .sort((a, b) => b.totalSpendMicroUsdc - a.totalSpendMicroUsdc);
}

export async function getCounterparty(
  counterparty: string,
): Promise<CounterpartySummary | null> {
  const records = generateAuthorizations().filter((r) => r.counterparty === counterparty);
  if (records.length === 0) return null;
  return summarizeCounterparty(counterparty, records);
}

export async function listReconciliation(): Promise<ReconciliationRecord[]> {
  return generateReconciliation().map((r) => ReconciliationRecordSchema.parse(r));
}
