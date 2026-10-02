/**
 * Sets up a persistent tenant for video/demo purposes and posts REAL Arc
 * payments into it.
 *
 *   demo account (fixed login) -> agent -> policy -> API key
 *   -> N real payments to a real Nanopayments seller via guardGateway
 *      · /premium   -> allow / ok      (real Gateway settlement id)
 *      · /empty     -> allow / empty   (wasted spend)
 *      · /expensive -> BLOCK           (before signing, no money moves)
 *   -> reconcileFromGateway -> /api/reconciliation/settlements
 *
 * Always writes to the same account so a recording doesn't need a fresh test
 * account each time. Safe to re-run: logs in if the account exists, reuses
 * the agent if it exists.
 *
 * Requires (.env): AGENT_PRIVATE_KEY (funded), SELLER_ADDRESS
 * Usage: node scripts/demo-setup.mjs [http://localhost:3000]
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

// Fixed demo identity - the same on every run.
// A fresh account (not demo@spendlens.local) — that account's ledger has
// accumulated many prior runs' worth of allowed spend against the same
// counterparty, which would still mismatch a brand-new wallet's on-chain
// history. A new account gives both sides of the reconciliation (ledger and
// on-chain) a genuinely clean, matching start.
const EMAIL = "video-demo@spendlens.local";
const PASSWORD = "spendlens-demo-2026";
const AGENT = process.env.SPENDLENS_AGENT_ID || "arc-demo-01";
// Bring-your-own-account: if SPENDLENS_API_KEY is set, skip creating the
// fixed demo account/agent/policy entirely (that requires a logged-in
// session, which this script can't do on someone else's behalf) and just
// use the given key against the agent it already belongs to.
const BRING_YOUR_OWN_ACCOUNT = Boolean(process.env.SPENDLENS_API_KEY);

// How many payments to make (each settled payment costs 0.01 USDC from the Gateway balance)
const N_OK = Number(process.env.N_OK ?? 12);
const N_EMPTY = Number(process.env.N_EMPTY ?? 4);
const N_BLOCK = Number(process.env.N_BLOCK ?? 3);

if (!process.env.AGENT_PRIVATE_KEY || !process.env.SELLER_ADDRESS) {
  console.error(".env must have AGENT_PRIVATE_KEY (funded) and SELLER_ADDRESS.");
  process.exit(1);
}

const { GatewayClient } = await import("@circle-fin/x402-batching/client");
const { guardGateway, reconcileFromGateway, ARC, ARC_GATEWAY_CHAIN } = await import(
  "../public/downloads/spendlens-sdk.mjs"
);

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

const step = (s) => console.log(`\n> ${s}`);

const client = new GatewayClient({
  chain: ARC_GATEWAY_CHAIN,
  privateKey: process.env.AGENT_PRIVATE_KEY,
  rpcUrl: ARC.rpcUrl,
});

// Same policy either way — used for local guard()/guardGateway enforcement
// (that part is always client-side, regardless of which account is used).
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

let apiKey;
if (BRING_YOUR_OWN_ACCOUNT) {
  step(`Using your own account — agent: ${AGENT}`);
  apiKey = process.env.SPENDLENS_API_KEY;
} else {
  // -- 1. account --------------------------------------------------------------
  step("Demo account");
  let r = await api("POST", "/api/auth/sign-up/email", {
    name: "Spendlens Demo", email: EMAIL, password: PASSWORD,
  });
  if (r.status >= 400) {
    r = await api("POST", "/api/auth/sign-in/email", { email: EMAIL, password: PASSWORD });
    console.log(`  logged in to existing account (${r.status})`);
  } else {
    console.log("  account created");
  }
  if (!cookie) {
    console.error("  login failed - the account may exist with a different password.");
    process.exit(1);
  }

  // -- 2. agent + policy + key -------------------------------------------------
  step("Agent, policy, and API key");
  await api("POST", "/api/agents", {
    slug: AGENT, label: "Arc demo agent", walletAddress: client.address,
  });
  await api("POST", `/api/policies/${AGENT}`, { raw: policy });
  const mk = await api("POST", `/api/agents/${AGENT}/keys`, { name: `demo ${new Date().toISOString().slice(0, 10)}` });
  apiKey = mk.json.key;
  console.log(`  agent ${AGENT} - key issued`);
}

// -- 3. balance -------------------------------------------------------------------
step(`Circle Gateway balances - ${client.address} (Arc ${ARC.network})`);
let bal = await client.getBalances();
console.log(`  wallet ${bal.wallet.formatted} USDC - Gateway ${bal.gateway.formattedAvailable} USDC`);

const needed = (N_OK + N_EMPTY) * 0.01;
if (Number(bal.gateway.formattedAvailable) < needed) {
  step(`Depositing ${Math.ceil(needed * 2)} USDC into Gateway (on-chain, one time)...`);
  const d = await client.deposit(String(Math.ceil(needed * 2)));
  console.log(`  deposit tx ${d.depositTxHash}`);
  bal = await client.getBalances();
  console.log(`  Gateway balance now ${bal.gateway.formattedAvailable} USDC`);
}

// -- 4. seller ----------------------------------------------------------------------
step("Starting the real Nanopayments seller...");
const seller = spawn(process.execPath, [path.join(dir, "..", "examples", "nanopayment-seller.mjs")], {
  stdio: ["ignore", "ignore", "inherit"],
});
await new Promise((r) => setTimeout(r, 1500));

// -- 5. real payments -----------------------------------------------------------------
step(`Making ${N_OK + N_EMPTY + N_BLOCK} real payments via guardGateway`);
const pay = guardGateway(client, {
  agentId: AGENT, policy, sink: `${BASE}/api/authorizations`, apiKey,
});

const plan = [
  ...Array(N_OK).fill(["/premium", "ok"]),
  ...Array(N_EMPTY).fill(["/empty", "empty"]),
  ...Array(N_BLOCK).fill(["/expensive", "block"]),
];
let ok = 0, empty = 0, blocked = 0;
for (const [route, kind] of plan) {
  try {
    const res = await pay.fetch(`${SELLER}${route}`, { taskId: `task-${kind}` });
    if (kind === "ok") { ok++; process.stdout.write(`  OK  ${route} settlement ${String(res.transaction).slice(0, 12)}...\n`); }
    else { empty++; process.stdout.write(`  --  ${route} paid but body was empty (wasted spend)\n`); }
  } catch (e) {
    blocked++;
    process.stdout.write(`  >>> ${route} ${e.name}: ${e.ruleHit ?? e.message}\n`);
  }
}
await pay.drain();
await new Promise((r) => setTimeout(r, 2000));
seller.kill();

// -- 6. reconciliation ----------------------------------------------------------------
step("reconcileFromGateway -> /api/reconciliation/settlements");
try {
  const settlements = await reconcileFromGateway(client, { fromAddress: client.address });
  for (const s of settlements) {
    console.log(`  ${s.counterparty}  ${(s.chainAmountMicroUsdc / 1e6).toFixed(6)} USDC`);
  }
  const rr = await fetch(`${BASE}/api/reconciliation/settlements`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      settlements: settlements.map((s) => ({
        counterparty: s.counterparty,
        chainAmountMicroUsdc: s.chainAmountMicroUsdc,
        settlementId: s.settlementId,
      })),
    }),
  });
  console.log(`  POST -> ${rr.status}`, await rr.json().catch(() => ({})));
} catch (e) {
  console.log(`  reconciliation skipped: ${e.message}`);
}

const bal2 = await client.getBalances();

console.log(`\n${"-".repeat(64)}`);
console.log(`  ${ok} settled - ${empty} wasted - ${blocked} blocked`);
console.log(`  Gateway balance: ${bal2.gateway.formattedAvailable} USDC`);
console.log(`${"-".repeat(64)}`);
console.log(`  Dashboard : ${BASE}/dashboard/agents/${AGENT}`);
if (!BRING_YOUR_OWN_ACCOUNT) console.log(`  Login     : ${EMAIL}  /  ${PASSWORD}`);
console.log(`  API key   : ${apiKey}`);
console.log(`${"-".repeat(64)}\n`);
process.exit(0);
