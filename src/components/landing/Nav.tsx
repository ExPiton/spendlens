import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { LinkButton } from "@/components/ui/Button";

const LINKS = [
  { href: "#problem", label: "Why Spendlens" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Controls" },
  // Not "Dashboard": next to Sign in, that reads as a link into the app.
  { href: "#preview", label: "Preview" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <Link href="/" aria-label="Spendlens home" className="shrink-0">
          <Logo size={26} />
        </Link>
        <nav aria-label="Page sections" className="hidden items-center gap-6 text-sm text-muted md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-sm px-2 py-2 transition-slens hover:text-fg">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-1 sm:gap-3">
          {/* A signed-in visitor lands on /login and is sent straight to the dashboard. */}
          <Link href="/login" className="rounded-sm px-2.5 py-2 text-sm text-muted transition-slens hover:text-fg">
            Sign in
          </Link>
          {/* One wrapper: the button is a flex row with a gap, which would split "Get started" from " free". */}
          <LinkButton href="/signup" className="text-[13px]">
            <span>
              Get started<span className="hidden sm:inline"> free</span>
            </span>
          </LinkButton>
        </div>
      </div>
    </header>
  );
}
