import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import { canonicalJson } from '../../../foundation/contracts/index.js';
import {
  addVolumeDecimals,
  compareVolumeDecimals,
  divideVolumeDecimals,
  multiplyVolumeDecimals,
  positiveVolumeDecimal,
  subtractVolumeDecimals,
  volumeDecimal,
} from './exact.js';
import { validateVolumeProtectionPolicy } from './policy.js';
import {
  VOLUME_LIFECYCLE_INPUT_SCHEMA,
  VOLUME_LIFECYCLE_PROJECTION_SCHEMA,
  type VolumeLifecycleActionRequest,
  type VolumeLifecycleInput,
  type VolumeOccupancyProjection,
  type VolumeLifecycleProjection,
  type VolumeLifecycleState,
  type VolumeNoFillRecord,
  type VolumeUnresolvedTwinConflict,
} from './types.js';

export const MAX_UTC_MS = 4_102_444_800_000;
const MAX_GRAPH_NODES = 100_000;
const MAX_GRAPH_DEPTH = 32;
const MAX_TEXT = 256;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{2,255}$/u;
const SYMBOL = /^(?=.{2,40}$)[A-Z0-9._-]+$/u;
const HASH64 = /^[0-9a-f]{64}$/u;
const CONTENT_REVISION = /^l11projection_[0-9a-f]{64}$/u;
const ACTION_KEY = /^l11action_[0-9a-f]{64}$/u;
const INTENT_KEY = /^l11intent_[0-9a-f]{64}$/u;
const ENTRY_REVISION = /^l11entry_[0-9a-f]{64}$/u;
const OWNER_REVISION = /^l11owner_[0-9a-f]{64}$/u;
const RISK_CONTEXT_REVISION = /^l11riskcontext_[0-9a-f]{64}$/u;
const REDUCTION_REVISION = /^l11reduction_[0-9a-f]{64}$/u;
const RECOVERY_RETRY_REVISION = /^l11retry_[0-9a-f]{64}$/u;
const RECOVERY_CONSUMPTION_REVISION = /^l11recoveryconsumption_[0-9a-f]{64}$/u;
const TWIN_CONFLICT_REVISION = /^l11twinconflict_[0-9a-f]{64}$/u;
const MARKET_OBSERVATION_REVISION = /^l11marketobservation_[0-9a-f]{64}$/u;
const SIGNAL_OBSERVATION_REVISION = /^l11signalobservation_[0-9a-f]{64}$/u;
const FEEDBACK_REVISION = /^l11feedback_[0-9a-f]{64}$/u;
const SECRET_FIELDS = new Set([
  'apikey', 'apisecret', 'secret', 'password', 'passphrase', 'token', 'bearer',
  'signature', 'privatekey', 'credential', 'cookie', 'mnemonic',
]);

const INPUT_FIELDS = Object.freeze([
  'schema', 'evaluatedAtMs', 'proposal', 'advisory', 'authority', 'policy', 'sizing',
  'market', 'signals', 'occupancy', 'current', 'twinEvidence',
] as const);
const PROPOSAL_FIELDS = Object.freeze([
  'owner', 'strategy', 'proposalId', 'correlationId', 'proposalRevision', 'proposalDigest',
  'symbol', 'direction', 'status', 'entryKind', 'marketStage', 'createdAtMs',
  'observedAtMs', 'expiresAtMs', 'featureRevision', 'evidenceRevision', 'exitPlanRevision',
  'invalidationConditions', 'evidenceIds',
] as const);
const ADVISORY_FIELDS = Object.freeze([
  'owner', 'state', 'advisoryAction', 'strategyFamily', 'ownerReference', 'assessmentId',
  'assessmentRevision', 'assessmentFingerprintSha256', 'modelRevision', 'featureRevision',
  'evidenceRevision', 'observedAtMs', 'expiresAtMs', 'economicExpiresAtMs', 'sourceQuality',
  'stage', 'exhaustion', 'reversal', 'fadeEligible', 'evidenceIds',
] as const);
const AUTHORITY_FIELDS = Object.freeze([
  'evidenceKind', 'systemMode', 'capitalState', 'capitalMandateId', 'capitalMandateRevision',
  'capitalMandateDigest', 'capitalReservationId', 'capitalReservationRevision',
  'capitalMaximumQuote', 'capitalConsumedQuote', 'capitalExpiresAtMs', 'riskState',
  'riskActionClass', 'riskVerdictId', 'riskVerdictRevision', 'riskVerdictDigest',
  'riskEvaluatedAtMs', 'riskExpiresAtMs', 'riskBoundLifecycleId',
  'riskBoundProjectionRevision', 'riskBoundPositionQuantity', 'riskContextRevision',
  'approvalState', 'approvalId', 'approvalRevision',
  'approvalExpiresAtMs', 'accountTruth', 'positionTruth', 'executionReady',
  'capitalAuthority', 'riskAuthority', 'actionAuthority', 'externalActionAuthorization',
] as const);
const SIZING_FIELDS = Object.freeze([
  'owner', 'state', 'product', 'symbol', 'baseAsset', 'quoteAsset', 'accountRealmId',
  'instrumentRevision', 'filterRevision', 'sourceEvidenceRevision',
  'observedAtMs', 'validUntilMs', 'inventoryMode', 'availableBaseQuantity',
  'inventoryRevision', 'inventoryAsset', 'inventoryAccountRealmId',
  'inventoryObservedAtMs', 'inventoryValidUntilMs', 'cuts',
] as const);
const SIZING_CUT_FIELDS = Object.freeze([
  'targetState', 'cumulativeQuantity', 'cumulativeNotionalQuote', 'priceBound',
] as const);
const MARKET_FIELDS = Object.freeze([
  'truth', 'observedAtMs', 'validUntilMs', 'currentPrice', 'intendedPriceBound',
  'riskReductionPriceBound', 'intendedDepthQuote', 'minimumDepthQuote', 'expectedCostQuote', 'expectedDownsideQuote',
  'spreadBps', 'maximumSpreadBps', 'bookRevision', 'costRevision', 'downsideRevision',
  'evidenceIds',
] as const);
const SIGNAL_FIELDS = Object.freeze([
  'thesisInvalidated', 'exhaustion', 'reversal', 'confirmation', 'addPermission',
  'manualClose', 'globalHalt', 'sourceState', 'spreadDepthState', 'reconciliationState',
  'recoveryDisposition', 'recoveryOutcome', 'recoveryRevision', 'currentPrice',
  'observedAtMs', 'validUntilMs', 'evidenceIds',
] as const);
const OCCUPANCY_FIELDS = Object.freeze([
  'owner', 'truth', 'observedAtMs', 'validUntilMs', 'activeRecords', 'priorActions',
] as const);
const OCCUPANCY_RECORD_FIELDS = Object.freeze([
  'recordId', 'recordRevision', 'projectionRevision', 'kind', 'lifecycleId', 'proposalId', 'assessmentId',
  'symbol', 'direction', 'ownerFamily', 'state', 'positionQuantity', 'intentKey',
  'actionKey',
] as const);
const PRIOR_ACTION_FIELDS = Object.freeze([
  'actionKey', 'intentKey', 'lifecycleId', 'proposalId', 'assessmentId', 'symbol',
  'direction', 'kind', 'state', 'recordedAtMs',
] as const);
const TWIN_EVIDENCE_FIELDS = Object.freeze(['schema', 'actionKey', 'fixtureId', 'twinState'] as const);
const SETTLED_TWIN_FIELDS = Object.freeze([
  'actionKey', 'fixtureId', 'twinStateRevision', 'twinOutcomeRevision', 'settlementState',
  'outcomeSequence',
] as const);
const NO_FILL_FIELDS = Object.freeze([
  'action', 'evidenceKind', 'fixtureId', 'twinStateRevision', 'twinOutcomeRevision',
  'recoveryResolutionRevision',
] as const);
const RECOVERY_CONSUMPTION_FIELDS = Object.freeze([
  'recoveryResolutionRevision', 'baseProjectionRevision', 'noFill',
  'priorConsumptionRevision', 'outcomeSequence', 'consumptionRevision',
] as const);
const TWIN_CONFLICT_FIELDS = Object.freeze([
  'kind', 'actionKey', 'fixtureId', 'recoveryResolutionRevision', 'twinStateRevision',
  'twinOutcomeRevision', 'filledQuantity', 'conflictRevision',
] as const);
const ACTION_FIELDS = Object.freeze([
  'schema', 'actionKey', 'intentKey', 'lifecycleId', 'projectionRevision',
  'positionBeforeQuantity', 'symbol', 'direction', 'kind', 'stageFrom', 'stageTo', 'side', 'requestedQuantity',
  'priceBound', 'maximumNotionalQuote', 'mandateUsageBeforeQuote',
  'mandateUsageAfterQuote', 'proposalId', 'proposalRevision', 'proposalDigest',
  'assessmentId', 'assessmentRevision', 'assessmentFingerprintSha256',
  'modelRevision', 'featureRevision', 'evidenceRevision', 'exitPlanRevision',
  'entryEvidenceRevision', 'ownerEvidenceRevision', 'capitalMandateId',
  'capitalMandateRevision', 'capitalMandateDigest', 'capitalReservationId',
  'capitalReservationRevision', 'capitalMaximumQuote', 'riskVerdictId',
  'riskVerdictRevision', 'riskVerdictDigest', 'riskActionClass',
  'riskContextRevision', 'approvalId', 'approvalRevision', 'accountRealmId',
  'baseAsset', 'quoteAsset', 'inventoryMode', 'availableBaseQuantity',
  'inventoryRevision', 'inventoryAsset', 'inventoryAccountRealmId',
  'inventoryObservedAtMs', 'inventoryValidUntilMs',
  'instrumentRevision', 'filterRevision', 'sourceEvidenceRevision', 'bookRevision',
  'costRevision', 'downsideRevision', 'triggerEpisodeRevision', 'triggerReasonCodes',
  'recoveryRetryRevision', 'policyRevision',
  'plannedAtMs', 'requiresOwnerPreflight',
  'requiresCanonicalRisk', 'syntheticTwinProofRequired', 'sendEligible',
  'actionAuthority', 'externalActionAuthorization', 'lifecycleAuthority',
  'simulationAuthority',
] as const);
const TRANSITION_FIELDS = Object.freeze([
  'from', 'to', 'primaryReasonCode', 'reasonCodes', 'occurredAtMs', 'evidenceIds',
  'twinOutcomeRevision',
] as const);
const PROJECTION_FIELDS = Object.freeze([
  'schema', 'lifecycleId', 'projectionRevision', 'revision', 'symbol', 'direction',
  'accountRealmId', 'baseAsset', 'quoteAsset',
  'proposalId', 'proposalRevision', 'proposalDigest', 'entryKind', 'featureRevision',
  'evidenceRevision', 'exitPlanRevision', 'invalidationConditions', 'assessmentId',
  'assessmentRevision', 'assessmentFingerprintSha256', 'advisoryModelRevision',
  'advisoryFeatureRevision', 'advisoryEvidenceRevision', 'entryInstrumentRevision',
  'entryFilterRevision', 'entrySourceEvidenceRevision', 'entrySizingCuts', 'entryInventoryMode',
  'entryAvailableBaseQuantity', 'entryInventoryRevision', 'entryInventoryAsset',
  'entryInventoryAccountRealmId', 'entryInventoryObservedAtMs',
  'entryInventoryValidUntilMs', 'entryBookRevision',
  'entryCostRevision', 'entryDownsideRevision', 'entryEvidenceRevision',
  'capitalMandateId', 'capitalMandateRevision', 'capitalMandateDigest',
  'capitalReservationId', 'capitalReservationRevision', 'capitalMaximumQuote',
  'policyRevision', 'state',
  'recoveryResumeState', 'openedAtMs', 'stageEnteredAtMs', 'entryAveragePrice',
  'entryCostBasisQuote', 'entryCostBasisQuantity',
  'currentPrice', 'favorableExtremePrice', 'lastMarketObservedAtMs', 'lastSignalObservedAtMs',
  'lastMarketObservationRevision', 'lastSignalObservationRevision',
  'positionQuantity', 'positionQuantityTruth',
  'mandateUsageAtLifecycleStartQuote', 'projectedMandateUsageQuote', 'capitalUsageTruth',
  'lastNoFill', 'reductionEpisodeRevision',
  'reductionEpisodeReasonCodes', 'reductionBasisQuantity', 'reductionTargetQuantity', 'pendingAction',
  'pendingActionBaseProjectionRevision', 'pendingTwinStateRevision', 'pendingTwinOutcomeRevision',
  'lastSettledActionKey', 'lastTwinStateRevision', 'lastTwinOutcomeRevision', 'settledTwinHistory',
  'recoveryEvidenceActionKey', 'recoveryEvidenceFixtureId',
  'recoveryEvidenceTwinStateRevision', 'recoveryEvidenceTwinOutcomeRevision',
  'unresolvedTwinConflict',
  'lastRecoveryResolutionRevision', 'lastRecoveryResolvedAtMs',
  'consumedRecoveryRevisions', 'recoveryConsumptionHistory',
  'terminalOutcomeReasonCodes', 'feedbackOutcomeRevision',
  'lastTransition', 'lifecycleAuthority',
  'simulationAuthority', 'sendEligible',
  'actionAuthority', 'externalActionAuthorization',
] as const);

export function digest(prefix: string, value: unknown): string {
  return `${prefix}${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function snapshot<T>(value: T): T {
  const seen = new Set<object>();
  const budget = { count: 0 };
  const visit = (candidate: unknown, depth: number): unknown => {
    budget.count += 1;
    if (budget.count > MAX_GRAPH_NODES || depth > MAX_GRAPH_DEPTH) {
      throw new RangeError('Volume lifecycle input graph is overbound');
    }
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'number') {
      if (!Number.isSafeInteger(candidate)) throw new TypeError('Volume lifecycle numbers must be safe integers');
      return candidate;
    }
    if (typeof candidate !== 'object' || utilTypes.isProxy(candidate) || seen.has(candidate)) {
      throw new TypeError('Volume lifecycle input must be alias-free plain data');
    }
    seen.add(candidate);
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) throw new TypeError('Volume lifecycle symbol keys are forbidden');
    if (Array.isArray(candidate)) {
      if (Object.getPrototypeOf(candidate) !== Array.prototype || keys.length !== candidate.length + 1) {
        throw new TypeError('Volume lifecycle arrays must be dense and undecorated');
      }
      return candidate.map((_, index) => {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('Volume lifecycle arrays must contain enumerable data');
        }
        return visit(descriptor.value, depth + 1);
      });
    }
    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Volume lifecycle records must be plain');
    if (keys.length > 96) throw new RangeError('Volume lifecycle record is overbound');
    const output: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      if (SECRET_FIELDS.has(key.replaceAll('_', '').toLowerCase())) {
        throw new TypeError('Volume lifecycle secret-shaped fields are forbidden');
      }
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Volume lifecycle records must contain enumerable data');
      }
      output[key] = visit(descriptor.value, depth + 1);
    }
    return output;
  };
  return visit(value, 0) as T;
}

export function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  if (utilTypes.isProxy(value)) throw new TypeError('Volume lifecycle output cannot contain a Proxy');
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('Volume lifecycle output cannot contain accessors');
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export function record(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be a record`);
  const keys = Object.keys(value).sort();
  if (canonicalJson(keys) !== canonicalJson([...fields].sort())) throw new TypeError(`${label} fields must match the closed schema`);
  return value as Record<string, unknown>;
}

export function timestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_UTC_MS) {
    throw new TypeError(`${label} must be a UTC millisecond integer`);
  }
  return value as number;
}

export function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value as number;
}

export function text(value: unknown, label: string, pattern = ID): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT || !pattern.test(value)) {
    throw new TypeError(`${label} must be a bounded identifier`);
  }
  return value;
}

export function oneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new TypeError(`${label} is unsupported`);
  return value as T;
}

export function stringArray(value: unknown, label: string, allowEmpty = true): readonly string[] {
  if (!Array.isArray(value) || value.length > 256 || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const values = value.map((entry) => text(entry, label));
  if (new Set(values).size !== values.length || values.some((entry, index) => index > 0 && values[index - 1] >= entry)) {
    throw new TypeError(`${label} must be code-unit sorted and unique`);
  }
  return values;
}

export function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

export function deriveVolumeEntryEvidenceRevision(value: Readonly<Record<string, unknown>>): string {
  return digest('l11entry_', {
    symbol: value.symbol,
    direction: value.direction,
    accountRealmId: value.accountRealmId,
    baseAsset: value.baseAsset,
    quoteAsset: value.quoteAsset,
    proposalId: value.proposalId,
    proposalRevision: value.proposalRevision,
    proposalDigest: value.proposalDigest,
    entryKind: value.entryKind,
    featureRevision: value.featureRevision,
    evidenceRevision: value.evidenceRevision,
    exitPlanRevision: value.exitPlanRevision,
    invalidationConditions: value.invalidationConditions,
    assessmentId: value.assessmentId,
    assessmentRevision: value.assessmentRevision,
    assessmentFingerprintSha256: value.assessmentFingerprintSha256,
    advisoryModelRevision: value.advisoryModelRevision,
    advisoryFeatureRevision: value.advisoryFeatureRevision,
    advisoryEvidenceRevision: value.advisoryEvidenceRevision,
    entryInstrumentRevision: value.entryInstrumentRevision,
    entryFilterRevision: value.entryFilterRevision,
    entrySourceEvidenceRevision: value.entrySourceEvidenceRevision,
    entrySizingCuts: value.entrySizingCuts,
    entryInventoryMode: value.entryInventoryMode,
    entryAvailableBaseQuantity: value.entryAvailableBaseQuantity,
    entryInventoryRevision: value.entryInventoryRevision,
    entryInventoryAsset: value.entryInventoryAsset,
    entryInventoryAccountRealmId: value.entryInventoryAccountRealmId,
    entryInventoryObservedAtMs: value.entryInventoryObservedAtMs,
    entryInventoryValidUntilMs: value.entryInventoryValidUntilMs,
    entryBookRevision: value.entryBookRevision,
    entryCostRevision: value.entryCostRevision,
    entryDownsideRevision: value.entryDownsideRevision,
    capitalMandateId: value.capitalMandateId,
    capitalMandateRevision: value.capitalMandateRevision,
    capitalMandateDigest: value.capitalMandateDigest,
    capitalReservationId: value.capitalReservationId,
    capitalReservationRevision: value.capitalReservationRevision,
    capitalMaximumQuote: value.capitalMaximumQuote,
  });
}

export function deriveVolumeIntentKey(value: Readonly<{
  lifecycleId: string;
  kind: string;
  stageFrom: unknown;
  stageTo: string;
  side: string;
  requestedQuantity: string;
  priceBound: string;
  capitalMandateId: string;
  capitalReservationId: string;
  entryEvidenceRevision: string;
  triggerEpisodeRevision: string | null;
  recoveryRetryRevision: string | null;
}>): string {
  return digest('l11intent_', {
    lifecycleId: value.lifecycleId,
    kind: value.kind,
    stageFrom: value.stageFrom,
    stageTo: value.stageTo,
    side: value.side,
    requestedQuantity: value.requestedQuantity,
    priceBound: value.priceBound,
    capitalMandateId: value.capitalMandateId,
    capitalReservationId: value.capitalReservationId,
    entryEvidenceRevision: value.entryEvidenceRevision,
    triggerEpisodeRevision: value.triggerEpisodeRevision,
    recoveryRetryRevision: value.recoveryRetryRevision,
  });
}

export function deriveVolumeRecoveryRetryRevision(value: Readonly<{
  lifecycleId: string;
  kind: 'REDUCE' | 'EXIT';
  priorNoFillActionKey: string;
  priorNoFillIntentKey: string;
  canonicalRecoveryResolutionRevision: string;
}>): string {
  return digest('l11retry_', {
    lifecycleId: value.lifecycleId,
    kind: value.kind,
    priorNoFillActionKey: value.priorNoFillActionKey,
    priorNoFillIntentKey: value.priorNoFillIntentKey,
    canonicalRecoveryResolutionRevision: value.canonicalRecoveryResolutionRevision,
  });
}

export function deriveVolumeRecoveryConsumptionRevision(value: Readonly<{
  lifecycleId: string;
  recoveryResolutionRevision: string;
  baseProjectionRevision: string;
  noFill: Readonly<VolumeNoFillRecord> | null;
  priorConsumptionRevision: string | null;
  outcomeSequence: number;
}>): string {
  return digest('l11recoveryconsumption_', {
    lifecycleId: value.lifecycleId,
    recoveryResolutionRevision: value.recoveryResolutionRevision,
    baseProjectionRevision: value.baseProjectionRevision,
    noFill: value.noFill,
    priorConsumptionRevision: value.priorConsumptionRevision,
    outcomeSequence: value.outcomeSequence,
  });
}

export function deriveVolumeActionKey(value: Readonly<Record<string, unknown>>): string {
  const { actionKey: _actionKey, ...semantic } = value;
  return digest('l11action_', semantic);
}

function validateAction(value: unknown): Readonly<VolumeLifecycleActionRequest> {
  const action = record(value, ACTION_FIELDS, 'Volume lifecycle action');
  if (action.schema !== 'LIVE_EDGE_VOLUME_ACTION_REQUEST_V1'
    || action.requiresOwnerPreflight !== true || action.requiresCanonicalRisk !== true
    || action.syntheticTwinProofRequired !== true || action.sendEligible !== false
    || action.actionAuthority !== 'NONE_RECORD_ONLY' || action.externalActionAuthorization !== 'NONE'
    || action.lifecycleAuthority !== 'ADVISORY_LIFECYCLE_PROJECTION_ONLY'
    || action.simulationAuthority !== 'SYNTHETIC_FIXTURE') {
    throw new TypeError('Volume lifecycle action authority is invalid');
  }
  text(action.actionKey, 'actionKey', ACTION_KEY);
  text(action.intentKey, 'intentKey', INTENT_KEY);
  text(action.lifecycleId, 'action lifecycleId');
  text(action.projectionRevision, 'action projectionRevision', CONTENT_REVISION);
  volumeDecimal(action.positionBeforeQuantity, 'action positionBeforeQuantity');
  text(action.symbol, 'action symbol', SYMBOL);
  oneOf(action.direction, ['LONG', 'SHORT'], 'action direction');
  oneOf(action.kind, ['ENTRY', 'ADD', 'REDUCE', 'EXIT'], 'action kind');
  if (action.stageFrom !== null) oneOf(action.stageFrom, ['PROBE', 'CONFIRM', 'ADD_ALLOWED', 'HOLD', 'REDUCE', 'EXIT', 'RECOVERY_REQUIRED'], 'stageFrom');
  oneOf(action.stageTo, ['PROBE', 'CONFIRM', 'ADD_ALLOWED', 'HOLD', 'REDUCE', 'EXIT', 'RECOVERY_REQUIRED'], 'stageTo');
  oneOf(action.side, ['BUY', 'SELL'], 'action side');
  positiveVolumeDecimal(action.requestedQuantity, 'requestedQuantity');
  positiveVolumeDecimal(action.priceBound, 'priceBound');
  positiveVolumeDecimal(action.maximumNotionalQuote, 'maximumNotionalQuote');
  if (compareVolumeDecimals(
    multiplyVolumeDecimals(action.requestedQuantity as string, action.priceBound as string),
    action.maximumNotionalQuote as string,
  ) > 0) {
    throw new TypeError('Volume action maximum notional does not cover requested quantity at its price bound');
  }
  volumeDecimal(action.mandateUsageBeforeQuote, 'mandateUsageBeforeQuote');
  volumeDecimal(action.mandateUsageAfterQuote, 'mandateUsageAfterQuote');
  for (const field of [
    'proposalId', 'proposalRevision', 'proposalDigest', 'assessmentId',
    'modelRevision', 'featureRevision', 'evidenceRevision', 'exitPlanRevision',
    'capitalMandateId', 'capitalMandateDigest', 'capitalReservationId',
    'riskVerdictId', 'riskVerdictRevision', 'riskVerdictDigest',
    'accountRealmId', 'instrumentRevision', 'filterRevision', 'sourceEvidenceRevision',
    'bookRevision', 'costRevision', 'downsideRevision', 'policyRevision',
  ] as const) text(action[field], field);
  text(action.baseAsset, 'action baseAsset', SYMBOL);
  text(action.quoteAsset, 'action quoteAsset', SYMBOL);
  oneOf(action.inventoryMode, ['QUOTE_FUNDED_LONG', 'PREOWNED_BASE_SHORT'], 'action inventoryMode');
  if (action.availableBaseQuantity !== null) volumeDecimal(action.availableBaseQuantity, 'action availableBaseQuantity');
  if (action.inventoryRevision !== null) text(action.inventoryRevision, 'action inventoryRevision');
  if (action.inventoryAsset !== null) text(action.inventoryAsset, 'action inventoryAsset', SYMBOL);
  if (action.inventoryAccountRealmId !== null) text(action.inventoryAccountRealmId, 'action inventoryAccountRealmId');
  if (action.inventoryObservedAtMs !== null) timestamp(action.inventoryObservedAtMs, 'action inventoryObservedAtMs');
  if (action.inventoryValidUntilMs !== null) timestamp(action.inventoryValidUntilMs, 'action inventoryValidUntilMs');
  const actionInventory = [action.availableBaseQuantity, action.inventoryRevision, action.inventoryAsset,
    action.inventoryAccountRealmId, action.inventoryObservedAtMs, action.inventoryValidUntilMs];
  if (action.direction === 'LONG') {
    if (action.inventoryMode !== 'QUOTE_FUNDED_LONG' || actionInventory.some((entry) => entry !== null)) {
      throw new TypeError('Volume LONG action cannot claim pre-owned base inventory');
    }
  } else if (action.inventoryMode !== 'PREOWNED_BASE_SHORT'
    || actionInventory.some((entry) => entry === null)
    || action.inventoryAsset !== action.baseAsset
    || action.inventoryAccountRealmId !== action.accountRealmId
    || ((action.kind === 'ENTRY' || action.kind === 'ADD')
      && compareVolumeDecimals(action.availableBaseQuantity as string, action.requestedQuantity as string) < 0)) {
    throw new TypeError('Volume SHORT action inventory proof is invalid');
  }
  text(action.assessmentFingerprintSha256, 'assessmentFingerprintSha256', HASH64);
  text(action.entryEvidenceRevision, 'entryEvidenceRevision', ENTRY_REVISION);
  text(action.ownerEvidenceRevision, 'ownerEvidenceRevision', OWNER_REVISION);
  text(action.riskContextRevision, 'riskContextRevision', RISK_CONTEXT_REVISION);
  if (action.triggerEpisodeRevision !== null) {
    text(action.triggerEpisodeRevision, 'triggerEpisodeRevision', REDUCTION_REVISION);
  }
  if (action.recoveryRetryRevision !== null) {
    text(action.recoveryRetryRevision, 'recoveryRetryRevision', RECOVERY_RETRY_REVISION);
    if (action.kind !== 'REDUCE' && action.kind !== 'EXIT') {
      throw new TypeError('Only a risk-reduction action may retain a recovery retry revision');
    }
  }
  if (!Array.isArray(action.triggerReasonCodes) || action.triggerReasonCodes.length > 64
    || action.triggerReasonCodes.some((reason) => typeof reason !== 'string' || !ID.test(reason))
    || new Set(action.triggerReasonCodes).size !== action.triggerReasonCodes.length) {
    throw new TypeError('Volume action trigger reasons must be bounded and unique');
  }
  integer(action.assessmentRevision, 1, Number.MAX_SAFE_INTEGER, 'assessmentRevision');
  text(action.capitalMandateId, 'capitalMandateId');
  integer(action.capitalMandateRevision, 1, Number.MAX_SAFE_INTEGER, 'capitalMandateRevision');
  integer(action.capitalReservationRevision, 1, Number.MAX_SAFE_INTEGER, 'capitalReservationRevision');
  positiveVolumeDecimal(action.capitalMaximumQuote, 'capitalMaximumQuote');
  oneOf(action.riskActionClass, ['OPEN', 'ADD', 'REDUCE', 'EXIT'], 'riskActionClass');
  if (action.approvalId !== null) text(action.approvalId, 'approvalId');
  if (action.approvalRevision !== null) integer(action.approvalRevision, 1, Number.MAX_SAFE_INTEGER, 'approvalRevision');
  timestamp(action.plannedAtMs, 'plannedAtMs');
  if (action.direction === 'SHORT' && (action.kind === 'ENTRY' || action.kind === 'ADD')
    && ((action.inventoryObservedAtMs as number) > (action.plannedAtMs as number)
      || (action.inventoryValidUntilMs as number) <= (action.plannedAtMs as number))) {
    throw new TypeError('Volume SHORT action inventory proof is not current at planning time');
  }
  const expectedIntentKey = deriveVolumeIntentKey(action as unknown as Parameters<typeof deriveVolumeIntentKey>[0]);
  if (action.intentKey !== expectedIntentKey) throw new TypeError('Volume lifecycle intent key does not match visible semantics');
  const expectedActionKey = deriveVolumeActionKey(action);
  if (action.actionKey !== expectedActionKey) throw new TypeError('Volume lifecycle action key does not match visible semantics');
  return deepFreeze(action as unknown as VolumeLifecycleActionRequest);
}

export function validateVolumeLifecycleActionRequest(value: unknown): Readonly<VolumeLifecycleActionRequest> {
  return validateAction(snapshot(value));
}

function noFillActionIsBoundToProjection(
  action: Readonly<VolumeLifecycleActionRequest>,
  projection: Readonly<Record<string, unknown>>,
): boolean {
  return action.lifecycleId === projection.lifecycleId
    && action.symbol === projection.symbol
    && action.direction === projection.direction
    && action.accountRealmId === projection.accountRealmId
    && action.baseAsset === projection.baseAsset
    && action.quoteAsset === projection.quoteAsset
    && action.proposalId === projection.proposalId
    && action.proposalRevision === projection.proposalRevision
    && action.proposalDigest === projection.proposalDigest
    && action.assessmentId === projection.assessmentId
    && action.assessmentRevision === projection.assessmentRevision
    && action.assessmentFingerprintSha256 === projection.assessmentFingerprintSha256
    && action.modelRevision === projection.advisoryModelRevision
    && action.featureRevision === projection.featureRevision
    && action.evidenceRevision === projection.evidenceRevision
    && action.exitPlanRevision === projection.exitPlanRevision
    && action.entryEvidenceRevision === projection.entryEvidenceRevision
    && action.instrumentRevision === projection.entryInstrumentRevision
    && action.filterRevision === projection.entryFilterRevision
    && action.sourceEvidenceRevision === projection.entrySourceEvidenceRevision
    && (action.kind === 'ADD'
      || (action.inventoryMode === projection.entryInventoryMode
        && action.availableBaseQuantity === projection.entryAvailableBaseQuantity
        && action.inventoryRevision === projection.entryInventoryRevision
        && action.inventoryAsset === projection.entryInventoryAsset
        && action.inventoryAccountRealmId === projection.entryInventoryAccountRealmId
        && action.inventoryObservedAtMs === projection.entryInventoryObservedAtMs
        && action.inventoryValidUntilMs === projection.entryInventoryValidUntilMs))
    && action.capitalMandateId === projection.capitalMandateId
    && action.capitalMandateRevision === projection.capitalMandateRevision
    && action.capitalMandateDigest === projection.capitalMandateDigest
    && action.capitalReservationId === projection.capitalReservationId
    && action.capitalReservationRevision === projection.capitalReservationRevision
    && action.capitalMaximumQuote === projection.capitalMaximumQuote;
}

function projectionMaterial(projection: Omit<VolumeLifecycleProjection, 'projectionRevision'>): unknown {
  return projection;
}

export function finalizeProjection(
  value: Omit<VolumeLifecycleProjection, 'projectionRevision'>,
): Readonly<VolumeLifecycleProjection> {
  return deepFreeze({
    ...value,
    projectionRevision: digest('l11projection_', projectionMaterial(value)),
  });
}

export function validateLifecycleProjection(value: unknown): Readonly<VolumeLifecycleProjection> {
  const projection = record(snapshot(value), PROJECTION_FIELDS, 'Volume lifecycle projection');
  if (projection.schema !== VOLUME_LIFECYCLE_PROJECTION_SCHEMA
    || projection.lifecycleAuthority !== 'ADVISORY_LIFECYCLE_PROJECTION_ONLY'
    || projection.simulationAuthority !== 'SYNTHETIC_FIXTURE'
    || projection.sendEligible !== false || projection.actionAuthority !== 'NONE_RECORD_ONLY'
    || projection.externalActionAuthorization !== 'NONE') {
    throw new TypeError('Volume lifecycle projection authority is invalid');
  }
  text(projection.lifecycleId, 'lifecycleId');
  text(projection.projectionRevision, 'projectionRevision', CONTENT_REVISION);
  integer(projection.revision, 1, Number.MAX_SAFE_INTEGER, 'projection revision');
  text(projection.symbol, 'projection symbol', SYMBOL);
  oneOf(projection.direction, ['LONG', 'SHORT'], 'projection direction');
  text(projection.accountRealmId, 'projection accountRealmId');
  text(projection.baseAsset, 'projection baseAsset', SYMBOL);
  text(projection.quoteAsset, 'projection quoteAsset', SYMBOL);
  text(projection.proposalId, 'projection proposalId');
  text(projection.proposalRevision, 'projection proposalRevision');
  text(projection.proposalDigest, 'projection proposalDigest');
  oneOf(projection.entryKind, ['CONTINUATION', 'FADE'], 'projection entryKind');
  text(projection.featureRevision, 'projection featureRevision');
  text(projection.evidenceRevision, 'projection evidenceRevision');
  text(projection.exitPlanRevision, 'projection exitPlanRevision');
  stringArray(projection.invalidationConditions, 'projection invalidationConditions', false);
  text(projection.assessmentId, 'projection assessmentId');
  integer(projection.assessmentRevision, 1, Number.MAX_SAFE_INTEGER, 'projection assessmentRevision');
  text(projection.assessmentFingerprintSha256, 'projection assessmentFingerprintSha256', HASH64);
  for (const field of [
    'advisoryModelRevision', 'advisoryFeatureRevision', 'advisoryEvidenceRevision',
    'entryInstrumentRevision', 'entryFilterRevision', 'entrySourceEvidenceRevision',
    'entryBookRevision', 'entryCostRevision', 'entryDownsideRevision',
  ] as const) text(projection[field], `projection ${field}`);
  oneOf(projection.entryInventoryMode, ['QUOTE_FUNDED_LONG', 'PREOWNED_BASE_SHORT'], 'projection entryInventoryMode');
  if (projection.entryAvailableBaseQuantity !== null) {
    volumeDecimal(projection.entryAvailableBaseQuantity, 'projection entryAvailableBaseQuantity');
  }
  if (projection.entryInventoryRevision !== null) text(projection.entryInventoryRevision, 'projection entryInventoryRevision');
  if (projection.entryInventoryAsset !== null) text(projection.entryInventoryAsset, 'projection entryInventoryAsset', SYMBOL);
  if (projection.entryInventoryAccountRealmId !== null) {
    text(projection.entryInventoryAccountRealmId, 'projection entryInventoryAccountRealmId');
  }
  if (projection.entryInventoryObservedAtMs !== null) {
    timestamp(projection.entryInventoryObservedAtMs, 'projection entryInventoryObservedAtMs');
  }
  if (projection.entryInventoryValidUntilMs !== null) {
    timestamp(projection.entryInventoryValidUntilMs, 'projection entryInventoryValidUntilMs');
  }
  const entryInventory = [projection.entryAvailableBaseQuantity, projection.entryInventoryRevision,
    projection.entryInventoryAsset, projection.entryInventoryAccountRealmId,
    projection.entryInventoryObservedAtMs, projection.entryInventoryValidUntilMs];
  if (projection.direction === 'LONG') {
    if (projection.entryInventoryMode !== 'QUOTE_FUNDED_LONG'
      || entryInventory.some((entry) => entry !== null)) {
      throw new TypeError('Volume LONG entry inventory provenance is invalid');
    }
  } else if (projection.entryInventoryMode !== 'PREOWNED_BASE_SHORT'
    || entryInventory.some((entry) => entry === null)
    || projection.entryInventoryAsset !== projection.baseAsset
    || projection.entryInventoryAccountRealmId !== projection.accountRealmId) {
    throw new TypeError('Volume SHORT entry inventory provenance is invalid');
  }
  if (!Array.isArray(projection.entrySizingCuts) || projection.entrySizingCuts.length !== 3) {
    throw new TypeError('Volume lifecycle must retain exactly three entry sizing cuts');
  }
  const retainedSizingStates: string[] = [];
  let retainedPriorQuantity = '0';
  let retainedPriorNotional = '0';
  for (const candidate of projection.entrySizingCuts) {
    const cut = record(candidate, SIZING_CUT_FIELDS, 'Volume retained entry sizing cut');
    retainedSizingStates.push(oneOf(cut.targetState, ['PROBE', 'CONFIRM', 'HOLD'],
      'retained entry sizing targetState'));
    positiveVolumeDecimal(cut.cumulativeQuantity, 'retained entry cumulativeQuantity');
    positiveVolumeDecimal(cut.cumulativeNotionalQuote, 'retained entry cumulativeNotionalQuote');
    positiveVolumeDecimal(cut.priceBound, 'retained entry priceBound');
    if (compareVolumeDecimals(cut.cumulativeQuantity as string, retainedPriorQuantity) <= 0
      || compareVolumeDecimals(cut.cumulativeNotionalQuote as string, retainedPriorNotional) <= 0) {
      throw new TypeError('Volume retained entry sizing cuts must be cumulative');
    }
    retainedPriorQuantity = cut.cumulativeQuantity as string;
    retainedPriorNotional = cut.cumulativeNotionalQuote as string;
  }
  if (canonicalJson(retainedSizingStates) !== canonicalJson(['PROBE', 'CONFIRM', 'HOLD'])) {
    throw new TypeError('Volume retained entry sizing cuts must be PROBE, CONFIRM, HOLD in order');
  }
  text(projection.entryEvidenceRevision, 'projection entryEvidenceRevision', ENTRY_REVISION);
  text(projection.capitalMandateId, 'projection capitalMandateId');
  integer(projection.capitalMandateRevision, 1, Number.MAX_SAFE_INTEGER, 'projection capitalMandateRevision');
  text(projection.capitalMandateDigest, 'projection capitalMandateDigest');
  text(projection.capitalReservationId, 'projection capitalReservationId');
  integer(projection.capitalReservationRevision, 1, Number.MAX_SAFE_INTEGER, 'projection capitalReservationRevision');
  positiveVolumeDecimal(projection.capitalMaximumQuote, 'projection capitalMaximumQuote');
  text(projection.policyRevision, 'projection policyRevision');
  oneOf(projection.state, ['PROBE', 'CONFIRM', 'ADD_ALLOWED', 'HOLD', 'REDUCE', 'EXIT', 'RECOVERY_REQUIRED'], 'projection state');
  if (projection.recoveryResumeState !== null) {
    oneOf(projection.recoveryResumeState, ['PROBE', 'CONFIRM', 'ADD_ALLOWED', 'HOLD', 'REDUCE', 'EXIT'], 'recoveryResumeState');
  }
  if (projection.openedAtMs !== null) timestamp(projection.openedAtMs, 'openedAtMs');
  timestamp(projection.stageEnteredAtMs, 'stageEnteredAtMs');
  if (projection.entryAveragePrice !== null) positiveVolumeDecimal(projection.entryAveragePrice, 'entryAveragePrice');
  volumeDecimal(projection.entryCostBasisQuote, 'entryCostBasisQuote');
  volumeDecimal(projection.entryCostBasisQuantity, 'entryCostBasisQuantity');
  const emptyEntryCostBasis = projection.entryCostBasisQuote === '0'
    && projection.entryCostBasisQuantity === '0';
  if ((projection.entryCostBasisQuote === '0') !== (projection.entryCostBasisQuantity === '0')
    || (projection.entryAveragePrice === null) !== emptyEntryCostBasis
    || (projection.openedAtMs === null) !== emptyEntryCostBasis) {
    throw new TypeError('Volume entry average and exact cost basis must be present together');
  }
  if (!emptyEntryCostBasis
    && projection.entryAveragePrice !== divideVolumeDecimals(
      projection.entryCostBasisQuote as string,
      projection.entryCostBasisQuantity as string,
    )) {
    throw new TypeError('Volume entry average display does not match its exact cost basis');
  }
  positiveVolumeDecimal(projection.currentPrice, 'projection currentPrice');
  if (projection.favorableExtremePrice !== null) positiveVolumeDecimal(projection.favorableExtremePrice, 'favorableExtremePrice');
  if (projection.lastMarketObservedAtMs !== null) {
    timestamp(projection.lastMarketObservedAtMs, 'lastMarketObservedAtMs');
  }
  if (projection.lastSignalObservedAtMs !== null) {
    timestamp(projection.lastSignalObservedAtMs, 'lastSignalObservedAtMs');
  }
  if (projection.lastMarketObservationRevision !== null) {
    text(projection.lastMarketObservationRevision, 'lastMarketObservationRevision', MARKET_OBSERVATION_REVISION);
  }
  if (projection.lastSignalObservationRevision !== null) {
    text(projection.lastSignalObservationRevision, 'lastSignalObservationRevision', SIGNAL_OBSERVATION_REVISION);
  }
  const observationPresence = [projection.lastMarketObservedAtMs, projection.lastSignalObservedAtMs,
    projection.lastMarketObservationRevision, projection.lastSignalObservationRevision];
  if ((observationPresence.some((value) => value === null)
      && observationPresence.some((value) => value !== null))
    || (projection.openedAtMs === null && projection.lastMarketObservedAtMs !== null)
    || (projection.openedAtMs !== null && projection.lastMarketObservedAtMs !== null
      && ((projection.lastMarketObservedAtMs as number) < (projection.openedAtMs as number)
        || (projection.lastSignalObservedAtMs as number) < (projection.openedAtMs as number)))) {
    throw new TypeError('Volume retained market observation chronology is invalid');
  }
  volumeDecimal(projection.positionQuantity, 'positionQuantity');
  oneOf(projection.positionQuantityTruth, ['EXACT', 'UNKNOWN'], 'positionQuantityTruth');
  if (projection.positionQuantityTruth === 'UNKNOWN' && projection.state !== 'RECOVERY_REQUIRED') {
    throw new TypeError('Unknown position quantity truth is confined to recovery');
  }
  volumeDecimal(projection.mandateUsageAtLifecycleStartQuote, 'mandateUsageAtLifecycleStartQuote');
  volumeDecimal(projection.projectedMandateUsageQuote, 'projectedMandateUsageQuote');
  oneOf(projection.capitalUsageTruth, ['EXACT', 'UNKNOWN'], 'capitalUsageTruth');
  if (projection.capitalUsageTruth === 'UNKNOWN' && projection.state !== 'RECOVERY_REQUIRED') {
    throw new TypeError('Unknown Capital usage truth is confined to recovery');
  }
  if (compareVolumeDecimals(projection.projectedMandateUsageQuote as string, projection.mandateUsageAtLifecycleStartQuote as string) < 0
    || (projection.state !== 'RECOVERY_REQUIRED'
      && compareVolumeDecimals(projection.projectedMandateUsageQuote as string, projection.capitalMaximumQuote as string) > 0)) {
    throw new TypeError('Volume lifecycle projected mandate usage is outside its immutable Capital binding');
  }
  let lastNoFill: Readonly<{
    action: Readonly<VolumeLifecycleActionRequest>;
    evidenceKind: 'TWIN_NO_FILL' | 'CANONICAL_NO_EFFECT';
    fixtureId: string | null;
    twinStateRevision: string | null;
    twinOutcomeRevision: string | null;
    recoveryResolutionRevision: string | null;
  }> | null = null;
  if (projection.lastNoFill !== null) {
    const retained = record(projection.lastNoFill, NO_FILL_FIELDS, 'Volume no-fill record');
    const action = validateAction(retained.action);
    const evidenceKind = oneOf(retained.evidenceKind, ['TWIN_NO_FILL', 'CANONICAL_NO_EFFECT'],
      'no-fill evidence kind');
    const evidenceTuple = [retained.fixtureId, retained.twinStateRevision, retained.twinOutcomeRevision];
    if (evidenceKind === 'TWIN_NO_FILL') {
      if (evidenceTuple.some((entry) => entry === null)) {
        throw new TypeError('Twin no-fill record requires complete twin evidence');
      }
      text(retained.fixtureId, 'no-fill fixtureId');
      text(retained.twinStateRevision, 'no-fill twinStateRevision');
      text(retained.twinOutcomeRevision, 'no-fill twinOutcomeRevision');
      if (retained.fixtureId !== `l11fixture_${action.actionKey.slice('l11action_'.length)}`) {
        throw new TypeError('Twin no-fill fixture is not intrinsic to its action');
      }
    } else if (evidenceTuple.some((entry) => entry !== null)
      || retained.recoveryResolutionRevision === null) {
      throw new TypeError('Canonical no-effect record requires only recovery evidence');
    }
    if (retained.recoveryResolutionRevision !== null) {
      text(retained.recoveryResolutionRevision, 'no-fill recoveryResolutionRevision');
    }
    lastNoFill = {
      action,
      evidenceKind,
      fixtureId: retained.fixtureId as string | null,
      twinStateRevision: retained.twinStateRevision as string | null,
      twinOutcomeRevision: retained.twinOutcomeRevision as string | null,
      recoveryResolutionRevision: retained.recoveryResolutionRevision as string | null,
    };
    if (!noFillActionIsBoundToProjection(action, projection)) {
      throw new TypeError('Volume no-fill action is not bound to its lifecycle projection');
    }
    if (action.positionBeforeQuantity !== projection.positionQuantity
      || action.mandateUsageBeforeQuote !== projection.projectedMandateUsageQuote) {
      throw new TypeError('Volume latest no-fill action does not match retained exposure and Capital usage');
    }
  }
  if (!Array.isArray(projection.consumedRecoveryRevisions)
    || projection.consumedRecoveryRevisions.length > 32
    || projection.consumedRecoveryRevisions.some((revision) => typeof revision !== 'string'
      || !ID.test(revision) || revision.length > MAX_TEXT)
    || new Set(projection.consumedRecoveryRevisions).size !== projection.consumedRecoveryRevisions.length) {
    throw new TypeError('Volume consumed recovery revisions must be bounded and unique');
  }
  if (projection.lastRecoveryResolutionRevision !== null) {
    text(projection.lastRecoveryResolutionRevision, 'lastRecoveryResolutionRevision');
  }
  if (projection.lastRecoveryResolvedAtMs !== null) {
    timestamp(projection.lastRecoveryResolvedAtMs, 'lastRecoveryResolvedAtMs');
  }
  if ((projection.lastRecoveryResolutionRevision === null)
    !== (projection.lastRecoveryResolvedAtMs === null)) {
    throw new TypeError('Volume latest recovery revision and resolution time must be present together');
  }
  if ((projection.lastRecoveryResolutionRevision === null)
      !== (projection.consumedRecoveryRevisions.length === 0)
    || (projection.lastRecoveryResolutionRevision !== null
      && projection.consumedRecoveryRevisions.at(-1) !== projection.lastRecoveryResolutionRevision)) {
    throw new TypeError('Volume latest recovery resolution must match its consumed history');
  }
  if (!Array.isArray(projection.recoveryConsumptionHistory)
    || projection.recoveryConsumptionHistory.length > 32
    || projection.recoveryConsumptionHistory.length !== projection.consumedRecoveryRevisions.length) {
    throw new TypeError('Volume recovery consumption history must exactly cover consumed revisions');
  }
  let priorConsumptionRevision: string | null = null;
  let priorRecoveryOutcomeSequence = 0;
  const recoveryConsumptionActionKeys = new Set<string>();
  const retainedOutcomeSequences = new Set<number>();
  const recoveryNoFillOutcomes: Array<Readonly<{
    outcomeSequence: number;
    noFill: Readonly<VolumeNoFillRecord>;
  }>> = [];
  for (const [index, candidate] of projection.recoveryConsumptionHistory.entries()) {
    const consumption = record(candidate, RECOVERY_CONSUMPTION_FIELDS,
      'Volume recovery consumption record');
    text(consumption.recoveryResolutionRevision, 'recovery consumption resolution revision');
    text(consumption.baseProjectionRevision, 'recovery consumption base projection revision', CONTENT_REVISION);
    if (consumption.priorConsumptionRevision !== null) {
      text(consumption.priorConsumptionRevision, 'prior recovery consumption revision',
        RECOVERY_CONSUMPTION_REVISION);
    }
    text(consumption.consumptionRevision, 'recovery consumption revision',
      RECOVERY_CONSUMPTION_REVISION);
    integer(consumption.outcomeSequence, 1, projection.revision as number,
      'recovery consumption outcomeSequence');
    if ((consumption.outcomeSequence as number) <= priorRecoveryOutcomeSequence
      || retainedOutcomeSequences.has(consumption.outcomeSequence as number)) {
      throw new TypeError('Volume recovery outcome sequence must be strictly increasing and unique');
    }
    priorRecoveryOutcomeSequence = consumption.outcomeSequence as number;
    retainedOutcomeSequences.add(priorRecoveryOutcomeSequence);
    let consumedNoFill: Readonly<VolumeNoFillRecord> | null = null;
    if (consumption.noFill !== null) {
      const retained = record(consumption.noFill, NO_FILL_FIELDS,
        'Volume recovery consumption no-fill record');
      const action = validateAction(retained.action);
      const evidenceKind = oneOf(retained.evidenceKind, ['TWIN_NO_FILL', 'CANONICAL_NO_EFFECT'],
        'recovery consumption no-fill evidence kind');
      const evidenceTuple = [retained.fixtureId, retained.twinStateRevision, retained.twinOutcomeRevision];
      if (evidenceKind === 'TWIN_NO_FILL') {
        if (evidenceTuple.some((entry) => entry === null)) {
          throw new TypeError('Recovery consumption twin no-fill requires complete twin evidence');
        }
        text(retained.fixtureId, 'recovery consumption no-fill fixtureId');
        text(retained.twinStateRevision, 'recovery consumption no-fill twinStateRevision');
        text(retained.twinOutcomeRevision, 'recovery consumption no-fill twinOutcomeRevision');
        if (retained.fixtureId !== `l11fixture_${action.actionKey.slice('l11action_'.length)}`) {
          throw new TypeError('Recovery consumption twin fixture is not intrinsic to its action');
        }
      } else if (evidenceTuple.some((entry) => entry !== null)
        || retained.recoveryResolutionRevision === null) {
        throw new TypeError('Recovery consumption canonical no-effect requires only recovery evidence');
      }
      if (retained.recoveryResolutionRevision !== consumption.recoveryResolutionRevision) {
        throw new TypeError('Recovery consumption no-fill does not match its resolution revision');
      }
      if (!noFillActionIsBoundToProjection(action, projection)) {
        throw new TypeError('Recovery consumption no-fill action is not bound to its lifecycle projection');
      }
      if (recoveryConsumptionActionKeys.has(action.actionKey)) {
        throw new TypeError('Recovery consumption no-fill action is duplicated');
      }
      recoveryConsumptionActionKeys.add(action.actionKey);
      consumedNoFill = {
        action,
        evidenceKind,
        fixtureId: retained.fixtureId as string | null,
        twinStateRevision: retained.twinStateRevision as string | null,
        twinOutcomeRevision: retained.twinOutcomeRevision as string | null,
        recoveryResolutionRevision: retained.recoveryResolutionRevision as string,
      };
      recoveryNoFillOutcomes.push(Object.freeze({
        outcomeSequence: consumption.outcomeSequence as number,
        noFill: consumedNoFill,
      }));
    }
    if (projection.consumedRecoveryRevisions[index] !== consumption.recoveryResolutionRevision) {
      throw new TypeError('Recovery consumption record does not match consumed revision order');
    }
    if (consumption.priorConsumptionRevision !== priorConsumptionRevision) {
      throw new TypeError('Recovery consumption history is not a closed chain');
    }
    const expectedConsumptionRevision = deriveVolumeRecoveryConsumptionRevision({
      lifecycleId: projection.lifecycleId as string,
      recoveryResolutionRevision: consumption.recoveryResolutionRevision as string,
      baseProjectionRevision: consumption.baseProjectionRevision as string,
      noFill: consumedNoFill,
      priorConsumptionRevision,
      outcomeSequence: consumption.outcomeSequence as number,
    });
    if (consumption.consumptionRevision !== expectedConsumptionRevision) {
      throw new TypeError('Recovery consumption revision does not match its retained proof');
    }
    priorConsumptionRevision = consumption.consumptionRevision as string;
  }
  if (lastNoFill !== null && lastNoFill.recoveryResolutionRevision !== null
    && !projection.consumedRecoveryRevisions.includes(lastNoFill.recoveryResolutionRevision)) {
    throw new TypeError('Volume no-fill recovery revision is not retained as consumed');
  }
  if (lastNoFill !== null && lastNoFill.recoveryResolutionRevision !== null) {
    const matchingConsumption = projection.recoveryConsumptionHistory.find((candidate) => (
      candidate.recoveryResolutionRevision === lastNoFill?.recoveryResolutionRevision
    ));
    if (matchingConsumption === undefined
      || canonicalJson(matchingConsumption.noFill) !== canonicalJson(lastNoFill)) {
      throw new TypeError('Volume no-fill recovery proof is not retained in consumption history');
    }
  }
  const episodeValues = [projection.reductionEpisodeRevision, projection.reductionEpisodeReasonCodes,
    projection.reductionBasisQuantity, projection.reductionTargetQuantity];
  if (episodeValues.some((entry) => entry !== null) && episodeValues.some((entry) => entry === null)) {
    throw new TypeError('Volume exhaustion episode must be wholly present or absent');
  }
  if (projection.reductionEpisodeRevision !== null) {
    text(projection.reductionEpisodeRevision, 'reductionEpisodeRevision', REDUCTION_REVISION);
    if (!Array.isArray(projection.reductionEpisodeReasonCodes)
      || projection.reductionEpisodeReasonCodes.length === 0
      || projection.reductionEpisodeReasonCodes.length > 64
      || projection.reductionEpisodeReasonCodes.some((reason) => typeof reason !== 'string' || !ID.test(reason))
      || new Set(projection.reductionEpisodeReasonCodes).size !== projection.reductionEpisodeReasonCodes.length) {
      throw new TypeError('Volume reduction episode reasons must be bounded and unique');
    }
    positiveVolumeDecimal(projection.reductionBasisQuantity, 'reductionBasisQuantity');
    volumeDecimal(projection.reductionTargetQuantity, 'reductionTargetQuantity');
    if (compareVolumeDecimals(projection.reductionTargetQuantity as string, projection.reductionBasisQuantity as string) > 0) {
      throw new TypeError('Volume reduction target cannot exceed its episode basis');
    }
  }
  let pending: Readonly<VolumeLifecycleActionRequest> | null = null;
  if (projection.pendingAction !== null) pending = validateAction(projection.pendingAction);
  if (projection.pendingActionBaseProjectionRevision !== null) {
    text(projection.pendingActionBaseProjectionRevision, 'pendingActionBaseProjectionRevision', CONTENT_REVISION);
  }
  if ((pending === null) !== (projection.pendingActionBaseProjectionRevision === null)) {
    throw new TypeError('Volume pending action base revision must be present exactly with the action');
  }
  if (pending !== null && lastNoFill?.action.intentKey === pending.intentKey) {
    throw new TypeError('Volume pending action repeats the retained no-fill intent');
  }
  if (pending !== null) {
    const retryKind = pending.kind === 'REDUCE' || pending.kind === 'EXIT' ? pending.kind : null;
    const expectedRecoveryRetryRevision = retryKind !== null
      && lastNoFill?.action.kind === retryKind
      && lastNoFill.recoveryResolutionRevision !== null
      ? deriveVolumeRecoveryRetryRevision({
        lifecycleId: projection.lifecycleId as string,
        kind: retryKind,
        priorNoFillActionKey: lastNoFill.action.actionKey,
        priorNoFillIntentKey: lastNoFill.action.intentKey,
        canonicalRecoveryResolutionRevision: lastNoFill.recoveryResolutionRevision,
      })
      : null;
    if (pending.recoveryRetryRevision !== expectedRecoveryRetryRevision) {
      throw new TypeError('Volume pending action recovery retry lineage does not match the projection');
    }
  }
  if (pending !== null && (pending.kind === 'ENTRY' || pending.kind === 'ADD')
    && lastNoFill?.action.ownerEvidenceRevision === pending.ownerEvidenceRevision) {
    throw new TypeError('Volume increasing action repeats unchanged no-fill owner evidence');
  }
  for (const field of ['pendingTwinStateRevision', 'pendingTwinOutcomeRevision'] as const) {
    if (projection[field] !== null) text(projection[field], field);
  }
  if ((projection.pendingTwinStateRevision === null) !== (projection.pendingTwinOutcomeRevision === null)
    || (pending === null && projection.pendingTwinStateRevision !== null)
    || (projection.pendingTwinStateRevision !== null
      && (projection.state !== 'RECOVERY_REQUIRED'
        || projection.positionQuantityTruth !== 'UNKNOWN'
        || projection.capitalUsageTruth !== 'UNKNOWN'))) {
    throw new TypeError('Volume pending twin revisions require one pending action and a complete tuple');
  }
  if (projection.lastSettledActionKey !== null) text(projection.lastSettledActionKey, 'lastSettledActionKey', ACTION_KEY);
  for (const field of ['lastTwinStateRevision', 'lastTwinOutcomeRevision'] as const) {
    if (projection[field] !== null) text(projection[field], field);
  }
  if (!Array.isArray(projection.settledTwinHistory) || projection.settledTwinHistory.length > 32) {
    throw new TypeError('Volume settled twin history must be a bounded array');
  }
  const settledKeys = new Set<string>();
  let priorSettledOutcomeSequence = 0;
  for (const candidate of projection.settledTwinHistory) {
    const settled = record(candidate, SETTLED_TWIN_FIELDS, 'Volume settled twin record');
    text(settled.actionKey, 'settled twin actionKey', ACTION_KEY);
    text(settled.fixtureId, 'settled twin fixtureId');
    text(settled.twinStateRevision, 'settled twin state revision');
    text(settled.twinOutcomeRevision, 'settled twin outcome revision');
    oneOf(settled.settlementState, ['NO_FILL', 'FILLED', 'RECOVERY_REQUIRED'],
      'settled twin settlementState');
    integer(settled.outcomeSequence, 1, projection.revision as number,
      'settled twin outcomeSequence');
    if ((settled.outcomeSequence as number) <= priorSettledOutcomeSequence
      || retainedOutcomeSequences.has(settled.outcomeSequence as number)) {
      throw new TypeError('Volume settled outcome sequence must be strictly increasing and unique');
    }
    priorSettledOutcomeSequence = settled.outcomeSequence as number;
    retainedOutcomeSequences.add(priorSettledOutcomeSequence);
    if (settled.fixtureId !== `l11fixture_${(settled.actionKey as string).slice('l11action_'.length)}`) {
      throw new TypeError('Volume settled twin fixture is not intrinsic to its action');
    }
    if (settledKeys.has(settled.actionKey as string)) throw new TypeError('Volume settled twin action is duplicated');
    settledKeys.add(settled.actionKey as string);
  }
  const latestSettled = projection.settledTwinHistory.at(-1);
  if (projection.settledTwinHistory.slice(0, -1).some((record) => (
    record.settlementState === 'RECOVERY_REQUIRED'
  ))) {
    throw new TypeError('Volume settled recovery effect must be the latest retained twin outcome');
  }
  if ((latestSettled === undefined) !== (projection.lastSettledActionKey === null)
    || (latestSettled === undefined
      && (projection.lastTwinStateRevision !== null || projection.lastTwinOutcomeRevision !== null))
    || (latestSettled !== undefined && (latestSettled.actionKey !== projection.lastSettledActionKey
      || latestSettled.twinStateRevision !== projection.lastTwinStateRevision
      || latestSettled.twinOutcomeRevision !== projection.lastTwinOutcomeRevision))) {
    throw new TypeError('Volume latest settled twin pointers do not match retained history');
  }
  if (pending !== null && settledKeys.has(pending.actionKey)) {
    throw new TypeError('Volume pending action cannot already be settled');
  }
  if (lastNoFill?.evidenceKind === 'TWIN_NO_FILL') {
    const retainedNoFill = projection.settledTwinHistory.find((record) => (
      record.actionKey === lastNoFill?.action.actionKey
    ));
    if (retainedNoFill === undefined
      || retainedNoFill.settlementState !== 'NO_FILL'
      || retainedNoFill.fixtureId !== lastNoFill.fixtureId
      || retainedNoFill.twinStateRevision !== lastNoFill.twinStateRevision
      || retainedNoFill.twinOutcomeRevision !== lastNoFill.twinOutcomeRevision) {
      throw new TypeError('Volume twin no-fill lineage is not retained in settled history');
    }
  }
  const latestRecoveryNoFill = recoveryNoFillOutcomes.at(-1);
  const latestSettledOutcomeSequence = latestSettled?.outcomeSequence as number | undefined;
  if (latestRecoveryNoFill !== undefined
    && (latestSettledOutcomeSequence === undefined
      || latestRecoveryNoFill.outcomeSequence > latestSettledOutcomeSequence)) {
    if (lastNoFill === null
      || canonicalJson(lastNoFill) !== canonicalJson(latestRecoveryNoFill.noFill)) {
      throw new TypeError('Volume current no-fill head does not match its latest recovery outcome');
    }
  } else if (latestSettled !== undefined && latestSettled.settlementState === 'NO_FILL') {
    if (lastNoFill?.evidenceKind !== 'TWIN_NO_FILL'
      || lastNoFill.action.actionKey !== latestSettled.actionKey
      || lastNoFill.fixtureId !== latestSettled.fixtureId
      || lastNoFill.twinStateRevision !== latestSettled.twinStateRevision
      || lastNoFill.twinOutcomeRevision !== latestSettled.twinOutcomeRevision) {
      throw new TypeError('Volume current no-fill head does not match its latest twin outcome');
    }
  } else if (lastNoFill !== null) {
    throw new TypeError('Volume current no-fill head lacks a latest retained outcome');
  }
  if (pending?.kind === 'REDUCE'
    && (pending.triggerEpisodeRevision === null
      || pending.triggerEpisodeRevision !== projection.reductionEpisodeRevision
      || projection.reductionEpisodeReasonCodes === null
      || canonicalJson(pending.triggerReasonCodes) !== canonicalJson(projection.reductionEpisodeReasonCodes))) {
    throw new TypeError('Volume pending REDUCE action is not bound to its reduction episode');
  }
  const recoveryEvidenceValues = [projection.recoveryEvidenceActionKey, projection.recoveryEvidenceFixtureId,
    projection.recoveryEvidenceTwinStateRevision, projection.recoveryEvidenceTwinOutcomeRevision];
  const unresolvedConflictActionKey = projection.unresolvedTwinConflict !== null
    && typeof projection.unresolvedTwinConflict === 'object'
    && 'actionKey' in projection.unresolvedTwinConflict
    ? projection.unresolvedTwinConflict.actionKey : null;
  if (recoveryEvidenceValues.some((entry) => entry !== null)
    && recoveryEvidenceValues.some((entry) => entry === null)) {
    throw new TypeError('Volume recovery evidence correlation must be wholly present or absent');
  }
  if (projection.recoveryEvidenceActionKey !== null) {
    text(projection.recoveryEvidenceActionKey, 'recovery evidence actionKey', ACTION_KEY);
    text(projection.recoveryEvidenceFixtureId, 'recovery evidence fixtureId');
    if (projection.recoveryEvidenceFixtureId
      !== `l11fixture_${(projection.recoveryEvidenceActionKey as string).slice('l11action_'.length)}`) {
      throw new TypeError('Volume recovery evidence fixture is not intrinsic to its action');
    }
    if (projection.recoveryEvidenceActionKey !== pending?.actionKey
      && projection.recoveryEvidenceActionKey !== lastNoFill?.action.actionKey
      && projection.recoveryEvidenceActionKey !== unresolvedConflictActionKey
      && !projection.recoveryConsumptionHistory.some((record) => (
        record.noFill?.evidenceKind === 'CANONICAL_NO_EFFECT'
        && record.noFill.action.actionKey === projection.recoveryEvidenceActionKey
      ))
      && !settledKeys.has(projection.recoveryEvidenceActionKey as string)) {
      throw new TypeError('Volume recovery evidence action is not retained by the lifecycle');
    }
  }
  if (projection.recoveryEvidenceTwinStateRevision !== null) {
    text(projection.recoveryEvidenceTwinStateRevision, 'recovery evidence twin state revision');
    text(projection.recoveryEvidenceTwinOutcomeRevision, 'recovery evidence twin outcome revision');
  }
  const unresolvedRiskNoFill = lastNoFill?.evidenceKind === 'TWIN_NO_FILL'
    && lastNoFill.recoveryResolutionRevision === null
    && (lastNoFill.action.kind === 'REDUCE' || lastNoFill.action.kind === 'EXIT')
    ? lastNoFill : null;
  if (unresolvedRiskNoFill !== null
    && (projection.state !== 'RECOVERY_REQUIRED'
      || pending !== null
      || (projection.unresolvedTwinConflict === null
        && (projection.recoveryEvidenceActionKey !== unresolvedRiskNoFill.action.actionKey
          || projection.recoveryEvidenceFixtureId !== unresolvedRiskNoFill.fixtureId
          || projection.recoveryEvidenceTwinStateRevision !== unresolvedRiskNoFill.twinStateRevision
          || projection.recoveryEvidenceTwinOutcomeRevision !== unresolvedRiskNoFill.twinOutcomeRevision)))) {
    throw new TypeError('Volume unresolved risk no-fill requires its exact recovery evidence tuple');
  }
  if (projection.pendingTwinStateRevision !== null
    && (projection.recoveryEvidenceActionKey !== pending?.actionKey
      || projection.recoveryEvidenceTwinStateRevision !== projection.pendingTwinStateRevision
      || projection.recoveryEvidenceTwinOutcomeRevision !== projection.pendingTwinOutcomeRevision)) {
    throw new TypeError('Volume pending twin revisions must match their recovery evidence correlation');
  }
  if (projection.unresolvedTwinConflict !== null) {
    const conflict = record(projection.unresolvedTwinConflict, TWIN_CONFLICT_FIELDS,
      'Volume unresolved twin conflict');
    oneOf(conflict.kind, [
      'SIMULTANEOUS_CANONICAL_NO_EFFECT', 'LATE_CANONICAL_NO_EFFECT',
      'SETTLED_TWIN_REPLAY_MISMATCH', 'ORPHAN_TWIN_EVIDENCE', 'TWIN_CHRONOLOGY_INVALID',
      'TWIN_EFFECT_RECONSTRUCTION_REQUIRED',
    ],
      'unresolved twin conflict kind');
    text(conflict.actionKey, 'unresolved twin conflict actionKey', ACTION_KEY);
    text(conflict.fixtureId, 'unresolved twin conflict fixtureId');
    if (conflict.recoveryResolutionRevision !== null) {
      text(conflict.recoveryResolutionRevision, 'unresolved twin conflict recovery resolution revision');
    }
    text(conflict.twinStateRevision, 'unresolved twin conflict state revision');
    text(conflict.twinOutcomeRevision, 'unresolved twin conflict outcome revision');
    volumeDecimal(conflict.filledQuantity, 'unresolved twin conflict filledQuantity');
    text(conflict.conflictRevision, 'unresolved twin conflict revision', TWIN_CONFLICT_REVISION);
    const expectedConflictRevision = digest('l11twinconflict_', {
      lifecycleId: projection.lifecycleId,
      kind: conflict.kind,
      actionKey: conflict.actionKey,
      fixtureId: conflict.fixtureId,
      recoveryResolutionRevision: conflict.recoveryResolutionRevision,
      twinStateRevision: conflict.twinStateRevision,
      twinOutcomeRevision: conflict.twinOutcomeRevision,
      filledQuantity: conflict.filledQuantity,
    });
    const retainedCanonicalNoEffect = conflict.actionKey === lastNoFill?.action.actionKey
      && lastNoFill?.evidenceKind === 'CANONICAL_NO_EFFECT'
      ? lastNoFill : projection.recoveryConsumptionHistory.find((record) => (
        record.noFill?.evidenceKind === 'CANONICAL_NO_EFFECT'
        && record.noFill.action.actionKey === conflict.actionKey
      ))?.noFill ?? null;
    const retainedCanonicalAction = conflict.actionKey === pending?.actionKey
      || retainedCanonicalNoEffect !== null;
    const retainedSettledAction = settledKeys.has(conflict.actionKey as string);
    const retainedEffectSettlement = latestSettled?.actionKey === conflict.actionKey
      && latestSettled.fixtureId === conflict.fixtureId
      && latestSettled.twinStateRevision === conflict.twinStateRevision
      && latestSettled.twinOutcomeRevision === conflict.twinOutcomeRevision
      && latestSettled.settlementState === 'RECOVERY_REQUIRED'
      ? latestSettled : undefined;
    const pendingEffectShape = conflict.actionKey === pending?.actionKey
      && retainedEffectSettlement === undefined
      && projection.pendingTwinStateRevision === conflict.twinStateRevision
      && projection.pendingTwinOutcomeRevision === conflict.twinOutcomeRevision;
    const settledEffectShape = retainedEffectSettlement !== undefined
      && pending === null
      && projection.pendingTwinStateRevision === null
      && projection.pendingTwinOutcomeRevision === null;
    const conflictScopedToPending = conflict.actionKey === pending?.actionKey;
    const conflictKindValid = conflict.kind === 'SIMULTANEOUS_CANONICAL_NO_EFFECT'
      ? conflict.actionKey === pending?.actionKey
        && conflict.recoveryResolutionRevision !== null
        && !projection.consumedRecoveryRevisions.includes(conflict.recoveryResolutionRevision)
      : conflict.kind === 'LATE_CANONICAL_NO_EFFECT'
        ? retainedCanonicalNoEffect !== null
          && conflict.recoveryResolutionRevision === retainedCanonicalNoEffect.recoveryResolutionRevision
      : conflict.kind === 'SETTLED_TWIN_REPLAY_MISMATCH'
        ? retainedSettledAction && conflict.recoveryResolutionRevision === null
        : conflict.kind === 'TWIN_EFFECT_RECONSTRUCTION_REQUIRED'
          ? (settledEffectShape || pendingEffectShape)
            && conflict.recoveryResolutionRevision === null
            && compareVolumeDecimals(conflict.filledQuantity as string, '0') > 0
        : conflict.kind === 'TWIN_CHRONOLOGY_INVALID'
          ? conflict.actionKey === pending?.actionKey && conflict.recoveryResolutionRevision === null
        : !retainedCanonicalAction && !retainedSettledAction
          && conflict.recoveryResolutionRevision === null;
    const effectReconstruction = conflict.kind === 'TWIN_EFFECT_RECONSTRUCTION_REQUIRED';
    const pendingEffectReconstruction = effectReconstruction && pendingEffectShape;
    if (conflict.conflictRevision !== expectedConflictRevision
      || conflict.fixtureId !== `l11fixture_${(conflict.actionKey as string).slice('l11action_'.length)}`
      || conflict.actionKey !== projection.recoveryEvidenceActionKey
      || conflict.fixtureId !== projection.recoveryEvidenceFixtureId
      || conflict.twinStateRevision !== projection.recoveryEvidenceTwinStateRevision
      || conflict.twinOutcomeRevision !== projection.recoveryEvidenceTwinOutcomeRevision
      || (conflictScopedToPending
        && (projection.pendingTwinStateRevision !== conflict.twinStateRevision
          || projection.pendingTwinOutcomeRevision !== conflict.twinOutcomeRevision))
      || (!conflictScopedToPending
        && (projection.pendingTwinStateRevision !== null
          || projection.pendingTwinOutcomeRevision !== null))
      || !conflictKindValid
      || projection.state !== 'RECOVERY_REQUIRED'
      || (!effectReconstruction && projection.positionQuantityTruth !== 'UNKNOWN')
      || (!effectReconstruction && projection.capitalUsageTruth !== 'UNKNOWN')
      || (pendingEffectReconstruction && projection.positionQuantityTruth !== 'UNKNOWN')
      || (pendingEffectReconstruction && projection.capitalUsageTruth !== 'UNKNOWN')) {
      throw new TypeError('Volume unresolved twin conflict is not durably bound to recovery evidence');
    }
  }
  const retainedTwinConflict = projection.unresolvedTwinConflict as Readonly<VolumeUnresolvedTwinConflict> | null;
  if (latestSettled?.settlementState === 'RECOVERY_REQUIRED'
    && (retainedTwinConflict === null
      || retainedTwinConflict.kind !== 'TWIN_EFFECT_RECONSTRUCTION_REQUIRED'
      || retainedTwinConflict.actionKey !== latestSettled.actionKey
      || retainedTwinConflict.fixtureId !== latestSettled.fixtureId
      || retainedTwinConflict.twinStateRevision !== latestSettled.twinStateRevision
      || retainedTwinConflict.twinOutcomeRevision !== latestSettled.twinOutcomeRevision)) {
    throw new TypeError('Volume settled twin recovery effect requires its durable reconstruction conflict');
  }
  const terminalState = projection.state === 'EXIT'
    || (projection.state === 'RECOVERY_REQUIRED' && projection.recoveryResumeState === 'EXIT');
  if (terminalState && projection.terminalOutcomeReasonCodes === null) {
    throw new TypeError('Volume terminal EXIT must retain its outcome reasons');
  }
  if (projection.terminalOutcomeReasonCodes !== null) {
    if (!Array.isArray(projection.terminalOutcomeReasonCodes)
      || projection.terminalOutcomeReasonCodes.length === 0
      || projection.terminalOutcomeReasonCodes.length > 64
      || projection.terminalOutcomeReasonCodes.some((reason) => typeof reason !== 'string' || !ID.test(reason))
      || new Set(projection.terminalOutcomeReasonCodes).size !== projection.terminalOutcomeReasonCodes.length) {
      throw new TypeError('Volume terminal outcome reasons must be bounded and unique');
    }
    if (projection.state !== 'EXIT'
      && !(projection.state === 'RECOVERY_REQUIRED' && projection.recoveryResumeState === 'EXIT')) {
      throw new TypeError('Volume terminal outcome reasons are confined to EXIT or its recovery');
    }
  }
  if (projection.feedbackOutcomeRevision !== null) {
    text(projection.feedbackOutcomeRevision, 'feedbackOutcomeRevision', FEEDBACK_REVISION);
    if (projection.terminalOutcomeReasonCodes === null) {
      throw new TypeError('Volume feedback revision requires retained terminal outcome reasons');
    }
    const expectedFeedback = digest('l11feedback_', {
      lifecycleId: projection.lifecycleId,
      policyRevision: projection.policyRevision,
      reasonCodes: projection.terminalOutcomeReasonCodes,
      twinOutcomeRevision: projection.lastTwinOutcomeRevision,
      positionQuantity: projection.positionQuantity,
    });
    if (projection.feedbackOutcomeRevision !== expectedFeedback) {
      throw new TypeError('Volume feedback revision does not match retained terminal outcome truth');
    }
  }
  const transition = record(projection.lastTransition, TRANSITION_FIELDS, 'Volume last transition');
  if (transition.from !== null) oneOf(transition.from, ['PROBE', 'CONFIRM', 'ADD_ALLOWED', 'HOLD', 'REDUCE', 'EXIT', 'RECOVERY_REQUIRED'], 'transition from');
  oneOf(transition.to, ['PROBE', 'CONFIRM', 'ADD_ALLOWED', 'HOLD', 'REDUCE', 'EXIT', 'RECOVERY_REQUIRED'], 'transition to');
  text(transition.primaryReasonCode, 'transition primary reason');
  if (!Array.isArray(transition.reasonCodes) || transition.reasonCodes.length === 0
    || transition.reasonCodes.length > 256
    || transition.reasonCodes.some((reason) => typeof reason !== 'string' || !ID.test(reason))
    || new Set(transition.reasonCodes).size !== transition.reasonCodes.length
    || transition.reasonCodes[0] !== transition.primaryReasonCode) {
    throw new TypeError('transition reasonCodes must be bounded, unique, and primary-first');
  }
  const conflictTransitionReasons = new Set([
    'CANONICAL_RECOVERY_TWIN_EVIDENCE_CONFLICT',
    'CANONICAL_RECOVERY_TWIN_EVIDENCE_UNRESOLVED',
    'CANONICAL_NO_EFFECT_LATE_TWIN_CONFLICT',
    'LATE_TWIN_EVIDENCE_REQUIRES_RECONCILIATION',
    'SETTLED_TWIN_REPLAY_MISMATCH',
    'ORPHAN_TWIN_EVIDENCE',
    'TWIN_CHRONOLOGY_INVALID',
    'TWIN_EFFECT_RECONSTRUCTION_REQUIRED',
    'TWIN_POSITION_RECONSTRUCTION_REQUIRED',
    'TWIN_CAPITAL_RECONSTRUCTION_REQUIRED',
    'UNRESOLVED_TWIN_CONFLICT_REQUIRES_RECONSTRUCTION',
  ]);
  if ((transition.reasonCodes as unknown[]).some((reason) => conflictTransitionReasons.has(reason as string))
    && projection.unresolvedTwinConflict === null) {
    throw new TypeError('Volume conflict-class recovery transition requires its durable twin conflict');
  }
  if (projection.unresolvedTwinConflict !== null) {
    const retainedKind = (projection.unresolvedTwinConflict as { kind: string }).kind;
    const expectedReason = retainedKind === 'SIMULTANEOUS_CANONICAL_NO_EFFECT'
      ? ['CANONICAL_RECOVERY_TWIN_EVIDENCE_CONFLICT', 'CANONICAL_RECOVERY_TWIN_EVIDENCE_UNRESOLVED']
      : retainedKind === 'LATE_CANONICAL_NO_EFFECT'
        ? ['CANONICAL_NO_EFFECT_LATE_TWIN_CONFLICT', 'LATE_TWIN_EVIDENCE_REQUIRES_RECONCILIATION']
        : retainedKind === 'SETTLED_TWIN_REPLAY_MISMATCH' ? ['SETTLED_TWIN_REPLAY_MISMATCH']
          : retainedKind === 'ORPHAN_TWIN_EVIDENCE' ? ['ORPHAN_TWIN_EVIDENCE']
            : retainedKind === 'TWIN_CHRONOLOGY_INVALID' ? ['TWIN_CHRONOLOGY_INVALID']
              : ['TWIN_EFFECT_RECONSTRUCTION_REQUIRED'];
    if (!expectedReason.some((reason) => (transition.reasonCodes as unknown[]).includes(reason))) {
      throw new TypeError('Volume durable twin conflict kind does not match its recovery transition');
    }
    if (retainedKind === 'TWIN_EFFECT_RECONSTRUCTION_REQUIRED'
      && (((transition.reasonCodes as unknown[]).includes('TWIN_POSITION_RECONSTRUCTION_REQUIRED')
          && projection.positionQuantityTruth !== 'UNKNOWN')
        || ((transition.reasonCodes as unknown[]).includes('TWIN_CAPITAL_RECONSTRUCTION_REQUIRED')
          && projection.capitalUsageTruth !== 'UNKNOWN'))) {
      throw new TypeError('Volume twin effect reconstruction truth flags do not match its recovery reasons');
    }
  }
  timestamp(transition.occurredAtMs, 'transition occurredAtMs');
  if ((projection.openedAtMs !== null
      && (projection.openedAtMs as number) > (transition.occurredAtMs as number))
    || (projection.stageEnteredAtMs as number) > (transition.occurredAtMs as number)) {
    throw new TypeError('Volume lifecycle chronology cannot postdate the retained transition');
  }
  if (projection.lastRecoveryResolvedAtMs !== null
    && (projection.lastRecoveryResolvedAtMs as number) > (transition.occurredAtMs as number)) {
    throw new TypeError('Volume recovery resolution time cannot postdate the lifecycle transition');
  }
  if ((projection.lastMarketObservedAtMs !== null
      && (projection.lastMarketObservedAtMs as number) > (transition.occurredAtMs as number))
    || (projection.lastSignalObservedAtMs !== null
      && (projection.lastSignalObservedAtMs as number) > (transition.occurredAtMs as number))) {
    throw new TypeError('Volume retained observation cannot postdate the lifecycle transition');
  }
  if ((lastNoFill !== null && lastNoFill.action.plannedAtMs > (transition.occurredAtMs as number))
    || projection.recoveryConsumptionHistory.some((consumption) => (
      consumption.noFill !== null
      && consumption.noFill.action.plannedAtMs > (transition.occurredAtMs as number)
    ))) {
    throw new TypeError('Volume no-fill action cannot postdate the retained lifecycle transition');
  }
  stringArray(transition.evidenceIds, 'transition evidenceIds');
  if (transition.twinOutcomeRevision !== null) text(transition.twinOutcomeRevision, 'transition twin outcome');
  if (projection.state === 'RECOVERY_REQUIRED'
    && transition.twinOutcomeRevision !== projection.recoveryEvidenceTwinOutcomeRevision) {
    throw new TypeError('Volume recovery evidence outcome must bind the recovery transition');
  }
  const effectiveProjectionState = projection.state === 'RECOVERY_REQUIRED'
    ? projection.recoveryResumeState : projection.state;
  if (effectiveProjectionState !== 'EXIT'
    && (projection.openedAtMs === null) !== (projection.positionQuantity === '0')) {
    throw new TypeError('Volume opened lifecycle and retained exposure must advance together');
  }
  const requiresRetainedExposure = effectiveProjectionState === 'CONFIRM'
    || effectiveProjectionState === 'ADD_ALLOWED'
    || effectiveProjectionState === 'HOLD'
    || effectiveProjectionState === 'REDUCE';
  if (requiresRetainedExposure && projection.positionQuantity === '0') {
    throw new TypeError('Volume active staged state requires retained exposure');
  }
  if (transition.to !== projection.state) throw new TypeError('Volume lifecycle transition must end at the projected state');
  if (projection.state === 'EXIT'
    && canonicalJson(projection.terminalOutcomeReasonCodes) !== canonicalJson(transition.reasonCodes)) {
    throw new TypeError('Volume terminal outcome reasons must match the terminal transition');
  }
  if (projection.state === 'RECOVERY_REQUIRED') {
    if (projection.recoveryResumeState === null) throw new TypeError('Volume recovery projection must retain an exact resume state');
  } else if (projection.recoveryResumeState !== null) {
    throw new TypeError('Volume non-recovery projection cannot retain a recovery resume state');
  }
  if (projection.state !== 'RECOVERY_REQUIRED'
    && (projection.recoveryEvidenceActionKey !== null
      || projection.recoveryEvidenceFixtureId !== null
      || projection.recoveryEvidenceTwinStateRevision !== null
      || projection.recoveryEvidenceTwinOutcomeRevision !== null)) {
    throw new TypeError('Volume recovery evidence correlation is confined to recovery');
  }
  if (projection.openedAtMs === null && projection.positionQuantity !== '0') {
    throw new TypeError('Volume lifecycle cannot carry exposure before an observed opening fill');
  }
  if (!emptyEntryCostBasis
    && compareVolumeDecimals(
      projection.positionQuantity as string,
      projection.entryCostBasisQuantity as string,
    ) > 0) {
    throw new TypeError('Volume projected position cannot exceed its exact entry cost-basis quantity');
  }
  if (compareVolumeDecimals(projection.positionQuantity as string, '0') > 0
    && (projection.entryAveragePrice === null || projection.favorableExtremePrice === null)) {
    throw new TypeError('Volume active exposure must retain entry and favorable-extreme protection truth');
  }
  if (projection.favorableExtremePrice !== null
    && ((projection.direction === 'LONG'
      && compareVolumeDecimals(
        projection.favorableExtremePrice as string,
        projection.currentPrice as string,
      ) < 0)
      || (projection.direction === 'SHORT'
        && compareVolumeDecimals(
          projection.favorableExtremePrice as string,
          projection.currentPrice as string,
        ) > 0))) {
    throw new TypeError('Volume favorable extreme cannot be worse than the retained current price');
  }
  if (projection.state === 'EXIT' && (projection.positionQuantity !== '0' || pending !== null
    || projection.positionQuantityTruth !== 'EXACT')) {
    throw new TypeError('Volume terminal EXIT cannot retain exposure or a pending action');
  }
  if (projection.state === 'RECOVERY_REQUIRED' && projection.recoveryResumeState === 'EXIT'
    && (projection.positionQuantity !== '0' || pending !== null)) {
    throw new TypeError('Volume terminal recovery cannot retain projected exposure or a pending action');
  }
  if (pending !== null) {
    if (pending.lifecycleId !== projection.lifecycleId
      || pending.projectionRevision !== projection.pendingActionBaseProjectionRevision
      || pending.positionBeforeQuantity !== projection.positionQuantity
      || pending.symbol !== projection.symbol
      || pending.direction !== projection.direction
      || pending.accountRealmId !== projection.accountRealmId
      || pending.baseAsset !== projection.baseAsset
      || pending.quoteAsset !== projection.quoteAsset
      || pending.mandateUsageBeforeQuote !== projection.projectedMandateUsageQuote
      || pending.proposalId !== projection.proposalId
      || pending.proposalRevision !== projection.proposalRevision
      || pending.proposalDigest !== projection.proposalDigest
      || pending.assessmentId !== projection.assessmentId
      || pending.assessmentRevision !== projection.assessmentRevision
      || pending.assessmentFingerprintSha256 !== projection.assessmentFingerprintSha256
      || pending.modelRevision !== projection.advisoryModelRevision
      || pending.featureRevision !== projection.featureRevision
      || pending.evidenceRevision !== projection.evidenceRevision
      || pending.exitPlanRevision !== projection.exitPlanRevision
      || pending.entryEvidenceRevision !== projection.entryEvidenceRevision
      || pending.instrumentRevision !== projection.entryInstrumentRevision
      || pending.filterRevision !== projection.entryFilterRevision
      || pending.sourceEvidenceRevision !== projection.entrySourceEvidenceRevision
      || pending.capitalMandateId !== projection.capitalMandateId
      || pending.capitalMandateRevision !== projection.capitalMandateRevision
      || pending.capitalMandateDigest !== projection.capitalMandateDigest
      || pending.capitalReservationId !== projection.capitalReservationId
      || pending.capitalReservationRevision !== projection.capitalReservationRevision
      || pending.capitalMaximumQuote !== projection.capitalMaximumQuote) {
      throw new TypeError('Volume pending action is not bound to its lifecycle projection');
    }
    if (pending.kind !== 'ADD'
      && (pending.inventoryMode !== projection.entryInventoryMode
        || pending.availableBaseQuantity !== projection.entryAvailableBaseQuantity
        || pending.inventoryRevision !== projection.entryInventoryRevision
        || pending.inventoryAsset !== projection.entryInventoryAsset
        || pending.inventoryAccountRealmId !== projection.entryInventoryAccountRealmId
        || pending.inventoryObservedAtMs !== projection.entryInventoryObservedAtMs
        || pending.inventoryValidUntilMs !== projection.entryInventoryValidUntilMs)) {
      throw new TypeError('Volume pending action inventory is not bound to entry provenance');
    }
    if (projection.positionQuantityTruth !== 'EXACT' && projection.state !== 'RECOVERY_REQUIRED') {
      throw new TypeError('Volume pending action requires exact position quantity truth');
    }
    if (pending.policyRevision !== projection.policyRevision) {
      throw new TypeError('Volume pending action policy does not match the lifecycle projection');
    }
    const effectiveState = projection.state === 'RECOVERY_REQUIRED'
      ? projection.recoveryResumeState : projection.state;
    const increasingSide = projection.direction === 'LONG' ? 'BUY' : 'SELL';
    const reducingSide = projection.direction === 'LONG' ? 'SELL' : 'BUY';
    if ((pending.kind === 'ENTRY' || pending.kind === 'ADD')
      && (pending.triggerEpisodeRevision !== null || pending.triggerReasonCodes.length !== 0)) {
      throw new TypeError('Volume increasing action cannot claim reduction or exit triggers');
    }
    if ((pending.kind === 'REDUCE' || pending.kind === 'EXIT')
      && projection.state !== 'RECOVERY_REQUIRED'
      && canonicalJson(pending.triggerReasonCodes) !== canonicalJson(transition.reasonCodes)) {
      throw new TypeError('Volume risk-reduction action triggers must match its planning transition');
    }
    if (pending.kind === 'EXIT'
      && (pending.triggerEpisodeRevision !== null || pending.triggerReasonCodes.length === 0)) {
      throw new TypeError('Volume EXIT action must retain non-episode exit triggers');
    }
    if (pending.plannedAtMs > (transition.occurredAtMs as number)) {
      throw new TypeError('Volume pending action is planned after its lifecycle transition');
    }
    if (pending.kind === 'ENTRY') {
      if (pending.stageFrom !== null || effectiveState !== 'PROBE' || pending.stageTo !== 'PROBE'
        || pending.riskActionClass !== 'OPEN' || pending.side !== increasingSide
        || pending.approvalId === null || pending.approvalRevision === null
        || projection.openedAtMs !== null || projection.positionQuantity !== '0') {
        throw new TypeError('Volume pending ENTRY has an impossible lifecycle state');
      }
    } else {
      if (pending.stageFrom !== effectiveState || projection.openedAtMs === null
        || projection.positionQuantity === '0') {
        throw new TypeError('Volume pending action stage does not match active exposure');
      }
      if (pending.kind === 'ADD' && (pending.riskActionClass !== 'ADD'
        || pending.side !== increasingSide
        || pending.approvalId === null || pending.approvalRevision === null
        || !((effectiveState === 'PROBE' && pending.stageTo === 'CONFIRM')
          || (effectiveState === 'ADD_ALLOWED' && pending.stageTo === 'HOLD')))) {
        throw new TypeError('Volume pending ADD has impossible direction or stages');
      }
      if (pending.kind === 'REDUCE' && (pending.riskActionClass !== 'REDUCE'
        || pending.side !== reducingSide || pending.stageTo !== 'REDUCE'
        || compareVolumeDecimals(pending.requestedQuantity, projection.positionQuantity as string) > 0)) {
        throw new TypeError('Volume pending REDUCE has impossible direction, stages, or quantity');
      }
      if (pending.kind === 'EXIT' && (pending.riskActionClass !== 'EXIT'
        || pending.side !== reducingSide || pending.stageTo !== 'EXIT'
        || pending.requestedQuantity !== projection.positionQuantity)) {
        throw new TypeError('Volume pending EXIT has impossible direction, stages, or quantity');
      }
    }
    if ((pending.kind === 'ENTRY' || pending.kind === 'ADD')
      && Array.isArray(projection.entrySizingCuts)) {
      const retainedCutValue = projection.entrySizingCuts.find((candidate) => {
        const cut = candidate as { targetState?: unknown };
        return cut.targetState === pending?.stageTo;
      });
      if (retainedCutValue === undefined) {
        throw new TypeError('Volume increasing action has no retained sizing cut');
      }
      const retainedCut = record(retainedCutValue, SIZING_CUT_FIELDS, 'Volume pending action retained sizing cut');
      const lifecycleUsageBefore = subtractVolumeDecimals(
        projection.projectedMandateUsageQuote as string,
        projection.mandateUsageAtLifecycleStartQuote as string,
      );
      const expectedQuantity = subtractVolumeDecimals(
        retainedCut.cumulativeQuantity as string,
        projection.positionQuantity as string,
      );
      const expectedMaximumNotional = subtractVolumeDecimals(
        retainedCut.cumulativeNotionalQuote as string,
        lifecycleUsageBefore,
      );
      const expectedUsageAfter = addVolumeDecimals(
        projection.projectedMandateUsageQuote as string,
        expectedMaximumNotional,
      );
      if (pending.requestedQuantity !== expectedQuantity
        || pending.priceBound !== retainedCut.priceBound
        || pending.maximumNotionalQuote !== expectedMaximumNotional
        || pending.mandateUsageAfterQuote !== expectedUsageAfter
        || compareVolumeDecimals(expectedUsageAfter, projection.capitalMaximumQuote as string) > 0) {
        throw new TypeError('Volume increasing action does not match its retained sizing cut');
      }
    }
    if ((pending.kind === 'REDUCE' || pending.kind === 'EXIT')
      && (pending.mandateUsageAfterQuote !== pending.mandateUsageBeforeQuote
        || pending.maximumNotionalQuote !== multiplyVolumeDecimals(
          pending.requestedQuantity,
          pending.priceBound,
        ))) {
      throw new TypeError('Volume risk-reduction action has invalid quantity/notional usage');
    }
    if (pending.kind === 'REDUCE'
      && (projection.reductionTargetQuantity === null
        || pending.requestedQuantity !== subtractVolumeDecimals(
          projection.positionQuantity as string,
          projection.reductionTargetQuantity as string,
        ))) {
      throw new TypeError('Volume pending REDUCE quantity does not match its retained episode target');
    }
  }
  const expectedEntryEvidence = deriveVolumeEntryEvidenceRevision(projection);
  if (projection.entryEvidenceRevision !== expectedEntryEvidence) {
    throw new TypeError('Volume lifecycle entry evidence revision does not match persisted provenance');
  }
  const clone = snapshot(projection) as unknown as VolumeLifecycleProjection;
  const { projectionRevision, ...semantic } = clone;
  const expected = digest('l11projection_', projectionMaterial(semantic));
  if (projectionRevision !== expected) throw new TypeError('Volume lifecycle projection revision does not match content');
  return deepFreeze(clone);
}

function validateProposal(value: unknown): void {
  const proposal = record(value, PROPOSAL_FIELDS, 'Volume proposal projection');
  if (proposal.owner !== 'VOLUME_ENGINE' || proposal.strategy !== 'VOLUME') throw new TypeError('Volume proposal owner is invalid');
  text(proposal.proposalId, 'proposalId');
  text(proposal.correlationId, 'correlationId');
  text(proposal.proposalRevision, 'proposalRevision');
  text(proposal.proposalDigest, 'proposalDigest');
  text(proposal.symbol, 'symbol', SYMBOL);
  oneOf(proposal.direction, ['LONG', 'SHORT'], 'proposal direction');
  oneOf(proposal.status, ['OPEN', 'UPDATED', 'EXPIRED', 'REJECTED'], 'proposal status');
  oneOf(proposal.entryKind, ['CONTINUATION', 'FADE'], 'entry kind');
  oneOf(proposal.marketStage, ['EMERGING', 'CONFIRMED', 'EXHAUSTED', 'UNKNOWN'], 'proposal market stage');
  for (const field of ['createdAtMs', 'observedAtMs', 'expiresAtMs'] as const) timestamp(proposal[field], field);
  text(proposal.featureRevision, 'proposal featureRevision');
  text(proposal.evidenceRevision, 'proposal evidenceRevision');
  text(proposal.exitPlanRevision, 'proposal exitPlanRevision');
  stringArray(proposal.invalidationConditions, 'proposal invalidationConditions', false);
  stringArray(proposal.evidenceIds, 'proposal evidenceIds', false);
}

function validateAdvisory(value: unknown): void {
  const advisory = record(value, ADVISORY_FIELDS, 'Volume advisory projection');
  if (advisory.owner !== 'EDGE_ASSESSMENT_BRIDGE' || advisory.strategyFamily !== 'VOLUME_WAKEUP') {
    throw new TypeError('Volume advisory owner is invalid');
  }
  oneOf(advisory.state, ['OBSERVED', 'REJECTED', 'UNKNOWN'], 'advisory state');
  oneOf(advisory.advisoryAction, ['PROPOSE_CONSIDERATION', 'ABSTAIN', 'BLOCK'], 'advisory action');
  if (advisory.ownerReference !== null) text(advisory.ownerReference, 'advisory ownerReference');
  text(advisory.assessmentId, 'assessmentId');
  integer(advisory.assessmentRevision, 1, Number.MAX_SAFE_INTEGER, 'assessmentRevision');
  text(advisory.assessmentFingerprintSha256, 'assessment fingerprint', HASH64);
  text(advisory.modelRevision, 'modelRevision');
  text(advisory.featureRevision, 'advisory featureRevision');
  text(advisory.evidenceRevision, 'advisory evidenceRevision');
  for (const field of ['observedAtMs', 'expiresAtMs', 'economicExpiresAtMs'] as const) timestamp(advisory[field], field);
  oneOf(advisory.sourceQuality, ['COMPLETE', 'PARTIAL', 'STALE', 'UNKNOWN'], 'advisory sourceQuality');
  oneOf(advisory.stage, ['EMERGING', 'CONFIRMED', 'EXHAUSTED', 'FADE', 'UNKNOWN'], 'advisory stage');
  oneOf(advisory.exhaustion, ['PRESENT', 'ABSENT', 'UNKNOWN'], 'advisory exhaustion');
  oneOf(advisory.reversal, ['PRESENT', 'ABSENT', 'UNKNOWN'], 'advisory reversal');
  if (typeof advisory.fadeEligible !== 'boolean') throw new TypeError('fadeEligible must be boolean');
  stringArray(advisory.evidenceIds, 'advisory evidenceIds', false);
}

function validateAuthority(value: unknown): void {
  const authority = record(value, AUTHORITY_FIELDS, 'Volume owner authority projection');
  if (authority.evidenceKind !== 'SYNTHETIC_OWNER_FIXTURE'
    || authority.executionReady !== false || authority.capitalAuthority !== 'SYNTHETIC_CAPITAL_FIXTURE'
    || authority.riskAuthority !== 'SYNTHETIC_FOUNDATION_FIXTURE'
    || authority.actionAuthority !== 'NONE_RECORD_ONLY' || authority.externalActionAuthorization !== 'NONE') {
    throw new TypeError('Volume owner authority projection crosses the hard boundary');
  }
  oneOf(authority.systemMode, ['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY'], 'systemMode');
  oneOf(authority.capitalState, ['ACTIVE', 'BLOCKED', 'UNKNOWN'], 'capitalState');
  text(authority.capitalMandateId, 'capitalMandateId');
  integer(authority.capitalMandateRevision, 1, Number.MAX_SAFE_INTEGER, 'capitalMandateRevision');
  text(authority.capitalMandateDigest, 'capitalMandateDigest');
  text(authority.capitalReservationId, 'capitalReservationId');
  integer(authority.capitalReservationRevision, 1, Number.MAX_SAFE_INTEGER, 'capitalReservationRevision');
  positiveVolumeDecimal(authority.capitalMaximumQuote, 'capitalMaximumQuote');
  volumeDecimal(authority.capitalConsumedQuote, 'capitalConsumedQuote');
  timestamp(authority.capitalExpiresAtMs, 'capitalExpiresAtMs');
  oneOf(authority.riskState, ['ALLOWED', 'BLOCKED', 'UNKNOWN'], 'riskState');
  oneOf(authority.riskActionClass, ['OPEN', 'ADD', 'REDUCE', 'EXIT', 'RECOVERY'], 'riskActionClass');
  text(authority.riskVerdictId, 'riskVerdictId');
  text(authority.riskVerdictRevision, 'riskVerdictRevision');
  text(authority.riskVerdictDigest, 'riskVerdictDigest');
  timestamp(authority.riskEvaluatedAtMs, 'riskEvaluatedAtMs');
  timestamp(authority.riskExpiresAtMs, 'riskExpiresAtMs');
  if (authority.riskBoundLifecycleId !== null) text(authority.riskBoundLifecycleId, 'riskBoundLifecycleId');
  if (authority.riskBoundProjectionRevision !== null) {
    text(authority.riskBoundProjectionRevision, 'riskBoundProjectionRevision', CONTENT_REVISION);
  }
  volumeDecimal(authority.riskBoundPositionQuantity, 'riskBoundPositionQuantity');
  text(authority.riskContextRevision, 'riskContextRevision', RISK_CONTEXT_REVISION);
  oneOf(authority.approvalState, ['VALIDATE_ONLY', 'MISSING', 'EXPIRED', 'REVOKED'], 'approvalState');
  if (authority.approvalId !== null) text(authority.approvalId, 'approvalId');
  if (authority.approvalRevision !== null) integer(authority.approvalRevision, 1, Number.MAX_SAFE_INTEGER, 'approvalRevision');
  if (authority.approvalExpiresAtMs !== null) timestamp(authority.approvalExpiresAtMs, 'approvalExpiresAtMs');
  oneOf(authority.accountTruth, ['COMPLETE', 'PARTIAL', 'STALE', 'UNKNOWN'], 'accountTruth');
  oneOf(authority.positionTruth, ['COMPLETE', 'PARTIAL', 'STALE', 'UNKNOWN'], 'positionTruth');
}

function validateSizing(value: unknown): void {
  const sizing = record(value, SIZING_FIELDS, 'Volume sizing projection');
  if (sizing.owner !== 'L04_BINANCE_INSTRUMENT_SPECS') throw new TypeError('Volume sizing owner is invalid');
  oneOf(sizing.state, ['READY', 'UNAVAILABLE', 'STALE', 'UNKNOWN'], 'sizing state');
  if (sizing.product !== 'SPOT') throw new TypeError('Volume sizing is Spot-only');
  text(sizing.symbol, 'sizing symbol', SYMBOL);
  text(sizing.baseAsset, 'sizing baseAsset', SYMBOL);
  text(sizing.quoteAsset, 'sizing quoteAsset', SYMBOL);
  text(sizing.accountRealmId, 'sizing accountRealmId');
  text(sizing.instrumentRevision, 'instrumentRevision');
  text(sizing.filterRevision, 'filterRevision');
  text(sizing.sourceEvidenceRevision, 'sourceEvidenceRevision');
  timestamp(sizing.observedAtMs, 'sizing observedAtMs');
  timestamp(sizing.validUntilMs, 'sizing validUntilMs');
  oneOf(sizing.inventoryMode, ['QUOTE_FUNDED_LONG', 'PREOWNED_BASE_SHORT'], 'inventoryMode');
  if (sizing.availableBaseQuantity !== null) volumeDecimal(sizing.availableBaseQuantity, 'availableBaseQuantity');
  if (sizing.inventoryRevision !== null) text(sizing.inventoryRevision, 'inventoryRevision');
  if (sizing.inventoryAsset !== null) text(sizing.inventoryAsset, 'inventoryAsset', SYMBOL);
  if (sizing.inventoryAccountRealmId !== null) text(sizing.inventoryAccountRealmId, 'inventoryAccountRealmId');
  if (sizing.inventoryObservedAtMs !== null) timestamp(sizing.inventoryObservedAtMs, 'inventoryObservedAtMs');
  if (sizing.inventoryValidUntilMs !== null) timestamp(sizing.inventoryValidUntilMs, 'inventoryValidUntilMs');
  const inventoryValues = [sizing.availableBaseQuantity, sizing.inventoryRevision, sizing.inventoryAsset,
    sizing.inventoryAccountRealmId, sizing.inventoryObservedAtMs, sizing.inventoryValidUntilMs];
  if (inventoryValues.some((entry) => entry !== null) && inventoryValues.some((entry) => entry === null)) {
    throw new TypeError('Volume inventory proof must be wholly present or absent');
  }
  if (!Array.isArray(sizing.cuts) || sizing.cuts.length !== 3) throw new TypeError('Volume sizing requires three stage cuts');
  const states: string[] = [];
  for (const candidate of sizing.cuts) {
    const cut = record(candidate, SIZING_CUT_FIELDS, 'Volume sizing cut');
    states.push(oneOf(cut.targetState, ['PROBE', 'CONFIRM', 'HOLD'], 'sizing targetState'));
    positiveVolumeDecimal(cut.cumulativeQuantity, 'cumulativeQuantity');
    positiveVolumeDecimal(cut.cumulativeNotionalQuote, 'cumulativeNotionalQuote');
    positiveVolumeDecimal(cut.priceBound, 'sizing priceBound');
  }
  if (canonicalJson(states) !== canonicalJson(['PROBE', 'CONFIRM', 'HOLD'])) {
    throw new TypeError('Volume sizing cuts must be PROBE, CONFIRM, HOLD in order');
  }
}

function validateMarket(value: unknown): void {
  const market = record(value, MARKET_FIELDS, 'Volume market projection');
  oneOf(market.truth, ['COMPLETE', 'PARTIAL', 'STALE', 'UNKNOWN'], 'market truth');
  timestamp(market.observedAtMs, 'market observedAtMs');
  timestamp(market.validUntilMs, 'market validUntilMs');
  for (const field of ['currentPrice', 'intendedPriceBound', 'riskReductionPriceBound'] as const) positiveVolumeDecimal(market[field], field);
  for (const field of ['intendedDepthQuote', 'minimumDepthQuote', 'expectedCostQuote', 'expectedDownsideQuote'] as const) {
    volumeDecimal(market[field], field);
  }
  integer(market.spreadBps, 0, 1_000_000, 'spreadBps');
  integer(market.maximumSpreadBps, 0, 1_000_000, 'maximumSpreadBps');
  text(market.bookRevision, 'bookRevision');
  text(market.costRevision, 'costRevision');
  text(market.downsideRevision, 'downsideRevision');
  stringArray(market.evidenceIds, 'market evidenceIds', false);
}

function validateSignals(value: unknown): void {
  const signals = record(value, SIGNAL_FIELDS, 'Volume lifecycle signals');
  if (signals.thesisInvalidated !== null && typeof signals.thesisInvalidated !== 'boolean') {
    throw new TypeError('thesisInvalidated must be boolean or null');
  }
  oneOf(signals.exhaustion, ['PRESENT', 'ABSENT', 'UNKNOWN'], 'signals exhaustion');
  oneOf(signals.reversal, ['PRESENT', 'ABSENT', 'UNKNOWN'], 'signals reversal');
  oneOf(signals.confirmation, ['CONFIRMED', 'PENDING', 'FAILED', 'UNKNOWN'], 'signals confirmation');
  oneOf(signals.addPermission, ['ALLOWED', 'BLOCKED', 'UNKNOWN'], 'signals addPermission');
  if (typeof signals.manualClose !== 'boolean' || typeof signals.globalHalt !== 'boolean') {
    throw new TypeError('manualClose/globalHalt must be boolean');
  }
  oneOf(signals.sourceState, ['HEALTHY', 'DEGRADED', 'STALE', 'UNKNOWN'], 'sourceState');
  oneOf(signals.spreadDepthState, ['HEALTHY', 'DETERIORATED', 'UNKNOWN'], 'spreadDepthState');
  oneOf(signals.reconciliationState, ['EXACT', 'MISMATCH', 'UNKNOWN'], 'reconciliationState');
  oneOf(signals.recoveryDisposition, ['PENDING', 'RESOLVED', 'MANUAL', 'UNKNOWN'], 'recoveryDisposition');
  oneOf(signals.recoveryOutcome, ['NONE', 'NO_EFFECT', 'POSITION_RECONSTRUCTION_REQUIRED', 'UNKNOWN'], 'recoveryOutcome');
  if (signals.recoveryRevision !== null) text(signals.recoveryRevision, 'recoveryRevision');
  positiveVolumeDecimal(signals.currentPrice, 'signals currentPrice');
  timestamp(signals.observedAtMs, 'signals observedAtMs');
  timestamp(signals.validUntilMs, 'signals validUntilMs');
  stringArray(signals.evidenceIds, 'signals evidenceIds', false);
}

function validateOccupancy(value: unknown): void {
  const occupancy = record(value, OCCUPANCY_FIELDS, 'Volume occupancy projection');
  if (occupancy.owner !== 'CANONICAL_POSITION_TICKET_JOURNAL_PROJECTION') throw new TypeError('Volume occupancy owner is invalid');
  oneOf(occupancy.truth, ['COMPLETE', 'PARTIAL', 'STALE', 'UNKNOWN'], 'occupancy truth');
  timestamp(occupancy.observedAtMs, 'occupancy observedAtMs');
  timestamp(occupancy.validUntilMs, 'occupancy validUntilMs');
  if (!Array.isArray(occupancy.activeRecords) || occupancy.activeRecords.length > 128
    || !Array.isArray(occupancy.priorActions) || occupancy.priorActions.length > 512) {
    throw new RangeError('Volume occupancy collections are overbound');
  }
  const activeKeys = new Set<string>();
  for (const candidate of occupancy.activeRecords) {
    const active = record(candidate, OCCUPANCY_RECORD_FIELDS, 'Volume occupancy record');
    text(active.recordId, 'occupancy recordId');
    text(active.recordRevision, 'occupancy recordRevision');
    if (active.projectionRevision !== null) {
      text(active.projectionRevision, 'occupancy projectionRevision', CONTENT_REVISION);
    }
    oneOf(active.kind, ['POSITION', 'TICKET'], 'occupancy kind');
    text(active.lifecycleId, 'occupancy lifecycleId');
    text(active.proposalId, 'occupancy proposalId');
    text(active.assessmentId, 'occupancy assessmentId');
    text(active.symbol, 'occupancy symbol', SYMBOL);
    oneOf(active.direction, ['LONG', 'SHORT'], 'occupancy direction');
    text(active.ownerFamily, 'occupancy ownerFamily');
    oneOf(active.state, ['ACTIVE', 'RECOVERY_REQUIRED', 'CLOSED'], 'occupancy state');
    if (active.ownerFamily === 'VOLUME_LIFECYCLE_ADAPTER' && active.projectionRevision === null) {
      throw new TypeError('Volume-owned occupancy record requires an exact projection revision');
    }
    if (active.positionQuantity !== null) volumeDecimal(active.positionQuantity, 'occupancy positionQuantity');
    if (active.intentKey !== null) text(active.intentKey, 'occupancy intentKey', INTENT_KEY);
    if (active.actionKey !== null) text(active.actionKey, 'occupancy actionKey', ACTION_KEY);
    if (active.kind === 'POSITION' && (active.positionQuantity === null || active.intentKey !== null || active.actionKey !== null)) {
      throw new TypeError('Volume POSITION occupancy record has invalid kind-specific fields');
    }
    if (active.kind === 'TICKET' && (active.positionQuantity !== null || active.intentKey === null || active.actionKey === null)) {
      throw new TypeError('Volume TICKET occupancy record has invalid kind-specific fields');
    }
    const key = active.recordId as string;
    if (activeKeys.has(key)) throw new TypeError('Volume occupancy record is duplicated');
    activeKeys.add(key);
  }
  const actionKeys = new Set<string>();
  for (const candidate of occupancy.priorActions) {
    const prior = record(candidate, PRIOR_ACTION_FIELDS, 'Volume prior action');
    text(prior.actionKey, 'prior actionKey', ACTION_KEY);
    text(prior.intentKey, 'prior intentKey', INTENT_KEY);
    text(prior.lifecycleId, 'prior lifecycleId');
    text(prior.proposalId, 'prior proposalId');
    text(prior.assessmentId, 'prior assessmentId');
    text(prior.symbol, 'prior symbol', SYMBOL);
    oneOf(prior.direction, ['LONG', 'SHORT'], 'prior direction');
    oneOf(prior.kind, ['ENTRY', 'ADD', 'REDUCE', 'EXIT'], 'prior action kind');
    oneOf(prior.state, ['PLANNED', 'APPLIED', 'TERMINAL'], 'prior action state');
    timestamp(prior.recordedAtMs, 'prior recordedAtMs');
    if (actionKeys.has(prior.actionKey as string)) throw new TypeError('Volume prior action key is duplicated');
    actionKeys.add(prior.actionKey as string);
  }
}

export function validateVolumeOccupancyProjection(value: unknown): Readonly<VolumeOccupancyProjection> {
  const cloned = snapshot(value);
  validateOccupancy(cloned);
  return deepFreeze(cloned as VolumeOccupancyProjection);
}

export function validateLifecycleInput(value: unknown): Readonly<VolumeLifecycleInput> {
  const cloned = snapshot(value);
  const input = record(cloned, INPUT_FIELDS, 'Volume lifecycle input');
  if (input.schema !== VOLUME_LIFECYCLE_INPUT_SCHEMA) throw new TypeError('Volume lifecycle input schema is unsupported');
  timestamp(input.evaluatedAtMs, 'evaluatedAtMs');
  validateProposal(input.proposal);
  validateAdvisory(input.advisory);
  validateAuthority(input.authority);
  validateVolumeProtectionPolicy(input.policy);
  validateSizing(input.sizing);
  validateMarket(input.market);
  validateSignals(input.signals);
  validateOccupancy(input.occupancy);
  if (input.current !== null) validateLifecycleProjection(input.current);
  if (input.twinEvidence !== null) {
    const twin = record(input.twinEvidence, TWIN_EVIDENCE_FIELDS, 'Volume twin evidence');
    if (twin.schema !== 'LIVE_EDGE_VOLUME_TWIN_EVIDENCE_V1') throw new TypeError('Volume twin evidence schema is unsupported');
    text(twin.actionKey, 'twin actionKey', ACTION_KEY);
    text(twin.fixtureId, 'twin fixtureId');
    if (typeof twin.twinState !== 'object' || twin.twinState === null) throw new TypeError('Volume twin state is missing');
  }
  return deepFreeze(cloned as unknown as VolumeLifecycleInput);
}

export function lifecycleState(value: unknown, label: string): VolumeLifecycleState {
  return oneOf(value, ['PROBE', 'CONFIRM', 'ADD_ALLOWED', 'HOLD', 'REDUCE', 'EXIT', 'RECOVERY_REQUIRED'], label);
}
