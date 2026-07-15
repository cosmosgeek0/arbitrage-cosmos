import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { sha256, validateResourceBudgetClaim } from '../../dock/src/index.mjs';
import acceptedFixture from '../fixtures/synthetic-accepted.v1.mjs';
import rejectedFixture from '../fixtures/synthetic-rejected.v1.mjs';
import abstainedFixture from '../fixtures/unverified-recorded-shape-abstained.v1.mjs';
import missedFixture from '../fixtures/unverified-recorded-shape-missed.v1.mjs';
import { makeDecisionLabFixture, Q15_EXPERIMENT_FIXTURE } from '../fixtures/factory.mjs';
import {
  buildDecisionLabReport,
  assertDecisionLabFixtureTruth,
  projectPreviewThroughDock,
  projectDecisionLabPreview,
  selectF13DockBindings,
  validateDecisionLabInsertion,
  validateDecisionLabPreview,
  validateQ15ExperimentFixture,
  validateDecisionLabReport,
} from '../src/index.mjs';

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

function mutable(value = acceptedFixture) {
  return structuredClone(value);
}

function assertCode(action, code) {
  assert.throws(action, (error) => error?.code === code, `expected ${code}`);
}

function rehash(report) {
  const core = Object.fromEntries(Object.entries(report).filter(([key]) => !['reportId', 'reportHash'].includes(key)));
  report.reportHash = sha256(core);
  report.reportId = `dl_report_${report.reportHash}`;
  return report;
}

test('01 accepted, rejected, abstained, and missed envelopes remain explicit', () => {
  const cases = [
    [acceptedFixture, 'ACCEPTED'],
    [rejectedFixture, 'REJECTED'],
    [abstainedFixture, 'ABSTAINED'],
    [missedFixture, 'MISSED_OPPORTUNITY'],
  ];
  for (const [fixture, expected] of cases) {
    const report = buildDecisionLabReport(fixture);
    assert.equal(report.decision.disposition, expected);
    assert.equal(report.summary.decisionDisposition, expected);
    assert.equal(report.causalEffect, null);
    assert.equal(report.winner, null);
    assert.equal(report.profitClaim, false);
    assert.ok(Object.isFrozen(report));
    assert.ok(Object.isFrozen(report.decision));
  }
});

test('02 one report contains one immutable decision and the complete bounded alternative grammar', () => {
  const report = buildDecisionLabReport(acceptedFixture);
  assert.equal(report.alternatives.length, 7);
  assert.deepEqual(
    [...new Set(report.alternatives.map((entry) => entry.kind))].sort(),
    ['DELAYED_TIMING', 'EARLIER_TIMING', 'ENTRY', 'EXECUTION_POLICY', 'EXIT', 'NO_TRADE', 'THRESHOLD'],
  );
  assert.equal(report.alternatives.filter((entry) => entry.role === 'OBSERVED_DECISION').length, 1);
  assert.match(report.decision.decisionContextId, /^dl_decision_[a-f0-9]{64}$/);
});

test('03 Q-assisted, source-removal, and feature-family-removal ablations are all present', () => {
  const report = buildDecisionLabReport(acceptedFixture);
  assert.deepEqual(
    [...new Set(report.ablations.map((entry) => entry.kind))].sort(),
    ['Q_ASSISTED_VS_MARKET_ONLY', 'REMOVE_EVIDENCE_SOURCE', 'REMOVE_FEATURE_FAMILY'],
  );
  assert.ok(report.ablations.every((entry) => entry.interpretation === 'SENSITIVITY_ONLY_NOT_CAUSAL_CONTRIBUTION'));
});

test('04 canonical report bytes are deterministic and insensitive to input array order', () => {
  const first = buildDecisionLabReport(acceptedFixture);
  const reordered = mutable();
  reordered.alternatives.reverse();
  reordered.ablations.reverse();
  reordered.decision.featureRefs.reverse();
  reordered.decision.evidenceRefs.reverse();
  const second = buildDecisionLabReport(reordered);
  assert.equal(first.reportHash, second.reportHash);
  assert.deepEqual(first, second);
  assert.equal(validateDecisionLabReport(first, acceptedFixture), true);
});

test('05 evaluation snapshots the request and never mutates its fixture', () => {
  const fixture = mutable();
  const before = sha256(fixture);
  buildDecisionLabReport(fixture);
  assert.equal(sha256(fixture), before);
});

test('06 a feature newer than the cutoff fails closed', () => {
  const fixture = mutable();
  fixture.decision.featureRefs[0].asOfMs = fixture.decision.informationCutoffMs + 1;
  assertCode(() => buildDecisionLabReport(fixture), 'POST_CUTOFF_FEATURE_ACCESS');
});

test('07 a feature input event newer than its as-of time fails closed', () => {
  const fixture = mutable();
  fixture.decision.featureRefs[0].inputLastEventMs = fixture.decision.featureRefs[0].asOfMs + 1;
  assertCode(() => buildDecisionLabReport(fixture), 'POST_CUTOFF_FEATURE_ACCESS');
});

test('08 event, publication, and observation timestamps all obey the cutoff', () => {
  for (const field of ['eventTimeMs', 'publishedTimeMs', 'observedTimeMs']) {
    const fixture = mutable();
    fixture.decision.evidenceRefs[0][field] = fixture.decision.informationCutoffMs + 1;
    assertCode(() => buildDecisionLabReport(fixture), 'POST_CUTOFF_EVIDENCE_ACCESS');
  }
});

test('09 stale-at-cutoff evidence cannot enter the information set', () => {
  const fixture = mutable();
  fixture.decision.evidenceRefs[0].validUntilMs = fixture.decision.informationCutoffMs - 1;
  assertCode(() => buildDecisionLabReport(fixture), 'EVIDENCE_STALE_AT_CUTOFF');
});

test('10 an alternative declared after the information cutoff is rejected', () => {
  const fixture = mutable();
  fixture.alternatives[1].predeclaredAtMs = fixture.decision.informationCutoffMs + 1;
  assertCode(() => buildDecisionLabReport(fixture), 'NOT_PREDECLARED');
});

test('11 every alternative must use the exact immutable market path', () => {
  const fixture = mutable();
  fixture.alternatives[1].marketPathRef = structuredClone(fixture.decision.costAssumptionRef);
  assertCode(() => buildDecisionLabReport(fixture), 'COMPARISON_IDENTITY_MISMATCH');
});

test('12 every alternative must use the exact immutable cost identity', () => {
  const fixture = mutable();
  fixture.alternatives[1].costAssumptionRef = structuredClone(fixture.decision.marketPathRef);
  assertCode(() => buildDecisionLabReport(fixture), 'COMPARISON_IDENTITY_MISMATCH');
});

test('13 every ablation result must use the same path and costs', () => {
  const fixture = mutable();
  fixture.ablations[0].variant.marketPathHash = 'c'.repeat(64);
  assertCode(() => buildDecisionLabReport(fixture), 'ABLATION_IDENTITY_MISMATCH');
});

test('14 impossibility cannot be claimed without an immutable owner alternative payload', () => {
  const fixture = mutable();
  const candidate = fixture.alternatives.find((entry) => entry.role === 'COUNTERFACTUAL_ALTERNATIVE');
  candidate.feasibility = {
    state: 'IMPOSSIBLE_AT_CUTOFF',
    reasonCodes: ['IMPOSSIBLE_OWNER_POLICY'],
  };
  assertCode(() => buildDecisionLabReport(fixture), 'OWNER_ALTERNATIVE_ARTIFACT_UNAVAILABLE');
});

test('15 policy ownership remains Q except for the canonical L execution-policy seam', () => {
  const fixture = mutable();
  const execution = fixture.alternatives.find((entry) => entry.kind === 'EXECUTION_POLICY');
  execution.owner = 'Q_RESEARCH';
  assertCode(() => buildDecisionLabReport(fixture), 'ALTERNATIVE_OWNER_INVALID');
});

test('16 missing logging-policy evidence keeps every propensity and importance weight unknown', () => {
  const report = buildDecisionLabReport(acceptedFixture);
  assert.ok(report.alternatives.every((entry) => entry.support.propensityStatus === 'UNKNOWN'));
  assert.ok(report.alternatives.every((entry) => entry.support.opeEligibility === 'INELIGIBLE_UNKNOWN_PROPENSITY'));
  assert.ok(report.alternatives.every((entry) => entry.support.importanceWeight === null));
  assert.ok(report.warnings.includes('UNKNOWN_PROPENSITY_NO_OPE'));
});

test('17 unknown propensities stay unknown rather than becoming estimated weights', () => {
  const report = buildDecisionLabReport(acceptedFixture);
  const unknown = report.alternatives.find((entry) => entry.support.propensityStatus === 'UNKNOWN');
  assert.equal(unknown.support.supportStatus, 'UNKNOWN');
  assert.equal(unknown.support.loggingPropensity, null);
  assert.equal(unknown.support.targetPropensity, null);
  assert.equal(unknown.support.importanceWeight, null);
  assert.equal(unknown.support.opeEligibility, 'INELIGIBLE_UNKNOWN_PROPENSITY');
});

test('18 propensity values without a logging-policy artifact fail closed', () => {
  const fixture = mutable();
  fixture.alternatives[1].support.loggingPropensity = '1';
  assertCode(() => buildDecisionLabReport(fixture), 'UNKNOWN_SUPPORT_INVALID');
});

test('19 no-trade outcomes keep MFE, MAE, and costs null rather than zero', () => {
  const report = buildDecisionLabReport(rejectedFixture);
  const noTrade = report.alternatives.find((entry) => entry.role === 'OBSERVED_DECISION');
  assert.equal(noTrade.outcome.state, 'UNAVAILABLE');
  assert.equal(noTrade.outcome.positionTaken, null);
  assert.equal(noTrade.outcome.mfePct, null);
  assert.equal(noTrade.outcome.maePct, null);
  assert.equal(noTrade.outcome.timeInExposureMs, null);
  assert.equal(noTrade.outcome.realizedCost, null);
  assert.equal(noTrade.outcome.hypotheticalCost, null);
});

test('20 hypothetical-cost paths remain unreachable without an owner policy payload', () => {
  const report = buildDecisionLabReport(acceptedFixture);
  const counterfactuals = report.alternatives.filter((entry) => entry.role === 'COUNTERFACTUAL_ALTERNATIVE');
  assert.ok(counterfactuals.every((entry) => entry.outcome.state === 'UNAVAILABLE'));
  assert.ok(counterfactuals.every((entry) => entry.outcome.hypotheticalCost === null));
  assert.equal(report.alternativeAuthorityProof.ownerPolicyPayloadAvailableCount, 0);
  assert.equal(report.alternativeAuthorityProof.counterfactualEvaluationAuthorized, false);
});

test('21 a counterfactual cannot masquerade as a realized result', () => {
  const fixture = mutable();
  const candidate = fixture.alternatives.find((entry) => entry.role === 'COUNTERFACTUAL_ALTERNATIVE');
  const observed = fixture.alternatives.find((entry) => entry.role === 'OBSERVED_DECISION');
  candidate.feasibility = { state: 'POSSIBLE_AT_CUTOFF', reasonCodes: [] };
  candidate.outcome = structuredClone(observed.outcome);
  assertCode(() => buildDecisionLabReport(fixture), 'OWNER_ALTERNATIVE_ARTIFACT_UNAVAILABLE');
});

test('22 unavailable outcomes cannot smuggle metrics, costs, or liability amounts', () => {
  const fixture = mutable();
  const unavailable = fixture.alternatives.find((entry) => entry.outcome.state === 'UNAVAILABLE');
  unavailable.outcome.mfePct = '0';
  assertCode(() => buildDecisionLabReport(fixture), 'UNAVAILABLE_OUTCOME_SHAPE_INVALID');
});

test('23 unavailable outcomes cannot acquire a residual-liability claim', () => {
  const fixture = mutable();
  const observed = fixture.alternatives.find((entry) => entry.role === 'OBSERVED_DECISION');
  observed.outcome.residualLiability = { state: 'PRESENT', ref: null, asset: 'ABC', quantity: '1' };
  assertCode(() => buildDecisionLabReport(fixture), 'UNAVAILABLE_OUTCOME_SHAPE_INVALID');
});

test('24 copied-source and shared-origin dependence are visible in report and ablation', () => {
  const report = buildDecisionLabReport(acceptedFixture);
  assert.ok(report.sourceDependenceWarnings.includes('COPIED_SOURCE_CLUSTER:macro-copy-cluster'));
  assert.ok(report.sourceDependenceWarnings.includes('SHARED_UPSTREAM_ORIGIN:official-macro-origin'));
  const removal = report.ablations.find((entry) => entry.kind === 'REMOVE_EVIDENCE_SOURCE');
  assert.ok(removal.sourceDependenceWarnings.includes('COPIED_SOURCE_CLUSTER:macro-copy-cluster'));
});

test('25 source and feature ablations must name members of the frozen information set', () => {
  const missingSource = mutable();
  missingSource.ablations.find((entry) => entry.kind === 'REMOVE_EVIDENCE_SOURCE').removedRefId = 'not-present';
  assertCode(() => buildDecisionLabReport(missingSource), 'ABLATION_SOURCE_REF_MISSING');

  const missingFamily = mutable();
  missingFamily.ablations.find((entry) => entry.kind === 'REMOVE_FEATURE_FAMILY').removedRefId = 'not-present';
  assertCode(() => buildDecisionLabReport(missingFamily), 'ABLATION_FEATURE_FAMILY_MISSING');
});

test('26 all three predeclared ablation classes are mandatory', () => {
  const fixture = mutable();
  fixture.ablations[2] = structuredClone(fixture.ablations[1]);
  fixture.ablations[2].ablationId = 'ablation:second-source-removal';
  assertCode(() => buildDecisionLabReport(fixture), 'ABLATION_COVERAGE_INCOMPLETE');
});

test('27 duplicate alternative and ablation identities fail closed', () => {
  const duplicateAlternative = mutable();
  duplicateAlternative.alternatives[1].alternativeId = duplicateAlternative.alternatives[0].alternativeId;
  assertCode(() => buildDecisionLabReport(duplicateAlternative), 'REQUEST_IDENTITY_DUPLICATE');

  const duplicateAblation = mutable();
  duplicateAblation.ablations[1].ablationId = duplicateAblation.ablations[0].ablationId;
  assertCode(() => buildDecisionLabReport(duplicateAblation), 'REQUEST_IDENTITY_DUPLICATE');
});

test('28 exactly one observed decision is required', () => {
  const none = mutable();
  const formerObserved = none.alternatives.find((entry) => entry.role === 'OBSERVED_DECISION');
  const qAlternative = none.alternatives.find((entry) => entry.role === 'COUNTERFACTUAL_ALTERNATIVE' && entry.kind !== 'EXECUTION_POLICY');
  formerObserved.role = 'COUNTERFACTUAL_ALTERNATIVE';
  formerObserved.owner = 'Q_RESEARCH';
  formerObserved.ownerEvidenceRef = structuredClone(qAlternative.ownerEvidenceRef);
  formerObserved.feasibility = { state: 'UNKNOWN', reasonCodes: ['FEASIBILITY_UNKNOWN'] };
  formerObserved.outcome = structuredClone(qAlternative.outcome);
  assertCode(() => buildDecisionLabReport(none), 'OBSERVED_DECISION_CARDINALITY');

  const two = mutable();
  const secondObserved = two.alternatives.find((entry) => entry.kind === 'EARLIER_TIMING');
  const observed = two.alternatives.find((entry) => entry.role === 'OBSERVED_DECISION');
  secondObserved.role = 'OBSERVED_DECISION';
  secondObserved.owner = observed.owner;
  secondObserved.ownerEvidenceRef = structuredClone(observed.ownerEvidenceRef);
  secondObserved.feasibility = structuredClone(observed.feasibility);
  secondObserved.outcome = structuredClone(observed.outcome);
  assertCode(() => buildDecisionLabReport(two), 'OBSERVED_DECISION_CARDINALITY');
});

test('29 closed V1 records reject hidden order, score, or authority fields', () => {
  const fixture = mutable();
  fixture.alternatives[1].order = { side: 'BUY' };
  assertCode(() => buildDecisionLabReport(fixture), 'UNKNOWN_FIELD_REJECTED');
});

test('30 a tampered report summary is rejected before its stale hash can hide it', () => {
  const report = structuredClone(buildDecisionLabReport(acceptedFixture));
  report.summary.alternativeCount = 999;
  assertCode(() => validateDecisionLabReport(report, acceptedFixture), 'REPORT_SUMMARY_INVALID');
});

test('31 rehashing cannot smuggle profit, mutation, selection, rank, or causal authority', () => {
  const cases = [
    ['REPORT_BOUNDARY_INVALID', (report) => { report.profitClaim = true; }],
    ['REPORT_BOUNDARY_INVALID', (report) => { report.causalClaimStatus = 'PROVEN'; }],
    ['REPORT_OWNER_BOUNDARY_INVALID', (report) => { report.ownerBoundaryProof.orderIssued = true; }],
    ['REPORT_OWNER_BOUNDARY_INVALID', (report) => { report.ownerBoundaryProof.externalMutationPerformed = true; }],
    ['REPORT_ALTERNATIVE_INVALID', (report) => {
      report.alternatives[0].selected = true;
      report.alternatives[0].rank = 1;
    }],
  ];
  for (const [code, mutate] of cases) {
    const report = structuredClone(buildDecisionLabReport(acceptedFixture));
    mutate(report);
    assertCode(() => validateDecisionLabReport(rehash(report), acceptedFixture), code);
  }
});

test('32 unverified recorded-shape fixtures preserve unavailable evidence-dependent results', () => {
  const report = buildDecisionLabReport(abstainedFixture);
  assert.equal(report.fixtureClass, 'UNVERIFIED_RECORDED_SHAPE_FIXTURE');
  assert.ok(report.summary.unavailableAblationCount > 0);
  assert.ok(report.warnings.includes('ABLATION_RESULT_UNAVAILABLE'));
  assert.equal(report.truthLabel, 'UNVERIFIED_RECORDED_SHAPE_ONLY');
  assert.equal(report.fixtureComposition, 'UNVERIFIED_RECORDED_SHAPE_WITH_SYNTHETIC_METADATA');
});

test('33 missed-opportunity is a disposition label, never a profit claim', () => {
  const report = buildDecisionLabReport(missedFixture);
  assert.ok(report.warnings.includes('MISSED_LABEL_IS_NOT_PROFIT_PROOF'));
  assert.equal(report.profitClaim, false);
  assert.equal(report.causalEffect, null);
});

test('34 local preview is read-only, unmounted, and carries no canonical surface or controls', () => {
  const report = buildDecisionLabReport(acceptedFixture);
  const preview = projectDecisionLabPreview(report, report.evaluatedAtMs + 1, acceptedFixture);
  assert.equal(preview.truthClass, 'FIXTURE_PROJECTION');
  assert.equal(preview.bindingState, 'DIRECTOR_MOUNT_REQUIRED');
  assert.equal(preview.mounted, false);
  assert.equal(preview.healthRecomputed, false);
  assert.deepEqual(preview.controls, []);
  assert.equal(preview.winner, null);
  assert.equal(preview.causalEffect, null);
});

test('35 evidence cannot be observed before it was published', () => {
  const fixture = mutable();
  fixture.decision.evidenceRefs[0].observedTimeMs = fixture.decision.evidenceRefs[0].publishedTimeMs - 1;
  assertCode(() => buildDecisionLabReport(fixture), 'EVIDENCE_OBSERVED_BEFORE_PUBLICATION');
});

test('36 overlong evidence strings are bounded before hashing', () => {
  const fixture = mutable();
  const withPosition = fixture.alternatives.find((entry) => entry.role === 'OBSERVED_DECISION');
  withPosition.outcome.mfePct = '1'.repeat(20_000);
  assertCode(() => buildDecisionLabReport(fixture), 'STRUCTURE_STRING_BOUND_EXCEEDED');
});

test('37 aggregate fixture truth cannot relabel synthetic references as unverified recorded-shape evidence', () => {
  const report = buildDecisionLabReport(acceptedFixture);
  assertCode(
    () => assertDecisionLabFixtureTruth(
      { decision: report.decision, alternatives: report.alternatives, ablations: report.ablations },
      'UNVERIFIED_RECORDED_SHAPE_FIXTURE',
    ),
    'FIXTURE_TRUTH_MISMATCH',
  );
});

test('38 all seven alternatives and every one-at-a-time ablation are mandatory', () => {
  const missingAlternative = mutable();
  missingAlternative.alternatives.pop();
  assertCode(() => buildDecisionLabReport(missingAlternative), 'ALTERNATIVE_COVERAGE_INCOMPLETE');

  const missingAblation = mutable();
  missingAblation.ablations.pop();
  assertCode(() => buildDecisionLabReport(missingAblation), 'ABLATION_COVERAGE_INCOMPLETE');
});

test('39 ablation rows prove their exact retained information set', () => {
  const fixture = mutable();
  const row = fixture.ablations.find((entry) => entry.kind === 'REMOVE_EVIDENCE_SOURCE');
  row.variant.informationSet.evidenceRefIds.push('evidence:forged');
  row.variant.informationSet.evidenceRefIds.sort();
  row.variant.informationSet.informationSetHash = sha256({
    featureRefIds: row.variant.informationSet.featureRefIds,
    evidenceRefIds: row.variant.informationSet.evidenceRefIds,
  });
  assertCode(() => buildDecisionLabReport(fixture), 'ABLATION_INFORMATION_SET_MISMATCH');
});

test('40 accepted owner refs bind the exact frozen contract allowlist', () => {
  const fixture = mutable();
  const ref = fixture.decision.canonicalDecisionRef;
  ref.ownerContractRef = `git:${ref.ownerCommitSha}:evil/forged.ts#Decision`;
  ref.ownerContractContentHash = 'b'.repeat(64);
  ref.fixtureIdentityHash = sha256(Object.fromEntries(Object.entries(ref).filter(([key]) => key !== 'fixtureIdentityHash')));
  assertCode(() => buildDecisionLabReport(fixture), 'OWNER_CONTRACT_NOT_ACCEPTED');
});

test('41 canonical report order cannot be changed and blessed with a new hash', () => {
  const alternatives = structuredClone(buildDecisionLabReport(acceptedFixture));
  alternatives.alternatives.reverse();
  assertCode(() => validateDecisionLabReport(rehash(alternatives), acceptedFixture), 'REPORT_ALTERNATIVE_ORDER_INVALID');

  const ablations = structuredClone(buildDecisionLabReport(acceptedFixture));
  ablations.ablations.reverse();
  assertCode(() => validateDecisionLabReport(rehash(ablations), acceptedFixture), 'REPORT_ABLATION_ORDER_INVALID');
});

test('42 preview validation rejects rehashed authority claims and inconsistent summary/report identity', () => {
  const source = buildDecisionLabReport(acceptedFixture);
  const makePreview = () => structuredClone(projectDecisionLabPreview(source, source.evaluatedAtMs + 1, acceptedFixture));
  const rehashPreview = (preview) => {
    preview.previewHash = sha256(Object.fromEntries(Object.entries(preview).filter(([key]) => key !== 'previewHash')));
    return preview;
  };

  const authority = makePreview();
  authority.profitClaim = true;
  assertCode(() => validateDecisionLabPreview(rehashPreview(authority), source, acceptedFixture), 'PREVIEW_BOUNDARY_INVALID');

  const summary = makePreview();
  summary.summary.unavailableAlternativeCount = 999;
  assertCode(() => validateDecisionLabPreview(rehashPreview(summary), source, acceptedFixture), 'PREVIEW_SUMMARY_INVALID');

  const reportRef = makePreview();
  reportRef.reportRef.reportId = `dl_report_${'f'.repeat(64)}`;
  assertCode(() => validateDecisionLabPreview(rehashPreview(reportRef), source, acceptedFixture), 'PREVIEW_REPORT_REF_INVALID');
});

test('43 observed support and no-trade semantics fail closed', () => {
  const support = mutable();
  const observed = support.alternatives.find((entry) => entry.role === 'OBSERVED_DECISION');
  observed.support = { propensityStatus: 'ZERO', supportStatus: 'ABSENT', loggingPropensity: '0', targetPropensity: '1' };
  assertCode(() => buildDecisionLabReport(support), 'PROPENSITY_EVIDENCE_UNAVAILABLE');

  const noTradeFixture = structuredClone(rejectedFixture);
  const noTrade = noTradeFixture.alternatives.find((entry) => entry.role === 'OBSERVED_DECISION');
  noTrade.outcome.positionTaken = true;
  assertCode(() => buildDecisionLabReport(noTradeFixture), 'UNAVAILABLE_OUTCOME_SHAPE_INVALID');
});

test('44 unverified recorded-shape fixtures cannot manufacture accepted realization bytes', () => {
  const fixture = makeDecisionLabFixture({
    disposition: 'ACCEPTED',
    fixtureClass: 'UNVERIFIED_RECORDED_SHAPE_FIXTURE',
  });
  assertCode(() => buildDecisionLabReport(fixture), 'RECORDED_ACCEPTED_REALIZATION_UNSUPPORTED');
});

test('45 unverified recorded-shape reports expose synthetic Q15 and missing policy payloads', () => {
  const report = buildDecisionLabReport(abstainedFixture);
  assert.equal(report.decision.qExperimentRef.fixtureTruthClass, 'SYNTHETIC_FIXTURE_REFERENCE');
  assert.ok(report.alternatives.filter((entry) => entry.role === 'COUNTERFACTUAL_ALTERNATIVE').every((entry) => entry.ownerEvidenceRef.alternativePolicyPayloadAvailable === false));
  assert.equal(report.fixtureComposition, 'UNVERIFIED_RECORDED_SHAPE_WITH_SYNTHETIC_METADATA');
  assert.equal(report.truthLabel, 'UNVERIFIED_RECORDED_SHAPE_ONLY');
});

test('46 preview validation requires and exactly matches the full source report', () => {
  const report = buildDecisionLabReport(acceptedFixture);
  const preview = projectDecisionLabPreview(report, report.evaluatedAtMs + 1, acceptedFixture);
  assertCode(() => validateDecisionLabPreview(preview), 'PREVIEW_SOURCE_REPORT_REQUIRED');

  const forged = structuredClone(preview);
  forged.warnings.push('SELECTION_BIAS_FORGED');
  forged.warnings.sort();
  forged.previewHash = sha256(Object.fromEntries(Object.entries(forged).filter(([key]) => key !== 'previewHash')));
  assertCode(() => validateDecisionLabPreview(forged, report, acceptedFixture), 'PREVIEW_SOURCE_MISMATCH');
});

test('47 each disposition binds its exact accepted decision-source semantics', () => {
  const fixture = structuredClone(abstainedFixture);
  fixture.decision.canonicalDecisionRef = structuredClone(missedFixture.decision.canonicalDecisionRef);
  assertCode(() => buildDecisionLabReport(fixture), 'DECISION_DISPOSITION_SOURCE_MISMATCH');
});

test('48 realized outcome attribution cannot use a Q excursion record', () => {
  const fixture = mutable();
  const observed = fixture.alternatives.find((entry) => entry.role === 'OBSERVED_DECISION');
  observed.outcome.state = 'AVAILABLE';
  observed.outcome.realizationClass = 'REALIZED';
  observed.outcome.positionTaken = true;
  observed.outcome.mfePct = '1';
  observed.outcome.maePct = '1';
  observed.outcome.timeInExposureMs = 1;
  assertCode(() => buildDecisionLabReport(fixture), 'OWNER_CONTRACT_SEAM_MISMATCH');
});

test('49 the seven-entry manifest permits exactly one row per alternative kind', () => {
  const tooMany = mutable();
  const duplicate = structuredClone(tooMany.alternatives.find((entry) => entry.kind === 'THRESHOLD'));
  duplicate.alternativeId = 'alternative:threshold:duplicate';
  tooMany.alternatives.push(duplicate);
  assertCode(() => buildDecisionLabReport(tooMany), 'REQUEST_ARRAY_BOUNDS_INVALID');

  const duplicateKind = mutable();
  const executionIndex = duplicateKind.alternatives.findIndex((entry) => entry.kind === 'EXECUTION_POLICY');
  duplicateKind.alternatives[executionIndex] = duplicate;
  assertCode(() => buildDecisionLabReport(duplicateKind), 'ALTERNATIVE_COVERAGE_INCOMPLETE');
});

test('50 every one-at-a-time ablation shares one immutable unavailable baseline', () => {
  const fixture = mutable();
  fixture.ablations[1].baseline.reasonCodes = ['DIFFERENT_BASELINE'];
  assertCode(() => buildDecisionLabReport(fixture), 'ABLATION_BASELINE_IDENTITY_MISMATCH');
});

test('51 hostile depth, cycles, and accessors fail with bounded contract errors', () => {
  const deep = mutable();
  let cursor = {};
  deep.rogue = cursor;
  for (let index = 0; index < 70; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assertCode(() => buildDecisionLabReport(deep), 'STRUCTURE_DEPTH_BOUND_EXCEEDED');

  const cyclic = mutable();
  cyclic.rogue = cyclic;
  assertCode(() => buildDecisionLabReport(cyclic), 'STRUCTURE_CYCLE_REJECTED');

  const accessor = mutable();
  let getterExecuted = false;
  Object.defineProperty(accessor, 'rogue', {
    enumerable: true,
    get() {
      getterExecuted = true;
      throw new Error('must not execute');
    },
  });
  assertCode(() => buildDecisionLabReport(accessor), 'STRUCTURE_ACCESSOR_REJECTED');
  assert.equal(getterExecuted, false);

  const truthCycle = {};
  truthCycle.self = truthCycle;
  assertCode(() => assertDecisionLabFixtureTruth(truthCycle, 'SYNTHETIC_FIXTURE'), 'STRUCTURE_CYCLE_REJECTED');
});

test('52 retrospective and copied-source bias cannot be understated', () => {
  const retrospective = mutable();
  for (const dimension of ['selectionBias', 'survivorshipBias', 'hindsightRisk', 'confounding']) {
    retrospective.decision.biasAssessment[dimension] = { status: 'NOT_EVIDENCED', reasonCodes: [] };
  }
  assertCode(() => buildDecisionLabReport(retrospective), 'RETROSPECTIVE_BIAS_UNDERSTATED');

  const copied = mutable();
  copied.decision.biasAssessment.copiedSourceRisk = { status: 'UNKNOWN', reasonCodes: ['DEPENDENCE_UNKNOWN'] };
  assertCode(() => buildDecisionLabReport(copied), 'COPIED_SOURCE_BIAS_UNDERSTATED');
});

test('53 Q/L owner evidence is exact while all missing evaluations stay unavailable', () => {
  const report = buildDecisionLabReport(acceptedFixture);
  const counterfactuals = report.alternatives.filter((entry) => entry.role === 'COUNTERFACTUAL_ALTERNATIVE');
  assert.ok(counterfactuals.every((entry) => entry.ownerEvidenceRef.alternativePolicyPayloadAvailable === false));
  assert.ok(counterfactuals.every((entry) => entry.outcome.state === 'UNAVAILABLE'));
  const execution = counterfactuals.find((entry) => entry.kind === 'EXECUTION_POLICY');
  assert.equal(execution.ownerEvidenceRef.evidenceClass, 'ACCEPTED_FIXTURE_FACTORY_SOURCE_ONLY');
  assert.equal(execution.ownerEvidenceRef.materializationState, 'NOT_MATERIALIZED');
  assert.equal(execution.ownerEvidenceRef.evaluationState, 'NOT_EVALUATED');
  assert.ok(report.ablations.every((entry) => entry.baseline.state === 'UNAVAILABLE' && entry.variant.state === 'UNAVAILABLE'));
});

test('54 point-in-time feature, cost-scenario, and unavailable-outcome seams use exact owner record types', () => {
  const report = buildDecisionLabReport(acceptedFixture);
  assert.equal(report.decision.featureRefs.find((entry) => entry.featureFamilyId === 'liquidity').ref.contractId, 'FeatureValue');
  assert.equal(report.decision.costAssumptionRef.contractId, 'CostScenarioV1');
  assert.equal(report.alternatives.find((entry) => entry.role === 'OBSERVED_DECISION').outcome.outcomeAttributionRef.contractId, 'ExcursionOutcomeV1');
});

test('55 the decision and every ablation bind the exact bundled Q15 fixture identity', () => {
  const report = buildDecisionLabReport(acceptedFixture);
  assert.ok(report.ablations.every((entry) => entry.qExperimentEvidenceRef.fixtureContentHash === report.decision.qExperimentRef.fixtureContentHash));

  const fixture = mutable();
  fixture.decision.qExperimentRef.fixtureContentHash = 'a'.repeat(64);
  fixture.decision.qExperimentRef.fixtureIdentityHash = sha256(Object.fromEntries(
    Object.entries(fixture.decision.qExperimentRef).filter(([key]) => key !== 'fixtureIdentityHash'),
  ));
  assertCode(() => buildDecisionLabReport(fixture), 'EXPERIMENT_FIXTURE_IDENTITY_MISMATCH');
});

test('56 synthetic scenario timestamps are non-authoritative and recorded predeclaration remains unavailable', () => {
  const synthetic = buildDecisionLabReport(acceptedFixture);
  assert.ok(synthetic.alternatives.every((entry) => entry.alternativeManifestRef.temporalAuthority === false));
  assert.equal(synthetic.alternativeAuthorityProof.counterfactualPredeclarationProvenCount, 0);

  const unverified = buildDecisionLabReport(abstainedFixture);
  const counterfactuals = unverified.alternatives.filter((entry) => entry.role === 'COUNTERFACTUAL_ALTERNATIVE');
  assert.ok(counterfactuals.every((entry) => entry.predeclarationStatus === 'RECORDED_EVIDENCE_UNAVAILABLE'));
  assert.ok(counterfactuals.every((entry) => entry.predeclaredAtMs === null));
  assert.equal(unverified.alternativeAuthorityProof.recordedPredeclarationEvidenceUnavailableCount, 6);
});

test('57 report validation requires the immutable full source request and rejects rehashed drift', () => {
  const report = structuredClone(buildDecisionLabReport(acceptedFixture));
  assertCode(() => validateDecisionLabReport(report), 'REPORT_SOURCE_REQUEST_REQUIRED');
  const observed = report.alternatives.find((entry) => entry.role === 'OBSERVED_DECISION');
  observed.outcome.outcomeId = 'outcome:forged';
  observed.outcome.outcomeHash = sha256(Object.fromEntries(
    Object.entries(observed.outcome).filter(([key]) => key !== 'outcomeHash'),
  ));
  observed.alternativeHash = sha256(Object.fromEntries(
    Object.entries(observed).filter(([key]) => !['alternativeHash', 'comparisonStatus'].includes(key)),
  ));
  rehash(report);
  assertCode(() => validateDecisionLabReport(report, acceptedFixture), 'REPORT_SOURCE_ALTERNATIVE_MISMATCH');
});

test('58 local fixture references may name only actual exported fixture anchors', () => {
  const fixture = mutable();
  const ref = fixture.decision.canonicalDecisionRef;
  ref.fixtureRecordRef = 'frontier/decision-lab/fixtures/factory.mjs#forged';
  ref.fixtureIdentityHash = sha256(Object.fromEntries(
    Object.entries(ref).filter(([key]) => key !== 'fixtureIdentityHash'),
  ));
  assertCode(() => buildDecisionLabReport(fixture), 'FIXTURE_RECORD_REF_INVALID');
});

test('59 committed Dock bindings and Q15 adapter execute the exact fixture-validation seam', () => {
  const ownerMap = readJson('../../dock/contracts/v1/canonical-owner-map.json');
  const moduleFacetMatrix = readJson('../../dock/contracts/v1/module-facet-matrix.json');
  const adapterMap = readJson('../contracts/q15-experiment-card.adapter-map.v1.json');
  const bindings = selectF13DockBindings(ownerMap, moduleFacetMatrix);
  const result = validateQ15ExperimentFixture({
    fixture: Q15_EXPERIMENT_FIXTURE,
    adapterMap,
    bindings,
  });
  assert.equal(result.valid, true);
  assert.equal(result.truthClass, 'FIXTURE_VALIDATION');
  assert.equal(result.authorityClass, 'NO_AUTHORITY');
  assert.equal(result.registryWritePerformed, false);
  assert.equal(result.treatmentAssigned, false);
  assert.equal(result.promotionPerformed, false);
});

test('60 committed Dock projection binding preserves the read-only unmounted preview', () => {
  const ownerMap = readJson('../../dock/contracts/v1/canonical-owner-map.json');
  const moduleFacetMatrix = readJson('../../dock/contracts/v1/module-facet-matrix.json');
  const bindings = selectF13DockBindings(ownerMap, moduleFacetMatrix);
  const report = buildDecisionLabReport(acceptedFixture);
  const preview = projectDecisionLabPreview(report, report.evaluatedAtMs + 1, acceptedFixture);
  const projected = projectPreviewThroughDock(preview, bindings, report, acceptedFixture);
  assert.equal(projected.truthClass, 'FIXTURE_PROJECTION');
  assert.equal(projected.authorityClass, 'NO_AUTHORITY');
  assert.equal(projected.mounted, false);
  assert.equal(projected.canonical, false);
  assert.deepEqual(projected.controls, []);
  assert.equal(projected.canonicalSurfaceId, null);
});

test('61 committed insertion request passes the exact single-seam Dock contract', () => {
  const request = readJson('../contracts/insertion-request.v1.json');
  assert.equal(validateDecisionLabInsertion(request, [
    'quant/research:decision-level-counterfactual-owner-artifact-admission',
  ]), true);
});

test('62 committed resource budget uses the exact Dock unavailable-prestage contract', () => {
  const claim = readJson('../contracts/resource-budget-claim.v1.json');
  assert.equal(validateResourceBudgetClaim(claim), true);
  assert.equal(claim.measurementMode, 'UNAVAILABLE_PRESTAGE');
  for (const metric of ['cpu', 'memory', 'disk', 'network', 'eventRate', 'latency', 'queue', 'storageGrowth', 'modelUse']) {
    assert.equal(claim[metric].state, 'UNAVAILABLE');
  }
});
