import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { enabledSocialProviders } from "@/lib/auth";
import { AccountSettings } from "@/components/dashboard/AccountSettings";
import { ConnectedAccounts } from "@/components/dashboard/ConnectedAccounts";
import { DangerZone } from "@/components/dashboard/DangerZone";

export const metadata = { title: "Account settings · Spendlens" };

export default async function SettingsPage() {
  const { user } = await requireUser();

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div className="border-b border-border pb-6">
        <Link href="/dashboard" className="text-xs text-muted hover:text-fg">
          ← Dashboard
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Account</h1>
        <p className="mt-1 text-xs text-muted">{user.email}</p>
      </div>

      <AccountSettings
        name={user.name}
        email={user.email}
        emailVerified={user.emailVerified}
      />

      <ConnectedAccounts providers={enabledSocialProviders} />

      <DangerZone />
    </div>
  );
}
