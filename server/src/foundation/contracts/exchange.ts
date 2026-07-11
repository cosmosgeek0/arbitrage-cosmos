/**
 * Foundation contracts — exchange boundary vocabulary (WAVE 0, frozen).
 *
 * Venue identity, transport outcome vocabulary, and the deterministic
 * client-order ID kernel for the Lane F USD-M boundary. No transport, no
 * signing, no endpoints here — those are Lane F, transport-injected.
 *
 * CLIENT-ORDER ID CONSTRAINT (Binance): `newClientOrderId` must match
 * ^[\.A-Z\:/a-z0-9_-]{1,36}$ per current official docs. We deliberately
 * emit only the conservative subset [a-zA-Z0-9_-] and cap at 36 chars so
 * the same ID is safe on spot and USD-M futures alike. Re-verify against
 * current official Binance documentation at Lane F implementation time.
 *
 * Pure module: no I/O, no clocks, no env, no import-time side effects.
 */
import { stableHash128Hex, canonicalJson } from './identity.js';

// ---------- venue / transport vocabulary ----------

export const VENUES = ['BINANCE_SPOT', 'BINANCE_USDM'] as const;
export type Venue = (typeof VENUES)[number];

export function isVenue(value: unknown): value is Venue {
  return typeof value === 'string' && (VENUES as readonly string[]).includes(value);
}

/**
 * What actually happened at the transport layer. AMBIGUOUS is a first-class
 * outcome: a lost response is NOT a failure and NOT a success — the order
 * may or may not exist at the venue until reconciliation proves it.
 */
export const TRANSPORT_OUTCOMES = [
  'SUCCESS',
  'REJECTED',
  'TIMEOUT',
  'ABORTED',
  'AMBIGUOUS',
  'MALFORMED',
] as const;
export type TransportOutcome = (typeof TRANSPORT_OUTCOMES)[number];

export function isTransportOutcome(value: unknown): value is TransportOutcome {
  return typeof value === 'string' && (TRANSPORT_OUTCOMES as readonly string[]).includes(value);
}

// ---------- client-order ID ----------

export const CLIENT_ORDER_ID_MAX_LENGTH = 36;
/** Conservative charset accepted by both Binance spot and USD-M futures. */
export const CLIENT_ORDER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,36}$/;

export function isValidClientOrderId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_ORDER_ID_PATTERN.test(value);
}

export interface ClientOrderIdInput {
  /** Deterministic plan ID (plan_*). */
  planId: string;
  /** Deterministic leg ID (leg_*). */
  legId: string;
  /** 0-based submission attempt for this leg (bounded: 0..999). */
  attempt: number;
}

/**
 * Deterministic client-order ID: same (plan, leg, attempt) => same ID,
 * forever. That is what makes lost-response reconciliation possible — the
 * venue can be asked "does THIS id exist?" after a crash. Never derived
 * from array position or wall clock.
 *
 * Format: `cx-<24 hex>-<attempt>` (max 3+1+24+1+3 = 32 chars <= 36).
 */
export function deriveClientOrderId(input: ClientOrderIdInput): string {
  if (typeof input.planId !== 'string' || input.planId.trim().length === 0 || input.planId.length > 256) {
    throw new TypeError('deriveClientOrderId: planId must be a non-empty string (<=256 chars)');
  }
  if (typeof input.legId !== 'string' || input.legId.trim().length === 0 || input.legId.length > 256) {
    throw new TypeError('deriveClientOrderId: legId must be a non-empty string (<=256 chars)');
  }
  if (
    typeof input.attempt !== 'number' ||
    !Number.isSafeInteger(input.attempt) ||
    input.attempt < 0 ||
    input.attempt > 999
  ) {
    throw new TypeError('deriveClientOrderId: attempt must be an integer in [0, 999]');
  }
  const digest = stableHash128Hex(
    `clientOrder|${canonicalJson({ planId: input.planId, legId: input.legId, attempt: input.attempt })}`,
  ).slice(0, 24);
  const id = `cx-${digest}-${input.attempt}`;
  // Defense in depth: the format above cannot violate the constraint, but a
  // client-order ID that somehow did must never leave this function.
  if (!isValidClientOrderId(id)) {
    throw new TypeError(`deriveClientOrderId: derived ID violates venue constraint: ${id}`);
  }
  return id;
}
