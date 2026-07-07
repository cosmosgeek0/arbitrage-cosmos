import type WebSocket from 'ws';
import { BinanceStream } from '../binance/ws.js';

/**
 * Live order-book + trade-print fan-out for the Token Detail page.
 *
 * PUBLIC market data only — no keys, no trading surface. One Binance combined
 * stream (depth20@100ms + aggTrade) is opened per symbol that has at least one
 * viewer, and frames are rebroadcast to the app sockets subscribed to it.
 * When the last viewer leaves, the upstream closes after a short grace period
 * so back-and-forth navigation doesn't churn connections.
 *
 * Client protocol (over the existing /ws socket):
 *   → { type: 'sub-book',  symbol: 'BTCUSDT' }   subscribe (replaces previous)
 *   → { type: 'unsub-book' }                      unsubscribe
 *   ← { type: 'book',    symbol, bids, asks, ts } depth20 snapshot, ~100ms
 *   ← { type: 'btrades', symbol, trades: [...] }  agg trades, flushed ~250ms
 */

interface DepthPayload {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

interface AggTradePayload {
  e: 'aggTrade';
  a: number; // aggregate trade id
  p: string;
  q: string;
  T: number;
  m: boolean; // buyer is maker → SELL pressure print
}

interface Feed {
  stream: BinanceStream;
  viewers: Set<WebSocket>;
  tradeBuf: { id: number; price: number; qty: number; time: number; isBuyerMaker: boolean }[];
  flushTimer: NodeJS.Timeout;
  idleTimer: NodeJS.Timeout | null;
}

const IDLE_TEARDOWN_MS = 30_000;
const TRADE_FLUSH_MS = 250;
const BOOK_LEVELS = 20;

export class BookStreamHub {
  private feeds = new Map<string, Feed>();
  private subOf = new Map<WebSocket, string>();

  constructor(private readonly isKnownSymbol: (symbol: string) => boolean) {}

  /** Handle a raw client message; returns true if it was a book-hub message. */
  handleMessage(ws: WebSocket, raw: unknown): boolean {
    const msg = raw as { type?: string; symbol?: string };
    if (msg?.type === 'sub-book') {
      const symbol = String(msg.symbol ?? '').toUpperCase();
      if (/^[A-Z0-9]{5,20}$/.test(symbol) && this.isKnownSymbol(symbol)) this.subscribe(ws, symbol);
      return true;
    }
    if (msg?.type === 'unsub-book') {
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
    for (const feed of this.feeds.values()) {
      clearInterval(feed.flushTimer);
      if (feed.idleTimer) clearTimeout(feed.idleTimer);
      feed.stream.stop();
    }
    this.feeds.clear();
    this.subOf.clear();
  }

  private subscribe(ws: WebSocket, symbol: string): void {
    const prev = this.subOf.get(ws);
    if (prev === symbol) return;
    if (prev) this.leave(ws, prev);
    this.subOf.set(ws, symbol);

    let feed = this.feeds.get(symbol);
    if (!feed) {
      feed = this.openFeed(symbol);
      this.feeds.set(symbol, feed);
    }
    feed.viewers.add(ws);
    if (feed.idleTimer) {
      clearTimeout(feed.idleTimer);
      feed.idleTimer = null;
    }
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
        const f = this.feeds.get(symbol);
        if (!f || f.viewers.size > 0) return;
        clearInterval(f.flushTimer);
        f.stream.stop();
        this.feeds.delete(symbol);
      }, IDLE_TEARDOWN_MS);
    }
  }

  private openFeed(symbol: string): Feed {
    const lower = symbol.toLowerCase();
    const url = `wss://stream.binance.com:9443/stream?streams=${lower}@depth${BOOK_LEVELS}@100ms/${lower}@aggTrade`;

    const feed: Feed = {
      viewers: new Set(),
      tradeBuf: [],
      idleTimer: null,
      flushTimer: setInterval(() => this.flushTrades(symbol), TRADE_FLUSH_MS),
      stream: new BinanceStream(
        `book-${lower}`,
        url,
        (data) => this.onFrame(symbol, data),
        () => undefined // book feeds are ephemeral; not part of health reporting
      ),
    };
    feed.stream.start();
    return feed;
  }

  private onFrame(symbol: string, data: unknown): void {
    const env = data as { stream?: string; data?: unknown };
    if (!env?.stream || env.data === undefined) return;

    if (env.stream.includes('@depth')) {
      const d = env.data as DepthPayload;
      if (!Array.isArray(d.bids) || !Array.isArray(d.asks)) return;
      this.send(symbol, { type: 'book', symbol, bids: d.bids, asks: d.asks, ts: Date.now() });
      return;
    }

    if (env.stream.includes('@aggTrade')) {
      const t = env.data as AggTradePayload;
      const feed = this.feeds.get(symbol);
      if (!feed) return;
      feed.tradeBuf.push({ id: t.a, price: Number(t.p), qty: Number(t.q), time: t.T, isBuyerMaker: t.m });
      if (feed.tradeBuf.length > 400) feed.tradeBuf.splice(0, feed.tradeBuf.length - 400);
    }
  }

  private flushTrades(symbol: string): void {
    const feed = this.feeds.get(symbol);
    if (!feed || feed.tradeBuf.length === 0) return;
    const trades = feed.tradeBuf.splice(0, feed.tradeBuf.length);
    this.send(symbol, { type: 'btrades', symbol, trades });
  }

  private send(symbol: string, msg: unknown): void {
    const feed = this.feeds.get(symbol);
    if (!feed || feed.viewers.size === 0) return;
    const s = JSON.stringify(msg);
    for (const ws of feed.viewers) {
      if (ws.readyState === 1 /* OPEN */) ws.send(s);
    }
  }
}
