import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  stableId,
  validateNormalizedEvidence,
} from '../../../dist/intelligenceFoundation/contracts/index.js';
import {
  BINANCE_SOURCE_FACTS,
  normalizeBookTicker,
  normalizeContext,
  normalizeDepth,
  normalizeTrade,
} from '../../../dist/intelligenceFoundation/evidence/index.js';
import {
  buildUniverseGraph,
  createUniversePolicy,
} from '../../../dist/intelligenceFoundation/universe/index.js';
import { MarketFeatureBank } from '../../../dist/intelligenceFoundation/features/index.js';
import {
  attentionConfig,
  planAttentionFromPorts,
} from '../../../dist/intelligenceFoundation/attention/index.js';
import {
  buildThesisPacket,
  thesisRules,
} from '../../../dist/intelligenceFoundation/thesis/index.js';
import { analyzeFalsePositiveForensics } from '../../../dist/intelligenceFoundation/forensics/index.js';
import {
  EMPTY_OUTCOME_STATE,
  attributeOutcome,
  freezePreEvent,
  reduceOutcomeState,
  summarizeOutcomeCohorts,
} from '../../../dist/intelligenceFoundation/outcomes/index.js';
import {
  CONFIGURATION_VERSION,
  FEATURE_VERSION,
  SCENARIO_TIME,
  candidate,
  feature,
  instrument,
  normalizedBook,
  normalizedDepth,
  normalizedLiquidation,
  normalizedTrade,
  thesisFeatureSet,
  truth,
} from '../fixtures/market-intelligence.mjs';
import { adaptEvidenceForExistingEngines } from '../fixtures/engine-compatibility.mjs';

const SYMBOL = 'DORMUSDT';
const ZERO_DWELL = {
  UNIVERSE: 0,
  WATCH: 0,
  CANDIDATE: 0,
  FOCUS: 0,
  DEEP_FOCUS: 0,
  RELEASED: 0,
};

function ok(result) {
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.failure ?? result.failures));
  return result.value;
}

function normalizationContext(sourceKey, eventTimeMs, options = {}) {
  const fact = BINANCE_SOURCE_FACTS[sourceKey];
  const productFamily = fact.productFamily === 'ANY' ? 'SPOT' : fact.productFamily;
  const identity = instrument(options.symbol ?? SYMBOL, productFamily);
  return {
    sourceKey,
    sourceId: fact.sourceId,
    endpointClass: fact.endpointClass,
    instrument: {
      productFamily: identity.productFamily,
      symbol: identity.symbol,
      pair: identity.pair,
      baseAsset: identity.baseAsset,
      quoteAsset: identity.quoteAsset,
      contractType: identity.contractType,
    },
    receivedTimeMs: options.receivedTimeMs ?? eventTimeMs + 2,
    evaluatedAtMs: options.evaluatedAtMs ?? SCENARIO_TIME,
    maxAgeMs: options.maxAgeMs ?? 60 * 60_000,
    previousSequence: options.previousSequence ?? null,
  };
}

function normalizedSpotTrade(eventTimeMs, sequence, price, quoteQuantity, aggressorSide = 'BUY', options = {}) {
  const baseQuantity = quoteQuantity / price;
  return ok(normalizeTrade({
    e: 'aggTrade',
    E: eventTimeMs,
    s: SYMBOL,
    a: String(sequence),
    p: String(price),
    q: String(baseQuantity),
    f: String(sequence),
    l: String(sequence),
    T: eventTimeMs + 1,
    m: aggressorSide === 'SELL',
  }, normalizationContext('SPOT_AGG_TRADE', eventTimeMs, options)));
}

function slice(source, records, eventTimeMs = SCENARIO_TIME - 100) {
  const id = `slice:${source}`;
  return {
    source,
    state: 'COMPLETE',
    records,
    truth: truth(eventTimeMs, id, {
      evaluatedAtMs: SCENARIO_TIME,
      sourceId: `integration-${source.toLowerCase()}`,
      dataset: `${source.toLowerCase()}-snapshot`,
    }),
  };
}

function listing(productFamily, quoteVolume = 0, suppliedIdentity = null) {
  const identity = suppliedIdentity ?? instrument(SYMBOL, productFamily);
  const listingId = `listing:${productFamily}:${SYMBOL}`;
  const tickerId = `ticker:${productFamily}:${SYMBOL}`;
  const listingTruth = truth(SCENARIO_TIME - 100, listingId, {
    sourceId: productFamily === 'SPOT' ? 'binance-spot-fixture' : 'binance-usdm-fixture',
    dataset: 'exchangeInfo',
  });
  const tickerTruth = truth(SCENARIO_TIME - 50, tickerId, {
    sourceId: productFamily === 'SPOT' ? 'binance-spot-fixture' : 'binance-usdm-fixture',
    dataset: 'ticker24h',
  });
  const conversionTruth = truth(SCENARIO_TIME - 50, `${tickerId}:usd`, {
    sourceId: 'integration-usdt-usd-conversion',
    dataset: 'quote-conversion',
  });
  return {
    id: listingId,
    kind: productFamily === 'SPOT' ? 'SPOT_LISTING' : 'USD_M_PERPETUAL_LISTING',
    instrument: identity,
    tradingStatus: 'TRADING',
    tradingAllowed: null,
    aliases: [SYMBOL],
    rules: {
      minimumPrice: 0.0001,
      maximumPrice: null,
      tickSize: 0.0001,
      minimumQuantity: 0.001,
      maximumQuantity: null,
      quantityStep: 0.001,
      minimumNotional: 5,
      maximumNotional: null,
    },
    quoteVolume: {
      id: tickerId,
      quoteAsset: 'USDT',
      quoteVolume24h: quoteVolume,
      usdConversionRate: 1,
      quoteVolume24hUsd: quoteVolume,
      truth: tickerTruth,
      conversionTruth,
    },
    quoteVolume24hUsd: quoteVolume,
    truth: listingTruth,
  };
}

function coverage(productFamily, suppliedIdentity = null) {
  const id = `coverage:${productFamily}:${SYMBOL}`;
  return {
    id,
    instrument: suppliedIdentity ?? instrument(SYMBOL, productFamily),
    publicData: { state: 'AVAILABLE', evidenceKinds: ['TRADE', 'BOOK_TICKER'], reasonCodes: [] },
    focusedData: { state: 'AVAILABLE', evidenceKinds: ['DEPTH_SNAPSHOT', 'OPEN_INTEREST'], reasonCodes: [] },
    truth: truth(SCENARIO_TIME - 20, id, { sourceId: 'integration-coverage-router', dataset: 'coverage' }),
  };
}

function universe(identities = {}) {
  const graph = buildUniverseGraph({
    observedAtMs: SCENARIO_TIME,
    spot: slice('SPOT', [listing('SPOT', 0, identities.spot)]),
    usdMPerpetual: slice('USD_M_PERPETUAL', [listing('USD_M_PERPETUAL', 0, identities.perpetual)]),
    margin: slice('MARGIN', []),
    borrow: slice('BORROW', []),
    coverage: slice('COVERAGE', [coverage('SPOT', identities.spot), coverage('USD_M_PERPETUAL', identities.perpetual)]),
  }, createUniversePolicy({
    requirePerpetualForFocus: true,
    requirePublicDataForFocus: true,
    requireFocusedDataForFocus: true,
  }));
  assert.equal(graph.failures.length, 0, JSON.stringify(graph.failures));
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].visibility.state, 'VISIBLE');
  assert.equal(graph.nodes[0].activity, 'DORMANT');
  assert.equal(graph.nodes[0].focusEligibility.state, 'ELIGIBLE');
  return graph;
}

function candidateHint(instrumentId, atMs, sequence) {
  const id = `volume-hint:${sequence}`;
  return {
    id,
    strategy: 'volume_spike',
    instrumentId,
    symbol: SYMBOL,
    sourceState: 'FOCUS',
    engineObservedAtMs: atMs,
    priority: 0.95,
    reasonCodes: ['PERSISTENT_SPOT_ACTIVITY'],
    protected: false,
    upstreamCorrelationId: null,
    truth: truth(atMs, id, {
      evaluatedAtMs: atMs,
      maxAgeMs: 60_000,
      authorityKind: 'ENGINE_DERIVED',
      sourceId: 'existing-volume-engine-fixture',
      dataset: 'candidate-hints',
    }),
  };
}

function planFocus(node) {
  const config = attentionConfig({
    configurationVersion: 'integration-attention-v1',
    minTierDwellMs: ZERO_DWELL,
    signalHoldMs: 60_000,
    promotionCooldownMs: 0,
    hintStaleAfterMs: 60_000,
  });
  const attentionInstrument = {
    instrumentId: node.spot.instrument.instrumentId,
    symbol: SYMBOL,
    protectedCapital: false,
    releaseRequested: false,
    releaseReasonCodes: [],
    focusEligibility: node.focusEligibility,
    sourceQuality: { state: 'HEALTHY', reasonCodes: [] },
    truth: truth(SCENARIO_TIME, node.id, {
      evaluatedAtMs: SCENARIO_TIME,
      maxAgeMs: 60_000,
      authorityKind: 'ENGINE_DERIVED',
      sourceId: 'universe-attention-projection',
      dataset: 'focus-eligibility-and-coverage',
    }),
  };
  let previousAllocations;
  let plan;
  for (let step = 0; step < 4; step += 1) {
    const atMs = SCENARIO_TIME + step;
    const port = {
      portId: 'existing-volume-engine',
      readCandidateHints: () => [candidateHint(attentionInstrument.instrumentId, atMs, step)],
    };
    plan = ok(planAttentionFromPorts({ atMs, instruments: [attentionInstrument], previousAllocations }, [port], config));
    previousAllocations = plan.allocations;
  }
  assert.equal(plan.allocations[0].tier, 'DEEP_FOCUS');
  assert.ok(plan.allocations[0].requestedEvidence.includes('LIQUIDATION'));
  assert.equal(plan.candidates.length, 1);
  return plan;
}

function baseline(instrumentId, options = {}) {
  const id = stableId('integration-baseline', { instrumentId, suffix: options.suffix ?? '' });
  return {
    id,
    instrumentId,
    state: options.state ?? 'READY',
    sampleCount: options.sampleCount ?? 12,
    capacity: 64,
    sessionBucket: 'UTC_20',
    normalActivity: [],
    deadActivity: [],
    truth: truth(options.eventTimeMs ?? SCENARIO_TIME - 1_000, id, {
      evaluatedAtMs: SCENARIO_TIME,
      maxAgeMs: options.maxAgeMs ?? 60_000,
      authorityKind: 'EXCHANGE_DERIVED',
      sourceId: 'integration-baseline',
      dataset: 'activity-baseline',
    }),
  };
}

function packet(options = {}) {
  const identity = instrument(options.symbol ?? SYMBOL, 'SPOT');
  const inputCandidate = options.candidate ?? candidate(identity.instrumentId, options.candidateOpenedAtMs ?? SCENARIO_TIME - 1_000);
  const features = options.features ?? thesisFeatureSet({ instrumentId: identity.instrumentId, ...(options.featureOverrides ?? {}) });
  const evidence = options.evidence ?? [
    normalizedDepth({ symbol: identity.symbol, eventTimeMs: SCENARIO_TIME - 20_000, sequence: 1, mid: 100, quantity: 100 }),
    normalizedDepth({ symbol: identity.symbol, eventTimeMs: SCENARIO_TIME - 1_000, sequence: 2, mid: 100.1, quantity: 95 }),
  ];
  return ok(buildThesisPacket({
    candidate: inputCandidate,
    baseline: options.baseline === undefined ? baseline(identity.instrumentId) : options.baseline,
    features,
    evidence,
    analogueIds: options.analogueIds ?? [],
    evaluatedAtMs: options.evaluatedAtMs ?? SCENARIO_TIME,
    intendedQuoteNotional: options.intendedQuoteNotional ?? 1_000,
    requiredEvidenceKinds: options.requiredEvidenceKinds ?? ['DEPTH_SNAPSHOT'],
  }, thesisRules(options.ruleOverrides ?? {})));
}

function forensicFeatures(instrumentId, overrides = {}) {
  const values = {
    relative_quote_volume: overrides.relativeQuoteVolume ?? 3,
    spot_price_change_pct: overrides.spotPriceChangePct ?? 0.1,
    spot_quote_volume: overrides.spotQuoteVolume ?? 50_000,
    market_spot_return_pct: overrides.marketSpotReturnPct ?? 0.02,
    symbol_specific_return_pct: overrides.symbolSpecificReturnPct ?? 0.08,
    long_liquidation_quote: overrides.longLiquidationQuote ?? 0,
    short_liquidation_quote: overrides.shortLiquidationQuote ?? 0,
  };
  return Object.entries(values).map(([name, value]) => feature(name, value, 60_000, SCENARIO_TIME - 500, {
    instrumentId,
    unit: name.includes('volume') || name.includes('liquidation') ? 'quote_asset' : name.includes('pct') ? 'percent' : 'multiple',
  }));
}

function tradeTape({ count = 10, flat = false, onePrint = false, symbol = SYMBOL } = {}) {
  return Array.from({ length: count }, (_, index) => normalizedTrade({
    symbol,
    eventTimeMs: SCENARIO_TIME - 27_000 + index * 2_500,
    sequence: 10_000 + index,
    price: flat ? 100 : 100 + index * 0.01,
    quoteQuantity: onePrint ? 100_000 : 1_000 + index * (flat ? 0 : 137),
    aggressorSide: index % 2 === 0 ? 'BUY' : 'SELL',
  }));
}

function forensicsReport(options = {}) {
  const identity = instrument(options.symbol ?? SYMBOL, 'SPOT');
  const evidence = options.evidence ?? [
    ...tradeTape({ symbol: identity.symbol }),
    normalizedDepth({ symbol: identity.symbol, eventTimeMs: SCENARIO_TIME - 20_000, sequence: 101, mid: 100, quantity: 100 }),
    normalizedDepth({ symbol: identity.symbol, eventTimeMs: SCENARIO_TIME - 1_000, sequence: 102, mid: 100.1, quantity: 95 }),
    normalizedLiquidation({ symbol: identity.symbol, eventTimeMs: SCENARIO_TIME - 2_000, quoteNotional: 500 }),
  ];
  return ok(analyzeFalsePositiveForensics({
    symbol: identity.symbol,
    instrumentId: identity.instrumentId,
    evaluatedAtMs: SCENARIO_TIME,
    candidateObservedAtMs: SCENARIO_TIME - 20_000,
    intendedQuoteNotional: options.intendedQuoteNotional ?? 1_000,
    configurationVersion: CONFIGURATION_VERSION,
    featureVersion: FEATURE_VERSION,
    evidence,
    features: options.features ?? forensicFeatures(identity.instrumentId, options.featureOverrides),
    history: options.history ?? [],
  }));
}

function forensicCheck(report, name) {
  const found = report.checks.find((entry) => entry.check === name);
  assert.ok(found, `${name} missing`);
  return found;
}

test('1 dormant persistent Spot-led activity traverses the complete evidence-only funnel', () => {
  const baselineTrades = Array.from({ length: 6 }, (_, index) => normalizedSpotTrade(
    SCENARIO_TIME - (10 - index) * 60_000 + 5_000,
    1_000 + index,
    100,
    100,
    index % 2 === 0 ? 'BUY' : 'SELL',
  ));
  const burstTrades = Array.from({ length: 12 }, (_, index) => normalizedSpotTrade(
    SCENARIO_TIME - 25_000 + index * 2_000,
    2_000 + index,
    100 + index * 0.01,
    1_000 + index * 50,
    index % 3 === 0 ? 'SELL' : 'BUY',
  ));
  const coverageStartMs = Math.floor((SCENARIO_TIME - 10 * 60_000 + 5_000) / 60_000) * 60_000;
  const coverageEndMs = Math.floor(SCENARIO_TIME / 60_000) * 60_000;
  const continuousCoverage = ok(normalizeContext({
    recordId: 'coverage:dormusdt:baseline',
    contextType: 'CONTINUOUS_TRADE_COVERAGE',
    scope: 'SYMBOL',
    values: { productFamily: 'SPOT', startTimeMs: coverageStartMs, endTimeMs: coverageEndMs, complete: true },
    sourceEventTimeMs: SCENARIO_TIME - 1,
  }, normalizationContext('CONTEXT_INJECTED', SCENARIO_TIME - 1, { receivedTimeMs: SCENARIO_TIME })));
  const earlyDepth = ok(normalizeDepth({
    lastUpdateId: '3000',
    bids: [['99.99', '100'], ['99.98', '100']],
    asks: [['100.01', '100'], ['100.02', '100']],
    requestedLimit: 100,
  }, normalizationContext('SPOT_DEPTH_SNAPSHOT', SCENARIO_TIME - 20_000, { receivedTimeMs: SCENARIO_TIME - 20_000 })));
  const currentDepth = ok(normalizeDepth({
    lastUpdateId: '3001',
    bids: [['100.08', '95'], ['100.07', '95']],
    asks: [['100.10', '95'], ['100.11', '95']],
    requestedLimit: 100,
  }, normalizationContext('SPOT_DEPTH_SNAPSHOT', SCENARIO_TIME - 500, { receivedTimeMs: SCENARIO_TIME - 500 })));
  const spotBook = ok(normalizeBookTicker({
    u: '4000', s: SYMBOL, b: '100.08', B: '95', a: '100.10', A: '95',
  }, normalizationContext('SPOT_BOOK_TICKER', SCENARIO_TIME - 400, { receivedTimeMs: SCENARIO_TIME - 400 })));
  const perpetualBook = ok(normalizeBookTicker({
    e: 'bookTicker', E: SCENARIO_TIME - 300, T: SCENARIO_TIME - 301,
    s: SYMBOL, ps: SYMBOL, st: 1, u: '5000', b: '100.04', B: '80', a: '100.06', A: '80',
  }, normalizationContext('USD_M_BOOK_TICKER', SCENARIO_TIME - 300)));
  const evidence = [...baselineTrades, ...burstTrades, continuousCoverage, earlyDepth, currentDepth, spotBook, perpetualBook];
  assert.ok(evidence.every((entry) => validateNormalizedEvidence(entry).ok));
  const graph = universe({ spot: burstTrades[0].instrument, perpetual: perpetualBook.instrument });
  const spot = graph.nodes[0].spot.instrument;

  const bank = new MarketFeatureBank({ now: () => SCENARIO_TIME }, {
    baselineMinSamples: 4,
    baselineCapacity: 64,
    minimumMarketSymbols: 1,
    largeTradeQuoteThreshold: 500,
  });
  const ingest = bank.ingest(evidence);
  assert.equal(ingest.rejected, 0, JSON.stringify(ingest.failures));
  const snapshot = bank.snapshot(SYMBOL);
  assert.equal(snapshot.baseline.state, 'READY');
  assert.ok(snapshot.features.find((entry) => entry.feature === 'relative_quote_volume' && entry.windowMs === 60_000)?.value > 1);

  const attention = planFocus(graph.nodes[0]);
  const focusedCandidate = attention.candidates[0];
  const enriched = thesisFeatureSet({
    instrumentId: spot.instrumentId,
    spotRelativeVolume: [3.4, 3.2, 3],
    perpetualRelativeVolume: [2.2, 2.1, 2],
    spotEndTimeMs: SCENARIO_TIME - 1_500,
    perpetualEndTimeMs: SCENARIO_TIME - 500,
    symbolReturnPct: [0.08, 0.15, 0.2],
    spotReturnPct: [0.08, 0.15, 0.2],
    perpetualReturnPct: [0.01, 0.02, 0.03],
    absorptionRatio: 0.8,
    replenishmentRatio: 0.8,
    deadBaselineFlag: true,
  });
  const thesis = ok(buildThesisPacket({
    candidate: focusedCandidate,
    baseline: snapshot.baseline,
    features: [...snapshot.features, ...enriched],
    evidence,
    analogueIds: [],
    evaluatedAtMs: SCENARIO_TIME + 3,
    intendedQuoteNotional: 1_000,
    requiredEvidenceKinds: ['DEPTH_SNAPSHOT'],
  }, thesisRules()));
  assert.equal(thesis.leadMarket, 'SPOT');
  assert.equal(thesis.stage, 'BEFORE_VISIBLE_MOVE');
  assert.equal(thesis.hypothesis, 'SPOT_LED_EXPANSION');

  const forensics = ok(analyzeFalsePositiveForensics({
    symbol: SYMBOL,
    instrumentId: spot.instrumentId,
    evaluatedAtMs: SCENARIO_TIME + 3,
    candidateObservedAtMs: focusedCandidate.openedAtMs,
    intendedQuoteNotional: 1_000,
    configurationVersion: CONFIGURATION_VERSION,
    featureVersion: FEATURE_VERSION,
    evidence,
    features: [...snapshot.features, ...forensicFeatures(spot.instrumentId)],
    history: [],
  }));
  assert.equal(forensicCheck(forensics, 'ONE_PRINT_OR_CONCENTRATED_SPIKE').verdict, 'PASS');
  const frozenEvidenceIds = new Set(evidence.map((entry) => entry.id));
  for (const check of forensics.checks) {
    const missing = check.evidenceIds.filter((id) => !frozenEvidenceIds.has(id));
    assert.deepEqual(missing, [], `${check.check} references evidence outside the frozen packet`);
  }

  const frozen = ok(freezePreEvent({
    triggerTimeMs: SCENARIO_TIME + 3,
    candidateDisposition: 'ACCEPTED',
    thesis,
    forensics: forensics.checks,
    evidence,
    features: [...snapshot.features, ...enriched],
    configurationVersion: CONFIGURATION_VERSION,
    featureVersion: FEATURE_VERSION,
    producerVersion: 'integration-freeze-v1',
  }));
  const reference = burstTrades[burstTrades.length - 1];
  const later = normalizedSpotTrade(
    SCENARIO_TIME + 3_003,
    9_001,
    101,
    2_000,
    'BUY',
    { evaluatedAtMs: SCENARIO_TIME + 3_103, receivedTimeMs: SCENARIO_TIME + 3_005 },
  );
  const outcome = ok(attributeOutcome({
    frozen,
    evaluatedAtMs: SCENARIO_TIME + 3_103,
    policy: {
      horizonMs: 3_000,
      direction: 'UP',
      movedThresholdPct: 0.5,
      terminalMaxAgeMs: 500,
      requiredMetricFields: ['forwardReturnPct', 'laterMoved'],
      referenceEvidenceId: reference.id,
      priceBasis: 'TRADE',
    },
    laterEvidence: [later],
  }));
  assert.equal(outcome.state, 'COMPLETE');
  assert.equal(outcome.laterMoved, true);

  const adapter = adaptEvidenceForExistingEngines({ symbol: SYMBOL, evidence, thesis, forensics });
  assert.equal(adapter.authority, 'EVIDENCE_ONLY');
  assert.ok(adapter.volumeSpikeInput.trades.length >= 12);
  assert.equal(adapter.volumeSpikeInput.spotBook.symbol, SYMBOL);
  assert.equal(adapter.basisInput.perpetualBook.symbol, SYMBOL);
  assert.equal(adapter.createsProposal, false);
  assert.equal(adapter.createsIntent, false);
  assert.equal(adapter.executesAction, false);
  assert.equal(Object.isFrozen(adapter), true);
});

test('2 a one-print fake spike is blocked by named forensics', () => {
  const identity = instrument();
  const report = forensicsReport({
    evidence: [normalizedTrade({
      eventTimeMs: SCENARIO_TIME - 1_000,
      sequence: 1,
      price: 100,
      quoteQuantity: 100_000,
      aggressorSide: 'BUY',
    })],
    features: forensicFeatures(identity.instrumentId, { relativeQuoteVolume: 10, spotPriceChangePct: 0.01 }),
  });
  assert.equal(forensicCheck(report, 'ONE_PRINT_OR_CONCENTRATED_SPIKE').verdict, 'FAIL');
  assert.equal(report.tradeability.claimAllowed, false);
});

test('3 wash-like churn without price response is rejected without fabricated probability', () => {
  const report = forensicsReport({
    evidence: [
      ...tradeTape({ flat: true }),
      normalizedDepth({ eventTimeMs: SCENARIO_TIME - 20_000, sequence: 1, mid: 100, quantity: 100 }),
      normalizedDepth({ eventTimeMs: SCENARIO_TIME - 1_000, sequence: 2, mid: 100, quantity: 100 }),
    ],
    featureOverrides: { relativeQuoteVolume: 6, spotPriceChangePct: 0.01 },
  });
  assert.equal(forensicCheck(report, 'WASH_LIKE_PING_PONG_CHURN').verdict, 'FAIL');
  assert.equal(forensicCheck(report, 'VOLUME_WITHOUT_PRICE_RESPONSE').verdict, 'FAIL');
  assert.equal(JSON.stringify(report).includes('probability'), false);
});

test('4 Spot leads while Perpetual lags', () => {
  const thesis = packet({
    featureOverrides: {
      spotRelativeVolume: [3, 3, 2.8],
      perpetualRelativeVolume: [2.3, 2.2, 2.1],
      spotEndTimeMs: SCENARIO_TIME - 2_000,
      perpetualEndTimeMs: SCENARIO_TIME - 500,
      symbolReturnPct: [0.2, 0.5, 0.7],
      spotReturnPct: [0.2, 0.5, 0.7],
      perpetualReturnPct: [0.05, 0.1, 0.15],
    },
  });
  assert.equal(thesis.leadMarket, 'SPOT');
  assert.equal(thesis.hypothesis, 'SPOT_LED_EXPANSION');
});

test('5 OI and sampled liquidation evidence names a Futures-driven move', () => {
  const thesis = packet({
    featureOverrides: {
      spotRelativeVolume: [2.2, 2.1, 2],
      perpetualRelativeVolume: [4, 3.8, 3.5],
      spotEndTimeMs: SCENARIO_TIME - 500,
      perpetualEndTimeMs: SCENARIO_TIME - 2_000,
      symbolReturnPct: [0.2, 0.5, 0.7],
      spotReturnPct: [0.05, 0.1, 0.15],
      perpetualReturnPct: [0.2, 0.5, 0.7],
      openInterestChangePct: -1,
      liquidationFlowShare: 0.4,
      fundingRateChange: 0.001,
    },
    evidence: [
      normalizedDepth({ eventTimeMs: SCENARIO_TIME - 1_000, sequence: 1, mid: 100, quantity: 100 }),
      normalizedLiquidation({ eventTimeMs: SCENARIO_TIME - 500, quoteNotional: 100_000 }),
    ],
  });
  assert.equal(thesis.leadMarket, 'PERPETUAL');
  assert.equal(thesis.hypothesis, 'LIQUIDATION_DRIVEN_MOVE');
  const liquidation = thesis.neutral.concat(thesis.supporting, thesis.conflicting).find((entry) => entry.fact.includes('liquidation'));
  assert.ok(liquidation || thesis.reasonCodes.some((reason) => reason.includes('LIQUIDATION')));
});

test('6 disappearing depth before intended size blocks tradeability', () => {
  const report = forensicsReport({
    evidence: [
      ...tradeTape(),
      normalizedDepth({ eventTimeMs: SCENARIO_TIME - 20_000, sequence: 1, mid: 100, quantity: 1_000 }),
      normalizedDepth({ eventTimeMs: SCENARIO_TIME - 1_000, sequence: 2, mid: 101, quantity: 2 }),
    ],
    intendedQuoteNotional: 10_000,
    featureOverrides: { spotPriceChangePct: 1 },
  });
  assert.equal(forensicCheck(report, 'PRICE_JUMP_ON_THIN_OR_DISAPPEARING_DEPTH').verdict, 'FAIL');
  assert.equal(report.tradeability.state, 'BLOCKED');
});

test('7 market-wide movement stays distinct from symbol-specific anomaly', () => {
  const marketWide = packet({ featureOverrides: {
    symbolReturnPct: [0.2, 0.5, 0.7],
    marketParticipationRatio: 0.85,
    symbolMarketResidualReturnPct: 0.05,
  } });
  const specific = packet({ featureOverrides: {
    symbolReturnPct: [0.2, 0.5, 0.7],
    marketParticipationRatio: 0.1,
    symbolMarketResidualReturnPct: 0.6,
    spotRelativeVolume: [3, 3, 2.8],
    perpetualRelativeVolume: [2.3, 2.2, 2.1],
    spotEndTimeMs: SCENARIO_TIME - 2_000,
    perpetualEndTimeMs: SCENARIO_TIME - 500,
  } });
  assert.equal(marketWide.hypothesis, 'MARKET_WIDE_BETA_MOVE');
  assert.notEqual(specific.hypothesis, 'MARKET_WIDE_BETA_MOVE');
});

test('8 stale Futures features remain unavailable and cannot claim a lead', () => {
  const identity = instrument();
  const fresh = thesisFeatureSet({ instrumentId: identity.instrumentId });
  const features = fresh.map((entry) => entry.feature.startsWith('perpetual_')
    ? feature(entry.feature, entry.value, entry.windowMs, SCENARIO_TIME - 100_000, {
      instrumentId: identity.instrumentId,
      maxAgeMs: 1_000,
      freshnessState: 'STALE',
      suffix: 'stale-futures',
    })
    : entry);
  const thesis = packet({ features });
  assert.notEqual(thesis.leadMarket, 'PERPETUAL');
  assert.ok(thesis.unavailable.some((entry) => entry.reasonCode.includes('UNAVAILABLE') || entry.reasonCode.includes('STALE')));
  assert.notEqual(thesis.tradeability.state, 'SUPPORTED');
});

test('9 missing borrow evidence remains explicitly unavailable', () => {
  const thesis = packet({ requiredEvidenceKinds: ['DEPTH_SNAPSHOT', 'BORROW'] });
  assert.ok(thesis.tradeability.missingEvidenceKinds.includes('BORROW'));
  assert.notEqual(thesis.tradeability.state, 'SUPPORTED');
  assert.ok(thesis.unavailable.some((entry) => entry.evidenceIds.length === 0));
});

test('10 sequence gaps and out-of-order events have distinct deterministic outcomes', () => {
  const gap = normalizeDepth({
    e: 'depthUpdate', E: SCENARIO_TIME - 10, s: SYMBOL,
    U: '12', u: '13', b: [['100', '1']], a: [['101', '1']],
  }, normalizationContext('SPOT_DEPTH_DELTA', SCENARIO_TIME - 10, { previousSequence: { last: '10' } }));
  assert.equal(gap.ok, true);
  assert.equal(gap.value.truth.completeness.state, 'PARTIAL');
  assert.ok(gap.qualityFailures.some((failure) => failure.code === 'SEQUENCE_GAP'));

  const outOfOrder = normalizeDepth({
    e: 'depthUpdate', E: SCENARIO_TIME - 10, s: SYMBOL,
    U: '8', u: '9', b: [['100', '1']], a: [['101', '1']],
  }, normalizationContext('SPOT_DEPTH_DELTA', SCENARIO_TIME - 10, { previousSequence: { last: '10' } }));
  assert.equal(outOfOrder.ok, false);
  assert.ok(outOfOrder.failures.some((failure) => failure.code === 'OUT_OF_ORDER_EVENT'));
});

test('11 a candidate opened after an old visible move is classified TOO_LATE', () => {
  const identity = instrument();
  const oldEnd = SCENARIO_TIME - 200_000;
  const thesis = packet({
    candidate: candidate(identity.instrumentId, SCENARIO_TIME - 1_000, { maxAgeMs: 300_000 }),
    features: thesisFeatureSet({
      instrumentId: identity.instrumentId,
      endTimeMs: oldEnd,
      spotEndTimeMs: oldEnd - 1_000,
      perpetualEndTimeMs: oldEnd,
      maxAgeMs: 300_000,
      spotRelativeVolume: [3, 3, 2.8],
      perpetualRelativeVolume: [2.5, 2.4, 2.3],
      symbolReturnPct: [0.2, 0.6, 0.8],
      spotReturnPct: [0.2, 0.6, 0.8],
      perpetualReturnPct: [0.1, 0.4, 0.6],
    }),
    ruleOverrides: { maxFreshAgeMs: 300_000 },
  });
  assert.equal(thesis.stage, 'TOO_LATE');
  assert.equal(thesis.tradeability.state, 'BLOCKED');
});

test('12 accepted and rejected records receive no-look-ahead outcome attribution', () => {
  const packetEvidence = [
    normalizedDepth({ eventTimeMs: SCENARIO_TIME - 20_000, sequence: 80_001, mid: 100, quantity: 100 }),
    normalizedDepth({ eventTimeMs: SCENARIO_TIME - 1_000, sequence: 80_002, mid: 100.1, quantity: 95 }),
  ];
  const packetFeatures = thesisFeatureSet({ instrumentId: instrument().instrumentId,
    spotRelativeVolume: [3, 3, 2.8],
    perpetualRelativeVolume: [2.3, 2.2, 2.1],
    spotEndTimeMs: SCENARIO_TIME - 2_000,
    perpetualEndTimeMs: SCENARIO_TIME - 500,
  });
  const thesis = packet({ features: packetFeatures, evidence: packetEvidence });
  const reference = normalizedTrade({
    eventTimeMs: SCENARIO_TIME - 100,
    sequence: 70_000,
    price: 100,
    quoteQuantity: 1_000,
    aggressorSide: 'BUY',
  });
  const freeze = (candidateDisposition) => ok(freezePreEvent({
    triggerTimeMs: SCENARIO_TIME,
    candidateDisposition,
    thesis,
    forensics: [],
    evidence: [reference, ...packetEvidence],
    features: packetFeatures,
    configurationVersion: CONFIGURATION_VERSION,
    featureVersion: FEATURE_VERSION,
    producerVersion: 'integration-freeze-v1',
  }));
  const accepted = freeze('ACCEPTED');
  const rejected = freeze('REJECTED');

  const futureAtFreeze = freezePreEvent({
    triggerTimeMs: SCENARIO_TIME,
    candidateDisposition: 'OBSERVED',
    thesis,
    forensics: [],
    evidence: [...packetEvidence, normalizedTrade({ eventTimeMs: SCENARIO_TIME + 1, sequence: 70_001, price: 101, quoteQuantity: 1_000 })],
    features: packetFeatures,
    configurationVersion: CONFIGURATION_VERSION,
    featureVersion: FEATURE_VERSION,
    producerVersion: 'integration-freeze-v1',
  });
  assert.equal(futureAtFreeze.ok, false);
  assert.equal(futureAtFreeze.failure.code, 'NO_LOOK_AHEAD_VIOLATION');

  const later = normalizedTrade({
    eventTimeMs: SCENARIO_TIME + 3_000,
    sequence: 70_002,
    price: 102,
    quoteQuantity: 2_000,
    aggressorSide: 'BUY',
  });
  const policy = {
    horizonMs: 3_000,
    direction: 'UP',
    movedThresholdPct: 1,
    terminalMaxAgeMs: 500,
    requiredMetricFields: ['forwardReturnPct', 'laterMoved'],
    referenceEvidenceId: reference.id,
    priceBasis: 'TRADE',
  };
  const acceptedLabel = ok(attributeOutcome({ frozen: accepted, evaluatedAtMs: SCENARIO_TIME + 3_100, policy, laterEvidence: [later] }));
  const rejectedLabel = ok(attributeOutcome({ frozen: rejected, evaluatedAtMs: SCENARIO_TIME + 3_100, policy, laterEvidence: [later] }));
  assert.equal(acceptedLabel.laterMoved, true);
  assert.equal(rejectedLabel.laterMoved, true);

  let state = EMPTY_OUTCOME_STATE;
  for (const event of [
    { type: 'FROZEN_RECORD_ADDED', record: accepted },
    { type: 'FROZEN_RECORD_ADDED', record: rejected },
    { type: 'OUTCOME_LABEL_ADDED', label: acceptedLabel },
    { type: 'OUTCOME_LABEL_ADDED', label: rejectedLabel },
  ]) {
    state = ok(reduceOutcomeState(state, event));
  }
  const cohorts = ok(summarizeOutcomeCohorts(state));
  assert.equal(cohorts.length, 1);
  assert.deepEqual(cohorts[0].accepted, { total: 1, moved: 1, didNotMove: 0, unknown: 0 });
  assert.deepEqual(cohorts[0].rejected, { total: 1, moved: 1, didNotMove: 0, unknown: 0 });
  assert.equal(Object.hasOwn(cohorts[0], 'recommendedThreshold'), false);
});
