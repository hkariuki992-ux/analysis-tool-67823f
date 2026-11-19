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
  /** Local receive time of the latest tick (ms). */
  lastArrival: number;
  historyLoaded: boolean;
  historyMs: number | null;
  /** Total live ticks received in this session (monotonic). */
  liveCount: number;
};

export type FeedStatus = "connecting" | "open" | "reconnecting" | "closed";

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: number };
type Queued = { payload: Record<string, unknown>; timeoutMs: number; resolve: (v: any) => void; reject: (e: Error) => void };

/** Deriv rejects bursts above its concurrent-request limit; 6 in flight was measured safe. */
const MAX_IN_FLIGHT = 6;

function lastDigit(quote: number, decimals: number): number {
  const s = quote.toFixed(decimals);
  return s.charCodeAt(s.length - 1) - 48;
}

/**
 * Single multiplexed WebSocket to the tick source (Deriv public socket or the
 * optional VPS relay). Keeps up to 10,000 ticks per symbol in memory.
 */
class TickFeed {
  url = FEED_URL;
  status: FeedStatus = "connecting";
  /** Round-trip time of the last ping, ms. */
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
    // Coalesce bursts (12 streams) into ~4 UI frames per second.
    window.setTimeout(() => {
      this.notifyQueued = false;
      this.version++;
      for (const l of this.listeners) l();
    }, 250);
  }

  private connect() {
    this.status = this.retry === 0 ? "connecting" : "reconnecting";
    this.notify();
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.status = "open";
      for (const a of ASSETS) this.send({ ticks: a.symbol, subscribe: 1 });
      this.ping();
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.ping(), 4000);
      this.notify();
    };

    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.msg_type === "tick" && msg.tick) {
        this.handleTick(msg.tick);
      }
      const id = msg.req_id;
      if (typeof id === "number" && this.pending.has(id)) {
        const p = this.pending.get(id)!;
        this.pending.delete(id);
        window.clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(`${msg.error.code ?? ""} ${msg.error.message ?? "Feed error"}`.trim()));
        else p.resolve(msg);
      }
    };

    ws.onclose = () => {
      window.clearInterval(this.pingTimer);
      for (const [, p] of this.pending) {
        window.clearTimeout(p.timer);
        p.reject(new Error("Feed disconnected"));
      }
      this.pending.clear();
      for (const q of this.queue.splice(0)) q.reject(new Error("Feed disconnected"));
      this.inFlight = 0;
      this.status = "reconnecting";
      this.notify();
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      window.setTimeout(() => this.connect(), delay);
    };

    ws.onerror = () => ws.close();
  }

  private send(payload: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  /** Queued request with a concurrency cap and automatic retry on RateLimit. */
  async request<T = any>(payload: Record<string, unknown>, timeoutMs = 10_000): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await new Promise<T>((resolve, reject) => {
          this.queue.push({ payload, timeoutMs, resolve, reject });
          this.pump();
        });
      } catch (err) {
        const rateLimited = err instanceof Error && /rate|limit/i.test(err.message);
        if (!rateLimited || attempt >= 4) throw err;
        await new Promise((r) => window.setTimeout(r, 150 * (attempt + 1)));
      }
    }
  }

  private pump() {
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length) {
      const job = this.queue.shift()!;
      if (this.ws?.readyState !== WebSocket.OPEN) {
        job.reject(new Error("Feed not connected"));
        continue;
      }
      const id = this.reqId++;
      this.inFlight++;
      const done = () => {
        this.inFlight = Math.max(0, this.inFlight - 1);
        this.pump();
      };
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        done();
        job.reject(new Error("Feed request timed out"));
      }, job.timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          done();
          job.resolve(v);
        },
        reject: (e) => {
          done();
          job.reject(e);
        },
        timer,
      });
      this.ws.send(JSON.stringify({ ...job.payload, req_id: id }));
    }
  }

  private async ping() {
    const t0 = performance.now();
    try {
      await this.request({ ping: 1 }, 5000);
      this.rttMs = Math.round(performance.now() - t0);
      this.rttHistory = [...this.rttHistory.slice(-39), this.rttMs];
      this.notify();
    } catch {
      /* reconnect logic handles it */
    }
  }

  private handleTick(t: { symbol: string; quote: number; epoch: number; pip_size?: number }) {
    const buf = this.buffers.get(t.symbol);
    if (!buf) return;
    if (typeof t.pip_size === "number") buf.decimals = t.pip_size;
    if (buf.lastEpoch !== null && t.epoch <= buf.lastEpoch) return;
    this.append(buf, t.epoch, t.quote);
    buf.liveCount++;
    const now = performance.now();
    buf.lastArrival = now;
    this.arrivals.push(now);
    while (this.arrivals.length && now - this.arrivals[0] > 5000) this.arrivals.shift();
    this.ticksPerSec = this.arrivals.length / 5;
    for (const l of this.tickListeners) l(t.symbol);
    this.notify();
  }

  private append(buf: SymbolBuffer, epoch: number, quote: number) {
    buf.prevQuote = buf.lastQuote;
    buf.lastQuote = quote;
    buf.lastEpoch = epoch;
    buf.epochs.push(epoch);
    buf.quotes.push(quote);
    buf.digits.push(lastDigit(quote, buf.decimals));
    if (buf.quotes.length > MAX_TICKS + 500) {
      const cut = buf.quotes.length - MAX_TICKS;
      buf.epochs.splice(0, cut);
      buf.quotes.splice(0, cut);
      buf.digits.splice(0, cut);
    }
  }

  /**
   * Load up to `count` ticks of history. Deriv returns at most 1,000 ticks per
   * request, so after the first page we compute the remaining time windows from
   * the stream's fixed tick interval and fetch them all in parallel. A relay
   * that can serve everything in one response short-circuits the paging.
   */
  async loadHistory(symbol: string, count = MAX_TICKS): Promise<number> {
    const buf = this.buffers.get(symbol);
    if (!buf) throw new Error(`Unknown symbol ${symbol}`);
    const t0 = performance.now();

    const first = await this.request<any>({ ticks_history: symbol, count, end: "latest", style: "ticks" });
    if (typeof first.pip_size === "number") buf.decimals = first.pip_size;
    let times: number[] = first.history?.times ?? [];
    let prices: number[] = first.history?.prices ?? [];

    if (times.length > 1 && times.length < count) {
      const page = times.length;
      const interval = Math.max(1, Math.round((times[times.length - 1] - times[0]) / (times.length - 1)));
      // One extra page compensates for occasional gaps in the stream.
      const pagesNeeded = Math.ceil((count - page) / page) + 1;
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
        p.history.times.forEach((t: number, i: number) => merged.set(t, p.history.prices[i]));
      }
      times.forEach((t, i) => merged.set(t, prices[i]));
      const sorted = [...merged.entries()].sort((a, b) => a[0] - b[0]).slice(-count);
      times = sorted.map((e) => e[0]);
      prices = sorted.map((e) => e[1]);
    }

    // Merge with live ticks that arrived meanwhile.
    const liveAfter = buf.epochs.map((e, i) => [e, buf.quotes[i]] as const).filter(([e]) => e > (times.at(-1) ?? 0));
    buf.epochs = [];
    buf.quotes = [];
    buf.digits = [];
    buf.lastEpoch = null;
    for (let i = 0; i < times.length; i++) this.append(buf, times[i], prices[i]);
    for (const [e, q] of liveAfter) this.append(buf, e, q);
    buf.historyLoaded = true;
    buf.historyMs = Math.round(performance.now() - t0);
    this.notify();
    return buf.quotes.length;
  }

  get(symbol: string): SymbolBuffer {
    return this.buffers.get(symbol) ?? this.buffers.get(ASSETS[0].symbol)!;
  }

  get isRelay() {
    return !this.url.includes("derivws.com");
  }

  assetName(symbol: string) {
    return ASSET_BY_SYMBOL[symbol]?.name ?? symbol;
  }
}

export const feed = new TickFeed();
