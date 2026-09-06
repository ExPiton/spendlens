/** "spend" semi-bold, "lens" regular — the only typographic rule the wordmark needs; everything else inherits from context. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="font-semibold">spend</span>
      <span className="font-normal">lens</span>
    </span>
  );
}
