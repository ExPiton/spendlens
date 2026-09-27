/**
 * The REAL Circle Nanopayments path: an agent pays for an x402 resource on Arc
 * through Circle Gateway, with Spendlens enforcing policy and recording
 * telemetry via the `onBeforePaymentCreation` hook.
 *
 *   npm install @circle-fin/x402-batching viem      # once, in this repo
 *   node scripts/new-wallet.mjs                      # -> AGENT_ADDRESS in .env
 *   # fund AGENT_ADDRESS with testnet USDC at https://faucet.circle.com
 *   PAID_API_URL=https://a-real-x402-endpoint node examples/arc-nanopayment.mjs
 *
 * Needs in .env: AGENT_PRIVATE_KEY, and optionally SPENDLENS_URL + SPENDLENS_API_KEY
 * to stream telemetry to your dashboard.
 *
 * NOTE: examples/x402-server.mjs is a plain-header 402 mock and does NOT speak
 * the GatewayWalletBatched scheme, so point PAID_API_URL at a real Circle
 * Nanopayments seller (see https://developers.circle.com/gateway/nanopayments/quickstarts/seller).
 */
import { readFileSync } from "node:fs";

for (const line of safeRead(new URL("../.env", import.meta.url)).split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
function safeRead(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }

const PAID_API_URL = process.env.PAID_API_URL;
if (!process.env.AGENT_PRIVATE_KEY || !PAID_API_URL) {
  console.error("Set AGENT_PRIVATE_KEY (.env) and PAID_API_URL (a real x402 endpoint).");
  process.exit(1);
}

let GatewayClient;
try {
  ({ GatewayClient } = await import("@circle-fin/x402-batching/client"));
} catch {
  console.error("Run:  npm install @circle-fin/x402-batching viem");
  process.exit(1);
}

const { guardGateway, ARC, ARC_GATEWAY_CHAIN } = await import(
  "../public/downloads/spendlens-sdk.mjs"
);

const client = new GatewayClient({
  chain: ARC_GATEWAY_CHAIN,
  privateKey: process.env.AGENT_PRIVATE_KEY,
  rpcUrl: ARC.rpcUrl,
});

console.log(`Wallet ${client.address} on Arc ${ARC.network} (chain ${ARC.chainId})`);
const balances = await client.getBalances();
console.log(
  `  wallet USDC ${balances.wallet.formatted} · Gateway available ${balances.gateway.formattedAvailable}`,
);
if (balances.gateway.available < 100_000n) {
  console.log(
    "\n  Gateway balance is low. Deposit once (spends real testnet USDC + gas):\n" +
      "    node -e \"import('@circle-fin/x402-batching/client').then(m=>new m.GatewayClient({chain:'" +
      ARC_GATEWAY_CHAIN +
      "',privateKey:process.env.AGENT_PRIVATE_KEY}).deposit('1').then(console.log))\"\n",
  );
}

const pay = guardGateway(client, {
  agentId: process.env.SPENDLENS_AGENT_ID ?? "arc-nanopayment-demo",
  // policy: "./policy.yaml",  // or YAML text. Omitted: with SPENDLENS_URL +
  //                           // SPENDLENS_API_KEY the agent follows its
  //                           // dashboard policy (kill switch included);
  //                           // without them, a permissive testnet-only default.
  //                           // On mainnet a policy is mandatory.
});

console.log(`\n→ pay ${PAID_API_URL}`);
try {
  const { data, formattedAmount, transaction, status } = await pay.fetch(PAID_API_URL, {
    taskId: "task-arc-1",
  });
  console.log(`  http ${status} · paid ${formattedAmount} USDC · settlement ${transaction}`);
  console.log("  data:", typeof data === "string" ? data.slice(0, 200) : data);
} catch (err) {
  console.log(`  ${err.name}: ${err.message}`);
}

await new Promise((r) => setTimeout(r, 1500)); // flush telemetry queue
console.log(
  process.env.SPENDLENS_URL
    ? "\nDone — check your dashboard → Ledger."
    : "\nDone (set SPENDLENS_URL + SPENDLENS_API_KEY to record this in a dashboard).",
);
await pay.drain();
process.exit(0);
