import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFreshness } from '../../../dist/foundation/contracts/index.js';
import {
  validateSystemComponentSnapshot,
  validateSystemTraceEvent,
} from '../../../dist/systemIntegration/contracts/index.js';
import {
  MAX_TRACE_INPUT_EVENTS,
  SYSTEM_TOPOLOGY_NODES,
  SYSTEM_TOPOLOGY_EDGES,
  buildSystemSupervisorProjection,
  buildSystemTraceIndex,
  serializeSystemSupervisorSnapshot,
  serializeSystemTraceIndex,
  traceByCorrelationId,
} from '../../../dist/systemIntegration/supervisor/index.js';
import {
  CORRELATION,
  NOW,
  clone,
  projectionInput,
  traceEvent,
} from './fixtures.mjs';

function project(input = projectionInput()) {
  const result = buildSystemSupervisorProjection(input);
  assert.equal(result.ok, true, result.ok ? undefined : `${result.failure.code}: ${result.failure.message}`);
  return result.value;
}

test('projection emits every canonical node and deterministic dependency edge', () => {
  const snapshot = project();
  assert.equal(snapshot.components.length, 13);
  assert.equal(new Set(snapshot.components.map((node) => node.componentId)).size, 13);
  assert.equal(snapshot.edges.length, SYSTEM_TOPOLOGY_EDGES.length);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.control.generation, 1);
});

test('canonical topology arrays and their records are immutable', () => {
  assert.equal(Object.isFrozen(SYSTEM_TOPOLOGY_NODES), true);
  assert.equal(Object.isFrozen(SYSTEM_TOPOLOGY_EDGES), true);
  assert.equal(SYSTEM_TOPOLOGY_NODES.every(Object.isFrozen), true);
  assert.equal(SYSTEM_TOPOLOGY_EDGES.every(Object.isFrozen), true);
});

test('projected components and trace events remain valid canonical contract values', () => {
  const snapshot = project();
  for (const component of snapshot.components) {
    assert.deepEqual(validateSystemComponentSnapshot(component), [], component.componentId);
  }
  for (const entry of snapshot.traceIndex.entries) {
    for (const event of entry.snapshot.events) {
      assert.deepEqual(validateSystemTraceEvent(event), [], event.id);
    }
  }
});

test('RUNNING process does not manufacture READY component truth', () => {
  const snapshot = project(projectionInput({
    componentOverrides: {
      'market-intelligence': {
        phase: 'RUNNING',
        readiness: 'WARMING',
        operatorAttentionRequired: true,
      },
    },
  }));
  assert.equal(snapshot.phase, 'RUNNING');
  assert.equal(snapshot.components.find((node) => node.componentId === 'market-intelligence').readiness, 'WARMING');
  assert.equal(snapshot.overallPosture, 'WARMING');
});

test('intentionally stopped components are not reported as root blockers', () => {
  const componentOverrides = Object.fromEntries(SYSTEM_TOPOLOGY_NODES.map(({ componentId }) => [componentId, {
    desiredState: 'STOPPED',
    phase: 'STOPPED',
    readiness: 'STOPPED',
  }]));
  const snapshot = project(projectionInput({
    runtime: { desiredState: 'STOPPED', phase: 'STOPPED' },
    componentOverrides,
  }));
  assert.equal(snapshot.overallPosture, 'STOPPED');
  assert.equal(snapshot.firstRootBlockerComponentId, null);
  assert.deepEqual(snapshot.rootCauses, []);
  assert.deepEqual(snapshot.attentionQueue, []);
});

test('one engine failure remains scoped and does not erase the other engine', () => {
  const snapshot = project(projectionInput({
    componentOverrides: {
      'basis-engine': {
        readiness: 'FAILED',
        phase: 'FAILED',
        lastFailure: {
          component: 'basis-engine', stage: 'tick', code: 'BASIS_ENGINE_FAILED', message: 'Basis failed', occurredAt: NOW - 1,
          retryable: true, safeCurrentState: 'FAILED', recommendedOperatorAction: 'Inspect Basis.', correlationId: CORRELATION,
        },
        blockerCodes: ['BASIS_ENGINE_FAILED'],
      },
    },
  }));
  assert.equal(snapshot.components.find((node) => node.componentId === 'volume-engine').readiness, 'READY');
  assert.equal(snapshot.summaries.strategies.volume.proposalCount, 1);
  assert.equal(snapshot.overallPosture, 'DEGRADED');
});

test('unknown or stale source truth cannot remain READY', () => {
  const staleTimestamp = {
    sourceTimeMs: NOW - 20_000,
    receivedAtMs: NOW - 19_900,
    maxAgeMs: 1_000,
    authority: 'LIVE_PUBLIC',
    completeness: 'COMPLETE',
    sourceId: 'fixture.stale.spot',
  };
  const forged = projectionInput({
    componentOverrides: {
      'public-spot-source': {
        truthLabel: 'LIVE_PUBLIC',
        sourceTimestamp: staleTimestamp,
        freshness: evaluateFreshness(staleTimestamp, NOW),
      },
    },
  });
  assert.equal(buildSystemSupervisorProjection(forged).ok, false, 'forged READY/live stale truth must fail closed');

  const snapshot = project(projectionInput({
    componentOverrides: {
      'public-spot-source': {
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'BLOCKED'],
        truthLabel: 'UNAVAILABLE',
        readiness: 'BLOCKED',
        authority: 'UNAVAILABLE',
        sourceTimestamp: staleTimestamp,
        freshness: evaluateFreshness(staleTimestamp, NOW),
      },
    },
  }));
  const spot = snapshot.components.find((node) => node.componentId === 'public-spot-source');
  assert.equal(spot.freshness.state, 'STALE');
  assert.equal(spot.truthLabel, 'UNAVAILABLE');
  assert.equal(spot.readiness, 'BLOCKED');
  assert.ok(spot.blockerCodes.includes('SOURCE_STALE'));
});

test('supervisor re-evaluates once-fresh timestamp evidence against its own injected clock', () => {
  const timestamp = {
    sourceTimeMs: NOW - 2_500,
    receivedAtMs: NOW - 2_400,
    maxAgeMs: 1_000,
    authority: 'LIVE_PUBLIC',
    completeness: 'COMPLETE',
    sourceId: 'fixture.once-fresh.spot',
  };
  const ownerEvaluatedAt = NOW - 2_000;
  const snapshot = project(projectionInput({
    componentOverrides: {
      'public-spot-source': {
        sourceTimestamp: timestamp,
        freshness: evaluateFreshness(timestamp, ownerEvaluatedAt),
      },
    },
  }));
  const spot = snapshot.components.find((node) => node.componentId === 'public-spot-source');
  assert.equal(spot.freshness.evaluatedAt, NOW);
  assert.equal(spot.freshness.state, 'STALE');
  assert.equal(spot.truthLabel, 'UNAVAILABLE');
  assert.equal(spot.readiness, 'BLOCKED');
  assert.equal(spot.releaseStatuses.includes('LIVE_PUBLIC'), false);
  assert.deepEqual(validateSystemComponentSnapshot(spot), []);
});

test('cached freshness without its canonical source timestamp cannot remain live or READY', () => {
  const forged = projectionInput({
    componentOverrides: {
      'public-spot-source': {
        sourceTimestamp: null,
        freshness: {
          state: 'FRESH',
          ageMs: 50,
          basis: 'SOURCE_TIME',
          effectiveAuthority: 'LIVE_PUBLIC',
          evaluatedAt: NOW - 1_000,
        },
      },
    },
  });
  assert.equal(buildSystemSupervisorProjection(forged).ok, false, 'cached freshness without source timestamp must fail closed');

  const snapshot = project(projectionInput({
    componentOverrides: {
      'public-spot-source': {
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'BLOCKED'],
        truthLabel: 'UNAVAILABLE',
        readiness: 'BLOCKED',
        authority: 'UNAVAILABLE',
        sourceTimestamp: null,
        freshness: null,
      },
    },
  }));
  const spot = snapshot.components.find((node) => node.componentId === 'public-spot-source');
  assert.equal(spot.freshness, null);
  assert.equal(spot.truthLabel, 'UNAVAILABLE');
  assert.equal(spot.readiness, 'BLOCKED');
  assert.ok(spot.blockerCodes.includes('FRESHNESS_NOT_REPORTED'));
});

test('source timestamp authority and completeness can only downgrade a component claim', () => {
  const syntheticTimestamp = {
    sourceTimeMs: NOW - 100,
    receivedAtMs: NOW - 80,
    maxAgeMs: 5_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'PARTIAL',
    sourceId: 'fixture.synthetic-partial.spot',
  };
  const forged = projectionInput({
    componentOverrides: {
      'public-spot-source': {
        authority: 'LIVE_PUBLIC',
        completeness: 'COMPLETE',
        truthLabel: 'LIVE_PUBLIC',
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY'],
        sourceTimestamp: syntheticTimestamp,
        freshness: evaluateFreshness(syntheticTimestamp, NOW),
      },
    },
  });
  assert.equal(buildSystemSupervisorProjection(forged).ok, false, 'synthetic timestamp cannot support a forged live claim');

  const snapshot = project(projectionInput({
    componentOverrides: {
      'public-spot-source': {
        authority: 'SYNTHETIC_TEST',
        completeness: 'PARTIAL',
        truthLabel: 'SYNTHETIC_ONLY',
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY'],
        sourceTimestamp: syntheticTimestamp,
        freshness: evaluateFreshness(syntheticTimestamp, NOW),
      },
    },
  }));
  const spot = snapshot.components.find((node) => node.componentId === 'public-spot-source');
  assert.equal(spot.authority, 'SYNTHETIC_TEST');
  assert.equal(spot.completeness, 'PARTIAL');
  assert.equal(spot.truthLabel, 'SYNTHETIC_ONLY');
  assert.equal(spot.readiness, 'DEGRADED');
});

test('trace index deduplicates exact repeats once and preserves chronological correlation', () => {
  const event = traceEvent();
  const second = traceEvent({
    id: 'trace-event-2',
    sequence: 2,
    occurredAtMs: NOW - 10,
    kind: 'RISK',
    componentId: 'multileg-risk',
    truthLabel: 'DRY_RUN',
    releaseStatuses: ['WIRED', 'SYNTHETIC_ONLY'],
  });
  const index = buildSystemTraceIndex([event, clone(event), second], NOW);
  assert.equal(index.totalInputEvents, 3);
  assert.equal(index.uniqueEventCount, 2);
  assert.equal(index.duplicateEventCount, 1);
  const trace = traceByCorrelationId(index, CORRELATION);
  assert.deepEqual(trace.events.map((item) => item.id), ['trace-event-1', 'trace-event-2']);
});

test('conflicting duplicate trace IDs fail closed', () => {
  const a = traceEvent();
  const b = traceEvent({ kind: 'RISK' });
  assert.throws(() => buildSystemTraceIndex([a, b], NOW), /duplicate event trace-event-1 conflicts/);
});

test('projection rejects missing nodes and non-finite counts', () => {
  const missing = projectionInput();
  missing.components = missing.components.slice(0, 12);
  const missingResult = buildSystemSupervisorProjection(missing);
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.failure.code, 'SUPERVISOR_INPUT_INVALID');

  const invalidCount = projectionInput();
  invalidCount.summaries.sourceCoverage.universeSymbols = Number.NaN;
  const invalidResult = buildSystemSupervisorProjection(invalidCount);
  assert.equal(invalidResult.ok, false);
});

test('projection rejects malformed runtime, lifecycle, and freshness boundary facts', () => {
  const invalidRunMode = projectionInput({ runtime: { runMode: 'LIVE' } });
  assert.equal(buildSystemSupervisorProjection(invalidRunMode).ok, false);

  const invalidLifecycle = projectionInput({
    componentOverrides: { 'public-spot-source': { sourceLifecycle: 'MAGICALLY_HEALTHY' } },
  });
  assert.equal(buildSystemSupervisorProjection(invalidLifecycle).ok, false);

  const invalidFreshness = projectionInput({
    componentOverrides: {
      'public-spot-source': {
        freshness: {
          state: 'FRESH',
          ageMs: 10,
          basis: 'LOCAL_REFRESH_TIME',
          effectiveAuthority: 'LIVE_PUBLIC',
          evaluatedAt: NOW,
        },
      },
    },
  });
  assert.equal(buildSystemSupervisorProjection(invalidFreshness).ok, false);
});

test('restart projection preserves distinct persisted-control and fresh-runtime generations', () => {
  const snapshot = project(projectionInput({
    runtime: { generation: 1 },
    control: { generation: 9 },
    componentOverrides: { 'basis-engine': { generation: 7 } },
  }));
  assert.equal(snapshot.runtimeGeneration, 1);
  assert.equal(snapshot.controlGeneration, 9);
  assert.equal(snapshot.control.generation, 9);
  assert.equal(snapshot.components.find((node) => node.componentId === 'engine-supervisor').generation, 1);
  assert.equal(snapshot.components.find((node) => node.componentId === 'basis-engine').generation, 7);
});

test('trace input bound is enforced before projection growth', () => {
  const repeated = Array.from({ length: MAX_TRACE_INPUT_EVENTS + 1 }, (_, index) => traceEvent({ id: `trace-${index}`, sequence: index }));
  assert.throws(() => buildSystemTraceIndex(repeated, NOW), /exceeds 10000/);
});

test('trace index rejects unknown release values and malformed failures', () => {
  assert.throws(
    () => buildSystemTraceIndex([traceEvent({ releaseStatuses: ['WIRED', 'UNKNOWN_RELEASE'] })], NOW),
    /RELEASE_STATUS_INVALID/,
  );
  assert.throws(
    () => buildSystemTraceIndex([traceEvent({ failure: { code: 'not-a-structured-failure' } })], NOW),
    /STRUCTURED_FAILURE_INVALID/,
  );
});

test('projection is pure with respect to its owner-snapshot input', () => {
  const input = projectionInput();
  const before = clone(input);
  project(input);
  assert.deepEqual(input, before);
});

test('supervisor and trace serialization are deterministic, JSON-plain, and bounded', () => {
  const snapshot = project();
  const first = serializeSystemSupervisorSnapshot(snapshot);
  const second = serializeSystemSupervisorSnapshot(snapshot);
  assert.equal(first, second);
  assert.equal(JSON.parse(first).components.length, 13);
  const trace = serializeSystemTraceIndex(snapshot.traceIndex);
  assert.equal(JSON.parse(trace).entries.length, 1);
});

test('owner unknowns and exact decimal strings survive without fabricated zeros', () => {
  const snapshot = project(projectionInput({
    summaryOverrides: {
      capital: {
        ...projectionInput().summaries.capital,
        allocatableAmount: null,
        reservedAmount: '0.00000001',
        activeExposureAmount: null,
        eligibleCount: null,
      },
    },
  }));
  assert.equal(snapshot.summaries.capital.allocatableAmount, null);
  assert.equal(snapshot.summaries.capital.activeExposureAmount, null);
  assert.equal(snapshot.summaries.capital.eligibleCount, null);
  assert.equal(snapshot.summaries.capital.reservedAmount, '0.00000001');
});

test('unavailable owner summaries are never upgraded from component process state', () => {
  const base = projectionInput().summaries;
  const snapshot = project(projectionInput({
    summaryOverrides: {
      risk: {
        ...base.risk,
        truthLabel: 'UNAVAILABLE',
        latestVerdict: 'UNAVAILABLE',
        latestVerdictAtMs: null,
        latestVerdictId: null,
      },
      execution: {
        ...base.execution,
        truthLabel: 'UNAVAILABLE',
        mode: 'UNAVAILABLE',
        planId: null,
        planLifecycle: null,
        coordinatorState: 'UNAVAILABLE',
        legCount: null,
        lastTransitionAtMs: null,
      },
      reconciliation: {
        ...base.reconciliation,
        truthLabel: 'UNAVAILABLE',
        status: 'UNAVAILABLE',
        checkpointId: null,
        evaluatedAtMs: null,
      },
    },
  }));
  assert.equal(snapshot.summaries.risk.truthLabel, 'UNAVAILABLE');
  assert.equal(snapshot.summaries.execution.truthLabel, 'UNAVAILABLE');
  assert.equal(snapshot.summaries.reconciliation.truthLabel, 'UNAVAILABLE');
});
