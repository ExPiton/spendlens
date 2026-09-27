import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import type { PolicyConfig } from "@/lib/contracts";
import { updateBurnRateEwma, isColdStart, type EwmaState } from "@/lib/engine/anomaly";
import type { QualityRules } from "@/lib/engine/classifyQuality";
import {
  shannonEntropyBits,
  updateEntropyBaseline,
  type EntropyState,
} from "@/lib/engine/entropy";
import { bodyValidatorFor } from "@/lib/engine/schema-check";
import { normalizeCounterparty } from "@/lib/counterparty";
import { policyHash } from "@/lib/policy-hash";

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
  /** Canonical counterparty the decision was made about (lowercased). */
  counterparty: string;
  /** SHA-256 of the policy this verdict came from — goes on the ledger row. */
  policyHash: string;
  /** Dashboard policy version, when the policy came from remote sync. */
  policyVersion: number | null;
}

/** `YYYY-MM` of an epoch-ms timestamp, in UTC — the monthly budget bucket. */
export function utcMonthKey(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface PolicyStateStore {
  getTaskSpend(agentId: string, taskId: string): number;
  getHourSpend(agentId: string, nowMs: number): number;
  getDaySpend(agentId: string, nowMs: number): number;
  /** Spend in the current UTC calendar month. */
  getMonthSpend(agentId: string, nowMs: number): number;
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
  /** Allowed-call counts per counterparty since `sinceMs` (entropy signal). */
  getCounterpartyCountsSince(agentId: string, sinceMs: number): Map<string, number>;
  getEntropyState(agentId: string): EntropyState | null;
  setEntropyState(agentId: string, state: EntropyState): void;
  recordCall(input: EvaluationInput, verdict: EvaluationVerdict): void;
  /** Books the spend of a `hold` that was then approved — it was paid, so
   *  it must count toward every budget exactly like an `allow`. Does not
   *  bump the call counter (`recordCall` already counted the attempt). */
  recordSpend(input: EvaluationInput): void;
}

interface SerializedPolicyState {
  taskSpends: Record<string, number>;
  callTimestamps: { agentId: string; ts: number; amount: number; counterparty: string }[];
  seenCounterparties: Record<string, number>;
  firstContacts: Record<string, number>;
  firstActivity: Record<string, number>;
  totalCalls: Record<string, number>;
  ewmaStates: Record<string, EwmaState>;
  monthSpends: Record<string, number>;
  entropyStates: Record<string, EntropyState>;
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
  /** `${agentId}:${YYYY-MM}` -> spend in that UTC month. */
  protected monthSpends = new Map<string, number>();
  protected entropyStates = new Map<string, EntropyState>();

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
      monthSpends: Object.fromEntries(this.monthSpends),
      entropyStates: Object.fromEntries(this.entropyStates),
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
    this.monthSpends = new Map(Object.entries(s.monthSpends ?? {}));
    this.entropyStates = new Map(Object.entries(s.entropyStates ?? {}));
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

  getMonthSpend(agentId: string, nowMs: number): number {
    return this.monthSpends.get(`${agentId}:${utcMonthKey(nowMs)}`) || 0;
  }

  getCounterpartyCountsSince(agentId: string, sinceMs: number): Map<string, number> {
    const counts = new Map<string, number>();
    for (const c of this.callTimestamps) {
      if (c.agentId === agentId && c.ts >= sinceMs) {
        counts.set(c.counterparty, (counts.get(c.counterparty) || 0) + 1);
      }
    }
    return counts;
  }

  getEntropyState(agentId: string): EntropyState | null {
    return this.entropyStates.get(agentId) || null;
  }

  setEntropyState(agentId: string, state: EntropyState): void {
    this.entropyStates.set(agentId, state);
    this.onMutate();
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

    if (verdict.decision === "allow") this.bookSpend(input, now);
    this.onMutate();
  }

  recordSpend(input: EvaluationInput): void {
    this.bookSpend(input, input.now ?? Date.now());
    this.onMutate();
  }

  private bookSpend(input: EvaluationInput, now: number): void {
    const agentId = input.agentId;
    const seenKey = `${agentId}:${input.counterparty}`;
    if (!this.seenCounterparties.has(seenKey)) {
      this.seenCounterparties.set(seenKey, now);
    }
    if (input.taskId) {
      const key = `${agentId}:${input.taskId}`;
      this.taskSpends.set(key, (this.taskSpends.get(key) || 0) + input.amount);
    }
    const monthKey = `${agentId}:${utcMonthKey(now)}`;
    this.monthSpends.set(monthKey, (this.monthSpends.get(monthKey) || 0) + input.amount);
    this.callTimestamps.push({
      agentId,
      ts: now,
      amount: input.amount,
      counterparty: input.counterparty,
    });
    this.pruneOldCallTimestamps(now);
    this.pruneOldMonths(now);
  }

  /** Keeps only the current and previous UTC month's buckets. */
  private pruneOldMonths(nowMs: number): void {
    if (this.monthSpends.size < 64) return;
    const d = new Date(nowMs);
    const prev = utcMonthKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    const cur = utcMonthKey(nowMs);
    for (const key of this.monthSpends.keys()) {
      const month = key.slice(key.lastIndexOf(":") + 1);
      if (month !== cur && month !== prev) this.monthSpends.delete(key);
    }
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

/** Upper bound on the entropy window — the store only keeps 25h of calls. */
const MAX_ENTROPY_WINDOW_MINUTES = 24 * 60;

/**
 * Spendlens Declarative Policy Engine.
 * Enforces evaluation order:
 * 0. Halt (kill switch) -> 1. Deny list -> 2. Per-call limits -> 3. Budgets ->
 * 4. Counterparties -> 5. Anomaly (burn rate, new-counterparty rate,
 * counterparty entropy). Quality rules are handed back on the verdict and
 * applied to the response.
 *
 * Counterparties are compared case-insensitively everywhere (see
 * `normalizeCounterparty`) — an EVM address in checksum case and the same
 * address in lowercase are one counterparty, so a denylist entry can't be
 * sidestepped by re-casing the `payTo` in a 402 response.
 */
export class PolicyEngine {
  private policy!: PolicyConfig;
  private allow!: Set<string>;
  private deny!: Set<string>;
  private hash!: string;
  private version: number | null = null;
  private qualityRules!: QualityRules;
  /** Non-null while the agent is halted (dashboard kill switch) or the
   *  policy could not be loaded in a fail-closed setup: every evaluation
   *  blocks with this rule id until `resume()`. */
  private haltedRule: string | null = null;

  constructor(
    policy: PolicyConfig,
    private store: PolicyStateStore = new InMemoryPolicyStateStore(),
    meta: { version?: number | null } = {},
  ) {
    this.setPolicy(policy, meta);
  }

  public getPolicy(): PolicyConfig {
    return this.policy;
  }

  public getPolicyHash(): string {
    return this.hash;
  }

  public getPolicyVersion(): number | null {
    return this.version;
  }

  /**
   * Swaps the active policy in place — how a rule change made in the
   * dashboard reaches a running agent without a redeploy (see the SDK's
   * remote config sync). State (budgets, baselines) is kept: tightening a
   * limit applies to spend already made. Throws on an uncompilable
   * `quality.json_schema`, leaving the previous policy active.
   */
  public setPolicy(policy: PolicyConfig, meta: { version?: number | null } = {}): void {
    const validateSchema = bodyValidatorFor(policy.quality.jsonSchema);
    this.policy = policy;
    this.allow = new Set(policy.counterparties.allow.map(normalizeCounterparty));
    this.deny = new Set(policy.counterparties.deny.map(normalizeCounterparty));
    this.hash = policyHash(policy);
    this.version = meta.version ?? null;
    this.qualityRules = {
      failureStatusCodes: policy.quality.failureStatusCodes,
      emptyBodyIsFailure: policy.quality.emptyBodyIsFailure,
      maxLatencyMs: policy.quality.maxLatencyMs,
      ...(validateSchema ? { validateSchema } : {}),
    };
  }

  /** Blocks every payment with `ruleHit` (default `agent.halted`). */
  public halt(ruleHit = "agent.halted"): void {
    this.haltedRule = ruleHit;
  }

  public resume(): void {
    this.haltedRule = null;
  }

  public isHalted(): boolean {
    return this.haltedRule !== null;
  }

  public getHaltRule(): string | null {
    return this.haltedRule;
  }

  /**
   * A `hold` that escalation then approved was paid: book its spend against
   * the budgets, the seen set and the entropy window. Without this an
   * approved hold was invisible to every budget — a way to spend past a
   * daily limit one approved hold at a time.
   */
  public recordHoldApproved(input: EvaluationInput): void {
    this.store.recordSpend({
      ...input,
      counterparty: normalizeCounterparty(input.counterparty),
    });
  }

  public async evaluate(rawInput: EvaluationInput): Promise<EvaluationVerdict> {
    const input: EvaluationInput = {
      ...rawInput,
      counterparty: normalizeCounterparty(rawInput.counterparty),
    };
    const now = input.now ?? Date.now();
    const policy = this.policy;
    const store = this.store;
    const amount = input.amount;
    const counterparty = input.counterparty;
    const agentId = input.agentId;
    const qualityRules = this.qualityRules;

    const verdictOf = (
      decision: EvaluationVerdict["decision"],
      ruleHit: string | null,
      anomalyZ?: number,
    ): EvaluationVerdict => ({
      decision,
      ruleHit,
      qualityRules,
      escalation: policy.escalation,
      counterparty,
      policyHash: this.hash,
      policyVersion: this.version,
      ...(anomalyZ !== undefined ? { anomalyZ } : {}),
    });
    const finish = (verdict: EvaluationVerdict): EvaluationVerdict => {
      store.recordCall(input, verdict);
      return verdict;
    };

    // 0. Kill switch — nothing else matters while the agent is halted.
    if (this.haltedRule) return finish(verdictOf("block", this.haltedRule));

    // 1. Deny list
    if (this.deny.has(counterparty)) {
      return finish(verdictOf("block", "counterparties.deny"));
    }

    // 2. Per-call checks
    if (amount > policy.perCall.maxUsdc) {
      return finish(verdictOf("block", "per_call.max_usdc"));
    }
    if (store.getMinuteCallCount(agentId, now) >= policy.perCall.maxCallsPerMinute) {
      return finish(verdictOf("block", "per_call.max_calls_per_minute"));
    }

    // 3. Budgets (task, hour, day, month)
    for (const budget of policy.budgets) {
      let spent: number | null = null;
      if (budget.scope === "task") {
        if (input.taskId) spent = store.getTaskSpend(agentId, input.taskId);
      } else if (budget.scope === "hour") {
        spent = store.getHourSpend(agentId, now);
      } else if (budget.scope === "day") {
        spent = store.getDaySpend(agentId, now);
      } else if (budget.scope === "month") {
        spent = store.getMonthSpend(agentId, now);
      }
      if (spent !== null && spent + amount > budget.limitUsdc) {
        return finish(verdictOf("block", `budgets.${budget.scope}`));
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
    // explicitly trusted (`allow`) or previously vetted (a prior paid call)
    // must clear `first_seen` before going further. This is the primary
    // defense against a prompt-injection redirect to an address the
    // attacker controls. Once vetted, a counterparty is not re-gated.
    const isAllowlisted = this.allow.has(counterparty);
    const isSeen = store.isCounterpartySeen(agentId, counterparty);
    if (!isAllowlisted && !isSeen) {
      store.recordFirstContact(agentId, counterparty, now);
      if (amount > policy.counterparties.firstSeen.autoAllowBelowUsdc) {
        const action = policy.counterparties.firstSeen.action;
        if (action === "block" || action === "hold") {
          return finish(verdictOf(action, "counterparties.first_seen.action"));
        }
        if (action === "alert") alertRuleHit = "counterparties.first_seen.action";
      }
    }

    // 5. Anomaly detection
    const totalAuthorizations = store.getTotalAuthorizationsCount(agentId);
    const firstActivity = store.getFirstActivityTimestamp(agentId);
    const minutesSinceStart = firstActivity ? (now - firstActivity) / (60 * 1000) : 0;
    const coldStart = isColdStart(totalAuthorizations, minutesSinceStart);

    // 5a. Burn rate (EWMA)
    const ewmaResult = updateBurnRateEwma(
      store.getEwmaState(agentId),
      amount,
      now,
      policy.anomaly.burnRate.halflifeMinutes,
    );
    store.setEwmaState(agentId, ewmaResult.state);

    if (!coldStart && ewmaResult.z >= policy.anomaly.burnRate.zThreshold) {
      const action = policy.anomaly.burnRate.action;
      if (action === "block" || action === "hold") {
        return finish(verdictOf(action, "anomaly.burn_rate", ewmaResult.z));
      }
      if (action === "alert") {
        alertRuleHit ??= "anomaly.burn_rate";
        alertAnomalyZ = ewmaResult.z;
      }
    }

    // 5b. New counterparty rate
    if (!isSeen) {
      const recentNewCount = store.getNewCounterpartiesCountLastHour(agentId, now);
      if (recentNewCount > policy.anomaly.newCounterpartyRate.maxPerHour) {
        const action = policy.anomaly.newCounterpartyRate.action;
        if (action === "block" || action === "hold") {
          return finish(verdictOf(action, "anomaly.new_counterparty_rate"));
        }
        if (action === "alert") alertRuleHit ??= "anomaly.new_counterparty_rate";
      }
    }

    // 5c. Counterparty entropy (concentration). The window includes this
    // call, so a flood to one address pulls the entropy down as it happens.
    const entropyCfg = policy.anomaly.counterpartyEntropy;
    if (entropyCfg) {
      const windowMinutes = Math.min(entropyCfg.windowMinutes, MAX_ENTROPY_WINDOW_MINUTES);
      const counts = store.getCounterpartyCountsSince(agentId, now - windowMinutes * 60_000);
      counts.set(counterparty, (counts.get(counterparty) || 0) + 1);
      const windowCalls = [...counts.values()].reduce((s, c) => s + c, 0);
      if (windowCalls >= entropyCfg.minCalls) {
        const check = updateEntropyBaseline(
          store.getEntropyState(agentId),
          shannonEntropyBits(counts.values()),
          now,
          windowMinutes,
        );
        store.setEntropyState(agentId, check.state);
        // The baseline itself needs `minCalls` observations before a drop
        // against it means anything — same idea as the burn-rate warm-up.
        const baselineReady = check.state.n > entropyCfg.minCalls;
        if (!coldStart && baselineReady && check.drop > entropyCfg.maxDrop) {
          const action = entropyCfg.action;
          if (action === "block" || action === "hold") {
            return finish(verdictOf(action, "anomaly.counterparty_entropy"));
          }
          if (action === "alert") alertRuleHit ??= "anomaly.counterparty_entropy";
        }
      }
    }

    // Default allow — carries an alert signal (ruleHit set, decision still
    // "allow") if one of the alert-only rules above fired without anything
    // blocking or holding the call.
    return finish(verdictOf("allow", alertRuleHit, alertAnomalyZ ?? ewmaResult.z));
  }
}
