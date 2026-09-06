import { Mark } from "./Mark";
import { Wordmark } from "./Wordmark";

interface LogoProps {
  size?: number;
  wordmark?: boolean;
  className?: string;
  wordmarkClassName?: string;
}

/** Mark + wordmark, spaced at 0.3× the mark's width per logo.pdf's clear-space rule. */
export function Logo({ size = 28, wordmark = true, className, wordmarkClassName }: LogoProps) {
  return (
    <span
      className={`inline-flex items-center ${className ?? ""}`}
      style={{ gap: size * 0.3 }}
    >
      <Mark size={size} />
      {wordmark && (
        <Wordmark className={`text-lg leading-none tracking-tight ${wordmarkClassName ?? ""}`} />
      )}
    </span>
  );
}
