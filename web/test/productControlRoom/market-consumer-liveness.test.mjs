import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// Header contains module-level JSX. Vite supplies the JSX runtime in
// production; this shim lets Node import its pure liveness projection.
globalThis.React = { createElement: (...args) => args };

const { projectMarketConsumerTruth } = await import('../../src/components/Header.tsx');

test('retained and unavailable market projections cannot present as current', () => {
  assert.deepEqual(projectMarketConsumerTruth({
    status: 'LOADING',
    lastSuccessAtMs: null,
    sourceUpdatedAtMs: null,
    nowMs: 10_000,
  }), {
    label: 'LOADING',
    evidenceAtMs: null,
    evidenceAgeMs: null,
    factsAvailable: false,
    retained: false,
  });

  assert.deepEqual(projectMarketConsumerTruth({
    status: 'CURRENT',
    lastSuccessAtMs: 9_000,
    sourceUpdatedAtMs: 8_000,
    nowMs: 10_000,
  }), {
    label: 'CURRENT',
    evidenceAtMs: 8_000,
    evidenceAgeMs: 2_000,
    factsAvailable: true,
    retained: false,
  });

  assert.deepEqual(projectMarketConsumerTruth({
    status: 'STALE',
    lastSuccessAtMs: 9_000,
    sourceUpdatedAtMs: 8_000,
    nowMs: 10_000,
  }), {
    label: 'STALE LAST-KNOWN',
    evidenceAtMs: 8_000,
    evidenceAgeMs: 2_000,
    factsAvailable: true,
    retained: true,
  });

  assert.deepEqual(projectMarketConsumerTruth({
    status: 'UNAVAILABLE',
    lastSuccessAtMs: null,
    sourceUpdatedAtMs: null,
    nowMs: 10_000,
  }), {
    label: 'UNAVAILABLE',
    evidenceAtMs: null,
    evidenceAgeMs: null,
    factsAvailable: false,
    retained: false,
  });

  assert.equal(
    projectMarketConsumerTruth({
      status: 'CURRENT',
      lastSuccessAtMs: null,
      sourceUpdatedAtMs: 8_000,
      nowMs: 10_000,
    }).label,
    'UNAVAILABLE',
    'a contradictory current status without a successful read must fail closed',
  );
});

test('Opportunities and global search consume the shared market liveness projection', async () => {
  const opportunities = await readFile(new URL('../../src/pages/Opportunities.tsx', import.meta.url), 'utf8');
  const header = await readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8');

  assert.match(opportunities, /marketStatus/);
  assert.match(opportunities, /marketsLastSuccessAtMs/);
  assert.match(opportunities, /projectMarketConsumerTruth/);
  assert.match(opportunities, /STALE LAST-KNOWN/);
  assert.match(header, /marketTruth\.factsAvailable/);
  assert.match(header, /STALE LAST-KNOWN/);
});

test('Markets keeps the ledger-bound mover filter without browser-invented pulse or fee economics', async () => {
  const markets = await readFile(new URL('../../src/pages/Markets.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(markets, /Top 50|Top-50|top50(?:Pulse|Weight|Up)?/);
  assert.match(markets, /type Filter = 'all' \| 'watchlist' \| 'paired' \| 'books' \| 'spotOnly' \| 'movers';/);
  assert.match(markets, /\{ id: 'movers', label: 'Liquid Movers' \}/);
  assert.match(markets, /case 'movers': filtered = filtered\.filter\(\(market\) => finite\(market\.change24hPct\) && Math\.abs\(market\.change24hPct\) >= 2 && finite\(market\.quoteVolume24h\) && market\.quoteVolume24h >= 1_000_000\); break;/);
  assert.doesNotMatch(markets, /Net After Fees|feesPct|const net =/);
  assert.match(markets, /Change Coverage UNKNOWN/);
  assert.match(markets, /if \(view === 'basis'\)[\s\S]*market\.executableBasisBestPct[\s\S]*market\.fundingRate[\s\S]*market\.executableBasisSide/);
});
