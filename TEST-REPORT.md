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

## Arc integration (see ARC.md)

- **Real Nanopayments path**: `guardGateway()` wraps
  `@circle-fin/x402-batching`'s `GatewayClient`, hooking the policy engine into
  its `onBeforePaymentCreation` lifecycle hook. Circle's SDK does the EIP-3009 /
  `GatewayWalletBatched` EIP-712 signing; the key never leaves it. 4 unit tests.
- **Real Arc settlement source**: `reconcileFromGateway()` reads
  `GatewayClient.searchTransfers()` and feeds `/api/reconciliation/settlements`
  (`npm run reconcile:arc`). 1 unit test.
- Chain id fixed: testnet `5042002` (was wrongly `5042`, which is mainnet).

## Real on-chain run — Arc testnet (`scripts/arc-live-test.mjs`)

Funded wallet `0x31BBf8EF…d5E` with 20 testnet USDC from `faucet.circle.com`.
Verified on-chain: `eth_getBalance` + USDC `balanceOf` both `20.000000`.

| Step | Result |
|---|---|
| Deposit into Circle Gateway | on-chain tx `0x3914ee65…`, 2 USDC moved in |
| `guardGateway` → `/premium` ($0.01) | `http 200`, **settled** — Gateway transfer id `5a5a0b44-…`, gas-free |
| `guardGateway` → `/empty` ($0.01) | settled; recorded `allow / quality=empty` (wasted spend) |
| `guardGateway` → `/expensive` ($5.00) | **`PolicyBlocked: per_call.max_usdc`** — aborted before signing, no funds moved |
| `reconcileFromGateway` → `/api/reconciliation/settlements` | `200 { imported: 1 }`, chain totals from real `searchTransfers` |
| Spendlens ledger (this agent) | 3 rows, `chainId: 5042002`, the `ok` row carries the real settlement id |
| Gateway balance | `1.96 → 1.94` USDC (2 × $0.01 real payments) |

The seller is a real `@circle-fin/x402-batching/server` middleware
(`examples/nanopayment-seller.mjs`) — the 402 carries the actual
`GatewayWalletBatched` scheme + Gateway Wallet `verifyingContract`.

## Remaining gaps

- `createLocalSigner` is a generic ECDSA signer for non-Circle x402 servers; the
  Circle path uses `guardGateway` + `@circle-fin/x402-batching`.
- SDK is served from the app (`/downloads/spendlens-sdk.tgz`), not published to npm.
- `@circle-fin/x402-batching`, `viem` etc. are dev deps here (for the example
  seller + reconcile script); an agent project installs them itself.

## Mainnet hardening — 2026-09-27

Fixes for the mainnet-readiness review, each covered by a test:

| Area | Change | Verified by |
|---|---|---|
| Counterparty case | canonical lowercase everywhere; denylist can't be bypassed by re-casing; ledger ⇄ Gateway joins match | `test/mainnet-hardening.test.ts`, `test/reconciliation.test.ts`, e2e |
| Kill switch | a halted agent's guard blocks **before signing** (`agent.halted`) via `/api/sdk/config` + ingest header; halted ingest still recorded | unit + e2e |
| Mainnet RPC | no guessed fallback URL (`rpc.arc.network` doesn't resolve) — Circle's SDK raises its own error | code + docs |
| Approved holds | counted as spend in reconciliation, totals, waste and **budgets** | unit + DB integration |
| Reconciliation | per (agent, chain, counterparty); `failed` transfers skipped; keyless server job with grace window, auto-halt + e-mail on critical | DB integration, real Gateway testnet read by address |
| Mainnet rails | no permissive default, no mock signer on mainnet | unit (child process with `ARC_NETWORK=mainnet`) |
| Proposal parity | policy hash on every row, monthly budgets, entropy signal, JSON-schema quality, human-in-the-loop escalation, remote policy, `policy: "./policy.yaml"`, SQLite self-hosted ledger, DB-enforced append-only ledger + daily hash-chained digests (optional Arc anchoring) | unit + DB integration + e2e |
| Ops | e-mail verification when a provider is configured, Postgres rate-limit store, error reporting hook, nightly backups, pinned deps + SBOM + prod audit in CI, npm publish workflow | CI config, DB integration |

Results on this run: `npm test` 99/99 · `npm run test:db` 12/12 · `npm run test:e2e` 30/30 · `scripts/verify-gaps.mjs` all ✓ · `npm run build` clean.

Not done here (needs the owner): a funded **mainnet** smoke run (real USDC), publishing `@spendlens/sdk` to npm (push an `sdk-v*` tag with `NPM_TOKEN` set), and the independent security review.
