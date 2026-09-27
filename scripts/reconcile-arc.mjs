/**
 * Runs Arc reconciliation for an agent now, instead of waiting for the
 * server's schedule. KEYLESS: Circle Gateway's transfer history is queryable
 * by wallet address, so no private key is read, needed, or sent anywhere.
 *
 *   npm run reconcile:arc
 *
 * Requires (in .env or the environment):
 *   SPENDLENS_URL       - your Spendlens deployment
 *   SPENDLENS_API_KEY   - an API key for the agent (dashboard -> agent -> Create key)
 *
 * The agent's wallet address must be set in the dashboard (agent page ->
 * Wallet) or via `PATCH /api/agents/<slug> { "walletAddress": "0x…" }`.
 * Optional: AGENT_ADDRESS — if set and the agent has no wallet on file yet,
 * this script prints the exact PATCH to register it.
 */
import { readFileSync } from "node:fs";

for (const line of safeRead(".env").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
function safeRead(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }

const need = ["SPENDLENS_URL", "SPENDLENS_API_KEY"].filter((k) => !process.env[k]);
if (need.length) {
  console.error("Missing env: " + need.join(", "));
  process.exit(1);
}

const base = process.env.SPENDLENS_URL.replace(/\/$/, "");
const res = await fetch(`${base}/api/reconciliation/run`, {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.SPENDLENS_API_KEY}` },
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`/api/reconciliation/run -> ${res.status}`, body);
  process.exit(1);
}

if (body.agents === 0) {
  console.log("This agent has no wallet address on file, so there is nothing to reconcile yet.");
  if (process.env.AGENT_ADDRESS) {
    console.log(
      `Register it (signed in as the owner):\n  PATCH ${base}/api/agents/<agent-slug>  {"walletAddress":"${process.env.AGENT_ADDRESS}"}\n` +
        "or paste it on the agent's page in the dashboard.",
    );
  }
  process.exit(0);
}

console.log(`Reconciled ${body.rows} counterpart${body.rows === 1 ? "y" : "ies"} on Arc.`);
if (body.critical > 0) {
  console.log(`CRITICAL: ${body.critical} with on-chain spend the ledger never recorded.`);
  if (body.halted?.length) console.log(`Halted: ${body.halted.join(", ")}`);
}
for (const e of body.errors ?? []) console.error(`  ${e.agent}: ${e.error}`);
process.exit(body.critical > 0 || body.errors?.length ? 2 : 0);
