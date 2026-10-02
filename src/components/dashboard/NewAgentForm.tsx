"use client";

import { useActionState, useState } from "react";
import { createAgentAction, type ActionState } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/Button";

const initial: ActionState = {};

export function NewAgentForm() {
  const [state, formAction, pending] = useActionState(createAgentAction, initial);
  const [slug, setSlug] = useState("");

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <p role="alert" className="rounded-sm border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="agent-slug" className="mb-1.5 block text-xs font-medium text-muted">
          Agent id
        </label>
        <input
          id="agent-slug"
          name="slug"
          required
          minLength={3}
          maxLength={50}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="research-crawler-01"
          // `\-`: browsers compile `pattern` with the `v` flag, where a bare trailing `-` in a
          // class is a syntax error, so the unescaped pattern was ignored (and logged an error).
          pattern="[a-zA-Z0-9][a-zA-Z0-9\-]*"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby="agent-slug-hint"
          className="field w-full rounded-sm bg-surface px-3 py-2 font-mono text-sm text-fg"
        />
        <p id="agent-slug-hint" className="mt-1 text-[11px] text-muted">
          Lowercase letters, numbers and hyphens. 3–50 characters.
        </p>
      </div>

      <div>
        <label htmlFor="agent-label" className="mb-1.5 block text-xs font-medium text-muted">
          Display name
        </label>
        <input
          id="agent-label"
          name="label"
          placeholder="Research crawler"
          autoComplete="off"
          className="field w-full rounded-sm bg-surface px-3 py-2 text-sm text-fg"
        />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating…" : "Create agent"}
      </Button>
    </form>
  );
}
