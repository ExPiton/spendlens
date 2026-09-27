CREATE TABLE "escalation" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"agentId" text NOT NULL,
	"agentSlug" text NOT NULL,
	"counterparty" text NOT NULL,
	"resource" text NOT NULL,
	"amountMicroUsdc" bigint NOT NULL,
	"ruleHit" text,
	"taskId" text,
	"nonce" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decidedBy" text,
	"decidedAt" timestamp with time zone,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_digest" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"day" date NOT NULL,
	"rowCount" integer NOT NULL,
	"digest" text NOT NULL,
	"prevDigest" text,
	"anchorTxHash" text,
	"anchorChainId" integer,
	"anchoredAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"resetAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- Reconciliation rows are derived data (ledger sums vs. Gateway transfers)
-- and are now keyed per (agent, chain, counterparty). The old per-tenant rows
-- can't be split per agent, so they're dropped here and rebuilt by the next
-- reconcile pass (the scheduled job runs one on boot).
DELETE FROM "reconciliation";--> statement-breakpoint
DROP INDEX "reconciliation_user_cp_idx";--> statement-breakpoint
ALTER TABLE "authorization" ADD COLUMN "policyHash" text;--> statement-breakpoint
ALTER TABLE "authorization" ADD COLUMN "policyVersion" integer;--> statement-breakpoint
ALTER TABLE "authorization" ADD COLUMN "ingestedAt" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "authorization" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation" ADD COLUMN "agentId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation" ADD COLUMN "chainId" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation" ADD COLUMN "alertedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reconciliation" ADD COLUMN "updatedAt" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "escalation" ADD CONSTRAINT "escalation_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation" ADD CONSTRAINT "escalation_agentId_agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_digest" ADD CONSTRAINT "ledger_digest_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "escalation_user_status_idx" ON "escalation" USING btree ("userId","status");--> statement-breakpoint
CREATE INDEX "escalation_agent_idx" ON "escalation" USING btree ("agentId");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_digest_user_day_idx" ON "ledger_digest" USING btree ("userId","day");--> statement-breakpoint
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_agentId_agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "authorization_user_ingested_idx" ON "authorization" USING btree ("userId","ingestedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_agent_chain_cp_idx" ON "reconciliation" USING btree ("agentId","chainId","counterparty");--> statement-breakpoint
-- Existing rows: bucket them by when they were recorded.
UPDATE "authorization" SET "ingestedAt" = "createdAt";--> statement-breakpoint
-- One canonical spelling per counterparty (EVM addresses / hostnames are
-- case-insensitive; Gateway reports lowercase). Must run before the
-- append-only trigger below exists.
UPDATE "authorization" SET "counterparty" = lower(btrim("counterparty"))
  WHERE "counterparty" <> lower(btrim("counterparty"));--> statement-breakpoint
UPDATE "agent" SET "walletAddress" = lower(btrim("walletAddress"))
  WHERE "walletAddress" IS NOT NULL AND "walletAddress" <> lower(btrim("walletAddress"));--> statement-breakpoint
-- Append-only ledger, enforced by the database: no UPDATE, no direct DELETE,
-- no TRUNCATE. A DELETE arriving through a foreign-key cascade (deleting the
-- owning agent or user — i.e. account deletion) runs inside the RI trigger,
-- so pg_trigger_depth() > 1, and is let through.
CREATE OR REPLACE FUNCTION spendlens_ledger_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'spendlens: the authorization ledger is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "authorization_append_only"
  BEFORE UPDATE OR DELETE ON "authorization"
  FOR EACH ROW EXECUTE FUNCTION spendlens_ledger_append_only();--> statement-breakpoint
CREATE TRIGGER "authorization_no_truncate"
  BEFORE TRUNCATE ON "authorization"
  FOR EACH STATEMENT EXECUTE FUNCTION spendlens_ledger_append_only();