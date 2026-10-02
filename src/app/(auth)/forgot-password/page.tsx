import { AuthHeading } from "@/components/auth/ui";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { redirectIfSignedIn } from "@/lib/auth/dal";

export const metadata = { title: "Reset password" };

export default async function ForgotPasswordPage() {
  await redirectIfSignedIn();
  return (
    <div>
      <AuthHeading
        title="Reset your password"
        subtitle="We’ll email you a link to choose a new one."
      />
      <ForgotPasswordForm />
    </div>
  );
}
