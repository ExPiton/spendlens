import { formatPercent, formatUsdcPrecise } from "@/lib/format";

interface WasteCalloutProps {
  agentName?: string;
  totalSpendMicroUsdc: number;
  wastedMicroUsdc: number;
  wastedRatio: number;
}

/** One plain sentence about what the spend bought — no scorecard theatrics. */
export function WasteCallout({
  agentName = "The agent",
  totalSpendMicroUsdc,
  wastedMicroUsdc,
  wastedRatio,
}: WasteCalloutProps) {
  const isHighWaste = wastedRatio > 0.15;
  const none = wastedMicroUsdc === 0;

  return (
    <section
      aria-label="Waste analysis"
      className={`rounded-md border p-6 ${
        isHighWaste ? "border-critical/30 bg-critical/5" : "border-border bg-surface"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">Waste analysis</h2>
          <p className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">
            {agentName} spent{" "}
            <span className="font-mono">{formatUsdcPrecise(totalSpendMicroUsdc)} USDC</span> this period.{" "}
            {none ? (
              <>Every paid call got a usable response.</>
            ) : (
              <>
                <span className={`font-mono ${isHighWaste ? "text-critical" : ""}`}>
                  {formatUsdcPrecise(wastedMicroUsdc)} USDC
                </span>{" "}
                ({formatPercent(wastedRatio)}) paid for responses that were empty, failed, too slow or
                off-schema.
              </>
            )}
          </p>
        </div>

        <div className="shrink-0 rounded-xs border border-border bg-surface-2 px-4 py-2 sm:text-right">
          <span className="text-[11px] text-muted uppercase">Useful spend</span>
          <div className="font-mono text-xl font-semibold">{formatPercent(1 - wastedRatio)}</div>
        </div>
      </div>
    </section>
  );
}
