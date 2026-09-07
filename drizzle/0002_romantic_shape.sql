DROP INDEX "reconciliation_user_cp_period_idx";--> statement-breakpoint
-- collapse any pre-existing per-period duplicates before the tighter unique index
DELETE FROM "reconciliation" a
  USING "reconciliation" b
  WHERE a.ctid < b.ctid
    AND a."userId" = b."userId"
    AND a.counterparty = b.counterparty;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_user_cp_idx" ON "reconciliation" USING btree ("userId","counterparty");
