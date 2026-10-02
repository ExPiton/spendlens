import Link from "next/link";
import { enabledSocialProviders } from "@/lib/auth";
import { AuthHeading } from "@/components/auth/ui";
import { SocialButtons, OrDivider } from "@/components/auth/SocialButtons";
import { SignupForm } from "@/components/auth/SignupForm";
import { redirectIfSignedIn } from "@/lib/auth/dal";

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  await redirectIfSignedIn();
  return (
    <div>
      <AuthHeading
        title="Create your account"
        subtitle="Free to start. Connect an agent in minutes."
      />

      {enabledSocialProviders.length > 0 && (
        <>
          <SocialButtons providers={enabledSocialProviders} />
          <OrDivider />
        </>
      )}

      <SignupForm />

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-fg underline underline-offset-2 transition-slens hover:opacity-70">
          Sign in
        </Link>
      </p>
    </div>
  );
}
