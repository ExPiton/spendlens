/**
 * Canonical form of a counterparty identifier — an EVM address (`0x…`) or a
 * hostname. Both are case-insensitive by definition: an EIP-55 checksum is
 * presentation only, and DNS names don't distinguish case. They still arrive
 * in whatever case the source picked — an x402 402 response's `payTo` is
 * usually checksummed, Circle Gateway's `/x402/transfers` returns lowercase —
 * so every comparison (policy allow/deny lists, the per-agent "seen" set,
 * ledger ⇄ chain reconciliation) has to happen on one canonical spelling.
 * Without it the same address in two cases is two different counterparties:
 * a denylist entry is bypassed by re-casing it, and every real settlement
 * shows up as both an unmatched chain row and an unmatched ledger row.
 */
export function normalizeCounterparty(counterparty: string): string {
  return counterparty.trim().toLowerCase();
}
