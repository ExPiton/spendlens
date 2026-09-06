"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";

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

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Row>
        <h2 className="text-sm font-semibold">Profile</h2>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setNameMsg(null);
            const { error } = await authClient.updateUser({ name: displayName });
            setNameMsg(error ? error.message || "Could not save." : "Saved.");
            if (!error) router.refresh();
          }}
        >
          <label className="flex-1">
            <span className="mb-1 block text-xs text-muted">Display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-signal"
            />
          </label>
          <button
            type="submit"
            className="rounded-sm bg-fg px-3 py-2 text-xs font-medium text-bg hover:opacity-85"
          >
            Save
          </button>
        </form>
        {nameMsg && <p className="mt-2 text-xs text-muted">{nameMsg}</p>}
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
          className="mt-3 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setPwErr(null);
            setPwMsg(null);
            if (next.length < 8) {
              setPwErr("New password must be at least 8 characters.");
              return;
            }
            const { error } = await authClient.changePassword({
              currentPassword: current,
              newPassword: next,
              revokeOtherSessions: true,
            });
            if (error) {
              setPwErr(error.message || "Could not change password.");
              return;
            }
            setPwMsg("Password updated.");
            setCurrent("");
            setNext("");
          }}
        >
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Current password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
            className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-signal"
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="New password (8+ characters)"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-signal"
          />
          {pwErr && <p className="text-xs text-critical">{pwErr}</p>}
          {pwMsg && <p className="text-xs text-signal">{pwMsg}</p>}
          <button
            type="submit"
            className="rounded-sm bg-fg px-3 py-2 text-xs font-medium text-bg hover:opacity-85"
          >
            Update password
          </button>
        </form>
      </Row>
    </div>
  );
}
