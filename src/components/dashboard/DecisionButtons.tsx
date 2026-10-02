"use client";

import { useFormStatus } from "react-dom";

/**
 * Approve / Deny for one waiting payment. It has to sit inside the row's
 * `<form action>`: `useFormStatus` reads that form, so while the server action
 * runs both buttons lock and the one that was pressed says what it is doing.
 * Without it, a second click (or a double click) submitted the same decision
 * again while the first was still in flight, with no sign that anything had
 * happened.
 */
export function DecisionButtons() {
  const { pending, data } = useFormStatus();
  const decision = data?.get("decision");

  return (
    <div className="flex gap-2">
      <button
        type="submit"
        name="decision"
        value="approve"
        disabled={pending}
        className="rounded-xs bg-signal px-3 py-1 text-xs font-semibold text-ink transition-slens hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
      >
        {pending && decision === "approve" ? "Approving…" : "Approve"}
      </button>
      <button
        type="submit"
        name="decision"
        value="deny"
        disabled={pending}
        className="rounded-xs border border-critical px-3 py-1 text-xs font-semibold text-critical transition-slens hover:bg-critical/10 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
      >
        {pending && decision === "deny" ? "Denying…" : "Deny"}
      </button>
    </div>
  );
}
