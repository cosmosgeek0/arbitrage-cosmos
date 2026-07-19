import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  MARKET_STAGES,
  canonicalJson,
  createNewLensDescriptor,
  isEvidencePolarity,
  stableId,
  stableSetId,
  validateFrozenPreEventRecord,
  validateNormalizedEvidence,
  validateTruthMetadata,
} from '../../../dist/intelligenceFoundation/contracts/index.js';

const truth = (overrides = {}) => ({
  schemaVersion: '1',
  producerVersion: 'contracts-1',
  configurationVersion: 'cfg-1',
  featureVersion: null,
  authority: {
    kind: 'EXCHANGE_PRIMARY',
    sourceId: 'binance-spot',
    dataset: 'bookTicker',
    endpointClass: 'PUBLIC',
  },
  provenance: { sourceRecordIds: ['raw:1'], sourceSet: ['binance-spot'], transforms: ['normalize-book-v1'] },
  temporal: {
    sourceEventTimeMs: null,
    sourceTransactionTimeMs: null,
    receivedTimeMs: 1_720_000_000_125,
    sequence: { first: '9007199254740993', last: '9007199254740993', previous: '9007199254740992' },
  },
  freshness: {
    basis: 'RECEIVE_TIME',
    evaluatedAtMs: 1_720_000_000_200,
    ageMs: 75,
    maxAgeMs: 1_000,
    state: 'FRESH',
  },
  completeness: { state: 'COMPLETE', observedFields: ['bid', 'ask'], missingFields: [], reasonCodes: [] },
  ...overrides,
});

const instrument = (family = 'SPOT', sourceMarketType = null) => ({
  instrumentId: stableId('instrument', { venue: 'BINANCE', family, symbol: 'BTCUSDT', sourceMarketType }),
  venue: 'BINANCE',
  productFamily: family,
  symbol: 'BTCUSDT',
  pair: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  contractType: family === 'SPOT' ? null : 'PERPETUAL',
  sourceMarketType,
});

const newLens = (overrides = {}) => ({
  lensId: 'spot-oi-divergence',
  definition: 'Measures whether exact open-interest change diverges from accepted Spot trade-arrival evidence.',
  provenance: {
    sourceIds: ['binance-usdm-open-interest', 'binance-spot-aggregate-trade'],
    inputFeatureIds: ['feature:spot-trade-arrival', 'feature:open-interest-change'],
    transformIds: ['transform:spot-oi-divergence-v1'],
  },
  freshness: { basis: 'SOURCE_EVENT_TIME', maximumAgeMs: 30_000 },
  missingDataBehavior: { state: 'UNKNOWN', reasonCode: 'MISSING_REQUIRED_SOURCE' },
  failureMode: {
    code: 'TEMPORAL_ALIGNMENT_FAILED',
    description: 'Returns unknown when exact source-event chronology cannot establish a comparable evidence cut.',
    state: 'UNKNOWN',
  },
  history: { availability: 'REPLAYABLE', retentionMs: 7 * 24 * 60 * 60 * 1_000 },
  cost: { complexity: 'LINEAR', maxInputRecords: 4_096, maxRetainedRecords: 16_384 },
  incrementalRationale: {
    baselineFeatureIds: ['feature:spot-trade-arrival'],
    incrementalReferenceIds: ['feature:open-interest-change', 'transform:spot-oi-divergence-v1'],
    hypothesis: 'Open-interest change may distinguish leveraged expansion from the existing Spot trade-arrival baseline.',
  },
  version: '1.0.0',
  testReplayPath: { kind: 'TEST', path: 'server/test/intelligenceFoundation/contracts/contracts.test.mjs' },
  ...overrides,
});

test('canonical serialization is key-order independent and preserves explicit null', () => {
  const left = { z: null, a: { y: 2, x: 1 }, list: [3, 2, 1] };
  const right = { list: [3, 2, 1], a: { x: 1, y: 2 }, z: null };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.match(canonicalJson(left), /"z":null/);
  assert.throws(() => canonicalJson({ missing: undefined }), /undefined/);
  assert.throws(() => canonicalJson({ invalid: Number.POSITIVE_INFINITY }), /non-finite/);
});

test('stable IDs ignore property order and distinguish product family', () => {
  assert.equal(stableId('packet', { symbol: 'BTCUSDT', family: 'SPOT' }), stableId('packet', { family: 'SPOT', symbol: 'BTCUSDT' }));
  assert.notEqual(instrument('USD_M_PERPETUAL', 1).instrumentId, instrument('COIN_M_PERPETUAL', 2).instrumentId);
});

test('set-like stable IDs ignore member position while canonical JSON rejects exotic or cyclic objects', () => {
  assert.equal(
    stableSetId('packet', { instrument: 'BTCUSDT', ids: ['b', 'a'] }, ['ids']),
    stableSetId('packet', { ids: ['a', 'b'], instrument: 'BTCUSDT' }, ['ids']),
  );
  assert.throws(() => canonicalJson(new Date(0)), /non-plain/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /cyclic/);
});

test('new-lens descriptor canonically binds every required proposal fact without mounting a runtime', () => {
  const input = newLens();
  const result = createNewLensDescriptor(input);
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.failure));
  assert.deepEqual(Reflect.ownKeys(result.value).sort(), [
    'cost', 'definition', 'failureMode', 'freshness', 'history', 'id', 'incrementalRationale',
    'lensId', 'missingDataBehavior', 'provenance', 'testReplayPath', 'version',
  ]);
  assert.match(result.value.id, /^new-lens:[a-f0-9]{24}$/);
  assert.deepEqual(result.value.provenance.sourceIds, ['binance-spot-aggregate-trade', 'binance-usdm-open-interest']);
  assert.deepEqual(result.value.provenance.inputFeatureIds, ['feature:open-interest-change', 'feature:spot-trade-arrival']);
  assert.deepEqual(result.value.incrementalRationale.incrementalReferenceIds, [
    'feature:open-interest-change',
    'transform:spot-oi-divergence-v1',
  ]);
  for (const nested of [
    result.value,
    result.value.provenance,
    result.value.provenance.sourceIds,
    result.value.freshness,
    result.value.missingDataBehavior,
    result.value.failureMode,
    result.value.history,
    result.value.cost,
    result.value.incrementalRationale,
    result.value.incrementalRationale.baselineFeatureIds,
    result.value.testReplayPath,
  ]) assert.equal(Object.isFrozen(nested), true);

  input.provenance.sourceIds[0] = 'mutated-source';
  input.incrementalRationale.baselineFeatureIds[0] = 'feature:mutated';
  input.failureMode.description = 'Mutated after admission.';
  assert.deepEqual(result.value.provenance.sourceIds, ['binance-spot-aggregate-trade', 'binance-usdm-open-interest']);
  assert.equal(result.value.incrementalRationale.baselineFeatureIds[0], 'feature:spot-trade-arrival');
  assert.match(result.value.failureMode.description, /source-event chronology/);
  assert.throws(() => { result.value.history.retentionMs = 1; }, TypeError);

  const permuted = newLens();
  permuted.provenance.sourceIds.reverse();
  permuted.provenance.inputFeatureIds.reverse();
  permuted.incrementalRationale.incrementalReferenceIds.reverse();
  const canonical = createNewLensDescriptor(permuted);
  assert.equal(canonical.ok, true);
  assert.deepEqual(canonical.value, result.value);
});

test('new-lens stable ID is content-bound to all eleven required descriptor fields', () => {
  const baseline = createNewLensDescriptor(newLens());
  assert.equal(baseline.ok, true);
  const variants = [
    newLens({ lensId: 'spot-oi-divergence-v2' }),
    newLens({ definition: 'Measures whether exact funding-rate change diverges from accepted Spot trade-arrival evidence.' }),
    newLens({ provenance: { ...newLens().provenance, sourceIds: ['binance-usdm-mark-price', 'binance-spot-aggregate-trade'] } }),
    newLens({ freshness: { basis: 'RECEIVE_TIME', maximumAgeMs: 30_000 } }),
    newLens({ missingDataBehavior: { state: 'BLOCKED', reasonCode: 'MISSING_REQUIRED_SOURCE' } }),
    newLens({ failureMode: { ...newLens().failureMode, code: 'SOURCE_ALIGNMENT_FAILED' } }),
    newLens({ history: { availability: 'REPLAYABLE', retentionMs: 8 * 24 * 60 * 60 * 1_000 } }),
    newLens({ cost: { complexity: 'LINEAR', maxInputRecords: 8_192, maxRetainedRecords: 16_384 } }),
    newLens({
      incrementalRationale: {
        ...newLens().incrementalRationale,
        hypothesis: 'Open-interest change may distinguish leveraged continuation from the existing Spot trade-arrival baseline.',
      },
    }),
    newLens({ version: '1.0.1' }),
    newLens({ testReplayPath: { kind: 'REPLAY', path: 'server/test/intelligenceFoundation/fixtures/market-intelligence.mjs' } }),
  ];
  for (const variant of variants) {
    const result = createNewLensDescriptor(variant);
    assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.failure));
    assert.notEqual(result.value.id, baseline.value.id);
  }
});

test('new-lens descriptor rejects non-exact shapes, duplicate provenance, and unbounded or contradictory policy', () => {
  const missing = newLens();
  delete missing.definition;
  const extra = { ...newLens(), enabled: true };
  const nestedExtra = newLens();
  nestedExtra.cost = { ...nestedExtra.cost, estimatedLatencyMs: 5 };
  const hidden = newLens();
  Object.defineProperty(hidden, 'definition', { enumerable: false, value: hidden.definition });
  const symbol = newLens();
  symbol[Symbol('extra')] = true;
  const duplicate = newLens();
  duplicate.provenance.sourceIds = ['binance-usdm-open-interest', 'binance-usdm-open-interest'];
  const crossCategoryDuplicate = newLens();
  crossCategoryDuplicate.provenance.transformIds = ['feature:open-interest-change'];
  crossCategoryDuplicate.incrementalRationale.incrementalReferenceIds = ['feature:open-interest-change'];
  const sparse = newLens();
  sparse.provenance.sourceIds = new Array(2);
  sparse.provenance.sourceIds[1] = 'binance-usdm-open-interest';
  const extraArrayProperty = newLens();
  extraArrayProperty.provenance.sourceIds.extra = 'not-contract-data';
  const cases = [
    missing,
    extra,
    nestedExtra,
    hidden,
    symbol,
    duplicate,
    crossCategoryDuplicate,
    sparse,
    extraArrayProperty,
    newLens({ freshness: { basis: 'RECEIVE_TIME', maximumAgeMs: -0 } }),
    newLens({ freshness: { basis: 'UNAVAILABLE', maximumAgeMs: 1 } }),
    newLens({ freshness: { basis: 'RECEIVE_TIME', maximumAgeMs: 31 * 24 * 60 * 60 * 1_000 + 1 } }),
    newLens({ history: { availability: 'REPLAYABLE', retentionMs: -0 } }),
    newLens({ history: { availability: 'NONE', retentionMs: 1 }, cost: { complexity: 'CONSTANT', maxInputRecords: 1, maxRetainedRecords: 0 } }),
    newLens({ history: { availability: 'NONE', retentionMs: null }, cost: { complexity: 'CONSTANT', maxInputRecords: 1, maxRetainedRecords: 1 } }),
    newLens({ cost: { complexity: 'LINEAR', maxInputRecords: -0, maxRetainedRecords: 1 } }),
    newLens({ cost: { complexity: 'LINEAR', maxInputRecords: 1_000_001, maxRetainedRecords: 1 } }),
    newLens({ cost: { complexity: 'LINEAR', maxInputRecords: 1, maxRetainedRecords: 1_000_001 } }),
    newLens({ incrementalRationale: { ...newLens().incrementalRationale, baselineFeatureIds: ['feature:not-declared'] } }),
    newLens({ incrementalRationale: { ...newLens().incrementalRationale, incrementalReferenceIds: ['feature:not-declared'] } }),
    newLens({ incrementalRationale: { ...newLens().incrementalRationale, incrementalReferenceIds: ['feature:spot-trade-arrival'] } }),
    newLens({ incrementalRationale: { ...newLens().incrementalRationale, hypothesis: 'More alpha' } }),
  ];
  for (const candidate of cases) {
    const result = createNewLensDescriptor(candidate);
    assert.equal(result.ok, false, JSON.stringify(candidate));
    assert.equal(result.failure.code, 'INVALID_VALUE');
  }

  const positiveZero = createNewLensDescriptor(newLens({
    history: { availability: 'NONE', retentionMs: null },
    cost: { complexity: 'CONSTANT', maxInputRecords: 1, maxRetainedRecords: 0 },
  }));
  assert.equal(positiveZero.ok, true, positiveZero.ok ? '' : JSON.stringify(positiveZero.failure));
  assert.equal(Object.is(positiveZero.value.cost.maxRetainedRecords, -0), false);
  const negativeZero = createNewLensDescriptor(newLens({
    history: { availability: 'NONE', retentionMs: null },
    cost: { complexity: 'CONSTANT', maxInputRecords: 1, maxRetainedRecords: -0 },
  }));
  assert.equal(negativeZero.ok, false);
});

test('new-lens proof paths are canonical, kind-owned, and reject encoded traversal or URI suffixes', () => {
  const validReplay = createNewLensDescriptor(newLens({
    testReplayPath: { kind: 'REPLAY', path: 'test/replayShadow/contracts.test.mjs' },
  }));
  assert.equal(validReplay.ok, true, validReplay.ok ? '' : JSON.stringify(validReplay.failure));
  const invalidPaths = [
    '/server/test/intelligenceFoundation/contracts/contracts.test.mjs',
    'server\\test\\intelligenceFoundation\\contracts\\contracts.test.mjs',
    'server/test/../src/contracts.test.mjs',
    'server/test/%2e%2e/src/contracts.test.mjs',
    'server/test/%2E%2E%2Fsrc/contracts.test.mjs',
    'server/test/contracts.test.mjs?run=true',
    'server/test/contracts.test.mjs#fragment',
    'https://example.invalid/contracts.test.mjs',
  ];
  for (const path of invalidPaths) assert.equal(createNewLensDescriptor(newLens({ testReplayPath: { kind: 'TEST', path } })).ok, false);
  assert.equal(createNewLensDescriptor(newLens({ testReplayPath: { kind: 'TEST', path: 'docs/contracts.test.mjs' } })).ok, false);
  assert.equal(createNewLensDescriptor(newLens({ testReplayPath: { kind: 'TEST', path: 'server/test/contracts.json' } })).ok, false);
  assert.equal(createNewLensDescriptor(newLens({ testReplayPath: { kind: 'REPLAY', path: 'server/test/contracts.test.mjs' } })).ok, false);
});

test('new-lens hostile inputs fail closed without Proxy traps, getters, coercion, or secret retention', () => {
  let traps = 0;
  const proxy = new Proxy(newLens(), {
    getPrototypeOf() { traps += 1; throw new Error('must not run'); },
    ownKeys() { traps += 1; throw new Error('must not run'); },
  });
  const nestedProxy = newLens();
  nestedProxy.provenance = new Proxy(nestedProxy.provenance, { ownKeys() { traps += 1; throw new Error('must not run'); } });
  const arrayProxy = newLens();
  arrayProxy.provenance.sourceIds = new Proxy(arrayProxy.provenance.sourceIds, { get() { traps += 1; throw new Error('must not run'); } });
  const revoked = Proxy.revocable(newLens(), {});
  revoked.revoke();
  const accessor = newLens();
  Object.defineProperty(accessor, 'definition', {
    enumerable: true,
    get() { traps += 1; throw new Error('must not run'); },
  });
  const accessorArray = newLens();
  Object.defineProperty(accessorArray.provenance.sourceIds, '0', {
    enumerable: true,
    configurable: true,
    get() { traps += 1; throw new Error('must not run'); },
  });
  const coercion = newLens({ lensId: { [Symbol.toPrimitive]() { traps += 1; throw new Error('must not run'); } } });
  const bigint = newLens({ cost: { complexity: 'LINEAR', maxInputRecords: 4_096n, maxRetainedRecords: 16_384 } });
  const cyclic = newLens();
  cyclic.provenance = cyclic;
  const secret = newLens();
  Object.defineProperty(secret.provenance, 'apiKey', {
    enumerable: false,
    get() { traps += 1; throw new Error('must not run'); },
  });
  const arraySecret = newLens();
  Object.defineProperty(arraySecret.provenance.sourceIds, 'accessToken', {
    enumerable: false,
    get() { traps += 1; throw new Error('must not run'); },
  });

  for (const candidate of [proxy, nestedProxy, arrayProxy, revoked.proxy, accessor, accessorArray, coercion, bigint, cyclic]) {
    let result;
    assert.doesNotThrow(() => { result = createNewLensDescriptor(candidate); });
    assert.equal(result.ok, false);
  }
  const secretResult = createNewLensDescriptor(secret);
  assert.equal(secretResult.ok, false);
  assert.equal(secretResult.failure.code, 'SECRET_FIELD_REJECTED');
  assert.doesNotMatch(JSON.stringify(secretResult.failure), /must not run/);
  const arraySecretResult = createNewLensDescriptor(arraySecret);
  assert.equal(arraySecretResult.ok, false);
  assert.equal(arraySecretResult.failure.code, 'SECRET_FIELD_REJECTED');
  assert.equal(traps, 0);
});

test('truth metadata preserves source and receive time separately', () => {
  const result = validateTruthMetadata(truth({
    temporal: {
      sourceEventTimeMs: 1_720_000_000_000,
      sourceTransactionTimeMs: 1_720_000_000_010,
      receivedTimeMs: 1_720_000_000_125,
      sequence: null,
    },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.temporal.sourceEventTimeMs, 1_720_000_000_000);
  assert.equal(result.value.temporal.receivedTimeMs, 1_720_000_000_125);
});

test('unsafe numeric sequence IDs are rejected while decimal strings survive', () => {
  assert.equal(validateTruthMetadata(truth()).ok, true);
  const invalid = truth();
  invalid.temporal.sequence.first = 9_007_199_254_740_994;
  const result = validateTruthMetadata(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'INVALID_VALUE');
});

test('contradictory freshness and completeness claims are rejected', () => {
  const staleClaimedFresh = truth();
  staleClaimedFresh.freshness = { ...staleClaimedFresh.freshness, ageMs: 2_000, maxAgeMs: 1_000 };
  assert.equal(validateTruthMetadata(staleClaimedFresh).ok, false);
  const missingClaimedComplete = truth();
  missingClaimedComplete.completeness = { ...missingClaimedComplete.completeness, missingFields: ['depth'] };
  assert.equal(validateTruthMetadata(missingClaimedComplete).ok, false);
  const unexplainedPartial = truth();
  unexplainedPartial.completeness = { state: 'PARTIAL', observedFields: ['bid'], missingFields: ['ask'], reasonCodes: [] };
  assert.equal(validateTruthMetadata(unexplainedPartial).ok, false);
});

test('invalid variants and crossed books produce stable structured failures', () => {
  const base = { id: 'e:1', instrument: instrument(), truth: truth() };
  const variant = validateNormalizedEvidence({ ...base, kind: 'PUMP_PROBABILITY' });
  assert.equal(variant.ok, false);
  assert.equal(variant.failure.code, 'INVALID_VARIANT');
  const crossed = validateNormalizedEvidence({
    ...base,
    kind: 'BOOK_TICKER',
    updateId: '1',
    bidPrice: 101,
    bidQuantity: 2,
    askPrice: 100,
    askQuantity: 2,
  });
  assert.equal(crossed.ok, false);
  assert.equal(crossed.failure.code, 'CROSSED_BOOK');
});

test('depth ordering and borrow numeric invariants fail closed', () => {
  const depthTruth = truth({
    temporal: {
      sourceEventTimeMs: 1_720_000_000_000,
      sourceTransactionTimeMs: 1_720_000_000_000,
      receivedTimeMs: 1_720_000_000_125,
      sequence: { first: '1', last: '2', previous: '0' },
    },
    freshness: {
      basis: 'SOURCE_EVENT_TIME', evaluatedAtMs: 1_720_000_000_200, ageMs: 200,
      maxAgeMs: 1_000, state: 'FRESH',
    },
  });
  const unsorted = validateNormalizedEvidence({
    id: 'depth:1', kind: 'DEPTH_SNAPSHOT', instrument: instrument(), truth: depthTruth,
    bids: [{ price: 99, baseQuantity: 1 }, { price: 100, baseQuantity: 1 }],
    asks: [{ price: 101, baseQuantity: 1 }], bookScope: 'STANDARD_NO_RPI', maximumLevelsKnown: 5_000,
  });
  assert.equal(unsorted.ok, false);
  const validDeletionDelta = validateNormalizedEvidence({
    id: 'depth:delta', kind: 'DEPTH_DELTA', instrument: instrument(), truth: depthTruth,
    bids: [{ price: 110, baseQuantity: 0 }], asks: [{ price: 100, baseQuantity: 0 }],
    bookScope: 'STANDARD_NO_RPI', maximumLevelsKnown: null,
  });
  assert.equal(validDeletionDelta.ok, true);
  const borrowInstrument = { ...instrument(), productFamily: 'BORROW', quoteAsset: null, pair: null };
  const invalidBorrow = validateNormalizedEvidence({
    id: 'borrow:1', kind: 'BORROW', instrument: borrowInstrument, truth: truth(), asset: 'BTC',
    eligibility: 'ELIGIBLE', availability: 'AVAILABLE', systemAvailableAmount: -1,
    accountBorrowLimit: null, hourlyInterestRateDecimal: 0.00001, inventoryAmount: null,
  });
  assert.equal(invalidBorrow.ok, false);
});

test('nested secret-bearing fields are rejected without retaining the value', () => {
  const contaminated = truth();
  contaminated.provenance.extra = { credentials: { apiKey: 'must-never-appear' } };
  const result = validateTruthMetadata(contaminated);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'SECRET_FIELD_REJECTED');
  assert.doesNotMatch(JSON.stringify(result.failure), /must-never-appear/);
  const alias = truth();
  alias.provenance.xApiKey = 'still-secret';
  assert.equal(validateTruthMetadata(alias).ok, false);
});

test('frozen-record validation blocks epistemic future data but permits a known future funding time', () => {
  const cutoff = 1_720_000_000_200;
  const frozenTruth = truth({
    configurationVersion: 'cfg-1',
    featureVersion: 'features-1',
    temporal: { sourceEventTimeMs: cutoff - 100, sourceTransactionTimeMs: cutoff - 90, receivedTimeMs: cutoff - 50, sequence: null },
    freshness: { basis: 'SOURCE_EVENT_TIME', evaluatedAtMs: cutoff, ageMs: 100, maxAgeMs: 1_000, state: 'FRESH' },
  });
  const perp = instrument('USD_M_PERPETUAL', 1);
  const thesis = {
    id: 'thesis:1', instrumentId: perp.instrumentId, hypothesis: 'UNCLASSIFIED_ANOMALY', stage: 'EARLY_CHANGE',
    changedFirst: 'activity', changedAtMs: cutoff - 100, leadMarket: 'UNKNOWN', supporting: [], conflicting: [],
    neutral: [], unavailable: [], tradeability: { state: 'UNKNOWN', reasonCodes: ['EVIDENCE_ONLY'], requiredEvidenceIds: [], missingEvidenceKinds: [] },
    analogueIds: [], reasonCodes: ['EVIDENCE_ONLY'], truth: frozenTruth,
  };
  const funding = {
    id: 'funding:1', kind: 'FUNDING', instrument: perp, truth: frozenTruth, fundingRate: 0.0001,
    fundingIntervalHours: 4, nextFundingTimeMs: cutoff + 60_000, adjustedRateCap: null, adjustedRateFloor: null,
  };
  const record = {
    id: 'frozen:1', triggerTimeMs: cutoff, evidenceCutoffTimeMs: cutoff, candidateDisposition: 'OBSERVED',
    thesis, forensics: [], evidence: [funding], features: [], configurationVersion: 'cfg-1', featureVersion: 'features-1', truth: frozenTruth,
  };
  const valid = validateFrozenPreEventRecord(record);
  assert.equal(valid.ok, true, valid.ok ? '' : JSON.stringify(valid.failure));
  assert.equal(Object.isFrozen(valid.value), true);
  assert.equal(Object.isFrozen(valid.value.thesis), true);
  assert.throws(() => { valid.value.thesis.stage = 'TOO_LATE'; }, TypeError);
  const malformed = structuredClone(record);
  malformed.thesis.hypothesis = 'PUMP_PROBABILITY';
  assert.equal(validateFrozenPreEventRecord(malformed).ok, false);
  const futureFeature = structuredClone(record);
  futureFeature.features = [{
    id: 'feature:future', instrumentId: perp.instrumentId, feature: 'trade_arrival', featureVersion: 'features-1',
    value: 2, unit: 'ratio', windowMs: null, observationStartMs: cutoff + 1, observationEndMs: null, truth: frozenTruth,
  }];
  const futureFeatureResult = validateFrozenPreEventRecord(futureFeature);
  assert.equal(futureFeatureResult.ok, false);
  assert.equal(futureFeatureResult.failure.code, 'NO_LOOK_AHEAD_VIOLATION');
  const future = structuredClone(record);
  future.truth.temporal.receivedTimeMs = cutoff + 1;
  future.truth.freshness = { basis: 'RECEIVE_TIME', evaluatedAtMs: cutoff + 1, ageMs: 0, maxAgeMs: 1_000, state: 'FRESH' };
  const result = validateFrozenPreEventRecord(future);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'NO_LOOK_AHEAD_VIOLATION');
});

test('required market stages and evidence polarities are frozen', () => {
  assert.deepEqual(MARKET_STAGES, [
    'QUIET', 'EARLY_CHANGE', 'BEFORE_VISIBLE_MOVE', 'VISIBLE_EXPANSION', 'CONTINUATION',
    'EXHAUSTION', 'REVERSAL', 'TOO_LATE', 'UNCLASSIFIED',
  ]);
  for (const polarity of ['SUPPORTING', 'CONFLICTING', 'NEUTRAL', 'UNAVAILABLE']) assert.equal(isEvidencePolarity(polarity), true);
  assert.equal(isEvidencePolarity('CONFIDENCE'), false);
});

test('contract import is pure: no fetch, socket, or timer starts', () => {
  const moduleUrl = new URL('../../../dist/intelligenceFoundation/contracts/index.js', import.meta.url).href;
  const script = `
    let timers = 0;
    globalThis.fetch = () => { throw new Error('fetch forbidden'); };
    globalThis.WebSocket = class { constructor() { throw new Error('socket forbidden'); } };
    const originalTimeout = globalThis.setTimeout;
    const originalInterval = globalThis.setInterval;
    globalThis.setTimeout = (...args) => { timers += 1; return originalTimeout(...args); };
    globalThis.setInterval = (...args) => { timers += 1; return originalInterval(...args); };
    await import(${JSON.stringify(moduleUrl)});
    globalThis.setTimeout = originalTimeout;
    globalThis.setInterval = originalInterval;
    if (timers !== 0) throw new Error('import scheduled a timer');
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 2_000 });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});
