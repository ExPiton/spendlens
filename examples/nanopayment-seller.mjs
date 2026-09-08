/**
 * A REAL Circle Nanopayments seller (x402 + GatewayWalletBatched) on Arc
 * testnet, using `@circle-fin/x402-batching/server`. Unlike examples/x402-server.mjs
 * (a plain-header mock), this speaks the actual scheme so `GatewayClient.pay()`
 * / `guardGateway` can complete a real, batched, gas-free settlement.
 *
 *   SELLER_ADDRESS=0x... node examples/nanopayment-seller.mjs
 *
 *   GET /premium     $0.01   normal JSON body
 *   GET /empty       $0.01   empty 200 body      (Spendlens quality: "empty")
 *   GET /expensive   $5.00   priced over a tight per_call policy -> guardGateway blocks
 */
import { readFileSync } from "node:fs";
import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

for (const line of safeRead(new URL("../.env", import.meta.url)).split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
function safeRead(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }

const SELLER_ADDRESS = process.env.SELLER_ADDRESS;
const PORT = Number(process.env.SELLER_PORT ?? 4030);
const NETWORK = process.env.ARC_NETWORK === "mainnet" ? "eip155:5042" : "eip155:5042002";
const FACILITATOR =
  process.env.ARC_NETWORK === "mainnet"
    ? "https://gateway-api.circle.com"
    : "https://gateway-api-testnet.circle.com";

if (!SELLER_ADDRESS) {
  console.error("Set SELLER_ADDRESS (any 0x address that should receive payments).");
  process.exit(1);
}

const gateway = createGatewayMiddleware({
  sellerAddress: SELLER_ADDRESS,
  networks: [NETWORK],
  facilitatorUrl: FACILITATOR,
  description: "Spendlens Nanopayments demo",
});

const app = express();

app.get("/premium", gateway.require("$0.01"), (_req, res) => {
  res.json({ data: { rows: 3, generatedAt: new Date().toISOString() } });
});
app.get("/empty", gateway.require("$0.01"), (_req, res) => {
  res.status(200).type("application/json").send("");
});
app.get("/expensive", gateway.require("$5.00"), (_req, res) => {
  res.json({ data: "should never get here under a tight policy" });
});

app.listen(PORT, () => {
  console.log(
    `[nanopayment-seller] http://localhost:${PORT}  seller=${SELLER_ADDRESS}  network=${NETWORK}`,
  );
});
