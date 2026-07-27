import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { BinancePrivateReadClient } from '../dist/binance/privateReadClient.js';
import { PrivateReadService } from '../dist/services/privateRead.js';

const NOW = 1_800_000_000_000;
const CREDS = {
  apiKey: 'TEST_PRIVATE_READ_KEY_1234',
  apiSecret: 'TEST_PRIVATE_READ_SECRET_NEVER_EXPOSE',
};
const PERMISSIONS = Object.freeze({
  ipRestrict: true,
  createTime: NOW - 1_000,
  enableReading: true,
  enableWithdrawals: false,
  enableInternalTransfer: false,
  enableMargin: false,
  enableFutures: false,
  permitsUniversalTransfer: false,
  enableVanillaOptions: false,
  enableFixApiTrade: false,
  enableFixReadOnly: false,
  enableSpotAndMarginTrading: false,
  enablePortfolioMarginTrading: false,
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SPOT_ORDER = Object.freeze({
  symbol: 'BTCUSDT',
  orderId: 101,
  clientOrderId: 'must-not-cross-browser-boundary',
  side: 'BUY',
  type: 'LIMIT',
  price: '60000.00000000',
  origQty: '0.01000000',
  executedQty: '0.00000000',
  status: 'NEW',
  time: NOW - 500,
});
const SPOT_FILL = Object.freeze({
  symbol: 'BTCUSDT',
  id: 201,
  orderId: 101,
  price: '59900.00000000',
  qty: '0.01000000',
  quoteQty: '599.00000000',
  commission: '0.00001000',
  commissionAsset: 'BTC',
  time: NOW - 1_000,
  isBuyer: true,
});
const USDM_ORDER = Object.freeze({
  symbol: 'BTCUSDT',
  orderId: 301,
  side: 'SELL',
  positionSide: 'BOTH',
  type: 'LIMIT',
  price: '61000.000',
  origQty: '0.010',
  executedQty: '0.000',
  status: 'NEW',
  time: NOW - 400,
  updateTime: NOW - 300,
  reduceOnly: true,
});
const USDM_FILL = Object.freeze({
  symbol: 'BTCUSDT',
  id: 401,
  orderId: 301,
  side: 'SELL',
  positionSide: 'BOTH',
  price: '60900.000',
  qty: '0.010',
  quoteQty: '609.000',
  commission: '0.24360000',
  commissionAsset: 'USDT',
  realizedPnl: '1.50000000',
  time: NOW - 900,
  buyer: false,
  maker: true,
});

function gateway(overrides = {}) {
  return {
    apiRestrictions: async () => ({ ...PERMISSIONS }),
    spotAccount: async () => ({
      balances: [{ asset: 'BTC', free: '0.10000000', locked: '0.01000000' }],
    }),
    spotOpenOrders: async () => [{ ...SPOT_ORDER }],
    spotTrades: async () => [{ ...SPOT_FILL }],
    marginAccount: async () => ({
      totalAssetOfBtc: '0.20000000',
      totalLiabilityOfBtc: '0.01000000',
      totalNetAssetOfBtc: '0.19000000',
      userAssets: [{
        asset: 'USDT',
        free: '1000.00000000',
        locked: '0.00000000',
        borrowed: '100.00000000',
        interest: '0.10000000',
        netAsset: '899.90000000',
      }],
    }),
    marginOpenOrders: async () => [{ ...SPOT_ORDER }],
    marginTrades: async () => [{ ...SPOT_FILL }],
    usdmBalances: async () => [{
      asset: 'USDT',
      balance: '2000.00000000',
      availableBalance: '1900.00000000',
      crossWalletBalance: '2000.00000000',
      crossUnPnl: '10.00000000',
    }],
    usdmPositions: async () => [{
      symbol: 'BTCUSDT',
      positionSide: 'BOTH',
      positionAmt: '-0.010',
      entryPrice: '60000.000',
      markPrice: '59000.000',
      unRealizedProfit: '10.00000000',
      liquidationPrice: '0',
      leverage: '1',
      marginType: 'cross',
      isolatedMargin: '0',
      notional: '-590.00000000',
      updateTime: NOW - 250,
    }],
    usdmOpenOrders: async () => [{ ...USDM_ORDER }],
    usdmTrades: async () => [{ ...USDM_FILL }],
    ...overrides,
  };
}

test('GET-only signer rejects every mutation and unreviewed path before signing or fetch', async () => {
  let calls = 0;
  const client = new BinancePrivateReadClient(CREDS, {
    fetch: async () => {
      calls += 1;
      return jsonResponse({});
    },
    now: () => NOW,
  });

  await assert.rejects(
    client.request('POST', 'SPOT', '/api/v3/account'),
    /GET requests only/,
  );
  await assert.rejects(
    client.request('DELETE', 'USDM', '/fapi/v1/openOrders'),
    /GET requests only/,
  );
  await assert.rejects(
    client.request('GET', 'SPOT', '/api/v3/order'),
    /path is not allowed/,
  );
  assert.equal(calls, 0);
});

test('GET-only signer uses the exact host/path and keeps secrets out of errors and results', async () => {
  const requests = [];
  const client = new BinancePrivateReadClient(CREDS, {
    fetch: async (input, init) => {
      requests.push({ input: String(input), init });
      return jsonResponse({ ...PERMISSIONS });
    },
    now: () => NOW,
  });
  const result = await client.apiRestrictions();
  const url = new URL(requests[0].input);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(url.origin, 'https://api.binance.com');
  assert.equal(url.pathname, '/sapi/v1/account/apiRestrictions');
  assert.equal(url.searchParams.has('signature'), true);
  assert.equal(new Headers(requests[0].init.headers).get('x-mbx-apikey'), CREDS.apiKey);
  assert.equal(result.enableReading, true);
  assert.equal(JSON.stringify(result).includes(CREDS.apiKey), false);
  assert.equal(JSON.stringify(result).includes(CREDS.apiSecret), false);

  const failing = new BinancePrivateReadClient(CREDS, {
    fetch: async () => jsonResponse({
      code: -2015,
      msg: `${CREDS.apiKey} ${CREDS.apiSecret} signature=raw`,
    }, 401),
    now: () => NOW,
  });
  await assert.rejects(
    failing.apiRestrictions(),
    (error) => {
      assert.equal(error.message, 'Binance HTTP 401');
      assert.equal(error.message.includes(CREDS.apiKey), false);
      assert.equal(error.message.includes(CREDS.apiSecret), false);
      return true;
    },
  );
});

test('keyless service is explicitly NOT_CONFIGURED and performs no provider call', async () => {
  const service = new PrivateReadService(null, {
    now: () => NOW,
    keyLabel: 'owner read key',
  });
  const before = service.snapshot();
  const after = await service.refresh();

  assert.equal(after, before);
  assert.equal(after.state, 'NOT_CONFIGURED');
  assert.equal(after.permissionPosture.state, 'NOT_CONFIGURED');
  assert.equal(after.spot.balances, null);
  assert.equal(after.margin.assets, null);
  assert.equal(after.usdm.positions, null);
  assert.deepEqual(after.reconciliation.balances, {
    state: 'NOT_CONFIGURED',
    observedAt: null,
    reason: 'Private Binance credentials are not configured.',
  });
});

test('provider facts normalize into the frozen private-read contract without browser secrets', async () => {
  const service = new PrivateReadService(gateway(), {
    now: () => NOW,
    symbols: ['BTCUSDT'],
    keyLabel: 'owner read key',
    keyLast4: '1234',
  });
  const snapshot = await service.refresh();

  assert.deepEqual(Object.keys(snapshot), [
    'schemaVersion',
    'state',
    'observedAt',
    'permissionPosture',
    'spot',
    'margin',
    'usdm',
    'reconciliation',
  ]);
  assert.equal(snapshot.schemaVersion, 'binance.private-read.v1');
  assert.equal(snapshot.state, 'PARTIAL');
  assert.equal(snapshot.observedAt, NOW);
  assert.equal(snapshot.permissionPosture.state, 'VERIFIED_READ_ONLY');
  assert.equal(snapshot.permissionPosture.ipRestricted, true);
  assert.equal(snapshot.permissionPosture.keyLabel, 'owner read key');
  assert.equal(snapshot.permissionPosture.keyLast4, '1234');
  assert.equal('ips' in snapshot.permissionPosture, false, 'Binance exposes only ipRestrict, not whitelist members');
  assert.deepEqual(snapshot.spot.balances, [{
    asset: 'BTC',
    free: '0.10000000',
    locked: '0.01000000',
  }]);
  assert.equal(snapshot.spot.openOrders[0].orderId, '101');
  assert.equal('clientOrderId' in snapshot.spot.openOrders[0], false);
  assert.equal(snapshot.margin.totalLiabilityBtc, '0.01000000');
  assert.equal(snapshot.margin.assets[0].borrowed, '100.00000000');
  assert.equal(snapshot.margin.assets[0].interest, '0.10000000');
  assert.equal(snapshot.usdm.balances[0].availableBalance, '1900.00000000');
  assert.equal(snapshot.usdm.positions[0].positionAmt, '-0.010');
  assert.equal(snapshot.usdm.openOrders[0].reduceOnly, true);
  assert.equal(snapshot.usdm.fills[0].realizedPnl, '1.50000000');
  assert.deepEqual(snapshot.spot.coverage, {
    state: 'PARTIAL_SYMBOL_SCOPED',
    symbols: ['BTCUSDT'],
    limitation: 'History is limited to the configured symbol scope; Binance does not provide account-wide trade history.',
  });
  assert.equal(snapshot.reconciliation.balances.state, 'RECONCILED');
  assert.equal(snapshot.reconciliation.orders.state, 'RECONCILED');
  assert.equal(snapshot.reconciliation.fills.state, 'PARTIAL');
  assert.equal(snapshot.reconciliation.positions.state, 'RECONCILED');
  assert.equal(snapshot.reconciliation.liabilities.state, 'RECONCILED');
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(CREDS.apiKey), false);
  assert.equal(serialized.includes(CREDS.apiSecret), false);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.usdm.positions), true);
});

test('every dangerous permission bit is UNSAFE and every missing required bit is UNKNOWN', async () => {
  const unsafeCases = [
    ['enableReading', false],
    ['ipRestrict', false],
    ['enableWithdrawals', true],
    ['enableInternalTransfer', true],
    ['enableMargin', true],
    ['enableFutures', true],
    ['permitsUniversalTransfer', true],
    ['enableVanillaOptions', true],
    ['enableFixApiTrade', true],
    ['enableSpotAndMarginTrading', true],
    ['enablePortfolioMarginTrading', true],
  ];
  for (const [field, value] of unsafeCases) {
    const service = new PrivateReadService(gateway({
      apiRestrictions: async () => ({ ...PERMISSIONS, [field]: value }),
    }), { now: () => NOW, symbols: ['BTCUSDT'] });
    assert.equal((await service.refresh()).permissionPosture.state, 'UNSAFE', field);
  }

  for (const missingField of unsafeCases.map(([field]) => field)) {
    const incomplete = { ...PERMISSIONS };
    delete incomplete[missingField];
    const service = new PrivateReadService(gateway({
      apiRestrictions: async () => incomplete,
    }), { now: () => NOW, symbols: ['BTCUSDT'] });
    const posture = (await service.refresh()).permissionPosture;
    assert.equal(posture.state, 'UNKNOWN', missingField);
    assert.equal(posture.observedAt, null);
    assert.equal(posture.reading, null);
  }
});

test('failed and malformed provider endpoints publish null/UNAVAILABLE instead of empty facts', async () => {
  const service = new PrivateReadService(gateway({
    marginAccount: async () => { throw new Error('upstream signed url must never escape'); },
    usdmPositions: async () => [{ symbol: 'BTCUSDT' }],
    usdmTrades: async () => { throw new Error('history unavailable'); },
  }), {
    now: () => NOW,
    symbols: ['BTCUSDT'],
  });
  const snapshot = await service.refresh();

  assert.equal(snapshot.margin.assets, null);
  assert.equal(snapshot.margin.totalLiabilityBtc, null);
  assert.equal(snapshot.margin.state, 'PARTIAL');
  assert.equal(snapshot.usdm.positions, null);
  assert.equal(snapshot.usdm.fills, null);
  assert.equal(snapshot.usdm.coverage.state, 'UNAVAILABLE');
  assert.equal(snapshot.reconciliation.positions.state, 'UNAVAILABLE');
  assert.equal(snapshot.reconciliation.liabilities.state, 'UNAVAILABLE');
  assert.equal(snapshot.reconciliation.balances.state, 'PARTIAL');
});

test('refreshes do not overlap and exact observedAt comes from the injected clock', async () => {
  let release;
  let calls = 0;
  const blocked = new Promise((resolve) => { release = resolve; });
  const service = new PrivateReadService(gateway({
    apiRestrictions: async () => {
      calls += 1;
      await blocked;
      return { ...PERMISSIONS };
    },
  }), { now: () => NOW, symbols: ['BTCUSDT'] });

  const first = service.refresh();
  const second = service.refresh();
  assert.equal(first, second);
  release();
  const snapshot = await first;
  assert.equal(calls, 1);
  assert.equal(snapshot.observedAt, NOW);
});

test('HTTP mutation routes remain local 410 guards and the credentialed client is not passed to mutation services', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(source, /const client = unavailablePrivateBinanceClient\(\);/);
  assert.match(source, /new OrderService\(\s*client,/s);
  assert.doesNotMatch(source, /new OrderService\(\s*privateReadClient,/s);
  for (const operation of [
    'LOAN_BORROW',
    'LOAN_ADJUST_LTV',
    'LOAN_REPAY',
    'ORDER_CANCEL_ALL',
    'LIVE_TRADING_ARM',
    'TEST_ORDER',
    'LIVE_ORDER_SEND',
    'ORDER_CANCEL',
  ]) {
    assert.match(source, new RegExp(`sendLiveExecutionNotImplemented\\(res, '${operation}'\\)`));
  }
});
