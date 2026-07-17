import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AUTHORITY_PAYLOAD_SPECS,
  C9_CORRECTION_GRANTS,
  D_LAUNCH_65_AUTHORITY,
  EXACT_EVIDENCE_OUTPUTS,
  EXTERNAL_INPUT_SPECS,
  LOCKED_INPUT_PAYLOAD_ARCHIVE_PATH,
  LOCKED_INPUT_PAYLOAD_STORAGE_STATUS,
  LOCK_INVENTORY_MATRIX_REQUIREMENT_ID,
  REJECTED_CANDIDATE_SHAS,
  REJECTED_SELECTION_HISTORY,
  REQUIRED_C2_PARENT,
  REQUIRED_MATRIX_COUNTS,
  VFINAL5_AUTHORITY,
} from '../../../verification/product-truth-20260716/campaign-input-registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const CAMPAIGN = path.join(ROOT, 'verification/product-truth-20260716');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const withoutArchiveStorage = ({ archive_path, storage_status, ...member }) => member;

test('campaign payload registry preserves every external lock input as an archived hash binding', () => {
  const metadata = JSON.parse(readFileSync(path.join(CAMPAIGN, 'LOCKED_INPUT_PAYLOADS.json'), 'utf8'));
  assert.equal(metadata.storage_status, LOCKED_INPUT_PAYLOAD_STORAGE_STATUS);
  assert.equal(metadata.archive_path, LOCKED_INPUT_PAYLOAD_ARCHIVE_PATH);
  assert.equal(EXTERNAL_INPUT_SPECS.length, 23);
  assert.equal(metadata.members.length, 23);
  assert.equal(new Set(metadata.members.map((row) => row.input_id)).size, 23);

  const specs = new Map(EXTERNAL_INPUT_SPECS.map((row) => [row.inputId, row]));
  for (const member of metadata.members) {
    const spec = specs.get(member.input_id);
    assert.ok(spec, `unknown payload member ${member.input_id}`);
    assert.ok(!path.isAbsolute(member.payload_relative_path), `${member.input_id} must retain its historical clone-relative identity`);
    assert.equal(member.storage_status, LOCKED_INPUT_PAYLOAD_STORAGE_STATUS, `${member.input_id} storage status`);
    assert.equal(member.archive_path, LOCKED_INPUT_PAYLOAD_ARCHIVE_PATH, `${member.input_id} archive path`);
    assert.equal(spec.payloadStorageStatus, LOCKED_INPUT_PAYLOAD_STORAGE_STATUS, `${member.input_id} registry storage status`);
    assert.equal(spec.payloadArchivePath, LOCKED_INPUT_PAYLOAD_ARCHIVE_PATH, `${member.input_id} registry archive path`);
    assert.equal(member.sha256, spec.expectedSha256, `${member.input_id} registry sha256`);
    assert.equal(member.expected_sha256, spec.expectedSha256, `${member.input_id} preserved expected sha256`);
    assert.match(member.sha256, /^[a-f0-9]{64}$/u, `${member.input_id} sha256 shape`);
    assert.match(member.git_blob, /^[a-f0-9]{40}$/u, `${member.input_id} Git blob shape`);
    assert.ok(Number.isSafeInteger(member.byte_length) && member.byte_length > 0, `${member.input_id} byte length`);
  }
  assert.equal(
    metadata.inventory_sha256,
    sha256(Buffer.from(canonicalJson({
      members: metadata.members.map(withoutArchiveStorage),
      authority_members: metadata.authority_members.map(withoutArchiveStorage),
    }))),
  );
});

test('D-LAUNCH-65 and VFINAL5 authorities retain archived payload hash bindings without ambient current-main', () => {
  const metadata = JSON.parse(readFileSync(path.join(CAMPAIGN, 'LOCKED_INPUT_PAYLOADS.json'), 'utf8'));
  const authorities = new Map(metadata.authority_members.map((row) => [row.member_id, row]));
  const authoritySpecs = new Map(AUTHORITY_PAYLOAD_SPECS.map((row) => [row.memberId, row]));
  for (const [id, expected] of [
    ['authority:D_LAUNCH_65', D_LAUNCH_65_AUTHORITY],
    ['authority:VFINAL5_RECEIPT', VFINAL5_AUTHORITY],
  ]) {
    const member = authorities.get(id);
    const spec = authoritySpecs.get(id);
    assert.ok(member, `missing ${id}`);
    assert.ok(spec, `missing registry spec ${id}`);
    assert.equal(member.storage_status, LOCKED_INPUT_PAYLOAD_STORAGE_STATUS);
    assert.equal(member.archive_path, LOCKED_INPUT_PAYLOAD_ARCHIVE_PATH);
    assert.equal(spec.payloadStorageStatus, LOCKED_INPUT_PAYLOAD_STORAGE_STATUS);
    assert.equal(spec.payloadArchivePath, LOCKED_INPUT_PAYLOAD_ARCHIVE_PATH);
    assert.equal(member.byte_length, expected.byte_length);
    assert.equal(member.expected_byte_length, expected.byte_length);
    assert.equal(member.sha256, expected.sha256);
    assert.equal(member.expected_sha256, expected.sha256);
    assert.equal(spec.expectedSha256, expected.sha256);
    assert.equal(member.git_blob, expected.git_blob);
    assert.equal(member.expected_git_blob, expected.git_blob);
  }
});

test('exact-candidate generator source is fail-closed and covers the locked cardinalities', () => {
  const script = path.join(CAMPAIGN, 'generate-exact-candidate-evidence.mjs');
  const source = readFileSync(script, 'utf8');
  const censusSource = readFileSync(path.join(CAMPAIGN, 'generate-worktree-census.mjs'), 'utf8');
  const manifestSource = readFileSync(path.join(CAMPAIGN, 'generate-manifest.mjs'), 'utf8');
  const verifierSource = readFileSync(path.join(CAMPAIGN, 'verify-exact-candidate-evidence.mjs'), 'utf8');
  const directiveMatrix = readFileSync(path.join(CAMPAIGN, 'DIRECTIVE_COVERAGE_MATRIX.csv'), 'utf8');
  assert.equal(REQUIRED_C2_PARENT, 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561');
  assert.deepEqual(REJECTED_CANDIDATE_SHAS, [
    '41752d6a87dc1cb1b933bb4460c9cabfc15ff694',
    '78f708d6cdb9d1618c53d3f08f71097b4320a63b',
    '4c9143a0bcc331aa170e9e26b741240b39df8b9e',
    '959a5f9900e25f53414710bbfb3464c3ccb67a5d',
    '89cd7e066b97f2f33d730d1e0adf291ebe7c4f64',
    'a283eb859ec1142aadecbd64e0b84959535f6216',
    '6ab02a82931ae8234456c0710cca41b94fdc12c9',
  ]);
  assert.deepEqual(REJECTED_SELECTION_HISTORY.map((row) => row.label), ['C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
  assert.equal(new Set(REJECTED_SELECTION_HISTORY.map((row) => row.sha)).size, 6);
  assert.ok(REJECTED_SELECTION_HISTORY.every((row) => /^[a-f0-9]{40}$/u.test(row.tree)));
  assert.ok(REJECTED_SELECTION_HISTORY.every((row) => row.disposition.startsWith('REJECTED_')));
  assert.ok(REJECTED_SELECTION_HISTORY.every((row) => row.reason.length > 0));
  assert.equal(REQUIRED_MATRIX_COUNTS.DIRECTIVE_COVERAGE_MATRIX, 153);
  assert.equal(REQUIRED_MATRIX_COUNTS.CAPABILITY_TRUTH_MATRIX, 23);
  assert.equal(REQUIRED_MATRIX_COUNTS.COCKPIT_BINDING_MATRIX, 178);
  assert.equal(LOCK_INVENTORY_MATRIX_REQUIREMENT_ID, 'CAMP-09-PROVENANCE');
  assert.ok(C9_CORRECTION_GRANTS.includes('verification/product-truth-20260716/'));
  assert.deepEqual(EXACT_EVIDENCE_OUTPUTS.slice().sort(), [
    'AI_OPS_C2_DISPOSITION.json',
    'C2_PROOF_BINDING.json',
    'CAPABILITY_TRUTH_MATRIX.csv',
    'COCKPIT_BINDING_MATRIX.csv',
    'DIRECTIVE_COVERAGE_MATRIX.csv',
    'EVIDENCE_SELECTION.json',
    'INDEPENDENT_FINDINGS.json',
    'INPUTS.lock',
    'LOCKED_INPUT_PAYLOADS.json',
    'MANIFEST.json',
    'MANIFEST.sha256',
    'MERGE_PROVENANCE.json',
    'PRODUCT_ASSURANCE_C2_DISPOSITION.json',
    'STATE.md',
    'WORKTREE_CENSUS.json',
  ].sort());
  assert.equal(
    directiveMatrix.split('\n').filter((row) => row.startsWith(`"${LOCK_INVENTORY_MATRIX_REQUIREMENT_ID}",`)).length,
    1,
  );
  assert.match(source, /EXACT_FULL_CANDIDATE_SHA_REQUIRED/);
  assert.match(source, /CANDIDATE_PARENT_COUNT/);
  assert.match(source, /CANDIDATE_DIRECT_PARENT/);
  assert.match(source, /REJECTED_CANDIDATE_RELABEL_ATTEMPT/);
  assert.match(source, /C9_SOURCE_STATE_MARKER_MISSING/);
  assert.match(source, /generate-worktree-census\.mjs/);
  assert.match(source, /generate-manifest\.mjs/);
  assert.match(source, /product-truth-merge-provenance\.v3/);
  assert.match(source, /donor_blob_mismatches_at_candidate/);
  assert.match(source, /inventory_sha256: sha256/);
  assert.match(source, /PROVENANCE_UNEXPLAINED_EDITS/);
  assert.match(source, /post_candidate_path_allowlist: EXACT_EVIDENCE_OUTPUTS/);
  assert.match(source, /rejected_candidate_history: REJECTED_SELECTION_HISTORY/);
  assert.match(source, /\['DEP-004', \{/);
  assert.match(source, /C9 baseline custody token, fresh final-verifier verdict/);
  assert.match(source, /OVERRIDE_ROW_MISSING/);
  assert.match(verifierSource, /MATRIX_IDENTITY_SET/);
  assert.match(verifierSource, /MATRIX_DEPLOYMENT_RUNTIME_EVIDENCE/);
  assert.match(verifierSource, /INPUT_CONTENT_OID/);
  assert.match(verifierSource, /POST_CANDIDATE_EXACT_EVIDENCE_PATHS/);
  assert.match(verifierSource, /CENSUS_TRUTH_A_HEAD/);
  assert.match(verifierSource, /SELECTION_REJECTED_C8/);
  assert.match(verifierSource, /SELECTION_REJECTION_HISTORY/);
  assert.match(verifierSource, /SELECTION_REJECTED_C5_DISPOSITION/);
  assert.match(censusSource, /REJECTED_CANDIDATE_RELABEL_ATTEMPT/);
  assert.match(censusSource, /EXACT_FROZEN_CANDIDATE_NOT_MUTABLE_EVIDENCE_DESCENDANT_HEAD/);
  assert.match(censusSource, /SORTED_PORCELAIN_RECORDS_WITH_TRUTH_A_HEAD_NORMALIZED_TO_EXACT_CANDIDATE/);
  assert.match(censusSource, /exactStringList\(committedDelta, EXACT_EVIDENCE_PATHS\)/);
  assert.match(manifestSource, /6ab02a82931ae8234456c0710cca41b94fdc12c9/);
  assert.match(verifierSource, /6ab02a82931ae8234456c0710cca41b94fdc12c9/);
  assert.doesNotMatch(censusSource, /D-LAUNCH-65 is not in both current-main authority refs/);
  assert.doesNotMatch(source, /SOURCE_COMMIT_CANNOT_SELF_NAME/);
});
