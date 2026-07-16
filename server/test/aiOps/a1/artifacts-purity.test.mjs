import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { assertNetworkPermissionDenied, loadContracts } from './_network-denied-env.mjs';

const contracts = await loadContracts();
const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '../../../..');
const fixtureDirectory = resolve(repositoryRoot, 'fixtures/aiOps/a1');
const receiptDirectory = resolve(repositoryRoot, 'docs/archive/aiOps/a1/shadow');
const expectedSourcePaths = Object.keys(contracts.AI_OPS_LOCAL_SOURCE_RESOURCE_ID_BY_PATH).sort();
const expectedSourcePathSet = new Set(expectedSourcePaths);

const fixtureNames = Object.freeze([
  'entry-inventory.v1.json', 'schema-reuse-map.v1.json', 'adapted-schemas.v1.json', 'capability-matrix.v1.json',
  'identity-provider-matrix.v1.json', 'hard-denials.v1.json', 'action-classes.v1.json',
  'classification-manifest.v1.json', 'runbook-templates.v1.json', 'runbook-manifest-instances.v1.json',
  'reliability-targets.v1.json', 'capability-graduation-target-instances.v1.json',
  'action-class-fixture-instances.v1.json', 'mechanical-authority-manifests.v1.json', 'policy-bundle.synthetic.v1.json',
  'decision-log-design.synthetic.v1.json', 'control-insertion-requests.v1.json',
  'insertion-requests.v1.json', 'unfinished-interfaces.v1.json',
]);
const receiptNames = Object.freeze([
  'A1X_SHADOW_READY_RECEIPT.md',
  'AI_OPS_REUSE_AND_GAP_RECEIPT.md',
  'SHADOW_ARTIFACT_READY_RECEIPT.md',
]);
const staticArtifactsByFixture = Object.freeze({
  'entry-inventory.v1.json': contracts.AI_OPS_ARTIFACTS.entryInventory,
  'schema-reuse-map.v1.json': contracts.AI_OPS_ARTIFACTS.schemaReuseMap,
  'adapted-schemas.v1.json': contracts.AI_OPS_ARTIFACTS.adaptedSchemas,
  'capability-matrix.v1.json': contracts.AI_OPS_ARTIFACTS.capabilityMatrix,
  'identity-provider-matrix.v1.json': contracts.AI_OPS_ARTIFACTS.identityProviderMatrix,
  'hard-denials.v1.json': contracts.AI_OPS_ARTIFACTS.hardDenials,
  'action-classes.v1.json': contracts.AI_OPS_ARTIFACTS.actionClasses,
  'runbook-templates.v1.json': contracts.AI_OPS_ARTIFACTS.runbookTemplates,
  'runbook-manifest-instances.v1.json': contracts.AI_OPS_ARTIFACTS.runbookManifestInstances,
  'reliability-targets.v1.json': contracts.AI_OPS_ARTIFACTS.reliabilityTargets,
  'capability-graduation-target-instances.v1.json': contracts.AI_OPS_ARTIFACTS.capabilityGraduationTargetInstances,
  'action-class-fixture-instances.v1.json': contracts.AI_OPS_ARTIFACTS.actionClassFixtureInstances,
  'policy-bundle.synthetic.v1.json': contracts.AI_OPS_ARTIFACTS.policyBundleFixture,
  'decision-log-design.synthetic.v1.json': contracts.AI_OPS_ARTIFACTS.decisionLogDesign,
  'control-insertion-requests.v1.json': contracts.AI_OPS_ARTIFACTS.controlInsertionRequests,
  'insertion-requests.v1.json': contracts.AI_OPS_ARTIFACTS.insertionRequests,
  'unfinished-interfaces.v1.json': contracts.AI_OPS_ARTIFACTS.unfinishedInterfaces,
});
const dynamicFixtureNames = new Set(['classification-manifest.v1.json', 'mechanical-authority-manifests.v1.json']);

const resourceIdsByClassifiedPath = new Map();
for (const resource of contracts.AI_OPS_CLASSIFICATION_INPUTS) {
  if (resource.classifiedPath.includes('#')) continue;
  const ids = resourceIdsByClassifiedPath.get(resource.classifiedPath) ?? [];
  ids.push(resource.resourceId);
  resourceIdsByClassifiedPath.set(resource.classifiedPath, ids);
}
const knownClassifiedPaths = new Set([
  ...resourceIdsByClassifiedPath.keys(),
  ...expectedSourcePaths,
]);

function repositoryPath(absolutePath) {
  return relative(repositoryRoot, absolutePath).split('\\').join('/');
}

function resolveRelativeClassifiedPath(importerPath, specifier) {
  const unresolvedPath = repositoryPath(resolve(repositoryRoot, dirname(importerPath), specifier));
  const candidates = [
    unresolvedPath,
    unresolvedPath.endsWith('.js') ? `${unresolvedPath.slice(0, -3)}.ts` : null,
    unresolvedPath.endsWith('.mjs') ? `${unresolvedPath.slice(0, -4)}.mts` : null,
    unresolvedPath.endsWith('.cjs') ? `${unresolvedPath.slice(0, -4)}.cts` : null,
    /\.[A-Za-z0-9]+$/.test(unresolvedPath) ? null : `${unresolvedPath}.ts`,
    /\.[A-Za-z0-9]+$/.test(unresolvedPath) ? null : `${unresolvedPath}/index.ts`,
  ].filter((candidate) => candidate !== null);
  const matches = [...new Set(candidates.filter((candidate) => knownClassifiedPaths.has(candidate)))];
  assert.equal(matches.length, 1, `relative module classification path must resolve exactly once: ${importerPath}:${specifier}`);
  return matches[0];
}

function canonicalResourceIdForClassifiedPath(classifiedPath) {
  const localResourceId = contracts.AI_OPS_LOCAL_SOURCE_RESOURCE_ID_BY_PATH[classifiedPath];
  if (localResourceId !== undefined) return localResourceId;
  const resourceIds = [...new Set(resourceIdsByClassifiedPath.get(classifiedPath) ?? [])].sort();
  assert.equal(resourceIds.length, 1, `classification path must have one canonical resource: ${classifiedPath}`);
  return resourceIds[0];
}

function relativeModuleSpecifiers(sourcePath, sourceText) {
  const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier !== undefined
      && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      specifiers.push(statement.moduleSpecifier.text);
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement)
      && ts.isExternalModuleReference(statement.moduleReference)
      && statement.moduleReference.expression !== undefined
      && ts.isStringLiteralLike(statement.moduleReference.expression)) {
      specifiers.push(statement.moduleReference.expression.text);
    }
  }
  return [...new Set(specifiers.filter((specifier) => specifier.startsWith('.')))];
}

async function expectedDirectDependencyIds(sourcePath) {
  const sourceText = await readFile(resolve(repositoryRoot, sourcePath), 'utf8');
  return relativeModuleSpecifiers(sourcePath, sourceText)
    .map((specifier) => resolveRelativeClassifiedPath(sourcePath, specifier))
    .map(canonicalResourceIdForClassifiedPath)
    .filter((resourceId, index, values) => values.indexOf(resourceId) === index)
    .sort();
}

function gitBlobDigest(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

test('artifact sealing snapshots hostile payloads and follows the strict canonical hash profile', () => {
  let descriptorReads = 0;
  const payload = new Proxy({ value: 'first-version' }, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'value') {
        descriptorReads += 1;
        return { configurable: true, enumerable: true, writable: true, value: descriptorReads === 1 ? 'first-version' : 'second-version' };
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const artifact = contracts.sealArtifact('AI_OPS_HOSTILE_SEAL_TEST_V1', 'aiops-hostile-seal-test', payload);
  assert.equal(descriptorReads, 1);
  assert.equal(artifact.payload.value, 'first-version');
  const { contentHash, ...body } = artifact;
  assert.equal(contentHash, contracts.sha256Canonical(body));
  assert.throws(() => contracts.sha256Canonical(-0), /invalid number/);
  assert.throws(() => contracts.sha256Canonical('\ud800'), /lone high surrogate/);
  assert.notEqual(contracts.sha256Canonical('\u00e9'), contracts.sha256Canonical('e\u0301'), 'Unicode is preserved rather than normalized');
  assert.throws(
    () => contracts.sealArtifact('AI_OPS_HOSTILE_SEAL_TEST_V1', 'aiops-hostile-seal-test', { token: 'sk-proj-1234567890abcdef' }),
    /secret-shaped material/,
  );
});

test('all 19 fixtures match current sealed source artifacts and port provenance', async () => {
  assert.equal(Object.keys(staticArtifactsByFixture).length, Object.keys(contracts.AI_OPS_ARTIFACTS).length);
  for (const fixtureName of fixtureNames) {
    const fixture = JSON.parse(await readFile(resolve(fixtureDirectory, fixtureName), 'utf8'));
    if (!dynamicFixtureNames.has(fixtureName)) assert.deepEqual(fixture, staticArtifactsByFixture[fixtureName], fixtureName);
    const { contentHash, ...body } = fixture;
    assert.equal(contentHash, contracts.sha256Canonical(body), fixtureName);
    assert.equal(fixture.environment, 'SHADOW');
    assert.equal(fixture.state, 'SHADOW_SPECULATIVE');
    assert.equal(fixture.provenance.sourceRevision, contracts.AI_OPS_PORT_BASE_SHA);
    assert.equal(fixture.provenance.generatorVersion, 2);
    assert.deepEqual(fixture.provenance.donorLineage, {
      originBaseRevision: contracts.AI_OPS_SHADOW_ORIGIN_BASE_SHA,
      a1ImplementationRevision: contracts.AI_OPS_SHADOW_A1_IMPLEMENTATION_SHA,
      a1SealedRevision: contracts.AI_OPS_SHADOW_A1_SEALED_SHA,
      a1xImplementationRevision: contracts.AI_OPS_SHADOW_A1X_IMPLEMENTATION_SHA,
      sealedTipRevision: contracts.AI_OPS_SHADOW_TIP_SHA,
    });
  }
});

test('classification binds exactly the 12 relocated A1 sources and every relative dependency edge', async () => {
  assert.equal(expectedSourcePaths.length, 12);
  const fixture = JSON.parse(await readFile(resolve(fixtureDirectory, 'classification-manifest.v1.json'), 'utf8'));
  const sourceEntries = fixture.payload.entries.filter((row) => expectedSourcePathSet.has(row.classifiedPath) && !row.classifiedPath.includes('#'));
  assert.deepEqual([...new Set(sourceEntries.map((entry) => entry.classifiedPath))].sort(), expectedSourcePaths);
  for (const [sourcePath, resourceId] of Object.entries(contracts.AI_OPS_LOCAL_SOURCE_RESOURCE_ID_BY_PATH)) {
    const mappedResource = contracts.AI_OPS_CLASSIFICATION_INPUTS.find((resource) => resource.resourceId === resourceId);
    assert.equal(mappedResource?.classifiedPath, sourcePath, `${sourcePath} canonical source mapping`);
    const expectedDependencyIds = await expectedDirectDependencyIds(sourcePath);
    for (const entry of sourceEntries.filter((candidate) => candidate.classifiedPath === sourcePath)) {
      const actualDependencyIds = [...new Set(entry.directDependencyIds)].sort();
      assert.deepEqual(expectedDependencyIds.filter((id) => !actualDependencyIds.includes(id)), [], `${entry.resourceId} import edges`);
      const bytes = await readFile(resolve(repositoryRoot, entry.classifiedPath));
      assert.equal(entry.evidencePath, entry.classifiedPath);
      assert.equal(entry.evidenceDigestAlgorithm, 'SHA-256');
      assert.equal(entry.evidenceRevision, contracts.AI_OPS_PORT_WORKTREE_REVISION);
      assert.equal(entry.evidenceDigest, createHash('sha256').update(bytes).digest('hex'));
    }
  }
  assert.equal(fixture.payload.sourceRevision, contracts.AI_OPS_PORT_BASE_SHA);
  assert.equal(fixture.payload.entries.filter((row) => row.resourceId.startsWith('aiops-hard-denial-fixture-') && row.actionClass === 'D').length, 14);
});

test('mechanical authority fixture is current, unsigned, and closed across all 31 roots', async () => {
  const fixture = JSON.parse(await readFile(resolve(fixtureDirectory, 'mechanical-authority-manifests.v1.json'), 'utf8'));
  const sourceEntries = fixture.payload.classification.entries.filter((row) => expectedSourcePathSet.has(row.classifiedPath) && !row.classifiedPath.includes('#'));
  assert.deepEqual([...new Set(sourceEntries.map((entry) => entry.classifiedPath))].sort(), expectedSourcePaths);
  for (const entry of sourceEntries) {
    const bytes = await readFile(resolve(repositoryRoot, entry.classifiedPath));
    assert.equal(entry.evidenceRevision, contracts.AI_OPS_PORT_WORKTREE_REVISION);
    assert.equal(entry.evidenceDigest, createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(fixture.payload.sourceRevision, contracts.AI_OPS_PORT_BASE_SHA);
  assert.equal(fixture.payload.portBaseSha, contracts.AI_OPS_PORT_BASE_SHA);
  assert.equal(fixture.payload.shadowA1SealedSha, contracts.AI_OPS_SHADOW_A1_SEALED_SHA);
  assert.equal(fixture.payload.rootManifests.length, 31);
  assert.equal(fixture.payload.operationalAuthorityCreated, false);
  assert.equal(fixture.payload.activationState, 'UNSIGNED_INACTIVE');
  assert.equal(fixture.payload.ownerSignature.signatureState, 'OWNER_SIGNATURE_REQUIRED');
});

test('entry inventory binds current bytes and recognizes only ratified or external request IDs', async () => {
  const rowsById = new Map(contracts.AI_OPS_ENTRY_INVENTORY.map((row) => [row.entryId, row]));
  assert.equal(
    contracts.sha256Canonical(contracts.AI_OPS_ENTRY_INVENTORY),
    '07d1d5f80ebb711b4a7b615788974df4acbeefb5f698406ddc7810db9b336e72',
    'independent full-row digest locks every declared path, revision, digest, resolution flag, status, and owner seam',
  );
  const i00SealedOwnerEvidence = await readFile(resolve(repositoryRoot, 'I00_PRODUCT_BUILD_STATE.md'), 'utf8');
  const reuseAndGapEvidence = await readFile(resolve(receiptDirectory, 'AI_OPS_REUSE_AND_GAP_RECEIPT.md'), 'utf8');
  const a1xEvidence = await readFile(resolve(receiptDirectory, 'A1X_SHADOW_READY_RECEIPT.md'), 'utf8');
  const externalEvidenceByEntryId = new Map([
    ['i00.section14.owner-law', i00SealedOwnerEvidence],
    ['i00.section20.owner-law', i00SealedOwnerEvidence],
    ['authority.activation-directive', reuseAndGapEvidence],
    ['authority.command', reuseAndGapEvidence],
    ['authority.time-amendment', reuseAndGapEvidence],
    ['authority.aiops-identity-draft', a1xEvidence],
    ['authority.aiops-reliability-targets-draft', a1xEvidence],
  ]);
  assert.equal(rowsById.size, contracts.AI_OPS_ENTRY_INVENTORY.length);
  for (const entryId of [
    'product-runtime.types', 'ledger.adapter', 'ledger.owner', 'i00.product-assurance-manifest',
    'reject-duplicate.source-of-truth', 'reject-duplicate.event-bus', 'reject-duplicate.incident-database',
    'reject-duplicate.command-registry', 'reject-duplicate.approval-store', 'reject-duplicate.health-system',
    'reject-duplicate.executor', 'reject-duplicate.ledger', 'authority.resolution-receipt', 'authority.d-launch-29',
    'i00.integrated-acceptance',
  ]) assert.ok(rowsById.has(entryId), entryId);
  const validRequestIds = new Set([
    ...contracts.AI_OPS_INSERTION_REQUESTS.map((row) => row.rowId),
    ...contracts.AI_OPS_EXTERNAL_INTEGRATOR_DEPENDENCY_IDS,
  ]);
  for (const row of contracts.AI_OPS_ENTRY_INVENTORY) {
    if (row.resolvedAtPortBase) {
      const bytes = await readFile(resolve(repositoryRoot, row.path));
      const digest = row.digestAlgorithm === 'GIT_BLOB_SHA1'
        ? gitBlobDigest(bytes)
        : createHash('sha256').update(bytes).digest('hex');
      assert.equal(digest, row.digest, `${row.entryId}:${row.path}`);
    } else {
      const evidence = externalEvidenceByEntryId.get(row.entryId);
      assert.ok(evidence, `${row.entryId}:immutable external provenance evidence`);
      assert.ok(evidence.includes(row.digest), `${row.entryId}:sealed external provenance digest`);
    }
    assert.ok(row.mappedRequirement.length > 0);
    assert.ok(row.currentStatus.length > 0);
    assert.ok(row.testEntrypoints.length > 0);
    for (const entrypoint of row.testEntrypoints) await readFile(resolve(repositoryRoot, entrypoint));
    for (const requestId of row.insertionRequestIds) assert.ok(validRequestIds.has(requestId), `${row.entryId}:${requestId}`);
    assert.equal(row.authorityCreated, false);
  }
  assert.equal(contracts.AI_OPS_ENTRY_INVENTORY.length, 79);
  assert.deepEqual(
    Object.fromEntries(['REUSE', 'ADAPT', 'REFERENCE_ONLY', 'REJECT_DUPLICATE', 'MISSING_REQUIRED'].map((disposition) => [
      disposition,
      contracts.AI_OPS_ENTRY_INVENTORY.filter((row) => row.disposition === disposition).length,
    ])),
    { REUSE: 8, ADAPT: 19, REFERENCE_ONLY: 36, REJECT_DUPLICATE: 8, MISSING_REQUIRED: 8 },
  );
  assert.equal(rowsById.get('foundation.failures').disposition, 'REFERENCE_ONLY');
  assert.deepEqual(rowsById.get('product-runtime.controls').insertionRequestIds, ['AIOPS-IR-CONTROLS-008']);
  assert.deepEqual(rowsById.get('product-runtime.command-owner').insertionRequestIds, ['AIOPS-IR-CONTROLS-008']);
  assert.deepEqual(rowsById.get('ledger.adapter').insertionRequestIds, ['AIOPS-IR-PERSISTENCE-003', 'AIOPS-IR-AUDIT-021']);
  assert.equal(rowsById.get('i00.self-healing-registry').currentStatus, 'INTEGRATED_ACCEPTED_PRODUCT_ASSURANCE_POLICY_OWNER_PRESENT_AI_OPS_BINDING_NOT_MOUNTED');
  assert.equal(rowsById.get('i00.integrated-acceptance').currentStatus, 'INTEGRATED_ACCEPTED_D_LAUNCH_50_NO_DEPLOYMENT_OR_EXTERNAL_ACTION');
  assert.equal(rowsById.get('authority.d-launch-29').currentStatus, 'INTEGRATED_ACCEPTED_PORT_AUTHORIZED');
  assert.equal(rowsById.get('product-assurance.autonomic-reconcile-kernel').currentStatus, 'PURE_NON_EXECUTING_REMEDIATION_CONTRACT_DONOR');
  assert.equal(rowsById.get('product-assurance.generated-diagnostic-boundary').currentStatus, 'STALE_GENERATED_REFERENCE_ONLY');
  assert.equal(rowsById.get('i00.provider-authorization').owner, 'MULTI_OWNER_DEPENDENCY');
  assert.equal(contracts.AI_OPS_ENTRY_INVENTORY.some((row) => /SOURCE_FROZEN|LOCAL_ACCEPTANCE_PENDING|NOT_ACCEPTED/.test(row.currentStatus)), false);
});

test('production contracts are deterministic and have no ambient IO, clocks, timers, or secret access', async () => {
  const forbidden = [
    /node:(?:http|https|http2|net|tls|dns|dgram|fs|child_process)/,
    /process\.env/,
    /Math\.random\s*\(/,
    /Date\.now\s*\(/,
    /new\s+Date\s*\(/,
    /setTimeout\s*\(/,
    /setInterval\s*\(/,
    /\bfetch\s*\(/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
  ];
  for (const sourcePath of expectedSourcePaths) {
    const source = await readFile(resolve(repositoryRoot, sourcePath), 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${sourcePath}:${pattern}`);
  }
  assertNetworkPermissionDenied();
});

test('fixtures, contracts, and archived shadow receipts contain no credential material', async () => {
  const paths = [
    ...expectedSourcePaths.map((path) => resolve(repositoryRoot, path)),
    ...fixtureNames.map((name) => resolve(fixtureDirectory, name)),
    ...receiptNames.map((name) => resolve(receiptDirectory, name)),
  ];
  const secretPatterns = [
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /\b(?:sk|rk|pk)-(?:live|prod|test)-[A-Za-z0-9_-]{8,}\b/,
    /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/,
  ];
  for (const path of paths) {
    const text = await readFile(path, 'utf8');
    for (const pattern of secretPatterns) assert.doesNotMatch(text, pattern, path);
  }
  for (const row of contracts.AI_OPS_PROVIDER_CREDENTIAL_MATRIX) {
    assert.equal(row.credentialMaterialPresent, false);
    assert.deepEqual(row.executableCapabilityIds, []);
    assert.ok(row.providerId === null || row.providerId.startsWith('SYNTHETIC_'));
    assert.ok(row.observedAuthMode === 'NONE' || row.observedAuthMode === 'UNKNOWN');
    assert.notEqual(row.disposition, 'ADMISSIBLE_SHADOW_CONFIGURATION');
  }
});

test('fixture and archived receipt directories have exact membership', async () => {
  assert.deepEqual((await readdir(fixtureDirectory)).sort(), ['generate-artifacts.mjs', ...fixtureNames].sort());
  assert.deepEqual((await readdir(receiptDirectory)).sort(), [...receiptNames].sort());
});
