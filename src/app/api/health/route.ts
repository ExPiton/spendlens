import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Unauthenticated liveness/readiness probe for load balancers, uptime checks,
 * and the Docker `web` healthcheck. Reports process liveness always; DB
 * reachability is a round-trip `select 1`. 200 when the DB answers, 503 when
 * it doesn't — nothing sensitive is returned either way.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  let dbOk = false;
  let dbError: string | undefined;

  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const body = {
    status: dbOk ? "ok" : "degraded",
    db: dbOk ? "up" : "down",
    ...(dbError ? { dbError } : {}),
    uptimeSeconds: Math.round(process.uptime()),
    latencyMs: Date.now() - startedAt,
    ts: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: dbOk ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
