import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RUNTIME_UNIVERSE_DEFAULTS,
  RUNTIME_UNIVERSE_SOURCE_IDS,
  parseExchangeInformation,
} from '../../../dist/intelligenceRuntime/universe/index.js';
import {
  BINANCE_FILTER_REFERENCE_SCHEMA,
  L04_BINANCE_MATRIX_SHA256,
  L04_EXCHANGE_INFO_CONTRACT_IDS,
  decideWaitingInstrumentRevision,
  deriveFilterReferenceEvidenceRevision,
  deriveInstrumentEvidenceRevision,
  deriveInstrumentRevision,
  deriveRegistryRevision,
  deriveSnapshotRevision,
  normalizeRuntimeInstrumentRegistry,
  requiredFilterReferenceEvidence,
  validateInstrumentRegistrySnapshot,
} from '../../../dist/liveEdge/adapters/binanceInstrumentSpecs/index.js';

const T0 = 1_800_000_000_000;
const MAXIMUM_AGE_MS = 60_000;
const CONFIG = Object.freeze({
  ...RUNTIME_UNIVERSE_DEFAULTS,
  configurationVersion: 'l04-waiting-test-v1',
  universePolicy: Object.freeze({ ...RUNTIME_UNIVERSE_DEFAULTS.universePolicy }),
});

function deeplyFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deeplyFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
}

function spotFilters(overrides = {}) {
  return [
    {
      filterType: 'PRICE_FILTER',
      minPrice: '0.01000000',
      maxPrice: '1000000.00000000',
      tickSize: overrides.tickSize ?? '0.01000000',
    },
    {
      filterType: 'LOT_SIZE',
      minQty: '0.00001000',
      maxQty: '9000.00000000',
      stepSize: '0.00001000',
    },
    {
      filterType: 'NOTIONAL',
      minNotional: '5.00000000',
      applyMinToMarket: true,
      maxNotional: '100000.00000000',
      applyMaxToMarket: false,
      avgPriceMins: 5,
    },
    ...(overrides.additional ?? []),
  ];
}

function spotRow(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    status: 'TRADING',
    baseAsset: 'BTC',
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

function usdMFilters(overrides = {}) {
  return [
    {
      filterType: 'PRICE_FILTER',
      minPrice: '0.100',
      maxPrice: '1000000.000',
      tickSize: overrides.tickSize ?? '0.100',
    },
    {
      filterType: 'LOT_SIZE',
      minQty: '0.001',
      maxQty: '1000.000',
      stepSize: '0.001',
    },
    { filterType: 'MIN_NOTIONAL', notional: '5.000' },
    ...(overrides.additional ?? []),
  ];
}

function usdMRow(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    pair: 'BTCUSDT',
    contractType: 'PERPETUAL',
    deliveryDate: 4_133_404_800_000,
    onboardDate: T0 - 365 * 24 * 60 * 60_000,
    status: 'TRADING',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    marginAsset: 'USDT',
    pricePrecision: 3,
    quantityPrecision: 3,
    baseAssetPrecision: 8,
    quotePrecision: 8,
    underlyingType: 'COIN',
    underlyingSubType: ['Layer-1'],
    orderTypes: ['LIMIT', 'MARKET'],
    timeInForce: ['GTC', 'IOC'],
    filters: usdMFilters(),
    ...overrides,
  };
}

function genuineSnapshot(product = 'SPOT', rowOverrides = {}) {
  const source = product === 'USD_M_PERPETUAL' ? 'USD_M_PERPETUAL' : 'SPOT';
  const parsed = parseExchangeInformation(
    {
      timezone: 'UTC',
      serverTime: T0 - 10,
      exchangeFilters: [],
      symbols: [source === 'USD_M_PERPETUAL' ? usdMRow(rowOverrides) : spotRow(rowOverrides)],
    },
    {
      source,
      sourceId: RUNTIME_UNIVERSE_SOURCE_IDS[source],
      dataset: source === 'SPOT' ? 'spot.exchange_info' : 'usd_m.exchange_info',
      receivedTimeMs: T0,
      evaluatedAtMs: T0,
      config: CONFIG,
    },
  );
  assert.equal(parsed.listings.length, 1, 'fixture must remain genuine Runtime owner evidence');
  const result = normalizeRuntimeInstrumentRegistry({
    matrixSha256: L04_BINANCE_MATRIX_SHA256,
    contractId: L04_EXCHANGE_INFO_CONTRACT_IDS[product],
    product,
    environment: 'PRODUCTION',
    evaluatedAtMs: T0,
    maximumAgeMs: MAXIMUM_AGE_MS,
    metadata: parsed.listings.map((listing) => structuredClone(listing.metadata)),
  });
  assert.equal(result.ok, true, `fixture must normalize for ${product}`);
  assert.doesNotThrow(
    () => validateInstrumentRegistrySnapshot(result.snapshot),
    `normalized ${product} snapshot must satisfy the shared snapshot validator`,
  );
  return result.snapshot;
}

function frozenMutation(snapshot, mutate) {
  const clone = structuredClone(snapshot);
  mutate(clone);
  return deeplyFreeze(clone);
}

function coherentFrozenMutation(snapshot, mutateInstrument) {
  const clone = structuredClone(snapshot);
  mutateInstrument(clone.instruments[0]);
  clone.instruments[0].instrumentRevision = deriveInstrumentRevision(
    clone.matrixSha256,
    clone.instruments[0],
  );
  clone.registryRevision = deriveRegistryRevision(clone);
  return deeplyFreeze(clone);
}

function coherentSourceTimeMutation(snapshot, deltaMs) {
  const clone = structuredClone(snapshot);
  clone.evaluatedAtMs += deltaMs;
  clone.instruments[0].sourceReceivedAtMs += deltaMs;
  clone.instruments[0].sourceValidUntilMs += deltaMs;
  clone.instruments[0].sourceEvidenceRevision = deriveInstrumentEvidenceRevision(clone.instruments[0]);
  clone.snapshotRevision = deriveSnapshotRevision(clone);
  return deeplyFreeze(clone);
}

function coherentSnapshotTimeMutation(snapshot, deltaMs) {
  const clone = structuredClone(snapshot);
  clone.evaluatedAtMs += deltaMs;
  clone.snapshotRevision = deriveSnapshotRevision(clone);
  return deeplyFreeze(clone);
}

function referenceEvidence(snapshot, overrides = {}) {
  const instrument = snapshot.instruments[0];
  const orderType = overrides.orderType ?? 'MARKET';
  const requirement = requiredFilterReferenceEvidence(instrument, orderType);
  assert.notEqual(requirement, 'CONFLICT', 'test reference requirements must not conflict');
  const kind = overrides.kind ?? (requirement?.kind ?? 'WEIGHTED_AVERAGE');
  const averagingWindowMins = Object.hasOwn(overrides, 'averagingWindowMins')
    ? overrides.averagingWindowMins
    : (requirement !== null && requirement !== 'CONFLICT'
      ? requirement.averagingWindowMins
      : 5);
  const projection = {
    schema: overrides.schema ?? BINANCE_FILTER_REFERENCE_SCHEMA,
    producer: overrides.producer ?? 'INTELLIGENCE_RUNTIME',
    product: overrides.product ?? instrument.product,
    symbol: overrides.symbol ?? instrument.symbol,
    instrumentRevision: overrides.instrumentRevision ?? instrument.instrumentRevision,
    kind,
    averagingWindowMins,
    price: overrides.price ?? '1',
    observedAtMs: overrides.observedAtMs ?? T0,
    validUntilMs: overrides.validUntilMs ?? T0 + 5_000,
    sourceTruthId: overrides.sourceTruthId ?? 'runtime-filter-reference:waiting-test-v1',
    documentaryAuthority: overrides.documentaryAuthority ?? 'DOCUMENTARY_EVIDENCE_ONLY',
    externalActionAuthorization: overrides.externalActionAuthorization ?? 'NONE',
    actionAuthority: overrides.actionAuthority ?? 'NONE_RECORD_ONLY',
  };
  return deeplyFreeze({
    ...projection,
    evidenceRevision: overrides.evidenceRevision
      ?? deriveFilterReferenceEvidenceRevision(projection),
  });
}

function binding(snapshot, overrides = {}) {
  const instrument = snapshot.instruments[0];
  const defaultOrderType = instrument.allowedTimeInForce.length > 0 ? 'LIMIT' : 'MARKET';
  const orderType = overrides.orderType ?? defaultOrderType;
  const timeInForce = Object.hasOwn(overrides, 'timeInForce')
    ? overrides.timeInForce
    : (orderType === 'LIMIT' ? instrument.allowedTimeInForce[0] ?? 'GTC' : null);
  const requirement = requiredFilterReferenceEvidence(instrument, orderType);
  const reference = Object.hasOwn(overrides, 'referenceEvidence')
    ? overrides.referenceEvidence
    : (requirement !== null && requirement !== 'CONFLICT'
      ? referenceEvidence(snapshot, { orderType })
      : null);
  return deeplyFreeze({
    symbol: instrument.symbol,
    instrumentRevision: instrument.instrumentRevision,
    sourceEvidenceRevision: instrument.sourceEvidenceRevision,
    snapshotRevision: snapshot.snapshotRevision,
    evaluatedAtMs: snapshot.evaluatedAtMs,
    orderType,
    timeInForce,
    notionalAsset: 'USDT',
    referenceEvidence: reference,
    ...overrides,
  });
}

function expected(
  state,
  reasonCodes,
  instrumentRevision,
  referenceEvidenceRevision = null,
  sourceEvidenceRevision = null,
  snapshotRevision = null,
) {
  return {
    state,
    reasonCodes,
    instrumentRevision,
    sourceEvidenceRevision,
    snapshotRevision,
    referenceEvidenceRevision,
    sendEligible: false,
    externalActionAuthorization: 'NONE',
  };
}

function expectedBound(
  snapshot,
  state,
  reasonCodes,
  referenceEvidenceRevision = null,
  instrumentRevision = snapshot.instruments[0].instrumentRevision,
) {
  return expected(
    state,
    reasonCodes,
    instrumentRevision,
    referenceEvidenceRevision,
    snapshot.instruments[0].sourceEvidenceRevision,
    snapshot.snapshotRevision,
  );
}

function assertNonActionable(result) {
  assert.equal(result.sendEligible, false);
  assert.equal(result.externalActionAuthorization, 'NONE');
  assertDeeplyFrozen(result);
}

test('a genuine normalized current revision remains documentary and never send eligible', () => {
  const snapshot = genuineSnapshot();
  const instrument = snapshot.instruments[0];
  const revision = instrument.instrumentRevision;
  assert.equal(instrument.sourceAuthorityId, RUNTIME_UNIVERSE_SOURCE_IDS.SPOT);
  assert.equal(instrument.sourceDataset, 'spot.exchange_info');
  assert.equal(instrument.sourceMaximumAgeMs, MAXIMUM_AGE_MS);
  assert.equal(
    instrument.sourceValidUntilMs,
    instrument.sourceReceivedAtMs + instrument.sourceMaximumAgeMs,
  );
  const currentBinding = binding(snapshot);
  const result = decideWaitingInstrumentRevision(snapshot, currentBinding);
  assert.deepEqual(result, expectedBound(
    snapshot,
    'CURRENT',
    [],
    currentBinding.referenceEvidence.evidenceRevision,
  ));
  assert.equal(result.instrumentRevision, revision);
  assert.equal(result.sourceEvidenceRevision, instrument.sourceEvidenceRevision);
  assert.equal(result.snapshotRevision, snapshot.snapshotRevision);
  assertNonActionable(result);
  assert.throws(() => result.reasonCodes.push('MUTATION'), TypeError);
});

test('a genuine normalized content revision change always requires a new preflight', () => {
  const prior = genuineSnapshot();
  const changed = genuineSnapshot('SPOT', { filters: spotFilters({ tickSize: '0.02000000' }) });
  const currentRevision = changed.instruments[0].instrumentRevision;
  assert.notEqual(currentRevision, prior.instruments[0].instrumentRevision);
  const result = decideWaitingInstrumentRevision(changed, binding(prior));
  assert.deepEqual(result, expectedBound(
    changed,
    'REVALIDATION_REQUIRED',
    ['INSTRUMENT_REVISION_CHANGED'],
    null,
    currentRevision,
  ));
  assertNonActionable(result);
});

test('source-evidence and snapshot revision changes independently require revalidation', async (t) => {
  const original = genuineSnapshot();
  const sourceChanged = coherentSourceTimeMutation(original, 1);
  const snapshotChanged = coherentSnapshotTimeMutation(original, 1);
  assert.equal(
    sourceChanged.instruments[0].instrumentRevision,
    original.instruments[0].instrumentRevision,
  );
  assert.notEqual(
    sourceChanged.instruments[0].sourceEvidenceRevision,
    original.instruments[0].sourceEvidenceRevision,
  );
  assert.equal(
    snapshotChanged.instruments[0].sourceEvidenceRevision,
    original.instruments[0].sourceEvidenceRevision,
  );
  assert.notEqual(snapshotChanged.snapshotRevision, original.snapshotRevision);
  const cases = [
    [
      'source evidence changed',
      sourceChanged,
      expectedBound(
        sourceChanged,
        'REVALIDATION_REQUIRED',
        ['SOURCE_EVIDENCE_REVISION_CHANGED'],
      ),
    ],
    [
      'snapshot changed',
      snapshotChanged,
      expectedBound(
        snapshotChanged,
        'REVALIDATION_REQUIRED',
        ['SNAPSHOT_REVISION_CHANGED'],
      ),
    ],
  ];
  for (const [name, snapshot, expectedDecision] of cases) {
    await t.test(name, () => {
      const result = decideWaitingInstrumentRevision(snapshot, binding(original));
      assert.deepEqual(result, expectedDecision);
      assertNonActionable(result);
    });
  }
});

test('LIMIT and MARKET time-in-force posture fails closed at the exact product boundary', async (t) => {
  const spot = genuineSnapshot();
  const usdM = genuineSnapshot('USD_M_PERPETUAL');
  const cases = [
    [
      'Spot LIMIT cannot treat unproved GTC as advertised symbol truth',
      spot,
      binding(spot, { orderType: 'LIMIT', timeInForce: 'GTC', referenceEvidence: null }),
      expectedBound(spot, 'BLOCKED', ['TIME_IN_FORCE_NO_LONGER_STATIC_READY']),
    ],
    [
      'USD-M LIMIT accepts exact advertised GTC',
      usdM,
      binding(usdM, { orderType: 'LIMIT', timeInForce: 'GTC', referenceEvidence: null }),
      expectedBound(usdM, 'CURRENT', []),
    ],
    [
      'USD-M LIMIT rejects an unadvertised TIF',
      usdM,
      binding(usdM, { orderType: 'LIMIT', timeInForce: 'PO', referenceEvidence: null }),
      expectedBound(usdM, 'BLOCKED', ['TIME_IN_FORCE_NO_LONGER_STATIC_READY']),
    ],
    [
      'USD-M LIMIT rejects missing TIF as invalid input',
      usdM,
      binding(usdM, { orderType: 'LIMIT', timeInForce: null, referenceEvidence: null }),
      expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null),
    ],
    [
      'MARKET blocks a non-null TIF',
      usdM,
      binding(usdM, { orderType: 'MARKET', timeInForce: 'GTC' }),
      expectedBound(usdM, 'BLOCKED', ['MARKET_TIME_IN_FORCE_MUST_BE_NULL']),
    ],
  ];
  for (const [name, snapshot, bindingValue, expectedDecision] of cases) {
    await t.test(name, () => {
      const result = decideWaitingInstrumentRevision(snapshot, bindingValue);
      assert.deepEqual(result, expectedDecision);
      assertNonActionable(result);
    });
  }
});

test('waiting binds the canary notional asset and blocks non-USDT quote products', async (t) => {
  const snapshot = genuineSnapshot();
  const validBinding = binding(snapshot);
  const { notionalAsset: _omitted, ...missingNotionalAsset } = validBinding;
  const cases = [
    [
      'wrong requested notional asset',
      snapshot,
      binding(snapshot, { notionalAsset: 'BTC' }),
      expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null),
    ],
    [
      'missing requested notional asset',
      snapshot,
      missingNotionalAsset,
      expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null),
    ],
  ];
  for (const [symbol, baseAsset, quoteAsset] of [
    ['ETHBTC', 'ETH', 'BTC'],
    ['ETHUSDC', 'ETH', 'USDC'],
  ]) {
    const nonUsdt = genuineSnapshot('SPOT', { symbol, baseAsset, quoteAsset });
    cases.push([
      `${symbol} is outside the USDT canary envelope`,
      nonUsdt,
      binding(nonUsdt),
      expectedBound(nonUsdt, 'BLOCKED', ['CANARY_QUOTE_ASSET_NOT_USDT']),
    ]);
  }
  for (const [name, registry, bindingValue, expectedDecision] of cases) {
    await t.test(name, () => {
      const result = decideWaitingInstrumentRevision(registry, bindingValue);
      assert.deepEqual(result, expectedDecision);
      assertNonActionable(result);
    });
  }
});

test('source evidence and future-clock-skew boundaries use exact injected evaluation time', async (t) => {
  const snapshot = genuineSnapshot('USD_M_PERPETUAL');
  const instrument = snapshot.instruments[0];
  const cases = [
    [
      'exact valid-until remains current',
      instrument.sourceValidUntilMs,
      expectedBound(snapshot, 'CURRENT', []),
    ],
    [
      'one millisecond after valid-until requires revalidation',
      instrument.sourceValidUntilMs + 1,
      expectedBound(
        snapshot,
        'REVALIDATION_REQUIRED',
        ['INSTRUMENT_SOURCE_EVIDENCE_EXPIRED'],
      ),
    ],
    [
      'exact future-skew allowance remains current',
      instrument.sourceReceivedAtMs - 2_000,
      expectedBound(snapshot, 'CURRENT', []),
    ],
    [
      'one millisecond beyond future-skew allowance blocks',
      instrument.sourceReceivedAtMs - 2_001,
      expectedBound(
        snapshot,
        'BLOCKED',
        ['INSTRUMENT_SOURCE_CLOCK_SKEWED'],
      ),
    ],
  ];
  for (const [name, evaluatedAtMs, expectedDecision] of cases) {
    await t.test(name, () => {
      const result = decideWaitingInstrumentRevision(
        snapshot,
        binding(snapshot, { evaluatedAtMs }),
      );
      assert.deepEqual(result, expectedDecision);
      assertNonActionable(result);
    });
  }
});

test('MARKET waiting requires exact closed filter-reference evidence', async (t) => {
  const snapshot = genuineSnapshot();
  const instrumentRevision = snapshot.instruments[0].instrumentRevision;
  const validEvidence = referenceEvidence(snapshot);
  const skewedEvidence = referenceEvidence(snapshot, {
    observedAtMs: T0 + 1_000,
    validUntilMs: T0 + 5_000,
  });
  const cases = [
    [
      'exact reference valid-until remains current and echoes its revision',
      binding(snapshot, {
        orderType: 'MARKET',
        referenceEvidence: validEvidence,
        evaluatedAtMs: validEvidence.validUntilMs,
      }),
      expectedBound(snapshot, 'CURRENT', [], validEvidence.evidenceRevision),
    ],
    [
      'one millisecond after reference valid-until requires revalidation',
      binding(snapshot, {
        orderType: 'MARKET',
        referenceEvidence: validEvidence,
        evaluatedAtMs: validEvidence.validUntilMs + 1,
      }),
      expectedBound(
        snapshot,
        'REVALIDATION_REQUIRED',
        ['FILTER_REFERENCE_EVIDENCE_EXPIRED'],
        validEvidence.evidenceRevision,
      ),
    ],
    [
      'reference observation more than 2000ms ahead blocks as clock skew',
      binding(snapshot, {
        orderType: 'MARKET',
        referenceEvidence: skewedEvidence,
        evaluatedAtMs: T0 - 1_001,
      }),
      expectedBound(
        snapshot,
        'BLOCKED',
        ['FILTER_REFERENCE_SOURCE_CLOCK_SKEWED'],
        skewedEvidence.evidenceRevision,
      ),
    ],
    [
      'required MARKET reference omission requires revalidation',
      binding(snapshot, { orderType: 'MARKET', referenceEvidence: null }),
      expectedBound(
        snapshot,
        'REVALIDATION_REQUIRED',
        ['FILTER_REFERENCE_EVIDENCE_REQUIRED'],
      ),
    ],
  ];
  for (const [name, bindingValue, expectedDecision] of cases) {
    await t.test(name, () => {
      const result = decideWaitingInstrumentRevision(snapshot, bindingValue);
      assert.deepEqual(result, expectedDecision);
      assertNonActionable(result);
    });
  }
});

test('LIMIT waiting follows current percent-filter reference requirements', () => {
  const snapshot = genuineSnapshot('USD_M_PERPETUAL', {
    filters: usdMFilters({ additional: [{
      filterType: 'PERCENT_PRICE',
      multiplierUp: '1.2000',
      multiplierDown: '0.8000',
      multiplierDecimal: 4,
    }] }),
  });
  const instrumentRevision = snapshot.instruments[0].instrumentRevision;
  const missing = decideWaitingInstrumentRevision(snapshot, binding(snapshot, {
    referenceEvidence: null,
  }));
  assert.deepEqual(missing, expectedBound(
    snapshot,
    'REVALIDATION_REQUIRED',
    ['FILTER_REFERENCE_EVIDENCE_REQUIRED'],
  ));
  const evidence = referenceEvidence(snapshot, { orderType: 'LIMIT' });
  const current = decideWaitingInstrumentRevision(snapshot, binding(snapshot, {
    orderType: 'LIMIT',
    referenceEvidence: evidence,
  }));
  assert.deepEqual(current, expectedBound(snapshot, 'CURRENT', [], evidence.evidenceRevision));
  assertNonActionable(missing);
  assertNonActionable(current);
});

test('non-applicable reference evidence blocks a USD-M LIMIT without percent filters', () => {
  const snapshot = genuineSnapshot('USD_M_PERPETUAL');
  const evidence = referenceEvidence(snapshot, { orderType: 'MARKET' });
  const result = decideWaitingInstrumentRevision(snapshot, binding(snapshot, {
    orderType: 'LIMIT',
    timeInForce: 'GTC',
    referenceEvidence: evidence,
  }));
  assert.deepEqual(result, expectedBound(
    snapshot,
    'BLOCKED',
    ['FILTER_REFERENCE_EVIDENCE_NOT_APPLICABLE'],
  ));
  assertNonActionable(result);
});

test('fictional, foreign, tampered, and overextended reference objects reject', async (t) => {
  const snapshot = genuineSnapshot();
  const cases = [
    ['fictional schema', referenceEvidence(snapshot, { schema: 'FICTIONAL_FILTER_REFERENCE' })],
    ['foreign symbol', referenceEvidence(snapshot, { symbol: 'ETHUSDT' })],
    ['wrong instrument revision', referenceEvidence(snapshot, {
      instrumentRevision: 'l04-instrument-spec:foreign',
    })],
    ['tampered evidence revision', referenceEvidence(snapshot, {
      evidenceRevision: 'l04-filter-reference:tampered',
    })],
    ['extended validity', referenceEvidence(snapshot, { validUntilMs: T0 + 5_001 })],
  ];
  for (const [name, evidence] of cases) {
    await t.test(name, () => {
      const result = decideWaitingInstrumentRevision(snapshot, binding(snapshot, {
        orderType: 'MARKET',
        referenceEvidence: evidence,
      }));
      assert.deepEqual(result, expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null));
      assertNonActionable(result);
    });
  }
});

test('a missing waiting symbol blocks without substituting another instrument', () => {
  const snapshot = genuineSnapshot();
  const result = decideWaitingInstrumentRevision(snapshot, binding(snapshot, { symbol: 'ETHUSDT' }));
  assert.deepEqual(result, expected('BLOCKED', ['WAITING_SYMBOL_MISSING'], null));
  assertNonActionable(result);
});

test('genuine non-trading, source-blocked, and owner-blocked snapshots cannot remain current', async (t) => {
  const cases = [
    ['non-trading status', genuineSnapshot('SPOT', { status: 'BREAK' })],
    ['blocked filter source', genuineSnapshot('SPOT', {
      filters: spotFilters({ additional: [{ filterType: 'T_PLUS_SELL', value: 'UNSUPPORTED' }] }),
    })],
    ['missing Margin owner truth', genuineSnapshot('MARGIN', {
      isMarginTradingAllowed: true,
      permissionSets: [['MARGIN']],
    })],
  ];
  for (const [name, snapshot] of cases) {
    await t.test(name, () => {
      const revision = snapshot.instruments[0].instrumentRevision;
      const result = decideWaitingInstrumentRevision(snapshot, binding(snapshot));
      assert.deepEqual(result, expectedBound(
        snapshot,
        'BLOCKED',
        ['INSTRUMENT_NO_LONGER_STATIC_READY'],
      ));
      assert.equal(result.instrumentRevision, revision);
      assertNonActionable(result);
    });
  }
});

test('a coherently re-derived READY plus non-TRADING mutation is an invalid snapshot', () => {
  const original = genuineSnapshot();
  const changed = coherentFrozenMutation(original, (instrument) => {
    instrument.status = 'BREAK';
  });
  const revision = changed.instruments[0].instrumentRevision;
  assert.notEqual(revision, original.instruments[0].instrumentRevision);
  const result = decideWaitingInstrumentRevision(changed, binding(changed));
  assert.deepEqual(result, expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null));
  assertNonActionable(result);
});

test('invalid snapshot identity, authority, bounds, and stale revisions are named rejected input', async (t) => {
  const snapshot = genuineSnapshot();
  const cases = [
    ['schema', frozenMutation(snapshot, (value) => { value.schema = 'BINANCE_INSTRUMENT_REGISTRY_V0'; })],
    ['environment', frozenMutation(snapshot, (value) => { value.environment = 'TESTNET'; })],
    ['documentary authority', frozenMutation(snapshot, (value) => { value.documentaryAuthority = 'TRADING_AUTHORITY'; })],
    ['external authorization', frozenMutation(snapshot, (value) => { value.externalActionAuthorization = 'GRANTED'; })],
    ['action authority', frozenMutation(snapshot, (value) => { value.actionAuthority = 'SEND'; })],
    ['empty instruments', frozenMutation(snapshot, (value) => { value.instruments = []; })],
    ['stale instrument revision', frozenMutation(snapshot, (value) => { value.instruments[0].status = 'BREAK'; })],
    ['stale registry revision', frozenMutation(snapshot, (value) => { value.registryRevision = 'l04-instrument-registry:tampered'; })],
    ['timestamp-only forgery without revised evidence bindings', frozenMutation(snapshot, (value) => {
      value.evaluatedAtMs += 1;
      value.instruments[0].sourceReceivedAtMs += 1;
      value.instruments[0].sourceValidUntilMs += 1;
    })],
  ];
  for (const [name, snapshotValue] of cases) {
    await t.test(name, () => {
      const result = decideWaitingInstrumentRevision(snapshotValue, binding(snapshot));
      assert.deepEqual(result, expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null));
      assertNonActionable(result);
    });
  }
});

test('snapshot age, source time, identity, mandatory loss, and capability tampering is rejected', async (t) => {
  const snapshot = genuineSnapshot();
  const instrument = snapshot.instruments[0];
  const cases = [
    ['snapshot maximum age above L04 bound', frozenMutation(snapshot, (value) => {
      value.maximumAgeMs = 300_001;
    })],
    ['source maximum age above snapshot bound', coherentFrozenMutation(snapshot, (value) => {
      value.sourceMaximumAgeMs = snapshot.maximumAgeMs + 1;
      value.sourceValidUntilMs = value.sourceReceivedAtMs + value.sourceMaximumAgeMs;
    })],
    ['source valid-until inconsistent with maximum age', frozenMutation(snapshot, (value) => {
      value.instruments[0].sourceValidUntilMs += 1;
    })],
    ['READY snapshot evaluation precedes source skew bound', frozenMutation(snapshot, (value) => {
      value.evaluatedAtMs = instrument.sourceReceivedAtMs - 2_001;
    })],
    ['symbol and pair diverge', coherentFrozenMutation(snapshot, (value) => {
      value.pair = 'ETHUSDT';
    })],
    ['mandatory owner-loss posture removed', coherentFrozenMutation(snapshot, (value) => {
      value.lossCodes = value.lossCodes.filter(
        (code) => code !== 'EXACT_L02_RESPONSE_HOST_BINDING_UNPROVED',
      );
    })],
    ['static capability diverges from advertised capability', coherentFrozenMutation(snapshot, (value) => {
      value.staticOrderTypes = ['LIMIT'];
    })],
  ];
  for (const [name, snapshotValue] of cases) {
    await t.test(name, () => {
      const result = decideWaitingInstrumentRevision(snapshotValue, binding(snapshot));
      assert.deepEqual(result, expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null));
      assertNonActionable(result);
    });
  }
});

test('top-level inputs require exact enumerable own data fields without invoking accessors', async (t) => {
  const snapshot = genuineSnapshot();
  const validBinding = binding(snapshot);
  const extraSnapshot = frozenMutation(snapshot, (value) => { value.extra = true; });
  const extraBinding = { ...validBinding, extra: true };
  const inheritedBinding = Object.assign(Object.create({ inherited: true }), validBinding);
  const symbolKeyBinding = { ...validBinding, [Symbol('hidden')]: true };
  const nonEnumerableBinding = { ...validBinding };
  Object.defineProperty(nonEnumerableBinding, 'symbol', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: 'BTCUSDT',
  });

  let bindingAccessorReads = 0;
  const accessorBinding = {
    symbol: 'BTCUSDT',
    sourceEvidenceRevision: validBinding.sourceEvidenceRevision,
    snapshotRevision: validBinding.snapshotRevision,
    evaluatedAtMs: snapshot.evaluatedAtMs,
    orderType: 'LIMIT',
    timeInForce: 'GTC',
    notionalAsset: 'USDT',
    referenceEvidence: null,
  };
  Object.defineProperty(accessorBinding, 'instrumentRevision', {
    configurable: true,
    enumerable: true,
    get() {
      bindingAccessorReads += 1;
      return validBinding.instrumentRevision;
    },
  });

  let timeAccessorReads = 0;
  const timeAccessorBinding = {
    symbol: validBinding.symbol,
    instrumentRevision: validBinding.instrumentRevision,
    sourceEvidenceRevision: validBinding.sourceEvidenceRevision,
    snapshotRevision: validBinding.snapshotRevision,
    orderType: 'LIMIT',
    timeInForce: 'GTC',
    notionalAsset: 'USDT',
    referenceEvidence: null,
  };
  Object.defineProperty(timeAccessorBinding, 'evaluatedAtMs', {
    configurable: true,
    enumerable: true,
    get() {
      timeAccessorReads += 1;
      return snapshot.evaluatedAtMs;
    },
  });

  let snapshotAccessorReads = 0;
  const accessorSnapshot = { ...snapshot };
  Object.defineProperty(accessorSnapshot, 'instruments', {
    configurable: true,
    enumerable: true,
    get() {
      snapshotAccessorReads += 1;
      return snapshot.instruments;
    },
  });
  Object.freeze(accessorSnapshot);

  const cases = [
    ['extra snapshot field', extraSnapshot, validBinding],
    ['extra binding field', snapshot, extraBinding],
    ['inherited binding', snapshot, inheritedBinding],
    ['symbol-key binding', snapshot, symbolKeyBinding],
    ['non-enumerable binding', snapshot, nonEnumerableBinding],
    ['binding accessor', snapshot, accessorBinding],
    ['evaluation-time accessor', snapshot, timeAccessorBinding],
    ['snapshot accessor', accessorSnapshot, validBinding],
    ['array snapshot', [], validBinding],
    ['missing evaluation time', snapshot, {
      symbol: validBinding.symbol,
      instrumentRevision: validBinding.instrumentRevision,
      sourceEvidenceRevision: validBinding.sourceEvidenceRevision,
      snapshotRevision: validBinding.snapshotRevision,
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      notionalAsset: 'USDT',
      referenceEvidence: null,
    }],
    ['null binding', snapshot, null],
  ];
  for (const [name, snapshotValue, bindingValue] of cases) {
    await t.test(name, () => {
      const result = decideWaitingInstrumentRevision(snapshotValue, bindingValue);
      assert.deepEqual(result, expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null));
      assertNonActionable(result);
    });
  }
  assert.equal(bindingAccessorReads, 0, 'binding accessor must not be invoked');
  assert.equal(timeAccessorReads, 0, 'evaluation-time accessor must not be invoked');
  assert.equal(snapshotAccessorReads, 0, 'snapshot accessor must not be invoked');
});

test('waiting accepts only the immutable, alias-free snapshot graph emitted by normalization', async (t) => {
  const snapshot = genuineSnapshot();
  const mutableTopLevel = { ...snapshot };
  const mutableInstrumentArray = Object.freeze({ ...snapshot, instruments: [...snapshot.instruments] });
  const mutableInstrument = Object.freeze({
    ...snapshot,
    instruments: Object.freeze([{ ...snapshot.instruments[0] }]),
  });
  const shared = snapshot.instruments[0];
  const aliasedInstrument = deeplyFreeze({ ...snapshot, instruments: [shared, shared] });
  const cases = [
    ['mutable top level', mutableTopLevel],
    ['mutable instrument array', mutableInstrumentArray],
    ['mutable nested instrument', mutableInstrument],
    ['aliased nested instrument', aliasedInstrument],
  ];
  for (const [name, snapshotValue] of cases) {
    await t.test(name, () => {
      const result = decideWaitingInstrumentRevision(snapshotValue, binding(snapshot));
      assert.deepEqual(result, expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null));
      assertNonActionable(result);
    });
  }
});

test('active and revoked proxies fail closed without escaping the decision boundary', async (t) => {
  const snapshot = genuineSnapshot();
  const validBinding = binding(snapshot);
  const activeSnapshot = new Proxy({ ...snapshot }, {});
  const activeBinding = new Proxy({ ...validBinding }, {});
  const revokedSnapshot = Proxy.revocable({ ...snapshot }, {});
  const revokedBinding = Proxy.revocable({ ...validBinding }, {});
  revokedSnapshot.revoke();
  revokedBinding.revoke();
  const cases = [
    ['active snapshot proxy', activeSnapshot, validBinding],
    ['active binding proxy', snapshot, activeBinding],
    ['revoked snapshot proxy', revokedSnapshot.proxy, validBinding],
    ['revoked binding proxy', snapshot, revokedBinding.proxy],
  ];
  for (const [name, snapshotValue, bindingValue] of cases) {
    await t.test(name, () => {
      const result = decideWaitingInstrumentRevision(snapshotValue, bindingValue);
      assert.deepEqual(result, expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null));
      assertNonActionable(result);
    });
  }
});

test('unsafe and non-exact binding identities block as rejected input', async (t) => {
  const snapshot = genuineSnapshot();
  const cases = [
    ['empty symbol', binding(snapshot, { symbol: '' })],
    ['padded symbol', binding(snapshot, { symbol: ' BTCUSDT' })],
    ['control character', binding(snapshot, { symbol: 'BTC\u0000USDT' })],
    ['bidi control', binding(snapshot, { symbol: 'BTC\u202eUSDT' })],
    ['oversized symbol', binding(snapshot, { symbol: 'A'.repeat(257) })],
    ['numeric revision', binding(snapshot, { instrumentRevision: 1 })],
  ];
  for (const [name, bindingValue] of cases) {
    await t.test(name, () => {
      const result = decideWaitingInstrumentRevision(snapshot, bindingValue);
      assert.deepEqual(result, expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null));
      assertNonActionable(result);
    });
  }
});

test('hostile or non-exact injected evaluation times are rejected', async (t) => {
  const snapshot = genuineSnapshot();
  const cases = [
    ['negative', -1],
    ['fractional', T0 + 0.5],
    ['not a number', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['decimal string', String(T0)],
    ['bigint', BigInt(T0)],
    ['null', null],
  ];
  for (const [name, evaluatedAtMs] of cases) {
    await t.test(name, () => {
      const result = decideWaitingInstrumentRevision(
        snapshot,
        binding(snapshot, { evaluatedAtMs }),
      );
      assert.deepEqual(result, expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null));
      assertNonActionable(result);
    });
  }
});

test('a forged minimal frozen instrument cannot obtain CURRENT', () => {
  const snapshot = genuineSnapshot();
  const forged = deeplyFreeze({
    ...snapshot,
    instruments: [{
      symbol: 'BTCUSDT',
      instrumentRevision: snapshot.instruments[0].instrumentRevision,
      status: 'TRADING',
      normalizationState: 'READY_STATIC_ONLY',
    }],
  });
  const result = decideWaitingInstrumentRevision(forged, binding(snapshot));
  assert.deepEqual(result, expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null));
  assertNonActionable(result);
});

test('hostile nested accessors are rejected without invocation', () => {
  const snapshot = genuineSnapshot();
  let reads = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'symbol', {
    enumerable: true,
    get() {
      reads += 1;
      throw new Error('HOSTILE_INSTRUMENT_ACCESSOR');
    },
  });
  Object.freeze(hostile);
  const forged = deeplyFreeze({ ...snapshot, instruments: [hostile] });
  const result = decideWaitingInstrumentRevision(forged, binding(snapshot));
  assert.deepEqual(result, expected('BLOCKED', ['WAITING_INPUT_REJECTED'], null));
  assertNonActionable(result);
  assert.equal(reads, 0);
});
