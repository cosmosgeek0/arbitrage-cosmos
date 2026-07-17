import { cloneFrozenJson, transition } from './kernel.mjs';
import { requireProperty } from './properties.mjs';

export const BASE_ASSUMPTIONS = Object.freeze([
  'The declared state and transition bounds cover the complete scenario envelope being claimed.',
  'Durable-store writes that are represented as successful are atomic, retained, and readable after restart.',
  'Authoritative reconciliation eventually returns a represented result or an explicit unavailable result under weak fairness.',
  'Lease compare-and-swap, expiry, and monotonic epoch operations behave as represented.',
  'The injected logical clock is monotonic inside the represented clock envelope.',
  'External facts and acknowledgements are delivered only through the represented bounded observability paths.',
  'Weak fairness of the represented non-stuttering Next relation excludes infinite stuttering while a progress transition remains continuously enabled.',
]);

export function next(state, actionId, patch) {
  return transition(actionId, { ...state, ...patch });
}

export function safety(propertyId, check) {
  requireProperty(propertyId, 'SAFETY');
  return Object.freeze({ propertyId, check });
}

export function liveness(propertyId, pending, fulfilled, {
  weakFairActions = [],
  strongFairActions = [],
} = {}) {
  requireProperty(propertyId, 'LIVENESS');
  return Object.freeze({
    propertyId,
    pending,
    fulfilled,
    weakFairActions: Object.freeze([...weakFairActions]),
    strongFairActions: Object.freeze([...strongFairActions]),
  });
}

export function defineModel({
  modelId,
  modelVersion = '1.0.0',
  title,
  profile = 'CANONICAL',
  bounds,
  assumptions = BASE_ASSUMPTIONS,
  initialState,
  enabledTransitions,
  safety: safetyProperties,
  liveness: livenessProperties,
  terminal,
  terminalClass,
}) {
  const frozenInitial = cloneFrozenJson(initialState);
  return Object.freeze({
    schemaVersion: 'ip-assurance.s3.protocol-model.v1',
    modelId,
    modelVersion,
    title,
    profile,
    authority: 'SUPPORTING_EVIDENCE_ONLY',
    bounds: Object.freeze({ ...bounds }),
    assumptions: Object.freeze([...assumptions]),
    initialStates: () => Object.freeze([frozenInitial]),
    enabledTransitions,
    safety: Object.freeze([...safetyProperties]),
    liveness: Object.freeze([...livenessProperties]),
    terminal,
    terminalClass,
  });
}

export function check(condition, detail) {
  return Object.freeze({ status: condition ? 'PASS' : 'FAIL', detail: condition ? null : detail });
}

export function unknown(detail) {
  return Object.freeze({ status: 'UNKNOWN', detail });
}
