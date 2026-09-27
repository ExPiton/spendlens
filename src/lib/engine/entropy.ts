/**
 * Counterparty entropy — the third anomaly signal. Burn rate catches "too
 * much, too fast"; new-counterparty rate catches "too many strangers". This
 * one catches *concentration*: an agent that normally spreads its calls over
 * several providers suddenly sending nearly all of them to one (a prompt-
 * injected redirect to an attacker's paid endpoint that stays under every
 * per-call and budget limit). Kept as interpretable as the burn-rate EWMA:
 * "spend diversity fell from 2.3 bits to 0.4 bits" answers "why was this
 * flagged?" directly.
 */

/** Shannon entropy, in bits, of a counterparty → call-count distribution.
 *  0 for zero or one distinct counterparty; log2(k) for k equally used. */
export function shannonEntropyBits(counts: Iterable<number>): number {
  const values = [...counts].filter((c) => c > 0);
  const total = values.reduce((s, c) => s + c, 0);
  if (total === 0 || values.length < 2) return 0;
  let h = 0;
  for (const c of values) {
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export interface EntropyState {
  /** EWMA baseline of the windowed entropy, in bits. */
  mu: number;
  /** epoch ms of the last update */
  lastTs: number;
  /** how many observations have been folded in */
  n: number;
}

export interface EntropyCheck {
  state: EntropyState;
  /** Entropy of the current window, in bits. */
  current: number;
  /** Relative drop vs. the prior baseline (0..1), 0 when not computable. */
  drop: number;
}

/**
 * Folds the current window's entropy into the baseline and reports how far
 * it fell below the *prior* baseline. The baseline half-life equals the
 * window length, so it tracks the agent's normal diversity while a sudden
 * collapse inside one window still stands out against it.
 */
export function updateEntropyBaseline(
  prev: EntropyState | null,
  current: number,
  tsMs: number,
  halflifeMinutes: number,
): EntropyCheck {
  if (!prev) {
    return { state: { mu: current, lastTs: tsMs, n: 1 }, current, drop: 0 };
  }
  const deltaMinutes = Math.max((tsMs - prev.lastTs) / 60_000, 0);
  const tau = halflifeMinutes / Math.LN2;
  const lambda = deltaMinutes === 0 ? 0 : 1 - Math.exp(-deltaMinutes / tau);
  const mu = lambda * current + (1 - lambda) * prev.mu;
  const drop = prev.mu > 0 ? Math.max(0, (prev.mu - current) / prev.mu) : 0;
  return { state: { mu, lastTs: tsMs, n: prev.n + 1 }, current, drop };
}
