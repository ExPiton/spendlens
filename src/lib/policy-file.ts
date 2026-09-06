import { load } from "js-yaml";
import {
  PolicyFileSchema,
  toPolicyConfig,
  type PolicyConfig,
} from "@/lib/contracts";

/** Pure policy-YAML helpers — no DB, no `server-only`. */

/** Permissive, observe-only starter policy. No rule yields a `hold`, so the
 *  escalation webhook is never called — the placeholder URL just satisfies the
 *  schema. Users tighten `counterparties` / `budgets` from here. */
export function defaultPolicyYaml(slug: string): string {
  return `# Spendlens policy for ${slug}
# Starts permissive and observe-only. Tighten as you learn the agent's traffic:
#   - set counterparties.mode to "allowlist" and fill counterparties.allow
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

quality:
  failure_status_codes: [402, 429, 500, 502, 503, 504]
  empty_body_is_failure: true
  json_schema: null
  max_latency_ms: 4000

escalation:
  webhook: "https://example.com/spendlens-escalation"
  timeout_seconds: 30
  on_timeout: block
`;
}

/** Parses + Zod-validates a YAML policy. Throws on invalid input. */
export function parsePolicyYaml(raw: string): { config: PolicyConfig } {
  const file = PolicyFileSchema.parse(load(raw));
  return { config: toPolicyConfig(file) };
}
