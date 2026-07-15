import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBootstrapSchedule,
  createPortfolioSnapshot,
  createScenarioCampaign,
  createScenarioEvaluationInput,
  evaluatePortfolioCampaign,
  evaluateScenarioFixture,
  validatePortfolioCampaignReport,
  validatePortfolioScenarioReport,
} from '../src/index.mjs';
import { omitFields, sha256 } from '../../dock/src/canonical.mjs';
import { baseSnapshot, scenarioInput as fixtureScenarioInput, unknown } from './helpers.mjs';

function scenarioInput(snapshotHash) {
  const input = fixtureScenarioInput(snapshotHash);
  const lineageDisclosure = 'status:UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB';
  const reproducibilityDisclosure = 'scenario-definition-status:UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB';
  if (!input.scenarioReference.lineageRefs.includes(lineageDisclosure)) {
    input.scenarioReference.lineageRefs.push(lineageDisclosure);
  }
  if (!input.reproducibilityInputs.includes(reproducibilityDisclosure)) {
    input.reproducibilityInputs.push(reproducibilityDisclosure);
  }
  return input;
}

function gridCampaign(snapshotHash, evaluations) {
  return {
    schema: 'ScenarioCampaignV1',
    version: 1,
    campaignId: 'campaign.acceptance-grid',
    mode: 'DECLARED_GRID',
    seed: 20260716,
    generatedAtMs: 1784161200000,
    snapshotHash,
    evaluationInputs: evaluations,
    drawCount: evaluations.length,
    objective: 'Compare caller-supplied whole-portfolio stress outputs without recalculating owner truth.',
    limitations: ['FIXTURE_ONLY', 'NO_LIVE_SIZING', 'NO_CANONICAL_OWNER_WRITES'],
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    canonical: false,
  };
}

test('scenario evaluation sums only caller-supplied exact impacts and preserves uncertainty', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const input = scenarioInput(snapshot.snapshotHash);
  input.snapshotOwnerClaimHash = snapshot.ownerClaimHash;
  const evaluation = createScenarioEvaluationInput(input);
  const report = evaluateScenarioFixture(snapshot, evaluation);
  assert.equal(report.status, 'EVALUATED_COMPARATIVE');
  assert.equal(report.comparativeImpact.atoms, '-150000000');
  assert.deepEqual(report.impactInterval, {
    state: 'KNOWN', unit: 'USDT_MICRO', lowerAtoms: '-195000000', upperAtoms: '-110000000',
    method: 'SUM_OF_CALLER_SUPPLIED_IMPACT_INTERVALS',
  });
  assert.deepEqual(report.callerSuppliedUncertainty, evaluation.uncertainty);
  assert.equal(report.finding.sizingSupported, false);
  assert.equal(report.finding.ownerAction, null);
  assert.equal(report.evidenceQuality.simulationCountImprovesEvidenceQuality, false);
  assert.equal(report.truthClass, 'ADVISORY');
  assert.equal(report.canonical, false);
});

test('missing required scenario input yields ABSTAIN_UNKNOWN and never fabricates a numeric result', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const input = scenarioInput(snapshot.snapshotHash);
  input.scenarioKind = 'SCENARIO_INPUT_MISSING';
  input.evaluationId = 'evaluation.missing-input';
  input.sweepInputs[3] = { ...input.sweepInputs[3], state: 'UNKNOWN', value: null };
  input.missingDependencies = ['BORROW_CAPACITY_UNAVAILABLE'];
  input.uncertainty = {
    ...input.uncertainty,
    state: 'UNKNOWN',
    lowerAtoms: null,
    upperAtoms: null,
    method: 'UNAVAILABLE_WITH_MISSING_CANONICAL_INPUT',
  };
  const report = evaluateScenarioFixture(snapshot, createScenarioEvaluationInput(input));
  assert.equal(report.status, 'ABSTAIN_UNKNOWN');
  assert.equal(report.comparativeImpact, null);
  assert.equal(report.impactInterval, null);
  assert.equal(report.knownImpactSubtotal.atoms, '-150000000');
  assert.equal(report.reasonCodes.includes('BORROW_CAPACITY_UNAVAILABLE'), true);
  assert.equal(report.reasonCodes.includes('SWEEP_BORROW_UNKNOWN'), true);
  assert.equal(report.reasonCodes.includes('SCENARIO_INPUT_MISSING'), true);
  assert.equal(report.finding.findingCode, 'ABSTAIN_UNKNOWN');
});

test('incomplete snapshot truth forces abstention even when scenario impacts are numerically known', () => {
  const snapshotInput = baseSnapshot();
  snapshotInput.truthState = 'STALE';
  snapshotInput.missingDependencies = ['ACCOUNT_TRUTH_STALE'];
  const snapshot = createPortfolioSnapshot(snapshotInput);
  const input = scenarioInput(snapshot.snapshotHash);
  input.snapshotOwnerClaimHash = snapshot.ownerClaimHash;
  const evaluation = createScenarioEvaluationInput(input);
  const report = evaluateScenarioFixture(snapshot, evaluation);
  assert.equal(report.status, 'ABSTAIN_UNKNOWN');
  assert.equal(report.comparativeImpact, null);
  assert.equal(report.impactInterval, null);
  assert.equal(report.evidenceQuality.snapshotTruthState, 'STALE');
  assert.ok(report.reasonCodes.includes('SNAPSHOT_TRUTH_STALE'));
  assert.ok(report.reasonCodes.includes('ACCOUNT_TRUTH_STALE'));
});

test('known zero and unknown are observably different', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const knownZeroInput = scenarioInput(snapshot.snapshotHash);
  knownZeroInput.evaluationId = 'evaluation.known-zero';
  knownZeroInput.impacts[0].delta.atoms = '0';
  knownZeroInput.impacts[0].lowerBound.atoms = '0';
  knownZeroInput.impacts[0].upperBound.atoms = '0';
  const knownZero = evaluateScenarioFixture(snapshot, createScenarioEvaluationInput(knownZeroInput));

  const unknownInput = scenarioInput(snapshot.snapshotHash);
  unknownInput.evaluationId = 'evaluation.unknown-impact';
  unknownInput.impacts[0].delta = unknown('IMPACT_NOT_SUPPLIED');
  unknownInput.impacts[0].lowerBound = unknown('IMPACT_NOT_SUPPLIED');
  unknownInput.impacts[0].upperBound = unknown('IMPACT_NOT_SUPPLIED');
  const unknownReport = evaluateScenarioFixture(snapshot, createScenarioEvaluationInput(unknownInput));
  assert.equal(knownZero.status, 'EVALUATED_COMPARATIVE');
  assert.equal(unknownReport.status, 'ABSTAIN_UNKNOWN');
  assert.notDeepEqual(knownZero.comparativeImpact, unknownReport.comparativeImpact);
});

test('seeded schedule is deterministic and samples only the finite caller table', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const first = buildBootstrapSchedule(ids, 41, 16);
  const replay = buildBootstrapSchedule(ids, 41, 16);
  const different = buildBootstrapSchedule(ids, 42, 16);
  assert.deepEqual(first, replay);
  assert.notDeepEqual(first, different);
  assert.equal(first.every((draw) => ids.includes(draw.evaluationId)), true);
  assert.equal(Object.isFrozen(first), true);
});

test('bootstrap rejects sparse case tables before sampling', () => {
  const sparse = ['evaluation.first'];
  sparse.length = 2;
  assert.throws(
    () => buildBootstrapSchedule(sparse, 41, 4),
    (error) => error.code === 'SPARSE_ARRAY',
  );
});

test('campaign report is byte-stable and draw count never upgrades origin or uncertainty', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const firstInput = scenarioInput(snapshot.snapshotHash);
  const secondInput = scenarioInput(snapshot.snapshotHash);
  secondInput.evaluationId = 'evaluation.latency-spike';
  secondInput.scenarioKind = 'LATENCY_SPIKE';
  secondInput.scenarioReference.scenarioId = 'f12.latency-spike';
  secondInput.seed = 99;
  secondInput.scenarioReference.seed = 99;
  const evaluations = [createScenarioEvaluationInput(firstInput), createScenarioEvaluationInput(secondInput)];
  const campaign = createScenarioCampaign(gridCampaign(snapshot.snapshotHash, evaluations));
  const first = evaluatePortfolioCampaign(snapshot, campaign);
  const replay = evaluatePortfolioCampaign(snapshot, campaign);
  assert.equal(first.reportHash, replay.reportHash);
  assert.equal(first.evaluatedCount, 2);
  assert.equal(first.abstainCount, 0);
  assert.equal(first.evidenceQuality.simulationCountImprovesEvidenceQuality, false);
  assert.equal(first.evidenceQuality.uncertaintyNarrowedByDrawCount, false);
  assert.deepEqual(first.draws.map((draw) => draw.origin), ['HYPOTHETICAL', 'HYPOTHETICAL']);
  assert.deepEqual(first.draws.map((draw) => draw.callerSuppliedUncertainty), evaluations.map((row) => row.uncertainty));
  assert.equal(first.finding.sizingSupported, false);
  assert.equal(first.canonical, false);
});

test('campaign bounds and dangling owner outputs fail closed before partial output', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const evaluationInput = scenarioInput(snapshot.snapshotHash);
  evaluationInput.impacts[0].subjectId = 'position.not-present';
  const evaluation = createScenarioEvaluationInput(evaluationInput);
  assert.throws(() => evaluateScenarioFixture(snapshot, evaluation), (error) => error.code === 'SCENARIO_SUBJECT_DANGLING');

  const boundedEvaluation = createScenarioEvaluationInput(scenarioInput(snapshot.snapshotHash));
  const tooMany = Array.from({ length: 65 }, () => boundedEvaluation);
  assert.throws(() => createScenarioCampaign(gridCampaign(snapshot.snapshotHash, tooMany)), (error) => error.code === 'CAMPAIGN_CASE_BOUND_INVALID');
});

test('campaign creation rejects a generated time before any scenario horizon end', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const evaluation = createScenarioEvaluationInput(scenarioInput(snapshot.snapshotHash));
  const input = gridCampaign(snapshot.snapshotHash, [evaluation]);
  input.generatedAtMs = evaluation.horizon.endMs - 1;
  assert.throws(() => createScenarioCampaign(input), { code: 'CAMPAIGN_TIME_ORDER_INVALID' });
});

test('exact impact aggregation rejects a 97-digit result even when every input atom is individually valid', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const input = scenarioInput(snapshot.snapshotHash);
  const maximumAtom = '9'.repeat(96);
  const first = {
    ...input.impacts[0],
    delta: { ...input.impacts[0].delta, atoms: maximumAtom },
    lowerBound: { ...input.impacts[0].lowerBound, atoms: maximumAtom },
    upperBound: { ...input.impacts[0].upperBound, atoms: maximumAtom },
  };
  const second = structuredClone(first);
  second.impactId = 'impact.btc.market.second';
  input.impacts = [first, second];
  assert.throws(
    () => createScenarioEvaluationInput(input),
    (error) => error.code === 'EXACT_ATOMS_INVALID',
  );
});

test('scenario report validation rejects hash-rebound forged nested attribution', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const evaluation = createScenarioEvaluationInput(scenarioInput(snapshot.snapshotHash));
  const forged = structuredClone(evaluateScenarioFixture(snapshot, evaluation));
  forged.attribution[0].causalAttribution = true;
  forged.reportHash = sha256(omitFields(forged, ['reportHash']));
  assert.throws(
    () => validatePortfolioScenarioReport(forged),
    (error) => error.code === 'CAUSAL_ATTRIBUTION_FORBIDDEN',
  );
});

test('scenario report identity cannot be self-rehashed away from its embedded evaluation', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const evaluation = createScenarioEvaluationInput(scenarioInput(snapshot.snapshotHash));
  const forged = structuredClone(evaluateScenarioFixture(snapshot, evaluation));
  forged.reportId = 'report.self-asserted';
  forged.evaluationHash = '1'.repeat(64);
  forged.reportHash = sha256(omitFields(forged, ['reportHash']));
  assert.throws(
    () => validatePortfolioScenarioReport(forged),
    (error) => error.code === 'SCENARIO_REPORT_SOURCE_BINDING_MISMATCH',
  );
});

test('campaign report validation rejects a hash-rebound scenario-matrix forgery', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const evaluation = createScenarioEvaluationInput(scenarioInput(snapshot.snapshotHash));
  const campaign = createScenarioCampaign(gridCampaign(snapshot.snapshotHash, [evaluation]));
  const forged = structuredClone(evaluatePortfolioCampaign(snapshot, campaign));
  forged.scenarioMatrix[0].comparativeImpact = {
    ...forged.scenarioMatrix[0].comparativeImpact,
    atoms: '0',
  };
  forged.reportHash = sha256(omitFields(forged, ['reportHash']));
  assert.throws(
    () => validatePortfolioCampaignReport(forged),
    (error) => error.code === 'SCENARIO_MATRIX_BINDING_MISMATCH',
  );
});

test('campaign report identity cannot be self-rehashed away from its embedded campaign', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const evaluation = createScenarioEvaluationInput(scenarioInput(snapshot.snapshotHash));
  const campaign = createScenarioCampaign(gridCampaign(snapshot.snapshotHash, [evaluation]));
  const forged = structuredClone(evaluatePortfolioCampaign(snapshot, campaign));
  forged.reportId = 'campaign-report.self-asserted';
  forged.campaignHash = '2'.repeat(64);
  forged.reportHash = sha256(omitFields(forged, ['reportHash']));
  assert.throws(
    () => validatePortfolioCampaignReport(forged),
    (error) => error.code === 'CAMPAIGN_REPORT_SOURCE_BINDING_MISMATCH',
  );
});
