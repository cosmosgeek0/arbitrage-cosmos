import {
  canonicalJson,
  makeStableFailure,
  sortedUnique,
  stableId,
  validateNoSecretFields,
  type InstrumentIdentity,
  type JsonValue,
  type StableFailure,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  ListingObservation,
  TradingRuleEvidence,
} from '../../intelligenceFoundation/universe/index.js';
import type { RuntimeUniverseConfig, RuntimeUniverseSource, RuntimeExchangeFilterMetadata, RuntimeListingMetadata } from './types.js';
import { runtimeUniverseTruth } from './truth.js';

export interface ParsedRuntimeListing {
  key: string;
  listing: ListingObservation | null;
  metadata: RuntimeListingMetadata;
}

export interface ParsedExchangeInformation {
  complete: boolean;
  listings: ParsedRuntimeListing[];
  failures: StableFailure[];
}

interface RowIssue {
  field: string;
  message: string;
}

class StableParseError extends Error {
  readonly failure: StableFailure;

  constructor(failure: StableFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface ParseContext {
  source: RuntimeUniverseSource;
  sourceId: string;
  dataset: string;
  receivedTimeMs: number;
  evaluatedAtMs: number;
  config: RuntimeUniverseConfig;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new TypeError(`${field} must be a bounded non-empty string`);
  }
  return value;
}

function canonicalToken(value: unknown, field: string, maximum = 256): string {
  const normalized = boundedText(value, field, maximum).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(normalized)) {
    throw new TypeError(`${field} must be an uppercase exchange token`);
  }
  return normalized;
}

function canonicalInstrumentToken(value: unknown, field: string, maximum = 256): string {
  const normalized = boundedText(value, field, maximum).trim().normalize('NFC').toUpperCase();
  if (!/^[\p{L}\p{N}._-]+$/u.test(normalized)) {
    throw new TypeError(`${field} must be a bounded exchange instrument token`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, issues: RowIssue[]): string | null {
  if (value === undefined || value === null) return null;
  try {
    return boundedText(value, field);
  } catch (error) {
    issues.push({ field, message: error instanceof Error ? error.message : `${field} is invalid` });
    return null;
  }
}

function optionalTime(value: unknown, field: string, issues: RowIssue[]): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    issues.push({ field, message: `${field} must be a non-negative safe integer` });
    return null;
  }
  return value as number;
}

function optionalBoolean(value: unknown, field: string, issues: RowIssue[]): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') {
    issues.push({ field, message: `${field} must be boolean when supplied` });
    return null;
  }
  return value;
}

function textArray(value: unknown, field: string, issues: RowIssue[], maximum = 128): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    issues.push({ field, message: `${field} must be a bounded string array` });
    return [];
  }
  const output: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    try {
      output.push(boundedText(value[index], `${field}[${index}]`));
    } catch (error) {
      issues.push({ field: `${field}[${index}]`, message: error instanceof Error ? error.message : `${field} is invalid` });
    }
  }
  return sortedUnique(output);
}

const MAXIMUM_PERMISSION_SETS = 128;
const MAXIMUM_PERMISSIONS_PER_SET = 512;
const MAXIMUM_TOTAL_PERMISSIONS = 4_096;

function permissionSets(
  source: RuntimeUniverseSource,
  value: unknown,
  legacy: unknown,
  issues: RowIssue[],
): string[][] {
  const selected = value ?? legacy;
  if (selected === undefined || selected === null) return [];
  if (!Array.isArray(selected)) {
    issues.push({ field: 'permissionSets', message: 'permissionSets must be a bounded array' });
    return [];
  }

  // Current Spot exchangeInfo uses string[][] while current USD-M uses a flat
  // string[]. The legacy Spot `permissions` field is also flat. Mixed shapes
  // are ambiguous and must not be guessed into exchange capability truth.
  const isFlat = selected.every((entry) => typeof entry === 'string');
  const isNested = selected.every((entry) => Array.isArray(entry));
  const selectedSets: unknown[] = isFlat
    ? [selected]
    : isNested
      ? selected
      : [];
  if (selected.length > 0 && selectedSets.length === 0) {
    issues.push({ field: 'permissionSets', message: 'permissionSets must use one homogeneous public exchange shape' });
    return [];
  }
  if (source === 'SPOT' && selected.length > 0 && value !== undefined && value !== null && isFlat) {
    issues.push({ field: 'permissionSets', message: 'Spot permissionSets must be a bounded array of string arrays' });
    return [];
  }
  if (selectedSets.length > MAXIMUM_PERMISSION_SETS) {
    issues.push({ field: 'permissionSets', message: 'permissionSets exceeds the bounded set count' });
    return [];
  }

  const output: string[][] = [];
  let retainedPermissions = 0;
  for (let index = 0; index < selectedSets.length; index += 1) {
    const entry = textArray(
      selectedSets[index],
      `permissionSets[${index}]`,
      issues,
      MAXIMUM_PERMISSIONS_PER_SET,
    );
    if (retainedPermissions + entry.length > MAXIMUM_TOTAL_PERMISSIONS) {
      issues.push({ field: `permissionSets[${index}]`, message: 'permissionSets exceeds the bounded total permission count' });
      break;
    }
    retainedPermissions += entry.length;
    if (entry.length > 0) output.push(entry);
  }
  output.sort((left, right) => codePointCompare(canonicalJson(left), canonicalJson(right)));
  return [...new Map(output.map((entry) => [canonicalJson(entry), entry])).values()];
}

function numericPrecisions(row: Record<string, unknown>, issues: RowIssue[]): Record<string, number> {
  const fields = [
    'baseAssetPrecision', 'quotePrecision', 'quoteAssetPrecision', 'baseCommissionPrecision',
    'quoteCommissionPrecision', 'pricePrecision', 'quantityPrecision',
  ];
  const output: Record<string, number> = {};
  for (const field of fields) {
    if (row[field] === undefined || row[field] === null) continue;
    if (!Number.isSafeInteger(row[field]) || (row[field] as number) < 0) {
      issues.push({ field, message: `${field} must be a non-negative safe integer` });
    } else output[field] = row[field] as number;
  }
  return output;
}

function cloneJson(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}

function filtersOf(value: unknown, context: ParseContext, issues: RowIssue[]): RuntimeExchangeFilterMetadata[] {
  if (!Array.isArray(value)) throw new TypeError('filters must be an array');
  if (value.length > context.config.maximumFiltersPerSymbol) {
    throw new RangeError('filter count exceeds the configured bound');
  }
  const output: RuntimeExchangeFilterMetadata[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const filter = value[index];
    if (!object(filter)) throw new TypeError(`filters[${index}] must be an object`);
    const secret = validateNoSecretFields(filter, 'runtime_universe_filter');
    if (!secret.ok) throw new StableParseError(secret.failure);
    const serialized = canonicalJson(filter);
    if (Buffer.byteLength(serialized, 'utf8') > context.config.maximumFilterBytes) {
      throw new RangeError(`filters[${index}] exceeds the configured byte bound`);
    }
    const filterType = canonicalToken(filter.filterType, `filters[${index}].filterType`, 128);
    const values = cloneJson(filter);
    if (!object(values)) throw new TypeError(`filters[${index}] could not be canonicalized`);
    output.push({ filterType, values: values as Record<string, JsonValue> });
  }
  output.sort((left, right) => codePointCompare(left.filterType, right.filterType)
    || codePointCompare(canonicalJson(left.values), canonicalJson(right.values)));
  const counts = new Map<string, number>();
  for (const filter of output) counts.set(filter.filterType, (counts.get(filter.filterType) ?? 0) + 1);
  for (const [filterType, count] of counts) {
    if (count > 1) issues.push({ field: `filters.${filterType}`, message: `duplicate ${filterType} filters are ambiguous` });
  }
  return output;
}

function filterByType(filters: readonly RuntimeExchangeFilterMetadata[], type: string): RuntimeExchangeFilterMetadata | null {
  const matches = filters.filter((filter) => filter.filterType === type);
  return matches.length === 1 ? matches[0] : null;
}

function decimalField(
  filter: RuntimeExchangeFilterMetadata | null,
  fields: readonly string[],
  issues: RowIssue[],
): number | null {
  if (filter === null) return null;
  const field = fields.find((candidate) => Object.hasOwn(filter.values, candidate));
  if (field === undefined) return null;
  const raw = filter.values[field];
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    issues.push({ field: `filters.${filter.filterType}.${field}`, message: `${field} must be a decimal` });
    return null;
  }
  if (typeof raw === 'string' && !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
    issues.push({ field: `filters.${filter.filterType}.${field}`, message: `${field} is not a non-negative decimal` });
    return null;
  }
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    issues.push({ field: `filters.${filter.filterType}.${field}`, message: `${field} must be finite and non-negative` });
    return null;
  }
  return Object.is(parsed, -0) ? 0 : parsed;
}

function rulesOf(filters: readonly RuntimeExchangeFilterMetadata[], issues: RowIssue[]): TradingRuleEvidence {
  const price = filterByType(filters, 'PRICE_FILTER');
  const lot = filterByType(filters, 'LOT_SIZE');
  const notional = filterByType(filters, 'NOTIONAL') ?? filterByType(filters, 'MIN_NOTIONAL');
  if (price === null) issues.push({ field: 'filters.PRICE_FILTER', message: 'PRICE_FILTER is required rule evidence' });
  if (lot === null) issues.push({ field: 'filters.LOT_SIZE', message: 'LOT_SIZE is required rule evidence' });
  if (notional === null) issues.push({ field: 'filters.NOTIONAL', message: 'NOTIONAL or MIN_NOTIONAL is required rule evidence' });
  let minimumPrice = decimalField(price, ['minPrice'], issues);
  let maximumPrice = decimalField(price, ['maxPrice'], issues);
  const tickSize = decimalField(price, ['tickSize'], issues);
  let minimumQuantity = decimalField(lot, ['minQty'], issues);
  let maximumQuantity = decimalField(lot, ['maxQty'], issues);
  const quantityStep = decimalField(lot, ['stepSize'], issues);
  let minimumNotional = decimalField(notional, ['minNotional', 'notional'], issues);
  let maximumNotional = decimalField(notional, ['maxNotional'], issues);
  if (price !== null && !Object.hasOwn(price.values, 'tickSize')) {
    issues.push({ field: 'filters.PRICE_FILTER.tickSize', message: 'tickSize is required rule evidence' });
  }
  if (lot !== null && !Object.hasOwn(lot.values, 'stepSize')) {
    issues.push({ field: 'filters.LOT_SIZE.stepSize', message: 'stepSize is required rule evidence' });
  }
  if (notional !== null && !Object.hasOwn(notional.values, 'minNotional') && !Object.hasOwn(notional.values, 'notional')) {
    issues.push({ field: `filters.${notional.filterType}.notional`, message: 'minimum notional is required rule evidence' });
  }
  const incoherent = (minimum: number | null, maximum: number | null): boolean =>
    minimum !== null && maximum !== null && minimum > maximum;
  if (incoherent(minimumPrice, maximumPrice)) {
    issues.push({ field: 'filters.PRICE_FILTER', message: 'minimum price exceeds maximum price' });
    minimumPrice = null;
    maximumPrice = null;
  }
  if (incoherent(minimumQuantity, maximumQuantity)) {
    issues.push({ field: 'filters.LOT_SIZE', message: 'minimum quantity exceeds maximum quantity' });
    minimumQuantity = null;
    maximumQuantity = null;
  }
  if (incoherent(minimumNotional, maximumNotional)) {
    issues.push({ field: 'filters.NOTIONAL', message: 'minimum notional exceeds maximum notional' });
    minimumNotional = null;
    maximumNotional = null;
  }
  return {
    minimumPrice,
    maximumPrice,
    tickSize,
    minimumQuantity,
    maximumQuantity,
    quantityStep,
    minimumNotional,
    maximumNotional,
  };
}

function instrumentId(input: Omit<InstrumentIdentity, 'instrumentId'>): string {
  return stableId('instrument', input);
}

function issueFailures(source: RuntimeUniverseSource, symbol: string, issues: readonly RowIssue[]): StableFailure[] {
  return issues.map((issue) => makeStableFailure(
    'INCOMPLETE_EVIDENCE',
    'runtime_universe',
    issue.message,
    `${source}.${symbol}.${issue.field}`,
  ));
}

function parseRow(raw: unknown, index: number, context: ParseContext): {
  value: ParsedRuntimeListing;
  failures: StableFailure[];
} {
  if (!object(raw)) throw new TypeError(`symbols[${index}] must be an object`);
  if (!Array.isArray(raw.filters) || raw.filters.length > context.config.maximumFiltersPerSymbol) {
    throw new RangeError(`symbols[${index}].filters exceeds the configured bound or is not an array`);
  }
  const secret = validateNoSecretFields(raw, 'runtime_universe_exchange_info_row');
  if (!secret.ok) throw new StableParseError(secret.failure);
  const symbol = canonicalInstrumentToken(raw.symbol, `symbols[${index}].symbol`);
  const status = canonicalToken(raw.status, `symbols[${index}].status`);
  const baseAsset = canonicalInstrumentToken(raw.baseAsset, `symbols[${index}].baseAsset`);
  const quoteAsset = canonicalInstrumentToken(raw.quoteAsset, `symbols[${index}].quoteAsset`);
  const pair = context.source === 'SPOT'
    ? symbol
    : canonicalInstrumentToken(raw.pair, `symbols[${index}].pair`);
  const contractType = context.source === 'SPOT'
    ? null
    : canonicalToken(raw.contractType, `symbols[${index}].contractType`);
  const expectedPair = `${baseAsset}${quoteAsset}`;
  if (pair !== expectedPair) {
    throw new TypeError(`symbols[${index}].pair conflicts with baseAsset and quoteAsset`);
  }
  if (context.source === 'USD_M_PERPETUAL' && contractType === 'PERPETUAL' && symbol !== pair) {
    throw new TypeError(`symbols[${index}].symbol conflicts with its Perpetual pair`);
  }
  const issues: RowIssue[] = [];
  const filters = filtersOf(raw.filters, context, issues);
  const rules = rulesOf(filters, issues);
  const tradingAllowed = context.source === 'SPOT'
    ? optionalBoolean(raw.isSpotTradingAllowed, 'isSpotTradingAllowed', issues)
    : null;
  const includedInUniverse = context.source === 'SPOT' || contractType === 'PERPETUAL';
  const exclusionReasonCodes = includedInUniverse ? [] : ['NON_PERPETUAL_CONTRACT_OUTSIDE_FOUNDATION_UNIVERSE'];
  const productFamily = context.source === 'SPOT' ? 'SPOT' as const : 'USD_M_PERPETUAL' as const;
  const identityBase: Omit<InstrumentIdentity, 'instrumentId'> = {
    venue: 'BINANCE',
    productFamily,
    symbol,
    pair,
    baseAsset,
    quoteAsset,
    contractType: context.source === 'SPOT' ? null : 'PERPETUAL',
    sourceMarketType: context.source === 'SPOT' ? null : 1,
  };
  const identity: InstrumentIdentity = { instrumentId: instrumentId(identityBase), ...identityBase };
  const aliases = sortedUnique([symbol, pair]).slice(0, context.config.maximumAliasesPerListing);
  const semanticMetadata = {
    source: context.source,
    symbol,
    pair,
    baseAsset,
    quoteAsset,
    status,
    tradingAllowed,
    contractType,
    onboardDateMs: optionalTime(raw.onboardDate, 'onboardDate', issues),
    deliveryDateMs: optionalTime(raw.deliveryDate, 'deliveryDate', issues),
    marginAsset: optionalText(raw.marginAsset, 'marginAsset', issues),
    underlyingType: optionalText(raw.underlyingType, 'underlyingType', issues),
    underlyingSubType: textArray(raw.underlyingSubType, 'underlyingSubType', issues),
    orderTypes: textArray(raw.orderTypes, 'orderTypes', issues),
    timeInForce: textArray(raw.timeInForce, 'timeInForce', issues),
    permissionSets: permissionSets(context.source, raw.permissionSets, raw.permissions, issues),
    precisions: numericPrecisions(raw, issues),
    filters,
    includedInUniverse,
    exclusionReasonCodes,
  };
  const fingerprint = stableId('runtime-listing-metadata', semanticMetadata);
  const metadataId = stableId('runtime-listing-record', { source: context.source, symbol });
  const sourceRecordId = stableId('runtime-exchange-info-row', { source: context.source, fingerprint });
  const missingFields = sortedUnique(issues.map((issue) => issue.field));
  const truth = runtimeUniverseTruth({
    configurationVersion: context.config.configurationVersion,
    sourceId: context.sourceId,
    dataset: context.dataset,
    endpointClass: 'REST',
    authorityKind: 'EXCHANGE_PRIMARY',
    evaluatedAtMs: context.evaluatedAtMs,
    receivedTimeMs: context.receivedTimeMs,
    maxAgeMs: context.config.sourceStaleAfterMs,
    sourceRecordIds: [sourceRecordId],
    transforms: ['normalize-public-exchange-info-v1'],
    completeness: missingFields.length === 0 ? 'COMPLETE' : 'PARTIAL',
    observedFields: ['symbol', 'pair', 'baseAsset', 'quoteAsset', 'status', 'filters', 'contractMetadata'],
    missingFields,
    reasonCodes: missingFields.length === 0 ? [] : ['EXCHANGE_INFO_ROW_PARTIAL'],
  });
  const metadata: RuntimeListingMetadata = {
    id: metadataId,
    fingerprint,
    ...semanticMetadata,
    receivedTimeMs: context.receivedTimeMs,
    truth,
  };
  const listing: ListingObservation | null = includedInUniverse ? {
    id: stableId('runtime-listing', { source: context.source, instrumentId: identity.instrumentId }),
    kind: context.source === 'SPOT' ? 'SPOT_LISTING' : 'USD_M_PERPETUAL_LISTING',
    instrument: identity,
    tradingStatus: status,
    tradingAllowed,
    aliases,
    rules,
    quoteVolume: null,
    quoteVolume24hUsd: null,
    truth,
  } : null;
  return {
    value: { key: symbol, listing, metadata },
    failures: issueFailures(context.source, symbol, issues),
  };
}

export function parseExchangeInformation(body: unknown, context: ParseContext): ParsedExchangeInformation {
  if (!object(body) || !Array.isArray(body.symbols)) {
    return {
      complete: false,
      listings: [],
      failures: [makeStableFailure('INVALID_VALUE', 'runtime_universe', 'exchangeInfo response must contain a symbols array', `${context.source}.symbols`)],
    };
  }
  const topLevelKeys = Object.keys(body);
  if (topLevelKeys.length > 128) {
    return {
      complete: false,
      listings: [],
      failures: [makeStableFailure('BUDGET_EXHAUSTED', 'runtime_universe', 'exchangeInfo top-level field count exceeds the configured safety bound', `${context.source}.response`)],
    };
  }
  const topLevelSecret = validateNoSecretFields(
    Object.fromEntries(topLevelKeys.map((key) => [key, null])),
    'runtime_universe_exchange_info',
  );
  if (!topLevelSecret.ok) return { complete: false, listings: [], failures: [topLevelSecret.failure] };
  if (body.symbols.length > context.config.maximumSymbolsPerSource) {
    return {
      complete: false,
      listings: [],
      failures: [makeStableFailure('BUDGET_EXHAUSTED', 'runtime_universe', 'exchangeInfo symbol count exceeds the configured bound', `${context.source}.symbols`)],
    };
  }
  if (body.symbols.length === 0) {
    return {
      complete: false,
      listings: [],
      failures: [makeStableFailure(
        'INCOMPLETE_EVIDENCE',
        'runtime_universe',
        'an empty successful exchangeInfo symbol set is anomalous and cannot authorize mass removal',
        `${context.source}.symbols`,
      )],
    };
  }
  const listings: ParsedRuntimeListing[] = [];
  const failures: StableFailure[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < body.symbols.length; index += 1) {
    try {
      const parsed = parseRow(body.symbols[index], index, context);
      if (seen.has(parsed.value.key)) {
        failures.push(makeStableFailure('DUPLICATE_EVENT', 'runtime_universe', 'duplicate symbol row rejected', `${context.source}.symbols`, [parsed.value.metadata.id]));
        continue;
      }
      seen.add(parsed.value.key);
      listings.push(parsed.value);
      failures.push(...parsed.failures);
    } catch (error) {
      failures.push(error instanceof StableParseError
        ? error.failure
        : makeStableFailure(
          error instanceof RangeError ? 'BUDGET_EXHAUSTED' : 'INVALID_VALUE',
          'runtime_universe',
          error instanceof Error ? error.message : 'exchangeInfo row is invalid',
          `${context.source}.symbols[${index}]`,
        ));
    }
  }
  listings.sort((left, right) => codePointCompare(left.key, right.key));
  failures.sort((left, right) => codePointCompare(left.id, right.id));
  return { complete: failures.length === 0, listings, failures };
}
