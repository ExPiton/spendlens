"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button, LinkButton } from "@/components/ui/Button";
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
        <LinkButton href="/forgot-password" className="w-full">
          Request new link
        </LinkButton>
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
        name="new-password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={<span className="font-normal">8+ characters</span>}
      />
      <Field
        label="Confirm new password"
        name="confirm-password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
