import { load } from "js-yaml";
import {
  ValidatedPolicyFileSchema,
  toPolicyConfig,
  type PolicyConfig,
} from "@/lib/contracts";
import { ARC, ARC_MAINNET } from "@/lib/arc";
import type { PolicyEngine } from "./policy-engine";
import type { LedgerSink } from "./queue";

/**
 * Pieces shared by `guard()` (generic x402) and `guardGateway()` (Circle
 * Nanopayments): where the policy comes from, the link back to the Spendlens
 * server (kill switch + remote policy), human-in-the-loop escalation, and
 * the mainnet safety rails.
 */

function envValue(name: string): string | undefined {
  return typeof process !== "undefined" && process.env ? process.env[name] : undefined;
}

// ── policy source ───────────────────────────────────────────────────────────

const POLICY_PATH_RE = /\.(ya?ml|json)$/i;

/** Parses + validates policy YAML (or JSON — YAML is a superset). */
export function parsePolicyText(text: string): PolicyConfig {
  return toPolicyConfig(ValidatedPolicyFileSchema.parse(load(text)));
}

/**
 * Resolves `options.policy`:
 *   - a `PolicyConfig` object → used as-is
 *   - a single-line string ending in `.yaml` / `.yml` / `.json` → a file path,
 *     read from disk (Node only) — `guard({ policy: "./policy.yaml" })`
 *   - any other string → policy YAML text
 *   - undefined → `undefined` (the caller decides: remote, or permissive)
 */
export function loadPolicyInput(
  policy: string | PolicyConfig | undefined,
  label: string,
): PolicyConfig | undefined {
  if (policy === undefined) return undefined;
  if (typeof policy !== "string") return policy;

  let text = policy;
  const trimmed = policy.trim();
  if (!trimmed.includes("\n") && POLICY_PATH_RE.test(trimmed)) {
    const fs = nodeFs();
    if (!fs) {
      throw new Error(`${label}: policy looks like a file path ("${trimmed}") but no filesystem is available here — pass the YAML text instead`);
    }
    try {
      text = fs.readFileSync(trimmed, "utf8");
    } catch (err) {
      throw new Error(`${label}: could not read policy file "${trimmed}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  try {
    return parsePolicyText(text);
  } catch (err) {
    throw new Error(`${label}: invalid policy: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type NodeFs = { readFileSync(path: string, enc: "utf8"): string };
function nodeFs(): NodeFs | null {
  try {
    // `process.getBuiltinModule` (Node ≥ 20.16) avoids a static `node:fs`
    // import, so the SDK still loads in runtimes without a filesystem.
    const p = globalThis.process as unknown as {
      getBuiltinModule?: (id: string) => unknown;
    };
    return (p?.getBuiltinModule?.("node:fs") as NodeFs | undefined) ?? null;
  } catch {
    return null;
  }
}

// ── sink / server URL ───────────────────────────────────────────────────────

/** A bare origin (`https://spendlens.example.com`) is not an ingest endpoint —
 *  posting there answers 405 and every record is lost — so it gets the
 *  `/api/authorizations` path. A URL that already has a path is taken as given
 *  (a custom collector, or the full ingest URL). */
function withIngestPath(url: string): string {
  if (/\/api\/authorizations\/?$/.test(url)) return url;
  try {
    const u = new URL(url);
    if (u.pathname !== "" && u.pathname !== "/") return url;
  } catch {
    // not parseable: fall through and append, like the env path always did
  }
  return url.replace(/\/$/, "") + "/api/authorizations";
}

export function resolveSink(explicit: LedgerSink | undefined): LedgerSink | undefined {
  if (typeof explicit === "string") return withIngestPath(explicit);
  if (explicit) return explicit;
  // SPENDLENS_URL is, by definition, the Spendlens server — so the ingest
  // path is always appended (a server behind a path prefix still works),
  // unlike an explicit `sink`, which may be a custom collector.
  const url = envValue("SPENDLENS_URL");
  if (!url) return undefined;
  return /\/api\/authorizations\/?$/.test(url)
    ? url
    : url.replace(/\/$/, "") + "/api/authorizations";
}

/** The Spendlens server's base URL, from an explicit `serverUrl`, a URL sink,
 *  or `SPENDLENS_URL`. Undefined for a local (function / SQLite) sink. */
export function resolveServerUrl(
  explicit: string | undefined,
  sink: LedgerSink | undefined,
): string | undefined {
  const raw =
    explicit ??
    (typeof sink === "string" ? sink : undefined) ??
    envValue("SPENDLENS_URL");
  if (!raw) return undefined;
  return raw.replace(/\/api\/authorizations\/?$/, "").replace(/\/$/, "");
}

// ── diagnostics ─────────────────────────────────────────────────────────────

/** A `console.warn` that repeats a given message at most once per `everyMs`.
 *  The control plane polls every 15 s and the queue flushes every second, so an
 *  unreachable or misconfigured server used to be completely silent (records
 *  vanished, payments stayed blocked with no explanation) — and logging every
 *  attempt would flood the agent's output instead. */
export function makeThrottledWarn(everyMs = 60_000): (key: string, message: string) => void {
  const last = new Map<string, number>();
  return (key, message) => {
    const now = Date.now();
    const prev = last.get(key);
    if (prev !== undefined && now - prev < everyMs) return;
    last.set(key, now);
    console.warn(message);
  };
}

/** Default `onError` for the telemetry queue: tells the operator that ledger
 *  records are not reaching Spendlens (throttled). */
export function defaultQueueOnError(label: string): (err: Error, lostCount: number) => void {
  const warn = makeThrottledWarn();
  return (err, lostCount) =>
    warn(
      err.message,
      `[spendlens] ${label}: telemetry is not reaching Spendlens — ${err.message}` +
        (lostCount > 0 ? ` (${lostCount} record(s) affected)` : ""),
    );
}

// ── control plane: kill switch + remote policy ─────────────────────────────

export interface RemoteConfig {
  agent: { id: string; status: "active" | "paused" };
  policy: { version: number; hash: string; config: PolicyConfig } | null;
}

export interface ControlPlaneOptions {
  serverUrl: string;
  apiKey: string;
  engine: PolicyEngine;
  /** Adopt the dashboard's policy (and every later edit of it). */
  remotePolicy: boolean;
  /** With `remotePolicy`, block every payment until a policy has loaded. */
  failClosed: boolean;
  intervalMs?: number;
  fetchFn?: typeof fetch;
  label: string;
}

/**
 * Keeps a running agent in step with the Spendlens dashboard:
 *
 *  - **Kill switch.** When the agent is halted in the dashboard, the engine
 *    blocks every payment (`agent.halted`) — before signing, so nothing
 *    moves — until it's resumed. Checked on a timer, on first use, and from
 *    the `x-spendlens-agent-status` header on every ingest response.
 *  - **Remote policy.** With `remotePolicy`, the policy edited in the
 *    dashboard is applied live — a rule change doesn't need a redeploy.
 *
 * A failed poll keeps the last known state (a Spendlens outage must not turn
 * into an agent outage) — except that, fail-closed, an agent that has never
 * received a policy stays blocked (`policy.unavailable`).
 */
export class ControlPlane {
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstSync: Promise<void> | null = null;
  private appliedVersion: number | null = null;
  private remoteHalted = false;
  private readonly fetchFn: typeof fetch;
  private readonly warn = makeThrottledWarn();

  constructor(private readonly opts: ControlPlaneOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    if (opts.remotePolicy && opts.failClosed) opts.engine.halt("policy.unavailable");
  }

  /** A failed poll keeps the last known state (see the class doc) — but it
   *  must not be silent: a fail-closed agent that can never load its policy
   *  (wrong URL/key, or a server too old to serve `/api/sdk/config`) would
   *  otherwise just answer every payment with an unexplained
   *  `policy.unavailable`. */
  private reportSyncError(err: unknown): void {
    const detail = err instanceof Error ? err.message : String(err);
    const stuck =
      this.opts.engine.getHaltRule() === "policy.unavailable"
        ? " Every payment stays blocked until the dashboard policy loads — check SPENDLENS_URL and SPENDLENS_API_KEY, " +
          "that the server is up to date (it must serve /api/sdk/config), or pass an explicit `policy`."
        : "";
    this.warn(detail, `[spendlens] ${this.opts.label}: could not sync with Spendlens — ${detail}.${stuck}`);
  }

  /** Starts background polling; resolves once the first sync settles
   *  (successfully or not). Idempotent. */
  start(): Promise<void> {
    if (!this.firstSync) {
      this.firstSync = this.sync().catch((err) => this.reportSyncError(err));
      const every = this.opts.intervalMs ?? 15_000;
      if (every > 0) {
        this.timer = setInterval(() => void this.sync().catch((err) => this.reportSyncError(err)), every);
        (this.timer as { unref?: () => void }).unref?.();
      }
    }
    return this.firstSync;
  }

  /** Awaits the first sync, bounded so a slow server can't stall payments. */
  async ready(timeoutMs = 5_000): Promise<void> {
    await Promise.race([
      this.start(),
      new Promise<void>((r) => {
        const t = setTimeout(r, timeoutMs);
        (t as { unref?: () => void }).unref?.();
      }),
    ]);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Applies an agent status learned from anywhere (poll or ingest header). */
  applyStatus(status: string | null | undefined): void {
    if (status === "paused") {
      this.remoteHalted = true;
      this.opts.engine.halt("agent.halted");
    } else if (status === "active" && this.remoteHalted) {
      this.remoteHalted = false;
      // Don't lift a fail-closed "no policy yet" block by resuming.
      if (this.opts.engine.getHaltRule() === "agent.halted") this.opts.engine.resume();
    }
  }

  async sync(): Promise<void> {
    const res = await this.fetchFn(`${this.opts.serverUrl}/api/sdk/config`, {
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
    });
    if (!res.ok) throw new Error(`${this.opts.label}: config sync failed (${res.status})`);
    const cfg = (await res.json()) as RemoteConfig;

    if (this.opts.remotePolicy && cfg.policy && cfg.policy.version !== this.appliedVersion) {
      try {
        this.opts.engine.setPolicy(cfg.policy.config, { version: cfg.policy.version });
        this.appliedVersion = cfg.policy.version;
        if (this.opts.engine.getHaltRule() === "policy.unavailable") this.opts.engine.resume();
      } catch (err) {
        console.warn(`[spendlens] ${this.opts.label}: ignoring remote policy v${cfg.policy.version}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.applyStatus(cfg.agent?.status);
  }
}

// ── escalation (human-in-the-loop) ──────────────────────────────────────────

export interface EscalationConfig {
  webhook: string | null;
  timeoutSeconds: number;
  onTimeout: "allow" | "block" | "hold" | "alert";
}

export interface EscalationPayload {
  agentId: string;
  taskId: string | null;
  counterparty: string;
  resource: string;
  amountUsdc: number;
  ruleHit: string | null;
  nonce?: string | null;
}

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

/**
 * Sends a `hold` to the policy's escalation webhook and waits for the
 * answer, up to `timeoutSeconds` in total. The webhook may answer:
 *
 *   { approved: true | false }                        — decided now
 *   { status: "pending", id, pollUrl? }               — a human decides;
 *       the SDK polls `pollUrl` (default `<webhook>/<id>`) until it returns
 *       { status: "approved" | "denied" } or time runs out
 *
 * Spendlens's own `/api/escalate` auto-approves under
 * `auto_approve_below_usdc` and otherwise queues the hold for a person in
 * the dashboard (and e-mails them). On timeout, a transport error, or a
 * non-2xx response the answer is `on_timeout === "allow"`.
 */
export async function requestEscalation(
  escalation: EscalationConfig,
  payload: EscalationPayload,
  opts: {
    apiKey?: string;
    /** The Spendlens server's URL. The API key is sent ONLY to this origin:
     *  the webhook is whatever the policy says (often a third party — the
     *  default used to be example.com) and its `pollUrl` answer is chosen by
     *  the webhook, so handing either the key would leak the agent's ingest
     *  credential. Without it the key is never sent. */
    trustedOrigin?: string;
    fetchFn?: typeof fetch;
    pollIntervalMs?: number;
  } = {},
): Promise<{ approved: boolean; reason: "decided" | "timeout" | "error" }> {
  const fallback = escalation.onTimeout === "allow";
  if (!escalation.webhook) return { approved: fallback, reason: "error" };
  const doFetch = opts.fetchFn ?? fetch;
  const deadline = Date.now() + Math.max(1, escalation.timeoutSeconds) * 1000;
  const originOf = (u: string): string | null => {
    try {
      return new URL(u).origin;
    } catch {
      return null;
    }
  };
  const trusted = opts.trustedOrigin ? originOf(opts.trustedOrigin) : null;
  const headersFor = (url: string): Record<string, string> => ({
    "content-type": "application/json",
    ...(opts.apiKey && trusted && originOf(url) === trusted
      ? { authorization: `Bearer ${opts.apiKey}` }
      : {}),
  });

  const withTimeout = async (url: string, init: RequestInit) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    try {
      return await doFetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
  };

  type Answer = { approved?: boolean; status?: string; id?: string; pollUrl?: string };
  const decided = (a: Answer): boolean | null => {
    if (typeof a.approved === "boolean" && a.status !== "pending") return a.approved;
    if (a.status === "approved") return true;
    if (a.status === "denied") return false;
    return null;
  };

  try {
    const res = await withTimeout(escalation.webhook, {
      method: "POST",
      headers: headersFor(escalation.webhook),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { approved: fallback, reason: "error" };
    const first = (await res.json().catch(() => ({}))) as Answer;
    const now = decided(first);
    if (now !== null) return { approved: now, reason: "decided" };
    if (first.status !== "pending" || (!first.pollUrl && !first.id)) {
      return { approved: fallback, reason: "error" };
    }

    const pollUrl = first.pollUrl ?? `${escalation.webhook.replace(/\/$/, "")}/${first.id}`;
    // The poll target is named by the webhook's own response — never follow
    // it to a host the policy didn't configure (nor to one the agent trusts).
    const pollOrigin = originOf(pollUrl);
    if (pollOrigin === null || (pollOrigin !== originOf(escalation.webhook) && pollOrigin !== trusted)) {
      return { approved: fallback, reason: "error" };
    }
    const interval = opts.pollIntervalMs ?? 2_000;
    while (Date.now() + interval < deadline) {
      await sleep(interval);
      const poll = await withTimeout(pollUrl, { method: "GET", headers: headersFor(pollUrl) });
      if (!poll.ok) continue;
      const answer = decided((await poll.json().catch(() => ({}))) as Answer);
      if (answer !== null) return { approved: answer, reason: "decided" };
    }
    return { approved: fallback, reason: "timeout" };
  } catch {
    return {
      approved: fallback,
      reason: Date.now() >= deadline ? "timeout" : "error",
    };
  }
}

// ── mainnet safety rails ────────────────────────────────────────────────────

/** `eip155:5042` → 5042. Null when unparseable. */
export function chainIdFromNetwork(network: string | undefined | null): number | null {
  const m = /^eip155:(\d+)$/.exec(network ?? "");
  return m ? Number(m[1]) : null;
}

/** True when this process is configured for Arc mainnet, or the given chain
 *  id is Arc mainnet's. */
export function isMainnet(chainId?: number | null): boolean {
  return ARC.network === "mainnet" || chainId === ARC_MAINNET.chainId;
}

/**
 * Real money is not the place for "record everything, block nothing". On
 * mainnet a guard must have a policy — local, or the dashboard's via remote
 * sync — so the permissive default (per-call $1000, $10k/day, alert-only)
 * can never end up governing a funded wallet by omission.
 */
export function assertMainnetPolicy(
  label: string,
  hasLocalPolicy: boolean,
  hasRemotePolicy: boolean,
): void {
  if (!isMainnet() || hasLocalPolicy || hasRemotePolicy) return;
  throw new Error(
    `${label}: a policy is required on Arc mainnet. Pass \`policy\` (YAML, a ` +
      "file path, or a PolicyConfig), or set SPENDLENS_URL + SPENDLENS_API_KEY " +
      "so the agent's dashboard policy is used. The permissive default is " +
      "testnet-only.",
  );
}
