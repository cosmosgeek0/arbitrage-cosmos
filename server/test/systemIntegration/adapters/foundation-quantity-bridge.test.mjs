import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  FOUNDATION_QUANTITY_BRIDGE_SCHEMA,
  FOUNDATION_QUANTITY_INSTRUMENT_EVIDENCE_SCHEMA,
  compareJournalToFoundationQuantity,
  deriveFoundationQuantityInstrumentEvidenceRevision,
} from '../../../dist/systemIntegration/adapters/foundationQuantityBridge.js';

const INSTRUMENT_ID = 'SPOT:BTCUSDT';

function bridge(overrides = {}) {
  const input = {
    exactJournalQuantity: '0.1',
    foundationQuantity: 0.1,
    instrumentId: INSTRUMENT_ID,
    instrumentStep: '0.1',
    instrumentTolerance: '0.00000000000000001',
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'instrumentEvidenceRevision')) {
    input.instrumentEvidenceRevision = deriveFoundationQuantityInstrumentEvidenceRevision(
      input.instrumentId,
      input.instrumentStep,
      input.instrumentTolerance,
    );
  }
  return compareJournalToFoundationQuantity(input);
}

test('is reachable through both the adapter and System Integration public barrels', async () => {
  const [adapterBarrel, systemIntegrationBarrel] = await Promise.all([
    import('../../../dist/systemIntegration/adapters/index.js'),
    import('../../../dist/systemIntegration/index.js'),
  ]);
  assert.equal(adapterBarrel.compareJournalToFoundationQuantity, compareJournalToFoundationQuantity);
  assert.equal(systemIntegrationBarrel.compareJournalToFoundationQuantity, compareJournalToFoundationQuantity);
  assert.equal(
    adapterBarrel.deriveFoundationQuantityInstrumentEvidenceRevision,
    deriveFoundationQuantityInstrumentEvidenceRevision,
  );
  assert.equal(
    systemIntegrationBarrel.deriveFoundationQuantityInstrumentEvidenceRevision,
    deriveFoundationQuantityInstrumentEvidenceRevision,
  );
  assert.equal(adapterBarrel.FOUNDATION_QUANTITY_BRIDGE_SCHEMA, FOUNDATION_QUANTITY_BRIDGE_SCHEMA);
  assert.equal(systemIntegrationBarrel.FOUNDATION_QUANTITY_BRIDGE_SCHEMA, FOUNDATION_QUANTITY_BRIDGE_SCHEMA);
  assert.equal(
    adapterBarrel.FOUNDATION_QUANTITY_INSTRUMENT_EVIDENCE_SCHEMA,
    FOUNDATION_QUANTITY_INSTRUMENT_EVIDENCE_SCHEMA,
  );
});

test('retains both originals in a closed immutable exact comparison', () => {
  const input = {
    exactJournalQuantity: '0.5',
    foundationQuantity: 0.5,
    instrumentId: INSTRUMENT_ID,
    instrumentStep: '0.1',
    instrumentTolerance: '0.0001',
  };
  input.instrumentEvidenceRevision = deriveFoundationQuantityInstrumentEvidenceRevision(
    input.instrumentId,
    input.instrumentStep,
    input.instrumentTolerance,
  );
  const result = compareJournalToFoundationQuantity(input);
  assert.deepEqual(result, {
    schema: FOUNDATION_QUANTITY_BRIDGE_SCHEMA,
    version: 1,
    comparison: 'EXACT_BINARY_VALUE',
    roundingDirection: 'EXACT',
    toleranceDirection: 'EXACT',
    exactJournalQuantity: '0.5',
    foundationQuantity: 0.5,
    foundationCanonicalDecimal: '0.5',
    foundationExactDecimal: '0.5',
    absoluteDifference: '0',
    instrumentId: INSTRUMENT_ID,
    instrumentStep: '0.1',
    instrumentTolerance: '0.0001',
    instrumentEvidenceRevision: input.instrumentEvidenceRevision,
    journalStepAlignment: 'ALIGNED',
    stepToleranceRelation: 'UNAMBIGUOUS',
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(input), false);
});

test('proves the true upward binary64 rounding direction for 0.1', () => {
  const result = bridge();
  assert.equal(result.comparison, 'WITHIN_TOLERANCE');
  assert.equal(result.roundingDirection, 'FOUNDATION_ABOVE_JOURNAL');
  assert.equal(result.toleranceDirection, 'ABOVE_WITHIN_TOLERANCE');
  assert.equal(result.foundationCanonicalDecimal, '0.1');
  assert.equal(
    result.foundationExactDecimal,
    '0.1000000000000000055511151231257827021181583404541015625',
  );
  assert.equal(
    result.absoluteDifference,
    '0.0000000000000000055511151231257827021181583404541015625',
  );
});

test('proves downward fractional rounding independently of tolerance', () => {
  const result = bridge({
    exactJournalQuantity: '0.3',
    foundationQuantity: 0.3,
    instrumentTolerance: '0.00000000000000002',
  });
  assert.equal(result.comparison, 'WITHIN_TOLERANCE');
  assert.equal(result.roundingDirection, 'FOUNDATION_BELOW_JOURNAL');
  assert.equal(result.toleranceDirection, 'BELOW_WITHIN_TOLERANCE');
  assert.equal(
    result.foundationExactDecimal,
    '0.299999999999999988897769753748434595763683319091796875',
  );
});

test('tolerance boundary is inclusive and a smaller tolerance remains an explicit mismatch', () => {
  const boundary = bridge({
    instrumentTolerance: '0.0000000000000000055511151231257827021181583404541015625',
  });
  assert.equal(boundary.comparison, 'WITHIN_TOLERANCE');
  assert.equal(boundary.toleranceDirection, 'ABOVE_WITHIN_TOLERANCE');

  const outside = bridge({ instrumentTolerance: '0.000000000000000005' });
  assert.equal(outside.comparison, 'OUTSIDE_TOLERANCE');
  assert.equal(outside.roundingDirection, 'FOUNDATION_ABOVE_JOURNAL');
  assert.equal(outside.toleranceDirection, 'ABOVE_OUTSIDE_TOLERANCE');
});

test('valid mismatch returns evidence only and exposes no action semantics', () => {
  const result = bridge({
    foundationQuantity: 0.30000000000000004,
    exactJournalQuantity: '0.3',
    instrumentTolerance: '0',
  });
  assert.equal(result.comparison, 'OUTSIDE_TOLERANCE');
  assert.equal(result.roundingDirection, 'FOUNDATION_ABOVE_JOURNAL');
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /reconcil|authority|retry|fill|execute|recommend/i);
  assert.deepEqual(Object.keys(result).sort(), [
    'absoluteDifference',
    'comparison',
    'exactJournalQuantity',
    'foundationCanonicalDecimal',
    'foundationExactDecimal',
    'foundationQuantity',
    'instrumentEvidenceRevision',
    'instrumentId',
    'instrumentStep',
    'instrumentTolerance',
    'journalStepAlignment',
    'roundingDirection',
    'schema',
    'stepToleranceRelation',
    'toleranceDirection',
    'version',
  ]);
});

test('content revision rejects instrument identity, step, or tolerance substitution', () => {
  const instrumentStep = '0.1';
  const instrumentTolerance = '0.00000000000000001';
  const instrumentEvidenceRevision = deriveFoundationQuantityInstrumentEvidenceRevision(
    INSTRUMENT_ID,
    instrumentStep,
    instrumentTolerance,
  );
  assert.match(instrumentEvidenceRevision, /^fqie_[0-9a-f]{64}$/);

  for (const substitution of [
    { instrumentId: 'USD_M_PERPETUAL:BTCUSDT' },
    { instrumentStep: '0.01' },
    { instrumentTolerance: '0.000000000000000001' },
  ]) {
    assert.throws(
      () => bridge({ ...substitution, instrumentEvidenceRevision }),
      /INSTRUMENT_EVIDENCE_REVISION_MISMATCH/,
      JSON.stringify(substitution),
    );
  }
  assert.throws(
    () => bridge({ instrumentId: 'BTCUSDT', instrumentEvidenceRevision }),
    /INSTRUMENT_ID_INVALID/,
  );
});

test('rejects exponent text and exponent-form Foundation projections', () => {
  for (const field of ['exactJournalQuantity', 'instrumentStep', 'instrumentTolerance']) {
    assert.throws(
      () => bridge({ [field]: '1e-3' }),
      /EXPONENT_TEXT_FORBIDDEN/,
      field,
    );
  }
  assert.throws(
    () => bridge({
      exactJournalQuantity: '0',
      foundationQuantity: 0.0000001,
      instrumentStep: '0.1',
      instrumentTolerance: '0',
    }),
    /EXPONENT_TEXT_FORBIDDEN/,
  );
});

test('rejects non-finite, negative, negative-zero, overflow, and underflow numbers', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => bridge({ foundationQuantity: value }), /BINARY64_NON_FINITE/);
  }
  assert.throws(() => bridge({ foundationQuantity: -1 }), /BINARY64_NEGATIVE/);
  assert.throws(() => bridge({ foundationQuantity: -0 }), /BINARY64_NEGATIVE_ZERO/);
  assert.throws(
    () => bridge({ foundationQuantity: Number.MAX_SAFE_INTEGER + 1 }),
    /BINARY64_OVERFLOW/,
  );
  assert.throws(
    () => bridge({
      exactJournalQuantity: '0',
      foundationQuantity: Number.MIN_VALUE,
      instrumentTolerance: '0',
    }),
    /BINARY64_UNDERFLOW/,
  );
  assert.throws(
    () => bridge({
      exactJournalQuantity: '9007199254740992',
      foundationQuantity: 1,
      instrumentStep: '1',
    }),
    /BINARY64_OVERFLOW/,
  );
});

test('rejects non-canonical and non-round-tripping exact journal values', () => {
  for (const value of ['01', '0.10', '+1', '-0']) {
    assert.throws(
      () => bridge({ exactJournalQuantity: value }),
      /EXACT_DECIMAL_(?:NON_CANONICAL|INVALID)/,
      value,
    );
  }
  assert.throws(
    () => bridge({ exactJournalQuantity: '0.10000000000000001' }),
    /BINARY64_NON_ROUND_TRIP/,
  );
  assert.throws(
    () => bridge({
      exactJournalQuantity: '0.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
      instrumentStep: '0.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
      instrumentTolerance: '0',
    }),
    /BINARY64_(?:UNDERFLOW|NON_ROUND_TRIP)|EXPONENT_TEXT_FORBIDDEN/,
  );
});

test('rejects invalid, ambiguous, and off-grid step evidence', () => {
  assert.throws(() => bridge({ instrumentStep: '0' }), /INSTRUMENT_STEP_INVALID/);
  assert.throws(() => bridge({ instrumentStep: '0.1', instrumentTolerance: '0.05' }), /STEP_TOLERANCE_AMBIGUOUS/);
  assert.throws(() => bridge({ instrumentStep: '0.1', instrumentTolerance: '0.06' }), /STEP_TOLERANCE_AMBIGUOUS/);
  assert.throws(() => bridge({ instrumentTolerance: '-0.01' }), /EXACT_DECIMAL_(?:NON_CANONICAL|INVALID)/);
  assert.throws(
    () => bridge({
      exactJournalQuantity: '0.15',
      foundationQuantity: 0.15,
      instrumentStep: '0.1',
      instrumentTolerance: '0.01',
    }),
    /JOURNAL_QUANTITY_OFF_STEP/,
  );
});

test('input is closed data and comparison is deterministic and import-pure', async () => {
  assert.throws(
    () => compareJournalToFoundationQuantity({
      exactJournalQuantity: '0.1',
      foundationQuantity: 0.1,
      instrumentStep: '0.1',
      instrumentTolerance: '0.01',
      unknown: true,
    }),
    /QUANTITY_BRIDGE_INPUT_INVALID/,
  );
  let getterCalls = 0;
  const accessor = {
    foundationQuantity: 0.1,
    instrumentId: INSTRUMENT_ID,
    instrumentStep: '0.1',
    instrumentTolerance: '0.01',
    instrumentEvidenceRevision: deriveFoundationQuantityInstrumentEvidenceRevision(
      INSTRUMENT_ID,
      '0.1',
      '0.01',
    ),
  };
  Object.defineProperty(accessor, 'exactJournalQuantity', {
    enumerable: true,
    get() { getterCalls += 1; return '0.1'; },
  });
  assert.throws(() => compareJournalToFoundationQuantity(accessor), /QUANTITY_BRIDGE_INPUT_INVALID/);
  assert.equal(getterCalls, 0);

  const first = bridge();
  const second = bridge();
  assert.deepEqual(first, second);

  const original = {
    dateNow: Date.now,
    random: Math.random,
    fetch: globalThis.fetch,
    timeout: globalThis.setTimeout,
    interval: globalThis.setInterval,
  };
  const calls = { dateNow: 0, random: 0, fetch: 0, timeout: 0, interval: 0 };
  Date.now = () => { calls.dateNow += 1; return 0; };
  Math.random = () => { calls.random += 1; return 0; };
  globalThis.fetch = () => { calls.fetch += 1; throw new Error('network forbidden'); };
  globalThis.setTimeout = () => { calls.timeout += 1; throw new Error('timer forbidden'); };
  globalThis.setInterval = () => { calls.interval += 1; throw new Error('timer forbidden'); };
  try {
    const module = await import(`../../../dist/systemIntegration/adapters/foundationQuantityBridge.js?purity=${import.meta.url.length}`);
    assert.equal(typeof module.compareJournalToFoundationQuantity, 'function');
    assert.deepEqual(calls, { dateNow: 0, random: 0, fetch: 0, timeout: 0, interval: 0 });
  } finally {
    Date.now = original.dateNow;
    Math.random = original.random;
    globalThis.fetch = original.fetch;
    globalThis.setTimeout = original.timeout;
    globalThis.setInterval = original.interval;
  }

  const source = readFileSync('server/src/systemIntegration/adapters/foundationQuantityBridge.ts', 'utf8');
  assert.doesNotMatch(source, /process\.env|Date\.now|Math\.random|\bfetch\s*\(|WebSocket|setTimeout|setInterval/);
  assert.doesNotMatch(source, /foundation\/exchange|services\/(?:orders|loans|account)|node:(?:fs|net|http|https|tls|child_process)/);
});
