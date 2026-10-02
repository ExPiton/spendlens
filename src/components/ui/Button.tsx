import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-[opacity,background-color,border-color,color,transform] duration-200 ease-[var(--ease-slens)] active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap";

const SIZES: Record<ButtonSize, string> = {
  md: "px-4 py-2.5 text-sm",
  // Compact, for actions that sit inside a card or a table row.
  sm: "px-3 py-1.5 text-xs",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-fg text-bg hover:opacity-85",
  secondary: "border border-border text-fg hover:bg-surface-2",
  ghost: "text-muted hover:text-fg",
  // Solid red is for the step that actually destroys something, not the first click.
  danger: "bg-critical text-on-critical hover:opacity-90",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  className = "",
  size: ButtonSize = "md",
): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`.trim();
}

// ComponentProps (not ButtonHTMLAttributes) so `ref` is part of the type: in
// React 19 a ref is an ordinary prop on a function component.
interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return <button className={buttonClasses(variant, className, size)} {...props} />;
}

interface LinkButtonProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}

export function LinkButton({ href, variant = "primary", size = "md", className, children }: LinkButtonProps) {
  return (
    <Link href={href} className={buttonClasses(variant, className, size)}>
      {children}
    </Link>
  );
}
