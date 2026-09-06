import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyQuality, type QualityRules } from "../src/lib/engine/classifyQuality";

const rules: QualityRules = {
  failureStatusCodes: [402, 429, 500, 502, 503, 504],
  emptyBodyIsFailure: true,
  maxLatencyMs: 4000,
  validateSchema: (bytes: number) => bytes >= 50,
};

describe("Quality Classification Engine", () => {
  test("returns timeout when request timed out", () => {
    const q = classifyQuality(
      { timedOut: true, status: 200, bodyBytes: 200, latencyMs: 5000 },
      rules,
    );
    assert.equal(q, "timeout");
  });

  test("returns http_error when status is in failure codes list", () => {
    const q = classifyQuality(
      { timedOut: false, status: 500, bodyBytes: 200, latencyMs: 120 },
      rules,
    );
    assert.equal(q, "http_error");
  });

  test("returns empty when bodyBytes is 0 and emptyBodyIsFailure is true", () => {
    const q = classifyQuality(
      { timedOut: false, status: 200, bodyBytes: 0, latencyMs: 150 },
      rules,
    );
    assert.equal(q, "empty");
  });

  test("returns schema_fail when validator rejects the response", () => {
    const q = classifyQuality(
      { timedOut: false, status: 200, bodyBytes: 20, latencyMs: 150 },
      rules,
    );
    assert.equal(q, "schema_fail");
  });

  test("returns slow when latency exceeds maxLatencyMs", () => {
    const q = classifyQuality(
      { timedOut: false, status: 200, bodyBytes: 500, latencyMs: 4500 },
      rules,
    );
    assert.equal(q, "slow");
  });

  test("returns ok when all quality conditions pass", () => {
    const q = classifyQuality(
      { timedOut: false, status: 200, bodyBytes: 500, latencyMs: 250 },
      rules,
    );
    assert.equal(q, "ok");
  });
});
