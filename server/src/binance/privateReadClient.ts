import { createHmac } from 'node:crypto';

import {
  BinanceApiError,
  rateLimit,
  type BinanceCreds,
} from './client.js';

const BASE_URLS = Object.freeze({
  SPOT: 'https://api.binance.com',
  USDM: 'https://fapi.binance.com',
});
const SIGNED_GET_PATHS = Object.freeze({
  SPOT: new Set([
    '/sapi/v1/account/apiRestrictions',
    '/api/v3/account',
    '/api/v3/openOrders',
    '/api/v3/myTrades',
    '/sapi/v1/margin/account',
    '/sapi/v1/margin/openOrders',
    '/sapi/v1/margin/myTrades',
  ]),
  USDM: new Set([
    '/fapi/v3/balance',
    '/fapi/v3/positionRisk',
    '/fapi/v1/openOrders',
    '/fapi/v1/userTrades',
  ]),
});
const TIME_PATHS = Object.freeze({
  SPOT: '/api/v3/time',
  USDM: '/fapi/v1/time',
});
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_QUERY_BYTES = 16 * 1024;
const MAX_PARAMS = 32;
const MAX_PARAM_VALUE_CHARS = 256;
const MAX_RESPONSE_CHUNKS = 4_096;
const JSON_CONTENT_TYPE_RE = /^(?:application\/json|[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+\+json)$/i;

export type PrivateReadProduct = keyof typeof BASE_URLS;

export interface BinancePrivateReadClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.trunc(value)))
    : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export class BinancePrivateReadClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly serverTimeOffsetMs: Record<PrivateReadProduct, number> = { SPOT: 0, USDM: 0 };
  private readonly timeSyncGeneration: Record<PrivateReadProduct, number> = { SPOT: 0, USDM: 0 };
  private readonly timeSyncInFlight: Partial<Record<PrivateReadProduct, Promise<void>>> = {};
  private cooldownUntil = 0;

  constructor(
    private readonly creds: BinanceCreds,
    options: BinancePrivateReadClientOptions = {},
  ) {
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = boundedInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      10,
      60_000,
    );
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      64,
      16 * 1024 * 1024,
    );
  }

  async request<T>(
    method: string,
    product: PrivateReadProduct,
    path: string,
    params: Readonly<Record<string, string | number | undefined>> = {},
  ): Promise<T> {
    if (method !== 'GET') {
      throw new Error('Private Binance transport permits GET requests only');
    }
    if (product !== 'SPOT' && product !== 'USDM') {
      throw new Error('Private Binance product is not allowed');
    }
    if (!SIGNED_GET_PATHS[product].has(path)) {
      throw new Error('Private Binance GET path is not allowed');
    }
    const generationAtSend = this.timeSyncGeneration[product];
    try {
      return await this.requestOnce<T>(product, path, params, true);
    } catch (error) {
      if (!(error instanceof BinanceApiError) || error.binanceCode !== -1021) throw error;
      if (generationAtSend === this.timeSyncGeneration[product]) {
        await this.synchronizeServerTime(product);
      }
      return this.requestOnce<T>(product, path, params, true);
    }
  }

  /**
   * The permission answer is returned exactly as Binance sent it. The legacy
   * client normalizes this payload — coercing `"false"` to `false` and dropping
   * unrecognized keys — which would hand the strict decoder a shape that
   * already looks like the contract. Only the raw answer lets the decoder fail
   * closed on the drift and type surprises it exists to catch.
   */
  apiRestrictions(): Promise<unknown> {
    return this.request<unknown>(
      'GET',
      'SPOT',
      '/sapi/v1/account/apiRestrictions',
    ).then((value) => {
      if (!isRecord(value)) {
        throw new BinanceApiError(502, undefined, 'Binance returned invalid API restrictions');
      }
      return value;
    });
  }

  spotAccount(): Promise<unknown> {
    return this.request('GET', 'SPOT', '/api/v3/account', { omitZeroBalances: 'true' });
  }

  spotOpenOrders(): Promise<unknown> {
    return this.request('GET', 'SPOT', '/api/v3/openOrders');
  }

  spotTrades(symbol: string): Promise<unknown> {
    return this.request('GET', 'SPOT', '/api/v3/myTrades', { symbol, limit: 100 });
  }

  marginAccount(): Promise<unknown> {
    return this.request('GET', 'SPOT', '/sapi/v1/margin/account');
  }

  marginOpenOrders(): Promise<unknown> {
    return this.request('GET', 'SPOT', '/sapi/v1/margin/openOrders');
  }

  marginTrades(symbol: string): Promise<unknown> {
    return this.request('GET', 'SPOT', '/sapi/v1/margin/myTrades', { symbol, limit: 100 });
  }

  usdmBalances(): Promise<unknown> {
    return this.request('GET', 'USDM', '/fapi/v3/balance');
  }

  usdmPositions(): Promise<unknown> {
    return this.request('GET', 'USDM', '/fapi/v3/positionRisk');
  }

  usdmOpenOrders(): Promise<unknown> {
    return this.request('GET', 'USDM', '/fapi/v1/openOrders');
  }

  usdmTrades(symbol: string): Promise<unknown> {
    return this.request('GET', 'USDM', '/fapi/v1/userTrades', { symbol, limit: 100 });
  }

  private buildQuery(
    product: PrivateReadProduct,
    params: Readonly<Record<string, string | number | undefined>>,
  ): string {
    const entries = Object.entries(params);
    if (entries.length > MAX_PARAMS) throw new Error('Private Binance request has too many parameters');
    const query = new URLSearchParams();
    for (const [key, value] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
        throw new Error('Private Binance request contains an invalid parameter name');
      }
      if (/^(?:signature|apiKey|apiSecret|secretKey)$/i.test(key)) {
        throw new Error('Private Binance request contains a reserved parameter');
      }
      if (value === undefined) continue;
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new Error('Private Binance request contains an invalid parameter value');
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error('Private Binance request contains a non-finite parameter');
      }
      const encoded = String(value);
      if (encoded.length > MAX_PARAM_VALUE_CHARS) {
        throw new Error('Private Binance request parameter is too long');
      }
      query.set(key, encoded);
    }
    const timestamp = Math.trunc(this.now() + this.serverTimeOffsetMs[product]);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw new Error('Private Binance request timestamp is invalid');
    }
    query.set('timestamp', String(timestamp));
    query.set('recvWindow', '5000');
    query.append(
      'signature',
      createHmac('sha256', this.creds.apiSecret).update(query.toString()).digest('hex'),
    );
    const serialized = query.toString();
    if (Buffer.byteLength(serialized, 'utf8') > MAX_QUERY_BYTES) {
      throw new Error('Private Binance request query is too large');
    }
    return serialized;
  }

  private async requestOnce<T>(
    product: PrivateReadProduct,
    path: string,
    params: Readonly<Record<string, string | number | undefined>>,
    signed: boolean,
  ): Promise<T> {
    if (!signed && path !== TIME_PATHS[product]) {
      throw new Error('Private Binance unsigned path is not allowed');
    }
    if (signed && !SIGNED_GET_PATHS[product].has(path)) {
      throw new Error('Private Binance signed path is not allowed');
    }
    const now = this.now();
    if (now < this.cooldownUntil) {
      throw new BinanceApiError(429, -1003, 'Binance request cooldown is active');
    }
    const query = signed ? this.buildQuery(product, params) : '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (signed) headers['X-MBX-APIKEY'] = this.creds.apiKey;
      const response = await this.fetchFn(
        `${BASE_URLS[product]}${path}${query ? `?${query}` : ''}`,
        { method: 'GET', headers, signal: controller.signal, redirect: 'error' },
      );
      this.captureRateLimit(response.headers);
      this.captureCooldown(response.status, response.headers);
      const body = await this.readBoundedJson(response);
      if (!response.ok) {
        const record = isRecord(body) ? body : null;
        const code = typeof record?.code === 'number' && Number.isSafeInteger(record.code)
          ? record.code
          : undefined;
        throw new BinanceApiError(response.status, code, `Binance HTTP ${response.status}`);
      }
      return body as T;
    } catch (error) {
      if (error instanceof BinanceApiError) throw error;
      if (isAbortError(error) || controller.signal.aborted) {
        throw new Error(`Private Binance request timed out: ${path}`);
      }
      throw new Error(`Private Binance request failed: ${path}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readBoundedJson(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
    if (!JSON_CONTENT_TYPE_RE.test(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new BinanceApiError(502, undefined, 'Binance returned a non-JSON response');
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new BinanceApiError(502, undefined, 'Binance response exceeded the configured size limit');
    }
    if (!response.body) {
      throw new BinanceApiError(502, undefined, 'Binance returned malformed JSON');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const chunks: string[] = [];
    let bytes = 0;
    let count = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        count += 1;
        if (bytes > this.maxResponseBytes || count > MAX_RESPONSE_CHUNKS) {
          await reader.cancel().catch(() => undefined);
          throw new BinanceApiError(502, undefined, 'Binance response exceeded the configured size limit');
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
    } catch (error) {
      if (error instanceof BinanceApiError || isAbortError(error)) throw error;
      throw new BinanceApiError(502, undefined, 'Binance returned malformed JSON');
    } finally {
      reader.releaseLock();
    }
    try {
      return JSON.parse(chunks.join('')) as unknown;
    } catch {
      throw new BinanceApiError(502, undefined, 'Binance returned malformed JSON');
    }
  }

  private captureRateLimit(headers: Headers): void {
    const raw = headers.get('x-mbx-used-weight-1m')
      ?? headers.get('x-sapi-used-ip-weight-1m');
    const weight = Number(raw);
    if (raw !== null && Number.isFinite(weight)) {
      rateLimit.usedWeight1m = weight;
      rateLimit.ts = this.now();
    }
  }

  private captureCooldown(status: number, headers: Headers): void {
    if (status !== 418 && status !== 429) return;
    const now = this.now();
    const raw = headers.get('retry-after');
    const seconds = raw === null ? Number.NaN : Number(raw);
    const delayMs = Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1_000
      : status === 418 ? 60_000 : 1_000;
    const bounded = Math.min(7 * 24 * 60 * 60_000, Math.max(1_000, Math.ceil(delayMs)));
    this.cooldownUntil = Math.max(this.cooldownUntil, now + bounded);
    rateLimit.cooldownUntil = Math.max(rateLimit.cooldownUntil, this.cooldownUntil);
  }

  private async synchronizeServerTime(product: PrivateReadProduct): Promise<void> {
    const existing = this.timeSyncInFlight[product];
    if (existing) return existing;
    const sync = (async () => {
      const startedAt = this.now();
      const response = await this.requestOnce<unknown>(product, TIME_PATHS[product], {}, false);
      const completedAt = this.now();
      const serverTime = isRecord(response) ? response.serverTime : undefined;
      if (typeof serverTime !== 'number'
        || !Number.isSafeInteger(serverTime)
        || serverTime < 1_500_000_000_000
        || serverTime > 4_102_444_800_000) {
        throw new BinanceApiError(502, undefined, 'Binance returned an invalid server-time response');
      }
      this.serverTimeOffsetMs[product] = serverTime - Math.trunc((startedAt + completedAt) / 2);
      this.timeSyncGeneration[product] += 1;
    })();
    this.timeSyncInFlight[product] = sync;
    try {
      await sync;
    } finally {
      if (this.timeSyncInFlight[product] === sync) delete this.timeSyncInFlight[product];
    }
  }
}
