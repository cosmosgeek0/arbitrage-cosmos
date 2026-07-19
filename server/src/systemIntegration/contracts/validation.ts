import { types as utilTypes } from 'node:util';
import {
  evaluateFreshness,
  isCompleteness,
  isDataAuthority,
  isDesiredRuntimeState,
  isFreshnessState,
  isRuntimePhase,
  isValidUtcMillis,
  validateSourcedTimestamp,
  validateStructuredFailure,
  weakestAuthority,
  type DataAuthority,
  type FreshnessReport,
  type SourcedTimestamp,
  type ValidationIssue,
} from '../../foundation/contracts/index.js';
import {
  PRODUCT_FAMILIES,
  SOURCE_ENDPOINT_CLASSES,
} from '../../intelligenceFoundation/contracts/index.js';
import {
  DIALECT_LOSS_CODES,
  SYSTEM_COMPONENT_IDS,
  SYSTEM_CONTROL_COMMANDS,
  SYSTEM_OWNER_KINDS,
  SYSTEM_READINESS_STATES,
  SYSTEM_RELEASE_STATUSES,
  SYSTEM_SAFE_MODES,
  SYSTEM_SEMANTIC_STREAMS,
  SYSTEM_SOURCE_PRODUCER_KINDS,
  SYSTEM_SOURCE_TRANSPORTS,
  SYSTEM_TRACE_EVENT_KINDS,
  SYSTEM_TRUTH_LABELS,
  type SystemComponentId,
  type SystemControlCommand,
  type SystemOwnerKind,
  type SystemReleaseStatus,
  type SystemSafeMode,
  type SystemTruthLabel,
} from './constants.js';
import type {
  OpaqueIdentityAlias,
  SystemComponentSnapshot,
  SystemControlMutationRequest,
  SystemSourceRegistryRecord,
  SystemSourceRegistrySnapshot,
  SystemTraceEvent,
} from './types.js';

const UPPER_CODE = /^[A-Z][A-Z0-9_]{0,99}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const LIVE_PUBLIC_AUTHORITIES = new Set<DataAuthority>(['LIVE_PUBLIC', 'DERIVED_LIVE']);
const FRESH_SOURCE_COMPONENTS = new Set<SystemComponentId>([
  'public-spot-source',
  'public-usdm-source',
  'market-universe',
  'intelligence-runtime',
  'market-intelligence',
  'q-inference',
  'basis-engine',
  'volume-engine',
]);
const UNAVAILABLE_TRUTH_LOSS_CODES = new Set([
  'MAX_AGE_MISSING',
  'RUNTIME_UNKNOWN_MAPPED_UNAVAILABLE',
  'MI_MISSING_MAPPED_UNAVAILABLE',
  'MI_UNKNOWN_MAPPED_UNAVAILABLE',
  'UPSTREAM_AUTHORITY_MISSING',
  'AUTHORITY_CONTEXT_MISMATCH',
  'OPERATOR_AUTHORITY_UNREPRESENTABLE',
  'UNKNOWN_AUTHORITY',
  'STALE_AUTHORITY_DOWNGRADED',
]);

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => Object.prototype.hasOwnProperty.call(descriptor, 'value') && descriptor.enumerable,
  );
}

function exactFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): ValidationIssue[] {
  const set = new Set(allowed);
  return Object.keys(value)
    .filter((key) => !set.has(key))
    .map((key) => issue(`${path}${path ? '.' : ''}${key}`, 'UNKNOWN_FIELD', `unexpected field '${key}'`));
}

function validText(value: unknown, maximum = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value.trim() === value
    && !/[\r\n\0]/.test(value);
}

function validOptionalText(value: unknown, maximum = 256): value is string | null {
  return value === null || validText(value, maximum);
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function stringList(value: unknown, maximum = 256): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every((entry) => validText(entry));
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function has<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function isLivePublicAuthority(value: unknown): value is Extract<DataAuthority, 'LIVE_PUBLIC' | 'DERIVED_LIVE'> {
  return isDataAuthority(value) && LIVE_PUBLIC_AUTHORITIES.has(value);
}

function validateFreshnessReport(value: unknown): ValidationIssue[] {
  if (!plainRecord(value)) return [issue('freshness', 'FRESHNESS_INVALID', 'freshness must retain the Foundation shape')];
  const issues = exactFields(value, ['state', 'ageMs', 'basis', 'effectiveAuthority', 'evaluatedAt'], 'freshness');
  const stateValid = isFreshnessState(value.state);
  const authorityValid = isDataAuthority(value.effectiveAuthority);
  const basisValid = value.basis === 'SOURCE_TIME' || value.basis === 'RECEIPT_TIME' || value.basis === 'NONE';
  const ageValid = value.ageMs === null || (typeof value.ageMs === 'number' && Number.isSafeInteger(value.ageMs));
  if (!stateValid) issues.push(issue('freshness.state', 'FRESHNESS_STATE_INVALID', 'state must reuse Foundation FreshnessState'));
  if (!ageValid) issues.push(issue('freshness.ageMs', 'FRESHNESS_AGE_INVALID', 'ageMs must be a safe integer or null'));
  if (!basisValid) issues.push(issue('freshness.basis', 'FRESHNESS_BASIS_INVALID', 'basis must reuse Foundation FreshnessBasis'));
  if (!authorityValid) issues.push(issue('freshness.effectiveAuthority', 'FRESHNESS_AUTHORITY_INVALID', 'effectiveAuthority must reuse Foundation DataAuthority'));
  if (!isValidUtcMillis(value.evaluatedAt)) issues.push(issue('freshness.evaluatedAt', 'UTC_MILLIS_INVALID', 'evaluatedAt must be UTC ms'));

  if (stateValid && authorityValid && basisValid && ageValid) {
    if (value.state === 'UNAVAILABLE'
        && (value.ageMs !== null || value.basis !== 'NONE' || value.effectiveAuthority !== 'UNAVAILABLE')) {
      issues.push(issue('freshness', 'FRESHNESS_UNAVAILABLE_CONFLICT', 'unavailable freshness must have no basis, age, or authority'));
    }
    if (value.state !== 'UNAVAILABLE' && (value.ageMs === null || value.basis === 'NONE')) {
      issues.push(issue('freshness', 'FRESHNESS_BASIS_REQUIRED', 'available freshness requires an age and temporal basis'));
    }
    if (value.state !== 'FRESH' && value.effectiveAuthority !== 'UNAVAILABLE') {
      issues.push(issue('freshness.effectiveAuthority', 'STALE_AUTHORITY_NOT_DOWNGRADED', 'non-fresh truth must downgrade authority to UNAVAILABLE'));
    }
    if (value.state === 'FRESH' && value.effectiveAuthority === 'UNAVAILABLE') {
      issues.push(issue('freshness.effectiveAuthority', 'FRESH_AUTHORITY_UNAVAILABLE', 'fresh truth cannot claim unavailable effective authority'));
    }
  }
  return issues;
}

function freshnessMatchesSource(
  sourceTimestamp: Readonly<SourcedTimestamp>,
  freshness: Readonly<FreshnessReport>,
): boolean {
  const expected = evaluateFreshness(sourceTimestamp, freshness.evaluatedAt);
  return expected.state === freshness.state
    && expected.ageMs === freshness.ageMs
    && expected.basis === freshness.basis
    && expected.effectiveAuthority === freshness.effectiveAuthority;
}

export function isSystemSafeMode(value: unknown): value is SystemSafeMode {
  return has(SYSTEM_SAFE_MODES, value);
}

export function isSystemReleaseStatus(value: unknown): value is SystemReleaseStatus {
  return has(SYSTEM_RELEASE_STATUSES, value);
}

export function isSystemTruthLabel(value: unknown): value is SystemTruthLabel {
  return has(SYSTEM_TRUTH_LABELS, value);
}

export function isSystemComponentId(value: unknown): value is SystemComponentId {
  return has(SYSTEM_COMPONENT_IDS, value);
}

export function isSystemOwnerKind(value: unknown): value is SystemOwnerKind {
  return has(SYSTEM_OWNER_KINDS, value);
}

export function isSystemControlCommand(value: unknown): value is SystemControlCommand {
  return has(SYSTEM_CONTROL_COMMANDS, value);
}

export function validateReleaseStatuses(value: unknown): ValidationIssue[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [issue('releaseStatuses', 'NON_EMPTY_ARRAY_REQUIRED', 'releaseStatuses must be a non-empty array')];
  }
  const issues: ValidationIssue[] = [];
  if (value.length > SYSTEM_RELEASE_STATUSES.length) {
    issues.push(issue('releaseStatuses', 'ARRAY_TOO_LONG', 'releaseStatuses exceeds the canonical vocabulary'));
  }
  if (value.some((entry) => !isSystemReleaseStatus(entry))) {
    issues.push(issue('releaseStatuses', 'RELEASE_STATUS_INVALID', 'releaseStatuses contains an unknown value'));
    return issues;
  }
  const statuses = value as SystemReleaseStatus[];
  if (!unique(statuses)) issues.push(issue('releaseStatuses', 'DUPLICATE_STATUS', 'releaseStatuses contains duplicates'));
  const present = new Set(statuses);
  if (present.has('LIVE_PUBLIC') && !present.has('WIRED')) {
    issues.push(issue('releaseStatuses', 'LIVE_REQUIRES_WIRED', 'LIVE_PUBLIC requires WIRED evidence'));
  }
  if (present.has('LIVE_PUBLIC') && ['SYNTHETIC_ONLY', 'NOT_CONFIGURED', 'MISSING'].some((status) => present.has(status as SystemReleaseStatus))) {
    issues.push(issue('releaseStatuses', 'LIVE_STATUS_CONFLICT', 'LIVE_PUBLIC conflicts with synthetic, unconfigured, or missing state'));
  }
  if (present.has('MISSING') && present.size > 1) {
    issues.push(issue('releaseStatuses', 'MISSING_STATUS_CONFLICT', 'MISSING cannot claim other release evidence'));
  }
  if (present.has('NOT_CONFIGURED') && (present.has('WIRED') || present.has('LIVE_PUBLIC'))) {
    issues.push(issue('releaseStatuses', 'CONFIGURATION_STATUS_CONFLICT', 'NOT_CONFIGURED conflicts with WIRED/LIVE_PUBLIC'));
  }
  return issues;
}

export function validateOpaqueIdentityAlias(value: unknown): ValidationIssue[] {
  if (!plainRecord(value)) return [issue('', 'OBJECT_REQUIRED', 'identity alias must be a plain data object')];
  const issues = exactFields(value, [
    'systemId', 'owner', 'ownerId', 'canonicalProjectionId', 'correlationId', 'revisionDigest',
  ], '');
  if (!validText(value.systemId)) issues.push(issue('systemId', 'ID_INVALID', 'systemId must be a canonical bounded string'));
  if (!isSystemOwnerKind(value.owner)) issues.push(issue('owner', 'OWNER_INVALID', 'owner must be a SystemOwnerKind'));
  if (!validText(value.ownerId)) issues.push(issue('ownerId', 'ID_INVALID', 'ownerId must be an opaque bounded string'));
  if (!validOptionalText(value.canonicalProjectionId)) issues.push(issue('canonicalProjectionId', 'ID_INVALID', 'canonicalProjectionId must be null or bounded'));
  if (!validText(value.correlationId, 128)) issues.push(issue('correlationId', 'CORRELATION_INVALID', 'correlationId must be bounded'));
  if (!validOptionalText(value.revisionDigest, 256)) issues.push(issue('revisionDigest', 'REVISION_INVALID', 'revisionDigest must be null or bounded'));
  return issues;
}

export function createOpaqueIdentityAlias(value: OpaqueIdentityAlias): Readonly<OpaqueIdentityAlias> {
  const issues = validateOpaqueIdentityAlias(value);
  if (issues.length > 0) {
    throw new TypeError(`invalid identity alias: ${issues.map((entry) => `${entry.path}:${entry.code}`).join(', ')}`);
  }
  return Object.freeze({ ...value });
}

export function validateSystemSourceRegistryRecord(value: unknown): ValidationIssue[] {
  if (!plainRecord(value)) return [issue('', 'OBJECT_REQUIRED', 'source registry record must be plain data')];
  const issues = exactFields(value, [
    'sourceId', 'semanticStream', 'dataset', 'productFamily', 'endpointClass', 'physicalProducer',
    'semanticPublisher', 'consumers', 'releaseStatuses', 'maximumAuthority', 'duplicatePolicy', 'notes',
  ], '');
  if (!validText(value.sourceId)) issues.push(issue('sourceId', 'SOURCE_ID_INVALID', 'sourceId must be bounded'));
  if (!has(SYSTEM_SEMANTIC_STREAMS, value.semanticStream)) issues.push(issue('semanticStream', 'SEMANTIC_STREAM_INVALID', 'unknown semantic stream'));
  if (!validText(value.dataset)) issues.push(issue('dataset', 'DATASET_INVALID', 'dataset must be bounded'));
  if (value.productFamily !== 'ANY' && !has(PRODUCT_FAMILIES, value.productFamily)) issues.push(issue('productFamily', 'PRODUCT_FAMILY_INVALID', 'unknown product family'));
  if (!has(SOURCE_ENDPOINT_CLASSES, value.endpointClass)) issues.push(issue('endpointClass', 'ENDPOINT_CLASS_INVALID', 'unknown endpoint class'));
  if (value.semanticPublisher !== 'intelligence-runtime') issues.push(issue('semanticPublisher', 'PUBLISHER_INVALID', 'semantic publisher must be intelligence-runtime'));
  if (!Array.isArray(value.consumers) || value.consumers.length > SYSTEM_COMPONENT_IDS.length
      || value.consumers.some((entry) => !isSystemComponentId(entry))
      || !unique(value.consumers as string[])) {
    issues.push(issue('consumers', 'CONSUMERS_INVALID', 'consumers must be unique canonical component IDs'));
  }
  issues.push(...validateReleaseStatuses(value.releaseStatuses));
  if (!isDataAuthority(value.maximumAuthority) || value.maximumAuthority === 'LIVE_PRIVATE') {
    issues.push(issue('maximumAuthority', 'AUTHORITY_INVALID', 'source registry cannot claim private authority'));
  }
  if (value.duplicatePolicy !== 'SINGLE_PRODUCER_ONLY') issues.push(issue('duplicatePolicy', 'DUPLICATE_POLICY_INVALID', 'only SINGLE_PRODUCER_ONLY is allowed'));
  if (!stringList(value.notes, 32) || !unique(value.notes as string[])) issues.push(issue('notes', 'NOTES_INVALID', 'notes must be unique bounded strings'));

  if (!plainRecord(value.physicalProducer)) {
    issues.push(issue('physicalProducer', 'OBJECT_REQUIRED', 'physicalProducer must be plain data'));
  } else {
    issues.push(...exactFields(value.physicalProducer, ['kind', 'producerId', 'ownerPath', 'transport'], 'physicalProducer'));
    const producer = value.physicalProducer;
    if (!has(SYSTEM_SOURCE_PRODUCER_KINDS, producer.kind)) issues.push(issue('physicalProducer.kind', 'PRODUCER_KIND_INVALID', 'unknown producer kind'));
    if (!validOptionalText(producer.producerId) || !validOptionalText(producer.ownerPath, 512)) issues.push(issue('physicalProducer', 'PRODUCER_IDENTITY_INVALID', 'producer identity must be bounded or null'));
    if (!has(SYSTEM_SOURCE_TRANSPORTS, producer.transport)) issues.push(issue('physicalProducer.transport', 'TRANSPORT_INVALID', 'unknown source transport'));
    if (producer.kind === 'NONE' && (producer.producerId !== null || producer.ownerPath !== null || producer.transport !== 'NONE')) {
      issues.push(issue('physicalProducer', 'ABSENT_PRODUCER_CONFLICT', 'NONE producer must have null identity and NONE transport'));
    }
    if (producer.kind === 'EXISTING_AUDITED' && (!validText(producer.producerId) || !validText(producer.ownerPath, 512) || producer.transport !== 'INJECTED_EXISTING')) {
      issues.push(issue('physicalProducer', 'AUDITED_PRODUCER_INVALID', 'audited producer requires identity/path and injected transport'));
    }
    if (producer.kind === 'MANUAL_ACCEPTANCE_ONLY' && producer.transport !== 'MANUAL_PUBLIC_SMOKE') {
      issues.push(issue('physicalProducer.transport', 'MANUAL_TRANSPORT_REQUIRED', 'manual producer must use MANUAL_PUBLIC_SMOKE'));
    }
  }
  return issues;
}

export function validateSystemSourceRegistrySnapshot(value: unknown): ValidationIssue[] {
  if (!plainRecord(value)) return [issue('', 'OBJECT_REQUIRED', 'source registry snapshot must be plain data')];
  const issues = exactFields(value, ['revision', 'evaluatedAtMs', 'records'], '');
  if (!validCount(value.revision)) issues.push(issue('revision', 'REVISION_INVALID', 'revision must be non-negative'));
  if (!isValidUtcMillis(value.evaluatedAtMs)) issues.push(issue('evaluatedAtMs', 'UTC_MILLIS_INVALID', 'evaluatedAtMs must be Foundation UTC ms'));
  if (!Array.isArray(value.records) || value.records.length > 64) {
    issues.push(issue('records', 'RECORDS_INVALID', 'records must be a bounded array'));
    return issues;
  }
  value.records.forEach((record, index) => {
    for (const nested of validateSystemSourceRegistryRecord(record)) {
      issues.push({ ...nested, path: `records[${index}]${nested.path ? `.${nested.path}` : ''}` });
    }
  });
  const sourceIds = value.records.filter(plainRecord).map((record) => String(record.sourceId));
  const streams = value.records.filter(plainRecord).map((record) => String(record.semanticStream));
  if (!unique(sourceIds)) issues.push(issue('records', 'DUPLICATE_SOURCE_ID', 'source IDs must be unique'));
  if (!unique(streams)) issues.push(issue('records', 'DUPLICATE_SEMANTIC_PRODUCER', 'one producer may publish each semantic stream'));
  return issues;
}

export function createSystemSourceRegistrySnapshot(
  value: SystemSourceRegistrySnapshot,
): Readonly<SystemSourceRegistrySnapshot> {
  const issues = validateSystemSourceRegistrySnapshot(value);
  if (issues.length > 0) {
    throw new TypeError(`invalid source registry: ${issues.map((entry) => `${entry.path}:${entry.code}`).join(', ')}`);
  }
  return Object.freeze({
    revision: value.revision,
    evaluatedAtMs: value.evaluatedAtMs,
    records: Object.freeze(value.records.map((record) => Object.freeze({
      ...record,
      physicalProducer: Object.freeze({ ...record.physicalProducer }),
      consumers: Object.freeze([...record.consumers]),
      releaseStatuses: Object.freeze([...record.releaseStatuses]),
      notes: Object.freeze([...record.notes]),
    }))),
  });
}

export function validateSystemComponentSnapshot(value: unknown): ValidationIssue[] {
  if (!plainRecord(value)) return [issue('', 'OBJECT_REQUIRED', 'component snapshot must be plain data')];
  const allowed = [
    'componentId', 'owner', 'ownerPath', 'releaseStatuses', 'truthLabel', 'desiredState', 'phase',
    'domainObservedState', 'sourceLifecycle', 'readiness', 'authority', 'completeness', 'sourceTimestamp',
    'freshness', 'lastReceiveAtMs', 'lastProcessAtMs', 'lastSuccessAtMs', 'processingLagMs',
    'retry', 'dataQuality', 'checkpoint', 'dependencies', 'queue',
    'lastFailure', 'blockerCodes', 'generation', 'restartCount', 'supportedControls', 'capitalExposed',
    'operatorAttentionRequired',
  ];
  const issues = exactFields(value, allowed, '');
  if (!isSystemComponentId(value.componentId)) issues.push(issue('componentId', 'COMPONENT_ID_INVALID', 'unknown component ID'));
  if (!isSystemOwnerKind(value.owner)) issues.push(issue('owner', 'OWNER_INVALID', 'unknown owner'));
  if (!validText(value.ownerPath, 512)) issues.push(issue('ownerPath', 'OWNER_PATH_INVALID', 'ownerPath must be bounded'));
  issues.push(...validateReleaseStatuses(value.releaseStatuses));
  if (!isSystemTruthLabel(value.truthLabel)) issues.push(issue('truthLabel', 'TRUTH_LABEL_INVALID', 'unknown truth label'));
  if (!isDesiredRuntimeState(value.desiredState)) issues.push(issue('desiredState', 'DESIRED_STATE_INVALID', 'must reuse Foundation DesiredRuntimeState'));
  if (!isRuntimePhase(value.phase)) issues.push(issue('phase', 'RUNTIME_PHASE_INVALID', 'must reuse Foundation RuntimePhase'));
  if (!validOptionalText(value.domainObservedState, 128)) issues.push(issue('domainObservedState', 'DOMAIN_STATE_INVALID', 'domain state must be null or bounded'));
  if (value.sourceLifecycle !== null && !['STOPPED', 'CONNECTING', 'WARMING', 'LIVE', 'SILENT', 'STALE', 'DEGRADED', 'BACKING_OFF', 'RATE_LIMITED', 'FAILED'].includes(String(value.sourceLifecycle))) {
    issues.push(issue('sourceLifecycle', 'SOURCE_LIFECYCLE_INVALID', 'unknown runtime source lifecycle'));
  }
  if (!has(SYSTEM_READINESS_STATES, value.readiness)) issues.push(issue('readiness', 'READINESS_INVALID', 'unknown readiness'));
  if (!isDataAuthority(value.authority)) issues.push(issue('authority', 'AUTHORITY_INVALID', 'must reuse Foundation DataAuthority'));
  if (!isCompleteness(value.completeness)) issues.push(issue('completeness', 'COMPLETENESS_INVALID', 'must reuse Foundation Completeness'));
  const sourceTimestampIssues = value.sourceTimestamp === null
    ? []
    : validateSourcedTimestamp(value.sourceTimestamp);
  for (const nested of sourceTimestampIssues) issues.push({ ...nested, path: `sourceTimestamp.${nested.path}` });
  const freshnessIssues = value.freshness === null
    ? []
    : validateFreshnessReport(value.freshness);
  issues.push(...freshnessIssues);
  if (value.sourceTimestamp !== null && value.freshness !== null
      && sourceTimestampIssues.length === 0 && freshnessIssues.length === 0
      && !freshnessMatchesSource(
        value.sourceTimestamp as Readonly<SourcedTimestamp>,
        value.freshness as Readonly<FreshnessReport>,
      )) {
    issues.push(issue('freshness', 'FRESHNESS_SOURCE_MISMATCH', 'freshness must be the canonical evaluation of sourceTimestamp'));
  }
  for (const field of ['lastReceiveAtMs', 'lastProcessAtMs', 'lastSuccessAtMs'] as const) {
    if (value[field] !== null && !isValidUtcMillis(value[field])) issues.push(issue(field, 'UTC_MILLIS_INVALID', `${field} must be null or UTC ms`));
  }
  if (value.processingLagMs !== undefined
      && value.processingLagMs !== null
      && !validCount(value.processingLagMs)) {
    issues.push(issue('processingLagMs', 'LAG_INVALID', 'processingLagMs must be a non-negative safe integer or null'));
  }
  if (value.retry !== undefined) {
    if (!plainRecord(value.retry)) {
      issues.push(issue('retry', 'RETRY_INVALID', 'retry must be a plain operational snapshot'));
    } else {
      const retry = value.retry;
      issues.push(...exactFields(retry, ['state', 'attempt', 'ceiling', 'delayMs', 'retryAtMs', 'cooldownUntilMs'], 'retry'));
      if (!['IDLE', 'RETRYING', 'BACKING_OFF', 'COOLDOWN', 'UNKNOWN', 'UNAVAILABLE'].includes(String(retry.state))) {
        issues.push(issue('retry.state', 'RETRY_STATE_INVALID', 'retry state is unknown'));
      }
      for (const field of ['attempt', 'ceiling', 'delayMs'] as const) {
        if (retry[field] !== null && !validCount(retry[field])) {
          issues.push(issue(`retry.${field}`, 'COUNTER_INVALID', `${field} must be a non-negative safe integer or null`));
        }
      }
      for (const field of ['retryAtMs', 'cooldownUntilMs'] as const) {
        if (retry[field] !== null && !isValidUtcMillis(retry[field])) {
          issues.push(issue(`retry.${field}`, 'UTC_MILLIS_INVALID', `${field} must be null or UTC ms`));
        }
      }
      const state = String(retry.state);
      const allNull = ['attempt', 'ceiling', 'delayMs', 'retryAtMs', 'cooldownUntilMs']
        .every((field) => retry[field] === null);
      const attempt = retry.attempt;
      const ceiling = retry.ceiling;
      const activeAttempt = validCount(attempt) && attempt > 0;
      const boundedCeiling = validCount(ceiling)
        && activeAttempt && ceiling >= attempt;
      const scheduled = validCount(retry.delayMs) && retry.retryAtMs !== null;
      if ((state === 'UNKNOWN' || state === 'UNAVAILABLE') && !allNull) {
        issues.push(issue('retry', 'RETRY_UNKNOWN_CONFLICT', 'unknown or unavailable retry truth cannot carry invented values'));
      } else if (state === 'IDLE'
          && (retry.attempt !== 0 || !validCount(retry.ceiling)
            || retry.delayMs !== null || retry.retryAtMs !== null || retry.cooldownUntilMs !== null)) {
        issues.push(issue('retry', 'RETRY_IDLE_CONFLICT', 'idle retry truth requires attempt zero, a bounded ceiling, and no active schedule'));
      } else if (state === 'RETRYING'
          && (!activeAttempt || !boundedCeiling || !scheduled || retry.cooldownUntilMs !== null)) {
        issues.push(issue('retry', 'RETRY_ACTIVE_EVIDENCE_REQUIRED', 'retrying truth requires one bounded active attempt and schedule without cooldown'));
      } else if (state === 'BACKING_OFF'
          && (!activeAttempt || !boundedCeiling || !scheduled || (retry.delayMs as number) < 1
            || retry.cooldownUntilMs !== null)) {
        issues.push(issue('retry', 'RETRY_BACKOFF_EVIDENCE_REQUIRED', 'backing-off truth requires one bounded delayed attempt without cooldown'));
      } else if (state === 'COOLDOWN') {
        if (!activeAttempt || !boundedCeiling || !scheduled || retry.cooldownUntilMs === null) {
          issues.push(issue('retry', 'RETRY_COOLDOWN_EVIDENCE_REQUIRED', 'cooldown truth requires one bounded attempt, retry schedule, and cooldown end'));
        } else if (typeof retry.retryAtMs === 'number'
            && typeof retry.cooldownUntilMs === 'number'
            && retry.cooldownUntilMs < retry.retryAtMs) {
          issues.push(issue('retry.cooldownUntilMs', 'RETRY_COOLDOWN_ORDER_INVALID', 'cooldown cannot end before the scheduled retry'));
        }
      }
      if (value.sourceLifecycle === 'LIVE' && state !== 'IDLE') {
        issues.push(issue('retry.state', 'RETRY_LIVE_CONFLICT', 'a live source cannot retain an active retry schedule'));
      }
      if (value.sourceLifecycle === 'BACKING_OFF' && state !== 'BACKING_OFF' && state !== 'COOLDOWN') {
        issues.push(issue('retry.state', 'RETRY_LIFECYCLE_CONFLICT', 'a backing-off source requires matching retry evidence'));
      }
    }
  }
  if (value.dataQuality !== undefined) {
    if (!plainRecord(value.dataQuality)) {
      issues.push(issue('dataQuality', 'DATA_QUALITY_INVALID', 'dataQuality must be a plain operational snapshot'));
    } else {
      const quality = value.dataQuality;
      issues.push(...exactFields(quality, ['state', 'invalidCount', 'duplicateCount', 'outOfOrderCount', 'sequenceGapCount', 'observedAtMs'], 'dataQuality'));
      if (!['GOOD', 'DEGRADED', 'UNKNOWN', 'UNAVAILABLE'].includes(String(quality.state))) {
        issues.push(issue('dataQuality.state', 'DATA_QUALITY_STATE_INVALID', 'data quality state is unknown'));
      }
      for (const field of ['invalidCount', 'duplicateCount', 'outOfOrderCount', 'sequenceGapCount'] as const) {
        if (quality[field] !== null && !validCount(quality[field])) {
          issues.push(issue(`dataQuality.${field}`, 'COUNTER_INVALID', `${field} must be a non-negative safe integer or null`));
        }
      }
      if (quality.observedAtMs !== null && !isValidUtcMillis(quality.observedAtMs)) {
        issues.push(issue('dataQuality.observedAtMs', 'UTC_MILLIS_INVALID', 'observedAtMs must be null or UTC ms'));
      }
      const qualityValues = ['invalidCount', 'duplicateCount', 'outOfOrderCount', 'sequenceGapCount', 'observedAtMs'];
      const qualityUnknown = qualityValues.every((field) => quality[field] === null);
      const qualityComplete = quality.observedAtMs !== null
        && ['invalidCount', 'duplicateCount', 'outOfOrderCount', 'sequenceGapCount']
          .every((field) => validCount(quality[field]));
      if ((quality.state === 'UNKNOWN' || quality.state === 'UNAVAILABLE') && !qualityUnknown) {
        issues.push(issue('dataQuality', 'DATA_QUALITY_UNKNOWN_CONFLICT', 'unknown or unavailable quality cannot carry invented values'));
      }
      if (quality.state === 'GOOD') {
        const counters = ['invalidCount', 'duplicateCount', 'outOfOrderCount', 'sequenceGapCount'] as const;
        if (!qualityComplete) {
          issues.push(issue('dataQuality', 'DATA_QUALITY_GOOD_EVIDENCE_REQUIRED', 'good quality requires observed-at evidence and every quality counter'));
        } else if (counters.some((field) => quality[field] !== 0)) {
          issues.push(issue('dataQuality', 'DATA_QUALITY_GOOD_CONFLICT', 'good quality cannot carry nonzero fault counters'));
        }
        if (value.completeness !== 'COMPLETE') {
          issues.push(issue('dataQuality', 'DATA_QUALITY_GOOD_COMPLETENESS_CONFLICT', 'good quality requires complete owner truth'));
        }
      } else if (quality.state === 'DEGRADED' && !qualityComplete) {
        issues.push(issue('dataQuality', 'DATA_QUALITY_DEGRADED_EVIDENCE_REQUIRED', 'degraded quality requires observed-at evidence and every quality counter'));
      }
    }
  }
  if (value.checkpoint !== undefined) {
    if (!plainRecord(value.checkpoint)) {
      issues.push(issue('checkpoint', 'CHECKPOINT_INVALID', 'checkpoint must be a plain operational snapshot'));
    } else {
      const checkpoint = value.checkpoint;
      issues.push(...exactFields(checkpoint, ['state', 'revision', 'persistedAtMs'], 'checkpoint'));
      if (!['CURRENT', 'DIRTY', 'STALE', 'MISSING', 'UNKNOWN', 'UNAVAILABLE'].includes(String(checkpoint.state))) {
        issues.push(issue('checkpoint.state', 'CHECKPOINT_STATE_INVALID', 'checkpoint state is unknown'));
      }
      if (!validOptionalText(checkpoint.revision, 256)) {
        issues.push(issue('checkpoint.revision', 'CHECKPOINT_REVISION_INVALID', 'revision must be null or bounded'));
      }
      if (checkpoint.persistedAtMs !== null && !isValidUtcMillis(checkpoint.persistedAtMs)) {
        issues.push(issue('checkpoint.persistedAtMs', 'UTC_MILLIS_INVALID', 'persistedAtMs must be null or UTC ms'));
      }
      if ((checkpoint.state === 'UNKNOWN' || checkpoint.state === 'UNAVAILABLE' || checkpoint.state === 'MISSING')
          && (checkpoint.revision !== null || checkpoint.persistedAtMs !== null)) {
        issues.push(issue('checkpoint', 'CHECKPOINT_UNKNOWN_CONFLICT', 'missing, unknown, or unavailable checkpoint cannot carry invented values'));
      }
      if ((checkpoint.state === 'CURRENT' || checkpoint.state === 'DIRTY' || checkpoint.state === 'STALE')
          && (checkpoint.revision === null || checkpoint.persistedAtMs === null)) {
        issues.push(issue('checkpoint', 'CHECKPOINT_EVIDENCE_REQUIRED', 'current, dirty, or stale checkpoint truth requires revision and persistence time'));
      }
    }
  }
  if (!Array.isArray(value.dependencies) || value.dependencies.some((entry) => !isSystemComponentId(entry))
      || !unique(value.dependencies as string[]) || value.dependencies.includes(value.componentId)) {
    issues.push(issue('dependencies', 'DEPENDENCIES_INVALID', 'dependencies must be unique non-self component IDs'));
  }
  if (value.lastFailure !== null && validateStructuredFailure(value.lastFailure).length > 0) issues.push(issue('lastFailure', 'STRUCTURED_FAILURE_INVALID', 'lastFailure must retain Foundation shape'));
  if (!stringList(value.blockerCodes, 256) || !unique(value.blockerCodes as string[]) || (value.blockerCodes as string[]).some((code) => !UPPER_CODE.test(code))) issues.push(issue('blockerCodes', 'BLOCKERS_INVALID', 'blocker codes must be unique upper snake case'));
  if (!validCount(value.generation) || !validCount(value.restartCount)) issues.push(issue('generation', 'COUNTER_INVALID', 'generation/restartCount must be non-negative'));
  if (!Array.isArray(value.supportedControls) || value.supportedControls.some((entry) => !isSystemControlCommand(entry)) || !unique(value.supportedControls as string[])) issues.push(issue('supportedControls', 'CONTROLS_INVALID', 'controls must be unique canonical commands'));
  if (typeof value.capitalExposed !== 'boolean' || typeof value.operatorAttentionRequired !== 'boolean') issues.push(issue('capitalExposed', 'BOOLEAN_REQUIRED', 'attention/exposure flags must be boolean'));
  const statuses = Array.isArray(value.releaseStatuses) ? new Set(value.releaseStatuses) : new Set<unknown>();
  if (value.truthLabel !== 'LIVE_PUBLIC' && statuses.has('LIVE_PUBLIC')) issues.push(issue('truthLabel', 'LIVE_TRUTH_CONFLICT', 'non-live truth cannot carry LIVE_PUBLIC release status'));
  if (value.truthLabel === 'LIVE_PUBLIC') {
    if (!statuses.has('WIRED') || !statuses.has('LIVE_PUBLIC')) {
      issues.push(issue('truthLabel', 'LIVE_TRUTH_RELEASE_REQUIRED', 'LIVE_PUBLIC truth requires WIRED and LIVE_PUBLIC release evidence'));
    }
    if (!isLivePublicAuthority(value.authority)) {
      issues.push(issue('authority', 'LIVE_TRUTH_AUTHORITY_INVALID', 'LIVE_PUBLIC truth requires LIVE_PUBLIC or DERIVED_LIVE authority'));
    }
    if (value.sourceTimestamp !== null && plainRecord(value.sourceTimestamp)
        && !isLivePublicAuthority(value.sourceTimestamp.authority)) {
      issues.push(issue('sourceTimestamp.authority', 'LIVE_SOURCE_AUTHORITY_INVALID', 'live source evidence requires public or derived-live authority'));
    }
    if (value.freshness !== null && plainRecord(value.freshness)
        && (value.freshness.state !== 'FRESH' || !isLivePublicAuthority(value.freshness.effectiveAuthority))) {
      issues.push(issue('freshness', 'LIVE_FRESHNESS_INVALID', 'represented live freshness must be fresh with public or derived-live authority'));
    }
    if (value.sourceTimestamp !== null && value.freshness !== null
        && sourceTimestampIssues.length === 0 && freshnessIssues.length === 0
        && isLivePublicAuthority(value.authority)
        && isLivePublicAuthority((value.sourceTimestamp as Readonly<SourcedTimestamp>).authority)
        && isLivePublicAuthority((value.freshness as Readonly<FreshnessReport>).effectiveAuthority)
        && weakestAuthority(
          value.authority,
          (value.sourceTimestamp as Readonly<SourcedTimestamp>).authority,
          (value.freshness as Readonly<FreshnessReport>).effectiveAuthority,
        ) !== value.authority) {
      issues.push(issue('authority', 'LIVE_AUTHORITY_UPGRADE', 'component authority cannot exceed its source or freshness authority'));
    }
  }
  if (value.truthLabel === 'LIVE_PUBLIC' && value.readiness === 'READY'
      && isSystemComponentId(value.componentId) && FRESH_SOURCE_COMPONENTS.has(value.componentId)) {
    if (value.sourceTimestamp === null || value.freshness === null) {
      issues.push(issue('freshness', 'READY_LIVE_FRESHNESS_REQUIRED', 'READY live source components require sourceTimestamp and freshness evidence'));
    } else if (sourceTimestampIssues.length === 0 && freshnessIssues.length === 0) {
      const timestamp = value.sourceTimestamp as Readonly<SourcedTimestamp>;
      const freshness = value.freshness as Readonly<FreshnessReport>;
      if (freshness.state !== 'FRESH' || !isLivePublicAuthority(timestamp.authority)
          || !isLivePublicAuthority(freshness.effectiveAuthority)) {
        issues.push(issue('freshness', 'READY_LIVE_FRESHNESS_INVALID', 'READY live source evidence must be fresh and publicly authoritative'));
      }
    }
  }
  if (value.readiness === 'READY' && (value.authority === 'UNAVAILABLE' || value.completeness === 'UNAVAILABLE' || value.phase !== 'RUNNING')) issues.push(issue('readiness', 'READY_TRUTH_INVALID', 'READY requires running and available truth'));
  return issues;
}

export function validateSystemControlMutationRequest(value: unknown): ValidationIssue[] {
  if (!plainRecord(value)) return [issue('', 'OBJECT_REQUIRED', 'control request must be plain data')];
  const issues = exactFields(value, ['idempotencyKey', 'expectedRevision', 'reason', 'requestedAtMs', 'correlationId', 'mutation'], '');
  if (typeof value.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(value.idempotencyKey)) issues.push(issue('idempotencyKey', 'IDEMPOTENCY_KEY_INVALID', 'idempotency key must be bounded'));
  if (!validCount(value.expectedRevision)) issues.push(issue('expectedRevision', 'REVISION_INVALID', 'expectedRevision must be non-negative'));
  if (!validText(value.reason, 500)) issues.push(issue('reason', 'REASON_INVALID', 'reason must be bounded'));
  if (!isValidUtcMillis(value.requestedAtMs)) issues.push(issue('requestedAtMs', 'UTC_MILLIS_INVALID', 'requestedAtMs must be UTC ms'));
  if (!validText(value.correlationId, 128)) issues.push(issue('correlationId', 'CORRELATION_INVALID', 'correlationId must be bounded'));
  if (!plainRecord(value.mutation) || !isSystemControlCommand(value.mutation.command)) {
    issues.push(issue('mutation', 'MUTATION_INVALID', 'mutation must have a canonical command'));
    return issues;
  }
  const mutation = value.mutation;
  const command = mutation.command as SystemControlCommand;
  const fields: Record<SystemControlCommand, readonly string[]> = {
    SET_COMPONENT_STATE: ['command', 'componentId', 'desiredState'],
    SET_INTAKE_PAUSED: ['command', 'paused'],
    SET_SAFE_MODE: ['command', 'safeMode'],
    SET_KILL_SWITCH: ['command', 'engaged'],
    APPLY_CONFIGURATION: ['command', 'configurationRevision', 'payloadDigest'],
    REVOKE_APPROVAL: ['command', 'approvalId'],
    REVOKE_RESERVATION: ['command', 'reservationId'],
    RESTART_COMPONENT: ['command', 'componentId'],
    SET_BASIS_INTAKE: ['command', 'paused'],
    SET_VOLUME_INTAKE: ['command', 'paused'],
    CLEAR_DEPLOYMENT_FREEZE: ['command', 'expectedObservedAtUtc'],
    SET_PUBLIC_SOURCE_LIFECYCLE: ['command', 'sourceId', 'action'],
    SET_BASIS_SYMBOL_POLICY: ['command', 'action', 'symbol'],
    SET_VOLUME_SYMBOL_POLICY: ['command', 'action', 'symbol'],
    REDUCE_SIZE_CEILING: ['command', 'scope', 'maximumNotionalUsd'],
    SET_STRATEGY_THRESHOLD: ['command', 'strategy', 'threshold', 'value'],
    PIN_FOCUS: ['command', 'symbol', 'pinned'],
  };
  issues.push(...exactFields(mutation, fields[command], 'mutation'));
  switch (command) {
    case 'SET_COMPONENT_STATE':
      if (!isSystemComponentId(mutation.componentId) || !isDesiredRuntimeState(mutation.desiredState)) issues.push(issue('mutation', 'COMPONENT_STATE_INVALID', 'component and desired state must be canonical'));
      break;
    case 'SET_INTAKE_PAUSED':
    case 'SET_BASIS_INTAKE':
    case 'SET_VOLUME_INTAKE':
      if (typeof mutation.paused !== 'boolean') issues.push(issue('mutation.paused', 'BOOLEAN_REQUIRED', 'paused must be boolean'));
      break;
    case 'SET_BASIS_SYMBOL_POLICY':
    case 'SET_VOLUME_SYMBOL_POLICY':
      if ((mutation.action !== 'BLOCK' && mutation.action !== 'ALLOW')
        || typeof mutation.symbol !== 'string'
        || !/^[A-Z0-9]{4,20}$/.test(mutation.symbol)) {
        issues.push(issue('mutation', 'STRATEGY_SYMBOL_POLICY_INVALID', 'symbol policy requires a canonical symbol and BLOCK or ALLOW'));
      }
      break;
    case 'REDUCE_SIZE_CEILING': {
      const decimal = mutation.maximumNotionalUsd;
      if ((mutation.scope !== 'SYSTEM' && mutation.scope !== 'BASIS' && mutation.scope !== 'VOLUME')
        || typeof decimal !== 'string'
        || !/^(?:[1-9][0-9]*|0\.[0-9]*[1-9]|[1-9][0-9]*\.[0-9]*[1-9])$/.test(decimal)
        || decimal.replace('.', '').length > 96) {
        issues.push(issue('mutation', 'SIZE_CEILING_INVALID', 'size ceiling reduction requires a canonical positive exact decimal'));
      }
      break;
    }
    case 'SET_STRATEGY_THRESHOLD': {
      const decimal = mutation.value;
      const numeric = typeof decimal === 'string' ? Number(decimal) : Number.NaN;
      const pairValid = (mutation.strategy === 'BASIS' && mutation.threshold === 'MIN_NET_BASIS_PCT')
        || (mutation.strategy === 'VOLUME' && mutation.threshold === 'VOLUME_1S_MULTIPLE');
      const bounded = mutation.strategy === 'BASIS'
        ? numeric >= 0.01 && numeric <= 100
        : numeric >= 1 && numeric <= 100;
      if (!pairValid || typeof decimal !== 'string'
        || !/^(?:[1-9][0-9]*|0\.[0-9]*[1-9]|[1-9][0-9]*\.[0-9]*[1-9])$/.test(decimal)
        || decimal.replace('.', '').length > 12 || !Number.isFinite(numeric) || !bounded) {
        issues.push(issue('mutation', 'STRATEGY_THRESHOLD_INVALID', 'strategy threshold must use an approved pair and bounded canonical value'));
      }
      break;
    }
    case 'PIN_FOCUS':
      if (typeof mutation.symbol !== 'string' || !/^[A-Z0-9]{4,20}$/.test(mutation.symbol)
        || typeof mutation.pinned !== 'boolean') {
        issues.push(issue('mutation', 'FOCUS_PIN_INVALID', 'focus pin requires one canonical symbol and boolean pinned value'));
      }
      break;
    case 'SET_SAFE_MODE':
      if (!isSystemSafeMode(mutation.safeMode)) issues.push(issue('mutation.safeMode', 'SAFE_MODE_INVALID', 'only safe convergence modes are accepted'));
      break;
    case 'SET_PUBLIC_SOURCE_LIFECYCLE':
      if ((mutation.sourceId !== 'public-spot-source' && mutation.sourceId !== 'public-usdm-source')
        || (mutation.action !== 'ISOLATE' && mutation.action !== 'RESTART')) {
        issues.push(issue('mutation', 'SOURCE_LIFECYCLE_INVALID', 'source lifecycle target and action must be canonical'));
      }
      break;
    case 'SET_KILL_SWITCH':
      if (typeof mutation.engaged !== 'boolean') issues.push(issue('mutation.engaged', 'BOOLEAN_REQUIRED', 'engaged must be boolean'));
      break;
    case 'APPLY_CONFIGURATION':
      if (!validText(mutation.configurationRevision) || !validText(mutation.payloadDigest)) issues.push(issue('mutation', 'CONFIGURATION_REFERENCE_INVALID', 'configuration references must be bounded'));
      break;
    case 'REVOKE_APPROVAL':
      if (!validText(mutation.approvalId)) issues.push(issue('mutation.approvalId', 'ID_INVALID', 'approval ID must be bounded'));
      break;
    case 'REVOKE_RESERVATION':
      if (!validText(mutation.reservationId)) issues.push(issue('mutation.reservationId', 'ID_INVALID', 'reservation ID must be bounded'));
      break;
    case 'RESTART_COMPONENT':
      if (!isSystemComponentId(mutation.componentId)) issues.push(issue('mutation.componentId', 'COMPONENT_ID_INVALID', 'restart target must be canonical'));
      break;
    case 'CLEAR_DEPLOYMENT_FREEZE':
      if (!validText(mutation.expectedObservedAtUtc, 32)) issues.push(issue('mutation.expectedObservedAtUtc', 'REVISION_INVALID', 'freeze clear readback revision must be bounded'));
      break;
  }
  return issues;
}

export function validateSystemTraceEvent(value: unknown): ValidationIssue[] {
  if (!plainRecord(value)) return [issue('', 'OBJECT_REQUIRED', 'trace event must be plain data')];
  const issues = exactFields(value, [
    'id', 'sequence', 'kind', 'componentId', 'correlationId', 'occurredAtMs', 'persistedAtMs',
    'truthLabel', 'releaseStatuses', 'ownerId', 'canonicalProjectionId', 'revisionDigest',
    'domainLifecycle', 'machinePhase', 'failure', 'referenceIds', 'lossCodes',
  ], '');
  if (!validText(value.id) || !validCount(value.sequence)) issues.push(issue('id', 'TRACE_ID_INVALID', 'trace ID/sequence must be bounded'));
  if (!has(SYSTEM_TRACE_EVENT_KINDS, value.kind) || !isSystemComponentId(value.componentId)) issues.push(issue('kind', 'TRACE_KIND_INVALID', 'trace kind/component must be canonical'));
  if (!validText(value.correlationId, 128) || !isValidUtcMillis(value.occurredAtMs)
      || (value.persistedAtMs !== null && !isValidUtcMillis(value.persistedAtMs))) issues.push(issue('occurredAtMs', 'TRACE_TIME_INVALID', 'trace times/correlation must be valid'));
  if (!isSystemTruthLabel(value.truthLabel)) issues.push(issue('truthLabel', 'TRUTH_LABEL_INVALID', 'unknown truth label'));
  issues.push(...validateReleaseStatuses(value.releaseStatuses));
  for (const field of ['ownerId', 'canonicalProjectionId', 'revisionDigest', 'domainLifecycle'] as const) {
    if (!validOptionalText(value[field])) issues.push(issue(field, 'REFERENCE_INVALID', `${field} must be bounded or null`));
  }
  if (value.machinePhase !== null && !isRuntimePhase(value.machinePhase)) issues.push(issue('machinePhase', 'RUNTIME_PHASE_INVALID', 'machinePhase must reuse Foundation RuntimePhase'));
  if (value.failure !== null && validateStructuredFailure(value.failure).length > 0) issues.push(issue('failure', 'STRUCTURED_FAILURE_INVALID', 'failure must retain Foundation shape'));
  if (!stringList(value.referenceIds, 256) || !unique(value.referenceIds as string[])) issues.push(issue('referenceIds', 'REFERENCES_INVALID', 'reference IDs must be unique bounded strings'));
  if (!Array.isArray(value.lossCodes) || value.lossCodes.some((entry) => !has(DIALECT_LOSS_CODES, entry)) || !unique(value.lossCodes as string[])) issues.push(issue('lossCodes', 'LOSS_CODES_INVALID', 'loss codes must be unique canonical values'));
  const statuses = Array.isArray(value.releaseStatuses) ? new Set(value.releaseStatuses) : new Set<unknown>();
  if (value.truthLabel !== 'LIVE_PUBLIC' && statuses.has('LIVE_PUBLIC')) issues.push(issue('truthLabel', 'LIVE_TRUTH_CONFLICT', 'dry-run/synthetic trace cannot look live'));
  if (value.truthLabel === 'LIVE_PUBLIC' && (!statuses.has('WIRED') || !statuses.has('LIVE_PUBLIC'))) {
    issues.push(issue('truthLabel', 'LIVE_TRACE_RELEASE_REQUIRED', 'LIVE_PUBLIC trace truth requires WIRED and LIVE_PUBLIC release evidence'));
  }
  if (value.truthLabel === 'LIVE_PUBLIC'
      && ['SYNTHETIC_ONLY', 'NOT_CONFIGURED', 'MISSING'].some((status) => statuses.has(status))) {
    issues.push(issue('truthLabel', 'LIVE_TRACE_UNAVAILABLE_CONFLICT', 'LIVE_PUBLIC trace truth cannot carry synthetic or unavailable release semantics'));
  }
  if (value.truthLabel === 'LIVE_PUBLIC' && Array.isArray(value.lossCodes)
      && value.lossCodes.some((code) => UNAVAILABLE_TRUTH_LOSS_CODES.has(String(code)))) {
    issues.push(issue('lossCodes', 'LIVE_TRACE_AUTHORITY_CONFLICT', 'LIVE_PUBLIC trace truth cannot carry an authority/completeness downgrade to unavailable'));
  }
  return issues;
}
