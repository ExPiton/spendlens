import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { PolicyConfig } from "@/lib/contracts";

/**
 * Deterministic JSON: object keys sorted, `undefined` members dropped (as
 * `JSON.stringify` would), arrays kept in order. Two structurally equal
 * policies — whether parsed from YAML in the agent or loaded from the
 * dashboard's jsonb column — always serialize to the same bytes.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * SHA-256 (hex) of a policy's canonical JSON. Written onto every ledger row
 * as `policyHash`, so each decision is traceable to the exact rule set it was
 * evaluated against, and a policy swapped or edited outside the dashboard
 * shows up as a hash the dashboard never issued. Synchronous and dependency-
 * light (`@noble/hashes`), so it runs identically in the SDK and the server.
 */
export function policyHash(config: PolicyConfig): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(config))));
}
