import type { ReactNode } from "react";
import type { Viewport } from "next";
import { requireVerifiedUser } from "@/lib/auth/dal";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { ARC } from "@/lib/arc";
import { countPendingEscalations } from "@/lib/db/escalations";

/** The dashboard is always dark (`theme-dark` below), so its browser chrome is too. */
export const viewport: Viewport = {
  themeColor: "#121813",
};

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = await requireVerifiedUser();
  const pendingApprovals = await countPendingEscalations(user.id).catch(() => 0);

  return (
    <div className="theme-dark min-h-dvh bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-sm focus:bg-fg focus:px-3 focus:py-2 focus:text-sm focus:text-bg"
      >
        Skip to content
      </a>
      <DashboardNav
        userName={user.name}
        userEmail={user.email}
        arcLabel={`Arc ${ARC.network === "mainnet" ? "Mainnet" : "Testnet"} · ${ARC.chainId}`}
        pendingApprovals={pendingApprovals}
      />
      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
