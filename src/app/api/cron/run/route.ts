import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDigestJob, runReconcileJob, jobStatus } from "@/lib/jobs";

/**
 * External trigger for the background jobs, for platforms without a
 * long-lived server process (or as a belt-and-braces cron next to the
 * in-process scheduler — the jobs take cluster-wide locks, so overlap is
 * harmless). `Authorization: Bearer $CRON_SECRET`; disabled when unset.
 */
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const job = url.searchParams.get("job");
  if (!job || job === "reconcile") await runReconcileJob();
  if (!job || job === "digest") await runDigestJob();
  return NextResponse.json({ success: true, jobs: jobStatus() });
}
