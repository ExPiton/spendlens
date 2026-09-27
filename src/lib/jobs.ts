import "server-only";
import { reconcileAll, withJobLock } from "@/lib/reconcile";
import { expireStaleEscalations } from "@/lib/db/escalations";
import { anchorDigests, sealDigests } from "@/lib/digest";

/**
 * Background work that makes the security properties hold without anyone
 * clicking a button:
 *
 *   - reconcile  (every RECONCILE_INTERVAL_MINUTES, default 10): keyless
 *     Gateway reconciliation for every agent with a wallet → auto-halt +
 *     alert on unrecorded on-chain spend.
 *   - digest     (every DIGEST_INTERVAL_MINUTES, default 60): seal the
 *     previous UTC days' ledger digests, anchor them on Arc if configured.
 *   - housekeeping: persist `expired` on escalations past their deadline.
 *
 * Runs in-process in the Node server (started from `instrumentation.ts`);
 * each job takes a cluster-wide advisory lock, so every replica can run the
 * scheduler safely. Platforms without a long-lived process can instead call
 * `POST /api/cron/run` with `Authorization: Bearer $CRON_SECRET`.
 */

export interface JobStatus {
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
}

const status: Record<"reconcile" | "digest", JobStatus> = {
  reconcile: { lastRunAt: null, lastOkAt: null, lastError: null },
  digest: { lastRunAt: null, lastOkAt: null, lastError: null },
};
export const jobStatus = () => status;

async function track(name: keyof typeof status, fn: () => Promise<unknown>): Promise<void> {
  status[name].lastRunAt = new Date().toISOString();
  try {
    await fn();
    status[name].lastOkAt = status[name].lastRunAt;
    status[name].lastError = null;
  } catch (err) {
    status[name].lastError = err instanceof Error ? err.message : String(err);
    console.error(`[spendlens] job ${name} failed:`, err);
  }
}

export async function runReconcileJob(): Promise<void> {
  await track("reconcile", async () => {
    await reconcileAll();
    await expireStaleEscalations();
  });
}

export async function runDigestJob(): Promise<void> {
  await track("digest", async () => {
    await withJobLock("spendlens_digest", async () => {
      await sealDigests();
      await anchorDigests();
    });
  });
}

let started = false;

export function startScheduler(): void {
  if (started || process.env.JOBS_DISABLED === "true") return;
  started = true;

  const minutes = (name: string, fallback: number) => {
    const v = Number(process.env[name] ?? fallback);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const every = (mins: number, job: () => Promise<void>, firstDelayMs: number) => {
    if (mins <= 0) return;
    const first = setTimeout(() => void job(), firstDelayMs);
    first.unref?.();
    const t = setInterval(() => void job(), mins * 60_000);
    t.unref?.();
  };

  // Staggered first runs so boot (migrations, first requests) isn't crowded.
  every(minutes("RECONCILE_INTERVAL_MINUTES", 10), runReconcileJob, 30_000);
  every(minutes("DIGEST_INTERVAL_MINUTES", 60), runDigestJob, 90_000);
  console.log("[spendlens] background jobs scheduled (reconcile, digest)");
}
