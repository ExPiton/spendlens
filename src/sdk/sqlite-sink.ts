import type { AuthorizationRecord } from "@/lib/contracts";

/**
 * Self-hosted ledger: an append-only SQLite file, no Spendlens server needed.
 * Uses Node's built-in `node:sqlite` (Node ≥ 22.13 / 23.4 without a flag),
 * so the SDK gains no dependency.
 *
 *   import { guard, createSqliteLedger } from "@spendlens/sdk";
 *   const ledger = createSqliteLedger("./spendlens-ledger.db");
 *   const pay = guard({ agentId: "crawler", policy: "./policy.yaml", sink: ledger.sink });
 *
 * Append-only is enforced by the database itself: triggers abort any UPDATE
 * or DELETE on the ledger table, so a bug or a compromised process can add
 * rows but can't rewrite history. Re-sent batches are idempotent (the SDK's
 * record id is the primary key).
 */

interface StatementSync {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
  close(): void;
}

const COLUMNS = [
  "id", "ts", "agent_id", "task_id", "counterparty", "resource",
  "amount_micro_usdc", "decision", "rule_hit", "nonce", "chain_id",
  "http_status", "latency_ms", "body_bytes", "body_sha256", "quality",
  "settlement_id", "created_at", "policy_hash", "policy_version",
] as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ledger (
  id                TEXT PRIMARY KEY,
  ts                TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  task_id           TEXT,
  counterparty      TEXT NOT NULL,
  resource          TEXT NOT NULL,
  amount_micro_usdc INTEGER NOT NULL,
  decision          TEXT NOT NULL,
  rule_hit          TEXT,
  nonce             TEXT,
  chain_id          INTEGER,
  http_status       INTEGER,
  latency_ms        INTEGER,
  body_bytes        INTEGER,
  body_sha256       TEXT,
  quality           TEXT,
  settlement_id     TEXT,
  created_at        TEXT NOT NULL,
  policy_hash       TEXT,
  policy_version    INTEGER
);
CREATE INDEX IF NOT EXISTS ledger_agent_ts ON ledger (agent_id, ts);
CREATE INDEX IF NOT EXISTS ledger_counterparty ON ledger (counterparty);
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger
  BEGIN SELECT RAISE(ABORT, 'spendlens ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger
  BEGIN SELECT RAISE(ABORT, 'spendlens ledger is append-only'); END;
`;

export interface SqliteLedger {
  /** Pass as `sink` to `guard()` / `guardGateway()`. */
  sink: (records: AuthorizationRecord[]) => Promise<void>;
  /** Most recent rows first. */
  list(limit?: number): AuthorizationRecord[];
  close(): void;
}

function loadSqlite(): { DatabaseSync: new (path: string) => DatabaseSync } {
  const p = globalThis.process as unknown as { getBuiltinModule?: (id: string) => unknown };
  const mod = p?.getBuiltinModule?.("node:sqlite") as
    | { DatabaseSync: new (path: string) => DatabaseSync }
    | undefined;
  if (!mod?.DatabaseSync) {
    throw new Error(
      "createSqliteLedger needs Node's built-in node:sqlite (Node ≥ 22.13 or 23.4).",
    );
  }
  return mod;
}

export function createSqliteLedger(path: string): SqliteLedger {
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);

  const insert = db.prepare(
    `INSERT OR IGNORE INTO ledger (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`,
  );

  const toRow = (r: AuthorizationRecord): unknown[] => [
    r.id, r.ts, r.agentId, r.taskId, r.counterparty, r.resource,
    r.amountMicroUsdc, r.decision, r.ruleHit, r.nonce, r.chainId,
    r.httpStatus, r.latencyMs, r.bodyBytes, r.bodySha256, r.quality,
    r.settlementId, r.createdAt, r.policyHash ?? null, r.policyVersion ?? null,
  ];

  return {
    async sink(records) {
      db.exec("BEGIN");
      try {
        for (const r of records) insert.run(...toRow(r));
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    list(limit = 100) {
      const rows = db
        .prepare(`SELECT * FROM ledger ORDER BY ts DESC LIMIT ?`)
        .all(limit) as Record<string, unknown>[];
      return rows.map((row) => ({
        id: String(row.id),
        ts: String(row.ts),
        agentId: String(row.agent_id),
        taskId: (row.task_id as string | null) ?? null,
        counterparty: String(row.counterparty),
        resource: String(row.resource),
        amountMicroUsdc: Number(row.amount_micro_usdc),
        decision: row.decision as AuthorizationRecord["decision"],
        ruleHit: (row.rule_hit as string | null) ?? null,
        nonce: (row.nonce as string | null) ?? null,
        chainId: row.chain_id === null ? null : Number(row.chain_id),
        httpStatus: row.http_status === null ? null : Number(row.http_status),
        latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
        bodyBytes: row.body_bytes === null ? null : Number(row.body_bytes),
        bodySha256: (row.body_sha256 as string | null) ?? null,
        quality: (row.quality as AuthorizationRecord["quality"]) ?? null,
        settlementId: (row.settlement_id as string | null) ?? null,
        createdAt: String(row.created_at),
        policyHash: (row.policy_hash as string | null) ?? null,
        policyVersion: row.policy_version === null ? null : Number(row.policy_version),
      }));
    },
    close() {
      db.close();
    },
  };
}
