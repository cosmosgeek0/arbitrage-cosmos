import WebSocket from 'ws';
import type { BinanceClient } from './client.js';

export type UserStreamStatus = 'off' | 'connecting' | 'open' | 'failed';

export interface ExecutionReport {
  e: 'executionReport';
  s: string; // symbol
  S: string; // side
  o: string; // order type
  i: number; // orderId
  x: string; // execution type
  X: string; // order status
  l: string; // last executed qty
  L: string; // last executed price
  n: string; // commission
  N: string | null; // commission asset
  t: number; // trade id (-1 if none)
  T: number; // transaction time
}

/**
 * Spot user data stream via the listenKey flow. Binance's docs now push the
 * WebSocket-API subscription instead, and the listenKey flow may eventually
 * disappear — so this class treats itself as OPTIONAL: if anything fails, it
 * reports 'failed' and the app relies on 30s polling. Never assume this works.
 */
export class UserStream {
  status: UserStreamStatus = 'off';
  private ws: WebSocket | null = null;
  private listenKey: string | null = null;
  private keepAlive: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly client: BinanceClient,
    private readonly onEvent: (ev: Record<string, unknown>) => void,
    private readonly onStatus: (status: UserStreamStatus, detail?: string) => void
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.setStatus('connecting');
    try {
      const { listenKey } = await this.client.createListenKey();
      this.listenKey = listenKey;
    } catch (err) {
      this.setStatus('failed', `listenKey unavailable: ${(err as Error).message}`);
      return;
    }
    this.connect();
    this.keepAlive = setInterval(() => {
      if (this.listenKey) {
        this.client.keepAliveListenKey(this.listenKey).catch(() => {
          // keepalive failure → force reconnect cycle
          this.ws?.close();
        });
      }
    }, 30 * 60 * 1000);
  }

  stop(): void {
    this.stopped = true;
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.ws?.close();
    this.setStatus('off');
  }

  private connect(): void {
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${this.listenKey}`);
    this.ws = ws;
    ws.on('open', () => this.setStatus('open'));
    ws.on('message', (buf) => {
      try {
        this.onEvent(JSON.parse(buf.toString()) as Record<string, unknown>);
      } catch {
        // ignore malformed frames
      }
    });
    ws.on('error', () => {
      // 'close' follows
    });
    ws.on('close', () => {
      if (this.stopped) return;
      this.setStatus('connecting', 'stream closed, reconnecting');
      setTimeout(() => void this.restart(), 5_000);
    });
  }

  private async restart(): Promise<void> {
    try {
      const { listenKey } = await this.client.createListenKey();
      this.listenKey = listenKey;
      this.connect();
    } catch (err) {
      this.setStatus('failed', `reconnect failed: ${(err as Error).message}`);
    }
  }

  private setStatus(s: UserStreamStatus, detail?: string): void {
    this.status = s;
    this.onStatus(s, detail);
  }
}
