import { createHash } from 'node:crypto';

import { canonicalJson } from '../../../dist/foundation/contracts/index.js';
import {
  RUNTIME_UNIVERSE_DEFAULTS,
  RUNTIME_UNIVERSE_SOURCE_IDS,
  parseExchangeInformation,
} from '../../../dist/intelligenceRuntime/universe/index.js';
import {
  BINANCE_FILTER_REFERENCE_SCHEMA,
  L04_BINANCE_MATRIX_SHA256,
  L04_EXCHANGE_INFO_CONTRACT_IDS,
  deriveFilterReferenceEvidenceRevision,
  normalizeRuntimeInstrumentRegistry,
} from '../../../dist/liveEdge/adapters/binanceInstrumentSpecs/index.js';
import {
  createRateBudgetState,
  observeRateResponse,
} from '../../../dist/liveEdge/adapters/binanceSignedKernel/index.js';
import {
  deriveTwinEventId,
  exchangeTwinOwnerEvidenceSha256,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  evaluateSyntheticSubmissionBoundary,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import {
  T0 as L06_T0,
  inputFixture as mutationInputFixture,
  submittingPersisted,
} from '../mutationJournal/fixtures.mjs';

export const T0 = L06_T0 + 100;

const IP_SCOPE = 'egress:exchange-twin-fixture';
const ACCOUNT_SCOPE = 'account:exchange-twin-fixture';
const UNIVERSE_CONFIG = Object.freeze({
  ...RUNTIME_UNIVERSE_DEFAULTS,
  configurationVersion: 'l07-exchange-twin-fixture-v1',
  universePolicy: Object.freeze({ ...RUNTIME_UNIVERSE_DEFAULTS.universePolicy }),
});

function buildRegistry(product, maximumAgeMs = 20_000) {
  const receivedAtMs = T0 - 1_000;
  const usdm = product === 'USD_M_PERPETUAL';
  const source = usdm ? 'USD_M_PERPETUAL' : 'SPOT';
  const symbol = usdm ? {
    symbol: 'BTCUSDT',
    pair: 'BTCUSDT',
    contractType: 'PERPETUAL',
    deliveryDate: 4_133_404_800_000,
    onboardDate: 0,
    status: 'TRADING',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    marginAsset: 'USDT',
    pricePrecision: 8,
    quantityPrecision: 8,
    baseAssetPrecision: 8,
    quotePrecision: 8,
    underlyingType: 'COIN',
    underlyingSubType: [],
    orderTypes: ['LIMIT', 'MARKET'],
    timeInForce: ['GTC', 'IOC', 'FOK'],
    filters: [
      { filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '1000000', tickSize: '0.01' },
      { filterType: 'LOT_SIZE', minQty: '0.001', maxQty: '1000', stepSize: '0.001' },
      { filterType: 'MARKET_LOT_SIZE', minQty: '0.001', maxQty: '1000', stepSize: '0.001' },
      { filterType: 'MIN_NOTIONAL', notional: '0.001' },
    ],
  } : {
    symbol: 'BTCUSDT',
    status: 'TRADING',
    baseAsset: 'BTC',
    baseAssetPrecision: 8,
    quoteAsset: 'USDT',
    quotePrecision: 8,
    quoteAssetPrecision: 8,
    baseCommissionPrecision: 8,
    quoteCommissionPrecision: 8,
    orderTypes: ['LIMIT', 'MARKET'],
    isSpotTradingAllowed: true,
    isMarginTradingAllowed: false,
    permissionSets: [['SPOT']],
    filters: [
      { filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '1000000', tickSize: '0.01' },
      { filterType: 'LOT_SIZE', minQty: '0.001', maxQty: '1000', stepSize: '0.001' },
      { filterType: 'MARKET_LOT_SIZE', minQty: '0.001', maxQty: '1000', stepSize: '0.001' },
      { filterType: 'MIN_NOTIONAL', minNotional: '0.001', applyToMarket: true, avgPriceMins: 5 },
    ],
  };
  const parsed = parseExchangeInformation({
    timezone: 'UTC',
    serverTime: receivedAtMs - 1,
    exchangeFilters: [],
    symbols: [symbol],
  }, {
    source,
    sourceId: RUNTIME_UNIVERSE_SOURCE_IDS[source],
    dataset: usdm ? 'usd_m.exchange_info' : 'spot.exchange_info',
    receivedTimeMs: receivedAtMs,
    evaluatedAtMs: receivedAtMs,
    config: UNIVERSE_CONFIG,
  });
  if (parsed.listings.length !== 1) throw new Error('L07 registry fixture did not parse');
  const normalized = normalizeRuntimeInstrumentRegistry({
    matrixSha256: L04_BINANCE_MATRIX_SHA256,
    contractId: L04_EXCHANGE_INFO_CONTRACT_IDS[product],
    product,
    environment: 'PRODUCTION',
    evaluatedAtMs: T0 - 100,
    maximumAgeMs,
    metadata: [parsed.listings[0].metadata],
  });
  if (!normalized.ok) throw new Error(`L07 registry fixture rejected: ${normalized.reasonCodes.join(',')}`);
  return normalized.snapshot;
}

const SPOT_REGISTRY = buildRegistry('SPOT');
const USDM_REGISTRY = buildRegistry('USD_M_PERPETUAL');
const SPOT_SPEC = SPOT_REGISTRY.instruments[0];
const USDM_SPEC = USDM_REGISTRY.instruments[0];
export const OWNER_INSTRUMENT_VALID_UNTIL_MS = USDM_SPEC.sourceValidUntilMs;

function rateCapacity({
  product,
  scopeKind,
  scopeHandle,
  rateKind,
  interval,
  capacity,
  windowStartedAtMs,
}) {
  const duration = interval === 'TEN_SECONDS' ? 10_000 : 60_000;
  const alignedStart = windowStartedAtMs ?? Math.floor(T0 / duration) * duration;
  return {
    product, environment: 'PRODUCTION', scopeKind, scopeHandle,
    rateKind, interval, capacity, windowStartedAtMs: alignedStart,
    windowEndsAtMs: alignedStart + duration,
  };
}

export function rateOwnerEvidence({
  product = 'USD_M_PERPETUAL',
  contractId = product === 'SPOT' ? 'SPOT_ORDER_POST' : 'USDM_ORDER_POST',
  atMs = T0 + 3,
  mode = 'RESERVED',
} = {}) {
  let capacities = [
    rateCapacity({
      product,
      scopeKind: 'IP', scopeHandle: IP_SCOPE, rateKind: 'REQUEST_WEIGHT',
      interval: 'MINUTE', capacity: 200,
    }),
    rateCapacity({
      product,
      scopeKind: 'ACCOUNT', scopeHandle: ACCOUNT_SCOPE, rateKind: 'ORDER_COUNT',
      interval: 'TEN_SECONDS', capacity: 10,
    }),
  ];
  if (product === 'USD_M_PERPETUAL') {
    capacities.push(rateCapacity({
      product,
      scopeKind: 'ACCOUNT', scopeHandle: ACCOUNT_SCOPE, rateKind: 'ORDER_COUNT',
      interval: 'MINUTE', capacity: 100,
    }));
  }
  if (mode === 'CAPACITY_UNKNOWN') capacities = capacities.slice(0, 1);
  if (mode === 'CAPACITY_WINDOW_MISMATCH') {
    capacities = capacities.map((item) => {
      const duration = item.interval === 'TEN_SECONDS' ? 10_000 : 60_000;
      const windowStartedAtMs = Math.floor(T0 / duration) * duration + duration;
      return { ...item, windowStartedAtMs, windowEndsAtMs: windowStartedAtMs + duration };
    });
  }
  const reservationInput = {
    contractId,
    product,
    environment: 'PRODUCTION',
    scopeHandles: { IP: IP_SCOPE, ACCOUNT: ACCOUNT_SCOPE },
    capacities,
    atMs,
  };
  let rateState = createRateBudgetState();
  if (!['USAGE_UNKNOWN', 'CAPACITY_WINDOW_MISMATCH'].includes(mode)) {
    const status = mode === 'COOLDOWN' ? 429 : mode === 'CIRCUIT_OPEN' ? 418 : 200;
    const used = mode === 'BUDGET_EXHAUSTED' ? '200' : '0';
    const orderCount = mode === 'BUDGET_EXHAUSTED' ? '10' : '0';
    const observation = observeRateResponse(rateState, {
      ...reservationInput,
      atMs: mode === 'CLOCK_REGRESSION' ? atMs + 1 : T0,
      status,
      headers: {
        'X-MBX-USED-WEIGHT-1M': used,
        'X-MBX-ORDER-COUNT-10S': orderCount,
        ...(product === 'USD_M_PERPETUAL' ? { 'X-MBX-ORDER-COUNT-1M': orderCount } : {}),
        ...(status === 429 ? { 'Retry-After': '5' } : {}),
      },
    });
    rateState = observation.state;
  }
  const ownerEvidenceSha256 = exchangeTwinOwnerEvidenceSha256({ rateState, reservationInput });
  return { rateState, reservationInput, ownerEvidenceSha256 };
}

function referenceEvidence(fixture, evaluatedAtMs) {
  if (fixture.orderType !== 'MARKET') return null;
  const projection = {
    schema: BINANCE_FILTER_REFERENCE_SCHEMA,
    producer: 'INTELLIGENCE_RUNTIME',
    product: fixture.product,
    symbol: fixture.symbol,
    instrumentRevision: fixture.instrumentRevision,
    kind: fixture.product === 'USD_M_PERPETUAL' ? 'MARK_PRICE' : 'WEIGHTED_AVERAGE',
    averagingWindowMins: fixture.product === 'USD_M_PERPETUAL' ? null : 5,
    price: '100',
    observedAtMs: evaluatedAtMs - 1,
    validUntilMs: evaluatedAtMs + 4_000,
    sourceTruthId: 'runtime-filter-reference:l07-fixture-v1',
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
    externalActionAuthorization: 'NONE',
    actionAuthority: 'NONE_RECORD_ONLY',
  };
  return { ...projection, evidenceRevision: deriveFilterReferenceEvidenceRevision(projection) };
}

function l06PlacementEvidence(base, validUntilMs) {
  const validationPrice = base.price ?? '100';
  const resultNotional = multiplySimple(validationPrice, base.quantity);
  const correlation = createHash('sha256').update(base.fixtureId).digest('hex').slice(0, 16);
  const input = mutationInputFixture({
    identity: {
      globalCorrelationId: `cor_${correlation}`,
      product: base.product,
      contractId: base.product === 'SPOT' ? 'SPOT_ORDER_POST' : 'USDM_ORDER_POST',
      signerProfile: base.product === 'SPOT' ? 'SPOT_HMAC_SHA256' : 'USDM_HMAC_SHA256',
    },
    requestedQuantity: base.quantity,
    preflightResult: {
      instrumentRevision: base.instrumentRevision,
      sourceEvidenceRevision: base.sourceEvidenceRevision,
      requestedPrice: base.price,
      validationPrice,
      requestedQuantity: base.quantity,
      resultQuantity: base.quantity,
      resultNotional,
      effectiveNotionalCeiling: '10',
      canaryMaximumNotional: '10',
      ...(validUntilMs === undefined ? {} : { instrumentValidUntilMs: validUntilMs }),
    },
    bindings: {
      instrumentRevision: base.instrumentRevision,
      sourceEvidenceRevision: base.sourceEvidenceRevision,
      preflightResultQuantity: base.quantity,
      preflightResultNotional: resultNotional,
      preflightCanaryMaximumNotional: '10',
      ...(validUntilMs === undefined ? {} : { validUntilMs }),
    },
  });
  const persisted = submittingPersisted(input);
  return {
    l06Snapshot: persisted.snapshot,
    l06Boundary: evaluateSyntheticSubmissionBoundary(persisted, L06_T0 + 4),
  };
}

export function cancelFixture(target, overrides = {}) {
  const cancelFixtureId = overrides.cancelFixtureId ?? 'cancel-fixture-0001';
  const targetIdentity = target.l06Snapshot.identity;
  const validationPrice = target.price ?? '100';
  const resultNotional = multiplySimple(validationPrice, target.quantity);
  const input = mutationInputFixture({
    identity: {
      globalCorrelationId: targetIdentity.globalCorrelationId,
      ticketId: targetIdentity.ticketId,
      legId: targetIdentity.legId,
      attempt: targetIdentity.attempt,
      product: targetIdentity.product,
      accountRealmId: targetIdentity.accountRealmId,
      symbol: targetIdentity.symbol,
      mutationKind: 'CANCEL_ORDER',
      contractId: target.product === 'SPOT' ? 'SPOT_ORDER_CANCEL' : 'USDM_ORDER_CANCEL',
      contractState: 'CURRENT',
      requestSequence: targetIdentity.requestSequence + 1,
      intentFingerprint: createHash('sha256').update(cancelFixtureId).digest('hex').slice(0, 32),
    },
    requestedQuantity: target.quantity,
    preflightResult: {
      instrumentRevision: target.instrumentRevision,
      sourceEvidenceRevision: target.sourceEvidenceRevision,
      requestedPrice: target.price,
      validationPrice,
      requestedQuantity: target.quantity,
      resultQuantity: target.quantity,
      resultNotional,
      effectiveNotionalCeiling: '10',
      canaryMaximumNotional: '10',
    },
    bindings: {
      instrumentRevision: target.instrumentRevision,
      sourceEvidenceRevision: target.sourceEvidenceRevision,
      preflightResultQuantity: target.quantity,
      preflightResultNotional: resultNotional,
      preflightCanaryMaximumNotional: '10',
    },
  });
  const persisted = submittingPersisted(input);
  const rateAtMs = overrides.rateAtMs ?? T0 + 30;
  const rateEvidence = overrides.rateEvidence ?? rateOwnerEvidence({
    product: target.product,
    contractId: target.product === 'SPOT' ? 'SPOT_ORDER_CANCEL' : 'USDM_ORDER_CANCEL',
    atMs: rateAtMs,
  });
  return {
    schema: 'TWIN_CANCEL_FIXTURE_V1',
    cancelFixtureId,
    targetFixtureId: target.fixtureId,
    l06Snapshot: persisted.snapshot,
    l06Boundary: evaluateSyntheticSubmissionBoundary(persisted, L06_T0 + 4),
    rateOwnerEvidenceSha256: rateEvidence.ownerEvidenceSha256,
    dispatchToVenueMs: overrides.dispatchToVenueMs ?? 5,
    venueToLocalMs: overrides.venueToLocalMs ?? 1,
    simulationAuthority: 'SYNTHETIC_FIXTURE',
    actionAuthority: 'NONE_RECORD_ONLY',
    externalActionAuthorization: 'NONE',
  };
}

export function cancelArrivalEvidence(cancel, fixtureId, atMs) {
  const evidence = rateOwnerEvidence({
    product: cancel.l06Snapshot.identity.product,
    contractId: cancel.l06Snapshot.identity.product === 'SPOT'
      ? 'SPOT_ORDER_CANCEL' : 'USDM_ORDER_CANCEL',
    atMs,
  });
  if (evidence.ownerEvidenceSha256 !== cancel.rateOwnerEvidenceSha256) {
    throw new Error('cancel rate evidence fixture mismatch');
  }
  return {
    fixtureId,
    cancelFixtureId: cancel.cancelFixtureId,
    ...evidence,
  };
}

export function orderFixture(overrides = {}) {
  const quantity = overrides.quantity ?? '0.03';
  const price = Object.hasOwn(overrides, 'price') ? overrides.price : '101';
  const orderType = overrides.orderType ?? 'LIMIT';
  const product = overrides.product ?? (orderType === 'MARKET' ? 'SPOT' : 'USD_M_PERPETUAL');
  const spec = product === 'SPOT' ? SPOT_SPEC : USDM_SPEC;
  const rateEvidence = overrides.rateEvidence ?? rateOwnerEvidence({ product });
  const l06ValidUntilMs = overrides.l06ValidUntilMs;
  const base = {
    schema: 'TWIN_ORDER_FIXTURE_V1',
    fixtureId: 'fixture-order-0001',
    product,
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    side: 'BUY',
    orderType,
    timeInForce: 'GTC',
    price,
    quantity,
    instrumentRevision: spec.instrumentRevision,
    sourceEvidenceRevision: spec.sourceEvidenceRevision,
    rateOwnerEvidenceSha256: rateEvidence.ownerEvidenceSha256,
    latency: {
      dispatchToVenueMs: 10,
      venueToHttpMs: 20,
      venueToPrivateMs: 15,
    },
    queueAheadQuantity: null,
    queueTruth: 'UNKNOWN',
    simulationAuthority: 'SYNTHETIC_FIXTURE',
    actionAuthority: 'NONE_RECORD_ONLY',
    externalActionAuthorization: 'NONE',
    ...overrides,
  };
  delete base.rateEvidence;
  delete base.l06ValidUntilMs;
  return { ...base, ...l06PlacementEvidence(base, l06ValidUntilMs) };
}

export function passingPreflight(fixture, overrides = {}) {
  const evaluatedAtMs = overrides.evaluatedAtMs ?? T0 + 20;
  const defaultRegistry = fixture.product === 'SPOT' ? SPOT_REGISTRY : USDM_REGISTRY;
  const { registrySnapshot = defaultRegistry, ...requestOverrides } = overrides;
  return {
    registrySnapshot: structuredClone(registrySnapshot),
    sizingRequest: {
      symbol: fixture.symbol,
      instrumentRevision: fixture.instrumentRevision,
      side: fixture.side,
      orderType: fixture.orderType,
      timeInForce: fixture.timeInForce,
      requestedPrice: fixture.price,
      referencePrice: referenceEvidence(fixture, evaluatedAtMs),
      requestedQuantity: fixture.quantity,
      notionalAsset: fixture.quoteAsset,
      approvedNotional: '10',
      intendedExposure: '10',
      evaluatedAtMs,
      ...requestOverrides,
    },
  };
}

export function allowedRateDecision(fixture, overrides = {}) {
  return rateOwnerEvidence({ product: fixture.product, ...overrides });
}

export function feeEvidence(overrides = {}) {
  const chargeBasis = overrides.chargeBasis ?? 'QUOTE_NOTIONAL';
  return {
    schema: 'TWIN_FEE_EVIDENCE_V1',
    evidenceRevision: `fee-evidence:${'a'.repeat(24)}`,
    makerRate: '0.0002',
    takerRate: '0.001',
    feeAsset: 'USDT',
    chargeBasis,
    rateUnit: chargeBasis === 'QUOTE_NOTIONAL'
      ? 'FEE_ASSET_PER_QUOTE_NOTIONAL'
      : 'FEE_ASSET_PER_BASE_QUANTITY',
    quoteConversionRate: '1',
    observedAtMs: T0,
    validUntilMs: T0 + 10_000,
    ...overrides,
  };
}

export function event(kind, sequence, occurredAtMs, payload, overrides = {}) {
  const projection = {
    schema: 'TWIN_EVENT_V1',
    sequence,
    sourceSequence: overrides.sourceSequence ?? null,
    occurredAtMs,
    kind,
    payload,
  };
  return { ...projection, eventId: deriveTwinEventId(projection) };
}

export function baselineEvents(fixture, {
  bids = [{ price: '99', quantity: '0.1' }],
  asks = [
    { price: '100', quantity: '0.01' },
    { price: '101', quantity: '0.02' },
    { price: '102', quantity: '0.05' },
  ],
  fee = feeEvidence(),
  httpOutcome = 'ACK',
  includePrivate = false,
} = {}) {
  const events = [
    event('SYMBOL_STATUS', 1, T0, {
      product: fixture.product,
      symbol: fixture.symbol,
      status: 'TRADING',
      evidenceRevision: `symbol-status:${'b'.repeat(24)}`,
      observedAtMs: T0,
      validUntilMs: T0 + 10_000,
    }),
    event('BOOK_SNAPSHOT', 2, T0 + 1, {
      product: fixture.product,
      symbol: fixture.symbol,
      bookRevision: `book-revision:${'c'.repeat(24)}`,
      sourceSequence: 100,
      observedAtMs: T0 + 1,
      validUntilMs: T0 + 10_000,
      bids,
      asks,
    }, { sourceSequence: 100 }),
    event('PREFLIGHT_EVIDENCE', 3, T0 + 20, {
      fixtureId: fixture.fixtureId,
      ...passingPreflight(fixture),
    }),
    event('RATE_DECISION', 4, T0 + 3, {
      fixtureId: fixture.fixtureId,
      ...allowedRateDecision(fixture),
    }),
    event('PLACE_DISPATCH', 5, T0 + 10, { fixtureId: fixture.fixtureId }),
    event('VENUE_ARRIVAL', 6, T0 + 20, {
      fixtureId: fixture.fixtureId,
      feeEvidence: fee,
    }),
    event('HTTP_DELIVERY', 8, T0 + 40, {
      fixtureId: fixture.fixtureId,
      outcome: httpOutcome,
    }),
  ];
  if (includePrivate) {
    events.push(event('PRIVATE_DELIVERY', 7, T0 + 35, {
      fixtureId: fixture.fixtureId,
      venueRevision: `venue-revision:${'d'.repeat(24)}`,
    }));
  }
  return events;
}

export function scenarioInput({ fixture = orderFixture(), events, overrides = {} } = {}) {
  return {
    schema: 'TWIN_SCENARIO_INPUT_V1',
    scenarioId: 'scenario-0001',
    modelRevision: `exchange-twin-model:${'e'.repeat(24)}`,
    seed: 'deterministic-seed-0001',
    product: fixture.product,
    symbol: fixture.symbol,
    fixtures: [fixture],
    events: events ?? baselineEvents(fixture),
    ...overrides,
  };
}

export function orderByFixtureId(state, fixtureId = 'fixture-order-0001') {
  return state.orders.find((candidate) => candidate.fixture.fixtureId === fixtureId);
}

function multiplySimple(left, right) {
  const leftParts = left.split('.');
  const rightParts = right.split('.');
  const scale = (leftParts[1]?.length ?? 0) + (rightParts[1]?.length ?? 0);
  const product = BigInt(leftParts.join('')) * BigInt(rightParts.join(''));
  const digits = product.toString().padStart(scale + 1, '0');
  if (scale === 0) return digits;
  const normalized = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
  return normalized;
}
