import { load } from "js-yaml";
import {
  ValidatedPolicyFileSchema,
  toPolicyConfig,
  type PolicyConfig,
} from "@/lib/contracts";

/** Pure policy-YAML helpers — no DB, no `server-only`. */

/** Permissive, observe-only starter policy. No rule yields a `hold` yet;
 *  when the user switches one to `hold`, escalation already points at this
 *  Spendlens instance's `/api/escalate` (a human approves in the dashboard).
 *  Users tighten `counterparties` / `budgets` from here. */
export function defaultPolicyYaml(slug: string, escalationWebhook?: string | null): string {
  const webhook = escalationWebhook ? JSON.stringify(escalationWebhook) : "null";
  return `# Spendlens policy for ${slug}
# Starts permissive and observe-only. Tighten as you learn the agent's traffic:
#   - set counterparties.mode to "allowlist" and fill counterparties.allow —
#     then only those addresses can be paid; anything else is blocked (or held
#     for your approval when first_seen.action is "hold")
#   - lower the budgets and per_call limits
#   - switch anomaly / first_seen actions from "alert" to "hold" or "block"
version: 1
agent: ${slug}

budgets:
  - scope: task
    limit_usdc: 5.00
  - scope: hour
    limit_usdc: 2.00
  - scope: day
    limit_usdc: 20.00
  - scope: month
    limit_usdc: 400.00

per_call:
  max_usdc: 0.05
  max_calls_per_minute: 600

counterparties:
  mode: denylist
  allow: []
  deny: []
  first_seen:
    action: alert
    auto_allow_below_usdc: 0.001

anomaly:
  burn_rate:
    baseline: ewma
    halflife_minutes: 15
    z_threshold: 3.0
    action: alert
  new_counterparty_rate:
    max_per_hour: 20
    action: alert
  counterparty_entropy:
    window_minutes: 60
    min_calls: 50
    max_drop: 0.6
    action: alert

quality:
  failure_status_codes: [402, 429, 500, 502, 503, 504]
  empty_body_is_failure: true
  json_schema: null
  max_latency_ms: 4000

escalation:
  webhook: ${webhook}
  # How long a held payment waits for a human decision in the dashboard.
  timeout_seconds: 120
  on_timeout: block
  # Holds at or under this amount are approved without waiting for a human.
  auto_approve_below_usdc: 0.005
`;
}

/** Parses + Zod-validates a YAML policy. Throws on invalid input. */
export function parsePolicyYaml(raw: string): { config: PolicyConfig } {
  const file = ValidatedPolicyFileSchema.parse(load(raw));
  return { config: toPolicyConfig(file) };
}

/** `<APP_URL>/api/escalate` — where new agents' holds go by default. */
export function defaultEscalationWebhook(): string | null {
  const base = process.env.APP_URL;
  return base ? `${base.replace(/\/$/, "")}/api/escalate` : null;
}
