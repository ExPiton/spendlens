import type { ReactNode } from "react";
import type { StatusTone } from "@/lib/status";

const DOT_CLASSES: Record<StatusTone, string> = {
  signal: "bg-signal",
  held: "bg-held",
  critical: "bg-critical",
  neutral: "bg-muted",
};

const TEXT_CLASSES: Record<StatusTone, string> = {
  signal: "text-signal",
  held: "text-held",
  critical: "text-critical",
  neutral: "text-muted",
};

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span
      className={`inline-block size-1.5 shrink-0 rounded-full ${DOT_CLASSES[tone]} ${className ?? ""}`}
      aria-hidden="true"
    />
  );
}

export function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-xs border border-border px-2 py-1 text-xs font-medium">
      <StatusDot tone={tone} />
      <span className={TEXT_CLASSES[tone]}>{children}</span>
    </span>
  );
}

/** Compact inline variant for dense table cells — dot + text, no pill border. */
export function StatusInline({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <StatusDot tone={tone} />
      <span className={TEXT_CLASSES[tone]}>{children}</span>
    </span>
  );
}
