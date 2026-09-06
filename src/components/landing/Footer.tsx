import { Logo } from "@/components/brand/Logo";

const OUT_OF_SCOPE = [
  "Holding or managing private keys",
  "Custody of user funds",
  "Payment facilitation or fund transfer",
  "Wallet generation",
];

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-[1.2fr_1fr]">
          <div>
            <Logo size={24} />
            <p className="mt-4 max-w-sm text-sm text-muted">
              An oversight and observability layer for AI agent spend on
              Arc. A complement to Circle&rsquo;s payment rail — not a
              competitor.
            </p>
          </div>

          <div>
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              Out of scope — deliberately never done
            </p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {OUT_OF_SCOPE.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-critical" aria-hidden="true">
                    ×
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Spendlens · MIT License</span>
          <span>Dashboard: Next.js · Chain access: Arc (EVM-compatible)</span>
        </div>
      </div>
    </footer>
  );
}
