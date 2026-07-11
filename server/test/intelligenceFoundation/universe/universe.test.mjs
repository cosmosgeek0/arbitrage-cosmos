import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { stableId, validateTruthMetadata } from '../../../dist/intelligenceFoundation/contracts/index.js';
import {
  buildUniverseGraph,
  createUniversePolicy,
  diffUniverseGraphs,
  findUniverseNode,
  updateUniverseGraph,
} from '../../../dist/intelligenceFoundation/universe/index.js';

const T0 = 1_720_000_000_000;

function truth(sourceId, dataset, recordId, overrides = {}) {
  const freshnessState = overrides.freshnessState ?? 'FRESH';
  const completenessState = overrides.completenessState ?? 'COMPLETE';
  const unavailable = freshnessState === 'UNAVAILABLE';
  const evaluatedAtMs = overrides.evaluatedAtMs ?? T0;
  const eventMs = overrides.eventMs ?? (freshnessState === 'STALE' ? evaluatedAtMs - 10_000 : evaluatedAtMs - 100);
  const receivedTimeMs = overrides.receivedTimeMs ?? evaluatedAtMs - 25;
  const maxAgeMs = overrides.maxAgeMs ?? 5_000;
  const basis = unavailable ? 'UNAVAILABLE' : 'SOURCE_EVENT_TIME';
  const ageMs = unavailable ? null : evaluatedAtMs - eventMs;
  return {
    schemaVersion: '1',
    producerVersion: 'universe-test-1',
    configurationVersion: 'fixture-1',
    featureVersion: null,
    authority: {
      kind: 'EXCHANGE_PRIMARY',
      sourceId,
      dataset,
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: recordId ? [recordId] : [],
      sourceSet: [sourceId],
      transforms: ['official-shaped-fixture'],
    },
    temporal: {
      sourceEventTimeMs: unavailable ? null : eventMs,
      sourceTransactionTimeMs: null,
      receivedTimeMs,
      sequence: null,
    },
    freshness: {
      basis,
      evaluatedAtMs,
      ageMs,
      maxAgeMs: unavailable ? null : maxAgeMs,
      state: freshnessState,
    },
    completeness: {
      state: completenessState,
      observedFields: completenessState === 'MISSING' ? [] : ['identity', 'status'],
      missingFields: completenessState === 'COMPLETE' ? [] : ['source fields'],
      reasonCodes: completenessState === 'COMPLETE' ? [] : ['SOURCE_INCOMPLETE'],
    },
  };
}

function quoteVolume(symbol, quoteAsset, amountUsd, overrides = {}) {
  const id = overrides.id ?? `volume:${symbol}`;
  const rate = Object.hasOwn(overrides, 'usdConversionRate') ? overrides.usdConversionRate : 1;
  const quoteAmount = Object.hasOwn(overrides, 'quoteVolume24h') ? overrides.quoteVolume24h : amountUsd;
  return {
    id,
    quoteAsset,
    quoteVolume24h: quoteAmount,
    usdConversionRate: rate,
    quoteVolume24hUsd: rate === null ? null : quoteAmount * rate,
    truth: overrides.truth ?? truth('binance-24hr-ticker', 'ticker24hr', id),
    conversionTruth: rate === null
      ? null
      : overrides.conversionTruth ?? truth('usd-conversion', `${quoteAsset.toLowerCase()}-usd`, `conversion:${quoteAsset}`),
  };
}

function instrument(family, symbol, base, quote = 'USDT', overrides = {}) {
  const sourceMarketType = family === 'USD_M_PERPETUAL' ? 1 : family === 'COIN_M_PERPETUAL' ? 2 : null;
  return {
    instrumentId: stableId('instrument', { venue: 'BINANCE', family, symbol, base, quote, sourceMarketType }),
    venue: 'BINANCE',
    productFamily: family,
    symbol,
    pair: family === 'BORROW' ? null : symbol,
    baseAsset: base,
    quoteAsset: family === 'BORROW' ? null : quote,
    contractType: family === 'USD_M_PERPETUAL' ? 'PERPETUAL' : null,
    sourceMarketType,
    ...overrides,
  };
}

const rules = (overrides = {}) => ({
  minimumPrice: 0.000001,
  maximumPrice: null,
  tickSize: 0.000001,
  minimumQuantity: 0.1,
  maximumQuantity: null,
  quantityStep: 0.1,
  minimumNotional: 5,
  maximumNotional: null,
  ...overrides,
});

function listing(family, symbol, base, overrides = {}) {
  const isSpot = family === 'SPOT';
  const id = overrides.id ?? `${isSpot ? 'spot' : 'perp'}:${symbol}:${overrides.status ?? 'TRADING'}`;
  const quoteAsset = overrides.quote ?? 'USDT';
  const requestedUsdVolume = Object.hasOwn(overrides, 'quoteVolume24hUsd') ? overrides.quoteVolume24hUsd : 0;
  const volume = Object.hasOwn(overrides, 'quoteVolume')
    ? overrides.quoteVolume
    : requestedUsdVolume === null ? null : quoteVolume(symbol, quoteAsset, requestedUsdVolume);
  return {
    id,
    kind: isSpot ? 'SPOT_LISTING' : 'USD_M_PERPETUAL_LISTING',
    instrument: instrument(family, overrides.sourceSymbol ?? symbol, base, quoteAsset),
    tradingStatus: overrides.status ?? 'TRADING',
    tradingAllowed: Object.hasOwn(overrides, 'tradingAllowed') ? overrides.tradingAllowed : true,
    aliases: overrides.aliases ?? [symbol],
    rules: rules(overrides.rules),
    quoteVolume: volume,
    quoteVolume24hUsd: requestedUsdVolume,
    truth: overrides.truth ?? truth(isSpot ? 'binance-spot' : 'binance-usdm', 'exchangeInfo', id, { eventMs: overrides.eventMs }),
  };
}

function margin(symbol, base, overrides = {}) {
  const id = overrides.id ?? `margin:${symbol}`;
  return {
    id,
    instrument: instrument('MARGIN', symbol, base),
    marginTradingAllowed: overrides.marginTradingAllowed ?? true,
    buyAllowed: overrides.buyAllowed ?? true,
    sellAllowed: overrides.sellAllowed ?? true,
    isolatedMarginAllowed: overrides.isolatedMarginAllowed ?? false,
    aliases: overrides.aliases ?? [symbol],
    truth: overrides.truth ?? truth('binance-margin', 'crossMarginPairs', id),
  };
}

function borrow(base, overrides = {}) {
  const id = overrides.id ?? `borrow:${base}`;
  const availability = overrides.availability ?? 'AVAILABLE';
  return {
    id,
    kind: 'BORROW',
    instrument: instrument('BORROW', base, base, null),
    asset: base,
    eligibility: overrides.eligibility ?? 'ELIGIBLE',
    availability,
    systemAvailableAmount: availability === 'AVAILABLE' ? (overrides.systemAvailableAmount ?? 100) : null,
    accountBorrowLimit: overrides.accountBorrowLimit ?? null,
    hourlyInterestRateDecimal: overrides.hourlyInterestRateDecimal ?? 0.00002,
    inventoryAmount: overrides.inventoryAmount ?? null,
    truth: overrides.truth ?? truth('binance-margin', 'borrowInventory', id),
  };
}

function coverage(family, symbol, base, overrides = {}) {
  const id = overrides.id ?? `coverage:${family}:${symbol}`;
  return {
    id,
    instrument: instrument(family, symbol, base),
    publicData: {
      state: overrides.publicState ?? 'AVAILABLE',
      evidenceKinds: overrides.publicKinds ?? ['BOOK_TICKER', 'TRADE'],
      reasonCodes: overrides.publicReasons ?? [],
    },
    focusedData: {
      state: overrides.focusedState ?? 'AVAILABLE',
      evidenceKinds: overrides.focusedKinds ?? ['DEPTH_SNAPSHOT'],
      reasonCodes: overrides.focusedReasons ?? [],
    },
    truth: overrides.truth ?? truth('market-data-router', 'coverage', id),
  };
}

function slice(source, records, state = 'COMPLETE', truthOverride = null) {
  return {
    source,
    state,
    records,
    truth: truthOverride ?? truth(`source-${source.toLowerCase()}`, `${source.toLowerCase()}-snapshot`, `slice:${source}`, state === 'UNAVAILABLE'
      ? { freshnessState: 'UNAVAILABLE', completenessState: 'MISSING' }
      : state === 'PARTIAL'
        ? { completenessState: 'PARTIAL' }
        : {}),
  };
}

function snapshot(overrides = {}) {
  return {
    observedAtMs: T0,
    spot: overrides.spot ?? slice('SPOT', []),
    usdMPerpetual: overrides.usdMPerpetual ?? slice('USD_M_PERPETUAL', []),
    margin: overrides.margin ?? slice('MARGIN', []),
    borrow: overrides.borrow ?? slice('BORROW', []),
    coverage: overrides.coverage ?? slice('COVERAGE', []),
  };
}

test('joins Spot, USD-M, margin, borrow, and coverage without discarding a dormant symbol', () => {
  const spot = listing('SPOT', 'DORMUSDT', 'DORM', { quoteVolume24hUsd: 0 });
  const perp = listing('USD_M_PERPETUAL', 'DORMUSDT', 'DORM', { quoteVolume24hUsd: 0 });
  const graph = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [spot]),
    usdMPerpetual: slice('USD_M_PERPETUAL', [perp]),
    margin: slice('MARGIN', [margin('DORMUSDT', 'DORM')]),
    borrow: slice('BORROW', [borrow('DORM')]),
    coverage: slice('COVERAGE', [coverage('SPOT', 'DORMUSDT', 'DORM'), coverage('USD_M_PERPETUAL', 'DORMUSDT', 'DORM')]),
  }), createUniversePolicy({
    requirePerpetualForFocus: true,
    requireMarginForFocus: true,
    requireBorrowEligibilityForFocus: true,
    requireBorrowAvailabilityForFocus: true,
    requireFocusedDataForFocus: true,
  }));

  assert.equal(graph.failures.length, 0);
  assert.equal(graph.nodes.length, 1);
  const node = graph.nodes[0];
  assert.equal(node.activity, 'DORMANT');
  assert.equal(node.visibility.state, 'VISIBLE');
  assert.ok(node.visibility.reasonCodes.includes('DORMANT_SYMBOL_RETAINED'));
  assert.equal(node.spot.instrument.instrumentId, spot.instrument.instrumentId);
  assert.equal(node.usdMPerpetual.instrument.instrumentId, perp.instrument.instrumentId);
  assert.equal(node.margin.state, 'ELIGIBLE');
  assert.equal(node.borrow.eligibility, 'ELIGIBLE');
  assert.equal(node.publicData.state, 'AVAILABLE');
  assert.equal(node.focusedData.state, 'AVAILABLE');
  assert.equal(node.focusEligibility.state, 'ELIGIBLE');
  assert.equal(validateTruthMetadata(node.truth).ok, true);
  assert.equal(validateTruthMetadata(graph.aliases[0].truth).ok, true);
  assert.equal(findUniverseNode(graph, 'dormusdt')?.id, node.id);
});

test('visibility is independent from low-volume focus policy', () => {
  const graph = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [listing('SPOT', 'QUIETUSDT', 'QUIET', { quoteVolume24hUsd: 100 })]),
    coverage: slice('COVERAGE', [coverage('SPOT', 'QUIETUSDT', 'QUIET')]),
  }), createUniversePolicy({ minimumQuoteVolume24hUsdForFocus: 1_000_000 }));
  const node = graph.nodes[0];
  assert.equal(node.visibility.state, 'VISIBLE');
  assert.equal(node.activity, 'LOW_VOLUME');
  assert.equal(node.focusEligibility.state, 'INELIGIBLE');
  assert.ok(node.focusEligibility.reasonCodes.includes('QUOTE_VOLUME_BELOW_FOCUS_MINIMUM'));
  assert.ok(node.reasonCodes.includes('LOW_VOLUME_SYMBOL_RETAINED'));
});

test('stable graph, node, and alias IDs do not depend on evaluation wall-clock time', () => {
  const input = snapshot({
    spot: slice('SPOT', [listing('SPOT', 'STABLEUSDT', 'STABLE')]),
    coverage: slice('COVERAGE', [coverage('SPOT', 'STABLEUSDT', 'STABLE')]),
  });
  const first = buildUniverseGraph(input);
  const later = buildUniverseGraph({ ...input, observedAtMs: T0 + 1_000 });
  assert.equal(first.id, later.id);
  assert.equal(first.nodes[0].id, later.nodes[0].id);
  assert.equal(first.aliases[0].id, later.aliases[0].id);
  assert.equal(first.truth.freshness.evaluatedAtMs, T0);
  assert.equal(later.truth.freshness.evaluatedAtMs, T0);
  assert.equal(later.observedAtMs, T0 + 1_000);
});

test('complete missing truth is ineligible while unavailable source truth remains unknown', () => {
  const spotRecord = listing('SPOT', 'MISSUSDT', 'MISS', { quoteVolume24hUsd: 50_000 });
  const coverageRecord = coverage('SPOT', 'MISSUSDT', 'MISS');
  const policy = createUniversePolicy({
    requirePerpetualForFocus: true,
    requireBorrowEligibilityForFocus: true,
  });
  const completeMissing = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [spotRecord]),
    coverage: slice('COVERAGE', [coverageRecord]),
  }), policy);
  assert.equal(completeMissing.nodes[0].focusEligibility.state, 'INELIGIBLE');
  assert.ok(completeMissing.nodes[0].focusEligibility.reasonCodes.includes('USD_M_PERPETUAL_REQUIRED_NOT_LISTED'));
  assert.ok(completeMissing.nodes[0].focusEligibility.reasonCodes.includes('BORROW_REQUIRED_NOT_LISTED'));

  const unavailableMissing = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [spotRecord]),
    usdMPerpetual: slice('USD_M_PERPETUAL', [], 'UNAVAILABLE'),
    borrow: slice('BORROW', [], 'UNAVAILABLE'),
    coverage: slice('COVERAGE', [coverageRecord]),
  }), policy);
  assert.equal(unavailableMissing.nodes[0].focusEligibility.state, 'UNKNOWN');
  assert.ok(unavailableMissing.nodes[0].focusEligibility.reasonCodes.includes('USD_M_PERPETUAL_REQUIRED_TRUTH_UNAVAILABLE'));
  assert.ok(unavailableMissing.nodes[0].focusEligibility.reasonCodes.includes('BORROW_REQUIRED_TRUTH_UNAVAILABLE'));
});

test('duplicate product aliases collapse deterministically and cross-market alias collisions fail explicitly', () => {
  const first = listing('SPOT', 'BTCUSDT', 'BTC', {
    id: 'spot:btc:older',
    sourceSymbol: 'XBTUSDT',
    aliases: ['BTCUSDT', 'COMMON', 'BTCUSDT'],
    eventMs: T0 - 500,
  });
  const second = listing('SPOT', 'BTCUSDT', 'BTC', {
    id: 'spot:btc:newer',
    aliases: ['BTCUSDT', 'COMMON'],
    eventMs: T0 - 100,
  });
  const eth = listing('SPOT', 'ETHUSDT', 'ETH', { aliases: ['ETHUSDT', 'COMMON'] });
  const coverageRows = [coverage('SPOT', 'BTCUSDT', 'BTC'), coverage('SPOT', 'ETHUSDT', 'ETH')];
  const a = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [first, second, eth]),
    coverage: slice('COVERAGE', coverageRows),
  }));
  const b = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [eth, second, first]),
    coverage: slice('COVERAGE', [...coverageRows].reverse()),
  }));

  assert.deepEqual(a, b);
  assert.equal(a.nodes.length, 2);
  const btc = a.nodes.find((node) => node.baseAsset === 'BTC');
  assert.equal(btc.spot.id, 'spot:btc:newer');
  assert.deepEqual(btc.aliases.filter((alias) => alias === 'BTCUSDT'), ['BTCUSDT']);
  assert.ok(a.failures.some((item) => item.code === 'DUPLICATE_EVENT'));
  assert.ok(a.failures.some((item) => item.code === 'INVALID_VALUE' && item.field === 'aliases.COMMON'));
  assert.equal(a.aliases.some((entry) => entry.alias === 'COMMON'), false);
  assert.equal(findUniverseNode(a, 'COMMON'), null);
});

test('status and delist replacements produce deterministic changed and removed nodes', () => {
  const coverageBefore = [coverage('SPOT', 'BTCUSDT', 'BTC'), coverage('SPOT', 'ETHUSDT', 'ETH')];
  const before = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [listing('SPOT', 'BTCUSDT', 'BTC'), listing('SPOT', 'ETHUSDT', 'ETH')]),
    coverage: slice('COVERAGE', coverageBefore),
  }));
  const after = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [listing('SPOT', 'BTCUSDT', 'BTC', { status: 'HALT', id: 'spot:BTCUSDT:HALT' })]),
    coverage: slice('COVERAGE', [coverageBefore[0]]),
  }));
  const btc = findUniverseNode(after, 'BTCUSDT');
  assert.equal(btc.spot.tradingStatus, 'HALT');
  assert.equal(btc.spot.marketAvailability, 'INACTIVE');
  assert.equal(btc.visibility.state, 'VISIBLE');
  assert.equal(btc.focusEligibility.state, 'INELIGIBLE');
  const diff = diffUniverseGraphs(before, after);
  assert.deepEqual(diff.changes.map((change) => change.kind).sort(), ['CHANGED', 'REMOVED']);
  assert.equal(diffUniverseGraphs(before, after).id, diff.id);
  assert.equal(validateTruthMetadata(diff.truth).ok, true);
  assert.ok(diff.changes.every((change) => validateTruthMetadata(change.truth).ok));
  const update = updateUniverseGraph(before, snapshot({
    spot: slice('SPOT', [listing('SPOT', 'BTCUSDT', 'BTC', { status: 'HALT', id: 'spot:BTCUSDT:HALT' })]),
    coverage: slice('COVERAGE', [coverageBefore[0]]),
  }));
  assert.equal(update.graph.id, after.id);
  assert.deepEqual(update.diff, diff);
});

test('coverage loss blocks promotion without deleting the market', () => {
  const spotRecord = listing('SPOT', 'COVERUSDT', 'COVER');
  const before = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [spotRecord]),
    coverage: slice('COVERAGE', [coverage('SPOT', 'COVERUSDT', 'COVER')]),
  }));
  const after = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [spotRecord]),
    coverage: slice('COVERAGE', [], 'UNAVAILABLE'),
  }));
  assert.equal(after.nodes.length, 1);
  assert.equal(after.nodes[0].publicData.state, 'UNKNOWN');
  assert.equal(after.nodes[0].focusEligibility.state, 'UNKNOWN');
  assert.ok(after.nodes[0].focusEligibility.reasonCodes.includes('PUBLIC_DATA_REQUIRED_TRUTH_UNAVAILABLE'));
  assert.equal(diffUniverseGraphs(before, after).changes[0].kind, 'CHANGED');
});

test('explicit borrow ineligibility is preserved and fails a borrow-required focus policy', () => {
  const graph = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [listing('SPOT', 'NOBORROWUSDT', 'NOBORROW')]),
    borrow: slice('BORROW', [borrow('NOBORROW', { eligibility: 'INELIGIBLE', availability: 'UNAVAILABLE' })]),
    coverage: slice('COVERAGE', [coverage('SPOT', 'NOBORROWUSDT', 'NOBORROW')]),
  }), createUniversePolicy({ requireBorrowEligibilityForFocus: true }));
  const node = graph.nodes[0];
  assert.equal(node.borrow.eligibility, 'INELIGIBLE');
  assert.equal(node.borrow.availability, 'UNAVAILABLE');
  assert.equal(node.focusEligibility.state, 'INELIGIBLE');
  assert.ok(node.focusEligibility.reasonCodes.includes('BORROW_REQUIRED_INELIGIBLE'));
});

test('official USD-M PERPETUAL derives active from contract status when tradingAllowed is absent and rejects non-perpetual contracts', () => {
  const official = listing('USD_M_PERPETUAL', 'BTCUSDT', 'BTC', { tradingAllowed: null });
  const active = buildUniverseGraph(snapshot({
    usdMPerpetual: slice('USD_M_PERPETUAL', [official]),
    coverage: slice('COVERAGE', [coverage('USD_M_PERPETUAL', 'BTCUSDT', 'BTC')]),
  }), createUniversePolicy({ requireSpotForFocus: false, requirePerpetualForFocus: true }));
  assert.equal(active.nodes[0].usdMPerpetual.marketAvailability, 'ACTIVE');
  assert.equal(active.nodes[0].focusEligibility.state, 'ELIGIBLE');

  const wrongContract = structuredClone(official);
  wrongContract.id = 'perp:btc:wrong-contract';
  wrongContract.instrument.contractType = 'CURRENT_QUARTER';
  const rejected = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [listing('SPOT', 'BTCUSDT', 'BTC')]),
    usdMPerpetual: slice('USD_M_PERPETUAL', [wrongContract]),
    coverage: slice('COVERAGE', [coverage('SPOT', 'BTCUSDT', 'BTC')]),
  }), createUniversePolicy({ requirePerpetualForFocus: true }));
  assert.equal(rejected.sourceStates.USD_M_PERPETUAL, 'PARTIAL');
  assert.equal(rejected.nodes[0].usdMPerpetual, null);
  assert.equal(rejected.nodes[0].focusEligibility.state, 'UNKNOWN');
  assert.ok(rejected.failures.some((item) => item.code === 'INVALID_VARIANT' && item.field.includes('instrument.contractType')));
});

test('stale listing, margin, borrow, coverage, and volume facts degrade to unknown rather than hard ineligibility', () => {
  const staleListingTruth = truth('binance-spot', 'exchangeInfo', 'spot:stale', { freshnessState: 'STALE' });
  const staleVolumeTruth = truth('binance-24hr-ticker', 'ticker24hr', 'volume:stale', { freshnessState: 'STALE' });
  const spot = listing('SPOT', 'STALEUSDT', 'STALE', {
    id: 'spot:stale',
    status: 'HALT',
    tradingAllowed: false,
    truth: staleListingTruth,
    quoteVolume24hUsd: 0,
    quoteVolume: quoteVolume('STALEUSDT', 'USDT', 0, { id: 'volume:stale', truth: staleVolumeTruth }),
  });
  const staleMargin = margin('STALEUSDT', 'STALE', {
    marginTradingAllowed: false,
    buyAllowed: false,
    sellAllowed: false,
    truth: truth('binance-margin', 'crossMarginPairs', 'margin:stale', { freshnessState: 'STALE' }),
  });
  const staleBorrow = borrow('STALE', {
    eligibility: 'INELIGIBLE',
    availability: 'UNAVAILABLE',
    truth: truth('binance-margin', 'borrowInventory', 'borrow:stale', { freshnessState: 'STALE' }),
  });
  const staleCoverage = coverage('SPOT', 'STALEUSDT', 'STALE', {
    publicState: 'UNAVAILABLE', focusedState: 'UNAVAILABLE',
    truth: truth('market-data-router', 'coverage', 'coverage:stale', { freshnessState: 'STALE' }),
  });
  const graph = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [spot]),
    margin: slice('MARGIN', [staleMargin]),
    borrow: slice('BORROW', [staleBorrow]),
    coverage: slice('COVERAGE', [staleCoverage]),
  }), createUniversePolicy({
    requireMarginForFocus: true,
    requireBorrowEligibilityForFocus: true,
    requireBorrowAvailabilityForFocus: true,
    requireFocusedDataForFocus: true,
    minimumQuoteVolume24hUsdForFocus: 1,
  }));
  const node = graph.nodes[0];
  assert.equal(node.spot.marketAvailability, 'UNKNOWN');
  assert.equal(node.spot.tradingAllowed, null);
  assert.equal(node.spot.rules.minimumNotional, null);
  assert.equal(node.margin.state, 'UNKNOWN');
  assert.equal(node.margin.marginTradingAllowed, null);
  assert.equal(node.borrow.eligibility, 'UNKNOWN');
  assert.equal(node.borrow.availability, 'UNKNOWN');
  assert.equal(node.publicData.state, 'UNKNOWN');
  assert.equal(node.focusedData.state, 'UNKNOWN');
  assert.equal(node.quoteVolume24hUsd, null);
  assert.equal(node.activity, 'UNKNOWN');
  assert.equal(node.focusEligibility.state, 'UNKNOWN');
  assert.equal(node.focusEligibility.reasonCodes.some((code) => /INACTIVE|INELIGIBLE|BELOW_FOCUS|_STALE$/.test(code)), false);
});

test('dropped invalid rows degrade a declared COMPLETE slice and cannot prove required-listing absence', () => {
  const invalidPerpetual = listing('USD_M_PERPETUAL', 'PARTIALUSDT', 'PARTIAL');
  invalidPerpetual.instrument.contractType = 'CURRENT_QUARTER';
  const graph = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [listing('SPOT', 'PARTIALUSDT', 'PARTIAL')]),
    usdMPerpetual: slice('USD_M_PERPETUAL', [invalidPerpetual]),
    coverage: slice('COVERAGE', [coverage('SPOT', 'PARTIALUSDT', 'PARTIAL')]),
  }), createUniversePolicy({ requirePerpetualForFocus: true }));
  assert.equal(graph.sourceStates.USD_M_PERPETUAL, 'PARTIAL');
  assert.equal(graph.truth.completeness.state, 'PARTIAL');
  assert.equal(graph.nodes[0].focusEligibility.state, 'UNKNOWN');
  assert.ok(graph.nodes[0].focusEligibility.reasonCodes.includes('USD_M_PERPETUAL_REQUIRED_TRUTH_PARTIAL'));
  assert.equal(graph.nodes[0].focusEligibility.reasonCodes.includes('USD_M_PERPETUAL_REQUIRED_NOT_LISTED'), false);
});

test('malformed-row permutations produce identical semantic failures and graph IDs without array positions', () => {
  const wrongFamily = listing('SPOT', 'BADONEUSDT', 'BADONE');
  wrongFamily.id = 'bad:wrong-family';
  wrongFamily.instrument.productFamily = 'MARGIN';
  const badAliases = listing('SPOT', 'BADTWOUSDT', 'BADTWO');
  badAliases.id = 'bad:aliases';
  badAliases.aliases = [''];
  const left = buildUniverseGraph(snapshot({ spot: slice('SPOT', [wrongFamily, badAliases]) }));
  const right = buildUniverseGraph(snapshot({ spot: slice('SPOT', [badAliases, wrongFamily]) }));
  assert.equal(left.id, right.id);
  assert.deepEqual(left.failures.map((item) => item.id), right.failures.map((item) => item.id));
  assert.deepEqual(left.failures.map((item) => item.field), right.failures.map((item) => item.field));
  assert.equal(left.failures.some((item) => /records\[\d+\]/.test(item.field ?? '')), false);
  assert.equal(left.sourceStates.SPOT, 'PARTIAL');
});

test('quote volume requires independent ticker and explicit USD-conversion truth', () => {
  const legacyOnly = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [listing('SPOT', 'LEGACYUSDT', 'LEGACY', { quoteVolume24hUsd: 10_000, quoteVolume: null })]),
  }), createUniversePolicy({ minimumQuoteVolume24hUsdForFocus: 1_000, requirePublicDataForFocus: false }));
  assert.equal(legacyOnly.nodes[0].quoteVolume24hUsd, null);
  assert.equal(legacyOnly.nodes[0].quoteVolume, null);
  assert.equal(legacyOnly.nodes[0].activity, 'UNKNOWN');
  assert.equal(legacyOnly.nodes[0].focusEligibility.state, 'UNKNOWN');
  assert.ok(legacyOnly.failures.some((item) => item.code === 'INCOMPLETE_EVIDENCE'));

  const authoritative = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [listing('SPOT', 'AUTHUSDT', 'AUTH', { quoteVolume24hUsd: 10_000 })]),
  }), createUniversePolicy({ requirePublicDataForFocus: false }));
  assert.equal(authoritative.nodes[0].quoteVolume24hUsd, 10_000);
  assert.equal(authoritative.nodes[0].quoteVolume.truth.authority.dataset, 'ticker24hr');
  assert.equal(authoritative.nodes[0].quoteVolume.conversionTruth.authority.sourceId, 'usd-conversion');

  const staleVolume = quoteVolume('STALEVOLUSDT', 'USDT', 10_000, {
    truth: truth('binance-24hr-ticker', 'ticker24hr', 'volume:stale-only', { freshnessState: 'STALE' }),
  });
  const stale = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [listing('SPOT', 'STALEVOLUSDT', 'STALEVOL', { quoteVolume24hUsd: 10_000, quoteVolume: staleVolume })]),
  }), createUniversePolicy({ minimumQuoteVolume24hUsdForFocus: 1_000, requirePublicDataForFocus: false }));
  assert.equal(stale.nodes[0].quoteVolume24hUsd, null);
  assert.equal(stale.nodes[0].focusEligibility.state, 'UNKNOWN');
  assert.equal(stale.nodes[0].truth.freshness.state, 'STALE');

  const inconsistentVolume = quoteVolume('BROKENVOLUSDT', 'USDT', 10_000);
  inconsistentVolume.quoteVolume24hUsd = 9_999;
  const inconsistent = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [listing('SPOT', 'BROKENVOLUSDT', 'BROKENVOL', { quoteVolume24hUsd: 9_999, quoteVolume: inconsistentVolume })]),
  }));
  assert.equal(inconsistent.nodes.length, 1);
  assert.equal(inconsistent.nodes[0].quoteVolume24hUsd, null);
  assert.equal(inconsistent.sourceStates.SPOT, 'PARTIAL');
  assert.ok(inconsistent.failures.some((item) => item.code === 'INVALID_VALUE' && item.field.includes('quoteVolume24hUsd')));
});

test('updateUniverseGraph preserves the previous policy when policy is omitted', () => {
  const policy = createUniversePolicy({
    configurationVersion: 'strict-volume-policy',
    minimumQuoteVolume24hUsdForFocus: 1_000,
    requirePublicDataForFocus: false,
  });
  const input = snapshot({ spot: slice('SPOT', [listing('SPOT', 'POLICYUSDT', 'POLICY', { quoteVolume24hUsd: 500 })]) });
  const previous = buildUniverseGraph(input, policy);
  const update = updateUniverseGraph(previous, input);
  assert.deepEqual(update.graph.policy, policy);
  assert.equal(update.graph.configurationVersion, 'strict-volume-policy');
  assert.equal(update.graph.nodes[0].focusEligibility.state, 'INELIGIBLE');
  assert.ok(update.graph.nodes[0].focusEligibility.reasonCodes.includes('QUOTE_VOLUME_BELOW_FOCUS_MINIMUM'));
});

test('derived node and graph truth preserve the worst upstream freshness and evaluation metadata', () => {
  const staleCoverageTruth = truth('market-data-router', 'coverage', 'coverage:worst', {
    freshnessState: 'STALE',
    evaluatedAtMs: T0 - 50,
  });
  const graph = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [listing('SPOT', 'WORSTUSDT', 'WORST')]),
    coverage: slice('COVERAGE', [coverage('SPOT', 'WORSTUSDT', 'WORST', { truth: staleCoverageTruth })]),
  }));
  const node = graph.nodes[0];
  assert.equal(node.truth.freshness.state, 'STALE');
  assert.equal(node.truth.freshness.evaluatedAtMs, T0 - 50);
  assert.equal(node.truth.temporal.sourceEventTimeMs, staleCoverageTruth.temporal.sourceEventTimeMs);
  assert.ok(node.truth.provenance.sourceSet.includes('market-data-router'));
  assert.equal(graph.truth.freshness.state, 'STALE');
  assert.equal(graph.truth.freshness.evaluatedAtMs, T0 - 50);
  assert.equal(validateTruthMetadata(node.truth).ok, true);
  assert.equal(validateTruthMetadata(graph.truth).ok, true);
});

test('invalid records and bounded-source overflow return stable failures instead of silent drops', () => {
  const invalid = listing('SPOT', 'BADUSDT', 'BAD');
  invalid.instrument.quoteAsset = null;
  const graph = buildUniverseGraph(snapshot({ spot: slice('SPOT', [invalid]) }));
  assert.equal(graph.nodes.length, 0);
  assert.ok(graph.failures.some((item) => item.code === 'INVALID_VALUE'));

  const overflow = buildUniverseGraph(snapshot({
    spot: slice('SPOT', [listing('SPOT', 'AAAUSDT', 'AAA'), listing('SPOT', 'BBBUSDT', 'BBB')]),
  }), createUniversePolicy({ maxRecordsPerSource: 1 }));
  assert.equal(overflow.nodes.length, 0);
  assert.ok(overflow.failures.some((item) => item.code === 'BUDGET_EXHAUSTED'));
  assert.equal(overflow.sourceStates.SPOT, 'PARTIAL');
});

test('secret-bearing input fails closed without retaining the value', () => {
  const contaminated = snapshot();
  contaminated.spot.auth_token = 'must-never-survive';
  const graph = buildUniverseGraph(contaminated);
  assert.equal(graph.nodes.length, 0);
  assert.equal(graph.failures[0].code, 'SECRET_FIELD_REJECTED');
  assert.doesNotMatch(JSON.stringify(graph), /must-never-survive/);
});

test('universe module import is pure', () => {
  const moduleUrl = new URL('../../../dist/intelligenceFoundation/universe/index.js', import.meta.url).href;
  const script = `
    let timers = 0;
    globalThis.fetch = () => { throw new Error('fetch forbidden'); };
    globalThis.WebSocket = class { constructor() { throw new Error('socket forbidden'); } };
    const originalTimeout = globalThis.setTimeout;
    const originalInterval = globalThis.setInterval;
    globalThis.setTimeout = (...args) => { timers += 1; return originalTimeout(...args); };
    globalThis.setInterval = (...args) => { timers += 1; return originalInterval(...args); };
    await import(${JSON.stringify(moduleUrl)});
    globalThis.setTimeout = originalTimeout;
    globalThis.setInterval = originalInterval;
    if (timers !== 0) throw new Error('import scheduled a timer');
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 2_000 });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});
