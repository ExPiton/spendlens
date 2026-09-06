CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"agentId" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"keyHash" text NOT NULL,
	"lastUsedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"revokedAt" timestamp with time zone,
	CONSTRAINT "api_key_keyHash_unique" UNIQUE("keyHash")
);
--> statement-breakpoint
CREATE TABLE "authorization" (
	"id" text PRIMARY KEY NOT NULL,
	"externalId" text,
	"userId" text NOT NULL,
	"agentId" text NOT NULL,
	"agentSlug" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"taskId" text,
	"counterparty" text NOT NULL,
	"resource" text NOT NULL,
	"amountMicroUsdc" bigint NOT NULL,
	"decision" text NOT NULL,
	"ruleHit" text,
	"nonce" text,
	"chainId" integer,
	"httpStatus" integer,
	"latencyMs" integer,
	"bodyBytes" integer,
	"bodySha256" text,
	"quality" text,
	"settlementId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy" (
	"id" text PRIMARY KEY NOT NULL,
	"agentId" text NOT NULL,
	"userId" text NOT NULL,
	"rawYaml" text NOT NULL,
	"config" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_agentId_unique" UNIQUE("agentId")
);
--> statement-breakpoint
CREATE TABLE "reconciliation" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"counterparty" text NOT NULL,
	"periodStart" timestamp with time zone NOT NULL,
	"periodEnd" timestamp with time zone NOT NULL,
	"chainAmountMicroUsdc" bigint NOT NULL,
	"ledgerAmountMicroUsdc" bigint NOT NULL,
	"deltaMicroUsdc" bigint NOT NULL,
	"toleranceMicroUsdc" bigint NOT NULL,
	"status" text NOT NULL,
	"settlementId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_agentId_agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization" ADD CONSTRAINT "authorization_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization" ADD CONSTRAINT "authorization_agentId_agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy" ADD CONSTRAINT "policy_agentId_agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy" ADD CONSTRAINT "policy_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_user_slug_idx" ON "agent" USING btree ("userId","slug");--> statement-breakpoint
CREATE INDEX "agent_user_id_idx" ON "agent" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "api_key_agent_id_idx" ON "api_key" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "api_key_user_id_idx" ON "api_key" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "authorization_user_ts_idx" ON "authorization" USING btree ("userId","ts");--> statement-breakpoint
CREATE INDEX "authorization_agent_ts_idx" ON "authorization" USING btree ("agentId","ts");--> statement-breakpoint
CREATE INDEX "authorization_user_counterparty_idx" ON "authorization" USING btree ("userId","counterparty");--> statement-breakpoint
CREATE INDEX "authorization_user_decision_idx" ON "authorization" USING btree ("userId","decision");--> statement-breakpoint
CREATE UNIQUE INDEX "authorization_agent_external_id_idx" ON "authorization" USING btree ("agentId","externalId") WHERE "authorization"."externalId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_user_cp_period_idx" ON "reconciliation" USING btree ("userId","counterparty","periodStart");--> statement-breakpoint
CREATE INDEX "reconciliation_user_id_idx" ON "reconciliation" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");