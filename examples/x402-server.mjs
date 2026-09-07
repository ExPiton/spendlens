/**
 * A richer throwaway "paid API" for end-to-end testing. Speaks the HTTP 402
 * payment-challenge protocol like a Nanopayments merchant would, and echoes
 * back the payment header it received so a test can see the SDK signed.
 *
 *   GET /v1/data       402 -> 200 normal JSON body            (quality: ok)
 *   GET /v1/empty      402 -> 200 empty body                  (quality: empty)
 *   GET /v1/slow       402 -> 200 after 4.5s                  (quality: slow)
 *   GET /v1/error      402 -> 503                             (quality: http_error)
 *   GET /v1/expensive  402 asking 5.00 USDC                   (block: per_call)
 *   GET /scam          402 from a flagged address             (block: denylist)
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PAID_API_PORT ?? 4021);
const GOOD_PAYEE = "api.example.io";
const SCAM_PAYEE = "0x000000000000000000000000000000000badc0de";

const ROUTES = {
  "/v1/data": { payTo: GOOD_PAYEE, amount: 0.003, status: 200, body: () => JSON.stringify({ rows: 3 }) },
  "/v1/empty": { payTo: GOOD_PAYEE, amount: 0.003, status: 200, body: () => "" },
  "/v1/slow": { payTo: GOOD_PAYEE, amount: 0.004, status: 200, delayMs: 4500, body: () => JSON.stringify({ ok: 1 }) },
  "/v1/error": { payTo: GOOD_PAYEE, amount: 0.003, status: 503, body: () => "upstream unavailable" },
  "/v1/expensive": { payTo: GOOD_PAYEE, amount: 5.0, status: 200, body: () => JSON.stringify({ ok: 1 }) },
  "/scam": { payTo: SCAM_PAYEE, amount: 0.002, status: 200, body: () => JSON.stringify({ gotcha: 1 }) },
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = ROUTES[url.pathname];
  if (!route) return void res.writeHead(404).end("not found");

  const paymentHeader =
    req.headers["authorization"] || req.headers["x-payment-authorization"];

  if (!paymentHeader) {
    res.writeHead(402, {
      "content-type": "application/json",
      "x-pay-to": route.payTo,
      "x-pay-amount": String(route.amount),
      "x-pay-currency": "USDC",
      "x-pay-nonce": randomUUID(),
      "x-pay-chain-id": "5042",
    });
    return void res.end(JSON.stringify({ error: "payment required", payTo: route.payTo, amount: route.amount }));
  }

  // A real merchant would verify the signature against on-chain state here.
  const signed = /^Signature keyId="0x[0-9a-fA-F]{40}", nonce=".+", sig="0x[0-9a-fA-F]{130}"$/.test(
    String(paymentHeader),
  );
  if (route.delayMs) await new Promise((r) => setTimeout(r, route.delayMs));
  res.writeHead(route.status, { "content-type": "application/json", "x-payment-verified": String(signed) });
  res.end(route.body());
});

server.listen(PORT, () => console.log(`[x402-server] listening on http://localhost:${PORT}`));
