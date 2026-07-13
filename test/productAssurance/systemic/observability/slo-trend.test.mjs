import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  deriveSloCatalogSha256,
  deriveSloDefinitionSha256,
  SLO_SUBOBJECTIVE_IDS,
} from '../../../../fixtures/productAssurance/systemic/observability/slo-catalog-contract.mjs';
import {
  evaluateSloTrends as evaluateSloTrendsReference,
  nearestRankPercentile,
} from '../../../../fixtures/productAssurance/systemic/observability/slo-trend-evaluator.mjs';

const fixtureUrl = new URL(
  '../../../../fixtures/productAssurance/systemic/observability/cases/slo-trend-history.json',
  import.meta.url,
);
const catalogUrl = new URL(
  '../../../../fixtures/productAssurance/systemic/observability/cases/slo-catalog-complete.json',
  import.meta.url,
);
const catalogFixture = JSON.parse(await readFile(catalogUrl, 'utf8'));

function evaluateSloTrends(input, catalog = structuredClone(catalogFixture)) {
  return evaluateSloTrendsReference(input, catalog);
}

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

function definition(input, sloId) {
  return input.definitions.find((entry) => entry.sloId === sloId);
}

function window(input, sloId, suffix = 'latest') {
  return input.windows.find((entry) => entry.windowId === `${sloId}-window-${suffix}`);
}

function evaluatedSlo(output, sloId) {
  return output.slos.find((entry) => entry.sloId === sloId);
}

function rebindCatalog(input, catalog, sloId) {
  const entry = catalog.slos.find((item) => item.sloId === sloId);
  entry.definitionSha256 = deriveSloDefinitionSha256(definition(input, sloId));
  catalog.catalogSha256 = deriveSloCatalogSha256(catalog);
  input.catalogDigestVerification.verifiedCatalogSha256 = catalog.catalogSha256;
}

test('nearest-rank p50/p95/p99 is deterministic', () => {
  const values = [80, 20, 60, 40];
  assert.equal(nearestRankPercentile(values, 50), 40);
  assert.equal(nearestRankPercentile(values, 95), 80);
  assert.equal(nearestRankPercentile(values, 99), 80);
  assert.deepEqual(values, [80, 20, 60, 40]);
});

test('complete fixture evaluates the exact 25 subobjectives without synthetic live claims', async () => {
  const input = await fixture();
  const output = evaluateSloTrends(input);
  assert.equal(input.definitions.length, 25);
  assert.equal(output.denominatorCount, 25);
  assert.equal(output.catalogDenominatorCount, 25);
  assert.equal(output.coveredSubobjectiveCount, 25);
  assert.deepEqual(output.coveredSubobjectiveIds, SLO_SUBOBJECTIVE_IDS);
  assert.deepEqual(output.missingSubobjectiveIds, []);
  assert.equal(output.categoryDenominatorCount, 11);
  assert.equal(output.coveredCategoryCount, 11);
  assert.equal(output.catalogBinding.result, 'PASS');
  assert.equal(output.definitionBinding.result, 'PASS');
  assert.equal(output.overallResult, 'PASS');
  assert.equal(output.greenEligible, true);
  assert.equal(output.liveGreenEligible, false);
  assert.ok(output.slos.every((entry) => entry.currentResult === 'PASS'));
  assert.ok(output.slos.every((entry) => entry.liveGreenEligible === false));
  assert.equal(new Set(input.definitions.map((entry) => JSON.stringify(entry.measurementSource))).size, 25);
});

test('latest CPU window controls current posture while its older breach remains historical', async () => {
  const output = evaluateSloTrends(await fixture());
  const cpu = evaluatedSlo(output, 'cpu-budget');
  assert.equal(cpu.currentResult, 'PASS');
  assert.equal(cpu.latestWindowId, 'cpu-budget-window-latest');
  assert.equal(cpu.historicalBreachCount, 1);
  assert.equal(cpu.historicalPassCount, 1);
  assert.equal(cpu.windows.find((entry) => entry.windowId.endsWith('old-breach')).historicalResult, 'FAIL');
});

test('window output exposes deterministic percentiles and valid error-budget burn', async () => {
  const output = evaluateSloTrends(await fixture());
  const sourceWindow = evaluatedSlo(output, 'source-age').windows[0];
  assert.deepEqual(sourceWindow.percentiles, { p50: 40, p95: 80, p99: 80, method: 'NEAREST_RANK' });
  assert.equal(sourceWindow.errorBudgetBurnRatio, 0);
  assert.deepEqual(sourceWindow.truthReasonCodes, ['NON_LIVE_TRUTH_SYNTHETIC_ONLY']);
  assert.equal(sourceWindow.authorityMutation, false);
  assert.equal(sourceWindow.blocksRiskReduction, false);
});

test('one missing member of a plural category cannot hide behind category coverage', async () => {
  const input = await fixture();
  input.definitions = input.definitions.filter((entry) => entry.sloId !== 'cross-source-coherence');
  input.windows = input.windows.filter((entry) => entry.sloId !== 'cross-source-coherence');
  const output = evaluateSloTrends(input);
  assert.equal(output.coveredCategoryCount, 11);
  assert.deepEqual(output.missingCategories, []);
  assert.equal(output.coveredSubobjectiveCount, 24);
  assert.deepEqual(output.missingSubobjectiveIds, ['cross-source-coherence']);
  assert.deepEqual(output.missingCatalogSloKeys, ['cross-source-coherence@1']);
  assert.equal(output.overallResult, 'UNKNOWN');
  assert.equal(output.greenEligible, false);
});

test('catalog identities, not caller-cloned labels, own the denominator', async () => {
  const input = await fixture();
  for (const [index, item] of input.definitions.entries()) {
    const oldId = item.sloId;
    item.sloId = `caller-clone-${index + 1}`;
    for (const candidate of input.windows) if (candidate.sloId === oldId) candidate.sloId = item.sloId;
  }
  const output = evaluateSloTrends(input);
  assert.equal(output.definitionBinding.result, 'FAIL');
  assert.equal(output.missingCatalogSloKeys.length, 25);
  assert.equal(output.extraDefinitionKeys.length, 25);
  assert.equal(output.overallResult, 'FAIL');
});

test('definition digests reject unversioned threshold, source, and authority drift', async () => {
  for (const [label, mutate] of [
    ['threshold', (item) => { item.threshold += 1; }],
    ['measurement source', (item) => { item.measurementSource.statistic = 'P99'; }],
    ['owner', (item) => { item.ownerId = 'CALLER_OWNER'; }],
  ]) {
    const input = await fixture();
    mutate(definition(input, 'source-age'));
    const output = evaluateSloTrends(input);
    assert.equal(output.definitionBinding.result, 'FAIL', label);
    assert.ok(output.definitionBindingMismatches.some((entry) => (
      entry.startsWith('source-age@1|')
    )), label);
    assert.equal(output.overallResult, 'FAIL', label);
  }
  const authority = await fixture();
  definition(authority, 'source-age').effectPolicy.mayMutateControls = true;
  assert.throws(() => evaluateSloTrends(authority), /evidence-only authority boundary/);
});

test('a fully rehashed historical proxy swap still fails the exact subobjective law', async () => {
  const input = await fixture();
  const catalog = structuredClone(catalogFixture);
  const hostileSource = {
    kind: 'HISTORICAL_METRIC_STATISTIC',
    metricId: 'execution-cost',
    family: 'EXECUTION_COST',
    statistic: 'P95',
  };
  const catalogEntry = catalog.slos.find((entry) => entry.sloId === 'source-age');
  catalogEntry.measurementSource = structuredClone(hostileSource);
  catalogEntry.historicalMetricBindings = [{ metricId: 'execution-cost', family: 'EXECUTION_COST' }];
  definition(input, 'source-age').measurementSource = structuredClone(hostileSource);
  window(input, 'source-age').measurementSource = structuredClone(hostileSource);
  rebindCatalog(input, catalog, 'source-age');
  const output = evaluateSloTrends(input, catalog);
  assert.equal(output.definitionBinding.result, 'PASS');
  assert.equal(output.catalogBinding.result, 'FAIL');
  assert.deepEqual(output.sloContractMismatches, ['source-age']);
  assert.ok(output.catalogBinding.reasonCodes.includes('SLO_CATALOG_SUBOBJECTIVE_CONTRACT_MISMATCH'));
});

test('canonical owner objectives cannot be collapsed onto historical metric proxies', async () => {
  const input = await fixture();
  const catalog = structuredClone(catalogFixture);
  const proxy = {
    kind: 'HISTORICAL_METRIC_STATISTIC',
    metricId: 'recurring-failed-invariants',
    family: 'RECURRING_FAILED_INVARIANTS',
    statistic: 'RATE',
  };
  const catalogEntry = catalog.slos.find((entry) => entry.sloId === 'evidence-expiry');
  catalogEntry.measurementSource = structuredClone(proxy);
  catalogEntry.historicalMetricBindings = [{
    metricId: proxy.metricId,
    family: proxy.family,
  }];
  definition(input, 'evidence-expiry').measurementSource = structuredClone(proxy);
  window(input, 'evidence-expiry').measurementSource = structuredClone(proxy);
  rebindCatalog(input, catalog, 'evidence-expiry');
  const output = evaluateSloTrends(input, catalog);
  assert.equal(output.catalogBinding.result, 'FAIL');
  assert.deepEqual(output.sloContractMismatches, ['evidence-expiry']);
});

test('definition and window measurement sources must remain identical', async () => {
  const input = await fixture();
  window(input, 'source-age').measurementSource.statistic = 'P99';
  const output = evaluateSloTrends(input);
  const sourceWindow = evaluatedSlo(output, 'source-age').windows[0];
  assert.equal(sourceWindow.historicalResult, 'FAIL');
  assert.ok(sourceWindow.reasonCodes.includes('SLO_MEASUREMENT_SOURCE_MISMATCH'));
  assert.equal(output.overallResult, 'FAIL');
});

test('rehashed metric owner drift fails the fixed 23-contract registry', async () => {
  const input = await fixture();
  const catalog = structuredClone(catalogFixture);
  catalog.historicalMetricRegistry.find((entry) => entry.metricId === 'cpu-budget').ownerId = 'CALLER_OWNER';
  catalog.catalogSha256 = deriveSloCatalogSha256(catalog);
  input.catalogDigestVerification.verifiedCatalogSha256 = catalog.catalogSha256;
  const output = evaluateSloTrends(input, catalog);
  assert.equal(output.catalogBinding.result, 'FAIL');
  assert.deepEqual(output.metricContractMismatches, ['CPU_BUDGET']);
  assert.ok(output.catalogBinding.reasonCodes.includes('SLO_CATALOG_METRIC_CONTRACT_MISMATCH'));
});

test('catalog verification release drift is UNKNOWN and never green', async () => {
  const input = await fixture();
  input.catalogDigestVerification.verifiedReleaseSha = '2'.repeat(40);
  const output = evaluateSloTrends(input);
  assert.equal(output.catalogBinding.result, 'UNKNOWN');
  assert.ok(output.catalogBinding.reasonCodes.includes('SLO_CATALOG_RELEASE_MISMATCH'));
  assert.equal(output.greenEligible, false);
});

test('cross-release and missing windows remain UNKNOWN', async () => {
  const crossRelease = await fixture();
  window(crossRelease, 'source-age').releaseSha = '2'.repeat(40);
  let output = evaluateSloTrends(crossRelease);
  assert.equal(evaluatedSlo(output, 'source-age').currentResult, 'UNKNOWN');
  assert.ok(evaluatedSlo(output, 'source-age').reasonCodes.includes('SLO_WINDOW_RELEASE_MISMATCH'));

  const missing = await fixture();
  missing.windows = missing.windows.filter((entry) => entry.sloId !== 'source-age');
  output = evaluateSloTrends(missing);
  assert.equal(evaluatedSlo(output, 'source-age').currentResult, 'UNKNOWN');
  assert.deepEqual(evaluatedSlo(output, 'source-age').reasonCodes, ['EXPECTED_SLO_WINDOW_MISSING']);
});

test('insufficient, expired, and temporally impossible evidence cannot green', async () => {
  const insufficient = await fixture();
  window(insufficient, 'source-age').samples = window(insufficient, 'source-age').samples.slice(0, 2);
  window(insufficient, 'source-age').evidenceObservedAtMs = 1000;
  let evaluated = evaluatedSlo(evaluateSloTrends(insufficient), 'source-age').windows[0];
  assert.equal(evaluated.result, 'UNKNOWN');
  assert.ok(evaluated.reasonCodes.includes('SLO_INSUFFICIENT_SAMPLES'));
  assert.ok(evaluated.reasonCodes.includes('SLO_EVIDENCE_EXPIRED'));

  const impossible = await fixture();
  window(impossible, 'source-age').evidenceObservedAtMs = 2600;
  evaluated = evaluatedSlo(evaluateSloTrends(impossible), 'source-age').windows[0];
  assert.equal(evaluated.result, 'FAIL');
  assert.ok(evaluated.reasonCodes.includes('SLO_EVIDENCE_BEFORE_WINDOW_END'));
  assert.ok(evaluated.reasonCodes.includes('SLO_EVIDENCE_BEFORE_LATEST_SAMPLE'));
});

test('time advance expires current truth without rewriting historical pass and breach', async () => {
  const input = await fixture();
  const initial = evaluateSloTrends(input);
  const advancedInput = structuredClone(input);
  advancedInput.nowMs = 10000;
  advancedInput.catalogDigestVerification.verifiedAtMs = 9999;
  const advanced = evaluateSloTrends(advancedInput);
  const initialCpu = evaluatedSlo(initial, 'cpu-budget');
  const advancedCpu = evaluatedSlo(advanced, 'cpu-budget');
  assert.equal(advancedCpu.currentResult, 'UNKNOWN');
  assert.equal(advancedCpu.historicalPassCount, initialCpu.historicalPassCount);
  assert.equal(advancedCpu.historicalBreachCount, initialCpu.historicalBreachCount);
  assert.deepEqual(
    advancedCpu.windows.map((entry) => entry.historicalResult),
    initialCpu.windows.map((entry) => entry.historicalResult),
  );
});

test('failed SLO evidence requires an incident reference and preserves closed refs', async () => {
  const input = await fixture();
  const sourceWindow = window(input, 'source-age');
  sourceWindow.samples[0].good = false;
  sourceWindow.canonicalEvidenceRefs.evidenceIds = ['evidence-z', 'evidence-a'];
  const evaluated = evaluatedSlo(evaluateSloTrends(input), 'source-age').windows[0];
  assert.equal(evaluated.historicalResult, 'FAIL');
  assert.equal(evaluated.canonicalEvidenceComplete, false);
  assert.ok(evaluated.reasonCodes.includes('SLO_FAIL_INCIDENT_REF_MISSING'));
  assert.deepEqual(evaluated.canonicalEvidenceRefs.evidenceIds, ['evidence-a', 'evidence-z']);
});

test('duplicate sample and semantic window identities are rejected', async () => {
  const duplicateSample = await fixture();
  const samples = window(duplicateSample, 'source-age').samples;
  samples[1].sampleId = samples[0].sampleId;
  assert.throws(() => evaluateSloTrends(duplicateSample), /duplicate key/);

  const alias = await fixture();
  const original = window(alias, 'source-age');
  alias.windows.push({
    ...structuredClone(original),
    windowId: 'source-age-window-alias',
    samples: original.samples.map((sample, index) => ({
      ...sample,
      sampleId: `source-age-alias-${index + 1}`,
    })),
  });
  assert.throws(() => evaluateSloTrends(alias), /input\.windows semantic intervals contains duplicate key/);
});

test('100 percent objective has bounded zero-error-budget semantics', async () => {
  const passing = await fixture();
  definition(passing, 'source-age').objectivePercent = 100;
  let evaluated = evaluatedSlo(evaluateSloTrends(passing), 'source-age').windows[0];
  assert.equal(evaluated.result, 'PASS');
  assert.equal(evaluated.errorBudgetBurnRatio, 0);

  const failing = await fixture();
  definition(failing, 'source-age').objectivePercent = 100;
  window(failing, 'source-age').samples[0].good = false;
  evaluated = evaluatedSlo(evaluateSloTrends(failing), 'source-age').windows[0];
  assert.equal(evaluated.result, 'FAIL');
  assert.equal(evaluated.errorBudgetBurnRatio, null);
  assert.ok(evaluated.reasonCodes.includes('SLO_ZERO_ERROR_BUDGET_BREACH'));
  assert.equal(JSON.stringify(evaluated).includes('Infinity'), false);
});

test('availability breach never blocks independently safe risk reduction', async () => {
  const input = await fixture();
  input.windows = input.windows.filter((entry) => entry.windowId !== 'cpu-budget-window-latest');
  const output = evaluateSloTrends(input);
  const cpu = evaluatedSlo(output, 'cpu-budget');
  assert.equal(cpu.currentResult, 'FAIL');
  assert.equal(cpu.windows[0].recommendedPosture, 'DEGRADED');
  assert.equal(cpu.windows[0].blocksRiskReduction, false);
  assert.equal(output.blocksRiskReduction, false);
  assert.equal(output.authorityMutation, false);
});

test('evaluation uses injected time, is deterministic, non-mutating, and deeply frozen', async () => {
  const input = await fixture();
  const before = structuredClone(input);
  const first = evaluateSloTrends(input);
  const second = evaluateSloTrends(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.slos), true);
  assert.equal(Object.isFrozen(first.slos[0].windows[0]), true);
});
