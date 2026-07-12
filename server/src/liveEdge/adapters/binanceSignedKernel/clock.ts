/**
 * Deterministic Binance clock evidence and signing-time projection.
 *
 * This module owns no clock, timer, transport, credential, or scheduling
 * authority. Callers supply both UTC and monotonic observations. The accepted
 * L02 matrix supplies the only contract identities considered here.
 */

import { types as utilTypes } from 'node:util';

import { BINANCE_CONTRACT_MATRIX_CONTENT_SHA256 } from '../binanceContracts/matrix.js';
import { canonicalBinanceContractMatrix } from '../binanceContracts/validate.js';
import type {
  BinanceContractMatrix,
  BinanceContractRecord,
  BinanceEnvironment,
  BinanceProduct,
} from '../binanceContracts/types.js';
import { L03_BINANCE_MATRIX_SHA256 } from './contract.js';

export const BINANCE_CLOCK_ACCEPTED_MATRIX_SHA256 = L03_BINANCE_MATRIX_SHA256;

export const BINANCE_CLOCK_POLICY_V1 = Object.freeze({
  minimumAcceptedSamples: 3,
  maximumSamples: 9,
  maximumRttMs: 2_000,
  maximumAnchorDriftMs: 50,
  outlierDeviationMs: 250,
  maximumFreshDeviationMs: 100,
  maximumSampleAgeMs: 30_000,
  recvWindowPolicyCapMs: 5_000,
} as const);

export interface BinanceClockSample {
  readonly product: BinanceProduct;
  readonly environment: BinanceEnvironment;
  readonly utcSendEpochMs: number;
  readonly utcReceiveEpochMs: number;
  readonly monotonicSendMs: number;
  readonly monotonicReceiveMs: number;
  readonly serverEpochMs: number;
}

export type BinanceClockEvidenceState =
  | 'FRESH'
  | 'STALE'
  | 'UNAVAILABLE'
  | 'CLOCK_SKEWED';

export interface BinanceClockEstimate {
  readonly state: BinanceClockEvidenceState;
  readonly product: BinanceProduct;
  readonly environment: BinanceEnvironment;
  readonly serverTimeContractId: string;
  readonly estimatedAtMonotonicMs: number;
  readonly totalSampleCount: number;
  readonly acceptedSampleCount: number;
  readonly rejectedRttCount: number;
  readonly rejectedAnchorDriftCount: number;
  readonly rejectedOutlierCount: number;
  readonly newestReceiveMonotonicMs: number | null;
  readonly referenceUtcEpochMs: number | null;
  readonly referenceMonotonicMs: number | null;
  /** Official server epoch minus local UTC epoch. Never fabricated as zero. */
  readonly offsetMs: number | null;
  readonly maximumAcceptedRttMs: number | null;
  readonly maximumOffsetDeviationMs: number | null;
}

export type BinanceClockFailureCode =
  | 'CLOCK_INPUT_INVALID'
  | 'CLOCK_SAMPLE_COUNT_INVALID'
  | 'CLOCK_SAMPLE_INVALID'
  | 'CLOCK_DUPLICATE_SAMPLE'
  | 'CLOCK_SCOPE_MISMATCH'
  | 'CLOCK_MONOTONIC_REGRESSION'
  | 'CLOCK_CONTRACT_UNAVAILABLE'
  | 'CLOCK_EVIDENCE_UNAVAILABLE'
  | 'CLOCK_EVIDENCE_STALE'
  | 'CLOCK_EVIDENCE_SKEWED'
  | 'RECV_WINDOW_UNAVAILABLE'
  | 'RECV_WINDOW_EXCEEDS_REVIEWED_CAP'
  | 'CLOCK_TIMESTAMP_INVALID';

export interface BinanceClockFailure {
  readonly code: BinanceClockFailureCode;
}

export type BinanceClockResult<T> =
  | Readonly<{ readonly ok: true; readonly value: Readonly<T> }>
  | Readonly<{ readonly ok: false; readonly failure: Readonly<BinanceClockFailure> }>;

export interface BinanceSigningClockDecision {
  readonly state: 'READY';
  readonly product: BinanceProduct;
  readonly environment: BinanceEnvironment;
  readonly signedContractId: string;
  readonly serverTimeContractId: string;
  /** Base-ten integer text so canonical request construction preserves bytes. */
  readonly timestampMs: string;
  readonly recvWindowMs: number;
  readonly decidedAtMonotonicMs: number;
  readonly expiresAtMonotonicMs: number;
  readonly evidenceAgeMs: number;
  readonly acceptedSampleCount: number;
  readonly maximumAcceptedRttMs: number;
  readonly maximumOffsetDeviationMs: number;
}

type ClosedValues = Readonly<Record<string, unknown>>;

interface ParsedClockSample extends BinanceClockSample {
  readonly rttMs: number;
  readonly utcRttMs: number;
  /** Twice the server-minus-local-UTC midpoint offset. */
  readonly offsetTwice: bigint;
  /** Twice the local-UTC-minus-monotonic midpoint anchor. */
  readonly anchorTwice: bigint;
}

const SAMPLE_KEYS = [
  'product',
  'environment',
  'utcSendEpochMs',
  'utcReceiveEpochMs',
  'monotonicSendMs',
  'monotonicReceiveMs',
  'serverEpochMs',
] as const;

const ESTIMATE_KEYS = [
  'state',
  'product',
  'environment',
  'serverTimeContractId',
  'estimatedAtMonotonicMs',
  'totalSampleCount',
  'acceptedSampleCount',
  'rejectedRttCount',
  'rejectedAnchorDriftCount',
  'rejectedOutlierCount',
  'newestReceiveMonotonicMs',
  'referenceUtcEpochMs',
  'referenceMonotonicMs',
  'offsetMs',
  'maximumAcceptedRttMs',
  'maximumOffsetDeviationMs',
] as const;

const PRODUCTS = Object.freeze(['SPOT', 'USD_M_PERPETUAL', 'MARGIN'] as const);
const ENVIRONMENTS = Object.freeze(['PRODUCTION', 'DEMO', 'TESTNET'] as const);
const STATES = Object.freeze(['FRESH', 'STALE', 'UNAVAILABLE', 'CLOCK_SKEWED'] as const);
const MAXIMUM_SAFE_QUARTER_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

function success<T extends object>(value: T): BinanceClockResult<T> {
  return Object.freeze({ ok: true, value: Object.freeze(value) });
}

function failure<T>(code: BinanceClockFailureCode): BinanceClockResult<T> {
  return Object.freeze({ ok: false, failure: Object.freeze({ code }) });
}

function isProxy(value: object): boolean {
  try {
    return utilTypes.isProxy(value);
  } catch {
    return true;
  }
}

function readClosedRecord(candidate: unknown, expectedKeys: readonly string[]): ClosedValues | null {
  try {
    if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)) return null;
    if (Array.isArray(candidate) || Object.getPrototypeOf(candidate) !== Object.prototype) return null;
    if (Object.getOwnPropertySymbols(candidate).length !== 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(candidate) as Record<string, PropertyDescriptor>;
    const actualKeys = Object.keys(descriptors);
    if (actualKeys.length !== expectedKeys.length) return null;
    const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.enumerable !== true) return null;
      values[key] = descriptor.value;
    }
    return values;
  } catch {
    return null;
  }
}

function readDensePlainArray(candidate: unknown): readonly unknown[] | null {
  try {
    if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)) return null;
    if (!Array.isArray(candidate) || Object.getPrototypeOf(candidate) !== Array.prototype) return null;
    if (Object.getOwnPropertySymbols(candidate).length !== 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(candidate) as Record<string, PropertyDescriptor>;
    const lengthDescriptor = descriptors.length;
    if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, 'value')) return null;
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0) return null;
    if (Object.keys(descriptors).length !== length + 1) return null;
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.enumerable !== true) return null;
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return null;
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value > 0;
}

function isQuarterMillisecond(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isSafeInteger(value * 4);
}

function isProduct(value: unknown): value is BinanceProduct {
  return typeof value === 'string' && PRODUCTS.some((product) => product === value);
}

function isEnvironment(value: unknown): value is BinanceEnvironment {
  return typeof value === 'string' && ENVIRONMENTS.some((environment) => environment === value);
}

function expectedServerTimeContractId(
  product: BinanceProduct,
  environment: BinanceEnvironment,
): string | null {
  if (environment !== 'PRODUCTION') return null;
  switch (product) {
    case 'SPOT': return 'SPOT_SERVER_TIME';
    case 'USD_M_PERPETUAL': return 'USDM_SERVER_TIME';
    case 'MARGIN': return 'MARGIN_SERVER_TIME';
  }
}

function acceptedContractMatrix(): Readonly<BinanceContractMatrix> | null {
  if (BINANCE_CONTRACT_MATRIX_CONTENT_SHA256 !== BINANCE_CLOCK_ACCEPTED_MATRIX_SHA256) return null;
  try {
    const matrix = canonicalBinanceContractMatrix();
    return matrix.contentSha256 === BINANCE_CLOCK_ACCEPTED_MATRIX_SHA256 ? matrix : null;
  } catch {
    return null;
  }
}

function isExactServerTimeContract(
  contract: BinanceContractRecord | undefined,
  product: BinanceProduct,
  environment: BinanceEnvironment,
  expectedId: string,
): boolean {
  return contract !== undefined
    && contract.id === expectedId
    && contract.product === product
    && contract.environment === environment
    && contract.realm === 'PUBLIC_REST'
    && contract.transport === 'REST'
    && contract.lifecycle === 'CURRENT'
    && contract.operation !== null
    && contract.operation.kind === 'REST_PATH'
    && contract.operation.httpMethod === 'GET'
    && contract.operation.queryTemplate === null
    && contract.authentication.securityType === 'NONE'
    && contract.authentication.signingAlgorithm === 'NONE'
    && contract.mutationClass === 'SOURCE_METADATA_ONLY'
    && contract.externalActionAuthorization === 'NONE'
    && contract.actionAuthority === 'NONE_RECORD_ONLY';
}

function resolveServerTimeContract(
  product: BinanceProduct,
  environment: BinanceEnvironment,
): Readonly<BinanceContractRecord> | null {
  const expectedId = expectedServerTimeContractId(product, environment);
  if (expectedId === null) return null;
  const matrix = acceptedContractMatrix();
  if (matrix === null) return null;
  const contract = matrix.contracts.find((entry) => entry.id === expectedId);
  if (contract === undefined
    || !isExactServerTimeContract(contract, product, environment, expectedId)) return null;
  return contract;
}

function parseClockSample(candidate: unknown): ParsedClockSample | null {
  const values = readClosedRecord(candidate, SAMPLE_KEYS);
  if (values === null
    || !isProduct(values.product)
    || !isEnvironment(values.environment)
    || !isPositiveSafeInteger(values.utcSendEpochMs)
    || !isPositiveSafeInteger(values.utcReceiveEpochMs)
    || !isNonNegativeSafeInteger(values.monotonicSendMs)
    || !isNonNegativeSafeInteger(values.monotonicReceiveMs)
    || !isPositiveSafeInteger(values.serverEpochMs)
    || values.utcReceiveEpochMs < values.utcSendEpochMs
    || values.monotonicReceiveMs < values.monotonicSendMs) return null;

  const utcRttMs = values.utcReceiveEpochMs - values.utcSendEpochMs;
  const rttMs = values.monotonicReceiveMs - values.monotonicSendMs;
  if (!Number.isSafeInteger(utcRttMs) || !Number.isSafeInteger(rttMs)) return null;

  return {
    product: values.product,
    environment: values.environment,
    utcSendEpochMs: values.utcSendEpochMs,
    utcReceiveEpochMs: values.utcReceiveEpochMs,
    monotonicSendMs: values.monotonicSendMs,
    monotonicReceiveMs: values.monotonicReceiveMs,
    serverEpochMs: values.serverEpochMs,
    utcRttMs,
    rttMs,
    offsetTwice: (2n * BigInt(values.serverEpochMs))
      - BigInt(values.utcSendEpochMs)
      - BigInt(values.utcReceiveEpochMs),
    anchorTwice: BigInt(values.utcSendEpochMs)
      + BigInt(values.utcReceiveEpochMs)
      - BigInt(values.monotonicSendMs)
      - BigInt(values.monotonicReceiveMs),
  };
}

/** Returns the median expressed in quarter-millisecond units. */
function medianQuarterFromTwice(values: readonly bigint[]): bigint {
  const sorted = [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] * 2n;
  return sorted[middle - 1] + sorted[middle];
}

function absoluteBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function quarterToNumber(value: bigint): number | null {
  if (absoluteBigInt(value) > MAXIMUM_SAFE_QUARTER_UNITS) return null;
  return Number(value) / 4;
}

function compareNumberDescending(left: number, right: number): number {
  return left > right ? -1 : left < right ? 1 : 0;
}

function sampleDuplicateKey(sample: ParsedClockSample): string {
  return [
    sample.product,
    sample.environment,
    sample.utcSendEpochMs,
    sample.utcReceiveEpochMs,
    sample.monotonicSendMs,
    sample.monotonicReceiveMs,
    sample.serverEpochMs,
  ].join('|');
}

function unavailableEstimate(
  product: BinanceProduct,
  environment: BinanceEnvironment,
  serverTimeContractId: string,
  estimatedAtMonotonicMs: number,
  totalSampleCount: number,
  acceptedSampleCount: number,
  rejectedRttCount: number,
  rejectedAnchorDriftCount: number,
  rejectedOutlierCount: number,
): BinanceClockResult<BinanceClockEstimate> {
  return success<BinanceClockEstimate>({
    state: 'UNAVAILABLE',
    product,
    environment,
    serverTimeContractId,
    estimatedAtMonotonicMs,
    totalSampleCount,
    acceptedSampleCount,
    rejectedRttCount,
    rejectedAnchorDriftCount,
    rejectedOutlierCount,
    newestReceiveMonotonicMs: null,
    referenceUtcEpochMs: null,
    referenceMonotonicMs: null,
    offsetMs: null,
    maximumAcceptedRttMs: null,
    maximumOffsetDeviationMs: null,
  });
}

/**
 * Builds one scope-bound estimate from closed, caller-supplied observations.
 * A high-RTT, drifting, or offset-outlier sample is rejected as evidence;
 * malformed structure and mixed scope fail the complete estimate.
 */
export function estimateBinanceClock(
  samplesCandidate: unknown,
  nowMonotonicMsCandidate: unknown,
): BinanceClockResult<BinanceClockEstimate> {
  if (!isNonNegativeSafeInteger(nowMonotonicMsCandidate)) {
    return failure('CLOCK_INPUT_INVALID');
  }
  const samples = readDensePlainArray(samplesCandidate);
  if (samples === null) return failure('CLOCK_INPUT_INVALID');
  if (samples.length < BINANCE_CLOCK_POLICY_V1.minimumAcceptedSamples
    || samples.length > BINANCE_CLOCK_POLICY_V1.maximumSamples) {
    return failure('CLOCK_SAMPLE_COUNT_INVALID');
  }

  const parsed: ParsedClockSample[] = [];
  for (const candidate of samples) {
    const sample = parseClockSample(candidate);
    if (sample === null) return failure('CLOCK_SAMPLE_INVALID');
    if (sample.monotonicReceiveMs > nowMonotonicMsCandidate) {
      return failure('CLOCK_MONOTONIC_REGRESSION');
    }
    parsed.push(sample);
  }

  const product = parsed[0].product;
  const environment = parsed[0].environment;
  if (parsed.some((sample) => sample.product !== product || sample.environment !== environment)) {
    return failure('CLOCK_SCOPE_MISMATCH');
  }
  const duplicateKeys = new Set<string>();
  for (const sample of parsed) {
    const key = sampleDuplicateKey(sample);
    if (duplicateKeys.has(key)) return failure('CLOCK_DUPLICATE_SAMPLE');
    duplicateKeys.add(key);
  }

  const serverTimeContract = resolveServerTimeContract(product, environment);
  if (serverTimeContract === null) return failure('CLOCK_CONTRACT_UNAVAILABLE');

  let rejectedRttCount = 0;
  let rejectedAnchorDriftCount = 0;
  const rttAccepted: ParsedClockSample[] = [];
  for (const sample of parsed) {
    if (sample.rttMs > BINANCE_CLOCK_POLICY_V1.maximumRttMs) {
      rejectedRttCount += 1;
      continue;
    }
    if (Math.abs(sample.utcRttMs - sample.rttMs) > BINANCE_CLOCK_POLICY_V1.maximumAnchorDriftMs) {
      rejectedAnchorDriftCount += 1;
      continue;
    }
    rttAccepted.push(sample);
  }
  if (rttAccepted.length < BINANCE_CLOCK_POLICY_V1.minimumAcceptedSamples) {
    return unavailableEstimate(
      product,
      environment,
      serverTimeContract.id,
      nowMonotonicMsCandidate,
      parsed.length,
      rttAccepted.length,
      rejectedRttCount,
      rejectedAnchorDriftCount,
      0,
    );
  }

  const anchorMedianQuarter = medianQuarterFromTwice(rttAccepted.map((sample) => sample.anchorTwice));
  const anchorLimitQuarter = BigInt(BINANCE_CLOCK_POLICY_V1.maximumAnchorDriftMs * 4);
  const anchorAccepted = rttAccepted.filter((sample) => {
    const accepted = absoluteBigInt((sample.anchorTwice * 2n) - anchorMedianQuarter)
      <= anchorLimitQuarter;
    if (!accepted) rejectedAnchorDriftCount += 1;
    return accepted;
  });
  if (anchorAccepted.length < BINANCE_CLOCK_POLICY_V1.minimumAcceptedSamples) {
    return unavailableEstimate(
      product,
      environment,
      serverTimeContract.id,
      nowMonotonicMsCandidate,
      parsed.length,
      anchorAccepted.length,
      rejectedRttCount,
      rejectedAnchorDriftCount,
      0,
    );
  }

  const preliminaryOffsetQuarter = medianQuarterFromTwice(
    anchorAccepted.map((sample) => sample.offsetTwice),
  );
  const outlierLimitQuarter = BigInt(BINANCE_CLOCK_POLICY_V1.outlierDeviationMs * 4);
  let rejectedOutlierCount = 0;
  const accepted = anchorAccepted.filter((sample) => {
    const retained = absoluteBigInt((sample.offsetTwice * 2n) - preliminaryOffsetQuarter)
      <= outlierLimitQuarter;
    if (!retained) rejectedOutlierCount += 1;
    return retained;
  });
  if (accepted.length < BINANCE_CLOCK_POLICY_V1.minimumAcceptedSamples) {
    return unavailableEstimate(
      product,
      environment,
      serverTimeContract.id,
      nowMonotonicMsCandidate,
      parsed.length,
      accepted.length,
      rejectedRttCount,
      rejectedAnchorDriftCount,
      rejectedOutlierCount,
    );
  }

  const finalOffsetQuarter = medianQuarterFromTwice(accepted.map((sample) => sample.offsetTwice));
  const offsetMs = quarterToNumber(finalOffsetQuarter);
  let maximumDeviationQuarter = 0n;
  for (const sample of accepted) {
    const deviation = absoluteBigInt((sample.offsetTwice * 2n) - finalOffsetQuarter);
    if (deviation > maximumDeviationQuarter) maximumDeviationQuarter = deviation;
  }
  const maximumOffsetDeviationMs = quarterToNumber(maximumDeviationQuarter);
  if (offsetMs === null || maximumOffsetDeviationMs === null) return failure('CLOCK_SAMPLE_INVALID');

  const newest = [...accepted].sort((left, right) => (
    compareNumberDescending(left.monotonicReceiveMs, right.monotonicReceiveMs)
    || compareNumberDescending(left.monotonicSendMs, right.monotonicSendMs)
    || compareNumberDescending(left.utcReceiveEpochMs, right.utcReceiveEpochMs)
    || compareNumberDescending(left.serverEpochMs, right.serverEpochMs)
  ))[0];
  const maximumAcceptedRttMs = Math.max(...accepted.map((sample) => sample.rttMs));
  const evidenceAgeMs = nowMonotonicMsCandidate - newest.monotonicReceiveMs;
  if (!Number.isSafeInteger(evidenceAgeMs)) return failure('CLOCK_MONOTONIC_REGRESSION');

  let state: BinanceClockEvidenceState = 'FRESH';
  if (maximumOffsetDeviationMs > BINANCE_CLOCK_POLICY_V1.maximumFreshDeviationMs) {
    state = 'CLOCK_SKEWED';
  } else if (evidenceAgeMs > BINANCE_CLOCK_POLICY_V1.maximumSampleAgeMs) {
    state = 'STALE';
  }
  const usable = state === 'FRESH';
  return success<BinanceClockEstimate>({
    state,
    product,
    environment,
    serverTimeContractId: serverTimeContract.id,
    estimatedAtMonotonicMs: nowMonotonicMsCandidate,
    totalSampleCount: parsed.length,
    acceptedSampleCount: accepted.length,
    rejectedRttCount,
    rejectedAnchorDriftCount,
    rejectedOutlierCount,
    newestReceiveMonotonicMs: newest.monotonicReceiveMs,
    referenceUtcEpochMs: usable ? newest.utcReceiveEpochMs : null,
    referenceMonotonicMs: usable ? newest.monotonicReceiveMs : null,
    offsetMs: usable ? offsetMs : null,
    maximumAcceptedRttMs,
    maximumOffsetDeviationMs,
  });
}

function parseClockEstimate(candidate: unknown): Readonly<BinanceClockEstimate> | null {
  const values = readClosedRecord(candidate, ESTIMATE_KEYS);
  if (values === null
    || typeof values.state !== 'string'
    || !STATES.some((state) => state === values.state)
    || !isProduct(values.product)
    || !isEnvironment(values.environment)
    || typeof values.serverTimeContractId !== 'string'
    || values.serverTimeContractId.length < 3
    || values.serverTimeContractId.length > 128
    || !isNonNegativeSafeInteger(values.estimatedAtMonotonicMs)
    || !isPositiveSafeInteger(values.totalSampleCount)
    || values.totalSampleCount > BINANCE_CLOCK_POLICY_V1.maximumSamples
    || !isNonNegativeSafeInteger(values.acceptedSampleCount)
    || !isNonNegativeSafeInteger(values.rejectedRttCount)
    || !isNonNegativeSafeInteger(values.rejectedAnchorDriftCount)
    || !isNonNegativeSafeInteger(values.rejectedOutlierCount)) return null;

  const newest = values.newestReceiveMonotonicMs;
  const referenceUtc = values.referenceUtcEpochMs;
  const referenceMonotonic = values.referenceMonotonicMs;
  const offset = values.offsetMs;
  const maximumRtt = values.maximumAcceptedRttMs;
  const maximumDeviation = values.maximumOffsetDeviationMs;
  if (!(newest === null || isNonNegativeSafeInteger(newest))
    || !(referenceUtc === null || isPositiveSafeInteger(referenceUtc))
    || !(referenceMonotonic === null || isNonNegativeSafeInteger(referenceMonotonic))
    || !(offset === null || isQuarterMillisecond(offset))
    || !(maximumRtt === null
      || (isNonNegativeSafeInteger(maximumRtt)
        && maximumRtt <= BINANCE_CLOCK_POLICY_V1.maximumRttMs))
    || !(maximumDeviation === null
      || (isQuarterMillisecond(maximumDeviation) && maximumDeviation >= 0))) return null;

  const accounted = values.acceptedSampleCount
    + values.rejectedRttCount
    + values.rejectedAnchorDriftCount
    + values.rejectedOutlierCount;
  if (accounted !== values.totalSampleCount) return null;
  if (values.state === 'FRESH') {
    if (values.acceptedSampleCount < BINANCE_CLOCK_POLICY_V1.minimumAcceptedSamples
      || newest === null
      || referenceUtc === null
      || referenceMonotonic === null
      || offset === null
      || maximumRtt === null
      || maximumDeviation === null
      || maximumDeviation > BINANCE_CLOCK_POLICY_V1.maximumFreshDeviationMs
      || referenceMonotonic !== newest
      || values.estimatedAtMonotonicMs < newest
      || values.estimatedAtMonotonicMs - newest > BINANCE_CLOCK_POLICY_V1.maximumSampleAgeMs) return null;
  }

  return values as unknown as Readonly<BinanceClockEstimate>;
}

function isSupportedSignedRestContract(contract: BinanceContractRecord): boolean {
  if (contract.lifecycle !== 'CURRENT'
    || contract.transport !== 'REST'
    || contract.operation === null
    || contract.operation.kind !== 'REST_PATH'
    || contract.operation.httpMethod === null
    || !contract.authentication.requiredParameters.includes('timestamp')
    || !['MILLISECONDS', 'MILLISECONDS_OR_MICROSECONDS'].includes(contract.authentication.timestampUnit)
    || contract.authentication.recvWindowDefaultMs === null
    || contract.authentication.securityType === 'NONE'
    || contract.externalActionAuthorization !== 'NONE'
    || contract.actionAuthority !== 'NONE_RECORD_ONLY') return false;

  if (contract.product === 'SPOT') {
    return ['USER_DATA', 'TRADE'].includes(contract.authentication.securityType)
      && contract.authentication.permittedKeyTypes.includes('HMAC')
      && contract.authentication.signingAlgorithm === 'HMAC_RSA_ED25519'
      && contract.authentication.canonicalEncoding === 'PERCENT_ENCODE_BEFORE_SIGNING';
  }
  if (contract.product === 'USD_M_PERPETUAL') {
    return ['USER_DATA', 'TRADE'].includes(contract.authentication.securityType)
      && contract.authentication.permittedKeyTypes.length === 1
      && contract.authentication.permittedKeyTypes[0] === 'HMAC'
      && contract.authentication.signingAlgorithm === 'HMAC_SHA256'
      && contract.authentication.canonicalEncoding === 'TOTAL_PARAMS_QUERY_THEN_BODY';
  }
  return false;
}

/**
 * Projects a fresh estimate into a contract-bound integer signing timestamp.
 * The result is inert construction data and grants no external action.
 */
export function decideBinanceSigningClock(
  signedContractIdCandidate: unknown,
  estimateCandidate: unknown,
  nowMonotonicMsCandidate: unknown,
): BinanceClockResult<BinanceSigningClockDecision> {
  if (typeof signedContractIdCandidate !== 'string'
    || signedContractIdCandidate.length < 3
    || signedContractIdCandidate.length > 128
    || !isNonNegativeSafeInteger(nowMonotonicMsCandidate)) {
    return failure('CLOCK_INPUT_INVALID');
  }
  const estimate = parseClockEstimate(estimateCandidate);
  if (estimate === null) return failure('CLOCK_INPUT_INVALID');
  if (estimate.state === 'UNAVAILABLE') return failure('CLOCK_EVIDENCE_UNAVAILABLE');
  if (estimate.state === 'STALE') return failure('CLOCK_EVIDENCE_STALE');
  if (estimate.state === 'CLOCK_SKEWED') return failure('CLOCK_EVIDENCE_SKEWED');

  const expectedServerId = expectedServerTimeContractId(estimate.product, estimate.environment);
  const serverTimeContract = resolveServerTimeContract(estimate.product, estimate.environment);
  if (expectedServerId === null
    || serverTimeContract === null
    || estimate.serverTimeContractId !== expectedServerId) {
    return failure('CLOCK_CONTRACT_UNAVAILABLE');
  }
  if (nowMonotonicMsCandidate < estimate.estimatedAtMonotonicMs
    || estimate.newestReceiveMonotonicMs === null
    || estimate.referenceMonotonicMs === null
    || nowMonotonicMsCandidate < estimate.newestReceiveMonotonicMs) {
    return failure('CLOCK_MONOTONIC_REGRESSION');
  }
  const evidenceAgeMs = nowMonotonicMsCandidate - estimate.newestReceiveMonotonicMs;
  if (!Number.isSafeInteger(evidenceAgeMs)) return failure('CLOCK_MONOTONIC_REGRESSION');
  if (evidenceAgeMs > BINANCE_CLOCK_POLICY_V1.maximumSampleAgeMs) {
    return failure('CLOCK_EVIDENCE_STALE');
  }

  const matrix = acceptedContractMatrix();
  if (matrix === null) return failure('CLOCK_CONTRACT_UNAVAILABLE');
  const signedContract = matrix.contracts.find(
    (contract) => contract.id === signedContractIdCandidate,
  );
  if (signedContract === undefined
    || signedContract.product !== estimate.product
    || signedContract.environment !== estimate.environment
    || !isSupportedSignedRestContract(signedContract)) {
    return failure('CLOCK_CONTRACT_UNAVAILABLE');
  }

  const defaultRecvWindow = signedContract.authentication.recvWindowDefaultMs;
  if (!isPositiveSafeInteger(defaultRecvWindow)) return failure('RECV_WINDOW_UNAVAILABLE');
  const documentedMaximum = signedContract.authentication.recvWindowMaxMs;
  if (!(documentedMaximum === null || isPositiveSafeInteger(documentedMaximum))) {
    return failure('RECV_WINDOW_UNAVAILABLE');
  }
  const recvWindowMs = Math.min(
    BINANCE_CLOCK_POLICY_V1.recvWindowPolicyCapMs,
    defaultRecvWindow,
    documentedMaximum ?? defaultRecvWindow,
  );
  if (!Number.isSafeInteger(recvWindowMs) || recvWindowMs <= 0) {
    return failure('RECV_WINDOW_UNAVAILABLE');
  }
  if (recvWindowMs > BINANCE_CLOCK_POLICY_V1.recvWindowPolicyCapMs) {
    return failure('RECV_WINDOW_EXCEEDS_REVIEWED_CAP');
  }

  if (estimate.referenceUtcEpochMs === null
    || estimate.offsetMs === null
    || estimate.maximumAcceptedRttMs === null
    || estimate.maximumOffsetDeviationMs === null) {
    return failure('CLOCK_EVIDENCE_UNAVAILABLE');
  }
  const elapsedFromReferenceMs = nowMonotonicMsCandidate - estimate.referenceMonotonicMs;
  const projectedLocalUtcMs = estimate.referenceUtcEpochMs + elapsedFromReferenceMs;
  const projectedServerMs = projectedLocalUtcMs + estimate.offsetMs;
  const timestampMs = Math.floor(projectedServerMs);
  const expiresAtMonotonicMs = estimate.newestReceiveMonotonicMs
    + BINANCE_CLOCK_POLICY_V1.maximumSampleAgeMs;
  if (!Number.isSafeInteger(elapsedFromReferenceMs)
    || !Number.isSafeInteger(projectedLocalUtcMs)
    || !Number.isFinite(projectedServerMs)
    || !Number.isSafeInteger(timestampMs)
    || timestampMs < 0
    || !Number.isSafeInteger(expiresAtMonotonicMs)) {
    return failure('CLOCK_TIMESTAMP_INVALID');
  }

  return success<BinanceSigningClockDecision>({
    state: 'READY',
    product: estimate.product,
    environment: estimate.environment,
    signedContractId: signedContract.id,
    serverTimeContractId: serverTimeContract.id,
    timestampMs: String(timestampMs),
    recvWindowMs,
    decidedAtMonotonicMs: nowMonotonicMsCandidate,
    expiresAtMonotonicMs,
    evidenceAgeMs,
    acceptedSampleCount: estimate.acceptedSampleCount,
    maximumAcceptedRttMs: estimate.maximumAcceptedRttMs,
    maximumOffsetDeviationMs: estimate.maximumOffsetDeviationMs,
  });
}
