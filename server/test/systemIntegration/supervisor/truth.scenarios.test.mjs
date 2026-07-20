import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFreshness } from '../../../dist/foundation/contracts/index.js';
import {
  buildSystemSupervisorProjection,
  buildSystemTraceIndex,
} from '../../../dist/systemIntegration/supervisor/index.js';
import {
  CORRELATION,
  NOW,
  failure,
  projectionInput,
  traceEvent,
} from './fixtures.mjs';

function project(input) {
  const result = buildSystemSupervisorProjection(input);
  assert.equal(result.ok, true, result.ok ? undefined : `invariant=PROJECTION_BUILT code=${result.failure.code} message=${result.failure.message}`);
  return result.value;
}

test('[SC-28] root-cause graph identifies and preserves the first real blocker', () => {
  const snapshot = project(projectionInput({
    componentOverrides: {
      'public-usdm-source': {
        readiness: 'FAILED',
        phase: 'FAILED',
        truthLabel: 'UNAVAILABLE',
        authority: 'UNAVAILABLE',
        completeness: 'UNAVAILABLE',
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'BLOCKED'],
        sourceTimestamp: null,
        freshness: null,
        lastFailure: failure('public-usdm-source', 'USD_M_SOURCE_SILENT'),
        blockerCodes: ['USD_M_SOURCE_SILENT'],
        operatorAttentionRequired: true,
      },
      'basis-engine': {
        readiness: 'BLOCKED',
        phase: 'BLOCKED',
        blockerCodes: ['DEPENDENCY_BLOCKED'],
        operatorAttentionRequired: true,
      },
      'capital-supervision': {
        readiness: 'DEGRADED',
        phase: 'DEGRADED',
        blockerCodes: ['UPSTREAM_STRATEGY_DEGRADED'],
      },
    },
  }));

  assert.equal(snapshot.firstRootBlockerComponentId, 'public-usdm-source', 'SC-28 invariant=FIRST_ROOT_BLOCKER_PRESERVED');
  const basisEdge = snapshot.edges.find((edge) => edge.from === 'public-usdm-source' && edge.to === 'basis-engine');
  assert.equal(basisEdge.state, 'BLOCKED', 'SC-28 invariant=REQUIRED_DEPENDENT_BLOCKED');
  assert.equal(basisEdge.rootBlockerComponentId, 'public-usdm-source', 'SC-28 invariant=EDGE_POINTS_TO_SOURCE');
  const root = snapshot.rootCauses.find((candidate) => candidate.componentId === 'public-usdm-source');
  assert.ok(root.reasonCodes.includes('USD_M_SOURCE_SILENT'), 'SC-28 invariant=ORIGINAL_CODE_RETAINED');
  assert.ok(root.affectedComponentIds.includes('basis-engine'), 'SC-28 invariant=DEPENDENT_RETAINED');
  assert.equal(snapshot.components.find((component) => component.componentId === 'public-spot-source').readiness, 'READY', 'SC-28 invariant=INDEPENDENT_SPOT_VISIBLE');
});

test('[SC-28] exposed capital elevates the true reconciliation blocker', () => {
  const snapshot = project(projectionInput({
    componentOverrides: {
      reconciliation: {
        readiness: 'FAILED',
        phase: 'FAILED',
        lastFailure: failure('reconciliation', 'RECONCILIATION_DIVERGED', { retryable: false }),
        blockerCodes: ['RECONCILIATION_DIVERGED'],
        capitalExposed: true,
        operatorAttentionRequired: true,
      },
      'public-usdm-source': {
        readiness: 'DEGRADED',
        blockerCodes: ['SOURCE_RATE_LIMITED'],
        operatorAttentionRequired: true,
      },
    },
  }));
  assert.equal(snapshot.firstRootBlockerComponentId, 'reconciliation', 'SC-28 invariant=EXPOSED_CAPITAL_PRIORITY');
  assert.equal(snapshot.rootCauses[0].severity, 'CRITICAL', 'SC-28 invariant=EXPOSED_CAPITAL_CRITICAL');
});

test('[SC-29] forged live component, trace, and validate-only claims fail closed', () => {
  const syntheticTimestamp = {
    sourceTimeMs: NOW - 100,
    receivedAtMs: NOW - 80,
    maxAgeMs: 5_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId: 'fixture.synthetic.spot',
  };
  const forgedSource = buildSystemSupervisorProjection(projectionInput({
    componentOverrides: {
      'public-spot-source': {
        authority: 'SYNTHETIC_TEST',
        truthLabel: 'LIVE_PUBLIC',
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY'],
        sourceTimestamp: syntheticTimestamp,
        freshness: evaluateFreshness(syntheticTimestamp, NOW),
      },
    },
  }));
  assert.equal(forgedSource.ok, false, 'SC-29 invariant=FORGED_SOURCE_LIVE_FAILS_CLOSED');

  const forgedRisk = buildSystemSupervisorProjection(projectionInput({
    componentOverrides: {
      'multileg-risk': {
        authority: 'LIVE_PUBLIC',
        truthLabel: 'LIVE_PUBLIC',
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'LIVE_PUBLIC'],
      },
    },
  }));
  assert.equal(forgedRisk.ok, false, 'SC-29 invariant=VALIDATE_ONLY_COMPONENT_LIVE_FAILS_CLOSED');

  const forgedSummary = buildSystemSupervisorProjection(projectionInput({
    summaryOverrides: {
      execution: {
        ...projectionInput().summaries.execution,
        truthLabel: 'LIVE_PUBLIC',
      },
    },
  }));
  assert.equal(forgedSummary.ok, false, 'SC-29 invariant=VALIDATE_ONLY_SUMMARY_LIVE_FAILS_CLOSED');

  assert.throws(
    () => buildSystemTraceIndex([traceEvent({
      id: 'forged-synthetic-live-event',
      kind: 'SOURCE',
      componentId: 'public-spot-source',
      truthLabel: 'LIVE_PUBLIC',
      releaseStatuses: ['WIRED', 'SYNTHETIC_ONLY'],
    })], NOW),
    /LIVE_TRACE/,
    'SC-29 invariant=FORGED_TRACE_LIVE_FAILS_CLOSED',
  );
});

test('[SC-29] legitimate synthetic sources and validate-only decisions remain explicitly non-live', () => {
  const syntheticTimestamp = {
    sourceTimeMs: NOW - 100,
    receivedAtMs: NOW - 80,
    maxAgeMs: 5_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId: 'fixture.synthetic.spot',
  };
  const syntheticEvent = traceEvent({
    id: 'synthetic-source-event',
    kind: 'SOURCE',
    componentId: 'public-spot-source',
    truthLabel: 'SYNTHETIC_ONLY',
    releaseStatuses: ['WIRED', 'SYNTHETIC_ONLY'],
  });
  const executionEvent = traceEvent({
    id: 'dry-execution-event',
    sequence: 2,
    kind: 'EXECUTION',
    componentId: 'execution-coordinator-validate-only',
    truthLabel: 'DRY_RUN',
    releaseStatuses: ['WIRED', 'SYNTHETIC_ONLY'],
  });
  const riskEvent = traceEvent({
    id: 'validate-only-risk-event',
    sequence: 3,
    kind: 'RISK',
    componentId: 'multileg-risk',
    truthLabel: 'DRY_RUN',
    releaseStatuses: ['WIRED', 'SYNTHETIC_ONLY'],
  });
  const snapshot = project(projectionInput({
    componentOverrides: {
      'public-spot-source': {
        authority: 'SYNTHETIC_TEST',
        truthLabel: 'SYNTHETIC_ONLY',
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY'],
        sourceTimestamp: syntheticTimestamp,
        freshness: evaluateFreshness(syntheticTimestamp, NOW),
      },
      'execution-coordinator-validate-only': {
        authority: 'SYNTHETIC_TEST',
        truthLabel: 'DRY_RUN',
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY'],
      },
      'multileg-risk': {
        authority: 'SYNTHETIC_TEST',
        truthLabel: 'DRY_RUN',
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY'],
      },
    },
    traceEvents: [syntheticEvent, executionEvent, riskEvent],
  }));

  assert.equal(snapshot.components.find((component) => component.componentId === 'public-spot-source').truthLabel, 'SYNTHETIC_ONLY', 'SC-29 invariant=SYNTHETIC_NOT_LIVE');
  assert.equal(snapshot.components.find((component) => component.componentId === 'execution-coordinator-validate-only').truthLabel, 'DRY_RUN', 'SC-29 invariant=EXECUTION_DRY_RUN');
  assert.equal(snapshot.components.find((component) => component.componentId === 'multileg-risk').truthLabel, 'DRY_RUN', 'SC-29 invariant=RISK_VALIDATE_ONLY');
  assert.equal(snapshot.summaries.execution.truthLabel, 'DRY_RUN', 'SC-29 invariant=SUMMARY_DRY_RUN');
  assert.equal(snapshot.summaries.execution.barrier, 'LIVE_EXECUTION_NOT_IMPLEMENTED', 'SC-29 invariant=LIVE_BARRIER_VISIBLE');
  assert.equal(snapshot.truthLabel, 'DRY_RUN', 'SC-29 invariant=WHOLE_MACHINE_DRY_RUN');
  const trace = snapshot.traceIndex.entries.find((entry) => entry.correlationId === CORRELATION).snapshot.events;
  assert.equal(trace.find((event) => event.id === 'synthetic-source-event').truthLabel, 'SYNTHETIC_ONLY', 'SC-29 invariant=TRACE_SYNTHETIC_NOT_LIVE');
  assert.equal(trace.find((event) => event.id === 'dry-execution-event').truthLabel, 'DRY_RUN', 'SC-29 invariant=TRACE_EXECUTION_DRY_RUN');
  assert.equal(trace.find((event) => event.id === 'validate-only-risk-event').truthLabel, 'DRY_RUN', 'SC-29 invariant=TRACE_RISK_DRY_RUN');
});

test('[SC-29] VALIDATE_ONLY permission does not manufacture observed dry-run truth', () => {
  const unavailable = Object.fromEntries([
    'public-spot-source', 'public-usdm-source', 'market-universe', 'intelligence-runtime',
    'market-intelligence', 'q-inference', 'basis-engine', 'volume-engine', 'capital-supervision',
    'multileg-risk', 'execution-coordinator-validate-only', 'reconciliation',
    'ledger-persistence', 'engine-supervisor',
  ].map((componentId) => [componentId, {
    desiredState: 'RUNNING',
    phase: 'BLOCKED',
    readiness: 'BLOCKED',
    authority: 'UNAVAILABLE',
    completeness: 'UNAVAILABLE',
    truthLabel: 'UNAVAILABLE',
    releaseStatuses: ['BUILT_AND_TESTED', 'BLOCKED'],
    sourceTimestamp: null,
    freshness: null,
    blockerCodes: ['OWNER_TRUTH_UNAVAILABLE'],
  }]));
  const snapshot = project(projectionInput({
    runtime: { phase: 'BLOCKED' },
    componentOverrides: unavailable,
  }));
  assert.equal(snapshot.control.safeMode, 'VALIDATE_ONLY', 'SC-29 invariant=PERMISSION_RETAINED');
  assert.equal(snapshot.truthLabel, 'UNAVAILABLE', 'SC-29 invariant=PERMISSION_NOT_OBSERVED_TRUTH');
  assert.equal(snapshot.summaries.execution.truthLabel, 'UNAVAILABLE', 'SC-29 invariant=NO_DRY_RUN_SUMMARY_WITHOUT_COORDINATOR');
});

test('UNKNOWN truth is non-authorizing and preserves only fully attested lifecycle or executor readiness', () => {
  const snapshot = project(projectionInput({
    componentOverrides: {
      'engine-supervisor': {
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED'],
        truthLabel: 'UNKNOWN',
        authority: 'DERIVED_LIVE',
        completeness: 'COMPLETE',
        readiness: 'READY',
        lastProcessAtMs: NOW,
        lastSuccessAtMs: NOW,
        operatorAttentionRequired: false,
      },
      'capital-supervision': {
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED'],
        truthLabel: 'UNKNOWN',
        domainObservedState: 'VALIDATE_ONLY_EXECUTOR_AVAILABLE_PRIVATE_LIVE_REFUSAL_CONFIRMED',
        authority: 'DERIVED_LIVE',
        completeness: 'COMPLETE',
        readiness: 'READY',
        lastProcessAtMs: NOW,
        lastSuccessAtMs: NOW,
      },
      'public-spot-source': {
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED'],
        truthLabel: 'UNKNOWN',
        authority: 'DERIVED_LIVE',
        readiness: 'READY',
      },
    },
  }));

  const engine = snapshot.components.find((entry) => entry.componentId === 'engine-supervisor');
  const capital = snapshot.components.find((entry) => entry.componentId === 'capital-supervision');
  const publicSpot = snapshot.components.find((entry) => entry.componentId === 'public-spot-source');
  assert.equal(engine.serviceReadiness.basis, 'MANAGED_LIFECYCLE');
  assert.equal(engine.truthLabel, 'UNKNOWN');
  assert.equal(engine.readiness, 'READY');
  assert.deepEqual(engine.blockerCodes, []);
  assert.equal(capital.serviceReadiness.basis, 'VALIDATE_ONLY_EXECUTOR');
  assert.equal(capital.truthLabel, 'UNKNOWN');
  assert.equal(capital.readiness, 'READY');
  assert.deepEqual(capital.blockerCodes, []);
  assert.equal(publicSpot.serviceReadiness.basis, 'PUBLIC_DATA');
  assert.equal(publicSpot.truthLabel, 'UNKNOWN');
  assert.equal(publicSpot.readiness, 'DEGRADED');

  for (const executorOverride of [
    { lastProcessAtMs: null, lastSuccessAtMs: null },
    { lastProcessAtMs: NOW - 1, lastSuccessAtMs: NOW - 1 },
  ]) {
    const forged = project(projectionInput({
      componentOverrides: {
        'capital-supervision': {
          releaseStatuses: ['BUILT_AND_TESTED', 'WIRED'],
          truthLabel: 'UNKNOWN',
          domainObservedState: 'VALIDATE_ONLY_EXECUTOR_AVAILABLE_PRIVATE_LIVE_REFUSAL_CONFIRMED',
          authority: 'DERIVED_LIVE',
          completeness: 'COMPLETE',
          readiness: 'READY',
          ...executorOverride,
        },
      },
    })).components.find((entry) => entry.componentId === 'capital-supervision');
    assert.equal(forged.readiness, 'DEGRADED');
  }

  for (const engineOverride of [
    { lastProcessAtMs: null, lastSuccessAtMs: null },
    { lastProcessAtMs: NOW - 2_001, lastSuccessAtMs: NOW - 2_001 },
    { blockerCodes: ['EFFECTIVE_INTAKE_PAUSED'], operatorAttentionRequired: true },
    { lastFailure: failure('engine-supervisor', 'MANAGED_DRIVER_FAILED') },
  ]) {
    const forged = project(projectionInput({
      componentOverrides: {
        'engine-supervisor': {
          releaseStatuses: ['BUILT_AND_TESTED', 'WIRED'],
          truthLabel: 'UNKNOWN',
          authority: 'DERIVED_LIVE',
          completeness: 'COMPLETE',
          readiness: 'READY',
          lastProcessAtMs: NOW,
          lastSuccessAtMs: NOW,
          operatorAttentionRequired: false,
          ...engineOverride,
        },
      },
    })).components.find((entry) => entry.componentId === 'engine-supervisor');
    assert.equal(forged.readiness, 'DEGRADED');
  }

  const partial = project(projectionInput({
    componentOverrides: {
      'engine-supervisor': {
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED'],
        truthLabel: 'UNKNOWN',
        authority: 'DERIVED_LIVE',
        completeness: 'PARTIAL',
        readiness: 'READY',
      },
    },
  })).components.find((entry) => entry.componentId === 'engine-supervisor');
  assert.equal(partial.readiness, 'DEGRADED');
  assert.ok(partial.blockerCodes.includes('SOURCE_PARTIAL'));
});
