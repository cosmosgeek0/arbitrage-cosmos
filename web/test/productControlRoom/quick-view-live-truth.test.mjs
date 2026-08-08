import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Header contains module-level JSX. The production Vite pipeline supplies the
// JSX runtime; this shim lets Node exercise its exported truth projections.
globalThis.React = { createElement: (...args) => args };

const {
  LiveDot,
  calendarFeedIsCurrent,
  parseQuickViewItems,
  quickViewLivePresentation,
} = await import('../../src/components/Header.tsx');

test('LiveDot defaults off and quick views prove CURRENT only after a valid response', async () => {
  const defaultDot = LiveDot({});
  assert.equal(defaultDot[1].className, 'live-dot off');
  assert.equal(typeof calendarFeedIsCurrent, 'function');
  assert.equal(typeof parseQuickViewItems, 'function');
  assert.equal(typeof quickViewLivePresentation, 'function');

  assert.deepEqual(quickViewLivePresentation('LOADING'), {
    ok: false,
    title: 'Loading — awaiting current response',
  });
  assert.deepEqual(quickViewLivePresentation('UNAVAILABLE'), {
    ok: false,
    title: 'Unavailable — current response failed',
  });
  assert.deepEqual(quickViewLivePresentation('STALE'), {
    ok: false,
    title: 'Stale — response exceeded declared freshness',
  });
  assert.deepEqual(quickViewLivePresentation('CURRENT'), {
    ok: true,
    title: 'Live — current response',
  });

  assert.equal(calendarFeedIsCurrent({ fetchedAt: 900, state: 'fresh', maxAgeMs: 200 }, 1_000), true);
  assert.equal(calendarFeedIsCurrent({ fetchedAt: 800, state: 'fresh', maxAgeMs: 200 }, 1_000), false, 'expiry boundary is stale');
  assert.equal(calendarFeedIsCurrent({ fetchedAt: 900, state: 'stale', maxAgeMs: 200 }, 1_000), false, 'producer stale state fails closed');
  assert.equal(calendarFeedIsCurrent({ fetchedAt: 1_001, state: 'fresh', maxAgeMs: 200 }, 1_000), false, 'future receipt fails closed');
  assert.equal(calendarFeedIsCurrent({ fetchedAt: 900, state: 'fresh', maxAgeMs: 0 }, 1_000), false, 'non-positive freshness budget fails closed');
  assert.equal(calendarFeedIsCurrent({ fetchedAt: Number.NaN, state: 'fresh', maxAgeMs: 200 }, 1_000), false, 'non-finite receipt fails closed');

  assert.deepEqual(parseQuickViewItems({ items: [] }), [], 'a successful empty response is current');
  assert.deepEqual(parseQuickViewItems({ items: [{ id: 1 }] }), [{ id: 1 }]);
  assert.throws(() => parseQuickViewItems({}), /items array/);
  assert.throws(() => parseQuickViewItems({ items: null }), /items array/);

  const source = await readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8');
  assert.equal(source.match(/<LiveDot \{\.\.\.quickViewLivePresentation\(loadStatus\)\} \/>/g)?.length, 2);
  assert.doesNotMatch(source, /<LiveDot \/>/);
});
