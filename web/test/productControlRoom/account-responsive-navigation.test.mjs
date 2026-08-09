import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8');

function cssBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing CSS block ${marker}`);

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  assert.fail(`unterminated CSS block ${marker}`);
}

test('narrow Account tablist stays viewport-bound and horizontally scrollable', async () => {
  const css = await read('pages/Account.css');
  const baseScroller = cssBlock(css, '.accountx-viewbar > div {');
  const narrowLayout = cssBlock(css, '@container (max-width: 850px) {');

  assert.match(baseScroller, /min-width:\s*0;/);
  assert.match(baseScroller, /overflow-x:\s*auto;/);
  assert.match(
    narrowLayout,
    /\.accountx-viewbar\s*>\s*div\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*\}/s,
  );
});
