import { Suspense } from "react";
import { AuthHeading } from "@/components/auth/ui";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata = { title: "Choose a new password · Spendlens" };

export default function ResetPasswordPage() {
  return (
    <div>
      <AuthHeading title="Choose a new password" />
      <Suspense fallback={<div className="h-56" />}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
