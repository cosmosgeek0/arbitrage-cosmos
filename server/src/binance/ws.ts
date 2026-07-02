import WebSocket from 'ws';

export type FeedStatus = 'connecting' | 'open' | 'closed';

/**
 * Reconnecting Binance market stream. Binance force-closes connections at 24h,
 * so we proactively cycle at 23h. The `ws` library answers server pings
 * automatically, which is all Binance requires to keep the stream alive.
 */
export class BinanceStream {
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoffMs = 1_000;
  private lifeTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly name: string,
    private readonly url: string,
    private readonly onMessage: (data: unknown) => void,
    private readonly onStatus: (name: string, status: FeedStatus) => void
  ) {}

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearLifeTimer();
    this.ws?.close();
  }

  private connect(): void {
    this.onStatus(this.name, 'connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      this.backoffMs = 1_000;
      this.onStatus(this.name, 'open');
      this.lifeTimer = setTimeout(() => ws.close(), 23 * 3600 * 1000);
    });

    ws.on('message', (buf) => {
      try {
        this.onMessage(JSON.parse(buf.toString()));
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('error', () => {
      // 'close' always follows 'error' on ws, reconnect is handled there
    });

    ws.on('close', () => {
      this.clearLifeTimer();
      this.onStatus(this.name, 'closed');
      if (this.stopped) return;
      setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    });
  }

  private clearLifeTimer(): void {
    if (this.lifeTimer) {
      clearTimeout(this.lifeTimer);
      this.lifeTimer = null;
    }
  }
}
