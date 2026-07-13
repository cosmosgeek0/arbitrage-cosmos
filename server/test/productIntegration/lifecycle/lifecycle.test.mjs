import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductSupervisorProjection } from '../../../dist/productIntegration/supervisor/index.js';
import { planProductLifecycle } from '../../../dist/productIntegration/lifecycle/index.js';
import { createRuntimeComponentFixture, PRODUCT_FIXTURE_NOW_MS } from '../../../dist/productIntegration/fixtures/index.js';

function supervisor(components = createRuntimeComponentFixture()) {
  return buildProductSupervisorProjection({ nowMs: PRODUCT_FIXTURE_NOW_MS, revision: 11, components });
}

test('boot plan starts through dependency order and cannot mutate state', () => {
  const plan = planProductLifecycle({ kind: 'BOOT', supervisor: supervisor() });
  assert.equal(plan.operations[0].kind, 'REQUEST_COMPONENT_START');
  assert.equal(plan.operations[0].componentId, 'ledger-persistence');
  assert.equal(plan.operations[1].kind, 'VERIFY_RESTART_BARRIER');
  assert.equal(plan.operations.at(-1).kind, 'RELEASE_INTAKE_IF_GATES_PASS');
  const ledger = plan.operations.findIndex((operation) => operation.componentId === 'ledger-persistence' && operation.kind === 'REQUEST_COMPONENT_START');
  const spot = plan.operations.findIndex((operation) => operation.componentId === 'spot-public-source' && operation.kind === 'REQUEST_COMPONENT_START');
  assert.ok(ledger < spot);
  assert.equal(plan.changesState, false);
  assert.equal(plan.delegatedToCanonicalControl, true);
});

test('pause intake blocks entries before any pause request', () => {
  const plan = planProductLifecycle({ kind: 'PAUSE_INTAKE', supervisor: supervisor() });
  assert.equal(plan.operations[0].kind, 'BLOCK_NEW_ENTRIES');
  assert.ok(plan.operations.slice(1).every((operation) => operation.kind === 'REQUEST_COMPONENT_PAUSE'));
});

test('maintenance drain preserves reconciliation, recovery, and persistence order', () => {
  const plan = planProductLifecycle({ kind: 'MAINTENANCE_DRAIN', supervisor: supervisor() });
  const kinds = plan.operations.map((operation) => operation.kind);
  assert.ok(kinds.indexOf('BLOCK_NEW_ENTRIES') < kinds.indexOf('REQUEST_RECONCILIATION'));
  assert.ok(kinds.indexOf('REQUEST_RECONCILIATION') < kinds.indexOf('PRESERVE_RECOVERY_CAPABILITY'));
  assert.ok(kinds.indexOf('PRESERVE_RECOVERY_CAPABILITY') < kinds.indexOf('CHECKPOINT_DURABLE_STATE'));
});

test('graceful shutdown with exposure changes to recovery-only and emits no stop', () => {
  const components = createRuntimeComponentFixture().map((component) => component.componentId === 'execution-hand' ? { ...component, capitalExposed: true } : component);
  const plan = planProductLifecycle({ kind: 'GRACEFUL_SHUTDOWN', supervisor: supervisor(components) });
  assert.ok(plan.blockers.includes('EXPOSURE_OR_RECOVERY_PRESENT_RECOVERY_ONLY_REQUIRED'));
  assert.ok(plan.operations.some((operation) => operation.kind === 'PRESERVE_RECOVERY_CAPABILITY'));
  assert.equal(plan.operations.some((operation) => operation.kind === 'REQUEST_COMPONENT_STOP'), false);
});

test('safe component restart blocks entries, orders dependent stops, and reconciles before release', () => {
  const plan = planProductLifecycle({ kind: 'SAFE_COMPONENT_RESTART', supervisor: supervisor(), targetComponentId: 'spot-public-source' });
  const kinds = plan.operations.map((operation) => operation.kind);
  assert.equal(kinds[0], 'BLOCK_NEW_ENTRIES');
  assert.ok(kinds.indexOf('REQUEST_COMPONENT_STOP') < kinds.indexOf('REQUEST_COMPONENT_RESTART'));
  assert.ok(kinds.indexOf('REQUEST_COMPONENT_RESTART') < kinds.indexOf('REQUEST_RECONCILIATION'));
  assert.equal(kinds.at(-1), 'RELEASE_INTAKE_IF_GATES_PASS');
});

test('restart reconciliation blocks exposure until truth is persisted', () => {
  const plan = planProductLifecycle({ kind: 'RESTART_RECONCILIATION', supervisor: supervisor() });
  assert.equal(plan.operations[0].kind, 'BLOCK_NEW_ENTRIES');
  assert.ok(plan.operations.some((operation) => operation.kind === 'REQUEST_RECONCILIATION'));
  assert.ok(plan.operations.some((operation) => operation.kind === 'CHECKPOINT_DURABLE_STATE'));
  assert.equal(plan.operations.at(-1).kind, 'RELEASE_INTAKE_IF_GATES_PASS');
});

test('unknown restart target fails rather than guessing an owner', () => {
  assert.throws(() => planProductLifecycle({ kind: 'SAFE_COMPONENT_RESTART', supervisor: supervisor(), targetComponentId: 'future-l-owner' }), /known target/);
});

test('start command matching never aliases restart and missing commands become blockers', () => {
  const components = createRuntimeComponentFixture().map((component) => component.componentId === 'spot-public-source'
    ? { ...component, supportedCommandIds: ['component.restart'] }
    : component);
  const plan = planProductLifecycle({ kind: 'BOOT', supervisor: supervisor(components) });
  const start = plan.operations.find((operation) => operation.componentId === 'spot-public-source' && operation.kind === 'REQUEST_COMPONENT_START');
  assert.equal(start.ownerCommandId, null);
  assert.ok(plan.blockers.includes('COMMAND_UNAVAILABLE:REQUEST_COMPONENT_START:spot-public-source'));
  assert.equal(plan.operations.some((operation) => operation.kind === 'RELEASE_INTAKE_IF_GATES_PASS'), false);
});

test('boot and restart reconciliation operation DAG starts persistence before barrier/reconciliation', () => {
  for (const kind of ['BOOT', 'RESTART_RECONCILIATION']) {
    const plan = planProductLifecycle({ kind, supervisor: supervisor() });
    const persistence = plan.operations.find((operation) => operation.componentId === 'ledger-persistence' && operation.kind === 'REQUEST_COMPONENT_START');
    const nextKind = kind === 'BOOT' ? 'VERIFY_RESTART_BARRIER' : 'REQUEST_RECONCILIATION';
    const next = plan.operations.find((operation) => operation.kind === nextKind);
    assert.ok(next.dependsOnOperationIds.length > 0);
    assert.ok(next.sequence > persistence.sequence);
  }
});

test('safe optional analytical restart does not stop recovery or reconciliation', () => {
  const plan = planProductLifecycle({ kind: 'SAFE_COMPONENT_RESTART', supervisor: supervisor(), targetComponentId: 'q-inference' });
  assert.equal(plan.operations.some((operation) => operation.kind === 'REQUEST_COMPONENT_STOP' && ['recovery', 'reconciliation'].includes(operation.componentId)), false);
});

test('graceful shutdown refuses full stop for recovery-required state without exposed capital', () => {
  const components = createRuntimeComponentFixture().map((component) => component.componentId === 'recovery'
    ? { ...component, observedLifecycle: 'RECOVERY_REQUIRED', capitalExposed: false }
    : component);
  const plan = planProductLifecycle({ kind: 'GRACEFUL_SHUTDOWN', supervisor: supervisor(components) });
  assert.ok(plan.blockers.includes('EXPOSURE_OR_RECOVERY_PRESENT_RECOVERY_ONLY_REQUIRED'));
  assert.equal(plan.operations.some((operation) => operation.kind === 'REQUEST_COMPONENT_STOP'), false);
});

test('safe restart refuses any closure that would disable execution or recovery while exposed', () => {
  const components = createRuntimeComponentFixture().map((component) => component.componentId === 'execution-hand' ? { ...component, capitalExposed: true } : component);
  for (const targetComponentId of ['spot-public-source', 'execution-hand']) {
    const plan = planProductLifecycle({ kind: 'SAFE_COMPONENT_RESTART', supervisor: supervisor(components), targetComponentId });
    assert.ok(plan.blockers.includes('EXPOSURE_OR_RECOVERY_RESTART_REQUIRES_CANONICAL_RECOVERY_PLAN'));
    assert.equal(plan.operations.some((operation) => operation.kind === 'REQUEST_COMPONENT_STOP'), false);
    assert.ok(plan.operations.some((operation) => operation.kind === 'PRESERVE_RECOVERY_CAPABILITY'));
  }
});

test('ambiguous mutation blocker prevents ordinary shutdown even without known exposure', () => {
  const components = createRuntimeComponentFixture().map((component) => component.componentId === 'execution-hand'
    ? { ...component, blockerCodes: ['AMBIGUOUS_MUTATION'], capitalExposed: false }
    : component);
  const plan = planProductLifecycle({ kind: 'GRACEFUL_SHUTDOWN', supervisor: supervisor(components) });
  assert.ok(plan.blockers.includes('EXPOSURE_OR_RECOVERY_PRESENT_RECOVERY_ONLY_REQUIRED'));
  assert.equal(plan.operations.some((operation) => operation.kind === 'REQUEST_COMPONENT_STOP'), false);
});

test('boot without a persistence owner is blocked and cannot claim clean readiness', () => {
  const components = createRuntimeComponentFixture().filter((component) => component.componentId !== 'ledger-persistence').map((component) => ({
    ...component,
    requiredDependencies: component.requiredDependencies.filter((dependency) => dependency !== 'ledger-persistence'),
    optionalDependencies: component.optionalDependencies.filter((dependency) => dependency !== 'ledger-persistence'),
  }));
  const plan = planProductLifecycle({ kind: 'BOOT', supervisor: supervisor(components) });
  assert.ok(plan.blockers.includes('PERSISTENCE_COMPONENT_MISSING'));
  assert.equal(plan.operations.some((operation) => operation.kind === 'RELEASE_INTAKE_IF_GATES_PASS'), false);
});

test('plans that promise reconciliation or recovery fail closed when those roles are absent', () => {
  const persistenceOnly = createRuntimeComponentFixture()
    .filter((component) => component.roles.includes('PERSISTENCE'))
    .map((component) => ({ ...component, requiredDependencies: [], optionalDependencies: [] }));
  for (const kind of ['BOOT', 'RESTART_RECONCILIATION']) {
    const plan = planProductLifecycle({ kind, supervisor: supervisor(persistenceOnly) });
    assert.ok(plan.blockers.includes('RECONCILIATION_COMPONENT_MISSING'));
    assert.ok(plan.blockers.includes('RECOVERY_COMPONENT_MISSING'));
    assert.equal(plan.operations.some((operation) => operation.kind === 'RELEASE_INTAKE_IF_GATES_PASS'), false);
  }
  const recoveryOnly = planProductLifecycle({ kind: 'RECOVERY_ONLY', supervisor: supervisor(persistenceOnly) });
  assert.ok(recoveryOnly.blockers.includes('RECOVERY_COMPONENT_MISSING'));
  assert.equal(recoveryOnly.operations.some((operation) => operation.kind === 'PRESERVE_RECOVERY_CAPABILITY'), false);
  assert.equal(recoveryOnly.operations.some((operation) => operation.componentId === null && operation.kind !== 'BLOCK_NEW_ENTRIES'), false);
});

test('safe restart cannot release without canonical persistence', () => {
  const withoutPersistence = createRuntimeComponentFixture()
    .filter((component) => !component.roles.includes('PERSISTENCE'))
    .map((component) => ({
      ...component,
      requiredDependencies: component.requiredDependencies.filter((dependency) => dependency !== 'ledger-persistence'),
      optionalDependencies: component.optionalDependencies.filter((dependency) => dependency !== 'ledger-persistence'),
    }));
  const plan = planProductLifecycle({ kind: 'SAFE_COMPONENT_RESTART', supervisor: supervisor(withoutPersistence), targetComponentId: 'recovery' });
  assert.ok(plan.blockers.includes('PERSISTENCE_COMPONENT_MISSING'));
  assert.equal(plan.operations.some((operation) => operation.kind === 'RELEASE_INTAKE_IF_GATES_PASS'), false);
});

test('graceful shutdown cannot stop components when reconciliation command is unavailable', () => {
  const components = createRuntimeComponentFixture().map((component) => component.roles.includes('RECONCILIATION')
    ? { ...component, supportedCommandIds: component.supportedCommandIds.filter((commandId) => !commandId.endsWith('.reconcile')) }
    : component);
  const plan = planProductLifecycle({ kind: 'GRACEFUL_SHUTDOWN', supervisor: supervisor(components) });
  assert.ok(plan.blockers.some((blocker) => blocker.startsWith('COMMAND_UNAVAILABLE:REQUEST_RECONCILIATION')));
  assert.equal(plan.operations.some((operation) => operation.kind === 'REQUEST_COMPONENT_STOP'), false);
  assert.ok(plan.operations.some((operation) => operation.kind === 'PRESERVE_RECOVERY_CAPABILITY'));
});

test('restart reconciliation skips optional private truth that is not configured', () => {
  const components = createRuntimeComponentFixture().map((component) => component.componentId === 'q-inference'
    ? { ...component, roles: ['PRIVATE_TRUTH'], capability: 'NOT_CONFIGURED', requiredForProductReadiness: false, supportedCommandIds: [] }
    : component);
  const plan = planProductLifecycle({ kind: 'RESTART_RECONCILIATION', supervisor: supervisor(components) });
  assert.equal(plan.blockers.some((blocker) => blocker.includes('q-inference')), false);
  assert.equal(plan.operations.some((operation) => operation.componentId === 'q-inference'), false);
  assert.equal(plan.operations.at(-1).kind, 'RELEASE_INTAKE_IF_GATES_PASS');
});
