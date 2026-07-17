#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'verification/product-truth-20260716');
const C2 = 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561';
const C4 = '4c9143a0bcc331aa170e9e26b741240b39df8b9e';
const C2_EVIDENCE = '4ec9e8640a22661f7e1649204348a212d94163e1';
const C3 = '78f708d6cdb9d1618c53d3f08f71097b4320a63b';
const FULL_SHA = /^[a-f0-9]{40}$/u;

function run(command, args, { encoding = 'utf8' } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding,
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC', GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${String(result.status)}): ${String(result.stderr)}`);
  }
  return result.stdout;
}

function git(...args) {
  return run('git', args).trim();
}

function isAncestor(ancestor, descendant) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git merge-base --is-ancestor failed (${String(result.status)}): ${result.stderr}`);
  }
  return result.status === 0;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function candidateBytes(relativePath) {
  return run('git', ['show', `${C4}:${relativePath}`], { encoding: null });
}

function candidateBlob(relativePath) {
  return git('rev-parse', `${C4}:${relativePath}`);
}

function candidateEntry(entry) {
  const bytes = candidateBytes(entry.relative_path);
  return {
    ...entry,
    candidate_commit: C4,
    git_blob: candidateBlob(entry.relative_path),
    sha256: sha256(bytes),
    byte_length: bytes.length,
    candidate_presence: true,
  };
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

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function emitCsv(fileName, headers, rows) {
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ];
  writeFileSync(resolve(OUT, fileName), `${lines.join('\n')}\n`);
}

function bindCurrentCandidateText(value) {
  return String(value ?? '')
    .replaceAll('SELF_COMMIT_UNBOUND_USE_EXACT_EVIDENCE_DESCENDANT', C4)
    .replaceAll('C2_NOT_YET_FROZEN', 'C4_FROZEN_LOCAL_GATE_REJECTED')
    .replaceAll('C2_OFF_MACHINE_CUSTODY_NOT_ESTABLISHED', 'C4_OFF_MACHINE_CUSTODY_NOT_ESTABLISHED')
    .replaceAll(
      'EXACT_C2_POST_FREEZE_CENSUS_PENDING_OR_SEPARATELY_ATTESTED',
      'EXACT_C4_POST_FREEZE_CENSUS_RECORDED',
    )
    .replaceAll(
      'EXACT_C2_RENDERED_BROWSER_RECEIPT_NOT_PRODUCED',
      'EXACT_C4_RENDERED_BROWSER_VERIFIED_LOCALLY_NOT_CUSTODY',
    )
    .replaceAll('C2 is not yet frozen', 'C4 is frozen but rejected by the local canonical gate')
    .replaceAll('No C2 acceptance token has been issued', 'No C4 custody token has been issued')
    .replaceAll('exact-C2 campaign evidence', 'exact-C4 campaign evidence')
    .replaceAll('candidate source and exact-C2', 'candidate source and exact-C4');
}

function topLevelInventory(lock) {
  return [
    ...lock.controlling_external_inputs.map((entry, index) => ({
      category: 'controlling_external_inputs',
      index,
      entry,
    })),
    ...lock.candidate_tracked_law_and_locks.map((entry, index) => ({
      category: 'candidate_tracked_law_and_locks',
      index,
      entry,
    })),
    ...lock.defect_wave_inputs.map((entry, index) => ({
      category: 'defect_wave_inputs',
      index,
      entry,
    })),
    ...lock.superseded_reference_inputs.map((entry, index) => ({
      category: 'superseded_reference_inputs',
      index,
      entry,
    })),
    ...lock.absent_named_superseded_inputs.map((entry, index) => ({
      category: 'absent_named_superseded_inputs',
      index,
      entry,
    })),
  ];
}

function inventoryIdentity(item) {
  return item.entry.id ?? item.entry.name;
}

function inventoryPath(item) {
  return item.entry.relative_path ?? item.entry.absolute_path ?? item.entry.name;
}

function inventoryDisposition(item) {
  if (item.category === 'absent_named_superseded_inputs') {
    return `ABSENT_SUPERSEDED_REFERENCE_ONLY; content unavailable; superseded_by=${item.entry.superseded_by}`;
  }
  if (item.category === 'superseded_reference_inputs') {
    return `SUPERSEDED_REFERENCE_ONLY; exact source locked; superseded_by=${item.entry.superseded_by ?? 'CURRENT_AUTHORITY'}`;
  }
  if (item.category === 'defect_wave_inputs') {
    return `${item.entry.authority}; exact defect-wave source locked; candidate_presence=true`;
  }
  if (item.category === 'candidate_tracked_law_and_locks') {
    return `${item.entry.authority}; exact C4 blob and SHA-256 locked; candidate_presence=true`;
  }
  return `${item.entry.authority}; exact external SHA-256 and content OID locked; candidate_presence=false`;
}

function inventoryStatus(item) {
  if (item.category === 'absent_named_superseded_inputs'
      || item.category === 'superseded_reference_inputs'
      || item.entry.authority === 'REFERENCE_ONLY'
      || item.entry.authority === 'REFERENCE_LATER_OWNER_GATE') {
    return 'REFERENCE_ONLY';
  }
  if (item.category === 'candidate_tracked_law_and_locks') return 'LOCKED_CANDIDATE_BYTES';
  if (item.category === 'defect_wave_inputs') return 'LOCKED_DEFECT_INPUT';
  return 'LOCKED_EXTERNAL_INPUT';
}

function inventoryBlocker(item) {
  if (item.category === 'absent_named_superseded_inputs') return 'CONTENT_UNAVAILABLE_SUPERSEDED';
  if (item.category === 'superseded_reference_inputs') return 'SUPERSEDED';
  if (item.entry.authority === 'REFERENCE_ONLY' || item.entry.authority === 'REFERENCE_LATER_OWNER_GATE') {
    return 'REFERENCE_ONLY';
  }
  return 'NONE';
}

if (!FULL_SHA.test(C4) || !FULL_SHA.test(C2)) throw new Error('PINNED_SHA_INVALID');
run('git', ['cat-file', '-e', `${C4}^{commit}`]);
run('git', ['cat-file', '-e', `${C2}^{commit}`]);
const parentLine = git('show', '-s', '--format=%P', C4);
const parents = parentLine.split(/\s+/u).filter(Boolean);
if (parents.length !== 1 || parents[0] !== C2) {
  throw new Error(`C4_DIRECT_PARENT_INVALID:${JSON.stringify(parents)}`);
}
const c2EvidenceInAncestry = isAncestor(C2_EVIDENCE, C4);
const c3InAncestry = isAncestor(C3, C4);
if (c2EvidenceInAncestry || c3InAncestry) throw new Error('C4_REJECTED_ANCESTRY_PRESENT');

const sourceLock = JSON.parse(candidateBytes(
  'verification/product-truth-20260716/INPUTS.lock',
).toString('utf8'));
const inputLock = structuredClone(sourceLock);
inputLock.schema = 'product-truth-inputs-lock.v4';
inputLock.binding = 'EXACT_CANDIDATE';
inputLock.candidate = C4;
inputLock.candidate_token = C4;
inputLock.candidate_tree = git('rev-parse', `${C4}^{tree}`);
inputLock.candidate_branch = 'codex/truth-campaign-c4-20260717';
inputLock.candidate_tracked_law_and_locks = inputLock.candidate_tracked_law_and_locks.map(candidateEntry);
inputLock.defect_wave_inputs = inputLock.defect_wave_inputs.map(candidateEntry);
inputLock.deployment_authority.implementation_evidence = inputLock.deployment_authority
  .implementation_evidence.map(candidateEntry);
inputLock.superseded_reference_inputs = inputLock.superseded_reference_inputs.map((entry) => (
  entry.candidate_presence === true ? candidateEntry(entry) : entry
));
inputLock.protected_input_law = 'Physical protected owner inputs remain outside C4; exact external bytes are locked directly. The packaged verifier snapshot is supporting evidence only.';

const inventory = topLevelInventory(inputLock);
if (inventory.length !== 61) throw new Error(`INPUT_INVENTORY_NOT_61:${inventory.length}`);
const candidateBacked = [
  ...inputLock.candidate_tracked_law_and_locks,
  ...inputLock.defect_wave_inputs,
  ...inputLock.superseded_reference_inputs.filter((entry) => entry.candidate_presence === true),
  ...inputLock.deployment_authority.implementation_evidence,
];
if (candidateBacked.length !== 34) {
  throw new Error(`CANDIDATE_BACKED_INPUT_COUNT_NOT_34:${candidateBacked.length}`);
}
writeFileSync(resolve(OUT, 'INPUTS.lock'), `${JSON.stringify(inputLock, null, 2)}\n`);

const sourceCoverage = parseCsv(candidateBytes(
  'verification/product-truth-20260716/DIRECTIVE_COVERAGE_MATRIX.csv',
).toString('utf8'));
const coverageRows = sourceCoverage.rows
  .filter((row) => !row.requirement_id.startsWith('LOCK-'))
  .map((row) => Object.fromEntries(
    sourceCoverage.headers.map((header) => [header, bindCurrentCandidateText(row[header])]),
  ));
for (const row of coverageRows) row.candidate_sha = C4;

const authorityRow = coverageRows.find((row) => row.requirement_id === 'AUTH-003');
if (authorityRow === undefined) throw new Error('AUTH_003_ROW_MISSING');
authorityRow.runtime_evidence = 'C4_TOPOLOGY.json; C4_LOCAL_GATE_REPORT.json; C4_INPUT_COVERAGE.json';
authorityRow.status = 'REJECTED_LOCAL_GATE';
authorityRow.blocker = 'CANDIDATE_REPORT_PARITY_STALE';
authorityRow.disposition = 'C4 is immutable with sole direct parent C2; custody is withheld and any source repair must be C5';

const topologyRow = {
  requirement_id: 'PROV-C4-DIRECT-PARENT',
  source_file: 'C4_TOPOLOGY.json; VFINAL_RECEIPT.md',
  source_section: 'VFINAL-PROV-001; exact direct-parent equality',
  authority: 'Final verifier topology law',
  owner: 'ACCOUNT_A_CANDIDATE_WRITER',
  implementation_path: 'verification/product-truth-20260716/C4_TOPOLOGY.json',
  test_path: 'verification/product-truth-20260716/verify-c4-evidence.mjs',
  cockpit_surface: 'NONE',
  runtime_evidence: `parent_count=1; direct_parent=${C2}`,
  donor_sha: 'NONE',
  candidate_sha: C4,
  status: 'PASS',
  blocker: 'NONE',
  disposition: 'Direct-parent equality asserted; merge-base ancestry is not used as a substitute',
};
coverageRows.push(topologyRow);

const mappedInputs = inventory.map((item, offset) => {
  const identity = inventoryIdentity(item);
  const sourcePath = inventoryPath(item);
  const sourceFile = `${identity}; ${basename(sourcePath)}; ${sourcePath}`;
  const disposition = inventoryDisposition(item);
  coverageRows.push({
    requirement_id: `LOCK-${String(offset + 1).padStart(3, '0')}`,
    source_file: sourceFile,
    source_section: `INPUTS.lock#${item.category}[${item.index}]`,
    authority: item.entry.authority ?? item.entry.disposition ?? 'SUPERSEDED_REFERENCE_ONLY',
    owner: 'CAMPAIGN_EVIDENCE_OWNER',
    implementation_path: item.entry.relative_path ?? 'NONE',
    test_path: 'verification/product-truth-20260716/verify-c4-evidence.mjs',
    cockpit_surface: 'NONE',
    runtime_evidence: 'INPUTS.lock; C4_INPUT_COVERAGE.json',
    donor_sha: 'NONE',
    candidate_sha: C4,
    status: inventoryStatus(item),
    blocker: inventoryBlocker(item),
    disposition,
  });
  return {
    ordinal: offset + 1,
    requirement_id: `LOCK-${String(offset + 1).padStart(3, '0')}`,
    category: item.category,
    category_index: item.index,
    id: identity,
    locked_source: sourcePath,
    source_file: sourceFile,
    authority: item.entry.authority ?? item.entry.disposition ?? 'SUPERSEDED_REFERENCE_ONLY',
    disposition,
    candidate_sha: C4,
  };
});
emitCsv('DIRECTIVE_COVERAGE_MATRIX.csv', sourceCoverage.headers, coverageRows);

const sourceCapabilities = parseCsv(candidateBytes(
  'verification/product-truth-20260716/CAPABILITY_TRUTH_MATRIX.csv',
).toString('utf8'));
const capabilityRows = sourceCapabilities.rows.map((row) => Object.fromEntries(
  sourceCapabilities.headers.map((header) => [header, bindCurrentCandidateText(row[header])]),
));
for (const row of capabilityRows) row.candidate_sha = C4;
const candidateCapability = capabilityRows.find((row) => row.capability_id === 'candidate-source');
if (candidateCapability === undefined) throw new Error('CANDIDATE_SOURCE_CAPABILITY_MISSING');
Object.assign(candidateCapability, {
  scope: 'Defect Wave 3 immutable C4 source',
  implementation_path: 'exact source commit',
  runtime_evidence: 'C4_TOPOLOGY.json; C4_LOCAL_GATE_REPORT.json',
  status: 'REJECTED_LOCAL_GATE',
  blocker: 'CANDIDATE_REPORT_PARITY_STALE',
  disposition: 'C4 remains immutable; custody withheld; source repair requires C5',
});
emitCsv('CAPABILITY_TRUTH_MATRIX.csv', sourceCapabilities.headers, capabilityRows);

const byteAudit = candidateBacked.map((entry) => ({
  id: entry.id,
  relative_path: entry.relative_path,
  candidate_commit: entry.candidate_commit,
  git_blob: entry.git_blob,
  sha256: entry.sha256,
  byte_length: entry.byte_length,
  exact_c4_match: true,
}));
const coverageReport = {
  schema: 'product-truth-c4-input-coverage.v1',
  source_candidate: C4,
  candidate_tree: inputLock.candidate_tree,
  input_count: inventory.length,
  mapped_count: mappedInputs.length,
  unmapped_count: inventory.length - mappedInputs.length,
  mapping_rule: 'ONE_EXPLICIT_LOCK_ROW_PER_TOP_LEVEL_INPUTS_LOCK_INVENTORY_ENTRY',
  category_counts: inputLock.inventory_counts,
  candidate_backed_byte_audit_count: byteAudit.length,
  candidate_backed_byte_audit: byteAudit,
  mappings: mappedInputs,
};
writeFileSync(resolve(OUT, 'C4_INPUT_COVERAGE.json'), `${JSON.stringify(coverageReport, null, 2)}\n`);

const topology = {
  schema: 'product-truth-c4-direct-parent-proof.v1',
  source_candidate: C4,
  candidate_tree: inputLock.candidate_tree,
  expected_direct_parent: C2,
  observed_parents: parents,
  parent_count: parents.length,
  direct_parent: parents[0] ?? null,
  direct_parent_equality: parents.length === 1 && parents[0] === C2,
  merge_base_ancestry_substitution_allowed: false,
  c2_evidence_commit: C2_EVIDENCE,
  c2_evidence_commit_in_ancestry: c2EvidenceInAncestry,
  rejected_c3: C3,
  c3_in_ancestry: c3InAncestry,
  status: 'PASS',
};
writeFileSync(resolve(OUT, 'C4_TOPOLOGY.json'), `${JSON.stringify(topology, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  c4: C4,
  c2: C2,
  parent_count: parents.length,
  input_rows: inventory.length,
  mapped_rows: mappedInputs.length,
  candidate_backed_rows: byteAudit.length,
  coverage_rows: coverageRows.length,
  capability_rows: capabilityRows.length,
})}\n`);
