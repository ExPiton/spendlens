"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";

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
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex w-full items-center gap-2 sm:ml-4 sm:w-auto"
    >
      <label htmlFor="ledger-search" className="shrink-0 text-muted">
        Search:
      </label>
      <input
        id="ledger-search"
        name="search"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="resource, counterparty, agent, rule…"
        autoComplete="off"
        spellCheck={false}
        disabled={isPending}
        className="field min-w-0 flex-1 rounded-xs bg-bg px-2 py-1 text-fg sm:w-52 sm:flex-none"
      />
      <Button type="submit" variant="secondary" size="sm" disabled={isPending}>
        {isPending ? "…" : "Go"}
      </Button>
    </form>
  );
}
