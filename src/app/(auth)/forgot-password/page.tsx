import { AuthHeading } from "@/components/auth/ui";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata = { title: "Reset password · Spendlens" };

export default function ForgotPasswordPage() {
  return (
    <div>
      <AuthHeading
        title="Reset your password"
        subtitle="We'll email you a link to choose a new one."
      />
      <ForgotPasswordForm />
    </div>
  );
}
