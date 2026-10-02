"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/Button";

function Row({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-border bg-surface p-5">{children}</div>;
}

export function AccountSettings({
  name,
  email,
  emailVerified,
}: {
  name: string;
  email: string;
  emailVerified: boolean;
}) {
  const router = useRouter();

  const [displayName, setDisplayName] = useState(name);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  return (
    <div className="space-y-4">
      <Row>
        <h2 className="text-sm font-semibold">Profile</h2>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setNameMsg(null);
            setSavingName(true);
            const { error } = await authClient.updateUser({ name: displayName });
            setSavingName(false);
            setNameMsg(error ? error.message || "Could not save." : "Saved.");
            if (!error) router.refresh();
          }}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor="display-name" className="mb-1 block text-xs text-muted">
              Display name
            </label>
            <input
              id="display-name"
              name="name"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="field w-full rounded-sm bg-bg px-3 py-2 text-sm text-fg"
            />
          </div>
          <Button type="submit" disabled={savingName}>
            {savingName ? "Saving…" : "Save"}
          </Button>
        </form>
        {nameMsg && (
          <p role="status" className="mt-2 text-xs text-muted">
            {nameMsg}
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          Email <span className="font-mono text-fg">{email}</span>{" "}
          {emailVerified ? (
            <span className="text-signal">· verified</span>
          ) : (
            <span className="text-held">· unverified</span>
          )}
        </p>
      </Row>

      <Row>
        <h2 className="text-sm font-semibold">Change password</h2>
        <form
          className="mt-3 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setPwErr(null);
            setPwMsg(null);
            if (next.length < 8) {
              setPwErr("New password must be at least 8 characters.");
              return;
            }
            setSavingPw(true);
            const { error } = await authClient.changePassword({
              currentPassword: current,
              newPassword: next,
              revokeOtherSessions: true,
            });
            setSavingPw(false);
            if (error) {
              setPwErr(error.message || "Could not change password.");
              return;
            }
            setPwMsg("Password updated.");
            setCurrent("");
            setNext("");
          }}
        >
          <div>
            <label htmlFor="current-password" className="mb-1 block text-xs text-muted">
              Current password
            </label>
            <input
              id="current-password"
              name="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              className="field w-full rounded-sm bg-bg px-3 py-2 text-sm text-fg"
            />
          </div>
          <div>
            <label htmlFor="new-password" className="mb-1 block text-xs text-muted">
              New password
            </label>
            <input
              id="new-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              aria-describedby="new-password-hint"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
              className="field w-full rounded-sm bg-bg px-3 py-2 text-sm text-fg"
            />
            <p id="new-password-hint" className="mt-1 text-[11px] text-muted">
              8+ characters. Other devices are signed out when you change it.
            </p>
          </div>
          {pwErr && (
            <p role="alert" className="text-xs text-critical">
              {pwErr}
            </p>
          )}
          {pwMsg && (
            <p role="status" className="text-xs text-signal">
              {pwMsg}
            </p>
          )}
          <Button type="submit" disabled={savingPw}>
            {savingPw ? "Updating…" : "Update password"}
          </Button>
        </form>
      </Row>
    </div>
  );
}
