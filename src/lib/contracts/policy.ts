import { z } from "zod";

/**
 * Every `action` field in the policy file (first_seen, burn_rate,
 * new_counterparty_rate, escalation.on_timeout) draws from one shared verb
 * set. "alert" is observe-only — it never blocks or holds a payment, it
 * just raises a signal (the three anomaly signals are explicitly
 * non-blocking during the cold-start window).
 */
export const PolicyActionSchema = z.enum(["allow", "hold", "block", "alert"]);
export type PolicyAction = z.infer<typeof PolicyActionSchema>;

export const BudgetScopeSchema = z.enum(["task", "hour", "day"]);
export type BudgetScope = z.infer<typeof BudgetScopeSchema>;

/**
 * The literal on-disk shape of `policy.yaml`, field names verbatim.
 * This is the wire contract — what the file actually contains — kept
 * separate from `PolicyConfig` (the camelCase shape the app works with)
 * so parsing/validating the file never silently drifts from what's on disk.
 */
export const PolicyFileSchema = z.object({
  version: z.number().int(),
  agent: z.string(),

  budgets: z.array(
    z.object({
      scope: BudgetScopeSchema,
      limit_usdc: z.number().positive(),
    }),
  ),

  per_call: z.object({
    max_usdc: z.number().positive(),
    max_calls_per_minute: z.number().int().positive(),
  }),

  counterparties: z.object({
    // Only "allowlist" appears in the source doc's example; "denylist" is
    // inferred from the paired `deny` list this field selects between.
    mode: z.enum(["allowlist", "denylist"]),
    allow: z.array(z.string()),
    deny: z.array(z.string()),
    first_seen: z.object({
      action: PolicyActionSchema,
      auto_allow_below_usdc: z.number().nonnegative(),
    }),
  }),

  anomaly: z.object({
    burn_rate: z.object({
      baseline: z.literal("ewma"),
      halflife_minutes: z.number().positive(),
      z_threshold: z.number().positive(),
      action: PolicyActionSchema,
    }),
    new_counterparty_rate: z.object({
      max_per_hour: z.number().int().positive(),
      action: PolicyActionSchema,
    }),
  }),

  quality: z.object({
    failure_status_codes: z.array(z.number().int()),
    empty_body_is_failure: z.boolean(),
    json_schema: z.string().nullable(),
    max_latency_ms: z.number().int().positive(),
  }),

  escalation: z.object({
    webhook: z.string().url(),
    timeout_seconds: z.number().int().positive(),
    on_timeout: PolicyActionSchema,
    // Ceiling under which Spendlens's own /api/escalate auto-approves a
    // `hold`. Deliberately separate from counterparties.first_seen's own
    // auto_allow_below_usdc: that threshold gates whether a hold fires at
    // all (a first-seen call at or under it skips hold entirely, so by the
    // time /api/escalate is asked about a first_seen hold the amount is
    // *always* above that ceiling) — reusing the same number here would
    // make every hold unapprovable by construction. Optional; defaults to
    // 5x first_seen.auto_allow_below_usdc when omitted.
    auto_approve_below_usdc: z.number().nonnegative().optional(),
  }),
});
export type PolicyFile = z.infer<typeof PolicyFileSchema>;

/** App-internal, camelCase view of a validated policy file. */
export interface PolicyConfig {
  version: number;
  agent: string;
  budgets: { scope: BudgetScope; limitUsdc: number }[];
  perCall: { maxUsdc: number; maxCallsPerMinute: number };
  counterparties: {
    mode: "allowlist" | "denylist";
    allow: string[];
    deny: string[];
    firstSeen: { action: PolicyAction; autoAllowBelowUsdc: number };
  };
  anomaly: {
    burnRate: {
      baseline: "ewma";
      halflifeMinutes: number;
      zThreshold: number;
      action: PolicyAction;
    };
    newCounterpartyRate: { maxPerHour: number; action: PolicyAction };
  };
  quality: {
    failureStatusCodes: number[];
    emptyBodyIsFailure: boolean;
    jsonSchema: string | null;
    maxLatencyMs: number;
  };
  escalation: {
    webhook: string;
    timeoutSeconds: number;
    onTimeout: PolicyAction;
    autoApproveBelowUsdc?: number;
  };
}

/** Maps a validated wire-format policy file onto the internal domain shape. */
export function toPolicyConfig(file: PolicyFile): PolicyConfig {
  return {
    version: file.version,
    agent: file.agent,
    budgets: file.budgets.map((b) => ({
      scope: b.scope,
      limitUsdc: b.limit_usdc,
    })),
    perCall: {
      maxUsdc: file.per_call.max_usdc,
      maxCallsPerMinute: file.per_call.max_calls_per_minute,
    },
    counterparties: {
      mode: file.counterparties.mode,
      allow: file.counterparties.allow,
      deny: file.counterparties.deny,
      firstSeen: {
        action: file.counterparties.first_seen.action,
        autoAllowBelowUsdc: file.counterparties.first_seen.auto_allow_below_usdc,
      },
    },
    anomaly: {
      burnRate: {
        baseline: file.anomaly.burn_rate.baseline,
        halflifeMinutes: file.anomaly.burn_rate.halflife_minutes,
        zThreshold: file.anomaly.burn_rate.z_threshold,
        action: file.anomaly.burn_rate.action,
      },
      newCounterpartyRate: {
        maxPerHour: file.anomaly.new_counterparty_rate.max_per_hour,
        action: file.anomaly.new_counterparty_rate.action,
      },
    },
    quality: {
      failureStatusCodes: file.quality.failure_status_codes,
      emptyBodyIsFailure: file.quality.empty_body_is_failure,
      jsonSchema: file.quality.json_schema,
      maxLatencyMs: file.quality.max_latency_ms,
    },
    escalation: {
      webhook: file.escalation.webhook,
      timeoutSeconds: file.escalation.timeout_seconds,
      onTimeout: file.escalation.on_timeout,
      autoApproveBelowUsdc: file.escalation.auto_approve_below_usdc,
    },
  };
}
