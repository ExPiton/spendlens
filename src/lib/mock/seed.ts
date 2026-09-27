import type {
  AuthorizationRecord,
  Decision,
  Quality,
  ReconciliationRecord,
} from "@/lib/contracts";
import { classifyReconciliation, sumSpentLedgerAmount } from "@/lib/engine";
import { Rng } from "./rng";

/**
 * Deterministic demo dataset for a fixed 12-day window. Generated once per
 * server process and cached — see the repository layer for how this gets
 * consumed. Nothing here is fetched or persisted; swapping this module for
 * a real SQLite/Postgres-backed reader is the intended next step and
 * shouldn't require touching `repository.ts`'s exported signatures.
 */

const SEED = 20260812;
/** Demo rows are Arc testnet rows. */
const DEMO_CHAIN_ID = 5042002;
const TZ = "Z"; // every timestamp this module produces is UTC
const PERIOD_DAYS = 12;
const PERIOD_START = `2026-08-01T00:00:00.000${TZ}`;
const PERIOD_END = `2026-08-13T00:00:00.000${TZ}`; // exclusive

const PER_CALL_MAX_USDC = 0.05;
const AUTO_ALLOW_BELOW_USDC = 0.001;
const FAILURE_STATUS_CODES = [402, 429, 500, 502, 503, 504];
const RESOURCE_PATHS = ["v1/data", "v1/query", "v1/summary", "v1/records", "v1/status"];

function pad(n: number, len = 2): string {
  return String(Math.max(0, Math.trunc(n))).padStart(len, "0");
}

function isoAt(
  dayIndex: number,
  hour: number,
  minute: number,
  second: number,
  ms = 0,
): string {
  const day = 1 + dayIndex;
  return `2026-08-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.${pad(ms, 3)}${TZ}`;
}

/**
 * Formats an absolute epoch instant as an ISO string in this module's own
 * style. Needed wherever a timestamp is computed as an offset from another
 * timestamp (rather than from fixed day/hour/minute fields) — using
 * `Date#toISOString()` would be equivalent here since both are UTC, but
 * going through the same `pad`-based formatter as `isoAt` keeps every
 * timestamp in this file built the same way.
 */
function isoFromEpoch(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}${TZ}`;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export interface AgentProfile {
  id: string;
  label: string;
  callsPerDay: [number, number];
  amountRangeUsdc: [number, number];
  qualityFailRate: number;
  poolSize: number;
}

/**
 * research-crawler-01 is the flagship agent shown throughout the app's
 * demo dataset. It's the only profile with incident behavior — see
 * `buildIncidentBurst` — so the Agents screen has a genuine "this one has a
 * problem, the others don't" contrast instead of five identical agents.
 */
export const AGENT_PROFILES: AgentProfile[] = [
  {
    id: "research-crawler-01",
    label: "Research crawler",
    callsPerDay: [90, 150],
    amountRangeUsdc: [0.0006, 0.018],
    qualityFailRate: 0.3,
    poolSize: 5,
  },
  {
    id: "invoice-reconciler-02",
    label: "Invoice reconciliation agent",
    callsPerDay: [40, 70],
    amountRangeUsdc: [0.002, 0.03],
    qualityFailRate: 0.08,
    poolSize: 5,
  },
  {
    id: "market-data-feed-03",
    label: "Market data agent",
    callsPerDay: [200, 260],
    amountRangeUsdc: [0.0004, 0.004],
    qualityFailRate: 0.05,
    poolSize: 4,
  },
  {
    id: "support-triage-04",
    label: "Support triage agent",
    callsPerDay: [30, 55],
    amountRangeUsdc: [0.001, 0.045],
    qualityFailRate: 0.12,
    poolSize: 6,
  },
  {
    id: "pricing-sentinel-05",
    label: "Price monitoring agent",
    callsPerDay: [60, 100],
    amountRangeUsdc: [0.0008, 0.01],
    qualityFailRate: 0.07,
    poolSize: 5,
  },
];

export const AGENT_LABELS: Record<string, string> = Object.fromEntries(
  AGENT_PROFILES.map((p) => [p.id, p.label]),
);

const DOMAIN_COUNTERPARTIES = [
  "api.example.io",
  "data.marketx.io",
  "weather.opensource.io",
  "translate.langservice.io",
  "search.indexly.io",
  "storage.blockvault.io",
  "llm.inferly.io",
  "geo.geolocate.io",
  "sentiment.analyze.io",
  "invoice.accounting.io",
  "fx.rateconvert.io",
  "sms.notify.io",
  "email.mailbox.io",
  "news.newsfeed.io",
  "stock.marketdata.io",
  "crm.customer.io",
  "logs.monitor.io",
  "metrics.measure.io",
  "docs.docservice.io",
  "images.imagevault.io",
  "video.mediaservice.io",
];

const ADDRESS_COUNTERPARTIES = [
  "0x1a2b3c4d5e6f7890abcdef1234567890abcdef12",
  "0x9f8e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6",
];

/** Reserved exclusively for the one-off first-seen row in `buildSpecExampleRows`, never part of organic traffic. */
export const FIRST_SEEN_EXAMPLE_COUNTERPARTY = "feed.newsource.io";

/** Never allowlisted; exclusively the incident-burst target. */
export const INCIDENT_COUNTERPARTY = "0x8f3a1b4c9d2e5f6a7b8c9d0e1f2a3b4c5d6e7f80";

const ORGANIC_COUNTERPARTIES = [...DOMAIN_COUNTERPARTIES, ...ADDRESS_COUNTERPARTIES];

function buildResource(rng: Rng, counterparty: string): string {
  if (counterparty.startsWith("0x")) return counterparty;
  return `https://${counterparty}/${rng.pick(RESOURCE_PATHS)}`;
}

function rollQuality(rng: Rng, failRate: number): Quality {
  if (!rng.chance(failRate)) return "ok";
  const roll = rng.float();
  if (roll < 0.3) return "empty";
  if (roll < 0.55) return "http_error";
  if (roll < 0.8) return "slow";
  if (roll < 0.92) return "timeout";
  return "schema_fail";
}

function statusForQuality(rng: Rng, quality: Quality): number {
  if (quality === "http_error") return rng.pick(FAILURE_STATUS_CODES);
  if (quality === "timeout") return 0;
  return 200;
}

function latencyForQuality(rng: Rng, quality: Quality): number {
  if (quality === "slow") return rng.int(4200, 9500);
  if (quality === "timeout") return rng.int(8000, 15000);
  return rng.int(45, 1200);
}

function bodyBytesForQuality(rng: Rng, quality: Quality): number {
  if (quality === "empty" || quality === "timeout") return 0;
  return rng.int(96, 4200);
}

function shuffledPool(rng: Rng, profile: AgentProfile): string[] {
  const pool: string[] = [];
  if (profile.id === "research-crawler-01") pool.push("api.example.io");

  const remaining = ORGANIC_COUNTERPARTIES.filter((c) => !pool.includes(c));
  while (pool.length < profile.poolSize && remaining.length > 0) {
    const idx = rng.int(0, remaining.length - 1);
    pool.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return pool;
}

/** Concentrates traffic on the first two pool members — a couple of heavily-used counterparties, a long tail of occasional ones. */
function weightedPick(rng: Rng, pool: string[]): string {
  const roll = rng.float();
  if (roll < 0.45) return pool[0];
  if (roll < 0.7) return pool[1] ?? pool[0];
  return rng.pick(pool);
}

interface BuildRecordArgs {
  rng: Rng;
  nextId: () => string;
  agentId: string;
  taskId: string;
  counterparty: string;
  amountRangeUsdc: [number, number];
  qualityFailRate: number;
  seenCounterparties: Set<string>;
  dayIndex: number;
}

/**
 * The per-call decision path mirrors the policy engine's evaluation order
 * for the two checks a mock call can actually trigger: counterparty
 * first-seen handling, then the flat per-call ceiling. `hasResponse` gates
 * every response-shaped field — a blocked or hold-denied call never reached
 * the signer, so it never got a quality grade, nonce, or body hash either
 * (interception sits before signing, not after).
 */
function buildRecord(args: BuildRecordArgs): AuthorizationRecord {
  const {
    rng,
    nextId,
    agentId,
    taskId,
    counterparty,
    amountRangeUsdc,
    qualityFailRate,
    seenCounterparties,
    dayIndex,
  } = args;

  const amountUsdc = round6(rng.float(amountRangeUsdc[0], amountRangeUsdc[1]));
  const amountMicroUsdc = Math.round(amountUsdc * 1_000_000);
  const isFirstSeen = !seenCounterparties.has(counterparty);
  seenCounterparties.add(counterparty);

  const ts = isoAt(dayIndex, rng.int(0, 23), rng.int(0, 59), rng.int(0, 59), rng.int(0, 999));

  let decision: Decision;
  let ruleHit: string | null = null;

  if (isFirstSeen && amountUsdc >= AUTO_ALLOW_BELOW_USDC) {
    decision = rng.chance(0.92) ? "hold_approved" : "hold_denied";
    ruleHit = "counterparties.first_seen.action";
  } else if (amountUsdc > PER_CALL_MAX_USDC) {
    decision = "block";
    ruleHit = "per_call.max_usdc";
  } else {
    decision = "allow";
  }

  const hasResponse = decision === "allow" || decision === "hold_approved";
  const quality = hasResponse ? rollQuality(rng, qualityFailRate) : null;
  const isSettled = decision === "allow" && dayIndex < PERIOD_DAYS - 1;

  return {
    id: nextId(),
    ts,
    agentId,
    taskId,
    counterparty,
    resource: buildResource(rng, counterparty),
    amountMicroUsdc,
    decision,
    ruleHit,
    nonce: hasResponse ? rng.hex(32) : null,
    chainId: DEMO_CHAIN_ID,
    httpStatus: hasResponse ? statusForQuality(rng, quality!) : null,
    latencyMs: hasResponse ? latencyForQuality(rng, quality!) : null,
    bodyBytes: hasResponse ? bodyBytesForQuality(rng, quality!) : null,
    bodySha256: hasResponse ? rng.hex(64) : null,
    quality,
    settlementId: isSettled ? `stl_${rng.hex(12)}` : null,
    createdAt: ts,
  };
}

/**
 * Scenario A: a prompt injection redirects the agent to an unauthorized
 * address. Ruled out here by `counterparties.mode` (allowlist, default-deny)
 * rather than `per_call.max_usdc` — the per-call ceiling specifically does
 * *not* catch this pattern, since no single call exceeds it, which is the
 * whole reason the product exists. ~1,800 rapid calls over a few minutes.
 */
function buildIncidentBurst(rng: Rng, nextId: () => string): AuthorizationRecord[] {
  const dayIndex = 7; // day 8 of the period
  const burst: AuthorizationRecord[] = [];
  let elapsedMs = 0;
  const count = 1800;

  for (let i = 0; i < count; i++) {
    elapsedMs += rng.int(60, 160);
    const totalSeconds = 55 * 60 + Math.floor(elapsedMs / 1000); // starts 13:55:00
    const ms = elapsedMs % 1000;
    const minute = Math.floor(totalSeconds / 60);
    const second = totalSeconds % 60;
    const hour = 13 + Math.floor(minute / 60);
    const ts = isoAt(dayIndex, hour, minute % 60, second, ms);
    const amountUsdc = round6(rng.float(0.004, 0.009));

    burst.push({
      id: nextId(),
      ts,
      agentId: "research-crawler-01",
      taskId: "task-incident01",
      counterparty: INCIDENT_COUNTERPARTY,
      resource: INCIDENT_COUNTERPARTY,
      amountMicroUsdc: Math.round(amountUsdc * 1_000_000),
      decision: "block",
      ruleHit: "counterparties.mode",
      nonce: null,
      chainId: DEMO_CHAIN_ID,
      httpStatus: null,
      latencyMs: null,
      bodyBytes: null,
      bodySha256: null,
      quality: null,
      settlementId: null,
      createdAt: ts,
    });
  }
  return burst;
}

/**
 * A small set of curated "Recent decisions" rows — one of each decision
 * type (allow, block, held-approved, allow-with-quality-issue) — placed as
 * the most recent activity so the Overview screen's default view always
 * shows a representative mix instead of whatever organic traffic happens
 * to sort to the top.
 *
 * `afterEpochMs` is the latest timestamp among research-crawler-01's other
 * records (organic traffic can land anywhere in a day, up to 23:59:59.999)
 * — these rows are placed a few minutes after *that*, not at a fixed clock
 * time, so "most recent" is guaranteed by construction rather than by luck
 * with a particular seed. The 400ms internal spacing between paired rows
 * mimics two calls landing back-to-back.
 */
function buildSpecExampleRows(nextId: () => string, afterEpochMs: number): AuthorizationRecord[] {
  const base = afterEpochMs + 60_000; // one minute clear of the latest organic activity

  const rows: {
    tsOffsetMs: number;
    counterparty: string;
    resource: string;
    amountUsdc: number;
    decision: Decision;
    ruleHit: string | null;
    quality: Quality | null;
  }[] = [
    {
      tsOffsetMs: 0,
      counterparty: "api.example.io",
      resource: "https://api.example.io/v1/data",
      amountUsdc: 0.003,
      decision: "allow",
      ruleHit: null,
      quality: "ok",
    },
    {
      tsOffsetMs: 400,
      counterparty: INCIDENT_COUNTERPARTY,
      resource: INCIDENT_COUNTERPARTY,
      amountUsdc: 0.0045,
      decision: "block",
      ruleHit: "per_call.max_usdc",
      quality: null,
    },
    {
      tsOffsetMs: 1000,
      counterparty: FIRST_SEEN_EXAMPLE_COUNTERPARTY,
      resource: `https://${FIRST_SEEN_EXAMPLE_COUNTERPARTY}/v1/records`,
      amountUsdc: 0.0012,
      decision: "hold_approved",
      ruleHit: "counterparties.first_seen.action",
      quality: "ok",
    },
    {
      tsOffsetMs: 1400,
      counterparty: "api.example.io",
      resource: "https://api.example.io/v1/data",
      amountUsdc: 0.003,
      decision: "allow",
      ruleHit: null,
      quality: "empty",
    },
  ];

  return rows.map((row, i) => {
    const ts = isoFromEpoch(base + row.tsOffsetMs);
    const hasResponse = row.decision === "allow" || row.decision === "hold_approved";
    return {
      id: nextId(),
      ts,
      agentId: "research-crawler-01",
      taskId: "task-spec-example",
      counterparty: row.counterparty,
      resource: row.resource,
      amountMicroUsdc: Math.round(row.amountUsdc * 1_000_000),
      decision: row.decision,
      ruleHit: row.ruleHit,
      nonce: hasResponse ? `spec0${i}`.padEnd(32, "0") : null,
      chainId: DEMO_CHAIN_ID,
      httpStatus: hasResponse ? 200 : null,
      latencyMs: hasResponse ? 180 + i * 35 : null,
      bodyBytes: hasResponse ? (row.quality === "empty" ? 0 : 512) : null,
      bodySha256: hasResponse ? `spec0${i}`.padEnd(64, "0") : null,
      quality: row.quality,
      settlementId: null, // most recent activity in the whole dataset — not settled yet
      createdAt: ts,
    };
  });
}

let cachedAuthorizations: AuthorizationRecord[] | null = null;
let cachedReconciliation: ReconciliationRecord[] | null = null;

export function getPeriod(): { start: string; end: string } {
  return { start: PERIOD_START, end: PERIOD_END };
}

export function generateAuthorizations(): AuthorizationRecord[] {
  if (cachedAuthorizations) return cachedAuthorizations;

  const rng = new Rng(SEED);
  const records: AuthorizationRecord[] = [];
  let idCounter = 0;
  const nextId = () => `auth_${(++idCounter).toString(36).padStart(8, "0")}`;

  for (const profile of AGENT_PROFILES) {
    const pool = shuffledPool(rng, profile);
    const taskIds = Array.from({ length: 18 }, () => `task-${rng.hex(6)}`);
    const seenCounterparties = new Set<string>();

    for (let day = 0; day < PERIOD_DAYS; day++) {
      const callsToday = rng.int(profile.callsPerDay[0], profile.callsPerDay[1]);
      for (let i = 0; i < callsToday; i++) {
        records.push(
          buildRecord({
            rng,
            nextId,
            agentId: profile.id,
            taskId: rng.pick(taskIds),
            counterparty: weightedPick(rng, pool),
            amountRangeUsdc: profile.amountRangeUsdc,
            qualityFailRate: profile.qualityFailRate,
            seenCounterparties,
            dayIndex: day,
          }),
        );
      }
    }

    if (profile.id === "research-crawler-01") {
      records.push(...buildIncidentBurst(rng, nextId));

      const priorMaxEpoch = Math.max(
        ...records.filter((r) => r.agentId === "research-crawler-01").map((r) => Date.parse(r.ts)),
      );
      records.push(...buildSpecExampleRows(nextId, priorMaxEpoch));
    }
  }

  records.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  cachedAuthorizations = records;
  return records;
}

const TOLERANCE_MICRO_USDC = 50; // 0.00005 USDC — absorbs rounding
/** Scenario C stand-in: a counterparty where the chain shows a payment the ledger never recorded — wallet policy wasn't violated, only reconciliation catches it. */
const CRITICAL_DEMO_COUNTERPARTY = "sms.notify.io";
/** The flagship demo agent owns the Scenario-C divergence. */
const CRITICAL_DEMO_AGENT = "research-crawler-01";

const PENDING_DEMO_COUNTERPARTIES = new Set([
  "stock.marketdata.io",
  "docs.docservice.io",
  "images.imagevault.io",
]);

export function generateReconciliation(): ReconciliationRecord[] {
  if (cachedReconciliation) return cachedReconciliation;

  const authorizations = generateAuthorizations();
  const rng = new Rng(SEED + 1);
  const { start, end } = getPeriod();

  // One row per (agent, counterparty) — the chain side is per agent wallet.
  const pairs = new Set(authorizations.map((a) => `${a.agentId}\u0000${a.counterparty}`));
  pairs.add(`${CRITICAL_DEMO_AGENT}\u0000${CRITICAL_DEMO_COUNTERPARTY}`);

  const records: ReconciliationRecord[] = [];

  for (const pair of pairs) {
    const [agentId, counterparty] = pair.split("\u0000");
    const isCritical =
      agentId === CRITICAL_DEMO_AGENT && counterparty === CRITICAL_DEMO_COUNTERPARTY;
    const ledgerAmountMicroUsdc = sumSpentLedgerAmount(
      authorizations,
      counterparty,
      start,
      end,
      { agentId },
    );
    if (ledgerAmountMicroUsdc === 0 && !isCritical) continue;

    let chainAmountMicroUsdc: number;
    if (isCritical) {
      chainAmountMicroUsdc = ledgerAmountMicroUsdc + 350_000; // +0.35 USDC phantom settlement
    } else if (PENDING_DEMO_COUNTERPARTIES.has(counterparty)) {
      chainAmountMicroUsdc = Math.max(0, ledgerAmountMicroUsdc - rng.int(400, 4000));
    } else {
      chainAmountMicroUsdc = ledgerAmountMicroUsdc + rng.int(-3, 3); // rounding noise, within tolerance
    }

    const { deltaMicroUsdc, status } = classifyReconciliation(
      chainAmountMicroUsdc,
      ledgerAmountMicroUsdc,
      TOLERANCE_MICRO_USDC,
    );

    records.push({
      agentId,
      chainId: DEMO_CHAIN_ID,
      counterparty,
      periodStart: start,
      periodEnd: end,
      chainAmountMicroUsdc,
      ledgerAmountMicroUsdc,
      deltaMicroUsdc,
      toleranceMicroUsdc: TOLERANCE_MICRO_USDC,
      status,
      settlementId: status === "ok" ? `stl_${rng.hex(12)}` : null,
    });
  }

  const severity: Record<string, number> = { critical: 0, pending: 1, ok: 2 };
  records.sort((a, b) => severity[a.status] - severity[b.status]);

  cachedReconciliation = records;
  return records;
}
