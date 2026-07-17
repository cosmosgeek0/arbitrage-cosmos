#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'verification/product-truth-20260716');
const C2 = 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561';
const C4 = '4c9143a0bcc331aa170e9e26b741240b39df8b9e';
const C2_EVIDENCE = '4ec9e8640a22661f7e1649204348a212d94163e1';
const C3 = '78f708d6cdb9d1618c53d3f08f71097b4320a63b';
const PLACEHOLDERS = ['SELF_COMMIT_UNBOUND_USE_EXACT_EVIDENCE_DESCENDANT', 'C2_NOT_YET_FROZEN'];
const structuralOnly = process.argv.includes('--structural-only');
const failures = [];

function run(command, args, { encoding = 'utf8', accepted = [0] } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding,
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC', GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 128 * 1024 * 1024,
  });
  if (!accepted.includes(result.status ?? 1)) {
    failures.push(`COMMAND_FAILED:${command}:${args.join(' ')}:${String(result.status)}`);
  }
  return result;
}

function git(...args) {
  return run('git', args).stdout.trim();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function must(condition, code) {
  if (!condition) failures.push(code);
}

function candidateBytes(relativePath) {
  return run('git', ['show', `${C4}:${relativePath}`], { encoding: null }).stdout;
}

function parseCsv(text) {
  const table = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell);
      table.push(row);
      row = [];
      cell = '';
    } else if (character !== '\r') {
      cell += character;
    }
  }
  const [headers, ...values] = table.filter((entry) => entry.some(Boolean));
  return {
    headers,
    rows: values.map((valueRow) => Object.fromEntries(
      headers.map((header, index) => [header, valueRow[index] ?? '']),
    )),
  };
}

function inventory(lock) {
  return [
    ...lock.controlling_external_inputs.map((entry, index) => ({ category: 'controlling_external_inputs', index, entry })),
    ...lock.candidate_tracked_law_and_locks.map((entry, index) => ({ category: 'candidate_tracked_law_and_locks', index, entry })),
    ...lock.defect_wave_inputs.map((entry, index) => ({ category: 'defect_wave_inputs', index, entry })),
    ...lock.superseded_reference_inputs.map((entry, index) => ({ category: 'superseded_reference_inputs', index, entry })),
    ...lock.absent_named_superseded_inputs.map((entry, index) => ({ category: 'absent_named_superseded_inputs', index, entry })),
  ];
}

function candidateBackedEntries(lock) {
  return [
    ...lock.candidate_tracked_law_and_locks,
    ...lock.defect_wave_inputs,
    ...lock.superseded_reference_inputs.filter((entry) => entry.candidate_presence === true),
    ...lock.deployment_authority.implementation_evidence,
  ];
}

function statusPaths(output) {
  return output.split('\0').filter(Boolean).map((entry) => {
    const pathValue = entry.slice(3);
    const arrow = pathValue.lastIndexOf(' -> ');
    return arrow === -1 ? pathValue : pathValue.slice(arrow + 4);
  });
}

const parentText = git('show', '-s', '--format=%P', C4);
const parents = parentText.split(/\s+/u).filter(Boolean);
must(parents.length === 1, `C4_PARENT_COUNT:${parents.length}`);
must(parents[0] === C2, `C4_DIRECT_PARENT:${parents[0] ?? 'NONE'}`);
const c2EvidenceAncestor = run(
  'git',
  ['merge-base', '--is-ancestor', C2_EVIDENCE, C4],
  { accepted: [0, 1] },
).status === 0;
const c3Ancestor = run(
  'git',
  ['merge-base', '--is-ancestor', C3, C4],
  { accepted: [0, 1] },
).status === 0;
must(!c2EvidenceAncestor, 'C2_EVIDENCE_COMMIT_IN_C4_ANCESTRY');
must(!c3Ancestor, 'C3_IN_C4_ANCESTRY');
must(git('rev-parse', 'refs/heads/codex/truth-campaign-c4-20260717') === C4, 'C4_SOURCE_BRANCH_MOVED');

const lock = JSON.parse(readFileSync(resolve(OUT, 'INPUTS.lock'), 'utf8'));
const candidateTree = git('rev-parse', `${C4}^{tree}`);
must(lock.schema === 'product-truth-inputs-lock.v4', `LOCK_SCHEMA:${lock.schema}`);
must(lock.binding === 'EXACT_CANDIDATE', `LOCK_BINDING:${lock.binding}`);
must(lock.candidate === C4, `LOCK_CANDIDATE:${lock.candidate}`);
must(lock.candidate_token === C4, `LOCK_TOKEN:${lock.candidate_token}`);
must(lock.candidate_tree === candidateTree, `LOCK_TREE:${lock.candidate_tree}`);
const lockedInventory = inventory(lock);
must(lockedInventory.length === 61, `LOCK_INVENTORY_COUNT:${lockedInventory.length}`);
must(lock.inventory_counts.total_directive_law_lock_and_wave_rows === 61, 'LOCK_DECLARED_COUNT_NOT_61');

const candidateEntries = candidateBackedEntries(lock);
must(candidateEntries.length === 34, `LOCK_CANDIDATE_BACKED_COUNT:${candidateEntries.length}`);
for (const entry of candidateEntries) {
  const bytes = candidateBytes(entry.relative_path);
  const blob = git('rev-parse', `${C4}:${entry.relative_path}`);
  must(entry.candidate_commit === C4, `LOCK_COMMIT_MISMATCH:${entry.relative_path}`);
  must(entry.git_blob === blob, `LOCK_BLOB_MISMATCH:${entry.relative_path}`);
  must(entry.sha256 === sha256(bytes), `LOCK_SHA256_MISMATCH:${entry.relative_path}`);
  must(entry.byte_length === bytes.length, `LOCK_LENGTH_MISMATCH:${entry.relative_path}`);
  must(entry.candidate_presence === true, `LOCK_PRESENCE_MISMATCH:${entry.relative_path}`);
}

const externalEntries = [
  ...lock.controlling_external_inputs,
  ...lock.superseded_reference_inputs.filter((entry) => entry.candidate_presence === false),
];
for (const entry of externalEntries) {
  must(existsSync(entry.absolute_path), `LOCK_EXTERNAL_MISSING:${entry.id}`);
  if (existsSync(entry.absolute_path)) {
    const bytes = readFileSync(entry.absolute_path);
    must(entry.sha256 === sha256(bytes), `LOCK_EXTERNAL_SHA256_MISMATCH:${entry.id}`);
    must(entry.byte_length === bytes.length, `LOCK_EXTERNAL_LENGTH_MISMATCH:${entry.id}`);
  }
}

const coverageText = readFileSync(resolve(OUT, 'DIRECTIVE_COVERAGE_MATRIX.csv'), 'utf8');
const coverage = parseCsv(coverageText);
must(coverage.rows.length === 215, `COVERAGE_ROW_COUNT:${coverage.rows.length}`);
must(coverage.rows.every((row) => row.candidate_sha === C4), 'COVERAGE_CANDIDATE_SHA_NOT_EXACT_C4');
must(new Set(coverage.rows.map((row) => row.requirement_id)).size === coverage.rows.length, 'COVERAGE_DUPLICATE_REQUIREMENT_ID');
for (const placeholder of PLACEHOLDERS) {
  must(!coverageText.includes(placeholder), `COVERAGE_PLACEHOLDER:${placeholder}`);
}
const lockRows = coverage.rows.filter((row) => /^LOCK-\d{3}$/u.test(row.requirement_id));
must(lockRows.length === 61, `COVERAGE_LOCK_ROW_COUNT:${lockRows.length}`);
const lockRowsById = new Map(lockRows.map((row) => [row.requirement_id, row]));

const coverageReport = JSON.parse(readFileSync(resolve(OUT, 'C4_INPUT_COVERAGE.json'), 'utf8'));
must(coverageReport.source_candidate === C4, 'INPUT_COVERAGE_CANDIDATE_NOT_C4');
must(coverageReport.candidate_tree === candidateTree, 'INPUT_COVERAGE_TREE_MISMATCH');
must(coverageReport.input_count === 61, `INPUT_COVERAGE_INPUT_COUNT:${coverageReport.input_count}`);
must(coverageReport.mapped_count === 61, `INPUT_COVERAGE_MAPPED_COUNT:${coverageReport.mapped_count}`);
must(coverageReport.unmapped_count === 0, `INPUT_COVERAGE_UNMAPPED_COUNT:${coverageReport.unmapped_count}`);
must(coverageReport.candidate_backed_byte_audit_count === 34, 'INPUT_COVERAGE_BYTE_AUDIT_NOT_34');
must(coverageReport.mappings.length === 61, `INPUT_COVERAGE_MAPPING_ROWS:${coverageReport.mappings.length}`);
for (let index = 0; index < lockedInventory.length; index += 1) {
  const item = lockedInventory[index];
  const mapping = coverageReport.mappings[index];
  const requirementId = `LOCK-${String(index + 1).padStart(3, '0')}`;
  const identity = item.entry.id ?? item.entry.name;
  const lockedSource = item.entry.relative_path ?? item.entry.absolute_path ?? item.entry.name;
  const row = lockRowsById.get(requirementId);
  must(mapping?.requirement_id === requirementId, `INPUT_MAPPING_REQUIREMENT:${requirementId}`);
  must(mapping?.category === item.category, `INPUT_MAPPING_CATEGORY:${requirementId}`);
  must(mapping?.category_index === item.index, `INPUT_MAPPING_INDEX:${requirementId}`);
  must(mapping?.id === identity, `INPUT_MAPPING_ID:${requirementId}`);
  must(mapping?.locked_source === lockedSource, `INPUT_MAPPING_SOURCE:${requirementId}`);
  must(mapping?.candidate_sha === C4, `INPUT_MAPPING_CANDIDATE:${requirementId}`);
  must(row !== undefined, `COVERAGE_LOCK_ROW_MISSING:${requirementId}`);
  must(row?.source_file.includes(identity), `COVERAGE_SOURCE_ID_MISSING:${requirementId}`);
  must(row?.source_file.includes(lockedSource), `COVERAGE_SOURCE_PATH_MISSING:${requirementId}`);
  must(row?.disposition.length > 0, `COVERAGE_DISPOSITION_MISSING:${requirementId}`);
}

const capabilityText = readFileSync(resolve(OUT, 'CAPABILITY_TRUTH_MATRIX.csv'), 'utf8');
const capabilities = parseCsv(capabilityText);
must(capabilities.rows.length === 23, `CAPABILITY_ROW_COUNT:${capabilities.rows.length}`);
must(capabilities.rows.every((row) => row.candidate_sha === C4), 'CAPABILITY_CANDIDATE_SHA_NOT_EXACT_C4');
for (const placeholder of PLACEHOLDERS) {
  must(!capabilityText.includes(placeholder), `CAPABILITY_PLACEHOLDER:${placeholder}`);
}

const topology = JSON.parse(readFileSync(resolve(OUT, 'C4_TOPOLOGY.json'), 'utf8'));
must(topology.source_candidate === C4, 'TOPOLOGY_CANDIDATE_NOT_C4');
must(topology.expected_direct_parent === C2, 'TOPOLOGY_EXPECTED_PARENT_NOT_C2');
must(topology.parent_count === 1, `TOPOLOGY_PARENT_COUNT:${topology.parent_count}`);
must(topology.direct_parent === C2, `TOPOLOGY_DIRECT_PARENT:${topology.direct_parent}`);
must(topology.direct_parent_equality === true, 'TOPOLOGY_EQUALITY_FALSE');
must(topology.merge_base_ancestry_substitution_allowed === false, 'TOPOLOGY_MERGE_BASE_SUBSTITUTION_ALLOWED');
must(topology.c2_evidence_commit === C2_EVIDENCE, 'TOPOLOGY_C2_EVIDENCE_ID_MISMATCH');
must(topology.c2_evidence_commit_in_ancestry === false, 'TOPOLOGY_C2_EVIDENCE_ANCESTRY_TRUE');
must(topology.rejected_c3 === C3, 'TOPOLOGY_C3_ID_MISMATCH');
must(topology.c3_in_ancestry === false, 'TOPOLOGY_C3_ANCESTRY_TRUE');

let gateReady = false;
let gateDisposition = 'C4_LOCAL_GATE_REPORT_MISSING';
if (existsSync(resolve(OUT, 'C4_LOCAL_GATE_REPORT.json'))) {
  const gate = JSON.parse(readFileSync(resolve(OUT, 'C4_LOCAL_GATE_REPORT.json'), 'utf8'));
  must(gate.source_candidate.c4 === C4, 'GATE_CANDIDATE_NOT_C4');
  must(gate.source_candidate.parent_count === 1, 'GATE_PARENT_COUNT_NOT_1');
  must(gate.source_candidate.direct_parent_equality === true, 'GATE_DIRECT_PARENT_EQUALITY_FALSE');
  must(gate.preflight.result === 'PASS', `GATE_PREFLIGHT:${gate.preflight.result}`);
  must(gate.census.result === 'PASS_LIVE_GIT_DERIVED', `GATE_CENSUS:${gate.census.result}`);
  must(gate.literal_local_single_branch.topology_passed === true, 'GATE_LOCAL_TOPOLOGY_FALSE');
  must(gate.literal_local_single_branch.hardlink_audit.passed === true, 'GATE_HARDLINK_AUDIT_FALSE');
  must(gate.literal_local_single_branch.current_main_ref_present === false, 'GATE_LOCAL_CURRENT_MAIN_PRESENT');
  must(gate.current_main.changed_during_gate === false, 'GATE_CURRENT_MAIN_CHANGED');
  must(gate.custody.token_issued === false, 'GATE_FALSE_CUSTODY_TOKEN');
  gateReady = gate.all_local_required_commands_passed === true;
  gateDisposition = gate.custody.status;
}

const diffPaths = git('diff', '--name-only', C4).split(/\r?\n/u).filter(Boolean);
const status = run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout;
const dirtyPaths = statusPaths(status);
const allObservedPaths = [...new Set([...diffPaths, ...dirtyPaths])];
const outOfScope = allObservedPaths.filter((pathValue) => (
  !pathValue.startsWith('verification/product-truth-20260716/')
));
must(outOfScope.length === 0, `POST_C4_OUT_OF_SCOPE_DIFF:${outOfScope[0] ?? 'UNKNOWN'}`);

if (existsSync(resolve(OUT, 'MANIFEST.json'))) {
  const manifest = JSON.parse(readFileSync(resolve(OUT, 'MANIFEST.json'), 'utf8'));
  if (manifest.schema === 'product-truth-c4-evidence-manifest.v1') {
    must(manifest.source_candidate === C4, 'MANIFEST_CANDIDATE_NOT_C4');
    for (const artifact of manifest.artifacts) {
      const absolute = resolve(ROOT, artifact.path);
      must(existsSync(absolute), `MANIFEST_ARTIFACT_MISSING:${artifact.path}`);
      if (existsSync(absolute)) {
        const bytes = readFileSync(absolute);
        must(artifact.sha256 === sha256(bytes), `MANIFEST_SHA256_MISMATCH:${artifact.path}`);
        must(artifact.byte_length === statSync(absolute).size, `MANIFEST_LENGTH_MISMATCH:${artifact.path}`);
      }
    }
  }
}

const structuralPassed = failures.length === 0;
const readinessPassed = structuralPassed && gateReady;
const result = {
  schema: 'product-truth-c4-evidence-verification.v1',
  source_candidate: C4,
  expected_direct_parent: C2,
  structural_only: structuralOnly,
  direct_parent_equality: parents.length === 1 && parents[0] === C2,
  input_rows: lockedInventory.length,
  candidate_backed_rows: candidateEntries.length,
  coverage_rows: coverage.rows.length,
  explicitly_mapped_input_rows: lockRows.length,
  capability_rows: capabilities.rows.length,
  post_c4_out_of_scope_paths: outOfScope,
  structural_passed: structuralPassed,
  gate_ready: gateReady,
  readiness_passed: readinessPassed,
  gate_disposition: gateDisposition,
  failures,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!structuralPassed || (!structuralOnly && !readinessPassed)) process.exitCode = 1;
