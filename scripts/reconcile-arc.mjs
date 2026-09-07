/**
 * Pulls the agent wallet's on-chain settlement history from Circle Gateway and
 * feeds it into Spendlens reconciliation.
 *
 *   npm run reconcile:arc
 *
 * Requires (in .env or the environment):
 *   AGENT_PRIVATE_KEY   - the agent wallet key (GatewayClient needs it to talk to the API)
 *   AGENT_ADDRESS       - optional; defaults to the address derived from the key
 *   SPENDLENS_URL       - your Spendlens deployment
 *   SPENDLENS_API_KEY   - an API key for the agent (dashboard -> agent -> Create key)
 *   ARC_NETWORK=mainnet - optional; defaults to testnet
 *
 * And the peer package:  npm install @circle-fin/x402-batching viem
 */
import { readFileSync } from "node:fs";

for (const line of safeRead(".env").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
function safeRead(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }

const { ARC, ARC_GATEWAY_CHAIN, reconcileFromGateway } = await import(
  "../public/downloads/spendlens-sdk.mjs"
);

const need = ["AGENT_PRIVATE_KEY", "SPENDLENS_URL", "SPENDLENS_API_KEY"].filter(
  (k) => !process.env[k],
);
if (need.length) {
  console.error("Missing env: " + need.join(", "));
  process.exit(1);
}

let GatewayClient;
try {
  ({ GatewayClient } = await import("@circle-fin/x402-batching/client"));
} catch {
  console.error(
    "This needs Circle's package:\n  npm install @circle-fin/x402-batching viem\n",
  );
  process.exit(1);
}

const client = new GatewayClient({
  chain: ARC_GATEWAY_CHAIN,
  privateKey: process.env.AGENT_PRIVATE_KEY,
});

const fromAddress = process.env.AGENT_ADDRESS || client.address;
console.log(`Reconciling settlements for ${fromAddress} on Arc ${ARC.network}…`);

const settlements = await reconcileFromGateway(client, { fromAddress });
if (settlements.length === 0) {
  console.log("No on-chain transfers found yet.");
  process.exit(0);
}
for (const s of settlements) {
  console.log(`  ${s.counterparty}  ${(s.chainAmountMicroUsdc / 1e6).toFixed(6)} USDC`);
}

const res = await fetch(
  `${process.env.SPENDLENS_URL.replace(/\/$/, "")}/api/reconciliation/settlements`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.SPENDLENS_API_KEY}`,
    },
    body: JSON.stringify({ settlements }),
  },
);
const body = await res.json().catch(() => ({}));
console.log(`\n/api/reconciliation/settlements -> ${res.status}`, body);
process.exit(res.ok ? 0 : 1);
