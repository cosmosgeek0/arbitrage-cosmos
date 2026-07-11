import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

function scenarioPrefix(scenarioId, invariant) {
  if (typeof scenarioId !== 'string' || scenarioId.trim().length === 0) {
    throw new TypeError('scenarioId is required');
  }
  if (typeof invariant !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(invariant)) {
    throw new TypeError('invariant must be an uppercase stable code');
  }
  return `${scenarioId} invariant=${invariant}`;
}

function renderedDetail(detail) {
  if (detail === undefined || detail === null || detail === '') return '';
  if (typeof detail === 'string') return ` :: ${detail}`;
  try {
    return ` :: ${JSON.stringify(detail)}`;
  } catch {
    return ' :: [unserializable detail]';
  }
}

export function scenarioFailure(scenarioId, invariant, detail = '') {
  return new assert.AssertionError({
    message: `${scenarioPrefix(scenarioId, invariant)}${renderedDetail(detail)}`,
    actual: false,
    expected: true,
    operator: 'scenarioInvariant',
    stackStartFn: scenarioFailure,
  });
}

export function assertScenario(scenarioId, invariant, condition, detail = '') {
  if (condition !== true) throw scenarioFailure(scenarioId, invariant, detail);
}

export function assertScenarioEqual(scenarioId, invariant, actual, expected, detail = '') {
  if (Object.is(actual, expected)) return;
  throw new assert.AssertionError({
    message: `${scenarioPrefix(scenarioId, invariant)}${renderedDetail(detail)}`,
    actual,
    expected,
    operator: 'strictEqual',
    stackStartFn: assertScenarioEqual,
  });
}

export function assertScenarioDeepEqual(scenarioId, invariant, actual, expected, detail = '') {
  if (isDeepStrictEqual(actual, expected)) return;
  throw new assert.AssertionError({
    message: `${scenarioPrefix(scenarioId, invariant)}${renderedDetail(detail)}`,
    actual,
    expected,
    operator: 'deepStrictEqual',
    stackStartFn: assertScenarioDeepEqual,
  });
}

export function assertExactlyOnce(scenarioId, invariant, values, predicate, detail = '') {
  if (!Array.isArray(values)) throw new TypeError('assertExactlyOnce values must be an array');
  if (typeof predicate !== 'function') throw new TypeError('assertExactlyOnce predicate must be a function');
  const matches = values.filter(predicate);
  if (matches.length !== 1) {
    throw scenarioFailure(scenarioId, invariant, {
      ...((detail && typeof detail === 'object') ? detail : { detail }),
      actualMatches: matches.length,
      totalValues: values.length,
    });
  }
  return matches[0];
}

export function assertNoDuplicateKeys(scenarioId, invariant, values, keyOf) {
  if (!Array.isArray(values)) throw new TypeError('assertNoDuplicateKeys values must be an array');
  if (typeof keyOf !== 'function') throw new TypeError('assertNoDuplicateKeys keyOf must be a function');
  const seen = new Set();
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) throw scenarioFailure(scenarioId, invariant, `duplicate key ${String(key)}`);
    seen.add(key);
  }
}

export function assertCallOrder(scenarioId, invariant, calls, expectedOperations) {
  assertScenarioDeepEqual(
    scenarioId,
    invariant,
    calls.map((call) => call.operation),
    expectedOperations,
  );
}

export function scenarioTestName(number, title) {
  if (!Number.isSafeInteger(number) || number < 1 || number > 99) {
    throw new TypeError('scenario number must be a safe integer from 1 through 99');
  }
  if (typeof title !== 'string' || title.trim().length === 0) throw new TypeError('scenario title is required');
  return `[SC-${String(number).padStart(2, '0')}] ${title.trim()}`;
}
