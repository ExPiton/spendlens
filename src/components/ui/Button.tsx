import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2.5 text-sm font-medium transition-slens disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: `${BASE} bg-fg text-bg hover:opacity-85`,
  secondary: `${BASE} border border-border text-fg hover:bg-surface-2`,
  ghost: `${BASE} text-muted hover:text-fg`,
};

export function buttonClasses(variant: ButtonVariant = "primary", className = ""): string {
  return `${VARIANTS[variant]} ${className}`.trim();
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return <button className={buttonClasses(variant, className)} {...props} />;
}

interface LinkButtonProps {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
}

export function LinkButton({ href, variant = "primary", className, children }: LinkButtonProps) {
  return (
    <Link href={href} className={buttonClasses(variant, className)}>
      {children}
    </Link>
  );
}
