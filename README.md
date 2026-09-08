# Spendlens

> **An oversight and observability layer for AI agent spend on Arc.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
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
| **A: Prompt Injection** | The agent is redirected to an attacker's API via a hidden instruction on a crawled page, making 4,000 rapid calls ($0.003/call). | The wallet never alarms since no single call exceeds the per-call limit ($0.05). Funds drain. | **EWMA Burn Rate & Allowlist** catch the anomaly and halt the flow within seconds. |
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

Open `http://localhost:3000/signup` and create an account — you land straight
on `/dashboard` (e-mail verification is off). Use **Load sample data** to
populate every screen, or **New agent** to start clean.

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

> Optional — `guard()` uses a permissive "record everything, block nothing"
> policy by default, which you tighten from the **Policies** tab. A YAML file
> looks like:

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

quality:
  failure_status_codes: [402, 429, 500, 502, 503, 504]
  empty_body_is_failure: true
  max_latency_ms: 4000

escalation:
  webhook: "https://ops.example.io/hooks/spendlens"
  timeout_seconds: 30
  on_timeout: block
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
  // policy: yamlString,                                   // optional; permissive default
  // signer: createLocalSigner(process.env.AGENT_PRIVATE_KEY), // for real settlement
});

// Use pay.fetch instead of fetch anywhere the agent calls a paid API:
const res = await pay.fetch("https://api.example.io/v1/data", { taskId: "task-1" });
const data = await res.json();
```

`pay.fetch` only engages on an HTTP **402** payment challenge (x402 headers,
`WWW-Authenticate: Nanopayment`, or a JSON body with `payTo` + `amount`);
everything else passes straight through untouched. Without a `signer` it uses a
clearly-logged mock signature — policy, telemetry and quality analysis are
real, but the payment will not settle.

### Circle Nanopayments (Arc + Circle Gateway)

For the real Circle path — gas-free USDC micropayments settled in batches on
Arc — wrap `@circle-fin/x402-batching`'s `GatewayClient` with `guardGateway`.
Spendlens hooks its policy engine into `onBeforePaymentCreation`; the wallet key
never leaves `GatewayClient`.

```typescript
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { guardGateway } from "@spendlens/sdk";

const client = new GatewayClient({ chain: "arcTestnet", privateKey });
const pay = guardGateway(client, { agentId: "research-crawler-01" });
const { data, transaction } = await pay.fetch("https://api.example.io/premium", { taskId: "t1" });
```

`reconcileFromGateway(client)` reads real on-chain settlement from Gateway to
feed the reconciliation screen. Full walkthrough, contract addresses and the
EIP-3009 / `GatewayWalletBatched` details: **[ARC.md](ARC.md)**.

> Arc chain ids: testnet **5042002**, mainnet **5042**. Set `ARC_NETWORK=mainnet`
> (and `ARC_MAINNET_RPC_URL`) to switch.

---

## 5. Dashboard Screens & Features

- **Marketing page (`/`)**: A single-page site positioning the product, walking through the three failure scenarios, and including a live preview rendered with the dashboard's real components (not a static image) on sample data, plus a "how it works" walkthrough.
- **Overview (`/dashboard`)**: Four core KPI cards at the top (Total Spend, Unmatched Spend & %, Blocked Calls, Reconciliation Status) and a headline waste-analysis sentence.
- **Event Ledger (`/dashboard/ledger`)**: A filterable, searchable, paginated authorization ledger. Clicking any record opens a **Telemetry Drawer** (latency, SHA-256 digest, nonce, settlement ID, triggered rule).
- **Agent Fleet (`/dashboard/agents` & `/dashboard/agents/[agentId]`)**: Spend, efficiency, and anomaly status for every agent, with an emergency kill switch.
- **Counterparties & Reputation (`/dashboard/counterparties`)**: Quality scores, empty-body/error rates, and first-seen timestamps for every API provider paid.
- **Arc Reconciliation Audit (`/dashboard/reconciliation`)**: Comparison of Arc Gateway's on-chain batched settlement against the local ledger (🔴 CRITICAL / 🟡 PENDING / 🟢 OK).
- **Policy Management (`/dashboard/policies`)**: A live YAML editor with instant Zod schema validation and a rule summary.
- **Anomaly & Rate Monitoring (`/dashboard/anomalies`)**: EWMA burn rate, z-score thresholds, and cold-start (warmup) status.
- **Interactive Simulator (`/dashboard/simulator`)**: A test environment where scenarios A, B, and C can be run with one click and the resulting telemetry observed live.

---

## 6. Security & Threat Model

- **Non-Custodial Architecture**: The Spendlens SDK never touches the agent's private key. It only renders a *"sign"* or *"block"* verdict; signing is done locally by the agent's own signer.
- **Zero Response-Body Storage (Privacy-First)**: Response bodies are never stored anywhere. After quality validation, only the response size and a 256-bit SHA-256 digest are kept; the body is discarded.
- **Non-Blocking Async Telemetry**: Ledger writes run on an async queue; the observability layer never adds latency to the agent's API response time.

---

## 7. Accounts, Tenancy & Auth

- **Auth** is [Better Auth](https://better-auth.com): e-mail + password with
  password reset, plus **Google / GitHub sign-in**. E-mail **verification is
  currently off** — signup logs the user straight in; re-enable via
  `requireEmailVerification` in `src/lib/auth/index.ts` and the check in
  `src/lib/auth/dal.ts`.
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
  hash is stored; the plaintext is shown once. A halted agent rejects ingest
  with `423`.
- **The SDK is served by the app**: `npm run build:sdk` builds `src/sdk` into
  `public/downloads/` as an installable tarball (`spendlens-sdk.tgz`) and a
  single inlined file (`spendlens-sdk.mjs`). `npm run build` / `npm run dev`
  run it automatically. Reconciliation can be fed real settlement totals via
  `POST /api/reconciliation/settlements` (session or API key).
- The marketing page's live preview still renders the deterministic sample
  dataset in `src/lib/mock/` — it is not connected to the database.

---

## 8. Test Suite & Validation

```bash
npm test              # unit tests (engines, SDK, signer, guardGateway, policy, API-key crypto)
npm run test:e2e      # full pipeline against a running instance: signup -> agent -> key
                      #   -> a simulated-wallet agent makes ~30 signed paid calls
                      #   -> ledger / quality / reconciliation asserted end-to-end (22 checks)
npm run new-wallet    # generate a throwaway Arc wallet for testing the real signer
npm run reconcile:arc # pull on-chain settlement from Circle Gateway into reconciliation
npx tsc --noEmit      # type-check
npm run build         # production build (also builds the SDK)
npm run db:migrate    # apply pending migrations (needs DATABASE_URL / .env)
npm run db:studio     # drizzle-kit studio
```

Agents and keys can be managed over REST as well as the UI (session-scoped):
`GET`/`POST /api/agents`, `GET`/`POST /api/agents/<slug>/keys`.

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
`POSTGRES_*`). Optional: `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`,
`RESEND_API_KEY` or `SMTP_*`.

---

## License

This project is available under the [MIT License](LICENSE).
