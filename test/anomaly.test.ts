import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { updateBurnRateEwma, isColdStart } from "../src/lib/engine/anomaly";

describe("EWMA Anomaly Detection Engine", () => {
  test("first observation seeds the baseline with z = 0", () => {
    const t0 = Date.now();
    const res = updateBurnRateEwma(null, 0.003, t0, 15);
    assert.equal(res.z, 0);
    assert.equal(res.state.mu, 0.003);
    assert.equal(res.state.sigma2, 0);
    assert.equal(res.state.lastTs, t0);
  });

  test("consistent observations keep z-score low", () => {
    let state = null;
    let t = Date.now();
    const halflife = 15;

    // Seed
    const init = updateBurnRateEwma(state, 0.003, t, halflife);
    state = init.state;

    // 10 stable ticks
    for (let i = 0; i < 10; i++) {
      t += 1000;
      const res = updateBurnRateEwma(state, 0.0031, t, halflife);
      state = res.state;
      assert.ok(Math.abs(res.z) < 1.0, `z-score was ${res.z}`);
    }
  });

  test("sudden huge spike triggers high positive z-score", () => {
    let state = null;
    let t = 1000000;
    const halflife = 15;

    // Build baseline with some slight variance
    const r1 = updateBurnRateEwma(state, 0.003, t, halflife);
    state = r1.state;
    t += 2000;
    const r2 = updateBurnRateEwma(state, 0.0032, t, halflife);
    state = r2.state;
    t += 2000;
    const r3 = updateBurnRateEwma(state, 0.0028, t, halflife);
    state = r3.state;

    // Sudden spike to 0.049 USDC
    t += 2000;
    const spike = updateBurnRateEwma(state, 0.049, t, halflife);
    assert.ok(spike.z > 3.0, `Expected z > 3.0 on huge spike, got ${spike.z}`);
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
