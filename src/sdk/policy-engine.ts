import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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

interface SerializedPolicyState {
  taskSpends: Record<string, number>;
  callTimestamps: { agentId: string; ts: number; amount: number; counterparty: string }[];
  seenCounterparties: string[];
  firstActivity: Record<string, number>;
  totalCalls: Record<string, number>;
  ewmaStates: Record<string, EwmaState>;
}

export class InMemoryPolicyStateStore implements PolicyStateStore {
  protected taskSpends = new Map<string, number>();
  protected callTimestamps: { agentId: string; ts: number; amount: number; counterparty: string }[] = [];
  protected seenCounterparties = new Set<string>();
  protected firstActivityMap = new Map<string, number>();
  protected totalCallsMap = new Map<string, number>();
  protected ewmaStates = new Map<string, EwmaState>();

  /** Snapshot for persistence. Old call timestamps (> 25h) are dropped —
   *  nothing reads past the day-spend window. */
  protected serialize(): SerializedPolicyState {
    const cutoff = Date.now() - 25 * 60 * 60 * 1000;
    return {
      taskSpends: Object.fromEntries(this.taskSpends),
      callTimestamps: this.callTimestamps.filter((c) => c.ts >= cutoff),
      seenCounterparties: [...this.seenCounterparties],
      firstActivity: Object.fromEntries(this.firstActivityMap),
      totalCalls: Object.fromEntries(this.totalCallsMap),
      ewmaStates: Object.fromEntries(this.ewmaStates),
    };
  }

  protected hydrate(s: Partial<SerializedPolicyState> | null | undefined): void {
    if (!s) return;
    this.taskSpends = new Map(Object.entries(s.taskSpends ?? {}));
    this.callTimestamps = s.callTimestamps ?? [];
    this.seenCounterparties = new Set(s.seenCounterparties ?? []);
    this.firstActivityMap = new Map(Object.entries(s.firstActivity ?? {}));
    this.totalCallsMap = new Map(Object.entries(s.totalCalls ?? {}));
    this.ewmaStates = new Map(Object.entries(s.ewmaStates ?? {}));
  }

  /** Hook for subclasses that persist — called after every mutation. */
  protected onMutate(): void {}

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
    this.onMutate();
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
    this.onMutate();
  }
}

/**
 * A `PolicyStateStore` that survives process restarts by mirroring its state
 * to a JSON file. Budgets (task / hour / day rolling spend), the seen-
 * counterparty set, and the EWMA burn-rate baseline are all restored on
 * construction, so a long-running guarded agent that redeploys keeps counting
 * from where it left off instead of silently resetting to zero.
 *
 *   import { FilePolicyStateStore, PolicyEngine } from "@spendlens/sdk";
 *   const engine = new PolicyEngine(policy, new FilePolicyStateStore(".spendlens-state.json"));
 *
 * Writes are debounced (default 1s) and flushed on `process.exit` / SIGINT /
 * SIGTERM. Single-process only — concurrent writers would clobber each other.
 * Node-only (uses `node:fs`); a bad/missing file just starts the store empty.
 */
export class FilePolicyStateStore extends InMemoryPolicyStateStore {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly debounceMs = 1000,
  ) {
    super();
    this.load();
    const flush = () => this.flush();
    process.once("exit", flush);
    process.once("SIGINT", () => {
      flush();
      process.exit(130);
    });
    process.once("SIGTERM", () => {
      flush();
      process.exit(143);
    });
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      this.hydrate(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch (err) {
      console.warn(
        `[spendlens] could not read policy state from ${this.filePath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Write the current snapshot now, bypassing the debounce. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      writeFileSync(this.filePath, JSON.stringify(this.serialize()), "utf8");
    } catch (err) {
      console.warn(
        `[spendlens] could not persist policy state to ${this.filePath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  protected onMutate(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, this.debounceMs);
    // Don't keep the event loop alive just for a pending state write.
    this.saveTimer.unref?.();
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
