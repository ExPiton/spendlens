import type { ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { StatusDot } from "@/components/ui/StatusPill";
import type { StatusTone } from "@/lib/status";

interface StatCardProps {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  tone?: StatusTone;
}

const VALUE_TONE: Record<StatusTone, string> = {
  signal: "text-signal",
  held: "text-held",
  critical: "text-critical",
  neutral: "text-fg",
};

/**
 * The overview screen is exactly four of these and nothing else — more
 * than that buries the number that actually matters.
 */
export function StatCard({ label, value, sublabel, tone = "neutral" }: StatCardProps) {
  return (
    <Panel className="p-5">
      <div className="text-xs font-medium tracking-wide text-muted uppercase">{label}</div>
      <MonoNumber className={`mt-2 block text-[2rem] leading-none ${VALUE_TONE[tone]}`}>
        {value}
      </MonoNumber>
      {sublabel && <div className="mt-2 flex items-center gap-1.5 text-sm text-muted">{sublabel}</div>}
    </Panel>
  );
}

export function StatCardSublabelDot({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <>
      <StatusDot tone={tone} />
      <span>{children}</span>
    </>
  );
}
