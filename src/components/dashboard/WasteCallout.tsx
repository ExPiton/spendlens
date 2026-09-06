import { formatPercent, formatUsdcTotal } from "@/lib/format";

interface WasteCalloutProps {
  agentName?: string;
  totalSpendMicroUsdc: number;
  wastedMicroUsdc: number;
  wastedRatio: number;
}

export function WasteCallout({
  agentName = "The agent",
  totalSpendMicroUsdc,
  wastedMicroUsdc,
  wastedRatio,
}: WasteCalloutProps) {
  const isHighWaste = wastedRatio > 0.15;

  return (
    <div
      className={`relative overflow-hidden rounded-md border p-6 transition-slens ${
        isHighWaste
          ? "border-critical/30 bg-critical/5 text-fg"
          : "border-border bg-surface text-fg"
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs font-semibold tracking-wider text-muted uppercase">
            Waste Analysis
          </span>
          <p className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
            &ldquo;{agentName} spent{" "}
            <span className="font-mono text-fg font-bold">
              ${formatUsdcTotal(totalSpendMicroUsdc)}
            </span>{" "}
            this period. Of that,{" "}
            <span className="font-mono text-critical font-bold">
              ${formatUsdcTotal(wastedMicroUsdc)}
            </span>{" "}
            ({formatPercent(wastedRatio)}) went unmatched.&rdquo;
          </p>
        </div>

        <div className="mt-4 shrink-0 sm:mt-0">
          <div className="rounded-xs border border-border bg-surface-2 px-4 py-2 text-right">
            <span className="text-[10px] text-muted uppercase">Efficiency Score</span>
            <div className="font-mono text-xl font-bold text-signal">
              {formatPercent(1 - wastedRatio)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
