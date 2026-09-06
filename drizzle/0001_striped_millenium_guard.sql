DROP INDEX "authorization_agent_external_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "authorization_agent_external_id_idx" ON "authorization" USING btree ("agentId","externalId");