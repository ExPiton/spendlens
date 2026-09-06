"use client";

import { useState } from "react";
import {
  setAgentStatusAction,
  deleteAgentAction,
  renameAgentAction,
} from "@/app/dashboard/actions";

export function AgentControls({
  agentId,
  slug,
  label,
  status,
}: {
  agentId: string;
  slug: string;
  label: string;
  status: "active" | "paused";
}) {
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (renaming) {
    return (
      <form
        action={renameAgentAction}
        onSubmit={() => setRenaming(false)}
        className="flex items-center gap-2"
      >
        <input type="hidden" name="agentId" value={agentId} />
        <input
          name="label"
          defaultValue={label}
          autoFocus
          className="rounded-xs border border-border bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-signal"
        />
        <button
          type="submit"
          className="rounded-xs bg-fg px-2.5 py-1 text-xs font-medium text-bg"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setRenaming(false)}
          className="rounded-xs border border-border px-2.5 py-1 text-xs text-muted"
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setRenaming(true)}
        className="rounded-xs border border-border px-3 py-1.5 text-xs text-muted transition-slens hover:border-fg hover:text-fg"
      >
        Rename
      </button>

      <form action={setAgentStatusAction}>
        <input type="hidden" name="agentId" value={agentId} />
        <input
          type="hidden"
          name="status"
          value={status === "paused" ? "active" : "paused"}
        />
        <button
          type="submit"
          className={
            status === "paused"
              ? "rounded-xs border border-signal bg-signal/10 px-3 py-1.5 text-xs font-semibold text-signal transition-slens hover:bg-signal hover:text-ink"
              : "rounded-xs border border-critical bg-critical/10 px-3 py-1.5 text-xs font-semibold text-critical transition-slens hover:bg-critical hover:text-paper"
          }
          title={
            status === "paused"
              ? "Resume ingest for this agent"
              : "Reject new ingest for this agent (kill switch)"
          }
        >
          {status === "paused" ? "Resume agent" : "Halt agent (kill switch)"}
        </button>
      </form>

      {confirmDelete ? (
        <form action={deleteAgentAction} className="flex items-center gap-1.5">
          <input type="hidden" name="agentId" value={agentId} />
          <span className="text-xs text-critical">Delete {slug}?</span>
          <button
            type="submit"
            className="rounded-xs bg-critical px-2.5 py-1 text-xs font-semibold text-paper"
          >
            Yes, delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="rounded-xs border border-border px-2.5 py-1 text-xs text-muted"
          >
            No
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="rounded-xs border border-border px-3 py-1.5 text-xs text-muted transition-slens hover:border-critical hover:text-critical"
        >
          Delete
        </button>
      )}
    </div>
  );
}
