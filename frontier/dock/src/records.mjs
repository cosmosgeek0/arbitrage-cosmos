import {
  assertHash,
  canonicalize,
  cloneCanonical,
  contractError,
  deepFreeze,
  omitFields,
  sha256,
} from './canonical.mjs';
import {
  BUILD_STATES,
  CANONICAL_ADAPTER_MAP_V1_FIELDS,
  DISPOSITIONS,
  DOCK_CONTRACT_VERSION,
  EXTENSION_DESCRIPTOR_V1_FIELDS,
  FACET_CLASSES,
  FACET_OPERATIONS,
  PROVIDER_FACET_BINDING_V1_FIELDS,
  RESERVED_ATTESTATION_FIELDS,
  SCENARIO_REFERENCE_V1_FIELDS,
} from './constants.mjs';
import { negotiateContractVersion, parseSemver } from './semver.mjs';

const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function fail(code, message) {
  throw contractError(code, message);
}

function asRecord(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('RECORD_REQUIRED', `${name} must be an object`);
  return value;
}

function requireFields(value, fields, name) {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) fail('REQUIRED_FIELD_MISSING', `${name}.${field} is required`);
  }
}

function boundedString(value, name, maximum = 1_024) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    fail('STRING_INVALID', `${name} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function stringArray(value, name, maximum = 512) {
  if (!Array.isArray(value) || value.length > maximum) fail('STRING_ARRAY_INVALID', `${name} must be a bounded array`);
  value.forEach((entry, index) => boundedString(entry, `${name}[${index}]`));
  if (new Set(value).size !== value.length) fail('DUPLICATE_ARRAY_VALUE', `${name} contains duplicates`);
  return value;
}

function enumValue(value, allowed, name) {
  if (!allowed.includes(value)) fail('ENUM_INVALID', `${name} has unsupported value ${String(value)}`);
  return value;
}

function safeNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail('INTEGER_INVALID', `${name} must be a non-negative safe integer`);
  return value;
}

function nonNegativeFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) {
    fail('RESOURCE_NUMBER_INVALID', `${name} must be a finite non-negative number`);
  }
  return value;
}

function validateLatencyPercentiles(value, name) {
  const percentiles = asRecord(value, name);
  requireFields(percentiles, ['p50', 'p95', 'p99'], name);
  nonNegativeFiniteNumber(percentiles.p50, `${name}.p50`);
  nonNegativeFiniteNumber(percentiles.p95, `${name}.p95`);
  nonNegativeFiniteNumber(percentiles.p99, `${name}.p99`);
  if (percentiles.p50 > percentiles.p95 || percentiles.p95 > percentiles.p99) {
    fail('LATENCY_PERCENTILE_ORDER_INVALID', `${name} must satisfy p50 <= p95 <= p99`);
  }
}

function shaValue(value, name) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) fail('SHA_INVALID', `${name} must be a lowercase Git or SHA-256 identity`);
  return value;
}

function exactBoolean(value, expected, name) {
  if (value !== expected) fail('BOOLEAN_INVARIANT_VIOLATION', `${name} must be ${String(expected)}`);
}

function canonicalHashRecord(input, hashField) {
  const record = cloneCanonical(input);
  record[hashField] = sha256(omitFields(record, [hashField]));
  return record;
}

export function validateResourceBudgetClaim(input) {
  const claim = asRecord(input, 'ResourceBudgetClaimV1');
  requireFields(claim, [
    'claimId',
    'measurementMode',
    'cpu',
    'memory',
    'disk',
    'network',
    'eventRate',
    'latency',
    'queue',
    'storageGrowth',
    'modelUse',
  ], 'ResourceBudgetClaimV1');
  boundedString(claim.claimId, 'ResourceBudgetClaimV1.claimId');
  enumValue(claim.measurementMode, ['DETERMINISTIC_FIXTURE', 'UNAVAILABLE_PRESTAGE'], 'ResourceBudgetClaimV1.measurementMode');

  for (const field of ['cpu', 'memory', 'disk', 'network', 'eventRate', 'latency', 'queue', 'storageGrowth', 'modelUse']) {
    const metric = asRecord(claim[field], `ResourceBudgetClaimV1.${field}`);
    requireFields(metric, ['state', 'unit'], `ResourceBudgetClaimV1.${field}`);
    enumValue(metric.state, ['MEASURED', 'UNAVAILABLE'], `ResourceBudgetClaimV1.${field}.state`);
    boundedString(metric.unit, `ResourceBudgetClaimV1.${field}.unit`);
    if (metric.state === 'UNAVAILABLE') {
      boundedString(metric.reason, `ResourceBudgetClaimV1.${field}.reason`);
      if (['limit', 'observed', 'backpressure'].some((known) => Object.hasOwn(metric, known))) {
        fail('RESOURCE_STATE_SHAPE_INVALID', `ResourceBudgetClaimV1.${field} cannot mix unavailable and measured fields`);
      }
    } else {
      if (Object.hasOwn(metric, 'reason')) fail('RESOURCE_STATE_SHAPE_INVALID', `ResourceBudgetClaimV1.${field} cannot mix measured and unavailable fields`);
      requireFields(metric, ['limit', 'observed'], `ResourceBudgetClaimV1.${field}`);
      if (field === 'latency') {
        validateLatencyPercentiles(metric.limit, `ResourceBudgetClaimV1.${field}.limit`);
        validateLatencyPercentiles(metric.observed, `ResourceBudgetClaimV1.${field}.observed`);
      } else {
        if (field === 'cpu') {
          nonNegativeFiniteNumber(metric.limit, `ResourceBudgetClaimV1.${field}.limit`);
          nonNegativeFiniteNumber(metric.observed, `ResourceBudgetClaimV1.${field}.observed`);
        } else {
          safeNonNegativeInteger(metric.limit, `ResourceBudgetClaimV1.${field}.limit`);
          safeNonNegativeInteger(metric.observed, `ResourceBudgetClaimV1.${field}.observed`);
        }
      }
      if (field === 'queue') {
        enumValue(metric.backpressure, ['FAIL_CLOSED_WITH_DEGRADATION_REQUEST'], 'ResourceBudgetClaimV1.queue.backpressure');
      }
      if (field === 'latency') {
        for (const percentile of ['p50', 'p95', 'p99']) {
          if (metric.observed[percentile] > metric.limit[percentile]) fail('RESOURCE_OBSERVED_EXCEEDS_LIMIT', `ResourceBudgetClaimV1.${field}.observed.${percentile} exceeds its limit`);
        }
      } else if (metric.observed > metric.limit) {
        fail('RESOURCE_OBSERVED_EXCEEDS_LIMIT', `ResourceBudgetClaimV1.${field}.observed exceeds its limit`);
      }
    }
  }
  if (claim.measurementMode === 'UNAVAILABLE_PRESTAGE'
    && ['cpu', 'memory', 'disk', 'network', 'eventRate', 'latency', 'queue', 'storageGrowth', 'modelUse'].some((field) => claim[field].state !== 'UNAVAILABLE')) {
    fail('RESOURCE_MEASUREMENT_MODE_INVALID', 'unavailable prestage claims cannot contain measured metrics');
  }
  return true;
}

export function validateMaxSafeRateClaim(input) {
  const claim = asRecord(input, 'MaxSafeRateClaimV1');
  requireFields(claim, ['measurementMode', 'eventsPerWindow', 'windowSizeMs', 'queueCapacity', 'backpressurePolicy'], 'MaxSafeRateClaimV1');
  if (claim.measurementMode !== 'DETERMINISTIC_FIXTURE') fail('RATE_MEASUREMENT_MODE_INVALID', 'maximum safe rate must be fixture-measured');
  safeNonNegativeInteger(claim.eventsPerWindow, 'MaxSafeRateClaimV1.eventsPerWindow');
  safeNonNegativeInteger(claim.windowSizeMs, 'MaxSafeRateClaimV1.windowSizeMs');
  safeNonNegativeInteger(claim.queueCapacity, 'MaxSafeRateClaimV1.queueCapacity');
  enumValue(claim.backpressurePolicy, ['FAIL_CLOSED', 'DEGRADE_REQUEST'], 'MaxSafeRateClaimV1.backpressurePolicy');
  if (claim.windowSizeMs === 0) fail('RATE_WINDOW_INVALID', 'maximum safe rate window must be greater than zero');
  if (claim.eventsPerWindow === 0) fail('RATE_EVENTS_INVALID', 'maximum safe rate must measure at least one event per window');
  return true;
}

export function validateResourceRateCompatibility(resourceBudgetClaim, maxSafeRateClaim) {
  validateResourceBudgetClaim(resourceBudgetClaim);
  validateMaxSafeRateClaim(maxSafeRateClaim);
  if (resourceBudgetClaim.measurementMode !== 'DETERMINISTIC_FIXTURE') fail('RESOURCE_MEASUREMENT_MODE_INVALID', 'maximum safe rate requires a deterministic fixture resource claim');
  for (const metric of ['network', 'eventRate', 'latency', 'queue', 'storageGrowth', 'modelUse']) {
    if (resourceBudgetClaim[metric].state !== 'MEASURED') fail('RESOURCE_RUNTIME_LIMIT_UNAVAILABLE', `${metric} must be measured for a fixture load proof`);
  }
  const expectedUnits = {
    network: 'bytes',
    eventRate: `events-per-${maxSafeRateClaim.windowSizeMs}ms-fixture-window`,
    latency: 'deterministic-fixture-steps',
    queue: 'events',
    storageGrowth: 'fixture-bytes-per-window',
    modelUse: 'calls',
  };
  for (const [metric, unit] of Object.entries(expectedUnits)) {
    if (resourceBudgetClaim[metric].unit !== unit) fail('RESOURCE_UNIT_MISMATCH', `${metric} must use ${unit}`);
  }
  if (maxSafeRateClaim.eventsPerWindow > resourceBudgetClaim.eventRate.limit
    || maxSafeRateClaim.queueCapacity > resourceBudgetClaim.queue.limit) {
    fail('SAFE_RATE_EXCEEDS_RESOURCE_CLAIM', 'maximum safe rate cannot exceed the resource budget claim');
  }
  if (resourceBudgetClaim.eventRate.observed !== maxSafeRateClaim.eventsPerWindow
    || resourceBudgetClaim.queue.observed > maxSafeRateClaim.queueCapacity) {
    fail('MAX_RATE_CLAIM_INCONSISTENT', 'resource observations must match the maximum-rate proof');
  }
  return true;
}

function validatePlans(descriptor) {
  const disable = asRecord(descriptor.disablePlan, 'ExtensionDescriptorV1.disablePlan');
  requireFields(disable, ['authority', 'idempotent'], 'ExtensionDescriptorV1.disablePlan');
  if (disable.authority !== 'CANONICAL_OWNER_REQUIRED' || disable.idempotent !== true) {
    fail('DISABLE_PLAN_INVALID', 'disable plan must be idempotent and canonical-owner gated');
  }

  const rollback = asRecord(descriptor.rollbackPlan, 'ExtensionDescriptorV1.rollbackPlan');
  requireFields(rollback, ['authority', 'pinnedVersion'], 'ExtensionDescriptorV1.rollbackPlan');
  if (rollback.authority !== 'CANONICAL_OWNER_REQUIRED') fail('ROLLBACK_AUTHORITY_INVALID', 'rollback requires canonical owner authority');
  parseSemver(rollback.pinnedVersion);

  const uninstall = asRecord(descriptor.uninstallPlan, 'ExtensionDescriptorV1.uninstallPlan');
  requireFields(uninstall, ['authority', 'deleteCanonicalEvidence'], 'ExtensionDescriptorV1.uninstallPlan');
  if (uninstall.authority !== 'CANONICAL_OWNER_REQUIRED' || uninstall.deleteCanonicalEvidence !== false) {
    fail('UNINSTALL_PLAN_INVALID', 'uninstall cannot delete canonical evidence and requires canonical owner authority');
  }
}

export function canonicalDescriptorPayload(descriptor) {
  return omitFields(descriptor, [...RESERVED_ATTESTATION_FIELDS, 'descriptorHash']);
}

export function descriptorHashFor(descriptor) {
  return sha256(canonicalDescriptorPayload(descriptor));
}

export function validateExtensionDescriptor(input) {
  const descriptor = asRecord(input, 'ExtensionDescriptorV1');
  requireFields(descriptor, EXTENSION_DESCRIPTOR_V1_FIELDS, 'ExtensionDescriptorV1');
  for (const field of RESERVED_ATTESTATION_FIELDS) {
    if (field !== 'descriptorHash' && Object.hasOwn(descriptor, field)) {
      fail('ATTESTATION_EMBEDDED', `descriptor field ${field} is reserved for external attestation`);
    }
  }
  boundedString(descriptor.extensionId, 'ExtensionDescriptorV1.extensionId', 128);
  boundedString(descriptor.displayName, 'ExtensionDescriptorV1.displayName', 256);
  parseSemver(descriptor.extensionVersion);
  negotiateContractVersion(descriptor.dockContractVersion, DOCK_CONTRACT_VERSION);
  boundedString(descriptor.owner, 'ExtensionDescriptorV1.owner', 256);
  boundedString(descriptor.purpose, 'ExtensionDescriptorV1.purpose', 2_048);
  boundedString(descriptor.capabilityClass, 'ExtensionDescriptorV1.capabilityClass', 128);
  shaValue(descriptor.immutableBaseSha, 'ExtensionDescriptorV1.immutableBaseSha');
  shaValue(descriptor.sourceSha, 'ExtensionDescriptorV1.sourceSha');
  enumValue(descriptor.buildState, BUILD_STATES, 'ExtensionDescriptorV1.buildState');
  enumValue(descriptor.disposition, DISPOSITIONS, 'ExtensionDescriptorV1.disposition');
  if (descriptor.authorityClass !== 'NO_AUTHORITY') fail('SELF_GRANTED_AUTHORITY', 'extension descriptors cannot grant authority');
  if (descriptor.networkMode !== 'FIXTURE_ONLY') fail('NETWORK_MODE_FORBIDDEN', 'Dock descriptors are fixture-only');
  if (descriptor.secretMode !== 'NONE') fail('SECRET_MODE_FORBIDDEN', 'Dock descriptors cannot request secrets');

  for (const field of [
    'canonicalInputContractRefs',
    'canonicalOutputContractRefs',
    'canonicalPolicyRefs',
    'adapterMapRefs',
    'requestedCapabilities',
    'requiredCapabilityRefs',
    'optionalCapabilityRefs',
    'hardDenialRefs',
    'dataSourceRefs',
    'dataClassifications',
    'licenseAndTermsRefs',
    'failureModes',
    'knownLimitations',
    'testEntryPointRefs',
  ]) stringArray(descriptor[field], `ExtensionDescriptorV1.${field}`);

  for (const field of [
    'latencyClass',
    'freshnessRequirement',
    'completenessRequirement',
    'determinismClass',
    'replayClass',
    'egressDeclaration',
    'retentionRequest',
    'degradationBehavior',
    'healthContractRef',
    'cockpitProjectionRef',
    'testReceiptRef',
    'insertionRequestRef',
  ]) boundedString(descriptor[field], `ExtensionDescriptorV1.${field}`, 2_048);

  validateResourceRateCompatibility(descriptor.resourceBudgetClaim, descriptor.maxSafeRateClaim);
  validatePlans(descriptor);
  if (descriptor.descriptorHash !== descriptorHashFor(descriptor)) fail('DESCRIPTOR_HASH_MISMATCH', 'descriptorHash does not match canonical descriptor payload');
  return true;
}

export function createExtensionDescriptor(input) {
  const record = cloneCanonical(input);
  for (const field of RESERVED_ATTESTATION_FIELDS) {
    if (Object.hasOwn(record, field)) fail('ATTESTATION_EMBEDDED', `descriptor field ${field} is reserved for external attestation`);
  }
  record.descriptorHash = descriptorHashFor(record);
  validateExtensionDescriptor(record);
  return deepFreeze(record);
}

export function parseExtensionDescriptor(input) {
  const record = cloneCanonical(input);
  validateExtensionDescriptor(record);
  return deepFreeze(record);
}

export function validateCanonicalAdapterMap(input) {
  const map = asRecord(input, 'CanonicalAdapterMapV1');
  requireFields(map, CANONICAL_ADAPTER_MAP_V1_FIELDS, 'CanonicalAdapterMapV1');
  for (const field of ['adapterId', 'extensionId', 'localFixtureSchema', 'canonicalOwner', 'canonicalContractId', 'canonicalContractVersion', 'unknownPropagation']) {
    boundedString(map[field], `CanonicalAdapterMapV1.${field}`);
  }
  if (map.lossy !== false) fail('LOSSY_ADAPTER_FORBIDDEN', 'canonical adapter maps must be lossless');
  if (!Array.isArray(map.fieldMap) || map.fieldMap.length === 0) fail('FIELD_MAP_REQUIRED', 'CanonicalAdapterMapV1.fieldMap must not be empty');
  map.fieldMap.forEach((entry, index) => {
    const row = asRecord(entry, `CanonicalAdapterMapV1.fieldMap[${index}]`);
    requireFields(row, ['localPath', 'canonicalPath', 'transform'], `CanonicalAdapterMapV1.fieldMap[${index}]`);
    boundedString(row.localPath, `CanonicalAdapterMapV1.fieldMap[${index}].localPath`);
    boundedString(row.canonicalPath, `CanonicalAdapterMapV1.fieldMap[${index}].canonicalPath`);
    if (row.transform !== 'IDENTITY') fail('NON_IDENTITY_TRANSFORM_FORBIDDEN', 'fixture adapter maps allow identity transforms only');
  });
  const localPaths = map.fieldMap.map((entry) => entry.localPath);
  const canonicalPaths = map.fieldMap.map((entry) => entry.canonicalPath);
  if (new Set(localPaths).size !== localPaths.length || new Set(canonicalPaths).size !== canonicalPaths.length) {
    fail('ADAPTER_PATH_DUPLICATE', 'adapter source and target paths must be unique');
  }
  for (const paths of [localPaths, canonicalPaths]) {
    for (const left of paths) {
      if (paths.some((right) => left !== right && (left.startsWith(`${right}.`) || right.startsWith(`${left}.`)))) {
        fail('ADAPTER_PATH_COLLISION', 'adapter paths cannot overlap parent and child locations');
      }
    }
  }
  if (!Array.isArray(map.unitMap)) fail('UNIT_MAP_INVALID', 'CanonicalAdapterMapV1.unitMap must be an array');
  map.unitMap.forEach((entry, index) => {
    const row = asRecord(entry, `CanonicalAdapterMapV1.unitMap[${index}]`);
    requireFields(row, ['localUnit', 'canonicalUnit', 'transform'], `CanonicalAdapterMapV1.unitMap[${index}]`);
    boundedString(row.localUnit, `CanonicalAdapterMapV1.unitMap[${index}].localUnit`);
    boundedString(row.canonicalUnit, `CanonicalAdapterMapV1.unitMap[${index}].canonicalUnit`);
    if (row.transform !== 'IDENTITY') fail('NON_IDENTITY_UNIT_TRANSFORM_FORBIDDEN', 'fixture unit maps allow identity transforms only');
    if (row.localUnit !== row.canonicalUnit) fail('IDENTITY_UNIT_MISMATCH', 'identity unit maps cannot rename or convert units');
  });
  const localUnits = map.unitMap.map((entry) => entry.localUnit);
  const canonicalUnits = map.unitMap.map((entry) => entry.canonicalUnit);
  if (new Set(localUnits).size !== localUnits.length || new Set(canonicalUnits).size !== canonicalUnits.length) {
    fail('ADAPTER_UNIT_DUPLICATE', 'adapter unit identities must be unique and unambiguous');
  }
  const time = asRecord(map.timeSemantics, 'CanonicalAdapterMapV1.timeSemantics');
  requireFields(time, ['eventTime', 'receiveTime', 'clock'], 'CanonicalAdapterMapV1.timeSemantics');
  if (time.eventTime !== 'PRESERVE_EXACT' || time.receiveTime !== 'PRESERVE_EXACT' || time.clock !== 'INJECTED_FIXTURE') {
    fail('TIME_SEMANTICS_INVALID', 'fixture adapter time semantics must preserve both times under an injected clock');
  }
  if (map.unknownPropagation !== 'PRESERVE_EXACT_OR_FAIL_CLOSED') {
    fail('UNKNOWN_PROPAGATION_INVALID', 'unknown values must be preserved exactly or fail closed');
  }
  if (!Array.isArray(map.unsupportedFields) || map.unsupportedFields.length !== 0) {
    fail('UNSUPPORTED_FIELD_LOSS', 'lossless adapter maps cannot leave unsupported fields');
  }
  stringArray(map.testVectors, 'CanonicalAdapterMapV1.testVectors');
  if (map.testVectors.length === 0) fail('ADAPTER_TEST_VECTOR_REQUIRED', 'adapter map must name at least one deterministic test vector');
  assertHash(map, 'adapterHash', 'ADAPTER_HASH_MISMATCH');
  return true;
}

export function createCanonicalAdapterMap(input) {
  const record = canonicalHashRecord(input, 'adapterHash');
  validateCanonicalAdapterMap(record);
  return deepFreeze(record);
}

export function validateProviderFacetBinding(input) {
  const binding = asRecord(input, 'ProviderFacetBindingV1');
  requireFields(binding, PROVIDER_FACET_BINDING_V1_FIELDS, 'ProviderFacetBindingV1');
  for (const field of [
    'providerId',
    'extensionId',
    'facetClass',
    'canonicalOwnerRef',
    'canonicalContractRef',
    'canonicalContractVersion',
    'extensionProviderRef',
    'fixtureRequestSchemaRef',
    'fixtureResponseSchemaRef',
    'canonicalAdapterMapRef',
    'operation',
    'unknownPropagation',
    'resourceBudgetClaimRef',
    'provenanceRef',
    'bindingStatus',
  ]) boundedString(binding[field], `ProviderFacetBindingV1.${field}`, 2_048);
  enumValue(binding.facetClass, FACET_CLASSES, 'ProviderFacetBindingV1.facetClass');
  enumValue(binding.operation, FACET_OPERATIONS, 'ProviderFacetBindingV1.operation');
  enumValue(binding.bindingStatus, ['USABLE', 'BLOCKED'], 'ProviderFacetBindingV1.bindingStatus');
  exactBoolean(binding.readOnly, true, 'ProviderFacetBindingV1.readOnly');
  if (binding.networkMode !== 'FIXTURE_ONLY') fail('FACET_NETWORK_FORBIDDEN', 'provider facets are fixture-only');
  if (binding.authorityClass !== 'NO_AUTHORITY') fail('FACET_AUTHORITY_FORBIDDEN', 'provider facets have no authority');
  if (binding.bindingStatus === 'USABLE') {
    if (binding.blockedReason !== null) fail('USABLE_BINDING_HAS_BLOCKER', 'usable bindings cannot carry a blocker');
    if (Object.hasOwn(binding, 'insertionRequestRef')) fail('USABLE_BINDING_HAS_INSERTION', 'usable bindings cannot carry an insertion request');
    if ([binding.canonicalOwnerRef, binding.canonicalContractRef, binding.canonicalContractVersion].some((value) => value.includes('UNRESOLVED'))) {
      fail('OWNER_CONTRACT_UNRESOLVED', 'usable bindings require exact canonical owner, contract, and version references');
    }
    if (!/^[a-f0-9]{40}$/.test(binding.acceptedOwnerCommitSha ?? '')) fail('OWNER_COMMIT_UNRESOLVED', 'usable bindings require an exact accepted owner commit');
    if (!Array.isArray(binding.ownerEvidenceRefs) || binding.ownerEvidenceRefs.length === 0) fail('OWNER_EVIDENCE_UNRESOLVED', 'usable bindings require owner evidence references');
  }
  if (binding.bindingStatus === 'BLOCKED') {
    boundedString(binding.blockedReason, 'ProviderFacetBindingV1.blockedReason');
    if (!Object.hasOwn(binding, 'insertionRequestRef')) fail('BLOCKED_BINDING_INSERTION_REQUIRED', 'blocked binding requires an insertion request');
    boundedString(binding.insertionRequestRef, 'ProviderFacetBindingV1.insertionRequestRef');
  }
  assertHash(binding, 'bindingHash', 'BINDING_HASH_MISMATCH');
  return true;
}

export function createProviderFacetBinding(input) {
  const record = canonicalHashRecord(input, 'bindingHash');
  validateProviderFacetBinding(record);
  return deepFreeze(record);
}

export function validateScenarioReference(input) {
  const reference = asRecord(input, 'ScenarioReferenceV1');
  requireFields(reference, SCENARIO_REFERENCE_V1_FIELDS, 'ScenarioReferenceV1');
  for (const field of ['scenarioId', 'scenarioVersion', 'extensionProviderRef', 'fixtureSchemaRef', 'clockRef']) {
    boundedString(reference[field], `ScenarioReferenceV1.${field}`);
  }
  parseSemver(reference.scenarioVersion);
  if (reference.extensionProviderRef !== 'F12') fail('SCENARIO_PROVIDER_INVALID', 'F12 is the sole optional-extension scenario definition provider');
  if (!Number.isSafeInteger(reference.seed)) fail('SCENARIO_SEED_INVALID', 'ScenarioReferenceV1.seed must be a safe integer');
  stringArray(reference.lineageRefs, 'ScenarioReferenceV1.lineageRefs');
  stringArray(reference.expectedCanonicalPostureRefs, 'ScenarioReferenceV1.expectedCanonicalPostureRefs');
  assertHash(reference, 'scenarioHash', 'SCENARIO_HASH_MISMATCH');
  return true;
}

export function createScenarioReference(input) {
  const record = canonicalHashRecord(input, 'scenarioHash');
  validateScenarioReference(record);
  return deepFreeze(record);
}

export function validateInsertionRequest(input, allowedSeams = null) {
  const request = asRecord(input, 'InsertionRequestV1');
  requireFields(request, [
    'requestId',
    'extensionId',
    'requestVersion',
    'intendedSharedSeams',
    'canonicalOwnerDecisions',
    'requestedCapabilities',
    'egressDeclaration',
    'retentionRequest',
    'resourceBudgetClaimRef',
    'blockedFacetRequests',
    'futureTests',
    'authorityClass',
    'networkMode',
    'mutationImplemented',
  ], 'InsertionRequestV1');
  for (const field of ['requestId', 'extensionId', 'requestVersion', 'egressDeclaration', 'retentionRequest', 'resourceBudgetClaimRef']) {
    boundedString(request[field], `InsertionRequestV1.${field}`);
  }
  parseSemver(request.requestVersion);
  for (const field of ['intendedSharedSeams', 'canonicalOwnerDecisions', 'requestedCapabilities', 'blockedFacetRequests', 'futureTests']) {
    stringArray(request[field], `InsertionRequestV1.${field}`);
  }
  if (request.authorityClass !== 'NO_AUTHORITY' || request.networkMode !== 'FIXTURE_ONLY' || request.mutationImplemented !== false) {
    fail('INSERTION_AUTHORITY_WIDENING', 'insertion requests are non-authoritative fixture-only requests and implement no mutation');
  }
  if (allowedSeams !== null) {
    stringArray(allowedSeams, 'allowedSeams');
    const requested = [...request.intendedSharedSeams].sort();
    const allowed = [...allowedSeams].sort();
    if (canonicalize(requested) !== canonicalize(allowed)) fail('INSERTION_SEAM_MISMATCH', 'insertion request must name every intended shared seam and no others');
  }
  return true;
}

export function validateModuleInventoryProjection(input) {
  const projection = asRecord(input, 'ModuleInventoryProjectionV1');
  requireFields(projection, ['schema', 'version', 'readOnly', 'generatedAt', 'modules'], 'ModuleInventoryProjectionV1');
  if (projection.schema !== 'ModuleInventoryProjectionV1' || projection.version !== 1 || projection.readOnly !== true) {
    fail('INVENTORY_PROJECTION_INVALID', 'module inventory projection must be read-only V1');
  }
  safeNonNegativeInteger(projection.generatedAt, 'ModuleInventoryProjectionV1.generatedAt');
  if (!Array.isArray(projection.modules)) fail('INVENTORY_MODULES_INVALID', 'ModuleInventoryProjectionV1.modules must be an array');
  const identities = new Set();
  for (const [index, module] of projection.modules.entries()) {
    const row = asRecord(module, `ModuleInventoryProjectionV1.modules[${index}]`);
    requireFields(row, ['extensionId', 'extensionVersion', 'descriptorHash', 'status', 'authorityClass', 'controls'], `ModuleInventoryProjectionV1.modules[${index}]`);
    boundedString(row.extensionId, `ModuleInventoryProjectionV1.modules[${index}].extensionId`, 128);
    parseSemver(row.extensionVersion);
    if (!/^[a-f0-9]{64}$/.test(row.descriptorHash)) fail('INVENTORY_DESCRIPTOR_HASH_INVALID', 'inventory descriptor hash must be SHA-256');
    if (row.status !== 'INSTALLED_DISABLED') fail('INVENTORY_STATUS_INVALID', 'prestage inventory may project installed-disabled fixtures only');
    if (row.authorityClass !== 'NO_AUTHORITY') fail('INVENTORY_AUTHORITY_FORBIDDEN', 'inventory projection cannot carry authority');
    if (!Array.isArray(row.controls) || row.controls.length !== 0) fail('INVENTORY_CONTROLS_FORBIDDEN', 'prestage inventory cannot project controls');
    if (identities.has(row.extensionId)) fail('INVENTORY_DUPLICATE_IDENTITY', 'inventory projection contains a duplicate extension identity');
    identities.add(row.extensionId);
  }
  return true;
}

export function dockRecordFieldInventory() {
  return deepFreeze({
    ExtensionDescriptorV1: [...EXTENSION_DESCRIPTOR_V1_FIELDS],
    CanonicalAdapterMapV1: [...CANONICAL_ADAPTER_MAP_V1_FIELDS],
    ProviderFacetBindingV1: [...PROVIDER_FACET_BINDING_V1_FIELDS],
    ScenarioReferenceV1: [...SCENARIO_REFERENCE_V1_FIELDS],
    dockContractVersion: DOCK_CONTRACT_VERSION,
  });
}
