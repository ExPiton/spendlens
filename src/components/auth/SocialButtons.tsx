"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";

type Provider = "github" | "google";

const LABELS: Record<Provider, string> = {
  github: "Continue with GitHub",
  google: "Continue with Google",
};

function ProviderIcon({ provider }: { provider: Provider }) {
  if (provider === "github") {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

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
            await authClient.signIn.social({
              provider,
              callbackURL,
              errorCallbackURL: "/login?error=oauth",
            });
          }}
          className="flex w-full items-center justify-center gap-2.5 rounded-sm border border-border bg-surface px-4 py-2 text-sm font-medium text-fg transition-slens hover:bg-surface-2 disabled:opacity-50"
        >
          <ProviderIcon provider={provider} />
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
