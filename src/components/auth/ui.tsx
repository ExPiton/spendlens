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

/**
 * A labelled input. The label and the hint are siblings, not parent and
 * child: a hint inside the <label> (the "Forgot password?" link, "8+
 * characters") becomes part of the input's accessible name, so a screen reader
 * announced "Password Forgot?" for the field.
 *
 * `name` is required and doubles as the id, so the label stays tied to its
 * input without a hook.
 */
export function Field({
  label,
  hint,
  name,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "name"> & {
  label: string;
  name: string;
  hint?: ReactNode;
}) {
  const id = `field-${name}`;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs font-medium text-muted">
        <label htmlFor={id}>{label}</label>
        {hint}
      </div>
      <input
        id={id}
        name={name}
        className={`field w-full rounded-sm bg-surface px-3 py-2 text-sm text-fg ${className ?? ""}`}
        {...props}
      />
    </div>
  );
}

export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-sm border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
      {children}
    </p>
  );
}

export function FormNotice({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="status" className="rounded-sm border border-signal/30 bg-signal/10 px-3 py-2 text-xs text-fg">
      {children}
    </p>
  );
}
