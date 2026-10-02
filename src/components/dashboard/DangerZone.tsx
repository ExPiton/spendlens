"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { clearDataAction, seedDemoDataAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/Button";

export function DangerZone() {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
            <Button type="submit" variant="secondary" size="sm">
              Load / refresh sample data
            </Button>
          </form>
          {!confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-muted transition-slens hover:border-critical hover:text-critical active:scale-[0.98]"
            >
              Clear all my agents &amp; data
            </button>
          ) : (
            // One click used to wipe every agent, key, policy and ledger row —
            // right next to "Load sample data", with no confirmation.
            <form action={clearDataAction} className="flex flex-wrap items-center gap-2 rounded-sm border border-critical/40 bg-critical/5 px-3 py-2">
              <span role="alert" className="text-xs text-critical">
                Delete every agent, API key, policy and ledger row? This cannot be undone.
              </span>
              <Button type="submit" variant="danger" size="sm">
                Yes, delete everything
              </Button>
              {/* Focus lands on the safe choice: the button this replaced is gone. */}
              <Button type="button" variant="secondary" size="sm" autoFocus onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </form>
          )}
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
            className="mt-3 rounded-sm border border-critical px-3 py-1.5 text-xs font-semibold text-critical transition-slens hover:bg-critical hover:text-on-critical active:scale-[0.98]"
          >
            Delete my account
          </button>
        ) : (
          <form
            className="mt-3 space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              setDeleting(true);
              const { error } = await authClient.deleteUser({ password });
              if (error) {
                setErr(error.message || "Could not delete account.");
                setDeleting(false);
                return;
              }
              router.push("/");
              router.refresh();
            }}
          >
            <input
              type="password"
              name="password"
              aria-label="Your password, to confirm deleting the account"
              placeholder="Confirm with your password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              className="field w-full rounded-sm bg-bg px-3 py-2 text-sm text-fg"
            />
            {err && (
              <p role="alert" className="text-xs text-critical">
                {err}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" variant="danger" size="sm" disabled={deleting}>
                {deleting ? "Deleting…" : "Permanently delete"}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
