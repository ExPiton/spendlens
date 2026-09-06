import type { HTMLAttributes } from "react";

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-md border border-border bg-surface ${className ?? ""}`}
      {...props}
    />
  );
}
