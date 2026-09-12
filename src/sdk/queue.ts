import type { AuthorizationRecord } from "@/lib/contracts";

/**
 * Best-effort auto-flush for the common "short-lived script" case: when the
 * event loop naturally runs out of other work, drain whatever telemetry is
 * still buffered before the process exits. Without this, a short-lived
 * agent run (the typical use) can finish and exit with the last debounce
 * window's worth of records — `block`/`hold_denied` decisions included —
 * still sitting unsent in memory, since the flush timer is deliberately
 * `unref()`'d so it never keeps the process alive on its own.
 *
 * `beforeExit` (unlike the synchronous `exit` event) still lets async code
 * run, and can fire more than once — draining an already-empty queue is a
 * no-op, so it's safe to leave registered for the life of the process. It
 * does NOT cover Ctrl+C or an explicit `process.exit()`: Node gives no way
 * to await async work on either of those paths, so code that must guarantee
 * delivery there should still call `drainAndStop()` explicitly.
 */
export function registerAutoDrain(queue: AsyncLedgerQueue): void {
  if (typeof process === "undefined" || typeof process.on !== "function") return;
  process.on("beforeExit", () => {
    void queue.drainAndStop();
  });
}

export type LedgerSink =
  | string // DSN or API URL e.g. "http://localhost:3000/api/authorizations"
  | ((records: AuthorizationRecord[]) => Promise<void>)
  | { write(record: AuthorizationRecord): Promise<void> | void };

export interface AsyncQueueOptions {
  maxBufferSize?: number;
  flushIntervalMs?: number;
  batchSize?: number;
  onError?: (err: Error, lostCount: number) => void;
  /** Extra headers sent with each POST when the sink is a URL — e.g. an
   *  `Authorization: Bearer …` for a hosted Spendlens ingest endpoint. */
  headers?: Record<string, string>;
}

/**
 * Non-blocking telemetry queue.
 * Flushes authorization records in background batches without adding latency to API calls.
 */
export class AsyncLedgerQueue {
  private buffer: AuthorizationRecord[] = [];
  private maxBufferSize: number;
  private flushIntervalMs: number;
  private batchSize: number;
  private timer: NodeJS.Timeout | null = null;
  private sink: LedgerSink;
  private isFlushing = false;
  private onError?: (err: Error, lostCount: number) => void;
  private headers: Record<string, string>;

  constructor(sink: LedgerSink, options: AsyncQueueOptions = {}) {
    this.sink = sink;
    this.maxBufferSize = options.maxBufferSize ?? 5000;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.batchSize = options.batchSize ?? 100;
    this.onError = options.onError;
    this.headers = options.headers ?? {};

    this.startTimer();
  }

  public enqueue(record: AuthorizationRecord): void {
    if (this.buffer.length >= this.maxBufferSize) {
      // Ring buffer overflow handling: if the queue fills up, the oldest records get flushed out first
      const dropped = this.buffer.shift();
      if (dropped && this.onError) {
        this.onError(new Error("Spendlens ledger queue buffer full, dropping oldest record"), 1);
      }
    }
    this.buffer.push(record);

    if (this.buffer.length >= this.batchSize) {
      void this.flush();
    }
  }

  public async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) return;
    this.isFlushing = true;

    const batch = this.buffer.splice(0, this.batchSize);

    try {
      if (typeof this.sink === "string") {
        await this.postToDsn(this.sink, batch);
      } else if (typeof this.sink === "function") {
        await this.sink(batch);
      } else if (typeof this.sink === "object" && "write" in this.sink) {
        for (const record of batch) {
          await this.sink.write(record);
        }
      }
    } catch (err) {
      // Re-insert unwritten batch at head if space permits
      if (this.buffer.length + batch.length <= this.maxBufferSize) {
        this.buffer.unshift(...batch);
      }
      if (this.onError) {
        this.onError(err instanceof Error ? err : new Error(String(err)), batch.length);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async postToDsn(url: string, records: AuthorizationRecord[]): Promise<void> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify({ records }),
    });
    if (!res.ok) {
      throw new Error(`Failed to post telemetry to sink: ${res.status} ${res.statusText}`);
    }
  }

  private startTimer(): void {
    if (typeof window === "undefined" && !this.timer) {
      this.timer = setInterval(() => {
        void this.flush();
      }, this.flushIntervalMs);
      if (this.timer.unref) {
        this.timer.unref();
      }
    }
  }

  /** Flushes whatever is buffered and stops the periodic timer. Bounded to
   *  a fixed number of attempts — a permanently unreachable sink makes
   *  `flush()` re-queue the same batch every time (see the `catch` above),
   *  which would otherwise spin this forever instead of letting whatever
   *  is shutting the process down actually finish. */
  public async drainAndStop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts && this.buffer.length > 0; attempt++) {
      await this.flush();
    }
    if (this.buffer.length > 0 && this.onError) {
      this.onError(
        new Error(
          `Spendlens ledger queue: giving up after ${maxAttempts} failed flush attempts, ` +
            `${this.buffer.length} record(s) undelivered`,
        ),
        this.buffer.length,
      );
    }
  }
}
