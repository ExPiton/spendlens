import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * Integration tests against a real Postgres — the SQL aggregates in
 * repository.ts (GROUP BY / FILTER, replacing the old fetch-200k-rows-and-
 * reduce-in-JS approach) and insertAuthorizations' per-record validation
 * only mean something verified against the actual database engine, not a
 * mock. Run with DATABASE_URL pointing at a throwaway Postgres, AND the
 * `react-server` module-resolution condition (the app code imports
 * `server-only`, which throws under Node's default `require` unless that
 * condition is set — normally supplied by Next.js's bundler, not present
 * under plain `tsx`):
 *
 *   docker run -d --name spendlens-test-db -e POSTGRES_USER=spendlens \
 *     -e POSTGRES_PASSWORD=testpass -e POSTGRES_DB=spendlens_test \
 *     -p 15432:5432 postgres:16-alpine
 *   DATABASE_URL=postgres://spendlens:testpass@127.0.0.1:15432/spendlens_test \
 *     npm run db:migrate
 *   NODE_OPTIONS=--conditions=react-server \
 *   DATABASE_URL=postgres://spendlens:testpass@127.0.0.1:15432/spendlens_test \
 *     npx tsx --test test/repository.test.ts
 *
 * Everything that touches the database is imported dynamically, gated on
 * DATABASE_URL being set — importing db/repository/ingest at the top level
 * unconditionally (a normal `import`) would hit that `server-only` throw
 * immediately for every `npm test` run, whether or not this suite runs.
 */
const RUN = Boolean(process.env.DATABASE_URL);

type Repo = typeof import("../src/lib/db/repository");
type Ingest = typeof import("../src/lib/db/ingest");
type DbMod = typeof import("../src/lib/db");

let repo: Repo;
let ingest: Ingest;
let dbMod: DbMod;

async function makeUserAndAgent(label: string) {
  const userId = `test-user-${randomUUID()}`;
  const agentId = randomUUID();
  const slug = `test-agent-${randomUUID().slice(0, 8)}`;
  await dbMod.db.insert(dbMod.schema.user).values({
    id: userId,
    name: label,
    email: `${userId}@example.test`,
  });
  await dbMod.db.insert(dbMod.schema.agent).values({
    id: agentId,
    userId,
    slug,
    label,
  });
  return { userId, agentId, slug };
}

function record(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: `auth_${randomUUID()}`,
    ts: now.toISOString(),
    agentId: "unused-the-key-scope-wins",
    taskId: null,
    counterparty: "api.example.io",
    resource: "https://api.example.io/v1/data",
    amountMicroUsdc: 3000,
    decision: "allow",
    ruleHit: null,
    nonce: randomUUID(),
    chainId: 5042002,
    httpStatus: 200,
    latencyMs: 120,
    bodyBytes: 256,
    bodySha256: "a".repeat(64),
    quality: "ok",
    settlementId: null,
    createdAt: now.toISOString(),
    ...overrides,
  };
}

describe("repository (SQL aggregates) — integration", { skip: !RUN }, () => {
  before(async () => {
    if (!RUN) return;
    [repo, ingest, dbMod] = await Promise.all([
      import("../src/lib/db/repository"),
      import("../src/lib/db/ingest"),
      import("../src/lib/db"),
    ]);
  });

  after(async () => {
    if (!RUN) return;
    // postgres-js keeps the pool open; close it so `tsx --test` can exit.
    const client = (dbMod.db as unknown as { $client?: { end(): Promise<void> } }).$client;
    await client?.end?.();
  });

  it("insertAuthorizations: valid records land, one bad record doesn't sink the batch (REGRESSION)", async () => {
    const { userId, agentId, slug } = await makeUserAndAgent("ingest-test");
    const result = await ingest.insertAuthorizations(
      { userId, agentId, agentSlug: slug },
      [
        record({ amountMicroUsdc: 1000 }),
        { totally: "not a valid authorization record" }, // must be skipped, not throw
        record({ amountMicroUsdc: 2000 }),
      ],
    );
    assert.equal(result.ingested, 2, "the 2 valid records must be ingested");
    assert.equal(result.invalid, 1, "the malformed record must be counted, not thrown");

    const { records } = await repo.listAuthorizations(userId, { pageSize: 10 });
    assert.equal(records.length, 2);
  });

  it("insertAuthorizations: retrying the same batch is idempotent (externalId dedup)", async () => {
    const { userId, agentId, slug } = await makeUserAndAgent("dedup-test");
    const batch = [record({ id: "auth_fixed_1" }), record({ id: "auth_fixed_2" })];
    const first = await ingest.insertAuthorizations({ userId, agentId, agentSlug: slug }, batch);
    const second = await ingest.insertAuthorizations({ userId, agentId, agentSlug: slug }, batch);
    assert.equal(first.ingested, 2);
    assert.equal(second.ingested, 0);
    assert.equal(second.skipped, 2);
  });

  it("listAgents / getAgent: SQL aggregates match hand-computed totals across decisions and quality", async () => {
    const { userId, agentId, slug } = await makeUserAndAgent("agg-test");
    await ingest.insertAuthorizations({ userId, agentId, agentSlug: slug }, [
      record({ decision: "allow", quality: "ok", amountMicroUsdc: 1000, counterparty: "a.io" }),
      record({ decision: "allow", quality: "empty", amountMicroUsdc: 500, counterparty: "b.io" }),
      record({ decision: "block", quality: null, amountMicroUsdc: 9999, ruleHit: "per_call.max_usdc" }),
      record({ decision: "hold_denied", quality: null, amountMicroUsdc: 4242, ruleHit: "x" }),
      record({ decision: "hold_approved", quality: "ok", amountMicroUsdc: 300, counterparty: "c.io" }),
    ]);

    const [summary] = await repo.listAgents(userId);
    assert.equal(summary.agentId, slug);
    // totalSpend counts what was paid — 'allow' + 'hold_approved':
    // 1000 + 500 + 300 = 1800 (an approved hold is real spend)
    assert.equal(summary.totalSpendMicroUsdc, 1800);
    // wasted counts paid calls with quality != 'ok': the 500 (empty) one
    assert.equal(summary.wastedMicroUsdc, 500);
    assert.equal(summary.allowedCount, 2);
    assert.equal(summary.blockedCount, 2); // block + hold_denied
    assert.equal(summary.holdCount, 2); // hold_approved + hold_denied
    // a.io, b.io, c.io, plus the default counterparty on the 2 un-overridden
    // block/hold_denied records.
    assert.equal(summary.counterpartyCount, 4);

    const single = await repo.getAgent(userId, slug);
    assert.equal(single?.totalSpendMicroUsdc, 1800);
    assert.equal(single?.label, "agg-test");
  });

  it("listAgents: an agent with zero authorization rows still appears, zero-filled", async () => {
    const { userId, slug } = await makeUserAndAgent("empty-agent-test");
    const [summary] = await repo.listAgents(userId);
    assert.equal(summary.agentId, slug);
    assert.equal(summary.totalSpendMicroUsdc, 0);
    assert.equal(summary.allowedCount, 0);
    assert.equal(summary.lastActivityTs, null);
  });

  it("getOverviewStats: totals, wasted ratio, and blocked amount match SQL-computed expectations", async () => {
    const { userId, agentId, slug } = await makeUserAndAgent("overview-test");
    await ingest.insertAuthorizations({ userId, agentId, agentSlug: slug }, [
      record({ decision: "allow", quality: "ok", amountMicroUsdc: 4000 }),
      record({ decision: "allow", quality: "timeout", amountMicroUsdc: 1000 }),
      record({ decision: "block", amountMicroUsdc: 250 }),
    ]);

    const stats = await repo.getOverviewStats(userId, repo.ALL_AGENTS);
    assert.equal(stats.totalSpendMicroUsdc, 5000);
    assert.equal(stats.wastedMicroUsdc, 1000);
    assert.equal(stats.wastedRatio, 0.2);
    assert.equal(stats.blockedCount, 1);
    assert.equal(stats.blockedMicroUsdc, 250);

    const scoped = await repo.getOverviewStats(userId, slug);
    assert.equal(scoped.totalSpendMicroUsdc, 5000);
  });

  it("listCounterparties / getCounterparty: per-counterparty spend, quality score, and first-seen", async () => {
    const { userId, agentId, slug } = await makeUserAndAgent("cp-test");
    await ingest.insertAuthorizations({ userId, agentId, agentSlug: slug }, [
      record({ counterparty: "good.io", decision: "allow", quality: "ok", amountMicroUsdc: 100 }),
      record({ counterparty: "good.io", decision: "allow", quality: "ok", amountMicroUsdc: 200 }),
      record({ counterparty: "flaky.io", decision: "allow", quality: "ok", amountMicroUsdc: 50 }),
      record({ counterparty: "flaky.io", decision: "allow", quality: "http_error", amountMicroUsdc: 50 }),
    ]);

    const list = await repo.listCounterparties(userId);
    const good = list.find((c) => c.counterparty === "good.io");
    const flaky = list.find((c) => c.counterparty === "flaky.io");
    assert.equal(good?.totalSpendMicroUsdc, 300);
    assert.equal(good?.qualityScore, 1);
    assert.equal(flaky?.qualityScore, 0.5, "1 of 2 quality-eligible calls was ok");

    const single = await repo.getCounterparty(userId, "good.io");
    assert.equal(single?.callCount, 2);

    assert.equal(await repo.getCounterparty(userId, "never-called.io"), null);
  });

  it("importSettlements: per agent + chain; approved holds count as spend; addresses match case-insensitively", async () => {
    const { userId, agentId, slug } = await makeUserAndAgent("recon-test");
    const addr = "0xAbCdEf0000000000000000000000000000000abc";
    await ingest.insertAuthorizations({ userId, agentId, agentSlug: slug }, [
      record({ counterparty: addr, decision: "allow", amountMicroUsdc: 10_000 }),
      // approved hold — it was paid, so the ledger side must include it
      record({ counterparty: addr, decision: "hold_approved", amountMicroUsdc: 5_000 }),
      record({ counterparty: addr, decision: "hold_denied", amountMicroUsdc: 99_000 }),
      // same counterparty on the other Arc network — never summed with testnet
      record({ counterparty: addr, decision: "allow", amountMicroUsdc: 70_000, chainId: 5042 }),
    ]);

    // Gateway reports lowercase; ledger rows were ingested checksummed.
    const ok = await repo.importSettlements({ userId, agentId }, 5042002, [
      { counterparty: addr.toLowerCase(), chainAmountMicroUsdc: 15_000, settlementId: "t1" },
    ], { snapshot: true });
    assert.equal(ok.length, 1, "one canonical counterparty, not two spellings");
    assert.equal(ok[0].ledgerAmountMicroUsdc, 15_000, "allow + hold_approved, testnet only");
    assert.equal(ok[0].status, "ok");

    // More on-chain than the ledger recorded → critical, flagged for alerting once.
    const crit = await repo.importSettlements({ userId, agentId }, 5042002, [
      { counterparty: addr, chainAmountMicroUsdc: 515_000 },
    ], { snapshot: true });
    assert.equal(crit[0].status, "critical");
    assert.equal(crit[0].needsAlert, true);
    await repo.markReconciliationAlerted(crit.map((r) => r.id));
    const again = await repo.importSettlements({ userId, agentId }, 5042002, [
      { counterparty: addr, chainAmountMicroUsdc: 515_000 },
    ], { snapshot: true });
    assert.equal(again[0].needsAlert, false, "a standing divergence alerts once");

    const rows = await repo.listReconciliation(userId, slug);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].agentId, slug);
    assert.equal(rows[0].chainId, 5042002);
    const stats = await repo.getOverviewStats(userId, slug);
    assert.equal(stats.reconciliationStatus, "critical");
  });

  it("reconciliation rows of one agent don't leak into another agent's overview", async () => {
    const a = await makeUserAndAgent("recon-a");
    const bAgentId = randomUUID();
    const bSlug = `b-${randomUUID().slice(0, 8)}`;
    await dbMod.db.insert(dbMod.schema.agent).values({ id: bAgentId, userId: a.userId, slug: bSlug, label: "b" });
    await ingest.insertAuthorizations({ userId: a.userId, agentId: a.agentId, agentSlug: a.slug }, [
      record({ counterparty: "shared.io", amountMicroUsdc: 1_000 }),
    ]);
    await ingest.insertAuthorizations({ userId: a.userId, agentId: bAgentId, agentSlug: bSlug }, [
      record({ counterparty: "shared.io", amountMicroUsdc: 2_000 }),
    ]);
    await repo.importSettlements({ userId: a.userId, agentId: a.agentId }, 5042002, [
      { counterparty: "shared.io", chainAmountMicroUsdc: 1_000 },
    ]);
    await repo.importSettlements({ userId: a.userId, agentId: bAgentId }, 5042002, [
      { counterparty: "shared.io", chainAmountMicroUsdc: 900_000 },
    ]);
    assert.equal((await repo.getOverviewStats(a.userId, a.slug)).reconciliationStatus, "ok");
    assert.equal((await repo.getOverviewStats(a.userId, bSlug)).reconciliationStatus, "critical");
  });

  it("the ledger is append-only in the database; deleting the agent still cascades", async () => {
    const { userId, agentId, slug } = await makeUserAndAgent("append-only");
    await ingest.insertAuthorizations({ userId, agentId, agentSlug: slug }, [record()]);
    const { sql } = await import("drizzle-orm");
    const appendOnly = (err: unknown) =>
      /append-only/.test(String((err as { cause?: { message?: string } })?.cause?.message ?? err));
    await assert.rejects(
      dbMod.db.execute(sql`update "authorization" set "amountMicroUsdc" = 1 where "agentId" = ${agentId}`),
      appendOnly,
    );
    await assert.rejects(
      dbMod.db.execute(sql`delete from "authorization" where "agentId" = ${agentId}`),
      appendOnly,
    );
    await dbMod.db.execute(sql`delete from "agent" where "id" = ${agentId}`);
    const [left] = await dbMod.db.execute<{ n: number }>(
      sql`select count(*)::int as n from "authorization" where "agentId" = ${agentId}`,
    );
    assert.equal(left.n, 0, "account/agent deletion cascades through the trigger");
  });

  it("ledger digests: sealed per UTC day, verified, and a tampered row breaks verification", async () => {
    const digest = await import("../src/lib/digest");
    const { sql } = await import("drizzle-orm");
    const { userId, agentId, slug } = await makeUserAndAgent("digest");
    await ingest.insertAuthorizations({ userId, agentId, agentSlug: slug }, [
      record({ amountMicroUsdc: 111 }),
      record({ amountMicroUsdc: 222 }),
    ]);
    // Seal "yesterday" relative to a clock one day ahead, so today's rows are a complete day.
    const tomorrow = new Date(Date.now() + 86_400_000);
    await digest.sealDigests(tomorrow);
    let [d] = await digest.listDigests(userId);
    assert.equal(d.rowCount, 2);
    assert.equal(d.verified, true);

    // Simulate someone with raw DB access bypassing the trigger.
    await dbMod.db.execute(sql`alter table "authorization" disable trigger "authorization_append_only"`);
    try {
      await dbMod.db.execute(sql`update "authorization" set "amountMicroUsdc" = 1 where "agentId" = ${agentId} and "amountMicroUsdc" = 222`);
    } finally {
      await dbMod.db.execute(sql`alter table "authorization" enable trigger "authorization_append_only"`);
    }
    [d] = await digest.listDigests(userId);
    assert.equal(d.verified, false, "the digest no longer matches the ledger");
  });

  it("escalations: pending → decided once; late or foreign decisions are refused", async () => {
    const esc = await import("../src/lib/db/escalations");
    const { userId, agentId, slug } = await makeUserAndAgent("escalation");
    const created = await esc.createEscalation({
      userId, agentId, agentSlug: slug, counterparty: "x.io", resource: "r",
      amountMicroUsdc: 50_000, ruleHit: "counterparties.first_seen.action",
      taskId: null, nonce: null, expiresAt: new Date(Date.now() + 60_000),
    });
    assert.equal(created.status, "pending");
    assert.equal(await esc.decideEscalation("someone-else", created.id, true, "x"), null);
    const approved = await esc.decideEscalation(userId, created.id, true, userId);
    assert.equal(approved?.status, "approved");
    assert.equal(await esc.decideEscalation(userId, created.id, false, userId), null, "already decided");
    assert.equal((await esc.getEscalationForAgent(agentId, created.id))?.status, "approved");

    const expired = await esc.createEscalation({
      userId, agentId, agentSlug: slug, counterparty: "x.io", resource: "r",
      amountMicroUsdc: 1, ruleHit: null, taskId: null, nonce: null, expiresAt: new Date(Date.now() - 1),
    });
    assert.equal(expired.status, "expired");
    assert.equal(await esc.decideEscalation(userId, expired.id, true, userId), null);
  });

  it("RATE_LIMIT_STORE=postgres: one shared counter across callers", async () => {
    const { enforceRateLimit } = await import("../src/lib/rate-limit");
    const prev = process.env.RATE_LIMIT_STORE;
    process.env.RATE_LIMIT_STORE = "postgres";
    try {
      const key = `pg-rl-${randomUUID()}`;
      for (let i = 0; i < 3; i++) {
        const r = await enforceRateLimit(key, 3);
        assert.ok("headers" in r, `call ${i + 1} allowed`);
      }
      const over = await enforceRateLimit(key, 3);
      assert.ok("response" in over, "4th call rejected");
      if ("response" in over) assert.equal(over.response.status, 429);
    } finally {
      process.env.RATE_LIMIT_STORE = prev;
    }
  });
});
