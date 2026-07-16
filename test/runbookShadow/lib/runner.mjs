import { createHash } from 'node:crypto';

import {
  ROOT,
  ZERO_EFFECT,
  drillDefinition,
  drillDocument,
  readJson,
  readText,
} from './constants.mjs';
import { installNetworkDeny } from './network-deny.mjs';
import { importNativeOwner } from './native-owner-loader.mjs';
import { buildReceipt, canonicalJson, digest, validateReceipt } from './receipt.mjs';

function rawSha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function check(assertions, id, pass, observed) {
  assertions.push(Object.freeze({ id, pass: pass === true, observed }));
}

function containsAll(source, fragments) {
  return fragments.every((fragment) => source.includes(fragment));
}

function traceHas(result, action) {
  return result?.trace.some((event) => event.action === action) === true;
}

function sourceSnapshot(nowMs, overrides = {}) {
  return Object.freeze({
    sourceId: 'spot-public-source',
    transportKind: 'INJECTED',
    endpointClass: 'MARKET',
    productFamily: 'SPOT',
    desiredState: 'RUNNING',
    observedState: 'LIVE',
    connectionGeneration: 3,
    connectedAtMs: nowMs - 10_000,
    lastMessageSourceTimeMs: nowMs - 120,
    lastMessageReceiveTimeMs: nowMs - 100,
    lastProcessedTimeMs: nowMs - 90,
    messageAgeMs: 120,
    processingLagMs: 10,
    messageCount: 50,
    invalidCount: 0,
    duplicateCount: 0,
    outOfOrderCount: 0,
    sequenceGapCount: 0,
    droppedCount: 0,
    coalescedCount: 0,
    reconnectCount: 1,
    backoff: Object.freeze({ attempt: 0, ceiling: 10, delayMs: null, retryAtMs: null, cooldownUntilMs: null }),
    rateBudget: Object.freeze({
      state: 'AVAILABLE',
      usedWeight: null,
      limit: null,
      intervalMs: null,
      resetsAtMs: null,
      retryAfterMs: null,
      observedAtMs: nowMs - 100,
    }),
    lastError: null,
    recommendedAction: 'Inspect synthetic PORT-RUNBOOK source evidence.',
    authority: 'COMPLETE',
    completeness: 'COMPLETE',
    snapshotTimeMs: nowMs,
    ...overrides,
  });
}

function sourceObservation(nowMs, overrides = {}) {
  return Object.freeze({
    quietSymbolsRetained: true,
    retainedSymbols: Object.freeze([{ symbol: 'BTCUSDT', lastActivityAtMs: nowMs - 100 }]),
    focus: null,
    focusedBooks: Object.freeze([]),
    rejectedSignals: Object.freeze([]),
    proposalIds: Object.freeze([]),
    ...overrides,
  });
}

function sourceReading(nowMs, sourceOverrides = {}, readingOverrides = {}) {
  return Object.freeze({
    source: sourceSnapshot(nowMs, sourceOverrides),
    queue: Object.freeze({
      depth: 0,
      capacity: 100,
      dropped: 0,
      coalesced: 0,
      observedAtMs: nowMs,
      resyncRequired: false,
    }),
    observation: sourceObservation(nowMs),
    ...readingOverrides,
  });
}

function sourceProbeInput(nowMs, readRuntimeSourceProbe) {
  return Object.freeze({
    nowMs,
    correlationId: 'port_runbook_source_probe',
    safeCurrentState: 'READ_ONLY',
    componentId: 'public-spot-source',
    expectedSourceId: 'spot-public-source',
    owner: 'INTELLIGENCE_RUNTIME',
    ownerPath: 'server/src/intelligenceRuntime',
    acquisitionAuthority: 'SYNTHETIC_TEST',
    maxAgeMs: 1_000,
    dependencies: Object.freeze([]),
    releaseStatuses: Object.freeze(['BUILT_AND_TESTED', 'IMPORTED', 'WIRED', 'SYNTHETIC_ONLY']),
    supportedControls: Object.freeze(['SET_COMPONENT_STATE', 'RESTART_COMPONENT']),
    port: Object.freeze({ readRuntimeSourceProbe }),
  });
}

function scenarioSummary(result) {
  return Object.freeze({
    id: result.id,
    terminal: result.terminal,
    startedAtMs: result.trace[0]?.atMs ?? null,
    traceLength: result.trace.length,
    traceReasonCodes: Object.freeze([...new Set(result.trace.map((event) => event.reasonCode).filter(Boolean))].sort()),
    audit: result.audit,
  });
}

async function runI00ScenarioIds(ids, injectedAtMs) {
  const { runScenario, validateScenarioResult } = await import('../../../server/test/i00Acceptance/harness.mjs');
  const document = readJson('fixtures/i00/scenarios.json');
  return ids.map((id, scenarioIndex) => {
    const index = document.scenarios.findIndex((candidate) => candidate.id === id);
    if (index < 0) throw new Error('RUNBOOK_PORT_I00_SCENARIO_MISSING');
    const definition = document.scenarios[index];
    const result = runScenario(definition, injectedAtMs + (scenarioIndex * 10_000));
    validateScenarioResult(definition, result);
    return Object.freeze({ definition, result, summary: scenarioSummary(result) });
  });
}

async function sourceLossAdapter(definition, nowMs, assertions) {
  const { probeRuntimeSource } = await importNativeOwner('server/src/systemIntegration/adapters/probes.ts');
  const ownerSource = readText('server/src/systemIntegration/adapters/probes.ts');
  const missing = probeRuntimeSource(sourceProbeInput(nowMs, () => null));
  const gapReading = sourceReading(nowMs, {
    observedState: 'DEGRADED',
    sequenceGapCount: 1,
    authority: 'PARTIAL',
    completeness: 'PARTIAL',
  }, {
    queue: Object.freeze({
      depth: 1,
      capacity: 100,
      dropped: 0,
      coalesced: 0,
      observedAtMs: nowMs,
      resyncRequired: true,
    }),
    observation: sourceObservation(nowMs, {
      focusedBooks: Object.freeze([Object.freeze({
        sourceId: 'spot-public-source',
        symbol: 'BTCUSDT',
        sequenceComplete: false,
        pendingResyncRequestId: 'resync-port-runbook-source-gap',
        reasonCode: 'SEQUENCE_GAP',
      })]),
    }),
  });
  const gap = probeRuntimeSource(sourceProbeInput(nowMs, () => gapReading));
  const scenarios = await runI00ScenarioIds(definition.scenarioIds, nowMs);
  const stale = scenarios[0].result;
  const bindings = Object.freeze({
    unavailableBlock: ownerSource.includes("blockerCodes: Object.freeze(['SOURCE_SNAPSHOT_UNAVAILABLE'])") && ownerSource.includes("readiness: 'BLOCKED'"),
    sequenceGap: ownerSource.includes("blockers.add('SEQUENCE_GAP')") && ownerSource.includes("readiness = 'DEGRADED'"),
    resync: ownerSource.includes('const resyncRequired =') && ownerSource.includes('pendingResyncRequestId'),
    unavailableTruth: ownerSource.includes("truthLabel: 'UNAVAILABLE'") && ownerSource.includes("authority: 'UNAVAILABLE'"),
  });
  const evidenceChecks = Object.freeze({
    sourceLossBlocks: missing.ok === true
      && missing.value.component.readiness === 'BLOCKED'
      && missing.value.component.blockerCodes.includes('SOURCE_SNAPSHOT_UNAVAILABLE'),
    sequenceGapDegrades: gap.ok === true
      && gap.value.component.readiness === 'DEGRADED'
      && gap.value.component.blockerCodes.includes('SEQUENCE_GAP'),
    resyncRequiredRetained: gap.ok === true
      && gap.value.resyncRequired === true
      && gap.value.observation.focusedBooks[0]?.pendingResyncRequestId === 'resync-port-runbook-source-gap',
    noFalseLiveLabel: missing.ok === true
      && missing.value.component.truthLabel === 'UNAVAILABLE'
      && gap.ok === true
      && gap.value.component.truthLabel !== 'LIVE',
    stalePublicBlocks: stale.terminal === 'BLOCKED_STALE_PUBLIC' && stale.audit.productionMutations === 0,
  });
  check(assertions, 'SOURCE_LOSS_BLOCKS', bindings.unavailableBlock && evidenceChecks.sourceLossBlocks, missing.ok ? missing.value.component : 'PROBE_REJECTED');
  check(assertions, 'SEQUENCE_GAP_DEGRADES', bindings.sequenceGap && evidenceChecks.sequenceGapDegrades, gap.ok ? gap.value.component : 'PROBE_REJECTED');
  check(assertions, 'RESYNC_REQUIRED_RETAINED', bindings.resync && evidenceChecks.resyncRequiredRetained, gap.ok ? gap.value.resyncRequired : 'PROBE_REJECTED');
  check(assertions, 'NO_FALSE_LIVE_LABEL', bindings.unavailableTruth && evidenceChecks.noFalseLiveLabel, gap.ok ? gap.value.component.truthLabel : 'PROBE_REJECTED');
  check(assertions, 'STALE_PUBLIC_BLOCKS_NEW_EXPOSURE', stale.terminal === 'BLOCKED_STALE_PUBLIC' && stale.audit.productionMutations === 0, stale.terminal);

  return Object.freeze({
    expectedFailureObserved: Object.values(evidenceChecks).every(Boolean),
    runtimeExecutions: definition.runtimeExecutionPlan,
    contractBindings: bindings,
    evidenceChecks,
    sourceLossProjection: missing.ok ? Object.freeze({
      readiness: missing.value.component.readiness,
      truthLabel: missing.value.component.truthLabel,
      blockerCodes: missing.value.component.blockerCodes,
    }) : null,
    sequenceGapProjection: gap.ok ? Object.freeze({
      readiness: gap.value.component.readiness,
      truthLabel: gap.value.component.truthLabel,
      blockerCodes: gap.value.component.blockerCodes,
      resyncRequired: gap.value.resyncRequired,
      pendingResyncRequestId: gap.value.observation.focusedBooks[0]?.pendingResyncRequestId ?? null,
    }) : null,
    scenarios: scenarios.map((scenario) => scenario.summary),
  });
}

async function staleTruthAdapter(definition, nowMs, assertions) {
  const { probeRuntimeSource } = await importNativeOwner('server/src/systemIntegration/adapters/probes.ts');
  const probeSource = readText('server/src/systemIntegration/adapters/probes.ts');
  const freshnessSource = readText('server/src/foundation/contracts/time.ts');
  const dialectSource = readText('server/src/systemIntegration/contracts/dialects.ts');
  const staleReading = sourceReading(nowMs, {
    observedState: 'LIVE',
    lastMessageSourceTimeMs: nowMs - 5_000,
    lastMessageReceiveTimeMs: nowMs - 10,
    lastProcessedTimeMs: nowMs - 5,
    messageAgeMs: 5_000,
  });
  const stale = probeRuntimeSource(sourceProbeInput(nowMs, () => staleReading));
  const scenarios = await runI00ScenarioIds(definition.scenarioIds, nowMs);
  const byId = new Map(scenarios.map((scenario) => [scenario.result.id, scenario.result]));
  const bindings = Object.freeze({
    staleDegrades: containsAll(dialectSource, ["case 'STALE':", "readinessEvidence = 'DEGRADED'"])
      && probeSource.includes("blockers.add(`SOURCE_${temporal.freshness.state}`)"),
    staleUnavailable: containsAll(probeSource, [
      'let effectiveAuthority = temporal.freshness === null',
      'weakestAuthority(input.acquisitionAuthority, temporal.freshness.effectiveAuthority)',
      'const label = truthLabel(effectiveAuthority, readiness)',
    ]),
    sourceTimeOwnsAge: containsAll(probeSource, [
      'sourceTimeMs: snapshot.lastMessageSourceTimeMs',
      'receivedAtMs: snapshot.lastMessageReceiveTimeMs',
      'evaluateFreshness(timestamp, input.nowMs)',
    ]) && containsAll(freshnessSource, [
      'const usingSource = timestamp.sourceTimeMs !== null',
      'const basisTime = usingSource ? (timestamp.sourceTimeMs as number) : timestamp.receivedAtMs',
      "basis: usingSource ? ('SOURCE_TIME' as const) : ('RECEIPT_TIME' as const)",
    ]),
  });

  const evidenceChecks = Object.freeze({
    staleSourceDegraded: stale.ok === true && stale.value.component.readiness === 'DEGRADED',
    staleSourceUnavailable: stale.ok === true
      && stale.value.component.truthLabel === 'UNAVAILABLE'
      && stale.value.component.authority === 'UNAVAILABLE',
    sourceTimeOwnsAge: stale.ok === true
      && stale.value.component.freshness.state === 'STALE'
      && stale.value.component.freshness.basis === 'SOURCE_TIME'
      && stale.value.component.sourceTimestamp.receivedAtMs === nowMs - 10,
    privateStaleBlocks: byId.get('I00-10')?.terminal === 'BLOCKED_STALE_PRIVATE_RECOVERY_VISIBLE',
    recoveryRemainsVisible: byId.get('I00-10')?.audit.recoveryVisible === true,
    qStaleAbstains: byId.get('I00-11')?.terminal === 'Q_STALE_ABSTAIN',
  });
  check(assertions, 'STALE_SOURCE_DEGRADED', bindings.staleDegrades && evidenceChecks.staleSourceDegraded, stale.ok ? stale.value.component.readiness : 'PROBE_REJECTED');
  check(assertions, 'STALE_SOURCE_UNAVAILABLE', bindings.staleUnavailable && evidenceChecks.staleSourceUnavailable, stale.ok ? { truthLabel: stale.value.component.truthLabel, authority: stale.value.component.authority } : 'PROBE_REJECTED');
  check(assertions, 'SOURCE_TIME_OWNS_AGE', bindings.sourceTimeOwnsAge && evidenceChecks.sourceTimeOwnsAge, stale.ok ? stale.value.component.freshness : 'PROBE_REJECTED');
  check(assertions, 'PRIVATE_STALE_BLOCKS', byId.get('I00-10')?.terminal === 'BLOCKED_STALE_PRIVATE_RECOVERY_VISIBLE', byId.get('I00-10')?.terminal ?? null);
  check(assertions, 'RECOVERY_REMAINS_VISIBLE', byId.get('I00-10')?.audit.recoveryVisible === true, byId.get('I00-10')?.audit.recoveryVisible ?? null);
  check(assertions, 'Q_STALE_ABSTAINS', byId.get('I00-11')?.terminal === 'Q_STALE_ABSTAIN', byId.get('I00-11')?.terminal ?? null);

  return Object.freeze({
    expectedFailureObserved: Object.values(evidenceChecks).every(Boolean),
    runtimeExecutions: definition.runtimeExecutionPlan,
    contractBindings: bindings,
    evidenceChecks,
    staleProjection: stale.ok ? Object.freeze({
      readiness: stale.value.component.readiness,
      truthLabel: stale.value.component.truthLabel,
      authority: stale.value.component.authority,
      freshness: stale.value.component.freshness,
      sourceTimestamp: stale.value.component.sourceTimestamp,
      blockerCodes: stale.value.component.blockerCodes,
    }) : null,
    scenarios: scenarios.map((scenario) => scenario.summary),
  });
}

async function restartAmbiguityAdapter(definition, nowMs, assertions) {
  const {
    createInitialCheckpointState,
    evaluateRestartBarrier,
    prepareStartupState,
    upsertDryRunExecutionReference,
    upsertReconciliationReference,
    withRestartTruth,
  } = await importNativeOwner('server/src/systemIntegration/persistence/restart.ts');
  const restartSource = readText('server/src/systemIntegration/persistence/restart.ts');
  const startupStart = restartSource.indexOf('export function prepareStartupState');
  const startupEnd = restartSource.indexOf('export function withRestartTruth', startupStart);
  const startupContract = startupStart >= 0 && startupEnd > startupStart
    ? restartSource.slice(startupStart, startupEnd)
    : '';
  let state = createInitialCheckpointState(nowMs, 'port_runbook_restart_cold');
  state = prepareStartupState(state, { startedAtMs: nowMs + 1, correlationId: 'port_runbook_restart_first' });
  state = withRestartTruth(state, {
    publicSourceTruth: 'FRESH',
    accountTruth: 'FRESH',
    reconciliationTruth: 'FRESH',
    observedAtMs: nowMs + 2,
  });
  state = upsertDryRunExecutionReference(state, {
    planId: 'plan-port-runbook-ambiguous',
    checkpointDigest: 'a'.repeat(64),
    serializedCheckpoint: '{}',
    domainLifecycle: 'PARTIALLY_APPLIED',
    dryRun: true,
    requiresReconciliation: true,
    correlationId: 'port_runbook_restart_ambiguous',
    updatedAtMs: nowMs + 3,
  });
  state = upsertReconciliationReference(state, {
    planId: 'plan-port-runbook-ambiguous',
    ownerRevision: 'reconciliation-port-runbook-1',
    domainStatus: 'DIVERGENT',
    allowsNewExposure: false,
    reasonCodes: ['ONE_LEG_ONLY'],
    correlationId: 'port_runbook_restart_ambiguous',
    observedAtMs: nowMs + 4,
  });
  const beforeRestart = evaluateRestartBarrier(state, nowMs + 5);
  const restarted = prepareStartupState(state, { startedAtMs: nowMs + 6, correlationId: 'port_runbook_restart_second' });
  const afterRestart = evaluateRestartBarrier(restarted, nowMs + 7);
  const scenarios = await runI00ScenarioIds(definition.scenarioIds, nowMs);
  const byId = new Map(scenarios.map((scenario) => [scenario.result.id, scenario.result]));
  const bindings = Object.freeze({
    preservesReferences: containsAll(restartSource, ['...current', '...patch'])
      && startupContract.includes('finalize(next(current')
      && !startupContract.includes('dryRunExecutions:')
      && !startupContract.includes('reconciliations:'),
    resetsTruthUnknown: containsAll(startupContract, [
      "publicSourceTruth: 'UNKNOWN'",
      "accountTruth: 'UNKNOWN'",
      "reconciliationTruth: 'UNKNOWN'",
      'observedAtMs: null',
    ]),
    reconciliationBlocks: containsAll(restartSource, [
      "reasons.add('DRY_RUN_EXECUTION_RECONCILIATION_REQUIRED')",
      "reasons.add('RECONCILIATION_BLOCKS_NEW_EXPOSURE')",
      'canOpenOrIncrease: reasons.size === 0',
    ]),
    supervisionContinues: restartSource.includes('supervisionContinues: true as const'),
  });

  const evidenceChecks = Object.freeze({
    ambiguousReferenceSurvives: restarted.dryRunExecutions.some((entry) => entry.planId === 'plan-port-runbook-ambiguous')
      && restarted.reconciliations.some((entry) => entry.planId === 'plan-port-runbook-ambiguous' && entry.allowsNewExposure === false),
    startupResetsTruthUnknown: restarted.restartTruth.publicSourceTruth === 'UNKNOWN'
      && restarted.restartTruth.accountTruth === 'UNKNOWN'
      && restarted.restartTruth.reconciliationTruth === 'UNKNOWN'
      && restarted.restartTruth.observedAtMs === null,
    reconciliationRequiredBlocks: beforeRestart.canOpenOrIncrease === false
      && afterRestart.canOpenOrIncrease === false
      && afterRestart.reconciliationRequiredPlanIds.includes('plan-port-runbook-ambiguous'),
    supervisionContinues: beforeRestart.supervisionContinues === true && afterRestart.supervisionContinues === true,
    noDuplicateSubmission: byId.get('I00-12')?.audit.submissionCalls === 1 && byId.get('I00-17')?.audit.submissionCalls === 1,
    readyOnlyAfterReconciliation: byId.get('I00-15')?.audit.reconciledBeforeReady === true
      && byId.get('I00-17')?.audit.reconciledBeforeReady === true,
  });
  check(assertions, 'AMBIGUOUS_REFERENCE_SURVIVES_STARTUP', bindings.preservesReferences && evidenceChecks.ambiguousReferenceSurvives, { executions: restarted.dryRunExecutions.length, reconciliations: restarted.reconciliations.length });
  check(assertions, 'STARTUP_RESETS_TRUTH_UNKNOWN', bindings.resetsTruthUnknown && evidenceChecks.startupResetsTruthUnknown, restarted.restartTruth);
  check(assertions, 'RECONCILIATION_REQUIRED_BLOCKS', bindings.reconciliationBlocks && evidenceChecks.reconciliationRequiredBlocks, { before: beforeRestart.reasonCodes, after: afterRestart.reasonCodes });
  check(assertions, 'SUPERVISION_CONTINUES', bindings.supervisionContinues && evidenceChecks.supervisionContinues, { before: beforeRestart.supervisionContinues, after: afterRestart.supervisionContinues });
  check(assertions, 'NO_DUPLICATE_SUBMISSION', byId.get('I00-12')?.audit.submissionCalls === 1 && byId.get('I00-17')?.audit.submissionCalls === 1, { ambiguous: byId.get('I00-12')?.audit.submissionCalls, dbFailure: byId.get('I00-17')?.audit.submissionCalls });
  check(assertions, 'READY_ONLY_AFTER_RECONCILIATION', byId.get('I00-15')?.audit.reconciledBeforeReady === true && byId.get('I00-17')?.audit.reconciledBeforeReady === true, { crashRestart: byId.get('I00-15')?.audit.reconciledBeforeReady, dbFailure: byId.get('I00-17')?.audit.reconciledBeforeReady });

  return Object.freeze({
    expectedFailureObserved: Object.values(evidenceChecks).every(Boolean),
    runtimeExecutions: definition.runtimeExecutionPlan,
    contractBindings: bindings,
    evidenceChecks,
    beforeRestart,
    afterRestart,
    preservedPlanIds: Object.freeze(restarted.dryRunExecutions.map((entry) => entry.planId)),
    preservedReconciliations: Object.freeze(restarted.reconciliations.map((entry) => Object.freeze({
      planId: entry.planId,
      domainStatus: entry.domainStatus,
      allowsNewExposure: entry.allowsNewExposure,
    }))),
    scenarios: scenarios.map((scenario) => scenario.summary),
  });
}

async function watchdogFailureAdapter(definition, nowMs, assertions) {
  const {
    evaluateWatchdogDelivery,
    projectIndependentSentinel,
  } = await importNativeOwner('server/src/productAssurance/projections/operationalTruth.ts');
  const { buildProductRuntimeManagedInventory } = await importNativeOwner('server/src/productIntegration/runtime/managedInventory.ts');
  const assuranceSource = readText('server/src/productAssurance/projections/operationalTruth.ts');
  const inventorySource = readText('server/src/productIntegration/runtime/managedInventory.ts');
  const sentinel = projectIndependentSentinel([Object.freeze({
    checkId: 'PORT_RUNBOOK_WATCHDOG_HEARTBEAT',
    producerId: 'APPLICATION_SELF_REPORT',
    verifierId: 'INDEPENDENT_WATCHDOG',
    selfReportedVerdict: 'PASS',
    independentVerdict: 'FAIL',
    checkedAtMs: nowMs - 100,
    maximumAgeMs: 1_000,
    capitalCritical: true,
  })], nowMs);
  const timedOutDelivery = evaluateWatchdogDelivery(Object.freeze({
    notificationId: 'PORT_RUNBOOK_WATCHDOG_PAGE',
    sentAtMs: nowMs - 10_000,
    deliveredAtMs: null,
    channelId: 'SYNTHETIC_CHANNEL',
    deliveryDigest: null,
    maximumAgeMs: 1_000,
  }), nowMs);
  const missingDelivery = evaluateWatchdogDelivery(null, nowMs);
  const inventory = buildProductRuntimeManagedInventory([]);
  const watchdog = inventory.entries.find((entry) => entry.identity === 'external-watchdog');
  const incidentRouter = inventory.entries.find((entry) => entry.identity === 'notification-incident-router');
  const scenarios = await runI00ScenarioIds(definition.scenarioIds, nowMs);
  const flood = scenarios[0].result;
  const bindings = Object.freeze({
    independentSentinelFails: containsAll(assuranceSource, [
      "if (check.independentVerdict === 'FAIL') failed.push(check.checkId)",
      "reasons.push('INDEPENDENT_SENTINEL_FAILED')",
      "verdict: failed.length > 0 ? 'FAIL'",
    ]),
    disagreementVisible: assuranceSource.includes("reasons.push('SELF_REPORT_SENTINEL_DISAGREEMENT')"),
    deliveryTimeoutFails: containsAll(assuranceSource, [
      "failed.push('WATCHDOG_DELIVERY_TIMEOUT')",
      "verdict: failed.length > 0 ? 'FAIL'",
    ]),
    missingDeliveryUnknown: assuranceSource.includes("return Object.freeze({ verdict: 'UNKNOWN', reasonCodes: Object.freeze(['WATCHDOG_DELIVERY_RECEIPT_MISSING']) })"),
    ownersUnmounted: containsAll(inventorySource, [
      "unavailable('notification-incident-router', 'NOTIFICATION_INCIDENT_ROUTER', 'NOT_CONFIGURED', 'INCIDENT_OWNER_NOT_CONFIGURED')",
      "unavailable('external-watchdog', 'OPS_EXTERNAL_WATCHDOG', 'MISSING', 'EXTERNAL_WATCHDOG_MANAGED_COMPONENT_MISSING')",
    ]),
  });

  const evidenceChecks = Object.freeze({
    independentSentinelFails: sentinel.verdict === 'FAIL'
      && sentinel.failedCheckIds.includes('PORT_RUNBOOK_WATCHDOG_HEARTBEAT'),
    disagreementVisible: sentinel.disagreements.includes('PORT_RUNBOOK_WATCHDOG_HEARTBEAT')
      && sentinel.reasonCodes.includes('SELF_REPORT_SENTINEL_DISAGREEMENT'),
    deliveryTimeoutFails: timedOutDelivery.verdict === 'FAIL'
      && timedOutDelivery.reasonCodes.includes('WATCHDOG_DELIVERY_TIMEOUT'),
    missingDeliveryUnknown: missingDelivery.verdict === 'UNKNOWN'
      && missingDelivery.reasonCodes.includes('WATCHDOG_DELIVERY_RECEIPT_MISSING'),
    incidentFloodGrouped: flood.audit.incidentGroups === 1,
    materialEventsRetained: flood.audit.materialEventCount === 100,
    ownersUnmounted: watchdog?.inventoryState === 'MISSING'
      && watchdog.reasonCode === 'EXTERNAL_WATCHDOG_MANAGED_COMPONENT_MISSING'
      && incidentRouter?.inventoryState === 'NOT_CONFIGURED'
      && incidentRouter.reasonCode === 'INCIDENT_OWNER_NOT_CONFIGURED',
  });
  check(assertions, 'INDEPENDENT_SENTINEL_FAILS', bindings.independentSentinelFails && evidenceChecks.independentSentinelFails, sentinel);
  check(assertions, 'SELF_REPORT_DISAGREEMENT_VISIBLE', bindings.disagreementVisible && evidenceChecks.disagreementVisible, sentinel.reasonCodes);
  check(assertions, 'DELIVERY_TIMEOUT_FAILS', bindings.deliveryTimeoutFails && evidenceChecks.deliveryTimeoutFails, timedOutDelivery);
  check(assertions, 'MISSING_DELIVERY_UNKNOWN', bindings.missingDeliveryUnknown && evidenceChecks.missingDeliveryUnknown, missingDelivery);
  check(assertions, 'INCIDENT_FLOOD_GROUPED', flood.audit.incidentGroups === 1, flood.audit.incidentGroups);
  check(assertions, 'MATERIAL_EVENTS_RETAINED', flood.audit.materialEventCount === 100, flood.audit.materialEventCount);
  check(assertions, 'WATCHDOG_REMAINS_UNMOUNTED', bindings.ownersUnmounted && evidenceChecks.ownersUnmounted, { watchdog, incidentRouter });

  return Object.freeze({
    expectedFailureObserved: Object.values(evidenceChecks).every(Boolean),
    runtimeExecutions: definition.runtimeExecutionPlan,
    contractBindings: bindings,
    evidenceChecks,
    sentinel,
    timedOutDelivery,
    missingDelivery,
    managedInventory: Object.freeze({
      externalWatchdog: Object.freeze({ state: watchdog?.inventoryState ?? null, reasonCode: watchdog?.reasonCode ?? null }),
      notificationIncidentRouter: Object.freeze({ state: incidentRouter?.inventoryState ?? null, reasonCode: incidentRouter?.reasonCode ?? null }),
    }),
    scenarios: scenarios.map((scenario) => scenario.summary),
  });
}

async function rollbackAdapter(definition, nowMs, assertions) {
  const scenarios = await runI00ScenarioIds(definition.scenarioIds, nowMs);
  const result = scenarios[0].result;
  const forced = result.trace.some((event) => /FORCED|force-with-exposure/i.test(`${event.action} ${event.reasonCode ?? ''}`));
  const evidenceChecks = Object.freeze({
    preflightMismatchRejected: result.terminal === 'PREFLIGHT_REJECTED_CURRENT_RELEASE_ACTIVE'
      && result.trace.some((event) => event.reasonCode === 'RELEASE_SHA_MISMATCH'),
    currentReleasePreserved: result.audit.currentReleasePreserved === true,
    noForcePathInvoked: forced === false,
    noServiceOrDeploymentCall: result.audit.productionMutations === 0,
  });
  check(assertions, 'PREFLIGHT_MISMATCH_REJECTED', result.terminal === 'PREFLIGHT_REJECTED_CURRENT_RELEASE_ACTIVE' && result.trace.some((event) => event.reasonCode === 'RELEASE_SHA_MISMATCH'), { terminal: result.terminal, reasonCodes: scenarios[0].summary.traceReasonCodes });
  check(assertions, 'CURRENT_RELEASE_PRESERVED', result.audit.currentReleasePreserved === true, result.audit.currentReleasePreserved);
  check(assertions, 'NO_FORCE_PATH_INVOKED', forced === false, forced);
  check(assertions, 'NO_SERVICE_OR_DEPLOYMENT_CALL', result.audit.productionMutations === 0, result.audit.productionMutations);
  return Object.freeze({
    expectedFailureObserved: Object.values(evidenceChecks).every(Boolean),
    runtimeExecutions: definition.runtimeExecutionPlan,
    contractBindings: Object.freeze({}),
    operationalOwnerInvoked: false,
    evidenceChecks,
    currentReleasePreserved: result.audit.currentReleasePreserved,
    scenarios: scenarios.map((scenario) => scenario.summary),
  });
}

async function restoreAdapter(definition, nowMs, assertions) {
  const { buildProductRuntimeManagedInventory } = await importNativeOwner('server/src/productIntegration/runtime/managedInventory.ts');
  const inventorySource = readText('server/src/productIntegration/runtime/managedInventory.ts');
  const beforeFixtureDigest = rawSha256(readText('fixtures/i00/scenarios.json'));
  const scenarios = await runI00ScenarioIds(definition.scenarioIds, nowMs);
  const afterFixtureDigest = rawSha256(readText('fixtures/i00/scenarios.json'));
  const result = scenarios[0].result;
  const inventory = buildProductRuntimeManagedInventory([]);
  const restore = inventory.entries.find((entry) => entry.identity === 'backup-restore');
  const ownerMissing = inventorySource.includes("unavailable('backup-restore', 'OPS_BACKUP_RESTORE', 'MISSING', 'BACKUP_RESTORE_MANAGED_COMPONENT_MISSING')");
  const evidenceChecks = Object.freeze({
    isolatedRestoreVerified: result.terminal === 'ISOLATED_RESTORE_NO_PRODUCTION_MUTATION'
      && result.audit.isolatedRestoreVerified === true,
    productionFixtureUnchanged: beforeFixtureDigest === afterFixtureDigest,
    productionRestoreBlocked: restore?.inventoryState === 'MISSING',
    backupRestoreOwnerMissing: restore?.reasonCode === 'BACKUP_RESTORE_MANAGED_COMPONENT_MISSING',
  });
  check(assertions, 'ISOLATED_RESTORE_VERIFIED', result.terminal === 'ISOLATED_RESTORE_NO_PRODUCTION_MUTATION' && result.audit.isolatedRestoreVerified === true, { terminal: result.terminal, verified: result.audit.isolatedRestoreVerified });
  check(assertions, 'PRODUCTION_FIXTURE_UNCHANGED', evidenceChecks.productionFixtureUnchanged, { beforeFixtureDigest, afterFixtureDigest });
  check(assertions, 'PRODUCTION_RESTORE_REMAINS_BLOCKED', evidenceChecks.productionRestoreBlocked, restore?.inventoryState ?? null);
  check(assertions, 'BACKUP_RESTORE_OWNER_REMAINS_MISSING', ownerMissing && evidenceChecks.backupRestoreOwnerMissing, restore?.reasonCode ?? null);
  return Object.freeze({
    expectedFailureObserved: Object.values(evidenceChecks).every(Boolean),
    runtimeExecutions: definition.runtimeExecutionPlan,
    operationalOwnerInvoked: false,
    contractBindings: Object.freeze({ backupRestoreOwnerMissing: ownerMissing }),
    evidenceChecks,
    fixtureDigest: Object.freeze({ beforeSha256: beforeFixtureDigest, afterSha256: afterFixtureDigest }),
    managedInventory: Object.freeze({ state: restore?.inventoryState ?? null, reasonCode: restore?.reasonCode ?? null }),
    scenarios: scenarios.map((scenario) => scenario.summary),
  });
}

async function reconciliationFailureAdapter(definition, nowMs, assertions) {
  const reconciliationSource = readText('server/src/foundation/reconciliation/engine.ts');
  const scenarios = await runI00ScenarioIds(definition.scenarioIds, nowMs);
  const byId = new Map(scenarios.map((scenario) => [scenario.result.id, scenario.result]));
  const ambiguous = byId.get('I00-12');
  const partial = byId.get('I00-13');
  const dbFailure = byId.get('I00-17');
  const bindings = Object.freeze({
    noExecutionAuthority: reconciliationSource.includes("executionAuthority: 'NONE' as const"),
    recommendationsOnly: reconciliationSource.includes('recommendations are never run'),
  });
  const evidenceChecks = Object.freeze({
    oneLegReconciliationPartial: partial?.terminal === 'RECOVERY_REQUIRED_ONE_LEG',
    exposureRemainsNonzero: (partial?.audit.activeResidualLiability ?? 0) > 0,
    newEntriesHalted: partial?.audit.newEntriesHalted === true,
    recoveryVisible: partial?.audit.recoveryVisible === true,
    noDuplicateSubmission: ambiguous?.audit.submissionCalls === 1 && dbFailure?.audit.submissionCalls === 1,
    reconciliationPrecedesReady: dbFailure?.audit.reconciledBeforeReady === true,
  });
  check(assertions, 'ONE_LEG_RECONCILIATION_PARTIAL', evidenceChecks.oneLegReconciliationPartial, partial?.terminal ?? null);
  check(assertions, 'EXPOSURE_REMAINS_NONZERO', (partial?.audit.activeResidualLiability ?? 0) > 0, partial?.audit.activeResidualLiability ?? null);
  check(assertions, 'NEW_ENTRIES_HALTED', partial?.audit.newEntriesHalted === true, partial?.audit.newEntriesHalted ?? null);
  check(assertions, 'RECOVERY_VISIBLE', partial?.audit.recoveryVisible === true, partial?.audit.recoveryVisible ?? null);
  check(assertions, 'NO_DUPLICATE_SUBMISSION', ambiguous?.audit.submissionCalls === 1 && dbFailure?.audit.submissionCalls === 1, { ambiguous: ambiguous?.audit.submissionCalls, dbFailure: dbFailure?.audit.submissionCalls });
  check(assertions, 'RECONCILIATION_PRECEDES_READY', dbFailure?.audit.reconciledBeforeReady === true, dbFailure?.audit.reconciledBeforeReady ?? null);
  return Object.freeze({
    expectedFailureObserved: Object.values(evidenceChecks).every(Boolean),
    runtimeExecutions: definition.runtimeExecutionPlan,
    contractBindings: bindings,
    evidenceChecks,
    executionAuthority: 'NONE',
    scenarios: scenarios.map((scenario) => scenario.summary),
  });
}

async function emergencyStopAdapter(definition, nowMs, assertions) {
  const { SystemControlService } = await importNativeOwner('server/src/systemIntegration/controls/service.ts');
  const { LIVE_EXECUTION_BLOCK_CODE } = await importNativeOwner('server/src/foundation/contracts/runtime.ts');
  const { InMemoryControlPersistence } = await import('../../../server/test/systemIntegration/fixtures/memory-persistence.mjs');
  const { BoundedInMemoryLedger } = await import('../../../server/test/systemIntegration/fixtures/memory-ledger.mjs');
  const serviceSource = readText('server/src/systemIntegration/controls/service.ts');
  const executionSource = readText('server/src/foundation/contracts/runtime.ts');
  const initialState = (overrides = {}) => Object.freeze({
    revision: 0,
    generation: 1,
    safeMode: 'READ_ONLY',
    killSwitchEngaged: false,
    intakePaused: false,
    updatedAtMs: nowMs,
    correlationId: 'port_runbook_control_initial',
    ...overrides,
  });
  const request = (idempotencyKey, expectedRevision, mutation) => Object.freeze({
    idempotencyKey,
    expectedRevision,
    reason: 'PORT-RUNBOOK deterministic zero-effect emergency drill',
    requestedAtMs: nowMs + 100 + expectedRevision,
    correlationId: `port_runbook_${idempotencyKey.replace(/[^A-Za-z0-9]/g, '_')}`,
    mutation: Object.freeze(mutation),
  });
  const compositionPort = () => {
    let publishCount = 0;
    return Object.freeze({
      inspectMutation: async (mutation) => Object.freeze({
        ok: true,
        applied: true,
        riskIncreasing: mutation.command === 'SET_COMPONENT_STATE',
        code: 'CONTROL_APPLIED',
        message: '',
      }),
      publishCommitted: async () => { publishCount += 1; },
      inspectCommittedPublication: () => 'UNKNOWN',
      publishCount: () => publishCount,
    });
  };
  const persistencePort = (persistence, ledger) => {
    const rejectionIds = new Map();
    return Object.freeze({
      findControlMutation: (key) => persistence.findControlMutation(key),
      commitControlMutation: (commit) => persistence.commitControlMutation(commit),
      markControlRuntimePublished: (commit) => persistence.markControlRuntimePublished(commit),
      recordControlRejection: async (audit) => {
        const prior = rejectionIds.get(audit.dedupeKey);
        if (prior !== undefined) return Object.freeze({ kind: 'IDEMPOTENT_REPLAY', ledgerEventId: prior });
        const event = ledger.logEvent('system.control.rejection', null, audit);
        rejectionIds.set(audit.dedupeKey, event.id);
        return Object.freeze({ kind: 'RECORDED', ledgerEventId: event.id });
      },
    });
  };
  const actor = Object.freeze({ id: 'port-runbook-local-operator', email: null, source: 'loopback' });
  const clock = Object.freeze({ nowMs: () => nowMs });
  const engageInitial = initialState();
  const engageLedger = new BoundedInMemoryLedger(clock);
  const persistence = new InMemoryControlPersistence(engageLedger, engageInitial);
  const composition = compositionPort();
  const service = new SystemControlService({
    initialState: engageInitial,
    persistence: persistencePort(persistence, engageLedger),
    composition,
  });
  const engageRequest = request('kill.engage.port-runbook', 0, { command: 'SET_KILL_SWITCH', engaged: true });
  const engaged = await service.mutate(engageRequest, actor);
  const replay = await service.mutate(engageRequest, actor);
  const riskIncrease = await service.mutate(request('risk.increase.port-runbook', 1, {
    command: 'SET_COMPONENT_STATE',
    componentId: 'execution-coordinator-validate-only',
    desiredState: 'RUNNING',
  }), actor);
  const releaseInitial = initialState({ revision: 1, killSwitchEngaged: true, intakePaused: true });
  const releaseLedger = new BoundedInMemoryLedger(clock);
  const releasePersistence = new InMemoryControlPersistence(releaseLedger, releaseInitial);
  const releaseService = new SystemControlService({
    initialState: releaseInitial,
    persistence: persistencePort(releasePersistence, releaseLedger),
    composition: compositionPort(),
  });
  const released = await releaseService.mutate(request('kill.release.port-runbook', 1, {
    command: 'SET_KILL_SWITCH',
    engaged: false,
  }), actor);
  const scenarios = await runI00ScenarioIds(definition.scenarioIds, nowMs);
  const byId = new Map(scenarios.map((scenario) => [scenario.result.id, scenario.result]));
  const killDuringEntry = byId.get('I00-14');
  const duplicateCommand = byId.get('I00-18');
  const killBranch = /else if \(mutation\.command === 'SET_KILL_SWITCH'\) \{[\s\S]*?killSwitchEngaged = mutation\.engaged;[\s\S]*?if \(mutation\.engaged\) intakePaused = true;[\s\S]*?\} else if \(mutation\.command === 'SET_INTAKE_PAUSED'\)/.test(serviceSource);
  const bindings = Object.freeze({
    killAndPauseAsymmetric: killBranch,
    exactReplay: containsAll(serviceSource, [
      'const existing = await this.persistence.findControlMutation(request.idempotencyKey)',
      'if (existing.requestDigest !== requestDigest)',
      'return ok(existing.receipt)',
      "if (persisted.kind === 'IDEMPOTENT_REPLAY')",
      'return ok(persisted.receipt)',
    ]),
    riskIncreaseBlocked: containsAll(serviceSource, [
      'if (decision.riskIncreasing && this.stateValue.killSwitchEngaged)',
      "SYSTEM_CONTROL_FAILURE_CODES.KILL_SWITCH_ENGAGED",
      'Kill switch blocks risk-increasing control activity.',
    ]),
    liveExecutionBarrier: executionSource.includes("export const LIVE_EXECUTION_BLOCK_CODE = 'LIVE_EXECUTION_NOT_IMPLEMENTED'"),
  });
  const committedCount = persistence.journalSnapshot().filter((entry) => entry.operation === 'COMMITTED').length;
  const evidenceChecks = Object.freeze({
    killEngages: engaged.ok === true && engaged.value.after.killSwitchEngaged === true,
    intakePausesAtomically: engaged.ok === true && engaged.value.after.intakePaused === true,
    exactReplayIdempotent: replay.ok === true && engaged.ok === true
      && replay.value.ledgerEventId === engaged.value.ledgerEventId
      && committedCount === 1
      && duplicateCommand?.terminal === 'ALREADY_APPLIED',
    riskIncreaseBlocked: riskIncrease.ok === false && riskIncrease.failure.code === 'KILL_SWITCH_ENGAGED'
      && traceHas(killDuringEntry, 'ADDITIONS_BLOCKED'),
    releaseDoesNotResumeIntake: released.ok === true
      && released.value.after.killSwitchEngaged === false
      && released.value.after.intakePaused === true,
    recoveryRemainsVisible: killDuringEntry?.audit.recoveryVisible === true
      && traceHas(killDuringEntry, 'RECOVERY_REMAINS_AVAILABLE'),
    liveExecutionBarrierRetained: LIVE_EXECUTION_BLOCK_CODE === 'LIVE_EXECUTION_NOT_IMPLEMENTED'
      && ZERO_EFFECT.orderCalls === 0,
  });

  check(assertions, 'KILL_ENGAGES', bindings.killAndPauseAsymmetric && evidenceChecks.killEngages, engaged.ok ? engaged.value.after : engaged.failure.code);
  check(assertions, 'INTAKE_PAUSES_ATOMICALLY', bindings.killAndPauseAsymmetric && evidenceChecks.intakePausesAtomically, engaged.ok ? engaged.value.after.intakePaused : engaged.failure.code);
  check(assertions, 'EXACT_REPLAY_IDEMPOTENT', bindings.exactReplay && evidenceChecks.exactReplayIdempotent, { ledgerEventId: replay.ok ? replay.value.ledgerEventId : null, committedCount, scenarioTerminal: duplicateCommand?.terminal ?? null });
  check(assertions, 'RISK_INCREASE_BLOCKED', bindings.riskIncreaseBlocked && evidenceChecks.riskIncreaseBlocked, riskIncrease.ok ? 'UNEXPECTEDLY_APPLIED' : riskIncrease.failure.code);
  check(assertions, 'RELEASE_DOES_NOT_RESUME_INTAKE', bindings.killAndPauseAsymmetric && evidenceChecks.releaseDoesNotResumeIntake, released.ok ? released.value.after : released.failure.code);
  check(assertions, 'RECOVERY_REMAINS_VISIBLE', evidenceChecks.recoveryRemainsVisible, { audit: killDuringEntry?.audit.recoveryVisible ?? null, trace: traceHas(killDuringEntry, 'RECOVERY_REMAINS_AVAILABLE') });
  check(assertions, 'LIVE_EXECUTION_BARRIER_RETAINED', bindings.liveExecutionBarrier && evidenceChecks.liveExecutionBarrierRetained, LIVE_EXECUTION_BLOCK_CODE);

  return Object.freeze({
    expectedFailureObserved: Object.values(evidenceChecks).every(Boolean),
    runtimeExecutions: definition.runtimeExecutionPlan,
    contractBindings: bindings,
    evidenceChecks,
    engagedState: engaged.ok ? engaged.value.after : null,
    replayLedgerEventId: replay.ok ? replay.value.ledgerEventId : null,
    riskIncreaseFailureCode: riskIncrease.ok ? null : riskIncrease.failure.code,
    releasedState: released.ok ? released.value.after : null,
    controlCommitCount: committedCount,
    controlPublishCount: composition.publishCount(),
    scenarios: scenarios.map((scenario) => scenario.summary),
  });
}

const ADAPTERS = Object.freeze({
  'source-loss': sourceLossAdapter,
  'stale-truth': staleTruthAdapter,
  'restart-during-ambiguity': restartAmbiguityAdapter,
  'watchdog-failure': watchdogFailureAdapter,
  rollback: rollbackAdapter,
  restore: restoreAdapter,
  'reconciliation-failure': reconciliationFailureAdapter,
  'emergency-stop': emergencyStopAdapter,
});

function safeErrorCode(error) {
  if (error instanceof Error && /^[A-Z0-9_:-]{3,128}$/.test(error.message)) return error.message;
  return 'RUNBOOK_PORT_ADAPTER_FAILURE';
}

export async function runDrill(drillId) {
  const definition = drillDefinition(drillId);
  const index = drillDocument().drills.findIndex((candidate) => candidate.id === drillId);
  const injectedAtMs = drillDocument().injectedClockStartMs + (index * 10_000);
  const assertions = [];
  const networkDeny = installNetworkDeny();
  let ownerEvidence = null;
  let errorCode = null;
  try {
    ownerEvidence = await ADAPTERS[drillId](definition, injectedAtMs, assertions);
  } catch (error) {
    errorCode = safeErrorCode(error);
    check(assertions, 'ADAPTER_EXECUTION', false, errorCode);
  } finally {
    networkDeny.restore();
  }

  check(assertions, 'ZERO_EFFECT', networkDeny.attempts() === 0, {
    ...ZERO_EFFECT,
    networkAttempts: networkDeny.attempts(),
  });
  const receipt = buildReceipt({
    definition,
    injectedAtMs,
    assertions,
    ownerEvidence,
    networkAttempts: networkDeny.attempts(),
    errorCode,
  });
  validateReceipt(receipt, definition);
  return receipt;
}

export async function runAllDrills() {
  const receipts = [];
  for (const definition of drillDocument().drills) receipts.push(await runDrill(definition.id));
  return Object.freeze(receipts);
}

export async function verifyPassReceiptAgainstExecution(receipt) {
  if (receipt?.result !== 'PASS') throw new TypeError('RUNBOOK_PORT_PASS_RECEIPT_REQUIRED');
  const reproduced = await runDrill(receipt.drillId);
  if (canonicalJson(reproduced) !== canonicalJson(receipt)) {
    throw new TypeError('RUNBOOK_PORT_RECEIPT_EXECUTION_MISMATCH');
  }
  return true;
}

export function workspaceRoot() {
  return ROOT;
}
