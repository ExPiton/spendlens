const SCENARIOS = [
  {
    id: "A",
    title: "Prompt injection",
    body: "A research agent crawls a page carrying a hidden instruction. It redirects the agent to an address the attacker controls; since no single call exceeds the per-call limit, nothing ever raises an alarm.",
  },
  {
    id: "B",
    title: "Silent quality degradation",
    body: "The agent's data provider breaks and starts returning empty response bodies. Because the HTTP status is still successful, payment keeps flowing uninterrupted — the agent keeps paying for data it can't use.",
  },
  {
    id: "C",
    title: "Key leakage",
    body: "The signing key leaks. The attacker signs authorizations that stay within the existing policy's limits. Wallet policy is never violated, so nobody notices.",
  },
];

export function ProblemSection() {
  return (
    <section id="problem" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            The infrastructure that guarantees a payment went through
            doesn&rsquo;t measure whether it went to the right place for the
            right value.
          </h2>
        </div>

        <blockquote className="mt-10 max-w-2xl border-l-2 border-signal py-1 pl-6 text-xl leading-relaxed text-fg italic">
          &ldquo;You give your kid a debit card and tell the bank
          &lsquo;never let a single withdrawal exceed $50.&rsquo; If the kid
          withdraws $49, two hundred times, the limit is never breached
          — but the account still empties out.&rdquo;
        </blockquote>
        <p className="mt-4 max-w-xl text-sm text-muted">
          A static, per-transaction limit can&rsquo;t solve a behavioral
          problem. Nanopayments generate thousands of authorizations per
          minute — at that volume, what matters isn&rsquo;t the size of any
          single transaction, it&rsquo;s the pattern.
        </p>

        <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
          {SCENARIOS.map((s) => (
            <div key={s.id} className="bg-bg p-6">
              <span className="font-mono text-xs text-muted">Scenario {s.id}</span>
              <h3 className="mt-2 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted">{s.body}</p>
              <p className="mt-4 text-xs font-medium text-critical">
                Undetectable with existing tools
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
