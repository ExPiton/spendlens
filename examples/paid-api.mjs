/**
 * A throwaway "paid API" that speaks the HTTP 402 payment-challenge protocol,
 * so you can watch Spendlens intercept, decide, and record without needing a
 * real x402 service. Started automatically by `npm run example`.
 *
 *   GET /v1/data       -> 402, then 200 with a normal JSON body
 *   GET /v1/empty      -> 402, then 200 with an EMPTY body   (quality: "empty")
 *   GET /v1/expensive  -> 402 asking for 5.00 USDC           (per-call block)
 *   GET /v1/slow       -> 402, then 200 after 6s             (quality: "slow")
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PAID_API_PORT ?? 4021);
const PAY_TO = "0x1a2b3c4d5e6f7890abcdef1234567890abcdef12";

const ROUTES = {
  "/v1/data": { amount: 0.003, body: () => JSON.stringify({ rows: 3, data: [1, 2, 3] }) },
  "/v1/empty": { amount: 0.003, body: () => "" },
  "/v1/expensive": { amount: 5.0, body: () => JSON.stringify({ ok: true }) },
  "/v1/slow": { amount: 0.004, delayMs: 6000, body: () => JSON.stringify({ ok: true }) },
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = ROUTES[url.pathname];
  if (!route) {
    res.writeHead(404).end("not found");
    return;
  }

  const paid = Boolean(req.headers["authorization"] || req.headers["x-payment-authorization"]);
  if (!paid) {
    res.writeHead(402, {
      "content-type": "application/json",
      "x-pay-to": PAY_TO,
      "x-pay-amount": String(route.amount),
      "x-pay-currency": "USDC",
      "x-pay-nonce": randomUUID(),
      "x-pay-chain-id": "5042",
    });
    res.end(JSON.stringify({ error: "payment required", payTo: PAY_TO, amount: route.amount }));
    return;
  }

  if (route.delayMs) await new Promise((r) => setTimeout(r, route.delayMs));
  res.writeHead(200, { "content-type": "application/json" });
  res.end(route.body());
});

server.listen(PORT, () => {
  console.log(`[paid-api] listening on http://localhost:${PORT}`);
});
