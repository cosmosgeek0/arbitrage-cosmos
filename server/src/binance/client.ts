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

export interface OpenOrder {
  symbol: string;
  orderId: number;
  side: string;
  type: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  time: number;
}

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
      sp.set('recvWindow', '10000');
      const sig = createHmac('sha256', this.creds.apiSecret).update(sp.toString()).digest('hex');
      sp.append('signature', sig);
    }
    const qs = sp.toString();
    const res = await fetch(`${SPOT_API}${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers: { 'X-MBX-APIKEY': this.creds.apiKey },
    });
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
