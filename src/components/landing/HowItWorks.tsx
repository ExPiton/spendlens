const STEPS = [
  {
    title: "Intercept",
    body: "The SDK wraps your agent’s fetch. When a paid API answers 402, the payment is paused before anything is signed.",
  },
  {
    title: "Decide",
    body: "Your policy (budgets, per-call limits, allowlists, anomaly rules) returns allow, hold or block. Change it in the dashboard and running agents pick it up within seconds.",
  },
  {
    title: "Record",
    body: "Every decision lands in an append-only ledger, together with what the payment bought: a good response, an empty one, an error or a timeout.",
  },
  {
    title: "Reconcile",
    body: "Every 10 minutes, what Circle Gateway settled from the agent’s wallet is compared with the ledger. Spend nobody recorded halts the agent.",
  },
];

/** The integration as a developer actually writes it. Lines are kept under
 *  ~56 characters so the longest one fits the figure without scrolling. */
const CODE: { text: string; tone?: "muted" | "accent" }[][] = [
  [{ text: "import", tone: "accent" }, { text: " { guard } " }, { text: "from", tone: "accent" }, { text: ' "@spendlens/sdk";' }],
  [],
  [{ text: "// Reads SPENDLENS_URL and SPENDLENS_API_KEY.", tone: "muted" }],
  [{ text: "// Follows the policy you set in the dashboard.", tone: "muted" }],
  [{ text: "const", tone: "accent" }, { text: " pay = guard({ agentId: " }, { text: '"research-crawler-01"' }, { text: ", signer });" }],
  [],
  [{ text: "// Use it wherever the agent calls a paid API:", tone: "muted" }],
  [{ text: "const", tone: "accent" }, { text: " res = " }, { text: "await", tone: "accent" }, { text: ' pay.fetch("https://api.example.io/v1/data");' }],
];

const TONE = { muted: "text-muted", accent: "text-signal" } as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-16 border-t border-border bg-surface/50">
      <div className="mx-auto max-w-6xl px-6 py-28">
        <div className="max-w-2xl">
          <h2 className="text-3xl leading-tight font-semibold tracking-[-0.025em] sm:text-[2.6rem]">
            One wrapper around fetch. Four checks behind it.
          </h2>
          <p className="mt-5 text-muted">
            Install the SDK, give the agent an API key, and route its paid calls through{" "}
            <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-fg">pay.fetch</code>.
            Nothing else in your agent changes. Using Circle&rsquo;s Gateway client? Wrap it with{" "}
            <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-fg">guardGateway</code>.
          </p>
        </div>

        <div className="mt-16 grid items-start gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <ol className="relative">
            <span aria-hidden="true" className="absolute top-2 bottom-2 left-[15px] w-px bg-border" />
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative flex gap-5 pb-10 last:pb-0">
                <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg font-mono text-xs">
                  {i + 1}
                </span>
                <div className="pt-1">
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <figure translate="no" className="theme-dark shadow-window overflow-hidden rounded-xl border border-border bg-bg text-fg lg:sticky lg:top-28">
            <figcaption className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="flex items-center gap-1.5" aria-hidden="true">
                <span className="size-2.5 rounded-full bg-fg/15" />
                <span className="size-2.5 rounded-full bg-fg/15" />
                <span className="size-2.5 rounded-full bg-fg/15" />
              </span>
              <span className="font-mono text-[11px] text-muted">agent.ts</span>
              <span className="w-10" />
            </figcaption>
            <pre
              tabIndex={0}
              role="region"
              aria-label="Example agent integration"
              className="overflow-x-auto px-5 py-5 font-mono text-[13px] leading-7"
            >
              <code>
                {CODE.map((line, i) => (
                  <span key={i} className="block">
                    {line.length === 0
                      ? " "
                      : line.map((part, j) => (
                          <span key={j} className={part.tone ? TONE[part.tone] : undefined}>
                            {part.text}
                          </span>
                        ))}
                  </span>
                ))}
              </code>
            </pre>
            <div className="flex items-center gap-2 border-t border-border bg-surface px-5 py-3 font-mono text-[11px] text-muted">
              <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
              402 → policy → sign → pay → ledger
            </div>
          </figure>
        </div>
      </div>
    </section>
  );
}
