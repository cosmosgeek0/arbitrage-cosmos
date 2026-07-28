import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { projectMarketApiRow } from '../src/engine/marketApiProjection.ts';

const indexSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

function sourceBetween(start, end) {
  const startAt = indexSource.indexOf(start);
  assert.notEqual(startAt, -1, `missing source boundary: ${start}`);
  const endAt = indexSource.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing source boundary: ${end}`);
  return indexSource.slice(startAt, endAt);
}

test('passive market projection preserves Basis, Volume, and Opportunities facts without REST enrichment', () => {
  const published = Object.freeze({
    symbol: 'BTCUSDT',
    base: 'BTC',
    spot: 100,
    perpMark: 100.5,
    perpIndexPrice: 100.25,
    markIndexBasisPct: 0.24937655860349128,
    basisPct: 0.5,
    openInterest: 1_250,
    openInterestUsd: 125_625,
    openInterestChangePct: 2.5,
    openInterestUpdatedAt: 1_750_000_000_003,
    liquidations15mUsd: 12_500,
    longLiquidations15mUsd: 10_000,
    shortLiquidations15mUsd: 2_500,
    fundingRate: 0.0001,
    nextFundingTime: 1_750_000_060_000,
    change24hPct: 1.25,
    quoteVolume24h: 250_000_000,
    high24h: 102,
    low24h: 98,
    status: 'idle',
    hasSpot: true,
    hasPerp: true,
  });
  const spark = Object.freeze([99, 100, 100.5]);

  const row = projectMarketApiRow({ row: published, spark });

  assert.deepEqual({
    symbol: row.symbol,
    spot: row.spot,
    perpMark: row.perpMark,
    basisPct: row.basisPct,
    fundingRate: row.fundingRate,
    openInterestUsd: row.openInterestUsd,
    openInterestUpdatedAt: row.openInterestUpdatedAt,
    liquidations15mUsd: row.liquidations15mUsd,
    quoteVolume24h: row.quoteVolume24h,
    change24hPct: row.change24hPct,
    high24h: row.high24h,
    low24h: row.low24h,
    spark: row.spark,
  }, {
    symbol: 'BTCUSDT',
    spot: 100,
    perpMark: 100.5,
    basisPct: 0.5,
    fundingRate: 0.0001,
    openInterestUsd: 125_625,
    openInterestUpdatedAt: 1_750_000_000_003,
    liquidations15mUsd: 12_500,
    quoteVolume24h: 250_000_000,
    change24hPct: 1.25,
    high24h: 102,
    low24h: 98,
    spark: [99, 100, 100.5],
  });
  assert.deepEqual({
    spotBid: row.spotBid,
    spotAsk: row.spotAsk,
    spotSpreadPct: row.spotSpreadPct,
    spotTopQuoteUsd: row.spotTopQuoteUsd,
    perpBid: row.perpBid,
    perpAsk: row.perpAsk,
    perpSpreadPct: row.perpSpreadPct,
    perpTopQuoteUsd: row.perpTopQuoteUsd,
    perpVolume24h: row.perpVolume24h,
    oiToPerpVolume24h: row.oiToPerpVolume24h,
    executableBasisBestPct: row.executableBasisBestPct,
    executableBasisSide: row.executableBasisSide,
  }, {
    spotBid: null,
    spotAsk: null,
    spotSpreadPct: null,
    spotTopQuoteUsd: null,
    perpBid: null,
    perpAsk: null,
    perpSpreadPct: null,
    perpTopQuoteUsd: null,
    perpVolume24h: null,
    oiToPerpVolume24h: null,
    executableBasisBestPct: null,
    executableBasisSide: null,
  });
  assert.ok(Math.abs(row.fundingAnnualPct - 10.95) < Number.EPSILON * 64);
  assert.notEqual(row.spark, spark, 'the API row owns a copy of published spark evidence');
});

test('Product owner truth and core markets route cannot enter full-universe REST enrichment', () => {
  const publishedCut = sourceBetween(
    'function readPublishedMarketCut()',
    'function publishedMarketOwnerTruth(',
  );
  const ownerTruth = sourceBetween(
    'async function readProductOwnerTruth(',
    "app.get('/api/markets',",
  );
  const coreRoute = sourceBetween(
    "app.get('/api/markets',",
    "app.get('/api/markets/enrichment',",
  );
  const passiveOwners = `${publishedCut}\n${ownerTruth}\n${coreRoute}`;

  assert.match(publishedCut, /engine\.allRows\(\)/);
  assert.match(publishedCut, /projectMarketApiRow\(\{\s*row,\s*spark:/);
  assert.match(ownerTruth, /publishedMarketOwnerTruth\(readPublishedMarketCut\(\)\)/);
  assert.match(coreRoute, /const snapshot = readPublishedMarketCut\(\)/);
  assert.doesNotMatch(
    passiveOwners,
    /\b(?:marketSources|readMarketEnrichmentSnapshot|fetchAllBookTickers|fetchAllFutures24hTickers)\s*\(/,
  );
});

test('published market observedAt is derived from accepted engine evidence, never response time', () => {
  const publishedCut = sourceBetween(
    'function readPublishedMarketCut()',
    'function publishedMarketOwnerTruth(',
  );
  const ownerTruthProjection = sourceBetween(
    'function publishedMarketOwnerTruth(',
    'async function readMarketEnrichmentSnapshot(',
  );
  const coreRoute = sourceBetween(
    "app.get('/api/markets',",
    "app.get('/api/markets/enrichment',",
  );

  assert.match(publishedCut, /let observedAtMs = 0/);
  assert.match(publishedCut, /engine\.priceUpdatedAt\(row\.symbol\)/);
  assert.match(publishedCut, /engine\.markEventTimestamp\(row\.symbol\)/);
  assert.match(publishedCut, /row\.openInterestUpdatedAt/);
  assert.match(publishedCut, /engine\.liquidationEventTimestamp\(row\.symbol\)/);
  assert.doesNotMatch(publishedCut, /Date\.now\(\)/);
  assert.match(ownerTruthProjection, /observedAtMs: cut\.observedAtMs/);
  assert.match(coreRoute, /updatedAt: snapshot\.observedAtMs/);
  assert.doesNotMatch(coreRoute, /Date\.now\(\)/);
});

test('full-universe enrichment is admitted only through the Markets-ON route', () => {
  const routeMapping = sourceBetween(
    'function optionalSurfaceForRequest(',
    "app.use('/api', (req, res, next) =>",
  );
  const admissionMiddleware = sourceBetween(
    "app.use('/api', (req, res, next) =>",
    '// Ambient bearer material cannot widen Phase 2 authority.',
  );
  const generationFence = sourceBetween(
    'function assertCurrentMarketGeneration(',
    'type PublishedMarketCut =',
  );
  const enrichmentSnapshot = sourceBetween(
    'async function readMarketEnrichmentSnapshot(',
    'async function readProductOwnerTruth(',
  );
  const enrichmentRoute = sourceBetween(
    "app.get('/api/markets/enrichment',",
    "app.get('/api/market/detail',",
  );

  assert.match(routeMapping, /pathname === '\/api\/markets\/enrichment'\) return 'markets'/);
  assert.doesNotMatch(routeMapping, /pathname === '\/api\/markets'\) return 'markets'/);
  assert.match(admissionMiddleware, /optionalSurfaceControl\.acquire\(surface\)/);
  assert.match(admissionMiddleware, /res\.locals\.optionalSurface/);

  const enabledCheckAt = generationFence.indexOf("optionalSurfaceControl.enabled('markets')");
  const generationCheckAt = generationFence.indexOf(
    "optionalSurfaceControl.snapshot('markets').generation !== context.generation",
  );
  const firstRestDispatchAt = generationFence.indexOf("fetchAllBookTickers('spot', restLifecycle)");
  const cachePublicationAt = generationFence.indexOf('marketSourceCache = snapshot');
  assert.ok(enabledCheckAt >= 0, 'enrichment owner must check Markets admission');
  assert.ok(generationCheckAt > enabledCheckAt, 'admission must bind the admitted generation');
  assert.ok(firstRestDispatchAt > generationCheckAt, 'generation admission must precede REST dispatch');
  assert.ok(cachePublicationAt > firstRestDispatchAt, 'cache publication follows settled REST work');
  assert.match(generationFence, /context\.signal\.aborted/);
  assert.match(
    generationFence,
    /marketSourceCache\.generation === context\.generation/,
    'a later generation cannot consume a prior generation cache',
  );
  assert.match(
    generationFence,
    /marketSourceInFlight\?\.generation === context\.generation/,
    'a later generation cannot join prior generation REST work',
  );
  assert.ok(
    generationFence.lastIndexOf('assertCurrentMarketGeneration(context)') < cachePublicationAt,
    'settled REST work must cross the generation fence immediately before cache publication',
  );
  assert.match(enrichmentSnapshot, /await marketSources\(context\)/);
  assert.match(enrichmentSnapshot, /assertCurrentMarketGeneration\(context\)/);
  assert.match(enrichmentRoute, /res\.locals\.optionalSurface/);
  assert.match(enrichmentRoute, /if \(!context\) throw new OptionalSurfaceOffError\('markets'\)/);
  assert.match(enrichmentRoute, /await readMarketEnrichmentSnapshot\(context\)/);
});
