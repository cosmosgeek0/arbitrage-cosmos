#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CAMPAIGN_BRANCH,
  C9_CORRECTION_GRANTS,
  D_LAUNCH_65_AUTHORITY,
  EXACT_EVIDENCE_OUTPUTS,
  EXTERNAL_INPUT_SPECS,
  LOCK_INVENTORY_MATRIX_REQUIREMENT_ID,
  PREDECESSOR_CANDIDATE,
  PREDECESSOR_TREE,
  REJECTED_C8_CANDIDATE,
  REJECTED_C8_TREE,
  REJECTED_CANDIDATE_SHAS,
  REJECTED_SELECTION_HISTORY,
  REQUIRED_C2_PARENT,
  REQUIRED_MATRIX_COUNTS,
  VFINAL5_AUTHORITY,
  WAVE_ARCHIVE_ORIGINS,
} from './campaign-input-registry.mjs';

const repo = process.cwd();
const rootRelative = 'verification/product-truth-20260716';
const root = resolve(repo, rootRelative);
const candidateArg = process.argv.indexOf('--candidate');
const requiredParentArg = process.argv.indexOf('--required-parent');
const candidate = candidateArg >= 0 ? process.argv[candidateArg + 1] : null;
const requiredParent = requiredParentArg >= 0
  ? process.argv[requiredParentArg + 1]
  : REQUIRED_C2_PARENT;
const selfTest = process.argv.includes('--self-test');

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

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
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

function run(command, args, { allowFailure = false, encoding = 'utf8' } = {}) {
  const result = spawnSync(command, args, {
    cwd: repo,
    encoding,
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC', GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 128 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed: ${String(result.stderr)}`);
  }
  return result;
}

function gitText(...args) { return run('git', args).stdout.trim(); }
function gitBytes(...args) { return run('git', args, { encoding: null }).stdout; }
function candidateBytes(path) { return gitBytes('show', `${candidate}:${path}`); }
function candidateText(path) { return candidateBytes(path).toString('utf8'); }
function candidateJson(path) { return JSON.parse(candidateText(path)); }
function candidateBlob(path) { return gitText('rev-parse', `${candidate}:${path}`); }
function writeJson(name, value) {
  writeFileSync(resolve(root, name), `${JSON.stringify(value, null, 2)}\n`);
}
function readJson(name) { return JSON.parse(readFileSync(resolve(root, name), 'utf8')); }
function campaignPath(name) { return `${rootRelative}/${name}`; }

function treeBlobMap(ref) {
  const records = gitBytes('ls-tree', '-r', '-z', ref).toString('utf8').split('\0').filter(Boolean);
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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') {
      row.push(field.replace(/\r$/u, ''));
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  assert(!quoted, 'CSV_UNTERMINATED_QUOTE');
  return rows;
}

function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function renderCsv(rows) { return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`; }

function exactTrackedSource(relativePath) {
  const bytes = candidateBytes(relativePath);
  return {
    kind: 'CANDIDATE_GIT_BLOB',
    candidate_commit: candidate,
    candidate_tree: candidateTree,
    relative_path: relativePath,
    git_blob: candidateBlob(relativePath),
    sha256: sha256(bytes),
    byte_length: bytes.length,
    content_available: true,
  };
}

function dispositionFor(authority, supersededBy = null) {
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

function normalizeId(value) {
  return String(value).replace(/[^A-Za-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');
}

function upgradeTracked(row, group, prefix) {
  const relativePath = row.relative_path;
  const source = exactTrackedSource(relativePath);
  const inputId = `${prefix}:${row.id}`;
  return {
    input_id: inputId,
    legacy_id: row.id,
    input_class: group,
    authority: row.authority,
    source,
    disposition: dispositionFor(row.authority, row.superseded_by),
    matrix_requirement_ids: [LOCK_INVENTORY_MATRIX_REQUIREMENT_ID],
  };
}

function replaceExact(value) {
  if (Array.isArray(value)) return value.map(replaceExact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceExact(child)]));
  }
  if (typeof value !== 'string') return value;
  return value
    .replaceAll('SELF_COMMIT_UNBOUND_USE_EXACT_EVIDENCE_DESCENDANT', candidate)
    .replaceAll(PREDECESSOR_CANDIDATE, candidate)
    .replaceAll(PREDECESSOR_TREE, candidateTree);
}

function normalizeExactMatrixText(value) {
  return String(value)
    .replaceAll('exact-C2', 'exact-C9')
    .replaceAll('EXACT_C2_', 'EXACT_C9_')
    .replaceAll('exact-C browser', 'exact-C9 browser')
    .replaceAll('exact-C cockpit', 'exact-C9 cockpit');
}

function generateMatrix(name, expectedCount, candidateColumn, idColumns, allInputIds, rowOverrides = new Map()) {
  const rows = parseCsv(candidateText(campaignPath(name)));
  assert(rows.length === expectedCount + 1, `${name}_ROW_COUNT:${rows.length - 1}`);
  const header = rows[0];
  const candidateIndex = header.indexOf(candidateColumn);
  assert(candidateIndex >= 0, `${name}_CANDIDATE_COLUMN_MISSING`);
  const requirementIndex = header.indexOf('requirement_id');
  if (name === 'DIRECTIVE_COVERAGE_MATRIX.csv') {
    assert(requirementIndex >= 0, `${name}_REQUIREMENT_COLUMN_MISSING`);
    const inventoryRequirementRows = rows.slice(1).filter(
      (row) => row[requirementIndex] === LOCK_INVENTORY_MATRIX_REQUIREMENT_ID,
    );
    assert(
      inventoryRequirementRows.length === 1,
      `${name}_LOCK_INVENTORY_REQUIREMENT_COUNT:${inventoryRequirementRows.length}`,
    );
  }
  let sourceIndex = header.indexOf('source_input_ids');
  if (sourceIndex < 0) { header.push('source_input_ids'); sourceIndex = header.length - 1; }
  const unique = new Set();
  const appliedOverrides = new Set();
  for (let index = 1; index < rows.length; index += 1) {
    while (rows[index].length < header.length) rows[index].push('');
    rows[index] = rows[index].map(normalizeExactMatrixText);
    rows[index][candidateIndex] = candidate;
    const identity = idColumns.map((column) => rows[index][header.indexOf(column)]).join(':');
    assert(!unique.has(identity), `${name}_DUPLICATE:${identity}`);
    unique.add(identity);
    const overrides = rowOverrides.get(identity);
    if (overrides) appliedOverrides.add(identity);
    for (const [field, value] of Object.entries(overrides ?? {})) {
      const fieldIndex = header.indexOf(field);
      assert(fieldIndex >= 0, `${name}_OVERRIDE_FIELD_MISSING:${identity}:${field}`);
      rows[index][fieldIndex] = value;
    }
    if (name === 'DIRECTIVE_COVERAGE_MATRIX.csv'
      && rows[index][requirementIndex] === LOCK_INVENTORY_MATRIX_REQUIREMENT_ID) {
      rows[index][sourceIndex] = allInputIds.join(';');
    } else {
      rows[index][sourceIndex] = 'candidate:STATE';
    }
  }
  for (const identity of rowOverrides.keys()) {
    assert(appliedOverrides.has(identity), `${name}_OVERRIDE_ROW_MISSING:${identity}`);
  }
  writeFileSync(resolve(root, name), renderCsv(rows));
}

function registrySelfTest() {
  assert(REQUIRED_C2_PARENT === requiredParent, 'SELF_TEST_PARENT_DRIFT');
  assert(EXTERNAL_INPUT_SPECS.length === 23, 'SELF_TEST_EXTERNAL_COUNT');
  assert(new Set(EXTERNAL_INPUT_SPECS.map((row) => row.inputId)).size === 23, 'SELF_TEST_EXTERNAL_IDS');
  assert(Object.values(REQUIRED_MATRIX_COUNTS).slice(0, 3).reduce((sum, count) => sum + count, 0) === 354, 'SELF_TEST_MATRIX_TOTAL');
  assert(D_LAUNCH_65_AUTHORITY.commit.length === 40, 'SELF_TEST_D65');
  process.stdout.write(`${JSON.stringify({ self_test: true, external_inputs: 23, locked_inputs: 61, matrix_cells: 354 })}\n`);
}

if (selfTest) {
  registrySelfTest();
  process.exit(0);
}

assert(/^[a-f0-9]{40}$/u.test(candidate ?? ''), 'EXACT_FULL_CANDIDATE_SHA_REQUIRED');
assert(/^[a-f0-9]{40}$/u.test(requiredParent ?? ''), 'EXACT_FULL_REQUIRED_PARENT_SHA_REQUIRED');
assert(requiredParent === REQUIRED_C2_PARENT, 'IMMUTABLE_C2_PARENT_MISMATCH');
assert(!REJECTED_CANDIDATE_SHAS.includes(candidate), `REJECTED_CANDIDATE_RELABEL_ATTEMPT:${candidate}`);
assert(gitText('rev-parse', `${candidate}^{commit}`) === candidate, 'CANDIDATE_COMMIT_MISSING');
const parents = gitText('show', '-s', '--format=%P', candidate).split(/\s+/u).filter(Boolean);
assert(parents.length === 1, `CANDIDATE_PARENT_COUNT:${parents.length}`);
assert(parents[0] === requiredParent, `CANDIDATE_DIRECT_PARENT:${parents[0]}`);
const candidateTree = gitText('rev-parse', `${candidate}^{tree}`);
const candidateTreeBlobs = treeBlobMap(candidate);
const candidateRootState = candidateText('STATE.md');
assert(candidateRootState.includes('| Account A correction candidate C9 |'), 'C9_SOURCE_STATE_MARKER_MISSING');

// The census must observe a clean custody bridge before any other evidence file is changed.
run(process.execPath, [resolve(root, 'generate-worktree-census.mjs'), candidate]);
const exactCensus = readJson('WORKTREE_CENSUS.json');

const seedLock = candidateJson(campaignPath('INPUTS.lock'));
const sourcePayloadMetadata = candidateJson(campaignPath('LOCKED_INPUT_PAYLOADS.json'));
const payloadById = new Map(sourcePayloadMetadata.members.map((row) => [row.input_id, row]));
assert(payloadById.size === 23, `PAYLOAD_MEMBER_COUNT:${payloadById.size}`);

const externalInputs = EXTERNAL_INPUT_SPECS.map((spec) => {
  const payload = payloadById.get(spec.inputId);
  assert(payload, `PAYLOAD_MEMBER_MISSING:${spec.inputId}`);
  const relativePath = campaignPath(payload.payload_relative_path);
  const source = exactTrackedSource(relativePath);
  assert(source.sha256 === spec.expectedSha256, `PAYLOAD_SHA256:${spec.inputId}`);
  assert(source.git_blob === payload.git_blob, `PAYLOAD_GIT_BLOB:${spec.inputId}`);
  return {
    input_id: spec.inputId,
    legacy_id: spec.legacyId,
    input_class: spec.inputClass,
    authority: spec.authority,
    content_oid: source.git_blob,
    sha256: source.sha256,
    byte_length: source.byte_length,
    source: {
      ...source,
      kind: 'CANDIDATE_TRACKED_PAYLOAD',
      original_path_advisory: spec.originalPath,
      independently_rehashable_in_single_branch_clone: true,
    },
    disposition: dispositionFor(spec.authority, spec.supersededBy),
    matrix_requirement_ids: [LOCK_INVENTORY_MATRIX_REQUIREMENT_ID],
  };
});

const controlling = externalInputs.filter((row) => row.input_class === 'CONTROLLING_EXTERNAL');
const externalSuperseded = externalInputs.filter((row) => row.input_class === 'SUPERSEDED_EXTERNAL');
const candidateTracked = seedLock.candidate_tracked_law_and_locks.map((row) =>
  upgradeTracked(row, 'CANDIDATE_TRACKED_LAW_OR_LOCK', 'candidate'));
const waveInputs = seedLock.defect_wave_inputs.map((row) => {
  const upgraded = upgradeTracked(row, 'DEFECT_WAVE_INPUT', 'wave');
  upgraded.authorized_origin = {
    authority: 'D-LAUNCH-65',
    archive_commit: D_LAUNCH_65_AUTHORITY.archive_source_commit,
    ...WAVE_ARCHIVE_ORIGINS[row.id],
    source_git_blob: upgraded.source.git_blob,
    source_sha256: upgraded.source.sha256,
    source_byte_length: upgraded.source.byte_length,
    candidate_byte_exact: true,
  };
  return upgraded;
});
const trackedSuperseded = seedLock.superseded_reference_inputs
  .filter((row) => row.relative_path)
  .map((row) => upgradeTracked(row, 'SUPERSEDED_TRACKED_REFERENCE', 'superseded'));
const absent = seedLock.absent_named_superseded_inputs.map((row) => ({
  input_id: `absent:${normalizeId(row.name)}`,
  legacy_id: row.name,
  input_class: 'ABSENT_NAMED_SUPERSEDED_INPUT',
  authority: 'ABSENT_SUPERSEDED_REFERENCE_ONLY',
  source: {
    kind: 'DECLARED_ABSENCE',
    content_available: false,
    sha256: null,
    git_blob: null,
    byte_length: null,
  },
  disposition: {
    state: 'ABSENT_SUPERSEDED_REFERENCE_ONLY',
    effect: 'OMIT',
    explicit: true,
    superseded_by: row.superseded_by,
  },
  matrix_requirement_ids: [LOCK_INVENTORY_MATRIX_REQUIREMENT_ID],
}));
const inputs = [...controlling, ...candidateTracked, ...waveInputs, ...trackedSuperseded, ...externalSuperseded, ...absent];
assert(inputs.length === 61, `LOCKED_INPUT_COUNT:${inputs.length}`);
assert(new Set(inputs.map((row) => row.input_id)).size === 61, 'LOCKED_INPUT_ID_DUPLICATE');

function authorityPayload(memberId) {
  const member = sourcePayloadMetadata.authority_members.find((row) => row.member_id === memberId);
  assert(member, `AUTHORITY_PAYLOAD_MISSING:${memberId}`);
  return exactTrackedSource(campaignPath(member.payload_relative_path));
}
const d65Payload = authorityPayload('authority:D_LAUNCH_65');
assert(d65Payload.sha256 === D_LAUNCH_65_AUTHORITY.sha256, 'D65_PAYLOAD_SHA256');
assert(d65Payload.git_blob === D_LAUNCH_65_AUTHORITY.git_blob, 'D65_PAYLOAD_BLOB');
const vfinal5Payload = authorityPayload('authority:VFINAL5_RECEIPT');
assert(vfinal5Payload.sha256 === VFINAL5_AUTHORITY.sha256, 'VFINAL5_PAYLOAD_SHA256');
assert(vfinal5Payload.git_blob === VFINAL5_AUTHORITY.git_blob, 'VFINAL5_PAYLOAD_BLOB');

const exactPayloadMembers = externalInputs.map((row) => ({
  input_id: row.input_id,
  legacy_id: row.legacy_id,
  payload_relative_path: row.source.relative_path.replace(`${rootRelative}/`, ''),
  original_path_advisory: row.source.original_path_advisory,
  sha256: row.sha256,
  git_blob: row.content_oid,
  byte_length: row.byte_length,
  authority: row.authority,
  disposition: row.disposition,
  candidate_commit: candidate,
  candidate_tree: candidateTree,
}));
const exactAuthorityMembers = sourcePayloadMetadata.authority_members.map((row) => {
  const source = exactTrackedSource(campaignPath(row.payload_relative_path));
  return {
    ...row,
    candidate_commit: source.candidate_commit,
    candidate_tree: source.candidate_tree,
    candidate_path: source.relative_path,
    git_blob: source.git_blob,
    sha256: source.sha256,
    byte_length: source.byte_length,
    content_available: source.content_available,
  };
});
const exactPayloadInventory = {
  members: exactPayloadMembers,
  authority_members: exactAuthorityMembers,
};
const exactPayloadMetadata = {
  schema_version: 'locked-input-payloads/v2',
  schema: 'product-truth-locked-input-payloads.v2',
  preparation_state: 'EXACT_CANDIDATE_BOUND',
  truth_class: 'REHASHABLE_PAYLOAD_BYTES',
  binding: 'EXACT_CANDIDATE_TRACKED_REHASH_ONLY',
  candidate,
  candidate_tree: candidateTree,
  generated_by: `${rootRelative}/generate-exact-candidate-evidence.mjs`,
  source_preparation: {
    schema_version: sourcePayloadMetadata.schema_version,
    preparation_state: sourcePayloadMetadata.preparation_state,
    generated_by: sourcePayloadMetadata.generated_by,
    inventory_sha256: sourcePayloadMetadata.inventory_sha256,
  },
  totals: {
    external_input_members: exactPayloadMembers.length,
    authority_members: exactAuthorityMembers.length,
    payload_files: exactPayloadMembers.length + exactAuthorityMembers.length,
    byte_length: [...exactPayloadMembers, ...exactAuthorityMembers]
      .reduce((sum, member) => sum + member.byte_length, 0),
  },
  inventory_sha256: sha256(Buffer.from(canonicalJson(exactPayloadInventory), 'utf8')),
  payload_set_sha256: sourcePayloadMetadata.payload_set_sha256,
  ...exactPayloadInventory,
};
writeJson('LOCKED_INPUT_PAYLOADS.json', exactPayloadMetadata);

const inputLock = {
  schema: 'product-truth-inputs-lock.v4',
  binding: 'EXACT_CANDIDATE',
  candidate,
  candidate_tree: candidateTree,
  candidate_parent: requiredParent,
  candidate_branch: CAMPAIGN_BRANCH,
  inventory_counts: {
    controlling_external: controlling.length,
    candidate_tracked_law_and_locks: candidateTracked.length,
    defect_wave_inputs: waveInputs.length,
    superseded_available: trackedSuperseded.length + externalSuperseded.length,
    superseded_named_absent: absent.length,
    external_payload_backed: externalInputs.length,
    total_locked_inputs: inputs.length,
  },
  d_launch_65: {
    ...D_LAUNCH_65_AUTHORITY,
    source: { ...d65Payload, independently_rehashable_in_single_branch_clone: true },
    ambient_current_main_required: false,
  },
  rejected_vfinal5_receipt: {
    ...VFINAL5_AUTHORITY,
    source: { ...vfinal5Payload, independently_rehashable_in_single_branch_clone: true },
  },
  protected_input_law: 'Payload copies are rehash-only verifier evidence. They do not become live owner inputs and confer no execution authority.',
  inputs,
};
writeJson('INPUTS.lock', inputLock);

const allInputIds = inputs.map((row) => row.input_id).sort();

const candidateAbsenceAndExclusionProofs = {
  schema: 'CANDIDATE_ABSENCE_AND_EXCLUSION_PROOFS/v1',
  candidate_commit: candidate,
  candidate_tree: candidateTree,
  absent_path_prefixes: ABSENT_CANDIDATE_PATH_PREFIXES.map((pathPrefix) => {
    const matchingPaths = [...candidateTreeBlobs.keys()].filter((path) => path.startsWith(pathPrefix));
    assert(
      matchingPaths.length === 0,
      `CANDIDATE_PATH_PREFIX_PRESENT:${pathPrefix}:${matchingPaths.join(';')}`,
    );
    return {
      path_prefix: pathPrefix,
      matching_path_count: matchingPaths.length,
      proof_source: 'git ls-tree -r -z exact-candidate',
    };
  }),
  frontier_reference_ancestry: FRONTIER_REFERENCE_COMMITS.map((reference) => {
    assert(
      gitText('rev-parse', `${reference.sha}^{commit}`) === reference.sha,
      `FRONTIER_REFERENCE_COMMIT_MISSING:${reference.sha}`,
    );
    const status = run(
      'git',
      ['merge-base', '--is-ancestor', reference.sha, candidate],
      { allowFailure: true },
    ).status;
    const ancestorOfCandidate = status === 0;
    assert(
      status === (reference.expected_ancestor_of_candidate ? 0 : 1),
      `FRONTIER_REFERENCE_ANCESTRY:${reference.sha}:expected=${reference.expected_ancestor_of_candidate}:status=${status}`,
    );
    return {
      ...reference,
      ancestor_of_candidate: ancestorOfCandidate,
      proof_source: 'git merge-base --is-ancestor reference exact-candidate',
    };
  }),
};

const proofSeed = candidateJson(campaignPath('C2_PROOF_BINDING.json'));
const proof = {
  ...proofSeed,
  schema: 'product-truth-c9-proof-binding.v2',
  candidate_sha: candidate,
  candidate_tree: candidateTree,
  candidate_parent: requiredParent,
  candidate_token: undefined,
  binding: 'EXACT_CANDIDATE',
  artifacts: proofSeed.artifacts.map((row) => {
    const bytes = candidateBytes(row.relative_path);
    return {
      relative_path: row.relative_path,
      candidate_commit: candidate,
      candidate_tree: candidateTree,
      candidate_git_blob: candidateBlob(row.relative_path),
      sha256: sha256(bytes),
      byte_length: bytes.length,
    };
  }),
  candidate_absence_and_exclusion_proofs: candidateAbsenceAndExclusionProofs,
  browser_proof: 'HOSTILE_WATCHMAN_REGRESSION_ENFORCED; rendered browser verification is a separate custody gate',
  runtime_proof: 'CANONICAL_AND_CLEAN_CLONE_GATE_REQUIRED',
  real_soak: 'NOT_RUN',
  authority_granted: false,
};
writeJson('C2_PROOF_BINDING.json', proof);

writeJson('EVIDENCE_SELECTION.json', {
  schema: 'product-truth-c9-evidence-selection.v2',
  source_candidate: candidate,
  source_candidate_tree: candidateTree,
  source_candidate_parent: requiredParent,
  source_candidate_branch: CAMPAIGN_BRANCH,
  candidate_embedded_package: campaignPath('LOCKED_INPUT_PAYLOADS.json'),
  selection_rule: 'Select only this exact C9 candidate and an evidence descendant whose post-C9 diff equals the exact generated-output allowlist and whose manifest verifies byte-for-byte.',
  valid_chain: 'C2 -> C9; custody bridge/evidence descendants may follow but cannot alter C9',
  post_candidate_path_allowlist: EXACT_EVIDENCE_OUTPUTS.map((name) => campaignPath(name)),
  required_binding: 'MANIFEST.json plus MANIFEST.sha256',
  final_verifier_handoff: 'READY_FOR_FRESH_FINAL_VERIFIER_AFTER_BASELINE_GATE',
  rejected_candidate_history: REJECTED_SELECTION_HISTORY,
  prior_candidate_sha: REJECTED_C8_CANDIDATE,
  prior_candidate_tree: REJECTED_C8_TREE,
  prior_candidate_disposition: 'C8_REJECTED_BY_EXACT_CENSUS_NON_IDEMPOTENCE_AUDIT',
  c7_candidate_sha: 'a283eb859ec1142aadecbd64e0b84959535f6216',
  c7_candidate_disposition: 'C7_REJECTED_BY_EXACT_EVIDENCE_INTEGRITY_AUDIT',
  c6_candidate_sha: '89cd7e066b97f2f33d730d1e0adf291ebe7c4f64',
  c6_candidate_disposition: 'C6_REJECTED_BY_CANONICAL_SECURITY_GATE',
  vfinal5_candidate_sha: VFINAL5_AUTHORITY.candidate,
  vfinal5_candidate_disposition: 'C5_REJECTED_BY_VFINAL5',
});

const provenanceSeed = candidateJson(campaignPath('MERGE_PROVENANCE.json'));
const provenance = replaceExact(provenanceSeed);
provenance.schema = 'product-truth-merge-provenance.v3';
provenance.candidate_sha = candidate;
provenance.candidate_tree_sha = candidateTree;
provenance.candidate_parent_sha = requiredParent;
provenance.candidate_parent_count = 1;
const correctionChangedPaths = gitText('diff', '--name-only', requiredParent, candidate)
  .split('\n')
  .filter(Boolean)
  .sort();
const correctionOutOfGrantPaths = correctionChangedPaths.filter(
  (path) => !C9_CORRECTION_GRANTS.some((grant) => grantCoversPath(grant, path)),
);
provenance.correction = {
  base: requiredParent,
  grants: C9_CORRECTION_GRANTS,
  changed_paths: correctionChangedPaths,
  changed_path_count: correctionChangedPaths.length,
  changed_path_set_sha256: sha256(`${correctionChangedPaths.join('\n')}\n`),
  out_of_grant_paths: correctionOutOfGrantPaths,
};
for (const lane of provenance.admitted_lanes ?? []) {
  const actualParents = gitText('show', '-s', '--format=%P', lane.merge).split(/\s+/u).filter(Boolean);
  const actualChangedPaths = gitText('diff', '--name-only', lane.delta_base, lane.tip)
    .split('\n')
    .filter(Boolean)
    .sort();
  const tipBlobs = treeBlobMap(lane.tip);
  const mergeBlobs = treeBlobMap(lane.merge);
  const candidateMismatches = actualChangedPaths
    .filter((path) => tipBlobs.get(path) !== candidateTreeBlobs.get(path))
    .map((path) => ({
      path,
      donor_blob: tipBlobs.get(path) ?? null,
      candidate_blob: candidateTreeBlobs.get(path) ?? null,
      disposition: 'EXPLICIT_POST_MERGE_CANDIDATE_ADAPTATION',
    }));
  lane.parents = actualParents;
  lane.merge_tree = gitText('rev-parse', `${lane.merge}^{tree}`);
  lane.changed_paths = actualChangedPaths;
  lane.changed_path_count = actualChangedPaths.length;
  lane.changed_path_set_sha256 = sha256(`${actualChangedPaths.join('\n')}\n`);
  lane.out_of_grant_paths = actualChangedPaths.filter(
    (path) => !(lane.grants ?? []).some((grant) => grantCoversPath(grant, path)),
  );
  lane.donor_tip_in_candidate_ancestry = run('git', ['merge-base', '--is-ancestor', lane.tip, candidate], { allowFailure: true }).status === 0;
  lane.merge_in_candidate_ancestry = run('git', ['merge-base', '--is-ancestor', lane.merge, candidate], { allowFailure: true }).status === 0;
  lane.exact_second_parent = actualParents.length === 2 && actualParents[1] === lane.tip;
  lane.donor_blob_matches_at_merge = actualChangedPaths.filter(
    (path) => tipBlobs.get(path) === mergeBlobs.get(path),
  ).length;
  lane.donor_blob_matches_at_candidate = actualChangedPaths.length - candidateMismatches.length;
  lane.donor_blob_mismatches_at_candidate = candidateMismatches;
  if (lane.receipt?.path) {
    const receiptBytes = candidateBytes(lane.receipt.path);
    const candidateReceiptBlob = candidateTreeBlobs.get(lane.receipt.path) ?? null;
    lane.receipt.same_at_candidate = candidateReceiptBlob === lane.receipt.git_blob;
    lane.receipt.candidate_git_blob = candidateReceiptBlob;
    lane.receipt.candidate_sha256 = sha256(receiptBytes);
    lane.receipt.candidate_bytes = receiptBytes.length;
  }
}

const laneChangedPathOccurrences = provenance.admitted_lanes.flatMap((lane) => lane.changed_paths);
const uniqueLaneChangedPaths = new Set(laneChangedPathOccurrences);
const unexplainedEdits = [
  ...correctionOutOfGrantPaths.map((path) => ({ scope: 'C9_CORRECTION', path })),
  ...provenance.admitted_lanes.flatMap((lane) => lane.out_of_grant_paths.map(
    (path) => ({ scope: `ADMITTED_LANE:${lane.id}`, path }),
  )),
];
provenance.aggregate = {
  admitted_lane_count: provenance.admitted_lanes.length,
  changed_path_occurrences: laneChangedPathOccurrences.length,
  unique_changed_paths: uniqueLaneChangedPaths.size,
  cross_lane_overlap_count: laneChangedPathOccurrences.length - uniqueLaneChangedPaths.size,
  out_of_grant_path_count: provenance.admitted_lanes.reduce(
    (sum, lane) => sum + lane.out_of_grant_paths.length,
    0,
  ),
  donor_blob_mismatch_at_candidate_count: provenance.admitted_lanes.reduce(
    (sum, lane) => sum + lane.donor_blob_mismatches_at_candidate.length,
    0,
  ),
  unexplained_edit_count: unexplainedEdits.length,
  unexplained_edits: unexplainedEdits,
};
assert(unexplainedEdits.length === 0, `PROVENANCE_UNEXPLAINED_EDITS:${unexplainedEdits.length}`);

const landedCore = provenance.landed_core_anchor;
assert(landedCore?.donor && landedCore?.merge, 'LANDED_CORE_ANCHOR_MISSING');
const landedDonorBlobs = treeBlobMap(landedCore.donor);
const landedMergeBlobs = treeBlobMap(landedCore.merge);
const landedDonorPaths = gitText('diff', '--name-only', landedCore.delta_base, landedCore.donor)
  .split('\n')
  .filter(Boolean)
  .sort();
const landedAdaptations = landedDonorPaths
  .filter((path) => landedDonorBlobs.get(path) !== candidateTreeBlobs.get(path))
  .map((path) => ({
    path,
    donor_blob: landedDonorBlobs.get(path),
    landing_blob: landedMergeBlobs.get(path) ?? null,
    candidate_blob: candidateTreeBlobs.get(path) ?? null,
    latest_candidate_commit: latestCommitForPath(candidate, path),
  }));
landedCore.donor_tree = gitText('rev-parse', `${landedCore.donor}^{tree}`);
landedCore.merge_tree = gitText('rev-parse', `${landedCore.merge}^{tree}`);
landedCore.parents = gitText('show', '-s', '--format=%P', landedCore.merge).split(/\s+/u).filter(Boolean);
landedCore.donor_path_count = landedDonorPaths.length;
landedCore.candidate_path_count = candidateTreeBlobs.size;
landedCore.candidate_only_path_count = [...candidateTreeBlobs.keys()]
  .filter((path) => !landedDonorBlobs.has(path)).length;
landedCore.exact_at_landing = landedDonorPaths.filter(
  (path) => landedDonorBlobs.get(path) === landedMergeBlobs.get(path),
).length;
landedCore.exact_at_candidate = landedDonorPaths.length - landedAdaptations.length;
landedCore.adaptations = landedAdaptations;

const directiveOverrides = new Map([
  ['AIO-008', {
    implementation_path: 'Exact candidate tree proves server/src/aiOps/verifier/ and ops/aiOps/sentinel/ path counts are zero',
    test_path: `${rootRelative}/generate-exact-candidate-evidence.mjs; ${rootRelative}/verify-exact-candidate-evidence.mjs`,
    runtime_evidence: 'Candidate-bound absence proof records both prefixes at zero; external verifier, sentinel, and paging remain NOT_CONFIGURED',
  }],
  ['AUTH-003', {
    runtime_evidence: 'D-LAUNCH-65 governs; exact C9 is frozen and evidence descendants are output-allowlisted',
    status: 'READY_FOR_FRESH_FINAL_VERIFIER',
    blocker: 'FRESH_FINAL_VERIFIER_PENDING',
    disposition: 'Only exact C9 may be handed forward; any source correction is C10',
  }],
  ['P0-03-CANONICAL-STATE', {
    runtime_evidence: `root STATE blob ${candidateBlob('STATE.md').slice(0, 8)} owns product state; campaign STATE owns campaign status`,
  }],
  ['CAMP-05-CENSUS', {
    runtime_evidence: `Exact-C9 census regenerated: ${exactCensus.live_registered_worktree_count} live + ${exactCensus.removed_safe_tombstone_count} REMOVED_SAFE tombstones = ${exactCensus.durable_entry_count} durable entries`,
    status: 'INTEGRATED',
    blocker: 'NONE',
    disposition: 'Exact C9 census is candidate-bound; no historical census is relabeled',
  }],
  ['CAMP-07-PASS0', {
    runtime_evidence: 'C9 correction source frozen directly on immutable C2; exact output-only evidence regenerated',
    status: 'INTEGRATED',
    blocker: 'NONE',
    disposition: 'C9 is immutable; any later source correction is C10',
  }],
  ['CAMP-20-LADDER', {
    runtime_evidence: 'C9 baseline custody gate precedes the fresh final verifier; no later verdict is implied',
    status: 'READY_FOR_FRESH_FINAL_VERIFIER',
    blocker: 'FRESH_FINAL_VERIFIER_PENDING',
    disposition: 'Stop after the C9 baseline token and transfer to the fresh verifier',
  }],
  ['CAMP-21-STOP', {
    runtime_evidence: 'Expected source stop: READY_FOR_FRESH_FINAL_VERIFIER',
    status: 'READY_FOR_FRESH_FINAL_VERIFIER',
    blocker: 'FRESH_FINAL_VERIFIER_PENDING',
    disposition: 'No self-certification; fresh final-verifier verdict remains separate',
  }],
  ['DEP-004', {
    runtime_evidence: 'Exact C9 baseline custody, fresh final-verifier verdict, staging deployment, target readback, and rollback remain separate gates',
    status: 'DEFERRED_OWNER_GATE',
    blocker: 'C9 baseline custody token, fresh final-verifier verdict, later operational gates, and explicit deployment authority remain pending',
    disposition: 'No deployment acceptance is implied by the exact C9 source and evidence freeze',
  }],
  ['DEP-003', {
    implementation_path: 'Exact candidate tree proves ops/aiOps/sentinel/ path count is zero; ops/live remains local scaffolding only',
    test_path: `${rootRelative}/generate-exact-candidate-evidence.mjs; ${rootRelative}/verify-exact-candidate-evidence.mjs`,
    runtime_evidence: 'Candidate-bound absence proof records no external sentinel path; no deployed paging receipt exists',
  }],
  ['FRT-000', {
    implementation_path: 'Exact candidate tree proves frontier/ path count is zero',
    test_path: `${rootRelative}/generate-exact-candidate-evidence.mjs; ${rootRelative}/verify-exact-candidate-evidence.mjs`,
    runtime_evidence: 'Candidate-bound exclusion proof records frontier/ at zero and independently checks every unique Frontier reference commit ancestry disposition',
  }],
]);
const capabilityOverrides = new Map([
  ['candidate-source', {
    scope: 'Defect Wave 5 C9 correction source',
    implementation_path: 'exact frozen candidate; self-named only by the evidence descendant',
    runtime_evidence: 'exact C9 source frozen; canonical and clean-clone gates are separate custody evidence',
    status: 'INTEGRATED',
    blocker: 'NONE',
    disposition: 'C9 is immutable; only exact generated outputs may differ afterward; next source fix is C10',
  }],
  ['landed-core', {
    status: 'INTEGRATED',
    blocker: 'NONE',
    disposition: `${landedCore.exact_at_candidate}/${landedCore.donor_path_count} donor-delta blobs exact at C9; ${landedCore.adaptations.length} adaptations explicit`,
  }],
]);
generateMatrix('DIRECTIVE_COVERAGE_MATRIX.csv', REQUIRED_MATRIX_COUNTS.DIRECTIVE_COVERAGE_MATRIX, 'candidate_sha', ['requirement_id'], allInputIds, directiveOverrides);
generateMatrix('CAPABILITY_TRUTH_MATRIX.csv', REQUIRED_MATRIX_COUNTS.CAPABILITY_TRUTH_MATRIX, 'candidate_sha', ['capability_id'], allInputIds, capabilityOverrides);
generateMatrix('COCKPIT_BINDING_MATRIX.csv', REQUIRED_MATRIX_COUNTS.COCKPIT_BINDING_MATRIX, 'candidate_sha', ['surface_id', 'field_id'], allInputIds);

const candidateCommitTime = gitText('show', '-s', '--format=%cI', candidate);
provenance.receipt = {
  ...provenance.receipt,
  candidate_sha: candidate,
  candidate_tree_sha: candidateTree,
  candidate_parent_sha: requiredParent,
  command_or_operator_action: 'Account A exact provenance regeneration from immutable C9 candidate bytes; no candidate source mutation',
  start_time_utc: candidateCommitTime,
  end_time_utc: candidateCommitTime,
  timestamp_basis: 'EXACT_CANDIDATE_COMMITTER_TIMESTAMP_DETERMINISTIC',
};
writeJson('MERGE_PROVENANCE.json', provenance);

for (const name of ['AI_OPS_C2_DISPOSITION.json', 'INDEPENDENT_FINDINGS.json', 'PRODUCT_ASSURANCE_C2_DISPOSITION.json']) {
  const value = replaceExact(candidateJson(campaignPath(name)));
  value.candidate_sha = candidate;
  value.candidate_tree = candidateTree;
  value.candidate_parent = requiredParent;
  value.binding = 'EXACT_CANDIDATE';
  if (name === 'AI_OPS_C2_DISPOSITION.json') {
    value.schema = 'ai-ops-c9-acceptance-disposition.v2';
    value.c9_baseline_acceptance = value.c2_baseline_acceptance?.replaceAll('C2', 'C9');
    delete value.c2_baseline_acceptance;
  } else if (name === 'INDEPENDENT_FINDINGS.json') {
    value.schema = 'product-truth-c9-independent-findings.v3';
    value.wave1b = 'C9_SOURCE_FIXED_FRESH_FINAL_VERIFIER_PENDING';
    for (const finding of value.findings ?? []) {
      finding.source_candidate = 'HISTORICAL_REJECTED_PREDECESSOR_REFERENCE_ONLY';
      finding.repaired_candidate = candidate;
      finding.gate_state = 'C9_SOURCE_FIXED_FRESH_FINAL_VERIFIER_PENDING';
      finding.disposition = String(finding.disposition).replaceAll('exact-C2', 'exact-C9');
    }
  } else {
    value.schema = 'product-assurance-c9-disposition.v2';
    for (const artifact of value.artifacts ?? []) {
      artifact.prior_generator_artifact = String(artifact.prior_generator_artifact).replaceAll('C2', 'C9');
      artifact.c9_disposition = artifact.c2_disposition;
      delete artifact.c2_disposition;
      artifact.reason = 'FRESH_FINAL_VERIFIER_PENDING_EXACT_C9_PRODUCT_ASSURANCE_CLOSURE_NOT_CLAIMED';
    }
  }
  writeJson(name, value);
}

writeFileSync(resolve(root, 'STATE.md'), `# Product-truth campaign state\n\n- Exact frozen candidate: \`${candidate}\`\n- Candidate tree: \`${candidateTree}\`\n- Sole direct parent: \`${requiredParent}\`\n- Candidate topology: **PASS** (C9^ == immutable C2; parent count 1)\n- Locked inputs: **61/61** have explicit source, disposition, and matrix linkage.\n- External inputs: **23/23** have candidate-tracked payload bytes that a single-branch clone can independently rehash.\n- Matrix binding: **354/354** candidate cells (153 directive + 23 capability + 178 cockpit) name exact C9.\n- Payload metadata: exact-bound inventory checksum and payload-set checksum independently reverify.\n- Provenance: all lane match counts, candidate blobs, aggregate mismatches, and landed-core adaptation rows are remeasured from exact C9.\n- Census contract: **96 live + 5 REMOVED_SAFE tombstones = 101 durable entries**.\n- D-LAUNCH-65 is byte-bound in \`INPUTS.lock\`; ambient \`current-main\` is not evidence.\n- WATCHMAN law: local refresh action state cannot supersede canonical health.\n- Execution authority: none; \`LIVE_EXECUTION_NOT_IMPLEMENTED\` remains enforced.\n- Final independent verdict: pending fresh verifier.\n`);

run(process.execPath, [resolve(root, 'generate-manifest.mjs'), '--candidate', candidate]);

process.stdout.write(`${JSON.stringify({
  generated: true,
  candidate,
  candidate_tree: candidateTree,
  candidate_parent: requiredParent,
  locked_inputs: inputs.length,
  external_payloads: externalInputs.length,
  matrix_candidate_cells: REQUIRED_MATRIX_COUNTS.total,
})}\n`);
