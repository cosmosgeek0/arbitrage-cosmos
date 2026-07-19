import WebSocket, { type ClientOptions, type RawData } from 'ws';

export const PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY = Object.freeze({
  deadlineMs: 30_000,
  maximumAttempts: 8,
  backoff: Object.freeze({
    baseDelayMs: 250,
    maximumDelayMs: 15_000,
    jitterRatio: 0.35,
    totalRetryBudgetMs: 90_000,
  }),
});

export type FeedStatus = 'connecting' | 'open' | 'closed' | 'cooldown' | 'exhausted';

type SocketFactory = (url: string, options: ClientOptions) => WebSocket;

export interface BinanceStreamOptions {
  /** Operational overrides are primarily useful for deterministic tests. */
  socketFactory?: SocketFactory;
  retryBaseMs?: number;
  retryMaxMs?: number;
  maximumAttempts?: number;
  totalRetryBudgetMs?: number;
  stableConnectionMs?: number;
  livenessCheckMs?: number;
  staleAfterMs?: number;
  maxLifetimeMs?: number;
  maxPayloadBytes?: number;
  nowMs?: () => number;
  random?: () => number;
}

const DEFAULT_RETRY_BASE_MS = PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY.backoff.baseDelayMs;
const DEFAULT_RETRY_MAX_MS = PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY.backoff.maximumDelayMs;
const DEFAULT_STABLE_CONNECTION_MS = 15_000;
const DEFAULT_LIVENESS_CHECK_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 90_000;
const DEFAULT_MAX_LIFETIME_MS = 23 * 60 * 60_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 512 * 1024;

function positiveInt(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function boundedPositiveInt(value: number | undefined, fallback: number, maximum: number): number {
  const normalized = positiveInt(value, fallback);
  return Math.min(normalized, maximum);
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
  private retryAttempts = 0;
  private retryCampaignStartedAtMs: number | null = null;

  private readonly socketFactory: SocketFactory;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly retryDeadlineMs: number;
  private readonly maximumAttempts: number;
  private readonly totalRetryBudgetMs: number;
  private readonly stableConnectionMs: number;
  private readonly livenessCheckMs: number;
  private readonly staleAfterMs: number;
  private readonly maxLifetimeMs: number;
  private readonly maxPayloadBytes: number;
  private readonly nowMs: () => number;
  private readonly random: () => number;

  constructor(
    readonly name: string,
    private readonly url: string,
    private readonly onMessage: (data: unknown) => void,
    private readonly onStatus: (name: string, status: FeedStatus) => void,
    options: BinanceStreamOptions = {},
  ) {
    this.socketFactory = options.socketFactory ?? ((url, wsOptions) => new WebSocket(url, wsOptions));
    this.retryBaseMs = boundedPositiveInt(
      options.retryBaseMs,
      DEFAULT_RETRY_BASE_MS,
      PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY.backoff.maximumDelayMs,
    );
    this.retryMaxMs = Math.max(
      this.retryBaseMs,
      boundedPositiveInt(
        options.retryMaxMs,
        DEFAULT_RETRY_MAX_MS,
        PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY.backoff.maximumDelayMs,
      ),
    );
    this.maximumAttempts = boundedPositiveInt(
      options.maximumAttempts,
      PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY.maximumAttempts,
      PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY.maximumAttempts,
    );
    this.retryDeadlineMs = PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY.deadlineMs;
    this.totalRetryBudgetMs = boundedPositiveInt(
      options.totalRetryBudgetMs,
      PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY.backoff.totalRetryBudgetMs,
      PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY.backoff.totalRetryBudgetMs,
    );
    // A connection must be able to prove stability strictly inside the retry
    // deadline; otherwise time spent healthily connected is charged to the
    // retry budget and a routine mid-life disconnect (after deadlineMs but
    // before stableConnectionMs) exhausts the campaign with zero attempts.
    this.stableConnectionMs = Math.min(
      positiveInt(options.stableConnectionMs, DEFAULT_STABLE_CONNECTION_MS),
      Math.floor(this.retryDeadlineMs / 2),
    );
    this.livenessCheckMs = positiveInt(options.livenessCheckMs, DEFAULT_LIVENESS_CHECK_MS);
    this.staleAfterMs = Math.max(
      this.livenessCheckMs,
      positiveInt(options.staleAfterMs, DEFAULT_STALE_AFTER_MS),
    );
    this.maxLifetimeMs = positiveInt(options.maxLifetimeMs, DEFAULT_MAX_LIFETIME_MS);
    this.maxPayloadBytes = positiveInt(options.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES);
    this.nowMs = options.nowMs ?? Date.now;
    this.random = options.random ?? Math.random;
    this.backoffMs = this.retryBaseMs;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.backoffMs = this.retryBaseMs;
    this.retryAttempts = 0;
    this.retryCampaignStartedAtMs = this.readNowMs();
    this.lastStatus = null;
    const generation = ++this.generation;
    if (this.retryCampaignStartedAtMs === null) {
      this.exhaustRetries(generation);
      return;
    }
    this.connect(generation);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    ++this.generation;
    this.clearAllTimers();
    this.retryAttempts = 0;
    this.retryCampaignStartedAtMs = null;

    const ws = this.ws;
    this.ws = null;
    if (ws) this.closeSocket(ws, true);
    this.emitStatus('closed');
  }

  private connect(generation: number): void {
    if (!this.isActive(generation) || this.ws) return;
    this.clearReconnectTimer();
    if (!this.canDispatchAttempt()) {
      this.exhaustRetries(generation);
      return;
    }
    this.retryAttempts += 1;
    this.emitStatus('connecting');
    if (!this.isActive(generation)) return;

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
      const openedAt = this.readNowMs();
      if (openedAt === null) {
        this.closeSocket(ws, true);
        return;
      }
      this.lastActivityAt = openedAt;
      this.clearConnectionTimers();
      this.stableTimer = setTimeout(() => {
        if (!this.isCurrent(generation, ws)) return;
        const stableAt = this.readNowMs();
        if (stableAt === null) return;
        this.backoffMs = this.retryBaseMs;
        this.retryAttempts = 0;
        this.retryCampaignStartedAtMs = null;
      }, this.stableConnectionMs);
      this.stableTimer.unref?.();
      this.lifeTimer = setTimeout(() => {
        if (this.isCurrent(generation, ws)) this.closeSocket(ws, false);
      }, this.maxLifetimeMs);
      this.lifeTimer.unref?.();
      this.heartbeatTimer = setInterval(() => {
        if (!this.isCurrent(generation, ws)) return;
        const nowMs = this.readNowMs();
        if (nowMs === null || nowMs - this.lastActivityAt > this.staleAfterMs) {
          this.closeSocket(ws, true);
        }
      }, this.livenessCheckMs);
      this.heartbeatTimer.unref?.();
      // Emit only after the timers exist. If a status consumer stops the
      // stream synchronously, stop() can then clear every connection timer.
      this.emitStatus('open');
    });

    const noteActivity = () => {
      if (!this.isCurrent(generation, ws)) return;
      const nowMs = this.readNowMs();
      if (nowMs !== null) this.lastActivityAt = nowMs;
    };
    ws.on('ping', noteActivity);
    ws.on('pong', noteActivity);

    ws.on('message', (buf: RawData, isBinary: boolean) => {
      if (!this.isCurrent(generation, ws)) return;
      const nowMs = this.readNowMs();
      if (nowMs === null) {
        this.closeSocket(ws, true);
        return;
      }
      this.lastActivityAt = nowMs;
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
    if (this.retryAttempts >= this.maximumAttempts) {
      this.exhaustRetries(generation);
      return;
    }
    const random = this.readRandomUnit();
    const jitter = PUBLIC_WEBSOCKET_STREAM_RETRY_POLICY.backoff.jitterRatio;
    const delay = Math.max(
      1,
      Math.floor(this.backoffMs * (1 - jitter + (2 * jitter * random))),
    );
    if (!this.canScheduleAttempt(delay)) {
      this.exhaustRetries(generation);
      return;
    }
    this.backoffMs = Math.min(this.retryMaxMs, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isActive(generation)) this.connect(generation);
    }, delay);
    this.reconnectTimer.unref?.();
    this.emitStatus('cooldown');
  }

  private canDispatchAttempt(): boolean {
    if (this.retryAttempts >= this.maximumAttempts) return false;
    const nowMs = this.readNowMs();
    if (nowMs === null) return false;
    if (this.retryCampaignStartedAtMs === null) this.retryCampaignStartedAtMs = nowMs;
    const elapsedMs = nowMs - this.retryCampaignStartedAtMs;
    return (
      elapsedMs >= 0 &&
      elapsedMs < this.retryDeadlineMs &&
      elapsedMs < this.totalRetryBudgetMs
    );
  }

  private canScheduleAttempt(delayMs: number): boolean {
    const nowMs = this.readNowMs();
    if (nowMs === null) return false;
    if (this.retryCampaignStartedAtMs === null) this.retryCampaignStartedAtMs = nowMs;
    const elapsedMs = nowMs - this.retryCampaignStartedAtMs;
    return (
      elapsedMs >= 0 &&
      elapsedMs < this.retryDeadlineMs &&
      elapsedMs < this.totalRetryBudgetMs &&
      delayMs < this.retryDeadlineMs - elapsedMs &&
      delayMs < this.totalRetryBudgetMs - elapsedMs
    );
  }

  private exhaustRetries(generation: number): void {
    if (!this.isActive(generation)) return;
    this.clearReconnectTimer();
    this.emitStatus('exhausted');
  }

  private readNowMs(): number | null {
    try {
      const value = this.nowMs();
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  }

  private readRandomUnit(): number {
    try {
      const value = this.random();
      return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
    } catch {
      return 0.5;
    }
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
