/**
 * Foundation reconciliation -> Volume focus, read-only and deliberately
 * lossy. This adapter accepts normalized owner truth only and emits symbols,
 * freshness, and authority—never order IDs, quantities, sides, prices,
 * credentials, a refresh method, or any other private transport capability.
 */
import type { NormalizedObservedEvidence } from '../../foundation/reconciliation/index.js';
import {
  OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
  OBSERVED_ORDER_FOCUS_MAX_AGE_MS,
  type ObservedOrderFocusAuthority,
  type ObservedOrderFocusSnapshot,
} from '../../engine/volume/observedOrderFocus.js';

const ACTIVE_STATUSES = new Set(['NEW', 'PARTIALLY_FILLED']);
const ACCEPTED_AUTHORITIES = new Set(['LIVE_PRIVATE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST']);

function acceptedAuthority(value: string): value is Exclude<ObservedOrderFocusAuthority, 'UNAVAILABLE'> {
  return ACCEPTED_AUTHORITIES.has(value);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function unavailable(
  evidence: Readonly<NormalizedObservedEvidence>,
  reasons: readonly string[],
): Readonly<ObservedOrderFocusSnapshot> {
  const metadata = evidence.orders.metadata;
  return Object.freeze({
    sourceOwner: OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
    sourceId: metadata.sourceId,
    authority: acceptedAuthority(metadata.authority) ? metadata.authority : 'UNAVAILABLE',
    state: 'UNAVAILABLE',
    observedAtMs: metadata.sourceTimeMs ?? metadata.receivedAtMs,
    validUntilMs: null,
    openSymbols: null,
    reasonCodes: sortedUnique(reasons),
  });
}

export function projectObservedOrderFocus(
  evidence: Readonly<NormalizedObservedEvidence>,
): Readonly<ObservedOrderFocusSnapshot> {
  const orders = evidence.orders;
  const reasons: string[] = [];
  if (orders.metadata.completeness !== 'COMPLETE') reasons.push('OPEN_ORDER_TRUTH_NOT_COMPLETE');
  if (orders.freshness !== 'FRESH') reasons.push(`OPEN_ORDER_TRUTH_${orders.freshness}`);
  if (!acceptedAuthority(orders.metadata.authority)) reasons.push('OPEN_ORDER_PRIVATE_AUTHORITY_REQUIRED');
  if (orders.records === null) reasons.push('OPEN_ORDER_RECORDS_UNAVAILABLE');
  if (evidence.issues.some((issue) => issue.evidenceKind === 'ORDERS')) reasons.push('OPEN_ORDER_IDENTITY_CONFLICT');
  if (orders.records?.some((order) => order.status === 'UNKNOWN')) reasons.push('OPEN_ORDER_STATUS_UNKNOWN');

  const observedAtMs = orders.metadata.sourceTimeMs ?? orders.metadata.receivedAtMs;
  const validUntilMs = observedAtMs + orders.metadata.maxAgeMs;
  if (!Number.isSafeInteger(validUntilMs) || validUntilMs > 4_102_444_800_000) {
    reasons.push('OPEN_ORDER_VALIDITY_HORIZON_INVALID');
  }
  if (orders.metadata.maxAgeMs > OBSERVED_ORDER_FOCUS_MAX_AGE_MS) reasons.push('OPEN_ORDER_MAX_AGE_EXCEEDED');
  if (reasons.length > 0 || orders.records === null) return unavailable(evidence, reasons);

  const openSymbols = sortedUnique(
    orders.records.filter((order) => ACTIVE_STATUSES.has(order.status)).map((order) => order.symbol),
  );
  return Object.freeze({
    sourceOwner: OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
    sourceId: orders.metadata.sourceId,
    authority: orders.metadata.authority as Exclude<ObservedOrderFocusAuthority, 'UNAVAILABLE'>,
    state: 'AVAILABLE',
    observedAtMs,
    validUntilMs,
    openSymbols,
    reasonCodes: Object.freeze([]),
  });
}
