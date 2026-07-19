import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  TOKEN_EVIDENCE_CAPABILITIES,
  parseSymbolAccountContext,
  parseTokenIntelligence,
  parseTokenNewsContext,
} from '../../src/lib/tokenIntelligence.ts';

const readSource = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8');
const readServerSource = (path) => readFile(new URL(`../../../server/src/${path}`, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 6, 18, 12, 0, 0);

function capability(id) {
  return {
    capability: id,
    freshness: 'FRESH',
    completeness: id === 'LIQUIDATION' ? 'SAMPLED' : 'COMPLETE',
    lastEvidenceTimeMs: NOW - 100,
    sourceIds: ['binance-public'],
    reasonCodes: id === 'LIQUIDATION' ? ['SAMPLED_LATEST_PER_SYMBOL_LOWER_BOUND'] : [],
  };
}

function fact(sourceId, dataset, value) {
  return { state: 'FRESH', sourceId, dataset, observedAtMs: NOW - 100, value, reasonCodes: [] };
}

function validTokenRead() {
  return {
    schemaVersion: 'token-intelligence-owner-read.v1',
    symbol: 'BTCUSDT',
    observedAtMs: NOW,
    projection: {
      state: 'ACTIVE',
      usdm: { connected: true, feedState: 'open' },
      liquidation: { connected: true, feedState: 'open' },
    },
    markFunding: fact('binance-futures-market-stream', 'usd_m.mark_price', {
      markPrice: 60_000, indexPrice: 59_990, fundingRate: 0.0001, nextFundingTimeMs: NOW + 1_000,
    }),
    openInterest: fact('binance-futures-rest', 'usd_m.open_interest', {
      base: 1_000, quoteUsd: 60_000_000, changePct: 1.25,
    }),
    liquidation: fact('binance-futures-market-stream', 'usd_m.liquidation', {
      total15mUsd: 120_000, long15mUsd: 100_000, short15mUsd: 20_000,
      sampling: 'LATEST_PER_SYMBOL_LOWER_BOUND',
    }),
    routing: {
      symbol: 'BTCUSDT',
      observedAtMs: NOW,
      capabilities: TOKEN_EVIDENCE_CAPABILITIES.map(capability),
      authority: 'EVIDENCE_ONLY',
      liveMoneyAuthority: 'NONE',
    },
    bridge: {
      symbol: 'BTCUSDT',
      evaluatedAtMs: NOW,
      featureSnapshot: null,
      evidenceHistoryCount: 1,
      evidenceHistoryState: 'COMPLETE',
      attention: null,
      artifact: null,
      reasonCodes: ['INTELLIGENCE_ARTIFACT_MISSING'],
      authority: 'EVIDENCE_ONLY',
      liveMoneyAuthority: 'NONE',
      currentState: 'CURRENT',
    },
    authority: 'EVIDENCE_ONLY',
    liveMoneyAuthority: 'NONE',
  };
}

test('strict Token owner parser accepts the canonical read and returns only bounded UI truth', () => {
  const raw = validTokenRead();
  const parsed = parseTokenIntelligence(raw, 'BTCUSDT', NOW);
  assert.ok(parsed);
  assert.equal(parsed.symbol, 'BTCUSDT');
  assert.equal(parsed.routing.capabilities.length, TOKEN_EVIDENCE_CAPABILITIES.length);
  assert.equal(parsed.openInterest.value.quoteUsd, 60_000_000);
  assert.equal(parsed.liquidation.value.sampling, 'LATEST_PER_SYMBOL_LOWER_BOUND');
  assert.equal(parsed.bridge.evidenceHistoryCount, 1);
  assert.equal(parsed.bridge.thesis, null);
  assert.equal('featureSnapshot' in parsed.bridge, false, 'unused owner internals are not retained in browser state');
  raw.openInterest.value.quoteUsd = 1;
  assert.equal(parsed.openInterest.value.quoteUsd, 60_000_000, 'parser snapshots data instead of retaining caller aliases');
});

test('strict Token owner parser rejects wrong symbols, extras, incomplete capability sets, contradictions, and hostile objects', () => {
  const wrongSymbol = validTokenRead();
  wrongSymbol.symbol = 'ETHUSDT';
  assert.equal(parseTokenIntelligence(wrongSymbol, 'BTCUSDT', NOW), null);

  const extra = validTokenRead();
  extra.syntheticConfidence = 0.99;
  assert.equal(parseTokenIntelligence(extra, 'BTCUSDT', NOW), null);

  const incomplete = validTokenRead();
  incomplete.routing.capabilities.pop();
  assert.equal(parseTokenIntelligence(incomplete, 'BTCUSDT', NOW), null);

  const duplicate = validTokenRead();
  duplicate.routing.capabilities[1] = duplicate.routing.capabilities[0];
  assert.equal(parseTokenIntelligence(duplicate, 'BTCUSDT', NOW), null);

  const staleValue = validTokenRead();
  staleValue.openInterest.state = 'STALE';
  assert.equal(parseTokenIntelligence(staleValue, 'BTCUSDT', NOW), null, 'non-fresh facts cannot carry current values');

  const historicalCurrent = validTokenRead();
  historicalCurrent.bridge.currentState = 'HISTORICAL_ONLY';
  historicalCurrent.bridge.featureSnapshot = {};
  assert.equal(parseTokenIntelligence(historicalCurrent, 'BTCUSDT', NOW), null);

  for (const count of [256, 257, 2_048]) {
    const boundedHistory = validTokenRead();
    boundedHistory.bridge.evidenceHistoryCount = count;
    assert.ok(parseTokenIntelligence(boundedHistory, 'BTCUSDT', NOW), `history count ${count} remains a bounded scalar`);
  }
  const overboundHistory = validTokenRead();
  overboundHistory.bridge.evidenceHistoryCount = 2_049;
  assert.equal(parseTokenIntelligence(overboundHistory, 'BTCUSDT', NOW), null);

  const futureRoot = validTokenRead();
  futureRoot.observedAtMs = NOW + 1;
  futureRoot.routing.observedAtMs = NOW + 1;
  futureRoot.bridge.evaluatedAtMs = NOW + 1;
  assert.equal(parseTokenIntelligence(futureRoot, 'BTCUSDT', NOW), null, 'future root observations fail closed');

  const artifactAfterBridge = validTokenRead();
  artifactAfterBridge.bridge.evaluatedAtMs = NOW - 100;
  artifactAfterBridge.bridge.artifact = {
    symbol: 'BTCUSDT',
    instrumentId: 'BTCUSDT',
    evaluatedAtMs: NOW,
    authority: 'EVIDENCE_ONLY',
    thesis: {
      instrumentId: 'BTCUSDT',
      hypothesis: 'UNCLASSIFIED_ANOMALY',
      stage: 'UNCLASSIFIED',
      changedFirst: null,
      changedAtMs: NOW,
      leadMarket: 'UNKNOWN',
      reasonCodes: [],
    },
  };
  assert.equal(parseTokenIntelligence(artifactAfterBridge, 'BTCUSDT', NOW), null, 'artifact cannot postdate its Bridge cut');

  const thesisAfterArtifact = structuredClone(artifactAfterBridge);
  thesisAfterArtifact.bridge.artifact.evaluatedAtMs = NOW - 100;
  thesisAfterArtifact.bridge.artifact.thesis.changedAtMs = NOW;
  assert.equal(parseTokenIntelligence(thesisAfterArtifact, 'BTCUSDT', NOW), null, 'thesis change cannot postdate its artifact');

  const capabilityAfterRouting = validTokenRead();
  capabilityAfterRouting.routing.observedAtMs = NOW - 1_000;
  assert.equal(
    parseTokenIntelligence(capabilityAfterRouting, 'BTCUSDT', NOW),
    null,
    'capability evidence cannot postdate the exact router snapshot',
  );

  for (const mutate of [
    (row) => { row.openInterest.observedAtMs = NOW + 1; },
    (row) => { row.routing.observedAtMs = NOW + 1; },
    (row) => { row.bridge.evaluatedAtMs = NOW + 1; },
    (row) => { row.openInterest.value.base = -1; },
    (row) => { row.markFunding.value.markPrice = -1; },
    (row) => { row.markFunding.value.fundingRate = 99; },
    (row) => { row.liquidation.value.short15mUsd = -1; },
    (row) => { row.liquidation.value.total15mUsd = 1; },
    (row) => { row.projection.usdm = { connected: false, feedState: 'open' }; },
    (row) => { row.projection.liquidation = { connected: true, feedState: 'closed' }; },
    (row) => { row.routing.capabilities[0].completeness = 'MISSING'; },
    (row) => { row.bridge.featureSnapshot = { symbol: 'ETHUSDT' }; },
    (row) => { row.markFunding.sourceId = 'lookalike-source'; },
  ]) {
    const hostileRead = validTokenRead();
    mutate(hostileRead);
    assert.equal(parseTokenIntelligence(hostileRead, 'BTCUSDT', NOW), null);
  }

  const activeWithoutFresh = validTokenRead();
  for (const name of ['markFunding', 'openInterest', 'liquidation']) {
    activeWithoutFresh[name].state = 'MISSING';
    activeWithoutFresh[name].value = null;
  }
  for (const row of activeWithoutFresh.routing.capabilities) {
    row.freshness = 'MISSING';
    row.completeness = 'MISSING';
  }
  assert.equal(parseTokenIntelligence(activeWithoutFresh, 'BTCUSDT', NOW), null);

  const degradedWithFreshCapabilities = validTokenRead();
  degradedWithFreshCapabilities.projection.state = 'DEGRADED';
  for (const name of ['markFunding', 'openInterest', 'liquidation']) {
    degradedWithFreshCapabilities[name].state = 'MISSING';
    degradedWithFreshCapabilities[name].observedAtMs = null;
    degradedWithFreshCapabilities[name].value = null;
  }
  assert.equal(
    parseTokenIntelligence(degradedWithFreshCapabilities, 'BTCUSDT', NOW),
    null,
    'degraded projection cannot render fresh capability rows',
  );

  const sparse = validTokenRead();
  sparse.routing.capabilities = new Array(TOKEN_EVIDENCE_CAPABILITIES.length);
  sparse.routing.capabilities[0] = capability(TOKEN_EVIDENCE_CAPABILITIES[0]);
  assert.equal(parseTokenIntelligence(sparse, 'BTCUSDT', NOW), null);

  let getterReads = 0;
  const accessor = validTokenRead();
  Object.defineProperty(accessor, 'symbol', {
    enumerable: true,
    get() { getterReads += 1; return 'BTCUSDT'; },
  });
  assert.equal(parseTokenIntelligence(accessor, 'BTCUSDT', NOW), null);
  assert.equal(getterReads, 0);

  const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('hostile prototype'); } });
  assert.equal(parseTokenIntelligence(hostile, 'BTCUSDT', NOW), null);
  assert.equal(parseTokenIntelligence(null, 'BTCUSDT', NOW), null);
});

test('context parsers preserve unavailable states and reject false-zero contradictions', () => {
  const account = parseSymbolAccountContext({
    accountTruthState: 'AVAILABLE',
    orderTruthState: 'AVAILABLE',
    borrowTruthState: 'NOT_CONFIGURED',
    openOrders: [],
    balances: { base: 0, usdtFree: 0 },
    fills: [], signals: [], allowlisted: true, blocklisted: false,
  });
  assert.deepEqual(account, {
    accountTruthState: 'AVAILABLE', orderTruthState: 'AVAILABLE', borrowTruthState: 'NOT_CONFIGURED', openOrders: [], balances: { base: 0, usdtFree: 0 },
  });
  assert.equal(parseSymbolAccountContext({
    accountTruthState: 'UNAVAILABLE', orderTruthState: 'UNAVAILABLE', borrowTruthState: 'NOT_CONFIGURED', openOrders: null, balances: { base: 0, usdtFree: 0 },
  }), null);

  const newsRaw = {
    source: 'primary+venue+protocol+issuer+tree+rss+lookonchain',
    fetchedAt: NOW,
    items: [{
      id: 'n1', title: 'Owner-tagged item', source: 'Venue', sourceKey: 'venue', channel: 'venue',
      ts: NOW - 1_000, symbols: ['BTC'], summary: null, url: null,
    }],
    sources: [{ key: 'venue', status: 'live', fetchedAt: NOW - 500, label: 'Venue' }],
  };
  const news = parseTokenNewsContext(newsRaw, NOW + 1_000);
  assert.ok(news);
  assert.equal(news.freshness, 'FRESH');
  assert.equal(news.items[0].symbols[0], 'BTC');
  assert.equal(news.sources[0].status, 'live');
  assert.equal(parseTokenNewsContext({ ...newsRaw, source: 'synthetic' }, NOW + 1_000), null);
  assert.equal(parseTokenNewsContext({ ...newsRaw, fetchedAt: NOW + 1_001 }, NOW + 1_000), null);
  assert.equal(parseTokenNewsContext({ ...newsRaw, items: [{ ...newsRaw.items[0], ts: NOW + 1 }] }, NOW + 1_000), null);
  assert.equal(parseTokenNewsContext({ ...newsRaw, sources: [{ ...newsRaw.sources[0], fetchedAt: null }] }, NOW + 1_000), null);
  assert.ok(parseTokenNewsContext({
    ...newsRaw,
    sources: [{ ...newsRaw.sources[0], status: 'delayed', fetchedAt: null }],
  }, NOW + 1_000), 'archive bootstrap may truthfully be delayed with unknown source age');
  assert.equal(parseTokenNewsContext({ ...newsRaw, items: [...newsRaw.items, { ...newsRaw.items[0] }] }, NOW + 1_000), null);
  assert.equal(parseTokenNewsContext(newsRaw, NOW + 5 * 60_000 + 1)?.freshness, 'STALE');
  assert.equal(account?.borrowTruthState, 'NOT_CONFIGURED');
});

test('Token consumes canonical owner readbacks without browser-owned OI truth', async () => {
  const source = await readSource('pages/TokenDetail.tsx');
  for (const endpoint of [
    '/api/intelligence/token?symbol=',
    '/api/symbol/context?symbol=',
    '/api/news-context?limit=220',
  ]) assert.match(source, new RegExp(endpoint.replaceAll('/', '\\/').replace('?', '\\?')));
  assert.doesNotMatch(source, /\/api\/loans/);

  assert.doesNotMatch(source, /\/api\/futures\/oi-hist/);
  assert.doesNotMatch(source, /openInterestSnapshot|setOpenInterestSnapshot|latest\.notional|previous\.notional/);
  assert.doesNotMatch(source, /CgxPanel|type CgxTab|token-cgx-oi/);
  assert.match(source, /MarketEngine -> router -> Bridge/);
  assert.match(source, /This owner publishes no confidence score/);
  assert.match(source, /zero does not prove absence/);
  assert.match(source, /anyFreshEvidence/);
  for (const capabilityId of TOKEN_EVIDENCE_CAPABILITIES) assert.match(source, new RegExp(capabilityId));
  for (const truth of ['UNKNOWN', 'UNAVAILABLE', 'EVIDENCE_ONLY']) assert.match(source, new RegExp(truth));
  assert.match(source, /borrowTruthState/);
  assert.equal((source.match(/<ProductSurfaceAdapter surfaceId="token" \/>/g) ?? []).length, 1);
  assert.ok(source.indexOf('<TokenEvidenceWorkspace') > source.indexOf('<ProductSurfaceAdapter surfaceId="token" />'));
});

test('news readback repairs owner identifier collisions on GET, refresh, and stream paths', async () => {
  const source = await readServerSource('index.ts');
  assert.match(source, /function canonicalNewsContextRead/);
  assert.match(source, /disambiguateNewsItemIds\(payload\.items\)/);
  assert.equal((source.match(/canonicalNewsContextRead\(payload\)/g) ?? []).length, 3);
});

test('Token evidence layout has bounded desktop and narrow-container contracts', async () => {
  const css = await readSource('pages/TokenDetail.css');
  assert.match(css, /\.tkx-owner-evidence\s*\{/);
  assert.match(css, /\.tkx-owner-thesis,[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@container \(max-width: 980px\)[\s\S]*\.tkx-owner-body\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /@container \(max-width: 760px\)[\s\S]*\.tkx-token-news\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /\.tkx-capability-list span\s*\{[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*470;/);
  assert.match(css, /\.tkx-capability-list strong\s*\{[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*510;/);
  assert.match(css, /\.tkx-capability-list small\s*\{[^}]*font-size:\s*10\.5px;[^}]*font-weight:\s*410;/);
  assert.match(css, /\.tkx-token-news strong\s*\{[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*470;/);
  assert.match(css, /\.tkx-token-news small\s*\{[^}]*font-size:\s*10\.5px;[^}]*font-weight:\s*410;/);
  assert.doesNotMatch(css, /font-weight:\s*(?:5[7-9][0-9]|[6-9][0-9]{2})/);
});
