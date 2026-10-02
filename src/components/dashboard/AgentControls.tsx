"use client";

import { useState } from "react";
import {
  setAgentStatusAction,
  deleteAgentAction,
  renameAgentAction,
} from "@/app/dashboard/actions";
import { Button } from "@/components/ui/Button";

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
        {/* autoFocus: the click on "Rename" just replaced the button with this
            field, so focus would otherwise fall back to the top of the page. */}
        <input
          name="label"
          defaultValue={label}
          aria-label="Display name"
          autoComplete="off"
          autoFocus
          className="field rounded-xs bg-surface px-2 py-1 text-xs text-fg"
        />
        <Button type="submit" size="sm">
          Save
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setRenaming(false)}>
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setRenaming(true)}
        className="rounded-xs border border-border px-3 py-1.5 text-xs text-muted transition-slens hover:border-fg hover:text-fg active:scale-[0.98]"
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
              ? "rounded-xs border border-signal bg-signal/10 px-3 py-1.5 text-xs font-semibold text-signal transition-slens hover:bg-signal hover:text-ink active:scale-[0.98]"
              : "rounded-xs border border-critical bg-critical/10 px-3 py-1.5 text-xs font-semibold text-critical transition-slens hover:bg-critical hover:text-on-critical active:scale-[0.98]"
          }
          title={
            status === "paused"
              ? "Let this agent’s guard sign payments again"
              : "Kill switch: the agent’s guard refuses every payment before signing, within ~15 s. The ledger keeps recording."
          }
        >
          {status === "paused" ? "Resume agent" : "Halt agent (kill switch)"}
        </button>
      </form>

      {confirmDelete ? (
        <form action={deleteAgentAction} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="agentId" value={agentId} />
          <span role="alert" className="text-xs text-critical">
            Delete {slug} with its ledger, keys and policy? This cannot be undone.
          </span>
          <Button type="submit" variant="danger" size="sm">
            Yes, delete
          </Button>
          {/* Focus lands on the safe choice: the Delete button this replaced is gone. */}
          <Button type="button" variant="secondary" size="sm" autoFocus onClick={() => setConfirmDelete(false)}>
            No
          </Button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="rounded-xs border border-border px-3 py-1.5 text-xs text-muted transition-slens hover:border-critical hover:text-critical active:scale-[0.98]"
        >
          Delete
        </button>
      )}
    </div>
  );
}
