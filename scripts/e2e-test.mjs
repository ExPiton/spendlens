/**
 * End-to-end test of the whole Spendlens pipeline against a running instance:
 *
 *   signup -> create agent -> mint API key -> save a real policy
 *   -> a simulated wallet agent makes ~30 paid calls through the SDK
 *      (real secp256k1 signatures via createLocalSigner)
 *   -> telemetry lands in the tenant's ledger
 *   -> feed simulated on-chain settlement, including a phantom (key-leak)
 *   -> read every dashboard API back and assert the outcomes
 *
 * Usage:  node scripts/e2e-test.mjs [http://127.0.0.1:3000]
 *
 * A real Circle/Arc faucet + a live Nanopayments merchant are out of reach from
 * here (faucet CAPTCHAs, no Circle account, no reference merchant), so the paid
 * API is a local x402 server. Everything else — signatures, policy engine,
 * ledger, quality analysis, reconciliation — is the real code path.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

// Use the app's own canonical origin (APP_URL) so Better Auth's origin check
// passes for this server-to-server client.
const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const PAID = "http://localhost:4021";
const dir = path.dirname(fileURLToPath(import.meta.url));
const stamp = Date.now().toString(36);
const EMAIL = `e2e-${stamp}@spendlens.test`;
const PASSWORD = "e2e-test-password";
const AGENT = `arc-test-${stamp}`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

// ── tiny cookie jar over fetch ──────────────────────────────────────────────
let cookie = "";
async function api(method, url, body, headers = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: BASE, // satisfies Better Auth's CSRF/origin check
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function main() {
  // 1. signup
  const su = await api("POST", "/api/auth/sign-up/email", {
    name: "E2E", email: EMAIL, password: PASSWORD,
  });
  check("signup returns a session", su.status === 200 && !!cookie, `http ${su.status}`);

  // 2. create agent
  const ag = await api("POST", "/api/agents", { slug: AGENT, label: "Arc test agent" });
  check("create agent", ag.status === 201 && ag.json?.agent?.slug === AGENT, `http ${ag.status}`);

  // 3. mint API key
  const mk = await api("POST", `/api/agents/${AGENT}/keys`, { name: "e2e" });
  const apiKey = mk.json?.key;
  check("mint API key (sl_ prefix)", mk.status === 201 && /^sl_[0-9a-f]{40}$/.test(apiKey || ""), apiKey?.slice(0, 11));

  // 4. save a real policy: allowlist the good payee, deny the scam address
  const policyYaml = `version: 1
agent: ${AGENT}
budgets:
  - { scope: task, limit_usdc: 5.00 }
  - { scope: hour, limit_usdc: 50.00 }
  - { scope: day,  limit_usdc: 500.00 }
per_call: { max_usdc: 0.05, max_calls_per_minute: 600 }
counterparties:
  mode: allowlist
  allow: ["api.example.io"]
  deny: ["0x000000000000000000000000000000000badc0de"]
  first_seen: { action: alert, auto_allow_below_usdc: 0.001 }
anomaly:
  burn_rate: { baseline: ewma, halflife_minutes: 15, z_threshold: 4.0, action: alert }
  new_counterparty_rate: { max_per_hour: 50, action: alert }
quality:
  failure_status_codes: [402, 429, 500, 502, 503, 504]
  empty_body_is_failure: true
  json_schema: null
  max_latency_ms: 4000
escalation: { webhook: "https://example.com/x", timeout_seconds: 30, on_timeout: block }
`;
  const sp = await api("POST", `/api/policies/${AGENT}`, { raw: policyYaml });
  check("save policy (Zod-validated)", sp.status === 200 && sp.json?.config?.counterparties?.mode === "allowlist", `http ${sp.status}`);

  // 5. boot the local x402 "paid API"
  const server = spawn(process.execPath, [path.join(dir, "..", "examples", "x402-server.mjs")], {
    stdio: "inherit",
  });
  await new Promise((r) => setTimeout(r, 700));

  // 6. simulated wallet agent
  const { guard, createLocalSigner, PolicyBlocked } = await import(
    path.join(dir, "..", "public", "downloads", "spendlens-sdk.mjs")
  );
  // Use the funded test wallet if AGENT_PRIVATE_KEY is set (see
  // `node scripts/new-wallet.mjs`), otherwise a fresh throwaway key.
  const walletKey = process.env.AGENT_PRIVATE_KEY || randomBytes(32).toString("hex");
  const forwarded = [];
  const pay = guard({
    agentId: AGENT,
    policy: policyYaml,
    signer: createLocalSigner(walletKey),
    sink: async (records) => {
      forwarded.push(...records);
      await fetch(`${BASE}/api/authorizations`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ records }),
      });
    },
  });

  const plan = [
    ...Array(15).fill(["/v1/data", "allow", "ok"]),
    ...Array(5).fill(["/v1/empty", "allow", "empty"]),
    ...Array(2).fill(["/v1/slow", "allow", "slow"]),
    ...Array(3).fill(["/v1/error", "allow", "http_error"]),
    ...Array(3).fill(["/v1/expensive", "block", null]),
    ...Array(4).fill(["/scam", "block", null]),
  ];
  let blocked = 0, ok200 = 0, verified = 0;
  for (let i = 0; i < plan.length; i++) {
    const [route] = plan[i];
    try {
      const res = await pay.fetch(`${PAID}${route}`, { taskId: `task-${i % 4}` });
      if (res.status === 200) ok200++;
      if (res.headers.get("x-payment-verified") === "true") verified++;
    } catch (e) {
      if (e instanceof PolicyBlocked) blocked++;
      else console.log("  unexpected error:", e.message);
    }
  }
  await new Promise((r) => setTimeout(r, 2500)); // let the ledger queue flush
  server.kill();

  check("SDK signed & merchant accepted the signature", verified >= 20, `${verified} verified 200s`);
  check("policy blocked expensive + scam calls", blocked >= 7, `${blocked} blocked`);
  check("telemetry forwarded to ingest", forwarded.length === plan.length, `${forwarded.length}/${plan.length}`);

  // 7. reconciliation: recompute, then feed simulated on-chain settlement
  await api("POST", "/api/reconciliation");
  const settle = await api("POST", "/api/reconciliation/settlements", {
    settlements: [
      { counterparty: "api.example.io", chainAmountMicroUsdc: ledgerGuess(forwarded, "api.example.io") },
      { counterparty: "0xleakedkey000000000000000000000000000000", chainAmountMicroUsdc: 500000, settlementId: "stl_phantom" },
    ],
  });
  check("import on-chain settlements", settle.status === 200 && settle.json?.imported === 2, `http ${settle.status}`);

  // 8. read the dashboard APIs back and assert
  const stats = await api("GET", `/api/stats?agentId=${AGENT}`);
  check("overview: total spend > 0", (stats.json?.totalSpendMicroUsdc ?? 0) > 0, `${usd(stats.json?.totalSpendMicroUsdc)} USDC`);
  check("overview: wasted ratio > 0 (empty/slow/error counted)", (stats.json?.wastedRatio ?? 0) > 0, pct(stats.json?.wastedRatio));
  check("overview: blocked count >= 7", (stats.json?.blockedCount ?? 0) >= 7, String(stats.json?.blockedCount));
  check(
    "overview: reconciliation status is a valid enum",
    ["ok", "pending", "critical"].includes(stats.json?.reconciliationStatus),
    stats.json?.reconciliationStatus,
  );

  const led = await api("GET", `/api/authorizations?agentId=${AGENT}&pageSize=200`);
  const recs = led.json?.records ?? [];
  const by = (f, v) => recs.filter((r) => r[f] === v).length;
  check("ledger: rows persisted", recs.length >= plan.length - 2, `${recs.length} rows`);
  check("ledger: allow/ok rows", by("quality", "ok") >= 12, String(by("quality", "ok")));
  check("ledger: allow/empty rows (silent quality degradation)", by("quality", "empty") >= 4, String(by("quality", "empty")));
  check("ledger: block rows carry a ruleHit", recs.filter((r) => r.decision === "block" && r.ruleHit).length >= 7, String(by("decision", "block")));
  check("ledger: per_call.max_usdc fired", recs.some((r) => r.ruleHit === "per_call.max_usdc"), "");
  check("ledger: counterparties.deny fired on the scam address", recs.some((r) => r.ruleHit === "counterparties.deny"), "");

  const cps = await api("GET", `/api/counterparties?agentId=${AGENT}`);
  const good = (cps.json?.counterparties ?? []).find((c) => c.counterparty === "api.example.io");
  check("counterparty: api.example.io tracked with a sub-1.0 quality score", !!good && good.qualityScore < 1, good ? pct(good.qualityScore) : "missing");

  const rec = await api("GET", "/api/reconciliation");
  const phantom = (rec.json?.records ?? []).find((r) => r.counterparty.startsWith("0xleaked"));
  check("reconciliation: phantom settlement flagged CRITICAL", !!phantom && phantom.status === "critical", phantom?.status);
  check("reconciliation: summary worstStatus = critical", rec.json?.summary?.worstStatus === "critical", rec.json?.summary?.worstStatus);

  // 9. kill switch
  // (status flip is UI-only; verify a revoked key is rejected instead)
  const badIngest = await fetch(`${BASE}/api/authorizations`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sl_" + "0".repeat(40) },
    body: JSON.stringify({ records: [] }),
  });
  check("ingest rejects an unknown API key (401)", badIngest.status === 401, `http ${badIngest.status}`);

  // ── report ───────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed  (tenant ${EMAIL}, agent ${AGENT})`);
  process.exit(passed === results.length ? 0 : 1);
}

const ledgerGuess = (recs, cp) =>
  recs.filter((r) => r.counterparty === cp && r.decision === "allow").reduce((s, r) => s + r.amountMicroUsdc, 0) || 1;
const usd = (m) => ((m ?? 0) / 1e6).toFixed(6);
const pct = (r) => `${((r ?? 0) * 100).toFixed(1)}%`;

main().catch((e) => {
  console.error("test harness error:", e);
  process.exit(2);
});
