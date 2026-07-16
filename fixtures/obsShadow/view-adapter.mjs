import { sha256CanonicalJson } from '../productAssurance/systemic/observability/canonical-sha256.mjs';

const PACKET_POSTURE = 'PORT_PRESTAGE';
const TRUTH_LABEL = 'SYNTHETIC_ONLY';
const AUTHORITY_EFFECT = 'NONE';
const MOUNT_STATE = 'NOT_MOUNTED';
const MAX_UTC_MS = 4_102_444_800_000;
const PAGING_FIXTURE_REVISION = 'OBS_PORT_SYNTHETIC_PAGING_EVIDENCE_V1';

const PAGING_INPUT_KEYS = [
  'acknowledgementEvidence',
  'correlationId',
  'deliveryEvidence',
  'incidentId',
  'receiptId',
  'routingState',
];
const PAGING_EVIDENCE_KEYS = [
  'attemptId',
  'correlationId',
  'evidenceDigest',
  'evidenceKind',
  'evidenceRef',
  'incidentId',
  'observedAtMs',
  'ownerId',
  'ownerRevision',
  'ownerVerdict',
  'reasonCodes',
  'receiptId',
  'truthLabel',
];
const PAGING_OUTPUT_KEYS = [
  'acceptanceStatus',
  'acknowledgementEvidence',
  'actionRequiredCode',
  'authorityEffect',
  'correlationId',
  'deliveryEvidence',
  'evidenceBindingState',
  'greenEligible',
  'incidentId',
  'incidentResolutionState',
  'mountState',
  'packetPosture',
  'pagingReceiptState',
  'reasonCodes',
  'receiptId',
  'routingState',
  'schemaVersion',
  'truthLabel',
];
const DRILL_SPEC_KEYS = [
  'detectorFailureDomain',
  'drillId',
  'expectedRootCauseCode',
  'expectedRunDigest',
  'expectedScenarioId',
  'expectedSimulatorRevision',
  'independentDetectorRequired',
  'recoveryProofRef',
  'requiredProofIds',
  'requiredTransitionCodes',
  'shadowCorrelationId',
  'shadowIncidentId',
  'sourceRunContentSha256',
  'sourceRunId',
  'sourceTruthLabel',
  'subjectFailureDomain',
];
const SOURCE_RUN_KEYS = [
  'completedAtMs',
  'deterministicSeed',
  'iterationsCompleted',
  'proofVerdicts',
  'rootCauseCode',
  'runDigest',
  'runId',
  'scenarioId',
  'simulatorRevision',
  'startedAtMs',
  'state',
  'transitionCodes',
];
const PROOF_KEYS = ['proofId', 'verdict'];
const DRILL_TIMELINE_KEYS = ['evidenceRef', 'occurredAtMs', 'sequence', 'stage'];
const DRILL_EXPECTED_KEYS = [
  'detectorFailureDomain',
  'independentDetectorRequired',
  'requiredProofIds',
  'requiredTransitionCodes',
  'rootCauseCode',
  'subjectFailureDomain',
];
const DRILL_OBSERVED_KEYS = [
  'completedAtMs',
  'proofVerdicts',
  'rootCauseCode',
  'startedAtMs',
  'transitionCodes',
];
const DRILL_COMPARISON_KEYS = ['failingProofIds', 'missingProofIds', 'missingTransitionCodes'];
const DRILL_OUTPUT_KEYS = [
  'acceptanceStatus',
  'actionRequiredCode',
  'authorityEffect',
  'comparison',
  'drillId',
  'drillOutcomeState',
  'expected',
  'greenEligible',
  'identityBindingState',
  'incidentLifecycleState',
  'mountState',
  'observed',
  'ownerCorrelationId',
  'ownerIncidentId',
  'packetPosture',
  'pagingReceiptState',
  'reasonCodes',
  'recoveryProofRef',
  'recoveryProofState',
  'runId',
  'scenarioId',
  'schemaVersion',
  'shadowCorrelationId',
  'shadowIncidentId',
  'sourceRunDigest',
  'sourceBindingState',
  'sourceContentSha256',
  'sourceState',
  'timeline',
  'truthLabel',
];
const EVIDENCE_VERDICTS = new Set(['PROVED', 'UNPROVEN', 'UNKNOWN', 'NOT_CONFIGURED']);
const PROOF_VERDICTS = new Set(['PASS', 'FAIL', 'UNKNOWN']);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function cloneJson(value) {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJson(child)]));
  }
  return value;
}

function keysEqual(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function nullableReference(value) {
  return value === null || nonEmptyString(value);
}

function sha256HexString(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_UTC_MS;
}

function uniqueBoundedStrings(values, maximum = 64) {
  return Array.isArray(values)
    && values.length <= maximum
    && values.every(nonEmptyString)
    && new Set(values).size === values.length;
}

function stableUnique(values) {
  return [...new Set(values)].sort();
}

function commonProjection() {
  return {
    packetPosture: PACKET_POSTURE,
    acceptanceStatus: null,
    authorityEffect: AUTHORITY_EFFECT,
    mountState: MOUNT_STATE,
    truthLabel: TRUTH_LABEL,
    greenEligible: false,
  };
}

function validateEvidence(value, expectedKind, outer) {
  const issues = [];
  if (!keysEqual(value, PAGING_EVIDENCE_KEYS)) issues.push(`${expectedKind}_SHAPE_INVALID`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return issues;
  if (value.ownerId !== 'I08_SUPERVISOR') issues.push(`${expectedKind}_OWNER_INVALID`);
  if (value.ownerRevision !== PAGING_FIXTURE_REVISION) {
    issues.push(`${expectedKind}_OWNER_REVISION_INVALID`);
  }
  if (value.evidenceKind !== expectedKind) issues.push(`${expectedKind}_KIND_INVALID`);
  if (value.receiptId !== outer?.receiptId) issues.push(`${expectedKind}_RECEIPT_BINDING_INVALID`);
  if (value.incidentId !== outer?.incidentId) issues.push(`${expectedKind}_INCIDENT_BINDING_INVALID`);
  if (value.correlationId !== outer?.correlationId) {
    issues.push(`${expectedKind}_CORRELATION_BINDING_INVALID`);
  }
  if (!nullableReference(value.attemptId)) issues.push(`${expectedKind}_ATTEMPT_ID_INVALID`);
  if (!EVIDENCE_VERDICTS.has(value.ownerVerdict)) issues.push(`${expectedKind}_VERDICT_INVALID`);
  if (!nullableReference(value.evidenceRef)) issues.push(`${expectedKind}_REFERENCE_INVALID`);
  if (!(value.evidenceDigest === null || sha256HexString(value.evidenceDigest))) {
    issues.push(`${expectedKind}_DIGEST_INVALID`);
  }
  if (!(value.observedAtMs === null || validTimestamp(value.observedAtMs))) {
    issues.push(`${expectedKind}_TIME_INVALID`);
  }
  if (!uniqueBoundedStrings(value.reasonCodes, 16)) issues.push(`${expectedKind}_REASONS_INVALID`);
  if (value.truthLabel !== TRUTH_LABEL) issues.push(`${expectedKind}_TRUTH_INVALID`);
  if (new Set([
    value.evidenceRef === null,
    value.observedAtMs === null,
    value.evidenceDigest === null,
  ]).size !== 1) {
    issues.push(`${expectedKind}_REFERENCE_TIME_DIGEST_INCOMPLETE`);
  }
  if (value.ownerVerdict === 'PROVED' && value.evidenceRef === null) {
    issues.push(`${expectedKind}_PROOF_MISSING`);
  }
  if (value.ownerVerdict === 'NOT_CONFIGURED'
    && (value.evidenceRef !== null || value.attemptId !== null)) {
    issues.push(`${expectedKind}_PROOF_FOR_NOT_CONFIGURED_ROUTE`);
  }
  if (outer?.routingState === 'CONFIGURED' && !nonEmptyString(value.attemptId)) {
    issues.push(`${expectedKind}_ATTEMPT_BINDING_MISSING`);
  }
  if (outer?.routingState === 'NOT_CONFIGURED' && value.attemptId !== null) {
    issues.push(`${expectedKind}_ATTEMPT_FOR_NOT_CONFIGURED_ROUTE`);
  }
  return issues;
}

function normalizedEvidence(value, expectedKind) {
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    receiptId: nonEmptyString(object.receiptId) ? object.receiptId : null,
    incidentId: nonEmptyString(object.incidentId) ? object.incidentId : null,
    correlationId: nonEmptyString(object.correlationId) ? object.correlationId : null,
    attemptId: nullableReference(object.attemptId) ? object.attemptId : null,
    ownerId: nonEmptyString(object.ownerId) ? object.ownerId : null,
    ownerRevision: nonEmptyString(object.ownerRevision) ? object.ownerRevision : null,
    evidenceKind: nonEmptyString(object.evidenceKind) ? object.evidenceKind : expectedKind,
    evidenceRef: nullableReference(object.evidenceRef) ? object.evidenceRef : null,
    evidenceDigest: object.evidenceDigest === null || sha256HexString(object.evidenceDigest)
      ? object.evidenceDigest
      : null,
    ownerVerdict: EVIDENCE_VERDICTS.has(object.ownerVerdict) ? object.ownerVerdict : 'UNKNOWN',
    observedAtMs: object.observedAtMs === null || validTimestamp(object.observedAtMs)
      ? object.observedAtMs
      : null,
    reasonCodes: uniqueBoundedStrings(object.reasonCodes, 16) ? [...object.reasonCodes].sort() : [],
    truthLabel: object.truthLabel === TRUTH_LABEL ? object.truthLabel : TRUTH_LABEL,
  };
}

function pagingSemanticIssues(object) {
  const issues = [];
  for (const [key, code] of [
    ['receiptId', 'PAGING_RECEIPT_ID_INVALID'],
    ['incidentId', 'PAGING_INCIDENT_ID_INVALID'],
    ['correlationId', 'PAGING_CORRELATION_ID_INVALID'],
  ]) {
    if (!nonEmptyString(object?.[key])) issues.push(code);
  }
  if (!['CONFIGURED', 'NOT_CONFIGURED'].includes(object?.routingState)) {
    issues.push('PAGING_ROUTING_STATE_INVALID');
  }
  issues.push(...validateEvidence(object?.deliveryEvidence, 'PAGING_DELIVERY_RECEIPT', object));
  issues.push(...validateEvidence(
    object?.acknowledgementEvidence,
    'PAGING_ACKNOWLEDGEMENT_RECEIPT',
    object,
  ));

  if (object?.routingState === 'NOT_CONFIGURED') {
    if (object.deliveryEvidence?.ownerVerdict !== 'NOT_CONFIGURED'
      || object.acknowledgementEvidence?.ownerVerdict !== 'NOT_CONFIGURED') {
      issues.push('PAGING_PROOF_FOR_NOT_CONFIGURED_ROUTE');
    }
  } else if (object?.routingState === 'CONFIGURED') {
    if (object.deliveryEvidence?.ownerVerdict === 'NOT_CONFIGURED'
      || object.acknowledgementEvidence?.ownerVerdict === 'NOT_CONFIGURED') {
      issues.push('PAGING_CONFIGURED_ROUTE_HAS_NOT_CONFIGURED_EVIDENCE');
    }
  }

  if (object?.acknowledgementEvidence?.ownerVerdict === 'PROVED'
    && object.deliveryEvidence?.ownerVerdict !== 'PROVED') {
    issues.push('PAGING_ACK_WITHOUT_DELIVERY');
  }
  if (object?.acknowledgementEvidence?.ownerVerdict === 'PROVED'
    && object.deliveryEvidence?.ownerVerdict === 'PROVED'
    && object.acknowledgementEvidence.observedAtMs < object.deliveryEvidence.observedAtMs) {
    issues.push('PAGING_ACK_BEFORE_DELIVERY');
  }
  if (object?.routingState === 'CONFIGURED'
    && object.deliveryEvidence?.attemptId !== object.acknowledgementEvidence?.attemptId) {
    issues.push('PAGING_ATTEMPT_BINDING_MISMATCH');
  }
  return stableUnique(issues);
}

function pagingState(input, issues) {
  if (issues.length > 0) return ['UNKNOWN', 'INSPECT_INVALID_EVIDENCE'];
  if (input.routingState === 'NOT_CONFIGURED') return ['NOT_CONFIGURED', 'CONFIGURE_ROUTE'];
  if (input.deliveryEvidence.ownerVerdict !== 'PROVED') return ['DELIVERY_UNPROVEN', 'PROVE_DELIVERY'];
  if (input.acknowledgementEvidence.ownerVerdict !== 'PROVED') {
    return ['AWAITING_ACKNOWLEDGEMENT', 'PROVE_ACKNOWLEDGEMENT'];
  }
  return ['ACKNOWLEDGED_REFERENCE_ONLY', 'OWNER_STATE_REQUIRED'];
}

export function projectPagingReceiptView(input) {
  const issues = [];
  if (!keysEqual(input, PAGING_INPUT_KEYS)) issues.push('PAGING_INPUT_SHAPE_INVALID');
  const object = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  issues.push(...pagingSemanticIssues(object));

  const reasonCodes = stableUnique(issues);
  const [projectedState, actionRequired] = pagingState(object, reasonCodes);
  return deepFreeze({
    schemaVersion: 'OBS_PORT_PAGING_RECEIPT_VIEW_V1',
    ...commonProjection(),
    receiptId: nonEmptyString(object.receiptId) ? object.receiptId : null,
    incidentId: nonEmptyString(object.incidentId) ? object.incidentId : null,
    correlationId: nonEmptyString(object.correlationId) ? object.correlationId : null,
    routingState: ['CONFIGURED', 'NOT_CONFIGURED'].includes(object.routingState)
      ? object.routingState
      : 'UNKNOWN',
    deliveryEvidence: normalizedEvidence(object.deliveryEvidence, 'PAGING_DELIVERY_RECEIPT'),
    acknowledgementEvidence: normalizedEvidence(
      object.acknowledgementEvidence,
      'PAGING_ACKNOWLEDGEMENT_RECEIPT',
    ),
    evidenceBindingState: reasonCodes.length > 0
      ? 'UNKNOWN'
      : object.routingState === 'NOT_CONFIGURED'
        ? 'NOT_CONFIGURED'
        : 'REFERENCE_BOUND_UNVERIFIED',
    pagingReceiptState: projectedState,
    incidentResolutionState: 'NOT_PROJECTED',
    actionRequiredCode: actionRequired,
    reasonCodes,
  });
}

function validateProofs(proofs) {
  if (!Array.isArray(proofs) || proofs.length === 0 || proofs.length > 64) return false;
  if (!proofs.every((proof) => keysEqual(proof, PROOF_KEYS)
    && nonEmptyString(proof.proofId)
    && PROOF_VERDICTS.has(proof.verdict))) return false;
  return new Set(proofs.map((proof) => proof.proofId)).size === proofs.length;
}

function isOrderedSubsequence(required, observed) {
  let cursor = 0;
  for (const value of observed) {
    if (value === required[cursor]) cursor += 1;
    if (cursor === required.length) return true;
  }
  return cursor === required.length;
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function validateRun(run) {
  const issues = [];
  if (!keysEqual(run, SOURCE_RUN_KEYS)) issues.push('DRILL_SOURCE_RUN_SHAPE_INVALID');
  if (!run || typeof run !== 'object' || Array.isArray(run)) return issues;
  for (const key of ['runId', 'scenarioId', 'simulatorRevision', 'rootCauseCode']) {
    if (!nonEmptyString(run[key])) issues.push(`DRILL_${key.toUpperCase()}_INVALID`);
  }
  if (!validTimestamp(run.startedAtMs) || !validTimestamp(run.completedAtMs)
    || run.completedAtMs < run.startedAtMs) issues.push('DRILL_SOURCE_TIME_INVALID');
  if (!Number.isSafeInteger(run.deterministicSeed) || run.deterministicSeed < 0) {
    issues.push('DRILL_SEED_INVALID');
  }
  if (!Number.isSafeInteger(run.iterationsCompleted) || run.iterationsCompleted <= 0) {
    issues.push('DRILL_ITERATION_COUNT_INVALID');
  }
  if (run.state !== 'COMPLETE') issues.push('DRILL_SOURCE_NOT_COMPLETE');
  if (!uniqueBoundedStrings(run.transitionCodes, 64)) issues.push('DRILL_TRANSITIONS_INVALID');
  if (!validateProofs(run.proofVerdicts)) issues.push('DRILL_PROOFS_INVALID');
  if (typeof run.runDigest !== 'string' || !/^[0-9a-f]{64}$/.test(run.runDigest)) {
    issues.push('DRILL_DIGEST_INVALID');
  }
  return issues;
}

function validateSpec(spec) {
  const issues = [];
  if (!keysEqual(spec, DRILL_SPEC_KEYS)) issues.push('DRILL_SPEC_SHAPE_INVALID');
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return issues;
  for (const key of [
    'drillId',
    'sourceRunId',
    'expectedScenarioId',
    'expectedSimulatorRevision',
    'shadowIncidentId',
    'shadowCorrelationId',
    'expectedRootCauseCode',
    'subjectFailureDomain',
    'detectorFailureDomain',
  ]) {
    if (!nonEmptyString(spec[key])) issues.push(`DRILL_SPEC_${key.toUpperCase()}_INVALID`);
  }
  if (!sha256HexString(spec.expectedRunDigest)) issues.push('DRILL_EXPECTED_RUN_DIGEST_INVALID');
  if (!sha256HexString(spec.sourceRunContentSha256)) {
    issues.push('DRILL_SOURCE_CONTENT_SHA256_INVALID');
  }
  if (spec.sourceTruthLabel !== TRUTH_LABEL) issues.push('DRILL_SOURCE_TRUTH_INVALID');
  if (!uniqueBoundedStrings(spec.requiredTransitionCodes, 32)
    || spec.requiredTransitionCodes.length === 0) issues.push('DRILL_REQUIRED_TRANSITIONS_INVALID');
  if (!uniqueBoundedStrings(spec.requiredProofIds, 32)
    || spec.requiredProofIds.length === 0) issues.push('DRILL_REQUIRED_PROOFS_INVALID');
  if (typeof spec.independentDetectorRequired !== 'boolean') {
    issues.push('DRILL_INDEPENDENCE_FLAG_INVALID');
  }
  if (!nullableReference(spec.recoveryProofRef)) issues.push('DRILL_RECOVERY_REFERENCE_INVALID');
  return issues;
}

export function projectIncidentDrillView(run, spec) {
  const structuralIssues = [...validateRun(run), ...validateSpec(spec)];
  const runObject = run && typeof run === 'object' && !Array.isArray(run) ? run : {};
  const specObject = spec && typeof spec === 'object' && !Array.isArray(spec) ? spec : {};
  if (runObject.runId !== specObject.sourceRunId) structuralIssues.push('DRILL_SOURCE_RUN_ID_MISMATCH');
  if (runObject.scenarioId !== specObject.expectedScenarioId) {
    structuralIssues.push('DRILL_SOURCE_SCENARIO_ID_MISMATCH');
  }
  if (runObject.simulatorRevision !== specObject.expectedSimulatorRevision) {
    structuralIssues.push('DRILL_SOURCE_SIMULATOR_REVISION_MISMATCH');
  }
  if (runObject.runDigest !== specObject.expectedRunDigest) {
    structuralIssues.push('DRILL_SOURCE_OWNER_DIGEST_MISMATCH');
  }
  let sourceContentSha256 = null;
  try {
    sourceContentSha256 = sha256CanonicalJson(runObject);
  } catch {
    structuralIssues.push('DRILL_SOURCE_CONTENT_NOT_CANONICAL_JSON');
  }
  if (sourceContentSha256 !== specObject.sourceRunContentSha256) {
    structuralIssues.push('DRILL_SOURCE_CONTENT_SHA256_MISMATCH');
  }
  if (specObject.independentDetectorRequired === true
    && specObject.subjectFailureDomain === specObject.detectorFailureDomain) {
    structuralIssues.push('DRILL_INDEPENDENT_FAILURE_DOMAIN_NOT_PROVEN');
  }

  const transitions = Array.isArray(runObject.transitionCodes) ? runObject.transitionCodes : [];
  const proofs = Array.isArray(runObject.proofVerdicts) ? runObject.proofVerdicts : [];
  const proofById = new Map(proofs
    .filter((proof) => proof && typeof proof === 'object' && nonEmptyString(proof.proofId))
    .map((proof) => [proof.proofId, proof.verdict]));
  const requiredTransitions = Array.isArray(specObject.requiredTransitionCodes)
    ? specObject.requiredTransitionCodes
    : [];
  const requiredProofIds = Array.isArray(specObject.requiredProofIds) ? specObject.requiredProofIds : [];
  const missingTransitionCodes = requiredTransitions.filter((code) => !transitions.includes(code)).sort();
  const missingProofIds = requiredProofIds.filter((proofId) => !proofById.has(proofId)).sort();
  const failingProofIds = requiredProofIds
    .filter((proofId) => proofById.has(proofId) && proofById.get(proofId) !== 'PASS')
    .sort();
  const comparisonIssues = [];
  if (runObject.rootCauseCode !== specObject.expectedRootCauseCode) {
    comparisonIssues.push('DRILL_ROOT_CAUSE_MISMATCH');
  }
  if (missingTransitionCodes.length > 0) comparisonIssues.push('DRILL_REQUIRED_TRANSITION_MISSING');
  if (missingTransitionCodes.length === 0
    && !isOrderedSubsequence(requiredTransitions, transitions)) {
    structuralIssues.push('DRILL_REQUIRED_TRANSITION_ORDER_INVALID');
  }
  if (missingProofIds.length > 0) comparisonIssues.push('DRILL_REQUIRED_PROOF_MISSING');
  if (failingProofIds.length > 0) comparisonIssues.push('DRILL_REQUIRED_PROOF_NOT_PASS');

  const structuralReasonCodes = stableUnique(structuralIssues);
  const reasonCodes = stableUnique([...structuralReasonCodes, ...comparisonIssues]);
  const drillOutcomeState = structuralReasonCodes.length > 0
    ? 'UNKNOWN'
    : comparisonIssues.length > 0 ? 'MISMATCH' : 'MATCH';
  const recoveryProofState = nullableReference(specObject.recoveryProofRef)
    && specObject.recoveryProofRef !== null
    ? 'REFERENCE_ONLY'
    : 'UNPROVEN';
  const actionRequired = drillOutcomeState === 'UNKNOWN'
    ? 'INSPECT_INVALID_SOURCE'
    : drillOutcomeState === 'MISMATCH'
      ? 'REVIEW_DRILL_MISMATCH'
      : recoveryProofState === 'UNPROVEN'
        ? 'PROVE_RECOVERY'
        : 'OWNER_ADJUDICATION_REQUIRED';

  return deepFreeze({
    schemaVersion: 'OBS_PORT_INCIDENT_DRILL_VIEW_V1',
    ...commonProjection(),
    drillId: nonEmptyString(specObject.drillId) ? specObject.drillId : null,
    scenarioId: nonEmptyString(runObject.scenarioId) ? runObject.scenarioId : null,
    runId: nonEmptyString(runObject.runId) ? runObject.runId : null,
    shadowIncidentId: nonEmptyString(specObject.shadowIncidentId) ? specObject.shadowIncidentId : null,
    shadowCorrelationId: nonEmptyString(specObject.shadowCorrelationId)
      ? specObject.shadowCorrelationId
      : null,
    ownerIncidentId: null,
    ownerCorrelationId: null,
    identityBindingState: 'SHADOW_FIXTURE_ONLY',
    sourceRunDigest: typeof runObject.runDigest === 'string' && /^[0-9a-f]{64}$/.test(runObject.runDigest)
      ? runObject.runDigest
      : null,
    sourceContentSha256: sha256HexString(sourceContentSha256) ? sourceContentSha256 : null,
    sourceBindingState: structuralReasonCodes.length > 0
      ? 'UNKNOWN'
      : 'VERIFIED_PACKET_CONTENT_SHA256',
    sourceState: runObject.state === 'COMPLETE' ? runObject.state : 'UNKNOWN',
    timeline: transitions.slice(0, 64).map((stage, sequence) => ({
      sequence,
      stage: nonEmptyString(stage) ? stage : 'UNKNOWN',
      occurredAtMs: null,
      evidenceRef: null,
    })),
    expected: {
      rootCauseCode: nonEmptyString(specObject.expectedRootCauseCode)
        ? specObject.expectedRootCauseCode
        : null,
      requiredTransitionCodes: uniqueBoundedStrings(requiredTransitions, 32)
        ? [...requiredTransitions]
        : [],
      requiredProofIds: uniqueBoundedStrings(requiredProofIds, 32) ? [...requiredProofIds].sort() : [],
      independentDetectorRequired: specObject.independentDetectorRequired === true,
      subjectFailureDomain: nonEmptyString(specObject.subjectFailureDomain)
        ? specObject.subjectFailureDomain
        : null,
      detectorFailureDomain: nonEmptyString(specObject.detectorFailureDomain)
        ? specObject.detectorFailureDomain
        : null,
    },
    observed: {
      rootCauseCode: nonEmptyString(runObject.rootCauseCode) ? runObject.rootCauseCode : null,
      transitionCodes: uniqueBoundedStrings(transitions, 64) ? [...transitions] : [],
      proofVerdicts: validateProofs(proofs) ? cloneJson(proofs) : [],
      startedAtMs: validTimestamp(runObject.startedAtMs) ? runObject.startedAtMs : null,
      completedAtMs: validTimestamp(runObject.completedAtMs) ? runObject.completedAtMs : null,
    },
    comparison: {
      missingTransitionCodes,
      missingProofIds,
      failingProofIds,
    },
    drillOutcomeState,
    incidentLifecycleState: 'NOT_PROJECTED',
    pagingReceiptState: 'NOT_PROJECTED',
    recoveryProofRef: nullableReference(specObject.recoveryProofRef) ? specObject.recoveryProofRef : null,
    recoveryProofState,
    actionRequiredCode: actionRequired,
    reasonCodes,
  });
}

export function validateObsPortView(view, sourceContext) {
  const issues = [];
  if (!view || typeof view !== 'object' || Array.isArray(view)) return ['VIEW_OBJECT_REQUIRED'];
  if (view.schemaVersion === 'OBS_PORT_PAGING_RECEIPT_VIEW_V1') {
    if (!keysEqual(view, PAGING_OUTPUT_KEYS)) issues.push('VIEW_SHAPE_INVALID');
    const semanticIssues = pagingSemanticIssues(view);
    const evidenceIssues = semanticIssues.filter((code) => (
      code.startsWith('PAGING_DELIVERY_RECEIPT_')
      || code.startsWith('PAGING_ACKNOWLEDGEMENT_RECEIPT_')
    ));
    if (evidenceIssues.length > 0) issues.push('VIEW_PAGING_EVIDENCE_INVALID');
    if (![
      'UNKNOWN',
      'NOT_CONFIGURED',
      'DELIVERY_UNPROVEN',
      'AWAITING_ACKNOWLEDGEMENT',
      'ACKNOWLEDGED_REFERENCE_ONLY',
    ].includes(view.pagingReceiptState)) issues.push('VIEW_PAGING_STATE_INVALID');
    if (!['UNKNOWN', 'NOT_CONFIGURED', 'REFERENCE_BOUND_UNVERIFIED'].includes(
      view.evidenceBindingState,
    )) issues.push('VIEW_PAGING_BINDING_STATE_INVALID');
    if (view.incidentResolutionState !== 'NOT_PROJECTED') {
      issues.push('VIEW_PAGING_RESOLUTION_ESCALATION');
    }
    if (!uniqueBoundedStrings(view.reasonCodes, 64)) issues.push('VIEW_REASON_CODES_INVALID');
    if (semanticIssues.some((code) => !view.reasonCodes?.includes(code))) {
      issues.push('VIEW_PAGING_REASON_CODES_INCOMPLETE');
    }
    const effectiveIssues = stableUnique([
      ...semanticIssues,
      ...(Array.isArray(view.reasonCodes) ? view.reasonCodes : []),
    ]);
    const [expectedState, expectedAction] = pagingState(
      view,
      effectiveIssues,
    );
    if (view.pagingReceiptState !== expectedState || view.actionRequiredCode !== expectedAction) {
      issues.push('VIEW_PAGING_STATE_ACTION_INCONSISTENT');
    }
    const expectedBinding = effectiveIssues.length > 0
      ? 'UNKNOWN'
      : view.routingState === 'NOT_CONFIGURED'
        ? 'NOT_CONFIGURED'
        : 'REFERENCE_BOUND_UNVERIFIED';
    if (view.evidenceBindingState !== expectedBinding) {
      issues.push('VIEW_PAGING_BINDING_STATE_INCONSISTENT');
    }
    if (sourceContext === undefined) issues.push('VIEW_SOURCE_CONTEXT_REQUIRED');
    else if (JSON.stringify(view) !== JSON.stringify(projectPagingReceiptView(sourceContext))) {
      issues.push('VIEW_PAGING_SOURCE_PROJECTION_MISMATCH');
    }
  } else if (view.schemaVersion === 'OBS_PORT_INCIDENT_DRILL_VIEW_V1') {
    if (!keysEqual(view, DRILL_OUTPUT_KEYS)) issues.push('VIEW_SHAPE_INVALID');
    if (!keysEqual(view.expected, DRILL_EXPECTED_KEYS)
      || !keysEqual(view.observed, DRILL_OBSERVED_KEYS)
      || !keysEqual(view.comparison, DRILL_COMPARISON_KEYS)) {
      issues.push('VIEW_DRILL_NESTED_SHAPE_INVALID');
    }
    if (!Array.isArray(view.timeline) || view.timeline.length > 64
      || !view.timeline.every((entry, index) => keysEqual(entry, DRILL_TIMELINE_KEYS)
        && entry.sequence === index
        && nonEmptyString(entry.stage)
        && entry.occurredAtMs === null
        && entry.evidenceRef === null)) issues.push('VIEW_DRILL_TIMELINE_INVALID');
    if (!view.expected || !uniqueBoundedStrings(view.expected.requiredTransitionCodes, 32)
      || !uniqueBoundedStrings(view.expected.requiredProofIds, 32)
      || typeof view.expected.independentDetectorRequired !== 'boolean'
      || !nullableReference(view.expected.rootCauseCode)
      || !nullableReference(view.expected.subjectFailureDomain)
      || !nullableReference(view.expected.detectorFailureDomain)) {
      issues.push('VIEW_DRILL_EXPECTATIONS_INVALID');
    }
    const observedTimesValid = validTimestamp(view.observed?.startedAtMs)
      && validTimestamp(view.observed?.completedAtMs)
      && view.observed.completedAtMs >= view.observed.startedAtMs;
    const observedTimesUnknown = view.observed?.startedAtMs === null
      && view.observed?.completedAtMs === null;
    if (!view.observed || !uniqueBoundedStrings(view.observed.transitionCodes, 64)
      || !(validateProofs(view.observed.proofVerdicts)
        || (Array.isArray(view.observed.proofVerdicts) && view.observed.proofVerdicts.length === 0))
      || !nullableReference(view.observed.rootCauseCode)
      || (!observedTimesValid && !observedTimesUnknown)) issues.push('VIEW_DRILL_OBSERVED_INVALID');
    if (!view.comparison
      || !uniqueBoundedStrings(view.comparison.missingTransitionCodes, 32)
      || !uniqueBoundedStrings(view.comparison.missingProofIds, 32)
      || !uniqueBoundedStrings(view.comparison.failingProofIds, 32)) {
      issues.push('VIEW_DRILL_COMPARISON_INVALID');
    }
    if (!['MATCH', 'MISMATCH', 'UNKNOWN'].includes(view.drillOutcomeState)) {
      issues.push('VIEW_DRILL_STATE_INVALID');
    }
    if (!['VERIFIED_PACKET_CONTENT_SHA256', 'UNKNOWN'].includes(view.sourceBindingState)
      || !(sha256HexString(view.sourceContentSha256) || view.sourceContentSha256 === null)
      || !(sha256HexString(view.sourceRunDigest) || view.sourceRunDigest === null)) {
      issues.push('VIEW_DRILL_SOURCE_BINDING_INVALID');
    }
    if (!['COMPLETE', 'UNKNOWN'].includes(view.sourceState)) issues.push('VIEW_DRILL_SOURCE_STATE_INVALID');
    if (view.identityBindingState !== 'SHADOW_FIXTURE_ONLY'
      || view.ownerIncidentId !== null
      || view.ownerCorrelationId !== null) issues.push('VIEW_DRILL_IDENTITY_ESCALATION');
    if (![view.drillId, view.scenarioId, view.runId, view.shadowIncidentId, view.shadowCorrelationId]
      .every(nullableReference)) issues.push('VIEW_DRILL_IDENTITIES_INVALID');
    if (view.incidentLifecycleState !== 'NOT_PROJECTED'
      || view.pagingReceiptState !== 'NOT_PROJECTED') issues.push('VIEW_DRILL_OWNER_STATE_ESCALATION');
    if (!nullableReference(view.recoveryProofRef)) issues.push('VIEW_DRILL_RECOVERY_REFERENCE_INVALID');

    const requiredTransitions = Array.isArray(view.expected?.requiredTransitionCodes)
      ? view.expected.requiredTransitionCodes
      : [];
    const requiredProofIds = Array.isArray(view.expected?.requiredProofIds)
      ? view.expected.requiredProofIds
      : [];
    const observedTransitions = Array.isArray(view.observed?.transitionCodes)
      ? view.observed.transitionCodes
      : [];
    const observedProofs = Array.isArray(view.observed?.proofVerdicts)
      ? view.observed.proofVerdicts
      : [];
    const proofById = new Map(observedProofs
      .filter((proof) => proof && typeof proof === 'object' && nonEmptyString(proof.proofId))
      .map((proof) => [proof.proofId, proof.verdict]));
    const missingTransitionCodes = requiredTransitions
      .filter((code) => !observedTransitions.includes(code)).sort();
    const missingProofIds = requiredProofIds.filter((proofId) => !proofById.has(proofId)).sort();
    const failingProofIds = requiredProofIds
      .filter((proofId) => proofById.has(proofId) && proofById.get(proofId) !== 'PASS').sort();
    if (!sameStrings(view.comparison?.missingTransitionCodes, missingTransitionCodes)
      || !sameStrings(view.comparison?.missingProofIds, missingProofIds)
      || !sameStrings(view.comparison?.failingProofIds, failingProofIds)) {
      issues.push('VIEW_DRILL_COMPARISON_INCONSISTENT');
    }
    if (!sameStrings(
      Array.isArray(view.timeline) ? view.timeline.map((entry) => entry.stage) : [],
      observedTransitions,
    )) issues.push('VIEW_DRILL_TIMELINE_OBSERVED_MISMATCH');

    const rootCauseMismatch = view.expected?.rootCauseCode !== view.observed?.rootCauseCode;
    const orderInvalid = missingTransitionCodes.length === 0
      && !isOrderedSubsequence(requiredTransitions, observedTransitions);
    const domainInvalid = view.expected?.independentDetectorRequired === true
      && view.expected?.subjectFailureDomain === view.expected?.detectorFailureDomain;
    const recomputedCodes = [];
    if (rootCauseMismatch) recomputedCodes.push('DRILL_ROOT_CAUSE_MISMATCH');
    if (missingTransitionCodes.length > 0) recomputedCodes.push('DRILL_REQUIRED_TRANSITION_MISSING');
    if (orderInvalid) recomputedCodes.push('DRILL_REQUIRED_TRANSITION_ORDER_INVALID');
    if (missingProofIds.length > 0) recomputedCodes.push('DRILL_REQUIRED_PROOF_MISSING');
    if (failingProofIds.length > 0) recomputedCodes.push('DRILL_REQUIRED_PROOF_NOT_PASS');
    if (domainInvalid) recomputedCodes.push('DRILL_INDEPENDENT_FAILURE_DOMAIN_NOT_PROVEN');
    if (recomputedCodes.some((code) => !view.reasonCodes?.includes(code))) {
      issues.push('VIEW_DRILL_REASON_CODES_INCOMPLETE');
    }

    const comparisonCodes = new Set([
      'DRILL_ROOT_CAUSE_MISMATCH',
      'DRILL_REQUIRED_TRANSITION_MISSING',
      'DRILL_REQUIRED_PROOF_MISSING',
      'DRILL_REQUIRED_PROOF_NOT_PASS',
    ]);
    const structuralReasonCodes = Array.isArray(view.reasonCodes)
      ? view.reasonCodes.filter((code) => !comparisonCodes.has(code))
      : [];
    if ((view.sourceBindingState === 'VERIFIED_PACKET_CONTENT_SHA256'
        && structuralReasonCodes.length > 0)
      || (view.sourceBindingState === 'UNKNOWN' && structuralReasonCodes.length === 0)) {
      issues.push('VIEW_DRILL_SOURCE_REASON_BINDING_INCONSISTENT');
    }
    if (view.sourceBindingState === 'VERIFIED_PACKET_CONTENT_SHA256'
      && (!nonEmptyString(view.drillId)
        || !nonEmptyString(view.scenarioId)
        || !nonEmptyString(view.runId)
        || !nonEmptyString(view.shadowIncidentId)
        || !nonEmptyString(view.shadowCorrelationId)
        || !nonEmptyString(view.expected?.rootCauseCode)
        || !nonEmptyString(view.expected?.subjectFailureDomain)
        || !nonEmptyString(view.expected?.detectorFailureDomain)
        || view.expected.requiredTransitionCodes.length === 0
        || view.expected.requiredProofIds.length === 0
        || !nonEmptyString(view.observed?.rootCauseCode)
        || view.observed.transitionCodes.length === 0
        || !validateProofs(view.observed.proofVerdicts)
        || !observedTimesValid
        || !sha256HexString(view.sourceContentSha256)
        || !sha256HexString(view.sourceRunDigest))) {
      issues.push('VIEW_DRILL_VERIFIED_SOURCE_INCOMPLETE');
    }

    const sourceInvalid = view.sourceBindingState !== 'VERIFIED_PACKET_CONTENT_SHA256'
      || view.sourceState !== 'COMPLETE'
      || structuralReasonCodes.length > 0
      || orderInvalid
      || domainInvalid;
    const expectedOutcome = sourceInvalid
      ? 'UNKNOWN'
      : rootCauseMismatch || missingTransitionCodes.length > 0
        || missingProofIds.length > 0 || failingProofIds.length > 0
        ? 'MISMATCH'
        : 'MATCH';
    if (view.drillOutcomeState !== expectedOutcome) {
      issues.push('VIEW_DRILL_OUTCOME_INCONSISTENT');
    }

    const recoveryState = view.recoveryProofRef === null ? 'UNPROVEN' : 'REFERENCE_ONLY';
    const expectedAction = view.drillOutcomeState === 'UNKNOWN'
      ? 'INSPECT_INVALID_SOURCE'
      : view.drillOutcomeState === 'MISMATCH'
        ? 'REVIEW_DRILL_MISMATCH'
        : recoveryState === 'UNPROVEN'
          ? 'PROVE_RECOVERY'
          : 'OWNER_ADJUDICATION_REQUIRED';
    if (view.recoveryProofState !== recoveryState || view.actionRequiredCode !== expectedAction) {
      issues.push('VIEW_DRILL_STATE_ACTION_INCONSISTENT');
    }
    if (!uniqueBoundedStrings(view.reasonCodes, 64)) issues.push('VIEW_REASON_CODES_INVALID');
    if (!sourceContext || typeof sourceContext !== 'object'
      || !Object.hasOwn(sourceContext, 'run') || !Object.hasOwn(sourceContext, 'spec')) {
      issues.push('VIEW_SOURCE_CONTEXT_REQUIRED');
    } else if (JSON.stringify(view) !== JSON.stringify(
      projectIncidentDrillView(sourceContext.run, sourceContext.spec),
    )) issues.push('VIEW_DRILL_SOURCE_PROJECTION_MISMATCH');
  } else issues.push('VIEW_SCHEMA_UNKNOWN');
  if (view.packetPosture !== PACKET_POSTURE) issues.push('VIEW_POSTURE_INVALID');
  if (view.acceptanceStatus !== null) issues.push('VIEW_ACCEPTANCE_ESCALATION');
  if (view.authorityEffect !== AUTHORITY_EFFECT) issues.push('VIEW_AUTHORITY_ESCALATION');
  if (view.mountState !== MOUNT_STATE) issues.push('VIEW_MOUNT_ESCALATION');
  if (view.truthLabel !== TRUTH_LABEL) issues.push('VIEW_TRUTH_ESCALATION');
  if (view.greenEligible !== false) issues.push('VIEW_GREEN_ESCALATION');
  return stableUnique(issues);
}
