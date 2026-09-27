"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Field, FormError } from "./ui";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const oauthError =
    params.get("error") &&
    "Sign-in with that provider didn't complete. Try again or use your email and password.";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const { error } = await authClient.signIn.email({ email, password, callbackURL: next });

    if (error) {
      if (error.code === "EMAIL_NOT_VERIFIED") {
        // Better Auth just re-sent the link (sendOnSignIn).
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }
      setError(error.message || "Could not sign you in. Check your details and try again.");
      setPending(false);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <FormError>{error || oauthError}</FormError>
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={
          <Link href="/forgot-password" className="font-normal text-muted underline hover:text-fg">
            Forgot?
          </Link>
        }
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-sm bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-slens hover:opacity-85 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
