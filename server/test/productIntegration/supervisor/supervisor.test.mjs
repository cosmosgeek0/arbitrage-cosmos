import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductSupervisorProjection } from '../../../dist/productIntegration/supervisor/index.js';
import { createRuntimeComponentFixture, PRODUCT_FIXTURE_NOW_MS } from '../../../dist/productIntegration/fixtures/index.js';

function replace(components, componentId, patch) {
  return components.map((component) => component.componentId === componentId ? { ...component, ...patch } : component);
}

test('Q unavailable degrades its advisory branch and never authorizes money', () => {
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 1, components: createRuntimeComponentFixture() });
  const q = projection.components.find((component) => component.componentId === 'q-inference');
  const basis = projection.components.find((component) => component.componentId === 'basis-engine');
  assert.equal(q.readiness, 'UNKNOWN');
  assert.equal(q.rootBlockerComponentId, 'q-inference');
  assert.equal(basis.readiness, 'DEGRADED');
  assert.equal(basis.rootBlockerComponentId, 'q-inference');
  assert.equal(projection.tradeReadiness, 'BLOCKED');
  assert.equal(projection.overallReadiness, 'DEGRADED');
});

test('stale source and unknown meaningful advance can never project READY', () => {
  const source = createRuntimeComponentFixture();
  const spot = source.find((component) => component.componentId === 'spot-public-source');
  const timing = { ...spot.timing, heartbeatAtMs: PRODUCT_FIXTURE_NOW_MS - 10_000, lastInputEventAtMs: null, lastMeaningfulAdvanceAtMs: null };
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 2, components: replace(source, 'spot-public-source', { timing }) });
  const projectedSpot = projection.components.find((component) => component.componentId === 'spot-public-source');
  assert.equal(projectedSpot.liveness, 'STALE');
  assert.notEqual(projectedSpot.readiness, 'READY');
  assert.equal(projectedSpot.rootBlockerComponentId, 'spot-public-source');
});

test('required dependency propagates the first root blocker and optional dependency only degrades', () => {
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 3, components: createRuntimeComponentFixture() });
  const basis = projection.components.find((component) => component.componentId === 'basis-engine');
  const capital = projection.components.find((component) => component.componentId === 'capital-supervision');
  assert.equal(basis.readiness, 'DEGRADED');
  assert.equal(basis.projectionReasonCodes.some((code) => code.startsWith('OPTIONAL_DEPENDENCY_')), true);
  assert.equal(capital.rootBlockerComponentId, 'q-inference');
  assert.deepEqual(capital.dependencyPath.slice(-1), ['q-inference']);
});

test('exposed capital raises an upstream root blocker to critical severity', () => {
  let components = createRuntimeComponentFixture();
  components = replace(components, 'execution-hand', { capitalExposed: true });
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 4, components });
  const q = projection.components.find((component) => component.componentId === 'q-inference');
  assert.equal(q.severity, 'CRITICAL');
  assert.ok(q.affectedComponentIds.includes('execution-hand'));
});

test('queue saturation and drops remain visible and prevent false green', () => {
  const components = createRuntimeComponentFixture();
  const spot = components.find((component) => component.componentId === 'spot-public-source');
  const queue = { ...spot.queue, depth: 100, capacity: 100, dropped: 5, backpressure: 'SATURATED' };
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 5, components: replace(components, 'spot-public-source', { queue }) });
  const projected = projection.components.find((component) => component.componentId === 'spot-public-source');
  assert.equal(projected.readiness, 'DEGRADED');
  assert.ok(projected.projectionReasonCodes.includes('QUEUE_SATURATED'));
  assert.ok(projected.projectionReasonCodes.includes('QUEUE_DROPS_OBSERVED'));
});

test('graph rejects unknown dependencies and cycles deterministically', () => {
  const components = createRuntimeComponentFixture();
  assert.throws(() => buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 1, components: replace(components, 'spot-public-source', { requiredDependencies: ['missing-owner'] }) }), /unknown/);
  assert.throws(() => buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 1, components: replace(components, 'ledger-persistence', { requiredDependencies: ['machine-supervisor'] }) }), /cycle/);
});

test('conflicting build revisions remain unknown at the aggregate level', () => {
  const components = replace(createRuntimeComponentFixture(), 'spot-public-source', { revisions: { build: 'different-build', config: 'fixture-config-1', schema: 'fixture-schema-1', model: null } });
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 6, components });
  assert.equal(projection.revisions.build, null);
  assert.equal(projection.revisions.config, 'fixture-config-1');
});

test('independent required failure affects overall readiness explicitly', () => {
  const independent = createRuntimeComponentFixture()[0];
  const components = [
    { ...independent, componentId: 'ready-shell', ownerId: 'owner-ready', observedLifecycle: 'READY', roles: ['SHELL'], requiredDependencies: [], optionalDependencies: [] },
    { ...independent, componentId: 'external-watchdog', ownerId: 'owner-watchdog', observedLifecycle: 'FAILED', roles: ['SHELL'], requiredDependencies: [], optionalDependencies: [], requiredForProductReadiness: true },
  ];
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 7, components });
  assert.equal(projection.overallReadiness, 'FAILED');
});

test('required unknown or stale queue evidence cannot remain green', () => {
  const components = createRuntimeComponentFixture();
  const spot = components.find((component) => component.componentId === 'spot-public-source');
  for (const queue of [
    null,
    { ...spot.queue, depth: null, observedAtMs: null },
    { ...spot.queue, observedAtMs: PRODUCT_FIXTURE_NOW_MS - 10_000 },
    { ...spot.queue, backpressure: 'UNKNOWN' },
  ]) {
    const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 8, components: replace(components, 'spot-public-source', { queue }) });
    assert.notEqual(projection.components.find((component) => component.componentId === 'spot-public-source').readiness, 'READY');
  }
});

test('source freshness thresholds cannot be opted out to create green', () => {
  const components = createRuntimeComponentFixture();
  const spot = components.find((component) => component.componentId === 'spot-public-source');
  const timing = { ...spot.timing, sourceMaxAgeMs: null, processingMaxAgeMs: null, meaningfulAdvanceMaxAgeMs: null };
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 9, components: replace(components, 'spot-public-source', { timing }) });
  const source = projection.components.find((component) => component.componentId === 'spot-public-source');
  assert.equal(source.readiness, 'DEGRADED');
  assert.ok(source.projectionReasonCodes.includes('SOURCE_MAX_AGE_UNAVAILABLE'));
});

test('source receive age and capability authority mismatch cannot create green', () => {
  const components = createRuntimeComponentFixture();
  const spot = components.find((component) => component.componentId === 'spot-public-source');
  const noReceive = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 9, components: replace(components, 'spot-public-source', { timing: { ...spot.timing, lastReceiveAtMs: null } }) });
  assert.ok(noReceive.components.find((component) => component.componentId === 'spot-public-source').projectionReasonCodes.includes('RECEIVE_STALE_OR_UNKNOWN'));
  const mismatched = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 9, components: replace(components, 'spot-public-source', { capability: 'LIVE_PUBLIC', authority: 'SYNTHETIC_TEST' }) });
  const source = mismatched.components.find((component) => component.componentId === 'spot-public-source');
  assert.notEqual(source.readiness, 'READY');
  assert.ok(source.projectionReasonCodes.includes('CAPABILITY_AUTHORITY_MISMATCH'));
});

test('analytical failure blocks new work while recovery remains available', () => {
  const components = replace(createRuntimeComponentFixture(), 'basis-engine', { observedLifecycle: 'FAILED', blockerCodes: ['ANALYTICAL_FAILURE'] });
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 10, components });
  assert.equal(projection.components.find((component) => component.componentId === 'basis-engine').readiness, 'FAILED');
  assert.equal(projection.components.find((component) => component.componentId === 'recovery').readiness, 'READY');
  assert.equal(projection.components.find((component) => component.componentId === 'execution-hand').tradeReadiness, 'BLOCKED');
});

test('affected capital exposure is visible on the root attention projection', () => {
  const components = replace(createRuntimeComponentFixture(), 'execution-hand', { capitalExposed: true });
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 11, components });
  const q = projection.components.find((component) => component.componentId === 'q-inference');
  const attention = projection.operatorAttention.find((item) => item.rootBlockerComponentId === 'q-inference');
  assert.equal(q.affectedCapitalExposed, true);
  assert.equal(attention.capitalExposed, true);
});

test('root blocker selection prefers the most severe required dependency', () => {
  const base = createRuntimeComponentFixture()[0];
  const components = [
    { ...base, componentId: 'dependency-degraded', ownerId: 'owner-degraded', roles: ['SHELL'], observedLifecycle: 'DEGRADED', requiredDependencies: [], optionalDependencies: [] },
    { ...base, componentId: 'dependency-failed', ownerId: 'owner-failed', roles: ['SHELL'], observedLifecycle: 'FAILED', requiredDependencies: [], optionalDependencies: [] },
    { ...base, componentId: 'dependent', ownerId: 'owner-dependent', roles: ['SHELL'], requiredDependencies: ['dependency-degraded', 'dependency-failed'], optionalDependencies: [] },
  ];
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 12, components });
  assert.equal(projection.components.find((component) => component.componentId === 'dependent').rootBlockerComponentId, 'dependency-failed');
});

test('mixed ready and stopped required components cannot aggregate to ready', () => {
  const base = createRuntimeComponentFixture()[0];
  const components = [
    { ...base, componentId: 'ready-core', ownerId: 'owner-ready', roles: ['SHELL'], requiredDependencies: [], optionalDependencies: [] },
    { ...base, componentId: 'stopped-core', ownerId: 'owner-stopped', roles: ['SHELL'], desiredState: 'STOPPED', observedLifecycle: 'STOPPED', requiredDependencies: [], optionalDependencies: [] },
  ];
  const projection = buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 13, components });
  assert.equal(projection.overallReadiness, 'BLOCKED');
});
