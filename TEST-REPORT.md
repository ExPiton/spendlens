# Spendlens — End-to-End Test Report

**Date:** 2026-09-07 · **Branch:** `feat/live-saas` · **Instance:** local (Docker Compose)

## Scope & the faucet question

A *real* on-chain test — pull testnet USDC from Circle's Arc faucet, pay a live
Nanopayments merchant, settle on Arc — **could not be run from here**:

- Circle's faucet is gated by CAPTCHA / wallet-connect and needs a Circle
  account; automating or solving that is out of scope.
- There is no reference Nanopayments merchant to pay, and `createLocalSigner`
  is a generic secp256k1/keccak signer, not Circle's exact x402 envelope — a
  real merchant would reject it without their spec.

So the paid API is a **local x402 server** (`examples/x402-server.mjs`) that
speaks the same HTTP 402 protocol. **Everything else is the real code path**:
real ECDSA signatures, the real policy engine, the real ledger, quality
analysis, reconciliation, per-tenant isolation, and the hosted ingest endpoint.

Harness: `npm run test:e2e` (`scripts/e2e-test.mjs`).

## What the test does

1. **Signs up a fresh tenant**, creates an agent (`arc-test-…`), mints an API
   key (`sl_…`), saves a Zod-validated policy (allowlist `api.example.io`,
   denylist a flagged address, `per_call.max_usdc = 0.05`, `max_latency_ms = 4000`).
2. A **simulated-wallet agent** (random secp256k1 key, `createLocalSigner`)
   makes **32 paid calls** through `guard().fetch` against the x402 server:
   15 normal · 5 empty-body · 2 slow · 3 error · 3 over-limit · 4 to the flagged address.
3. Telemetry is streamed to `POST /api/authorizations` with the API key.
4. **Simulated on-chain settlement** is fed to `POST /api/reconciliation/settlements`:
   a matching total for `api.example.io`, and a **phantom** `0xleakedkey…`
   (chain 0.5 USDC, ledger 0) standing in for a leaked signing key.
5. Every dashboard API is read back and asserted.

## Result: 22 / 22 checks passed

### Interception SDK + signing

| | |
|---|---|
| 402 challenges intercepted, signed, resent | 25 signed `200`s, merchant `x-payment-verified: true` |
| Signature | real secp256k1 ECDSA, keccak digest, Ethereum-style `r‖s‖v` |

### Policy engine

| Call | Decision | Rule |
|---|---|---|
| 5.00 USDC request ×3 | **block** | `per_call.max_usdc` |
| flagged address `0x…badc0de` ×4 | **block** | `counterparties.deny` |
| everything else | allow | — |

7 blocked · **15.008 USDC of spend prevented**.

### Append-only ledger (this tenant, 32 rows)

| decision | quality | count | spend |
|---|---|--:|--:|
| allow | ok | 15 | 0.045000 USDC |
| allow | empty | 5 | 0.015000 USDC |
| allow | http_error | 3 | 0.009000 USDC |
| allow | slow | 2 | 0.008000 USDC |
| block | — | 7 | (0.077 allowed; 15.008 blocked) |

### Quality & wasted-spend analysis

- **Waste ratio 41.6 %** — 0.032 USDC of 0.077 USDC allowed spend bought a
  broken response (empty body, 5xx, or over the 4 s latency budget).
- Counterparty reputation: `api.example.io` → **60 % quality score** over 28 calls.

### Arc reconciliation audit

| counterparty | chain | ledger | delta | status |
|---|--:|--:|--:|---|
| `api.example.io` | 0.077 USDC | 0.077 USDC | 0 | 🟢 ok |
| `0xleakedkey…` (phantom) | 0.500 USDC | 0 | +0.500 | 🔴 **critical** |

The phantom on-chain settlement with no matching ledger entry is flagged
**CRITICAL** (suspected unauthorized signature / key leak) — Scenario C from the
proposal, caught.

### Tenancy & security

- All 32 rows, the policy, the keys and the reconciliation rows are scoped to
  the new tenant only.
- `POST /api/authorizations` with an unknown API key → **401**.
- Better Auth: signup → session, session-guarded dashboard + APIs.

## Also verified this session

- `npm test` — 45 unit tests pass (engines, SDK guard, `createLocalSigner`,
  policy template, API-key crypto, slugs).
- `npm run build` — production build clean; Docker image builds the SDK in the
  builder stage and runs migrations on boot.
- `npm run example` — the same loop as a one-command demo.

## Honest gaps (unchanged from before)

- No live Arc settlement source — reconciliation is fed via the
  `/api/reconciliation/settlements` seam (CSV/cron/webhook).
- `createLocalSigner` is a generic signer; a specific merchant may need a
  custom `signer`.
- SDK is served from the app (`/downloads/spendlens-sdk.tgz`), not published to npm.
