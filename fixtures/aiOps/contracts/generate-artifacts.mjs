import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(fixtureDirectory, '../../..');
const sourceDirectory = resolve(repositoryRoot, 'server/src/aiOps/contracts');
const contractModuleUrl = pathToFileURL(resolve(repositoryRoot, 'server/dist/aiOps/contracts/index.js')).href;
const contractModule = await import(contractModuleUrl);
const {
  AI_OPS_ARTIFACTS,
  AI_OPS_CLASSIFICATION_INPUTS,
  AI_OPS_LOCAL_SOURCE_RESOURCE_ID_BY_PATH,
  AI_OPS_SHADOW_BASE_SHA,
  generateClassificationManifest,
  sealArtifact,
} = contractModule;

const expectedSourcePaths = (await readdir(sourceDirectory))
  .filter((name) => name.endsWith('.ts'))
  .map((name) => `server/src/aiOps/contracts/${name}`)
  .sort();
const classifiedSourcePaths = [...new Set(AI_OPS_CLASSIFICATION_INPUTS
  .map((resource) => resource.classifiedPath)
  .filter((path) => path.startsWith('server/src/aiOps/contracts/') && !path.includes('#')))]
  .sort();
if (JSON.stringify(classifiedSourcePaths) !== JSON.stringify(expectedSourcePaths)) {
  throw new TypeError(`classification source set mismatch: expected=${expectedSourcePaths.join(',')} actual=${classifiedSourcePaths.join(',')}`);
}

const mappedSourcePaths = Object.keys(AI_OPS_LOCAL_SOURCE_RESOURCE_ID_BY_PATH).sort();
if (JSON.stringify(mappedSourcePaths) !== JSON.stringify(expectedSourcePaths)) {
  throw new TypeError(`classification source resource map mismatch: expected=${expectedSourcePaths.join(',')} actual=${mappedSourcePaths.join(',')}`);
}

const classificationInputsById = new Map(AI_OPS_CLASSIFICATION_INPUTS.map((resource) => [resource.resourceId, resource]));
for (const [sourcePath, resourceId] of Object.entries(AI_OPS_LOCAL_SOURCE_RESOURCE_ID_BY_PATH)) {
  const resource = classificationInputsById.get(resourceId);
  if (resource?.classifiedPath !== sourcePath) {
    throw new TypeError(`classification source resource map target mismatch: ${sourcePath}=>${resourceId}`);
  }
}

const resourceIdsByClassifiedPath = new Map();
for (const resource of AI_OPS_CLASSIFICATION_INPUTS) {
  if (resource.classifiedPath.includes('#')) continue;
  const ids = resourceIdsByClassifiedPath.get(resource.classifiedPath) ?? [];
  ids.push(resource.resourceId);
  resourceIdsByClassifiedPath.set(resource.classifiedPath, ids);
}
const knownClassifiedPaths = new Set([
  ...resourceIdsByClassifiedPath.keys(),
  ...Object.keys(AI_OPS_LOCAL_SOURCE_RESOURCE_ID_BY_PATH),
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
  if (matches.length !== 1) {
    throw new TypeError(`relative module classification path unresolved: ${importerPath}:${specifier}:${matches.join(',')}`);
  }
  return matches[0];
}

function canonicalResourceIdForClassifiedPath(classifiedPath) {
  const localResourceId = AI_OPS_LOCAL_SOURCE_RESOURCE_ID_BY_PATH[classifiedPath];
  if (localResourceId !== undefined) return localResourceId;
  const resourceIds = [...new Set(resourceIdsByClassifiedPath.get(classifiedPath) ?? [])].sort();
  if (resourceIds.length !== 1) {
    throw new TypeError(`classification path has no unique resource: ${classifiedPath}:${resourceIds.join(',')}`);
  }
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

for (const sourcePath of expectedSourcePaths) {
  const sourceText = await readFile(resolve(repositoryRoot, sourcePath), 'utf8');
  const expectedDependencyIds = relativeModuleSpecifiers(sourcePath, sourceText)
    .map((specifier) => resolveRelativeClassifiedPath(sourcePath, specifier))
    .map(canonicalResourceIdForClassifiedPath)
    .filter((resourceId, index, values) => values.indexOf(resourceId) === index)
    .sort();
  const sourceResources = AI_OPS_CLASSIFICATION_INPUTS.filter((resource) => resource.classifiedPath === sourcePath);
  if (sourceResources.length === 0) throw new TypeError(`missing classification source resource: ${sourcePath}`);
  for (const resource of sourceResources) {
    const actualDependencyIds = [...new Set(resource.directDependencyIds)].sort();
    if (actualDependencyIds.length !== resource.directDependencyIds.length) {
      throw new TypeError(`classification direct dependencies must be unique: ${resource.resourceId}`);
    }
    const missingDependencyIds = expectedDependencyIds.filter((dependencyId) => !actualDependencyIds.includes(dependencyId));
    if (missingDependencyIds.length > 0) {
      throw new TypeError(`classification direct import/export dependencies missing: ${resource.resourceId}:missing=${missingDependencyIds.join(',')}:actual=${actualDependencyIds.join(',')}`);
    }
  }
}

const boundClassificationInputs = await Promise.all(AI_OPS_CLASSIFICATION_INPUTS.map(async (resource) => {
  if (!resource.classifiedPath.startsWith('server/src/aiOps/contracts/') || resource.classifiedPath.includes('#')) return resource;
  const bytes = await readFile(resolve(repositoryRoot, resource.classifiedPath));
  return {
    ...resource,
    evidencePath: resource.classifiedPath,
    evidenceDigest: createHash('sha256').update(bytes).digest('hex'),
    evidenceDigestAlgorithm: 'SHA-256',
    evidenceRevision: `SHADOW_WORKTREE_FROM_${AI_OPS_SHADOW_BASE_SHA}`,
  };
}));
const classificationManifest = generateClassificationManifest(AI_OPS_SHADOW_BASE_SHA, boundClassificationInputs);
const boundClassificationArtifact = sealArtifact(
  'AI_OPS_CLASSIFICATION_MANIFEST_ENVELOPE_V1',
  'aiops-classification-manifest',
  classificationManifest,
);

const OUTPUTS = Object.freeze({
  'entry-inventory.v1.json': AI_OPS_ARTIFACTS.entryInventory,
  'schema-reuse-map.v1.json': AI_OPS_ARTIFACTS.schemaReuseMap,
  'adapted-schemas.v1.json': AI_OPS_ARTIFACTS.adaptedSchemas,
  'capability-matrix.v1.json': AI_OPS_ARTIFACTS.capabilityMatrix,
  'identity-provider-matrix.v1.json': AI_OPS_ARTIFACTS.identityProviderMatrix,
  'hard-denials.v1.json': AI_OPS_ARTIFACTS.hardDenials,
  'action-classes.v1.json': AI_OPS_ARTIFACTS.actionClasses,
  'classification-manifest.v1.json': boundClassificationArtifact,
  'runbook-templates.v1.json': AI_OPS_ARTIFACTS.runbookTemplates,
  'reliability-targets.v1.json': AI_OPS_ARTIFACTS.reliabilityTargets,
  'policy-bundle.synthetic.v1.json': AI_OPS_ARTIFACTS.policyBundleFixture,
  'decision-log-design.synthetic.v1.json': AI_OPS_ARTIFACTS.decisionLogDesign,
  'control-insertion-requests.v1.json': AI_OPS_ARTIFACTS.controlInsertionRequests,
  'insertion-requests.v1.json': AI_OPS_ARTIFACTS.insertionRequests,
  'unfinished-interfaces.v1.json': AI_OPS_ARTIFACTS.unfinishedInterfaces,
});

const mode = process.argv[2];
if (mode !== '--write' && mode !== '--check') {
  throw new TypeError('usage: node fixtures/aiOps/contracts/generate-artifacts.mjs --write|--check');
}

if (mode === '--write') await mkdir(fixtureDirectory, { recursive: true });
const mismatches = [];
for (const [fileName, artifact] of Object.entries(OUTPUTS)) {
  const outputPath = resolve(fixtureDirectory, fileName);
  const expected = `${JSON.stringify(artifact, null, 2)}\n`;
  if (mode === '--write') {
    await writeFile(outputPath, expected, 'utf8');
    continue;
  }
  let actual = null;
  try {
    actual = await readFile(outputPath, 'utf8');
  } catch {
    mismatches.push(`${fileName}:MISSING`);
    continue;
  }
  if (actual !== expected) mismatches.push(`${fileName}:DRIFT`);
}

if (mismatches.length > 0) {
  process.stderr.write(`${mismatches.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${mode === '--write' ? 'WROTE' : 'MATCHED'} ${Object.keys(OUTPUTS).length} AI Ops shadow artifacts\n`);
}
