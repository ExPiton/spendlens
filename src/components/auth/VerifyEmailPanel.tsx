"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/Button";
import { FormError, FormNotice } from "./ui";

export function VerifyEmailPanel({ fallbackEmail }: { fallbackEmail?: string }) {
  const params = useSearchParams();
  const email = params.get("email") || fallbackEmail || "";

  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function resend() {
    if (!email) {
      setState("error");
      setMessage("Enter your email on the sign-in page first.");
      return;
    }
    setPending(true);
    const { error } = await authClient.sendVerificationEmail({
      email,
      callbackURL: "/dashboard",
    });
    setPending(false);
    if (error) {
      setState("error");
      setMessage(error.message || "Could not resend. Try again shortly.");
      return;
    }
    setState("sent");
    setMessage(null);
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">
        We sent a verification link to{" "}
        <strong className="text-fg">{email || "your email address"}</strong>. Click it to
        activate your account, then you&rsquo;ll land on the dashboard.
      </p>

      {state === "sent" && <FormNotice>Verification email sent again.</FormNotice>}
      {state === "error" && <FormError>{message}</FormError>}

      <Button type="button" variant="secondary" onClick={resend} disabled={pending} className="w-full bg-surface">
        {pending ? "Sending…" : "Resend verification email"}
      </Button>

      <p className="text-center text-xs text-muted">
        Already verified?{" "}
        <Link href="/dashboard" className="underline transition-slens hover:text-fg">
          Continue to dashboard
        </Link>
        {" · "}
        <Link href="/login" className="underline transition-slens hover:text-fg">
          Sign in
        </Link>
      </p>
    </div>
  );
}
