import {
  canonicalJson,
  createStructuredFailure,
  fail,
  isReconciliationStatus,
  isValidUtcMillis,
  ok,
  stableHash128Hex,
  type ContractResult,
} from '../../foundation/contracts/index.js';
import {
  POSITION_STATES,
  canTransitionCapitalLifecycle,
  compareExactDecimals,
  deriveCapitalCheckpointId,
  isCapitalLifecycleState,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  truthAllowsNewExposure,
  validateEconomicAttribution,
  validatePositionActionIntent,
  type ActivePosition,
  type ActivePositionId,
  type CapitalEventId,
  type CapitalReservation,
  type ExactDecimal,
  type ExternalReconciliationReference,
  type OperatorApprovalId,
} from '../contracts/index.js';
import {
  decodeCapitalCheckpointEventRecord,
  validateCapitalCheckpointEvent,
} from './events.js';
import {
  CAPITAL_CHECKPOINT_SCHEMA,
  CAPITAL_CHECKPOINT_VERSION,
  type ApprovalRevocationRecord,
  type CapitalCheckpoint,
  type CapitalCheckpointEvent,
  type CapitalCheckpointEventKind,
  type CapitalCheckpointRecord,
  type CapitalCheckpointResult,
  type CapitalCheckpointState,
  type CapitalLifecycleRecord,
  type PositionEconomicsRecord,
  type RestartSafetyProjection,
  type RestartTruthInput,
  type RestoredCapitalProjection,
  type RestoreCapitalCheckpointInput,
} from './types.js';

function nonEmpty(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value as Readonly<T>;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry, seen);
  } else {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function failure<T>(
  code: string,
  message: string,
  nowMs: number,
  correlationId: string,
  safeCurrentState: string,
): ContractResult<T> {
  return fail(createStructuredFailure({
    component: 'capitalFoundation.checkpoint',
    stage: 'project',
    code,
    message,
    occurredAt: nowMs,
    retryable: false,
    safeCurrentState,
    recommendedOperatorAction: 'Use a complete monotonic event stream or a verified checkpoint.',
    correlationId,
  }));
}

export function createEmptyCapitalCheckpointState(streamId: string): Readonly<CapitalCheckpointState> {
  if (!nonEmpty(streamId)) throw new TypeError('checkpoint streamId must be a bounded non-empty string');
  return deepFreeze({
    streamId,
    revision: 0,
    lastSequence: 0,
    updatedAtMs: null,
    reservations: [],
    mandates: [],
    stagedPlans: [],
    approvals: [],
    revocations: [],
    theses: [],
    positions: [],
    reconciliationReferences: [],
    intents: [],
    economics: [],
    lifecycles: [],
    eventLog: [],
    processedEventIds: [],
  });
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function validTimes(
  record: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  return requiredKeys.every((key) => isValidUtcMillis(record[key]))
    && optionalKeys.every((key) => record[key] === null || isValidUtcMillis(record[key]));
}

function exact(value: unknown, nonNegative: boolean): boolean {
  try {
    const normalized = nonNegative
      ? normalizeNonNegativeExactDecimal(value)
      : normalizeExactDecimal(value);
    return normalized === value;
  } catch {
    return false;
  }
}

const NESTED_EXACT_DECIMAL_FIELDS: Readonly<Record<string, boolean>> = Object.freeze({
  amount: false,
  baseQuantity: false,
  consumedAmount: true,
  economicCostOfWaiting: true,
  expectedCostOfActing: true,
  hedgeRatio: false,
  high: false,
  liquidityRequirement: true,
  low: false,
  maximumAdditionalExposure: true,
  maximumExposure: true,
  maximumNakedLegAmount: true,
  maximumNotional: true,
  maximumTotalExposure: true,
  netDirectionalExposure: false,
  netKnown: false,
  oneLegExposure: true,
  quantity: true,
  quoteExposure: true,
  quoteNotional: false,
  remainingReservedAmount: true,
  reservationConsumption: true,
  targetHedgeRatio: false,
  targetMaximumExposure: true,
  totalGrossExposure: true,
});

function validateNestedExactDecimals(
  value: unknown,
  path = '$',
  seen = new Set<object>(),
): readonly string[] {
  if (!object(value) && !Array.isArray(value)) return Object.freeze([]);
  if (seen.has(value as object)) return Object.freeze(['FINANCIAL_FIELD_CYCLIC']);
  seen.add(value as object);
  const reasons: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => reasons.push(...validateNestedExactDecimals(entry, `${path}[${index}]`, seen)));
  } else {
    for (const [key, entry] of Object.entries(value)) {
      const nonNegative = NESTED_EXACT_DECIMAL_FIELDS[key];
      if (nonNegative !== undefined && entry !== null && !exact(entry, nonNegative)) {
        reasons.push(`FINANCIAL_FIELD_INVALID:${path}.${key}`);
      }
      reasons.push(...validateNestedExactDecimals(entry, `${path}.${key}`, seen));
    }
  }
  seen.delete(value as object);
  return Object.freeze(reasons);
}

function validateCheckpointRecord(kind: CapitalCheckpointEventKind, value: unknown): readonly string[] {
  if (!object(value)) return Object.freeze(['RECORD_OBJECT_REQUIRED']);
  const reasons: string[] = [...validateNestedExactDecimals(value)];
  if (!nonEmpty(value.id)) reasons.push('RECORD_ID_INVALID');
  switch (kind) {
    case 'RESERVATION_UPSERTED':
      if (!validRevision(value.revision)) reasons.push('RESERVATION_REVISION_INVALID');
      if (!exact(value.amount, true) || !exact(value.consumedAmount, true)) reasons.push('RESERVATION_DECIMAL_INVALID');
      if (!validTimes(value, ['createdAtMs', 'expiresAtMs'], ['releasedAtMs'])
        || (isValidUtcMillis(value.createdAtMs) && isValidUtcMillis(value.expiresAtMs) && value.expiresAtMs <= value.createdAtMs)) reasons.push('RESERVATION_TIME_INVALID');
      if (!['ACTIVE', 'RELEASED', 'EXPIRED'].includes(String(value.state))) reasons.push('RESERVATION_STATE_INVALID');
      if (value.state === 'ACTIVE' && value.releasedAtMs !== null) reasons.push('ACTIVE_RESERVATION_RELEASE_TIME_INVALID');
      if (exact(value.amount, true) && exact(value.consumedAmount, true)
        && compareExactDecimals(value.consumedAmount as ExactDecimal, value.amount as ExactDecimal) > 0) reasons.push('RESERVATION_CONSUMPTION_EXCEEDS_AMOUNT');
      break;
    case 'MANDATE_UPSERTED':
      if (!validRevision(value.revision)) reasons.push('MANDATE_REVISION_INVALID');
      if (!exact(value.targetMaximumExposure, true)) reasons.push('MANDATE_DECIMAL_INVALID');
      if (!validTimes(value, ['createdAtMs', 'expiresAtMs'])
        || (isValidUtcMillis(value.createdAtMs) && isValidUtcMillis(value.expiresAtMs) && value.expiresAtMs <= value.createdAtMs)) reasons.push('MANDATE_TIME_INVALID');
      break;
    case 'STAGED_PLAN_UPSERTED':
      if (!validRevision(value.revision)) reasons.push('STAGED_PLAN_REVISION_INVALID');
      if (!exact(value.remainingReservedAmount, true)) reasons.push('STAGED_PLAN_DECIMAL_INVALID');
      if (!validTimes(value, ['createdAtMs', 'expiresAtMs'])
        || (isValidUtcMillis(value.createdAtMs) && isValidUtcMillis(value.expiresAtMs) && value.expiresAtMs <= value.createdAtMs)) reasons.push('STAGED_PLAN_TIME_INVALID');
      break;
    case 'APPROVAL_UPSERTED':
      if (!exact(value.maximumNotional, true)) reasons.push('APPROVAL_DECIMAL_INVALID');
      if (!validTimes(value, ['issuedAtMs', 'expiresAtMs'], ['revokedAtMs'])
        || (isValidUtcMillis(value.issuedAtMs) && isValidUtcMillis(value.expiresAtMs) && value.expiresAtMs <= value.issuedAtMs)) reasons.push('APPROVAL_TIME_INVALID');
      if (!['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY', 'MANUAL_ARMED'].includes(String(value.mode))) reasons.push('APPROVAL_MODE_INVALID');
      break;
    case 'APPROVAL_REVOKED':
      if (!validRevision(value.revision)) reasons.push('REVOCATION_REVISION_INVALID');
      if (!nonEmpty(value.approvalId) || !isValidUtcMillis(value.revokedAtMs) || !nonEmpty(value.reasonReference)) reasons.push('REVOCATION_INVALID');
      break;
    case 'THESIS_UPSERTED':
      if (!validRevision(value.revision) || !isValidUtcMillis(value.openedAtMs)) reasons.push('THESIS_REVISION_OR_TIME_INVALID');
      break;
    case 'POSITION_UPSERTED':
      if (!validRevision(value.revision)) reasons.push('POSITION_REVISION_INVALID');
      if (!(POSITION_STATES as readonly unknown[]).includes(value.state)) reasons.push('POSITION_STATE_INVALID');
      if (!isCapitalLifecycleState(value.capitalLifecycle)) reasons.push('POSITION_LIFECYCLE_INVALID');
      if (!exact(value.totalGrossExposure, true) || !exact(value.netDirectionalExposure, false) || !exact(value.oneLegExposure, true)) reasons.push('POSITION_DECIMAL_INVALID');
      if (!validTimes(value, ['openedAtMs', 'lastTransitionAtMs'], ['oneLegSinceMs'])) reasons.push('POSITION_TIME_INVALID');
      break;
    case 'RECONCILIATION_UPSERTED':
      if (!isReconciliationStatus(value.status) || !isValidUtcMillis(value.observedAtMs)) reasons.push('RECONCILIATION_INVALID');
      break;
    case 'ACTION_INTENT_UPSERTED':
      reasons.push(...validatePositionActionIntent(value).map((reason) => `INTENT_${reason}`));
      break;
    case 'ECONOMICS_UPSERTED': {
      if (!validRevision(value.revision) || !nonEmpty(value.positionId) || !object(value.attribution)) reasons.push('ECONOMICS_RECORD_INVALID');
      else reasons.push(...validateEconomicAttribution(value.attribution as never).map((reason) => `ECONOMICS_${reason}`));
      break;
    }
    case 'LIFECYCLE_REVISED':
      if (!validRevision(value.revision) || !isCapitalLifecycleState(value.state) || !isValidUtcMillis(value.lastTransitionAtMs) || !nonEmpty(value.aggregateId) || !nonEmpty(value.correlationId, 128)) reasons.push('LIFECYCLE_RECORD_INVALID');
      break;
  }
  return Object.freeze([...new Set(reasons)]);
}

function byId<T extends { readonly id: string }>(rows: readonly T[], id: string): T | undefined {
  return rows.find((row) => row.id === id);
}

function upsert<T extends { readonly id: string }>(rows: readonly T[], value: T): readonly T[] {
  return Object.freeze([...rows.filter((row) => row.id !== value.id), value].sort((left, right) => compareText(left.id, right.id)));
}

function revisionOf(value: unknown): number | null {
  return object(value) && validRevision(value.revision) ? value.revision : null;
}

function terminalReservation(value: CapitalReservation, nowMs: number): boolean {
  return value.state === 'RELEASED' || value.state === 'EXPIRED' || value.expiresAtMs <= nowMs;
}

function recordConflict(
  kind: CapitalCheckpointEventKind,
  state: CapitalCheckpointState,
  record: CapitalCheckpointRecord,
  nowMs: number,
): string | null {
  const id = record.id;
  const collection: readonly { readonly id: string }[] = kind === 'RESERVATION_UPSERTED' ? state.reservations
    : kind === 'MANDATE_UPSERTED' ? state.mandates
      : kind === 'STAGED_PLAN_UPSERTED' ? state.stagedPlans
        : kind === 'APPROVAL_UPSERTED' ? state.approvals
          : kind === 'APPROVAL_REVOKED' ? state.revocations
            : kind === 'THESIS_UPSERTED' ? state.theses
              : kind === 'POSITION_UPSERTED' ? state.positions
                : kind === 'RECONCILIATION_UPSERTED' ? state.reconciliationReferences
                  : kind === 'ACTION_INTENT_UPSERTED' ? state.intents
                    : kind === 'ECONOMICS_UPSERTED' ? state.economics
                      : state.lifecycles;
  const existing = byId(collection, id);
  if (!existing) return null;
  const oldRevision = revisionOf(existing);
  const nextRevision = revisionOf(record);
  if (oldRevision !== null && (nextRevision === null || nextRevision <= oldRevision)) return 'RECORD_REVISION_NOT_MONOTONIC';
  if (kind === 'RESERVATION_UPSERTED' && terminalReservation(existing as CapitalReservation, nowMs)
    && (record as CapitalReservation).state === 'ACTIVE') return 'RESERVATION_RESURRECTION_FORBIDDEN';
  if (kind === 'APPROVAL_UPSERTED') {
    const prior = existing as CapitalCheckpointState['approvals'][number];
    if (prior.revokedAtMs !== null || prior.expiresAtMs <= nowMs) return 'APPROVAL_RESURRECTION_FORBIDDEN';
    if (canonicalJson(prior) !== canonicalJson(record)) return 'APPROVAL_REPLACEMENT_FORBIDDEN';
  }
  if (kind === 'POSITION_UPSERTED' && (existing as ActivePosition).state === 'CLOSED'
    && (record as ActivePosition).state !== 'CLOSED') return 'POSITION_RESURRECTION_FORBIDDEN';
  if (kind === 'LIFECYCLE_REVISED') {
    const prior = existing as CapitalLifecycleRecord;
    const next = record as CapitalLifecycleRecord;
    if (prior.aggregateId !== next.aggregateId) return 'LIFECYCLE_AGGREGATE_CHANGED';
    if (prior.state !== next.state && !canTransitionCapitalLifecycle(prior.state, next.state)) return 'ILLEGAL_LIFECYCLE_TRANSITION';
  }
  return null;
}

function addRecord(
  state: CapitalCheckpointState,
  kind: CapitalCheckpointEventKind,
  record: CapitalCheckpointRecord,
): Omit<CapitalCheckpointState, 'revision' | 'lastSequence' | 'updatedAtMs' | 'eventLog' | 'processedEventIds'> {
  return {
    streamId: state.streamId,
    reservations: kind === 'RESERVATION_UPSERTED' ? upsert(state.reservations, record as CapitalReservation) : state.reservations,
    mandates: kind === 'MANDATE_UPSERTED' ? upsert(state.mandates, record as CapitalCheckpointState['mandates'][number]) : state.mandates,
    stagedPlans: kind === 'STAGED_PLAN_UPSERTED' ? upsert(state.stagedPlans, record as CapitalCheckpointState['stagedPlans'][number]) : state.stagedPlans,
    approvals: kind === 'APPROVAL_UPSERTED' ? upsert(state.approvals, record as CapitalCheckpointState['approvals'][number]) : state.approvals,
    revocations: kind === 'APPROVAL_REVOKED' ? upsert(state.revocations, record as ApprovalRevocationRecord) : state.revocations,
    theses: kind === 'THESIS_UPSERTED' ? upsert(state.theses, record as CapitalCheckpointState['theses'][number]) : state.theses,
    positions: kind === 'POSITION_UPSERTED' ? upsert(state.positions, record as ActivePosition) : state.positions,
    reconciliationReferences: kind === 'RECONCILIATION_UPSERTED' ? upsert(state.reconciliationReferences, record as ExternalReconciliationReference) : state.reconciliationReferences,
    intents: kind === 'ACTION_INTENT_UPSERTED' ? upsert(state.intents, record as CapitalCheckpointState['intents'][number]) : state.intents,
    economics: kind === 'ECONOMICS_UPSERTED' ? upsert(state.economics, record as PositionEconomicsRecord) : state.economics,
    lifecycles: kind === 'LIFECYCLE_REVISED' ? upsert(state.lifecycles, record as CapitalLifecycleRecord) : state.lifecycles,
  };
}

export function applyCapitalCheckpointEvent(
  state: Readonly<CapitalCheckpointState>,
  event: Readonly<CapitalCheckpointEvent>,
): CapitalCheckpointResult<CapitalCheckpointState> {
  const issues = validateCapitalCheckpointEvent(event);
  if (issues.length > 0) {
    const failureAt = isValidUtcMillis(event.occurredAtMs) ? event.occurredAtMs : (state.updatedAtMs ?? 0);
    const failureCorrelation = nonEmpty(event.correlationId, 128) ? event.correlationId : 'checkpoint-event-invalid';
    return failure('CHECKPOINT_EVENT_INVALID', issues.join(','), failureAt, failureCorrelation, `REVISION_${state.revision}`);
  }
  if (event.streamId !== state.streamId) return failure('CHECKPOINT_STREAM_MISMATCH', 'event stream does not match projection stream', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  const duplicateIndex = state.processedEventIds.indexOf(event.id);
  if (duplicateIndex >= 0) {
    const prior = state.eventLog[duplicateIndex];
    if (canonicalJson(prior) !== canonicalJson(event)) return failure('DUPLICATE_EVENT_CONFLICT', 'duplicate event ID carries different content', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
    return ok(state);
  }
  if (event.sequence !== state.lastSequence + 1) return failure('EVENT_SEQUENCE_NOT_MONOTONIC', 'unique event sequence must advance exactly once', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  if (state.updatedAtMs !== null && event.occurredAtMs < state.updatedAtMs) {
    return failure('EVENT_TIME_NOT_MONOTONIC', 'unique event time cannot move backward within a stream', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  }
  let record: CapitalCheckpointRecord;
  try {
    record = decodeCapitalCheckpointEventRecord(event);
  } catch {
    return failure('CHECKPOINT_EVENT_RECORD_INVALID', 'event record could not be decoded', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  }
  const recordIssues = validateCheckpointRecord(event.kind, record);
  if (recordIssues.length > 0) return failure('CHECKPOINT_RECORD_INVALID', recordIssues.join(','), event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  if (event.kind === 'RESERVATION_UPSERTED') {
    const reservation = record as CapitalReservation;
    if (reservation.state === 'ACTIVE' && reservation.expiresAtMs <= event.occurredAtMs) {
      return failure('RESERVATION_ALREADY_EXPIRED', 'an active reservation must outlive the event that records it', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
    }
  }
  const conflict = recordConflict(event.kind, state, record, event.occurredAtMs);
  if (conflict !== null) return failure(conflict, 'record update violates monotonic or terminal-state law', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  if (event.kind === 'APPROVAL_UPSERTED') {
    const approval = record as CapitalCheckpointState['approvals'][number];
    if (state.revocations.some((item) => item.approvalId === approval.id)) return failure('APPROVAL_RESURRECTION_FORBIDDEN', 'revoked approval cannot be reintroduced', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  }
  if (event.kind === 'APPROVAL_REVOKED') {
    const revocation = record as ApprovalRevocationRecord;
    if (!state.approvals.some((approval) => approval.id === revocation.approvalId)) return failure('APPROVAL_FOR_REVOCATION_MISSING', 'revocation must reference a known approval', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  }
  const collections = addRecord(state, event.kind, record);
  return ok(deepFreeze({
    ...collections,
    revision: state.revision + 1,
    lastSequence: event.sequence,
    updatedAtMs: event.occurredAtMs,
    eventLog: [...state.eventLog, event],
    processedEventIds: [...state.processedEventIds, event.id],
  }));
}

export function replayCapitalCheckpointEvents(
  streamId: string,
  events: readonly Readonly<CapitalCheckpointEvent>[],
): CapitalCheckpointResult<CapitalCheckpointState> {
  let state = createEmptyCapitalCheckpointState(streamId);
  const byEventId = new Map<string, CapitalCheckpointEvent>();
  for (const event of events) {
    const prior = byEventId.get(event.id);
    if (prior && canonicalJson(prior) !== canonicalJson(event)) return failure('DUPLICATE_EVENT_CONFLICT', 'same event ID has conflicting content', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
    if (!prior) byEventId.set(event.id, event);
  }
  const ordered = [...byEventId.values()].sort((left, right) => left.sequence - right.sequence || compareText(left.id, right.id));
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1].sequence === ordered[index].sequence) return failure('EVENT_SEQUENCE_CONFLICT', 'two unique events claim one sequence', ordered[index].occurredAtMs, ordered[index].correlationId, `REVISION_${state.revision}`);
  }
  for (const event of ordered) {
    const applied = applyCapitalCheckpointEvent(state, event);
    if (!applied.ok) return applied;
    state = applied.value;
  }
  return ok(state);
}

function checkpointPayload(state: Readonly<CapitalCheckpointState>): Omit<CapitalCheckpoint, 'checksum'> {
  const stateDigest = stableHash128Hex(canonicalJson(state));
  return {
    schema: CAPITAL_CHECKPOINT_SCHEMA,
    version: CAPITAL_CHECKPOINT_VERSION,
    id: deriveCapitalCheckpointId({ streamId: state.streamId, revision: state.revision, stateDigest }),
    streamId: state.streamId,
    revision: state.revision,
    state,
  };
}

export function createCapitalCheckpoint(state: Readonly<CapitalCheckpointState>): Readonly<CapitalCheckpoint> {
  const replayed = replayCapitalCheckpointEvents(state.streamId, state.eventLog);
  if (!replayed.ok || canonicalJson(replayed.value) !== canonicalJson(state)) throw new TypeError('capital checkpoint state does not match deterministic event replay');
  const payload = checkpointPayload(state);
  return deepFreeze({ ...payload, checksum: stableHash128Hex(canonicalJson(payload)) });
}

export function serializeCapitalCheckpoint(state: Readonly<CapitalCheckpointState>): string {
  return canonicalJson(createCapitalCheckpoint(state));
}

function hasPositiveExposure(position: ActivePosition): boolean {
  return compareExactDecimals(position.totalGrossExposure, '0' as ExactDecimal) > 0
    || compareExactDecimals(position.oneLegExposure, '0' as ExactDecimal) > 0
    || position.legs.some((leg) => compareExactDecimals(leg.quoteExposure, '0' as ExactDecimal) > 0);
}

function exposed(position: ActivePosition): boolean {
  return hasPositiveExposure(position);
}

function reconciliationConflict(
  checkpoint: ExternalReconciliationReference | null,
  current: ExternalReconciliationReference | null,
): boolean {
  if (checkpoint?.status === 'DIVERGED' || checkpoint?.status === 'AMBIGUOUS') return true;
  if (current?.status === 'DIVERGED' || current?.status === 'AMBIGUOUS') return true;
  if (checkpoint === null || current === null) return true;
  if (checkpoint.externalPlanId !== current.externalPlanId || checkpoint.correlationId !== current.correlationId) return true;
  if (checkpoint.sequence !== null && current.sequence !== null && current.sequence < checkpoint.sequence) return true;
  return checkpoint.sequence !== null && current.sequence === checkpoint.sequence && checkpoint.status !== current.status;
}

function usableApprovalIds(
  state: Readonly<CapitalCheckpointState>,
  nowMs: number,
): readonly OperatorApprovalId[] {
  const revocations = new Set(state.revocations.map((item) => item.approvalId));
  return Object.freeze(state.approvals.filter((approval) => {
    if (approval.mode !== 'MANUAL_ARMED' || approval.revokedAtMs !== null || revocations.has(approval.id)
      || approval.issuedAtMs > nowMs || approval.expiresAtMs <= nowMs) return false;
    const mandate = state.mandates.find((item) => item.id === approval.mandateId);
    const plan = state.stagedPlans.find((item) => item.id === approval.stagedPlanId);
    const reservation = mandate === undefined
      ? undefined
      : state.reservations.find((item) => item.id === mandate.reservationId);
    if (!mandate || !plan || !reservation || mandate.expiresAtMs <= nowMs || plan.expiresAtMs <= nowMs
      || reservation.state !== 'ACTIVE' || reservation.releasedAtMs !== null || reservation.expiresAtMs <= nowMs) return false;
    return mandate.approvalId === approval.id
      && mandate.revision === approval.mandateRevision
      && mandate.digest === approval.mandateDigest
      && mandate.proposalIntakeDigest === approval.proposalIntakeDigest
      && mandate.stagedPlanId === approval.stagedPlanId
      && mandate.stagedPlanRevision === approval.stagedPlanRevision
      && mandate.stagedPlanDigest === approval.stagedPlanDigest
      && mandate.configRevision === approval.configRevision
      && plan.id === approval.stagedPlanId
      && plan.reservationId === mandate.reservationId
      && plan.revision === approval.stagedPlanRevision
      && plan.digest === approval.stagedPlanDigest;
  }).map((approval) => approval.id).sort()) as readonly OperatorApprovalId[];
}

export function projectRestartSafety(
  state: Readonly<CapitalCheckpointState>,
  input: RestartTruthInput,
): Readonly<RestoredCapitalProjection> {
  if (!isValidUtcMillis(input.nowMs) || !nonEmpty(input.correlationId, 128)) throw new TypeError('restart projection requires injected UTC time and correlation ID');
  const effectiveReservations = state.reservations.map((reservation) => reservation.state === 'ACTIVE' && reservation.expiresAtMs <= input.nowMs
    ? deepFreeze({ ...reservation, state: 'EXPIRED' as const })
    : reservation);
  const recoveryIds: ActivePositionId[] = [];
  const recoveryReasons: string[] = [];
  const effectivePositions = state.positions.map((position) => {
    if (position.state === 'CLOSED' && hasPositiveExposure(position)) {
      recoveryIds.push(position.id);
      recoveryReasons.push('CLOSED_POSITION_HAS_EXPOSURE');
      return deepFreeze({ ...position, state: 'RECOVERY_REQUIRED' as const, capitalLifecycle: 'RECOVERY_REQUIRED' as const });
    }
    if (!exposed(position)) return position;
    const checkpointRef = position.reconciliationReference;
    if (checkpointRef === null) {
      recoveryIds.push(position.id);
      recoveryReasons.push('POSITION_RECONCILIATION_REFERENCE_MISSING');
      return deepFreeze({ ...position, state: 'RECOVERY_REQUIRED' as const, capitalLifecycle: 'RECOVERY_REQUIRED' as const });
    }
    const matches = input.reconciliationReferences.filter((item) => item.externalPlanId === checkpointRef.externalPlanId);
    if (matches.length !== 1) {
      recoveryIds.push(position.id);
      recoveryReasons.push(matches.length === 0
        ? 'POSITION_RECONCILIATION_REFERENCE_MISSING'
        : 'POSITION_RECONCILIATION_REFERENCE_DUPLICATE');
      return deepFreeze({ ...position, state: 'RECOVERY_REQUIRED' as const, capitalLifecycle: 'RECOVERY_REQUIRED' as const });
    }
    const current = matches[0];
    const conflicts = reconciliationConflict(checkpointRef, current);
    if (current.status !== 'EXACT' || !truthAllowsNewExposure(current.truth) || conflicts) {
      recoveryIds.push(position.id);
      if (current.status !== 'EXACT') recoveryReasons.push('POSITION_RECONCILIATION_NOT_EXACT');
      if (!truthAllowsNewExposure(current.truth)) recoveryReasons.push('POSITION_RECONCILIATION_TRUTH_NOT_FRESH');
      if (conflicts) recoveryReasons.push('CHECKPOINT_RECONCILIATION_CONFLICT');
      return deepFreeze({ ...position, state: 'RECOVERY_REQUIRED' as const, capitalLifecycle: 'RECOVERY_REQUIRED' as const });
    }
    return position;
  });
  const visiblePositionIds = effectivePositions.filter(exposed).map((position) => position.id);
  const accountFresh = input.accountTruth !== null && truthAllowsNewExposure(input.accountTruth);
  const reconciliationFresh = input.reconciliationTruth !== null && truthAllowsNewExposure(input.reconciliationTruth);
  const reasonCodes: string[] = [];
  if (!accountFresh) reasonCodes.push('RESTART_ACCOUNT_TRUTH_NOT_FRESH');
  if (!reconciliationFresh) reasonCodes.push('RESTART_RECONCILIATION_TRUTH_NOT_FRESH');
  reasonCodes.push(...recoveryReasons);
  const outstandingIntentIds = new Set(effectivePositions.flatMap((position) => position.outstandingActionIntentIds));
  const outstandingIntents = state.intents.filter((intent) => outstandingIntentIds.has(intent.id));
  const blockedIncreasing = outstandingIntents.filter((intent) => intent.riskEffect === 'RISK_INCREASING').map((intent) => intent.id);
  const allowedReduction = outstandingIntents.filter((intent) => intent.riskEffect !== 'RISK_INCREASING').map((intent) => intent.id);
  const safety: RestartSafetyProjection = {
    evaluatedAtMs: input.nowMs,
    canOpenOrIncrease: accountFresh && reconciliationFresh && recoveryIds.length === 0,
    supervisionContinues: visiblePositionIds.length > 0,
    reasonCodes: sortedUnique(reasonCodes),
    visiblePositionIds: Object.freeze([...visiblePositionIds].sort()),
    recoveryRequiredPositionIds: Object.freeze([...recoveryIds].sort()),
    usableApprovalIds: usableApprovalIds(state, input.nowMs),
    effectiveActiveReservationIds: Object.freeze(effectiveReservations.filter((item) => item.state === 'ACTIVE').map((item) => item.id).sort()),
    effectiveExpiredReservationIds: Object.freeze(effectiveReservations.filter((item) => item.state === 'EXPIRED').map((item) => item.id).sort()),
    blockedRiskIncreasingIntentIds: Object.freeze(blockedIncreasing.sort()),
    allowedRiskReducingOrNeutralIntentIds: Object.freeze(allowedReduction.sort()),
  };
  return deepFreeze({
    checkpointId: checkpointPayload(state).id,
    checkpointState: state,
    effectiveReservations,
    effectivePositions,
    safety,
  });
}

export function restoreCapitalCheckpoint(
  input: RestoreCapitalCheckpointInput,
): CapitalCheckpointResult<RestoredCapitalProjection> {
  if (!isValidUtcMillis(input.nowMs) || !nonEmpty(input.correlationId, 128)) throw new TypeError('checkpoint restore requires injected UTC time and correlation ID');
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.serialized);
  } catch {
    return failure('CHECKPOINT_PARSE_FAILED', 'checkpoint is not valid JSON', input.nowMs, input.correlationId, 'UNKNOWN');
  }
  if (!object(parsed)) return failure('CHECKPOINT_SHAPE_INVALID', 'checkpoint must be an object', input.nowMs, input.correlationId, 'UNKNOWN');
  const expectedKeys = ['checksum', 'id', 'revision', 'schema', 'state', 'streamId', 'version'];
  if (Object.keys(parsed).sort().join('|') !== expectedKeys.join('|')) return failure('CHECKPOINT_UNKNOWN_FIELD', 'checkpoint contains missing or unknown fields', input.nowMs, input.correlationId, 'UNKNOWN');
  if (parsed.schema !== CAPITAL_CHECKPOINT_SCHEMA || parsed.version !== CAPITAL_CHECKPOINT_VERSION) return failure('CHECKPOINT_SCHEMA_UNSUPPORTED', 'checkpoint schema or version is unsupported', input.nowMs, input.correlationId, 'UNKNOWN');
  const { checksum, ...payload } = parsed;
  if (typeof checksum !== 'string' || checksum !== stableHash128Hex(canonicalJson(payload))) return failure('CHECKPOINT_CHECKSUM_MISMATCH', 'checkpoint checksum does not match canonical payload', input.nowMs, input.correlationId, 'UNKNOWN');
  if (!object(parsed.state) || !Array.isArray(parsed.state.eventLog) || !nonEmpty(parsed.streamId) || parsed.state.streamId !== parsed.streamId || parsed.state.revision !== parsed.revision) {
    return failure('CHECKPOINT_STATE_INVALID', 'checkpoint state identity or event log is invalid', input.nowMs, input.correlationId, 'UNKNOWN');
  }
  const events = parsed.state.eventLog as CapitalCheckpointEvent[];
  const replayed = replayCapitalCheckpointEvents(parsed.streamId, events);
  if (!replayed.ok) return replayed as CapitalCheckpointResult<RestoredCapitalProjection>;
  if (canonicalJson(replayed.value) !== canonicalJson(parsed.state)) return failure('CHECKPOINT_REPLAY_MISMATCH', 'checkpoint snapshot differs from deterministic event replay', input.nowMs, input.correlationId, 'UNKNOWN');
  const expected = checkpointPayload(replayed.value);
  if (parsed.id !== expected.id) return failure('CHECKPOINT_ID_INVALID', 'checkpoint ID does not match state content', input.nowMs, input.correlationId, 'UNKNOWN');
  return ok(projectRestartSafety(replayed.value, input));
}
