import {
  canonicalJson,
  stableHash128Hex,
} from '../../../foundation/contracts/index.js';
import {
  type NormalBasisFoundationBinding,
  type NormalBasisFoundationCheckpointHydrator,
  type NormalBasisFoundationStateView,
} from './types.js';

const CHECKPOINT_SCHEMA = 'cosmos.foundation.execution.checkpoint';
const MAX_CHECKPOINT_BYTES = 1_000_000;

export function cloneFreezeNormalBasis<T>(value: T): Readonly<T> {
  const copy = structuredClone(value) as T;
  const seen = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (typeof candidate !== 'object' || candidate === null || seen.has(candidate)) return;
    seen.add(candidate);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(candidate))) {
      if (Object.hasOwn(descriptor, 'value')) visit(descriptor.value);
    }
    Object.freeze(candidate);
  };
  visit(copy);
  return copy as Readonly<T>;
}

export interface HydratedNormalBasisOwnerCheckpoint {
  readonly serialized: string;
  readonly checksum: string;
  readonly checkpointRevision: string;
  readonly state: Readonly<NormalBasisFoundationStateView>;
}

function parseCheckpoint(serialized: string): Readonly<Record<string, unknown>> {
  if (typeof serialized !== 'string' || serialized.length === 0
    || serialized.length > MAX_CHECKPOINT_BYTES) {
    throw new TypeError('canonical Foundation checkpoint bytes are required within the closed bound');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError('canonical Foundation checkpoint is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(',') !== 'checksum,planId,revision,schema,state,version'
    || canonicalJson(parsed) !== serialized) {
    throw new TypeError('canonical Foundation checkpoint envelope is not exact');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function validateLegs(
  state: Readonly<NormalBasisFoundationStateView>,
  binding: Readonly<NormalBasisFoundationBinding>,
): void {
  for (const phase of ['OPEN', 'CLOSE'] as const) {
    const states = phase === 'OPEN' ? state.openingLegs : state.closingLegs;
    const definitions = phase === 'OPEN'
      ? binding.ownerPlan.openingLegs : binding.ownerPlan.closingLegs;
    for (const key of ['SPOT', 'PERP'] as const) {
      const leg = states?.[key];
      if (canonicalJson(leg?.definition) !== canonicalJson(definitions[key])
        || !Number.isFinite(leg?.submittedQuantity) || leg.submittedQuantity < 0
        || !Number.isFinite(leg.cumulativeFilledQuantity)
        || leg.cumulativeFilledQuantity < 0
        || leg.cumulativeFilledQuantity > leg.submittedQuantity
        || (leg.venueOrderId !== null
          && (typeof leg.venueOrderId !== 'string' || leg.venueOrderId.length === 0))) {
        throw new TypeError('hydrated Foundation checkpoint leg truth is not exact');
      }
    }
  }
}

/**
 * Calls the injected canonical Foundation restore seam, then independently
 * binds its replayed state to the exact canonical checkpoint envelope.
 */
export function hydrateNormalBasisOwnerCheckpoint(
  binding: Readonly<NormalBasisFoundationBinding>,
  serializedValue: string,
  hydrator: Readonly<NormalBasisFoundationCheckpointHydrator>,
): Readonly<HydratedNormalBasisOwnerCheckpoint> {
  const parsed = parseCheckpoint(serializedValue);
  if (typeof hydrator?.hydrateExecutionCheckpoint !== 'function') {
    throw new TypeError('canonical Foundation checkpoint hydrator is required');
  }
  const restored = hydrator.hydrateExecutionCheckpoint(serializedValue);
  if (restored?.ok !== true) {
    throw new TypeError(`canonical Foundation checkpoint hydration failed${
      restored && 'code' in restored ? ` (${restored.code})` : ''
    }`);
  }
  const state = cloneFreezeNormalBasis(restored.state);
  const { checksum, ...payload } = parsed;
  const expectedChecksum = stableHash128Hex(canonicalJson(payload));
  if (parsed.schema !== CHECKPOINT_SCHEMA || parsed.version !== 1
    || typeof checksum !== 'string' || checksum !== expectedChecksum
    || parsed.planId !== binding.ownerPlan.planId
    || parsed.revision !== state.revision
    || canonicalJson(parsed.state) !== canonicalJson(state)
    || canonicalJson(state.plan) !== canonicalJson(binding.ownerPlan)
    || !Number.isSafeInteger(state.revision) || state.revision <= 0
    || typeof state.stateRevisionId !== 'string'
    || !/^rev_[0-9a-f]{16}$/.test(state.stateRevisionId)
    || !Number.isSafeInteger(state.lastSequence) || state.lastSequence !== state.revision
    || !Array.isArray(state.eventLog) || state.eventLog.length !== state.lastSequence
    || state.eventLog.at(-1)?.sequence !== state.lastSequence) {
    throw new TypeError('hydrated Foundation state does not match its replay-verified checkpoint');
  }
  validateLegs(state, binding);
  return Object.freeze({
    serialized: serializedValue,
    checksum,
    checkpointRevision: `l09checkpoint_${stableHash128Hex(serializedValue)}`,
    state,
  });
}
