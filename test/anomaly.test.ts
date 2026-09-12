import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { updateBurnRateEwma, isColdStart } from "../src/lib/engine/anomaly";

describe("EWMA Anomaly Detection Engine", () => {
  test("first observation has nothing to compare against yet: z = 0, not yet rate-seeded", () => {
    const t0 = Date.now();
    const res = updateBurnRateEwma(null, 0.003, t0, 15);
    assert.equal(res.z, 0);
    assert.equal(res.state.lastTs, t0);
  });

  test("second observation seeds the rate baseline (z = 0 — still nothing to compare against)", () => {
    const t0 = Date.now();
    const seed = updateBurnRateEwma(null, 0.003, t0, 15);
    // 1 minute later, same amount -> rate = 0.003 USDC/min.
    const res = updateBurnRateEwma(seed.state, 0.003, t0 + 60_000, 15);
    assert.equal(res.z, 0);
    assert.equal(res.state.mu, 0.003);
    assert.equal(res.state.sigma2, 0);
  });

  test("consistent observations (one call per minute) keep z-score low", () => {
    let state = updateBurnRateEwma(null, 0.003, Date.now(), 15).state;
    let t = state.lastTs;
    const halflife = 15;

    // Seed the rate baseline with the second call.
    const seeded = updateBurnRateEwma(state, 0.003, (t += 60_000), halflife);
    state = seeded.state;

    // 10 more stable ticks, one minute apart.
    for (let i = 0; i < 10; i++) {
      t += 60_000;
      const res = updateBurnRateEwma(state, 0.0031, t, halflife);
      state = res.state;
      assert.ok(Math.abs(res.z) < 1.0, `z-score was ${res.z}`);
    }
  });

  test("sudden huge spike triggers high positive z-score", () => {
    let state = updateBurnRateEwma(null, 0.003, 1_000_000, 15).state;
    let t = 1_000_000;
    const halflife = 15;

    // Build baseline with some slight variance, one call per minute.
    const r1 = updateBurnRateEwma(state, 0.003, (t += 60_000), halflife);
    state = r1.state;
    const r2 = updateBurnRateEwma(state, 0.0032, (t += 60_000), halflife);
    state = r2.state;
    const r3 = updateBurnRateEwma(state, 0.0028, (t += 60_000), halflife);
    state = r3.state;

    // Sudden spike to 0.049 USDC, same cadence.
    t += 60_000;
    const spike = updateBurnRateEwma(state, 0.049, t, halflife);
    assert.ok(spike.z > 3.0, `Expected z > 3.0 on huge spike, got ${spike.z}`);
  });

  test("REGRESSION: a fixed-price API's baseline still catches a large single spike", () => {
    // Every call is the *exact* same amount (a common fixed-price API) —
    // sigma2 legitimately stays at 0. An earlier version of this function
    // then hardcoded z = 0 whenever sigma2 was 0, so no spike, however
    // large, was ever detected once the baseline had "locked in".
    let state = updateBurnRateEwma(null, 0.003, 0, 15).state;
    let t = 0;
    for (let i = 0; i < 300; i++) {
      state = updateBurnRateEwma(state, 0.003, (t += 1000), 15).state;
    }
    assert.equal(state.sigma2, 0, "sanity: variance is genuinely zero");

    const spike = updateBurnRateEwma(state, 0.3, (t += 1000), 15); // 100x
    assert.ok(spike.z >= 3.0, `100x spike should clear z>=3.0, got ${spike.z}`);
  });

  test("REGRESSION: same-size payments arriving far faster than usual raise z (velocity, not just size)", () => {
    // Baseline: normal-but-varying amounts, one call per minute.
    let state = updateBurnRateEwma(null, 0.002, 0, 15).state;
    let t = 0;
    const normal = [0.002, 0.004, 0.003, 0.005];
    for (let i = 0; i < 200; i++) {
      state = updateBurnRateEwma(state, normal[i % normal.length], (t += 60_000), 15).state;
    }

    // Attack: the SAME normal-sized payments, but 60x faster (one per
    // second instead of one per minute). Every individual amount is well
    // within the normal range — a per-payment-size check would miss this
    // entirely, which is exactly what "burn rate" is supposed to catch.
    let maxZ = 0;
    for (let i = 0; i < 20; i++) {
      const res = updateBurnRateEwma(state, 0.003, (t += 1000), 15);
      state = res.state;
      maxZ = Math.max(maxZ, res.z);
    }
    assert.ok(maxZ >= 3.0, `sustained 60x-faster burst should raise z>=3.0, got ${maxZ}`);
  });

  test("cold start correctly identifies warmup window", () => {
    // Fewer than 200 authorizations is cold start
    assert.equal(isColdStart(50, 10), true);
    assert.equal(isColdStart(199, 10), true);

    // Less than 30 minutes is cold start
    assert.equal(isColdStart(300, 15), true);

    // Warm: >= 200 authorizations AND >= 30 minutes
    assert.equal(isColdStart(200, 30), false);
    assert.equal(isColdStart(500, 45), false);
  });
});
