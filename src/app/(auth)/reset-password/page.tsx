import { Suspense } from "react";
import { AuthHeading } from "@/components/auth/ui";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { redirectIfSignedIn } from "@/lib/auth/dal";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  await redirectIfSignedIn();
  return (
    <div>
      <AuthHeading title="Choose a new password" />
      <Suspense fallback={<div className="h-56" />}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
