import { Mark } from "@/components/brand/Mark";
import { LinkButton } from "@/components/ui/Button";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute top-1/2 right-[-14rem] hidden -translate-y-1/2 text-ink opacity-[0.05] sm:block dark:text-paper">
        <Mark size={620} monochrome />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-24 sm:pt-28 sm:pb-32">
        <p className="text-xs font-medium tracking-[0.14em] text-muted uppercase">
          Agent spend oversight on Arc
        </p>
        <h1 className="mt-5 max-w-3xl text-4xl leading-[1.1] font-semibold tracking-tight sm:text-6xl">
          Circle built the payment rail. We show you what&rsquo;s actually
          happening on it.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Spendlens screens every micropayment your AI agents make on Arc
          through a policy filter before it settles, logs the decision, and
          checks the quality of what came back against on-chain
          reconciliation.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <LinkButton href="/dashboard">View the dashboard</LinkButton>
          <LinkButton href="#how-it-works" variant="secondary">
            How it works
          </LinkButton>
        </div>

        <dl className="mt-16 grid max-w-2xl grid-cols-2 gap-x-8 gap-y-6 border-t border-border pt-8 sm:grid-cols-3">
          {[
            ["0.000001 USDC", "smallest supported payment"],
            ["3 classes", "of reconciliation mismatch"],
            ["5 components", "interception to reconciliation"],
          ].map(([value, label]) => (
            <div key={label}>
              <dt className="font-mono text-lg tabular">{value}</dt>
              <dd className="mt-1 text-sm text-muted">{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
