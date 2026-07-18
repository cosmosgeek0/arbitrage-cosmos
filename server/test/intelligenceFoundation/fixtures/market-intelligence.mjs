import { stableId } from '../../../dist/intelligenceFoundation/contracts/index.js';

// Deliberately inside (not on the boundary of) a four-hour UTC session bucket.
export const SCENARIO_TIME = 1_800_001_800_000;
export const FEATURE_VERSION = 'market-features-v1';
export const CONFIGURATION_VERSION = 'integration-fixture-v1';

export function instrument(symbol = 'DORMUSDT', productFamily = 'SPOT') {
  const baseAsset = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  const sourceMarketType = productFamily === 'USD_M_PERPETUAL' ? 1 : null;
  return {
    instrumentId: stableId('instrument', {
      venue: 'BINANCE', productFamily, symbol, baseAsset, quoteAsset: productFamily === 'BORROW' ? null : 'USDT', sourceMarketType,
    }),
    venue: 'BINANCE',
    productFamily,
    symbol,
    pair: productFamily === 'BORROW' ? null : symbol,
    baseAsset,
    quoteAsset: productFamily === 'BORROW' ? null : 'USDT',
    contractType: productFamily === 'USD_M_PERPETUAL' ? 'PERPETUAL' : null,
    sourceMarketType,
  };
}

export function truth(eventTimeMs, recordId, options = {}) {
  const evaluatedAtMs = options.evaluatedAtMs ?? SCENARIO_TIME;
  const receivedTimeMs = options.receivedTimeMs ?? Math.min(evaluatedAtMs, eventTimeMs + 2);
  const maxAgeMs = options.maxAgeMs ?? 60_000;
  const ageMs = evaluatedAtMs - eventTimeMs;
  const freshnessState = options.freshnessState ?? (ageMs <= maxAgeMs ? 'FRESH' : 'STALE');
  const completenessState = options.completenessState ?? 'COMPLETE';
  return {
    schemaVersion: '1',
    producerVersion: options.producerVersion ?? 'integration-fixture-v1',
    configurationVersion: options.configurationVersion ?? CONFIGURATION_VERSION,
    featureVersion: options.featureVersion ?? null,
    authority: {
      kind: options.authorityKind ?? 'REPLAY_SUPPLIED',
      sourceId: options.sourceId ?? 'integration-fixture',
      dataset: options.dataset ?? 'official-shaped-synthetic',
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: [recordId],
      sourceSet: [options.sourceId ?? 'integration-fixture'],
      transforms: options.transforms ?? ['official-shaped-synthetic-fixture-v1'],
    },
    temporal: {
      sourceEventTimeMs: eventTimeMs,
      sourceTransactionTimeMs: options.sourceTransactionTimeMs ?? eventTimeMs,
      receivedTimeMs,
      sequence: options.sequence ?? null,
    },
    freshness: {
      basis: 'SOURCE_EVENT_TIME',
      evaluatedAtMs,
      ageMs,
      maxAgeMs,
      state: freshnessState,
    },
    completeness: {
      state: completenessState,
      observedFields: completenessState === 'MISSING' ? [] : ['fixture'],
      missingFields: completenessState === 'COMPLETE' ? [] : ['fixture.required'],
      reasonCodes: completenessState === 'COMPLETE' ? [] : ['FIXTURE_INCOMPLETE'],
    },
  };
}

export function feature(name, value, windowMs, endTimeMs, options = {}) {
  const id = stableId('integration-feature', {
    instrumentId: options.instrumentId ?? instrument().instrumentId,
    name,
    value,
    windowMs,
    endTimeMs,
    suffix: options.suffix ?? '',
  });
  return {
    id,
    instrumentId: options.instrumentId ?? instrument().instrumentId,
    feature: name,
    featureVersion: options.featureVersion ?? FEATURE_VERSION,
    value,
    unit: options.unit ?? 'ratio',
    windowMs,
    observationStartMs: windowMs === null ? endTimeMs : endTimeMs - windowMs,
    observationEndMs: endTimeMs,
    truth: truth(endTimeMs, id, {
      evaluatedAtMs: options.evaluatedAtMs ?? SCENARIO_TIME,
      maxAgeMs: options.maxAgeMs ?? 60_000,
      freshnessState: options.freshnessState,
      completenessState: options.completenessState,
      authorityKind: 'EXCHANGE_DERIVED',
      sourceId: options.sourceId ?? 'integration-feature-projection',
      dataset: name,
      featureVersion: options.featureVersion ?? FEATURE_VERSION,
      transforms: options.transforms ?? ['bounded-feature-projection-v1'],
    }),
  };
}

export function normalizedTrade({
  symbol = 'DORMUSDT',
  productFamily = 'SPOT',
  eventTimeMs,
  sequence,
  price,
  quoteQuantity,
  aggressorSide = 'BUY',
  freshnessState,
  completenessState,
}) {
  const id = stableId('integration-trade', { symbol, productFamily, eventTimeMs, sequence, price, quoteQuantity, aggressorSide });
  return {
    id,
    kind: 'TRADE',
    instrument: instrument(symbol, productFamily),
    truth: truth(eventTimeMs, id, {
      evaluatedAtMs: Math.max(eventTimeMs + 2, SCENARIO_TIME),
      maxAgeMs: Math.max(60_000, SCENARIO_TIME - eventTimeMs + 1),
      freshnessState,
      completenessState,
      dataset: 'aggTrade',
      sourceId: productFamily === 'SPOT' ? 'binance-spot-fixture' : 'binance-usdm-fixture',
      sequence: { first: String(sequence), last: String(sequence), previous: null },
    }),
    aggregateTradeId: String(sequence),
    firstTradeId: String(sequence),
    lastTradeId: String(sequence),
    price,
    baseQuantity: quoteQuantity / price,
    quoteQuantity,
    normalBaseQuantityExcludingRpi: productFamily === 'USD_M_PERPETUAL' ? quoteQuantity / price : null,
    aggressorSide,
  };
}

export function normalizedBook({ symbol = 'DORMUSDT', productFamily = 'SPOT', eventTimeMs, sequence, mid, spreadBps = 2, quantity = 100 }) {
  const halfSpread = mid * spreadBps / 20_000;
  const id = stableId('integration-book', { symbol, productFamily, eventTimeMs, sequence, mid, spreadBps, quantity });
  return {
    id,
    kind: 'BOOK_TICKER',
    instrument: instrument(symbol, productFamily),
    truth: truth(eventTimeMs, id, {
      maxAgeMs: Math.max(60_000, SCENARIO_TIME - eventTimeMs + 1),
      dataset: 'bookTicker',
      sourceId: productFamily === 'SPOT' ? 'binance-spot-fixture' : 'binance-usdm-fixture',
    }),
    updateId: String(sequence),
    bidPrice: mid - halfSpread,
    bidQuantity: quantity,
    askPrice: mid + halfSpread,
    askQuantity: quantity,
  };
}

export function normalizedDepth({
  symbol = 'DORMUSDT',
  productFamily = 'SPOT',
  eventTimeMs,
  sequence,
  mid,
  quantity,
  levels = 3,
  bookScope = 'STANDARD_NO_RPI',
  freshnessState,
}) {
  const id = stableId('integration-depth', { symbol, productFamily, eventTimeMs, sequence, mid, quantity, levels, bookScope });
  return {
    id,
    kind: 'DEPTH_SNAPSHOT',
    instrument: instrument(symbol, productFamily),
    truth: truth(eventTimeMs, id, {
      evaluatedAtMs: SCENARIO_TIME,
      maxAgeMs: Math.max(60_000, SCENARIO_TIME - eventTimeMs + 1),
      freshnessState,
      dataset: 'depth',
      sequence: { first: String(sequence), last: String(sequence), previous: null },
    }),
    bids: Array.from({ length: levels }, (_, index) => ({ price: mid - 0.01 * (index + 1), baseQuantity: quantity })),
    asks: Array.from({ length: levels }, (_, index) => ({ price: mid + 0.01 * (index + 1), baseQuantity: quantity })),
    bookScope,
    maximumLevelsKnown: levels,
  };
}

export function normalizedLiquidation({ symbol = 'DORMUSDT', eventTimeMs, quoteNotional, positionSide = 'LONG' }) {
  const price = 100;
  const id = stableId('integration-liquidation', { symbol, eventTimeMs, quoteNotional, positionSide });
  return {
    id,
    kind: 'LIQUIDATION',
    instrument: instrument(symbol, 'USD_M_PERPETUAL'),
    truth: truth(eventTimeMs, id, { dataset: 'forceOrder', sourceId: 'binance-usdm-fixture', maxAgeMs: 60_000 }),
    orderSide: positionSide === 'LONG' ? 'SELL' : 'BUY',
    liquidatedPositionSide: positionSide,
    orderType: 'LIMIT',
    timeInForce: 'IOC',
    originalQuantity: quoteNotional / price,
    filledQuantity: quoteNotional / price,
    averagePrice: price,
    sampledPerWindow: true,
    samplingSelection: 'LATEST_PER_SYMBOL',
    sampleWindowMs: 1_000,
  };
}

export function candidate(instrumentId, atMs = SCENARIO_TIME - 10_000, options = {}) {
  const id = stableId('integration-candidate', { instrumentId, atMs, suffix: options.suffix ?? '' });
  return {
    id,
    instrumentId,
    openedAtMs: atMs,
    updatedAtMs: options.updatedAtMs ?? atMs,
    reasonCodes: options.reasonCodes ?? ['PERSISTENT_SPOT_ACTIVITY'],
    score: options.score ?? null,
    hintIds: options.hintIds ?? [],
    truth: truth(options.updatedAtMs ?? atMs, id, {
      evaluatedAtMs: options.evaluatedAtMs ?? SCENARIO_TIME,
      maxAgeMs: options.maxAgeMs ?? 60_000,
      authorityKind: 'ENGINE_DERIVED',
      sourceId: 'existing-volume-engine-fixture',
      dataset: 'candidate-hint',
    }),
  };
}

export function thesisFeatureSet(overrides = {}) {
  const short = overrides.shortWindowMs ?? 5_000;
  const confirmation = overrides.confirmationWindowMs ?? 60_000;
  const medium = overrides.mediumWindowMs ?? 300_000;
  const end = overrides.endTimeMs ?? SCENARIO_TIME - 500;
  const instrumentId = overrides.instrumentId ?? instrument().instrumentId;
  const maxAgeMs = overrides.maxAgeMs ?? 60_000;
  const values = [];
  const addWindows = (name, entries, unit = 'ratio', windowEnd = end) => {
    values.push(
      feature(name, entries[0], short, windowEnd - 200, { instrumentId, unit, maxAgeMs }),
      feature(name, entries[1], confirmation, windowEnd - 100, { instrumentId, unit, maxAgeMs }),
      feature(name, entries[2], medium, windowEnd, { instrumentId, unit, maxAgeMs }),
    );
  };
  const spotEnd = overrides.spotEndTimeMs ?? end;
  const perpetualEnd = overrides.perpetualEndTimeMs ?? end;
  addWindows('spot_relative_volume', overrides.spotRelativeVolume ?? [3.2, 3, 2.8], 'multiple', spotEnd);
  addWindows('perpetual_relative_volume', overrides.perpetualRelativeVolume ?? [1.1, 1.1, 1], 'multiple', perpetualEnd);
  addWindows('spot_arrival_acceleration', overrides.spotArrivalAcceleration ?? [2, 1.8, 1.7], 'multiple', spotEnd);
  addWindows('perpetual_arrival_acceleration', overrides.perpetualArrivalAcceleration ?? [1, 1, 1], 'multiple', perpetualEnd);
  addWindows('symbol_return_pct', overrides.symbolReturnPct ?? [0.1, 0.15, 0.2], 'percent');
  addWindows('spot_return_pct', overrides.spotReturnPct ?? [0.1, 0.15, 0.2], 'percent');
  addWindows('perpetual_return_pct', overrides.perpetualReturnPct ?? [0.01, 0.02, 0.03], 'percent');
  const scalar = {
    aggressor_imbalance: overrides.aggressorImbalance ?? 0.45,
    price_response_per_flow: overrides.priceResponsePerFlow ?? 0.2,
    depth_support_ratio: overrides.depthSupportRatio ?? 1.5,
    depth_change_ratio: overrides.depthChangeRatio ?? 1,
    spread_change_bps: overrides.spreadChangeBps ?? 0,
    replenishment_ratio: overrides.replenishmentRatio ?? 1.2,
    absorption_ratio: overrides.absorptionRatio ?? 1.3,
    funding_rate_change: overrides.fundingRateChange ?? 0,
    open_interest_change_pct: overrides.openInterestChangePct ?? 0,
    liquidation_flow_share: overrides.liquidationFlowShare ?? 0.02,
    market_participation_ratio: overrides.marketParticipationRatio ?? 0.1,
    symbol_market_residual_return_pct: overrides.symbolMarketResidualReturnPct ?? 0.18,
    fade_from_peak_pct: overrides.fadeFromPeakPct ?? 0,
    historical_analogue_count: overrides.historicalAnalogueCount ?? 0,
    trade_size_repeat_ratio: overrides.tradeSizeRepeatRatio ?? 0.1,
    side_alternation_ratio: overrides.sideAlternationRatio ?? 0.1,
    dead_baseline_flag: overrides.deadBaselineFlag ?? true,
  };
  for (const [name, value] of Object.entries(scalar)) {
    values.push(feature(name, value, name === 'historical_analogue_count' || name === 'dead_baseline_flag' ? null : confirmation, end, {
      instrumentId,
      unit: name.includes('pct') ? 'percent' : name.includes('count') ? 'count' : name.includes('flag') ? 'flag' : 'ratio',
      maxAgeMs,
    }));
  }
  return values;
}
