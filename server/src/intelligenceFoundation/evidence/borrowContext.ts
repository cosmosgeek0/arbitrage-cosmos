import {
  makeStableFailure,
  type JsonPrimitive,
  type NormalizedBorrow,
  type NormalizedContext,
  type StableFailure,
} from '../contracts/index.js';
import {
  failureResult,
  finalizeEvidence,
  objectRecord,
  parseBoolean,
  parseDecimal,
  parseString,
  parseTimestamp,
  prepareContext,
  prepareRecord,
  sourceRecordId,
  type PreparedContext,
} from './common.js';
import { BINANCE_SOURCE_FACTS, type BinanceSourceKey } from './sourceFacts.js';
import type { EvidenceNormalizationResult } from './types.js';

const BORROW_SOURCES = ['MARGIN_BORROW_COMPOSITE'] as const satisfies readonly BinanceSourceKey[];
const CONTEXT_SOURCES = ['CONTEXT_INJECTED'] as const satisfies readonly BinanceSourceKey[];

function optionalRecordId(value: unknown, field: string, component: string): { value: string | null; failure: StableFailure | null } {
  if (value === undefined || value === null) return { value: null, failure: null };
  const parsed = parseString(value, field, component);
  return parsed.ok ? { value: parsed.value, failure: null } : { value: null, failure: parsed.failure };
}

function fragmentSourceLabel(sourceKey: 'MARGIN_ALL_ASSETS' | 'MARGIN_MAX_BORROWABLE' | 'MARGIN_AVAILABLE_INVENTORY' | 'MARGIN_NEXT_HOURLY_RATE'): string {
  const fact = BINANCE_SOURCE_FACTS[sourceKey];
  return `${fact.sourceId}:${fact.dataset}`;
}

interface BorrowFragmentMetadata {
  scope: 'CROSS' | 'ISOLATED';
  isolatedSymbol: string | null;
  receivedTimeMs: number;
}

function fragmentMetadata(
  fragment: Record<string, unknown>,
  field: string,
  prepared: PreparedContext,
  component: string,
): { value: BorrowFragmentMetadata | null; failure: StableFailure | null } {
  const scope = parseString(fragment.scope, `${field}.scope`, component);
  if (!scope.ok) return { value: null, failure: scope.failure };
  if (scope.value !== 'CROSS' && scope.value !== 'ISOLATED') {
    return {
      value: null,
      failure: makeStableFailure('INVALID_VALUE', component, 'borrow fragment scope must be CROSS or ISOLATED', `${field}.scope`),
    };
  }
  let isolatedSymbol: string | null = null;
  if (scope.value === 'ISOLATED') {
    const symbol = parseString(fragment.isolatedSymbol, `${field}.isolatedSymbol`, component);
    if (!symbol.ok) return { value: null, failure: symbol.failure };
    isolatedSymbol = symbol.value;
  } else if (fragment.isolatedSymbol !== undefined && fragment.isolatedSymbol !== null) {
    return {
      value: null,
      failure: makeStableFailure('INVALID_VALUE', component, 'cross-margin fragment cannot declare an isolated symbol', `${field}.isolatedSymbol`),
    };
  }
  const receivedTime = parseTimestamp(fragment.receivedTimeMs, `${field}.receivedTimeMs`, component);
  if (!receivedTime.ok) return { value: null, failure: receivedTime.failure };
  if (receivedTime.value > prepared.context.receivedTimeMs || receivedTime.value > prepared.context.evaluatedAtMs) {
    return {
      value: null,
      failure: makeStableFailure('TIMESTAMP_SKEW', component, 'borrow fragment receipt follows the composite receipt or evaluation', `${field}.receivedTimeMs`),
    };
  }
  return { value: { scope: scope.value, isolatedSymbol, receivedTimeMs: receivedTime.value }, failure: null };
}

export function normalizeBorrow(
  raw: unknown,
  context: unknown,
): EvidenceNormalizationResult<NormalizedBorrow> {
  const component = 'evidence.borrow';
  const preparedRecord = prepareRecord(raw, component);
  if (!preparedRecord.ok) return failureResult(preparedRecord.failure);
  const preparedContext = prepareContext(context, BORROW_SOURCES, component);
  if (!preparedContext.ok) return failureResult(preparedContext.failure);
  const record = preparedRecord.value;
  const prepared = preparedContext.value;

  const asset = parseString(record.asset, 'asset', component);
  if (!asset.ok) return failureResult(asset.failure);
  if (asset.value !== prepared.instrument.baseAsset || asset.value !== prepared.instrument.symbol) {
    return failureResult(makeStableFailure('INVALID_VALUE', component, 'borrow asset does not match the asset-level instrument seed', 'asset'));
  }

  const fragmentNames = ['allAssets', 'maxBorrowable', 'availableInventory', 'nextHourlyInterestRate'] as const;
  if (fragmentNames.every((field) => record[field] === undefined || record[field] === null)) {
    return failureResult(makeStableFailure('MISSING_SOURCE', component, 'borrow composite contains no supplied endpoint records', 'sourceFragments'));
  }

  let eligibility: NormalizedBorrow['eligibility'] = 'UNKNOWN';
  let availability: NormalizedBorrow['availability'] = 'UNKNOWN';
  let systemAvailableAmount: number | null = null;
  let accountBorrowLimit: number | null = null;
  let inventoryAmount: number | null = null;
  let hourlyInterestRateDecimal: number | null = null;
  let sourceTransactionTimeMs: number | null = null;
  const sourceRecordIds: string[] = [];
  const sourceSet: string[] = [];
  const observedFields = ['asset'];
  const missingFields: string[] = [];
  const fragmentScopes: string[] = [];
  const dependencyTimes: Array<{ basis: 'SOURCE_TRANSACTION_TIME' | 'RECEIVE_TIME'; timeMs: number }> = [];

  const registerMetadata = (metadata: BorrowFragmentMetadata): void => {
    fragmentScopes.push(`${metadata.scope}:${metadata.isolatedSymbol ?? ''}`);
    dependencyTimes.push({ basis: 'RECEIVE_TIME', timeMs: metadata.receivedTimeMs });
  };

  if (record.allAssets === undefined || record.allAssets === null) {
    missingFields.push('eligibility');
  } else {
    if (!objectRecord(record.allAssets)) {
      return failureResult(makeStableFailure('INVALID_VALUE', component, 'allAssets fragment must be an object', 'allAssets'));
    }
    const metadata = fragmentMetadata(record.allAssets, 'allAssets', prepared, component);
    if (metadata.failure || metadata.value === null) return failureResult(metadata.failure as StableFailure);
    registerMetadata(metadata.value);
    const fragmentAsset = parseString(record.allAssets.assetName, 'allAssets.assetName', component);
    if (!fragmentAsset.ok) return failureResult(fragmentAsset.failure);
    if (fragmentAsset.value !== asset.value) {
      return failureResult(makeStableFailure('INVALID_VALUE', component, 'allAssets fragment names a different asset', 'allAssets.assetName'));
    }
    const isBorrowable = parseBoolean(record.allAssets.isBorrowable, 'allAssets.isBorrowable', component);
    if (!isBorrowable.ok) return failureResult(isBorrowable.failure);
    const externalId = optionalRecordId(record.allAssets.recordId, 'allAssets.recordId', component);
    if (externalId.failure) return failureResult(externalId.failure);
    eligibility = isBorrowable.value ? 'ELIGIBLE' : 'INELIGIBLE';
    observedFields.push('eligibility');
    sourceSet.push(fragmentSourceLabel('MARGIN_ALL_ASSETS'));
    sourceRecordIds.push(sourceRecordId('MARGIN_ALL_ASSETS', {
      asset: asset.value, isBorrowable: isBorrowable.value,
      scope: metadata.value.scope, isolatedSymbol: metadata.value.isolatedSymbol,
      receivedTimeMs: metadata.value.receivedTimeMs, externalRecordId: externalId.value,
    }));
  }

  if (record.maxBorrowable === undefined || record.maxBorrowable === null) {
    missingFields.push('systemAvailableAmount', 'accountBorrowLimit', 'availability');
  } else {
    if (!objectRecord(record.maxBorrowable)) {
      return failureResult(makeStableFailure('INVALID_VALUE', component, 'maxBorrowable fragment must be an object', 'maxBorrowable'));
    }
    const metadata = fragmentMetadata(record.maxBorrowable, 'maxBorrowable', prepared, component);
    if (metadata.failure || metadata.value === null) return failureResult(metadata.failure as StableFailure);
    registerMetadata(metadata.value);
    const amount = parseDecimal(record.maxBorrowable.amount, 'maxBorrowable.amount', component, 'NON_NEGATIVE');
    if (!amount.ok) return failureResult(amount.failure);
    const borrowLimit = parseDecimal(record.maxBorrowable.borrowLimit, 'maxBorrowable.borrowLimit', component, 'NON_NEGATIVE');
    if (!borrowLimit.ok) return failureResult(borrowLimit.failure);
    const externalId = optionalRecordId(record.maxBorrowable.recordId, 'maxBorrowable.recordId', component);
    if (externalId.failure) return failureResult(externalId.failure);
    systemAvailableAmount = amount.value;
    accountBorrowLimit = borrowLimit.value;
    availability = amount.value > 0 ? 'AVAILABLE' : 'UNAVAILABLE';
    observedFields.push('systemAvailableAmount', 'accountBorrowLimit', 'availability');
    sourceSet.push(fragmentSourceLabel('MARGIN_MAX_BORROWABLE'));
    sourceRecordIds.push(sourceRecordId('MARGIN_MAX_BORROWABLE', {
      asset: asset.value, amount: amount.value, borrowLimit: borrowLimit.value,
      scope: metadata.value.scope, isolatedSymbol: metadata.value.isolatedSymbol,
      receivedTimeMs: metadata.value.receivedTimeMs, externalRecordId: externalId.value,
    }));
  }

  if (record.availableInventory === undefined || record.availableInventory === null) {
    missingFields.push('inventoryAmount');
  } else {
    if (!objectRecord(record.availableInventory)) {
      return failureResult(makeStableFailure('INVALID_VALUE', component, 'availableInventory fragment must be an object', 'availableInventory'));
    }
    const metadata = fragmentMetadata(record.availableInventory, 'availableInventory', prepared, component);
    if (metadata.failure || metadata.value === null) return failureResult(metadata.failure as StableFailure);
    registerMetadata(metadata.value);
    const amount = parseDecimal(record.availableInventory.amount, 'availableInventory.amount', component, 'NON_NEGATIVE');
    if (!amount.ok) return failureResult(amount.failure);
    const updateTimeSeconds = parseTimestamp(record.availableInventory.updateTime, 'availableInventory.updateTime', component);
    if (!updateTimeSeconds.ok) return failureResult(updateTimeSeconds.failure);
    const updateTimeMs = updateTimeSeconds.value * 1_000;
    if (!Number.isSafeInteger(updateTimeMs)) {
      return failureResult(makeStableFailure('INVALID_VALUE', component, 'inventory updateTime seconds overflow milliseconds', 'availableInventory.updateTime'));
    }
    if (updateTimeMs > metadata.value.receivedTimeMs + prepared.maximumFutureSkewMs) {
      return failureResult(makeStableFailure('TIMESTAMP_SKEW', component, 'inventory updateTime is ahead of its fragment receipt', 'availableInventory.updateTime'));
    }
    const externalId = optionalRecordId(record.availableInventory.recordId, 'availableInventory.recordId', component);
    if (externalId.failure) return failureResult(externalId.failure);
    inventoryAmount = amount.value;
    sourceTransactionTimeMs = updateTimeMs;
    dependencyTimes.push({ basis: 'SOURCE_TRANSACTION_TIME', timeMs: updateTimeMs });
    observedFields.push('inventoryAmount');
    sourceSet.push(fragmentSourceLabel('MARGIN_AVAILABLE_INVENTORY'));
    sourceRecordIds.push(sourceRecordId('MARGIN_AVAILABLE_INVENTORY', {
      asset: asset.value, amount: amount.value, updateTimeSeconds: updateTimeSeconds.value,
      updateTimeMs, scope: metadata.value.scope, isolatedSymbol: metadata.value.isolatedSymbol,
      receivedTimeMs: metadata.value.receivedTimeMs, externalRecordId: externalId.value,
    }));
  }

  if (record.nextHourlyInterestRate === undefined || record.nextHourlyInterestRate === null) {
    missingFields.push('hourlyInterestRateDecimal');
  } else {
    if (!objectRecord(record.nextHourlyInterestRate)) {
      return failureResult(makeStableFailure('INVALID_VALUE', component, 'nextHourlyInterestRate fragment must be an object', 'nextHourlyInterestRate'));
    }
    const metadata = fragmentMetadata(record.nextHourlyInterestRate, 'nextHourlyInterestRate', prepared, component);
    if (metadata.failure || metadata.value === null) return failureResult(metadata.failure as StableFailure);
    registerMetadata(metadata.value);
    const rate = parseDecimal(record.nextHourlyInterestRate.nextHourlyInterestRate, 'nextHourlyInterestRate.nextHourlyInterestRate', component, 'NON_NEGATIVE');
    if (!rate.ok) return failureResult(rate.failure);
    const externalId = optionalRecordId(record.nextHourlyInterestRate.recordId, 'nextHourlyInterestRate.recordId', component);
    if (externalId.failure) return failureResult(externalId.failure);
    hourlyInterestRateDecimal = rate.value;
    observedFields.push('hourlyInterestRateDecimal');
    sourceSet.push(fragmentSourceLabel('MARGIN_NEXT_HOURLY_RATE'));
    sourceRecordIds.push(sourceRecordId('MARGIN_NEXT_HOURLY_RATE', {
      asset: asset.value, hourlyInterestRateDecimal: rate.value,
      scope: metadata.value.scope, isolatedSymbol: metadata.value.isolatedSymbol,
      receivedTimeMs: metadata.value.receivedTimeMs, externalRecordId: externalId.value,
    }));
  }

  if (eligibility === 'INELIGIBLE' && availability === 'AVAILABLE') {
    return failureResult(makeStableFailure('INVALID_VALUE', component, 'borrow eligibility and positive max-borrowable amount conflict', 'availability'));
  }
  const uniqueScopes = [...new Set(fragmentScopes)].sort();
  if (uniqueScopes.length > 1) {
    return failureResult(makeStableFailure('INVALID_VALUE', component, 'borrow fragments mix cross-margin or isolated-margin scopes', 'sourceFragments.scope'));
  }
  if (uniqueScopes[0]?.startsWith('ISOLATED:')) {
    return failureResult(makeStableFailure('UNAVAILABLE', component, 'isolated-margin scope cannot be represented by the current asset-level borrow evidence contract', 'sourceFragments.scope'));
  }
  const oldestDependency = [...dependencyTimes].sort((left, right) => left.timeMs - right.timeMs
    || left.basis.localeCompare(right.basis))[0];
  const freshnessBasis = oldestDependency?.basis ?? 'RECEIVE_TIME';
  const derivedReceivedTimeMs = freshnessBasis === 'RECEIVE_TIME'
    ? oldestDependency?.timeMs ?? prepared.context.receivedTimeMs
    : prepared.context.receivedTimeMs;
  return finalizeEvidence<NormalizedBorrow>(prepared, {
    value: {
      kind: 'BORROW', asset: asset.value, eligibility, availability, systemAvailableAmount,
      accountBorrowLimit, hourlyInterestRateDecimal, inventoryAmount,
    },
    sourceRecordIds, sourceSet, transform: 'normalize-borrow-composite-v2',
    sourceEventTimeMs: null, sourceTransactionTimeMs, sequence: null,
    receivedTimeMs: derivedReceivedTimeMs,
    freshnessBasis,
    observedFields, missingFields,
  }, component);
}

function primitiveValues(value: unknown): value is Record<string, JsonPrimitive> {
  return objectRecord(value) && Object.values(value).every((entry) =>
    entry === null || typeof entry === 'string' || typeof entry === 'boolean' || typeof entry === 'number' && Number.isFinite(entry));
}

export function normalizeContext(
  raw: unknown,
  context: unknown,
): EvidenceNormalizationResult<NormalizedContext> {
  const component = 'evidence.context';
  const preparedRecord = prepareRecord(raw, component);
  if (!preparedRecord.ok) return failureResult(preparedRecord.failure);
  const preparedContext = prepareContext(context, CONTEXT_SOURCES, component);
  if (!preparedContext.ok) return failureResult(preparedContext.failure);
  const record = preparedRecord.value;
  const prepared = preparedContext.value;
  const contextType = parseString(record.contextType, 'contextType', component);
  if (!contextType.ok) return failureResult(contextType.failure);
  const scope = parseString(record.scope, 'scope', component);
  if (!scope.ok) return failureResult(scope.failure);
  if (!['SYMBOL', 'SECTOR', 'MARKET', 'VENUE'].includes(scope.value)) {
    return failureResult(makeStableFailure('INVALID_VALUE', component, 'context scope is not supported', 'scope'));
  }
  const values = record.values;
  if (!primitiveValues(values)) {
    return failureResult(makeStableFailure(
      record.values === undefined || record.values === null ? 'INCOMPLETE_EVIDENCE' : 'INVALID_VALUE',
      component,
      'context values must be a primitive-valued object with finite numbers',
      'values',
    ));
  }
  const eventTime = parseTimestamp(record.sourceEventTimeMs, 'sourceEventTimeMs', component);
  if (!eventTime.ok) return failureResult(eventTime.failure);
  let transactionTimeMs: number | null = null;
  if (record.sourceTransactionTimeMs !== undefined && record.sourceTransactionTimeMs !== null) {
    const transactionTime = parseTimestamp(record.sourceTransactionTimeMs, 'sourceTransactionTimeMs', component);
    if (!transactionTime.ok) return failureResult(transactionTime.failure);
    transactionTimeMs = transactionTime.value;
  }
  const externalId = optionalRecordId(record.recordId, 'recordId', component);
  if (externalId.failure) return failureResult(externalId.failure);
  const rawId = sourceRecordId(prepared.sourceKey, {
    contextType: contextType.value, scope: scope.value, values,
    sourceEventTimeMs: eventTime.value, sourceTransactionTimeMs: transactionTimeMs, externalRecordId: externalId.value,
  });
  return finalizeEvidence<NormalizedContext>(prepared, {
    value: {
      kind: 'CONTEXT', contextType: contextType.value,
      scope: scope.value as NormalizedContext['scope'], values: { ...values },
    },
    sourceRecordIds: [rawId], transform: 'normalize-context-v1',
    sourceEventTimeMs: eventTime.value, sourceTransactionTimeMs: transactionTimeMs, sequence: null,
    observedFields: ['contextType', 'scope', ...Object.keys(values).map((key) => `values.${key}`)],
  }, component);
}
