import { LinkButton } from "@/components/ui/Button";
import { HeroPreview } from "./HeroPreview";

/** What it plugs into: integrations, not customer logos (there are none to show yet). */
const BUILT_FOR = ["x402 payments", "Circle Gateway Nanopayments", "USDC on Arc", "Node.js & TypeScript"];

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pt-16 pb-28 sm:pt-24 lg:grid-cols-2 lg:pb-36">
        <div className="rise">
          {/* Sized so the headline sets in three lines beside the preview at
              every desktop width; it was four, and five at 1024px. */}
          <h1 className="text-[2.35rem] leading-[1.06] font-semibold tracking-[-0.035em] sm:text-5xl lg:text-[2.7rem] xl:text-5xl">
            Every payment your agents make, checked before it&rsquo;s signed.
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-muted">
            Spendlens sits between your AI agents and their wallets. Budgets, allowlists and anomaly rules run
            on every x402 payment. Risky ones wait for your approval.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
            <LinkButton href="/signup" className="px-5 py-3">
              Get started free
            </LinkButton>
            <a
              href="#how-it-works"
              className="group inline-flex items-center gap-1.5 rounded-sm py-2 text-sm font-medium text-fg"
            >
              See how it works
              <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-0.5">
                →
              </span>
            </a>
          </div>
        </div>

        <div className="rise [animation-delay:120ms]">
          <HeroPreview />
        </div>
      </div>

      <div className="relative border-y border-border bg-surface/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:gap-8">
          <span className="text-xs font-medium text-muted">Built for</span>
          <ul className="flex flex-wrap gap-x-8 gap-y-2 text-sm font-medium text-fg/80">
            {BUILT_FOR.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
