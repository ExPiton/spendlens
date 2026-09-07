export * from "./guard";
export * from "./gateway";
export * from "./signer";
export * from "./policy-engine";
export * from "./challenge";
export * from "./queue";
export * from "./errors";
export { ARC, ARC_TESTNET, ARC_MAINNET, microUsdcToUsdc, usdcToMicroUsdc } from "@/lib/arc";

// Re-export contract schemas and types for SDK consumers
export type {
  PolicyConfig,
  PolicyFile,
  AuthorizationRecord,
  Decision,
  Quality,
  ReconciliationRecord,
  ReconciliationStatus,
  OverviewStats,
  AgentSummary,
  CounterpartySummary,
} from "@/lib/contracts";
