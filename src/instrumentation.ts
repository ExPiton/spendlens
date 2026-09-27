import type { Instrumentation } from "next";

/**
 * Next.js startup hook (Node runtime only):
 *   1. In the Docker image (`RUN_MIGRATIONS_ON_BOOT=true`) apply pending DB
 *      migrations before the server accepts traffic. For local dev, run
 *      `npm run db:migrate` yourself instead.
 *   2. Start the background jobs (Arc reconciliation, ledger digests) —
 *      see `lib/jobs.ts`. `JOBS_DISABLED=true` turns them off.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.RUN_MIGRATIONS_ON_BOOT === "true") {
    const { runMigrations } = await import("@/lib/db/migrate");
    await runMigrations();
  }
  if (process.env.DATABASE_URL && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startScheduler } = await import("@/lib/jobs");
    startScheduler();
  }
}

/**
 * Server error reporting. Every uncaught error in a route, render, action or
 * proxy is logged as one structured JSON line (greppable / shippable by any
 * log collector) and, when `ERROR_WEBHOOK_URL` is set, POSTed there too —
 * e.g. a Sentry/Datadog HTTP intake or a Slack webhook. Request headers are
 * deliberately not forwarded: they carry session cookies and API keys.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const event = {
    level: "error",
    source: "spendlens",
    ts: new Date().toISOString(),
    message: err instanceof Error ? err.message : String(err),
    digest:
      typeof err === "object" && err !== null && "digest" in err
        ? String((err as { digest: unknown }).digest)
        : undefined,
    stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8).join("\n") : undefined,
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
  };
  console.error(JSON.stringify(event));

  const hook = process.env.ERROR_WEBHOOK_URL;
  if (hook) {
    try {
      await fetch(hook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      // reporting must never take the request path down with it
    }
  }
};
