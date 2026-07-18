import {
  evaluateFreshness,
  riskMaximumExactDecimal,
  type RuntimePhase,
} from '../../foundation/contracts/index.js';
import {
  SYSTEM_COMPONENT_IDS,
  type SystemComponentId,
  type SystemControlCommand,
  type SystemOwnerKind,
  type SystemReleaseStatus,
} from '../contracts/constants.js';
import type {
  SystemComponentSnapshot,
  SystemControlState,
  SystemTraceEvent,
} from '../contracts/types.js';
import { validateSystemComponentSnapshot } from '../contracts/validation.js';
import type {
  ManagedCompositionReadSnapshot,
  RuntimeHealthEvidence,
} from '../composition/types.js';
import type {
  LedgerSchemaCompatibilityReadback,
  SystemIntegrationCheckpointState,
} from '../persistence/types.js';
import {
  dependenciesFor,
  type SystemLedgerSummary,
  type SystemSupervisorSummaries,
} from '../supervisor/index.js';
import type { ValidateOnlyRunSnapshot } from '../verticalSlice/types.js';
import type {
  ApplicationComponentReadPorts,
  ApplicationOwnerSummaries,
} from './types.js';

interface ComponentMetadata {
  readonly owner: SystemOwnerKind;
  readonly ownerPath: string;
  readonly availableStatuses: readonly SystemReleaseStatus[];
  readonly unavailableStatuses: readonly SystemReleaseStatus[];
  readonly supportedControls: SystemComponentSnapshot['supportedControls'];
}

function statuses(...values: SystemReleaseStatus[]): readonly SystemReleaseStatus[] {
  return Object.freeze(values);
}

function controls(...values: SystemControlCommand[]): readonly SystemControlCommand[] {
  return Object.freeze(values);
}

const COMPONENT_METADATA: Readonly<Record<SystemComponentId, ComponentMetadata>> = Object.freeze({
  'public-spot-source': Object.freeze({
    owner: 'INTELLIGENCE_RUNTIME', ownerPath: 'server/src/intelligenceRuntime',
    availableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'WIRED'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'NOT_CONFIGURED'),
    supportedControls: controls('SET_PUBLIC_SOURCE_LIFECYCLE'),
  }),
  'public-usdm-source': Object.freeze({
    owner: 'INTELLIGENCE_RUNTIME', ownerPath: 'server/src/intelligenceRuntime',
    availableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'WIRED'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'NOT_CONFIGURED'),
    supportedControls: controls('SET_PUBLIC_SOURCE_LIFECYCLE'),
  }),
  'market-universe': Object.freeze({
    owner: 'AUDITED_APP', ownerPath: 'server/src/engine/marketData.ts',
    availableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'WIRED'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'WIRED'),
    supportedControls: controls('SET_COMPONENT_STATE', 'RESTART_COMPONENT'),
  }),
  'intelligence-runtime': Object.freeze({
    owner: 'INTELLIGENCE_RUNTIME', ownerPath: 'server/src/intelligenceRuntime',
    availableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'WIRED'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'NOT_CONFIGURED'),
    supportedControls: Object.freeze([]),
  }),
  'market-intelligence': Object.freeze({
    owner: 'MARKET_INTELLIGENCE', ownerPath: 'server/src/intelligenceFoundation',
    availableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'WIRED'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'NOT_CONFIGURED'),
    supportedControls: Object.freeze([]),
  }),
  'q-inference': Object.freeze({
    owner: 'Q_INFERENCE', ownerPath: 'quant/src/quant_edge/inference',
    availableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'NOT_CONFIGURED'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'NOT_CONFIGURED'),
    supportedControls: Object.freeze([]),
  }),
  'basis-engine': Object.freeze({
    owner: 'BASIS_ENGINE', ownerPath: 'server/src/engine/basis',
    availableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'WIRED'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'WIRED'),
    supportedControls: Object.freeze([]),
  }),
  'volume-engine': Object.freeze({
    owner: 'VOLUME_ENGINE', ownerPath: 'server/src/engine/volume',
    availableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'WIRED'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'WIRED'),
    supportedControls: Object.freeze([]),
  }),
  'capital-supervision': Object.freeze({
    owner: 'CAPITAL_SUPERVISION', ownerPath: 'server/src/capitalFoundation',
    availableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'WIRED', 'SYNTHETIC_ONLY'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'IMPORTED', 'BLOCKED'),
    supportedControls: controls('REVOKE_APPROVAL', 'REVOKE_RESERVATION'),
  }),
  'multileg-risk': Object.freeze({
    owner: 'BACKEND_FOUNDATION_RISK', ownerPath: 'server/src/foundation/risk',
    availableStatuses: statuses('BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'SYNTHETIC_ONLY', 'NOT_CONFIGURED'),
    supportedControls: Object.freeze([]),
  }),
  'execution-coordinator-validate-only': Object.freeze({
    owner: 'BACKEND_FOUNDATION_EXECUTION', ownerPath: 'server/src/foundation/execution',
    availableStatuses: statuses('BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'SYNTHETIC_ONLY', 'NOT_CONFIGURED'),
    supportedControls: Object.freeze([]),
  }),
  reconciliation: Object.freeze({
    owner: 'BACKEND_FOUNDATION_RECONCILIATION', ownerPath: 'server/src/foundation/reconciliation',
    availableStatuses: statuses('BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'SYNTHETIC_ONLY', 'NOT_CONFIGURED'),
    supportedControls: Object.freeze([]),
  }),
  'ledger-persistence': Object.freeze({
    owner: 'EXISTING_LEDGER', ownerPath: 'server/src/ledger.ts',
    availableStatuses: statuses('BUILT_AND_TESTED', 'WIRED'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'BLOCKED'),
    supportedControls: Object.freeze([]),
  }),
  'engine-supervisor': Object.freeze({
    owner: 'SYSTEM_INTEGRATION', ownerPath: 'server/src/systemIntegration',
    availableStatuses: statuses('BUILT_AND_TESTED', 'WIRED'),
    unavailableStatuses: statuses('BUILT_AND_TESTED', 'BLOCKED'),
    supportedControls: controls('SET_INTAKE_PAUSED', 'SET_SAFE_MODE', 'SET_KILL_SWITCH'),
  }),
});

/** Canonical component ownership readback for internal System Integration consumers. */
export function canonicalApplicationComponentOwner(componentId: SystemComponentId): SystemOwnerKind {
  return COMPONENT_METADATA[componentId].owner;
}

const PHYSICAL_COMPONENT_IDS = Object.freeze([
  'market-universe',
  'intelligence-runtime',
  'market-intelligence',
  'basis-engine',
  'volume-engine',
] as const);

export type PhysicalComponentId = (typeof PHYSICAL_COMPONENT_IDS)[number];

export type RuntimeHealthCache = Readonly<Partial<Record<PhysicalComponentId, Readonly<RuntimeHealthEvidence>>>>;

function unavailableComponent(
  componentId: SystemComponentId,
  blockerCode: string,
  phase: RuntimePhase = 'BLOCKED',
): Readonly<SystemComponentSnapshot> {
  const metadata = COMPONENT_METADATA[componentId];
  return Object.freeze({
    componentId,
    owner: metadata.owner,
    ownerPath: metadata.ownerPath,
    releaseStatuses: metadata.unavailableStatuses,
    truthLabel: 'UNAVAILABLE',
    desiredState: phase === 'STOPPED' ? 'STOPPED' : 'RUNNING',
    phase,
    domainObservedState: null,
    sourceLifecycle: null,
    readiness: phase === 'STOPPED' ? 'STOPPED' : phase === 'FAILED' ? 'FAILED' : 'BLOCKED',
    authority: 'UNAVAILABLE',
    completeness: 'UNAVAILABLE',
    sourceTimestamp: null,
    freshness: null,
    lastReceiveAtMs: null,
    lastProcessAtMs: null,
    lastSuccessAtMs: null,
    dependencies: dependenciesFor(componentId),
    queue: null,
    lastFailure: null,
    blockerCodes: Object.freeze([blockerCode]),
    generation: 0,
    restartCount: 0,
    supportedControls: metadata.supportedControls,
    capitalExposed: false,
    operatorAttentionRequired: phase !== 'STOPPED',
  });
}

function truthForHealth(
  health: Readonly<RuntimeHealthEvidence>,
  nowMs: number,
): Pick<SystemComponentSnapshot, 'truthLabel' | 'authority' | 'completeness' | 'freshness'> {
  if (!health.running || health.timestamp === null) {
    return { truthLabel: 'UNAVAILABLE', authority: 'UNAVAILABLE', completeness: 'UNAVAILABLE', freshness: null };
  }
  const freshness = evaluateFreshness(health.timestamp, nowMs);
  if (freshness.state !== 'FRESH') {
    return { truthLabel: 'UNAVAILABLE', authority: 'UNAVAILABLE', completeness: health.timestamp.completeness, freshness };
  }
  const truthLabel = health.timestamp.authority === 'RECORDED_REPLAY'
    ? 'RECORDED_REPLAY'
    : health.timestamp.authority === 'SYNTHETIC_TEST'
      ? 'SYNTHETIC_ONLY'
      : health.timestamp.authority === 'LIVE_PUBLIC' || health.timestamp.authority === 'DERIVED_LIVE'
        ? 'LIVE_PUBLIC'
        : 'UNAVAILABLE';
  return {
    truthLabel,
    authority: truthLabel === 'UNAVAILABLE' ? 'UNAVAILABLE' : health.timestamp.authority,
    completeness: health.timestamp.completeness,
    freshness,
  };
}

function physicalComponent(
  componentId: PhysicalComponentId,
  nowMs: number,
  managed: Readonly<ManagedCompositionReadSnapshot>,
  health: Readonly<RuntimeHealthEvidence> | undefined,
): Readonly<SystemComponentSnapshot> {
  const metadata = COMPONENT_METADATA[componentId];
  const runtime = managed.supervisor.components.find((entry) => entry.name === componentId);
  const adapter = managed.adapters.find((entry) => entry.componentId === componentId);
  const phase = runtime?.phase ?? 'STOPPED';
  if (health === undefined) {
    return unavailableComponent(componentId, 'RUNTIME_HEALTH_NOT_OBSERVED', phase);
  }
  const truth = truthForHealth(health, nowMs);
  const liveStatus = truth.truthLabel === 'LIVE_PUBLIC' ? ['LIVE_PUBLIC' as const] : [];
  const readiness = phase === 'FAILED'
    ? 'FAILED'
    : phase === 'STOPPED'
      ? 'STOPPED'
      : phase === 'VALIDATING' || phase === 'STARTING'
        ? 'WARMING'
        : truth.truthLabel === 'UNAVAILABLE'
          ? 'BLOCKED'
          : phase === 'DEGRADED'
            ? 'DEGRADED'
            : 'READY';
  const blockers = new Set<string>();
  if (!health.running && phase !== 'STOPPED') blockers.add('RUNTIME_NOT_RUNNING');
  if (health.timestamp === null) blockers.add('SOURCE_TIMESTAMP_UNAVAILABLE');
  if (truth.freshness !== null && truth.freshness.state !== 'FRESH') blockers.add(`SOURCE_${truth.freshness.state}`);
  // Foundation intentionally retains the last failure after recovery. Keep it
  // as historical evidence below, but only treat it as a current blocker while
  // the owning runtime is still in a non-running failure posture.
  if (runtime?.lastError && ['FAILED', 'DEGRADED', 'BLOCKED'].includes(phase)) {
    blockers.add(runtime.lastError.code);
  }
  if (health.fatal) blockers.add(health.fatal.code);
  return Object.freeze({
    componentId,
    owner: metadata.owner,
    ownerPath: metadata.ownerPath,
    releaseStatuses: Object.freeze([...metadata.availableStatuses, ...liveStatus]),
    truthLabel: truth.truthLabel,
    desiredState: managed.supervisor.desiredState,
    phase,
    domainObservedState: phase,
    sourceLifecycle: null,
    readiness,
    authority: truth.authority,
    completeness: truth.completeness,
    sourceTimestamp: health.timestamp ? Object.freeze({ ...health.timestamp }) : null,
    freshness: truth.freshness,
    lastReceiveAtMs: health.timestamp?.receivedAtMs ?? null,
    lastProcessAtMs: health.heartbeatAt,
    lastSuccessAtMs: health.running ? health.heartbeatAt : null,
    dependencies: dependenciesFor(componentId),
    queue: null,
    lastFailure: health.fatal ?? runtime?.lastError ?? null,
    blockerCodes: Object.freeze([...blockers].sort()),
    generation: adapter?.admittedGeneration ?? managed.supervisor.generation,
    restartCount: adapter?.restartCount ?? 0,
    supportedControls: metadata.supportedControls,
    capitalExposed: false,
    operatorAttentionRequired: readiness === 'BLOCKED' || readiness === 'DEGRADED' || readiness === 'FAILED',
  });
}

function passiveComponent(
  componentId: SystemComponentId,
  ports: ApplicationComponentReadPorts | undefined,
): Readonly<SystemComponentSnapshot> {
  const port = ports?.[componentId];
  if (!port) return unavailableComponent(componentId, 'OWNER_PROJECTION_NOT_WIRED');
  let candidate: Readonly<SystemComponentSnapshot> | null;
  try {
    candidate = port.readComponentSnapshot();
  } catch {
    return unavailableComponent(componentId, 'OWNER_PROJECTION_READ_FAILED');
  }
  if (candidate === null || candidate.componentId !== componentId) {
    return unavailableComponent(componentId, 'OWNER_PROJECTION_UNAVAILABLE');
  }
  const metadata = COMPONENT_METADATA[componentId];
  if ((componentId === 'capital-supervision') && (
    candidate.truthLabel === 'LIVE_PUBLIC'
    || candidate.releaseStatuses.includes('LIVE_PUBLIC')
  )) return unavailableComponent(componentId, 'PRIVATE_CAPITAL_LIVE_CLAIM_FORBIDDEN');
  if ((componentId === 'public-spot-source' || componentId === 'public-usdm-source'
      || componentId === 'intelligence-runtime' || componentId === 'market-intelligence')
      && candidate.authority === 'LIVE_PRIVATE') {
    return unavailableComponent(componentId, 'PRIVATE_SOURCE_AUTHORITY_FORBIDDEN');
  }
  const statuses = Object.freeze([
    ...new Set<SystemReleaseStatus>([
      ...metadata.availableStatuses,
      ...candidate.releaseStatuses.filter((status) => !['BLOCKED', 'NOT_CONFIGURED', 'MISSING'].includes(status)),
    ]),
  ]);
  const normalized: Readonly<SystemComponentSnapshot> = Object.freeze({
    ...candidate,
    componentId,
    owner: metadata.owner,
    ownerPath: metadata.ownerPath,
    releaseStatuses: statuses,
    dependencies: dependenciesFor(componentId),
    queue: candidate.queue ? Object.freeze({ ...candidate.queue }) : null,
    sourceTimestamp: candidate.sourceTimestamp ? Object.freeze({ ...candidate.sourceTimestamp }) : null,
    freshness: candidate.freshness ? Object.freeze({ ...candidate.freshness }) : null,
    lastFailure: candidate.lastFailure ? Object.freeze({ ...candidate.lastFailure }) : null,
    blockerCodes: Object.freeze([...candidate.blockerCodes]),
    supportedControls: metadata.supportedControls,
    capitalExposed: Boolean(candidate.capitalExposed),
  });
  return validateSystemComponentSnapshot(normalized).length === 0
    ? normalized
    : unavailableComponent(componentId, 'OWNER_PROJECTION_INVALID');
}

function dryRunComponent(
  componentId: Extract<SystemComponentId, 'capital-supervision' | 'multileg-risk' | 'execution-coordinator-validate-only' | 'reconciliation'>,
  run: Readonly<ValidateOnlyRunSnapshot> | null,
): Readonly<SystemComponentSnapshot> | null {
  if (run === null || run.disposition === 'MODE_BLOCKED' || run.disposition === 'PERSISTENCE_FAILED') return null;
  const metadata = COMPONENT_METADATA[componentId];
  const hasRisk = run.riskVerdict !== null;
  const hasExecution = run.executionPlan !== null && run.executionState !== null;
  const hasReconciliation = run.reconciliation !== null;
  const available = componentId === 'capital-supervision'
    || (componentId === 'multileg-risk' && hasRisk)
    || (componentId === 'execution-coordinator-validate-only' && hasExecution)
    || (componentId === 'reconciliation' && hasReconciliation);
  if (!available) return null;
  const state = componentId === 'capital-supervision'
    ? run.capitalReservationDialect
    : componentId === 'multileg-risk'
      ? run.riskVerdict?.decision ?? 'UNAVAILABLE'
      : componentId === 'execution-coordinator-validate-only'
        ? run.executionState?.lifecycle ?? run.disposition
        : run.reconciliation?.status ?? run.disposition;
  const domainBlocked = componentId === 'reconciliation'
    ? run.reconciliation?.status !== 'EXACT'
    : componentId === 'execution-coordinator-validate-only'
      ? run.disposition === 'EXECUTION_PREFLIGHT_REJECTED'
      : componentId === 'multileg-risk'
        ? run.riskVerdict?.allowed === false
        : false;
  const blockerCodes = domainBlocked
    ? componentId === 'multileg-risk' && run.riskVerdict
      ? Object.freeze([...run.riskVerdict.blockingCodes])
      : Object.freeze([run.failure?.code ?? `${componentId.replaceAll('-', '_').toUpperCase()}_BLOCKED`])
    : Object.freeze([] as string[]);
  return Object.freeze({
    componentId,
    owner: metadata.owner,
    ownerPath: metadata.ownerPath,
    releaseStatuses: metadata.availableStatuses,
    truthLabel: componentId === 'capital-supervision' ? 'SYNTHETIC_ONLY' : 'DRY_RUN',
    desiredState: 'RUNNING',
    phase: domainBlocked ? 'DEGRADED' : 'RUNNING',
    domainObservedState: state,
    sourceLifecycle: null,
    readiness: domainBlocked ? 'DEGRADED' : 'READY',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimestamp: null,
    freshness: null,
    lastReceiveAtMs: null,
    lastProcessAtMs: run.evaluatedAtMs,
    lastSuccessAtMs: run.evaluatedAtMs,
    dependencies: dependenciesFor(componentId),
    queue: null,
    lastFailure: domainBlocked ? run.failure : null,
    blockerCodes,
    generation: 1,
    restartCount: 0,
    supportedControls: metadata.supportedControls,
    capitalExposed: false,
    operatorAttentionRequired: domainBlocked,
  });
}

function ledgerComponent(
  checkpoint: Readonly<SystemIntegrationCheckpointState> | null,
  persistenceFailureCode: string | null,
): Readonly<SystemComponentSnapshot> {
  if (checkpoint === null) return unavailableComponent('ledger-persistence', persistenceFailureCode ?? 'PERSISTENCE_NOT_LOADED', 'FAILED');
  const metadata = COMPONENT_METADATA['ledger-persistence'];
  return Object.freeze({
    ...unavailableComponent('ledger-persistence', 'PERSISTENCE_NOT_LOADED'),
    releaseStatuses: metadata.availableStatuses,
    truthLabel: 'RECORDED_REPLAY',
    desiredState: 'RUNNING',
    phase: 'RUNNING',
    domainObservedState: `CHECKPOINT_REVISION_${checkpoint.revision}`,
    readiness: 'READY',
    authority: 'RECORDED_REPLAY',
    completeness: 'COMPLETE',
    lastProcessAtMs: checkpoint.lastStartup?.startedAtMs ?? null,
    lastSuccessAtMs: checkpoint.lastStartup?.startedAtMs ?? null,
    blockerCodes: Object.freeze([]),
    generation: checkpoint.generation,
    operatorAttentionRequired: false,
  });
}

function supervisorComponent(
  managed: Readonly<ManagedCompositionReadSnapshot>,
  control: Readonly<SystemControlState>,
  failureCode: string | null,
  postureBlockerCodes: readonly string[],
): Readonly<SystemComponentSnapshot> {
  const metadata = COMPONENT_METADATA['engine-supervisor'];
  const failed = failureCode !== null || managed.driverFailureCode !== null || managed.supervisor.phase === 'FAILED';
  const postureBlocked = postureBlockerCodes.length > 0;
  return Object.freeze({
    ...unavailableComponent('engine-supervisor', failureCode ?? managed.driverFailureCode ?? 'SUPERVISOR_NOT_STARTED'),
    releaseStatuses: failed ? metadata.unavailableStatuses : metadata.availableStatuses,
    truthLabel: failed ? 'UNAVAILABLE' : 'UNKNOWN',
    desiredState: managed.supervisor.desiredState,
    phase: failed ? 'FAILED' : managed.supervisor.phase,
    domainObservedState: managed.supervisor.phase,
    readiness: failed ? 'FAILED' : managed.supervisor.phase === 'RUNNING' ? 'DEGRADED' : managed.supervisor.phase === 'STOPPED' ? 'STOPPED' : 'WARMING',
    authority: failed ? 'UNAVAILABLE' : 'DERIVED_LIVE',
    completeness: failed ? 'UNAVAILABLE' : 'COMPLETE',
    lastProcessAtMs: managed.lastDriveAtMs,
    lastSuccessAtMs: failed ? null : managed.lastDriveAtMs,
    blockerCodes: failed
      ? Object.freeze([failureCode ?? managed.driverFailureCode ?? 'SUPERVISOR_FAILED', ...postureBlockerCodes])
      : Object.freeze([...postureBlockerCodes]),
    generation: control.generation,
    supportedControls: metadata.supportedControls,
    operatorAttentionRequired: failed || postureBlocked,
  });
}

export interface BuildApplicationComponentsInput {
  readonly nowMs: number;
  readonly managed: Readonly<ManagedCompositionReadSnapshot>;
  readonly health: RuntimeHealthCache;
  readonly ports?: ApplicationComponentReadPorts;
  readonly checkpoint: Readonly<SystemIntegrationCheckpointState> | null;
  readonly persistenceFailureCode: string | null;
  readonly applicationFailureCode: string | null;
  readonly postureBlockerCodes: readonly string[];
  readonly control: Readonly<SystemControlState>;
  readonly validateOnlyRun: Readonly<ValidateOnlyRunSnapshot> | null;
}

export function buildApplicationComponents(
  input: Readonly<BuildApplicationComponentsInput>,
): readonly Readonly<SystemComponentSnapshot>[] {
  const physical = new Set<SystemComponentId>(PHYSICAL_COMPONENT_IDS);
  const dry = new Set<SystemComponentId>([
    'capital-supervision', 'multileg-risk', 'execution-coordinator-validate-only', 'reconciliation',
  ]);
  return Object.freeze(SYSTEM_COMPONENT_IDS.map((componentId) => {
    if (physical.has(componentId)) {
      return physicalComponent(
        componentId as PhysicalComponentId,
        input.nowMs,
        input.managed,
        input.health[componentId as PhysicalComponentId],
      );
    }
    if (componentId === 'ledger-persistence') return ledgerComponent(input.checkpoint, input.persistenceFailureCode);
    if (componentId === 'engine-supervisor') {
      return supervisorComponent(
        input.managed,
        input.control,
        input.applicationFailureCode,
        input.postureBlockerCodes,
      );
    }
    if (dry.has(componentId)) {
      const projected = dryRunComponent(
        componentId as 'capital-supervision' | 'multileg-risk' | 'execution-coordinator-validate-only' | 'reconciliation',
        input.validateOnlyRun,
      );
      if (projected) return projected;
    }
    return passiveComponent(componentId, input.ports);
  }));
}

function unavailableStrategy() {
  return Object.freeze({
    truthLabel: 'UNAVAILABLE' as const,
    heartbeatAtMs: null, candidateCount: null, proposalCount: null,
    rejectionCount: null, acceptedCount: null, lastDecisionAtMs: null,
    sourceRevision: null,
  });
}

type ProjectedLedgerSchemaCompatibility = Pick<
  SystemLedgerSummary,
  'schemaCompatibilityState' | 'schemaCompatibilityReason' | 'currentSchemaVersion' | 'rollbackFloor'
>;

function projectLedgerSchemaCompatibility(
  input: Readonly<LedgerSchemaCompatibilityReadback> | null | undefined,
): Readonly<ProjectedLedgerSchemaCompatibility> {
  const malformed = (): Readonly<ProjectedLedgerSchemaCompatibility> => Object.freeze({
    schemaCompatibilityState: 'MALFORMED',
    schemaCompatibilityReason: 'LEDGER_SCHEMA_COMPATIBILITY_READBACK_MALFORMED',
    currentSchemaVersion: null,
    rollbackFloor: null,
  });
  if (input === null) {
    return Object.freeze({
      schemaCompatibilityState: 'UNAVAILABLE',
      schemaCompatibilityReason: 'LEDGER_SCHEMA_COMPATIBILITY_READBACK_UNAVAILABLE',
      currentSchemaVersion: null,
      rollbackFloor: null,
    });
  }
  try {
    if (typeof input !== 'object' || Array.isArray(input)
        || Object.getPrototypeOf(input) !== Object.prototype
        || Object.getOwnPropertySymbols(input).length !== 0) return malformed();
    const actualKeys = Object.keys(input).sort();
    const expectedKeys = ['currentSchemaVersion', 'reasonCode', 'rollbackFloor', 'state'];
    if (actualKeys.length !== expectedKeys.length
        || actualKeys.some((key, index) => key !== expectedKeys[index])) return malformed();
    const validState = ['AVAILABLE', 'UNAVAILABLE', 'MALFORMED', 'MISMATCH'].includes(input.state);
    const validReason = input.reasonCode === null
      || (typeof input.reasonCode === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(input.reasonCode));
    const validAvailable = input.state === 'AVAILABLE'
      && Number.isSafeInteger(input.currentSchemaVersion)
      && (input.currentSchemaVersion as number) >= 1
      && Number.isSafeInteger(input.rollbackFloor)
      && (input.rollbackFloor as number) >= 0
      && (input.rollbackFloor as number) <= (input.currentSchemaVersion as number)
      && input.reasonCode === null;
    const validFailure = input.state !== 'AVAILABLE'
      && input.currentSchemaVersion === null
      && input.rollbackFloor === null
      && typeof input.reasonCode === 'string'
      && validReason;
    if (!validState || (!validAvailable && !validFailure)) return malformed();
    return Object.freeze({
      schemaCompatibilityState: input.state,
      schemaCompatibilityReason: input.reasonCode,
      currentSchemaVersion: validAvailable ? input.currentSchemaVersion : null,
      rollbackFloor: validAvailable ? input.rollbackFloor : null,
    });
  } catch {
    return malformed();
  }
}

export function defaultApplicationSummaries(
  checkpoint: Readonly<SystemIntegrationCheckpointState> | null,
  ledgerWritable: boolean | null,
  ledgerSchemaCompatibility: Readonly<LedgerSchemaCompatibilityReadback> | null = null,
): Readonly<SystemSupervisorSummaries> {
  const schemaCompatibility = projectLedgerSchemaCompatibility(ledgerSchemaCompatibility);
  return Object.freeze({
    sourceCoverage: Object.freeze({
      truthLabel: 'UNAVAILABLE', universeSymbols: null, spotCoveredSymbols: null,
      usdMCoveredSymbols: null, quietSymbolsRetained: null, materialGapCount: null,
      rateLimitedSourceCount: null, lastMaterialGapAtMs: null,
    }),
    strategies: Object.freeze({ basis: unavailableStrategy(), volume: unavailableStrategy() }),
    intelligence: Object.freeze({
      truthLabel: 'UNAVAILABLE', evidenceCount: null, attentionCount: null,
      focusRequestedCount: null, focusActiveCount: null, thesisCount: null,
      insufficientEvidenceCount: null, lastUpdateAtMs: null,
    }),
    capital: Object.freeze({
      truthLabel: 'UNAVAILABLE', accountTruthState: 'UNAVAILABLE', allocatableAmount: null,
      reservedAmount: null, activeExposureAmount: null, eligibleCount: null,
      reservationCount: null, stagedMandateCount: null, activeExposureCount: null,
      checkpointRevision: null, blockerCodes: Object.freeze(['CAPITAL_OWNER_RECORD_UNAVAILABLE']),
    }),
    risk: Object.freeze({
      truthLabel: 'UNAVAILABLE', latestVerdict: 'UNAVAILABLE', latestVerdictAtMs: null,
      latestVerdictId: null, correlationId: null, maxAllowedSize: null,
      requiredConfirmation: null, decisiveInputSnapshot: Object.freeze([]),
      rejectionCount: null, reasonCodes: Object.freeze([]),
    }),
    execution: Object.freeze({
      truthLabel: 'UNAVAILABLE', mode: 'UNAVAILABLE', barrier: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
      planId: null, planLifecycle: null, coordinatorState: 'UNAVAILABLE', legCount: null,
      recoveryState: null, lastTransitionAtMs: null,
    }),
    reconciliation: Object.freeze({
      truthLabel: 'UNAVAILABLE', status: 'UNAVAILABLE', blocksNewExposure: true,
      recommendation: null, checkpointId: null, evaluatedAtMs: null,
      reasonCodes: Object.freeze(['RECONCILIATION_TRUTH_UNAVAILABLE']),
    }),
    ledger: Object.freeze({
      truthLabel: checkpoint && schemaCompatibility.schemaCompatibilityState === 'AVAILABLE'
        ? 'RECORDED_REPLAY'
        : 'UNAVAILABLE',
      writable: ledgerWritable,
      ...schemaCompatibility,
      lastEventId: null,
      lastPersistedAtMs: checkpoint?.lastShutdown?.stoppedAtMs ?? checkpoint?.lastStartup?.startedAtMs ?? null,
      checkpointRevision: checkpoint ? String(checkpoint.revision) : null,
      recentTraceCount: checkpoint?.traceIndex.length ?? null,
      lastCleanShutdownAtMs: checkpoint?.lastShutdown?.clean ? checkpoint.lastShutdown.stoppedAtMs : null,
    }),
  });
}

export function mergeApplicationSummaries(
  defaults: Readonly<SystemSupervisorSummaries>,
  owner: ApplicationOwnerSummaries | null,
  run: Readonly<ValidateOnlyRunSnapshot> | null,
): Readonly<SystemSupervisorSummaries> {
  const sourceCoverage = owner?.sourceCoverage ?? defaults.sourceCoverage;
  const strategies = owner?.strategies ?? defaults.strategies;
  const intelligence = owner?.intelligence ?? defaults.intelligence;
  let capital = owner?.capital ?? defaults.capital;
  let risk = defaults.risk;
  let execution = defaults.execution;
  let reconciliation = defaults.reconciliation;
  if (run && run.disposition !== 'MODE_BLOCKED' && run.disposition !== 'PERSISTENCE_FAILED') {
    capital = Object.freeze({
      truthLabel: 'SYNTHETIC_ONLY', accountTruthState: 'SYNTHETIC_FIXTURE',
      allocatableAmount: null, reservedAmount: null, activeExposureAmount: null,
      eligibleCount: 1, reservationCount: 1, stagedMandateCount: 1,
      activeExposureCount: 0, checkpointRevision: null, blockerCodes: Object.freeze([]),
    });
    risk = run.riskVerdict ? Object.freeze({
      truthLabel: 'DRY_RUN', latestVerdict: run.riskVerdict.decision === 'APPROVED'
        ? 'APPROVE' as const
        : run.riskVerdict.decision === 'REJECTED'
          ? 'REJECT' as const
          : 'NEEDS_REVIEW' as const,
      latestVerdictAtMs: run.riskVerdict.evaluatedAt, latestVerdictId: run.recordId,
      correlationId: run.riskVerdict.correlationId,
      maxAllowedSize: riskMaximumExactDecimal(run.riskVerdict.maxAllowedSize),
      requiredConfirmation: run.riskVerdict.requiredConfirmation,
      decisiveInputSnapshot: Object.freeze(run.riskVerdict.decisiveInputSnapshot.checks.map((check) => Object.freeze({
        code: check.code,
        status: check.status,
        detail: check.detail,
        observed: check.observed === null ? null : String(check.observed),
        limit: check.limit === null ? null : String(check.limit),
        evidenceTimestamp: check.evidenceTimestamp,
      }))),
      rejectionCount: run.riskVerdict.decision === 'REJECTED' ? 1 : 0,
      reasonCodes: Object.freeze([...run.riskVerdict.blockingCodes]),
    }) : defaults.risk;
    execution = run.executionState ? Object.freeze({
      truthLabel: 'DRY_RUN', mode: 'VALIDATE_ONLY', barrier: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
      planId: run.executionPlan?.planId ?? null, planLifecycle: run.executionState.lifecycle,
      coordinatorState: run.executionState.lifecycle, legCount: 2,
      recoveryState: run.executionState.exposedSinceMs === null ? null : 'RECONCILIATION_REQUIRED',
      lastTransitionAtMs: run.executionState.updatedAtMs,
    }) : defaults.execution;
    reconciliation = run.reconciliation ? Object.freeze({
      truthLabel: 'DRY_RUN', status: run.reconciliation.status,
      blocksNewExposure: run.reconciliation.status !== 'EXACT',
      recommendation: run.reconciliation.recommendation,
      checkpointId: run.persistenceId,
      evaluatedAtMs: run.reconciliation.evaluatedAtMs,
      reasonCodes: Object.freeze([...new Set(run.reconciliation.reasons.map((reason) => reason.code))]),
    }) : defaults.reconciliation;
  }
  return Object.freeze({
    sourceCoverage,
    strategies,
    intelligence,
    capital,
    risk,
    execution,
    reconciliation,
    ledger: defaults.ledger,
  });
}

export function uniqueTraceEvents(
  sources: readonly (readonly Readonly<SystemTraceEvent>[])[],
): readonly Readonly<SystemTraceEvent>[] {
  const events = new Map<string, Readonly<SystemTraceEvent>>();
  for (const source of sources) {
    for (const event of source) if (!events.has(event.id)) events.set(event.id, event);
  }
  return Object.freeze([...events.values()].sort((left, right) => (
    left.occurredAtMs - right.occurredAtMs
    || left.sequence - right.sequence
    || left.id.localeCompare(right.id)
  )));
}
