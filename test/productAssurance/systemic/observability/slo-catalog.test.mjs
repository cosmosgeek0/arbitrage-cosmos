import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixtureUrl = new URL('../../../../fixtures/productAssurance/systemic/observability/cases/slo-catalog-complete.json', import.meta.url);

const REQUIRED_SLO_CATEGORIES = Object.freeze([
  'SOURCE_COHERENCE_AGE',
  'QUEUE_BACKPRESSURE',
  'PROCESSING_COMMAND_LATENCY',
  'AMBIGUITY_DURATION',
  'RECONCILIATION_LAG',
  'EVIDENCE_EXPIRY',
  'TELEMETRY_COMPLETENESS',
  'RECOVERY_VERIFICATION',
  'SENTINEL_PAGING_DELIVERY',
  'RESTART_RTO_RPO',
  'RESOURCE_BUDGET',
]);

const REQUIRED_HISTORICAL_FAMILIES = Object.freeze([
  'SOURCE_AGE_PERCENTILES',
  'PROCESSING_AGE_PERCENTILES',
  'CROSS_SOURCE_SKEW',
  'QUEUE_DEPTH_BACKPRESSURE',
  'DROPPED_COALESCED_EVENTS',
  'RECONCILIATION_GAP',
  'AMBIGUITY_DURATION',
  'AUTOMATIC_RECOVERY_RESULT_RATE',
  'EXECUTION_COST',
  'SLIPPAGE',
  'FUNDING',
  'BORROW_INTEREST',
  'MARKET_IMPACT',
  'INCIDENT_FREQUENCY',
  'RECURRING_FAILED_INVARIANTS',
  'CPU_BUDGET',
  'MEMORY_BUDGET',
  'DISK_BUDGET',
  'WAL_BUDGET',
  'API_RATE_BUDGET',
  'TELEMETRY_BUDGET',
  'TOKEN_BUDGET',
  'COST_BUDGET',
]);

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

test('synthetic SLO catalog represents every amendment section 6.6 category exactly once', async () => {
  const input = await fixture();
  const categories = input.slos.map((entry) => entry.category).sort();
  assert.deepEqual(categories, [...REQUIRED_SLO_CATEGORIES].sort());
  assert.equal(new Set(input.slos.map((entry) => `${entry.sloId}@${entry.version}`)).size, 11);
  assert.equal(input.slos.every((entry) => entry.truthLabel === 'SYNTHETIC_ONLY'), true);
  assert.equal(input.slos.every((entry) => entry.authority === 'SYNTHETIC_TEST'), true);
  assert.equal(input.slos.every((entry) => entry.evidenceOnly), true);
  assert.equal(input.slos.every((entry) => entry.syntheticWindow.sampleCount > 0
    && entry.syntheticWindow.startMs < entry.syntheticWindow.endMs), true);
  assert.equal(new Set(input.slos.map((entry) => entry.syntheticWindow.windowId)).size, 11);
});

test('historical registry covers every required metric family exactly once', async () => {
  const input = await fixture();
  const families = input.historicalMetricRegistry.map((entry) => entry.family).sort();
  assert.deepEqual(families, [...REQUIRED_HISTORICAL_FAMILIES].sort());
  assert.equal(new Set(input.historicalMetricRegistry.map((entry) => entry.metricId)).size, 23);
  assert.equal(input.historicalMetricRegistry.every((entry) => entry.maximumSeriesPoints > 0), true);
  assert.equal(input.historicalMetricRegistry.every((entry) => entry.retentionWindowMs > 0), true);
});

test('source and processing age families mandate p50, p95, and p99', async () => {
  const input = await fixture();
  for (const family of ['SOURCE_AGE_PERCENTILES', 'PROCESSING_AGE_PERCENTILES']) {
    const metric = input.historicalMetricRegistry.find((entry) => entry.family === family);
    assert.deepEqual(metric.statistics, ['P50', 'P95', 'P99']);
  }
});

test('catalog and metric registry remain synthetic evidence with no mutation authority', async () => {
  const input = await fixture();
  assert.equal(input.truthLabel, 'SYNTHETIC_ONLY');
  assert.equal(input.authority, 'SYNTHETIC_TEST');
  assert.equal(input.dataMode, 'SYNTHETIC');
  assert.equal(input.evidenceOnly, true);
  assert.deepEqual(input.effectPolicy, {
    authority: 'EVIDENCE_ONLY',
    mayMutateCapital: false,
    mayMutateControls: false,
    mayExecuteRepair: false,
    riskReductionMustRemainAvailable: true,
  });
  assert.equal(input.historicalMetricRegistry.every((entry) => entry.truthLabel === 'SYNTHETIC_ONLY'
    && entry.authority === 'SYNTHETIC_TEST' && entry.evidenceOnly), true);
});
