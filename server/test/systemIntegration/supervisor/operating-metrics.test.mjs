import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPECTED_REALIZED_DELTA_MISMATCH,
  EXPECTED_VS_REALIZED_VALUE_SEMANTICS,
  OPERATING_METRIC_CATALOG,
  OPERATING_METRIC_IDS,
  OPERATING_RATIO_SEMANTICS,
  buildOperatingMetricCatalogSnapshot,
} from '../../../dist/systemIntegration/supervisor/index.js';

const NOW = 1_800_000_000_000;

function fact(metricId, overrides = {}) {
  const definition = OPERATING_METRIC_CATALOG.find((candidate) => candidate.metricId === metricId);
  return {
    metricId,
    owner: definition.owner,
    sourceRevision: `${metricId.toLowerCase()}.v1`,
    status: 'AVAILABLE',
    evidencePosture: definition.productionOutcomeRequired ? 'RECORDED_REPLAY' : 'LIVE_OPERATIONAL',
    measuredAtMs: NOW - 1,
    measurements: Object.fromEntries(definition.measurementFields.map((field) => [field, '1'])),
    evidenceReferences: [`owner:${metricId.toLowerCase()}`],
    reasonCodes: [],
    ...overrides,
  };
}

function trapZeroProxy(target) {
  const calls = { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 };
  const proxy = new Proxy(target, {
    get() { calls.get += 1; throw new Error('HOSTILE_GET'); },
    getOwnPropertyDescriptor() { calls.getOwnPropertyDescriptor += 1; throw new Error('HOSTILE_DESCRIPTOR'); },
    getPrototypeOf() { calls.getPrototypeOf += 1; throw new Error('HOSTILE_PROTOTYPE'); },
    ownKeys() { calls.ownKeys += 1; throw new Error('HOSTILE_KEYS'); },
  });
  return { proxy, calls };
}

function oversizedArray(length, onRead) {
  const value = [];
  Object.defineProperty(value, '0', {
    enumerable: true,
    get() { onRead(); throw new Error('OVERSIZE_INDEX_ACCESSED'); },
  });
  value.length = length;
  return value;
}

test('catalog is complete, versioned, ordered and missing production truth stays null', () => {
  const snapshot = buildOperatingMetricCatalogSnapshot([], NOW);
  assert.deepEqual(OPERATING_METRIC_CATALOG.map((entry) => entry.metricId), OPERATING_METRIC_IDS);
  assert.equal(snapshot.entries.length, 17);
  assert.equal(snapshot.availableCount, 0);
  assert.equal(snapshot.dataInsufficientCount, 12);
  assert.equal(snapshot.unavailableCount, 5);
  assert.equal(snapshot.recordedReplayCount, 0);
  assert.match(snapshot.catalogRevision, /^system-operating-metrics:[0-9a-f]{32}$/);
  assert.match(snapshot.snapshotRevision, /^system-operating-metrics-snapshot:[0-9a-f]{32}$/);
  assert.deepEqual(OPERATING_RATIO_SEMANTICS, {
    semanticVersion: 'v1',
    scale: '1000000',
    rounding: 'ROUND_HALF_UP',
    denominatorConstraint: 'POSITIVE',
    numeratorConstraint: 'ZERO_TO_DENOMINATOR_INCLUSIVE',
    metrics: [
      { metricId: 'PRECISION', numeratorField: 'numerator', denominatorField: 'denominator', valueField: 'valuePermillion' },
      { metricId: 'RECALL', numeratorField: 'numerator', denominatorField: 'denominator', valueField: 'valuePermillion' },
      { metricId: 'RELIABILITY', numeratorField: 'successful', denominatorField: 'total', valueField: 'valuePermillion' },
      { metricId: 'UTILIZATION', numeratorField: 'used', denominatorField: 'capacity', valueField: 'valuePermillion' },
    ],
  });
  assert.deepEqual(EXPECTED_VS_REALIZED_VALUE_SEMANTICS, {
    semanticVersion: 'v1',
    metricId: 'EXPECTED_VS_REALIZED_VALUE',
    equation: 'delta = realized - expected',
    arithmetic: 'CAPITAL_EXACT_DECIMAL',
  });
  for (const entry of snapshot.entries) {
    assert.ok(Object.values(entry.measurements).every((value) => value === null));
    assert.notEqual(entry.status, 'AVAILABLE');
  }
});

test('owner facts are preserved without supervisor recomputation or replay relabeling', () => {
  const precision = fact('PRECISION', {
    measurements: { denominator: '10', numerator: '7', valuePermillion: '700000' },
  });
  const shortfall = fact('EXECUTION_SHORTFALL', { measurements: { amount: '-12.5' } });
  const freshness = fact('FRESHNESS', { measurements: { ageMs: '12' } });
  const snapshot = buildOperatingMetricCatalogSnapshot([precision, shortfall, freshness], NOW);
  const precisionEntry = snapshot.entries.find((entry) => entry.definition.metricId === 'PRECISION');
  const shortfallEntry = snapshot.entries.find((entry) => entry.definition.metricId === 'EXECUTION_SHORTFALL');
  assert.equal(precisionEntry.status, 'RECORDED_REPLAY');
  assert.deepEqual(precisionEntry.measurements, precision.measurements);
  assert.equal(shortfallEntry.status, 'RECORDED_REPLAY');
  assert.equal(shortfallEntry.measurements.amount, '-12.5');
  assert.equal(snapshot.availableCount, 1);
  assert.equal(snapshot.recordedReplayCount, 2);
});

test('DATA_INSUFFICIENT values remain null and zero fabrication is divergent', () => {
  const honest = fact('RECALL', {
    status: 'DATA_INSUFFICIENT', measuredAtMs: null,
    measurements: { denominator: null, numerator: null, valuePermillion: null },
    evidenceReferences: [], reasonCodes: ['RECORDED_OUTCOMES_ABSENT'],
  });
  const fabricated = fact('CALIBRATION', {
    status: 'DATA_INSUFFICIENT', measuredAtMs: null,
    measurements: { brierPermillion: '0', expectedCalibrationErrorPermillion: '0' },
    evidenceReferences: [], reasonCodes: ['RECORDED_OUTCOMES_ABSENT'],
  });
  const snapshot = buildOperatingMetricCatalogSnapshot([honest, fabricated], NOW);
  assert.equal(snapshot.entries.find((entry) => entry.definition.metricId === 'RECALL').status, 'DATA_INSUFFICIENT');
  const rejected = snapshot.entries.find((entry) => entry.definition.metricId === 'CALIBRATION');
  assert.equal(rejected.status, 'DIVERGENT');
  assert.ok(rejected.reasonCodes.includes('UNAVAILABLE_VALUE_FABRICATED'));
  assert.ok(Object.values(rejected.measurements).every((value) => value === null));
});

test('root and fact Proxies are rejected without traps or output, including revoked roots', () => {
  let output;
  const hostileRoot = trapZeroProxy([]);
  assert.throws(() => {
    output = buildOperatingMetricCatalogSnapshot(hostileRoot.proxy, NOW);
  }, /exact bounded own data at facts/);
  assert.equal(output, undefined);
  assert.deepEqual(hostileRoot.calls, {
    get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0,
  });

  const hostileFact = trapZeroProxy(fact('FRESHNESS', { measurements: { ageMs: '1' } }));
  assert.throws(() => {
    output = buildOperatingMetricCatalogSnapshot([hostileFact.proxy], NOW);
  }, /exact bounded own data at facts\[0\]/);
  assert.equal(output, undefined);
  assert.deepEqual(hostileFact.calls, {
    get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0,
  });

  const revoked = Proxy.revocable([], {});
  revoked.revoke();
  assert.throws(() => {
    output = buildOperatingMetricCatalogSnapshot(revoked.proxy, NOW);
  }, /exact bounded own data at facts/);
  assert.equal(output, undefined);
});

test('hostile measurements and evidence are redacted without invoking Proxies or accessors', () => {
  const hostileMeasurements = trapZeroProxy({ ageMs: '1' });
  const hostileEvidence = trapZeroProxy(['owner:freshness']);
  const hostileReasons = trapZeroProxy(['OWNER_UNAVAILABLE']);
  let accessorCalls = 0;
  const accessorMeasurements = {};
  Object.defineProperty(accessorMeasurements, 'ageMs', {
    enumerable: true,
    get() { accessorCalls += 1; return '1'; },
  });
  const snapshot = buildOperatingMetricCatalogSnapshot([
    fact('FRESHNESS', { measurements: hostileMeasurements.proxy }),
    fact('UPTIME', { measurements: { durationMs: '1' }, evidenceReferences: hostileEvidence.proxy }),
    fact('RECOVERY', { measurements: accessorMeasurements }),
    fact('RECALL', {
      status: 'UNAVAILABLE', measuredAtMs: null,
      measurements: { denominator: null, numerator: null, valuePermillion: null },
      evidenceReferences: [], reasonCodes: hostileReasons.proxy,
    }),
  ], NOW);
  for (const metricId of ['FRESHNESS', 'UPTIME', 'RECOVERY', 'RECALL']) {
    const entry = snapshot.entries.find((candidate) => candidate.definition.metricId === metricId);
    assert.equal(entry.status, 'DIVERGENT', metricId);
    assert.ok(Object.values(entry.measurements).every((value) => value === null), metricId);
  }
  assert.deepEqual(snapshot.entries.find((entry) => entry.definition.metricId === 'UPTIME').evidenceReferences, []);
  assert.deepEqual(hostileMeasurements.calls, {
    get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0,
  });
  assert.deepEqual(hostileEvidence.calls, {
    get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0,
  });
  assert.deepEqual(hostileReasons.calls, {
    get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0,
  });
  assert.equal(accessorCalls, 0);
});

test('over-bound fact and evidence arrays stop before index access', () => {
  let accessorCalls = 0;
  let output;
  assert.throws(() => {
    output = buildOperatingMetricCatalogSnapshot(
      oversizedArray(10_001, () => { accessorCalls += 1; }),
      NOW,
    );
  }, /facts\.length/);
  assert.equal(output, undefined);

  const snapshot = buildOperatingMetricCatalogSnapshot([
    fact('FRESHNESS', {
      measurements: { ageMs: '1' },
      evidenceReferences: oversizedArray(65, () => { accessorCalls += 1; }),
    }),
    fact('RECALL', {
      status: 'UNAVAILABLE', measuredAtMs: null,
      measurements: { denominator: null, numerator: null, valuePermillion: null },
      evidenceReferences: [],
      reasonCodes: oversizedArray(65, () => { accessorCalls += 1; }),
    }),
  ], NOW);
  assert.equal(snapshot.entries.find((entry) => entry.definition.metricId === 'FRESHNESS').status, 'DIVERGENT');
  assert.deepEqual(snapshot.entries.find((entry) => entry.definition.metricId === 'FRESHNESS').evidenceReferences, []);
  assert.equal(snapshot.entries.find((entry) => entry.definition.metricId === 'RECALL').status, 'DIVERGENT');
  assert.equal(accessorCalls, 0);
});

test('__proto__ cannot supply inherited measurements to an owner fact', () => {
  const genuine = fact('FRESHNESS', { measurements: { ageMs: '1' } });
  const { measurements, ...hostile } = genuine;
  Object.defineProperty(hostile, '__proto__', {
    enumerable: true,
    value: { measurements },
  });
  const entry = buildOperatingMetricCatalogSnapshot([hostile], NOW).entries
    .find((candidate) => candidate.definition.metricId === 'FRESHNESS');
  assert.equal(entry.status, 'DIVERGENT');
  assert.deepEqual(entry.measurements, { ageMs: null });
  assert.ok(entry.reasonCodes.includes('FACT_FIELDS_MISMATCH'));
});

test('root-wide node and canonical-byte budgets stop before late hostile facts', () => {
  let output;
  const lateNodeProxy = trapZeroProxy(fact('PRECISION'));
  const nodeHeavyFact = fact('PRECISION', {
    measurements: { denominator: '1', numerator: '1', valuePermillion: '1000000' },
    evidenceReferences: Array.from({ length: 64 }, (_, index) => `evidence-${index}`),
    reasonCodes: Array.from({ length: 64 }, (_, index) => `NODE_${index}`),
  });
  const nodeHeavy = Array.from({ length: 2_000 }, (_, index) => index === 1_999
    ? lateNodeProxy.proxy
    : nodeHeavyFact);
  assert.throws(() => {
    output = buildOperatingMetricCatalogSnapshot(nodeHeavy, NOW);
  }, /exact bounded own data/);
  assert.equal(output, undefined);
  assert.deepEqual(lateNodeProxy.calls, {
    get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0,
  });

  const lateByteProxy = trapZeroProxy(fact('FRESHNESS'));
  const maximumEvidence = 'x'.repeat(256);
  const byteHeavyFact = fact('FRESHNESS', {
    measurements: { ageMs: '1' },
    evidenceReferences: Array.from({ length: 64 }, () => maximumEvidence),
  });
  const byteHeavy = Array.from({ length: 700 }, (_, index) => index === 699
    ? lateByteProxy.proxy
    : byteHeavyFact);
  assert.throws(() => {
    output = buildOperatingMetricCatalogSnapshot(byteHeavy, NOW);
  }, /exact bounded own data/);
  assert.equal(output, undefined);
  assert.deepEqual(lateByteProxy.calls, {
    get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0,
  });
});

test('positive zero remains canonical and negative-zero times cannot enter a revision', () => {
  const positiveRoot = buildOperatingMetricCatalogSnapshot([], 0);
  assert.equal(Object.is(positiveRoot.evaluatedAtMs, 0), true);
  assert.equal(Object.is(positiveRoot.evaluatedAtMs, -0), false);
  assert.match(positiveRoot.snapshotRevision, /^system-operating-metrics-snapshot:[0-9a-f]{32}$/);
  assert.throws(() => buildOperatingMetricCatalogSnapshot([], -0), /evaluatedAtMs/);

  const positiveMeasured = buildOperatingMetricCatalogSnapshot([
    fact('FRESHNESS', { measuredAtMs: 0, measurements: { ageMs: '1' } }),
  ], NOW).entries.find((entry) => entry.definition.metricId === 'FRESHNESS');
  assert.equal(positiveMeasured.status, 'AVAILABLE');
  assert.equal(Object.is(positiveMeasured.measuredAtMs, 0), true);

  const negativeMeasured = buildOperatingMetricCatalogSnapshot([
    fact('FRESHNESS', { measuredAtMs: -0, measurements: { ageMs: '1' } }),
  ], NOW).entries.find((entry) => entry.definition.metricId === 'FRESHNESS');
  assert.equal(negativeMeasured.status, 'DIVERGENT');
  assert.equal(negativeMeasured.measuredAtMs, null);
  assert.ok(negativeMeasured.reasonCodes.includes('MEASURED_AT_INVALID'));
});

test('wrong owner, duplicate owner facts, future time and out-of-range ratios fail closed', () => {
  const snapshot = buildOperatingMetricCatalogSnapshot([
    fact('UPTIME', { owner: 'CAPITAL_ECONOMICS' }),
    fact('FRESHNESS'), fact('FRESHNESS'),
    fact('RECOVERY', { measuredAtMs: NOW + 1 }),
    fact('RELIABILITY', { measurements: { successful: '2', total: '2', valuePermillion: '1000001' } }),
  ], NOW);
  for (const metricId of ['UPTIME', 'FRESHNESS', 'RECOVERY', 'RELIABILITY']) {
    const entry = snapshot.entries.find((candidate) => candidate.definition.metricId === metricId);
    assert.equal(entry.status, 'DIVERGENT');
    assert.ok(Object.values(entry.measurements).every((value) => value === null));
  }
  assert.ok(snapshot.entries.find((entry) => entry.definition.metricId === 'UPTIME').reasonCodes.includes('OWNER_MISMATCH'));
  assert.deepEqual(snapshot.entries.find((entry) => entry.definition.metricId === 'FRESHNESS').reasonCodes, ['DUPLICATE_OWNER_FACT']);
});

test('all ratio owners use exact deterministic round-half-up permillion semantics', () => {
  const snapshot = buildOperatingMetricCatalogSnapshot([
    fact('PRECISION', { measurements: { denominator: '3', numerator: '1', valuePermillion: '333333' } }),
    fact('RECALL', { measurements: { denominator: '3', numerator: '2', valuePermillion: '666667' } }),
    fact('RELIABILITY', { measurements: { successful: '1', total: '128', valuePermillion: '7813' } }),
    fact('UTILIZATION', { measurements: { capacity: '8', used: '1', valuePermillion: '125000' } }),
  ], NOW);
  for (const metricId of ['PRECISION', 'RECALL', 'RELIABILITY', 'UTILIZATION']) {
    const entry = snapshot.entries.find((candidate) => candidate.definition.metricId === metricId);
    assert.notEqual(entry.status, 'DIVERGENT', metricId);
  }
  assert.equal(snapshot.entries.find((entry) => entry.definition.metricId === 'PRECISION').measurements.valuePermillion, '333333');
  assert.equal(snapshot.entries.find((entry) => entry.definition.metricId === 'RECALL').measurements.valuePermillion, '666667');
  assert.equal(snapshot.entries.find((entry) => entry.definition.metricId === 'RELIABILITY').measurements.valuePermillion, '7813');
});

test('contradictory ratios and numerator overflow fail closed while candidate lineage survives', () => {
  const snapshot = buildOperatingMetricCatalogSnapshot([
    fact('PRECISION', {
      sourceRevision: 'precision.invalid.v2',
      evidenceReferences: ['outcome:precision:2', 'outcome:precision:1'],
      measurements: { denominator: '10', numerator: '11', valuePermillion: '1000000' },
    }),
    fact('RECALL', { measurements: { denominator: '10', numerator: '7', valuePermillion: '600000' } }),
    fact('RELIABILITY', { measurements: { successful: '2', total: '1', valuePermillion: '1000000' } }),
    fact('UTILIZATION', { measurements: { capacity: '3', used: '1', valuePermillion: '333334' } }),
  ], NOW);
  for (const metricId of ['PRECISION', 'RECALL', 'RELIABILITY', 'UTILIZATION']) {
    const entry = snapshot.entries.find((candidate) => candidate.definition.metricId === metricId);
    assert.equal(entry.status, 'DIVERGENT', metricId);
    assert.ok(Object.values(entry.measurements).every((value) => value === null), metricId);
  }
  const precision = snapshot.entries.find((entry) => entry.definition.metricId === 'PRECISION');
  assert.ok(precision.reasonCodes.includes('RATIO_NUMERATOR_EXCEEDS_DENOMINATOR'));
  assert.equal(precision.sourceRevision, 'precision.invalid.v2');
  assert.deepEqual(precision.evidenceReferences, ['outcome:precision:1', 'outcome:precision:2']);
  assert.ok(snapshot.entries.find((entry) => entry.definition.metricId === 'RECALL').reasonCodes.includes('RATIO_VALUE_PERMILLION_MISMATCH'));
  assert.ok(snapshot.entries.find((entry) => entry.definition.metricId === 'RELIABILITY').reasonCodes.includes('RATIO_NUMERATOR_EXCEEDS_DENOMINATOR'));
  assert.ok(snapshot.entries.find((entry) => entry.definition.metricId === 'UTILIZATION').reasonCodes.includes('RATIO_VALUE_PERMILLION_MISMATCH'));

  const zeroDenominator = buildOperatingMetricCatalogSnapshot([
    fact('PRECISION', { measurements: { denominator: '0', numerator: '0', valuePermillion: '0' } }),
  ], NOW).entries.find((entry) => entry.definition.metricId === 'PRECISION');
  assert.equal(zeroDenominator.status, 'DIVERGENT');
  assert.ok(zeroDenominator.reasonCodes.includes('RATIO_DENOMINATOR_NOT_POSITIVE'));

  const unbounded = buildOperatingMetricCatalogSnapshot([
    fact('RECALL', { measurements: { denominator: '3', numerator: '1'.repeat(129), valuePermillion: '333333' } }),
  ], NOW).entries.find((entry) => entry.definition.metricId === 'RECALL');
  assert.equal(unbounded.status, 'DIVERGENT');
  assert.ok(unbounded.reasonCodes.includes('MEASUREMENT_NUMERATOR_TOO_LONG'));
});

test('expected-versus-realized value enforces the exact signed owner equation', () => {
  const exact = buildOperatingMetricCatalogSnapshot([
    fact('EXPECTED_VS_REALIZED_VALUE', {
      measurements: {
        expected: '100000000000000000000.000000000000000001',
        realized: '99999999999999999999.999999999999999999',
        delta: '-0.000000000000000002',
      },
    }),
  ], NOW).entries.find((entry) => entry.definition.metricId === 'EXPECTED_VS_REALIZED_VALUE');
  assert.equal(exact.status, 'RECORDED_REPLAY');
  assert.equal(exact.measurements.delta, '-0.000000000000000002');

  const contradictory = buildOperatingMetricCatalogSnapshot([
    fact('EXPECTED_VS_REALIZED_VALUE', {
      sourceRevision: 'expected-realized.contradictory.v1',
      measurements: { expected: '100', realized: '0', delta: '100' },
      evidenceReferences: ['capital-economics:expected-realized:contradictory'],
    }),
  ], NOW).entries.find((entry) => entry.definition.metricId === 'EXPECTED_VS_REALIZED_VALUE');
  assert.equal(contradictory.status, 'DIVERGENT');
  assert.ok(contradictory.reasonCodes.includes(EXPECTED_REALIZED_DELTA_MISMATCH));
  assert.deepEqual(contradictory.measurements, { delta: null, expected: null, realized: null });
  assert.equal(contradictory.sourceRevision, 'expected-realized.contradictory.v1');
});

test('snapshot revision binds owner source, evidence and values but ignores fact and set order', () => {
  const precision = fact('PRECISION', {
    sourceRevision: 'precision.snapshot.v1',
    measurements: { denominator: '10', numerator: '7', valuePermillion: '700000' },
    evidenceReferences: ['outcome:precision:2', 'outcome:precision:1'],
  });
  const reliability = fact('RELIABILITY', {
    measurements: { successful: '9', total: '10', valuePermillion: '900000' },
    evidenceReferences: ['control:reliability:2', 'control:reliability:1'],
  });
  const unavailable = fact('RECALL', {
    status: 'DATA_INSUFFICIENT',
    measuredAtMs: null,
    measurements: { denominator: null, numerator: null, valuePermillion: null },
    evidenceReferences: [],
    reasonCodes: ['WINDOW_EMPTY', 'OUTCOMES_ABSENT'],
  });
  const first = buildOperatingMetricCatalogSnapshot([precision, reliability, unavailable], NOW);
  const reordered = buildOperatingMetricCatalogSnapshot([
    { ...unavailable, reasonCodes: ['OUTCOMES_ABSENT', 'WINDOW_EMPTY'] },
    { ...reliability, evidenceReferences: [...reliability.evidenceReferences].reverse() },
    {
      ...precision,
      measurements: { valuePermillion: '700000', numerator: '7', denominator: '10' },
      evidenceReferences: [...precision.evidenceReferences].reverse(),
    },
  ], NOW);
  assert.equal(reordered.catalogRevision, first.catalogRevision);
  assert.equal(reordered.snapshotRevision, first.snapshotRevision);

  const changedSource = buildOperatingMetricCatalogSnapshot([
    { ...precision, sourceRevision: 'precision.snapshot.v2' }, reliability, unavailable,
  ], NOW);
  const changedEvidence = buildOperatingMetricCatalogSnapshot([
    { ...precision, evidenceReferences: ['outcome:precision:3'] }, reliability, unavailable,
  ], NOW);
  const changedValue = buildOperatingMetricCatalogSnapshot([
    {
      ...precision,
      measurements: { denominator: '10', numerator: '8', valuePermillion: '800000' },
    },
    reliability,
    unavailable,
  ], NOW);
  for (const changed of [changedSource, changedEvidence, changedValue]) {
    assert.equal(changed.catalogRevision, first.catalogRevision);
    assert.notEqual(changed.snapshotRevision, first.snapshotRevision);
  }
});
