import type {
  ProductRuntimeMaterialEvent,
  ProductRuntimeMaterialEventPage,
  ProductRuntimeSupervisorEnvelope,
  ProductRuntimeTruthLabel,
} from './types.js';
import { isProductRuntimeCursor, isProductRuntimeRowCursor } from './events.js';

export const PRODUCT_RUNTIME_MATERIAL_DELIVERY_PAGE_LIMIT = 200;
export const PRODUCT_RUNTIME_SUPERVISOR_DELTA_SCHEMA = 'canonical-supervisor-delta.v1' as const;

export type ProductRuntimeMaterialDeliveryContinuity =
  | 'CONTINUOUS'
  | 'GAP_REQUIRES_BACKFILL'
  | 'TRUNCATED_REQUIRES_BACKFILL';

/**
 * Small invalidation projection derived only from the canonical Product
 * supervisor. It carries enough identity and posture for a browser to decide
 * that its bounded HTTP snapshot is stale without duplicating the supervisor.
 */
export interface ProductRuntimeSupervisorDelta {
  readonly schemaVersion: typeof PRODUCT_RUNTIME_SUPERVISOR_DELTA_SCHEMA;
  readonly revision: string;
  readonly truthLabel: ProductRuntimeTruthLabel;
  readonly overallPosture: string;
  readonly firstRootBlockerComponentId: string | null;
  readonly runtimeGeneration: number;
  readonly controlGeneration: number;
  readonly controlRevision: number;
  readonly safeMode: string;
  readonly killSwitchEngaged: boolean;
  readonly intakePaused: boolean;
}

/** Exact bounded public delivery page requested by IP-RUNTIME. */
export interface ProductRuntimeMaterialDeliveryPage {
  readonly afterCursor: string;
  readonly nextCursor: string;
  readonly events: readonly Readonly<ProductRuntimeMaterialEvent>[];
  readonly continuity: ProductRuntimeMaterialDeliveryContinuity;
  readonly missingFromCursor: string | null;
  readonly missingToCursor: string | null;
  readonly hasMore: boolean;
}

const PRODUCT_RUNTIME_TRUTH_LABELS: ReadonlySet<string> = new Set([
  'LIVE_PUBLIC',
  'WIRED',
  'BUILT_AND_TESTED',
  'IMPORTED',
  'SYNTHETIC_ONLY',
  'BLOCKED',
  'NOT_CONFIGURED',
  'UNAVAILABLE',
  'MISSING',
  'UNKNOWN',
]);
const SYSTEM_OVERALL_POSTURES: ReadonlySet<string> = new Set([
  'STOPPED', 'WARMING', 'READY', 'DEGRADED', 'BLOCKED', 'FAILED',
]);
const SYSTEM_SAFE_MODES: ReadonlySet<string> = new Set([
  'READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY',
]);

function boundedString(value: unknown, name: string, maxLength = 160): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) {
    throw new TypeError(`${name} must be a bounded non-empty string`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return Number(value);
}

/** Parse the optional durable resume cursor without silently repairing it. */
export function parseProductRuntimeMaterialDeliveryAfterCursor(requestUrl: string | undefined): string | null {
  try {
    const url = new URL(requestUrl ?? '/ws', 'http://localhost');
    const values = url.searchParams.getAll('afterCursor');
    if (values.length > 1) return null;
    const value = values[0] ?? '0';
    return isProductRuntimeCursor(value) ? value : null;
  } catch {
    return null;
  }
}

export function projectProductRuntimeSupervisorDelta(
  envelope: Readonly<ProductRuntimeSupervisorEnvelope>,
): Readonly<ProductRuntimeSupervisorDelta> {
  if (!envelope || typeof envelope !== 'object' || !envelope.dashboard || !envelope.dashboard.control) {
    throw new TypeError('canonical supervisor envelope is unavailable');
  }
  const dashboard = envelope.dashboard;
  const control = dashboard.control;
  const truthLabel = boundedString(envelope.truthLabel, 'truthLabel', 32) as ProductRuntimeTruthLabel;
  const overallPosture = boundedString(dashboard.overallPosture, 'overallPosture', 32);
  const safeMode = boundedString(control.safeMode, 'safeMode', 32);
  if (!PRODUCT_RUNTIME_TRUTH_LABELS.has(truthLabel)
      || !SYSTEM_OVERALL_POSTURES.has(overallPosture)
      || !SYSTEM_SAFE_MODES.has(safeMode)) {
    throw new TypeError('canonical supervisor posture is invalid');
  }
  const firstRootBlockerComponentId = dashboard.firstRootBlockerComponentId;
  if (!(firstRootBlockerComponentId === null
      || (typeof firstRootBlockerComponentId === 'string'
        && firstRootBlockerComponentId.length > 0
        && firstRootBlockerComponentId.length <= 128))) {
    throw new TypeError('firstRootBlockerComponentId must be null or a bounded identifier');
  }
  if (typeof control.killSwitchEngaged !== 'boolean' || typeof control.intakePaused !== 'boolean') {
    throw new TypeError('canonical supervisor control booleans are invalid');
  }
  return Object.freeze({
    schemaVersion: PRODUCT_RUNTIME_SUPERVISOR_DELTA_SCHEMA,
    revision: boundedString(envelope.revision, 'revision', 256),
    truthLabel,
    overallPosture,
    firstRootBlockerComponentId,
    runtimeGeneration: nonNegativeInteger(dashboard.runtimeGeneration, 'runtimeGeneration'),
    controlGeneration: nonNegativeInteger(dashboard.controlGeneration, 'controlGeneration'),
    controlRevision: nonNegativeInteger(control.revision, 'controlRevision'),
    safeMode,
    killSwitchEngaged: control.killSwitchEngaged,
    intakePaused: control.intakePaused,
  });
}

export function projectProductRuntimeMaterialDeliveryPage(
  afterCursor: string,
  page: Readonly<ProductRuntimeMaterialEventPage>,
): Readonly<ProductRuntimeMaterialDeliveryPage> {
  if (!isProductRuntimeCursor(afterCursor)
      || !page || typeof page !== 'object' || page.requestedAfterCursor !== afterCursor) {
    throw new TypeError('material-event page does not match the requested cursor');
  }
  if (page.mode !== 'CURSOR') throw new TypeError('material-event delivery page must use CURSOR mode');
  if (!isProductRuntimeCursor(page.nextCursor)) throw new TypeError('material-event next cursor is invalid');
  if (BigInt(page.nextCursor) < BigInt(afterCursor)) throw new TypeError('material-event next cursor regressed');
  if (!Array.isArray(page.items) || page.items.length > PRODUCT_RUNTIME_MATERIAL_DELIVERY_PAGE_LIMIT) {
    throw new TypeError('material-event page exceeds the delivery bound');
  }
  if (typeof page.hasMore !== 'boolean') throw new TypeError('material-event hasMore evidence is invalid');
  const missingFromCursor = page.missingRange?.fromCursor ?? null;
  const missingToCursor = page.missingRange?.toCursor ?? null;
  if ((missingFromCursor === null) !== (missingToCursor === null)
      || (missingFromCursor !== null && !isProductRuntimeRowCursor(missingFromCursor))
      || (missingToCursor !== null && !isProductRuntimeRowCursor(missingToCursor))
      || (missingFromCursor !== null && missingToCursor !== null
        && BigInt(missingFromCursor) > BigInt(missingToCursor))) {
    throw new TypeError('material-event missing cursor range is invalid');
  }
  const retentionLoss = page.truncated || page.missingRange?.reason === 'RETENTION_GAP';
  const continuity: ProductRuntimeMaterialDeliveryContinuity = retentionLoss
    ? 'TRUNCATED_REQUIRES_BACKFILL'
    : page.continuity === 'PROVEN'
      ? 'CONTINUOUS'
      : 'GAP_REQUIRES_BACKFILL';
  return Object.freeze({
    afterCursor,
    nextCursor: page.nextCursor,
    events: Object.freeze([...page.items]),
    continuity,
    missingFromCursor,
    missingToCursor,
    hasMore: page.hasMore,
  });
}
