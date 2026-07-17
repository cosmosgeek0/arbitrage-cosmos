import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  D_LAUNCH_65_AUTHORITY,
  EXTERNAL_INPUT_SPECS,
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

test('exact-candidate generator is fail-closed and covers the locked cardinalities', () => {
  const script = path.join(CAMPAIGN, 'generate-exact-candidate-evidence.mjs');
  const selfTest = spawnSync(process.execPath, [script, '--self-test'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(selfTest.status, 0, selfTest.stderr);
  assert.deepEqual(JSON.parse(selfTest.stdout), {
    self_test: true,
    external_inputs: 23,
    locked_inputs: 61,
    matrix_cells: 354,
  });
  assert.equal(REQUIRED_C2_PARENT, 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561');
  assert.equal(REQUIRED_MATRIX_COUNTS.DIRECTIVE_COVERAGE_MATRIX, 153);
  assert.equal(REQUIRED_MATRIX_COUNTS.CAPABILITY_TRUTH_MATRIX, 23);
  assert.equal(REQUIRED_MATRIX_COUNTS.COCKPIT_BINDING_MATRIX, 178);

  const missingCandidate = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.notEqual(missingCandidate.status, 0);
  assert.match(missingCandidate.stderr, /EXACT_FULL_CANDIDATE_SHA_REQUIRED/);
});
