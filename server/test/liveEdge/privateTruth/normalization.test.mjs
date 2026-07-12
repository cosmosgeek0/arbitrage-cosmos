import assert from 'node:assert/strict';
import test from 'node:test';

import {
  L05_BINANCE_MATRIX_SHA256,
  L05_PRIVATE_EMBEDDED_TIME_TOLERANCE_MS,
  L05_PRIVATE_FACT_SCHEMA,
  L05_PRIVATE_FACT_SCHEMA_REVISIONS,
  PRIVATE_DATA_BOUNDS,
  PRIVATE_FACT_CONTRACT_POLICY,
  normalizePrivateFactEvidence,
  resolvePrivateFactContract,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/index.js';

const T0 = 1_800_000_000_000;
const EVALUATED_AT_MS = T0 + 100;
const EMPTY_COVERAGE = Object.freeze({
  omitZeroBalances: null, startTimeMs: null, endTimeMs: null, limit: null,
  orderId: null, fromId: null, cursor: null, page: null, size: null,
  vipLevel: null, isolatedSymbol: null,
});

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
}

function selectedEvidence(factKind, value, overrides = {}) {
  const policy = PRIVATE_FACT_CONTRACT_POLICY[factKind];
  assert.ok(policy, `test fixture requires a policy for ${factKind}`);
  assert.notEqual(policy.contractId, null, `test fixture requires a selected contract for ${factKind}`);
  const resolution = resolvePrivateFactContract(
    factKind,
    L05_BINANCE_MATRIX_SHA256,
    policy.contractId,
  );
  assert.ok(resolution.contract);
  const query = factKind === 'SPOT_OPEN_ORDERS'
    ? { queryScope: 'ALL_SYMBOLS', querySymbol: null }
    : { queryScope: 'ACCOUNT_WIDE', querySymbol: null };
  return {
    schema: L05_PRIVATE_FACT_SCHEMA,
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    factKind,
    product: policy.product,
    environment: 'PRODUCTION',
    realm: resolution.contract.realm,
    accountRealmId: 'account-realm-synthetic-a',
    profileId: 'read-profile-synthetic-a',
    contractId: policy.contractId,
    ...query,
    queryAsset: null,
    queryType: null,
    marginMode: null,
    queryCoverage: factKind === 'SPOT_ACCOUNT'
      ? { kind: 'CURRENT_UNFILTERED', ...EMPTY_COVERAGE, omitZeroBalances: false }
      : { kind: 'CURRENT_UNFILTERED', ...EMPTY_COVERAGE },
    sourceId: resolution.contract.sourceIds[0],
    schemaRevision: L05_PRIVATE_FACT_SCHEMA_REVISIONS[factKind],
    receiptId: 'private-receipt:000000000000000000000001',
    readState: 'OK',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs: T0,
    receivedAtMs: T0 + 50,
    maxAgeMs: 60_000,
    value,
    ...overrides,
  };
}

function spotBalance(asset, free, locked) {
  return { asset, free, locked };
}

function spotAccountValue(overrides = {}) {
  return {
    makerCommission: 10,
    takerCommission: 20,
    buyerCommission: 0,
    sellerCommission: 0,
    commissionRates: {
      maker: '0.00100000',
      taker: '0.00200000',
      buyer: '0.00000000',
      seller: '0.00000000',
    },
    canTrade: true,
    canWithdraw: false,
    canDeposit: true,
    brokered: false,
    requireSelfTradePrevention: true,
    preventSor: false,
    updateTime: T0,
    accountType: 'SPOT',
    balances: [
      spotBalance('ETH', '0002.50000000', '0.00000000'),
      spotBalance('BTC', '0001.23000000', '0.01000000'),
    ],
    permissions: ['SPOT'],
    uid: 42,
    ...overrides,
  };
}

function spotOrder(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    orderId: 20,
    orderListId: -1,
    clientOrderId: 'synthetic-client-order-a',
    price: '60000.00000000',
    origQty: '0.01000000',
    executedQty: '0.00000000',
    cummulativeQuoteQty: '0.00000000',
    status: 'NEW',
    timeInForce: 'GTC',
    type: 'LIMIT',
    side: 'BUY',
    time: T0 - 1_000,
    updateTime: T0,
    isWorking: true,
    origQuoteOrderQty: '0.00000000',
    workingTime: T0 - 1_000,
    selfTradePreventionMode: 'EXPIRE_MAKER',
    ...overrides,
  };
}

function normalize(input) {
  return normalizePrivateFactEvidence(input, EVALUATED_AT_MS);
}

function rerunFromWitness(fact) {
  return normalize({
    schema: fact.schema,
    matrixSha256: fact.matrixSha256,
    factKind: fact.factKind,
    product: fact.product,
    environment: fact.environment,
    realm: fact.realm,
    accountRealmId: fact.accountRealmId,
    profileId: fact.profileId,
    contractId: fact.contractId,
    queryScope: fact.queryScope,
    querySymbol: fact.querySymbol,
    queryAsset: fact.queryAsset,
    queryType: fact.queryType,
    marginMode: fact.marginMode,
    queryCoverage: fact.queryCoverage,
    sourceId: fact.sourceId,
    schemaRevision: fact.schemaRevision,
    receiptId: fact.receiptId,
    readState: fact.readState,
    authority: fact.authority,
    completeness: fact.completeness,
    sourceTimeMs: fact.sourceTimeMs,
    receivedAtMs: fact.receivedAtMs,
    maxAgeMs: fact.maxAgeMs,
    value: fact.injectedValue,
  });
}

function assertNoAuthority(result) {
  assert.equal(result.sendEligible, false);
  assert.equal(result.accountReadAuthority, 'NONE');
  assert.equal(result.mutationAuthority, 'NONE');
  assert.equal(result.reconciliationAuthority, 'NONE');
  assert.equal(result.capitalAuthority, 'NONE');
  assert.equal(result.riskAuthority, 'NONE');
  assert.equal(result.externalActionAuthorization, 'NONE');
  assert.equal(result.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(Object.hasOwn(result, 'ready'), false);
  assert.equal(Object.hasOwn(result, 'tradeReady'), false);
  assert.equal(Object.hasOwn(result, 'executionAuthority'), false);
}

test('normalizes exact Spot decimals, deterministic asset order, immutability, and no authority', () => {
  const input = selectedEvidence('SPOT_ACCOUNT', spotAccountValue());
  const result = normalize(input);

  assert.deepEqual(result.value.balances, [
    { asset: 'BTC', free: '1.23', locked: '0.01' },
    { asset: 'ETH', free: '2.5', locked: '0' },
  ]);
  assert.deepEqual(result.value.commissionRates, {
    maker: '0.001',
    taker: '0.002',
    buyer: '0',
    seller: '0',
  });
  assert.equal(result.freshness.state, 'FRESH');
  assert.equal(result.freshness.basis, 'SOURCE_TIME');
  assert.equal(result.validUntilMs, T0 + 60_000);
  assert.equal(result.usableAsPrivateEvidence, true);
  assert.equal(JSON.stringify(result.injectedValue), JSON.stringify(input.value));
  assert.notEqual(result.injectedValue, input.value);
  assertNoAuthority(result);
  assertDeeplyFrozen(result);
  assert.deepEqual(rerunFromWitness(result), result);
  assert.throws(() => { result.value.balances[0].free = '999'; }, TypeError);
  assert.throws(() => { result.reasonCodes.push('FORGED'); }, TypeError);

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /apiKey|secretKey|privateKey|signature|listenKey|credential/i);
});

test('current embedded timestamps obey the fixed source, receipt, and evaluation cut', () => {
  assert.equal(L05_PRIVATE_EMBEDDED_TIME_TOLERANCE_MS, 2_000);
  const exactBoundaryTime = T0 + 2_050;
  const boundary = normalize(selectedEvidence('SPOT_ACCOUNT', spotAccountValue({
    updateTime: exactBoundaryTime,
  }), {
    sourceTimeMs: T0 + 50,
    receivedAtMs: T0 + 50,
  }));
  assert.equal(boundary.value.updateTime, exactBoundaryTime);
  assert.equal(boundary.usableAsPrivateEvidence, true);

  assert.throws(
    () => normalize(selectedEvidence('SPOT_ACCOUNT', spotAccountValue({
      updateTime: exactBoundaryTime + 1,
    }), {
      sourceTimeMs: T0 + 50,
      receivedAtMs: T0 + 50,
    })),
    /after the current private source cut|locally available before its receipt|evaluation cut/i,
  );

  assert.throws(
    () => normalize(selectedEvidence('SPOT_OPEN_ORDERS', [spotOrder({
      updateTime: T0 + 10_000,
    })])),
    /after the current private source cut|locally available before its receipt|evaluation cut/i,
  );
});

test('timestamped receipt-fallback facts retain the same fixed local causality tolerance', () => {
  const tradingStatus = (updateTime) => ({
    data: {
      isLocked: false,
      plannedRecoverTime: null,
      triggerCondition: { GCR: 0, IFER: 0, UFR: 0 },
      updateTime,
    },
  });
  for (const offsetMs of [1, L05_PRIVATE_EMBEDDED_TIME_TOLERANCE_MS]) {
    const result = normalize(selectedEvidence(
      'SPOT_TRADING_STATUS',
      tradingStatus(T0 + 50 + offsetMs),
      { sourceTimeMs: null, receivedAtMs: T0 + 50 },
    ));
    assert.equal(result.freshness.basis, 'RECEIPT_TIME');
    assert.equal(result.usableAsPrivateEvidence, true);
  }
  assert.throws(
    () => normalize(selectedEvidence(
      'SPOT_TRADING_STATUS',
      tradingStatus(T0 + 50 + L05_PRIVATE_EMBEDDED_TIME_TOLERANCE_MS + 1),
      { sourceTimeMs: null, receivedAtMs: T0 + 50 },
    )),
    /locally available before its receipt/i,
  );
});

test('semantic revision binds the sanitized injected witness even when normalized values match', () => {
  const first = normalize(selectedEvidence('SPOT_ACCOUNT', spotAccountValue({
    balances: [spotBalance('BTC', '01.2300', '0.0100')],
  })));
  const second = normalize(selectedEvidence('SPOT_ACCOUNT', spotAccountValue({
    balances: [spotBalance('BTC', '1.23', '0.01')],
  })));
  assert.deepEqual(first.value, second.value);
  assert.notDeepEqual(first.injectedValue, second.injectedValue);
  assert.notEqual(first.contentRevision, second.contentRevision);
  assert.notEqual(first.evidenceRevision, second.evidenceRevision);
});

test('canonical value ordering is deterministic while revisions bind injected row order', () => {
  const btc = spotOrder();
  const eth = spotOrder({ symbol: 'ETHUSDT', orderId: 3, clientOrderId: 'synthetic-client-order-b' });
  const first = normalize(selectedEvidence('SPOT_OPEN_ORDERS', [eth, btc]));
  const second = normalize(selectedEvidence('SPOT_OPEN_ORDERS', [btc, eth]));

  assert.deepEqual(first.value.map(({ symbol, orderId }) => ({ symbol, orderId })), [
    { symbol: 'BTCUSDT', orderId: '20' },
    { symbol: 'ETHUSDT', orderId: '3' },
  ]);
  assert.deepEqual(first.value, second.value);
  assert.notDeepEqual(first.injectedValue, second.injectedValue);
  assert.notEqual(first.contentRevision, second.contentRevision);
  assert.notEqual(first.evidenceRevision, second.evidenceRevision);
});

test('Spot open orders preserve the closed current conditional field set and reject unknown fields', () => {
  const conditional = normalize(selectedEvidence('SPOT_OPEN_ORDERS', [spotOrder({
    type: 'STOP_LOSS_LIMIT',
    stopPrice: '59000',
    icebergQty: '0.001',
    strategyId: 12,
    strategyType: 1_000_001,
    trailingDelta: 100,
    trailingTime: -1,
    usedSor: true,
    workingFloor: 'SOR',
    pegPriceType: 'PRIMARY_PEG',
    peggedPrice: '59999.5',
    pegOffsetType: 'PRICE_LEVEL',
    pegOffsetValue: 2,
  })]));
  assert.equal(conditional.value[0].trailingTime, -1);
  assert.equal(conditional.value[0].peggedPrice, '59999.5');
  assert.equal(conditional.usableAsPrivateEvidence, true);

  const independent = normalize(selectedEvidence('SPOT_OPEN_ORDERS', [
    spotOrder({ orderId: 21, strategyId: 7, usedSor: false }),
    spotOrder({ orderId: 22, strategyType: 1_000_000, workingFloor: 'EXCHANGE' }),
  ]));
  assert.equal(independent.value[0].strategyId, '7');
  assert.equal(Object.hasOwn(independent.value[0], 'strategyType'), false);
  assert.equal(independent.value[1].strategyType, 1_000_000);
  assert.equal(Object.hasOwn(independent.value[1], 'strategyId'), false);

  assert.throws(
    () => normalize(selectedEvidence('SPOT_OPEN_ORDERS', [spotOrder({ unknownConditional: 'X' })])),
    /exact fields/i,
  );
  assert.throws(
    () => normalize(selectedEvidence('SPOT_OPEN_ORDERS', [spotOrder({ preventedMatchId: 99 })])),
    /exact fields/i,
  );
  assert.throws(
    () => normalize(selectedEvidence('SPOT_OPEN_ORDERS', [spotOrder({ expiryReason: 'EXPIRED' })])),
    /exact fields/i,
  );
});

test('Spot open-order active enums, conditional relations, client IDs, and book-derived fields fail closed', () => {
  const officialLimitSentinels = normalize(selectedEvidence('SPOT_OPEN_ORDERS', [spotOrder({
    stopPrice: '0.00000000',
    icebergQty: '0.00000000',
  })]));
  assert.equal(officialLimitSentinels.value[0].type, 'LIMIT');
  assert.equal(officialLimitSentinels.value[0].stopPrice, '0');
  assert.equal(officialLimitSentinels.value[0].icebergQty, '0');
  assert.equal(officialLimitSentinels.usableAsPrivateEvidence, true);

  const pendingWithSentinel = normalize(selectedEvidence('SPOT_OPEN_ORDERS', [spotOrder({
    status: 'PENDING_NEW',
    isWorking: false,
    workingTime: -1,
  })]));
  assert.equal(pendingWithSentinel.value[0].isWorking, false);
  assert.equal(pendingWithSentinel.value[0].workingTime, -1);
  const pendingWithoutWorkingTime = spotOrder({ status: 'PENDING_NEW', isWorking: false });
  delete pendingWithoutWorkingTime.workingTime;
  const pendingWithoutSentinel = normalize(selectedEvidence(
    'SPOT_OPEN_ORDERS',
    [pendingWithoutWorkingTime],
  ));
  assert.equal(pendingWithoutSentinel.value[0].isWorking, false);
  assert.equal(Object.hasOwn(pendingWithoutSentinel.value[0], 'workingTime'), false);

  for (const mutation of [
    { status: 'FILLED' },
    { type: 'UNKNOWN' },
    { timeInForce: 'GTX' },
    { selfTradePreventionMode: 'UNKNOWN' },
    { workingFloor: 'UNKNOWN' },
    { pegPriceType: 'UNKNOWN' },
    { pegPriceType: 'PRIMARY_PEG', pegOffsetType: 'UNKNOWN', pegOffsetValue: 1 },
    { pegPriceType: 'PRIMARY_PEG', pegOffsetType: 'PRICE_LEVEL', pegOffsetValue: 101 },
    { strategyType: 999_999 },
    { type: 'MARKET', timeInForce: 'IOC' },
    { stopPrice: '59000' },
    { type: 'STOP_LOSS_LIMIT', stopPrice: '0' },
    { icebergQty: '1', timeInForce: 'IOC' },
    { type: 'MARKET', icebergQty: '1' },
    { status: 'PENDING_NEW' },
  ]) {
    assert.throws(
      () => normalize(selectedEvidence('SPOT_OPEN_ORDERS', [spotOrder(mutation)])),
      TypeError,
    );
  }
  const withoutWorkingTime = spotOrder();
  delete withoutWorkingTime.workingTime;
  assert.throws(
    () => normalize(selectedEvidence('SPOT_OPEN_ORDERS', [withoutWorkingTime])),
    /workingTime must identify/i,
  );
  assert.throws(
    () => normalize(selectedEvidence('SPOT_OPEN_ORDERS', [spotOrder({
      isWorking: false,
      workingTime: -1,
      pegPriceType: 'PRIMARY_PEG',
      peggedPrice: '60000',
    })])),
    /peggedPrice requires a working book placement/i,
  );
  for (const clientOrderId of [
    '', 'a'.repeat(37), 'not allowed', 'abc+def',
    'eyJabcde.abcdefgh.ijklmnop',
    'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
    'AKIAIOSFODNN7EXAMPLE',
    'ASIAIOSFODNN7EXAMPLE',
    `AIDA${'A1'.repeat(8)}`,
  ]) {
    assert.throws(
      () => normalize(selectedEvidence('SPOT_OPEN_ORDERS', [spotOrder({ clientOrderId })])),
      /clientOrderId|secret-shaped text|client-order-id grammar/i,
    );
  }
});

test('exact duplicate identities fail closed instead of being silently dropped', () => {
  const row = spotOrder();
  assert.throws(
    () => normalize(selectedEvidence('SPOT_OPEN_ORDERS', [row, structuredClone(row)])),
    /duplicate identity/i,
  );
});

test('conflicting duplicate identities fail closed', () => {
  const row = spotOrder();
  const conflict = spotOrder({ price: '60000.01000000' });
  assert.throws(
    () => normalize(selectedEvidence('SPOT_OPEN_ORDERS', [row, conflict])),
    /conflicting duplicate identity/i,
  );
});

test('rejects non-string, signed, exponent, and overbound account decimals', () => {
  const invalid = [
    1.25,
    '-0.01',
    '1e-8',
    '1'.repeat(97),
  ];
  for (const free of invalid) {
    assert.throws(
      () => normalize(selectedEvidence(
        'SPOT_ACCOUNT',
        spotAccountValue({ balances: [spotBalance('BTC', free, '0')] }),
      )),
      /decimal|digit|non-negative|safe integer/i,
    );
  }
});

test('rejects overbound asset collections rather than truncating private truth', () => {
  const balances = Array.from(
    { length: PRIVATE_DATA_BOUNDS.maximumAssets + 1 },
    (_, index) => spotBalance(`A${index}`, '0', '0'),
  );
  assert.throws(
    () => normalize(selectedEvidence('SPOT_ACCOUNT', spotAccountValue({ balances }))),
    /bounded array|bound exceeded/i,
  );
});

test('hostile graph shapes are rejected without invoking accessors', () => {
  let getterInvoked = false;
  const accessorInput = selectedEvidence('SPOT_ACCOUNT', spotAccountValue());
  Object.defineProperty(accessorInput, 'value', {
    enumerable: true,
    configurable: true,
    get() {
      getterInvoked = true;
      return spotAccountValue();
    },
  });
  assert.throws(() => normalize(accessorInput), /data properties/i);
  assert.equal(getterInvoked, false);

  const inheritedInput = Object.assign(
    Object.create({ inherited: 'forbidden' }),
    selectedEvidence('SPOT_ACCOUNT', spotAccountValue()),
  );
  assert.throws(() => normalize(inheritedInput), /plain objects/i);

  const activeProxy = new Proxy(selectedEvidence('SPOT_ACCOUNT', spotAccountValue()), {});
  assert.throws(() => normalize(activeProxy), /non-proxy/i);

  const revocable = Proxy.revocable(selectedEvidence('SPOT_ACCOUNT', spotAccountValue()), {});
  revocable.revoke();
  assert.throws(() => normalize(revocable.proxy), /non-proxy/i);
});

test('aliases, cycles, sparse arrays, unknown fields, and secret-shaped fields fail closed', () => {
  const shared = spotBalance('BTC', '1', '0');
  assert.throws(
    () => normalize(selectedEvidence(
      'SPOT_ACCOUNT',
      spotAccountValue({ balances: [shared, shared] }),
    )),
    /aliases/i,
  );

  const cyclic = selectedEvidence('SPOT_ACCOUNT', spotAccountValue());
  cyclic.self = cyclic;
  assert.throws(() => normalize(cyclic), /cycles/i);

  const sparse = [];
  sparse.length = 1;
  assert.throws(
    () => normalize(selectedEvidence('SPOT_OPEN_ORDERS', sparse)),
    /dense and unnamed/i,
  );

  assert.throws(
    () => normalize({
      ...selectedEvidence('SPOT_ACCOUNT', spotAccountValue()),
      unexpected: 'forbidden',
    }),
    /exact fields/i,
  );

  assert.throws(
    () => normalize(selectedEvidence('SPOT_ACCOUNT', {
      ...spotAccountValue(),
      apiKey: 'REDACTED',
    })),
    /secret-shaped field name/i,
  );
});

test('schema, matrix, contract, product, realm, and source substitutions fail closed', () => {
  const base = selectedEvidence('SPOT_ACCOUNT', spotAccountValue());
  const cases = [
    [{ ...base, schema: 'L05_BINANCE_PRIVATE_FACT_V0' }, /schema mismatch/i],
    [{ ...base, matrixSha256: '0'.repeat(64) }, /matrix SHA mismatch/i],
    [{ ...base, contractId: 'SPOT_OPEN_ORDERS_QUERY' }, /contract identity mismatch/i],
    [{ ...base, product: 'MARGIN' }, /product does not match/i],
    [{ ...base, realm: 'PRIVATE_MARGIN_ACCOUNT' }, /realm does not match/i],
    [{ ...base, sourceId: 'UNBOUND_SYNTHETIC_SOURCE' }, /sourceId is not bound/i],
  ];
  for (const [input, expected] of cases) assert.throws(() => normalize(input), expected);
});

test('generic credential-shaped account and profile references are rejected', () => {
  const base = selectedEvidence('SPOT_ACCOUNT', spotAccountValue());
  const generic64 = 'A'.repeat(64);
  assert.throws(
    () => normalize({ ...base, accountRealmId: generic64 }),
    /unsafe or secret-shaped text|namespaced account-realm reference/i,
  );
  assert.throws(
    () => normalize({ ...base, profileId: generic64 }),
    /unsafe or secret-shaped text|namespaced profile reference/i,
  );
  assert.throws(
    () => normalize({ ...base, schemaRevision: generic64 }),
    /unsafe or secret-shaped text|closed per-fact L05 schema/i,
  );
  assert.throws(
    () => normalize({ ...base, receiptId: generic64 }),
    /unsafe or secret-shaped text|exact non-secret receipt reference/i,
  );
});

test('caller-declared private fact age cannot exceed the five-minute bound', () => {
  assert.equal(PRIVATE_DATA_BOUNDS.maximumFactAgeMs, 300_000);
  assert.throws(
    () => normalize(selectedEvidence('SPOT_ACCOUNT', spotAccountValue(), { maxAgeMs: 300_001 })),
    /bounded safe integer/i,
  );
});

test('public or unavailable authority can never be promoted into usable private evidence', () => {
  const publicResult = normalize(selectedEvidence('SPOT_ACCOUNT', spotAccountValue(), {
    authority: 'LIVE_PUBLIC',
  }));
  assert.equal(publicResult.usableAsPrivateEvidence, false);
  assert.ok(publicResult.reasonCodes.includes('PRIVATE_AUTHORITY_REQUIRED'));
  assertNoAuthority(publicResult);

  const unavailable = normalize(selectedEvidence('SPOT_ACCOUNT', null, {
    readState: 'SOURCE_ERROR',
    authority: 'UNAVAILABLE',
    completeness: 'UNAVAILABLE',
    sourceTimeMs: null,
  }));
  assert.equal(unavailable.value, null);
  assert.equal(unavailable.freshness.state, 'UNAVAILABLE');
  assert.equal(unavailable.usableAsPrivateEvidence, false);
  assertNoAuthority(unavailable);
});
