"use client";

import { useActionState, useState } from "react";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  sendTestEventAction,
  type ActionState,
} from "@/app/dashboard/actions";
import type { ApiKeyView } from "@/lib/db/api-keys";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";

const initial: ActionState = {};

/** Revoking is permanent (a revoked key can't be un-revoked) and cuts off
 *  whichever agent still uses it, so it takes a second, explicit click. */
function RevokeKeyButton({ keyId, name }: { keyId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Revoke key ${name}`}
        className="shrink-0 rounded-xs border border-border px-2 py-1 text-muted transition-slens hover:border-critical hover:text-critical active:scale-[0.98]"
      >
        Revoke
      </button>
    );
  }

  return (
    <form action={revokeApiKeyAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="keyId" value={keyId} />
      <span role="alert" className="text-critical">
        Revoke &ldquo;{name}&rdquo;? Agents using it can no longer report.
      </span>
      <Button type="submit" variant="danger" size="sm">
        Revoke key
      </Button>
      {/* Focus lands on the safe choice: the Revoke button this replaced is gone. */}
      <Button type="button" variant="secondary" size="sm" autoFocus onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </form>
  );
}

export function ApiKeysPanel({
  agentId,
  slug,
  keys,
  ingestUrl,
  appUrl,
}: {
  agentId: string;
  slug: string;
  keys: ApiKeyView[];
  ingestUrl: string;
  appUrl: string;
}) {
  const [state, formAction, pending] = useActionState(createApiKeyAction, initial);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  const active = keys.filter((k) => !k.revokedAt);
  const base = appUrl.replace(/\/$/, "");

  const installCmd = `npm install ${base}/downloads/spendlens-sdk.tgz`;
  const snippet = `import { guard } from "@spendlens/sdk";

const pay = guard({
  agentId: "${slug}",
  apiKey: process.env.SPENDLENS_API_KEY,   // shown once, when you create a key
  sink: "${ingestUrl}",
  // No \`policy\` here → the guard follows this agent's policy from the Policies tab, live.
  // signer: createLocalSigner(process.env.AGENT_PRIVATE_KEY),  // required for real payments
});

// use pay.fetch wherever the agent would call a paid API:
const res = await pay.fetch("https://api.example.io/v1/data", { taskId: "task-001" });`;

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopy("copied");
    } catch {
      // Insecure origin or a denied permission: the key is `select-all`, so
      // say so instead of claiming it was copied.
      setCopy("failed");
    }
    setTimeout(() => setCopy("idle"), 2000);
  }

  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-semibold">SDK connection &amp; API keys</h2>
        <p className="mt-0.5 text-xs text-muted">
          Keys authenticate this agent&rsquo;s ingest calls. The full key is shown
          once, so store it as <code className="font-mono">SPENDLENS_API_KEY</code>.
        </p>
      </div>

      <div className="mt-4 space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
          1. Install
        </div>
        <pre className="overflow-x-auto rounded-xs bg-surface-2 p-3 font-mono text-[11px] text-fg">
          {installCmd}
        </pre>
        <p className="text-[11px] text-muted">
          Or grab one file:{" "}
          <a
            href={`${base}/downloads/spendlens-sdk.mjs`}
            className="underline transition-slens hover:text-fg"
          >
            spendlens-sdk.mjs
          </a>
          . Set <code className="font-mono">SPENDLENS_URL={base}</code> and{" "}
          <code className="font-mono">SPENDLENS_API_KEY=</code> your key.
        </p>
        <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          2. Wrap the agent&rsquo;s fetch
        </div>
        <pre className="overflow-x-auto rounded-xs bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-muted">
          {snippet}
        </pre>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] text-muted">Ingest URL:</span>
          <code className="rounded-xs bg-surface-2 px-2 py-1 font-mono text-[11px] break-all text-fg">
            {ingestUrl}
          </code>
          <form action={sendTestEventAction} className="ml-auto">
            <input type="hidden" name="slug" value={slug} />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              title="Writes one sample authorization so you can see the ledger react"
            >
              Send test event
            </Button>
          </form>
        </div>
      </div>

      {/* freshly-created secret */}
      {state.secret && (
        <div className="mt-4 rounded-xs border border-signal/40 bg-signal/10 p-3">
          {/* The live region announces the instruction, never the secret itself. */}
          <p role="status" className="text-xs font-semibold text-fg">
            New key: copy it now, it won&rsquo;t be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-xs bg-bg px-2 py-1.5 font-mono text-xs text-signal select-all">
              {state.secret}
            </code>
            <Button type="button" variant="secondary" size="sm" onClick={() => copySecret(state.secret!)}>
              {copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed" : "Copy"}
            </Button>
          </div>
        </div>
      )}

      {state.error && (
        <p
          role="alert"
          className="mt-3 rounded-xs border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical"
        >
          {state.error}
        </p>
      )}

      {/* create form */}
      <form action={formAction} className="mt-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="agentId" value={agentId} />
        <input
          name="name"
          aria-label="Key name"
          placeholder="Key name (e.g. production)"
          autoComplete="off"
          required
          className="field min-w-0 flex-1 rounded-xs bg-bg px-2.5 py-1.5 text-xs text-fg sm:min-w-48"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create key"}
        </Button>
      </form>

      {/* key list */}
      {active.length > 0 && (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {active.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs"
            >
              <div className="min-w-0">
                <span className="font-medium text-fg">{k.name}</span>
                <span className="ml-2 font-mono text-muted">{k.prefix}…</span>
                <span className="ml-2 text-muted">
                  created {formatDateTime(k.createdAt)}
                  {k.lastUsedAt
                    ? ` · last used ${formatDateTime(k.lastUsedAt)}`
                    : " · never used"}
                </span>
              </div>
              <RevokeKeyButton keyId={k.id} name={k.name} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
