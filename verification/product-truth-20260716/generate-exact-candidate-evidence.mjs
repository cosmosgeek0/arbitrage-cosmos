#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CAMPAIGN_BRANCH,
  D_LAUNCH_65_AUTHORITY,
  EXTERNAL_INPUT_SPECS,
  LOCK_INVENTORY_MATRIX_REQUIREMENT_ID,
  PREDECESSOR_CANDIDATE,
  PREDECESSOR_TREE,
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

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

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
  const reference = authority.includes('REFERENCE_ONLY') || authority.includes('PACKAGED_');
  const disposition = {
    state: authority,
    effect: reference ? 'REFERENCE_ONLY' : 'ADMIT',
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

function generateMatrix(name, expectedCount, candidateColumn, idColumns, allInputIds) {
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
  for (let index = 1; index < rows.length; index += 1) {
    while (rows[index].length < header.length) rows[index].push('');
    rows[index][candidateIndex] = candidate;
    const identity = idColumns.map((column) => rows[index][header.indexOf(column)]).join(':');
    assert(!unique.has(identity), `${name}_DUPLICATE:${identity}`);
    unique.add(identity);
    if (name === 'DIRECTIVE_COVERAGE_MATRIX.csv'
      && rows[index][requirementIndex] === LOCK_INVENTORY_MATRIX_REQUIREMENT_ID) {
      rows[index][sourceIndex] = allInputIds.join(';');
    } else {
      rows[index][sourceIndex] = 'candidate:STATE';
    }
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
assert(candidate !== PREDECESSOR_CANDIDATE, 'REJECTED_PREDECESSOR_CANDIDATE');
assert(gitText('rev-parse', `${candidate}^{commit}`) === candidate, 'CANDIDATE_COMMIT_MISSING');
const parents = gitText('show', '-s', '--format=%P', candidate).split(/\s+/u).filter(Boolean);
assert(parents.length === 1, `CANDIDATE_PARENT_COUNT:${parents.length}`);
assert(parents[0] === requiredParent, `CANDIDATE_DIRECT_PARENT:${parents[0]}`);
const candidateTree = gitText('rev-parse', `${candidate}^{tree}`);

// The census must observe a clean custody bridge before any other evidence file is changed.
run(process.execPath, [resolve(root, 'generate-worktree-census.mjs'), candidate]);

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

const exactPayloadMetadata = {
  ...sourcePayloadMetadata,
  schema: 'product-truth-locked-input-payloads.v2',
  binding: 'EXACT_CANDIDATE_TRACKED_REHASH_ONLY',
  candidate,
  candidate_tree: candidateTree,
  members: externalInputs.map((row) => ({
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
  })),
  authority_members: sourcePayloadMetadata.authority_members.map((row) => {
    const source = exactTrackedSource(campaignPath(row.payload_relative_path));
    return { ...row, ...source, relative_path: undefined, payload_relative_path: row.payload_relative_path };
  }),
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
generateMatrix('DIRECTIVE_COVERAGE_MATRIX.csv', REQUIRED_MATRIX_COUNTS.DIRECTIVE_COVERAGE_MATRIX, 'candidate_sha', ['requirement_id'], allInputIds);
generateMatrix('CAPABILITY_TRUTH_MATRIX.csv', REQUIRED_MATRIX_COUNTS.CAPABILITY_TRUTH_MATRIX, 'candidate_sha', ['capability_id'], allInputIds);
generateMatrix('COCKPIT_BINDING_MATRIX.csv', REQUIRED_MATRIX_COUNTS.COCKPIT_BINDING_MATRIX, 'candidate_sha', ['surface_id', 'field_id'], allInputIds);

const proofSeed = candidateJson(campaignPath('C2_PROOF_BINDING.json'));
const proof = {
  ...proofSeed,
  schema: 'product-truth-c7-proof-binding.v2',
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
  browser_proof: 'HOSTILE_WATCHMAN_REGRESSION_ENFORCED; rendered browser verification is a separate custody gate',
  runtime_proof: 'CANONICAL_AND_CLEAN_CLONE_GATE_REQUIRED',
  real_soak: 'NOT_RUN',
  authority_granted: false,
};
writeJson('C2_PROOF_BINDING.json', proof);

writeJson('EVIDENCE_SELECTION.json', {
  schema: 'product-truth-c7-evidence-selection.v2',
  source_candidate: candidate,
  source_candidate_tree: candidateTree,
  source_candidate_parent: requiredParent,
  source_candidate_branch: CAMPAIGN_BRANCH,
  candidate_embedded_package: campaignPath('LOCKED_INPUT_PAYLOADS.json'),
  selection_rule: 'Select only this exact C7 candidate and an evidence descendant whose post-C7 diff is confined to verification/product-truth-20260716/** and whose manifest verifies byte-for-byte.',
  valid_chain: 'C2 -> C7; custody bridge/evidence descendants may follow but cannot alter C7',
  post_candidate_path_allowlist: [`${rootRelative}/**`],
  required_binding: 'MANIFEST.json plus MANIFEST.sha256',
  final_verifier_handoff: 'READY_FOR_FRESH_FINAL_VERIFIER_AFTER_BASELINE_GATE',
  prior_candidate_sha: '89cd7e066b97f2f33d730d1e0adf291ebe7c4f64',
  prior_candidate_disposition: 'C6_REJECTED_BY_CANONICAL_SECURITY_GATE',
  vfinal5_candidate_sha: VFINAL5_AUTHORITY.candidate,
  vfinal5_candidate_disposition: 'C5_REJECTED_BY_VFINAL5',
});

const provenanceSeed = candidateJson(campaignPath('MERGE_PROVENANCE.json'));
const provenance = replaceExact(provenanceSeed);
provenance.schema = 'product-truth-merge-provenance.v2';
provenance.candidate_sha = candidate;
provenance.candidate_tree_sha = candidateTree;
provenance.candidate_parent_sha = requiredParent;
provenance.candidate_parent_count = 1;
provenance.correction = {
  base: requiredParent,
  changed_paths: gitText('diff', '--name-only', requiredParent, candidate).split('\n').filter(Boolean),
};
for (const lane of provenance.admitted_lanes ?? []) {
  lane.donor_tip_in_candidate_ancestry = run('git', ['merge-base', '--is-ancestor', lane.tip, candidate], { allowFailure: true }).status === 0;
  lane.merge_in_candidate_ancestry = run('git', ['merge-base', '--is-ancestor', lane.merge, candidate], { allowFailure: true }).status === 0;
}
writeJson('MERGE_PROVENANCE.json', provenance);

for (const name of ['AI_OPS_C2_DISPOSITION.json', 'INDEPENDENT_FINDINGS.json', 'PRODUCT_ASSURANCE_C2_DISPOSITION.json']) {
  const value = replaceExact(candidateJson(campaignPath(name)));
  value.candidate_sha = candidate;
  value.candidate_tree = candidateTree;
  value.candidate_parent = requiredParent;
  for (const finding of value.findings ?? []) {
    finding.repaired_candidate = candidate;
  }
  writeJson(name, value);
}

writeFileSync(resolve(root, 'STATE.md'), `# Product-truth campaign state\n\n- Exact frozen candidate: \`${candidate}\`\n- Candidate tree: \`${candidateTree}\`\n- Sole direct parent: \`${requiredParent}\`\n- Candidate topology: **PASS** (C7^ == immutable C2; parent count 1)\n- Locked inputs: **61/61** have explicit source, disposition, and matrix linkage.\n- External inputs: **23/23** have candidate-tracked payload bytes that a single-branch clone can independently rehash.\n- Matrix binding: **354/354** candidate cells (153 directive + 23 capability + 178 cockpit) name exact C7.\n- Census contract: **96 live + 5 REMOVED_SAFE tombstones = 101 durable entries**.\n- D-LAUNCH-65 is byte-bound in \`INPUTS.lock\`; ambient \`current-main\` is not evidence.\n- WATCHMAN law: local refresh action state cannot supersede canonical health.\n- Execution authority: none; \`LIVE_EXECUTION_NOT_IMPLEMENTED\` remains enforced.\n- Final independent verdict: pending fresh verifier.\n`);

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
