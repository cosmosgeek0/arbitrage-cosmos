import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Header contains module-level JSX. The production Vite pipeline supplies the
// JSX runtime; this shim lets Node exercise its exported truth projections.
globalThis.React = { createElement: (...args) => args };

const {
  LiveDot,
  parseQuickViewItems,
  quickViewLivePresentation,
} = await import('../../src/components/Header.tsx');

test('LiveDot defaults off and quick views prove CURRENT only after a valid response', async () => {
  const defaultDot = LiveDot({});
  assert.equal(defaultDot[1].className, 'live-dot off');
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
  assert.deepEqual(quickViewLivePresentation('CURRENT'), {
    ok: true,
    title: 'Live — current response',
  });

  assert.deepEqual(parseQuickViewItems({ items: [] }), [], 'a successful empty response is current');
  assert.deepEqual(parseQuickViewItems({ items: [{ id: 1 }] }), [{ id: 1 }]);
  assert.throws(() => parseQuickViewItems({}), /items array/);
  assert.throws(() => parseQuickViewItems({ items: null }), /items array/);

  const source = await readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8');
  assert.equal(source.match(/<LiveDot \{\.\.\.quickViewLivePresentation\(loadStatus\)\} \/>/g)?.length, 2);
  assert.doesNotMatch(source, /<LiveDot \/>/);
});
