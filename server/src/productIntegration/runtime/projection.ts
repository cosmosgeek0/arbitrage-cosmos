import { createHash } from 'node:crypto';
import type { SystemComponentSnapshot } from '../../systemIntegration/contracts/types.js';
import type { SystemTruthLabel } from '../../systemIntegration/contracts/constants.js';
import type {
  SystemReadinessPolicyProjection,
  SystemServiceReadinessDisposition,
  SystemSupervisorReadModel,
} from '../../systemIntegration/supervisor/types.js';
import type {
  CanonicalOpsIntakeInterlock,
  CanonicalSupervisorOpsReadback,
} from '../../systemIntegration/ops/index.js';
import type { BootReleaseReadback } from '../../systemIntegration/persistence/index.js';
import {
  deriveI00MeaningfulAdvanceEvidence,
  projectI00Health,
} from '../../systemIntegration/application/health.js';
import {
  buildProductRuntimeControlRegistry,
  productIncidentAcknowledgementControlId,
} from './controls.js';
import { productTruthLabel } from './events.js';
import { buildProductRuntimeManagedInventory } from './managedInventory.js';
import {
  PRODUCT_RUNTIME_OWNER_TRUTH_AVAILABLE_LABELS,
  PRODUCT_RUNTIME_OWNER_TRUTH_FIELDS,
  PRODUCT_RUNTIME_OWNER_TRUTH_SCHEMA,
  PRODUCT_RUNTIME_OWNER_TRUTH_SURFACE_IDS,
  PRODUCT_RUNTIME_OWNER_TRUTH_UNAVAILABLE_LABELS,
  PRODUCT_RUNTIME_SUPERVISOR_SCHEMA,
  type ProductRuntimeCapability,
  type ProductRuntimeBootReleaseIdentityIssue,
  type ProductRuntimeBootReleaseReadback,
  type ProductRuntimeBootReleaseRecord,
  type ProductRuntimeCanonicalCockpitTruth,
  type ProductRuntimeCommandOwnerPort,
  type ProductRuntimeComponentPresentation,
  type ProductRuntimeComponentProjection,
  type ProductRuntimeCorrelationTrace,
  type ProductRuntimeDependencyEdge,
  type ProductRuntimeLifecycle,
  type ProductRuntimeIncidentProjection,
  type ProductRuntimeIncidentSnapshot,
  type ProductRuntimeMaterialEventPage,
  type ProductRuntimeOwnerTruthBinding,
  type ProductRuntimeOwnerTruthCut,
  type ProductRuntimeOwnerTruthDatum,
  type ProductRuntimeOwnerTruthSurfaceBinding,
  type ProductRuntimeOwnerTruthSurfaceId,
  type ProductRuntimeOwnerTruthUnavailableReason,
  type ProductRuntimeOwnerView,
  type ProductRuntimeServiceReadinessDisposition,
  type ProductRuntimeServiceReadinessPolicy,
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
  borrow: ['mode-eligibility', 'borrow-eligibility', 'maximum-borrowable', 'borrow-limit', 'hourly-borrow-rate', 'current-borrowed', 'accrued-interest', 'collateral-amount', 'collateral-asset', 'current-ltv', 'liability-source-freshness', 'collateral-source-freshness', 'blocker'],
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

/**
 * Fields that must retain a row but may remain unknown without downgrading the
 * owning surface. ENGINE section 11 makes collateral/LTV conditional on an
 * exact same-margin owner, unlike the required borrow-preflight evidence.
 */
const OPTIONAL_SURFACE_EVIDENCE: Readonly<Partial<Record<keyof typeof SURFACE_EVIDENCE, readonly string[]>>> = Object.freeze({
  borrow: Object.freeze([
    'collateral-amount',
    'collateral-asset',
    'current-ltv',
    'collateral-source-freshness',
  ]),
});

const SURFACE_LABELS: Readonly<Record<keyof typeof SURFACE_EVIDENCE, string>> = Object.freeze({
  dashboard: 'Dashboard', 'control-room': 'Control Room', account: 'Account', markets: 'Markets', token: 'Token',
  basis: 'Basis', volume: 'Volume', opportunities: 'Opportunities', borrow: 'Borrow', execution: 'Execution',
  orders: 'Orders', positions: 'Positions', fills: 'Fills', pnl: 'PnL', risk: 'Risk', health: 'Health',
  'logs-ledger': 'Logs / Ledger', notifications: 'Notifications',
});

function age(nowMs: number, occurredAtMs: number | null): number | null {
  return occurredAtMs === null || occurredAtMs > nowMs ? null : nowMs - occurredAtMs;
}

function serviceReadinessDisposition(
  disposition: Readonly<SystemServiceReadinessDisposition>,
): Readonly<ProductRuntimeServiceReadinessDisposition> {
  if (typeof disposition !== 'object' || disposition === null) {
    throw new TypeError('canonical component service-readiness disposition is missing');
  }
  return Object.freeze({
    basis: disposition.basis,
    expected: disposition.expected,
    observed: disposition.observed,
    requiredForServiceReadiness: disposition.requiredForServiceReadiness,
    excludedFromServiceReadiness: disposition.excludedFromServiceReadiness,
    waiver: disposition.waiver === null
      ? null
      : Object.freeze({ ...disposition.waiver }),
  });
}

function serviceReadinessPolicy(
  policy: Readonly<SystemReadinessPolicyProjection>,
): Readonly<ProductRuntimeServiceReadinessPolicy> {
  if (typeof policy !== 'object' || policy === null) {
    throw new TypeError('canonical service-readiness policy is missing');
  }
  return Object.freeze({
    status: policy.status,
    accepted: policy.accepted,
    reasonCode: policy.reasonCode,
    waiver: policy.waiver === null
      ? null
      : Object.freeze({ ...policy.waiver }),
  });
}

function componentTruth(component: Readonly<SystemComponentSnapshot>): ProductRuntimeTruthLabel {
  if (component.truthLabel === 'UNAVAILABLE') {
    // Q's signed readiness semantics separate availability truth from
    // configuration capability: truth remains UNAVAILABLE while capability
    // carries NOT_CONFIGURED.
    if (component.componentId === 'q-inference') return 'UNAVAILABLE';
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

function capabilityLabel(value: ProductRuntimeCapability): string {
  if (value === 'LIVE_PUBLIC') return 'Live Public';
  if (value === 'LIVE_PRIVATE_READ') return 'Private Read';
  if (value === 'LIVE_SIGNED_VALIDATE') return 'Signed Validate';
  if (value === 'LIVE_MANUAL_CAPPED') return 'Manual Capped';
  if (value === 'DRY_RUN') return 'Validate Only';
  if (value === 'SHADOW') return 'Shadow';
  if (value === 'REPLAY') return 'Replay';
  if (value === 'SYNTHETIC') return 'Synthetic';
  if (value === 'NOT_CONFIGURED') return 'Not Configured';
  if (value === 'UNAVAILABLE') return 'Unavailable';
  return 'Unknown';
}

function canonicalComponentPresentation(input: Readonly<{
  observedLifecycle: ProductRuntimeLifecycle;
  capability: ProductRuntimeCapability;
  truthLabel: ProductRuntimeTruthLabel;
}>): Readonly<ProductRuntimeComponentPresentation> {
  const stateLabel = `${input.observedLifecycle.replaceAll('_', ' ')} · ${capabilityLabel(input.capability).toUpperCase()} · ${input.truthLabel.replaceAll('_', ' ')}`;
  if (input.capability === 'NOT_CONFIGURED' || input.truthLabel === 'NOT_CONFIGURED') {
    return Object.freeze({ status: 'planned', tone: 'warn', statusLabel: 'Not Configured', stateLabel });
  }
  if (['FAILED', 'BLOCKED', 'RECOVERY_REQUIRED'].includes(input.observedLifecycle)
    || ['BLOCKED', 'UNAVAILABLE', 'MISSING', 'UNKNOWN'].includes(input.truthLabel)
    || ['UNAVAILABLE', 'UNKNOWN'].includes(input.capability)) {
    return Object.freeze({ status: 'outage', tone: 'bad', statusLabel: 'Unavailable', stateLabel });
  }
  if (input.observedLifecycle === 'READY'
    && input.capability === 'LIVE_PUBLIC'
    && input.truthLabel === 'LIVE_PUBLIC') {
    return Object.freeze({ status: 'operational', tone: 'ok', statusLabel: 'Live Public', stateLabel });
  }
  return Object.freeze({
    status: 'degraded',
    tone: 'warn',
    statusLabel: capabilityLabel(input.capability),
    stateLabel,
  });
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
  if (component.componentId === 'basis-engine'
      && component.supportedControls.includes('SET_BASIS_INTAKE')) {
    ids.push('strategy.basis.intake');
  }
  if (component.componentId === 'volume-engine'
      && component.supportedControls.includes('SET_VOLUME_INTAKE')) {
    ids.push('strategy.volume.intake');
  }
  return Object.freeze(ids);
}

function restartState(
  component: Readonly<SystemComponentSnapshot>,
): ProductRuntimeComponentProjection['restartState'] {
  const explicitlyRequired = component.blockerCodes.some((code) => (
    code === 'RESTART_REQUIRED' || code.endsWith('_RESTART_REQUIRED')
  ));
  if (explicitlyRequired) return 'RESTART_REQUIRED';
  if (component.restartCount > 0) {
    if (component.generation === 0) throw new TypeError('restart count requires a nonzero runtime generation');
    return 'RESTARTED';
  }
  if (component.generation > 0) return 'NEVER_RESTARTED';
  return 'UNKNOWN';
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
    const projectedObservedLifecycle = recovery ? 'RECOVERY_REQUIRED' : observedLifecycle(component);
    const projectedCapability = capability(component);
    const projectedTruthLabel = componentTruth(component);
    const restart = restartState(component);
    const restartBlocker = component.blockerCodes.find((code) => (
      code === 'RESTART_REQUIRED' || code.endsWith('_RESTART_REQUIRED')
    ));
    return Object.freeze({
      componentId: component.componentId,
      owner: `${component.owner}:${component.ownerPath}`,
      desiredLifecycle: desiredLifecycle(component),
      observedLifecycle: projectedObservedLifecycle,
      capability: projectedCapability,
      heartbeatAtMs: component.lastSuccessAtMs,
      lastAdvanceAtMs: component.componentId === meaningfulAdvance?.ownerComponentId
        ? meaningfulAdvance.observedAtMs
        : null,
      freshnessState: component.freshness?.state ?? 'UNAVAILABLE',
      sourceAgeMs: component.freshness?.ageMs ?? age(nowMs, component.sourceTimestamp?.sourceTimeMs ?? null),
      eventAgeMs: age(nowMs, component.lastReceiveAtMs),
      processingAgeMs: age(nowMs, component.lastProcessAtMs),
      processingLagMs: component.processingLagMs ?? null,
      queueDepth: component.queue?.depth ?? null,
      queueCapacity: component.queue?.capacity ?? null,
      droppedCount: component.queue?.dropped ?? null,
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
      restartState: restart,
      generation: component.generation,
      restartCount: component.restartCount,
      blockerCode: restartBlocker ?? component.blockerCodes[0] ?? component.lastFailure?.code ?? null,
      rootCauseComponentId: root?.componentId ?? null,
      capitalRelevance: component.capitalExposed ? 'EXPOSED' : recovery ? 'RECOVERY'
        : ['capital-supervision', 'multileg-risk', 'execution-coordinator-validate-only'].includes(component.componentId) ? 'POTENTIAL' : 'NONE',
      supportedControlIds: controlIds(component),
      correlationId: recent?.correlationId ?? null,
      truthLabel: projectedTruthLabel,
      serviceReadiness: serviceReadinessDisposition(component.serviceReadiness),
      canonicalPresentation: canonicalComponentPresentation({
        observedLifecycle: projectedObservedLifecycle,
        capability: projectedCapability,
        truthLabel: projectedTruthLabel,
      }),
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
const UNRESOLVED_RELEASE_REVISION = /REPLACE_ME|CHANGEME|example\.com|000000000000|^(?:UNKNOWN|UNAVAILABLE|NOT_CONFIGURED)(?:_|$)/i;
const BOOT_RELEASE_MAX_HISTORY = 20;
const BOOT_RELEASE_MAX_UTC_MS = 4_102_444_800_000;
const BOOT_RELEASE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const BOOT_RELEASE_SCHEMA_REVISION = /^(?:[1-9][0-9]{0,15}|UNKNOWN)$/;
const BOOT_RELEASE_RECORD_KEYS = Object.freeze([
  'operationId', 'operationType', 'generation', 'testedCommit', 'deployedCommit',
  'configRevision', 'schemaRevision', 'modelRevision', 'startedAtMs',
  'completedAtMs', 'clean', 'blockerCode', 'correlationId', 'ledgerEventId',
  'lifecycleState', 'identityState', 'identityIssues',
  'deploymentMutationAuthority',
] as const);
const BOOT_RELEASE_READBACK_KEYS = Object.freeze([
  'source', 'state', 'latest', 'history', 'crashPendingOperationIds', 'reasonCodes',
] as const);
const BOOT_RELEASE_IDENTITY_ISSUES = Object.freeze([
  'TESTED_COMMIT_UNKNOWN',
  'DEPLOYED_COMMIT_UNKNOWN',
  'CONFIG_REVISION_UNKNOWN',
  'SCHEMA_REVISION_UNKNOWN',
  'MODEL_REVISION_UNKNOWN',
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

const INCIDENT_SNAPSHOT_KEYS = Object.freeze(['availability', 'incidents']);
const INCIDENT_AVAILABILITY_KEYS = Object.freeze(['state', 'truthLabel', 'blocker']);
const INCIDENT_KEYS = Object.freeze([
  'incidentId', 'fingerprint', 'ledgerEventId', 'severity', 'rootComponentId',
  'sourceGroup', 'capitalRelevant', 'firstSeenAtMs', 'lastSeenAtMs', 'count', 'state',
  'reasonCode', 'operatorAction', 'correlationId', 'acknowledgedAtMs',
  'acknowledgedByOperatorId', 'resolvedAtMs', 'acknowledgementControlId',
  'routing', 'recoveryProof',
]);
const INCIDENT_ROUTING_KEYS = Object.freeze(['inApp', 'externalPaging']);
const INCIDENT_IN_APP_KEYS = Object.freeze(['state', 'receiptId']);
const INCIDENT_EXTERNAL_KEYS = Object.freeze(['state', 'receiptId', 'blocker']);
const INCIDENT_RECOVERY_KEYS = Object.freeze(['state', 'sourceEventId', 'resolvedAtMs']);
const PRODUCT_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const LEDGER_RECEIPT = /^ledger-event:[1-9][0-9]{0,15}$/;

function unavailableIncidentSnapshot(blocker: string): Readonly<ProductRuntimeIncidentSnapshot> {
  return Object.freeze({
    availability: Object.freeze({ state: 'UNAVAILABLE', truthLabel: 'UNAVAILABLE', blocker }),
    incidents: Object.freeze([]),
  });
}

function projectProductRuntimeIncidentSnapshot(value: unknown): Readonly<ProductRuntimeIncidentSnapshot> {
  if (!isRecord(value) || !exactKeys(value, INCIDENT_SNAPSHOT_KEYS)
    || !isRecord(value.availability) || !exactKeys(value.availability, INCIDENT_AVAILABILITY_KEYS)
    || !Array.isArray(value.incidents) || value.incidents.length > 200) {
    return unavailableIncidentSnapshot('INCIDENT_OWNER_READBACK_INVALID');
  }
  const availability = value.availability;
  const exactAvailability = (
    availability.state === 'AVAILABLE'
      && availability.truthLabel === 'BUILT_AND_TESTED'
      && availability.blocker === null
  ) || (
    availability.state === 'NOT_CONFIGURED'
      && availability.truthLabel === 'NOT_CONFIGURED'
      && typeof availability.blocker === 'string'
      && /^[A-Z][A-Z0-9_]{0,127}$/.test(availability.blocker)
  ) || (
    availability.state === 'UNAVAILABLE'
      && availability.truthLabel === 'UNAVAILABLE'
      && typeof availability.blocker === 'string'
      && /^[A-Z][A-Z0-9_]{0,127}$/.test(availability.blocker)
  );
  if (!exactAvailability || (availability.state !== 'AVAILABLE' && value.incidents.length !== 0)) {
    return unavailableIncidentSnapshot('INCIDENT_OWNER_READBACK_INVALID');
  }

  const seenIncidentIds = new Set<string>();
  const seenFingerprints = new Set<string>();
  const projected: Readonly<ProductRuntimeIncidentProjection>[] = [];
  for (const candidate of value.incidents) {
    if (!isRecord(candidate) || !exactKeys(candidate, INCIDENT_KEYS)
      || typeof candidate.incidentId !== 'string' || !PRODUCT_IDENTIFIER.test(candidate.incidentId)
      || typeof candidate.fingerprint !== 'string' || !PRODUCT_IDENTIFIER.test(candidate.fingerprint)
      || typeof candidate.rootComponentId !== 'string' || !PRODUCT_IDENTIFIER.test(candidate.rootComponentId)
      || typeof candidate.sourceGroup !== 'string' || !PRODUCT_IDENTIFIER.test(candidate.sourceGroup)
      || typeof candidate.correlationId !== 'string' || !PRODUCT_IDENTIFIER.test(candidate.correlationId)
      || !Number.isSafeInteger(candidate.ledgerEventId) || Number(candidate.ledgerEventId) < 1
      || !Number.isSafeInteger(candidate.count) || Number(candidate.count) < 1
      || !validUtcMs(candidate.firstSeenAtMs) || !validUtcMs(candidate.lastSeenAtMs)
      || Number(candidate.lastSeenAtMs) < Number(candidate.firstSeenAtMs)
      || !['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(String(candidate.severity))
      || typeof candidate.capitalRelevant !== 'boolean'
      || !['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(String(candidate.state))
      || candidate.reasonCode !== 'CONNECTION_UNHEALTHY'
      || typeof candidate.operatorAction !== 'string' || candidate.operatorAction.length < 1
      || candidate.operatorAction.length > 2_000
      || !(candidate.acknowledgedAtMs === null || validUtcMs(candidate.acknowledgedAtMs))
      || !(candidate.acknowledgedByOperatorId === null
        || (typeof candidate.acknowledgedByOperatorId === 'string'
          && PRODUCT_IDENTIFIER.test(candidate.acknowledgedByOperatorId)))
      || !(candidate.resolvedAtMs === null || validUtcMs(candidate.resolvedAtMs))
      || typeof candidate.acknowledgementControlId !== 'string'
      || productIncidentAcknowledgementControlId(candidate.incidentId) !== candidate.acknowledgementControlId
      || !isRecord(candidate.routing) || !exactKeys(candidate.routing, INCIDENT_ROUTING_KEYS)
      || !isRecord(candidate.routing.inApp) || !exactKeys(candidate.routing.inApp, INCIDENT_IN_APP_KEYS)
      || candidate.routing.inApp.state !== 'WIRED_LOCAL'
      || typeof candidate.routing.inApp.receiptId !== 'string'
      || !LEDGER_RECEIPT.test(candidate.routing.inApp.receiptId)
      || !Number.isSafeInteger(Number(candidate.routing.inApp.receiptId.slice('ledger-event:'.length)))
      || Number(candidate.routing.inApp.receiptId.slice('ledger-event:'.length)) > Number(candidate.ledgerEventId)
      || !isRecord(candidate.routing.externalPaging)
      || !exactKeys(candidate.routing.externalPaging, INCIDENT_EXTERNAL_KEYS)
      || candidate.routing.externalPaging.state !== 'NOT_CONFIGURED'
      || candidate.routing.externalPaging.receiptId !== null
      || candidate.routing.externalPaging.blocker !== 'EXTERNAL_PAGING_OWNER_NOT_CONFIGURED'
      || !isRecord(candidate.recoveryProof) || !exactKeys(candidate.recoveryProof, INCIDENT_RECOVERY_KEYS)
      || !['PENDING', 'PROVEN'].includes(String(candidate.recoveryProof.state))
      || !(candidate.recoveryProof.sourceEventId === null
        || (Number.isSafeInteger(candidate.recoveryProof.sourceEventId)
          && Number(candidate.recoveryProof.sourceEventId) >= 1))
      || !(candidate.recoveryProof.resolvedAtMs === null
        || validUtcMs(candidate.recoveryProof.resolvedAtMs))) {
      return unavailableIncidentSnapshot('INCIDENT_OWNER_READBACK_INVALID');
    }
    const hasAcknowledgement = candidate.acknowledgedAtMs !== null
      && candidate.acknowledgedByOperatorId !== null;
    const exactAcknowledgement = hasAcknowledgement === (
      candidate.acknowledgedAtMs !== null || candidate.acknowledgedByOperatorId !== null
    );
    const resolved = candidate.state === 'RESOLVED';
    if (!exactAcknowledgement
      || (candidate.state === 'ACKNOWLEDGED' && !hasAcknowledgement)
      || (candidate.state === 'OPEN' && hasAcknowledgement)
      || (candidate.acknowledgedAtMs !== null
        && candidate.acknowledgedAtMs < candidate.firstSeenAtMs)
      || resolved !== (candidate.resolvedAtMs !== null)
      || resolved !== (candidate.recoveryProof.state === 'PROVEN')
      || resolved !== (candidate.recoveryProof.sourceEventId !== null)
      || candidate.recoveryProof.resolvedAtMs !== candidate.resolvedAtMs
      || (candidate.resolvedAtMs !== null && candidate.resolvedAtMs !== candidate.lastSeenAtMs)
      || (candidate.acknowledgedAtMs !== null && candidate.resolvedAtMs !== null
        && candidate.acknowledgedAtMs > candidate.resolvedAtMs)
      || seenIncidentIds.has(candidate.incidentId)
      || seenFingerprints.has(candidate.fingerprint)) {
      return unavailableIncidentSnapshot('INCIDENT_OWNER_READBACK_INVALID');
    }
    seenIncidentIds.add(candidate.incidentId);
    seenFingerprints.add(candidate.fingerprint);
    projected.push(Object.freeze({
      incidentId: candidate.incidentId,
      fingerprint: candidate.fingerprint,
      ledgerEventId: candidate.ledgerEventId as number,
      severity: candidate.severity as ProductRuntimeIncidentProjection['severity'],
      rootComponentId: candidate.rootComponentId,
      sourceGroup: candidate.sourceGroup,
      capitalRelevant: candidate.capitalRelevant,
      firstSeenAtMs: candidate.firstSeenAtMs,
      lastSeenAtMs: candidate.lastSeenAtMs,
      count: candidate.count as number,
      state: candidate.state as ProductRuntimeIncidentProjection['state'],
      reasonCode: 'CONNECTION_UNHEALTHY',
      operatorAction: candidate.operatorAction,
      correlationId: candidate.correlationId,
      acknowledgedAtMs: candidate.acknowledgedAtMs as number | null,
      acknowledgedByOperatorId: candidate.acknowledgedByOperatorId as string | null,
      resolvedAtMs: candidate.resolvedAtMs as number | null,
      acknowledgementControlId: candidate.acknowledgementControlId,
      routing: Object.freeze({
        inApp: Object.freeze({ state: 'WIRED_LOCAL', receiptId: candidate.routing.inApp.receiptId }),
        externalPaging: Object.freeze({
          state: 'NOT_CONFIGURED', receiptId: null, blocker: 'EXTERNAL_PAGING_OWNER_NOT_CONFIGURED',
        }),
      }),
      recoveryProof: Object.freeze({
        state: candidate.recoveryProof.state as 'PENDING' | 'PROVEN',
        sourceEventId: candidate.recoveryProof.sourceEventId as number | null,
        resolvedAtMs: candidate.recoveryProof.resolvedAtMs as number | null,
      }),
    }));
  }
  return Object.freeze({
    availability: Object.freeze({
      state: availability.state as ProductRuntimeIncidentSnapshot['availability']['state'],
      truthLabel: availability.truthLabel as ProductRuntimeTruthLabel,
      blocker: availability.blocker as string | null,
    }),
    incidents: Object.freeze(projected),
  });
}

function validUtcMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= BOOT_RELEASE_MAX_UTC_MS;
}

function validBootReleaseSchemaRevision(value: unknown): value is string {
  if (value === 'UNKNOWN') return true;
  return typeof value === 'string'
    && BOOT_RELEASE_SCHEMA_REVISION.test(value)
    && Number.isSafeInteger(Number(value))
    && Number(value) > 0;
}

function stringOrNull(value: unknown, pattern: RegExp): value is string | null {
  return value === null || (typeof value === 'string' && pattern.test(value));
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function unavailableBootReleaseReadback(
  reasonCode: 'BOOT_RELEASE_READBACK_NOT_CONFIGURED'
    | 'BOOT_RELEASE_READBACK_UNAVAILABLE'
    | 'BOOT_RELEASE_READBACK_INVALID',
): Readonly<ProductRuntimeBootReleaseReadback> {
  return Object.freeze({
    source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE',
    state: 'UNAVAILABLE',
    latest: null,
    history: Object.freeze([]),
    crashPendingOperationIds: Object.freeze([]),
    reasonCodes: Object.freeze([reasonCode]),
  });
}

function projectBootReleaseRecord(value: unknown): Readonly<ProductRuntimeBootReleaseRecord> | null {
  if (!isRecord(value) || !exactKeys(value, BOOT_RELEASE_RECORD_KEYS)) return null;
  if (!Number.isSafeInteger(value.generation) || Number(value.generation) < 1
    || value.operationId !== `system.application.boot.g${value.generation}`
    || value.operationType !== 'APPLICATION_BOOT'
    || value.correlationId !== `system-boot-g${value.generation}`
    || !Number.isSafeInteger(value.ledgerEventId) || Number(value.ledgerEventId) < 1
    || !stringOrNull(value.testedCommit, FULL_GIT_SHA)
    || !stringOrNull(value.deployedCommit, FULL_GIT_SHA)
    || !(value.configRevision === null
      || (typeof value.configRevision === 'string' && validReleaseRevision(value.configRevision) !== null))
    || !(value.modelRevision === null
      || (typeof value.modelRevision === 'string' && validReleaseRevision(value.modelRevision) !== null))
    || !validBootReleaseSchemaRevision(value.schemaRevision)
    || !validUtcMs(value.startedAtMs)
    || !(value.completedAtMs === null || validUtcMs(value.completedAtMs))
    || !(value.clean === null || typeof value.clean === 'boolean')
    || !stringOrNull(value.blockerCode, BOOT_RELEASE_CODE)
    || !['ACTIVE', 'CRASH_PENDING', 'CLEAN_COMPLETED', 'UNCLEAN_COMPLETED'].includes(String(value.lifecycleState))
    || !['AVAILABLE', 'PARTIAL', 'UNKNOWN'].includes(String(value.identityState))
    || value.deploymentMutationAuthority !== 'NONE'
    || !Array.isArray(value.identityIssues)
    || value.identityIssues.length > BOOT_RELEASE_IDENTITY_ISSUES.length) return null;

  const terminal = value.lifecycleState === 'CLEAN_COMPLETED'
    || value.lifecycleState === 'UNCLEAN_COMPLETED';
  if (terminal !== (value.completedAtMs !== null)
    || terminal !== (value.clean !== null)
    || (value.lifecycleState === 'CLEAN_COMPLETED' && value.clean !== true)
    || (value.lifecycleState === 'UNCLEAN_COMPLETED' && value.clean !== false)
    || (value.completedAtMs !== null && value.completedAtMs < value.startedAtMs)) return null;

  const expectedIssues: ProductRuntimeBootReleaseIdentityIssue[] = [];
  if (value.testedCommit === null) expectedIssues.push('TESTED_COMMIT_UNKNOWN');
  if (value.deployedCommit === null) expectedIssues.push('DEPLOYED_COMMIT_UNKNOWN');
  if (value.configRevision === null) expectedIssues.push('CONFIG_REVISION_UNKNOWN');
  if (value.schemaRevision === 'UNKNOWN') expectedIssues.push('SCHEMA_REVISION_UNKNOWN');
  if (value.modelRevision === null) expectedIssues.push('MODEL_REVISION_UNKNOWN');
  if (value.identityIssues.some((issue) => (
    typeof issue !== 'string'
    || !BOOT_RELEASE_IDENTITY_ISSUES.includes(issue as ProductRuntimeBootReleaseIdentityIssue)
  )) || !sameStrings(value.identityIssues as string[], expectedIssues)) return null;
  const expectedIdentityState = expectedIssues.includes('TESTED_COMMIT_UNKNOWN')
    || expectedIssues.includes('SCHEMA_REVISION_UNKNOWN')
    ? 'UNKNOWN'
    : expectedIssues.length === 0 ? 'AVAILABLE' : 'PARTIAL';
  if (value.identityState !== expectedIdentityState) return null;

  return Object.freeze({
    operationId: value.operationId as string,
    operationType: 'APPLICATION_BOOT',
    generation: value.generation as number,
    testedCommit: value.testedCommit as string | null,
    deployedCommit: value.deployedCommit as string | null,
    configRevision: value.configRevision as string | null,
    schemaRevision: value.schemaRevision,
    modelRevision: value.modelRevision as string | null,
    startedAtMs: value.startedAtMs,
    completedAtMs: value.completedAtMs as number | null,
    clean: value.clean as boolean | null,
    blockerCode: value.blockerCode as string | null,
    correlationId: value.correlationId as string,
    ledgerEventId: value.ledgerEventId as number,
    lifecycleState: value.lifecycleState as ProductRuntimeBootReleaseRecord['lifecycleState'],
    identityState: value.identityState as ProductRuntimeBootReleaseRecord['identityState'],
    identityIssues: Object.freeze([...expectedIssues]),
    deploymentMutationAuthority: 'NONE',
  });
}

function sameBootReleaseRecord(
  actual: Readonly<ProductRuntimeBootReleaseRecord>,
  expected: Readonly<ProductRuntimeBootReleaseRecord>,
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function projectProductRuntimeBootReleaseReadback(
  value: Readonly<BootReleaseReadback> | null | undefined,
  unavailableReason: 'BOOT_RELEASE_READBACK_NOT_CONFIGURED'
    | 'BOOT_RELEASE_READBACK_UNAVAILABLE'
    | null = null,
): Readonly<ProductRuntimeBootReleaseReadback> {
  if (unavailableReason !== null) return unavailableBootReleaseReadback(unavailableReason);
  if (value === undefined) return unavailableBootReleaseReadback('BOOT_RELEASE_READBACK_NOT_CONFIGURED');
  if (!isRecord(value) || !exactKeys(value, BOOT_RELEASE_READBACK_KEYS)
    || value.source !== 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE'
    || !['AVAILABLE', 'EMPTY', 'UNAVAILABLE'].includes(String(value.state))
    || !Array.isArray(value.history)
    || !Array.isArray(value.crashPendingOperationIds)
    || !Array.isArray(value.reasonCodes)
    || value.crashPendingOperationIds.length > BOOT_RELEASE_MAX_HISTORY
    || value.reasonCodes.length > BOOT_RELEASE_MAX_HISTORY
    || value.reasonCodes.some((code) => typeof code !== 'string' || !BOOT_RELEASE_CODE.test(code))) {
    return unavailableBootReleaseReadback('BOOT_RELEASE_READBACK_INVALID');
  }
  if (value.state === 'EMPTY') {
    if (value.latest !== null || value.history.length !== 0
      || value.crashPendingOperationIds.length !== 0
      || !sameStrings(value.reasonCodes as string[], ['BOOT_RELEASE_HISTORY_EMPTY'])) {
      return unavailableBootReleaseReadback('BOOT_RELEASE_READBACK_INVALID');
    }
    return Object.freeze({
      source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE',
      state: 'EMPTY',
      latest: null,
      history: Object.freeze([]),
      crashPendingOperationIds: Object.freeze([]),
      reasonCodes: Object.freeze(['BOOT_RELEASE_HISTORY_EMPTY']),
    });
  }
  if (value.state === 'UNAVAILABLE') {
    if (value.latest !== null || value.history.length !== 0
      || value.crashPendingOperationIds.length !== 0 || value.reasonCodes.length < 1) {
      return unavailableBootReleaseReadback('BOOT_RELEASE_READBACK_INVALID');
    }
    return Object.freeze({
      source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE',
      state: 'UNAVAILABLE',
      latest: null,
      history: Object.freeze([]),
      crashPendingOperationIds: Object.freeze([]),
      reasonCodes: Object.freeze([...(value.reasonCodes as string[])]),
    });
  }
  if (value.history.length < 1 || value.history.length > BOOT_RELEASE_MAX_HISTORY) {
    return unavailableBootReleaseReadback('BOOT_RELEASE_READBACK_INVALID');
  }
  const history = value.history.map(projectBootReleaseRecord);
  const latest = projectBootReleaseRecord(value.latest);
  if (latest === null || history.some((record) => record === null)) {
    return unavailableBootReleaseReadback('BOOT_RELEASE_READBACK_INVALID');
  }
  const validHistory = history as readonly Readonly<ProductRuntimeBootReleaseRecord>[];
  if (!sameBootReleaseRecord(latest, validHistory[0]!)) {
    return unavailableBootReleaseReadback('BOOT_RELEASE_READBACK_INVALID');
  }
  for (let index = 1; index < validHistory.length; index += 1) {
    if (validHistory[index]!.generation >= validHistory[index - 1]!.generation
      || validHistory[index]!.ledgerEventId >= validHistory[index - 1]!.ledgerEventId
      || validHistory[index]!.startedAtMs > validHistory[index - 1]!.startedAtMs
      || (validHistory[index]!.completedAtMs !== null
        && validHistory[index]!.completedAtMs! > validHistory[index - 1]!.startedAtMs)
      || validHistory[index]!.lifecycleState === 'ACTIVE') {
      return unavailableBootReleaseReadback('BOOT_RELEASE_READBACK_INVALID');
    }
  }
  const expectedCrashIds = validHistory
    .filter((record) => record.lifecycleState === 'CRASH_PENDING')
    .map((record) => record.operationId);
  const expectedReasonCodes = [
    ...validHistory[0]!.identityIssues,
    ...(expectedCrashIds.length > 0 ? ['CRASH_PENDING_BOOT_PRESENT'] : []),
  ];
  if (value.crashPendingOperationIds.some((id) => typeof id !== 'string')
    || !sameStrings(value.crashPendingOperationIds as string[], expectedCrashIds)
    || !sameStrings(value.reasonCodes as string[], expectedReasonCodes)) {
    return unavailableBootReleaseReadback('BOOT_RELEASE_READBACK_INVALID');
  }
  return Object.freeze({
    source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE',
    state: 'AVAILABLE',
    latest,
    history: Object.freeze([...validHistory]),
    crashPendingOperationIds: Object.freeze([...expectedCrashIds]),
    reasonCodes: Object.freeze([...expectedReasonCodes]),
  });
}

function validReleaseRevision(value: string | null): string | null {
  return value !== null
    && RELEASE_REVISION.test(value)
    && !UNRESOLVED_RELEASE_REVISION.test(value)
    ? value
    : null;
}

function releaseRevisions(
  readback: Readonly<ProductRuntimeBootReleaseReadback>,
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
  bootReleaseReadback: Readonly<ProductRuntimeBootReleaseReadback>,
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

function canonicalCockpitTruth(
  view: Readonly<ProductRuntimeOwnerView>,
  projectedComponents: readonly Readonly<ProductRuntimeComponentProjection>[],
): Readonly<ProductRuntimeCanonicalCockpitTruth> {
  const exactComponent = (componentId: string): Readonly<ProductRuntimeComponentProjection> | null => {
    const matches = projectedComponents.filter((component) => component.componentId === componentId);
    return matches.length === 1 ? matches[0]! : null;
  };

  const sourceComponents = ['public-spot-source', 'public-usdm-source'].map((componentId) => ({
    componentId,
    matches: projectedComponents.filter((component) => component.componentId === componentId),
  }));
  let marketFeedReadiness: ProductRuntimeCanonicalCockpitTruth['marketFeedReadiness'];
  if (view.dataFreshness === null) {
    marketFeedReadiness = Object.freeze({
      proven: false,
      label: 'Market Feed Readiness Unproven',
      detail: 'Canonical owner data freshness is unavailable.',
    });
  } else {
    const invalidCardinality = sourceComponents.find(({ matches }) => matches.length !== 1);
    const nonOperational = sourceComponents.find(({ matches }) => matches[0]?.canonicalPresentation.status !== 'operational');
    if (invalidCardinality) {
      marketFeedReadiness = Object.freeze({
        proven: false,
        label: 'Market Feed Readiness Unproven',
        detail: `Canonical ${invalidCardinality.componentId} cardinality is ${invalidCardinality.matches.length}; expected exactly one.`,
      });
    } else if (nonOperational) {
      const source = nonOperational.matches[0]!;
      marketFeedReadiness = Object.freeze({
        proven: false,
        label: 'Market Feed Readiness Unproven',
        detail: `Canonical ${nonOperational.componentId} is ${source.canonicalPresentation.stateLabel}.`,
      });
    } else {
      marketFeedReadiness = Object.freeze({
        proven: true,
        label: 'Market Feed Readiness Proven',
        detail: `Canonical Spot and USD-M sources are READY · LIVE PUBLIC · LIVE PUBLIC; owner freshness ${view.dataFreshness}.`,
      });
    }
  }

  const basis = exactComponent('basis-engine');
  const volume = exactComponent('volume-engine');
  const strategyComponents = [basis, volume];
  const livePublicCount = strategyComponents.filter((component) => component?.canonicalPresentation.status === 'operational').length;
  const strategyRuntime = livePublicCount === strategyComponents.length
    ? Object.freeze({ tone: 'ok' as const, label: 'Public Runtime Live', livePublicCount })
    : strategyComponents.some((component) => component === null || component.canonicalPresentation.status === 'outage')
      ? Object.freeze({ tone: 'bad' as const, label: 'Canonical Runtime Unavailable', livePublicCount })
      : strategyComponents.some((component) => component?.capability === 'DRY_RUN')
        ? Object.freeze({ tone: 'warn' as const, label: 'Validate-Only Ready', livePublicCount })
        : Object.freeze({ tone: 'warn' as const, label: 'Review Required', livePublicCount });

  let watchmanOverall: ProductRuntimeCanonicalCockpitTruth['watchmanOverall'];
  if (view.effectiveMode === 'BLOCKED' || view.machineReady === 'NO') {
    watchmanOverall = Object.freeze({ status: 'outage', label: 'Not Ready' });
  } else if (view.machineReady !== 'YES') {
    watchmanOverall = Object.freeze({ status: 'degraded', label: 'Readiness Unknown' });
  } else if (view.effectiveMode === 'VALIDATE_ONLY'
    || projectedComponents.some((component) => component.capability === 'DRY_RUN')) {
    watchmanOverall = Object.freeze({ status: 'degraded', label: 'Validate Only' });
  } else if (view.effectiveMode === 'READ_ONLY') {
    watchmanOverall = Object.freeze({ status: 'degraded', label: 'Read Only' });
  } else if (view.effectiveMode === 'ADVISORY') {
    watchmanOverall = Object.freeze({ status: 'degraded', label: 'Advisory' });
  } else {
    watchmanOverall = Object.freeze({ status: 'degraded', label: 'Effective Mode Unknown' });
  }

  return Object.freeze({
    source: 'CANONICAL_SUPERVISOR_PRODUCT_PROJECTION',
    marketFeedReadiness,
    strategyRuntime,
    watchmanOverall,
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

function canonicalAccountCutIdentity(snapshot: Readonly<SystemSupervisorReadModel>): string {
  return [
    snapshot.revision,
    snapshot.runtimeGeneration,
    snapshot.controlGeneration,
    snapshot.evaluatedAtMs,
  ].join(':');
}

function weakestSurfaceTruth(labels: readonly ProductRuntimeTruthLabel[]): ProductRuntimeTruthLabel {
  for (const candidate of ['UNKNOWN', 'MISSING', 'UNAVAILABLE', 'NOT_CONFIGURED', 'BLOCKED', 'SYNTHETIC_ONLY', 'BUILT_AND_TESTED', 'IMPORTED', 'WIRED', 'LIVE_PUBLIC'] as const) {
    if (labels.includes(candidate)) return candidate;
  }
  return 'UNKNOWN';
}

function surfaceTruth(
  surfaceId: keyof typeof SURFACE_EVIDENCE,
  snapshot: Readonly<SystemSupervisorReadModel>,
  incidentSnapshot: Readonly<ProductRuntimeIncidentSnapshot>,
): ProductRuntimeTruthLabel {
  const map = (truth: SystemTruthLabel) => productTruthLabel(truth);
  if (surfaceId === 'basis') return map(snapshot.summaries.strategies.basis.truthLabel);
  if (surfaceId === 'volume') return map(snapshot.summaries.strategies.volume.truthLabel);
  if (surfaceId === 'risk') return map(snapshot.summaries.risk.truthLabel);
  if (surfaceId === 'account' || surfaceId === 'borrow') return accountTruth(snapshot);
  if (surfaceId === 'notifications') return incidentSnapshot.availability.truthLabel;
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

const REQUIRED_SURFACE_BLOCKING_TRUTH = new Set<ProductRuntimeTruthLabel>([
  'BLOCKED', 'NOT_CONFIGURED', 'UNAVAILABLE', 'MISSING', 'UNKNOWN',
]);

function isOptionalSurfaceDatum(
  surfaceId: keyof typeof SURFACE_EVIDENCE,
  fieldId: string,
): boolean {
  return OPTIONAL_SURFACE_EVIDENCE[surfaceId]?.includes(fieldId) ?? false;
}

/** Pure relational readiness law; optional evidence rows never mint blockers. */
export function productRuntimeSurfaceReadinessBlocker(
  surfaceId: keyof typeof SURFACE_EVIDENCE,
  evidence: readonly Readonly<ProductRuntimeSurfaceDatum>[],
): Readonly<ProductRuntimeSurfaceDatum> | null {
  return evidence.find((datum) => (
    !isOptionalSurfaceDatum(surfaceId, datum.fieldId)
    && (datum.value === null || REQUIRED_SURFACE_BLOCKING_TRUTH.has(datum.truthLabel))
  )) ?? null;
}

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

const OWNER_TRUTH_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const OWNER_TRUTH_SOURCE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const OWNER_TRUTH_ACCOUNT_CUT_IDENTITY = /^(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*)$/;
const OWNER_TRUTH_MAX_VALUE_LENGTH = 240;
const OWNER_TRUTH_MAX_AGE_CEILING_MS = 86_400_000;

const OWNER_TRUTH_CUT_KEYS = Object.freeze(['schemaVersion', 'source', 'observedAtMs', 'surfaces']);
const OWNER_TRUTH_SURFACE_KEYS = Object.freeze([
  'surfaceId', 'source', 'state', 'observedAtMs', 'maxAgeMs', 'truthLabel',
  'unavailableReason', 'supersedesCanonicalAccountTruthState',
  'supersedesCanonicalAccountCutIdentity', 'fields',
]);
const OWNER_TRUTH_FIELD_KEYS = Object.freeze([
  'fieldId', 'source', 'state', 'value', 'truthLabel', 'unavailableReason',
]);
const OWNER_TRUTH_SURFACE_ID_SET: ReadonlySet<string> = new Set(PRODUCT_RUNTIME_OWNER_TRUTH_SURFACE_IDS);
const OWNER_TRUTH_AVAILABLE_LABEL_SET: ReadonlySet<string> = new Set(PRODUCT_RUNTIME_OWNER_TRUTH_AVAILABLE_LABELS);
const OWNER_TRUTH_UNAVAILABLE_LABEL_SET: ReadonlySet<string> = new Set(PRODUCT_RUNTIME_OWNER_TRUTH_UNAVAILABLE_LABELS);

function isOwnerTruthSurfaceId(value: string): value is ProductRuntimeOwnerTruthSurfaceId {
  return OWNER_TRUTH_SURFACE_ID_SET.has(value);
}

/**
 * A bound owner row is a short printable line. Control characters are refused
 * outright so no owner value can smuggle framing into a rendered surface.
 */
function isOwnerTruthValue(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > OWNER_TRUTH_MAX_VALUE_LENGTH) {
    return false;
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return false;
  }
  return true;
}

function ownerTruthCanonicalSource(source: string | null, fieldId: string): string {
  return source === null
    ? `productIntegration.owner-truth:${fieldId}`
    : `productIntegration.owner-truth:${source}:${fieldId}`;
}

function unavailableOwnerTruthSurface(
  surfaceId: ProductRuntimeOwnerTruthSurfaceId,
  unavailableReason: string,
  truthLabel: ProductRuntimeTruthLabel,
  source: string | null,
): Readonly<ProductRuntimeOwnerTruthSurfaceBinding> {
  const fields: Record<string, Readonly<ProductRuntimeOwnerTruthDatum>> = {};
  for (const fieldId of PRODUCT_RUNTIME_OWNER_TRUTH_FIELDS[surfaceId]) {
    fields[fieldId] = Object.freeze({
      value: null,
      truthLabel,
      canonicalSource: ownerTruthCanonicalSource(source, fieldId),
      unavailableReason,
    });
  }
  return Object.freeze({
    state: 'UNAVAILABLE',
    surfaceTruthLabel: truthLabel,
    supersedesCanonicalAccountTruthState: null,
    supersedesCanonicalAccountCutIdentity: null,
    fields: Object.freeze(fields),
  });
}

function ownerTruthBinding(
  bound: Readonly<Record<ProductRuntimeOwnerTruthSurfaceId, Readonly<ProductRuntimeOwnerTruthSurfaceBinding>>>,
  observedAtMs: number,
): Readonly<ProductRuntimeOwnerTruthBinding> {
  const canonical = PRODUCT_RUNTIME_OWNER_TRUTH_SURFACE_IDS.map((surfaceId) => {
    const surface = bound[surfaceId];
    return Object.freeze({
      surfaceId,
      state: surface.state,
      surfaceTruthLabel: surface.surfaceTruthLabel,
      supersedesCanonicalAccountTruthState: surface.supersedesCanonicalAccountTruthState,
      supersedesCanonicalAccountCutIdentity: surface.supersedesCanonicalAccountCutIdentity,
      fields: PRODUCT_RUNTIME_OWNER_TRUTH_FIELDS[surfaceId].map((fieldId) => Object.freeze({
        fieldId,
        ...surface.fields[fieldId],
      })),
    });
  });
  const revisionToken = createHash('sha256')
    .update(JSON.stringify({ observedAtMs, surfaces: canonical }))
    .digest('hex');
  return Object.freeze({ revisionToken, surfaces: bound });
}

function unavailableOwnerTruthBinding(
  unavailableReason: string,
  truthLabel: ProductRuntimeTruthLabel,
  source: string | null,
): Readonly<ProductRuntimeOwnerTruthBinding> {
  return ownerTruthBinding(Object.freeze({
    dashboard: unavailableOwnerTruthSurface('dashboard', unavailableReason, truthLabel, source),
    account: unavailableOwnerTruthSurface('account', unavailableReason, truthLabel, source),
    markets: unavailableOwnerTruthSurface('markets', unavailableReason, truthLabel, source),
  }), 0);
}

function projectOwnerTruthSurfaceFields(
  surfaceId: ProductRuntimeOwnerTruthSurfaceId,
  value: readonly unknown[],
): Readonly<Record<string, Readonly<ProductRuntimeOwnerTruthDatum>>> | null {
  const expected = PRODUCT_RUNTIME_OWNER_TRUTH_FIELDS[surfaceId];
  if (value.length !== expected.length) return null;
  const fields: Record<string, Readonly<ProductRuntimeOwnerTruthDatum>> = {};
  for (const entry of value) {
    if (!isRecord(entry) || !exactKeys(entry, OWNER_TRUTH_FIELD_KEYS)) return null;
    const fieldId = entry.fieldId;
    if (typeof fieldId !== 'string' || !expected.includes(fieldId)
      || Object.prototype.hasOwnProperty.call(fields, fieldId)
      || typeof entry.truthLabel !== 'string'
      || typeof entry.source !== 'string' || !OWNER_TRUTH_SOURCE.test(entry.source)) return null;
    if (entry.state === 'AVAILABLE') {
      if (!isOwnerTruthValue(entry.value)
        || entry.unavailableReason !== null
        || !OWNER_TRUTH_AVAILABLE_LABEL_SET.has(entry.truthLabel)) return null;
      fields[fieldId] = Object.freeze({
        value: entry.value,
        truthLabel: entry.truthLabel as ProductRuntimeTruthLabel,
        canonicalSource: ownerTruthCanonicalSource(entry.source, fieldId),
        unavailableReason: null,
      });
      continue;
    }
    // A row the owner answered for but cannot evidence keeps its exact reason
    // and a blocking label, so the surface stays honest instead of green.
    if (entry.state !== 'UNAVAILABLE' || entry.value !== null
      || typeof entry.unavailableReason !== 'string'
      || !OWNER_TRUTH_CODE.test(entry.unavailableReason)
      || !OWNER_TRUTH_UNAVAILABLE_LABEL_SET.has(entry.truthLabel)) return null;
    fields[fieldId] = Object.freeze({
      value: null,
      truthLabel: entry.truthLabel as ProductRuntimeTruthLabel,
      canonicalSource: ownerTruthCanonicalSource(entry.source, fieldId),
      unavailableReason: entry.unavailableReason,
    });
  }
  return Object.freeze(fields);
}

/**
 * Validate one injected owner-truth cut. The cut is the only way a Dashboard,
 * Account, or Markets owner row can carry a value; Product itself never
 * acquires, defaults, or infers one. A structurally invalid cut is rejected as
 * a whole — a producer that cannot describe one surface exactly is not trusted
 * for the others — while a well-formed but old cut fails only its own surface.
 *
 * Returns `null` when no owner-truth port is wired at all, which leaves the
 * pre-existing `CANONICAL_OWNER_FIELD_NOT_CONFIGURED` rows untouched.
 */
export function projectProductRuntimeOwnerTruthBinding(
  cut: Readonly<ProductRuntimeOwnerTruthCut> | null | undefined,
  unavailableReason: ProductRuntimeOwnerTruthUnavailableReason | null,
  nowMs: number,
): Readonly<ProductRuntimeOwnerTruthBinding> | null {
  if (cut === null || cut === undefined) {
    if (unavailableReason === null) return null;
    return unavailableOwnerTruthBinding(
      unavailableReason,
      unavailableReason === 'OWNER_TRUTH_CUT_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'UNAVAILABLE',
      null,
    );
  }
  const malformed = () => unavailableOwnerTruthBinding('OWNER_TRUTH_CUT_MALFORMED', 'UNAVAILABLE', null);
  if (!validUtcMs(nowMs)) return malformed();
  const value: unknown = cut;
  if (!isRecord(value) || !exactKeys(value, OWNER_TRUTH_CUT_KEYS)
    || value.schemaVersion !== PRODUCT_RUNTIME_OWNER_TRUTH_SCHEMA
    || typeof value.source !== 'string' || !OWNER_TRUTH_SOURCE.test(value.source)
    || !validUtcMs(value.observedAtMs) || value.observedAtMs > nowMs
    || !Array.isArray(value.surfaces)
    || value.surfaces.length > PRODUCT_RUNTIME_OWNER_TRUTH_SURFACE_IDS.length) return malformed();
  const source = value.source;
  const cutObservedAtMs = value.observedAtMs;
  const bound: Partial<Record<ProductRuntimeOwnerTruthSurfaceId, Readonly<ProductRuntimeOwnerTruthSurfaceBinding>>> = {};
  for (const entry of value.surfaces as readonly unknown[]) {
    if (!isRecord(entry) || !exactKeys(entry, OWNER_TRUTH_SURFACE_KEYS)) return malformed();
    const surfaceId = entry.surfaceId;
    if (typeof surfaceId !== 'string' || !isOwnerTruthSurfaceId(surfaceId)
      || Object.prototype.hasOwnProperty.call(bound, surfaceId)
      || typeof entry.source !== 'string' || !OWNER_TRUTH_SOURCE.test(entry.source)
      || typeof entry.truthLabel !== 'string'
      || !validUtcMs(entry.observedAtMs) || entry.observedAtMs > cutObservedAtMs
      || !Number.isSafeInteger(entry.maxAgeMs)
      || Number(entry.maxAgeMs) < 1 || Number(entry.maxAgeMs) > OWNER_TRUTH_MAX_AGE_CEILING_MS
      || !Array.isArray(entry.fields)) return malformed();
    const supersedes = entry.supersedesCanonicalAccountTruthState;
    const supersedesCut = entry.supersedesCanonicalAccountCutIdentity;
    const noSupersession = supersedes === null && supersedesCut === null;
    const exactAccountSupersession = surfaceId === 'account'
      && typeof supersedes === 'string'
      && PRODUCT_IDENTIFIER.test(supersedes)
      && typeof supersedesCut === 'string'
      && supersedesCut.length <= 96
      && OWNER_TRUTH_ACCOUNT_CUT_IDENTITY.test(supersedesCut);
    if (!noSupersession && !exactAccountSupersession) return malformed();
    if (entry.state === 'UNAVAILABLE') {
      if (entry.fields.length !== 0 || supersedes !== null || supersedesCut !== null
        || typeof entry.unavailableReason !== 'string'
        || !OWNER_TRUTH_CODE.test(entry.unavailableReason)
        || !OWNER_TRUTH_UNAVAILABLE_LABEL_SET.has(entry.truthLabel)) return malformed();
      bound[surfaceId] = unavailableOwnerTruthSurface(
        surfaceId,
        entry.unavailableReason,
        entry.truthLabel as ProductRuntimeTruthLabel,
        entry.source,
      );
      continue;
    }
    if (entry.state !== 'AVAILABLE' || entry.unavailableReason !== null
      || !OWNER_TRUTH_AVAILABLE_LABEL_SET.has(entry.truthLabel)) return malformed();
    const fields = projectOwnerTruthSurfaceFields(surfaceId, entry.fields as readonly unknown[]);
    if (fields === null) return malformed();
    if (nowMs - entry.observedAtMs > Number(entry.maxAgeMs)) {
      // The producer answered, but this cut is older than the owner's own
      // bound. Withhold every row rather than show an aged account or market.
      bound[surfaceId] = unavailableOwnerTruthSurface(
        surfaceId,
        'OWNER_TRUTH_CUT_STALE',
        'UNAVAILABLE',
        entry.source,
      );
      continue;
    }
    bound[surfaceId] = Object.freeze({
      state: 'AVAILABLE',
      surfaceTruthLabel: entry.truthLabel as ProductRuntimeTruthLabel,
      supersedesCanonicalAccountTruthState: supersedes as string | null,
      supersedesCanonicalAccountCutIdentity: supersedesCut as string | null,
      fields,
    });
  }
  for (const surfaceId of PRODUCT_RUNTIME_OWNER_TRUTH_SURFACE_IDS) {
    if (bound[surfaceId] === undefined) {
      bound[surfaceId] = unavailableOwnerTruthSurface(
        surfaceId,
        'OWNER_TRUTH_SURFACE_NOT_SUPPLIED',
        'NOT_CONFIGURED',
        source,
      );
    }
  }
  return ownerTruthBinding(
    Object.freeze(bound as Record<ProductRuntimeOwnerTruthSurfaceId, Readonly<ProductRuntimeOwnerTruthSurfaceBinding>>),
    cutObservedAtMs,
  );
}

function surfaces(
  snapshot: Readonly<SystemSupervisorReadModel>,
  dashboard: Readonly<SystemSupervisorReadModel>,
  view: Readonly<ProductRuntimeOwnerView>,
  materialEvents: Readonly<ProductRuntimeMaterialEventPage>,
  controlCount: number,
  opsReadback: Readonly<CanonicalSupervisorOpsReadback>,
  opsIntakeInterlock: Readonly<CanonicalOpsIntakeInterlock>,
  incidentSnapshot: Readonly<ProductRuntimeIncidentSnapshot>,
  ownerTruth: Readonly<ProductRuntimeOwnerTruthBinding> | null,
): Readonly<Record<string, Readonly<ProductRuntimeSurfaceProjection>>> {
  const activeIncidents = incidentSnapshot.incidents.filter((incident) => incident.state !== 'RESOLVED');
  const acknowledgedIncidents = incidentSnapshot.incidents.filter((incident) => incident.acknowledgedAtMs !== null);
  const recoveredIncidents = incidentSnapshot.incidents.filter((incident) => incident.recoveryProof.state === 'PROVEN');
  const capitalRelevantIncidents = incidentSnapshot.incidents.filter((incident) => incident.capitalRelevant);
  const criticalIncidents = incidentSnapshot.incidents.filter((incident) => incident.severity === 'CRITICAL');
  const latestIncident = incidentSnapshot.incidents[0] ?? null;
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
    'fingerprint-dedup': `${incidentSnapshot.incidents.length} durable incident episodes`,
    'causal-group': 'Canonical component + connection group + durable episode boundary',
    'root-cause': latestIncident?.rootComponentId ?? 'NO_ACTIVE_INCIDENT',
    'severity-capital': `${criticalIncidents.length} critical · ${capitalRelevantIncidents.length} capital relevant`,
    'first-last-count': latestIncident === null
      ? 'NO_INCIDENT_HISTORY'
      : `${latestIncident.firstSeenAtMs} · ${latestIncident.lastSeenAtMs} · count ${latestIncident.count}`,
    state: `${activeIncidents.length} active · ${acknowledgedIncidents.length} acknowledged · ${recoveredIncidents.length} recovered`,
    'owner-action': latestIncident?.operatorAction ?? 'NO_INCIDENT_ACTION_REQUIRED',
    routing: 'IN_APP WIRED_LOCAL · EXTERNAL PAGING NOT_CONFIGURED',
    'silence-ack': `${acknowledgedIncidents.length} durable acknowledgements · no silence mutation`,
    'recovery-proof': `${recoveredIncidents.length} proven · ${activeIncidents.length} pending`,
  });
  const result: Record<string, Readonly<ProductRuntimeSurfaceProjection>> = {};
  for (const surfaceId of Object.keys(SURFACE_EVIDENCE) as (keyof typeof SURFACE_EVIDENCE)[]) {
    const ownerTruthSurface = ownerTruth !== null && isOwnerTruthSurfaceId(surfaceId)
      ? ownerTruth.surfaces[surfaceId]
      : null;
    const canonicalTruthLabel = surfaceTruth(surfaceId, snapshot, incidentSnapshot);
    // Account is the one surface whose canonical label is owned by Capital's
    // account-truth state. A bound cut raises it only while both the exact state
    // and supervisor revision/runtime/control identity still hold.
    const supersededTruthLabel = ownerTruthSurface !== null
      && ownerTruthSurface.state === 'AVAILABLE'
      && ownerTruthSurface.supersedesCanonicalAccountTruthState !== null
      && ownerTruthSurface.supersedesCanonicalAccountTruthState === snapshot.summaries.capital.accountTruthState
      && ownerTruthSurface.supersedesCanonicalAccountCutIdentity === canonicalAccountCutIdentity(snapshot)
      ? ownerTruthSurface.surfaceTruthLabel
      : null;
    const baseTruthLabel = surfaceId === 'markets' && ownerTruthSurface !== null
      ? ownerTruthSurface.surfaceTruthLabel
      : supersededTruthLabel ?? canonicalTruthLabel;
    const ownerTruthLabel = (surfaceId === 'control-room' || surfaceId === 'health')
      ? weakestSurfaceTruth([baseTruthLabel, opsInterlockTruth(opsIntakeInterlock)])
      : baseTruthLabel;
    const evidence = SURFACE_EVIDENCE[surfaceId].map((fieldId) => {
      const canonicalOpsDatum = opsDatum(fieldId, opsReadback, opsIntakeInterlock);
      if (canonicalOpsDatum) {
        return Object.freeze({
          fieldId,
          label: fieldId.replaceAll('-', ' '),
          ...canonicalOpsDatum,
        } satisfies ProductRuntimeSurfaceDatum);
      }
      const ownerTruthDatum = ownerTruthSurface?.fields[fieldId];
      if (ownerTruthDatum) {
        return Object.freeze({
          fieldId,
          label: fieldId.replaceAll('-', ' '),
          ...ownerTruthDatum,
        } satisfies ProductRuntimeSurfaceDatum);
      }
      const value = surfaceId === 'notifications' && incidentSnapshot.availability.state !== 'AVAILABLE'
        ? null
        : surfaceId === 'notifications' && fieldId === 'correlation'
          ? latestIncident?.correlationId ?? 'NO_ACTIVE_INCIDENT'
          : Object.prototype.hasOwnProperty.call(known, fieldId) ? known[fieldId]! : null;
      const meaningfulAdvanceUnknown = fieldId === 'heartbeat-advance' && value === null;
      return Object.freeze({
        fieldId,
        label: fieldId.replaceAll('-', ' '),
        value,
        truthLabel: meaningfulAdvanceUnknown ? 'UNKNOWN' : value === null ? 'MISSING' : ownerTruthLabel,
        canonicalSource: surfaceId === 'notifications'
          ? `productIntegration.incident-router:${fieldId}`
          : `systemIntegration:${surfaceId}:${fieldId}`,
        unavailableReason: meaningfulAdvanceUnknown
          ? 'CANONICAL_MEANINGFUL_ADVANCE_NOT_PUBLISHED'
          : value === null ? 'CANONICAL_OWNER_FIELD_NOT_CONFIGURED' : null,
      } satisfies ProductRuntimeSurfaceDatum);
    });
    const requiredEvidence = evidence.filter((datum) => !isOptionalSurfaceDatum(surfaceId, datum.fieldId));
    const requiredEvidenceBlocker = productRuntimeSurfaceReadinessBlocker(surfaceId, evidence);
    const truthLabel = weakestSurfaceTruth([
      ownerTruthLabel,
      ...requiredEvidence.map((datum) => datum.truthLabel),
    ]);
    const blocked = requiredEvidenceBlocker !== null
      || REQUIRED_SURFACE_BLOCKING_TRUTH.has(truthLabel);
    const blockedSummary = requiredEvidenceBlocker
      ? `${SURFACE_LABELS[surfaceId]} required evidence ${requiredEvidenceBlocker.fieldId} is ${requiredEvidenceBlocker.truthLabel}.`
      : truthLabel === 'UNKNOWN'
        ? `${SURFACE_LABELS[surfaceId]} owner evidence is unknown.`
        : truthLabel === 'MISSING'
          ? `${SURFACE_LABELS[surfaceId]} owner evidence is missing.`
          : truthLabel === 'UNAVAILABLE'
            ? `${SURFACE_LABELS[surfaceId]} owner evidence is unavailable.`
            : truthLabel === 'BLOCKED'
              ? `${SURFACE_LABELS[surfaceId]} owner evidence is blocked.`
              : `${SURFACE_LABELS[surfaceId]} owner evidence is not configured.`;
    const blockedCode = requiredEvidenceBlocker
      ? `REQUIRED_EVIDENCE_${requiredEvidenceBlocker.truthLabel}:${requiredEvidenceBlocker.fieldId}`
      : truthLabel === 'UNKNOWN'
        ? 'CANONICAL_OWNER_UNKNOWN'
        : truthLabel === 'MISSING'
          ? 'CANONICAL_OWNER_MISSING'
          : truthLabel === 'UNAVAILABLE'
            ? 'CANONICAL_OWNER_UNAVAILABLE'
            : truthLabel === 'BLOCKED'
              ? 'CANONICAL_OWNER_BLOCKED'
              : 'CANONICAL_OWNER_NOT_CONFIGURED';
    result[surfaceId] = Object.freeze({
      surfaceId,
      label: SURFACE_LABELS[surfaceId],
      bindingState: blocked ? 'BLOCKED_BACKEND' : 'BINDING_READY',
      truthLabel,
      canonicalSource: ownerTruthSurface !== null
        ? `productIntegration owner-truth projection:${surfaceId}`
        : surfaceId === 'notifications'
        ? 'productIntegration incident-router projection'
        : `systemIntegration supervisor:${surfaceId}`,
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
  bootReleaseReadbackUnavailableReason?: 'BOOT_RELEASE_READBACK_NOT_CONFIGURED'
    | 'BOOT_RELEASE_READBACK_UNAVAILABLE'
    | null;
  materialEvents: Readonly<ProductRuntimeMaterialEventPage>;
  traces: readonly Readonly<ProductRuntimeCorrelationTrace>[];
  incidentSnapshot?: Readonly<ProductRuntimeIncidentSnapshot>;
  ownerTruthCut?: Readonly<ProductRuntimeOwnerTruthCut> | null;
  ownerTruthUnavailableReason?: ProductRuntimeOwnerTruthUnavailableReason | null;
  nowMs: number;
  commandOwner?: Readonly<ProductRuntimeCommandOwnerPort>;
}>): Readonly<ProductRuntimeSupervisorEnvelope> {
  if (!Number.isFinite(input.nowMs)) throw new TypeError('nowMs must be injected finite UTC milliseconds');
  if (typeof input.applicationStartOk !== 'boolean') throw new TypeError('applicationStartOk must be an injected boolean');
  const dashboard = cloneDashboard(input.snapshot);
  const projectedServiceReadinessPolicy = serviceReadinessPolicy(input.snapshot.serviceReadinessPolicy);
  const projectedComponents = components(input.snapshot, input.nowMs);
  const incidentSnapshot = projectProductRuntimeIncidentSnapshot(input.incidentSnapshot ?? Object.freeze({
    availability: Object.freeze({
      state: 'NOT_CONFIGURED',
      truthLabel: 'NOT_CONFIGURED',
      blocker: 'INCIDENT_OWNER_NOT_CONFIGURED',
    }),
    incidents: Object.freeze([]),
  }));
  const managedInventory = buildProductRuntimeManagedInventory(projectedComponents, incidentSnapshot.availability);
  const projectedEdges = edges(input.snapshot);
  const controls = buildProductRuntimeControlRegistry(input.snapshot, input.commandOwner);
  const bootReleaseReadback = projectProductRuntimeBootReleaseReadback(
    input.bootReleaseReadback,
    input.bootReleaseReadbackUnavailableReason ?? null,
  );
  const view = ownerView(
    input.snapshot,
    input.materialEvents,
    input.applicationStartOk,
    input.applicationStartFailureCodes ?? Object.freeze([]),
    bootReleaseReadback,
  );
  const canonicalCockpit = canonicalCockpitTruth(view, projectedComponents);
  const ownerTruth = projectProductRuntimeOwnerTruthBinding(
    input.ownerTruthCut ?? null,
    input.ownerTruthUnavailableReason ?? null,
    input.nowMs,
  );
  const projectedSurfaces = surfaces(
    input.snapshot,
    dashboard,
    view,
    input.materialEvents,
    controls.length,
    input.opsReadback,
    input.opsIntakeInterlock,
    incidentSnapshot,
    ownerTruth,
  );
  const incidentHighWater = incidentSnapshot.incidents.reduce(
    (maximum, incident) => Math.max(maximum, incident.ledgerEventId),
    0,
  );
  const incidentRevision = `${incidentSnapshot.availability.state.toLowerCase()}-${incidentSnapshot.incidents.length}-${incidentHighWater}`;
  // The browser invalidates its bounded snapshot from this revision, so a wired
  // owner-truth port must move it: a fresh account or market cut behind an
  // unchanged System revision would otherwise never reach the cockpit. An
  // unwired port leaves the canonical revision byte-identical.
  const ownerTruthRevision = ownerTruth === null ? '' : `-owner-${ownerTruth.revisionToken}`;
  const revision = `system-${input.snapshot.revision}-runtime-${input.snapshot.runtimeGeneration}-control-${input.snapshot.controlGeneration}-incident-${incidentRevision}${ownerTruthRevision}`;
  const body = {
    schemaVersion: PRODUCT_RUNTIME_SUPERVISOR_SCHEMA,
    revision,
    evaluatedAtMs: input.nowMs,
    truthLabel: productTruthLabel(input.snapshot.truthLabel),
    persistentSyntheticLabel: hasSyntheticEvidence(input),
    serviceReadinessPolicy: projectedServiceReadinessPolicy,
    firstRequiredReadinessBlockerComponentId: input.snapshot.firstRequiredReadinessBlockerComponentId,
    opsReadback: Object.freeze({ ...input.opsReadback }),
    opsIntakeInterlock: Object.freeze({
      ...input.opsIntakeInterlock,
      reasonCodes: Object.freeze([...input.opsIntakeInterlock.reasonCodes]),
    }),
    bootReleaseReadback,
    ownerView: view,
    canonicalCockpit,
    dashboard,
    components: projectedComponents,
    managedInventory,
    dependencyEdges: projectedEdges,
    controls,
    traces: Object.freeze([...input.traces]),
    incidentAvailability: incidentSnapshot.availability,
    incidents: incidentSnapshot.incidents,
    materialEvents: input.materialEvents,
    surfaces: projectedSurfaces,
  } as const;
  const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return Object.freeze({ ...body, digest: `sha256:${digest}` });
}
