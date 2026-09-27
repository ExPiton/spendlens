export * from "./guard";
export * from "./gateway";
export * from "./signer";
export * from "./policy-engine";
export * from "./challenge";
export * from "./queue";
export * from "./errors";
export * from "./sqlite-sink";
export {
  ControlPlane,
  requestEscalation,
  loadPolicyInput,
  parsePolicyText,
  chainIdFromNetwork,
  type RemoteConfig,
  type EscalationPayload,
} from "./runtime";
export {
  ARC,
  ARC_TESTNET,
  ARC_MAINNET,
  ARC_GATEWAY_CHAIN,
  microUsdcToUsdc,
  usdcToMicroUsdc,
} from "@/lib/arc";
export { normalizeCounterparty } from "@/lib/counterparty";
export { policyHash, canonicalJson } from "@/lib/policy-hash";

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
