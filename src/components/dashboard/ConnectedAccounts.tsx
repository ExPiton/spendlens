"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";

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
          Google / GitHub sign-in isn&apos;t configured on this deployment. Set the
          <code className="mx-1 font-mono">*_CLIENT_ID</code>/
          <code className="mx-1 font-mono">*_CLIENT_SECRET</code> env vars to enable it.
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
        Sign in with any linked method — they all share this one account.
      </p>

      {msg && <p className="mt-2 text-xs text-signal">{msg}</p>}

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
                <button
                  type="button"
                  disabled={!canUnlink || busy !== null}
                  title={
                    canUnlink
                      ? undefined
                      : "Set a password first — this is your only way to sign in."
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
                  className="rounded-xs border border-border px-2.5 py-1 text-muted transition-slens hover:border-critical hover:text-critical disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted"
                >
                  Unlink
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(provider);
                    await authClient.linkSocial({
                      provider,
                      callbackURL: "/dashboard/settings",
                    });
                  }}
                  className="rounded-xs bg-fg px-2.5 py-1 font-medium text-bg transition-slens hover:opacity-85 disabled:opacity-50"
                >
                  {busy === provider ? "Redirecting…" : "Link"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
