import type { DigestView } from "@/lib/digest";

/**
 * The ledger's tamper-evidence, made visible: each sealed UTC day's hash-
 * chained digest, re-verified against the live ledger on every render, with
 * the Arc transaction that anchors it when anchoring is configured.
 */
export function LedgerIntegrity({
  digests,
  explorerUrl,
}: {
  digests: DigestView[];
  explorerUrl: string;
}) {
  const broken = digests.filter((d) => !d.verified);
  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <div className="flex flex-col gap-1 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Ledger integrity</h3>
          <p className="mt-0.5 max-w-3xl text-xs text-muted">
            The ledger is append-only in the database. Each day&apos;s rows are also sealed into a
            SHA-256 hash chain — changing any past row breaks that day&apos;s digest and every one after
            it. Anchored digests are written on Arc, outside this server&apos;s control.
          </p>
        </div>
        <span
          className={`font-mono text-xs font-semibold ${broken.length ? "text-critical" : "text-signal"}`}
        >
          {digests.length === 0
            ? "first digest seals after the first full UTC day"
            : broken.length
              ? `${broken.length} digest(s) do NOT match the ledger`
              : `${digests.length} day(s) verified`}
        </span>
      </div>
      {digests.length > 0 && (
        <ul className="mt-3 divide-y divide-border/50 text-xs">
          {digests.slice(0, 7).map((d) => (
            <li key={d.day} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-mono">
                {d.day} · {d.rowCount} rows ·{" "}
                <span className={d.verified ? "text-signal" : "text-critical font-bold"}>
                  {d.verified ? "verified" : "MISMATCH"}
                </span>
              </span>
              <span className="font-mono text-[11px] text-muted break-all">
                {d.digest.slice(0, 20)}…
                {d.anchorTxHash ? (
                  <>
                    {" "}·{" "}
                    <a
                      href={`${explorerUrl}/tx/${d.anchorTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-signal underline"
                    >
                      anchored on Arc
                    </a>
                  </>
                ) : (
                  " · not anchored"
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
