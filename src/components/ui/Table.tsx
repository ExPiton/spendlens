import type { TableHTMLAttributes, ThHTMLAttributes, TdHTMLAttributes, HTMLAttributes } from "react";

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={`w-full border-collapse text-sm ${className ?? ""}`} {...props} />;
}

export function Thead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={className} {...props} />;
}

export function Tbody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`transition-slens hover:bg-surface-2 ${className ?? ""}`} {...props} />;
}

type Align = "left" | "right";

export function Th({
  className,
  align = "left",
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <th
      className={`border-b border-border px-3 py-2 text-xs font-medium tracking-wide text-muted uppercase ${
        align === "right" ? "text-right" : "text-left"
      } ${className ?? ""}`}
      {...props}
    />
  );
}

export function Td({
  className,
  align = "left",
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <td
      className={`border-b border-border px-3 py-2.5 ${align === "right" ? "text-right" : "text-left"} ${className ?? ""}`}
      {...props}
    />
  );
}
