import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign as signBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  FACET_CLASSES,
  FixtureSandbox,
  adaptFixture,
  assertFixtureTransport,
  assertScenarioReferenceOperation,
  canonicalize,
  createCanonicalAdapterMap,
  createExtensionAttestation,
  createExtensionDescriptor,
  createProviderFacetBinding,
  createScenarioReference,
  descriptorHashFor,
  disableExtension,
  dockRecordFieldInventory,
  evaluateFixturePolicy,
  inventoryEquivalent,
  invokeFacet,
  negotiateContractVersion,
  parseSemver,
  parseExtensionDescriptor,
  registerExtension,
  removalRequest,
  resourceClaimProjection,
  reverseFixture,
  rollbackRequest,
  routeAdvisoryOutput,
  runFixtureLoad,
  uninstallRequest,
  validateCanonicalAdapterMap,
  validateCanonicalOwnerMap,
  validateCanonicalSharedOwnerReferenceMap,
  validateFixtureOutput,
  validateInsertionRequest,
  validateModuleFacetMatrix,
  validateModuleInventoryProjection,
  validatePortRequest,
  validateResourceBudgetClaim,
  validateScenarioReference,
  verifyExtensionAttestation,
} from '../src/index.mjs';

const dockRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = (relativePath) => JSON.parse(readFileSync(join(dockRoot, relativePath), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const without = (record, ...fields) => Object.fromEntries(Object.entries(record).filter(([key]) => !fields.includes(key)));
const descriptor = readJson('examples/extension-descriptor.v1.json');
const adapterMap = readJson('examples/canonical-adapter-map.v1.json');
const scenarioReference = readJson('examples/scenario-reference.v1.json');
const semanticFixture = readJson('fixtures/semantic-roundtrip.v1.json');
const resourceBudgetClaim = readJson('fixtures/resource-budget-claim.v1.json');
const insertionRequest = readJson('fixtures/insertion-request.v1.json');
const ownerMap = readJson('contracts/v1/canonical-owner-map.json');
const sharedOwnerReferences = readJson('contracts/v1/canonical-shared-owner-references.json');
const moduleFacetMatrix = readJson('contracts/v1/module-facet-matrix.json');
const contractSchema = readJson('contracts/v1/dock-v1.schema.json');
const compatibilityMatrix = readJson('contracts/v1/compatibility-matrix.json');
const adapterRules = readJson('contracts/v1/adapter-rules.json');

function assertCode(action, code) {
  assert.throws(action, (error) => {
    assert.equal(error?.code, code, `expected ${code}, received ${error?.code}: ${error?.message}`);
    return true;
  });
}

function fixtureOutput(truthClass = 'FIXTURE_VALIDATION') {
  return {
    truthClass,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    canonical: false,
    result: 'FIXTURE_ONLY',
  };
}

function fixtureKey(seedByte) {
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  return createPrivateKey({
    key: Buffer.concat([prefix, Buffer.alloc(32, seedByte)]),
    format: 'der',
    type: 'pkcs8',
  });
}

function compliantLatencySamples(count) {
  const p50 = Math.ceil(count * 0.50);
  const p95 = Math.ceil(count * 0.95);
  const p99 = Math.ceil(count * 0.99);
  return [
    ...Array(p50).fill(3),
    ...Array(p95 - p50).fill(7),
    ...Array(p99 - p95).fill(11),
    ...Array(count - p99).fill(12),
  ];
}

test('01 unsupported major contract version fails closed', () => {
  assertCode(() => negotiateContractVersion('2.0.0', '1.0.0'), 'UNSUPPORTED_MAJOR_VERSION');
  assertCode(() => createExtensionDescriptor({
    ...without(descriptor, 'descriptorHash'),
    dockContractVersion: '9.0.0',
  }), 'UNSUPPORTED_MAJOR_VERSION');
  assert.equal(negotiateContractVersion('1.1.0', '1.0.0').mode, 'FORWARD_COMPATIBLE');
});

test('02 unknown fields preserve forward compatibility without changing known semantics', () => {
  const withFutureField = createExtensionDescriptor({
    ...without(descriptor, 'descriptorHash'),
    futureCompatibleField: { opaque: ['preserve', 1] },
  });
  const parsed = parseExtensionDescriptor(withFutureField);
  assert.deepEqual(parsed.futureCompatibleField, { opaque: ['preserve', 1] });
  for (const [field, value] of Object.entries(descriptor)) {
    if (field !== 'descriptorHash') assert.deepEqual(parsed[field], value);
  }
});

test('03 missing required fields fail validation', () => {
  const missing = clone(descriptor);
  delete missing.authorityClass;
  assertCode(() => parseExtensionDescriptor(missing), 'REQUIRED_FIELD_MISSING');
});

test('04 undeclared egress and capability requests are rejected', () => {
  const canonicalPolicy = { approvedCapabilities: ['DESCRIBE', 'VALIDATE_FIXTURE'], approvedEgress: 'NONE' };
  assertCode(() => evaluateFixturePolicy({
    descriptor,
    request: { capabilities: ['LIVE_SUBSCRIBE'], egress: 'NONE', networkMode: 'FIXTURE_ONLY' },
    canonicalPolicy,
  }), 'UNDECLARED_CAPABILITY_REQUEST');
  assertCode(() => evaluateFixturePolicy({
    descriptor,
    request: { capabilities: ['DESCRIBE'], egress: 'INTERNET', networkMode: 'FIXTURE_ONLY' },
    canonicalPolicy,
  }), 'UNDECLARED_EGRESS_REQUEST');
});

test('05 a descriptor cannot grant itself authority', () => {
  assertCode(() => createExtensionDescriptor({
    ...without(descriptor, 'descriptorHash'),
    authorityClass: 'PRODUCT_AUTHORITY',
  }), 'SELF_GRANTED_AUTHORITY');
});

test('06 canonical serialization is deterministic and excludes attestation fields', () => {
  assert.equal(canonicalize({ z: 1, a: { y: 2, b: 3 } }), canonicalize({ a: { b: 3, y: 2 }, z: 1 }));
  assert.equal(canonicalize(-0), '0');
  const decorated = {
    ...descriptor,
    signature: 'external-signature',
    signerKeyId: 'fixture-key',
    attestationHash: 'f'.repeat(64),
    attestation: { external: true },
  };
  assert.equal(descriptorHashFor(decorated), descriptor.descriptorHash);
  assertCode(() => createExtensionDescriptor({
    ...without(descriptor, 'descriptorHash'),
    signature: 'must-remain-external',
  }), 'ATTESTATION_EMBEDDED');
  assertCode(() => parseExtensionDescriptor(decorated), 'ATTESTATION_EMBEDDED');
});

test('07 tampering, wrong signer, expiry, and revocation fail attestation validation', () => {
  const privateKey = fixtureKey(7);
  const wrongPrivateKey = fixtureKey(8);
  const publicKey = createPublicKey(privateKey);
  const wrongPublicKey = createPublicKey(wrongPrivateKey);
  const attestation = createExtensionAttestation({
    descriptor,
    signerKeyId: 'fixture-key-7',
    trustPolicyRef: 'fixture-policy-v1',
    issuedAt: 1_000,
    expiresAt: 2_000,
    revocationRef: 'fixture-revocation-7',
    sign: (bytes) => signBytes(null, bytes, privateKey),
  });
  const basePolicy = {
    policyRef: 'fixture-policy-v1',
    permittedAlgorithms: ['ED25519'],
    keys: { 'fixture-key-7': publicKey },
    revokedKeyIds: [],
    revokedRefs: [],
  };
  assert.equal(verifyExtensionAttestation({ descriptor, attestation, trustPolicy: basePolicy, nowMs: 1_500 }).ok, true);
  assertCode(() => verifyExtensionAttestation({
    descriptor: { ...descriptor, purpose: 'tampered' }, attestation, trustPolicy: basePolicy, nowMs: 1_500,
  }), 'DESCRIPTOR_HASH_MISMATCH');
  assertCode(() => verifyExtensionAttestation({
    descriptor, attestation, trustPolicy: { ...basePolicy, keys: { 'fixture-key-7': wrongPublicKey } }, nowMs: 1_500,
  }), 'SIGNATURE_INVALID');
  assertCode(() => verifyExtensionAttestation({ descriptor, attestation, trustPolicy: basePolicy, nowMs: 2_000 }), 'ATTESTATION_EXPIRED');
  assertCode(() => verifyExtensionAttestation({
    descriptor, attestation, trustPolicy: { ...basePolicy, revokedRefs: ['fixture-revocation-7'] }, nowMs: 1_500,
  }), 'ATTESTATION_REVOKED');
});

test('08 canonical truth meanings survive lossless adapter round-trips', () => {
  const preview = adaptFixture(adapterMap, semanticFixture);
  assert.deepEqual(reverseFixture(preview), semanticFixture);
  assert.deepEqual(preview.mappedFields.truth.identityStates, ['DISCOVERED', 'MISSING', 'UNKNOWN']);
  assert.deepEqual(preview.mappedFields.truth.telemetryStates, ['INSTRUMENTED', 'UNINSTRUMENTED', 'UNKNOWN']);
  assert.deepEqual(preview.mappedFields.truth.freshnessStates, ['CURRENT', 'STALE', 'SILENT', 'UNAVAILABLE', 'UNKNOWN']);
  assert.deepEqual(preview.mappedFields.truth.coherenceStates, ['COHERENT', 'INCOHERENT', 'UNKNOWN']);
  assert.deepEqual(adapterRules.canonicalStateAxes.freshnessState, ['CURRENT', 'STALE', 'SILENT', 'UNAVAILABLE', 'UNKNOWN']);
  assert.deepEqual(preview.mappedFields.truth.provenance, semanticFixture.truth.provenance);
  assert.deepEqual(preview.mappedFields.truth.uncertainty, semanticFixture.truth.uncertainty);
  assert.deepEqual(preview.mappedFields.truth.sequence, semanticFixture.truth.sequence);
  const incomplete = createCanonicalAdapterMap({
    ...without(adapterMap, 'adapterHash'),
    fieldMap: adapterMap.fieldMap.filter((row) => row.localPath !== 'truth.sequence'),
  });
  assertCode(() => adaptFixture(incomplete, semanticFixture), 'ADAPTER_FIELD_COVERAGE_INCOMPLETE');
  assertCode(() => createCanonicalAdapterMap({
    ...without(adapterMap, 'adapterHash'),
    unitMap: [{ localUnit: 'seconds', canonicalUnit: 'milliseconds', transform: 'IDENTITY' }],
  }), 'IDENTITY_UNIT_MISMATCH');
  assertCode(() => createCanonicalAdapterMap({
    ...without(adapterMap, 'adapterHash'),
    unitMap: [
      { localUnit: 'milliseconds', canonicalUnit: 'milliseconds', transform: 'IDENTITY' },
      { localUnit: 'milliseconds', canonicalUnit: 'milliseconds', transform: 'IDENTITY' },
    ],
  }), 'ADAPTER_UNIT_DUPLICATE');
});

test('09 missing expected inventory cannot disappear during adaptation', () => {
  const preview = adaptFixture(adapterMap, semanticFixture);
  assert.deepEqual(preview.mappedFields.truth.expectedInventory, semanticFixture.truth.expectedInventory);
  assert.deepEqual(preview.mappedFields.truth.expectedInventory.missingIds, ['source.c', 'source.d']);
});

test('10 resource exhaustion requests degradation without forged canonical state', () => {
  const result = runFixtureLoad({
    resourceBudgetClaim,
    maxSafeRateClaim: descriptor.maxSafeRateClaim,
    windowSizeMs: 1_000,
    offeredEvents: 101,
    peakQueueDepth: 16,
    latencySamples: compliantLatencySamples(101),
    storageBytesPerEvent: 32,
    networkBytes: 0,
    modelCalls: 0,
  });
  assert.equal(result.state, 'DEGRADATION_REQUESTED');
  assert.equal(result.canonicalState, null);
  assert.equal(result.forgedGreen, false);
  assert.equal(result.degradationRequest.authorityGranted, false);
});

test('11 simulated module failure cannot write outside its fixture sandbox', () => {
  const sandbox = new FixtureSandbox('fixture://frontier.example-fixture/');
  sandbox.write('fixture://frontier.example-fixture/local.json', { safe: true });
  assert.throws(() => {
    sandbox.write('fixture://frontier.example-fixture/before-crash.json', { phase: 'before-crash' });
    throw new Error('simulated module crash');
  }, /simulated module crash/);
  assertCode(() => sandbox.write('file:///tmp/escape.json', { unsafe: true }), 'SANDBOX_ESCAPE_BLOCKED');
  assert.deepEqual(Object.keys(sandbox.snapshot()), [
    'fixture://frontier.example-fixture/before-crash.json',
    'fixture://frontier.example-fixture/local.json',
  ]);

  const sourceRoot = join(dockRoot, 'src');
  const sources = readdirSync(sourceRoot).filter((name) => name.endsWith('.mjs')).map((name) => readFileSync(join(sourceRoot, name), 'utf8'));
  const imports = sources.flatMap((source) => [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map((match) => match[1]));
  assert.equal(imports.every((specifier) => specifier.startsWith('./') || specifier === 'node:crypto'), true);
  assert.equal(sources.some((source) => /node:(?:fs|http|https|net|tls|child_process)|\bfetch\s*\(|process\.env|Math\.random|setInterval\s*\(/.test(source)), false);
});

test('12 duplicate module identity is rejected', () => {
  const once = registerExtension([], descriptor);
  assertCode(() => registerExtension(once, descriptor), 'DUPLICATE_EXTENSION_IDENTITY');
});

test('13 record hash mismatch is rejected', () => {
  assertCode(() => validateCanonicalAdapterMap({ ...adapterMap, adapterHash: '0'.repeat(64) }), 'ADAPTER_HASH_MISMATCH');
});

test('14 simulated disable is idempotent', () => {
  const inventory = registerExtension([], descriptor);
  const once = disableExtension(inventory, descriptor.extensionId);
  const twice = disableExtension(once, descriptor.extensionId);
  assert.equal(inventoryEquivalent(once, twice), true);
});

test('15 rollback fixtures require the exact pinned version', () => {
  assert.equal(rollbackRequest(descriptor, '0.1.0').pinnedVersion, '0.1.0');
  assertCode(() => rollbackRequest(descriptor, '0.1.1'), 'ROLLBACK_VERSION_NOT_PINNED');
});

test('16 uninstall fixtures never claim canonical-evidence deletion authority', () => {
  const request = uninstallRequest(descriptor);
  assert.equal(request.deleteCanonicalEvidence, false);
  assert.equal(request.canonicalOwnerRequired, true);
  assert.equal(request.mutationPerformed, false);
});

test('17 module output cannot masquerade as canonical exchange or account truth', () => {
  assertCode(() => validateFixtureOutput({
    ...fixtureOutput('FIXTURE_VALIDATION'), truthClass: 'CANONICAL_EXCHANGE_TRUTH',
  }), 'CANONICAL_TRUTH_MASQUERADE');
  assertCode(() => validateFixtureOutput({
    ...fixtureOutput('FIXTURE_VALIDATION'), truthClass: 'CANONICAL_ACCOUNT_TRUTH',
  }), 'CANONICAL_TRUTH_MASQUERADE');
});

test('18 advisory output cannot reach deterministic effect interfaces', () => {
  assertCode(() => routeAdvisoryOutput(fixtureOutput('ADVISORY'), 'ORDER_EFFECT'), 'ADVISORY_EFFECT_FORBIDDEN');
  assertCode(() => routeAdvisoryOutput(fixtureOutput('ADVISORY'), 'EXECUTE_ORDER'), 'ADVISORY_EFFECT_FORBIDDEN');
  assert.equal(routeAdvisoryOutput(fixtureOutput('ADVISORY'), 'READ_ONLY_PREVIEW').effectAllowed, false);
});

test('19 fixture mode cannot silently become network mode', () => {
  assert.equal(assertFixtureTransport({ networkMode: 'FIXTURE_ONLY', open: false }), true);
  assertCode(() => assertFixtureTransport({ networkMode: 'NETWORK', open: true }), 'FIXTURE_TRANSPORT_REQUIRED');
  const preview = adaptFixture(adapterMap, semanticFixture);
  assertCode(() => reverseFixture({ ...preview, networkMode: 'NETWORK' }), 'FIXTURE_PREVIEW_INVALID');
  assertCode(() => reverseFixture({ ...preview, truthClass: 'CANONICAL_PRODUCT_TRUTH' }), 'FIXTURE_PREVIEW_INVALID');
});

test('20 port requests name every intended shared seam and no others', () => {
  const seams = [...insertionRequest.intendedSharedSeams];
  assert.equal(validatePortRequest(insertionRequest, seams).mutationImplemented, false);
  assertCode(() => validateInsertionRequest(insertionRequest, seams.slice(0, 2)), 'INSERTION_SEAM_MISMATCH');
});

test('21 all eight provider facets reject cross-class invocation', () => {
  assert.deepEqual(ownerMap.facets.map((binding) => binding.facetClass), FACET_CLASSES);
  for (const original of ownerMap.facets) {
    const binding = original.bindingStatus === 'USABLE'
      ? original
      : createProviderFacetBinding({
          ...without(original, 'bindingHash', 'insertionRequestRef'),
          bindingStatus: 'USABLE',
          blockedReason: null,
          canonicalContractRef: 'fixture://firewall-only/annotation-contract',
          canonicalContractVersion: '1.0.0',
        });
    const request = { facetClass: binding.facetClass, operation: binding.operation, networkMode: 'FIXTURE_ONLY', authorityClass: 'NO_AUTHORITY', fixture: {} };
    assert.equal(invokeFacet({
      binding,
      requestFacetClass: binding.facetClass,
      operation: binding.operation,
      request,
      handler: () => fixtureOutput(),
    }).canonical, false);
    const wrongClass = FACET_CLASSES.find((facetClass) => facetClass !== binding.facetClass);
    assertCode(() => invokeFacet({
      binding,
      requestFacetClass: wrongClass,
      operation: binding.operation,
      request,
      handler: () => fixtureOutput(),
    }), 'FACET_CLASS_CROSSING');
    assertCode(() => invokeFacet({
      binding,
      requestFacetClass: binding.facetClass,
      operation: binding.operation,
      request: { ...request, facetClass: wrongClass },
      handler: () => fixtureOutput(),
    }), 'FACET_REQUEST_BINDING_MISMATCH');
  }
});

test('22 disable and removal leave no module-owned active dependency', () => {
  const registered = registerExtension([], descriptor);
  const dependent = {
    extensionId: 'frontier.dependent-fixture',
    extensionVersion: '0.1.0',
    descriptorHash: '1'.repeat(64),
    status: 'INSTALLED_DISABLED',
    activeDependencyIds: [descriptor.extensionId],
    authorityClass: 'NO_AUTHORITY',
  };
  assertCode(() => removalRequest([...registered, dependent], descriptor.extensionId), 'ACTIVE_DEPENDENCY_REMAINS');
  const disabled = disableExtension([...registered, dependent], dependent.extensionId);
  const removal = removalRequest(disabled, descriptor.extensionId);
  assert.equal(removal.mutationPerformed ?? false, false);
  assert.equal(removal.remaining.some((record) => record.extensionId === descriptor.extensionId), false);
});

test('23 every resource claim is measured or explicitly unavailable', () => {
  assert.equal(validateResourceBudgetClaim(resourceBudgetClaim), true);
  const metricNames = ['cpu', 'memory', 'disk', 'network', 'eventRate', 'latency', 'queue', 'storageGrowth', 'modelUse'];
  for (const name of metricNames) assert.equal(['MEASURED', 'UNAVAILABLE'].includes(resourceBudgetClaim[name].state), true);
  assert.deepEqual(Object.keys(resourceBudgetClaim.latency.observed).sort(), ['p50', 'p95', 'p99']);
  const projection = resourceClaimProjection(resourceBudgetClaim);
  assert.equal(projection.productionMeasurementAvailable, false);
  assert.equal(projection.fixtureCompatibilityEvidenceOnly, true);
  const malformedLimit = clone(resourceBudgetClaim);
  malformedLimit.network.limit = '0';
  assertCode(() => validateResourceBudgetClaim(malformedLimit), 'INTEGER_INVALID');
  const missingObserved = clone(resourceBudgetClaim);
  delete missingObserved.eventRate.observed;
  assertCode(() => validateResourceBudgetClaim(missingObserved), 'REQUIRED_FIELD_MISSING');
  const unorderedLatency = clone(resourceBudgetClaim);
  unorderedLatency.latency.limit = { p50: 5, p95: 4, p99: 6 };
  assertCode(() => validateResourceBudgetClaim(unorderedLatency), 'LATENCY_PERCENTILE_ORDER_INVALID');
  const contradictory = clone(resourceBudgetClaim);
  contradictory.cpu.limit = 10;
  assertCode(() => validateResourceBudgetClaim(contradictory), 'RESOURCE_STATE_SHAPE_INVALID');
});

test('24 resource-envelope breach fails closed without forging green', () => {
  const result = runFixtureLoad({
    resourceBudgetClaim,
    maxSafeRateClaim: descriptor.maxSafeRateClaim,
    windowSizeMs: 1_000,
    offeredEvents: 101,
    peakQueueDepth: 17,
    latencySamples: Array(101).fill(13),
    storageBytesPerEvent: 42,
    networkBytes: 1,
    modelCalls: 1,
  });
  assert.deepEqual([...result.exceeded].sort(), [
    'EVENT_RATE', 'MODEL_USE', 'NETWORK', 'P50_LATENCY', 'P95_LATENCY', 'P99_LATENCY', 'QUEUE', 'STORAGE_GROWTH',
  ]);
  assert.equal(result.acceptedEvents, 0);
  assert.equal(result.silentLoss, false);
  assert.equal(result.forgedGreen, false);
  assert.equal(result.authorityClass, 'NO_AUTHORITY');
});

test('25 every facet has an exact owner contract version or an insertion blocker', () => {
  assert.equal(validateCanonicalOwnerMap(ownerMap), true);
  assert.equal(validateModuleFacetMatrix(moduleFacetMatrix), true);
  const weakenedMatrix = clone(moduleFacetMatrix);
  weakenedMatrix.modules[0].requiredUsableFacets = ['EVIDENCE'];
  assertCode(() => validateModuleFacetMatrix(weakenedMatrix), 'MODULE_FACET_REQUIREMENT_MISMATCH');
  const usable = ownerMap.facets.filter((binding) => binding.bindingStatus === 'USABLE');
  const blocked = ownerMap.facets.filter((binding) => binding.bindingStatus === 'BLOCKED');
  assert.equal(usable.length, 7);
  assert.equal(blocked.length, 1);
  for (const binding of usable) {
    assert.match(binding.acceptedOwnerCommitSha, /^[a-f0-9]{40}$/);
    assert.notEqual(binding.canonicalContractRef, 'UNRESOLVED');
    assert.notEqual(binding.canonicalContractVersion, 'UNRESOLVED');
  }
  assert.equal(blocked[0].facetClass, 'ANNOTATION_ADAPTER');
  assert.equal(blocked[0].blockedReason, 'CANONICAL_Q_ANNOTATION_REVISION_RETRACTION_CONTRACT_UNRESOLVED');
  assert.equal(typeof blocked[0].insertionRequestRef, 'string');
  const blockedWithoutReason = createProviderFacetBinding({
    ...without(blocked[0], 'bindingHash'),
    blockedReason: 'TEMPORARY',
  });
  assertCode(() => createProviderFacetBinding({
    ...without(blockedWithoutReason, 'bindingHash'),
    blockedReason: null,
  }), 'STRING_INVALID');
  assertCode(() => createProviderFacetBinding({
    ...without(usable[0], 'bindingHash'),
    canonicalContractRef: 'UNRESOLVED',
    canonicalContractVersion: 'UNRESOLVED',
  }), 'OWNER_CONTRACT_UNRESOLVED');
  assertCode(() => invokeFacet({
    binding: { ...usable[0], canonicalContractRef: 'UNRESOLVED' },
    requestFacetClass: usable[0].facetClass,
    operation: usable[0].operation,
    request: {
      facetClass: usable[0].facetClass,
      operation: usable[0].operation,
      networkMode: 'FIXTURE_ONLY',
      authorityClass: 'NO_AUTHORITY',
      fixture: {},
    },
    handler: () => fixtureOutput(),
  }), 'OWNER_CONTRACT_UNRESOLVED');
  assertCode(() => createProviderFacetBinding({
    ...without(usable[0], 'bindingHash'),
    insertionRequestRef: 'frontier/dock/INSERTION.md#not-needed',
  }), 'USABLE_BINDING_HAS_INSERTION');
  const blockedModules = moduleFacetMatrix.modules.filter((row) => row.requiredUsableFacets.includes(blocked[0].facetClass));
  assert.deepEqual(blockedModules.map((row) => row.moduleId), ['F11']);
});

test('26 scenario references are immutable and cannot execute or mutate canonical truth', () => {
  assert.equal(validateScenarioReference(scenarioReference), true);
  const reference = createScenarioReference(without(scenarioReference, 'scenarioHash'));
  assert.equal(Object.isFrozen(reference), true);
  assert.equal(Object.isFrozen(reference.expectedCanonicalPostureRefs), true);
  assert.equal(assertScenarioReferenceOperation(reference, 'VALIDATE_FIXTURE').executed, false);
  assertCode(() => assertScenarioReferenceOperation(reference, 'EXECUTE'), 'SCENARIO_OPERATION_FORBIDDEN');
  assertCode(() => createScenarioReference({
    ...without(scenarioReference, 'scenarioHash'),
    extensionProviderRef: 'F2',
  }), 'SCENARIO_PROVIDER_INVALID');
  assert.throws(() => reference.expectedCanonicalPostureRefs.push('redefined'));
});

test('27 dependency, capability, timing, truth, health, and test declarations are explicit', () => {
  parseExtensionDescriptor(descriptor);
  validateCanonicalAdapterMap(adapterMap);
  assert.equal(validateCanonicalSharedOwnerReferenceMap(sharedOwnerReferences), true);
  assert.equal(sharedOwnerReferences.references.filter((reference) => reference.compatibilityStatus === 'USABLE').length, 4);
  const incidentReference = sharedOwnerReferences.references.find((reference) => reference.referenceId === 'PRODUCT_INCIDENT');
  assert.equal(incidentReference.compatibilityStatus, 'BLOCKED');
  assert.equal(incidentReference.blockedReason, 'INCIDENT_OWNER_NOT_CONFIGURED');
  assert.equal(compatibilityMatrix.recordFamilies.includes('CanonicalSharedOwnerReferenceMapV1'), true);
  validateModuleInventoryProjection(readJson('examples/module-inventory-projection.v1.json'));
  const authorityProjection = readJson('examples/module-inventory-projection.v1.json');
  authorityProjection.modules[0].authorityClass = 'PRODUCT_AUTHORITY';
  assertCode(() => validateModuleInventoryProjection(authorityProjection), 'INVENTORY_AUTHORITY_FORBIDDEN');
  assertCode(() => createExtensionDescriptor({
    ...without(descriptor, 'descriptorHash'),
    sourceSha: 'a'.repeat(41),
  }), 'SHA_INVALID');
  assertCode(() => parseSemver('9007199254740992.0.0'), 'SEMVER_COMPONENT_TOO_LARGE');
  const fields = dockRecordFieldInventory();
  assert.deepEqual(contractSchema.$defs.ExtensionDescriptorV1.required, fields.ExtensionDescriptorV1);
  for (const field of [
    'requiredCapabilityRefs', 'optionalCapabilityRefs', 'capabilityClass', 'latencyClass', 'freshnessRequirement',
    'completenessRequirement', 'determinismClass', 'replayClass', 'dataClassifications', 'failureModes',
    'degradationBehavior', 'healthContractRef', 'cockpitProjectionRef', 'testEntryPointRefs',
  ]) assert.equal(Object.hasOwn(descriptor, field), true, `${field} must be explicit`);
  assert.equal(moduleFacetMatrix.modules.length, 13);
});

test('28 maximum-rate and beyond-rate load fixtures prove bounded backpressure', () => {
  const common = {
    resourceBudgetClaim,
    maxSafeRateClaim: descriptor.maxSafeRateClaim,
    windowSizeMs: 1_000,
    storageBytesPerEvent: 32,
    peakQueueDepth: 16,
    networkBytes: 0,
    modelCalls: 0,
  };
  const atLimit = runFixtureLoad({ ...common, offeredEvents: 100, latencySamples: compliantLatencySamples(100) });
  const beyond = runFixtureLoad({ ...common, offeredEvents: 101, latencySamples: compliantLatencySamples(101) });
  assert.equal(atLimit.state, 'WITHIN_FIXTURE_ENVELOPE');
  assert.equal(atLimit.acceptedEvents, 100);
  assert.equal(atLimit.backpressureApplied, true);
  assert.equal(beyond.state, 'DEGRADATION_REQUESTED');
  assert.equal(beyond.rejectedEvents, 101);
  const mismatchedProof = runFixtureLoad({
    ...common,
    offeredEvents: 100,
    storageBytesPerEvent: 33,
    latencySamples: compliantLatencySamples(100),
  });
  assert.equal(mismatchedProof.state, 'DEGRADATION_REQUESTED');
  assert.deepEqual(mismatchedProof.exceeded, ['MAX_RATE_PROOF_MISMATCH']);
  assertCode(() => runFixtureLoad({
    ...common,
    offeredEvents: 100,
    latencySamples: compliantLatencySamples(99),
  }), 'LATENCY_SAMPLE_COUNT_MISMATCH');
  for (const result of [atLimit, beyond]) {
    assert.equal(result.silentLoss, false);
    assert.equal(result.forgedGreen, false);
    assert.equal(result.authorityClass, 'NO_AUTHORITY');
  }
});
