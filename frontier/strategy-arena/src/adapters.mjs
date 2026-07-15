import {
  adaptFixture,
  assertFixtureTransport,
  assertScenarioReferenceOperation,
  canonicalize,
  cloneCanonical,
  createCanonicalAdapterMap,
  deepFreeze,
  invokeFacet,
  routeAdvisoryOutput,
  sha256,
  validateCanonicalOwnerMap,
  validateFixtureOutput,
  validateModuleFacetMatrix,
  validateScenarioReference,
} from '../../dock/src/index.mjs';
import {
  ARENA_ADAPTER_HASHES,
  ARENA_LIMITS,
  DOCK_ARTIFACT_CANONICAL_HASHES,
  DOCK_CONTRACT_SHA,
  REQUIRED_DOCK_BINDING_HASHES,
  REQUIRED_DOCK_FACETS,
  SEALED_PRODUCT_SURFACE_CANONICAL_HASH,
  SEALED_SCENARIO_REFERENCE_CANONICAL_HASH,
} from './constants.mjs';
import {
  boundedString,
  compareCodeUnits,
  exactShape,
  fail,
  immutableGitRef,
  safeInteger,
  sha256Value,
} from './validation.mjs';

const Q15_EXPERIMENT_CARD_FIELDS = Object.freeze([
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

const SCENARIO_FIELDS = Object.freeze([
  'scenarioId',
  'scenarioVersion',
  'scenarioHash',
  'extensionProviderRef',
  'fixtureSchemaRef',
  'seed',
  'clockRef',
  'lineageRefs',
  'expectedCanonicalPostureRefs',
]);

const PRODUCT_SURFACE_FIELDS = Object.freeze([
  'surfaceId',
  'label',
  'bindingState',
  'truthLabel',
  'canonicalSource',
  'evaluatedAtMs',
  'summary',
  'blocker',
  'controlIds',
  'correlationId',
  'evidence',
]);

function identityMap({ adapterId, localFixtureSchema, canonicalOwner, canonicalContractId, canonicalContractVersion, fields, testVector, units = [] }) {
  return createCanonicalAdapterMap({
    adapterId,
    extensionId: 'frontier.strategy-arena',
    localFixtureSchema,
    canonicalOwner,
    canonicalContractId,
    canonicalContractVersion,
    fieldMap: fields.map((field) => ({ localPath: field, canonicalPath: field, transform: 'IDENTITY' })),
    unitMap: units.map((unit) => ({ localUnit: unit, canonicalUnit: unit, transform: 'IDENTITY' })),
    timeSemantics: { eventTime: 'PRESERVE_EXACT', receiveTime: 'PRESERVE_EXACT', clock: 'INJECTED_FIXTURE' },
    unknownPropagation: 'PRESERVE_EXACT_OR_FAIL_CLOSED',
    lossy: false,
    unsupportedFields: [],
    testVectors: [testVector],
  });
}

export function createArenaAdapterMaps() {
  const maps = {
    experimentProvider: identityMap({
      adapterId: 'frontier.strategy-arena.q15-experiment-card-reference.v1',
      localFixtureSchema: 'Q15ExperimentCardV1',
      canonicalOwner: 'git:6b18928c282f19128a033ed33910754cbdc2cbe0:quant/src/quant_edge/registry_ops/contracts.py#ExperimentCardV1',
      canonicalContractId: 'git:02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/src/quant_edge/registry_ops/contracts.py#ExperimentCardV1',
      canonicalContractVersion: 'Q15ExperimentCardV1@1',
      fields: Q15_EXPERIMENT_CARD_FIELDS,
      testVector: 'git:02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/generated/q15/registry_cards.v1.json#/experimentCard',
    }),
    scenarioReference: identityMap({
      adapterId: 'frontier.strategy-arena.scenario-reference.v1',
      localFixtureSchema: 'ScenarioReferenceV1',
      canonicalOwner: 'frontier/dock/contracts/v1/canonical-owner-map.json#/facets/6',
      canonicalContractId: 'frontier/dock/contracts/v1/dock-v1.schema.json#/$defs/ScenarioReferenceV1',
      canonicalContractVersion: 'ScenarioReferenceV1@1',
      fields: SCENARIO_FIELDS,
      testVector: 'frontier/dock/examples/scenario-reference.v1.json',
    }),
    cockpitProjection: identityMap({
      adapterId: 'frontier.strategy-arena.product-surface-projection.v1',
      localFixtureSchema: 'ProductSurfaceProjection',
      canonicalOwner: 'git:2c98ae653ba97e6383c29697283288346de28bdb:web/src/lib/productIntegration/model.ts',
      canonicalContractId: 'git:56c47dad398c485b6653036c8b90c53f11061b1e:web/src/lib/productIntegration/model.ts#ProductSurfaceProjection',
      canonicalContractVersion: 'product-supervisor.v1',
      fields: PRODUCT_SURFACE_FIELDS,
      testVector: 'frontier/strategy-arena/preview/product-surface-projection.v1.json',
      units: ['utc-millis'],
    }),
  };
  for (const [name, expectedHash] of Object.entries(ARENA_ADAPTER_HASHES)) {
    if (maps[name]?.adapterHash !== expectedHash) fail('ARENA_ADAPTER_HASH_DRIFT', `sealed adapter ${name} drifted from its pinned hash`);
  }
  return deepFreeze(maps);
}

function exactTopLevelFields(value, expected, code, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code, `${name} must be an object`);
  const actual = Object.keys(value).sort();
  const fields = [...expected].sort();
  if (actual.length !== fields.length || actual.some((field, index) => field !== fields[index])) fail(code, `${name} fields do not match the exact canonical contract`);
}

function snapshotCanonical(value, code, name) {
  try {
    return deepFreeze(cloneCanonical(value));
  } catch {
    fail(code, `${name} must be snapshot-safe canonical JSON`);
  }
}

export function adaptExperimentCard(card) {
  card = snapshotCanonical(card, 'ARENA_Q15_CARD_SHAPE_INVALID', 'Q15ExperimentCardV1');
  exactTopLevelFields(card, Q15_EXPERIMENT_CARD_FIELDS, 'ARENA_Q15_CARD_SHAPE_INVALID', 'Q15ExperimentCardV1');
  if (card.schema !== 'Q15ExperimentCardV1' || card.version !== 1 || card.posture !== 'SYNTHETIC_ONLY' || sha256(`${canonicalize(card)}\n`) !== '21d679bed82c95892c96a8f4513e3cd3d3f1a39e9992ee72c7f718db73eed68b') {
    fail('ARENA_Q15_CARD_IDENTITY_MISMATCH', 'only the exact accepted synthetic Q15 ExperimentCard fixture is valid at this prestage seam');
  }
  return adaptFixture(createArenaAdapterMaps().experimentProvider, card);
}

export function adaptScenarioReference(reference) {
  reference = snapshotCanonical(reference, 'ARENA_SCENARIO_IDENTITY_MISMATCH', 'ScenarioReferenceV1');
  validateScenarioReference(reference);
  if (sha256(reference) !== SEALED_SCENARIO_REFERENCE_CANONICAL_HASH) fail('ARENA_SCENARIO_IDENTITY_MISMATCH', 'only the exact sealed Dock scenario-reference exemplar is valid at this prestage seam');
  return adaptFixture(createArenaAdapterMaps().scenarioReference, reference);
}

export function adaptProductSurfaceProjection(projection) {
  projection = snapshotCanonical(projection, 'ARENA_PRODUCT_SURFACE_SHAPE_INVALID', 'ProductSurfaceProjection');
  exactTopLevelFields(projection, PRODUCT_SURFACE_FIELDS, 'ARENA_PRODUCT_SURFACE_SHAPE_INVALID', 'ProductSurfaceProjection');
  boundedString(projection.label, 'ProductSurfaceProjection.label', 256);
  boundedString(projection.summary, 'ProductSurfaceProjection.summary', 512);
  safeInteger(projection.evaluatedAtMs, 'ProductSurfaceProjection.evaluatedAtMs', 1);
  sha256Value(projection.correlationId, 'ProductSurfaceProjection.correlationId');
  if (projection.surfaceId !== 'control-room'
    || projection.label !== 'StrategyArena research comparison'
    || projection.bindingState !== 'DIRECTOR_MOUNT_REQUIRED'
    || projection.truthLabel !== 'SYNTHETIC_ONLY'
    || projection.canonicalSource !== 'frontier/strategy-arena/preview/tournament-scorecard.v1.json'
    || projection.blocker !== 'FRONTIER_PRESTAGE_UNMOUNTED'
    || !Array.isArray(projection.controlIds)
    || projection.controlIds.length !== 0
    || !Array.isArray(projection.evidence)
    || projection.evidence.length !== 6) {
    fail('ARENA_PRODUCT_SURFACE_AUTHORITY_WIDENING', 'prestage surface projection must remain synthetic, unmounted, and control-free');
  }
  const expectedEvidence = new Map([
    ['campaign-hash', { canonicalSource: 'frontier/strategy-arena/fixtures/tournament-campaign.v1.json#campaignHash', truthLabel: 'SYNTHETIC_ONLY', unavailableReason: null }],
    ['report-hash', { canonicalSource: 'frontier/strategy-arena/preview/tournament-scorecard.v1.json#reportHash', truthLabel: 'SYNTHETIC_ONLY', unavailableReason: null }],
    ['q-authority-hash', { canonicalSource: 'frontier/strategy-arena/fixtures/q-validation-authority.v1.json#qAuthorityHash', truthLabel: 'SYNTHETIC_ONLY', unavailableReason: null }],
    ['scorecard-hashes', { canonicalSource: 'frontier/strategy-arena/preview/tournament-scorecard.v1.json#scorecards', truthLabel: 'SYNTHETIC_ONLY', unavailableReason: null }],
    ['selection-pressure-state', { canonicalSource: 'frontier/strategy-arena/preview/tournament-scorecard.v1.json#strategyTrialEvidenceState', truthLabel: 'MISSING', unavailableReason: 'CAMPAIGN_BOUND_Q_SELECTION_BUNDLE_MISSING' }],
    ['final-holdout-state', { canonicalSource: 'frontier/strategy-arena/fixtures/q-validation-authority.v1.json#holdoutAccessState', truthLabel: 'MISSING', unavailableReason: 'NEW_Q_WHOLE_STRATEGY_GRANT_AND_REPLAY_BUNDLE_REQUIRED' }],
  ]);
  const seenFieldIds = new Set();
  for (const [index, datum] of projection.evidence.entries()) {
    exactTopLevelFields(datum, ['fieldId', 'label', 'value', 'truthLabel', 'canonicalSource', 'unavailableReason'], 'ARENA_PRODUCT_SURFACE_DATUM_INVALID', `ProductSurfaceDatum[${index}]`);
    const expected = expectedEvidence.get(datum.fieldId);
    if (typeof datum.fieldId !== 'string' || expected === undefined || seenFieldIds.has(datum.fieldId) || typeof datum.label !== 'string' || datum.label.length === 0 || typeof datum.value !== 'string' || datum.truthLabel !== expected.truthLabel || datum.canonicalSource !== expected.canonicalSource || datum.unavailableReason !== expected.unavailableReason) {
      fail('ARENA_PRODUCT_SURFACE_DATUM_INVALID', `ProductSurfaceDatum[${index}] violates the exact canonical value/unknown shape`);
    }
    seenFieldIds.add(datum.fieldId);
  }
  const reportHashDatum = projection.evidence.find((datum) => datum.fieldId === 'report-hash');
  if (reportHashDatum?.value !== projection.correlationId || !/^[a-f0-9]{64}$/.test(reportHashDatum.value)) fail('ARENA_PRODUCT_SURFACE_CORRELATION_MISMATCH', 'product surface correlation must equal its bound report evidence hash');
  if (sha256(projection) !== SEALED_PRODUCT_SURFACE_CANONICAL_HASH) fail('ARENA_PRODUCT_SURFACE_IDENTITY_MISMATCH', 'only the sealed StrategyArena product-surface fixture is accepted at this prestage seam');
  return adaptFixture(createArenaAdapterMaps().cockpitProjection, projection);
}

export function validateScenarioReferences(references) {
  references = snapshotCanonical(references, 'ARENA_SCENARIO_SET_EMPTY', 'scenario reference set');
  if (!Array.isArray(references) || references.length === 0 || references.length > ARENA_LIMITS.maxEvents) fail('ARENA_SCENARIO_SET_EMPTY', 'scenario reference set must be bounded and non-empty');
  const hashes = new Set();
  for (const reference of references) {
    validateScenarioReference(reference);
    if (sha256(reference) !== SEALED_SCENARIO_REFERENCE_CANONICAL_HASH) fail('ARENA_SCENARIO_IDENTITY_MISMATCH', 'prestage scenario set may contain only the exact sealed Dock exemplar');
    const proof = assertScenarioReferenceOperation(reference, 'VALIDATE_FIXTURE');
    if (proof.executed || proof.canonicalTruthMutated) fail('ARENA_SCENARIO_EFFECT_FORBIDDEN', 'scenario validation cannot execute or mutate truth');
    if (hashes.has(reference.scenarioHash)) fail('ARENA_SCENARIO_DUPLICATE', 'scenario references must be unique');
    hashes.add(reference.scenarioHash);
  }
  return deepFreeze({ scenarioHashes: [...hashes].sort(), executed: false, canonicalTruthMutated: false, authorityClass: 'NO_AUTHORITY' });
}

export function validateOwnerReferenceSet(references, resolver) {
  if (typeof resolver !== 'function') fail('ARENA_OWNER_RESOLVER_REQUIRED', 'a bounded immutable owner-reference set requires an injected read-only resolver');
  const frozenReferences = snapshotCanonical(references, 'ARENA_OWNER_RESOLVER_REQUIRED', 'owner reference set');
  if (!Array.isArray(frozenReferences) || frozenReferences.length === 0 || frozenReferences.length > ARENA_LIMITS.maxReferences) fail('ARENA_OWNER_RESOLVER_REQUIRED', 'a bounded immutable owner-reference set requires an injected read-only resolver');
  const referenceIds = new Set();
  for (const [index, reference] of frozenReferences.entries()) {
    immutableGitRef(reference, `OwnerReferenceSet[${index}]`);
    if (referenceIds.has(reference.ref)) fail('ARENA_OWNER_REFERENCE_DUPLICATE', `owner reference set contains duplicate identity ${reference.ref}`);
    referenceIds.add(reference.ref);
  }
  const attestations = [];
  for (const reference of frozenReferences) {
    const candidate = resolver(reference);
    let resolved;
    try {
      resolved = candidate === null || typeof candidate !== 'object' ? candidate : {
        gitObjectSha: candidate.gitObjectSha,
        contentSha256: candidate.contentSha256,
        projectionSha256: candidate.projectionSha256,
      };
      if (resolved !== null && typeof resolved === 'object' && reference.projectionSha256 !== null) {
        const projectionValue = candidate.projectionValue;
        if (projectionValue === undefined) throw new TypeError('projectionValue missing');
        resolved.projectionValue = cloneCanonical(projectionValue);
      }
      if (resolved !== null && typeof resolved === 'object') resolved = deepFreeze(resolved);
    } catch {
      fail('ARENA_OWNER_REFERENCE_MISMATCH', `immutable owner reference returned an unsnapshotable result: ${reference.ref}`);
    }
    if (resolved === null || typeof resolved !== 'object'
      || resolved.gitObjectSha !== reference.gitObjectSha
      || resolved.contentSha256 !== reference.contentSha256
      || resolved.projectionSha256 !== reference.projectionSha256) {
      fail('ARENA_OWNER_REFERENCE_MISMATCH', `immutable owner reference did not resolve exactly: ${reference.ref}`);
    }
    if (reference.projectionSha256 !== null) {
      if (resolved.projectionValue === undefined || sha256(`${canonicalize(resolved.projectionValue)}\n`) !== reference.projectionSha256) {
        fail('ARENA_OWNER_PROJECTION_DIGEST_MISMATCH', `owner projection bytes do not match their pinned digest: ${reference.ref}`);
      }
    }
    attestations.push({
      ref: reference.ref,
      gitObjectSha: resolved.gitObjectSha,
      contentSha256: resolved.contentSha256,
      projectionSha256: resolved.projectionSha256,
      referenceHash: sha256(reference),
    });
  }
  const sortedAttestations = attestations.sort((left, right) => compareCodeUnits(left.ref, right.ref));
  return deepFreeze({
    referenceShapeValidated: true,
    sourceBytesIndependentlyVerified: false,
    resolverPosture: 'CALLER_SUPPLIED_PINNED_IDENTITY_ATTESTATION',
    attestationHash: sha256(sortedAttestations),
    attestations: sortedAttestations,
  });
}

export function validateArenaDockRelease({ ownerMap, moduleFacetMatrix, dockSha }) {
  if (dockSha !== DOCK_CONTRACT_SHA) fail('ARENA_DOCK_SHA_MISMATCH', 'StrategyArena must pin the exact sealed F0 Dock commit');
  let boundOwnerMap;
  let boundModuleFacetMatrix;
  try {
    boundOwnerMap = deepFreeze(cloneCanonical(ownerMap));
    boundModuleFacetMatrix = deepFreeze(cloneCanonical(moduleFacetMatrix));
  } catch {
    fail('ARENA_DOCK_ARTIFACT_HASH_MISMATCH', 'Dock artifacts must be snapshot-safe canonical JSON');
  }
  if (sha256(boundOwnerMap) !== DOCK_ARTIFACT_CANONICAL_HASHES.ownerMap || sha256(boundModuleFacetMatrix) !== DOCK_ARTIFACT_CANONICAL_HASHES.moduleFacetMatrix) fail('ARENA_DOCK_ARTIFACT_HASH_MISMATCH', 'Dock artifacts do not match their sealed canonical identities');
  validateCanonicalOwnerMap(boundOwnerMap);
  validateModuleFacetMatrix(boundModuleFacetMatrix);
  const row = boundModuleFacetMatrix.modules.find((module) => module.moduleId === 'F3');
  if (!row || row.requiredUsableFacets.length !== REQUIRED_DOCK_FACETS.length || row.requiredUsableFacets.some((facet, index) => facet !== REQUIRED_DOCK_FACETS[index])) {
    fail('ARENA_DOCK_FACET_SET_MISMATCH', 'F3 facet dependencies do not match the frozen Dock matrix');
  }
  const bindings = REQUIRED_DOCK_FACETS.map((facetClass) => boundOwnerMap.facets.find((binding) => binding.facetClass === facetClass));
  if (bindings.some((binding) => !binding || binding.bindingStatus !== 'USABLE')) fail('ARENA_DOCK_FACET_BLOCKED', 'every F3 Dock facet must be usable');
  if (bindings.some((binding) => binding.bindingHash !== REQUIRED_DOCK_BINDING_HASHES[binding.facetClass])) fail('ARENA_DOCK_BINDING_HASH_MISMATCH', 'F3 Dock binding differs from the sealed release');
  return deepFreeze({ dockSha, requiredFacets: [...REQUIRED_DOCK_FACETS], bindingHashes: bindings.map((binding) => binding.bindingHash) });
}

export function invokeArenaFacet({ binding, request, handler }) {
  binding = snapshotCanonical(binding, 'ARENA_DOCK_BINDING_HASH_MISMATCH', 'facet binding');
  request = snapshotCanonical(request, 'FACET_REQUEST_BOUNDARY_INVALID', 'facet request');
  if (!REQUIRED_DOCK_FACETS.includes(binding?.facetClass)) fail('ARENA_DOCK_FACET_FORBIDDEN', 'StrategyArena may invoke only its three released Dock facets');
  if (binding.bindingHash !== REQUIRED_DOCK_BINDING_HASHES[binding.facetClass]) fail('ARENA_DOCK_BINDING_HASH_MISMATCH', 'facet invocation must use the exact sealed F0 binding');
  const output = invokeFacet({ binding, requestFacetClass: request?.facetClass, operation: request?.operation, request, handler });
  validateFixtureOutput(output);
  return output;
}

export function createFixtureRuntime(transport = { networkMode: 'FIXTURE_ONLY', open: false }) {
  assertFixtureTransport(transport);
  return deepFreeze({ transport: { networkMode: 'FIXTURE_ONLY', open: false }, mounted: false, mutationEnabled: false, authorityClass: 'NO_AUTHORITY' });
}

export function routeArenaAdvisory(report, destinationClass) {
  const boundReport = snapshotCanonical(report, 'ADVISORY_CLASS_REQUIRED', 'advisory report');
  return routeAdvisoryOutput(boundReport, destinationClass);
}
