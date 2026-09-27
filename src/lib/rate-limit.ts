import { NextResponse } from "next/server";

/**
 * A fixed-window rate limiter. One counter per key per window; when the
 * window rolls over the counter resets.
 *
 * Two stores:
 *   - memory (default): per-process — right for the single-container Docker
 *     deployment. Behind N instances the effective limit would be N×.
 *   - postgres (`RATE_LIMIT_STORE=postgres`): one shared counter per key in
 *     the `rate_limit` table, a single atomic upsert per request — correct
 *     across any number of instances, no extra infrastructure.
 * Call sites only use `enforceRateLimit()`, whichever store is active.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

/** Drop expired buckets occasionally so the map can't grow without bound. */
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
  /** Seconds until reset — for the `Retry-After` header on a 429. */
  retryAfter: number;
}

/**
 * @param key      Caller identity — an API-key id, user id, or IP. Namespaced
 *                 by the caller (e.g. `"ingest:<keyId>"`).
 * @param limit    Max requests allowed per window.
 * @param windowMs Window length in ms (default 60s).
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;

  const remaining = Math.max(0, limit - b.count);
  return {
    ok: b.count <= limit,
    limit,
    remaining,
    resetAt: b.resetAt,
    retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
  };
}

/** Standard rate-limit headers for any response (200 or 429). */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    "x-ratelimit-limit": String(r.limit),
    "x-ratelimit-remaining": String(r.remaining),
    "x-ratelimit-reset": String(Math.ceil(r.resetAt / 1000)),
  };
  if (!r.ok) h["retry-after"] = String(r.retryAfter);
  return h;
}

/** Best-effort client IP from the usual proxy headers. */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Enforce a limit for `key` in one call. Returns a 429 `NextResponse` when the
 * caller is over budget, otherwise `{ headers }` to spread onto the real
 * response so clients can see their remaining budget.
 */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
): Promise<{ response: NextResponse } | { headers: Record<string, string> }> {
  const r =
    process.env.RATE_LIMIT_STORE === "postgres"
      ? await rateLimitPostgres(key, limit, windowMs).catch((err) => {
          // A limiter outage must not become an API outage.
          console.error("[spendlens] postgres rate limiter failed, using memory:", err);
          return rateLimit(key, limit, windowMs);
        })
      : rateLimit(key, limit, windowMs);
  const headers = rateLimitHeaders(r);
  if (r.ok) return { headers };
  return {
    response: NextResponse.json(
      { error: "Rate limit exceeded. Slow down and retry after the window resets." },
      { status: 429, headers },
    ),
  };
}

/** Shared-store variant: one atomic upsert — increments within the current
 *  window, or starts a new window when the stored one has expired. */
async function rateLimitPostgres(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const resetAt = new Date(Date.now() + windowMs);
  const [row] = await db.execute<{ count: number; resetAt: string | Date }>(sql`
    insert into "rate_limit" ("key", "count", "resetAt") values (${key}, 1, ${resetAt.toISOString()}::timestamptz)
    on conflict ("key") do update set
      "count"   = case when "rate_limit"."resetAt" <= now() then 1 else "rate_limit"."count" + 1 end,
      "resetAt" = case when "rate_limit"."resetAt" <= now() then excluded."resetAt" else "rate_limit"."resetAt" end
    returning "count", "resetAt"
  `);
  const now = Date.now();
  const reset = new Date(row.resetAt).getTime();
  return {
    ok: row.count <= limit,
    limit,
    remaining: Math.max(0, limit - row.count),
    resetAt: reset,
    retryAfter: Math.max(1, Math.ceil((reset - now) / 1000)),
  };
}
