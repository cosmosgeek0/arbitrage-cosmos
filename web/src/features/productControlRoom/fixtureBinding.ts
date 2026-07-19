import type { SystemComponentSnapshot, SystemSupervisorSnapshot, SystemSupervisorSummaries, SystemTruthLabel } from '../../lib/systemIntegration';
import {
  buildFixtureBinding,
  buildFixtureManagedInventory,
  buildSyntheticComponentPresentation,
  type ProductComponentProjection,
  type ProductFixtureScenarioId,
  type ProductFixtureSession,
  type ProductSupervisorEnvelope,
} from '../../lib/productIntegration';
import { fixtureById } from '../systemDashboard/fixtures';

const DONOR_FIXTURE: Readonly<Record<ProductFixtureScenarioId, string>> = Object.freeze({
  HEALTHY_OBSERVE: 'healthy',
  DEGRADED_STALE_SOURCES: 'stale',
  VALIDATE_ONLY_SLICE_RUNNING: 'synthetic',
  RECOVERY_REQUIRED_ONE_LEG: 'capital-exposed',
  TINY_LIVE_CANARY_OWNER_GATED: 'healthy',
});

/**
 * The donor is consumed unchanged. This adapter only projects its fixture data
 * into an always-synthetic presentation so an accepted donor LIVE_PUBLIC
 * example can never be confused with mounted runtime truth.
 */
export function buildProductControlRoomFixture(
  session: Readonly<ProductFixtureSession>,
): ProductSupervisorEnvelope<SystemSupervisorSnapshot> {
  const recoveryResolved = session.scenarioId === 'RECOVERY_REQUIRED_ONE_LEG'
    && session.lastResult?.controlId === 'recovery.execute-plan'
    && session.lastResult.status === 'APPLIED';
  const donorId = recoveryResolved ? 'healthy' : DONOR_FIXTURE[session.scenarioId];
  const donor = fixtureById(donorId).build(session.nowMs);
  const dashboard = alignDonorScenario(forceSyntheticDonorSnapshot(donor, session), session, recoveryResolved);
  const binding = buildFixtureBinding(session, dashboard);
  const components = Object.freeze(dashboard.components.map(projectDonorComponent));
  return Object.freeze({
    ...binding,
    components,
    managedInventory: buildFixtureManagedInventory(components),
    dependencyEdges: Object.freeze(dashboard.edges.map((edge) => Object.freeze({
      fromComponentId: edge.from,
      toComponentId: edge.to,
      required: edge.required,
      state: edge.state,
      rootCauseComponentId: edge.rootBlockerComponentId,
      reasonCodes: Object.freeze([...edge.reasonCodes]),
    }))),
  });
}

function alignDonorScenario(
  snapshot: SystemSupervisorSnapshot,
  session: Readonly<ProductFixtureSession>,
  recoveryResolved: boolean,
): SystemSupervisorSnapshot {
  if (session.scenarioId === 'RECOVERY_REQUIRED_ONE_LEG') {
    return {
      ...snapshot,
      overallPosture: recoveryResolved ? 'READY' : 'BLOCKED',
      firstRootBlockerComponentId: recoveryResolved ? null : 'reconciliation',
      rootBlockerComponentIds: recoveryResolved ? [] : ['reconciliation'],
      operatorAttentionComponentIds: recoveryResolved ? [] : ['reconciliation'],
      attentionQueue: recoveryResolved ? [] : snapshot.attentionQueue.map((entry) => ({
        ...entry,
        componentId: 'reconciliation',
        rootComponentId: 'reconciliation',
        capitalExposed: true,
        reasonCodes: ['ONE_LEG_EXPOSED'],
        recommendedOperatorAction: 'Use the exact synthetic recovery-plan control in the canonical registry.',
      })),
      summaries: {
        ...snapshot.summaries,
        capital: {
          ...snapshot.summaries.capital,
          activeExposureAmount: recoveryResolved ? '0.00 USDT SYNTHETIC' : '4.80 USDT SYNTHETIC',
          activeExposureCount: recoveryResolved ? 0 : 1,
          blockerCodes: recoveryResolved ? [] : ['RECOVERY_REQUIRED_ONE_LEG'],
        },
        reconciliation: {
          ...snapshot.summaries.reconciliation,
          status: recoveryResolved ? 'CONVERGED_SYNTHETIC' : 'RECOVERY_REQUIRED',
          blocksNewExposure: !recoveryResolved,
          recommendation: recoveryResolved ? null : 'Execute the exact synthetic recovery fixture.',
          reasonCodes: recoveryResolved ? [] : ['ONE_LEG_EXPOSED'],
        },
      },
    };
  }
  if (session.scenarioId === 'TINY_LIVE_CANARY_OWNER_GATED') {
    return {
      ...snapshot,
      overallPosture: 'BLOCKED',
      firstRootBlockerComponentId: 'capital-supervision',
      rootBlockerComponentIds: ['capital-supervision'],
      operatorAttentionComponentIds: ['capital-supervision'],
      components: snapshot.components.map((component) => component.componentId === 'capital-supervision' ? {
        ...component,
        readiness: 'BLOCKED',
        blockerCodes: ['OWNER_AUTHORIZATION_REQUIRED'],
        operatorAttentionRequired: true,
      } : component),
      attentionQueue: [{
        componentId: 'capital-supervision',
        rootComponentId: 'capital-supervision',
        severity: 'MEDIUM',
        reasonCodes: ['OWNER_AUTHORIZATION_REQUIRED'],
        capitalExposed: false,
        recommendedOperatorAction: 'No action is available; external owner authorization is absent.',
      }],
      summaries: {
        ...snapshot.summaries,
        capital: { ...snapshot.summaries.capital, activeExposureAmount: '0.00 USDT', activeExposureCount: 0, blockerCodes: ['OWNER_AUTHORIZATION_REQUIRED'] },
      },
    };
  }
  if (session.scenarioId === 'DEGRADED_STALE_SOURCES') {
    return {
      ...snapshot,
      summaries: {
        ...snapshot.summaries,
        capital: { ...snapshot.summaries.capital, activeExposureAmount: null, activeExposureCount: null },
      },
    };
  }
  return snapshot;
}

function projectDonorComponent(component: Readonly<SystemComponentSnapshot>): ProductComponentProjection {
  const desiredLifecycle = component.desiredState === 'STOPPED'
    ? 'STOPPED'
    : component.desiredState === 'PAUSED' ? 'PAUSED' : 'READY';
  const observedLifecycle = component.readiness;
  const projectedCapability = component.truthLabel === 'DRY_RUN' ? 'DRY_RUN' : 'SYNTHETIC';
  const restartBlocker = component.blockerCodes.find((code) => (
    code === 'RESTART_REQUIRED' || code.endsWith('_RESTART_REQUIRED')
  ));
  if (restartBlocker === undefined && component.restartCount > 0 && component.generation === 0) {
    throw new TypeError('restart count requires a nonzero runtime generation');
  }
  const restartState: ProductComponentProjection['restartState'] = restartBlocker !== undefined
    ? 'RESTART_REQUIRED'
    : component.restartCount > 0
      ? 'RESTARTED'
      : component.generation > 0 ? 'NEVER_RESTARTED' : 'UNKNOWN';
  return Object.freeze({
    componentId: component.componentId,
    owner: component.ownerPath || component.owner,
    desiredLifecycle,
    observedLifecycle,
    capability: projectedCapability,
    heartbeatAtMs: component.lastReceiveAtMs ?? component.lastSuccessAtMs,
    lastAdvanceAtMs: component.lastProcessAtMs ?? component.lastSuccessAtMs,
    sourceAgeMs: component.sourceTimestamp?.sourceTimeMs === null
      ? null
      : component.sourceTimestamp
        ? Math.max(0, component.sourceTimestamp.receivedAtMs - component.sourceTimestamp.sourceTimeMs)
        : null,
    eventAgeMs: component.freshness?.ageMs ?? null,
    processingAgeMs: component.lastReceiveAtMs !== null && component.lastProcessAtMs !== null
      ? Math.max(0, component.lastProcessAtMs - component.lastReceiveAtMs)
      : null,
    processingLagMs: component.processingLagMs ?? null,
    queueDepth: component.queue?.depth ?? null,
    queueCapacity: component.queue?.capacity ?? null,
    droppedCount: component.queue?.dropped ?? null,
    freshnessState: component.freshness?.state === 'FRESH'
      || component.freshness?.state === 'STALE'
      || component.freshness?.state === 'CLOCK_SKEWED'
      ? component.freshness.state
      : 'UNAVAILABLE',
    dataQualityState: component.dataQuality?.state ?? 'UNAVAILABLE',
    dataQualityInvalidCount: component.dataQuality?.invalidCount ?? null,
    dataQualityDuplicateCount: component.dataQuality?.duplicateCount ?? null,
    dataQualityOutOfOrderCount: component.dataQuality?.outOfOrderCount ?? null,
    dataQualitySequenceGapCount: component.dataQuality?.sequenceGapCount ?? null,
    dataQualityObservedAtMs: component.dataQuality?.observedAtMs ?? null,
    retryState: component.retry?.state ?? 'UNAVAILABLE',
    retryAttempt: component.retry?.attempt ?? null,
    retryCeiling: component.retry?.ceiling ?? null,
    backoffMs: component.retry?.delayMs ?? null,
    retryAtMs: component.retry?.retryAtMs ?? null,
    cooldownUntilMs: component.retry?.cooldownUntilMs ?? null,
    dependencyIds: Object.freeze([...component.dependencies]),
    checkpointState: component.checkpoint?.state ?? 'UNAVAILABLE',
    checkpointRevision: component.checkpoint?.revision ?? null,
    checkpointPersistedAtMs: component.checkpoint?.persistedAtMs ?? null,
    restartState,
    generation: component.generation,
    restartCount: component.restartCount,
    blockerCode: restartBlocker ?? component.blockerCodes[0] ?? null,
    rootCauseComponentId: component.blockerCodes.length ? component.componentId : null,
    capitalRelevance: component.capitalExposed ? 'EXPOSED' : 'NONE',
    supportedControlIds: Object.freeze([...component.supportedControls]),
    correlationId: null,
    truthLabel: 'SYNTHETIC_ONLY',
    canonicalPresentation: buildSyntheticComponentPresentation({
      observedLifecycle,
      capability: projectedCapability,
    }),
  });
}

function forceSyntheticDonorSnapshot(
  snapshot: SystemSupervisorSnapshot,
  session: Readonly<ProductFixtureSession>,
): SystemSupervisorSnapshot {
  return {
    ...snapshot,
    revision: session.controlRevision,
    evaluatedAtMs: session.nowMs,
    truthLabel: 'SYNTHETIC_ONLY',
    control: {
      ...snapshot.control,
      revision: session.controlRevision,
      safeMode: session.desiredMode,
      killSwitchEngaged: session.killSwitchEngaged,
      intakePaused: session.intakePaused,
      updatedAtMs: session.nowMs,
      correlationId: `fixture-correlation-${session.sessionId}`,
    },
    components: snapshot.components.map((component) => ({
      ...component,
      truthLabel: component.truthLabel === 'DRY_RUN' ? 'DRY_RUN' : 'SYNTHETIC_ONLY',
    })),
    summaries: forceSyntheticSummaries(snapshot.summaries),
    recentCorrelatedDecisions: snapshot.recentCorrelatedDecisions.map((trace) => ({
      ...trace,
      truthLabel: trace.truthLabel === 'DRY_RUN' ? 'DRY_RUN' : 'SYNTHETIC_ONLY',
    })),
  };
}

function forceSyntheticSummaries(summaries: SystemSupervisorSummaries): SystemSupervisorSummaries {
  const label = (value: SystemTruthLabel): SystemTruthLabel => value === 'DRY_RUN' ? 'DRY_RUN' : 'SYNTHETIC_ONLY';
  return {
    sourceCoverage: { ...summaries.sourceCoverage, truthLabel: label(summaries.sourceCoverage.truthLabel) },
    strategies: {
      basis: { ...summaries.strategies.basis, truthLabel: label(summaries.strategies.basis.truthLabel) },
      volume: { ...summaries.strategies.volume, truthLabel: label(summaries.strategies.volume.truthLabel) },
    },
    intelligence: { ...summaries.intelligence, truthLabel: label(summaries.intelligence.truthLabel) },
    capital: { ...summaries.capital, truthLabel: label(summaries.capital.truthLabel) },
    risk: { ...summaries.risk, truthLabel: label(summaries.risk.truthLabel) },
    execution: { ...summaries.execution, truthLabel: label(summaries.execution.truthLabel) },
    reconciliation: { ...summaries.reconciliation, truthLabel: label(summaries.reconciliation.truthLabel) },
    ledger: { ...summaries.ledger, truthLabel: label(summaries.ledger.truthLabel) },
  };
}
