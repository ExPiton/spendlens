"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { SignOutButton } from "./SignOutButton";

const TABS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/ledger", label: "Ledger" },
  { href: "/dashboard/agents", label: "Agents" },
  { href: "/dashboard/counterparties", label: "Counterparties" },
  { href: "/dashboard/reconciliation", label: "Reconciliation" },
  { href: "/dashboard/approvals", label: "Approvals" },
  { href: "/dashboard/policies", label: "Policies" },
  { href: "/dashboard/anomalies", label: "Anomaly & Rate" },
  { href: "/dashboard/simulator", label: "Simulator" },
];

export function DashboardNav({
  userName,
  userEmail,
  arcLabel,
  pendingApprovals = 0,
}: {
  userName: string;
  userEmail: string;
  arcLabel: string;
  /** Holds waiting for a human — badged on the Approvals tab. */
  pendingApprovals?: number;
}) {
  const pathname = usePathname();
  const initial = (userName || userEmail || "?").charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            aria-label="Spendlens home"
            className="shrink-0 transition-opacity hover:opacity-80"
          >
            <Logo size={24} />
          </Link>
          <div className="hidden h-5 w-px bg-border md:block" />
          <div className="hidden items-center gap-2 rounded-xs border border-signal/20 bg-signal/10 px-2 py-0.5 text-xs text-signal md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden="true" />
            <span className="font-mono font-medium">{arcLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/agents/new"
            className="rounded-xs border border-border px-3 py-1 text-xs font-medium text-fg transition-slens hover:bg-surface-2"
          >
            + New agent
          </Link>
          <Link
            href="/dashboard/settings"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-fg transition-slens hover:opacity-80"
            title={userEmail}
            aria-label={`Account settings (${userEmail})`}
          >
            {initial}
          </Link>
          <SignOutButton />
        </div>
      </div>

      <div className="mx-auto max-w-7xl overflow-x-auto px-4 sm:px-6 scrollbar-none">
        <nav aria-label="Dashboard sections" className="flex gap-1 border-t border-border/50 py-1 text-xs font-medium">
          {TABS.map((tab) => {
            const isActive =
              tab.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(tab.href);

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`whitespace-nowrap rounded-xs px-3 py-2 transition-slens ${
                  isActive
                    ? "bg-surface-2 text-fg font-semibold shadow-xs"
                    : "text-muted hover:bg-surface hover:text-fg"
                }`}
              >
                {tab.label}
                {tab.href === "/dashboard/approvals" && pendingApprovals > 0 && (
                  <span className="ml-1.5 rounded-xs bg-held px-1.5 py-px font-mono text-[10px] font-bold text-ink">
                    {pendingApprovals}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
