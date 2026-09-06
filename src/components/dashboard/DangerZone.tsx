"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { clearDataAction, seedDemoDataAction } from "@/app/dashboard/actions";

export function DangerZone() {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">Sample data</h2>
        <p className="mt-1 text-xs text-muted">
          Load or reset the built-in demo dataset (five agents, a 12-day ledger,
          one reconciliation incident).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={seedDemoDataAction}>
            <button
              type="submit"
              className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-2"
            >
              Load / refresh sample data
            </button>
          </form>
          <form action={clearDataAction}>
            <button
              type="submit"
              className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-critical hover:text-critical"
            >
              Clear all my agents &amp; data
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-md border border-critical/40 bg-critical/5 p-5">
        <h2 className="text-sm font-semibold text-critical">Delete account</h2>
        <p className="mt-1 text-xs text-muted">
          Permanently removes your account, agents, keys, policies, and ledger.
          This cannot be undone.
        </p>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="mt-3 rounded-sm border border-critical px-3 py-1.5 text-xs font-semibold text-critical hover:bg-critical hover:text-paper"
          >
            Delete my account
          </button>
        ) : (
          <form
            className="mt-3 space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              const { error } = await authClient.deleteUser({ password });
              if (error) {
                setErr(error.message || "Could not delete account.");
                return;
              }
              router.push("/");
              router.refresh();
            }}
          >
            <input
              type="password"
              placeholder="Confirm with your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-critical"
            />
            {err && <p className="text-xs text-critical">{err}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                className="rounded-sm bg-critical px-3 py-1.5 text-xs font-semibold text-paper"
              >
                Permanently delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-sm border border-border px-3 py-1.5 text-xs text-muted"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
