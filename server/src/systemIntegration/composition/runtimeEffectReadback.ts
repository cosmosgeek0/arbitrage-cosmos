import type { SystemControlMutation } from '../contracts/types.js';
import type { SystemControlRuntimeEffectReadback } from '../controls/types.js';
import type { ManagedCompositionReadSnapshot } from './types.js';

const EFFECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}:[0-9]+:[0-9]+$/;
const TRANSITIONAL_PHASES = new Set([
  'VALIDATING',
  'STARTING',
  'PAUSING',
  'STOPPING',
]);

/**
 * Post-crash readback from the managed lifecycle owner. Stable posture can
 * prove desired-state convergence, but it cannot prove an edge-triggered
 * restart's original supervisor correlation or generation. Restart therefore
 * remains UNKNOWN after that evidence is lost. Transitional, failed, blocked,
 * or malformed truth also remains UNKNOWN.
 */
export function readManagedControlRuntimeEffect(
  effectId: string,
  mutation: Readonly<SystemControlMutation>,
  managed: Readonly<ManagedCompositionReadSnapshot>,
): SystemControlRuntimeEffectReadback {
  if (typeof effectId !== 'string' || !EFFECT_ID.test(effectId)
    || !mutation || typeof mutation !== 'object'
    || !managed || typeof managed !== 'object'
    || !managed.supervisor || typeof managed.supervisor !== 'object') return 'UNKNOWN';

  const { phase, desiredState } = managed.supervisor;
  if (TRANSITIONAL_PHASES.has(phase) || phase === 'FAILED' || phase === 'BLOCKED') return 'UNKNOWN';

  if (mutation.command === 'RESTART_COMPONENT') {
    if (mutation.componentId !== 'market-universe') return 'UNKNOWN';
    return 'UNKNOWN';
  }

  if (mutation.command !== 'SET_COMPONENT_STATE' || mutation.componentId !== 'market-universe') {
    return 'UNKNOWN';
  }
  if (mutation.desiredState === 'RUNNING') {
    if (desiredState === 'RUNNING' && (phase === 'RUNNING' || phase === 'DEGRADED')) return 'APPLIED';
    if (phase === 'STOPPED' || phase === 'PAUSED') return 'NOT_APPLIED';
    return 'UNKNOWN';
  }
  if (mutation.desiredState === 'PAUSED') {
    if (desiredState === 'PAUSED' && phase === 'PAUSED') return 'APPLIED';
    if (phase === 'RUNNING' || phase === 'DEGRADED' || phase === 'STOPPED') return 'NOT_APPLIED';
    return 'UNKNOWN';
  }
  if (mutation.desiredState === 'STOPPED') {
    if (desiredState === 'STOPPED' && phase === 'STOPPED'
      && managed.remainingOwnedComponentIds.length === 0) return 'APPLIED';
    if (phase === 'RUNNING' || phase === 'DEGRADED' || phase === 'PAUSED') return 'NOT_APPLIED';
  }
  return 'UNKNOWN';
}
