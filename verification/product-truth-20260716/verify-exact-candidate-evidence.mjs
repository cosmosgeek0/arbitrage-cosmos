#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const REQUIRED_C2_PARENT = 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561';
const REJECTED_PREDECESSOR_FRAGMENT = '41752d6';
const CAMPAIGN_ROOT = 'verification/product-truth-20260716';

const D_LAUNCH_65 = Object.freeze({
  commit: '9c8c9f98c7fbd491fb97fce70d723b6c8bed2a4d',
  tree: '7a5fc0d56fec5e3bf5c345bcb7c476896f3509a7',
  parent: 'f0c030d37b762198b1e34d6b689112a433efa4c8',
  path: 'QL_DIRECTOR_STATE.md',
  git_blob: 'e8fb856c19a14c4a5278e4c7c8f7e2cd51a85b12',
  sha256: '9471fef43baf638d7cc8bd958c2e45b881405cc14178cdfb24c78ebec1ed6ffb',
  byte_length: 73_589,
  ruling_lines: '288-289',
  archive_source_commit: '0e4b364849075a454d7dd624ca068c238f4196c2',
  archive_source_tree: '45eb6c6128f0a24cf17d242b704a0079c8e5a6ab',
  archive_subtree: 'bf67e1bb6ba154ef7ae89e2907149d572fa9daa8',
});

const MATRIX_SPECS = Object.freeze([
  Object.freeze({ file: 'DIRECTIVE_COVERAGE_MATRIX.csv', count: 153 }),
  Object.freeze({ file: 'CAPABILITY_TRUTH_MATRIX.csv', count: 23 }),
  Object.freeze({ file: 'COCKPIT_BINDING_MATRIX.csv', count: 178 }),
]);

const GENERATED_ACTIVE_ARTIFACTS = Object.freeze([
  'INPUTS.lock',
  'DIRECTIVE_COVERAGE_MATRIX.csv',
  'CAPABILITY_TRUTH_MATRIX.csv',
  'COCKPIT_BINDING_MATRIX.csv',
  'C2_PROOF_BINDING.json',
  'EVIDENCE_SELECTION.json',
  'MERGE_PROVENANCE.json',
  'WORKTREE_CENSUS.json',
  'LOCKED_INPUT_PAYLOADS.json',
  'MANIFEST.json',
]);

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
const candidateTree = gitText('rev-parse', `${candidate}^{tree}`);
const parentRecord = gitText('rev-list', '--parents', '-n', '1', candidate).split(/\s+/u);
assertEqual('CANDIDATE_PARENT_COUNT', parentRecord.length - 1, 1);
assertEqual('CANDIDATE_SOLE_DIRECT_PARENT', parentRecord[1], REQUIRED_C2_PARENT);
const evidenceCommit = gitText('rev-parse', `${requestedEvidenceRef}^{commit}`);
assertEqual(
  'CANDIDATE_ANCESTOR_OF_EVIDENCE_REF',
  runGit(['merge-base', '--is-ancestor', candidate, evidenceCommit], { allowFailure: true }).status,
  0,
);
const postCandidatePaths = gitText('diff', '--name-only', candidate, evidenceCommit, '--')
  .split('\n')
  .filter(Boolean);
for (const path of postCandidatePaths) {
  assert(path.startsWith(`${CAMPAIGN_ROOT}/`), `POST_CANDIDATE_PATH_OUTSIDE_CAMPAIGN:${path}`);
}

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
    'source_candidate',
    'exact_candidate_sha',
    'candidate_commit',
  ]);
  const treeKeys = new Set([
    'candidate_tree',
    'candidate_tree_sha',
    'source_candidate_tree',
    'exact_candidate_tree',
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
}

const inputLock = evidenceJson('INPUTS.lock');
const proofBinding = evidenceJson('C2_PROOF_BINDING.json');
const evidenceSelection = evidenceJson('EVIDENCE_SELECTION.json');
const mergeProvenance = evidenceJson('MERGE_PROVENANCE.json');
const census = evidenceJson('WORKTREE_CENSUS.json');
const payloadMetadata = evidenceJson('LOCKED_INPUT_PAYLOADS.json');
const manifest = evidenceJson('MANIFEST.json');

for (const [label, artifact] of [
  ['INPUTS_LOCK', inputLock],
  ['C2_PROOF_BINDING', proofBinding],
  ['EVIDENCE_SELECTION', evidenceSelection],
  ['MERGE_PROVENANCE', mergeProvenance],
  ['WORKTREE_CENSUS', census],
  ['MANIFEST', manifest],
]) {
  assertCandidateBound(label, artifact);
  assertRecursiveExactBindings(label, artifact);
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
let matrixCandidateCellCount = 0;
for (const spec of MATRIX_SPECS) {
  const matrix = parseCsv(evidenceText(spec.file), spec.file);
  assert(matrix.headers.includes('candidate_sha'), `MATRIX_CANDIDATE_COLUMN_MISSING:${spec.file}`);
  assert(matrix.headers.includes('source_input_ids'), `MATRIX_SOURCE_INPUT_IDS_COLUMN_MISSING:${spec.file}`);
  assertEqual(`MATRIX_ROW_COUNT:${spec.file}`, matrix.records.length, spec.count);
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

const inputs = inputRows(inputLock);
assertEqual('LOCKED_INPUT_COUNT', inputs.length, 61);
const inputIds = new Set();
for (const [index, row] of inputs.entries()) {
  const inputId = firstDefined(row, ['input_id', 'id', 'name']);
  assert(typeof inputId === 'string' && inputId.length > 0, `INPUT_ID_MISSING:${index}`);
  assert(!inputIds.has(inputId), `DUPLICATE_INPUT_ID:${inputId}`);
  inputIds.add(inputId);
  assert(nonEmptyExplicit(row.source), `INPUT_SOURCE_MISSING:${inputId}`);
  assert(nonEmptyExplicit(row.disposition), `INPUT_DISPOSITION_MISSING:${inputId}`);
  const matrixIds = firstDefined(row, [
    'matrix_requirement_ids',
    'matrix_ids',
    'source_requirement_ids',
  ]);
  assert(Array.isArray(matrixIds) && matrixIds.length > 0, `INPUT_MATRIX_IDS_MISSING:${inputId}`);
  assert(new Set(matrixIds).size === matrixIds.length, `INPUT_MATRIX_IDS_DUPLICATE:${inputId}`);
  for (const matrixId of matrixIds) {
    assert(matrixRequirementIds.has(matrixId), `INPUT_MATRIX_ID_UNKNOWN:${inputId}:${String(matrixId)}`);
  }
}
for (const sourceInputId of matrixSourceInputIds) {
  assert(inputIds.has(sourceInputId), `MATRIX_SOURCE_INPUT_ID_UNKNOWN:${sourceInputId}`);
}
for (const inputId of inputIds) {
  assert(matrixSourceInputIds.has(inputId), `LOCKED_INPUT_NOT_REFERENCED_BY_MATRIX:${inputId}`);
}

assert(Array.isArray(payloadMetadata.members), 'PAYLOAD_MEMBERS_MISSING');
assertEqual('PAYLOAD_MEMBER_COUNT', payloadMetadata.members.length, 23);
assertEqual(
  'PAYLOAD_TOTAL_EXTERNAL_MEMBERS',
  firstDefined(payloadMetadata, ['totals.external_input_members', 'external_input_member_count']),
  23,
);
assert(Array.isArray(payloadMetadata.authority_members), 'PAYLOAD_AUTHORITY_MEMBERS_MISSING');
assertEqual('PAYLOAD_AUTHORITY_MEMBER_COUNT', payloadMetadata.authority_members.length, 2);
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

const dLaunchPayload = payloadMetadata.authority_members.find((member) => (
  firstDefined(member, ['member_id', 'authority_id']) === 'authority:D_LAUNCH_65'
));
assert(dLaunchPayload !== undefined, 'D_LAUNCH_65_PAYLOAD_MEMBER_MISSING');
const verifiedDLaunchPayload = verifyPayloadMember(dLaunchPayload, 'authority:D_LAUNCH_65');
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

const liveNames = new Set(census.rows.map((row) => row.worktree_name));
assertEqual('CENSUS_UNIQUE_LIVE_NAMES', liveNames.size, 96);
assert(liveNames.has('truth-a'), 'CENSUS_TRUTH_A_MISSING');
assert(liveNames.has('truth-b'), 'CENSUS_TRUTH_B_MISSING');
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

assertEqual('MANIFEST_SCHEMA', manifest.schema, 'product-truth-manifest.v2');
assertEqual('MANIFEST_CANDIDATE_PARENT', manifest.candidate_parent_sha, REQUIRED_C2_PARENT);
assertEqual('MANIFEST_CANDIDATE_PARENT_COUNT', manifest.candidate_parent_count, 1);
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
