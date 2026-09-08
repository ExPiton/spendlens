import { NextResponse } from "next/server";

/**
 * A fixed-window in-process rate limiter. One counter per key per window;
 * when the window rolls over the counter resets.
 *
 * This lives in the server process's memory, so each instance enforces its
 * own budget — correct for the single-container Docker deployment here. Behind
 * a load balancer with N instances the effective limit is N× the configured
 * value; swap this module for a shared store (Redis / Upstash) at that point.
 * The call sites don't change — they only use `rateLimit()`.
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
export function enforceRateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
): { response: NextResponse } | { headers: Record<string, string> } {
  const r = rateLimit(key, limit, windowMs);
  const headers = rateLimitHeaders(r);
  if (r.ok) return { headers };
  return {
    response: NextResponse.json(
      { error: "Rate limit exceeded. Slow down and retry after the window resets." },
      { status: 429, headers },
    ),
  };
}
