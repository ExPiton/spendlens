"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { haltAgentsAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/Button";

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
      setResult("Could not halt the agents. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <Button type="button" variant="danger" onClick={handleClick} disabled={busy || isPending} className="shrink-0 text-xs font-bold">
        {busy || isPending ? "Halting…" : "Halt affected agents"}
      </Button>
      {result && (
        <p role="status" className="max-w-xs text-right text-[11px] text-fg">
          {result}
        </p>
      )}
    </div>
  );
}
