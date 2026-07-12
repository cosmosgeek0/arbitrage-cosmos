import assert from 'node:assert/strict';
import test from 'node:test';

import {
  L05_BINANCE_MATRIX_SHA256,
  L05_PRIVATE_FACT_SCHEMA,
  L05_PRIVATE_FACT_SCHEMA_REVISIONS,
  L05_PRIVATE_GAP_SOURCE_ID,
  PRIVATE_DATA_BOUNDS,
  PRIVATE_FACT_CONTRACT_POLICY,
  normalizePrivateFactEvidence,
  resolvePrivateFactContract,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/index.js';

const T0 = 1_800_000_000_000;
const MAX_AGE_MS = 60_000;

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
}

function assertNoAuthority(fact) {
  assert.equal(fact.sendEligible, false);
  assert.equal(fact.accountReadAuthority, 'NONE');
  assert.equal(fact.mutationAuthority, 'NONE');
  assert.equal(fact.reconciliationAuthority, 'NONE');
  assert.equal(fact.capitalAuthority, 'NONE');
  assert.equal(fact.riskAuthority, 'NONE');
  assert.equal(fact.externalActionAuthorization, 'NONE');
  assert.equal(fact.actionAuthority, 'NONE_RECORD_ONLY');
}

function queryMetadata(kind, isGap = false) {
  if (isGap) {
    return { queryScope: 'ACCOUNT_WIDE', querySymbol: null, queryAsset: null, queryType: null, marginMode: null };
  }
  if (['SPOT_OPEN_ORDERS', 'USDM_OPEN_ORDERS'].includes(kind)) {
    return { queryScope: 'ALL_SYMBOLS', querySymbol: null, queryAsset: null, queryType: null, marginMode: null };
  }
  if (kind === 'MARGIN_OPEN_ORDERS') {
    return { queryScope: 'ALL_SYMBOLS', querySymbol: null, queryAsset: null, queryType: null, marginMode: 'CROSS' };
  }
  if (['SPOT_TRADES', 'SPOT_COMMISSIONS', 'USDM_TRADES'].includes(kind)) {
    return { queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', queryAsset: null, queryType: null, marginMode: null };
  }
  if (kind === 'MARGIN_TRADES') {
    return { queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', queryAsset: null, queryType: null, marginMode: 'CROSS' };
  }
  if (kind === 'MARGIN_INTEREST_RATE') {
    return { queryScope: 'ACCOUNT_WIDE', querySymbol: null, queryAsset: 'USDT', queryType: null, marginMode: null };
  }
  if (kind === 'MARGIN_INVENTORY') {
    return { queryScope: 'ACCOUNT_WIDE', querySymbol: null, queryAsset: null, queryType: 'MARGIN', marginMode: null };
  }
  if (kind === 'MARGIN_INTEREST') {
    return { queryScope: 'ACCOUNT_WIDE', querySymbol: null, queryAsset: null, queryType: null, marginMode: 'CROSS' };
  }
  return { queryScope: 'ACCOUNT_WIDE', querySymbol: null, queryAsset: null, queryType: null, marginMode: null };
}

const EMPTY_COVERAGE = Object.freeze({
  omitZeroBalances: null, startTimeMs: null, endTimeMs: null, limit: null,
  orderId: null, fromId: null, cursor: null, page: null, size: null,
  vipLevel: null, isolatedSymbol: null,
});

function queryCoverage(kind, isGap = false) {
  if (isGap) return { kind: 'UNAVAILABLE_GAP', ...EMPTY_COVERAGE };
  if (kind === 'SPOT_ACCOUNT') {
    return { kind: 'CURRENT_UNFILTERED', ...EMPTY_COVERAGE, omitZeroBalances: false };
  }
  if (['SPOT_TRADES', 'USDM_TRADES', 'MARGIN_TRADES'].includes(kind)) {
    return {
      kind: 'HISTORY_EXPLICIT_WINDOW', ...EMPTY_COVERAGE,
      startTimeMs: T0 - 60_000, endTimeMs: T0, limit: 1_000,
    };
  }
  if (kind === 'MARGIN_INTEREST') {
    return {
      kind: 'HISTORY_EXPLICIT_WINDOW', ...EMPTY_COVERAGE,
      startTimeMs: T0 - 60_000, endTimeMs: T0, page: 1, size: 100,
    };
  }
  if (kind === 'MARGIN_INTEREST_RATE') {
    return {
      kind: 'HISTORY_EXPLICIT_WINDOW', ...EMPTY_COVERAGE,
      startTimeMs: T0 - 60_000, endTimeMs: T0,
    };
  }
  return { kind: 'CURRENT_UNFILTERED', ...EMPTY_COVERAGE };
}

function receiptId(kind, gap = false) {
  const index = Object.keys(L05_PRIVATE_FACT_SCHEMA_REVISIONS).indexOf(kind) + 1 + (gap ? 128 : 0);
  return `private-receipt:${index.toString(16).padStart(24, '0')}`;
}

function currentEvidence(kind, value, overrides = {}) {
  const policy = PRIVATE_FACT_CONTRACT_POLICY[kind];
  assert.ok(policy);
  assert.notEqual(policy.contractId, null);
  const resolution = resolvePrivateFactContract(kind, L05_BINANCE_MATRIX_SHA256, policy.contractId);
  assert.ok(resolution.contract);
  return {
    schema: L05_PRIVATE_FACT_SCHEMA,
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    factKind: kind,
    product: policy.product,
    environment: 'PRODUCTION',
    realm: resolution.contract.realm,
    accountRealmId: 'account.prod.1',
    profileId: 'profile.read.1',
    contractId: policy.contractId,
    ...queryMetadata(kind),
    queryCoverage: queryCoverage(kind),
    sourceId: resolution.contract.sourceIds[0],
    schemaRevision: L05_PRIVATE_FACT_SCHEMA_REVISIONS[kind],
    receiptId: receiptId(kind),
    readState: 'OK',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs: T0,
    receivedAtMs: T0 + 10,
    maxAgeMs: MAX_AGE_MS,
    value,
    ...overrides,
  };
}

function gapEvidence(kind) {
  const policy = PRIVATE_FACT_CONTRACT_POLICY[kind];
  assert.ok(policy);
  assert.equal(policy.contractId, null);
  return {
    schema: L05_PRIVATE_FACT_SCHEMA,
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    factKind: kind,
    product: policy.product,
    environment: 'PRODUCTION',
    realm: policy.product === 'MARGIN' ? 'PRIVATE_MARGIN_ACCOUNT' : 'PRIVATE_ACCOUNT',
    accountRealmId: 'account.prod.1',
    profileId: null,
    contractId: null,
    ...queryMetadata(kind, true),
    queryCoverage: queryCoverage(kind, true),
    sourceId: L05_PRIVATE_GAP_SOURCE_ID,
    schemaRevision: L05_PRIVATE_FACT_SCHEMA_REVISIONS[kind],
    receiptId: receiptId(kind, true),
    readState: 'UNAVAILABLE',
    authority: 'UNAVAILABLE',
    completeness: 'UNAVAILABLE',
    sourceTimeMs: null,
    receivedAtMs: T0,
    maxAgeMs: MAX_AGE_MS,
    value: null,
  };
}

function normalize(kind, value, overrides = {}) {
  return normalizePrivateFactEvidence(currentEvidence(kind, value, overrides), T0 + 20);
}

function usdmBalance(overrides = {}) {
  return {
    accountAlias: 'SYNTH1',
    asset: 'USDT',
    balance: '0010.50000000',
    crossWalletBalance: '0008.25000000',
    crossUnPnl: '-0.12500000',
    availableBalance: '0007.50000000',
    maxWithdrawAmount: '0007.50000000',
    marginAvailable: null,
    updateTime: T0,
    ...overrides,
  };
}

function usdmPosition(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    positionSide: 'BOTH',
    positionAmt: '-0.01000000',
    entryPrice: '60000.00000000',
    breakEvenPrice: '60010.00000000',
    markPrice: '59900.00000000',
    unRealizedProfit: '-1.00000000',
    liquidationPrice: '0.00000000',
    isolatedMargin: '0.00000000',
    notional: '-599.00000000',
    marginAsset: 'USDT',
    isolatedWallet: '0.00000000',
    initialMargin: '60.00000000',
    maintMargin: '3.00000000',
    positionInitialMargin: '60.00000000',
    openOrderInitialMargin: '0.00000000',
    adl: 2,
    bidNotional: '0.00000000',
    askNotional: '0.00000000',
    updateTime: T0,
    ...overrides,
  };
}

function usdmOrder(overrides = {}) {
  return {
    avgPrice: '0.00000',
    clientOrderId: 'synthetic-usdm-order-1',
    cumQuote: '0.00000000',
    executedQty: '0.00000000',
    orderId: 101,
    origQty: '0.01000000',
    origType: 'LIMIT',
    price: '59000.00000000',
    reduceOnly: false,
    side: 'BUY',
    positionSide: 'BOTH',
    status: 'NEW',
    stopPrice: '0.00000000',
    closePosition: false,
    symbol: 'BTCUSDT',
    time: T0 - 1_000,
    timeInForce: 'GTC',
    type: 'LIMIT',
    activatePrice: '0.00000000',
    priceRate: '0.00000000',
    updateTime: T0,
    workingType: 'CONTRACT_PRICE',
    priceProtect: false,
    priceMatch: 'NONE',
    selfTradePreventionMode: 'NONE',
    goodTillDate: 0,
    ...overrides,
  };
}

function usdmTrade(overrides = {}) {
  return {
    buyer: true,
    commission: '0.01000000',
    commissionAsset: 'USDT',
    id: 201,
    maker: false,
    orderId: 101,
    price: '60000.00000000',
    qty: '0.01000000',
    quoteQty: '600.00000000',
    realizedPnl: '-0.50000000',
    side: 'BUY',
    positionSide: 'BOTH',
    symbol: 'BTCUSDT',
    time: T0,
    ...overrides,
  };
}

function marginAsset(overrides = {}) {
  return {
    asset: 'USDT',
    borrowed: '001.25000000',
    free: '010.00000000',
    interest: '0.02500000',
    locked: '0.00000000',
    netAsset: '8.72500000',
    ...overrides,
  };
}

function marginCross(overrides = {}) {
  return {
    created: true,
    borrowEnabled: true,
    marginLevel: '7.00000000',
    collateralMarginLevel: '6.50000000',
    totalAssetOfBtc: '0.00100000',
    totalLiabilityOfBtc: '0.00010000',
    totalNetAssetOfBtc: '0.00090000',
    TotalCollateralValueInUSDT: '10.00000000',
    totalOpenOrderLossInUSDT: '0.00000000',
    tradeEnabled: true,
    transferInEnabled: true,
    transferOutEnabled: false,
    accountType: 'MARGIN_1',
    userAssets: [marginAsset()],
    ...overrides,
  };
}

function marginOrder(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    orderId: 301,
    clientOrderId: 'synthetic-margin-order-1',
    price: '59000.00000000',
    origQty: '0.01000000',
    executedQty: '0.00000000',
    cummulativeQuoteQty: '0.00000000',
    status: 'NEW',
    timeInForce: 'GTC',
    type: 'LIMIT',
    side: 'BUY',
    stopPrice: '0.00000000',
    icebergQty: '0.00000000',
    time: T0 - 1_000,
    updateTime: T0,
    isWorking: true,
    isIsolated: false,
    selfTradePreventionMode: 'NONE',
    ...overrides,
  };
}

function marginTrade(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    id: 401,
    orderId: 301,
    price: '60000.00000000',
    qty: '0.01000000',
    commission: '0.01000000',
    commissionAsset: 'USDT',
    time: T0,
    isBuyer: true,
    isMaker: false,
    isBestMatch: true,
    isIsolated: false,
    ...overrides,
  };
}

function marginInterestRow(overrides = {}) {
  return {
    asset: 'USDT',
    rawAsset: 'LDUSDT',
    interest: '0.02500000',
    interestAccuredTime: T0,
    interestRate: '0.00010000',
    principal: '0.00000000',
    type: 'PERIODIC',
    isolatedSymbol: '',
    txId: 501,
    ...overrides,
  };
}

function marginRate(overrides = {}) {
  return {
    asset: 'USDT',
    dailyInterestRate: '0.00020000',
    timestamp: T0,
    vipLevel: 1,
    ...overrides,
  };
}

test('non-empty official-shaped USD-M balance and position facts preserve exact signed, zero, and unknown truth', () => {
  const balances = normalize('USDM_BALANCE', [usdmBalance()]);
  assert.deepEqual(balances.value, [{
    accountAlias: 'SYNTH1',
    asset: 'USDT',
    balance: '10.5',
    crossWalletBalance: '8.25',
    crossUnPnl: '-0.125',
    availableBalance: '7.5',
    maxWithdrawAmount: '7.5',
    marginAvailable: null,
    updateTime: T0,
  }]);
  assert.equal(balances.injectedValue[0].balance, '0010.50000000');
  assert.equal(balances.validUntilMs, T0 + MAX_AGE_MS);

  const positions = normalize('USDM_POSITIONS', [usdmPosition()]);
  assert.equal(positions.value[0].positionAmt, '-0.01');
  assert.equal(positions.value[0].unRealizedProfit, '-1');
  assert.equal(positions.value[0].notional, '-599');
  assert.equal(positions.value[0].liquidationPrice, '0');
  assert.equal(positions.value[0].openOrderInitialMargin, '0');
  for (const fact of [balances, positions]) {
    assert.equal(fact.usableAsPrivateEvidence, true);
    assertNoAuthority(fact);
    assertDeeplyFrozen(fact);
  }
});

test('USD-M and Margin current rows cannot postdate their private fact cut', () => {
  for (const [kind, value] of [
    ['USDM_BALANCE', [usdmBalance({ updateTime: T0 + 10_000 })]],
    ['USDM_POSITIONS', [usdmPosition({ updateTime: T0 + 10_000 })]],
    ['USDM_OPEN_ORDERS', [usdmOrder({ updateTime: T0 + 10_000 })]],
    ['MARGIN_OPEN_ORDERS', [marginOrder({ updateTime: T0 + 10_000 })]],
  ]) {
    assert.throws(
      () => normalize(kind, value),
      /after the current private source cut|locally available before its receipt|evaluation cut/i,
    );
  }
});

test('non-empty current USD-M open-order and trade shapes normalize exact decimals', () => {
  const orders = normalize('USDM_OPEN_ORDERS', [usdmOrder()]);
  assert.equal(orders.value[0].orderId, '101');
  assert.equal(orders.value[0].price, '59000');
  assert.equal(orders.value[0].activatePrice, '0');
  assert.equal(orders.value[0].priceRate, '0');
  assert.equal(orders.value[0].goodTillDate, 0);
  const trades = normalize('USDM_TRADES', [usdmTrade()]);
  assert.equal(trades.value[0].id, '201');
  assert.equal(trades.value[0].quoteQty, '600');
  assert.equal(trades.value[0].realizedPnl, '-0.5');
  for (const fact of [orders, trades]) {
    assert.equal(fact.usableAsPrivateEvidence, true);
    assertNoAuthority(fact);
    assertDeeplyFrozen(fact);
  }
});

test('USD-M current open orders close active enums and official field relationships', () => {
  const exotic = normalize('USDM_OPEN_ORDERS', [
    usdmOrder({
      orderId: 102,
      clientOrderId: 'synthetic-usdm-order-2',
      price: '0',
      timeInForce: 'GTD',
      goodTillDate: T0 + 60_000,
      priceMatch: 'OPPONENT_5',
      selfTradePreventionMode: 'EXPIRE_BOTH',
    }),
    usdmOrder({
      orderId: 103,
      clientOrderId: 'synthetic-usdm-order-3',
      origType: 'TRAILING_STOP_MARKET',
      type: 'TRAILING_STOP_MARKET',
      price: '0',
      origQty: '0.01',
      activatePrice: '60000',
      priceRate: '0.2',
    }),
  ]);
  assert.deepEqual(exotic.value.map((row) => row.type), ['LIMIT', 'TRAILING_STOP_MARKET']);
  assert.equal(exotic.value[0].goodTillDate, T0 + 60_000);
  assert.equal(exotic.value[1].activatePrice, '60000');

  const invalid = [
    { status: 'FILLED' },
    { status: 'PENDING_NEW' },
    { type: 'FABRICATED', origType: 'FABRICATED' },
    { origType: 'MARKET' },
    { timeInForce: 'FABRICATED' },
    { workingType: 'FABRICATED' },
    { priceMatch: 'FABRICATED' },
    { selfTradePreventionMode: 'FABRICATED' },
    { timeInForce: 'GTD', goodTillDate: 0 },
    { goodTillDate: T0 + 60_000 },
    { type: 'STOP', origType: 'STOP' },
    { stopPrice: '59000' },
    {
      type: 'TRAILING_STOP_MARKET', origType: 'TRAILING_STOP_MARKET',
      activatePrice: '60000', priceRate: '0',
    },
    { closePosition: true },
    { positionSide: 'LONG', reduceOnly: true },
    { priceProtect: true },
    { priceMatch: 'QUEUE', price: '59000' },
    { type: 'MARKET', origType: 'MARKET', timeInForce: 'IOC' },
  ];
  for (const mutation of invalid) {
    assert.throws(
      () => normalize('USDM_OPEN_ORDERS', [usdmOrder(mutation)]),
      TypeError,
    );
  }
});

test('non-empty Margin account assets preserve liabilities, interest, free, locked, and net truth', () => {
  const fact = normalize('MARGIN_CROSS_ACCOUNT', marginCross());
  assert.deepEqual(fact.value.userAssets, [{
    asset: 'USDT',
    borrowed: '1.25',
    free: '10',
    interest: '0.025',
    locked: '0',
    netAsset: '8.725',
  }]);
  assert.equal(fact.value.totalLiabilityOfBtc, '0.0001');
  assert.equal(fact.value.totalOpenOrderLossInUSDT, '0');
  assert.equal(fact.usableAsPrivateEvidence, true);
  assertNoAuthority(fact);
  assertDeeplyFrozen(fact);
});

test('Margin cross operational state blocks absent account, borrow, or trade capability', () => {
  const vectors = [
    ['created', false, 'MARGIN_CROSS_ACCOUNT_NOT_CREATED'],
    ['borrowEnabled', false, 'MARGIN_CROSS_BORROW_DISABLED'],
    ['tradeEnabled', false, 'MARGIN_CROSS_TRADE_DISABLED'],
  ];
  for (const [field, value, reason] of vectors) {
    const fact = normalize('MARGIN_CROSS_ACCOUNT', marginCross({ [field]: value }));
    assert.equal(fact.usableAsPrivateEvidence, false);
    assert.ok(fact.reasonCodes.includes(reason));
    assertNoAuthority(fact);
  }
});

test('non-empty Margin order, trade, interest, and rate facts remain independent exact evidence', () => {
  const order = normalize('MARGIN_OPEN_ORDERS', [marginOrder()]);
  const trade = normalize('MARGIN_TRADES', [marginTrade()]);
  const interest = normalize('MARGIN_INTEREST', { rows: [marginInterestRow()], total: 1 });
  const rate = normalize('MARGIN_INTEREST_RATE', [marginRate()]);

  assert.equal(order.value[0].orderId, '301');
  assert.equal(order.value[0].executedQty, '0');
  assert.equal(trade.value[0].id, '401');
  assert.equal(trade.value[0].commission, '0.01');
  assert.equal(Object.hasOwn(trade.value[0], 'quoteQty'), false);
  assert.equal(interest.value.rows[0].interest, '0.025');
  assert.equal(interest.value.rows[0].principal, '0');
  assert.equal(interest.value.rows[0].asset, 'USDT');
  assert.equal(interest.value.rows[0].rawAsset, 'LDUSDT');
  assert.equal(interest.value.rows[0].isolatedSymbol, null);
  assert.equal(interest.injectedValue.rows[0].isolatedSymbol, '');
  assert.equal(rate.value[0].dailyInterestRate, '0.0002');
  for (const fact of [order, trade, interest, rate]) {
    assert.equal(fact.usableAsPrivateEvidence, true);
    assertNoAuthority(fact);
    assertDeeplyFrozen(fact);
  }
});

test('Margin current open orders close active enums and conditional relationships', () => {
  const active = normalize('MARGIN_OPEN_ORDERS', [
    marginOrder({
      orderId: 302,
      clientOrderId: 'synthetic-margin-order-2',
      status: 'PENDING_NEW',
      type: 'MARKET',
      isWorking: false,
      selfTradePreventionMode: 'DECREMENT',
    }),
    marginOrder({
      orderId: 303,
      clientOrderId: 'synthetic-margin-order-3',
      type: 'STOP_LOSS_LIMIT',
      stopPrice: '58000',
      icebergQty: '0.001',
      selfTradePreventionMode: 'TRANSFER',
    }),
  ]);
  assert.deepEqual(active.value.map((row) => row.status), ['PENDING_NEW', 'NEW']);
  assert.equal(active.value[1].stopPrice, '58000');

  for (const mutation of [
    { status: 'FILLED' },
    { status: 'CANCELED' },
    { type: 'FABRICATED' },
    { timeInForce: 'GTX' },
    { selfTradePreventionMode: 'FABRICATED' },
    { status: 'PENDING_NEW', isWorking: true },
    { stopPrice: '58000' },
    { type: 'STOP_LOSS_LIMIT', stopPrice: '0' },
    { type: 'MARKET', timeInForce: 'IOC' },
    { type: 'MARKET', icebergQty: '0.001' },
    { icebergQty: '0.001', timeInForce: 'IOC' },
  ]) {
    assert.throws(
      () => normalize('MARGIN_OPEN_ORDERS', [marginOrder(mutation)]),
      TypeError,
    );
  }
});

test('Margin trade fields and interest types are closed to current official response truth', () => {
  assert.throws(
    () => normalize('MARGIN_TRADES', [marginTrade({ quoteQty: '600.00000000' })]),
    /exact fields/i,
  );

  const officialTypes = [
    'PERIODIC',
    'ON_BORROW',
    'PERIODIC_CONVERTED',
    'ON_BORROW_CONVERTED',
    'PORTFOLIO',
  ];
  const interest = normalize('MARGIN_INTEREST', {
    rows: officialTypes.map((type, index) => marginInterestRow({ type, txId: 501 + index })),
    total: officialTypes.length,
  });
  assert.deepEqual(interest.value.rows.map((row) => row.type), officialTypes);
  assert.equal(interest.usableAsPrivateEvidence, true);
  assert.throws(
    () => normalize('MARGIN_INTEREST', {
      rows: [marginInterestRow({ type: 'FABRICATED_ENUM' })],
      total: 1,
    }),
    /type.*unsupported/i,
  );
});

test('Margin interest preserves distinct asset/rawAsset truth and blocks a missing rawAsset', () => {
  const complete = normalize('MARGIN_INTEREST', {
    rows: [marginInterestRow({ asset: 'USDT', rawAsset: 'LDUSDT' })], total: 1,
  });
  assert.equal(complete.value.rows[0].asset, 'USDT');
  assert.equal(complete.value.rows[0].rawAsset, 'LDUSDT');
  assert.equal(complete.usableAsPrivateEvidence, true);

  const missingRow = marginInterestRow();
  delete missingRow.rawAsset;
  const missing = normalize('MARGIN_INTEREST', { rows: [missingRow], total: 1 });
  assert.equal(missing.value.rows[0].rawAsset, null);
  assert.equal(missing.usableAsPrivateEvidence, false);
  assert.ok(missing.reasonCodes.includes('MARGIN_INTEREST_RAW_ASSET_MISSING'));
  assertNoAuthority(missing);
});

test('Margin inventory stays exact but blocked on the accepted official time-unit conflict', () => {
  const fact = normalize('MARGIN_INVENTORY', {
    assets: { USDT: '00100.50000000', BTC: '0.00000000' },
    updateTime: 1_699_272_487,
  });
  assert.deepEqual(fact.value.assets, [
    { asset: 'BTC', available: '0' },
    { asset: 'USDT', available: '100.5' },
  ]);
  assert.equal(fact.value.updateTimeUnit, 'UNKNOWN');
  assert.equal(fact.usableAsPrivateEvidence, false);
  assert.ok(fact.reasonCodes.includes('OFFICIAL_DOC_CONFLICT_MARGIN_INVENTORY_TIME_UNIT'));
  assertNoAuthority(fact);
});

test('all non-empty USD-M and Margin identity collections reject exact and conflicting duplicates', async (t) => {
  const vectors = [
    {
      name: 'USD-M balances', kind: 'USDM_BALANCE', row: usdmBalance(),
      conflict: usdmBalance({ balance: '11' }), wrap: (rows) => rows,
    },
    {
      name: 'USD-M positions', kind: 'USDM_POSITIONS', row: usdmPosition(),
      conflict: usdmPosition({ positionAmt: '-0.02' }), wrap: (rows) => rows,
    },
    {
      name: 'USD-M orders', kind: 'USDM_OPEN_ORDERS', row: usdmOrder(),
      conflict: usdmOrder({ price: '59001' }), wrap: (rows) => rows,
    },
    {
      name: 'USD-M trades', kind: 'USDM_TRADES', row: usdmTrade(),
      conflict: usdmTrade({ realizedPnl: '-1' }), wrap: (rows) => rows,
    },
    {
      name: 'Margin account assets', kind: 'MARGIN_CROSS_ACCOUNT', row: marginAsset(),
      conflict: marginAsset({ borrowed: '2' }), wrap: (rows) => marginCross({ userAssets: rows }),
    },
    {
      name: 'Margin orders', kind: 'MARGIN_OPEN_ORDERS', row: marginOrder(),
      conflict: marginOrder({ price: '59001' }), wrap: (rows) => rows,
    },
    {
      name: 'Margin trades', kind: 'MARGIN_TRADES', row: marginTrade(),
      conflict: marginTrade({ commission: '0.02' }), wrap: (rows) => rows,
    },
    {
      name: 'Margin interest', kind: 'MARGIN_INTEREST', row: marginInterestRow(),
      conflict: marginInterestRow({ interest: '0.03' }), wrap: (rows) => ({ rows, total: rows.length }),
    },
    {
      name: 'Margin rates', kind: 'MARGIN_INTEREST_RATE', row: marginRate(),
      conflict: marginRate({ dailyInterestRate: '0.0003' }), wrap: (rows) => rows,
    },
  ];
  for (const vector of vectors) {
    await t.test(vector.name, () => {
      assert.throws(
        () => normalize(vector.kind, vector.wrap([vector.row, structuredClone(vector.row)])),
        /duplicate identity/i,
      );
      assert.throws(
        () => normalize(vector.kind, vector.wrap([vector.row, vector.conflict])),
        /conflicting duplicate identity/i,
      );
    });
  }
});

test('USD-M balance and Margin order collections reject overbound truth rather than truncating', () => {
  const balances = Array.from(
    { length: PRIVATE_DATA_BOUNDS.maximumAssets + 1 },
    (_, index) => usdmBalance({ asset: `A${index}` }),
  );
  assert.throws(() => normalize('USDM_BALANCE', balances), /bounded array/i);

  const orders = Array.from(
    { length: PRIVATE_DATA_BOUNDS.maximumOrders + 1 },
    (_, index) => marginOrder({ orderId: index + 1, clientOrderId: `synthetic-margin-order-${index + 1}` }),
  );
  assert.throws(() => normalize('MARGIN_OPEN_ORDERS', orders), /bounded array/i);
});

test('USD-M algo orders/configuration plus Margin borrow-repay history remain exact null L02 gaps', () => {
  const expected = new Map([
    ['USDM_ALGO_OPEN_ORDERS', 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_ALGO_OPEN_ORDERS'],
    ['USDM_ACCOUNT_CONFIGURATION', 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_ACCOUNT_CONFIGURATION'],
    ['USDM_SYMBOL_CONFIGURATION', 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_SYMBOL_CONFIGURATION'],
    ['MARGIN_BORROW_REPAY_HISTORY', 'OFFICIAL_DOC_CONFLICT_MARGIN_BORROW_REPAY_HISTORY_PARAMETERS'],
  ]);
  for (const [kind, reason] of expected) {
    const fact = normalizePrivateFactEvidence(gapEvidence(kind), T0);
    assert.equal(fact.contractId, null);
    assert.equal(fact.injectedValue, null);
    assert.equal(fact.value, null);
    assert.equal(fact.validUntilMs, null);
    assert.equal(fact.usableAsPrivateEvidence, false);
    assert.ok(fact.reasonCodes.includes(reason));
    assertNoAuthority(fact);
    assertDeeplyFrozen(fact);
  }
});

test('USD-M and Margin client order identities share the exact non-secret Binance grammar', () => {
  for (const [kind, row] of [
    ['USDM_OPEN_ORDERS', usdmOrder()],
    ['MARGIN_OPEN_ORDERS', marginOrder()],
  ]) {
    const admitted = { ...row, clientOrderId: 'a'.repeat(36) };
    assert.equal(normalize(kind, [admitted]).value[0].clientOrderId.length, 36);
    for (const clientOrderId of [
      'a'.repeat(37), 'contains space', 'abc+def',
      'eyJabcde.abcdefgh.ijklmnop',
      'AKIAIOSFODNN7EXAMPLE', 'ASIAIOSFODNN7EXAMPLE',
      `AROA${'A1'.repeat(8)}`,
    ]) {
      assert.throws(
        () => normalize(kind, [{ ...row, clientOrderId }]),
        /clientOrderId|secret-shaped text|client-order-id grammar/i,
      );
    }
  }
});
