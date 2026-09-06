"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";

type Provider = "github" | "google";

const LABELS: Record<Provider, string> = {
  github: "Continue with GitHub",
  google: "Continue with Google",
};

export function SocialButtons({
  providers,
  callbackURL = "/dashboard",
}: {
  providers: Provider[];
  callbackURL?: string;
}) {
  const [busy, setBusy] = useState<Provider | null>(null);
  if (providers.length === 0) return null;

  return (
    <div className="space-y-2">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(provider);
            await authClient.signIn.social({ provider, callbackURL });
          }}
          className="flex w-full items-center justify-center gap-2 rounded-sm border border-border bg-surface px-4 py-2 text-sm font-medium text-fg transition-slens hover:bg-surface-2 disabled:opacity-50"
        >
          {busy === provider ? "Redirecting…" : LABELS[provider]}
        </button>
      ))}
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
