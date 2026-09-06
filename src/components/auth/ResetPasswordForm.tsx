"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Field, FormError } from "./ui";

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const linkError = params.get("error");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (linkError || !token) {
    return (
      <div className="space-y-3">
        <FormError>
          This reset link is invalid or has expired. Request a fresh one.
        </FormError>
        <Link
          href="/forgot-password"
          className="block w-full rounded-sm bg-fg px-4 py-2.5 text-center text-sm font-medium text-bg transition-slens hover:opacity-85"
        >
          Request new link
        </Link>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);

    const { error } = await authClient.resetPassword({ newPassword: password, token: token! });

    setPending(false);
    if (error) {
      setError(error.message || "Could not reset your password. The link may have expired.");
      return;
    }
    router.push("/login");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <FormError>{error}</FormError>
      <Field
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Field
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-sm bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-slens hover:opacity-85 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
