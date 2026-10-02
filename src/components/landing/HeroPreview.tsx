import { Mark } from "@/components/brand/Mark";

type Tone = "signal" | "critical" | "held";

const ROWS: { payee: string; reason: string; amount: string; tone: Tone; label: string }[] = [
  { payee: "api.example.io/v1/data", reason: "Allowlisted payee", amount: "0.003000", tone: "signal", label: "Paid" },
  { payee: "0x8f3a…7f80", reason: "Not on the allowlist", amount: "0.004000", tone: "critical", label: "Blocked" },
  { payee: "feed.newsource.io/v1/records", reason: "First payment to this payee", amount: "0.012000", tone: "held", label: "Held" },
  { payee: "api.example.io/v1/data", reason: "Paid, but the response came back empty", amount: "0.003000", tone: "signal", label: "Paid" },
];

const BADGE: Record<Tone, string> = {
  signal: "bg-signal/12 text-signal ring-signal/25",
  critical: "bg-critical/12 text-critical ring-critical/30",
  held: "bg-held/12 text-held ring-held/30",
};

/**
 * The product, above the fold: one agent's live decision stream inside an
 * app window, with the approval it is waiting on floating over it.
 * Decorative — the hero copy says the same thing in words.
 */
export function HeroPreview() {
  return (
    <div aria-hidden="true" translate="no" className="relative mx-auto w-full max-w-xl lg:max-w-none">
      {/* Soft signal-green glow behind the window. */}
      <div className="absolute -inset-x-8 -inset-y-10 -z-10 rounded-[48px] bg-[radial-gradient(55%_55%_at_55%_45%,oklch(0.8_0.16_145/0.22),transparent_72%)] blur-2xl" />

      <div className="theme-dark shadow-window overflow-hidden rounded-xl border border-border bg-bg text-fg">
        {/* Window header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Mark size={18} />
            <span className="text-sm font-medium">research-crawler-01</span>
            <span className="inline-flex items-center gap-1.5 rounded-xs bg-signal/12 px-1.5 py-0.5 text-[11px] font-medium text-signal ring-1 ring-signal/25 ring-inset">
              <span className="size-1.5 rounded-full bg-signal" />
              Active
            </span>
          </div>
          <span className="hidden font-mono text-[11px] text-muted sm:inline">Policy rev 4</span>
        </div>

        {/* Today at a glance */}
        <dl className="grid grid-cols-3 divide-x divide-border border-b border-border">
          {[
            ["Spent today", "13.62", "USDC", "text-fg"],
            ["Blocked", "7", "payments", "text-critical"],
            ["Awaiting you", "1", "approval", "text-held"],
          ].map(([label, value, unit, tone]) => (
            <div key={label} className="px-4 py-4 sm:px-5">
              <dt className="text-[11px] text-muted">{label}</dt>
              <dd className="mt-1 flex items-baseline gap-1.5">
                <span className={`font-mono text-lg tabular sm:text-xl ${tone}`}>{value}</span>
                <span className="hidden text-[11px] text-muted sm:inline">{unit}</span>
              </dd>
            </div>
          ))}
        </dl>

        {/* Decision stream */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 text-[11px] text-muted">
          <span>Latest payments</span>
          <span>Amount (USDC)</span>
        </div>
        <ul className="divide-y divide-border">
          {ROWS.map((r, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto_4.25rem] items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5">
              <div className="min-w-0">
                <p className="truncate font-mono text-[13px]">{r.payee}</p>
                <p className="mt-0.5 truncate text-xs text-muted">{r.reason}</p>
              </div>
              <span className="font-mono text-[13px] tabular">{r.amount}</span>
              <span
                className={`justify-self-end rounded-xs px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${BADGE[r.tone]}`}
              >
                {r.label}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between border-t border-border bg-surface px-5 py-3 text-[11px] text-muted">
          <span>Checked before signing</span>
          <span>Example data</span>
        </div>
      </div>

      {/* The approval the agent is waiting on */}
      <div className="shadow-float absolute -bottom-36 -left-6 hidden w-72 rounded-lg border border-border bg-surface p-4 text-fg sm:block xl:-left-16">
        <p className="flex items-center gap-2 text-xs font-medium">
          <span className="size-2 rounded-full bg-held" />
          Approval needed
        </p>
        <p className="mt-2 text-sm leading-snug">
          <span className="font-medium">research-crawler-01</span> wants to pay{" "}
          <span className="font-mono">0.012 USDC</span> to a payee it has never paid.
        </p>
        <div className="mt-3 flex gap-2">
          <span className="rounded-sm bg-fg px-3 py-1.5 text-xs font-medium text-bg">Approve</span>
          <span className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium">Deny</span>
        </div>
      </div>
    </div>
  );
}
