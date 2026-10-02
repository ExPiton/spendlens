const FAILURES = [
  {
    title: "A prompt injection redirects the agent",
    what: "A page the agent reads tells it to buy from an attacker’s API. Each call costs a fraction of a cent, so no per-payment limit ever trips.",
    fix: "Payees outside your allowlist are blocked, or held until you approve them.",
  },
  {
    title: "A provider quietly breaks",
    what: "The API keeps answering HTTP 200, but with empty bodies. Your agent keeps paying for data it can’t use, and nothing looks wrong.",
    fix: "Every paid response is graded. Wasted spend shows up per agent and per provider.",
  },
  {
    title: "The signing key leaks",
    what: "Someone pays with your agent’s key and stays inside its limits. The wallet’s rules are never broken, so nobody notices.",
    fix: "What settled on Arc is reconciled against your ledger every 10 minutes. Spend nobody recorded halts the agent and alerts you.",
  },
];

export function ProblemSection() {
  return (
    <section id="problem" className="scroll-mt-16">
      <div className="mx-auto grid max-w-6xl gap-14 px-6 py-28 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className="text-sm font-medium text-signal-ink">The problem</p>
          <h2 className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.025em] sm:text-[2.6rem]">
            Per-payment limits can&rsquo;t stop an agent that pays $0.003 a thousand times.
          </h2>
          <p className="mt-6 max-w-md text-muted">
            Agents pay for APIs in thousands of tiny payments. The rail guarantees each one settles. It doesn&rsquo;t
            guarantee the payment went to the right place or bought anything useful. At that volume, the danger is
            in the pattern, not in any single transaction.
          </p>
        </div>

        <ol className="divide-y divide-border border-y border-border">
          {FAILURES.map((f, i) => (
            <li key={f.title} className="grid gap-4 py-8 sm:grid-cols-[3rem_minmax(0,1fr)]">
              <span className="font-mono text-sm text-muted">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3 className="text-lg font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-muted">{f.what}</p>
                <p className="mt-4 flex gap-3 rounded-md bg-surface px-4 py-3 text-sm">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />
                  <span>
                    <span className="font-medium">With Spendlens: </span>
                    {f.fix}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
