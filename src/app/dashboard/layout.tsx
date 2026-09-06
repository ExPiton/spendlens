import type { ReactNode } from "react";
import { requireVerifiedUser } from "@/lib/auth/dal";
import { DashboardNav } from "@/components/dashboard/DashboardNav";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = await requireVerifiedUser();

  return (
    <div className="theme-dark min-h-screen bg-bg text-fg">
      <DashboardNav userName={user.name} userEmail={user.email} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
