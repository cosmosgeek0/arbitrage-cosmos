export const T0 = 1_800_000_000_000;
export const MINUTE_MS = 60_000;

export class ManualClock {
  constructor(now = T0) { this.now = now; }
  nowMs() { return this.now; }
  set(now) { this.now = now; }
  advance(delta = 1) { this.now += delta; }
}

export class QueueRestTransport {
  constructor() {
    this.calls = [];
    this.responses = new Map();
  }

  enqueue(path, response) {
    const queue = this.responses.get(path) ?? [];
    queue.push(response);
    this.responses.set(path, queue);
  }

  async request(request) {
    this.calls.push(structuredClone(request));
    const queue = this.responses.get(request.path) ?? [];
    if (queue.length === 0) throw new Error(`no fixture response for ${request.path}`);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(request, this.calls.length) : structuredClone(next);
  }
}

export class FakeWebSocketConnection {
  constructor(request) {
    this.request = request;
    this.sent = [];
    this.closes = [];
  }

  emit(event) { this.request.onEvent(structuredClone(event)); }
  send(data) { this.sent.push(data); }
  close(code, reason) { this.closes.push({ code: code ?? null, reason: reason ?? '' }); }
}

export class FakeWebSocketTransport {
  constructor() {
    this.requests = [];
    this.connections = [];
  }

  connect(request) {
    this.requests.push(request);
    const connection = new FakeWebSocketConnection(request);
    this.connections.push(connection);
    return connection;
  }
}

export function spotFilters() {
  return [
    { filterType: 'PRICE_FILTER', minPrice: '0.0001', maxPrice: '1000000', tickSize: '0.0001' },
    { filterType: 'LOT_SIZE', minQty: '0.001', maxQty: '1000000', stepSize: '0.001' },
    { filterType: 'NOTIONAL', minNotional: '5', applyMinToMarket: true, maxNotional: '10000000', applyMaxToMarket: false, avgPriceMins: 5 },
  ];
}

export function futuresFilters() {
  return [
    { filterType: 'PRICE_FILTER', minPrice: '0.001', maxPrice: '1000000', tickSize: '0.001' },
    { filterType: 'LOT_SIZE', minQty: '0.001', maxQty: '1000000', stepSize: '0.001' },
    { filterType: 'MIN_NOTIONAL', notional: '5' },
  ];
}

export function spotExchangeRow(symbol, baseAsset, overrides = {}) {
  return {
    symbol,
    status: 'TRADING',
    baseAsset,
    baseAssetPrecision: 8,
    quoteAsset: 'USDT',
    quotePrecision: 8,
    quoteAssetPrecision: 8,
    baseCommissionPrecision: 8,
    quoteCommissionPrecision: 8,
    orderTypes: ['LIMIT', 'MARKET'],
    isSpotTradingAllowed: true,
    isMarginTradingAllowed: false,
    permissionSets: [['SPOT']],
    filters: spotFilters(),
    ...overrides,
  };
}

export function futuresExchangeRow(symbol, baseAsset, overrides = {}) {
  return {
    symbol,
    pair: symbol,
    contractType: 'PERPETUAL',
    deliveryDate: 4_133_404_800_000,
    onboardDate: T0 - 365 * 24 * 60 * MINUTE_MS,
    status: 'TRADING',
    baseAsset,
    quoteAsset: 'USDT',
    marginAsset: 'USDT',
    pricePrecision: 6,
    quantityPrecision: 3,
    baseAssetPrecision: 8,
    quotePrecision: 8,
    underlyingType: 'COIN',
    underlyingSubType: ['Layer-1'],
    orderTypes: ['LIMIT', 'MARKET'],
    timeInForce: ['GTC', 'IOC'],
    filters: futuresFilters(),
    ...overrides,
  };
}

export function exchangeInfo(symbols, serverTime = T0 - 10) {
  return { timezone: 'UTC', serverTime, rateLimits: [], exchangeFilters: [], symbols };
}

export function restResponse(body, receiveTimeMs = T0, status = 200, headers = {}) {
  return { status, headers, body, receiveTimeMs };
}

export function spotMiniTicker(symbol, eventTimeMs = T0, overrides = {}) {
  return {
    e: '24hrMiniTicker', E: eventTimeMs, s: symbol,
    c: '100', o: '98', h: '110', l: '90', v: '1000', q: '100000',
    ...overrides,
  };
}

export function spotBookTicker(symbol, updateId = 1, overrides = {}) {
  return { u: String(updateId), s: symbol, b: '99.9', B: '2', a: '100.1', A: '3', ...overrides };
}

export function aggregateTrade(symbol, id, eventTimeMs = T0, overrides = {}) {
  return {
    e: 'aggTrade', E: eventTimeMs, s: symbol, a: String(id), p: '100', q: '1',
    f: String(id), l: String(id), T: eventTimeMs, m: false,
    ...overrides,
  };
}

export function futuresAggregateTrade(symbol, id, eventTimeMs = T0, overrides = {}) {
  return {
    ...aggregateTrade(symbol, id, eventTimeMs),
    ps: symbol,
    st: 1,
    nq: overrides.nq ?? overrides.q ?? '1',
    ...overrides,
  };
}

export function futuresBookTicker(symbol = 'BTCUSDT', eventTimeMs = T0, overrides = {}) {
  return {
    e: 'bookTicker', E: eventTimeMs, T: eventTimeMs, s: symbol, ps: symbol, st: 1,
    u: '1', b: '99.9', B: '2', a: '100.1', A: '3',
    ...overrides,
  };
}

export function futuresMarkPrice(symbol = 'BTCUSDT', eventTimeMs = T0, overrides = {}) {
  return {
    e: 'markPriceUpdate', E: eventTimeMs, s: symbol, ps: symbol, st: 1,
    p: '100', i: '99.9', P: '99.95', ap: '99.98', r: '0.0001',
    T: eventTimeMs + 8 * 60 * MINUTE_MS,
    ...overrides,
  };
}

export function futuresContractInfo(symbol = 'BTCUSDT', eventTimeMs = T0, overrides = {}) {
  return {
    e: 'contractInfo', E: eventTimeMs, s: symbol, ps: symbol, st: 1,
    ct: 'PERPETUAL', dt: 4_133_404_800_000, ot: T0 - 365 * 24 * 60 * MINUTE_MS,
    cs: 'TRADING',
    ...overrides,
  };
}

export function futuresLiquidation(symbol = 'BTCUSDT', eventTimeMs = T0, overrides = {}) {
  const orderOverrides = overrides.o ?? {};
  const { o: _ignored, ...outerOverrides } = overrides;
  return {
    e: 'forceOrder', E: eventTimeMs, ps: symbol, st: 1,
    o: {
      s: symbol, S: 'SELL', o: 'LIMIT', f: 'IOC', q: '2', p: '99', ap: '98.9',
      X: 'FILLED', l: '1', z: '2', T: eventTimeMs,
      ...orderOverrides,
    },
    ...outerOverrides,
  };
}

export function spotDepthSnapshot(sequence = 100, receiveTimeMs = T0, overrides = {}) {
  return {
    lastUpdateId: String(sequence),
    bids: [['99.9', '10'], ['99.8', '5']],
    asks: [['100.1', '10'], ['100.2', '5']],
    requestedLimit: 10,
    ...overrides,
  };
}

export function spotDepthDelta(first = 100, last = 101, eventTimeMs = T0, overrides = {}) {
  return {
    e: 'depthUpdate', E: eventTimeMs, s: 'BTCUSDT', U: String(first), u: String(last),
    b: [], a: [],
    ...overrides,
  };
}

export function kline(openTimeMs, overrides = {}) {
  return [
    openTimeMs,
    overrides.open ?? '10',
    overrides.high ?? '12',
    overrides.low ?? '9',
    overrides.close ?? '11',
    overrides.baseVolume ?? '5',
    overrides.closeTimeMs ?? openTimeMs + MINUTE_MS - 1,
    overrides.quoteVolume ?? '55',
    overrides.tradeCount ?? 7,
    overrides.takerBuyBaseVolume ?? '3',
    overrides.takerBuyQuoteVolume ?? '33',
    '0',
  ];
}

export function derivativesBody(request, atMs = T0) {
  const symbol = request.query.symbol ?? 'BTCUSDT';
  if (request.path === '/fapi/v1/openInterest') return { symbol, openInterest: '100', time: atMs };
  if (request.path === '/futures/data/openInterestHist') {
    return [{ symbol, sumOpenInterest: '90', sumOpenInterestValue: '9000', timestamp: String(atMs) }];
  }
  if (request.path === '/fapi/v1/fundingRate') {
    return [{ symbol, fundingRate: '0.0001', fundingTime: atMs, markPrice: '100' }];
  }
  if (request.path === '/fapi/v1/fundingInfo') {
    return [{ symbol, adjustedFundingRateCap: '0.025', adjustedFundingRateFloor: '-0.025', fundingIntervalHours: 8, disclaimer: false }];
  }
  if (request.path === '/futures/data/takerlongshortRatio') {
    return [{ buySellRatio: '1.25', buyVol: '125', sellVol: '100', timestamp: String(atMs) }];
  }
  if (request.path === '/futures/data/globalLongShortAccountRatio') {
    return [{ symbol, longShortRatio: '1.5', longAccount: '0.6', shortAccount: '0.4', timestamp: String(atMs) }];
  }
  throw new Error(`unexpected derivatives fixture path ${request.path}`);
}
