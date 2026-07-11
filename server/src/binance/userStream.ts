import { randomUUID } from 'node:crypto';
import WebSocket, { type ClientOptions, type RawData } from 'ws';
import type { BinanceClient } from './client.js';
import { boundedBinanceIdentifier } from './identifiers.js';

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

type SocketFactory = (url: string, options: ClientOptions) => WebSocket;

export interface UserStreamOptions {
  socketFactory?: SocketFactory;
  retryBaseMs?: number;
  retryMaxMs?: number;
  subscriptionTimeoutMs?: number;
  livenessCheckMs?: number;
  staleAfterMs?: number;
  maxLifetimeMs?: number;
  maxPayloadBytes?: number;
  random?: () => number;
  requestIdFactory?: () => string;
}

const USER_STREAM_URL = 'wss://ws-api.binance.com:443/ws-api/v3';
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 30_000;
const MAX_RETRY_BASE_MS = 60_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
const MAX_SERVER_RETRY_AFTER_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_SUBSCRIPTION_TIMEOUT_MS = 10_000;
const STABLE_CONNECTION_MS = 60_000;
const DEFAULT_LIVENESS_CHECK_MS = 30_000;
const MAX_LIVENESS_CHECK_MS = 60_000;
// Binance sends a WebSocket ping every 20 seconds. Three missed intervals plus
// headroom is treated as a dead connection.
const DEFAULT_STALE_AFTER_MS = 90_000;
const MAX_STALE_AFTER_MS = 5 * 60_000;
// Binance disconnects WebSocket API sessions after 24 hours. Recycle before
// the hard boundary so the polling fallback is not surprised by the cutoff.
const MAX_CONNECTION_LIFETIME_MS = 24 * 60 * 60_000;
const DEFAULT_MAX_LIFETIME_MS = 23 * 60 * 60_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const BINANCE_EPOCH_MS = Date.UTC(2017, 0, 1);
const MAX_SUBSCRIPTION_ID = 65_535;

function positiveInt(value: number | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Math.min(Number(value), max)
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function plausibleTimestamp(value: unknown, now = Date.now()): value is number {
  return Number.isSafeInteger(value)
    && Number(value) >= BINANCE_EPOCH_MS
    && Number(value) <= now + 5 * 60_000;
}

function finiteNumber(value: unknown, nonNegative: boolean): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  if (typeof value === 'string' && (value.length === 0 || value.length > 64)) return false;
  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && (!nonNegative || parsed >= 0);
}

function validSubscriptionId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_SUBSCRIPTION_ID;
}

function validRequestId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function serverRetryAfterAt(message: Record<string, unknown>, now = Date.now()): number | null {
  if (message.status !== 418 && message.status !== 429) return null;
  const error = isRecord(message.error) ? message.error : null;
  const data = error && isRecord(error.data) ? error.data : null;
  const retryAfter = data?.retryAfter;
  if (!Number.isSafeInteger(retryAfter)) return null;
  const delay = Number(retryAfter) - now;
  if (delay <= 0) return null;
  return now + Math.min(delay, MAX_SERVER_RETRY_AFTER_MS);
}

function rawDataBuffer(data: RawData, maxBytes: number): Buffer | null {
  if (Buffer.isBuffer(data)) return data.byteLength <= maxBytes ? data : null;
  if (data instanceof ArrayBuffer) {
    return data.byteLength <= maxBytes ? Buffer.from(data) : null;
  }
  if (Array.isArray(data)) {
    let byteLength = 0;
    for (const part of data) {
      byteLength += part.byteLength;
      if (byteLength > maxBytes) return null;
    }
    return Buffer.concat(data, byteLength);
  }
  return null;
}

/** Reject malformed or unbounded private-account messages before callbacks. */
function validUserEvent(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.e !== 'string' || value.e.length > 64) return false;

  if (value.e === 'executionReport') {
    return (
      boundedBinanceIdentifier(value.s) &&
      (value.S === 'BUY' || value.S === 'SELL') &&
      typeof value.o === 'string' && value.o.length <= 32 &&
      Number.isSafeInteger(value.i) && Number(value.i) >= 0 &&
      typeof value.x === 'string' && value.x.length <= 32 &&
      typeof value.X === 'string' && value.X.length <= 32 &&
      finiteNumber(value.l, true) && finiteNumber(value.L, true) && finiteNumber(value.n, true) &&
      (value.N === null || boundedBinanceIdentifier(value.N)) &&
      Number.isSafeInteger(value.t) && Number(value.t) >= -1 &&
      plausibleTimestamp(value.T)
    );
  }

  if (value.e === 'outboundAccountPosition') {
    if (
      !plausibleTimestamp(value.E) ||
      !plausibleTimestamp(value.u) ||
      !Array.isArray(value.B) ||
      value.B.length > 1_000
    ) return false;
    return value.B.every((row) => (
      isRecord(row) &&
      boundedBinanceIdentifier(row.a) &&
      finiteNumber(row.f, true) && finiteNumber(row.l, true)
    ));
  }

  if (value.e === 'balanceUpdate') {
    return (
      boundedBinanceIdentifier(value.a) &&
      finiteNumber(value.d, false) &&
      plausibleTimestamp(value.T)
    );
  }

  return value.e === 'eventStreamTerminated'
    && (value.E === undefined || plausibleTimestamp(value.E));
}

/**
 * Optional Spot private stream using the current signed WebSocket API
 * subscription. REST polling remains authoritative: this stream only reduces
 * reconciliation latency and may fail or recycle without stopping the app.
 * Every socket and timer is fenced by a start generation.
 */
export class UserStream {
  status: UserStreamStatus = 'off';
  private ws: WebSocket | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lifeTimer: NodeJS.Timeout | null = null;
  private subscriptionTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private generation = 0;
  private retryMs: number;
  private retryNotBeforeAt = 0;
  private lastActivityAt = 0;
  private lastStatusDetail = '';

  private readonly socketFactory: SocketFactory;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly subscriptionTimeoutMs: number;
  private readonly livenessCheckMs: number;
  private readonly staleAfterMs: number;
  private readonly maxLifetimeMs: number;
  private readonly maxPayloadBytes: number;
  private readonly random: () => number;
  private readonly requestIdFactory: () => string;

  constructor(
    private readonly client: BinanceClient,
    private readonly onEvent: (ev: Record<string, unknown>) => void,
    private readonly onStatus: (status: UserStreamStatus, detail?: string) => void,
    options: UserStreamOptions = {},
  ) {
    this.socketFactory = options.socketFactory ?? ((url, wsOptions) => new WebSocket(url, wsOptions));
    this.retryBaseMs = positiveInt(options.retryBaseMs, DEFAULT_RETRY_BASE_MS, MAX_RETRY_BASE_MS);
    this.retryMaxMs = Math.max(
      this.retryBaseMs,
      positiveInt(options.retryMaxMs, DEFAULT_RETRY_MAX_MS, MAX_RETRY_DELAY_MS),
    );
    this.subscriptionTimeoutMs = positiveInt(
      options.subscriptionTimeoutMs,
      DEFAULT_SUBSCRIPTION_TIMEOUT_MS,
      60_000,
    );
    this.livenessCheckMs = positiveInt(
      options.livenessCheckMs,
      DEFAULT_LIVENESS_CHECK_MS,
      MAX_LIVENESS_CHECK_MS,
    );
    this.staleAfterMs = Math.max(
      this.livenessCheckMs,
      positiveInt(options.staleAfterMs, DEFAULT_STALE_AFTER_MS, MAX_STALE_AFTER_MS),
    );
    this.maxLifetimeMs = positiveInt(
      options.maxLifetimeMs,
      DEFAULT_MAX_LIFETIME_MS,
      MAX_CONNECTION_LIFETIME_MS,
    );
    this.maxPayloadBytes = positiveInt(options.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES, 1024 * 1024);
    this.random = options.random ?? Math.random;
    this.requestIdFactory = options.requestIdFactory ?? randomUUID;
    this.retryMs = this.retryBaseMs;
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.retryMs = this.retryBaseMs;
    this.lastStatusDetail = '';
    const generation = ++this.generation;
    this.setStatus('connecting');
    if (this.retryNotBeforeAt > Date.now()) this.scheduleRestart(generation);
    else this.connect(generation);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    ++this.generation;
    this.clearAllTimers();

    const ws = this.ws;
    this.ws = null;
    if (ws) this.closeSocket(ws, true);
    this.setStatus('off');
  }

  private connect(generation: number): void {
    if (!this.isActive(generation) || this.ws) return;
    let ws: WebSocket;
    try {
      ws = this.socketFactory(USER_STREAM_URL, {
        handshakeTimeout: 10_000,
        maxPayload: this.maxPayloadBytes,
        perMessageDeflate: false,
        followRedirects: false,
      });
    } catch {
      this.setStatus('failed', 'private stream connection unavailable');
      this.scheduleRestart(generation);
      return;
    }
    this.ws = ws;
    let requestId: string | null = null;
    let subscriptionId: number | null = null;

    ws.on('open', () => {
      if (!this.isCurrent(generation, ws)) {
        this.closeSocket(ws, true);
        return;
      }
      this.lastActivityAt = Date.now();
      this.setStatus('connecting', 'authenticating private stream');
      this.startConnectionTimers(generation, ws);

      let frame: string;
      try {
        requestId = this.requestIdFactory();
        if (!validRequestId(requestId)) throw new Error('invalid request id');
        frame = this.client.userDataStreamSubscribeFrame(requestId);
      } catch {
        this.failConnection(ws, 'private stream subscription unavailable');
        return;
      }

      this.subscriptionTimer = setTimeout(() => {
        if (this.isCurrent(generation, ws) && subscriptionId === null) {
          this.failConnection(ws, 'private stream subscription timed out');
        }
      }, this.subscriptionTimeoutMs);
      this.subscriptionTimer.unref?.();

      try {
        ws.send(frame, (error) => {
          if (error && this.isCurrent(generation, ws)) {
            this.failConnection(ws, 'private stream subscription send failed');
          }
        });
      } catch {
        this.failConnection(ws, 'private stream subscription send failed');
        return;
      }
    });

    const noteActivity = () => {
      if (this.isCurrent(generation, ws)) this.lastActivityAt = Date.now();
    };
    ws.on('ping', noteActivity);
    ws.on('pong', noteActivity);

    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (!this.isCurrent(generation, ws)) return;
      this.lastActivityAt = Date.now();
      if (isBinary) return;
      const buffer = rawDataBuffer(data, this.maxPayloadBytes);
      if (!buffer) {
        this.failConnection(ws, 'private stream frame exceeded safety bounds');
        return;
      }

      let message: unknown;
      try {
        message = JSON.parse(buffer.toString('utf8')) as unknown;
      } catch {
        return;
      }

      if (isRecord(message)
        && isRecord(message.event)
        && message.event.e === 'serverShutdown'
        && plausibleTimestamp(message.event.E)) {
        this.failConnection(ws, 'private stream server is shutting down');
        return;
      }

      if (isRecord(message) && requestId !== null && message.id === requestId) {
        const result = isRecord(message.result) ? message.result : null;
        if (message.status !== 200 || !result || !validSubscriptionId(result.subscriptionId)) {
          const retryAfterAt = serverRetryAfterAt(message);
          if (retryAfterAt !== null) {
            this.retryNotBeforeAt = Math.max(this.retryNotBeforeAt, retryAfterAt);
          }
          const status = Number.isSafeInteger(message.status) ? ` (${String(message.status)})` : '';
          this.failConnection(ws, `private stream subscription rejected${status}`);
          return;
        }
        if (subscriptionId !== null && subscriptionId !== result.subscriptionId) {
          this.failConnection(ws, 'private stream subscription identity changed');
          return;
        }
        subscriptionId = result.subscriptionId;
        this.clearSubscriptionTimer();
        if (this.stableTimer) clearTimeout(this.stableTimer);
        this.stableTimer = setTimeout(() => {
          if (this.isCurrent(generation, ws)) {
            this.retryMs = this.retryBaseMs;
            this.retryNotBeforeAt = 0;
          }
        }, STABLE_CONNECTION_MS);
        this.stableTimer.unref?.();
        this.setStatus('open');
        return;
      }

      if (!isRecord(message)
        || subscriptionId === null
        || message.subscriptionId !== subscriptionId
        || !validUserEvent(message.event)) {
        return;
      }
      const event = message.event;
      if (event.e === 'eventStreamTerminated') {
        this.failConnection(ws, 'private stream terminated by Binance');
        return;
      }
      try {
        this.onEvent(event);
      } catch {
        // Polling remains authoritative even if one low-latency callback fails.
        console.warn('Binance user-stream callback failed');
      }
    });

    ws.on('error', () => {
      if (this.isCurrent(generation, ws)) this.closeSocket(ws, true);
    });

    ws.on('close', () => {
      if (!this.isCurrent(generation, ws)) return;
      this.ws = null;
      this.clearConnectionTimers();
      this.setStatus('connecting', 'private stream closed, reconnecting');
      this.scheduleRestart(generation);
    });
  }

  private startConnectionTimers(generation: number, ws: WebSocket): void {
    this.clearConnectionTimers();
    this.lifeTimer = setTimeout(() => {
      if (this.isCurrent(generation, ws)) this.closeSocket(ws, false);
    }, this.maxLifetimeMs);
    this.lifeTimer.unref?.();
    this.heartbeatTimer = setInterval(() => {
      if (!this.isCurrent(generation, ws)) return;
      if (Date.now() - this.lastActivityAt > this.staleAfterMs) this.closeSocket(ws, true);
    }, this.livenessCheckMs);
    this.heartbeatTimer.unref?.();
  }

  private failConnection(ws: WebSocket, detail: string): void {
    if (this.ws !== ws) return;
    this.setStatus('failed', detail);
    this.closeSocket(ws, true);
  }

  private scheduleRestart(generation: number): void {
    if (!this.isActive(generation) || this.restartTimer) return;
    const random = Math.min(1, Math.max(0, this.random()));
    const localDelay = Math.max(1, Math.floor(this.retryMs * (0.8 + random * 0.4)));
    const serverDelay = Math.max(
      0,
      Math.min(MAX_SERVER_RETRY_AFTER_MS, this.retryNotBeforeAt - Date.now()),
    );
    const delay = Math.max(localDelay, serverDelay);
    this.retryMs = Math.min(this.retryMaxMs, this.retryMs * 2);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.isActive(generation)) return;
      if (this.retryNotBeforeAt > Date.now()) this.scheduleRestart(generation);
      else this.connect(generation);
    }, delay);
    this.restartTimer.unref?.();
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
      else if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'user stream recycle');
    } catch {
      // Generation checks prevent a socket with a failed close from being reused.
    }
  }

  private setStatus(status: UserStreamStatus, detail?: string): void {
    const normalizedDetail = detail ?? '';
    if (this.status === status && this.lastStatusDetail === normalizedDetail) return;
    this.status = status;
    this.lastStatusDetail = normalizedDetail;
    try {
      this.onStatus(status, detail);
    } catch {
      console.warn('Binance user-stream status callback failed');
    }
  }

  private clearSubscriptionTimer(): void {
    if (this.subscriptionTimer) clearTimeout(this.subscriptionTimer);
    this.subscriptionTimer = null;
  }

  private clearConnectionTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.lifeTimer) clearTimeout(this.lifeTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.heartbeatTimer = null;
    this.lifeTimer = null;
    this.stableTimer = null;
    this.clearSubscriptionTimer();
  }

  private clearAllTimers(): void {
    this.clearConnectionTimers();
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }
}
