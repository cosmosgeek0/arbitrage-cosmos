import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('frozen contracts, fixtures, and preview match the packet hash inventory', async () => {
  const inventory = await readFile(new URL('../CONTRACT_HASHES.sha256', import.meta.url), 'utf8');
  const rows = inventory.trim().split('\n').map((line) => {
    const match = line.match(/^([a-f0-9]{64})  (frontier\/portfolio-lab\/(?:contracts|fixtures|preview)\/.+)$/);
    assert.ok(match, line);
    return { expected: match[1], path: match[2] };
  });
  assert.equal(rows.length, 14);
  assert.deepEqual(rows.map((row) => row.path), [...rows.map((row) => row.path)].sort());
  for (const row of rows) {
    const relative = row.path.replace('frontier/portfolio-lab/', '../');
    const bytes = await readFile(new URL(relative, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.expected, row.path);
  }
});
