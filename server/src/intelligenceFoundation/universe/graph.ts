import {
  EVIDENCE_KINDS,
  canonicalJson,
  makeStableFailure,
  sortedUnique,
  stableId,
  validateInstrumentIdentity,
  validateNoSecretFields,
  validateNormalizedEvidence,
  validateTruthMetadata,
  type EvidenceKind,
  type InstrumentIdentity,
  type NormalizedBorrow,
  type StableFailure,
  type TruthMetadata,
} from '../contracts/index.js';
import {
  UNIVERSE_SOURCE_KINDS,
  type BorrowEligibilityView,
  type CoverageAvailability,
  type CoverageModeObservation,
  type CoverageObservation,
  type CoverageSummary,
  type CoverageView,
  type FocusEligibility,
  type FocusTruthReceipt,
  type ListingObservation,
  type ListingView,
  type MarginEligibilityObservation,
  type MarginEligibilityView,
  type MarketAvailability,
  type QuoteVolumeObservation,
  type TradingRuleEvidence,
  type UniverseAliasEntry,
  type UniverseGraph,
  type UniverseGraphChange,
  type UniverseGraphDiff,
  type UniverseGraphUpdate,
  type UniverseMarketNode,
  type UniversePolicy,
  type UniverseSnapshotInput,
  type UniverseSourceKind,
  type UniverseSourceSlice,
  type UniverseSourceState,
} from './types.js';

const PRODUCER_VERSION = 'intelligence-universe-1';
const DEFAULT_MAX_RECORDS = 10_000;
const DEFAULT_MAX_ALIASES = 64;

const codePointCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isSafeTime = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const nullableNonNegative = (value: unknown): value is number | null => value === null || isFiniteNumber(value) && value >= 0;

function sortEvidenceKinds(values: readonly EvidenceKind[]): EvidenceKind[] {
  return sortedUnique(values) as EvidenceKind[];
}

function canonicalToken(value: string): string {
  return value.trim().toUpperCase();
}

function cloneTruth(truth: TruthMetadata): TruthMetadata {
  return {
    schemaVersion: truth.schemaVersion,
    producerVersion: truth.producerVersion,
    configurationVersion: truth.configurationVersion,
    featureVersion: truth.featureVersion,
    authority: { ...truth.authority },
    provenance: {
      sourceRecordIds: [...truth.provenance.sourceRecordIds],
      sourceSet: [...truth.provenance.sourceSet],
      transforms: [...truth.provenance.transforms],
    },
    temporal: {
      ...truth.temporal,
      sequence: truth.temporal.sequence ? { ...truth.temporal.sequence } : null,
    },
    freshness: { ...truth.freshness },
    completeness: {
      state: truth.completeness.state,
      observedFields: [...truth.completeness.observedFields],
      missingFields: [...truth.completeness.missingFields],
      reasonCodes: [...truth.completeness.reasonCodes],
    },
  };
}

function cloneInstrument(instrument: InstrumentIdentity): InstrumentIdentity {
  return { ...instrument };
}

function clonePolicy(policy: UniversePolicy): UniversePolicy {
  return {
    ...policy,
    activeSpotStatuses: [...policy.activeSpotStatuses],
    activePerpetualStatuses: [...policy.activePerpetualStatuses],
    allowedQuoteAssetsForFocus: policy.allowedQuoteAssetsForFocus === null ? null : [...policy.allowedQuoteAssetsForFocus],
  };
}

function cloneQuoteVolume(value: QuoteVolumeObservation): QuoteVolumeObservation {
  return {
    ...value,
    truth: cloneTruth(value.truth),
    conversionTruth: value.conversionTruth === null ? null : cloneTruth(value.conversionTruth),
  };
}

export function createUniversePolicy(overrides: Partial<UniversePolicy> = {}): UniversePolicy {
  const policy: UniversePolicy = {
    configurationVersion: overrides.configurationVersion ?? 'universe-policy-1',
    activeSpotStatuses: overrides.activeSpotStatuses ?? ['TRADING'],
    activePerpetualStatuses: overrides.activePerpetualStatuses ?? ['TRADING'],
    allowedQuoteAssetsForFocus: overrides.allowedQuoteAssetsForFocus ?? null,
    minimumQuoteVolume24hUsdForFocus: overrides.minimumQuoteVolume24hUsdForFocus ?? null,
    requireSpotForFocus: overrides.requireSpotForFocus ?? true,
    requirePerpetualForFocus: overrides.requirePerpetualForFocus ?? false,
    requireMarginForFocus: overrides.requireMarginForFocus ?? false,
    requireBorrowEligibilityForFocus: overrides.requireBorrowEligibilityForFocus ?? false,
    requireBorrowAvailabilityForFocus: overrides.requireBorrowAvailabilityForFocus ?? false,
    requirePublicDataForFocus: overrides.requirePublicDataForFocus ?? true,
    requireFocusedDataForFocus: overrides.requireFocusedDataForFocus ?? false,
    maxRecordsPerSource: overrides.maxRecordsPerSource ?? DEFAULT_MAX_RECORDS,
    maxAliasesPerInstrument: overrides.maxAliasesPerInstrument ?? DEFAULT_MAX_ALIASES,
  };

  if (!nonEmpty(policy.configurationVersion)) throw new RangeError('universe configurationVersion is required');
  for (const [name, statuses] of [
    ['activeSpotStatuses', policy.activeSpotStatuses],
    ['activePerpetualStatuses', policy.activePerpetualStatuses],
  ] as const) {
    if (!Array.isArray(statuses) || statuses.length === 0 || statuses.some((status) => !nonEmpty(status))) {
      throw new RangeError(`universe ${name} must contain non-empty statuses`);
    }
  }
  if (
    policy.allowedQuoteAssetsForFocus !== null &&
    (!Array.isArray(policy.allowedQuoteAssetsForFocus) || policy.allowedQuoteAssetsForFocus.some((asset) => !nonEmpty(asset)))
  ) throw new RangeError('universe allowedQuoteAssetsForFocus is invalid');
  if (!nullableNonNegative(policy.minimumQuoteVolume24hUsdForFocus)) {
    throw new RangeError('universe minimumQuoteVolume24hUsdForFocus must be null or non-negative');
  }
  if (!Number.isInteger(policy.maxRecordsPerSource) || policy.maxRecordsPerSource < 1 || policy.maxRecordsPerSource > 50_000) {
    throw new RangeError('universe maxRecordsPerSource must be an integer in 1..50000');
  }
  if (!Number.isInteger(policy.maxAliasesPerInstrument) || policy.maxAliasesPerInstrument < 1 || policy.maxAliasesPerInstrument > 512) {
    throw new RangeError('universe maxAliasesPerInstrument must be an integer in 1..512');
  }

  return {
    ...policy,
    activeSpotStatuses: sortedUnique(policy.activeSpotStatuses.map(canonicalToken)),
    activePerpetualStatuses: sortedUnique(policy.activePerpetualStatuses.map(canonicalToken)),
    allowedQuoteAssetsForFocus: policy.allowedQuoteAssetsForFocus === null
      ? null
      : sortedUnique(policy.allowedQuoteAssetsForFocus.map(canonicalToken)),
  };
}

function failure(
  code: StableFailure['code'],
  message: string,
  field: string | null,
  evidenceIds: string[] = [],
): StableFailure {
  return makeStableFailure(code, 'intelligence_universe', message, field, evidenceIds);
}

function validateAtOrBeforeObservation(truth: TruthMetadata, observedAtMs: number, field: string): StableFailure | null {
  if (truth.freshness.evaluatedAtMs > observedAtMs || truth.temporal.receivedTimeMs > observedAtMs) {
    return failure('TIMESTAMP_SKEW', 'source truth occurs after the universe observation time', field, truth.provenance.sourceRecordIds);
  }
  return null;
}

interface ValidatedSlice<T> {
  state: UniverseSourceState;
  truth: TruthMetadata | null;
  records: T[];
  failures: StableFailure[];
}

function stableRowField(source: UniverseSourceKind, record: unknown): string {
  let naturalIdentity: unknown;
  if (isObject(record)) {
    const instrument = isObject(record.instrument) ? record.instrument : null;
    naturalIdentity = {
      source,
      id: nonEmpty(record.id) ? record.id : null,
      kind: nonEmpty(record.kind) ? record.kind : null,
      asset: nonEmpty(record.asset) ? record.asset : null,
      instrumentId: instrument && nonEmpty(instrument.instrumentId) ? instrument.instrumentId : null,
      symbol: instrument && nonEmpty(instrument.symbol) ? instrument.symbol : null,
      productFamily: instrument && nonEmpty(instrument.productFamily) ? instrument.productFamily : null,
    };
    if (Object.values(naturalIdentity as Record<string, unknown>).every((entry) => entry === null || entry === source)) {
      try {
        naturalIdentity = { source, record };
        stableId('universe-row-probe', naturalIdentity);
      } catch {
        naturalIdentity = { source, type: 'object', keys: Object.keys(record).sort(codePointCompare) };
      }
    }
  } else {
    naturalIdentity = { source, type: record === null ? 'null' : typeof record, value: typeof record === 'symbol' ? String(record) : record };
  }
  return `${source}.records.${stableId('universe-row', naturalIdentity)}`;
}

function degradeSliceTruth(truth: TruthMetadata, source: UniverseSourceKind, reasonCodes: string[], missingFields: string[]): TruthMetadata {
  const degraded = cloneTruth(truth);
  degraded.completeness = {
    state: 'PARTIAL',
    observedFields: sortedUnique(degraded.completeness.observedFields),
    missingFields: sortedUnique([...degraded.completeness.missingFields, ...missingFields]),
    reasonCodes: sortedUnique([...degraded.completeness.reasonCodes, ...reasonCodes, `${source}_SLICE_DEGRADED`]),
  };
  return degraded;
}

function validateSlice<T>(
  value: unknown,
  expectedSource: UniverseSourceKind,
  observedAtMs: number,
  maxRecords: number,
  validateRecord: (record: unknown, field: string) => { value: T | null; failures: StableFailure[] },
): ValidatedSlice<T> {
  const failures: StableFailure[] = [];
  if (!isObject(value)) {
    failures.push(failure('MISSING_SOURCE', `${expectedSource} source slice is missing`, expectedSource));
    return { state: 'UNAVAILABLE', truth: null, records: [], failures };
  }
  if (value.source !== expectedSource || !['COMPLETE', 'PARTIAL', 'UNAVAILABLE'].includes(String(value.state))) {
    failures.push(failure('INVALID_VALUE', `${expectedSource} source slice has an invalid discriminator`, expectedSource));
    return { state: 'UNAVAILABLE', truth: null, records: [], failures };
  }
  const state = value.state as UniverseSourceState;
  const truthResult = validateTruthMetadata(value.truth);
  let truth: TruthMetadata | null = null;
  if (!truthResult.ok) failures.push(truthResult.failure);
  else {
    truth = truthResult.value;
    const timeFailure = validateAtOrBeforeObservation(truth, observedAtMs, `${expectedSource}.truth`);
    if (timeFailure) {
      failures.push(timeFailure);
      truth = null;
    }
  }
  if (truth !== null) {
    const stateConsistent = state === 'UNAVAILABLE'
      ? truth.freshness.state === 'UNAVAILABLE' && truth.completeness.state === 'MISSING'
      : state === 'COMPLETE'
        ? truth.completeness.state === 'COMPLETE'
        : truth.completeness.state !== 'COMPLETE';
    if (!stateConsistent) {
      failures.push(failure('INVALID_VALUE', `${expectedSource} source state conflicts with its truth metadata`, `${expectedSource}.truth`));
      truth = null;
    }
  }
  if (!Array.isArray(value.records)) {
    failures.push(failure('INVALID_VALUE', `${expectedSource} records must be an array`, `${expectedSource}.records`));
    return { state: 'UNAVAILABLE', truth, records: [], failures };
  }
  if (state === 'UNAVAILABLE' && value.records.length > 0) {
    failures.push(failure('INVALID_VALUE', `${expectedSource} unavailable slice cannot contain records`, `${expectedSource}.records`));
    return { state, truth, records: [], failures };
  }
  if (value.records.length > maxRecords) {
    failures.push(failure('BUDGET_EXHAUSTED', `${expectedSource} record count exceeds the configured bound`, `${expectedSource}.records`));
    return {
      state: 'PARTIAL',
      truth: truth === null ? null : degradeSliceTruth(truth, expectedSource, ['BUDGET_EXHAUSTED'], ['records beyond configured bound']),
      records: [],
      failures,
    };
  }
  const records: T[] = [];
  const degradedRows: string[] = [];
  let recordTruthDegraded = false;
  for (let index = 0; index < value.records.length; index += 1) {
    const rowField = stableRowField(expectedSource, value.records[index]);
    const result = validateRecord(value.records[index], rowField);
    failures.push(...result.failures);
    if (result.value !== null) {
      records.push(result.value);
      const recordTruth = (result.value as { truth?: TruthMetadata }).truth;
      if (recordTruth && (recordTruth.freshness.state !== 'FRESH' || recordTruth.completeness.state !== 'COMPLETE')) recordTruthDegraded = true;
    } else degradedRows.push(rowField);
  }
  const sliceTruthDegraded = truth === null || truth.freshness.state !== 'FRESH' || truth.completeness.state !== 'COMPLETE';
  const recordValidationDegraded = degradedRows.length > 0 || failures.length > 0 || recordTruthDegraded;
  const effectiveState: UniverseSourceState = state === 'UNAVAILABLE'
    ? 'UNAVAILABLE'
    : sliceTruthDegraded || recordValidationDegraded
      ? records.length === 0 && truth === null ? 'UNAVAILABLE' : 'PARTIAL'
      : state;
  const effectiveTruth = effectiveState === 'PARTIAL' && truth !== null
    ? degradeSliceTruth(
      truth,
      expectedSource,
      [
        ...(degradedRows.length > 0 ? ['INVALID_SOURCE_ROWS_DROPPED'] : []),
        ...(recordTruthDegraded ? ['RECORD_TRUTH_NOT_CURRENT'] : []),
        ...(truth.freshness.state !== 'FRESH' ? ['SOURCE_TRUTH_NOT_FRESH'] : []),
      ],
      degradedRows.length > 0 ? ['invalid source records'] : recordTruthDegraded ? ['current record truth'] : ['current source truth'],
    )
    : truth;
  return { state: effectiveState, truth: effectiveTruth, records, failures };
}

function normalizeAliases(values: unknown, maxAliases: number, field: string): { aliases: string[]; failure: StableFailure | null } {
  if (!Array.isArray(values) || values.some((value) => !nonEmpty(value))) {
    return { aliases: [], failure: failure('INVALID_VALUE', 'aliases must be non-empty strings', field) };
  }
  if (values.length > maxAliases) {
    return { aliases: [], failure: failure('BUDGET_EXHAUSTED', 'alias count exceeds the configured bound', field) };
  }
  const aliases = sortedUnique((values as string[]).map(canonicalToken));
  if (aliases.length > maxAliases) {
    return { aliases: [], failure: failure('BUDGET_EXHAUSTED', 'alias count exceeds the configured bound', field) };
  }
  return { aliases, failure: null };
}

function normalizeRules(value: unknown, field: string): { rules: TradingRuleEvidence | null; failure: StableFailure | null } {
  if (!isObject(value)) return { rules: null, failure: failure('INVALID_VALUE', 'trading rules must be an object', field) };
  const names: Array<keyof TradingRuleEvidence> = [
    'minimumPrice', 'maximumPrice', 'tickSize', 'minimumQuantity',
    'maximumQuantity', 'quantityStep', 'minimumNotional', 'maximumNotional',
  ];
  if (names.some((name) => !nullableNonNegative(value[name]))) {
    return { rules: null, failure: failure('INVALID_VALUE', 'trading rule values must be null or non-negative finite numbers', field) };
  }
  const rules = Object.fromEntries(names.map((name) => [name, value[name] as number | null])) as unknown as TradingRuleEvidence;
  const orderedPairs: Array<[keyof TradingRuleEvidence, keyof TradingRuleEvidence]> = [
    ['minimumPrice', 'maximumPrice'],
    ['minimumQuantity', 'maximumQuantity'],
    ['minimumNotional', 'maximumNotional'],
  ];
  for (const [minimum, maximum] of orderedPairs) {
    if (rules[minimum] !== null && rules[maximum] !== null && (rules[minimum] as number) > (rules[maximum] as number)) {
      return { rules: null, failure: failure('INVALID_VALUE', `${String(minimum)} exceeds ${String(maximum)}`, field) };
    }
  }
  return { rules, failure: null };
}

function quoteVolumeIsUsable(value: QuoteVolumeObservation | null): value is QuoteVolumeObservation {
  return value !== null &&
    value.quoteVolume24hUsd !== null &&
    value.usdConversionRate !== null &&
    value.truth.freshness.state === 'FRESH' &&
    value.truth.completeness.state === 'COMPLETE' &&
    value.conversionTruth !== null &&
    value.conversionTruth.freshness.state === 'FRESH' &&
    value.conversionTruth.completeness.state === 'COMPLETE';
}

function validateQuoteVolume(
  value: unknown,
  instrument: InstrumentIdentity,
  observedAtMs: number,
  field: string,
): { value: QuoteVolumeObservation | null; failures: StableFailure[] } {
  if (value === undefined || value === null) return { value: null, failures: [] };
  const failures: StableFailure[] = [];
  if (
    !isObject(value) || !nonEmpty(value.id) || !nonEmpty(value.quoteAsset) ||
    !isFiniteNumber(value.quoteVolume24h) || value.quoteVolume24h < 0 ||
    !nullableNonNegative(value.usdConversionRate) || !nullableNonNegative(value.quoteVolume24hUsd)
  ) {
    return { value: null, failures: [failure('INVALID_VALUE', 'invalid independent quote-volume evidence', field)] };
  }
  if (instrument.quoteAsset === null || canonicalToken(value.quoteAsset) !== canonicalToken(instrument.quoteAsset)) {
    failures.push(failure('INVALID_VALUE', 'quote-volume asset conflicts with listing quote asset', `${field}.quoteAsset`, [value.id]));
  }
  const truthResult = validateTruthMetadata(value.truth);
  if (!truthResult.ok) failures.push(truthResult.failure);
  else {
    const timeFailure = validateAtOrBeforeObservation(truthResult.value, observedAtMs, `${field}.truth`);
    if (timeFailure) failures.push(timeFailure);
  }
  let conversionTruth: TruthMetadata | null = null;
  if (value.usdConversionRate === null) {
    if (value.quoteVolume24hUsd !== null || value.conversionTruth !== null) {
      failures.push(failure('INVALID_VALUE', 'USD value and conversion truth require an explicit conversion rate', `${field}.usdConversionRate`, [value.id]));
    }
  } else {
    const conversionResult = validateTruthMetadata(value.conversionTruth);
    if (!conversionResult.ok) failures.push(failure('INCOMPLETE_EVIDENCE', 'USD conversion requires independent conversion truth', `${field}.conversionTruth`, [value.id]));
    else {
      conversionTruth = conversionResult.value;
      const timeFailure = validateAtOrBeforeObservation(conversionTruth, observedAtMs, `${field}.conversionTruth`);
      if (timeFailure) failures.push(timeFailure);
    }
    if (value.quoteVolume24hUsd === null) {
      failures.push(failure('INCOMPLETE_EVIDENCE', 'USD conversion rate requires a converted quote-volume value', `${field}.quoteVolume24hUsd`, [value.id]));
    } else {
      const expected = value.quoteVolume24h * value.usdConversionRate;
      if (!Number.isFinite(expected) || Math.abs(value.quoteVolume24hUsd - expected) > Math.max(1e-9, expected * 1e-9)) {
        failures.push(failure('INVALID_VALUE', 'quote-volume USD value must equal quote volume times conversion rate', `${field}.quoteVolume24hUsd`, [value.id]));
      }
    }
  }
  if (!truthResult.ok || failures.some((item) => item.code === 'INVALID_VALUE' || item.code === 'TIMESTAMP_SKEW')) {
    return { value: null, failures };
  }
  return {
    value: {
      id: value.id,
      quoteAsset: canonicalToken(value.quoteAsset),
      quoteVolume24h: value.quoteVolume24h,
      usdConversionRate: value.usdConversionRate as number | null,
      quoteVolume24hUsd: value.quoteVolume24hUsd as number | null,
      truth: cloneTruth(truthResult.value),
      conversionTruth: conversionTruth === null ? null : cloneTruth(conversionTruth),
    },
    failures,
  };
}

function validateListing(
  value: unknown,
  expectedKind: ListingObservation['kind'],
  expectedFamily: InstrumentIdentity['productFamily'],
  observedAtMs: number,
  maxAliases: number,
  field: string,
): { value: ListingObservation | null; failures: StableFailure[] } {
  const failures: StableFailure[] = [];
  if (!isObject(value) || !nonEmpty(value.id) || value.kind !== expectedKind || !nonEmpty(value.tradingStatus)) {
    failures.push(failure('INVALID_VALUE', `invalid ${expectedKind} record`, field));
    return { value: null, failures };
  }
  const instrumentResult = validateInstrumentIdentity(value.instrument);
  if (!instrumentResult.ok) failures.push(instrumentResult.failure);
  const truthResult = validateTruthMetadata(value.truth);
  if (!truthResult.ok) failures.push(truthResult.failure);
  const aliasesResult = normalizeAliases(value.aliases, maxAliases, `${field}.aliases`);
  if (aliasesResult.failure) failures.push(aliasesResult.failure);
  const rulesResult = normalizeRules(value.rules, `${field}.rules`);
  if (rulesResult.failure) failures.push(rulesResult.failure);
  if (!(value.tradingAllowed === null || typeof value.tradingAllowed === 'boolean')) {
    failures.push(failure('INVALID_VALUE', 'tradingAllowed must be boolean or null', `${field}.tradingAllowed`));
  }
  if (!nullableNonNegative(value.quoteVolume24hUsd)) {
    failures.push(failure('INVALID_VALUE', 'quoteVolume24hUsd must be null or non-negative', `${field}.quoteVolume24hUsd`));
  }
  if (instrumentResult.ok && instrumentResult.value.productFamily !== expectedFamily) {
    failures.push(failure('INVALID_VARIANT', `${expectedKind} has the wrong product family`, `${field}.instrument.productFamily`, [value.id]));
  }
  if (instrumentResult.ok && expectedFamily === 'USD_M_PERPETUAL' && instrumentResult.value.contractType !== 'PERPETUAL') {
    failures.push(failure('INVALID_VARIANT', 'USD-M perpetual listing requires contractType PERPETUAL', `${field}.instrument.contractType`, [value.id]));
  }
  if (truthResult.ok) {
    const timeFailure = validateAtOrBeforeObservation(truthResult.value, observedAtMs, `${field}.truth`);
    if (timeFailure) failures.push(timeFailure);
  }
  if (failures.length > 0 || !instrumentResult.ok || !truthResult.ok || rulesResult.rules === null) {
    return { value: null, failures };
  }
  const quoteVolumeResult = validateQuoteVolume(value.quoteVolume, instrumentResult.value, observedAtMs, `${field}.quoteVolume`);
  failures.push(...quoteVolumeResult.failures);
  if (quoteVolumeResult.value === null && value.quoteVolume24hUsd !== null) {
    failures.push(failure(
      'INCOMPLETE_EVIDENCE',
      'legacy quoteVolume24hUsd is unavailable without independent ticker and USD-conversion truth',
      `${field}.quoteVolume24hUsd`,
      [value.id],
    ));
  }
  const usableQuoteVolume24hUsd = quoteVolumeIsUsable(quoteVolumeResult.value)
    ? quoteVolumeResult.value.quoteVolume24hUsd
    : null;
  return {
    value: {
      id: value.id,
      kind: expectedKind,
      instrument: cloneInstrument(instrumentResult.value),
      tradingStatus: canonicalToken(value.tradingStatus),
      tradingAllowed: value.tradingAllowed as boolean | null,
      aliases: aliasesResult.aliases,
      rules: { ...rulesResult.rules },
      quoteVolume: quoteVolumeResult.value === null ? null : cloneQuoteVolume(quoteVolumeResult.value),
      quoteVolume24hUsd: usableQuoteVolume24hUsd,
      truth: cloneTruth(truthResult.value),
    },
    failures,
  };
}

function validateMargin(
  value: unknown,
  observedAtMs: number,
  maxAliases: number,
  field: string,
): { value: MarginEligibilityObservation | null; failures: StableFailure[] } {
  const failures: StableFailure[] = [];
  if (!isObject(value) || !nonEmpty(value.id)) {
    failures.push(failure('INVALID_VALUE', 'invalid margin record', field));
    return { value: null, failures };
  }
  const instrumentResult = validateInstrumentIdentity(value.instrument);
  if (!instrumentResult.ok) failures.push(instrumentResult.failure);
  else if (instrumentResult.value.productFamily !== 'MARGIN') {
    failures.push(failure('INVALID_VARIANT', 'margin record has the wrong product family', `${field}.instrument.productFamily`, [value.id]));
  }
  const truthResult = validateTruthMetadata(value.truth);
  if (!truthResult.ok) failures.push(truthResult.failure);
  else {
    const timeFailure = validateAtOrBeforeObservation(truthResult.value, observedAtMs, `${field}.truth`);
    if (timeFailure) failures.push(timeFailure);
  }
  const aliasesResult = normalizeAliases(value.aliases, maxAliases, `${field}.aliases`);
  if (aliasesResult.failure) failures.push(aliasesResult.failure);
  for (const name of ['marginTradingAllowed', 'buyAllowed', 'sellAllowed', 'isolatedMarginAllowed'] as const) {
    if (!(value[name] === null || typeof value[name] === 'boolean')) {
      failures.push(failure('INVALID_VALUE', `${name} must be boolean or null`, `${field}.${name}`));
    }
  }
  if (failures.length > 0 || !instrumentResult.ok || !truthResult.ok) return { value: null, failures };
  return {
    value: {
      id: value.id,
      instrument: cloneInstrument(instrumentResult.value),
      marginTradingAllowed: value.marginTradingAllowed as boolean | null,
      buyAllowed: value.buyAllowed as boolean | null,
      sellAllowed: value.sellAllowed as boolean | null,
      isolatedMarginAllowed: value.isolatedMarginAllowed as boolean | null,
      aliases: aliasesResult.aliases,
      truth: cloneTruth(truthResult.value),
    },
    failures,
  };
}

function validCoverageMode(value: unknown): value is CoverageModeObservation {
  return isObject(value) &&
    ['AVAILABLE', 'PARTIAL', 'UNAVAILABLE', 'UNKNOWN'].includes(String(value.state)) &&
    Array.isArray(value.evidenceKinds) &&
    value.evidenceKinds.length <= 256 &&
    value.evidenceKinds.every((kind) => typeof kind === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(kind)) &&
    Array.isArray(value.reasonCodes) && value.reasonCodes.length <= 256 && value.reasonCodes.every(nonEmpty);
}

function validateCoverage(
  value: unknown,
  observedAtMs: number,
  field: string,
): { value: CoverageObservation | null; failures: StableFailure[] } {
  const failures: StableFailure[] = [];
  if (!isObject(value) || !nonEmpty(value.id) || !validCoverageMode(value.publicData) || !validCoverageMode(value.focusedData)) {
    failures.push(failure('INVALID_VALUE', 'invalid coverage record', field));
    return { value: null, failures };
  }
  const instrumentResult = validateInstrumentIdentity(value.instrument);
  if (!instrumentResult.ok) failures.push(instrumentResult.failure);
  const truthResult = validateTruthMetadata(value.truth);
  if (!truthResult.ok) failures.push(truthResult.failure);
  else {
    const timeFailure = validateAtOrBeforeObservation(truthResult.value, observedAtMs, `${field}.truth`);
    if (timeFailure) failures.push(timeFailure);
  }
  if (failures.length > 0 || !instrumentResult.ok || !truthResult.ok) return { value: null, failures };
  const mode = (entry: CoverageModeObservation) => ({
    state: entry.state,
    evidenceKinds: sortEvidenceKinds(entry.evidenceKinds),
    reasonCodes: sortedUnique(entry.reasonCodes),
  });
  return {
    value: {
      id: value.id,
      instrument: cloneInstrument(instrumentResult.value),
      publicData: mode(value.publicData),
      focusedData: mode(value.focusedData),
      truth: cloneTruth(truthResult.value),
    },
    failures,
  };
}

function validateBorrow(
  value: unknown,
  observedAtMs: number,
  field: string,
): { value: NormalizedBorrow | null; failures: StableFailure[] } {
  const result = validateNormalizedEvidence(value);
  if (!result.ok) return { value: null, failures: [result.failure] };
  if (result.value.kind !== 'BORROW') {
    return { value: null, failures: [failure('INVALID_VARIANT', 'borrow slice accepts only BORROW evidence', `${field}.kind`, [result.value.id])] };
  }
  if (result.value.instrument.productFamily !== 'BORROW' || result.value.instrument.quoteAsset !== null) {
    return { value: null, failures: [failure('INVALID_VARIANT', 'borrow evidence requires a BORROW identity with null quoteAsset', `${field}.instrument`, [result.value.id])] };
  }
  if (canonicalToken(result.value.asset) !== canonicalToken(result.value.instrument.baseAsset)) {
    return { value: null, failures: [failure('INVALID_VALUE', 'borrow asset conflicts with instrument base asset', `${field}.asset`, [result.value.id])] };
  }
  const timeFailure = validateAtOrBeforeObservation(result.value.truth, observedAtMs, `${field}.truth`);
  return timeFailure ? { value: null, failures: [timeFailure] } : { value: result.value, failures: [] };
}

function effectiveTime(truth: TruthMetadata): number {
  return truth.temporal.sourceEventTimeMs ?? truth.temporal.sourceTransactionTimeMs ?? truth.temporal.receivedTimeMs;
}

function qualityRank(truth: TruthMetadata): number {
  const freshness = { FRESH: 4, UNKNOWN: 3, STALE: 2, UNAVAILABLE: 1 }[truth.freshness.state];
  const completeness = { COMPLETE: 4, PARTIAL: 3, UNKNOWN: 2, MISSING: 1 }[truth.completeness.state];
  return freshness * 10 + completeness;
}

function preferRecord<T extends { id: string; truth: TruthMetadata }>(left: T, right: T): number {
  const time = effectiveTime(right.truth) - effectiveTime(left.truth);
  if (time !== 0) return time;
  const quality = qualityRank(right.truth) - qualityRank(left.truth);
  if (quality !== 0) return quality;
  const id = codePointCompare(left.id, right.id);
  return id !== 0 ? id : codePointCompare(canonicalJson(left), canonicalJson(right));
}

function pairKey(instrument: InstrumentIdentity): string | null {
  if (instrument.quoteAsset === null) return null;
  return `${instrument.venue}|${canonicalToken(instrument.baseAsset)}|${canonicalToken(instrument.quoteAsset)}`;
}

function borrowKey(instrument: InstrumentIdentity): string {
  return `${instrument.venue}|${canonicalToken(instrument.baseAsset)}`;
}

function productKey(instrument: InstrumentIdentity): string | null {
  const pair = pairKey(instrument);
  return pair === null ? null : `${pair}|${instrument.productFamily}`;
}

function truthObservesField(truth: TruthMetadata, ...fieldNames: readonly string[]): boolean {
  if (truth.freshness.state !== 'FRESH') return false;
  if (truth.completeness.state === 'COMPLETE') return true;
  return fieldNames.some((field) => truth.completeness.observedFields.includes(field))
    && !fieldNames.some((field) => truth.completeness.missingFields.includes(field));
}

function marketAvailability(record: ListingObservation, activeStatuses: readonly string[]): MarketAvailability {
  if (!truthObservesField(record.truth, 'tradingStatus', 'status')) return 'UNKNOWN';
  const tradingAllowed = truthObservesField(record.truth, 'tradingAllowed') ? record.tradingAllowed : null;
  if (!activeStatuses.includes(canonicalToken(record.tradingStatus)) || tradingAllowed === false) return 'INACTIVE';
  if (tradingAllowed === true) return 'ACTIVE';
  if (record.instrument.productFamily === 'SPOT') return 'ACTIVE';
  return record.instrument.productFamily === 'USD_M_PERPETUAL' && record.instrument.contractType === 'PERPETUAL'
    ? 'ACTIVE'
    : 'UNKNOWN';
}

function dedupeListings(
  records: ListingObservation[],
  activeStatuses: readonly string[],
  label: string,
  failures: StableFailure[],
): Map<string, ListingView> {
  const groups = new Map<string, ListingObservation[]>();
  for (const record of records) {
    const key = productKey(record.instrument);
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  const out = new Map<string, ListingView>();
  for (const key of [...groups.keys()].sort(codePointCompare)) {
    const group = groups.get(key)!.sort(preferRecord);
    const selected = group[0];
    if (group.length > 1) {
      failures.push(failure('DUPLICATE_EVENT', `duplicate ${label} aliases collapsed into one canonical market`, label, group.map((record) => record.id)));
    }
    const aliases = sortedUnique(group.flatMap((record) => [
      ...record.aliases,
      canonicalToken(record.instrument.symbol),
      ...(record.instrument.pair ? [canonicalToken(record.instrument.pair)] : []),
    ]));
    const trusted = selected.truth.freshness.state === 'FRESH' && selected.truth.completeness.state === 'COMPLETE';
    out.set(key.slice(0, key.lastIndexOf('|')), {
      ...selected,
      instrument: cloneInstrument(selected.instrument),
      aliases,
      rules: trusted
        ? { ...selected.rules }
        : {
          minimumPrice: null, maximumPrice: null, tickSize: null, minimumQuantity: null,
          maximumQuantity: null, quantityStep: null, minimumNotional: null, maximumNotional: null,
        },
      tradingAllowed: truthObservesField(selected.truth, 'tradingAllowed') ? selected.tradingAllowed : null,
      quoteVolume: selected.quoteVolume === null ? null : cloneQuoteVolume(selected.quoteVolume),
      truth: cloneTruth(selected.truth),
      marketAvailability: marketAvailability(selected, activeStatuses),
    });
  }
  return out;
}

function dedupeMargins(records: MarginEligibilityObservation[], failures: StableFailure[]): Map<string, MarginEligibilityView> {
  const groups = new Map<string, MarginEligibilityObservation[]>();
  for (const record of records) {
    const key = pairKey(record.instrument);
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  const out = new Map<string, MarginEligibilityView>();
  for (const key of [...groups.keys()].sort(codePointCompare)) {
    const group = groups.get(key)!.sort(preferRecord);
    const selected = group[0];
    if (group.length > 1) failures.push(failure('DUPLICATE_EVENT', 'duplicate margin aliases collapsed into one canonical market', 'MARGIN', group.map((record) => record.id)));
    const aliases = sortedUnique(group.flatMap((record) => [
      ...record.aliases,
      canonicalToken(record.instrument.symbol),
      ...(record.instrument.pair ? [canonicalToken(record.instrument.pair)] : []),
    ]));
    const trusted = selected.truth.freshness.state === 'FRESH' && selected.truth.completeness.state === 'COMPLETE';
    const explicitFalse = selected.marginTradingAllowed === false || selected.buyAllowed === false || selected.sellAllowed === false;
    const explicitTrue = selected.marginTradingAllowed === true && selected.buyAllowed === true && selected.sellAllowed === true;
    const state = !trusted ? 'UNKNOWN' : explicitFalse ? 'INELIGIBLE' : explicitTrue ? 'ELIGIBLE' : 'UNKNOWN';
    out.set(key, {
      ...selected,
      instrument: cloneInstrument(selected.instrument),
      aliases,
      marginTradingAllowed: trusted ? selected.marginTradingAllowed : null,
      buyAllowed: trusted ? selected.buyAllowed : null,
      sellAllowed: trusted ? selected.sellAllowed : null,
      isolatedMarginAllowed: trusted ? selected.isolatedMarginAllowed : null,
      truth: cloneTruth(selected.truth),
      state,
    });
  }
  return out;
}

function dedupeBorrows(records: NormalizedBorrow[], failures: StableFailure[]): Map<string, BorrowEligibilityView> {
  const groups = new Map<string, NormalizedBorrow[]>();
  for (const record of records) {
    const key = borrowKey(record.instrument);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  const out = new Map<string, BorrowEligibilityView>();
  for (const key of [...groups.keys()].sort(codePointCompare)) {
    const group = groups.get(key)!.sort(preferRecord);
    const selected = group[0];
    if (group.length > 1) failures.push(failure('DUPLICATE_EVENT', 'duplicate borrow observations collapsed into one asset view', 'BORROW', group.map((record) => record.id)));
    const trusted = selected.truth.freshness.state === 'FRESH' && selected.truth.completeness.state === 'COMPLETE';
    out.set(key, {
      id: selected.id,
      instrument: cloneInstrument(selected.instrument),
      asset: selected.asset,
      eligibility: trusted ? selected.eligibility : 'UNKNOWN',
      availability: trusted ? selected.availability : 'UNKNOWN',
      systemAvailableAmount: trusted ? selected.systemAvailableAmount : null,
      accountBorrowLimit: trusted ? selected.accountBorrowLimit : null,
      hourlyInterestRateDecimal: trusted ? selected.hourlyInterestRateDecimal : null,
      inventoryAmount: trusted ? selected.inventoryAmount : null,
      truth: cloneTruth(selected.truth),
    });
  }
  return out;
}

function dedupeCoverage(records: CoverageObservation[], failures: StableFailure[]): CoverageView[] {
  const groups = new Map<string, CoverageObservation[]>();
  for (const record of records) {
    const group = groups.get(record.instrument.instrumentId) ?? [];
    group.push(record);
    groups.set(record.instrument.instrumentId, group);
  }
  const out: CoverageView[] = [];
  for (const key of [...groups.keys()].sort(codePointCompare)) {
    const group = groups.get(key)!.sort(preferRecord);
    const selected = group[0];
    if (group.length > 1) failures.push(failure('DUPLICATE_EVENT', 'duplicate coverage observations collapsed into one instrument view', 'COVERAGE', group.map((record) => record.id)));
    const mode = (field: 'publicData' | 'focusedData', value: CoverageModeObservation) => truthObservesField(selected.truth, field)
      ? {
        state: value.state,
        evidenceKinds: sortEvidenceKinds(value.evidenceKinds),
        reasonCodes: sortedUnique(value.reasonCodes),
      }
      : {
        state: 'UNKNOWN' as const,
        evidenceKinds: [] as EvidenceKind[],
        reasonCodes: sortedUnique([...value.reasonCodes, selected.truth.freshness.state === 'STALE' ? 'COVERAGE_SOURCE_STALE' : 'COVERAGE_SOURCE_INCOMPLETE']),
      };
    out.push({
      ...selected,
      instrument: cloneInstrument(selected.instrument),
      publicData: mode('publicData', selected.publicData),
      focusedData: mode('focusedData', selected.focusedData),
      truth: cloneTruth(selected.truth),
    });
  }
  return out;
}

function coverageSummary(records: readonly CoverageView[], mode: 'publicData' | 'focusedData'): CoverageSummary {
  if (records.length === 0) {
    return { state: 'UNKNOWN', instrumentIds: [], evidenceKinds: [], reasonCodes: ['COVERAGE_NOT_OBSERVED'] };
  }
  const states: Array<CoverageSummary['state']> = records.map((record) => {
    if (!truthObservesField(record.truth, mode)) return 'UNKNOWN';
    return record[mode].state;
  });
  let state: CoverageSummary['state'];
  if (states.every((entry) => entry === 'AVAILABLE')) state = 'AVAILABLE';
  else if (states.every((entry) => entry === 'UNAVAILABLE')) state = 'UNAVAILABLE';
  else if (states.some((entry) => entry === 'STALE')) state = 'STALE';
  else if (states.some((entry) => entry === 'PARTIAL') || new Set(states).size > 1) state = 'PARTIAL';
  else state = 'UNKNOWN';
  return {
    state,
    instrumentIds: sortedUnique(records.map((record) => record.instrument.instrumentId)),
    evidenceKinds: sortEvidenceKinds(records.flatMap((record) => record[mode].evidenceKinds)),
    reasonCodes: sortedUnique(records.flatMap((record) => record[mode].reasonCodes)),
  };
}

function sourceAbsenceReason(source: UniverseSourceKind, state: UniverseSourceState): string {
  return state === 'COMPLETE' ? `${source}_NOT_LISTED` : state === 'PARTIAL' ? `${source}_SOURCE_PARTIAL` : `${source}_SOURCE_UNAVAILABLE`;
}

function requirementForMissing(source: UniverseSourceKind, state: UniverseSourceState): { hard: string | null; unknown: string | null } {
  return state === 'COMPLETE'
    ? { hard: `${source}_REQUIRED_NOT_LISTED`, unknown: null }
    : { hard: null, unknown: `${source}_REQUIRED_TRUTH_${state}` };
}

function evaluateFocusEligibility(args: {
  spot: ListingView | null;
  perpetual: ListingView | null;
  margin: MarginEligibilityView | null;
  borrow: BorrowEligibilityView | null;
  coverage: CoverageView[];
  quoteAsset: string;
  quoteVolume24hUsd: number | null;
  sourceStates: Record<UniverseSourceKind, UniverseSourceState>;
  policy: UniversePolicy;
}): FocusEligibility {
  const { spot, perpetual, margin, borrow, coverage, quoteAsset, quoteVolume24hUsd, sourceStates, policy } = args;
  const hard: string[] = [];
  const unknown: string[] = [];
  const requireListing = (record: ListingView | null, source: UniverseSourceKind, required: boolean): void => {
    if (!required) return;
    if (!record) {
      const missing = requirementForMissing(source, sourceStates[source]);
      if (missing.hard) hard.push(missing.hard);
      if (missing.unknown) unknown.push(missing.unknown);
    } else if (record.marketAvailability === 'INACTIVE') hard.push(`${source}_REQUIRED_INACTIVE`);
    else if (record.marketAvailability === 'UNKNOWN') unknown.push(`${source}_REQUIRED_STATE_UNKNOWN`);
  };
  requireListing(spot, 'SPOT', policy.requireSpotForFocus);
  requireListing(perpetual, 'USD_M_PERPETUAL', policy.requirePerpetualForFocus);

  if (!policy.requireSpotForFocus && !policy.requirePerpetualForFocus) {
    const states = [spot?.marketAvailability, perpetual?.marketAvailability].filter(Boolean) as MarketAvailability[];
    if (states.includes('ACTIVE')) {
      // At least one active market is enough when no product family is mandated.
    } else if (states.includes('UNKNOWN') || sourceStates.SPOT !== 'COMPLETE' || sourceStates.USD_M_PERPETUAL !== 'COMPLETE') {
      unknown.push('ACTIVE_MARKET_UNKNOWN');
    } else hard.push('NO_ACTIVE_MARKET');
  }

  if (policy.requireMarginForFocus) {
    if (!margin) {
      const missing = requirementForMissing('MARGIN', sourceStates.MARGIN);
      if (missing.hard) hard.push(missing.hard);
      if (missing.unknown) unknown.push(missing.unknown);
    } else if (margin.state === 'INELIGIBLE') hard.push('MARGIN_REQUIRED_INELIGIBLE');
    else if (margin.state === 'UNKNOWN') unknown.push('MARGIN_REQUIRED_STATE_UNKNOWN');
  }

  if (policy.requireBorrowEligibilityForFocus || policy.requireBorrowAvailabilityForFocus) {
    if (!borrow) {
      const missing = requirementForMissing('BORROW', sourceStates.BORROW);
      if (missing.hard) hard.push(missing.hard);
      if (missing.unknown) unknown.push(missing.unknown);
    } else {
      if (policy.requireBorrowEligibilityForFocus) {
        if (borrow.eligibility === 'INELIGIBLE') hard.push('BORROW_REQUIRED_INELIGIBLE');
        else if (borrow.eligibility === 'UNKNOWN') unknown.push('BORROW_REQUIRED_ELIGIBILITY_UNKNOWN');
      }
      if (policy.requireBorrowAvailabilityForFocus) {
        if (borrow.availability === 'UNAVAILABLE') hard.push('BORROW_REQUIRED_UNAVAILABLE');
        else if (borrow.availability === 'UNKNOWN') unknown.push('BORROW_REQUIRED_AVAILABILITY_UNKNOWN');
      }
      if (borrow.truth.freshness.state !== 'FRESH') unknown.push('BORROW_REQUIRED_SOURCE_NOT_FRESH');
    }
  }

  if (policy.allowedQuoteAssetsForFocus !== null && !policy.allowedQuoteAssetsForFocus.includes(canonicalToken(quoteAsset))) {
    hard.push('QUOTE_ASSET_NOT_ALLOWED_FOR_FOCUS');
  }
  if (policy.minimumQuoteVolume24hUsdForFocus !== null) {
    if (quoteVolume24hUsd === null) unknown.push('QUOTE_VOLUME_REQUIRED_UNKNOWN');
    else if (quoteVolume24hUsd < policy.minimumQuoteVolume24hUsdForFocus) hard.push('QUOTE_VOLUME_BELOW_FOCUS_MINIMUM');
  }

  const requiredInstrumentIds = sortedUnique([
    ...(policy.requireSpotForFocus && spot ? [spot.instrument.instrumentId] : []),
    ...(policy.requirePerpetualForFocus && perpetual ? [perpetual.instrument.instrumentId] : []),
  ]);
  const relevantCoverage = requiredInstrumentIds.length === 0
    ? coverage.filter((record) => [spot?.instrument.instrumentId, perpetual?.instrument.instrumentId].includes(record.instrument.instrumentId))
    : coverage.filter((record) => requiredInstrumentIds.includes(record.instrument.instrumentId));
  const requireCoverage = (mode: 'publicData' | 'focusedData', required: boolean, code: string): void => {
    if (!required) return;
    if (relevantCoverage.length === 0) {
      if (sourceStates.COVERAGE === 'COMPLETE') hard.push(`${code}_NOT_AVAILABLE`);
      else unknown.push(`${code}_TRUTH_${sourceStates.COVERAGE}`);
      return;
    }
    const summary = coverageSummary(relevantCoverage, mode);
    if (summary.state === 'UNKNOWN' || summary.state === 'STALE') unknown.push(`${code}_${summary.state}`);
    else if (summary.state !== 'AVAILABLE') hard.push(`${code}_${summary.state}`);
  };
  requireCoverage('publicData', policy.requirePublicDataForFocus, 'PUBLIC_DATA_REQUIRED');
  requireCoverage('focusedData', policy.requireFocusedDataForFocus, 'FOCUSED_DATA_REQUIRED');

  const hardReasons = sortedUnique(hard);
  const unknownReasons = sortedUnique(unknown);
  return hardReasons.length > 0
    ? { state: 'INELIGIBLE', reasonCodes: sortedUnique([...hardReasons, ...unknownReasons]) }
    : unknownReasons.length > 0
      ? { state: 'UNKNOWN', reasonCodes: unknownReasons }
      : { state: 'ELIGIBLE', reasonCodes: ['FOCUS_REQUIREMENTS_SATISFIED'] };
}

function deriveTruth(
  truths: readonly TruthMetadata[],
  policy: UniversePolicy,
  observedAtMs: number,
  observedFields: string[],
  missingFields: string[],
  reasonCodes: string[],
  additionalRecordIds: string[] = [],
): TruthMetadata {
  const sourceRecordIds = sortedUnique([
    ...additionalRecordIds,
    ...truths.flatMap((truth) => truth.provenance.sourceRecordIds),
  ]);
  const sourceSet = sortedUnique([
    'intelligence-universe',
    ...truths.flatMap((truth) => truth.provenance.sourceSet),
  ]);
  const normalizedMissing = sortedUnique(missingFields);
  const allComplete = normalizedMissing.length === 0 && truths.every((truth) => truth.completeness.state === 'COMPLETE');
  const freshnessSeverity = { FRESH: 0, STALE: 1, UNKNOWN: 2, UNAVAILABLE: 3 } as const;
  const completenessSeverity = { COMPLETE: 0, PARTIAL: 1, UNKNOWN: 2, MISSING: 3 } as const;
  const worstTruth = [...truths].sort((left, right) => {
    const freshness = freshnessSeverity[right.freshness.state] - freshnessSeverity[left.freshness.state];
    if (freshness !== 0) return freshness;
    const completeness = completenessSeverity[right.completeness.state] - completenessSeverity[left.completeness.state];
    if (completeness !== 0) return completeness;
    const age = (right.freshness.ageMs ?? -1) - (left.freshness.ageMs ?? -1);
    if (age !== 0) return age;
    const evaluation = left.freshness.evaluatedAtMs - right.freshness.evaluatedAtMs;
    if (evaluation !== 0) return evaluation;
    const time = effectiveTime(left) - effectiveTime(right);
    if (time !== 0) return time;
    return codePointCompare(canonicalJson(left.authority), canonicalJson(right.authority));
  })[0] ?? null;
  const temporal = worstTruth === null
    ? { sourceEventTimeMs: null, sourceTransactionTimeMs: null, receivedTimeMs: observedAtMs, sequence: null }
    : {
      sourceEventTimeMs: worstTruth.temporal.sourceEventTimeMs,
      sourceTransactionTimeMs: worstTruth.temporal.sourceTransactionTimeMs,
      receivedTimeMs: worstTruth.temporal.receivedTimeMs,
      sequence: worstTruth.temporal.sequence === null ? null : { ...worstTruth.temporal.sequence },
    };
  const freshness = worstTruth === null
    ? { basis: 'UNAVAILABLE' as const, evaluatedAtMs: observedAtMs, ageMs: null, maxAgeMs: null, state: 'UNKNOWN' as const }
    : { ...worstTruth.freshness };
  const allMissing = truths.length === 0 || truths.every((truth) => truth.completeness.state === 'MISSING');
  return {
    schemaVersion: '1',
    producerVersion: PRODUCER_VERSION,
    configurationVersion: policy.configurationVersion,
    featureVersion: null,
    authority: {
      kind: 'ENGINE_DERIVED',
      sourceId: 'intelligence-universe',
      dataset: 'joined-instrument-coverage-graph',
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds,
      sourceSet,
      transforms: ['canonical-market-join-v1', 'visibility-focus-separation-v1', 'worst-upstream-truth-v1'],
    },
    temporal,
    freshness,
    completeness: {
      state: allComplete ? 'COMPLETE' : allMissing ? 'MISSING' : 'PARTIAL',
      observedFields: sortedUnique(observedFields),
      missingFields: normalizedMissing.length > 0 ? normalizedMissing : allMissing ? ['source truth'] : [],
      reasonCodes: sortedUnique(reasonCodes),
    },
  };
}

function focusTruthContent(
  policy: UniversePolicy,
  focusEligibility: FocusEligibility,
  facts: Readonly<{
    spot: Readonly<{ instrumentId: string; marketAvailability: MarketAvailability }> | null;
    perpetual: Readonly<{ instrumentId: string; marketAvailability: MarketAvailability }> | null;
    margin: MarginEligibilityView['state'] | null;
    borrowEligibility: BorrowEligibilityView['eligibility'] | null;
    borrowAvailability: BorrowEligibilityView['availability'] | null;
    publicData: CoverageSummary['state'];
    focusedData: CoverageSummary['state'];
    quoteAsset: string;
    quoteVolume24hUsd: number | null;
  }>,
  sourceRecordIds: readonly string[],
) {
  return {
    scope: 'ATTENTION_FOCUS' as const,
    configurationVersion: policy.configurationVersion,
    requirements: {
      requireSpot: policy.requireSpotForFocus,
      requirePerpetual: policy.requirePerpetualForFocus,
      requireMargin: policy.requireMarginForFocus,
      requireBorrowEligibility: policy.requireBorrowEligibilityForFocus,
      requireBorrowAvailability: policy.requireBorrowAvailabilityForFocus,
      requirePublicData: policy.requirePublicDataForFocus,
      requireFocusedData: policy.requireFocusedDataForFocus,
      allowedQuoteAssets: policy.allowedQuoteAssetsForFocus,
      minimumQuoteVolume24hUsd: policy.minimumQuoteVolume24hUsdForFocus,
    },
    result: focusEligibility,
    facts,
    sourceRecordIds: sortedUnique(sourceRecordIds),
  };
}

function buildFocusTruthReceipt(input: Readonly<{
  observedAtMs: number;
  policy: UniversePolicy;
  focusEligibility: FocusEligibility;
  spot: ListingView | null;
  perpetual: ListingView | null;
  margin: MarginEligibilityView | null;
  borrow: BorrowEligibilityView | null;
  coverage: readonly CoverageView[];
  quoteAsset: string;
  quoteVolume24hUsd: number | null;
  quoteVolume: QuoteVolumeObservation | null;
  sourceTruths: Readonly<Record<UniverseSourceKind, TruthMetadata | null>>;
}>): FocusTruthReceipt {
  const requiredInstrumentIds = sortedUnique([
    ...(input.policy.requireSpotForFocus && input.spot ? [input.spot.instrument.instrumentId] : []),
    ...(input.policy.requirePerpetualForFocus && input.perpetual ? [input.perpetual.instrument.instrumentId] : []),
  ]);
  const relevantCoverage = requiredInstrumentIds.length === 0
    ? input.coverage.filter((record) => [
      input.spot?.instrument.instrumentId,
      input.perpetual?.instrument.instrumentId,
    ].includes(record.instrument.instrumentId))
    : input.coverage.filter((record) => requiredInstrumentIds.includes(record.instrument.instrumentId));
  const requiredTruths: Array<TruthMetadata | null> = [];
  if (input.policy.requireSpotForFocus) requiredTruths.push(input.spot?.truth ?? input.sourceTruths.SPOT);
  if (input.policy.requirePerpetualForFocus) {
    requiredTruths.push(input.perpetual?.truth ?? input.sourceTruths.USD_M_PERPETUAL);
  }
  if (!input.policy.requireSpotForFocus && !input.policy.requirePerpetualForFocus) {
    requiredTruths.push(
      input.spot?.truth ?? input.sourceTruths.SPOT,
      input.perpetual?.truth ?? input.sourceTruths.USD_M_PERPETUAL,
    );
  }
  if (input.policy.requireMarginForFocus) requiredTruths.push(input.margin?.truth ?? input.sourceTruths.MARGIN);
  if (input.policy.requireBorrowEligibilityForFocus || input.policy.requireBorrowAvailabilityForFocus) {
    requiredTruths.push(input.borrow?.truth ?? input.sourceTruths.BORROW);
  }
  if (input.policy.requirePublicDataForFocus || input.policy.requireFocusedDataForFocus) {
    if (relevantCoverage.length > 0) requiredTruths.push(...relevantCoverage.map((record) => record.truth));
    else requiredTruths.push(input.sourceTruths.COVERAGE);
  }
  if (input.policy.minimumQuoteVolume24hUsdForFocus !== null) {
    requiredTruths.push(input.quoteVolume?.truth ?? null, input.quoteVolume?.conversionTruth ?? null);
  }
  const truths = requiredTruths.filter((truth): truth is TruthMetadata => truth !== null);
  const content = focusTruthContent(
    input.policy,
    input.focusEligibility,
    {
      spot: input.spot === null ? null : {
        instrumentId: input.spot.instrument.instrumentId,
        marketAvailability: input.spot.marketAvailability,
      },
      perpetual: input.perpetual === null ? null : {
        instrumentId: input.perpetual.instrument.instrumentId,
        marketAvailability: input.perpetual.marketAvailability,
      },
      margin: input.margin?.state ?? null,
      borrowEligibility: input.borrow?.eligibility ?? null,
      borrowAvailability: input.borrow?.availability ?? null,
      publicData: coverageSummary(relevantCoverage, 'publicData').state,
      focusedData: coverageSummary(relevantCoverage, 'focusedData').state,
      quoteAsset: input.quoteAsset,
      quoteVolume24hUsd: input.quoteVolume24hUsd,
    },
    truths.flatMap((truth) => truth.provenance.sourceRecordIds),
  );
  const contentDigest = stableId('universe-focus-truth-content', content);
  const id = stableId('universe-focus-truth-receipt', {
    scope: content.scope,
    configurationVersion: input.policy.configurationVersion,
    contentDigest,
  });
  const known = input.focusEligibility.state !== 'UNKNOWN';
  const base = deriveTruth(
    truths,
    input.policy,
    input.observedAtMs,
    ['scope', 'configurationVersion', 'contentDigest', 'focusEligibility', 'requiredFacts'],
    known ? [] : ['current focus requirement truth'],
    known ? [] : input.focusEligibility.reasonCodes,
    [id],
  );
  const truth: TruthMetadata = {
    ...base,
    producerVersion: PRODUCER_VERSION,
    configurationVersion: input.policy.configurationVersion,
    authority: {
      kind: 'ENGINE_DERIVED',
      sourceId: 'intelligence-universe',
      dataset: 'attention-focus-truth-receipt',
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: sortedUnique([id, ...base.provenance.sourceRecordIds]),
      sourceSet: [...base.provenance.sourceSet],
      transforms: sortedUnique([...base.provenance.transforms, 'attention-focus-truth-receipt-v1']),
    },
    completeness: {
      state: known ? 'COMPLETE' : truths.length === 0 ? 'MISSING' : 'PARTIAL',
      observedFields: ['configurationVersion', 'contentDigest', 'focusEligibility', 'requiredFacts', 'scope'],
      missingFields: known ? [] : ['current focus requirement truth'],
      reasonCodes: known ? [] : sortedUnique(input.focusEligibility.reasonCodes),
    },
  };
  return {
    id,
    scope: 'ATTENTION_FOCUS',
    configurationVersion: input.policy.configurationVersion,
    contentDigest,
    truth,
  };
}

/** Recomputes the canonical digest so downstream owners cannot trust a mutated graph envelope. */
export function validateFocusTruthReceipt(node: UniverseMarketNode, policy: UniversePolicy): boolean {
  const receipt = node.focusTruth;
  if (!receipt || receipt.scope !== 'ATTENTION_FOCUS'
      || receipt.configurationVersion !== policy.configurationVersion) return false;
  const requiredInstrumentIds = sortedUnique([
    ...(policy.requireSpotForFocus && node.spot ? [node.spot.instrument.instrumentId] : []),
    ...(policy.requirePerpetualForFocus && node.usdMPerpetual ? [node.usdMPerpetual.instrument.instrumentId] : []),
  ]);
  const relevantCoverage = requiredInstrumentIds.length === 0
    ? node.coverage.filter((record) => [
      node.spot?.instrument.instrumentId,
      node.usdMPerpetual?.instrument.instrumentId,
    ].includes(record.instrument.instrumentId))
    : node.coverage.filter((record) => requiredInstrumentIds.includes(record.instrument.instrumentId));
  const requiredTruths: TruthMetadata[] = [];
  if (policy.requireSpotForFocus && node.spot) requiredTruths.push(node.spot.truth);
  if (policy.requirePerpetualForFocus && node.usdMPerpetual) requiredTruths.push(node.usdMPerpetual.truth);
  if (!policy.requireSpotForFocus && !policy.requirePerpetualForFocus) {
    if (node.spot) requiredTruths.push(node.spot.truth);
    if (node.usdMPerpetual) requiredTruths.push(node.usdMPerpetual.truth);
  }
  if (policy.requireMarginForFocus && node.margin) requiredTruths.push(node.margin.truth);
  if ((policy.requireBorrowEligibilityForFocus || policy.requireBorrowAvailabilityForFocus) && node.borrow) {
    requiredTruths.push(node.borrow.truth);
  }
  if (policy.requirePublicDataForFocus || policy.requireFocusedDataForFocus) {
    requiredTruths.push(...relevantCoverage.map((record) => record.truth));
  }
  if (policy.minimumQuoteVolume24hUsdForFocus !== null && node.quoteVolume) {
    requiredTruths.push(node.quoteVolume.truth);
    if (node.quoteVolume.conversionTruth) requiredTruths.push(node.quoteVolume.conversionTruth);
  }
  const expectedRecordIds = sortedUnique(requiredTruths.flatMap((truth) => truth.provenance.sourceRecordIds));
  const receiptRecordIds = sortedUnique(receipt.truth.provenance.sourceRecordIds.filter((id) => id !== receipt.id));
  if (node.focusEligibility.state === 'ELIGIBLE'
      ? canonicalJson(expectedRecordIds) !== canonicalJson(receiptRecordIds)
      : expectedRecordIds.some((id) => !receiptRecordIds.includes(id))) return false;
  const content = focusTruthContent(
    policy,
    node.focusEligibility,
    {
      spot: node.spot === null ? null : {
        instrumentId: node.spot.instrument.instrumentId,
        marketAvailability: node.spot.marketAvailability,
      },
      perpetual: node.usdMPerpetual === null ? null : {
        instrumentId: node.usdMPerpetual.instrument.instrumentId,
        marketAvailability: node.usdMPerpetual.marketAvailability,
      },
      margin: node.margin?.state ?? null,
      borrowEligibility: node.borrow?.eligibility ?? null,
      borrowAvailability: node.borrow?.availability ?? null,
      publicData: coverageSummary(relevantCoverage, 'publicData').state,
      focusedData: coverageSummary(relevantCoverage, 'focusedData').state,
      quoteAsset: node.quoteAsset,
      quoteVolume24hUsd: node.quoteVolume24hUsd,
    },
    receiptRecordIds,
  );
  const contentDigest = stableId('universe-focus-truth-content', content);
  return receipt.contentDigest === contentDigest
    && receipt.id === stableId('universe-focus-truth-receipt', {
      scope: receipt.scope,
      configurationVersion: receipt.configurationVersion,
      contentDigest,
    });
}

/** Semantic state fingerprint. Deliberately excludes observation/evaluation wall-clock fields. */
function nodeStateFingerprint(node: UniverseMarketNode): string {
  const listing = (record: ListingView | null) => record === null ? null : {
    instrumentId: record.instrument.instrumentId,
    symbol: record.instrument.symbol,
    pair: record.instrument.pair,
    tradingStatus: record.tradingStatus,
    tradingAllowed: record.tradingAllowed,
    marketAvailability: record.marketAvailability,
    aliases: record.aliases,
    rules: record.rules,
    quoteVolume24hUsd: record.quoteVolume24hUsd,
    quoteVolume: record.quoteVolume === null ? null : {
      id: record.quoteVolume.id,
      quoteAsset: record.quoteVolume.quoteAsset,
      quoteVolume24h: record.quoteVolume.quoteVolume24h,
      usdConversionRate: record.quoteVolume.usdConversionRate,
      quoteVolume24hUsd: record.quoteVolume.quoteVolume24hUsd,
      freshness: record.quoteVolume.truth.freshness.state,
      completeness: record.quoteVolume.truth.completeness.state,
      conversionFreshness: record.quoteVolume.conversionTruth?.freshness.state ?? 'UNAVAILABLE',
      conversionCompleteness: record.quoteVolume.conversionTruth?.completeness.state ?? 'MISSING',
    },
    freshness: record.truth.freshness.state,
    completeness: record.truth.completeness.state,
  };
  return stableId('universe-node-state', {
    id: node.id,
    aliases: node.aliases,
    spot: listing(node.spot),
    usdMPerpetual: listing(node.usdMPerpetual),
    margin: node.margin === null ? null : {
      instrumentId: node.margin.instrument.instrumentId,
      marginTradingAllowed: node.margin.marginTradingAllowed,
      buyAllowed: node.margin.buyAllowed,
      sellAllowed: node.margin.sellAllowed,
      isolatedMarginAllowed: node.margin.isolatedMarginAllowed,
      state: node.margin.state,
      freshness: node.margin.truth.freshness.state,
      completeness: node.margin.truth.completeness.state,
    },
    borrow: node.borrow === null ? null : {
      instrumentId: node.borrow.instrument.instrumentId,
      eligibility: node.borrow.eligibility,
      availability: node.borrow.availability,
      systemAvailableAmount: node.borrow.systemAvailableAmount,
      accountBorrowLimit: node.borrow.accountBorrowLimit,
      hourlyInterestRateDecimal: node.borrow.hourlyInterestRateDecimal,
      inventoryAmount: node.borrow.inventoryAmount,
      freshness: node.borrow.truth.freshness.state,
      completeness: node.borrow.truth.completeness.state,
    },
    coverage: node.coverage.map((record) => ({
      instrumentId: record.instrument.instrumentId,
      publicData: record.publicData,
      focusedData: record.focusedData,
      freshness: record.truth.freshness.state,
      completeness: record.truth.completeness.state,
    })),
    publicData: node.publicData,
    focusedData: node.focusedData,
    quoteVolume24hUsd: node.quoteVolume24hUsd,
    quoteVolumeId: node.quoteVolume?.id ?? null,
    activity: node.activity,
    focusEligibility: node.focusEligibility,
    focusTruth: {
      id: node.focusTruth.id,
      scope: node.focusTruth.scope,
      configurationVersion: node.focusTruth.configurationVersion,
      contentDigest: node.focusTruth.contentDigest,
      freshness: node.focusTruth.truth.freshness.state,
      completeness: node.focusTruth.truth.completeness.state,
    },
    reasonCodes: node.reasonCodes,
  });
}

function emptySourceStates(): Record<UniverseSourceKind, UniverseSourceState> {
  return { SPOT: 'UNAVAILABLE', USD_M_PERPETUAL: 'UNAVAILABLE', MARGIN: 'UNAVAILABLE', BORROW: 'UNAVAILABLE', COVERAGE: 'UNAVAILABLE' };
}

function buildEmptyGraph(observedAtMs: number, policy: UniversePolicy, failures: StableFailure[]): UniverseGraph {
  const sourceStates = emptySourceStates();
  const truth = deriveTruth([], policy, observedAtMs, [], ['all source slices'], failures.map((item) => item.code));
  return {
    id: stableId('universe-graph', { policy, nodeIds: [], failureIds: failures.map((item) => item.id).sort(codePointCompare) }),
    observedAtMs,
    configurationVersion: policy.configurationVersion,
    policy: clonePolicy(policy),
    sourceStates,
    nodes: [],
    aliases: [],
    failures: [...failures].sort((left, right) => codePointCompare(left.id, right.id)),
    truth,
  };
}

export function buildUniverseGraph(input: UniverseSnapshotInput, policyInput: Partial<UniversePolicy> = {}): UniverseGraph {
  const policy = createUniversePolicy(policyInput);
  const observedAtMs = isSafeTime((input as UniverseSnapshotInput | undefined)?.observedAtMs) ? input.observedAtMs : 0;
  const secret = validateNoSecretFields(input, 'intelligence_universe');
  if (!secret.ok) return buildEmptyGraph(observedAtMs, policy, [secret.failure]);
  if (!isObject(input) || !isSafeTime(input.observedAtMs)) {
    return buildEmptyGraph(0, policy, [failure('INVALID_VALUE', 'observedAtMs must be a non-negative safe integer', 'observedAtMs')]);
  }

  const spot = validateSlice(
    input.spot,
    'SPOT',
    observedAtMs,
    policy.maxRecordsPerSource,
    (record, field) => validateListing(record, 'SPOT_LISTING', 'SPOT', observedAtMs, policy.maxAliasesPerInstrument, field),
  );
  const perpetual = validateSlice(
    input.usdMPerpetual,
    'USD_M_PERPETUAL',
    observedAtMs,
    policy.maxRecordsPerSource,
    (record, field) => validateListing(record, 'USD_M_PERPETUAL_LISTING', 'USD_M_PERPETUAL', observedAtMs, policy.maxAliasesPerInstrument, field),
  );
  const margin = validateSlice(
    input.margin,
    'MARGIN',
    observedAtMs,
    policy.maxRecordsPerSource,
    (record, field) => validateMargin(record, observedAtMs, policy.maxAliasesPerInstrument, field),
  );
  const borrow = validateSlice(
    input.borrow,
    'BORROW',
    observedAtMs,
    policy.maxRecordsPerSource,
    (record, field) => validateBorrow(record, observedAtMs, field),
  );
  const coverage = validateSlice(
    input.coverage,
    'COVERAGE',
    observedAtMs,
    policy.maxRecordsPerSource,
    (record, field) => validateCoverage(record, observedAtMs, field),
  );
  const failures = [...spot.failures, ...perpetual.failures, ...margin.failures, ...borrow.failures, ...coverage.failures];
  const sourceStates: Record<UniverseSourceKind, UniverseSourceState> = {
    SPOT: spot.state,
    USD_M_PERPETUAL: perpetual.state,
    MARGIN: margin.state,
    BORROW: borrow.state,
    COVERAGE: coverage.state,
  };

  const spotByPair = dedupeListings(spot.records, policy.activeSpotStatuses, 'SPOT', failures);
  const perpetualByPair = dedupeListings(perpetual.records, policy.activePerpetualStatuses, 'USD_M_PERPETUAL', failures);
  const marginByPair = dedupeMargins(margin.records, failures);
  const borrowByAsset = dedupeBorrows(borrow.records, failures);
  const coverageRows = dedupeCoverage(coverage.records, failures);
  const coverageByPair = new Map<string, CoverageView[]>();
  const borrowCoverageByAsset = new Map<string, CoverageView[]>();
  for (const record of coverageRows) {
    const key = pairKey(record.instrument);
    if (key !== null) {
      const rows = coverageByPair.get(key) ?? [];
      rows.push(record);
      coverageByPair.set(key, rows);
    } else if (record.instrument.productFamily === 'BORROW') {
      const assetKey = borrowKey(record.instrument);
      const rows = borrowCoverageByAsset.get(assetKey) ?? [];
      rows.push(record);
      borrowCoverageByAsset.set(assetKey, rows);
    }
  }

  const pairKeys = sortedUnique([
    ...spotByPair.keys(),
    ...perpetualByPair.keys(),
    ...marginByPair.keys(),
    ...coverageByPair.keys(),
  ]);
  const nodes: UniverseMarketNode[] = [];
  for (const key of pairKeys) {
    const [venue, baseAsset, quoteAsset] = key.split('|') as [InstrumentIdentity['venue'], string, string];
    const spotView = spotByPair.get(key) ?? null;
    const perpetualView = perpetualByPair.get(key) ?? null;
    const marginView = marginByPair.get(key) ?? null;
    const borrowView = borrowByAsset.get(`${venue}|${baseAsset}`) ?? null;
    const nodeCoverage = [
      ...(coverageByPair.get(key) ?? []),
      ...(borrowCoverageByAsset.get(`${venue}|${baseAsset}`) ?? []),
    ].sort((left, right) => codePointCompare(left.instrument.instrumentId, right.instrument.instrumentId));
    const quoteVolumeCandidates = [spotView, perpetualView]
      .filter((record): record is ListingView => record !== null && record.quoteVolume !== null && record.quoteVolume24hUsd !== null)
      .sort((left, right) => {
        const volume = (right.quoteVolume24hUsd as number) - (left.quoteVolume24hUsd as number);
        return volume !== 0 ? volume : codePointCompare((left.quoteVolume as QuoteVolumeObservation).id, (right.quoteVolume as QuoteVolumeObservation).id);
      });
    const selectedQuoteVolume = quoteVolumeCandidates[0]?.quoteVolume ?? null;
    const quoteVolume = selectedQuoteVolume === null ? null : cloneQuoteVolume(selectedQuoteVolume);
    const quoteVolume24hUsd = quoteVolumeCandidates[0]?.quoteVolume24hUsd ?? null;
    const activity: UniverseMarketNode['activity'] = quoteVolume24hUsd === null
      ? 'UNKNOWN'
      : quoteVolume24hUsd === 0
        ? 'DORMANT'
        : policy.minimumQuoteVolume24hUsdForFocus !== null && quoteVolume24hUsd < policy.minimumQuoteVolume24hUsdForFocus
          ? 'LOW_VOLUME'
          : 'ACTIVE';
    const aliases = sortedUnique([
      ...(spotView?.aliases ?? []),
      ...(perpetualView?.aliases ?? []),
      ...(marginView?.aliases ?? []),
      ...nodeCoverage.flatMap((record) => [
        canonicalToken(record.instrument.symbol),
        ...(record.instrument.pair ? [canonicalToken(record.instrument.pair)] : []),
      ]),
    ]);
    const publicData = coverageSummary(nodeCoverage, 'publicData');
    const focusedData = coverageSummary(nodeCoverage, 'focusedData');
    const reasonCodes: string[] = [];
    if (!spotView) reasonCodes.push(sourceAbsenceReason('SPOT', sourceStates.SPOT));
    if (!perpetualView) reasonCodes.push(sourceAbsenceReason('USD_M_PERPETUAL', sourceStates.USD_M_PERPETUAL));
    if (!marginView) reasonCodes.push(sourceAbsenceReason('MARGIN', sourceStates.MARGIN));
    if (!borrowView) reasonCodes.push(sourceAbsenceReason('BORROW', sourceStates.BORROW));
    if (nodeCoverage.length === 0) reasonCodes.push(sourceAbsenceReason('COVERAGE', sourceStates.COVERAGE));
    const suppliedQuoteVolumes = [spotView?.quoteVolume, perpetualView?.quoteVolume].filter((value): value is QuoteVolumeObservation => value !== null && value !== undefined);
    if (suppliedQuoteVolumes.length === 0) reasonCodes.push('QUOTE_VOLUME_NOT_OBSERVED');
    else if (quoteVolume24hUsd === null) reasonCodes.push('QUOTE_VOLUME_TRUTH_NOT_CURRENT_OR_CONVERTED');
    if (spotView?.marketAvailability === 'INACTIVE') reasonCodes.push('SPOT_INACTIVE_RETAINED');
    if (perpetualView?.marketAvailability === 'INACTIVE') reasonCodes.push('USD_M_PERPETUAL_INACTIVE_RETAINED');
    if (activity === 'DORMANT') reasonCodes.push('DORMANT_SYMBOL_RETAINED');
    if (activity === 'LOW_VOLUME') reasonCodes.push('LOW_VOLUME_SYMBOL_RETAINED');
    const focusEligibility = evaluateFocusEligibility({
      spot: spotView,
      perpetual: perpetualView,
      margin: marginView,
      borrow: borrowView,
      coverage: nodeCoverage,
      quoteAsset,
      quoteVolume24hUsd,
      sourceStates,
      policy,
    });
    const focusTruth = buildFocusTruthReceipt({
      observedAtMs,
      policy,
      focusEligibility,
      spot: spotView,
      perpetual: perpetualView,
      margin: marginView,
      borrow: borrowView,
      coverage: nodeCoverage,
      quoteAsset,
      quoteVolume24hUsd,
      quoteVolume,
      sourceTruths: {
        SPOT: spot.truth,
        USD_M_PERPETUAL: perpetual.truth,
        MARGIN: margin.truth,
        BORROW: borrow.truth,
        COVERAGE: coverage.truth,
      },
    });
    reasonCodes.push(...focusEligibility.reasonCodes);
    const componentTruths = [
      spotView?.truth,
      perpetualView?.truth,
      marginView?.truth,
      borrowView?.truth,
      ...nodeCoverage.map((record) => record.truth),
      ...suppliedQuoteVolumes.flatMap((record) => [record.truth, ...(record.conversionTruth ? [record.conversionTruth] : [])]),
    ].filter((value): value is TruthMetadata => value !== undefined && value !== null);
    const observedFields = [
      ...(spotView ? ['spot'] : []),
      ...(perpetualView ? ['usdMPerpetual'] : []),
      ...(marginView ? ['margin'] : []),
      ...(borrowView ? ['borrow'] : []),
      ...(nodeCoverage.length > 0 ? ['coverage'] : []),
      ...(quoteVolume24hUsd !== null ? ['quoteVolume24hUsd'] : []),
    ];
    const missingFields = [
      ...(!spotView ? ['spot'] : []),
      ...(!perpetualView ? ['usdMPerpetual'] : []),
      ...(!marginView ? ['margin'] : []),
      ...(!borrowView ? ['borrow'] : []),
      ...(nodeCoverage.length === 0 ? ['coverage'] : []),
      ...(quoteVolume24hUsd === null ? ['quoteVolume24hUsd'] : []),
    ];
    const id = stableId('universe-market', { venue, baseAsset, quoteAsset });
    const visibilityReasons = sortedUnique([
      spotView ? 'SPOT_VISIBLE' : '',
      perpetualView ? 'USD_M_PERPETUAL_VISIBLE' : '',
      marginView ? 'MARGIN_PAIR_VISIBLE' : '',
      nodeCoverage.length > 0 ? 'COVERAGE_VISIBLE' : '',
      activity === 'DORMANT' ? 'DORMANT_SYMBOL_RETAINED' : '',
      activity === 'LOW_VOLUME' ? 'LOW_VOLUME_SYMBOL_RETAINED' : '',
    ].filter(Boolean));
    nodes.push({
      id,
      canonicalMarket: `${venue}:${baseAsset}/${quoteAsset}`,
      venue,
      baseAsset,
      quoteAsset,
      aliases,
      spot: spotView,
      usdMPerpetual: perpetualView,
      margin: marginView,
      borrow: borrowView,
      coverage: nodeCoverage,
      publicData,
      focusedData,
      quoteVolume24hUsd,
      quoteVolume,
      activity,
      visibility: { state: 'VISIBLE', reasonCodes: visibilityReasons },
      focusEligibility,
      focusTruth,
      reasonCodes: sortedUnique(reasonCodes),
      truth: deriveTruth(componentTruths, policy, observedAtMs, observedFields, missingFields, reasonCodes, [
        ...(spotView ? [spotView.id] : []),
        ...(perpetualView ? [perpetualView.id] : []),
        ...(marginView ? [marginView.id] : []),
        ...(borrowView ? [borrowView.id] : []),
        ...nodeCoverage.map((record) => record.id),
      ]),
    });
  }
  nodes.sort((left, right) => codePointCompare(left.id, right.id));

  const aliasOwners = new Map<string, Map<string, { families: Set<string>; recordIds: Set<string> }>>();
  for (const node of nodes) {
    for (const alias of node.aliases) {
      const owners = aliasOwners.get(alias) ?? new Map();
      const detail = owners.get(node.id) ?? { families: new Set<string>(), recordIds: new Set<string>() };
      for (const record of [node.spot, node.usdMPerpetual, node.margin]) {
        if (record?.aliases.includes(alias)) {
          detail.families.add(record.instrument.productFamily);
          detail.recordIds.add(record.id);
        }
      }
      for (const record of node.coverage) {
        const recordAliases = [
          canonicalToken(record.instrument.symbol),
          ...(record.instrument.pair ? [canonicalToken(record.instrument.pair)] : []),
        ];
        if (recordAliases.includes(alias)) {
          detail.families.add(record.instrument.productFamily);
          detail.recordIds.add(record.id);
        }
      }
      owners.set(node.id, detail);
      aliasOwners.set(alias, owners);
    }
  }
  const aliases: UniverseAliasEntry[] = [];
  for (const alias of [...aliasOwners.keys()].sort(codePointCompare)) {
    const owners = aliasOwners.get(alias)!;
    if (owners.size > 1) {
      failures.push(failure('INVALID_VALUE', `alias ${alias} maps to multiple canonical markets`, `aliases.${alias}`, [...owners.keys()]));
      continue;
    }
    const [nodeId, detail] = [...owners.entries()][0];
    const ownerNode = nodes.find((node) => node.id === nodeId)!;
    aliases.push({
      id: stableId('universe-alias', { alias, nodeId }),
      alias,
      nodeId,
      productFamilies: [...detail.families].sort(codePointCompare),
      sourceRecordIds: [...detail.recordIds].sort(codePointCompare),
      truth: deriveTruth([ownerNode.truth], policy, observedAtMs, ['alias', 'nodeId'], [], [], [...detail.recordIds]),
    });
  }

  const allTruths = [
    spot.truth, perpetual.truth, margin.truth, borrow.truth, coverage.truth,
    ...spot.records.map((record) => record.truth),
    ...perpetual.records.map((record) => record.truth),
    ...margin.records.map((record) => record.truth),
    ...borrow.records.map((record) => record.truth),
    ...coverage.records.map((record) => record.truth),
    ...spot.records.flatMap((record) => record.quoteVolume === null ? [] : [record.quoteVolume.truth, ...(record.quoteVolume.conversionTruth ? [record.quoteVolume.conversionTruth] : [])]),
    ...perpetual.records.flatMap((record) => record.quoteVolume === null ? [] : [record.quoteVolume.truth, ...(record.quoteVolume.conversionTruth ? [record.quoteVolume.conversionTruth] : [])]),
  ].filter((value): value is TruthMetadata => value !== null);
  const sourceMissing = UNIVERSE_SOURCE_KINDS.filter((source) => sourceStates[source] !== 'COMPLETE').map((source) => `${source.toLowerCase()} source`);
  const normalizedFailures = [...new Map(failures.map((item) => [item.id, item])).values()]
    .sort((left, right) => codePointCompare(left.id, right.id));
  const graphTruth = deriveTruth(
    allTruths,
    policy,
    observedAtMs,
    ['nodes', 'aliases', ...UNIVERSE_SOURCE_KINDS.filter((source) => sourceStates[source] === 'COMPLETE').map((source) => `${source.toLowerCase()} source`)],
    [...sourceMissing, ...(normalizedFailures.length > 0 ? ['invalid or conflicting source records'] : [])],
    [...sourceMissing.map((source) => `${source.toUpperCase().replaceAll(' ', '_')}_INCOMPLETE`), ...normalizedFailures.map((item) => item.code)],
  );
  const nodeFingerprints = nodes.map(nodeStateFingerprint);
  const graphId = stableId('universe-graph', {
    policy,
    sourceStates,
    nodeFingerprints,
    aliasIds: aliases.map((entry) => entry.id),
    failureIds: normalizedFailures.map((item) => item.id),
  });
  return {
    id: graphId,
    observedAtMs,
    configurationVersion: policy.configurationVersion,
    policy: clonePolicy(policy),
    sourceStates,
    nodes,
    aliases,
    failures: normalizedFailures,
    truth: graphTruth,
  };
}

export function findUniverseNode(graph: UniverseGraph, symbolOrAlias: string): UniverseMarketNode | null {
  const alias = canonicalToken(symbolOrAlias);
  const entry = graph.aliases.find((candidate) => candidate.alias === alias);
  return entry ? graph.nodes.find((node) => node.id === entry.nodeId) ?? null : null;
}

export function diffUniverseGraphs(previous: UniverseGraph, next: UniverseGraph): UniverseGraphDiff {
  const before = new Map(previous.nodes.map((node) => [node.id, nodeStateFingerprint(node)]));
  const after = new Map(next.nodes.map((node) => [node.id, nodeStateFingerprint(node)]));
  const observedAtMs = Math.max(previous.observedAtMs, next.observedAtMs);
  const diffTruth = deriveTruth(
    [previous.truth, next.truth],
    createUniversePolicy(next.policy ?? { configurationVersion: next.configurationVersion }),
    observedAtMs,
    ['previousGraph', 'nextGraph', 'changes'],
    [],
    [],
    [previous.id, next.id],
  );
  const changes: UniverseGraphChange[] = [];
  for (const nodeId of sortedUnique([...before.keys(), ...after.keys()])) {
    const beforeFingerprint = before.get(nodeId) ?? null;
    const afterFingerprint = after.get(nodeId) ?? null;
    const kind: UniverseGraphChange['kind'] = beforeFingerprint === null
      ? 'ADDED'
      : afterFingerprint === null
        ? 'REMOVED'
        : beforeFingerprint === afterFingerprint
          ? 'UNCHANGED'
          : 'CHANGED';
    changes.push({
      id: stableId('universe-change', { nodeId, kind, beforeFingerprint, afterFingerprint }),
      nodeId,
      kind,
      beforeFingerprint,
      afterFingerprint,
      truth: cloneTruth(diffTruth),
    });
  }
  return {
    id: stableId('universe-diff', { previousGraphId: previous.id, nextGraphId: next.id, changeIds: changes.map((change) => change.id) }),
    previousGraphId: previous.id,
    nextGraphId: next.id,
    changes,
    truth: diffTruth,
  };
}

/** Pure full-snapshot replacement plus deterministic change receipt. */
export function updateUniverseGraph(
  previous: UniverseGraph,
  input: UniverseSnapshotInput,
  policy?: Partial<UniversePolicy>,
): UniverseGraphUpdate {
  const priorPolicy = previous.policy ?? createUniversePolicy({ configurationVersion: previous.configurationVersion });
  const graph = buildUniverseGraph(input, policy === undefined ? priorPolicy : { ...priorPolicy, ...policy });
  return { graph, diff: diffUniverseGraphs(previous, graph) };
}
