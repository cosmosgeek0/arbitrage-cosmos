import { deepFreeze, enumValue, safeInteger, utcMillis } from './guards.mjs';
import { fail } from './errors.mjs';

export const TIMESTAMP_UNITS = Object.freeze(['S', 'MS', 'US', 'NS', 'RFC3339']);
const UNIT_TO_NS = Object.freeze({ S: 1_000_000_000n, MS: 1_000_000n, US: 1_000n, NS: 1n });

function numericTimestamp(value, field) {
  if (typeof value === 'number') {
    safeInteger(value, field);
    return BigInt(value);
  }
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) fail('TIMESTAMP_RAW_INVALID', `${field} must be unsigned integer text or a safe integer`);
  return BigInt(value);
}

export function normalizeTimestamp({ raw, unit, expectedUnit = unit, receiveTimeMs, maximumFutureSkewMs = 0 }) {
  enumValue(unit, TIMESTAMP_UNITS, 'timestamp.unit');
  enumValue(expectedUnit, TIMESTAMP_UNITS, 'timestamp.expectedUnit');
  utcMillis(receiveTimeMs, 'timestamp.receiveTimeMs');
  safeInteger(maximumFutureSkewMs, 'timestamp.maximumFutureSkewMs', { minimum: 0 });
  if (unit !== expectedUnit) fail('TIMESTAMP_UNIT_MISMATCH', `declared unit ${unit} does not match expected unit ${expectedUnit}`);

  let eventTimeMs;
  let rawText;
  let subMillisecondRemainderNs = '0';
  if (unit === 'RFC3339') {
    if (typeof raw !== 'string' || !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(raw)) {
      fail('TIMESTAMP_RFC3339_INVALID', 'RFC3339 timestamps require an explicit UTC offset');
    }
    const parsed = Date.parse(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 0) fail('TIMESTAMP_RFC3339_INVALID', 'RFC3339 timestamp is outside the supported UTC range');
    eventTimeMs = parsed;
    rawText = raw;
  } else {
    const value = numericTimestamp(raw, 'timestamp.raw');
    const totalNs = value * UNIT_TO_NS[unit];
    const milliseconds = totalNs / 1_000_000n;
    const remainder = totalNs % 1_000_000n;
    if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) fail('TIMESTAMP_RANGE_INVALID', 'timestamp does not fit safe UTC milliseconds');
    eventTimeMs = Number(milliseconds);
    rawText = value.toString();
    subMillisecondRemainderNs = remainder.toString();
  }
  if (eventTimeMs > receiveTimeMs + maximumFutureSkewMs) {
    fail('TIMESTAMP_FUTURE_SKEW', 'source event time exceeds the allowed receive-clock skew');
  }
  return deepFreeze({ raw: rawText, unit, eventTimeMs, subMillisecondRemainderNs });
}

export function evaluateFreshness({ eventTimeMs, receiveTimeMs, evaluatedAtMs, maximumAgeMs }) {
  utcMillis(receiveTimeMs, 'freshness.receiveTimeMs');
  utcMillis(evaluatedAtMs, 'freshness.evaluatedAtMs');
  safeInteger(maximumAgeMs, 'freshness.maximumAgeMs', { minimum: 1 });
  if (eventTimeMs !== null) utcMillis(eventTimeMs, 'freshness.eventTimeMs');
  const basisTimeMs = eventTimeMs ?? receiveTimeMs;
  const basis = eventTimeMs === null ? 'RECEIVE_TIME' : 'SOURCE_EVENT_TIME';
  if (receiveTimeMs > evaluatedAtMs || basisTimeMs > evaluatedAtMs) {
    return deepFreeze({ state: 'UNKNOWN', basis, ageMs: null, maximumAgeMs, coherence: 'INCOHERENT', reasonCodes: ['NEGATIVE_AGE_OR_FUTURE_INPUT'] });
  }
  const ageMs = evaluatedAtMs - basisTimeMs;
  return deepFreeze({
    state: ageMs <= maximumAgeMs ? 'FRESH' : 'STALE',
    basis,
    ageMs,
    maximumAgeMs,
    coherence: 'COHERENT',
    reasonCodes: ageMs <= maximumAgeMs ? [] : ['SOURCE_AGE_EXCEEDED'],
  });
}
