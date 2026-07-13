import assert from 'node:assert/strict';
import test from 'node:test';

import {
  L05_BINANCE_MATRIX_SHA256,
  L05_PRIVATE_FACT_SCHEMA,
  L05_PRIVATE_FACT_SCHEMA_REVISIONS,
  L05_PRIVATE_GAP_SOURCE_ID,
  PRIVATE_FACT_CONTRACT_POLICY,
  decideWaitingPrivateTruth,
  derivePrivateTruthSourceCutRevision,
  evaluatePrivatePermissions,
  normalizePrivateFactEvidence,
  projectPrivateTruth,
  resolvePrivateFactContract,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/index.js';

const T0 = 1_800_000_000_000;
const ACCOUNT_REALM = 'account.prod.scope.1';
const READ_PROFILE = 'profile.read.scope.1';
const EXECUTION_PROFILE = 'profile.execution.scope.1';
const FINGERPRINT = 'account.fingerprint.scope.1';
const NO_AUTHORITY = Object.freeze({
  sendEligible: false,
  accountReadAuthority: 'NONE',
  mutationAuthority: 'NONE',
  reconciliationAuthority: 'NONE',
  capitalAuthority: 'NONE',
  riskAuthority: 'NONE',
  externalActionAuthorization: 'NONE',
  actionAuthority: 'NONE_RECORD_ONLY',
});

function assertNoAuthority(value) {
  for (const [key, expected] of Object.entries(NO_AUTHORITY)) assert.equal(value[key], expected, key);
}

function assertFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertFrozen(descriptor.value, seen);
  }
}

function selectors(kind, isGap = false) {
  if (isGap) return { queryScope: 'ACCOUNT_WIDE', querySymbol: null, queryAsset: null, queryType: null, marginMode: null };
  if (['SPOT_OPEN_ORDERS', 'USDM_OPEN_ORDERS', 'USDM_ALGO_OPEN_ORDERS'].includes(kind)) {
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

function coverage(kind, isGap = false) {
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

function receiptId(seed) {
  return `private-receipt:${seed.toString(16).padStart(24, '0')}`;
}

function currentInput(kind, value, overrides = {}) {
  const policy = PRIVATE_FACT_CONTRACT_POLICY[kind];
  assert.ok(policy?.contractId);
  const contract = resolvePrivateFactContract(kind, L05_BINANCE_MATRIX_SHA256, policy.contractId).contract;
  assert.ok(contract);
  return {
    schema: L05_PRIVATE_FACT_SCHEMA,
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    factKind: kind,
    product: policy.product,
    environment: 'PRODUCTION',
    realm: contract.realm,
    accountRealmId: ACCOUNT_REALM,
    profileId: READ_PROFILE,
    contractId: policy.contractId,
    ...selectors(kind),
    queryCoverage: coverage(kind),
    sourceId: contract.sourceIds[0],
    schemaRevision: L05_PRIVATE_FACT_SCHEMA_REVISIONS[kind],
    receiptId: receiptId(Object.keys(L05_PRIVATE_FACT_SCHEMA_REVISIONS).indexOf(kind) + 1),
    readState: 'OK',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs: T0,
    receivedAtMs: T0 + 10,
    maxAgeMs: 60_000,
    value,
    ...overrides,
  };
}

function gapInput(kind, overrides = {}) {
  const policy = PRIVATE_FACT_CONTRACT_POLICY[kind];
  assert.equal(policy?.contractId, null);
  return {
    schema: L05_PRIVATE_FACT_SCHEMA,
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    factKind: kind,
    product: policy.product,
    environment: 'PRODUCTION',
    realm: policy.product === 'MARGIN' ? 'PRIVATE_MARGIN_ACCOUNT' : 'PRIVATE_ACCOUNT',
    accountRealmId: ACCOUNT_REALM,
    profileId: null,
    contractId: null,
    ...selectors(kind, true),
    queryCoverage: coverage(kind, true),
    sourceId: L05_PRIVATE_GAP_SOURCE_ID,
    schemaRevision: L05_PRIVATE_FACT_SCHEMA_REVISIONS[kind],
    receiptId: receiptId(Object.keys(L05_PRIVATE_FACT_SCHEMA_REVISIONS).indexOf(kind) + 129),
    readState: 'UNAVAILABLE',
    authority: 'UNAVAILABLE',
    completeness: 'UNAVAILABLE',
    sourceTimeMs: null,
    receivedAtMs: T0,
    maxAgeMs: 60_000,
    value: null,
    ...overrides,
  };
}

function normalizeInput(input) {
  return normalizePrivateFactEvidence(input, T0 + 20);
}

function spotTrade(symbol = 'BTCUSDT', id = 1) {
  return {
    symbol, id, orderId: 10, orderListId: -1, price: '60000', qty: '0.01',
    quoteQty: '600', commission: '0.01', commissionAsset: 'USDT', time: T0,
    isBuyer: true, isMaker: false, isBestMatch: true,
  };
}

function spotOrder(symbol = 'BTCUSDT', orderId = 1) {
  return {
    symbol, orderId, orderListId: -1, clientOrderId: `spot-scope-${orderId}`,
    price: '60000', origQty: '0.01', executedQty: '0', cummulativeQuoteQty: '0',
    status: 'NEW', timeInForce: 'GTC', type: 'LIMIT', side: 'BUY',
    time: T0 - 1, updateTime: T0, isWorking: true,
    origQuoteOrderQty: '0', workingTime: T0 - 1, selfTradePreventionMode: 'NONE',
  };
}

function usdmTrade(symbol = 'BTCUSDT', id = 1) {
  return {
    buyer: true, commission: '0.01', commissionAsset: 'USDT', id, maker: false,
    orderId: 10, price: '60000', qty: '0.01', quoteQty: '600', realizedPnl: '0',
    side: 'BUY', positionSide: 'BOTH', symbol, time: T0,
  };
}

function usdmOrder(symbol = 'BTCUSDT', orderId = 1) {
  return {
    avgPrice: '0', clientOrderId: `usdm-scope-${orderId}`, cumQuote: '0',
    executedQty: '0', orderId, origQty: '0.01', origType: 'LIMIT', price: '60000',
    reduceOnly: false, side: 'BUY', positionSide: 'BOTH', status: 'NEW', stopPrice: '0',
    closePosition: false, symbol, time: T0 - 1, timeInForce: 'GTC', type: 'LIMIT',
    activatePrice: '0', priceRate: '0', updateTime: T0, workingType: 'CONTRACT_PRICE',
    priceProtect: false, priceMatch: 'NONE', selfTradePreventionMode: 'NONE', goodTillDate: 0,
  };
}

function usdmAlgoOrder(symbol = 'BTCUSDT', algoId = 1) {
  return {
    algoId,
    clientAlgoId: `usdm-algo-scope-${algoId}`,
    algoType: 'CONDITIONAL',
    orderType: 'TAKE_PROFIT',
    symbol,
    side: 'SELL',
    positionSide: 'BOTH',
    timeInForce: 'GTC',
    quantity: '0.01',
    algoStatus: 'NEW',
    actualOrderId: '',
    actualPrice: '0',
    triggerPrice: '61000',
    price: '61000',
    icebergQuantity: 'null',
    tpTriggerPrice: '0',
    tpPrice: '0',
    slTriggerPrice: '0',
    slPrice: '0',
    tpOrderType: '',
    selfTradePreventionMode: 'EXPIRE_MAKER',
    workingType: 'CONTRACT_PRICE',
    priceMatch: 'NONE',
    closePosition: false,
    priceProtect: false,
    reduceOnly: false,
    createTime: T0 - 1,
    updateTime: T0,
    triggerTime: 0,
    goodTillDate: 0,
  };
}

function marginTrade(symbol = 'BTCUSDT', id = 1, isIsolated = false) {
  return {
    symbol, id, orderId: 10, price: '60000', qty: '0.01',
    commission: '0.01', commissionAsset: 'USDT', time: T0, isBuyer: true,
    isMaker: false, isBestMatch: true, isIsolated,
  };
}

function marginOrder(symbol = 'BTCUSDT', orderId = 1, isIsolated = false) {
  return {
    symbol, orderId, clientOrderId: `margin-scope-${orderId}`, price: '60000',
    origQty: '0.01', executedQty: '0', cummulativeQuoteQty: '0', status: 'NEW',
    timeInForce: 'GTC', type: 'LIMIT', side: 'BUY', stopPrice: '0', icebergQty: '0',
    time: T0 - 1, updateTime: T0, isWorking: true, isIsolated,
    selfTradePreventionMode: 'NONE',
  };
}

function marginRate(asset = 'USDT') {
  return { asset, dailyInterestRate: '0.0002', timestamp: T0, vipLevel: 1 };
}

function marginInterestRow(overrides = {}) {
  return {
    asset: 'USDT', rawAsset: 'LDUSDT', interest: '0.01',
    interestAccuredTime: T0, interestRate: '0.0001', principal: '10',
    type: 'PERIODIC', isolatedSymbol: '', txId: 1, ...overrides,
  };
}

function permissionPayload(overrides = {}) {
  return {
    ipRestrict: true, enableReading: false, enableWithdrawals: false,
    enableInternalTransfer: false, enableMargin: false, enableFutures: false,
    permitsUniversalTransfer: false, enableVanillaOptions: false,
    enableFixApiTrade: false, enableFixReadOnly: false,
    enableSpotAndMarginTrading: false, enablePortfolioMarginTrading: false,
    ...overrides,
  };
}

function permissionProfile(profileClass, posture, marginMode = 'CROSS_CLASSIC') {
  const read = profileClass === 'READ_KEY';
  return {
    profileClass,
    profileId: read ? READ_PROFILE : EXECUTION_PROFILE,
    accountRealmId: ACCOUNT_REALM,
    accountFingerprintRef: FINGERPRINT,
    environment: 'PRODUCTION',
    deployedEgressMatch: true,
    permissions: permissionPayload(read ? { enableReading: true } : {
      enableSpotAndMarginTrading: ['SPOT_NEW_EXPOSURE', 'SPOT_USDM_NEW_EXPOSURE', 'MARGIN_NEW_EXPOSURE'].includes(posture),
      enableFutures: ['USDM_NEW_EXPOSURE', 'SPOT_USDM_NEW_EXPOSURE'].includes(posture),
      enableMargin: posture === 'MARGIN_NEW_EXPOSURE',
    }),
    accountStatus: 'Normal', apiTradingLocked: false,
    usdmDualSidePosition: false, usdmMultiAssetsMargin: false, marginMode,
  };
}

function permissions(posture, marginMode = 'CROSS_CLASSIC') {
  return evaluatePrivatePermissions({
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture,
    accountRealmId: ACCOUNT_REALM,
    accountFingerprintRef: FINGERPRINT,
    readProfile: permissionProfile('READ_KEY', posture, marginMode),
    executionProfile: permissionProfile('EXECUTION_KEY', posture, marginMode),
  });
}

function projectionInput(posture, targetSymbol, facts, permissionDecisions = permissions(posture)) {
  return {
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture,
    accountRealmId: ACCOUNT_REALM,
    targetSymbol,
    evaluatedAtMs: T0 + 20,
    facts,
    permissions: permissionDecisions,
    reconciliationObservation: null,
  };
}

function manualWaitingInput(projection, currentSymbol) {
  const permissionRevisions = projection.permissions.map((item) => item.revision).sort();
  const instrumentRevision = `l04-instrument-spec:${'1'.repeat(24)}`;
  const instrumentEvidenceRevision = `l04-instrument-source-evidence:${'2'.repeat(24)}`;
  const instrumentSnapshotRevision = `l04-instrument-registry-snapshot:${'3'.repeat(24)}`;
  return {
    binding: {
      schema: 'L05_PRIVATE_WAITING_BINDING_V1', symbol: projection.targetSymbol,
      instrumentRevision,
      instrumentEvidenceRevision,
      instrumentSnapshotRevision,
      privateProjectionRevision: projection.projectionRevision,
      permissionRevisions: [...permissionRevisions], lifecycleRevisions: [], reconciliationCutRevision: null,
      evaluatedAtMs: projection.evaluatedAtMs,
      validUntilMs: projection.validUntilMs ?? projection.evaluatedAtMs,
      persistenceProven: false, ...NO_AUTHORITY,
    },
    currentSymbol,
    currentInstrumentRevision: instrumentRevision,
    currentInstrumentEvidenceRevision: instrumentEvidenceRevision,
    currentInstrumentSnapshotRevision: instrumentSnapshotRevision,
    projection, permissionRevisions: [...permissionRevisions], lifecycleWitnesses: [], reconciliationCutRevision: null,
    evaluatedAtMs: projection.evaluatedAtMs,
  };
}

test('account-wide facts reject every extra symbol selector', () => {
  for (const kind of ['SPOT_ACCOUNT_STATUS', 'USDM_ACCOUNT_STATUS', 'MARGIN_ACCOUNT_STATUS']) {
    assert.throws(() => normalizeInput(currentInput(kind, { data: 'Normal' }, {
      queryScope: 'ACCOUNT_WIDE', querySymbol: 'BTCUSDT',
    })), /account-wide.*symbol selector/i);
    assert.throws(() => normalizeInput(currentInput(kind, { data: 'Normal' }, {
      queryScope: 'SYMBOL', querySymbol: 'BTCUSDT',
    })), /account-wide.*symbol selector/i);
  }
});

test('required symbols reject missing, empty, malformed, accessor, proxy, and symbol-key input', () => {
  const base = currentInput('SPOT_TRADES', []);
  for (const querySymbol of [null, '', 'btcusdt', ' BTCUSDT', 'BTCUSDT ', 'BTC:USDT']) {
    assert.throws(() => normalizeInput({ ...base, querySymbol }), /exact symbol scope|query symbol|bounded safe text|canonical L04/i);
  }
  const missing = { ...base };
  delete missing.querySymbol;
  assert.throws(() => normalizeInput(missing), /exact fields/i);

  let getterCalls = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, 'querySymbol', {
    enumerable: true,
    get() { getterCalls += 1; return 'BTCUSDT'; },
  });
  assert.throws(() => normalizeInput(accessor), /data properties/i);
  assert.equal(getterCalls, 0);

  const traps = [];
  const proxySymbol = new Proxy({}, {
    get() { traps.push('get'); throw new Error('GET'); },
    ownKeys() { traps.push('keys'); throw new Error('KEYS'); },
  });
  assert.throws(() => normalizeInput({ ...base, querySymbol: proxySymbol }), /non-proxy JSON-like data/i);
  assert.deepEqual(traps, []);

  const symbolKey = { ...base };
  symbolKey[Symbol('hidden')] = 'BTCUSDT';
  assert.throws(() => normalizeInput(symbolKey), /symbol keys/i);
});

test('targeted empty arrays remain explicit current evidence for every product', () => {
  const vectors = [
    ['SPOT_TRADES', null],
    ['USDM_TRADES', null],
    ['MARGIN_TRADES', 'CROSS'],
  ];
  for (const [kind, marginMode] of vectors) {
    const fact = normalizeInput(currentInput(kind, [], {
      queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', marginMode,
    }));
    assert.deepEqual(fact.value, []);
    assert.equal(fact.queryScope, 'SYMBOL');
    assert.equal(fact.querySymbol, 'BTCUSDT');
    assert.equal(fact.usableAsPrivateEvidence, true);
    assertNoAuthority(fact);
    assertFrozen(fact);
  }
});

test('historical completeness requires an explicit terminal window and every selector is retained', () => {
  const complete = normalizeInput(currentInput('SPOT_TRADES', [], {
    receiptId: receiptId(301),
  }));
  assert.equal(complete.queryCoverage.kind, 'HISTORY_EXPLICIT_WINDOW');
  assert.equal(complete.queryCoverage.limit, 1_000);
  assert.equal(complete.usableAsPrivateEvidence, true);

  const defaultCoverage = { kind: 'HISTORY_DEFAULT_PARTIAL', ...EMPTY_COVERAGE };
  assert.throws(
    () => normalizeInput(currentInput('SPOT_TRADES', [], {
      queryCoverage: defaultCoverage, completeness: 'COMPLETE', receiptId: receiptId(302),
    })),
    /cannot claim COMPLETE.*terminal query coverage/i,
  );
  const partial = normalizeInput(currentInput('SPOT_TRADES', [], {
    queryCoverage: defaultCoverage, completeness: 'PARTIAL', receiptId: receiptId(303),
  }));
  assert.equal(partial.usableAsPrivateEvidence, false);
  assert.ok(partial.reasonCodes.includes('PRIVATE_QUERY_COVERAGE_PARTIAL_SPOT_TRADES'));

  const cursorCoverage = {
    kind: 'HISTORY_CURSOR_PARTIAL', ...EMPTY_COVERAGE, fromId: '7', limit: 1_000,
  };
  const cursor = normalizeInput(currentInput('SPOT_TRADES', [], {
    queryCoverage: cursorCoverage, completeness: 'PARTIAL', receiptId: receiptId(304),
  }));
  assert.equal(cursor.queryCoverage.fromId, '7');
  assert.equal(cursor.usableAsPrivateEvidence, false);

  assert.throws(
    () => normalizeInput(currentInput('SPOT_TRADES', [], {
      queryCoverage: { ...coverage('SPOT_TRADES'), limit: 999 },
    })),
    /exact maximum limit/i,
  );
  assert.throws(
    () => normalizeInput(currentInput('SPOT_TRADES', [
      { ...spotTrade('BTCUSDT', 99), time: T0 - 60_001 },
    ], { receiptId: receiptId(306) })),
    /outside its exact query window/i,
  );
  assert.throws(
    () => normalizeInput(currentInput('SPOT_TRADES', [], {
      queryCoverage: { ...coverage('SPOT_TRADES'), endTimeMs: T0 - 1 },
    })),
    /source time must equal its exact coverage cut/i,
  );
  const fullPage = Array.from({ length: 1_000 }, (_, index) => spotTrade('BTCUSDT', index + 1));
  assert.throws(
    () => normalizeInput(currentInput('SPOT_TRADES', fullPage, { receiptId: receiptId(305) })),
    /cannot claim COMPLETE.*terminal query coverage/i,
  );
});

test('official history windows enforce every exact maximum boundary', () => {
  const DAY = 24 * 60 * 60 * 1_000;
  const vectors = [
    ['SPOT_TRADES', 24 * 60 * 60 * 1_000, true, /24-hour maximum/i],
    ['USDM_TRADES', 7 * DAY, true, /7-day maximum/i],
    ['MARGIN_TRADES', DAY - 1, true, /strictly shorter than 24 hours/i],
    ['MARGIN_INTEREST', 30 * DAY, true, /30-day maximum/i],
    ['MARGIN_INTEREST_RATE', 30 * DAY, true, /CALENDAR_MONTH_CONSERVATIVE_30D_POLICY/i],
  ];
  let seed = 900;
  for (const [kind, admittedSpan, inclusive, rejection] of vectors) {
    const baseCoverage = coverage(kind);
    const accepted = currentInput(
      kind,
      kind === 'MARGIN_INTEREST' ? { rows: [], total: 0 } : [],
      {
        receiptId: receiptId(seed),
        queryCoverage: {
          ...baseCoverage,
          startTimeMs: T0 - admittedSpan,
          endTimeMs: T0,
        },
      },
    );
    assert.doesNotThrow(() => normalizeInput(accepted), kind);
    seed += 1;
    const rejectedSpan = inclusive ? admittedSpan + 1 : DAY;
    assert.throws(
      () => normalizeInput({
        ...accepted,
        receiptId: receiptId(seed),
        queryCoverage: { ...accepted.queryCoverage, startTimeMs: T0 - rejectedSpan },
      }),
      rejection,
      kind,
    );
    seed += 1;
  }
});

test('USD-M six-calendar-month history cutoff is exact against the evaluation cut', () => {
  const exactBoundary = Date.UTC(2026, 6, 15, 8, 0, 0, 20);
  assert.equal(T0 + 20, Date.UTC(2027, 0, 15, 8, 0, 0, 20));
  const exact = currentInput('USDM_TRADES', [], {
    receiptId: receiptId(920),
    sourceTimeMs: exactBoundary,
    queryCoverage: {
      ...coverage('USDM_TRADES'),
      startTimeMs: exactBoundary,
      endTimeMs: exactBoundary,
    },
  });
  assert.equal(normalizeInput(exact).queryCoverage.startTimeMs, exactBoundary);
  assert.throws(
    () => normalizeInput({
      ...exact,
      receiptId: receiptId(921),
      queryCoverage: { ...exact.queryCoverage, startTimeMs: exactBoundary - 1 },
    }),
    /older than six calendar months before the evaluation cut/i,
  );
});

test('current response coverage is exact and Spot account never omits zero balances', () => {
  assert.throws(
    () => normalizeInput(currentInput('SPOT_ACCOUNT', {}, {
      queryCoverage: { ...coverage('SPOT_ACCOUNT'), omitZeroBalances: true },
    })),
    /omitZeroBalances=false/i,
  );
  assert.throws(
    () => normalizeInput(currentInput('SPOT_ACCOUNT_STATUS', { data: 'Normal' }, {
      queryCoverage: { ...coverage('SPOT_ACCOUNT_STATUS'), orderId: '1' },
    })),
    /unsupported selector/i,
  );
});

test('Margin history coverage closes page, mode, asset, isolated, and VIP ambiguity', () => {
  const interest = normalizeInput(currentInput('MARGIN_INTEREST', {
    rows: [marginInterestRow()], total: 1,
  }, { receiptId: receiptId(311) }));
  assert.equal(interest.queryCoverage.page, 1);
  assert.equal(interest.queryCoverage.size, 100);
  assert.equal(interest.marginMode, 'CROSS');
  assert.equal(interest.usableAsPrivateEvidence, true);

  assert.throws(
    () => normalizeInput(currentInput('MARGIN_INTEREST', {
      rows: [marginInterestRow()], total: 2,
    }, { receiptId: receiptId(312) })),
    /cannot claim COMPLETE.*terminal query coverage/i,
  );
  const partial = normalizeInput(currentInput('MARGIN_INTEREST', {
    rows: [marginInterestRow()], total: 2,
  }, { completeness: 'PARTIAL', receiptId: receiptId(313) }));
  assert.equal(partial.usableAsPrivateEvidence, false);
  assert.ok(partial.reasonCodes.includes('MARGIN_INTEREST_HISTORY_PARTIAL_PAGE'));

  assert.throws(
    () => normalizeInput(currentInput('MARGIN_INTEREST', { rows: [], total: 0 }, {
      queryCoverage: { ...coverage('MARGIN_INTEREST'), isolatedSymbol: 'BTCUSDT' },
    })),
    /cross Margin interest.*isolatedSymbol/i,
  );
  assert.throws(
    () => normalizeInput(currentInput('MARGIN_INTEREST', { rows: [], total: 0 }, {
      marginMode: null,
    })),
    /requires an exact Margin query mode/i,
  );
  assert.throws(
    () => normalizeInput(currentInput('MARGIN_INTEREST_RATE', [marginRate()], {
      queryCoverage: { ...coverage('MARGIN_INTEREST_RATE'), vipLevel: 1 },
    })),
    /unsupported selector|vipLevel omitted/i,
  );
  assert.throws(
    () => normalizeInput(currentInput('MARGIN_INTEREST', {
      rows: [marginInterestRow({ interestAccuredTime: T0 - 60_001 })], total: 1,
    })),
    /outside its exact query window/i,
  );
  assert.throws(
    () => normalizeInput(currentInput('MARGIN_INTEREST', {
      rows: [marginInterestRow()], total: 1,
    }, {
      queryCoverage: { ...coverage('MARGIN_INTEREST'), asset: 'USDT' },
      completeness: 'COMPLETE',
      receiptId: receiptId(314),
    })),
    /cannot claim COMPLETE.*terminal query coverage/i,
  );
  const filteredAsset = normalizeInput(currentInput('MARGIN_INTEREST', {
    rows: [marginInterestRow()], total: 1,
  }, {
    queryCoverage: { ...coverage('MARGIN_INTEREST'), asset: 'USDT' },
    completeness: 'PARTIAL',
    receiptId: receiptId(315),
  }));
  assert.equal(filteredAsset.queryCoverage.asset, 'USDT');
  assert.ok(filteredAsset.reasonCodes.includes('MARGIN_INTEREST_ASSET_FILTER_PARTIAL'));
  assert.throws(
    () => normalizeInput(currentInput('MARGIN_INTEREST', {
      rows: [marginInterestRow({ asset: 'BTC' })], total: 1,
    }, {
      queryCoverage: { ...coverage('MARGIN_INTEREST'), asset: 'USDT' },
      completeness: 'PARTIAL',
      receiptId: receiptId(316),
    })),
    /exact asset selector/i,
  );
});

test('targeted responses reject cross-symbol and mixed-symbol substitution', async (t) => {
  const vectors = [
    ['Spot', 'SPOT_TRADES', (symbol, id) => spotTrade(symbol, id), null],
    ['USD-M', 'USDM_TRADES', (symbol, id) => usdmTrade(symbol, id), null],
    ['Margin', 'MARGIN_TRADES', (symbol, id) => marginTrade(symbol, id, false), 'CROSS'],
  ];
  for (const [name, kind, row, marginMode] of vectors) {
    await t.test(name, () => {
      const metadata = { queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', marginMode };
      assert.throws(
        () => normalizeInput(currentInput(kind, [row('ETHUSDT', 1)], metadata)),
        /cross-symbol query substitution/i,
      );
      assert.throws(
        () => normalizeInput(currentInput(kind, [row('BTCUSDT', 1), row('ETHUSDT', 2)], metadata)),
        /cross-symbol query substitution/i,
      );
    });
  }
});

test('optional all-symbol and targeted forms remain distinct and exact', () => {
  const vectors = [
    ['SPOT_OPEN_ORDERS', (symbol, id) => spotOrder(symbol, id), null],
    ['USDM_OPEN_ORDERS', (symbol, id) => usdmOrder(symbol, id), null],
    ['USDM_ALGO_OPEN_ORDERS', (symbol, id) => usdmAlgoOrder(symbol, id), null],
    ['MARGIN_OPEN_ORDERS', (symbol, id) => marginOrder(symbol, id, false), 'CROSS'],
  ];
  for (const [kind, row, marginMode] of vectors) {
    const all = normalizeInput(currentInput(kind, [row('BTCUSDT', 1), row('ETHUSDT', 2)], {
      queryScope: 'ALL_SYMBOLS', querySymbol: null, marginMode,
    }));
    assert.equal(all.queryScope, 'ALL_SYMBOLS');
    assert.deepEqual(all.value.map((item) => item.symbol), ['BTCUSDT', 'ETHUSDT']);
    assertNoAuthority(all);

    const targeted = normalizeInput(currentInput(kind, [], {
      queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', marginMode,
    }));
    assert.deepEqual(targeted.value, []);
    assert.equal(targeted.querySymbol, 'BTCUSDT');

    assert.throws(() => normalizeInput(currentInput(kind, [], {
      queryScope: 'ALL_SYMBOLS', querySymbol: 'BTCUSDT', marginMode,
    })), /all-symbol.*query symbol/i);
    assert.throws(() => normalizeInput(currentInput(kind, [], {
      queryScope: 'SYMBOL', querySymbol: null, marginMode,
    })), /requires a query symbol/i);
  }
});

test('target, source-cut, content, evidence, and projection revisions bind exact scope', () => {
  const btcInput = currentInput('SPOT_TRADES', [], {
    queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', receiptId: receiptId(501),
  });
  const btc = normalizeInput(btcInput);
  const eth = normalizeInput({
    ...btcInput, querySymbol: 'ETHUSDT', receiptId: receiptId(502),
  });
  assert.notEqual(eth.contentRevision, btc.contentRevision);
  assert.notEqual(eth.evidenceRevision, btc.evidenceRevision);

  const anotherReceipt = normalizeInput({ ...btcInput, receiptId: receiptId(503) });
  assert.equal(anotherReceipt.contentRevision, btc.contentRevision);
  assert.notEqual(anotherReceipt.evidenceRevision, btc.evidenceRevision);

  const anotherWindow = normalizeInput({
    ...btcInput,
    receiptId: receiptId(504),
    queryCoverage: { ...btcInput.queryCoverage, startTimeMs: T0 - 120_000 },
  });
  assert.notEqual(anotherWindow.contentRevision, btc.contentRevision);
  assert.throws(
    () => normalizeInput({ ...btcInput, schemaRevision: 'spot.trades.scope.v2' }),
    /closed per-fact L05 schema/i,
  );

  const btcCut = projectionInput('SPOT_NEW_EXPOSURE', 'BTCUSDT', [btc]);
  const ethCut = projectionInput('SPOT_NEW_EXPOSURE', 'ETHUSDT', [eth]);
  const { reconciliationObservation: ignoredBtcReconciliation, ...btcSourceCut } = btcCut;
  const { reconciliationObservation: ignoredEthReconciliation, ...ethSourceCut } = ethCut;
  assert.equal(ignoredBtcReconciliation, null);
  assert.equal(ignoredEthReconciliation, null);
  assert.notEqual(
    derivePrivateTruthSourceCutRevision(btcSourceCut),
    derivePrivateTruthSourceCutRevision(ethSourceCut),
  );
  const btcProjection = projectPrivateTruth(btcCut);
  const ethProjection = projectPrivateTruth(ethCut);
  assert.notEqual(btcProjection.semanticRevision, ethProjection.semanticRevision);
  assert.notEqual(btcProjection.evidenceRevision, ethProjection.evidenceRevision);
  assert.notEqual(btcProjection.projectionRevision, ethProjection.projectionRevision);
  assertNoAuthority(btcProjection);
  assertNoAuthority(ethProjection);

  const forged = structuredClone(btc);
  forged.querySymbol = 'ETHUSDT';
  assert.throws(
    () => projectPrivateTruth(projectionInput('SPOT_NEW_EXPOSURE', 'ETHUSDT', [forged])),
    /does not reproduce|revision-coherent|canonically reproducible/i,
  );
});

test('L02 gaps remain selector-free, including USD-M symbol configuration', () => {
  for (const kind of [
    'USDM_COMMISSIONS', 'USDM_SYMBOL_CONFIGURATION',
    'MARGIN_MAX_BORROWABLE', 'MARGIN_BORROW_REPAY_HISTORY',
  ]) {
    const gap = normalizeInput(gapInput(kind));
    assert.equal(gap.queryScope, 'ACCOUNT_WIDE');
    assert.equal(gap.querySymbol, null);
    assert.equal(gap.queryAsset, null);
    assert.equal(gap.queryType, null);
    assert.equal(gap.marginMode, null);
    assert.equal(gap.usableAsPrivateEvidence, false);
    assertNoAuthority(gap);
    for (const mutation of [
      { queryScope: 'SYMBOL', querySymbol: 'BTCUSDT' },
      { queryAsset: 'USDT' }, { queryType: 'MARGIN' }, { marginMode: 'CROSS' },
    ]) {
      assert.throws(() => normalizeInput({ ...gapInput(kind), ...mutation }), /gap evidence cannot carry query selectors/i);
    }
  }
});

test('Margin cross and isolated query modes bind both selector and response mode', () => {
  const cross = normalizeInput(currentInput('MARGIN_OPEN_ORDERS', [marginOrder('BTCUSDT', 1, false)], {
    queryScope: 'ALL_SYMBOLS', querySymbol: null, marginMode: 'CROSS',
  }));
  assert.equal(cross.marginMode, 'CROSS');
  assertNoAuthority(cross);

  const isolated = normalizeInput(currentInput('MARGIN_OPEN_ORDERS', [marginOrder('BTCUSDT', 2, true)], {
    queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', marginMode: 'ISOLATED',
  }));
  assert.equal(isolated.marginMode, 'ISOLATED');
  assert.equal(isolated.value[0].isIsolated, true);
  assertNoAuthority(isolated);

  assert.throws(() => normalizeInput(currentInput('MARGIN_OPEN_ORDERS', [], {
    queryScope: 'ALL_SYMBOLS', querySymbol: null, marginMode: 'ISOLATED',
  })), /isolated Margin open orders require exact symbol scope/i);
  assert.throws(() => normalizeInput(currentInput('MARGIN_OPEN_ORDERS', [marginOrder('BTCUSDT', 3, true)], {
    queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', marginMode: 'CROSS',
  })), /does not match its query mode/i);
  assert.throws(() => normalizeInput(currentInput('MARGIN_TRADES', [marginTrade('BTCUSDT', 4, false)], {
    queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', marginMode: 'ISOLATED',
  })), /does not match its query mode/i);
  assert.throws(() => normalizeInput(currentInput('MARGIN_TRADES', [], {
    queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', marginMode: null,
  })), /requires an exact Margin query mode/i);
});

test('Margin rate asset and inventory type cannot be silently substituted', () => {
  const rate = normalizeInput(currentInput('MARGIN_INTEREST_RATE', [marginRate('USDT')], {
    queryAsset: 'USDT',
  }));
  assert.equal(rate.queryAsset, 'USDT');
  assertNoAuthority(rate);
  assert.throws(() => normalizeInput(currentInput('MARGIN_INTEREST_RATE', [marginRate('BTC')], {
    queryAsset: 'USDT',
  })), /cross-asset query substitution/i);
  assert.throws(() => normalizeInput(currentInput('MARGIN_INTEREST_RATE', [marginRate('USDT')], {
    queryAsset: null,
  })), /requires an exact query asset/i);

  const inventoryValue = { assets: { USDT: '10' }, updateTime: 1_699_272_487 };
  const marginInventory = normalizeInput(currentInput('MARGIN_INVENTORY', inventoryValue, {
    queryType: 'MARGIN', receiptId: receiptId(601),
  }));
  const isolatedInventory = normalizeInput(currentInput('MARGIN_INVENTORY', inventoryValue, {
    queryType: 'ISOLATED', receiptId: receiptId(602),
  }));
  assert.notEqual(marginInventory.contentRevision, isolatedInventory.contentRevision);
  assert.notEqual(marginInventory.evidenceRevision, isolatedInventory.evidenceRevision);
  assertNoAuthority(marginInventory);
  assertNoAuthority(isolatedInventory);
  assert.throws(() => normalizeInput(currentInput('MARGIN_INVENTORY', inventoryValue, {
    queryType: null,
  })), /requires an exact query type/i);
  for (const queryType of ['margin', ' MARGIN', 'MARGIN:ISOLATED', 'CROSS', 'FOO', 'MARGIN_ONLY']) {
    assert.throws(() => normalizeInput(currentInput('MARGIN_INVENTORY', inventoryValue, {
      queryType,
    })), /canonical L04|bounded safe text|exactly MARGIN or ISOLATED/i);
  }
  const forged = structuredClone(marginInventory);
  forged.queryType = 'ISOLATED';
  assert.throws(
    () => projectPrivateTruth(projectionInput('MARGIN_NEW_EXPOSURE', 'BTCUSDT', [forged])),
    /does not reproduce|revision-coherent|canonically reproducible/i,
  );
});

test('Margin projection binds empty order and trade facts to reviewed permission mode', () => {
  const isolatedTrade = normalizeInput(currentInput('MARGIN_TRADES', [], {
    queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', marginMode: 'ISOLATED',
  }));
  const isolatedOrders = normalizeInput(currentInput('MARGIN_OPEN_ORDERS', [], {
    queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', marginMode: 'ISOLATED',
  }));
  const crossPermissions = permissions('MARGIN_NEW_EXPOSURE', 'CROSS_CLASSIC');
  const crossProjection = projectPrivateTruth(projectionInput(
    'MARGIN_NEW_EXPOSURE',
    'BTCUSDT',
    [isolatedTrade, isolatedOrders],
    crossPermissions,
  ));
  assert.ok(crossProjection.margin.reasonCodes.includes('FACT_MARGIN_MODE_MISMATCH_MARGIN_TRADES'));
  assert.ok(crossProjection.margin.reasonCodes.includes('FACT_MARGIN_MODE_MISMATCH_MARGIN_OPEN_ORDERS'));
  assert.equal(crossProjection.entryEvidenceComplete, false);
  assertNoAuthority(crossProjection);

  const isolatedProjection = projectPrivateTruth(projectionInput(
    'MARGIN_NEW_EXPOSURE',
    'BTCUSDT',
    [isolatedTrade, isolatedOrders],
    permissions('MARGIN_NEW_EXPOSURE', 'ISOLATED'),
  ));
  assert.ok(isolatedProjection.margin.reasonCodes.includes('ISOLATED_MARGIN_SYMBOL_IDENTITY_UNAVAILABLE'));
  assert.equal(isolatedProjection.entryEvidenceComplete, false);
  assertNoAuthority(isolatedProjection);

  const crossTrade = normalizeInput(currentInput('MARGIN_TRADES', [], {
    queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', marginMode: 'CROSS',
  }));
  const unknownProjection = projectPrivateTruth(projectionInput(
    'MARGIN_NEW_EXPOSURE',
    'BTCUSDT',
    [crossTrade],
    permissions('MARGIN_NEW_EXPOSURE', 'UNKNOWN'),
  ));
  assert.ok(unknownProjection.margin.reasonCodes.includes('MARGIN_FACT_MODE_UNKNOWN'));
  assert.ok(unknownProjection.margin.reasonCodes.includes('FACT_MARGIN_MODE_MISMATCH_MARGIN_TRADES'));
  assert.equal(unknownProjection.entryEvidenceComplete, false);
  assertNoAuthority(unknownProjection);

  const isolatedInventory = normalizeInput(currentInput('MARGIN_INVENTORY', {
    assets: {}, updateTime: 1_699_272_487,
  }, { queryType: 'ISOLATED', receiptId: receiptId(701) }));
  const inventoryProjection = projectPrivateTruth(projectionInput(
    'MARGIN_NEW_EXPOSURE',
    'BTCUSDT',
    [isolatedInventory],
    crossPermissions,
  ));
  assert.ok(inventoryProjection.margin.reasonCodes.includes(
    'FACT_MARGIN_INVENTORY_TYPE_PROFILE_MISMATCH',
  ));

  const isolatedInterest = normalizeInput(currentInput('MARGIN_INTEREST', {
    rows: [marginInterestRow({ isolatedSymbol: 'BTCUSDT' })], total: 1,
  }, {
    marginMode: 'ISOLATED',
    queryCoverage: { ...coverage('MARGIN_INTEREST'), isolatedSymbol: 'BTCUSDT' },
    receiptId: receiptId(702),
  }));
  const interestProjection = projectPrivateTruth(projectionInput(
    'MARGIN_NEW_EXPOSURE',
    'BTCUSDT',
    [isolatedInterest],
    crossPermissions,
  ));
  assert.ok(interestProjection.margin.reasonCodes.includes(
    'FACT_MARGIN_MODE_MISMATCH_MARGIN_INTEREST',
  ));
});

test('Foundation reconciliation revision references are closed non-secret namespaces', () => {
  const trade = normalizeInput(currentInput('SPOT_TRADES', [], { receiptId: receiptId(710) }));
  const base = projectionInput('SPOT_NEW_EXPOSURE', 'BTCUSDT', [trade]);
  const { reconciliationObservation: ignored, ...sourceCutInput } = base;
  assert.equal(ignored, null);
  const sourceCutRevision = derivePrivateTruthSourceCutRevision(sourceCutInput);
  const observation = {
    owner: 'FOUNDATION_RECONCILIATION', status: 'EXACT',
    resultRevision: 'foundation-reconciliation-result:000000000000000000000001',
    sourceCutRevision,
    productCutRevisions: {
      SPOT: 'spot_rest_00000000000000000000000000000001',
      USD_M_PERPETUAL: null,
      MARGIN: null,
    },
    observedAtMs: base.evaluatedAtMs,
    executionAuthority: 'NONE',
  };
  const accepted = projectPrivateTruth({ ...base, reconciliationObservation: observation });
  assert.equal(accepted.reconciliationObservation.resultRevision, observation.resultRevision);
  assert.throws(
    () => projectPrivateTruth({
      ...base,
      reconciliationObservation: { ...observation, resultRevision: 'A'.repeat(64) },
    }),
    /unsafe or secret-shaped text|result revision namespace mismatch/i,
  );
  assert.throws(
    () => projectPrivateTruth({
      ...base,
      reconciliationObservation: { ...observation, resultRevision: 'foundation-result:1' },
    }),
    /result revision namespace mismatch/i,
  );
});

test('projection targets and waiting current symbols reject cross-product and L04 grammar mismatch', async (t) => {
  const vectors = [
    ['Spot', 'SPOT_NEW_EXPOSURE', normalizeInput(currentInput('SPOT_TRADES', []))],
    ['USD-M', 'USDM_NEW_EXPOSURE', normalizeInput(currentInput('USDM_TRADES', []))],
    ['Margin', 'MARGIN_NEW_EXPOSURE', normalizeInput(currentInput('MARGIN_TRADES', [], { marginMode: 'CROSS' }))],
  ];
  for (const [name, posture, fact] of vectors) {
    await t.test(name, () => {
      assert.throws(
        () => projectPrivateTruth(projectionInput(posture, 'ETHUSDT', [fact])),
        /query symbol does not match projection target/i,
      );
      const projection = projectPrivateTruth(projectionInput(posture, 'BTCUSDT', [fact]));
      assert.equal(projection.targetSymbol, 'BTCUSDT');
      assertNoAuthority(projection);
      const waiting = decideWaitingPrivateTruth(manualWaitingInput(projection, 'ETHUSDT'));
      assert.equal(waiting.state, 'BLOCKED');
      assert.deepEqual(waiting.reasonCodes, ['CURRENT_SYMBOL_NOT_PROJECTION_TARGET']);
      assertNoAuthority(waiting);
      assertFrozen(waiting);
    });
  }

  for (const targetSymbol of ['', 'btcusdt', ' BTCUSDT', 'BTCUSDT ', 'BTC:USDT']) {
    assert.throws(
      () => projectPrivateTruth(projectionInput('SPOT_NEW_EXPOSURE', targetSymbol, [])),
      /targetSymbol|bounded safe text|canonical L04/i,
    );
  }
  const projection = projectPrivateTruth(projectionInput(
    'SPOT_NEW_EXPOSURE',
    'BTCUSDT',
    [normalizeInput(currentInput('SPOT_TRADES', []))],
  ));
  const badCurrent = decideWaitingPrivateTruth(manualWaitingInput(projection, 'BTC:USDT'));
  assert.equal(badCurrent.state, 'BLOCKED');
  assert.deepEqual(badCurrent.reasonCodes, ['WAITING_PRIVATE_INPUT_REJECTED']);
  assertNoAuthority(badCurrent);
});
