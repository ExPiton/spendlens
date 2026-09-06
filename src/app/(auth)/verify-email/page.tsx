import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getOptionalUser } from "@/lib/auth/dal";
import { AuthHeading } from "@/components/auth/ui";
import { VerifyEmailPanel } from "@/components/auth/VerifyEmailPanel";

export const metadata = { title: "Verify your email · Spendlens" };

export default async function VerifyEmailPage() {
  const session = await getOptionalUser();
  if (session?.user.emailVerified) redirect("/dashboard");

  return (
    <div>
      <AuthHeading title="Verify your email" />
      <Suspense fallback={<div className="h-56" />}>
        <VerifyEmailPanel fallbackEmail={session?.user.email} />
      </Suspense>
    </div>
  );
}
