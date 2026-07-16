import type { SystemTruthLabel } from '../../systemIntegration/contracts/constants.js';
import {
  PRODUCT_RUNTIME_CURSOR_SCHEMA,
  ProductRuntimeError,
  type ProductRuntimeMaterialEventPage,
  type ProductRuntimeMaterialSourcePage,
  type ProductRuntimeTruthLabel,
} from './types.js';

const DECIMAL_CURSOR = /^(0|[1-9][0-9]{0,18})$/;
const SQLITE_ROW_ID_MAX = 9_223_372_036_854_775_807n;

export function isProductRuntimeCursor(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_CURSOR.test(value) && BigInt(value) <= SQLITE_ROW_ID_MAX;
}

export function isProductRuntimeRowCursor(value: unknown): value is string {
  return isProductRuntimeCursor(value) && value !== '0';
}

export function productTruthLabel(value: SystemTruthLabel): ProductRuntimeTruthLabel {
  if (value === 'LIVE_PUBLIC') return 'LIVE_PUBLIC';
  if (value === 'DRY_RUN') return 'BUILT_AND_TESTED';
  if (value === 'SYNTHETIC_ONLY') return 'SYNTHETIC_ONLY';
  if (value === 'RECORDED_REPLAY') return 'IMPORTED';
  if (value === 'UNAVAILABLE') return 'UNAVAILABLE';
  return 'UNKNOWN';
}

type MaterialEventPageMode = ProductRuntimeMaterialEventPage['mode'];
type MaterialEventMissingReason = NonNullable<ProductRuntimeMaterialEventPage['missingRange']>['reason'];

function missingRange(
  from: bigint,
  to: bigint,
  reason: MaterialEventMissingReason,
): NonNullable<ProductRuntimeMaterialEventPage['missingRange']> | null {
  return from <= to
    ? Object.freeze({ fromCursor: from.toString(), toCursor: to.toString(), reason })
    : null;
}

function unproven(
  afterCursor: string,
  mode: MaterialEventPageMode,
  retainedFromCursor: string | null = null,
  highWaterCursor: string = afterCursor,
): Readonly<ProductRuntimeMaterialEventPage> {
  const after = BigInt(afterCursor);
  const highWater = isProductRuntimeCursor(highWaterCursor) ? BigInt(highWaterCursor) : after;
  return Object.freeze({
    schemaVersion: PRODUCT_RUNTIME_CURSOR_SCHEMA,
    mode,
    requestedAfterCursor: afterCursor,
    retainedFromCursor,
    highWaterCursor: highWater.toString(),
    nextCursor: afterCursor,
    hasMore: highWater > after,
    continuity: 'UNPROVEN',
    truncated: false,
    backfillRequired: true,
    missingRange: missingRange(after + 1n, highWater, 'EVIDENCE_UNPROVEN'),
    items: Object.freeze([]),
  });
}

/** Validate owner cursor evidence and project it without repairing or skipping gaps. */
export function projectProductMaterialEventPage(
  afterCursor: string,
  limit: number,
  source: Readonly<ProductRuntimeMaterialSourcePage>,
  mode: MaterialEventPageMode = 'CURSOR',
): Readonly<ProductRuntimeMaterialEventPage> {
  if (!isProductRuntimeCursor(afterCursor)) {
    throw new ProductRuntimeError('INVALID_MATERIAL_CURSOR', 'afterCursor must be a decimal cursor.', 400);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new ProductRuntimeError('QUERY_LIMIT_OUT_OF_BOUNDS', 'limit must be an integer from 1 through 500.', 400);
  }
  if (mode !== 'CURSOR' && mode !== 'TAIL_BOOTSTRAP') {
    throw new ProductRuntimeError('INVALID_MATERIAL_PAGE_MODE', 'material page mode is invalid.', 400);
  }
  if (!source || typeof source !== 'object' || source.requestedAfterCursor !== afterCursor
      || !isProductRuntimeCursor(source.highWaterCursor)
      || !(source.retainedFromCursor === null || isProductRuntimeRowCursor(source.retainedFromCursor))
      || !['PROVEN', 'GAP', 'UNPROVEN'].includes(source.continuity)
      || typeof source.truncated !== 'boolean'
      || !Array.isArray(source.items)) return unproven(afterCursor, mode);

  const after = BigInt(afterCursor);
  const highWater = BigInt(source.highWaterCursor);
  if (after > highWater || source.items.length > limit) {
    return unproven(afterCursor, mode, source.retainedFromCursor, source.highWaterCursor);
  }

  let continuity = source.continuity;
  let truncated = source.truncated;
  const retained = source.retainedFromCursor === null ? null : BigInt(source.retainedFromCursor);
  let absentRange: ProductRuntimeMaterialEventPage['missingRange'] = null;
  if ((retained === null && highWater > 0n) || (retained !== null && retained > highWater)) {
    continuity = 'UNPROVEN';
    absentRange = missingRange(after + 1n, highWater, 'EVIDENCE_UNPROVEN');
  } else if (retained !== null && after + 1n < retained) {
    continuity = 'GAP';
    truncated = true;
    absentRange = missingRange(after + 1n, retained - 1n, 'RETENTION_GAP');
  } else if (mode === 'TAIL_BOOTSTRAP' && after > 0n) {
    absentRange = missingRange(
      1n,
      after,
      retained !== null && retained > 1n ? 'RETENTION_GAP' : 'BOOTSTRAP_HISTORY_OMITTED',
    );
    if (retained !== null && retained > 1n) {
      // A retained floor above cursor 1 proves source history was lost. Tail
      // bootstrap may omit fully retained history, but it cannot convert a
      // retention gap into gap-free continuity.
      continuity = 'GAP';
      truncated = true;
    }
  }

  let expected = after + 1n;
  let malformed = false;
  const items = [];
  for (const record of source.items) {
    if (!record || typeof record !== 'object' || !isProductRuntimeRowCursor(record.cursor)
        || !record.event || typeof record.event !== 'object') {
      malformed = true;
      break;
    }
    const cursor = BigInt(record.cursor);
    if (cursor > highWater) {
      malformed = true;
      break;
    }
    if (cursor !== expected) {
      continuity = 'GAP';
      if (absentRange === null || absentRange.reason === 'BOOTSTRAP_HISTORY_OMITTED') {
        absentRange = missingRange(expected, cursor - 1n, 'INTERIOR_GAP');
      }
      break;
    }
    const event = record.event;
    if (typeof event.id !== 'string' || event.id.length === 0 || event.id.length > 160
        || typeof event.componentId !== 'string' || typeof event.kind !== 'string'
        || typeof event.correlationId !== 'string' || event.correlationId.length === 0
        || typeof event.occurredAtMs !== 'number' || !Number.isFinite(event.occurredAtMs)) {
      malformed = true;
      break;
    }
    items.push(Object.freeze({
      cursor: record.cursor,
      eventId: event.id,
      occurredAtMs: event.occurredAtMs,
      componentId: event.componentId,
      kind: event.kind,
      correlationId: event.correlationId,
      truthLabel: productTruthLabel(event.truthLabel),
    }));
    expected += 1n;
  }
  if (malformed) {
    return unproven(afterCursor, mode, source.retainedFromCursor, source.highWaterCursor);
  }
  if (items.length === 0 && highWater > after && continuity === 'PROVEN') {
    continuity = 'UNPROVEN';
    absentRange = missingRange(after + 1n, highWater, 'EVIDENCE_UNPROVEN');
  }
  if (continuity === 'GAP' && absentRange === null) {
    absentRange = missingRange(after + 1n, highWater, 'INTERIOR_GAP');
  } else if (continuity === 'UNPROVEN'
      && (absentRange === null || absentRange.reason === 'BOOTSTRAP_HISTORY_OMITTED')) {
    absentRange = missingRange(after + 1n, highWater, 'EVIDENCE_UNPROVEN');
  }
  const nextCursor = items.length > 0 ? items[items.length - 1]!.cursor : afterCursor;
  const backfillRequired = continuity !== 'PROVEN' || truncated;
  return Object.freeze({
    schemaVersion: PRODUCT_RUNTIME_CURSOR_SCHEMA,
    mode,
    requestedAfterCursor: afterCursor,
    retainedFromCursor: source.retainedFromCursor,
    highWaterCursor: source.highWaterCursor,
    nextCursor,
    hasMore: BigInt(nextCursor) < highWater,
    continuity,
    truncated,
    backfillRequired,
    missingRange: absentRange,
    items: Object.freeze(items),
  });
}
