/**
 * Reconstructed from the brand guideline's written construction spec
 * (100×100 grid, stroke 12, center dot drops below 24px) — not a trace of
 * any source vector paths.
 *
 * The lens: the ring and center dot are the interception mark, always
 * `currentColor` so they follow whatever text color the surrounding theme
 * sets. The measured share: the green arc represents the measured slice of
 * spend, never decorative, so it's hardcoded to the signal token
 * regardless of theme — never recolor it.
 * The arc fraction (~0.687) doubles as a quiet callback to the product's
 * own "got value for" ratio in the reference example (1 − 31.3%).
 */

const R = 36;
const CIRCUMFERENCE = 2 * Math.PI * R;
const ARC_FRACTION = 0.687;

interface MarkProps {
  size?: number;
  className?: string;
  /** The brand guideline's single-color variant — arc drops to currentColor too, for stamp/watermark use where a vivid green arc would read as decoration. */
  monochrome?: boolean;
}

export function Mark({ size = 32, className, monochrome = false }: MarkProps) {
  const showDot = size >= 24;
  const strokeWidth = showDot ? 12 : 16;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeWidth={strokeWidth} />
      <circle
        cx="50"
        cy="50"
        r={R}
        fill="none"
        stroke={monochrome ? "currentColor" : "var(--color-signal)"}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${(CIRCUMFERENCE * ARC_FRACTION).toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`}
        transform="rotate(-90 50 50)"
      />
      {showDot && <circle cx="50" cy="50" r="7" fill="currentColor" />}
    </svg>
  );
}
