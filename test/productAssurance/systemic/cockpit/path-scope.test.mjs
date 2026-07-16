import assert from 'node:assert/strict';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workspace = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
const fixtureRoot = realpathSync(path.join(workspace, 'fixtures/productAssurance/systemic/cockpit'));
const testRoot = realpathSync(path.join(workspace, 'test/productAssurance/systemic/cockpit'));

function files(root) {
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    const stat = lstatSync(target);
    assert.equal(stat.isSymbolicLink(), false, `${target} must not escape scope through a symlink`);
    if (entry.isDirectory()) output.push(...files(target));
    else if (entry.isFile()) output.push(realpathSync(target));
  }
  return output.sort();
}

test('cockpit packet files remain in the two exclusive subtrees', () => {
  const fixtureFiles = files(fixtureRoot);
  const testFiles = files(testRoot);
  const packetLocalNotes = new Set([
    path.join(fixtureRoot, 'receipts/S5_COCKPIT_PRESTAGE_RECEIPT.md'),
    path.join(fixtureRoot, 'state/S5_STATE.md'),
  ]);
  assert.ok(fixtureFiles.length >= 7);
  assert.ok(testFiles.length >= 4);
  for (const file of fixtureFiles) {
    assert.ok(file.startsWith(`${fixtureRoot}${path.sep}`), file);
    assert.ok(file.endsWith('.json') || file.endsWith('.mjs') || packetLocalNotes.has(file), file);
  }
  for (const file of testFiles) {
    assert.ok(file.startsWith(`${testRoot}${path.sep}`), file);
    assert.ok(file.endsWith('.test.mjs') || file.endsWith('.mjs'), file);
  }
});
