import { deepFreeze, safeInteger } from './guards.mjs';
import { fail } from './errors.mjs';

function cursor(value, field) {
  if (value === null) return null;
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[0-9]+$/.test(String(value))) {
    fail('SEQUENCE_CURSOR_INVALID', `${field} must be unsigned integer text, a safe integer, or null`);
  }
  return BigInt(String(value));
}

export function evaluateSequence({
  previousLast,
  currentFirst,
  currentLast,
  previousConnectionGeneration = 0,
  connectionGeneration = previousConnectionGeneration,
  resnapshotEstablished = false,
}) {
  safeInteger(previousConnectionGeneration, 'sequence.previousConnectionGeneration', { minimum: 0 });
  safeInteger(connectionGeneration, 'sequence.connectionGeneration', { minimum: 0 });
  if (connectionGeneration < previousConnectionGeneration) fail('CONNECTION_GENERATION_REGRESSION', 'connection generation cannot regress');
  if (typeof resnapshotEstablished !== 'boolean') fail('RESNAPSHOT_FLAG_INVALID', 'resnapshotEstablished must be boolean');
  const previous = cursor(previousLast, 'sequence.previousLast');
  const first = cursor(currentFirst, 'sequence.currentFirst');
  const last = cursor(currentLast, 'sequence.currentLast');
  if ((first === null) !== (last === null)) fail('SEQUENCE_RANGE_INCOMPLETE', 'sequence first and last must both be present or absent');
  if (first === null) {
    return deepFreeze({ state: 'UNKNOWN', coherent: false, gapCount: null, resnapshotRequired: false, reasonCodes: ['SEQUENCE_UNAVAILABLE'] });
  }
  if (first > last) fail('SEQUENCE_RANGE_INVALID', 'sequence first cannot exceed sequence last');
  if (connectionGeneration > previousConnectionGeneration) {
    if (!resnapshotEstablished) {
      return deepFreeze({ state: 'RECONNECT_RESNAPSHOT_REQUIRED', coherent: false, gapCount: null, resnapshotRequired: true, reasonCodes: ['RECONNECT_WITHOUT_RESNAPSHOT'] });
    }
    return deepFreeze({ state: 'RESNAPSHOT_BASELINE', coherent: true, gapCount: 0, resnapshotRequired: false, reasonCodes: [] });
  }
  if (previous === null) {
    return deepFreeze({ state: 'BASELINE', coherent: true, gapCount: 0, resnapshotRequired: false, reasonCodes: [] });
  }
  if (last <= previous) {
    return deepFreeze({ state: last === previous ? 'DUPLICATE' : 'OUT_OF_ORDER', coherent: false, gapCount: 0, resnapshotRequired: false, reasonCodes: [last === previous ? 'DUPLICATE_EVENT' : 'OUT_OF_ORDER_EVENT'] });
  }
  if (first <= previous) {
    return deepFreeze({ state: 'OVERLAP', coherent: false, gapCount: 0, resnapshotRequired: true, reasonCodes: ['SEQUENCE_RANGE_OVERLAP'] });
  }
  if (first > previous + 1n) {
    const gap = first - previous - 1n;
    if (gap > BigInt(Number.MAX_SAFE_INTEGER)) fail('SEQUENCE_GAP_RANGE_INVALID', 'sequence gap exceeds safe reporting range');
    return deepFreeze({ state: 'GAP', coherent: false, gapCount: Number(gap), resnapshotRequired: true, reasonCodes: ['SEQUENCE_GAP'] });
  }
  return deepFreeze({ state: 'CONTIGUOUS', coherent: true, gapCount: 0, resnapshotRequired: false, reasonCodes: [] });
}
