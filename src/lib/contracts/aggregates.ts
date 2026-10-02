import { z } from "zod";
import { ReconciliationStatusSchema } from "./reconciliation";

/**
 * Derived read-models — views computed over `AuthorizationRecord`s, never
 * written directly. The overview screen shows exactly these four numbers
 * and nothing else — more than that buries the number that actually
 * matters.
 */
export const OverviewStatsSchema = z.object({
  periodStart: z.string().datetime({ offset: true }),
  periodEnd: z.string().datetime({ offset: true }),
  totalSpendMicroUsdc: z.number().int().nonnegative(),
  wastedMicroUsdc: z.number().int().nonnegative(),
  wastedRatio: z.number().min(0).max(1),
  blockedCount: z.number().int().nonnegative(),
  blockedMicroUsdc: z.number().int().nonnegative(),
  reconciliationStatus: ReconciliationStatusSchema,
  reconciliationDeltaMicroUsdc: z.number().int(),
  /** How many (agent, chain, counterparty) rows reconciliation has checked.
   *  0 = nothing to compare yet (no wallet address on file) — then a status
   *  of "ok" means "not set up", not "all good", and the UI must say so. */
  reconciledRows: z.number().int().nonnegative().default(0),
});
export type OverviewStats = z.infer<typeof OverviewStatsSchema>;

export const AgentSummarySchema = z.object({
  agentId: z.string(),
  totalSpendMicroUsdc: z.number().int().nonnegative(),
  wastedMicroUsdc: z.number().int().nonnegative(),
  wastedRatio: z.number().min(0).max(1),
  allowedCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
  holdCount: z.number().int().nonnegative(),
  counterpartyCount: z.number().int().nonnegative(),
  lastActivityTs: z.string().datetime({ offset: true }).nullable(),
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

/** `AgentSummary` plus the display label — the shape the Agents detail screen renders. */
export type Agent = AgentSummary & { label: string };

export const CounterpartySummarySchema = z.object({
  counterparty: z.string(),
  totalSpendMicroUsdc: z.number().int().nonnegative(),
  callCount: z.number().int().nonnegative(),
  qualityScore: z.number().min(0).max(1),
  allowedCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
  holdCount: z.number().int().nonnegative(),
  firstSeenTs: z.string().datetime({ offset: true }),
});
export type CounterpartySummary = z.infer<typeof CounterpartySummarySchema>;
