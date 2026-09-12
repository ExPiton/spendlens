import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  formatPeriod,
  formatTime,
  formatDateTime,
  formatUsdcPrecise,
  formatUsdcTotal,
  formatPercent,
} from "../src/lib/format";

describe("Time/period formatting is pinned to UTC, not the runtime's local zone", () => {
  test("formatPeriod shows the inclusive last day for an exclusive end boundary", () => {
    // getPeriod(): [2026-08-01, 2026-08-13) — the label should read the
    // last day the data actually covers, not the exclusive boundary itself.
    const label = formatPeriod(
      "2026-08-01T00:00:00.000+03:00",
      "2026-08-13T00:00:00.000+03:00",
    );
    assert.equal(label, "Aug 1 – 12, 2026 UTC");
  });

  test("formatPeriod spans a month boundary correctly", () => {
    const label = formatPeriod(
      "2026-07-28T00:00:00.000+03:00",
      "2026-08-02T00:00:00.000+03:00",
    );
    assert.equal(label, "Jul 28 – Aug 1, 2026 UTC");
  });

  test("REGRESSION: a same-day, non-midnight end boundary doesn't roll back an extra day", () => {
    // getLedgerPeriod's real contract is `end = max(ts) + 1ms` — almost
    // never a midnight boundary. Stepping back a full calendar day
    // regardless of the actual time-of-day (what an earlier version did)
    // rolls a same-day end boundary back into the PRIOR day, rendering an
    // inverted-looking range like "Sep 12 – 11" for data that's all on Sep 12.
    const label = formatPeriod(
      "2026-09-12T01:19:28.178Z",
      "2026-09-12T01:19:32.864Z", // max(ts) + 1ms, same calendar day as start
    );
    assert.equal(label, "Sep 12 – 12, 2026 UTC");
  });

  test("formatTime renders the instant in UTC regardless of process.env.TZ", () => {
    const t = formatTime("2026-08-12T11:02:11.000Z");
    assert.equal(t, "11:02:11");
  });

  test("formatDateTime also pins to UTC", () => {
    const t = formatDateTime("2026-08-12T11:02:11.000Z");
    assert.match(t, /11:02:11$/);
  });
});

describe("USDC amount formatting — numbers align, down to the millionth", () => {
  test("formatUsdcTotal keeps 2 decimals and groups thousands with a space", () => {
    assert.equal(formatUsdcTotal(1_234_567_890), "1 234.57");
  });

  test("formatUsdcPrecise always shows all 6 decimals, down to the millionth", () => {
    assert.equal(formatUsdcPrecise(1), "0.000001");
    assert.equal(formatUsdcPrecise(3_000), "0.003000");
  });

  test("formatPercent trails the sign", () => {
    assert.equal(formatPercent(0.313), "31.3%");
  });
});
