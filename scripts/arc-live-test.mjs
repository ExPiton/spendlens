/**
 * REAL on-chain end-to-end test on Arc testnet.
 *
 *   signup -> Spendlens agent + API key
 *   -> deposit USDC into Circle Gateway (on-chain, once)
 *   -> a real Nanopayments seller (examples/nanopayment-seller.mjs)
 *   -> guardGateway: policy on onBeforePaymentCreation, telemetry around client.pay()
 *      · /premium   -> allow, real gas-free batched settlement
 *      · /empty     -> allow + quality "empty"
 *      · /expensive -> BLOCK before signing (per_call.max_usdc); no funds move
 *   -> keyless server-side reconciliation (/api/reconciliation/run)
 *
 * Needs in .env: AGENT_PRIVATE_KEY (funded buyer), SELLER_ADDRESS.
 * Usage: node scripts/arc-live-test.mjs [http://localhost:3000]
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const SELLER = "http://localhost:4030";
const dir = path.dirname(fileURLToPath(import.meta.url));
const stamp = Date.now().toString(36);
const EMAIL = `arc-${stamp}@spendlens.test`;
const AGENT = `arc-live-${stamp}`;

if (!process.env.AGENT_PRIVATE_KEY || !process.env.SELLER_ADDRESS) {
  console.error("Set AGENT_PRIVATE_KEY (funded) and SELLER_ADDRESS in .env.");
  process.exit(1);
}

const { GatewayClient } = await import("@circle-fin/x402-batching/client");
const { guardGateway, ARC, ARC_GATEWAY_CHAIN } = await import(
  "../public/downloads/spendlens-sdk.mjs"
);

// ── cookie jar over fetch ───────────────────────────────────────────────────
let cookie = "";
async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const step = (s) => console.log(`\n▶ ${s}`);

// 1. Spendlens tenant + agent + key
step("Spendlens: signup + agent + API key");
const client = new GatewayClient({
  chain: ARC_GATEWAY_CHAIN,
  privateKey: process.env.AGENT_PRIVATE_KEY,
  rpcUrl: ARC.rpcUrl,
});
await api("POST", "/api/auth/sign-up/email", {
  name: "Arc", email: EMAIL, password: "arc-live-password",
});
await api("POST", "/api/agents", { slug: AGENT, label: "Arc live", walletAddress: client.address });
const policy = `version: 1
agent: ${AGENT}
budgets: [{ scope: task, limit_usdc: 5 }, { scope: hour, limit_usdc: 50 }, { scope: day, limit_usdc: 500 }]
per_call: { max_usdc: 0.05, max_calls_per_minute: 600 }
counterparties: { mode: denylist, allow: [], deny: [], first_seen: { action: alert, auto_allow_below_usdc: 0.001 } }
anomaly:
  burn_rate: { baseline: ewma, halflife_minutes: 15, z_threshold: 4, action: alert }
  new_counterparty_rate: { max_per_hour: 50, action: alert }
quality: { failure_status_codes: [402,500,502,503,504], empty_body_is_failure: true, json_schema: null, max_latency_ms: 8000 }
escalation: { webhook: "https://example.com/x", timeout_seconds: 30, on_timeout: block }`;
await api("POST", `/api/policies/${AGENT}`, { raw: policy });
const mk = await api("POST", `/api/agents/${AGENT}/keys`, { name: "arc-live" });
const apiKey = mk.json.key;
console.log(`  tenant ${EMAIL} · agent ${AGENT} · key ${apiKey?.slice(0, 11)}…`);

// 2. balances + deposit
step(`Circle Gateway: balances for ${client.address} on Arc ${ARC.network}`);
let bal = await client.getBalances();
console.log(`  wallet USDC ${bal.wallet.formatted} · Gateway available ${bal.gateway.formattedAvailable}`);
if (bal.gateway.available < 200_000n) {
  step("Depositing 2 USDC into Gateway (on-chain, one-time)…");
  const d = await client.deposit("2");
  console.log(`  approval ${d.approvalTxHash ?? "—"}  deposit ${d.depositTxHash}`);
  bal = await client.getBalances();
  console.log(`  Gateway available now ${bal.gateway.formattedAvailable}`);
}

// 3. real seller
step("Starting the real Nanopayments seller (examples/nanopayment-seller.mjs)…");
const seller = spawn(process.execPath, [path.join(dir, "..", "examples", "nanopayment-seller.mjs")], {
  stdio: "inherit",
});
await new Promise((r) => setTimeout(r, 1200));

// 4. guarded payments
step("Guarded payments through guardGateway → real settlement");
const pay = guardGateway(client, {
  agentId: AGENT,
  policy,
  sink: `${BASE}/api/authorizations`,
  apiKey,
});

for (const [route, note] of [
  ["/premium", "expect allow / ok + a settlement tx"],
  ["/empty", "expect allow / empty (wasted)"],
  ["/expensive", "expect BLOCK (per_call.max_usdc), no funds move"],
]) {
  process.stdout.write(`  GET ${route}  (${note})\n    `);
  try {
    const r = await pay.fetch(`${SELLER}${route}`, { taskId: "task-arc" });
    console.log(`http ${r.status} · paid ${r.formattedAmount} USDC · settlement ${r.transaction}`);
  } catch (e) {
    console.log(`${e.name}: ${e.message}`);
  }
}
await new Promise((r) => setTimeout(r, 2500));
seller.kill();

// 5. reconcile — keyless, server-side, from the wallet address on file
step("Keyless reconciliation: POST /api/reconciliation/run (server reads Gateway by address)");
try {
  // graceSeconds: 0 — this run wants the transfers from seconds ago too.
  const r = await fetch(`${BASE}/api/reconciliation/run`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ graceSeconds: 0 }),
  });
  console.log(`  POST -> ${r.status}`, await r.json().catch(() => ({})));
  const rec = await api("GET", "/api/reconciliation");
  for (const row of rec.json.records ?? []) {
    console.log(
      `  ${row.agentId} ${row.counterparty} chain ${(row.chainAmountMicroUsdc / 1e6).toFixed(6)} ` +
        `ledger ${(row.ledgerAmountMicroUsdc / 1e6).toFixed(6)} → ${row.status}`,
    );
  }
} catch (e) {
  console.log(`  reconcile: ${e.message}`);
}

// 6. read the ledger back
step("Spendlens ledger (this agent)");
const led = await api("GET", `/api/authorizations?agentId=${AGENT}&pageSize=50`);
for (const rec of led.json.records ?? []) {
  console.log(
    `  ${rec.decision.padEnd(6)} ${String(rec.quality).padEnd(6)} ` +
      `${(rec.amountMicroUsdc / 1e6).toFixed(6)} USDC  rule=${rec.ruleHit ?? "-"}  stl=${rec.settlementId ?? "-"}`,
  );
}

const bal2 = await client.getBalances();
console.log(`\nGateway available after test: ${bal2.gateway.formattedAvailable} USDC`);
console.log(`Dashboard: ${BASE}/dashboard/agents/${AGENT}  (login ${EMAIL} / arc-live-password)`);
process.exit(0);
