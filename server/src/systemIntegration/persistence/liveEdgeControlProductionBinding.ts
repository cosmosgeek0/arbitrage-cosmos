import type { LedgerPersistencePort } from './types.js';
import {
  LiveEdgeControlPersistenceAdapter,
  type CanonicalCheckpointStateOwnerPort,
  type CanonicalControlReservationStateOwnerPort,
  type CanonicalNumericConfigurationVersionPort,
  type LiveEdgeControlPersistenceClock,
} from './liveEdgeControlPersistenceAdapter.js';

export const LIVE_EDGE_CONTROL_PRODUCTION_BINDING_SCHEMA =
  'SYSTEM_INTEGRATION_L14_PRODUCTION_BINDING_V1' as const;

export type LiveEdgeControlProductionActivationState =
  | 'AVAILABLE'
  | 'OWNER_GATED';

export interface LiveEdgeControlProductionBinding {
  readonly schema: typeof LIVE_EDGE_CONTROL_PRODUCTION_BINDING_SCHEMA;
  readonly version: 1;
  readonly wiringState: 'STRUCTURALLY_INTEGRATED';
  readonly activationState: LiveEdgeControlProductionActivationState;
  readonly persistenceOwner: 'SYSTEM_INTEGRATION_LEDGER';
  readonly controlOwner: 'FOUNDATION_CONTROL';
  readonly configurationVersionOwner: 'CANONICAL_NUMERIC_CONFIGURATION_OWNER' | null;
  readonly persistence: LiveEdgeControlPersistenceAdapter | null;
  readonly reasonCodes: readonly string[];
  readonly commandDispatchAvailable: false;
  readonly externalActionAuthorization: 'NONE';
}

export interface LiveEdgeControlProductionBindingOptions {
  readonly ledger: LedgerPersistencePort;
  readonly clock: LiveEdgeControlPersistenceClock;
  readonly configurationVersion?: CanonicalNumericConfigurationVersionPort | null;
  readonly checkpointOwner?: CanonicalCheckpointStateOwnerPort | null;
  readonly controlStateOwner?: CanonicalControlReservationStateOwnerPort | null;
}

function gated(reasonCodes: readonly string[]): Readonly<LiveEdgeControlProductionBinding> {
  return Object.freeze({
    schema: LIVE_EDGE_CONTROL_PRODUCTION_BINDING_SCHEMA,
    version: 1 as const,
    wiringState: 'STRUCTURALLY_INTEGRATED' as const,
    activationState: 'OWNER_GATED' as const,
    persistenceOwner: 'SYSTEM_INTEGRATION_LEDGER' as const,
    controlOwner: 'FOUNDATION_CONTROL' as const,
    configurationVersionOwner: null,
    persistence: null,
    reasonCodes: Object.freeze([...reasonCodes]),
    commandDispatchAvailable: false as const,
    externalActionAuthorization: 'NONE' as const,
  });
}

/**
 * Structural L14 composition boundary. Production may expose the accepted
 * persistence adapter only when all four canonical owners are present. It
 * never invents a numeric configuration revision and never exposes dispatch.
 */
export function createLiveEdgeControlProductionBinding(
  options: Readonly<LiveEdgeControlProductionBindingOptions>,
): Readonly<LiveEdgeControlProductionBinding> {
  if (!options?.ledger || typeof options.clock?.nowMs !== 'function') {
    throw new TypeError('L14 production binding requires the canonical Ledger and injected clock');
  }
  const reasons: string[] = [];
  if (typeof options.configurationVersion?.read !== 'function') {
    reasons.push('CANONICAL_NUMERIC_CONFIGURATION_VERSION_NOT_CONFIGURED');
  }
  if (typeof options.checkpointOwner?.load !== 'function') {
    reasons.push('CANONICAL_CHECKPOINT_OWNER_NOT_BOUND');
  }
  if (typeof options.controlStateOwner?.synchronizeReservedRevision !== 'function') {
    reasons.push('CANONICAL_CONTROL_RESERVATION_OWNER_NOT_BOUND');
  }
  if (reasons.length > 0) {
    reasons.push('L14_COMMAND_OWNER_ACTIVATION_OWNER_GATED');
    return gated(reasons);
  }

  let numericConfigurationVersion: number | null = null;
  try {
    const nowMs = options.clock.nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      reasons.push('CANONICAL_CONFIGURATION_VERSION_PROBE_CLOCK_INVALID');
    } else {
      const loaded = options.checkpointOwner!.load(nowMs, 'l14.production.binding');
      if (!loaded.ok || loaded.state === undefined) {
        reasons.push('CANONICAL_CHECKPOINT_READBACK_UNAVAILABLE');
      } else {
        numericConfigurationVersion = options.configurationVersion!.read(loaded.state);
        if (!Number.isSafeInteger(numericConfigurationVersion)
            || (numericConfigurationVersion as number) < 0) {
          reasons.push('CANONICAL_NUMERIC_CONFIGURATION_VERSION_NOT_CONFIGURED');
        }
      }
    }
  } catch {
    reasons.push('CANONICAL_NUMERIC_CONFIGURATION_VERSION_READ_FAILED');
  }
  if (reasons.length > 0 || numericConfigurationVersion === null) {
    reasons.push('L14_COMMAND_OWNER_ACTIVATION_OWNER_GATED');
    return gated([...new Set(reasons)]);
  }

  const persistence = new LiveEdgeControlPersistenceAdapter({
    ledger: options.ledger,
    clock: options.clock,
    configurationVersion: options.configurationVersion as CanonicalNumericConfigurationVersionPort,
    checkpointOwner: options.checkpointOwner as CanonicalCheckpointStateOwnerPort,
    controlStateOwner: options.controlStateOwner as CanonicalControlReservationStateOwnerPort,
  });
  return Object.freeze({
    schema: LIVE_EDGE_CONTROL_PRODUCTION_BINDING_SCHEMA,
    version: 1 as const,
    wiringState: 'STRUCTURALLY_INTEGRATED' as const,
    activationState: 'AVAILABLE' as const,
    persistenceOwner: 'SYSTEM_INTEGRATION_LEDGER' as const,
    controlOwner: 'FOUNDATION_CONTROL' as const,
    configurationVersionOwner: 'CANONICAL_NUMERIC_CONFIGURATION_OWNER' as const,
    persistence,
    reasonCodes: Object.freeze([]),
    commandDispatchAvailable: false as const,
    externalActionAuthorization: 'NONE' as const,
  });
}
