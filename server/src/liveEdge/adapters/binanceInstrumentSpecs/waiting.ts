import { types as utilTypes } from 'node:util';

import {
  requiredFilterReferenceEvidence,
  validateFilterReferenceEvidence,
} from './sizing.js';
import { validateInstrumentRegistrySnapshot } from './snapshot.js';
import type { WaitingRevisionDecision } from './types.js';

const BINDING_FIELDS = Object.freeze([
  'symbol', 'instrumentRevision', 'sourceEvidenceRevision', 'snapshotRevision',
  'evaluatedAtMs', 'orderType', 'timeInForce', 'notionalAsset', 'referenceEvidence',
] as const);
const FUTURE_SKEW_MS = 2_000;

type PlainRecord = Readonly<Record<string, unknown>>;

function record(value: unknown, fields: readonly string[]): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || utilTypes.isProxy(value)) {
    throw new TypeError('waiting input must be a plain record');
  }
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string')
    || keys.length !== fields.length
    || keys.some((key) => !fields.includes(key as string))
    || Object.values(descriptors).some((descriptor) => !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value'))) {
    throw new TypeError('waiting input must use exact enumerable own data fields');
  }
  return value as PlainRecord;
}

function textValue(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256
    || value.trim() !== value
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new TypeError('waiting identity must be bounded safe text');
  }
  return value;
}

function timeValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('waiting evaluation time must be a non-negative safe integer');
  }
  return value;
}

function decision(
  state: WaitingRevisionDecision['state'],
  reasonCodes: readonly string[],
  instrumentRevision: string | null,
  referenceEvidenceRevision: string | null = null,
  sourceEvidenceRevision: string | null = null,
  snapshotRevision: string | null = null,
): Readonly<WaitingRevisionDecision> {
  return Object.freeze({
    state,
    reasonCodes: Object.freeze([...new Set(reasonCodes)].sort()),
    instrumentRevision,
    sourceEvidenceRevision,
    snapshotRevision,
    referenceEvidenceRevision,
    sendEligible: false as const,
    externalActionAuthorization: 'NONE' as const,
  });
}

/** A revision decision only; it never mutates or owns a proposal queue. */
export function decideWaitingInstrumentRevision(
  snapshotValue: unknown,
  bindingValue: unknown,
): Readonly<WaitingRevisionDecision> {
  try {
    const snapshot = validateInstrumentRegistrySnapshot(snapshotValue);
    const binding = record(bindingValue, BINDING_FIELDS);
    const symbol = textValue(binding.symbol);
    const priorRevision = textValue(binding.instrumentRevision);
    const priorSourceEvidenceRevision = textValue(binding.sourceEvidenceRevision);
    const priorSnapshotRevision = textValue(binding.snapshotRevision);
    const evaluatedAtMs = timeValue(binding.evaluatedAtMs);
    const orderType = textValue(binding.orderType);
    if (orderType !== 'LIMIT' && orderType !== 'MARKET') throw new TypeError('waiting order type invalid');
    if (binding.notionalAsset !== 'USDT') throw new TypeError('waiting notional asset must be USDT');
    const current = snapshot.instruments.find((instrument) => instrument.symbol === symbol);
    if (current === undefined) return decision('BLOCKED', ['WAITING_SYMBOL_MISSING'], null);
    if (current.instrumentRevision !== priorRevision) {
      return decision('REVALIDATION_REQUIRED', ['INSTRUMENT_REVISION_CHANGED'], current.instrumentRevision,
        null, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    if (current.sourceEvidenceRevision !== priorSourceEvidenceRevision) {
      return decision('REVALIDATION_REQUIRED', ['SOURCE_EVIDENCE_REVISION_CHANGED'], current.instrumentRevision,
        null, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    if (snapshot.snapshotRevision !== priorSnapshotRevision) {
      return decision('REVALIDATION_REQUIRED', ['SNAPSHOT_REVISION_CHANGED'], current.instrumentRevision,
        null, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    if (current.status !== 'TRADING' || current.normalizationState !== 'READY_STATIC_ONLY') {
      return decision('BLOCKED', ['INSTRUMENT_NO_LONGER_STATIC_READY'], current.instrumentRevision,
        null, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    if (current.quoteAsset !== 'USDT') {
      return decision('BLOCKED', ['CANARY_QUOTE_ASSET_NOT_USDT'], current.instrumentRevision,
        null, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    if (!current.staticOrderTypes.includes(orderType)) {
      return decision('BLOCKED', ['ORDER_TYPE_NO_LONGER_STATIC_READY'], current.instrumentRevision,
        null, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    if (orderType === 'LIMIT') {
      const timeInForce = textValue(binding.timeInForce);
      if (!current.allowedTimeInForce.includes(timeInForce)) {
        return decision('BLOCKED', ['TIME_IN_FORCE_NO_LONGER_STATIC_READY'], current.instrumentRevision,
          null, current.sourceEvidenceRevision, snapshot.snapshotRevision);
      }
    } else if (binding.timeInForce !== null) {
      return decision('BLOCKED', ['MARKET_TIME_IN_FORCE_MUST_BE_NULL'], current.instrumentRevision,
        null, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    if (evaluatedAtMs < current.sourceReceivedAtMs - FUTURE_SKEW_MS) {
      return decision('BLOCKED', ['INSTRUMENT_SOURCE_CLOCK_SKEWED'], current.instrumentRevision,
        null, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    if (evaluatedAtMs > current.sourceValidUntilMs) {
      return decision('REVALIDATION_REQUIRED', ['INSTRUMENT_SOURCE_EVIDENCE_EXPIRED'], current.instrumentRevision,
        null, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    const requiredReference = requiredFilterReferenceEvidence(current, orderType);
    if (requiredReference === 'CONFLICT') {
      return decision('BLOCKED', ['FILTER_REFERENCE_REQUIREMENTS_CONFLICT'], current.instrumentRevision,
        null, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    const referenceEvidence = validateFilterReferenceEvidence(binding.referenceEvidence, current);
    if (requiredReference === null && referenceEvidence !== null) {
      return decision('BLOCKED', ['FILTER_REFERENCE_EVIDENCE_NOT_APPLICABLE'], current.instrumentRevision,
        null, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    if (requiredReference !== null && referenceEvidence === null) {
      return decision('REVALIDATION_REQUIRED', ['FILTER_REFERENCE_EVIDENCE_REQUIRED'], current.instrumentRevision,
        null, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    if (requiredReference !== null && referenceEvidence !== null
      && (referenceEvidence.kind !== requiredReference.kind
        || referenceEvidence.averagingWindowMins !== requiredReference.averagingWindowMins)) {
      return decision('REVALIDATION_REQUIRED', ['FILTER_REFERENCE_KIND_OR_WINDOW_MISMATCH'], current.instrumentRevision,
        referenceEvidence.evidenceRevision, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    if (referenceEvidence !== null && evaluatedAtMs < referenceEvidence.observedAtMs - FUTURE_SKEW_MS) {
      return decision('BLOCKED', ['FILTER_REFERENCE_SOURCE_CLOCK_SKEWED'], current.instrumentRevision,
        referenceEvidence.evidenceRevision, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    if (referenceEvidence !== null && evaluatedAtMs > referenceEvidence.validUntilMs) {
      return decision('REVALIDATION_REQUIRED', ['FILTER_REFERENCE_EVIDENCE_EXPIRED'], current.instrumentRevision,
        referenceEvidence.evidenceRevision, current.sourceEvidenceRevision, snapshot.snapshotRevision);
    }
    return decision('CURRENT', [], current.instrumentRevision, referenceEvidence?.evidenceRevision ?? null,
      current.sourceEvidenceRevision, snapshot.snapshotRevision);
  } catch {
    return decision('BLOCKED', ['WAITING_INPUT_REJECTED'], null);
  }
}
