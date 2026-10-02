"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface AgentOption {
  id: string;
  label: string;
}

interface AgentSwitcherProps {
  options: AgentOption[];
  currentAgentId: string;
}

export function AgentSwitcher({ options, currentAgentId }: AgentSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handleChange(agentId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (agentId && agentId !== "all") {
      params.set("agentId", agentId);
    } else {
      params.delete("agentId");
    }
    // reset pagination if present
    params.delete("page");

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  // `min-w-0` + `flex-1` let the select shrink to the row: sized by its
  // longest option ("Research crawler (research-crawler-01)") it was 417px
  // wide and pushed every page that has a switcher past a 390px screen.
  return (
    <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
      <label htmlFor="agent-select" className="shrink-0 text-xs text-muted">
        Agent:
      </label>
      <select
        id="agent-select"
        name="agent"
        value={currentAgentId}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value)}
        className="field min-w-0 flex-1 truncate rounded-xs bg-surface px-2.5 py-1 font-mono text-xs text-fg sm:flex-none"
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label} ({opt.id})
          </option>
        ))}
      </select>
    </div>
  );
}
