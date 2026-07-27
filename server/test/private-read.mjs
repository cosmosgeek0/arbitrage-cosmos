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
    // GET /fapi/v3/positionRisk as Binance actually answers it: no leverage
    // and no marginType. Those were removed in V3.
    usdmPositions: async () => [{
      symbol: 'BTCUSDT',
      positionSide: 'BOTH',
      positionAmt: '-0.010',
      entryPrice: '60000.000',
      breakEvenPrice: '59970.000',
      markPrice: '59000.000',
      unRealizedProfit: '10.00000000',
      liquidationPrice: '0',
      isolatedMargin: '0',
      notional: '-590.00000000',
      marginAsset: 'USDT',
      isolatedWallet: '0',
      initialMargin: '0',
      maintMargin: '0',
      positionInitialMargin: '0',
      openOrderInitialMargin: '0',
      adl: 1,
      bidNotional: '0',
      askNotional: '0',
      updateTime: NOW - 250,
    }],
    usdmOpenOrders: async () => [{ ...USDM_ORDER }],
    usdmTrades: async () => [{ ...USDM_FILL }],
    ...overrides,
  };
}

/**
 * Wraps a gateway so a test can prove which private endpoints a refresh
 * actually reached, in order. Sequencing is a safety property here, not an
 * implementation detail: the count is the evidence.
 */
function recordingGateway(overrides = {}) {
  const calls = [];
  const wrapped = {};
  for (const [name, read] of Object.entries(gateway(overrides))) {
    wrapped[name] = async (...args) => {
      calls.push(name);
      return read(...args);
    };
  }
  return { gateway: wrapped, calls };
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
  assert.equal(snapshot.usdm.positions[0].leverage, null, 'V3 does not return leverage');
  assert.equal(snapshot.usdm.positions[0].marginType, null, 'V3 does not return marginType');
  assert.equal(snapshot.usdm.openOrders[0].reduceOnly, true);
  assert.equal(snapshot.usdm.fills[0].realizedPnl, '1.50000000');
  assert.deepEqual(snapshot.spot.coverage, {
    state: 'PARTIAL_SYMBOL_SCOPED',
    symbols: ['BTCUSDT'],
    limitation: 'History is limited to the configured symbol scope; Binance does not provide account-wide trade history.',
  });
  assert.equal(snapshot.permissionPosture.vanillaOptions, false, 'every admitted flag is carried');
  assert.equal(snapshot.permissionPosture.fixReadOnly, false, 'the read-only permission is carried');
  // A successful read is not a reconciliation. Every family whose second side
  // this service does not compute reports PARTIAL and says why.
  for (const family of ['balances', 'orders', 'fills', 'positions']) {
    const entry = snapshot.reconciliation[family];
    assert.equal(entry.state, 'PARTIAL', family);
    assert.equal(typeof entry.reason, 'string', family);
    assert.ok(entry.reason.length > 0, family);
  }
  assert.match(
    snapshot.reconciliation.positions.reason,
    /provider-reported/,
    'a non-null position read is not a recomputed position',
  );
  // Totals balance and the rows agree a liability is open, but converting it to
  // BTC needs a price this service does not read.
  assert.equal(snapshot.reconciliation.liabilities.state, 'PARTIAL');
  assert.match(snapshot.reconciliation.liabilities.reason, /price source/);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(CREDS.apiKey), false);
  assert.equal(serialized.includes(CREDS.apiSecret), false);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.usdm.positions), true);
});

test('a refresh asks for permissions first and reaches no other private endpoint until admitted', async () => {
  const admitted = recordingGateway();
  const service = new PrivateReadService(admitted.gateway, { now: () => NOW, symbols: ['BTCUSDT'] });
  await service.refresh();
  assert.equal(admitted.calls[0], 'apiRestrictions', 'permissions are asked first');
  assert.equal(
    admitted.calls.filter((call) => call === 'apiRestrictions').length,
    1,
    'the permission answer is read once and reused, not re-fetched per family',
  );
  assert.ok(admitted.calls.includes('spotAccount'), 'a verified posture admits row reads');
});

test('an unsafe or unproven posture costs exactly one private call and exposes no row', async () => {
  const blocked = [
    ['an action permission is enabled', { ...PERMISSIONS, enableWithdrawals: true }, 'UNSAFE'],
    ['the key is not IP-pinned', { ...PERMISSIONS, ipRestrict: false }, 'UNSAFE'],
    ['a required flag is missing', (() => {
      const partial = { ...PERMISSIONS };
      delete partial.enableFutures;
      return partial;
    })(), 'UNKNOWN'],
    ['a required flag is the wrong type', { ...PERMISSIONS, enableMargin: 'false' }, 'UNKNOWN'],
    ['the answer carries an undocumented field', { ...PERMISSIONS, enableSpotTrading: true }, 'UNKNOWN'],
    ['the answer is not an object', ['enableReading'], 'UNKNOWN'],
    ['the permission read itself failed', null, 'UNKNOWN'],
  ];

  for (const [label, payload, expected] of blocked) {
    const recorded = recordingGateway({
      apiRestrictions: async () => {
        if (payload === null) throw new Error('signed url must never escape');
        return payload;
      },
    });
    const service = new PrivateReadService(recorded.gateway, { now: () => NOW, symbols: ['BTCUSDT'] });
    const snapshot = await service.refresh();

    assert.deepEqual(recorded.calls, ['apiRestrictions'], label);
    assert.equal(snapshot.permissionPosture.state, expected, label);
    assert.equal(snapshot.state, 'UNAVAILABLE', label);
    for (const product of ['spot', 'margin', 'usdm']) {
      assert.equal(snapshot[product].state, 'UNAVAILABLE', `${label}: ${product}`);
      assert.equal(snapshot[product].observedAt, null, `${label}: ${product}`);
    }
    assert.equal(snapshot.spot.balances, null, label);
    assert.equal(snapshot.spot.openOrders, null, label);
    assert.equal(snapshot.spot.fills, null, label);
    assert.equal(snapshot.margin.assets, null, label);
    assert.equal(snapshot.margin.totalLiabilityBtc, null, label);
    assert.equal(snapshot.usdm.balances, null, label);
    assert.equal(snapshot.usdm.positions, null, label);
    assert.equal(snapshot.usdm.openOrders, null, label);
    assert.equal(snapshot.usdm.fills, null, label);
    for (const family of Object.keys(snapshot.reconciliation)) {
      assert.equal(snapshot.reconciliation[family].state, 'UNAVAILABLE', `${label}: ${family}`);
      assert.match(snapshot.reconciliation[family].reason, /withheld/, `${label}: ${family}`);
    }
  }
});

test('a posture that decodes UNSAFE stays visible as UNSAFE and never degrades to safe', async () => {
  const service = new PrivateReadService(gateway({
    apiRestrictions: async () => ({ ...PERMISSIONS, enableFutures: true }),
  }), { now: () => NOW, symbols: ['BTCUSDT'] });
  const snapshot = await service.refresh();

  assert.equal(snapshot.permissionPosture.state, 'UNSAFE');
  assert.equal(snapshot.permissionPosture.futures, true, 'the observed breach is reported, not hidden');
  assert.equal(snapshot.permissionPosture.observedAt, NOW, 'an unsafe posture was genuinely observed');
  assert.equal(snapshot.permissionPosture.reading, true, 'the flags that were read are kept');

  // A later unreadable answer must not leave the previous flags standing.
  const stale = new PrivateReadService(gateway({
    apiRestrictions: async () => { throw new Error('transport failed'); },
  }), { now: () => NOW, symbols: ['BTCUSDT'] });
  const unknown = await stale.refresh();
  assert.equal(unknown.permissionPosture.state, 'UNKNOWN');
  assert.equal(unknown.permissionPosture.observedAt, null);
  for (const flag of [
    'reading', 'spotMarginTrading', 'margin', 'futures', 'withdrawals', 'internalTransfer',
    'universalTransfer', 'ipRestricted', 'vanillaOptions', 'fixTrade', 'fixReadOnly',
    'portfolioMarginTrading',
  ]) {
    assert.equal(unknown.permissionPosture[flag], null, flag);
  }
});

test('the read-only FIX permission is carried honestly and is never action authority', async () => {
  for (const value of [true, false]) {
    const service = new PrivateReadService(gateway({
      apiRestrictions: async () => ({ ...PERMISSIONS, enableFixReadOnly: value }),
    }), { now: () => NOW, symbols: ['BTCUSDT'] });
    const posture = (await service.refresh()).permissionPosture;
    assert.equal(posture.fixReadOnly, value, 'decoded end to end');
    assert.equal(posture.state, 'VERIFIED_READ_ONLY', 'a read-only permission never blocks admission');
  }

  for (const value of [undefined, null, 'false', 0]) {
    const incomplete = { ...PERMISSIONS, enableFixReadOnly: value };
    if (value === undefined) delete incomplete.enableFixReadOnly;
    const recorded = recordingGateway({
      apiRestrictions: async () => incomplete,
    });
    const service = new PrivateReadService(recorded.gateway, {
      now: () => NOW,
      symbols: ['BTCUSDT'],
    });
    const posture = (await service.refresh()).permissionPosture;
    assert.equal(posture.state, 'UNKNOWN', String(value));
    assert.deepEqual(recorded.calls, ['apiRestrictions'], 'an incomplete current flag admits no row reads');
  }
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
  assert.match(
    snapshot.reconciliation.balances.reason,
    /unavailable/,
    'a lost read is reported as a lost read, not as an unproven invariant',
  );
});

test('Cross Margin fixed-scale zero strings are numerically zero for liability selection', async () => {
  const marginAccount = (overrides = {}) => async () => ({
    totalAssetOfBtc: '0.20000000',
    totalLiabilityOfBtc: '0.00000000',
    totalNetAssetOfBtc: '0.20000000',
    userAssets: [{
      asset: 'USDT',
      free: '1000.00000000',
      locked: '0.00000000',
      borrowed: '0.00000000',
      interest: '-0.00000000',
      netAsset: '1000.00000000',
    }],
    ...overrides,
  });
  const refresh = (overrides) => new PrivateReadService(
    gateway({ marginAccount: marginAccount(overrides) }),
    { now: () => NOW, symbols: ['BTCUSDT'] },
  ).refresh();

  // Both sides computed and equal: no liability in the total, none in the rows.
  const flat = await refresh();
  assert.equal(flat.reconciliation.liabilities.state, 'RECONCILED');
  assert.equal(flat.reconciliation.liabilities.reason, null);
  assert.equal(flat.reconciliation.liabilities.observedAt, NOW);

  // Canonical negative zero is the same number and normalizes to one form.
  const negativeZero = await refresh({ totalLiabilityOfBtc: '-0.00000000' });
  assert.equal(negativeZero.reconciliation.liabilities.state, 'RECONCILED');
  assert.equal(negativeZero.margin.totalLiabilityBtc, '0.00000000', 'negative zero renders once');
  assert.equal(negativeZero.margin.assets[0].interest, '0.00000000');

  // One satoshi of borrow at the reported scale is a liability, not a zero.
  const borrowed = await refresh({
    userAssets: [{
      asset: 'USDT',
      free: '1000.00000000',
      locked: '0.00000000',
      borrowed: '0.00000001',
      interest: '0.00000000',
      netAsset: '999.99999999',
    }],
  });
  assert.equal(borrowed.reconciliation.liabilities.state, 'PARTIAL');
  assert.match(borrowed.reconciliation.liabilities.reason, /Total liability is zero while an asset row carries/);

  // Accrued interest alone is a liability even with nothing borrowed.
  const interestOnly = await refresh({
    totalLiabilityOfBtc: '0.00000001',
    totalNetAssetOfBtc: '0.19999999',
    userAssets: [{
      asset: 'USDT',
      free: '1000.00000000',
      locked: '0.00000000',
      borrowed: '0.00000000',
      interest: '0.00000002',
      netAsset: '999.99999998',
    }],
  });
  assert.equal(interestOnly.reconciliation.liabilities.state, 'PARTIAL');
  assert.match(interestOnly.reconciliation.liabilities.reason, /price source/);

  // A total that no row explains is a disagreement, never a green reconcile.
  const unexplained = await refresh({
    totalLiabilityOfBtc: '0.01000000',
    totalNetAssetOfBtc: '0.19000000',
  });
  assert.equal(unexplained.reconciliation.liabilities.state, 'PARTIAL');
  assert.match(unexplained.reconciliation.liabilities.reason, /no asset row carries borrowed or interest/);

  // Totals that do not satisfy net = asset - liability are never RECONCILED.
  const inconsistent = await refresh({ totalNetAssetOfBtc: '0.19999999' });
  assert.equal(inconsistent.reconciliation.liabilities.state, 'PARTIAL');
  assert.match(inconsistent.reconciliation.liabilities.reason, /net = asset - liability/);

  // Scales may differ between the reported totals; equality stays exact.
  const mixedScale = await refresh({
    totalAssetOfBtc: '0.2',
    totalLiabilityOfBtc: '0',
    totalNetAssetOfBtc: '0.20000000',
  });
  assert.equal(mixedScale.reconciliation.liabilities.state, 'RECONCILED');
});

test('malformed decimals are rejected strictly rather than coerced to zero', async () => {
  for (const malformed of [
    '', ' 0.1', '0.1 ', '+1.0', '.5', '1.', '00.1', '1e3', '1_000', '1,000.00',
    'NaN', 'Infinity', '-', '0x10', '٠.١', '0.1\n', 100, null, true,
    `1${'0'.repeat(40)}.0`,
  ]) {
    const service = new PrivateReadService(gateway({
      marginAccount: async () => ({
        totalAssetOfBtc: '0.20000000',
        totalLiabilityOfBtc: '0.00000000',
        totalNetAssetOfBtc: '0.20000000',
        userAssets: [{
          asset: 'USDT',
          free: '1000.00000000',
          locked: '0.00000000',
          borrowed: malformed,
          interest: '0.00000000',
          netAsset: '1000.00000000',
        }],
      }),
    }), { now: () => NOW, symbols: ['BTCUSDT'] });
    const snapshot = await service.refresh();

    assert.equal(snapshot.margin.assets, null, JSON.stringify(malformed));
    assert.equal(snapshot.margin.totalLiabilityBtc, null, JSON.stringify(malformed));
    assert.equal(
      snapshot.reconciliation.liabilities.state,
      'UNAVAILABLE',
      'an unreadable liability row is unavailable, never a zero liability',
    );
  }
});

test('non-finite refresh intervals use the bounded default', async (t) => {
  const intervals = [];
  const cleared = [];
  let unrefs = 0;
  t.mock.method(globalThis, 'setInterval', (_callback, delay) => {
    const handle = {
      unref() {
        unrefs += 1;
        return handle;
      },
    };
    intervals.push(delay);
    return handle;
  });
  t.mock.method(globalThis, 'clearInterval', (handle) => {
    cleared.push(handle);
  });

  for (const refreshIntervalMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const service = new PrivateReadService(gateway({
      apiRestrictions: async () => ({ ...PERMISSIONS, enableWithdrawals: true }),
    }), { now: () => NOW, refreshIntervalMs });
    service.start();
    service.stop();
  }
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(intervals, [30_000, 30_000, 30_000]);
  assert.equal(unrefs, 3);
  assert.equal(cleared.length, 3);
});

test('duplicate start schedules once and duplicate stop clears once', async (t) => {
  let permissionReads = 0;
  let schedules = 0;
  let clears = 0;
  let unrefs = 0;
  const handle = {
    unref() {
      unrefs += 1;
      return handle;
    },
  };
  t.mock.method(globalThis, 'setInterval', () => {
    schedules += 1;
    return handle;
  });
  t.mock.method(globalThis, 'clearInterval', (current) => {
    assert.equal(current, handle);
    clears += 1;
  });
  const service = new PrivateReadService(gateway({
    apiRestrictions: async () => {
      permissionReads += 1;
      return { ...PERMISSIONS, enableWithdrawals: true };
    },
  }), { now: () => NOW });

  service.start();
  service.start();
  assert.equal(permissionReads, 1, 'duplicate start joins the immediate refresh');
  assert.equal(schedules, 1);
  assert.equal(unrefs, 1);

  service.stop();
  service.stop();
  assert.equal(clears, 1);
  await new Promise((resolve) => setImmediate(resolve));
});

test('stop fences an in-flight publication and queues one explicit post-stop refresh', async () => {
  let release;
  let permissionReads = 0;
  const blocked = new Promise((resolve) => { release = resolve; });
  const service = new PrivateReadService(gateway({
    apiRestrictions: async () => {
      permissionReads += 1;
      await blocked;
      return { ...PERMISSIONS };
    },
  }), { now: () => NOW, symbols: ['BTCUSDT'] });
  const before = service.snapshot();

  const startedBeforeStop = service.refresh();
  service.stop();
  const refreshedAfterStop = service.refresh();
  assert.equal(
    service.refresh(),
    refreshedAfterStop,
    'post-stop callers share the one queued current-generation refresh',
  );
  release();

  assert.equal(await startedBeforeStop, before, 'the stopped generation resolves to the published snapshot');
  assert.equal(service.snapshot(), before, 'the stopped generation cannot replace owner-visible state');

  const refreshed = await refreshedAfterStop;
  assert.notEqual(refreshed, before);
  assert.equal(service.snapshot(), refreshed);
  assert.equal(refreshed.permissionPosture.state, 'VERIFIED_READ_ONLY');
  assert.equal(permissionReads, 2, 'explicit refresh remains available after stop');
});

test('a queued refresh superseded by another stop resolves without new transport', async () => {
  let release;
  let permissionReads = 0;
  const blocked = new Promise((resolve) => { release = resolve; });
  const service = new PrivateReadService(gateway({
    apiRestrictions: async () => {
      permissionReads += 1;
      await blocked;
      return { ...PERMISSIONS };
    },
  }), { now: () => NOW, symbols: ['BTCUSDT'] });
  const before = service.snapshot();

  const fenced = service.refresh();
  service.stop();
  const queued = service.refresh();
  assert.equal(service.refresh(), queued);
  service.stop();
  release();

  assert.equal(await fenced, before);
  assert.equal(await queued, before);
  assert.equal(permissionReads, 1, 'superseded queued work spends no private call');
  assert.equal(service.snapshot(), before);

  const requested = await service.refresh();
  assert.equal(permissionReads, 2);
  assert.notEqual(requested, before);
  assert.equal(service.snapshot(), requested);
});

test('restart behind a stopped in-flight read schedules one current-generation refresh', async () => {
  let release;
  let permissionReads = 0;
  const blocked = new Promise((resolve) => { release = resolve; });
  const service = new PrivateReadService(gateway({
    apiRestrictions: async () => {
      permissionReads += 1;
      if (permissionReads === 1) await blocked;
      return { ...PERMISSIONS, enableWithdrawals: true };
    },
  }), { now: () => NOW });
  const before = service.snapshot();

  const stoppedGeneration = service.refresh();
  service.stop();
  service.start();
  const restarted = service.refresh();
  assert.equal(permissionReads, 1, 'restart joins the one existing transport read');
  release();
  assert.equal(await stoppedGeneration, before);

  const refreshed = await restarted;
  assert.equal(permissionReads, 2, 'restart follows the fenced read with exactly one current read');
  assert.notEqual(refreshed, before);
  assert.equal(service.snapshot(), refreshed);
  assert.equal(refreshed.permissionPosture.state, 'UNSAFE');
  service.stop();
});

test('refresh preserves the same promise while one read is in flight and uses the injected clock', async () => {
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
