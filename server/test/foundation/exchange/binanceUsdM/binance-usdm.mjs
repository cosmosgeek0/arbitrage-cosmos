#!/usr/bin/env node
/**
 * Lane F — dormant Binance USD-M read/test-order boundary proof.
 * Every request uses the fake transport below. No real network adapter exists.
 */
import {
  BINANCE_USDM_ENDPOINTS,
  BinanceUsdMClient,
  compareDecimalStrings,
  createHmacSha256Signer,
  encodeForm,
  isDecimalMultiple,
  multiplyDecimalStrings,
  normalizeDecimalString,
  isDecimalOffsetMultiple,
  serializeSafeError,
  serializeSafeRequest,
  validateTestOrder,
} from '../../../../dist/foundation/exchange/binanceUsdM/index.js';

let globalNetworkCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = () => {
  globalNetworkCalls += 1;
  throw new Error('network is forbidden in Lane F tests');
};

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) { console.log(`\n${title}`); }
async function rejects(name, fn, pattern) {
  try {
    await fn();
    check(name, false, 'did not reject');
  } catch (error) {
    check(name, pattern.test(String(error?.message ?? error)), String(error?.message ?? error));
  }
}

const T0 = 1_800_000_000_000;
const API_KEY = 'fixture-public-key';
const SIGNER = createHmacSha256Signer('fixture-hmac-key');

function createHarness(overrides = {}) {
  const state = { nowMs: overrides.nowMs ?? T0, requests: [], queue: [], networkCalls: 0 };
  const clock = { nowMs: () => state.nowMs };
  const transport = {
    async request(request) {
      state.requests.push(request);
      const action = state.queue.shift();
      if (!action) throw new Error('fake transport queue exhausted');
      const beforeMs = state.nowMs;
      state.nowMs += action.advanceMs ?? 1;
      if (action.throw) throw new Error('synthetic transport failure');
      return typeof action.response === 'function'
        ? action.response(request, beforeMs, state.nowMs)
        : action.response;
    },
  };
  const client = new BinanceUsdMClient({
    apiKey: API_KEY,
    clock,
    transport,
    signer: SIGNER,
    publicDataAuthority: overrides.publicDataAuthority ?? 'SYNTHETIC_TEST',
    exchangeInfoMaxAgeMs: overrides.exchangeInfoMaxAgeMs ?? 60_000,
    recvWindowMs: overrides.recvWindowMs ?? 5_000,
    timeoutMs: overrides.timeoutMs ?? 9_000,
    maxReadAttempts: overrides.maxReadAttempts ?? 2,
    defaultRateLimitCooldownMs: overrides.defaultRateLimitCooldownMs ?? 1_000,
  });
  return {
    state,
    clock,
    transport,
    client,
    enqueue(action) { state.queue.push(action); },
    advance(ms) { state.nowMs += ms; },
  };
}

function response(body, status = 200, headers = {}) {
  return { outcome: 'SUCCESS', status, headers, body };
}

async function syncTime(h, correlationId = 'sync') {
  h.enqueue({
    advanceMs: 20,
    response: (_request, beforeMs) => response(
      { serverTime: beforeMs + 110 },
      200,
      { 'X-MBX-USED-WEIGHT-1M': '1' },
    ),
  });
  return h.client.getServerTime({ correlationId });
}

const FILTERS = Object.freeze({
  price: Object.freeze({ minPrice: '0.10', maxPrice: '1000000', tickSize: '0.10' }),
  lotSize: Object.freeze({ minQty: '0.001', maxQty: '100', stepSize: '0.001' }),
  marketLotSize: Object.freeze({ minQty: '0.001', maxQty: '50', stepSize: '0.001' }),
  minNotional: '5.00',
  percentPrice: Object.freeze({ multiplierUp: '1.15', multiplierDown: '0.85' }),
});

const FILTER_OBSERVED_AT = Object.freeze({
  sourceTimeMs: null,
  receivedAtMs: T0,
  maxAgeMs: 60_000,
  authority: 'SYNTHETIC_TEST',
  completeness: 'COMPLETE',
  sourceId: 'binance.usdm.exchangeInfo.fixture',
});

const SYMBOL_RULES = Object.freeze({
  symbol: 'BTCUSDT',
  status: 'TRADING',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  marginAsset: 'USDT',
  orderTypes: Object.freeze(['LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET']),
  timeInForce: Object.freeze(['GTC', 'IOC', 'FOK', 'GTX', 'GTD', 'RPI']),
  filters: FILTERS,
  observedAt: FILTER_OBSERVED_AT,
});

const LIMIT_ORDER = Object.freeze({
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'LIMIT',
  positionMode: 'ONE_WAY',
  positionSide: 'BOTH',
  quantity: '0.0100',
  price: '50000.10',
  timeInForce: 'GTC',
  reduceOnly: false,
  newClientOrderId: 'cx-fixture-1',
  notionalReferencePrice: '50000.00',
  exchangeSymbol: SYMBOL_RULES,
});

const EXCHANGE_INFO = {
  timezone: 'UTC',
  rateLimits: [
    { interval: 'MINUTE', intervalNum: 1, limit: 2400, rateLimitType: 'REQUEST_WEIGHT' },
  ],
  symbols: [
    {
      symbol: 'BTCUSDT',
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      marginAsset: 'USDT',
      orderTypes: ['LIMIT', 'MARKET'],
      timeInForce: ['GTC', 'IOC'],
      filters: [
        { filterType: 'PRICE_FILTER', minPrice: '0.10', maxPrice: '1000000.00', tickSize: '0.10' },
        { filterType: 'LOT_SIZE', minQty: '0.0010', maxQty: '100.000', stepSize: '0.0010' },
        { filterType: 'MARKET_LOT_SIZE', minQty: '0.001', maxQty: '50.0', stepSize: '0.001' },
        { filterType: 'MIN_NOTIONAL', notional: '5.00' },
        { filterType: 'PERCENT_PRICE', multiplierUp: '1.1500', multiplierDown: '0.8500', multiplierDecimal: '4' },
        { filterType: 'MAX_NUM_ORDERS', limit: 200 },
      ],
    },
  ],
};

const MARK = {
  symbol: 'BTCUSDT',
  markPrice: '50000.1000',
  indexPrice: '49999.9000',
  estimatedSettlePrice: '50001.0000',
  lastFundingRate: '0.00010000',
  interestRate: '0.00010000',
  nextFundingTime: T0 + 28_800_000,
  time: T0,
};

const ACCOUNT = {
  totalInitialMargin: '1.0000',
  totalMaintMargin: '0.5000',
  totalWalletBalance: '100.0000',
  totalUnrealizedProfit: '2.0000',
  totalMarginBalance: '102.0000',
  totalPositionInitialMargin: '1.0000',
  totalOpenOrderInitialMargin: '0.0000',
  totalCrossWalletBalance: '100.0000',
  totalCrossUnPnl: '2.0000',
  availableBalance: '99.0000',
  maxWithdrawAmount: '98.0000',
  assets: [{
    asset: 'USDT', walletBalance: '100.0000', unrealizedProfit: '2.0000', marginBalance: '102.0000',
    availableBalance: '99.0000', maxWithdrawAmount: '98.0000', updateTime: T0,
  }],
  positions: [{
    symbol: 'BTCUSDT', positionSide: 'BOTH', positionAmt: '0.0100', unrealizedProfit: '2.0000',
    isolatedMargin: '0.0000', notional: '500.0010', isolatedWallet: '0.0000', initialMargin: '1.0000',
    maintMargin: '0.5000', updateTime: T0,
  }],
};

const BALANCE = [{
  accountAlias: 'fixture', asset: 'USDT', balance: '100.0000', crossWalletBalance: '100.0000',
  crossUnPnl: '2.0000', availableBalance: '99.0000', maxWithdrawAmount: '98.0000', updateTime: T0,
}];

const POSITION = [{
  symbol: 'BTCUSDT', positionSide: 'BOTH', positionAmt: '0.0100', entryPrice: '49000.0000',
  breakEvenPrice: '49010.0000', markPrice: '50000.1000', unRealizedProfit: '10.0010',
  liquidationPrice: '30000.0000', isolatedMargin: '0', notional: '500.0010', marginAsset: 'USDT',
  isolatedWallet: '0', initialMargin: '10.0000', maintMargin: '2.5000', updateTime: T0,
}];

const ORDER = {
  symbol: 'BTCUSDT', orderId: 77, clientOrderId: 'cx-fixture-1', price: '50000.1000', avgPrice: '0.0000',
  origQty: '0.0100', executedQty: '0', cumQuote: '0.0000', status: 'NEW', timeInForce: 'GTC',
  type: 'LIMIT', origType: 'LIMIT', side: 'BUY', positionSide: 'BOTH', reduceOnly: false,
  closePosition: false, stopPrice: '0.0000', time: T0, updateTime: T0,
};

const TEST_ORDER_RESPONSE = {
  clientOrderId: 'cx-fixture-1', cumQty: '0', cumQuote: '0', executedQty: '0', orderId: 88,
  avgPrice: '0.00000', origQty: '0.0100', price: '50000.1000', reduceOnly: false, side: 'BUY',
  positionSide: 'BOTH', status: 'NEW', stopPrice: '0', closePosition: false, symbol: 'BTCUSDT',
  timeInForce: 'GTC', type: 'LIMIT', origType: 'LIMIT', updateTime: T0,
};

const TRADE = [{
  symbol: 'BTCUSDT', id: 9, orderId: 77, price: '50000.1000', qty: '0.0100', quoteQty: '500.0010',
  commission: '0.200000', commissionAsset: 'USDT', realizedPnl: '1.5000', side: 'SELL',
  positionSide: 'BOTH', buyer: false, maker: true, time: T0,
}];

section('1. official endpoint and authority matrix');
{
  const expected = {
    SERVER_TIME: ['GET', '/fapi/v1/time', 'NONE', true],
    EXCHANGE_INFO: ['GET', '/fapi/v1/exchangeInfo', 'NONE', true],
    MARK_FUNDING: ['GET', '/fapi/v1/premiumIndex', 'NONE', true],
    FUNDING_RATE: ['GET', '/fapi/v1/fundingRate', 'NONE', true],
    ACCOUNT: ['GET', '/fapi/v3/account', 'SIGNED', true],
    BALANCE: ['GET', '/fapi/v3/balance', 'SIGNED', true],
    POSITIONS: ['GET', '/fapi/v3/positionRisk', 'SIGNED', true],
    ORDER: ['GET', '/fapi/v1/order', 'SIGNED', true],
    OPEN_ORDERS: ['GET', '/fapi/v1/openOrders', 'SIGNED', true],
    USER_TRADES: ['GET', '/fapi/v1/userTrades', 'SIGNED', true],
    TEST_ORDER: ['POST', '/fapi/v1/order/test', 'SIGNED', false],
  };
  check('exactly eleven allowed operations', Object.keys(BINANCE_USDM_ENDPOINTS).length === 11);
  for (const [name, [method, path, security, idempotent]] of Object.entries(expected)) {
    const actual = BINANCE_USDM_ENDPOINTS[name];
    check(`${name} method`, actual?.method === method);
    check(`${name} path`, actual?.path === path);
    check(`${name} security`, actual?.security === security);
    check(`${name} retry authority`, actual?.idempotent === idempotent);
  }
  const posts = Object.values(BINANCE_USDM_ENDPOINTS).filter((item) => item.method === 'POST');
  check('only POST is test-order', posts.length === 1 && posts[0].path === '/fapi/v1/order/test');
  check('no DELETE/PUT mutation endpoint', Object.values(BINANCE_USDM_ENDPOINTS).every((item) => item.method === 'GET' || item.path.endsWith('/order/test')));
  const prototype = BinanceUsdMClient.prototype;
  for (const forbidden of ['placeOrder', 'cancelOrder', 'replaceOrder', 'borrow', 'repay', 'transfer', 'withdraw', 'changeLeverage', 'changeMarginMode']) {
    check(`no ${forbidden} capability`, typeof prototype[forbidden] === 'undefined');
  }
}

section('2. exact decimal and deterministic HMAC laws');
{
  const normalizations = [
    ['00012.3400', '12.34'], ['+0.0100', '0.01'], ['-0.000', '0'], ['001', '1'], ['10.000', '10'], ['-001.2300', '-1.23'],
  ];
  for (const [input, expected] of normalizations) check(`normalize ${input}`, normalizeDecimalString(input) === expected);
  for (const invalid of ['1e-3', ' 1', '1 ', '.1', '1.', '', 'NaN']) {
    let failed = false;
    try { normalizeDecimalString(invalid); } catch { failed = true; }
    check(`reject malformed decimal ${JSON.stringify(invalid)}`, failed);
  }
  check('exact compare ignores scale', compareDecimalStrings('1.2300', '1.23') === 0);
  check('exact negative compare', compareDecimalStrings('-0.2', '-0.1') === -1);
  check('exact step accepts 0.010', isDecimalMultiple('0.010', '0.001'));
  check('exact step rejects 0.0105', !isDecimalMultiple('0.0105', '0.001'));
  check('origin-relative grid accepts min+n*step', isDecimalOffsetMultiple('0.15', '0.05', '0.1'));
  check('origin-relative grid rejects zero-origin-only value', !isDecimalOffsetMultiple('0.10', '0.05', '0.1'));
  check('exact multiplication', multiplyDecimalStrings('0.0100', '50000.10') === '500.001');
  const deterministicPayload = 'symbol=BTCUSDT&side=BUY&type=LIMIT&quantity=1&price=9000&timeInForce=GTC&recvWindow=5000&timestamp=1591702613943';
  const deterministicSigner = createHmacSha256Signer('fixture-hmac-key');
  check('deterministic HMAC-SHA256 fixture', deterministicSigner.sign(deterministicPayload) === 'a62a3f52f80a14feb2f07ac30619dfa20f405c87fa9ddf7b574f8646e3ba08ba');
  check('form encoding deterministic', encodeForm([['symbol', 'BTCUSDT'], ['reduceOnly', true], ['price', '1.20']]) === 'symbol=BTCUSDT&reduceOnly=true&price=1.20');
}

section('3. full read/test endpoint matrix through fake transport');
{
  const h = createHarness();
  const time = await syncTime(h, 'matrix-time');
  check('server time succeeds', time.ok);
  check('midpoint offset is exact', time.ok && time.value.offsetMs === 100 && time.value.roundTripMs === 20);
  check('offset retained by client', h.client.getServerOffsetMs() === 100);
  check('time rate header parsed', time.ok && time.metadata.rateLimit.usedWeight1m === 1);

  h.enqueue({ response: response(EXCHANGE_INFO) });
  const exchange = await h.client.getExchangeInfo({ correlationId: 'matrix-exchange' });
  check('exchangeInfo succeeds', exchange.ok);
  check('exchange decimals normalized', exchange.ok && exchange.value.symbols[0].filters.price.tickSize === '0.1');
  check('unknown filters ignored safely', exchange.ok && exchange.value.symbols[0].filters.minNotional === '5');
  check('PERCENT_PRICE parsed exactly', exchange.ok && exchange.value.symbols[0].filters.percentPrice.multiplierUp === '1.15');
  check('exchangeInfo symbol carries injected authority', exchange.ok && exchange.value.symbols[0].observedAt.authority === 'SYNTHETIC_TEST');
  check('exchangeInfo source time stays explicitly unknown', exchange.ok && exchange.value.symbols[0].observedAt.sourceTimeMs === null);
  check('exchangeInfo receipt/maxAge provenance is exact', exchange.ok && exchange.value.symbols[0].observedAt.receivedAtMs === exchange.metadata.receivedAtMs && exchange.value.symbols[0].observedAt.maxAgeMs === 60_000);
  check('exchangeInfo provenance is complete and identified', exchange.ok && exchange.value.symbols[0].observedAt.completeness === 'COMPLETE' && exchange.value.symbols[0].observedAt.sourceId === 'binance.usdm.exchangeInfo');

  h.enqueue({ response: response(MARK) });
  const mark = await h.client.getMarkFunding('BTCUSDT', { correlationId: 'matrix-mark' });
  check('mark/funding succeeds', mark.ok);
  check('mark decimal normalized', mark.ok && mark.value.markPrice === '50000.1');
  check('source time preserved', mark.ok && mark.value.sourceTimeMs === T0);

  h.enqueue({ response: response([{ symbol: 'BTCUSDT', fundingRate: '-0.00010000', fundingTime: T0, markPrice: '50000.1000' }]) });
  const funding = await h.client.getFundingRates({ symbol: 'BTCUSDT', limit: 1 }, { correlationId: 'matrix-funding' });
  check('funding history succeeds', funding.ok && funding.value.length === 1);
  check('funding decimal normalized', funding.ok && funding.value[0].fundingRate === '-0.0001');

  h.enqueue({ response: response(ACCOUNT) });
  const account = await h.client.getAccount({ correlationId: 'matrix-account' });
  check('account read succeeds', account.ok);
  check('account decimal normalized', account.ok && account.value.totalMarginBalance === '102');
  check('account positions parsed', account.ok && account.value.positions[0].positionAmt === '0.01');

  h.enqueue({ response: response(BALANCE) });
  const balances = await h.client.getBalances({ correlationId: 'matrix-balances' });
  check('balance read succeeds', balances.ok && balances.value.length === 1);
  check('missing marginAvailable stays explicit null', balances.ok && balances.value[0].marginAvailable === null);

  h.enqueue({ response: response(POSITION) });
  const positions = await h.client.getPositions('BTCUSDT', { correlationId: 'matrix-positions' });
  check('position read succeeds', positions.ok && positions.value.length === 1);
  check('position decimal normalized', positions.ok && positions.value[0].breakEvenPrice === '49010');

  h.enqueue({ response: response(ORDER) });
  const order = await h.client.getOrder({ symbol: 'BTCUSDT', orderId: 77 }, { correlationId: 'matrix-order' });
  check('order lookup succeeds', order.ok && order.value.orderId === 77);
  check('order decimal normalized', order.ok && order.value.origQty === '0.01');

  h.enqueue({ response: response([ORDER]) });
  const open = await h.client.getOpenOrders('BTCUSDT', { correlationId: 'matrix-open' });
  check('open-order read succeeds', open.ok && open.value.length === 1);
  check('open-order source identity matches request', open.ok && open.value[0].symbol === 'BTCUSDT');

  h.enqueue({ response: response(TRADE) });
  const trades = await h.client.getUserTrades({ symbol: 'BTCUSDT', limit: 50 }, { correlationId: 'matrix-trades' });
  check('user-trades read succeeds', trades.ok && trades.value.length === 1);
  check('fill decimal normalized', trades.ok && trades.value[0].commission === '0.2');

  h.enqueue({ response: response(TEST_ORDER_RESPONSE) });
  const test = await h.client.testOrder(LIMIT_ORDER, { correlationId: 'matrix-test' });
  check('test-order validation succeeds', test.ok && test.value.validationAccepted === true);
  check('test-order states no matching-engine submission', test.ok && test.value.submittedToMatchingEngine === false);
  check('test-order preserves venue response identity', test.ok && test.value.venueOrderId === 88 && test.value.venueClientOrderId === 'cx-fixture-1');
  check('all eleven calls used fake transport', h.state.requests.length === 11, `${h.state.requests.length}`);
  const signed = h.state.requests.filter((request) => request.headers['X-MBX-APIKEY'] !== undefined);
  check('seven signed operations carry API-key header', signed.length === 7, `${signed.length}`);
  check('every signed request has bounded recvWindow', signed.every((request) => `${request.query}${request.body}`.includes('recvWindow=5000')));
  check('all reads use query and null body', h.state.requests.filter((request) => request.method === 'GET').every((request) => request.body === null));
  const testRequest = h.state.requests.at(-1);
  check('test-order is hardwired to /order/test', testRequest.method === 'POST' && testRequest.path === '/fapi/v1/order/test');
  check('test-order has no query duplication', testRequest.query === '' && typeof testRequest.body === 'string');
  check('local-only filter context not transmitted', !testRequest.body.includes('filters') && !testRequest.body.includes('notionalReferencePrice'));
  check('request decimals transmitted canonically', testRequest.body.includes('quantity=0.01') && testRequest.body.includes('price=50000.1'));
  const [unsignedBody, sentSignature] = testRequest.body.split('&signature=');
  check('signature is final form parameter', typeof sentSignature === 'string' && /^[a-f0-9]{64}$/.test(sentSignature));
  check('signature covers exact encoded body', SIGNER.sign(unsignedBody) === sentSignature);
  const timestamp = Number(new URLSearchParams(unsignedBody).get('timestamp'));
  check('signed timestamp includes synchronized offset', timestamp === test.metadata.startedAtMs + 100);
  check('transport receives timeout contract', h.state.requests.every((request) => request.timeoutMs === 9_000));
}

section('4. test-order mode, TIF, decimal-filter, and unknown-fact gate');
{
  const valid = validateTestOrder(LIMIT_ORDER, T0);
  check('pure validator accepts canonical limit', valid.ok);
  check('pure validator canonicalizes quantity', valid.ok && valid.value.normalizedQuantity === '0.01');
  check('pure validator canonicalizes price', valid.ok && valid.value.normalizedPrice === '50000.1');

  const atFreshBoundary = validateTestOrder({
    ...LIMIT_ORDER,
    exchangeSymbol: { ...SYMBOL_RULES, observedAt: { ...FILTER_OBSERVED_AT, receivedAtMs: T0 - 60_000 } },
  }, T0);
  check('filter facts are usable at exact maxAge boundary', atFreshBoundary.ok);
  const staleFilters = validateTestOrder({
    ...LIMIT_ORDER,
    exchangeSymbol: { ...SYMBOL_RULES, observedAt: { ...FILTER_OBSERVED_AT, receivedAtMs: T0 - 60_001 } },
  }, T0);
  check('filter facts fail one millisecond past maxAge', !staleFilters.ok && staleFilters.issues.some((item) => item.code === 'FILTER_FACT_STALE'));
  const skewedFilters = validateTestOrder({
    ...LIMIT_ORDER,
    exchangeSymbol: { ...SYMBOL_RULES, observedAt: { ...FILTER_OBSERVED_AT, receivedAtMs: T0 + 2_001 } },
  }, T0);
  check('future-skewed filter facts fail closed', !skewedFilters.ok && skewedFilters.issues.some((item) => item.code === 'FILTER_FACT_CLOCK_SKEWED'));
  const unavailableFilters = validateTestOrder({
    ...LIMIT_ORDER,
    exchangeSymbol: { ...SYMBOL_RULES, observedAt: { ...FILTER_OBSERVED_AT, authority: 'UNAVAILABLE', completeness: 'UNAVAILABLE' } },
  }, T0);
  check('unavailable filter authority fails closed', !unavailableFilters.ok && unavailableFilters.issues.some((item) => item.code === 'FILTER_FACT_UNAVAILABLE'));
  const partialFilters = validateTestOrder({
    ...LIMIT_ORDER,
    exchangeSymbol: { ...SYMBOL_RULES, observedAt: { ...FILTER_OBSERVED_AT, completeness: 'PARTIAL' } },
  }, T0);
  check('partial filter facts fail closed', !partialFilters.ok && partialFilters.issues.some((item) => item.code === 'FILTER_FACT_PARTIAL'));

  const offsetFilters = {
    price: { minPrice: '0.05', maxPrice: '10', tickSize: '0.1' },
    lotSize: { minQty: '0.05', maxQty: '10', stepSize: '0.1' },
    marketLotSize: { minQty: '0.05', maxQty: '10', stepSize: '0.1' },
    minNotional: '0',
    percentPrice: { multiplierUp: '2', multiplierDown: '0.1' },
  };
  const offsetRules = { ...SYMBOL_RULES, filters: offsetFilters };
  const offsetValid = validateTestOrder({ ...LIMIT_ORDER, quantity: '0.15', price: '0.15', notionalReferencePrice: '0.15', exchangeSymbol: offsetRules }, T0);
  const offsetInvalid = validateTestOrder({ ...LIMIT_ORDER, quantity: '0.10', price: '0.10', notionalReferencePrice: '0.10', exchangeSymbol: offsetRules }, T0);
  check('origin-relative price/lot grids accept min+n*increment', offsetValid.ok);
  check('zero-origin-only price/lot values are rejected', !offsetInvalid.ok && offsetInvalid.issues.some((item) => item.code === 'QUANTITY_STEP_MISMATCH') && offsetInvalid.issues.some((item) => item.code === 'PRICE_TICK_MISMATCH'));

  const negativeFilters = {
    price: { minPrice: '-1', maxPrice: '-1', tickSize: '-1' },
    lotSize: { minQty: '-1', maxQty: '-1', stepSize: '-1' },
    marketLotSize: { minQty: '-1', maxQty: '-1', stepSize: '-1' },
    minNotional: '-1',
    percentPrice: { multiplierUp: '1.15', multiplierDown: '0.85' },
  };
  const negative = validateTestOrder({ ...LIMIT_ORDER, quantity: '0.12345', price: '0.12345', notionalReferencePrice: '0.12345', exchangeSymbol: { ...SYMBOL_RULES, filters: negativeFilters } }, T0);
  check('negative filter domains fail closed', !negative.ok && negative.issues.filter((item) => item.code === 'FILTER_MALFORMED').length >= 3);
  const incoherent = validateTestOrder({ ...LIMIT_ORDER, exchangeSymbol: { ...SYMBOL_RULES, filters: { ...FILTERS, price: { minPrice: '10', maxPrice: '1', tickSize: '0.1' }, lotSize: { minQty: '10', maxQty: '1', stepSize: '0.1' } } } }, T0);
  check('min greater than max is malformed', !incoherent.ok && incoherent.issues.some((item) => item.code === 'FILTER_MALFORMED'));

  const cases = [
    ['one-way rejects LONG', { ...LIMIT_ORDER, positionSide: 'LONG' }, 'ONE_WAY_REQUIRES_BOTH'],
    ['hedge rejects BOTH', { ...LIMIT_ORDER, positionMode: 'HEDGE', positionSide: 'BOTH', reduceOnly: undefined }, 'HEDGE_REQUIRES_DIRECTION'],
    ['hedge rejects reduceOnly false', { ...LIMIT_ORDER, positionMode: 'HEDGE', positionSide: 'LONG', reduceOnly: false }, 'REDUCE_ONLY_FORBIDDEN_IN_HEDGE'],
    ['close-all rejects quantity', { ...LIMIT_ORDER, type: 'STOP_MARKET', price: undefined, timeInForce: undefined, stopPrice: '49000', closePosition: true }, 'QUANTITY_WITH_CLOSE_POSITION'],
    ['close-all rejects reduceOnly', { ...LIMIT_ORDER, type: 'STOP_MARKET', quantity: undefined, price: undefined, timeInForce: undefined, stopPrice: '49000', closePosition: true, reduceOnly: true }, 'REDUCE_ONLY_WITH_CLOSE_POSITION'],
    ['close-all rejects LIMIT', { ...LIMIT_ORDER, quantity: undefined, closePosition: true }, 'CLOSE_POSITION_TYPE_INVALID'],
    ['limit requires TIF', { ...LIMIT_ORDER, timeInForce: undefined }, 'TIME_IN_FORCE_REQUIRED'],
    ['market forbids TIF', { ...LIMIT_ORDER, type: 'MARKET', price: undefined, timeInForce: 'GTC', notionalReferencePrice: '50000' }, 'TIME_IN_FORCE_FORBIDDEN'],
    ['market forbids price', { ...LIMIT_ORDER, type: 'MARKET', timeInForce: undefined, notionalReferencePrice: '50000' }, 'PRICE_FORBIDDEN'],
    ['quantity below minimum', { ...LIMIT_ORDER, quantity: '0.0001' }, 'QUANTITY_BELOW_MIN'],
    ['quantity step mismatch', { ...LIMIT_ORDER, quantity: '0.0015' }, 'QUANTITY_STEP_MISMATCH'],
    ['price below minimum', { ...LIMIT_ORDER, price: '0.01' }, 'PRICE_BELOW_MIN'],
    ['price tick mismatch', { ...LIMIT_ORDER, price: '50000.15' }, 'PRICE_TICK_MISMATCH'],
    ['notional below minimum', { ...LIMIT_ORDER, quantity: '0.001', price: '1000' }, 'NOTIONAL_BELOW_MIN'],
    ['unknown price filter fails closed', { ...LIMIT_ORDER, exchangeSymbol: { ...SYMBOL_RULES, filters: { ...FILTERS, price: null } } }, 'FILTER_FACT_UNKNOWN'],
    ['unknown lot filter fails closed', { ...LIMIT_ORDER, exchangeSymbol: { ...SYMBOL_RULES, filters: { ...FILTERS, lotSize: null } } }, 'FILTER_FACT_UNKNOWN'],
    ['unknown min-notional fails closed', { ...LIMIT_ORDER, exchangeSymbol: { ...SYMBOL_RULES, filters: { ...FILTERS, minNotional: null } } }, 'FILTER_FACT_UNKNOWN'],
    ['market reference price required', { ...LIMIT_ORDER, type: 'MARKET', price: undefined, timeInForce: undefined, notionalReferencePrice: undefined }, 'FILTER_CONTEXT_UNKNOWN'],
    ['trailing callback required', { ...LIMIT_ORDER, type: 'TRAILING_STOP_MARKET', price: undefined, timeInForce: undefined }, 'REQUIRED'],
    ['trailing callback low rejected', { ...LIMIT_ORDER, type: 'TRAILING_STOP_MARKET', price: undefined, timeInForce: undefined, callbackRate: '0.09' }, 'CALLBACK_RATE_RANGE'],
    ['trailing callback high rejected', { ...LIMIT_ORDER, type: 'TRAILING_STOP_MARKET', price: undefined, timeInForce: undefined, callbackRate: '5.1' }, 'CALLBACK_RATE_RANGE'],
    ['GTD requires date', { ...LIMIT_ORDER, timeInForce: 'GTD' }, 'GOOD_TILL_DATE_REQUIRED'],
    ['GTD requires over 600 seconds', { ...LIMIT_ORDER, timeInForce: 'GTD', goodTillDateMs: T0 + 600_000 }, 'GOOD_TILL_DATE_RANGE'],
    ['date forbidden without GTD', { ...LIMIT_ORDER, goodTillDateMs: T0 + 700_000 }, 'GOOD_TILL_DATE_WITHOUT_GTD'],
    ['client-order id constrained', { ...LIMIT_ORDER, newClientOrderId: 'bad id' }, 'CLIENT_ORDER_ID_INVALID'],
  ];
  for (const [name, input, code] of cases) {
    const validation = validateTestOrder(input, T0);
    check(name, !validation.ok && validation.issues.some((item) => item.code === code), validation.ok ? 'unexpected success' : validation.issues.map((item) => item.code).join(','));
  }
  const market = validateTestOrder({ ...LIMIT_ORDER, type: 'MARKET', price: undefined, timeInForce: undefined, notionalReferencePrice: '50000.00' }, T0);
  check('market with explicit reference passes exact filters', market.ok);
  const marketUnknownLot = validateTestOrder({ ...LIMIT_ORDER, type: 'MARKET', price: undefined, timeInForce: undefined, exchangeSymbol: { ...SYMBOL_RULES, filters: { ...FILTERS, marketLotSize: null } } }, T0);
  check('unknown MARKET_LOT_SIZE never falls back to LOT_SIZE', !marketUnknownLot.ok && marketUnknownLot.issues.some((item) => item.code === 'FILTER_FACT_UNKNOWN'));
  const wrongSymbol = validateTestOrder({ ...LIMIT_ORDER, symbol: 'ETHUSDT' }, T0);
  check('filter facts are bound to symbol identity', !wrongSymbol.ok && wrongSymbol.issues.some((item) => item.code === 'FILTER_SYMBOL_MISMATCH'));
  const halted = validateTestOrder({ ...LIMIT_ORDER, exchangeSymbol: { ...SYMBOL_RULES, status: 'BREAK' } }, T0);
  check('non-TRADING symbol fails closed', !halted.ok && halted.issues.some((item) => item.code === 'SYMBOL_NOT_TRADING'));
  const unsupportedType = validateTestOrder({ ...LIMIT_ORDER, exchangeSymbol: { ...SYMBOL_RULES, orderTypes: ['MARKET'] } }, T0);
  check('order type must be advertised by exchangeInfo', !unsupportedType.ok && unsupportedType.issues.some((item) => item.code === 'ORDER_TYPE_UNSUPPORTED_BY_SYMBOL'));
  const unsupportedTif = validateTestOrder({ ...LIMIT_ORDER, exchangeSymbol: { ...SYMBOL_RULES, timeInForce: ['IOC'] } }, T0);
  check('TIF must be advertised by exchangeInfo', !unsupportedTif.ok && unsupportedTif.issues.some((item) => item.code === 'TIME_IN_FORCE_UNSUPPORTED_BY_SYMBOL'));
  const percentRules = { ...SYMBOL_RULES, filters: { price: { minPrice: '0', maxPrice: '1000', tickSize: '1' }, lotSize: { minQty: '1', maxQty: '10', stepSize: '1' }, marketLotSize: { minQty: '1', maxQty: '10', stepSize: '1' }, minNotional: '0', percentPrice: { multiplierUp: '1.15', multiplierDown: '0.85' } } };
  const percentHigh = validateTestOrder({ ...LIMIT_ORDER, quantity: '1', price: '100', notionalReferencePrice: '10', exchangeSymbol: percentRules }, T0);
  check('PERCENT_PRICE upper bound enforced', !percentHigh.ok && percentHigh.issues.some((item) => item.code === 'PRICE_ABOVE_PERCENT_LIMIT'));
  const percentUnknown = validateTestOrder({ ...LIMIT_ORDER, exchangeSymbol: { ...SYMBOL_RULES, filters: { ...FILTERS, percentPrice: null } } }, T0);
  check('unknown PERCENT_PRICE fails closed', !percentUnknown.ok && percentUnknown.issues.some((item) => item.code === 'FILTER_FACT_UNKNOWN'));

  const huge = '9'.repeat(80);
  let overflow = null;
  let overflowThrew = false;
  try {
    overflow = validateTestOrder({
      ...LIMIT_ORDER,
      quantity: huge,
      price: huge,
      notionalReferencePrice: huge,
      exchangeSymbol: { ...SYMBOL_RULES, filters: {
        price: { minPrice: '1', maxPrice: huge, tickSize: '1' },
        lotSize: { minQty: '1', maxQty: huge, stepSize: '1' },
        marketLotSize: { minQty: '1', maxQty: huge, stepSize: '1' },
        minNotional: '1',
        percentPrice: { multiplierUp: '1', multiplierDown: '1' },
      } },
    }, T0);
  } catch { overflowThrew = true; }
  check('bounded decimal arithmetic never escapes as throw', !overflowThrew);
  check('bounded decimal overflow returns named issue', overflow !== null && !overflow.ok && overflow.issues.some((item) => item.code === 'FILTER_ARITHMETIC_BOUNDS'));
  const gtd = validateTestOrder({ ...LIMIT_ORDER, timeInForce: 'GTD', goodTillDateMs: T0 + 700_001 }, T0);
  check('valid GTD passes', gtd.ok);
  const truncationNow = T0 + 900;
  const truncatedTooSoon = validateTestOrder({ ...LIMIT_ORDER, timeInForce: 'GTD', goodTillDateMs: truncationNow + 600_001 }, truncationNow);
  check('GTD validates venue second truncation', !truncatedTooSoon.ok && truncatedTooSoon.issues.some((item) => item.code === 'GOOD_TILL_DATE_RANGE'));
  check('valid GTD is transmitted at second precision', gtd.ok && gtd.value.requestPairs.some(([name, value]) => name === 'goodTillDate' && value === T0 + 700_000));
  const trailing = validateTestOrder({ ...LIMIT_ORDER, type: 'TRAILING_STOP_MARKET', price: undefined, timeInForce: undefined, callbackRate: '1.0', activationPrice: '50000.10', notionalReferencePrice: '50000.10' }, T0);
  check('valid trailing-stop test passes', trailing.ok);
  const stopDefaultTif = validateTestOrder({ ...LIMIT_ORDER, type: 'STOP', stopPrice: '49000', timeInForce: undefined }, T0);
  check('STOP may use documented default GTC', stopDefaultTif.ok);

  const h = createHarness();
  await syncTime(h);
  const before = h.state.requests.length;
  const invalid = await h.client.testOrder({ ...LIMIT_ORDER, price: '50000.15' }, { correlationId: 'invalid-filter' });
  check('client returns typed FILTER error', !invalid.ok && invalid.error.kind === 'FILTER' && invalid.error.code === 'TEST_ORDER_FILTER_REJECTED');
  check('invalid test order never reaches transport', h.state.requests.length === before);
}

section('5. bounded retry, timeout, abort, and ambiguity');
{
  const h = createHarness({ maxReadAttempts: 2 });
  h.enqueue({ response: { outcome: 'TIMEOUT', status: null, headers: {}, body: undefined } });
  h.enqueue({ response: response(EXCHANGE_INFO) });
  const retried = await h.client.getExchangeInfo({ correlationId: 'retry-timeout', timeoutMs: 1234 });
  check('idempotent read retries timeout', retried.ok && retried.metadata.attempts === 2);
  check('read retry made exactly two calls', h.state.requests.length === 2);
  check('timeout is delegated to transport', h.state.requests.every((request) => request.timeoutMs === 1234));

  const thrown = createHarness({ maxReadAttempts: 2 });
  thrown.enqueue({ throw: true });
  thrown.enqueue({ response: response(EXCHANGE_INFO) });
  const retriedThrow = await thrown.client.getExchangeInfo({ correlationId: 'retry-throw' });
  check('ambiguous thrown read retries', retriedThrow.ok && retriedThrow.metadata.attempts === 2);

  const flip = createHarness({ maxReadAttempts: 2 });
  const flipSignal = { aborted: false };
  flip.enqueue({ response: () => {
    flipSignal.aborted = true;
    return { outcome: 'TIMEOUT', status: null, headers: {}, body: undefined };
  } });
  flip.enqueue({ response: response(EXCHANGE_INFO) });
  const flippedAbort = await flip.client.getExchangeInfo({ correlationId: 'abort-before-retry', signal: flipSignal });
  check('abort flip before retry returns ABORTED', !flippedAbort.ok && flippedAbort.error.code === 'REQUEST_ABORTED_BEFORE_RETRY');
  check('abort flip prevents second dispatch', flip.state.requests.length === 1);

  const malformedEnvelope = createHarness({ maxReadAttempts: 3 });
  malformedEnvelope.enqueue({ response: { nope: true } });
  const badEnvelope = await malformedEnvelope.client.getExchangeInfo({ correlationId: 'malformed-envelope' });
  check('malformed transport envelope rejected', !badEnvelope.ok && badEnvelope.error.code === 'MALFORMED_TRANSPORT_RESPONSE');
  check('malformed transport envelope never retried', malformedEnvelope.state.requests.length === 1);

  const malformedBody = createHarness({ maxReadAttempts: 3 });
  malformedBody.enqueue({ response: response({ timezone: 'UTC', rateLimits: [], symbols: 'not-array' }) });
  const badBody = await malformedBody.client.getExchangeInfo({ correlationId: 'malformed-body' });
  check('malformed venue body rejected', !badBody.ok && badBody.error.code === 'MALFORMED_RESPONSE');
  check('malformed venue body never retried', malformedBody.state.requests.length === 1);

  const abortBefore = createHarness();
  const aborted = await abortBefore.client.getExchangeInfo({ correlationId: 'abort-before', signal: { aborted: true } });
  check('pre-abort is typed', !aborted.ok && aborted.error.kind === 'ABORTED');
  check('pre-abort dispatches zero requests', abortBefore.state.requests.length === 0);

  const abortTransport = createHarness();
  abortTransport.enqueue({ response: { outcome: 'ABORTED', status: null, headers: {}, body: undefined } });
  const abortedAtTransport = await abortTransport.client.getExchangeInfo({ correlationId: 'abort-transport', signal: { aborted: false } });
  check('transport abort is typed', !abortedAtTransport.ok && abortedAtTransport.error.transportOutcome === 'ABORTED');
  check('transport abort does not retry', abortTransport.state.requests.length === 1);

  const post = createHarness();
  await syncTime(post, 'post-sync');
  post.enqueue({ response: { outcome: 'TIMEOUT', status: null, headers: {}, body: undefined } });
  const ambiguousPost = await post.client.testOrder(LIMIT_ORDER, { correlationId: 'post-timeout' });
  check('test-order timeout is ambiguous', !ambiguousPost.ok && ambiguousPost.error.ambiguous && ambiguousPost.error.code === 'TEST_ORDER_TIMEOUT_AMBIGUOUS');
  check('test-order POST is never retried', post.state.requests.filter((request) => request.operation === 'TEST_ORDER').length === 1);

  const malformedPost = createHarness();
  await syncTime(malformedPost, 'malformed-post-sync');
  malformedPost.enqueue({ response: response({}) });
  const malformedTestResponse = await malformedPost.client.testOrder(LIMIT_ORDER, { correlationId: 'malformed-test-response' });
  check('empty test-order response is rejected, never fake success', !malformedTestResponse.ok && malformedTestResponse.error.code === 'MALFORMED_RESPONSE');
  check('malformed test-order response is never retried', malformedPost.state.requests.filter((request) => request.operation === 'TEST_ORDER').length === 1);

  const unsynced = createHarness();
  const blocked = await unsynced.client.getAccount({ correlationId: 'unsigned-block' });
  check('signed read requires server offset', !blocked.ok && blocked.error.code === 'SERVER_TIME_UNSYNCHRONIZED');
  check('unsynchronized signed read dispatches zero requests', unsynced.state.requests.length === 0);
}

section('6. rate metadata and deterministic cooldown');
{
  const h = createHarness();
  h.enqueue({ response: response({ code: -1003, msg: 'Too many requests' }, 429, {
    'x-mbx-used-weight-1m': '2400', 'X-MBX-ORDER-COUNT-10S': '12', 'x-mbx-order-count-1m': '34', 'Retry-After': '2',
  }) });
  const limited = await h.client.getExchangeInfo({ correlationId: 'rate-limited' });
  check('429 normalized as rate-limited', !limited.ok && limited.error.kind === 'RATE_LIMITED');
  check('used weight parsed', !limited.ok && limited.metadata.rateLimit.usedWeight1m === 2400);
  check('order counts parsed', !limited.ok && limited.metadata.rateLimit.orderCount10s === 12 && limited.metadata.rateLimit.orderCount1m === 34);
  check('retry header converted to milliseconds', !limited.ok && limited.metadata.rateLimit.retryAfterMs === 2000);
  check('venue cooldown source explicit', !limited.ok && limited.metadata.rateLimit.cooldownSource === 'VENUE_HEADER');
  const calls = h.state.requests.length;
  const cooldown = await h.client.getExchangeInfo({ correlationId: 'cooldown-block' });
  check('active cooldown blocks locally', !cooldown.ok && cooldown.error.code === 'RATE_LIMIT_COOLDOWN_ACTIVE');
  check('cooldown block makes no transport call', h.state.requests.length === calls);
  const state = h.client.getCooldownState();
  check('cooldown state exposes remaining time', state.active && state.remainingMs === 2000);
  h.advance(2000);
  h.enqueue({ response: response(EXCHANGE_INFO) });
  const after = await h.client.getExchangeInfo({ correlationId: 'cooldown-expired' });
  check('request resumes at cooldown boundary', after.ok);
  check('cooldown clears deterministically', !h.client.getCooldownState().active);

  const local = createHarness({ defaultRateLimitCooldownMs: 3333 });
  local.enqueue({ response: response({ code: -1003, msg: 'rate' }, 429) });
  const fallback = await local.client.getExchangeInfo({ correlationId: 'rate-local-policy' });
  check('missing retry header uses named local policy', !fallback.ok && fallback.metadata.rateLimit.cooldownSource === 'LOCAL_POLICY');
  check('local policy is exact', local.client.getCooldownState().remainingMs === 3333);
}

section('7. typed venue errors, HTTP ambiguity, redaction, and strict schemas');
{
  const venue = createHarness();
  venue.enqueue({ response: response({ code: -1121, msg: `Invalid symbol apiKey=${API_KEY} signature=abcdef` }, 400) });
  const rejected = await venue.client.getExchangeInfo({ correlationId: 'venue-error' });
  check('venue code normalized', !rejected.ok && rejected.error.kind === 'VENUE' && rejected.error.venueCode === -1121);
  check('typed error carries frozen StructuredFailure fields', !rejected.ok && rejected.error.component === 'foundation.exchange.binanceUsdM' && rejected.error.stage === 'venue' && rejected.error.safeCurrentState === 'UNCHANGED' && rejected.error.occurredAt === rejected.metadata.receivedAtMs);
  const safeError = serializeSafeError(rejected.error);
  check('safe error redacts configured API key', !safeError.includes(API_KEY));
  check('safe error redacts signature value', !safeError.includes('abcdef') && safeError.includes('[REDACTED]'));

  const stringCode = createHarness();
  await syncTime(stringCode, 'string-code-sync');
  stringCode.enqueue({ response: response({ code: '-1121', msg: 'Invalid symbol.' }) });
  const stringCodeResult = await stringCode.client.testOrder(LIMIT_ORDER, { correlationId: 'string-code-test' });
  check('string venue error code cannot become test-order success', !stringCodeResult.ok && stringCodeResult.error.venueCode === -1121);
  check('string venue error is typed VENUE rejection', !stringCodeResult.ok && stringCodeResult.error.kind === 'VENUE');

  const unknown503 = createHarness({ maxReadAttempts: 1 });
  unknown503.enqueue({ response: response({ code: -1000, msg: 'Unknown error, please check your request or try again later.' }, 503) });
  const ambiguous = await unknown503.client.getExchangeInfo({ correlationId: 'unknown-503' });
  check('documented 503 variant remains ambiguous', !ambiguous.ok && ambiguous.error.kind === 'AMBIGUOUS' && ambiguous.error.ambiguous);

  const unavailable = createHarness({ maxReadAttempts: 1 });
  unavailable.enqueue({ response: response({ code: -1000, msg: 'Service Unavailable.' }, 503) });
  const failed = await unavailable.client.getExchangeInfo({ correlationId: 'service-503' });
  check('definite 503 is HTTP failure not ambiguous', !failed.ok && failed.error.kind === 'HTTP' && !failed.error.ambiguous);

  const symbolMismatch = createHarness();
  symbolMismatch.enqueue({ response: response({ ...MARK, symbol: 'ETHUSDT' }) });
  const mismatch = await symbolMismatch.client.getMarkFunding('BTCUSDT', { correlationId: 'symbol-mismatch' });
  check('response symbol mismatch rejected malformed', !mismatch.ok && mismatch.error.code === 'MALFORMED_RESPONSE');

  const badDecimal = createHarness();
  badDecimal.enqueue({ response: response({ ...MARK, markPrice: 50000.1 }) });
  const bad = await badDecimal.client.getMarkFunding('BTCUSDT', { correlationId: 'number-decimal' });
  check('numeric decimal rejected', !bad.ok && bad.error.code === 'MALFORMED_RESPONSE');

  const malformedFilters = createHarness();
  const badInfo = structuredClone(EXCHANGE_INFO);
  badInfo.symbols[0].filters[0].minPrice = '-1';
  malformedFilters.enqueue({ response: response(badInfo) });
  const badFilterResponse = await malformedFilters.client.getExchangeInfo({ correlationId: 'negative-filter-response' });
  check('negative exchangeInfo filter response rejected', !badFilterResponse.ok && badFilterResponse.error.code === 'MALFORMED_RESPONSE');

  const enums = createHarness();
  await syncTime(enums, 'enum-sync');
  enums.enqueue({ response: response([{ ...POSITION[0], positionSide: 'NOT_A_POSITION_SIDE' }]) });
  const badPositionEnum = await enums.client.getPositions('BTCUSDT', { correlationId: 'bad-position-enum' });
  check('unknown positionSide response enum rejected', !badPositionEnum.ok && badPositionEnum.error.code === 'MALFORMED_RESPONSE');
  for (const [field, value] of [['side', 'SIDEWAYS'], ['status', 'MYSTERY'], ['timeInForce', 'FOREVER'], ['type', 'MAGIC']]) {
    enums.enqueue({ response: response({ ...ORDER, [field]: value }) });
    const result = await enums.client.getOrder({ symbol: 'BTCUSDT', orderId: 77 }, { correlationId: `bad-order-${field}` });
    check(`unknown order ${field} enum rejected`, !result.ok && result.error.code === 'MALFORMED_RESPONSE');
  }

  const unknownFunding = createHarness();
  unknownFunding.enqueue({ response: response([{ symbol: 'BTCUSDT', fundingRate: '0.1', fundingTime: T0 }]) });
  const noMark = await unknownFunding.client.getFundingRates({ symbol: 'BTCUSDT' }, { correlationId: 'funding-no-mark' });
  check('missing optional funding mark stays null', noMark.ok && noMark.value[0].markPrice === null);

  const h = createHarness();
  await syncTime(h);
  h.enqueue({ response: response(TEST_ORDER_RESPONSE) });
  await h.client.testOrder(LIMIT_ORDER, { correlationId: 'safe-request' });
  const request = h.state.requests.at(-1);
  const safeRequest = serializeSafeRequest(request);
  check('safe request omits API key', !safeRequest.includes(API_KEY));
  check('safe request omits signature bytes', !safeRequest.includes(request.body.split('&signature=')[1]));
  check('safe request omits order values', !safeRequest.includes('50000.1') && !safeRequest.includes('0.01'));
  check('safe request retains parameter names', safeRequest.includes('quantity') && safeRequest.includes('signature'));
  check('safe request identifies redacted auth', safeRequest.includes('"authentication":"REDACTED"'));
}

section('8. bounded input and configuration rejection');
{
  const constructorBase = { apiKey: API_KEY, clock: { nowMs: () => T0 }, transport: { request: async () => response({}) }, signer: SIGNER, publicDataAuthority: 'SYNTHETIC_TEST', exchangeInfoMaxAgeMs: 60_000 };
  await rejects('public authority injection is required', () => new BinanceUsdMClient({ ...constructorBase, publicDataAuthority: undefined }), /publicDataAuthority/);
  await rejects('exchangeInfo maxAge injection must be positive', () => new BinanceUsdMClient({ ...constructorBase, exchangeInfoMaxAgeMs: 0 }), /exchangeInfoMaxAgeMs/);
  await rejects('recvWindow config >60000 rejected', () => new BinanceUsdMClient({ ...constructorBase, recvWindowMs: 60001 }), /recvWindowMs/);
  await rejects('zero recvWindow config rejected', () => new BinanceUsdMClient({ ...constructorBase, recvWindowMs: 0 }), /recvWindowMs/);
  await rejects('read attempts >3 rejected', () => new BinanceUsdMClient({ ...constructorBase, maxReadAttempts: 4 }), /maxReadAttempts/);
  const h = createHarness();
  await rejects('per-request recvWindow >60000 rejected', () => h.client.getExchangeInfo({ correlationId: 'bad-window', recvWindowMs: 60001 }), /recvWindowMs/);
  await rejects('per-request timeout must be positive', () => h.client.getExchangeInfo({ correlationId: 'bad-timeout', timeoutMs: 0 }), /timeoutMs/);
  await rejects('empty correlation rejected', () => h.client.getExchangeInfo({ correlationId: '' }), /correlationId/);
  await rejects('secret-like correlation rejected', () => h.client.getExchangeInfo({ correlationId: 'secret=CORRELATION_PRIVATE_VALUE' }), /correlationId/);
  await rejects('bad symbol rejected before transport', () => h.client.getMarkFunding('btc/usdt', { correlationId: 'bad-symbol' }), /symbol/);
  await rejects('order query requires one identifier', () => h.client.getOrder({ symbol: 'BTCUSDT' }, { correlationId: 'bad-order' }), /exactly one/);
  await rejects('order query rejects two identifiers', () => h.client.getOrder({ symbol: 'BTCUSDT', orderId: 1, origClientOrderId: 'x' }, { correlationId: 'bad-order' }), /exactly one/);
  await rejects('trade query rejects >7 day window', () => h.client.getUserTrades({ symbol: 'BTCUSDT', startTimeMs: T0, endTimeMs: T0 + 7 * 86400000 + 1 }, { correlationId: 'bad-span' }), /seven days/);
  await rejects('trade query rejects fromId with time', () => h.client.getUserTrades({ symbol: 'BTCUSDT', fromId: 1, startTimeMs: T0 }, { correlationId: 'bad-from' }), /cannot be combined/);
  await rejects('funding query rejects limit >1000', () => h.client.getFundingRates({ limit: 1001 }, { correlationId: 'bad-limit' }), /limit/);
  check('invalid inputs made zero fake calls', h.state.requests.length === 0);
  const defensiveSerialization = serializeSafeError({
    component: 'foundation.exchange.binanceUsdM', stage: 'input', kind: 'INPUT', code: 'FIXTURE', message: 'fixture', retryable: false, ambiguous: false,
    transportOutcome: 'REJECTED', httpStatus: null, venueCode: null, venueMessage: null,
    occurredAt: T0, safeCurrentState: 'UNCHANGED', correlationId: 'secret=CORRELATION_PRIVATE_VALUE', recommendedOperatorAction: 'none',
  });
  check('safe serializer defensively redacts correlation secret', !defensiveSerialization.includes('CORRELATION_PRIVATE_VALUE') && defensiveSerialization.includes('[REDACTED]'));
}

section('9. explicit zero-network proof');
{
  const injected = createHarness();
  injected.enqueue({ response: response({ serverTime: T0 }) });
  const result = await injected.client.getServerTime({ correlationId: 'injected-transport-proof' });
  const request = injected.state.requests[0];
  check(
    'caller-injected fake receives the exact server-time request envelope',
    result.ok &&
      injected.state.requests.length === 1 &&
      request.operation === 'SERVER_TIME' &&
      request.method === 'GET' &&
      request.path === '/fapi/v1/time' &&
      request.query === '' &&
      request.body === null &&
      Object.keys(request.headers).length === 0 &&
      request.timeoutMs === 9_000 &&
      request.idempotent === true,
  );
  check('module exports no concrete transport constructor', typeof (await import('../../../../dist/foundation/exchange/binanceUsdM/index.js')).BinanceUsdMHttpTransport === 'undefined');
  check('global network call counter remains zero', globalNetworkCalls === 0, `${globalNetworkCalls}`);
}

const passed = results.filter((result) => result.pass).length;
const failed = results.length - passed;
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} binance-usdm: ${passed}/${results.length}`);
globalThis.fetch = realFetch;
if (failed > 0) process.exit(1);
