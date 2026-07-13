import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  evaluateSloTrends as evaluateSloTrendsReference,
  nearestRankPercentile,
} from '../../../../fixtures/productAssurance/systemic/observability/slo-trend-evaluator.mjs';

const fixtureUrl = new URL('../../../../fixtures/productAssurance/systemic/observability/cases/slo-trend-history.json', import.meta.url);
const catalogUrl = new URL('../../../../fixtures/productAssurance/systemic/observability/cases/slo-catalog-complete.json', import.meta.url);
const catalogFixture = JSON.parse(await readFile(catalogUrl, 'utf8'));

function evaluateSloTrends(input, catalog = structuredClone(catalogFixture)) {
  return evaluateSloTrendsReference(input, catalog);
}

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

const ALL_CATEGORIES = [
  'SOURCE_COHERENCE_AGE', 'QUEUE_BACKPRESSURE', 'PROCESSING_COMMAND_LATENCY',
  'AMBIGUITY_DURATION', 'RECONCILIATION_LAG', 'EVIDENCE_EXPIRY',
  'TELEMETRY_COMPLETENESS', 'RECOVERY_VERIFICATION', 'SENTINEL_PAGING_DELIVERY',
  'RESTART_RTO_RPO', 'RESOURCE_BUDGET',
];

async function completeCategoryFixture() {
  const input = await fixture();
  const templateDefinition = input.definitions.find((definition) => definition.sloId === 'source-coherence-age');
  const templateWindow = input.windows.find((window) => window.windowId === 'source-age-window-latest');
  const existingCategories = new Set(input.definitions.map((definition) => definition.category));
  for (const catalogEntry of catalogFixture.slos) {
    if (existingCategories.has(catalogEntry.category)) continue;
    const suffix = catalogEntry.category.toLowerCase().replaceAll('_', '-');
    input.definitions.push({
      ...structuredClone(templateDefinition),
      sloId: catalogEntry.sloId,
      version: catalogEntry.version,
      ownerId: catalogEntry.ownerId,
      category: catalogEntry.category,
      dependentCapabilityIds: [`${catalogEntry.sloId}-capability`],
    });
    input.windows.push({
      ...structuredClone(templateWindow),
      windowId: `${catalogEntry.sloId}-current-window`,
      sloId: catalogEntry.sloId,
      sloVersion: catalogEntry.version,
      canonicalEvidenceRefs: {
        invariantResultId: `invariant-${suffix}`,
        materialEventId: `material-event-${suffix}`,
        evidenceIds: [`evidence-${suffix}`],
        correlationId: `correlation-${suffix}`,
        incidentId: null,
      },
      samples: templateWindow.samples.map((sample, index) => ({
        ...sample,
        sampleId: `${catalogEntry.sloId}-sample-${index + 1}`,
      })),
    });
  }
  return input;
}

test('nearest-rank p50/p95/p99 is deterministic', () => {
  const values = [80, 20, 60, 40];
  assert.equal(nearestRankPercentile(values, 50), 40);
  assert.equal(nearestRankPercentile(values, 95), 80);
  assert.equal(nearestRankPercentile(values, 99), 80);
  assert.deepEqual(values, [80, 20, 60, 40]);
});

test('latest closed window controls current posture while older breaches remain historical', async () => {
  const input = await completeCategoryFixture();
  const output = evaluateSloTrends(input);
  const resource = output.slos.find((slo) => slo.sloId === 'resource-budget');
  assert.equal(resource.currentResult, 'PASS');
  assert.equal(resource.latestWindowId, 'resource-window-latest-pass');
  assert.equal(resource.historicalBreachCount, 1);
  assert.equal(resource.historicalPassCount, 1);
  assert.equal(output.overallResult, 'PASS');
});

test('every historical window exposes p50/p95/p99 and error-budget burn', async () => {
  const output = evaluateSloTrends(await fixture());
  const source = output.slos.find((slo) => slo.sloId === 'source-coherence-age');
  const window = source.windows[0];
  assert.deepEqual(window.percentiles, { p50: 40, p95: 80, p99: 80, method: 'NEAREST_RANK' });
  assert.equal(window.errorBudgetBurnRatio, 0);
  assert.equal(window.authorityMutation, false);
  assert.equal(window.blocksRiskReduction, false);
});

test('synthetic windows may pass fixture evaluation but can never claim live green', async () => {
  const output = evaluateSloTrends(await completeCategoryFixture());
  assert.equal(output.greenEligible, true);
  assert.equal(output.liveGreenEligible, false);
  const sourceWindow = output.slos.find((slo) => slo.sloId === 'source-coherence-age').windows[0];
  assert.equal(sourceWindow.result, 'PASS');
  assert.equal(sourceWindow.liveGreenEligible, false);
  assert.deepEqual(sourceWindow.truthReasonCodes, ['NON_LIVE_TRUTH_SYNTHETIC_ONLY']);
});

test('fixed eleven-category denominator cannot be reduced by a passing supplied subset', async () => {
  const completeOutput = evaluateSloTrends(await completeCategoryFixture());
  assert.equal(completeOutput.categoryDenominatorCount, 11);
  assert.equal(completeOutput.coveredCategoryCount, 11);
  assert.deepEqual(completeOutput.coveredCategories, ALL_CATEGORIES);
  assert.deepEqual(completeOutput.missingCategories, []);
  assert.equal(completeOutput.overallResult, 'PASS');
  assert.equal(completeOutput.greenEligible, true);
  assert.equal(completeOutput.liveGreenEligible, false);

  const twoCategoryInput = await fixture();
  const twoCategoryOutput = evaluateSloTrends(twoCategoryInput);
  assert.equal(twoCategoryOutput.denominatorCount, 11);
  assert.equal(twoCategoryOutput.suppliedDefinitionCount, 2);
  assert.equal(twoCategoryOutput.categoryDenominatorCount, 11);
  assert.equal(twoCategoryOutput.coveredCategoryCount, 2);
  assert.equal(twoCategoryOutput.missingCategories.length, 9);
  assert.equal(twoCategoryOutput.overallResult, 'UNKNOWN');
  assert.equal(twoCategoryOutput.greenEligible, false);

  const oneCategoryInput = await fixture();
  oneCategoryInput.definitions = oneCategoryInput.definitions
    .filter((definition) => definition.category === 'SOURCE_COHERENCE_AGE');
  oneCategoryInput.windows = oneCategoryInput.windows
    .filter((window) => window.sloId === 'source-coherence-age');
  const oneCategoryOutput = evaluateSloTrends(oneCategoryInput);
  assert.equal(oneCategoryOutput.categoryDenominatorCount, 11);
  assert.equal(oneCategoryOutput.coveredCategoryCount, 1);
  assert.deepEqual(oneCategoryOutput.coveredCategories, ['SOURCE_COHERENCE_AGE']);
  assert.equal(oneCategoryOutput.missingCategories.length, 10);
  assert.equal(oneCategoryOutput.overallResult, 'UNKNOWN');
  assert.equal(oneCategoryOutput.greenEligible, false);
});

test('catalog identities, not cloned category labels, own the SLO denominator', async () => {
  const boundInput = await completeCategoryFixture();
  const boundOutput = evaluateSloTrends(boundInput);
  assert.equal(boundOutput.catalogBinding.result, 'PASS');
  assert.equal(boundOutput.definitionBinding.result, 'PASS');
  assert.equal(boundOutput.catalogDenominatorCount, 11);
  assert.deepEqual(boundOutput.missingCatalogSloKeys, []);
  assert.deepEqual(boundOutput.extraDefinitionKeys, []);

  const relabeledInput = await completeCategoryFixture();
  for (const [index, definition] of relabeledInput.definitions.entries()) {
    const oldId = definition.sloId;
    const newId = `caller-clone-${index + 1}`;
    definition.sloId = newId;
    for (const window of relabeledInput.windows) {
      if (window.sloId === oldId) window.sloId = newId;
    }
  }
  const relabeledOutput = evaluateSloTrends(relabeledInput);
  assert.equal(relabeledOutput.definitionBinding.result, 'FAIL');
  assert.equal(relabeledOutput.missingCatalogSloKeys.length, 11);
  assert.equal(relabeledOutput.extraDefinitionKeys.length, 11);
  assert.equal(relabeledOutput.overallResult, 'FAIL');
  assert.equal(relabeledOutput.greenEligible, false);
});

test('catalog definition digests reject no-version-bump contract drift and loosened thresholds', async () => {
  const mutations = [
    ['threshold', (definition) => { definition.threshold += 1; }],
    ['comparator', (definition) => { definition.comparator = 'GTE'; }],
    ['objectivePercent', (definition) => { definition.objectivePercent = 98; }],
    ['windowDurationMs', (definition) => { definition.windowDurationMs = 2000; }],
    ['maximumEvidenceAgeMs', (definition) => { definition.maximumEvidenceAgeMs = 3000; }],
    ['minimumSampleCount', (definition) => { definition.minimumSampleCount = 3; }],
    ['criticality', (definition) => { definition.criticality = 'AVAILABILITY'; }],
    ['unit', (definition) => { definition.unit = 'seconds'; }],
    ['recommendedFailurePosture', (definition) => { definition.recommendedFailurePosture = 'DEGRADED'; }],
    ['dependentCapabilityIds', (definition) => { definition.dependentCapabilityIds.push('unversioned-capability'); }],
  ];
  for (const [field, mutate] of mutations) {
    const input = await completeCategoryFixture();
    const definition = input.definitions.find((entry) => entry.sloId === 'source-coherence-age');
    mutate(definition);
    const output = evaluateSloTrends(input);
    assert.equal(output.definitionBinding.result, 'FAIL', field);
    assert.ok(
      output.definitionBindingMismatches.includes('source-coherence-age@1|DEFINITION_DIGEST'),
      field,
    );
    assert.equal(output.overallResult, 'FAIL', field);
    assert.equal(output.greenEligible, false, field);
  }

  const loosened = await completeCategoryFixture();
  loosened.definitions.find((entry) => entry.sloId === 'source-coherence-age').threshold = 1000;
  loosened.windows.find((entry) => entry.sloId === 'source-coherence-age').samples
    .forEach((sample) => { sample.value = 500; });
  const loosenedOutput = evaluateSloTrends(loosened);
  const localWindow = loosenedOutput.slos
    .find((entry) => entry.sloId === 'source-coherence-age').windows[0];
  assert.equal(localWindow.currentResult, 'PASS');
  assert.equal(loosenedOutput.definitionBinding.result, 'FAIL');
  assert.equal(loosenedOutput.overallResult, 'FAIL');
  assert.equal(loosenedOutput.greenEligible, false);

  const authorityDrift = await completeCategoryFixture();
  authorityDrift.definitions.find((entry) => entry.sloId === 'source-coherence-age')
    .effectPolicy.mayMutateControls = true;
  assert.throws(() => evaluateSloTrends(authorityDrift), /evidence-only authority boundary/);
});

test('catalog digest, revision, release, and metric registry bindings are fail-closed', async () => {
  const input = await completeCategoryFixture();
  const hostileCatalog = structuredClone(catalogFixture);
  hostileCatalog.catalogRevision += 1;
  hostileCatalog.slos[0].historicalMetricBindings[0].family = 'COST_BUDGET';
  const output = evaluateSloTrends(input, hostileCatalog);
  assert.equal(output.catalogBinding.result, 'FAIL');
  assert.ok(output.catalogBinding.reasonCodes.includes('SLO_CATALOG_CANONICAL_DIGEST_MISMATCH'));
  assert.ok(output.catalogBinding.reasonCodes.includes('SLO_CATALOG_VERIFIED_REVISION_MISMATCH'));
  assert.ok(output.catalogBinding.reasonCodes.includes('SLO_CATALOG_METRIC_BINDING_MISMATCH'));
  assert.equal(output.metricBindingMismatches.length, 1);
  assert.equal(output.greenEligible, false);

  const releaseInput = await completeCategoryFixture();
  releaseInput.catalogDigestVerification.verifiedReleaseSha = '2'.repeat(40);
  const releaseOutput = evaluateSloTrends(releaseInput);
  assert.equal(releaseOutput.catalogBinding.result, 'UNKNOWN');
  assert.ok(releaseOutput.catalogBinding.reasonCodes.includes('SLO_CATALOG_RELEASE_MISMATCH'));
  assert.equal(releaseOutput.greenEligible, false);
});

test('cross-release window is UNKNOWN and is not mixed into current truth', async () => {
  const input = await fixture();
  input.windows.find((window) => window.windowId === 'source-age-window-latest').releaseSha = '2'.repeat(40);
  const output = evaluateSloTrends(input);
  const source = output.slos.find((slo) => slo.sloId === 'source-coherence-age');
  assert.equal(source.currentResult, 'UNKNOWN');
  assert.ok(source.reasonCodes.includes('SLO_WINDOW_RELEASE_MISMATCH'));
  assert.equal(output.overallResult, 'UNKNOWN');
  assert.equal(output.liveGreenEligible, false);
});

test('missing expected SLO window remains UNKNOWN', async () => {
  const input = await fixture();
  input.windows = input.windows.filter((window) => window.sloId !== 'source-coherence-age');
  const output = evaluateSloTrends(input);
  const source = output.slos.find((slo) => slo.sloId === 'source-coherence-age');
  assert.equal(source.currentResult, 'UNKNOWN');
  assert.deepEqual(source.reasonCodes, ['EXPECTED_SLO_WINDOW_MISSING']);
  assert.equal(output.greenEligible, false);
});

test('insufficient samples and expired evidence are UNKNOWN', async () => {
  const input = await fixture();
  const window = input.windows.find((entry) => entry.windowId === 'source-age-window-latest');
  window.samples = window.samples.slice(0, 2);
  window.evidenceObservedAtMs = 1000;
  const output = evaluateSloTrends(input);
  const evaluated = output.slos.find((slo) => slo.sloId === 'source-coherence-age').windows[0];
  assert.equal(evaluated.result, 'UNKNOWN');
  assert.ok(evaluated.reasonCodes.includes('SLO_INSUFFICIENT_SAMPLES'));
  assert.ok(evaluated.reasonCodes.includes('SLO_EVIDENCE_EXPIRED'));
});

test('evidence envelope cannot predate its closed window or latest sample', async () => {
  const input = await fixture();
  const window = input.windows.find((entry) => entry.windowId === 'source-age-window-latest');
  window.evidenceObservedAtMs = 2600;
  const evaluated = evaluateSloTrends(input).slos
    .find((slo) => slo.sloId === 'source-coherence-age').windows[0];
  assert.equal(evaluated.result, 'FAIL');
  assert.ok(evaluated.reasonCodes.includes('SLO_EVIDENCE_BEFORE_WINDOW_END'));
  assert.ok(evaluated.reasonCodes.includes('SLO_EVIDENCE_BEFORE_LATEST_SAMPLE'));
});

test('fresh envelope cannot republish an old historical window as current', async () => {
  const input = await fixture();
  input.nowMs = 10000;
  for (const window of input.windows) window.evidenceObservedAtMs = 9999;
  const output = evaluateSloTrends(input);
  const source = output.slos.find((slo) => slo.sloId === 'source-coherence-age');
  assert.equal(source.currentResult, 'UNKNOWN');
  assert.ok(source.reasonCodes.includes('SLO_WINDOW_TOO_OLD_FOR_CURRENT'));
  assert.equal(source.liveGreenEligible, false);
});

test('time advance expires current eligibility without rewriting historical PASS or FAIL', async () => {
  const initialInput = await fixture();
  const initial = evaluateSloTrends(initialInput);
  const initialResource = initial.slos.find((slo) => slo.sloId === 'resource-budget');
  assert.equal(initialResource.historicalPassCount, 1);
  assert.equal(initialResource.historicalBreachCount, 1);

  const advancedInput = structuredClone(initialInput);
  advancedInput.nowMs = 10000;
  advancedInput.catalogDigestVerification.verifiedAtMs = 9999;
  const advanced = evaluateSloTrends(advancedInput);
  const advancedResource = advanced.slos.find((slo) => slo.sloId === 'resource-budget');
  assert.equal(advancedResource.currentResult, 'UNKNOWN');
  assert.equal(advancedResource.historicalPassCount, 1);
  assert.equal(advancedResource.historicalBreachCount, 1);
  assert.equal(advancedResource.historicalUnknownCount, 0);
  const oldBreach = advancedResource.windows.find((window) => window.windowId === 'resource-window-old-breach');
  const latestPass = advancedResource.windows.find((window) => window.windowId === 'resource-window-latest-pass');
  assert.equal(oldBreach.historicalResult, 'FAIL');
  assert.equal(latestPass.historicalResult, 'PASS');
  assert.equal(oldBreach.currentResult, 'UNKNOWN');
  assert.equal(latestPass.currentResult, 'UNKNOWN');
});

test('canonical SLO evidence refs are closed, copied, and incident-bound on FAIL', async () => {
  const input = await fixture();
  const sourceWindow = input.windows.find((window) => window.windowId === 'source-age-window-latest');
  sourceWindow.canonicalEvidenceRefs.evidenceIds = ['evidence-z', 'evidence-a'];
  input.definitions.find((definition) => definition.sloId === 'source-coherence-age').threshold = 1;
  const output = evaluateSloTrends(input);
  const evaluated = output.slos.find((slo) => slo.sloId === 'source-coherence-age').windows[0];
  assert.equal(evaluated.historicalResult, 'FAIL');
  assert.equal(evaluated.currentResult, 'FAIL');
  assert.equal(evaluated.canonicalEvidenceComplete, false);
  assert.ok(evaluated.historicalReasonCodes.includes('SLO_FAIL_INCIDENT_REF_MISSING'));
  assert.deepEqual(evaluated.canonicalEvidenceRefs.evidenceIds, ['evidence-a', 'evidence-z']);
  assert.equal(evaluated.canonicalEvidenceRefs.invariantResultId, 'invariant-source-coherence-age-latest');
  assert.equal(evaluated.canonicalEvidenceRefs.materialEventId, 'material-event-source-coherence-age-latest');
  assert.equal(evaluated.canonicalEvidenceRefs.correlationId, 'correlation-source-coherence-age-latest');

  const malformed = await fixture();
  delete malformed.windows[0].canonicalEvidenceRefs;
  assert.throws(() => evaluateSloTrends(malformed), /canonicalEvidenceRefs/);
});

test('duplicate stable sample identity cannot satisfy minimum evidence', async () => {
  const input = await fixture();
  const samples = input.windows.find((entry) => entry.windowId === 'source-age-window-latest').samples;
  samples[1].sampleId = samples[0].sampleId;
  assert.throws(() => evaluateSloTrends(input), /duplicate key/);
});

test('aliased SLO window cannot duplicate one semantic release interval', async () => {
  const input = await fixture();
  const original = input.windows.find((entry) => entry.windowId === 'source-age-window-latest');
  const alias = structuredClone(original);
  alias.windowId = 'source-age-window-aliased';
  alias.samples = alias.samples.map((sample, index) => ({
    ...sample,
    sampleId: `source-age-alias-${index + 1}`,
    value: 999,
    good: false,
  }));
  input.windows.push(alias);
  assert.throws(() => evaluateSloTrends(input), /input\.windows semantic intervals contains duplicate key/);
});

test('100 percent objective has bounded zero-error-budget semantics', async () => {
  const passing = await fixture();
  passing.definitions.find((definition) => definition.sloId === 'source-coherence-age').objectivePercent = 100;
  let output = evaluateSloTrends(passing);
  let window = output.slos.find((slo) => slo.sloId === 'source-coherence-age').windows[0];
  assert.equal(window.result, 'PASS');
  assert.equal(window.errorBudgetBurnRatio, 0);

  const failing = await fixture();
  failing.definitions.find((definition) => definition.sloId === 'source-coherence-age').objectivePercent = 100;
  failing.windows.find((entry) => entry.sloId === 'source-coherence-age').samples[0].good = false;
  output = evaluateSloTrends(failing);
  window = output.slos.find((slo) => slo.sloId === 'source-coherence-age').windows[0];
  assert.equal(window.result, 'FAIL');
  assert.equal(window.errorBudgetBurnRatio, null);
  assert.ok(window.reasonCodes.includes('SLO_ZERO_ERROR_BUDGET_BREACH'));
  assert.equal(JSON.stringify(output).includes('Infinity'), false);
  assert.equal(JSON.stringify(output).includes('NaN'), false);
});

test('availability breach never blocks independently safe risk reduction', async () => {
  const input = await fixture();
  input.windows = input.windows.filter((window) => window.windowId !== 'resource-window-latest-pass');
  const output = evaluateSloTrends(input);
  const resource = output.slos.find((slo) => slo.sloId === 'resource-budget');
  assert.equal(resource.currentResult, 'FAIL');
  assert.equal(resource.windows[0].recommendedPosture, 'DEGRADED');
  assert.equal(resource.windows[0].blocksRiskReduction, false);
  assert.equal(output.blocksRiskReduction, false);
  assert.equal(output.authorityMutation, false);
});

test('effect policy cannot grant mutation authority', async () => {
  const input = await fixture();
  input.definitions[0].effectPolicy.mayMutateCapital = true;
  assert.throws(() => evaluateSloTrends(input), /evidence-only authority boundary/);
});

test('evaluation uses injected nowMs, is deterministic, and does not mutate input', async () => {
  const input = await fixture();
  const before = structuredClone(input);
  const first = evaluateSloTrends(input);
  const second = evaluateSloTrends(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(first), true);
});
