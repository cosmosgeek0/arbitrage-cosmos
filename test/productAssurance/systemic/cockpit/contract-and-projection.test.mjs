import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CockpitContractError,
  COCKPIT_RELEASE_MANIFEST_LAW,
  DASHBOARD_REQUIRED_VALUE_KEYS,
  FACT_SEMANTICS_BY_CONTRACT,
  I00_SURFACE_IDS,
  INFORMATION_LEVEL_DEFINITIONS,
  buildCockpitViewModel,
  evaluatePanel,
  validateCockpitContractSet,
  validatePanelObservation,
  validateSurfaceProjectionMatrix,
} from '../../../../fixtures/productAssurance/systemic/cockpit/reference/cockpit-view-model.mjs';
import {
  allObservations,
  availableControlState,
  observationFor,
} from './support/cockpit-fixture-builder.mjs';

function json(relativePath) {
  return JSON.parse(readFileSync(new URL(
    `../../../../fixtures/productAssurance/systemic/cockpit/${relativePath}`,
    import.meta.url,
  ), 'utf8'));
}

const contractSet = json('fixtures/panel-contracts.v1.json');
const matrix = json('fixtures/surface-projection-matrix.v1.json');
const observationFixture = json('fixtures/panel-observations.v1.json');
const NOW = observationFixture.evaluatedAtMs;
const FROZEN_DASHBOARD_VALUE_KEYS = Object.freeze([
  'desiredState',
  'observedState',
  'readiness',
  'liveness',
  'heartbeatAgeMs',
  'restartCount',
  'currentError',
  'renderTruthLabel',
  'mode',
  'desiredMode',
  'effectiveMode',
  'killSwitchState',
  'killSwitchEffect',
  'startupGeneration',
  'lastRestart',
  'lastRestartResult',
  'rootBlocker',
  'overallPosture',
  'activeExposureCount',
  'newestCandidateDisposition',
  'newestCandidateDispositionReason',
  'newestCandidateId',
  'newestCandidateSymbol',
  'newestCandidateEvidenceRevision',
  'degradedSourceCount',
  'degradedSourceIdentities',
  'degradedSourceReasons',
  'bootStartupTransactionState',
  'deployedRevision',
  'testedRevision',
  'dataSourceHealthState',
  'dataSourceConnectionStates',
  'oldestDataSourceMessageAgeMs',
  'dataSourceSequenceGapCount',
  'dataSourceRateLimitBackoffState',
  'dataSourceCoverageExpectedCount',
  'dataSourceCoverageCurrentCount',
  'quietSymbolCount',
  'basisLiveAgeMs',
  'basisUniverseCount',
  'basisCandidateCount',
  'basisFocusCount',
  'basisProposalCount',
  'basisLatestDecision',
  'basisLatestRejectReasonCode',
  'volumeLiveAgeMs',
  'volumeUniverseCount',
  'volumeCandidateCount',
  'volumeFocusCount',
  'volumeProposalCount',
  'volumeLatestDecision',
  'volumeLatestRejectReasonCode',
  'qHealthState',
  'qModelVersion',
  'qDatasetVersion',
  'qDriftState',
  'qLatestAssessment',
  'qLatestAssessmentAction',
  'qLatestAbstentionReason',
  'allocatableTruthState',
  'reservationCount',
  'stagedMandateCount',
  'approvalState',
  'approvalExpiresAtMs',
  'capitalCeiling',
  'equity',
  'availableCapital',
  'realizedPnl',
  'drawdown',
  'universeCount',
  'candidateCount',
  'focusCount',
  'opportunityCount',
  'activeOrderCount',
  'activePositionCount',
  'activeLiabilityCount',
  'activeRecoveryCount',
  'latestRiskVerdict',
  'latestRiskBlockCodes',
  'executionDryRunPlanState',
  'executionDryRunLegState',
  'executionReconciliationState',
  'liveExecutionBarrier',
  'attentionQueueCount',
  'attentionQueueRankedState',
  'topAttentionPriority',
  'topAttentionReason',
  'topAttentionResolvingControl',
  'dashboardCorrelationChainId',
  'traceTargetCount',
  'strategyStatus',
  'qStatus',
  'recentMaterialDecisionCount',
  'recentMaterialDecisionSummary',
  'executionOwner',
  'executionFencingEpoch',
]);

function contract(contractId) {
  return contractSet.contracts.find((entry) => entry.contractId === contractId);
}

function ruleSet(panel) {
  return contractSet.stateRuleSets.find((entry) => entry.ruleSetId === panel.stateRuleSetId);
}

function evaluate(panel, observation, evaluatedAtMs = NOW) {
  return evaluatePanel(panel, observation, evaluatedAtMs, ruleSet(panel));
}

function patchPath(source, dottedPath, value) {
  const output = structuredClone(source);
  const parts = dottedPath.split('.');
  let target = output;
  for (const part of parts.slice(0, -1)) target = target[part];
  target[parts.at(-1)] = value;
  return output;
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof CockpitContractError && error.code === code);
}

function fixtureProvenance() {
  return {
    truthLabel: observationFixture.fixtureTruthLabel,
    authority: observationFixture.fixtureAuthority,
    wiringState: observationFixture.wiringState,
    note: observationFixture.fixtureNote,
  };
}

function requestNonGreen(input, state, markerCode, causeCode) {
  input.requestedDisplayState = state;
  input.reasonCodes = [markerCode, causeCode];
  input.stateCauseEvidence = {
    state,
    causeCode,
    subjectId: input.contractId,
    evidenceRef: `fixture:state-cause:${causeCode}`,
    observedAtMs: input.evidence.observedAtMs,
  };
  return input;
}

test('closed panel contracts cover exactly the accepted 18 IP-CONTROL surfaces', () => {
  assert.equal(validateCockpitContractSet(contractSet), true);
  assert.deepEqual(
    [...new Set(contractSet.contracts.map((entry) => entry.surfaceId))],
    I00_SURFACE_IDS,
  );
  assert.equal(contractSet.contracts.length, 25);
  assert.equal(contractSet.contracts.filter((entry) => entry.panelKind === 'CONTROL').length, 6);
});

test('five-second claims require a connected registered path and dead-browser failures require out-of-band proof', () => {
  const fiveSecond = contractSet.contracts.find((entry) => entry.detectionClaim.kind === 'FIVE_SECOND');
  assert.equal(fiveSecond.surfaceId, 'dashboard');
  assert.equal(fiveSecond.detectionClaim.sloMaximumDetectionMs, 5000);
  assert.ok(fiveSecond.detectionClaim.registeredFailureId);
  assert.ok(fiveSecond.detectionClaim.detectorPath);
  assert.ok(fiveSecond.detectionClaim.telemetryPath);
  assert.ok(fiveSecond.detectionClaim.browserPath);
  assert.ok(fiveSecond.detectionClaim.sloId);

  const missingPath = structuredClone(contractSet);
  missingPath.contracts.find((entry) => entry.detectionClaim.kind === 'FIVE_SECOND').detectionClaim.browserPath = null;
  expectCode(() => validateCockpitContractSet(missingPath), 'FIVE_SECOND_CLAIM_UNPROVEN');

  const deadBrowserClaim = structuredClone(contractSet);
  deadBrowserClaim.contracts.find((entry) => entry.detectionClaim.kind === 'FIVE_SECOND').detectionClaim.registeredFailureId = 'APP_HOST_TUNNEL_DEAD';
  expectCode(() => validateCockpitContractSet(deadBrowserClaim), 'OUT_OF_BAND_PROOF_REQUIRED');

  const outOfBand = contractSet.contracts.find((entry) => entry.detectionClaim.kind === 'OUT_OF_BAND_ONLY');
  assert.equal(outOfBand.surfaceId, 'health');
  assert.equal(outOfBand.detectionClaim.browserPath, null);
  assert.ok(outOfBand.detectionClaim.outOfBandProofPath);
});

test('five levels project through exact topics and the five required Account aliases without new pages', () => {
  assert.equal(validateSurfaceProjectionMatrix(matrix), true);
  assert.deepEqual(matrix.levelDefinitions, INFORMATION_LEVEL_DEFINITIONS);
  assert.deepEqual(matrix.rows.map((row) => row.surfaceId), I00_SURFACE_IDS);
  assert.deepEqual(
    [...new Set(matrix.rows.flatMap((row) => row.informationLevels))].sort((left, right) => left - right),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(matrix.rows.find((row) => row.surfaceId === 'dashboard').informationLevels, [1, 2, 3, 4, 5]);
  assert.deepEqual(contract('PANEL_DASHBOARD_TRUTH_V1').informationLevels, [1, 2, 3, 4, 5]);
  const topicIds = matrix.levelDefinitions.flatMap((definition) => definition.topics.map((topic) => topic.topicId));
  assert.equal(topicIds.length, 28);
  assert.deepEqual(
    [...new Set(matrix.rows.flatMap((row) => row.factBindings.map((binding) => binding.topicId)))].sort(),
    [...topicIds].sort(),
  );
  const aliases = new Set(['execution', 'orders', 'positions', 'fills', 'pnl']);
  for (const row of matrix.rows) {
    assert.equal(row.routeKind, aliases.has(row.surfaceId) ? 'ACCOUNT_ALIAS' : 'CANONICAL_SURFACE');
    assert.equal(row.canonicalRoute, aliases.has(row.surfaceId) ? 'account' : row.surfaceId);
    assert.equal(row.pageOwner, aliases.has(row.surfaceId) ? 'account' : row.surfaceId);
  }
});

test('Dashboard, Control Room, and Health answer the required component truth questions', () => {
  const required = [
    'desiredState', 'observedState', 'readiness', 'liveness', 'heartbeatAgeMs',
    'restartCount', 'currentError', 'renderTruthLabel',
  ];
  for (const panel of contractSet.contracts.filter((entry) => (
    entry.contractId === 'PANEL_DASHBOARD_TRUTH_V1'
      || entry.contractId === 'PANEL_CONTROL_ROOM_TRUTH_V1'
      || entry.surfaceId === 'health'
  ))) {
    for (const key of required) assert.ok(panel.requiredValueKeys.includes(key), `${panel.contractId}:${key}`);
    assert.deepEqual(panel.drilldownBounds, {
      perComponentRequired: true,
      maximumRows: 200,
      maximumTraceEvents: 500,
    });
  }
  for (const key of [
    'overallPosture', 'lastRestart', 'lastRestartResult', 'mode', 'desiredMode', 'effectiveMode',
    'killSwitchState', 'killSwitchEffect', 'startupGeneration', 'rootBlocker',
    'newestCandidateDispositionReason', 'degradedSourceIdentities', 'degradedSourceReasons',
  ]) {
    assert.ok(contract('PANEL_DASHBOARD_TRUTH_V1').requiredValueKeys.includes(key), key);
  }
});

test('Dashboard truth is frozen to the exact machine-checkable I00 and DASHBOARD_TRUTH fact set', () => {
  const panel = contract('PANEL_DASHBOARD_TRUTH_V1');
  assert.deepEqual(DASHBOARD_REQUIRED_VALUE_KEYS, FROZEN_DASHBOARD_VALUE_KEYS);
  assert.deepEqual(panel.requiredValueKeys, FROZEN_DASHBOARD_VALUE_KEYS);
  assert.deepEqual(
    observationFixture.baseLiveObservation.values.map((value) => value.key),
    FROZEN_DASHBOARD_VALUE_KEYS,
  );
  assert.deepEqual(
    panel.factSemantics.find((fact) => fact.valueKey === 'qLatestAssessmentAction').enumValues,
    ['ABSTAIN_UNKNOWN', 'FOCUS', 'PROPOSE_CONSIDERATION', 'WATCH'],
  );
  assert.deepEqual(
    panel.factSemantics.find((fact) => fact.valueKey === 'liveExecutionBarrier').enumValues,
    ['LIVE_EXECUTION_NOT_IMPLEMENTED'],
  );
});

test('build validates every hierarchy fact against surface, level, contract, and required value key', () => {
  const base = {
    schemaVersion: 1,
    viewModelId: 'HOSTILE_FACT_BINDING_V1',
    evaluatedAtMs: NOW,
    fixtureProvenance: fixtureProvenance(),
    contractSet,
    observations: allObservations(contractSet),
  };
  const badKey = structuredClone(matrix);
  badKey.rows[0].factBindings[0].valueKey = 'decorativeFact';
  expectCode(() => buildCockpitViewModel({ ...base, projectionMatrix: badKey }), 'FACT_SEMANTIC_BINDING_MISMATCH');

  const missingKey = structuredClone(matrix);
  missingKey.rows[0].factBindings = missingKey.rows[0].factBindings.filter((binding) => binding.valueKey !== 'overallPosture');
  expectCode(() => buildCockpitViewModel({ ...base, projectionMatrix: missingKey }), 'FACT_BINDING_KEYSET_MISMATCH');

  const inventedRoute = structuredClone(matrix);
  inventedRoute.rows.find((row) => row.surfaceId === 'orders').canonicalRoute = 'orders';
  expectCode(() => validateSurfaceProjectionMatrix(inventedRoute), 'SURFACE_ROUTE_LAW_MISMATCH');

  const sameLevelSubstitution = structuredClone(matrix);
  const desiredStateBinding = sameLevelSubstitution.rows[0].factBindings.find((binding) => (
    binding.contractId === 'PANEL_DASHBOARD_TRUTH_V1' && binding.valueKey === 'desiredState'
  ));
  assert.equal(desiredStateBinding.level, 2);
  desiredStateBinding.topicId = 'L2_STARTUP_RUNTIME_DEPENDENCIES';
  expectCode(() => validateSurfaceProjectionMatrix(sameLevelSubstitution), 'FACT_SEMANTIC_BINDING_MISMATCH');

  const relabeledContract = structuredClone(contractSet);
  relabeledContract.contracts[0].factSemantics.find((fact) => fact.valueKey === 'desiredState').topicId = 'L2_STARTUP_RUNTIME_DEPENDENCIES';
  expectCode(() => validateCockpitContractSet(relabeledContract), 'FACT_SEMANTIC_LAW_MISMATCH');
});

test('fact values enforce exact kind, unit, bounded enum, key ownership, and registered null causes', () => {
  const wrongKind = structuredClone(observationFixture.baseLiveObservation);
  wrongKind.values.find((value) => value.key === 'heartbeatAgeMs').value = 'VERY_FRESH';
  expectCode(() => validatePanelObservation(wrongKind), 'FACT_VALUE_KIND_MISMATCH');

  const wrongUnit = structuredClone(observationFixture.baseLiveObservation);
  wrongUnit.values.find((value) => value.key === 'heartbeatAgeMs').unit = 'USD';
  expectCode(() => validatePanelObservation(wrongUnit), 'FACT_VALUE_UNIT_MISMATCH');

  const fractionalCount = structuredClone(observationFixture.baseLiveObservation);
  fractionalCount.values.find((value) => value.key === 'activeExposureCount').value = 0.5;
  expectCode(() => validatePanelObservation(fractionalCount), 'FACT_VALUE_KIND_MISMATCH');

  const unboundedEnum = structuredClone(observationFixture.baseLiveObservation);
  unboundedEnum.values.find((value) => value.key === 'qLatestAssessmentAction').value = 'ACCEPT';
  expectCode(() => validatePanelObservation(unboundedEnum), 'FACT_VALUE_ENUM_INVALID');

  const undeclared = structuredClone(observationFixture.baseLiveObservation);
  undeclared.values.push({ key: 'decorativeHealth', value: 'GREEN', valueState: 'KNOWN', unit: 'STATE', unknownReasonCode: null });
  expectCode(() => validatePanelObservation(undeclared), 'FACT_VALUE_KEY_UNDECLARED');

  const unregisteredNullCause = structuredClone(observationFixture.baseLiveObservation);
  const exposure = unregisteredNullCause.values.find((value) => value.key === 'activeExposureCount');
  exposure.value = null;
  exposure.valueState = 'UNKNOWN';
  exposure.unknownReasonCode = 'FREE_FORM_NULL_CAUSE';
  expectCode(() => validatePanelObservation(unregisteredNullCause), 'UNKNOWN_VALUE_DISCIPLINE');
});

test('all input reason-code fields bind to the frozen versioned packet registry', () => {
  const actionReason = structuredClone(contractSet);
  actionReason.contracts[0].actionBinding.noAutomaticActionReasonCode = 'FREE_FORM_ACTION_REASON';
  expectCode(() => validateCockpitContractSet(actionReason), 'REASON_CODE_NOT_REGISTERED');

  const controlReason = structuredClone(contractSet);
  controlReason.contracts.find((entry) => entry.panelKind === 'CONTROL').controlBinding.unavailableReasonCode = 'FREE_FORM_CONTROL_REASON';
  expectCode(() => validateCockpitContractSet(controlReason), 'REASON_CODE_NOT_REGISTERED');

  const observationReason = structuredClone(observationFixture.baseLiveObservation);
  observationReason.reasonCodes = ['FREE_FORM_OBSERVATION_REASON'];
  expectCode(() => validatePanelObservation(observationReason), 'REASON_CODE_NOT_REGISTERED');
});

test('a panel cannot claim an information level absent from its surface projection', () => {
  const hostile = structuredClone(contractSet);
  hostile.contracts.find((entry) => entry.surfaceId === 'markets').informationLevels = [3];
  expectCode(() => buildCockpitViewModel({
    schemaVersion: 1,
    viewModelId: 'HOSTILE_LEVEL_V1',
    evaluatedAtMs: NOW,
    fixtureProvenance: fixtureProvenance(),
    contractSet: hostile,
    projectionMatrix: matrix,
    observations: allObservations(contractSet),
  }), 'FACT_SEMANTIC_LEVEL_UNSUPPORTED');
});

test('claimed live input reaches green only when every anti-false-green fact is proven', () => {
  const input = observationFixture.baseLiveObservation;
  assert.equal(validatePanelObservation(input), true);
  const output = evaluate(contract(input.contractId), input);
  assert.equal(output.displayState, 'GREEN');
  assert.deepEqual(output.reasonCodes, []);
  for (const key of contract(input.contractId).requiredValueKeys) {
    assert.ok(output.values.some((value) => value.key === key), key);
  }
});

test('UNKNOWN, stale, silent, missing, and synthetic inputs cannot render green', () => {
  for (const fixtureCase of observationFixture.antiGreenCases) {
    const input = patchPath(
      observationFixture.baseLiveObservation,
      fixtureCase.patchPath,
      fixtureCase.patchValue,
    );
    const output = evaluate(contract(input.contractId), input);
    assert.equal(output.displayState, fixtureCase.expectedDisplayState, fixtureCase.caseId);
    assert.ok(output.reasonCodes.includes(fixtureCase.expectedReasonCode), fixtureCase.caseId);
    assert.notEqual(output.displayState, 'GREEN', fixtureCase.caseId);
  }
});

test('contradictory non-green release statuses cannot coexist with LIVE_PUBLIC green', () => {
  for (const [releaseStatus, expectedDisplayState] of [
    ['BLOCKED', 'UNKNOWN'],
    ['NOT_CONFIGURED', 'MISSING'],
    ['MISSING', 'MISSING'],
    ['SYNTHETIC_ONLY', 'SYNTHETIC'],
  ]) {
    const input = structuredClone(observationFixture.baseLiveObservation);
    input.truthAxes.releaseStatuses.push(releaseStatus);
    const output = evaluate(contract(input.contractId), input);
    assert.equal(output.displayState, expectedDisplayState, releaseStatus);
    assert.ok(
      output.reasonCodes.includes(`RELEASE_STATUS_CONTRADICTION_${releaseStatus}`),
      releaseStatus,
    );
    assert.notEqual(output.displayState, 'GREEN', releaseStatus);
  }
});

test('declared GREEN forbidden flags in canonical reason codes force deterministic downgrades', () => {
  for (const [reasonCode, expectedState] of [
    ['MISSING', 'MISSING'],
    ['SILENT', 'SILENT'],
    ['STALE', 'STALE'],
    ['SYNTHETIC', 'SYNTHETIC'],
    ['UNKNOWN', 'UNKNOWN'],
  ]) {
    const input = structuredClone(observationFixture.baseLiveObservation);
    input.reasonCodes = [reasonCode];
    const output = evaluate(contract(input.contractId), input);
    assert.equal(output.displayState, expectedState, reasonCode);
    assert.ok(output.reasonCodes.includes(reasonCode), reasonCode);
    assert.ok(output.reasonCodes.includes(`DECLARED_GREEN_FORBIDDEN_${reasonCode}`), reasonCode);
  }
});

test('yellow and red require explicit machine reasons and are never inferred from healthy truth', () => {
  for (const [requestedDisplayState, reasonFlag] of [
    ['YELLOW', 'DEGRADED_REASON_PRESENT'],
    ['RED', 'BLOCKING_REASON_PRESENT'],
  ]) {
    const input = structuredClone(observationFixture.baseLiveObservation);
    input.requestedDisplayState = requestedDisplayState;
    expectCode(() => evaluate(contract(input.contractId), input), 'OBJECT_REQUIRED');
    requestNonGreen(
      input,
      requestedDisplayState,
      reasonFlag,
      requestedDisplayState === 'YELLOW' ? 'SOURCE_STALE' : 'COMPONENT_BLOCKED',
    );
    assert.equal(evaluate(contract(input.contractId), input).displayState, requestedDisplayState);
  }
  const staleWithoutStaleEvidence = structuredClone(observationFixture.baseLiveObservation);
  requestNonGreen(staleWithoutStaleEvidence, 'STALE', 'STALE', 'SOURCE_STALE');
  staleWithoutStaleEvidence.reasonCodes = ['SOURCE_STALE'];
  const output = evaluate(contract(staleWithoutStaleEvidence.contractId), staleWithoutStaleEvidence);
  assert.equal(output.displayState, 'UNKNOWN');
  assert.ok(output.reasonCodes.includes('DECLARED_STALE_REQUIRED_STALE_MISSING'));
});

test('render truth labels include unknown and unavailable and fail closed to axis-consistent output', () => {
  for (const [mutate, expectedLabel] of [
    [(input) => { input.truthAxes.truthLabel = 'UNKNOWN'; }, 'UNKNOWN'],
    [(input) => {
      input.truthAxes.truthLabel = 'UNAVAILABLE';
      input.truthAxes.authority = 'UNAVAILABLE';
      input.truthAxes.dataMode = 'UNAVAILABLE';
    }, 'UNAVAILABLE'],
  ]) {
    const input = structuredClone(observationFixture.baseLiveObservation);
    mutate(input);
    const output = evaluate(contract(input.contractId), input);
    assert.equal(output.displayState, 'UNKNOWN');
    assert.ok(output.reasonCodes.includes('RENDER_TRUTH_LABEL_INCONSISTENT'));
    assert.equal(output.values.find((value) => value.key === 'renderTruthLabel').value, expectedLabel);
    assert.notEqual(output.values.find((value) => value.key === 'renderTruthLabel').value, 'LIVE');
  }

  const controlRoom = contract('PANEL_CONTROL_ROOM_TRUTH_V1');
  const alignedUnknown = observationFor(controlRoom);
  alignedUnknown.truthAxes.truthLabel = 'UNKNOWN';
  alignedUnknown.values.find((value) => value.key === 'renderTruthLabel').value = 'UNKNOWN';
  assert.equal(validatePanelObservation(alignedUnknown), true);
  assert.ok(!evaluate(controlRoom, alignedUnknown).reasonCodes.includes('RENDER_TRUTH_LABEL_INCONSISTENT'));
});

test('evidence-quality states remain explicit even when the owner requested yellow or red', () => {
  for (const [requestedDisplayState, mutate, expectedDisplayState, reasonCode] of [
    ['YELLOW', (input) => { input.truthAxes.truthLabel = 'UNKNOWN'; }, 'UNKNOWN', 'TRUTH_NOT_LIVE_PUBLIC'],
    ['RED', (input) => { input.truthAxes.telemetrySilent = true; }, 'SILENT', 'TELEMETRY_SILENT'],
    ['YELLOW', (input) => { input.truthAxes.freshnessState = 'STALE'; }, 'STALE', 'EVIDENCE_STALE'],
  ]) {
    const input = structuredClone(observationFixture.baseLiveObservation);
    requestNonGreen(
      input,
      requestedDisplayState,
      requestedDisplayState === 'YELLOW' ? 'DEGRADED_REASON_PRESENT' : 'BLOCKING_REASON_PRESENT',
      requestedDisplayState === 'YELLOW' ? 'SOURCE_STALE' : 'COMPONENT_BLOCKED',
    );
    mutate(input);
    const output = evaluate(contract(input.contractId), input);
    assert.equal(output.displayState, expectedDisplayState);
    assert.ok(output.reasonCodes.includes(reasonCode));
  }
});

test('source provenance, release identity, exact expected count, and observed detection outcomes gate green', () => {
  for (const [mutate, reasons] of [
    [(input) => { input.sourceProvenance.canonicalOwner = 'DUPLICATE_OWNER'; }, ['SOURCE_OWNER_MISMATCH']],
    [(input) => { input.sourceProvenance.sourceSchemaId = 'DUPLICATE_SCHEMA'; }, ['SOURCE_SCHEMA_MISMATCH']],
    [(input) => { input.sourceProvenance.manifestId = 'CALLER_CHOSEN_MANIFEST'; }, ['MANIFEST_ID_MISMATCH']],
    [(input) => { input.sourceProvenance.manifestSha256 = 'c'.repeat(64); }, ['MANIFEST_SHA256_MISMATCH']],
    [(input) => {
      input.sourceProvenance.acceptedReleaseSha = 'c'.repeat(40);
      input.sourceProvenance.runningReleaseSha = 'c'.repeat(40);
    }, ['ACCEPTED_RELEASE_SHA_MISMATCH', 'RUNNING_RELEASE_SHA_MISMATCH']],
    [(input) => { input.sourceProvenance.runningReleaseSha = 'c'.repeat(40); }, ['RUNNING_RELEASE_SHA_MISMATCH']],
    [(input) => { input.detectionEvidence.browserConnected = false; }, ['DETECTION_PATH_NOT_PROVEN']],
    [(input) => { input.evidence.observedCount = 2; }, ['EXPECTED_EVIDENCE_COUNT_MISMATCH']],
  ]) {
    const input = structuredClone(observationFixture.baseLiveObservation);
    mutate(input);
    const output = evaluate(contract(input.contractId), input);
    assert.equal(output.displayState, 'UNKNOWN', reasons.join(','));
    for (const reason of reasons) assert.ok(output.reasonCodes.includes(reason), reason);
  }
});

test('contract release binding is closed, immutable input to evaluation, and projected render-neutrally', () => {
  const panel = contract('PANEL_DASHBOARD_TRUTH_V1');
  assert.deepEqual(panel.releaseBinding, {
    manifestId: COCKPIT_RELEASE_MANIFEST_LAW.manifestId,
    manifestRevision: COCKPIT_RELEASE_MANIFEST_LAW.manifestRevision,
    manifestSha256: COCKPIT_RELEASE_MANIFEST_LAW.manifestSha256,
    acceptedReleaseSha: COCKPIT_RELEASE_MANIFEST_LAW.acceptedReleaseSha,
    expectedManifestItemId: 'cockpit-projection:PANEL_DASHBOARD_TRUTH_V1',
  });
  assert.deepEqual(evaluate(panel, observationFixture.baseLiveObservation).releaseBinding, panel.releaseBinding);
  assert.equal(new Set(contractSet.contracts.map((entry) => entry.releaseBinding.expectedManifestItemId)).size, 25);
  const releaseBindingLawKeys = ['manifestId', 'manifestRevision', 'manifestSha256', 'acceptedReleaseSha'];
  for (const entry of contractSet.contracts) {
    assert.equal(entry.releaseBinding.expectedManifestItemId, `cockpit-projection:${entry.contractId}`);
    for (const key of releaseBindingLawKeys) {
      assert.equal(entry.releaseBinding[key], COCKPIT_RELEASE_MANIFEST_LAW[key]);
    }
  }

  const missingBinding = structuredClone(contractSet);
  delete missingBinding.contracts[0].releaseBinding;
  expectCode(() => validateCockpitContractSet(missingBinding), 'REQUIRED_PROPERTY_MISSING');

  const callerExtension = structuredClone(contractSet);
  callerExtension.contracts[0].releaseBinding.runningReleaseSha = 'c'.repeat(40);
  expectCode(() => validateCockpitContractSet(callerExtension), 'UNKNOWN_PROPERTY');

  const callerChosenManifest = structuredClone(contractSet);
  callerChosenManifest.contracts[0].releaseBinding.manifestSha256 = 'c'.repeat(64);
  expectCode(() => validateCockpitContractSet(callerChosenManifest), 'RELEASE_BINDING_LAW_MISMATCH');

  const wrongExpectedItem = structuredClone(contractSet);
  wrongExpectedItem.contracts[0].releaseBinding.expectedManifestItemId = 'cockpit-projection:PANEL_ACCOUNT_TRUTH_V1';
  expectCode(() => validateCockpitContractSet(wrongExpectedItem), 'EXPECTED_MANIFEST_ITEM_ID_MISMATCH');

  const wrongObservedItem = structuredClone(observationFixture.baseLiveObservation);
  wrongObservedItem.sourceProvenance.manifestItemId = 'cockpit-projection:PANEL_ACCOUNT_TRUTH_V1';
  const itemMismatch = evaluate(panel, wrongObservedItem);
  assert.equal(itemMismatch.displayState, 'UNKNOWN');
  assert.ok(itemMismatch.reasonCodes.includes('MANIFEST_ITEM_ID_MISMATCH'));
});

test('missing or unknown required values and invalid render labels cannot produce green', () => {
  const missing = structuredClone(observationFixture.baseLiveObservation);
  missing.values = missing.values.filter((value) => value.key !== 'rootBlocker');
  const missingOutput = evaluate(contract(missing.contractId), missing);
  assert.equal(missingOutput.displayState, 'UNKNOWN');
  assert.ok(missingOutput.reasonCodes.includes('REQUIRED_VALUE_KEY_MISSING_ROOTBLOCKER'));

  const unknown = structuredClone(observationFixture.baseLiveObservation);
  const rootBlocker = unknown.values.find((value) => value.key === 'rootBlocker');
  rootBlocker.value = null;
  rootBlocker.valueState = 'UNKNOWN';
  rootBlocker.unknownReasonCode = 'ROOT_BLOCKER_UNAVAILABLE';
  const unknownOutput = evaluate(contract(unknown.contractId), unknown);
  assert.equal(unknownOutput.displayState, 'UNKNOWN');
  assert.ok(unknownOutput.reasonCodes.includes('REQUIRED_VALUE_KEY_UNKNOWN_ROOTBLOCKER'));

  const invalidLabel = structuredClone(observationFixture.baseLiveObservation);
  invalidLabel.values.find((value) => value.key === 'renderTruthLabel').value = 'DECORATIVE_GREEN';
  expectCode(() => validatePanelObservation(invalidLabel), 'FACT_VALUE_ENUM_INVALID');
});

test('the same observation expires under the injected clock without an observation refresh', () => {
  const input = observationFixture.baseLiveObservation;
  const panel = contract(input.contractId);
  assert.equal(evaluate(panel, input).displayState, 'GREEN');
  const later = NOW + panel.greenEvidence.evidenceMaximumAgeMs + 1;
  const expired = evaluate(panel, input, later);
  assert.equal(expired.displayState, 'UNKNOWN');
  assert.ok(expired.reasonCodes.includes('EVIDENCE_EXPIRED'));
});

test('future evidence timestamps are rejected', () => {
  const input = structuredClone(observationFixture.baseLiveObservation);
  input.evidence.observedAtMs = NOW + 1;
  expectCode(() => evaluate(contract(input.contractId), input), 'EVIDENCE_TIME_IN_FUTURE');

  const impossibleCause = requestNonGreen(
    structuredClone(observationFixture.baseLiveObservation),
    'YELLOW',
    'DEGRADED_REASON_PRESENT',
    'SOURCE_STALE',
  );
  impossibleCause.stateCauseEvidence.observedAtMs = impossibleCause.evidence.observedAtMs + 1;
  expectCode(
    () => evaluate(contract(impossibleCause.contractId), impossibleCause),
    'NON_GREEN_CAUSE_EVIDENCE_TIME_INVALID',
  );
});

test('incomplete denominator partitions are rejected instead of downgraded decoratively', () => {
  const input = structuredClone(observationFixture.baseLiveObservation);
  input.denominator.expectedCount += 1;
  expectCode(() => validatePanelObservation(input), 'DENOMINATOR_INCOMPLETE');
});

test('a structurally complete 3-of-3 denominator cannot green against the 25-item release manifest', () => {
  const input = structuredClone(observationFixture.baseLiveObservation);
  input.denominator = {
    expectedCount: 3,
    visibleCount: 3,
    filteredCount: 0,
    hiddenCount: 0,
    unknownCount: 0,
  };
  input.evidence.observedCount = 3;
  assert.equal(validatePanelObservation(input), true);
  const output = evaluate(contract(input.contractId), input);
  assert.equal(output.displayState, 'UNKNOWN');
  assert.ok(output.reasonCodes.includes('EXPECTED_MANIFEST_DENOMINATOR_MISMATCH'));

  const driftedLaw = structuredClone(contractSet);
  driftedLaw.contracts[0].denominatorLaw.expectedCount = 3;
  expectCode(() => validateCockpitContractSet(driftedLaw), 'DENOMINATOR_LAW_INCOMPLETE');
});

test('unknown numeric values require a bounded reason and never become zero', () => {
  const input = structuredClone(observationFixture.baseLiveObservation);
  const exposure = input.values.find((value) => value.key === 'activeExposureCount');
  exposure.value = null;
  exposure.valueState = 'UNKNOWN';
  expectCode(() => validatePanelObservation(input), 'UNKNOWN_VALUE_DISCIPLINE');
  exposure.unknownReasonCode = 'EXPOSURE_UNAVAILABLE';
  assert.equal(validatePanelObservation(input), true);
  const output = evaluate(contract(input.contractId), input);
  const outputExposure = output.values.find((value) => value.key === 'activeExposureCount');
  assert.equal(outputExposure.value, null);
  assert.equal(outputExposure.unknownReasonCode, 'EXPOSURE_UNAVAILABLE');
});

test('NaN and infinities are rejected as non-finite evidence values', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const input = structuredClone(observationFixture.baseLiveObservation);
    input.values.find((entry) => entry.key === 'drawdown').value = value;
    expectCode(() => validatePanelObservation(input), 'FACT_VALUE_KIND_MISMATCH');
  }
});

test('GREEN requires at least one rendered value datum', () => {
  const panel = contract('PANEL_MARKETS_TRUTH_V1');
  const input = observationFor(panel);
  input.values = [];
  const output = evaluate(panel, input);
  assert.equal(output.displayState, 'UNKNOWN');
  assert.ok(output.reasonCodes.includes('GREEN_VALUE_EVIDENCE_MISSING'));
  assert.ok(output.reasonCodes.includes('DECLARED_GREEN_FORBIDDEN_EVIDENCE_INSUFFICIENT'));
});

test('orphan gauges and fake controls fail closed', () => {
  const orphan = structuredClone(contractSet);
  orphan.contracts[0].panelKind = 'GAUGE';
  orphan.contracts[0].ownerQuestion = '';
  expectCode(() => validateCockpitContractSet(orphan), 'TEXT_INVALID');

  const fake = structuredClone(contractSet);
  const fakeControl = fake.contracts.find((entry) => entry.panelKind === 'CONTROL');
  fakeControl.controlBinding.beforeAfterEvidenceRequired = false;
  expectCode(() => validateCockpitContractSet(fake), 'FAKE_CONTROL');

  const controlContract = contractSet.contracts.find((entry) => entry.panelKind === 'CONTROL');
  const observation = observationFor(controlContract);
  observation.controlState = availableControlState(controlContract, 'DECORATIVE.NO_BACKEND');
  expectCode(() => evaluate(controlContract, observation), 'FAKE_CONTROL');

  const incomplete = observationFor(controlContract, { controlAvailable: true });
  incomplete.controlState.ledgerEvidenceRef = null;
  expectCode(() => validatePanelObservation(incomplete), 'CONTROL_EVIDENCE_INCOMPLETE');

  const incompleteContract = structuredClone(contract(observationFixture.baseLiveObservation.contractId));
  incompleteContract.requiredValueKeys = [];
  expectCode(
    () => evaluate(incompleteContract, observationFixture.baseLiveObservation),
    'REQUIRED_VALUE_KEYS_MISSING',
  );
});

test('fixture-derived view model is byte-stable and can never appear live', () => {
  const input = {
    schemaVersion: 1,
    viewModelId: 'S5_FIXTURE_VIEW_MODEL_V1',
    evaluatedAtMs: NOW,
    fixtureProvenance: fixtureProvenance(),
    contractSet,
    projectionMatrix: matrix,
    observations: allObservations(contractSet),
  };
  const first = buildCockpitViewModel(input);
  const second = buildCockpitViewModel({ ...input, observations: [...input.observations].reverse() });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.surfaceCount, 18);
  assert.equal(first.panelCount, 25);
  assert.deepEqual(first.surfaces.map((surface) => surface.surfaceId), I00_SURFACE_IDS);
  for (const surface of first.surfaces) {
    assert.ok(surface.panels.every((panel) => panel.surfaceId === surface.surfaceId));
    assert.ok(surface.panels.every((panel) => panel.informationLevels.every((level) => surface.informationLevels.includes(level))));
    assert.equal(surface.factBindings.length, matrix.rows.find((row) => row.surfaceId === surface.surfaceId).factBindings.length);
    assert.ok(['CANONICAL_SURFACE', 'ACCOUNT_ALIAS'].includes(surface.routeKind));
  }
  assert.deepEqual(first.levelDefinitions, INFORMATION_LEVEL_DEFINITIONS);
  assert.deepEqual(first.fixtureProvenance, fixtureProvenance());
  assert.ok(first.surfaces.flatMap((surface) => surface.panels).every((panel) => (
    panel.displayState === 'SYNTHETIC'
      && panel.reasonCodes.includes('FIXTURE_PROVENANCE_SYNTHETIC')
  )));
  const panels = first.surfaces.flatMap((surface) => surface.panels);
  assert.ok(panels.every((panel) => panel.truthAxes.truthLabel === 'SYNTHETIC_ONLY'));
  assert.ok(panels.every((panel) => panel.truthAxes.authority === 'SYNTHETIC_TEST'));
  assert.ok(panels.every((panel) => panel.truthAxes.dataMode === 'SYNTHETIC_ONLY'));
  assert.ok(panels.every((panel) => !panel.truthAxes.releaseStatuses.includes('LIVE_PUBLIC')));
  assert.ok(panels.filter((panel) => panel.requiredValueKeys.includes('renderTruthLabel')).every((panel) => (
    panel.values.find((value) => value.key === 'renderTruthLabel')?.value === 'SYNTHETIC'
  )));
  const fixtureControls = panels.filter((panel) => panel.control !== null).map((panel) => panel.control.state);
  assert.equal(fixtureControls.length, 6);
  assert.ok(fixtureControls.every((state) => state.available === false
    && state.unavailableReasonCode === 'FIXTURE_CONTROL_UNAVAILABLE'
    && state.effectPreview === null
    && state.currentState === null
    && state.ledgerEvidenceRef === null
    && state.correlationId === null));
  assert.ok(Object.isFrozen(first));
});

test('fixture provenance cannot be upgraded by a claimed-owner input', () => {
  const input = {
    schemaVersion: 1,
    viewModelId: 'S5_FIXTURE_VIEW_MODEL_V1',
    evaluatedAtMs: NOW,
    fixtureProvenance: {
      ...fixtureProvenance(),
      truthLabel: 'LIVE_PUBLIC',
      authority: 'DERIVED_LIVE',
    },
    contractSet,
    projectionMatrix: matrix,
    observations: allObservations(contractSet),
  };
  expectCode(() => buildCockpitViewModel(input), 'FIXTURE_PROVENANCE_INVALID');
});
