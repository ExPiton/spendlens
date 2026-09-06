import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidSlug, normalizeSlug } from "@/lib/slug";

describe("agent slugs", () => {
  it("normalizes messy input", () => {
    assert.equal(normalizeSlug("  Research Crawler 01 "), "research-crawler-01");
    assert.equal(normalizeSlug("Payments__Bot!!"), "payments-bot");
    assert.equal(normalizeSlug("--weird--"), "weird");
    assert.equal(normalizeSlug("MixedCASE-42"), "mixedcase-42");
  });

  it("accepts valid slugs", () => {
    for (const s of ["abc", "research-crawler-01", "a1b2c3", "x".repeat(50)]) {
      assert.ok(isValidSlug(s), s);
    }
  });

  it("rejects invalid slugs", () => {
    for (const s of ["ab", "-lead", "lead-", "a_b", "UPPER", "x".repeat(51), ""]) {
      assert.equal(isValidSlug(s), false, s);
    }
  });
});
