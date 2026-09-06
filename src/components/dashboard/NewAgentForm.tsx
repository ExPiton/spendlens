"use client";

import { useActionState, useState } from "react";
import { createAgentAction, type ActionState } from "@/app/dashboard/actions";

const initial: ActionState = {};

export function NewAgentForm() {
  const [state, formAction, pending] = useActionState(createAgentAction, initial);
  const [slug, setSlug] = useState("");

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <p className="rounded-sm border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
          {state.error}
        </p>
      )}

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted">Agent id</span>
        <input
          name="slug"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="research-crawler-01"
          pattern="[a-zA-Z0-9][a-zA-Z0-9-]*"
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-sm text-fg outline-none focus:border-signal"
        />
        <span className="mt-1 block text-[11px] text-muted">
          Lowercase letters, numbers and hyphens. 3–50 characters.
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted">
          Display name
        </span>
        <input
          name="label"
          placeholder="Research crawler"
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-signal"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-sm bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-slens hover:opacity-85 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create agent"}
      </button>
    </form>
  );
}
