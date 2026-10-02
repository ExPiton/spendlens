"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/Button";

type Provider = "github" | "google";
const LABELS: Record<Provider, string> = { github: "GitHub", google: "Google" };

interface LinkedAccount {
  id: string;
  providerId: string;
  accountId: string;
}

export function ConnectedAccounts({ providers }: { providers: Provider[] }) {
  const [accounts, setAccounts] = useState<LinkedAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    authClient.listAccounts().then(({ data }) => {
      if (!cancelled) setAccounts((data as LinkedAccount[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (providers.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">Connected accounts</h2>
        <p className="mt-1 text-xs text-muted">
          Signing in with Google or GitHub isn&rsquo;t available here yet. You sign in with your email and password.
          {process.env.NODE_ENV !== "production" && (
            <>
              {" "}
              (Developers: set <code className="font-mono">GITHUB_*</code> / <code className="font-mono">GOOGLE_*</code>{" "}
              client id + secret to enable it.)
            </>
          )}
        </p>
      </div>
    );
  }

  const byProvider = new Map((accounts ?? []).map((a) => [a.providerId, a]));
  const hasPassword = byProvider.has("credential");
  const socialCount = providers.filter((p) => byProvider.has(p)).length;

  return (
    <div className="rounded-md border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold">Connected accounts</h2>
      <p className="mt-1 text-xs text-muted">
        Sign in with any linked method. They all share this one account.
      </p>

      {msg && (
        <p role="status" className="mt-2 text-xs text-signal">
          {msg}
        </p>
      )}

      <ul className="mt-3 divide-y divide-border border-t border-border">
        {providers.map((provider) => {
          const acct = byProvider.get(provider);
          const canUnlink = !!acct && (hasPassword || socialCount > 1);
          return (
            <li
              key={provider}
              className="flex items-center justify-between py-2.5 text-xs"
            >
              <span className="font-medium text-fg">
                {LABELS[provider]}
                {acct && <span className="ml-2 text-signal">· linked</span>}
              </span>
              {acct ? (
                // A plain button, not <Button>: that one sets pointer-events: none
                // when disabled, which would also kill the tooltip that says why.
                <button
                  type="button"
                  disabled={!canUnlink || busy !== null}
                  title={
                    canUnlink
                      ? undefined
                      : "Set a password first. This is your only way to sign in."
                  }
                  onClick={async () => {
                    setBusy(provider);
                    setMsg(null);
                    const { error } = await authClient.unlinkAccount({
                      accountId: acct.id,
                    });
                    setBusy(null);
                    if (error) setMsg(error.message ?? "Could not unlink.");
                    else {
                      setMsg(`${LABELS[provider]} unlinked.`);
                      setReloadKey((k) => k + 1);
                    }
                  }}
                  className="rounded-xs border border-border px-2.5 py-1 text-muted transition-slens hover:border-critical hover:text-critical active:scale-[0.98] disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted disabled:active:scale-100"
                >
                  Unlink
                </button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(provider);
                    await authClient.linkSocial({
                      provider,
                      callbackURL: "/dashboard/settings",
                    });
                  }}
                >
                  {busy === provider ? "Redirecting…" : "Link"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
