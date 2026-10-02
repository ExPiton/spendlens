"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { setAgentWalletAction, type ActionState } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/Button";

const initial: ActionState = {};

export function AgentWallet({
  agentId,
  walletAddress,
  isMainnet,
  faucetUrl,
  explorerUrl,
  arcLabel,
}: {
  agentId: string;
  walletAddress: string | null;
  isMainnet: boolean;
  faucetUrl: string;
  explorerUrl: string;
  arcLabel: string;
}) {
  const [state, formAction, pending] = useActionState(setAgentWalletAction, initial);
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-semibold">Arc wallet &amp; reconciliation</h2>
        <p className="mt-0.5 text-xs text-muted">
          The agent&rsquo;s {arcLabel} address that funds Nanopayments via Circle
          Gateway. Used to reconcile the local ledger against on-chain settlement.
        </p>
      </div>

      <div className="mt-4 space-y-3 text-xs">
        {walletAddress && !editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">Address</span>
            <code className="rounded-xs bg-surface-2 px-2 py-1 font-mono break-all text-fg">
              {walletAddress}
            </code>
            <a
              href={`${explorerUrl}/address/${walletAddress}`}
              target="_blank"
              rel="noreferrer"
              className="text-muted underline transition-slens hover:text-fg"
            >
              explorer <span aria-hidden="true">↗</span>
            </a>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-muted underline transition-slens hover:text-fg"
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
              placeholder="0x…"
              aria-label="Agent wallet address (the wallet that pays through Circle Gateway)"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="field min-w-0 flex-1 rounded-xs bg-bg px-2.5 py-1.5 font-mono text-fg sm:min-w-72"
            />
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {walletAddress && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </form>
        )}

        {state.error && (
          <p role="alert" className="text-critical">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p role="status" className="text-signal">
            Saved.
          </p>
        )}

        <p className="text-muted">
          {isMainnet ? (
            <>Nanopayments are paid from this wallet&rsquo;s Circle Gateway balance: deposit USDC into Gateway from it</>
          ) : (
            <>
              Fund it with testnet USDC at{" "}
              <a href={faucetUrl} target="_blank" rel="noreferrer" className="underline transition-slens hover:text-fg">
                {faucetUrl.replace(/^https?:\/\//, "")}
              </a>{" "}
              and deposit it into Circle Gateway
            </>
          )}
          . Spendlens compares this wallet&rsquo;s Gateway settlements with the ledger every 10 minutes (the address
          is all it needs, never a key) and halts the agent if it finds spend the ledger never recorded. To check
          now, use <span className="text-fg">Rescan</span> on the{" "}
          <Link href="/dashboard/reconciliation" className="underline transition-slens hover:text-fg">
            Reconciliation
          </Link>{" "}
          page.
        </p>
      </div>
    </div>
  );
}
