import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

/**
 * Pure forward-measurement contracts for Binance Spot public market data.
 *
 * All clocks, generations, payload bytes, and point-in-time controls are
 * supplied by the caller. This module has no transport, filesystem, database,
 * timer, environment, credential, execution, submit, or CAS seam.
 */

export const VOLUME_FORWARD_MEASUREMENT_POLICY_SCHEMA =
  'cosmos.engine.volume.forward-measurement-policy.v1' as const;
export const VOLUME_FORWARD_DETECTOR_COVERAGE_POLICY_SCHEMA =
  'cosmos.engine.volume.forward-detector-coverage-policy.v1' as const;
export const VOLUME_FORWARD_DEPTH_STATE_SCHEMA =
  'cosmos.engine.volume.forward-depth-state.v1' as const;

export const VOLUME_FORWARD_MEASUREMENT_AUTHORITY = deepFreeze({
  enabled: false,
  killSwitchEngaged: true,
  mode: 'SHADOW_ONLY' as const,
  recordOnly: true,
  productionAdmissible: false,
  publicOnly: true,
  authentication: 'NONE' as const,
  executionAuthority: 'NONE' as const,
  submitAuthority: 'NONE' as const,
  casAuthority: 'NONE' as const,
  externalAuthority: 'NONE' as const,
  privateDataAuthority: 'NONE' as const,
  keyAuthority: 'NONE' as const,
  providerAuthority: 'NONE' as const,
  hostAuthority: 'NONE' as const,
  submitPortPresent: false,
  queryPortPresent: false,
  sends: 0,
  sideEffects: 0,
  orders: 0,
  casWrites: 0,
  privateCalls: 0,
  signedCalls: 0,
  keyReads: 0,
  providerCalls: 0,
  hostCalls: 0,
  networkCallsDuringReplay: 0,
  fsWrites: 0,
});

export const VOLUME_FORWARD_MEASUREMENT_LIMITS = Object.freeze({
  maximumBufferEvents: 128,
  maximumBufferedDepthLevels: 8_192,
  maximumBufferedDepthBytes: 1024 * 1024,
  maximumDepthLevelsPerSide: 5_000,
  // depth@100ms can legitimately emit about 600 contiguous ranges during the
  // mandatory 60-second hold. Retain a bounded margin without checkpointing
  // away any range that a terminal lifecycle still has to prove.
  maximumDepthProofRanges: 2_048,
  maximumPayloadBytes: 16 * 1024 * 1024,
  maximumStreams: 8,
});

const MAX_UTC_MS = 4_102_444_800_000;
const POLICY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const DIGEST = /^(?:sha256:)?[a-f0-9]{64}$/;
const ENGINE_DIGEST = /^[A-Za-z][A-Za-z0-9_-]{2,191}$/;
const SYMBOL = /^[A-Z0-9]{5,20}$/;
const MONOTONIC_NS = /^(?:0|[1-9][0-9]{0,39})$/;
const SOURCE_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const STREAM = /^[a-z0-9]{5,20}@(depth@100ms|aggTrade|trade|bookTicker)$/;
const MAX_SOURCE_DECIMAL_CHARS = 128;

type PlainRecord = Readonly<Record<string, unknown>>;
type DepthLevelTuple = readonly [string, string];

export interface VolumeForwardMeasurementPolicyInput {
  readonly policyId: string;
  readonly policyRevision: number;
  readonly symbol: string;
  readonly frozenAtMs: number;
  readonly outcomeOpensAtMs: number;
  /** Exclusive upper bound for detector-proposal admission. */
  readonly outcomeClosesAtMs: number;
  /** Exclusive upper bound for post-window exit-evidence admission. */
  readonly evidenceClosesAtMs: number;
  readonly streams: readonly string[];
  readonly config: Readonly<{
    enabled: false;
    killSwitchEngaged: true;
  }>;
}

export interface VolumeForwardMeasurementPolicy
  extends VolumeForwardMeasurementPolicyInput {
  readonly schemaVersion: typeof VOLUME_FORWARD_MEASUREMENT_POLICY_SCHEMA;
  readonly policyDigest: `sha256:${string}`;
  readonly authority: typeof VOLUME_FORWARD_MEASUREMENT_AUTHORITY;
}

export interface VolumeForwardDetectorCoveragePolicyInput {
  readonly policyId: string;
  readonly policyRevision: number;
  readonly role: 'DETECTOR_COVERAGE';
  readonly symbol: null;
  readonly frozenAtMs: number;
  readonly outcomeOpensAtMs: number;
  readonly outcomeClosesAtMs: number;
  readonly evidenceClosesAtMs: number;
  readonly cadenceMs: 2_000;
  readonly detectorInputSourceId: string;
  readonly detectorInputSourceDigest: `sha256:${string}`;
  readonly config: Readonly<{
    enabled: false;
    killSwitchEngaged: true;
  }>;
}

export interface VolumeForwardDetectorCoveragePolicy
  extends VolumeForwardDetectorCoveragePolicyInput {
  readonly schemaVersion:
    typeof VOLUME_FORWARD_DETECTOR_COVERAGE_POLICY_SCHEMA;
  readonly policyDigest: `sha256:${string}`;
  readonly authority: typeof VOLUME_FORWARD_MEASUREMENT_AUTHORITY;
}

export interface VolumeForwardAggTrade {
  readonly kind: 'AGG_TRADE';
  readonly symbol: string;
  readonly aggregateTradeId: number;
  readonly firstTradeId: number;
  readonly lastTradeId: number;
  readonly eventTimeMs: number;
  readonly tradeTimeMs: number;
  readonly price: string;
  readonly quantity: string;
  readonly buyerIsMaker: boolean;
  readonly generation: number;
  readonly receivedMonotonicNs: string;
  readonly receivedAtMs: number;
  readonly stream: string;
}

export type VolumeForwardAggregateTrade = VolumeForwardAggTrade;

export interface VolumeForwardTrade {
  readonly kind: 'TRADE';
  readonly symbol: string;
  readonly tradeId: number;
  readonly eventTimeMs: number;
  readonly tradeTimeMs: number;
  readonly price: string;
  readonly quantity: string;
  readonly buyerIsMaker: boolean;
  readonly generation: number;
  readonly receivedMonotonicNs: string;
  readonly receivedAtMs: number;
  readonly stream: string;
}

export interface VolumeForwardBookTicker {
  readonly kind: 'BOOK_TICKER';
  readonly symbol: string;
  readonly updateId: number;
  readonly bidPrice: string;
  readonly bidQuantity: string;
  readonly askPrice: string;
  readonly askQuantity: string;
  readonly generation: number;
  readonly receivedMonotonicNs: string;
  readonly receivedAtMs: number;
  readonly stream: string;
}

export interface VolumeForwardDepthDiff {
  readonly kind: 'DEPTH_DIFF';
  readonly symbol: string;
  readonly eventTimeMs: number;
  readonly firstUpdateId: number;
  readonly finalUpdateId: number;
  readonly bids: readonly DepthLevelTuple[];
  readonly asks: readonly DepthLevelTuple[];
  readonly generation: number;
  readonly receivedMonotonicNs: string;
  readonly receivedAtMs: number;
  readonly stream: string;
}

export type VolumeForwardPublicPayload =
  | VolumeForwardAggTrade
  | VolumeForwardTrade
  | VolumeForwardBookTicker
  | VolumeForwardDepthDiff;

export interface ParseVolumeForwardPublicPayloadInput {
  readonly rawPayload: string | Uint8Array;
  readonly generation: number;
  readonly receivedMonotonicNs: string;
  readonly receivedAtMs: number;
  /**
   * Required for raw payloads. An exact combined envelope may supply the same
   * provenance itself; when both are present they must match byte-for-byte.
   */
  readonly sourceStream?: string;
}

export interface VolumeForwardDepthSnapshot {
  readonly kind: 'DEPTH_SNAPSHOT';
  readonly symbol: string;
  readonly lastUpdateId: number;
  readonly bids: readonly DepthLevelTuple[];
  readonly asks: readonly DepthLevelTuple[];
  readonly generation: number;
  readonly receivedMonotonicNs: string;
  readonly receivedAtMs: number;
}

export type VolumeForwardDepthInput =
  | VolumeForwardDepthDiff
  | VolumeForwardDepthSnapshot
  | VolumeForwardBookTicker;

export type VolumeForwardDepthStatus =
  | 'BUFFERING'
  | 'SYNCHRONIZED'
  | 'GAPPED'
  | 'FENCED'
  | 'INVALID_BOOK'
  | 'REQUIRES_CHECKPOINT';

export type VolumeForwardDepthContinuity =
  | 'AWAITING_SNAPSHOT'
  | 'AWAITING_BRIDGE'
  | 'CONTIGUOUS'
  | 'GAP_DETECTED'
  | 'GENERATION_MISMATCH'
  | 'NON_MONOTONIC_RECEIVE_CLOCK'
  | 'CROSSED_BOOK'
  | 'PROOF_RANGE_LIMIT_REACHED'
  | 'BUFFER_LIMIT_REACHED'
  | 'DEPTH_LEVEL_LIMIT_REACHED';

export interface VolumeForwardDepthAppliedRange {
  readonly firstUpdateId: number;
  readonly finalUpdateId: number;
  readonly eventTimeMs: number;
  readonly receivedMonotonicNs: string;
}

export interface VolumeForwardDepthState {
  readonly schemaVersion: typeof VOLUME_FORWARD_DEPTH_STATE_SCHEMA;
  readonly symbol: string;
  readonly generation: number;
  readonly status: VolumeForwardDepthStatus;
  readonly continuity: VolumeForwardDepthContinuity;
  readonly snapshotLastUpdateId: number | null;
  /**
   * The REST snapshot is a bounded price horizon, not proof that deeper
   * unchanged levels did not exist. These immutable receipt facts let replay
   * reject a modeled fill that would cross the captured horizon.
   */
  readonly snapshotBidLevelCount: number;
  readonly snapshotAskLevelCount: number;
  readonly snapshotBidFloorPrice: string | null;
  readonly snapshotAskCeilingPrice: string | null;
  readonly lastUpdateId: number | null;
  readonly sourceRevision: number;
  readonly bids: readonly DepthLevelTuple[];
  readonly asks: readonly DepthLevelTuple[];
  readonly updateRanges: readonly Readonly<VolumeForwardDepthAppliedRange>[];
  readonly bufferedDiffs: readonly Readonly<VolumeForwardDepthDiff>[];
  readonly bufferedDiffCount: number;
  readonly lastReceivedMonotonicNs: string | null;
  readonly lastReceivedAtMs: number | null;
  readonly lastInputDisposition:
    | 'CREATED'
    | 'BUFFERED'
    | 'SNAPSHOT_APPLIED'
    | 'DIFF_APPLIED'
    | 'STALE_DIFF_IGNORED'
    | 'BOOK_TICKER_NOT_DEPTH_PROOF'
    | 'REJECTED';
}

export interface ParseVolumeForwardDepthSnapshotInput {
  readonly rawPayload: string | Uint8Array;
  readonly symbol: string;
  readonly generation: number;
  readonly receivedMonotonicNs: string;
  readonly receivedAtMs: number;
}

export interface VolumeForwardExchangeInfoSnapshot {
  readonly schemaVersion: 'cosmos.engine.volume.forward-exchange-info.v1';
  readonly symbol: string;
  readonly status: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly spotTradingAllowed: boolean;
  readonly orderTypes: readonly string[];
  readonly permissions: readonly string[];
  readonly filters: readonly PlainRecord[];
  readonly generation: number;
  readonly receivedMonotonicNs: string;
  readonly receivedAtMs: number;
  readonly rawPayloadSha256: `sha256:${string}`;
}

export interface ParseVolumeForwardExchangeInfoInput {
  readonly rawPayload: string | Uint8Array;
  readonly symbol: string;
  readonly generation: number;
  readonly receivedMonotonicNs: string;
  readonly receivedAtMs: number;
}

export interface VolumeForwardPointInTimeControls {
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly filterDigest: string;
  readonly killStateDigest: string;
  readonly enabled: false;
  readonly killSwitchEngaged: true;
  readonly capturedAtMs: number;
  readonly receivedMonotonicNs: string;
}

export interface VolumeForwardDetectorProposalBinding {
  readonly proposalId: string;
  readonly proposalRevision: number;
  readonly proposalDigest: string;
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly controlsCapturedAtMs: number;
  readonly controlsReceivedMonotonicNs: string;
  readonly correlationId: string;
  readonly symbol: string;
  readonly direction: 'long' | 'short';
  readonly updatedTs: number;
  readonly featureObservedAtMs: number;
  readonly expiresAtMs: number;
  readonly detectorDecisionDigest: string;
  readonly featureDigest: string;
  readonly filterDigest: string;
  readonly killStateDigest: string;
  readonly generation: number;
  readonly receivedMonotonicNs: string;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value as Readonly<T>;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child, seen);
    }
  }
  return Object.freeze(value);
}

function isPollutionKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function ownPlainRecord(
  value: unknown,
  expectedKeys?: readonly string[],
): PlainRecord | null {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return null;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.some((key) => typeof key !== 'string' || isPollutionKey(key))
      || keys.length > 256
    ) return null;
    const out: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || !('value' in descriptor)
        || descriptor.enumerable !== true
      ) return null;
      out[key] = descriptor.value;
    }
    const actual = Object.keys(out).sort();
    if (
      expectedKeys !== undefined
      && (
        actual.length !== expectedKeys.length
        || actual.some((key, index) => key !== [...expectedKeys].sort()[index])
      )
    ) return null;
    return Object.freeze(out);
  } catch {
    return null;
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError('forward measurement canonical number is invalid');
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const record = ownPlainRecord(value);
  if (record === null) throw new TypeError('forward measurement canonical data is invalid');
  return `{${Object.keys(record).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
  ).join(',')}}`;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function payloadBytes(value: string | Uint8Array): Uint8Array {
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.byteLength > VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumPayloadBytes) {
      throw new RangeError('forward measurement payload exceeds bound');
    }
    return Uint8Array.from(bytes);
  }
  if (!(value instanceof Uint8Array)) {
    throw new TypeError('forward measurement payload must be bytes or UTF-8 text');
  }
  if (value.byteLength > VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumPayloadBytes) {
    throw new RangeError('forward measurement payload exceeds bound');
  }
  return Uint8Array.from(value);
}

function payloadText(value: string | Uint8Array): string {
  if (typeof value === 'string') {
    payloadBytes(value);
    return value;
  }
  const bytes = payloadBytes(value);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError('forward measurement public payload is not UTF-8');
  }
}

function validUtcMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MS
    && !Object.is(value, -0);
}

function validSafeNonNegative(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0);
}

function validGeneration(value: unknown): value is number {
  return validSafeNonNegative(value) && value >= 1;
}

function validMonotonicNs(value: unknown): value is string {
  return typeof value === 'string' && MONOTONIC_NS.test(value);
}

function validSourceDecimal(value: unknown, allowZero: boolean): value is string {
  if (
    typeof value !== 'string'
    || value.length > MAX_SOURCE_DECIMAL_CHARS
    || !SOURCE_DECIMAL.test(value)
  ) return false;
  if (allowZero) return true;
  return /[1-9]/.test(value);
}

function decimalIdentity(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction.length === 0 ? whole : `${whole}.${trimmedFraction}`;
}

function compareDecimal(left: string, right: string): number {
  const parse = (value: string): { coefficient: bigint; scale: number } => {
    const [whole, fraction = ''] = value.split('.');
    return {
      coefficient: BigInt(`${whole}${fraction}`),
      scale: fraction.length,
    };
  };
  const a = parse(left);
  const b = parse(right);
  const scale = Math.max(a.scale, b.scale);
  const ac = a.coefficient * (10n ** BigInt(scale - a.scale));
  const bc = b.coefficient * (10n ** BigInt(scale - b.scale));
  return ac < bc ? -1 : ac > bc ? 1 : 0;
}

function exactKeys(record: PlainRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function ownDenseArray(
  value: unknown,
  maximum: number,
): readonly unknown[] | null {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || !Number.isSafeInteger(value.length)
    || value.length > maximum
  ) return null;
  try {
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== value.length + 1
      || keys.some((key) => (
        typeof key !== 'string'
        || (
          key !== 'length'
          && (
            !/^(?:0|[1-9][0-9]*)$/.test(key)
            || Number(key) >= value.length
          )
        )
      ))
    ) return null;
    const out: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined
        || !('value' in descriptor)
        || descriptor.enumerable !== true
      ) return null;
      out.push(descriptor.value);
    }
    return Object.freeze(out);
  } catch {
    return null;
  }
}

function cloneLevels(
  input: unknown,
  allowZeroQuantity: boolean,
  maximum = VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumDepthLevelsPerSide,
): readonly DepthLevelTuple[] {
  const candidates = ownDenseArray(input, maximum);
  if (candidates === null) {
    throw new TypeError('forward measurement depth levels are invalid');
  }
  const seen = new Set<string>();
  const levels: DepthLevelTuple[] = [];
  for (const candidate of candidates) {
    const tuple = ownDenseArray(candidate, 2);
    if (
      tuple === null
      || tuple.length !== 2
      || !validSourceDecimal(tuple[0], false)
      || !validSourceDecimal(tuple[1], allowZeroQuantity)
    ) throw new TypeError('forward measurement depth level is invalid');
    const priceIdentity = decimalIdentity(tuple[0]);
    if (seen.has(priceIdentity)) {
      throw new TypeError('forward measurement depth price is duplicated');
    }
    seen.add(priceIdentity);
    levels.push(Object.freeze([tuple[0], tuple[1]]));
  }
  return Object.freeze(levels);
}

function sortBids(levels: Iterable<DepthLevelTuple>): readonly DepthLevelTuple[] {
  return Object.freeze([...levels].sort((left, right) => compareDecimal(right[0], left[0])));
}

function sortAsks(levels: Iterable<DepthLevelTuple>): readonly DepthLevelTuple[] {
  return Object.freeze([...levels].sort((left, right) => compareDecimal(left[0], right[0])));
}

function uncrossed(
  bids: readonly DepthLevelTuple[],
  asks: readonly DepthLevelTuple[],
): boolean {
  return bids.length === 0 || asks.length === 0 || compareDecimal(bids[0][0], asks[0][0]) < 0;
}

function validStreamForSymbol(stream: string, symbol: string): boolean {
  return STREAM.test(stream) && stream.startsWith(`${symbol.toLowerCase()}@`);
}

function requiredStreamsForSymbol(symbol: string): readonly string[] {
  const prefix = symbol.toLowerCase();
  return Object.freeze([
    `${prefix}@depth@100ms`,
    `${prefix}@aggTrade`,
    `${prefix}@trade`,
    `${prefix}@bookTicker`,
  ]);
}

function parseJsonPayload(rawPayload: string | Uint8Array): unknown {
  try {
    return JSON.parse(payloadText(rawPayload));
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) throw error;
    throw new TypeError('forward measurement public payload is not valid JSON');
  }
}

function uniqueFilter(
  filters: readonly PlainRecord[],
  filterType: string,
): PlainRecord | null {
  const matches = filters.filter((filter) => filter.filterType === filterType);
  return matches.length === 1 ? matches[0] : null;
}

function validRequiredVolumeFilters(
  filters: readonly PlainRecord[],
): boolean {
  const price = uniqueFilter(filters, 'PRICE_FILTER');
  const lot = uniqueFilter(filters, 'LOT_SIZE');
  const notionalVariants = filters.filter(
    (filter) => (
      filter.filterType === 'NOTIONAL'
      || filter.filterType === 'MIN_NOTIONAL'
    ),
  );
  if (
    price === null
    || lot === null
    || notionalVariants.length !== 1
    || !exactKeys(price, [
      'filterType',
      'maxPrice',
      'minPrice',
      'tickSize',
    ])
    || !validSourceDecimal(price.minPrice, true)
    || !validSourceDecimal(price.maxPrice, true)
    || !validSourceDecimal(price.tickSize, false)
    || (
      /[1-9]/.test(price.minPrice)
      && /[1-9]/.test(price.maxPrice)
      && compareDecimal(price.minPrice, price.maxPrice) > 0
    )
    || !exactKeys(lot, [
      'filterType',
      'maxQty',
      'minQty',
      'stepSize',
    ])
    || !validSourceDecimal(lot.minQty, false)
    || !validSourceDecimal(lot.maxQty, false)
    || !validSourceDecimal(lot.stepSize, false)
    || compareDecimal(lot.minQty, lot.maxQty) > 0
    || compareDecimal(lot.stepSize, lot.maxQty) > 0
  ) return false;
  const notional = notionalVariants[0];
  if (notional.filterType === 'NOTIONAL') {
    return exactKeys(notional, [
      'applyMaxToMarket',
      'applyMinToMarket',
      'avgPriceMins',
      'filterType',
      'maxNotional',
      'minNotional',
    ])
      && validSourceDecimal(notional.minNotional, false)
      && validSourceDecimal(notional.maxNotional, false)
      && compareDecimal(notional.minNotional, notional.maxNotional) <= 0
      && typeof notional.applyMinToMarket === 'boolean'
      && typeof notional.applyMaxToMarket === 'boolean'
      && validSafeNonNegative(notional.avgPriceMins);
  }
  return exactKeys(notional, [
    'applyToMarket',
    'avgPriceMins',
    'filterType',
    'minNotional',
  ])
    && validSourceDecimal(notional.minNotional, false)
    && typeof notional.applyToMarket === 'boolean'
    && validSafeNonNegative(notional.avgPriceMins);
}

function policySemantic(input: VolumeForwardMeasurementPolicyInput): PlainRecord {
  return Object.freeze({
    authority: VOLUME_FORWARD_MEASUREMENT_AUTHORITY,
    config: Object.freeze({
      enabled: input.config.enabled,
      killSwitchEngaged: input.config.killSwitchEngaged,
    }),
    evidenceClosesAtMs: input.evidenceClosesAtMs,
    frozenAtMs: input.frozenAtMs,
    outcomeClosesAtMs: input.outcomeClosesAtMs,
    outcomeOpensAtMs: input.outcomeOpensAtMs,
    policyId: input.policyId,
    policyRevision: input.policyRevision,
    schemaVersion: VOLUME_FORWARD_MEASUREMENT_POLICY_SCHEMA,
    streams: Object.freeze([...input.streams]),
    symbol: input.symbol,
  });
}

export function buildVolumeForwardMeasurementPolicy(
  input: unknown,
): Readonly<VolumeForwardMeasurementPolicy> {
  const record = ownPlainRecord(input, [
    'config',
    'evidenceClosesAtMs',
    'frozenAtMs',
    'outcomeClosesAtMs',
    'outcomeOpensAtMs',
    'policyId',
    'policyRevision',
    'streams',
    'symbol',
  ]);
  const config = record === null
    ? null
    : ownPlainRecord(record.config, ['enabled', 'killSwitchEngaged']);
  const streams = record === null
    ? null
    : ownDenseArray(
        record.streams,
        VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumStreams,
      );
  const expectedStreams = record !== null && typeof record.symbol === 'string'
    ? [...requiredStreamsForSymbol(record.symbol)].sort()
    : [];
  if (
    record === null
    || config === null
    || typeof record.policyId !== 'string'
    || !POLICY_ID.test(record.policyId)
    || !validSafeNonNegative(record.policyRevision)
    || record.policyRevision < 1
    || typeof record.symbol !== 'string'
    || !SYMBOL.test(record.symbol)
    || !validUtcMs(record.frozenAtMs)
    || !validUtcMs(record.outcomeOpensAtMs)
    || !validUtcMs(record.outcomeClosesAtMs)
    || !validUtcMs(record.evidenceClosesAtMs)
    || record.outcomeOpensAtMs <= record.frozenAtMs
    || record.outcomeClosesAtMs <= record.outcomeOpensAtMs
    || record.evidenceClosesAtMs < record.outcomeClosesAtMs
    || streams === null
    || streams.length !== expectedStreams.length
    || streams.some(
      (stream) => typeof stream !== 'string'
        || !validStreamForSymbol(stream, record.symbol as string),
    )
    || [...streams].sort().some(
      (stream, index) => stream !== expectedStreams[index],
    )
    || config.enabled !== false
    || config.killSwitchEngaged !== true
  ) throw new TypeError('forward measurement policy is invalid');
  const semantic = policySemantic({
    policyId: record.policyId,
    policyRevision: record.policyRevision,
    symbol: record.symbol,
    evidenceClosesAtMs: record.evidenceClosesAtMs,
    frozenAtMs: record.frozenAtMs,
    outcomeOpensAtMs: record.outcomeOpensAtMs,
    outcomeClosesAtMs: record.outcomeClosesAtMs,
    streams: streams as readonly string[],
    config: {
      enabled: false,
      killSwitchEngaged: true,
    },
  });
  return deepFreeze({
    ...semantic,
    policyDigest: digest(semantic),
  }) as Readonly<VolumeForwardMeasurementPolicy>;
}

export function validateVolumeForwardMeasurementPolicy(
  value: unknown,
): value is Readonly<VolumeForwardMeasurementPolicy> {
  const record = ownPlainRecord(value, [
    'authority',
    'config',
    'evidenceClosesAtMs',
    'frozenAtMs',
    'outcomeClosesAtMs',
    'outcomeOpensAtMs',
    'policyDigest',
    'policyId',
    'policyRevision',
    'schemaVersion',
    'streams',
    'symbol',
  ]);
  if (
    record === null
    || record.schemaVersion !== VOLUME_FORWARD_MEASUREMENT_POLICY_SCHEMA
    || typeof record.policyDigest !== 'string'
    || !DIGEST.test(record.policyDigest)
    || canonicalJson(record.authority) !== canonicalJson(VOLUME_FORWARD_MEASUREMENT_AUTHORITY)
  ) return false;
  try {
    const rebuilt = buildVolumeForwardMeasurementPolicy({
      config: record.config,
      evidenceClosesAtMs: record.evidenceClosesAtMs,
      frozenAtMs: record.frozenAtMs,
      outcomeClosesAtMs: record.outcomeClosesAtMs,
      outcomeOpensAtMs: record.outcomeOpensAtMs,
      policyId: record.policyId,
      policyRevision: record.policyRevision,
      streams: record.streams,
      symbol: record.symbol,
    });
    return canonicalJson(rebuilt) === canonicalJson(record);
  } catch {
    return false;
  }
}

function detectorCoveragePolicySemantic(
  input: VolumeForwardDetectorCoveragePolicyInput,
): PlainRecord {
  return Object.freeze({
    authority: VOLUME_FORWARD_MEASUREMENT_AUTHORITY,
    cadenceMs: input.cadenceMs,
    config: Object.freeze({
      enabled: input.config.enabled,
      killSwitchEngaged: input.config.killSwitchEngaged,
    }),
    detectorInputSourceDigest: input.detectorInputSourceDigest,
    detectorInputSourceId: input.detectorInputSourceId,
    evidenceClosesAtMs: input.evidenceClosesAtMs,
    frozenAtMs: input.frozenAtMs,
    outcomeClosesAtMs: input.outcomeClosesAtMs,
    outcomeOpensAtMs: input.outcomeOpensAtMs,
    policyId: input.policyId,
    policyRevision: input.policyRevision,
    role: input.role,
    schemaVersion: VOLUME_FORWARD_DETECTOR_COVERAGE_POLICY_SCHEMA,
    symbol: null,
  });
}

export function buildVolumeForwardDetectorCoveragePolicy(
  input: unknown,
): Readonly<VolumeForwardDetectorCoveragePolicy> {
  const record = ownPlainRecord(input, [
    'cadenceMs',
    'config',
    'detectorInputSourceDigest',
    'detectorInputSourceId',
    'evidenceClosesAtMs',
    'frozenAtMs',
    'outcomeClosesAtMs',
    'outcomeOpensAtMs',
    'policyId',
    'policyRevision',
    'role',
    'symbol',
  ]);
  const config = record === null
    ? null
    : ownPlainRecord(record.config, ['enabled', 'killSwitchEngaged']);
  if (
    record === null
    || config === null
    || typeof record.policyId !== 'string'
    || !POLICY_ID.test(record.policyId)
    || !validSafeNonNegative(record.policyRevision)
    || record.policyRevision < 1
    || record.role !== 'DETECTOR_COVERAGE'
    || record.symbol !== null
    || !validUtcMs(record.frozenAtMs)
    || !validUtcMs(record.outcomeOpensAtMs)
    || !validUtcMs(record.outcomeClosesAtMs)
    || !validUtcMs(record.evidenceClosesAtMs)
    || record.outcomeOpensAtMs <= record.frozenAtMs
    || record.outcomeClosesAtMs <= record.outcomeOpensAtMs
    || record.evidenceClosesAtMs < record.outcomeClosesAtMs
    || record.cadenceMs !== 2_000
    || typeof record.detectorInputSourceId !== 'string'
    || !SOURCE_ID.test(record.detectorInputSourceId)
    || typeof record.detectorInputSourceDigest !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(record.detectorInputSourceDigest)
    || config.enabled !== false
    || config.killSwitchEngaged !== true
  ) throw new TypeError('forward detector coverage policy is invalid');
  const semantic = detectorCoveragePolicySemantic({
    policyId: record.policyId,
    policyRevision: record.policyRevision,
    role: 'DETECTOR_COVERAGE',
    symbol: null,
    frozenAtMs: record.frozenAtMs,
    outcomeOpensAtMs: record.outcomeOpensAtMs,
    outcomeClosesAtMs: record.outcomeClosesAtMs,
    evidenceClosesAtMs: record.evidenceClosesAtMs,
    cadenceMs: 2_000,
    detectorInputSourceId: record.detectorInputSourceId,
    detectorInputSourceDigest:
      record.detectorInputSourceDigest as `sha256:${string}`,
    config: {
      enabled: false,
      killSwitchEngaged: true,
    },
  });
  return deepFreeze({
    ...semantic,
    policyDigest: digest(semantic),
  }) as Readonly<VolumeForwardDetectorCoveragePolicy>;
}

export function validateVolumeForwardDetectorCoveragePolicy(
  value: unknown,
): value is Readonly<VolumeForwardDetectorCoveragePolicy> {
  const record = ownPlainRecord(value, [
    'authority',
    'cadenceMs',
    'config',
    'detectorInputSourceDigest',
    'detectorInputSourceId',
    'evidenceClosesAtMs',
    'frozenAtMs',
    'outcomeClosesAtMs',
    'outcomeOpensAtMs',
    'policyDigest',
    'policyId',
    'policyRevision',
    'role',
    'schemaVersion',
    'symbol',
  ]);
  if (
    record === null
    || record.schemaVersion !== VOLUME_FORWARD_DETECTOR_COVERAGE_POLICY_SCHEMA
    || typeof record.policyDigest !== 'string'
    || !DIGEST.test(record.policyDigest)
    || canonicalJson(record.authority)
      !== canonicalJson(VOLUME_FORWARD_MEASUREMENT_AUTHORITY)
  ) return false;
  try {
    const rebuilt = buildVolumeForwardDetectorCoveragePolicy({
      cadenceMs: record.cadenceMs,
      config: record.config,
      detectorInputSourceDigest: record.detectorInputSourceDigest,
      detectorInputSourceId: record.detectorInputSourceId,
      evidenceClosesAtMs: record.evidenceClosesAtMs,
      frozenAtMs: record.frozenAtMs,
      outcomeClosesAtMs: record.outcomeClosesAtMs,
      outcomeOpensAtMs: record.outcomeOpensAtMs,
      policyId: record.policyId,
      policyRevision: record.policyRevision,
      role: record.role,
      symbol: record.symbol,
    });
    return canonicalJson(rebuilt) === canonicalJson(record);
  } catch {
    return false;
  }
}

function commonReceipt(
  input: PlainRecord,
): Readonly<{
  generation: number;
  receivedMonotonicNs: string;
  receivedAtMs: number;
}> {
  if (
    !validGeneration(input.generation)
    || !validMonotonicNs(input.receivedMonotonicNs)
    || !validUtcMs(input.receivedAtMs)
  ) throw new TypeError('forward measurement receipt is invalid');
  return Object.freeze({
    generation: input.generation,
    receivedMonotonicNs: input.receivedMonotonicNs,
    receivedAtMs: input.receivedAtMs,
  });
}

function checkedEventTime(
  eventTimeMs: unknown,
  tradeTimeMs: unknown,
  receivedAtMs: number,
): Readonly<{ eventTimeMs: number; tradeTimeMs: number }> {
  if (
    !validUtcMs(eventTimeMs)
    || !validUtcMs(tradeTimeMs)
    || tradeTimeMs > eventTimeMs
    || eventTimeMs > receivedAtMs
  ) throw new TypeError('forward measurement source clock is invalid');
  return Object.freeze({ eventTimeMs, tradeTimeMs });
}

export function parseVolumeForwardPublicPayload(
  input: ParseVolumeForwardPublicPayloadInput,
): Readonly<VolumeForwardPublicPayload> {
  const inputRecord = ownPlainRecord(input);
  if (
    inputRecord === null
    || !(
      exactKeys(inputRecord, [
        'generation',
        'rawPayload',
        'receivedAtMs',
        'receivedMonotonicNs',
      ])
      || exactKeys(inputRecord, [
        'generation',
        'rawPayload',
        'receivedAtMs',
        'receivedMonotonicNs',
        'sourceStream',
      ])
    )
  ) throw new TypeError('forward measurement parser input is invalid');
  const receipt = commonReceipt(inputRecord);
  const declaredStream = inputRecord.sourceStream;
  if (
    declaredStream !== undefined
    && (typeof declaredStream !== 'string' || !STREAM.test(declaredStream))
  ) throw new TypeError('forward measurement source stream is invalid');
  const decoded = parseJsonPayload(
    inputRecord.rawPayload as string | Uint8Array,
  );
  const root = ownPlainRecord(decoded);
  if (root === null) throw new TypeError('forward measurement stream envelope is invalid');
  let stream: string;
  let payload: PlainRecord;
  if (exactKeys(root, ['data', 'stream'])) {
    if (typeof root.stream !== 'string' || !STREAM.test(root.stream)) {
      throw new TypeError('forward measurement stream name is invalid');
    }
    if (declaredStream !== undefined && declaredStream !== root.stream) {
      throw new TypeError('forward measurement stream provenance mismatch');
    }
    stream = root.stream;
    const data = ownPlainRecord(root.data);
    if (data === null) throw new TypeError('forward measurement stream data is invalid');
    payload = data;
  } else {
    if ('data' in root || 'stream' in root) {
      throw new TypeError('forward measurement combined stream envelope is invalid');
    }
    if (typeof declaredStream !== 'string') {
      throw new TypeError('forward measurement raw stream provenance is required');
    }
    stream = declaredStream;
    payload = root;
  }

  if (payload.e === 'aggTrade') {
    if (!exactKeys(payload, ['E', 'M', 'T', 'a', 'e', 'f', 'l', 'm', 'p', 'q', 's'])) {
      throw new TypeError('forward measurement aggTrade shape is invalid');
    }
    if (
      typeof payload.s !== 'string'
      || !SYMBOL.test(payload.s)
      || !validSafeNonNegative(payload.a)
      || !validSafeNonNegative(payload.f)
      || !validSafeNonNegative(payload.l)
      || payload.f > payload.l
      || !validSourceDecimal(payload.p, false)
      || !validSourceDecimal(payload.q, false)
      || typeof payload.m !== 'boolean'
      || typeof payload.M !== 'boolean'
    ) throw new TypeError('forward measurement aggTrade is invalid');
    const expectedStream = `${payload.s.toLowerCase()}@aggTrade`;
    if (stream !== expectedStream) {
      throw new TypeError('forward measurement aggTrade stream mismatch');
    }
    const times = checkedEventTime(payload.E, payload.T, receipt.receivedAtMs);
    return deepFreeze({
      kind: 'AGG_TRADE' as const,
      symbol: payload.s,
      aggregateTradeId: payload.a,
      firstTradeId: payload.f,
      lastTradeId: payload.l,
      ...times,
      price: payload.p,
      quantity: payload.q,
      buyerIsMaker: payload.m,
      ...receipt,
      stream: expectedStream,
    });
  }

  if (payload.e === 'trade') {
    if (!exactKeys(payload, ['E', 'M', 'T', 'e', 'm', 'p', 'q', 's', 't'])) {
      throw new TypeError('forward measurement trade shape is invalid');
    }
    if (
      typeof payload.s !== 'string'
      || !SYMBOL.test(payload.s)
      || !validSafeNonNegative(payload.t)
      || !validSourceDecimal(payload.p, false)
      || !validSourceDecimal(payload.q, false)
      || typeof payload.m !== 'boolean'
      || typeof payload.M !== 'boolean'
    ) throw new TypeError('forward measurement trade is invalid');
    const expectedStream = `${payload.s.toLowerCase()}@trade`;
    if (stream !== expectedStream) {
      throw new TypeError('forward measurement trade stream mismatch');
    }
    const times = checkedEventTime(payload.E, payload.T, receipt.receivedAtMs);
    return deepFreeze({
      kind: 'TRADE' as const,
      symbol: payload.s,
      tradeId: payload.t,
      ...times,
      price: payload.p,
      quantity: payload.q,
      buyerIsMaker: payload.m,
      ...receipt,
      stream: expectedStream,
    });
  }

  if (payload.e === 'depthUpdate') {
    if (!exactKeys(payload, ['E', 'U', 'a', 'b', 'e', 's', 'u'])) {
      throw new TypeError('forward measurement depth diff shape is invalid');
    }
    if (
      typeof payload.s !== 'string'
      || !SYMBOL.test(payload.s)
      || !validUtcMs(payload.E)
      || !validSafeNonNegative(payload.U)
      || !validSafeNonNegative(payload.u)
      || payload.U > payload.u
      || payload.E > receipt.receivedAtMs
    ) throw new TypeError('forward measurement depth diff is invalid');
    const bids = cloneLevels(payload.b, true);
    const asks = cloneLevels(payload.a, true);
    const expectedStream = `${payload.s.toLowerCase()}@depth@100ms`;
    if (stream !== expectedStream) {
      throw new TypeError('forward measurement depth stream mismatch');
    }
    return deepFreeze({
      kind: 'DEPTH_DIFF' as const,
      symbol: payload.s,
      eventTimeMs: payload.E,
      firstUpdateId: payload.U,
      finalUpdateId: payload.u,
      bids,
      asks,
      ...receipt,
      stream: expectedStream,
    });
  }

  if (
    exactKeys(payload, ['A', 'B', 'a', 'b', 's', 'u'])
    && typeof payload.s === 'string'
  ) {
    if (
      !SYMBOL.test(payload.s)
      || !validSafeNonNegative(payload.u)
      || !validSourceDecimal(payload.b, false)
      || !validSourceDecimal(payload.B, false)
      || !validSourceDecimal(payload.a, false)
      || !validSourceDecimal(payload.A, false)
      || compareDecimal(payload.b, payload.a) >= 0
    ) throw new TypeError('forward measurement bookTicker is invalid');
    const expectedStream = `${payload.s.toLowerCase()}@bookTicker`;
    if (stream !== expectedStream) {
      throw new TypeError('forward measurement bookTicker stream mismatch');
    }
    return deepFreeze({
      kind: 'BOOK_TICKER' as const,
      symbol: payload.s,
      updateId: payload.u,
      bidPrice: payload.b,
      bidQuantity: payload.B,
      askPrice: payload.a,
      askQuantity: payload.A,
      ...receipt,
      stream: expectedStream,
    });
  }
  throw new TypeError('forward measurement public payload kind is unsupported');
}

export function parseVolumeForwardDepthSnapshot(
  input: ParseVolumeForwardDepthSnapshotInput,
): Readonly<VolumeForwardDepthSnapshot> {
  const inputRecord = ownPlainRecord(input, [
    'generation',
    'rawPayload',
    'receivedAtMs',
    'receivedMonotonicNs',
    'symbol',
  ]);
  if (
    inputRecord === null
    || typeof inputRecord.symbol !== 'string'
    || !SYMBOL.test(inputRecord.symbol)
    || !validGeneration(inputRecord.generation)
    || !validMonotonicNs(inputRecord.receivedMonotonicNs)
    || !validUtcMs(inputRecord.receivedAtMs)
  ) throw new TypeError('forward measurement depth snapshot receipt is invalid');
  const parsed = ownPlainRecord(parseJsonPayload(
    inputRecord.rawPayload as string | Uint8Array,
  ));
  if (
    parsed === null
    || !exactKeys(parsed, ['asks', 'bids', 'lastUpdateId'])
    || !validSafeNonNegative(parsed.lastUpdateId)
  ) throw new TypeError('forward measurement depth snapshot is invalid');
  const bids = sortBids(cloneLevels(parsed.bids, false));
  const asks = sortAsks(cloneLevels(parsed.asks, false));
  if (bids.length === 0 || asks.length === 0 || !uncrossed(bids, asks)) {
    throw new TypeError('forward measurement depth snapshot is crossed');
  }
  return deepFreeze({
    kind: 'DEPTH_SNAPSHOT' as const,
    symbol: inputRecord.symbol,
    lastUpdateId: parsed.lastUpdateId,
    bids,
    asks,
    generation: inputRecord.generation,
    receivedMonotonicNs: inputRecord.receivedMonotonicNs,
    receivedAtMs: inputRecord.receivedAtMs,
  });
}

export function createVolumeForwardDepthState(
  input: Readonly<{ symbol: string; generation: number }>,
): Readonly<VolumeForwardDepthState> {
  const record = ownPlainRecord(input, ['generation', 'symbol']);
  if (
    record === null
    || typeof record.symbol !== 'string'
    || !SYMBOL.test(record.symbol)
    || !validGeneration(record.generation)
  ) {
    throw new TypeError('forward measurement depth state scope is invalid');
  }
  return deepFreeze({
    schemaVersion: VOLUME_FORWARD_DEPTH_STATE_SCHEMA,
    symbol: record.symbol,
    generation: record.generation,
    status: 'BUFFERING' as const,
    continuity: 'AWAITING_SNAPSHOT' as const,
    snapshotLastUpdateId: null,
    snapshotBidLevelCount: 0,
    snapshotAskLevelCount: 0,
    snapshotBidFloorPrice: null,
    snapshotAskCeilingPrice: null,
    lastUpdateId: null,
    sourceRevision: 0,
    bids: Object.freeze([]) as readonly DepthLevelTuple[],
    asks: Object.freeze([]) as readonly DepthLevelTuple[],
    updateRanges: Object.freeze([]) as readonly Readonly<VolumeForwardDepthAppliedRange>[],
    bufferedDiffs: Object.freeze([]) as readonly Readonly<VolumeForwardDepthDiff>[],
    bufferedDiffCount: 0,
    lastReceivedMonotonicNs: null,
    lastReceivedAtMs: null,
    lastInputDisposition: 'CREATED' as const,
  });
}

function stateWith(
  state: Readonly<VolumeForwardDepthState>,
  patch: Partial<VolumeForwardDepthState>,
): Readonly<VolumeForwardDepthState> {
  return deepFreeze({ ...state, ...patch }) as Readonly<VolumeForwardDepthState>;
}

function fencedState(
  state: Readonly<VolumeForwardDepthState>,
  continuity: 'GENERATION_MISMATCH' | 'NON_MONOTONIC_RECEIVE_CLOCK',
): Readonly<VolumeForwardDepthState> {
  return stateWith(state, {
    status: 'FENCED',
    continuity,
    lastInputDisposition: 'REJECTED',
  });
}

function validatedDepthInput(
  input: unknown,
): Readonly<VolumeForwardDepthInput> {
  const record = ownPlainRecord(input);
  if (record === null) {
    throw new TypeError('forward measurement depth input is invalid');
  }
  if (
    typeof record.symbol !== 'string'
    || !SYMBOL.test(record.symbol)
    || !validGeneration(record.generation)
    || !validMonotonicNs(record.receivedMonotonicNs)
    || !validUtcMs(record.receivedAtMs)
  ) throw new TypeError('forward measurement depth input receipt is invalid');
  if (record.kind === 'DEPTH_DIFF') {
    if (
      !exactKeys(record, [
        'asks',
        'bids',
        'eventTimeMs',
        'finalUpdateId',
        'firstUpdateId',
        'generation',
        'kind',
        'receivedAtMs',
        'receivedMonotonicNs',
        'stream',
        'symbol',
      ])
      || !validUtcMs(record.eventTimeMs)
      || record.eventTimeMs > record.receivedAtMs
      || !validSafeNonNegative(record.firstUpdateId)
      || !validSafeNonNegative(record.finalUpdateId)
      || record.firstUpdateId > record.finalUpdateId
      || typeof record.stream !== 'string'
      || record.stream !== `${record.symbol.toLowerCase()}@depth@100ms`
    ) throw new TypeError('forward measurement depth diff input is invalid');
    return deepFreeze({
      kind: 'DEPTH_DIFF' as const,
      symbol: record.symbol,
      eventTimeMs: record.eventTimeMs,
      firstUpdateId: record.firstUpdateId,
      finalUpdateId: record.finalUpdateId,
      bids: cloneLevels(record.bids, true),
      asks: cloneLevels(record.asks, true),
      generation: record.generation,
      receivedMonotonicNs: record.receivedMonotonicNs,
      receivedAtMs: record.receivedAtMs,
      stream: record.stream,
    });
  }
  if (record.kind === 'DEPTH_SNAPSHOT') {
    if (
      !exactKeys(record, [
        'asks',
        'bids',
        'generation',
        'kind',
        'lastUpdateId',
        'receivedAtMs',
        'receivedMonotonicNs',
        'symbol',
      ])
      || !validSafeNonNegative(record.lastUpdateId)
    ) throw new TypeError('forward measurement depth snapshot input is invalid');
    const bids = cloneLevels(record.bids, false);
    const asks = cloneLevels(record.asks, false);
    if (
      bids.length === 0
      || asks.length === 0
      || !uncrossed(sortBids(bids), sortAsks(asks))
    ) {
      throw new TypeError('forward measurement depth snapshot input is crossed');
    }
    return deepFreeze({
      kind: 'DEPTH_SNAPSHOT' as const,
      symbol: record.symbol,
      lastUpdateId: record.lastUpdateId,
      bids,
      asks,
      generation: record.generation,
      receivedMonotonicNs: record.receivedMonotonicNs,
      receivedAtMs: record.receivedAtMs,
    });
  }
  if (record.kind === 'BOOK_TICKER') {
    if (
      !exactKeys(record, [
        'askPrice',
        'askQuantity',
        'bidPrice',
        'bidQuantity',
        'generation',
        'kind',
        'receivedAtMs',
        'receivedMonotonicNs',
        'stream',
        'symbol',
        'updateId',
      ])
      || !validSafeNonNegative(record.updateId)
      || !validSourceDecimal(record.bidPrice, false)
      || !validSourceDecimal(record.bidQuantity, false)
      || !validSourceDecimal(record.askPrice, false)
      || !validSourceDecimal(record.askQuantity, false)
      || compareDecimal(record.bidPrice, record.askPrice) >= 0
      || typeof record.stream !== 'string'
      || record.stream !== `${record.symbol.toLowerCase()}@bookTicker`
    ) throw new TypeError('forward measurement book ticker input is invalid');
    return deepFreeze({
      kind: 'BOOK_TICKER' as const,
      symbol: record.symbol,
      updateId: record.updateId,
      bidPrice: record.bidPrice,
      bidQuantity: record.bidQuantity,
      askPrice: record.askPrice,
      askQuantity: record.askQuantity,
      generation: record.generation,
      receivedMonotonicNs: record.receivedMonotonicNs,
      receivedAtMs: record.receivedAtMs,
      stream: record.stream,
    });
  }
  throw new TypeError('forward measurement depth input kind is invalid');
}

function depthBufferCost(
  diffs: readonly Readonly<VolumeForwardDepthDiff>[],
): Readonly<{ levels: number; bytes: number }> {
  let levels = 0;
  let bytes = 0;
  for (const diff of diffs) {
    levels += diff.bids.length + diff.asks.length;
    bytes += Buffer.byteLength(canonicalJson(diff), 'utf8');
    if (
      levels > VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumBufferedDepthLevels
      || bytes > VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumBufferedDepthBytes
    ) break;
  }
  return Object.freeze({ levels, bytes });
}

function sameLevels(
  left: readonly DepthLevelTuple[],
  right: readonly DepthLevelTuple[],
): boolean {
  return left.length === right.length
    && left.every((level, index) => (
      level[0] === right[index][0]
      && level[1] === right[index][1]
    ));
}

function validatedDepthState(
  value: unknown,
): Readonly<VolumeForwardDepthState> {
  const record = ownPlainRecord(value, [
    'asks',
    'bids',
    'bufferedDiffCount',
    'bufferedDiffs',
    'continuity',
    'generation',
    'lastInputDisposition',
    'lastReceivedAtMs',
    'lastReceivedMonotonicNs',
    'lastUpdateId',
    'schemaVersion',
    'snapshotLastUpdateId',
    'snapshotAskCeilingPrice',
    'snapshotAskLevelCount',
    'snapshotBidFloorPrice',
    'snapshotBidLevelCount',
    'sourceRevision',
    'status',
    'symbol',
    'updateRanges',
  ]);
  const statuses = new Set<string>([
    'BUFFERING',
    'SYNCHRONIZED',
    'GAPPED',
    'FENCED',
    'INVALID_BOOK',
    'REQUIRES_CHECKPOINT',
  ]);
  const continuities = new Set<string>([
    'AWAITING_SNAPSHOT',
    'AWAITING_BRIDGE',
    'CONTIGUOUS',
    'GAP_DETECTED',
    'GENERATION_MISMATCH',
    'NON_MONOTONIC_RECEIVE_CLOCK',
    'CROSSED_BOOK',
    'PROOF_RANGE_LIMIT_REACHED',
    'BUFFER_LIMIT_REACHED',
    'DEPTH_LEVEL_LIMIT_REACHED',
  ]);
  const dispositions = new Set<string>([
    'CREATED',
    'BUFFERED',
    'SNAPSHOT_APPLIED',
    'DIFF_APPLIED',
    'STALE_DIFF_IGNORED',
    'BOOK_TICKER_NOT_DEPTH_PROOF',
    'REJECTED',
  ]);
  if (
    record === null
    || record.schemaVersion !== VOLUME_FORWARD_DEPTH_STATE_SCHEMA
    || typeof record.symbol !== 'string'
    || !SYMBOL.test(record.symbol)
    || !validGeneration(record.generation)
    || typeof record.status !== 'string'
    || !statuses.has(record.status)
    || typeof record.continuity !== 'string'
    || !continuities.has(record.continuity)
    || typeof record.lastInputDisposition !== 'string'
    || !dispositions.has(record.lastInputDisposition)
    || !validSafeNonNegative(record.sourceRevision)
    || !validSafeNonNegative(record.bufferedDiffCount)
    || !(
      record.snapshotLastUpdateId === null
      || validSafeNonNegative(record.snapshotLastUpdateId)
    )
    || !validSafeNonNegative(record.snapshotBidLevelCount)
    || !validSafeNonNegative(record.snapshotAskLevelCount)
    || !(
      record.snapshotBidFloorPrice === null
      || validSourceDecimal(record.snapshotBidFloorPrice, false)
    )
    || !(
      record.snapshotAskCeilingPrice === null
      || validSourceDecimal(record.snapshotAskCeilingPrice, false)
    )
    || !(
      record.lastUpdateId === null
      || validSafeNonNegative(record.lastUpdateId)
    )
    || !(
      (
        record.lastReceivedMonotonicNs === null
        && record.lastReceivedAtMs === null
      )
      || (
        validMonotonicNs(record.lastReceivedMonotonicNs)
        && validUtcMs(record.lastReceivedAtMs)
      )
    )
  ) throw new TypeError('forward measurement depth state is invalid');

  const bids = cloneLevels(record.bids, false);
  const asks = cloneLevels(record.asks, false);
  if (
    !sameLevels(bids, sortBids(bids))
    || !sameLevels(asks, sortAsks(asks))
    || !uncrossed(bids, asks)
  ) throw new TypeError('forward measurement depth state book is invalid');

  const rangeValues = ownDenseArray(
    record.updateRanges,
    VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumDepthProofRanges,
  );
  if (rangeValues === null) {
    throw new TypeError('forward measurement depth state ranges are invalid');
  }
  const updateRanges: Readonly<VolumeForwardDepthAppliedRange>[] = [];
  let priorUpdateId = record.snapshotLastUpdateId;
  let priorRangeMonotonicNs: bigint | null = null;
  for (const value of rangeValues) {
    const range = ownPlainRecord(value, [
      'eventTimeMs',
      'finalUpdateId',
      'firstUpdateId',
      'receivedMonotonicNs',
    ]);
    if (
      range === null
      || priorUpdateId === null
      || !validSafeNonNegative(range.firstUpdateId)
      || !validSafeNonNegative(range.finalUpdateId)
      || range.firstUpdateId > range.finalUpdateId
      || range.finalUpdateId <= priorUpdateId
      || range.firstUpdateId > priorUpdateId + 1
      || !validUtcMs(range.eventTimeMs)
      || !validMonotonicNs(range.receivedMonotonicNs)
      || (
        priorRangeMonotonicNs !== null
        && BigInt(range.receivedMonotonicNs) < priorRangeMonotonicNs
      )
    ) throw new TypeError('forward measurement depth state range is invalid');
    priorUpdateId = range.finalUpdateId;
    priorRangeMonotonicNs = BigInt(range.receivedMonotonicNs);
    updateRanges.push(Object.freeze({
      firstUpdateId: range.firstUpdateId,
      finalUpdateId: range.finalUpdateId,
      eventTimeMs: range.eventTimeMs,
      receivedMonotonicNs: range.receivedMonotonicNs,
    }));
  }

  const bufferedValues = ownDenseArray(
    record.bufferedDiffs,
    VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumBufferEvents,
  );
  if (bufferedValues === null) {
    throw new TypeError('forward measurement depth state buffer is invalid');
  }
  const bufferedDiffs: Readonly<VolumeForwardDepthDiff>[] = [];
  let priorBufferedMonotonicNs: bigint | null = null;
  let priorBufferedAtMs: number | null = null;
  for (const value of bufferedValues) {
    const diff = validatedDepthInput(value);
    if (
      diff.kind !== 'DEPTH_DIFF'
      || diff.symbol !== record.symbol
      || diff.generation !== record.generation
      || (
        priorBufferedMonotonicNs !== null
        && BigInt(diff.receivedMonotonicNs) < priorBufferedMonotonicNs
      )
      || (
        priorBufferedAtMs !== null
        && diff.receivedAtMs < priorBufferedAtMs
      )
    ) throw new TypeError('forward measurement depth state buffer is invalid');
    priorBufferedMonotonicNs = BigInt(diff.receivedMonotonicNs);
    priorBufferedAtMs = diff.receivedAtMs;
    bufferedDiffs.push(diff);
  }
  const bufferCost = depthBufferCost(bufferedDiffs);
  if (
    record.bufferedDiffCount !== bufferedDiffs.length
    || bufferCost.levels
      > VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumBufferedDepthLevels
    || bufferCost.bytes
      > VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumBufferedDepthBytes
  ) throw new TypeError('forward measurement depth state buffer budget is invalid');

  const snapshotLastUpdateId = record.snapshotLastUpdateId;
  const snapshotBidLevelCount = record.snapshotBidLevelCount as number;
  const snapshotAskLevelCount = record.snapshotAskLevelCount as number;
  const snapshotBidFloorPrice =
    record.snapshotBidFloorPrice as string | null;
  const snapshotAskCeilingPrice =
    record.snapshotAskCeilingPrice as string | null;
  const lastUpdateId = record.lastUpdateId;
  const sourceRevision = record.sourceRevision;
  const status = record.status as VolumeForwardDepthStatus;
  const continuity = record.continuity as VolumeForwardDepthContinuity;
  const lastInputDisposition = record.lastInputDisposition as
    VolumeForwardDepthState['lastInputDisposition'];
  const lastReceivedMonotonicNs = record.lastReceivedMonotonicNs as string | null;
  const lastReceivedAtMs = record.lastReceivedAtMs as number | null;
  const horizonStateIsValid = snapshotLastUpdateId === null
    ? snapshotBidLevelCount === 0
      && snapshotAskLevelCount === 0
      && snapshotBidFloorPrice === null
      && snapshotAskCeilingPrice === null
    : snapshotBidLevelCount > 0
      && snapshotAskLevelCount > 0
      && snapshotBidLevelCount
        <= VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumDepthLevelsPerSide
      && snapshotAskLevelCount
        <= VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumDepthLevelsPerSide
      && snapshotBidFloorPrice !== null
      && snapshotAskCeilingPrice !== null
      && compareDecimal(
        snapshotBidFloorPrice,
        snapshotAskCeilingPrice,
      ) < 0;
  if (
    (
      (
        record.snapshotLastUpdateId !== null
        || bufferedDiffs.length > 0
        || updateRanges.length > 0
      )
      && (
        lastReceivedMonotonicNs === null
        || lastReceivedAtMs === null
      )
    )
    || !horizonStateIsValid
    ||
    (
      lastReceivedMonotonicNs !== null
      && (
        (
          priorRangeMonotonicNs !== null
          && priorRangeMonotonicNs > BigInt(lastReceivedMonotonicNs)
        )
        || (
          priorBufferedMonotonicNs !== null
          && priorBufferedMonotonicNs > BigInt(lastReceivedMonotonicNs)
        )
      )
    )
    || (
      lastReceivedAtMs !== null
      && (
        updateRanges.some((range) => range.eventTimeMs > lastReceivedAtMs)
        || (
          priorBufferedAtMs !== null
          && priorBufferedAtMs > lastReceivedAtMs
        )
      )
    )
  ) throw new TypeError('forward measurement depth state clocks are invalid');

  if (snapshotLastUpdateId === null) {
    if (
      lastUpdateId !== null
      || sourceRevision !== 0
      || bids.length !== 0
      || asks.length !== 0
      || updateRanges.length !== 0
      || (
        status !== 'BUFFERING'
        && status !== 'FENCED'
        && !(
          status === 'REQUIRES_CHECKPOINT'
          && continuity === 'BUFFER_LIMIT_REACHED'
        )
      )
    ) throw new TypeError('forward measurement pre-snapshot state is invalid');
  } else if (
    lastUpdateId === null
    || lastUpdateId < snapshotLastUpdateId
    || sourceRevision !== updateRanges.length + 1
    || bufferedDiffs.length !== 0
    || (
      updateRanges.length === 0
      && lastUpdateId !== snapshotLastUpdateId
    )
    || (
      updateRanges.length > 0
      && (
        priorUpdateId !== lastUpdateId
        || lastUpdateId <= snapshotLastUpdateId
      )
    )
    || (status === 'BUFFERING' && updateRanges.length !== 0)
    || (status === 'SYNCHRONIZED' && updateRanges.length === 0)
  ) throw new TypeError('forward measurement post-snapshot state is invalid');

  const statusContinuityIsValid = (
    (
      status === 'BUFFERING'
      && (
        (
          snapshotLastUpdateId === null
          && continuity === 'AWAITING_SNAPSHOT'
        )
        || (
          snapshotLastUpdateId !== null
          && continuity === 'AWAITING_BRIDGE'
        )
      )
    )
    || (status === 'SYNCHRONIZED' && continuity === 'CONTIGUOUS')
    || (status === 'GAPPED' && continuity === 'GAP_DETECTED')
    || (
      status === 'FENCED'
      && (
        continuity === 'GENERATION_MISMATCH'
        || continuity === 'NON_MONOTONIC_RECEIVE_CLOCK'
      )
    )
    || (status === 'INVALID_BOOK' && continuity === 'CROSSED_BOOK')
    || (
      status === 'REQUIRES_CHECKPOINT'
      && (
        continuity === 'PROOF_RANGE_LIMIT_REACHED'
        || continuity === 'BUFFER_LIMIT_REACHED'
        || continuity === 'DEPTH_LEVEL_LIMIT_REACHED'
      )
    )
  );
  const terminal = (
    status === 'GAPPED'
    || status === 'FENCED'
    || status === 'INVALID_BOOK'
    || status === 'REQUIRES_CHECKPOINT'
  );
  const activeReceiptIsValid = (
    terminal
    || lastInputDisposition === 'CREATED'
    || (
      lastReceivedMonotonicNs !== null
      && lastReceivedAtMs !== null
    )
  );
  const dispositionIsValid = (
    (terminal && lastInputDisposition === 'REJECTED')
    || (
      !terminal
      && lastInputDisposition !== 'REJECTED'
      && (
        (
          lastInputDisposition === 'CREATED'
          && snapshotLastUpdateId === null
          && bufferedDiffs.length === 0
          && lastReceivedMonotonicNs === null
          && lastReceivedAtMs === null
        )
        || (
          lastInputDisposition === 'BUFFERED'
          && snapshotLastUpdateId === null
          && bufferedDiffs.length > 0
        )
        || (
          lastInputDisposition === 'SNAPSHOT_APPLIED'
          && snapshotLastUpdateId !== null
          && updateRanges.length === 0
        )
        || (
          lastInputDisposition === 'DIFF_APPLIED'
          && status === 'SYNCHRONIZED'
          && updateRanges.length > 0
        )
        || (
          lastInputDisposition === 'STALE_DIFF_IGNORED'
          && snapshotLastUpdateId !== null
        )
        || lastInputDisposition === 'BOOK_TICKER_NOT_DEPTH_PROOF'
      )
    )
  );
  if (
    !statusContinuityIsValid
    || !activeReceiptIsValid
    || !dispositionIsValid
    || (status === 'GAPPED' && snapshotLastUpdateId === null)
    || (
      continuity === 'BUFFER_LIMIT_REACHED'
      && snapshotLastUpdateId !== null
    )
    || (
      continuity === 'PROOF_RANGE_LIMIT_REACHED'
      && updateRanges.length
        !== VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumDepthProofRanges
    )
  ) throw new TypeError('forward measurement depth state invariants are invalid');

  return deepFreeze({
    schemaVersion: VOLUME_FORWARD_DEPTH_STATE_SCHEMA,
    symbol: record.symbol,
    generation: record.generation,
    status,
    continuity,
    snapshotLastUpdateId,
    snapshotBidLevelCount,
    snapshotAskLevelCount,
    snapshotBidFloorPrice,
    snapshotAskCeilingPrice,
    lastUpdateId,
    sourceRevision,
    bids,
    asks,
    updateRanges: Object.freeze(updateRanges),
    bufferedDiffs: Object.freeze(bufferedDiffs),
    bufferedDiffCount: bufferedDiffs.length,
    lastReceivedMonotonicNs,
    lastReceivedAtMs,
    lastInputDisposition,
  });
}

function latestReceipt(
  state: Readonly<VolumeForwardDepthState>,
  input: Readonly<VolumeForwardDepthInput>,
): Readonly<{
  lastReceivedMonotonicNs: string;
  lastReceivedAtMs: number;
}> {
  const lastReceivedMonotonicNs = (
    state.lastReceivedMonotonicNs === null
    || BigInt(input.receivedMonotonicNs)
      > BigInt(state.lastReceivedMonotonicNs)
  )
    ? input.receivedMonotonicNs
    : state.lastReceivedMonotonicNs;
  const lastReceivedAtMs = state.lastReceivedAtMs === null
    ? input.receivedAtMs
    : Math.max(state.lastReceivedAtMs, input.receivedAtMs);
  return Object.freeze({ lastReceivedMonotonicNs, lastReceivedAtMs });
}

function validReceiptOrder(
  state: Readonly<VolumeForwardDepthState>,
  input: Readonly<VolumeForwardDepthInput>,
): boolean {
  if (
    state.lastReceivedMonotonicNs !== null
    && BigInt(input.receivedMonotonicNs) < BigInt(state.lastReceivedMonotonicNs)
  ) return false;
  return !(
    state.lastReceivedAtMs !== null
    && input.receivedAtMs < state.lastReceivedAtMs
  );
}

function applyDiffToBook(
  state: Readonly<VolumeForwardDepthState>,
  input: Readonly<VolumeForwardDepthDiff>,
): Readonly<VolumeForwardDepthState> {
  const lastUpdateId = state.lastUpdateId;
  if (lastUpdateId === null) throw new TypeError('forward measurement depth state lacks snapshot');
  const receipt = latestReceipt(state, input);
  if (input.finalUpdateId <= lastUpdateId) {
    return stateWith(state, {
      ...receipt,
      lastInputDisposition: 'STALE_DIFF_IGNORED',
    });
  }
  if (input.firstUpdateId > lastUpdateId + 1) {
    return stateWith(state, {
      status: 'GAPPED',
      continuity: 'GAP_DETECTED',
      ...receipt,
      lastInputDisposition: 'REJECTED',
    });
  }
  if (state.updateRanges.length >= VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumDepthProofRanges) {
    return stateWith(state, {
      status: 'REQUIRES_CHECKPOINT',
      continuity: 'PROOF_RANGE_LIMIT_REACHED',
      ...receipt,
      lastInputDisposition: 'REJECTED',
    });
  }
  const bids = new Map<string, DepthLevelTuple>(
    state.bids.map((level) => [decimalIdentity(level[0]), level] as const),
  );
  const asks = new Map<string, DepthLevelTuple>(
    state.asks.map((level) => [decimalIdentity(level[0]), level] as const),
  );
  for (const [price, quantity] of input.bids) {
    const priceIdentity = decimalIdentity(price);
    if (/[1-9]/.test(quantity)) {
      bids.set(priceIdentity, Object.freeze([price, quantity]));
    } else {
      bids.delete(priceIdentity);
    }
  }
  for (const [price, quantity] of input.asks) {
    const priceIdentity = decimalIdentity(price);
    if (/[1-9]/.test(quantity)) {
      asks.set(priceIdentity, Object.freeze([price, quantity]));
    } else {
      asks.delete(priceIdentity);
    }
  }
  const sortedBids = sortBids(bids.values());
  const sortedAsks = sortAsks(asks.values());
  if (
    sortedBids.length
      > VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumDepthLevelsPerSide
    || sortedAsks.length
      > VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumDepthLevelsPerSide
  ) {
    return stateWith(state, {
      status: 'REQUIRES_CHECKPOINT',
      continuity: 'DEPTH_LEVEL_LIMIT_REACHED',
      ...receipt,
      lastInputDisposition: 'REJECTED',
    });
  }
  if (!uncrossed(sortedBids, sortedAsks)) {
    return stateWith(state, {
      status: 'INVALID_BOOK',
      continuity: 'CROSSED_BOOK',
      ...receipt,
      lastInputDisposition: 'REJECTED',
    });
  }
  const updateRanges = Object.freeze([
    ...state.updateRanges,
    Object.freeze({
      firstUpdateId: input.firstUpdateId,
      finalUpdateId: input.finalUpdateId,
      eventTimeMs: input.eventTimeMs,
      receivedMonotonicNs: input.receivedMonotonicNs,
    }),
  ]);
  return stateWith(state, {
    status: 'SYNCHRONIZED',
    continuity: 'CONTIGUOUS',
    lastUpdateId: input.finalUpdateId,
    sourceRevision: state.sourceRevision + 1,
    bids: sortedBids,
    asks: sortedAsks,
    updateRanges,
    ...receipt,
    lastInputDisposition: 'DIFF_APPLIED',
  });
}

export function applyVolumeForwardDepthInput(
  state: Readonly<VolumeForwardDepthState>,
  input: Readonly<VolumeForwardDepthInput>,
): Readonly<VolumeForwardDepthState> {
  const checkedState = validatedDepthState(state);
  const checkedInput = validatedDepthInput(input);
  if (
    checkedInput.generation !== checkedState.generation
    || checkedInput.symbol !== checkedState.symbol
  ) {
    return fencedState(checkedState, 'GENERATION_MISMATCH');
  }
  if (!validReceiptOrder(checkedState, checkedInput)) {
    return fencedState(checkedState, 'NON_MONOTONIC_RECEIVE_CLOCK');
  }
  if (
    checkedState.status === 'GAPPED'
    || checkedState.status === 'FENCED'
    || checkedState.status === 'INVALID_BOOK'
    || checkedState.status === 'REQUIRES_CHECKPOINT'
  ) return checkedState;

  if (checkedInput.kind === 'BOOK_TICKER') {
    return stateWith(checkedState, {
      ...latestReceipt(checkedState, checkedInput),
      lastInputDisposition: 'BOOK_TICKER_NOT_DEPTH_PROOF',
    });
  }

  if (
    checkedInput.kind === 'DEPTH_DIFF'
    && checkedState.snapshotLastUpdateId === null
  ) {
    if (
      checkedState.bufferedDiffs.length
      >= VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumBufferEvents
    ) {
      return stateWith(checkedState, {
        status: 'REQUIRES_CHECKPOINT',
        continuity: 'BUFFER_LIMIT_REACHED',
        ...latestReceipt(checkedState, checkedInput),
        lastInputDisposition: 'REJECTED',
      });
    }
    const bufferedDiffs = Object.freeze([
      ...checkedState.bufferedDiffs,
      checkedInput,
    ]);
    const bufferCost = depthBufferCost(bufferedDiffs);
    if (
      bufferCost.levels
        > VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumBufferedDepthLevels
      || bufferCost.bytes
        > VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumBufferedDepthBytes
    ) {
      return stateWith(checkedState, {
        status: 'REQUIRES_CHECKPOINT',
        continuity: 'BUFFER_LIMIT_REACHED',
        ...latestReceipt(checkedState, checkedInput),
        lastInputDisposition: 'REJECTED',
      });
    }
    return stateWith(checkedState, {
      status: 'BUFFERING',
      continuity: 'AWAITING_SNAPSHOT',
      bufferedDiffs,
      bufferedDiffCount: bufferedDiffs.length,
      ...latestReceipt(checkedState, checkedInput),
      lastInputDisposition: 'BUFFERED',
    });
  }

  if (checkedInput.kind === 'DEPTH_SNAPSHOT') {
    if (checkedState.snapshotLastUpdateId !== null) {
      return stateWith(checkedState, {
        status: 'FENCED',
        continuity: 'GENERATION_MISMATCH',
        lastInputDisposition: 'REJECTED',
      });
    }
    const bids = sortBids(checkedInput.bids);
    const asks = sortAsks(checkedInput.asks);
    if (!uncrossed(bids, asks)) {
      return stateWith(checkedState, {
        status: 'INVALID_BOOK',
        continuity: 'CROSSED_BOOK',
        lastInputDisposition: 'REJECTED',
      });
    }
    let next = stateWith(checkedState, {
      status: 'BUFFERING',
      continuity: 'AWAITING_BRIDGE',
      snapshotLastUpdateId: checkedInput.lastUpdateId,
      snapshotBidLevelCount: bids.length,
      snapshotAskLevelCount: asks.length,
      snapshotBidFloorPrice: bids.at(-1)?.[0] ?? null,
      snapshotAskCeilingPrice: asks.at(-1)?.[0] ?? null,
      lastUpdateId: checkedInput.lastUpdateId,
      sourceRevision: 1,
      bids,
      asks,
      updateRanges: Object.freeze([]),
      bufferedDiffs: Object.freeze([]),
      bufferedDiffCount: 0,
      ...latestReceipt(checkedState, checkedInput),
      lastInputDisposition: 'SNAPSHOT_APPLIED',
    });
    const retained = checkedState.bufferedDiffs.filter(
      (diff) => diff.finalUpdateId > checkedInput.lastUpdateId,
    );
    for (const diff of retained) {
      next = applyDiffToBook(next, diff);
      if (next.status !== 'SYNCHRONIZED') break;
    }
    return next;
  }

  return applyDiffToBook(checkedState, checkedInput);
}

export function parseVolumeForwardExchangeInfo(
  input: ParseVolumeForwardExchangeInfoInput,
): Readonly<VolumeForwardExchangeInfoSnapshot> {
  const inputRecord = ownPlainRecord(input, [
    'generation',
    'rawPayload',
    'receivedAtMs',
    'receivedMonotonicNs',
    'symbol',
  ]);
  if (
    inputRecord === null
    || typeof inputRecord.symbol !== 'string'
    || !SYMBOL.test(inputRecord.symbol)
    || !validGeneration(inputRecord.generation)
    || !validMonotonicNs(inputRecord.receivedMonotonicNs)
    || !validUtcMs(inputRecord.receivedAtMs)
  ) throw new TypeError('forward measurement exchangeInfo receipt is invalid');
  const bytes = payloadBytes(
    inputRecord.rawPayload as string | Uint8Array,
  );
  const root = ownPlainRecord(parseJsonPayload(bytes));
  if (root === null || !Array.isArray(root.symbols)) {
    throw new TypeError('forward measurement exchangeInfo body is invalid');
  }
  const matches = root.symbols
    .map((value) => ownPlainRecord(value))
    .filter((value): value is PlainRecord => (
      value?.symbol === inputRecord.symbol
    ));
  if (matches.length !== 1) {
    throw new TypeError('forward measurement exchangeInfo symbol is ambiguous');
  }
  const symbol = matches[0];
  if (
    typeof symbol.status !== 'string'
    || typeof symbol.baseAsset !== 'string'
    || typeof symbol.quoteAsset !== 'string'
    || !Array.isArray(symbol.orderTypes)
    || symbol.orderTypes.some((value) => typeof value !== 'string')
    || !Array.isArray(symbol.filters)
    || symbol.filters.length === 0
  ) throw new TypeError('forward measurement exchangeInfo symbol fields are invalid');
  const filters = symbol.filters.map((value) => {
    const filter = ownPlainRecord(value);
    if (filter === null || typeof filter.filterType !== 'string') {
      throw new TypeError('forward measurement exchangeInfo filter is invalid');
    }
    for (const item of Object.values(filter)) {
      if (
        typeof item !== 'string'
        && typeof item !== 'boolean'
        && !validSafeNonNegative(item)
      ) throw new TypeError('forward measurement exchangeInfo filter value is invalid');
    }
    return filter;
  });
  if (!validRequiredVolumeFilters(filters)) {
    throw new TypeError(
      'forward measurement exchangeInfo required filters are invalid',
    );
  }
  const permissions = Array.isArray(symbol.permissions)
    && symbol.permissions.every((value) => typeof value === 'string')
    ? symbol.permissions as readonly string[]
    : [];
  if (typeof symbol.isSpotTradingAllowed !== 'boolean') {
    throw new TypeError(
      'forward measurement exchangeInfo spot permission is invalid',
    );
  }
  const spotTradingAllowed = symbol.isSpotTradingAllowed;
  return deepFreeze({
    schemaVersion: 'cosmos.engine.volume.forward-exchange-info.v1' as const,
    symbol: inputRecord.symbol,
    status: symbol.status,
    baseAsset: symbol.baseAsset,
    quoteAsset: symbol.quoteAsset,
    spotTradingAllowed,
    orderTypes: Object.freeze([...(symbol.orderTypes as string[])]),
    permissions: Object.freeze([...permissions]),
    filters: Object.freeze(filters),
    generation: inputRecord.generation,
    receivedMonotonicNs: inputRecord.receivedMonotonicNs,
    receivedAtMs: inputRecord.receivedAtMs,
    rawPayloadSha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` as const,
  });
}

export function buildVolumeForwardPointInTimeControls(
  input: unknown,
): Readonly<VolumeForwardPointInTimeControls> {
  const record = ownPlainRecord(input, [
    'capturedAtMs',
    'configurationDigest',
    'configurationRevision',
    'enabled',
    'filterDigest',
    'killStateDigest',
    'killSwitchEngaged',
    'receivedMonotonicNs',
  ]);
  if (
    record === null
    || typeof record.configurationRevision !== 'string'
    || !ENGINE_DIGEST.test(record.configurationRevision)
    || typeof record.configurationDigest !== 'string'
    || !DIGEST.test(record.configurationDigest)
    || typeof record.filterDigest !== 'string'
    || !DIGEST.test(record.filterDigest)
    || typeof record.killStateDigest !== 'string'
    || !DIGEST.test(record.killStateDigest)
    || record.enabled !== false
    || record.killSwitchEngaged !== true
    || !validUtcMs(record.capturedAtMs)
    || !validMonotonicNs(record.receivedMonotonicNs)
  ) throw new TypeError('forward measurement control snapshot is invalid');
  return deepFreeze(record) as unknown as Readonly<VolumeForwardPointInTimeControls>;
}

export function buildVolumeForwardDetectorProposalBinding(
  input: unknown,
  controls: unknown,
): Readonly<VolumeForwardDetectorProposalBinding> {
  const checkedControls = buildVolumeForwardPointInTimeControls(controls);
  const expected = [
    'configurationDigest',
    'configurationRevision',
    'controlsCapturedAtMs',
    'controlsReceivedMonotonicNs',
    'correlationId',
    'detectorDecisionDigest',
    'direction',
    'expiresAtMs',
    'featureDigest',
    'featureObservedAtMs',
    'filterDigest',
    'generation',
    'killStateDigest',
    'proposalDigest',
    'proposalId',
    'proposalRevision',
    'receivedMonotonicNs',
    'symbol',
    'updatedTs',
  ] as const;
  const record = ownPlainRecord(input, expected);
  if (
    record === null
    || typeof record.proposalId !== 'string'
    || !ENGINE_DIGEST.test(record.proposalId)
    || typeof record.proposalDigest !== 'string'
    || !ENGINE_DIGEST.test(record.proposalDigest)
    || !validSafeNonNegative(record.proposalRevision)
    || record.proposalRevision < 1
    || typeof record.configurationRevision !== 'string'
    || !ENGINE_DIGEST.test(record.configurationRevision)
    || typeof record.configurationDigest !== 'string'
    || !DIGEST.test(record.configurationDigest)
    || !validUtcMs(record.controlsCapturedAtMs)
    || !validMonotonicNs(record.controlsReceivedMonotonicNs)
    || typeof record.correlationId !== 'string'
    || !ENGINE_DIGEST.test(record.correlationId)
    || record.correlationId.startsWith('vroc:')
    || typeof record.symbol !== 'string'
    || !SYMBOL.test(record.symbol)
    || (record.direction !== 'long' && record.direction !== 'short')
    || !validUtcMs(record.updatedTs)
    || !validUtcMs(record.featureObservedAtMs)
    || !validUtcMs(record.expiresAtMs)
    || record.featureObservedAtMs > record.updatedTs
    || record.controlsCapturedAtMs > record.updatedTs
    || record.expiresAtMs <= record.updatedTs
    || typeof record.detectorDecisionDigest !== 'string'
    || !ENGINE_DIGEST.test(record.detectorDecisionDigest)
    || typeof record.featureDigest !== 'string'
    || !ENGINE_DIGEST.test(record.featureDigest)
    || typeof record.filterDigest !== 'string'
    || !DIGEST.test(record.filterDigest)
    || typeof record.killStateDigest !== 'string'
    || !DIGEST.test(record.killStateDigest)
    || !validGeneration(record.generation)
    || !validMonotonicNs(record.receivedMonotonicNs)
    || BigInt(record.controlsReceivedMonotonicNs)
      > BigInt(record.receivedMonotonicNs)
    || record.configurationRevision
      !== checkedControls.configurationRevision
    || record.configurationDigest
      !== checkedControls.configurationDigest
    || record.filterDigest !== checkedControls.filterDigest
    || record.killStateDigest !== checkedControls.killStateDigest
    || record.controlsCapturedAtMs !== checkedControls.capturedAtMs
    || record.controlsReceivedMonotonicNs
      !== checkedControls.receivedMonotonicNs
  ) throw new TypeError('forward measurement detector proposal binding is invalid');
  return deepFreeze(record) as unknown as Readonly<VolumeForwardDetectorProposalBinding>;
}

export function validateVolumeForwardDetectorProposalBinding(
  value: unknown,
  controls: unknown,
): value is Readonly<VolumeForwardDetectorProposalBinding> {
  try {
    return canonicalJson(
      buildVolumeForwardDetectorProposalBinding(value, controls),
    )
      === canonicalJson(value);
  } catch {
    return false;
  }
}
