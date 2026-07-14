import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  ACCEPTED_S1_SOURCE,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const REPO = resolve(import.meta.dirname, '../../../..');
const gitText = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const gitBytes = (...args) => execFileSync('git', args, { cwd: REPO });

test('accepted S1 branch and all pinned contract blobs are recomputed from Git objects', () => {
  assert.equal(gitText('rev-parse', ACCEPTED_S1_SOURCE.branch), ACCEPTED_S1_SOURCE.commit);
  for (const [pathKey, blobKey, digestKey] of [
    ['schemaPath', 'schemaBlob', 'schemaSha256'],
    ['validationPath', 'validationBlob', 'validationSha256'],
    ['baselinePath', 'baselineBlob', 'baselineSha256'],
    ['evaluatorPath', 'evaluatorBlob', 'evaluatorSha256'],
  ]) {
    const path = ACCEPTED_S1_SOURCE[pathKey];
    const blob = gitText('rev-parse', `${ACCEPTED_S1_SOURCE.commit}:${path}`);
    assert.equal(blob, ACCEPTED_S1_SOURCE[blobKey], path);
    const digest = createHash('sha256').update(gitBytes('cat-file', 'blob', blob)).digest('hex');
    assert.equal(digest, ACCEPTED_S1_SOURCE[digestKey], path);
  }
});
