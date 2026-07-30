import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { types } from 'node:util';

import {
  addExactDecimals,
  compareExactDecimals,
  divideExactDecimals,
  multiplyExactDecimals,
  normalizeExactDecimal,
  subtractExactDecimals,
  sumExactDecimals,
  type ExactDecimal,
} from '../../capitalFoundation/contracts/decimal.js';
import { canonicalJson } from '../../foundation/contracts/identity.js';
import { EXECUTABLE_BASIS_RETURN_CONTRACT } from './math.js';
import type { BasisDirection } from './types.js';

const PERCENT_DIVISION_SCALE = 18;

export const PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_SCHEMA =
  'cosmos.engine.basis.public-opportunity-observation' as const;
export const PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_VERSION = 1 as const;
export const MAX_PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_PAYLOAD_BYTES = 8 * 1_024;
export const PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_RELEASE_STATE =
  'NOT_CONFIGURED' as const;
export const PUBLIC_BASIS_EDGE_COMPUTATION_POLICY = Object.freeze({
  arithmetic: 'EXACT_BASE_10',
  divisionScale: PERCENT_DIVISION_SCALE,
  divisionRounding: 'TRUNCATE_TOWARD_ZERO',
} as const);

const MAX_REASON_CODES = 16;
const MAX_INPUT_GRAPH_NODES = 256;
const MAX_INPUT_ARRAY_LENGTH = 32;
const MAX_INPUT_OBJECT_KEYS = 32;
const MAX_LABEL_CHARS = 128;
const MAX_SOURCE_CHARS = 256;
const SYMBOL_PATTERN = /^[A-Z0-9]{4,20}$/;
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const REASON_PATTERN = /^[A-Z0-9][A-Z0-9_:-]{0,95}$/;
const ZERO = normalizeExactDecimal('0');
const ONE_HUNDRED = normalizeExactDecimal('100');

export const PUBLIC_BASIS_OWNER_DECISION_KINDS = Object.freeze([
  'watch',
  'focus',
  'proposal',
] as const);
export type PublicBasisOwnerDecisionKind =
  (typeof PUBLIC_BASIS_OWNER_DECISION_KINDS)[number];

export const PUBLIC_BASIS_COMPONENT_STATES = Object.freeze([
  'OBSERVED_PUBLIC',
  'DERIVED_PUBLIC',
  'PUBLIC_SCHEDULE_ASSUMPTION',
  'MODEL_ASSUMPTION',
  'NOT_REQUIRED',
  'UNKNOWN',
  'STALE',
] as const);
export type PublicBasisComponentState =
  (typeof PUBLIC_BASIS_COMPONENT_STATES)[number];

export const PUBLIC_BASIS_COMPONENT_AUTHORITIES = Object.freeze([
  'BINANCE_PUBLIC',
  'PUBLIC_MODEL',
  'CONFIG_ASSUMPTION',
  'NONE',
  'UNKNOWN',
] as const);
export type PublicBasisComponentAuthority =
  (typeof PUBLIC_BASIS_COMPONENT_AUTHORITIES)[number];

export const PUBLIC_BASIS_TIME_BASES = Object.freeze([
  'EXCHANGE_EVENT_TIME',
  'SOURCE_TRANSACTION_TIME',
  'RECEIPT_TIME',
  'NOT_APPLICABLE',
  'UNKNOWN',
] as const);
export type PublicBasisTimeBasis = (typeof PUBLIC_BASIS_TIME_BASES)[number];

export interface PublicBasisComponentProvenance {
  readonly authority: PublicBasisComponentAuthority;
  readonly sourceId: string | null;
  readonly revision: string | null;
  readonly sourceEventAtMs: number | null;
  readonly sourceTransactionAtMs: number | null;
  readonly receivedAtMs: number | null;
  readonly expiresAtMs: number | null;
  readonly timeBasis: PublicBasisTimeBasis;
}

export interface PublicBasisEconomicComponent {
  readonly state: PublicBasisComponentState;
  readonly valuePct: string | null;
  readonly provenance: Readonly<PublicBasisComponentProvenance>;
  readonly reasonCodes: readonly string[];
}

export interface PublicBasisQuoteLeg {
  readonly market: 'SPOT' | 'USD_M_PERPETUAL';
  readonly bidPrice: string;
  readonly askPrice: string;
  readonly bidQuantity: string;
  readonly askQuantity: string;
  readonly state: Extract<PublicBasisComponentState, 'OBSERVED_PUBLIC' | 'UNKNOWN' | 'STALE'>;
  readonly provenance: Readonly<PublicBasisComponentProvenance>;
  readonly reasonCodes: readonly string[];
}

export interface PublicBasisQuoteCut {
  readonly spot: Readonly<PublicBasisQuoteLeg>;
  readonly perpetual: Readonly<PublicBasisQuoteLeg>;
  readonly maxQuoteAgeMs: number;
  readonly maxReceiptSkewMs: number;
}

export interface PublicBasisOpportunityCosts {
  readonly spotOpenFee: Readonly<PublicBasisEconomicComponent>;
  readonly spotCloseFee: Readonly<PublicBasisEconomicComponent>;
  readonly perpetualOpenFee: Readonly<PublicBasisEconomicComponent>;
  readonly perpetualCloseFee: Readonly<PublicBasisEconomicComponent>;
  readonly slippage: Readonly<PublicBasisEconomicComponent>;
  readonly fundingCarry: Readonly<PublicBasisEconomicComponent>;
  readonly borrowCost: Readonly<PublicBasisEconomicComponent>;
}

export interface BuildPublicBasisOpportunityObservationInput {
  readonly opportunityId: string;
  readonly opportunityCreatedAtMs: number;
  readonly correlationId: string;
  readonly sourceCutId: string;
  readonly symbol: string;
  readonly direction: BasisDirection;
  readonly ownerDecisionKind: PublicBasisOwnerDecisionKind;
  readonly observedAtMs: number;
  readonly evaluatedAtMs: number;
  readonly ownerReportedGrossEdgePct: string | null;
  readonly ownerReportedNetEdgePct: string | null;
  readonly quoteCut: Readonly<PublicBasisQuoteCut>;
  readonly costs: Readonly<PublicBasisOpportunityCosts>;
}

export interface PublicBasisOpportunityEconomics {
  readonly grossExecutableEdgePct: string | null;
  readonly grossExecutableEdgeState: 'PUBLIC_TOP_OF_BOOK' | 'UNKNOWN';
  readonly ownerReportedGrossEdgePct: string | null;
  readonly ownerReportedNetEdgePct: string | null;
  readonly configuredProxyNetEdgePct: string | null;
  readonly configuredProxyNetState: 'ASSUMPTION_BOUND' | 'UNKNOWN';
  readonly accountEffectiveNetEdgePct: null;
  readonly accountEffectiveNetState: 'UNKNOWN';
  readonly configuredProxyNetEdgeUsdPerOneThousandNotional: string | null;
}

export interface PublicBasisOpportunityObservation {
  readonly schema: typeof PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_SCHEMA;
  readonly version: typeof PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_VERSION;
  readonly releaseState: typeof PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_RELEASE_STATE;
  readonly strategyAuthority: 'BASIS_ENGINE';
  readonly sourceAuthority: 'PUBLIC_ONLY';
  readonly executionAuthority: 'NONE';
  readonly measurementMeaning: 'PUBLIC_OBSERVED_PROXY_NOT_EXECUTED';
  readonly returnContractVersion: typeof EXECUTABLE_BASIS_RETURN_CONTRACT.version;
  readonly edgeComputationPolicy: typeof PUBLIC_BASIS_EDGE_COMPUTATION_POLICY;
  readonly observationId: string;
  readonly contentDigestSha256: string;
  readonly opportunityId: string;
  readonly opportunityCreatedAtMs: number;
  readonly correlationId: string;
  readonly sourceCutId: string;
  readonly symbol: string;
  readonly direction: BasisDirection;
  readonly ownerDecisionKind: PublicBasisOwnerDecisionKind;
  readonly observedAtMs: number;
  readonly evaluatedAtMs: number;
  readonly quoteCut: Readonly<PublicBasisQuoteCut>;
  readonly costs: Readonly<PublicBasisOpportunityCosts>;
  readonly economics: Readonly<PublicBasisOpportunityEconomics>;
  readonly reasonCodes: readonly string[];
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || Object.getOwnPropertySymbols(value).length !== 0) {
    return null;
  }
  const own = Object.keys(value);
  if (own.length !== keys.length || own.some((key) => !keys.includes(key))) return null;
  return value as Record<string, unknown>;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function safeUtcMillis(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0);
}

function boundedNonNegativeMillis(value: unknown): value is number {
  return safeUtcMillis(value) && value <= 86_400_000;
}

function canonicalDecimal(value: unknown, nonNegative = false): ExactDecimal | null {
  if (typeof value !== 'string') return null;
  try {
    const normalized = normalizeExactDecimal(value);
    if (normalized !== value) return null;
    if (nonNegative && compareExactDecimals(normalized, ZERO) < 0) return null;
    return normalized;
  } catch {
    return null;
  }
}

function assertRawPayloadBound(value: unknown): void {
  const visiting = new WeakSet<object>();
  let nodeCount = 0;
  let estimatedBytes = 0;
  const overbound = (): never => {
    throw new RangeError('public Basis opportunity input exceeds its payload bound');
  };
  const invalid = (): never => {
    throw new TypeError('public Basis opportunity input must be passive plain data');
  };
  const accountText = (text: string): void => {
    estimatedBytes += Buffer.byteLength(text, 'utf8');
    if (estimatedBytes > MAX_PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_PAYLOAD_BYTES) overbound();
  };
  const visit = (entry: unknown): void => {
    if (entry === null || typeof entry === 'boolean') return;
    if (typeof entry === 'string') {
      accountText(entry);
      return;
    }
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry) || Object.is(entry, -0)) invalid();
      return;
    }
    if (typeof entry !== 'object' || entry === null) invalid();
    const passiveObject = entry as object;
    if (types.isProxy(passiveObject)) invalid();
    if (visiting.has(passiveObject)) invalid();
    visiting.add(passiveObject);
    nodeCount += 1;
    if (nodeCount > MAX_INPUT_GRAPH_NODES) overbound();

    const array = Array.isArray(entry);
    const prototype = Object.getPrototypeOf(entry);
    if (prototype !== (array ? Array.prototype : Object.prototype)
        || Object.getOwnPropertySymbols(entry).length !== 0) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    const names = Object.keys(descriptors);
    if (array) {
      if (entry.length > MAX_INPUT_ARRAY_LENGTH
          || names.length !== entry.length + 1
          || names.some((name) => name !== 'length'
            && (!/^(?:0|[1-9][0-9]*)$/.test(name) || Number(name) >= entry.length))) invalid();
    } else if (names.length > MAX_INPUT_OBJECT_KEYS) {
      overbound();
    }
    for (const name of names) {
      const descriptor = descriptors[name];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
      if (name === 'length' && array) continue;
      if (descriptor.enumerable !== true) invalid();
      accountText(name);
      visit(descriptor.value);
    }
    visiting.delete(passiveObject);
  };
  visit(value);

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError('public Basis opportunity input is not serializable');
  }
  if (serialized === undefined) {
    throw new TypeError('public Basis opportunity input is not serializable');
  }
  if (Buffer.byteLength(serialized, 'utf8')
      > MAX_PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_PAYLOAD_BYTES) {
    throw new RangeError('public Basis opportunity input exceeds its payload bound');
  }
}

function boundedLabel(value: unknown, pattern = LABEL_PATTERN, max = MAX_LABEL_CHARS): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && pattern.test(value);
}

function reasonCodes(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_REASON_CODES) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const reason of value) {
    if (typeof reason !== 'string' || !REASON_PATTERN.test(reason) || seen.has(reason)) return null;
    seen.add(reason);
    out.push(reason);
  }
  return Object.freeze(out);
}

function includesValue<T>(values: readonly T[], value: unknown): value is T {
  return values.includes(value as T);
}

function snapshotProvenance(value: unknown): Readonly<PublicBasisComponentProvenance> | null {
  const record = exactRecord(value, [
    'authority',
    'sourceId',
    'revision',
    'sourceEventAtMs',
    'sourceTransactionAtMs',
    'receivedAtMs',
    'expiresAtMs',
    'timeBasis',
  ]);
  if (record === null
      || !includesValue(PUBLIC_BASIS_COMPONENT_AUTHORITIES, record.authority)
      || !includesValue(PUBLIC_BASIS_TIME_BASES, record.timeBasis)
      || (record.sourceId !== null
        && !boundedLabel(record.sourceId, /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/, MAX_SOURCE_CHARS))
      || (record.revision !== null
        && !boundedLabel(record.revision, /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/, MAX_SOURCE_CHARS))) {
    return null;
  }
  for (const field of ['sourceEventAtMs', 'sourceTransactionAtMs', 'receivedAtMs', 'expiresAtMs'] as const) {
    if (record[field] !== null && !safeUtcMillis(record[field])) return null;
  }
  const times = [
    record.sourceEventAtMs,
    record.sourceTransactionAtMs,
    record.receivedAtMs,
  ].filter((time): time is number => typeof time === 'number');
  if (record.expiresAtMs !== null && times.some((time) => time > Number(record.expiresAtMs))) return null;
  return deepFreeze({
    authority: record.authority,
    sourceId: record.sourceId as string | null,
    revision: record.revision as string | null,
    sourceEventAtMs: record.sourceEventAtMs as number | null,
    sourceTransactionAtMs: record.sourceTransactionAtMs as number | null,
    receivedAtMs: record.receivedAtMs as number | null,
    expiresAtMs: record.expiresAtMs as number | null,
    timeBasis: record.timeBasis,
  });
}

function snapshotComponent(
  value: unknown,
  nonNegative = true,
): Readonly<PublicBasisEconomicComponent> | null {
  const record = exactRecord(value, ['state', 'valuePct', 'provenance', 'reasonCodes']);
  if (record === null || !includesValue(PUBLIC_BASIS_COMPONENT_STATES, record.state)) return null;
  const provenance = snapshotProvenance(record.provenance);
  const reasons = reasonCodes(record.reasonCodes);
  if (provenance === null || reasons === null) return null;
  const decimal = record.valuePct === null ? null : canonicalDecimal(record.valuePct, nonNegative);
  if (record.valuePct !== null && decimal === null) return null;
  if ((record.state === 'UNKNOWN' || record.state === 'STALE') && decimal !== null) return null;
  if (record.state === 'NOT_REQUIRED' && decimal !== '0') return null;
  if (record.state === 'NOT_REQUIRED'
      && (provenance.authority !== 'NONE'
        || provenance.sourceId !== null
        || provenance.revision !== null
        || provenance.sourceEventAtMs !== null
        || provenance.sourceTransactionAtMs !== null
        || provenance.receivedAtMs !== null
        || provenance.expiresAtMs !== null
        || provenance.timeBasis !== 'NOT_APPLICABLE')) return null;
  if (!['UNKNOWN', 'STALE', 'NOT_REQUIRED'].includes(record.state) && decimal === null) return null;
  return deepFreeze({
    state: record.state,
    valuePct: decimal,
    provenance,
    reasonCodes: reasons,
  });
}

function snapshotFeeComponent(value: unknown): Readonly<PublicBasisEconomicComponent> | null {
  const component = snapshotComponent(value);
  if (component === null
      || ![
        'PUBLIC_SCHEDULE_ASSUMPTION',
        'MODEL_ASSUMPTION',
        'UNKNOWN',
        'STALE',
      ].includes(component.state)) {
    return null;
  }
  return component;
}

function snapshotSlippageComponent(value: unknown): Readonly<PublicBasisEconomicComponent> | null {
  const component = snapshotComponent(value);
  if (component === null
      || ![
        'DERIVED_PUBLIC',
        'MODEL_ASSUMPTION',
        'UNKNOWN',
        'STALE',
      ].includes(component.state)) {
    return null;
  }
  return component;
}

function snapshotFundingCarryComponent(
  value: unknown,
): Readonly<PublicBasisEconomicComponent> | null {
  const component = snapshotComponent(value, false);
  if (component === null
      || ![
        'DERIVED_PUBLIC',
        'MODEL_ASSUMPTION',
        'NOT_REQUIRED',
        'UNKNOWN',
        'STALE',
      ].includes(component.state)) {
    return null;
  }
  return component;
}

function selectedProvenanceTime(
  provenance: Readonly<PublicBasisComponentProvenance>,
): number | null {
  switch (provenance.timeBasis) {
    case 'EXCHANGE_EVENT_TIME':
      return provenance.sourceEventAtMs;
    case 'SOURCE_TRANSACTION_TIME':
      return provenance.sourceTransactionAtMs;
    case 'RECEIPT_TIME':
      return provenance.receivedAtMs;
    case 'NOT_APPLICABLE':
    case 'UNKNOWN':
      return null;
  }
}

function sourceTimesPrecedeReceipt(
  provenance: Readonly<PublicBasisComponentProvenance>,
): boolean {
  if (provenance.receivedAtMs === null) return true;
  return [provenance.sourceEventAtMs, provenance.sourceTransactionAtMs]
    .every((time) => time === null || time <= Number(provenance.receivedAtMs));
}

function snapshotQuote(
  value: unknown,
  market: PublicBasisQuoteLeg['market'],
  observedAtMs: number,
  maxQuoteAgeMs: number,
): Readonly<PublicBasisQuoteLeg> | null {
  const record = exactRecord(value, [
    'market',
    'bidPrice',
    'askPrice',
    'bidQuantity',
    'askQuantity',
    'state',
    'provenance',
    'reasonCodes',
  ]);
  if (record === null || record.market !== market
      || !includesValue(['OBSERVED_PUBLIC', 'UNKNOWN', 'STALE'] as const, record.state)) return null;
  const bid = canonicalDecimal(record.bidPrice, true);
  const ask = canonicalDecimal(record.askPrice, true);
  const bidQty = canonicalDecimal(record.bidQuantity, true);
  const askQty = canonicalDecimal(record.askQuantity, true);
  const provenance = snapshotProvenance(record.provenance);
  const reasons = reasonCodes(record.reasonCodes);
  if (bid === null || ask === null || bidQty === null || askQty === null
      || compareExactDecimals(bid, ZERO) <= 0
      || compareExactDecimals(ask, bid) < 0
      || compareExactDecimals(bidQty, ZERO) <= 0
      || compareExactDecimals(askQty, ZERO) <= 0
      || provenance === null
      || reasons === null) return null;
  if (!sourceTimesPrecedeReceipt(provenance)) return null;
  if (provenance.receivedAtMs !== null && provenance.receivedAtMs > observedAtMs) {
    return null;
  }
  if (record.state === 'OBSERVED_PUBLIC') {
    const freshnessTime = selectedProvenanceTime(provenance);
    if (freshnessTime === null
        || freshnessTime > observedAtMs
        || observedAtMs - freshnessTime > maxQuoteAgeMs
        || (provenance.expiresAtMs !== null && provenance.expiresAtMs < observedAtMs)) {
      return null;
    }
  }
  if (market === 'SPOT'
      && provenance.authority === 'BINANCE_PUBLIC'
      && (provenance.timeBasis !== 'RECEIPT_TIME'
        || provenance.sourceEventAtMs !== null
        || provenance.sourceTransactionAtMs !== null
        || provenance.receivedAtMs === null)) {
    return null;
  }
  return deepFreeze({
    market,
    bidPrice: bid,
    askPrice: ask,
    bidQuantity: bidQty,
    askQuantity: askQty,
    state: record.state,
    provenance,
    reasonCodes: reasons,
  });
}

function provenanceTimesAreBound(
  provenance: Readonly<PublicBasisComponentProvenance>,
  asOfMs: number,
): boolean {
  const times = [
    provenance.sourceEventAtMs,
    provenance.sourceTransactionAtMs,
    provenance.receivedAtMs,
  ].filter((time): time is number => time !== null);
  if (times.some((time) => time > asOfMs)
      || !sourceTimesPrecedeReceipt(provenance)
      || (provenance.expiresAtMs !== null && provenance.expiresAtMs < asOfMs)) {
    return false;
  }
  switch (provenance.timeBasis) {
    case 'EXCHANGE_EVENT_TIME':
      return provenance.sourceEventAtMs !== null;
    case 'SOURCE_TRANSACTION_TIME':
      return provenance.sourceTransactionAtMs !== null;
    case 'RECEIPT_TIME':
      return provenance.receivedAtMs !== null;
    case 'NOT_APPLICABLE':
    case 'UNKNOWN':
      return false;
  }
}

function componentAuthorityIsCompatible(
  component: Readonly<PublicBasisEconomicComponent>,
): boolean {
  switch (component.state) {
    case 'OBSERVED_PUBLIC':
    case 'PUBLIC_SCHEDULE_ASSUMPTION':
      return component.provenance.authority === 'BINANCE_PUBLIC';
    case 'DERIVED_PUBLIC':
      return component.provenance.authority === 'BINANCE_PUBLIC'
        || component.provenance.authority === 'PUBLIC_MODEL';
    case 'MODEL_ASSUMPTION':
      return component.provenance.authority === 'PUBLIC_MODEL'
        || component.provenance.authority === 'CONFIG_ASSUMPTION';
    case 'NOT_REQUIRED':
    case 'UNKNOWN':
    case 'STALE':
      return false;
  }
}

function componentHasBoundValue(
  component: Readonly<PublicBasisEconomicComponent>,
  evaluatedAtMs: number,
): component is Readonly<PublicBasisEconomicComponent> & { readonly valuePct: string } {
  return component.valuePct !== null
    && !['UNKNOWN', 'STALE', 'NOT_REQUIRED'].includes(component.state)
    && componentAuthorityIsCompatible(component)
    && component.provenance.sourceId !== null
    && component.provenance.revision !== null
    && component.provenance.receivedAtMs !== null
    && provenanceTimesAreBound(component.provenance, evaluatedAtMs);
}

function quoteIsBound(quote: Readonly<PublicBasisQuoteLeg>, observedAtMs: number): boolean {
  return quote.state === 'OBSERVED_PUBLIC'
    && quote.provenance.authority === 'BINANCE_PUBLIC'
    && quote.provenance.sourceId !== null
    && quote.provenance.revision !== null
    && quote.provenance.receivedAtMs !== null
    && provenanceTimesAreBound(quote.provenance, observedAtMs);
}

function quoteCutIsBound(
  quotes: Readonly<PublicBasisQuoteCut>,
  observedAtMs: number,
): boolean {
  return quoteIsBound(quotes.spot, observedAtMs)
    && quoteIsBound(quotes.perpetual, observedAtMs)
    && Math.abs(
      Number(quotes.spot.provenance.receivedAtMs)
        - Number(quotes.perpetual.provenance.receivedAtMs),
    ) <= quotes.maxReceiptSkewMs;
}

function grossEdgePct(
  direction: BasisDirection,
  quotes: Readonly<PublicBasisQuoteCut>,
): ExactDecimal {
  const sellProceeds = normalizeExactDecimal(
    direction === 'long_spot_short_perp'
      ? quotes.perpetual.bidPrice
      : quotes.spot.bidPrice,
  );
  const longEntry = normalizeExactDecimal(
    direction === 'long_spot_short_perp'
      ? quotes.spot.askPrice
      : quotes.perpetual.askPrice,
  );
  const difference = subtractExactDecimals(sellProceeds, longEntry);
  return multiplyExactDecimals(
    divideExactDecimals(difference, longEntry, PERCENT_DIVISION_SCALE),
    ONE_HUNDRED,
  );
}

function configuredProxyNet(
  direction: BasisDirection,
  gross: ExactDecimal,
  costs: Readonly<PublicBasisOpportunityCosts>,
  quotes: Readonly<PublicBasisQuoteCut>,
  observedAtMs: number,
  evaluatedAtMs: number,
): { readonly value: string | null; readonly reasons: readonly string[] } {
  const components = [
    costs.spotOpenFee,
    costs.spotCloseFee,
    costs.perpetualOpenFee,
    costs.perpetualCloseFee,
    costs.slippage,
    costs.fundingCarry,
  ];
  const reasons: string[] = [];
  if (!quoteIsBound(quotes.spot, observedAtMs)
      || !quoteIsBound(quotes.perpetual, observedAtMs)) {
    reasons.push('PUBLIC_QUOTE_PROVENANCE_INCOMPLETE');
  }
  if (Math.abs(
    Number(quotes.spot.provenance.receivedAtMs)
      - Number(quotes.perpetual.provenance.receivedAtMs),
  ) > quotes.maxReceiptSkewMs) {
    reasons.push('PUBLIC_QUOTE_RECEIPT_SKEW');
  }
  if (components.some((component) => !componentHasBoundValue(component, evaluatedAtMs))) {
    reasons.push('MODELED_COST_PROVENANCE_INCOMPLETE');
  }
  if (direction === 'short_spot_long_perp') {
    reasons.push('REVERSE_BASIS_BORROW_PRIVATE_UNKNOWN');
  } else if (costs.borrowCost.state !== 'NOT_REQUIRED' || costs.borrowCost.valuePct !== '0') {
    reasons.push('FORWARD_BASIS_BORROW_NOT_APPLICABLE_INVALID');
  }
  if (reasons.length > 0) return Object.freeze({ value: null, reasons: Object.freeze(reasons) });
  const feeTotal = sumExactDecimals([
    normalizeExactDecimal(costs.spotOpenFee.valuePct as string),
    normalizeExactDecimal(costs.spotCloseFee.valuePct as string),
    normalizeExactDecimal(costs.perpetualOpenFee.valuePct as string),
    normalizeExactDecimal(costs.perpetualCloseFee.valuePct as string),
  ]);
  let net = subtractExactDecimals(gross, feeTotal);
  net = subtractExactDecimals(net, normalizeExactDecimal(costs.slippage.valuePct as string));
  net = addExactDecimals(net, normalizeExactDecimal(costs.fundingCarry.valuePct as string));
  net = subtractExactDecimals(net, normalizeExactDecimal(costs.borrowCost.valuePct as string));
  return Object.freeze({ value: net, reasons: Object.freeze(reasons) });
}

function contentWithoutIdentity(
  observation: Omit<PublicBasisOpportunityObservation, 'observationId' | 'contentDigestSha256'>,
): unknown {
  return observation;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function buildPublicBasisOpportunityObservation(
  input: Readonly<BuildPublicBasisOpportunityObservationInput>,
): Readonly<PublicBasisOpportunityObservation> {
  assertRawPayloadBound(input);
  const record = exactRecord(input, [
    'opportunityId',
    'opportunityCreatedAtMs',
    'correlationId',
    'sourceCutId',
    'symbol',
    'direction',
    'ownerDecisionKind',
    'observedAtMs',
    'evaluatedAtMs',
    'ownerReportedGrossEdgePct',
    'ownerReportedNetEdgePct',
    'quoteCut',
    'costs',
  ]);
  if (record === null
      || !boundedLabel(record.opportunityId)
      || !boundedLabel(record.correlationId)
      || !boundedLabel(record.sourceCutId)
      || typeof record.symbol !== 'string'
      || !SYMBOL_PATTERN.test(record.symbol)
      || !includesValue(['long_spot_short_perp', 'short_spot_long_perp'] as const, record.direction)
      || !includesValue(PUBLIC_BASIS_OWNER_DECISION_KINDS, record.ownerDecisionKind)
      || !safeUtcMillis(record.opportunityCreatedAtMs)
      || !safeUtcMillis(record.observedAtMs)
      || !safeUtcMillis(record.evaluatedAtMs)
      || Number(record.opportunityCreatedAtMs) > Number(record.observedAtMs)
      || Number(record.observedAtMs) > Number(record.evaluatedAtMs)) {
    throw new TypeError('public Basis opportunity identity or time envelope is invalid');
  }

  const quoteRecord = exactRecord(record.quoteCut, [
    'spot',
    'perpetual',
    'maxQuoteAgeMs',
    'maxReceiptSkewMs',
  ]);
  if (quoteRecord === null
      || !boundedNonNegativeMillis(quoteRecord.maxQuoteAgeMs)
      || !boundedNonNegativeMillis(quoteRecord.maxReceiptSkewMs)) {
    throw new TypeError('public Basis quote policy is invalid');
  }
  const spot = snapshotQuote(
    quoteRecord.spot,
    'SPOT',
    Number(record.observedAtMs),
    Number(quoteRecord.maxQuoteAgeMs),
  );
  const perpetual = snapshotQuote(
    quoteRecord.perpetual,
    'USD_M_PERPETUAL',
    Number(record.observedAtMs),
    Number(quoteRecord.maxQuoteAgeMs),
  );
  if (spot === null || perpetual === null) throw new TypeError('public Basis quote cut is invalid');
  const quoteCut = deepFreeze({
    spot,
    perpetual,
    maxQuoteAgeMs: Number(quoteRecord.maxQuoteAgeMs),
    maxReceiptSkewMs: Number(quoteRecord.maxReceiptSkewMs),
  });

  const costRecord = exactRecord(record.costs, [
    'spotOpenFee',
    'spotCloseFee',
    'perpetualOpenFee',
    'perpetualCloseFee',
    'slippage',
    'fundingCarry',
    'borrowCost',
  ]);
  if (costRecord === null) throw new TypeError('public Basis cost envelope is invalid');
  const costs = deepFreeze({
    spotOpenFee: snapshotFeeComponent(costRecord.spotOpenFee),
    spotCloseFee: snapshotFeeComponent(costRecord.spotCloseFee),
    perpetualOpenFee: snapshotFeeComponent(costRecord.perpetualOpenFee),
    perpetualCloseFee: snapshotFeeComponent(costRecord.perpetualCloseFee),
    slippage: snapshotSlippageComponent(costRecord.slippage),
    fundingCarry: snapshotFundingCarryComponent(costRecord.fundingCarry),
    borrowCost: snapshotComponent(costRecord.borrowCost),
  });
  if (Object.values(costs).some((component) => component === null)) {
    throw new TypeError('public Basis cost component is invalid');
  }
  const exactCosts = costs as unknown as Readonly<PublicBasisOpportunityCosts>;
  const gross = grossEdgePct(record.direction, quoteCut);
  const grossIsBound = quoteCutIsBound(quoteCut, Number(record.observedAtMs));
  const proxy = configuredProxyNet(
    record.direction,
    gross,
    exactCosts,
    quoteCut,
    Number(record.observedAtMs),
    Number(record.evaluatedAtMs),
  );
  const ownerGross = record.ownerReportedGrossEdgePct === null
    ? null
    : canonicalDecimal(record.ownerReportedGrossEdgePct, false);
  const ownerNet = record.ownerReportedNetEdgePct === null
    ? null
    : canonicalDecimal(record.ownerReportedNetEdgePct, false);
  if ((record.ownerReportedGrossEdgePct !== null && ownerGross === null)
      || (record.ownerReportedNetEdgePct !== null && ownerNet === null)) {
    throw new TypeError('owner-reported Basis edge is not a canonical decimal');
  }
  const reasons = Object.freeze([
    ...proxy.reasons,
    ...(grossIsBound ? [] : ['PUBLIC_GROSS_EDGE_UNKNOWN']),
    'ACCOUNT_EFFECTIVE_FEES_NOT_PUBLIC',
    'ACCOUNT_EFFECTIVE_SLIPPAGE_NOT_OBSERVED',
    'OBSERVATION_NOT_EXECUTION_OR_PNL',
  ].filter((reason, index, all) => all.indexOf(reason) === index));
  const economics = deepFreeze({
    grossExecutableEdgePct: grossIsBound ? gross : null,
    grossExecutableEdgeState: grossIsBound ? 'PUBLIC_TOP_OF_BOOK' as const : 'UNKNOWN' as const,
    ownerReportedGrossEdgePct: ownerGross,
    ownerReportedNetEdgePct: ownerNet,
    configuredProxyNetEdgePct: proxy.value,
    configuredProxyNetState: proxy.value === null ? 'UNKNOWN' as const : 'ASSUMPTION_BOUND' as const,
    accountEffectiveNetEdgePct: null,
    accountEffectiveNetState: 'UNKNOWN' as const,
    configuredProxyNetEdgeUsdPerOneThousandNotional: proxy.value === null
      ? null
      : multiplyExactDecimals(normalizeExactDecimal(proxy.value), normalizeExactDecimal('10')),
  });
  const core = deepFreeze({
    schema: PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_SCHEMA,
    version: PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_VERSION,
    releaseState: PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_RELEASE_STATE,
    strategyAuthority: 'BASIS_ENGINE' as const,
    sourceAuthority: 'PUBLIC_ONLY' as const,
    executionAuthority: 'NONE' as const,
    measurementMeaning: 'PUBLIC_OBSERVED_PROXY_NOT_EXECUTED' as const,
    returnContractVersion: EXECUTABLE_BASIS_RETURN_CONTRACT.version,
    edgeComputationPolicy: PUBLIC_BASIS_EDGE_COMPUTATION_POLICY,
    opportunityId: record.opportunityId,
    opportunityCreatedAtMs: Number(record.opportunityCreatedAtMs),
    correlationId: record.correlationId,
    sourceCutId: record.sourceCutId,
    symbol: record.symbol,
    direction: record.direction,
    ownerDecisionKind: record.ownerDecisionKind,
    observedAtMs: Number(record.observedAtMs),
    evaluatedAtMs: Number(record.evaluatedAtMs),
    quoteCut,
    costs: exactCosts,
    economics,
    reasonCodes: reasons,
  });
  const digest = sha256(contentWithoutIdentity(core as Omit<
    PublicBasisOpportunityObservation,
    'observationId' | 'contentDigestSha256'
  >));
  const semanticIdentityDigest = sha256({
    schema: PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_SCHEMA,
    version: PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_VERSION,
    opportunityId: record.opportunityId,
    opportunityCreatedAtMs: Number(record.opportunityCreatedAtMs),
    correlationId: record.correlationId,
    sourceCutId: record.sourceCutId,
    symbol: record.symbol,
    direction: record.direction,
    ownerDecisionKind: record.ownerDecisionKind,
    observedAtMs: Number(record.observedAtMs),
  });
  const observation = deepFreeze({
    ...core,
    observationId: `basisobs_${semanticIdentityDigest.slice(0, 32)}`,
    contentDigestSha256: digest,
  }) as Readonly<PublicBasisOpportunityObservation>;
  if (Buffer.byteLength(canonicalJson(observation), 'utf8')
      > MAX_PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_PAYLOAD_BYTES) {
    throw new RangeError('public Basis opportunity observation exceeds its payload bound');
  }
  return observation;
}

export function validatePublicBasisOpportunityObservation(value: unknown): readonly string[] {
  try {
    assertRawPayloadBound(value);
  } catch {
    return Object.freeze(['OBSERVATION_SHAPE_INVALID']);
  }
  const top = exactRecord(value, [
    'schema',
    'version',
    'releaseState',
    'strategyAuthority',
    'sourceAuthority',
    'executionAuthority',
    'measurementMeaning',
    'returnContractVersion',
    'edgeComputationPolicy',
    'observationId',
    'contentDigestSha256',
    'opportunityId',
    'opportunityCreatedAtMs',
    'correlationId',
    'sourceCutId',
    'symbol',
    'direction',
    'ownerDecisionKind',
    'observedAtMs',
    'evaluatedAtMs',
    'quoteCut',
    'costs',
    'economics',
    'reasonCodes',
  ]);
  if (top === null) return Object.freeze(['OBSERVATION_SHAPE_INVALID']);
  try {
    const rebuilt = buildPublicBasisOpportunityObservation({
      opportunityId: top.opportunityId as string,
      opportunityCreatedAtMs: top.opportunityCreatedAtMs as number,
      correlationId: top.correlationId as string,
      sourceCutId: top.sourceCutId as string,
      symbol: top.symbol as string,
      direction: top.direction as BasisDirection,
      ownerDecisionKind: top.ownerDecisionKind as PublicBasisOwnerDecisionKind,
      observedAtMs: top.observedAtMs as number,
      evaluatedAtMs: top.evaluatedAtMs as number,
      ownerReportedGrossEdgePct: (top.economics as Record<string, unknown>)?.ownerReportedGrossEdgePct as string | null,
      ownerReportedNetEdgePct: (top.economics as Record<string, unknown>)?.ownerReportedNetEdgePct as string | null,
      quoteCut: top.quoteCut as PublicBasisQuoteCut,
      costs: top.costs as PublicBasisOpportunityCosts,
    });
    if (canonicalJson(rebuilt) !== canonicalJson(value)) {
      return Object.freeze(['OBSERVATION_CONTENT_OR_IDENTITY_INVALID']);
    }
    return Object.freeze([]);
  } catch {
    return Object.freeze(['OBSERVATION_CONTENT_INVALID']);
  }
}

export function isPublicBasisOpportunityObservation(
  value: unknown,
): value is PublicBasisOpportunityObservation {
  return validatePublicBasisOpportunityObservation(value).length === 0;
}

export function decodePublicBasisOpportunityObservation(
  value: unknown,
): Readonly<PublicBasisOpportunityObservation> | null {
  if (!isPublicBasisOpportunityObservation(value)) return null;
  return deepFreeze(JSON.parse(canonicalJson(value)) as PublicBasisOpportunityObservation);
}
