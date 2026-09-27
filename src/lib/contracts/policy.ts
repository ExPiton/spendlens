import { z } from "zod";
import { normalizeCounterparty } from "@/lib/counterparty";
import { compileBodySchema } from "@/lib/engine/schema-check";

/**
 * Every `action` field in the policy file (first_seen, burn_rate,
 * new_counterparty_rate, escalation.on_timeout) draws from one shared verb
 * set. "alert" is observe-only — it never blocks or holds a payment, it
 * just raises a signal (the three anomaly signals are explicitly
 * non-blocking during the cold-start window).
 */
export const PolicyActionSchema = z.enum(["allow", "hold", "block", "alert"]);
export type PolicyAction = z.infer<typeof PolicyActionSchema>;

/** `hour`/`day` are rolling windows ending now; `month` is the current UTC
 *  calendar month (a billing-cycle budget, which is what "monthly" means to
 *  a finance lead — not "the last 30 days"). */
export const BudgetScopeSchema = z.enum(["task", "hour", "day", "month"]);
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
    // Third signal: sudden *concentration* of spend. Normalized Shannon
    // entropy of the counterparty distribution over the trailing window,
    // compared with an EWMA baseline of the same measure. A drop of more
    // than `max_drop` (fraction of the baseline) means the agent went from
    // spreading calls across its usual providers to hammering one — the
    // shape of a prompt-injection redirect that stays under every per-call
    // limit. Optional: omitted means the signal is off.
    counterparty_entropy: z
      .object({
        window_minutes: z.number().positive().default(60),
        min_calls: z.number().int().positive().default(20),
        max_drop: z.number().gt(0).lt(1).default(0.5),
        action: PolicyActionSchema,
      })
      .optional(),
  }),

  quality: z.object({
    failure_status_codes: z.array(z.number().int()),
    empty_body_is_failure: z.boolean(),
    // A JSON Schema the response body must satisfy (else quality =
    // `schema_fail`). Either an inline schema object in the YAML, or a JSON
    // string of one. null/omitted disables the check.
    json_schema: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .nullable()
      .default(null),
    max_latency_ms: z.number().int().positive(),
  }),

  escalation: z.object({
    // Where a `hold` is sent for a decision. Spendlens's own
    // `<APP_URL>/api/escalate` queues it for a human (see that route);
    // null disables escalation, so every hold resolves via `on_timeout`.
    webhook: z.string().url().nullable().default(null),
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

/** `PolicyFileSchema` plus the checks that need more than shape: a
 *  `json_schema` must compile, so a typo is rejected when the policy is saved
 *  or the guard is built — never discovered mid-payment. */
export const ValidatedPolicyFileSchema = PolicyFileSchema.superRefine((file, ctx) => {
  const js = file.quality.json_schema;
  if (js === null) return;
  try {
    compileBodySchema(typeof js === "string" ? js : JSON.stringify(js));
  } catch (err) {
    ctx.addIssue({
      code: "custom",
      path: ["quality", "json_schema"],
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

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
    /** Optional — absent on policies saved before this signal existed. */
    counterpartyEntropy?: {
      windowMinutes: number;
      minCalls: number;
      maxDrop: number;
      action: PolicyAction;
    };
  };
  quality: {
    failureStatusCodes: number[];
    emptyBodyIsFailure: boolean;
    jsonSchema: string | null;
    maxLatencyMs: number;
  };
  escalation: {
    webhook: string | null;
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
      allow: file.counterparties.allow.map(normalizeCounterparty),
      deny: file.counterparties.deny.map(normalizeCounterparty),
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
      ...(file.anomaly.counterparty_entropy
        ? {
            counterpartyEntropy: {
              windowMinutes: file.anomaly.counterparty_entropy.window_minutes,
              minCalls: file.anomaly.counterparty_entropy.min_calls,
              maxDrop: file.anomaly.counterparty_entropy.max_drop,
              action: file.anomaly.counterparty_entropy.action,
            },
          }
        : {}),
    },
    quality: {
      failureStatusCodes: file.quality.failure_status_codes,
      emptyBodyIsFailure: file.quality.empty_body_is_failure,
      jsonSchema:
        file.quality.json_schema === null || typeof file.quality.json_schema === "string"
          ? file.quality.json_schema
          : JSON.stringify(file.quality.json_schema),
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
