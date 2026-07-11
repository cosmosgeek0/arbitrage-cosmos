import WebSocket, { type ClientOptions, type RawData } from 'ws';

export type FeedStatus = 'connecting' | 'open' | 'closed';

type SocketFactory = (url: string, options: ClientOptions) => WebSocket;

export interface BinanceStreamOptions {
  /** Operational overrides are primarily useful for deterministic tests. */
  socketFactory?: SocketFactory;
  retryBaseMs?: number;
  retryMaxMs?: number;
  stableConnectionMs?: number;
  livenessCheckMs?: number;
  staleAfterMs?: number;
  maxLifetimeMs?: number;
  maxPayloadBytes?: number;
  random?: () => number;
}

const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 30_000;
const DEFAULT_STABLE_CONNECTION_MS = 60_000;
const DEFAULT_LIVENESS_CHECK_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 90_000;
const DEFAULT_MAX_LIFETIME_MS = 23 * 60 * 60_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 512 * 1024;

function positiveInt(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

/**
 * Reconnecting Binance market stream.
 *
 * Every asynchronous callback belongs to a start generation. Calling stop()
 * invalidates that generation before closing the socket, so a late close,
 * heartbeat, or retry callback cannot resurrect a stopped stream. Binance
 * force-closes connections at 24h; the stream proactively cycles at 23h.
 */
export class BinanceStream {
  private ws: WebSocket | null = null;
  private stopped = true;
  private generation = 0;
  private backoffMs: number;
  private lifeTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastActivityAt = 0;
  private lastStatus: FeedStatus | null = null;

  private readonly socketFactory: SocketFactory;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly stableConnectionMs: number;
  private readonly livenessCheckMs: number;
  private readonly staleAfterMs: number;
  private readonly maxLifetimeMs: number;
  private readonly maxPayloadBytes: number;
  private readonly random: () => number;

  constructor(
    readonly name: string,
    private readonly url: string,
    private readonly onMessage: (data: unknown) => void,
    private readonly onStatus: (name: string, status: FeedStatus) => void,
    options: BinanceStreamOptions = {},
  ) {
    this.socketFactory = options.socketFactory ?? ((url, wsOptions) => new WebSocket(url, wsOptions));
    this.retryBaseMs = positiveInt(options.retryBaseMs, DEFAULT_RETRY_BASE_MS);
    this.retryMaxMs = Math.max(
      this.retryBaseMs,
      positiveInt(options.retryMaxMs, DEFAULT_RETRY_MAX_MS),
    );
    this.stableConnectionMs = positiveInt(
      options.stableConnectionMs,
      DEFAULT_STABLE_CONNECTION_MS,
    );
    this.livenessCheckMs = positiveInt(options.livenessCheckMs, DEFAULT_LIVENESS_CHECK_MS);
    this.staleAfterMs = Math.max(
      this.livenessCheckMs,
      positiveInt(options.staleAfterMs, DEFAULT_STALE_AFTER_MS),
    );
    this.maxLifetimeMs = positiveInt(options.maxLifetimeMs, DEFAULT_MAX_LIFETIME_MS);
    this.maxPayloadBytes = positiveInt(options.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES);
    this.random = options.random ?? Math.random;
    this.backoffMs = this.retryBaseMs;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.backoffMs = this.retryBaseMs;
    this.lastStatus = null;
    const generation = ++this.generation;
    this.connect(generation);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    ++this.generation;
    this.clearAllTimers();

    const ws = this.ws;
    this.ws = null;
    if (ws) this.closeSocket(ws, true);
    this.emitStatus('closed');
  }

  private connect(generation: number): void {
    if (!this.isActive(generation) || this.ws) return;
    this.clearReconnectTimer();
    this.emitStatus('connecting');

    let ws: WebSocket;
    try {
      ws = this.socketFactory(this.url, {
        handshakeTimeout: 10_000,
        maxPayload: this.maxPayloadBytes,
        perMessageDeflate: false,
      });
    } catch {
      this.emitStatus('closed');
      this.scheduleReconnect(generation);
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      if (!this.isCurrent(generation, ws)) {
        this.closeSocket(ws, true);
        return;
      }
      this.lastActivityAt = Date.now();
      this.clearConnectionTimers();
      this.stableTimer = setTimeout(() => {
        if (this.isCurrent(generation, ws)) this.backoffMs = this.retryBaseMs;
      }, this.stableConnectionMs);
      this.stableTimer.unref?.();
      this.lifeTimer = setTimeout(() => {
        if (this.isCurrent(generation, ws)) this.closeSocket(ws, false);
      }, this.maxLifetimeMs);
      this.lifeTimer.unref?.();
      this.heartbeatTimer = setInterval(() => {
        if (!this.isCurrent(generation, ws)) return;
        if (Date.now() - this.lastActivityAt > this.staleAfterMs) this.closeSocket(ws, true);
      }, this.livenessCheckMs);
      this.heartbeatTimer.unref?.();
      // Emit only after the timers exist. If a status consumer stops the
      // stream synchronously, stop() can then clear every connection timer.
      this.emitStatus('open');
    });

    const noteActivity = () => {
      if (this.isCurrent(generation, ws)) this.lastActivityAt = Date.now();
    };
    ws.on('ping', noteActivity);
    ws.on('pong', noteActivity);

    ws.on('message', (buf: RawData, isBinary: boolean) => {
      if (!this.isCurrent(generation, ws)) return;
      this.lastActivityAt = Date.now();
      if (isBinary) return;
      let data: unknown;
      try {
        data = JSON.parse(buf.toString());
      } catch {
        return;
      }
      try {
        this.onMessage(data);
      } catch (error) {
        // A consumer bug must not tear down the socket event emitter.
        console.warn(`Binance stream ${this.name} message callback failed:`, error);
      }
    });

    ws.on('error', () => {
      // ws normally follows an error with close. Terminating also covers
      // handshake implementations that do not complete that transition.
      if (this.isCurrent(generation, ws)) this.closeSocket(ws, true);
    });

    ws.on('close', () => {
      if (!this.isCurrent(generation, ws)) return;
      this.ws = null;
      this.clearConnectionTimers();
      this.emitStatus('closed');
      this.scheduleReconnect(generation);
    });
  }

  private scheduleReconnect(generation: number): void {
    if (!this.isActive(generation) || this.reconnectTimer) return;
    const random = Math.min(1, Math.max(0, this.random()));
    const delay = Math.max(1, Math.floor(this.backoffMs * (0.8 + random * 0.4)));
    this.backoffMs = Math.min(this.retryMaxMs, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isActive(generation)) this.connect(generation);
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private isActive(generation: number): boolean {
    return !this.stopped && generation === this.generation;
  }

  private isCurrent(generation: number, ws: WebSocket): boolean {
    return this.isActive(generation) && this.ws === ws;
  }

  private closeSocket(ws: WebSocket, terminate: boolean): void {
    try {
      if (terminate || ws.readyState === WebSocket.CONNECTING) ws.terminate();
      else if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'stream recycle');
    } catch {
      // Closing is best effort; generation ownership still prevents reuse.
    }
  }

  private emitStatus(status: FeedStatus): void {
    if (this.lastStatus === status) return;
    this.lastStatus = status;
    try {
      this.onStatus(this.name, status);
    } catch (error) {
      console.warn(`Binance stream ${this.name} status callback failed:`, error);
    }
  }

  private clearConnectionTimers(): void {
    if (this.lifeTimer) clearTimeout(this.lifeTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.lifeTimer = null;
    this.stableTimer = null;
    this.heartbeatTimer = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearAllTimers(): void {
    this.clearConnectionTimers();
    this.clearReconnectTimer();
  }
}
