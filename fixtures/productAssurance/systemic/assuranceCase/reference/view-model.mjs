import {
  ACCEPTED_S1_ASSUMPTION_IDS,
  ACCEPTED_S1_ASSUMPTION_OWNERS,
  ASSURANCE_DERIVED_REASON_CODES,
  ASSURANCE_CASE_PROPAGATION_POLICY,
  ASSURANCE_CASE_EVALUATION_VERSION,
  ASSURANCE_CASE_VIEW_MODEL_VERSION,
  ASSURANCE_RESULTS,
  COCKPIT_SURFACES,
  DIAGNOSTIC_EVIDENCE_REQUIREMENTS,
  DIAGNOSTIC_POSTURES,
  EVIDENCE_KINDS,
  EVIDENCE_PURPOSES,
  EVIDENCE_ROLES,
  FAILURE_DOMAIN_CLASSES,
  INDEPENDENCE_CLASSES,
  INDEPENDENCE_REQUIRED_FAILURE_DOMAIN_CLASSES,
  MANDATORY_CLAIM_DRILL_DOWN,
  MANDATORY_CLAIM_REQUIREMENTS,
  MANDATORY_CLAIM_VALIDATOR,
  PROHIBITED_ASSURANCE_COMMANDS,
  REQUIRED_MANDATORY_CLAIM_IDS,
  REQUIRED_ROOT_CLAIM_IDS,
  SAFE_EVENT_RECOMMENDATION_TYPE,
  SAFE_INCIDENT_RECOMMENDATION_TYPE,
  SCHEMA_LIMITS,
  UNSAFE_ASSURANCE_TEXT_PATTERN,
  capturePlainData,
  canonicalEvidenceStatement,
  compareCanonical,
  deepFreeze,
  isValidUtcMillis,
  stableUnique,
} from '../contracts/index.mjs';

const ROOT_FIELDS = Object.freeze([
  'schemaVersion', 'evaluatedAtMs', 'status', 'truthLabel', 'authorityEffect',
  'runtimeProjectionOwner', 'machineResponseOwner', 'reasonCodes', 'packetIssues',
  's1ProjectionIssues', 'mandatoryCoverage', 'evidenceResults', 'assumptionResults',
  'claimResults', 'invalidationPaths', 'invalidationTruncated', 'recommendations',
  'diagnosticPlane', 'recomputation', 'safetyBoundary',
]);
const CLAIM_FIELDS = Object.freeze([
  'claimId', 'requirementKey', 'statement', 'scope', 'capitalCritical', 'validator',
  'result', 'reasonCodes', 'subclaimIds', 'assumptionIds', 'appliedAssumptionIds',
  'supportingEvidenceIds', 'counterEvidenceIds', 'invalidatingEvidenceIds',
  'invalidatingAssumptionIds', 'invalidatingSubclaimIds', 'invalidatedAtMs',
  'propagationSloMs', 'assuranceSloMs', 'canonicalOwner', 'resultConsumerOwner',
  'invariantProjection', 'cockpitProjection', 'componentResults',
  'supportUsableForNewAction',
]);
const EVIDENCE_FIELDS = Object.freeze([
  'evidenceId', 'role', 'purpose', 'kind', 'statement', 'claimBinding', 'capitalCritical',
  'declaredResult', 'result', 'reasonCodes', 'sourceIdentity', 'validator',
  'producerId', 'producerOwnerId', 'producerFailureDomains', 'verifierId',
  'verifierOwnerId', 'verifierFailureDomains', 'independenceStatus',
  'independenceClass', 'independenceBasisEvidenceIds', 'sharedFailureDomains',
  'commonModeDependencyIds', 'requiredFailureDomainClasses',
  'missingProducerFailureDomainClasses', 'missingVerifierFailureDomainClasses',
  'derivedFromClaimIds', 'derivedFromEvidenceIds', 'certifiesEvidenceIds',
  'freshnessStatus', 'createdAtMs', 'lastVerifiedAtMs', 'expiresAtMs',
  'maximumAgeMs', 'ageMs', 'invalidAtMs', 'localInvalidatedAtMs',
  'invalidatedAtMs', 'primitiveInvalidator', 'supportUsableForNewAction',
]);
const ASSUMPTION_FIELDS = Object.freeze([
  'assumptionId', 'sourceOwnerId', 'declaredResult', 'result', 'reasonCodes',
  'freshnessStatus', 'sourceEvaluatedAtMs', 'staleAtMs', 'ageMs',
  'invalidatedAtMs', 'supportUsableForNewAction',
]);
const DIAGNOSTIC_PLANE_FIELDS = Object.freeze([
  'posture', 'status', 'reasonCodes',
  ...Object.keys(DIAGNOSTIC_EVIDENCE_REQUIREMENTS),
]);
const PATH_FIELDS = Object.freeze([
  'originType', 'originId', 'originResult', 'originAgeMs', 'originFreshnessStatus',
  'originInvalidAtMs', 'dependentClaimId', 'dependentResult', 'path', 'observedAtMs',
  'projectionDueAtMs', 'propagationSloMs', 'propagationSloMet', 'ownerId',
  'supportUsableForNewAction',
]);
const FRESHNESS_STATUSES = Object.freeze([
  'CURRENT', 'EXPIRED', 'NOT_YET_VALID', 'INCOHERENT', 'INVALID_TIMELINE',
  'CLOCK_INVALID', 'EVIDENCE_MISSING',
]);
const EVIDENCE_DERIVED_REASON_CODES = ASSURANCE_DERIVED_REASON_CODES;
const ADVERSE_PASS_SOURCE_REASON = /(?:FAIL|UNKNOWN|EXPIRED|MISSING|INVALID|INCOHERENT|NOT_YET|COMMON_MODE|UNPROVEN|CONTRADICT|BLOCKED|UNAVAILABLE|COUNTEREVIDENCE_(?:CONFIRMED|PRESENT|DETECTED)|MISSING_SIGNAL_CONFIRMED)/i;
const NON_FATAL_PACKET_ISSUES = Object.freeze([
  'CLAIM_EVIDENCE_REFERENCE_UNKNOWN',
  'DIAGNOSTIC_REQUIRED_FAMILY_MISSING',
  'DIAGNOSTIC_EVIDENCE_REFERENCE_UNKNOWN',
  'DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM',
]);
const DIAGNOSTIC_PURPOSES = Object.freeze([
  'DIAGNOSTIC_POSTURE',
  'DIAGNOSTIC_CONTAINMENT',
  'DIAGNOSTIC_PERMISSION',
  'DIAGNOSTIC_PROVIDER_OUTAGE',
  'DIAGNOSTIC_PRIVACY',
  'DIAGNOSTIC_INDEPENDENCE',
]);
const DIAGNOSTIC_KIND_BY_PURPOSE = Object.freeze({
  DIAGNOSTIC_POSTURE: 'DIAGNOSTIC_POSTURE_READBACK',
  DIAGNOSTIC_CONTAINMENT: 'DIAGNOSTIC_CONTAINMENT_TEST',
  DIAGNOSTIC_PERMISSION: 'DIAGNOSTIC_PERMISSION_READBACK',
  DIAGNOSTIC_PROVIDER_OUTAGE: 'DIAGNOSTIC_PROVIDER_OUTAGE_EXERCISE',
  DIAGNOSTIC_PRIVACY: 'DIAGNOSTIC_PRIVACY_REVIEW',
  DIAGNOSTIC_INDEPENDENCE: 'DIAGNOSTIC_INDEPENDENCE_CHECK',
});
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const DIGEST_PATTERN = /^(?:sha256:[0-9a-f]{64}|fixture:[A-Za-z0-9._:/-]+)$/;
const SOURCE_REASON_PATTERN = /^SOURCE_(?:PASS|FAIL|UNKNOWN)_[A-Z0-9][A-Z0-9_]*$/;
const EVALUATION_CAPTURE_LIMITS = Object.freeze({
  maxNodes: (
    8_192
    + SCHEMA_LIMITS.maxInvalidationPaths * (SCHEMA_LIMITS.maxInvalidationPathLength + 64)
    + SCHEMA_LIMITS.maxEvidence * (
      SCHEMA_LIMITS.maxEdgesPerNode * 4
      + SCHEMA_LIMITS.maxReasonCodes
      + SCHEMA_LIMITS.maxFailureDomainsPerLeg * 8
      + 256
    )
    + REQUIRED_MANDATORY_CLAIM_IDS.length * (
      SCHEMA_LIMITS.maxEdgesPerNode * (SCHEMA_LIMITS.maxEdgesPerNode * 2 + 16)
      + 512
    )
  ),
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactObject = (value, fields) => (
  isObject(value)
  && Object.keys(value).length === fields.length
  && fields.every((field) => Object.hasOwn(value, field))
);
const isText = (value) => typeof value === 'string' && value.length > 0 && value.length <= SCHEMA_LIMITS.maxLongTextLength;
const isId = (value) => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= SCHEMA_LIMITS.maxIdLength
  && ID_PATTERN.test(value)
);
const isUniqueIdArray = (value, maximum = SCHEMA_LIMITS.maxReasonCodes) => (
  Array.isArray(value)
  && value.length <= maximum
  && value.every(isId)
  && new Set(value).size === value.length
);
const isCanonicalIdArray = (value, maximum = SCHEMA_LIMITS.maxReasonCodes) => {
  if (!isUniqueIdArray(value, maximum)) return false;
  const canonical = stableUnique(value);
  return value.every((entry, position) => entry === canonical[position]);
};
const sameIds = (left, right) => {
  if (!isUniqueIdArray(left, 2_048) || !isUniqueIdArray(right, 2_048) || left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((entry, position) => entry === sortedRight[position]);
};
const nullableUtc = (value) => value === null || isValidUtcMillis(value);
const nullableNonNegativeInteger = (value) => value === null || (Number.isSafeInteger(value) && value >= 0);
const boundedPositiveInteger = (value) => Number.isSafeInteger(value) && value >= 1 && value <= SCHEMA_LIMITS.maxSloMs;
const boundedTtlInteger = (value) => Number.isSafeInteger(value) && value >= 1 && value <= SCHEMA_LIMITS.maxTtlMs;
const resultValid = (value) => ASSURANCE_RESULTS.includes(value);
const statusFrom = (statuses) => {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
};
const minimumUtcMillis = (values) => {
  const valid = values.filter(isValidUtcMillis);
  return valid.length === 0 ? null : Math.min(...valid);
};
const nullableEqual = (left, right) => left === right;
const allUnique = (values) => new Set(values).size === values.length;
const domainIdentity = (domain) => `${domain.class}:${domain.id}`;
const validatorIdentity = (validator) => `${validator.validatorId}:${validator.version}`;
const basisCertifiedSemanticsDistinct = (basis, certified) => {
  const basisActors = new Set([basis.producerId, basis.verifierId]);
  const certifiedActors = [certified.producerId, certified.verifierId];
  const basisDomains = new Set([
    ...basis.producerFailureDomains,
    ...basis.verifierFailureDomains,
  ].map(domainIdentity));
  const certifiedDomains = [
    ...certified.producerFailureDomains,
    ...certified.verifierFailureDomains,
  ].map(domainIdentity);
  return basis.sourceIdentity.sourceId !== certified.sourceIdentity.sourceId
    && basis.sourceIdentity.digest !== certified.sourceIdentity.digest
    && certifiedActors.every((actorId) => !basisActors.has(actorId))
    && basis.producerOwnerId === certified.producerOwnerId
    && basis.verifierOwnerId !== certified.verifierOwnerId
    && validatorIdentity(basis.validator) !== validatorIdentity(certified.validator)
    && certifiedDomains.every((identity) => !basisDomains.has(identity));
};
const diagnosticEvidenceIdsFromIssues = (evaluation) => stableUnique(
  evaluation.packetIssues
    .filter((entry) => (
      entry.code === 'DIAGNOSTIC_EVIDENCE_REFERENCE_UNKNOWN'
      || entry.code === 'DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM'
    ))
    .map((entry) => entry.message)
    .filter(isId),
);
const diagnosticPlaneEvidenceIds = (evaluation) => stableUnique(
  Object.keys(DIAGNOSTIC_EVIDENCE_REQUIREMENTS).flatMap((field) => (
    evaluation.diagnosticPlane[field]
  )),
);

const issueSignature = (entry) => `${entry.path}|${entry.code}|${entry.message}`;

function packetIssueRelationshipsValid(evaluation, evidenceById, claimById) {
  const issueSignatures = evaluation.packetIssues.map(issueSignature);
  const canonicalIssueSignatures = [...evaluation.packetIssues]
    .sort((left, right) => (
      compareCanonical(left.path, right.path)
      || compareCanonical(left.code, right.code)
      || compareCanonical(left.message, right.message)
    ))
    .map(issueSignature);
  if (
    !allUnique(issueSignatures)
    || issueSignatures.some((signature, position) => signature !== canonicalIssueSignatures[position])
  ) return false;

  const diagnosticClaim = claimById.get('PA-S4-CLAIM-013');
  const diagnosticRequirement = MANDATORY_CLAIM_REQUIREMENTS.find((entry) => (
    entry.claimId === 'PA-S4-CLAIM-013'
  ));
  const boundDiagnosticIds = new Set([
    ...diagnosticClaim.supportingEvidenceIds,
    ...diagnosticClaim.counterEvidenceIds,
  ]);

  const expectedMissingClaimIssues = [];
  for (const claim of claimById.values()) {
    for (const [field, ids] of [
      ['supportingEvidenceIds', claim.supportingEvidenceIds],
      ['counterEvidenceIds', claim.counterEvidenceIds],
    ]) {
      for (const evidenceId of ids.filter((id) => !evidenceById.has(id))) {
        expectedMissingClaimIssues.push(`$.claims.${claim.claimId}.${field}|CLAIM_EVIDENCE_REFERENCE_UNKNOWN|${evidenceId}`);
      }
    }
  }
  const actualMissingClaimIssues = evaluation.packetIssues
    .filter((entry) => entry.code === 'CLAIM_EVIDENCE_REFERENCE_UNKNOWN')
    .map(issueSignature);
  const sortedActualMissing = [...actualMissingClaimIssues].sort();
  const sortedExpectedMissing = [...expectedMissingClaimIssues].sort();
  if (
    sortedActualMissing.length !== sortedExpectedMissing.length
    || sortedActualMissing.some((signature, position) => signature !== sortedExpectedMissing[position])
  ) return false;

  const expectedDiagnosticIssues = [];
  const diagnosticIds = [];
  for (const [field, family] of Object.entries(DIAGNOSTIC_EVIDENCE_REQUIREMENTS)) {
    const path = `$.diagnosticPlane.${field}`;
    const ids = evaluation.diagnosticPlane[field];
    const required = field === 'postureEvidenceIds' || evaluation.diagnosticPlane.posture !== 'NOT_CONFIGURED';
    if (required && ids.length === 0) {
      expectedDiagnosticIssues.push(`${path}|DIAGNOSTIC_REQUIRED_FAMILY_MISSING|${field}`);
    }
    if (evaluation.diagnosticPlane.posture === 'NOT_CONFIGURED' && field !== 'postureEvidenceIds' && ids.length > 0) {
      return false;
    }
    for (const evidenceId of ids) {
      diagnosticIds.push(evidenceId);
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        expectedDiagnosticIssues.push(`${path}|DIAGNOSTIC_EVIDENCE_REFERENCE_UNKNOWN|${evidenceId}`);
      } else if (
        evidence.role !== 'SUPPORT'
        || evidence.purpose !== family.purpose
        || evidence.kind !== family.kind
        || evidence.producerOwnerId !== diagnosticRequirement.canonicalOwner.ownerId
        || !claimBindingMatches(evidence.claimBinding, diagnosticRequirement)
      ) return false;
      if (!boundDiagnosticIds.has(evidenceId)) {
        expectedDiagnosticIssues.push(`${path}|DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM|${evidenceId}`);
      }
    }
  }
  if (
    evaluation.diagnosticPlane.postureEvidenceIds.length === 0
    || !allUnique(diagnosticIds)
    || diagnosticIds.length > SCHEMA_LIMITS.maxEdgesPerNode
    || new Set([...boundDiagnosticIds, ...diagnosticIds]).size > SCHEMA_LIMITS.maxEdgesPerNode
    || diagnosticClaim.supportingEvidenceIds.some((evidenceId) => !diagnosticIds.includes(evidenceId))
  ) return false;
  const actualDiagnosticIssues = evaluation.packetIssues
    .filter((entry) => entry.code.startsWith('DIAGNOSTIC_'))
    .map(issueSignature)
    .sort();
  expectedDiagnosticIssues.sort();
  if (
    actualDiagnosticIssues.length !== expectedDiagnosticIssues.length
    || actualDiagnosticIssues.some((signature, position) => signature !== expectedDiagnosticIssues[position])
  ) return false;
  return true;
}

const ownerValid = (value) => (
  exactObject(value, ['ownerId', 'ownerPath']) && isId(value.ownerId) && isText(value.ownerPath)
);
const ownerMatches = (actual, expected) => (
  ownerValid(actual)
  && actual.ownerId === expected.ownerId
  && actual.ownerPath === expected.ownerPath
);
const validatorValid = (value) => (
  exactObject(value, ['validatorId', 'version']) && isId(value.validatorId) && isId(value.version)
);
const validatorMatches = (actual, expected) => (
  validatorValid(actual)
  && actual.validatorId === expected.validatorId
  && actual.version === expected.version
);
const claimBindingValid = (value) => (
  exactObject(value, ['claimId', 'requirementKey', 'scope'])
  && isId(value.claimId)
  && isId(value.requirementKey)
  && isText(value.scope)
);
const claimBindingMatches = (value, requirement) => (
  claimBindingValid(value)
  && value.claimId === requirement.claimId
  && value.requirementKey === requirement.requirementKey
  && value.scope === requirement.scope
);
const domainValid = (value) => (
  exactObject(value, ['class', 'id'])
  && FAILURE_DOMAIN_CLASSES.includes(value.class)
  && isId(value.id)
);
const domainsValid = (value) => (
  Array.isArray(value)
  && value.length >= 1
  && value.length <= SCHEMA_LIMITS.maxFailureDomainsPerLeg
  && value.every(domainValid)
  && new Set(value.map((domain) => `${domain.class}:${domain.id}`)).size === value.length
);
const issueValid = (value) => (
  exactObject(value, ['path', 'code', 'message'])
  && isText(value.path)
  && isId(value.code)
  && isId(value.message)
);
const copyOwner = (value) => ({ ownerId: value.ownerId, ownerPath: value.ownerPath });
const copyValidator = (value) => ({ validatorId: value.validatorId, version: value.version });
const copyDomain = (value) => ({ class: value.class, id: value.id });

const unknownSafetyBoundary = () => ({
  readOnly: true,
  supportUsableForNewAction: false,
  doesNotBlockCanonicalRiskReduction: true,
  riskReductionAvailabilityOwner: 'EXISTING_CANONICAL_OWNERS',
  llmMayExplain: true,
  llmMayRestoreSupport: false,
  prohibitedCommands: [...PROHIBITED_ASSURANCE_COMMANDS],
  commandsIssued: 0,
});

const unknownView = (reasonCode) => deepFreeze({
  schemaVersion: ASSURANCE_CASE_VIEW_MODEL_VERSION,
  sourceEvaluationVersion: null,
  evaluatedAtMs: null,
  status: 'UNKNOWN',
  truthLabel: 'SYNTHETIC_ONLY',
  authorityEffect: 'NONE',
  runtimeProjectionOwner: 'I08.machine-supervisor',
  summary: {
    mandatoryClaimCount: 0,
    passingClaimCount: 0,
    failingClaimCount: 0,
    unknownClaimCount: 0,
    evidenceCount: 0,
    invalidationPathCount: 0,
    invalidationTruncated: false,
    attentionRequired: true,
    reasonCodes: [reasonCode],
  },
  diagnosticPlane: {
    posture: 'UNKNOWN',
    status: 'UNKNOWN',
    reasonCodes: [reasonCode],
    postureEvidenceIds: [],
    containmentEvidenceIds: [],
    permissionEvidenceIds: [],
    providerOutageEvidenceIds: [],
    privacyEvidenceIds: [],
    independentEvidenceIds: [],
  },
  claims: [],
  evidence: [],
  assumptions: [],
  invalidationPaths: [],
  recommendations: [],
  recomputation: {
    applicable: false,
    originInvalidatedAtMs: null,
    logicalCompletedAtMs: null,
    assuranceSloMs: null,
    assuranceDueAtMs: null,
    completedWithinDeclaredSlo: false,
    affectedClaimDeadlines: [],
  },
  safetyBoundary: unknownSafetyBoundary(),
  controls: [],
});

function mandatoryClaimRecordValid(claim, requirement, diagnosticPosture) {
  if (!exactObject(claim, CLAIM_FIELDS)) return false;
  if (
    claim.claimId !== requirement.claimId
    || claim.requirementKey !== requirement.requirementKey
    || claim.statement !== requirement.statement
    || claim.scope !== requirement.scope
    || claim.capitalCritical !== true
    || !validatorMatches(claim.validator, MANDATORY_CLAIM_VALIDATOR)
    || !resultValid(claim.result)
    || !isCanonicalIdArray(claim.reasonCodes)
    || !sameIds(claim.subclaimIds, requirement.requiredSubclaimIds)
    || !sameIds(claim.assumptionIds, requirement.requiredAssumptionIds)
    || !isUniqueIdArray(claim.appliedAssumptionIds, SCHEMA_LIMITS.maxEdgesPerNode)
    || !isUniqueIdArray(claim.supportingEvidenceIds, SCHEMA_LIMITS.maxEdgesPerNode)
    || claim.supportingEvidenceIds.length < 1
    || !isUniqueIdArray(claim.counterEvidenceIds, SCHEMA_LIMITS.maxEdgesPerNode)
    || claim.supportingEvidenceIds.length + claim.counterEvidenceIds.length > SCHEMA_LIMITS.maxEdgesPerNode
    || !isUniqueIdArray(claim.invalidatingEvidenceIds, SCHEMA_LIMITS.maxEdgesPerNode)
    || !isUniqueIdArray(claim.invalidatingAssumptionIds, SCHEMA_LIMITS.maxEdgesPerNode)
    || !isUniqueIdArray(claim.invalidatingSubclaimIds, SCHEMA_LIMITS.maxEdgesPerNode)
    || !nullableUtc(claim.invalidatedAtMs)
    || !boundedPositiveInteger(claim.propagationSloMs)
    || !boundedPositiveInteger(claim.assuranceSloMs)
    || claim.propagationSloMs !== ASSURANCE_CASE_PROPAGATION_POLICY.propagationSloMs
    || claim.assuranceSloMs !== ASSURANCE_CASE_PROPAGATION_POLICY.assuranceSloMs
    || !ownerMatches(claim.canonicalOwner, requirement.canonicalOwner)
    || !ownerMatches(claim.resultConsumerOwner, requirement.resultConsumerOwner)
    || claim.supportUsableForNewAction !== (claim.result === 'PASS')
  ) return false;

  const expectedAppliedAssumptions = diagnosticPosture === 'NOT_CONFIGURED'
    ? (claim.claimId === 'PA-S4-CLAIM-013'
      ? []
      : requirement.requiredAssumptionIds.filter((id) => id !== 'PA-S1-AS-009'))
    : requirement.requiredAssumptionIds;
  if (!sameIds(claim.appliedAssumptionIds, expectedAppliedAssumptions)) return false;

  const suffix = claim.claimId.slice('PA-S4-CLAIM-'.length);
  if (
    !exactObject(claim.invariantProjection, ['invariantId', 'eventRecommendationType', 'incidentRecommendationType'])
    || claim.invariantProjection.invariantId !== `PA-S4-INVARIANT-${suffix}`
    || claim.invariantProjection.eventRecommendationType !== SAFE_EVENT_RECOMMENDATION_TYPE
    || claim.invariantProjection.incidentRecommendationType !== SAFE_INCIDENT_RECOMMENDATION_TYPE
  ) return false;
  if (
    !exactObject(claim.cockpitProjection, ['surface', 'summaryField', 'drillDown'])
    || claim.cockpitProjection.surface !== requirement.cockpitSurface
    || !COCKPIT_SURFACES.includes(claim.cockpitProjection.surface)
    || claim.cockpitProjection.summaryField !== requirement.requirementKey
    || claim.cockpitProjection.drillDown !== MANDATORY_CLAIM_DRILL_DOWN
  ) return false;
  if (
    !Array.isArray(claim.componentResults)
    || claim.componentResults.length < 1
    || claim.componentResults.length > SCHEMA_LIMITS.maxEdgesPerNode
  ) return false;
  const componentIds = [];
  const componentEvidenceIds = [];
  for (const component of claim.componentResults) {
    if (
      !exactObject(component, [
        'componentId', 'componentScope', 'canonicalOwnerId', 'supportingEvidenceIds',
        'result', 'invalidatingEvidenceIds', 'supportUsableForNewAction',
      ])
      || !isId(component.componentId)
      || !isText(component.componentScope)
      || component.canonicalOwnerId !== requirement.canonicalOwner.ownerId
      || !isUniqueIdArray(component.supportingEvidenceIds, SCHEMA_LIMITS.maxEdgesPerNode)
      || component.supportingEvidenceIds.length < 1
      || !component.supportingEvidenceIds.every((id) => claim.supportingEvidenceIds.includes(id))
      || !resultValid(component.result)
      || !isUniqueIdArray(component.invalidatingEvidenceIds, SCHEMA_LIMITS.maxEdgesPerNode)
      || !component.invalidatingEvidenceIds.every((id) => (
        component.supportingEvidenceIds.includes(id) || claim.counterEvidenceIds.includes(id)
      ))
      || component.supportUsableForNewAction !== (component.result === 'PASS' && claim.result === 'PASS')
    ) return false;
    componentIds.push(component.componentId);
    componentEvidenceIds.push(...component.supportingEvidenceIds);
  }
  return new Set(componentIds).size === componentIds.length
    && sameIds(stableUnique(componentEvidenceIds), claim.supportingEvidenceIds);
}

function evidenceRecordValid(evidence) {
  if (!exactObject(evidence, EVIDENCE_FIELDS)) return false;
  if (
    !isId(evidence.evidenceId)
    || !EVIDENCE_ROLES.includes(evidence.role)
    || !EVIDENCE_PURPOSES.includes(evidence.purpose)
    || !EVIDENCE_KINDS.includes(evidence.kind)
    || !isText(evidence.statement)
    || evidence.statement !== canonicalEvidenceStatement(evidence)
    || UNSAFE_ASSURANCE_TEXT_PATTERN.test(evidence.statement)
    || !claimBindingValid(evidence.claimBinding)
    || evidence.capitalCritical !== (evidence.purpose !== 'INDEPENDENCE_BASIS')
    || !resultValid(evidence.declaredResult)
    || !resultValid(evidence.result)
    || !isCanonicalIdArray(evidence.reasonCodes)
    || !exactObject(evidence.sourceIdentity, ['sourceId', 'sourceType', 'revision', 'digest'])
    || !isId(evidence.sourceIdentity.sourceId)
    || evidence.sourceIdentity.sourceType !== evidence.kind
    || !isId(evidence.sourceIdentity.revision)
    || typeof evidence.sourceIdentity.digest !== 'string'
    || !DIGEST_PATTERN.test(evidence.sourceIdentity.digest)
    || !validatorValid(evidence.validator)
    || !isId(evidence.producerId)
    || !isId(evidence.producerOwnerId)
    || !domainsValid(evidence.producerFailureDomains)
    || !isId(evidence.verifierId)
    || !isId(evidence.verifierOwnerId)
    || !domainsValid(evidence.verifierFailureDomains)
    || !['PROVEN', 'UNKNOWN'].includes(evidence.independenceStatus)
    || !INDEPENDENCE_CLASSES.includes(evidence.independenceClass)
    || !isUniqueIdArray(evidence.independenceBasisEvidenceIds, SCHEMA_LIMITS.maxEdgesPerNode)
    || !isUniqueIdArray(evidence.sharedFailureDomains, SCHEMA_LIMITS.maxFailureDomainsPerLeg)
    || !isUniqueIdArray(evidence.commonModeDependencyIds, SCHEMA_LIMITS.maxCommonModeDependencies)
    || !isUniqueIdArray(evidence.requiredFailureDomainClasses, FAILURE_DOMAIN_CLASSES.length)
    || !isUniqueIdArray(evidence.missingProducerFailureDomainClasses, FAILURE_DOMAIN_CLASSES.length)
    || !isUniqueIdArray(evidence.missingVerifierFailureDomainClasses, FAILURE_DOMAIN_CLASSES.length)
    || !isUniqueIdArray(evidence.derivedFromClaimIds, SCHEMA_LIMITS.maxEdgesPerNode)
    || !isUniqueIdArray(evidence.derivedFromEvidenceIds, SCHEMA_LIMITS.maxEdgesPerNode)
    || !isUniqueIdArray(evidence.certifiesEvidenceIds, SCHEMA_LIMITS.maxEdgesPerNode)
    || !FRESHNESS_STATUSES.includes(evidence.freshnessStatus)
    || !isValidUtcMillis(evidence.createdAtMs)
    || !isValidUtcMillis(evidence.lastVerifiedAtMs)
    || !isValidUtcMillis(evidence.expiresAtMs)
    || !boundedTtlInteger(evidence.maximumAgeMs)
    || !nullableNonNegativeInteger(evidence.ageMs)
    || !nullableUtc(evidence.invalidAtMs)
    || !nullableUtc(evidence.localInvalidatedAtMs)
    || !nullableUtc(evidence.invalidatedAtMs)
    || typeof evidence.primitiveInvalidator !== 'boolean'
    || evidence.supportUsableForNewAction !== (evidence.result === 'PASS')
  ) return false;
  if (
    evidence.purpose !== 'INDEPENDENCE_BASIS'
    && (
      evidence.claimBinding.claimId === 'PA-S4-CLAIM-012'
      || evidence.purpose === 'DIAGNOSTIC_INDEPENDENCE'
    )
    && evidence.independenceClass !== 'OUT_OF_BAND'
  ) return false;
  return true;
}

function assumptionRecordValid(assumption) {
  return exactObject(assumption, ASSUMPTION_FIELDS)
    && ACCEPTED_S1_ASSUMPTION_IDS.includes(assumption.assumptionId)
    && assumption.sourceOwnerId === ACCEPTED_S1_ASSUMPTION_OWNERS[assumption.assumptionId]
    && resultValid(assumption.declaredResult)
    && resultValid(assumption.result)
    && isCanonicalIdArray(assumption.reasonCodes)
    && FRESHNESS_STATUSES.includes(assumption.freshnessStatus)
    && isValidUtcMillis(assumption.sourceEvaluatedAtMs)
    && nullableUtc(assumption.staleAtMs)
    && nullableNonNegativeInteger(assumption.ageMs)
    && nullableUtc(assumption.invalidatedAtMs)
    && assumption.supportUsableForNewAction === (assumption.result === 'PASS');
}

function evidenceRelationshipsValid(evaluation, evidenceById, claimById) {
  const nowMs = evaluation.evaluatedAtMs;
  for (const evidence of evidenceById.values()) {
    if (
      !evidence.independenceBasisEvidenceIds.every((id) => evidenceById.has(id))
      || !evidence.derivedFromEvidenceIds.every((id) => evidenceById.has(id))
      || !evidence.derivedFromClaimIds.every((id) => claimById.has(id))
      || !evidence.certifiesEvidenceIds.every((id) => evidenceById.has(id))
    ) return false;
    if (evidence.purpose === 'INDEPENDENCE_BASIS') {
      if (
        evidence.kind !== 'OWNER_AUTHORIZATION'
        || evidence.role !== 'SUPPORT'
        || evidence.capitalCritical !== false
        || evidence.independenceBasisEvidenceIds.length !== 0
        || evidence.derivedFromClaimIds.length !== 0
        || evidence.derivedFromEvidenceIds.length !== 0
        || evidence.certifiesEvidenceIds.length !== 1
      ) return false;
      const certified = evidenceById.get(evidence.certifiesEvidenceIds[0]);
      if (
        certified.purpose === 'INDEPENDENCE_BASIS'
        || !sameIds(certified.independenceBasisEvidenceIds, [evidence.evidenceId])
        || !claimBindingValid(certified.claimBinding)
        || evidence.claimBinding.claimId !== certified.claimBinding.claimId
        || evidence.claimBinding.requirementKey !== certified.claimBinding.requirementKey
        || evidence.claimBinding.scope !== certified.claimBinding.scope
        || !basisCertifiedSemanticsDistinct(evidence, certified)
      ) return false;
    } else {
      if (
        evidence.capitalCritical !== true
        || evidence.certifiesEvidenceIds.length !== 0
        || evidence.independenceBasisEvidenceIds.length !== 1
      ) return false;
      const basis = evidenceById.get(evidence.independenceBasisEvidenceIds[0]);
      if (
        basis.purpose !== 'INDEPENDENCE_BASIS'
        || !sameIds(basis.certifiesEvidenceIds, [evidence.evidenceId])
        || basis.claimBinding.claimId !== evidence.claimBinding.claimId
        || basis.claimBinding.requirementKey !== evidence.claimBinding.requirementKey
        || basis.claimBinding.scope !== evidence.claimBinding.scope
      ) return false;
    }

    const producerDomains = new Set(evidence.producerFailureDomains.map((domain) => `${domain.class}:${domain.id}`));
    const verifierDomains = new Set(evidence.verifierFailureDomains.map((domain) => `${domain.class}:${domain.id}`));
    const sharedDomains = stableUnique([...producerDomains].filter((identity) => verifierDomains.has(identity)));
    const requiredClasses = INDEPENDENCE_REQUIRED_FAILURE_DOMAIN_CLASSES[evidence.independenceClass] ?? [];
    const producerClasses = new Set(evidence.producerFailureDomains.map((domain) => domain.class));
    const verifierClasses = new Set(evidence.verifierFailureDomains.map((domain) => domain.class));
    const missingProducer = requiredClasses.filter((domainClass) => !producerClasses.has(domainClass));
    const missingVerifier = requiredClasses.filter((domainClass) => !verifierClasses.has(domainClass));
    if (
      !sameIds(evidence.sharedFailureDomains, sharedDomains)
      || !sameIds(evidence.requiredFailureDomainClasses, requiredClasses)
      || !sameIds(evidence.missingProducerFailureDomainClasses, missingProducer)
      || !sameIds(evidence.missingVerifierFailureDomainClasses, missingVerifier)
    ) return false;

    const basisResults = evidence.independenceBasisEvidenceIds.map((id) => evidenceById.get(id).result);
    const localIndependenceBroken = evidence.producerId === evidence.verifierId
      || evidence.producerOwnerId === evidence.verifierOwnerId
      || sharedDomains.length > 0
      || evidence.commonModeDependencyIds.length > 0
      || missingProducer.length > 0
      || missingVerifier.length > 0;
    const basisBroken = evidence.purpose !== 'INDEPENDENCE_BASIS'
      && (evidence.independenceBasisEvidenceIds.length === 0 || basisResults.some((result) => result !== 'PASS'));
    const expectedIndependence = localIndependenceBroken || basisBroken ? 'UNKNOWN' : 'PROVEN';
    if (evidence.independenceStatus !== expectedIndependence) return false;

    const timelineValid = evidence.createdAtMs <= evidence.lastVerifiedAtMs
      && evidence.lastVerifiedAtMs <= evidence.expiresAtMs;
    const maximumAgeBoundaryMs = evidence.lastVerifiedAtMs + evidence.maximumAgeMs;
    const expectedInvalidAtMs = timelineValid ? Math.min(evidence.expiresAtMs, maximumAgeBoundaryMs + 1) : null;
    let expectedFreshness = 'CURRENT';
    if (!timelineValid) expectedFreshness = 'INVALID_TIMELINE';
    else if (nowMs < evidence.createdAtMs) expectedFreshness = 'NOT_YET_VALID';
    else if (nowMs < evidence.lastVerifiedAtMs) expectedFreshness = 'INCOHERENT';
    else if (nowMs >= evidence.expiresAtMs || nowMs - evidence.lastVerifiedAtMs > evidence.maximumAgeMs) expectedFreshness = 'EXPIRED';
    const expectedAgeMs = nowMs >= evidence.lastVerifiedAtMs ? nowMs - evidence.lastVerifiedAtMs : null;
    if (
      evidence.freshnessStatus !== expectedFreshness
      || !nullableEqual(evidence.invalidAtMs, expectedInvalidAtMs)
      || !nullableEqual(evidence.ageMs, expectedAgeMs)
    ) return false;

    const dependencyResults = [
      ...evidence.derivedFromClaimIds.map((id) => claimById.get(id).result),
      ...evidence.derivedFromEvidenceIds.map((id) => evidenceById.get(id).result),
    ];
    const dependencyResult = statusFrom(dependencyResults);
    let expectedResult = evidence.declaredResult;
    if (evidence.declaredResult !== 'FAIL') {
      if (expectedFreshness !== 'CURRENT') expectedResult = 'UNKNOWN';
      if (dependencyResult === 'FAIL') expectedResult = 'FAIL';
      else if (dependencyResult === 'UNKNOWN' && expectedResult !== 'FAIL') expectedResult = 'UNKNOWN';
      if (expectedIndependence !== 'PROVEN' && expectedResult !== 'FAIL') expectedResult = 'UNKNOWN';
    }
    if (evidence.result !== expectedResult) return false;

    const expectedIndependenceReasons = [];
    if (evidence.producerId === evidence.verifierId) expectedIndependenceReasons.push('PRODUCER_VERIFIER_NOT_INDEPENDENT');
    if (evidence.producerOwnerId === evidence.verifierOwnerId) expectedIndependenceReasons.push('PRODUCER_VERIFIER_OWNER_COMMON_MODE');
    if (sharedDomains.length > 0) expectedIndependenceReasons.push('COMMON_MODE_FAILURE_DOMAIN');
    if (evidence.commonModeDependencyIds.length > 0) expectedIndependenceReasons.push('DECLARED_COMMON_MODE_DEPENDENCY');
    if (missingProducer.length > 0) expectedIndependenceReasons.push('PRODUCER_FAILURE_DOMAIN_COVERAGE_MISSING');
    if (missingVerifier.length > 0) expectedIndependenceReasons.push('VERIFIER_FAILURE_DOMAIN_COVERAGE_MISSING');
    if (evidence.purpose !== 'INDEPENDENCE_BASIS') {
      if (evidence.independenceBasisEvidenceIds.length === 0) expectedIndependenceReasons.push('INDEPENDENCE_UNPROVEN');
      if (basisResults.some((result) => result === undefined)) expectedIndependenceReasons.push('INDEPENDENCE_BASIS_MISSING');
      if (basisResults.some((result) => result === 'FAIL')) expectedIndependenceReasons.push('INDEPENDENCE_BASIS_FAILED');
      if (basisResults.some((result) => result === 'UNKNOWN')) expectedIndependenceReasons.push('INDEPENDENCE_BASIS_UNKNOWN');
    }
    const expectedDerivedReasonCodes = [];
    let sourceReasonRequired = false;
    if (evidence.declaredResult === 'FAIL') {
      sourceReasonRequired = true;
      expectedDerivedReasonCodes.push('DECLARED_EVIDENCE_FAILURE');
    } else {
      if (evidence.declaredResult === 'UNKNOWN') {
        sourceReasonRequired = true;
        expectedDerivedReasonCodes.push('DECLARED_EVIDENCE_UNKNOWN');
      }
      if (expectedFreshness !== 'CURRENT') expectedDerivedReasonCodes.push(expectedFreshness);
      if (dependencyResult === 'FAIL') expectedDerivedReasonCodes.push('DERIVED_DEPENDENCY_FAILED');
      else if (dependencyResult === 'UNKNOWN') expectedDerivedReasonCodes.push('DERIVED_DEPENDENCY_UNKNOWN');
      if (expectedIndependence !== 'PROVEN' && expectedResult !== 'FAIL') {
        expectedDerivedReasonCodes.push(...expectedIndependenceReasons);
      }
      if (expectedResult === 'PASS') {
        sourceReasonRequired = true;
        expectedDerivedReasonCodes.push('CURRENT_INDEPENDENT_EVIDENCE');
      }
    }
    const derivedReasonSet = new Set(EVIDENCE_DERIVED_REASON_CODES.map((reasonCode) => reasonCode.toLowerCase()));
    const sourceReasonCodes = evidence.reasonCodes.filter((reasonCode) => !derivedReasonSet.has(reasonCode.toLowerCase()));
    if (sourceReasonCodes.length !== (sourceReasonRequired ? 1 : 0)) return false;
    if (sourceReasonCodes.some((reasonCode) => (
      !SOURCE_REASON_PATTERN.test(reasonCode)
      || !reasonCode.startsWith(`SOURCE_${evidence.declaredResult}_`)
      || UNSAFE_ASSURANCE_TEXT_PATTERN.test(reasonCode)
    ))) return false;
    if (
      evidence.declaredResult === 'PASS'
      && sourceReasonCodes.some((reasonCode) => ADVERSE_PASS_SOURCE_REASON.test(reasonCode))
    ) return false;
    if (!sameIds(evidence.reasonCodes, stableUnique([...expectedDerivedReasonCodes, ...sourceReasonCodes]))) return false;

    const observedEvidenceBoundaryMs = Math.min(evidence.lastVerifiedAtMs, nowMs);
    const expectedLocalInvalidatedAtMs = minimumUtcMillis([
      evidence.declaredResult !== 'PASS' ? observedEvidenceBoundaryMs : null,
      expectedFreshness === 'EXPIRED' ? expectedInvalidAtMs : null,
      expectedFreshness !== 'CURRENT' && expectedFreshness !== 'EXPIRED' ? observedEvidenceBoundaryMs : null,
      localIndependenceBroken ? observedEvidenceBoundaryMs : null,
    ]);
    const dependencyInvalidatedAtMs = minimumUtcMillis([
      ...evidence.derivedFromClaimIds.map((id) => claimById.get(id).invalidatedAtMs),
      ...evidence.derivedFromEvidenceIds.map((id) => evidenceById.get(id).invalidatedAtMs),
    ]);
    const basisInvalidatedAtMs = minimumUtcMillis(
      evidence.independenceBasisEvidenceIds.map((id) => evidenceById.get(id).invalidatedAtMs),
    );
    const expectedInvalidatedAtMs = expectedResult === 'PASS' ? null : minimumUtcMillis([
      expectedLocalInvalidatedAtMs,
      dependencyResult !== 'PASS' ? dependencyInvalidatedAtMs : null,
      basisResults.some((result) => result !== 'PASS') ? basisInvalidatedAtMs : null,
    ]);
    if (
      !nullableEqual(evidence.localInvalidatedAtMs, expectedLocalInvalidatedAtMs)
      || !nullableEqual(evidence.invalidatedAtMs, expectedInvalidatedAtMs)
      || evidence.primitiveInvalidator !== (expectedResult !== 'PASS' && isValidUtcMillis(expectedLocalInvalidatedAtMs))
    ) return false;
  }

  const allEvidence = [...evidenceById.values()];
  if (
    !allUnique(allEvidence.map((entry) => entry.sourceIdentity.sourceId))
    || !allUnique(allEvidence.map((entry) => entry.sourceIdentity.digest))
  ) return false;

  const basisRecords = [...evidenceById.values()].filter((entry) => entry.purpose === 'INDEPENDENCE_BASIS');
  const basisSemanticDimensions = [
    basisRecords.map((entry) => entry.sourceIdentity.sourceId),
    basisRecords.map((entry) => entry.sourceIdentity.digest),
    basisRecords.map((entry) => entry.producerId),
    basisRecords.map((entry) => entry.verifierId),
    basisRecords.flatMap((entry) => [entry.producerId, entry.verifierId]),
    basisRecords.map((entry) => entry.verifierOwnerId),
    basisRecords.map((entry) => validatorIdentity(entry.validator)),
    basisRecords.flatMap((entry) => [
      ...entry.producerFailureDomains,
      ...entry.verifierFailureDomains,
    ].map(domainIdentity)),
  ];
  if (basisSemanticDimensions.some((values) => !allUnique(values))) return false;

  const graphEvidence = allEvidence;
  const certificationRelated = (left, right) => Boolean(left && right) && (
    left.independenceBasisEvidenceIds.includes(right.evidenceId)
    || right.independenceBasisEvidenceIds.includes(left.evidenceId)
    || left.certifiesEvidenceIds.includes(right.evidenceId)
    || right.certifiesEvidenceIds.includes(left.evidenceId)
  );
  const hasCrossRoleAlias = (producerValues, verifierValues) => {
    const producersByIdentity = new Map();
    for (const evidence of graphEvidence) {
      for (const value of producerValues(evidence)) {
        const evidenceIds = producersByIdentity.get(value) ?? new Set();
        evidenceIds.add(evidence.evidenceId);
        producersByIdentity.set(value, evidenceIds);
      }
    }
    return graphEvidence.some((evidence) => verifierValues(evidence).some((value) => (
      [...(producersByIdentity.get(value) ?? [])].some((evidenceId) => (
        evidenceId !== evidence.evidenceId
        && !certificationRelated(evidence, evidenceById.get(evidenceId))
      ))
    )));
  };
  if (
    hasCrossRoleAlias(
      (entry) => [entry.producerId],
      (entry) => [entry.verifierId],
    )
    || hasCrossRoleAlias(
      (entry) => [entry.producerOwnerId],
      (entry) => [entry.verifierOwnerId],
    )
    || hasCrossRoleAlias(
      (entry) => entry.producerFailureDomains.map(domainIdentity),
      (entry) => entry.verifierFailureDomains.map(domainIdentity),
    )
  ) return false;

  const adjacency = new Map();
  for (const claim of claimById.values()) {
    adjacency.set(`claim:${claim.claimId}`, [
      ...claim.subclaimIds.map((id) => `claim:${id}`),
      ...claim.supportingEvidenceIds.map((id) => `evidence:${id}`),
      ...claim.counterEvidenceIds.map((id) => `evidence:${id}`),
      ...(claim.claimId === 'PA-S4-CLAIM-013'
        ? diagnosticPlaneEvidenceIds(evaluation).map((id) => `evidence:${id}`)
        : []),
    ]);
  }
  for (const evidence of evidenceById.values()) {
    adjacency.set(`evidence:${evidence.evidenceId}`, [
      ...evidence.derivedFromClaimIds.map((id) => `claim:${id}`),
      ...evidence.derivedFromEvidenceIds.map((id) => `evidence:${id}`),
      ...evidence.independenceBasisEvidenceIds.map((id) => `evidence:${id}`),
    ]);
  }
  const visiting = new Set();
  const depthCache = new Map();
  let graphValid = true;
  const visit = (node) => {
    if (visiting.has(node)) {
      graphValid = false;
      return 0;
    }
    if (depthCache.has(node)) return depthCache.get(node);
    visiting.add(node);
    const children = (adjacency.get(node) ?? []).filter((child) => adjacency.has(child));
    const childDepths = children.map(visit);
    visiting.delete(node);
    const nodeDepth = 1 + (childDepths.length === 0 ? 0 : Math.max(...childDepths));
    depthCache.set(node, nodeDepth);
    return nodeDepth;
  };
  const maximumDepth = Math.max(0, ...[...adjacency.keys()].map(visit));
  if (!graphValid || maximumDepth > SCHEMA_LIMITS.maxInvalidationPathLength - 1) return false;
  const reachable = new Set();
  const markReachable = (node) => {
    if (reachable.has(node)) return;
    reachable.add(node);
    for (const child of adjacency.get(node) ?? []) markReachable(child);
  };
  for (const claimId of REQUIRED_ROOT_CLAIM_IDS) markReachable(`claim:${claimId}`);
  if ([...adjacency.keys()].some((node) => !reachable.has(node))) return false;
  return true;
}

function expectedDiagnosticContributionReasons(evaluation, claim, evidenceById) {
  const statuses = [];
  const reasonCodes = [];
  const boundIds = new Set([...claim.supportingEvidenceIds, ...claim.counterEvidenceIds]);
  for (const field of Object.keys(DIAGNOSTIC_EVIDENCE_REQUIREMENTS)) {
    const required = field === 'postureEvidenceIds' || evaluation.diagnosticPlane.posture !== 'NOT_CONFIGURED';
    const ids = evaluation.diagnosticPlane[field];
    if (required && ids.length === 0) {
      statuses.push('UNKNOWN');
      reasonCodes.push(`DIAGNOSTIC_${field.replace(/EvidenceIds$/, '').toUpperCase()}_EVIDENCE_MISSING`);
    }
    for (const evidenceId of ids) {
      if (!boundIds.has(evidenceId)) {
        statuses.push('UNKNOWN');
        reasonCodes.push('DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM');
      } else {
        statuses.push(evidenceById.get(evidenceId)?.result ?? 'UNKNOWN');
      }
    }
  }
  if (statuses.every((status) => status === 'PASS')) {
    reasonCodes.push(
      evaluation.diagnosticPlane.posture === 'NOT_CONFIGURED'
        ? 'DIAGNOSTIC_NOT_CONFIGURED_VALID'
        : 'DIAGNOSTIC_CONFIGURED_EVIDENCE_COMPLETE',
    );
  }
  return stableUnique(reasonCodes);
}

function claimRelationshipsValid(evaluation, claimById, evidenceById, assumptionById) {
  const diagnosticClaim = claimById.get('PA-S4-CLAIM-013');
  const diagnosticIssueEvidenceIds = diagnosticEvidenceIdsFromIssues(evaluation);
  const directClaimByEvidence = new Map();
  const directSourceIds = new Set();
  const directSourceDigests = new Set();
  for (const claim of claimById.values()) {
    if (!claim.subclaimIds.every((id) => claimById.has(id))) return false;
    if (!claim.appliedAssumptionIds.every((id) => assumptionById.has(id))) return false;
    const referencedEvidenceIds = [...claim.supportingEvidenceIds, ...claim.counterEvidenceIds];
    const missingEvidenceIds = referencedEvidenceIds.filter((id) => !evidenceById.has(id));
    const evidenceStatuses = referencedEvidenceIds.map((id) => evidenceById.get(id)?.result ?? 'UNKNOWN');
    const assumptionStatuses = claim.appliedAssumptionIds.map((id) => (
      assumptionById.get(id).result === 'PASS' ? 'PASS' : 'UNKNOWN'
    ));
    const subclaimStatuses = claim.subclaimIds.map((id) => claimById.get(id).result);
    let expectedResult = statusFrom([...evidenceStatuses, ...assumptionStatuses, ...subclaimStatuses]);

    if (claim.claimId === 'PA-S4-CLAIM-013') {
      const supportingPurposes = claim.supportingEvidenceIds
        .map((id) => evidenceById.get(id)?.purpose)
        .filter((purpose) => purpose !== undefined);
      if (evaluation.diagnosticPlane.posture === 'NOT_CONFIGURED') {
        if (!sameIds(supportingPurposes, ['DIAGNOSTIC_POSTURE'])) return false;
      } else if (!sameIds(supportingPurposes, DIAGNOSTIC_PURPOSES)) {
        if (expectedResult !== 'FAIL') expectedResult = 'UNKNOWN';
      }
      if (evaluation.diagnosticPlane.reasonCodes.some((code) => code.endsWith('_EVIDENCE_MISSING'))) {
        if (expectedResult !== 'FAIL') expectedResult = 'UNKNOWN';
      }
    }
    if (claim.result !== expectedResult) return false;

    const expectedClaimReasons = claim.claimId === 'PA-S4-CLAIM-013'
      ? [...expectedDiagnosticContributionReasons(evaluation, claim, evidenceById)]
      : [];
    for (const evidenceId of referencedEvidenceIds) {
      const evidenceResult = evidenceById.get(evidenceId)?.result;
      if (evidenceResult === undefined) expectedClaimReasons.push('EVIDENCE_REFERENCE_MISSING');
      else if (evidenceResult === 'FAIL') expectedClaimReasons.push('EVIDENCE_FAILED');
      else if (evidenceResult === 'UNKNOWN') expectedClaimReasons.push('EVIDENCE_UNKNOWN');
    }
    for (const assumptionId of claim.appliedAssumptionIds) {
      const assumptionResult = assumptionById.get(assumptionId)?.result;
      if (assumptionResult === undefined) expectedClaimReasons.push('S1_ASSUMPTION_REFERENCE_MISSING');
      else if (assumptionResult === 'FAIL') expectedClaimReasons.push('S1_ASSUMPTION_FAILED');
      else if (assumptionResult === 'UNKNOWN') expectedClaimReasons.push('S1_ASSUMPTION_UNKNOWN');
    }
    for (const subclaimId of claim.subclaimIds) {
      const subclaimResult = claimById.get(subclaimId)?.result;
      if (subclaimResult === undefined) expectedClaimReasons.push('SUBCLAIM_REFERENCE_MISSING');
      else if (subclaimResult === 'FAIL') expectedClaimReasons.push('SUBCLAIM_FAILED');
      else if (subclaimResult === 'UNKNOWN') expectedClaimReasons.push('SUBCLAIM_UNKNOWN');
    }
    if (claim.result === 'PASS') expectedClaimReasons.push('ALL_REQUIRED_SUPPORT_CURRENT');
    if (!sameIds(claim.reasonCodes, stableUnique(expectedClaimReasons))) return false;

    const expectedInvalidatingEvidenceIds = stableUnique([
      ...referencedEvidenceIds.filter((id) => evidenceById.get(id)?.result !== 'PASS'),
      ...(claim.claimId === 'PA-S4-CLAIM-013' ? diagnosticIssueEvidenceIds : []),
    ]);
    const expectedInvalidatingAssumptionIds = claim.appliedAssumptionIds.filter((id) => assumptionById.get(id).result !== 'PASS');
    const expectedInvalidatingSubclaimIds = claim.subclaimIds.filter((id) => claimById.get(id).result !== 'PASS');
    if (
      !sameIds(claim.invalidatingEvidenceIds, expectedInvalidatingEvidenceIds)
      || !sameIds(claim.invalidatingAssumptionIds, expectedInvalidatingAssumptionIds)
      || !sameIds(claim.invalidatingSubclaimIds, expectedInvalidatingSubclaimIds)
    ) return false;
    if (claim.result === 'PASS' && missingEvidenceIds.length > 0) return false;

    const requirement = MANDATORY_CLAIM_REQUIREMENTS.find((entry) => entry.claimId === claim.claimId);
    const resolvedDirectSupport = claim.supportingEvidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
    for (const evidence of resolvedDirectSupport) {
      const kindValid = claim.claimId === 'PA-S4-CLAIM-013'
        ? DIAGNOSTIC_KIND_BY_PURPOSE[evidence.purpose] === evidence.kind
        : evidence.purpose === 'CLAIM_SUPPORT' && evidence.kind === requirement.requiredEvidenceKind;
      if (
        evidence.role !== 'SUPPORT'
        || !kindValid
        || evidence.producerOwnerId !== requirement.canonicalOwner.ownerId
        || !claimBindingMatches(evidence.claimBinding, requirement)
      ) return false;
    }
    for (const evidenceId of claim.counterEvidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) continue;
      if (
        evidence.role !== 'COUNTERCHECK'
        || evidence.purpose !== 'CLAIM_SUPPORT'
        || evidence.kind !== requirement.requiredEvidenceKind
        || evidence.producerOwnerId !== requirement.canonicalOwner.ownerId
        || !claimBindingMatches(evidence.claimBinding, requirement)
      ) return false;
    }
    for (const evidence of [...resolvedDirectSupport, ...claim.counterEvidenceIds.map((id) => evidenceById.get(id)).filter(Boolean)]) {
      if (directClaimByEvidence.has(evidence.evidenceId)) return false;
      directClaimByEvidence.set(evidence.evidenceId, claim.claimId);
      if (directSourceIds.has(evidence.sourceIdentity.sourceId) || directSourceDigests.has(evidence.sourceIdentity.digest)) return false;
      directSourceIds.add(evidence.sourceIdentity.sourceId);
      directSourceDigests.add(evidence.sourceIdentity.digest);
    }

    const expectedClaimInvalidatedAtMs = claim.result === 'PASS' ? null : minimumUtcMillis([
      ...referencedEvidenceIds.map((id) => evidenceById.get(id)?.invalidatedAtMs),
      ...claim.appliedAssumptionIds.map((id) => assumptionById.get(id).invalidatedAtMs),
      ...claim.subclaimIds.map((id) => claimById.get(id).invalidatedAtMs),
    ]);
    if (!nullableEqual(claim.invalidatedAtMs, expectedClaimInvalidatedAtMs)) return false;

    const sharedComponentStatuses = [
      ...claim.counterEvidenceIds.map((id) => evidenceById.get(id)?.result ?? 'UNKNOWN'),
      ...assumptionStatuses,
      ...subclaimStatuses,
      ...(claim.claimId === 'PA-S4-CLAIM-013'
        && evaluation.diagnosticPlane.reasonCodes.some((code) => (
          code.endsWith('_EVIDENCE_MISSING')
          || code === 'DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM'
        ))
        ? ['UNKNOWN']
        : []),
    ];
    for (const component of claim.componentResults) {
      const componentEvidence = component.supportingEvidenceIds.map((id) => evidenceById.get(id));
      const componentResult = statusFrom([
        ...componentEvidence.map((entry) => entry?.result ?? 'UNKNOWN'),
        ...sharedComponentStatuses,
      ]);
      const invalidatingIds = stableUnique([
        ...component.supportingEvidenceIds.filter((id) => evidenceById.get(id)?.result !== 'PASS'),
        ...claim.counterEvidenceIds.filter((id) => evidenceById.get(id)?.result !== 'PASS'),
      ]);
      if (
        component.result !== componentResult
        || !sameIds(component.invalidatingEvidenceIds, invalidatingIds)
        || component.supportUsableForNewAction !== (componentResult === 'PASS' && claim.result === 'PASS')
      ) return false;
    }
  }
  const diagnosticEvidence = diagnosticPlaneEvidenceIds(evaluation)
    .map((id) => evidenceById.get(id))
    .filter(Boolean);
  for (const identity of [
    (evidence) => evidence.sourceIdentity.sourceId,
    (evidence) => evidence.sourceIdentity.digest,
    (evidence) => evidence.producerId,
    (evidence) => evidence.verifierId,
    (evidence) => evidence.verifierOwnerId,
    (evidence) => validatorIdentity(evidence.validator),
    (evidence) => evidence.independenceBasisEvidenceIds[0],
  ]) {
    if (new Set(diagnosticEvidence.map(identity)).size !== diagnosticEvidence.length) return false;
  }
  if (!allUnique(diagnosticEvidence.flatMap((evidence) => [evidence.producerId, evidence.verifierId]))) return false;
  const diagnosticDomainIdentities = diagnosticEvidence.flatMap((evidence) => [
    ...evidence.producerFailureDomains,
    ...evidence.verifierFailureDomains,
  ]).map(domainIdentity);
  if (!allUnique(diagnosticDomainIdentities)) return false;
  return evaluation.diagnosticPlane.status === diagnosticClaim.result
    && sameIds(evaluation.diagnosticPlane.reasonCodes, diagnosticClaim.reasonCodes);
}

function assumptionRelationshipsValid(evaluation, assumptionById) {
  const unknownReasonsByFreshness = {
    CURRENT: ['WEAK', 'MISSING', 'UNREGISTERED'],
    EXPIRED: ['EXPIRED'],
    NOT_YET_VALID: ['NOT_YET_VALID'],
    INCOHERENT: ['INCOHERENT'],
    INVALID_TIMELINE: ['INVALID_TIMELINE'],
    CLOCK_INVALID: ['CLOCK_INVALID'],
    EVIDENCE_MISSING: ['MISSING'],
  };
  for (const assumption of assumptionById.values()) {
    if (
      assumption.freshnessStatus === 'EXPIRED'
      && (
        !isValidUtcMillis(assumption.staleAtMs)
        || assumption.staleAtMs > assumption.sourceEvaluatedAtMs
        || assumption.staleAtMs > evaluation.evaluatedAtMs
      )
    ) return false;
    if (
      assumption.declaredResult === 'PASS'
      && (
        assumption.freshnessStatus !== 'CURRENT'
        || !isValidUtcMillis(assumption.staleAtMs)
        || assumption.sourceEvaluatedAtMs > assumption.staleAtMs
      )
    ) return false;
    let expectedResult = assumption.declaredResult;
    if (assumption.declaredResult !== 'FAIL') {
      if (assumption.sourceEvaluatedAtMs !== evaluation.evaluatedAtMs) expectedResult = 'UNKNOWN';
      if (assumption.declaredResult === 'UNKNOWN' || assumption.freshnessStatus !== 'CURRENT') expectedResult = 'UNKNOWN';
    }
    const expectedReasonCodes = [];
    if (assumption.sourceEvaluatedAtMs !== evaluation.evaluatedAtMs) {
      expectedReasonCodes.push('S1_PROJECTION_NOT_CURRENT');
    }
    if (assumption.declaredResult === 'FAIL') {
      expectedReasonCodes.push('CONTRADICTED', 'S1_ASSUMPTION_FAILED');
    } else if (assumption.declaredResult === 'UNKNOWN') {
      const allowedSourceReasons = unknownReasonsByFreshness[assumption.freshnessStatus] ?? [];
      const observedSourceReasons = allowedSourceReasons.filter((reasonCode) => assumption.reasonCodes.includes(reasonCode));
      if (observedSourceReasons.length !== 1) return false;
      expectedReasonCodes.push(observedSourceReasons[0], 'S1_ASSUMPTION_UNKNOWN');
    } else if (assumption.freshnessStatus !== 'CURRENT') {
      expectedReasonCodes.push(assumption.freshnessStatus, 'S1_ASSUMPTION_NOT_CURRENT');
    } else if (expectedResult === 'PASS') {
      expectedReasonCodes.push('VALIDATED', 'S1_ASSUMPTION_CURRENT');
    }
    const expectedAgeMs = evaluation.evaluatedAtMs >= assumption.sourceEvaluatedAtMs
      ? evaluation.evaluatedAtMs - assumption.sourceEvaluatedAtMs
      : null;
    const expectedInvalidatedAtMs = expectedResult === 'PASS'
      ? null
      : assumption.declaredResult === 'FAIL'
        ? assumption.sourceEvaluatedAtMs
        : assumption.freshnessStatus === 'EXPIRED' && isValidUtcMillis(assumption.staleAtMs)
          ? assumption.staleAtMs
          : assumption.sourceEvaluatedAtMs;
    if (
      assumption.result !== expectedResult
      || !sameIds(assumption.reasonCodes, stableUnique(expectedReasonCodes))
      || !nullableEqual(assumption.ageMs, expectedAgeMs)
      || !nullableEqual(assumption.invalidatedAtMs, expectedInvalidatedAtMs)
    ) return false;
  }
  return true;
}

function buildInvalidationParentMap(evaluation, claimById, evidenceById) {
  const parents = new Map();
  const add = (child, parent) => {
    if (!parents.has(child)) parents.set(child, new Set());
    parents.get(child).add(parent);
  };
  for (const claim of claimById.values()) {
    for (const subclaimId of claim.subclaimIds) add(`claim:${subclaimId}`, `claim:${claim.claimId}`);
    for (const evidenceId of [...claim.supportingEvidenceIds, ...claim.counterEvidenceIds]) {
      add(`evidence:${evidenceId}`, `claim:${claim.claimId}`);
    }
    for (const assumptionId of claim.appliedAssumptionIds) add(`assumption:${assumptionId}`, `claim:${claim.claimId}`);
  }
  for (const evidence of evidenceById.values()) {
    for (const claimId of evidence.derivedFromClaimIds) add(`claim:${claimId}`, `evidence:${evidence.evidenceId}`);
    for (const dependencyId of [...evidence.derivedFromEvidenceIds, ...evidence.independenceBasisEvidenceIds]) {
      add(`evidence:${dependencyId}`, `evidence:${evidence.evidenceId}`);
    }
  }
  for (const reasonCode of evaluation.diagnosticPlane.reasonCodes.filter((code) => (
    code.endsWith('_EVIDENCE_MISSING') || code === 'DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM'
  ))) add(`diagnostic:${reasonCode}`, 'claim:PA-S4-CLAIM-013');
  for (const evidenceId of diagnosticPlaneEvidenceIds(evaluation)) {
    add(`evidence:${evidenceId}`, 'claim:PA-S4-CLAIM-013');
  }
  return parents;
}

const invalidationPathSignature = (originType, originId, dependentClaimId, path) => (
  `${originType}|${originId}|${dependentClaimId}|${path.join('>')}`
);

function expectedInvalidationPathSignatures(
  evaluation,
  claimById,
  evidenceById,
  assumptionById,
  parents,
) {
  const origins = [];
  for (const evidence of evidenceById.values()) {
    if (evidence.primitiveInvalidator === true) origins.push({
      originType: 'EVIDENCE',
      originId: evidence.evidenceId,
      invalidatedAtMs: evidence.localInvalidatedAtMs,
    });
  }
  for (const node of parents.keys()) {
    if (node.startsWith('evidence:') && !evidenceById.has(node.slice('evidence:'.length))) {
      origins.push({
        originType: 'EVIDENCE',
        originId: node.slice('evidence:'.length),
        invalidatedAtMs: null,
      });
    }
  }
  for (const assumption of assumptionById.values()) {
    if (assumption.result !== 'PASS') origins.push({
      originType: 'ASSUMPTION',
      originId: assumption.assumptionId,
      invalidatedAtMs: assumption.invalidatedAtMs,
    });
  }
  for (const reasonCode of evaluation.diagnosticPlane.reasonCodes) {
    if (reasonCode.endsWith('_EVIDENCE_MISSING') || reasonCode === 'DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM') {
      origins.push({ originType: 'DIAGNOSTIC', originId: reasonCode, invalidatedAtMs: null });
    }
  }

  const uniqueOrigins = [...new Map(origins.map((origin) => [
    `${origin.originType}:${origin.originId}`,
    origin,
  ])).values()].sort((left, right) => (
    compareCanonical(left.originType, right.originType) || compareCanonical(left.originId, right.originId)
  ));
  const descriptors = [];
  const signatureSet = new Set();
  const maximumSteps = SCHEMA_LIMITS.maxInvalidationPaths * SCHEMA_LIMITS.maxInvalidationPathLength;
  let traversalSteps = 0;
  let overflow = false;
  const nodeResult = (node) => {
    if (node.startsWith('claim:')) return claimById.get(node.slice('claim:'.length))?.result;
    if (node.startsWith('evidence:')) return evidenceById.get(node.slice('evidence:'.length))?.result ?? 'UNKNOWN';
    if (node.startsWith('assumption:')) return assumptionById.get(node.slice('assumption:'.length))?.result;
    if (node.startsWith('diagnostic:')) return 'UNKNOWN';
    return undefined;
  };
  const displayNode = (node) => {
    if (node.startsWith('claim:')) return node.slice('claim:'.length);
    const separator = node.indexOf(':');
    return `${node.slice(0, separator).toUpperCase()}:${node.slice(separator + 1)}`;
  };
  const sortedParents = (node) => [...(parents.get(node) ?? [])].sort();
  const appendSignature = (origin, claimId, path) => {
    const signature = invalidationPathSignature(origin.originType, origin.originId, claimId, path);
    if (signatureSet.has(signature)) return true;
    if (descriptors.length >= SCHEMA_LIMITS.maxInvalidationPaths) {
      overflow = true;
      return false;
    }
    signatureSet.add(signature);
    descriptors.push({
      originType: origin.originType,
      originId: origin.originId,
      claimId,
      path,
      signature,
    });
    return true;
  };
  const pathFromOriginToClaim = (origin, targetClaimId) => {
    const start = `${origin.originType.toLowerCase()}:${origin.originId}`;
    const queue = [{ node: start, path: [`${origin.originType}:${origin.originId}`] }];
    const visited = new Set([start]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      if (current.path.length >= SCHEMA_LIMITS.maxInvalidationPathLength) continue;
      for (const parent of sortedParents(current.node)) {
        if (nodeResult(parent) === 'PASS') continue;
        const nextPath = [...current.path, displayNode(parent)];
        if (parent === `claim:${targetClaimId}`) return nextPath;
        if (!visited.has(parent)) {
          visited.add(parent);
          queue.push({ node: parent, path: nextPath });
        }
      }
    }
    return null;
  };
  const nonPassClaimIds = [...claimById.values()]
    .filter((claim) => claim.result !== 'PASS')
    .map((claim) => claim.claimId)
    .sort();
  for (const claimId of nonPassClaimIds) {
    for (const origin of uniqueOrigins) {
      const path = pathFromOriginToClaim(origin, claimId);
      if (path) {
        appendSignature(origin, claimId, path);
        break;
      }
    }
  }

  for (const origin of uniqueOrigins) {
    const start = `${origin.originType.toLowerCase()}:${origin.originId}`;
    const walk = (node, path, visited) => {
      if (overflow) return;
      if (visited.has(node)) return;
      const eligibleParents = sortedParents(node).filter((parent) => nodeResult(parent) !== 'PASS');
      if (traversalSteps >= maximumSteps || path.length >= SCHEMA_LIMITS.maxInvalidationPathLength) {
        if (eligibleParents.length > 0) overflow = true;
        return;
      }
      traversalSteps += 1;
      for (const parent of eligibleParents) {
        const nextPath = [...path, displayNode(parent)];
        if (parent.startsWith('claim:')) {
          const claimId = parent.slice('claim:'.length);
          if (!appendSignature(origin, claimId, nextPath)) return;
        }
        const nextVisited = new Set(visited);
        nextVisited.add(node);
        walk(parent, nextPath, nextVisited);
        if (overflow) return;
      }
    };
    walk(start, [`${origin.originType}:${origin.originId}`], new Set());
    if (overflow) break;
  }

  const undeterminedClaimIds = new Set();
  for (const origin of uniqueOrigins.filter((entry) => !isValidUtcMillis(entry.invalidatedAtMs))) {
    const start = `${origin.originType.toLowerCase()}:${origin.originId}`;
    const queue = [start];
    const visited = new Set([start]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const parent of sortedParents(queue[cursor])) {
        if (nodeResult(parent) === 'PASS' || visited.has(parent)) continue;
        visited.add(parent);
        if (parent.startsWith('claim:')) undeterminedClaimIds.add(parent.slice('claim:'.length));
        queue.push(parent);
      }
    }
  }
  descriptors.sort((left, right) => (
    compareCanonical(left.originType, right.originType)
    || compareCanonical(left.originId, right.originId)
    || compareCanonical(left.path.join('>'), right.path.join('>'))
  ));
  return {
    signatures: descriptors.map((descriptor) => descriptor.signature),
    overflow,
    undeterminedClaimIds,
  };
}

const pathDisplayToNode = (display) => {
  for (const type of ['EVIDENCE', 'ASSUMPTION', 'DIAGNOSTIC']) {
    const prefix = `${type}:`;
    if (display.startsWith(prefix)) return `${type.toLowerCase()}:${display.slice(prefix.length)}`;
  }
  return `claim:${display}`;
};

function invalidationPathValid(path, evaluation, claimById, evidenceById, assumptionById, parents) {
  if (
    !exactObject(path, PATH_FIELDS)
    || !['EVIDENCE', 'ASSUMPTION', 'DIAGNOSTIC'].includes(path.originType)
    || !isId(path.originId)
    || !resultValid(path.originResult)
    || !nullableNonNegativeInteger(path.originAgeMs)
    || !isText(path.originFreshnessStatus)
    || !nullableUtc(path.originInvalidAtMs)
    || !claimById.has(path.dependentClaimId)
    || !resultValid(path.dependentResult)
    || !isUniqueIdArray(path.path, SCHEMA_LIMITS.maxInvalidationPathLength)
    || path.path.length < 2
    || path.observedAtMs !== evaluation.evaluatedAtMs
    || !nullableUtc(path.projectionDueAtMs)
    || !boundedPositiveInteger(path.propagationSloMs)
    || ![true, false, null].includes(path.propagationSloMet)
    || !isId(path.ownerId)
    || path.supportUsableForNewAction !== false
  ) return false;
  const claim = claimById.get(path.dependentClaimId);
  const origin = path.originType === 'EVIDENCE'
    ? evidenceById.get(path.originId)
    : path.originType === 'ASSUMPTION'
      ? assumptionById.get(path.originId)
      : null;
  const expectedStart = `${path.originType}:${path.originId}`;
  const computedDueAtMs = isValidUtcMillis(path.originInvalidAtMs)
    ? path.originInvalidAtMs + claim.propagationSloMs
    : null;
  const expectedDueAtMs = isValidUtcMillis(computedDueAtMs) ? computedDueAtMs : null;
  const expectedSloMet = isValidUtcMillis(expectedDueAtMs)
    ? evaluation.evaluatedAtMs <= expectedDueAtMs
    : null;
  if (
    path.path[0] !== expectedStart
    || path.path.at(-1) !== path.dependentClaimId
    || path.dependentResult !== claim.result
    || claim.result === 'PASS'
    || path.ownerId !== claim.resultConsumerOwner.ownerId
    || path.propagationSloMs !== claim.propagationSloMs
    || !nullableEqual(path.projectionDueAtMs, expectedDueAtMs)
    || path.propagationSloMet !== expectedSloMet
  ) return false;
  const pathNodes = path.path.map(pathDisplayToNode);
  for (let position = 1; position < pathNodes.length; position += 1) {
    const child = pathNodes[position - 1];
    const parent = pathNodes[position];
    if (!parents.get(child)?.has(parent)) return false;
    const [type, ...idParts] = parent.split(':');
    const id = idParts.join(':');
    const nodeResult = type === 'claim'
      ? claimById.get(id)?.result
      : type === 'evidence'
        ? evidenceById.get(id)?.result
        : type === 'assumption'
          ? assumptionById.get(id)?.result
          : 'UNKNOWN';
    if (nodeResult === 'PASS' || nodeResult === undefined) return false;
  }
  if (origin) {
    if (path.originType === 'EVIDENCE' && origin.primitiveInvalidator !== true) return false;
    if (path.originType === 'ASSUMPTION' && origin.result === 'PASS') return false;
    return path.originResult === origin.result
      && nullableEqual(path.originAgeMs, origin.ageMs)
      && path.originFreshnessStatus === origin.freshnessStatus
      && nullableEqual(
        path.originInvalidAtMs,
        path.originType === 'EVIDENCE' ? origin.localInvalidatedAtMs : origin.invalidatedAtMs,
      );
  }
  if (path.originType === 'EVIDENCE') {
    return path.originResult === 'UNKNOWN'
      && path.originAgeMs === null
      && path.originFreshnessStatus === 'EVIDENCE_MISSING'
      && path.originInvalidAtMs === null;
  }
  return path.originType === 'DIAGNOSTIC'
    && evaluation.diagnosticPlane.reasonCodes.includes(path.originId)
    && (path.originId.endsWith('_EVIDENCE_MISSING') || path.originId === 'DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM')
    && path.originResult === 'UNKNOWN'
    && path.originAgeMs === null
    && path.originFreshnessStatus === 'UNKNOWN'
    && path.originInvalidAtMs === null;
}

function recommendationValid(recommendation, claimById) {
  if (
    !exactObject(recommendation, [
      'claimId', 'result', 'invariantId', 'eventRecommendation',
      'incidentRecommendation', 'commandAuthority',
    ])
    || !claimById.has(recommendation.claimId)
    || !resultValid(recommendation.result)
    || !isId(recommendation.invariantId)
    || !exactObject(recommendation.eventRecommendation, ['type', 'ownerId'])
    || !exactObject(recommendation.incidentRecommendation, ['type', 'ownerId'])
    || recommendation.commandAuthority !== 'NONE'
  ) return false;
  const claim = claimById.get(recommendation.claimId);
  return claim.result !== 'PASS'
    && recommendation.result === claim.result
    && recommendation.invariantId === claim.invariantProjection.invariantId
    && recommendation.eventRecommendation.type === SAFE_EVENT_RECOMMENDATION_TYPE
    && recommendation.eventRecommendation.ownerId === claim.resultConsumerOwner.ownerId
    && recommendation.incidentRecommendation.type === SAFE_INCIDENT_RECOMMENDATION_TYPE
    && recommendation.incidentRecommendation.ownerId === claim.resultConsumerOwner.ownerId;
}

function recomputationValid(recomputation, evaluation, claimById, undeterminedClaimIds) {
  if (
    !exactObject(recomputation, [
      'applicable', 'originInvalidatedAtMs', 'logicalCompletedAtMs', 'assuranceSloMs',
      'assuranceDueAtMs', 'completedWithinDeclaredSlo', 'affectedClaimDeadlines',
    ])
    || typeof recomputation.applicable !== 'boolean'
    || !nullableUtc(recomputation.originInvalidatedAtMs)
    || recomputation.logicalCompletedAtMs !== evaluation.evaluatedAtMs
    || !boundedPositiveInteger(recomputation.assuranceSloMs)
    || !nullableUtc(recomputation.assuranceDueAtMs)
    || ![true, false, null].includes(recomputation.completedWithinDeclaredSlo)
    || !Array.isArray(recomputation.affectedClaimDeadlines)
  ) return false;
  const nonPassClaims = [...claimById.values()].filter((claim) => claim.result !== 'PASS');
  const deadlines = recomputation.affectedClaimDeadlines;
  if (deadlines.length !== nonPassClaims.length) return false;
  const deadlineClaimIds = [];
  for (const deadline of deadlines) {
    if (
      !exactObject(deadline, [
        'claimId', 'invalidatedAtMs', 'assuranceSloMs', 'assuranceDueAtMs',
        'completedWithinDeclaredSlo',
      ])
      || !claimById.has(deadline.claimId)
      || !nullableUtc(deadline.invalidatedAtMs)
      || !boundedPositiveInteger(deadline.assuranceSloMs)
      || !nullableUtc(deadline.assuranceDueAtMs)
      || ![true, false, null].includes(deadline.completedWithinDeclaredSlo)
    ) return false;
    const claim = claimById.get(deadline.claimId);
    const computedDueAtMs = isValidUtcMillis(claim.invalidatedAtMs)
      ? claim.invalidatedAtMs + claim.assuranceSloMs
      : null;
    const expectedDueAtMs = isValidUtcMillis(computedDueAtMs) ? computedDueAtMs : null;
    const expectedCompleted = !isValidUtcMillis(expectedDueAtMs)
      ? null
      : evaluation.evaluatedAtMs > expectedDueAtMs
        ? false
        : undeterminedClaimIds.has(claim.claimId)
          ? null
          : true;
    if (
      claim.result === 'PASS'
      || !nullableEqual(deadline.invalidatedAtMs, claim.invalidatedAtMs)
      || deadline.assuranceSloMs !== claim.assuranceSloMs
      || !nullableEqual(deadline.assuranceDueAtMs, expectedDueAtMs)
      || deadline.completedWithinDeclaredSlo !== expectedCompleted
    ) return false;
    deadlineClaimIds.push(deadline.claimId);
  }
  if (!sameIds(deadlineClaimIds, nonPassClaims.map((claim) => claim.claimId))) return false;
  const expectedOrigin = minimumUtcMillis(nonPassClaims.map((claim) => claim.invalidatedAtMs));
  const expectedDue = minimumUtcMillis(deadlines.map((deadline) => deadline.assuranceDueAtMs));
  const expectedCompleted = nonPassClaims.length === 0
    ? true
    : deadlines.some((deadline) => deadline.completedWithinDeclaredSlo === false)
      ? false
      : deadlines.some((deadline) => deadline.completedWithinDeclaredSlo === null)
        ? null
        : true;
  return recomputation.applicable === (nonPassClaims.length > 0)
    && nullableEqual(recomputation.originInvalidatedAtMs, expectedOrigin)
    && nullableEqual(recomputation.assuranceDueAtMs, expectedDue)
    && recomputation.assuranceSloMs === ASSURANCE_CASE_PROPAGATION_POLICY.assuranceSloMs
    && recomputation.assuranceSloMs === Math.max(...[...claimById.values()].map((claim) => claim.assuranceSloMs))
    && recomputation.completedWithinDeclaredSlo === expectedCompleted;
}

function rootReasonCodesValid(evaluation, claimById, assumptionById) {
  const claimResults = [...claimById.values()];
  const baseStatus = statusFrom(claimResults.map((claim) => claim.result));
  let expectedStatus = evaluation.invalidationTruncated && baseStatus === 'PASS' ? 'UNKNOWN' : baseStatus;
  const expectedReasons = [];
  if (expectedStatus === 'PASS') expectedReasons.push('ALL_MANDATORY_DERIVED_CLAIMS_PASS');
  if (claimResults.some((claim) => claim.result === 'FAIL')) expectedReasons.push('DERIVED_CLAIM_FAILED');
  if (claimResults.some((claim) => claim.result === 'UNKNOWN')) expectedReasons.push('DERIVED_CLAIM_UNKNOWN');
  if ([...assumptionById.values()].some((assumption) => assumption.sourceEvaluatedAtMs !== evaluation.evaluatedAtMs)) {
    expectedReasons.push('S1_PROJECTION_NOT_CURRENT');
  }
  if (evaluation.packetIssues.length > 0) expectedReasons.push('EVALUATED_PACKET_ISSUES_PRESENT');
  if (evaluation.invalidationTruncated) expectedReasons.push('INVALIDATION_PATHS_TRUNCATED');
  if (evaluation.invalidationPaths.some((path) => path.propagationSloMet === false)) {
    expectedReasons.push('PROPAGATION_SLO_MISSED');
  }
  if (evaluation.invalidationPaths.some((path) => path.propagationSloMet === null)) {
    expectedReasons.push('PROPAGATION_SLO_UNDETERMINED');
  }
  if (evaluation.recomputation.completedWithinDeclaredSlo === false) expectedReasons.push('ASSURANCE_SLO_MISSED');
  if (evaluation.recomputation.completedWithinDeclaredSlo === null) expectedReasons.push('ASSURANCE_SLO_UNDETERMINED');
  if (evaluation.packetIssues.length > 0 && expectedStatus === 'PASS') {
    expectedStatus = 'UNKNOWN';
    expectedReasons.push('UNHANDLED_PACKET_ISSUE');
  }
  return evaluation.status === expectedStatus
    && sameIds(evaluation.reasonCodes, stableUnique(expectedReasons));
}

function safetyBoundaryValid(safetyBoundary, evaluation) {
  return exactObject(safetyBoundary, [
    'readOnly', 'supportUsableForNewAction', 'doesNotBlockCanonicalRiskReduction',
    'riskReductionAvailabilityOwner', 'llmMayExplain', 'llmMayRestoreSupport',
    'prohibitedCommands', 'commandsIssued',
  ])
    && safetyBoundary.readOnly === true
    && safetyBoundary.supportUsableForNewAction === (
      evaluation.status === 'PASS'
      && evaluation.packetIssues.length === 0
      && evaluation.invalidationTruncated === false
    )
    && safetyBoundary.doesNotBlockCanonicalRiskReduction === true
    && safetyBoundary.riskReductionAvailabilityOwner === 'EXISTING_CANONICAL_OWNERS'
    && safetyBoundary.llmMayExplain === true
    && safetyBoundary.llmMayRestoreSupport === false
    && sameIds(safetyBoundary.prohibitedCommands, PROHIBITED_ASSURANCE_COMMANDS)
    && safetyBoundary.commandsIssued === 0;
}

function evaluationShapeValid(evaluation) {
  if (
    !exactObject(evaluation, ROOT_FIELDS)
    || evaluation.schemaVersion !== ASSURANCE_CASE_EVALUATION_VERSION
    || !isValidUtcMillis(evaluation.evaluatedAtMs)
    || !resultValid(evaluation.status)
    || evaluation.truthLabel !== 'SYNTHETIC_ONLY'
    || evaluation.authorityEffect !== 'NONE'
    || evaluation.runtimeProjectionOwner !== 'I08.machine-supervisor'
    || evaluation.machineResponseOwner !== 'EXISTING_CANONICAL_OWNERS'
    || !isCanonicalIdArray(evaluation.reasonCodes)
    || !Array.isArray(evaluation.packetIssues)
    || !evaluation.packetIssues.every(issueValid)
    || !evaluation.packetIssues.every((entry) => NON_FATAL_PACKET_ISSUES.includes(entry.code))
    || !Array.isArray(evaluation.s1ProjectionIssues)
    || evaluation.s1ProjectionIssues.length !== 0
    || !Array.isArray(evaluation.claimResults)
    || !Array.isArray(evaluation.evidenceResults)
    || !Array.isArray(evaluation.assumptionResults)
    || !Array.isArray(evaluation.invalidationPaths)
    || evaluation.invalidationPaths.length > SCHEMA_LIMITS.maxInvalidationPaths
    || !Array.isArray(evaluation.recommendations)
    || typeof evaluation.invalidationTruncated !== 'boolean'
    || !exactObject(evaluation.mandatoryCoverage, [
      'requiredClaimIds', 'presentClaimIds', 'missingClaimIds', 'unexpectedClaimIds',
    ])
    || !exactObject(evaluation.diagnosticPlane, DIAGNOSTIC_PLANE_FIELDS)
    || !DIAGNOSTIC_POSTURES.includes(evaluation.diagnosticPlane.posture)
    || !resultValid(evaluation.diagnosticPlane.status)
    || !isCanonicalIdArray(evaluation.diagnosticPlane.reasonCodes)
    || !Object.keys(DIAGNOSTIC_EVIDENCE_REQUIREMENTS).every((field) => (
      isCanonicalIdArray(evaluation.diagnosticPlane[field], SCHEMA_LIMITS.maxEdgesPerNode)
    ))
  ) return false;

  const claimIds = evaluation.claimResults.map((claim) => claim?.claimId);
  if (
    !sameIds(claimIds, REQUIRED_MANDATORY_CLAIM_IDS)
    || !sameIds(evaluation.mandatoryCoverage.requiredClaimIds, REQUIRED_MANDATORY_CLAIM_IDS)
    || !sameIds(evaluation.mandatoryCoverage.presentClaimIds, REQUIRED_MANDATORY_CLAIM_IDS)
    || !sameIds(evaluation.mandatoryCoverage.missingClaimIds, [])
    || !sameIds(evaluation.mandatoryCoverage.unexpectedClaimIds, [])
  ) return false;

  const claimById = new Map();
  for (const requirement of MANDATORY_CLAIM_REQUIREMENTS) {
    const claim = evaluation.claimResults.find((entry) => entry?.claimId === requirement.claimId);
    if (!mandatoryClaimRecordValid(claim, requirement, evaluation.diagnosticPlane.posture)) return false;
    claimById.set(claim.claimId, claim);
  }
  const evidenceIds = evaluation.evidenceResults.map((evidence) => evidence?.evidenceId);
  if (!isUniqueIdArray(evidenceIds, SCHEMA_LIMITS.maxEvidence)) return false;
  const evidenceById = new Map();
  for (const evidence of evaluation.evidenceResults) {
    if (!evidenceRecordValid(evidence)) return false;
    evidenceById.set(evidence.evidenceId, evidence);
  }
  const assumptionIds = evaluation.assumptionResults.map((assumption) => assumption?.assumptionId);
  if (!sameIds(assumptionIds, ACCEPTED_S1_ASSUMPTION_IDS)) return false;
  const assumptionById = new Map();
  for (const assumption of evaluation.assumptionResults) {
    if (!assumptionRecordValid(assumption)) return false;
    assumptionById.set(assumption.assumptionId, assumption);
  }

  if (
    !packetIssueRelationshipsValid(evaluation, evidenceById, claimById)
    || !assumptionRelationshipsValid(evaluation, assumptionById)
    || !evidenceRelationshipsValid(evaluation, evidenceById, claimById)
    || !claimRelationshipsValid(evaluation, claimById, evidenceById, assumptionById)
  ) return false;

  const invalidationParents = buildInvalidationParentMap(evaluation, claimById, evidenceById);
  if (!evaluation.invalidationPaths.every((path) => (
    invalidationPathValid(path, evaluation, claimById, evidenceById, assumptionById, invalidationParents)
  ))) return false;
  const pathClaimIds = new Set(evaluation.invalidationPaths.map((path) => path.dependentClaimId));
  if ([...claimById.values()].some((claim) => claim.result !== 'PASS' && !pathClaimIds.has(claim.claimId))) return false;
  const expectedPaths = expectedInvalidationPathSignatures(
    evaluation,
    claimById,
    evidenceById,
    assumptionById,
    invalidationParents,
  );
  if (expectedPaths.overflow !== evaluation.invalidationTruncated) return false;
  const actualSignatures = evaluation.invalidationPaths.map((path) => (
    invalidationPathSignature(path.originType, path.originId, path.dependentClaimId, path.path)
  ));
  if (
    !allUnique(actualSignatures)
    || actualSignatures.length !== expectedPaths.signatures.length
    || actualSignatures.some((signature, position) => signature !== expectedPaths.signatures[position])
  ) return false;

  if (!evaluation.recommendations.every((entry) => recommendationValid(entry, claimById))) return false;
  const recommendedClaimIds = evaluation.recommendations.map((entry) => entry.claimId);
  const nonPassClaimIds = [...claimById.values()].filter((claim) => claim.result !== 'PASS').map((claim) => claim.claimId);
  if (!sameIds(recommendedClaimIds, nonPassClaimIds)) return false;
  if (
    !recomputationValid(evaluation.recomputation, evaluation, claimById, expectedPaths.undeterminedClaimIds)
    || !rootReasonCodesValid(evaluation, claimById, assumptionById)
    || !safetyBoundaryValid(evaluation.safetyBoundary, evaluation)
  ) return false;

  if (evaluation.status === 'PASS') {
    const appliedAssumptionIds = stableUnique([...claimById.values()].flatMap((claim) => claim.appliedAssumptionIds));
    if (
      !sameIds(evaluation.reasonCodes, ['ALL_MANDATORY_DERIVED_CLAIMS_PASS'])
      || evaluation.packetIssues.length !== 0
      || [...evidenceById.values()].some((evidence) => evidence.result !== 'PASS')
      || appliedAssumptionIds.some((id) => assumptionById.get(id).result !== 'PASS')
      || evaluation.invalidationPaths.length !== 0
      || evaluation.recommendations.length !== 0
      || evaluation.invalidationTruncated !== false
      || evaluation.recomputation.applicable !== false
    ) return false;
  }
  return true;
}

const mapClaim = (claim) => ({
  claimId: claim.claimId,
  requirementKey: claim.requirementKey,
  statement: claim.statement,
  scope: claim.scope,
  capitalCritical: claim.capitalCritical,
  status: claim.result,
  validator: copyValidator(claim.validator),
  canonicalOwner: copyOwner(claim.canonicalOwner),
  resultConsumerOwner: copyOwner(claim.resultConsumerOwner),
  reasonCodes: [...stableUnique(claim.reasonCodes)],
  subclaimIds: [...stableUnique(claim.subclaimIds)],
  assumptionIds: [...stableUnique(claim.assumptionIds)],
  appliedAssumptionIds: [...stableUnique(claim.appliedAssumptionIds)],
  supportingEvidenceIds: [...stableUnique(claim.supportingEvidenceIds)],
  counterEvidenceIds: [...stableUnique(claim.counterEvidenceIds)],
  invalidatingEvidenceIds: [...stableUnique(claim.invalidatingEvidenceIds)],
  invalidatingAssumptionIds: [...stableUnique(claim.invalidatingAssumptionIds)],
  invalidatingSubclaimIds: [...stableUnique(claim.invalidatingSubclaimIds)],
  invalidatedAtMs: claim.invalidatedAtMs,
  propagationSloMs: claim.propagationSloMs,
  assuranceSloMs: claim.assuranceSloMs,
  invariantProjection: {
    invariantId: claim.invariantProjection.invariantId,
    eventRecommendationType: claim.invariantProjection.eventRecommendationType,
    incidentRecommendationType: claim.invariantProjection.incidentRecommendationType,
  },
  cockpitProjection: {
    surface: claim.cockpitProjection.surface,
    summaryField: claim.cockpitProjection.summaryField,
    drillDown: claim.cockpitProjection.drillDown,
  },
  componentResults: claim.componentResults.map((component) => ({
    componentId: component.componentId,
    componentScope: component.componentScope,
    canonicalOwnerId: component.canonicalOwnerId,
    supportingEvidenceIds: [...stableUnique(component.supportingEvidenceIds)],
    status: component.result,
    invalidatingEvidenceIds: [...stableUnique(component.invalidatingEvidenceIds)],
    supportUsableForNewAction: component.supportUsableForNewAction,
  })),
  supportUsableForNewAction: claim.supportUsableForNewAction,
});

const mapEvidence = (evidence) => ({
  evidenceId: evidence.evidenceId,
  role: evidence.role,
  purpose: evidence.purpose,
  kind: evidence.kind,
  statement: evidence.statement,
  claimBinding: {
    claimId: evidence.claimBinding.claimId,
    requirementKey: evidence.claimBinding.requirementKey,
    scope: evidence.claimBinding.scope,
  },
  capitalCritical: evidence.capitalCritical,
  status: evidence.result,
  declaredResult: evidence.declaredResult,
  reasonCodes: [...stableUnique(evidence.reasonCodes)],
  sourceIdentity: {
    sourceId: evidence.sourceIdentity.sourceId,
    sourceType: evidence.sourceIdentity.sourceType,
    revision: evidence.sourceIdentity.revision,
    digest: evidence.sourceIdentity.digest,
  },
  validator: copyValidator(evidence.validator),
  producer: {
    actorId: evidence.producerId,
    ownerId: evidence.producerOwnerId,
    failureDomains: evidence.producerFailureDomains.map(copyDomain),
  },
  verifier: {
    actorId: evidence.verifierId,
    ownerId: evidence.verifierOwnerId,
    failureDomains: evidence.verifierFailureDomains.map(copyDomain),
  },
  independence: {
    status: evidence.independenceStatus,
    declaredClass: evidence.independenceClass,
    basisEvidenceIds: [...stableUnique(evidence.independenceBasisEvidenceIds)],
    sharedFailureDomains: [...stableUnique(evidence.sharedFailureDomains)],
    commonModeDependencyIds: [...stableUnique(evidence.commonModeDependencyIds)],
    requiredFailureDomainClasses: [...stableUnique(evidence.requiredFailureDomainClasses)],
    missingProducerFailureDomainClasses: [...stableUnique(evidence.missingProducerFailureDomainClasses)],
    missingVerifierFailureDomainClasses: [...stableUnique(evidence.missingVerifierFailureDomainClasses)],
  },
  derivedFromClaimIds: [...stableUnique(evidence.derivedFromClaimIds)],
  derivedFromEvidenceIds: [...stableUnique(evidence.derivedFromEvidenceIds)],
  certifiesEvidenceIds: [...stableUnique(evidence.certifiesEvidenceIds)],
  freshnessStatus: evidence.freshnessStatus,
  createdAtMs: evidence.createdAtMs,
  lastVerifiedAtMs: evidence.lastVerifiedAtMs,
  expiresAtMs: evidence.expiresAtMs,
  maximumAgeMs: evidence.maximumAgeMs,
  ageMs: evidence.ageMs,
  invalidAtMs: evidence.invalidAtMs,
  localInvalidatedAtMs: evidence.localInvalidatedAtMs,
  invalidatedAtMs: evidence.invalidatedAtMs,
  primitiveInvalidator: evidence.primitiveInvalidator,
  supportUsableForNewAction: evidence.supportUsableForNewAction,
});

export function buildAssuranceCaseViewModel(evaluationInput) {
  const captured = capturePlainData(evaluationInput, EVALUATION_CAPTURE_LIMITS);
  if (!captured.ok) return unknownView('EVALUATION_CAPTURE_FAILED');
  const evaluation = captured.value;
  try {
    if (!evaluationShapeValid(evaluation)) return unknownView('EVALUATION_INVALID');

    const claims = evaluation.claimResults.map(mapClaim).sort((left, right) => compareCanonical(left.claimId, right.claimId));
    const evidence = evaluation.evidenceResults.map(mapEvidence).sort((left, right) => compareCanonical(left.evidenceId, right.evidenceId));
    const assumptions = evaluation.assumptionResults.map((assumption) => ({
      assumptionId: assumption.assumptionId,
      sourceOwnerId: assumption.sourceOwnerId,
      status: assumption.result,
      declaredResult: assumption.declaredResult,
      reasonCodes: [...stableUnique(assumption.reasonCodes)],
      freshnessStatus: assumption.freshnessStatus,
      sourceEvaluatedAtMs: assumption.sourceEvaluatedAtMs,
      staleAtMs: assumption.staleAtMs,
      ageMs: assumption.ageMs,
      invalidatedAtMs: assumption.invalidatedAtMs,
      supportUsableForNewAction: assumption.supportUsableForNewAction,
    })).sort((left, right) => compareCanonical(left.assumptionId, right.assumptionId));
    const invalidationPaths = evaluation.invalidationPaths.map((path) => ({
      originType: path.originType,
      originId: path.originId,
      originResult: path.originResult,
      originAgeMs: path.originAgeMs,
      originFreshnessStatus: path.originFreshnessStatus,
      originInvalidAtMs: path.originInvalidAtMs,
      dependentClaimId: path.dependentClaimId,
      dependentResult: path.dependentResult,
      path: [...path.path],
      observedAtMs: path.observedAtMs,
      projectionDueAtMs: path.projectionDueAtMs,
      propagationSloMs: path.propagationSloMs,
      propagationSloMet: path.propagationSloMet,
      ownerId: path.ownerId,
      supportUsableForNewAction: false,
    }));
    const recommendations = evaluation.recommendations.map((recommendation) => ({
      claimId: recommendation.claimId,
      result: recommendation.result,
      invariantId: recommendation.invariantId,
      eventRecommendation: {
        type: recommendation.eventRecommendation.type,
        ownerId: recommendation.eventRecommendation.ownerId,
      },
      incidentRecommendation: {
        type: recommendation.incidentRecommendation.type,
        ownerId: recommendation.incidentRecommendation.ownerId,
      },
      commandAuthority: 'NONE',
    }));
    const recomputation = {
      applicable: evaluation.recomputation.applicable,
      originInvalidatedAtMs: evaluation.recomputation.originInvalidatedAtMs,
      logicalCompletedAtMs: evaluation.recomputation.logicalCompletedAtMs,
      assuranceSloMs: evaluation.recomputation.assuranceSloMs,
      assuranceDueAtMs: evaluation.recomputation.assuranceDueAtMs,
      completedWithinDeclaredSlo: evaluation.recomputation.completedWithinDeclaredSlo,
      affectedClaimDeadlines: evaluation.recomputation.affectedClaimDeadlines.map((deadline) => ({
        claimId: deadline.claimId,
        invalidatedAtMs: deadline.invalidatedAtMs,
        assuranceSloMs: deadline.assuranceSloMs,
        assuranceDueAtMs: deadline.assuranceDueAtMs,
        completedWithinDeclaredSlo: deadline.completedWithinDeclaredSlo,
      })),
    };
    const safetyBoundary = {
      readOnly: true,
      supportUsableForNewAction: evaluation.safetyBoundary.supportUsableForNewAction,
      doesNotBlockCanonicalRiskReduction: true,
      riskReductionAvailabilityOwner: evaluation.safetyBoundary.riskReductionAvailabilityOwner,
      llmMayExplain: true,
      llmMayRestoreSupport: false,
      prohibitedCommands: [...PROHIBITED_ASSURANCE_COMMANDS],
      commandsIssued: 0,
    };
    const count = (status) => claims.filter((claim) => claim.status === status).length;

    return deepFreeze({
      schemaVersion: ASSURANCE_CASE_VIEW_MODEL_VERSION,
      sourceEvaluationVersion: evaluation.schemaVersion,
      evaluatedAtMs: evaluation.evaluatedAtMs,
      status: evaluation.status,
      truthLabel: 'SYNTHETIC_ONLY',
      authorityEffect: 'NONE',
      runtimeProjectionOwner: 'I08.machine-supervisor',
      summary: {
        mandatoryClaimCount: claims.length,
        passingClaimCount: count('PASS'),
        failingClaimCount: count('FAIL'),
        unknownClaimCount: count('UNKNOWN'),
        evidenceCount: evidence.length,
        invalidationPathCount: invalidationPaths.length,
        invalidationTruncated: evaluation.invalidationTruncated,
        attentionRequired: evaluation.status !== 'PASS',
        reasonCodes: [...stableUnique(evaluation.reasonCodes)],
      },
      diagnosticPlane: {
        posture: evaluation.diagnosticPlane.posture,
        status: evaluation.diagnosticPlane.status,
        reasonCodes: [...stableUnique(evaluation.diagnosticPlane.reasonCodes)],
        ...Object.fromEntries(Object.keys(DIAGNOSTIC_EVIDENCE_REQUIREMENTS).map((field) => [
          field,
          [...evaluation.diagnosticPlane[field]],
        ])),
      },
      claims,
      evidence,
      assumptions,
      invalidationPaths,
      recommendations,
      recomputation,
      safetyBoundary,
      controls: [],
    });
  } catch {
    return unknownView('EVALUATION_INVALID');
  }
}
