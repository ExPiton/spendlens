/**
 * Formatting rules: period totals show 2 decimals ("340.12"), every
 * line-item amount and delta shows the full 6 ("0.003000", "0.000004") —
 * amounts always align on fixed-width digits since nanopayments make
 * fractions of a cent meaningful — counts group digits with a space, not a
 * comma, so grouping never collides visually with a decimal point
 * elsewhere on the same screen, and percentages trail with the sign
 * ("31.3%").
 */

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

const MICRO = 1_000_000;

/**
 * Every seeded timestamp is stored as an absolute instant. Display must
 * pin an explicit zone: without one, `Intl.DateTimeFormat` falls back to
 * the runtime's local zone, which is whatever the server or viewer's
 * browser happens to be set to — silently shifting every time shown in the
 * app depending on where it's rendered. UTC is the neutral, deployment-
 * independent choice for an infrastructure/audit tool.
 */
const DATA_TIME_ZONE = "UTC";

/** Big hero stat numbers only — e.g. "340.12". */
export function formatUsdcTotal(microUsdc: number): string {
  const sign = microUsdc < 0 ? "-" : "";
  const [intPart, decPart] = (Math.abs(microUsdc) / MICRO).toFixed(2).split(".");
  return `${sign}${groupThousands(intPart)}.${decPart}`;
}

/** Every line-item amount and reconciliation delta — e.g. "0.003000". */
export function formatUsdcPrecise(microUsdc: number): string {
  const sign = microUsdc < 0 ? "-" : "";
  const [intPart, decPart] = (Math.abs(microUsdc) / MICRO).toFixed(6).split(".");
  return `${sign}${groupThousands(intPart)}.${decPart}`;
}

export function formatCount(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}${groupThousands(Math.trunc(Math.abs(n)).toString())}`;
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: DATA_TIME_ZONE,
  }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: DATA_TIME_ZONE,
  }).format(new Date(iso));
}

/** Literal Y/M/D from an ISO string's date prefix — reading the calendar date directly avoids any timezone conversion. */
function isoDateParts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return { year, month, day };
}

/**
 * "Jan 1 – Jan 12, 2026" style period label. `endIso` is an *exclusive*
 * boundary (getPeriod()'s own contract — periods are filtered as
 * `[start, end)` everywhere else), so the label steps back one calendar day
 * to show the last day the data actually covers. Computed via Date.UTC as a
 * pure calendar calculator, never the runtime's local zone.
 */
export function formatPeriod(startIso: string, endIso: string): string {
  const s = isoDateParts(startIso);
  const e = isoDateParts(endIso);
  const start = new Date(Date.UTC(s.year, s.month - 1, s.day));
  const end = new Date(Date.UTC(e.year, e.month - 1, e.day) - 1); // step back into the prior (inclusive) calendar day

  const monthName = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(d);

  if (start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()) {
    return `${monthName(start)} ${start.getUTCDate()} – ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  }
  return `${monthName(start)} ${start.getUTCDate()} – ${monthName(end)} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
}

/** "0x8f3a…7f80" style truncation for on-chain addresses. */
export function formatCounterparty(counterparty: string): string {
  if (counterparty.startsWith("0x") && counterparty.length > 14) {
    return `${counterparty.slice(0, 6)}…${counterparty.slice(-4)}`;
  }
  return counterparty;
}

/** "api.example.com/v1/data" style compact resource display: protocol stripped, addresses truncated. */
export function formatResource(resource: string): string {
  if (resource.startsWith("0x")) return formatCounterparty(resource);
  return resource.replace(/^https?:\/\//, "");
}
