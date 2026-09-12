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

/** A single call at the same millisecond as the previous one would divide
 *  by ~0 minutes; floor the interval at 1 second so a burst doesn't produce
 *  an unbounded instantaneous rate. */
const MIN_DELTA_MINUTES = 1 / 60;

/** `sigma2` can never legitimately be negative — used as a sentinel on a
 *  timestamp-only state to mean "no rate has been computed yet" (see below). */
const NOT_YET_RATE_SEEDED = -1;

/**
 * Folds one new observation into the running EWMA baseline and returns the
 * z-score used to decide whether the anomaly action fires.
 *
 * `xT` is the USDC amount of this payment; internally it's converted to a
 * *rate* (USDC/minute, `xT / deltaT` since the previous observation) before
 * being folded in. Feeding the raw amount instead — what an earlier version
 * of this function did — makes "burn rate" measure single-payment size, not
 * spend velocity: a flood of ordinary-sized payments arriving far faster
 * than usual (the actual "account empties out" scenario) never moves it,
 * because every individual `xT` still looks normal. Dividing by elapsed
 * time is what makes speed itself the signal.
 *
 * A rate needs two timestamps, so the very first call has nothing to divide
 * by — it can only remember `tsMs` (`z = 0`, nothing to compare against
 * yet). The *second* call is what actually seeds `mu`/`sigma2`, now that a
 * real rate exists; seeding straight from the first call's raw `xT` would
 * mix raw-amount and rate units and manufacture a false spike out of
 * nothing on the very next observation.
 */
export function updateBurnRateEwma(
  prev: EwmaState | null,
  xT: number,
  tsMs: number,
  halflifeMinutes: number,
): EwmaUpdateResult {
  if (!prev) {
    return { state: { mu: 0, sigma2: NOT_YET_RATE_SEEDED, lastTs: tsMs }, z: 0 };
  }

  const deltaTMinutes = Math.max((tsMs - prev.lastTs) / 60_000, 0);
  const rate = xT / Math.max(deltaTMinutes, MIN_DELTA_MINUTES);

  if (prev.sigma2 === NOT_YET_RATE_SEEDED) {
    return { state: { mu: rate, sigma2: 0, lastTs: tsMs }, z: 0 };
  }

  const tau = halflifeMinutes / Math.LN2;
  const lambda = deltaTMinutes === 0 ? 0 : 1 - Math.exp(-deltaTMinutes / tau);

  const mu = lambda * rate + (1 - lambda) * prev.mu;
  const sigma2 = lambda * (rate - prev.mu) ** 2 + (1 - lambda) * prev.sigma2;
  const stdDev = Math.sqrt(prev.sigma2);
  // A floor on the denominator, not just a fallback for sigma2 === 0: a
  // real-world price is rarely perfectly constant, but it's often *close*
  // enough that sigma2 stays near zero call after call — normal float
  // jitter under a mean of 0.05% ordinarily doesn't happen. Without this
  // floor, a series with genuinely zero variance (the common "fixed-price
  // API" case) leaves z permanently at 0 — no spike, however large, would
  // ever be seen as anomalous once the baseline has "locked in".
  const minStdDev = Math.max(prev.mu * 0.05, 0.0005);
  const z = (rate - prev.mu) / Math.max(stdDev, minStdDev);

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
