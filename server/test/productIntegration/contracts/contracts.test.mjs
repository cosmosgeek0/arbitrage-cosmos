import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalProductJson,
  deepFreezeProductJson,
  validateProductComponentEvidence,
  validateProductSupervisorProjection,
} from '../../../dist/productIntegration/contracts/index.js';
import {
  buildProductSupervisorProjection,
  deserializeProductSupervisorProjection,
  serializeProductSupervisorProjection,
} from '../../../dist/productIntegration/supervisor/index.js';
import { createRuntimeComponentFixture, PRODUCT_FIXTURE_NOW_MS } from '../../../dist/productIntegration/fixtures/index.js';

test('owner component evidence validates without inventing runtime facts', () => {
  const components = createRuntimeComponentFixture();
  for (const component of components) assert.deepEqual(validateProductComponentEvidence(component), []);
  assert.equal(components.find((component) => component.componentId === 'q-inference').authority, 'UNAVAILABLE');
});

test('component contract rejects malformed queue, duplicate dependency kinds, and fabricated authority', () => {
  const source = createRuntimeComponentFixture()[1];
  const malformed = {
    ...source,
    authority: 'LIVE_MAGIC',
    requiredDependencies: ['ledger-persistence'],
    optionalDependencies: ['ledger-persistence'],
    queue: { ...source.queue, depth: 101, capacity: 100 },
  };
  const codes = validateProductComponentEvidence(malformed).map((entry) => entry.code);
  assert.ok(codes.includes('ENUM_INVALID'));
  assert.ok(codes.includes('DEPENDENCY_DUPLICATE_KIND'));
  assert.ok(codes.includes('QUEUE_CAPACITY_EXCEEDED'));
});

test('component and supervisor schemas reject unknown or secret-like fields', () => {
  const source = createRuntimeComponentFixture()[1];
  const leaked = { ...source, apiSecret: 'never-serialize-this' };
  const codes = validateProductComponentEvidence(leaked).map((entry) => entry.code);
  assert.ok(codes.includes('UNKNOWN_FIELD'));
  assert.ok(codes.includes('SECRET_LIKE_FIELD'));
  assert.throws(() => buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 1, components: [leaked] }), /UNKNOWN_FIELD|SECRET_LIKE_FIELD/);
});

test('canonical JSON is key-order stable and rejects non-finite/cyclic values', () => {
  assert.equal(canonicalProductJson({ z: 1, a: { y: 2, x: 3 } }), canonicalProductJson({ a: { x: 3, y: 2 }, z: 1 }));
  assert.throws(() => canonicalProductJson({ value: Number.NaN }), /non-finite/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalProductJson(cyclic), /cyclic/);
});

test('core contract boundary rejects proxies, symbols, hidden fields, and accessors without invoking them', () => {
  const source = { ...createRuntimeComponentFixture()[1] };
  let getterReads = 0;
  Object.defineProperty(source, 'desiredState', {
    enumerable: true,
    configurable: true,
    get() {
      getterReads += 1;
      return 'RUNNING';
    },
  });
  Object.defineProperty(source, Symbol('forgedAuthority'), { enumerable: true, value: 'LIVE' });

  assert.deepEqual(validateProductComponentEvidence(source).map((entry) => entry.code), ['PLAIN_DATA_REQUIRED']);
  assert.throws(() => canonicalProductJson(source), /accessor-free plain objects|symbol-bearing/);
  assert.equal(getterReads, 0);

  const proxied = new Proxy(createRuntimeComponentFixture()[1], {});
  assert.deepEqual(validateProductComponentEvidence(proxied).map((entry) => entry.code), ['PLAIN_DATA_REQUIRED']);
  assert.throws(() => canonicalProductJson(proxied), /Proxy/);

  const hidden = { ...createRuntimeComponentFixture()[1] };
  Object.defineProperty(hidden, 'hiddenAuthority', { enumerable: false, value: 'LIVE' });
  assert.deepEqual(validateProductComponentEvidence(hidden).map((entry) => entry.code), ['PLAIN_DATA_REQUIRED']);
  assert.throws(() => canonicalProductJson(hidden), /accessor-free plain objects/);
});

test('deep freeze traverses through an already shallow-frozen parent', () => {
  const nested = { value: 1 };
  const parent = Object.freeze({ nested });
  deepFreezeProductJson(parent);
  assert.equal(Object.isFrozen(nested), true);
});

test('supervisor serialization round-trips byte-stably', () => {
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 7, components: createRuntimeComponentFixture() });
  assert.deepEqual(validateProductSupervisorProjection(projection), []);
  const encoded = serializeProductSupervisorProjection(projection);
  const decoded = deserializeProductSupervisorProjection(encoded);
  assert.deepEqual(decoded, projection);
  assert.equal(serializeProductSupervisorProjection(decoded), encoded);
  assert.equal(Object.isFrozen(decoded.components[0].timing), true);
});

test('supervisor decoder rejects unknown schema version and unbounded payload', () => {
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 1, components: createRuntimeComponentFixture() });
  assert.throws(() => deserializeProductSupervisorProjection(JSON.stringify({ ...projection, schemaVersion: 2 })), /VERSION_UNSUPPORTED/);
  assert.throws(() => deserializeProductSupervisorProjection('x'.repeat(1_048_577)), /1048576/);
});

test('all valid projections respect the symmetric UTF-8 serialization bound', () => {
  const base = createRuntimeComponentFixture()[0];
  const commands = Array.from({ length: 128 }, (_, index) => `command-${index}-${'x'.repeat(108)}`);
  const components = Array.from({ length: 128 }, (_, index) => ({
    ...base,
    componentId: `large-component-${index}`,
    ownerId: `owner-${index}`,
    requiredDependencies: [],
    optionalDependencies: [],
    supportedCommandIds: commands,
  }));
  assert.throws(() => buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 1, components }), /BYTE_LIMIT_EXCEEDED/);
});

test('supervisor decoder rejects dependency references outside the component graph', () => {
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 1, components: createRuntimeComponentFixture() });
  const malformed = { ...projection, dependencies: [{ ...projection.dependencies[0], from: 'missing-owner' }] };
  assert.throws(() => deserializeProductSupervisorProjection(JSON.stringify(malformed)), /DEPENDENCY_COMPONENT_UNKNOWN/);
});

test('supervisor decoder rejects forged green truth and omitted dependency edges', () => {
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 1, components: createRuntimeComponentFixture() });
  const qIndex = projection.components.findIndex((component) => component.componentId === 'q-inference');
  const forgedComponents = projection.components.map((component, index) => index === qIndex ? { ...component, readiness: 'READY', rootBlockerComponentId: null, dependencyPath: [], projectionReasonCodes: [] } : component);
  assert.throws(() => deserializeProductSupervisorProjection(JSON.stringify({ ...projection, components: forgedComponents })), /forged or incomplete/);
  assert.throws(() => deserializeProductSupervisorProjection(JSON.stringify({ ...projection, dependencies: [] })), /forged or incomplete/);
});
