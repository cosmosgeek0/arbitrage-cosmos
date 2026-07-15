import { sha256 } from '../../dock/src/index.mjs';
import { asRecord, boundedString, deepFreeze, enumValue, safeInteger } from './guards.mjs';
import { decimalToMantissa, mantissaToDecimal } from './decimal.mjs';
import { createMarketEvidenceEnvelope, makeUnavailableObservation } from './evidence.mjs';
import { createInstrumentDescriptor, mapInstrumentIdentity } from './identity.mjs';
import { normalizeTimestamp, evaluateFreshness } from './time.mjs';
import { evaluateSequence } from './sequence.mjs';
import { fail } from './errors.mjs';

function canonicalDecimal(value, field, options) {
  if (typeof value !== 'string') fail('DECIMAL_STRING_REQUIRED', `${field} must be exact decimal text`);
  return mantissaToDecimal(decimalToMantissa(value, field, options));
}

function sourceHash(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('NORMALIZER_SOURCE_HASH_INVALID', 'sourceContentSha256 must be SHA-256');
  return value;
}

function capabilities(input) {
  const defaults = {
    bookTicker: 'UNKNOWN',
    trades: 'UNKNOWN',
    depth: 'UNKNOWN',
    funding: 'UNSUPPORTED',
    mark: 'UNSUPPORTED',
    index: 'UNSUPPORTED',
    openInterest: 'UNSUPPORTED',
    liquidations: 'UNKNOWN',
  };
  return { ...defaults, ...input };
}

function availability(status, accepted, reasonCode) {
  return accepted.includes(status)
    ? { state: 'AVAILABLE', reasonCodes: [] }
    : { state: 'UNAVAILABLE', reasonCodes: [reasonCode] };
}

function quoteAvailability(baseAvailability, bid, ask) {
  if (baseAvailability.state !== 'AVAILABLE') return baseAvailability;
  if (bid === null || bid === undefined || ask === null || ask === undefined) {
    return { state: 'UNAVAILABLE', reasonCodes: ['BOOK_TICKER_PRICE_MISSING'] };
  }
  return baseAvailability;
}

function evidenceAvailability(identity, sourceAvailability) {
  if (identity.identityState === 'VERIFIED') return sourceAvailability;
  return {
    state: 'UNAVAILABLE',
    reasonCodes: [...new Set([...identity.reasonCodes, ...sourceAvailability.reasonCodes])].sort(),
  };
}

function evidenceFromQuote({ identity, rawPayload, bid, ask, bidSize, askSize, clock, source, sequenceState, availabilityState }) {
  if (availabilityState.state !== 'AVAILABLE') {
    return makeUnavailableObservation({
      identityId: identity.identityId,
      payloadKind: 'BOOK_TICKER',
      reasonCodes: availabilityState.reasonCodes,
      observedAtMs: clock.normalizationTimeMs,
    });
  }
  if (!sequenceState.coherent) {
    return makeUnavailableObservation({
      identityId: identity.identityId,
      payloadKind: 'BOOK_TICKER',
      reasonCodes: sequenceState.reasonCodes,
      observedAtMs: clock.normalizationTimeMs,
    });
  }
  const freshness = evaluateFreshness({
    eventTimeMs: clock.eventTimeMs,
    receiveTimeMs: clock.receiveTimeMs,
    evaluatedAtMs: clock.normalizationTimeMs,
    maximumAgeMs: clock.maximumAgeMs,
  });
  return createMarketEvidenceEnvelope({
    identity,
    rawPayload,
    payloadKind: 'BOOK_TICKER',
    payload: {
      bidPrice: canonicalDecimal(bid, 'quote.bid'),
      askPrice: canonicalDecimal(ask, 'quote.ask'),
      bidSize: bidSize === null ? null : canonicalDecimal(bidSize, 'quote.bidSize'),
      askSize: askSize === null ? null : canonicalDecimal(askSize, 'quote.askSize'),
      availability: availabilityState.state,
    },
    exchangeEventTimeMs: clock.eventTimeMs,
    localReceiveTimeMs: clock.receiveTimeMs,
    normalizationTimeMs: clock.normalizationTimeMs,
    featureCutoffTimeMs: clock.featureCutoffTimeMs,
    sourceType: `${identity.venue}_PUBLIC_FIXTURE`,
    streamClass: source.streamClass,
    connectionId: source.connectionId,
    sessionId: source.sessionId,
    sequence: source.sequence,
    endpoint: source.endpoint,
    freshness: freshness.state,
    completeness: bidSize === null || askSize === null ? 'PARTIAL' : 'COMPLETE',
    gapCount: sequenceState.gapCount ?? 0,
    duplicate: sequenceState.state === 'DUPLICATE',
    reconstructed: sequenceState.state === 'RESNAPSHOT_BASELINE',
  });
}

function normalizeClock(clock, rawEventTime, expectedUnit) {
  asRecord(clock, 'clock');
  const normalized = normalizeTimestamp({
    raw: rawEventTime,
    unit: clock.eventTimeUnit,
    expectedUnit,
    receiveTimeMs: clock.receiveTimeMs,
    maximumFutureSkewMs: clock.maximumFutureSkewMs ?? 0,
  });
  safeInteger(clock.normalizationTimeMs, 'clock.normalizationTimeMs', { minimum: clock.receiveTimeMs });
  safeInteger(clock.maximumAgeMs, 'clock.maximumAgeMs', { minimum: 1 });
  if (clock.featureCutoffTimeMs !== null && clock.featureCutoffTimeMs < clock.normalizationTimeMs) fail('NORMALIZER_CUTOFF_VIOLATION', 'normalization happens after cutoff');
  return { ...clock, eventTimeMs: normalized.eventTimeMs };
}

function sequenceFromSource(source) {
  asRecord(source, 'source');
  if (source.sequenceSemantics === 'STATELESS_SNAPSHOT') {
    if (source.previousLast !== null || source.currentFirst !== null || source.currentLast !== null || source.sequence !== null) {
      fail('STATELESS_SEQUENCE_FIELD_FORBIDDEN', 'stateless snapshots cannot fabricate sequence cursors');
    }
    return deepFreeze({ state: 'STATELESS_SNAPSHOT', coherent: true, gapCount: 0, resnapshotRequired: false, reasonCodes: [] });
  }
  const evaluated = evaluateSequence({
    previousLast: source.previousLast,
    currentFirst: source.currentFirst,
    currentLast: source.currentLast,
    previousConnectionGeneration: source.previousConnectionGeneration ?? 0,
    connectionGeneration: source.connectionGeneration ?? 0,
    resnapshotEstablished: source.resnapshotEstablished ?? false,
  });
  if (source.currentLast === null) {
    if (source.sequence !== null) fail('SEQUENCE_PROVENANCE_CONTRADICTION', 'missing sequence range requires null emitted sequence');
  } else {
    safeInteger(source.sequence, 'source.sequence', { minimum: 0 });
    if (BigInt(source.sequence) !== BigInt(String(source.currentLast))) {
      fail('SEQUENCE_PROVENANCE_CONTRADICTION', 'emitted sequence must equal the evaluated terminal cursor');
    }
  }
  return evaluated;
}

function result(venue, descriptor, identity, observation, sequenceState, availabilityState) {
  return deepFreeze({
    schema: 'VenueNormalizationResultV1',
    venue,
    descriptor,
    identity,
    observation,
    sequenceState,
    availability: availabilityState,
    canonicalStateWritten: false,
    networkOpened: false,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
  });
}

function validateRawBundle(input, venue) {
  asRecord(input, `${venue} raw bundle`);
  if (input.schema !== 'VenueRawFixtureBundleV1' || input.version !== 1 || input.venue !== venue) {
    fail('RAW_FIXTURE_SCHEMA_INVALID', `${venue} fixture must be VenueRawFixtureBundleV1 version 1`);
  }
}

export function normalizeCoinbaseFixture(input) {
  validateRawBundle(input, 'COINBASE');
  const { product, ticker, assetRegistry, clock, source } = input;
  asRecord(product, 'coinbase.product');
  asRecord(ticker, 'coinbase.ticker');
  if (product.id !== ticker.product_id) fail('COINBASE_PRODUCT_ID_MISMATCH', 'product and ticker fixture identities differ');
  boundedString(product.id, 'coinbase.product.id', 128);
  const baseAsset = boundedString(product.base_currency, 'coinbase.product.base_currency', 64);
  const quoteAsset = boundedString(product.quote_currency, 'coinbase.product.quote_currency', 64);
  if (product.id !== `${baseAsset}-${quoteAsset}`) fail('COINBASE_INSTRUMENT_METADATA_MISMATCH', 'Coinbase product id must equal its explicit base and quote metadata');
  const descriptor = createInstrumentDescriptor({
    venue: 'COINBASE',
    venueInstrumentId: product.id,
    symbol: product.id,
    baseAsset,
    quoteAsset,
    settlementAsset: null,
    productFamily: 'SPOT',
    expiryTimeMs: null,
    strike: null,
    optionType: null,
    contractMultiplier: null,
    contractMultiplierUnit: null,
    tickSize: canonicalDecimal(product.quote_increment, 'coinbase.product.quote_increment'),
    quantityStep: canonicalDecimal(product.base_increment, 'coinbase.product.base_increment'),
    status: product.status,
    tradingPhase: product.trading_disabled === true ? 'SUSPENDED' : product.cancel_only === true ? 'CANCEL_ONLY' : product.limit_only === true ? 'LIMIT_ONLY' : 'TRADING',
    observedAtMs: clock.normalizationTimeMs,
    availableAtMs: clock.receiveTimeMs,
    sourceUrl: product.sourceUrl,
    sourceContentSha256: sourceHash(product.sourceContentSha256),
    publicCapabilities: capabilities({ bookTicker: 'SUPPORTED_PUBLIC', trades: 'SUPPORTED_PUBLIC', depth: 'SUPPORTED_PUBLIC' }),
  });
  const identity = mapInstrumentIdentity(descriptor, assetRegistry);
  const venueAvailabilityState = product.status !== 'online'
    ? availability(product.status, ['online'], product.status === 'delisted' ? 'INSTRUMENT_DELISTED' : 'INSTRUMENT_SUSPENDED')
    : product.trading_disabled === true ? { state: 'UNAVAILABLE', reasonCodes: ['TRADING_DISABLED'] }
      : product.cancel_only === true ? { state: 'UNAVAILABLE', reasonCodes: ['CANCEL_ONLY'] }
        : product.limit_only === true ? { state: 'UNAVAILABLE', reasonCodes: ['LIMIT_ONLY'] }
          : { state: 'AVAILABLE', reasonCodes: [] };
  const availabilityState = evidenceAvailability(identity, quoteAvailability(venueAvailabilityState, ticker.best_bid, ticker.best_ask));
  const sequenceState = sequenceFromSource(source);
  const normalizedClock = normalizeClock(clock, ticker.time, 'RFC3339');
  const observation = evidenceFromQuote({ identity, rawPayload: ticker, bid: ticker.best_bid, ask: ticker.best_ask, bidSize: ticker.best_bid_size ?? null, askSize: ticker.best_ask_size ?? null, clock: normalizedClock, source, sequenceState, availabilityState });
  return result('COINBASE', descriptor, identity, observation, sequenceState, availabilityState);
}

export function normalizeKrakenFixture(input) {
  validateRawBundle(input, 'KRAKEN');
  const { instrument, ticker, assetRegistry, clock, source } = input;
  asRecord(instrument, 'kraken.instrument');
  asRecord(ticker, 'kraken.ticker');
  if (instrument.symbol !== ticker.symbol) fail('KRAKEN_PRODUCT_ID_MISMATCH', 'instrument and ticker fixture identities differ');
  const descriptor = createInstrumentDescriptor({
    venue: 'KRAKEN',
    venueInstrumentId: instrument.symbol,
    symbol: instrument.symbol,
    baseAsset: instrument.base,
    quoteAsset: instrument.quote,
    settlementAsset: null,
    productFamily: 'SPOT',
    expiryTimeMs: null,
    strike: null,
    optionType: null,
    contractMultiplier: null,
    contractMultiplierUnit: null,
    tickSize: canonicalDecimal(instrument.price_increment, 'kraken.instrument.price_increment'),
    quantityStep: canonicalDecimal(instrument.qty_increment, 'kraken.instrument.qty_increment'),
    status: instrument.status,
    tradingPhase: instrument.status,
    observedAtMs: clock.normalizationTimeMs,
    availableAtMs: clock.receiveTimeMs,
    sourceUrl: instrument.sourceUrl,
    sourceContentSha256: sourceHash(instrument.sourceContentSha256),
    publicCapabilities: capabilities({ bookTicker: 'SUPPORTED_PUBLIC', trades: 'SUPPORTED_PUBLIC', depth: 'SUPPORTED_PUBLIC' }),
  });
  const identity = mapInstrumentIdentity(descriptor, assetRegistry);
  const availabilityState = evidenceAvailability(identity, quoteAvailability(
    availability(instrument.status, ['online'], 'INSTRUMENT_NOT_TRADING'), ticker.bid, ticker.ask,
  ));
  const sequenceState = sequenceFromSource(source);
  const normalizedClock = normalizeClock(clock, ticker.timestamp, 'RFC3339');
  const observation = evidenceFromQuote({ identity, rawPayload: ticker, bid: ticker.bid, ask: ticker.ask, bidSize: ticker.bid_qty ?? null, askSize: ticker.ask_qty ?? null, clock: normalizedClock, source, sequenceState, availabilityState });
  return result('KRAKEN', descriptor, identity, observation, sequenceState, availabilityState);
}

export function normalizeDeribitFixture(input) {
  validateRawBundle(input, 'DERIBIT');
  const { instrument, ticker, assetRegistry, clock, source } = input;
  asRecord(instrument, 'deribit.instrument');
  asRecord(ticker, 'deribit.ticker');
  if (instrument.instrument_name !== ticker.instrument_name) fail('DERIBIT_PRODUCT_ID_MISMATCH', 'instrument and ticker fixture identities differ');
  enumValue(instrument.kind, ['future', 'option'], 'deribit.instrument.kind');
  const isOption = instrument.kind === 'option';
  const perpetual = instrument.kind === 'future' && instrument.expiration_timestamp === null;
  const productFamily = isOption ? 'OPTION' : perpetual ? 'PERPETUAL' : 'DATED_FUTURE';
  const descriptor = createInstrumentDescriptor({
    venue: 'DERIBIT',
    venueInstrumentId: instrument.instrument_name,
    symbol: instrument.instrument_name,
    baseAsset: instrument.base_currency,
    quoteAsset: instrument.quote_currency,
    settlementAsset: instrument.settlement_currency,
    productFamily,
    expiryTimeMs: instrument.expiration_timestamp,
    strike: isOption ? canonicalDecimal(instrument.strike, 'deribit.instrument.strike') : null,
    optionType: isOption ? enumValue(instrument.option_type, ['CALL', 'PUT'], 'deribit.instrument.option_type') : null,
    contractMultiplier: canonicalDecimal(instrument.contract_size, 'deribit.instrument.contract_size'),
    contractMultiplierUnit: instrument.contract_size_unit,
    tickSize: canonicalDecimal(instrument.tick_size, 'deribit.instrument.tick_size'),
    quantityStep: canonicalDecimal(instrument.min_trade_amount, 'deribit.instrument.min_trade_amount'),
    status: instrument.is_active ? 'online' : 'expired_or_suspended',
    tradingPhase: instrument.is_active ? 'TRADING' : 'UNAVAILABLE',
    observedAtMs: clock.normalizationTimeMs,
    availableAtMs: clock.receiveTimeMs,
    sourceUrl: instrument.sourceUrl,
    sourceContentSha256: sourceHash(instrument.sourceContentSha256),
    publicCapabilities: capabilities({
      bookTicker: 'SUPPORTED_PUBLIC',
      trades: 'SUPPORTED_PUBLIC',
      depth: 'SUPPORTED_PUBLIC',
      funding: perpetual ? 'SUPPORTED_PUBLIC' : 'UNSUPPORTED',
      mark: 'SUPPORTED_PUBLIC',
      index: 'SUPPORTED_PUBLIC',
      openInterest: 'SUPPORTED_PUBLIC',
    }),
  });
  const identity = mapInstrumentIdentity(descriptor, assetRegistry);
  const availabilityState = evidenceAvailability(identity, quoteAvailability(
    availability(instrument.is_active, [true], 'INSTRUMENT_NOT_TRADING'), ticker.best_bid_price, ticker.best_ask_price,
  ));
  const sequenceState = sequenceFromSource(source);
  const normalizedClock = normalizeClock(clock, ticker.timestamp, 'MS');
  const observation = evidenceFromQuote({ identity, rawPayload: ticker, bid: ticker.best_bid_price, ask: ticker.best_ask_price, bidSize: ticker.best_bid_amount ?? null, askSize: ticker.best_ask_amount ?? null, clock: normalizedClock, source, sequenceState, availabilityState });
  const sharedMetricReasons = [
    ...(identity.identityState === 'VERIFIED' ? [] : identity.reasonCodes),
    ...(availabilityState.state === 'AVAILABLE' ? [] : availabilityState.reasonCodes),
    ...(sequenceState.coherent ? [] : sequenceState.reasonCodes),
  ];
  const metrics = [
    ['MARK', ticker.mark_price, 'markPrice'],
    ['INDEX', ticker.index_price, 'indexPrice'],
    ['FUNDING', ticker.current_funding, 'fundingRate'],
    ['OPEN_INTEREST', ticker.open_interest, 'openInterest'],
  ].map(([payloadKind, value, field]) => {
    const reasonCodes = [...sharedMetricReasons];
    if (value === null || value === undefined) reasonCodes.push(`${payloadKind}_VALUE_MISSING`);
    if (reasonCodes.length > 0) {
      return makeUnavailableObservation({
        identityId: identity.identityId,
        payloadKind,
        reasonCodes,
        observedAtMs: normalizedClock.normalizationTimeMs,
      });
    }
    return createMarketEvidenceEnvelope({
      identity,
      rawPayload: ticker,
      payloadKind,
      payload: { [field]: canonicalDecimal(value, `deribit.ticker.${field}`, { allowNegative: payloadKind === 'FUNDING' }) },
      exchangeEventTimeMs: normalizedClock.eventTimeMs,
      localReceiveTimeMs: normalizedClock.receiveTimeMs,
      normalizationTimeMs: normalizedClock.normalizationTimeMs,
      featureCutoffTimeMs: normalizedClock.featureCutoffTimeMs,
      sourceType: 'DERIBIT_PUBLIC_FIXTURE',
      streamClass: source.streamClass,
      connectionId: source.connectionId,
      sessionId: source.sessionId,
      sequence: source.sequence,
      endpoint: source.endpoint,
      freshness: evaluateFreshness({ eventTimeMs: normalizedClock.eventTimeMs, receiveTimeMs: normalizedClock.receiveTimeMs, evaluatedAtMs: normalizedClock.normalizationTimeMs, maximumAgeMs: normalizedClock.maximumAgeMs }).state,
      completeness: 'COMPLETE',
      gapCount: sequenceState.gapCount ?? 0,
      reconstructed: sequenceState.state === 'RESNAPSHOT_BASELINE',
    });
  });
  return deepFreeze({ ...result('DERIBIT', descriptor, identity, observation, sequenceState, availabilityState), metrics, normalizationHash: sha256({ descriptor, observation, metrics }) });
}

export function normalizeCoinbaseTradeFixture({ identity, trade, clock, source }) {
  asRecord(trade, 'coinbase.trade');
  if (identity.venue !== 'COINBASE' || trade.product_id !== identity.venueInstrumentId) fail('COINBASE_TRADE_IDENTITY_MISMATCH', 'trade fixture and identity differ');
  const normalizedClock = normalizeClock(clock, trade.time, 'RFC3339');
  const sequenceState = sequenceFromSource(source);
  if (!sequenceState.coherent) {
    return makeUnavailableObservation({ identityId: identity.identityId, payloadKind: 'TRADE', reasonCodes: sequenceState.reasonCodes, observedAtMs: clock.normalizationTimeMs });
  }
  const freshness = evaluateFreshness({ eventTimeMs: normalizedClock.eventTimeMs, receiveTimeMs: normalizedClock.receiveTimeMs, evaluatedAtMs: normalizedClock.normalizationTimeMs, maximumAgeMs: normalizedClock.maximumAgeMs });
  return createMarketEvidenceEnvelope({
    identity,
    rawPayload: trade,
    payloadKind: 'TRADE',
    payload: {
      tradeId: boundedString(String(trade.trade_id), 'coinbase.trade.trade_id', 128),
      price: canonicalDecimal(trade.price, 'coinbase.trade.price'),
      size: canonicalDecimal(trade.size, 'coinbase.trade.size'),
      makerSide: enumValue(trade.side, ['buy', 'sell'], 'coinbase.trade.side').toUpperCase(),
    },
    exchangeEventTimeMs: normalizedClock.eventTimeMs,
    localReceiveTimeMs: normalizedClock.receiveTimeMs,
    normalizationTimeMs: normalizedClock.normalizationTimeMs,
    featureCutoffTimeMs: normalizedClock.featureCutoffTimeMs,
    sourceType: 'COINBASE_PUBLIC_FIXTURE',
    streamClass: source.streamClass,
    connectionId: source.connectionId,
    sessionId: source.sessionId,
    sequence: source.sequence,
    endpoint: source.endpoint,
    freshness: freshness.state,
    completeness: 'COMPLETE',
    gapCount: sequenceState.gapCount ?? 0,
  });
}

function normalizeBookSide(levels, field) {
  if (!Array.isArray(levels) || levels.length === 0 || levels.length > 1_000) fail('BOOK_LEVELS_INVALID', `${field} must contain bounded levels`);
  return levels.map((level, index) => {
    if (!Array.isArray(level) || level.length !== 2) fail('BOOK_LEVEL_INVALID', `${field}[${index}] must contain price and quantity`);
    return [canonicalDecimal(level[0], `${field}[${index}].price`), canonicalDecimal(level[1], `${field}[${index}].quantity`)];
  });
}

function validateBookOrdering(bids, asks) {
  const bidPrices = bids.map(([price]) => decimalToMantissa(price, 'book.bid.price'));
  const askPrices = asks.map(([price]) => decimalToMantissa(price, 'book.ask.price'));
  const quantities = [...bids, ...asks].map(([, quantity]) => decimalToMantissa(quantity, 'book.quantity'));
  if (bidPrices.some((price) => price <= 0n) || askPrices.some((price) => price <= 0n) || quantities.some((quantity) => quantity <= 0n)) {
    fail('BOOK_NON_POSITIVE_LEVEL', 'book prices and quantities must be positive');
  }
  if (bidPrices.some((price, index) => index > 0 && bidPrices[index - 1] <= price)) fail('BOOK_BID_ORDER_INVALID', 'book bids must be strictly descending');
  if (askPrices.some((price, index) => index > 0 && askPrices[index - 1] >= price)) fail('BOOK_ASK_ORDER_INVALID', 'book asks must be strictly ascending');
  if (bidPrices[0] >= askPrices[0]) fail('BOOK_CROSSED', 'book best bid must be below best ask');
}

export function normalizeKrakenBookFixture({ identity, book, clock, source }) {
  asRecord(book, 'kraken.book');
  if (identity.venue !== 'KRAKEN' || book.symbol !== identity.venueInstrumentId) fail('KRAKEN_BOOK_IDENTITY_MISMATCH', 'book fixture and identity differ');
  boundedString(book.checksum, 'kraken.book.checksum', 128);
  const normalizedClock = normalizeClock(clock, book.timestamp, 'RFC3339');
  const sequenceState = sequenceFromSource(source);
  if (!sequenceState.coherent) {
    return makeUnavailableObservation({ identityId: identity.identityId, payloadKind: 'BOOK_SNAPSHOT', reasonCodes: sequenceState.reasonCodes, observedAtMs: clock.normalizationTimeMs });
  }
  const freshness = evaluateFreshness({ eventTimeMs: normalizedClock.eventTimeMs, receiveTimeMs: normalizedClock.receiveTimeMs, evaluatedAtMs: normalizedClock.normalizationTimeMs, maximumAgeMs: normalizedClock.maximumAgeMs });
  const bids = normalizeBookSide(book.bids, 'kraken.book.bids');
  const asks = normalizeBookSide(book.asks, 'kraken.book.asks');
  validateBookOrdering(bids, asks);
  return createMarketEvidenceEnvelope({
    identity,
    rawPayload: book,
    payloadKind: 'BOOK_SNAPSHOT',
    payload: { bids, asks, checksum: book.checksum, integrityState: 'CHECKSUM_UNVERIFIED_FIXTURE' },
    exchangeEventTimeMs: normalizedClock.eventTimeMs,
    localReceiveTimeMs: normalizedClock.receiveTimeMs,
    normalizationTimeMs: normalizedClock.normalizationTimeMs,
    featureCutoffTimeMs: normalizedClock.featureCutoffTimeMs,
    sourceType: 'KRAKEN_PUBLIC_FIXTURE',
    streamClass: source.streamClass,
    connectionId: source.connectionId,
    sessionId: source.sessionId,
    sequence: source.sequence,
    endpoint: source.endpoint,
    freshness: freshness.state,
    completeness: 'PARTIAL',
    gapCount: 0,
  });
}
