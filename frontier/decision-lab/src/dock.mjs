import {
  adaptFixture,
  cloneCanonical,
  contractError,
  createCanonicalAdapterMap,
  createExtensionDescriptor,
  deepFreeze,
  invokeFacet,
  projectModuleInventory,
  registerExtension,
  reverseFixture,
  sha256,
  validateCanonicalOwnerMap,
  validateInsertionRequest,
  validateModuleFacetMatrix,
  validatePortRequest,
} from '../../dock/src/index.mjs';
import { validateDecisionLabPreview } from './preview.mjs';
import { assertBoundedStructure } from './bounds.mjs';

const F13_BINDING_HASHES = Object.freeze({
  EXPERIMENT_PROVIDER: '1a28f00b6e2f9e042beb3923271caf2b0f376233fa7092e725ad07d15503a698',
  COCKPIT_PROJECTION: '588e54eb6cafc8ca0114e3f11eac55801fc4b4957d1f6a32bfb797f9754ffa00',
});

const Q15_ADAPTER_HASH = '4d0d4ed05eb710e7c99ed290fbf682a9d5a0754a38cd08fdf83219ae23db44a4';
const Q15_MAX_ITEMS = 128;
const Q15_MAX_TEXT_LENGTH = 4_096;
const Q15_CONTRACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$/;
const Q15_MAX_SEED = 9_223_372_036_854_775_807n;

const Q15_FIELDS = Object.freeze([
  'artifactIds',
  'attemptedTrialIds',
  'cardId',
  'codeCommit',
  'datasetManifestIds',
  'decision',
  'dependencyLockSha256',
  'experimentId',
  'featureVersions',
  'hypothesisId',
  'labelVersions',
  'latencyResourceBenchmark',
  'metricsAndIntervals',
  'modelCardIds',
  'parameters',
  'posture',
  'revision',
  'schema',
  'seed',
  'splitFoldIds',
  'version',
]);

function fail(code, message) {
  throw contractError(code, message);
}

function boundedText(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > Q15_MAX_TEXT_LENGTH) {
    fail('Q15_TEXT_INVALID', `${name} must be bounded non-empty text`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('Q15_UNICODE_INVALID', `${name} contains a lone high surrogate`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail('Q15_UNICODE_INVALID', `${name} contains a lone low surrogate`);
    }
  }
  return value;
}

function compareCodePoints(left, right) {
  const leftPoints = [...left].map((value) => value.codePointAt(0));
  const rightPoints = [...right].map((value) => value.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] < rightPoints[index] ? -1 : 1;
  }
  return leftPoints.length === rightPoints.length ? 0 : leftPoints.length < rightPoints.length ? -1 : 1;
}

function contractId(value, name) {
  if (typeof value !== 'string' || !Q15_CONTRACT_ID_PATTERN.test(value)) {
    fail('Q15_CONTRACT_ID_INVALID', `${name} must match the accepted Q contract-ID grammar`);
  }
  return value;
}

function arrayOfStrings(value, name, { sortedUnique = false } = {}) {
  if (!Array.isArray(value) || value.length === 0 || value.length > Q15_MAX_ITEMS) {
    fail('Q15_ARRAY_INVALID', `${name} must be a non-empty string array of at most ${Q15_MAX_ITEMS} items`);
  }
  value.forEach((entry, index) => boundedText(entry, `${name}[${index}]`));
  if (sortedUnique && (new Set(value).size !== value.length || value.some((entry, index) => index > 0 && compareCodePoints(value[index - 1], entry) >= 0))) {
    fail('Q15_ARRAY_ORDER_INVALID', `${name} must be sorted and unique`);
  }
}

function validateQ15Shape(fixture) {
  if (fixture === null || typeof fixture !== 'object' || Array.isArray(fixture)) fail('Q15_RECORD_REQUIRED', 'Q15 experiment fixture must be an object');
  const missing = Q15_FIELDS.filter((field) => !Object.hasOwn(fixture, field));
  const unknown = Object.keys(fixture).filter((field) => !Q15_FIELDS.includes(field));
  if (missing.length > 0 || unknown.length > 0) fail('Q15_FIELDS_INVALID', `Q15 experiment fixture field mismatch: missing=${missing.join(',')} unknown=${unknown.join(',')}`);
  if (fixture.schema !== 'Q15ExperimentCardV1' || fixture.version !== 1) fail('Q15_VERSION_INVALID', 'Q15 experiment fixture must preserve Q15ExperimentCardV1@1');
  if (!/^[a-f0-9]{40}$/.test(fixture.codeCommit)) fail('Q15_COMMIT_INVALID', 'Q15 codeCommit must be a full Git SHA');
  if (!/^[a-f0-9]{64}$/.test(fixture.dependencyLockSha256)) fail('Q15_LOCK_HASH_INVALID', 'Q15 dependency lock identity must be SHA-256');
  if (typeof fixture.seed !== 'string' || fixture.seed.length > 19 || !/^(?:0|[1-9]\d*)$/.test(fixture.seed) || BigInt(fixture.seed) > Q15_MAX_SEED) {
    fail('Q15_SEED_INVALID', 'Q15 serialized seed must remain a non-negative signed-INT64 integer string');
  }
  for (const field of [
    'artifactIds',
    'attemptedTrialIds',
    'datasetManifestIds',
    'featureVersions',
    'labelVersions',
    'latencyResourceBenchmark',
    'metricsAndIntervals',
    'modelCardIds',
    'splitFoldIds',
  ]) arrayOfStrings(fixture[field], `Q15.${field}`, { sortedUnique: ['artifactIds', 'modelCardIds'].includes(field) });
  for (const field of ['cardId', 'experimentId', 'hypothesisId', 'revision']) contractId(fixture[field], `Q15.${field}`);
  for (const field of ['decision', 'posture']) boundedText(fixture[field], `Q15.${field}`);
  if (!['SYNTHETIC_ONLY', 'REPLAY', 'RESEARCH_ONLY', 'DATA_INSUFFICIENT'].includes(fixture.posture)) {
    fail('Q15_POSTURE_INVALID', 'Q15.posture must preserve the accepted EvidencePosture enum');
  }
  if (fixture.parameters === null || typeof fixture.parameters !== 'object' || Array.isArray(fixture.parameters)
    || Object.keys(fixture.parameters).length > Q15_MAX_ITEMS
    || Object.entries(fixture.parameters).some(([key, value]) => {
      try {
        contractId(key, 'Q15.parameters key');
        boundedText(value, `Q15.parameters.${key}`);
        return false;
      } catch {
        return true;
      }
    })
    || Object.keys(fixture.parameters).some((key, index, keys) => index > 0 && keys[index - 1] > key)) {
    fail('Q15_PARAMETERS_INVALID', 'Q15.parameters must be a string map');
  }
  return true;
}

export function selectF13DockBindings(ownerMap, moduleFacetMatrix) {
  validateCanonicalOwnerMap(ownerMap);
  validateModuleFacetMatrix(moduleFacetMatrix);
  const row = moduleFacetMatrix.modules.find((entry) => entry.moduleId === 'F13');
  if (!row || row.requiredUsableFacets.join(',') !== 'EXPERIMENT_PROVIDER,COCKPIT_PROJECTION') {
    fail('F13_FACET_SET_INVALID', 'F13 must use exactly EXPERIMENT_PROVIDER and COCKPIT_PROJECTION');
  }
  const bindings = Object.fromEntries(row.requiredUsableFacets.map((facetClass) => {
    const binding = ownerMap.facets.find((entry) => entry.facetClass === facetClass);
    if (!binding || binding.bindingStatus !== 'USABLE' || binding.bindingHash !== F13_BINDING_HASHES[facetClass]) {
      fail('F13_FACET_BINDING_INVALID', `${facetClass} is not the frozen usable Dock binding`);
    }
    return [facetClass, binding];
  }));
  return deepFreeze(cloneCanonical(bindings));
}

export function createQ15ExperimentAdapterMap(input) {
  return createCanonicalAdapterMap(input);
}

export function validateQ15ExperimentFixture({ fixture, adapterMap, bindings }) {
  assertBoundedStructure(fixture, 'Q15ExperimentCardV1');
  assertBoundedStructure(adapterMap, 'CanonicalAdapterMapV1');
  assertBoundedStructure(bindings, 'F13DockBindings');
  if (
    adapterMap?.adapterHash !== Q15_ADAPTER_HASH
    || adapterMap.canonicalOwner !== 'git:6b18928c282f19128a033ed33910754cbdc2cbe0:quant/src/quant_edge/registry_ops/**'
    || adapterMap.canonicalContractId !== 'Q15ExperimentCardV1'
    || adapterMap.canonicalContractVersion !== 'Q15ExperimentCardV1@1'
    || adapterMap.extensionId !== 'frontier.decision-lab'
    || adapterMap.localFixtureSchema !== 'Q15ExperimentCardV1'
    || adapterMap.lossy !== false
    || adapterMap.unknownPropagation !== 'PRESERVE_EXACT_OR_FAIL_CLOSED'
  ) fail('Q15_ADAPTER_NOT_PINNED', 'DecisionLab must use the exact committed lossless Q15 adapter map');
  const snapshot = cloneCanonical(fixture);
  validateQ15Shape(snapshot);
  const preview = adaptFixture(adapterMap, snapshot);
  const reversed = reverseFixture(preview);
  if (sha256(reversed) !== sha256(snapshot)) fail('Q15_ADAPTER_ROUNDTRIP_FAILED', 'Q15 fixture adapter is not lossless');
  return invokeFacet({
    binding: bindings.EXPERIMENT_PROVIDER,
    requestFacetClass: 'EXPERIMENT_PROVIDER',
    operation: 'VALIDATE_FIXTURE',
    request: {
      facetClass: 'EXPERIMENT_PROVIDER',
      operation: 'VALIDATE_FIXTURE',
      networkMode: 'FIXTURE_ONLY',
      authorityClass: 'NO_AUTHORITY',
      fixture: snapshot,
    },
    handler: () => deepFreeze({
      schema: 'DecisionLabExperimentFixtureValidationV1',
      version: 1,
      truthClass: 'FIXTURE_VALIDATION',
      networkMode: 'FIXTURE_ONLY',
      authorityClass: 'NO_AUTHORITY',
      canonical: false,
      valid: true,
      experimentCardRef: deepFreeze({
        cardId: snapshot.cardId,
        revision: snapshot.revision,
        contractId: snapshot.schema,
        contractVersion: 'Q15ExperimentCardV1@1',
        fixtureHash: sha256(snapshot),
      }),
      adapterPreviewHash: sha256(preview),
      registryWritePerformed: false,
      treatmentAssigned: false,
      promotionPerformed: false,
    }),
  });
}

export function projectPreviewThroughDock(preview, bindings, sourceReport, sourceRequest) {
  validateDecisionLabPreview(preview, sourceReport, sourceRequest);
  const snapshot = cloneCanonical(preview);
  const projected = invokeFacet({
    binding: bindings.COCKPIT_PROJECTION,
    requestFacetClass: 'COCKPIT_PROJECTION',
    operation: 'PROJECT_FIXTURE',
    request: {
      facetClass: 'COCKPIT_PROJECTION',
      operation: 'PROJECT_FIXTURE',
      networkMode: 'FIXTURE_ONLY',
      authorityClass: 'NO_AUTHORITY',
      fixture: snapshot,
    },
    handler: (request) => deepFreeze({
      ...request.fixture,
      truthClass: 'FIXTURE_PROJECTION',
      networkMode: 'FIXTURE_ONLY',
      authorityClass: 'NO_AUTHORITY',
      canonical: false,
      mounted: false,
      controls: Object.freeze([]),
      canonicalSurfaceId: null,
      bindingState: 'DIRECTOR_MOUNT_REQUIRED',
    }),
  });
  validateDecisionLabPreview(projected, sourceReport, sourceRequest);
  return projected;
}

export function createDecisionLabDescriptor(input) {
  return createExtensionDescriptor(input);
}

export function projectDecisionLabInventory(descriptor, generatedAtMs) {
  return projectModuleInventory(registerExtension([], descriptor), generatedAtMs);
}

export function validateDecisionLabInsertion(request, exactSeams) {
  validateInsertionRequest(request, exactSeams);
  validatePortRequest(request, exactSeams);
  return true;
}
