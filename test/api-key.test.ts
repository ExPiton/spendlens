import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  API_KEY_PREFIX,
  generateApiKey,
  hashApiKey,
  isApiKeyFormat,
} from "@/lib/api-key";

describe("SDK API keys", () => {
  it("generates keys in the sl_<40 hex> format", () => {
    for (let i = 0; i < 50; i++) {
      const { plaintext, prefix, hash } = generateApiKey();
      assert.ok(plaintext.startsWith(API_KEY_PREFIX));
      assert.ok(isApiKeyFormat(plaintext), plaintext);
      assert.equal(plaintext.length, 3 + 40);
      assert.equal(prefix, plaintext.slice(0, 11));
      assert.equal(hash.length, 64);
      assert.equal(hash, hashApiKey(plaintext));
    }
  });

  it("produces distinct keys", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateApiKey().plaintext);
    assert.equal(seen.size, 200);
  });

  it("hash is deterministic and one-way in shape", () => {
    const a = hashApiKey("sl_" + "a".repeat(40));
    const b = hashApiKey("sl_" + "a".repeat(40));
    const c = hashApiKey("sl_" + "b".repeat(40));
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it("rejects malformed key strings", () => {
    assert.equal(isApiKeyFormat("sk_1234"), false);
    assert.equal(isApiKeyFormat("sl_short"), false);
    assert.equal(isApiKeyFormat("sl_" + "A".repeat(40)), false); // uppercase
    assert.equal(isApiKeyFormat(""), false);
  });
});
