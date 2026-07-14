/**
 * Inert L12/L13 evidence projection for System Integration.
 *
 * This adapter validates accepted owner snapshots and emits only bounded,
 * synthetic trace/reference evidence. It does not own topology, readiness,
 * root-cause selection, controls, alarms, persistence, refresh, or private
 * acquisition.
 */
import {
  canonicalJson,
  stableHash128Hex,
} from '../../foundation/contracts/index.js';
import {
  validateExposureRecoverySnapshot,
  type L12ColdStartStep,
  type L12ProjectionStatus,
  type L12SubjectIdentity,
  type L12SupervisorSnapshot,
} from '../../liveEdge/adapters/exposureRecoveryProjection/index.js';
import {
  CANONICAL_SYSTEM_COMPONENT_IDS,
  MACHINE_GRAPH_METRIC_INSTRUMENTS,
  validateMachineGraphEvidenceSnapshot,
  type CounterWindowEvidence,
  type MachineGraphAlarm,
  type MachineGraphAlarmEvidence,
  type MachineGraphEvidenceSnapshot,
  type MachineGraphMetric,
  type MachineGraphMetricEvidence,
  type MachineGraphMetricInstrument,
  type MachineGraphRole,
  type MachineGraphRoleBinding,
  type MachineGraphRoleEvidence,
} from '../../liveEdge/adapters/machineGraphEvidence/index.js';
import type { ApplicationTraceReadPort } from '../application/types.js';
import {
  SYSTEM_COMPONENT_IDS,
  type SystemComponentId,
  type SystemTraceEventKind,
} from '../contracts/constants.js';
import type { SystemTraceEvent } from '../contracts/types.js';
import { validateSystemTraceEvent } from '../contracts/validation.js';

export const LIVE_EDGE_EVIDENCE_PROBE_SCHEMA =
  'SYSTEM_INTEGRATION_LIVE_EDGE_EVIDENCE_PROBE_V1' as const;

export const MAX_LIVE_EDGE_EVIDENCE_TRACE_EVENTS = 32;

export type LiveEdgeProjectedAvailability =
  | 'SYNTHETIC_ONLY'
  | 'PARTIAL'
  | 'STALE'
  | 'UNAVAILABLE'
  | 'NOT_CONFIGURED'
  | 'OWNER_GATED'
  | 'MISSING'
  | 'UNKNOWN';

export interface LiveEdgeEvidenceProbeInput {
  readonly l12Snapshot: Readonly<L12SupervisorSnapshot>;
  readonly machineGraphSnapshot: Readonly<MachineGraphEvidenceSnapshot>;
}

export interface LiveEdgeCanonicalTruthReference {
  readonly accountingScopeId: string;
  readonly mutationId: string;
  readonly exposureTruthRevision: string;
  readonly capitalPositionRevision: string;
  readonly accountCapacityRevision: string;
  readonly reservationRevision: string;
  readonly reservationSettlementRevision: string;
  readonly executionRevision: string;
  readonly outstandingRevision: string;
  readonly reconciliationRevision: string;
  readonly recoveryRevision: string;
}

export interface LiveEdgeColdStartReference {
  readonly step: L12ColdStartStep;
  readonly status: L12SupervisorSnapshot['coldStart']['steps'][number]['status'];
  readonly ownerRevision: string | null;
}

export interface LiveEdgeRoleEvidenceReference {
  readonly role: MachineGraphRole;
  readonly bindingState: MachineGraphRoleBinding['bindingState'];
  readonly componentIds: readonly SystemComponentId[];
  readonly bindingRevision: string | null;
  readonly evidenceState: MachineGraphRoleEvidence['evidenceState'];
  readonly availability: LiveEdgeProjectedAvailability;
  readonly owner: string;
  readonly ownerRevision: string | null;
  readonly blockerCode: string | null;
  readonly traceCorrelationId: string | null;
  readonly traceRevision: string | null;
}

export interface LiveEdgeMetricEvidenceReference {
  readonly metric: MachineGraphMetric;
  readonly instrument: MachineGraphMetricInstrument;
  readonly unit: MachineGraphMetricEvidence['unit'];
  readonly status: MachineGraphMetricEvidence['status'];
  readonly value: string | number | null;
  readonly owner: string;
  readonly ownerRevision: string | null;
  readonly ownerDigest: string | null;
  readonly observedAtMs: number | null;
  readonly window: Readonly<CounterWindowEvidence> | null;
  readonly reasonCodes: readonly string[];
}

export interface LiveEdgeAlarmEvidenceReference {
  readonly alarm: MachineGraphAlarm;
  readonly state: MachineGraphAlarmEvidence['state'];
  readonly owner: string;
  readonly ownerRevision: string | null;
  readonly ownerDigest: string | null;
  readonly observedAtMs: number | null;
  readonly haltRecommendation: boolean;
  readonly traceCorrelationId: string | null;
  readonly traceRevision: string | null;
  readonly reasonCodes: readonly string[];
}

export interface LiveEdgeEvidenceProbeProjection {
  readonly schema: typeof LIVE_EDGE_EVIDENCE_PROBE_SCHEMA;
  readonly version: 1;
  readonly projectionRevision: string;
  readonly assembledAtMs: number;
  readonly l12SnapshotRevision: string;
  readonly machineGraphSnapshotRevision: string;
  readonly subject: Readonly<L12SubjectIdentity>;
  readonly canonicalTruth: Readonly<LiveEdgeCanonicalTruthReference>;
  readonly projectionStatus: L12ProjectionStatus;
  readonly exposureSource: L12SupervisorSnapshot['exposure']['source'];
  readonly exposureCompleteness: L12SupervisorSnapshot['exposure']['completeness'];
  readonly capitalExposed: boolean;
  readonly operatorAttentionRequired: boolean;
  readonly coldStartPosture: L12SupervisorSnapshot['coldStart']['startupPosture'];
  readonly effectiveEntryMode: L12SupervisorSnapshot['coldStart']['effectiveEntryMode'];
  readonly coldStart: readonly Readonly<LiveEdgeColdStartReference>[];
  readonly roles: readonly Readonly<LiveEdgeRoleEvidenceReference>[];
  readonly metrics: readonly Readonly<LiveEdgeMetricEvidenceReference>[];
  readonly alarms: readonly Readonly<LiveEdgeAlarmEvidenceReference>[];
  readonly traceEvents: readonly Readonly<SystemTraceEvent>[];
  readonly truthClass: 'SYNTHETIC_ONLY';
  readonly topologyAuthority: 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY';
  readonly firstRootSelectionAuthority: 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY';
  readonly rootCauseAuthority: 'NONE_RECORD_ONLY';
  readonly readinessAuthority: 'NONE_RECORD_ONLY';
  readonly controlAuthority: 'NONE_RECORD_ONLY';
  readonly alarmAuthority: 'NONE_RECORD_ONLY';
  readonly persistenceAuthority: 'NONE';
  readonly privateReadAuthority: 'NONE';
  readonly externalActionAuthorization: 'NONE';
  readonly automaticActionAuthorization: 'NONE';
}

export const LIVE_EDGE_EVIDENCE_TRACE_KIND_BY_COMPONENT: Readonly<Record<SystemComponentId, SystemTraceEventKind>> = Object.freeze({
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

function assertExactInput(value: LiveEdgeEvidenceProbeInput): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      || Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('live-edge evidence probe input must be a plain record');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort();
  if (canonicalJson(keys) !== canonicalJson(['l12Snapshot', 'machineGraphSnapshot'])) {
    throw new TypeError('live-edge evidence probe input must use its exact closed schema');
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new TypeError('live-edge evidence probe input forbids accessors and hidden fields');
    }
  }
}

function assertCanonicalComponentsMatch(): void {
  const accepted = SYSTEM_COMPONENT_IDS.filter((componentId) => componentId !== 'q-inference');
  const extensions = SYSTEM_COMPONENT_IDS.filter(
    (componentId) => !(CANONICAL_SYSTEM_COMPONENT_IDS as readonly string[]).includes(componentId),
  );
  if (canonicalJson(CANONICAL_SYSTEM_COMPONENT_IDS) !== canonicalJson(accepted)
      || canonicalJson(extensions) !== canonicalJson(['q-inference'])) {
    throw new TypeError('L13 canonical component identities must remain the exact ordered subset extended only by q-inference');
  }
}

function availability(
  binding: Readonly<MachineGraphRoleBinding>,
  role: Readonly<MachineGraphRoleEvidence>,
): LiveEdgeProjectedAvailability {
  if (binding.bindingState === 'OWNER_GATED') return 'OWNER_GATED';
  if (binding.bindingState === 'MISSING') return 'MISSING';
  if (role.evidenceState === 'STALE') return 'STALE';
  if (role.evidenceState === 'PARTIAL') return 'PARTIAL';
  if (role.evidenceState === 'UNKNOWN') return 'UNKNOWN';
  if (role.evidenceState === 'UNAVAILABLE') return 'UNAVAILABLE';
  return 'SYNTHETIC_ONLY';
}

function traceCorrelationId(subject: Readonly<L12SubjectIdentity>): string {
  if (subject.correlationId.length > 128) {
    throw new RangeError('L12 correlationId cannot be represented by the bounded System Integration trace contract');
  }
  return subject.correlationId;
}

function reference(name: string, value: string | number | boolean | null): string {
  const raw = `${name}=${value === null ? 'null' : String(value)}`;
  if (raw.length <= 256) return raw;
  return `${name}=hash128:${stableHash128Hex(raw)}`;
}

function uniqueReferences(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function traceEvent(
  sequence: number,
  componentId: SystemComponentId,
  kind: SystemTraceEventKind,
  correlationId: string,
  occurredAtMs: number,
  material: Readonly<{
    ownerId: string;
    projectionId: string;
    revision: string;
    lifecycle: string;
    references: readonly string[];
  }>,
): Readonly<SystemTraceEvent> {
  const idMaterial = canonicalJson({ componentId, kind, correlationId, sequence, ...material });
  const event = Object.freeze({
    id: `live-edge-evidence-${stableHash128Hex(idMaterial)}`,
    sequence,
    kind,
    componentId,
    correlationId,
    occurredAtMs,
    persistedAtMs: null,
    truthLabel: 'SYNTHETIC_ONLY' as const,
    releaseStatuses: Object.freeze(['SYNTHETIC_ONLY'] as const),
    ownerId: material.ownerId,
    canonicalProjectionId: material.projectionId,
    revisionDigest: material.revision,
    domainLifecycle: material.lifecycle,
    machinePhase: null,
    failure: null,
    referenceIds: uniqueReferences(material.references),
    lossCodes: Object.freeze([]),
  } satisfies SystemTraceEvent);
  const issues = validateSystemTraceEvent(event);
  if (issues.length > 0) {
    throw new TypeError(`live-edge trace projection violates System Integration: ${issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
  }
  return event;
}

function roleReferences(
  bindings: readonly Readonly<MachineGraphRoleBinding>[],
  roles: readonly Readonly<MachineGraphRoleEvidence>[],
): readonly Readonly<LiveEdgeRoleEvidenceReference>[] {
  return Object.freeze(bindings.map((binding, index) => {
    const role = roles[index];
    if (role === undefined || role.role !== binding.role) {
      throw new TypeError(`L13 role evidence is not aligned with ${binding.role}`);
    }
    return Object.freeze({
      role: binding.role,
      bindingState: binding.bindingState,
      componentIds: Object.freeze(binding.componentIds.map((componentId) => componentId as SystemComponentId)),
      bindingRevision: binding.bindingRevision,
      evidenceState: role.evidenceState,
      availability: availability(binding, role),
      owner: role.owner,
      ownerRevision: role.ownerRevision,
      blockerCode: role.blockerCode,
      traceCorrelationId: role.trace?.correlationId ?? null,
      traceRevision: role.trace?.traceRevision ?? null,
    });
  }));
}

function metricReferences(
  values: readonly Readonly<MachineGraphMetricEvidence>[],
  observabilityOwner: MachineGraphEvidenceSnapshot['observabilityAuthority'],
): readonly Readonly<LiveEdgeMetricEvidenceReference>[] {
  return Object.freeze(values.map((metric) => Object.freeze({
    metric: metric.metric,
    instrument: MACHINE_GRAPH_METRIC_INSTRUMENTS[metric.metric],
    unit: metric.unit,
    status: metric.status,
    value: metric.value,
    owner: observabilityOwner,
    ownerRevision: metric.ownerRevision,
    ownerDigest: metric.ownerDigest,
    observedAtMs: metric.observedAtMs,
    window: metric.window === null ? null : Object.freeze({ ...metric.window }),
    reasonCodes: Object.freeze([...metric.reasonCodes]),
  })));
}

function alarmReferences(
  values: readonly Readonly<MachineGraphAlarmEvidence>[],
  observabilityOwner: MachineGraphEvidenceSnapshot['observabilityAuthority'],
): readonly Readonly<LiveEdgeAlarmEvidenceReference>[] {
  return Object.freeze(values.map((alarm) => Object.freeze({
    alarm: alarm.alarm,
    state: alarm.state,
    owner: observabilityOwner,
    ownerRevision: alarm.ownerRevision,
    ownerDigest: alarm.ownerDigest,
    observedAtMs: alarm.observedAtMs,
    haltRecommendation: alarm.haltRecommendation,
    traceCorrelationId: alarm.trace?.correlationId ?? null,
    traceRevision: alarm.trace?.traceRevision ?? null,
    reasonCodes: Object.freeze([...alarm.reasonCodes]),
  })));
}

function buildTraceEvents(
  l12: Readonly<L12SupervisorSnapshot>,
  l13: Readonly<MachineGraphEvidenceSnapshot>,
  roles: readonly Readonly<LiveEdgeRoleEvidenceReference>[],
): readonly Readonly<SystemTraceEvent>[] {
  const correlationId = traceCorrelationId(l12.subject);
  const occurredAtMs = l13.assembledAtMs;
  const events: Readonly<SystemTraceEvent>[] = [];
  const push = (
    componentId: SystemComponentId,
    kind: SystemTraceEventKind,
    ownerId: string,
    lifecycle: string,
    references: readonly string[],
  ): void => {
    events.push(traceEvent(events.length, componentId, kind, correlationId, occurredAtMs, {
      ownerId,
      projectionId: l13.snapshotRevision,
      revision: l12.snapshotRevision,
      lifecycle,
      references,
    }));
  };

  push('capital-supervision', 'CAPITAL', 'CAPITAL_FOUNDATION', l12.projectionStatus, [
    reference('l12SnapshotRevision', l12.snapshotRevision),
    reference('accountingScopeId', l12.canonicalTruth.accountingScopeId),
    reference('mutationId', l12.canonicalTruth.mutationId),
    reference('exposureSource', l12.exposure.source),
    reference('exposureCompleteness', l12.exposure.completeness),
    reference('capitalExposed', l12.componentEvidence.capitalExposed),
    reference('operatorAttentionRequired', l12.componentEvidence.operatorAttentionRequired),
    reference('coldStartPosture', l12.coldStart.startupPosture),
    reference('effectiveEntryMode', l12.coldStart.effectiveEntryMode),
  ]);

  for (const role of roles) {
    if (role.bindingState !== 'BOUND') continue;
    for (const componentId of role.componentIds) {
      push(componentId, LIVE_EDGE_EVIDENCE_TRACE_KIND_BY_COMPONENT[componentId], role.owner, role.evidenceState, [
        reference('role', role.role),
        reference('bindingState', role.bindingState),
        reference('bindingRevision', role.bindingRevision),
        reference('evidenceState', role.evidenceState),
        reference('availability', role.availability),
        reference('ownerRevision', role.ownerRevision),
        reference('blockerCode', role.blockerCode),
        reference('traceRevision', role.traceRevision),
      ]);
    }
  }

  push('engine-supervisor', 'SUPERVISOR', 'SYSTEM_INTEGRATION', 'ROLE_BINDINGS_RECORD_ONLY', [
    reference('machineGraphSnapshotRevision', l13.snapshotRevision),
    ...roles.map((role) => reference(`role:${role.role}`, `${role.bindingState}/${role.evidenceState}/${role.availability}`)),
  ]);
  push('engine-supervisor', 'SUPERVISOR', 'FOUNDATION_OBSERVABILITY', 'METRICS_RECORD_ONLY', [
    reference('machineGraphSnapshotRevision', l13.snapshotRevision),
    ...l13.metrics.map((metric) => reference(
      `metric:${metric.metric}`,
      `${metric.status}/${metric.window?.continuity ?? 'NO_WINDOW'}/${metric.reasonCodes.join('+') || 'NO_REASON'}`,
    )),
  ]);
  push('engine-supervisor', 'SUPERVISOR', l13.observabilityAuthority, 'ALARMS_RECORD_ONLY', [
    reference('machineGraphSnapshotRevision', l13.snapshotRevision),
    ...l13.alarms.map((alarm) => reference(
      `alarm:${alarm.alarm}`,
      `${alarm.state}/${alarm.reasonCodes.join('+') || 'NO_REASON'}`,
    )),
  ]);

  if (events.length > MAX_LIVE_EDGE_EVIDENCE_TRACE_EVENTS) {
    throw new RangeError(`live-edge evidence trace exceeds ${MAX_LIVE_EDGE_EVIDENCE_TRACE_EVENTS} events`);
  }
  return Object.freeze(events);
}

export function projectLiveEdgeEvidenceProbe(
  input: LiveEdgeEvidenceProbeInput,
): Readonly<LiveEdgeEvidenceProbeProjection> {
  assertExactInput(input);
  assertCanonicalComponentsMatch();
  const l12 = validateExposureRecoverySnapshot(input.l12Snapshot);
  const l13 = validateMachineGraphEvidenceSnapshot(input.machineGraphSnapshot, l12);
  const roles = roleReferences(l13.roleBindings, l13.roles);
  const metrics = metricReferences(l13.metrics, l13.observabilityAuthority);
  const alarms = alarmReferences(l13.alarms, l13.observabilityAuthority);
  const coldStart = Object.freeze(l12.coldStart.steps.map((step) => Object.freeze({
    step: step.step,
    status: step.status,
    ownerRevision: step.ownerRevision,
  })));
  const canonicalTruth = Object.freeze({
    accountingScopeId: l12.canonicalTruth.accountingScopeId,
    mutationId: l12.canonicalTruth.mutationId,
    exposureTruthRevision: l12.canonicalTruth.exposureTruthRevision,
    capitalPositionRevision: l12.canonicalTruth.capitalPositionRevision,
    accountCapacityRevision: l12.canonicalTruth.accountCapacityRevision,
    reservationRevision: l12.canonicalTruth.reservationRevision,
    reservationSettlementRevision: l12.canonicalTruth.reservationSettlementRevision,
    executionRevision: l12.canonicalTruth.executionRevision,
    outstandingRevision: l12.canonicalTruth.outstandingRevision,
    reconciliationRevision: l12.canonicalTruth.reconciliationRevision,
    recoveryRevision: l12.canonicalTruth.recoveryRevision,
  });
  const traceEvents = buildTraceEvents(l12, l13, roles);
  const material = Object.freeze({
    schema: LIVE_EDGE_EVIDENCE_PROBE_SCHEMA,
    version: 1 as const,
    assembledAtMs: l13.assembledAtMs,
    l12SnapshotRevision: l12.snapshotRevision,
    machineGraphSnapshotRevision: l13.snapshotRevision,
    subject: l12.subject,
    canonicalTruth,
    projectionStatus: l12.projectionStatus,
    exposureSource: l12.exposure.source,
    exposureCompleteness: l12.exposure.completeness,
    capitalExposed: l12.componentEvidence.capitalExposed,
    operatorAttentionRequired: l12.componentEvidence.operatorAttentionRequired,
    coldStartPosture: l12.coldStart.startupPosture,
    effectiveEntryMode: l12.coldStart.effectiveEntryMode,
    coldStart,
    roles,
    metrics,
    alarms,
    traceEvents,
    truthClass: 'SYNTHETIC_ONLY' as const,
    topologyAuthority: 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY' as const,
    firstRootSelectionAuthority: 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY' as const,
    rootCauseAuthority: 'NONE_RECORD_ONLY' as const,
    readinessAuthority: 'NONE_RECORD_ONLY' as const,
    controlAuthority: 'NONE_RECORD_ONLY' as const,
    alarmAuthority: 'NONE_RECORD_ONLY' as const,
    persistenceAuthority: 'NONE' as const,
    privateReadAuthority: 'NONE' as const,
    externalActionAuthorization: 'NONE' as const,
    automaticActionAuthorization: 'NONE' as const,
  });
  const projectionRevision = `live_edge_probe_${stableHash128Hex(canonicalJson(material))}`;
  return Object.freeze({ ...material, projectionRevision });
}

export function createLiveEdgeEvidenceTraceReadPort(
  input: LiveEdgeEvidenceProbeInput,
): ApplicationTraceReadPort {
  const events = projectLiveEdgeEvidenceProbe(input).traceEvents;
  return Object.freeze({
    readTraceEvents: (): readonly Readonly<SystemTraceEvent>[] => events,
  });
}
