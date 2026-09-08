/**
 * Smoke-tests the "fill the gaps" work against a running instance:
 *   /api/health · rate limiting on ingest · /api/escalate webhook (approve+deny)
 * Usage: node scripts/verify-gaps.mjs [http://localhost:3000]
 */
const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const stamp = Date.now().toString(36);
const EMAIL = `gaps-${stamp}@spendlens.test`;
const AGENT = `gaps-${stamp}`;
let cookie = "";

async function api(method, path, body, extraHeaders) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, headers: res.headers };
}

const ok = (c, m) => console.log(`  ${c ? "✓" : "✗ FAIL"} ${m}`);

// 1. health
console.log("health:");
const h = await api("GET", "/api/health");
ok(h.status === 200 && h.json.db === "up", `200 + db up (${JSON.stringify(h.json)})`);

// 2. tenant + agent + policy + key
await api("POST", "/api/auth/sign-up/email", { name: "G", email: EMAIL, password: "gaps-password-1" });
await api("POST", "/api/agents", { slug: AGENT, label: "Gaps", walletAddress: "0x31bbf8ef43d0c1fd4f01db97cf4b2b1e7cd76d5e" });
const policy = `version: 1
agent: ${AGENT}
budgets: [{ scope: task, limit_usdc: 5 }, { scope: hour, limit_usdc: 50 }, { scope: day, limit_usdc: 500 }]
per_call: { max_usdc: 1, max_calls_per_minute: 600 }
counterparties: { mode: allowlist, allow: ["api.known.io"], deny: [], first_seen: { action: hold, auto_allow_below_usdc: 0.01 } }
anomaly:
  burn_rate: { baseline: ewma, halflife_minutes: 15, z_threshold: 4, action: alert }
  new_counterparty_rate: { max_per_hour: 50, action: alert }
quality: { failure_status_codes: [500], empty_body_is_failure: true, json_schema: null, max_latency_ms: 8000 }
escalation: { webhook: "${BASE}/api/escalate", timeout_seconds: 10, on_timeout: block }`;
await api("POST", `/api/policies/${AGENT}`, { raw: policy });
const mk = await api("POST", `/api/agents/${AGENT}/keys`, { name: "gaps" });
const KEY = mk.json.key;
ok(!!KEY, `minted API key ${KEY?.slice(0, 11)}…`);
const auth = { authorization: `Bearer ${KEY}` };

// 3. escalate — under the ceiling → approved
console.log("escalate (amount ≤ auto_allow ceiling 0.01):");
const eOk = await api("POST", "/api/escalate", {
  counterparty: "0xnewpayee1", resource: "https://api.new/x", amountUsdc: 0.005, ruleHit: "counterparties.first_seen.action",
}, auth);
ok(eOk.status === 200 && eOk.json.approved === true && eOk.json.decision === "hold_approved", JSON.stringify(eOk.json));

// 4. escalate — over the ceiling → denied
console.log("escalate (amount > ceiling):");
const eNo = await api("POST", "/api/escalate", {
  counterparty: "0xnewpayee2", resource: "https://api.new/y", amountUsdc: 0.05, ruleHit: "counterparties.first_seen.action",
}, auth);
ok(eNo.status === 200 && eNo.json.approved === false && eNo.json.decision === "hold_denied", JSON.stringify(eNo.json));

// 5. both decisions are in the ledger
const led = await api("GET", `/api/authorizations?agentId=${AGENT}&pageSize=50`);
const decisions = (led.json.records ?? []).map((r) => r.decision).sort();
ok(decisions.includes("hold_approved") && decisions.includes("hold_denied"), `ledger decisions: ${JSON.stringify(decisions)}`);

// 6. rate limit on ingest (limit 240/min/key)
console.log("rate limit on POST /api/authorizations (expect 429 after 240):");
let first429 = 0, lastHeaders;
for (let i = 1; i <= 260; i++) {
  const r = await api("POST", "/api/authorizations", { records: [] }, auth);
  lastHeaders = r.headers;
  if (r.status === 429) { first429 = i; break; }
}
ok(first429 > 0 && first429 <= 245, `first 429 at request #${first429}`);
ok(!!lastHeaders?.get("retry-after"), `Retry-After header present (${lastHeaders?.get("retry-after")}s)`);
ok(!!lastHeaders?.get("x-ratelimit-limit"), `X-RateLimit-Limit: ${lastHeaders?.get("x-ratelimit-limit")}`);

console.log("\ndone.");
