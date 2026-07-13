import {
  ACCEPTED_S1_ASSUMPTION_OWNERS,
  ACCEPTED_S1_SOURCE,
  ASSURANCE_DERIVED_REASON_CODES,
  ASSURANCE_CASE_PROPAGATION_POLICY,
  ASSURANCE_CASE_SCHEMA_VERSION,
  ASSURANCE_RESULTS,
  CLAIM_NODE_REQUIRED_FIELDS,
  COCKPIT_SURFACES,
  DIAGNOSTIC_EVIDENCE_REQUIREMENTS,
  DIAGNOSTIC_POSTURES,
  EVIDENCE_KINDS,
  EVIDENCE_PURPOSES,
  EVIDENCE_REQUIRED_FIELDS,
  EVIDENCE_ROLES,
  FAILURE_DOMAIN_CLASSES,
  INDEPENDENCE_CLASSES,
  MANDATORY_CLAIM_DRILL_DOWN,
  MANDATORY_CLAIM_REQUIREMENTS,
  MANDATORY_CLAIM_VALIDATOR,
  ACCEPTED_S1_ASSUMPTION_IDS,
  REQUIRED_MANDATORY_CLAIM_IDS,
  REQUIRED_MANDATORY_REQUIREMENT_KEYS,
  REQUIRED_ROOT_CLAIM_IDS,
  SAFE_EVENT_RECOMMENDATION_TYPE,
  SAFE_INCIDENT_RECOMMENDATION_TYPE,
  S1_ASSUMPTION_PROJECTION_VERSION,
  SCHEMA_LIMITS,
  UNSAFE_ASSURANCE_TEXT_PATTERN,
  canonicalEvidenceStatement,
} from './schema.mjs';
import { canonicalStringify, capturePlainData, compareCanonical, isValidUtcMillis, stableUnique } from './canonical.mjs';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const DIGEST_PATTERN = /^(?:sha256:[0-9a-f]{64}|fixture:[A-Za-z0-9._:/-]+)$/;
const SOURCE_REASON_PATTERN = /^SOURCE_(?:PASS|FAIL|UNKNOWN)_[A-Z0-9][A-Z0-9_]*$/;
const RESERVED_EVIDENCE_DERIVED_REASON_CODES = new Set(
  ASSURANCE_DERIVED_REASON_CODES.map((reasonCode) => reasonCode.toLowerCase()),
);
const ADVERSE_PASS_SOURCE_REASON = /(?:FAIL|UNKNOWN|EXPIRED|MISSING|INVALID|INCOHERENT|NOT_YET|COMMON_MODE|UNPROVEN|CONTRADICT|BLOCKED|UNAVAILABLE|COUNTEREVIDENCE_(?:CONFIRMED|PRESENT|DETECTED)|MISSING_SIGNAL_CONFIRMED)/i;

const issue = (path, code, message) => ({
  path: typeof path === 'string' ? path : '$',
  code: typeof code === 'string' ? code : 'SCHEMA_VALIDATION_EXCEPTION',
  message: typeof message === 'string' ? message : 'malformed nested value rejected',
});
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const arrayOrEmpty = (value) => Array.isArray(value) ? value : [];
const hasExactKeys = (value, required, optional = []) => {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const allowed = [...required, ...optional].sort();
  return actual.length >= required.length
    && required.every((key) => Object.hasOwn(value, key))
    && actual.every((key) => allowed.includes(key));
};
const validId = (value) => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= SCHEMA_LIMITS.maxIdLength
  && ID_PATTERN.test(value)
);
const validText = (value, maxLength, allowEmpty = false) => (
  typeof value === 'string'
  && (allowEmpty || value.length > 0)
  && value.length <= maxLength
);
const validEnum = (value, allowed) => allowed.includes(value);
const validIdArray = (value, max = SCHEMA_LIMITS.maxEdgesPerNode, min = 0) => (
  Array.isArray(value)
  && value.length >= min
  && value.length <= max
  && value.every(validId)
  && new Set(value).size === value.length
);
const sameIds = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, position) => value === sortedRight[position]);
};

function validateExactObject(value, path, fields, issues, optional = []) {
  if (!isObject(value)) {
    issues.push(issue(path, 'SCHEMA_OBJECT_REQUIRED', 'object required'));
    return false;
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) issues.push(issue(`${path}.${field}`, 'SCHEMA_REQUIRED_FIELD', 'required field missing'));
  }
  for (const field of Object.keys(value)) {
    if (![...fields, ...optional].includes(field)) issues.push(issue(`${path}.${field}`, 'SCHEMA_UNKNOWN_FIELD', 'field is not allowed'));
  }
  return true;
}

function validateId(value, path, issues) {
  if (!validId(value)) issues.push(issue(path, 'SCHEMA_ID_INVALID', 'bounded stable identifier required'));
}

function validateText(value, path, issues, maxLength = SCHEMA_LIMITS.maxLongTextLength) {
  if (!validText(value, maxLength)) issues.push(issue(path, 'SCHEMA_TEXT_INVALID', 'bounded non-empty text required'));
}

function validateIdArray(value, path, issues, max = SCHEMA_LIMITS.maxEdgesPerNode, min = 0) {
  if (!validIdArray(value, max, min)) issues.push(issue(path, 'SCHEMA_ID_ARRAY_INVALID', 'bounded unique identifier array required'));
}

function validateOwner(value, path, issues) {
  if (!validateExactObject(value, path, ['ownerId', 'ownerPath'], issues)) return;
  validateId(value.ownerId, `${path}.ownerId`, issues);
  validateText(value.ownerPath, `${path}.ownerPath`, issues, SCHEMA_LIMITS.maxShortTextLength);
}

function validateValidator(value, path, issues) {
  if (!validateExactObject(value, path, ['validatorId', 'version'], issues)) return;
  validateId(value.validatorId, `${path}.validatorId`, issues);
  validateId(value.version, `${path}.version`, issues);
}

function validateProjectionRef(value, path, issues) {
  if (!validateExactObject(value, path, ['invariantId', 'eventRecommendationType', 'incidentRecommendationType'], issues)) return;
  validateId(value.invariantId, `${path}.invariantId`, issues);
  validateId(value.eventRecommendationType, `${path}.eventRecommendationType`, issues);
  validateId(value.incidentRecommendationType, `${path}.incidentRecommendationType`, issues);
}

function validateCockpitProjection(value, path, issues) {
  if (!validateExactObject(value, path, ['surface', 'summaryField', 'drillDown'], issues)) return;
  if (!validEnum(value.surface, COCKPIT_SURFACES)) issues.push(issue(`${path}.surface`, 'SCHEMA_ENUM_INVALID', 'unknown cockpit surface'));
  validateText(value.summaryField, `${path}.summaryField`, issues, SCHEMA_LIMITS.maxShortTextLength);
  validateText(value.drillDown, `${path}.drillDown`, issues, SCHEMA_LIMITS.maxLongTextLength);
}

function validateComponentDrillDown(value, path, issues) {
  if (!Array.isArray(value) || value.length < 1 || value.length > SCHEMA_LIMITS.maxEdgesPerNode) {
    issues.push(issue(path, 'COMPONENT_DRILL_DOWN_INVALID', 'bounded non-empty component drill-down array required'));
    return;
  }
  const componentIds = [];
  value.forEach((component, position) => {
    const childPath = `${path}[${position}]`;
    if (!validateExactObject(component, childPath, ['componentId', 'componentScope', 'canonicalOwnerId', 'supportingEvidenceIds'], issues)) return;
    validateId(component.componentId, `${childPath}.componentId`, issues);
    validateText(component.componentScope, `${childPath}.componentScope`, issues);
    validateId(component.canonicalOwnerId, `${childPath}.canonicalOwnerId`, issues);
    validateIdArray(component.supportingEvidenceIds, `${childPath}.supportingEvidenceIds`, issues, SCHEMA_LIMITS.maxEdgesPerNode, 1);
    componentIds.push(component.componentId);
  });
  if (new Set(componentIds).size !== componentIds.length) issues.push(issue(path, 'DUPLICATE_COMPONENT_ID', 'component IDs must be unique within a claim'));
}

function validateClaim(claim, position, issues) {
  const path = `$.claims[${position}]`;
  if (!validateExactObject(claim, path, CLAIM_NODE_REQUIRED_FIELDS, issues)) return;
  validateId(claim.claimId, `${path}.claimId`, issues);
  validateId(claim.requirementKey, `${path}.requirementKey`, issues);
  validateText(claim.statement, `${path}.statement`, issues);
  validateText(claim.scope, `${path}.scope`, issues);
  validateOwner(claim.canonicalOwner, `${path}.canonicalOwner`, issues);
  validateOwner(claim.resultConsumerOwner, `${path}.resultConsumerOwner`, issues);
  if (typeof claim.capitalCritical !== 'boolean') issues.push(issue(`${path}.capitalCritical`, 'SCHEMA_BOOLEAN_REQUIRED', 'boolean required'));
  validateIdArray(claim.subclaimIds, `${path}.subclaimIds`, issues);
  validateIdArray(claim.assumptionIds, `${path}.assumptionIds`, issues);
  validateIdArray(claim.supportingEvidenceIds, `${path}.supportingEvidenceIds`, issues, SCHEMA_LIMITS.maxEdgesPerNode, 1);
  validateIdArray(claim.counterEvidenceIds, `${path}.counterEvidenceIds`, issues);
  if (
    Array.isArray(claim.supportingEvidenceIds)
    && Array.isArray(claim.counterEvidenceIds)
    && claim.supportingEvidenceIds.length + claim.counterEvidenceIds.length > SCHEMA_LIMITS.maxEdgesPerNode
  ) {
    issues.push(issue(path, 'CLAIM_DIRECT_EVIDENCE_BOUND_EXCEEDED', 'combined support and counterevidence must fit the per-node edge bound'));
  }
  validateValidator(claim.validator, `${path}.validator`, issues);
  if (!Number.isSafeInteger(claim.propagationSloMs) || claim.propagationSloMs < 1 || claim.propagationSloMs > SCHEMA_LIMITS.maxSloMs) {
    issues.push(issue(`${path}.propagationSloMs`, 'SCHEMA_SLO_INVALID', 'bounded positive propagation SLO required'));
  }
  if (!Number.isSafeInteger(claim.assuranceSloMs) || claim.assuranceSloMs < 1 || claim.assuranceSloMs > SCHEMA_LIMITS.maxSloMs) {
    issues.push(issue(`${path}.assuranceSloMs`, 'SCHEMA_SLO_INVALID', 'bounded positive assurance SLO required'));
  }
  validateProjectionRef(claim.invariantProjection, `${path}.invariantProjection`, issues);
  validateCockpitProjection(claim.cockpitProjection, `${path}.cockpitProjection`, issues);
  validateComponentDrillDown(claim.componentDrillDown, `${path}.componentDrillDown`, issues);
  if (claim.missingDataBehavior !== 'UNKNOWN') issues.push(issue(`${path}.missingDataBehavior`, 'MISSING_DATA_BEHAVIOR_INVALID', 'missing data must project UNKNOWN'));
}

function validateFailureDomains(domains, path, issues) {
  if (!Array.isArray(domains) || domains.length < 1 || domains.length > SCHEMA_LIMITS.maxFailureDomainsPerLeg) {
    issues.push(issue(path, 'SCHEMA_FAILURE_DOMAIN_ARRAY_INVALID', 'bounded non-empty failure-domain array required'));
    return;
  }
  const identities = [];
  domains.forEach((domain, position) => {
    const childPath = `${path}[${position}]`;
    if (!validateExactObject(domain, childPath, ['class', 'id'], issues)) return;
    if (!validEnum(domain.class, FAILURE_DOMAIN_CLASSES)) issues.push(issue(`${childPath}.class`, 'SCHEMA_ENUM_INVALID', 'unknown failure-domain class'));
    validateId(domain.id, `${childPath}.id`, issues);
    identities.push(`${domain.class}:${domain.id}`);
  });
  if (new Set(identities).size !== identities.length) issues.push(issue(path, 'DUPLICATE_FAILURE_DOMAIN', 'failure-domain identities must be unique'));
}

function validateEvidenceLeg(value, path, issues) {
  if (!validateExactObject(value, path, ['actorId', 'ownerId', 'failureDomains'], issues)) return;
  validateId(value.actorId, `${path}.actorId`, issues);
  validateId(value.ownerId, `${path}.ownerId`, issues);
  validateFailureDomains(value.failureDomains, `${path}.failureDomains`, issues);
}

function validateClaimBinding(value, path, issues) {
  if (!validateExactObject(value, path, ['claimId', 'requirementKey', 'scope'], issues)) return;
  validateId(value.claimId, `${path}.claimId`, issues);
  validateId(value.requirementKey, `${path}.requirementKey`, issues);
  validateText(value.scope, `${path}.scope`, issues);
}

function validateIndependence(value, evidence, path, issues) {
  if (!validateExactObject(value, path, ['required', 'declaredClass', 'commonModeDependencyIds', 'basisEvidenceIds'], issues)) return;
  if (!validEnum(value.declaredClass, INDEPENDENCE_CLASSES)) issues.push(issue(`${path}.declaredClass`, 'SCHEMA_ENUM_INVALID', 'unknown independence class'));
  validateIdArray(value.commonModeDependencyIds, `${path}.commonModeDependencyIds`, issues, SCHEMA_LIMITS.maxCommonModeDependencies);
  if (evidence.purpose === 'INDEPENDENCE_BASIS') {
    if (value.required !== false) issues.push(issue(`${path}.required`, 'INDEPENDENCE_BASIS_RECURSIVE', 'basis evidence cannot require another independence basis'));
    validateIdArray(value.basisEvidenceIds, `${path}.basisEvidenceIds`, issues, SCHEMA_LIMITS.maxEdgesPerNode, 0);
    if (Array.isArray(value.basisEvidenceIds) && value.basisEvidenceIds.length > 0) {
      issues.push(issue(`${path}.basisEvidenceIds`, 'INDEPENDENCE_BASIS_RECURSIVE', 'basis evidence cannot self-certify through another basis'));
    }
  } else {
    if (evidence.capitalCritical === true && value.required !== true) {
      issues.push(issue(`${path}.required`, 'INDEPENDENCE_REQUIRED', 'capital-critical assurance evidence requires independence'));
    }
    validateIdArray(value.basisEvidenceIds, `${path}.basisEvidenceIds`, issues, 1, evidence.capitalCritical === true ? 1 : 0);
  }
}

function validateEvidence(evidence, position, issues) {
  const path = `$.evidence[${position}]`;
  if (!validateExactObject(evidence, path, EVIDENCE_REQUIRED_FIELDS, issues)) return;
  validateId(evidence.evidenceId, `${path}.evidenceId`, issues);
  if (!validEnum(evidence.role, EVIDENCE_ROLES)) issues.push(issue(`${path}.role`, 'SCHEMA_ENUM_INVALID', 'unknown evidence role'));
  if (!validEnum(evidence.purpose, EVIDENCE_PURPOSES)) issues.push(issue(`${path}.purpose`, 'SCHEMA_ENUM_INVALID', 'unknown evidence purpose'));
  if (!validEnum(evidence.kind, EVIDENCE_KINDS)) issues.push(issue(`${path}.kind`, 'SCHEMA_ENUM_INVALID', 'unknown evidence kind'));
  validateText(evidence.statement, `${path}.statement`, issues);
  if (typeof evidence.statement === 'string' && evidence.statement !== canonicalEvidenceStatement(evidence)) {
    issues.push(issue(`${path}.statement`, 'EVIDENCE_STATEMENT_CONTRACT_DRIFT', 'evidence text must be derived exactly from the locked claim contract'));
  }
  if (typeof evidence.statement === 'string' && UNSAFE_ASSURANCE_TEXT_PATTERN.test(evidence.statement)) {
    issues.push(issue(`${path}.statement`, 'EVIDENCE_STATEMENT_AUTHORITY_FORBIDDEN', 'untrusted evidence text cannot carry instructions or imply command or money-path authority'));
  }
  validateClaimBinding(evidence.claimBinding, `${path}.claimBinding`, issues);
  if (typeof evidence.capitalCritical !== 'boolean') issues.push(issue(`${path}.capitalCritical`, 'SCHEMA_BOOLEAN_REQUIRED', 'boolean required'));
  if (!validEnum(evidence.result, ASSURANCE_RESULTS)) issues.push(issue(`${path}.result`, 'SCHEMA_ENUM_INVALID', 'unknown evidence result'));
  validateId(evidence.reasonCode, `${path}.reasonCode`, issues);
  if (
    typeof evidence.reasonCode === 'string'
    && RESERVED_EVIDENCE_DERIVED_REASON_CODES.has(evidence.reasonCode.toLowerCase())
  ) {
    issues.push(issue(`${path}.reasonCode`, 'EVIDENCE_SOURCE_REASON_RESERVED', 'source reason must remain distinct from derived evaluator reasons'));
  }
  if (typeof evidence.reasonCode === 'string' && !SOURCE_REASON_PATTERN.test(evidence.reasonCode)) {
    issues.push(issue(`${path}.reasonCode`, 'EVIDENCE_SOURCE_REASON_NAMESPACE_INVALID', 'source reasons require SOURCE_PASS_, SOURCE_FAIL_, or SOURCE_UNKNOWN_'));
  }
  if (
    typeof evidence.reasonCode === 'string'
    && validEnum(evidence.result, ASSURANCE_RESULTS)
    && !evidence.reasonCode.startsWith(`SOURCE_${evidence.result}_`)
  ) {
    issues.push(issue(`${path}.reasonCode`, 'EVIDENCE_SOURCE_REASON_RESULT_MISMATCH', 'source reason namespace must match the declared result'));
  }
  if (typeof evidence.reasonCode === 'string' && UNSAFE_ASSURANCE_TEXT_PATTERN.test(evidence.reasonCode)) {
    issues.push(issue(`${path}.reasonCode`, 'EVIDENCE_SOURCE_REASON_AUTHORITY_FORBIDDEN', 'source reason cannot imply command or money-path authority'));
  }
  if (evidence.result === 'PASS' && ADVERSE_PASS_SOURCE_REASON.test(evidence.reasonCode)) {
    issues.push(issue(`${path}.reasonCode`, 'EVIDENCE_SOURCE_REASON_INCOHERENT', 'declared PASS cannot carry an adverse source reason'));
  }
  if (validateExactObject(evidence.sourceIdentity, `${path}.sourceIdentity`, ['sourceId', 'sourceType', 'revision', 'digest'], issues)) {
    validateId(evidence.sourceIdentity.sourceId, `${path}.sourceIdentity.sourceId`, issues);
    validateId(evidence.sourceIdentity.sourceType, `${path}.sourceIdentity.sourceType`, issues);
    validateId(evidence.sourceIdentity.revision, `${path}.sourceIdentity.revision`, issues);
    if (typeof evidence.sourceIdentity.digest !== 'string' || !DIGEST_PATTERN.test(evidence.sourceIdentity.digest)) {
      issues.push(issue(`${path}.sourceIdentity.digest`, 'SCHEMA_DIGEST_INVALID', 'sha256 or fixture digest required'));
    }
    if (evidence.sourceIdentity.sourceType !== evidence.kind) {
      issues.push(issue(`${path}.sourceIdentity.sourceType`, 'EVIDENCE_SOURCE_TYPE_MISMATCH', 'source type must equal the evidence kind'));
    }
  }
  for (const field of ['createdAtMs', 'lastVerifiedAtMs', 'expiresAtMs']) {
    if (!isValidUtcMillis(evidence[field])) issues.push(issue(`${path}.${field}`, 'SCHEMA_TIME_INVALID', 'valid UTC milliseconds required'));
  }
  if (!Number.isSafeInteger(evidence.maximumAgeMs) || evidence.maximumAgeMs < 1 || evidence.maximumAgeMs > SCHEMA_LIMITS.maxTtlMs) {
    issues.push(issue(`${path}.maximumAgeMs`, 'SCHEMA_TTL_INVALID', 'bounded positive maximum age required'));
  }
  if (
    isValidUtcMillis(evidence.createdAtMs)
    && isValidUtcMillis(evidence.lastVerifiedAtMs)
    && isValidUtcMillis(evidence.expiresAtMs)
    && !(evidence.createdAtMs <= evidence.lastVerifiedAtMs && evidence.lastVerifiedAtMs <= evidence.expiresAtMs)
  ) issues.push(issue(path, 'EVIDENCE_TIMELINE_INVALID', 'created <= verified <= expiry is required'));
  validateValidator(evidence.validator, `${path}.validator`, issues);
  validateEvidenceLeg(evidence.producer, `${path}.producer`, issues);
  validateEvidenceLeg(evidence.verifier, `${path}.verifier`, issues);
  validateIndependence(evidence.independence, evidence, `${path}.independence`, issues);
  if (
    evidence.purpose !== 'INDEPENDENCE_BASIS'
    && (
      evidence.claimBinding?.claimId === 'PA-S4-CLAIM-012'
      || evidence.purpose === 'DIAGNOSTIC_INDEPENDENCE'
    )
    && evidence.independence?.declaredClass !== 'OUT_OF_BAND'
  ) {
    issues.push(issue(`${path}.independence.declaredClass`, 'OUT_OF_BAND_INDEPENDENCE_REQUIRED', 'sentinel and diagnostic independence evidence require OUT_OF_BAND separation'));
  }
  validateIdArray(evidence.derivedFromClaimIds, `${path}.derivedFromClaimIds`, issues);
  validateIdArray(evidence.derivedFromEvidenceIds, `${path}.derivedFromEvidenceIds`, issues);
  validateIdArray(evidence.certifiesEvidenceIds, `${path}.certifiesEvidenceIds`, issues);
  if (evidence.purpose === 'INDEPENDENCE_BASIS') {
    if (evidence.kind !== 'OWNER_AUTHORIZATION') issues.push(issue(`${path}.kind`, 'INDEPENDENCE_BASIS_KIND_INVALID', 'basis evidence must be owner authorization evidence'));
    if (evidence.role !== 'SUPPORT') issues.push(issue(`${path}.role`, 'INDEPENDENCE_BASIS_ROLE_INVALID', 'basis evidence must be supporting evidence'));
    if (evidence.capitalCritical !== false) issues.push(issue(`${path}.capitalCritical`, 'INDEPENDENCE_BASIS_CRITICALITY_INVALID', 'basis evidence is a non-recursive contract record'));
    if (arrayOrEmpty(evidence.derivedFromClaimIds).length > 0 || arrayOrEmpty(evidence.derivedFromEvidenceIds).length > 0) {
      issues.push(issue(path, 'INDEPENDENCE_BASIS_DERIVATION_FORBIDDEN', 'basis evidence must be a leaf owner-authorization record'));
    }
    if (!Array.isArray(evidence.certifiesEvidenceIds) || evidence.certifiesEvidenceIds.length !== 1) {
      issues.push(issue(`${path}.certifiesEvidenceIds`, 'INDEPENDENCE_BASIS_SCOPE_INVALID', 'basis evidence must certify exactly one evidence node'));
    }
  } else if (evidence.capitalCritical !== true) {
    issues.push(issue(`${path}.capitalCritical`, 'CAPITAL_CRITICAL_EVIDENCE_REQUIRED', 'all claim and diagnostic support in S4 is capital-critical'));
  } else if (arrayOrEmpty(evidence.certifiesEvidenceIds).length > 0) {
    issues.push(issue(`${path}.certifiesEvidenceIds`, 'EVIDENCE_CERTIFICATION_SCOPE_INVALID', 'only independence-basis evidence may certify another node'));
  }
}

function validateDiagnosticPlane(value, issues) {
  const path = '$.diagnosticPlane';
  const fields = [
    'posture',
    'postureEvidenceIds',
    'containmentEvidenceIds',
    'permissionEvidenceIds',
    'providerOutageEvidenceIds',
    'privacyEvidenceIds',
    'independentEvidenceIds',
  ];
  if (!validateExactObject(value, path, fields, issues)) return;
  if (!validEnum(value.posture, DIAGNOSTIC_POSTURES)) issues.push(issue(`${path}.posture`, 'SCHEMA_ENUM_INVALID', 'unknown diagnostic posture'));
  for (const field of fields.slice(1)) validateIdArray(value[field], `${path}.${field}`, issues);
  const diagnosticEvidenceCount = fields.slice(1).reduce((total, field) => (
    total + arrayOrEmpty(value[field]).length
  ), 0);
  if (diagnosticEvidenceCount > SCHEMA_LIMITS.maxEdgesPerNode) {
    issues.push(issue(path, 'DIAGNOSTIC_EVIDENCE_BOUND_EXCEEDED', 'combined diagnostic evidence families must fit the per-node edge bound'));
  }
  if (arrayOrEmpty(value.postureEvidenceIds).length === 0) issues.push(issue(`${path}.postureEvidenceIds`, 'DIAGNOSTIC_POSTURE_EVIDENCE_MISSING', 'explicit posture evidence is required'));
}

function indexUnique(records, field, path, issues) {
  const index = new Map();
  records.forEach((record, position) => {
    const id = record?.[field];
    if (typeof id !== 'string') return;
    if (index.has(id)) issues.push(issue(`${path}[${position}].${field}`, 'DUPLICATE_ID', id));
    else index.set(id, record);
  });
  return index;
}

function validateMandatoryClaims(packet, claimIndex, issues) {
  const declared = arrayOrEmpty(packet.mandatoryClaimIds);
  if (!sameIds(declared, REQUIRED_MANDATORY_CLAIM_IDS)) {
    issues.push(issue('$.mandatoryClaimIds', 'MANDATORY_CLAIM_SET_INVALID', 'the exact thirteen §5.3 claim IDs are required'));
  }
  if (!sameIds(packet.rootClaimIds, REQUIRED_ROOT_CLAIM_IDS)) {
    issues.push(issue('$.rootClaimIds', 'MANDATORY_ROOT_SET_INVALID', 'the fixed acyclic root set is required'));
  }
  if (!sameIds([...claimIndex.keys()], REQUIRED_MANDATORY_CLAIM_IDS)) {
    issues.push(issue('$.claims', 'MANDATORY_CLAIM_SET_INVALID', 'extra and missing claim nodes are forbidden'));
  }
  for (const requiredId of REQUIRED_MANDATORY_CLAIM_IDS) {
    if (!declared.includes(requiredId) || !claimIndex.has(requiredId)) issues.push(issue('$.mandatoryClaimIds', 'MANDATORY_CLAIM_MISSING', requiredId));
  }
  for (const unexpectedId of declared.filter((id) => !REQUIRED_MANDATORY_CLAIM_IDS.includes(id))) {
    issues.push(issue('$.mandatoryClaimIds', 'MANDATORY_CLAIM_UNEXPECTED', unexpectedId));
  }
  const keys = arrayOrEmpty(packet.claims).filter((claim) => isObject(claim) && REQUIRED_MANDATORY_CLAIM_IDS.includes(claim.claimId)).map((claim) => claim.requirementKey);
  for (const key of REQUIRED_MANDATORY_REQUIREMENT_KEYS) {
    if (!keys.includes(key)) issues.push(issue('$.claims', 'MANDATORY_REQUIREMENT_KEY_MISSING', key));
  }
  for (const requirement of MANDATORY_CLAIM_REQUIREMENTS) {
    const claim = claimIndex.get(requirement.claimId);
    if (!claim) continue;
    if (claim.requirementKey !== requirement.requirementKey) issues.push(issue(`$.claims.${claim.claimId}.requirementKey`, 'MANDATORY_CLAIM_CONTRACT_DRIFT', requirement.requirementKey));
    if (claim.statement !== requirement.statement) issues.push(issue(`$.claims.${claim.claimId}.statement`, 'MANDATORY_CLAIM_CONTRACT_DRIFT', requirement.statement));
    if (claim.scope !== requirement.scope) issues.push(issue(`$.claims.${claim.claimId}.scope`, 'MANDATORY_CLAIM_CONTRACT_DRIFT', requirement.scope));
    if (claim.capitalCritical !== true) issues.push(issue(`$.claims.${claim.claimId}.capitalCritical`, 'MANDATORY_CLAIM_CONTRACT_DRIFT', 'capitalCritical must remain true'));
    if (canonicalStringify(claim.canonicalOwner) !== canonicalStringify(requirement.canonicalOwner)) issues.push(issue(`$.claims.${claim.claimId}.canonicalOwner`, 'MANDATORY_CLAIM_CONTRACT_DRIFT', requirement.canonicalOwner.ownerId));
    if (canonicalStringify(claim.resultConsumerOwner) !== canonicalStringify(requirement.resultConsumerOwner)) issues.push(issue(`$.claims.${claim.claimId}.resultConsumerOwner`, 'MANDATORY_CLAIM_CONTRACT_DRIFT', requirement.resultConsumerOwner.ownerId));
    if (!sameIds(claim.subclaimIds, requirement.requiredSubclaimIds)) issues.push(issue(`$.claims.${claim.claimId}.subclaimIds`, 'MANDATORY_CLAIM_DEPENDENCY_DRIFT', requirement.requiredSubclaimIds.join(',')));
    if (!sameIds(claim.assumptionIds, requirement.requiredAssumptionIds)) issues.push(issue(`$.claims.${claim.claimId}.assumptionIds`, 'MANDATORY_CLAIM_DEPENDENCY_DRIFT', requirement.requiredAssumptionIds.join(',')));
    if (canonicalStringify(claim.validator) !== canonicalStringify(MANDATORY_CLAIM_VALIDATOR)) issues.push(issue(`$.claims.${claim.claimId}.validator`, 'MANDATORY_CLAIM_CONTRACT_DRIFT', MANDATORY_CLAIM_VALIDATOR.validatorId));
    const number = claim.claimId.slice(-3);
    const expectedProjection = {
      invariantId: `PA-S4-INVARIANT-${number}`,
      eventRecommendationType: SAFE_EVENT_RECOMMENDATION_TYPE,
      incidentRecommendationType: SAFE_INCIDENT_RECOMMENDATION_TYPE,
    };
    if (canonicalStringify(claim.invariantProjection) !== canonicalStringify(expectedProjection)) issues.push(issue(`$.claims.${claim.claimId}.invariantProjection`, 'MANDATORY_CLAIM_PROJECTION_DRIFT', claim.claimId));
    const expectedCockpitProjection = {
      surface: requirement.cockpitSurface,
      summaryField: requirement.requirementKey,
      drillDown: MANDATORY_CLAIM_DRILL_DOWN,
    };
    if (canonicalStringify(claim.cockpitProjection) !== canonicalStringify(expectedCockpitProjection)) issues.push(issue(`$.claims.${claim.claimId}.cockpitProjection`, 'MANDATORY_CLAIM_PROJECTION_DRIFT', claim.claimId));
  }
}

function validateGraphSemantics(packet, issues) {
  const claims = (Array.isArray(packet.claims) ? packet.claims : []).filter(isObject);
  const evidenceRecords = (Array.isArray(packet.evidence) ? packet.evidence : []).filter(isObject);
  const claimIndex = indexUnique(claims, 'claimId', '$.claims', issues);
  const evidenceIndex = indexUnique(evidenceRecords, 'evidenceId', '$.evidence', issues);
  validateMandatoryClaims(packet, claimIndex, issues);

  for (const rootId of Array.isArray(packet.rootClaimIds) ? packet.rootClaimIds : []) {
    if (!claimIndex.has(rootId)) issues.push(issue('$.rootClaimIds', 'ROOT_REFERENCE_UNKNOWN', rootId));
  }

  const requirementById = new Map(MANDATORY_CLAIM_REQUIREMENTS.map((entry) => [entry.claimId, entry]));
  const directEvidenceUsage = new Map();
  const directSourceIdUsage = new Map();
  const directSourceDigestUsage = new Map();
  const recordDirectEvidence = (claim, evidenceId, evidence) => {
    if (!directEvidenceUsage.has(evidenceId)) directEvidenceUsage.set(evidenceId, []);
    directEvidenceUsage.get(evidenceId).push(claim.claimId);
    if (!evidence) return;
    for (const [value, usage] of [
      [evidence.sourceIdentity?.sourceId, directSourceIdUsage],
      [evidence.sourceIdentity?.digest, directSourceDigestUsage],
    ]) {
      if (typeof value !== 'string') continue;
      if (!usage.has(value)) usage.set(value, []);
      usage.get(value).push(evidence.evidenceId);
    }
  };
  for (const claim of claims) {
    const requirement = requirementById.get(claim.claimId);
    if (Number.isSafeInteger(claim.propagationSloMs) && Number.isSafeInteger(packet.propagationPolicy?.propagationSloMs) && claim.propagationSloMs > packet.propagationPolicy.propagationSloMs) {
      issues.push(issue(`$.claims.${claim.claimId}.propagationSloMs`, 'CLAIM_SLO_EXCEEDS_POLICY', claim.claimId));
    }
    if (Number.isSafeInteger(claim.assuranceSloMs) && Number.isSafeInteger(packet.propagationPolicy?.assuranceSloMs) && claim.assuranceSloMs > packet.propagationPolicy.assuranceSloMs) {
      issues.push(issue(`$.claims.${claim.claimId}.assuranceSloMs`, 'CLAIM_SLO_EXCEEDS_POLICY', claim.claimId));
    }
    if (
      claim.propagationSloMs !== ASSURANCE_CASE_PROPAGATION_POLICY.propagationSloMs
      || claim.assuranceSloMs !== ASSURANCE_CASE_PROPAGATION_POLICY.assuranceSloMs
    ) issues.push(issue(`$.claims.${claim.claimId}`, 'CLAIM_SLO_CONTRACT_DRIFT', claim.claimId));
    for (const subclaimId of arrayOrEmpty(claim.subclaimIds)) {
      if (!claimIndex.has(subclaimId)) issues.push(issue(`$.claims.${claim.claimId}.subclaimIds`, 'CLAIM_REFERENCE_UNKNOWN', subclaimId));
      if (subclaimId === claim.claimId) issues.push(issue(`$.claims.${claim.claimId}.subclaimIds`, 'CLAIM_SELF_EDGE', subclaimId));
    }
    for (const evidenceId of arrayOrEmpty(claim.supportingEvidenceIds)) {
      const evidence = evidenceIndex.get(evidenceId);
      recordDirectEvidence(claim, evidenceId, evidence);
      if (!evidence) issues.push(issue(`$.claims.${claim.claimId}.supportingEvidenceIds`, 'CLAIM_EVIDENCE_REFERENCE_UNKNOWN', evidenceId));
      else {
        if (evidence.role !== 'SUPPORT') issues.push(issue(`$.claims.${claim.claimId}.supportingEvidenceIds`, 'EVIDENCE_ROLE_MISMATCH', evidenceId));
        const expectedBinding = requirement ? {
          claimId: requirement.claimId,
          requirementKey: requirement.requirementKey,
          scope: requirement.scope,
        } : null;
        if (expectedBinding && canonicalStringify(evidence.claimBinding) !== canonicalStringify(expectedBinding)) {
          issues.push(issue(`$.claims.${claim.claimId}.supportingEvidenceIds`, 'EVIDENCE_CLAIM_BINDING_MISMATCH', evidenceId));
        }
        if (claim.claimId !== 'PA-S4-CLAIM-013') {
          if (evidence.purpose !== 'CLAIM_SUPPORT') issues.push(issue(`$.claims.${claim.claimId}.supportingEvidenceIds`, 'EVIDENCE_PURPOSE_MISMATCH', evidenceId));
          if (requirement && evidence.kind !== requirement.requiredEvidenceKind) issues.push(issue(`$.claims.${claim.claimId}.supportingEvidenceIds`, 'MANDATORY_EVIDENCE_KIND_MISMATCH', evidenceId));
        }
        if (requirement && evidence.producer?.ownerId !== requirement.canonicalOwner.ownerId) issues.push(issue(`$.claims.${claim.claimId}.supportingEvidenceIds`, 'MANDATORY_EVIDENCE_OWNER_MISMATCH', evidenceId));
        if (evidence.purpose === 'INDEPENDENCE_BASIS') {
          issues.push(issue(`$.claims.${claim.claimId}.supportingEvidenceIds`, 'INDEPENDENCE_BASIS_DIRECT_SUPPORT_FORBIDDEN', evidenceId));
        }
      }
    }
    for (const evidenceId of arrayOrEmpty(claim.counterEvidenceIds)) {
      const evidence = evidenceIndex.get(evidenceId);
      recordDirectEvidence(claim, evidenceId, evidence);
      if (!evidence) issues.push(issue(`$.claims.${claim.claimId}.counterEvidenceIds`, 'CLAIM_EVIDENCE_REFERENCE_UNKNOWN', evidenceId));
      else {
        if (evidence.role !== 'COUNTERCHECK') issues.push(issue(`$.claims.${claim.claimId}.counterEvidenceIds`, 'EVIDENCE_ROLE_MISMATCH', evidenceId));
        if (evidence.purpose !== 'CLAIM_SUPPORT') issues.push(issue(`$.claims.${claim.claimId}.counterEvidenceIds`, 'EVIDENCE_PURPOSE_MISMATCH', evidenceId));
        const expectedBinding = requirement ? {
          claimId: requirement.claimId,
          requirementKey: requirement.requirementKey,
          scope: requirement.scope,
        } : null;
        if (expectedBinding && canonicalStringify(evidence.claimBinding) !== canonicalStringify(expectedBinding)) {
          issues.push(issue(`$.claims.${claim.claimId}.counterEvidenceIds`, 'EVIDENCE_CLAIM_BINDING_MISMATCH', evidenceId));
        }
        if (requirement && evidence.kind !== requirement.requiredEvidenceKind) issues.push(issue(`$.claims.${claim.claimId}.counterEvidenceIds`, 'MANDATORY_EVIDENCE_KIND_MISMATCH', evidenceId));
        if (requirement && evidence.producer?.ownerId !== requirement.canonicalOwner.ownerId) issues.push(issue(`$.claims.${claim.claimId}.counterEvidenceIds`, 'MANDATORY_EVIDENCE_OWNER_MISMATCH', evidenceId));
      }
    }
    if (arrayOrEmpty(claim.assumptionIds).some((id) => !ACCEPTED_S1_ASSUMPTION_IDS.includes(id))) {
      issues.push(issue(`$.claims.${claim.claimId}.assumptionIds`, 'S1_ASSUMPTION_ID_UNACCEPTED', 'S4 may reference only the exact accepted S1 assumption IDs'));
    }
    const componentEvidenceIds = [];
    for (const component of Array.isArray(claim.componentDrillDown) ? claim.componentDrillDown.filter(isObject) : []) {
      if (component.canonicalOwnerId !== claim.canonicalOwner?.ownerId) issues.push(issue(`$.claims.${claim.claimId}.componentDrillDown`, 'COMPONENT_OWNER_MISMATCH', component.componentId ?? claim.claimId));
      for (const evidenceId of Array.isArray(component.supportingEvidenceIds) ? component.supportingEvidenceIds : []) {
        componentEvidenceIds.push(evidenceId);
        if (!arrayOrEmpty(claim.supportingEvidenceIds).includes(evidenceId)) issues.push(issue(`$.claims.${claim.claimId}.componentDrillDown`, 'COMPONENT_EVIDENCE_NOT_BOUND_TO_CLAIM', evidenceId));
      }
    }
    for (const evidenceId of arrayOrEmpty(claim.supportingEvidenceIds)) {
      if (!componentEvidenceIds.includes(evidenceId)) issues.push(issue(`$.claims.${claim.claimId}.componentDrillDown`, 'COMPONENT_EVIDENCE_COVERAGE_MISSING', evidenceId));
    }
  }
  for (const [evidenceId, claimIds] of directEvidenceUsage) {
    if (new Set(claimIds).size > 1) issues.push(issue('$.claims', 'DIRECT_EVIDENCE_ALIAS', `${evidenceId}:${stableUnique(claimIds).join(',')}`));
  }
  for (const [sourceId, evidenceIds] of directSourceIdUsage) {
    if (new Set(evidenceIds).size > 1) issues.push(issue('$.claims', 'DIRECT_SOURCE_ID_ALIAS', sourceId));
  }
  for (const [digest, evidenceIds] of directSourceDigestUsage) {
    if (new Set(evidenceIds).size > 1) issues.push(issue('$.claims', 'DIRECT_SOURCE_DIGEST_ALIAS', digest));
  }

  const reportGlobalAliases = (values, code) => {
    const duplicates = values.filter((value, position) => value && values.indexOf(value) !== position);
    if (duplicates.length > 0) issues.push(issue('$.evidence', code, stableUnique(duplicates).join(',')));
  };
  reportGlobalAliases(
    evidenceRecords.map((entry) => entry.sourceIdentity?.sourceId),
    'GRAPH_SOURCE_ID_ALIAS',
  );
  reportGlobalAliases(
    evidenceRecords.map((entry) => entry.sourceIdentity?.digest),
    'GRAPH_SOURCE_DIGEST_ALIAS',
  );

  const graphEvidence = evidenceRecords;
  const certificationRelated = (left, right) => Boolean(left && right) && (
    arrayOrEmpty(left.independence?.basisEvidenceIds).includes(right.evidenceId)
    || arrayOrEmpty(right.independence?.basisEvidenceIds).includes(left.evidenceId)
    || arrayOrEmpty(left.certifiesEvidenceIds).includes(right.evidenceId)
    || arrayOrEmpty(right.certifiesEvidenceIds).includes(left.evidenceId)
  );
  const reportCrossRoleAliases = (producerValues, verifierValues, code) => {
    const producersByIdentity = new Map();
    for (const evidence of graphEvidence) {
      for (const value of producerValues(evidence).filter(Boolean)) {
        const evidenceIds = producersByIdentity.get(value) ?? new Set();
        evidenceIds.add(evidence.evidenceId);
        producersByIdentity.set(value, evidenceIds);
      }
    }
    const aliases = [];
    for (const evidence of graphEvidence) {
      for (const value of verifierValues(evidence).filter(Boolean)) {
        if ([...(producersByIdentity.get(value) ?? [])].some((evidenceId) => (
          evidenceId !== evidence.evidenceId
          && !certificationRelated(evidence, evidenceIndex.get(evidenceId))
        ))) {
          aliases.push(value);
        }
      }
    }
    if (aliases.length > 0) issues.push(issue('$.evidence', code, stableUnique(aliases).join(',')));
  };
  reportCrossRoleAliases(
    (entry) => [entry.producer?.actorId],
    (entry) => [entry.verifier?.actorId],
    'GRAPH_COMMON_MODE_CROSS_ROLE_ACTOR',
  );
  reportCrossRoleAliases(
    (entry) => [entry.producer?.ownerId],
    (entry) => [entry.verifier?.ownerId],
    'GRAPH_COMMON_MODE_CROSS_ROLE_OWNER',
  );
  reportCrossRoleAliases(
    (entry) => arrayOrEmpty(entry.producer?.failureDomains)
      .filter(isObject)
      .map((domain) => `${domain.class}:${domain.id}`),
    (entry) => arrayOrEmpty(entry.verifier?.failureDomains)
      .filter(isObject)
      .map((domain) => `${domain.class}:${domain.id}`),
    'GRAPH_COMMON_MODE_CROSS_ROLE_FAILURE_DOMAIN',
  );

  for (const evidence of evidenceRecords) {
    for (const claimId of arrayOrEmpty(evidence.derivedFromClaimIds)) {
      if (!claimIndex.has(claimId)) issues.push(issue(`$.evidence.${evidence.evidenceId}.derivedFromClaimIds`, 'DERIVED_CLAIM_REFERENCE_UNKNOWN', claimId));
    }
    for (const evidenceId of arrayOrEmpty(evidence.derivedFromEvidenceIds)) {
      if (!evidenceIndex.has(evidenceId)) issues.push(issue(`$.evidence.${evidence.evidenceId}.derivedFromEvidenceIds`, 'DERIVED_EVIDENCE_REFERENCE_UNKNOWN', evidenceId));
      if (evidenceId === evidence.evidenceId) issues.push(issue(`$.evidence.${evidence.evidenceId}.derivedFromEvidenceIds`, 'EVIDENCE_SELF_EDGE', evidenceId));
    }
    for (const basisEvidenceId of arrayOrEmpty(evidence.independence?.basisEvidenceIds)) {
      const basis = evidenceIndex.get(basisEvidenceId);
      if (!basis) issues.push(issue(`$.evidence.${evidence.evidenceId}.independence.basisEvidenceIds`, 'INDEPENDENCE_BASIS_REFERENCE_UNKNOWN', basisEvidenceId));
      else if (basis.evidenceId === evidence.evidenceId) issues.push(issue(`$.evidence.${evidence.evidenceId}.independence.basisEvidenceIds`, 'INDEPENDENCE_BASIS_SELF_REFERENCE', basisEvidenceId));
      else if (basis.purpose !== 'INDEPENDENCE_BASIS' || basis.kind !== 'OWNER_AUTHORIZATION') {
        issues.push(issue(`$.evidence.${evidence.evidenceId}.independence.basisEvidenceIds`, 'INDEPENDENCE_BASIS_CONTRACT_INVALID', basisEvidenceId));
      } else if (!arrayOrEmpty(basis.certifiesEvidenceIds).includes(evidence.evidenceId)) {
        issues.push(issue(`$.evidence.${evidence.evidenceId}.independence.basisEvidenceIds`, 'INDEPENDENCE_BASIS_SCOPE_MISMATCH', basisEvidenceId));
      }
    }
    for (const certifiedEvidenceId of arrayOrEmpty(evidence.certifiesEvidenceIds)) {
      const certified = evidenceIndex.get(certifiedEvidenceId);
      if (!certified) issues.push(issue(`$.evidence.${evidence.evidenceId}.certifiesEvidenceIds`, 'CERTIFIED_EVIDENCE_REFERENCE_UNKNOWN', certifiedEvidenceId));
      else if (certified.purpose === 'INDEPENDENCE_BASIS') issues.push(issue(`$.evidence.${evidence.evidenceId}.certifiesEvidenceIds`, 'INDEPENDENCE_BASIS_RECURSIVE', certifiedEvidenceId));
      else if (!arrayOrEmpty(certified.independence?.basisEvidenceIds).includes(evidence.evidenceId)) issues.push(issue(`$.evidence.${evidence.evidenceId}.certifiesEvidenceIds`, 'INDEPENDENCE_BASIS_BACKLINK_MISSING', certifiedEvidenceId));
      else if (canonicalStringify(evidence.claimBinding) !== canonicalStringify(certified.claimBinding)) issues.push(issue(`$.evidence.${evidence.evidenceId}.claimBinding`, 'INDEPENDENCE_BASIS_CLAIM_BINDING_MISMATCH', certifiedEvidenceId));
      if (!certified || evidence.purpose !== 'INDEPENDENCE_BASIS') continue;
      const path = `$.evidence.${evidence.evidenceId}.certifiesEvidenceIds`;
      if (evidence.sourceIdentity?.sourceId === certified.sourceIdentity?.sourceId) {
        issues.push(issue(path, 'INDEPENDENCE_BASIS_CERTIFIED_SOURCE_ID_ALIAS', certifiedEvidenceId));
      }
      if (evidence.sourceIdentity?.digest === certified.sourceIdentity?.digest) {
        issues.push(issue(path, 'INDEPENDENCE_BASIS_CERTIFIED_SOURCE_DIGEST_ALIAS', certifiedEvidenceId));
      }
      const basisActors = [evidence.producer?.actorId, evidence.verifier?.actorId].filter(Boolean);
      const certifiedActors = [certified.producer?.actorId, certified.verifier?.actorId].filter(Boolean);
      if (basisActors.some((actorId) => certifiedActors.includes(actorId))) {
        issues.push(issue(path, 'INDEPENDENCE_BASIS_CERTIFIED_ACTOR_ALIAS', certifiedEvidenceId));
      }
      if (evidence.producer?.ownerId !== certified.producer?.ownerId) {
        issues.push(issue(path, 'INDEPENDENCE_BASIS_CERTIFIED_PRODUCER_OWNER_MISMATCH', certifiedEvidenceId));
      }
      if (evidence.verifier?.ownerId === certified.verifier?.ownerId) {
        issues.push(issue(path, 'INDEPENDENCE_BASIS_CERTIFIED_VERIFIER_OWNER_ALIAS', certifiedEvidenceId));
      }
      if (canonicalStringify(evidence.validator) === canonicalStringify(certified.validator)) {
        issues.push(issue(path, 'INDEPENDENCE_BASIS_CERTIFIED_VALIDATOR_ALIAS', certifiedEvidenceId));
      }
      const basisDomains = new Set([
        ...arrayOrEmpty(evidence.producer?.failureDomains),
        ...arrayOrEmpty(evidence.verifier?.failureDomains),
      ].filter(isObject).map((domain) => `${domain.class}:${domain.id}`));
      const certifiedDomains = [
        ...arrayOrEmpty(certified.producer?.failureDomains),
        ...arrayOrEmpty(certified.verifier?.failureDomains),
      ].filter(isObject).map((domain) => `${domain.class}:${domain.id}`);
      if (certifiedDomains.some((identity) => basisDomains.has(identity))) {
        issues.push(issue(path, 'INDEPENDENCE_BASIS_CERTIFIED_COMMON_MODE_FAILURE_DOMAIN', certifiedEvidenceId));
      }
    }
  }
  const basisRecords = evidenceRecords.filter((entry) => entry.purpose === 'INDEPENDENCE_BASIS');
  const requireUniqueBasisValues = (values, code) => {
    const duplicates = values.filter((value, position) => values.indexOf(value) !== position);
    if (duplicates.length > 0) issues.push(issue('$.evidence', code, stableUnique(duplicates).join(',')));
  };
  requireUniqueBasisValues(basisRecords.map((entry) => entry.sourceIdentity?.sourceId).filter(Boolean), 'INDEPENDENCE_BASIS_SOURCE_ID_ALIAS');
  requireUniqueBasisValues(basisRecords.map((entry) => entry.sourceIdentity?.digest).filter(Boolean), 'INDEPENDENCE_BASIS_SOURCE_DIGEST_ALIAS');
  requireUniqueBasisValues(basisRecords.map((entry) => entry.producer?.actorId).filter(Boolean), 'INDEPENDENCE_BASIS_PRODUCER_ALIAS');
  requireUniqueBasisValues(basisRecords.map((entry) => entry.verifier?.actorId).filter(Boolean), 'INDEPENDENCE_BASIS_VERIFIER_ALIAS');
  requireUniqueBasisValues(basisRecords.flatMap((entry) => [entry.producer?.actorId, entry.verifier?.actorId]).filter(Boolean), 'INDEPENDENCE_BASIS_ACTOR_ALIAS');
  requireUniqueBasisValues(basisRecords.map((entry) => entry.verifier?.ownerId).filter(Boolean), 'INDEPENDENCE_BASIS_VERIFIER_OWNER_ALIAS');
  requireUniqueBasisValues(basisRecords.map((entry) => canonicalStringify(entry.validator)), 'INDEPENDENCE_BASIS_VALIDATOR_ALIAS');
  requireUniqueBasisValues(basisRecords.flatMap((entry) => [
    ...arrayOrEmpty(entry.producer?.failureDomains),
    ...arrayOrEmpty(entry.verifier?.failureDomains),
  ].filter(isObject).map((domain) => `${domain.class}:${domain.id}`)), 'INDEPENDENCE_BASIS_COMMON_MODE_FAILURE_DOMAIN');

  const diagnosticClaim = claimIndex.get('PA-S4-CLAIM-013');
  const boundDiagnosticIds = new Set([
    ...arrayOrEmpty(diagnosticClaim?.supportingEvidenceIds),
    ...arrayOrEmpty(diagnosticClaim?.counterEvidenceIds),
  ]);
  const diagnosticIds = [];
  for (const [field, requirement] of Object.entries(DIAGNOSTIC_EVIDENCE_REQUIREMENTS)) {
    const ids = arrayOrEmpty(packet.diagnosticPlane?.[field]);
    const required = field === 'postureEvidenceIds' || packet.diagnosticPlane?.posture !== 'NOT_CONFIGURED';
    if (required && ids.length === 0) issues.push(issue(`$.diagnosticPlane.${field}`, 'DIAGNOSTIC_REQUIRED_FAMILY_MISSING', field));
    for (const evidenceId of ids) {
      diagnosticIds.push(evidenceId);
      const evidence = evidenceIndex.get(evidenceId);
      if (!evidence) issues.push(issue(`$.diagnosticPlane.${field}`, 'DIAGNOSTIC_EVIDENCE_REFERENCE_UNKNOWN', evidenceId));
      else {
        if (evidence.purpose !== requirement.purpose || evidence.kind !== requirement.kind) {
          issues.push(issue(`$.diagnosticPlane.${field}`, 'DIAGNOSTIC_EVIDENCE_FAMILY_MISMATCH', evidenceId));
        }
        if (evidence.role !== 'SUPPORT') issues.push(issue(`$.diagnosticPlane.${field}`, 'DIAGNOSTIC_EVIDENCE_ROLE_INVALID', evidenceId));
      }
      if (!boundDiagnosticIds.has(evidenceId)) issues.push(issue(`$.diagnosticPlane.${field}`, 'DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM', evidenceId));
    }
  }
  if (packet.diagnosticPlane?.posture === 'NOT_CONFIGURED') {
    for (const field of Object.keys(DIAGNOSTIC_EVIDENCE_REQUIREMENTS).filter((entry) => entry !== 'postureEvidenceIds')) {
      if ((packet.diagnosticPlane?.[field] ?? []).length > 0) {
        issues.push(issue(`$.diagnosticPlane.${field}`, 'DIAGNOSTIC_NOT_CONFIGURED_FAMILY_PRESENT', field));
      }
    }
  }
  if (new Set(diagnosticIds).size !== diagnosticIds.length) {
    issues.push(issue('$.diagnosticPlane', 'DIAGNOSTIC_EVIDENCE_ALIAS', 'diagnostic evidence families require globally distinct evidence IDs'));
  }
  const diagnosticClaimEdgeIds = new Set([
    ...arrayOrEmpty(diagnosticClaim?.supportingEvidenceIds),
    ...arrayOrEmpty(diagnosticClaim?.counterEvidenceIds),
    ...diagnosticIds,
  ]);
  if (diagnosticClaimEdgeIds.size > SCHEMA_LIMITS.maxEdgesPerNode) {
    issues.push(issue('$.diagnosticPlane', 'DIAGNOSTIC_CLAIM_EDGE_BOUND_EXCEEDED', 'combined claim 13 and diagnostic evidence references must fit the per-node edge bound'));
  }
  for (const evidenceId of arrayOrEmpty(diagnosticClaim?.supportingEvidenceIds)) {
    if (!diagnosticIds.includes(evidenceId)) issues.push(issue('$.claims.PA-S4-CLAIM-013.supportingEvidenceIds', 'DIAGNOSTIC_SUPPORT_UNDECLARED', evidenceId));
  }

  const diagnosticEvidence = diagnosticIds.map((id) => evidenceIndex.get(id)).filter(Boolean);
  const requireUniqueDiagnosticValues = (values, code) => {
    const duplicates = values.filter((value, position) => values.indexOf(value) !== position);
    if (duplicates.length > 0) issues.push(issue('$.diagnosticPlane', code, stableUnique(duplicates).join(',')));
  };
  requireUniqueDiagnosticValues(diagnosticEvidence.map((entry) => entry.sourceIdentity?.sourceId).filter(Boolean), 'DIAGNOSTIC_SOURCE_ID_ALIAS');
  requireUniqueDiagnosticValues(diagnosticEvidence.map((entry) => entry.sourceIdentity?.digest).filter(Boolean), 'DIAGNOSTIC_SOURCE_DIGEST_ALIAS');
  requireUniqueDiagnosticValues(diagnosticEvidence.map((entry) => entry.producer?.actorId).filter(Boolean), 'DIAGNOSTIC_PRODUCER_ALIAS');
  requireUniqueDiagnosticValues(diagnosticEvidence.map((entry) => entry.verifier?.actorId).filter(Boolean), 'DIAGNOSTIC_VERIFIER_ALIAS');
  requireUniqueDiagnosticValues(diagnosticEvidence.flatMap((entry) => [entry.producer?.actorId, entry.verifier?.actorId]).filter(Boolean), 'DIAGNOSTIC_ACTOR_ALIAS');
  requireUniqueDiagnosticValues(diagnosticEvidence.map((entry) => entry.verifier?.ownerId).filter(Boolean), 'DIAGNOSTIC_VERIFIER_OWNER_ALIAS');
  requireUniqueDiagnosticValues(diagnosticEvidence.map((entry) => canonicalStringify(entry.validator)), 'DIAGNOSTIC_VALIDATOR_ALIAS');
  requireUniqueDiagnosticValues(diagnosticEvidence.flatMap((entry) => entry.independence?.basisEvidenceIds ?? []), 'DIAGNOSTIC_BASIS_ALIAS');
  requireUniqueDiagnosticValues(diagnosticEvidence.flatMap((entry) => [
    ...arrayOrEmpty(entry.producer?.failureDomains),
    ...arrayOrEmpty(entry.verifier?.failureDomains),
  ].filter(isObject).map((domain) => `${domain.class}:${domain.id}`)), 'DIAGNOSTIC_COMMON_MODE_FAILURE_DOMAIN');
  const diagnosticBasisEvidence = diagnosticEvidence
    .flatMap((entry) => arrayOrEmpty(entry.independence?.basisEvidenceIds))
    .map((id) => evidenceIndex.get(id))
    .filter(Boolean);
  requireUniqueDiagnosticValues(diagnosticBasisEvidence.map((entry) => entry.sourceIdentity?.sourceId).filter(Boolean), 'DIAGNOSTIC_BASIS_SOURCE_ID_ALIAS');
  requireUniqueDiagnosticValues(diagnosticBasisEvidence.map((entry) => entry.sourceIdentity?.digest).filter(Boolean), 'DIAGNOSTIC_BASIS_SOURCE_DIGEST_ALIAS');
  requireUniqueDiagnosticValues(diagnosticBasisEvidence.map((entry) => entry.producer?.actorId).filter(Boolean), 'DIAGNOSTIC_BASIS_PRODUCER_ALIAS');
  requireUniqueDiagnosticValues(diagnosticBasisEvidence.map((entry) => entry.verifier?.actorId).filter(Boolean), 'DIAGNOSTIC_BASIS_VERIFIER_ALIAS');
  requireUniqueDiagnosticValues(diagnosticBasisEvidence.flatMap((entry) => [entry.producer?.actorId, entry.verifier?.actorId]).filter(Boolean), 'DIAGNOSTIC_BASIS_ACTOR_ALIAS');
  requireUniqueDiagnosticValues(diagnosticBasisEvidence.map((entry) => entry.verifier?.ownerId).filter(Boolean), 'DIAGNOSTIC_BASIS_VERIFIER_OWNER_ALIAS');
  requireUniqueDiagnosticValues(diagnosticBasisEvidence.map((entry) => canonicalStringify(entry.validator)), 'DIAGNOSTIC_BASIS_VALIDATOR_ALIAS');
  requireUniqueDiagnosticValues(diagnosticBasisEvidence.flatMap((entry) => [
    ...arrayOrEmpty(entry.producer?.failureDomains),
    ...arrayOrEmpty(entry.verifier?.failureDomains),
  ].filter(isObject).map((domain) => `${domain.class}:${domain.id}`)), 'DIAGNOSTIC_BASIS_COMMON_MODE_FAILURE_DOMAIN');

  const adjacency = new Map();
  for (const claim of claims) {
    adjacency.set(`claim:${claim.claimId}`, [
      ...arrayOrEmpty(claim.subclaimIds).map((id) => `claim:${id}`),
      ...arrayOrEmpty(claim.supportingEvidenceIds).map((id) => `evidence:${id}`),
      ...arrayOrEmpty(claim.counterEvidenceIds).map((id) => `evidence:${id}`),
      ...(claim.claimId === 'PA-S4-CLAIM-013' ? diagnosticIds.map((id) => `evidence:${id}`) : []),
    ]);
  }
  for (const evidence of evidenceRecords) {
    adjacency.set(`evidence:${evidence.evidenceId}`, [
      ...arrayOrEmpty(evidence.derivedFromClaimIds).map((id) => `claim:${id}`),
      ...arrayOrEmpty(evidence.derivedFromEvidenceIds).map((id) => `evidence:${id}`),
      ...arrayOrEmpty(evidence.independence?.basisEvidenceIds).map((id) => `evidence:${id}`),
    ]);
  }
  const visiting = new Set();
  const visited = new Set();
  let cycleFound = false;
  const walk = (node, trail) => {
    if (visiting.has(node)) {
      cycleFound = true;
      issues.push(issue('$', 'ASSURANCE_GRAPH_CYCLE', [...trail, node].join(' -> ')));
      return;
    }
    if (visited.has(node) || !adjacency.has(node)) return;
    visiting.add(node);
    for (const child of adjacency.get(node)) walk(child, [...trail, node]);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of adjacency.keys()) walk(node, []);

  if (!cycleFound) {
    const depthCache = new Map();
    const depth = (node) => {
      if (depthCache.has(node)) return depthCache.get(node);
      const children = (adjacency.get(node) ?? []).filter((child) => adjacency.has(child));
      const value = 1 + (children.length === 0 ? 0 : Math.max(...children.map(depth)));
      depthCache.set(node, value);
      return value;
    };
    const maximumDepth = Math.max(0, ...[...adjacency.keys()].map(depth));
    if (maximumDepth > SCHEMA_LIMITS.maxInvalidationPathLength - 1) {
      issues.push(issue('$', 'ASSURANCE_GRAPH_DEPTH_EXCEEDED', String(maximumDepth)));
    }
  }

  const reachable = new Set();
  const markReachable = (node) => {
    if (reachable.has(node)) return;
    reachable.add(node);
    for (const child of adjacency.get(node) ?? []) markReachable(child);
  };
  for (const rootId of Array.isArray(packet.rootClaimIds) ? packet.rootClaimIds : []) markReachable(`claim:${rootId}`);
  for (const claimId of claimIndex.keys()) {
    if (!reachable.has(`claim:${claimId}`)) issues.push(issue('$.rootClaimIds', 'CLAIM_UNREACHABLE', claimId));
  }
  for (const evidenceId of evidenceIndex.keys()) {
    if (!reachable.has(`evidence:${evidenceId}`)) issues.push(issue('$.evidence', 'EVIDENCE_UNREACHABLE', evidenceId));
  }
}

export function validateAssuranceCasePacket(input) {
  const captured = capturePlainData(input);
  if (!captured.ok) return captured.issues;
  const packet = captured.value;
  const issues = [];
  try {
  const fields = [
    'schemaVersion', 'graphId', 'revision', 'releaseId', 'truthLabel', 'authorityEffect',
    'generatedAtMs', 'rootClaimIds', 'mandatoryClaimIds', 's1SourceRequirement',
    'propagationPolicy', 'diagnosticPlane', 'claims', 'evidence',
  ];
  if (!validateExactObject(packet, '$', fields, issues)) return issues;
  if (packet.schemaVersion !== ASSURANCE_CASE_SCHEMA_VERSION) issues.push(issue('$.schemaVersion', 'SCHEMA_VERSION_MISMATCH', ASSURANCE_CASE_SCHEMA_VERSION));
  validateId(packet.graphId, '$.graphId', issues);
  validateId(packet.revision, '$.revision', issues);
  validateId(packet.releaseId, '$.releaseId', issues);
  if (packet.truthLabel !== 'SYNTHETIC_ONLY') issues.push(issue('$.truthLabel', 'TRUTH_LABEL_INVALID', 'packet truth must remain SYNTHETIC_ONLY'));
  if (packet.authorityEffect !== 'NONE') issues.push(issue('$.authorityEffect', 'AUTHORITY_EFFECT_INVALID', 'packet authority effect must remain NONE'));
  if (!isValidUtcMillis(packet.generatedAtMs)) issues.push(issue('$.generatedAtMs', 'SCHEMA_TIME_INVALID', 'valid UTC milliseconds required'));
  validateIdArray(packet.rootClaimIds, '$.rootClaimIds', issues, SCHEMA_LIMITS.maxClaims, 1);
  validateIdArray(packet.mandatoryClaimIds, '$.mandatoryClaimIds', issues, SCHEMA_LIMITS.maxClaims, 1);
  if (canonicalStringify(packet.s1SourceRequirement) !== canonicalStringify(ACCEPTED_S1_SOURCE)) {
    issues.push(issue('$.s1SourceRequirement', 'S1_SOURCE_REQUIREMENT_MISMATCH', 'accepted S1 identity and contract hashes must match exactly'));
  }
  if (validateExactObject(packet.propagationPolicy, '$.propagationPolicy', ['requiredDependencyMode', 'failurePrecedence', 'expiryResult', 'propagationSloMs', 'assuranceSloMs'], issues)) {
    if (packet.propagationPolicy.requiredDependencyMode !== 'ALL') issues.push(issue('$.propagationPolicy.requiredDependencyMode', 'DEPENDENCY_MODE_INVALID', 'required dependencies are conjunctive'));
    if (packet.propagationPolicy.failurePrecedence !== 'FAIL_THEN_UNKNOWN_THEN_PASS') issues.push(issue('$.propagationPolicy.failurePrecedence', 'FAILURE_PRECEDENCE_INVALID', 'FAIL must dominate UNKNOWN'));
    if (packet.propagationPolicy.expiryResult !== 'UNKNOWN') issues.push(issue('$.propagationPolicy.expiryResult', 'EXPIRY_RESULT_INVALID', 'expiry must project UNKNOWN'));
    for (const field of ['propagationSloMs', 'assuranceSloMs']) {
      if (!Number.isSafeInteger(packet.propagationPolicy[field]) || packet.propagationPolicy[field] < 1 || packet.propagationPolicy[field] > SCHEMA_LIMITS.maxSloMs) {
        issues.push(issue(`$.propagationPolicy.${field}`, 'SCHEMA_SLO_INVALID', 'bounded positive SLO required'));
      }
    }
    if (canonicalStringify(packet.propagationPolicy) !== canonicalStringify(ASSURANCE_CASE_PROPAGATION_POLICY)) {
      issues.push(issue('$.propagationPolicy', 'PROPAGATION_POLICY_CONTRACT_DRIFT', 'the packet propagation and assurance SLO contract is immutable'));
    }
  }
  validateDiagnosticPlane(packet.diagnosticPlane, issues);
  if (!Array.isArray(packet.claims) || packet.claims.length < 1 || packet.claims.length > SCHEMA_LIMITS.maxClaims) {
    issues.push(issue('$.claims', 'SCHEMA_CLAIM_ARRAY_INVALID', 'bounded non-empty claim array required'));
  } else packet.claims.forEach((claim, position) => validateClaim(claim, position, issues));
  if (!Array.isArray(packet.evidence) || packet.evidence.length < 1 || packet.evidence.length > SCHEMA_LIMITS.maxEvidence) {
    issues.push(issue('$.evidence', 'SCHEMA_EVIDENCE_ARRAY_INVALID', 'bounded non-empty evidence array required'));
  } else packet.evidence.forEach((evidence, position) => validateEvidence(evidence, position, issues));
  if (Array.isArray(packet.claims) && Array.isArray(packet.evidence)) validateGraphSemantics(packet, issues);
  } catch {
    issues.push(issue('$', 'SCHEMA_NESTED_VALUE_INVALID', 'malformed nested value rejected'));
  }
  return issues.sort((left, right) => compareCanonical(left.path, right.path) || compareCanonical(left.code, right.code) || compareCanonical(left.message, right.message));
}

function validateS1AssumptionResult(record, position, issues) {
  const path = `$.assumptionResults[${position}]`;
  const fields = ['assumptionId', 'sourceOwnerId', 'result', 'reasonCode', 'freshnessStatus', 'evaluatedAtMs', 'staleAtMs'];
  if (!validateExactObject(record, path, fields, issues)) return;
  if (!validId(record.assumptionId) || !record.assumptionId.startsWith('PA-S1-AS-')) issues.push(issue(`${path}.assumptionId`, 'S1_ASSUMPTION_ID_INVALID', 'accepted S1 assumption identifier required'));
  validateId(record.sourceOwnerId, `${path}.sourceOwnerId`, issues);
  if (!validEnum(record.result, ASSURANCE_RESULTS)) issues.push(issue(`${path}.result`, 'SCHEMA_ENUM_INVALID', 'unknown S1 result'));
  validateId(record.reasonCode, `${path}.reasonCode`, issues);
  const freshnessStatuses = ['CURRENT', 'EXPIRED', 'NOT_YET_VALID', 'INCOHERENT', 'INVALID_TIMELINE', 'CLOCK_INVALID', 'EVIDENCE_MISSING'];
  if (!validEnum(record.freshnessStatus, freshnessStatuses)) issues.push(issue(`${path}.freshnessStatus`, 'S1_FRESHNESS_STATUS_INVALID', 'accepted S1 freshness vocabulary required'));
  if (!isValidUtcMillis(record.evaluatedAtMs)) issues.push(issue(`${path}.evaluatedAtMs`, 'SCHEMA_TIME_INVALID', 'valid UTC milliseconds required'));
  if (record.staleAtMs !== null && !isValidUtcMillis(record.staleAtMs)) issues.push(issue(`${path}.staleAtMs`, 'SCHEMA_TIME_INVALID', 'valid UTC milliseconds or null required'));
}

export function validateS1AssumptionProjection(input) {
  const captured = capturePlainData(input);
  if (!captured.ok) return captured.issues;
  const projection = captured.value;
  const issues = [];
  try {
  const fields = ['schemaVersion', 'truthLabel', 'authorityEffect', 'evaluatedAtMs', 'provenance', 'assumptionResults'];
  if (!validateExactObject(projection, '$', fields, issues)) return issues;
  if (projection.schemaVersion !== S1_ASSUMPTION_PROJECTION_VERSION) issues.push(issue('$.schemaVersion', 'SCHEMA_VERSION_MISMATCH', S1_ASSUMPTION_PROJECTION_VERSION));
  if (projection.truthLabel !== 'SYNTHETIC_ONLY') issues.push(issue('$.truthLabel', 'TRUTH_LABEL_INVALID', 'adapter fixture truth must remain SYNTHETIC_ONLY'));
  if (projection.authorityEffect !== 'NONE') issues.push(issue('$.authorityEffect', 'AUTHORITY_EFFECT_INVALID', 'adapter projection authority effect must remain NONE'));
  if (!isValidUtcMillis(projection.evaluatedAtMs)) issues.push(issue('$.evaluatedAtMs', 'SCHEMA_TIME_INVALID', 'valid UTC milliseconds required'));
  if (canonicalStringify(projection.provenance) !== canonicalStringify(ACCEPTED_S1_SOURCE)) {
    issues.push(issue('$.provenance', 'S1_PROVENANCE_MISMATCH', 'accepted S1 provenance must match exactly'));
  }
  if (!Array.isArray(projection.assumptionResults) || projection.assumptionResults.length < 1 || projection.assumptionResults.length > 256) {
    issues.push(issue('$.assumptionResults', 'S1_ASSUMPTION_RESULT_ARRAY_INVALID', 'bounded non-empty S1 result array required'));
  } else projection.assumptionResults.forEach((record, position) => validateS1AssumptionResult(record, position, issues));
  const results = Array.isArray(projection.assumptionResults) ? projection.assumptionResults : [];
  const index = indexUnique(results, 'assumptionId', '$.assumptionResults', issues);
  if (!sameIds([...index.keys()], ACCEPTED_S1_ASSUMPTION_IDS)) {
    issues.push(issue('$.assumptionResults', 'S1_ASSUMPTION_SET_INVALID', 'the exact nine accepted S1 assumption results are required'));
  }
  for (const record of results.filter(isObject)) {
    if (record.evaluatedAtMs !== projection.evaluatedAtMs) issues.push(issue(`$.assumptionResults.${record.assumptionId}.evaluatedAtMs`, 'S1_EVALUATION_TIME_MISMATCH', record.assumptionId));
    if (record.freshnessStatus === 'EXPIRED') {
      if (!isValidUtcMillis(record.staleAtMs)) {
        issues.push(issue(`$.assumptionResults.${record.assumptionId}.staleAtMs`, 'S1_EXPIRED_STALE_BOUNDARY_MISSING', record.assumptionId));
      } else if (record.staleAtMs > projection.evaluatedAtMs) {
        issues.push(issue(`$.assumptionResults.${record.assumptionId}.staleAtMs`, 'S1_EXPIRED_STALE_BOUNDARY_IN_FUTURE', record.assumptionId));
      }
    }
    if (record.result === 'PASS') {
      if (record.reasonCode !== 'VALIDATED') issues.push(issue(`$.assumptionResults.${record.assumptionId}.reasonCode`, 'S1_RESULT_REASON_INCOHERENT', 'PASS requires VALIDATED'));
      if (record.freshnessStatus !== 'CURRENT') issues.push(issue(`$.assumptionResults.${record.assumptionId}`, 'S1_PASS_NOT_CURRENT', record.assumptionId));
      if (record.staleAtMs === null) issues.push(issue(`$.assumptionResults.${record.assumptionId}.staleAtMs`, 'S1_PASS_STALE_BOUNDARY_MISSING', record.assumptionId));
      else if (projection.evaluatedAtMs > record.staleAtMs) issues.push(issue(`$.assumptionResults.${record.assumptionId}.staleAtMs`, 'S1_PASS_PAST_STALE_BOUNDARY', record.assumptionId));
    } else if (record.result === 'FAIL') {
      if (record.reasonCode !== 'CONTRADICTED') issues.push(issue(`$.assumptionResults.${record.assumptionId}.reasonCode`, 'S1_RESULT_REASON_INCOHERENT', 'FAIL requires CONTRADICTED'));
    } else if (record.result === 'UNKNOWN') {
      const unknownReasonsByFreshness = {
        CURRENT: ['WEAK', 'MISSING', 'UNREGISTERED'],
        EXPIRED: ['EXPIRED'],
        NOT_YET_VALID: ['NOT_YET_VALID'],
        INCOHERENT: ['INCOHERENT'],
        INVALID_TIMELINE: ['INVALID_TIMELINE'],
        CLOCK_INVALID: ['CLOCK_INVALID'],
        EVIDENCE_MISSING: ['MISSING'],
      };
      if (!(unknownReasonsByFreshness[record.freshnessStatus] ?? []).includes(record.reasonCode)) {
        issues.push(issue(`$.assumptionResults.${record.assumptionId}.reasonCode`, 'S1_RESULT_REASON_INCOHERENT', 'UNKNOWN reason must match S1 freshness'));
      }
    }
    const expectedOwner = ACCEPTED_S1_ASSUMPTION_OWNERS[record.assumptionId];
    if (expectedOwner === undefined) issues.push(issue(`$.assumptionResults.${record.assumptionId}.assumptionId`, 'S1_ASSUMPTION_ID_UNACCEPTED', record.assumptionId));
    else if (record.sourceOwnerId !== expectedOwner) issues.push(issue(`$.assumptionResults.${record.assumptionId}.sourceOwnerId`, 'S1_ASSUMPTION_OWNER_MISMATCH', expectedOwner));
  }
  if (index.size !== (projection.assumptionResults ?? []).length) {
    // The duplicate issue is emitted by indexUnique; this branch preserves explicit intent.
  }
  } catch {
    issues.push(issue('$', 'SCHEMA_NESTED_VALUE_INVALID', 'malformed nested value rejected'));
  }
  return issues.sort((left, right) => compareCanonical(left.path, right.path) || compareCanonical(left.code, right.code) || compareCanonical(left.message, right.message));
}

const EXPLICITLY_EVALUATED_PACKET_ISSUES = Object.freeze([
  'CLAIM_EVIDENCE_REFERENCE_UNKNOWN',
  'DIAGNOSTIC_REQUIRED_FAMILY_MISSING',
  'DIAGNOSTIC_EVIDENCE_REFERENCE_UNKNOWN',
  'DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM',
]);

export const isFatalPacketIssue = (entry) => !EXPLICITLY_EVALUATED_PACKET_ISSUES.includes(entry.code);

export const isFatalS1ProjectionIssue = () => true;
