"use client";

import { useActionState, useState } from "react";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  type ActionState,
} from "@/app/dashboard/actions";
import type { ApiKeyView } from "@/lib/db/api-keys";
import { formatDateTime } from "@/lib/format";

const initial: ActionState = {};

export function ApiKeysPanel({
  agentId,
  slug,
  keys,
  ingestUrl,
}: {
  agentId: string;
  slug: string;
  keys: ApiKeyView[];
  ingestUrl: string;
}) {
  const [state, formAction, pending] = useActionState(createApiKeyAction, initial);
  const [copied, setCopied] = useState(false);

  const active = keys.filter((k) => !k.revokedAt);

  const snippet = `import { guard } from "@spendlens/sdk";

const pay = guard({
  agentId: "${slug}",
  apiKey: process.env.SPENDLENS_API_KEY,
  sink: "${ingestUrl}",
  policy: spendlensPolicyYaml, // your agent's policy
});

const res = await pay.fetch("https://api.example.io/v1/data", {
  taskId: "task-001",
});`;

  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <div className="border-b border-border pb-3">
        <h3 className="text-sm font-semibold">SDK connection &amp; API keys</h3>
        <p className="mt-0.5 text-xs text-muted">
          Keys authenticate this agent&apos;s ingest calls. The full key is shown
          once — store it as <code className="font-mono">SPENDLENS_API_KEY</code>.
        </p>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted">Ingest URL</span>
          <code className="rounded-xs bg-surface-2 px-2 py-1 font-mono text-fg">
            {ingestUrl}
          </code>
        </div>
        <pre className="overflow-x-auto rounded-xs bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-muted">
          {snippet}
        </pre>
      </div>

      {/* freshly-created secret */}
      {state.secret && (
        <div className="mt-4 rounded-xs border border-signal/40 bg-signal/10 p-3">
          <p className="text-xs font-semibold text-fg">
            New key — copy it now, it won&apos;t be shown again:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-xs bg-bg px-2 py-1.5 font-mono text-xs text-signal">
              {state.secret}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(state.secret!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-xs border border-border px-2.5 py-1.5 text-xs text-fg hover:bg-surface-2"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {state.error && (
        <p className="mt-3 rounded-xs border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
          {state.error}
        </p>
      )}

      {/* create form */}
      <form action={formAction} className="mt-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="agentId" value={agentId} />
        <input
          name="name"
          placeholder="Key name (e.g. production)"
          required
          className="min-w-48 flex-1 rounded-xs border border-border bg-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-signal"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-xs bg-fg px-3 py-1.5 text-xs font-medium text-bg transition-slens hover:opacity-85 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>

      {/* key list */}
      {active.length > 0 && (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {active.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-3 py-2.5 text-xs"
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
              <form action={revokeApiKeyAction}>
                <input type="hidden" name="keyId" value={k.id} />
                <button
                  type="submit"
                  className="shrink-0 rounded-xs border border-border px-2 py-1 text-muted transition-slens hover:border-critical hover:text-critical"
                >
                  Revoke
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
