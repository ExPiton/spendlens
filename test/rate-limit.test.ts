import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

describe("rateLimit", () => {
  it("allows up to the limit, then blocks within the window", () => {
    const key = `t-${Math.random()}`;
    for (let i = 1; i <= 5; i++) {
      const r = rateLimit(key, 5, 10_000);
      assert.equal(r.ok, true, `call ${i} should pass`);
      assert.equal(r.remaining, 5 - i);
    }
    const over = rateLimit(key, 5, 10_000);
    assert.equal(over.ok, false);
    assert.equal(over.remaining, 0);
    assert.ok(over.retryAfter >= 1);
  });

  it("resets after the window elapses", () => {
    const key = `t-${Math.random()}`;
    assert.equal(rateLimit(key, 1, 20).ok, true);
    assert.equal(rateLimit(key, 1, 20).ok, false);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        assert.equal(rateLimit(key, 1, 20).ok, true, "window rolled over");
        resolve();
      }, 40);
    });
  });

  it("keeps separate budgets per key", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    assert.equal(rateLimit(a, 1).ok, true);
    assert.equal(rateLimit(a, 1).ok, false);
    assert.equal(rateLimit(b, 1).ok, true, "b is unaffected by a");
  });

  it("emits standard headers and Retry-After only on a 429", () => {
    const key = `t-${Math.random()}`;
    const ok = rateLimit(key, 1);
    assert.equal(rateLimitHeaders(ok)["retry-after"], undefined);
    const blocked = rateLimit(key, 1);
    const h = rateLimitHeaders(blocked);
    assert.equal(h["x-ratelimit-limit"], "1");
    assert.equal(h["x-ratelimit-remaining"], "0");
    assert.ok(Number(h["retry-after"]) >= 1);
  });
});
