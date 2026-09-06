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

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="agent-select" className="text-xs text-muted">
        Agent:
      </label>
      <select
        id="agent-select"
        value={currentAgentId}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value)}
        className="rounded-xs border border-border bg-surface px-2.5 py-1 font-mono text-xs text-fg transition-slens focus:border-signal focus:outline-none disabled:opacity-50"
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
