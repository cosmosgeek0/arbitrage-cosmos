import { asRecord, boundedString, enumValue, exactFields, fail, requireFields } from './errors.mjs';

const ATOMS_PATTERN = /^(?:0|-?[1-9][0-9]{0,95})$/;
const MAX_EXACT_AGGREGATE_ROWS = 4_096;
export const EXACT_STATES = Object.freeze(['KNOWN', 'UNKNOWN', 'UNAVAILABLE']);

export function parseAtoms(value, name = 'atoms') {
  if (typeof value !== 'string' || !ATOMS_PATTERN.test(value)) {
    fail('EXACT_ATOMS_INVALID', `${name} must be a canonical integer string with at most 96 digits`);
  }
  return BigInt(value);
}

export function validateExactMetric(input, expectedUnit = null, name = 'ExactMetricV1') {
  const metric = asRecord(input, name);
  exactFields(metric, ['state', 'unit', 'atoms', 'reason'], name);
  requireFields(metric, ['state', 'unit', 'atoms', 'reason'], name);
  enumValue(metric.state, EXACT_STATES, `${name}.state`);
  boundedString(metric.unit, `${name}.unit`, 64);
  if (expectedUnit !== null && metric.unit !== expectedUnit) {
    fail('REPORTING_UNIT_MISMATCH', `${name}.unit must equal ${expectedUnit}`);
  }
  if (metric.state === 'KNOWN') {
    parseAtoms(metric.atoms, `${name}.atoms`);
    if (metric.reason !== null) fail('EXACT_METRIC_SHAPE_INVALID', `${name}.reason must be null when known`);
  } else {
    if (metric.atoms !== null) fail('EXACT_METRIC_SHAPE_INVALID', `${name}.atoms must be null when ${metric.state}`);
    boundedString(metric.reason, `${name}.reason`);
  }
  return true;
}

export function knownMetric(atoms, unit) {
  const canonicalAtoms = String(atoms);
  parseAtoms(canonicalAtoms, 'knownMetric.atoms');
  boundedString(unit, 'knownMetric.unit', 64);
  return Object.freeze({ state: 'KNOWN', unit, atoms: canonicalAtoms, reason: null });
}

export function unknownMetric(unit, reason, state = 'UNKNOWN') {
  enumValue(state, ['UNKNOWN', 'UNAVAILABLE'], 'unknownMetric.state');
  return Object.freeze({ state, unit, atoms: null, reason });
}

export function sumKnownMetrics(metrics, unit, name = 'metrics') {
  if (!Array.isArray(metrics)) fail('ARRAY_REQUIRED', `${name} must be an array`);
  if (metrics.length > MAX_EXACT_AGGREGATE_ROWS) {
    fail('ARRAY_BOUND_EXCEEDED', `${name} must contain at most ${MAX_EXACT_AGGREGATE_ROWS} rows`);
  }
  let total = 0n;
  for (let index = 0; index < metrics.length; index += 1) {
    if (!Object.hasOwn(metrics, index)) fail('SPARSE_ARRAY', `${name}[${index}] is a sparse array slot`);
    const metric = metrics[index];
    validateExactMetric(metric, unit, `${name}[${index}]`);
    if (metric.state !== 'KNOWN') fail('UNKNOWN_AGGREGATE_INPUT', `${name}[${index}] is not known`);
    total += parseAtoms(metric.atoms, `${name}[${index}].atoms`);
  }
  return knownMetric(total, unit);
}

export function absoluteAtoms(metric, expectedUnit, name) {
  validateExactMetric(metric, expectedUnit, name);
  if (metric.state !== 'KNOWN') return null;
  const value = parseAtoms(metric.atoms, `${name}.atoms`);
  return value < 0n ? -value : value;
}

export function compareKnown(left, right, name = 'exact comparison') {
  const leftValue = parseAtoms(left, `${name}.left`);
  const rightValue = parseAtoms(right, `${name}.right`);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}
