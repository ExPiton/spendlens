/**
 * Spendlens SDK Error hierarchy.
 */

export class SpendlensError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpendlensError";
  }
}

/** Rule ids that say nothing on their own. Shown after the id, so it stays
 *  greppable (`ruleHit` is unchanged). */
const RULE_HINTS: Record<string, string> = {
  "agent.halted": "the agent is halted (kill switch) in the Spendlens dashboard",
  "policy.unavailable":
    "the agent's dashboard policy could not be loaded from the Spendlens server — check SPENDLENS_URL / SPENDLENS_API_KEY, " +
    "that the server is up to date, or pass an explicit `policy`",
  "counterparties.allowlist": "the counterparty is not on the policy's allowlist",
  "challenge.invalid_amount": "the 402 asked for a negative or non-numeric amount",
};

export class PolicyBlocked extends SpendlensError {
  readonly ruleHit: string;
  readonly counterparty?: string;
  readonly amountUsdc?: number;

  constructor(ruleHit: string, context?: { counterparty?: string; amountUsdc?: number }) {
    super(
      `Payment blocked by policy rule: ${ruleHit}` +
        (RULE_HINTS[ruleHit] ? ` (${RULE_HINTS[ruleHit]})` : ""),
    );
    this.name = "PolicyBlocked";
    this.ruleHit = ruleHit;
    this.counterparty = context?.counterparty;
    this.amountUsdc = context?.amountUsdc;
  }
}

export class EscalationDenied extends SpendlensError {
  /** `rejected`: a person (or the webhook) said no. `timeout`: nobody
   *  decided in time. `unavailable`: the escalation webhook could not be
   *  reached / answered with an error, so `on_timeout` applied. */
  readonly reason: "rejected" | "timeout" | "unavailable";

  constructor(reason: "rejected" | "timeout" | "unavailable" = "rejected") {
    super(
      reason === "timeout"
        ? "Payment escalation timed out with no decision"
        : reason === "unavailable"
          ? "Payment escalation could not be completed (the escalation webhook was unreachable or returned an error) — blocked per on_timeout"
          : "Payment escalation was denied",
    );
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
