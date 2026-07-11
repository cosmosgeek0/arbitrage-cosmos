import { createHmac } from 'node:crypto';

const SPOT_API = 'https://api.binance.com';
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_QUERY_BYTES = 16 * 1024;
const MAX_PARAMS = 64;
const MAX_PARAM_VALUE_CHARS = 512;
const MAX_RESPONSE_CHUNKS = 4_096;
const MAX_ERROR_CHARS = 320;
const USER_STREAM_RECV_WINDOW_MS = 5_000;
const FLEXIBLE_LOAN_PAGE_SIZE = 100;
const MAX_ONGOING_LOAN_ROWS = 2_000;
const JSON_CONTENT_TYPE_RE = /^(?:application\/json|[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+\+json)$/i;

export interface BinanceClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

export interface BinanceCreds {
  apiKey: string;
  apiSecret: string;
}

class BinanceResponseError extends Error {
  constructor(readonly kind: 'content_type' | 'body_limit' | 'malformed_json') {
    super(kind);
    this.name = 'BinanceResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.trunc(value)))
    : fallback;
}

function boundedLimit(value: number, fallback: number, max: number): number {
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

export function credsFromEnv(): BinanceCreds | null {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

/**
 * Non-sensitive fingerprint of the API KEY (never the secret) for the UI, so the
 * owner can confirm which key is loaded without exposing it. Shows first 6 + last
 * 4 only. The secret is never surfaced anywhere.
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 10) return '••••';
  return `${apiKey.slice(0, 6)}••••${apiKey.slice(-4)}`;
}

export class BinanceApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly binanceCode: number | undefined,
    message: string
  ) {
    super(message);
    this.name = 'BinanceApiError';
  }
}

export interface AccountInfo {
  balances: { asset: string; free: string; locked: string }[];
  canTrade: boolean;
  canWithdraw: boolean;
}

/**
 * Per-API-KEY permission flags from /sapi/v1/account/apiRestrictions. This is
 * the authoritative source for what THE KEY can do — unlike /api/v3/account's
 * `canWithdraw`, which is an ACCOUNT-level flag and stays true for a read-only
 * key. Binance does not return the whitelisted IPs themselves, only ipRestrict.
 */
export interface ApiRestrictions {
  ipRestrict: boolean;
  enableReading: boolean;
  enableWithdrawals: boolean;
  enableInternalTransfer: boolean;
  enableMargin: boolean;
  enableSpotAndMarginTrading: boolean;
  enableFutures: boolean;
  permitsUniversalTransfer: boolean;
  enableVanillaOptions?: boolean;
  createTime?: number;
}

// Binance has historically returned some of these flags as the STRINGS
// "true"/"false" rather than booleans — and "false" is truthy in JS, which would
// invert a safety check. Coerce every flag to a real boolean.
function coerceBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}
function restrictionBool(r: Record<string, unknown>, key: string): boolean {
  const value = r[key];
  if (![true, false, 'true', 'false', 1, 0, '1', '0'].includes(value as never)) {
    throw new BinanceApiError(502, undefined, 'Binance returned incomplete API restrictions');
  }
  return coerceBool(value);
}
function normalizeRestrictions(r: Record<string, unknown>): ApiRestrictions {
  return {
    ipRestrict: restrictionBool(r, 'ipRestrict'),
    enableReading: restrictionBool(r, 'enableReading'),
    enableWithdrawals: restrictionBool(r, 'enableWithdrawals'),
    enableInternalTransfer: restrictionBool(r, 'enableInternalTransfer'),
    enableMargin: restrictionBool(r, 'enableMargin'),
    enableSpotAndMarginTrading: restrictionBool(r, 'enableSpotAndMarginTrading'),
    enableFutures: restrictionBool(r, 'enableFutures'),
    permitsUniversalTransfer: restrictionBool(r, 'permitsUniversalTransfer'),
    enableVanillaOptions: r.enableVanillaOptions === undefined
      ? undefined
      : restrictionBool(r, 'enableVanillaOptions'),
    createTime: typeof r.createTime === 'number' ? r.createTime : undefined,
  };
}

export type KeyPostureLevel = 'no_key' | 'unknown' | 'read_only' | 'trading' | 'elevated' | 'unsafe';
export interface KeyPosture {
  level: KeyPostureLevel;
  label: string;
  tone: 'ok' | 'warn' | 'bad' | 'idle';
  ipRestricted: boolean;
}

/**
 * Single source of truth for the key-scope posture badge, derived only from the
 * authoritative per-KEY apiRestrictions flags (never account-level canTrade/
 * canWithdraw). Worst case wins.
 */
export function keyPosture(r: ApiRestrictions | null, keysPresent: boolean): KeyPosture {
  if (!keysPresent) return { level: 'no_key', label: 'No key', tone: 'idle', ipRestricted: false };
  if (!r) return { level: 'unknown', label: 'Permissions unknown', tone: 'warn', ipRestricted: false };
  const ipRestricted = r.ipRestrict;
  if (r.enableWithdrawals) return { level: 'unsafe', label: 'Withdrawals enabled — recreate key', tone: 'bad', ipRestricted };
  if (r.permitsUniversalTransfer || r.enableInternalTransfer) return { level: 'unsafe', label: 'Transfer-out permitted — recreate key', tone: 'bad', ipRestricted };
  if (r.enableSpotAndMarginTrading) return { level: 'trading', label: 'Trading-capable key', tone: 'warn', ipRestricted };
  if (r.enableMargin || r.enableFutures || r.enableVanillaOptions) return { level: 'elevated', label: 'Elevated permissions', tone: 'warn', ipRestricted };
  if (r.enableReading) return { level: 'read_only', label: 'Read-only key OK', tone: 'ok', ipRestricted };
  return { level: 'unknown', label: 'No reading permission', tone: 'warn', ipRestricted };
}

export interface OpenOrder {
  symbol: string;
  orderId: number;
  clientOrderId?: string;
  side: string;
  type: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  time: number;
}

// Rate-limit visibility: Binance returns the used request weight on every
// REST response; keep the last reading for the System Health page.
export const rateLimit = { usedWeight1m: 0, ts: 0, cooldownUntil: 0 };

export interface OrderResponse {
  symbol: string;
  orderId: number;
  clientOrderId?: string;
  transactTime?: number;
  time?: number;
  updateTime?: number;
  status: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  fills?: {
    price: string;
    qty: string;
    commission: string;
    commissionAsset: string;
    tradeId: number;
  }[];
}

export interface MyTrade {
  symbol: string;
  id: number;
  orderId: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
}

export interface WalletBalance {
  activate: boolean;
  balance: string;
  walletName: string;
}

/**
 * Signed spot REST client. Keys live ONLY here on the server, read from env.
 * There is deliberately no withdrawal or transfer method in this class.
 */
export class BinanceClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private serverTimeOffsetMs = 0;
  private timeSyncGeneration = 0;
  private timeSyncInFlight: Promise<void> | null = null;
  private cooldownUntil = 0;

  constructor(
    private readonly creds: BinanceCreds,
    options: BinanceClientOptions = {},
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

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    params: Record<string, string | number | undefined>,
    sign: boolean
  ): Promise<T> {
    const generationAtSend = this.timeSyncGeneration;
    try {
      return await this.requestOnce<T>(method, path, params, sign, true);
    } catch (error) {
      if (!sign || !(error instanceof BinanceApiError) || error.binanceCode !== -1021) throw error;
      if (generationAtSend === this.timeSyncGeneration) await this.synchronizeServerTime();
      // Rebuild timestamp and signature after synchronization. A second -1021
      // is returned to the caller; this path never retries more than once.
      return this.requestOnce<T>(method, path, params, true, true);
    }
  }

  private buildQuery(
    params: Record<string, string | number | undefined>,
    sign: boolean,
  ): string {
    const entries = Object.entries(params);
    if (entries.length > MAX_PARAMS) throw new Error('Binance request has too many parameters');
    const sp = new URLSearchParams();
    for (const [key, value] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
        throw new Error('Binance request contains an invalid parameter name');
      }
      if (/^(?:signature|apiKey|apiSecret|secretKey)$/i.test(key)) {
        throw new Error('Binance request contains a reserved parameter');
      }
      if (value === undefined) continue;
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new Error('Binance request contains an invalid parameter value');
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error('Binance request contains a non-finite number');
      }
      const encoded = String(value);
      if (encoded.length > MAX_PARAM_VALUE_CHARS) {
        throw new Error('Binance request parameter is too long');
      }
      sp.set(key, encoded);
    }
    if (sign) {
      const timestamp = Math.trunc(this.now() + this.serverTimeOffsetMs);
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
        throw new Error('Binance request timestamp is invalid');
      }
      sp.set('timestamp', String(timestamp));
      sp.set('recvWindow', '5000');
      const sig = createHmac('sha256', this.creds.apiSecret).update(sp.toString()).digest('hex');
      sp.append('signature', sig);
    }
    const qs = sp.toString();
    if (Buffer.byteLength(qs, 'utf8') > MAX_QUERY_BYTES) {
      throw new Error('Binance request query is too large');
    }
    return qs;
  }

  private async requestOnce<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    params: Record<string, string | number | undefined>,
    sign: boolean,
    includeApiKey: boolean,
  ): Promise<T> {
    if (!/^\/[A-Za-z0-9/_-]+$/.test(path)) throw new Error('Binance endpoint path is invalid');
    if (this.now() < this.cooldownUntil) {
      throw new BinanceApiError(429, -1003, 'Binance request cooldown is active');
    }
    const qs = this.buildQuery(params, sign);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (includeApiKey) headers['X-MBX-APIKEY'] = this.creds.apiKey;
      const response = await this.fetchFn(`${SPOT_API}${path}${qs ? `?${qs}` : ''}`, {
        method,
        headers,
        signal: controller.signal,
        redirect: 'error',
      });
      this.captureRateLimit(response.headers);
      this.captureRetryAfter(response.status, response.headers);
      const body = await this.readBoundedJson(response);
      if (!response.ok) {
        const record = isRecord(body) ? body : null;
        const rawCode = record?.code;
        const code = typeof rawCode === 'number' && Number.isSafeInteger(rawCode) ? rawCode : undefined;
        const message = this.sanitizeError(record?.msg, `Binance HTTP ${response.status}`);
        throw new BinanceApiError(response.status, code, message);
      }
      return body as T;
    } catch (error) {
      if (error instanceof BinanceApiError) throw error;
      if (isAbortError(error) || controller.signal.aborted) {
        throw new Error(`Binance request timed out: ${path}`);
      }
      if (error instanceof BinanceResponseError) {
        const message = error.kind === 'content_type'
          ? 'Binance returned a non-JSON response'
          : error.kind === 'body_limit'
            ? 'Binance response exceeded the configured size limit'
            : 'Binance returned malformed JSON';
        throw new BinanceApiError(502, undefined, message);
      }
      // Fetch implementations can include the full signed URL in their error
      // or cause chain. Do not propagate any upstream text from this boundary.
      throw new Error(`Binance request failed: ${path}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private captureRateLimit(headers: Headers): void {
    const usedWeight = headers.get('x-mbx-used-weight-1m')
      ?? headers.get('x-sapi-used-ip-weight-1m');
    const parsedWeight = Number(usedWeight);
    if (usedWeight !== null && Number.isFinite(parsedWeight)) {
      rateLimit.usedWeight1m = parsedWeight;
      rateLimit.ts = this.now();
    }
  }

  private captureRetryAfter(status: number, headers: Headers): void {
    if (status !== 418 && status !== 429) return;
    const now = this.now();
    const raw = headers.get('retry-after');
    let delayMs = status === 418 ? 60_000 : 1_000;
    if (raw !== null) {
      const seconds = Number(raw);
      if (Number.isFinite(seconds) && seconds >= 0) {
        delayMs = seconds * 1_000;
      } else {
        const at = Date.parse(raw);
        if (Number.isFinite(at)) delayMs = Math.max(0, at - now);
      }
    }
    const boundedDelay = Math.min(7 * 24 * 60 * 60_000, Math.max(1_000, Math.ceil(delayMs)));
    this.cooldownUntil = Math.max(this.cooldownUntil, now + boundedDelay);
    rateLimit.cooldownUntil = Math.max(rateLimit.cooldownUntil, this.cooldownUntil);
  }

  private async readBoundedJson(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
    if (!JSON_CONTENT_TYPE_RE.test(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new BinanceResponseError('content_type');
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new BinanceResponseError('body_limit');
    }
    if (!response.body) throw new BinanceResponseError('malformed_json');

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let total = 0;
    let chunkCount = 0;
    const textChunks: string[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        chunkCount += 1;
        if (total > this.maxResponseBytes || chunkCount > MAX_RESPONSE_CHUNKS) {
          await reader.cancel().catch(() => undefined);
          throw new BinanceResponseError('body_limit');
        }
        textChunks.push(decoder.decode(value, { stream: true }));
      }
      textChunks.push(decoder.decode());
    } catch (error) {
      if (error instanceof BinanceResponseError || isAbortError(error)) throw error;
      throw new BinanceResponseError('malformed_json');
    } finally {
      reader.releaseLock();
    }
    const text = textChunks.join('');
    if (!text.trim()) throw new BinanceResponseError('malformed_json');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new BinanceResponseError('malformed_json');
    }
  }

  private sanitizeError(value: unknown, fallback: string): string {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    let message = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    const secrets = [this.creds.apiKey, this.creds.apiSecret]
      .flatMap((secret) => [secret, encodeURIComponent(secret)])
      .filter(Boolean);
    for (const secret of secrets) {
      if (secret) message = message.split(secret).join('[redacted]');
    }
    message = message.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => url.replace(/[?#].*$/, ''));
    message = message.replace(
      /\b(signature|api[-_ ]?key|secret(?:[-_ ]?key)?)\b\s*[:=]\s*[^\s,;&]+/gi,
      '$1=[redacted]',
    );
    message = message.replace(/[?&][A-Za-z0-9_.~-]+=[^\s&]*/g, '[query redacted]');
    return message.slice(0, MAX_ERROR_CHARS) || fallback;
  }

  private async synchronizeServerTime(): Promise<void> {
    if (this.timeSyncInFlight) return this.timeSyncInFlight;
    const sync = (async () => {
      const startedAt = this.now();
      const response = await this.requestOnce<unknown>('GET', '/api/v3/time', {}, false, false);
      const completedAt = this.now();
      const serverTime = isRecord(response) ? response.serverTime : undefined;
      if (typeof serverTime !== 'number'
        || !Number.isSafeInteger(serverTime)
        || serverTime < 1_500_000_000_000
        || serverTime > 4_102_444_800_000) {
        throw new BinanceApiError(502, undefined, 'Binance returned an invalid server-time response');
      }
      const midpoint = Math.trunc((startedAt + completedAt) / 2);
      this.serverTimeOffsetMs = serverTime - midpoint;
      this.timeSyncGeneration += 1;
    })();
    this.timeSyncInFlight = sync;
    try {
      await sync;
    } finally {
      if (this.timeSyncInFlight === sync) this.timeSyncInFlight = null;
    }
  }

  /**
   * Build the only credential-bearing frame used by the private WebSocket API.
   * The API secret never leaves this class. Binance requires the signature
   * payload to be sorted by parameter name rather than serialized in caller
   * insertion order.
   */
  userDataStreamSubscribeFrame(requestId: string): string {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(requestId)) {
      throw new Error('Binance WebSocket request id is invalid');
    }
    if (!/^[A-Za-z0-9_-]{8,512}$/.test(this.creds.apiKey)
      || typeof this.creds.apiSecret !== 'string'
      || this.creds.apiSecret.length === 0
      || Buffer.byteLength(this.creds.apiSecret, 'utf8') > 4_096) {
      throw new Error('Binance credentials are invalid');
    }

    const timestamp = Math.trunc(this.now() + this.serverTimeOffsetMs);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw new Error('Binance WebSocket request timestamp is invalid');
    }
    const unsignedParams = {
      apiKey: this.creds.apiKey,
      recvWindow: USER_STREAM_RECV_WINDOW_MS,
      timestamp,
    };
    const signingPayload = Object.entries(unsignedParams)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('&');
    const signature = createHmac('sha256', this.creds.apiSecret)
      .update(signingPayload)
      .digest('hex');

    return JSON.stringify({
      id: requestId,
      method: 'userDataStream.subscribe.signature',
      params: { ...unsignedParams, signature },
    });
  }

  account(): Promise<AccountInfo> {
    return this.request('GET', '/api/v3/account', { omitZeroBalances: 'true' }, true);
  }

  // Authoritative per-key permissions (the real "can this key withdraw/trade").
  async apiRestrictions(): Promise<ApiRestrictions> {
    const raw = await this.request<unknown>('GET', '/sapi/v1/account/apiRestrictions', {}, true);
    if (!isRecord(raw)) throw new BinanceApiError(502, undefined, 'Binance returned invalid API restrictions');
    return normalizeRestrictions(raw);
  }

  openOrders(): Promise<OpenOrder[]> {
    return this.request('GET', '/api/v3/openOrders', {}, true);
  }

  myTrades(
    symbol: string,
    limit = 100,
    options: { fromId?: number; startTime?: number; endTime?: number } = {},
  ): Promise<MyTrade[]> {
    return this.request('GET', '/api/v3/myTrades', {
      symbol,
      limit: boundedLimit(limit, 100, 1000),
      fromId: options.fromId,
      startTime: options.startTime,
      endTime: options.endTime,
    }, true);
  }

  testOrder(params: Record<string, string | number | undefined>): Promise<Record<string, never>> {
    return this.request('POST', '/api/v3/order/test', params, true);
  }

  placeOrder(params: Record<string, string | number | undefined>): Promise<OrderResponse> {
    return this.request('POST', '/api/v3/order', params, true);
  }

  queryOrder(symbol: string, origClientOrderId: string): Promise<OrderResponse> {
    return this.request('GET', '/api/v3/order', { symbol, origClientOrderId }, true);
  }

  cancelOrder(symbol: string, orderId: number): Promise<unknown> {
    return this.request('DELETE', '/api/v3/order', { symbol, orderId }, true);
  }

  cancelAllOrders(symbol: string): Promise<unknown> {
    return this.request('DELETE', '/api/v3/openOrders', { symbol }, true);
  }

  // ---- Cross margin (read-only visibility; borrow eligibility for the
  // reverse-basis leg). No transfer methods exist.
  /** Deposit history (successful only filtering is the caller's job).
   * Each call covers up to a 90-day window; page backward for older data. */
  depositHistory(startTime: number, endTime: number): Promise<{ coin: string; amount: string; status: number; insertTime: number }[]> {
    return this.request('GET', '/sapi/v1/capital/deposit/hisrec', { startTime, endTime, limit: 1000 }, true) as Promise<
      { coin: string; amount: string; status: number; insertTime: number }[]
    >;
  }

  /** Withdrawal history — same 90-day windowing. applyTime is a UTC string. */
  withdrawHistory(startTime: number, endTime: number): Promise<{ coin: string; amount: string; transactionFee: string; status: number; applyTime: string }[]> {
    return this.request('GET', '/sapi/v1/capital/withdraw/history', { startTime, endTime, limit: 1000 }, true) as Promise<
      { coin: string; amount: string; transactionFee: string; status: number; applyTime: string }[]
    >;
  }

  /** Daily SPOT account snapshots — Binance keeps ~30 days. Readable with the
   * Reading permission; totalAssetOfBtc is the whole account valued in BTC. */
  accountSnapshots(): Promise<{ snapshotVos: { updateTime: number; data: { totalAssetOfBtc: string } }[] }> {
    return this.request('GET', '/sapi/v1/accountSnapshot', { type: 'SPOT', limit: 30 }, true) as Promise<{
      snapshotVos: { updateTime: number; data: { totalAssetOfBtc: string } }[];
    }>;
  }

  /** Simple Earn flexible positions — readable with the Reading permission.
   * totalAmount is denominated in the underlying asset. */
  earnFlexiblePositions(): Promise<{
    rows: { asset: string; totalAmount: string; latestAnnualPercentageRate: string; canRedeem: boolean }[];
  }> {
    return this.request('GET', '/sapi/v1/simple-earn/flexible/position', { size: 100 }, true).then(
      (data) => {
        const rows = isRecord(data) && Array.isArray(data.rows) ? data.rows.slice(0, 100) : [];
        return { rows: rows as { asset: string; totalAmount: string; latestAnnualPercentageRate: string; canRedeem: boolean }[] };
      },
    );
  }

  /** Binance's account-wide wallet valuation in the requested quote asset.
   * This is the authoritative aggregate for Spot, Earn, Margin, Futures,
   * Funding, Options, and other activated wallets. It is deliberately
   * read-only and cached by the server because the upstream call costs 60 IP
   * weight. */
  walletBalances(quoteAsset = 'USDT'): Promise<WalletBalance[]> {
    return this.request('GET', '/sapi/v1/asset/wallet/balance', { quoteAsset }, true);
  }

  marginAccount(): Promise<{
    borrowEnabled: boolean;
    marginLevel: string;
    totalAssetOfBtc: string;
    totalLiabilityOfBtc: string;
    totalNetAssetOfBtc: string;
    userAssets: { asset: string; free: string; locked: string; borrowed: string; interest: string; netAsset: string }[];
  }> {
    return this.request('GET', '/sapi/v1/margin/account', {}, true);
  }

  maxBorrowable(asset: string): Promise<{ amount: string; borrowLimit: string }> {
    return this.request('GET', '/sapi/v1/margin/maxBorrowable', { asset }, true);
  }

  marginInterestHistory(): Promise<{ rows?: { asset: string; interest: string; interestRate: string; interestAccuredTime: number }[] }> {
    return this.request('GET', '/sapi/v1/margin/interestHistory', { size: 50 }, true);
  }

  borrowRepayRecords(type: 'BORROW' | 'REPAY'): Promise<{ rows?: { asset: string; amount: string; timestamp: number; status: string }[] }> {
    return this.request('GET', '/sapi/v1/margin/borrow-repay', { type, size: 50 }, true);
  }

  allOrders(symbol: string, limit = 100): Promise<OpenOrder[]> {
    return this.request('GET', '/api/v3/allOrders', { symbol, limit: boundedLimit(limit, 100, 1000) }, true);
  }

  // ---- Flexible crypto loans (v2). Read + borrow/repay only — deliberately
  // no collateral-withdrawal or transfer-out methods.
  loanableData(): Promise<{ rows?: Record<string, string>[] }> {
    return this.request('GET', '/sapi/v2/loan/flexible/loanable/data', {}, true);
  }

  collateralData(): Promise<{ rows?: Record<string, string>[] }> {
    return this.request('GET', '/sapi/v2/loan/flexible/collateral/data', {}, true);
  }

  async ongoingLoans(): Promise<{ rows: Record<string, string>[]; total: number }> {
    const rows: Record<string, string>[] = [];
    const maxPages = MAX_ONGOING_LOAN_ROWS / FLEXIBLE_LOAN_PAGE_SIZE;
    let expectedTotal: number | null = null;
    let previousPage: string | null = null;

    for (let current = 1; current <= maxPages; current += 1) {
      const response = await this.request<unknown>(
        'GET',
        '/sapi/v2/loan/flexible/ongoing/orders',
        { current, limit: FLEXIBLE_LOAN_PAGE_SIZE },
        true,
      );
      if (!isRecord(response) || !Array.isArray(response.rows) || response.rows.some((row) => !isRecord(row))) {
        throw new BinanceApiError(502, undefined, 'Binance returned malformed ongoing loan state');
      }
      if (response.rows.length > FLEXIBLE_LOAN_PAGE_SIZE) {
        throw new BinanceApiError(502, undefined, 'Binance exceeded the ongoing loan page limit');
      }

      if (response.total !== undefined) {
        const total = Number(response.total);
        if (!Number.isSafeInteger(total) || total < 0) {
          throw new BinanceApiError(502, undefined, 'Binance returned an invalid ongoing loan total');
        }
        if (total > MAX_ONGOING_LOAN_ROWS) {
          throw new BinanceApiError(502, undefined, `Ongoing loan state exceeds the ${MAX_ONGOING_LOAN_ROWS}-row safety cap`);
        }
        if (expectedTotal !== null && total !== expectedTotal) {
          throw new BinanceApiError(502, undefined, 'Binance changed the ongoing loan total during pagination');
        }
        expectedTotal = total;
      }

      const pageRows = response.rows as Record<string, string>[];
      const pageFingerprint = JSON.stringify(pageRows);
      if (pageRows.length > 0 && previousPage === pageFingerprint) {
        throw new BinanceApiError(502, undefined, 'Binance repeated an ongoing loan page');
      }
      previousPage = pageFingerprint;

      if (rows.length + pageRows.length > MAX_ONGOING_LOAN_ROWS) {
        throw new BinanceApiError(502, undefined, `Ongoing loan state exceeds the ${MAX_ONGOING_LOAN_ROWS}-row safety cap`);
      }
      rows.push(...pageRows);

      if (expectedTotal !== null && rows.length >= expectedTotal) {
        if (rows.length !== expectedTotal) {
          throw new BinanceApiError(502, undefined, 'Binance returned an inconsistent ongoing loan total');
        }
        return { rows, total: expectedTotal };
      }
      if (pageRows.length < FLEXIBLE_LOAN_PAGE_SIZE) {
        if (expectedTotal !== null && rows.length !== expectedTotal) {
          throw new BinanceApiError(502, undefined, 'Binance truncated ongoing loan pagination');
        }
        return { rows, total: rows.length };
      }
    }

    // A full final page without an authoritative total leaves open the
    // possibility of hidden debt beyond our bounded read. Never publish it as
    // complete state.
    throw new BinanceApiError(502, undefined, `Ongoing loan state reached the ${MAX_ONGOING_LOAN_ROWS}-row safety cap`);
  }

  flexibleBorrowHistory(): Promise<{ rows?: Record<string, string | number>[] }> {
    return this.request('GET', '/sapi/v2/loan/flexible/borrow/history', { limit: 100 }, true);
  }

  flexibleRepayHistory(): Promise<{ rows?: Record<string, string | number>[] }> {
    return this.request('GET', '/sapi/v2/loan/flexible/repay/history', { limit: 100 }, true);
  }

  flexibleLtvAdjustmentHistory(): Promise<{ rows?: Record<string, string | number>[] }> {
    return this.request('GET', '/sapi/v2/loan/flexible/ltv/adjustment/history', { limit: 100 }, true);
  }

  /** Add or remove collateral on a flexible loan (moves LTV). */
  flexibleAdjustLtv(loanCoin: string, collateralCoin: string, adjustmentAmount: number, direction: 'ADDITIONAL' | 'REDUCED'): Promise<unknown> {
    return this.request('POST', '/sapi/v2/loan/flexible/adjust/ltv', { loanCoin, collateralCoin, adjustmentAmount, direction }, true);
  }

  flexibleBorrow(loanCoin: string, collateralCoin: string, loanAmount: number): Promise<unknown> {
    return this.request('POST', '/sapi/v2/loan/flexible/borrow', { loanCoin, collateralCoin, loanAmount }, true);
  }

  flexibleRepay(loanCoin: string, collateralCoin: string, repayAmount: number): Promise<unknown> {
    // Keep collateral in the loan by default so a partial repay actually
    // reduces LTV instead of silently returning collateral to Spot.
    return this.request('POST', '/sapi/v2/loan/flexible/repay', {
      loanCoin,
      collateralCoin,
      repayAmount,
      collateralReturn: 'false',
    }, true);
  }

}
