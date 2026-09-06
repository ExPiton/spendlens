import type { ReactNode } from "react";

/** Numbers align: every numeric value in the app renders through this so alignment/tabular-nums never drifts by accident. */
export function MonoNumber({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono tabular ${className ?? ""}`}>{children}</span>;
}
