/**
 * Spendlens SDK Error hierarchy.
 */

export class SpendlensError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpendlensError";
  }
}

export class PolicyBlocked extends SpendlensError {
  readonly ruleHit: string;
  readonly counterparty?: string;
  readonly amountUsdc?: number;

  constructor(ruleHit: string, context?: { counterparty?: string; amountUsdc?: number }) {
    super(`Payment blocked by policy rule: ${ruleHit}`);
    this.name = "PolicyBlocked";
    this.ruleHit = ruleHit;
    this.counterparty = context?.counterparty;
    this.amountUsdc = context?.amountUsdc;
  }
}

export class EscalationDenied extends SpendlensError {
  readonly reason: "rejected" | "timeout";

  constructor(reason: "rejected" | "timeout" = "rejected") {
    super(`Payment escalation was ${reason === "timeout" ? "timed out" : "denied by operator"}`);
    this.name = "EscalationDenied";
    this.reason = reason;
  }
}

export class ChallengeParseError extends SpendlensError {
  constructor(message: string) {
    super(`Failed to parse HTTP 402 payment challenge: ${message}`);
    this.name = "ChallengeParseError";
  }
}
