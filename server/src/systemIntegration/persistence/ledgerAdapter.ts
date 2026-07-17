import {
  SYSTEM_CONTROL_COMMANDS,
  SYSTEM_RELEASE_STATUSES,
  type SystemComponentId,
} from '../contracts/constants.js';
import type {
  SystemControlMutation,
  SystemControlMutationReceipt,
  SystemControlMutationRequest,
  SystemControlState,
  SystemTraceEvent,
} from '../contracts/types.js';
import type { OperatorApprovalState } from '../../capitalFoundation/approvals/index.js';
import {
  RECOVERY_ACTIONS,
  recommendExecutionRecovery,
  type ExecutionPlanState,
} from '../../foundation/execution/index.js';
import { isStructuredFailure } from '../../foundation/contracts/index.js';
import {
  canonicalPersistenceJson,
  cloneCheckpointState,
  decodeSystemCheckpoint,
  encodeSystemCheckpoint,
  persistenceDigest,
  traceEventDigest,
  validateCheckpointState,
  validateSystemTraceEvent,
} from './codec.js';
import {
  createInitialCheckpointState,
  evaluateRestartBarrier,
  failClosedRestartBarrier,
  prepareShutdownState,
  prepareStartupState,
  withRestartTruth,
} from './restart.js';
import {
  SYSTEM_PERSISTENCE_CONFIG_KEY,
  SYSTEM_PERSISTENCE_EVENT_KIND,
  SYSTEM_PERSISTENCE_LIMITS,
  type IdempotentTransitionInput,
  type IdempotentTransitionReceipt,
  type LedgerEventRecord,
  type LedgerPersistencePort,
  type PersistedCommitReceipt,
  type PersistedControlRuntimePublicationReference,
  type PersistedControlRejectionReceipt,
  type PersistedIdempotencyReceipt,
  type PersistedRestartTruth,
  type PersistedTraceEventRecord,
  type PersistedTraceQueryResult,
  type PersistenceAuditInput,
  type PersistenceFailureCode,
  type PersistenceLoadResult,
  type PersistenceResult,
  type SystemIntegrationCheckpointState,
  type SystemJsonValue,
  type TraceAppendReceipt,
  type TraceQuery,
  type ProductBootReleasePersistenceInput,
  type ProductBootReleaseRecord,
  type ProductCommandPersistenceInput,
  type ProductConfigRevisionPersistenceInput,
  type ProductDesiredStatePersistenceInput,
  type ProductIdentityReferencePersistenceInput,
  type ProductIdentityReferenceRecord,
  type ProductIncidentPersistenceInput,
  type ProductPersistenceMutationResult,
  type RestartBarrierProjection,
} from './types.js';

const MAX_UTC_MS = 4_102_444_800_000;
const BOUNDED_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const DIGEST = /^(?:sha256:)?[a-f0-9]{32,64}$/i;
const REASON_CODE = /^[A-Z][A-Z0-9_.:-]{0,99}$/;
const AUDIT_SCHEMA = 'cosmos.system-integration.audit' as const;
const AUDIT_VERSION = 1 as const;
const IDEMPOTENCY_AUDIT_SCHEMA = 'cosmos.system-integration.idempotency' as const;
const IDEMPOTENCY_AUDIT_VERSION = 1 as const;
const APPROVAL_STATE_AUDIT_SCHEMA = 'cosmos.system-integration.approval-state' as const;
const APPROVAL_STATE_AUDIT_VERSION = 1 as const;
const MAX_IDEMPOTENCY_EVENT_READBACK = 8;
const MAX_APPROVAL_STATE_EVENT_READBACK = 8;
const MAX_ATOMIC_LEDGER_EVENTS = 8;
const SENSITIVE_TEXT = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_ -]?secret|password|authorization|bearer|access[_ -]?token|signature)\s*[:=]?\s*[A-Za-z0-9+/_=-]{12,})/i;

interface DurableIdempotencyAuditEvent {
  readonly schema: typeof IDEMPOTENCY_AUDIT_SCHEMA;
  readonly version: typeof IDEMPOTENCY_AUDIT_VERSION;
  readonly canonicalLedgerEventId: 'SELF' | number | null;
  readonly receipt: Readonly<PersistedIdempotencyReceipt>;
}

interface DurableIdempotencyReadback {
  readonly receipt: Readonly<PersistedIdempotencyReceipt>;
  readonly ledgerEventId: number | null;
}

interface DurableIdempotencyWrite {
  readonly receipt: Readonly<PersistedIdempotencyReceipt>;
  readonly canonicalLedgerEventId: 'SELF' | number | null;
}

interface DurableApprovalStateAuditEvent {
  readonly schema: typeof APPROVAL_STATE_AUDIT_SCHEMA;
  readonly version: typeof APPROVAL_STATE_AUDIT_VERSION;
  readonly approvalId: string;
  readonly state: Readonly<OperatorApprovalState>;
}

interface DurableApprovalStateWrite {
  readonly approvalId: string;
  readonly state: Readonly<OperatorApprovalState>;
}

function failed<T>(code: PersistenceFailureCode, message: string): PersistenceResult<T> {
  return { ok: false, code, message };
}

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const safe = error.message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 320);
  return safe.length > 0 && !SENSITIVE_TEXT.test(safe) ? safe : fallback;
}

function validUtcMillis(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MS;
}

function validActorId(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 1
    && value.length <= 160
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function jsonClone<T extends SystemJsonValue>(value: T): T {
  return JSON.parse(canonicalPersistenceJson(value)) as T;
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalPersistenceJson(left) === canonicalPersistenceJson(right);
  } catch {
    return false;
  }
}

function requiresRuntimePublication(command: unknown): boolean {
  return command === 'RESTART_COMPONENT' || command === 'SET_COMPONENT_STATE';
}

function idempotencyEventKind(idempotencyKey: string): string {
  // Ledger event kinds are indexed and accept exactly 64 lowercase hex
  // characters. The payload retains the full key, so any impossible digest
  // collision is detected and fails closed rather than becoming a false miss.
  return persistenceDigest(`${IDEMPOTENCY_AUDIT_SCHEMA}:${idempotencyKey}`);
}

function approvalStateEventKind(approvalId: string): string {
  return persistenceDigest(`${APPROVAL_STATE_AUDIT_SCHEMA}:${approvalId}`);
}

function validPersistedIdempotencyReceipt(value: unknown): value is Readonly<PersistedIdempotencyReceipt> {
  if (!isRecord(value)
    || Object.keys(value).length !== 6
    || !IDEMPOTENCY_KEY.test(String(value.idempotencyKey))
    || !DIGEST.test(String(value.requestDigest))
    || !CORRELATION_ID.test(String(value.correlationId))
    || !validUtcMillis(value.recordedAtMs)
    || !Number.isSafeInteger(value.checkpointRevision)
    || Number(value.checkpointRevision) < 1) return false;
  try {
    canonicalPersistenceJson(value.receipt);
    return true;
  } catch {
    return false;
  }
}

function terminalControlReceipt(value: Readonly<PersistedIdempotencyReceipt>): boolean {
  if (!isRecord(value.receipt) || value.receipt.kind !== 'CONTROL_MUTATION') return false;
  const publication = value.receipt.runtimePublication;
  return publication === 'NOT_REQUIRED' || publication === 'PUBLISHED';
}

function unresolvedControlRuntimePublication(value: Readonly<PersistedIdempotencyReceipt>): boolean {
  if (!isRecord(value.receipt) || value.receipt.kind !== 'CONTROL_MUTATION') return false;
  const publication = value.receipt.runtimePublication;
  return publication === 'PENDING' || publication === 'UNKNOWN';
}

function samePersistedIdempotencyReceipt(
  left: Readonly<PersistedIdempotencyReceipt>,
  right: Readonly<PersistedIdempotencyReceipt>,
): boolean {
  return left.idempotencyKey === right.idempotencyKey
    && left.requestDigest === right.requestDigest
    && left.correlationId === right.correlationId
    && left.recordedAtMs === right.recordedAtMs
    && left.checkpointRevision === right.checkpointRevision
    && sameJson(left.receipt, right.receipt);
}

function controlRuntimePublicationForArchive(
  value: Readonly<PersistedIdempotencyReceipt>,
): 'NOT_REQUIRED' | 'PENDING' | 'PUBLISHED' | 'UNKNOWN' | null | 'INVALID' {
  if (!isRecord(value.receipt) || value.receipt.kind !== 'CONTROL_MUTATION') return null;
  const publication = value.receipt.runtimePublication;
  if (publication === 'NOT_REQUIRED' || publication === 'PENDING'
    || publication === 'PUBLISHED' || publication === 'UNKNOWN') return publication;
  if (publication === undefined
    && value.receipt.applied === true
    && requiresRuntimePublication(value.receipt.command)) return 'UNKNOWN';
  return 'INVALID';
}

function validateApprovalStateContinuation(
  older: Readonly<OperatorApprovalState>,
  newer: Readonly<OperatorApprovalState>,
): boolean {
  const revisionDelta = newer.revision - older.revision;
  return revisionDelta >= 0
    && newer.uses.length - older.uses.length === revisionDelta
    && canonicalPersistenceJson(newer.approval) === canonicalPersistenceJson(older.approval)
    && newer.sourcePolicyDigest === older.sourcePolicyDigest
    && canonicalPersistenceJson(newer.uses.slice(0, older.uses.length)) === canonicalPersistenceJson(older.uses);
}

function checkpointChecksum(serialized: string): string {
  const decoded = JSON.parse(serialized) as { checksum?: unknown };
  if (typeof decoded.checksum !== 'string') throw new TypeError('encoded checkpoint has no checksum');
  return decoded.checksum;
}

function auditTraceEvents(audit: Readonly<PersistenceAuditInput>): readonly Readonly<SystemTraceEvent>[] {
  if (Array.isArray(audit.traceEvents)) return audit.traceEvents;
  return audit.traceEvent === undefined ? Object.freeze([]) : Object.freeze([audit.traceEvent]);
}

function validAuditInput(audit: Readonly<PersistenceAuditInput>): PersistenceResult<true> {
  if (!audit || !CORRELATION_ID.test(audit.correlationId) || !validUtcMillis(audit.occurredAtMs)) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'persistence audit metadata is invalid');
  }
  if (audit.traceEvent !== undefined && audit.traceEvents !== undefined) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'persistence audit must use one trace field');
  }
  if (audit.traceEvents !== undefined && !Array.isArray(audit.traceEvents)) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'persistence audit trace batch must be an array');
  }
  const traces = auditTraceEvents(audit);
  if (audit.traceEvents !== undefined && (
    traces.length === 0
    || traces.length > SYSTEM_PERSISTENCE_LIMITS.maximumTraceEventsPerCommit
  )) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'persistence audit trace batch is empty or exceeds its bound');
  }
  const traceIds: string[] = [];
  for (const trace of traces) {
    const issues = validateSystemTraceEvent(trace);
    if (issues.length > 0) return failed('INVALID_PERSISTENCE_REQUEST', `trace event is invalid: ${issues.slice(0, 6).join(', ')}`);
    if (trace.correlationId !== audit.correlationId
      || trace.occurredAtMs !== audit.occurredAtMs
      || trace.persistedAtMs !== null) {
      return failed('INVALID_PERSISTENCE_REQUEST', 'trace event does not match its audit envelope');
    }
    traceIds.push(trace.id);
  }
  if (new Set(traceIds).size !== traceIds.length) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'persistence audit trace IDs must be unique');
  }
  return { ok: true, value: true };
}

function traceForCheckpoint(input: {
  readonly idPrefix: string;
  readonly sequence: number;
  readonly componentId?: SystemComponentId;
  readonly correlationId: string;
  readonly occurredAtMs: number;
  readonly kind?: SystemTraceEvent['kind'];
  readonly machinePhase: SystemTraceEvent['machinePhase'];
  readonly ownerId?: string | null;
  readonly referenceIds?: readonly string[];
  readonly truthLabel?: SystemTraceEvent['truthLabel'];
  readonly domainLifecycle?: string | null;
  readonly releaseStatuses?: SystemTraceEvent['releaseStatuses'];
  readonly failure?: SystemTraceEvent['failure'];
}): Readonly<SystemTraceEvent> {
  const id = `${input.idPrefix}:${input.sequence}:${input.correlationId}`.slice(0, 256);
  return Object.freeze({
    id,
    sequence: input.sequence,
    kind: input.kind ?? 'PERSISTENCE',
    componentId: input.componentId ?? 'ledger-persistence',
    correlationId: input.correlationId,
    occurredAtMs: input.occurredAtMs,
    persistedAtMs: null,
    truthLabel: input.truthLabel ?? 'RECORDED_REPLAY',
    releaseStatuses: Object.freeze([...(input.releaseStatuses ?? ['WIRED'])]),
    ownerId: input.ownerId ?? null,
    canonicalProjectionId: null,
    revisionDigest: null,
    domainLifecycle: input.domainLifecycle ?? null,
    machinePhase: input.machinePhase,
    failure: input.failure ?? null,
    referenceIds: Object.freeze([...(input.referenceIds ?? [])]),
    lossCodes: Object.freeze([]),
  });
}

function validateOnlyTraceEvents(
  value: Readonly<Record<string, SystemJsonValue>>,
): readonly [Readonly<SystemTraceEvent>, ...Readonly<SystemTraceEvent>[]] {
  const recordId = String(value.recordId);
  const correlationId = String(value.rootCorrelationId);
  const occurredAtMs = Number(value.evaluatedAtMs);
  const disposition = String(value.disposition);
  const calls = isRecord(value.ownerInvocations) ? value.ownerInvocations : {};
  const riskPlanBinding = isRecord(value.riskPlanBinding) ? value.riskPlanBinding : null;
  const executionPlan = isRecord(value.executionPlan) ? value.executionPlan : null;
  const executionState = isRecord(value.executionState) ? value.executionState : null;
  const reconciliation = isRecord(value.reconciliation) ? value.reconciliation : null;
  const supervision = isRecord(value.supervision) ? value.supervision : null;
  const supervisedReconciliation = supervision !== null && isRecord(supervision.reconciliation)
    ? supervision.reconciliation
    : null;
  const recoveryRecommendations = Array.isArray(value.recoveryRecommendations)
    ? value.recoveryRecommendations.filter(isRecord)
    : [];
  const terminalFailure = isRecord(value.failure)
    ? value.failure as unknown as SystemTraceEvent['failure']
    : null;
  const releaseStatuses = value.releaseStatuses as SystemTraceEvent['releaseStatuses'];
  const dryRunTruth = Array.isArray(value.truthLabels) && value.truthLabels.includes('DRY_RUN')
    ? 'DRY_RUN' as const
    : 'UNAVAILABLE' as const;
  const stages: Array<Readonly<{
    kind: SystemTraceEvent['kind'];
    componentId: SystemComponentId;
    truthLabel: SystemTraceEvent['truthLabel'];
    references: readonly unknown[];
    domainLifecycle: string;
    failure: SystemTraceEvent['failure'];
    releaseStatuses: SystemTraceEvent['releaseStatuses'];
    ownerStage: 'capital' | 'risk' | 'execution' | 'reconciliation' | 'recovery' | 'persistence';
  }>> = [];
  if (calls.approvalEvaluations === 1) {
    stages.push(Object.freeze({
      kind: 'CAPITAL',
      componentId: 'capital-supervision',
      truthLabel: value.capitalReservationDialect === 'OWNER_SUPPLIED_MANUAL_ARMED_ENVELOPE'
        ? 'SYNTHETIC_ONLY'
        : 'UNAVAILABLE',
      references: Object.freeze([recordId, value.reservationId, value.approvalId]),
      domainLifecycle: disposition,
      failure: null,
      releaseStatuses,
      ownerStage: 'capital',
    }));
  }
  if (calls.riskEvaluations === 1) {
    stages.push(Object.freeze({
      kind: 'RISK',
      componentId: 'multileg-risk',
      truthLabel: dryRunTruth,
      references: Object.freeze([riskPlanBinding?.riskDecisionId, value.mandateId]),
      domainLifecycle: disposition,
      failure: null,
      releaseStatuses,
      ownerStage: 'risk',
    }));
  }
  if (calls.executionDefinitionsCreated === 1
      || calls.coordinatorsCreated === 1
      || calls.coordinatorPreflights === 1) {
    stages.push(Object.freeze({
      kind: 'EXECUTION',
      componentId: 'execution-coordinator-validate-only',
      truthLabel: dryRunTruth,
      references: Object.freeze([executionPlan?.planId, executionState?.planId, value.canonicalProposalId]),
      domainLifecycle: disposition,
      failure: null,
      releaseStatuses,
      ownerStage: 'execution',
    }));
  }
  if (calls.reconciliationEvaluations === 1) {
    const reachedReconciliation = reconciliation ?? supervisedReconciliation;
    stages.push(Object.freeze({
      kind: 'RECONCILIATION',
      componentId: 'reconciliation',
      truthLabel: dryRunTruth,
      references: Object.freeze([reachedReconciliation?.planId, executionPlan?.planId]),
      domainLifecycle: disposition,
      failure: null,
      releaseStatuses,
      ownerStage: 'reconciliation',
    }));
  }
  if (calls.recoveryEvaluations === 1) {
    const actions = recoveryRecommendations
      .flatMap((entry) => typeof entry.action === 'string' ? [entry.action] : []);
    stages.push(Object.freeze({
      kind: 'EXECUTION',
      componentId: 'execution-coordinator-validate-only',
      truthLabel: dryRunTruth,
      references: Object.freeze([
        executionPlan?.planId,
        supervision?.planId,
        ...actions.map((action) => `recovery:${action}`),
      ]),
      domainLifecycle: `RECOVERY:${actions.join('-').slice(0, 96) || 'UNAVAILABLE'}`,
      failure: null,
      releaseStatuses,
      ownerStage: 'recovery',
    }));
  }
  if (terminalFailure !== null && stages.length > 0) {
    const rawStage = typeof terminalFailure.stage === 'string' ? terminalFailure.stage : '';
    const failureOwner = rawStage === 'approval'
      ? 'capital'
      : rawStage === 'risk' || rawStage === 'risk-adapter'
        ? 'risk'
        : rawStage === 'reconciliation'
          ? 'reconciliation'
          : ['execution-plan', 'coordinator', 'execution', 'preflight'].includes(rawStage)
            ? 'execution'
            : null;
    const index = failureOwner === null ? -1 : stages.findIndex((stage) => stage.ownerStage === failureOwner);
    if (index >= 0) stages[index] = Object.freeze({ ...stages[index], failure: terminalFailure });
  }
  stages.push(Object.freeze({
    kind: 'PERSISTENCE',
    componentId: 'ledger-persistence',
    truthLabel: 'RECORDED_REPLAY',
    references: Object.freeze([recordId]),
    domainLifecycle: disposition,
    failure: null,
    releaseStatuses: Object.freeze(['WIRED'] as const),
    ownerStage: 'persistence',
  }));

  const digestPrefix = persistenceDigest(recordId).slice(0, 8);
  const traces: SystemTraceEvent[] = [];
  for (const [index, stage] of stages.entries()) {
    const predecessor = traces.at(-1)?.id;
    const references = [...new Set([
      ...(predecessor === undefined ? [] : [predecessor]),
      ...stage.references.flatMap((reference) => (
        typeof reference === 'string' && BOUNDED_ID.test(reference) ? [reference] : []
      )),
    ])];
    traces.push(traceForCheckpoint({
      idPrefix: `v${index}.${digestPrefix}`,
      sequence: occurredAtMs * SYSTEM_PERSISTENCE_LIMITS.maximumTraceEventsPerCommit + index + 1,
      componentId: stage.componentId,
      correlationId,
      occurredAtMs,
      kind: stage.kind,
      machinePhase: stage.ownerStage === 'persistence'
        ? 'RUNNING'
        : disposition === 'READY'
          ? 'RUNNING'
          : 'BLOCKED',
      truthLabel: stage.truthLabel,
      releaseStatuses: stage.releaseStatuses,
      domainLifecycle: stage.domainLifecycle,
      failure: stage.failure,
      referenceIds: references,
    }));
  }
  return Object.freeze(traces) as [SystemTraceEvent, ...SystemTraceEvent[]];
}

function appendTraceIndex(
  state: Readonly<SystemIntegrationCheckpointState>,
  trace: Readonly<SystemTraceEvent>,
): PersistenceResult<Readonly<SystemIntegrationCheckpointState>> {
  let digest: string;
  try {
    digest = traceEventDigest(trace);
  } catch (error) {
    return failed('INVALID_PERSISTENCE_REQUEST', errorMessage(error, 'trace validation failed'));
  }
  const existing = state.traceIndex.find((entry) => entry.eventId === trace.id);
  if (existing) {
    return failed(
      'TRACE_EVENT_CONFLICT',
      existing.eventDigest === digest
        ? 'trace event was already persisted'
        : 'trace event ID was reused with different content',
    );
  }
  const traceIndex = [...state.traceIndex, {
    eventId: trace.id,
    correlationId: trace.correlationId,
    eventDigest: digest,
    occurredAtMs: trace.occurredAtMs,
  }].slice(-SYSTEM_PERSISTENCE_LIMITS.maximumTraceIndexEntries);
  const candidate: SystemIntegrationCheckpointState = { ...state, traceIndex };
  const issues = validateCheckpointState(candidate);
  return issues.length === 0
    ? { ok: true, value: cloneCheckpointState(candidate) }
    : failed('CHECKPOINT_INVALID', `trace index produced an invalid checkpoint: ${issues.slice(0, 6).join(', ')}`);
}

interface DurableAuditEvent {
  readonly schema: typeof AUDIT_SCHEMA;
  readonly version: typeof AUDIT_VERSION;
  readonly auditKind: PersistenceAuditInput['auditKind'];
  readonly correlationId: string;
  readonly occurredAtMs: number;
  readonly checkpointRevision: number;
  readonly checkpointChecksum: string;
  readonly trace: Readonly<SystemTraceEvent> | null;
}

export interface PersistenceStartupInput {
  readonly startedAtMs: number;
  readonly correlationId: string;
}

export interface PersistenceShutdownInput {
  readonly stoppedAtMs: number;
  readonly correlationId: string;
  readonly clean: boolean;
  readonly componentStates: readonly Readonly<{
    componentId: SystemComponentId;
    desiredState: 'STOPPED' | 'RUNNING' | 'PAUSED';
    generation: number;
  }>[];
}

export interface ControlPersistenceActor {
  readonly id: string;
  readonly email: string | null;
  readonly source: 'loopback' | 'cloudflare-access';
}

export interface ControlPersistenceCommit {
  readonly request: Readonly<SystemControlMutationRequest>;
  readonly actor: Readonly<ControlPersistenceActor>;
  readonly requestDigest: string;
  readonly before: Readonly<SystemControlState>;
  readonly after: Readonly<SystemControlState>;
  readonly applied: boolean;
  readonly code: string;
}

export type ControlRuntimePublicationState = 'NOT_REQUIRED' | 'PENDING' | 'PUBLISHED' | 'UNKNOWN';

export interface ControlRuntimePublicationCommit {
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly correlationId: string;
  readonly occurredAtMs: number;
}

export type ControlRuntimePublicationResult =
  | { readonly kind: 'PUBLISHED' }
  | { readonly kind: 'IDEMPOTENT_REPLAY' };

export interface ControlRejectionAudit {
  readonly dedupeKey: string;
  readonly idempotencyKey: string | null;
  readonly requestDigest: string;
  readonly command: string | null;
  readonly expectedRevision: number | null;
  readonly currentRevision: number;
  readonly code: string;
  readonly message: string;
  readonly correlationId: string;
  readonly occurredAtMs: number;
  readonly actor: Readonly<ControlPersistenceActor>;
  readonly applied: false;
}

export type ControlPersistenceResult =
  | {
      readonly kind: 'COMMITTED';
      readonly receipt: Readonly<SystemControlMutationReceipt>;
      readonly runtimePublication: ControlRuntimePublicationState;
    }
  | {
      readonly kind: 'IDEMPOTENT_REPLAY';
      readonly requestDigest: string;
      readonly receipt: Readonly<SystemControlMutationReceipt>;
      readonly runtimePublication: ControlRuntimePublicationState;
    }
  | { readonly kind: 'IDEMPOTENCY_CONFLICT'; readonly requestDigest: string }
  | { readonly kind: 'REVISION_CONFLICT'; readonly current: Readonly<SystemControlState> };

export type ControlRejectionPersistenceResult =
  | { readonly kind: 'RECORDED'; readonly ledgerEventId: number }
  | { readonly kind: 'IDEMPOTENT_REPLAY'; readonly ledgerEventId: number };

interface StoredControlReceipt extends Record<string, SystemJsonValue> {
  readonly kind: 'CONTROL_MUTATION';
  readonly applied: boolean;
  readonly code: string;
  readonly command: string;
  readonly mutation: SystemJsonValue;
  readonly actorIdDigest: string;
  readonly actorSource: 'loopback' | 'cloudflare-access';
  readonly reasonDigest: string;
  readonly runtimePublication: ControlRuntimePublicationState;
  readonly before: SystemJsonValue;
  readonly after: SystemJsonValue;
}

const VALIDATE_ONLY_RECORD_FIELDS = Object.freeze([
  'schema', 'recordId', 'disposition', 'rootCorrelationId', 'executionCorrelationId',
  'evaluatedAtMs', 'operatorMode', 'capitalReservationDialect', 'executionAuthority',
  'liveExecutionPermitted', 'truthLabels', 'releaseStatuses', 'canonicalProposalId',
  'sourceProposalId', 'reservationId', 'stagedPlanId', 'mandateId', 'approvalId',
  'approvalDecision', 'approvalState', 'riskVerdict', 'boundRiskDecision',
  'riskPlanBinding', 'executionPlan', 'executionState', 'reconciliation', 'recoveryRecommendations', 'supervision',
  'failure', 'ownerInvocations',
  'venueAudit',
] as const);

const VALIDATE_ONLY_DISPOSITIONS = new Set([
  'MODE_BLOCKED', 'INPUT_REJECTED', 'APPROVAL_REJECTED', 'RISK_REJECTED',
  'EXECUTION_PREFLIGHT_REJECTED', 'RECONCILIATION_BLOCKED', 'PERSISTENCE_FAILED', 'READY',
]);

const PLAN_LIFECYCLES = new Set([
  'CREATED', 'AWAITING_APPROVAL', 'PREFLIGHTING', 'READY', 'OPENING', 'ONE_LEG_EXPOSED',
  'HEDGED_OPEN', 'CLOSE_REQUESTED', 'CLOSING', 'RECONCILING', 'CLOSED',
  'RECOVERY_REQUIRED', 'FAILED', 'CANCELLED', 'EXPIRED',
]);

function validRecoveryRecommendations(value: unknown): boolean {
  return Array.isArray(value)
    && value.length <= 16
    && value.every((entry) => isRecord(entry)
      && hasExactKeys(entry, ['action', 'riskEffect', 'reason', 'phase', 'legKey', 'clientOrderId', 'automatic'])
      && (RECOVERY_ACTIONS as readonly unknown[]).includes(entry.action)
      && ['NEUTRAL', 'RISK_REDUCING', 'RISK_INCREASING'].includes(String(entry.riskEffect))
      && typeof entry.reason === 'string'
      && entry.reason.length >= 1
      && entry.reason.length <= 512
      && !SENSITIVE_TEXT.test(entry.reason)
      && (entry.phase === null || entry.phase === 'OPEN' || entry.phase === 'CLOSE')
      && (entry.legKey === null || entry.legKey === 'SPOT' || entry.legKey === 'PERP')
      && (entry.clientOrderId === null || BOUNDED_ID.test(String(entry.clientOrderId)))
      && entry.automatic === false);
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function validReconciliationProjection(value: unknown, planId: string): boolean {
  return isRecord(value)
    && BOUNDED_ID.test(String(value.planId))
    && value.planId === planId
    && CORRELATION_ID.test(String(value.correlationId))
    && value.executionAuthority === 'NONE'
    && ['EXACT', 'PENDING', 'PARTIAL', 'AMBIGUOUS', 'DIVERGED', 'STALE', 'UNAVAILABLE'].includes(String(value.status))
    && validUtcMillis(value.evaluatedAtMs);
}

function validSupervisionProjection(
  value: unknown,
  currentRootCorrelationId: string,
  evaluatedAtMs: number,
): boolean {
  if (!isRecord(value) || !hasExactKeys(value, [
    'rootCorrelationId', 'executionCorrelationId', 'planId', 'truthLabel',
    'executionAuthority', 'state', 'reconciliation',
  ])) return false;
  if (!CORRELATION_ID.test(String(value.rootCorrelationId))
    || value.rootCorrelationId === currentRootCorrelationId
    || !CORRELATION_ID.test(String(value.executionCorrelationId))
    || !BOUNDED_ID.test(String(value.planId))
    || value.truthLabel !== 'SYNTHETIC_ONLY'
    || value.executionAuthority !== 'NONE'
    || !isRecord(value.state)) return false;
  const state = value.state;
  if (!hasExactKeys(state, [
    'plan', 'lifecycle', 'revision', 'stateRevisionId', 'lastSequence', 'createdAtMs',
    'updatedAtMs', 'exposedSinceMs', 'approval', 'preflight', 'openingLegs',
    'closingLegs', 'processedEventIds', 'eventLog', 'failures',
  ])
    || !isRecord(state.plan)
    || !PLAN_LIFECYCLES.has(String(state.lifecycle))
    || !Number.isSafeInteger(state.revision)
    || (state.revision as number) < 0
    || !Number.isSafeInteger(state.lastSequence)
    || (state.lastSequence as number) < 0
    || !BOUNDED_ID.test(String(state.stateRevisionId))
    || !validUtcMillis(state.createdAtMs)
    || !validUtcMillis(state.updatedAtMs)
    || (state.createdAtMs as number) > (state.updatedAtMs as number)
    || (state.updatedAtMs as number) > evaluatedAtMs
    || (state.exposedSinceMs !== null && (!validUtcMillis(state.exposedSinceMs) || state.exposedSinceMs > evaluatedAtMs))
    || !Array.isArray(state.processedEventIds)
    || state.processedEventIds.length > SYSTEM_PERSISTENCE_LIMITS.maximumArrayLength
    || state.processedEventIds.some((entry) => !BOUNDED_ID.test(String(entry)))
    || !Array.isArray(state.eventLog)
    || state.eventLog.length > SYSTEM_PERSISTENCE_LIMITS.maximumArrayLength
    || !Array.isArray(state.failures)
    || state.failures.length > SYSTEM_PERSISTENCE_LIMITS.maximumArrayLength) return false;
  const plan = state.plan;
  if (!hasExactKeys(plan, [
    'planId', 'correlationId', 'termsFingerprint', 'strategy', 'direction', 'symbol',
    'proposal', 'attempt', 'mode', 'requiresApproval', 'maxNakedDurationMs',
    'openingOrder', 'openingLegs', 'closingLegs',
  ])
    || plan.planId !== value.planId
    || plan.correlationId !== value.executionCorrelationId
    || !['VALIDATE_ONLY', 'PAPER'].includes(String(plan.mode))) return false;
  return value.reconciliation === null
    || validReconciliationProjection(value.reconciliation, String(value.planId));
}

function validApprovalStateProjection(value: unknown, approvalId: string): value is Record<string, unknown> {
  if (!isRecord(value)
    || !hasExactKeys(value, ['approval', 'sourcePolicyDigest', 'revision', 'uses'])
    || !isRecord(value.approval)
    || value.approval.id !== approvalId
    || !BOUNDED_ID.test(String(value.sourcePolicyDigest))
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1
    || !Array.isArray(value.uses)
    || value.uses.length > SYSTEM_PERSISTENCE_LIMITS.maximumIdempotencyReceipts) return false;
  const identities: string[] = [];
  for (const use of value.uses) {
    if (!isRecord(use) || !hasExactKeys(use, [
      'idempotencyKey', 'useScopeKey', 'contextDigest', 'actionClass',
      'requestedNotional', 'recordedAtMs',
    ])
      || !IDEMPOTENCY_KEY.test(String(use.idempotencyKey))
      || !BOUNDED_ID.test(String(use.useScopeKey))
      || !BOUNDED_ID.test(String(use.contextDigest))
      || !/^[A-Z][A-Z0-9_]{0,63}$/.test(String(use.actionClass))
      || typeof use.requestedNotional !== 'string'
      || use.requestedNotional.length < 1
      || use.requestedNotional.length > 128
      || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(use.requestedNotional)
      || !validUtcMillis(use.recordedAtMs)) return false;
    identities.push(`${use.idempotencyKey}:${use.contextDigest}`);
  }
  return new Set(identities).size === identities.length;
}

function approvalStateFromIdempotencyReceipt(
  persisted: Readonly<PersistedIdempotencyReceipt>,
): Readonly<{ approvalId: string; state: Readonly<OperatorApprovalState> }> | null {
  if (!isRecord(persisted.receipt)
    || persisted.receipt.kind !== 'VALIDATE_ONLY_RUN'
    || !isRecord(persisted.receipt.record)
    || !isRecord(persisted.receipt.record.ownerInvocations)
    || persisted.receipt.record.ownerInvocations.approvalUseReductions !== 1) return null;
  const approvalId = String(persisted.receipt.record.approvalId);
  const candidate = persisted.receipt.record.approvalState;
  if (!validApprovalStateProjection(candidate, approvalId)) {
    throw new Error('persisted validate-only approval state is corrupt');
  }
  return Object.freeze({
    approvalId,
    state: candidate as unknown as Readonly<OperatorApprovalState>,
  });
}

function latestValidateOnlyApprovalStateFromCheckpoint(
  state: Readonly<SystemIntegrationCheckpointState>,
  approvalId: string,
  durableBaseline: Readonly<OperatorApprovalState> | null = null,
): Readonly<OperatorApprovalState> | null {
  const revisions = new Map<number, {
    readonly state: Readonly<OperatorApprovalState>;
    readonly bytes: string;
  }>();
  if (durableBaseline !== null) {
    revisions.set(durableBaseline.revision, {
      state: durableBaseline,
      bytes: canonicalPersistenceJson(durableBaseline),
    });
  }
  for (const persisted of state.idempotencyReceipts) {
    const projected = approvalStateFromIdempotencyReceipt(persisted);
    if (projected === null || projected.approvalId !== approvalId) continue;
    const bytes = canonicalPersistenceJson(projected.state);
    const typed = projected.state;
    const existing = revisions.get(typed.revision);
    if (existing && existing.bytes !== bytes) {
      throw new Error('persisted validate-only approval state has a same-revision history conflict');
    }
    revisions.set(typed.revision, { state: typed, bytes });
  }
  const ordered = [...revisions.values()].sort((left, right) => left.state.revision - right.state.revision);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1].state;
    const current = ordered[index].state;
    if (current.revision !== previous.revision + 1
      || !validateApprovalStateContinuation(previous, current)) {
      throw new Error('persisted validate-only approval state history is discontinuous');
    }
  }
  return ordered.at(-1)?.state ?? null;
}

function assertApprovalStateCompareAndSet(
  state: Readonly<SystemIntegrationCheckpointState>,
  record: Readonly<Record<string, SystemJsonValue>>,
  latestDurable: Readonly<OperatorApprovalState> | null = null,
): void {
  if (!isRecord(record.ownerInvocations)
    || record.ownerInvocations.approvalUseReductions !== 1) return;
  const approvalId = String(record.approvalId);
  if (!validApprovalStateProjection(record.approvalState, approvalId)) {
    throw new Error('validate-only approval state is invalid');
  }
  const incoming = record.approvalState as unknown as Readonly<OperatorApprovalState>;
  const latest = latestValidateOnlyApprovalStateFromCheckpoint(state, approvalId, latestDurable);
  if (latest === null) return;
  const incomingBytes = canonicalPersistenceJson(incoming);
  const latestBytes = canonicalPersistenceJson(latest);
  if (incoming.revision < latest.revision) throw new Error('validate-only approval state is stale');
  if (incoming.revision === latest.revision) {
    if (incomingBytes !== latestBytes) throw new Error('validate-only approval state compare-and-set conflict');
    return;
  }
  if (incoming.revision !== latest.revision + 1
    || incoming.uses.length !== latest.uses.length + 1
    || canonicalPersistenceJson(incoming.uses.slice(0, latest.uses.length)) !== canonicalPersistenceJson(latest.uses)) {
    throw new Error('validate-only approval state history is not an exact one-step extension');
  }
}

function validateOnlyRecord(record: unknown): PersistenceResult<Readonly<Record<string, SystemJsonValue>>> {
  if (!isRecord(record)) return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only persistence record must be an object');
  const keys = Object.keys(record).sort();
  const expected = [...VALIDATE_ONLY_RECORD_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only persistence record contains missing or unknown fields');
  }
  if (record.schema !== 'cosmos.system-integration.validate-only.v2'
    || record.operatorMode !== 'VALIDATE_ONLY'
    || !['OWNER_SUPPLIED_MANUAL_ARMED_ENVELOPE', 'UNAVAILABLE_OR_UNVALIDATED'].includes(String(record.capitalReservationDialect))
    || record.executionAuthority !== 'NONE'
    || record.liveExecutionPermitted !== false
    || !VALIDATE_ONLY_DISPOSITIONS.has(String(record.disposition))
    || !BOUNDED_ID.test(String(record.recordId))
    || !CORRELATION_ID.test(String(record.rootCorrelationId))
    || !validUtcMillis(record.evaluatedAtMs)) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only authority envelope is invalid');
  }
  if (record.executionCorrelationId !== null && !CORRELATION_ID.test(String(record.executionCorrelationId))) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only execution correlation is invalid');
  }
  if (record.failure !== null && !isStructuredFailure(record.failure)) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only structured failure is invalid');
  }
  const riskVerdictHasUnknown = isRecord(record.riskVerdict)
    && Array.isArray(record.riskVerdict.checks)
    && record.riskVerdict.checks.some((check) => isRecord(check) && check.status === 'UNKNOWN');
  const dryRunObserved = record.executionPlan !== null
    || record.supervision !== null
    || (record.riskVerdict !== null && !riskVerdictHasUnknown);
  const expectedTruthLabels = dryRunObserved
    ? ['DRY_RUN', 'SYNTHETIC_ONLY']
    : ['UNAVAILABLE', 'SYNTHETIC_ONLY'];
  const expectedReleaseStatuses = record.disposition === 'READY'
    ? ['BUILT_AND_TESTED', 'SYNTHETIC_ONLY']
    : ['BUILT_AND_TESTED', 'SYNTHETIC_ONLY', 'BLOCKED'];
  if (!Array.isArray(record.truthLabels)
    || !sameJson(record.truthLabels, expectedTruthLabels)
    || !Array.isArray(record.releaseStatuses)
    || !sameJson(record.releaseStatuses, expectedReleaseStatuses)
    || record.releaseStatuses.some((value) => !(SYSTEM_RELEASE_STATUSES as readonly unknown[]).includes(value))
    || record.releaseStatuses.includes('WIRED')
    || (record.disposition === 'MODE_BLOCKED' && record.capitalReservationDialect !== 'UNAVAILABLE_OR_UNVALIDATED')
    || (dryRunObserved && record.capitalReservationDialect !== 'OWNER_SUPPLIED_MANUAL_ARMED_ENVELOPE')) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only truth or release labels are invalid');
  }
  for (const field of [
    'canonicalProposalId', 'sourceProposalId', 'reservationId', 'stagedPlanId', 'mandateId', 'approvalId',
  ]) {
    const value = record[field];
    if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
      return failed('INVALID_PERSISTENCE_REQUEST', `validate-only ${field} is invalid`);
    }
  }
  if (!isRecord(record.venueAudit)
    || record.venueAudit.sealed !== true
    || record.venueAudit.submissionCalls !== 0
    || record.venueAudit.lookupCalls !== 0
    || record.venueAudit.reconciliationCalls !== 0) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only venue audit proves an out-of-process action seam was reached');
  }
  const venueAudit = record.venueAudit;
  const venueAuditKeys = Object.keys(venueAudit).sort().join('|');
  if (venueAuditKeys !== [
    'sealed', 'identityClaims', 'preflightCalls', 'validationCalls', 'submissionCalls',
    'lookupCalls', 'reconciliationCalls', 'callOrder',
  ].sort().join('|')
    || ['identityClaims', 'preflightCalls', 'validationCalls', 'submissionCalls', 'lookupCalls', 'reconciliationCalls']
      .some((key) => !Number.isSafeInteger(venueAudit[key]) || (venueAudit[key] as number) < 0)
    || !Array.isArray(venueAudit.callOrder)
    || venueAudit.callOrder.length > 32
    || venueAudit.callOrder.some((entry) => typeof entry !== 'string' || entry.length > 96)) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only venue audit is malformed or unbounded');
  }
  if (!isRecord(record.ownerInvocations)
    || Object.keys(record.ownerInvocations).sort().join('|') !== [
      'approvalEvaluations', 'approvalUseReductions', 'riskEvaluations', 'executionDefinitionsCreated',
      'coordinatorsCreated', 'coordinatorPreflights', 'reconciliationEvaluations', 'recoveryEvaluations',
      'persistenceReads', 'persistenceWrites',
    ].sort().join('|')
    || Object.values(record.ownerInvocations).some((value) => ![0, 1].includes(value as number))
    || record.ownerInvocations.persistenceWrites !== 1) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only owner invocation evidence is malformed or unbounded');
  }
  const recoveryRecommendations = Array.isArray(record.recoveryRecommendations)
    ? record.recoveryRecommendations
    : [];
  if (!validRecoveryRecommendations(record.recoveryRecommendations)
    || ((record.ownerInvocations.recoveryEvaluations === 1) !== (recoveryRecommendations.length > 0))
    || (record.ownerInvocations.recoveryEvaluations === 1
      && !isRecord(record.executionState)
      && !isRecord(record.supervision))) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only recovery evidence is malformed or not owner-bound');
  }
  if (record.approvalState !== null
    && !validApprovalStateProjection(record.approvalState, String(record.approvalId))) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only approval state projection is invalid');
  }
  if (record.ownerInvocations.approvalUseReductions === 1 && record.approvalState === null) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only approval reduction is missing its owner state');
  }
  if (record.supervision !== null) {
    if (!validSupervisionProjection(record.supervision, String(record.rootCorrelationId), Number(record.evaluatedAtMs))
      || record.disposition !== 'RISK_REJECTED'
      || record.executionPlan !== null
      || record.executionState !== null
      || record.reconciliation !== null
      || record.riskPlanBinding !== null
      || !isRecord(record.riskVerdict)
      || record.riskVerdict.allowed !== false) {
      return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only prior-plan supervision projection is invalid or cross-bound');
    }
  }
  if (record.executionPlan !== null) {
    if (!isRecord(record.executionPlan)
      || record.executionPlan.mode !== 'VALIDATE_ONLY'
      || !BOUNDED_ID.test(String(record.executionPlan.planId))
      || !CORRELATION_ID.test(String(record.executionPlan.correlationId))
      || record.executionCorrelationId !== record.executionPlan.correlationId
      || !isRecord(record.riskPlanBinding)
      || !hasExactKeys(record.riskPlanBinding, [
        'planId', 'executionCorrelationId', 'foundationTermsFingerprint', 'riskDecisionId',
        'mandateDigest', 'riskIntentDigest', 'executionTermsDigest',
      ])
      || record.riskPlanBinding.planId !== record.executionPlan.planId
      || record.riskPlanBinding.executionCorrelationId !== record.executionPlan.correlationId
      || record.riskPlanBinding.foundationTermsFingerprint !== record.executionPlan.termsFingerprint
      || !BOUNDED_ID.test(String(record.riskPlanBinding.riskDecisionId))
      || !DIGEST.test(String(record.riskPlanBinding.mandateDigest))
      || !/^riskint_[0-9a-f]{32}$/.test(String(record.riskPlanBinding.riskIntentDigest))
      || !/^[0-9a-f]{32}$/.test(String(record.riskPlanBinding.executionTermsDigest))
      || !isRecord(record.boundRiskDecision)
      || record.boundRiskDecision.decisionId !== record.riskPlanBinding.riskDecisionId
      || record.boundRiskDecision.mandateId !== record.mandateId
      || record.boundRiskDecision.mandateDigest !== record.riskPlanBinding.mandateDigest
      || record.boundRiskDecision.externalPlanId !== record.executionPlan.planId
      || record.boundRiskDecision.correlationId !== record.executionPlan.correlationId
      || !isRecord(record.riskVerdict)
      || record.riskVerdict.allowed !== true) {
      return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only execution plan is invalid');
    }
    if (record.executionState !== null && (
      !isRecord(record.executionState)
      || !isRecord(record.executionState.plan)
      || record.executionState.plan.planId !== record.executionPlan.planId
      || record.executionState.plan.correlationId !== record.executionPlan.correlationId
      || record.executionState.plan.termsFingerprint !== record.executionPlan.termsFingerprint
    )) return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only execution state is not bound to its plan');
  } else if (record.riskPlanBinding !== null || record.executionCorrelationId !== null || record.executionState !== null) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'pre-plan validate-only record contains plan-only binding state');
  }
  if (record.reconciliation !== null) {
    if (!isRecord(record.reconciliation)
      || !BOUNDED_ID.test(String(record.reconciliation.planId))
      || record.reconciliation.executionAuthority !== 'NONE'
      || !['EXACT', 'PENDING', 'PARTIAL', 'AMBIGUOUS', 'DIVERGED', 'STALE', 'UNAVAILABLE'].includes(String(record.reconciliation.status))
      || !validUtcMillis(record.reconciliation.evaluatedAtMs)) {
      return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only reconciliation result is invalid');
    }
    if (isRecord(record.executionPlan) && record.reconciliation.planId !== record.executionPlan.planId) {
      return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only reconciliation is not bound to its execution plan');
    }
    if (!isRecord(record.executionPlan)) {
      return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only reconciliation has no execution plan owner');
    }
  }
  if (record.ownerInvocations.recoveryEvaluations === 1) {
    const recoveryState = isRecord(record.executionState)
      ? record.executionState
      : isRecord(record.supervision) && isRecord(record.supervision.state)
        ? record.supervision.state
        : null;
    if (recoveryState === null) {
      return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only recovery evidence has no execution-state owner');
    }
    try {
      const canonicalRecovery = recommendExecutionRecovery(
        recoveryState as unknown as ExecutionPlanState,
        Number(record.evaluatedAtMs),
      );
      if (!sameJson(record.recoveryRecommendations, canonicalRecovery)) {
        return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only recovery evidence differs from the canonical owner projection');
      }
    } catch {
      return failed('INVALID_PERSISTENCE_REQUEST', 'validate-only recovery owner projection is invalid');
    }
  }
  if (record.disposition === 'READY' && (
    !isRecord(record.executionPlan)
    || !isRecord(record.reconciliation)
    || record.reconciliation.status !== 'EXACT'
    || record.ownerInvocations.recoveryEvaluations !== 1
  )) {
    return failed('INVALID_PERSISTENCE_REQUEST', 'READY validate-only record lacks exact reconciled owner truth');
  }
  try {
    const encoded = canonicalPersistenceJson(record);
    return { ok: true, value: JSON.parse(encoded) as Record<string, SystemJsonValue> };
  } catch (error) {
    return failed('INVALID_PERSISTENCE_REQUEST', errorMessage(error, 'validate-only record is not bounded secret-free data'));
  }
}

/**
 * One managed adapter over the existing Ledger. Construction and imports are
 * inert; all reads and writes happen only through explicit methods.
 */
export class SystemLedgerPersistenceAdapter {
  private stateValue: Readonly<SystemIntegrationCheckpointState> | null = null;
  private loadedSerializedValue: string | null = null;
  private loadFailure: Readonly<{ code: 'PERSISTENCE_CORRUPT' | 'PERSISTENCE_READ_FAILED'; message: string }> | null = null;
  private sealed = false;
  private finalShutdownReceipt: Readonly<PersistedCommitReceipt> | null = null;

  constructor(private readonly ledger: LedgerPersistencePort) {
    if (!ledger
      || typeof ledger.getConfigValue !== 'function'
      || typeof ledger.setConfigValueAndLogEvent !== 'function'
      || typeof ledger.recentEvents !== 'function') {
      throw new TypeError('SystemLedgerPersistenceAdapter requires the existing Ledger structural port');
    }
  }

  private durableIdempotencyReceipt(
    idempotencyKey: string,
  ): PersistenceResult<Readonly<DurableIdempotencyReadback> | null> {
    let rows: LedgerEventRecord[];
    try {
      rows = this.ledger.recentEvents(
        MAX_IDEMPOTENCY_EVENT_READBACK + 1,
        idempotencyEventKind(idempotencyKey),
      );
    } catch (error) {
      return failed(
        'PERSISTENCE_READ_FAILED',
        errorMessage(error, 'durable idempotency readback failed'),
      );
    }
    if (rows.length === 0) return { ok: true, value: null };
    if (rows.length > MAX_IDEMPOTENCY_EVENT_READBACK) {
      return failed('PERSISTENCE_CORRUPT', 'durable idempotency evidence exceeds its revision bound');
    }

    let newest: Readonly<DurableIdempotencyReadback> | null = null;
    let canonicalIntent: Readonly<PersistedIdempotencyReceipt> | null = null;
    let canonicalEventIdentity: number | null = null;
    let hasCanonicalEventIdentity = false;
    for (const row of rows) {
      if (!isRecord(row.data)
        || Object.keys(row.data).length !== 4
        || row.data.schema !== IDEMPOTENCY_AUDIT_SCHEMA
        || row.data.version !== IDEMPOTENCY_AUDIT_VERSION
        || !validPersistedIdempotencyReceipt(row.data.receipt)
        || row.data.receipt.idempotencyKey !== idempotencyKey) {
        return failed(
          'PERSISTENCE_CORRUPT',
          'durable idempotency evidence is malformed or conflicts with its indexed key',
        );
      }
      const canonicalLedgerEventId = row.data.canonicalLedgerEventId;
      if (canonicalLedgerEventId !== 'SELF'
        && canonicalLedgerEventId !== null
        && (!Number.isSafeInteger(canonicalLedgerEventId) || Number(canonicalLedgerEventId) < 1)) {
        return failed('PERSISTENCE_CORRUPT', 'durable idempotency event identity is invalid');
      }
      const candidate = row.data.receipt;
      const resolvedEventIdentity = canonicalLedgerEventId === 'SELF'
        ? row.id
        : canonicalLedgerEventId === null
          ? null
          : Number(canonicalLedgerEventId);
      if (hasCanonicalEventIdentity && canonicalEventIdentity !== resolvedEventIdentity) {
        return failed('PERSISTENCE_CORRUPT', 'durable idempotency event identity changed across revisions');
      }
      canonicalEventIdentity = resolvedEventIdentity;
      hasCanonicalEventIdentity = true;
      if (canonicalIntent === null) {
        canonicalIntent = candidate;
      } else {
        const candidateReceipt = isRecord(candidate.receipt) ? candidate.receipt : null;
        const canonicalReceipt = isRecord(canonicalIntent.receipt) ? canonicalIntent.receipt : null;
        const candidatePublication = controlRuntimePublicationForArchive(candidate);
        const canonicalPublication = controlRuntimePublicationForArchive(canonicalIntent);
        const sameReceipt = candidatePublication === null && canonicalPublication === null
          ? sameJson(candidate.receipt, canonicalIntent.receipt)
          : candidateReceipt !== null && canonicalReceipt !== null
            && candidatePublication !== 'INVALID'
            && canonicalPublication !== 'INVALID'
            && sameJson(
              { ...candidateReceipt, runtimePublication: 'CONTROL_PUBLICATION_STATE' },
              { ...canonicalReceipt, runtimePublication: 'CONTROL_PUBLICATION_STATE' },
            )
            && (candidatePublication === canonicalPublication
              || (canonicalPublication === 'PUBLISHED'
                && (candidatePublication === 'PENDING' || candidatePublication === 'UNKNOWN')));
        if (candidate.requestDigest !== canonicalIntent.requestDigest
          || candidate.correlationId !== canonicalIntent.correlationId
          || candidate.recordedAtMs !== canonicalIntent.recordedAtMs
          || candidate.checkpointRevision !== canonicalIntent.checkpointRevision
          || !sameReceipt) {
          return failed('PERSISTENCE_CORRUPT', 'durable idempotency evidence conflicts across revisions');
        }
      }
      if (newest === null) {
        newest = Object.freeze({
          receipt: candidate,
          ledgerEventId: resolvedEventIdentity,
        });
      }
    }
    return { ok: true, value: newest };
  }

  private durableApprovalState(
    approvalId: string,
  ): PersistenceResult<Readonly<OperatorApprovalState> | null> {
    let rows: LedgerEventRecord[];
    try {
      rows = this.ledger.recentEvents(
        MAX_APPROVAL_STATE_EVENT_READBACK,
        approvalStateEventKind(approvalId),
      );
    } catch (error) {
      return failed('PERSISTENCE_READ_FAILED', errorMessage(error, 'durable approval-state readback failed'));
    }
    let newest: Readonly<OperatorApprovalState> | null = null;
    for (const row of rows) {
      if (!isRecord(row.data)
        || Object.keys(row.data).length !== 4
        || row.data.schema !== APPROVAL_STATE_AUDIT_SCHEMA
        || row.data.version !== APPROVAL_STATE_AUDIT_VERSION
        || row.data.approvalId !== approvalId
        || !validApprovalStateProjection(row.data.state, approvalId)) {
        return failed('PERSISTENCE_CORRUPT', 'durable approval-state evidence is malformed or conflicts with its indexed owner');
      }
      const candidate = row.data.state as unknown as Readonly<OperatorApprovalState>;
      if (newest === null) {
        newest = candidate;
      } else if (!validateApprovalStateContinuation(candidate, newest)) {
        return failed('PERSISTENCE_CORRUPT', 'durable approval-state evidence regressed or conflicts across revisions');
      }
    }
    return { ok: true, value: newest };
  }

  private latestValidateOnlyApprovalState(
    state: Readonly<SystemIntegrationCheckpointState>,
    approvalId: string,
  ): PersistenceResult<Readonly<OperatorApprovalState> | null> {
    const durable = this.durableApprovalState(approvalId);
    if (!durable.ok) return durable;
    try {
      return {
        ok: true,
        value: latestValidateOnlyApprovalStateFromCheckpoint(state, approvalId, durable.value),
      };
    } catch (error) {
      return failed(
        'PERSISTENCE_CORRUPT',
        errorMessage(error, 'checkpoint approval-state evidence conflicts with its durable archive'),
      );
    }
  }

  private withProductIdentityRestartBarrier(
    base: Readonly<RestartBarrierProjection>,
    state: Readonly<SystemIntegrationCheckpointState>,
  ): Readonly<RestartBarrierProjection> {
    const reasonCodes = new Set(base.reasonCodes);
    let blocked = false;
    if (typeof this.ledger.readProductBlockingIdentityReferences !== 'function') {
      reasonCodes.add('PRODUCT_IDENTITY_REFERENCE_READ_UNAVAILABLE');
      blocked = true;
    } else {
      try {
        const references = this.ledger.readProductBlockingIdentityReferences(
          SYSTEM_PERSISTENCE_LIMITS.maximumAuthorityReferences,
        );
        if (references.length > 0) {
          blocked = true;
          reasonCodes.add('UNRESOLVED_PRODUCT_IDENTITY_REFERENCES');
          for (const referenceType of [...new Set(references.map((reference) => reference.referenceType))].sort()) {
            reasonCodes.add(`UNRESOLVED_PRODUCT_IDENTITY_REFERENCE_${referenceType}`);
          }
        }
      } catch {
        reasonCodes.add('PRODUCT_IDENTITY_REFERENCE_READ_FAILED');
        blocked = true;
      }
    }
    const pendingPublications = this.controlRuntimePublicationReferences(state);
    if (pendingPublications === null) {
      blocked = true;
      reasonCodes.add('CONTROL_RUNTIME_PUBLICATION_READ_FAILED');
    } else if (pendingPublications.length > 0) {
      blocked = true;
      reasonCodes.add('CONTROL_COMMITTED_RUNTIME_PENDING');
      if (pendingPublications.some((entry) => entry.state === 'UNKNOWN')) {
        reasonCodes.add('CONTROL_RUNTIME_PUBLICATION_EFFECT_UNKNOWN');
      }
    }
    if (!blocked) return base;
    return Object.freeze({
      ...base,
      canOpenOrIncrease: false,
      reasonCodes: Object.freeze([...reasonCodes].sort()),
      activeReservationIds: Object.freeze([...base.activeReservationIds]),
      usableApprovalIds: Object.freeze([...base.usableApprovalIds]),
      reconciliationRequiredPlanIds: Object.freeze([...base.reconciliationRequiredPlanIds]),
    });
  }

  load(nowMs: number, emptyCorrelationId = 'system-integration-cold-start'): PersistenceLoadResult {
    if (!validUtcMillis(nowMs) || !CORRELATION_ID.test(emptyCorrelationId)) {
      return {
        ok: false,
        code: 'PERSISTENCE_READ_FAILED',
        message: 'load input is invalid',
        barrier: failClosedRestartBarrier(validUtcMillis(nowMs) ? nowMs : 0, 'PERSISTENCE_READ_FAILED'),
      };
    }
    try {
      const serialized = this.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY);
      if (serialized === null) {
        const state = createInitialCheckpointState(nowMs, emptyCorrelationId);
        this.stateValue = state;
        this.loadedSerializedValue = null;
        this.loadFailure = null;
        return {
          ok: true,
          source: 'EMPTY',
          state,
          barrier: this.withProductIdentityRestartBarrier(evaluateRestartBarrier(state, nowMs), state),
        };
      }
      const decoded = decodeSystemCheckpoint(serialized);
      if (!decoded.ok) {
        this.stateValue = null;
        this.loadedSerializedValue = serialized;
        this.loadFailure = { code: 'PERSISTENCE_CORRUPT', message: decoded.message };
        return {
          ok: false,
          code: 'PERSISTENCE_CORRUPT',
          message: decoded.message,
          barrier: failClosedRestartBarrier(nowMs, 'PERSISTENCE_CORRUPT'),
        };
      }
      this.stateValue = decoded.value;
      this.loadedSerializedValue = serialized;
      this.loadFailure = null;
      return {
        ok: true,
        source: 'CHECKPOINT',
        state: decoded.value,
        barrier: this.withProductIdentityRestartBarrier(evaluateRestartBarrier(decoded.value, nowMs), decoded.value),
      };
    } catch (error) {
      const message = errorMessage(error, 'existing Ledger could not read the integration checkpoint');
      this.stateValue = null;
      this.loadedSerializedValue = null;
      this.loadFailure = { code: 'PERSISTENCE_READ_FAILED', message };
      return {
        ok: false,
        code: 'PERSISTENCE_READ_FAILED',
        message,
        barrier: failClosedRestartBarrier(nowMs, 'PERSISTENCE_READ_FAILED'),
      };
    }
  }

  currentState(): PersistenceResult<Readonly<SystemIntegrationCheckpointState>> {
    if (this.loadFailure) return failed(this.loadFailure.code, this.loadFailure.message);
    if (this.stateValue === null) return failed('PERSISTENCE_NOT_LOADED', 'integration checkpoint has not been loaded');
    return { ok: true, value: cloneCheckpointState(this.stateValue) };
  }

  restartBarrier(nowMs: number): PersistenceResult<ReturnType<typeof evaluateRestartBarrier>> {
    const current = this.currentState();
    if (!current.ok) return current;
    if (!validUtcMillis(nowMs)) return failed('INVALID_PERSISTENCE_REQUEST', 'restart barrier time is invalid');
    return {
      ok: true,
      value: this.withProductIdentityRestartBarrier(evaluateRestartBarrier(current.value, nowMs), current.value),
    };
  }

  private productPersistenceWriteReady(): PersistenceResult<true> {
    if (this.sealed) return failed('PERSISTENCE_SEALED', 'final shutdown checkpoint has sealed this adapter');
    const current = this.currentState();
    if (!current.ok) return failed(current.code, current.message);
    try {
      if (this.ledger.probeWritable && !this.ledger.probeWritable(true)) {
        return failed('PERSISTENCE_WRITE_FAILED', 'existing Ledger is not writable');
      }
    } catch {
      return failed('PERSISTENCE_WRITE_FAILED', 'existing Ledger writability could not be proven');
    }
    return { ok: true, value: true };
  }

  private invokeProductPersistenceMutation(
    operation: () => ProductPersistenceMutationResult,
  ): PersistenceResult<Readonly<ProductPersistenceMutationResult>> {
    const ready = this.productPersistenceWriteReady();
    if (!ready.ok) return ready;
    try {
      return { ok: true, value: operation() };
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        return failed('INVALID_PERSISTENCE_REQUEST', 'product persistence request is invalid');
      }
      return failed('PERSISTENCE_WRITE_FAILED', errorMessage(error, 'product persistence transaction failed'));
    }
  }

  compareAndSetProductComponentDesiredState(
    input: Readonly<ProductDesiredStatePersistenceInput>,
  ): PersistenceResult<Readonly<ProductPersistenceMutationResult>> {
    if (typeof this.ledger.compareAndSetProductComponentDesiredState !== 'function') {
      return failed('PERSISTENCE_WRITE_FAILED', 'existing Ledger lacks product desired-state CAS capability');
    }
    return this.invokeProductPersistenceMutation(
      () => this.ledger.compareAndSetProductComponentDesiredState!(input),
    );
  }

  compareAndAppendProductCommand(
    input: Readonly<ProductCommandPersistenceInput>,
  ): PersistenceResult<Readonly<ProductPersistenceMutationResult>> {
    if (typeof this.ledger.compareAndAppendProductCommand !== 'function') {
      return failed('PERSISTENCE_WRITE_FAILED', 'existing Ledger lacks product command append capability');
    }
    return this.invokeProductPersistenceMutation(() => this.ledger.compareAndAppendProductCommand!(input));
  }

  recordProductConfigRevision(
    input: Readonly<ProductConfigRevisionPersistenceInput>,
  ): PersistenceResult<Readonly<ProductPersistenceMutationResult>> {
    if (typeof this.ledger.recordProductConfigRevision !== 'function') {
      return failed('PERSISTENCE_WRITE_FAILED', 'existing Ledger lacks product config revision capability');
    }
    return this.invokeProductPersistenceMutation(() => this.ledger.recordProductConfigRevision!(input));
  }

  compareAndUpsertProductIdentityReference(
    input: Readonly<ProductIdentityReferencePersistenceInput>,
  ): PersistenceResult<Readonly<ProductPersistenceMutationResult>> {
    if (typeof this.ledger.compareAndUpsertProductIdentityReference !== 'function') {
      return failed('PERSISTENCE_WRITE_FAILED', 'existing Ledger lacks product identity reference capability');
    }
    return this.invokeProductPersistenceMutation(
      () => this.ledger.compareAndUpsertProductIdentityReference!(input),
    );
  }

  readProductBlockingIdentityReferences(
    limit = 1_000,
  ): PersistenceResult<readonly Readonly<ProductIdentityReferenceRecord>[]> {
    const current = this.currentState();
    if (!current.ok) return current;
    if (typeof this.ledger.readProductBlockingIdentityReferences !== 'function') {
      return failed('PERSISTENCE_READ_FAILED', 'existing Ledger lacks product identity reference read capability');
    }
    try {
      return { ok: true, value: this.ledger.readProductBlockingIdentityReferences(limit) };
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        return failed('INVALID_PERSISTENCE_REQUEST', 'product identity reference query is invalid');
      }
      return failed('PERSISTENCE_READ_FAILED', errorMessage(error, 'product identity reference query failed'));
    }
  }

  compareAndTransitionProductIncident(
    input: Readonly<ProductIncidentPersistenceInput>,
  ): PersistenceResult<Readonly<ProductPersistenceMutationResult>> {
    if (typeof this.ledger.compareAndTransitionProductIncident !== 'function') {
      return failed('PERSISTENCE_WRITE_FAILED', 'existing Ledger lacks product incident transition capability');
    }
    return this.invokeProductPersistenceMutation(
      () => this.ledger.compareAndTransitionProductIncident!(input),
    );
  }

  compareAndSetProductBootReleaseRevision(
    input: Readonly<ProductBootReleasePersistenceInput>,
  ): PersistenceResult<Readonly<ProductPersistenceMutationResult>> {
    if (typeof this.ledger.compareAndSetProductBootReleaseRevision !== 'function') {
      return failed('PERSISTENCE_WRITE_FAILED', 'existing Ledger lacks product boot/release CAS capability');
    }
    return this.invokeProductPersistenceMutation(
      () => this.ledger.compareAndSetProductBootReleaseRevision!(input),
    );
  }

  readProductBootReleaseRevisions(
    limit = 20,
  ): PersistenceResult<readonly Readonly<ProductBootReleaseRecord>[]> {
    if (typeof this.ledger.readProductBootReleaseRevisions !== 'function') {
      return failed('PERSISTENCE_READ_FAILED', 'existing Ledger lacks product boot/release read capability');
    }
    try {
      return { ok: true, value: this.ledger.readProductBootReleaseRevisions(limit) };
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        return failed('INVALID_PERSISTENCE_REQUEST', 'product boot/release query is invalid');
      }
      return failed('PERSISTENCE_READ_FAILED', errorMessage(error, 'product boot/release query failed'));
    }
  }

  private findAuditEvent(checkpointRevision: number, checkpointDigest?: string): LedgerEventRecord | null {
    try {
      const events = this.ledger.recentEvents(
        SYSTEM_PERSISTENCE_LIMITS.maximumLedgerScan,
        SYSTEM_PERSISTENCE_EVENT_KIND,
      );
      const matching = events.filter((event) => {
        if (!isRecord(event.data)) return false;
        return event.data.schema === AUDIT_SCHEMA
          && event.data.version === AUDIT_VERSION
          && event.data.checkpointRevision === checkpointRevision
          && (checkpointDigest === undefined || event.data.checkpointChecksum === checkpointDigest);
      });
      return matching.sort((left, right) => left.id - right.id)[0] ?? null;
    } catch {
      return null;
    }
  }

  private refreshAfterCompareAndSetConflict(serialized: string | null): void {
    this.loadedSerializedValue = serialized;
    if (serialized === null) {
      this.stateValue = null;
      this.loadFailure = {
        code: 'PERSISTENCE_CORRUPT',
        message: 'durable checkpoint disappeared during compare-and-set conflict',
      };
      return;
    }
    const decoded = decodeSystemCheckpoint(serialized);
    if (!decoded.ok) {
      this.stateValue = null;
      this.loadFailure = {
        code: 'PERSISTENCE_CORRUPT',
        message: `compare-and-set conflict returned an invalid durable checkpoint: ${decoded.message}`,
      };
      return;
    }
    this.stateValue = decoded.value;
    this.loadFailure = null;
  }

  private writePrepared(
    nextState: Readonly<SystemIntegrationCheckpointState>,
    audit: Readonly<PersistenceAuditInput>,
    idempotencyWrites: readonly Readonly<DurableIdempotencyWrite>[] = Object.freeze([]),
    approvalStateWrites: readonly Readonly<DurableApprovalStateWrite>[] = Object.freeze([]),
  ): PersistenceResult<Readonly<PersistedCommitReceipt>> {
    if (this.sealed) return failed('PERSISTENCE_SEALED', 'final shutdown checkpoint has sealed this adapter');
    let serialized: string;
    let checksum: string;
    try {
      serialized = encodeSystemCheckpoint(nextState);
      checksum = checkpointChecksum(serialized);
    } catch (error) {
      return failed('CHECKPOINT_INVALID', errorMessage(error, 'checkpoint encoding failed'));
    }
    const traces = auditTraceEvents(audit);
    const data: readonly DurableAuditEvent[] = (traces.length === 0 ? [null] : traces).map((trace) => ({
      schema: AUDIT_SCHEMA,
      version: AUDIT_VERSION,
      auditKind: audit.auditKind,
      correlationId: audit.correlationId,
      occurredAtMs: audit.occurredAtMs,
      checkpointRevision: nextState.revision,
      checkpointChecksum: checksum,
      trace,
    }));
    const durableIdempotencyEvents: readonly DurableIdempotencyAuditEvent[] = idempotencyWrites.map((entry) => ({
      schema: IDEMPOTENCY_AUDIT_SCHEMA,
      version: IDEMPOTENCY_AUDIT_VERSION,
      canonicalLedgerEventId: entry.canonicalLedgerEventId,
      receipt: entry.receipt,
    }));
    const durableApprovalStateEvents: readonly DurableApprovalStateAuditEvent[] = approvalStateWrites.map((entry) => ({
      schema: APPROVAL_STATE_AUDIT_SCHEMA,
      version: APPROVAL_STATE_AUDIT_VERSION,
      approvalId: entry.approvalId,
      state: entry.state,
    }));
    if (data.length + durableIdempotencyEvents.length + durableApprovalStateEvents.length > MAX_ATOMIC_LEDGER_EVENTS) {
      return failed('INVALID_PERSISTENCE_REQUEST', 'persistence atomic event batch exceeds its bound');
    }
    try {
      for (const auditEvent of data) {
        const encodedAudit = canonicalPersistenceJson(auditEvent);
        if (Buffer.byteLength(encodedAudit, 'utf8') > SYSTEM_PERSISTENCE_LIMITS.maximumAuditEventBytes) {
          return failed('INVALID_PERSISTENCE_REQUEST', 'persistence audit event exceeds its byte bound');
        }
      }
      for (const durableEvent of durableIdempotencyEvents) {
        if (!validPersistedIdempotencyReceipt(durableEvent.receipt)) {
          return failed('INVALID_PERSISTENCE_REQUEST', 'durable idempotency receipt is invalid');
        }
        const encodedAudit = canonicalPersistenceJson(durableEvent);
        if (Buffer.byteLength(encodedAudit, 'utf8') > SYSTEM_PERSISTENCE_LIMITS.maximumAuditEventBytes) {
          return failed('INVALID_PERSISTENCE_REQUEST', 'durable idempotency event exceeds its byte bound');
        }
      }
      for (const durableEvent of durableApprovalStateEvents) {
        if (!validApprovalStateProjection(durableEvent.state, durableEvent.approvalId)) {
          return failed('INVALID_PERSISTENCE_REQUEST', 'durable approval-state event is invalid');
        }
        const encodedAudit = canonicalPersistenceJson(durableEvent);
        if (Buffer.byteLength(encodedAudit, 'utf8') > SYSTEM_PERSISTENCE_LIMITS.maximumAuditEventBytes) {
          return failed('INVALID_PERSISTENCE_REQUEST', 'durable approval-state event exceeds its byte bound');
        }
      }
      if (this.ledger.probeWritable && !this.ledger.probeWritable(true)) {
        return failed('PERSISTENCE_WRITE_FAILED', 'existing Ledger is not writable');
      }
      if (typeof this.ledger.compareAndSetConfigValueAndLogEvents !== 'function') {
        return failed('PERSISTENCE_WRITE_FAILED', 'existing Ledger lacks checkpoint compare-and-set capability');
      }
      const result = this.ledger.compareAndSetConfigValueAndLogEvents(
        SYSTEM_PERSISTENCE_CONFIG_KEY,
        this.loadedSerializedValue,
        serialized,
        [
          ...data.map((auditEvent) => ({
            kind: SYSTEM_PERSISTENCE_EVENT_KIND,
            symbol: null,
            data: auditEvent,
          })),
          ...durableIdempotencyEvents.map((durableEvent) => ({
            kind: idempotencyEventKind(durableEvent.receipt.idempotencyKey),
            symbol: null,
            data: durableEvent,
          })),
          ...durableApprovalStateEvents.map((durableEvent) => ({
            kind: approvalStateEventKind(durableEvent.approvalId),
            symbol: null,
            data: durableEvent,
          })),
        ],
      );
      if (!result.committed) {
        this.refreshAfterCompareAndSetConflict(result.currentValue);
        return failed(
          'CHECKPOINT_REVISION_CONFLICT',
          this.loadFailure
            ? 'durable checkpoint changed and its current value failed closed validation'
            : 'durable checkpoint changed after this adapter loaded it',
        );
      }
      const committedEvent = result.events[0];
      let event: LedgerEventRecord;
      if (!committedEvent) {
        const readback = this.findAuditEvent(nextState.revision, checksum);
        if (!readback) {
          return failed('PERSISTENCE_WRITE_FAILED', 'existing Ledger committed without a readable persistence audit event');
        }
        event = readback;
      } else {
        event = committedEvent;
      }
      this.stateValue = cloneCheckpointState(nextState);
      this.loadedSerializedValue = serialized;
      this.loadFailure = null;
      return {
        ok: true,
        value: Object.freeze({
          checkpointRevision: nextState.revision,
          ledgerEventId: event.id,
          checksum,
        }),
      };
    } catch (error) {
      // The existing Ledger publishes after its SQLite transaction. If a
      // listener throws post-commit, readback recognizes the durable write so
      // callers do not retry a mutation that already committed.
      try {
        if (this.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY) === serialized) {
          const committed = this.findAuditEvent(nextState.revision, checksum);
          if (committed) {
            this.stateValue = cloneCheckpointState(nextState);
            this.loadedSerializedValue = serialized;
            this.loadFailure = null;
            return {
              ok: true,
              value: Object.freeze({
                checkpointRevision: nextState.revision,
                ledgerEventId: committed.id,
                checksum,
              }),
            };
          }
        }
      } catch {
        // Original write failure remains authoritative.
      }
      return failed('PERSISTENCE_WRITE_FAILED', errorMessage(error, 'existing Ledger transaction failed'));
    }
  }

  private commitCheckpointInternal(
    nextState: Readonly<SystemIntegrationCheckpointState>,
    audit: Readonly<PersistenceAuditInput>,
    idempotencyWrites: readonly Readonly<DurableIdempotencyWrite>[],
    approvalStateWrites: readonly Readonly<DurableApprovalStateWrite>[],
  ): PersistenceResult<Readonly<PersistedCommitReceipt>> {
    const current = this.currentState();
    if (!current.ok) return current;
    const auditValidation = validAuditInput(audit);
    if (!auditValidation.ok) return auditValidation;
    if (nextState.revision !== current.value.revision + 1
      || nextState.generation < current.value.generation
      || nextState.generation > current.value.generation + 1) {
      return failed('CHECKPOINT_REVISION_CONFLICT', 'checkpoint revision or generation is not the next durable transition');
    }
    let prepared = cloneCheckpointState(nextState);
    for (const trace of auditTraceEvents(audit)) {
      const indexed = appendTraceIndex(prepared, trace);
      if (!indexed.ok) return indexed;
      prepared = indexed.value;
    }
    return this.writePrepared(prepared, audit, idempotencyWrites, approvalStateWrites);
  }

  commitCheckpoint(
    nextState: Readonly<SystemIntegrationCheckpointState>,
    audit: Readonly<PersistenceAuditInput>,
  ): PersistenceResult<Readonly<PersistedCommitReceipt>> {
    return this.commitCheckpointInternal(nextState, audit, Object.freeze([]), Object.freeze([]));
  }

  applyIdempotentTransition<T extends SystemJsonValue>(
    input: Readonly<IdempotentTransitionInput<T>>,
  ): PersistenceResult<Readonly<IdempotentTransitionReceipt<T>>> {
    const current = this.currentState();
    if (!current.ok) return current;
    const hasTraceEvent = input.traceEvent !== undefined;
    const hasTraceEvents = input.traceEvents !== undefined;
    if (hasTraceEvent === hasTraceEvents) {
      return failed('INVALID_PERSISTENCE_REQUEST', 'idempotent transition requires exactly one trace field');
    }
    const auditValidation = validAuditInput({
      auditKind: 'TRANSITION',
      correlationId: input.correlationId,
      occurredAtMs: input.occurredAtMs,
      traceEvent: input.traceEvent,
      traceEvents: input.traceEvents,
    });
    if (!auditValidation.ok) return auditValidation;
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)
      || !DIGEST.test(input.requestDigest)
      || !CORRELATION_ID.test(input.correlationId)
      || !validUtcMillis(input.occurredAtMs)) {
      return failed('INVALID_PERSISTENCE_REQUEST', 'idempotent transition metadata is invalid');
    }
    const existing = current.value.idempotencyReceipts.find((entry) => entry.idempotencyKey === input.idempotencyKey);
    const durableExisting = this.durableIdempotencyReceipt(input.idempotencyKey);
    if (!durableExisting.ok) return durableExisting;
    if (existing) {
      if (existing.requestDigest !== input.requestDigest) {
        return failed('IDEMPOTENCY_KEY_CONFLICT', 'idempotency key was used for different intent');
      }
      if (durableExisting.value !== null
        && !samePersistedIdempotencyReceipt(durableExisting.value.receipt, existing)) {
        return failed('PERSISTENCE_CORRUPT', 'checkpoint and durable idempotency evidence conflict');
      }
      return {
        ok: true,
        value: Object.freeze({
          replayed: true,
          receipt: jsonClone((durableExisting.value?.receipt.receipt ?? existing.receipt) as T),
          checkpointRevision: existing.checkpointRevision,
          ledgerEventId: durableExisting.value?.ledgerEventId
            ?? this.findAuditEvent(existing.checkpointRevision)?.id
            ?? null,
        }),
      };
    }
    if (durableExisting.value !== null) {
      if (unresolvedControlRuntimePublication(durableExisting.value.receipt)) {
        return failed(
          'PERSISTENCE_CORRUPT',
          'unresolved control publication evidence is missing from the active checkpoint',
        );
      }
      if (durableExisting.value.receipt.requestDigest !== input.requestDigest) {
        return failed('IDEMPOTENCY_KEY_CONFLICT', 'idempotency key was used for different intent');
      }
      return {
        ok: true,
        value: Object.freeze({
          replayed: true,
          receipt: jsonClone(durableExisting.value.receipt.receipt as T),
          checkpointRevision: durableExisting.value.receipt.checkpointRevision,
          ledgerEventId: durableExisting.value.ledgerEventId,
        }),
      };
    }

    let transition;
    try {
      transition = input.transition(current.value);
      canonicalPersistenceJson(transition.receipt);
    } catch (error) {
      return failed('CHECKPOINT_INVALID', errorMessage(error, 'checkpoint transition failed'));
    }
    if (!sameJson(transition.nextState.idempotencyReceipts, current.value.idempotencyReceipts)
      || !sameJson(transition.nextState.traceIndex, current.value.traceIndex)) {
      return failed('CHECKPOINT_INVALID', 'transition attempted to mutate persistence-owned receipt indexes');
    }
    if (transition.nextState.revision !== current.value.revision + 1) {
      return failed('CHECKPOINT_REVISION_CONFLICT', 'idempotent transition did not produce the next checkpoint revision');
    }
    const receipt = jsonClone(transition.receipt);
    const persistedReceipt: Readonly<PersistedIdempotencyReceipt> = Object.freeze({
      idempotencyKey: input.idempotencyKey,
      requestDigest: input.requestDigest,
      correlationId: input.correlationId,
      recordedAtMs: input.occurredAtMs,
      checkpointRevision: transition.nextState.revision,
      receipt,
    });
    const isControlReceipt = isRecord(receipt) && receipt.kind === 'CONTROL_MUTATION';
    let retainedReceipts = current.value.idempotencyReceipts;
    const durableWrites: DurableIdempotencyWrite[] = [];
    const approvalStateWrites: DurableApprovalStateWrite[] = [];
    if (retainedReceipts.length >= SYSTEM_PERSISTENCE_LIMITS.maximumIdempotencyReceipts) {
      const evictionIndex = retainedReceipts
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => (
          terminalControlReceipt(candidate)
          || controlRuntimePublicationForArchive(candidate) === null
        ))
        .sort((left, right) => (
          left.candidate.checkpointRevision - right.candidate.checkpointRevision
          || left.candidate.recordedAtMs - right.candidate.recordedAtMs
          || left.index - right.index
        ))[0]?.index ?? -1;
      if (evictionIndex < 0) {
        return failed('CHECKPOINT_INVALID', 'idempotency receipt capacity is exhausted by non-evictable evidence');
      }
      const candidate = retainedReceipts[evictionIndex];
      const archived = this.durableIdempotencyReceipt(candidate.idempotencyKey);
      if (!archived.ok) return archived;
      if (archived.value !== null && !samePersistedIdempotencyReceipt(archived.value.receipt, candidate)) {
        return failed('PERSISTENCE_CORRUPT', 'eviction candidate conflicts with its durable idempotency archive');
      }
      if (archived.value === null) {
        durableWrites.push(Object.freeze({
          receipt: candidate,
          canonicalLedgerEventId: this.findAuditEvent(candidate.checkpointRevision)?.id ?? null,
        }));
      }
      let approvalProjection: ReturnType<typeof approvalStateFromIdempotencyReceipt>;
      try {
        approvalProjection = approvalStateFromIdempotencyReceipt(candidate);
      } catch (error) {
        return failed('PERSISTENCE_CORRUPT', errorMessage(error, 'eviction approval-state evidence is corrupt'));
      }
      if (approvalProjection !== null) {
        const archivedApproval = this.durableApprovalState(approvalProjection.approvalId);
        if (!archivedApproval.ok) return archivedApproval;
        if (archivedApproval.value === null) {
          approvalStateWrites.push(approvalProjection);
        } else {
          const older = approvalProjection.state.revision < archivedApproval.value.revision
            ? approvalProjection.state
            : archivedApproval.value;
          const newer = approvalProjection.state.revision < archivedApproval.value.revision
            ? archivedApproval.value
            : approvalProjection.state;
          if (!validateApprovalStateContinuation(older, newer)) {
            return failed('PERSISTENCE_CORRUPT', 'eviction approval-state evidence conflicts with its durable archive');
          }
          if (approvalProjection.state.revision > archivedApproval.value.revision) {
            approvalStateWrites.push(approvalProjection);
          }
        }
      }
      retainedReceipts = Object.freeze([
        ...retainedReceipts.slice(0, evictionIndex),
        ...retainedReceipts.slice(evictionIndex + 1),
      ]);
    }
    if (retainedReceipts.length >= SYSTEM_PERSISTENCE_LIMITS.maximumIdempotencyReceipts) {
      return failed('CHECKPOINT_INVALID', 'idempotency receipt capacity is exhausted; refusing unsafe eviction');
    }
    const nextState: SystemIntegrationCheckpointState = {
      ...transition.nextState,
      idempotencyReceipts: [...retainedReceipts, persistedReceipt],
    };
    if (isControlReceipt) {
      durableWrites.push(Object.freeze({ receipt: persistedReceipt, canonicalLedgerEventId: 'SELF' }));
    }
    const committed = this.commitCheckpointInternal(nextState, {
      auditKind: 'TRANSITION',
      correlationId: input.correlationId,
      occurredAtMs: input.occurredAtMs,
      traceEvent: input.traceEvent,
      traceEvents: input.traceEvents,
    }, durableWrites, approvalStateWrites);
    if (!committed.ok) return committed;
    let canonicalLedgerEventId: number | null = committed.value.ledgerEventId;
    if (isControlReceipt) {
      const durableCommitted = this.durableIdempotencyReceipt(input.idempotencyKey);
      if (!durableCommitted.ok) return durableCommitted;
      if (durableCommitted.value === null) {
        return failed('PERSISTENCE_WRITE_FAILED', 'control idempotency archive committed without readable evidence');
      }
      canonicalLedgerEventId = durableCommitted.value.ledgerEventId;
    }
    return {
      ok: true,
      value: Object.freeze({
        replayed: false,
        receipt,
        checkpointRevision: committed.value.checkpointRevision,
        ledgerEventId: canonicalLedgerEventId,
      }),
    };
  }

  appendTraceEvent(trace: Readonly<SystemTraceEvent>): PersistenceResult<Readonly<TraceAppendReceipt>> {
    const current = this.currentState();
    if (!current.ok) return current;
    let digest: string;
    try {
      digest = traceEventDigest(trace);
    } catch (error) {
      return failed('INVALID_PERSISTENCE_REQUEST', errorMessage(error, 'trace event is invalid'));
    }
    const existing = current.value.traceIndex.find((entry) => entry.eventId === trace.id);
    if (existing) {
      if (existing.eventDigest !== digest) return failed('TRACE_EVENT_CONFLICT', 'trace event ID was reused with different content');
      return {
        ok: true,
        value: Object.freeze({ appended: false, checkpointRevision: current.value.revision, ledgerEventId: null }),
      };
    }
    const nextState: SystemIntegrationCheckpointState = { ...current.value, revision: current.value.revision + 1 };
    const committed = this.commitCheckpoint(nextState, {
      auditKind: 'TRACE',
      correlationId: trace.correlationId,
      occurredAtMs: trace.occurredAtMs,
      traceEvent: trace,
    });
    if (!committed.ok) return committed;
    return {
      ok: true,
      value: Object.freeze({
        appended: true,
        checkpointRevision: committed.value.checkpointRevision,
        ledgerEventId: committed.value.ledgerEventId,
      }),
    };
  }

  queryTrace(query: Readonly<TraceQuery>): PersistenceResult<Readonly<PersistedTraceQueryResult>> {
    if (!query || !CORRELATION_ID.test(query.correlationId)) {
      return failed('INVALID_PERSISTENCE_REQUEST', 'trace correlation ID is invalid');
    }
    const limit = query.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > SYSTEM_PERSISTENCE_LIMITS.maximumTraceQueryLimit
      || (query.sinceMs !== undefined && !validUtcMillis(query.sinceMs))
      || (query.untilMs !== undefined && !validUtcMillis(query.untilMs))
      || (query.sinceMs !== undefined && query.untilMs !== undefined && query.sinceMs >= query.untilMs)) {
      return failed('INVALID_PERSISTENCE_REQUEST', 'trace query bounds are invalid');
    }
    let raw: LedgerEventRecord[];
    try {
      raw = this.ledger.recentEvents(
        SYSTEM_PERSISTENCE_LIMITS.maximumLedgerScan,
        SYSTEM_PERSISTENCE_EVENT_KIND,
      );
    } catch (error) {
      return failed('PERSISTENCE_READ_FAILED', errorMessage(error, 'trace query failed'));
    }
    const matching: PersistedTraceEventRecord[] = [];
    for (const row of raw) {
      if (!isRecord(row.data)) continue;
      if (!isRecord(row.data.trace)) continue;
      const sourceTrace = row.data.trace;
      if (sourceTrace.correlationId !== query.correlationId) continue;
      if (typeof sourceTrace.occurredAtMs !== 'number') continue;
      if (query.sinceMs !== undefined && sourceTrace.occurredAtMs < query.sinceMs) continue;
      if (query.untilMs !== undefined && sourceTrace.occurredAtMs >= query.untilMs) continue;
      const event = { ...sourceTrace, persistedAtMs: row.ts } as unknown as SystemTraceEvent;
      if (validateSystemTraceEvent(event).length > 0) continue;
      matching.push(Object.freeze({ ledgerEventId: row.id, persistedAtMs: row.ts, event: Object.freeze(event) }));
    }
    matching.sort((left, right) => (
      left.event.sequence - right.event.sequence
      || left.event.occurredAtMs - right.event.occurredAtMs
      || left.ledgerEventId - right.ledgerEventId
    ));
    const truncated = matching.length > limit || raw.length >= SYSTEM_PERSISTENCE_LIMITS.maximumLedgerScan;
    const events = matching.slice(Math.max(0, matching.length - limit));
    return {
      ok: true,
      value: Object.freeze({
        correlationId: query.correlationId,
        events: Object.freeze(events),
        truncated,
      }),
    };
  }

  /**
   * Structural implementation of the vertical slice's
   * ValidateOnlyPersistencePort. The domain record is validated as bounded,
   * secret-free plain data and committed exactly once with its trace.
   */
  async loadValidateOnlyApprovalState(
    approvalId: string,
  ): Promise<Readonly<OperatorApprovalState> | null> {
    if (!BOUNDED_ID.test(approvalId)) throw new TypeError('validate-only approval ID is invalid');
    const current = this.currentState();
    if (!current.ok) throw new Error(`${current.code}: ${current.message}`);
    const latest = this.latestValidateOnlyApprovalState(current.value, approvalId);
    if (!latest.ok) throw new Error(`${latest.code}: ${latest.message}`);
    return latest.value;
  }

  async persistValidateOnly(record: unknown): Promise<Readonly<{ persistenceId: string }>> {
    const validated = validateOnlyRecord(record);
    if (!validated.ok) throw new Error(`${validated.code}: ${validated.message}`);
    const value = validated.value;
    const recordId = String(value.recordId);
    const correlationId = String(value.rootCorrelationId);
    const occurredAtMs = Number(value.evaluatedAtMs);
    const disposition = String(value.disposition);
    const requestDigest = persistenceDigest(value);
    const idempotencyKey = `validate-only:v2:${persistenceDigest(recordId).slice(0, 64)}`;
    const current = this.currentState();
    if (!current.ok) throw new Error(`${current.code}: ${current.message}`);
    const approvalId = String(value.approvalId);
    const durableApproval = isRecord(value.ownerInvocations)
      && value.ownerInvocations.approvalUseReductions === 1
      ? this.durableApprovalState(approvalId)
      : { ok: true as const, value: null };
    if (!durableApproval.ok) throw new Error(`${durableApproval.code}: ${durableApproval.message}`);
    const traces = validateOnlyTraceEvents(value);
    const persisted = this.applyIdempotentTransition({
      idempotencyKey,
      requestDigest,
      correlationId,
      occurredAtMs,
      traceEvents: traces,
      transition: (state) => {
        assertApprovalStateCompareAndSet(state, value, durableApproval.value);
        let dryRunExecutions = state.dryRunExecutions;
        let reconciliations = state.reconciliations;
        const executionPlan = isRecord(value.executionPlan) ? value.executionPlan : null;
        const executionState = isRecord(value.executionState) ? value.executionState : null;
        const reconciliation = isRecord(value.reconciliation) ? value.reconciliation : null;
        const riskPlanBinding = isRecord(value.riskPlanBinding) ? value.riskPlanBinding : null;
        const supervision = isRecord(value.supervision) ? value.supervision : null;
        if (executionPlan) {
          const planId = String(executionPlan.planId);
          const lifecycleCandidate = executionState?.lifecycle;
          const domainLifecycle = typeof lifecycleCandidate === 'string'
            && /^[A-Z][A-Z0-9_.:-]{0,127}$/.test(lifecycleCandidate)
            ? lifecycleCandidate
            : disposition;
          const requiresReconciliation = disposition === 'RECONCILIATION_BLOCKED'
            || (executionState !== null && executionState.exposedSinceMs !== null);
          const serializedCheckpoint = canonicalPersistenceJson({
            schema: 'cosmos.system-integration.validate-only-checkpoint.v1',
            recordId,
            disposition,
            rootCorrelationId: correlationId,
            planId,
            stateRevision: executionState?.revision ?? null,
            stateRevisionId: executionState?.stateRevisionId ?? null,
            lifecycle: domainLifecycle,
            reconciliationStatus: reconciliation?.status ?? null,
            riskPlanBinding,
            executionAuthority: 'NONE',
            liveExecutionPermitted: false,
          });
          const executionReference = {
            planId,
            checkpointDigest: requestDigest,
            serializedCheckpoint,
            domainLifecycle,
            dryRun: true as const,
            requiresReconciliation,
            correlationId: typeof value.executionCorrelationId === 'string'
              ? value.executionCorrelationId
              : correlationId,
            updatedAtMs: occurredAtMs,
          };
          dryRunExecutions = [
            ...state.dryRunExecutions.filter((entry) => entry.planId !== planId),
            executionReference,
          ].sort((left, right) => left.planId.localeCompare(right.planId, 'en'));
        }
        if (reconciliation) {
          const reasons = Array.isArray(reconciliation.reasons) ? reconciliation.reasons : [];
          const reasonCodes = [...new Set(reasons.flatMap((reason) => (
            isRecord(reason)
              && typeof reason.code === 'string'
              && /^[A-Z][A-Z0-9_.:-]{0,127}$/.test(reason.code)
              ? [reason.code]
              : []
          )))].sort().slice(0, SYSTEM_PERSISTENCE_LIMITS.maximumReasonCodes);
          const reconciliationReference = {
            planId: String(reconciliation.planId),
            ownerRevision: persistenceDigest(reconciliation),
            domainStatus: String(reconciliation.status),
            allowsNewExposure: reconciliation.status === 'EXACT' && disposition === 'READY',
            reasonCodes,
            correlationId: typeof reconciliation.correlationId === 'string'
              && CORRELATION_ID.test(reconciliation.correlationId)
              ? reconciliation.correlationId
              : correlationId,
            observedAtMs: Number(reconciliation.evaluatedAtMs),
          };
          reconciliations = [
            ...state.reconciliations.filter((entry) => entry.planId !== reconciliationReference.planId),
            reconciliationReference,
          ].sort((left, right) => left.planId.localeCompare(right.planId, 'en'));
        }
        if (supervision && isRecord(supervision.state) && isRecord(supervision.state.plan)) {
          const supervisedState = supervision.state as Record<string, SystemJsonValue>;
          const supervisedPlan = supervisedState.plan as Record<string, SystemJsonValue>;
          const supervisedPlanId = String(supervision.planId);
          const supervisedReconciliation = isRecord(supervision.reconciliation)
            ? supervision.reconciliation
            : null;
          if (supervisedPlan.mode === 'VALIDATE_ONLY') {
            const serializedCheckpoint = canonicalPersistenceJson({
              schema: 'cosmos.system-integration.supervision-checkpoint.v1',
              recordId,
              disposition,
              rootCorrelationId: supervision.rootCorrelationId,
              executionCorrelationId: supervision.executionCorrelationId,
              planId: supervisedPlanId,
              stateRevision: supervisedState.revision,
              stateRevisionId: supervisedState.stateRevisionId,
              lifecycle: supervisedState.lifecycle,
              reconciliationStatus: supervisedReconciliation?.status ?? null,
              executionAuthority: 'NONE',
              truthLabel: 'SYNTHETIC_ONLY',
            });
            const executionReference = {
              planId: supervisedPlanId,
              checkpointDigest: persistenceDigest(supervision),
              serializedCheckpoint,
              domainLifecycle: String(supervisedState.lifecycle),
              dryRun: true as const,
              requiresReconciliation: supervisedReconciliation === null
                || supervisedReconciliation.status !== 'EXACT'
                || supervisedState.exposedSinceMs !== null,
              correlationId: String(supervision.executionCorrelationId),
              updatedAtMs: occurredAtMs,
            };
            dryRunExecutions = [
              ...dryRunExecutions.filter((entry) => entry.planId !== supervisedPlanId),
              executionReference,
            ].sort((left, right) => left.planId.localeCompare(right.planId, 'en'));
          }
          const reasons = supervisedReconciliation && Array.isArray(supervisedReconciliation.reasons)
            ? supervisedReconciliation.reasons
            : [];
          const reasonCodes = supervisedReconciliation === null
            ? ['SUPERVISION_RECONCILIATION_REQUIRED']
            : [...new Set(reasons.flatMap((reason) => (
                isRecord(reason)
                  && typeof reason.code === 'string'
                  && /^[A-Z][A-Z0-9_.:-]{0,127}$/.test(reason.code)
                  ? [reason.code]
                  : []
              )))].sort().slice(0, SYSTEM_PERSISTENCE_LIMITS.maximumReasonCodes);
          const reconciliationReference = {
            planId: supervisedPlanId,
            ownerRevision: persistenceDigest(supervisedReconciliation ?? supervisedState),
            domainStatus: supervisedReconciliation === null
              ? 'UNAVAILABLE'
              : String(supervisedReconciliation.status),
            allowsNewExposure: false,
            reasonCodes,
            correlationId: String(supervision.executionCorrelationId),
            observedAtMs: supervisedReconciliation === null
              ? occurredAtMs
              : Number(supervisedReconciliation.evaluatedAtMs),
          };
          reconciliations = [
            ...reconciliations.filter((entry) => entry.planId !== supervisedPlanId),
            reconciliationReference,
          ].sort((left, right) => left.planId.localeCompare(right.planId, 'en'));
        }
        return {
          nextState: {
            ...state,
            revision: state.revision + 1,
            dryRunExecutions,
            reconciliations,
          },
          receipt: {
            kind: 'VALIDATE_ONLY_RUN',
            record: value,
          },
        };
      },
    });
    if (!persisted.ok) throw new Error(`${persisted.code}: ${persisted.message}`);
    return Object.freeze({
      persistenceId: `ledger-checkpoint:${persisted.value.checkpointRevision}:${persistenceDigest(recordId)}`,
    });
  }

  persistStartup(input: Readonly<PersistenceStartupInput>): PersistenceResult<Readonly<PersistedCommitReceipt>> {
    const current = this.currentState();
    if (!current.ok) return current;
    let nextState: Readonly<SystemIntegrationCheckpointState>;
    try {
      nextState = prepareStartupState(current.value, input);
    } catch (error) {
      return failed('INVALID_PERSISTENCE_REQUEST', errorMessage(error, 'startup checkpoint is invalid'));
    }
    const trace = traceForCheckpoint({
      idPrefix: 'persistence.startup',
      sequence: nextState.revision,
      correlationId: input.correlationId,
      occurredAtMs: input.startedAtMs,
      machinePhase: 'STARTING',
    });
    return this.commitCheckpoint(nextState, {
      auditKind: 'STARTUP',
      correlationId: input.correlationId,
      occurredAtMs: input.startedAtMs,
      traceEvent: trace,
    });
  }

  persistRestartTruth(
    truth: Readonly<PersistedRestartTruth>,
    correlationId: string,
  ): PersistenceResult<Readonly<PersistedCommitReceipt>> {
    const current = this.currentState();
    if (!current.ok) return current;
    if (truth.observedAtMs === null) return failed('INVALID_PERSISTENCE_REQUEST', 'restart truth requires an observation time');
    let nextState: Readonly<SystemIntegrationCheckpointState>;
    try {
      nextState = withRestartTruth(current.value, truth);
    } catch (error) {
      return failed('INVALID_PERSISTENCE_REQUEST', errorMessage(error, 'restart truth is invalid'));
    }
    const trace = traceForCheckpoint({
      idPrefix: 'persistence.restart-truth',
      sequence: nextState.revision,
      correlationId,
      occurredAtMs: truth.observedAtMs,
      machinePhase: 'VALIDATING',
    });
    return this.commitCheckpoint(nextState, {
      auditKind: 'RESTART_TRUTH',
      correlationId,
      occurredAtMs: truth.observedAtMs,
      traceEvent: trace,
    });
  }

  persistFinalShutdown(input: Readonly<PersistenceShutdownInput>): PersistenceResult<Readonly<PersistedCommitReceipt>> {
    if (this.sealed && this.finalShutdownReceipt) return { ok: true, value: this.finalShutdownReceipt };
    const current = this.currentState();
    if (!current.ok) return current;
    let nextState: Readonly<SystemIntegrationCheckpointState>;
    try {
      nextState = prepareShutdownState(current.value, input);
    } catch (error) {
      return failed('INVALID_PERSISTENCE_REQUEST', errorMessage(error, 'shutdown checkpoint is invalid'));
    }
    const trace = traceForCheckpoint({
      idPrefix: 'persistence.shutdown',
      sequence: nextState.revision,
      correlationId: input.correlationId,
      occurredAtMs: input.stoppedAtMs,
      machinePhase: 'STOPPED',
    });
    const committed = this.commitCheckpoint(nextState, {
      auditKind: 'SHUTDOWN',
      correlationId: input.correlationId,
      occurredAtMs: input.stoppedAtMs,
      traceEvent: trace,
    });
    if (committed.ok) {
      this.finalShutdownReceipt = committed.value;
      // An unclean checkpoint is durable evidence, not permission to make the
      // adapter permanently unwritable. A repaired bounded drain may
      // supersede it with a clean checkpoint; only that clean proof seals.
      this.sealed = input.clean;
    }
    return committed;
  }

  private controlReceiptFromStored(
    stored: Readonly<{ checkpointRevision: number; receipt: SystemJsonValue }>,
    canonicalLedgerEventId?: number | null,
  ): Readonly<SystemControlMutationReceipt> | null {
    if (!isRecord(stored.receipt) || stored.receipt.kind !== 'CONTROL_MUTATION'
      || typeof stored.receipt.applied !== 'boolean'
      || typeof stored.receipt.code !== 'string'
      || !isRecord(stored.receipt.before)
      || !isRecord(stored.receipt.after)) return null;
    const eventId = canonicalLedgerEventId === undefined
      ? this.findAuditEvent(stored.checkpointRevision)?.id ?? null
      : canonicalLedgerEventId;
    return Object.freeze({
      applied: stored.receipt.applied,
      code: stored.receipt.code,
      before: Object.freeze({ ...stored.receipt.before }) as unknown as Readonly<SystemControlState>,
      after: Object.freeze({ ...stored.receipt.after }) as unknown as Readonly<SystemControlState>,
      ledgerEventId: eventId,
    });
  }

  private controlRuntimePublicationFromStored(
    stored: Readonly<{ receipt: SystemJsonValue }>,
  ): ControlRuntimePublicationState | null {
    if (!isRecord(stored.receipt) || stored.receipt.kind !== 'CONTROL_MUTATION') return null;
    if (['NOT_REQUIRED', 'PENDING', 'PUBLISHED', 'UNKNOWN'].includes(String(stored.receipt.runtimePublication))) {
      return stored.receipt.runtimePublication as ControlRuntimePublicationState;
    }
    // Pre-marker restart receipts are conservatively recoverable work. Other
    // historical controls never required this runtime publication protocol.
    return stored.receipt.applied === true && requiresRuntimePublication(stored.receipt.command)
      ? 'UNKNOWN'
      : 'NOT_REQUIRED';
  }

  private controlRuntimePublicationReferences(
    state: Readonly<SystemIntegrationCheckpointState>,
  ): readonly Readonly<PersistedControlRuntimePublicationReference>[] | null {
    const references: PersistedControlRuntimePublicationReference[] = [];
    for (const stored of state.idempotencyReceipts) {
      if (!isRecord(stored.receipt)
        || stored.receipt.kind !== 'CONTROL_MUTATION'
        || stored.receipt.applied !== true
        || !requiresRuntimePublication(stored.receipt.command)) continue;
      const publication = this.controlRuntimePublicationFromStored(stored);
      if (publication === null || !isRecord(stored.receipt.after)) return null;
      if (publication === 'PUBLISHED') continue;
      const generation = stored.receipt.after.generation;
      const revision = stored.receipt.after.revision;
      if (!Number.isSafeInteger(generation) || Number(generation) < 0
        || !Number.isSafeInteger(revision) || Number(revision) < 0) return null;
      references.push(Object.freeze({
        effectId: `${stored.idempotencyKey}:${revision}:${generation}`,
        idempotencyKey: stored.idempotencyKey,
        requestDigest: stored.requestDigest,
        correlationId: stored.correlationId,
        generation: Number(generation),
        state: publication === 'PENDING' ? 'PENDING' : 'UNKNOWN',
      }));
    }
    return Object.freeze(references.sort((left, right) => left.effectId.localeCompare(right.effectId, 'en')));
  }

  readPendingControlRuntimePublications(): PersistenceResult<
    readonly Readonly<PersistedControlRuntimePublicationReference>[]
  > {
    const current = this.currentState();
    if (!current.ok) return current;
    const references = this.controlRuntimePublicationReferences(current.value);
    return references === null
      ? failed('PERSISTENCE_CORRUPT', 'persisted control runtime publication evidence is invalid')
      : { ok: true, value: references };
  }

  async findControlMutation(idempotencyKey: string): Promise<Readonly<{
    requestDigest: string;
    correlationId: string;
    recordedAtMs: number;
    mutation: Readonly<SystemControlMutation> | null;
    receipt: Readonly<SystemControlMutationReceipt>;
    runtimePublication: ControlRuntimePublicationState;
  }> | null> {
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) return null;
    const current = this.currentState();
    if (!current.ok) throw new Error(current.message);
    let stored = current.value.idempotencyReceipts.find((entry) => entry.idempotencyKey === idempotencyKey);
    const durable = this.durableIdempotencyReceipt(idempotencyKey);
    if (!durable.ok) throw new Error(durable.message);
    if (stored && durable.value !== null
      && !samePersistedIdempotencyReceipt(stored, durable.value.receipt)) {
      throw new Error('checkpoint control receipt conflicts with its durable archive');
    }
    if (!stored && durable.value !== null && unresolvedControlRuntimePublication(durable.value.receipt)) {
      throw new Error('unresolved control publication evidence is missing from the active checkpoint');
    }
    stored ??= durable.value?.receipt;
    const canonicalLedgerEventId = durable.value?.ledgerEventId;
    if (!stored) return null;
    const receipt = this.controlReceiptFromStored(stored, canonicalLedgerEventId);
    const runtimePublication = this.controlRuntimePublicationFromStored(stored);
    const mutation = isRecord(stored.receipt)
      && stored.receipt.kind === 'CONTROL_MUTATION'
      && isRecord(stored.receipt.mutation)
      && (SYSTEM_CONTROL_COMMANDS as readonly unknown[]).includes(stored.receipt.mutation.command)
      ? Object.freeze({ ...stored.receipt.mutation }) as unknown as Readonly<SystemControlMutation>
      : null;
    return receipt && runtimePublication
      ? Object.freeze({
          requestDigest: stored.requestDigest,
          correlationId: stored.correlationId,
          recordedAtMs: stored.recordedAtMs,
          mutation,
          receipt,
          runtimePublication,
        })
      : null;
  }

  async commitControlMutation(commit: Readonly<ControlPersistenceCommit>): Promise<ControlPersistenceResult> {
    const current = this.currentState();
    if (!current.ok) throw new Error(current.message);
    let existing = current.value.idempotencyReceipts.find(
      (entry) => entry.idempotencyKey === commit.request.idempotencyKey,
    );
    const durable = this.durableIdempotencyReceipt(commit.request.idempotencyKey);
    if (!durable.ok) throw new Error(durable.message);
    if (existing && durable.value !== null
      && !samePersistedIdempotencyReceipt(existing, durable.value.receipt)) {
      throw new Error('checkpoint control receipt conflicts with its durable archive');
    }
    if (!existing && durable.value !== null && unresolvedControlRuntimePublication(durable.value.receipt)) {
      throw new Error('unresolved control publication evidence is missing from the active checkpoint');
    }
    existing ??= durable.value?.receipt;
    const canonicalLedgerEventId = durable.value?.ledgerEventId;
    if (existing) {
      if (existing.requestDigest !== commit.requestDigest) {
        return { kind: 'IDEMPOTENCY_CONFLICT', requestDigest: existing.requestDigest };
      }
      const receipt = this.controlReceiptFromStored(existing, canonicalLedgerEventId);
      const runtimePublication = this.controlRuntimePublicationFromStored(existing);
      if (!receipt || !runtimePublication) throw new Error('persisted control receipt is invalid');
      return {
        kind: 'IDEMPOTENT_REPLAY',
        requestDigest: existing.requestDigest,
        receipt,
        runtimePublication,
      };
    }
    if (commit.request.expectedRevision !== current.value.control.revision
      || !sameJson(commit.before, current.value.control)) {
      return { kind: 'REVISION_CONFLICT', current: current.value.control };
    }
    if (!IDEMPOTENCY_KEY.test(commit.request.idempotencyKey)
      || !DIGEST.test(commit.requestDigest)
      || !CORRELATION_ID.test(commit.request.correlationId)
      || !validUtcMillis(commit.request.requestedAtMs)
      || !validActorId(commit.actor.id)
      || !['loopback', 'cloudflare-access'].includes(commit.actor.source)
      || !(SYSTEM_CONTROL_COMMANDS as readonly string[]).includes(commit.request.mutation.command)
      || !REASON_CODE.test(commit.code)) {
      throw new TypeError('control persistence commit is invalid');
    }
    if (commit.applied) {
      if (commit.after.revision !== commit.before.revision + 1) throw new TypeError('applied control must advance control revision once');
    } else if (!sameJson(commit.after, commit.before)) {
      throw new TypeError('non-applied control cannot change control state');
    }
    const storedReceipt: StoredControlReceipt = {
      kind: 'CONTROL_MUTATION',
      applied: commit.applied,
      code: commit.code,
      command: commit.request.mutation.command,
      mutation: commit.request.mutation as unknown as SystemJsonValue,
      actorIdDigest: persistenceDigest(commit.actor.id),
      actorSource: commit.actor.source,
      reasonDigest: persistenceDigest(commit.request.reason),
      runtimePublication: commit.applied && requiresRuntimePublication(commit.request.mutation.command)
        ? 'PENDING'
        : 'NOT_REQUIRED',
      before: commit.before as unknown as SystemJsonValue,
      after: commit.after as unknown as SystemJsonValue,
    };
    const trace = traceForCheckpoint({
      idPrefix: 'control.mutation',
      sequence: current.value.revision + 1,
      componentId: 'engine-supervisor',
      correlationId: commit.request.correlationId,
      occurredAtMs: commit.request.requestedAtMs,
      kind: 'CONTROL',
      machinePhase: 'RUNNING',
      ownerId: null,
      referenceIds: [commit.request.idempotencyKey],
    });
    const applied = this.applyIdempotentTransition({
      idempotencyKey: commit.request.idempotencyKey,
      requestDigest: commit.requestDigest,
      correlationId: commit.request.correlationId,
      occurredAtMs: commit.request.requestedAtMs,
      traceEvent: trace,
      transition: (state) => {
        let desiredComponents = state.desiredComponents;
        let reservations = state.reservations;
        let approvals = state.approvals;
        const mutation: Readonly<SystemControlMutation> = commit.request.mutation;
        if (commit.applied && mutation.command === 'SET_COMPONENT_STATE') {
          desiredComponents = [
            ...state.desiredComponents.filter((entry) => entry.componentId !== mutation.componentId),
            {
              componentId: mutation.componentId,
              desiredState: mutation.desiredState,
              generation: commit.after.generation,
              updatedAtMs: commit.request.requestedAtMs,
            },
          ].sort((left, right) => left.componentId.localeCompare(right.componentId, 'en'));
        } else if (commit.applied && mutation.command === 'REVOKE_RESERVATION') {
          reservations = state.reservations.map((entry) => entry.reservationId === mutation.reservationId
            ? { ...entry, blocksAllocation: false, correlationId: commit.request.correlationId, updatedAtMs: commit.request.requestedAtMs }
            : entry);
        } else if (commit.applied && mutation.command === 'REVOKE_APPROVAL') {
          approvals = state.approvals.map((entry) => entry.approvalId === mutation.approvalId
            ? { ...entry, usable: false, correlationId: commit.request.correlationId, updatedAtMs: commit.request.requestedAtMs }
            : entry);
        }
        return {
          nextState: {
            ...state,
            revision: state.revision + 1,
            generation: commit.after.generation,
            control: commit.after,
            desiredComponents,
            reservations,
            approvals,
          },
          receipt: storedReceipt,
        };
      },
    });
    if (!applied.ok) throw new Error(`${applied.code}: ${applied.message}`);
    const receipt: Readonly<SystemControlMutationReceipt> = Object.freeze({
      applied: commit.applied,
      code: commit.code,
      before: commit.before,
      after: commit.after,
      ledgerEventId: applied.value.ledgerEventId,
    });
    const runtimePublication = storedReceipt.runtimePublication;
    return applied.value.replayed
      ? { kind: 'IDEMPOTENT_REPLAY', requestDigest: commit.requestDigest, receipt, runtimePublication }
      : { kind: 'COMMITTED', receipt, runtimePublication };
  }

  async markControlRuntimePublished(
    commit: Readonly<ControlRuntimePublicationCommit>,
  ): Promise<ControlRuntimePublicationResult> {
    if (!IDEMPOTENCY_KEY.test(commit.idempotencyKey)
      || !DIGEST.test(commit.requestDigest)
      || !CORRELATION_ID.test(commit.correlationId)
      || !validUtcMillis(commit.occurredAtMs)) {
      throw new TypeError('control runtime publication commit is invalid');
    }
    const current = this.currentState();
    if (!current.ok) throw new Error(current.message);
    const index = current.value.idempotencyReceipts.findIndex(
      (entry) => entry.idempotencyKey === commit.idempotencyKey,
    );
    if (index < 0) throw new Error('persisted control mutation is unavailable');
    const stored = current.value.idempotencyReceipts[index];
    if (stored.requestDigest !== commit.requestDigest) throw new Error('persisted control mutation digest conflicts');
    const publication = this.controlRuntimePublicationFromStored(stored);
    if (publication === null || !isRecord(stored.receipt)
      || stored.receipt.applied !== true
      || !requiresRuntimePublication(stored.receipt.command)) {
      throw new Error('persisted control mutation does not require runtime publication');
    }
    if (publication === 'PUBLISHED') return { kind: 'IDEMPOTENT_REPLAY' };
    if (publication !== 'PENDING' && publication !== 'UNKNOWN') {
      throw new Error('persisted control runtime publication state is invalid');
    }

    const durable = this.durableIdempotencyReceipt(commit.idempotencyKey);
    if (!durable.ok) throw new Error(durable.message);
    if (durable.value !== null
      && !samePersistedIdempotencyReceipt(durable.value.receipt, stored)) {
      throw new Error('persisted control runtime publication archive conflicts');
    }
    const publishedReceipt = Object.freeze({
      ...(stored.receipt as Readonly<Record<string, SystemJsonValue>>),
      runtimePublication: 'PUBLISHED' as const,
    });
    const publishedStoredReceipt: Readonly<PersistedIdempotencyReceipt> = Object.freeze({
      ...stored,
      receipt: publishedReceipt,
    });
    const nextReceipts = current.value.idempotencyReceipts.map((entry, entryIndex) => entryIndex === index
      ? publishedStoredReceipt
      : entry);
    const nextState: SystemIntegrationCheckpointState = {
      ...current.value,
      revision: current.value.revision + 1,
      idempotencyReceipts: nextReceipts,
    };
    const trace = traceForCheckpoint({
      idPrefix: 'control.runtime-published',
      sequence: nextState.revision,
      componentId: 'engine-supervisor',
      correlationId: commit.correlationId,
      occurredAtMs: commit.occurredAtMs,
      kind: 'CONTROL',
      machinePhase: 'RUNNING',
      ownerId: null,
      referenceIds: [commit.idempotencyKey],
    });
    const marked = this.commitCheckpointInternal(nextState, {
      auditKind: 'TRANSITION',
      correlationId: commit.correlationId,
      occurredAtMs: commit.occurredAtMs,
      traceEvent: trace,
    }, [Object.freeze({
      receipt: publishedStoredReceipt,
      canonicalLedgerEventId: durable.value?.ledgerEventId
        ?? this.findAuditEvent(stored.checkpointRevision)?.id
        ?? null,
    })], Object.freeze([]));
    if (!marked.ok) throw new Error(`${marked.code}: ${marked.message}`);
    return { kind: 'PUBLISHED' };
  }

  async recordControlRejection(audit: Readonly<ControlRejectionAudit>): Promise<ControlRejectionPersistenceResult> {
    const current = this.currentState();
    if (!current.ok) throw new Error(current.message);
    const command = typeof audit.command === 'string'
      && (SYSTEM_CONTROL_COMMANDS as readonly string[]).includes(audit.command)
      ? audit.command
      : null;
    const idempotencyKey = typeof audit.idempotencyKey === 'string' && IDEMPOTENCY_KEY.test(audit.idempotencyKey)
      ? audit.idempotencyKey
      : null;
    if (!BOUNDED_ID.test(audit.dedupeKey)
      || !DIGEST.test(audit.requestDigest)
      || (audit.expectedRevision !== null && (!Number.isSafeInteger(audit.expectedRevision) || audit.expectedRevision < 0))
      || !Number.isSafeInteger(audit.currentRevision)
      || audit.currentRevision < 0
      || !REASON_CODE.test(audit.code)
      || !CORRELATION_ID.test(audit.correlationId)
      || !validUtcMillis(audit.occurredAtMs)
      || !validActorId(audit.actor.id)
      || !['loopback', 'cloudflare-access'].includes(audit.actor.source)
      || audit.applied !== false) {
      throw new TypeError('control rejection audit is invalid');
    }
    const existing = current.value.controlRejections.find((entry) => entry.dedupeKey === audit.dedupeKey);
    if (existing) {
      if (existing.requestDigest !== audit.requestDigest || existing.code !== audit.code) {
        throw new Error('control rejection dedupe key conflict');
      }
      const event = this.findAuditEvent(existing.checkpointRevision);
      if (!event) throw new Error('control rejection audit event is unavailable');
      return { kind: 'IDEMPOTENT_REPLAY', ledgerEventId: event.id };
    }
    if (audit.currentRevision !== current.value.control.revision) {
      throw new Error('control rejection current revision does not match durable control truth');
    }
    const checkpointRevision = current.value.revision + 1;
    const redacted: PersistedControlRejectionReceipt = Object.freeze({
      dedupeKey: audit.dedupeKey,
      idempotencyKey,
      requestDigest: audit.requestDigest,
      command,
      expectedRevision: audit.expectedRevision,
      currentRevision: audit.currentRevision,
      code: audit.code,
      message: 'Control request rejected.',
      correlationId: audit.correlationId,
      occurredAtMs: audit.occurredAtMs,
      actorIdDigest: persistenceDigest(audit.actor.id),
      actorSource: audit.actor.source,
      checkpointRevision,
    });
    const nextState: SystemIntegrationCheckpointState = {
      ...current.value,
      revision: checkpointRevision,
      controlRejections: [...current.value.controlRejections, redacted]
        .slice(-SYSTEM_PERSISTENCE_LIMITS.maximumControlRejections),
    };
    const trace = traceForCheckpoint({
      idPrefix: `control.rejected.${audit.dedupeKey}`,
      sequence: checkpointRevision,
      componentId: 'engine-supervisor',
      correlationId: audit.correlationId,
      occurredAtMs: audit.occurredAtMs,
      kind: 'CONTROL',
      machinePhase: 'RUNNING',
      ownerId: null,
      referenceIds: [audit.dedupeKey],
    });
    const committed = this.commitCheckpoint(nextState, {
      auditKind: 'TRANSITION',
      correlationId: audit.correlationId,
      occurredAtMs: audit.occurredAtMs,
      traceEvent: trace,
    });
    if (!committed.ok) throw new Error(`${committed.code}: ${committed.message}`);
    return { kind: 'RECORDED', ledgerEventId: committed.value.ledgerEventId };
  }
}

export { SystemLedgerPersistenceAdapter as SystemIntegrationLedgerAdapter };
