import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  HISTORICAL_METRIC_CONTRACTS,
  SLO_CATEGORIES,
  SLO_SUBOBJECTIVE_CONTRACTS,
  SLO_SUBOBJECTIVE_IDS,
  validateSloCatalog,
} from '../../../../fixtures/productAssurance/systemic/observability/slo-catalog-contract.mjs';

const fixtureUrl = new URL(
  '../../../../fixtures/productAssurance/systemic/observability/cases/slo-catalog-complete.json',
  import.meta.url,
);

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

test('catalog denominator is the exact 25-subobjective law, not eleven category labels', async () => {
  const input = await fixture();
  const validation = validateSloCatalog(input);
  assert.equal(input.slos.length, 25);
  assert.deepEqual(input.slos.map((entry) => entry.sloId), SLO_SUBOBJECTIVE_IDS);
  assert.deepEqual(validation.missingSubobjectiveIds, []);
  assert.deepEqual(validation.unexpectedSubobjectiveIds, []);
  assert.deepEqual(validation.sloContractMismatches, []);
  assert.deepEqual([...new Set(input.slos.map((entry) => entry.category))], SLO_CATEGORIES);
  assert.deepEqual(Object.fromEntries(SLO_CATEGORIES.map((category) => [
    category,
    input.slos.filter((entry) => entry.category === category).length,
  ])), {
    SOURCE_COHERENCE_AGE: 2,
    QUEUE_BACKPRESSURE: 2,
    PROCESSING_COMMAND_LATENCY: 2,
    AMBIGUITY_DURATION: 1,
    RECONCILIATION_LAG: 1,
    EVIDENCE_EXPIRY: 1,
    TELEMETRY_COMPLETENESS: 1,
    RECOVERY_VERIFICATION: 2,
    SENTINEL_PAGING_DELIVERY: 3,
    RESTART_RTO_RPO: 2,
    RESOURCE_BUDGET: 8,
  });
});

test('sixteen historical sources and nine owner-evidence sources are distinct and exact', async () => {
  const input = await fixture();
  const historical = input.slos.filter((entry) => (
    entry.measurementSource.kind === 'HISTORICAL_METRIC_STATISTIC'
  ));
  const canonical = input.slos.filter((entry) => (
    entry.measurementSource.kind === 'CANONICAL_OWNER_EVIDENCE'
  ));
  assert.equal(historical.length, 16);
  assert.equal(canonical.length, 9);
  assert.equal(new Set(input.slos.map((entry) => JSON.stringify(entry.measurementSource))).size, 25);
  for (const entry of historical) {
    assert.deepEqual(entry.historicalMetricBindings, [{
      metricId: entry.measurementSource.metricId,
      family: entry.measurementSource.family,
    }]);
  }
  for (const entry of canonical) {
    assert.deepEqual(entry.historicalMetricBindings, []);
    assert.equal(entry.measurementSource.ownerId, entry.ownerId);
  }
  assert.deepEqual(input.slos.map((entry) => ({
    sloId: entry.sloId,
    category: entry.category,
    ownerId: entry.ownerId,
    measurementSource: entry.measurementSource,
  })), SLO_SUBOBJECTIVE_CONTRACTS.map((entry) => ({
    sloId: entry.sloId,
    category: entry.category,
    ownerId: entry.ownerId,
    measurementSource: entry.measurementSource,
  })));
});

test('historical registry freezes all 23 metric contracts and excludes sample-sum burn rate', async () => {
  const input = await fixture();
  const validation = validateSloCatalog(input);
  assert.equal(input.historicalMetricRegistry.length, 23);
  assert.deepEqual(validation.missingMetricFamilies, []);
  assert.deepEqual(validation.metricContractMismatches, []);
  assert.deepEqual(input.historicalMetricRegistry.map((entry) => ({
    metricId: entry.metricId,
    family: entry.family,
    ownerId: entry.ownerId,
    unit: entry.unit,
    statistics: entry.statistics,
    maximumSeriesPoints: entry.maximumSeriesPoints,
    retentionWindowMs: entry.retentionWindowMs,
  })), HISTORICAL_METRIC_CONTRACTS);
  assert.ok(input.historicalMetricRegistry.every((entry) => !entry.statistics.includes('BURN_RATE')));
});

test('catalog and registry remain synthetic evidence with no mutation authority', async () => {
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
  assert.ok(input.slos.every((entry) => entry.truthLabel === 'SYNTHETIC_ONLY'
    && entry.authority === 'SYNTHETIC_TEST' && entry.evidenceOnly));
  assert.ok(input.historicalMetricRegistry.every((entry) => entry.truthLabel === 'SYNTHETIC_ONLY'
    && entry.authority === 'SYNTHETIC_TEST' && entry.evidenceOnly));
});
