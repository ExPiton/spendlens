import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { buttonClasses } from "@/components/ui/Button";

export const metadata = { title: "Page not found" };

/**
 * Rendered for unknown URLs and for `notFound()` anywhere in the app — so it
 * stays neutral: no landing nav, and the colours come from the surrounding
 * theme (light on the public site, dark inside the dashboard).
 */
export default function NotFound() {
  return (
    <main
      id="main"
      className="flex min-h-[70vh] flex-col items-center justify-center bg-bg px-6 py-24 text-center text-fg"
    >
      <Link href="/" aria-label="Spendlens home" className="mb-10 inline-flex">
        <Logo size={26} />
      </Link>
      <p className="font-mono text-sm text-muted">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">This page doesn&rsquo;t exist</h1>
      <p className="mt-3 max-w-md text-sm text-muted">
        The link may be outdated, or the agent, key or record it pointed to was removed.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/dashboard" className={buttonClasses("primary")}>
          Go to the dashboard
        </Link>
        <Link href="/" className={buttonClasses("secondary")}>
          Spendlens home
        </Link>
      </div>
    </main>
  );
}
