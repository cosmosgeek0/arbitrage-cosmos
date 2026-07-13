import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertCanonicalExactDecimal,
  compareCanonicalExactDecimals,
  deriveHistoricalSeriesSha256,
  divideMetricValuesToDecimal,
  evaluateHistoricalSeries,
  nearestRankExactDecimal,
  sumCanonicalExactDecimals,
} from '../../../../fixtures/productAssurance/systemic/observability/historical-series-evaluator.mjs';
import {
  assertJsonSchemaValid,
  assertSchemaSubsetSupported,
} from '../cockpit/support/json-schema-2020-12-subset.mjs';

const fixtureUrl = new URL(
  '../../../../fixtures/productAssurance/systemic/observability/cases/historical-series-complete.json',
  import.meta.url,
);
const catalogUrl = new URL(
  '../../../../fixtures/productAssurance/systemic/observability/cases/slo-catalog-complete.json',
  import.meta.url,
);
const schemaUrl = new URL(
  '../../../../fixtures/productAssurance/systemic/observability/historical-series.schema.json',
  import.meta.url,
);
const evaluatorUrl = new URL(
  '../../../../fixtures/productAssurance/systemic/observability/historical-series-evaluator.mjs',
  import.meta.url,
);

const catalogFixture = JSON.parse(await readFile(catalogUrl, 'utf8'));
const schemaFixture = JSON.parse(await readFile(schemaUrl, 'utf8'));

const EXACT_FAMILIES = [
  'AMBIGUITY_DURATION',
  'API_RATE_BUDGET',
  'AUTOMATIC_RECOVERY_RESULT_RATE',
  'BORROW_INTEREST',
  'COST_BUDGET',
  'CPU_BUDGET',
  'CROSS_SOURCE_SKEW',
  'DISK_BUDGET',
  'DROPPED_COALESCED_EVENTS',
  'EXECUTION_COST',
  'FUNDING',
  'INCIDENT_FREQUENCY',
  'MARKET_IMPACT',
  'MEMORY_BUDGET',
  'PROCESSING_AGE_PERCENTILES',
  'QUEUE_DEPTH_BACKPRESSURE',
  'RECONCILIATION_GAP',
  'RECURRING_FAILED_INVARIANTS',
  'SLIPPAGE',
  'SOURCE_AGE_PERCENTILES',
  'TELEMETRY_BUDGET',
  'TOKEN_BUDGET',
  'WAL_BUDGET',
];

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

function evaluate(input, catalog = structuredClone(catalogFixture)) {
  return evaluateHistoricalSeries(input, catalog);
}

function seriesOf(container, metricId) {
  return container.series.find((entry) => entry.metricId === metricId);
}

function rehash(series) {
  series.seriesSha256 = deriveHistoricalSeriesSha256(series);
}

test('schema is closed/bounded and the fixture declares the exact 23-family denominator', async () => {
  const input = await fixture();
  assert.equal(assertSchemaSubsetSupported(schemaFixture), true);
  assert.equal(assertJsonSchemaValid(schemaFixture, input, 'historical-series-complete.json'), true);
  assert.equal(input.series.length, 23);
  assert.deepEqual(input.series.map((entry) => entry.family).sort(), EXACT_FAMILIES);
  assert.deepEqual(
    ['EXECUTION_COST', 'SLIPPAGE', 'FUNDING', 'BORROW_INTEREST', 'MARKET_IMPACT']
      .every((family) => input.series.some((entry) => entry.family === family)),
    true,
  );
});

test('all 23 catalog-bound series contract-pass, but synthetic evidence never claims live green', async () => {
  const output = evaluate(await fixture());
  assert.equal(output.contractResult, 'PASS');
  assert.equal(output.historicalResult, 'PASS');
  assert.equal(output.currentResult, 'PASS');
  assert.equal(output.greenEligible, true);
  assert.equal(output.liveGreenEligible, false);
  assert.deepEqual(output.truthReasonCodes, ['HISTORICAL_SERIES_NOT_ALL_LIVE_PUBLIC']);
  assert.equal(output.expectedSeriesCount, 23);
  assert.equal(output.evaluatedSeriesCount, 23);
  assert.deepEqual(output.missingMetricIds, []);
  assert.deepEqual(output.extraMetricIds, []);
  assert.ok(output.series.every((entry) => entry.bindingResult === 'PASS'));
  assert.ok(output.series.every((entry) => entry.liveGreenEligible === false));
});

test('summaries and points are deterministic, canonical, and render-neutral', async () => {
  const input = await fixture();
  const output = evaluate(input);
  assert.deepEqual(
    output.series.map((entry) => entry.metricId),
    output.series.map((entry) => entry.metricId).toSorted(),
  );

  const source = seriesOf(output, 'source-age-percentiles');
  assert.deepEqual(source.historical, {
    sampleCount: 4,
    p50: 20,
    p95: 40,
    p99: 40,
    latest: 10,
    minimum: 10,
    maximum: 40,
    trendDirection: 'DECREASING',
    trendMethod: 'FIRST_TO_LATEST',
    percentileMethod: 'NEAREST_RANK',
  });
  assert.equal(seriesOf(output, 'cross-source-skew').historical.trendDirection, 'FLAT');
  const execution = seriesOf(output, 'execution-cost');
  assert.deepEqual(execution.points.map((point) => point.observedAtMs), [1000, 1800, 2400, 3000]);
  assert.deepEqual(execution.points.map((point) => point.value), [
    '1.000000000000000001',
    '2.000000000000000001',
    '3.000000000000000001',
    '4.000000000000000001',
  ]);
  assert.equal(execution.evidenceBinding.ownerId, 'CAPITAL_SUPERVISION');
  assert.equal(execution.coherenceState, 'COHERENT');
  assert.equal(execution.derivedCoherenceState, 'COHERENT');
});

test('declared COUNT/RATE/SUM/UTILIZATION/BURN_RATE have bound inputs and evaluated values', async () => {
  const output = evaluate(await fixture());
  for (const expected of catalogFixture.historicalMetricRegistry) {
    assert.deepEqual(Object.keys(seriesOf(output, expected.metricId).declaredStatistics), expected.statistics);
  }
  assert.deepEqual(seriesOf(output, 'dropped-coalesced-events').declaredStatistics, {
    COUNT: 26,
    RATE: {
      kind: 'PER_TIME',
      numeratorCount: 26,
      denominatorMs: 2000,
      value: '13',
      unit: 'count-per-second',
      method: 'EXACT_DECIMAL_SCALE_18_HALF_UP',
    },
  });
  assert.deepEqual(seriesOf(output, 'automatic-recovery-result-rate').declaredStatistics, {
    COUNT: 4,
    RATE: {
      kind: 'RATIO',
      numeratorCount: 2,
      denominatorCount: 4,
      value: '0.5',
      unit: 'ratio',
      method: 'EXACT_DECIMAL_SCALE_18_HALF_UP',
    },
  });
  assert.deepEqual(seriesOf(output, 'cpu-budget').declaredStatistics.UTILIZATION, {
    numerator: 40,
    denominator: 100,
    value: '40',
    unit: 'percent',
    method: 'EXACT_DECIMAL_SCALE_18_HALF_UP',
  });
  assert.equal(seriesOf(output, 'cpu-budget').declaredStatistics.BURN_RATE.value, '1');
});

test('quote-asset percentiles and sums remain canonical exact decimals without binary64 projection', async () => {
  const output = evaluate(await fixture());
  const execution = seriesOf(output, 'execution-cost');
  assert.equal(execution.historical.p50, '2.000000000000000001');
  assert.equal(execution.historical.p95, '4.000000000000000001');
  assert.equal(execution.historical.latest, '4.000000000000000001');
  assert.equal(execution.historical.minimum, '1.000000000000000001');
  assert.equal(execution.declaredStatistics.SUM, '10.000000000000000004');
  assert.equal(seriesOf(output, 'funding').declaredStatistics.SUM, '-1');
  assert.equal(sumCanonicalExactDecimals(['0.1', '0.2']), '0.3');
  assert.equal(nearestRankExactDecimal(['10', '2', '1'], 50), '2');
  assert.equal(compareCanonicalExactDecimals('0.000000000000000001', '0.000000000000000002'), -1);
  assert.equal(divideMetricValuesToDecimal('1', '3'), '0.333333333333333333');
});

test('numeric coercion, noncanonical exact decimals, sign violations, and overflow fail closed', async () => {
  const numericMoney = await fixture();
  const execution = seriesOf(numericMoney, 'execution-cost');
  execution.samples[0].value = 4;
  rehash(execution);
  const numericOutput = evaluate(numericMoney);
  const evaluated = seriesOf(numericOutput, 'execution-cost');
  assert.equal(evaluated.historicalResult, 'FAIL');
  assert.ok(evaluated.historicalReasonCodes.includes('HISTORICAL_SERIES_EXACT_DECIMAL_REQUIRED'));
  assert.equal(evaluated.historical.p50, null);

  for (const invalid of ['01', '1.0', '1e2', '+1', '-0', '0.00']) {
    assert.throws(() => assertCanonicalExactDecimal(invalid), /normalized plain base-10/);
  }
  assert.throws(() => assertCanonicalExactDecimal('1'.repeat(97)), /exceeds 96/);

  const negativeCost = await fixture();
  const negativeExecution = seriesOf(negativeCost, 'execution-cost');
  negativeExecution.samples[0].value = '-1';
  rehash(negativeExecution);
  assert.ok(
    seriesOf(evaluate(negativeCost), 'execution-cost').historicalReasonCodes
      .includes('HISTORICAL_SERIES_NEGATIVE_VALUE_FORBIDDEN'),
  );

  const basisPoints = await fixture();
  const slippage = seriesOf(basisPoints, 'slippage');
  slippage.samples[0].value = 1_000_001;
  rehash(slippage);
  assert.ok(
    seriesOf(evaluate(basisPoints), 'slippage').historicalReasonCodes
      .includes('HISTORICAL_SERIES_BASIS_POINTS_OUT_OF_RANGE'),
  );
});

test('catalog identity, revision, digest, and release bindings fail closed', async () => {
  for (const [field, value, reason] of [
    ['catalogId', 'caller-catalog', 'HISTORICAL_CATALOG_ID_MISMATCH'],
    ['catalogRevision', 2, 'HISTORICAL_CATALOG_REVISION_MISMATCH'],
    ['catalogSha256', '2'.repeat(64), 'HISTORICAL_CATALOG_DECLARED_DIGEST_MISMATCH'],
    ['releaseSha', '2'.repeat(40), 'HISTORICAL_CATALOG_RELEASE_MISMATCH'],
  ]) {
    const input = await fixture();
    input.catalogBinding[field] = value;
    const output = evaluate(input);
    assert.equal(output.historicalResult, 'FAIL', field);
    assert.ok(output.catalogBinding.historicalReasonCodes.includes(reason), field);
    assert.equal(output.greenEligible, false, field);
  }

  const hostileCatalog = structuredClone(catalogFixture);
  hostileCatalog.historicalMetricRegistry[0].ownerId = 'CALLER_OWNER';
  const hostileOutput = evaluate(await fixture(), hostileCatalog);
  assert.equal(hostileOutput.historicalResult, 'FAIL');
  assert.ok(hostileOutput.catalogBinding.historicalReasonCodes
    .includes('HISTORICAL_CATALOG_CANONICAL_DIGEST_MISMATCH'));
});

test('per-series release, owner, unit, digest, and evidence bindings fail closed', async () => {
  const cases = [
    ['release', (entry) => { entry.releaseSha = '2'.repeat(40); }, 'HISTORICAL_SERIES_RELEASE_MISMATCH'],
    ['owner', (entry) => { entry.ownerId = 'CALLER_OWNER'; }, 'HISTORICAL_SERIES_OWNER_MISMATCH'],
    ['unit', (entry) => { entry.unit = 'seconds'; }, 'HISTORICAL_SERIES_UNIT_MISMATCH'],
    ['catalog revision', (entry) => { entry.catalogRevision = 2; }, 'HISTORICAL_SERIES_CATALOG_REVISION_MISMATCH'],
    ['catalog digest', (entry) => { entry.catalogSha256 = '2'.repeat(64); }, 'HISTORICAL_SERIES_CATALOG_DIGEST_MISMATCH'],
    ['catalog evidence', (entry) => { entry.evidenceBinding.catalogEvidenceRefId = 'evidence:other'; }, 'HISTORICAL_SERIES_CATALOG_EVIDENCE_MISMATCH'],
    ['evidence owner', (entry) => { entry.evidenceBinding.ownerId = 'CALLER_OWNER'; }, 'HISTORICAL_SERIES_EVIDENCE_OWNER_MISMATCH'],
    ['sample evidence', (entry) => { entry.evidenceBinding.sampleEvidenceIds.pop(); }, 'HISTORICAL_SERIES_SAMPLE_EVIDENCE_SET_MISMATCH'],
  ];
  for (const [label, mutate, reason] of cases) {
    const input = await fixture();
    const source = seriesOf(input, 'source-age-percentiles');
    mutate(source);
    rehash(source);
    const evaluated = seriesOf(evaluate(input), 'source-age-percentiles');
    assert.equal(evaluated.historicalResult, 'FAIL', label);
    assert.ok(evaluated.historicalReasonCodes.includes(reason), label);
    assert.equal(evaluated.liveGreenEligible, false, label);
  }

  const digestDrift = await fixture();
  seriesOf(digestDrift, 'source-age-percentiles').samples[0].value += 1;
  assert.ok(
    seriesOf(evaluate(digestDrift), 'source-age-percentiles').historicalReasonCodes
      .includes('HISTORICAL_SERIES_CANONICAL_DIGEST_MISMATCH'),
  );
});

test('missing expected series is UNKNOWN while an unexpected replacement is FAIL', async () => {
  const missingInput = await fixture();
  missingInput.series = missingInput.series.filter((entry) => entry.metricId !== 'market-impact');
  const missing = evaluate(missingInput);
  assert.equal(missing.historicalResult, 'UNKNOWN');
  assert.deepEqual(missing.missingMetricIds, ['market-impact']);
  assert.equal(seriesOf(missing, 'market-impact').historicalResult, 'UNKNOWN');

  const extraInput = await fixture();
  const replacement = seriesOf(extraInput, 'market-impact');
  replacement.metricId = 'caller-extra-metric';
  replacement.seriesId = 'historical-series:caller-extra-metric:r1';
  rehash(replacement);
  const extra = evaluate(extraInput);
  assert.equal(extra.historicalResult, 'FAIL');
  assert.deepEqual(extra.extraMetricIds, ['caller-extra-metric']);
  assert.deepEqual(extra.missingMetricIds, ['market-impact']);
});

test('stale current eligibility is UNKNOWN without rewriting immutable historical output', async () => {
  const input = await fixture();
  const fresh = evaluate(input);
  const staleInput = structuredClone(input);
  staleInput.nowMs = 10_000;
  const stale = evaluate(staleInput);
  assert.equal(fresh.historicalResult, 'PASS');
  assert.equal(stale.historicalResult, 'PASS');
  assert.equal(stale.contractResult, 'PASS');
  assert.equal(stale.currentResult, 'UNKNOWN');
  assert.equal(stale.greenEligible, false);
  assert.ok(stale.catalogBinding.currentReasonCodes
    .includes('HISTORICAL_CATALOG_VERIFICATION_STALE_FOR_CURRENT'));
  for (const freshSeries of fresh.series) {
    const staleSeries = seriesOf(stale, freshSeries.metricId);
    assert.deepEqual(staleSeries.historical, freshSeries.historical);
    assert.deepEqual(staleSeries.declaredStatistics, freshSeries.declaredStatistics);
    assert.deepEqual(staleSeries.points, freshSeries.points);
    assert.equal(staleSeries.historicalResult, 'PASS');
    assert.equal(staleSeries.currentResult, 'UNKNOWN');
  }
});

test('future samples/evidence, incoherence, and cross-view windows cannot green', async () => {
  const futureSample = await fixture();
  const futureSource = seriesOf(futureSample, 'source-age-percentiles');
  futureSource.samples[0].observedAtMs = 5000;
  futureSource.evidenceBinding.observedAtMs = 5000;
  rehash(futureSource);
  const futureEvaluated = seriesOf(evaluate(futureSample), 'source-age-percentiles');
  assert.equal(futureEvaluated.historicalResult, 'FAIL');
  assert.ok(futureEvaluated.historicalReasonCodes.includes('HISTORICAL_SERIES_SAMPLE_FROM_FUTURE'));

  const futureEvidence = await fixture();
  const evidenceSource = seriesOf(futureEvidence, 'source-age-percentiles');
  evidenceSource.evidenceBinding.observedAtMs = 5000;
  rehash(evidenceSource);
  assert.ok(seriesOf(evaluate(futureEvidence), 'source-age-percentiles').historicalReasonCodes
    .includes('HISTORICAL_SERIES_EVIDENCE_FROM_FUTURE'));

  const incoherentInput = await fixture();
  const incoherent = seriesOf(incoherentInput, 'source-age-percentiles');
  incoherent.samples.find((sample) => sample.observedAtMs === 1800).observedAtMs = 1100;
  rehash(incoherent);
  assert.ok(seriesOf(evaluate(incoherentInput), 'source-age-percentiles').historicalReasonCodes
    .includes('HISTORICAL_SERIES_COHERENCE_CLAIM_MISMATCH'));

  const unknownInput = await fixture();
  const unknown = seriesOf(unknownInput, 'source-age-percentiles');
  unknown.coherenceState = 'UNKNOWN';
  rehash(unknown);
  assert.equal(seriesOf(evaluate(unknownInput), 'source-age-percentiles').historicalResult, 'UNKNOWN');

  const splitView = await fixture();
  splitView.viewWindowPolicy.startMs = 999;
  const splitOutput = evaluate(splitView);
  assert.equal(splitOutput.historicalResult, 'FAIL');
  assert.ok(splitOutput.series.every((entry) => entry.historicalReasonCodes
    .includes('HISTORICAL_SERIES_VIEW_WINDOW_MISMATCH')));
});

test('declared statistic contexts reject zero/negative/overclaimed denominators and unproved recovery rates', async () => {
  const hostileCases = [
    ['ratio zero', 'automatic-recovery-result-rate', (entry) => { entry.statisticContext.rateDenominatorCount = 0; }, 'HISTORICAL_SERIES_RATIO_RATE_CONTEXT_INVALID'],
    ['ratio overclaim', 'automatic-recovery-result-rate', (entry) => { entry.statisticContext.rateNumeratorCount = 5; }, 'HISTORICAL_SERIES_RATIO_RATE_CONTEXT_INVALID'],
    ['recovery evidence', 'automatic-recovery-result-rate', (entry) => { entry.samples[0].value = 0; }, 'HISTORICAL_SERIES_RECOVERY_RATE_EVIDENCE_MISMATCH'],
    ['per-time denominator', 'dropped-coalesced-events', (entry) => { entry.statisticContext.rateDenominatorMs = null; }, 'HISTORICAL_SERIES_PER_TIME_RATE_CONTEXT_INVALID'],
    ['capacity zero', 'cpu-budget', (entry) => { entry.statisticContext.capacity = 0; }, 'HISTORICAL_SERIES_CAPACITY_MISSING_OR_INVALID'],
    ['budget negative', 'cpu-budget', (entry) => { entry.statisticContext.budget = -1; }, 'HISTORICAL_SERIES_BUDGET_MISSING_OR_INVALID'],
  ];
  for (const [label, metricId, mutate, reason] of hostileCases) {
    const input = await fixture();
    const entry = seriesOf(input, metricId);
    mutate(entry);
    rehash(entry);
    const evaluated = seriesOf(evaluate(input), metricId);
    assert.equal(evaluated.historicalResult, 'FAIL', label);
    assert.ok(evaluated.historicalReasonCodes.includes(reason), label);
    assert.equal(evaluated.declaredStatistics, null, label);
  }
  assert.throws(() => divideMetricValuesToDecimal('1', '0'), /denominator must be positive/);
  assert.throws(() => divideMetricValuesToDecimal('1', '-1'), /denominator must be positive/);
});

test('duplicate identities/timestamps/evidence and non-finite values are rejected before evaluation', async () => {
  for (const [label, mutate, pattern] of [
    ['sampleId', (entry) => { entry.samples[1].sampleId = entry.samples[0].sampleId; }, /duplicate key/],
    ['evidenceId', (entry) => { entry.samples[1].evidenceId = entry.samples[0].evidenceId; }, /duplicate key/],
    ['observedAtMs', (entry) => { entry.samples[1].observedAtMs = entry.samples[0].observedAtMs; }, /duplicate key/],
    ['NaN', (entry) => { entry.samples[0].value = Number.NaN; }, /must be finite/],
    ['Infinity', (entry) => { entry.samples[0].value = Number.POSITIVE_INFINITY; }, /must be finite/],
  ]) {
    const input = await fixture();
    mutate(seriesOf(input, 'source-age-percentiles'));
    assert.throws(() => evaluate(input), pattern, label);
  }
});

test('evaluation is import-pure, deterministic, non-mutating, and deeply frozen', async () => {
  const source = await readFile(evaluatorUrl, 'utf8');
  for (const forbidden of [
    /Date\.now\s*\(/,
    /Math\.random\s*\(/,
    /process\.env/,
    /\bfetch\s*\(/,
    /\bsetTimeout\s*\(/,
    /\bsetInterval\s*\(/,
    /node:(?:fs|net|http|https|child_process|worker_threads|crypto)/,
    /server\/src\//,
    /web\/src\//,
  ]) assert.doesNotMatch(source, forbidden);

  const input = await fixture();
  const catalog = structuredClone(catalogFixture);
  const beforeInput = JSON.stringify(input);
  const beforeCatalog = JSON.stringify(catalog);
  const first = evaluate(input, catalog);
  const second = evaluate(input, catalog);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), beforeInput);
  assert.equal(JSON.stringify(catalog), beforeCatalog);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.catalogBinding), true);
  assert.equal(Object.isFrozen(first.series), true);
  assert.equal(Object.isFrozen(first.series[0].historical), true);
  assert.equal(Object.isFrozen(first.series[0].points[0]), true);
  assert.throws(() => { first.series[0].points[0].value = 99; }, TypeError);
});
