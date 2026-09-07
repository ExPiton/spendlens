"use client";

import { useActionState, useState } from "react";
import { setAgentWalletAction, type ActionState } from "@/app/dashboard/actions";

const initial: ActionState = {};

export function AgentWallet({
  agentId,
  walletAddress,
  faucetUrl,
  explorerUrl,
  arcLabel,
}: {
  agentId: string;
  walletAddress: string | null;
  faucetUrl: string;
  explorerUrl: string;
  arcLabel: string;
}) {
  const [state, formAction, pending] = useActionState(setAgentWalletAction, initial);
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <div className="border-b border-border pb-3">
        <h3 className="text-sm font-semibold">Arc wallet &amp; reconciliation</h3>
        <p className="mt-0.5 text-xs text-muted">
          The agent&apos;s {arcLabel} address that funds Nanopayments via Circle
          Gateway. Used to reconcile the local ledger against on-chain settlement.
        </p>
      </div>

      <div className="mt-4 space-y-3 text-xs">
        {walletAddress && !editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">Address</span>
            <code className="rounded-xs bg-surface-2 px-2 py-1 font-mono text-fg">
              {walletAddress}
            </code>
            <a
              href={`${explorerUrl}/address/${walletAddress}`}
              target="_blank"
              rel="noreferrer"
              className="text-muted underline hover:text-fg"
            >
              explorer ↗
            </a>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-muted underline hover:text-fg"
            >
              change
            </button>
          </div>
        ) : (
          <form action={formAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="agentId" value={agentId} />
            <input
              name="walletAddress"
              defaultValue={walletAddress ?? ""}
              placeholder="0x… (from `node scripts/new-wallet.mjs` or Circle)"
              className="min-w-72 flex-1 rounded-xs border border-border bg-bg px-2.5 py-1.5 font-mono text-fg outline-none focus:border-signal"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-xs bg-fg px-3 py-1.5 font-medium text-bg transition-slens hover:opacity-85 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            {walletAddress && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-xs border border-border px-2.5 py-1.5 text-muted"
              >
                Cancel
              </button>
            )}
          </form>
        )}

        {state.error && <p className="text-critical">{state.error}</p>}
        {state.ok && <p className="text-signal">Saved.</p>}

        <p className="text-muted">
          Fund it with testnet USDC at{" "}
          <a href={faucetUrl} target="_blank" rel="noreferrer" className="underline hover:text-fg">
            {faucetUrl.replace(/^https?:\/\//, "")}
          </a>
          , then reconcile with{" "}
          <code className="rounded-xs bg-surface-2 px-1 py-0.5 font-mono">
            npm run reconcile:arc
          </code>
          .
        </p>
      </div>
    </div>
  );
}
