"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

/** The ledger's search filter (resource / counterparty / agent / ruleHit —
 *  see `AuthorizationFilters.search`) was already fully wired end to end in
 *  the API and repository layer; the page just never rendered an input for
 *  it, so it was reachable only by hand-editing the URL. */
export function LedgerSearchBox({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialValue);
  const [isPending, startTransition] = useTransition();

  function submit() {
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = value.trim();
    if (trimmed) params.set("search", trimmed);
    else params.delete("search");
    params.delete("page");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <div className="flex items-center gap-2 sm:ml-4">
      <span className="text-muted">Search:</span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="resource, counterparty, agent, rule…"
        disabled={isPending}
        className="w-52 rounded-xs border border-border bg-bg px-2 py-1 text-fg outline-none focus:border-signal disabled:opacity-50"
      />
      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="rounded-xs bg-surface-2 px-2 py-1 text-muted transition-slens hover:text-fg disabled:opacity-50"
      >
        {isPending ? "…" : "Go"}
      </button>
    </div>
  );
}
