const COMPONENTS = [
  {
    n: "1",
    title: "Interception layer",
    body: "A thin library that wraps the agent's HTTP client. When a 402 response comes back, it hands control to the policy engine before the payment authorization is signed.",
  },
  {
    n: "2",
    title: "Declarative policy engine",
    body: "Rules aren't hardcoded; they live in a separate YAML file. Budgets, call limits, counterparty controls, anomaly thresholds.",
  },
  {
    n: "3",
    title: "Append-only event ledger",
    body: "Every authorization is logged — allowed and blocked alike. Records are immutable; only new rows get added.",
  },
  {
    n: "4",
    title: "Quality and waste analysis",
    body: "Every payment record is matched against the quality of the response it paid for: status code, body, schema conformance, latency.",
  },
  {
    n: "5",
    title: "Arc reconciliation audit",
    body: "On-chain settlement records are compared against the local ledger. A mismatch is an early signal of key leakage or a rounding error.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <p className="text-xs font-medium tracking-[0.14em] text-muted uppercase">
            How it works
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Five components, one interception point.
          </h2>
          <p className="mt-4 text-muted">
            Integration is one line:{" "}
            <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">pay.fetch(url, init)</code>{" "}
            and your existing agent is under guard.
          </p>
        </div>

        <ol className="mt-14 space-y-0">
          {COMPONENTS.map((c, i) => (
            <li key={c.n} className="flex gap-6 border-t border-border py-6 first:border-t-0 sm:gap-10">
              <span className="w-6 shrink-0 font-mono text-sm text-muted">{c.n}</span>
              <div>
                <h3 className="font-semibold">{c.title}</h3>
                <p className="mt-1.5 max-w-xl text-sm text-muted">{c.body}</p>
              </div>
              <span className="ml-auto hidden shrink-0 self-center font-mono text-xs text-muted sm:block">
                {String(i + 1).padStart(2, "0")} / 05
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
