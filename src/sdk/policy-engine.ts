import {
  existsSync,
  readFileSync,
  renameSync,
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
  /** Records first contact with a counterparty that was neither allowlisted
   *  nor previously seen — the only thing `getNewCounterpartiesCountLastHour`
   *  counts. Idempotent: calling it again for the same counterparty is a
   *  no-op, so retries of a held/denied first contact don't reset its
   *  first-seen clock. Never called for an allowlisted counterparty, so a
   *  pre-trusted integration can never inflate this signal. */
  recordFirstContact(agentId: string, counterparty: string, nowMs: number): void;
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
  seenCounterparties: Record<string, number>;
  firstContacts: Record<string, number>;
  firstActivity: Record<string, number>;
  totalCalls: Record<string, number>;
  ewmaStates: Record<string, EwmaState>;
}

export class InMemoryPolicyStateStore implements PolicyStateStore {
  protected taskSpends = new Map<string, number>();
  protected callTimestamps: { agentId: string; ts: number; amount: number; counterparty: string }[] = [];
  /** `${agentId}:${counterparty}` -> timestamp of the first *allowed* call.
   *  General "have we ever let this counterparty through" memory — used to
   *  skip re-vetting an already-trusted relationship. */
  protected seenCounterparties = new Map<string, number>();
  /** `${agentId}:${counterparty}` -> timestamp of first contact with a
   *  counterparty that was neither allowlisted nor already seen. Separate
   *  from `seenCounterparties` specifically so an allowlisted counterparty's
   *  first call never counts as "new" for the new-counterparty-rate signal —
   *  it was already trusted, not a surprise. */
  protected firstContacts = new Map<string, number>();
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
      seenCounterparties: Object.fromEntries(this.seenCounterparties),
      firstContacts: Object.fromEntries(this.firstContacts),
      firstActivity: Object.fromEntries(this.firstActivityMap),
      totalCalls: Object.fromEntries(this.totalCallsMap),
      ewmaStates: Object.fromEntries(this.ewmaStates),
    };
  }

  protected hydrate(s: Partial<SerializedPolicyState> | null | undefined): void {
    if (!s) return;
    this.taskSpends = new Map(Object.entries(s.taskSpends ?? {}));
    this.callTimestamps = s.callTimestamps ?? [];
    // Back-compat: an older snapshot stored seenCounterparties as a plain
    // string[] with no timestamp. Restoring those as "seen at epoch 0" is
    // safe — it only affects whether they're still within the (long past)
    // new-counterparty-rate window, i.e. never.
    this.seenCounterparties = Array.isArray(s.seenCounterparties)
      ? new Map((s.seenCounterparties as unknown as string[]).map((k) => [k, 0]))
      : new Map(Object.entries(s.seenCounterparties ?? {}));
    this.firstContacts = new Map(Object.entries(s.firstContacts ?? {}));
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
    const prefix = `${agentId}:`;
    let count = 0;
    for (const [key, firstContactTs] of this.firstContacts) {
      if (key.startsWith(prefix) && firstContactTs >= oneHourAgo) count++;
    }
    return count;
  }

  recordFirstContact(agentId: string, counterparty: string, nowMs: number): void {
    const key = `${agentId}:${counterparty}`;
    if (!this.firstContacts.has(key)) {
      this.firstContacts.set(key, nowMs);
      this.onMutate();
    }
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
      const seenKey = `${agentId}:${input.counterparty}`;
      if (!this.seenCounterparties.has(seenKey)) {
        this.seenCounterparties.set(seenKey, now);
      }
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
      this.pruneOldCallTimestamps(now);
    }
    this.onMutate();
  }

  /** Drops call-timestamp entries older than the day-spend window (with a
   *  1h safety margin) so a long-running agent's in-memory history doesn't
   *  grow without bound — `getDaySpend` and friends never read past 24h
   *  anyway. Only scans+filters when the oldest entry is actually stale,
   *  since entries arrive in roughly chronological order and this runs on
   *  every allowed call. */
  private pruneOldCallTimestamps(nowMs: number): void {
    const cutoff = nowMs - 25 * 60 * 60 * 1000;
    if (this.callTimestamps.length > 0 && this.callTimestamps[0].ts < cutoff) {
      this.callTimestamps = this.callTimestamps.filter((c) => c.ts >= cutoff);
    }
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
 * Writes are debounced (default 1s) and flushed on the Node `'exit'` event —
 * which fires on a normal exit *and* on the default (unhandled) disposition
 * of SIGINT/SIGTERM, so a plain `Ctrl+C` is covered without this class
 * installing its own signal handlers. It deliberately never calls
 * `process.exit()` itself: a library forcing process termination could cut
 * off a host application's own shutdown sequence (other 'exit'/SIGINT
 * listeners, in-flight requests) if this one happened to run first.
 * Single-process only — concurrent writers would clobber each other.
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
    process.once("exit", () => this.flush());
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

  /** Write the current snapshot now, bypassing the debounce. Writes to a
   *  temp file in the same directory and renames it over the target —
   *  `rename` is atomic on the same filesystem, so a crash mid-write (or a
   *  concurrent reader) never observes a truncated/partial JSON file. A
   *  plain `writeFileSync(filePath, ...)` truncates the target in place
   *  first, so a crash between the truncate and the write would otherwise
   *  leave a corrupt file — and a fresh `FilePolicyStateStore` that fails to
   *  parse it just starts empty, silently zeroing every budget counter and
   *  the anomaly baseline. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      writeFileSync(tmpPath, JSON.stringify(this.serialize()), "utf8");
      renameSync(tmpPath, this.filePath);
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

    // Tracks the first *alert*-only signal seen below (anomaly rules whose
    // action is "alert" never block/hold — they only need to show up on the
    // final verdict if nothing else already returned). Evaluation order
    // decides which one wins if more than one fires on the same call.
    let alertRuleHit: string | null = null;
    let alertAnomalyZ: number | undefined;

    // 4. Counterparty first-seen gate. Applies in both allowlist and
    // denylist mode — first contact with any address that isn't already
    // explicitly trusted (`allow`) or previously vetted (a prior "allow"
    // verdict) must clear `first_seen` before going further. This is the
    // primary defense against a prompt-injection redirect to an address the
    // attacker controls: it doesn't matter which counterparty mode is
    // configured, an address the agent has never talked to is still new.
    // Once vetted, `isSeen` stays true for that counterparty from then on —
    // it is not re-gated on every subsequent call.
    const isAllowlisted = policy.counterparties.allow.includes(counterparty);
    const isSeen = store.isCounterpartySeen(agentId, counterparty);

    if (!isAllowlisted && !isSeen) {
      store.recordFirstContact(agentId, counterparty, now);
      if (amount > policy.counterparties.firstSeen.autoAllowBelowUsdc) {
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
        if (action === "alert") {
          alertRuleHit = "counterparties.first_seen.action";
        }
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
      if (action === "alert") {
        alertRuleHit ??= "anomaly.burn_rate";
        alertAnomalyZ = ewmaResult.z;
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
        if (action === "alert") {
          alertRuleHit ??= "anomaly.new_counterparty_rate";
        }
      }
    }

    // Default Allow — carries an alert signal (ruleHit set, decision still
    // "allow") if one of the alert-only rules above fired without anything
    // blocking or holding the call.
    const verdict: EvaluationVerdict = {
      decision: "allow",
      ruleHit: alertRuleHit,
      anomalyZ: alertAnomalyZ ?? ewmaResult.z,
      qualityRules,
      escalation: policy.escalation,
    };
    store.recordCall(input, verdict);
    return verdict;
  }
}
