#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  C9_CORRECTION_GRANTS,
  D_LAUNCH_65_AUTHORITY as D_LAUNCH_65,
  EXACT_C9_CANDIDATE,
  EXACT_C9_TREE,
  EXACT_EVIDENCE_DESCENDANT_FILES,
  EXACT_EVIDENCE_OUTPUTS,
  EXACT_EVIDENCE_PROOF_REFERENCES,
  EXACT_EVIDENCE_TOOLING_FILES,
  FORBIDDEN_HUMAN_GATE_TOKENS,
  HUMAN_EVIDENCE_ARTIFACT_SPECS,
  LOCK_INVENTORY_MATRIX_REQUIREMENT_ID,
  REJECTED_C8_CANDIDATE,
  REJECTED_C8_TREE,
  REJECTED_CANDIDATE_SHAS,
  REJECTED_SELECTION_HISTORY,
  REQUIRED_C2_PARENT,
  SAME_TREE_LANDING_COMMIT,
  SEALED_C9_EVIDENCE_COMMIT,
  SEALED_C9_EVIDENCE_TREE,
} from './campaign-input-registry.mjs';
import { renderCanonicalHumanArtifact } from './human-evidence-renderer.mjs';

const REJECTED_PREDECESSOR_FRAGMENT = '41752d6';
const ABSENT_CANDIDATE_PATH_PREFIXES = Object.freeze([
  'ops/aiOps/sentinel/',
  'server/src/aiOps/verifier/',
  'frontier/',
]);
const FRONTIER_REFERENCE_COMMITS = Object.freeze([
  Object.freeze({
    sha: 'f0168cb37bd04d21bc90591ab2256770de3b75bc',
    role: 'ACCEPTED_PRE_FRONTIER_BASE_WITH_ZERO_FRONTIER_PATHS',
    expected_ancestor_of_candidate: true,
  }),
  Object.freeze({
    sha: '887221418345ad54d7b98881b359fab85a6188e6',
    role: 'PARKED_FRONTIER_COORDINATOR_TIP',
    expected_ancestor_of_candidate: false,
  }),
  Object.freeze({
    sha: 'e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5',
    role: 'PARKED_FRONTIER_F0_DOCK_TIP',
    expected_ancestor_of_candidate: false,
  }),
  Object.freeze({
    sha: 'e435c1f0c6850b2c53501d3410dd5ce92b64b286',
    role: 'PARKED_FRONTIER_F1_VENUE_MESH_TIP',
    expected_ancestor_of_candidate: false,
  }),
  Object.freeze({
    sha: '56a08f4efb3f1b82205c4265c1dd18bbd1a70209',
    role: 'PARKED_FRONTIER_F2_PORTFOLIO_LAB_TIP',
    expected_ancestor_of_candidate: false,
  }),
  Object.freeze({
    sha: '3c9c794e88513bee340f336c5fc4d2dd8eebf47e',
    role: 'PARKED_FRONTIER_F3_STRATEGY_ARENA_TIP',
    expected_ancestor_of_candidate: false,
  }),
  Object.freeze({
    sha: '7a658b9850f743b944c35253568ae4a231a768b0',
    role: 'PARKED_FRONTIER_F8_EDGE_METER_TIP',
    expected_ancestor_of_candidate: false,
  }),
  Object.freeze({
    sha: '2c29de4e4d01e8087c00e79f180b731790943baa',
    role: 'PARKED_FRONTIER_F13_DECISION_LAB_BLOCKED_TIP',
    expected_ancestor_of_candidate: false,
  }),
]);
const CAMPAIGN_ROOT = 'verification/product-truth-20260716';
const EXACT_EVIDENCE_PATHS = Object.freeze(EXACT_EVIDENCE_DESCENDANT_FILES.map(
  (name) => `${CAMPAIGN_ROOT}/${name}`,
));
if (resolve(dirname(fileURLToPath(import.meta.url))) !== resolve(process.cwd(), CAMPAIGN_ROOT)) {
  throw new Error('VERIFIER_MUST_RUN_FROM_TARGET_REPOSITORY_TOOLING');
}

const MATRIX_SPECS = Object.freeze([
  Object.freeze({ file: 'DIRECTIVE_COVERAGE_MATRIX.csv', count: 153, identity: ['requirement_id'] }),
  Object.freeze({ file: 'CAPABILITY_TRUTH_MATRIX.csv', count: 23, identity: ['capability_id'] }),
  Object.freeze({ file: 'COCKPIT_BINDING_MATRIX.csv', count: 178, identity: ['surface_id', 'field_id'] }),
]);

const GENERATED_ACTIVE_ARTIFACTS = EXACT_EVIDENCE_OUTPUTS;

const argv = process.argv.slice(2);
function option(name, fallback = null) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`OPTION_VALUE_REQUIRED:${name}`);
  return value;
}

const requestedCandidate = option('--candidate');
const requestedEvidenceRef = option('--evidence-ref', 'HEAD');
if (!/^[a-f0-9]{40}$/u.test(requestedCandidate ?? '')) {
  throw new Error('EXACT_FULL_CANDIDATE_SHA_REQUIRED');
}

function runGit(args, { allowFailure = false, encoding = 'utf8' } = {}) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
      TZ: 'UTC',
    },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`GIT_COMMAND_FAILED:${args.join(' ')}:${String(result.stderr).trim()}`);
  }
  return result;
}

function gitText(...args) {
  return String(runGit(args).stdout).trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(label, actual, expected) {
  const equal = (actual !== null && typeof actual === 'object')
    || (expected !== null && typeof expected === 'object')
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : actual === expected;
  if (!equal) {
    throw new Error(`${label}:EXPECTED=${JSON.stringify(expected)}:ACTUAL=${JSON.stringify(actual)}`);
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitBlobOid(bytes) {
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8'))
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

function treeBlobMap(ref) {
  const records = Buffer.from(runGit(['ls-tree', '-r', '-z', ref], { encoding: null }).stdout)
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const blobs = new Map();
  for (const record of records) {
    const separator = record.indexOf('\t');
    assert(separator > 0, `LS_TREE_RECORD_INVALID:${ref}`);
    const [mode, type, oid] = record.slice(0, separator).split(/\s+/u);
    const path = record.slice(separator + 1);
    assert(mode && type === 'blob' && /^[a-f0-9]{40}$/u.test(oid) && path, `LS_TREE_BLOB_INVALID:${ref}:${path}`);
    blobs.set(path, oid);
  }
  return blobs;
}

function latestCommitForPath(ref, path) {
  const commit = gitText('log', '-1', '--format=%H', ref, '--', path);
  assert(/^[a-f0-9]{40}$/u.test(commit), `LATEST_PATH_COMMIT_MISSING:${path}`);
  return commit;
}

function grantCoversPath(grant, path) {
  return grant.endsWith('/') ? path.startsWith(grant) : path === grant;
}

function campaignPath(relativePath) {
  assert(
    typeof relativePath === 'string'
      && relativePath.length > 0
      && !relativePath.startsWith('/')
      && !relativePath.split('/').includes('..'),
    `UNSAFE_CAMPAIGN_PATH:${String(relativePath)}`,
  );
  return `${CAMPAIGN_ROOT}/${relativePath}`;
}

const candidate = gitText('rev-parse', `${requestedCandidate}^{commit}`);
assertEqual('CANDIDATE_SHA', candidate, requestedCandidate);
assertEqual('EXACT_C9_CANDIDATE', candidate, EXACT_C9_CANDIDATE);
assert(!REJECTED_CANDIDATE_SHAS.includes(candidate), `REJECTED_CANDIDATE_RELABEL_ATTEMPT:${candidate}`);
const candidateTree = gitText('rev-parse', `${candidate}^{tree}`);
assertEqual('EXACT_C9_TREE', candidateTree, EXACT_C9_TREE);
const parentRecord = gitText('rev-list', '--parents', '-n', '1', candidate).split(/\s+/u);
assertEqual('CANDIDATE_PARENT_COUNT', parentRecord.length - 1, 1);
assertEqual('CANDIDATE_SOLE_DIRECT_PARENT', parentRecord[1], REQUIRED_C2_PARENT);
assert(
  String(runGit(['show', `${candidate}:STATE.md`]).stdout).includes('| Account A correction candidate C9 |'),
  'C9_SOURCE_STATE_MARKER_MISSING',
);
assertEqual('SEALED_C9_EVIDENCE_COMMIT', gitText('rev-parse', `${SEALED_C9_EVIDENCE_COMMIT}^{commit}`), SEALED_C9_EVIDENCE_COMMIT);
assertEqual('SEALED_C9_EVIDENCE_TREE', gitText('rev-parse', `${SEALED_C9_EVIDENCE_COMMIT}^{tree}`), SEALED_C9_EVIDENCE_TREE);
assertEqual('SAME_TREE_LANDING_TREE', gitText('rev-parse', `${SAME_TREE_LANDING_COMMIT}^{tree}`), EXACT_C9_TREE);
const evidenceCommit = gitText('rev-parse', `${requestedEvidenceRef}^{commit}`);
const evidenceParentRecord = gitText('rev-list', '--parents', '-n', '1', evidenceCommit).split(/\s+/u);
assertEqual('EVIDENCE_PARENT_COUNT', evidenceParentRecord.length - 1, 1);
assertEqual('EVIDENCE_SOLE_DIRECT_PARENT', evidenceParentRecord[1], candidate);
assertEqual(
  'CANDIDATE_ANCESTOR_OF_EVIDENCE_REF',
  runGit(['merge-base', '--is-ancestor', candidate, evidenceCommit], { allowFailure: true }).status,
  0,
);
const postCandidatePaths = gitText('diff', '--name-only', candidate, evidenceCommit, '--')
  .split('\n')
  .filter(Boolean)
  .sort();
assertEqual('POST_CANDIDATE_EXACT_EVIDENCE_PATHS', postCandidatePaths, [...EXACT_EVIDENCE_PATHS].sort());

function objectBytes(ref, path) {
  const result = runGit(['show', `${ref}:${path}`], { encoding: null });
  return Buffer.from(result.stdout);
}

function evidenceBytes(relativePath) {
  return objectBytes(evidenceCommit, campaignPath(relativePath));
}

function evidenceText(relativePath) {
  return evidenceBytes(relativePath).toString('utf8');
}

function evidenceJson(relativePath) {
  try {
    return JSON.parse(evidenceText(relativePath));
  } catch (error) {
    throw new Error(`INVALID_JSON:${relativePath}:${error.message}`);
  }
}

function getPath(value, dottedPath) {
  return dottedPath.split('.').reduce(
    (current, segment) => (current !== null && typeof current === 'object'
      ? current[segment]
      : undefined),
    value,
  );
}

function firstDefined(value, paths) {
  for (const path of paths) {
    const found = getPath(value, path);
    if (found !== undefined && found !== null) return found;
  }
  return undefined;
}

function candidateBinding(value) {
  let directCandidate = firstDefined(value, [
    'candidate_sha',
    'source_candidate',
    'exact_candidate_sha',
    'candidate.commit',
    'candidate.sha',
    'candidate_binding.exact_candidate_sha',
    'receipt.exact_candidate_sha',
  ]);
  if (directCandidate === undefined && typeof value?.candidate === 'string') {
    directCandidate = value.candidate;
  }
  const directTree = firstDefined(value, [
    'candidate_tree_sha',
    'candidate_tree',
    'source_candidate_tree',
    'exact_candidate_tree',
    'candidate.tree',
    'candidate_binding.exact_candidate_tree',
  ]);
  return { candidate: directCandidate, tree: directTree };
}

function assertCandidateBound(label, value) {
  const binding = candidateBinding(value);
  assertEqual(`${label}_CANDIDATE`, binding.candidate, candidate);
  assertEqual(`${label}_TREE`, binding.tree, candidateTree);
}

function assertRecursiveExactBindings(label, value) {
  const candidateKeys = new Set([
    'candidate_sha',
    'exact_candidate_sha',
    'candidate_commit',
  ]);
  const treeKeys = new Set([
    'candidate_tree',
    'candidate_tree_sha',
    'source_candidate_tree',
    'exact_candidate_tree',
  ]);
  const parentKeys = new Set([
    'candidate_parent',
    'candidate_parent_sha',
    'source_candidate_parent',
    'direct_parent_sha',
    'required_c2_parent_sha',
  ]);
  function visit(node, path = label) {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, entry] of Object.entries(node)) {
      if (candidateKeys.has(key)) assertEqual(`${path}.${key}`, entry, candidate);
      if (treeKeys.has(key)) assertEqual(`${path}.${key}`, entry, candidateTree);
      if (parentKeys.has(key)) assertEqual(`${path}.${key}`, entry, REQUIRED_C2_PARENT);
      visit(entry, `${path}.${key}`);
    }
  }
  visit(value);
}

for (const relativePath of GENERATED_ACTIVE_ARTIFACTS) {
  const text = evidenceText(relativePath);
  if (text.includes('SELF_COMMIT_UNBOUND')) {
    throw new Error(`UNBOUND_SELF_COMMIT_PLACEHOLDER:${relativePath}`);
  }
  if (text.includes(REJECTED_PREDECESSOR_FRAGMENT)) {
    throw new Error(`REJECTED_PREDECESSOR_PRESENT:${relativePath}`);
  }
  if (/C2_NOT_YET_FROZEN|exact-C2|EXACT_C2_/u.test(text)) {
    throw new Error(`STALE_EXACT_C2_CANDIDATE_TRUTH:${relativePath}`);
  }
}

const inputLock = evidenceJson('INPUTS.lock');
const proofBinding = evidenceJson('C2_PROOF_BINDING.json');
const evidenceSelection = evidenceJson('EVIDENCE_SELECTION.json');
const mergeProvenance = evidenceJson('MERGE_PROVENANCE.json');
const census = evidenceJson('WORKTREE_CENSUS.json');
const payloadMetadata = evidenceJson('LOCKED_INPUT_PAYLOADS.json');
const manifest = evidenceJson('MANIFEST.json');
const aiOpsDisposition = evidenceJson('AI_OPS_C2_DISPOSITION.json');
const independentFindings = evidenceJson('INDEPENDENT_FINDINGS.json');
const productAssuranceDisposition = evidenceJson('PRODUCT_ASSURANCE_C2_DISPOSITION.json');

for (const [label, artifact] of [
  ['INPUTS_LOCK', inputLock],
  ['C2_PROOF_BINDING', proofBinding],
  ['EVIDENCE_SELECTION', evidenceSelection],
  ['MERGE_PROVENANCE', mergeProvenance],
  ['WORKTREE_CENSUS', census],
  ['LOCKED_INPUT_PAYLOADS', payloadMetadata],
  ['MANIFEST', manifest],
  ['AI_OPS_C2_DISPOSITION', aiOpsDisposition],
  ['INDEPENDENT_FINDINGS', independentFindings],
  ['PRODUCT_ASSURANCE_C2_DISPOSITION', productAssuranceDisposition],
]) {
  assertCandidateBound(label, artifact);
  assertRecursiveExactBindings(label, artifact);
}
assertEqual('INPUT_LOCK_SCHEMA', inputLock.schema, 'product-truth-inputs-lock.v4');
assertEqual('INPUT_LOCK_BINDING', inputLock.binding, 'EXACT_CANDIDATE');
assertEqual('INPUT_LOCK_CANDIDATE', inputLock.candidate, candidate);
assertEqual('INPUT_LOCK_TREE', inputLock.candidate_tree, candidateTree);
assertEqual('INPUT_LOCK_PARENT', inputLock.candidate_parent, REQUIRED_C2_PARENT);
assertEqual('INPUT_LOCK_BRANCH', inputLock.candidate_branch, 'truth-campaign-20260716');
assertEqual(
  'INPUT_LOCK_INVENTORY_COUNTS',
  inputLock.inventory_counts,
  {
    controlling_external: 17,
    candidate_tracked_law_and_locks: 14,
    defect_wave_inputs: 4,
    superseded_available: 18,
    superseded_named_absent: 8,
    external_payload_backed: 23,
    total_locked_inputs: 61,
  },
);
assertEqual('SELECTION_CANDIDATE', evidenceSelection.source_candidate, candidate);
assertEqual('SELECTION_TREE', evidenceSelection.source_candidate_tree, candidateTree);
assertEqual('SELECTION_PARENT', evidenceSelection.source_candidate_parent, REQUIRED_C2_PARENT);
assertEqual('SELECTION_SCHEMA', evidenceSelection.schema, 'product-truth-c9-evidence-selection.v4');
assertEqual('SELECTION_BINDING', evidenceSelection.binding, 'EXACT_CANDIDATE_GENERATED_ARTIFACTS_AND_SELF_CONTAINED_TOOLING');
assertEqual(
  'SELECTION_RULE',
  evidenceSelection.selection_rule,
  'Select only the registry-bound exact C9 commit and a sole evidence descendant whose post-C9 diff equals 21 generated artifacts plus the exact five-file executable tooling package; generation and verification must run from that descendant tooling.',
);
assertEqual('SELECTION_VALID_CHAIN', evidenceSelection.valid_chain, 'C2 -> exact C9 -> sole self-contained evidence descendant; candidate source stays immutable');
assertEqual(
  'SELECTION_POST_CANDIDATE_ALLOWLIST',
  [...evidenceSelection.post_candidate_path_allowlist].sort(),
  [...EXACT_EVIDENCE_PATHS].sort(),
);
assertEqual('SELECTION_GENERATED_OUTPUT_COUNT', evidenceSelection.exact_generated_output_count, EXACT_EVIDENCE_OUTPUTS.length);
assertEqual('SELECTION_GENERATED_OUTPUTS', evidenceSelection.exact_generated_outputs, [...EXACT_EVIDENCE_OUTPUTS]);
assertEqual('SELECTION_TOOLING_FILE_COUNT', evidenceSelection.exact_tooling_file_count, EXACT_EVIDENCE_TOOLING_FILES.length);
assertEqual('SELECTION_TOOLING_FILES', evidenceSelection.exact_tooling_files, [...EXACT_EVIDENCE_TOOLING_FILES]);
assertEqual('SELECTION_DESCENDANT_PATH_COUNT', evidenceSelection.exact_descendant_path_count, EXACT_EVIDENCE_DESCENDANT_FILES.length);
assertEqual('SELECTION_REQUIRED_BINDING', evidenceSelection.required_binding, 'product-truth-manifest.v4 plus MANIFEST.sha256 plus exact tooling bundle');
assertEqual('SELECTION_FINAL_HANDOFF', evidenceSelection.final_verifier_handoff, 'PENDING_FRESH_VERIFIER');
const evidenceToolingBindings = EXACT_EVIDENCE_TOOLING_FILES.map((name) => {
  const bytes = evidenceBytes(name);
  return {
    path: name,
    sha256: sha256(bytes),
    git_blob: gitBlobOid(bytes),
    byte_length: bytes.length,
  };
});
const runtimeToolingBindings = EXACT_EVIDENCE_TOOLING_FILES.map((name) => {
  const bytes = readFileSync(resolve(process.cwd(), CAMPAIGN_ROOT, name));
  return {
    path: name,
    sha256: sha256(bytes),
    git_blob: gitBlobOid(bytes),
    byte_length: bytes.length,
  };
});
assertEqual('SELECTION_TOOLING_BINDINGS', evidenceSelection.tooling_bindings, evidenceToolingBindings);
assertEqual('TOOLING_RUNTIME_EVIDENCE_BINDING', runtimeToolingBindings, evidenceToolingBindings);
assertEqual(
  'SELECTION_TOOLING_BUNDLE_SHA256',
  evidenceSelection.tooling_bundle_sha256,
  sha256(Buffer.from(canonicalJson(evidenceToolingBindings), 'utf8')),
);
assertEqual('SELECTION_SEALED_SOURCE', evidenceSelection.sealed_machine_evidence_source, {
  commit: SEALED_C9_EVIDENCE_COMMIT,
  tree: SEALED_C9_EVIDENCE_TREE,
  state: 'HISTORICAL_EXACT_C9_MACHINE_EVIDENCE_SOURCE',
});
assertEqual('SELECTION_SAME_TREE_LANDING', evidenceSelection.same_tree_landing, {
  commit: SAME_TREE_LANDING_COMMIT,
  tree: EXACT_C9_TREE,
  disposition: 'NOT_CANDIDATE_TRUTH_SAME_TREE_COMMIT_IDENTITY_IS_INSUFFICIENT',
});
assertEqual('SELECTION_REJECTION_HISTORY', evidenceSelection.rejected_candidate_history, REJECTED_SELECTION_HISTORY);
assertEqual('SELECTION_REJECTED_C8', evidenceSelection.prior_candidate_sha, REJECTED_C8_CANDIDATE);
assertEqual('SELECTION_REJECTED_C8_TREE', evidenceSelection.prior_candidate_tree, REJECTED_C8_TREE);
assertEqual(
  'SELECTION_REJECTED_C8_DISPOSITION',
  evidenceSelection.prior_candidate_disposition,
  'C8_REJECTED_BY_EXACT_CENSUS_NON_IDEMPOTENCE_AUDIT',
);
assertEqual('SELECTION_REJECTED_C7', evidenceSelection.c7_candidate_sha, 'a283eb859ec1142aadecbd64e0b84959535f6216');
assertEqual(
  'SELECTION_REJECTED_C7_DISPOSITION',
  evidenceSelection.c7_candidate_disposition,
  'C7_REJECTED_BY_EXACT_EVIDENCE_INTEGRITY_AUDIT',
);
assertEqual('SELECTION_REJECTED_C6', evidenceSelection.c6_candidate_sha, '89cd7e066b97f2f33d730d1e0adf291ebe7c4f64');
assertEqual(
  'SELECTION_REJECTED_C6_DISPOSITION',
  evidenceSelection.c6_candidate_disposition,
  'C6_REJECTED_BY_CANONICAL_SECURITY_GATE',
);
assertEqual('SELECTION_REJECTED_C5', evidenceSelection.vfinal5_candidate_sha, '959a5f9900e25f53414710bbfb3464c3ccb67a5d');
assertEqual(
  'SELECTION_REJECTED_C5_DISPOSITION',
  evidenceSelection.vfinal5_candidate_disposition,
  'C5_REJECTED_BY_VFINAL5',
);

assert(Array.isArray(evidenceSelection.proof_references), 'SELECTION_PROOF_REFERENCES_MISSING');
assertEqual('SELECTION_PROOF_REFERENCE_COUNT', evidenceSelection.proof_references.length, EXACT_EVIDENCE_PROOF_REFERENCES.length);
const proofReferenceById = new Map();
for (const reference of evidenceSelection.proof_references) {
  assert(typeof reference.proof_reference_id === 'string', 'PROOF_REFERENCE_ID_MISSING');
  assert(!proofReferenceById.has(reference.proof_reference_id), `PROOF_REFERENCE_DUPLICATE:${reference.proof_reference_id}`);
  proofReferenceById.set(reference.proof_reference_id, reference);
}
for (const expected of EXACT_EVIDENCE_PROOF_REFERENCES) {
  const reference = proofReferenceById.get(expected.proof_reference_id);
  assert(reference, `PROOF_REFERENCE_OMITTED:${expected.proof_reference_id}`);
  assertEqual(`PROOF_REFERENCE_COMMIT:${expected.proof_reference_id}`, reference.source_commit, expected.commit);
  assertEqual(`PROOF_REFERENCE_PATH:${expected.proof_reference_id}`, reference.source_path, expected.path);
  assertEqual(`PROOF_REFERENCE_BLOB:${expected.proof_reference_id}`, reference.source_git_blob, expected.git_blob);
  assertEqual(`PROOF_REFERENCE_SHA256:${expected.proof_reference_id}`, reference.source_sha256, expected.sha256);
  assertEqual(`PROOF_REFERENCE_LENGTH:${expected.proof_reference_id}`, reference.source_byte_length, expected.byte_length);
  assertEqual(`PROOF_REFERENCE_SYMBOLS:${expected.proof_reference_id}`, reference.required_symbols, [...expected.required_symbols]);
  assertEqual(
    `PROOF_REFERENCE_VALIDATION:${expected.proof_reference_id}`,
    reference.validation,
    'GIT_OBJECT_PATH_BLOB_SHA256_LENGTH_AND_SYMBOLS_VERIFIED',
  );
  const sourceBytes = objectBytes(reference.source_commit, reference.source_path);
  assertEqual(`PROOF_REFERENCE_OBJECT_BLOB:${expected.proof_reference_id}`, gitText('rev-parse', `${reference.source_commit}:${reference.source_path}`), reference.source_git_blob);
  assertEqual(`PROOF_REFERENCE_OBJECT_SHA256:${expected.proof_reference_id}`, sha256(sourceBytes), reference.source_sha256);
  assertEqual(`PROOF_REFERENCE_OBJECT_LENGTH:${expected.proof_reference_id}`, sourceBytes.length, reference.source_byte_length);
  const sourceText = sourceBytes.toString('utf8');
  for (const symbol of reference.required_symbols) {
    assert(sourceText.includes(symbol), `PROOF_REFERENCE_SYMBOL_MISSING:${expected.proof_reference_id}:${symbol}`);
  }
}
const canonicalProofReferences = EXACT_EVIDENCE_PROOF_REFERENCES.map((reference) => ({
  proof_reference_id: reference.proof_reference_id,
  source_commit: reference.commit,
  source_path: reference.path,
  source_git_blob: reference.git_blob,
  source_sha256: reference.sha256,
  source_byte_length: reference.byte_length,
  required_symbols: [...reference.required_symbols],
  validation: 'GIT_OBJECT_PATH_BLOB_SHA256_LENGTH_AND_SYMBOLS_VERIFIED',
}));

assert(Array.isArray(evidenceSelection.human_artifacts), 'SELECTION_HUMAN_ARTIFACTS_MISSING');
assertEqual('SELECTION_HUMAN_ARTIFACT_COUNT', evidenceSelection.human_artifacts.length, HUMAN_EVIDENCE_ARTIFACT_SPECS.length);
const humanArtifactByPath = new Map();
const candidateCommitTime = gitText('show', '-s', '--format=%cI', candidate);
for (const artifact of evidenceSelection.human_artifacts) {
  assert(typeof artifact.path === 'string', 'HUMAN_ARTIFACT_PATH_MISSING');
  assert(!humanArtifactByPath.has(artifact.path), `HUMAN_ARTIFACT_DUPLICATE:${artifact.path}`);
  humanArtifactByPath.set(artifact.path, artifact);
}
for (const expected of HUMAN_EVIDENCE_ARTIFACT_SPECS) {
  const artifact = humanArtifactByPath.get(expected.path);
  assert(artifact, `HUMAN_ARTIFACT_OMITTED:${expected.path}`);
  assertEqual(`HUMAN_ARTIFACT_SCHEMA:${expected.path}`, artifact.schema, 'product-truth-human-evidence-artifact.v1');
  assertEqual(`HUMAN_ARTIFACT_SELECTION:${expected.path}`, artifact.selection_id, expected.selection_id);
  assertEqual(`HUMAN_ARTIFACT_CANDIDATE:${expected.path}`, artifact.candidate_sha, candidate);
  assertEqual(`HUMAN_ARTIFACT_TREE:${expected.path}`, artifact.candidate_tree, candidateTree);
  assertEqual(`HUMAN_ARTIFACT_PARENT:${expected.path}`, artifact.candidate_parent, REQUIRED_C2_PARENT);
  assertEqual(`HUMAN_ARTIFACT_STATE:${expected.path}`, artifact.state, expected.state);
  assertEqual(`HUMAN_ARTIFACT_ACTOR:${expected.path}`, artifact.actor, expected.actor);
  assertEqual(`HUMAN_ARTIFACT_WRITE_AUTHORITY:${expected.path}`, artifact.candidate_write_authority, false);
  assertEqual(`HUMAN_ARTIFACT_PROOF_REFERENCES:${expected.path}`, artifact.proof_reference_ids, [...expected.proof_reference_ids]);
  for (const referenceId of artifact.proof_reference_ids) {
    assert(proofReferenceById.has(referenceId), `HUMAN_ARTIFACT_UNKNOWN_PROOF_REFERENCE:${expected.path}:${referenceId}`);
  }
  const bytes = evidenceBytes(expected.path);
  const text = bytes.toString('utf8');
  for (const forbidden of FORBIDDEN_HUMAN_GATE_TOKENS) {
    assert(!text.includes(forbidden), `HUMAN_ARTIFACT_FORBIDDEN_GATE_TOKEN:${expected.path}:${forbidden}`);
  }
  const canonicalBytes = Buffer.from(renderCanonicalHumanArtifact({
    spec: expected,
    proofReferences: canonicalProofReferences,
    candidateSha: candidate,
    candidateTree,
    candidateParent: REQUIRED_C2_PARENT,
    candidateCommitTime,
  }), 'utf8');
  assert(bytes.equals(canonicalBytes), `HUMAN_ARTIFACT_CANONICAL_RENDER:${expected.path}`);
  assertEqual(`HUMAN_ARTIFACT_CANONICAL_SHA256_METADATA:${expected.path}`, artifact.sha256, expected.sha256);
  assertEqual(`HUMAN_ARTIFACT_CANONICAL_GIT_BLOB_METADATA:${expected.path}`, artifact.git_blob, expected.git_blob);
  assertEqual(`HUMAN_ARTIFACT_CANONICAL_LENGTH_METADATA:${expected.path}`, artifact.byte_length, expected.byte_length);
  assertEqual(`HUMAN_ARTIFACT_CANONICAL_SHA256_BYTES:${expected.path}`, sha256(bytes), expected.sha256);
  assertEqual(`HUMAN_ARTIFACT_CANONICAL_GIT_BLOB_BYTES:${expected.path}`, gitBlobOid(bytes), expected.git_blob);
  assertEqual(`HUMAN_ARTIFACT_CANONICAL_LENGTH_BYTES:${expected.path}`, bytes.length, expected.byte_length);
  assertEqual(`HUMAN_ARTIFACT_SHA256:${expected.path}`, artifact.sha256, sha256(bytes));
  assertEqual(`HUMAN_ARTIFACT_GIT_BLOB:${expected.path}`, artifact.git_blob, gitBlobOid(bytes));
  assertEqual(`HUMAN_ARTIFACT_LENGTH:${expected.path}`, artifact.byte_length, bytes.length);
  for (const token of [
    `Status: \`${expected.state}\``,
    `Selection ID: \`${expected.selection_id}\``,
    candidate,
    candidateTree,
    REQUIRED_C2_PARENT,
    expected.actor,
  ]) {
    assert(text.includes(token), `HUMAN_ARTIFACT_REQUIRED_TEXT:${expected.path}:${token}`);
  }
  assertEqual(`HUMAN_RECEIPT_ACTION:${expected.path}`, artifact.receipt.command_or_operator_action, 'DETERMINISTIC_OUTPUT_ONLY_RENDER_FROM_VERIFIED_GIT_OBJECTS');
  assertEqual(`HUMAN_RECEIPT_START:${expected.path}`, artifact.receipt.start_time_utc, candidateCommitTime);
  assertEqual(`HUMAN_RECEIPT_END:${expected.path}`, artifact.receipt.end_time_utc, candidateCommitTime);
  assertEqual(`HUMAN_RECEIPT_TIMESTAMP:${expected.path}`, artifact.receipt.timestamp_basis, 'EXACT_CANDIDATE_COMMITTER_TIMESTAMP_DETERMINISTIC');
  assertEqual(`HUMAN_RECEIPT_STATE:${expected.path}`, artifact.receipt.artifact_generation_state, expected.state);
  assertEqual(`HUMAN_RECEIPT_WRITE_AUTHORITY:${expected.path}`, artifact.receipt.candidate_source_write_authority, false);
  assertEqual(`HUMAN_RECEIPT_NO_LIVE_CENSUS:${expected.path}`, artifact.receipt.live_worktree_census_performed, false);
}
assertEqual('HUMAN_ARTIFACT_EXACT_PATH_SET', [...humanArtifactByPath.keys()].sort(), HUMAN_EVIDENCE_ARTIFACT_SPECS.map((row) => row.path).sort());
assertEqual('PROVENANCE_PARENT', mergeProvenance.candidate_parent_sha, REQUIRED_C2_PARENT);
assertEqual('PROVENANCE_PARENT_COUNT', mergeProvenance.candidate_parent_count, 1);
assertEqual('AI_OPS_DISPOSITION_SCHEMA', aiOpsDisposition.schema, 'ai-ops-c9-acceptance-disposition.v2');
assertEqual('AI_OPS_DISPOSITION_BINDING', aiOpsDisposition.binding, 'EXACT_CANDIDATE');
assertEqual('AI_OPS_C9_BASELINE', aiOpsDisposition.c9_baseline_acceptance, 'EXCLUDED_FROM_C9_BASELINE');
assertEqual('INDEPENDENT_FINDINGS_SCHEMA', independentFindings.schema, 'product-truth-c9-independent-findings.v3');
assertEqual('INDEPENDENT_FINDINGS_BINDING', independentFindings.binding, 'EXACT_CANDIDATE');
for (const finding of independentFindings.findings ?? []) {
  assertEqual(
    `INDEPENDENT_FINDING_SOURCE:${finding.id}`,
    finding.source_candidate,
    'HISTORICAL_REJECTED_PREDECESSOR_REFERENCE_ONLY',
  );
  assertEqual(`INDEPENDENT_FINDING_REPAIRED:${finding.id}`, finding.repaired_candidate, candidate);
  assertEqual(
    `INDEPENDENT_FINDING_GATE:${finding.id}`,
    finding.gate_state,
    'C9_SOURCE_FIXED_FRESH_FINAL_VERIFIER_PENDING',
  );
}
assertEqual(
  'PRODUCT_ASSURANCE_DISPOSITION_SCHEMA',
  productAssuranceDisposition.schema,
  'product-assurance-c9-disposition.v2',
);
assertEqual('PRODUCT_ASSURANCE_DISPOSITION_BINDING', productAssuranceDisposition.binding, 'EXACT_CANDIDATE');
for (const artifact of productAssuranceDisposition.artifacts ?? []) {
  assert(!Object.hasOwn(artifact, 'c2_disposition'), `PRODUCT_ASSURANCE_STALE_C2_FIELD:${artifact.artifact}`);
  assert(nonEmptyExplicit(artifact.c9_disposition), `PRODUCT_ASSURANCE_C9_DISPOSITION_MISSING:${artifact.artifact}`);
  assertEqual(
    `PRODUCT_ASSURANCE_REASON:${artifact.artifact}`,
    artifact.reason,
    'FRESH_FINAL_VERIFIER_PENDING_EXACT_C9_PRODUCT_ASSURANCE_CLOSURE_NOT_CLAIMED',
  );
}

const proofParent = firstDefined(proofBinding, [
  'candidate_parent',
  'candidate_parent_sha',
  'candidate.parent',
  'candidate_binding.direct_parent_sha',
]);
assertEqual('PROOF_BINDING_PARENT', proofParent, REQUIRED_C2_PARENT);
assert(Array.isArray(proofBinding.artifacts) && proofBinding.artifacts.length > 0, 'PROOF_ARTIFACTS_MISSING');
for (const row of proofBinding.artifacts) {
  const path = firstDefined(row, ['relative_path', 'path']);
  assert(typeof path === 'string' && path.length > 0 && !path.startsWith('/'), 'PROOF_ARTIFACT_PATH_INVALID');
  const bytes = objectBytes(candidate, path);
  assertEqual(`PROOF_ARTIFACT_SHA256:${path}`, row.sha256, sha256(bytes));
  assertEqual(`PROOF_ARTIFACT_BYTES:${path}`, firstDefined(row, ['byte_length', 'bytes']), bytes.length);
  assertEqual(
    `PROOF_ARTIFACT_GIT_BLOB:${path}`,
    firstDefined(row, ['candidate_git_blob', 'git_blob']),
    gitBlobOid(bytes),
  );
}
const absenceProof = proofBinding.candidate_absence_and_exclusion_proofs;
assert(
  absenceProof !== null && typeof absenceProof === 'object',
  'CANDIDATE_ABSENCE_AND_EXCLUSION_PROOFS_MISSING',
);
assertEqual(
  'CANDIDATE_ABSENCE_PROOF_SCHEMA',
  absenceProof.schema,
  'CANDIDATE_ABSENCE_AND_EXCLUSION_PROOFS/v1',
);
assertEqual('CANDIDATE_ABSENCE_PROOF_COMMIT', absenceProof.candidate_commit, candidate);
assertEqual('CANDIDATE_ABSENCE_PROOF_TREE', absenceProof.candidate_tree, candidateTree);
assertEqual(
  'CANDIDATE_ABSENCE_PROOF_PREFIXES',
  absenceProof.absent_path_prefixes?.map((row) => row.path_prefix),
  [...ABSENT_CANDIDATE_PATH_PREFIXES],
);
const absenceCandidateTreeBlobs = treeBlobMap(candidate);
for (const row of absenceProof.absent_path_prefixes ?? []) {
  const matchingPaths = [...absenceCandidateTreeBlobs.keys()]
    .filter((path) => path.startsWith(row.path_prefix));
  assertEqual(`CANDIDATE_ABSENCE_PROOF_COUNT:${row.path_prefix}`, row.matching_path_count, 0);
  assertEqual(`CANDIDATE_ABSENCE_GIT_COUNT:${row.path_prefix}`, matchingPaths.length, 0);
  assertEqual(
    `CANDIDATE_ABSENCE_PROOF_SOURCE:${row.path_prefix}`,
    row.proof_source,
    'git ls-tree -r -z exact-candidate',
  );
}
assertEqual(
  'FRONTIER_EXCLUSION_PROOF_COMMITS',
  absenceProof.frontier_reference_ancestry?.map((row) => ({
    sha: row.sha,
    role: row.role,
    expected_ancestor_of_candidate: row.expected_ancestor_of_candidate,
  })),
  FRONTIER_REFERENCE_COMMITS,
);
for (const row of absenceProof.frontier_reference_ancestry ?? []) {
  assertEqual(
    `FRONTIER_REFERENCE_OBJECT:${row.sha}`,
    gitText('rev-parse', `${row.sha}^{commit}`),
    row.sha,
  );
  const status = runGit(
    ['merge-base', '--is-ancestor', row.sha, candidate],
    { allowFailure: true },
  ).status;
  assertEqual(
    `FRONTIER_REFERENCE_ANCESTRY_STATUS:${row.sha}`,
    status,
    row.expected_ancestor_of_candidate ? 0 : 1,
  );
  assertEqual(
    `FRONTIER_REFERENCE_ANCESTRY:${row.sha}`,
    row.ancestor_of_candidate,
    status === 0,
  );
}

function parseCsv(text, label) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  assert(!quoted, `CSV_UNTERMINATED_QUOTE:${label}`);
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  assert(rows.length > 0, `CSV_EMPTY:${label}`);
  const headers = rows[0];
  assert(new Set(headers).size === headers.length, `CSV_DUPLICATE_HEADER:${label}`);
  const records = rows.slice(1).map((cells, index) => {
    assertEqual(`CSV_COLUMN_COUNT:${label}:${index + 2}`, cells.length, headers.length);
    return Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex]]));
  });
  return { headers, records };
}

const matrixRequirementIds = new Set();
const matrixSourceInputIds = new Set();
const matrixRecordsByFile = new Map();
let matrixCandidateCellCount = 0;
for (const spec of MATRIX_SPECS) {
  const matrix = parseCsv(evidenceText(spec.file), spec.file);
  const candidateMatrix = parseCsv(
    objectBytes(candidate, campaignPath(spec.file)).toString('utf8'),
    `candidate:${spec.file}`,
  );
  assert(matrix.headers.includes('candidate_sha'), `MATRIX_CANDIDATE_COLUMN_MISSING:${spec.file}`);
  assert(matrix.headers.includes('source_input_ids'), `MATRIX_SOURCE_INPUT_IDS_COLUMN_MISSING:${spec.file}`);
  assertEqual(`MATRIX_ROW_COUNT:${spec.file}`, matrix.records.length, spec.count);
  assertEqual(`CANDIDATE_MATRIX_ROW_COUNT:${spec.file}`, candidateMatrix.records.length, spec.count);
  const identities = matrix.records.map((row) => spec.identity.map((field) => row[field]).join('\0'));
  const candidateIdentities = candidateMatrix.records.map(
    (row) => spec.identity.map((field) => row[field]).join('\0'),
  );
  assert(identities.every((identity) => identity.replaceAll('\0', '').length > 0), `MATRIX_ID_MISSING:${spec.file}`);
  assertEqual(`MATRIX_ID_UNIQUENESS:${spec.file}`, new Set(identities).size, spec.count);
  assertEqual(`CANDIDATE_MATRIX_ID_UNIQUENESS:${spec.file}`, new Set(candidateIdentities).size, spec.count);
  assertEqual(`MATRIX_IDENTITY_SET:${spec.file}`, identities, candidateIdentities);
  matrixRecordsByFile.set(spec.file, matrix.records);
  for (const [index, row] of matrix.records.entries()) {
    assertEqual(`MATRIX_CANDIDATE_CELL:${spec.file}:${index + 2}`, row.candidate_sha, candidate);
    matrixCandidateCellCount += 1;
    const requirementId = firstDefined(row, ['requirement_id', 'capability_id', 'field_id']);
    assert(typeof requirementId === 'string' && requirementId.length > 0, `MATRIX_ID_MISSING:${spec.file}:${index + 2}`);
    matrixRequirementIds.add(requirementId);
    const sourceIds = row.source_input_ids.split(';').map((entry) => entry.trim()).filter(Boolean);
    assert(sourceIds.length > 0, `MATRIX_SOURCE_INPUT_IDS_EMPTY:${spec.file}:${index + 2}`);
    sourceIds.forEach((sourceId) => matrixSourceInputIds.add(sourceId));
  }
}
assertEqual('MATRIX_CANDIDATE_CELL_TOTAL', matrixCandidateCellCount, 354);
for (const spec of MATRIX_SPECS) {
  const text = evidenceText(spec.file);
  assert(!/C2_NOT_YET_FROZEN|exact-C2|EXACT_C2_|exact-C browser|exact-C cockpit/u.test(text),
    `MATRIX_STALE_CANDIDATE_TRUTH:${spec.file}`);
}

function inputRows(lock) {
  for (const key of ['inputs', 'locked_inputs', 'input_inventory']) {
    if (Array.isArray(lock[key])) return lock[key];
  }
  const legacyGroups = [
    'controlling_external_inputs',
    'candidate_tracked_law_and_locks',
    'defect_wave_inputs',
    'superseded_reference_inputs',
    'absent_named_superseded_inputs',
  ];
  return legacyGroups.flatMap((key) => (Array.isArray(lock[key]) ? lock[key] : []));
}

function nonEmptyExplicit(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && typeof value === 'object' && Object.keys(value).length > 0;
}

function normalizeInputId(value) {
  return String(value).replace(/[^A-Za-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');
}

function expectedDisposition(authority, supersededBy = null) {
  const reference = authority.includes('REFERENCE_ONLY')
    || authority.includes('REFERENCE_LATER_OWNER_GATE')
    || authority.includes('PACKAGED_');
  const disposition = {
    state: authority,
    effect: authority === 'ORCHESTRATION_ONLY'
      ? 'ORCHESTRATION_ONLY'
      : reference ? 'REFERENCE_ONLY' : 'ADMIT',
    explicit: true,
  };
  if (supersededBy) disposition.superseded_by = supersededBy;
  return disposition;
}

const candidateSeedLock = JSON.parse(objectBytes(candidate, campaignPath('INPUTS.lock')).toString('utf8'));
const sourcePayloadMetadata = JSON.parse(
  objectBytes(candidate, campaignPath('LOCKED_INPUT_PAYLOADS.json')).toString('utf8'),
);
assertEqual('SOURCE_PAYLOAD_MEMBER_COUNT', sourcePayloadMetadata.members?.length, 23);
const expectedInputs = [
  ...sourcePayloadMetadata.members
    .filter((row) => row.input_class === 'CONTROLLING_EXTERNAL')
    .map((row) => ({ ...row, source_kind: 'PAYLOAD', relative_path: campaignPath(row.payload_relative_path) })),
  ...candidateSeedLock.candidate_tracked_law_and_locks.map((row) => ({
    input_id: `candidate:${row.id}`,
    legacy_id: row.id,
    input_class: 'CANDIDATE_TRACKED_LAW_OR_LOCK',
    authority: row.authority,
    superseded_by: row.superseded_by,
    source_kind: 'TRACKED',
    relative_path: row.relative_path,
  })),
  ...candidateSeedLock.defect_wave_inputs.map((row) => ({
    input_id: `wave:${row.id}`,
    legacy_id: row.id,
    input_class: 'DEFECT_WAVE_INPUT',
    authority: row.authority,
    superseded_by: row.superseded_by,
    source_kind: 'WAVE',
    relative_path: row.relative_path,
  })),
  ...candidateSeedLock.superseded_reference_inputs
    .filter((row) => row.relative_path)
    .map((row) => ({
      input_id: `superseded:${row.id}`,
      legacy_id: row.id,
      input_class: 'SUPERSEDED_TRACKED_REFERENCE',
      authority: row.authority,
      superseded_by: row.superseded_by,
      source_kind: 'TRACKED',
      relative_path: row.relative_path,
    })),
  ...sourcePayloadMetadata.members
    .filter((row) => row.input_class === 'SUPERSEDED_EXTERNAL')
    .map((row) => ({ ...row, source_kind: 'PAYLOAD', relative_path: campaignPath(row.payload_relative_path) })),
  ...candidateSeedLock.absent_named_superseded_inputs.map((row) => ({
    input_id: `absent:${normalizeInputId(row.name)}`,
    legacy_id: row.name,
    input_class: 'ABSENT_NAMED_SUPERSEDED_INPUT',
    authority: 'ABSENT_SUPERSEDED_REFERENCE_ONLY',
    superseded_by: row.superseded_by,
    source_kind: 'ABSENT',
    relative_path: null,
  })),
];
assertEqual('EXPECTED_LOCKED_INPUT_COUNT', expectedInputs.length, 61);
assertEqual('EXPECTED_LOCKED_INPUT_ID_UNIQUENESS', new Set(expectedInputs.map((row) => row.input_id)).size, 61);

const inputs = inputRows(inputLock);
assertEqual('LOCKED_INPUT_COUNT', inputs.length, 61);
const inputIds = new Set();
for (const [index, row] of inputs.entries()) {
  const expected = expectedInputs[index];
  const inputId = row.input_id;
  assertEqual(`INPUT_ID:${index}`, inputId, expected.input_id);
  assert(!inputIds.has(inputId), `DUPLICATE_INPUT_ID:${inputId}`);
  inputIds.add(inputId);
  assertEqual(`INPUT_LEGACY_ID:${inputId}`, row.legacy_id, expected.legacy_id);
  assertEqual(`INPUT_CLASS:${inputId}`, row.input_class, expected.input_class);
  assertEqual(`INPUT_AUTHORITY:${inputId}`, row.authority, expected.authority);
  assert(nonEmptyExplicit(row.source), `INPUT_SOURCE_MISSING:${inputId}`);
  const expectedRowDisposition = expected.source_kind === 'ABSENT'
    ? {
      state: 'ABSENT_SUPERSEDED_REFERENCE_ONLY',
      effect: 'OMIT',
      explicit: true,
      superseded_by: expected.superseded_by,
    }
    : expectedDisposition(expected.authority, expected.superseded_by);
  assertEqual(`INPUT_DISPOSITION:${inputId}`, row.disposition, expectedRowDisposition);
  assertEqual(
    `INPUT_MATRIX_IDS:${inputId}`,
    row.matrix_requirement_ids,
    [LOCK_INVENTORY_MATRIX_REQUIREMENT_ID],
  );
  assert(matrixRequirementIds.has(LOCK_INVENTORY_MATRIX_REQUIREMENT_ID), 'LOCK_INVENTORY_MATRIX_REQUIREMENT_MISSING');

  if (expected.source_kind === 'ABSENT') {
    assertEqual(`INPUT_ABSENT_SOURCE:${inputId}`, row.source, {
      kind: 'DECLARED_ABSENCE',
      content_available: false,
      sha256: null,
      git_blob: null,
      byte_length: null,
    });
    continue;
  }

  const bytes = objectBytes(candidate, expected.relative_path);
  const expectedBlob = gitText('rev-parse', `${candidate}:${expected.relative_path}`);
  const expectedSha256 = sha256(bytes);
  assertEqual(`INPUT_SOURCE_COMMIT:${inputId}`, row.source.candidate_commit, candidate);
  assertEqual(`INPUT_SOURCE_TREE:${inputId}`, row.source.candidate_tree, candidateTree);
  assertEqual(`INPUT_SOURCE_PATH:${inputId}`, row.source.relative_path, expected.relative_path);
  assertEqual(`INPUT_SOURCE_BLOB:${inputId}`, row.source.git_blob, expectedBlob);
  assertEqual(`INPUT_SOURCE_SHA256:${inputId}`, row.source.sha256, expectedSha256);
  assertEqual(`INPUT_SOURCE_BYTES:${inputId}`, row.source.byte_length, bytes.length);
  assertEqual(`INPUT_SOURCE_AVAILABLE:${inputId}`, row.source.content_available, true);

  if (expected.source_kind === 'PAYLOAD') {
    assertEqual(`INPUT_SOURCE_KIND:${inputId}`, row.source.kind, 'CANDIDATE_TRACKED_PAYLOAD');
    assertEqual(`INPUT_CONTENT_OID:${inputId}`, row.content_oid, expectedBlob);
    assertEqual(`INPUT_SHA256:${inputId}`, row.sha256, expectedSha256);
    assertEqual(`INPUT_BYTE_LENGTH:${inputId}`, row.byte_length, bytes.length);
    assertEqual(`INPUT_ORIGINAL_PATH:${inputId}`, row.source.original_path_advisory, expected.original_path);
    assertEqual(`INPUT_REHASHABLE:${inputId}`, row.source.independently_rehashable_in_single_branch_clone, true);
  } else {
    assertEqual(`INPUT_SOURCE_KIND:${inputId}`, row.source.kind, 'CANDIDATE_GIT_BLOB');
  }

  if (expected.source_kind === 'WAVE') {
    assertEqual(`INPUT_WAVE_AUTHORITY:${inputId}`, row.authorized_origin?.authority, 'D-LAUNCH-65');
    assertEqual(
      `INPUT_WAVE_ARCHIVE_COMMIT:${inputId}`,
      row.authorized_origin?.archive_commit,
      D_LAUNCH_65.archive_source_commit,
    );
    assertEqual(`INPUT_WAVE_ORIGIN_BLOB:${inputId}`, row.authorized_origin?.source_git_blob, expectedBlob);
    assertEqual(`INPUT_WAVE_ORIGIN_SHA256:${inputId}`, row.authorized_origin?.source_sha256, expectedSha256);
    assertEqual(`INPUT_WAVE_ORIGIN_BYTES:${inputId}`, row.authorized_origin?.source_byte_length, bytes.length);
    assertEqual(`INPUT_WAVE_ORIGIN_EXACT:${inputId}`, row.authorized_origin?.candidate_byte_exact, true);
  }
}
for (const sourceInputId of matrixSourceInputIds) {
  assert(inputIds.has(sourceInputId), `MATRIX_SOURCE_INPUT_ID_UNKNOWN:${sourceInputId}`);
}
for (const inputId of inputIds) {
  assert(matrixSourceInputIds.has(inputId), `LOCKED_INPUT_NOT_REFERENCED_BY_MATRIX:${inputId}`);
}
const sortedInputIds = [...inputIds].sort();
for (const spec of MATRIX_SPECS) {
  for (const row of matrixRecordsByFile.get(spec.file)) {
    const expectedSourceIds = spec.file === 'DIRECTIVE_COVERAGE_MATRIX.csv'
      && row.requirement_id === LOCK_INVENTORY_MATRIX_REQUIREMENT_ID
      ? sortedInputIds.join(';')
      : 'candidate:STATE';
    assertEqual(
      `MATRIX_EXACT_SOURCE_LINKS:${spec.file}:${spec.identity.map((field) => row[field]).join(':')}`,
      row.source_input_ids,
      expectedSourceIds,
    );
  }
}

assert(Array.isArray(payloadMetadata.members), 'PAYLOAD_MEMBERS_MISSING');
assertEqual('PAYLOAD_SCHEMA_VERSION', payloadMetadata.schema_version, 'locked-input-payloads/v2');
assertEqual('PAYLOAD_SCHEMA', payloadMetadata.schema, 'product-truth-locked-input-payloads.v2');
assertEqual('PAYLOAD_PREPARATION_STATE', payloadMetadata.preparation_state, 'EXACT_CANDIDATE_BOUND');
assertEqual('PAYLOAD_BINDING', payloadMetadata.binding, 'EXACT_CANDIDATE_TRACKED_REHASH_ONLY');
assertEqual(
  'PAYLOAD_GENERATOR',
  payloadMetadata.generated_by,
  `${CAMPAIGN_ROOT}/generate-exact-candidate-evidence.mjs`,
);
assertEqual('PAYLOAD_MEMBER_COUNT', payloadMetadata.members.length, 23);
assertEqual(
  'PAYLOAD_TOTAL_EXTERNAL_MEMBERS',
  firstDefined(payloadMetadata, ['totals.external_input_members', 'external_input_member_count']),
  23,
);
assert(Array.isArray(payloadMetadata.authority_members), 'PAYLOAD_AUTHORITY_MEMBERS_MISSING');
assertEqual('PAYLOAD_AUTHORITY_MEMBER_COUNT', payloadMetadata.authority_members.length, 2);
assertEqual('PAYLOAD_TOTAL_FILES', payloadMetadata.totals?.payload_files, 25);
if (payloadMetadata.candidate !== null && payloadMetadata.candidate !== undefined) {
  const payloadCandidate = typeof payloadMetadata.candidate === 'string'
    ? payloadMetadata.candidate
    : firstDefined(payloadMetadata, ['candidate.commit', 'candidate.sha']);
  assertEqual('PAYLOAD_METADATA_CANDIDATE', payloadCandidate, candidate);
  const payloadTree = firstDefined(payloadMetadata, ['candidate.tree', 'candidate_tree', 'candidate_tree_sha']);
  assertEqual('PAYLOAD_METADATA_TREE', payloadTree, candidateTree);
}
assertRecursiveExactBindings('LOCKED_INPUT_PAYLOADS', payloadMetadata);

function payloadPathOf(value) {
  const path = firstDefined(value, [
    'payload_relative_path',
    'payload_path',
    'candidate_payload_path',
    'bundle_path',
    'relative_path',
    'source.payload_relative_path',
    'source.payload_path',
    'source.bundle_path',
    'source.relative_path',
  ]);
  if (typeof path === 'string' && path.startsWith(`${CAMPAIGN_ROOT}/`)) {
    return path.slice(`${CAMPAIGN_ROOT}/`.length);
  }
  return path;
}

function verifyPayloadMember(member, label) {
  const path = payloadPathOf(member);
  assert(typeof path === 'string' && path.startsWith('locked-input-payloads/'), `PAYLOAD_PATH_INVALID:${label}`);
  const bytes = evidenceBytes(path);
  const candidateBytes = objectBytes(candidate, campaignPath(path));
  assert(bytes.equals(candidateBytes), `PAYLOAD_CHANGED_AFTER_CANDIDATE:${label}`);
  const actualSha256 = sha256(bytes);
  const actualGitBlob = gitBlobOid(bytes);
  assertEqual(`PAYLOAD_SHA256:${label}`, member.sha256, actualSha256);
  assertEqual(`PAYLOAD_BYTES:${label}`, firstDefined(member, ['byte_length', 'bytes']), bytes.length);
  assertEqual(`PAYLOAD_GIT_BLOB:${label}`, firstDefined(member, ['git_blob', 'content_oid']), actualGitBlob);
  if (member.expected_sha256 !== undefined) {
    assertEqual(`PAYLOAD_EXPECTED_SHA256:${label}`, member.expected_sha256, actualSha256);
  }
  if (member.expected_git_blob !== undefined) {
    assertEqual(`PAYLOAD_EXPECTED_GIT_BLOB:${label}`, member.expected_git_blob, actualGitBlob);
  }
  if (member.expected_byte_length !== undefined) {
    assertEqual(`PAYLOAD_EXPECTED_BYTES:${label}`, member.expected_byte_length, bytes.length);
  }
  if (member.candidate_commit !== undefined) {
    assertEqual(`PAYLOAD_CANDIDATE_COMMIT:${label}`, member.candidate_commit, candidate);
  }
  if (member.candidate_tree !== undefined) {
    assertEqual(`PAYLOAD_CANDIDATE_TREE:${label}`, member.candidate_tree, candidateTree);
  }
  return { path, bytes, sha256: actualSha256, gitBlob: actualGitBlob };
}

const payloadMembersByInput = new Map();
const payloadPaths = new Set();
for (const member of payloadMetadata.members) {
  const inputId = firstDefined(member, ['input_id', 'member_id']);
  assert(typeof inputId === 'string' && inputId.length > 0, 'PAYLOAD_INPUT_ID_MISSING');
  assert(!payloadMembersByInput.has(inputId), `DUPLICATE_PAYLOAD_INPUT_ID:${inputId}`);
  const verified = verifyPayloadMember(member, inputId);
  assert(!payloadPaths.has(verified.path), `DUPLICATE_PAYLOAD_PATH:${verified.path}`);
  payloadPaths.add(verified.path);
  payloadMembersByInput.set(inputId, { member, verified });
}

const authorityPayloadsById = new Map();
for (const member of payloadMetadata.authority_members) {
  const memberId = firstDefined(member, ['member_id', 'authority_id']);
  assert(typeof memberId === 'string' && memberId.length > 0, 'PAYLOAD_AUTHORITY_ID_MISSING');
  assert(!authorityPayloadsById.has(memberId), `DUPLICATE_PAYLOAD_AUTHORITY_ID:${memberId}`);
  const verified = verifyPayloadMember(member, memberId);
  assert(!payloadPaths.has(verified.path), `DUPLICATE_PAYLOAD_PATH:${verified.path}`);
  payloadPaths.add(verified.path);
  authorityPayloadsById.set(memberId, { member, verified });
}

const exactPayloadInventory = {
  members: payloadMetadata.members,
  authority_members: payloadMetadata.authority_members,
};
assertEqual(
  'PAYLOAD_INVENTORY_SHA256',
  payloadMetadata.inventory_sha256,
  sha256(Buffer.from(canonicalJson(exactPayloadInventory), 'utf8')),
);
const payloadFrameMembers = [...payloadMetadata.members, ...payloadMetadata.authority_members];
const payloadFrames = payloadFrameMembers.map((member) => {
  const memberId = firstDefined(member, ['input_id', 'member_id', 'authority_id']);
  const path = payloadPathOf(member);
  const bytes = evidenceBytes(path);
  return Buffer.concat([Buffer.from(`${memberId}\0${bytes.length}\0`, 'utf8'), bytes]);
});
assertEqual(
  'PAYLOAD_SET_SHA256',
  payloadMetadata.payload_set_sha256,
  sha256(Buffer.concat(payloadFrames)),
);
assertEqual(
  'PAYLOAD_TOTAL_BYTES',
  payloadMetadata.totals?.byte_length,
  payloadFrameMembers.reduce(
    (sum, member) => sum + firstDefined(member, ['byte_length', 'bytes']),
    0,
  ),
);
assertEqual(
  'PAYLOAD_SOURCE_INVENTORY_SHA256_SELF_CHECK',
  sourcePayloadMetadata.inventory_sha256,
  sha256(Buffer.from(canonicalJson({
    members: sourcePayloadMetadata.members,
    authority_members: sourcePayloadMetadata.authority_members,
  }), 'utf8')),
);
assertEqual(
  'PAYLOAD_SOURCE_INVENTORY_SHA256_BINDING',
  payloadMetadata.source_preparation?.inventory_sha256,
  sourcePayloadMetadata.inventory_sha256,
);

let payloadBackedInputCount = 0;
for (const row of inputs) {
  const inputId = firstDefined(row, ['input_id', 'id', 'name']);
  const memberId = firstDefined(row, ['source.member_id', 'source.input_id', 'payload_member_id']);
  const sourcePath = payloadPathOf(row.source);
  const isPayloadBacked = memberId !== undefined
    || (typeof sourcePath === 'string' && sourcePath.startsWith('locked-input-payloads/'));
  if (!isPayloadBacked) continue;
  payloadBackedInputCount += 1;
  const expectedInputId = memberId ?? inputId;
  const payload = payloadMembersByInput.get(expectedInputId) ?? payloadMembersByInput.get(inputId);
  assert(payload !== undefined, `INPUT_PAYLOAD_MEMBER_MISSING:${inputId}`);
  if (sourcePath !== undefined) assertEqual(`INPUT_PAYLOAD_PATH:${inputId}`, sourcePath, payload.verified.path);
  for (const [field, actual] of [
    ['sha256', payload.verified.sha256],
    ['git_blob', payload.verified.gitBlob],
    ['content_oid', payload.verified.gitBlob],
    ['byte_length', payload.verified.bytes.length],
  ]) {
    const lockedValue = firstDefined(row, [`source.${field}`, field]);
    if (lockedValue !== undefined) assertEqual(`INPUT_PAYLOAD_${field.toUpperCase()}:${inputId}`, lockedValue, actual);
  }
}
assertEqual('PAYLOAD_BACKED_LOCKED_INPUT_COUNT', payloadBackedInputCount, 23);
assertEqual('PAYLOAD_MEMBER_INPUT_COVERAGE', payloadMembersByInput.size, payloadBackedInputCount);

function exactAuthorityField(authority, label, aliases, expected) {
  const actual = firstDefined(authority, aliases);
  assertEqual(`D_LAUNCH_65_${label}`, actual, expected);
}

const dLaunch65 = firstDefined(inputLock, [
  'd_launch_65',
  'd_launch_65_authority',
  'authority_bindings.D_LAUNCH_65',
  'authority_bindings.d_launch_65',
]);
assert(dLaunch65 !== undefined && dLaunch65 !== null, 'D_LAUNCH_65_AUTHORITY_MISSING_FROM_INPUT_LOCK');
for (const [label, aliases, expected] of [
  ['COMMIT', ['commit', 'source_commit'], D_LAUNCH_65.commit],
  ['TREE', ['tree', 'source_tree'], D_LAUNCH_65.tree],
  ['PARENT', ['parent', 'source_parent'], D_LAUNCH_65.parent],
  ['PATH', ['path', 'source_path'], D_LAUNCH_65.path],
  ['GIT_BLOB', ['git_blob', 'source_git_blob'], D_LAUNCH_65.git_blob],
  ['SHA256', ['sha256', 'source_sha256'], D_LAUNCH_65.sha256],
  ['BYTE_LENGTH', ['byte_length', 'bytes', 'source_bytes'], D_LAUNCH_65.byte_length],
  ['RULING_LINES', ['ruling_lines'], D_LAUNCH_65.ruling_lines],
  ['ARCHIVE_COMMIT', ['archive_source_commit'], D_LAUNCH_65.archive_source_commit],
  ['ARCHIVE_TREE', ['archive_source_tree'], D_LAUNCH_65.archive_source_tree],
  ['ARCHIVE_SUBTREE', ['archive_subtree'], D_LAUNCH_65.archive_subtree],
]) exactAuthorityField(dLaunch65, label, aliases, expected);

const dLaunchPayloadRecord = authorityPayloadsById.get('authority:D_LAUNCH_65');
assert(dLaunchPayloadRecord !== undefined, 'D_LAUNCH_65_PAYLOAD_MEMBER_MISSING');
const dLaunchPayload = dLaunchPayloadRecord.member;
const verifiedDLaunchPayload = dLaunchPayloadRecord.verified;
assertEqual('D_LAUNCH_65_PAYLOAD_SOURCE_COMMIT', dLaunchPayload.source_commit, D_LAUNCH_65.commit);
assertEqual('D_LAUNCH_65_PAYLOAD_SOURCE_PATH', dLaunchPayload.source_path, D_LAUNCH_65.path);
assertEqual('D_LAUNCH_65_PAYLOAD_SHA256', verifiedDLaunchPayload.sha256, D_LAUNCH_65.sha256);
assertEqual('D_LAUNCH_65_PAYLOAD_GIT_BLOB', verifiedDLaunchPayload.gitBlob, D_LAUNCH_65.git_blob);
assertEqual('D_LAUNCH_65_PAYLOAD_BYTES', verifiedDLaunchPayload.bytes.length, D_LAUNCH_65.byte_length);
const lockedDLaunchPayloadPath = payloadPathOf(dLaunch65);
assertEqual('D_LAUNCH_65_LOCK_PAYLOAD_PATH', lockedDLaunchPayloadPath, verifiedDLaunchPayload.path);

const stateBytes = objectBytes(candidate, 'STATE.md');
const stateSha256 = sha256(stateBytes);
const stateGitBlob = gitBlobOid(stateBytes);
assertEqual('CANDIDATE_STATE_GIT_BLOB', gitText('rev-parse', `${candidate}:STATE.md`), stateGitBlob);
const stateRows = inputs.filter((row) => {
  const path = firstDefined(row, [
    'source.path',
    'source.candidate_path',
    'source.relative_path',
    'relative_path',
    'path',
  ]);
  return path === 'STATE.md';
});
assertEqual('CANDIDATE_STATE_LOCK_ROW_COUNT', stateRows.length, 1);
const stateSource = stateRows[0].source;
assertEqual(
  'CANDIDATE_STATE_SOURCE_COMMIT',
  firstDefined(stateSource, ['candidate_commit', 'candidate_sha', 'commit', 'source_commit']),
  candidate,
);
assertEqual(
  'CANDIDATE_STATE_SOURCE_TREE',
  firstDefined(stateSource, ['candidate_tree', 'candidate_tree_sha', 'tree', 'source_tree']),
  candidateTree,
);
assertEqual(
  'CANDIDATE_STATE_SOURCE_GIT_BLOB',
  firstDefined(stateSource, ['git_blob', 'candidate_git_blob', 'content_oid']),
  stateGitBlob,
);
assertEqual('CANDIDATE_STATE_SOURCE_SHA256', stateSource.sha256, stateSha256);
assertEqual(
  'CANDIDATE_STATE_SOURCE_BYTES',
  firstDefined(stateSource, ['byte_length', 'bytes']),
  stateBytes.length,
);

assertEqual('PROVENANCE_SCHEMA', mergeProvenance.schema, 'product-truth-merge-provenance.v3');
assert(Array.isArray(mergeProvenance.admitted_lanes), 'PROVENANCE_ADMITTED_LANES_MISSING');
const candidateTreeBlobs = treeBlobMap(candidate);
const expectedCorrectionPaths = gitText('diff', '--name-only', REQUIRED_C2_PARENT, candidate, '--')
  .split('\n')
  .filter(Boolean)
  .sort();
const expectedCorrectionOutOfGrantPaths = expectedCorrectionPaths.filter(
  (path) => !C9_CORRECTION_GRANTS.some((grant) => grantCoversPath(grant, path)),
);
assertEqual('PROVENANCE_CORRECTION_BASE', mergeProvenance.correction?.base, REQUIRED_C2_PARENT);
assertEqual('PROVENANCE_CORRECTION_GRANTS', mergeProvenance.correction?.grants, C9_CORRECTION_GRANTS);
assertEqual(
  'PROVENANCE_CORRECTION_PATHS',
  mergeProvenance.correction?.changed_paths,
  expectedCorrectionPaths,
);
assertEqual(
  'PROVENANCE_CORRECTION_PATH_COUNT',
  mergeProvenance.correction?.changed_path_count,
  expectedCorrectionPaths.length,
);
assertEqual(
  'PROVENANCE_CORRECTION_PATH_HASH',
  mergeProvenance.correction?.changed_path_set_sha256,
  sha256(`${expectedCorrectionPaths.join('\n')}\n`),
);
assertEqual(
  'PROVENANCE_CORRECTION_OUT_OF_GRANT',
  mergeProvenance.correction?.out_of_grant_paths,
  expectedCorrectionOutOfGrantPaths,
);
for (const lane of mergeProvenance.admitted_lanes) {
  assert(/^[a-f0-9]{40}$/u.test(lane.tip), `PROVENANCE_LANE_TIP_INVALID:${lane.id}`);
  assert(/^[a-f0-9]{40}$/u.test(lane.merge), `PROVENANCE_LANE_MERGE_INVALID:${lane.id}`);
  assert(/^[a-f0-9]{40}$/u.test(lane.delta_base), `PROVENANCE_LANE_BASE_INVALID:${lane.id}`);
  const expectedParents = gitText('show', '-s', '--format=%P', lane.merge).split(/\s+/u).filter(Boolean);
  const expectedChangedPaths = gitText('diff', '--name-only', lane.delta_base, lane.tip)
    .split('\n')
    .filter(Boolean)
    .sort();
  const tipBlobs = treeBlobMap(lane.tip);
  const mergeBlobs = treeBlobMap(lane.merge);
  const expectedMismatches = expectedChangedPaths
    .filter((path) => tipBlobs.get(path) !== candidateTreeBlobs.get(path))
    .map((path) => ({
      path,
      donor_blob: tipBlobs.get(path) ?? null,
      candidate_blob: candidateTreeBlobs.get(path) ?? null,
      disposition: 'EXPLICIT_POST_MERGE_CANDIDATE_ADAPTATION',
    }));
  const expectedOutOfGrantPaths = expectedChangedPaths.filter(
    (path) => !(lane.grants ?? []).some((grant) => grantCoversPath(grant, path)),
  );
  assertEqual(`PROVENANCE_LANE_PARENTS:${lane.id}`, lane.parents, expectedParents);
  assertEqual(
    `PROVENANCE_LANE_MERGE_TREE:${lane.id}`,
    lane.merge_tree,
    gitText('rev-parse', `${lane.merge}^{tree}`),
  );
  assertEqual(`PROVENANCE_LANE_CHANGED_PATHS:${lane.id}`, lane.changed_paths, expectedChangedPaths);
  assertEqual(`PROVENANCE_LANE_CHANGED_COUNT:${lane.id}`, lane.changed_path_count, expectedChangedPaths.length);
  assertEqual(
    `PROVENANCE_LANE_CHANGED_HASH:${lane.id}`,
    lane.changed_path_set_sha256,
    sha256(`${expectedChangedPaths.join('\n')}\n`),
  );
  assertEqual(`PROVENANCE_LANE_OUT_OF_GRANT:${lane.id}`, lane.out_of_grant_paths, expectedOutOfGrantPaths);
  assertEqual(
    `PROVENANCE_LANE_TIP_ANCESTRY:${lane.id}`,
    lane.donor_tip_in_candidate_ancestry,
    runGit(['merge-base', '--is-ancestor', lane.tip, candidate], { allowFailure: true }).status === 0,
  );
  assertEqual(
    `PROVENANCE_LANE_MERGE_ANCESTRY:${lane.id}`,
    lane.merge_in_candidate_ancestry,
    runGit(['merge-base', '--is-ancestor', lane.merge, candidate], { allowFailure: true }).status === 0,
  );
  assertEqual(
    `PROVENANCE_LANE_SECOND_PARENT:${lane.id}`,
    lane.exact_second_parent,
    expectedParents.length === 2 && expectedParents[1] === lane.tip,
  );
  assertEqual(
    `PROVENANCE_LANE_MERGE_MATCHES:${lane.id}`,
    lane.donor_blob_matches_at_merge,
    expectedChangedPaths.filter((path) => tipBlobs.get(path) === mergeBlobs.get(path)).length,
  );
  assertEqual(
    `PROVENANCE_LANE_CANDIDATE_MATCHES:${lane.id}`,
    lane.donor_blob_matches_at_candidate,
    expectedChangedPaths.length - expectedMismatches.length,
  );
  assertEqual(
    `PROVENANCE_LANE_CANDIDATE_MISMATCHES:${lane.id}`,
    lane.donor_blob_mismatches_at_candidate,
    expectedMismatches,
  );
  if (lane.receipt?.path) {
    const receiptBytes = objectBytes(candidate, lane.receipt.path);
    const candidateReceiptBlob = candidateTreeBlobs.get(lane.receipt.path) ?? null;
    assertEqual(
      `PROVENANCE_LANE_RECEIPT_SAME:${lane.id}`,
      lane.receipt.same_at_candidate,
      candidateReceiptBlob === lane.receipt.git_blob,
    );
    assertEqual(
      `PROVENANCE_LANE_RECEIPT_BLOB:${lane.id}`,
      lane.receipt.candidate_git_blob,
      candidateReceiptBlob,
    );
    assertEqual(
      `PROVENANCE_LANE_RECEIPT_SHA256:${lane.id}`,
      lane.receipt.candidate_sha256,
      sha256(receiptBytes),
    );
    assertEqual(
      `PROVENANCE_LANE_RECEIPT_BYTES:${lane.id}`,
      lane.receipt.candidate_bytes,
      receiptBytes.length,
    );
  }
}

const laneChangedPathOccurrences = mergeProvenance.admitted_lanes.flatMap(
  (lane) => lane.changed_paths,
);
const uniqueLaneChangedPaths = new Set(laneChangedPathOccurrences);
const expectedUnexplainedEdits = [
  ...expectedCorrectionOutOfGrantPaths.map((path) => ({ scope: 'C9_CORRECTION', path })),
  ...mergeProvenance.admitted_lanes.flatMap((lane) => lane.out_of_grant_paths.map(
    (path) => ({ scope: `ADMITTED_LANE:${lane.id}`, path }),
  )),
];
const expectedProvenanceAggregate = {
  admitted_lane_count: mergeProvenance.admitted_lanes.length,
  changed_path_occurrences: laneChangedPathOccurrences.length,
  unique_changed_paths: uniqueLaneChangedPaths.size,
  cross_lane_overlap_count: laneChangedPathOccurrences.length - uniqueLaneChangedPaths.size,
  out_of_grant_path_count: mergeProvenance.admitted_lanes.reduce(
    (sum, lane) => sum + lane.out_of_grant_paths.length,
    0,
  ),
  donor_blob_mismatch_at_candidate_count: mergeProvenance.admitted_lanes.reduce(
    (sum, lane) => sum + lane.donor_blob_mismatches_at_candidate.length,
    0,
  ),
  unexplained_edit_count: expectedUnexplainedEdits.length,
  unexplained_edits: expectedUnexplainedEdits,
};
assertEqual('PROVENANCE_AGGREGATE', mergeProvenance.aggregate, expectedProvenanceAggregate);
assertEqual('PROVENANCE_UNEXPLAINED_EDIT_COUNT', expectedUnexplainedEdits.length, 0);

const landedCore = mergeProvenance.landed_core_anchor;
assert(landedCore?.donor && landedCore?.merge, 'PROVENANCE_LANDED_CORE_MISSING');
const landedDonorBlobs = treeBlobMap(landedCore.donor);
const landedMergeBlobs = treeBlobMap(landedCore.merge);
const landedDonorPaths = gitText('diff', '--name-only', landedCore.delta_base, landedCore.donor)
  .split('\n')
  .filter(Boolean)
  .sort();
const expectedLandedAdaptations = landedDonorPaths
  .filter((path) => landedDonorBlobs.get(path) !== candidateTreeBlobs.get(path))
  .map((path) => ({
    path,
    donor_blob: landedDonorBlobs.get(path),
    landing_blob: landedMergeBlobs.get(path) ?? null,
    candidate_blob: candidateTreeBlobs.get(path) ?? null,
    latest_candidate_commit: latestCommitForPath(candidate, path),
  }));
assertEqual(
  'PROVENANCE_LANDED_DONOR_TREE',
  landedCore.donor_tree,
  gitText('rev-parse', `${landedCore.donor}^{tree}`),
);
assertEqual(
  'PROVENANCE_LANDED_MERGE_TREE',
  landedCore.merge_tree,
  gitText('rev-parse', `${landedCore.merge}^{tree}`),
);
assertEqual(
  'PROVENANCE_LANDED_PARENTS',
  landedCore.parents,
  gitText('show', '-s', '--format=%P', landedCore.merge).split(/\s+/u).filter(Boolean),
);
assertEqual('PROVENANCE_LANDED_DONOR_PATHS', landedCore.donor_path_count, landedDonorPaths.length);
assertEqual('PROVENANCE_LANDED_CANDIDATE_PATHS', landedCore.candidate_path_count, candidateTreeBlobs.size);
assertEqual(
  'PROVENANCE_LANDED_CANDIDATE_ONLY_PATHS',
  landedCore.candidate_only_path_count,
  [...candidateTreeBlobs.keys()].filter((path) => !landedDonorBlobs.has(path)).length,
);
assertEqual(
  'PROVENANCE_LANDED_EXACT_AT_LANDING',
  landedCore.exact_at_landing,
  landedDonorPaths.filter((path) => landedDonorBlobs.get(path) === landedMergeBlobs.get(path)).length,
);
assertEqual(
  'PROVENANCE_LANDED_EXACT_AT_CANDIDATE',
  landedCore.exact_at_candidate,
  landedDonorPaths.length - expectedLandedAdaptations.length,
);
assertEqual('PROVENANCE_LANDED_ADAPTATIONS', landedCore.adaptations, expectedLandedAdaptations);
const capabilityRows = matrixRecordsByFile.get('CAPABILITY_TRUTH_MATRIX.csv');
const directiveRows = matrixRecordsByFile.get('DIRECTIVE_COVERAGE_MATRIX.csv');
const candidateSourceCapability = capabilityRows.find((row) => row.capability_id === 'candidate-source');
const landedCoreCapability = capabilityRows.find((row) => row.capability_id === 'landed-core');
const deploymentAcceptance = directiveRows.find((row) => row.requirement_id === 'DEP-004');
assertEqual('MATRIX_CANDIDATE_SOURCE_STATUS', candidateSourceCapability?.status, 'INTEGRATED');
assertEqual('MATRIX_CANDIDATE_SOURCE_BLOCKER', candidateSourceCapability?.blocker, 'NONE');
assertEqual(
  'MATRIX_LANDED_CORE_DISPOSITION',
  landedCoreCapability?.disposition,
  `${landedCore.exact_at_candidate}/${landedCore.donor_path_count} donor-delta blobs exact at C9; ${landedCore.adaptations.length} adaptations explicit`,
);
assertEqual(
  'MATRIX_DEPLOYMENT_RUNTIME_EVIDENCE',
  deploymentAcceptance?.runtime_evidence,
  'Exact C9 baseline custody, fresh final-verifier verdict, staging deployment, target readback, and rollback remain separate gates',
);
assertEqual(
  'MATRIX_DEPLOYMENT_BLOCKER',
  deploymentAcceptance?.blocker,
  'C9 baseline custody token, fresh final-verifier verdict, later operational gates, and explicit deployment authority remain pending',
);
assertEqual(
  'MATRIX_DEPLOYMENT_DISPOSITION',
  deploymentAcceptance?.disposition,
  'No deployment acceptance is implied by the exact C9 source and evidence freeze',
);
assertEqual('PROVENANCE_RECEIPT_CANDIDATE', mergeProvenance.receipt?.candidate_sha, candidate);
assertEqual('PROVENANCE_RECEIPT_TREE', mergeProvenance.receipt?.candidate_tree_sha, candidateTree);
assertEqual('PROVENANCE_RECEIPT_PARENT', mergeProvenance.receipt?.candidate_parent_sha, REQUIRED_C2_PARENT);

assertEqual('CENSUS_SCHEMA', census.schema, 'product-truth-worktree-census.v2');
assertEqual('CENSUS_LIVE_ROWS', census.rows?.length, 96);
assertEqual('CENSUS_EXPECTED_REGISTERED_COUNT', census.expected_registered_worktree_count, 96);
assertEqual(
  'CENSUS_LIVE_REGISTERED_COUNT',
  firstDefined(census, ['live_registered_worktree_count', 'registered_worktree_count']),
  96,
);
assertEqual('CENSUS_REGISTERED_COUNT', census.registered_worktree_count, 96);
assertEqual('CENSUS_REMOVED_SAFE_COUNT', census.removed_safe_tombstone_count, 5);
assertEqual('CENSUS_REMOVED_SAFE_ROWS', census.removed_safe_tombstones?.length, 5);
assertEqual(
  'CENSUS_DURABLE_ENTRY_COUNT',
  firstDefined(census, ['durable_entry_count', 'durable_registry_count']),
  101,
);
assertEqual('CENSUS_UNKNOWN_COUNT', census.unknown_count, 0);
assertEqual('CENSUS_REMOVED_SAFE_CLASSIFICATION_COUNT', census.durable_classification_counts?.REMOVED_SAFE, 5);
assertEqual('CENSUS_BINDING_PARENT', census.candidate_binding?.direct_parent_sha, REQUIRED_C2_PARENT);
assertEqual('CENSUS_BINDING_PARENT_COUNT', census.candidate_binding?.parent_count, 1);
assertEqual('CENSUS_BINDING_REQUIRED_C2', census.candidate_binding?.required_c2_parent_sha, REQUIRED_C2_PARENT);
assertEqual('CENSUS_BINDING_SOLE_PARENT', census.candidate_binding?.sole_direct_parent_is_required_c2, true);
const censusDLaunch65 = census.authority_bindings?.D_LAUNCH_65;
assert(censusDLaunch65 !== undefined, 'CENSUS_D_LAUNCH_65_BINDING_MISSING');
for (const [label, aliases, expected] of [
  ['COMMIT', ['source_commit', 'commit'], D_LAUNCH_65.commit],
  ['TREE', ['source_tree', 'tree'], D_LAUNCH_65.tree],
  ['PARENT', ['source_parent', 'parent'], D_LAUNCH_65.parent],
  ['PATH', ['source_path', 'path'], D_LAUNCH_65.path],
  ['GIT_BLOB', ['source_git_blob', 'git_blob'], D_LAUNCH_65.git_blob],
  ['SHA256', ['source_sha256', 'sha256'], D_LAUNCH_65.sha256],
  ['BYTES', ['source_bytes', 'byte_length', 'bytes'], D_LAUNCH_65.byte_length],
  ['ARCHIVE_COMMIT', ['archive_source_commit'], D_LAUNCH_65.archive_source_commit],
  ['ARCHIVE_TREE', ['archive_source_tree'], D_LAUNCH_65.archive_source_tree],
  ['ARCHIVE_SUBTREE', ['archive_source_subtree', 'archive_subtree'], D_LAUNCH_65.archive_subtree],
]) exactAuthorityField(censusDLaunch65, `CENSUS_${label}`, aliases, expected);
assertEqual('CENSUS_D65_AMBIENT_IMPORTED', censusDLaunch65.ambient_current_main_imported_as_evidence, false);
assertEqual('CENSUS_D65_CURRENT_MAIN_OBSERVATION_ONLY', censusDLaunch65.current_main_observation_only, true);
assertEqual('CENSUS_D65_CURRENT_MAIN_ANCESTRY_UNUSED', censusDLaunch65.authority_in_current_main_ancestry, null);
assertEqual(
  'CENSUS_D65_ORIGIN_CURRENT_MAIN_ANCESTRY_UNUSED',
  censusDLaunch65.authority_in_origin_current_main_ancestry,
  null,
);

const liveNames = new Set(census.rows.map((row) => row.worktree_name));
assertEqual('CENSUS_UNIQUE_LIVE_NAMES', liveNames.size, 96);
assert(liveNames.has('truth-a'), 'CENSUS_TRUTH_A_MISSING');
assert(liveNames.has('truth-b'), 'CENSUS_TRUTH_B_MISSING');
assertEqual(
  'CENSUS_SOURCE_COMMAND_HASH_BASIS',
  census.source_command_sha256_basis,
  'SORTED_PORCELAIN_RECORDS_WITH_TRUTH_A_HEAD_NORMALIZED_TO_EXACT_CANDIDATE',
);
const truthARows = census.rows.filter((row) => row.worktree_name === 'truth-a');
assertEqual('CENSUS_TRUTH_A_ROW_COUNT', truthARows.length, 1);
const truthARow = truthARows[0];
assertEqual('CENSUS_TRUTH_A_HEAD', truthARow.head_sha, candidate);
assertEqual('CENSUS_TRUTH_A_TREE', truthARow.tree_sha, candidateTree);
assertEqual('CENSUS_TRUTH_A_CLASSIFICATION', truthARow.classification, 'MERGED_RETAINED');
assertEqual(
  'CENSUS_TRUTH_A_HEAD_BASIS',
  truthARow.head_identity_basis,
  'EXACT_FROZEN_CANDIDATE_NOT_MUTABLE_EVIDENCE_DESCENDANT_HEAD',
);
assertEqual('CENSUS_TRUTH_A_MUTABLE_HEAD_RECORDED', truthARow.mutable_custody_head_recorded, false);
assertEqual(
  'CENSUS_TRUTH_A_STATUS_HASH_BASIS',
  truthARow.status_porcelain_v2_sha256_basis,
  'DETERMINISTIC_CLEAN_STATUS_WITH_HEAD_NORMALIZED_TO_EXACT_CANDIDATE',
);
assertEqual(
  'CENSUS_TRUTH_A_CUSTODY_NORMALIZATION',
  truthARow.exact_candidate_custody_normalization,
  'SEALED_HEAD_WAS_EXACT_CANDIDATE_OR_EXACT_15_PATH_EVIDENCE_DESCENDANT; V4_DESCENDANT_ALLOWLIST_IS_EXACT_21_GENERATED_PLUS_5_BOUND_TOOLING_WITHOUT_LIVE_RECENSUS',
);
assertEqual('CENSUS_TRUTH_A_DIRTY_TRACKED', truthARow.dirty_tracked_paths, []);
assertEqual('CENSUS_TRUTH_A_UNTRACKED', truthARow.untracked_paths, []);
const expectedTombstoneNames = new Set(['prep-act', 'shard-prov', 'shard-sec', 'v-clean', 'v-cockpit']);
const observedTombstoneNames = new Set();
for (const tombstone of census.removed_safe_tombstones) {
  const name = tombstone.worktree_name;
  assert(expectedTombstoneNames.has(name), `CENSUS_UNEXPECTED_TOMBSTONE:${String(name)}`);
  assert(!observedTombstoneNames.has(name), `CENSUS_DUPLICATE_TOMBSTONE:${name}`);
  observedTombstoneNames.add(name);
  for (const field of [
    'tombstone_id',
    'durable_entry_kind',
    'former_absolute_path',
    'worktree_name',
    'live_registration_state',
    'registered_in_live_inventory',
    'classification',
    'disposition',
    'removal_authorized',
    'removal_authority_id',
    'removal_authority_source_commit',
    'removal_authority_source_path',
    'removal_authority_source_git_blob',
    'removal_authority_source_sha256',
    'removal_authority_candidate_payload_path',
    'removal_authority_candidate_payload_git_blob',
    'removal_authority_candidate_payload_sha256',
    'removal_time_utc',
    'removal_time_state',
    'prior_lane_role',
    'candidate_source_ownership',
    'disposition_reason',
    'disposition_evidence',
    'archive_source_commit',
    'archive_source_tree',
    'archive_source_subtree',
    'accepted_output_count',
    'accepted_output_state',
    'outputs',
  ]) {
    assert(Object.hasOwn(tombstone, field), `CENSUS_TOMBSTONE_FIELD_MISSING:${name}:${field}`);
  }
  assertEqual(`CENSUS_TOMBSTONE_KIND:${name}`, tombstone.durable_entry_kind, 'REMOVED_SAFE_TOMBSTONE');
  assertEqual(`CENSUS_TOMBSTONE_LIVE_STATE:${name}`, tombstone.live_registration_state, 'REMOVED_CONFIRMED_ABSENT');
  assertEqual(`CENSUS_TOMBSTONE_REGISTERED:${name}`, tombstone.registered_in_live_inventory, false);
  assertEqual(`CENSUS_TOMBSTONE_CLASSIFICATION:${name}`, tombstone.classification, 'REMOVED_SAFE');
  assertEqual(`CENSUS_TOMBSTONE_DISPOSITION:${name}`, tombstone.disposition, 'REMOVED_SAFE');
  assertEqual(`CENSUS_TOMBSTONE_AUTHORIZED:${name}`, tombstone.removal_authorized, true);
  assertEqual(`CENSUS_TOMBSTONE_AUTHORITY_ID:${name}`, tombstone.removal_authority_id, 'D-LAUNCH-65');
  assertEqual(`CENSUS_TOMBSTONE_AUTHORITY_COMMIT:${name}`, tombstone.removal_authority_source_commit, D_LAUNCH_65.commit);
  assertEqual(`CENSUS_TOMBSTONE_AUTHORITY_PATH:${name}`, tombstone.removal_authority_source_path, D_LAUNCH_65.path);
  assertEqual(`CENSUS_TOMBSTONE_AUTHORITY_BLOB:${name}`, tombstone.removal_authority_source_git_blob, D_LAUNCH_65.git_blob);
  assertEqual(`CENSUS_TOMBSTONE_AUTHORITY_SHA256:${name}`, tombstone.removal_authority_source_sha256, D_LAUNCH_65.sha256);
  assertEqual(`CENSUS_TOMBSTONE_ARCHIVE_COMMIT:${name}`, tombstone.archive_source_commit, D_LAUNCH_65.archive_source_commit);
  assertEqual(`CENSUS_TOMBSTONE_ARCHIVE_TREE:${name}`, tombstone.archive_source_tree, D_LAUNCH_65.archive_source_tree);
  assertEqual(`CENSUS_TOMBSTONE_ARCHIVE_SUBTREE:${name}`, tombstone.archive_source_subtree, D_LAUNCH_65.archive_subtree);
  const authorityPayloadBytes = objectBytes(candidate, tombstone.removal_authority_candidate_payload_path);
  assertEqual(
    `CENSUS_TOMBSTONE_AUTHORITY_PAYLOAD_BLOB:${name}`,
    tombstone.removal_authority_candidate_payload_git_blob,
    gitBlobOid(authorityPayloadBytes),
  );
  assertEqual(
    `CENSUS_TOMBSTONE_AUTHORITY_PAYLOAD_SHA256:${name}`,
    tombstone.removal_authority_candidate_payload_sha256,
    sha256(authorityPayloadBytes),
  );
  assertEqual(`CENSUS_TOMBSTONE_OUTPUT_COUNT:${name}`, tombstone.outputs.length, tombstone.accepted_output_count);
  for (const output of tombstone.outputs) {
    assertEqual(`CENSUS_TOMBSTONE_OUTPUT_CANDIDATE:${name}`, output.candidate_commit, candidate);
    assertEqual(`CENSUS_TOMBSTONE_OUTPUT_BYTE_EXACT:${name}`, output.byte_exact, true);
    const bytes = objectBytes(candidate, output.candidate_path);
    assertEqual(`CENSUS_TOMBSTONE_OUTPUT_SHA256:${name}:${output.candidate_path}`, output.candidate_sha256, sha256(bytes));
    assertEqual(`CENSUS_TOMBSTONE_OUTPUT_BLOB:${name}:${output.candidate_path}`, output.candidate_git_blob, gitBlobOid(bytes));
    assertEqual(`CENSUS_TOMBSTONE_OUTPUT_BYTES:${name}:${output.candidate_path}`, output.candidate_bytes, bytes.length);
  }
}
assertEqual('CENSUS_TOMBSTONE_NAME_SET', observedTombstoneNames.size, expectedTombstoneNames.size);

const ledger = objectBytes(candidate, 'WORKTREE_LEDGER.md').toString('utf8');
assert(/101 entries\s*=\s*96 live Git worktrees\s*\+\s*5/u.test(ledger), 'WORKTREE_LEDGER_DURABLE_COUNT_MISSING');
const liveLedgerSection = ledger.split(/^##\s+`?REMOVED_SAFE`? tombstones\s*$/mu)[0];
const liveLedgerRows = liveLedgerSection.match(/^\|\s*~\/[^|]+\|.*$/gmu) ?? [];
assertEqual('WORKTREE_LEDGER_LIVE_ROW_COUNT', liveLedgerRows.length, 96);
assertEqual('WORKTREE_LEDGER_TRUTH_A_ROW_COUNT', liveLedgerRows.filter((row) => /\|\s*~\/truth-a\s*\|/u.test(row)).length, 1);
assertEqual('WORKTREE_LEDGER_TRUTH_B_ROW_COUNT', liveLedgerRows.filter((row) => /\|\s*~\/truth-b\s*\|/u.test(row)).length, 1);

assertEqual('MANIFEST_SCHEMA', manifest.schema, 'product-truth-manifest.v4');
assertEqual('MANIFEST_CANDIDATE_PARENT', manifest.candidate_parent_sha, REQUIRED_C2_PARENT);
assertEqual('MANIFEST_CANDIDATE_PARENT_COUNT', manifest.candidate_parent_count, 1);
assertEqual('MANIFEST_EXACT_OUTPUT_COUNT', manifest.exact_generated_output_count, EXACT_EVIDENCE_OUTPUTS.length);
assertEqual('MANIFEST_EXACT_OUTPUTS', manifest.exact_generated_outputs, [...EXACT_EVIDENCE_OUTPUTS]);
assertEqual('MANIFEST_EXACT_TOOLING_COUNT', manifest.exact_tooling_file_count, EXACT_EVIDENCE_TOOLING_FILES.length);
assertEqual('MANIFEST_EXACT_TOOLING_FILES', manifest.exact_tooling_files, [...EXACT_EVIDENCE_TOOLING_FILES]);
assertEqual('MANIFEST_EXACT_DESCENDANT_COUNT', manifest.exact_descendant_path_count, EXACT_EVIDENCE_DESCENDANT_FILES.length);
assertEqual('MANIFEST_EXACT_DESCENDANT_PATHS', manifest.exact_descendant_paths, [...EXACT_EVIDENCE_DESCENDANT_FILES]);
assertEqual('MANIFEST_TOOLING_BUNDLE_SHA256', manifest.tooling_bundle_sha256, evidenceSelection.tooling_bundle_sha256);
assert(Array.isArray(manifest.entries), 'MANIFEST_ENTRIES_MISSING');
assertEqual('MANIFEST_ENTRY_COUNT', manifest.entry_count, manifest.entries.length);
const manifestEntries = new Map();
for (const entry of manifest.entries) {
  const path = firstDefined(entry, ['path', 'relative_path']);
  assert(typeof path === 'string' && path.length > 0, 'MANIFEST_ENTRY_PATH_MISSING');
  campaignPath(path);
  assert(path !== 'MANIFEST.json' && path !== 'MANIFEST.sha256', `MANIFEST_SELF_ENTRY_FORBIDDEN:${path}`);
  assert(!manifestEntries.has(path), `MANIFEST_DUPLICATE_ENTRY:${path}`);
  const bytes = evidenceBytes(path);
  assertEqual(`MANIFEST_SHA256:${path}`, entry.sha256, sha256(bytes));
  assertEqual(`MANIFEST_BYTES:${path}`, firstDefined(entry, ['byte_length', 'bytes']), bytes.length);
  assertEqual(`MANIFEST_GIT_BLOB:${path}`, entry.git_blob, gitBlobOid(bytes));
  manifestEntries.set(path, entry);
}

const campaignTreePaths = gitText('ls-tree', '-r', '--name-only', evidenceCommit, '--', CAMPAIGN_ROOT)
  .split('\n')
  .filter(Boolean)
  .map((path) => path.slice(`${CAMPAIGN_ROOT}/`.length))
  .filter((path) => path !== 'MANIFEST.json' && path !== 'MANIFEST.sha256')
  .sort();
const manifestedPaths = [...manifestEntries.keys()].sort();
assertEqual('MANIFEST_COMPLETE_TREE_COVERAGE', manifestedPaths, campaignTreePaths);
assertEqual('MANIFEST_ENTRY_SORT_ORDER', [...manifestEntries.keys()], manifestedPaths);
const manifestInventoryLines = manifest.entries.map((entry) => {
  const path = firstDefined(entry, ['path', 'relative_path']);
  return `${path}\0${entry.sha256}\0${firstDefined(entry, ['byte_length', 'bytes'])}\0${entry.git_blob}`;
});
assertEqual(
  'MANIFEST_INVENTORY_SHA256',
  manifest.inventory_sha256,
  sha256(Buffer.from(`${manifestInventoryLines.join('\n')}\n`, 'utf8')),
);

const compatibilityManifest = evidenceText('MANIFEST.sha256');
const compatibilityRows = compatibilityManifest.trimEnd().split('\n').map((line) => {
  const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
  assert(match !== null, `MANIFEST_SHA256_ROW_INVALID:${line}`);
  return { sha256: match[1], path: match[2] };
});
const compatibilityMap = new Map();
for (const row of compatibilityRows) {
  assert(!compatibilityMap.has(row.path), `MANIFEST_SHA256_DUPLICATE:${row.path}`);
  const bytes = row.path === 'MANIFEST.json' ? evidenceBytes('MANIFEST.json') : evidenceBytes(row.path);
  assertEqual(`MANIFEST_SHA256_HASH:${row.path}`, row.sha256, sha256(bytes));
  compatibilityMap.set(row.path, row.sha256);
}
assertEqual(
  'MANIFEST_SHA256_PATHS',
  [...compatibilityMap.keys()].sort(),
  ['MANIFEST.json', ...manifestedPaths].sort(),
);

process.stdout.write(`${JSON.stringify({
  result: 'EXACT_CANDIDATE_EVIDENCE_VERIFIED',
  candidate_sha: candidate,
  candidate_tree_sha: candidateTree,
  candidate_parent_sha: REQUIRED_C2_PARENT,
  evidence_ref: requestedEvidenceRef,
  evidence_commit: evidenceCommit,
  locked_inputs: inputs.length,
  payload_members: payloadMetadata.members.length,
  matrix_candidate_cells: matrixCandidateCellCount,
  live_worktrees: census.rows.length,
  removed_safe_tombstones: census.removed_safe_tombstones.length,
  durable_census_entries: 101,
  manifest_entries: manifest.entries.length,
})}\n`);
