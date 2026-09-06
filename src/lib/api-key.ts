import { createHash, randomBytes } from "node:crypto";

/**
 * Pure helpers for SDK API keys — no DB, no `server-only`, so they can be unit
 * tested and reused. Format: `sl_` + 40 lowercase hex chars. Only the SHA-256
 * hash of the full key is ever persisted.
 */

export const API_KEY_PREFIX = "sl_";
/** Characters shown in the dashboard: `sl_` + first 8 of the random part. */
export const API_KEY_DISPLAY_LEN = 11;

export function isApiKeyFormat(value: string): boolean {
  return new RegExp(`^${API_KEY_PREFIX}[0-9a-f]{40}$`).test(value);
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function generateApiKey(): {
  plaintext: string;
  prefix: string;
  hash: string;
} {
  const plaintext = API_KEY_PREFIX + randomBytes(20).toString("hex");
  return {
    plaintext,
    prefix: plaintext.slice(0, API_KEY_DISPLAY_LEN),
    hash: hashApiKey(plaintext),
  };
}
