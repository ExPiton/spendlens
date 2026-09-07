# Arc, Circle Gateway & Nanopayments — how it works, and how Spendlens fits

Researched from Circle's developer docs and the `@circle-fin/x402-batching`
package (Sept 2026). Constants live in [`src/lib/arc.ts`](src/lib/arc.ts).

## Arc (the chain)

Circle's Layer‑1, **EVM‑compatible**, standard Ethereum JSON‑RPC. Gas is paid in
**USDC** (dual interface: native 18‑decimal for `msg.value`, ERC‑20 6‑decimal
for balances/transfers — same pool of funds).

| | Testnet | Mainnet (launch 2026‑09‑16) |
|---|---|---|
| Chain ID | **`5042002`** (`0x4CEF52`) | **`5042`** (`0x13B2`) |
| RPC | `https://rpc.testnet.arc.network` | private RPC (Alchemy/QuickNode/Circle) |
| Explorer | `https://testnet.arcscan.app` | `https://arcscan.app` |
| USDC (ERC‑20) | `0x3600000000000000000000000000000000000000` | same |
| Faucet | `https://faucet.circle.com` | — |

> The proposal and the old code used `5042` as "Arc Testnet" — that was wrong;
> `5042` is **mainnet**. Fixed throughout.

## Circle Gateway

A unified USDC balance with instant (<500 ms) cross‑chain transfers.
Contract‑level + a REST API; no SDK required.

| | Testnet | Mainnet |
|---|---|---|
| API base | `https://gateway-api-testnet.circle.com` | `https://gateway-api.circle.com` |
| Gateway Wallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` |
| Gateway Minter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` |
| Arc domain id | `26` | `26` |

You `deposit()` USDC into the Gateway Wallet once on‑chain; after that,
payments draw from that balance **gas‑free**.

## Nanopayments = x402 + Gateway batched settlement

**x402** is the open standard built on HTTP `402 Payment Required`:

1. Client requests a paid resource.
2. Server replies `402` + a `PAYMENT-REQUIRED` header describing accepted
   schemes, price, network, `payTo`, and (for Circle) an `extra` block.
3. Client signs a payment authorization and retries with a base64
   `PAYMENT-SIGNATURE` header.
4. Server verifies and serves the resource.

**Nanopayments** is the Circle scheme for step 3, `extra.name = "GatewayWalletBatched"`:

- The client signs an **EIP‑3009 `TransferWithAuthorization`** (`from`, `to`,
  `value`, `validAfter`, `validBefore`, `nonce`) as **EIP‑712 typed data**.
- Domain: `{ name: "GatewayWalletBatched", version: "1", chainId, verifyingContract }`
  where `verifyingContract` is the **Gateway Wallet contract** (from the 402
  response), **not the USDC token**.
- No gas, no on‑chain tx at pay time. Gateway **batches** authorizations and
  settles them on‑chain later, crediting the seller's Gateway balance.
- Amounts down to **$0.000001**; non‑custodial (only user‑signed auths execute).

### The buyer SDK: `@circle-fin/x402-batching`

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";

const client = new GatewayClient({ chain: "arcTestnet", privateKey });
await client.deposit("1");                       // one‑time, on‑chain
const { data, amount, transaction } = await client.pay(url);   // gas‑free, many times
await client.getBalances();
await client.searchTransfers({ from: client.address });        // settlement history
```

`GatewayClient` holds the wallet key and does all the EIP‑3009 signing.
Crucially it exposes **lifecycle hooks** — `onBeforePaymentCreation`,
`onAfterPaymentCreation`, `onPaymentResponse` — where `onBeforePaymentCreation`
returning `{ abort: true, reason }` stops a payment before it's signed.

## How Spendlens integrates (`src/sdk/gateway.ts`)

### `guardGateway(client, { agentId, policy?, sink?, apiKey? })`

Wraps a `GatewayClient`. Registers the Spendlens **policy engine** on
`onBeforePaymentCreation` (aborts on a `block`/denied‑`hold` verdict) and
records an `AuthorizationRecord` around `client.pay()` with the real settlement
tx, latency and response‑quality class. Non‑custodial by construction — the key
stays inside `GatewayClient`.

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { guardGateway } from "@spendlens/sdk";

const client = new GatewayClient({ chain: "arcTestnet", privateKey });
const pay = guardGateway(client, { agentId: "research-crawler-01" });
const { data } = await pay.fetch("https://api.example.io/premium", { taskId: "t1" });
```

The generic `guard()` still handles any non‑Circle x402 server (plain
`x‑pay‑*` / `WWW‑Authenticate` headers) with `createLocalSigner` or your own.

### `reconcileFromGateway(client, { fromAddress? })`

Reads the agent wallet's on‑chain settlement history via
`GatewayClient.searchTransfers()`, rolls it up per counterparty, and returns
rows for `POST /api/reconciliation/settlements`. This is the **real Arc
settlement source** the reconciliation screen compares the local ledger
against. Run it with `npm run reconcile:arc` (needs `AGENT_PRIVATE_KEY`,
`SPENDLENS_URL`, `SPENDLENS_API_KEY`, and `npm install @circle-fin/x402-batching viem`).

## End‑to‑end on Arc testnet

```bash
npm run new-wallet                         # writes AGENT_ADDRESS/AGENT_PRIVATE_KEY to .env
# fund AGENT_ADDRESS at https://faucet.circle.com  (needs a Circle login)
npm install @circle-fin/x402-batching viem
# deposit once, then:
PAID_API_URL=<a real Circle Nanopayments seller> node examples/arc-nanopayment.mjs
npm run reconcile:arc
```

`examples/x402-server.mjs` is a plain‑header mock and does **not** speak
`GatewayWalletBatched`, so `guardGateway` needs a real Nanopayments seller
(see Circle's [seller quickstart](https://developers.circle.com/gateway/nanopayments/quickstarts/seller)).

## Sources

- https://developers.circle.com/gateway/nanopayments
- https://developers.circle.com/gateway/nanopayments/quickstarts/buyer
- https://developers.circle.com/gateway/nanopayments/concepts/x402
- https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md
- https://github.com/circlefin/skills (`use-arc`, `use-gateway`)
- `@circle-fin/x402-batching` v3.4.0 type definitions
