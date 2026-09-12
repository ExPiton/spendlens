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
    // totalSpend counts only 'allow' decisions: 1000 + 500 = 1500
    assert.equal(summary.totalSpendMicroUsdc, 1500);
    // wasted counts 'allow' with quality != 'ok': the 500 (empty) one
    assert.equal(summary.wastedMicroUsdc, 500);
    assert.equal(summary.allowedCount, 2);
    assert.equal(summary.blockedCount, 2); // block + hold_denied
    assert.equal(summary.holdCount, 2); // hold_approved + hold_denied
    // a.io, b.io, c.io, plus the default counterparty on the 2 un-overridden
    // block/hold_denied records.
    assert.equal(summary.counterpartyCount, 4);

    const single = await repo.getAgent(userId, slug);
    assert.equal(single?.totalSpendMicroUsdc, 1500);
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

  it("recomputeReconciliation / importSettlements: ledger-vs-chain classification uses real SQL period sums", async () => {
    const { userId, agentId, slug } = await makeUserAndAgent("recon-test");
    await ingest.insertAuthorizations({ userId, agentId, agentSlug: slug }, [
      record({ counterparty: "settle.io", decision: "allow", amountMicroUsdc: 10_000 }),
      record({ counterparty: "settle.io", decision: "allow", amountMicroUsdc: 5_000 }),
    ]);

    // No chain data yet -> recompute seeds chain == ledger (status ok).
    await repo.recomputeReconciliation(userId);
    const before = await repo.getCounterparty(userId, "settle.io");
    assert.ok(before);

    // Feed a chain amount that diverges well beyond tolerance — MORE
    // settled on-chain than the ledger recorded, i.e. unlogged spend.
    await repo.importSettlements(userId, [
      { counterparty: "settle.io", chainAmountMicroUsdc: 20_000 }, // ledger says 15,000
    ]);

    const stats = await repo.getOverviewStats(userId, repo.ALL_AGENTS);
    assert.equal(stats.reconciliationStatus, "critical", "chain(20k) > ledger(15k) beyond tolerance");
  });
});
