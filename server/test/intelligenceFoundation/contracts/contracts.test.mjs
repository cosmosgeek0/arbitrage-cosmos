import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  MARKET_STAGES,
  canonicalJson,
  isEvidencePolarity,
  stableId,
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

test('nested secret-bearing fields are rejected without retaining the value', () => {
  const contaminated = truth();
  contaminated.provenance.extra = { credentials: { apiKey: 'must-never-appear' } };
  const result = validateTruthMetadata(contaminated);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'SECRET_FIELD_REJECTED');
  assert.doesNotMatch(JSON.stringify(result.failure), /must-never-appear/);
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
