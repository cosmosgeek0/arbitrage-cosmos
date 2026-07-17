import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  D_LAUNCH_65_AUTHORITY,
  EXTERNAL_INPUT_SPECS,
  LOCK_INVENTORY_MATRIX_REQUIREMENT_ID,
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
  const directiveMatrix = readFileSync(path.join(CAMPAIGN, 'DIRECTIVE_COVERAGE_MATRIX.csv'), 'utf8');
  assert.equal(REQUIRED_C2_PARENT, 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561');
  assert.equal(REQUIRED_MATRIX_COUNTS.DIRECTIVE_COVERAGE_MATRIX, 153);
  assert.equal(REQUIRED_MATRIX_COUNTS.CAPABILITY_TRUTH_MATRIX, 23);
  assert.equal(REQUIRED_MATRIX_COUNTS.COCKPIT_BINDING_MATRIX, 178);
  assert.equal(LOCK_INVENTORY_MATRIX_REQUIREMENT_ID, 'CAMP-09-PROVENANCE');
  assert.equal(
    directiveMatrix.split('\n').filter((row) => row.startsWith(`"${LOCK_INVENTORY_MATRIX_REQUIREMENT_ID}",`)).length,
    1,
  );
  assert.match(source, /EXACT_FULL_CANDIDATE_SHA_REQUIRED/);
  assert.match(source, /CANDIDATE_PARENT_COUNT/);
  assert.match(source, /CANDIDATE_DIRECT_PARENT/);
  assert.match(source, /generate-worktree-census\.mjs/);
  assert.match(source, /generate-manifest\.mjs/);
  assert.doesNotMatch(source, /SOURCE_COMMIT_CANNOT_SELF_NAME/);
});
