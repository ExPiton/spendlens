/**
 * Canonical Arc + Circle Gateway constants, verified against Circle's docs and
 * the `@circle-fin/x402-batching` package (Sept 2026).
 *
 *   Arc testnet chain id : 5042002  (0x4CEF52)   — NOT 5042
 *   Arc mainnet chain id : 5042     (0x13B2)     — mainnet launch 2026-09-16
 *
 * `ARC` resolves to testnet unless `ARC_NETWORK=mainnet`.
 */

export interface ArcNetwork {
  network: "testnet" | "mainnet";
  chainId: number;
  /** viem/x402 network id */
  eip155: string;
  rpcUrl: string;
  explorerUrl: string;
  /** ERC-20 USDC (6 decimals). Native gas is the same funds at 18 decimals. */
  usdcAddress: `0x${string}`;
  /** Circle Gateway Wallet contract — the EIP-712 `verifyingContract` for the
   *  GatewayWalletBatched (Nanopayments) scheme. */
  gatewayWallet: `0x${string}`;
  gatewayMinter: `0x${string}`;
  /** Circle Gateway REST API base. */
  gatewayApi: string;
  /** Gateway / CCTP domain id for Arc. */
  gatewayDomain: number;
  faucetUrl: string;
}

export const ARC_TESTNET: ArcNetwork = {
  network: "testnet",
  chainId: 5042002,
  eip155: "eip155:5042002",
  rpcUrl: "https://rpc.testnet.arc.network",
  explorerUrl: "https://testnet.arcscan.app",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
  gatewayApi: "https://gateway-api-testnet.circle.com",
  gatewayDomain: 26,
  faucetUrl: "https://faucet.circle.com",
};

export const ARC_MAINNET: ArcNetwork = {
  network: "mainnet",
  chainId: 5042,
  eip155: "eip155:5042",
  rpcUrl: process.env.ARC_MAINNET_RPC_URL ?? "https://rpc.arc.network",
  explorerUrl: "https://arcscan.app",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  gatewayWallet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE",
  gatewayMinter: "0x2222222d7164433c4C09B0b0D809a9b52C04C205",
  gatewayApi: "https://gateway-api.circle.com",
  gatewayDomain: 26,
  faucetUrl: "https://faucet.circle.com",
};

export const ARC: ArcNetwork =
  process.env.ARC_NETWORK === "mainnet" ? ARC_MAINNET : ARC_TESTNET;

/** `@circle-fin/x402-batching` chain name for `new GatewayClient({ chain })`. */
export const ARC_GATEWAY_CHAIN =
  ARC.network === "mainnet" ? "arc" : "arcTestnet";

export const USDC_DECIMALS = 6;
export const microUsdcToUsdc = (m: number | bigint): number => Number(m) / 1e6;
export const usdcToMicroUsdc = (u: number): number => Math.round(u * 1e6);
