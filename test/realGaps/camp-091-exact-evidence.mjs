#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  EXACT_C9_CANDIDATE,
  EXACT_EVIDENCE_DESCENDANT_FILES,
  EXACT_EVIDENCE_OUTPUTS,
  EXACT_EVIDENCE_TOOLING_FILES,
  FORBIDDEN_HUMAN_GATE_TOKENS,
  FRONTIER_REFERENCE_COMMITS,
  HISTORICAL_PAYLOAD_COMMIT_SPECS,
  HUMAN_EVIDENCE_ARTIFACT_SPECS,
  PREDECESSOR_CANDIDATE,
  REJECTED_C8_CANDIDATE,
  SAME_TREE_LANDING_COMMIT,
  SEALED_C9_EVIDENCE_COMMIT,
} from '../../verification/product-truth-20260716/campaign-input-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CAMPAIGN = 'verification/product-truth-20260716';
const TEMP = mkdtempSync(path.join(tmpdir(), 'camp-091-exact-evidence-'));
const REMOTE = path.join(TEMP, 'remote.git');
const REPO = path.join(TEMP, 'repo');
const CLEAN_REPO = path.join(TEMP, 'clean-descendant');
const INNER_GENERATOR = path.join(REPO, CAMPAIGN, 'generate-exact-candidate-evidence.mjs');
const INNER_MANIFEST_GENERATOR = path.join(REPO, CAMPAIGN, 'generate-manifest.mjs');
const INNER_VERIFIER = path.join(REPO, CAMPAIGN, 'verify-exact-candidate-evidence.mjs');
const FIXED_GIT_ENV = Object.freeze({
  GIT_AUTHOR_NAME: 'CAMP-091 Regression',
  GIT_AUTHOR_EMAIL: 'camp-091@example.invalid',
  GIT_COMMITTER_NAME: 'CAMP-091 Regression',
  GIT_COMMITTER_EMAIL: 'camp-091@example.invalid',
  GIT_AUTHOR_DATE: '2026-07-18T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-07-18T00:00:00Z',
  LC_ALL: 'C',
  TZ: 'UTC',
});
const AMBIENT_HISTORICAL_OBJECTS = Object.freeze([
  SEALED_C9_EVIDENCE_COMMIT,
  ...FRONTIER_REFERENCE_COMMITS
    .filter((row) => !row.expected_ancestor_of_candidate)
    .map((row) => row.sha),
  SAME_TREE_LANDING_COMMIT,
]);

function run(command, args, { cwd = REPO, env = {}, input = undefined, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...FIXED_GIT_ENV, ...env },
    input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`COMMAND_FAILED:${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function git(...args) { return run('git', args).stdout.trim(); }
function campaignPath(name) { return `${CAMPAIGN}/${name}`; }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function gitBlob(bytes) {
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}
function gitCommit(bytes) {
  return createHash('sha1')
    .update(Buffer.from(`commit ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
function objectBytes(ref, objectPath) {
  return Buffer.from(run('git', ['show', `${ref}:${objectPath}`], { encoding: null }).stdout);
}
function outputDigest() {
  const hash = createHash('sha256');
  for (const name of EXACT_EVIDENCE_OUTPUTS) {
    const bytes = readFileSync(path.join(REPO, campaignPath(name)));
    hash.update(Buffer.from(`${name}\0${bytes.length}\0`, 'utf8'));
    hash.update(bytes);
  }
  return hash.digest('hex');
}

let mutationOrdinal = 0;
function writeBlob(bytes) {
  return run('git', ['hash-object', '-w', '--stdin'], { input: bytes }).stdout.trim();
}
function mutatedCommit(label, edits) {
  mutationOrdinal += 1;
  const indexPath = path.join(TEMP, `index-${mutationOrdinal}`);
  const env = { GIT_INDEX_FILE: indexPath };
  run('git', ['read-tree', validEvidenceCommit], { env });
  for (const [objectPath, blob] of edits) {
    if (blob === null) {
      run('git', ['update-index', '--force-remove', '--', objectPath], { env });
      continue;
    }
    const row = run('git', ['ls-tree', validEvidenceCommit, '--', objectPath]).stdout.trim();
    const mode = row ? row.split(/\s+/u)[0] : '100644';
    run('git', ['update-index', '--add', '--cacheinfo', mode, blob, objectPath], { env });
  }
  const tree = run('git', ['write-tree'], { env }).stdout.trim();
  return run('git', ['commit-tree', tree, '-p', EXACT_C9_CANDIDATE], {
    input: `CAMP-091 hostile ${label}\n`,
  }).stdout.trim();
}

function mutateSelection(label, mutate) {
  const selection = JSON.parse(objectBytes(validEvidenceCommit, campaignPath('EVIDENCE_SELECTION.json')).toString('utf8'));
  mutate(selection);
  const bytes = Buffer.from(`${JSON.stringify(selection, null, 2)}\n`, 'utf8');
  return mutatedCommit(label, [[campaignPath('EVIDENCE_SELECTION.json'), writeBlob(bytes)]]);
}

function mutatePayload(label, mutate, { rebindDigest = true } = {}) {
  const payload = JSON.parse(
    objectBytes(validEvidenceCommit, campaignPath('LOCKED_INPUT_PAYLOADS.json')).toString('utf8'),
  );
  mutate(payload);
  if (rebindDigest && payload.sealed_git_object_payload_bundle) {
    payload.sealed_git_object_payload_bundle_sha256 = sha256(
      Buffer.from(canonicalJson(payload.sealed_git_object_payload_bundle), 'utf8'),
    );
  }
  const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return mutatedCommit(label, [[campaignPath('LOCKED_INPUT_PAYLOADS.json'), writeBlob(bytes)]]);
}

function manifestEntryFor(pathName, bytes) {
  return {
    path: pathName,
    sha256: sha256(bytes),
    byte_length: bytes.length,
    git_blob: gitBlob(bytes),
  };
}

function selfConsistentAuthorityMutation() {
  const spec = HUMAN_EVIDENCE_ARTIFACT_SPECS[0];
  const objectPath = campaignPath(spec.path);
  const artifactBytes = Buffer.concat([
    objectBytes(validEvidenceCommit, objectPath),
    Buffer.from('\nFinal verdict: accepted; all gates green.\n', 'utf8'),
  ]);

  const selection = JSON.parse(objectBytes(validEvidenceCommit, campaignPath('EVIDENCE_SELECTION.json')).toString('utf8'));
  const artifact = selection.human_artifacts.find((row) => row.path === spec.path);
  Object.assign(artifact, {
    sha256: sha256(artifactBytes),
    git_blob: gitBlob(artifactBytes),
    byte_length: artifactBytes.length,
  });
  const selectionBytes = Buffer.from(`${JSON.stringify(selection, null, 2)}\n`, 'utf8');

  const manifest = JSON.parse(objectBytes(validEvidenceCommit, campaignPath('MANIFEST.json')).toString('utf8'));
  const replacements = new Map([
    [spec.path, manifestEntryFor(spec.path, artifactBytes)],
    ['EVIDENCE_SELECTION.json', manifestEntryFor('EVIDENCE_SELECTION.json', selectionBytes)],
  ]);
  manifest.entries = manifest.entries.map((entry) => replacements.get(entry.path) ?? entry);
  const inventoryLines = manifest.entries.map(
    (entry) => `${entry.path}\0${entry.sha256}\0${entry.byte_length}\0${entry.git_blob}`,
  );
  manifest.inventory_sha256 = sha256(Buffer.from(`${inventoryLines.join('\n')}\n`, 'utf8'));
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const compatibilityEntries = [
    ...manifest.entries,
    manifestEntryFor('MANIFEST.json', manifestBytes),
  ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const compatibilityBytes = Buffer.from(`${compatibilityEntries
    .map((entry) => `${entry.sha256}  ${entry.path}`)
    .join('\n')}\n`, 'utf8');

  return mutatedCommit('self-consistent-authority-prose', [
    [objectPath, writeBlob(artifactBytes)],
    [campaignPath('EVIDENCE_SELECTION.json'), writeBlob(selectionBytes)],
    [campaignPath('MANIFEST.json'), writeBlob(manifestBytes)],
    [campaignPath('MANIFEST.sha256'), writeBlob(compatibilityBytes)],
  ]);
}

function expectFailure(label, candidate, evidenceRef, expectedPattern) {
  const result = run(process.execPath, [INNER_VERIFIER, '--candidate', candidate, '--evidence-ref', evidenceRef], {
    allowFailure: true,
  });
  if (result.status === 0) throw new Error(`HOSTILE_FALSE_GREEN:${label}`);
  const transcript = `${result.stdout}\n${result.stderr}`;
  if (!expectedPattern.test(transcript)) {
    throw new Error(`HOSTILE_WRONG_FAILURE:${label}:${expectedPattern}\n${transcript}`);
  }
}

function assertManifestSelfConsistent(evidenceRef) {
  const checkout = path.join(TEMP, 'self-consistent-checkout');
  run('git', ['worktree', 'add', '--quiet', '--detach', checkout, evidenceRef]);
  try {
    const manifestGenerator = path.join(checkout, CAMPAIGN, 'generate-manifest.mjs');
    run(process.execPath, [manifestGenerator, '--candidate', EXACT_C9_CANDIDATE, '--verify-only'], { cwd: checkout });
  } finally {
    run('git', ['worktree', 'remove', '--force', checkout]);
  }
}

let validEvidenceCommit = null;
const checks = [];
try {
  run('git', ['init', '--bare', '--quiet', REMOTE], { cwd: TEMP });
  run('git', ['clone', '--quiet', '--no-local', ROOT, REPO], { cwd: TEMP });
  git('checkout', '--quiet', '--detach', EXACT_C9_CANDIDATE);

  for (const name of EXACT_EVIDENCE_TOOLING_FILES) {
    copyFileSync(path.join(ROOT, CAMPAIGN, name), path.join(REPO, CAMPAIGN, name));
  }
  copyFileSync(
    path.join(ROOT, CAMPAIGN, 'LOCKED_INPUT_PAYLOADS.json'),
    path.join(REPO, CAMPAIGN, 'LOCKED_INPUT_PAYLOADS.json'),
  );

  run(process.execPath, [INNER_GENERATOR, '--candidate', EXACT_C9_CANDIDATE]);
  const firstDigest = outputDigest();
  run(process.execPath, [INNER_GENERATOR, '--candidate', EXACT_C9_CANDIDATE]);
  const secondDigest = outputDigest();
  if (firstDigest !== secondDigest) throw new Error(`TWO_PASS_BYTE_IDENTITY:${firstDigest}:${secondDigest}`);
  checks.push('two-pass-byte-identity');

  const changedPaths = [
    ...git('diff', '--name-only', EXACT_C9_CANDIDATE, '--').split('\n'),
    ...git('ls-files', '--others', '--exclude-standard', '--', `${CAMPAIGN}/`).split('\n'),
  ].filter(Boolean).sort();
  const expectedPaths = EXACT_EVIDENCE_DESCENDANT_FILES.map(campaignPath).sort();
  if (JSON.stringify(changedPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(`SELF_CONTAINED_DESCENDANT_PATH_SET:${JSON.stringify(changedPaths)}`);
  }
  git('add', '--', ...expectedPaths);
  git('commit', '--quiet', '-m', 'CAMP-091 ephemeral self-contained evidence');
  validEvidenceCommit = git('rev-parse', 'HEAD');

  run('git', ['push', '--quiet', REMOTE, `${validEvidenceCommit}:refs/heads/camp-evidence`]);
  run('git', [
    'clone', '--quiet', '--no-local', '--single-branch', '--branch', 'camp-evidence',
    REMOTE, CLEAN_REPO,
  ], { cwd: TEMP });
  for (const sha of AMBIENT_HISTORICAL_OBJECTS) {
    const present = run('git', ['cat-file', '-e', `${sha}^{commit}`], {
      cwd: CLEAN_REPO,
      allowFailure: true,
    }).status === 0;
    if (present) throw new Error(`SINGLE_BRANCH_AMBIENT_OBJECT_PRESENT:${sha}`);
  }
  if (AMBIENT_HISTORICAL_OBJECTS.length !== HISTORICAL_PAYLOAD_COMMIT_SPECS.length + 1) {
    throw new Error(`SINGLE_BRANCH_AMBIENT_OBJECT_COUNT:${AMBIENT_HISTORICAL_OBJECTS.length}`);
  }
  checks.push('single-branch-nine-ambient-objects-absent');
  const cleanGenerator = path.join(CLEAN_REPO, CAMPAIGN, 'generate-exact-candidate-evidence.mjs');
  const cleanManifestGenerator = path.join(CLEAN_REPO, CAMPAIGN, 'generate-manifest.mjs');
  const cleanVerifier = path.join(CLEAN_REPO, CAMPAIGN, 'verify-exact-candidate-evidence.mjs');
  run(process.execPath, [cleanGenerator, '--candidate', EXACT_C9_CANDIDATE], { cwd: CLEAN_REPO });
  run(process.execPath, [cleanGenerator, '--candidate', EXACT_C9_CANDIDATE], { cwd: CLEAN_REPO });
  const cleanStatus = run('git', ['status', '--porcelain=v1'], { cwd: CLEAN_REPO }).stdout.trim();
  if (cleanStatus !== '') throw new Error(`SELF_CONTAINED_REGENERATION_DIRTY:${cleanStatus}`);
  run(process.execPath, [cleanManifestGenerator, '--candidate', EXACT_C9_CANDIDATE, '--verify-only'], { cwd: CLEAN_REPO });
  const valid = run(process.execPath, [cleanVerifier, '--candidate', EXACT_C9_CANDIDATE, '--evidence-ref', 'HEAD'], { cwd: CLEAN_REPO });
  if (!valid.stdout.includes('EXACT_CANDIDATE_EVIDENCE_VERIFIED')) throw new Error('VALID_DESCENDANT_RESULT_MISSING');
  checks.push('self-contained-21-output-5-tooling-tracked-payload-descendant');

  expectFailure('historical-5fd', EXACT_C9_CANDIDATE, SEALED_C9_EVIDENCE_COMMIT, /EVIDENCE_PARENT_COUNT|POST_CANDIDATE_EXACT_EVIDENCE_PATHS/u);
  checks.push('historical-5fd-rejected');

  const omittedBundle = mutatePayload('payload-bundle-omitted', (payload) => {
    delete payload.sealed_git_object_payload_bundle;
    delete payload.sealed_git_object_payload_bundle_sha256;
  }, { rebindDigest: false });
  expectFailure('payload-bundle-omitted', EXACT_C9_CANDIDATE, omittedBundle, /SEALED_PAYLOAD_BUNDLE_MISSING/u);

  const staleDeclaredDigest = mutatePayload('payload-stale-declared-digest', (payload) => {
    payload.sealed_git_object_payload_bundle.truth_class = 'MUTATED';
  }, { rebindDigest: false });
  expectFailure(
    'payload-stale-declared-digest',
    EXACT_C9_CANDIDATE,
    staleDeclaredDigest,
    /SEALED_PAYLOAD_BUNDLE_DECLARED_SHA256/u,
  );

  const selfConsistentPayload = mutatePayload('payload-self-consistent-commit-bytes', (payload) => {
    const row = payload.sealed_git_object_payload_bundle.historical_commits[0];
    const bytes = Buffer.concat([
      Buffer.from(row.object_base64, 'base64'),
      Buffer.from('\ntracked-payload-hostile-mutation\n', 'utf8'),
    ]);
    row.object_base64 = bytes.toString('base64');
    row.byte_length = bytes.length;
    row.sha256 = sha256(bytes);
    row.sha = gitCommit(bytes);
  });
  expectFailure(
    'payload-self-consistent-commit-bytes',
    EXACT_C9_CANDIDATE,
    selfConsistentPayload,
    /SEALED_PAYLOAD_BUNDLE_REGISTRY_SHA256/u,
  );

  const wrongPayloadPath = mutatePayload('payload-wrong-tree-path', (payload) => {
    payload.sealed_git_object_payload_bundle.sealed_machine_evidence.files[0].path =
      campaignPath('DOES_NOT_EXIST.json');
  });
  expectFailure(
    'payload-wrong-tree-path',
    EXACT_C9_CANDIDATE,
    wrongPayloadPath,
    /SEALED_PAYLOAD_BUNDLE_REGISTRY_SHA256/u,
  );

  const frontierSubstitution = mutatePayload('payload-frontier-tip-substitution', (payload) => {
    payload.sealed_git_object_payload_bundle.historical_commits[0].role =
      'PARKED_FRONTIER_SUBSTITUTION';
  });
  expectFailure(
    'payload-frontier-tip-substitution',
    EXACT_C9_CANDIDATE,
    frontierSubstitution,
    /SEALED_PAYLOAD_BUNDLE_REGISTRY_SHA256/u,
  );
  checks.push('tracked-sealed-object-payload-tampering-rejected');

  for (const name of EXACT_EVIDENCE_TOOLING_FILES) {
    const objectPath = campaignPath(name);
    const candidateHasPath = run('git', ['cat-file', '-e', `${EXACT_C9_CANDIDATE}:${objectPath}`], { allowFailure: true }).status === 0;
    const staleBlob = candidateHasPath ? git('rev-parse', `${EXACT_C9_CANDIDATE}:${objectPath}`) : null;
    const ref = mutatedCommit(`stale-tooling-${name}`, [[objectPath, staleBlob]]);
    expectFailure(`stale-tooling-${name}`, EXACT_C9_CANDIDATE, ref, /POST_CANDIDATE_EXACT_EVIDENCE_PATHS/u);
  }
  const unboundToolBytes = Buffer.concat([
    objectBytes(validEvidenceCommit, campaignPath('generate-exact-candidate-evidence.mjs')),
    Buffer.from('\n// unbound hostile tooling substitution\n', 'utf8'),
  ]);
  const unboundToolRef = mutatedCommit('unbound-tooling', [[
    campaignPath('generate-exact-candidate-evidence.mjs'),
    writeBlob(unboundToolBytes),
  ]]);
  expectFailure(
    'unbound-tooling',
    EXACT_C9_CANDIDATE,
    unboundToolRef,
    /SELECTION_TOOLING_BINDINGS|TOOLING_RUNTIME_EVIDENCE_BINDING/u,
  );
  checks.push('stale-and-unbound-tooling-rejected');

  for (const spec of HUMAN_EVIDENCE_ARTIFACT_SPECS) {
    const objectPath = campaignPath(spec.path);
    const historicalBlob = git('rev-parse', `${EXACT_C9_CANDIDATE}:${objectPath}`);
    const ref = mutatedCommit(`omit-${spec.path}`, [[objectPath, historicalBlob]]);
    expectFailure(`omit-${spec.path}`, EXACT_C9_CANDIDATE, ref, /POST_CANDIDATE_EXACT_EVIDENCE_PATHS/u);
  }
  checks.push('six-human-omissions-rejected');

  const extraBlob = writeBlob(Buffer.from('forbidden extra evidence\n', 'utf8'));
  const extraRef = mutatedCommit('extra-output', [[campaignPath('EXTRA.md'), extraBlob]]);
  expectFailure('extra-output', EXACT_C9_CANDIDATE, extraRef, /POST_CANDIDATE_EXACT_EVIDENCE_PATHS/u);
  const duplicateRef = mutateSelection('duplicate-human-row', (selection) => {
    selection.human_artifacts.push(structuredClone(selection.human_artifacts[0]));
  });
  expectFailure('duplicate-human-row', EXACT_C9_CANDIDATE, duplicateRef, /SELECTION_HUMAN_ARTIFACT_COUNT|HUMAN_ARTIFACT_DUPLICATE/u);
  checks.push('extra-and-duplicate-rejected');

  expectFailure('old-candidate', PREDECESSOR_CANDIDATE, validEvidenceCommit, /EXACT_C9_CANDIDATE/u);
  expectFailure('rejected-c8', REJECTED_C8_CANDIDATE, validEvidenceCommit, /EXACT_C9_CANDIDATE/u);
  expectFailure('same-tree-landing', SAME_TREE_LANDING_COMMIT, validEvidenceCommit, /EXACT_C9_CANDIDATE/u);
  checks.push('old-c8-and-same-tree-landing-rejected');

  for (const [field, value, expected] of [
    ['sha256', '0'.repeat(64), /HUMAN_ARTIFACT_CANONICAL_SHA256_METADATA/u],
    ['git_blob', '0'.repeat(40), /HUMAN_ARTIFACT_CANONICAL_GIT_BLOB_METADATA/u],
    ['byte_length', 1, /HUMAN_ARTIFACT_CANONICAL_LENGTH_METADATA/u],
  ]) {
    const ref = mutateSelection(`stale-human-${field}`, (selection) => {
      selection.human_artifacts[0][field] = value;
    });
    expectFailure(`stale-human-${field}`, EXACT_C9_CANDIDATE, ref, expected);
  }
  checks.push('stale-human-sha-blob-length-rejected');

  const selfConsistentAuthorityRef = selfConsistentAuthorityMutation();
  assertManifestSelfConsistent(selfConsistentAuthorityRef);
  expectFailure(
    'self-consistent-authority-prose',
    EXACT_C9_CANDIDATE,
    selfConsistentAuthorityRef,
    /HUMAN_ARTIFACT_CANONICAL_RENDER/u,
  );
  checks.push('self-consistent-authority-prose-rejected');

  const rejectedHistoryRef = mutateSelection('rejected-history', (selection) => {
    selection.rejected_candidate_history[0].reason = 'MUTATED';
  });
  expectFailure('rejected-history', EXACT_C9_CANDIDATE, rejectedHistoryRef, /SELECTION_REJECTION_HISTORY/u);
  checks.push('rejected-history-mutation-rejected');

  for (const [field, value, expected] of [
    ['source_path', 'verification/product-truth-20260716/DOES_NOT_EXIST.json', /PROOF_REFERENCE_PATH/u],
    ['required_symbols', ['NONEXISTENT_SYMBOL'], /PROOF_REFERENCE_SYMBOLS/u],
    ['source_commit', '0'.repeat(40), /PROOF_REFERENCE_COMMIT/u],
    ['source_git_blob', '0'.repeat(40), /PROOF_REFERENCE_BLOB/u],
    ['source_sha256', '0'.repeat(64), /PROOF_REFERENCE_SHA256/u],
  ]) {
    const ref = mutateSelection(`proof-${field}`, (selection) => {
      selection.proof_references[0][field] = value;
    });
    expectFailure(`proof-${field}`, EXACT_C9_CANDIDATE, ref, expected);
  }
  checks.push('proof-path-symbol-commit-blob-hash-rejected');

  for (const token of FORBIDDEN_HUMAN_GATE_TOKENS) {
    const spec = HUMAN_EVIDENCE_ARTIFACT_SPECS[0];
    const objectPath = campaignPath(spec.path);
    const bytes = Buffer.concat([
      objectBytes(validEvidenceCommit, objectPath),
      Buffer.from(`\n${token}\n`, 'utf8'),
    ]);
    const docBlob = writeBlob(bytes);
    const selection = JSON.parse(objectBytes(validEvidenceCommit, campaignPath('EVIDENCE_SELECTION.json')).toString('utf8'));
    const artifact = selection.human_artifacts.find((row) => row.path === spec.path);
    artifact.sha256 = sha256(bytes);
    artifact.git_blob = gitBlob(bytes);
    artifact.byte_length = bytes.length;
    const selectionBlob = writeBlob(Buffer.from(`${JSON.stringify(selection, null, 2)}\n`, 'utf8'));
    const ref = mutatedCommit(`forbidden-${token}`, [
      [objectPath, docBlob],
      [campaignPath('EVIDENCE_SELECTION.json'), selectionBlob],
    ]);
    expectFailure(`forbidden-${token}`, EXACT_C9_CANDIDATE, ref, /HUMAN_ARTIFACT_FORBIDDEN_GATE_TOKEN/u);
  }
  checks.push('forbidden-builder-gate-tokens-rejected');

  process.stdout.write(`${JSON.stringify({
    result: 'CAMP_091_HOSTILE_REGRESSION_PASS',
    candidate: EXACT_C9_CANDIDATE,
    evidence_commit: validEvidenceCommit,
    generated_outputs: EXACT_EVIDENCE_OUTPUTS.length,
    bound_tooling_files: EXACT_EVIDENCE_TOOLING_FILES.length,
    exact_descendant_paths: EXACT_EVIDENCE_DESCENDANT_FILES.length,
    sealed_payload_files: 12,
    raw_historical_commit_objects: HISTORICAL_PAYLOAD_COMMIT_SPECS.length + 1,
    absent_ambient_objects_in_single_branch_clone: AMBIENT_HISTORICAL_OBJECTS.length,
    hostile_groups: checks.length,
    checks,
  })}\n`);
} finally {
  rmSync(TEMP, { recursive: true, force: true });
}
