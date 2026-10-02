import Link from "next/link";
import { LinkButton } from "@/components/ui/Button";

export function FinalCta() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="theme-dark relative overflow-hidden rounded-2xl bg-bg px-8 py-16 text-fg sm:px-14">
          <div
            aria-hidden="true"
            className="absolute -top-32 -right-24 size-[28rem] rounded-full bg-[radial-gradient(closest-side,oklch(0.8_0.16_145/0.22),transparent)]"
          />
          <div className="relative max-w-2xl">
            <h2 className="text-3xl leading-tight font-semibold tracking-[-0.025em] sm:text-[2.6rem]">
              Put a policy between your agents and their wallets.
            </h2>
            <p className="mt-5 max-w-lg text-muted">
              Free to start. Register an agent, paste one snippet, and watch its first decisions arrive.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
              <LinkButton href="/signup" className="px-5 py-3">
                Get started free
              </LinkButton>
              <Link href="/login" className="text-sm font-medium text-fg/80 hover:text-fg">
                Sign in <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
