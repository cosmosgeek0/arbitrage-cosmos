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
const repositoryRoot = resolve(testDirectory, '../../..');
const fixtureDirectory = resolve(repositoryRoot, 'fixtures/aiOps/contracts');
const receiptDirectory = resolve(fixtureDirectory, 'receipts');
const sourceDirectory = resolve(repositoryRoot, 'server/src/aiOps/contracts');

const resourceIdsByClassifiedPath = new Map();
for (const resource of contracts.AI_OPS_CLASSIFICATION_INPUTS) {
  if (resource.classifiedPath.includes('#')) continue;
  const ids = resourceIdsByClassifiedPath.get(resource.classifiedPath) ?? [];
  ids.push(resource.resourceId);
  resourceIdsByClassifiedPath.set(resource.classifiedPath, ids);
}
const knownClassifiedPaths = new Set([
  ...resourceIdsByClassifiedPath.keys(),
  ...Object.keys(contracts.AI_OPS_LOCAL_SOURCE_RESOURCE_ID_BY_PATH),
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

const fixtureNames = [
  'entry-inventory.v1.json', 'schema-reuse-map.v1.json', 'adapted-schemas.v1.json', 'capability-matrix.v1.json',
  'identity-provider-matrix.v1.json', 'hard-denials.v1.json', 'action-classes.v1.json',
  'classification-manifest.v1.json', 'runbook-templates.v1.json', 'reliability-targets.v1.json', 'policy-bundle.synthetic.v1.json',
  'decision-log-design.synthetic.v1.json', 'control-insertion-requests.v1.json',
  'insertion-requests.v1.json', 'unfinished-interfaces.v1.json',
];
const receiptNames = ['AI_OPS_REUSE_AND_GAP_RECEIPT.md', 'SHADOW_ARTIFACT_READY_RECEIPT.md'];

const staticArtifactsByFixture = {
  'entry-inventory.v1.json': contracts.AI_OPS_ARTIFACTS.entryInventory,
  'schema-reuse-map.v1.json': contracts.AI_OPS_ARTIFACTS.schemaReuseMap,
  'adapted-schemas.v1.json': contracts.AI_OPS_ARTIFACTS.adaptedSchemas,
  'capability-matrix.v1.json': contracts.AI_OPS_ARTIFACTS.capabilityMatrix,
  'identity-provider-matrix.v1.json': contracts.AI_OPS_ARTIFACTS.identityProviderMatrix,
  'hard-denials.v1.json': contracts.AI_OPS_ARTIFACTS.hardDenials,
  'action-classes.v1.json': contracts.AI_OPS_ARTIFACTS.actionClasses,
  'runbook-templates.v1.json': contracts.AI_OPS_ARTIFACTS.runbookTemplates,
  'reliability-targets.v1.json': contracts.AI_OPS_ARTIFACTS.reliabilityTargets,
  'policy-bundle.synthetic.v1.json': contracts.AI_OPS_ARTIFACTS.policyBundleFixture,
  'decision-log-design.synthetic.v1.json': contracts.AI_OPS_ARTIFACTS.decisionLogDesign,
  'control-insertion-requests.v1.json': contracts.AI_OPS_ARTIFACTS.controlInsertionRequests,
  'insertion-requests.v1.json': contracts.AI_OPS_ARTIFACTS.insertionRequests,
  'unfinished-interfaces.v1.json': contracts.AI_OPS_ARTIFACTS.unfinishedInterfaces,
};

test('artifact sealing snapshots attacker-controlled payloads exactly once before hashing', () => {
  let descriptorReads = 0;
  const payload = new Proxy({ value: 'first-version' }, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'value') {
        descriptorReads += 1;
        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: descriptorReads === 1 ? 'first-version' : 'second-version',
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const artifact = contracts.sealArtifact('AI_OPS_HOSTILE_SEAL_TEST_V1', 'aiops-hostile-seal-test', payload);
  assert.equal(descriptorReads, 1);
  assert.equal(artifact.payload.value, 'first-version');
  const { contentHash, ...body } = artifact;
  assert.equal(contentHash, contracts.sha256Canonical(body));
  assert.throws(
    () => contracts.sealArtifact('AI_OPS_HOSTILE_SEAL_TEST_V1', 'aiops-hostile-seal-test', { token: 'sk-proj-1234567890abcdef' }),
    /secret-shaped material/,
  );
  const trapSecret = 'sk-proj-1234567890abcdef';
  const hostilePayload = new Proxy({}, { ownKeys: () => { throw new Error(trapSecret); } });
  assert.throws(
    () => contracts.sealArtifact('AI_OPS_HOSTILE_SEAL_TEST_V1', 'aiops-hostile-seal-test', hostilePayload),
    (error) => error instanceof TypeError && !error.message.includes(trapSecret),
  );
});

test('all generated fixtures exactly match sealed source artifacts and their content hashes', async () => {
  assert.equal(Object.keys(staticArtifactsByFixture).length, Object.keys(contracts.AI_OPS_ARTIFACTS).length);
  for (const fixtureName of fixtureNames) {
    const fixture = JSON.parse(await readFile(resolve(fixtureDirectory, fixtureName), 'utf8'));
    if (fixtureName !== 'classification-manifest.v1.json') assert.deepEqual(fixture, staticArtifactsByFixture[fixtureName], fixtureName);
    const { contentHash, ...body } = fixture;
    assert.equal(contentHash, contracts.sha256Canonical(body), fixtureName);
    assert.equal(fixture.state, 'SHADOW_SPECULATIVE');
    assert.equal(fixture.environment, 'SHADOW');
  }
});

test('mechanical classification fixture binds actual A1 source bytes', async () => {
  const fixture = JSON.parse(await readFile(resolve(fixtureDirectory, 'classification-manifest.v1.json'), 'utf8'));
  const sourceEntries = fixture.payload.entries.filter((row) => row.classifiedPath.startsWith('server/src/aiOps/contracts/') && !row.classifiedPath.includes('#'));
  const expectedSourcePaths = (await readdir(sourceDirectory))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => `server/src/aiOps/contracts/${name}`)
    .sort();
  const classifiedSourcePaths = [...new Set(sourceEntries.map((entry) => entry.classifiedPath))].sort();
  assert.deepEqual(classifiedSourcePaths, expectedSourcePaths, 'classification source set must exactly cover current A1 TypeScript sources');
  assert.deepEqual(Object.keys(contracts.AI_OPS_LOCAL_SOURCE_RESOURCE_ID_BY_PATH).sort(), expectedSourcePaths, 'local source resource map must exactly cover current A1 TypeScript sources');
  for (const [sourcePath, resourceId] of Object.entries(contracts.AI_OPS_LOCAL_SOURCE_RESOURCE_ID_BY_PATH)) {
    const mappedResource = contracts.AI_OPS_CLASSIFICATION_INPUTS.find((resource) => resource.resourceId === resourceId);
    assert.equal(mappedResource?.classifiedPath, sourcePath, `${sourcePath} must map to its canonical file-node resource`);
  }
  for (const sourcePath of expectedSourcePaths) {
    const expectedDependencyIds = await expectedDirectDependencyIds(sourcePath);
    const staticEntries = contracts.AI_OPS_CLASSIFICATION_INPUTS.filter((entry) => entry.classifiedPath === sourcePath);
    const generatedEntries = sourceEntries.filter((entry) => entry.classifiedPath === sourcePath);
    assert.ok(staticEntries.length > 0, `${sourcePath} must have a static classification resource`);
    assert.equal(generatedEntries.length, staticEntries.length, `${sourcePath} must preserve every classified source resource`);
    for (const entry of [...staticEntries, ...generatedEntries]) {
      const actualDependencyIds = [...new Set(entry.directDependencyIds)].sort();
      assert.equal(actualDependencyIds.length, entry.directDependencyIds.length, `${entry.resourceId} direct dependencies must be unique`);
      const missingDependencyIds = expectedDependencyIds.filter((dependencyId) => !actualDependencyIds.includes(dependencyId));
      assert.deepEqual(missingDependencyIds, [], `${entry.resourceId} must directly bind every parsed relative import/export edge`);
    }
  }
  for (const entry of sourceEntries) {
    const bytes = await readFile(resolve(repositoryRoot, entry.classifiedPath));
    assert.equal(entry.evidencePath, entry.classifiedPath);
    assert.equal(entry.evidenceDigestAlgorithm, 'SHA-256');
    assert.equal(entry.evidenceRevision, `SHADOW_WORKTREE_FROM_${contracts.AI_OPS_SHADOW_BASE_SHA}`);
    assert.equal(entry.evidenceDigest, createHash('sha256').update(bytes).digest('hex'), entry.resourceId);
  }
  assert.equal(fixture.payload.entries.filter((row) => row.resourceId.startsWith('aiops-hard-denial-fixture-') && row.actionClass === 'D').length, 14);
});

test('entry inventory binds exact current bytes for every base blob and owner file', async () => {
  const allowedDispositions = ['ADAPT', 'MISSING_REQUIRED', 'REFERENCE_ONLY', 'REJECT_DUPLICATE', 'REUSE'];
  assert.deepEqual([...new Set(contracts.AI_OPS_ENTRY_INVENTORY.map((row) => row.disposition))].sort(), allowedDispositions);
  const requiredEntryIds = [
    'i00.section14.owner-law', 'i00.self-healing-registry', 'product-assurance.autonomic-reconcile-kernel',
    'product-assurance.runtime-assurance-separation', 'product-assurance.generated-atlas',
    'ip-assurance.subordinate-llm-plane', 'i00.section20.owner-law', 'i00.provider-authorization',
    'i00.acceptance-phases', 'ip-assurance.sections-3.1-3.9', 'ip-assurance.systemic-s6',
    'ip-assurance.systemic-s8', 'product-assurance.generated-diagnostic-boundary',
    'i00.donor-receipt.a-agent', 'canonical.incident-owner', 'canonical.material-event-owner',
    'ledger.owner', 'product-runtime.command-owner', 'canonical.approval-owner',
    'product-assurance.remediation-campaign', 'canonical.telemetry-owner', 'canonical.auth-owner',
    'canonical.cockpit-owner', 'monitoring.browser-synthetic', 'monitoring.synthetic-probe',
    'mechanism.worktree-scope', 'mechanism.test-acceptance', 'mechanism.release-assembly',
    'mechanism.canary-evidence', 'mechanism.rollback-switch', 'docs.director-rulebook', 'docs.blueprint',
    'docs.engine', 'docs.project-memory', 'docs.design-playbook',
  ];
  const rowsById = new Map(contracts.AI_OPS_ENTRY_INVENTORY.map((row) => [row.entryId, row]));
  for (const entryId of requiredEntryIds) assert.ok(rowsById.has(entryId), entryId);
  const duplicateIds = [
    'reject-duplicate.source-of-truth', 'reject-duplicate.event-bus', 'reject-duplicate.incident-database',
    'reject-duplicate.command-registry', 'reject-duplicate.approval-store', 'reject-duplicate.health-system',
    'reject-duplicate.executor', 'reject-duplicate.ledger',
  ];
  for (const entryId of duplicateIds) assert.equal(rowsById.get(entryId)?.disposition, 'REJECT_DUPLICATE', entryId);
  assert.ok(contracts.AI_OPS_ENTRY_INVENTORY.some((row) => row.disposition === 'MISSING_REQUIRED'));
  const insertionRequestIds = new Set(contracts.AI_OPS_INSERTION_REQUESTS.map((row) => row.rowId));
  for (const row of contracts.AI_OPS_ENTRY_INVENTORY) {
    const path = row.path.startsWith('/') ? row.path : resolve(repositoryRoot, row.path);
    const bytes = await readFile(path);
    let digest;
    if (row.digestAlgorithm === 'GIT_BLOB_SHA1') {
      digest = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    } else if (row.digestAlgorithm === 'SHA-256') {
      digest = createHash('sha256').update(bytes).digest('hex');
    } else {
      digest = row.revision;
    }
    assert.equal(digest, row.digest, `${row.entryId}:${row.path}`);
    assert.ok(row.mappedRequirement.length > 0);
    assert.ok(row.currentStatus.length > 0);
    assert.ok(row.testEntrypoints.length > 0);
    for (const entrypoint of row.testEntrypoints) await readFile(resolve(repositoryRoot, entrypoint));
    for (const insertionRequestId of row.insertionRequestIds) assert.ok(insertionRequestIds.has(insertionRequestId), `${row.entryId}:${insertionRequestId}`);
    assert.equal(row.authorityCreated, false);
  }
});

test('production contracts remain deterministic and free of IO, clocks, timers and secret access', async () => {
  const names = (await readdir(sourceDirectory)).filter((name) => name.endsWith('.ts')).sort();
  assert.ok(names.length >= 8);
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
  for (const name of names) {
    const source = await readFile(resolve(sourceDirectory, name), 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${name}:${pattern}`);
  }
  assertNetworkPermissionDenied();
});

test('fixtures and contracts contain no secret-shaped material or real credential field', async () => {
  const paths = [
    ...(await readdir(sourceDirectory)).filter((name) => name.endsWith('.ts')).map((name) => resolve(sourceDirectory, name)),
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
  const serializedMatrix = JSON.stringify(contracts.AI_OPS_PROVIDER_CREDENTIAL_MATRIX);
  assert.doesNotMatch(serializedMatrix, /credentialValue|apiKey|accessToken|refreshToken/i);
});

test('fixture directory contains only the generator, receipts and exact generated artifact set', async () => {
  const actual = (await readdir(fixtureDirectory)).sort();
  assert.deepEqual(actual, ['generate-artifacts.mjs', 'receipts', ...fixtureNames].sort());
  assert.deepEqual((await readdir(receiptDirectory)).sort(), receiptNames.sort());
});
