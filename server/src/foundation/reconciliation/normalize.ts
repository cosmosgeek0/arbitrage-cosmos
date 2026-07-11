import {
  canonicalJson,
  evaluateFreshness,
  findSerializabilityIssues,
  isCompleteness,
  isDataAuthority,
  isValidUtcMillis,
  isVenue,
  type SourcedTimestamp,
} from '../contracts/index.js';
import {
  OBSERVED_ORDER_STATUSES,
  OBSERVED_POSITION_SIDES,
  type EvidenceCollection,
  type EvidenceSourceMetadata,
  type NormalizationIssue,
  type NormalizedEvidenceCollection,
  type NormalizedObservedEvidence,
  type ObservedEvidenceInput,
  type ObservedFillEvidence,
  type ObservedOrderEvidence,
  type ObservedPositionEvidence,
} from './types.js';

const MAX_ID_LENGTH = 128;
const MAX_SYMBOL_LENGTH = 64;
const MAX_SAFE_QUANTITY = Number.MAX_SAFE_INTEGER;

/** Locale/ICU-independent UTF-16 code-unit ordering. */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPlainObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`${path} must be a plain object`);
  }
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${path} contains missing or unknown fields`);
  }
}

function assertIdentifier(value: unknown, path: string, maxLength = MAX_ID_LENGTH): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${path} must be a non-empty control-free string (<=${maxLength} chars)`);
  }
}

function assertQuantity(value: unknown, path: string, allowZero: boolean): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > MAX_SAFE_QUANTITY ||
    (allowZero ? value < 0 : value <= 0)
  ) {
    throw new TypeError(`${path} must be a ${allowZero ? 'non-negative' : 'positive'} finite safe-range quantity`);
  }
}

function assertSignedQuantity(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_SAFE_QUANTITY) {
    throw new TypeError(`${path} must be a finite safe-range quantity`);
  }
}

function normalizeMetadata(value: unknown, path: string): Readonly<EvidenceSourceMetadata> {
  assertPlainObject(value, path);
  assertExactKeys(value, [
    'sourceId',
    'authority',
    'completeness',
    'sourceTimeMs',
    'receivedAtMs',
    'maxAgeMs',
    'coverageStartMs',
    'coverageEndMs',
  ], path);
  assertIdentifier(value.sourceId, `${path}.sourceId`, 200);
  if (!isDataAuthority(value.authority)) throw new TypeError(`${path}.authority must be a DataAuthority`);
  if (!isCompleteness(value.completeness)) throw new TypeError(`${path}.completeness must be a Completeness`);
  if (value.sourceTimeMs !== null && !isValidUtcMillis(value.sourceTimeMs)) {
    throw new TypeError(`${path}.sourceTimeMs must be null or valid UTC ms`);
  }
  if (!isValidUtcMillis(value.receivedAtMs)) throw new TypeError(`${path}.receivedAtMs must be valid UTC ms`);
  if (typeof value.maxAgeMs !== 'number' || !Number.isSafeInteger(value.maxAgeMs) || value.maxAgeMs <= 0) {
    throw new TypeError(`${path}.maxAgeMs must be a positive safe integer`);
  }
  const hasStart = value.coverageStartMs !== null;
  const hasEnd = value.coverageEndMs !== null;
  let coverageStartMs: number | null = null;
  let coverageEndMs: number | null = null;
  if (hasStart !== hasEnd) throw new TypeError(`${path} history coverage must provide both bounds or neither`);
  if (hasStart) {
    if (!isValidUtcMillis(value.coverageStartMs) || !isValidUtcMillis(value.coverageEndMs)) {
      throw new TypeError(`${path} history coverage bounds must be valid UTC ms`);
    }
    if ((value.coverageStartMs as number) > (value.coverageEndMs as number)) {
      throw new TypeError(`${path} history coverage start must not exceed its end`);
    }
    coverageStartMs = value.coverageStartMs as number;
    coverageEndMs = value.coverageEndMs as number;
    const sourceHorizon = (value.sourceTimeMs as number | null) ?? value.receivedAtMs;
    if (coverageEndMs > sourceHorizon) {
      throw new TypeError(`${path} history coverage end exceeds its source observation horizon`);
    }
  }
  return Object.freeze({
    sourceId: value.sourceId,
    authority: value.authority,
    completeness: value.completeness,
    sourceTimeMs: value.sourceTimeMs,
    receivedAtMs: value.receivedAtMs,
    maxAgeMs: value.maxAgeMs,
    coverageStartMs,
    coverageEndMs,
  });
}

function normalizeOrder(value: unknown, path: string): Readonly<ObservedOrderEvidence> {
  assertPlainObject(value, path);
  assertExactKeys(value, [
    'venue',
    'symbol',
    'clientOrderId',
    'venueOrderId',
    'side',
    'originalQuantity',
    'cumulativeFilledQuantity',
    'status',
    'reduceOnly',
    'updatedAtMs',
  ], path);
  if (!isVenue(value.venue)) throw new TypeError(`${path}.venue must be a Venue`);
  assertIdentifier(value.symbol, `${path}.symbol`, MAX_SYMBOL_LENGTH);
  assertIdentifier(value.clientOrderId, `${path}.clientOrderId`);
  assertIdentifier(value.venueOrderId, `${path}.venueOrderId`);
  if (value.side !== 'BUY' && value.side !== 'SELL') throw new TypeError(`${path}.side must be BUY or SELL`);
  assertQuantity(value.originalQuantity, `${path}.originalQuantity`, false);
  assertQuantity(value.cumulativeFilledQuantity, `${path}.cumulativeFilledQuantity`, true);
  if (value.cumulativeFilledQuantity > value.originalQuantity) {
    throw new TypeError(`${path}.cumulativeFilledQuantity exceeds originalQuantity`);
  }
  if (!(OBSERVED_ORDER_STATUSES as readonly unknown[]).includes(value.status)) {
    throw new TypeError(`${path}.status must be an ObservedOrderStatus`);
  }
  if (value.reduceOnly !== null && typeof value.reduceOnly !== 'boolean') {
    throw new TypeError(`${path}.reduceOnly must be boolean|null`);
  }
  if (!isValidUtcMillis(value.updatedAtMs)) throw new TypeError(`${path}.updatedAtMs must be valid UTC ms`);
  return Object.freeze({
    venue: value.venue,
    symbol: value.symbol,
    clientOrderId: value.clientOrderId,
    venueOrderId: value.venueOrderId,
    side: value.side,
    originalQuantity: value.originalQuantity,
    cumulativeFilledQuantity: value.cumulativeFilledQuantity,
    status: value.status as ObservedOrderEvidence['status'],
    reduceOnly: value.reduceOnly,
    updatedAtMs: value.updatedAtMs,
  });
}

function normalizeFill(value: unknown, path: string): Readonly<ObservedFillEvidence> {
  assertPlainObject(value, path);
  assertExactKeys(value, [
    'venue',
    'symbol',
    'tradeId',
    'clientOrderId',
    'venueOrderId',
    'side',
    'quantity',
    'price',
    'occurredAtMs',
  ], path);
  if (!isVenue(value.venue)) throw new TypeError(`${path}.venue must be a Venue`);
  assertIdentifier(value.symbol, `${path}.symbol`, MAX_SYMBOL_LENGTH);
  assertIdentifier(value.tradeId, `${path}.tradeId`);
  if (value.clientOrderId !== null) assertIdentifier(value.clientOrderId, `${path}.clientOrderId`);
  assertIdentifier(value.venueOrderId, `${path}.venueOrderId`);
  if (value.side !== 'BUY' && value.side !== 'SELL') throw new TypeError(`${path}.side must be BUY or SELL`);
  assertQuantity(value.quantity, `${path}.quantity`, false);
  if (value.price !== null) assertQuantity(value.price, `${path}.price`, false);
  if (!isValidUtcMillis(value.occurredAtMs)) throw new TypeError(`${path}.occurredAtMs must be valid UTC ms`);
  return Object.freeze({
    venue: value.venue,
    symbol: value.symbol,
    tradeId: value.tradeId,
    clientOrderId: value.clientOrderId,
    venueOrderId: value.venueOrderId,
    side: value.side,
    quantity: value.quantity,
    price: value.price,
    occurredAtMs: value.occurredAtMs,
  });
}

function normalizePosition(value: unknown, path: string): Readonly<ObservedPositionEvidence> {
  assertPlainObject(value, path);
  assertExactKeys(value, [
    'venue',
    'symbol',
    'positionSide',
    'quantity',
    'baselineQuantity',
    'observedAtMs',
  ], path);
  if (!isVenue(value.venue)) throw new TypeError(`${path}.venue must be a Venue`);
  assertIdentifier(value.symbol, `${path}.symbol`, MAX_SYMBOL_LENGTH);
  if (!(OBSERVED_POSITION_SIDES as readonly unknown[]).includes(value.positionSide)) {
    throw new TypeError(`${path}.positionSide must be an ObservedPositionSide`);
  }
  assertSignedQuantity(value.quantity, `${path}.quantity`);
  if (value.baselineQuantity !== null) assertSignedQuantity(value.baselineQuantity, `${path}.baselineQuantity`);
  if (!isValidUtcMillis(value.observedAtMs)) throw new TypeError(`${path}.observedAtMs must be valid UTC ms`);
  return Object.freeze({
    venue: value.venue,
    symbol: value.symbol,
    positionSide: value.positionSide as ObservedPositionEvidence['positionSide'],
    quantity: value.quantity,
    baselineQuantity: value.baselineQuantity,
    observedAtMs: value.observedAtMs,
  });
}

function normalizeCollection<T>(
  value: unknown,
  path: string,
  nowMs: number,
  normalizeRecord: (record: unknown, path: string) => Readonly<T>,
  recordTimeMs: (record: Readonly<T>) => number,
): NormalizedEvidenceCollection<T> {
  assertPlainObject(value, path);
  assertExactKeys(value, ['metadata', 'records'], path);
  const metadata = normalizeMetadata(value.metadata, `${path}.metadata`);
  if (metadata.completeness === 'UNAVAILABLE') {
    if (value.records !== null) throw new TypeError(`${path}.records must be null when source is UNAVAILABLE`);
  } else if (!Array.isArray(value.records)) {
    throw new TypeError(`${path}.records must be an array when source is available or partial`);
  }
  const records = value.records === null
    ? null
    : Object.freeze(value.records.map((record, index) => {
      const normalized = normalizeRecord(record, `${path}.records[${index}]`);
      const timestamp = recordTimeMs(normalized);
      const sourceHorizon = metadata.sourceTimeMs ?? metadata.receivedAtMs;
      if (timestamp > sourceHorizon || timestamp > nowMs) {
        throw new TypeError(`${path}.records[${index}] timestamp exceeds source/evaluation horizon`);
      }
      return normalized;
    }));
  const timestamp: SourcedTimestamp = {
    sourceId: metadata.sourceId,
    authority: metadata.authority,
    completeness: metadata.completeness,
    sourceTimeMs: metadata.sourceTimeMs,
    receivedAtMs: metadata.receivedAtMs,
    maxAgeMs: metadata.maxAgeMs,
  };
  return Object.freeze({ metadata, freshness: evaluateFreshness(timestamp, nowMs).state, records });
}

function uniqueStrings(values: readonly (string | null)[]): readonly string[] {
  return Object.freeze([...new Set(values.filter((value): value is string => value !== null))].sort(compareCodeUnits));
}

function uniqueVenues<T extends { venue: ObservedOrderEvidence['venue'] }>(values: readonly T[]): readonly T['venue'][] {
  return Object.freeze([...new Set(values.map((value) => value.venue))].sort(compareCodeUnits) as T['venue'][]);
}

function issue(
  code: NormalizationIssue['code'],
  evidenceKind: NormalizationIssue['evidenceKind'],
  identity: string,
  records: readonly (ObservedOrderEvidence | ObservedFillEvidence | ObservedPositionEvidence)[],
  detail: string,
): Readonly<NormalizationIssue> {
  const clientOrderIds = uniqueStrings(records.map((record) => 'clientOrderId' in record ? record.clientOrderId : null));
  const venueOrderIds = uniqueStrings(records.map((record) => 'venueOrderId' in record ? record.venueOrderId : null));
  return Object.freeze({
    code,
    evidenceKind,
    identity,
    clientOrderIds,
    venueOrderIds,
    venues: uniqueVenues(records),
    symbols: uniqueStrings(records.map((record) => record.symbol)),
    detail,
  });
}

function dedupeExact<T>(records: readonly Readonly<T>[]): { records: readonly Readonly<T>[]; dropped: number } {
  const byBody = new Map<string, Readonly<T>>();
  for (const record of records) byBody.set(canonicalJson(record), record);
  return { records: [...byBody.values()], dropped: records.length - byBody.size };
}

function groupBy<T>(records: readonly T[], keyOf: (record: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const key = keyOf(record);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [record]);
    else group.push(record);
  }
  return groups;
}

function normalizeOrderSet(records: readonly Readonly<ObservedOrderEvidence>[]): {
  records: readonly Readonly<ObservedOrderEvidence>[];
  issues: readonly Readonly<NormalizationIssue>[];
  dropped: number;
} {
  const exact = dedupeExact(records);
  const issues: Readonly<NormalizationIssue>[] = [];
  for (const [identity, group] of groupBy(exact.records, (record) => `${record.venue}|${record.clientOrderId}`)) {
    if (group.length > 1) {
      issues.push(issue(
        'DUPLICATE_CLIENT_ORDER_ID',
        'ORDERS',
        identity,
        group,
        'one client-order ID maps to multiple non-identical order records',
      ));
    }
  }
  for (const [identity, group] of groupBy(
    exact.records,
    (record) => `${record.venue}|${record.symbol}|${record.venueOrderId}`,
  )) {
    if (uniqueStrings(group.map((record) => record.clientOrderId)).length > 1) {
      issues.push(issue(
        'DUPLICATE_VENUE_ORDER_ID',
        'ORDERS',
        identity,
        group,
        'one scoped venue order ID maps to multiple client-order IDs',
      ));
    }
  }
  const sorted = [...exact.records].sort((left, right) =>
    compareCodeUnits(left.venue, right.venue) ||
    compareCodeUnits(left.symbol, right.symbol) ||
    compareCodeUnits(left.clientOrderId, right.clientOrderId) ||
    compareCodeUnits(left.venueOrderId, right.venueOrderId) ||
    left.updatedAtMs - right.updatedAtMs ||
    compareCodeUnits(canonicalJson(left), canonicalJson(right))
  );
  return { records: Object.freeze(sorted), issues: Object.freeze(issues), dropped: exact.dropped };
}

function compareFills(left: Readonly<ObservedFillEvidence>, right: Readonly<ObservedFillEvidence>): number {
  return left.occurredAtMs - right.occurredAtMs ||
    compareCodeUnits(left.venue, right.venue) ||
    compareCodeUnits(left.symbol, right.symbol) ||
    compareCodeUnits(left.tradeId, right.tradeId) ||
    compareCodeUnits(left.venueOrderId, right.venueOrderId) ||
    compareCodeUnits(canonicalJson(left), canonicalJson(right));
}

function normalizeFillSet(records: readonly Readonly<ObservedFillEvidence>[]): {
  records: readonly Readonly<ObservedFillEvidence>[];
  issues: readonly Readonly<NormalizationIssue>[];
  dropped: number;
  outOfOrderPairs: number;
} {
  let outOfOrderPairs = 0;
  for (let index = 1; index < records.length; index += 1) {
    if (compareFills(records[index - 1], records[index]) > 0) outOfOrderPairs += 1;
  }
  const exact = dedupeExact(records);
  const canonical: Readonly<ObservedFillEvidence>[] = [];
  const issues: Readonly<NormalizationIssue>[] = [];
  for (const [identity, group] of groupBy(
    exact.records,
    (record) => `${record.venue}|${record.symbol}|${record.tradeId}`,
  )) {
    const ordered = [...group].sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right)));
    canonical.push(ordered[0]);
    if (ordered.length > 1) {
      issues.push(issue(
        'CONFLICTING_FILL_IDENTITY',
        'FILLS',
        identity,
        ordered,
        'one scoped trade ID carries conflicting fill facts',
      ));
    }
  }
  canonical.sort(compareFills);
  return {
    records: Object.freeze(canonical),
    issues: Object.freeze(issues),
    dropped: exact.dropped,
    outOfOrderPairs,
  };
}

function normalizePositionSet(records: readonly Readonly<ObservedPositionEvidence>[]): {
  records: readonly Readonly<ObservedPositionEvidence>[];
  issues: readonly Readonly<NormalizationIssue>[];
  dropped: number;
} {
  const exact = dedupeExact(records);
  const canonical: Readonly<ObservedPositionEvidence>[] = [];
  const issues: Readonly<NormalizationIssue>[] = [];
  for (const [identity, group] of groupBy(
    exact.records,
    (record) => `${record.venue}|${record.symbol}|${record.positionSide}`,
  )) {
    const ordered = [...group].sort((left, right) =>
      left.observedAtMs - right.observedAtMs || compareCodeUnits(canonicalJson(left), canonicalJson(right))
    );
    canonical.push(ordered[ordered.length - 1]);
    if (ordered.length > 1) {
      issues.push(issue(
        'CONFLICTING_POSITION_IDENTITY',
        'POSITIONS',
        identity,
        ordered,
        'one position-side identity carries multiple non-identical snapshot facts',
      ));
    }
  }
  canonical.sort((left, right) =>
    compareCodeUnits(left.venue, right.venue) ||
    compareCodeUnits(left.symbol, right.symbol) ||
    compareCodeUnits(left.positionSide, right.positionSide)
  );
  return { records: Object.freeze(canonical), issues: Object.freeze(issues), dropped: exact.dropped };
}

/**
 * Validate, copy, deduplicate, and canonically order injected venue evidence.
 * The function is pure: `nowMs` is explicit, input is never mutated, and no
 * transport/timer/environment access exists in this lane.
 */
export function normalizeObservedEvidence(input: ObservedEvidenceInput, nowMs: number): Readonly<NormalizedObservedEvidence> {
  if (!isValidUtcMillis(nowMs)) throw new TypeError('normalizeObservedEvidence: nowMs must be valid UTC ms');
  const serializability = findSerializabilityIssues(input);
  if (serializability.length > 0) {
    throw new TypeError(
      `normalizeObservedEvidence: input must be canonical plain data (${serializability.map((item) => `${item.path}:${item.code}`).join(', ')})`,
    );
  }
  assertPlainObject(input, 'input');
  assertExactKeys(input as unknown as Record<string, unknown>, ['orders', 'fills', 'positions'], 'input');

  const rawOrders = normalizeCollection(
    input.orders,
    'input.orders',
    nowMs,
    normalizeOrder,
    (record) => record.updatedAtMs,
  );
  const rawFills = normalizeCollection(
    input.fills,
    'input.fills',
    nowMs,
    normalizeFill,
    (record) => record.occurredAtMs,
  );
  const rawPositions = normalizeCollection(
    input.positions,
    'input.positions',
    nowMs,
    normalizePosition,
    (record) => record.observedAtMs,
  );

  const orders = rawOrders.records === null
    ? { records: null, issues: [] as readonly Readonly<NormalizationIssue>[], dropped: 0 }
    : normalizeOrderSet(rawOrders.records);
  const fills = rawFills.records === null
    ? { records: null, issues: [] as readonly Readonly<NormalizationIssue>[], dropped: 0, outOfOrderPairs: 0 }
    : normalizeFillSet(rawFills.records);
  const positions = rawPositions.records === null
    ? { records: null, issues: [] as readonly Readonly<NormalizationIssue>[], dropped: 0 }
    : normalizePositionSet(rawPositions.records);

  const issues = [...orders.issues, ...fills.issues, ...positions.issues].sort((left, right) =>
    compareCodeUnits(left.evidenceKind, right.evidenceKind) ||
    compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(left.identity, right.identity)
  );
  const stats = Object.freeze({
    exactDuplicateOrdersDropped: orders.dropped,
    exactDuplicateFillsDropped: fills.dropped,
    exactDuplicatePositionsDropped: positions.dropped,
    outOfOrderFillPairs: fills.outOfOrderPairs,
  });

  return Object.freeze({
    evaluatedAtMs: nowMs,
    orders: Object.freeze({ ...rawOrders, records: orders.records }),
    fills: Object.freeze({ ...rawFills, records: fills.records }),
    positions: Object.freeze({ ...rawPositions, records: positions.records }),
    issues: Object.freeze(issues),
    stats,
  });
}
