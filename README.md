# Spendlens

> **An oversight and observability layer for AI agent spend on Arc.**

[![Arc Ready](https://img.shields.io/badge/Arc-EVM%20Compatible-blue)](https://developers.circle.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen)](https://github.com)

---

## 1. Overview

AI agents can now spend micropayments entirely on their own. Circle built the infrastructure for it with **Nanopayments** and **Agent Wallets**: an agent can pay a fraction of a cent for every API call it makes, in seconds.

But that infrastructure only guarantees the payment goes through — it **doesn't measure whether it was correct, safe, or worth what was paid for**.

**Spendlens** is the software layer that fills that gap:
- Screens every payment an agent makes through a **policy filter** before it settles,
- Logs every decision to an **immutable event ledger**,
- Measures the **quality of the service received** and the resulting waste ratio,
- Compares local records against **Arc Gateway's batched on-chain settlement** to catch signing-key leaks.

> **Positioning:** *"Circle built the payment rail. We show you what's actually happening on it."*

---

## 2. Three Critical Failure Scenarios Solved

| Scenario | Problem | Status Quo | How Spendlens Solves It |
|---|---|---|---|
| **A: Prompt Injection** | The agent is redirected to an attacker's API via a hidden instruction on a crawled page, making 4,000 rapid calls ($0.003/call). | The wallet never alarms since no single call exceeds the per-call limit ($0.05). Funds drain. | **Counterparty rules** (allowlist, or first-seen hold/block), budgets and the **EWMA burn rate** stop the flow — *if your policy says so*: the starter policy only alerts, so tighten it (the dashboard **Simulator** shows what your saved policy would actually stop). |
| **B: Silent Quality Degradation** | A data provider breaks and starts returning empty-bodied `200 OK` responses. | Payment keeps flowing uninterrupted since the HTTP status is still successful; money is wasted. | **Quality Classifier & Waste Analysis** immediately surfaces *"31% of spend went unmatched."* |
| **C: Key Leakage** | The agent's signing key leaks; the attacker signs authorizations within the existing policy's limits. | Wallet policy is never violated, so the local agent has no idea. | **Arc Reconciliation Audit** compares on-chain spend against the ledger (`delta > tolerance` &rarr; CRITICAL alert & automatic halt). |

---

## 3. Five Core Components

```
                                  +-------------------------------------------------+
                                  |         AI Agent (e.g. Research Crawler)         |
                                  +-------------------------------------------------+
                                                           |
                                           pay.fetch("https://api.example.io/v1/data")
                                                           |
                                                           v
+---------------------------------------------------------------------------------------------------+
| Spendlens Layer                                                                                   |
|                                                                                                   |
|  [ Component 1: Interception SDK ]                                                                |
|      402 Payment Required Detection & Pre-Signing Interception                                    |
|              |                                                                                    |
|              v                                                                                    |
|  [ Component 2: Declarative Policy Engine (YAML) ]                                                |
|      1. Denylist -> 2. Per-call -> 3. Budgets -> 4. Counterparties -> 5. Anomaly -> 6. Quality    |
|              |                                                                                    |
|              +---> (BLOCK / HOLD / ALLOW)                                                         |
|              |                                                                                    |
|              v                                                                                    |
|  [ Agent Signing (Non-Custodial) ] ──> HTTP Request Completed ──> [ Component 4: Quality Analysis ]|
|              |                                                                                    |
|              v (Async, non-blocking queue)                                                        |
|  [ Component 3: Append-Only Event Ledger ]                                                        |
|      SQLite / PostgreSQL (bodies never stored, only a SHA-256 digest is kept)                     |
+---------------------------------------------------------------------------------------------------+
                                                           |
                                                           v
+---------------------------------------------------------------------------------------------------+
| Arc Blockchain & Circle Gateway                                                                   |
|                                                                                                   |
|  [ Component 5: Arc Reconciliation Audit ]                                                        |
|      Gateway Net On-Chain Settlement <─── Delta Comparison ───> Spendlens Local Ledger             |
+---------------------------------------------------------------------------------------------------+
```

---

## 4. Quickstart (local)

Spendlens is a multi-tenant app: users sign up, then register agents and mint
per-agent API keys the SDK uses to stream telemetry. It needs Postgres and a
few environment variables.

### Step 1: Install & configure

```bash
git clone https://github.com/your-org/spendlens.git
cd spendlens
npm install
cp .env.example .env          # set BETTER_AUTH_SECRET (openssl rand -base64 32)
```

### Step 2: Start Postgres & run migrations

```bash
docker compose up -d db        # Postgres 16 on localhost:5432
npm run db:migrate             # apply drizzle/*.sql
npm run dev                    # http://localhost:3000
```

Open `http://localhost:3000/signup` and create an account. Locally (no e-mail
provider configured) you land straight on `/dashboard`; in any deployment with
Resend/SMTP configured, the e-mail address must be verified first. Use **Load
sample data** to populate every screen, or **New agent** to start clean.

> One-command production run instead: `docker compose up -d --build` — see
> [DEPLOY.md](DEPLOY.md).

### Step 3: See the whole loop in 30 seconds

```bash
npm run example
```

Starts a throwaway "paid API" that speaks HTTP 402 and runs an example agent
against it through the SDK — you'll see `allow / ok`, `allow / empty` (wasted
spend), and a `block` on `per_call.max_usdc`. To stream those into your
dashboard too, create an agent + key and:

```bash
SPENDLENS_URL=http://localhost:3000 \
SPENDLENS_API_KEY=sl_... \
SPENDLENS_AGENT_ID=my-agent \
npm run example
```

### Step 4: Write a Policy File (`policies/research-crawler-01.yaml`)

> **Counterparty modes.** `mode: allowlist` is strict — only addresses in `allow`
> (and ones a human approved) can be paid. Any other counterparty is **held** for a
> person when `first_seen.action` is `hold`, and **blocked** otherwise
> (`counterparties.allowlist`); `auto_allow_below_usdc` does not apply. `mode: denylist`
> runs `first_seen.action` for first contact, waving through payments at or under
> `auto_allow_below_usdc` — and such a micro-payment does *not* vet the address, so a
> later larger payment still meets the gate. `deny` always wins over `allow`.

> With `SPENDLENS_URL` + `SPENDLENS_API_KEY` set and no local `policy`, a guard
> follows the agent's policy from the **Policies** tab — edits apply live, no
> redeploy. Without a server or a policy, `guard()` falls back to a permissive
> "record everything, block nothing" default **on testnet only** (it refuses to
> start on mainnet without a policy). A YAML file looks like:

```yaml
version: 1
agent: research-crawler-01

budgets:
  - scope: task
    limit_usdc: 5.00
  - scope: hour
    limit_usdc: 2.00
  - scope: day
    limit_usdc: 20.00
  - scope: month          # current UTC calendar month
    limit_usdc: 400.00

per_call:
  max_usdc: 0.05
  max_calls_per_minute: 600

counterparties:
  mode: allowlist
  allow:
    - "api.example.io"
    - "0x1a2b3c4d5e6f7890abcdef1234567890abcdef12"
  deny: []
  first_seen:
    action: hold
    auto_allow_below_usdc: 0.001

anomaly:
  burn_rate:
    baseline: ewma
    halflife_minutes: 15
    z_threshold: 3.0
    action: hold
  new_counterparty_rate:
    max_per_hour: 5
    action: alert
  counterparty_entropy:   # sudden concentration onto one counterparty
    window_minutes: 60
    min_calls: 50
    max_drop: 0.6         # entropy fell >60% below its baseline
    action: alert

quality:
  failure_status_codes: [402, 429, 500, 502, 503, 504]
  empty_body_is_failure: true
  json_schema:            # body must match, else quality = schema_fail
    type: object
    required: [data]
  max_latency_ms: 4000

escalation:
  webhook: "https://spendlens.example.com/api/escalate"   # a human approves in the dashboard
  timeout_seconds: 120
  on_timeout: block
  auto_approve_below_usdc: 0.01   # optional — defaults to 5x first_seen's ceiling
```

### Step 5: Wire a real agent

Install the SDK — the running app serves it (dashboard → your agent → **SDK
connection** shows the exact line):

```bash
npm install https://your-spendlens.example.com/downloads/spendlens-sdk.tgz
# or vendor one file: curl -O https://your-spendlens.example.com/downloads/spendlens-sdk.mjs
```

Create an agent + key in the dashboard, then in the agent's environment set
`SPENDLENS_URL` and `SPENDLENS_API_KEY` and:

```typescript
import { guard, createLocalSigner } from "@spendlens/sdk";

const pay = guard({
  agentId: "research-crawler-01",
  // apiKey + sink are read from SPENDLENS_API_KEY / SPENDLENS_URL if omitted
  policy: "./policy.yaml",   // YAML text, a file path, or omit to follow the dashboard
  signer: createLocalSigner(process.env.AGENT_PRIVATE_KEY), // required on mainnet
});

// Use pay.fetch instead of fetch anywhere the agent calls a paid API:
const res = await pay.fetch("https://api.example.io/v1/data", { taskId: "task-1" });
const data = await res.json();
```

`pay.fetch` only engages on an HTTP **402** payment challenge (x402 headers,
`WWW-Authenticate: Nanopayment`, or a JSON body with `payTo` + `amount`);
everything else passes straight through untouched. Without a `signer` it uses a
clearly-logged mock signature — policy, telemetry and quality analysis are
real, but the payment will not settle. The mock is **testnet-only**: on Arc
mainnet (`ARC_NETWORK=mainnet`, or a 402 carrying chain `5042`) the guard
refuses to run without a real signer.

Connected to a Spendlens server, every guard also obeys the dashboard's **kill
switch**: halting an agent makes its guard block every payment *before
signing* (`agent.halted`) within one sync interval (15 s) or on the next ingest
response, whichever comes first. The halted agent's records are still accepted,
so the audit trail stays complete.

Self-hosted without a server: `sink: createSqliteLedger("./ledger.db").sink`
keeps an append-only SQLite ledger (Node's built-in `node:sqlite`).

### Circle Nanopayments (Arc + Circle Gateway)

For the real Circle path — gas-free USDC micropayments settled in batches on
Arc — wrap `@circle-fin/x402-batching`'s `GatewayClient` with `guardGateway`.
Spendlens hooks its policy engine into `onBeforePaymentCreation`; the wallet key
never leaves `GatewayClient`.

```typescript
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { guardGateway, ARC, ARC_GATEWAY_CHAIN } from "@spendlens/sdk";

// ARC_GATEWAY_CHAIN / ARC.rpcUrl resolve from ARC_NETWORK — testnet by default.
const client = new GatewayClient({ chain: ARC_GATEWAY_CHAIN, privateKey, rpcUrl: ARC.rpcUrl });
const pay = guardGateway(client, { agentId: "research-crawler-01" });
const { data, transaction } = await pay.fetch("https://api.example.io/premium", { taskId: "t1" });
```

**Reconciliation is keyless and automatic.** Put the agent's wallet address on
its dashboard page (or `PATCH /api/agents/<slug> {"walletAddress": "0x…"}`);
the server reads that wallet's transfers straight from Circle Gateway by address
every 10 minutes, compares them per counterparty with the agent's ledger on the
same Arc chain, and on on-chain spend the ledger never recorded (a leaked key)
**halts the agent and e-mails the owner**. No private key is involved anywhere.
`npm run reconcile:arc` triggers a run on demand. Full walkthrough, contract
addresses and the EIP-3009 / `GatewayWalletBatched` details:
**[ARC.md](ARC.md)**.

> Arc chain ids: testnet **5042002**, mainnet **5042**. Set `ARC_NETWORK=mainnet`
> to switch. **Mainnet has no public RPC** — `ARC_MAINNET_RPC_URL` (an Alchemy,
> QuickNode, or Circle-provided endpoint) is required and must be passed as
> `rpcUrl` to `GatewayClient` as shown above. There is deliberately no fallback
> URL: with the variable unset, `ARC.rpcUrl` is `undefined` and Circle's SDK
> fails immediately with its own "pass a private RPC" error. Always import
> `ARC_GATEWAY_CHAIN`/`ARC.rpcUrl` from the SDK rather than hardcoding
> `"arcTestnet"`, so the same code works on both networks.

---

## 5. Dashboard Screens & Features

- **Marketing page (`/`)**: A single-page site positioning the product, walking through the three failure scenarios, and including a live preview rendered with the dashboard's real components (not a static image) on sample data, plus a "how it works" walkthrough.
- **Overview (`/dashboard`)**: Four core KPI cards at the top (Total Spend, Unmatched Spend & %, Blocked Calls, Reconciliation Status) and a headline waste-analysis sentence.
- **Event Ledger (`/dashboard/ledger`)**: A filterable, searchable, paginated authorization ledger. Clicking any record opens a **Telemetry Drawer** (latency, SHA-256 digest, nonce, settlement ID, triggered rule, and the SHA-256 of the exact policy the decision was evaluated against). A **Ledger integrity** panel shows each sealed day's hash-chained digest, re-verified live, with its Arc anchor transaction.
- **Agent Fleet (`/dashboard/agents` & `/dashboard/agents/[agentId]`)**: Spend, efficiency, and anomaly status for every agent, with an emergency kill switch.
- **Counterparties & Reputation (`/dashboard/counterparties`)**: Quality scores, empty-body/error rates, and first-seen timestamps for every API provider paid.
- **Arc Reconciliation Audit (`/dashboard/reconciliation`)**: Per agent wallet and Arc chain, Circle Gateway's settlement against the local ledger (🔴 CRITICAL / 🟡 PENDING / 🟢 OK), refreshed automatically.
- **Payment Approvals (`/dashboard/approvals`)**: Held payments waiting for a human (the agent waits, nothing is signed), with approve/deny and history. The owner is e-mailed when one arrives.
- **Policy Management (`/dashboard/policies`)**: A live YAML editor with instant Zod schema validation and a rule summary.
- **Anomaly & Rate Monitoring (`/dashboard/anomalies`)**: The three signals — EWMA burn rate, new-counterparty rate, counterparty entropy (sudden concentration) — and cold-start (warmup) status.
- **Interactive Simulator (`/dashboard/simulator`)**: A test environment where scenarios A, B, and C can be run with one click and the resulting telemetry observed live.

---

## 6. Security & Threat Model

- **Non-Custodial Architecture**: The Spendlens SDK never touches the agent's private key. It only renders a *"sign"* or *"block"* verdict; signing is done locally by the agent's own signer.
- **Zero Response-Body Storage (Privacy-First)**: Response bodies are never stored anywhere. After quality validation, only the response size and a 256-bit SHA-256 digest are kept; the body is discarded.
- **Non-Blocking Async Telemetry**: Ledger writes run on an async queue; the observability layer never adds latency to the agent's API response time.
- **Case-insensitive counterparties**: EVM addresses and hostnames are canonicalized (lowercase) everywhere — a denylisted address can't be sidestepped by re-casing the `payTo`, and ledger rows join cleanly against Gateway's transfers.
- **Append-only ledger, enforced by Postgres**: a trigger rejects every UPDATE / DELETE / TRUNCATE on the ledger (only the cascade from deleting an agent or account passes). Each UTC day is sealed into a SHA-256 hash chain; with `ANCHOR_PRIVATE_KEY` set, each digest is written on Arc from an operator wallet (gas only — never user funds).
- **Policy provenance**: every ledger row carries the SHA-256 of the policy that produced it (and the dashboard version when synced).
- **Mainnet rails**: no permissive default, no mock signer, no guessed RPC URL on Arc mainnet.
- **Supply chain**: exact-pinned dependencies (`.npmrc save-exact`), `npm audit` in CI, a CycloneDX SBOM built on every CI run and attached to each SDK release.

---

## 7. Accounts, Tenancy & Auth

- **Auth** is [Better Auth](https://better-auth.com): e-mail + password with
  password reset, plus **Google / GitHub sign-in**. E-mail **verification is
  required whenever an e-mail provider is configured** (Resend/SMTP — i.e. any
  real deployment); local dev without one stays frictionless. Override with
  `REQUIRE_EMAIL_VERIFICATION=true|false`.
- **Google / GitHub** activate automatically when their env vars are set (the
  buttons hide otherwise). Create the OAuth apps, set the redirect URI to
  `<APP_URL>/api/auth/callback/<github|google>`, put the id/secret in `.env`:
  - GitHub → <https://github.com/settings/developers> → New OAuth App
  - Google → <https://console.cloud.google.com/apis/credentials> → OAuth client ID (Web)

  Accounts link by verified e-mail, so one person signing up with a password can
  add Google/GitHub later on **Settings → Connected accounts** (and unlink,
  as long as one method remains).
- **Every row is tenant-scoped.** Agents, API keys, policies, the ledger, and
  reconciliation all carry a `userId`; every dashboard query and API route is
  scoped to the signed-in user (see `src/lib/db/repository.ts` and
  `src/lib/auth/dal.ts`). The SDK ingest route authenticates by API key and
  writes to that key's owner.
- **API keys** are per-agent bearer tokens (`sl_` + 40 hex). Only a SHA-256
  hash is stored; the plaintext is shown once. A halted agent's ingest is
  still accepted (the audit trail stays complete) and answered with
  `x-spendlens-agent-status: paused`, which engages the SDK's kill switch.
- **The SDK is served by the app**: `npm run build:sdk` builds `src/sdk` into
  `public/downloads/` as an installable tarball (`spendlens-sdk.tgz`) and a
  single inlined file (`spendlens-sdk.mjs`). `npm run build` / `npm run dev`
  run it automatically; `.github/workflows/publish-sdk.yml` publishes it to
  npm as `@spendlens/sdk` (with provenance) when an `sdk-v<version>` tag is
  pushed. Beyond the automatic Gateway reconciliation, settlement totals can
  be fed manually via `POST /api/reconciliation/settlements` (session or API
  key).
- The marketing page's live preview still renders the deterministic sample
  dataset in `src/lib/mock/` — it is not connected to the database.

---

## 8. Test Suite & Validation

```bash
npm test              # unit tests (engines, SDK, signer, guardGateway, policy, API-key crypto)
npm run test:db       # Postgres integration: SQL aggregates, append-only trigger,
                      #   digests + tamper detection, escalations, per-agent reconciliation
npm run test:e2e      # full pipeline against a running instance: signup -> agent -> key
                      #   -> a simulated-wallet agent makes ~30 signed paid calls
                      #   -> ledger / quality / reconciliation, kill switch, remote policy,
                      #      human escalation, canonical counterparties (30 checks)
npm run new-wallet    # generate a throwaway TESTNET wallet (refuses on mainnet)
npm run reconcile:arc # run keyless Gateway reconciliation for the agent now
npm run sbom          # CycloneDX SBOM of production dependencies
npx tsc --noEmit      # type-check
npm run build         # production build (also builds the SDK)
npm run db:migrate    # apply pending migrations (needs DATABASE_URL / .env)
npm run db:studio     # drizzle-kit studio
```

Agents and keys can be managed over REST as well as the UI (session-scoped):
`GET`/`POST /api/agents`, `GET`/`POST /api/agents/<slug>/keys`.

CI (`.github/workflows/ci.yml`) runs typecheck + lint + unit tests + app build +
production `npm audit` + SBOM on every push, and the DB integration tests and
e2e pipeline against a Postgres service container.

### API endpoints for agents (API-key auth)

| Endpoint | Purpose | Rate limit |
| --- | --- | --- |
| `POST /api/authorizations` | ingest ledger records | 240 / min / key |
| `GET /api/sdk/config` | kill-switch state + current dashboard policy (polled by the SDK) | 120 / min / key |
| `POST /api/escalate` | `hold` escalation webhook target (see below) | 240 / min / key |
| `GET /api/escalate/<id>` | the SDK's poll while a hold waits for a person | 600 / min / key |
| `POST /api/reconciliation/run` | keyless Gateway reconciliation for the key's agent, now | 6 / min / tenant |
| `POST /api/reconciliation/settlements` | feed settlement totals manually (one agent) | 60 / min / tenant |
| `GET /api/health` | unauthenticated probe: DB round-trip + background-job freshness | — |

Over-limit calls get `429` + `Retry-After`; every response carries
`X-RateLimit-*`. The limiter is per instance by default; set
`RATE_LIMIT_STORE=postgres` to share counters across several `web` containers.

Owner-side (session) additions: `PATCH /api/agents/<slug>` (`status`,
`walletAddress`), `GET /api/escalations`, `POST /api/escalations/<id>`
(`approve`/`deny`), `GET /api/ledger/digests`. Operators:
`POST /api/cron/run` with `Bearer $CRON_SECRET` runs the background jobs from an
external scheduler.

### Escalation — a human in the loop

New agents' policies point `escalation.webhook` at `<APP_URL>/api/escalate`
(bearer = the agent's API key). On a `hold` verdict the SDK POSTs the payment;
nothing is signed while it waits. Spendlens:

- **approves at once** when the amount is ≤ `escalation.auto_approve_below_usdc`
  (default 5× `first_seen.auto_allow_below_usdc`),
- **denies at once** when the agent is halted,
- otherwise **queues it for a person** (`202 { status: "pending", pollUrl }`),
  e-mails the owner, and the SDK polls until someone approves or denies it on
  **Approvals** — or `timeout_seconds` runs out and `on_timeout` applies.

The SDK writes the `hold_approved` / `hold_denied` ledger row for the payment it
actually made, and an approved hold counts against every budget like an
`allow`. Any other webhook can answer `{ "approved": true|false }` directly.

### Surviving restarts

A long-running guarded agent keeps its budget counters and burn-rate baseline
across restarts by passing a `FilePolicyStateStore`:

```ts
import { PolicyEngine, FilePolicyStateStore } from "@spendlens/sdk";
const engine = new PolicyEngine(policy, new FilePolicyStateStore(".spendlens-state.json"));
```

---

## 9. Deployment

Self-hosted via Docker Compose (Next.js standalone + Postgres 16). Migrations
run automatically on container boot from `instrumentation.register()`.

```bash
cp .env.example .env   # set APP_URL, BETTER_AUTH_SECRET, POSTGRES_PASSWORD, e-mail
docker compose up -d --build
```

Put a TLS-terminating reverse proxy (Caddy / nginx) in front of port 3000.
Full step-by-step, OAuth setup, e-mail, and backups: **[DEPLOY.md](DEPLOY.md)**.

Required environment variables: `APP_URL`, `NEXT_PUBLIC_APP_URL`,
`BETTER_AUTH_SECRET`, `DATABASE_URL` (compose builds this from
`POSTGRES_*`), and — for anything real — `RESEND_API_KEY` or `SMTP_*` (alerts
and verification). Mainnet: `ARC_NETWORK=mainnet` + `ARC_MAINNET_RPC_URL`.
Optional: OAuth ids, `ANCHOR_PRIVATE_KEY`, `ALERT_WEBHOOK_URL`,
`ERROR_WEBHOOK_URL`, `RATE_LIMIT_STORE`, job intervals — all documented in
`.env.example`. Compose also runs a nightly `pg_dump` into the `db-backups`
volume.

---

## License

MIT — see [LICENSE](LICENSE).
