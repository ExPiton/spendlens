"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Field, FormError } from "./ui";

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setPending(true);
    setError(null);

    const { error } = await authClient.signUp.email({
      name: name.trim() || email.split("@")[0],
      email,
      password,
      callbackURL: "/dashboard",
    });

    if (error) {
      setError(error.message || "Could not create your account.");
      setPending(false);
      return;
    }
    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <FormError>{error}</FormError>
      <Field
        label="Name"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ada Lovelace"
      />
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
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={<span className="font-normal text-muted/70">8+ characters</span>}
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-sm bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-slens hover:opacity-85 disabled:opacity-50"
      >
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
