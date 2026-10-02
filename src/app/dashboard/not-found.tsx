import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";

/** `notFound()` inside the dashboard (an unknown agent slug, say) — rendered
 *  inside the dashboard layout, so the navigation stays put. */
export default function DashboardNotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="font-mono text-sm text-muted">404</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Not found in your account</h1>
      <p className="mt-3 text-sm text-muted">
        There&rsquo;s no agent, key or record at this address. It may have been deleted or renamed, or it belongs to
        another account.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/dashboard/agents" className={buttonClasses("primary")}>
          Your agents
        </Link>
        <Link href="/dashboard" className={buttonClasses("secondary")}>
          Overview
        </Link>
      </div>
    </div>
  );
}
