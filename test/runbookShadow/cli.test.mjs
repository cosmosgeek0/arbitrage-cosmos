import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { drillDocument, ROOT } from './lib/constants.mjs';

function execute(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  assert.notEqual(statSync(absolutePath).mode & 0o111, 0, `${relativePath} must be executable`);
  const result = spawnSync(absolutePath, [], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

test('each drill is directly runnable with a simple JSON pass/fail receipt', () => {
  for (const definition of drillDocument().drills) {
    const receipt = execute(definition.entrypoint);
    assert.equal(receipt.drillId, definition.id);
    assert.equal(receipt.result, 'PASS');
    assert.equal(receipt.exitCode, 0);
  }
});

test('run-all is directly executable and reports eight passes', () => {
  const output = execute('test/runbookShadow/run-all.mjs');
  assert.equal(output.packetDisposition, 'SHADOW_SPECULATIVE');
  assert.equal(output.result, 'PASS');
  assert.equal(output.passed, 8);
  assert.equal(output.total, 8);
});
