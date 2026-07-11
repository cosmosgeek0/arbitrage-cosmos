import {
  canonicalJson,
  makeStableFailure,
  sortedUnique,
  stableId,
  type StableFailure,
  type TruthMetadata,
} from '../../intelligenceFoundation/contracts/index.js';
import {
  createUniversePolicy,
  diffUniverseGraphs,
  type ListingObservation,
  type UniverseGraph,
  type UniversePolicy,
  type UniverseSnapshotInput,
  type UniverseSourceSlice,
  type UniverseSourceState,
} from '../../intelligenceFoundation/universe/index.js';
import {
  RUNTIME_ENDPOINTS,
  createRuntimeSourceId,
  type PublicRestRequest,
  type PublicRestResponse,
  type RuntimeRateBudgetState,
} from '../contracts/index.js';
import {
  RestWeightBudget,
  type WeightReservation,
} from '../lifecycle/rateBudget.js';
import { parseExchangeInformation, type ParsedRuntimeListing } from './parsers.js';
import { buildRuntimeUniverseGraph } from './shardedGraph.js';
import {
  reAgeRuntimeUniverseTruth,
  runtimeUniverseTruth,
  unavailableUniverseTruth,
} from './truth.js';
import type {
  RuntimeListingChange,
  RuntimeListingMetadata,
  RuntimeUniverseAdapterOptions,
  RuntimeUniverseConfig,
  RuntimeUniverseNodeView,
  RuntimeUniverseRestBudgetConfig,
  RuntimeUniverseSnapshot,
  RuntimeUniverseSource,
  RuntimeUniverseSourceSnapshot,
} from './types.js';

const SPOT_PATH = '/api/v3/exchangeInfo';
const USD_M_PATH = '/fapi/v1/exchangeInfo';

export const RUNTIME_UNIVERSE_SOURCE_IDS = Object.freeze({
  SPOT: createRuntimeSourceId({
    capability: 'spot-exchange-info',
    endpointClass: 'REST',
    productFamily: 'SPOT',
    streamOrPath: SPOT_PATH,
  }),
  USD_M_PERPETUAL: createRuntimeSourceId({
    capability: 'usdm-exchange-info',
    endpointClass: 'REST',
    productFamily: 'USD_M_PERPETUAL',
    streamOrPath: USD_M_PATH,
  }),
});

type RuntimeUniverseDefaultConfig = Omit<RuntimeUniverseConfig, 'configurationVersion' | 'universePolicy'> & {
  universePolicy: Partial<UniversePolicy>;
};

export const RUNTIME_UNIVERSE_DEFAULTS: Readonly<RuntimeUniverseDefaultConfig> = deepFreeze({
  requestTimeoutMs: 8_000,
  maximumResponseBytes: 24 * 1024 * 1024,
  maximumSymbolsPerSource: 50_000,
  maximumFiltersPerSymbol: 128,
  maximumFilterBytes: 16 * 1024,
  maximumAliasesPerListing: 64,
  sourceStaleAfterMs: 15 * 60_000,
  maximumFutureSkewMs: 2_000,
  restBudgets: {
    SPOT: {
      requestWeight: 20,
      limit: 6_000,
      intervalMs: 60_000,
      nearLimitRatio: 0.8,
      defaultCooldownMs: 2 * 60_000,
    },
    USD_M_PERPETUAL: {
      requestWeight: 1,
      limit: 2_400,
      intervalMs: 60_000,
      nearLimitRatio: 0.8,
      defaultCooldownMs: 2 * 60_000,
    },
  },
  universePolicy: {
    configurationVersion: 'live-intelligence-universe-policy-1',
    maxRecordsPerSource: 50_000,
    maxAliasesPerInstrument: 64,
    requireSpotForFocus: true,
    requirePerpetualForFocus: false,
    requireMarginForFocus: false,
    requireBorrowEligibilityForFocus: false,
    requireBorrowAvailabilityForFocus: false,
    requirePublicDataForFocus: true,
    requireFocusedDataForFocus: false,
  },
});

interface SourceState {
  rows: Map<string, ParsedRuntimeListing>;
  lastResponseTimeMs: number | null;
  lastCompleteResponseTimeMs: number | null;
  state: UniverseSourceState;
  failures: StableFailure[];
  truth: TruthMetadata | null;
  refreshState: 'READY' | 'RATE_LIMITED';
  nextEligibleAtMs: number | null;
  rateBudget: RuntimeRateBudgetState | null;
}

interface SourceRefresh {
  source: RuntimeUniverseSource;
  state: SourceState;
  changes: RuntimeListingChange[];
}

interface SourceAttempt {
  readonly reservation: Readonly<WeightReservation>;
  readonly settled: PromiseSettledResult<PublicRestResponse<unknown>> | null;
}

interface SourceBudgetObservation {
  readonly refreshState: 'READY' | 'RATE_LIMITED';
  readonly nextEligibleAtMs: number | null;
  readonly rateBudget: Readonly<RuntimeRateBudgetState>;
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function validatedRestBudget(
  source: RuntimeUniverseSource,
  value: RuntimeUniverseRestBudgetConfig,
): RuntimeUniverseRestBudgetConfig {
  const requestWeight = safeInteger(value.requestWeight, `${source}.requestWeight`, 1, 1_000_000);
  const limit = safeInteger(value.limit, `${source}.limit`, 1, 1_000_000_000);
  const intervalMs = safeInteger(value.intervalMs, `${source}.intervalMs`, 1, 24 * 60 * 60_000);
  const defaultCooldownMs = safeInteger(
    value.defaultCooldownMs,
    `${source}.defaultCooldownMs`,
    1,
    3 * 24 * 60 * 60_000,
  );
  if (requestWeight > limit) throw new RangeError(`${source}.requestWeight must not exceed its limit`);
  if (typeof value.nearLimitRatio !== 'number' || !Number.isFinite(value.nearLimitRatio)
    || value.nearLimitRatio <= 0 || value.nearLimitRatio >= 1) {
    throw new RangeError(`${source}.nearLimitRatio must be finite and in (0, 1)`);
  }
  return {
    requestWeight,
    limit,
    intervalMs,
    nearLimitRatio: value.nearLimitRatio,
    defaultCooldownMs,
  };
}

function validatedConfig(options: RuntimeUniverseAdapterOptions): RuntimeUniverseConfig {
  if (typeof options?.transport?.request !== 'function') throw new TypeError('public REST transport is required');
  if (typeof options?.clock?.nowMs !== 'function') throw new TypeError('runtime clock is required');
  const supplied = options.config ?? {};
  const restBudgets = {
    SPOT: validatedRestBudget('SPOT', {
      ...RUNTIME_UNIVERSE_DEFAULTS.restBudgets.SPOT,
      ...(supplied.restBudgets?.SPOT ?? {}),
    }),
    USD_M_PERPETUAL: validatedRestBudget('USD_M_PERPETUAL', {
      ...RUNTIME_UNIVERSE_DEFAULTS.restBudgets.USD_M_PERPETUAL,
      ...(supplied.restBudgets?.USD_M_PERPETUAL ?? {}),
    }),
  };
  const rawConfig: RuntimeUniverseDefaultConfig = {
    ...RUNTIME_UNIVERSE_DEFAULTS,
    ...supplied,
    restBudgets,
    universePolicy: {
      ...RUNTIME_UNIVERSE_DEFAULTS.universePolicy,
      ...(supplied.universePolicy ?? {}),
    },
  };
  safeInteger(rawConfig.requestTimeoutMs, 'requestTimeoutMs', 1, 120_000);
  safeInteger(rawConfig.maximumResponseBytes, 'maximumResponseBytes', 1_024, 128 * 1024 * 1024);
  safeInteger(rawConfig.maximumSymbolsPerSource, 'maximumSymbolsPerSource', 1, 50_000);
  safeInteger(rawConfig.maximumFiltersPerSymbol, 'maximumFiltersPerSymbol', 1, 1_024);
  safeInteger(rawConfig.maximumFilterBytes, 'maximumFilterBytes', 256, 1024 * 1024);
  safeInteger(rawConfig.maximumAliasesPerListing, 'maximumAliasesPerListing', 2, 512);
  safeInteger(rawConfig.sourceStaleAfterMs, 'sourceStaleAfterMs', 1, 7 * 24 * 60 * 60_000);
  safeInteger(rawConfig.maximumFutureSkewMs, 'maximumFutureSkewMs', 0, 60_000);
  const policy = createUniversePolicy(rawConfig.universePolicy);
  if (policy.maxRecordsPerSource < rawConfig.maximumSymbolsPerSource) {
    throw new RangeError('universePolicy.maxRecordsPerSource must cover maximumSymbolsPerSource');
  }
  if (policy.maxAliasesPerInstrument < rawConfig.maximumAliasesPerListing) {
    throw new RangeError('universePolicy.maxAliasesPerInstrument must cover maximumAliasesPerListing');
  }
  const configurationVersion = stableId('runtime-universe-config', {
    requestTimeoutMs: rawConfig.requestTimeoutMs,
    maximumResponseBytes: rawConfig.maximumResponseBytes,
    maximumSymbolsPerSource: rawConfig.maximumSymbolsPerSource,
    maximumFiltersPerSymbol: rawConfig.maximumFiltersPerSymbol,
    maximumFilterBytes: rawConfig.maximumFilterBytes,
    maximumAliasesPerListing: rawConfig.maximumAliasesPerListing,
    sourceStaleAfterMs: rawConfig.sourceStaleAfterMs,
    maximumFutureSkewMs: rawConfig.maximumFutureSkewMs,
    restBudgets,
    universePolicy: {
      ...policy,
      declaredConfigurationVersion: policy.configurationVersion,
    },
  });
  return deepFreeze({
    ...rawConfig,
    configurationVersion,
    universePolicy: { ...policy, configurationVersion },
  });
}

function emptySourceState(): SourceState {
  return {
    rows: new Map(),
    lastResponseTimeMs: null,
    lastCompleteResponseTimeMs: null,
    state: 'UNAVAILABLE',
    failures: [],
    truth: null,
    refreshState: 'READY',
    nextEligibleAtMs: null,
    rateBudget: null,
  };
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function cloneRowAt(row: ParsedRuntimeListing, evaluatedAtMs: number, maxAgeMs: number): ParsedRuntimeListing {
  const truth = reAgeRuntimeUniverseTruth(row.metadata.truth, evaluatedAtMs, maxAgeMs);
  return {
    key: row.key,
    metadata: { ...row.metadata, truth },
    listing: row.listing === null ? null : { ...row.listing, truth },
  };
}

function sourceDataset(source: RuntimeUniverseSource): string {
  return source === 'SPOT' ? 'spot.exchange_info' : 'usd_m.exchange_info';
}

function sourceId(source: RuntimeUniverseSource): string {
  return RUNTIME_UNIVERSE_SOURCE_IDS[source];
}

function failureForTransport(source: RuntimeUniverseSource, status?: number): StableFailure {
  const rateLimited = status === 418 || status === 429;
  return makeStableFailure(
    rateLimited ? 'BUDGET_EXHAUSTED' : 'UNAVAILABLE',
    'runtime_universe',
    rateLimited ? 'public exchangeInfo request was rate limited' : 'public exchangeInfo source unavailable',
    `${source}.transport`,
  );
}

function failureForBudget(source: RuntimeUniverseSource): StableFailure {
  return makeStableFailure(
    'BUDGET_EXHAUSTED',
    'runtime_universe',
    'public exchangeInfo refresh is paused until its REST weight budget is eligible',
    `${source}.rateBudget`,
  );
}

function sourceTruth(input: {
  source: RuntimeUniverseSource;
  state: UniverseSourceState;
  rows: Map<string, ParsedRuntimeListing>;
  evaluatedAtMs: number;
  dataTimeMs: number | null;
  failures: readonly StableFailure[];
  config: RuntimeUniverseConfig;
}): TruthMetadata {
  if (input.state === 'UNAVAILABLE' || input.dataTimeMs === null) {
    return runtimeUniverseTruth({
      configurationVersion: input.config.configurationVersion,
      sourceId: sourceId(input.source),
      dataset: sourceDataset(input.source),
      endpointClass: 'REST',
      authorityKind: 'EXCHANGE_PRIMARY',
      evaluatedAtMs: input.evaluatedAtMs,
      receivedTimeMs: input.evaluatedAtMs,
      maxAgeMs: null,
      transforms: ['refresh-public-exchange-info-v1'],
      completeness: 'MISSING',
      observedFields: [],
      missingFields: ['exchangeInfo'],
      reasonCodes: sortedUnique([
        'EXCHANGE_INFO_UNAVAILABLE',
        ...input.failures.map((failure) => failure.code),
      ]),
    });
  }
  const listingIds = [...input.rows.values()]
    .map((row) => row.metadata.id)
    .sort(codePointCompare);
  const rowFreshnessStates = sortedUnique([...input.rows.values()]
    .map((row) => row.metadata.truth.freshness.state));
  const mixedFreshness = rowFreshnessStates.length > 1;
  return runtimeUniverseTruth({
    configurationVersion: input.config.configurationVersion,
    sourceId: sourceId(input.source),
    dataset: sourceDataset(input.source),
    endpointClass: 'REST',
    authorityKind: 'EXCHANGE_PRIMARY',
    evaluatedAtMs: input.evaluatedAtMs,
    receivedTimeMs: input.dataTimeMs,
    maxAgeMs: input.config.sourceStaleAfterMs,
    sourceRecordIds: listingIds,
    transforms: ['refresh-public-exchange-info-v1', 'retain-complete-last-known-rows-v1'],
    completeness: input.state === 'COMPLETE' ? 'COMPLETE' : 'PARTIAL',
    observedFields: ['symbols'],
    missingFields: input.state === 'COMPLETE' ? [] : ['completeExchangeInfoRefresh'],
    reasonCodes: input.state === 'COMPLETE'
      ? []
      : sortedUnique([
        'PARTIAL_REFRESH_RETAINED_LAST_KNOWN',
        ...(mixedFreshness ? ['RETAINED_ROWS_HAVE_MIXED_FRESHNESS'] : []),
        ...input.failures.map((failure) => failure.code),
      ]),
  });
}

function listingChanges(
  source: RuntimeUniverseSource,
  previous: ReadonlyMap<string, ParsedRuntimeListing>,
  next: ReadonlyMap<string, ParsedRuntimeListing>,
): RuntimeListingChange[] {
  const output: RuntimeListingChange[] = [];
  for (const symbol of sortedUnique([...previous.keys(), ...next.keys()])) {
    const before = previous.get(symbol)?.metadata ?? null;
    const after = next.get(symbol)?.metadata ?? null;
    const kind: RuntimeListingChange['kind'] = before === null
      ? 'ADDED'
      : after === null
        ? 'REMOVED'
        : before.fingerprint === after.fingerprint
          ? 'UNCHANGED'
          : 'CHANGED';
    const reasonCodes: string[] = [];
    if (kind === 'ADDED') reasonCodes.push('LISTING_ADDED');
    else if (kind === 'REMOVED') reasonCodes.push('LISTING_REMOVED_FROM_COMPLETE_REFRESH');
    else if (kind === 'CHANGED' && before !== null && after !== null) {
      if (before.status !== after.status || before.tradingAllowed !== after.tradingAllowed) reasonCodes.push('STATUS_CHANGED');
      if (before.contractType !== after.contractType || before.onboardDateMs !== after.onboardDateMs || before.deliveryDateMs !== after.deliveryDateMs) {
        reasonCodes.push('CONTRACT_METADATA_CHANGED');
      }
      if (canonicalJson(before.filters) !== canonicalJson(after.filters)) reasonCodes.push('FILTER_METADATA_CHANGED');
      if (reasonCodes.length === 0) reasonCodes.push('LISTING_METADATA_CHANGED');
    } else reasonCodes.push('LISTING_UNCHANGED');
    const material = {
      source,
      symbol,
      kind,
      beforeFingerprint: before?.fingerprint ?? null,
      afterFingerprint: after?.fingerprint ?? null,
      reasonCodes: sortedUnique(reasonCodes),
    };
    output.push({ id: stableId('runtime-listing-change', material), ...material });
  }
  return output;
}

function requestFor(source: RuntimeUniverseSource, config: RuntimeUniverseConfig): PublicRestRequest {
  const spot = source === 'SPOT';
  return {
    sourceId: sourceId(source),
    method: 'GET',
    baseUrl: spot ? RUNTIME_ENDPOINTS.SPOT_PUBLIC_REST.baseUrl : RUNTIME_ENDPOINTS.USD_M_PUBLIC_REST.baseUrl,
    path: spot ? SPOT_PATH : USD_M_PATH,
    query: {},
    timeoutMs: config.requestTimeoutMs,
    maximumResponseBytes: config.maximumResponseBytes,
  };
}

async function settleSourceRequest(
  transport: RuntimeUniverseAdapterOptions['transport'],
  request: PublicRestRequest,
  reservation: Readonly<WeightReservation>,
): Promise<PromiseSettledResult<PublicRestResponse<unknown>> | null> {
  if (!reservation.allowed) return null;
  try {
    return { status: 'fulfilled', value: await transport.request(request) };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

function validHttpStatus(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 100 && (value as number) <= 599;
}

function responseHeaders(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Readonly<Record<string, string>>;
}

function observeSourceBudget(input: {
  budget: RestWeightBudget;
  attempt: SourceAttempt;
  observedAtMs: number;
  config: RuntimeUniverseRestBudgetConfig;
}): SourceBudgetObservation {
  let rateBudget: Readonly<RuntimeRateBudgetState>;
  const response = input.attempt.settled?.status === 'fulfilled'
    ? input.attempt.settled.value
    : null;
  if (response !== null && validHttpStatus(response.status)) {
    rateBudget = input.budget.observeResponse({
      status: response.status,
      headers: responseHeaders(response.headers),
      observedAtMs: input.observedAtMs,
    });
  } else {
    rateBudget = input.budget.snapshot(input.observedAtMs);
  }
  const locallyExhausted = rateBudget.usedWeight !== null
    && rateBudget.limit !== null
    && rateBudget.usedWeight + input.config.requestWeight > rateBudget.limit;
  const rateLimited = rateBudget.state === 'COOLDOWN'
    || rateBudget.state === 'EXHAUSTED'
    || locallyExhausted;
  if (!rateLimited) {
    return { refreshState: 'READY', nextEligibleAtMs: null, rateBudget };
  }
  const deniedCooldownBoundary = input.attempt.settled === null
    && input.attempt.reservation.reason === 'COOLDOWN'
    ? input.attempt.reservation.retryAtMs
    : null;
  const cooldownBoundary = rateBudget.state === 'COOLDOWN' && rateBudget.retryAfterMs !== null
    ? deniedCooldownBoundary ?? input.observedAtMs + rateBudget.retryAfterMs
    : null;
  const reservedBoundary = input.attempt.settled === null
    ? input.attempt.reservation.retryAtMs
    : null;
  const weightBoundary = rateBudget.state === 'EXHAUSTED' || locallyExhausted
    ? rateBudget.resetsAtMs
    : null;
  const boundaries = [reservedBoundary, cooldownBoundary, weightBoundary]
    .filter((value): value is number => value !== null);
  const nextEligibleAtMs = boundaries.length === 0 ? null : Math.max(...boundaries);
  if (nextEligibleAtMs === null || !Number.isSafeInteger(nextEligibleAtMs)) {
    throw new TypeError('rate-limited universe source must expose a safe next eligible timestamp');
  }
  return { refreshState: 'RATE_LIMITED', nextEligibleAtMs, rateBudget };
}

function validatedResponseTime(
  response: PublicRestResponse<unknown>,
  attemptedAtMs: number,
  evaluatedAtMs: number,
  previousResponseTimeMs: number | null,
): boolean {
  return Number.isSafeInteger(response.receiveTimeMs)
    && response.receiveTimeMs >= 0
    && response.receiveTimeMs >= attemptedAtMs
    && response.receiveTimeMs <= evaluatedAtMs
    && (previousResponseTimeMs === null || response.receiveTimeMs >= previousResponseTimeMs);
}

function oldestDataTime(rows: ReadonlyMap<string, ParsedRuntimeListing>): number | null {
  let oldest: number | null = null;
  for (const row of rows.values()) {
    oldest = oldest === null ? row.metadata.receivedTimeMs : Math.min(oldest, row.metadata.receivedTimeMs);
  }
  return oldest;
}

function mergePartialRows(input: {
  source: RuntimeUniverseSource;
  retained: Map<string, ParsedRuntimeListing>;
  parsed: readonly ParsedRuntimeListing[];
  maximumSymbols: number;
}): { rows: Map<string, ParsedRuntimeListing>; failures: StableFailure[] } {
  const rows = input.retained;
  const additions: ParsedRuntimeListing[] = [];
  for (const row of input.parsed) {
    if (rows.has(row.key)) rows.set(row.key, row);
    else additions.push(row);
  }
  additions.sort((left, right) => codePointCompare(left.key, right.key));
  const available = Math.max(0, input.maximumSymbols - rows.size);
  for (const row of additions.slice(0, available)) rows.set(row.key, row);
  const dropped = additions.slice(available);
  if (dropped.length === 0) return { rows, failures: [] };
  return {
    rows,
    failures: [makeStableFailure(
      'BUDGET_EXHAUSTED',
      'runtime_universe',
      `partial refresh dropped ${dropped.length} new rows to preserve complete last-known rows within capacity`,
      `${input.source}.symbols.partialMergeCapacity`,
      dropped.slice(0, 256).map((row) => row.metadata.id),
    )],
  };
}

function refreshSource(input: {
  source: RuntimeUniverseSource;
  previous: SourceState;
  settled: PromiseSettledResult<PublicRestResponse<unknown>> | null;
  budget: SourceBudgetObservation;
  attemptedAtMs: number;
  evaluatedAtMs: number;
  config: RuntimeUniverseConfig;
}): SourceRefresh {
  let rows = new Map([...input.previous.rows.entries()].map(([key, row]) => [
    key,
    cloneRowAt(row, input.evaluatedAtMs, input.config.sourceStaleAfterMs),
  ]));
  let failures: StableFailure[] = [];
  let state: UniverseSourceState = rows.size > 0 ? 'PARTIAL' : 'UNAVAILABLE';
  let lastResponseTimeMs = input.previous.lastResponseTimeMs;
  let lastCompleteResponseTimeMs = input.previous.lastCompleteResponseTimeMs;
  if (input.settled === null) {
    failures = [failureForBudget(input.source)];
  } else if (input.settled.status === 'rejected') {
    failures = [failureForTransport(input.source)];
  } else if (input.settled.value.status !== 200) {
    failures = [failureForTransport(input.source, input.settled.value.status)];
  } else if (!validatedResponseTime(
    input.settled.value,
    input.attemptedAtMs,
    input.evaluatedAtMs,
    input.previous.lastResponseTimeMs,
  )) {
    failures = [makeStableFailure(
      'TIMESTAMP_SKEW',
      'runtime_universe',
      'exchangeInfo receipt must fall within the current attempt and be monotonic with the prior accepted response',
      `${input.source}.receiveTimeMs`,
    )];
  } else {
    const response = input.settled.value;
    lastResponseTimeMs = response.receiveTimeMs;
    const parsed = parseExchangeInformation(response.body, {
      source: input.source,
      sourceId: sourceId(input.source),
      dataset: sourceDataset(input.source),
      receivedTimeMs: response.receiveTimeMs,
      evaluatedAtMs: input.evaluatedAtMs,
      config: input.config,
    });
    failures = parsed.failures;
    if (parsed.complete) {
      rows = new Map(parsed.listings.map((row) => [row.key, row]));
      state = 'COMPLETE';
      lastCompleteResponseTimeMs = response.receiveTimeMs;
    } else {
      const merged = mergePartialRows({
        source: input.source,
        retained: rows,
        parsed: parsed.listings,
        maximumSymbols: input.config.maximumSymbolsPerSource,
      });
      rows = merged.rows;
      failures = [...failures, ...merged.failures].sort((left, right) => codePointCompare(left.id, right.id));
      state = rows.size > 0 ? 'PARTIAL' : 'UNAVAILABLE';
    }
  }
  const dataTimeMs = oldestDataTime(rows) ?? (state === 'UNAVAILABLE' ? null : lastResponseTimeMs);
  const truth = sourceTruth({
    source: input.source,
    state,
    rows,
    evaluatedAtMs: input.evaluatedAtMs,
    dataTimeMs,
    failures,
    config: input.config,
  });
  const nextState: SourceState = {
    rows,
    lastResponseTimeMs,
    lastCompleteResponseTimeMs,
    state,
    failures,
    truth,
    refreshState: input.budget.refreshState,
    nextEligibleAtMs: input.budget.nextEligibleAtMs,
    rateBudget: { ...input.budget.rateBudget },
  };
  return {
    source: input.source,
    state: nextState,
    changes: listingChanges(input.source, input.previous.rows, rows),
  };
}

function unavailableSlice<T>(
  source: 'MARGIN' | 'BORROW' | 'COVERAGE',
  atMs: number,
  configurationVersion: string,
): UniverseSourceSlice<T> {
  const sourceLabel = source.toLowerCase();
  return {
    source,
    state: 'UNAVAILABLE',
    records: [],
    truth: unavailableUniverseTruth({
      configurationVersion,
      sourceId: 'live-intelligence-universe-public-only',
      dataset: `${sourceLabel}.out_of_scope`,
      evaluatedAtMs: atMs,
      missingField: sourceLabel,
      reasonCode: `${source}_SOURCE_OUT_OF_SCOPE`,
    }),
  };
}

function sourceSlice(source: RuntimeUniverseSource, state: SourceState): UniverseSourceSlice<ListingObservation> {
  const records = [...state.rows.values()]
    .map((row) => row.listing)
    .filter((listing): listing is ListingObservation => listing !== null)
    .sort((left, right) => codePointCompare(left.instrument.instrumentId, right.instrument.instrumentId));
  if (state.truth === null) throw new TypeError(`${source} source truth is unavailable`);
  return { source, state: state.state, records, truth: state.truth };
}

function snapshotInput(
  spot: SourceState,
  futures: SourceState,
  atMs: number,
  configurationVersion: string,
): UniverseSnapshotInput {
  return {
    observedAtMs: atMs,
    spot: sourceSlice('SPOT', spot),
    usdMPerpetual: sourceSlice('USD_M_PERPETUAL', futures),
    margin: unavailableSlice('MARGIN', atMs, configurationVersion),
    borrow: unavailableSlice('BORROW', atMs, configurationVersion),
    coverage: unavailableSlice('COVERAGE', atMs, configurationVersion),
  };
}

function emptySnapshotInput(atMs: number, configurationVersion: string): UniverseSnapshotInput {
  const unavailable = (source: RuntimeUniverseSource): UniverseSourceSlice<ListingObservation> => ({
    source,
    state: 'UNAVAILABLE',
    records: [],
    truth: runtimeUniverseTruth({
      configurationVersion,
      sourceId: sourceId(source),
      dataset: sourceDataset(source),
      endpointClass: 'REST',
      authorityKind: 'EXCHANGE_PRIMARY',
      evaluatedAtMs: atMs,
      receivedTimeMs: atMs,
      maxAgeMs: null,
      transforms: ['initialize-empty-runtime-universe-v1'],
      completeness: 'MISSING',
      observedFields: [],
      missingFields: ['exchangeInfo'],
      reasonCodes: ['EXCHANGE_INFO_NOT_YET_OBSERVED'],
    }),
  });
  return {
    observedAtMs: atMs,
    spot: unavailable('SPOT'),
    usdMPerpetual: unavailable('USD_M_PERPETUAL'),
    margin: unavailableSlice('MARGIN', atMs, configurationVersion),
    borrow: unavailableSlice('BORROW', atMs, configurationVersion),
    coverage: unavailableSlice('COVERAGE', atMs, configurationVersion),
  };
}

function sourceSnapshot(
  source: RuntimeUniverseSource,
  state: SourceState,
  attemptedAtMs: number,
): RuntimeUniverseSourceSnapshot {
  if (state.truth === null) throw new TypeError(`${source} source truth is unavailable`);
  if (state.rateBudget === null) throw new TypeError(`${source} rate budget is unavailable`);
  return {
    source,
    state: state.state,
    refreshState: state.refreshState,
    nextEligibleAtMs: state.nextEligibleAtMs,
    rateBudget: { ...state.rateBudget },
    attemptedAtMs,
    lastResponseTimeMs: state.lastResponseTimeMs,
    lastCompleteResponseTimeMs: state.lastCompleteResponseTimeMs,
    retainedListingCount: [...state.rows.values()].filter((row) => row.listing !== null).length,
    stale: state.truth.freshness.state === 'STALE',
    failures: [...state.failures],
    truth: state.truth,
  };
}

function nodeViews(graph: UniverseGraph): RuntimeUniverseNodeView[] {
  return graph.nodes.map((node): RuntimeUniverseNodeView => {
    const spot: RuntimeUniverseNodeView['tradeability']['spot'] = node.spot?.marketAvailability ?? 'MISSING';
    const usdMPerpetual: RuntimeUniverseNodeView['tradeability']['usdMPerpetual'] = node.usdMPerpetual?.marketAvailability ?? 'MISSING';
    const availableLegs = [spot, usdMPerpetual].filter((state) => state !== 'MISSING');
    const blocked = availableLegs.length > 0 && availableLegs.every((state) => state === 'INACTIVE');
    const reasonCodes = [
      'EXCHANGE_INFO_ONLY_LIVE_TRADEABILITY_UNPROVEN',
      ...(spot === 'INACTIVE' ? ['SPOT_STATUS_INACTIVE'] : []),
      ...(usdMPerpetual === 'INACTIVE' ? ['USD_M_PERPETUAL_STATUS_INACTIVE'] : []),
      ...(spot === 'MISSING' ? ['SPOT_LEG_MISSING'] : []),
      ...(usdMPerpetual === 'MISSING' ? ['USD_M_PERPETUAL_LEG_MISSING'] : []),
    ];
    return {
      nodeId: node.id,
      canonicalMarket: node.canonicalMarket,
      aliases: [...node.aliases],
      visibility: { state: 'VISIBLE' as const, reasonCodes: [...node.visibility.reasonCodes] },
      coverage: {
        publicData: node.publicData,
        focusedData: node.focusedData,
      },
      focusEligibility: node.focusEligibility,
      tradeability: {
        state: blocked ? 'BLOCKED' as const : 'UNKNOWN' as const,
        spot,
        usdMPerpetual,
        reasonCodes: sortedUnique(reasonCodes),
      },
    };
  }).sort((left, right) => codePointCompare(left.nodeId, right.nodeId));
}

/**
 * Explicit-tick public exchange-info adapter. Construction and imports perform
 * no network I/O, schedule no work, and start no timer.
 */
export class BinancePublicUniverseAdapter {
  readonly #transport: RuntimeUniverseAdapterOptions['transport'];
  readonly #clock: RuntimeUniverseAdapterOptions['clock'];
  readonly #config: RuntimeUniverseConfig;
  #spotBudget: RestWeightBudget | null = null;
  #futuresBudget: RestWeightBudget | null = null;
  #lastBudgetTimeMs = 0;
  #spot = emptySourceState();
  #futures = emptySourceState();
  #graph: UniverseGraph | null = null;
  #snapshot: RuntimeUniverseSnapshot | null = null;
  #inFlight: Promise<RuntimeUniverseSnapshot> | null = null;

  constructor(options: RuntimeUniverseAdapterOptions) {
    this.#config = validatedConfig(options);
    this.#transport = options.transport;
    this.#clock = options.clock;
  }

  get config(): RuntimeUniverseConfig {
    return this.#config;
  }

  snapshot(): RuntimeUniverseSnapshot | null {
    return this.#snapshot;
  }

  tick(): Promise<RuntimeUniverseSnapshot> {
    if (this.#inFlight !== null) return this.#inFlight;
    const work = this.#tick().finally(() => {
      if (this.#inFlight === work) this.#inFlight = null;
    });
    this.#inFlight = work;
    return work;
  }

  async #tick(): Promise<RuntimeUniverseSnapshot> {
    const attemptedAtMs = this.#clock.nowMs();
    safeInteger(attemptedAtMs, 'clock.nowMs', 0, Number.MAX_SAFE_INTEGER);
    const budgetAttemptedAtMs = Math.max(attemptedAtMs, this.#lastBudgetTimeMs);
    const spotBudget = this.#budget('SPOT', budgetAttemptedAtMs);
    const futuresBudget = this.#budget('USD_M_PERPETUAL', budgetAttemptedAtMs);
    const spotReservation = spotBudget.reserve(
      this.#config.restBudgets.SPOT.requestWeight,
      budgetAttemptedAtMs,
    );
    const futuresReservation = futuresBudget.reserve(
      this.#config.restBudgets.USD_M_PERPETUAL.requestWeight,
      budgetAttemptedAtMs,
    );
    const [spotResult, futuresResult] = await Promise.all([
      settleSourceRequest(
        this.#transport,
        requestFor('SPOT', this.#config),
        spotReservation,
      ),
      settleSourceRequest(
        this.#transport,
        requestFor('USD_M_PERPETUAL', this.#config),
        futuresReservation,
      ),
    ]);
    const observedAtMs = this.#clock.nowMs();
    safeInteger(observedAtMs, 'clock.nowMs', attemptedAtMs, Number.MAX_SAFE_INTEGER);
    const budgetObservedAtMs = Math.max(observedAtMs, budgetAttemptedAtMs);
    this.#lastBudgetTimeMs = budgetObservedAtMs;
    const spotAttempt = { reservation: spotReservation, settled: spotResult };
    const futuresAttempt = { reservation: futuresReservation, settled: futuresResult };
    const spotBudgetObservation = observeSourceBudget({
      budget: spotBudget,
      attempt: spotAttempt,
      observedAtMs: budgetObservedAtMs,
      config: this.#config.restBudgets.SPOT,
    });
    const futuresBudgetObservation = observeSourceBudget({
      budget: futuresBudget,
      attempt: futuresAttempt,
      observedAtMs: budgetObservedAtMs,
      config: this.#config.restBudgets.USD_M_PERPETUAL,
    });
    const spot = refreshSource({
      source: 'SPOT', previous: this.#spot, settled: spotResult,
      budget: spotBudgetObservation,
      attemptedAtMs, evaluatedAtMs: observedAtMs, config: this.#config,
    });
    const futures = refreshSource({
      source: 'USD_M_PERPETUAL', previous: this.#futures, settled: futuresResult,
      budget: futuresBudgetObservation,
      attemptedAtMs, evaluatedAtMs: observedAtMs, config: this.#config,
    });
    this.#spot = spot.state;
    this.#futures = futures.state;
    const input = snapshotInput(this.#spot, this.#futures, observedAtMs, this.#config.configurationVersion);
    const graph = buildRuntimeUniverseGraph(input, this.#config.universePolicy, this.#config.sourceStaleAfterMs);
    const previousGraph = this.#graph ?? buildRuntimeUniverseGraph(
      emptySnapshotInput(observedAtMs, this.#config.configurationVersion),
      this.#config.universePolicy,
      this.#config.sourceStaleAfterMs,
    );
    const diff = diffUniverseGraphs(previousGraph, graph);
    this.#graph = graph;
    const metadata = [...this.#spot.rows.values(), ...this.#futures.rows.values()]
      .map((row) => row.metadata)
      .sort((left, right) => codePointCompare(left.source, right.source) || codePointCompare(left.symbol, right.symbol));
    const changes = [...spot.changes, ...futures.changes]
      .sort((left, right) => codePointCompare(left.source, right.source) || codePointCompare(left.symbol, right.symbol));
    const failures = [...new Map([
      ...this.#spot.failures,
      ...this.#futures.failures,
      ...graph.failures,
    ].map((failure) => [failure.id, failure])).values()].sort((left, right) => codePointCompare(left.id, right.id));
    const sources = {
      SPOT: sourceSnapshot('SPOT', this.#spot, attemptedAtMs),
      USD_M_PERPETUAL: sourceSnapshot('USD_M_PERPETUAL', this.#futures, attemptedAtMs),
    };
    const material = {
      observedAtMs,
      graphId: graph.id,
      diffId: diff.id,
      metadataFingerprints: metadata.map((entry) => entry.fingerprint),
      listingChangeIds: changes.map((entry) => entry.id),
      sourceStates: {
        SPOT: {
          state: sources.SPOT.state,
          refreshState: sources.SPOT.refreshState,
          nextEligibleAtMs: sources.SPOT.nextEligibleAtMs,
          rateBudget: sources.SPOT.rateBudget,
        },
        USD_M_PERPETUAL: {
          state: sources.USD_M_PERPETUAL.state,
          refreshState: sources.USD_M_PERPETUAL.refreshState,
          nextEligibleAtMs: sources.USD_M_PERPETUAL.nextEligibleAtMs,
          rateBudget: sources.USD_M_PERPETUAL.rateBudget,
        },
      },
      failureIds: failures.map((failure) => failure.id),
    };
    const snapshot: RuntimeUniverseSnapshot = {
      id: stableId('runtime-universe-snapshot', material),
      observedAtMs,
      graph,
      diff,
      sources,
      metadata,
      listingChanges: changes,
      nodes: nodeViews(graph),
      failures,
    };
    this.#snapshot = deepFreeze(snapshot);
    return this.#snapshot;
  }

  #budget(source: RuntimeUniverseSource, atMs: number): RestWeightBudget {
    if (source === 'SPOT') {
      this.#spotBudget ??= new RestWeightBudget(
        { nowMs: () => atMs },
        this.#config.restBudgets.SPOT,
      );
      return this.#spotBudget;
    }
    this.#futuresBudget ??= new RestWeightBudget(
      { nowMs: () => atMs },
      this.#config.restBudgets.USD_M_PERPETUAL,
    );
    return this.#futuresBudget;
  }
}
