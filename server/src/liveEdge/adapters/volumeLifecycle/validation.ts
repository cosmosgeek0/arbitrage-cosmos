import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import { canonicalJson } from '../../../foundation/contracts/index.js';
import {
  addVolumeDecimals,
  compareVolumeDecimals,
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
  type VolumeLifecycleProjection,
  type VolumeLifecycleState,
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
  'recordId', 'recordRevision', 'kind', 'lifecycleId', 'proposalId', 'assessmentId',
  'symbol', 'direction', 'ownerFamily', 'state', 'positionQuantity', 'intentKey',
  'actionKey',
] as const);
const PRIOR_ACTION_FIELDS = Object.freeze([
  'actionKey', 'intentKey', 'lifecycleId', 'proposalId', 'assessmentId', 'symbol',
  'direction', 'kind', 'state', 'recordedAtMs',
] as const);
const TWIN_EVIDENCE_FIELDS = Object.freeze(['schema', 'actionKey', 'fixtureId', 'twinState'] as const);
const SETTLED_TWIN_FIELDS = Object.freeze([
  'actionKey', 'fixtureId', 'twinStateRevision', 'twinOutcomeRevision',
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
  'costRevision', 'downsideRevision', 'triggerEpisodeRevision', 'triggerReasonCodes', 'policyRevision',
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
  'proposalId', 'proposalRevision', 'proposalDigest', 'featureRevision',
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
  'currentPrice', 'favorableExtremePrice', 'positionQuantity', 'positionQuantityTruth',
  'mandateUsageAtLifecycleStartQuote', 'projectedMandateUsageQuote', 'capitalUsageTruth',
  'lastNoFillOwnerEvidenceRevision', 'lastNoFillIntentKey', 'reductionEpisodeRevision',
  'reductionEpisodeReasonCodes', 'reductionBasisQuantity', 'reductionTargetQuantity', 'pendingAction',
  'pendingActionBaseProjectionRevision', 'pendingTwinStateRevision', 'pendingTwinOutcomeRevision',
  'lastSettledActionKey', 'lastTwinStateRevision', 'lastTwinOutcomeRevision', 'settledTwinHistory',
  'recoveryEvidenceActionKey', 'recoveryEvidenceFixtureId',
  'recoveryEvidenceTwinStateRevision', 'recoveryEvidenceTwinOutcomeRevision',
  'lastRecoveryResolutionRevision', 'terminalOutcomeReasonCodes', 'feedbackOutcomeRevision',
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
  positiveVolumeDecimal(projection.currentPrice, 'projection currentPrice');
  if (projection.favorableExtremePrice !== null) positiveVolumeDecimal(projection.favorableExtremePrice, 'favorableExtremePrice');
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
  if (projection.lastNoFillOwnerEvidenceRevision !== null) {
    text(projection.lastNoFillOwnerEvidenceRevision, 'lastNoFillOwnerEvidenceRevision', OWNER_REVISION);
  }
  if (projection.lastNoFillIntentKey !== null) {
    text(projection.lastNoFillIntentKey, 'lastNoFillIntentKey', INTENT_KEY);
  }
  if ((projection.lastNoFillOwnerEvidenceRevision === null) !== (projection.lastNoFillIntentKey === null)) {
    throw new TypeError('Volume no-fill owner evidence and intent must be retained together');
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
  if (pending !== null && projection.lastNoFillIntentKey === pending.intentKey) {
    throw new TypeError('Volume pending action repeats the retained no-fill intent');
  }
  if (pending !== null && (pending.kind === 'ENTRY' || pending.kind === 'ADD')
    && projection.lastNoFillOwnerEvidenceRevision === pending.ownerEvidenceRevision) {
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
  for (const candidate of projection.settledTwinHistory) {
    const settled = record(candidate, SETTLED_TWIN_FIELDS, 'Volume settled twin record');
    text(settled.actionKey, 'settled twin actionKey', ACTION_KEY);
    text(settled.fixtureId, 'settled twin fixtureId');
    text(settled.twinStateRevision, 'settled twin state revision');
    text(settled.twinOutcomeRevision, 'settled twin outcome revision');
    if (settled.fixtureId !== `l11fixture_${(settled.actionKey as string).slice('l11action_'.length)}`) {
      throw new TypeError('Volume settled twin fixture is not intrinsic to its action');
    }
    if (settledKeys.has(settled.actionKey as string)) throw new TypeError('Volume settled twin action is duplicated');
    settledKeys.add(settled.actionKey as string);
  }
  const latestSettled = projection.settledTwinHistory.at(-1);
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
  if (pending?.kind === 'REDUCE'
    && (pending.triggerEpisodeRevision === null
      || pending.triggerEpisodeRevision !== projection.reductionEpisodeRevision
      || projection.reductionEpisodeReasonCodes === null
      || canonicalJson(pending.triggerReasonCodes) !== canonicalJson(projection.reductionEpisodeReasonCodes))) {
    throw new TypeError('Volume pending REDUCE action is not bound to its reduction episode');
  }
  const recoveryEvidenceValues = [projection.recoveryEvidenceActionKey, projection.recoveryEvidenceFixtureId,
    projection.recoveryEvidenceTwinStateRevision, projection.recoveryEvidenceTwinOutcomeRevision];
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
      && !settledKeys.has(projection.recoveryEvidenceActionKey as string)) {
      throw new TypeError('Volume recovery evidence action is not retained by the lifecycle');
    }
  }
  if (projection.recoveryEvidenceTwinStateRevision !== null) {
    text(projection.recoveryEvidenceTwinStateRevision, 'recovery evidence twin state revision');
    text(projection.recoveryEvidenceTwinOutcomeRevision, 'recovery evidence twin outcome revision');
  }
  if (projection.lastRecoveryResolutionRevision !== null) {
    text(projection.lastRecoveryResolutionRevision, 'lastRecoveryResolutionRevision');
  }
  if (projection.pendingTwinStateRevision !== null
    && (projection.recoveryEvidenceActionKey !== pending?.actionKey
      || projection.recoveryEvidenceTwinStateRevision !== projection.pendingTwinStateRevision
      || projection.recoveryEvidenceTwinOutcomeRevision !== projection.pendingTwinOutcomeRevision)) {
    throw new TypeError('Volume pending twin revisions must match their recovery evidence correlation');
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
  timestamp(transition.occurredAtMs, 'transition occurredAtMs');
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
  if (compareVolumeDecimals(projection.positionQuantity as string, '0') > 0
    && (projection.entryAveragePrice === null || projection.favorableExtremePrice === null)) {
    throw new TypeError('Volume active exposure must retain entry and favorable-extreme protection truth');
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
      || pending.inventoryMode !== projection.entryInventoryMode
      || pending.availableBaseQuantity !== projection.entryAvailableBaseQuantity
      || pending.inventoryRevision !== projection.entryInventoryRevision
      || pending.inventoryAsset !== projection.entryInventoryAsset
      || pending.inventoryAccountRealmId !== projection.entryInventoryAccountRealmId
      || pending.inventoryObservedAtMs !== projection.entryInventoryObservedAtMs
      || pending.inventoryValidUntilMs !== projection.entryInventoryValidUntilMs
      || pending.capitalMandateId !== projection.capitalMandateId
      || pending.capitalMandateRevision !== projection.capitalMandateRevision
      || pending.capitalMandateDigest !== projection.capitalMandateDigest
      || pending.capitalReservationId !== projection.capitalReservationId
      || pending.capitalReservationRevision !== projection.capitalReservationRevision
      || pending.capitalMaximumQuote !== projection.capitalMaximumQuote) {
      throw new TypeError('Volume pending action is not bound to its lifecycle projection');
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
    oneOf(active.kind, ['POSITION', 'TICKET'], 'occupancy kind');
    text(active.lifecycleId, 'occupancy lifecycleId');
    text(active.proposalId, 'occupancy proposalId');
    text(active.assessmentId, 'occupancy assessmentId');
    text(active.symbol, 'occupancy symbol', SYMBOL);
    oneOf(active.direction, ['LONG', 'SHORT'], 'occupancy direction');
    text(active.ownerFamily, 'occupancy ownerFamily');
    oneOf(active.state, ['ACTIVE', 'RECOVERY_REQUIRED', 'CLOSED'], 'occupancy state');
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
