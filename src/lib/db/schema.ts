import { randomUUID } from "node:crypto";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Single source of truth for the Postgres schema. The four auth tables
 * (`user`, `session`, `account`, `verification`) match what Better Auth's
 * Drizzle adapter expects field-for-field. The domain tables mirror the Zod
 * contracts in `src/lib/contracts/` — see the repository layer for the
 * row ⇄ contract mapping — with a `userId` column added everywhere for
 * per-tenant isolation.
 */

const uuid = () => text().$defaultFn(() => randomUUID());
const createdAt = () =>
  timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow();

// ── Auth (Better Auth) ──────────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true, mode: "date" }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true, mode: "date" }),
    scope: text(),
    password: text(),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ── Domain ──────────────────────────────────────────────────────────────────

/** An AI agent whose spend a user is overseeing. `slug` is the public agent id
 *  used in policy files, the SDK, and every contract's `agentId` field. */
export const agent = pgTable(
  "agent",
  {
    id: uuid().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    label: text().notNull(),
    // "active" | "paused" — the dashboard kill switch flips this.
    status: text().notNull().default("active"),
    /** The agent's Arc wallet address (EOA that funds Nanopayments via Circle
     *  Gateway). Public; used to reconcile against on-chain settlement. */
    walletAddress: text(),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_user_slug_idx").on(t.userId, t.slug),
    index("agent_user_id_idx").on(t.userId),
  ],
);

/** A bearer key an agent uses to authenticate ingest calls to
 *  `POST /api/authorizations`. Only the SHA-256 hash is stored. */
export const apiKey = pgTable(
  "api_key",
  {
    id: uuid().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentId: text()
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    name: text().notNull(),
    prefix: text().notNull(),
    keyHash: text().notNull().unique(),
    lastUsedAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    revokedAt: timestamp({ withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("api_key_agent_id_idx").on(t.agentId),
    index("api_key_user_id_idx").on(t.userId),
  ],
);

/** One declarative policy per agent. Replaces the on-disk `policies/*.yaml`. */
export const policy = pgTable("policy", {
  id: uuid().primaryKey(),
  agentId: text()
    .notNull()
    .unique()
    .references(() => agent.id, { onDelete: "cascade" }),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  rawYaml: text().notNull(),
  config: jsonb().notNull(),
  version: integer().notNull().default(1),
  updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Append-only ledger — one row per authorization decision. Mirrors
 *  `AuthorizationRecordSchema`; `id` here is DB-issued, `externalId` keeps the
 *  SDK's own id, and `agentSlug` is the contract's `agentId`.
 *
 *  Append-only is enforced in Postgres, not just by convention: a trigger
 *  (migration 0004) rejects every UPDATE and every direct DELETE; only the
 *  cascade from deleting the owning agent/user (account deletion) gets
 *  through. `seq` + `ingestedAt` give the daily digest (`ledger_digest`) a
 *  total, insertion-time order: a row can't be slipped into a day that has
 *  already been digested. */
export const authorization = pgTable(
  "authorization",
  {
    id: uuid().primaryKey(),
    externalId: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentId: text()
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    agentSlug: text().notNull(),
    ts: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    taskId: text(),
    counterparty: text().notNull(),
    resource: text().notNull(),
    amountMicroUsdc: bigint({ mode: "number" }).notNull(),
    decision: text().notNull(),
    ruleHit: text(),
    nonce: text(),
    chainId: integer(),
    httpStatus: integer(),
    latencyMs: integer(),
    bodyBytes: integer(),
    bodySha256: text(),
    quality: text(),
    settlementId: text(),
    /** SHA-256 of the policy the decision was evaluated against. */
    policyHash: text(),
    /** Dashboard policy version (remote sync), when known. */
    policyVersion: integer(),
    createdAt: createdAt(),
    /** Server receive time — what the daily digest buckets by. */
    ingestedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    seq: bigserial({ mode: "number" }).notNull(),
  },
  (t) => [
    index("authorization_user_ts_idx").on(t.userId, t.ts),
    index("authorization_user_ingested_idx").on(t.userId, t.ingestedAt),
    index("authorization_agent_ts_idx").on(t.agentId, t.ts),
    index("authorization_user_counterparty_idx").on(t.userId, t.counterparty),
    index("authorization_user_decision_idx").on(t.userId, t.decision),
    // Postgres treats NULLs as distinct, so rows without an externalId never
    // collide here; rows that carry one (demo seed, SDK ingest) are deduped.
    uniqueIndex("authorization_agent_external_id_idx").on(t.agentId, t.externalId),
  ],
);

/** Per (agent, Arc chain, counterparty) comparison of on-chain settlement vs.
 *  the local ledger. Mirrors `ReconciliationRecordSchema`. Per agent because
 *  Gateway reports transfers per wallet; per chain so testnet and mainnet
 *  settlements are never summed against each other. */
export const reconciliation = pgTable(
  "reconciliation",
  {
    id: uuid().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentId: text()
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    chainId: integer().notNull(),
    counterparty: text().notNull(),
    periodStart: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    periodEnd: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    chainAmountMicroUsdc: bigint({ mode: "number" }).notNull(),
    ledgerAmountMicroUsdc: bigint({ mode: "number" }).notNull(),
    deltaMicroUsdc: bigint({ mode: "number" }).notNull(),
    toleranceMicroUsdc: bigint({ mode: "number" }).notNull(),
    status: text().notNull(),
    settlementId: text(),
    /** When the critical alert for the current divergence went out — so a
     *  standing mismatch alerts once, not on every reconcile pass. */
    alertedAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reconciliation_agent_chain_cp_idx").on(t.agentId, t.chainId, t.counterparty),
    index("reconciliation_user_id_idx").on(t.userId),
  ],
);

/** A `hold` waiting on (or decided by) a human. `/api/escalate` creates it;
 *  the SDK polls `/api/escalate/<id>`; the dashboard's Approvals page decides. */
export const escalation = pgTable(
  "escalation",
  {
    id: uuid().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentId: text()
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    agentSlug: text().notNull(),
    counterparty: text().notNull(),
    resource: text().notNull(),
    amountMicroUsdc: bigint({ mode: "number" }).notNull(),
    ruleHit: text(),
    taskId: text(),
    nonce: text(),
    // "pending" | "approved" | "denied" | "expired"
    status: text().notNull().default("pending"),
    /** "auto" for the auto-approve ceiling, else the deciding user's id. */
    decidedBy: text(),
    decidedAt: timestamp({ withTimezone: true, mode: "date" }),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("escalation_user_status_idx").on(t.userId, t.status),
    index("escalation_agent_idx").on(t.agentId),
  ],
);

/** Tamper-evidence for the ledger: one hash-chained digest per tenant per UTC
 *  day of `ingestedAt`, optionally anchored on Arc (see `lib/digest`). */
export const ledgerDigest = pgTable(
  "ledger_digest",
  {
    id: uuid().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    day: date({ mode: "string" }).notNull(),
    rowCount: integer().notNull(),
    /** sha256 over the day's rows in `seq` order, chained to `prevDigest`. */
    digest: text().notNull(),
    prevDigest: text(),
    anchorTxHash: text(),
    anchorChainId: integer(),
    anchoredAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ledger_digest_user_day_idx").on(t.userId, t.day)],
);

/** Shared fixed-window counters for `RATE_LIMIT_STORE=postgres` (multi-instance). */
export const rateLimit = pgTable("rate_limit", {
  key: text().primaryKey(),
  count: integer().notNull(),
  resetAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
});

export type AgentRow = typeof agent.$inferSelect;
export type ApiKeyRow = typeof apiKey.$inferSelect;
export type PolicyRow = typeof policy.$inferSelect;
export type AuthorizationRow = typeof authorization.$inferSelect;
export type ReconciliationRow = typeof reconciliation.$inferSelect;
export type EscalationRow = typeof escalation.$inferSelect;
export type LedgerDigestRow = typeof ledgerDigest.$inferSelect;
