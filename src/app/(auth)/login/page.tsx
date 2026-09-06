import { Suspense } from "react";
import Link from "next/link";
import { enabledSocialProviders } from "@/lib/auth";
import { AuthHeading } from "@/components/auth/ui";
import { SocialButtons, OrDivider } from "@/components/auth/SocialButtons";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata = { title: "Sign in · Spendlens" };

export default function LoginPage() {
  return (
    <div>
      <AuthHeading title="Sign in to Spendlens" subtitle="Oversee your agents' spend." />

      {enabledSocialProviders.length > 0 && (
        <>
          <SocialButtons providers={enabledSocialProviders} />
          <OrDivider />
        </>
      )}

      <Suspense fallback={<div className="h-64" />}>
        <LoginForm />
      </Suspense>

      <p className="mt-6 text-center text-sm text-muted">
        New here?{" "}
        <Link href="/signup" className="font-medium text-fg underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
