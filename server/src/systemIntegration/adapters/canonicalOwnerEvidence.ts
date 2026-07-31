/**
 * Production-only L06/L12/L13/L14 owner-evidence composition.
 *
 * This adapter reads canonical owners and publishes bounded evidence through
 * the existing System Integration trace seam. It owns no position book,
 * topology, command path, cache, recovery planner, socket, or strategy truth.
 */
import {
  canonicalJson,
  isValidUtcMillis,
  stableHash128Hex,
} from '../../foundation/contracts/index.js';
import {
  CANONICAL_SYSTEM_COMPONENT_IDS,
  MACHINE_GRAPH_CONTROL_ACTIONS,
  MACHINE_GRAPH_ROLES,
  type MachineGraphControlAction,
  type MachineGraphRole,
} from '../../liveEdge/adapters/machineGraphEvidence/index.js';
import type {
  LiveEdgeControlProductionBinding,
  LiveEdgeMutationJournalInventory,
} from '../persistence/index.js';
import { LiveEdgeMutationJournalAdapterError } from '../persistence/index.js';
import {
  SYSTEM_COMPONENT_IDS,
  type SystemComponentId,
  type SystemTraceEventKind,
  type SystemTruthLabel,
} from '../contracts/constants.js';
import type {
  SystemComponentSnapshot,
  SystemTraceEvent,
} from '../contracts/types.js';
import {
  validateSystemComponentSnapshot,
  validateSystemTraceEvent,
} from '../contracts/validation.js';
import type {
  ApplicationComponentReadPorts,
  ApplicationTraceReadPort,
} from '../application/types.js';
import type { UtcClock } from '../composition/types.js';
import {
  createPassiveOwnerEvidenceReadPort,
  type PassiveL13AlarmEvidence,
  type PassiveL13MetricEvidence,
  type PassiveProductAssuranceEvidence,
} from './passiveOwnerEvidence.js';

export const CANONICAL_OWNER_EVIDENCE_SCHEMA =
  'SYSTEM_INTEGRATION_CANONICAL_OWNER_EVIDENCE_V1' as const;
export const CANONICAL_OWNER_EVIDENCE_CORRELATION_ID =
  'canonical-owner-evidence-production' as const;

export interface CanonicalMutationJournalInventoryPort {
  inspectInventory(): Readonly<LiveEdgeMutationJournalInventory>;
}

export interface CanonicalOwnerEvidenceOptions {
  readonly clock: UtcClock;
  readonly components: ApplicationComponentReadPorts;
  readonly mutationJournal: CanonicalMutationJournalInventoryPort;
  readonly liveEdgeControl: Readonly<LiveEdgeControlProductionBinding>;
}

export interface CanonicalL06Evidence {
  readonly wiringState: 'WIRED';
  readonly persistenceOwner: 'SYSTEM_INTEGRATION_LEDGER';
  readonly inventoryState: 'EMPTY' | 'AVAILABLE' | 'PERSISTENCE_CORRUPT' | 'PERSISTENCE_UNAVAILABLE';
  readonly journalCount: number | null;
  readonly entryCount: number | null;
  readonly highestJournalVersion: number | null;
  readonly reconstructionProven: boolean;
  readonly reasonCodes: readonly string[];
  readonly sendAuthorized: false;
  readonly externalActionAuthorization: 'NONE';
}

export interface CanonicalL12OwnerAvailability {
  readonly owner: 'CAPITAL_FOUNDATION' | 'FOUNDATION_RISK' | 'FOUNDATION_EXECUTION'
    | 'FOUNDATION_RECONCILIATION' | 'SYSTEM_INTEGRATION_LEDGER';
  readonly state: 'AVAILABLE' | 'EMPTY' | 'UNAVAILABLE' | 'UNKNOWN';
  readonly ownerRevision: string | null;
  readonly observedAtMs: number | null;
  readonly reasonCodes: readonly string[];
}

export interface CanonicalL12Evidence {
  readonly sourcePath: 'server/src/liveEdge/adapters/exposureRecoveryProjection';
  readonly wiringState: 'OWNER_AVAILABILITY_COMPOSED';
  readonly acceptedProjectionState: 'NOT_INVOKED_NO_CANONICAL_SUBJECT';
  readonly acceptedProjectionInvoked: false;
  readonly truthLabel: 'UNAVAILABLE';
  readonly projectionState: 'UNKNOWN';
  readonly privateTruthState: 'OWNER_GATED';
  readonly coldStartPosture: 'HALTED';
  readonly effectiveEntryMode: 'BLOCKED';
  readonly subjectState: 'UNKNOWN';
  readonly subject: null;
  readonly accountingScopeId: null;
  readonly capitalExposed: null;
  readonly activeExposureAmount: null;
  readonly ownerAvailability: readonly Readonly<CanonicalL12OwnerAvailability>[];
  readonly reasonCodes: readonly string[];
  readonly syntheticInputAccepted: false;
  readonly authorityGranted: false;
  readonly controlAuthority: 'NONE_RECORD_ONLY';
  readonly readinessAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface CanonicalL13RoleEvidence {
  readonly role: MachineGraphRole;
  readonly bindingState: 'BOUND' | 'OWNER_GATED' | 'MISSING';
  readonly componentIds: readonly SystemComponentId[];
  readonly evidenceState: 'OBSERVED' | 'UNAVAILABLE' | 'UNKNOWN' | 'OWNER_GATED' | 'MISSING';
  readonly truthLabel: SystemTruthLabel;
  readonly ownerRevision: string | null;
  readonly observedAtMs: number | null;
  readonly reasonCodes: readonly string[];
}

export interface CanonicalL13ControlEvidence {
  readonly action: MachineGraphControlAction;
  readonly implementationState: 'PROVEN_CONTROL_PLANE_RUNTIME_ONLY' | 'CONTRACT_ONLY';
  readonly persistenceState: 'AVAILABLE' | 'OWNER_GATED';
  readonly availability: 'UNAVAILABLE';
  readonly reasonCodes: readonly string[];
}

export interface CanonicalL13Evidence {
  readonly sourcePath: 'server/src/liveEdge/adapters/machineGraphEvidence';
  readonly wiringState: 'ROLE_BINDINGS_COMPOSED';
  readonly acceptedProjectionState: 'NOT_INVOKED_NO_VALIDATED_L12_BINDING';
  readonly acceptedProjectionInvoked: false;
  readonly truthLabel: 'UNKNOWN';
  readonly graphState: 'UNKNOWN';
  readonly roles: readonly Readonly<CanonicalL13RoleEvidence>[];
  readonly metrics: readonly Readonly<PassiveL13MetricEvidence>[];
  readonly alarms: readonly Readonly<PassiveL13AlarmEvidence>[];
  readonly controls: readonly Readonly<CanonicalL13ControlEvidence>[];
  readonly reasonCodes: readonly string[];
  readonly topologyAuthority: 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY';
  readonly firstRootSelectionAuthority: 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY';
  readonly observabilityOwner: 'FOUNDATION_OBSERVABILITY';
  readonly rootCauseAuthority: 'NONE_RECORD_ONLY';
  readonly readinessAuthority: 'NONE_RECORD_ONLY';
  readonly controlAuthority: 'NONE_RECORD_ONLY';
  readonly alarmAuthority: 'NONE_RECORD_ONLY';
  readonly automaticActionAuthorization: 'NONE';
  readonly externalActionAuthorization: 'NONE';
}

export interface CanonicalOwnerEvidenceSnapshot {
  readonly schema: typeof CANONICAL_OWNER_EVIDENCE_SCHEMA;
  readonly version: 1;
  readonly projectionRevision: string;
  readonly evaluatedAtMs: number;
  readonly l06: Readonly<CanonicalL06Evidence>;
  readonly l12: Readonly<CanonicalL12Evidence>;
  readonly l13: Readonly<CanonicalL13Evidence>;
  readonly l14: Readonly<Pick<LiveEdgeControlProductionBinding,
    'wiringState' | 'activationState' | 'persistenceOwner' | 'controlOwner'
    | 'configurationVersionOwner' | 'reasonCodes' | 'commandDispatchAvailable'
    | 'externalActionAuthorization'>>;
  readonly productAssurance: Readonly<PassiveProductAssuranceEvidence>;
  readonly aggregationAuthority: 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY';
  readonly controlAuthority: 'NONE';
  readonly readinessAuthority: 'NONE';
  readonly externalActionAuthorization: 'NONE';
}

export interface CanonicalOwnerEvidenceReadPort extends ApplicationTraceReadPort {
  readCanonicalOwnerEvidence(): Readonly<CanonicalOwnerEvidenceSnapshot>;
}

function componentIds(...values: SystemComponentId[]): readonly SystemComponentId[] {
  return Object.freeze(values);
}

const COMPONENTS_BY_ROLE: Readonly<Partial<Record<MachineGraphRole, readonly SystemComponentId[]>>> =
  Object.freeze({
    SPOT_PUBLIC_STREAM: componentIds('public-spot-source'),
    USD_M_PUBLIC_STREAM: componentIds('public-usdm-source'),
    INSTRUMENT_FILTER_REGISTRY: componentIds('market-universe'),
    EVIDENCE_ATTENTION_RUNTIME: componentIds('intelligence-runtime', 'market-intelligence'),
    BASIS_ENGINE: componentIds('basis-engine'),
    VOLUME_ENGINE: componentIds('volume-engine'),
    CAPITAL_GATE: componentIds('capital-supervision'),
    RISK_GATE: componentIds('multileg-risk'),
    EXECUTION_HAND: componentIds('execution-coordinator-validate-only'),
    RECONCILIATION: componentIds('reconciliation'),
    LEDGER_READ_MODEL: componentIds('ledger-persistence'),
  });

const OWNER_GATED_ROLES = new Set<MachineGraphRole>([
  'SECRETS_BOUNDARY',
  'CLOCK_SYNCHRONIZATION',
  'SPOT_PRIVATE_STREAM',
  'USD_M_PRIVATE_STREAM',
  'MARGIN_PRIVATE_STREAM',
  'ACCOUNT_TRUTH',
  'QUANT_BRIDGE',
  'PROPOSAL_REJECTION_AUTHORITY',
  'BASIS_COORDINATOR',
  'VOLUME_LIFECYCLE',
  'EXPOSURE_POSITION_SUPERVISOR',
  'OUTCOME_QUANT_FEEDBACK',
  'DATABASE',
]);

const TRACE_KIND_BY_COMPONENT: Readonly<Record<SystemComponentId, SystemTraceEventKind>> =
  Object.freeze({
    'public-spot-source': 'SOURCE',
    'public-usdm-source': 'SOURCE',
    'market-universe': 'SOURCE',
    'intelligence-runtime': 'INTELLIGENCE',
    'market-intelligence': 'INTELLIGENCE',
    'q-inference': 'INTELLIGENCE',
    'basis-engine': 'STRATEGY',
    'volume-engine': 'STRATEGY',
    'capital-supervision': 'CAPITAL',
    'multileg-risk': 'RISK',
    'execution-coordinator-validate-only': 'EXECUTION',
    reconciliation: 'RECONCILIATION',
    'ledger-persistence': 'PERSISTENCE',
    'engine-supervisor': 'SUPERVISOR',
  });

function validateStaticBinding(): void {
  const acceptedIds = [...CANONICAL_SYSTEM_COMPONENT_IDS];
  const integrationIds = SYSTEM_COMPONENT_IDS.filter((componentId) => componentId !== 'q-inference');
  if (canonicalJson(acceptedIds) !== canonicalJson(integrationIds)) {
    throw new TypeError('L13 accepted component catalog diverges from System Integration');
  }
  const boundIds = MACHINE_GRAPH_ROLES.flatMap((role) => [...(COMPONENTS_BY_ROLE[role] ?? [])]);
  if (MACHINE_GRAPH_ROLES.length !== 27
      || boundIds.length !== 12
      || new Set(boundIds).size !== boundIds.length
      || boundIds.some((componentId) => !acceptedIds.includes(componentId as never))) {
    throw new TypeError('L13 production role binding is not the accepted exact canonical mapping');
  }
  const counts = MACHINE_GRAPH_ROLES.reduce((result, role) => {
    if ((COMPONENTS_BY_ROLE[role]?.length ?? 0) > 0) result.bound += 1;
    else if (OWNER_GATED_ROLES.has(role)) result.ownerGated += 1;
    else result.missing += 1;
    return result;
  }, { bound: 0, ownerGated: 0, missing: 0 });
  if (counts.bound !== 11 || counts.ownerGated !== 13 || counts.missing !== 3) {
    throw new TypeError('L13 production role binding state counts diverge from accepted evidence');
  }
}

validateStaticBinding();

function readComponent(
  ports: ApplicationComponentReadPorts,
  componentId: SystemComponentId,
): Readonly<SystemComponentSnapshot> | null {
  const port = ports[componentId];
  if (port === undefined) return null;
  try {
    const snapshot = port.readComponentSnapshot();
    if (snapshot === null || snapshot.componentId !== componentId
        || validateSystemComponentSnapshot(snapshot).length > 0) return null;
    return snapshot;
  } catch {
    return null;
  }
}

function combinedTruth(snapshots: readonly Readonly<SystemComponentSnapshot>[]): SystemTruthLabel {
  const truths = new Set(snapshots.map((snapshot) => snapshot.truthLabel));
  if (truths.has('UNAVAILABLE')) return 'UNAVAILABLE';
  if (truths.has('UNKNOWN')) return 'UNKNOWN';
  if (truths.has('SYNTHETIC_ONLY')) return 'SYNTHETIC_ONLY';
  if (truths.has('DRY_RUN')) return 'DRY_RUN';
  if (truths.has('RECORDED_REPLAY')) return 'RECORDED_REPLAY';
  return truths.size === 1 && truths.has('LIVE_PUBLIC') ? 'LIVE_PUBLIC' : 'UNKNOWN';
}

function roleEvidence(
  components: ApplicationComponentReadPorts,
): readonly Readonly<CanonicalL13RoleEvidence>[] {
  return Object.freeze(MACHINE_GRAPH_ROLES.map((role) => {
    const componentIds = Object.freeze([...(COMPONENTS_BY_ROLE[role] ?? [])]);
    if (componentIds.length === 0) {
      const ownerGated = OWNER_GATED_ROLES.has(role);
      return Object.freeze({
        role,
        bindingState: ownerGated ? 'OWNER_GATED' as const : 'MISSING' as const,
        componentIds,
        evidenceState: ownerGated ? 'OWNER_GATED' as const : 'MISSING' as const,
        truthLabel: 'UNAVAILABLE' as const,
        ownerRevision: null,
        observedAtMs: null,
        reasonCodes: Object.freeze([ownerGated
          ? 'ROLE_OWNER_AUTHORIZATION_REQUIRED'
          : 'CANONICAL_COMPONENT_BINDING_MISSING']),
      });
    }
    const snapshots = componentIds
      .map((componentId) => readComponent(components, componentId))
      .filter((snapshot): snapshot is Readonly<SystemComponentSnapshot> => snapshot !== null);
    if (snapshots.length !== componentIds.length) {
      return Object.freeze({
        role,
        bindingState: 'BOUND' as const,
        componentIds,
        evidenceState: 'UNKNOWN' as const,
        truthLabel: 'UNKNOWN' as const,
        ownerRevision: null,
        observedAtMs: null,
        reasonCodes: Object.freeze(['CANONICAL_COMPONENT_EVIDENCE_NOT_EXPOSED_TO_PROBE']),
      });
    }
    const observedTimes = snapshots.flatMap((snapshot) => [
      snapshot.lastReceiveAtMs,
      snapshot.lastProcessAtMs,
      snapshot.lastSuccessAtMs,
    ]).filter((value): value is number => value !== null && isValidUtcMillis(value));
    const truthLabel = combinedTruth(snapshots);
    const positivelyAvailable = snapshots.every((snapshot) => (
      snapshot.truthLabel === 'LIVE_PUBLIC'
      && snapshot.readiness === 'READY'
      && snapshot.completeness === 'COMPLETE'
    ));
    const evidenceState = truthLabel === 'UNAVAILABLE' ? 'UNAVAILABLE' as const
      : positivelyAvailable ? 'OBSERVED' as const
        : 'UNKNOWN' as const;
    const ownerReasonCodes = new Set(snapshots.flatMap((snapshot) => snapshot.blockerCodes));
    if (evidenceState === 'UNAVAILABLE') {
      ownerReasonCodes.add('CANONICAL_OWNER_TRUTH_UNAVAILABLE');
    } else if (evidenceState === 'UNKNOWN') {
      ownerReasonCodes.add('CANONICAL_OWNER_TRUTH_NOT_POSITIVELY_AVAILABLE');
    }
    return Object.freeze({
      role,
      bindingState: 'BOUND' as const,
      componentIds,
      evidenceState,
      truthLabel,
      ownerRevision: null,
      observedAtMs: observedTimes.length > 0 ? Math.max(...observedTimes) : null,
      reasonCodes: Object.freeze([...ownerReasonCodes]),
    });
  }));
}

function l06Evidence(
  mutationJournal: CanonicalMutationJournalInventoryPort,
): Readonly<CanonicalL06Evidence> {
  try {
    const inventory = mutationJournal.inspectInventory();
    return Object.freeze({
      wiringState: 'WIRED',
      persistenceOwner: 'SYSTEM_INTEGRATION_LEDGER',
      inventoryState: inventory.state,
      journalCount: inventory.journalCount,
      entryCount: inventory.entryCount,
      highestJournalVersion: inventory.highestJournalVersion,
      reconstructionProven: inventory.reconstructionProven,
      reasonCodes: Object.freeze([]),
      sendAuthorized: false,
      externalActionAuthorization: 'NONE',
    });
  } catch (error) {
    const corrupt = error instanceof LiveEdgeMutationJournalAdapterError
      && error.code === 'PERSISTENCE_CORRUPT';
    return Object.freeze({
      wiringState: 'WIRED',
      persistenceOwner: 'SYSTEM_INTEGRATION_LEDGER',
      inventoryState: corrupt ? 'PERSISTENCE_CORRUPT' : 'PERSISTENCE_UNAVAILABLE',
      journalCount: null,
      entryCount: null,
      highestJournalVersion: null,
      reconstructionProven: false,
      reasonCodes: Object.freeze([corrupt
        ? 'L06_CANONICAL_LEDGER_RECONSTRUCTION_CORRUPT'
        : 'L06_CANONICAL_LEDGER_READBACK_UNAVAILABLE']),
      sendAuthorized: false,
      externalActionAuthorization: 'NONE',
    });
  }
}

function availabilityForRole(
  roles: readonly Readonly<CanonicalL13RoleEvidence>[],
  role: MachineGraphRole,
  owner: CanonicalL12OwnerAvailability['owner'],
): Readonly<CanonicalL12OwnerAvailability> {
  const evidence = roles.find((entry) => entry.role === role);
  if (evidence === undefined || evidence.bindingState !== 'BOUND') {
    return Object.freeze({
      owner,
      state: 'UNAVAILABLE',
      ownerRevision: null,
      observedAtMs: null,
      reasonCodes: Object.freeze(['CANONICAL_OWNER_BINDING_UNAVAILABLE']),
    });
  }
  return Object.freeze({
    owner,
    state: evidence.evidenceState === 'OBSERVED' && evidence.truthLabel === 'LIVE_PUBLIC' ? 'AVAILABLE'
      : evidence.evidenceState === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'UNKNOWN',
    ownerRevision: null,
    observedAtMs: evidence.observedAtMs,
    reasonCodes: Object.freeze([...evidence.reasonCodes]),
  });
}

function l12Evidence(
  l06: Readonly<CanonicalL06Evidence>,
  roles: readonly Readonly<CanonicalL13RoleEvidence>[],
): Readonly<CanonicalL12Evidence> {
  const journalState = l06.inventoryState === 'EMPTY' ? 'EMPTY'
    : l06.inventoryState === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE';
  const ownerAvailability = Object.freeze([
    availabilityForRole(roles, 'CAPITAL_GATE', 'CAPITAL_FOUNDATION'),
    availabilityForRole(roles, 'RISK_GATE', 'FOUNDATION_RISK'),
    availabilityForRole(roles, 'EXECUTION_HAND', 'FOUNDATION_EXECUTION'),
    availabilityForRole(roles, 'RECONCILIATION', 'FOUNDATION_RECONCILIATION'),
    Object.freeze({
      owner: 'SYSTEM_INTEGRATION_LEDGER' as const,
      state: journalState,
      ownerRevision: null,
      observedAtMs: null,
      reasonCodes: Object.freeze([...l06.reasonCodes]),
    }),
  ]);
  return Object.freeze({
    sourcePath: 'server/src/liveEdge/adapters/exposureRecoveryProjection',
    wiringState: 'OWNER_AVAILABILITY_COMPOSED',
    acceptedProjectionState: 'NOT_INVOKED_NO_CANONICAL_SUBJECT',
    acceptedProjectionInvoked: false,
    truthLabel: 'UNAVAILABLE',
    projectionState: 'UNKNOWN',
    privateTruthState: 'OWNER_GATED',
    coldStartPosture: 'HALTED',
    effectiveEntryMode: 'BLOCKED',
    subjectState: 'UNKNOWN',
    subject: null,
    accountingScopeId: null,
    capitalExposed: null,
    activeExposureAmount: null,
    ownerAvailability,
    reasonCodes: Object.freeze([
      'NO_CANONICAL_ACTIVE_L12_SUBJECT',
      'PRIVATE_ACCOUNT_TRUTH_OWNER_GATED',
      'ACCEPTED_L12_PROJECTION_NOT_INVOKED',
      ...(l06.reconstructionProven ? [] : l06.reasonCodes),
    ]),
    syntheticInputAccepted: false,
    authorityGranted: false,
    controlAuthority: 'NONE_RECORD_ONLY',
    readinessAuthority: 'NONE_RECORD_ONLY',
    externalActionAuthorization: 'NONE',
  });
}

function controlEvidence(
  binding: Readonly<LiveEdgeControlProductionBinding>,
): readonly Readonly<CanonicalL13ControlEvidence>[] {
  return Object.freeze(MACHINE_GRAPH_CONTROL_ACTIONS.map((action) => {
    const runtimeOnly = action === 'SET_COMPONENT_DESIRED_STATE'
      || action === 'SAFE_RESTART_COMPONENT';
    return Object.freeze({
      action,
      implementationState: runtimeOnly
        ? 'PROVEN_CONTROL_PLANE_RUNTIME_ONLY' as const
        : 'CONTRACT_ONLY' as const,
      persistenceState: binding.activationState,
      availability: 'UNAVAILABLE' as const,
      reasonCodes: Object.freeze(binding.activationState === 'OWNER_GATED'
        ? [...binding.reasonCodes]
        : ['CANONICAL_COMMAND_OWNER_APPLICATION_NOT_ACTIVATED']),
    });
  }));
}

function frozenL14(
  binding: Readonly<LiveEdgeControlProductionBinding>,
): CanonicalOwnerEvidenceSnapshot['l14'] {
  return Object.freeze({
    wiringState: binding.wiringState,
    activationState: binding.activationState,
    persistenceOwner: binding.persistenceOwner,
    controlOwner: binding.controlOwner,
    configurationVersionOwner: binding.configurationVersionOwner,
    reasonCodes: Object.freeze([...binding.reasonCodes]),
    commandDispatchAvailable: binding.commandDispatchAvailable,
    externalActionAuthorization: binding.externalActionAuthorization,
  });
}

function traceEvent(input: Readonly<{
  sequence: number;
  componentId: SystemComponentId;
  kind: SystemTraceEventKind;
  truthLabel: SystemTruthLabel;
  releaseStatuses: SystemTraceEvent['releaseStatuses'];
  evaluatedAtMs: number;
  projectionId: string;
  ownerId: string | null;
  domainLifecycle: string | null;
  machinePhase: SystemTraceEvent['machinePhase'];
  referenceIds: readonly string[];
}>): Readonly<SystemTraceEvent> {
  const event = Object.freeze({
    id: `canonical-owner-${stableHash128Hex(canonicalJson(input))}`,
    sequence: input.sequence,
    kind: input.kind,
    componentId: input.componentId,
    correlationId: CANONICAL_OWNER_EVIDENCE_CORRELATION_ID,
    occurredAtMs: input.evaluatedAtMs,
    persistedAtMs: null,
    truthLabel: input.truthLabel,
    releaseStatuses: Object.freeze([...input.releaseStatuses]),
    ownerId: input.ownerId,
    canonicalProjectionId: input.projectionId,
    revisionDigest: null,
    domainLifecycle: input.domainLifecycle,
    machinePhase: input.machinePhase,
    failure: null,
    referenceIds: Object.freeze([...new Set(input.referenceIds)]),
    lossCodes: Object.freeze([]),
  } satisfies SystemTraceEvent);
  const issues = validateSystemTraceEvent(event);
  if (issues.length > 0) {
    throw new TypeError(`canonical owner trace violates System Integration: ${issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
  }
  return event;
}

function traceEvents(
  snapshot: Readonly<CanonicalOwnerEvidenceSnapshot>,
): readonly Readonly<SystemTraceEvent>[] {
  let sequence = 0;
  const events: Readonly<SystemTraceEvent>[] = [];
  const l06Available = snapshot.l06.reconstructionProven;
  events.push(traceEvent({
    sequence: sequence++,
    componentId: 'ledger-persistence',
    kind: 'PERSISTENCE',
    truthLabel: l06Available ? 'RECORDED_REPLAY' : 'UNAVAILABLE',
    releaseStatuses: l06Available
      ? Object.freeze(['BUILT_AND_TESTED', 'WIRED'])
      : Object.freeze(['BUILT_AND_TESTED', 'BLOCKED']),
    evaluatedAtMs: snapshot.evaluatedAtMs,
    projectionId: `${CANONICAL_OWNER_EVIDENCE_SCHEMA}:L06`,
    ownerId: 'SYSTEM_INTEGRATION_LEDGER',
    domainLifecycle: snapshot.l06.inventoryState,
    machinePhase: null,
    referenceIds: Object.freeze([
      `inventoryState=${snapshot.l06.inventoryState}`,
      `journalCount=${snapshot.l06.journalCount ?? 'UNKNOWN'}`,
      `entryCount=${snapshot.l06.entryCount ?? 'UNKNOWN'}`,
      `reconstructionProven=${snapshot.l06.reconstructionProven}`,
      'sendAuthorized=false',
    ]),
  }));
  events.push(traceEvent({
    sequence: sequence++,
    componentId: 'capital-supervision',
    kind: 'CAPITAL',
    truthLabel: 'UNAVAILABLE',
    releaseStatuses: Object.freeze(['WIRED', 'BLOCKED']),
    evaluatedAtMs: snapshot.evaluatedAtMs,
    projectionId: `${CANONICAL_OWNER_EVIDENCE_SCHEMA}:L12`,
    ownerId: 'CAPITAL_FOUNDATION',
    domainLifecycle: 'HALTED',
    machinePhase: null,
    referenceIds: Object.freeze([
      `projectionState=${snapshot.l12.projectionState}`,
      `privateTruthState=${snapshot.l12.privateTruthState}`,
      `subjectState=${snapshot.l12.subjectState}`,
      `coldStartPosture=${snapshot.l12.coldStartPosture}`,
      `effectiveEntryMode=${snapshot.l12.effectiveEntryMode}`,
      ...snapshot.l12.ownerAvailability.map((entry) => `owner:${entry.owner}=${entry.state}`),
    ]),
  }));

  const boundComponentIds = [...new Set(snapshot.l13.roles.flatMap((role) => role.componentIds))];
  for (const componentId of boundComponentIds) {
    const role = snapshot.l13.roles.find((entry) => entry.componentIds.includes(componentId));
    if (role === undefined) continue;
    const live = role.truthLabel === 'LIVE_PUBLIC';
    events.push(traceEvent({
      sequence: sequence++,
      componentId,
      kind: TRACE_KIND_BY_COMPONENT[componentId],
      truthLabel: role.truthLabel,
      releaseStatuses: live
        ? Object.freeze(['BUILT_AND_TESTED', 'WIRED', 'LIVE_PUBLIC'])
        : Object.freeze(['BUILT_AND_TESTED', 'WIRED']),
      evaluatedAtMs: snapshot.evaluatedAtMs,
      projectionId: `${CANONICAL_OWNER_EVIDENCE_SCHEMA}:L13:${componentId}`,
      ownerId: null,
      domainLifecycle: role.evidenceState,
      machinePhase: null,
      referenceIds: Object.freeze([
        ...snapshot.l13.roles
          .filter((entry) => entry.componentIds.includes(componentId))
          .map((entry) => `role=${entry.role}`),
        `bindingState=${role.bindingState}`,
        `evidenceState=${role.evidenceState}`,
      ]),
    }));
  }
  events.push(traceEvent({
    sequence: sequence++,
    componentId: 'engine-supervisor',
    kind: 'SUPERVISOR',
    truthLabel: 'UNKNOWN',
    releaseStatuses: Object.freeze(['BUILT_AND_TESTED', 'WIRED', 'BLOCKED']),
    evaluatedAtMs: snapshot.evaluatedAtMs,
    projectionId: `${CANONICAL_OWNER_EVIDENCE_SCHEMA}:L13-L14`,
    ownerId: 'SYSTEM_INTEGRATION',
    domainLifecycle: 'UNKNOWN',
    machinePhase: null,
    referenceIds: Object.freeze([
      ...snapshot.l13.roles.map((role) => `role:${role.role}=${role.bindingState}/${role.evidenceState}`),
      `controlCount=${snapshot.l13.controls.length}`,
      `availableControlCount=${snapshot.l13.controls.filter((control) => control.availability !== 'UNAVAILABLE').length}`,
      `l14WiringState=${snapshot.l14.wiringState}`,
      `l14ActivationState=${snapshot.l14.activationState}`,
      `commandDispatchAvailable=${snapshot.l14.commandDispatchAvailable}`,
    ]),
  }));
  events.push(traceEvent({
    sequence: sequence++,
    componentId: 'engine-supervisor',
    kind: 'SUPERVISOR',
    truthLabel: 'UNKNOWN',
    releaseStatuses: Object.freeze(['NOT_CONFIGURED']),
    evaluatedAtMs: snapshot.evaluatedAtMs,
    projectionId: `${CANONICAL_OWNER_EVIDENCE_SCHEMA}:PRODUCT_ASSURANCE`,
    ownerId: null,
    domainLifecycle: snapshot.productAssurance.wiringState,
    machinePhase: null,
    referenceIds: Object.freeze([
      `coverageState=${snapshot.productAssurance.coverageState}`,
      `operationStabilityState=${snapshot.productAssurance.operationStabilityState}`,
    ]),
  }));
  return Object.freeze(events);
}

function validateOptions(options: Readonly<CanonicalOwnerEvidenceOptions>): void {
  if (!options || typeof options.clock?.nowMs !== 'function'
      || !options.components || typeof options.components !== 'object'
      || typeof options.mutationJournal?.inspectInventory !== 'function'
      || options.liveEdgeControl?.schema === undefined) {
    throw new TypeError('canonical owner evidence requires exact canonical read owners');
  }
}

export function createCanonicalOwnerEvidenceReadPort(
  options: Readonly<CanonicalOwnerEvidenceOptions>,
): Readonly<CanonicalOwnerEvidenceReadPort> {
  validateOptions(options);
  let pendingTraceCut: Readonly<{
    snapshot: Readonly<CanonicalOwnerEvidenceSnapshot>;
    events: readonly Readonly<SystemTraceEvent>[];
  }> | null = null;
  const build = (): Readonly<{
    snapshot: Readonly<CanonicalOwnerEvidenceSnapshot>;
    events: readonly Readonly<SystemTraceEvent>[];
  }> => {
    const evaluatedAtMs = options.clock.nowMs();
    if (!isValidUtcMillis(evaluatedAtMs)) {
      throw new TypeError('canonical owner evidence clock returned invalid UTC milliseconds');
    }
    const roles = roleEvidence(options.components);
    const l06 = l06Evidence(options.mutationJournal);
    const l12 = l12Evidence(l06, roles);
    const passive = createPassiveOwnerEvidenceReadPort({ evaluatedAtMs })
      .readPassiveOwnerEvidence();
    const l13: Readonly<CanonicalL13Evidence> = Object.freeze({
      sourcePath: 'server/src/liveEdge/adapters/machineGraphEvidence',
      wiringState: 'ROLE_BINDINGS_COMPOSED',
      acceptedProjectionState: 'NOT_INVOKED_NO_VALIDATED_L12_BINDING',
      acceptedProjectionInvoked: false,
      truthLabel: 'UNKNOWN',
      graphState: 'UNKNOWN',
      roles,
      metrics: passive.l13.metrics,
      alarms: passive.l13.alarms,
      controls: controlEvidence(options.liveEdgeControl),
      reasonCodes: Object.freeze([
        'CANONICAL_ROLE_BINDINGS_MAPPED',
        'CANONICAL_OWNER_EVIDENCE_INCOMPLETE',
        'ACCEPTED_L13_PROJECTION_NOT_INVOKED',
      ]),
      topologyAuthority: 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY',
      firstRootSelectionAuthority: 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY',
      observabilityOwner: 'FOUNDATION_OBSERVABILITY',
      rootCauseAuthority: 'NONE_RECORD_ONLY',
      readinessAuthority: 'NONE_RECORD_ONLY',
      controlAuthority: 'NONE_RECORD_ONLY',
      alarmAuthority: 'NONE_RECORD_ONLY',
      automaticActionAuthorization: 'NONE',
      externalActionAuthorization: 'NONE',
    });
    const material = Object.freeze({
      schema: CANONICAL_OWNER_EVIDENCE_SCHEMA,
      version: 1 as const,
      evaluatedAtMs,
      l06,
      l12,
      l13,
      l14: frozenL14(options.liveEdgeControl),
      productAssurance: passive.productAssurance,
      aggregationAuthority: 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY' as const,
      controlAuthority: 'NONE' as const,
      readinessAuthority: 'NONE' as const,
      externalActionAuthorization: 'NONE' as const,
    });
    const snapshot: Readonly<CanonicalOwnerEvidenceSnapshot> = Object.freeze({
      ...material,
      projectionRevision: `canonical_owner_evidence_${stableHash128Hex(canonicalJson(material))}`,
    });
    return Object.freeze({ snapshot, events: traceEvents(snapshot) });
  };
  return Object.freeze({
    readCanonicalOwnerEvidence: () => {
      const cut = build();
      // A System supervisor projection reads the owner summary first and the
      // owner trace second. Preserve that one immutable cut across both
      // accessors instead of rebuilding and rescanning the Ledger twice.
      pendingTraceCut = cut;
      return cut.snapshot;
    },
    readTraceEvents: () => {
      const cut = pendingTraceCut ?? build();
      pendingTraceCut = null;
      return cut.events;
    },
  });
}
