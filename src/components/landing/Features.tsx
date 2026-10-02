/** Sealed days as the dashboard's Ledger integrity panel lists them. */
const DIGESTS = [
  { day: "2026-08-09", rows: "1 204", digest: "7c21e09a41b8" },
  { day: "2026-08-10", rows: "1 388", digest: "e08b4d17c3a5" },
  { day: "2026-08-11", rows: "1 129", digest: "a3f90c52d6e1" },
  { day: "2026-08-12", rows: "1 266", digest: "5d18b7f0924c" },
];

/** An excerpt of a real policy file (see policies/research-crawler-01.yaml). */
const POLICY: { indent: number; key: string; value?: string }[] = [
  { indent: 0, key: "per_call:" },
  { indent: 1, key: "max_usdc:", value: "0.05" },
  { indent: 0, key: "counterparties:" },
  { indent: 1, key: "mode:", value: "allowlist" },
  { indent: 1, key: "first_seen:" },
  { indent: 2, key: "action:", value: "hold" },
];

/** What a team gets beyond the policy check, laid out as an uneven grid: the
 *  two flagship controls first, then the two things you'd audit, then the
 *  promise about custody on its own line. */
export function Features() {
  return (
    <section id="features" className="scroll-mt-16 border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-28">
        <div className="max-w-2xl">
          <h2 className="text-3xl leading-tight font-semibold tracking-[-0.025em] sm:text-[2.6rem]">
            Built for the people who answer for the spend.
          </h2>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-6">
          {/* Approvals: wide, with a miniature of the real flow */}
          <article className="flex flex-col justify-between gap-8 rounded-xl border border-border bg-surface p-7 md:col-span-4">
            <div className="max-w-sm">
              <h3 className="text-lg font-semibold tracking-tight">Approvals for the payments that matter</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                A first payment to a new payee, or an amount over your threshold, waits for a person. Approve or deny
                it from the dashboard. The agent waits, and nothing is signed until you decide.
              </p>
            </div>
            <div aria-hidden="true" className="rounded-lg border border-border bg-bg p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[13px]">feed.newsource.io/v1/records</p>
                  <p className="mt-0.5 text-xs text-muted">market-data-feed-03 · first payment to this payee</p>
                </div>
                <span className="shrink-0 font-mono text-[13px]">0.012 USDC</span>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                <span className="text-xs text-muted">Expires in 1:48</span>
                <span className="flex gap-2">
                  <span className="rounded-sm border border-border px-3 py-1 text-xs font-medium">Deny</span>
                  <span className="rounded-sm bg-fg px-3 py-1 text-xs font-medium text-bg">Approve</span>
                </span>
              </div>
            </div>
          </article>

          {/* Kill switch */}
          <article className="theme-dark flex flex-col justify-between gap-8 rounded-xl border border-border bg-bg p-7 text-fg md:col-span-2">
            <div>
              <h3 className="text-lg font-semibold tracking-tight">A kill switch that works</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Halt an agent from the dashboard. Its next payment is refused before it&rsquo;s signed, and the ledger
                keeps recording.
              </p>
            </div>
            <div aria-hidden="true" className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <span className="text-sm">research-crawler-01</span>
              <span className="rounded-xs bg-critical/10 px-2 py-0.5 text-[11px] font-medium text-critical ring-1 ring-critical/30 ring-inset">
                Halted
              </span>
            </div>
          </article>

          {/* Ledger */}
          <article className="flex flex-col justify-between gap-8 rounded-xl border border-border bg-surface p-7 md:col-span-3">
            <div className="max-w-md">
              <h3 className="text-lg font-semibold tracking-tight">A ledger you can audit</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Every decision is kept: allowed, held and blocked. The database refuses edits and deletes, and each day
                is sealed into a hash chain.
              </p>
            </div>
            <ul
              aria-hidden="true"
              translate="no"
              className="divide-y divide-border rounded-lg border border-border bg-bg font-mono text-xs"
            >
              {DIGESTS.map((d) => (
                <li key={d.day} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="text-muted">{d.day}</span>
                  <span className="hidden text-muted sm:inline">{d.rows} rows</span>
                  <span className="text-muted">{d.digest}&hellip;</span>
                  <span className="text-signal-ink">verified</span>
                </li>
              ))}
            </ul>
          </article>

          {/* Policy as code */}
          <article className="flex flex-col justify-between gap-8 rounded-xl border border-border bg-surface p-7 md:col-span-3">
            <div className="max-w-md">
              <h3 className="text-lg font-semibold tracking-tight">Policy as code</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                One YAML policy per agent, checked against a schema before it&rsquo;s saved and numbered on every
                change.
              </p>
            </div>
            <pre
              aria-hidden="true"
              translate="no"
              className="overflow-hidden rounded-lg border border-border bg-bg px-4 py-3 font-mono text-xs leading-6"
            >
              <code>
                {POLICY.map((line, i) => (
                  <span key={i} className="block whitespace-pre">
                    {"  ".repeat(line.indent)}
                    <span className="text-fg">{line.key}</span>
                    {line.value && <span className="text-signal-ink"> {line.value}</span>}
                  </span>
                ))}
              </code>
            </pre>
          </article>

          {/* Custody: a promise, so it gets its own line instead of a card */}
          <article className="rounded-xl border border-signal/30 bg-signal/10 p-7 md:col-span-6 md:flex md:items-center md:justify-between md:gap-10">
            <h3 className="font-semibold tracking-tight md:shrink-0">Never your keys or funds</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-fg/80 md:mt-0">
              Spendlens sees the payment, not the wallet. Reconciliation needs only the wallet&rsquo;s address.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
