import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Header contains module-level JSX. The production Vite pipeline supplies the
// JSX runtime; this tiny test shim lets Node import its pure projection export.
globalThis.React = { createElement: (...args) => args };

const { projectPerpetualSearchFacts } = await import('../../src/components/Header.tsx');

test('global search keeps missing perpetual facts unknown instead of borrowing spot facts', async () => {
  const facts = projectPerpetualSearchFacts({
    spot: 73_000,
    change24hPct: 8.25,
    perpMark: null,
    perpLast: null,
    perpVolume24h: null,
    perpChange24hPct: null,
    fundingRate: null,
  });

  assert.deepEqual(facts, {
    perpMark: null,
    volume: null,
    changePct: null,
    fundingRate: null,
  });

  const canonicalPerpetualFacts = projectPerpetualSearchFacts({
    spot: 73_000,
    change24hPct: 8.25,
    perpMark: null,
    perpLast: 72_950,
    perpVolume24h: 15_000_000,
    perpChange24hPct: -1.5,
    fundingRate: 0,
  });
  assert.deepEqual(canonicalPerpetualFacts, {
    perpMark: 72_950,
    volume: 15_000_000,
    changePct: -1.5,
    fundingRate: 0,
  });

  const source = await readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /<em>50X<\/em>/);
  assert.doesNotMatch(source, /\/hr funding/);
  assert.doesNotMatch(source, /fundingRate \?\? 0/);
  assert.match(source, /UNKNOWN funding/);
});
