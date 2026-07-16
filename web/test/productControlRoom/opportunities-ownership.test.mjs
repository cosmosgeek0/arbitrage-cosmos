import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Opportunities renders source-order raw facts and cannot derive strategy, rank, or fee-adjusted edge', async () => {
  const source = await readFile(new URL('../../src/pages/Opportunities.tsx', import.meta.url), 'utf8');

  assert.match(source, /type View = 'active' \| 'raw'/);
  assert.match(source, /label: 'Raw Market Facts'/);
  assert.match(source, /if \(!query\) return markets;/);
  assert.match(source, /return finite\(value\) \? format\(value\) : 'UNKNOWN';/);
  assert.match(source, /rawFact\(market\.basisPct,/);
  assert.match(source, /rawFact\(market\.fundingRate,/);
  assert.match(source, /rawFact\(market\.quoteVolume24h,/);
  assert.match(source, /Raw Basis/);
  assert.match(source, /Raw Funding/);
  assert.match(source, /Raw 24h Volume/);
  assert.match(source, /Canonical Opportunity Projection[\s\S]*UNKNOWN/);

  assert.doesNotMatch(source, /sideForBasis|netAfterFees|SIDE_LABEL|SIDE_SHORT/);
  assert.doesNotMatch(source, /Direction|Net After Fees|Carry|Reverse Basis|Long Spot|Short Perp/);
  assert.doesNotMatch(source, /\.sort\s*\(|\.slice\s*\(|minQuoteVolume24h|feesPct/);
  assert.doesNotMatch(source, /basisPct\s*\?\?|fundingRate\s*\?\?|quoteVolume24h\s*\?\?\s*0/);
  assert.doesNotMatch(source, /maxSpread|topDepth|marketQuality|Math\.abs|Math\.max|Math\.min/);
  assert.doesNotMatch(source, /state\.proposals|proposals\.map|netEdgePct|confidence/);
});
