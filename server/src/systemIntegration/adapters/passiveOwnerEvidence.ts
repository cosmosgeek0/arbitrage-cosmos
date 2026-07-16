/**
 * Fail-closed production projection for accepted-but-unbound L12, L13, and
 * Product Assurance owner evidence.
 *
 * This port deliberately accepts no owner snapshots. The accepted L12/L13 and
 * Product Assurance builders are synthetic proof machinery; a future real
 * owner composer needs a separately reviewed adapter version. Until then this
 * projection can only report absence through the canonical System Integration
 * trace seam and a bounded render-neutral detail snapshot.
 */
import {
  canonicalJson,
  isValidUtcMillis,
  stableHash128Hex,
} from '../../foundation/contracts/index.js';
import {
  MACHINE_GRAPH_ALARMS,
  MACHINE_GRAPH_METRICS,
  MACHINE_GRAPH_METRIC_INSTRUMENTS,
  MACHINE_GRAPH_METRIC_UNITS,
  MACHINE_GRAPH_ROLES,
  type MachineGraphAlarm,
  type MachineGraphMetric,
  type MachineGraphMetricInstrument,
  type MachineGraphMetricUnit,
  type MachineGraphRole,
} from '../../liveEdge/adapters/machineGraphEvidence/index.js';
import {
  ASSURANCE_COCKPIT_SECTION_IDS,
  type AssuranceCockpitSectionId,
} from '../../productAssurance/cockpit/viewModel.js';
import type { ApplicationTraceReadPort } from '../application/types.js';
import type { SystemTraceEvent } from '../contracts/types.js';
import { validateSystemTraceEvent } from '../contracts/validation.js';

export const PASSIVE_OWNER_EVIDENCE_SCHEMA =
  'SYSTEM_INTEGRATION_PASSIVE_OWNER_EVIDENCE_V1' as const;

export const PASSIVE_OWNER_EVIDENCE_CORRELATION_ID =
  'passive-owner-evidence-not-configured' as const;

export interface PassiveOwnerEvidenceOptions {
  readonly evaluatedAtMs: number;
}

export interface PassiveL12Evidence {
  readonly sourcePath: 'server/src/liveEdge/adapters/exposureRecoveryProjection';
  readonly wiringState: 'NOT_CONFIGURED';
  readonly truthLabel: 'UNAVAILABLE';
  readonly completeness: 'UNKNOWN';
  readonly projectionState: 'UNKNOWN';
  readonly privateTruthState: 'OWNER_GATED';
  readonly coldStartPosture: 'HALTED';
  readonly effectiveEntryMode: 'BLOCKED';
  readonly subject: null;
  readonly accountingScopeId: null;
  readonly capitalExposed: null;
  readonly ownerRevision: null;
  readonly observedAtMs: null;
  readonly reasonCodes: readonly string[];
  readonly syntheticInputAccepted: false;
  readonly authorityGranted: false;
  readonly controlAuthority: 'NONE_RECORD_ONLY';
  readonly readinessAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface PassiveL13RoleEvidence {
  readonly role: MachineGraphRole;
  readonly wiringState: 'NOT_CONFIGURED' | 'OWNER_GATED';
  readonly evidenceState: 'UNAVAILABLE';
  readonly completeness: 'UNKNOWN';
  readonly ownerRevision: null;
  readonly observedAtMs: null;
  readonly reasonCodes: readonly string[];
}

export interface PassiveL13MetricEvidence {
  readonly metric: MachineGraphMetric;
  readonly instrument: MachineGraphMetricInstrument;
  readonly unit: MachineGraphMetricUnit;
  readonly status: 'UNAVAILABLE';
  readonly value: null;
  readonly owner: 'FOUNDATION_OBSERVABILITY';
  readonly ownerRevision: null;
  readonly ownerDigest: null;
  readonly observedAtMs: null;
  readonly window: null;
  readonly windowContinuity: 'UNKNOWN' | null;
  readonly resetState: 'UNKNOWN' | null;
  readonly reasonCodes: readonly string[];
}

export interface PassiveL13AlarmEvidence {
  readonly alarm: MachineGraphAlarm;
  readonly state: 'UNAVAILABLE';
  readonly owner: 'FOUNDATION_OBSERVABILITY';
  readonly ownerRevision: null;
  readonly ownerDigest: null;
  readonly observedAtMs: null;
  readonly automaticAction: 'NONE';
  readonly canLiquidate: false;
  readonly canMutateCapital: false;
  readonly haltRecommendation: null;
  readonly reasonCodes: readonly string[];
}

export interface PassiveL13Evidence {
  readonly sourcePath: 'server/src/liveEdge/adapters/machineGraphEvidence';
  readonly wiringState: 'NOT_CONFIGURED';
  readonly truthLabel: 'UNAVAILABLE';
  readonly graphState: 'UNKNOWN';
  readonly observabilityOwner: 'FOUNDATION_OBSERVABILITY';
  readonly roles: readonly Readonly<PassiveL13RoleEvidence>[];
  readonly metrics: readonly Readonly<PassiveL13MetricEvidence>[];
  readonly alarms: readonly Readonly<PassiveL13AlarmEvidence>[];
  readonly reasonCodes: readonly string[];
  readonly syntheticInputAccepted: false;
  readonly topologyAuthority: 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY';
  readonly rootCauseAuthority: 'NONE_RECORD_ONLY';
  readonly readinessAuthority: 'NONE_RECORD_ONLY';
  readonly controlAuthority: 'NONE_RECORD_ONLY';
  readonly alarmAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly automaticActionAuthorization: 'NONE';
}

export interface PassiveProductAssuranceSection {
  readonly sectionId: AssuranceCockpitSectionId;
  readonly wiringState: 'NOT_CONFIGURED';
  readonly truthLabel: 'UNKNOWN';
  readonly canonicalVerdict: 'UNKNOWN';
  readonly operatorState: 'NOT_CONFIGURED';
  readonly sourceRevision: null;
  readonly observedAtMs: null;
  readonly projection: null;
  readonly controlIds: readonly [];
  readonly reasonCodes: readonly string[];
}

export interface PassiveProductAssuranceEvidence {
  readonly sourcePath: 'server/src/productAssurance/cockpit/viewModel.ts';
  readonly wiringState: 'NOT_CONFIGURED';
  readonly truthLabel: 'UNKNOWN';
  readonly coverageState: 'UNKNOWN';
  readonly operationStabilityState: 'UNKNOWN';
  readonly sections: readonly Readonly<PassiveProductAssuranceSection>[];
  readonly productReadinessComputed: false;
  readonly authorityGranted: false;
  readonly executionAuthorityGranted: false;
  readonly moneyAuthorityGranted: false;
  readonly syntheticInputAccepted: false;
  readonly controlIds: readonly [];
  readonly reasonCodes: readonly string[];
}

export interface PassiveOwnerEvidenceSnapshot {
  readonly schema: typeof PASSIVE_OWNER_EVIDENCE_SCHEMA;
  readonly version: 1;
  readonly projectionRevision: string;
  readonly evaluatedAtMs: number;
  readonly l12: Readonly<PassiveL12Evidence>;
  readonly l13: Readonly<PassiveL13Evidence>;
  readonly productAssurance: Readonly<PassiveProductAssuranceEvidence>;
  readonly aggregationAuthority: 'NONE';
  readonly controlAuthority: 'NONE';
  readonly readinessAuthority: 'NONE';
  readonly externalActionAuthorization: 'NONE';
}

export interface PassiveOwnerEvidenceReadPort extends ApplicationTraceReadPort {
  readPassiveOwnerEvidence(): Readonly<PassiveOwnerEvidenceSnapshot>;
}

const OWNER_GATED_ROLES = new Set<MachineGraphRole>([
  'SECRETS_BOUNDARY',
  'SPOT_PRIVATE_STREAM',
  'USD_M_PRIVATE_STREAM',
  'MARGIN_PRIVATE_STREAM',
  'ACCOUNT_TRUTH',
  'EC2_PROCESS',
  'CLOUDFLARE_TUNNEL_ACCESS',
  'WATCHDOG_ALARMS',
]);

function assertExactOptions(value: PassiveOwnerEvidenceOptions): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      || Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('passive owner evidence options must be a plain record');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort();
  if (canonicalJson(keys) !== canonicalJson(['evaluatedAtMs'])) {
    throw new TypeError('passive owner evidence options must use the exact closed schema');
  }
  const descriptor = descriptors.evaluatedAtMs;
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
    throw new TypeError('passive owner evidence options forbid accessors and hidden fields');
  }
  if (!isValidUtcMillis(value.evaluatedAtMs)) {
    throw new TypeError('evaluatedAtMs must be valid injected UTC milliseconds');
  }
}

function l12Evidence(): Readonly<PassiveL12Evidence> {
  return Object.freeze({
    sourcePath: 'server/src/liveEdge/adapters/exposureRecoveryProjection',
    wiringState: 'NOT_CONFIGURED',
    truthLabel: 'UNAVAILABLE',
    completeness: 'UNKNOWN',
    projectionState: 'UNKNOWN',
    privateTruthState: 'OWNER_GATED',
    coldStartPosture: 'HALTED',
    effectiveEntryMode: 'BLOCKED',
    subject: null,
    accountingScopeId: null,
    capitalExposed: null,
    ownerRevision: null,
    observedAtMs: null,
    reasonCodes: Object.freeze([
      'L12_CANONICAL_OWNER_COMPOSITION_NOT_CONFIGURED',
      'PRIVATE_ACCOUNT_TRUTH_OWNER_GATED',
    ]),
    syntheticInputAccepted: false,
    authorityGranted: false,
    controlAuthority: 'NONE_RECORD_ONLY',
    readinessAuthority: 'NONE_RECORD_ONLY',
    externalActionAuthorization: 'NONE',
  });
}

function l13Roles(): readonly Readonly<PassiveL13RoleEvidence>[] {
  return Object.freeze(MACHINE_GRAPH_ROLES.map((role) => {
    const ownerGated = OWNER_GATED_ROLES.has(role);
    return Object.freeze({
      role,
      wiringState: ownerGated ? 'OWNER_GATED' as const : 'NOT_CONFIGURED' as const,
      evidenceState: 'UNAVAILABLE' as const,
      completeness: 'UNKNOWN' as const,
      ownerRevision: null,
      observedAtMs: null,
      reasonCodes: Object.freeze([ownerGated
        ? 'ROLE_OWNER_AUTHORIZATION_REQUIRED'
        : 'ROLE_OWNER_PROJECTION_NOT_CONFIGURED']),
    });
  }));
}

function l13Metrics(): readonly Readonly<PassiveL13MetricEvidence>[] {
  return Object.freeze(MACHINE_GRAPH_METRICS.map((metric) => {
    const counter = MACHINE_GRAPH_METRIC_INSTRUMENTS[metric] === 'COUNTER';
    return Object.freeze({
      metric,
      instrument: MACHINE_GRAPH_METRIC_INSTRUMENTS[metric],
      unit: MACHINE_GRAPH_METRIC_UNITS[metric],
      status: 'UNAVAILABLE' as const,
      value: null,
      owner: 'FOUNDATION_OBSERVABILITY' as const,
      ownerRevision: null,
      ownerDigest: null,
      observedAtMs: null,
      window: null,
      windowContinuity: counter ? 'UNKNOWN' as const : null,
      resetState: counter ? 'UNKNOWN' as const : null,
      reasonCodes: Object.freeze(['FOUNDATION_OBSERVABILITY_METRIC_NOT_CONFIGURED']),
    });
  }));
}

function l13Alarms(): readonly Readonly<PassiveL13AlarmEvidence>[] {
  return Object.freeze(MACHINE_GRAPH_ALARMS.map((alarm) => Object.freeze({
    alarm,
    state: 'UNAVAILABLE' as const,
    owner: 'FOUNDATION_OBSERVABILITY' as const,
    ownerRevision: null,
    ownerDigest: null,
    observedAtMs: null,
    automaticAction: 'NONE' as const,
    canLiquidate: false as const,
    canMutateCapital: false as const,
    haltRecommendation: null,
    reasonCodes: Object.freeze(['FOUNDATION_OBSERVABILITY_ALARM_NOT_CONFIGURED']),
  })));
}

function l13Evidence(): Readonly<PassiveL13Evidence> {
  return Object.freeze({
    sourcePath: 'server/src/liveEdge/adapters/machineGraphEvidence',
    wiringState: 'NOT_CONFIGURED',
    truthLabel: 'UNAVAILABLE',
    graphState: 'UNKNOWN',
    observabilityOwner: 'FOUNDATION_OBSERVABILITY',
    roles: l13Roles(),
    metrics: l13Metrics(),
    alarms: l13Alarms(),
    reasonCodes: Object.freeze(['L13_OWNER_EVIDENCE_PROJECTION_NOT_CONFIGURED']),
    syntheticInputAccepted: false,
    topologyAuthority: 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY',
    rootCauseAuthority: 'NONE_RECORD_ONLY',
    readinessAuthority: 'NONE_RECORD_ONLY',
    controlAuthority: 'NONE_RECORD_ONLY',
    alarmAuthority: 'NONE_RECORD_ONLY',
    externalActionAuthorization: 'NONE',
    automaticActionAuthorization: 'NONE',
  });
}

function assuranceEvidence(): Readonly<PassiveProductAssuranceEvidence> {
  const sections = Object.freeze(ASSURANCE_COCKPIT_SECTION_IDS.map((sectionId) => Object.freeze({
    sectionId,
    wiringState: 'NOT_CONFIGURED' as const,
    truthLabel: 'UNKNOWN' as const,
    canonicalVerdict: 'UNKNOWN' as const,
    operatorState: 'NOT_CONFIGURED' as const,
    sourceRevision: null,
    observedAtMs: null,
    projection: null,
    controlIds: Object.freeze([]) as readonly [],
    reasonCodes: Object.freeze(['PRODUCT_ASSURANCE_OWNER_PROJECTION_NOT_CONFIGURED']),
  })));
  return Object.freeze({
    sourcePath: 'server/src/productAssurance/cockpit/viewModel.ts',
    wiringState: 'NOT_CONFIGURED',
    truthLabel: 'UNKNOWN',
    coverageState: 'UNKNOWN',
    operationStabilityState: 'UNKNOWN',
    sections,
    productReadinessComputed: false,
    authorityGranted: false,
    executionAuthorityGranted: false,
    moneyAuthorityGranted: false,
    syntheticInputAccepted: false,
    controlIds: Object.freeze([]) as readonly [],
    reasonCodes: Object.freeze(['PRODUCT_ASSURANCE_CANONICAL_READ_OWNER_NOT_CONFIGURED']),
  });
}

function traceEvent(input: Readonly<{
  sequence: number;
  componentId: 'capital-supervision' | 'engine-supervisor';
  kind: 'CAPITAL' | 'SUPERVISOR';
  truthLabel: 'UNAVAILABLE' | 'UNKNOWN';
  domainLifecycle: 'NOT_CONFIGURED';
  evaluatedAtMs: number;
  projectionId: string;
  referenceIds: readonly string[];
}>): Readonly<SystemTraceEvent> {
  const id = `passive-owner-evidence-${stableHash128Hex(canonicalJson(input))}`;
  const event = Object.freeze({
    id,
    sequence: input.sequence,
    kind: input.kind,
    componentId: input.componentId,
    correlationId: PASSIVE_OWNER_EVIDENCE_CORRELATION_ID,
    occurredAtMs: input.evaluatedAtMs,
    persistedAtMs: null,
    truthLabel: input.truthLabel,
    releaseStatuses: Object.freeze(['NOT_CONFIGURED'] as const),
    ownerId: null,
    canonicalProjectionId: input.projectionId,
    revisionDigest: null,
    domainLifecycle: input.domainLifecycle,
    machinePhase: null,
    failure: null,
    referenceIds: Object.freeze([...input.referenceIds]),
    lossCodes: Object.freeze([]),
  } satisfies SystemTraceEvent);
  const issues = validateSystemTraceEvent(event);
  if (issues.length > 0) {
    throw new TypeError(`passive owner trace violates System Integration: ${issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
  }
  return event;
}

function traceEvents(
  snapshot: Readonly<PassiveOwnerEvidenceSnapshot>,
): readonly Readonly<SystemTraceEvent>[] {
  return Object.freeze([
    traceEvent({
      sequence: 0,
      componentId: 'capital-supervision',
      kind: 'CAPITAL',
      truthLabel: snapshot.l12.truthLabel,
      domainLifecycle: 'NOT_CONFIGURED',
      evaluatedAtMs: snapshot.evaluatedAtMs,
      projectionId: `${PASSIVE_OWNER_EVIDENCE_SCHEMA}:L12`,
      referenceIds: Object.freeze([
        `wiringState=${snapshot.l12.wiringState}`,
        `projectionState=${snapshot.l12.projectionState}`,
        `privateTruthState=${snapshot.l12.privateTruthState}`,
        `completeness=${snapshot.l12.completeness}`,
        `coldStartPosture=${snapshot.l12.coldStartPosture}`,
        `effectiveEntryMode=${snapshot.l12.effectiveEntryMode}`,
      ]),
    }),
    traceEvent({
      sequence: 1,
      componentId: 'engine-supervisor',
      kind: 'SUPERVISOR',
      truthLabel: snapshot.l13.truthLabel,
      domainLifecycle: 'NOT_CONFIGURED',
      evaluatedAtMs: snapshot.evaluatedAtMs,
      projectionId: `${PASSIVE_OWNER_EVIDENCE_SCHEMA}:L13`,
      referenceIds: Object.freeze([
        `wiringState=${snapshot.l13.wiringState}`,
        `graphState=${snapshot.l13.graphState}`,
        `observabilityOwner=${snapshot.l13.observabilityOwner}`,
        `roleCount=${snapshot.l13.roles.length}`,
        `metricCount=${snapshot.l13.metrics.length}`,
        `alarmCount=${snapshot.l13.alarms.length}`,
      ]),
    }),
    traceEvent({
      sequence: 2,
      componentId: 'engine-supervisor',
      kind: 'SUPERVISOR',
      truthLabel: snapshot.productAssurance.truthLabel,
      domainLifecycle: 'NOT_CONFIGURED',
      evaluatedAtMs: snapshot.evaluatedAtMs,
      projectionId: `${PASSIVE_OWNER_EVIDENCE_SCHEMA}:PRODUCT_ASSURANCE`,
      referenceIds: Object.freeze([
        `wiringState=${snapshot.productAssurance.wiringState}`,
        `coverageState=${snapshot.productAssurance.coverageState}`,
        `operationStabilityState=${snapshot.productAssurance.operationStabilityState}`,
        ...snapshot.productAssurance.sections.map((section) => (
          `section:${section.sectionId}=${section.operatorState}/${section.canonicalVerdict}`
        )),
      ]),
    }),
  ]);
}

export function createPassiveOwnerEvidenceReadPort(
  options: PassiveOwnerEvidenceOptions,
): Readonly<PassiveOwnerEvidenceReadPort> {
  assertExactOptions(options);
  const material = Object.freeze({
    schema: PASSIVE_OWNER_EVIDENCE_SCHEMA,
    version: 1 as const,
    evaluatedAtMs: options.evaluatedAtMs,
    l12: l12Evidence(),
    l13: l13Evidence(),
    productAssurance: assuranceEvidence(),
    aggregationAuthority: 'NONE' as const,
    controlAuthority: 'NONE' as const,
    readinessAuthority: 'NONE' as const,
    externalActionAuthorization: 'NONE' as const,
  });
  const projectionRevision = `passive_owner_evidence_${stableHash128Hex(canonicalJson(material))}`;
  const snapshot: Readonly<PassiveOwnerEvidenceSnapshot> = Object.freeze({
    ...material,
    projectionRevision,
  });
  const events = traceEvents(snapshot);
  return Object.freeze({
    readPassiveOwnerEvidence: (): Readonly<PassiveOwnerEvidenceSnapshot> => snapshot,
    readTraceEvents: (): readonly Readonly<SystemTraceEvent>[] => events,
  });
}
