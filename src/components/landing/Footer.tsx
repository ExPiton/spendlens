import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

/** What the service never does — worded for the hosted product: the SDK may
 *  run a signer inside YOUR agent, but no key ever reaches Spendlens. */
const NEVER = [
  "Hold your agents' private keys",
  "Take custody of your funds",
  "Move money on your behalf",
];

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-[1.2fr_1fr]">
          <div>
            <Logo size={24} />
            <p className="mt-4 max-w-sm text-sm text-muted">
              Spend controls and an audit trail for AI agents that pay on Arc.
              Built to work alongside Circle&rsquo;s payment rail, not to
              replace it.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium">What Spendlens never does</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {NEVER.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-fg" aria-hidden="true">
                    ×
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Spendlens</span>
          <nav aria-label="Account" className="flex gap-3">
            <Link href="/login" className="rounded-sm px-2 py-1.5 transition-slens hover:text-fg">
              Sign in
            </Link>
            <Link href="/signup" className="rounded-sm px-2 py-1.5 transition-slens hover:text-fg">
              Get started free
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
