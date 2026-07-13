import {
  bindSpotOrderTifCapability,
  preflightInstrumentSizing,
} from '../binanceInstrumentSpecs/sizing.js';
import {
  validateSpotOrderTifCapability,
} from '../binanceInstrumentSpecs/spotOrderTifCapability.js';
import type {
  BindBinanceSpotOrderTifCapabilityResult,
  InstrumentSizingResult,
} from '../binanceInstrumentSpecs/types.js';
import {
  reserveRateBudget,
  type BinanceRateReservationDecision,
} from '../binanceSignedKernel/rateBudget.js';
import { validateMutationJournalSnapshot } from '../durableMutationJournal/journal.js';
import type { MutationJournalSnapshot } from '../durableMutationJournal/types.js';

function requireOwnerValidatedTime(
  value: unknown,
  field: 'evaluatedAtMs' | 'atMs',
  suppliedAtMs: unknown,
  label: string,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(value as object, field);
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
    || descriptor.value !== suppliedAtMs) {
    throw new TypeError(`${label} must equal the supplied twin time`);
  }
}

/**
 * Reuses L04 as the sole owner of registry and sizing-request validation.
 * A rejected hostile input remains the canonical L04 blocked result. For an
 * owner-validated request, its evaluation time must be the injected venue time.
 */
export function evaluateExchangeTwinInstrumentPreflight(
  registrySnapshot: unknown,
  sizingRequest: unknown,
  venueAtMs: unknown,
): Readonly<InstrumentSizingResult> {
  const result = preflightInstrumentSizing(registrySnapshot, sizingRequest);
  if (!result.reasonCodes.includes('STATIC_PREFLIGHT_INPUT_REJECTED')) {
    requireOwnerValidatedTime(
      sizingRequest,
      'evaluatedAtMs',
      venueAtMs,
      'sizing request evaluatedAtMs',
    );
  }
  return result;
}

/**
 * Reuses the additive L08.1/L04 owner seam for one exact Spot LIMIT/TIF
 * capability. The current owner is rerun from its registry/request inputs;
 * callers cannot supply a positive capability projection. A valid request is
 * bound to the injected twin time exactly and every result remains non-sendable.
 */
export function evaluateExchangeTwinSpotOrderTifPreflight(
  registrySnapshot: unknown,
  sizingRequest: unknown,
  venueAtMs: unknown,
): BindBinanceSpotOrderTifCapabilityResult {
  const result = bindSpotOrderTifCapability(registrySnapshot, sizingRequest);
  if (result.ok || !result.reasonCodes.includes('SPOT_CAPABILITY_INPUT_REJECTED')) {
    requireOwnerValidatedTime(
      sizingRequest,
      'evaluatedAtMs',
      venueAtMs,
      'Spot sizing request evaluatedAtMs',
    );
  }
  if (!result.ok) return result;
  return Object.freeze({
    ok: true as const,
    binding: validateSpotOrderTifCapability(result.binding),
  });
}

/**
 * Reuses L03 as the sole owner of rate-state and reservation validation. The
 * supplied twin time is a binding assertion only; it does not create a clock.
 */
export function evaluateExchangeTwinRateReservation(
  rateState: unknown,
  reservationInput: unknown,
  atMs: unknown,
): BinanceRateReservationDecision {
  const decision = reserveRateBudget(rateState, reservationInput);
  requireOwnerValidatedTime(reservationInput, 'atMs', atMs, 'rate reservation atMs');
  return decision;
}

/** Reuses L06's canonical replay validator; no L07 journal projection exists. */
export function evaluateExchangeTwinMutationSnapshot(
  snapshotValue: unknown,
): Readonly<MutationJournalSnapshot> {
  const snapshot = validateMutationJournalSnapshot(snapshotValue);
  if (snapshot === null) throw new TypeError('L06 mutation snapshot is invalid');
  return snapshot;
}
