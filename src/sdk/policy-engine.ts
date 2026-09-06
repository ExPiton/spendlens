import type { PolicyConfig } from "@/lib/contracts";
import { updateBurnRateEwma, isColdStart, type EwmaState } from "@/lib/engine/anomaly";
import type { QualityRules } from "@/lib/engine/classifyQuality";

export interface EvaluationInput {
  agentId: string;
  taskId?: string | null;
  counterparty: string;
  amount: number; // in USDC
  resource: string;
  now?: number; // epoch ms
}

export interface EvaluationVerdict {
  decision: "allow" | "block" | "hold";
  ruleHit: string | null;
  qualityRules: QualityRules;
  escalation: PolicyConfig["escalation"];
  anomalyZ?: number;
}

export interface PolicyStateStore {
  getTaskSpend(agentId: string, taskId: string): number;
  getHourSpend(agentId: string, nowMs: number): number;
  getDaySpend(agentId: string, nowMs: number): number;
  getMinuteCallCount(agentId: string, nowMs: number): number;
  getNewCounterpartiesCountLastHour(agentId: string, nowMs: number): number;
  isCounterpartySeen(agentId: string, counterparty: string): boolean;
  getTotalAuthorizationsCount(agentId: string): number;
  getFirstActivityTimestamp(agentId: string): number | null;
  getEwmaState(agentId: string): EwmaState | null;
  setEwmaState(agentId: string, state: EwmaState): void;
  recordCall(input: EvaluationInput, verdict: EvaluationVerdict): void;
}

export class InMemoryPolicyStateStore implements PolicyStateStore {
  private taskSpends = new Map<string, number>();
  private callTimestamps: { agentId: string; ts: number; amount: number; counterparty: string }[] = [];
  private seenCounterparties = new Set<string>();
  private firstActivityMap = new Map<string, number>();
  private totalCallsMap = new Map<string, number>();
  private ewmaStates = new Map<string, EwmaState>();

  getTaskSpend(agentId: string, taskId: string): number {
    return this.taskSpends.get(`${agentId}:${taskId}`) || 0;
  }

  getHourSpend(agentId: string, nowMs: number): number {
    const oneHourAgo = nowMs - 60 * 60 * 1000;
    return this.callTimestamps
      .filter((c) => c.agentId === agentId && c.ts >= oneHourAgo)
      .reduce((sum, c) => sum + c.amount, 0);
  }

  getDaySpend(agentId: string, nowMs: number): number {
    const oneDayAgo = nowMs - 24 * 60 * 60 * 1000;
    return this.callTimestamps
      .filter((c) => c.agentId === agentId && c.ts >= oneDayAgo)
      .reduce((sum, c) => sum + c.amount, 0);
  }

  getMinuteCallCount(agentId: string, nowMs: number): number {
    const oneMinAgo = nowMs - 60 * 1000;
    return this.callTimestamps.filter((c) => c.agentId === agentId && c.ts >= oneMinAgo).length;
  }

  getNewCounterpartiesCountLastHour(agentId: string, nowMs: number): number {
    const oneHourAgo = nowMs - 60 * 60 * 1000;
    const recent = this.callTimestamps.filter((c) => c.agentId === agentId && c.ts >= oneHourAgo);
    return new Set(recent.map((c) => c.counterparty)).size;
  }

  isCounterpartySeen(agentId: string, counterparty: string): boolean {
    return this.seenCounterparties.has(`${agentId}:${counterparty}`);
  }

  getTotalAuthorizationsCount(agentId: string): number {
    return this.totalCallsMap.get(agentId) || 0;
  }

  getFirstActivityTimestamp(agentId: string): number | null {
    return this.firstActivityMap.get(agentId) || null;
  }

  getEwmaState(agentId: string): EwmaState | null {
    return this.ewmaStates.get(agentId) || null;
  }

  setEwmaState(agentId: string, state: EwmaState): void {
    this.ewmaStates.set(agentId, state);
  }

  recordCall(input: EvaluationInput, verdict: EvaluationVerdict): void {
    const now = input.now ?? Date.now();
    const agentId = input.agentId;

    if (!this.firstActivityMap.has(agentId)) {
      this.firstActivityMap.set(agentId, now);
    }
    this.totalCallsMap.set(agentId, (this.totalCallsMap.get(agentId) || 0) + 1);

    if (verdict.decision === "allow") {
      this.seenCounterparties.add(`${agentId}:${input.counterparty}`);
      if (input.taskId) {
        const key = `${agentId}:${input.taskId}`;
        this.taskSpends.set(key, (this.taskSpends.get(key) || 0) + input.amount);
      }
      this.callTimestamps.push({
        agentId,
        ts: now,
        amount: input.amount,
        counterparty: input.counterparty,
      });
    }
  }
}

/**
 * Spendlens Declarative Policy Engine.
 * Enforces evaluation order:
 * 1. Deny list -> 2. Per-call limits -> 3. Budgets -> 4. Counterparties -> 5. Anomaly -> 6. Quality rules.
 */
export class PolicyEngine {
  constructor(
    private policy: PolicyConfig,
    private store: PolicyStateStore = new InMemoryPolicyStateStore(),
  ) {}

  public getPolicy(): PolicyConfig {
    return this.policy;
  }

  public async evaluate(input: EvaluationInput): Promise<EvaluationVerdict> {
    const now = input.now ?? Date.now();
    const policy = this.policy;
    const store = this.store;
    const amount = input.amount;
    const counterparty = input.counterparty;
    const agentId = input.agentId;

    const qualityRules: QualityRules = {
      failureStatusCodes: policy.quality.failureStatusCodes,
      emptyBodyIsFailure: policy.quality.emptyBodyIsFailure,
      maxLatencyMs: policy.quality.maxLatencyMs,
    };

    // 1. Check Deny List
    if (policy.counterparties.deny.includes(counterparty)) {
      const verdict: EvaluationVerdict = {
        decision: "block",
        ruleHit: "counterparties.deny",
        qualityRules,
        escalation: policy.escalation,
      };
      store.recordCall(input, verdict);
      return verdict;
    }

    // 2. Per-call Checks
    if (amount > policy.perCall.maxUsdc) {
      const verdict: EvaluationVerdict = {
        decision: "block",
        ruleHit: "per_call.max_usdc",
        qualityRules,
        escalation: policy.escalation,
      };
      store.recordCall(input, verdict);
      return verdict;
    }

    const callsInLastMinute = store.getMinuteCallCount(agentId, now);
    if (callsInLastMinute >= policy.perCall.maxCallsPerMinute) {
      const verdict: EvaluationVerdict = {
        decision: "block",
        ruleHit: "per_call.max_calls_per_minute",
        qualityRules,
        escalation: policy.escalation,
      };
      store.recordCall(input, verdict);
      return verdict;
    }

    // 3. Budgets (task, hour, day)
    for (const budget of policy.budgets) {
      if (budget.scope === "task" && input.taskId) {
        const spent = store.getTaskSpend(agentId, input.taskId);
        if (spent + amount > budget.limitUsdc) {
          const verdict: EvaluationVerdict = {
            decision: "block",
            ruleHit: "budgets.task",
            qualityRules,
            escalation: policy.escalation,
          };
          store.recordCall(input, verdict);
          return verdict;
        }
      } else if (budget.scope === "hour") {
        const spent = store.getHourSpend(agentId, now);
        if (spent + amount > budget.limitUsdc) {
          const verdict: EvaluationVerdict = {
            decision: "block",
            ruleHit: "budgets.hour",
            qualityRules,
            escalation: policy.escalation,
          };
          store.recordCall(input, verdict);
          return verdict;
        }
      } else if (budget.scope === "day") {
        const spent = store.getDaySpend(agentId, now);
        if (spent + amount > budget.limitUsdc) {
          const verdict: EvaluationVerdict = {
            decision: "block",
            ruleHit: "budgets.day",
            qualityRules,
            escalation: policy.escalation,
          };
          store.recordCall(input, verdict);
          return verdict;
        }
      }
    }

    // 4. Counterparty Mode & First-Seen
    const isAllowlisted = policy.counterparties.allow.includes(counterparty);
    const isSeen = store.isCounterpartySeen(agentId, counterparty);

    if (policy.counterparties.mode === "allowlist" && !isAllowlisted) {
      // Not explicitly on allowlist
      if (!isSeen && policy.counterparties.firstSeen) {
        if (amount <= policy.counterparties.firstSeen.autoAllowBelowUsdc) {
          // auto allow micro testing
        } else {
          const action = policy.counterparties.firstSeen.action;
          if (action === "block" || action === "hold") {
            const verdict: EvaluationVerdict = {
              decision: action,
              ruleHit: "counterparties.first_seen.action",
              qualityRules,
              escalation: policy.escalation,
            };
            store.recordCall(input, verdict);
            return verdict;
          }
        }
      } else {
        const verdict: EvaluationVerdict = {
          decision: "block",
          ruleHit: "counterparties.mode",
          qualityRules,
          escalation: policy.escalation,
        };
        store.recordCall(input, verdict);
        return verdict;
      }
    }

    // 5. Anomaly Detection (EWMA Burn Rate & New Counterparty Velocity)
    const totalAuthorizations = store.getTotalAuthorizationsCount(agentId);
    const firstActivity = store.getFirstActivityTimestamp(agentId);
    const minutesSinceStart = firstActivity ? (now - firstActivity) / (60 * 1000) : 0;
    const coldStart = isColdStart(totalAuthorizations, minutesSinceStart);

    // Update EWMA
    const prevEwma = store.getEwmaState(agentId);
    const ewmaResult = updateBurnRateEwma(
      prevEwma,
      amount,
      now,
      policy.anomaly.burnRate.halflifeMinutes,
    );
    store.setEwmaState(agentId, ewmaResult.state);

    if (!coldStart && ewmaResult.z >= policy.anomaly.burnRate.zThreshold) {
      const action = policy.anomaly.burnRate.action;
      if (action === "block" || action === "hold") {
        const verdict: EvaluationVerdict = {
          decision: action,
          ruleHit: "anomaly.burn_rate",
          anomalyZ: ewmaResult.z,
          qualityRules,
          escalation: policy.escalation,
        };
        store.recordCall(input, verdict);
        return verdict;
      }
    }

    // New counterparty rate check
    if (!isSeen) {
      const recentNewCount = store.getNewCounterpartiesCountLastHour(agentId, now);
      if (recentNewCount > policy.anomaly.newCounterpartyRate.maxPerHour) {
        const action = policy.anomaly.newCounterpartyRate.action;
        if (action === "block" || action === "hold") {
          const verdict: EvaluationVerdict = {
            decision: action,
            ruleHit: "anomaly.new_counterparty_rate",
            qualityRules,
            escalation: policy.escalation,
          };
          store.recordCall(input, verdict);
          return verdict;
        }
      }
    }

    // Default Allow
    const verdict: EvaluationVerdict = {
      decision: "allow",
      ruleHit: null,
      anomalyZ: ewmaResult.z,
      qualityRules,
      escalation: policy.escalation,
    };
    store.recordCall(input, verdict);
    return verdict;
  }
}
