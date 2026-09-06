"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import { Field, FormError, FormNotice } from "./ui";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });

    setPending(false);
    if (error) {
      setError(error.message || "Something went wrong. Try again.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <FormNotice>
        If an account exists for <strong>{email}</strong>, a reset link is on its way.
        The link expires in one hour.
      </FormNotice>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <FormError>{error}</FormError>
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-sm bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-slens hover:opacity-85 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>
      <p className="text-center text-xs text-muted">
        <Link href="/login" className="underline hover:text-fg">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
