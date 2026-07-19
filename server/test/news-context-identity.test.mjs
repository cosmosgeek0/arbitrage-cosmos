import assert from 'node:assert/strict';
import test from 'node:test';

import { disambiguateNewsItemIds } from '../src/services/newsIdentity.ts';

function row(title, overrides = {}) {
  return {
    id: 'rss:yahoo-finance:reused-guid',
    sourceKey: 'yahoo-finance',
    channel: 'rss',
    ts: 1_784_390_000_000,
    title,
    url: `https://finance.yahoo.com/${title.toLowerCase().replaceAll(' ', '-')}`,
    ...overrides,
  };
}

test('news identity preserves distinct reused-GUID rows and collapses exact duplicates deterministically', () => {
  const first = row('First Story');
  const second = row('Second Story', { ts: first.ts + 1_000 });
  const input = [first, second, structuredClone(second)];

  const normalized = disambiguateNewsItemIds(input);
  const repeated = disambiguateNewsItemIds(input);
  assert.equal(normalized.length, 2, 'only the exact duplicate collapses');
  assert.equal(new Set(normalized.map((item) => item.id)).size, 2, 'distinct stories retain distinct IDs');
  assert.deepEqual(repeated, normalized, 'same input produces byte-stable identities');
  assert.ok(normalized.every((item) => item.id.length <= 240));
  assert.deepEqual(
    disambiguateNewsItemIds(normalized),
    normalized,
    'already-normalized archive rows stay stable across restart',
  );

  const byTitle = new Map(normalized.map((item) => [item.title, item.id]));
  const reversed = disambiguateNewsItemIds([...input].reverse());
  assert.deepEqual(
    new Map(reversed.map((item) => [item.title, item.id])),
    byTitle,
    'content-bound identity is independent of feed ordering',
  );
});
