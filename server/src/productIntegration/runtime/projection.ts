import { createHash } from 'node:crypto';
import type { SystemComponentSnapshot } from '../../systemIntegration/contracts/types.js';
import type { SystemTruthLabel } from '../../systemIntegration/contracts/constants.js';
import type { SystemSupervisorReadModel } from '../../systemIntegration/supervisor/types.js';
import type {
  CanonicalOpsIntakeInterlock,
  CanonicalSupervisorOpsReadback,
} from '../../systemIntegration/ops/index.js';
import type { BootReleaseReadback } from '../../systemIntegration/persistence/index.js';
import {
  deriveI00MeaningfulAdvanceEvidence,
  projectI00Health,
} from '../../systemIntegration/application/health.js';
import { buildProductRuntimeControlRegistry } from './controls.js';
import { productTruthLabel } from './events.js';
import { buildProductRuntimeManagedInventory } from './managedInventory.js';
import {
  PRODUCT_RUNTIME_SUPERVISOR_SCHEMA,
  type ProductRuntimeCapability,
  type ProductRuntimeCommandOwnerPort,
  type ProductRuntimeComponentProjection,
  type ProductRuntimeCorrelationTrace,
  type ProductRuntimeDependencyEdge,
  type ProductRuntimeLifecycle,
  type ProductRuntimeMaterialEventPage,
  type ProductRuntimeOwnerView,
  type ProductRuntimeSurfaceDatum,
  type ProductRuntimeSurfaceProjection,
  type ProductRuntimeSupervisorEnvelope,
  type ProductRuntimeTruthLabel,
} from './types.js';

const SURFACE_EVIDENCE = Object.freeze({
  dashboard: ['overall-posture', 'startup', 'revisions', 'mode', 'capital', 'pnl-drawdown', 'pipeline-counts', 'active-objects', 'root-blocker', 'attention', 'strategy-q', 'material-decisions'],
  'control-room': ['machine-graph', 'dependency-edges', 'boot-timeline', 'control-registry', 'revision-conflicts', 'async-progress', 'before-after', 'config-history', 'authority', 'correlation', 'emergency-controls', 'deployment-frozen', 'exposure-state', 'ambiguity-state', 'recovery-state', 'ledger-schema-compatibility', 'ops-interlock'],
  account: ['spot-truth', 'usdm-truth', 'margin-truth', 'balances-equity-collateral', 'available-capital', 'permissions-modes', 'orders-positions', 'liabilities-interest', 'freshness-completeness', 'reconciliation', 'foreign-manual'],
  markets: ['basis', 'wake-up', 'flow', 'liquidity', 'derivatives', 'data-quality', 'candidate-focus', 'source-freshness', 'q-assessment'],
  token: ['first-change', 'evidence-timeline', 'spot-perp-leadership', 'market-context', 'candidate-focus', 'q-model', 'strategy-decisions', 'conflicts-missing', 'ticket-position', 'outcome'],
  basis: ['directional-cases', 'economics', 'gap', 'funding', 'depth-slippage', 'borrow', 'feasibility', 'staging', 'proposal-reject', 'execution-recovery'],
  volume: ['quiet-baseline', 'transition-stage', 'anomaly-follow-through', 'spot-perp-leadership', 'liquidity-crowding', 'analogues-false-positives', 'q-uncertainty', 'proposal-reject', 'position-outcome'],
  opportunities: ['strategy-source-revision', 'evidence-conflict-missing', 'model-assessment', 'net-economics', 'capital-risk-verdict', 'size-staging', 'expiry-invalidation', 'entry-exit-recovery', 'approval', 'rejection'],
  borrow: ['availability-inventory', 'maximum-borrowable', 'rate-interest', 'account-collateral', 'freshness', 'principal-accrual-repay', 'proposal-ticket', 'unsupported'],
  execution: ['ticket-leg-state', 'quantities', 'order-identities', 'ambiguity-reconciliation', 'one-leg-timer', 'exit-capacity', 'funding-borrow', 'controls', 'pnl-attribution'],
  orders: ['ticket-leg-state', 'quantities', 'order-identities', 'ambiguity-reconciliation', 'controls'],
  positions: ['ticket-position-link', 'gross-net-unhedged', 'one-leg-timer', 'exit-capacity', 'recovery'],
  fills: ['fill-identities', 'quantities', 'fees-spread-slippage', 'reconciliation', 'correlation'],
  pnl: ['directional', 'basis-convergence', 'funding', 'borrow-interest', 'fees', 'spread', 'slippage', 'one-leg-exposure', 'execution-recovery-error', 'net-result'],
  risk: ['envelope-revision', 'utilization-reservations', 'gross-net-unhedged', 'concentration', 'loss-drawdown', 'stale-data', 'liquidity-impact', 'ambiguity-recovery', 'gate-decisions', 'halt-posture'],
  health: ['lifecycle-capability', 'heartbeat-advance', 'source-event-processing-age', 'queue-drop-backpressure', 'reconnect-error', 'rest-latency-budget', 'q-latency-queue', 'db-ledger', 'host-runtime', 'backup-release-watchdog', 'root-blocker-action', 'deployment-frozen', 'exposure-state', 'ambiguity-state', 'recovery-state', 'ledger-schema-compatibility', 'ops-interlock'],
  'logs-ledger': ['event-class-severity', 'component-strategy-symbol', 'correlation', 'fingerprint', 'bounded-pagination', 'saved-filters', 'trace', 'redaction', 'retention', 'raw-debug'],
  notifications: ['fingerprint-dedup', 'causal-group', 'root-cause', 'severity-capital', 'first-last-count', 'state', 'owner-action', 'routing', 'correlation', 'silence-ack', 'recovery-proof'],
} as const);

const SURFACE_LABELS: Readonly<Record<keyof typeof SURFACE_EVIDENCE, string>> = Object.freeze({
  dashboard: 'Dashboard', 'control-room': 'Control Room', account: 'Account', markets: 'Markets', token: 'Token',
  basis: 'Basis', volume: 'Volume', opportunities: 'Opportunities', borrow: 'Borrow', execution: 'Execution',
  orders: 'Orders', positions: 'Positions', fills: 'Fills', pnl: 'PnL', risk: 'Risk', health: 'Health',
  'logs-ledger': 'Logs / Ledger', notifications: 'Notifications',
});

function age(nowMs: number, occurredAtMs: number | null): number | null {
  return occurredAtMs === null || occurredAtMs > nowMs ? null : nowMs - occurredAtMs;
}

function componentTruth(component: Readonly<SystemComponentSnapshot>): ProductRuntimeTruthLabel {
  if (component.truthLabel === 'UNAVAILABLE') {
    if (component.releaseStatuses.includes('MISSING')) return 'MISSING';
    if (component.releaseStatuses.includes('NOT_CONFIGURED')) return 'NOT_CONFIGURED';
    return 'UNAVAILABLE';
  }
  return productTruthLabel(component.truthLabel);
}

function capability(component: Readonly<SystemComponentSnapshot>): ProductRuntimeCapability {
  if (component.truthLabel === 'LIVE_PUBLIC') return 'LIVE_PUBLIC';
  if (component.truthLabel === 'DRY_RUN') return 'DRY_RUN';
  if (component.truthLabel === 'SYNTHETIC_ONLY') return 'SYNTHETIC';
  if (component.truthLabel === 'RECORDED_REPLAY') return 'REPLAY';
  if (component.truthLabel === 'UNAVAILABLE') return component.releaseStatuses.includes('NOT_CONFIGURED') ? 'NOT_CONFIGURED' : 'UNAVAILABLE';
  return 'UNKNOWN';
}

function desiredLifecycle(component: Readonly<SystemComponentSnapshot>): ProductRuntimeLifecycle {
  if (component.desiredState === 'STOPPED') return 'STOPPED';
  if (component.desiredState === 'PAUSED') return 'PAUSED';
  return 'READY';
}

function observedLifecycle(component: Readonly<SystemComponentSnapshot>): ProductRuntimeLifecycle {
  if (component.blockerCodes.some((code) => code.includes('RECOVERY_REQUIRED'))) return 'RECOVERY_REQUIRED';
  if (component.phase === 'STOPPED') return 'STOPPED';
  if (component.phase === 'VALIDATING') return 'START_REQUESTED';
  if (component.phase === 'STARTING') return component.readiness === 'WARMING' ? 'WARMING' : 'STARTING';
  if (component.phase === 'RUNNING') return component.readiness === 'READY' ? 'READY' : component.readiness;
  if (component.phase === 'DEGRADED') return 'DEGRADED';
  if (component.phase === 'PAUSING') return 'DRAINING';
  if (component.phase === 'PAUSED') return 'PAUSED';
  if (component.phase === 'STOPPING') return 'STOPPING';
  if (component.phase === 'BLOCKED') return 'BLOCKED';
  return 'FAILED';
}

function controlIds(component: Readonly<SystemComponentSnapshot>): readonly string[] {
  const ids: string[] = [];
  if (component.componentId === 'engine-supervisor') {
    if (component.supportedControls.includes('SET_SAFE_MODE')) ids.push('global.safe-mode.read-only');
    if (component.supportedControls.includes('SET_KILL_SWITCH')) ids.push('global.kill-switch.engage');
    if (component.supportedControls.includes('SET_INTAKE_PAUSED')) ids.push('global.intake.pause');
    if (component.supportedControls.includes('RESTART_COMPONENT')) ids.push('component.engine-supervisor.restart');
  }
  return Object.freeze(ids);
}

function cloneDashboard(snapshot: Readonly<SystemSupervisorReadModel>): Readonly<SystemSupervisorReadModel> {
  const clone = JSON.parse(JSON.stringify(snapshot)) as SystemSupervisorReadModel;
  return Object.freeze(clone);
}

function components(
  snapshot: Readonly<SystemSupervisorReadModel>,
  nowMs: number,
): readonly Readonly<ProductRuntimeComponentProjection>[] {
  const meaningfulAdvance = deriveI00MeaningfulAdvanceEvidence(snapshot);
  return Object.freeze(snapshot.components.map((component) => {
    const root = snapshot.rootCauses.find((candidate) => candidate.componentId === component.componentId
      || candidate.affectedComponentIds.includes(component.componentId));
    const recent = snapshot.recentCorrelatedDecisions.find((event) => event.componentId === component.componentId);
    const recovery = component.componentId === 'reconciliation' && snapshot.summaries.reconciliation.blocksNewExposure;
    return Object.freeze({
      componentId: component.componentId,
      owner: `${component.owner}:${component.ownerPath}`,
      desiredLifecycle: desiredLifecycle(component),
      observedLifecycle: recovery ? 'RECOVERY_REQUIRED' : observedLifecycle(component),
      capability: capability(component),
      heartbeatAtMs: component.lastSuccessAtMs,
      lastAdvanceAtMs: component.componentId === meaningfulAdvance?.ownerComponentId
        ? meaningfulAdvance.observedAtMs
        : null,
      sourceAgeMs: component.freshness?.ageMs ?? age(nowMs, component.sourceTimestamp?.sourceTimeMs ?? null),
      eventAgeMs: age(nowMs, component.lastReceiveAtMs),
      processingAgeMs: age(nowMs, component.lastProcessAtMs),
      queueDepth: component.queue?.depth ?? null,
      queueCapacity: component.queue?.capacity ?? null,
      droppedCount: component.queue?.dropped ?? null,
      blockerCode: component.blockerCodes[0] ?? component.lastFailure?.code ?? null,
      rootCauseComponentId: root?.componentId ?? null,
      capitalRelevance: component.capitalExposed ? 'EXPOSED' : recovery ? 'RECOVERY'
        : ['capital-supervision', 'multileg-risk', 'execution-coordinator-validate-only'].includes(component.componentId) ? 'POTENTIAL' : 'NONE',
      supportedControlIds: controlIds(component),
      correlationId: recent?.correlationId ?? null,
      truthLabel: componentTruth(component),
    } satisfies ProductRuntimeComponentProjection);
  }));
}

function edges(snapshot: Readonly<SystemSupervisorReadModel>): readonly Readonly<ProductRuntimeDependencyEdge>[] {
  return Object.freeze(snapshot.edges.map((edge) => Object.freeze({
    fromComponentId: edge.from,
    toComponentId: edge.to,
    required: edge.required,
    state: edge.state,
    rootCauseComponentId: edge.rootBlockerComponentId,
    reasonCodes: Object.freeze([...edge.reasonCodes]),
  })));
}

function freshness(snapshot: Readonly<SystemSupervisorReadModel>): string | null {
  const sources = snapshot.components.filter((component) => component.componentId === 'public-spot-source' || component.componentId === 'public-usdm-source');
  if (sources.length !== 2 || new Set(sources.map((component) => component.componentId)).size !== 2) return null;
  if (sources.some((component) => component.freshness?.ageMs === null || component.freshness === null)) return null;
  return `${Math.max(...sources.map((component) => component.freshness!.ageMs!))}ms max public-source age`;
}

const FULL_GIT_SHA = /^[0-9a-f]{40}$/;
const RELEASE_REVISION = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const UNRESOLVED_RELEASE_REVISION = /REPLACE_ME|CHANGEME|example\.com|000000000000|^(?:UNKNOWN|UNAVAILABLE|NOT_CONFIGURED)$/i;

function validReleaseRevision(value: string | null): string | null {
  return value !== null
    && RELEASE_REVISION.test(value)
    && !UNRESOLVED_RELEASE_REVISION.test(value)
    ? value
    : null;
}

function releaseRevisions(
  readback: Readonly<BootReleaseReadback> | null | undefined,
): Readonly<Pick<ProductRuntimeOwnerView['revisions'],
  'testedCommit' | 'deployedCommit' | 'configRevision' | 'modelRevision'>> {
  const latest = readback?.source === 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE'
    && readback.state === 'AVAILABLE'
    ? readback.latest
    : null;
  const testedCommit = latest?.lifecycleState === 'ACTIVE'
    && latest.identityState !== 'UNKNOWN'
    && latest.deploymentMutationAuthority === 'NONE'
    && FULL_GIT_SHA.test(latest.testedCommit ?? '')
    && validReleaseRevision(latest.schemaRevision) !== null
    ? latest.testedCommit
    : null;
  if (testedCommit === null) {
    return Object.freeze({
      testedCommit: null,
      deployedCommit: null,
      configRevision: null,
      modelRevision: null,
    });
  }
  return Object.freeze({
    testedCommit,
    // A tested commit never becomes a deployed claim by fallback.
    deployedCommit: FULL_GIT_SHA.test(latest!.deployedCommit ?? '')
      ? latest!.deployedCommit
      : null,
    configRevision: validReleaseRevision(latest!.configRevision),
    modelRevision: validReleaseRevision(latest!.modelRevision),
  });
}

function ownerView(
  snapshot: Readonly<SystemSupervisorReadModel>,
  materialEvents: Readonly<ProductRuntimeMaterialEventPage>,
  applicationStartOk: boolean,
  applicationStartFailureCodes: readonly string[],
  bootReleaseReadback?: Readonly<BootReleaseReadback> | null,
): Readonly<ProductRuntimeOwnerView> {
  const recovery = snapshot.summaries.execution.recoveryState
    ?? (snapshot.summaries.reconciliation.blocksNewExposure
      ? `${snapshot.summaries.reconciliation.truthLabel}:${snapshot.summaries.reconciliation.status}`
      : null);
  const atHighWater = materialEvents.continuity === 'PROVEN'
    && !materialEvents.hasMore
    && materialEvents.nextCursor === materialEvents.highWaterCursor;
  const latest = atHighWater ? materialEvents.items.at(-1) : undefined;
  const supervisorPostureReady = snapshot.overallPosture === 'READY';
  const meaningfulAdvance = deriveI00MeaningfulAdvanceEvidence(snapshot);
  const readiness = projectI00Health(
    'READY',
    snapshot,
    applicationStartOk,
    meaningfulAdvance,
    applicationStartFailureCodes,
  );
  const machineReady: ProductRuntimeOwnerView['machineReady'] = readiness.ok
    ? 'YES'
    : supervisorPostureReady ? 'UNKNOWN' : 'NO';
  const revisions = releaseRevisions(bootReleaseReadback);
  return Object.freeze({
    // A successfully evaluated authenticated Product read proves this process
    // answered. Whole-machine readiness remains the canonical health contract.
    processAlive: 'YES',
    machineReady,
    tradeReady: 'NO',
    desiredMode: snapshot.control.safeMode,
    effectiveMode: snapshot.control.killSwitchEngaged ? 'BLOCKED' : snapshot.control.safeMode,
    exposedCapital: snapshot.summaries.capital.activeExposureAmount,
    unresolvedRecovery: recovery,
    dataFreshness: freshness(snapshot),
    topRootBlocker: snapshot.firstRootBlockerComponentId
      ?? (machineReady === 'UNKNOWN'
        ? readiness.reasonCodes[0] ?? 'CANONICAL_READINESS_NOT_PROVEN'
        : machineReady === 'YES'
          ? null
        : `CANONICAL_SUPERVISOR_${snapshot.overallPosture}`),
    activeOpportunity: null,
    activeTicket: null,
    activePosition: null,
    latestMaterialChange: latest ? `${latest.kind}:${latest.eventId}` : null,
    revisions: Object.freeze({
      testedCommit: revisions.testedCommit,
      deployedCommit: revisions.deployedCommit,
      modelRevision: revisions.modelRevision,
      configRevision: revisions.configRevision,
      // This is the Product envelope contract revision. Ledger schema truth
      // remains separately owned by the canonical ops readback.
      schemaRevision: PRODUCT_RUNTIME_SUPERVISOR_SCHEMA,
    }),
  });
}

function accountTruth(snapshot: Readonly<SystemSupervisorReadModel>): ProductRuntimeTruthLabel {
  const state = snapshot.summaries.capital.accountTruthState.trim().toUpperCase();
  if (state.includes('SYNTHETIC')) return 'SYNTHETIC_ONLY';
  if (state.includes('NOT_CONFIGURED')) return 'NOT_CONFIGURED';
  if (state.includes('UNAVAILABLE')) return 'UNAVAILABLE';
  if (state.includes('UNKNOWN')) return 'UNKNOWN';
  // Account truth is a separate owner fact. An unrecognized future state must
  // be integrated explicitly; inheriting Capital's dry-run label would make an
  // unknown private/account configuration look binding-ready.
  return 'UNKNOWN';
}

function weakestSurfaceTruth(labels: readonly ProductRuntimeTruthLabel[]): ProductRuntimeTruthLabel {
  for (const candidate of ['UNKNOWN', 'MISSING', 'UNAVAILABLE', 'NOT_CONFIGURED', 'BLOCKED', 'SYNTHETIC_ONLY', 'BUILT_AND_TESTED', 'IMPORTED', 'WIRED', 'LIVE_PUBLIC'] as const) {
    if (labels.includes(candidate)) return candidate;
  }
  return 'UNKNOWN';
}

function surfaceTruth(surfaceId: keyof typeof SURFACE_EVIDENCE, snapshot: Readonly<SystemSupervisorReadModel>): ProductRuntimeTruthLabel {
  const map = (truth: SystemTruthLabel) => productTruthLabel(truth);
  if (surfaceId === 'basis') return map(snapshot.summaries.strategies.basis.truthLabel);
  if (surfaceId === 'volume') return map(snapshot.summaries.strategies.volume.truthLabel);
  if (surfaceId === 'risk') return map(snapshot.summaries.risk.truthLabel);
  if (surfaceId === 'account' || surfaceId === 'borrow') return accountTruth(snapshot);
  if (surfaceId === 'notifications') return 'NOT_CONFIGURED';
  if (['execution', 'orders', 'positions', 'fills', 'pnl'].includes(surfaceId)) {
    return weakestSurfaceTruth([
      map(snapshot.summaries.capital.truthLabel),
      map(snapshot.summaries.execution.truthLabel),
      map(snapshot.summaries.reconciliation.truthLabel),
    ]);
  }
  return productTruthLabel(snapshot.truthLabel);
}

const OPS_SURFACE_FIELDS = new Set([
  'deployment-frozen',
  'exposure-state',
  'ambiguity-state',
  'recovery-state',
  'ledger-schema-compatibility',
  'ops-interlock',
]);

function opsInterlockTruth(interlock: Readonly<CanonicalOpsIntakeInterlock>): ProductRuntimeTruthLabel {
  if (!interlock.blocksNewEntries) return 'WIRED';
  return interlock.reasonCodes.some((code) => (
    code.includes('UNKNOWN')
    || code.includes('INVALID')
    || code.includes('NOT_CURRENT')
    || code.includes('UNAVAILABLE')
  )) ? 'UNKNOWN' : 'BLOCKED';
}

function opsDatum(
  fieldId: string,
  readback: Readonly<CanonicalSupervisorOpsReadback>,
  interlock: Readonly<CanonicalOpsIntakeInterlock>,
): Readonly<Pick<ProductRuntimeSurfaceDatum, 'value' | 'truthLabel' | 'canonicalSource' | 'unavailableReason'>> | null {
  if (!OPS_SURFACE_FIELDS.has(fieldId)) return null;
  let value: string | null;
  let truthLabel: ProductRuntimeTruthLabel;
  let unavailableReason: string | null = null;
  if (fieldId === 'deployment-frozen') {
    value = readback.deploymentFrozen === true ? 'FROZEN'
      : readback.deploymentFrozen === false ? 'NOT_FROZEN' : 'UNKNOWN_FROZEN';
    truthLabel = readback.deploymentFrozen === true ? 'BLOCKED'
      : readback.deploymentFrozen === false ? 'WIRED' : 'UNKNOWN';
    unavailableReason = readback.deploymentFrozen === 'UNKNOWN' ? 'DEPLOYMENT_FREEZE_STATE_UNKNOWN'
      : readback.deploymentFrozen ? 'DEPLOYMENT_FROZEN' : null;
  } else if (fieldId === 'exposure-state') {
    value = readback.exposureState;
    truthLabel = readback.exposureState === 'NONE' ? 'WIRED'
      : readback.exposureState === 'UNKNOWN' ? 'UNKNOWN' : 'BLOCKED';
    unavailableReason = readback.exposureState === 'NONE' ? null : `EXPOSURE_${readback.exposureState}`;
  } else if (fieldId === 'ambiguity-state') {
    value = readback.ambiguityState;
    truthLabel = readback.ambiguityState === 'NONE' ? 'WIRED'
      : readback.ambiguityState === 'UNKNOWN' ? 'UNKNOWN' : 'BLOCKED';
    unavailableReason = readback.ambiguityState === 'NONE' ? null : `AMBIGUITY_${readback.ambiguityState}`;
  } else if (fieldId === 'recovery-state') {
    value = readback.recoveryState;
    truthLabel = readback.recoveryState === 'NONE' ? 'WIRED'
      : readback.recoveryState === 'UNKNOWN' ? 'UNKNOWN' : 'BLOCKED';
    unavailableReason = readback.recoveryState === 'NONE' ? null : `RECOVERY_${readback.recoveryState}`;
  } else if (fieldId === 'ledger-schema-compatibility') {
    const available = readback.currentSchemaVersion !== null && readback.rollbackFloor !== null;
    value = available
      ? `CURRENT ${readback.currentSchemaVersion} · ROLLBACK FLOOR ${readback.rollbackFloor}`
      : null;
    truthLabel = available ? 'WIRED' : 'UNKNOWN';
    unavailableReason = available ? null : 'LEDGER_SCHEMA_COMPATIBILITY_UNKNOWN';
  } else {
    value = interlock.state;
    truthLabel = opsInterlockTruth(interlock);
    unavailableReason = interlock.reasonCodes[0] ?? null;
  }
  return Object.freeze({
    value,
    truthLabel,
    canonicalSource: `canonicalSupervisorOpsReadback:${fieldId}`,
    unavailableReason,
  });
}

function surfaces(
  snapshot: Readonly<SystemSupervisorReadModel>,
  dashboard: Readonly<SystemSupervisorReadModel>,
  view: Readonly<ProductRuntimeOwnerView>,
  materialEvents: Readonly<ProductRuntimeMaterialEventPage>,
  controlCount: number,
  opsReadback: Readonly<CanonicalSupervisorOpsReadback>,
  opsIntakeInterlock: Readonly<CanonicalOpsIntakeInterlock>,
): Readonly<Record<string, Readonly<ProductRuntimeSurfaceProjection>>> {
  const known: Readonly<Record<string, string | null>> = Object.freeze({
    'overall-posture': dashboard.overallPosture,
    startup: `${snapshot.phase} · runtime generation ${snapshot.runtimeGeneration}`,
    revisions: `system ${snapshot.revision} · control ${snapshot.control.revision}`,
    mode: `${snapshot.control.safeMode}${snapshot.control.killSwitchEngaged ? ' · KILL_ENGAGED' : ''}`,
    capital: snapshot.summaries.capital.activeExposureAmount,
    'root-blocker': view.topRootBlocker,
    attention: String(snapshot.attentionQueue.length),
    'material-decisions': view.latestMaterialChange,
    'machine-graph': `${snapshot.components.length} canonical System Integration components`,
    'dependency-edges': `${snapshot.edges.length} canonical dependency edges`,
    'control-registry': `${controlCount} bounded non-money controls`,
    authority: 'System Integration read projection; canonical domain owners remain authoritative',
    correlation: snapshot.control.correlationId,
    'emergency-controls': 'READ_ONLY · KILL ENGAGE · INTAKE PAUSE',
    'source-freshness': view.dataFreshness,
    'freshness-completeness': view.dataFreshness,
    reconciliation: snapshot.summaries.reconciliation.status,
    'halt-posture': snapshot.control.killSwitchEngaged ? 'ENGAGED' : 'CLEAR',
    'lifecycle-capability': `${snapshot.components.length} owner projections`,
    'heartbeat-advance': (() => {
      const advance = deriveI00MeaningfulAdvanceEvidence(snapshot);
      return advance ? `${advance.ownerComponentId} · ${advance.observedAtMs}` : null;
    })(),
    'source-event-processing-age': view.dataFreshness,
    'db-ledger': snapshot.summaries.ledger.writable === null ? null : snapshot.summaries.ledger.writable ? 'WRITABLE' : 'NOT_WRITABLE',
    'root-blocker-action': view.topRootBlocker,
    'bounded-pagination': `cursor page · max 500 · continuity ${materialEvents.continuity}`,
    retention: materialEvents.truncated ? 'TRUNCATED_REQUIRES_BACKFILL' : materialEvents.continuity,
  });
  const result: Record<string, Readonly<ProductRuntimeSurfaceProjection>> = {};
  for (const surfaceId of Object.keys(SURFACE_EVIDENCE) as (keyof typeof SURFACE_EVIDENCE)[]) {
    const baseTruthLabel = surfaceTruth(surfaceId, snapshot);
    const truthLabel = (surfaceId === 'control-room' || surfaceId === 'health')
      ? weakestSurfaceTruth([baseTruthLabel, opsInterlockTruth(opsIntakeInterlock)])
      : baseTruthLabel;
    const blocked = truthLabel === 'MISSING' || truthLabel === 'NOT_CONFIGURED'
      || truthLabel === 'UNAVAILABLE' || truthLabel === 'UNKNOWN';
    const blockedSummary = truthLabel === 'UNKNOWN'
      ? `${SURFACE_LABELS[surfaceId]} owner evidence is unknown.`
      : truthLabel === 'MISSING'
        ? `${SURFACE_LABELS[surfaceId]} owner evidence is missing.`
        : truthLabel === 'UNAVAILABLE'
          ? `${SURFACE_LABELS[surfaceId]} owner evidence is unavailable.`
          : `${SURFACE_LABELS[surfaceId]} owner evidence is not configured.`;
    const blockedCode = truthLabel === 'UNKNOWN'
      ? 'CANONICAL_OWNER_UNKNOWN'
      : truthLabel === 'MISSING'
        ? 'CANONICAL_OWNER_MISSING'
        : truthLabel === 'UNAVAILABLE'
          ? 'CANONICAL_OWNER_UNAVAILABLE'
          : 'CANONICAL_OWNER_NOT_CONFIGURED';
    const evidence = SURFACE_EVIDENCE[surfaceId].map((fieldId) => {
      const canonicalOpsDatum = opsDatum(fieldId, opsReadback, opsIntakeInterlock);
      if (canonicalOpsDatum) {
        return Object.freeze({
          fieldId,
          label: fieldId.replaceAll('-', ' '),
          ...canonicalOpsDatum,
        } satisfies ProductRuntimeSurfaceDatum);
      }
      const value = Object.prototype.hasOwnProperty.call(known, fieldId) ? known[fieldId]! : null;
      const meaningfulAdvanceUnknown = fieldId === 'heartbeat-advance' && value === null;
      return Object.freeze({
        fieldId,
        label: fieldId.replaceAll('-', ' '),
        value,
        truthLabel: meaningfulAdvanceUnknown ? 'UNKNOWN' : value === null ? 'MISSING' : truthLabel,
        canonicalSource: `systemIntegration:${surfaceId}:${fieldId}`,
        unavailableReason: meaningfulAdvanceUnknown
          ? 'CANONICAL_MEANINGFUL_ADVANCE_NOT_PUBLISHED'
          : value === null ? 'CANONICAL_OWNER_FIELD_NOT_CONFIGURED' : null,
      } satisfies ProductRuntimeSurfaceDatum);
    });
    result[surfaceId] = Object.freeze({
      surfaceId,
      label: SURFACE_LABELS[surfaceId],
      bindingState: blocked ? 'BLOCKED_BACKEND' : 'BINDING_READY',
      truthLabel,
      canonicalSource: `systemIntegration supervisor:${surfaceId}`,
      evaluatedAtMs: snapshot.evaluatedAtMs,
      summary: blocked ? blockedSummary : `${SURFACE_LABELS[surfaceId]} projects canonical owner evidence only.`,
      blocker: blocked ? blockedCode : view.topRootBlocker,
      controlIds: Object.freeze(surfaceId === 'control-room' || surfaceId === 'health'
        ? ['component.engine-supervisor.restart']
        : surfaceId === 'dashboard' || surfaceId === 'risk'
          ? ['global.safe-mode.read-only', 'global.kill-switch.engage', 'global.intake.pause']
          : []),
      correlationId: snapshot.control.correlationId,
      evidence: Object.freeze(evidence),
    });
  }
  return Object.freeze(result);
}

function hasSyntheticEvidence(input: Readonly<{
  snapshot: Readonly<SystemSupervisorReadModel>;
  materialEvents: Readonly<ProductRuntimeMaterialEventPage>;
  traces: readonly Readonly<ProductRuntimeCorrelationTrace>[];
}>): boolean {
  const summaries = input.snapshot.summaries;
  const systemLabels: SystemTruthLabel[] = [
    input.snapshot.truthLabel,
    ...input.snapshot.components.map((component) => component.truthLabel),
    summaries.sourceCoverage.truthLabel,
    summaries.strategies.basis.truthLabel,
    summaries.strategies.volume.truthLabel,
    summaries.intelligence.truthLabel,
    summaries.capital.truthLabel,
    summaries.risk.truthLabel,
    summaries.execution.truthLabel,
    summaries.reconciliation.truthLabel,
    summaries.ledger.truthLabel,
    ...input.snapshot.recentCorrelatedDecisions.map((event) => event.truthLabel),
    ...input.snapshot.traceIndex.entries.flatMap((entry) => [
      ...entry.truthLabels,
      ...entry.snapshot.events.map((event) => event.truthLabel),
    ]),
  ];
  return systemLabels.includes('SYNTHETIC_ONLY')
    || accountTruth(input.snapshot) === 'SYNTHETIC_ONLY'
    || input.materialEvents.items.some((event) => event.truthLabel === 'SYNTHETIC_ONLY')
    || input.traces.some((trace) => trace.stages.some((stage) => stage.truthLabel === 'SYNTHETIC_ONLY'));
}

export function buildProductRuntimeSupervisorEnvelope(input: Readonly<{
  applicationStartOk: boolean;
  applicationStartFailureCodes?: readonly string[];
  snapshot: Readonly<SystemSupervisorReadModel>;
  opsReadback: Readonly<CanonicalSupervisorOpsReadback>;
  opsIntakeInterlock: Readonly<CanonicalOpsIntakeInterlock>;
  bootReleaseReadback?: Readonly<BootReleaseReadback> | null;
  materialEvents: Readonly<ProductRuntimeMaterialEventPage>;
  traces: readonly Readonly<ProductRuntimeCorrelationTrace>[];
  nowMs: number;
  commandOwner?: Readonly<ProductRuntimeCommandOwnerPort>;
}>): Readonly<ProductRuntimeSupervisorEnvelope> {
  if (!Number.isFinite(input.nowMs)) throw new TypeError('nowMs must be injected finite UTC milliseconds');
  if (typeof input.applicationStartOk !== 'boolean') throw new TypeError('applicationStartOk must be an injected boolean');
  const dashboard = cloneDashboard(input.snapshot);
  const projectedComponents = components(input.snapshot, input.nowMs);
  const managedInventory = buildProductRuntimeManagedInventory(projectedComponents);
  const projectedEdges = edges(input.snapshot);
  const controls = buildProductRuntimeControlRegistry(input.snapshot, input.commandOwner);
  const view = ownerView(
    input.snapshot,
    input.materialEvents,
    input.applicationStartOk,
    input.applicationStartFailureCodes ?? Object.freeze([]),
    input.bootReleaseReadback,
  );
  const projectedSurfaces = surfaces(
    input.snapshot,
    dashboard,
    view,
    input.materialEvents,
    controls.length,
    input.opsReadback,
    input.opsIntakeInterlock,
  );
  const revision = `system-${input.snapshot.revision}-runtime-${input.snapshot.runtimeGeneration}-control-${input.snapshot.controlGeneration}`;
  const body = {
    schemaVersion: PRODUCT_RUNTIME_SUPERVISOR_SCHEMA,
    revision,
    evaluatedAtMs: input.nowMs,
    truthLabel: productTruthLabel(input.snapshot.truthLabel),
    persistentSyntheticLabel: hasSyntheticEvidence(input),
    opsReadback: Object.freeze({ ...input.opsReadback }),
    opsIntakeInterlock: Object.freeze({
      ...input.opsIntakeInterlock,
      reasonCodes: Object.freeze([...input.opsIntakeInterlock.reasonCodes]),
    }),
    ownerView: view,
    dashboard,
    components: projectedComponents,
    managedInventory,
    dependencyEdges: projectedEdges,
    controls,
    traces: Object.freeze([...input.traces]),
    incidentAvailability: Object.freeze({
      state: 'NOT_CONFIGURED' as const,
      truthLabel: 'NOT_CONFIGURED' as const,
      blocker: 'INCIDENT_OWNER_NOT_CONFIGURED',
    }),
    incidents: Object.freeze([]),
    materialEvents: input.materialEvents,
    surfaces: projectedSurfaces,
  } as const;
  const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return Object.freeze({ ...body, digest: `sha256:${digest}` });
}
