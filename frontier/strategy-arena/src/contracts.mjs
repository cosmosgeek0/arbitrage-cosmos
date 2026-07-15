import {
  canonicalize,
  cloneCanonical,
  deepFreeze,
  sha256,
  validateScenarioReference,
} from '../../dock/src/index.mjs';
import {
  ALLOCATION_STATES,
  AMBIGUITY_STATES,
  ARENA_LIMITS,
  ARENA_METRICS,
  CAMPAIGN_PHASES,
  COST_FIELDS,
  DECISION_DISPOSITIONS,
  ECONOMIC_STATES,
  EXPOSURE_STATES,
  METRIC_DIRECTION,
  OUTCOME_CLASSES,
  PARTITIONS,
  SEALED_Q14_VALIDATION_AUTHORITY,
  SEALED_SCENARIO_REFERENCE_CANONICAL_HASH,
} from './constants.mjs';
import {
  booleanValue,
  boundedString,
  compareCodeUnits,
  enumValue,
  exactShape,
  fixtureClock,
  gitRefString,
  hashRecord,
  immutableGitRef,
  immutableGitRefArray,
  microsString,
  nullableString,
  record,
  safeInteger,
  sha40,
  sha256Value,
  stableSort,
  stringArray,
  validateRecordHash,
} from './validation.mjs';

const SNAPSHOT_FIELDS = Object.freeze([
  'schema',
  'version',
  'snapshotId',
  'canonicalStrategyRef',
  'canonicalStrategyHash',
  'canonicalStrategyContentSha256',
  'qExperimentAndModelRefs',
  'evidenceSnapshotRefs',
  'capitalRiskAssumptionRefs',
  'executionCostAndRecoveryRefs',
  'evaluationCampaignId',
  'evaluationPolicyVersion',
  'evaluationPolicyHash',
  'fixtureClock',
  'seed',
  'holdoutPolicyRef',
  'knownMissingInputs',
  'snapshotHash',
]);

const OUTCOME_FIELDS = Object.freeze([
  'schema',
  'version',
  'state',
  'outcomeClass',
  'ambiguityState',
  'reality',
  'ownerContractRef',
  'fixtureFactRef',
  'attributionComputed',
  'reasonCodes',
  'outcomeFactHash',
]);

const EVENT_FIELDS = Object.freeze([
  'schema',
  'version',
  'eventId',
  'sampleId',
  'qFoldId',
  'partition',
  'eventTimeMs',
  'receiveTimeMs',
  'symbol',
  'regime',
  'qSplitMembershipRef',
  'scenarioHash',
  'evidenceSnapshotRefs',
  'outcome',
  'eventContextHash',
]);

const ECONOMIC_FIELDS = Object.freeze([
  'schema',
  'version',
  'state',
  'reality',
  'valuationUnit',
  'grossOutcomeMicros',
  'costMicros',
  'fixtureNetOutcomeMicros',
  'accountingStatus',
  'ownerContractRef',
  'fixtureFactRef',
  'attributionComputed',
  'reasonCodes',
  'economicFactHash',
]);

const EXPOSURE_FIELDS = Object.freeze([
  'schema',
  'version',
  'state',
  'reality',
  'openedAtMs',
  'closedAtMs',
  'capacityUnit',
  'valuationAsset',
  'demandUnits',
  'grantedUnits',
  'allocationState',
  'ownerContractRef',
  'fixtureFactRef',
  'reasonCodes',
  'exposureFactHash',
]);

const OBSERVATION_FIELDS = Object.freeze([
  'schema',
  'version',
  'observationId',
  'strategySnapshotHash',
  'eventContextHash',
  'decisionDisposition',
  'servingPosture',
  'decisionOwnerRef',
  'decisionReasonCodes',
  'economics',
  'shadowExposure',
  'capitalContentionRefs',
  'ownerEvidenceRefs',
  'observationHash',
]);

const Q_AUTHORITY_FIELDS = Object.freeze([
  'schema',
  'version',
  'posture',
  'sourceArtifactRef',
  'validationFoldsRef',
  'validationFoldsDigest',
  'datasetDigestRef',
  'datasetDigest',
  'planStatusRef',
  'planStatus',
  'holdoutPolicyRef',
  'folds',
  'holdoutAccessState',
  'qAuthorityHash',
]);

const POLICY_FIELDS = Object.freeze([
  'schema',
  'version',
  'policyId',
  'policyVersion',
  'minimumComparableEvents',
  'maximumFalsePositiveRatePpm',
  'maximumAmbiguityRatePpm',
  'maximumRecoveryBurdenMicros',
  'maximumCapacityConstraintRatePpm',
  'demotionRequiresBreaches',
  'retirementRequiresBreaches',
  'metricOrder',
  'metricDirections',
  'policyHash',
]);

const CAMPAIGN_FIELDS = Object.freeze([
  'schema',
  'version',
  'campaignId',
  'campaignPhase',
  'evaluationPolicy',
  'fixtureClock',
  'seed',
  'qValidationAuthority',
  'strategyTrialEvidenceState',
  'strategyRecordedTrialCount',
  'strategySelectionPressureRefs',
  'selectionPressureReasonCodes',
  'strategySnapshots',
  'scenarioReferences',
  'eventContexts',
  'observations',
  'campaignHash',
]);

function snapshotRecord(input, name) {
  record(input, name);
  return deepFreeze(cloneCanonical(input));
}

function nullableMicros(value, name, options = {}) {
  if (value !== null) microsString(value, name, options);
}

function validateCostMicros(costs, state) {
  if (costs === null) {
    if (state === 'AVAILABLE') throw Object.assign(new TypeError('available economics requires cost components'), { code: 'ARENA_ECONOMICS_INCOMPLETE' });
    return;
  }
  exactShape(costs, COST_FIELDS, 'SyntheticEconomicProjectionV1.costMicros');
  for (const field of COST_FIELDS) nullableMicros(costs[field], `SyntheticEconomicProjectionV1.costMicros.${field}`, { nonNegative: true });
  if (state === 'AVAILABLE' && COST_FIELDS.some((field) => costs[field] === null)) {
    const error = new TypeError('available economics requires every cost component');
    error.code = 'ARENA_ECONOMICS_INCOMPLETE';
    throw error;
  }
}

function canonicalDecimal(value, name) {
  if (typeof value !== 'string' || value.length > 32 || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    const error = new TypeError(`${name} must be a canonical non-negative decimal string`);
    error.code = 'ARENA_DECIMAL_STRING_INVALID';
    throw error;
  }
  return value;
}

export function validateStrategySnapshot(input) {
  const value = snapshotRecord(input, 'StrategyEvaluationSnapshotV1');
  exactShape(value, SNAPSHOT_FIELDS, 'StrategyEvaluationSnapshotV1');
  if (value.schema !== 'StrategyEvaluationSnapshotV1' || value.version !== 1) throw Object.assign(new TypeError('strategy snapshot must be V1'), { code: 'ARENA_SNAPSHOT_VERSION_INVALID' });
  boundedString(value.snapshotId, 'StrategyEvaluationSnapshotV1.snapshotId', 128);
  gitRefString(value.canonicalStrategyRef, 'StrategyEvaluationSnapshotV1.canonicalStrategyRef');
  sha40(value.canonicalStrategyHash, 'StrategyEvaluationSnapshotV1.canonicalStrategyHash');
  sha256Value(value.canonicalStrategyContentSha256, 'StrategyEvaluationSnapshotV1.canonicalStrategyContentSha256');
  immutableGitRefArray(value.qExperimentAndModelRefs, 'StrategyEvaluationSnapshotV1.qExperimentAndModelRefs', { allowEmpty: true });
  immutableGitRefArray(value.evidenceSnapshotRefs, 'StrategyEvaluationSnapshotV1.evidenceSnapshotRefs');
  immutableGitRefArray(value.capitalRiskAssumptionRefs, 'StrategyEvaluationSnapshotV1.capitalRiskAssumptionRefs');
  immutableGitRefArray(value.executionCostAndRecoveryRefs, 'StrategyEvaluationSnapshotV1.executionCostAndRecoveryRefs');
  boundedString(value.evaluationCampaignId, 'StrategyEvaluationSnapshotV1.evaluationCampaignId', 128);
  boundedString(value.evaluationPolicyVersion, 'StrategyEvaluationSnapshotV1.evaluationPolicyVersion', 128);
  sha256Value(value.evaluationPolicyHash, 'StrategyEvaluationSnapshotV1.evaluationPolicyHash');
  fixtureClock(value.fixtureClock, 'StrategyEvaluationSnapshotV1.fixtureClock');
  safeInteger(value.seed, 'StrategyEvaluationSnapshotV1.seed', 0);
  immutableGitRef(value.holdoutPolicyRef, 'StrategyEvaluationSnapshotV1.holdoutPolicyRef');
  stringArray(value.knownMissingInputs, 'StrategyEvaluationSnapshotV1.knownMissingInputs', { allowEmpty: true });
  const canonicalEvidence = value.evidenceSnapshotRefs.find((reference) => reference.ref === value.canonicalStrategyRef);
  if (canonicalEvidence === undefined
    || canonicalEvidence.gitObjectSha !== value.canonicalStrategyHash
    || canonicalEvidence.contentSha256 !== value.canonicalStrategyContentSha256
    || canonicalEvidence.schemaId !== 'CanonicalStrategyTree'
    || canonicalEvidence.posture !== 'CANONICAL_SOURCE') {
    throw Object.assign(new TypeError('snapshot strategy identity must equal an immutable canonical-strategy evidence reference'), { code: 'ARENA_STRATEGY_EVIDENCE_BINDING_MISMATCH' });
  }
  validateRecordHash(value, 'snapshotHash', 'StrategyEvaluationSnapshotV1');
  return true;
}

export function createStrategySnapshot(input) {
  const value = hashRecord(input, 'snapshotHash');
  validateStrategySnapshot(value);
  return value;
}

export function validateSyntheticOutcomeProjection(input) {
  const value = snapshotRecord(input, 'SyntheticOutcomeProjectionV1');
  exactShape(value, OUTCOME_FIELDS, 'SyntheticOutcomeProjectionV1');
  if (value.schema !== 'SyntheticOutcomeProjectionV1' || value.version !== 1) throw Object.assign(new TypeError('outcome projection must be V1'), { code: 'ARENA_OUTCOME_VERSION_INVALID' });
  enumValue(value.state, ['AVAILABLE', 'UNKNOWN'], 'SyntheticOutcomeProjectionV1.state');
  enumValue(value.outcomeClass, OUTCOME_CLASSES, 'SyntheticOutcomeProjectionV1.outcomeClass');
  enumValue(value.ambiguityState, AMBIGUITY_STATES, 'SyntheticOutcomeProjectionV1.ambiguityState');
  if (value.reality !== 'HYPOTHETICAL_REPLAY') throw Object.assign(new TypeError('outcome projection must remain hypothetical'), { code: 'ARENA_REALITY_WIDENING' });
  immutableGitRef(value.ownerContractRef, 'SyntheticOutcomeProjectionV1.ownerContractRef');
  boundedString(value.fixtureFactRef, 'SyntheticOutcomeProjectionV1.fixtureFactRef');
  if (!value.fixtureFactRef.startsWith('fixture://')) throw Object.assign(new TypeError('outcome fact must be fixture-local'), { code: 'ARENA_FIXTURE_FACT_REF_INVALID' });
  if (value.attributionComputed !== false) throw Object.assign(new TypeError('F3 cannot compute outcome attribution'), { code: 'ARENA_ATTRIBUTION_AUTHORITY_FORBIDDEN' });
  stringArray(value.reasonCodes, 'SyntheticOutcomeProjectionV1.reasonCodes', { allowEmpty: value.state === 'AVAILABLE' });
  if (value.state === 'UNKNOWN' && (value.outcomeClass !== 'UNKNOWN' || value.ambiguityState !== 'UNKNOWN')) throw Object.assign(new TypeError('unknown outcome truth must remain unknown'), { code: 'ARENA_UNKNOWN_VALUE_FABRICATED' });
  if (value.state === 'AVAILABLE' && (value.outcomeClass === 'UNKNOWN' || value.ambiguityState === 'UNKNOWN')) throw Object.assign(new TypeError('available outcome truth cannot contain unknown dimensions'), { code: 'ARENA_OUTCOME_AVAILABLE_UNKNOWN' });
  validateRecordHash(value, 'outcomeFactHash', 'SyntheticOutcomeProjectionV1');
  return true;
}

export function createSyntheticOutcomeProjection(input) {
  const value = hashRecord(input, 'outcomeFactHash');
  validateSyntheticOutcomeProjection(value);
  return value;
}

export function validateEventContext(input) {
  const value = snapshotRecord(input, 'StrategyArenaEventContextV1');
  exactShape(value, EVENT_FIELDS, 'StrategyArenaEventContextV1');
  if (value.schema !== 'StrategyArenaEventContextV1' || value.version !== 1) throw Object.assign(new TypeError('event context must be V1'), { code: 'ARENA_EVENT_VERSION_INVALID' });
  for (const field of ['eventId', 'sampleId', 'qFoldId', 'symbol', 'regime']) boundedString(value[field], `StrategyArenaEventContextV1.${field}`, 128);
  enumValue(value.partition, PARTITIONS, 'StrategyArenaEventContextV1.partition');
  safeInteger(value.eventTimeMs, 'StrategyArenaEventContextV1.eventTimeMs', 1);
  safeInteger(value.receiveTimeMs, 'StrategyArenaEventContextV1.receiveTimeMs', value.eventTimeMs);
  immutableGitRef(value.qSplitMembershipRef, 'StrategyArenaEventContextV1.qSplitMembershipRef');
  sha256Value(value.scenarioHash, 'StrategyArenaEventContextV1.scenarioHash');
  immutableGitRefArray(value.evidenceSnapshotRefs, 'StrategyArenaEventContextV1.evidenceSnapshotRefs');
  validateSyntheticOutcomeProjection(value.outcome);
  validateRecordHash(value, 'eventContextHash', 'StrategyArenaEventContextV1');
  return true;
}

export function createEventContext(input) {
  const value = hashRecord(input, 'eventContextHash');
  validateEventContext(value);
  return value;
}

export function validateSyntheticEconomicProjection(input) {
  const value = snapshotRecord(input, 'SyntheticEconomicProjectionV1');
  exactShape(value, ECONOMIC_FIELDS, 'SyntheticEconomicProjectionV1');
  if (value.schema !== 'SyntheticEconomicProjectionV1' || value.version !== 1) throw Object.assign(new TypeError('economic projection must be V1'), { code: 'ARENA_ECONOMICS_VERSION_INVALID' });
  enumValue(value.state, ECONOMIC_STATES, 'SyntheticEconomicProjectionV1.state');
  if (value.reality !== 'HYPOTHETICAL_REPLAY') throw Object.assign(new TypeError('economics must remain hypothetical replay'), { code: 'ARENA_REALITY_WIDENING' });
  if (value.valuationUnit !== 'USDT_MICROS') throw Object.assign(new TypeError('economics must use one exact fixture valuation unit'), { code: 'ARENA_ECONOMIC_UNIT_INVALID' });
  nullableMicros(value.grossOutcomeMicros, 'SyntheticEconomicProjectionV1.grossOutcomeMicros');
  validateCostMicros(value.costMicros, value.state);
  nullableMicros(value.fixtureNetOutcomeMicros, 'SyntheticEconomicProjectionV1.fixtureNetOutcomeMicros');
  enumValue(value.accountingStatus, ['FIXTURE_PROVIDED', 'INCOMPLETE', 'DIVERGENT', 'NOT_APPLICABLE', 'UNAVAILABLE'], 'SyntheticEconomicProjectionV1.accountingStatus');
  immutableGitRef(value.ownerContractRef, 'SyntheticEconomicProjectionV1.ownerContractRef');
  boundedString(value.fixtureFactRef, 'SyntheticEconomicProjectionV1.fixtureFactRef');
  if (!value.fixtureFactRef.startsWith('fixture://')) throw Object.assign(new TypeError('economic fact must be fixture-local'), { code: 'ARENA_FIXTURE_FACT_REF_INVALID' });
  if (value.attributionComputed !== false) throw Object.assign(new TypeError('F3 cannot compute economic attribution'), { code: 'ARENA_ATTRIBUTION_AUTHORITY_FORBIDDEN' });
  stringArray(value.reasonCodes, 'SyntheticEconomicProjectionV1.reasonCodes', { allowEmpty: value.state === 'AVAILABLE' || value.state === 'NO_EXPOSURE' });
  if (value.state === 'AVAILABLE') {
    if (value.grossOutcomeMicros === null || value.fixtureNetOutcomeMicros === null || value.accountingStatus !== 'FIXTURE_PROVIDED') {
      throw Object.assign(new TypeError('available economics requires a complete fixture-provided projection'), { code: 'ARENA_ECONOMICS_INCOMPLETE' });
    }
    const declaredCostTotal = COST_FIELDS.reduce((total, field) => total + BigInt(value.costMicros[field]), 0n);
    if (BigInt(value.grossOutcomeMicros) - declaredCostTotal !== BigInt(value.fixtureNetOutcomeMicros)) {
      throw Object.assign(new TypeError('fixture net must equal gross minus every declared cost component'), { code: 'ARENA_ECONOMIC_IDENTITY_MISMATCH' });
    }
  } else if (value.state === 'NO_EXPOSURE') {
    if (value.grossOutcomeMicros !== null || value.costMicros !== null || value.fixtureNetOutcomeMicros !== null || value.accountingStatus !== 'NOT_APPLICABLE') {
      throw Object.assign(new TypeError('no exposure is not a fabricated zero outcome'), { code: 'ARENA_NO_EXPOSURE_ECONOMICS_INVALID' });
    }
  } else {
    if (value.reasonCodes.length === 0 || (value.accountingStatus !== 'INCOMPLETE' && value.accountingStatus !== 'DIVERGENT' && value.accountingStatus !== 'UNAVAILABLE')) {
      throw Object.assign(new TypeError('unknown economics requires explicit owner incompleteness'), { code: 'ARENA_UNKNOWN_REASON_REQUIRED' });
    }
    const supplied = [value.grossOutcomeMicros, value.fixtureNetOutcomeMicros, ...(value.costMicros === null ? [null] : COST_FIELDS.map((field) => value.costMicros[field]))];
    if (value.accountingStatus === 'INCOMPLETE' && supplied.every((entry) => entry !== null)) {
      throw Object.assign(new TypeError('incomplete economics must preserve at least one missing component'), { code: 'ARENA_ECONOMICS_INCOMPLETE_STATE_FALSE' });
    }
    if (value.accountingStatus === 'UNAVAILABLE' && (value.grossOutcomeMicros !== null || value.costMicros !== null || value.fixtureNetOutcomeMicros !== null)) {
      throw Object.assign(new TypeError('unavailable economics cannot carry fabricated component values'), { code: 'ARENA_ECONOMICS_UNAVAILABLE_VALUE_PRESENT' });
    }
  }
  validateRecordHash(value, 'economicFactHash', 'SyntheticEconomicProjectionV1');
  return true;
}

export function createSyntheticEconomicProjection(input) {
  const value = hashRecord(input, 'economicFactHash');
  validateSyntheticEconomicProjection(value);
  return value;
}

export function validateShadowExposureProjection(input) {
  const value = snapshotRecord(input, 'ShadowExposureProjectionV1');
  exactShape(value, EXPOSURE_FIELDS, 'ShadowExposureProjectionV1');
  if (value.schema !== 'ShadowExposureProjectionV1' || value.version !== 1) throw Object.assign(new TypeError('shadow exposure must be V1'), { code: 'ARENA_EXPOSURE_VERSION_INVALID' });
  enumValue(value.state, EXPOSURE_STATES, 'ShadowExposureProjectionV1.state');
  if (value.reality !== 'HYPOTHETICAL_REPLAY') throw Object.assign(new TypeError('shadow exposure must remain hypothetical'), { code: 'ARENA_REALITY_WIDENING' });
  if (value.openedAtMs !== null) safeInteger(value.openedAtMs, 'ShadowExposureProjectionV1.openedAtMs', 1);
  if (value.closedAtMs !== null) safeInteger(value.closedAtMs, 'ShadowExposureProjectionV1.closedAtMs', value.openedAtMs ?? 1);
  nullableString(value.capacityUnit, 'ShadowExposureProjectionV1.capacityUnit', 128);
  nullableString(value.valuationAsset, 'ShadowExposureProjectionV1.valuationAsset', 128);
  if (value.demandUnits !== null) safeInteger(value.demandUnits, 'ShadowExposureProjectionV1.demandUnits', 0, ARENA_LIMITS.maxCapacityUnits);
  if (value.grantedUnits !== null) safeInteger(value.grantedUnits, 'ShadowExposureProjectionV1.grantedUnits', 0, value.demandUnits ?? ARENA_LIMITS.maxCapacityUnits);
  enumValue(value.allocationState, ALLOCATION_STATES, 'ShadowExposureProjectionV1.allocationState');
  immutableGitRef(value.ownerContractRef, 'ShadowExposureProjectionV1.ownerContractRef');
  boundedString(value.fixtureFactRef, 'ShadowExposureProjectionV1.fixtureFactRef');
  if (!value.fixtureFactRef.startsWith('fixture://')) throw Object.assign(new TypeError('exposure fact must be fixture-local'), { code: 'ARENA_FIXTURE_FACT_REF_INVALID' });
  stringArray(value.reasonCodes, 'ShadowExposureProjectionV1.reasonCodes', { allowEmpty: value.state !== 'UNKNOWN' });
  if (value.state === 'SHADOW_EXPOSED') {
    if (value.openedAtMs === null || value.closedAtMs === null || value.capacityUnit !== 'FIXTURE_CAPACITY_UNITS' || value.valuationAsset !== 'USDT_MICROS' || (value.grantedUnits ?? 0) <= 0 || !['GRANTED', 'CAPPED'].includes(value.allocationState)) {
      throw Object.assign(new TypeError('shadow exposure requires an exact positive owner projection'), { code: 'ARENA_EXPOSURE_SHAPE_INVALID' });
    }
    if (value.allocationState === 'GRANTED' && value.grantedUnits !== value.demandUnits) throw Object.assign(new TypeError('granted exposure must equal declared demand'), { code: 'ARENA_CAPACITY_STATE_INVALID' });
    if (value.allocationState === 'CAPPED' && value.grantedUnits >= value.demandUnits) throw Object.assign(new TypeError('capped exposure must be below declared demand'), { code: 'ARENA_CAPACITY_STATE_INVALID' });
    if (value.closedAtMs <= value.openedAtMs) throw Object.assign(new TypeError('acted shadow exposure must have positive duration'), { code: 'ARENA_EXPOSURE_DURATION_INVALID' });
  } else if (value.state === 'NO_EXPOSURE') {
    if (value.openedAtMs !== null || value.closedAtMs !== null || value.grantedUnits !== 0 || !['BLOCKED', 'NOT_REQUESTED'].includes(value.allocationState)) {
      throw Object.assign(new TypeError('no exposure cannot carry an exposure window or grant'), { code: 'ARENA_NO_EXPOSURE_SHAPE_INVALID' });
    }
    if (value.allocationState === 'NOT_REQUESTED' && value.demandUnits !== 0) throw Object.assign(new TypeError('not-requested capacity cannot invent demand'), { code: 'ARENA_CAPACITY_STATE_INVALID' });
    if (value.allocationState === 'BLOCKED' && (value.demandUnits ?? 0) <= 0) throw Object.assign(new TypeError('blocked capacity requires declared positive demand'), { code: 'ARENA_CAPACITY_STATE_INVALID' });
  } else if (value.openedAtMs !== null || value.closedAtMs !== null || value.capacityUnit !== null || value.valuationAsset !== null || value.demandUnits !== null || value.grantedUnits !== null || value.allocationState !== 'UNKNOWN' || value.reasonCodes.length === 0) {
    throw Object.assign(new TypeError('unknown exposure must preserve null values'), { code: 'ARENA_UNKNOWN_VALUE_FABRICATED' });
  }
  validateRecordHash(value, 'exposureFactHash', 'ShadowExposureProjectionV1');
  return true;
}

export function createShadowExposureProjection(input) {
  const value = hashRecord(input, 'exposureFactHash');
  validateShadowExposureProjection(value);
  return value;
}

export function validateStrategyObservation(input) {
  const value = snapshotRecord(input, 'StrategyObservationV1');
  exactShape(value, OBSERVATION_FIELDS, 'StrategyObservationV1');
  if (value.schema !== 'StrategyObservationV1' || value.version !== 1) throw Object.assign(new TypeError('strategy observation must be V1'), { code: 'ARENA_OBSERVATION_VERSION_INVALID' });
  boundedString(value.observationId, 'StrategyObservationV1.observationId', 256);
  sha256Value(value.strategySnapshotHash, 'StrategyObservationV1.strategySnapshotHash');
  sha256Value(value.eventContextHash, 'StrategyObservationV1.eventContextHash');
  enumValue(value.decisionDisposition, DECISION_DISPOSITIONS, 'StrategyObservationV1.decisionDisposition');
  enumValue(value.servingPosture, ['ADVISORY', 'ABSTAIN_UNKNOWN'], 'StrategyObservationV1.servingPosture');
  immutableGitRef(value.decisionOwnerRef, 'StrategyObservationV1.decisionOwnerRef');
  stringArray(value.decisionReasonCodes, 'StrategyObservationV1.decisionReasonCodes');
  validateSyntheticEconomicProjection(value.economics);
  validateShadowExposureProjection(value.shadowExposure);
  stringArray(value.capitalContentionRefs, 'StrategyObservationV1.capitalContentionRefs', { allowEmpty: true });
  value.capitalContentionRefs.forEach((ref, index) => {
    if (!ref.startsWith('fixture://')) throw Object.assign(new TypeError(`capital contention ref ${index} is not fixture-local`), { code: 'ARENA_CONTENTION_REF_INVALID' });
  });
  immutableGitRefArray(value.ownerEvidenceRefs, 'StrategyObservationV1.ownerEvidenceRefs');
  if (value.decisionDisposition === 'ACTED') {
    if (value.shadowExposure.state !== 'SHADOW_EXPOSED' || value.economics.state !== 'AVAILABLE') throw Object.assign(new TypeError('acted decisions require positive shadow exposure and available owner economics'), { code: 'ARENA_ACTED_WITHOUT_EXPOSURE' });
    if (value.servingPosture !== 'ADVISORY') throw Object.assign(new TypeError('an acted fixture observation cannot claim an abstaining posture'), { code: 'ARENA_ACTED_POSTURE_INVALID' });
  } else if (value.decisionDisposition === 'DATA_INVALID') {
    if (value.servingPosture !== 'ABSTAIN_UNKNOWN' || value.shadowExposure.state !== 'UNKNOWN' || value.economics.state !== 'UNKNOWN') throw Object.assign(new TypeError('data-invalid observations must abstain unknown'), { code: 'ARENA_DATA_INVALID_SHAPE_INVALID' });
  } else if (value.shadowExposure.state !== 'NO_EXPOSURE' || value.economics.state !== 'NO_EXPOSURE') {
    throw Object.assign(new TypeError('non-acted decisions cannot carry counterfactual exposure or economics'), { code: 'ARENA_COUNTERFACTUAL_ECONOMICS_FORBIDDEN' });
  }
  if (value.shadowExposure.allocationState === 'BLOCKED' && value.decisionDisposition === 'ACTED') throw Object.assign(new TypeError('blocked capital cannot act'), { code: 'ARENA_BLOCKED_CAPITAL_ACTED' });
  validateRecordHash(value, 'observationHash', 'StrategyObservationV1');
  return true;
}

export function createStrategyObservation(input) {
  const value = hashRecord(input, 'observationHash');
  validateStrategyObservation(value);
  return value;
}

function validateFold(value, name) {
  exactShape(value, ['foldId', 'status', 'validationSampleIds', 'validationStartCutoffNs', 'validationEndCutoffNs', 'purgedCount', 'embargoedCount', 'groupConflictCount'], name);
  boundedString(value.foldId, `${name}.foldId`, 128);
  if (value.status !== 'VALID') throw Object.assign(new TypeError('F3 can consume only a Q-valid fold'), { code: 'ARENA_Q_FOLD_INVALID' });
  stringArray(value.validationSampleIds, `${name}.validationSampleIds`);
  canonicalDecimal(value.validationStartCutoffNs, `${name}.validationStartCutoffNs`);
  canonicalDecimal(value.validationEndCutoffNs, `${name}.validationEndCutoffNs`);
  if (BigInt(value.validationStartCutoffNs) > BigInt(value.validationEndCutoffNs)) throw Object.assign(new TypeError('Q fold cutoff window is inverted'), { code: 'ARENA_Q_FOLD_CUTOFF_INVALID' });
  safeInteger(value.purgedCount, `${name}.purgedCount`, 0);
  safeInteger(value.embargoedCount, `${name}.embargoedCount`, 0);
  safeInteger(value.groupConflictCount, `${name}.groupConflictCount`, 0);
}

export function validateQValidationAuthority(input) {
  const value = snapshotRecord(input, 'QValidationAuthorityProjectionV1');
  exactShape(value, Q_AUTHORITY_FIELDS, 'QValidationAuthorityProjectionV1');
  if (value.schema !== 'QValidationAuthorityProjectionV1' || value.version !== 1 || value.posture !== 'FIXTURE_CONFORMANCE_ONLY') throw Object.assign(new TypeError('Q authority projection must remain conformance-only V1'), { code: 'ARENA_Q_AUTHORITY_VERSION_INVALID' });
  immutableGitRef(value.sourceArtifactRef, 'QValidationAuthorityProjectionV1.sourceArtifactRef');
  immutableGitRef(value.validationFoldsRef, 'QValidationAuthorityProjectionV1.validationFoldsRef');
  sha256Value(value.validationFoldsDigest, 'QValidationAuthorityProjectionV1.validationFoldsDigest');
  if (value.validationFoldsRef.projectionSha256 !== value.validationFoldsDigest) throw Object.assign(new TypeError('Q validation-fold reference digest does not match the projected folds'), { code: 'ARENA_Q_FOLDS_DIGEST_MISMATCH' });
  immutableGitRef(value.datasetDigestRef, 'QValidationAuthorityProjectionV1.datasetDigestRef');
  sha256Value(value.datasetDigest, 'QValidationAuthorityProjectionV1.datasetDigest');
  immutableGitRef(value.planStatusRef, 'QValidationAuthorityProjectionV1.planStatusRef');
  if (value.planStatus !== 'VALID') throw Object.assign(new TypeError('Q plan is not valid'), { code: 'ARENA_Q_PLAN_INVALID' });
  immutableGitRef(value.holdoutPolicyRef, 'QValidationAuthorityProjectionV1.holdoutPolicyRef');
  if (!Array.isArray(value.folds) || value.folds.length === 0 || value.folds.length > 32) throw Object.assign(new TypeError('Q fold projection must be bounded and non-empty'), { code: 'ARENA_Q_FOLD_SET_INVALID' });
  value.folds.forEach((fold, index) => validateFold(fold, `QValidationAuthorityProjectionV1.folds[${index}]`));
  const foldIds = value.folds.map((fold) => fold.foldId);
  if (new Set(foldIds).size !== foldIds.length || foldIds.some((id, index) => id !== [...foldIds].sort()[index])) throw Object.assign(new TypeError('Q folds must be unique and sorted'), { code: 'ARENA_Q_FOLD_SET_INVALID' });
  const validationIds = value.folds.flatMap((fold) => fold.validationSampleIds);
  if (new Set(validationIds).size !== validationIds.length) throw Object.assign(new TypeError('Q validation membership overlaps folds'), { code: 'ARENA_Q_MEMBERSHIP_OVERLAP' });
  if (value.holdoutAccessState !== 'SEALED_REQUIRES_NEW_Q_GRANT_AND_REPLAY_BUNDLE') throw Object.assign(new TypeError('iteration authority must keep final holdout sealed'), { code: 'ARENA_HOLDOUT_ACCESS_WIDENING' });
  if (value.sourceArtifactRef.projectionSha256 !== null || value.sourceArtifactRef.ref.includes('#')) throw Object.assign(new TypeError('Q source identity must remain opaque and must not expose a projection'), { code: 'ARENA_Q_SOURCE_SCOPE_INVALID' });
  const expectedRefs = new Map([
    ['validationFoldsRef', `${value.sourceArtifactRef.ref}#/plan/folds`],
    ['datasetDigestRef', `${value.sourceArtifactRef.ref}#/datasetDigest`],
    ['planStatusRef', `${value.sourceArtifactRef.ref}#/plan/status`],
    ['holdoutPolicyRef', `${value.sourceArtifactRef.ref}#/plan/spec`],
  ]);
  for (const [field, expectedRef] of expectedRefs) {
    const reference = value[field];
    if (reference.ref !== expectedRef || reference.projectionSha256 === null) throw Object.assign(new TypeError(`${field} must pin its exact validation-safe Q14 leaf`), { code: 'ARENA_Q_SAFE_PROJECTION_REF_INVALID' });
    if (reference.gitObjectSha !== value.sourceArtifactRef.gitObjectSha || reference.contentSha256 !== value.sourceArtifactRef.contentSha256) {
      throw Object.assign(new TypeError('Q projection refs must bind the exact source artifact'), { code: 'ARENA_Q_SOURCE_ARTIFACT_MISMATCH' });
    }
  }
  for (const field of ['sourceArtifactRef', 'validationFoldsRef', 'datasetDigestRef', 'planStatusRef', 'holdoutPolicyRef']) {
    if (canonicalize(value[field]) !== canonicalize(SEALED_Q14_VALIDATION_AUTHORITY[field])) {
      throw Object.assign(new TypeError(`${field} does not equal the sealed accepted Q14 identity`), { code: 'ARENA_Q_ACCEPTED_IDENTITY_MISMATCH' });
    }
  }
  if (value.validationFoldsDigest !== SEALED_Q14_VALIDATION_AUTHORITY.validationFoldsDigest || value.datasetDigest !== SEALED_Q14_VALIDATION_AUTHORITY.datasetDigest) {
    throw Object.assign(new TypeError('Q validation authority digests do not equal the sealed accepted Q14 values'), { code: 'ARENA_Q_ACCEPTED_IDENTITY_MISMATCH' });
  }
  validateRecordHash(value, 'qAuthorityHash', 'QValidationAuthorityProjectionV1');
  return true;
}

export function createQValidationAuthority(input) {
  const copy = cloneCanonical(input);
  copy.folds = stableSort(copy.folds ?? [], (fold) => fold.foldId ?? '');
  const value = hashRecord(copy, 'qAuthorityHash');
  validateQValidationAuthority(value);
  return value;
}

function resolvedProjection(reference, resolver, name) {
  if (typeof resolver !== 'function') throw Object.assign(new TypeError('Q owner projection requires an injected read-only resolver'), { code: 'ARENA_OWNER_RESOLVER_REQUIRED' });
  const candidate = resolver(reference);
  let resolved;
  try {
    if (candidate === null || typeof candidate !== 'object') throw new TypeError('owner projection object missing');
    const projectionValue = candidate.projectionValue;
    if (projectionValue === undefined) throw new TypeError('projectionValue missing');
    resolved = deepFreeze({
      gitObjectSha: candidate.gitObjectSha,
      contentSha256: candidate.contentSha256,
      projectionSha256: candidate.projectionSha256,
      projectionValue: cloneCanonical(projectionValue),
    });
  } catch {
    throw Object.assign(new TypeError(`${name} returned an unsnapshotable owner projection`), { code: 'ARENA_Q_OWNER_PROJECTION_MISMATCH' });
  }
  if (resolved === null || typeof resolved !== 'object'
    || resolved.gitObjectSha !== reference.gitObjectSha
    || resolved.contentSha256 !== reference.contentSha256
    || resolved.projectionSha256 !== reference.projectionSha256
    || resolved.projectionValue === undefined) {
    throw Object.assign(new TypeError(`${name} did not resolve to the exact owner projection`), { code: 'ARENA_Q_OWNER_PROJECTION_MISMATCH' });
  }
  const actualProjectionSha256 = sha256(`${canonicalize(resolved.projectionValue)}\n`);
  if (actualProjectionSha256 !== reference.projectionSha256) {
    throw Object.assign(new TypeError(`${name} bytes do not match the pinned projection digest`), { code: 'ARENA_Q_OWNER_PROJECTION_DIGEST_MISMATCH' });
  }
  return resolved.projectionValue;
}

function ownerFoldProjection(value, name) {
  exactShape(value, ['embargoedCount', 'foldId', 'groupConflictCount', 'purgedCount', 'rollingTrimmedCount', 'status', 'trainSampleIds', 'validationEndCutoffNs', 'validationSampleIds', 'validationStartCutoffNs'], name);
  stringArray(value.trainSampleIds, `${name}.trainSampleIds`, { allowEmpty: true });
  safeInteger(value.rollingTrimmedCount, `${name}.rollingTrimmedCount`, 0);
  const projection = {
    foldId: value.foldId,
    status: value.status,
    validationSampleIds: value.validationSampleIds,
    validationStartCutoffNs: value.validationStartCutoffNs,
    validationEndCutoffNs: value.validationEndCutoffNs,
    purgedCount: value.purgedCount,
    embargoedCount: value.embargoedCount,
    groupConflictCount: value.groupConflictCount,
  };
  validateFold(projection, `${name}.validationProjection`);
  const trainIds = new Set(value.trainSampleIds);
  if (value.validationSampleIds.some((sampleId) => trainIds.has(sampleId))) throw Object.assign(new TypeError('Q owner fold overlaps training and validation membership'), { code: 'ARENA_Q_OWNER_FOLD_OVERLAP' });
  return projection;
}

function validateHoldoutPolicyProjection(value, foldCount) {
  exactShape(value, ['embargoNs', 'foldCount', 'holdoutFraction', 'maxFeatureLookbackNs', 'maxLabelHorizonNs', 'minTrainSize', 'rollingTrainSize', 'scheme'], 'Q holdout policy');
  for (const field of ['embargoNs', 'maxFeatureLookbackNs', 'maxLabelHorizonNs']) canonicalDecimal(value[field], `Q holdout policy.${field}`);
  safeInteger(value.foldCount, 'Q holdout policy.foldCount', 1, 32);
  safeInteger(value.minTrainSize, 'Q holdout policy.minTrainSize', 1);
  if (value.rollingTrainSize !== null) safeInteger(value.rollingTrainSize, 'Q holdout policy.rollingTrainSize', value.minTrainSize);
  if (!['EXPANDING', 'ROLLING'].includes(value.scheme)) throw Object.assign(new TypeError('Q holdout policy scheme is unsupported'), { code: 'ARENA_Q_HOLDOUT_POLICY_INVALID' });
  exactShape(value.holdoutFraction, ['denominator', 'numerator'], 'Q holdout policy.holdoutFraction');
  canonicalDecimal(value.holdoutFraction.denominator, 'Q holdout policy.holdoutFraction.denominator');
  canonicalDecimal(value.holdoutFraction.numerator, 'Q holdout policy.holdoutFraction.numerator');
  if (BigInt(value.holdoutFraction.numerator) <= 0n || BigInt(value.holdoutFraction.numerator) >= BigInt(value.holdoutFraction.denominator) || value.foldCount !== foldCount) {
    throw Object.assign(new TypeError('Q holdout policy is internally inconsistent'), { code: 'ARENA_Q_HOLDOUT_POLICY_INVALID' });
  }
}

export function validateQValidationAuthorityAgainstOwner(input, resolver) {
  const authority = deepFreeze(cloneCanonical(input));
  validateQValidationAuthority(authority);
  const ownerFolds = resolvedProjection(authority.validationFoldsRef, resolver, 'Q validation folds');
  if (!Array.isArray(ownerFolds) || ownerFolds.length === 0 || ownerFolds.length > 32) throw Object.assign(new TypeError('Q owner fold projection is invalid'), { code: 'ARENA_Q_OWNER_FOLD_SET_INVALID' });
  const projectedFolds = ownerFolds.map((fold, index) => ownerFoldProjection(fold, `Q owner folds[${index}]`));
  if (canonicalize(projectedFolds) !== canonicalize(authority.folds)) throw Object.assign(new TypeError('Q validation membership, cutoff, purge, or embargo projection drifted from the pinned owner folds'), { code: 'ARENA_Q_PLAN_SEMANTIC_MISMATCH' });
  const datasetDigest = resolvedProjection(authority.datasetDigestRef, resolver, 'Q dataset digest');
  if (datasetDigest !== authority.datasetDigest) throw Object.assign(new TypeError('Q dataset digest drifted from the pinned owner leaf'), { code: 'ARENA_Q_DATASET_SEMANTIC_MISMATCH' });
  const planStatus = resolvedProjection(authority.planStatusRef, resolver, 'Q plan status');
  if (planStatus !== authority.planStatus) throw Object.assign(new TypeError('Q plan status drifted from the pinned owner leaf'), { code: 'ARENA_Q_STATUS_SEMANTIC_MISMATCH' });
  const holdoutPolicy = resolvedProjection(authority.holdoutPolicyRef, resolver, 'Q holdout policy');
  validateHoldoutPolicyProjection(holdoutPolicy, authority.folds.length);
  return true;
}

export function validateArenaPolicy(input) {
  const value = snapshotRecord(input, 'StrategyArenaPolicyV1');
  exactShape(value, POLICY_FIELDS, 'StrategyArenaPolicyV1');
  if (value.schema !== 'StrategyArenaPolicyV1' || value.version !== 1) throw Object.assign(new TypeError('arena policy must be V1'), { code: 'ARENA_POLICY_VERSION_INVALID' });
  boundedString(value.policyId, 'StrategyArenaPolicyV1.policyId', 128);
  boundedString(value.policyVersion, 'StrategyArenaPolicyV1.policyVersion', 128);
  safeInteger(value.minimumComparableEvents, 'StrategyArenaPolicyV1.minimumComparableEvents', 1, ARENA_LIMITS.maxEvents);
  for (const field of ['maximumFalsePositiveRatePpm', 'maximumAmbiguityRatePpm', 'maximumCapacityConstraintRatePpm']) safeInteger(value[field], `StrategyArenaPolicyV1.${field}`, 0, ARENA_LIMITS.ppmScale);
  microsString(value.maximumRecoveryBurdenMicros, 'StrategyArenaPolicyV1.maximumRecoveryBurdenMicros', { nonNegative: true });
  safeInteger(value.demotionRequiresBreaches, 'StrategyArenaPolicyV1.demotionRequiresBreaches', 1, ARENA_METRICS.length);
  safeInteger(value.retirementRequiresBreaches, 'StrategyArenaPolicyV1.retirementRequiresBreaches', value.demotionRequiresBreaches, ARENA_METRICS.length);
  stringArray(value.metricOrder, 'StrategyArenaPolicyV1.metricOrder', { sorted: false });
  if (value.metricOrder.length !== ARENA_METRICS.length || new Set(value.metricOrder).size !== ARENA_METRICS.length || value.metricOrder.some((metric) => !ARENA_METRICS.includes(metric))) throw Object.assign(new TypeError('arena policy must pin each required metric exactly once'), { code: 'ARENA_METRIC_SET_INVALID' });
  exactShape(value.metricDirections, ARENA_METRICS, 'StrategyArenaPolicyV1.metricDirections');
  if (ARENA_METRICS.some((metric) => value.metricDirections[metric] !== METRIC_DIRECTION[metric])) throw Object.assign(new TypeError('arena metric directions are frozen'), { code: 'ARENA_METRIC_DIRECTION_INVALID' });
  validateRecordHash(value, 'policyHash', 'StrategyArenaPolicyV1');
  return true;
}

export function createArenaPolicy(input) {
  const value = hashRecord(input, 'policyHash');
  validateArenaPolicy(value);
  return value;
}

function validateCampaignMembership(campaign, contexts) {
  const authority = campaign.qValidationAuthority;
  const foldMap = new Map(authority.folds.map((fold) => [fold.foldId, fold]));
  for (const context of contexts) {
    if (context.partition !== 'WALK_FORWARD_VALIDATION') throw Object.assign(new TypeError('iteration cannot read final holdout'), { code: 'ARENA_HOLDOUT_OPEN_DURING_ITERATION' });
    const fold = foldMap.get(context.qFoldId);
    if (!fold?.validationSampleIds.includes(context.sampleId)) throw Object.assign(new TypeError('event is not a Q-declared validation member'), { code: 'ARENA_Q_VALIDATION_MEMBERSHIP_MISMATCH' });
    const eventTimeNs = BigInt(context.eventTimeMs) * 1_000_000n;
    if (eventTimeNs < BigInt(fold.validationStartCutoffNs) || eventTimeNs > BigInt(fold.validationEndCutoffNs)) throw Object.assign(new TypeError('event time is outside its Q-declared validation fold'), { code: 'ARENA_Q_FOLD_TIME_MISMATCH' });
  }
}

function campaignOwnerReferencesUnchecked(input) {
  const references = [
    input.qValidationAuthority.sourceArtifactRef,
    input.qValidationAuthority.validationFoldsRef,
    input.qValidationAuthority.datasetDigestRef,
    input.qValidationAuthority.planStatusRef,
    input.qValidationAuthority.holdoutPolicyRef,
    ...input.strategySelectionPressureRefs,
    ...input.strategySnapshots.flatMap((snapshot) => [
      ...snapshot.qExperimentAndModelRefs,
      ...snapshot.evidenceSnapshotRefs,
      ...snapshot.capitalRiskAssumptionRefs,
      ...snapshot.executionCostAndRecoveryRefs,
      snapshot.holdoutPolicyRef,
    ]),
    ...input.eventContexts.flatMap((context) => [context.qSplitMembershipRef, ...context.evidenceSnapshotRefs, context.outcome.ownerContractRef]),
    ...input.observations.flatMap((observation) => [
      observation.decisionOwnerRef,
      observation.economics.ownerContractRef,
      observation.shadowExposure.ownerContractRef,
      ...observation.ownerEvidenceRefs,
    ]),
  ];
  const byRef = new Map();
  for (const reference of references) {
    const prior = byRef.get(reference.ref);
    if (prior !== undefined && canonicalize(prior) !== canonicalize(reference)) throw Object.assign(new TypeError('one owner ref has conflicting immutable identities'), { code: 'ARENA_OWNER_REFERENCE_CONFLICT' });
    byRef.set(reference.ref, reference);
  }
  return [...byRef.values()].sort((left, right) => compareCodeUnits(left.ref, right.ref));
}

export function validateEvaluationCampaign(input) {
  const value = snapshotRecord(input, 'StrategyArenaCampaignV1');
  exactShape(value, CAMPAIGN_FIELDS, 'StrategyArenaCampaignV1');
  if (value.schema !== 'StrategyArenaCampaignV1' || value.version !== 1) throw Object.assign(new TypeError('campaign must be V1'), { code: 'ARENA_CAMPAIGN_VERSION_INVALID' });
  boundedString(value.campaignId, 'StrategyArenaCampaignV1.campaignId', 128);
  enumValue(value.campaignPhase, CAMPAIGN_PHASES, 'StrategyArenaCampaignV1.campaignPhase');
  validateArenaPolicy(value.evaluationPolicy);
  fixtureClock(value.fixtureClock, 'StrategyArenaCampaignV1.fixtureClock');
  safeInteger(value.seed, 'StrategyArenaCampaignV1.seed', 0);
  validateQValidationAuthority(value.qValidationAuthority);
  if (value.strategyTrialEvidenceState !== 'UNAVAILABLE_NO_Q_WHOLE_STRATEGY_TRIAL_LINKAGE' || value.strategyRecordedTrialCount !== null) throw Object.assign(new TypeError('campaign cannot claim trial counts without a Q-owned whole-strategy linkage bundle'), { code: 'ARENA_STRATEGY_TRIAL_EVIDENCE_INVALID' });
  immutableGitRefArray(value.strategySelectionPressureRefs, 'StrategyArenaCampaignV1.strategySelectionPressureRefs', { allowEmpty: true });
  if (value.strategySelectionPressureRefs.length !== 0) throw Object.assign(new TypeError('campaign cannot attach unrelated selection-pressure evidence'), { code: 'ARENA_SELECTION_PRESSURE_EVIDENCE_INVALID' });
  stringArray(value.selectionPressureReasonCodes, 'StrategyArenaCampaignV1.selectionPressureReasonCodes');
  if (canonicalize(value.selectionPressureReasonCodes) !== canonicalize(['CAMPAIGN_BOUND_Q_SELECTION_BUNDLE_MISSING'])) throw Object.assign(new TypeError('missing campaign-bound Q selection evidence must remain explicit'), { code: 'ARENA_SELECTION_PRESSURE_REASON_INVALID' });

  if (!Array.isArray(value.strategySnapshots) || value.strategySnapshots.length === 0 || value.strategySnapshots.length > ARENA_LIMITS.maxStrategies) throw Object.assign(new TypeError('strategy set is empty or exceeds the bound'), { code: 'ARENA_STRATEGY_SET_INVALID' });
  const snapshotIds = new Set();
  const snapshotHashes = new Set();
  for (const snapshot of value.strategySnapshots) {
    validateStrategySnapshot(snapshot);
    if (snapshotIds.has(snapshot.snapshotId) || snapshotHashes.has(snapshot.snapshotHash)) throw Object.assign(new TypeError('strategy identities must be unique'), { code: 'ARENA_STRATEGY_DUPLICATE' });
    snapshotIds.add(snapshot.snapshotId);
    snapshotHashes.add(snapshot.snapshotHash);
    if (snapshot.evaluationCampaignId !== value.campaignId) throw Object.assign(new TypeError('snapshot belongs to another campaign'), { code: 'ARENA_CAMPAIGN_ID_MISMATCH' });
    if (snapshot.seed !== value.seed) throw Object.assign(new TypeError('snapshot seed differs from campaign seed'), { code: 'ARENA_SEED_BINDING_MISMATCH' });
    if (snapshot.evaluationPolicyVersion !== `${value.evaluationPolicy.policyId}.${value.evaluationPolicy.policyVersion}` || snapshot.evaluationPolicyHash !== value.evaluationPolicy.policyHash) throw Object.assign(new TypeError('snapshot does not pin the exact policy'), { code: 'ARENA_POLICY_BINDING_MISMATCH' });
    if (snapshot.fixtureClock.clockId !== value.fixtureClock.clockId || snapshot.fixtureClock.evaluationCutoffMs !== value.fixtureClock.evaluationCutoffMs) throw Object.assign(new TypeError('snapshot clock differs from campaign clock'), { code: 'ARENA_FIXTURE_CLOCK_MISMATCH' });
    if (canonicalize(snapshot.holdoutPolicyRef) !== canonicalize(value.qValidationAuthority.holdoutPolicyRef)) throw Object.assign(new TypeError('snapshot holdout policy does not bind the exact validation-safe Q policy ref'), { code: 'ARENA_HOLDOUT_POLICY_MISMATCH' });
  }

  if (!Array.isArray(value.scenarioReferences) || value.scenarioReferences.length === 0 || value.scenarioReferences.length > ARENA_LIMITS.maxEvents) throw Object.assign(new TypeError('scenario reference set is empty or exceeds the bound'), { code: 'ARENA_SCENARIO_SET_INVALID' });
  const scenarioHashes = new Set();
  const scenarioIds = new Set();
  for (const scenario of value.scenarioReferences) {
    validateScenarioReference(scenario);
    if (sha256(scenario) !== SEALED_SCENARIO_REFERENCE_CANONICAL_HASH) throw Object.assign(new TypeError('prestage campaign may use only the exact sealed Dock scenario-reference exemplar'), { code: 'ARENA_SCENARIO_IDENTITY_MISMATCH' });
    if (scenarioIds.has(scenario.scenarioId) || scenarioHashes.has(scenario.scenarioHash)) throw Object.assign(new TypeError('duplicate scenario identity or hash'), { code: 'ARENA_SCENARIO_DUPLICATE' });
    scenarioIds.add(scenario.scenarioId);
    scenarioHashes.add(scenario.scenarioHash);
  }

  if (!Array.isArray(value.eventContexts) || value.eventContexts.length === 0 || value.eventContexts.length > ARENA_LIMITS.maxEvents) throw Object.assign(new TypeError('event set is empty or exceeds the bound'), { code: 'ARENA_EVENT_SET_INVALID' });
  const eventIds = new Set();
  const sampleIds = new Set();
  const contextByHash = new Map();
  for (const context of value.eventContexts) {
    validateEventContext(context);
    if (eventIds.has(context.eventId) || contextByHash.has(context.eventContextHash)) throw Object.assign(new TypeError('event identity is duplicated'), { code: 'ARENA_EVENT_CONTEXT_DUPLICATE' });
    if (sampleIds.has(context.sampleId)) throw Object.assign(new TypeError('Q validation sample is duplicated within the campaign'), { code: 'ARENA_Q_SAMPLE_DUPLICATE' });
    if (context.eventTimeMs > value.fixtureClock.evaluationCutoffMs || context.receiveTimeMs > value.fixtureClock.evaluationCutoffMs) throw Object.assign(new TypeError('event occurs after the injected cutoff'), { code: 'ARENA_POST_CUTOFF_INPUT' });
    if (!scenarioHashes.has(context.scenarioHash)) throw Object.assign(new TypeError('event scenario reference is unresolved'), { code: 'ARENA_SCENARIO_REFERENCE_UNRESOLVED' });
    if (canonicalize(context.qSplitMembershipRef) !== canonicalize(value.qValidationAuthority.validationFoldsRef)) throw Object.assign(new TypeError('event split membership is not bound to the exact campaign Q validation-fold ref'), { code: 'ARENA_Q_SPLIT_REFERENCE_MISMATCH' });
    eventIds.add(context.eventId);
    sampleIds.add(context.sampleId);
    contextByHash.set(context.eventContextHash, context);
  }
  validateCampaignMembership(value, value.eventContexts);

  if (!Array.isArray(value.observations) || value.observations.length === 0 || value.observations.length > ARENA_LIMITS.maxObservations) throw Object.assign(new TypeError('observation set is empty or exceeds the bound'), { code: 'ARENA_OBSERVATION_SET_INVALID' });
  const observationIds = new Set();
  const matrix = new Set();
  for (const observation of value.observations) {
    validateStrategyObservation(observation);
    if (observationIds.has(observation.observationId)) throw Object.assign(new TypeError('observation identity is duplicated'), { code: 'ARENA_OBSERVATION_DUPLICATE' });
    if (!snapshotHashes.has(observation.strategySnapshotHash)) throw Object.assign(new TypeError('observation strategy is outside campaign'), { code: 'ARENA_STRATEGY_REFERENCE_UNRESOLVED' });
    if (!contextByHash.has(observation.eventContextHash)) throw Object.assign(new TypeError('observation event context is outside campaign'), { code: 'ARENA_EVENT_CONTEXT_UNRESOLVED' });
    const context = contextByHash.get(observation.eventContextHash);
    const snapshot = value.strategySnapshots.find((entry) => entry.snapshotHash === observation.strategySnapshotHash);
    const observationEvidence = new Set(observation.ownerEvidenceRefs.map((reference) => canonicalize(reference)));
    for (const reference of [observation.decisionOwnerRef, observation.economics.ownerContractRef, observation.shadowExposure.ownerContractRef, context.outcome.ownerContractRef]) {
      if (!observationEvidence.has(canonicalize(reference))) throw Object.assign(new TypeError('observation owner evidence does not include every consumed owner contract'), { code: 'ARENA_OBSERVATION_OWNER_EVIDENCE_INCOMPLETE' });
    }
    const snapshotCapitalRefs = new Set([...snapshot.capitalRiskAssumptionRefs, ...snapshot.executionCostAndRecoveryRefs].map((reference) => canonicalize(reference)));
    for (const reference of [observation.economics.ownerContractRef, observation.shadowExposure.ownerContractRef]) {
      if (!snapshotCapitalRefs.has(canonicalize(reference))) throw Object.assign(new TypeError('observation economics/exposure owner differs from the frozen strategy package'), { code: 'ARENA_OBSERVATION_PACKAGE_OWNER_MISMATCH' });
    }
    if (observation.shadowExposure.state === 'SHADOW_EXPOSED' && (observation.shadowExposure.openedAtMs < context.eventTimeMs || observation.shadowExposure.closedAtMs > value.fixtureClock.evaluationCutoffMs)) throw Object.assign(new TypeError('shadow exposure window violates event time or campaign cutoff'), { code: 'ARENA_EXPOSURE_TIME_INVALID' });
    const key = `${observation.eventContextHash}|${observation.strategySnapshotHash}`;
    if (matrix.has(key)) throw Object.assign(new TypeError('event/strategy observation is duplicated'), { code: 'ARENA_EVENT_MATRIX_DUPLICATE' });
    matrix.add(key);
    observationIds.add(observation.observationId);
  }
  for (const contextHash of contextByHash.keys()) {
    for (const snapshotHash of snapshotHashes) {
      if (!matrix.has(`${contextHash}|${snapshotHash}`)) throw Object.assign(new TypeError('same-event matrix is incomplete'), { code: 'ARENA_EVENT_MATRIX_INCOMPLETE' });
    }
  }
  for (const snapshotHash of snapshotHashes) {
    const rows = value.observations.filter((observation) => observation.strategySnapshotHash === snapshotHash && observation.economics.state === 'AVAILABLE');
    const netAbsoluteTotal = rows.reduce((total, observation) => total + (BigInt(observation.economics.fixtureNetOutcomeMicros) < 0n ? -BigInt(observation.economics.fixtureNetOutcomeMicros) : BigInt(observation.economics.fixtureNetOutcomeMicros)), 0n);
    if (netAbsoluteTotal > ARENA_LIMITS.maxMicrosAbsolute) throw Object.assign(new TypeError('campaign net aggregation can exceed the exact-micros envelope'), { code: 'ARENA_CAMPAIGN_AGGREGATION_OVERFLOW' });
    for (const field of COST_FIELDS) {
      const total = rows.reduce((sum, observation) => sum + BigInt(observation.economics.costMicros[field]), 0n);
      if (total > ARENA_LIMITS.maxMicrosAbsolute) throw Object.assign(new TypeError('campaign cost aggregation can exceed the exact-micros envelope'), { code: 'ARENA_CAMPAIGN_AGGREGATION_OVERFLOW' });
    }
    const allCostTotal = rows.reduce((sum, observation) => sum + COST_FIELDS.reduce((rowTotal, field) => rowTotal + BigInt(observation.economics.costMicros[field]), 0n), 0n);
    if (allCostTotal > ARENA_LIMITS.maxMicrosAbsolute) throw Object.assign(new TypeError('campaign combined cost aggregation can exceed the exact-micros envelope'), { code: 'ARENA_CAMPAIGN_AGGREGATION_OVERFLOW' });
  }
  if (campaignOwnerReferencesUnchecked(value).length > ARENA_LIMITS.maxReferences) throw Object.assign(new TypeError('campaign-wide immutable owner reference set exceeds the report envelope'), { code: 'ARENA_CAMPAIGN_OWNER_REFERENCE_LIMIT' });
  validateRecordHash(value, 'campaignHash', 'StrategyArenaCampaignV1');
  return true;
}

export function createEvaluationCampaign(input) {
  const value = cloneCanonical(input);
  value.strategySnapshots = stableSort(value.strategySnapshots ?? [], (snapshot) => snapshot.snapshotId ?? '');
  value.scenarioReferences = stableSort(value.scenarioReferences ?? [], (scenario) => `${scenario.scenarioId ?? ''}|${scenario.scenarioVersion ?? ''}|${scenario.scenarioHash ?? ''}`);
  value.eventContexts = stableSort(value.eventContexts ?? [], (context) => context.eventId ?? '');
  value.observations = stableSort(value.observations ?? [], (observation) => `${observation.eventContextHash ?? ''}|${observation.strategySnapshotHash ?? ''}`);
  const campaign = hashRecord(value, 'campaignHash');
  validateEvaluationCampaign(campaign);
  return campaign;
}

export function collectCampaignOwnerReferences(input) {
  const campaign = cloneValidatedCampaign(input);
  return deepFreeze(campaignOwnerReferencesUnchecked(campaign));
}

export function cloneValidatedCampaign(input) {
  const campaign = deepFreeze(cloneCanonical(input));
  validateEvaluationCampaign(campaign);
  return campaign;
}
