import type { InputHTMLAttributes, ReactNode } from "react";

export function AuthHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">
        {label}
        {hint}
      </span>
      <input
        className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-fg outline-none transition-slens placeholder:text-muted/60 focus:border-signal"
        {...props}
      />
    </label>
  );
}

export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-sm border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
      {children}
    </p>
  );
}

export function FormNotice({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-sm border border-signal/30 bg-signal/10 px-3 py-2 text-xs text-fg">
      {children}
    </p>
  );
}
