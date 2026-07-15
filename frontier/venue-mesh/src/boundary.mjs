import { asRecord, deepFreeze } from './guards.mjs';
import { fail } from './errors.mjs';

const FORBIDDEN_EFFECT_KEYS = new Set([
  'order',
  'orders',
  'orderInstruction',
  'orderRequest',
  'clientOrderId',
  'timeInForce',
  'execute',
  'executionRequest',
  'borrow',
  'repay',
  'transfer',
  'withdraw',
  'withdrawal',
  'leverage',
  'marginMutation',
  'privateEndpoint',
  'signature',
  'credentials',
  'apiKey',
  'secret',
  'canonicalWrite',
  'persist',
  'deploy',
  'mount',
]);

function inspect(value, path, seen) {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) fail('BOUNDARY_CYCLE_INVALID', `cyclic value at ${path}`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_EFFECT_KEYS.has(key)) fail('OBSERVATION_EFFECT_FIELD_FORBIDDEN', `${path}.${key} would widen the module into an effect surface`);
    inspect(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

export function assertObservationBoundary(value) {
  asRecord(value, 'observation boundary value');
  inspect(value, 'value', new WeakSet());
  if (value.canonical === true) fail('OBSERVATION_CANONICAL_FORBIDDEN', 'VenueMesh output cannot claim canonical truth');
  if (value.authorityClass !== undefined && value.authorityClass !== 'NO_AUTHORITY') fail('OBSERVATION_AUTHORITY_FORBIDDEN', 'VenueMesh output cannot claim authority');
  if (value.networkMode !== undefined && value.networkMode !== 'FIXTURE_ONLY') fail('OBSERVATION_NETWORK_FORBIDDEN', 'VenueMesh prestage output must remain fixture-only');
  return true;
}

export function sealObservation(value) {
  assertObservationBoundary(value);
  return deepFreeze(value);
}
