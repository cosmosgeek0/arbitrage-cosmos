import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import {
  createStructuredFailure,
  fail,
  findSecretLikePaths,
  isCompleteness,
  isDataAuthority,
  isValidUtcMillis,
  ok,
  type ContractResult,
} from '../../foundation/contracts/index.js';
import {
  assertProductComponentEvidence,
  assertProductSupervisorProjection,
  canonicalProductJson,
  deepFreezeProductJson,
} from '../contracts/index.js';
import {
  projectCapitalRiskReference,
  projectExecutionReference,
  projectStrategyDecisionReference,
} from '../adapters/index.js';
import type {
  BoundedOwnerProjection,
  CapitalRiskVerdictConsumerPort,
  DashboardDonorBridgePort,
  DashboardDonorControlReceiptPort,
  DashboardDonorControlMutationPort,
  DashboardDonorSupervisorSnapshotPort,
  ExecutionReconciliationConsumerPort,
  L14CanonicalControlPersistencePort,
  L14ControlCommandLookupPort,
  L14ControlCommandReceiptPort,
  L14ControlEventAppendAcknowledgementPort,
  L14ControlEventAppendRequestPort,
  L14DurableControlPort,
  L14DurableControlPreviewPort,
  L06MutationJournalEntryPort,
  OpportunityAuthorityPort,
  OutcomeFeedbackPort,
  PositionRecoveryConsumerPort,
  ProductDashboardClientPort,
  ProductComponentLifecyclePort,
  ProductLedgerPersistencePort,
  ProductMutationJournalCasPort,
  ProductOperatorCommandPort,
  ProductOperatorEventStreamPort,
  ProductPrivateTruthConsumerPort,
  ProductSupervisorProjectionPort,
  QAssessmentConsumerPort,
  StrategySnapshotConsumerPort,
} from '../contracts/index.js';
import type {
  ProductCapitalRiskReference,
  ProductComponentEvidence,
  ProductExecutionReference,
  ProductOpportunityReference,
  ProductQAssessmentReference,
  ProductStrategyDecisionReference,
} from '../contracts/index.js';
import type {
  ProductCommandPreviewProjection,
  ProductCommandPreviewIntentProjection,
  ProductCommandReceiptProjection,
} from '../commands/index.js';
import { projectCommandDelegation } from '../commands/index.js';
import { projectOperatorEventPage, type ProductOperatorEvent } from '../supervisor/index.js';
import type { ProductSupervisorProjection } from '../contracts/index.js';

const ID = /^[A-Za-z0-9_.:\-]{1,128}$/;
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{16,128}$/;
const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/;
const MAX_FIXTURE_RECORDS = 1_024;
const MAX_FIXTURE_RECORD_BYTES = 262_144;
const MAX_FIXTURE_COLLECTION_BYTES = 1_048_576;

function snapshotFixtureValue<T>(value: T, label: string, maximumBytes = MAX_FIXTURE_RECORD_BYTES): Readonly<T> {
  if (findSecretLikePaths(value).length > 0) throw new TypeError(`${label} contains secret-like fields`);
  const canonical = canonicalProductJson(value);
  if (new TextEncoder().encode(canonical).byteLength > maximumBytes) throw new RangeError(`${label} exceeds its fixture byte bound`);
  return deepFreezeProductJson(JSON.parse(canonical) as T);
}

function snapshotFixtureRecords<T>(records: readonly Readonly<T>[], label: string): readonly Readonly<T>[] {
  if (!Array.isArray(records) || records.length > MAX_FIXTURE_RECORDS) throw new RangeError(`${label} must contain at most ${MAX_FIXTURE_RECORDS} records`);
  const snapshot = records.map((record) => snapshotFixtureValue(record, `${label} record`));
  if (new TextEncoder().encode(canonicalProductJson(snapshot)).byteLength > MAX_FIXTURE_COLLECTION_BYTES) throw new RangeError(`${label} exceeds its fixture collection byte bound`);
  return Object.freeze(snapshot);
}

function uniqueFixtureKeys(label: string, keys: readonly (string | null)[]): void {
  const concrete = keys.filter((key): key is string => key !== null);
  if (concrete.some((key) => !ID.test(key)) || new Set(concrete).size !== concrete.length) throw new TypeError(`${label} contains invalid or duplicate primary IDs`);
}

function sha256(prefix: string, value: unknown): string {
  return `${prefix}${createHash('sha256').update(canonicalProductJson(value)).digest('hex')}`;
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || utilTypes.isProxy(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (Object.getOwnPropertySymbols(value).length !== 0) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const actual = Object.keys(descriptors);
    if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) return false;
    return keys.every((key) => {
      const descriptor = descriptors[key];
      return descriptor !== undefined && 'value' in descriptor && descriptor.get === undefined && descriptor.set === undefined;
    });
  } catch {
    return false;
  }
}

function validL14Reference(value: unknown, owner?: string, waiting = false): boolean {
  const keys = waiting ? ['schema', 'owner', 'id', 'revision', 'digest', 'validation'] : ['schema', 'owner', 'id', 'revision', 'digest'];
  if (!exactRecord(value, keys) || value.schema !== 'LIVE_EDGE_OPAQUE_OWNER_REFERENCE_V1'
      || !L14_IDENTIFIER.test(String(value.id)) || !L14_IDENTIFIER.test(String(value.revision))
      || !SHA256.test(String(value.digest))
      || !['FOUNDATION_CONTROL', 'FOUNDATION_EXECUTION', 'FOUNDATION_RECONCILIATION', 'FOUNDATION_RISK', 'CAPITAL_APPROVALS', 'CAPITAL_RESERVATIONS', 'CAPITAL_POSITIONS', 'L06_MUTATION_JOURNAL', 'L08_RECOVERY'].includes(String(value.owner))
      || (owner !== undefined && value.owner !== owner)) return false;
  return !waiting || (value.owner === 'L08_RECOVERY' && value.validation === 'WAITING_L08');
}

function validL14RiskBound(value: unknown): boolean {
  return exactRecord(value, ['measure', 'maximumPostActionValue'])
    && validL14Reference(value.measure, 'FOUNDATION_RISK')
    && L14_EXACT_DECIMAL.test(String(value.maximumPostActionValue));
}

function validL14Action(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  switch (action.type) {
    case 'SET_COMPONENT_DESIRED_STATE': return exactRecord(action, ['type', 'component', 'desiredState']) && validL14Reference(action.component, 'FOUNDATION_CONTROL') && ['STOPPED', 'RUNNING', 'PAUSED'].includes(String(action.desiredState));
    case 'PAUSE_INTAKE': return exactRecord(action, ['type', 'scope']) && action.scope === 'NEW_RISK';
    case 'RESUME_INTAKE': return exactRecord(action, ['type', 'scope', 'reconciliation']) && action.scope === 'NEW_RISK' && validL14Reference(action.reconciliation, 'FOUNDATION_RECONCILIATION');
    case 'UPDATE_BOUNDED_CONFIGURATION': {
      if (!exactRecord(action, ['type', 'change']) || !action.change || typeof action.change !== 'object' || Array.isArray(action.change)) return false;
      const change = action.change as Record<string, unknown>;
      if (change.setting === 'COMPONENT_STEP_TIMEOUT_MS') return exactRecord(change, ['setting', 'component', 'valueMs']) && validL14Reference(change.component, 'FOUNDATION_CONTROL') && Number.isSafeInteger(change.valueMs) && Number(change.valueMs) >= 100 && Number(change.valueMs) <= 300_000;
      if (change.setting === 'PREFLIGHT_GATE_TIMEOUT_MS') return exactRecord(change, ['setting', 'gateId', 'valueMs']) && L14_SHORT_IDENTIFIER.test(String(change.gateId)) && Number.isSafeInteger(change.valueMs) && Number(change.valueMs) >= 100 && Number(change.valueMs) <= 300_000;
      return change.setting === 'SOURCE_STALE_AFTER_MS' && exactRecord(change, ['setting', 'sourceId', 'valueMs']) && L14_SHORT_IDENTIFIER.test(String(change.sourceId)) && Number.isSafeInteger(change.valueMs) && Number(change.valueMs) >= 100 && Number(change.valueMs) <= 300_000;
    }
    case 'APPROVE': return exactRecord(action, ['type', 'proposal', 'approvalPolicy', 'mode']) && validL14Reference(action.proposal) && validL14Reference(action.approvalPolicy, 'L08_RECOVERY', true) && action.mode === 'VALIDATE_ONLY';
    case 'ARM': return exactRecord(action, ['type', 'approval', 'armingPolicy', 'mode']) && validL14Reference(action.approval, 'CAPITAL_APPROVALS') && validL14Reference(action.armingPolicy, 'L08_RECOVERY', true) && action.mode === 'VALIDATE_ONLY';
    case 'DISARM': return exactRecord(action, ['type', 'arm', 'cause']) && validL14Reference(action.arm, 'CAPITAL_APPROVALS') && ['OPERATOR_REQUEST', 'SAFETY'].includes(String(action.cause));
    case 'REARM': return exactRecord(action, ['type', 'priorArm', 'approval', 'armingPolicy', 'mode']) && validL14Reference(action.priorArm, 'CAPITAL_APPROVALS') && validL14Reference(action.approval, 'CAPITAL_APPROVALS') && validL14Reference(action.armingPolicy, 'L08_RECOVERY', true) && action.mode === 'VALIDATE_ONLY';
    case 'REVOKE': {
      if (!exactRecord(action, ['type', 'targetKind', 'target']) || !['APPROVAL', 'RESERVATION', 'ARM'].includes(String(action.targetKind)) || !validL14Reference(action.target)) return false;
      return (action.targetKind === 'RESERVATION' ? 'CAPITAL_RESERVATIONS' : 'CAPITAL_APPROVALS') === (action.target as Record<string, unknown>).owner;
    }
    case 'HALT': return exactRecord(action, ['type', 'scope', 'retainSupervision']) && action.scope === 'NEW_RISK' && action.retainSupervision === true;
    case 'RECONCILE': return exactRecord(action, ['type', 'scope', 'target']) && action.scope === 'ACCOUNT_AND_EXCHANGE' && validL14Reference(action.target, 'FOUNDATION_RECONCILIATION');
    case 'CANCEL': return exactRecord(action, ['type', 'order', 'orderPolicy', 'riskBound']) && validL14Reference(action.order, 'L06_MUTATION_JOURNAL') && validL14Reference(action.orderPolicy, 'L08_RECOVERY', true) && validL14RiskBound(action.riskBound);
    case 'CLOSE': return exactRecord(action, ['type', 'position', 'orderPolicy', 'riskBound']) && validL14Reference(action.position, 'CAPITAL_POSITIONS') && validL14Reference(action.orderPolicy, 'L08_RECOVERY', true) && validL14RiskBound(action.riskBound);
    case 'REDUCE': return exactRecord(action, ['type', 'position', 'reductionBps', 'orderPolicy', 'riskBound']) && validL14Reference(action.position, 'CAPITAL_POSITIONS') && Number.isSafeInteger(action.reductionBps) && Number(action.reductionBps) > 0 && Number(action.reductionBps) <= 10_000 && validL14Reference(action.orderPolicy, 'L08_RECOVERY', true) && validL14RiskBound(action.riskBound);
    case 'EXECUTE_PRECOMPUTED_RECOVERY_PLAN': return exactRecord(action, ['type', 'recoveryPlan', 'riskBound']) && validL14Reference(action.recoveryPlan, 'L08_RECOVERY', true) && validL14RiskBound(action.riskBound);
    case 'REPAY_LIABILITY': return exactRecord(action, ['type', 'liability', 'repaymentPolicy', 'riskBound']) && validL14Reference(action.liability) && validL14Reference(action.repaymentPolicy, 'L08_RECOVERY', true) && validL14RiskBound(action.riskBound);
    case 'SAFE_RESTART_COMPONENT': return exactRecord(action, ['type', 'component', 'restartMode']) && validL14Reference(action.component, 'FOUNDATION_CONTROL') && action.restartMode === 'SAFE_RECONCILE_FIRST';
    case 'ACKNOWLEDGE_RECOVERY': return exactRecord(action, ['type', 'recovery', 'observedRecoveryRevision', 'statement']) && validL14Reference(action.recovery, 'FOUNDATION_EXECUTION') && L14_IDENTIFIER.test(String(action.observedRecoveryRevision)) && action.statement === 'AWARENESS_ONLY';
    default: return false;
  }
}

function validL14RiskWitness(value: unknown): boolean {
  return value === null || (exactRecord(value, ['truthRevision', 'measureRevision', 'currentValue', 'maximumPostActionValue', 'evaluatedAtMs', 'authority'])
    && L14_IDENTIFIER.test(String(value.truthRevision)) && L14_IDENTIFIER.test(String(value.measureRevision))
    && L14_EXACT_DECIMAL.test(String(value.currentValue)) && L14_EXACT_DECIMAL.test(String(value.maximumPostActionValue))
    && isValidUtcMillis(value.evaluatedAtMs) && value.authority === 'FOUNDATION_RISK');
}

const L14_ACTION_TYPES = Object.freeze(['SET_COMPONENT_DESIRED_STATE', 'PAUSE_INTAKE', 'RESUME_INTAKE', 'UPDATE_BOUNDED_CONFIGURATION', 'APPROVE', 'ARM', 'DISARM', 'REARM', 'REVOKE', 'HALT', 'RECONCILE', 'CANCEL', 'CLOSE', 'REDUCE', 'EXECUTE_PRECOMPUTED_RECOVERY_PLAN', 'REPAY_LIABILITY', 'SAFE_RESTART_COMPONENT', 'ACKNOWLEDGE_RECOVERY']);
const L14_REASON_CODES = Object.freeze(['CONTROL_APPLIED', 'CONTROL_NOOP', 'AWARENESS_RECORDED', 'INVALID_CONTROL_REQUEST', 'STRICT_SCHEMA_VIOLATION', 'SENSITIVE_MATERIAL_REJECTED', 'AUTHENTICATED_OPERATOR_REQUIRED', 'OPERATOR_IDENTITY_INVALID', 'OPERATOR_MISMATCH', 'PREVIEW_AUTHORITY_UNAVAILABLE', 'PREVIEW_AUTHORITY_INVALID', 'PREVIEW_DIGEST_MISMATCH', 'PREVIEW_AUTHENTICATION_FAILED', 'COMMAND_EXPIRED', 'STALE_CONFIG_VERSION', 'STALE_CONTROL_REVISION', 'IDEMPOTENCY_CONFLICT', 'COMMAND_IN_PROGRESS', 'PERSISTENCE_UNAVAILABLE', 'PERSISTENCE_ACK_INVALID', 'COMMAND_OUTCOME_UNCERTAIN', 'OWNER_SNAPSHOT_UNAVAILABLE', 'OWNER_SNAPSHOT_INVALID', 'OWNER_REJECTED', 'OWNER_CONTRACT_INVALID', 'COMMAND_NOT_APPLICABLE', 'KILL_SWITCH_ENGAGED', 'RECOVERY_REQUIRED', 'RECOVERY_STATE_UNKNOWN', 'EXCHANGE_TRUTH_UNAVAILABLE', 'EXCHANGE_TRUTH_STALE', 'EXCHANGE_TRUTH_INCOMPLETE', 'EXCHANGE_TRUTH_MISMATCH', 'RISK_OWNER_UNAVAILABLE', 'RISK_OWNER_CONTRACT_INVALID', 'RISK_INCREASE_FORBIDDEN', 'WAITING_L08', 'CONFIGURATION_OWNER_NOT_WIRED', 'APPROVAL_OWNER_NOT_WIRED', 'LIVE_EXECUTION_NOT_IMPLEMENTED']);
const L14_COMMAND_ID = /^cmd_[a-f0-9]{16,64}$/;
const L14_EVENT_ID = /^l14evt_[a-f0-9]{64}$/;
const L14_ACTOR_BINDING = /^l14actor_[a-f0-9]{64}$/;
const L14_AUTHORIZATION_TAG = /^l14tag_[A-Za-z0-9_-]{16,256}$/;
const L14_HEAD_DIGEST = /^l14head_[a-f0-9]{64}$/;
const L14_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const L14_SHORT_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const L14_EXACT_DECIMAL = /^(?:0|[1-9][0-9]{0,31})(?:\.[0-9]{1,16})?$/;

function validL14Reason(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= 240
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !/(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_ -]?secret|password|authorization|bearer|access[_ -]?token|signature)\s*[:=]?\s*[A-Za-z0-9+/_=-]{12,})/i.test(value)
    && !/(?:[a-z][a-z0-9+.-]*:\/\/|\.\.[/\\]|^[/\\]|\$\(|`|&&|\|\||[<>]\s*[/\\])/i.test(value);
}

function validLedgerEventPair(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && value.every((item) => Number.isSafeInteger(item) && item > 0) && value[0] !== value[1];
}

function validL14Receipt(value: unknown): boolean {
  return exactRecord(value, ['schema', 'version', 'commandId', 'previewDigest', 'actionType', 'disposition', 'reasonCode', 'actorBinding', 'expectedConfigVersion', 'committedControlRevision', 'applied', 'recordedAtMs', 'ledgerEventIds', 'recoveryStateChanged', 'externalActionAuthorization'])
    && value.schema === 'LIVE_EDGE_CONTROL_RECEIPT_V1' && value.version === 1 && L14_COMMAND_ID.test(String(value.commandId))
    && SHA256.test(String(value.previewDigest)) && L14_ACTION_TYPES.includes(String(value.actionType))
    && ['APPLIED', 'NOOP', 'AWARENESS_RECORDED'].includes(String(value.disposition)) && L14_REASON_CODES.includes(String(value.reasonCode))
    && L14_ACTOR_BINDING.test(String(value.actorBinding))
    && Number.isSafeInteger(value.expectedConfigVersion) && Number(value.expectedConfigVersion) >= 0
    && Number.isSafeInteger(value.committedControlRevision) && Number(value.committedControlRevision) >= 1
    && typeof value.applied === 'boolean' && (value.disposition === 'APPLIED') === value.applied
    && (value.disposition === 'APPLIED' ? value.reasonCode === 'CONTROL_APPLIED' : value.disposition === 'NOOP' ? value.reasonCode === 'CONTROL_NOOP' : value.reasonCode === 'AWARENESS_RECORDED' && value.actionType === 'ACKNOWLEDGE_RECOVERY')
    && isValidUtcMillis(value.recordedAtMs) && validLedgerEventPair(value.ledgerEventIds)
    && value.recoveryStateChanged === false && value.externalActionAuthorization === 'NONE';
}

function validL14Rejection(value: unknown): boolean {
  return exactRecord(value, ['schema', 'version', 'commandId', 'previewDigest', 'actionType', 'actorBinding', 'reasonCode', 'expectedConfigVersion', 'committedControlRevision', 'recordedAtMs', 'ledgerEventIds', 'recoveryStateChanged', 'externalActionAuthorization'])
    && value.schema === 'LIVE_EDGE_CONTROL_REJECTION_RECEIPT_V1' && value.version === 1 && L14_COMMAND_ID.test(String(value.commandId))
    && SHA256.test(String(value.previewDigest)) && L14_ACTION_TYPES.includes(String(value.actionType))
    && L14_ACTOR_BINDING.test(String(value.actorBinding)) && L14_REASON_CODES.includes(String(value.reasonCode))
    && !['CONTROL_APPLIED', 'CONTROL_NOOP', 'AWARENESS_RECORDED'].includes(String(value.reasonCode))
    && Number.isSafeInteger(value.expectedConfigVersion) && Number(value.expectedConfigVersion) >= 0
    && Number.isSafeInteger(value.committedControlRevision) && Number(value.committedControlRevision) >= 1
    && isValidUtcMillis(value.recordedAtMs) && validLedgerEventPair(value.ledgerEventIds)
    && value.recoveryStateChanged === false && value.externalActionAuthorization === 'NONE';
}

function validL14Lookup(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const lookup = value as Record<string, unknown>;
  if (lookup.kind === 'NOT_FOUND') return exactRecord(lookup, ['kind', 'journalVersion', 'headDigest']) && lookup.journalVersion === 0 && lookup.headDigest === null;
  const baseValid = SHA256.test(String(lookup.previewDigest)) && L14_ACTOR_BINDING.test(String(lookup.actorBinding))
    && Number.isSafeInteger(lookup.journalVersion) && Number(lookup.journalVersion) > 0 && L14_HEAD_DIGEST.test(String(lookup.headDigest));
  if (lookup.kind === 'PENDING') return baseValid && exactRecord(lookup, ['kind', 'previewDigest', 'actorBinding', 'journalVersion', 'headDigest']);
  if (lookup.kind === 'COMPLETED') return baseValid && exactRecord(lookup, ['kind', 'previewDigest', 'actorBinding', 'journalVersion', 'headDigest', 'receipt'])
    && validL14Receipt(lookup.receipt) && (lookup.receipt as Record<string, unknown>).previewDigest === lookup.previewDigest && (lookup.receipt as Record<string, unknown>).actorBinding === lookup.actorBinding;
  return lookup.kind === 'REJECTED' && baseValid && exactRecord(lookup, ['kind', 'previewDigest', 'actorBinding', 'journalVersion', 'headDigest', 'rejection'])
    && validL14Rejection(lookup.rejection) && (lookup.rejection as Record<string, unknown>).previewDigest === lookup.previewDigest && (lookup.rejection as Record<string, unknown>).actorBinding === lookup.actorBinding;
}

function validL14Acknowledgement(value: unknown): boolean {
  if (!exactRecord(value, ['schema', 'version', 'owner', 'disposition', 'commandId', 'eventId', 'idempotencyKey', 'appendRequestDigest', 'expectedJournalVersion', 'committedJournalVersion', 'previousHeadDigest', 'committedHeadDigest', 'appendedCount', 'ledgerEventId', 'committedAtMs', 'currentConfigVersion', 'currentControlRevision', 'failureCode', 'externalActionAuthorization'])
      || value.schema !== 'LIVE_EDGE_CONTROL_EVENT_ACK_V1' || value.version !== 1 || value.owner !== 'SYSTEM_INTEGRATION_LEDGER'
      || !['COMMITTED_NEW', 'IDEMPOTENT_REPLAY', 'IDEMPOTENCY_CONFLICT', 'VERSION_CONFLICT', 'EXPIRED', 'FAILED'].includes(String(value.disposition))
      || !L14_COMMAND_ID.test(String(value.commandId)) || !L14_EVENT_ID.test(String(value.eventId)) || !ID.test(String(value.idempotencyKey))
      || !SHA256.test(String(value.appendRequestDigest)) || !Number.isSafeInteger(value.expectedJournalVersion) || Number(value.expectedJournalVersion) < 0
      || (value.previousHeadDigest !== null && !L14_HEAD_DIGEST.test(String(value.previousHeadDigest)))
      || !Number.isSafeInteger(value.currentConfigVersion) || Number(value.currentConfigVersion) < 0
      || !Number.isSafeInteger(value.currentControlRevision) || Number(value.currentControlRevision) < 0
      || value.externalActionAuthorization !== 'NONE') return false;
  const committed = value.disposition === 'COMMITTED_NEW' || value.disposition === 'IDEMPOTENT_REPLAY';
  if (committed) return value.committedJournalVersion === Number(value.expectedJournalVersion) + 1
    && L14_HEAD_DIGEST.test(String(value.committedHeadDigest)) && (value.appendedCount === (value.disposition === 'COMMITTED_NEW' ? 1 : 0))
    && Number.isSafeInteger(value.ledgerEventId) && Number(value.ledgerEventId) > 0 && isValidUtcMillis(value.committedAtMs)
    && value.failureCode === null;
  return value.committedJournalVersion === null && value.committedHeadDigest === null && value.appendedCount === 0
    && value.ledgerEventId === null && value.committedAtMs === null && L14_REASON_CODES.includes(String(value.failureCode));
}

const DASHBOARD_DONOR_COMPONENT_IDS = Object.freeze(['public-spot-source', 'public-usdm-source', 'market-universe', 'intelligence-runtime', 'market-intelligence', 'basis-engine', 'volume-engine', 'capital-supervision', 'multileg-risk', 'execution-coordinator-validate-only', 'reconciliation', 'ledger-persistence', 'engine-supervisor']);
const DASHBOARD_DONOR_TRUTH = Object.freeze(['LIVE_PUBLIC', 'DRY_RUN', 'SYNTHETIC_ONLY', 'RECORDED_REPLAY', 'UNAVAILABLE', 'UNKNOWN']);

function validDashboardControlState(value: unknown): boolean {
  return exactRecord(value, ['revision', 'generation', 'safeMode', 'killSwitchEngaged', 'intakePaused', 'updatedAtMs', 'correlationId'])
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 && Number.isSafeInteger(value.generation) && Number(value.generation) >= 0
    && ['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY'].includes(String(value.safeMode)) && typeof value.killSwitchEngaged === 'boolean'
    && typeof value.intakePaused === 'boolean' && isValidUtcMillis(value.updatedAtMs) && ID.test(String(value.correlationId));
}

function validDashboardComponent(value: unknown): boolean {
  if (!exactRecord(value, ['componentId', 'owner', 'ownerPath', 'releaseStatuses', 'truthLabel', 'desiredState', 'phase', 'domainObservedState', 'readiness', 'completeness', 'sourceTimestamp', 'freshness', 'lastReceiveAtMs', 'lastProcessAtMs', 'lastSuccessAtMs', 'dependencies', 'queue', 'blockerCodes', 'generation', 'restartCount', 'supportedControls', 'capitalExposed', 'operatorAttentionRequired', 'lastFailure'])) return false;
  const sourceTimestampValid = value.sourceTimestamp === null || (exactRecord(value.sourceTimestamp, ['sourceTimeMs', 'receivedAtMs', 'maxAgeMs'])
    && (value.sourceTimestamp.sourceTimeMs === null || isValidUtcMillis(value.sourceTimestamp.sourceTimeMs)) && isValidUtcMillis(value.sourceTimestamp.receivedAtMs) && Number.isSafeInteger(value.sourceTimestamp.maxAgeMs) && Number(value.sourceTimestamp.maxAgeMs) > 0);
  const freshnessValid = value.freshness === null || (exactRecord(value.freshness, ['state', 'ageMs', 'evaluatedAt']) && typeof value.freshness.state === 'string'
    && (value.freshness.ageMs === null || (Number.isSafeInteger(value.freshness.ageMs) && Number(value.freshness.ageMs) >= 0)) && isValidUtcMillis(value.freshness.evaluatedAt));
  let queueValid = value.queue === null;
  if (exactRecord(value.queue, ['depth', 'capacity', 'dropped', 'coalesced', 'observedAtMs'])) {
    const queue = value.queue;
    queueValid = ['depth', 'capacity', 'dropped', 'coalesced'].every((key) => Number.isSafeInteger(queue[key]) && Number(queue[key]) >= 0) && isValidUtcMillis(queue.observedAtMs);
  }
  const failureValid = value.lastFailure === null || (exactRecord(value.lastFailure, ['code', 'message', 'recommendedOperatorAction'])
    && typeof value.lastFailure.code === 'string' && typeof value.lastFailure.message === 'string' && typeof value.lastFailure.recommendedOperatorAction === 'string');
  return DASHBOARD_DONOR_COMPONENT_IDS.includes(String(value.componentId)) && typeof value.owner === 'string' && typeof value.ownerPath === 'string'
    && Array.isArray(value.releaseStatuses) && value.releaseStatuses.length <= 64 && DASHBOARD_DONOR_TRUTH.includes(String(value.truthLabel))
    && ['STOPPED', 'RUNNING', 'PAUSED'].includes(String(value.desiredState)) && typeof value.phase === 'string'
    && ['STOPPED', 'WARMING', 'READY', 'DEGRADED', 'BLOCKED', 'FAILED'].includes(String(value.readiness))
    && Array.isArray(value.dependencies) && value.dependencies.every((id) => DASHBOARD_DONOR_COMPONENT_IDS.includes(String(id)))
    && Array.isArray(value.blockerCodes) && Array.isArray(value.supportedControls)
    && Number.isSafeInteger(value.generation) && Number(value.generation) >= 0 && Number.isSafeInteger(value.restartCount) && Number(value.restartCount) >= 0
    && typeof value.capitalExposed === 'boolean' && typeof value.operatorAttentionRequired === 'boolean'
    && sourceTimestampValid && freshnessValid && queueValid && failureValid;
}

function validDashboardEdge(value: unknown): boolean {
  return exactRecord(value, ['from', 'to', 'required', 'state', 'rootBlockerComponentId', 'reasonCodes'])
    && DASHBOARD_DONOR_COMPONENT_IDS.includes(String(value.from)) && DASHBOARD_DONOR_COMPONENT_IDS.includes(String(value.to))
    && typeof value.required === 'boolean' && ['AVAILABLE', 'DEGRADED', 'BLOCKED', 'UNKNOWN'].includes(String(value.state))
    && (value.rootBlockerComponentId === null || DASHBOARD_DONOR_COMPONENT_IDS.includes(String(value.rootBlockerComponentId)))
    && Array.isArray(value.reasonCodes);
}

function validDashboardAttention(value: unknown): boolean {
  return exactRecord(value, ['componentId', 'rootComponentId', 'severity', 'reasonCodes', 'capitalExposed', 'recommendedOperatorAction'])
    && DASHBOARD_DONOR_COMPONENT_IDS.includes(String(value.componentId)) && DASHBOARD_DONOR_COMPONENT_IDS.includes(String(value.rootComponentId))
    && ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(String(value.severity)) && Array.isArray(value.reasonCodes)
    && typeof value.capitalExposed === 'boolean' && (value.recommendedOperatorAction === null || typeof value.recommendedOperatorAction === 'string');
}

function validDashboardTrace(value: unknown): boolean {
  return exactRecord(value, ['eventId', 'correlationId', 'componentId', 'kind', 'occurredAtMs', 'truthLabel', 'ownerId', 'canonicalProjectionId', 'revisionDigest', 'failureCode', 'referenceIds'])
    && ID.test(String(value.eventId)) && ID.test(String(value.correlationId)) && DASHBOARD_DONOR_COMPONENT_IDS.includes(String(value.componentId))
    && typeof value.kind === 'string' && isValidUtcMillis(value.occurredAtMs) && DASHBOARD_DONOR_TRUTH.includes(String(value.truthLabel))
    && Array.isArray(value.referenceIds);
}

function validDashboardSummaries(value: unknown): boolean {
  if (!exactRecord(value, ['sourceCoverage', 'strategies', 'intelligence', 'capital', 'risk', 'execution', 'reconciliation', 'ledger'])
      || !exactRecord(value.strategies, ['basis', 'volume'])) return false;
  const summaryKeys: Record<string, readonly string[]> = {
    sourceCoverage: ['truthLabel', 'universeSymbols', 'spotCoveredSymbols', 'usdMCoveredSymbols', 'quietSymbolsRetained', 'materialGapCount', 'rateLimitedSourceCount', 'lastMaterialGapAtMs'],
    intelligence: ['truthLabel', 'evidenceCount', 'attentionCount', 'focusRequestedCount', 'focusActiveCount', 'thesisCount', 'insufficientEvidenceCount', 'lastUpdateAtMs'],
    capital: ['truthLabel', 'accountTruthState', 'allocatableAmount', 'reservedAmount', 'activeExposureAmount', 'eligibleCount', 'reservationCount', 'stagedMandateCount', 'activeExposureCount', 'recoveryCount', 'checkpointRevision', 'blockerCodes'],
    risk: ['truthLabel', 'latestVerdict', 'latestVerdictAtMs', 'latestVerdictId', 'correlationId', 'maxAllowedSize', 'requiredConfirmation', 'decisiveInputSnapshot', 'rejectionCount', 'reasonCodes'],
    execution: ['truthLabel', 'mode', 'barrier', 'planId', 'planLifecycle', 'coordinatorState', 'legCount', 'recoveryState', 'lastTransitionAtMs'],
    reconciliation: ['truthLabel', 'status', 'blocksNewExposure', 'recommendation', 'checkpointId', 'evaluatedAtMs', 'reasonCodes'],
    ledger: ['truthLabel', 'writable', 'lastEventId', 'lastPersistedAtMs', 'checkpointRevision', 'recentTraceCount', 'lastCleanShutdownAtMs'],
  };
  const strategyKeys = ['truthLabel', 'heartbeatAtMs', 'candidateCount', 'proposalCount', 'cooldownCount', 'rejectionCount', 'acceptedCount', 'lastDecisionAtMs', 'sourceRevision'];
  const risk = value.risk;
  const validRiskShape = exactRecord(risk, summaryKeys.risk)
    && typeof risk.latestVerdict === 'string'
    && ['APPROVE', 'REJECT', 'NEEDS_REVIEW', 'CAP', 'UNAVAILABLE'].includes(risk.latestVerdict)
    && (risk.correlationId === null || (typeof risk.correlationId === 'string' && CORRELATION_ID.test(risk.correlationId)))
    && (risk.maxAllowedSize === null || (typeof risk.maxAllowedSize === 'string' && risk.maxAllowedSize.length <= 80 && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(risk.maxAllowedSize)))
    && (risk.requiredConfirmation === null || typeof risk.requiredConfirmation === 'boolean')
    && Array.isArray(risk.decisiveInputSnapshot)
    && risk.decisiveInputSnapshot.length <= 512
    && risk.decisiveInputSnapshot.every((entry) => exactRecord(entry, ['code', 'status', 'detail', 'observed', 'limit', 'evidenceTimestamp'])
      && typeof entry.code === 'string'
      && /^[A-Z][A-Z0-9_]{0,99}$/.test(entry.code)
      && typeof entry.status === 'string'
      && ['PASS', 'FAIL', 'UNKNOWN'].includes(entry.status)
      && typeof entry.detail === 'string'
      && entry.detail.trim().length >= 1
      && entry.detail.length <= 1_000
      && (entry.observed === null || (typeof entry.observed === 'string' && entry.observed.length >= 1 && entry.observed.length <= 300))
      && (entry.limit === null || (typeof entry.limit === 'string' && entry.limit.length >= 1 && entry.limit.length <= 300))
      && (entry.evidenceTimestamp === null || isValidUtcMillis(entry.evidenceTimestamp)))
    && Array.isArray(risk.reasonCodes)
    && risk.reasonCodes.length <= 64
    && risk.reasonCodes.every((code) => typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(code));
  const directDecision = validRiskShape
    && typeof risk.latestVerdict === 'string'
    && ['APPROVE', 'REJECT', 'NEEDS_REVIEW'].includes(risk.latestVerdict);
  const decisive = validRiskShape ? risk.decisiveInputSnapshot as readonly Record<string, unknown>[] : [];
  const reasonCodes = validRiskShape && Array.isArray(risk.reasonCodes) ? risk.reasonCodes : [];
  const validRiskSemantics = !directDecision || (
    risk.correlationId !== null
    && decisive.length > 0
    && (risk.latestVerdict === 'APPROVE'
      ? risk.maxAllowedSize !== null
        && risk.requiredConfirmation === false
        && reasonCodes.length === 0
        && decisive.every((entry) => entry.status === 'PASS')
      : risk.requiredConfirmation === (risk.latestVerdict === 'NEEDS_REVIEW')
        && decisive.every((entry) => entry.status !== 'PASS')
        && decisive.map((entry) => entry.code).join('|') === reasonCodes.join('|')
        && (risk.latestVerdict === 'REJECT'
          ? risk.maxAllowedSize === '0' && decisive.some((entry) => entry.status === 'FAIL')
          : risk.maxAllowedSize === null
            && decisive.every((entry) => entry.status !== 'FAIL')
            && decisive.some((entry) => entry.status === 'UNKNOWN')))
  );
  return validRiskShape && validRiskSemantics
    && Object.entries(summaryKeys).every(([key, keys]) => exactRecord(value[key], keys) && DASHBOARD_DONOR_TRUTH.includes(String((value[key] as Record<string, unknown>).truthLabel)))
    && exactRecord(value.strategies.basis, strategyKeys) && exactRecord(value.strategies.volume, strategyKeys)
    && DASHBOARD_DONOR_TRUTH.includes(String(value.strategies.basis.truthLabel)) && DASHBOARD_DONOR_TRUTH.includes(String(value.strategies.volume.truthLabel));
}

function validL14Event(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const common = ['schema', 'version', 'kind', 'commandId', 'previewDigest', 'actionType', 'actorBinding', 'expectedConfigVersion', 'expectedControlRevision', 'occurredAtMs', 'eventId', 'contentDigest', 'externalActionAuthorization'];
  const { eventId, contentDigest, ...draft } = event;
  const integrityValid = eventId === sha256('l14evt_', { schema: 'LIVE_EDGE_CONTROL_EVENT_ID_V1', event: draft })
    && contentDigest === sha256('sha256:', { ...draft, eventId });
  const validCommon = integrityValid && event.schema === 'LIVE_EDGE_CONTROL_EVENT_V1' && event.version === 1 && L14_COMMAND_ID.test(String(event.commandId))
    && SHA256.test(String(event.previewDigest)) && L14_ACTION_TYPES.includes(String(event.actionType)) && L14_ACTOR_BINDING.test(String(event.actorBinding))
    && Number.isSafeInteger(event.expectedConfigVersion) && Number(event.expectedConfigVersion) >= 0
    && Number.isSafeInteger(event.expectedControlRevision) && Number(event.expectedControlRevision) >= 0
    && isValidUtcMillis(event.occurredAtMs) && L14_EVENT_ID.test(String(event.eventId)) && SHA256.test(String(event.contentDigest))
    && event.externalActionAuthorization === 'NONE';
  if (!validCommon) return false;
  if (event.kind === 'CONTROL_INTENT_COMMITTED') return exactRecord(event, [...common, 'action', 'expiresAtMs', 'decisionCode', 'riskWitness'])
    && validL14Action(event.action) && (event.action as Record<string, unknown>).type === event.actionType
    && isValidUtcMillis(event.expiresAtMs) && Number(event.expiresAtMs) > Number(event.occurredAtMs)
    && L14_REASON_CODES.includes(String(event.decisionCode)) && validL14RiskWitness(event.riskWitness);
  if (event.kind === 'CONTROL_APPLIED') return exactRecord(event, [...common, 'applied', 'reasonCode', 'recoveryStateChanged'])
    && typeof event.applied === 'boolean' && L14_REASON_CODES.includes(String(event.reasonCode))
    && (event.applied ? event.reasonCode === 'CONTROL_APPLIED' : event.reasonCode === 'CONTROL_NOOP') && event.recoveryStateChanged === false;
  if (event.kind === 'CONTROL_AWARENESS_RECORDED') return exactRecord(event, [...common, 'recoveryRevision', 'awarenessOnly', 'recoveryStateChanged', 'reasonCode'])
    && event.actionType === 'ACKNOWLEDGE_RECOVERY' && L14_IDENTIFIER.test(String(event.recoveryRevision))
    && event.awarenessOnly === true && event.recoveryStateChanged === false && event.reasonCode === 'AWARENESS_RECORDED';
  return event.kind === 'CONTROL_REJECTED' && exactRecord(event, [...common, 'reasonCode', 'redacted', 'intentCommitted', 'recoveryStateChanged'])
    && L14_REASON_CODES.includes(String(event.reasonCode)) && !['CONTROL_APPLIED', 'CONTROL_NOOP', 'AWARENESS_RECORDED'].includes(String(event.reasonCode))
    && event.redacted === true && typeof event.intentCommitted === 'boolean' && event.recoveryStateChanged === false;
}

type FixtureJournalAcknowledgement = Readonly<{
  schema: 'LIVE_EDGE_MUTATION_APPEND_ACK_V1';
  version: 1;
  owner: 'SYSTEM_INTEGRATION_LEDGER';
  mutationId: string;
  entryId: string;
  disposition: 'COMMITTED_NEW' | 'IDEMPOTENT_REPLAY' | 'VERSION_CONFLICT' | 'FAILED' | 'CAPACITY_EXHAUSTED';
  idempotencyKey: string;
  appendRequestDigest: string;
  expectedJournalVersion: number;
  committedJournalVersion: number | null;
  previousHeadDigest: string | null;
  committedHeadDigest: string | null;
  committedOutcomeRevision: string | null;
  appendedCount: 0 | 1;
  ledgerEventId: number | null;
  committedAtMs: number | null;
  failureCode: string | null;
  externalActionAuthorization: 'NONE';
}>;

function fixtureFailure(nowMs: number, correlationId: string, code: string, message: string) {
  return createStructuredFailure({
    component: 'productIntegration.fixture',
    stage: 'port',
    code,
    message,
    occurredAt: nowMs,
    retryable: false,
    safeCurrentState: 'UNCHANGED',
    recommendedOperatorAction: 'Replace the fixture with the accepted canonical owner adapter during director fan-in.',
    correlationId,
  });
}

export function createUnavailablePrivateTruthFixture(nowMs: number, correlationId: string): ProductPrivateTruthConsumerPort {
  if (!isValidUtcMillis(nowMs) || !ID.test(correlationId)) throw new TypeError('private truth fixture context is invalid');
  return Object.freeze({
    readPrivateTruthProjection(): ContractResult<Readonly<BoundedOwnerProjection>> {
      return fail(fixtureFailure(nowMs, correlationId, 'L05_PRIVATE_TRUTH_UNWIRED', 'Accepted L05 private-truth evidence is not present at the packet base.'));
    },
  });
}

export function createL14DurableControlFixture(input: Readonly<{
  nowMs: number;
  correlationId: string;
  preview: Readonly<L14DurableControlPreviewPort>;
  receipt: Readonly<L14ControlCommandReceiptPort>;
}>): L14DurableControlPort {
  assertFixtureContext(input);
  if (!exactRecord(input.preview, ['schema', 'version', 'commandId', 'action', 'actionDigest', 'expectedConfigVersion', 'expectedControlRevision', 'actorBinding', 'reason', 'generatedAtMs', 'expiresAtMs', 'riskWitness', 'previewDigest', 'authorizationTag', 'externalActionAuthorization'])
      || !validL14Receipt(input.receipt)
      || !validL14Action(input.preview.action) || !validL14RiskWitness(input.preview.riskWitness)
      || input.preview.schema !== 'LIVE_EDGE_CONTROL_PREVIEW_V1' || input.preview.version !== 1
      || !L14_COMMAND_ID.test(input.preview.commandId) || !SHA256.test(input.preview.actionDigest) || !SHA256.test(input.preview.previewDigest)
      || !Number.isSafeInteger(input.preview.expectedConfigVersion) || input.preview.expectedConfigVersion < 0
      || !Number.isSafeInteger(input.preview.expectedControlRevision) || input.preview.expectedControlRevision < 0
      || !L14_ACTOR_BINDING.test(input.preview.actorBinding)
      || !validL14Reason(input.preview.reason)
      || !L14_AUTHORIZATION_TAG.test(input.preview.authorizationTag)
      || input.preview.externalActionAuthorization !== 'NONE' || input.receipt.schema !== 'LIVE_EDGE_CONTROL_RECEIPT_V1'
      || input.receipt.version !== 1 || input.receipt.commandId !== input.preview.commandId
      || input.receipt.previewDigest !== input.preview.previewDigest || input.receipt.actionType !== input.preview.action.type
      || input.receipt.actorBinding !== input.preview.actorBinding || input.receipt.expectedConfigVersion !== input.preview.expectedConfigVersion
      || input.receipt.committedControlRevision !== input.preview.expectedControlRevision + 1
      || (input.receipt.disposition === 'APPLIED') !== input.receipt.applied
      || (input.receipt.disposition === 'AWARENESS_RECORDED' && input.receipt.reasonCode !== 'AWARENESS_RECORDED')
      || !isValidUtcMillis(input.preview.generatedAtMs) || !isValidUtcMillis(input.preview.expiresAtMs)
      || input.preview.expiresAtMs - input.preview.generatedAtMs < 1_000 || input.preview.expiresAtMs - input.preview.generatedAtMs > 60_000
      || input.receipt.externalActionAuthorization !== 'NONE') {
    throw new TypeError('L14 control fixture is not bound to an exact accepted preview/receipt');
  }
  const preview = snapshotFixtureValue(input.preview, 'L14 preview fixture');
  const receipt = snapshotFixtureValue(input.receipt, 'L14 receipt fixture');
  return Object.freeze({
    async preview(raw: unknown) {
      if (input.nowMs >= preview.expiresAtMs) return fail(fixtureFailure(input.nowMs, input.correlationId, 'L14_COMMAND_EXPIRED', 'L14 deterministic preview has expired.'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(fixtureFailure(input.nowMs, input.correlationId, 'L14_PREVIEW_REQUEST_INVALID', 'L14 preview request is invalid.'));
      const request = raw as Record<string, unknown>;
      let actionMatches = false;
      try { actionMatches = canonicalProductJson(request.action) === canonicalProductJson(preview.action); } catch { actionMatches = false; }
      if (Object.keys(request).some((key) => !['schema', 'version', 'action', 'expectedConfigVersion', 'reason', 'ttlMs'].includes(key))
          || request.schema !== 'LIVE_EDGE_DURABLE_CONTROL_V1' || request.version !== 1
          || !actionMatches
          || request.expectedConfigVersion !== preview.expectedConfigVersion || request.reason !== preview.reason
          || request.ttlMs !== preview.expiresAtMs - preview.generatedAtMs) {
        return fail(fixtureFailure(input.nowMs, input.correlationId, 'L14_PREVIEW_REQUEST_MISMATCH', 'L14 preview request does not match the deterministic fixture intent.'));
      }
      return ok(preview);
    },
    async submit(raw: unknown) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(fixtureFailure(input.nowMs, input.correlationId, 'L14_SUBMISSION_INVALID', 'L14 submission request is invalid.'));
      const request = raw as Record<string, unknown>;
      const submitted = request.preview;
      let previewMatches = false;
      try { previewMatches = canonicalProductJson(submitted) === canonicalProductJson(preview); } catch { previewMatches = false; }
      if (input.nowMs >= preview.expiresAtMs || Object.keys(request).some((key) => !['schema', 'version', 'preview'].includes(key))
          || request.schema !== 'LIVE_EDGE_DURABLE_CONTROL_V1' || request.version !== 1 || !submitted || typeof submitted !== 'object'
          || (submitted as Record<string, unknown>).previewDigest !== preview.previewDigest
          || !previewMatches) {
        return fail(fixtureFailure(input.nowMs, input.correlationId, 'L14_PREVIEW_DIGEST_MISMATCH', 'L14 submission is not bound to the deterministic preview.'));
      }
      return ok(receipt);
    },
  });
}

export function createL14ControlPersistenceFixture(input: Readonly<{
  nowMs: number;
  correlationId: string;
  lookups: Readonly<Record<string, Readonly<L14ControlCommandLookupPort>>>;
  request: Readonly<L14ControlEventAppendRequestPort>;
  acknowledgement: Readonly<L14ControlEventAppendAcknowledgementPort>;
}>): L14CanonicalControlPersistencePort {
  assertFixtureContext(input);
  const expectedNextHead = sha256('l14head_', {
    schema: 'LIVE_EDGE_CONTROL_HEAD_V1', previousHeadDigest: input.request.previousHeadDigest,
    journalVersion: input.request.expectedJournalVersion + 1, eventId: input.request.event.eventId,
    contentDigest: input.request.event.contentDigest,
  });
  const { appendRequestDigest: _appendDigest, ...appendBase } = input.request;
  const expectedAppendDigest = sha256('sha256:', { schema: 'LIVE_EDGE_CONTROL_APPEND_REQUEST_V1', ...appendBase });
  if (!exactRecord(input.request, ['ownerTarget', 'event', 'idempotencyKey', 'appendRequestDigest', 'expectedJournalVersion', 'previousHeadDigest', 'nextHeadDigest', 'externalActionAuthorization'])
      || !validL14Event(input.request.event)
      || input.request.ownerTarget !== 'SYSTEM_INTEGRATION_LEDGER'
      || input.request.idempotencyKey !== `l14:${input.request.event.commandId}:${input.request.event.kind}`
      || input.request.appendRequestDigest !== expectedAppendDigest
      || !Number.isSafeInteger(input.request.expectedJournalVersion) || input.request.expectedJournalVersion < 0
      || (input.request.previousHeadDigest !== null && !L14_HEAD_DIGEST.test(input.request.previousHeadDigest))
      || input.request.nextHeadDigest !== expectedNextHead || input.request.externalActionAuthorization !== 'NONE'
      || !validL14Acknowledgement(input.acknowledgement)
      || Object.entries(input.lookups).some(([commandId, lookup]) => !L14_COMMAND_ID.test(commandId) || !validL14Lookup(lookup)
        || (lookup.kind === 'COMPLETED' && lookup.receipt.commandId !== commandId)
        || (lookup.kind === 'REJECTED' && lookup.rejection.commandId !== commandId))) {
    throw new TypeError('L14 persistence fixture is not an exact closed accepted contract');
  }
  const lookups = snapshotFixtureValue(input.lookups, 'L14 lookup fixture', MAX_FIXTURE_COLLECTION_BYTES);
  const expectedRequest = snapshotFixtureValue(input.request, 'L14 append request fixture');
  const acknowledgement = snapshotFixtureValue(input.acknowledgement, 'L14 acknowledgement fixture');
  if (acknowledgement.commandId !== expectedRequest.event.commandId || acknowledgement.eventId !== expectedRequest.event.eventId
      || acknowledgement.idempotencyKey !== expectedRequest.idempotencyKey || acknowledgement.appendRequestDigest !== expectedRequest.appendRequestDigest
      || acknowledgement.expectedJournalVersion !== expectedRequest.expectedJournalVersion
      || acknowledgement.previousHeadDigest !== expectedRequest.previousHeadDigest
      || (['COMMITTED_NEW', 'IDEMPOTENT_REPLAY'].includes(acknowledgement.disposition)
        && (acknowledgement.committedHeadDigest !== expectedRequest.nextHeadDigest
          || acknowledgement.committedAtMs === null || acknowledgement.committedAtMs < expectedRequest.event.occurredAtMs))
      || acknowledgement.externalActionAuthorization !== 'NONE') {
    throw new TypeError('L14 persistence acknowledgement is not bound to the exact append request');
  }
  return Object.freeze({
    async lookup(commandId: string) {
      if (!ID.test(commandId)) return Object.freeze({ kind: 'NOT_FOUND' as const, journalVersion: 0 as const, headDigest: null });
      return lookups[commandId] ?? Object.freeze({ kind: 'NOT_FOUND' as const, journalVersion: 0 as const, headDigest: null });
    },
    async append(request: Parameters<L14CanonicalControlPersistencePort['append']>[0]) {
      let matches = false;
      try { matches = canonicalProductJson(request) === canonicalProductJson(expectedRequest); } catch { matches = false; }
      if (matches) return acknowledgement;
      return Object.freeze({
        schema: 'LIVE_EDGE_CONTROL_EVENT_ACK_V1' as const, version: 1 as const, owner: 'SYSTEM_INTEGRATION_LEDGER' as const,
        disposition: 'FAILED' as const, commandId: request.event.commandId, eventId: request.event.eventId,
        idempotencyKey: request.idempotencyKey, appendRequestDigest: request.appendRequestDigest,
        expectedJournalVersion: request.expectedJournalVersion, committedJournalVersion: null,
        previousHeadDigest: request.previousHeadDigest, committedHeadDigest: null, appendedCount: 0 as const,
        ledgerEventId: null, committedAtMs: null, currentConfigVersion: acknowledgement.currentConfigVersion,
        currentControlRevision: acknowledgement.currentControlRevision, failureCode: 'PERSISTENCE_ACK_INVALID' as const,
        externalActionAuthorization: 'NONE' as const,
      });
    },
  });
}

export function createMemoryMutationJournalCasFixture(input: Readonly<{
  nowMs: number;
  correlationId: string;
  initialHeadDigest: string | null;
  maximumEntries?: number;
}>): ProductMutationJournalCasPort<L06MutationJournalEntryPort> {
  const headPattern = /^l06head_[a-f0-9]{64}$/;
  const maximumEntries = input.maximumEntries ?? 256;
  if (!isValidUtcMillis(input.nowMs) || !ID.test(input.correlationId) || (input.initialHeadDigest !== null && !headPattern.test(input.initialHeadDigest))
      || !Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 256) throw new TypeError('journal fixture context is invalid');
  let headDigest = input.initialHeadDigest;
  let journalVersion = 0;
  let ledgerEventId = 0;
  const receipts = new Map<string, Readonly<{
    canonicalRequest: string;
    acknowledgement: FixtureJournalAcknowledgement;
  }>>();
  return Object.freeze({
    async compareAndAppend(request: Parameters<ProductMutationJournalCasPort<L06MutationJournalEntryPort>['compareAndAppend']>[0]) {
      let canonicalEntry = '';
      let canonicalRequest = '';
      try {
        canonicalEntry = canonicalProductJson(request.entry);
        canonicalRequest = canonicalProductJson(request);
      } catch {
        return fail(fixtureFailure(input.nowMs, input.correlationId, 'L06_APPEND_INVALID', 'Mutation journal append request is not canonical JSON.'));
      }
      const expectedContentRevision = sha256('l06content_', {
        schema: request.entry.schema,
        version: request.entry.version,
        mutationId: request.entry.mutationId,
        observationId: request.entry.observationId,
        kind: request.entry.kind,
        occurredAtMs: request.entry.occurredAtMs,
        receivedAtMs: request.entry.receivedAtMs,
        sourceRevision: request.entry.sourceRevision,
        payload: request.entry.payload,
      });
      const expectedEntryId = sha256('l06entry_', {
        mutationId: request.entry.mutationId,
        journalVersion: request.entry.journalVersion,
        previousHeadDigest: request.entry.previousHeadDigest,
        observationId: request.entry.observationId,
        contentRevision: request.entry.contentRevision,
      });
      const expectedHeadDigest = sha256('l06head_', {
        previous: request.previousHeadDigest,
        journalVersion: request.entry.journalVersion,
        entryId: request.entry.entryId,
        contentRevision: request.entry.contentRevision,
      });
      const { appendRequestDigest: _digest, ...requestWithoutDigest } = request;
      const expectedAppendRequestDigest = sha256('l06append_', requestWithoutDigest);
      const telemetryPayloadInvalid = request.entry.kind === 'TELEMETRY_DEGRADED'
        && (Object.keys(request.entry.payload).sort().join('|') !== 'reasonCode|subsystem'
          || !['READ_MODEL', 'TRACE', 'INTELLIGENCE_RUNTIME_RECORDING'].includes(String(request.entry.payload.subsystem))
          || !/^[A-Z][A-Z0-9_.:-]{0,95}$/.test(String(request.entry.payload.reasonCode)));
      const invalid = request.schema !== 'LIVE_EDGE_MUTATION_APPEND_REQUEST_V1'
        || request.version !== 1
        || request.ownerTarget !== 'SYSTEM_INTEGRATION_LEDGER'
        || !Number.isSafeInteger(request.expectedJournalVersion)
        || request.expectedJournalVersion < 0 || request.expectedJournalVersion > 255
        || request.nextJournalVersion !== request.expectedJournalVersion + 1
        || !/^l06mut_[a-f0-9]{64}$/.test(request.mutationId)
        || !/^l06entry_[a-f0-9]{64}$/.test(request.entryId)
        || request.idempotencyKey !== `l06append:${request.mutationId}:${request.nextJournalVersion}`
        || (request.previousHeadDigest !== null && !/^l06head_[a-f0-9]{64}$/.test(request.previousHeadDigest))
        || !/^l06head_[a-f0-9]{64}$/.test(request.nextHeadDigest)
        || !/^l06outcome_[a-f0-9]{64}$/.test(request.nextOutcomeRevision)
        || !/^l06content_[a-f0-9]{64}$/.test(request.entryContentRevision)
        || !/^l06append_[a-f0-9]{64}$/.test(request.appendRequestDigest)
        || request.entry.schema !== 'LIVE_EDGE_MUTATION_ENTRY_V1'
        || request.entry.version !== 1
        || request.entry.kind !== 'TELEMETRY_DEGRADED'
        || request.entry.mutationId !== request.mutationId
        || request.entry.entryId !== request.entryId
        || request.entry.journalVersion !== request.nextJournalVersion
        || request.entry.previousHeadDigest !== request.previousHeadDigest
        || !/^l06obs_[a-f0-9]{64}$/.test(request.entry.observationId)
        || !isValidUtcMillis(request.entry.occurredAtMs)
        || !isValidUtcMillis(request.entry.receivedAtMs)
        || request.entry.receivedAtMs < request.entry.occurredAtMs
        || typeof request.entry.sourceRevision !== 'string' || request.entry.sourceRevision.length < 8 || request.entry.sourceRevision.length > 128
        || request.entry.contentRevision !== expectedContentRevision
        || telemetryPayloadInvalid
        || request.entryContentRevision !== expectedContentRevision
        || request.entry.entryId !== expectedEntryId
        || request.nextHeadDigest !== expectedHeadDigest
        || request.appendRequestDigest !== expectedAppendRequestDigest
        || findSecretLikePaths(request).length > 0
        || new TextEncoder().encode(canonicalEntry).byteLength > 128 * 1_024
        || new TextEncoder().encode(canonicalRequest).byteLength > 128 * 1_024
        || request.externalActionAuthorization !== 'NONE';
      if (invalid) return fail(fixtureFailure(input.nowMs, input.correlationId, 'L06_APPEND_INVALID', 'Mutation journal append request is invalid.'));
      const prior = receipts.get(request.idempotencyKey);
      if (prior) {
        if (prior.canonicalRequest !== canonicalRequest) return fail(fixtureFailure(input.nowMs, input.correlationId, 'L06_IDEMPOTENCY_CONFLICT', 'Idempotency key was reused for different journal intent.'));
        return ok(Object.freeze({ ...prior.acknowledgement, disposition: 'IDEMPOTENT_REPLAY' as const, appendedCount: 0 as const }));
      }
      if (request.expectedJournalVersion !== journalVersion || request.previousHeadDigest !== headDigest) return ok(Object.freeze({
        schema: 'LIVE_EDGE_MUTATION_APPEND_ACK_V1' as const, version: 1 as const, owner: 'SYSTEM_INTEGRATION_LEDGER' as const,
        mutationId: request.mutationId, entryId: request.entryId, disposition: 'VERSION_CONFLICT' as const,
        idempotencyKey: request.idempotencyKey, appendRequestDigest: request.appendRequestDigest,
        expectedJournalVersion: request.expectedJournalVersion, committedJournalVersion: null,
        previousHeadDigest: request.previousHeadDigest, committedHeadDigest: null, committedOutcomeRevision: null,
        appendedCount: 0 as const, ledgerEventId: null, committedAtMs: null,
        failureCode: 'JOURNAL_VERSION_CONFLICT', externalActionAuthorization: 'NONE' as const,
      }));
      if (journalVersion >= maximumEntries || receipts.size >= maximumEntries) return ok(Object.freeze({
        schema: 'LIVE_EDGE_MUTATION_APPEND_ACK_V1' as const, version: 1 as const, owner: 'SYSTEM_INTEGRATION_LEDGER' as const,
        mutationId: request.mutationId, entryId: request.entryId, disposition: 'CAPACITY_EXHAUSTED' as const,
        idempotencyKey: request.idempotencyKey, appendRequestDigest: request.appendRequestDigest,
        expectedJournalVersion: request.expectedJournalVersion, committedJournalVersion: null,
        previousHeadDigest: request.previousHeadDigest, committedHeadDigest: null, committedOutcomeRevision: null,
        appendedCount: 0 as const, ledgerEventId: null, committedAtMs: null,
        failureCode: 'JOURNAL_CAPACITY_EXHAUSTED', externalActionAuthorization: 'NONE' as const,
      }));
      ledgerEventId += 1;
      const acknowledgement = Object.freeze({
        schema: 'LIVE_EDGE_MUTATION_APPEND_ACK_V1' as const,
        version: 1 as const,
        owner: 'SYSTEM_INTEGRATION_LEDGER' as const,
        mutationId: request.mutationId,
        entryId: request.entryId,
        disposition: 'COMMITTED_NEW' as const,
        idempotencyKey: request.idempotencyKey,
        appendRequestDigest: request.appendRequestDigest,
        expectedJournalVersion: request.expectedJournalVersion,
        committedJournalVersion: request.nextJournalVersion,
        previousHeadDigest: headDigest,
        committedHeadDigest: request.nextHeadDigest,
        committedOutcomeRevision: request.nextOutcomeRevision,
        appendedCount: 1 as const,
        ledgerEventId,
        committedAtMs: input.nowMs,
        failureCode: null,
        externalActionAuthorization: 'NONE' as const,
      });
      receipts.set(request.idempotencyKey, Object.freeze({ canonicalRequest, acknowledgement }));
      headDigest = request.nextHeadDigest;
      journalVersion += 1;
      return ok(acknowledgement);
    },
  });
}

export function createMemoryLedgerPersistenceFixture(nowMs: number, correlationId: string): ProductLedgerPersistencePort {
  if (!isValidUtcMillis(nowMs) || !ID.test(correlationId)) throw new TypeError('ledger fixture context is invalid');
  const receipts = new Map<string, { canonicalRequest: string; ledgerReference: string }>();
  return Object.freeze({
    async appendProjection(input: Parameters<ProductLedgerPersistencePort['appendProjection']>[0]) {
      if (!ID.test(input.recordId) || !ID.test(input.idempotencyKey) || !ID.test(input.correlationId) || !Number.isSafeInteger(input.projectionRevision) || input.projectionRevision < 0 || !isValidUtcMillis(input.occurredAtMs)) {
        return fail(fixtureFailure(nowMs, correlationId, 'LEDGER_PROJECTION_INVALID', 'Projection persistence request is invalid.'));
      }
      let canonicalRequest: string;
      try {
        if (findSecretLikePaths(input).length > 0) throw new TypeError('secret-like input');
        canonicalRequest = canonicalProductJson(input);
        if (new TextEncoder().encode(canonicalRequest).byteLength > MAX_FIXTURE_RECORD_BYTES) throw new RangeError('request too large');
      } catch {
        return fail(fixtureFailure(nowMs, correlationId, 'LEDGER_PROJECTION_PAYLOAD_INVALID', 'Projection persistence request is not bounded canonical secret-free JSON.'));
      }
      const prior = receipts.get(input.idempotencyKey);
      if (prior && prior.canonicalRequest !== canonicalRequest) return fail(fixtureFailure(nowMs, correlationId, 'LEDGER_IDEMPOTENCY_CONFLICT', 'Idempotency key was reused for different projection intent.'));
      if (prior) return ok(Object.freeze({ persisted: true, duplicate: true, ledgerReference: prior.ledgerReference }));
      if (receipts.size >= MAX_FIXTURE_RECORDS) return fail(fixtureFailure(nowMs, correlationId, 'LEDGER_FIXTURE_CAPACITY_EXHAUSTED', 'Projection persistence fixture reached its bounded capacity.'));
      const ledgerReference = `fixture-ledger-${receipts.size + 1}`;
      receipts.set(input.idempotencyKey, { canonicalRequest, ledgerReference });
      return ok(Object.freeze({ persisted: true, duplicate: false, ledgerReference }));
    },
  });
}

interface PortFixtureContext<T> {
  readonly nowMs: number;
  readonly correlationId: string;
  readonly records: readonly Readonly<T>[];
}

function assertFixtureContext(input: Readonly<{ nowMs: number; correlationId: string }>): void {
  if (!isValidUtcMillis(input.nowMs) || !ID.test(input.correlationId)) throw new TypeError('port fixture context is invalid');
}

export function createComponentLifecycleFixture(evidence: Readonly<ProductComponentEvidence>): ProductComponentLifecyclePort {
  assertProductComponentEvidence(evidence);
  const snapshot = snapshotFixtureValue(evidence, 'component lifecycle fixture');
  return Object.freeze({ readComponentEvidence: () => ok(snapshot) });
}

export function createQAssessmentFixture(records: readonly Readonly<ProductQAssessmentReference>[]): QAssessmentConsumerPort {
  uniqueFixtureKeys('Q assessment fixture', records.map((record) => record.assessmentId));
  for (const record of records) {
    if (record.protocolVersion !== 1 || !SHA256.test(record.protocolSchemaSha256) || !SHA256.test(record.envelopeHash)
        || !ID.test(record.traceId) || !isValidUtcMillis(record.generatedAtMs) || !isValidUtcMillis(record.receiveAtMs)
        || !isValidUtcMillis(record.expiresAtMs) || record.expiresAtMs < record.generatedAtMs
        || !['USABLE_ADVISORY', 'ABSTAIN', 'REJECTED'].includes(record.disposition)) throw new TypeError('Q assessment fixture record is invalid');
  }
  const snapshot = snapshotFixtureRecords(records, 'Q assessment fixture');
  return Object.freeze({ readAssessmentReferences: () => ok(snapshot) });
}

export function createStrategySnapshotFixture(
  strategy: 'BASIS' | 'VOLUME',
  records: readonly Readonly<ProductStrategyDecisionReference>[],
): StrategySnapshotConsumerPort {
  if (records.some((record) => record.strategy !== strategy)) throw new TypeError('strategy fixture contains a record owned by another strategy');
  uniqueFixtureKeys(`${strategy} strategy fixture`, records.map((record) => record.decisionId));
  const snapshot = snapshotFixtureRecords(records.map((record) => projectStrategyDecisionReference(record)), `${strategy} strategy fixture`);
  return Object.freeze({ strategy, readDecisionReferences: () => ok(snapshot) });
}

export function createOpportunityAuthorityFixture(input: PortFixtureContext<ProductOpportunityReference>): OpportunityAuthorityPort {
  assertFixtureContext(input);
  uniqueFixtureKeys('opportunity fixture', input.records.map((record) => record.opportunityId));
  for (const record of input.records) {
    if (!ID.test(record.ownerId) || !ID.test(record.correlationId) || !isDataAuthority(record.authority) || !isCompleteness(record.completeness)
        || typeof record.status !== 'string' || record.status.length === 0 || record.status.length > 128
        || (record.expiresAtMs !== null && !isValidUtcMillis(record.expiresAtMs))) throw new TypeError('opportunity fixture record is invalid');
  }
  const snapshot = snapshotFixtureRecords(input.records, 'opportunity fixture');
  const byId = new Map(snapshot.map((record) => [record.opportunityId, record]));
  return Object.freeze({
    readOpportunityReference(opportunityId: string) {
      if (!ID.test(opportunityId)) return fail(fixtureFailure(input.nowMs, input.correlationId, 'OPPORTUNITY_ID_INVALID', 'Opportunity identifier is invalid.'));
      return ok(byId.get(opportunityId) ?? null);
    },
  });
}

export function createCapitalRiskVerdictFixture(input: PortFixtureContext<ProductCapitalRiskReference>): CapitalRiskVerdictConsumerPort {
  assertFixtureContext(input);
  uniqueFixtureKeys('capital/risk fixture', input.records.map((record) => record.opportunityId));
  const snapshot = snapshotFixtureRecords(input.records.map((record) => projectCapitalRiskReference(record)), 'capital/risk fixture');
  const byId = new Map(snapshot.map((record) => [record.opportunityId, record]));
  return Object.freeze({
    readCapitalRiskReference(opportunityId: string) {
      if (!ID.test(opportunityId)) return fail(fixtureFailure(input.nowMs, input.correlationId, 'CAPITAL_RISK_OPPORTUNITY_ID_INVALID', 'Capital/Risk opportunity identifier is invalid.'));
      return ok(byId.get(opportunityId) ?? null);
    },
  });
}

export function createExecutionReconciliationFixture(input: PortFixtureContext<ProductExecutionReference>): ExecutionReconciliationConsumerPort {
  assertFixtureContext(input);
  uniqueFixtureKeys('execution/reconciliation fixture', input.records.map((record) => record.ticketId));
  const snapshot = snapshotFixtureRecords(input.records.map((record) => projectExecutionReference(record)), 'execution/reconciliation fixture');
  const byId = new Map(snapshot.filter((record) => record.ticketId !== null).map((record) => [record.ticketId as string, record]));
  return Object.freeze({
    readExecutionReference(ticketId: string) {
      if (!ID.test(ticketId)) return fail(fixtureFailure(input.nowMs, input.correlationId, 'EXECUTION_TICKET_ID_INVALID', 'Execution ticket identifier is invalid.'));
      return ok(byId.get(ticketId) ?? null);
    },
  });
}

export function createPositionRecoveryFixture(records: readonly Readonly<ProductExecutionReference>[]): PositionRecoveryConsumerPort {
  uniqueFixtureKeys('position/recovery fixture', records.map((record) => record.ticketId));
  const snapshot = snapshotFixtureRecords(records.map((record) => projectExecutionReference(record)), 'position/recovery fixture');
  return Object.freeze({ readPositionRecoveryReferences: () => ok(snapshot) });
}

export function createOutcomeFeedbackFixture(input: Readonly<{ nowMs: number; correlationId: string; maximumRecords?: number }>): OutcomeFeedbackPort {
  assertFixtureContext(input);
  const maximumRecords = input.maximumRecords ?? MAX_FIXTURE_RECORDS;
  if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > MAX_FIXTURE_RECORDS) throw new TypeError('outcome feedback fixture capacity is invalid');
  const receipts = new Map<string, Readonly<{ canonicalFeedback: string; receiptId: string }>>();
  return Object.freeze({
    submitFeedbackProjection(feedback: Parameters<OutcomeFeedbackPort['submitFeedbackProjection']>[0]) {
      if (!ID.test(feedback.outcomeId) || !ID.test(feedback.dedupeKey)
          || (feedback.assessmentId !== null && !ID.test(feedback.assessmentId))
          || !HASH.test(feedback.payloadHash)) return fail(fixtureFailure(input.nowMs, input.correlationId, 'OUTCOME_FEEDBACK_INVALID', 'Outcome feedback projection is invalid.'));
      let canonicalFeedback: string;
      try {
        canonicalFeedback = canonicalProductJson(feedback);
        if (findSecretLikePaths(feedback).length > 0 || new TextEncoder().encode(canonicalFeedback).byteLength > MAX_FIXTURE_RECORD_BYTES) throw new TypeError('unbounded feedback');
      } catch {
        return fail(fixtureFailure(input.nowMs, input.correlationId, 'OUTCOME_FEEDBACK_INVALID', 'Outcome feedback projection is not bounded canonical secret-free JSON.'));
      }
      const prior = receipts.get(feedback.dedupeKey);
      if (prior && prior.canonicalFeedback !== canonicalFeedback) return fail(fixtureFailure(input.nowMs, input.correlationId, 'OUTCOME_FEEDBACK_IDEMPOTENCY_CONFLICT', 'Outcome feedback dedupe key was reused for different content.'));
      if (prior) return ok(Object.freeze({ accepted: true, duplicate: true, ownerReceiptId: prior.receiptId }));
      if (receipts.size >= maximumRecords) return fail(fixtureFailure(input.nowMs, input.correlationId, 'OUTCOME_FEEDBACK_CAPACITY_EXHAUSTED', 'Outcome feedback fixture reached its bounded capacity.'));
      const receiptId = `fixture-feedback-${receipts.size + 1}`;
      receipts.set(feedback.dedupeKey, Object.freeze({ canonicalFeedback, receiptId }));
      return ok(Object.freeze({ accepted: true, duplicate: false, ownerReceiptId: receiptId }));
    },
  });
}

export function createOperatorCommandFixture(input: Readonly<{
  nowMs: number;
  correlationId: string;
  intent: Readonly<ProductCommandPreviewIntentProjection>;
  preview: Readonly<ProductCommandPreviewProjection>;
  receipt: Readonly<ProductCommandReceiptProjection>;
  effect: 'IMMEDIATE' | 'DRAIN' | 'RESTART' | 'DEPLOYMENT';
}>): ProductOperatorCommandPort {
  assertFixtureContext(input);
  const intent = snapshotFixtureValue(input.intent, 'operator command intent fixture');
  const preview = snapshotFixtureValue(input.preview, 'operator command preview fixture');
  const receipt = snapshotFixtureValue(input.receipt, 'operator command receipt fixture');
  if (preview.requestDigest !== intent.requestDigest || preview.previewDigest !== preview.preview.projectionDigest
      || preview.currentRevision !== preview.preview.revision || preview.expiresAtMs < intent.expiresAtMs
      || receipt.requestDigest !== intent.requestDigest || receipt.previewDigest !== preview.previewDigest
      || receipt.beforeRevision !== preview.currentRevision || receipt.before.projectionDigest !== preview.previewDigest) {
    throw new TypeError('operator command fixture is not bound to its exact intent, preview state, and receipt');
  }
  const previewResult = Object.freeze({ ...preview, effect: input.effect });
  return Object.freeze({
    async preview(candidate: Readonly<ProductCommandPreviewIntentProjection>) {
      if (input.nowMs >= intent.expiresAtMs || input.nowMs >= preview.expiresAtMs) return fail(fixtureFailure(input.nowMs, input.correlationId, 'COMMAND_PREVIEW_EXPIRED', 'Command preview fixture has expired.'));
      let matches = false;
      try { matches = canonicalProductJson(candidate) === canonicalProductJson(intent); } catch { matches = false; }
      if (!matches) return fail(fixtureFailure(input.nowMs, input.correlationId, 'COMMAND_PREVIEW_INTENT_MISMATCH', 'Command preview intent does not match the deterministic fixture.'));
      return ok(previewResult);
    },
    async submit(request: Parameters<ProductOperatorCommandPort['submit']>[0]) {
      try {
        const delegation = projectCommandDelegation({ request, canonicalPreview: preview, nowMs: input.nowMs, supportedCommandIds: [request.commandType], priorReceipts: [] });
        if (!delegation.maySubmitToCanonicalOwner || receipt.commandId !== request.commandId || receipt.requestDigest !== request.requestDigest || receipt.previewDigest !== request.previewDigest) {
          return fail(fixtureFailure(input.nowMs, input.correlationId, 'COMMAND_SUBMISSION_MISMATCH', 'Command submission does not match the deterministic preview/receipt.'));
        }
        projectCommandDelegation({ request, canonicalPreview: preview, nowMs: input.nowMs, supportedCommandIds: [request.commandType], priorReceipts: [receipt] });
        return ok(receipt);
      } catch {
        return fail(fixtureFailure(input.nowMs, input.correlationId, 'COMMAND_SUBMISSION_INVALID', 'Command submission failed deterministic contract validation.'));
      }
    },
    async readResult(commandId: string) {
      return commandId === receipt.commandId
        ? ok(receipt)
        : fail(fixtureFailure(input.nowMs, input.correlationId, 'COMMAND_RESULT_NOT_FOUND', 'Command receipt is not present in the deterministic fixture.'));
    },
  });
}

export function createSupervisorProjectionFixture(input: Readonly<{
  nowMs: number;
  correlationId: string;
  projection: Readonly<ProductSupervisorProjection>;
}>): ProductSupervisorProjectionPort {
  assertFixtureContext(input);
  assertProductSupervisorProjection(input.projection);
  const projection = snapshotFixtureValue(input.projection, 'supervisor projection fixture', MAX_FIXTURE_COLLECTION_BYTES);
  return Object.freeze({
    project(nowMs: number, revision: number) {
      if (nowMs !== projection.evaluatedAtMs || revision !== projection.revision) return fail(fixtureFailure(input.nowMs, input.correlationId, 'SUPERVISOR_FIXTURE_REVISION_MISMATCH', 'Supervisor fixture does not contain the requested time/revision.'));
      return ok(projection);
    },
  });
}

export function createOperatorEventStreamFixture(input: Readonly<{
  nowMs: number;
  correlationId: string;
  events: readonly Readonly<ProductOperatorEvent>[];
  durableFloorCursor: number;
}>): ProductOperatorEventStreamPort {
  assertFixtureContext(input);
  const events = snapshotFixtureRecords(input.events, 'operator event fixture');
  return Object.freeze({
    async readPage(query: Readonly<{ afterCursor: number; limit: number }>) {
      try { return ok(projectOperatorEventPage({ ...query, durableFloorCursor: input.durableFloorCursor, events })); }
      catch { return fail(fixtureFailure(input.nowMs, input.correlationId, 'OPERATOR_EVENT_QUERY_INVALID', 'Operator event query is invalid.')); }
    },
  });
}

export function createDashboardClientFixture(input: Readonly<{
  supervisor: Readonly<ProductSupervisorProjection>;
  events: readonly Readonly<ProductOperatorEvent>[];
  durableFloorCursor: number;
}>): ProductDashboardClientPort {
  assertProductSupervisorProjection(input.supervisor);
  const supervisor = snapshotFixtureValue(input.supervisor, 'dashboard supervisor fixture', MAX_FIXTURE_COLLECTION_BYTES);
  const events = snapshotFixtureRecords(input.events, 'dashboard event fixture');
  return Object.freeze({
    async readSupervisor() { return ok(supervisor); },
    async readEvents(query: Readonly<{ afterCursor: number; limit: number }>) {
      try { return ok(projectOperatorEventPage({ ...query, durableFloorCursor: input.durableFloorCursor, events })); }
      catch { return fail(fixtureFailure(supervisor.evaluatedAtMs, 'fixture-dashboard', 'DASHBOARD_EVENT_QUERY_INVALID', 'Dashboard event query is invalid.')); }
    },
    async readTrace(correlationId: string) {
      if (!ID.test(correlationId)) return fail(fixtureFailure(supervisor.evaluatedAtMs, 'fixture-dashboard', 'TRACE_ID_INVALID', 'Trace correlation ID is invalid.'));
      return ok(Object.freeze({ correlationId, projections: Object.freeze([]), truncated: false }));
    },
  });
}

export function createDashboardDonorBridgeFixture(input: Readonly<{
  nowMs: number;
  correlationId: string;
  snapshot: Readonly<DashboardDonorSupervisorSnapshotPort>;
  mutation: Readonly<DashboardDonorControlMutationPort>;
  receipt: Readonly<DashboardDonorControlReceiptPort>;
}>): DashboardDonorBridgePort {
  assertFixtureContext(input);
  if (input.snapshot.schemaVersion !== 1 || !Number.isSafeInteger(input.snapshot.revision) || input.snapshot.revision < 0
      || !isValidUtcMillis(input.snapshot.evaluatedAtMs) || !Array.isArray(input.snapshot.components) || input.snapshot.components.length > 128
      || !Array.isArray(input.snapshot.edges) || input.snapshot.edges.length > 16_384
      || !validDashboardControlState(input.snapshot.control) || !input.snapshot.components.every(validDashboardComponent)
      || !input.snapshot.edges.every(validDashboardEdge) || !input.snapshot.attentionQueue.every(validDashboardAttention)
      || !input.snapshot.recentCorrelatedDecisions.every(validDashboardTrace) || !validDashboardSummaries(input.snapshot.summaries)
      || !input.snapshot.rootBlockerComponentIds.every((id) => DASHBOARD_DONOR_COMPONENT_IDS.includes(id))
      || !input.snapshot.operatorAttentionComponentIds.every((id) => DASHBOARD_DONOR_COMPONENT_IDS.includes(id))
      || !validDashboardControlState(input.receipt.before) || !validDashboardControlState(input.receipt.after)
      || input.receipt.before.revision > input.receipt.after.revision) {
    throw new TypeError('dashboard donor fixture is invalid');
  }
  const snapshot = snapshotFixtureValue(input.snapshot, 'dashboard donor snapshot fixture', MAX_FIXTURE_COLLECTION_BYTES);
  const expectedMutation = snapshotFixtureValue(input.mutation, 'dashboard donor mutation fixture');
  const receipt = snapshotFixtureValue(input.receipt, 'dashboard donor receipt fixture');
  const effectMatches = expectedMutation.command === 'SET_SAFE_MODE'
    ? receipt.after.safeMode === expectedMutation.safeMode
    : expectedMutation.command === 'SET_KILL_SWITCH'
      ? receipt.after.killSwitchEngaged === expectedMutation.engaged
      : expectedMutation.command === 'SET_INTAKE_PAUSED'
        ? receipt.after.intakePaused === expectedMutation.paused
        : expectedMutation.command === 'RESTART_COMPONENT';
  const stateChanged = canonicalProductJson(receipt.before) !== canonicalProductJson(receipt.after);
  if (!effectMatches || receipt.applied !== stateChanged) throw new TypeError('dashboard donor receipt is not bound to the expected mutation effect');
  return Object.freeze({
    readSnapshot() { return ok(snapshot); },
    async mutate(request: Parameters<DashboardDonorBridgePort['mutate']>[0]) {
      const mutationValid = request?.mutation?.command === 'SET_SAFE_MODE'
        ? ['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY'].includes(request.mutation.safeMode)
        : request?.mutation?.command === 'SET_KILL_SWITCH'
          ? typeof request.mutation.engaged === 'boolean'
          : request?.mutation?.command === 'SET_INTAKE_PAUSED'
            ? typeof request.mutation.paused === 'boolean'
            : request?.mutation?.command === 'RESTART_COMPONENT'
              ? ID.test(request.mutation.componentId)
              : false;
      let mutationMatches = false;
      try { mutationMatches = canonicalProductJson(request.mutation) === canonicalProductJson(expectedMutation); } catch { mutationMatches = false; }
      if (!request || typeof request !== 'object' || typeof request.reason !== 'string' || request.reason.trim().length === 0 || request.reason.length > 500
          || !mutationValid || !mutationMatches) {
        return fail(fixtureFailure(input.nowMs, input.correlationId, 'DASHBOARD_DONOR_MUTATION_INVALID', 'Dashboard donor mutation is invalid.'));
      }
      return ok(receipt);
    },
    readLastReceipt() { return ok(receipt); },
  });
}
