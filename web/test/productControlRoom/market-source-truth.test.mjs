import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  INITIAL_MARKET_ADMISSION_STATE,
  decodeMarketSnapshot,
  normalizeMarketSourceTime,
  reduceMarketAdmission,
  resolveMarketFreshness,
} from '../../src/store.tsx';

const OBSERVED_AT_MS = 1_750_000_000_000;
const MAXIMUM_AGE_MS = 12_000;

function sourceTruth(overrides = {}) {
  return {
    spotBookTicker: 'fresh',
    futuresBookTicker: 'fresh',
    futures24hTicker: 'fresh',
    ...overrides,
  };
}

function marketRow(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    base: 'BTC',
    spot: 62_000,
    spotBid: 61_999,
    spotAsk: 62_001,
    spotBidQty: 2,
    spotAskQty: 3,
    spotSpreadPct: 0.003,
    spotTopQuoteUsd: 123_998,
    perpMark: 62_100,
    perpLast: 62_090,
    perpChange24hPct: 1.5,
    perpVolume24h: 1_000_000,
    perpHigh24h: 63_000,
    perpLow24h: 60_000,
    perpBid: 62_089,
    perpAsk: 62_091,
    perpBidQty: 4,
    perpAskQty: 5,
    perpSpreadPct: 0.0032,
    perpTopQuoteUsd: 248_356,
    basisPct: 0.161,
    oiToPerpVolume24h: 0.4,
    executableBasisLongSpotPct: 0.14,
    executableBasisShortSpotPct: -0.18,
    executableBasisBestPct: 0.14,
    executableBasisSide: 'LONG_SPOT_SHORT_PERP',
    fundingRate: 0.0001,
    nextFundingTime: OBSERVED_AT_MS + 3_600_000,
    change24hPct: 1.2,
    quoteVolume24h: 2_000_000,
    high24h: 63_100,
    low24h: 59_900,
    status: 'watching',
    spark: [61_000, 62_000],
    hasSpot: true,
    hasPerp: true,
    ...overrides,
  };
}

function marketReceipt({
  updatedAt = OBSERVED_AT_MS - 1_000,
  streamUpdatedAt = updatedAt,
  includeStreamUpdatedAt = true,
  dataSources = sourceTruth(),
  rows = [marketRow()],
} = {}) {
  const receipt = { updatedAt, dataSources, rows };
  if (includeStreamUpdatedAt) receipt.streamUpdatedAt = streamUpdatedAt;
  return receipt;
}

function admit(state, payload, observedAtMs = OBSERVED_AT_MS, maximumAgeMs = MAXIMUM_AGE_MS) {
  return reduceMarketAdmission(state, {
    kind: 'RECEIPT',
    payload,
    observedAtMs,
    maximumAgeMs,
  });
}

test('market receipts require valid non-future source time and expire at the strict boundary', () => {
  assert.throws(
    () => decodeMarketSnapshot(marketReceipt({ updatedAt: 0 }), OBSERVED_AT_MS, MAXIMUM_AGE_MS),
    /updatedAt is missing or invalid/,
  );
  assert.throws(
    () => decodeMarketSnapshot(
      marketReceipt({ updatedAt: OBSERVED_AT_MS + 1 }),
      OBSERVED_AT_MS,
      MAXIMUM_AGE_MS,
    ),
    /updatedAt is in the future/,
  );
  assert.throws(
    () => decodeMarketSnapshot(marketReceipt(), Number.NaN, MAXIMUM_AGE_MS),
    /observation time/,
  );

  const current = decodeMarketSnapshot(
    marketReceipt({
      updatedAt: OBSERVED_AT_MS - MAXIMUM_AGE_MS + 1,
      streamUpdatedAt: OBSERVED_AT_MS - MAXIMUM_AGE_MS + 1,
    }),
    OBSERVED_AT_MS,
    MAXIMUM_AGE_MS,
  );
  assert.equal(current.publicationError, null);

  const atBoundary = decodeMarketSnapshot(
    marketReceipt({
      updatedAt: OBSERVED_AT_MS - MAXIMUM_AGE_MS,
      streamUpdatedAt: OBSERVED_AT_MS - MAXIMUM_AGE_MS,
    }),
    OBSERVED_AT_MS,
    MAXIMUM_AGE_MS,
  );
  assert.match(atBoundary.publicationError, /not current/);

  const olderServer = decodeMarketSnapshot(
    marketReceipt({
      updatedAt: OBSERVED_AT_MS - 1_000,
      includeStreamUpdatedAt: false,
    }),
    OBSERVED_AT_MS,
    MAXIMUM_AGE_MS,
  );
  assert.equal(olderServer.streamUpdatedAt, undefined);
  assert.equal(olderServer.publicationError, null);

  const declaredStaleWithoutStream = decodeMarketSnapshot(
    marketReceipt({
      includeStreamUpdatedAt: false,
      dataSources: sourceTruth({ futuresBookTicker: 'stale' }),
    }),
    OBSERVED_AT_MS,
    MAXIMUM_AGE_MS,
  );
  assert.equal(declaredStaleWithoutStream.streamUpdatedAt, undefined);
  assert.match(declaredStaleWithoutStream.publicationError, /futuresBookTicker=stale/);

  const missingStreamTime = decodeMarketSnapshot(
    marketReceipt({ streamUpdatedAt: null }),
    OBSERVED_AT_MS,
    MAXIMUM_AGE_MS,
  );
  assert.match(missingStreamTime.publicationError, /not current/);
});

test('market source truth uses exactly three own keys without coercion', () => {
  for (const dataSources of [
    { ...sourceTruth(), extra: 'fresh' },
    sourceTruth({ futuresBookTicker: true }),
    sourceTruth({ futures24hTicker: 'FRESH' }),
    Object.assign(Object.create({ spotBookTicker: 'fresh' }), {
      futuresBookTicker: 'fresh',
      futures24hTicker: 'fresh',
    }),
  ]) {
    assert.throws(
      () => decodeMarketSnapshot(
        marketReceipt({ dataSources }),
        OBSERVED_AT_MS,
        MAXIMUM_AGE_MS,
      ),
      /Market source truth is invalid/,
    );
  }
  const symbolKeyed = sourceTruth();
  symbolKeyed[Symbol('extra')] = 'fresh';
  assert.throws(
    () => decodeMarketSnapshot(
      marketReceipt({ dataSources: symbolKeyed }),
      OBSERVED_AT_MS,
      MAXIMUM_AGE_MS,
    ),
    /Market source truth is invalid/,
  );
});

test('unavailable source fields are nulled without mutating the server row', () => {
  const input = marketRow();
  const decoded = decodeMarketSnapshot(marketReceipt({
    dataSources: sourceTruth({ spotBookTicker: 'unavailable' }),
    rows: [input],
  }), OBSERVED_AT_MS, MAXIMUM_AGE_MS);
  assert.match(decoded.publicationError, /spotBookTicker/);
  assert.equal(decoded.rows[0].spotBid, null);
  assert.equal(decoded.rows[0].spotAsk, null);
  assert.equal(decoded.rows[0].spotTopQuoteUsd, null);
  assert.equal(decoded.rows[0].perpBid, input.perpBid);
  assert.equal(decoded.rows[0].executableBasisBestPct, null);
  assert.equal(decoded.rows[0].executableBasisSide, null);
  assert.equal(input.spotBid, 61_999);
  assert.equal(input.executableBasisBestPct, 0.14);

  const futures24h = decodeMarketSnapshot(marketReceipt({
    dataSources: sourceTruth({ futures24hTicker: 'unavailable' }),
    rows: [input],
  }), OBSERVED_AT_MS, MAXIMUM_AGE_MS);
  assert.equal(futures24h.rows[0].perpLast, null);
  assert.equal(futures24h.rows[0].perpVolume24h, null);
  assert.equal(futures24h.rows[0].oiToPerpVolume24h, null);

  assert.throws(
    () => decodeMarketSnapshot(
      marketReceipt({ rows: [marketRow({ quoteVolume24h: Number.NaN })] }),
      OBSERVED_AT_MS,
      MAXIMUM_AGE_MS,
    ),
    /non-finite market response number/,
  );
});

test('market admission ignores older completions and deterministically admits newer receipts', () => {
  const firstPayload = marketReceipt({ updatedAt: OBSERVED_AT_MS - 2_000 });
  const first = admit(INITIAL_MARKET_ADMISSION_STATE, firstPayload);
  assert.equal(first.disposition, 'NEWER_CURRENT');
  assert.equal(first.state.rows[0].spot, 62_000);
  const firstSuccessAt = first.state.truth.lastSuccessAtMs;

  const older = admit(first.state, marketReceipt({
    updatedAt: OBSERVED_AT_MS - 3_000,
    rows: [marketRow({ spot: 1 })],
  }));
  assert.equal(older.disposition, 'OLDER_IGNORED');
  assert.strictEqual(older.state, first.state);

  const equalIdentical = admit(first.state, marketReceipt({
    updatedAt: OBSERVED_AT_MS - 2_000,
  }), OBSERVED_AT_MS + 100);
  assert.equal(equalIdentical.disposition, 'EQUAL_IDENTICAL_CURRENT');
  assert.equal(equalIdentical.state.truth.lastSuccessAtMs, firstSuccessAt);

  const inconsistentRetained = {
    ...first.state,
    truth: { status: 'UNAVAILABLE', lastSuccessAtMs: null, error: 'No measured success.' },
  };
  const refusedPromotion = admit(inconsistentRetained, firstPayload);
  assert.equal(refusedPromotion.disposition, 'EQUAL_IDENTICAL_NON_CURRENT');
  assert.equal(refusedPromotion.state.truth.status, 'UNAVAILABLE');
  assert.equal(refusedPromotion.state.truth.lastSuccessAtMs, null);

  const newer = admit(equalIdentical.state, marketReceipt({
    updatedAt: OBSERVED_AT_MS - 500,
    rows: [marketRow({ spot: 63_000 })],
  }), OBSERVED_AT_MS + 100);
  assert.equal(newer.disposition, 'NEWER_CURRENT');
  assert.equal(newer.state.rows[0].spot, 63_000);
  assert.equal(newer.state.updatedAt, OBSERVED_AT_MS - 500);
});

test('canonical equality ignores key order but same-time divergence latches conflict', () => {
  const updatedAt = OBSERVED_AT_MS - 1_000;
  const firstPayload = marketReceipt({
    updatedAt,
    dataSources: {
      spotBookTicker: 'fresh',
      futuresBookTicker: 'fresh',
      futures24hTicker: 'fresh',
    },
    rows: [marketRow()],
  });
  const first = admit(INITIAL_MARKET_ADMISSION_STATE, firstPayload);
  const reorderedPayload = {
    rows: [{ ...marketRow() }],
    dataSources: {
      futures24hTicker: 'fresh',
      spotBookTicker: 'fresh',
      futuresBookTicker: 'fresh',
    },
    streamUpdatedAt: updatedAt,
    updatedAt,
  };
  const equal = admit(first.state, reorderedPayload);
  assert.equal(equal.disposition, 'EQUAL_IDENTICAL_CURRENT');
  assert.equal(equal.state.normalizedReceiptIdentity, first.state.normalizedReceiptIdentity);

  const conflict = admit(equal.state, marketReceipt({
    updatedAt,
    rows: [marketRow({ spot: 62_001 })],
  }));
  assert.equal(conflict.disposition, 'CONFLICT');
  assert.equal(conflict.state.errorKind, 'CONFLICT');
  assert.equal(conflict.state.truth.status, 'STALE');
  assert.equal(conflict.state.rows[0].spot, 62_000);
  const conflictIdentity = conflict.state.normalizedReceiptIdentity;

  const equalAfterConflict = admit(conflict.state, firstPayload);
  assert.equal(equalAfterConflict.disposition, 'CONFLICT');
  assert.strictEqual(equalAfterConflict.state, conflict.state);
  const olderAfterConflict = admit(conflict.state, marketReceipt({ updatedAt: updatedAt - 1 }));
  assert.equal(olderAfterConflict.disposition, 'OLDER_IGNORED');
  assert.strictEqual(olderAfterConflict.state, conflict.state);
  const failureAfterConflict = reduceMarketAdmission(conflict.state, {
    kind: 'FAILURE',
    observedAtMs: OBSERVED_AT_MS + 10,
    error: 'network failed',
  });
  assert.equal(failureAfterConflict.disposition, 'FAILURE');
  assert.strictEqual(failureAfterConflict.state, conflict.state);
  assert.equal(failureAfterConflict.state.normalizedReceiptIdentity, conflictIdentity);

  const recovered = admit(conflict.state, marketReceipt({
    updatedAt: updatedAt + 1,
    streamUpdatedAt: updatedAt + 1,
    rows: [marketRow({ spot: 62_002 })],
  }));
  assert.equal(recovered.disposition, 'NEWER_CURRENT');
  assert.equal(recovered.state.errorKind, 'NONE');
  assert.equal(recovered.state.rows[0].spot, 62_002);
});

test('invalid, stale, and partial market receipts never advance current truth', () => {
  const invalid = admit(INITIAL_MARKET_ADMISSION_STATE, { rows: [] });
  assert.equal(invalid.disposition, 'FAILURE');
  assert.equal(invalid.state.updatedAt, null);
  assert.equal(invalid.state.truth.lastSuccessAtMs, null);
  assert.equal(invalid.state.truth.status, 'UNAVAILABLE');

  const stale = admit(INITIAL_MARKET_ADMISSION_STATE, marketReceipt({
    updatedAt: OBSERVED_AT_MS - MAXIMUM_AGE_MS,
    streamUpdatedAt: OBSERVED_AT_MS - MAXIMUM_AGE_MS,
  }));
  assert.equal(stale.disposition, 'NEWER_NON_CURRENT');
  assert.equal(stale.state.truth.lastSuccessAtMs, null);

  const current = admit(INITIAL_MARKET_ADMISSION_STATE, marketReceipt());
  const lastSuccessAtMs = current.state.truth.lastSuccessAtMs;
  const partial = admit(current.state, marketReceipt({
    updatedAt: OBSERVED_AT_MS - 500,
    streamUpdatedAt: OBSERVED_AT_MS - 500,
    dataSources: sourceTruth({ futures24hTicker: 'unavailable' }),
  }));
  assert.equal(partial.disposition, 'NEWER_NON_CURRENT');
  assert.equal(partial.state.truth.status, 'STALE');
  assert.equal(partial.state.truth.lastSuccessAtMs, lastSuccessAtMs);
});

test('market freshness requires an exact source timestamp, not socket connectivity', async () => {
  assert.equal(normalizeMarketSourceTime(undefined), null);
  assert.equal(normalizeMarketSourceTime(null), null);
  assert.equal(normalizeMarketSourceTime(Number.NaN), null);

  const exactSourceTimeMs = OBSERVED_AT_MS;
  assert.equal(normalizeMarketSourceTime(exactSourceTimeMs), exactSourceTimeMs);

  assert.deepEqual(resolveMarketFreshness({
    connected: true,
    error: null,
    sourceTimeMs: null,
    nowMs: exactSourceTimeMs + 1_000,
    staleAfterMs: 12_000,
  }), {
    status: 'UNKNOWN',
    live: false,
    ageMs: null,
  });

  assert.deepEqual(resolveMarketFreshness({
    connected: false,
    error: null,
    sourceTimeMs: exactSourceTimeMs,
    nowMs: exactSourceTimeMs + 1_000,
    staleAfterMs: 12_000,
  }), {
    status: 'LIVE',
    live: true,
    ageMs: 1_000,
  });

  const store = await readFile(new URL('../../src/store.tsx', import.meta.url), 'utf8');
  const markets = await readFile(new URL('../../src/pages/Markets.tsx', import.meta.url), 'utf8');
  assert.equal(
    (store.match(/admitMarketCompletion\(\{[\s\S]{0,200}?kind: 'RECEIPT'/g) ?? []).length,
    2,
    'poll and manual refresh must share the sole market admission seam',
  );
  assert.equal((store.match(/admitMarketCompletion\(\{[\s\S]{0,120}?kind: 'FAILURE'/g) ?? []).length, 2);
  assert.doesNotMatch(store, /setMarkets\(|setMarketTruth\(|setMarketsUpdatedAt\(|setMarketsError\(/);
  assert.match(store, /const result = reduceMarketAdmission\(previous, observation\)/);
  assert.match(store, /result\.disposition === 'OLDER_IGNORED'/);
  assert.match(store, /result\.state\.truth\.status !== 'CURRENT'/);
  assert.doesNotMatch(store, /MarketPublicationStatus|publicationStatus/);
  assert.match(markets, /resolveMarketFreshness\(/);
  assert.match(markets, /marketFreshnessStatus !== 'LIVE'/);
  assert.match(markets, /`MARKET_SOURCE_\$\{input\.marketFreshnessStatus\}`/);
});

test('Markets renders 24h volume only with complete current coverage', async () => {
  const source = await readFile(new URL('../../src/pages/Markets.tsx', import.meta.url), 'utf8');

  assert.match(source, /const volumeCoverageComplete = markets\.length > 0 && volumeKnownRows\.length === markets\.length/);
  assert.match(source, /marketReadSucceeded && volumeCoverageComplete \? fmtMoney\(totalVolume\) : 'UNKNOWN'/);
  assert.match(source, /Coverage UNKNOWN · \$\{volumeKnownRows\.length\} of \$\{markets\.length\} rows known/);
  assert.match(source, /function VolumeValue[\s\S]*finite\(value\)[\s\S]*<span className="mkx-dim">UNKNOWN<\/span>/);
  assert.equal(
    source.match(/<VolumeValue value=\{market\.(?:quoteVolume24h|perpVolume24h)\} \/>/g)?.length,
    3,
    'every row-level 24h volume must use the explicit UNKNOWN renderer',
  );
  assert.doesNotMatch(source, /<strong>\{marketReadSucceeded \? fmtMoney\(totalVolume\) : 'UNKNOWN'\}<\/strong>/);
});
