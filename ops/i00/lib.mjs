import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function fail(message, code = 1) {
  process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`);
  process.exit(code);
}

export function readJson(path, label = path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function isFullSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

export function isUtc(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function parseArgs(argv, flags = new Set()) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) fail(`unexpected argument ${key}`);
    if (flags.has(key) || flags.has(key.slice(2))) {
      out[key.slice(2)] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${key} requires a value`);
    out[key.slice(2)] = value;
    index += 1;
  }
  return out;
}

export function listRegularFiles(root, relative = '') {
  const absolute = resolve(root, relative);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) fail(`symlink is forbidden in release material: ${relative || '.'}`);
  if (stat.isFile()) return [relative];
  if (!stat.isDirectory()) fail(`unsupported release entry: ${relative || '.'}`);
  return readdirSync(absolute).sort().flatMap((name) => (
    listRegularFiles(root, relative ? `${relative}/${name}` : name)
  ));
}

export function treeDigest(root) {
  const hash = createHash('sha256');
  for (const file of listRegularFiles(root)) {
    hash.update(file);
    hash.update('\0');
    hash.update(sha256File(resolve(root, file)));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function listTypedEntries(root, relative = '') {
  const absolute = resolve(root, relative);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) fail(`symlink is forbidden in typed tree: ${relative || '.'}`);
  if (stat.isFile()) return [{ path: relative, type: 'file', stat }];
  if (!stat.isDirectory()) fail(`unsupported typed-tree entry: ${relative || '.'}`);
  return readdirSync(absolute).sort().flatMap((name) => {
    const next = relative ? `${relative}/${name}` : name;
    const child = lstatSync(resolve(root, next));
    if (child.isSymbolicLink()) fail(`symlink is forbidden in typed tree: ${next}`);
    if (child.isFile()) return [{ path: next, type: 'file', stat: child }];
    if (child.isDirectory()) {
      return [{ path: next, type: 'directory', stat: child }, ...listTypedEntries(root, next)];
    }
    fail(`unsupported typed-tree entry: ${next}`);
  });
}

export function typedTreeDigest(root, { excludeTopLevel = [] } = {}) {
  const excluded = new Set(excludeTopLevel);
  const hash = createHash('sha256');
  const entries = listTypedEntries(root).filter((entry) => !excluded.has(entry.path.split('/')[0]));
  for (const entry of entries) {
    if (entry.type === 'directory') {
      hash.update('directory\0');
      hash.update(entry.path);
      hash.update('\n');
      continue;
    }
    const { path: file, stat } = entry;
    const mode = stat.mode & 0o7777;
    if ((mode & 0o7000) !== 0) fail(`unsafe special mode in typed tree: ${file}`);
    const executableBits = mode & 0o111;
    if (executableBits !== 0 && executableBits !== 0o111) {
      fail(`ambiguous executable mode in typed tree: ${file}`);
    }
    const normalizedMode = executableBits === 0o111 ? '100755' : '100644';
    hash.update(file);
    hash.update('\0');
    hash.update(normalizedMode);
    hash.update('\0');
    hash.update(sha256File(resolve(root, file)));
    hash.update('\n');
  }
  return hash.digest('hex');
}

export function requireKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of keys) {
    if (!(key in value)) fail(`${label}.${key} is required`);
  }
}

export function requireExactKeys(value, keys, label) {
  requireKeys(value, keys, label);
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} has an unexpected field set`);
  }
}

export function hasPlaceholder(value) {
  return /REPLACE_ME|CHANGEME|example\.com|000000000000/.test(String(value));
}

// The exact release.json field set. Exported so the operator-facing preflight
// and the release validator can never drift apart — the R1 finding was
// precisely that the two commands disagreed about what a release is.
export const RELEASE_KEYS = Object.freeze([
  'releaseId', 'gitSha', 'testedSha', 'builtAtUtc', 'schemaVersion', 'rollbackBarrier',
  'rollbackFloor', 'compatibilitySource', 'compatibilitySourceSha256',
  'configRevision', 'modelRevision', 'testedReceipt', 'testedReceiptSha256', 'acceptanceEvidence',
  'activationState', 'sourceTree', 'sourceVerification', 'packageLockSha256',
  'runtimeDepsDigestSha256', 'serverDistDigestSha256', 'webDistDigestSha256',
  'runtimeDependencies', 'l15OpsProvenance', 'buildAttestation',
]);

// The artifact-manifest verification core shared by validate-release.mjs and
// preflight.mjs: exact key sets, identity match against release.json,
// provenance equality, path-set equality, per-file sha256 + mode, build-tree
// digest equality, and a TOCTOU re-read. One implementation on purpose — a
// second copy would re-create the divergence this closes. Deeper provenance
// (build-attestation verification, compiled-ledger compatibility) stays in
// validate-release.mjs.
export function verifyArtifactManifest(root, preloadedRelease = null) {
  const release = preloadedRelease ?? readJson(resolve(root, 'release.json'), 'release.json');
  requireExactKeys(release, RELEASE_KEYS, 'release.json');
  const manifestPath = resolve(root, 'artifact-manifest.json');
  let manifestBytes;
  let manifest;
  try {
    manifestBytes = readFileSync(manifestPath);
    manifest = JSON.parse(manifestBytes);
  } catch (error) {
    fail(`artifact-manifest.json is unreadable or invalid JSON: ${error.message}`);
  }
  const artifactManifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
  requireExactKeys(manifest, [
    'schemaVersion', 'releaseId', 'testedSha', 'testedBuildOutputs',
    'acceptanceEvidence', 'l15OpsProvenance', 'ledgerCompatibility', 'buildAttestation', 'files',
  ], 'artifact manifest');
  requireExactKeys(manifest.testedBuildOutputs, ['serverDistDigestSha256', 'webDistDigestSha256'], 'artifact manifest.testedBuildOutputs');
  requireExactKeys(manifest.ledgerCompatibility, [
    'schemaVersion', 'rollbackFloor', 'rollbackBarrier',
    'compatibilitySource', 'compatibilitySourceSha256',
  ], 'artifact manifest.ledgerCompatibility');
  if (manifest.schemaVersion !== 1) fail('artifact manifest schemaVersion must be 1');
  if (manifest.releaseId !== release.releaseId || manifest.testedSha !== release.testedSha) fail('artifact manifest identity mismatch');
  if (JSON.stringify(manifest.acceptanceEvidence) !== JSON.stringify(release.acceptanceEvidence)) {
    fail('artifact manifest acceptance evidence does not match release provenance');
  }
  if (JSON.stringify(manifest.l15OpsProvenance) !== JSON.stringify(release.l15OpsProvenance)) {
    fail('artifact manifest effective L15 provenance does not match release provenance');
  }
  if (JSON.stringify(manifest.buildAttestation) !== JSON.stringify(release.buildAttestation)) {
    fail('artifact manifest build attestation does not match release provenance');
  }
  if (manifest.testedBuildOutputs.serverDistDigestSha256 !== release.serverDistDigestSha256
      || manifest.testedBuildOutputs.webDistDigestSha256 !== release.webDistDigestSha256) {
    fail('artifact manifest build-output digests do not match release provenance');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail('artifact manifest files must be non-empty');
  const actualFiles = listRegularFiles(root).filter((file) => file !== 'artifact-manifest.json');
  const declared = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]));
  if (declared.size !== actualFiles.length || actualFiles.some((file) => !declared.has(file))) {
    fail('artifact manifest path set does not match the release');
  }
  for (const file of actualFiles) {
    const entry = manifest.files.find((candidate) => candidate.path === file);
    if (sha256File(resolve(root, file)) !== entry.sha256 || (lstatSync(resolve(root, file)).mode & 0o777) !== entry.mode) {
      fail(`artifact digest/mode mismatch: ${file}`);
    }
  }
  if (treeDigest(resolve(root, 'server/dist')) !== release.serverDistDigestSha256
      || treeDigest(resolve(root, 'web/dist')) !== release.webDistDigestSha256) {
    fail('release build-output trees do not match tested provenance');
  }
  if (sha256File(manifestPath) !== artifactManifestSha256) {
    fail('artifact manifest changed during validation');
  }
  return { release, manifest, artifactManifestSha256, fileCount: actualFiles.length };
}
