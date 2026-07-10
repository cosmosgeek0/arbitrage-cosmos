import { createHmac } from 'node:crypto';

const SPOT_API = 'https://api.binance.com';

export interface BinanceCreds {
  apiKey: string;
  apiSecret: string;
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
function normalizeRestrictions(r: Record<string, unknown>): ApiRestrictions {
  return {
    ipRestrict: coerceBool(r.ipRestrict),
    enableReading: coerceBool(r.enableReading),
    enableWithdrawals: coerceBool(r.enableWithdrawals),
    enableInternalTransfer: coerceBool(r.enableInternalTransfer),
    enableMargin: coerceBool(r.enableMargin),
    enableSpotAndMarginTrading: coerceBool(r.enableSpotAndMarginTrading),
    enableFutures: coerceBool(r.enableFutures),
    permitsUniversalTransfer: coerceBool(r.permitsUniversalTransfer),
    enableVanillaOptions: coerceBool(r.enableVanillaOptions),
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
export const rateLimit = { usedWeight1m: 0, ts: 0 };

export interface OrderResponse {
  symbol: string;
  orderId: number;
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
  constructor(private readonly creds: BinanceCreds) {}

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    params: Record<string, string | number | undefined>,
    sign: boolean
  ): Promise<T> {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) sp.set(k, String(v));
    }
    if (sign) {
      sp.set('timestamp', String(Date.now()));
      sp.set('recvWindow', '5000');
      const sig = createHmac('sha256', this.creds.apiSecret).update(sp.toString()).digest('hex');
      sp.append('signature', sig);
    }
    const qs = sp.toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(`${SPOT_API}${path}${qs ? `?${qs}` : ''}`, {
        method,
        headers: { 'X-MBX-APIKEY': this.creds.apiKey },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Binance request timed out: ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const usedWeight = res.headers.get('x-mbx-used-weight-1m')
      ?? res.headers.get('x-sapi-used-ip-weight-1m');
    const parsedWeight = Number(usedWeight);
    if (usedWeight !== null && Number.isFinite(parsedWeight)) {
      rateLimit.usedWeight1m = parsedWeight;
      rateLimit.ts = Date.now();
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const b = body as { code?: number; msg?: string } | null;
      throw new BinanceApiError(res.status, b?.code, b?.msg ?? res.statusText);
    }
    return body as T;
  }

  account(): Promise<AccountInfo> {
    return this.request('GET', '/api/v3/account', { omitZeroBalances: 'true' }, true);
  }

  // Authoritative per-key permissions (the real "can this key withdraw/trade").
  async apiRestrictions(): Promise<ApiRestrictions> {
    const raw = await this.request<Record<string, unknown>>('GET', '/sapi/v1/account/apiRestrictions', {}, true);
    return normalizeRestrictions(raw);
  }

  openOrders(): Promise<OpenOrder[]> {
    return this.request('GET', '/api/v3/openOrders', {}, true);
  }

  myTrades(symbol: string, limit = 100): Promise<MyTrade[]> {
    return this.request('GET', '/api/v3/myTrades', { symbol, limit }, true);
  }

  testOrder(params: Record<string, string | number | undefined>): Promise<Record<string, never>> {
    return this.request('POST', '/api/v3/order/test', params, true);
  }

  placeOrder(params: Record<string, string | number | undefined>): Promise<OrderResponse> {
    return this.request('POST', '/api/v3/order', params, true);
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
      (d) => ({ rows: ((d as { rows?: { asset: string; totalAmount: string; latestAnnualPercentageRate: string; canRedeem: boolean }[] }).rows ?? []) }),
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
    return this.request('GET', '/api/v3/allOrders', { symbol, limit }, true);
  }

  // ---- Flexible crypto loans (v2). Read + borrow/repay only — deliberately
  // no collateral-withdrawal or transfer-out methods.
  loanableData(): Promise<{ rows?: Record<string, string>[] }> {
    return this.request('GET', '/sapi/v2/loan/flexible/loanable/data', {}, true);
  }

  collateralData(): Promise<{ rows?: Record<string, string>[] }> {
    return this.request('GET', '/sapi/v2/loan/flexible/collateral/data', {}, true);
  }

  ongoingLoans(): Promise<{ rows?: Record<string, string>[] }> {
    return this.request('GET', '/sapi/v2/loan/flexible/ongoing/orders', { limit: 100 }, true);
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
    return this.request('POST', '/sapi/v2/loan/flexible/repay', { loanCoin, collateralCoin, repayAmount }, true);
  }

  // User data stream (legacy listenKey flow; caller must handle failure and
  // fall back to polling — see userStream.ts).
  createListenKey(): Promise<{ listenKey: string }> {
    return this.request('POST', '/api/v3/userDataStream', {}, false);
  }

  keepAliveListenKey(listenKey: string): Promise<unknown> {
    return this.request('PUT', '/api/v3/userDataStream', { listenKey }, false);
  }
}
