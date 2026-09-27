import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyQuality, type QualityRules } from "../src/lib/engine/classifyQuality";
import { compileBodySchema } from "../src/lib/engine/schema-check";

const rules: QualityRules = {
  failureStatusCodes: [402, 429, 500, 502, 503, 504],
  emptyBodyIsFailure: true,
  maxLatencyMs: 4000,
  validateSchema: compileBodySchema(
    JSON.stringify({ type: "object", required: ["rows"], properties: { rows: { type: "integer", minimum: 1 } } }),
  ),
};
const GOOD = JSON.stringify({ rows: 3 });

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
      { timedOut: false, status: 200, bodyBytes: 20, latencyMs: 150, body: JSON.stringify({ rows: 0 }) },
      rules,
    );
    assert.equal(q, "schema_fail");
  });

  test("returns schema_fail when the body isn't JSON at all", () => {
    const q = classifyQuality(
      { timedOut: false, status: 200, bodyBytes: 9, latencyMs: 150, body: "<html/>ok" },
      rules,
    );
    assert.equal(q, "schema_fail");
  });

  test("compileBodySchema rejects an invalid schema up front", () => {
    assert.throws(() => compileBodySchema("{not json"), /not valid JSON/);
  });

  test("returns slow when latency exceeds maxLatencyMs", () => {
    const q = classifyQuality(
      { timedOut: false, status: 200, bodyBytes: 500, latencyMs: 4500, body: GOOD },
      rules,
    );
    assert.equal(q, "slow");
  });

  test("returns ok when all quality conditions pass", () => {
    const q = classifyQuality(
      { timedOut: false, status: 200, bodyBytes: 500, latencyMs: 250, body: GOOD },
      rules,
    );
    assert.equal(q, "ok");
  });
});
