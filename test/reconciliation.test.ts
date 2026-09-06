import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classifyReconciliation,
  sumAllowedLedgerAmount,
} from "../src/lib/engine/reconciliation";
import type { AuthorizationRecord } from "../src/lib/contracts";

describe("Arc Reconciliation Audit Engine", () => {
  const tolerance = 50; // 50 micro-USDC (0.00005 USDC)

  test("within tolerance produces status ok", () => {
    const res = classifyReconciliation(1000000, 1000020, tolerance);
    assert.equal(res.status, "ok");
    assert.equal(res.deltaMicroUsdc, -20);
  });

  test("chain > ledger beyond tolerance produces status critical (suspected unauthorized signature)", () => {
    // 1.50 USDC on chain, 1.00 USDC in local ledger -> 0.50 USDC phantom settlement!
    const res = classifyReconciliation(1500000, 1000000, tolerance);
    assert.equal(res.status, "critical");
    assert.equal(res.deltaMicroUsdc, 500000);
  });

  test("chain < ledger beyond tolerance produces status pending (in-flight batch settlement)", () => {
    // 0.80 USDC settled on chain, 1.00 USDC allowed locally -> 0.20 USDC in flight
    const res = classifyReconciliation(800000, 1000000, tolerance);
    assert.equal(res.status, "pending");
    assert.equal(res.deltaMicroUsdc, -200000);
  });

  test("sumAllowedLedgerAmount only counts 'allow' decisions within the active period", () => {
    const periodStart = "2026-08-01T00:00:00.000+03:00";
    const periodEnd = "2026-08-13T00:00:00.000+03:00";

    const mockRecords: Pick<
      AuthorizationRecord,
      "counterparty" | "decision" | "amountMicroUsdc" | "ts"
    >[] = [
      {
        counterparty: "api.example.io",
        decision: "allow",
        amountMicroUsdc: 3000,
        ts: "2026-08-05T12:00:00.000+03:00",
      },
      {
        counterparty: "api.example.io",
        decision: "block", // Blocked! Must NOT count toward settlement
        amountMicroUsdc: 4500,
        ts: "2026-08-05T12:05:00.000+03:00",
      },
      {
        counterparty: "api.example.io",
        decision: "allow",
        amountMicroUsdc: 2000,
        ts: "2026-08-06T12:00:00.000+03:00",
      },
      {
        counterparty: "other.service.io",
        decision: "allow",
        amountMicroUsdc: 9999,
        ts: "2026-08-06T12:00:00.000+03:00",
      },
      {
        counterparty: "api.example.io",
        decision: "allow",
        amountMicroUsdc: 10000,
        ts: "2026-08-20T12:00:00.000+03:00", // Outside period!
      },
    ];

    const sum = sumAllowedLedgerAmount(mockRecords, "api.example.io", periodStart, periodEnd);
    assert.equal(sum, 5000); // 3000 + 2000
  });
});
