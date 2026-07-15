import {
  cloneCanonical,
  contractError,
  deepFreeze,
  sha256,
} from './canonical.mjs';
import {
  FORBIDDEN_TRUTH_CLASSES,
  FIXTURE_OUTPUT_CLASSES,
} from './constants.mjs';
import { validateCanonicalAdapterMap } from './records.mjs';

function fail(code, message) {
  throw contractError(code, message);
}

function safePath(path, name) {
  if (typeof path !== 'string' || path.length === 0) fail('ADAPTER_PATH_INVALID', `${name} must be a non-empty path`);
  const parts = path.split('.');
  if (parts.some((part) => part.length === 0 || ['__proto__', 'prototype', 'constructor'].includes(part))) {
    fail('ADAPTER_PATH_UNSAFE', `${name} contains an unsafe segment`);
  }
  return parts;
}

function readPath(value, path) {
  let current = value;
  for (const segment of safePath(path, 'localPath')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) {
      fail('ADAPTER_SOURCE_FIELD_MISSING', `fixture field ${path} is missing`);
    }
    current = current[segment];
  }
  return current;
}

function writePath(target, path, value) {
  const parts = safePath(path, 'canonicalPath');
  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current[parts[index]] ??= {};
    if (current[parts[index]] === null || typeof current[parts[index]] !== 'object' || Array.isArray(current[parts[index]])) {
      fail('ADAPTER_TARGET_COLLISION', `fixture target path ${path} collides with a scalar`);
    }
    current = current[parts[index]];
  }
  current[parts.at(-1)] = cloneCanonical(value);
}

function leafPaths(value, prefix = '') {
  if (value === null || typeof value !== 'object') return [prefix];
  const entries = Array.isArray(value) ? value.map((entry, index) => [String(index), entry]) : Object.entries(value);
  if (entries.length === 0) return [prefix];
  return entries.flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
}

export function adaptFixture(map, localFixture) {
  validateCanonicalAdapterMap(map);
  const source = cloneCanonical(localFixture);
  const mappedSourcePaths = map.fieldMap.map((row) => row.localPath);
  const uncovered = leafPaths(source).filter((path) => !mappedSourcePaths.some((mapped) => path === mapped || path.startsWith(`${mapped}.`)));
  if (uncovered.length > 0) fail('ADAPTER_FIELD_COVERAGE_INCOMPLETE', `fixture fields are not mapped: ${uncovered.join(',')}`);
  const mappedFields = {};
  for (const row of map.fieldMap) writePath(mappedFields, row.canonicalPath, readPath(source, row.localPath));
  return deepFreeze({
    schema: 'CanonicalFixturePreviewV1',
    adapterId: map.adapterId,
    canonicalContractId: map.canonicalContractId,
    canonicalContractVersion: map.canonicalContractVersion,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    truthClass: 'FIXTURE_PROJECTION',
    canonical: false,
    mappedFields,
    losslessSource: source,
    losslessSourceHash: sha256(source),
    unknownPropagation: map.unknownPropagation,
  });
}

export function reverseFixture(preview) {
  if (
    preview?.schema !== 'CanonicalFixturePreviewV1'
    || preview.canonical !== false
    || preview.authorityClass !== 'NO_AUTHORITY'
    || preview.networkMode !== 'FIXTURE_ONLY'
    || preview.truthClass !== 'FIXTURE_PROJECTION'
  ) {
    fail('FIXTURE_PREVIEW_INVALID', 'adapter output is not a non-authoritative fixture preview');
  }
  if (sha256(preview.losslessSource) !== preview.losslessSourceHash) fail('FIXTURE_PREVIEW_TAMPERED', 'lossless fixture source hash does not match');
  return deepFreeze(cloneCanonical(preview.losslessSource));
}

export function validateFixtureOutput(output) {
  if (output === null || typeof output !== 'object' || Array.isArray(output)) fail('FIXTURE_OUTPUT_INVALID', 'fixture output must be an object');
  if (FORBIDDEN_TRUTH_CLASSES.includes(output.truthClass)) fail('CANONICAL_TRUTH_MASQUERADE', 'extension output cannot claim canonical product truth');
  if (!FIXTURE_OUTPUT_CLASSES.includes(output.truthClass)) fail('FIXTURE_OUTPUT_CLASS_INVALID', 'fixture output class is unsupported');
  if (output.authorityClass !== 'NO_AUTHORITY' || output.canonical !== false || output.networkMode !== 'FIXTURE_ONLY') {
    fail('FIXTURE_OUTPUT_AUTHORITY_WIDENING', 'fixture output widened authority or network posture');
  }
  return true;
}

export function routeAdvisoryOutput(output, destinationClass) {
  validateFixtureOutput(output);
  if (output.truthClass !== 'ADVISORY') fail('ADVISORY_CLASS_REQUIRED', 'only advisory fixture output may use the advisory router');
  if (!['READ_ONLY_PREVIEW', 'FIXTURE_REPORT', 'FIXTURE_TRACE'].includes(destinationClass)) {
    fail('ADVISORY_EFFECT_FORBIDDEN', 'advisory fixture output may reach only explicit read-only fixture destinations');
  }
  return deepFreeze({ routed: true, destinationClass, effectAllowed: false });
}

export function assertFixtureTransport(transport) {
  if (transport === null || typeof transport !== 'object' || transport.networkMode !== 'FIXTURE_ONLY' || transport.open !== false) {
    fail('FIXTURE_TRANSPORT_REQUIRED', 'transport must remain injected, closed, and fixture-only');
  }
  return true;
}

export class FixtureSandbox {
  #prefix;
  #records = new Map();

  constructor(prefix) {
    if (typeof prefix !== 'string' || !prefix.startsWith('fixture://') || !prefix.endsWith('/')) {
      fail('SANDBOX_PREFIX_INVALID', 'fixture sandbox prefix must be a fixture URI ending in slash');
    }
    this.#prefix = prefix;
  }

  write(path, value) {
    if (typeof path !== 'string' || !path.startsWith(this.#prefix) || path.includes('..')) {
      fail('SANDBOX_ESCAPE_BLOCKED', 'fixture write attempted outside its injected sandbox');
    }
    this.#records.set(path, cloneCanonical(value));
    return deepFreeze({ path, hash: sha256(value) });
  }

  snapshot() {
    return deepFreeze(Object.fromEntries([...this.#records.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))));
  }
}
