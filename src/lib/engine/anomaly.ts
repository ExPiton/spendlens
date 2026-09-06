/**
 * Anomaly detection — an EWMA (exponentially weighted moving average)
 * burn-rate scorer. Deliberately simple: complex machine learning isn't
 * needed here and is actively harmful at this stage, since an
 * uninterpretable model can't answer "why was this blocked?"
 */

export interface EwmaState {
  /** mu_(t-1) */
  mu: number;
  /** sigma2_(t-1) */
  sigma2: number;
  /** epoch ms of the observation this state was computed from */
  lastTs: number;
}

export interface EwmaUpdateResult {
  state: EwmaState;
  /** Standard score of the new observation against the prior baseline. */
  z: number;
}

/**
 * Folds one new observation (x_t, e.g. USDC spent in this tick) into the
 * running EWMA baseline and returns the z-score used to decide whether the
 * anomaly action fires. First observation seeds the baseline with z = 0 —
 * there is nothing to compare against yet.
 */
export function updateBurnRateEwma(
  prev: EwmaState | null,
  xT: number,
  tsMs: number,
  halflifeMinutes: number,
): EwmaUpdateResult {
  if (!prev) {
    return { state: { mu: xT, sigma2: 0, lastTs: tsMs }, z: 0 };
  }

  const deltaTMinutes = Math.max((tsMs - prev.lastTs) / 60_000, 0);
  const tau = halflifeMinutes / Math.LN2;
  const lambda = deltaTMinutes === 0 ? 0 : 1 - Math.exp(-deltaTMinutes / tau);

  const mu = lambda * xT + (1 - lambda) * prev.mu;
  const sigma2 = lambda * (xT - prev.mu) ** 2 + (1 - lambda) * prev.sigma2;
  const stdDev = Math.sqrt(prev.sigma2);
  const minStdDev = Math.max(prev.mu * 0.05, 0.0005);
  const z = prev.sigma2 === 0 ? 0 : (xT - prev.mu) / Math.max(stdDev, minStdDev);

  return { state: { mu, sigma2, lastTs: tsMs }, z };
}

/**
 * The cold-start problem: with no history, everything looks anomalous.
 * During the warm-up window, anomaly rules log but never block. Defaults:
 * the first 200 authorizations, or the first 30 minutes of an agent's
 * activity.
 */
export function isColdStart(
  authorizationsSoFar: number,
  minutesSinceFirstAuthorization: number,
  warmup: { authorizations: number; minutes: number } = {
    authorizations: 200,
    minutes: 30,
  },
): boolean {
  return (
    authorizationsSoFar < warmup.authorizations ||
    minutesSinceFirstAuthorization < warmup.minutes
  );
}
