import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { LinkButton } from "@/components/ui/Button";

const LINKS = [
  { href: "#problem", label: "Problem" },
  { href: "#how-it-works", label: "How it works" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label="Spendlens home" className="shrink-0">
          <Logo size={26} />
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-muted md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="transition-slens hover:text-fg">
              {l.label}
            </a>
          ))}
        </nav>
        <LinkButton href="/dashboard" className="text-[13px]">
          Dashboard
        </LinkButton>
      </div>
    </header>
  );
}
