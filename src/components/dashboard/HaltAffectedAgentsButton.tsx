"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { haltAgentsAction } from "@/app/dashboard/actions";

export function HaltAffectedAgentsButton({ agents }: { agents: string[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setResult(null);
    try {
      const { halted } = await haltAgentsAction(agents);
      setResult(
        halted.length > 0
          ? `Halted ${halted.length} agent${halted.length === 1 ? "" : "s"}: ${halted.join(", ")}`
          : "The affected agents are already halted.",
      );
      startTransition(() => router.refresh());
    } catch {
      setResult("Could not halt agents — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || isPending}
        className="shrink-0 rounded-xs bg-critical px-4 py-2 text-xs font-bold text-paper transition-slens hover:opacity-90 disabled:opacity-50"
      >
        {busy || isPending ? "Halting…" : "Halt Affected Agents"}
      </button>
      {result && <p className="max-w-xs text-right text-[11px] text-fg">{result}</p>}
    </div>
  );
}
