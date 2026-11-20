import { ASSETS, ASSET_BY_SYMBOL, FEED_URL, MAX_TICKS } from "./symbols";

export type SymbolBuffer = {
  symbol: string;
  epochs: number[];
  quotes: number[];
  digits: number[];
  decimals: number;
  lastQuote: number | null;
  prevQuote: number | null;
  lastEpoch: number | null;
  lastArrival: number;
  historyLoaded: boolean;
  historyMs: number | null;
  liveCount: number;
};

export type FeedStatus = "connecting" | "open" | "reconnecting" | "closed";

type Pending = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: number;
};

type Queued = {
  payload: Record<string, unknown>;
  timeoutMs: number;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
};

/** Keep Deriv concurrent requests within safe limits. */
const MAX_IN_FLIGHT = 6;
const CONNECT_TIMEOUT_MS = 12_000;
const REQUEST_TIMEOUT_MS = 10_000;

function lastDigit(quote: number, decimals: number): number {
  const fixed = quote.toFixed(Math.max(0, Math.min(10, decimals)));
  return Number(fixed.charAt(fixed.length - 1));
}

class TickFeed {
  url = FEED_URL;
  status: FeedStatus = "connecting";
  error: string | null = null;

  rttMs: number | null = null;
  rttHistory: number[] = [];
  ticksPerSec = 0;

  buffers = new Map<string, SymbolBuffer>();
  version = 0;

  private ws: WebSocket | null = null;
  private reqId = 1;

  private pending = new Map<number, Pending>();
  private queue: Queued[] = [];
  private inFlight = 0;

  private listeners = new Set<() => void>();
  private tickListeners = new Set<(symbol: string) => void>();

  private notifyQueued = false;
  private retry = 0;
  private arrivals: number[] = [];

  private pingTimer: number | undefined;
  private connectTimer: number | undefined;
  private reconnectTimer: number | undefined;

  private started = false;

  constructor() {
    for (const a of ASSETS) {
      this.buffers.set(a.symbol, {
        symbol: a.symbol,
        epochs: [],
        quotes: [],
        digits: [],
        decimals: a.decimals,
        lastQuote: null,
        prevQuote: null,
        lastEpoch: null,
        lastArrival: 0,
        historyLoaded: false,
        historyMs: null,
        liveCount: 0,
      });
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onTick(fn: (symbol: string) => void) {
    this.tickListeners.add(fn);
    return () => this.tickListeners.delete(fn);
  }

  private notify() {
    if (this.notifyQueued) return;
    this.notifyQueued = true;

    window.setTimeout(() => {
      this.notifyQueued = false;
      this.version++;
      for (const listener of this.listeners) listener();
    }, 250);
  }

  private clearTimers() {
    if (this.pingTimer !== undefined) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }

    if (this.connectTimer !== undefined) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
    }
  }

  private connect() {
    if (!this.started) return;

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.status = this.retry === 0 ? "connecting" : "reconnecting";
    this.error = null;
    this.notify();

    let ws: WebSocket;

    try {
      ws = new WebSocket(this.url);
      this.ws = ws;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "WebSocket creation failed";
      this.scheduleReconnect();
      return;
    }

    // Prevent a socket that never opens from hanging forever.
    this.connectTimer = window.setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        this.error = "Connection timed out while opening WebSocket";
        this.notify();
        ws.close();
      }
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.ws !== ws) return;

      if (this.connectTimer !== undefined) {
        window.clearTimeout(this.connectTimer);
        this.connectTimer = undefined;
      }

      this.retry = 0;
      this.error = null;
      this.status = "open";

      // Subscribe to all configured market streams.
      for (const asset of ASSETS) {
        this.send({ ticks: asset.symbol, subscribe: 1 });
      }

      // Start ping monitoring.
      this.ping();

      if (this.pingTimer !== undefined) {
        window.clearInterval(this.pingTimer);
      }

      this.pingTimer = window.setInterval(() => {
        if (this.ws === ws && ws.readyState === WebSocket.OPEN) {
          this.ping();
        }
      }, 4000);

      // Process requests that were waiting for the connection.
      this.pump();
      this.notify();
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;

      let msg: any;

      try {
        msg = JSON.parse(ev.data);
      } catch {
        this.error = "Received invalid JSON from feed";
        this.notify();
        return;
      }

      // Live tick messages.
      if (msg.msg_type === "tick" && msg.tick) {
        this.handleTick(msg.tick);
      }

      // Surface server-side errors, including subscription errors.
      if (msg.error) {
        const message = `${msg.error.code ?? "Deriv error"}: ${
          msg.error.message ?? "Unknown feed error"
        }`;

        this.error = message;
        this.notify();
      }

      // Resolve/reject requests by their request ID.
      const id = msg.req_id;

      if (typeof id === "number" && this.pending.has(id)) {
        const pending = this.pending.get(id)!;

        this.pending.delete(id);
        window.clearTimeout(pending.timer);

        if (msg.error) {
          pending.reject(
            new Error(
              `${msg.error.code ?? ""} ${
                msg.error.message ?? "Feed request failed"
              }`.trim(),
            ),
          );
        } else {
          pending.resolve(msg);
        }
      }
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;

      this.error = "WebSocket network error";
      this.notify();

      // The close handler performs reconnection.
      try {
        ws.close();
      } catch {
        this.scheduleReconnect();
      }
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;

      this.clearTimers();

      // Fail requests that were already sent.
      for (const [, pending] of this.pending) {
        window.clearTimeout(pending.timer);
        pending.reject(new Error("Feed disconnected"));
      }

      this.pending.clear();
      this.inFlight = 0;

      this.status = "reconnecting";

      if (!this.error) {
        this.error = event.reason
          ? `WebSocket closed: ${event.reason}`
          : `WebSocket closed (code ${event.code})`;
      }

      this.notify();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (!this.started) return;

    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
    }

    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.retry, 5));
    this.retry++;

    this.status = "reconnecting";
    this.notify();

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private send(payload: Record<string, unknown>) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    try {
      this.ws.send(JSON.stringify(payload));
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Send failed";
      this.notify();
    }
  }

  /** Queue requests and limit the number sent concurrently. */
  async request<T = any>(
    payload: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await new Promise<T>((resolve, reject) => {
          this.queue.push({
            payload,
            timeoutMs,
            resolve,
            reject,
          });

          this.pump();
        });
      } catch (err) {
        const rateLimited =
          err instanceof Error && /rate|limit/i.test(err.message);

        if (!rateLimited || attempt >= 4) throw err;

        await new Promise((resolve) =>
          window.setTimeout(resolve, 150 * (attempt + 1)),
        );
      }
    }
  }

  private pump() {
    // Keep queued requests until the WebSocket is ready.
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length > 0) {
      const job = this.queue.shift()!;
      const id = this.reqId++;

      this.inFlight++;

      const done = () => {
        this.inFlight = Math.max(0, this.inFlight - 1);
        this.pump();
      };

      const timer = window.setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;

        this.pending.delete(id);
        done();
        job.reject(new Error("Feed request timed out"));
      }, job.timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          window.clearTimeout(timer);
          done();
          job.resolve(value);
        },
        reject: (err) => {
          window.clearTimeout(timer);
          done();
          job.reject(err);
        },
        timer,
      });

      try {
        this.ws.send(
          JSON.stringify({
            ...job.payload,
            req_id: id,
          }),
        );
      } catch (err) {
        const pending = this.pending.get(id);

        if (pending) {
          this.pending.delete(id);
          window.clearTimeout(pending.timer);
          done();

          job.reject(
            err instanceof Error ? err : new Error("Failed to send request"),
          );
        }
      }
    }
  }

  private async ping() {
    const startedAt = performance.now();

    try {
      await this.request({ ping: 1 }, 5000);

      this.rttMs = Math.round(performance.now() - startedAt);
      this.rttHistory = [...this.rttHistory.slice(-39), this.rttMs];

      this.notify();
    } catch (err) {
      if (this.status === "open" && err instanceof Error) {
        this.error = err.message;
        this.notify();
      }
    }
  }

  private handleTick(t: {
    symbol: string;
    quote: number;
    epoch: number;
    pip_size?: number;
  }) {
    const buf = this.buffers.get(t.symbol);
    if (!buf) return;

    if (typeof t.pip_size === "number") {
      buf.decimals = t.pip_size;
    }

    // Ignore duplicate or out-of-order ticks.
    if (buf.lastEpoch !== null && t.epoch <= buf.lastEpoch) return;

    this.append(buf, t.epoch, t.quote);

    buf.liveCount++;

    const now = performance.now();
    buf.lastArrival = now;
    this.arrivals.push(now);

    while (
      this.arrivals.length > 0 &&
      now - this.arrivals[0] > 5000
    ) {
      this.arrivals.shift();
    }

    this.ticksPerSec = this.arrivals.length / 5;

    for (const listener of this.tickListeners) {
      listener(t.symbol);
    }

    this.notify();
  }

  private append(buf: SymbolBuffer, epoch: number, quote: number) {
    buf.prevQuote = buf.lastQuote;
    buf.lastQuote = quote;
    buf.lastEpoch = epoch;

    buf.epochs.push(epoch);
    buf.quotes.push(quote);
    buf.digits.push(lastDigit(quote, buf.decimals));

    if (buf.quotes.length > MAX_TICKS) {
      const cut = buf.quotes.length - MAX_TICKS;

      buf.epochs.splice(0, cut);
      buf.quotes.splice(0, cut);
      buf.digits.splice(0, cut);
    }
  }

  /**
   * Loads history and merges it with ticks received during loading.
   * Deriv history requests are capped at 1,000 ticks per page.
   */
  async loadHistory(
    symbol: string,
    count = MAX_TICKS,
  ): Promise<number> {
    const buf = this.buffers.get(symbol);

    if (!buf) {
      throw new Error(`Unknown symbol ${symbol}`);
    }

    const t0 = performance.now();
    const requestedCount = Math.max(1, Math.min(count, MAX_TICKS));

    // Save live ticks that arrive while history is downloading.
    const liveBefore = buf.epochs.map(
      (epoch, i) => [epoch, buf.quotes[i]] as const,
    );

    const firstCount = Math.min(requestedCount, 1000);

    const first = await this.request<any>({
      ticks_history: symbol,
      count: firstCount,
      end: "latest",
      style: "ticks",
    });

    if (typeof first.pip_size === "number") {
      buf.decimals = first.pip_size;
    }

    let times: number[] = first.history?.times ?? [];
    let prices: number[] = first.history?.prices ?? [];

    // Paginate when Deriv returns only part of the requested history.
    if (times.length > 1 && times.length < requestedCount) {
      const page = times.length;

      const interval = Math.max(
        1,
        Math.round(
          (times[times.length - 1] - times[0]) / (times.length - 1),
        ),
      );

      const pagesNeeded =
        Math.ceil((requestedCount - page) / page) + 1;

      const oldest = times[0];

      const requests = Array.from({ length: pagesNeeded }, (_, i) =>
        this.request<any>({
          ticks_history: symbol,
          count: page,
          end: oldest - 1 - i * page * interval,
          style: "ticks",
        }).catch(() => null),
      );

      const pages = await Promise.all(requests);

      const merged = new Map<number, number>();

      for (const p of pages) {
        if (!p?.history) continue;

        p.history.times.forEach((epoch: number, i: number) => {
          merged.set(epoch, p.history.prices[i]);
        });
      }

      times.forEach((epoch, i) => {
        merged.set(epoch, prices[i]);
      });

      const sorted = [...merged.entries()]
        .sort((a, b) => a[0] - b[0])
        .slice(-requestedCount);

      times = sorted.map((item) => item[0]);
      prices = sorted.map((item) => item[1]);
    }

    // Keep all ticks received after the history request started.
    const liveAfter = buf.epochs.map(
      (epoch, i) => [epoch, buf.quotes[i]] as const,
    );

    const liveMerged = new Map<number, number>();

    for (const [epoch, quote] of liveBefore) {
      liveMerged.set(epoch, quote);
    }

    for (const [epoch, quote] of liveAfter) {
      liveMerged.set(epoch, quote);
    }

    // Rebuild the buffer in chronological order.
    const mergedHistory = new Map<number, number>();

    times.forEach((epoch, i) => {
      mergedHistory.set(epoch, prices[i]);
    });

    for (const [epoch, quote] of liveMerged) {
      mergedHistory.set(epoch, quote);
    }

    const sorted = [...mergedHistory.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(-requestedCount);

    buf.epochs = [];
    buf.quotes = [];
    buf.digits = [];
    buf.lastEpoch = null;
    buf.lastQuote = null;
    buf.prevQuote = null;

    for (const [epoch, quote] of sorted) {
      this.append(buf, epoch, quote);
    }

    buf.historyLoaded = true;
    buf.historyMs = Math.round(performance.now() - t0);

    this.notify();

    return buf.quotes.length;
  }

  get(symbol: string): SymbolBuffer {
    return (
      this.buffers.get(symbol) ??
      this.buffers.get(ASSETS[0].symbol)!
    );
  }

  get isRelay() {
    return !this.url.includes("derivws.com");
  }

  assetName(symbol: string) {
    return ASSET_BY_SYMBOL[symbol]?.name ?? symbol;
  }
}

export const feed = new TickFeed();
