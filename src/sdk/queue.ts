import type { AuthorizationRecord } from "@/lib/contracts";

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

  public async drainAndStop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.buffer.length > 0) {
      await this.flush();
    }
  }
}
