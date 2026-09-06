"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";
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
        activate your account, then you&apos;ll land on the dashboard.
      </p>

      {state === "sent" && <FormNotice>Verification email sent again.</FormNotice>}
      {state === "error" && <FormError>{message}</FormError>}

      <button
        type="button"
        onClick={resend}
        disabled={pending}
        className="w-full rounded-sm border border-border bg-surface px-4 py-2 text-sm font-medium text-fg transition-slens hover:bg-surface-2 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Resend verification email"}
      </button>

      <p className="text-center text-xs text-muted">
        Already verified?{" "}
        <Link href="/dashboard" className="underline hover:text-fg">
          Continue to dashboard
        </Link>
        {" · "}
        <Link href="/login" className="underline hover:text-fg">
          Sign in
        </Link>
      </p>
    </div>
  );
}
