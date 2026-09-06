/** Agent-slug rules, shared by the DB layer and its tests. A slug is the
 *  public agent id used in the SDK, policy files, and every contract's
 *  `agentId` field. */

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}
