import type WebSocket from 'ws';
import { BinanceStream, type FeedStatus } from '../binance/ws.js';

/**
 * Live order-book + trade-print fan-out for the Token Detail page.
 *
 * PUBLIC market data only — no keys, no trading surface. One bounded Binance
 * combined stream (depth20@100ms + aggTrade) is opened per viewed symbol.
 */

interface DepthPayload {
  lastUpdateId: number;
  bids: unknown;
  asks: unknown;
}

interface AggTradePayload {
  e: 'aggTrade';
  s: string;
  a: number;
  p: string;
  q: string;
  T: number;
  m: boolean;
}

interface StreamHandle {
  start(): void;
  stop(): void;
}

type StreamFactory = (
  name: string,
  url: string,
  onMessage: (data: unknown) => void,
  onStatus: (name: string, status: FeedStatus) => void,
) => StreamHandle;

interface Feed {
  stream: StreamHandle;
  viewers: Set<WebSocket>;
  tradeBuf: { id: number; price: number; qty: number; time: number; isBuyerMaker: boolean }[];
  lastTradeId: number;
  flushTimer: NodeJS.Timeout;
  idleTimer: NodeJS.Timeout | null;
}

export interface BookStreamHubOptions {
  maxFeeds?: number;
  maxSubscriptions?: number;
  maxViewersPerFeed?: number;
  maxClientBufferedBytes?: number;
  streamFactory?: StreamFactory;
}

const IDLE_TEARDOWN_MS = 30_000;
const TRADE_FLUSH_MS = 250;
const BOOK_LEVELS = 20;
const MAX_DEPTH_INPUT_LEVELS = 64;
const MAX_TRADE_BUFFER = 400;
const DEFAULT_MAX_FEEDS = 48;
const DEFAULT_MAX_SUBSCRIPTIONS = 256;
const DEFAULT_MAX_VIEWERS_PER_FEED = 128;
const DEFAULT_MAX_CLIENT_BUFFERED_BYTES = 512 * 1024;
const MAX_EVENT_AGE_MS = 10 * 60_000;
const MAX_FUTURE_SKEW_MS = 60_000;

function boundedInt(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validEventTime(value: unknown, now = Date.now()): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= now - MAX_EVENT_AGE_MS &&
    Number(value) <= now + MAX_FUTURE_SKEW_MS
  );
}

function normalizeLevels(value: unknown, side: 'bid' | 'ask'): [string, string][] | null {
  if (!Array.isArray(value) || value.length > MAX_DEPTH_INPUT_LEVELS) return null;
  const out: [string, string][] = [];
  let previousPrice: number | null = null;
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 2) return null;
    const price = Number(row[0]);
    const qty = Number(row[1]);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) return null;
    if (previousPrice !== null) {
      if (side === 'bid' && price > previousPrice) return null;
      if (side === 'ask' && price < previousPrice) return null;
    }
    previousPrice = price;
    out.push([String(row[0]), String(row[1])]);
    if (out.length === BOOK_LEVELS) break;
  }
  return out;
}

export class BookStreamHub {
  private readonly feeds = new Map<string, Feed>();
  private readonly subOf = new Map<WebSocket, string>();
  private readonly maxFeeds: number;
  private readonly maxSubscriptions: number;
  private readonly maxViewersPerFeed: number;
  private readonly maxClientBufferedBytes: number;
  private readonly streamFactory: StreamFactory;
  private stopped = false;

  constructor(
    private readonly isKnownSymbol: (symbol: string) => boolean,
    options: BookStreamHubOptions = {},
  ) {
    this.maxFeeds = boundedInt(options.maxFeeds, DEFAULT_MAX_FEEDS);
    this.maxSubscriptions = boundedInt(options.maxSubscriptions, DEFAULT_MAX_SUBSCRIPTIONS);
    this.maxViewersPerFeed = boundedInt(options.maxViewersPerFeed, DEFAULT_MAX_VIEWERS_PER_FEED);
    this.maxClientBufferedBytes = boundedInt(
      options.maxClientBufferedBytes,
      DEFAULT_MAX_CLIENT_BUFFERED_BYTES,
    );
    this.streamFactory = options.streamFactory ?? ((name, url, onMessage, onStatus) => (
      new BinanceStream(name, url, onMessage, onStatus)
    ));
  }

  /** Handle a decoded client message; true means the hub owns the message type. */
  handleMessage(ws: WebSocket, raw: unknown): boolean {
    if (!isRecord(raw)) return false;
    if (raw.type === 'sub-book') {
      if (this.stopped) return true;
      const symbol = typeof raw.symbol === 'string' && raw.symbol.length >= 5 && raw.symbol.length <= 20
        ? raw.symbol.toUpperCase()
        : '';
      if (this.symbolIsAllowed(symbol)) this.subscribe(ws, symbol);
      return true;
    }
    if (raw.type === 'unsub-book') {
      this.unsubscribe(ws);
      return true;
    }
    return false;
  }

  /** Call when an app socket closes. */
  drop(ws: WebSocket): void {
    this.unsubscribe(ws);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const feed of this.feeds.values()) this.disposeFeed(feed);
    this.feeds.clear();
    this.subOf.clear();
  }

  private symbolIsAllowed(symbol: string): boolean {
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return false;
    try {
      return this.isKnownSymbol(symbol);
    } catch {
      return false;
    }
  }

  private subscribe(ws: WebSocket, symbol: string): void {
    const previousSymbol = this.subOf.get(ws);
    if (previousSymbol === symbol) return;
    if (!previousSymbol && this.subOf.size >= this.maxSubscriptions) return;

    let feed = this.feeds.get(symbol);
    if (!feed && !this.ensureFeedCapacity()) return;
    if (feed && feed.viewers.size >= this.maxViewersPerFeed) return;

    if (!feed) {
      try {
        feed = this.openFeed(symbol);
      } catch {
        return;
      }
      this.feeds.set(symbol, feed);
      try {
        feed.stream.start();
      } catch {
        this.disposeFeed(feed);
        this.feeds.delete(symbol);
        return;
      }
    }

    if (previousSymbol) this.leave(ws, previousSymbol);
    this.subOf.set(ws, symbol);
    feed.viewers.add(ws);
    if (feed.idleTimer) {
      clearTimeout(feed.idleTimer);
      feed.idleTimer = null;
    }
  }

  private ensureFeedCapacity(): boolean {
    if (this.feeds.size < this.maxFeeds) return true;
    // Idle grace entries are safe to evict first; an actively viewed feed is
    // never displaced to admit a new symbol.
    for (const [symbol, feed] of this.feeds) {
      if (feed.viewers.size !== 0) continue;
      this.disposeFeed(feed);
      this.feeds.delete(symbol);
      if (this.feeds.size < this.maxFeeds) return true;
    }
    return false;
  }

  private unsubscribe(ws: WebSocket): void {
    const symbol = this.subOf.get(ws);
    if (!symbol) return;
    this.subOf.delete(ws);
    this.leave(ws, symbol);
  }

  private leave(ws: WebSocket, symbol: string): void {
    const feed = this.feeds.get(symbol);
    if (!feed) return;
    feed.viewers.delete(ws);
    if (feed.viewers.size === 0 && !feed.idleTimer) {
      feed.idleTimer = setTimeout(() => {
        if (this.stopped || this.feeds.get(symbol) !== feed || feed.viewers.size > 0) return;
        this.disposeFeed(feed);
        this.feeds.delete(symbol);
      }, IDLE_TEARDOWN_MS);
      feed.idleTimer.unref?.();
    }
  }

  private openFeed(symbol: string): Feed {
    const lower = symbol.toLowerCase();
    const url = `wss://stream.binance.com:9443/stream?streams=${lower}@depth${BOOK_LEVELS}@100ms/${lower}@aggTrade`;
    const stream = this.streamFactory(
      `book-${lower}`,
      url,
      (data) => this.onFrame(symbol, data),
      () => undefined,
    );
    const flushTimer = setInterval(() => this.flushTrades(symbol), TRADE_FLUSH_MS);
    flushTimer.unref?.();
    return {
      viewers: new Set(),
      tradeBuf: [],
      lastTradeId: -1,
      idleTimer: null,
      flushTimer,
      stream,
    };
  }

  private disposeFeed(feed: Feed): void {
    clearInterval(feed.flushTimer);
    if (feed.idleTimer) clearTimeout(feed.idleTimer);
    feed.idleTimer = null;
    feed.tradeBuf.length = 0;
    try {
      feed.stream.stop();
    } catch {
      // A stream implementation cannot prevent hub teardown.
    }
  }

  private onFrame(symbol: string, data: unknown): void {
    if (this.stopped || !this.feeds.has(symbol) || !isRecord(data)) return;
    const stream = typeof data.stream === 'string' ? data.stream : '';
    const expectedPrefix = `${symbol.toLowerCase()}@`;
    if (!stream.startsWith(expectedPrefix) || data.data === undefined) return;

    if (stream === `${expectedPrefix}depth${BOOK_LEVELS}@100ms`) {
      if (!isRecord(data.data)) return;
      const depth = data.data as unknown as DepthPayload;
      if (!Number.isSafeInteger(depth.lastUpdateId) || depth.lastUpdateId < 0) return;
      const bids = normalizeLevels(depth.bids, 'bid');
      const asks = normalizeLevels(depth.asks, 'ask');
      if (!bids || !asks || bids.length === 0 || asks.length === 0) return;
      if (Number(bids[0][0]) >= Number(asks[0][0])) return;
      this.send(symbol, { type: 'book', symbol, bids, asks, ts: Date.now() });
      return;
    }

    if (stream === `${expectedPrefix}aggTrade`) {
      if (!isRecord(data.data)) return;
      const trade = data.data as unknown as AggTradePayload;
      const price = Number(trade.p);
      const qty = Number(trade.q);
      if (
        trade.e !== 'aggTrade' || trade.s !== symbol ||
        !Number.isSafeInteger(trade.a) || trade.a < 0 ||
        !Number.isFinite(price) || price <= 0 ||
        !Number.isFinite(qty) || qty <= 0 ||
        !validEventTime(trade.T) || typeof trade.m !== 'boolean'
      ) return;
      const feed = this.feeds.get(symbol);
      if (!feed || trade.a <= feed.lastTradeId) return;
      feed.lastTradeId = trade.a;
      feed.tradeBuf.push({ id: trade.a, price, qty, time: trade.T, isBuyerMaker: trade.m });
      if (feed.tradeBuf.length > MAX_TRADE_BUFFER) {
        feed.tradeBuf.splice(0, feed.tradeBuf.length - MAX_TRADE_BUFFER);
      }
    }
  }

  private flushTrades(symbol: string): void {
    const feed = this.feeds.get(symbol);
    if (this.stopped || !feed || feed.tradeBuf.length === 0) return;
    const trades = feed.tradeBuf.splice(0, feed.tradeBuf.length);
    this.send(symbol, { type: 'btrades', symbol, trades });
  }

  private send(symbol: string, message: unknown): void {
    const feed = this.feeds.get(symbol);
    if (this.stopped || !feed || feed.viewers.size === 0) return;
    let serialized: string;
    try {
      serialized = JSON.stringify(message);
    } catch {
      return;
    }
    for (const ws of [...feed.viewers]) {
      if (ws.readyState !== 1 /* WebSocket.OPEN */) continue;
      if (ws.bufferedAmount > this.maxClientBufferedBytes) {
        this.drop(ws);
        try {
          ws.terminate();
        } catch {
          // The outer websocket owner also observes eventual close.
        }
        continue;
      }
      try {
        ws.send(serialized, (error?: Error) => {
          if (error) this.drop(ws);
        });
      } catch {
        this.drop(ws);
      }
    }
  }
}
