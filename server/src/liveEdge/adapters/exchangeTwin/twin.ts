import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import { canonicalJson } from '../../../foundation/contracts/index.js';
import {
  addTwinDecimals,
  compareTwinDecimals,
  divideTwinDecimals,
  minimumTwinDecimal,
  multiplyTwinDecimals,
  signedTwinResidual,
  subtractTwinDecimals,
  twinDecimal,
  twinPositiveDecimal,
} from './exact.js';
import {
  evaluateExchangeTwinInstrumentPreflight,
  evaluateExchangeTwinMutationSnapshot,
  evaluateExchangeTwinRateReservation,
} from './ownerEvidence.js';
import {
  EXCHANGE_TWIN_CHECKPOINT_SCHEMA,
  EXCHANGE_TWIN_SCHEMA,
  type TwinBookLevel,
  type TwinBookState,
  type TwinCalibrationComparison,
  type TwinCalibrationEvidence,
  type TwinCancelFixture,
  type TwinCheckpoint,
  type TwinEvent,
  type TwinFeeEvidence,
  type TwinFill,
  type TwinOrderFixture,
  type TwinOrderState,
  type TwinScenarioInput,
  type TwinScenarioState,
  type TwinSymbolStatus,
  type TwinVenueStatus,
} from './types.js';
import type { SyntheticSubmissionBoundaryDecision } from '../durableMutationJournal/types.js';

const MAX_UTC_MS = 4_102_444_800_000;
const MAX_FIXTURES = 32;
const MAX_EVENTS = 2_048;
const MAX_LEVELS = 512;
const MAX_FILLS = 1_024;
const MAX_TEXT = 160;
const MAX_GRAPH_NODES = 100_000;
const MAX_SERIALIZED_BYTES = 4_000_000;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{7,159}$/;
const SYMBOL = /^(?=.{2,40}$)[A-Z0-9._-]+$/;
const ASSET = /^(?=.{2,20}$)[A-Z0-9._-]+$/;
const L06_MUTATION_ID = /^l06mut_[0-9a-f]{64}$/;
const L06_OUTCOME_REVISION = /^l06outcome_[0-9a-f]{64}$/;
const L06_HEAD_DIGEST = /^l06head_[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SECRET_FIELDS = new Set([
  'apikey', 'apisecret', 'secret', 'password', 'passphrase', 'token', 'bearer',
  'signature', 'privatekey', 'credential', 'cookie', 'mnemonic',
]);

const EVENT_FIELDS = Object.freeze([
  'schema', 'eventId', 'sequence', 'sourceSequence', 'occurredAtMs', 'kind', 'payload',
] as const);

const EVENT_IDENTITY_FIELDS = Object.freeze([
  'schema', 'sequence', 'sourceSequence', 'occurredAtMs', 'kind', 'payload',
] as const);

const STATE_FIELDS = Object.freeze([
  'schema', 'scenarioId', 'modelRevision', 'seed', 'product', 'symbol', 'symbolStatus',
  'symbolStatusRevision', 'symbolStatusObservedAtMs', 'symbolStatusValidUntilMs',
  'book', 'orders', 'preflights', 'rateDecisions', 'processedEvents',
  'crashed', 'activeCrashId', 'dropLocalDeliveries', 'dropPendingCommands', 'orderingTruth',
  'ambiguousDomains',
  'outcomeRevision', 'stateRevision', 'simulationAuthority', 'actionAuthority',
  'externalActionAuthorization',
] as const);

const L06_BOUNDARY_FIELDS = Object.freeze([
  'schema', 'version', 'mutationId', 'boundaryId', 'state', 'reasonCodes', 'journalVersion',
  'journalHeadDigest', 'outcomeRevision', 'evaluatedAtMs', 'syntheticOnly',
  'sendAuthorized', 'actionAuthority', 'externalActionAuthorization',
] as const);

const EVENT_PAYLOAD_FIELDS: Readonly<Record<TwinEvent['kind'], readonly string[]>> = Object.freeze({
  SYMBOL_STATUS: Object.freeze(['product', 'symbol', 'status', 'evidenceRevision', 'observedAtMs', 'validUntilMs']),
  BOOK_SNAPSHOT: Object.freeze(['product', 'symbol', 'bookRevision', 'sourceSequence', 'observedAtMs', 'validUntilMs', 'bids', 'asks']),
  BOOK_DELTA: Object.freeze(['product', 'symbol', 'bookRevision', 'previousBookRevision', 'sourceSequence', 'observedAtMs', 'validUntilMs', 'bidUpdates', 'askUpdates']),
  BOOK_UNAVAILABLE: Object.freeze(['product', 'symbol', 'state', 'evidenceRevision']),
  PREFLIGHT_EVIDENCE: Object.freeze(['fixtureId', 'registrySnapshot', 'sizingRequest']),
  RATE_DECISION: Object.freeze(['fixtureId', 'rateState', 'reservationInput', 'ownerEvidenceSha256']),
  PLACE_DISPATCH: Object.freeze(['fixtureId']),
  VENUE_ARRIVAL: Object.freeze(['fixtureId', 'feeEvidence']),
  HTTP_DELIVERY: Object.freeze(['fixtureId', 'outcome']),
  PRIVATE_DELIVERY: Object.freeze(['fixtureId', 'venueRevision']),
  TRADE_EVIDENCE: Object.freeze(['product', 'symbol', 'tradeRevision', 'price', 'quantity', 'aggressorSide', 'feeEvidence']),
  COST_OBSERVATION: Object.freeze(['fixtureId', 'evidenceRevision', 'kind', 'amount']),
  CANCEL_DISPATCH: Object.freeze(['fixtureId', 'cancelFixture']),
  CANCEL_ARRIVAL: Object.freeze(['fixtureId', 'cancelFixtureId', 'rateState', 'reservationInput', 'ownerEvidenceSha256']),
  CANCEL_DELIVERY: Object.freeze(['fixtureId', 'cancelFixtureId', 'outcome']),
  CRASH: Object.freeze(['crashId', 'dropLocalDeliveries', 'dropPendingCommands']),
  RESTART: Object.freeze(['crashId']),
  RECONCILIATION_OBSERVATION: Object.freeze(['fixtureId', 'ownerObservationRevision', 'observedVenueRevision', 'observedStatus', 'observedFilledQuantity']),
});

const EVENT_PRIORITY: Readonly<Record<TwinEvent['kind'], number>> = Object.freeze({
  SYMBOL_STATUS: 10,
  BOOK_UNAVAILABLE: 11,
  BOOK_SNAPSHOT: 12,
  BOOK_DELTA: 13,
  PREFLIGHT_EVIDENCE: 20,
  RATE_DECISION: 21,
  PLACE_DISPATCH: 30,
  CANCEL_DISPATCH: 31,
  CRASH: 35,
  VENUE_ARRIVAL: 40,
  CANCEL_ARRIVAL: 41,
  TRADE_EVIDENCE: 42,
  COST_OBSERVATION: 43,
  HTTP_DELIVERY: 50,
  PRIVATE_DELIVERY: 51,
  CANCEL_DELIVERY: 52,
  RESTART: 60,
  RECONCILIATION_OBSERVATION: 70,
});

function digest(prefix: string, value: unknown): string {
  const serialized = canonicalJson(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_BYTES) {
    throw new RangeError('exchange-twin serialized content is overbound');
  }
  return `${prefix}${createHash('sha256').update(serialized).digest('hex')}`;
}

function stableTextCompare(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  if (utilTypes.isProxy(value)) throw new TypeError('exchange-twin data cannot be a Proxy');
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('exchange-twin data cannot contain accessors');
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function snapshot(
  value: unknown,
  seen = new Set<object>(),
  depth = 0,
  budget = { count: 0 },
): unknown {
  budget.count += 1;
  if (budget.count > MAX_GRAPH_NODES) throw new RangeError('exchange-twin graph node bound exceeded');
  if (depth > 12) throw new RangeError('exchange-twin graph depth exceeded');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('exchange-twin numbers must be safe integers');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new TypeError('exchange-twin string is unsafe or overbound');
    }
    return value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value) || seen.has(value)) {
    throw new TypeError('exchange-twin input must be alias-free plain data');
  }
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')) throw new TypeError('exchange-twin symbol keys are forbidden');
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || keys.length !== value.length + 1 || value.length > MAX_EVENTS) {
      throw new RangeError('exchange-twin array is sparse, decorated or overbound');
    }
    return value.map((_, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('exchange-twin array must contain enumerable data');
      }
      return snapshot(descriptor.value, seen, depth + 1, budget);
    });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('exchange-twin records must be plain');
  }
  if (keys.length > 96) throw new RangeError('exchange-twin record is overbound');
  const result: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    if (SECRET_FIELDS.has(key.replaceAll('_', '').toLowerCase())) {
      throw new TypeError('exchange-twin secret-shaped fields are forbidden');
    }
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('exchange-twin record must contain enumerable data');
    }
    Object.defineProperty(result, key, {
      value: snapshot(descriptor.value, seen, depth + 1, budget),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

export function exchangeTwinOwnerEvidenceSha256(value: unknown): string {
  return digest('', snapshot(value));
}

function record(value: unknown, fields: readonly string[], label: string): Readonly<Record<string, unknown>> {
  const item = snapshot(value) as Record<string, unknown>;
  if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new TypeError(`${label} must be a record`);
  const keys = Object.keys(item);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    throw new TypeError(`${label} must contain exactly: ${fields.join(', ')}`);
  }
  return item;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT || !ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function asset(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ASSET.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function safeInteger(value: unknown, label: string, minimum = 0, maximum = MAX_UTC_MS): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(`${label} must be a bounded safe integer`);
  }
  return value as number;
}

function validateL06Boundary(value: unknown): Readonly<SyntheticSubmissionBoundaryDecision> {
  const boundary = record(
    value,
    L06_BOUNDARY_FIELDS,
    'L06 synthetic boundary',
  ) as unknown as SyntheticSubmissionBoundaryDecision;
  if (boundary.schema !== 'LIVE_EDGE_SYNTHETIC_SUBMISSION_BOUNDARY_V1'
    || boundary.version !== 1
    || boundary.state !== 'SYNTHETIC_OBSERVATION_ELIGIBLE'
    || !Array.isArray(boundary.reasonCodes)
    || boundary.reasonCodes.length !== 0
    || boundary.syntheticOnly !== true
    || boundary.sendAuthorized !== false
    || boundary.actionAuthority !== 'NONE_RECORD_ONLY'
    || boundary.externalActionAuthorization !== 'NONE') {
    throw new TypeError('L06 synthetic boundary is not eligible/non-authoritative');
  }
  if (!L06_MUTATION_ID.test(boundary.mutationId)
    || !L06_HEAD_DIGEST.test(boundary.journalHeadDigest)
    || !L06_OUTCOME_REVISION.test(boundary.outcomeRevision)
    || !/^l06boundary_[0-9a-f]{64}$/.test(boundary.boundaryId)) {
    throw new TypeError('L06 synthetic boundary revisions are invalid');
  }
  safeInteger(boundary.journalVersion, 'L06 boundary journal version', 1, Number.MAX_SAFE_INTEGER);
  safeInteger(boundary.evaluatedAtMs, 'L06 boundary evaluation time');
  const expectedBoundaryId = digest('l06boundary_', {
    mutationId: boundary.mutationId,
    journalVersion: boundary.journalVersion,
    journalHeadDigest: boundary.journalHeadDigest,
    outcomeRevision: boundary.outcomeRevision,
  });
  if (boundary.boundaryId !== expectedBoundaryId) {
    throw new TypeError('L06 synthetic boundary content commitment is invalid');
  }
  return deepFreeze(boundary);
}

function validateFixture(value: unknown): Readonly<TwinOrderFixture> {
  const item = record(value, [
    'schema', 'fixtureId', 'l06Snapshot', 'l06Boundary',
    'product', 'symbol',
    'baseAsset', 'quoteAsset', 'side', 'orderType', 'timeInForce', 'price', 'quantity', 'instrumentRevision',
    'sourceEvidenceRevision', 'rateOwnerEvidenceSha256', 'latency', 'queueAheadQuantity', 'queueTruth',
    'simulationAuthority', 'actionAuthority', 'externalActionAuthorization',
  ], 'twin fixture');
  if (item.schema !== 'TWIN_ORDER_FIXTURE_V1'
    || (item.product !== 'SPOT' && item.product !== 'USD_M_PERPETUAL')
    || (item.side !== 'BUY' && item.side !== 'SELL')
    || (item.orderType !== 'LIMIT' && item.orderType !== 'MARKET')
    || !['GTC', 'IOC', 'FOK', null].includes(item.timeInForce as string | null)
    || (item.queueTruth !== 'ESTIMATED' && item.queueTruth !== 'UNKNOWN')
    || item.simulationAuthority !== 'SYNTHETIC_FIXTURE'
    || item.actionAuthority !== 'NONE_RECORD_ONLY'
    || item.externalActionAuthorization !== 'NONE') {
    throw new TypeError('twin fixture vocabulary/authority is invalid');
  }
  if (typeof item.symbol !== 'string' || !SYMBOL.test(item.symbol)) throw new TypeError('twin fixture symbol is invalid');
  const price = item.price === null ? null : twinPositiveDecimal(item.price, 'fixture price');
  const quantity = twinPositiveDecimal(item.quantity, 'fixture quantity');
  if ((item.orderType === 'LIMIT') !== (price !== null)) throw new TypeError('LIMIT requires price and MARKET forbids it');
  if ((item.orderType === 'MARKET') !== (item.timeInForce === null)) {
    throw new TypeError('MARKET requires null TIF and LIMIT requires GTC, IOC or FOK');
  }
  const latency = record(item.latency, ['dispatchToVenueMs', 'venueToHttpMs', 'venueToPrivateMs'], 'latency profile');
  const queueAheadQuantity = item.queueAheadQuantity === null
    ? null
    : twinDecimal(item.queueAheadQuantity, 'queue-ahead quantity');
  if ((item.queueTruth === 'ESTIMATED') !== (queueAheadQuantity !== null)) {
    throw new TypeError('estimated queue truth requires an injected queue-ahead quantity');
  }
  const l06Boundary = validateL06Boundary(item.l06Boundary);
  const l06Snapshot = evaluateExchangeTwinMutationSnapshot(snapshot(item.l06Snapshot));
  if (l06Snapshot.mutationId !== l06Boundary.mutationId
    || l06Snapshot.outcomeRevision !== l06Boundary.outcomeRevision
    || l06Snapshot.headDigest !== l06Boundary.journalHeadDigest
    || l06Snapshot.journalVersion !== l06Boundary.journalVersion
    || l06Snapshot.identity.mutationKind !== 'PLACE_ORDER'
    || l06Snapshot.identity.product !== item.product
    || l06Snapshot.identity.symbol !== item.symbol
    || l06Snapshot.requestedQuantity !== quantity
    || l06Snapshot.bindings.instrumentRevision !== item.instrumentRevision
    || l06Snapshot.bindings.sourceEvidenceRevision !== item.sourceEvidenceRevision) {
    throw new TypeError('L06 mutation snapshot/boundary does not bind the placement fixture');
  }
  if (typeof item.rateOwnerEvidenceSha256 !== 'string' || !SHA256.test(item.rateOwnerEvidenceSha256)) {
    throw new TypeError('L03 owner evidence SHA-256 is invalid');
  }
  return deepFreeze({
    schema: 'TWIN_ORDER_FIXTURE_V1' as const,
    fixtureId: identifier(item.fixtureId, 'fixture ID'),
    l06Snapshot,
    l06Boundary,
    product: item.product,
    symbol: item.symbol,
    baseAsset: asset(item.baseAsset, 'base asset'),
    quoteAsset: asset(item.quoteAsset, 'quote asset'),
    side: item.side,
    orderType: item.orderType,
    timeInForce: item.timeInForce,
    price,
    quantity,
    instrumentRevision: identifier(item.instrumentRevision, 'instrument revision'),
    sourceEvidenceRevision: identifier(item.sourceEvidenceRevision, 'source evidence revision'),
    rateOwnerEvidenceSha256: item.rateOwnerEvidenceSha256,
    latency: {
      dispatchToVenueMs: safeInteger(latency.dispatchToVenueMs, 'dispatch latency', 0, 60_000),
      venueToHttpMs: safeInteger(latency.venueToHttpMs, 'HTTP latency', 0, 60_000),
      venueToPrivateMs: safeInteger(latency.venueToPrivateMs, 'private latency', 0, 60_000),
    },
    queueAheadQuantity,
    queueTruth: item.queueTruth,
    simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  }) as Readonly<TwinOrderFixture>;
}

function validateCancelFixture(
  value: unknown,
  target: Readonly<TwinOrderFixture>,
): Readonly<TwinCancelFixture> {
  const item = record(value, [
    'schema', 'cancelFixtureId', 'targetFixtureId', 'l06Snapshot', 'l06Boundary',
    'rateOwnerEvidenceSha256', 'dispatchToVenueMs', 'venueToLocalMs',
    'simulationAuthority', 'actionAuthority', 'externalActionAuthorization',
  ], 'cancel fixture');
  if (item.schema !== 'TWIN_CANCEL_FIXTURE_V1'
    || item.targetFixtureId !== target.fixtureId
    || item.simulationAuthority !== 'SYNTHETIC_FIXTURE'
    || item.actionAuthority !== 'NONE_RECORD_ONLY'
    || item.externalActionAuthorization !== 'NONE'
    || typeof item.rateOwnerEvidenceSha256 !== 'string'
    || !SHA256.test(item.rateOwnerEvidenceSha256)) {
    throw new TypeError('cancel fixture identity/authority is invalid');
  }
  const l06Boundary = validateL06Boundary(item.l06Boundary);
  const l06Snapshot = evaluateExchangeTwinMutationSnapshot(snapshot(item.l06Snapshot));
  if (l06Snapshot.mutationId !== l06Boundary.mutationId
    || l06Snapshot.outcomeRevision !== l06Boundary.outcomeRevision
    || l06Snapshot.headDigest !== l06Boundary.journalHeadDigest
    || l06Snapshot.journalVersion !== l06Boundary.journalVersion
    || l06Snapshot.identity.mutationKind !== 'CANCEL_ORDER'
    || l06Snapshot.identity.product !== target.product
    || l06Snapshot.identity.symbol !== target.symbol
    || l06Snapshot.identity.accountRealmId !== target.l06Snapshot.identity.accountRealmId
    || l06Snapshot.identity.clientOrderId !== target.l06Snapshot.identity.clientOrderId) {
    throw new TypeError('L06 cancel snapshot/boundary does not bind the target fixture');
  }
  return deepFreeze({
    schema: 'TWIN_CANCEL_FIXTURE_V1' as const,
    cancelFixtureId: identifier(item.cancelFixtureId, 'cancel fixture ID'),
    targetFixtureId: target.fixtureId,
    l06Snapshot,
    l06Boundary,
    rateOwnerEvidenceSha256: item.rateOwnerEvidenceSha256,
    dispatchToVenueMs: safeInteger(item.dispatchToVenueMs, 'cancel venue latency', 0, 60_000),
    venueToLocalMs: safeInteger(item.venueToLocalMs, 'cancel local latency', 0, 60_000),
    simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  });
}

function validateLevels(value: unknown, side: 'BIDS' | 'ASKS'): readonly Readonly<TwinBookLevel>[] {
  if (!Array.isArray(value) || value.length > MAX_LEVELS) throw new RangeError('book levels are overbound');
  const levels = value.map((level, index) => {
    const item = record(level, ['price', 'quantity'], `book level ${index}`);
    return { price: twinPositiveDecimal(item.price, 'book price'), quantity: twinDecimal(item.quantity, 'book quantity') };
  });
  const prices = new Set<string>();
  for (let index = 0; index < levels.length; index += 1) {
    if (prices.has(levels[index].price)) throw new TypeError('book levels contain duplicate price');
    prices.add(levels[index].price);
    if (index > 0) {
      const comparison = compareTwinDecimals(levels[index - 1].price, levels[index].price);
      if ((side === 'BIDS' && comparison <= 0) || (side === 'ASKS' && comparison >= 0)) {
        throw new TypeError('book levels are not side-correct sorted');
      }
    }
  }
  return deepFreeze(levels);
}

function canonicalBook(product: TwinScenarioState['product'], symbol: string, payload: Record<string, unknown>): TwinBookState {
  const bids = validateLevels(payload.bids, 'BIDS');
  const asks = validateLevels(payload.asks, 'ASKS');
  if (bids.length > 0 && asks.length > 0 && compareTwinDecimals(bids[0].price, asks[0].price) >= 0) {
    throw new TypeError('exchange-twin book is crossed');
  }
  const observedAtMs = safeInteger(payload.observedAtMs, 'book observation time');
  const validUntilMs = safeInteger(payload.validUntilMs, 'book validity time');
  if (validUntilMs <= observedAtMs) throw new TypeError('book validity interval is invalid');
  return deepFreeze({
    truth: 'AVAILABLE' as const,
    product,
    symbol,
    bookRevision: identifier(payload.bookRevision, 'book revision'),
    sourceSequence: safeInteger(payload.sourceSequence, 'book source sequence', 1, Number.MAX_SAFE_INTEGER),
    observedAtMs,
    validUntilMs,
    bids,
    asks,
  });
}

function eventContent(event: TwinEvent): string {
  return digest('l07event_', event);
}

export function deriveTwinEventId(value: unknown): string {
  const projection = record(value, EVENT_IDENTITY_FIELDS, 'twin event identity projection');
  if (projection.schema !== 'TWIN_EVENT_V1'
    || typeof projection.kind !== 'string'
    || !Object.hasOwn(EVENT_PRIORITY, projection.kind)) {
    throw new TypeError('twin event identity schema/kind is invalid');
  }
  record(projection.payload, EVENT_PAYLOAD_FIELDS[projection.kind as TwinEvent['kind']], 'twin event payload');
  return digest('l07event_', projection);
}

function validateEvent(value: unknown, state: Readonly<TwinScenarioState>): Readonly<TwinEvent> {
  const event = record(value, EVENT_FIELDS, 'twin event');
  if (event.schema !== 'TWIN_EVENT_V1'
    || typeof event.kind !== 'string'
    || !Object.hasOwn(EVENT_PRIORITY, event.kind)) {
    throw new TypeError('twin event schema/kind is invalid');
  }
  const sourceSequence = event.sourceSequence === null
    ? null
    : safeInteger(event.sourceSequence, 'event source sequence', 1, Number.MAX_SAFE_INTEGER);
  const payload = record(event.payload, EVENT_PAYLOAD_FIELDS[event.kind as TwinEvent['kind']], 'twin event payload');
  const normalized = deepFreeze({
    schema: 'TWIN_EVENT_V1' as const,
    eventId: identifier(event.eventId, 'event ID'),
    sequence: safeInteger(event.sequence, 'event sequence', 1, Number.MAX_SAFE_INTEGER),
    sourceSequence,
    occurredAtMs: safeInteger(event.occurredAtMs, 'event occurrence time'),
    kind: event.kind,
    payload,
  }) as unknown as TwinEvent;
  const normalizedPayload = normalized.payload as Record<string, unknown>;
  const product = normalizedPayload.product;
  const symbol = normalizedPayload.symbol;
  if (product !== undefined && product !== state.product) throw new TypeError('event crosses scenario product');
  if (symbol !== undefined && symbol !== state.symbol) throw new TypeError('event crosses scenario symbol');
  const {
    eventId: suppliedEventId,
    ...identityProjection
  } = normalized;
  if (suppliedEventId !== deriveTwinEventId(identityProjection)) {
    throw new TypeError('event ID is not an exact content commitment');
  }
  return normalized;
}

function orderIndex(state: Readonly<TwinScenarioState>, fixtureId: unknown): number {
  const id = identifier(fixtureId, 'fixture ID');
  const index = state.orders.findIndex((order) => order.fixture.fixtureId === id);
  if (index < 0) throw new TypeError('event fixture is not part of the scenario');
  return index;
}

function eventOrderingDomain(
  event: Readonly<TwinEvent>,
  state: Readonly<TwinScenarioState>,
): string {
  const payload = event.payload as Record<string, unknown>;
  if (event.kind === 'SYMBOL_STATUS'
    || event.kind === 'BOOK_SNAPSHOT'
    || event.kind === 'BOOK_DELTA'
    || event.kind === 'BOOK_UNAVAILABLE'
    || event.kind === 'TRADE_EVIDENCE') {
    return `MARKET:${String(payload.product)}:${String(payload.symbol)}`;
  }
  if (event.kind === 'VENUE_ARRIVAL') return `VENUE:${state.product}:${state.symbol}`;
  if (event.kind === 'CRASH' || event.kind === 'RESTART') return 'SCENARIO';
  return `FIXTURE:${String(payload.fixtureId)}`;
}

function replaceOrder(state: Readonly<TwinScenarioState>, index: number, order: Readonly<TwinOrderState>): TwinScenarioState {
  const orders = state.orders.map((item, current) => current === index ? order : item);
  return { ...state, orders } as TwinScenarioState;
}

function initialOrder(fixture: Readonly<TwinOrderFixture>): Readonly<TwinOrderState> {
  return deepFreeze({
    fixture,
    venueStatus: 'NOT_ARRIVED' as const,
    localTruth: 'NOT_DISPATCHED' as const,
    localObservedVenueStatus: null,
    filledQuantity: '0',
    remainingQuantity: fixture.quantity,
    expiredQuantity: '0',
    vwap: null,
    spreadDepthImpactQuote: null,
    latencyMovementQuote: null,
    latencyMovementEvidenceRevision: null,
    adverseSelectionQuote: null,
    adverseSelectionEvidenceRevision: null,
    queueAheadRemaining: fixture.queueAheadQuantity,
    fills: Object.freeze([]),
    dispatchAtMs: null,
    venueArrivalAtMs: null,
    lastVenueEffectAtMs: null,
    lastLocalObservationAtMs: null,
    cancelFixture: null,
    cancelDispatchAtMs: null,
    cancelArrivalAtMs: null,
    recoveryRequired: false,
    blockedReasonCodes: Object.freeze([]),
    venueRevision: digest('l07venue_', { fixtureId: fixture.fixtureId, state: 'NOT_ARRIVED' }),
  });
}

function finalizeState(
  value: Omit<TwinScenarioState, 'outcomeRevision' | 'stateRevision'> | TwinScenarioState,
): Readonly<TwinScenarioState> {
  const {
    outcomeRevision: _priorOutcomeRevision,
    stateRevision: _priorStateRevision,
    ...material
  } = value as TwinScenarioState;
  const semantic = {
    scenarioId: material.scenarioId,
    modelRevision: material.modelRevision,
    seed: material.seed,
    product: material.product,
    symbol: material.symbol,
    symbolStatus: material.symbolStatus,
    symbolStatusRevision: material.symbolStatusRevision,
    symbolStatusObservedAtMs: material.symbolStatusObservedAtMs,
    symbolStatusValidUntilMs: material.symbolStatusValidUntilMs,
    book: material.book,
    orders: material.orders,
    crashed: material.crashed,
    activeCrashId: material.activeCrashId,
    orderingTruth: material.orderingTruth,
    ambiguousDomains: material.ambiguousDomains,
  };
  const outcomeRevision = digest('l07outcome_', semantic);
  const stateRevision = digest('l07state_', { ...material, outcomeRevision });
  return deepFreeze({ ...material, outcomeRevision, stateRevision });
}

export function createExchangeTwinState(inputValue: unknown): Readonly<TwinScenarioState> {
  const input = record(inputValue, [
    'schema', 'scenarioId', 'modelRevision', 'seed', 'product', 'symbol', 'fixtures', 'events',
  ], 'twin scenario input');
  if (input.schema !== 'TWIN_SCENARIO_INPUT_V1'
    || (input.product !== 'SPOT' && input.product !== 'USD_M_PERPETUAL')
    || typeof input.symbol !== 'string' || !SYMBOL.test(input.symbol)) {
    throw new TypeError('twin scenario identity is invalid');
  }
  if (!Array.isArray(input.fixtures) || input.fixtures.length > MAX_FIXTURES
    || !Array.isArray(input.events) || input.events.length > MAX_EVENTS) {
    throw new RangeError('twin scenario fixtures/events are overbound');
  }
  const fixtures = input.fixtures.map(validateFixture)
    .sort((left, right) => stableTextCompare(left.fixtureId, right.fixtureId));
  if (new Set(fixtures.map((fixture) => fixture.fixtureId)).size !== fixtures.length) {
    throw new TypeError('twin fixture identities are duplicated');
  }
  if (fixtures.some((fixture) => fixture.product !== input.product || fixture.symbol !== input.symbol)) {
    throw new TypeError('twin fixture crosses scenario scope');
  }
  if (fixtures.some((fixture) => fixture.baseAsset === fixture.quoteAsset)
    || fixtures.some((fixture) => fixture.baseAsset !== fixtures[0]?.baseAsset
      || fixture.quoteAsset !== fixtures[0]?.quoteAsset)) {
    throw new TypeError('twin fixtures disagree on scenario asset identity');
  }
  return finalizeState({
    schema: EXCHANGE_TWIN_SCHEMA,
    scenarioId: identifier(input.scenarioId, 'scenario ID'),
    modelRevision: identifier(input.modelRevision, 'model revision'),
    seed: identifier(input.seed, 'scenario seed'),
    product: input.product,
    symbol: input.symbol,
    symbolStatus: 'UNKNOWN',
    symbolStatusRevision: null,
    symbolStatusObservedAtMs: null,
    symbolStatusValidUntilMs: null,
    book: deepFreeze({
      truth: 'UNAVAILABLE', product: input.product, symbol: input.symbol,
      bookRevision: null, sourceSequence: null, observedAtMs: null, validUntilMs: null,
      bids: [], asks: [],
    }),
    orders: fixtures.map(initialOrder),
    preflights: [],
    rateDecisions: [],
    processedEvents: [],
    crashed: false,
    activeCrashId: null,
    dropLocalDeliveries: false,
    dropPendingCommands: false,
    orderingTruth: 'PROVED',
    ambiguousDomains: [],
    simulationAuthority: 'SYNTHETIC_FIXTURE',
    actionAuthority: 'NONE_RECORD_ONLY',
    externalActionAuthorization: 'NONE',
  });
}

function preflightPass(
  state: Readonly<TwinScenarioState>,
  fixture: TwinOrderFixture,
  evaluatedAtMs: number,
): boolean {
  const evidence = [...state.preflights].reverse()
    .find((entry) => entry.fixtureId === fixture.fixtureId);
  const result = evidence?.result;
  const request = evidence?.sizingRequest as Readonly<Record<string, unknown>> | undefined;
  const instrument = evidence?.registrySnapshot.instruments.find((candidate) => (
    candidate.symbol === fixture.symbol
    && candidate.instrumentRevision === fixture.instrumentRevision
  ));
  return result !== undefined
    && request !== undefined
    && instrument !== undefined
    && instrument.product === fixture.product
    && instrument.baseAsset === fixture.baseAsset
    && instrument.quoteAsset === fixture.quoteAsset
    && instrument.sourceEvidenceRevision === fixture.sourceEvidenceRevision
    && request.symbol === fixture.symbol
    && request.instrumentRevision === fixture.instrumentRevision
    && request.side === fixture.side
    && request.orderType === fixture.orderType
    && request.timeInForce === fixture.timeInForce
    && request.requestedPrice === fixture.price
    && request.requestedQuantity === fixture.quantity
    && request.notionalAsset === fixture.quoteAsset
    && result.schema === 'BINANCE_STATIC_FILTER_PREFLIGHT_V1'
    && result.staticState === 'PASS'
    && result.reasonCodes.length === 0
    && result.instrumentRevision === fixture.instrumentRevision
    && result.sourceEvidenceRevision === fixture.sourceEvidenceRevision
    && result.evaluatedAtMs !== null
    && result.instrumentValidUntilMs !== null
    && result.evaluatedAtMs === evaluatedAtMs
    && evaluatedAtMs < result.instrumentValidUntilMs
    && (result.referenceValidUntilMs === null || evaluatedAtMs < result.referenceValidUntilMs)
    && result.notionalAsset === fixture.quoteAsset
    && result.requestedPrice === fixture.price
    && result.validationPrice !== null
    && result.requestedQuantity === fixture.quantity
    && result.resultQuantity === fixture.quantity
    && result.resultNotional !== null
    && result.resultNotional === multiplyTwinDecimals(result.validationPrice, fixture.quantity)
    && result.effectiveNotionalCeiling !== null
    && result.canaryMaximumNotional === '10'
    && compareTwinDecimals(result.resultNotional, result.effectiveNotionalCeiling) <= 0
    && compareTwinDecimals(result.resultNotional, result.canaryMaximumNotional) <= 0
    && result.transformations.length === 0
    && result.sendEligible === false
    && result.documentaryAuthority === 'DOCUMENTARY_EVIDENCE_ONLY'
    && result.actionAuthority === 'NONE_RECORD_ONLY'
    && result.externalActionAuthorization === 'NONE';
}

function ratePass(state: Readonly<TwinScenarioState>, fixture: TwinOrderFixture): boolean {
  const evidence = [...state.rateDecisions]
    .reverse()
    .find((entry) => entry.fixtureId === fixture.fixtureId);
  return evidence !== undefined
    && evidence.ownerEvidenceSha256 === fixture.rateOwnerEvidenceSha256
    && evidence.decision.allowed
    && evidence.decision.reason === 'RESERVED';
}

function validateFeeEvidence(value: unknown, nowMs: number): Readonly<TwinFeeEvidence> | null {
  if (value === null) return null;
  const fee = record(value, [
    'schema', 'evidenceRevision', 'makerRate', 'takerRate', 'feeAsset', 'chargeBasis', 'rateUnit',
    'quoteConversionRate', 'observedAtMs', 'validUntilMs',
  ], 'fee evidence') as unknown as TwinFeeEvidence;
  const observedAtMs = safeInteger(fee.observedAtMs, 'fee observation time');
  const validUntilMs = safeInteger(fee.validUntilMs, 'fee validity time');
  if (fee.schema !== 'TWIN_FEE_EVIDENCE_V1'
    || nowMs < observedAtMs
    || nowMs >= validUntilMs
    || validUntilMs <= observedAtMs
    || (fee.chargeBasis !== 'QUOTE_NOTIONAL' && fee.chargeBasis !== 'BASE_QUANTITY')
    || (fee.chargeBasis === 'QUOTE_NOTIONAL'
      && fee.rateUnit !== 'FEE_ASSET_PER_QUOTE_NOTIONAL')
    || (fee.chargeBasis === 'BASE_QUANTITY'
      && fee.rateUnit !== 'FEE_ASSET_PER_BASE_QUANTITY')) {
    throw new TypeError('fee evidence is invalid or expired');
  }
  identifier(fee.evidenceRevision, 'fee evidence revision');
  asset(fee.feeAsset, 'fee asset');
  twinDecimal(fee.makerRate, 'maker rate');
  twinDecimal(fee.takerRate, 'taker rate');
  if (fee.quoteConversionRate !== null) {
    twinPositiveDecimal(fee.quoteConversionRate, 'fee quote conversion rate');
  }
  return deepFreeze(fee);
}

function validateFeeEvidenceForAssets(
  value: unknown,
  nowMs: number,
  baseAsset: string,
  quoteAsset: string,
): Readonly<TwinFeeEvidence> | null {
  const fee = validateFeeEvidence(value, nowMs);
  if (fee === null) return null;
  asset(baseAsset, 'fee basis base asset');
  asset(quoteAsset, 'fee basis quote asset');
  return fee;
}

function feeFor(
  feeValue: unknown,
  fillQuantity: string,
  quoteNotional: string,
  role: 'MAKER' | 'TAKER',
  nowMs: number,
  baseAsset: string,
  quoteAsset: string,
): Pick<TwinFill, 'feeEvidenceRevision' | 'feeAmount' | 'feeAsset' | 'quoteEquivalentFee'> {
  const fee = validateFeeEvidenceForAssets(feeValue, nowMs, baseAsset, quoteAsset);
  if (fee === null) return {
    feeEvidenceRevision: null, feeAmount: null, feeAsset: null, quoteEquivalentFee: null,
  };
  const rate = role === 'MAKER' ? twinDecimal(fee.makerRate, 'maker rate') : twinDecimal(fee.takerRate, 'taker rate');
  const basis = fee.chargeBasis === 'QUOTE_NOTIONAL' ? quoteNotional : fillQuantity;
  const amount = multiplyTwinDecimals(basis, rate);
  const normalizedFeeAsset = asset(fee.feeAsset, 'fee asset');
  const quoteEquivalentFee = normalizedFeeAsset === quoteAsset
    ? amount
    : fee.quoteConversionRate === null ? null : multiplyTwinDecimals(amount, fee.quoteConversionRate);
  return {
    feeEvidenceRevision: identifier(fee.evidenceRevision, 'fee evidence revision'),
    feeAmount: amount,
    feeAsset: normalizedFeeAsset,
    quoteEquivalentFee,
  };
}

function executeAggressive(
  state: Readonly<TwinScenarioState>,
  order: Readonly<TwinOrderState>,
  event: Readonly<TwinEvent>,
): { readonly order: Readonly<TwinOrderState>; readonly book: Readonly<TwinBookState> } {
  const fixture = order.fixture;
  const orderingBlocked = state.ambiguousDomains.includes(`MARKET:${state.product}:${state.symbol}`)
    || state.ambiguousDomains.includes(`VENUE:${state.product}:${state.symbol}`)
    || state.ambiguousDomains.includes(`FIXTURE:${fixture.fixtureId}`);
  const statusFresh = state.symbolStatusObservedAtMs !== null
    && state.symbolStatusValidUntilMs !== null
    && state.symbolStatusObservedAtMs <= event.occurredAtMs
    && event.occurredAtMs < state.symbolStatusValidUntilMs;
  const bookFresh = state.book.observedAtMs !== null
    && state.book.validUntilMs !== null
    && state.book.observedAtMs <= event.occurredAtMs
    && event.occurredAtMs < state.book.validUntilMs;
  if (state.symbolStatus !== 'TRADING' || state.book.truth !== 'AVAILABLE'
    || !statusFresh || !bookFresh
    || orderingBlocked
    || !preflightPass(state, fixture, event.occurredAtMs) || !ratePass(state, fixture)) {
    const reasons = [
      ...(state.symbolStatus !== 'TRADING' ? [`SYMBOL_${state.symbolStatus}`] : []),
      ...(state.book.truth !== 'AVAILABLE' ? [`BOOK_${state.book.truth}`] : []),
      ...(!statusFresh ? ['SYMBOL_STATUS_STALE'] : []),
      ...(!bookFresh ? ['BOOK_STALE'] : []),
      ...(orderingBlocked ? ['EVENT_ORDER_AMBIGUOUS'] : []),
      ...(!preflightPass(state, fixture, event.occurredAtMs) ? ['PREFLIGHT_NOT_EXACT'] : []),
      ...(!ratePass(state, fixture) ? ['RATE_NOT_RESERVED'] : []),
    ].sort();
    const blocked = deepFreeze({
      ...order, venueStatus: 'BLOCKED' as const, venueArrivalAtMs: event.occurredAtMs,
      lastVenueEffectAtMs: event.occurredAtMs, recoveryRequired: false,
      blockedReasonCodes: reasons,
      venueRevision: digest('l07venue_', { prior: order.venueRevision, eventId: event.eventId, reasons }),
    });
    return { order: blocked, book: state.book };
  }
  const levels = fixture.side === 'BUY' ? state.book.asks : state.book.bids;
  const eligible = levels.filter((level) => fixture.price === null
    || (fixture.side === 'BUY'
      ? compareTwinDecimals(level.price, fixture.price) <= 0
      : compareTwinDecimals(level.price, fixture.price) >= 0));
  const available = eligible.reduce((sum, level) => addTwinDecimals(sum, level.quantity), '0');
  if (fixture.timeInForce === 'FOK' && compareTwinDecimals(available, fixture.quantity) < 0) {
    const expired = deepFreeze({
      ...order, venueStatus: 'EXPIRED' as const, venueArrivalAtMs: event.occurredAtMs,
      lastVenueEffectAtMs: event.occurredAtMs, expiredQuantity: fixture.quantity,
      remainingQuantity: '0',
      venueRevision: digest('l07venue_', { prior: order.venueRevision, eventId: event.eventId, status: 'FOK_EXPIRED' }),
    });
    return { order: expired, book: state.book };
  }
  let remaining = fixture.quantity;
  const fills: TwinFill[] = [...order.fills];
  const consumed = new Map<string, string>();
  for (const level of eligible) {
    if (remaining === '0') break;
    const quantity = minimumTwinDecimal(remaining, level.quantity);
    if (quantity === '0') continue;
    const quoteNotional = multiplyTwinDecimals(quantity, level.price);
    const fee = feeFor(
      (event.payload as { feeEvidence: unknown }).feeEvidence,
      quantity,
      quoteNotional,
      'TAKER',
      event.occurredAtMs,
      fixture.baseAsset,
      fixture.quoteAsset,
    );
    fills.push(deepFreeze({
      fillId: digest('l07fill_', { fixtureId: fixture.fixtureId, eventId: event.eventId, level: level.price }),
      fixtureId: fixture.fixtureId,
      eventId: event.eventId,
      bookRevision: state.book.bookRevision,
      price: level.price,
      quantity,
      quoteNotional,
      liquidityRole: 'TAKER' as const,
      ...fee,
      occurredAtMs: event.occurredAtMs,
    }));
    consumed.set(level.price, quantity);
    remaining = subtractTwinDecimals(remaining, quantity);
  }
  if (fills.length > MAX_FILLS) throw new RangeError('exchange-twin fill bound exceeded');
  const updateLevels = (source: readonly TwinBookLevel[]): readonly TwinBookLevel[] => source
    .map((level) => consumed.has(level.price)
      ? { ...level, quantity: subtractTwinDecimals(level.quantity, consumed.get(level.price)!) }
      : level)
    .filter((level) => level.quantity !== '0');
  const book = deepFreeze({
    ...state.book,
    bids: fixture.side === 'SELL' ? updateLevels(state.book.bids) : state.book.bids,
    asks: fixture.side === 'BUY' ? updateLevels(state.book.asks) : state.book.asks,
  });
  const filledQuantity = subtractTwinDecimals(fixture.quantity, remaining);
  const terminalOnRemainder = fixture.timeInForce === 'IOC' || fixture.timeInForce === 'FOK'
    || fixture.orderType === 'MARKET';
  const venueStatus: TwinVenueStatus = remaining === '0' ? 'FILLED'
    : terminalOnRemainder ? 'EXPIRED'
      : filledQuantity === '0' ? 'NEW' : 'PARTIALLY_FILLED';
  const totalNotional = fills.reduce((sum, fill) => addTwinDecimals(sum, fill.quoteNotional), '0');
  const vwap = filledQuantity === '0' ? null : deepFreeze({
    numeratorQuoteNotional: totalNotional,
    denominatorBaseQuantity: filledQuantity,
    decimalScale24: divideTwinDecimals(totalNotional, filledQuantity),
    decimalPolicy: 'TRUNCATED_SCALE_24' as const,
  });
  const bestPrice = eligible[0]?.price ?? null;
  const spreadDepthImpactQuote = filledQuantity === '0' || bestPrice === null ? null
    : fixture.side === 'BUY'
      ? subtractTwinDecimals(totalNotional, multiplyTwinDecimals(filledQuantity, bestPrice))
      : subtractTwinDecimals(multiplyTwinDecimals(filledQuantity, bestPrice), totalNotional);
  const nextOrder = deepFreeze({
    ...order,
    venueStatus,
    filledQuantity,
    remainingQuantity: terminalOnRemainder ? '0' : remaining,
    expiredQuantity: terminalOnRemainder ? remaining : '0',
    vwap,
    spreadDepthImpactQuote,
    fills,
    venueArrivalAtMs: event.occurredAtMs,
    lastVenueEffectAtMs: event.occurredAtMs,
    venueRevision: digest('l07venue_', { prior: order.venueRevision, eventId: event.eventId, venueStatus, fills }),
  });
  return { order: nextOrder, book };
}

function updateBookWithDelta(state: Readonly<TwinScenarioState>, payload: Record<string, unknown>): TwinBookState {
  const sourceSequence = safeInteger(payload.sourceSequence, 'book delta source sequence', 1, Number.MAX_SAFE_INTEGER);
  const bookRevision = identifier(payload.bookRevision, 'book delta revision');
  const previousBookRevision = identifier(payload.previousBookRevision, 'previous book revision');
  const observedAtMs = safeInteger(payload.observedAtMs, 'book delta observation time');
  const validUntilMs = safeInteger(payload.validUntilMs, 'book delta validity time');
  if (validUntilMs <= observedAtMs) throw new TypeError('book delta validity interval is invalid');
  validateLevels(payload.bidUpdates, 'BIDS');
  validateLevels(payload.askUpdates, 'ASKS');
  if (bookRevision === previousBookRevision || bookRevision === state.book.bookRevision) {
    throw new TypeError('book delta revision must advance');
  }
  if (state.book.truth !== 'AVAILABLE'
    || previousBookRevision !== state.book.bookRevision
    || sourceSequence !== (state.book.sourceSequence ?? 0) + 1) {
    return deepFreeze({
      ...state.book,
      truth: 'GAPPED',
      sourceSequence: Math.max(state.book.sourceSequence ?? 0, sourceSequence),
      observedAtMs,
      validUntilMs,
      bids: [],
      asks: [],
    });
  }
  const apply = (prior: readonly TwinBookLevel[], updatesValue: unknown, side: 'BIDS' | 'ASKS'): readonly TwinBookLevel[] => {
    const updates = validateLevels(updatesValue, side);
    const byPrice = new Map(prior.map((level) => [level.price, level.quantity]));
    for (const update of updates) {
      if (update.quantity === '0') byPrice.delete(update.price);
      else byPrice.set(update.price, update.quantity);
    }
    return [...byPrice.entries()]
      .map(([price, quantity]) => ({ price, quantity }))
      .sort((left, right) => side === 'BIDS'
        ? -compareTwinDecimals(left.price, right.price)
        : compareTwinDecimals(left.price, right.price));
  };
  return canonicalBook(state.product, state.symbol, {
    bookRevision,
    sourceSequence,
    observedAtMs,
    validUntilMs,
    bids: apply(state.book.bids, payload.bidUpdates, 'BIDS'),
    asks: apply(state.book.asks, payload.askUpdates, 'ASKS'),
  });
}

function reduceCanonical(
  stateValue: Readonly<TwinScenarioState>,
  eventValue: unknown,
  allowClosedSetAmbiguity = false,
  eventAmbiguous = false,
): Readonly<TwinScenarioState> {
  const event = validateEvent(eventValue, stateValue);
  const contentRevision = eventContent(event);
  const duplicate = stateValue.processedEvents.find((item) => item.eventId === event.eventId);
  if (duplicate !== undefined) {
    if (duplicate.contentRevision !== contentRevision) throw new TypeError('event ID content conflict');
    return stateValue;
  }
  if (stateValue.processedEvents.some((item) => item.sequence === event.sequence)) {
    throw new TypeError('event sequence is duplicated');
  }
  if (stateValue.processedEvents.length >= MAX_EVENTS) {
    throw new RangeError('exchange-twin processed event bound exceeded');
  }
  const orderingCompare = (left: {
    occurredAtMs: number; eventPriority: number; sourceSequence: number | null;
    sequence: number; eventId: string;
  }, right: {
    occurredAtMs: number; eventPriority: number; sourceSequence: number | null;
    sequence: number; eventId: string;
  }): number => left.occurredAtMs - right.occurredAtMs
    || left.eventPriority - right.eventPriority
    || (left.sourceSequence ?? Number.MAX_SAFE_INTEGER) - (right.sourceSequence ?? Number.MAX_SAFE_INTEGER)
    || left.sequence - right.sequence
    || stableTextCompare(left.eventId, right.eventId);
  const candidateOrder = {
    occurredAtMs: event.occurredAtMs,
    eventPriority: EVENT_PRIORITY[event.kind],
    orderingDomain: eventOrderingDomain(event, stateValue),
    sourceSequence: event.sourceSequence,
    sequence: event.sequence,
    eventId: event.eventId,
  };
  const lastApplied = [...stateValue.processedEvents].sort(orderingCompare).at(-1);
  if (lastApplied !== undefined && orderingCompare(candidateOrder, lastApplied) < 0) {
    throw new TypeError('event time/order regression is forbidden');
  }
  if (lastApplied !== undefined
    && candidateOrder.occurredAtMs === lastApplied.occurredAtMs
    && candidateOrder.eventPriority === lastApplied.eventPriority
    && candidateOrder.orderingDomain === lastApplied.orderingDomain
    && candidateOrder.sourceSequence === null
    && lastApplied.sourceSequence === null
    && !allowClosedSetAmbiguity) {
    throw new TypeError('incremental equal-time event ordering is ambiguous; use a closed scenario set');
  }
  let state: TwinScenarioState = { ...stateValue };
  const payload = event.payload as Record<string, unknown>;
  if (event.kind === 'SYMBOL_STATUS') {
    if (!['TRADING', 'CANCEL_ONLY', 'HALT', 'BREAK', 'END_OF_DAY', 'UNKNOWN'].includes(payload.status as string)) {
      throw new TypeError('symbol status is invalid');
    }
    const observedAtMs = safeInteger(payload.observedAtMs, 'status observation time');
    const validUntilMs = safeInteger(payload.validUntilMs, 'status validity time');
    if (event.occurredAtMs !== observedAtMs || validUntilMs <= observedAtMs) {
      throw new TypeError('symbol status time binding is invalid');
    }
    const statusRevision = identifier(payload.evidenceRevision, 'status revision');
    if (statusRevision === state.symbolStatusRevision) {
      throw new TypeError('symbol status revision is replayed under a new event');
    }
    state = {
      ...state,
      symbolStatus: eventAmbiguous ? 'UNKNOWN' : payload.status as TwinSymbolStatus,
      symbolStatusRevision: statusRevision,
      symbolStatusObservedAtMs: observedAtMs,
      symbolStatusValidUntilMs: validUntilMs,
    };
  } else if (event.kind === 'BOOK_SNAPSHOT') {
    if (event.sourceSequence !== payload.sourceSequence
      || (state.book.sourceSequence !== null
        && safeInteger(payload.sourceSequence, 'book source sequence', 1, Number.MAX_SAFE_INTEGER)
          <= state.book.sourceSequence)
      || payload.bookRevision === state.book.bookRevision) {
      throw new TypeError('book snapshot is regressed, replayed or envelope-unbound');
    }
    if (event.occurredAtMs !== payload.observedAtMs) {
      throw new TypeError('book snapshot time is envelope-unbound');
    }
    const nextBook = canonicalBook(state.product, state.symbol, payload);
    state = { ...state, book: eventAmbiguous
      ? deepFreeze({ ...nextBook, truth: 'GAPPED' as const, bids: [], asks: [] })
      : nextBook };
  } else if (event.kind === 'BOOK_DELTA') {
    if (event.sourceSequence !== payload.sourceSequence) {
      throw new TypeError('book delta source sequence is envelope-unbound');
    }
    if (event.occurredAtMs !== payload.observedAtMs) {
      throw new TypeError('book delta time is envelope-unbound');
    }
    const nextBook = updateBookWithDelta(state, payload);
    state = { ...state, book: eventAmbiguous
      ? deepFreeze({ ...nextBook, truth: 'GAPPED' as const, bids: [], asks: [] })
      : nextBook };
  } else if (event.kind === 'BOOK_UNAVAILABLE') {
    if (payload.state !== 'UNAVAILABLE' && payload.state !== 'GAPPED') throw new TypeError('book unavailability is invalid');
    identifier(payload.evidenceRevision, 'book unavailability revision');
    state = { ...state, book: deepFreeze({
      ...state.book, truth: payload.state, observedAtMs: event.occurredAtMs,
      validUntilMs: null, bids: [], asks: [],
    }) };
  } else if (event.kind === 'PREFLIGHT_EVIDENCE') {
    const index = orderIndex(state, payload.fixtureId);
    const registrySnapshot = deepFreeze(snapshot(payload.registrySnapshot)) as unknown as TwinScenarioState['preflights'][number]['registrySnapshot'];
    const sizingRequest = deepFreeze(snapshot(payload.sizingRequest)) as unknown as TwinScenarioState['preflights'][number]['sizingRequest'];
    const requestTime = (sizingRequest as { evaluatedAtMs?: unknown }).evaluatedAtMs;
    const result = evaluateExchangeTwinInstrumentPreflight(
      registrySnapshot,
      sizingRequest,
      requestTime,
    );
    state = { ...state, preflights: [...state.preflights, {
      fixtureId: state.orders[index].fixture.fixtureId,
      registrySnapshot,
      sizingRequest,
      result,
    }] };
  } else if (event.kind === 'RATE_DECISION') {
    const index = orderIndex(state, payload.fixtureId);
    const rateState = deepFreeze(snapshot(payload.rateState));
    const reservationInput = deepFreeze(snapshot(payload.reservationInput));
    const ownerEvidenceSha256 = payload.ownerEvidenceSha256;
    if (typeof ownerEvidenceSha256 !== 'string' || !SHA256.test(ownerEvidenceSha256)
      || ownerEvidenceSha256 !== exchangeTwinOwnerEvidenceSha256({ rateState, reservationInput })) {
      throw new TypeError('L03 owner evidence content commitment is invalid');
    }
    const decision = evaluateExchangeTwinRateReservation(
      rateState,
      reservationInput,
      event.occurredAtMs,
    );
    const fixture = state.orders[index].fixture;
    const expectedContractId = fixture.product === 'SPOT' ? 'SPOT_ORDER_POST' : 'USDM_ORDER_POST';
    if (decision.quote.contractId !== expectedContractId
      || decision.quote.product !== fixture.product
      || decision.quote.environment !== 'PRODUCTION'
      || decision.quote.matrixContentSha256 !== '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac') {
      throw new TypeError('L03 placement reservation does not bind the fixture/accepted matrix');
    }
    state = { ...state, rateDecisions: [...state.rateDecisions, {
      fixtureId: state.orders[index].fixture.fixtureId,
      ownerEvidenceSha256,
      decision: deepFreeze(decision),
    }] };
  } else if (event.kind === 'PLACE_DISPATCH') {
    const index = orderIndex(state, payload.fixtureId);
    const order = state.orders[index];
    if (!(state.crashed && state.dropPendingCommands)) {
      if (order.dispatchAtMs !== null) throw new TypeError('fixture dispatch is duplicated');
      if (event.occurredAtMs < order.fixture.l06Boundary.evaluatedAtMs) {
        throw new TypeError('placement dispatch precedes L06 synthetic boundary');
      }
      if (event.occurredAtMs >= order.fixture.l06Snapshot.bindings.validUntilMs) {
        throw new TypeError('placement dispatch uses expired L06 owner evidence');
      }
      state = replaceOrder(state, index, deepFreeze({
        ...order, localTruth: 'DISPATCHED', dispatchAtMs: event.occurredAtMs,
        recoveryRequired: false,
      }));
    }
  } else if (event.kind === 'VENUE_ARRIVAL') {
    const index = orderIndex(state, payload.fixtureId);
    const order = state.orders[index];
    if (order.dispatchAtMs === null || event.occurredAtMs !== order.dispatchAtMs + order.fixture.latency.dispatchToVenueMs) {
      throw new TypeError('venue arrival does not bind injected dispatch latency');
    }
    if (event.occurredAtMs >= order.fixture.l06Snapshot.bindings.validUntilMs) {
      throw new TypeError('venue arrival uses expired L06 owner evidence');
    }
    if (order.venueArrivalAtMs !== null) throw new TypeError('venue arrival is duplicated');
    validateFeeEvidenceForAssets(
      payload.feeEvidence,
      event.occurredAtMs,
      order.fixture.baseAsset,
      order.fixture.quoteAsset,
    );
    if (!order.blockedReasonCodes.includes('CRASH_DROPPED_PENDING_COMMAND')) {
      const preflightIndex = state.preflights
        .map((entry) => entry.fixtureId)
        .lastIndexOf(order.fixture.fixtureId);
      if (preflightIndex >= 0) {
        const ownerEvidence = state.preflights[preflightIndex];
        const result = evaluateExchangeTwinInstrumentPreflight(
          ownerEvidence.registrySnapshot,
          ownerEvidence.sizingRequest,
          event.occurredAtMs,
        );
        state = {
          ...state,
          preflights: state.preflights.map((entry, current) => current === preflightIndex
            ? { ...entry, result }
            : entry),
        };
      }
      const executed = executeAggressive(state, order, event);
      state = { ...replaceOrder(state, index, executed.order), book: executed.book };
    }
  } else if (event.kind === 'HTTP_DELIVERY') {
    const index = orderIndex(state, payload.fixtureId);
    const order = state.orders[index];
    if (order.venueArrivalAtMs === null
      || event.occurredAtMs !== order.venueArrivalAtMs + order.fixture.latency.venueToHttpMs
      || !['ACK', 'HTTP_5XX', 'TIMEOUT', 'DISCONNECT'].includes(payload.outcome as string)) {
      throw new TypeError('HTTP delivery does not bind venue latency/outcome');
    }
    if (!(state.crashed && state.dropLocalDeliveries)) {
      const unknown = payload.outcome !== 'ACK';
      const privatelyObserved = order.localTruth === 'OBSERVED';
      state = replaceOrder(state, index, deepFreeze({
        ...order,
        localTruth: eventAmbiguous ? 'UNKNOWN'
          : privatelyObserved ? 'OBSERVED' : unknown ? 'UNKNOWN' : 'ACKNOWLEDGED',
        localObservedVenueStatus: eventAmbiguous ? null : order.localObservedVenueStatus,
        lastLocalObservationAtMs: eventAmbiguous || !privatelyObserved
          ? event.occurredAtMs : order.lastLocalObservationAtMs,
        recoveryRequired: eventAmbiguous ? true : privatelyObserved ? order.recoveryRequired : unknown,
      }));
    }
  } else if (event.kind === 'PRIVATE_DELIVERY') {
    const index = orderIndex(state, payload.fixtureId);
    const order = state.orders[index];
    identifier(payload.venueRevision, 'private venue revision');
    if (order.venueArrivalAtMs === null
      || event.occurredAtMs !== order.venueArrivalAtMs + order.fixture.latency.venueToPrivateMs
      || payload.venueRevision !== order.venueRevision) {
      throw new TypeError('private delivery does not bind venue revision/latency');
    }
    if (!(state.crashed && state.dropLocalDeliveries)) {
      state = replaceOrder(state, index, deepFreeze({
        ...order,
        localTruth: eventAmbiguous ? 'UNKNOWN' : 'OBSERVED',
        localObservedVenueStatus: eventAmbiguous ? null : order.venueStatus,
        lastLocalObservationAtMs: event.occurredAtMs,
        recoveryRequired: eventAmbiguous
          || order.venueStatus === 'NEW' || order.venueStatus === 'PARTIALLY_FILLED',
      }));
    }
  } else if (event.kind === 'TRADE_EVIDENCE') {
    const tradeQuantity = twinPositiveDecimal(payload.quantity, 'trade quantity');
    const tradePrice = twinPositiveDecimal(payload.price, 'trade price');
    identifier(payload.tradeRevision, 'trade revision');
    if (payload.aggressorSide !== 'BUY' && payload.aggressorSide !== 'SELL') {
      throw new TypeError('trade aggressor side is invalid');
    }
    const scenarioFixture = state.orders[0]?.fixture;
    if (scenarioFixture === undefined && payload.feeEvidence !== null) {
      throw new TypeError('fee evidence requires a scenario asset identity');
    }
    if (scenarioFixture !== undefined) validateFeeEvidenceForAssets(
      payload.feeEvidence,
      event.occurredAtMs,
      scenarioFixture.baseAsset,
      scenarioFixture.quoteAsset,
    );
    let tradeRemaining: string = eventAmbiguous ? '0' : tradeQuantity;
    for (let index = 0; index < state.orders.length; index += 1) {
      if (tradeRemaining === '0') break;
      const order = state.orders[index];
      if ((order.venueStatus !== 'NEW' && order.venueStatus !== 'PARTIALLY_FILLED')
        || order.fixture.timeInForce !== 'GTC' || order.fixture.price === null
        || payload.aggressorSide === order.fixture.side) continue;
      const crosses = order.fixture.side === 'BUY'
        ? compareTwinDecimals(tradePrice, order.fixture.price) <= 0
        : compareTwinDecimals(tradePrice, order.fixture.price) >= 0;
      if (!crosses) continue;
      if (order.fixture.queueTruth !== 'ESTIMATED' || order.queueAheadRemaining === null) continue;
      let available: string = tradeRemaining;
      let queue: string | null = order.queueAheadRemaining;
      let queueConsumption = '0';
      if (queue !== null) {
        queueConsumption = minimumTwinDecimal(queue, available);
        queue = subtractTwinDecimals(queue, queueConsumption);
        available = subtractTwinDecimals(available, queueConsumption);
      }
      const quantity = minimumTwinDecimal(order.remainingQuantity, available);
      tradeRemaining = subtractTwinDecimals(
        tradeRemaining,
        addTwinDecimals(queueConsumption, quantity),
      );
      if (quantity === '0') {
        state = replaceOrder(state, index, deepFreeze({ ...order, queueAheadRemaining: queue }));
        continue;
      }
      const passiveFillPrice = order.fixture.price;
      const quoteNotional = multiplyTwinDecimals(quantity, passiveFillPrice);
      const fee = feeFor(
        payload.feeEvidence,
        quantity,
        quoteNotional,
        'MAKER',
        event.occurredAtMs,
        order.fixture.baseAsset,
        order.fixture.quoteAsset,
      );
      const fill: TwinFill = deepFreeze({
        fillId: digest('l07fill_', { fixtureId: order.fixture.fixtureId, eventId: event.eventId }),
        fixtureId: order.fixture.fixtureId, eventId: event.eventId, bookRevision: state.book.bookRevision,
        price: passiveFillPrice, quantity, quoteNotional, liquidityRole: 'MAKER', ...fee,
        occurredAtMs: event.occurredAtMs,
      });
      const remainingQuantity = subtractTwinDecimals(order.remainingQuantity, quantity);
      const filledQuantity = addTwinDecimals(order.filledQuantity, quantity);
      const fills = [...order.fills, fill];
      if (fills.length > MAX_FILLS) throw new RangeError('exchange-twin fill bound exceeded');
      const totalNotional = fills.reduce((sum, item) => addTwinDecimals(sum, item.quoteNotional), '0');
      state = replaceOrder(state, index, deepFreeze({
        ...order, filledQuantity, remainingQuantity, queueAheadRemaining: queue,
        fills,
        vwap: {
          numeratorQuoteNotional: totalNotional,
          denominatorBaseQuantity: filledQuantity,
          decimalScale24: divideTwinDecimals(totalNotional, filledQuantity),
          decimalPolicy: 'TRUNCATED_SCALE_24' as const,
        },
        venueStatus: remainingQuantity === '0' ? 'FILLED' : 'PARTIALLY_FILLED',
        lastVenueEffectAtMs: event.occurredAtMs,
        venueRevision: digest('l07venue_', { prior: order.venueRevision, eventId: event.eventId, fill }),
      }));
    }
  } else if (event.kind === 'COST_OBSERVATION') {
    const index = orderIndex(state, payload.fixtureId);
    const order = state.orders[index];
    const evidenceRevision = identifier(payload.evidenceRevision, 'cost evidence revision');
    if (payload.kind !== 'LATENCY_MOVEMENT_QUOTE' && payload.kind !== 'ADVERSE_SELECTION_QUOTE') {
      throw new TypeError('cost observation kind is invalid');
    }
    const amount = payload.amount === null ? null : twinDecimal(payload.amount, 'cost observation amount');
    if (order.venueArrivalAtMs === null
      || (payload.kind === 'ADVERSE_SELECTION_QUOTE' && order.filledQuantity === '0')) {
      throw new TypeError('cost observation precedes its synthetic venue/fill evidence');
    }
    state = replaceOrder(state, index, deepFreeze(payload.kind === 'LATENCY_MOVEMENT_QUOTE'
      ? {
        ...order,
        latencyMovementQuote: eventAmbiguous ? null : amount,
        latencyMovementEvidenceRevision: eventAmbiguous ? null : evidenceRevision,
      }
      : {
        ...order,
        adverseSelectionQuote: eventAmbiguous ? null : amount,
        adverseSelectionEvidenceRevision: eventAmbiguous ? null : evidenceRevision,
      }));
  } else if (event.kind === 'CANCEL_DISPATCH') {
    const index = orderIndex(state, payload.fixtureId);
    const order = state.orders[index];
    const cancelFixture = validateCancelFixture(payload.cancelFixture, order.fixture);
    if (eventAmbiguous) {
      state = replaceOrder(state, index, deepFreeze({
        ...order,
        localTruth: 'RECOVERY_REQUIRED',
        localObservedVenueStatus: null,
        recoveryRequired: true,
        blockedReasonCodes: [...new Set([...order.blockedReasonCodes, 'CANCEL_DISPATCH_ORDER_AMBIGUOUS'])].sort(),
      }));
    } else if (!(state.crashed && state.dropPendingCommands)) {
      if (order.cancelFixture !== null) throw new TypeError('cancel dispatch is duplicated');
      if (event.occurredAtMs < cancelFixture.l06Boundary.evaluatedAtMs) {
        throw new TypeError('cancel dispatch precedes L06 synthetic boundary');
      }
      state = replaceOrder(state, index, deepFreeze({
        ...order, cancelFixture, cancelDispatchAtMs: event.occurredAtMs, recoveryRequired: true,
      }));
    }
  } else if (event.kind === 'CANCEL_ARRIVAL') {
    const index = orderIndex(state, payload.fixtureId);
    const cancelFixtureId = identifier(payload.cancelFixtureId, 'cancel fixture ID');
    const order = state.orders[index];
    if (order.cancelFixture?.cancelFixtureId !== cancelFixtureId || order.cancelDispatchAtMs === null
      || event.occurredAtMs !== order.cancelDispatchAtMs + order.cancelFixture.dispatchToVenueMs) {
      throw new TypeError('cancel arrival does not bind a dispatched cancel fixture');
    }
    const rateState = deepFreeze(snapshot(payload.rateState));
    const reservationInput = deepFreeze(snapshot(payload.reservationInput));
    const ownerEvidenceSha256 = payload.ownerEvidenceSha256;
    if (typeof ownerEvidenceSha256 !== 'string' || !SHA256.test(ownerEvidenceSha256)
      || ownerEvidenceSha256 !== exchangeTwinOwnerEvidenceSha256({ rateState, reservationInput })) {
      throw new TypeError('cancel L03 owner evidence content commitment is invalid');
    }
    const decision = evaluateExchangeTwinRateReservation(
      rateState,
      reservationInput,
      event.occurredAtMs,
    );
    const expectedCancelContractId = order.fixture.product === 'SPOT'
      ? 'SPOT_ORDER_CANCEL' : 'USDM_ORDER_CANCEL';
    if (ownerEvidenceSha256 !== order.cancelFixture.rateOwnerEvidenceSha256
      || decision.quote.contractId !== expectedCancelContractId
      || decision.quote.product !== order.fixture.product
      || decision.quote.environment !== 'PRODUCTION'
      || decision.quote.matrixContentSha256 !== '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac') {
      throw new TypeError('L03 cancel reservation does not bind the fixture/accepted matrix');
    }
    if (eventAmbiguous) {
      state = replaceOrder(state, index, deepFreeze({
        ...order,
        cancelArrivalAtMs: event.occurredAtMs,
        localTruth: 'RECOVERY_REQUIRED',
        localObservedVenueStatus: null,
        recoveryRequired: true,
        blockedReasonCodes: [...new Set([...order.blockedReasonCodes, 'CANCEL_ARRIVAL_ORDER_AMBIGUOUS'])].sort(),
      }));
    } else if (order.blockedReasonCodes.includes('CRASH_DROPPED_PENDING_CANCEL')) {
      // The injected crash dropped the command before venue arrival. The
      // arrival event is retained for replay identity but has no venue effect.
    } else if ((state.symbolStatus !== 'TRADING' && state.symbolStatus !== 'CANCEL_ONLY')
      || decision.allowed !== true || decision.reason !== 'RESERVED'
    ) {
      state = replaceOrder(state, index, deepFreeze({
        ...order, cancelArrivalAtMs: event.occurredAtMs, recoveryRequired: true,
        blockedReasonCodes: state.symbolStatus !== 'TRADING' && state.symbolStatus !== 'CANCEL_ONLY'
          ? [`CANCEL_SYMBOL_${state.symbolStatus}`]
          : ['CANCEL_RATE_NOT_RESERVED'],
      }));
    } else if (order.venueStatus === 'NEW' || order.venueStatus === 'PARTIALLY_FILLED') {
      state = replaceOrder(state, index, deepFreeze({
        ...order, cancelArrivalAtMs: event.occurredAtMs,
        venueStatus: 'CANCELED', lastVenueEffectAtMs: event.occurredAtMs,
        venueRevision: digest('l07venue_', { prior: order.venueRevision, eventId: event.eventId, status: 'CANCELED' }),
      }));
    } else {
      state = replaceOrder(state, index, deepFreeze({ ...order, cancelArrivalAtMs: event.occurredAtMs }));
    }
  } else if (event.kind === 'CANCEL_DELIVERY') {
    const index = orderIndex(state, payload.fixtureId);
    const order = state.orders[index];
    const cancelFixture = order.cancelFixture;
    if (cancelFixture === null
      || payload.cancelFixtureId !== cancelFixture.cancelFixtureId
      || order.cancelArrivalAtMs === null
      || event.occurredAtMs !== order.cancelArrivalAtMs + cancelFixture.venueToLocalMs) {
      throw new TypeError('cancel delivery does not bind venue arrival');
    }
    if (!['ACK', 'HTTP_5XX', 'TIMEOUT', 'DISCONNECT', 'DROPPED'].includes(payload.outcome as string)) {
      throw new TypeError('cancel delivery outcome is invalid');
    }
    if (!(state.crashed && state.dropLocalDeliveries)) {
      const known = payload.outcome === 'ACK';
      state = replaceOrder(state, index, deepFreeze({
        ...order,
        localTruth: eventAmbiguous ? 'UNKNOWN' : known ? 'OBSERVED' : 'UNKNOWN',
        localObservedVenueStatus: eventAmbiguous ? null
          : known ? order.venueStatus : order.localObservedVenueStatus,
        lastLocalObservationAtMs: event.occurredAtMs,
        recoveryRequired: eventAmbiguous || !known,
      }));
    }
  } else if (event.kind === 'CRASH') {
    if (state.crashed) throw new TypeError('scenario is already crashed');
    if (typeof payload.dropLocalDeliveries !== 'boolean'
      || typeof payload.dropPendingCommands !== 'boolean') {
      throw new TypeError('crash drop flags must be boolean');
    }
    const dropPendingCommands = payload.dropPendingCommands === true;
    state = { ...state, crashed: true, activeCrashId: identifier(payload.crashId, 'crash ID'),
      dropLocalDeliveries: payload.dropLocalDeliveries === true,
      dropPendingCommands,
      orders: state.orders.map((order) => {
        const pendingPlacement = dropPendingCommands
          && order.dispatchAtMs !== null && order.venueArrivalAtMs === null;
        const pendingCancel = dropPendingCommands
          && order.cancelDispatchAtMs !== null && order.cancelArrivalAtMs === null;
        return deepFreeze({
          ...order,
          recoveryRequired: order.dispatchAtMs !== null,
          blockedReasonCodes: pendingPlacement || pendingCancel
            ? [...new Set([
              ...order.blockedReasonCodes,
              ...(pendingPlacement ? ['CRASH_DROPPED_PENDING_COMMAND'] : []),
              ...(pendingCancel ? ['CRASH_DROPPED_PENDING_CANCEL'] : []),
            ])].sort()
            : order.blockedReasonCodes,
        });
      }) };
  } else if (event.kind === 'RESTART') {
    if (!state.crashed || payload.crashId !== state.activeCrashId) throw new TypeError('restart does not bind active crash');
    state = { ...state, crashed: false, activeCrashId: null, dropLocalDeliveries: false,
      dropPendingCommands: false,
      orders: state.orders.map((order) => order.dispatchAtMs === null ? order : deepFreeze({
        ...order, localTruth: 'RECOVERY_REQUIRED', recoveryRequired: true,
      })) };
  } else if (event.kind === 'RECONCILIATION_OBSERVATION') {
    const index = orderIndex(state, payload.fixtureId);
    const order = state.orders[index];
    identifier(payload.ownerObservationRevision, 'owner reconciliation revision');
    identifier(payload.observedVenueRevision, 'observed venue revision');
    if (!['NOT_ARRIVED', 'BLOCKED', 'NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED']
      .includes(payload.observedStatus as string)) {
      throw new TypeError('owner reconciliation status is invalid');
    }
    if (eventAmbiguous) {
      state = replaceOrder(state, index, deepFreeze({
        ...order,
        localTruth: 'RECOVERY_REQUIRED',
        localObservedVenueStatus: null,
        lastLocalObservationAtMs: event.occurredAtMs,
        recoveryRequired: true,
        blockedReasonCodes: [...new Set([...order.blockedReasonCodes, 'OWNER_RECONCILIATION_ORDER_AMBIGUOUS'])].sort(),
      }));
    } else if (payload.observedVenueRevision !== order.venueRevision
      || payload.observedStatus !== order.venueStatus
      || twinDecimal(payload.observedFilledQuantity, 'reconciled fill') !== order.filledQuantity) {
      state = replaceOrder(state, index, deepFreeze({
        ...order,
        localTruth: 'RECOVERY_REQUIRED',
        localObservedVenueStatus: null,
        lastLocalObservationAtMs: event.occurredAtMs,
        recoveryRequired: true,
        blockedReasonCodes: [...new Set([...order.blockedReasonCodes, 'OWNER_RECONCILIATION_MISMATCH'])].sort(),
      }));
    } else {
      state = replaceOrder(state, index, deepFreeze({
        ...order, localTruth: 'OBSERVED', localObservedVenueStatus: order.venueStatus,
        recoveryRequired: false, lastLocalObservationAtMs: event.occurredAtMs,
      }));
    }
  }
  const processedEvents = [...state.processedEvents, {
    eventId: event.eventId,
    sequence: event.sequence,
    occurredAtMs: event.occurredAtMs,
    eventPriority: EVENT_PRIORITY[event.kind],
    orderingDomain: eventOrderingDomain(event, state),
    sourceSequence: event.sourceSequence,
    contentRevision,
  }].sort((left, right) => left.sequence - right.sequence || stableTextCompare(left.eventId, right.eventId));
  return finalizeState({ ...state, processedEvents } as Omit<TwinScenarioState, 'outcomeRevision' | 'stateRevision'>);
}

export function reduceExchangeTwinEvent(stateValue: unknown, eventValue: unknown): Readonly<TwinScenarioState> {
  const state = record(stateValue, STATE_FIELDS, 'exchange-twin state') as unknown as TwinScenarioState;
  if (typeof state !== 'object' || state === null || state.schema !== EXCHANGE_TWIN_SCHEMA
    || state.simulationAuthority !== 'SYNTHETIC_FIXTURE'
    || state.actionAuthority !== 'NONE_RECORD_ONLY'
    || state.externalActionAuthorization !== 'NONE') {
    throw new TypeError('exchange-twin state is invalid or authoritative');
  }
  const { outcomeRevision, stateRevision, ...material } = state;
  const rebuilt = finalizeState(material);
  if (rebuilt.outcomeRevision !== outcomeRevision || rebuilt.stateRevision !== stateRevision) {
    throw new TypeError('exchange-twin state revision mismatch');
  }
  return reduceCanonical(stateValue as Readonly<TwinScenarioState>, eventValue);
}

export function runExchangeTwinScenario(inputValue: unknown): Readonly<TwinScenarioState> {
  const input = snapshot(inputValue) as unknown as TwinScenarioInput;
  let state = createExchangeTwinState(input);
  const events = [...input.events];
  const ids = new Set<string>();
  const sequences = new Set<number>();
  for (const event of events) {
    if (ids.has(event.eventId) || sequences.has(event.sequence)) throw new TypeError('scenario event identity/sequence is duplicated');
    ids.add(event.eventId);
    sequences.add(event.sequence);
  }
  events.sort((left, right) => left.occurredAtMs - right.occurredAtMs
    || EVENT_PRIORITY[left.kind] - EVENT_PRIORITY[right.kind]
    || (left.sourceSequence ?? Number.MAX_SAFE_INTEGER) - (right.sourceSequence ?? Number.MAX_SAFE_INTEGER)
    || left.sequence - right.sequence
    || (left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0));
  const ambiguousIndexes = new Set<number>();
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].occurredAtMs === events[index - 1].occurredAtMs
      && events[index].sourceSequence === null && events[index - 1].sourceSequence === null
      && EVENT_PRIORITY[events[index].kind] === EVENT_PRIORITY[events[index - 1].kind]
      && eventOrderingDomain(events[index], state) === eventOrderingDomain(events[index - 1], state)) {
      ambiguousIndexes.add(index - 1);
      ambiguousIndexes.add(index);
    }
  }
  for (let index = 0; index < events.length; index += 1) {
    if (ambiguousIndexes.has(index)) {
      const domain = eventOrderingDomain(events[index], state);
      state = finalizeState({
        ...state,
        orderingTruth: 'AMBIGUOUS',
        ambiguousDomains: [...new Set([...state.ambiguousDomains, domain])].sort(),
      });
    }
    state = reduceCanonical(state, events[index], true, ambiguousIndexes.has(index));
  }
  return state;
}

export function checkpointExchangeTwin(stateValue: unknown): Readonly<TwinCheckpoint> {
  const state = record(stateValue, STATE_FIELDS, 'exchange-twin checkpoint state') as unknown as TwinScenarioState;
  if (state.schema !== EXCHANGE_TWIN_SCHEMA
    || state.simulationAuthority !== 'SYNTHETIC_FIXTURE'
    || state.actionAuthority !== 'NONE_RECORD_ONLY'
    || state.externalActionAuthorization !== 'NONE') {
    throw new TypeError('cannot checkpoint invalid twin state');
  }
  const { outcomeRevision, stateRevision, ...material } = state;
  const rebuilt = finalizeState(material);
  if (rebuilt.outcomeRevision !== outcomeRevision || rebuilt.stateRevision !== stateRevision) {
    throw new TypeError('exchange-twin state revision mismatch');
  }
  const stateSnapshot = snapshot(state) as TwinScenarioState;
  return deepFreeze({
    schema: EXCHANGE_TWIN_CHECKPOINT_SCHEMA,
    state: stateSnapshot,
    checkpointRevision: digest('l07checkpoint_', stateSnapshot),
    simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  });
}

export function restoreExchangeTwin(value: unknown): Readonly<TwinScenarioState> {
  const checkpoint = record(value, [
    'schema', 'state', 'checkpointRevision', 'simulationAuthority', 'actionAuthority',
    'externalActionAuthorization',
  ], 'exchange-twin checkpoint');
  if (checkpoint.schema !== EXCHANGE_TWIN_CHECKPOINT_SCHEMA
    || checkpoint.simulationAuthority !== 'SYNTHETIC_FIXTURE'
    || checkpoint.actionAuthority !== 'NONE_RECORD_ONLY'
    || checkpoint.externalActionAuthorization !== 'NONE') {
    throw new TypeError('exchange-twin checkpoint authority is invalid');
  }
  const state = snapshot(checkpoint.state) as TwinScenarioState;
  if (state.schema !== EXCHANGE_TWIN_SCHEMA
    || checkpoint.checkpointRevision !== digest('l07checkpoint_', state)) {
    throw new TypeError('exchange-twin checkpoint content mismatch');
  }
  const { outcomeRevision: _outcome, stateRevision: _stateRevision, ...material } = state;
  const rebuilt = finalizeState(material);
  if (rebuilt.outcomeRevision !== state.outcomeRevision || rebuilt.stateRevision !== state.stateRevision) {
    throw new TypeError('exchange-twin state revision mismatch');
  }
  return rebuilt;
}

export function deriveTwinRecordedOutcomeContentRevision(value: unknown): string {
  const recordValue = record(
    value,
    ['recordedOutcomeRevision', 'recordedFilledQuantity'],
    'recorded calibration content',
  );
  identifier(recordValue.recordedOutcomeRevision, 'recorded outcome revision');
  const recordedFilledQuantity = twinDecimal(
    recordValue.recordedFilledQuantity,
    'recorded filled quantity',
  );
  return digest('l07recorded_', {
    recordedOutcomeRevision: recordValue.recordedOutcomeRevision,
    recordedFilledQuantity,
  });
}

export function deriveTwinCalibrationRevision(value: unknown): string {
  const projection = record(value, [
    'modelRevision', 'predictedOutcomeRevision', 'recordedContentRevision',
    'sampleCount', 'observedAtMs', 'validUntilMs',
  ], 'calibration revision projection');
  identifier(projection.modelRevision, 'calibration model revision');
  identifier(projection.predictedOutcomeRevision, 'predicted outcome revision');
  identifier(projection.recordedContentRevision, 'recorded content revision');
  safeInteger(projection.sampleCount, 'calibration sample count', 1, 1_000_000);
  safeInteger(projection.observedAtMs, 'calibration observation time');
  safeInteger(projection.validUntilMs, 'calibration validity time');
  return digest('l07calibration_', projection);
}

export function compareExchangeTwinOutcome(
  predictedStateValue: unknown,
  evidenceValue: unknown,
  evaluatedAtMsValue: unknown,
): Readonly<TwinCalibrationComparison> {
  const predictedState = record(
    predictedStateValue,
    STATE_FIELDS,
    'predicted exchange-twin state',
  ) as unknown as TwinScenarioState;
  const {
    outcomeRevision: predictedOutcomeRevision,
    stateRevision,
    ...predictedMaterial
  } = predictedState;
  const rebuilt = finalizeState(predictedMaterial);
  if (rebuilt.outcomeRevision !== predictedOutcomeRevision
    || rebuilt.stateRevision !== stateRevision
    || predictedState.simulationAuthority !== 'SYNTHETIC_FIXTURE') {
    throw new TypeError('predicted exchange-twin state commitment is invalid');
  }
  const modelRevision = predictedState.modelRevision;
  const evaluatedAtMs = safeInteger(evaluatedAtMsValue, 'calibration evaluation time');
  if (evidenceValue === null) return deepFreeze({
    schema: 'TWIN_CALIBRATION_COMPARISON_V1' as const,
    state: 'UNAVAILABLE' as const,
    reasonCodes: Object.freeze(['EVIDENCE_MISSING']),
    calibrationRevision: null,
    modelRevision,
    predictedOutcomeRevision,
    recordedOutcomeRevision: null,
    quantityResidual: null,
    probability: null,
    confidence: null,
    simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  });
  const evidence = record(evidenceValue, [
    'schema', 'calibrationRevision', 'modelRevision', 'predictedOutcomeRevision',
    'recordedOutcomeRevision', 'recordedContentRevision',
    'predictedFilledQuantity', 'recordedFilledQuantity',
    'sampleCount', 'observedAtMs', 'validUntilMs',
  ], 'calibration evidence') as unknown as TwinCalibrationEvidence;
  const reasons: string[] = [];
  if (evidence.schema !== 'TWIN_CALIBRATION_EVIDENCE_V1') reasons.push('SCHEMA_MISMATCH');
  if (evidence.modelRevision !== modelRevision) reasons.push('MODEL_REVISION_MISMATCH');
  if (evidence.predictedOutcomeRevision !== predictedOutcomeRevision) {
    reasons.push('PREDICTED_OUTCOME_REVISION_MISMATCH');
  }
  identifier(evidence.calibrationRevision, 'calibration revision');
  identifier(evidence.modelRevision, 'calibration model revision');
  identifier(evidence.predictedOutcomeRevision, 'predicted outcome revision');
  identifier(evidence.recordedOutcomeRevision, 'recorded outcome revision');
  identifier(evidence.recordedContentRevision, 'recorded content revision');
  if (!Number.isSafeInteger(evidence.sampleCount)
    || evidence.sampleCount < 1
    || evidence.sampleCount > 1_000_000) reasons.push('SAMPLE_INSUFFICIENT');
  const observedAtMs = safeInteger(evidence.observedAtMs, 'calibration observation time');
  const validUntilMs = safeInteger(evidence.validUntilMs, 'calibration validity time');
  if (validUntilMs <= observedAtMs
    || evaluatedAtMs < observedAtMs
    || evaluatedAtMs >= validUntilMs) reasons.push('EVIDENCE_STALE');
  const predicted = twinDecimal(evidence.predictedFilledQuantity, 'predicted filled quantity');
  const recorded = twinDecimal(evidence.recordedFilledQuantity, 'recorded filled quantity');
  const statePredicted = predictedState.orders.reduce(
    (sum, order) => addTwinDecimals(sum, order.filledQuantity),
    '0',
  );
  if (predicted !== statePredicted) reasons.push('PREDICTED_QUANTITY_MISMATCH');
  const expectedRecordedContentRevision = deriveTwinRecordedOutcomeContentRevision({
    recordedOutcomeRevision: evidence.recordedOutcomeRevision,
    recordedFilledQuantity: recorded,
  });
  if (evidence.recordedContentRevision !== expectedRecordedContentRevision) {
    reasons.push('RECORDED_CONTENT_REVISION_MISMATCH');
  }
  if (Number.isSafeInteger(evidence.sampleCount)
    && evidence.sampleCount >= 1
    && evidence.sampleCount <= 1_000_000) {
    const expectedCalibrationRevision = deriveTwinCalibrationRevision({
      modelRevision: evidence.modelRevision,
      predictedOutcomeRevision: evidence.predictedOutcomeRevision,
      recordedContentRevision: evidence.recordedContentRevision,
      sampleCount: evidence.sampleCount,
      observedAtMs,
      validUntilMs,
    });
    if (evidence.calibrationRevision !== expectedCalibrationRevision) {
      reasons.push('CALIBRATION_REVISION_MISMATCH');
    }
  }
  if (reasons.length > 0) return deepFreeze({
    schema: 'TWIN_CALIBRATION_COMPARISON_V1' as const,
    state: 'UNAVAILABLE' as const,
    reasonCodes: [...new Set(reasons)].sort(), calibrationRevision: null,
    modelRevision,
    predictedOutcomeRevision,
    recordedOutcomeRevision: evidence.recordedOutcomeRevision,
    quantityResidual: null, probability: null, confidence: null,
    simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const, externalActionAuthorization: 'NONE' as const,
  });
  return deepFreeze({
    schema: 'TWIN_CALIBRATION_COMPARISON_V1' as const,
    state: 'AVAILABLE' as const,
    reasonCodes: Object.freeze([]),
    calibrationRevision: identifier(evidence.calibrationRevision, 'calibration revision'),
    modelRevision,
    predictedOutcomeRevision,
    recordedOutcomeRevision: evidence.recordedOutcomeRevision,
    quantityResidual: signedTwinResidual(recorded, predicted),
    probability: null,
    confidence: null,
    simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  });
}
