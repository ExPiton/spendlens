import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobStatus } from "@/lib/jobs";
import { ARC } from "@/lib/arc";

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

  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (err) {
    // This endpoint is unauthenticated by design (load balancers, uptime
    // checks). The raw driver error can carry host/port/db-name/schema
    // detail — real information disclosure to anyone on the internet who
    // hits it, not just an operator watching a dashboard. Log it
    // server-side instead; the public body only ever says "down".
    console.error("[spendlens] /api/health DB check failed:", err);
  }

  // Last success time only — never the error text (it can name hosts).
  const jobs = jobStatus();
  const body = {
    status: dbOk ? "ok" : "degraded",
    db: dbOk ? "up" : "down",
    arc: { network: ARC.network, chainId: ARC.chainId },
    jobs: {
      reconcile: { lastOkAt: jobs.reconcile.lastOkAt, failing: Boolean(jobs.reconcile.lastError) },
      digest: { lastOkAt: jobs.digest.lastOkAt, failing: Boolean(jobs.digest.lastError) },
    },
    uptimeSeconds: Math.round(process.uptime()),
    latencyMs: Date.now() - startedAt,
    ts: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: dbOk ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
