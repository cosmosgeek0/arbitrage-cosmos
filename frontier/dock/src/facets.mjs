import {
  cloneCanonical,
  contractError,
  deepFreeze,
} from './canonical.mjs';
import {
  FACET_CLASSES,
  FACET_OPERATION_BY_CLASS,
  FACET_OPERATIONS,
} from './constants.mjs';
import {
  validateProviderFacetBinding,
  validateScenarioReference,
} from './records.mjs';
import { validateFixtureOutput } from './adapter.mjs';

function fail(code, message) {
  throw contractError(code, message);
}

export function validateCanonicalOwnerMap(ownerMap) {
  if (ownerMap === null || typeof ownerMap !== 'object' || Array.isArray(ownerMap)) fail('OWNER_MAP_INVALID', 'canonical owner map must be an object');
  if (ownerMap.schema !== 'CanonicalOwnerMapV1' || ownerMap.version !== 1 || !Array.isArray(ownerMap.facets)) {
    fail('OWNER_MAP_VERSION_INVALID', 'canonical owner map must be V1');
  }
  if (ownerMap.facets.length !== FACET_CLASSES.length) fail('OWNER_MAP_INCOMPLETE', 'canonical owner map must contain exactly one row per facet');
  const seen = new Set();
  for (const binding of ownerMap.facets) {
    validateProviderFacetBinding(binding);
    if (seen.has(binding.facetClass)) fail('OWNER_MAP_DUPLICATE_FACET', `duplicate owner map facet ${binding.facetClass}`);
    seen.add(binding.facetClass);
    if (binding.operation !== FACET_OPERATION_BY_CLASS[binding.facetClass]) fail('FACET_OPERATION_MISMATCH', `${binding.facetClass} uses the wrong frozen operation`);
    if (binding.bindingStatus === 'USABLE') {
      if (!/^[a-f0-9]{40}$/.test(binding.acceptedOwnerCommitSha ?? '')) fail('OWNER_COMMIT_UNRESOLVED', `${binding.facetClass} lacks an exact accepted owner commit`);
      if (!Array.isArray(binding.ownerEvidenceRefs) || binding.ownerEvidenceRefs.length === 0) fail('OWNER_EVIDENCE_UNRESOLVED', `${binding.facetClass} lacks owner evidence references`);
      if ([binding.canonicalOwnerRef, binding.canonicalContractRef, binding.canonicalContractVersion].some((value) => value.includes('UNRESOLVED'))) {
        fail('OWNER_CONTRACT_UNRESOLVED', `${binding.facetClass} cannot be usable with an unresolved owner, contract, or version`);
      }
    } else if (typeof binding.insertionRequestRef !== 'string' || binding.insertionRequestRef.length === 0) {
      fail('BLOCKED_OWNER_INSERTION_MISSING', `${binding.facetClass} blocker lacks an insertion request`);
    }
  }
  for (const facetClass of FACET_CLASSES) {
    if (!seen.has(facetClass)) fail('OWNER_MAP_FACET_MISSING', `owner map is missing ${facetClass}`);
  }
  return true;
}

const SHARED_OWNER_REFERENCE_IDS = Object.freeze([
  'Q_EVIDENCE_AND_DATA_SOURCE',
  'IP_EXPECTED_INVENTORY_AND_TELEMETRY',
  'AI_OPS_AGENT_POLICY_BOUNDARY',
  'PRODUCT_HEALTH',
  'PRODUCT_INCIDENT',
]);

function nonEmptyReferenceString(value) {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 8_192;
}

export function validateCanonicalSharedOwnerReferenceMap(referenceMap) {
  if (referenceMap?.schema !== 'CanonicalSharedOwnerReferenceMapV1' || referenceMap.version !== 1 || !Array.isArray(referenceMap.references)) {
    fail('SHARED_OWNER_MAP_INVALID', 'canonical shared-owner reference map must be V1');
  }
  if (referenceMap.references.length !== SHARED_OWNER_REFERENCE_IDS.length) fail('SHARED_OWNER_MAP_INCOMPLETE', 'shared-owner map is incomplete');
  const seen = new Set();
  for (const reference of referenceMap.references) {
    if (!SHARED_OWNER_REFERENCE_IDS.includes(reference.referenceId) || seen.has(reference.referenceId)) {
      fail('SHARED_OWNER_REFERENCE_ID_INVALID', 'shared-owner reference identity is unknown or duplicated');
    }
    seen.add(reference.referenceId);
    if (!['USABLE', 'BLOCKED'].includes(reference.compatibilityStatus)) fail('SHARED_OWNER_STATUS_INVALID', `${reference.referenceId} has invalid status`);
    for (const field of ['canonicalOwnerRef', 'canonicalContractRef', 'canonicalContractVersion']) {
      if (!nonEmptyReferenceString(reference[field])) fail('SHARED_OWNER_REFERENCE_INVALID', `${reference.referenceId}.${field} is invalid`);
    }
    if (!Array.isArray(reference.ownerEvidenceRefs) || reference.ownerEvidenceRefs.length === 0 || reference.ownerEvidenceRefs.some((value) => !nonEmptyReferenceString(value))) {
      fail('SHARED_OWNER_EVIDENCE_INVALID', `${reference.referenceId} lacks exact owner evidence`);
    }
    if (!Array.isArray(reference.limitations) || reference.limitations.some((value) => !nonEmptyReferenceString(value))) {
      fail('SHARED_OWNER_LIMITATIONS_INVALID', `${reference.referenceId} limitations are invalid`);
    }
    if (reference.compatibilityStatus === 'USABLE') {
      if (!/^[a-f0-9]{40}$/.test(reference.acceptedOwnerCommitSha ?? '')) fail('SHARED_OWNER_COMMIT_UNRESOLVED', `${reference.referenceId} lacks an exact owner commit`);
      if ([reference.canonicalOwnerRef, reference.canonicalContractRef, reference.canonicalContractVersion].some((value) => value.includes('UNRESOLVED'))) {
        fail('SHARED_OWNER_CONTRACT_UNRESOLVED', `${reference.referenceId} cannot be usable while unresolved`);
      }
      if (reference.blockedReason !== null || reference.insertionRequestRef !== null) fail('SHARED_OWNER_USABLE_HAS_BLOCKER', `${reference.referenceId} is usable but carries a blocker`);
    } else {
      if (!nonEmptyReferenceString(reference.blockedReason) || !nonEmptyReferenceString(reference.insertionRequestRef)) {
        fail('SHARED_OWNER_BLOCKER_INVALID', `${reference.referenceId} needs an exact blocker and insertion request`);
      }
    }
  }
  return true;
}

export function invokeFacet({ binding, requestFacetClass, operation, request, handler }) {
  validateProviderFacetBinding(binding);
  if (binding.bindingStatus !== 'USABLE') fail('FACET_BINDING_BLOCKED', `${binding.facetClass} is blocked: ${binding.blockedReason}`);
  if (!FACET_CLASSES.includes(requestFacetClass) || requestFacetClass !== binding.facetClass) fail('FACET_CLASS_CROSSING', 'provider facet cannot cross its declared class');
  if (!FACET_OPERATIONS.includes(operation) || operation !== binding.operation) fail('FACET_OPERATION_FORBIDDEN', 'provider facet operation is not the frozen operation');
  if (request?.facetClass !== binding.facetClass || request?.operation !== binding.operation) {
    fail('FACET_REQUEST_BINDING_MISMATCH', 'fixture request payload must repeat the exact bound facet class and operation');
  }
  if (request?.networkMode !== 'FIXTURE_ONLY' || request?.authorityClass !== 'NO_AUTHORITY') fail('FACET_REQUEST_BOUNDARY_INVALID', 'provider facet request must be fixture-only and non-authoritative');
  if (typeof handler !== 'function') fail('FACET_HANDLER_REQUIRED', 'injected fixture facet handler is required');
  const output = handler(deepFreeze(cloneCanonical(request)));
  validateFixtureOutput(output);
  return deepFreeze(cloneCanonical(output));
}

export function assertScenarioReferenceOperation(reference, operation) {
  validateScenarioReference(reference);
  if (!['DESCRIBE', 'VALIDATE_FIXTURE'].includes(operation)) {
    fail('SCENARIO_OPERATION_FORBIDDEN', 'scenario references cannot execute, mutate a twin, or redefine canonical expected truth');
  }
  return deepFreeze({
    operation,
    scenarioId: reference.scenarioId,
    immutable: Object.isFrozen(reference),
    executed: false,
    canonicalTruthMutated: false,
  });
}

export function validateModuleFacetMatrix(matrix) {
  if (matrix?.schema !== 'ModuleFacetMatrixV1' || matrix.version !== 1 || !Array.isArray(matrix.modules)) {
    fail('MODULE_FACET_MATRIX_INVALID', 'module facet matrix must be V1');
  }
  const moduleIds = matrix.modules.map((row) => row.moduleId);
  if (new Set(moduleIds).size !== moduleIds.length) fail('MODULE_FACET_DUPLICATE', 'module facet matrix contains duplicate modules');
  const exactRequirements = {
    F1: ['VenueMesh', ['EVIDENCE', 'DERIVED_FEATURE']],
    F2: ['PortfolioLab', ['ADVISORY_ASSESSOR', 'SCENARIO_REFERENCE', 'COCKPIT_PROJECTION']],
    F3: ['StrategyArena', ['EXPERIMENT_PROVIDER', 'SCENARIO_REFERENCE', 'COCKPIT_PROJECTION']],
    F4: ['OperatorGym', ['SCENARIO_REFERENCE', 'COCKPIT_PROJECTION']],
    F5: ['ChangeRadar', ['EVIDENCE', 'ADVISORY_ASSESSOR', 'COCKPIT_PROJECTION']],
    F6: ['Nerve', ['EVIDENCE', 'COCKPIT_PROJECTION']],
    F7: ['Chronos', ['REPLAY_ADAPTER', 'COCKPIT_PROJECTION']],
    F8: ['EdgeMeter', ['ADVISORY_ASSESSOR', 'COCKPIT_PROJECTION']],
    F9: ['Narrator', ['COCKPIT_PROJECTION']],
    F10: ['Lineage', ['COCKPIT_PROJECTION']],
    F11: ['LabelForge', ['ANNOTATION_ADAPTER', 'COCKPIT_PROJECTION']],
    F12: ['ScenarioBank', ['SCENARIO_REFERENCE']],
    F13: ['DecisionLab', ['EXPERIMENT_PROVIDER', 'COCKPIT_PROJECTION']],
  };
  if (matrix.modules.length !== Object.keys(exactRequirements).length) fail('MODULE_FACET_MATRIX_INCOMPLETE', 'module facet matrix must contain F1 through F13 exactly once');
  for (const row of matrix.modules) {
    if (!Array.isArray(row.requiredUsableFacets) || row.requiredUsableFacets.some((facet) => !FACET_CLASSES.includes(facet))) {
      fail('MODULE_FACET_UNKNOWN', `${row.moduleId} has an unknown required facet`);
    }
    const expected = exactRequirements[row.moduleId];
    if (!expected || row.moduleName !== expected[0]
      || row.requiredUsableFacets.length !== expected[1].length
      || row.requiredUsableFacets.some((facet, index) => facet !== expected[1][index])) {
      fail('MODULE_FACET_REQUIREMENT_MISMATCH', `${row.moduleId} does not match the frozen Frontier release recipe`);
    }
  }
  return true;
}
