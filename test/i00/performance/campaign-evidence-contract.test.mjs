import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  C8_CORRECTION_GRANTS,
  D_LAUNCH_65_AUTHORITY,
  EXACT_EVIDENCE_OUTPUTS,
  EXTERNAL_INPUT_SPECS,
  LOCK_INVENTORY_MATRIX_REQUIREMENT_ID,
  REJECTED_CANDIDATE_SHAS,
  REQUIRED_C2_PARENT,
  REQUIRED_MATRIX_COUNTS,
  VFINAL5_AUTHORITY,
} from '../../../verification/product-truth-20260716/campaign-input-registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const CAMPAIGN = path.join(ROOT, 'verification/product-truth-20260716');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gitBlob = (bytes) => createHash('sha1')
  .update(Buffer.from(`blob ${bytes.length}\0`))
  .update(bytes)
  .digest('hex');
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

test('campaign payload registry makes every external lock input independently rehashable', () => {
  const metadata = JSON.parse(readFileSync(path.join(CAMPAIGN, 'LOCKED_INPUT_PAYLOADS.json'), 'utf8'));
  assert.equal(EXTERNAL_INPUT_SPECS.length, 23);
  assert.equal(metadata.members.length, 23);
  assert.equal(new Set(metadata.members.map((row) => row.input_id)).size, 23);

  const specs = new Map(EXTERNAL_INPUT_SPECS.map((row) => [row.inputId, row]));
  for (const member of metadata.members) {
    const spec = specs.get(member.input_id);
    assert.ok(spec, `unknown payload member ${member.input_id}`);
    assert.ok(!path.isAbsolute(member.payload_relative_path), `${member.input_id} must be clone-relative`);
    const bytes = readFileSync(path.join(CAMPAIGN, member.payload_relative_path));
    assert.equal(bytes.length, member.byte_length, `${member.input_id} byte length`);
    assert.equal(sha256(bytes), member.sha256, `${member.input_id} sha256`);
    assert.equal(gitBlob(bytes), member.git_blob, `${member.input_id} Git blob`);
    assert.equal(member.sha256, spec.expectedSha256, `${member.input_id} registry sha256`);
  }
  assert.equal(
    metadata.inventory_sha256,
    sha256(Buffer.from(canonicalJson({
      members: metadata.members,
      authority_members: metadata.authority_members,
    }))),
  );
});

test('D-LAUNCH-65 and VFINAL5 authorities are payload-bound without ambient current-main', () => {
  const metadata = JSON.parse(readFileSync(path.join(CAMPAIGN, 'LOCKED_INPUT_PAYLOADS.json'), 'utf8'));
  const authorities = new Map(metadata.authority_members.map((row) => [row.member_id, row]));
  for (const [id, expected] of [
    ['authority:D_LAUNCH_65', D_LAUNCH_65_AUTHORITY],
    ['authority:VFINAL5_RECEIPT', VFINAL5_AUTHORITY],
  ]) {
    const member = authorities.get(id);
    assert.ok(member, `missing ${id}`);
    const bytes = readFileSync(path.join(CAMPAIGN, member.payload_relative_path));
    assert.equal(bytes.length, expected.byte_length);
    assert.equal(sha256(bytes), expected.sha256);
    assert.equal(gitBlob(bytes), expected.git_blob);
  }
});

test('exact-candidate generator source is fail-closed and covers the locked cardinalities', () => {
  const script = path.join(CAMPAIGN, 'generate-exact-candidate-evidence.mjs');
  const source = readFileSync(script, 'utf8');
  const censusSource = readFileSync(path.join(CAMPAIGN, 'generate-worktree-census.mjs'), 'utf8');
  const verifierSource = readFileSync(path.join(CAMPAIGN, 'verify-exact-candidate-evidence.mjs'), 'utf8');
  const directiveMatrix = readFileSync(path.join(CAMPAIGN, 'DIRECTIVE_COVERAGE_MATRIX.csv'), 'utf8');
  assert.equal(REQUIRED_C2_PARENT, 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561');
  assert.deepEqual(REJECTED_CANDIDATE_SHAS.slice(-4), [
    '4c9143a0bcc331aa170e9e26b741240b39df8b9e',
    '959a5f9900e25f53414710bbfb3464c3ccb67a5d',
    '89cd7e066b97f2f33d730d1e0adf291ebe7c4f64',
    'a283eb859ec1142aadecbd64e0b84959535f6216',
  ]);
  assert.equal(REQUIRED_MATRIX_COUNTS.DIRECTIVE_COVERAGE_MATRIX, 153);
  assert.equal(REQUIRED_MATRIX_COUNTS.CAPABILITY_TRUTH_MATRIX, 23);
  assert.equal(REQUIRED_MATRIX_COUNTS.COCKPIT_BINDING_MATRIX, 178);
  assert.equal(LOCK_INVENTORY_MATRIX_REQUIREMENT_ID, 'CAMP-09-PROVENANCE');
  assert.ok(C8_CORRECTION_GRANTS.includes('verification/product-truth-20260716/'));
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
  assert.match(source, /C8_SOURCE_STATE_MARKER_MISSING/);
  assert.match(source, /generate-worktree-census\.mjs/);
  assert.match(source, /generate-manifest\.mjs/);
  assert.match(source, /product-truth-merge-provenance\.v3/);
  assert.match(source, /donor_blob_mismatches_at_candidate/);
  assert.match(source, /inventory_sha256: sha256/);
  assert.match(source, /PROVENANCE_UNEXPLAINED_EDITS/);
  assert.match(source, /post_candidate_path_allowlist: EXACT_EVIDENCE_OUTPUTS/);
  assert.match(source, /\['DEP-004', \{/);
  assert.match(source, /C8 baseline custody token, fresh final-verifier verdict/);
  assert.match(source, /OVERRIDE_ROW_MISSING/);
  assert.match(verifierSource, /MATRIX_IDENTITY_SET/);
  assert.match(verifierSource, /MATRIX_DEPLOYMENT_RUNTIME_EVIDENCE/);
  assert.match(verifierSource, /INPUT_CONTENT_OID/);
  assert.match(verifierSource, /POST_CANDIDATE_EXACT_EVIDENCE_PATHS/);
  assert.doesNotMatch(censusSource, /D-LAUNCH-65 is not in both current-main authority refs/);
  assert.doesNotMatch(source, /SOURCE_COMMIT_CANNOT_SELF_NAME/);
});
