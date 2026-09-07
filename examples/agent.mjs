/**
 * A minimal agent that makes paid calls through Spendlens. Run via
 * `npm run example` (which also starts examples/paid-api.mjs).
 *
 * Set these to also stream telemetry into your dashboard:
 *   SPENDLENS_URL=https://your-spendlens.example.com
 *   SPENDLENS_API_KEY=sl_...            (dashboard -> your agent -> Create key)
 *   SPENDLENS_AGENT_ID=research-crawler-01
 */
import { guard, PolicyBlocked } from "../public/downloads/spendlens-sdk.mjs";

const PAID_API = process.env.PAID_API_URL ?? "http://localhost:4021";
const HOSTED = process.env.SPENDLENS_URL && process.env.SPENDLENS_API_KEY;

// A policy with a real per-call ceiling so /v1/expensive gets blocked.
const policy = `
version: 1
agent: ${process.env.SPENDLENS_AGENT_ID ?? "example-agent"}
budgets:
  - { scope: task, limit_usdc: 5.00 }
  - { scope: hour, limit_usdc: 2.00 }
  - { scope: day,  limit_usdc: 20.00 }
per_call: { max_usdc: 0.05, max_calls_per_minute: 600 }
counterparties:
  mode: denylist
  allow: []
  deny: []
  first_seen: { action: alert, auto_allow_below_usdc: 0.001 }
anomaly:
  burn_rate: { baseline: ewma, halflife_minutes: 15, z_threshold: 3.0, action: alert }
  new_counterparty_rate: { max_per_hour: 20, action: alert }
quality:
  failure_status_codes: [402, 429, 500, 502, 503, 504]
  empty_body_is_failure: true
  json_schema: null
  max_latency_ms: 4000
escalation: { webhook: "https://example.com/x", timeout_seconds: 30, on_timeout: block }
`;

const pay = guard({
  agentId: process.env.SPENDLENS_AGENT_ID ?? "example-agent",
  policy,
  // Function sink prints every recorded decision; if the hosted vars are set,
  // it also forwards the batch to your dashboard.
  sink: async (records) => {
    for (const r of records) {
      console.log(
        `  recorded  decision=${r.decision.padEnd(13)} quality=${String(r.quality).padEnd(11)} ` +
          `amount=${(r.amountMicroUsdc / 1e6).toFixed(6)} USDC  rule=${r.ruleHit ?? "-"}`,
      );
    }
    if (HOSTED) {
      await fetch(`${process.env.SPENDLENS_URL.replace(/\/$/, "")}/api/authorizations`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.SPENDLENS_API_KEY}`,
        },
        body: JSON.stringify({ records }),
      }).catch((e) => console.warn("  (forward to dashboard failed:", e.message, ")"));
    }
  },
});

const calls = [
  ["/v1/data", "task-001", "normal paid call — expect allow / ok"],
  ["/v1/empty", "task-001", "empty 200 body — expect allow / empty (wasted spend)"],
  ["/v1/expensive", "task-002", "asks 5.00 USDC — expect BLOCK (per_call.max_usdc)"],
];

console.log(`\nAgent calling ${PAID_API} through Spendlens${HOSTED ? " (+ dashboard)" : ""}\n`);

for (const [path, taskId, note] of calls) {
  console.log(`→ GET ${path}  (${note})`);
  try {
    const res = await pay.fetch(`${PAID_API}${path}`, { taskId });
    console.log(`  http ${res.status}`);
  } catch (err) {
    if (err instanceof PolicyBlocked) {
      console.log(`  BLOCKED by rule: ${err.ruleHit}`);
    } else {
      console.log(`  error: ${err.message}`);
    }
  }
}

// let the async ledger queue flush
await new Promise((r) => setTimeout(r, 1500));
console.log(
  HOSTED
    ? "\nDone. Open your dashboard → Ledger to see these rows.\n"
    : "\nDone. Set SPENDLENS_URL + SPENDLENS_API_KEY to also see these in a dashboard.\n",
);
process.exit(0);
