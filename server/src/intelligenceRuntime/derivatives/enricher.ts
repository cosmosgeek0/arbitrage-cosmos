import { stableId } from '../../intelligenceFoundation/contracts/index.js';
import type { PublicRestRequest, PublicRestResponse } from '../contracts/index.js';
import {
  DERIVATIVES_FACT_KINDS,
  DERIVATIVES_PERIODS,
  type DerivativesAvailability,
  type DerivativesCompleteness,
  type DerivativesDisagreement,
  type DerivativesEnricherConfig,
  type DerivativesEnricherPorts,
  type DerivativesError,
  type DerivativesFact,
  type DerivativesFactKind,
  type DerivativesFactValue,
  type DerivativesRefreshPlan,
  type DerivativesRefreshReport,
  type DerivativesRefreshTask,
  type DerivativesRequestCost,
  type DerivativesSnapshot,
  type DerivativesSourceDescriptor,
  type DerivativesTaskResult,
  type LiquidationIngestResult,
  type OpenInterestCurrentValue,
  type OpenInterestHistoryValue,
  type PublicLiquidationRuntimeEvent,
  type RefreshableDerivativesFactKind,
} from './types.js';
import {
  DERIVATIVES_DEFAULT_TTLS,
  DERIVATIVES_LIQUIDATION_INPUT_SOURCE_ID,
  DERIVATIVES_REFRESH_PRIORITY,
  DERIVATIVES_REFRESHABLE_KINDS,
  DERIVATIVES_SOURCES,
} from './sources.js';
import {
  parseDerivativesRestBody,
  parseFundingInfoBody,
  type ParsedRestFact,
} from './parsers.js';

const REQUIRED_PUBLIC_KINDS = DERIVATIVES_REFRESHABLE_KINDS;

interface CacheEntry {
  fact: DerivativesFact;
  nextRefreshAtMs: number;
}

interface NormalizedSymbols {
  requested: string[];
  included: string[];
  omitted: string[];
}

interface TaskExecution {
  result: DerivativesTaskResult;
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function safeNow(value: unknown): number {
  return safeInteger(value, 'clock.nowMs', 0, Number.MAX_SAFE_INTEGER);
}

function validateConfig(ports: DerivativesEnricherPorts): Readonly<DerivativesEnricherConfig> {
  if (typeof ports?.transport?.request !== 'function') throw new TypeError('public REST transport is required');
  if (typeof ports?.clock?.nowMs !== 'function') throw new TypeError('runtime clock is required');
  if (typeof ports?.rateBudget?.reserve !== 'function'
    || typeof ports.rateBudget.observeResponse !== 'function'
    || typeof ports.rateBudget.snapshot !== 'function') throw new TypeError('REST rate-budget port is required');
  const supplied = ports.config ?? {};
  const config: DerivativesEnricherConfig = {
    maximumSymbols: supplied.maximumSymbols ?? 512,
    maximumRowsPerSeries: supplied.maximumRowsPerSeries ?? 500,
    maximumFundingInfoRows: supplied.maximumFundingInfoRows ?? 10_000,
    requestTimeoutMs: supplied.requestTimeoutMs ?? 8_000,
    maximumResponseBytes: supplied.maximumResponseBytes ?? 4 * 1024 * 1024,
    maximumFutureSkewMs: supplied.maximumFutureSkewMs ?? 2_000,
    failureRetryMs: supplied.failureRetryMs ?? 5_000,
    historyLimit: supplied.historyLimit ?? 30,
    period: supplied.period ?? '5m',
    openInterestDisagreementRatio: supplied.openInterestDisagreementRatio ?? 0.10,
    openInterestComparisonWindowMs: supplied.openInterestComparisonWindowMs ?? 10 * 60_000,
    ttlMs: { ...DERIVATIVES_DEFAULT_TTLS, ...(supplied.ttlMs ?? {}) },
  };
  safeInteger(config.maximumSymbols, 'maximumSymbols', 1, 10_000);
  safeInteger(config.maximumRowsPerSeries, 'maximumRowsPerSeries', 1, 500);
  safeInteger(config.maximumFundingInfoRows, 'maximumFundingInfoRows', 1, 50_000);
  safeInteger(config.requestTimeoutMs, 'requestTimeoutMs', 1, 120_000);
  safeInteger(config.maximumResponseBytes, 'maximumResponseBytes', 1_024, 64 * 1024 * 1024);
  safeInteger(config.maximumFutureSkewMs, 'maximumFutureSkewMs', 0, 60_000);
  safeInteger(config.failureRetryMs, 'failureRetryMs', 1, 60 * 60_000);
  safeInteger(config.historyLimit, 'historyLimit', 1, Math.min(500, config.maximumRowsPerSeries));
  safeInteger(config.openInterestComparisonWindowMs, 'openInterestComparisonWindowMs', 1, 24 * 60 * 60_000);
  if (!(DERIVATIVES_PERIODS as readonly string[]).includes(config.period)) throw new TypeError('period is unsupported');
  if (typeof config.openInterestDisagreementRatio !== 'number'
    || !Number.isFinite(config.openInterestDisagreementRatio)
    || config.openInterestDisagreementRatio < 0
    || config.openInterestDisagreementRatio > 1) throw new TypeError('openInterestDisagreementRatio must be in [0, 1]');
  for (const [kind, ttl] of Object.entries(config.ttlMs)) safeInteger(ttl, `${kind}.ttlMs`, 1, 7 * 24 * 60 * 60_000);
  return Object.freeze({ ...config, ttlMs: Object.freeze({ ...config.ttlMs }) });
}

function boundedError(input: DerivativesError): Readonly<DerivativesError> {
  return Object.freeze({
    ...input,
    message: input.message.replace(/[\r\n\t]+/g, ' ').slice(0, 300),
  });
}

function requestCost(source: DerivativesSourceDescriptor, chargedBudgetUnits: number): Readonly<DerivativesRequestCost> {
  return Object.freeze({
    officialIpWeight: source.officialIpWeight,
    sharedLimit: source.sharedLimit,
    localBudgetUnits: source.localBudgetUnits,
    chargedBudgetUnits,
  });
}

function factId(input: Omit<DerivativesFact, 'id' | 'evaluatedAtMs'>): string {
  return stableId('derivatives-fact', {
    kind: input.kind,
    symbol: input.symbol,
    sourceId: input.source.sourceId,
    sourceTimeMs: input.sourceTimeMs,
    receiveTimeMs: input.receiveTimeMs,
    availability: input.availability,
    completeness: input.completeness,
    value: input.value,
    errorCode: input.lastError?.code ?? null,
    errorTimeMs: input.lastError?.observedAtMs ?? null,
  });
}

function freezeFact(input: Omit<DerivativesFact, 'id'>): Readonly<DerivativesFact> {
  const base = {
    ...input,
    requestCost: Object.freeze({ ...input.requestCost }),
    lastError: input.lastError === null ? null : Object.freeze({ ...input.lastError }),
    reasonCodes: Object.freeze([...new Set(input.reasonCodes)].sort(codePointCompare)),
  };
  return Object.freeze({ id: factId(base), ...base });
}

function queryFor(kind: RefreshableDerivativesFactKind, symbol: string | null, config: DerivativesEnricherConfig) {
  if (kind === 'FUNDING_INFO') return Object.freeze({});
  if (symbol === null) throw new TypeError(`${kind} requires a symbol`);
  if (kind === 'OPEN_INTEREST_CURRENT') return Object.freeze({ symbol });
  if (kind === 'FUNDING_HISTORY') return Object.freeze({ symbol, limit: config.historyLimit });
  return Object.freeze({ symbol, period: config.period, limit: config.historyLimit });
}

function responseTimeValid(
  response: PublicRestResponse<unknown>,
  attemptedAtMs: number,
  completedAtMs: number,
  previousReceiveTimeMs: number | null,
): boolean {
  return Number.isSafeInteger(response.receiveTimeMs)
    && response.receiveTimeMs >= attemptedAtMs
    && response.receiveTimeMs <= completedAtMs
    && (previousReceiveTimeMs === null || response.receiveTimeMs >= previousReceiveTimeMs);
}

function responseEnvelopeValid(response: PublicRestResponse<unknown>): boolean {
  return response !== null
    && typeof response === 'object'
    && Number.isSafeInteger(response.status)
    && response.status >= 100
    && response.status <= 599
    && response.headers !== null
    && typeof response.headers === 'object'
    && !Array.isArray(response.headers)
    && Object.entries(response.headers).every(([name, value]) => (
      name.length > 0 && name.length <= 256 && typeof value === 'string' && value.length <= 4_096
    ));
}

export class BinancePublicDerivativesEnricher {
  readonly #ports: DerivativesEnricherPorts;
  readonly #config: Readonly<DerivativesEnricherConfig>;
  readonly #cache = new Map<string, CacheEntry>();
  #liquidationGeneration = 0;

  constructor(ports: DerivativesEnricherPorts) {
    this.#config = validateConfig(ports);
    this.#ports = ports;
  }

  planRefresh(symbols: readonly string[], atMs = this.#now()): Readonly<DerivativesRefreshPlan> {
    safeNow(atMs);
    const normalized = this.#normalizeSymbols(symbols);
    const tasks: DerivativesRefreshTask[] = [];
    for (const kind of DERIVATIVES_REFRESHABLE_KINDS) {
      const dueSymbols = normalized.included.filter((symbol) => {
        const entry = this.#cache.get(this.#key(kind, symbol));
        return entry === undefined || atMs >= entry.nextRefreshAtMs;
      });
      if (kind === 'FUNDING_INFO') {
        if (dueSymbols.length > 0) tasks.push(this.#task(kind, dueSymbols, atMs));
        continue;
      }
      for (const symbol of dueSymbols) tasks.push(this.#task(kind, [symbol], atMs));
    }
    tasks.sort((left, right) => left.priority - right.priority
      || codePointCompare(left.symbols[0] ?? '', right.symbols[0] ?? '')
      || codePointCompare(left.id, right.id));
    return Object.freeze({
      plannedAtMs: atMs,
      requestedSymbols: Object.freeze(normalized.requested),
      includedSymbols: Object.freeze(normalized.included),
      omittedSymbols: Object.freeze(normalized.omitted),
      tasks: Object.freeze(tasks),
      totalLocalBudgetUnits: tasks.reduce((sum, task) => sum + task.source.localBudgetUnits, 0),
    });
  }

  async refresh(symbols: readonly string[]): Promise<Readonly<DerivativesRefreshReport>> {
    const plan = this.planRefresh(symbols, this.#now());
    const results: DerivativesTaskResult[] = [];
    for (const task of plan.tasks) {
      const executed = await this.#execute(task);
      results.push(executed.result);
    }
    const completedAtMs = this.#now();
    return Object.freeze({
      plannedAtMs: plan.plannedAtMs,
      completedAtMs,
      plan,
      results: Object.freeze(results),
      attemptedCount: results.filter((result) => result.attempted).length,
      succeededCount: results.filter((result) => result.status === 'SUCCESS').length,
      partialCount: results.filter((result) => result.status === 'PARTIAL').length,
      failedCount: results.filter((result) => result.status === 'FAILED').length,
      rateLimitedCount: results.filter((result) => result.status === 'RATE_LIMITED').length,
    });
  }

  ingestLiquidation(event: PublicLiquidationRuntimeEvent): Readonly<LiquidationIngestResult> {
    const atMs = this.#now();
    const observation = event?.payload;
    if (event?.sourceId !== DERIVATIVES_LIQUIDATION_INPUT_SOURCE_ID
      || !Number.isSafeInteger(event.connectionGeneration)
      || event.connectionGeneration < 1
      || event?.productFamily !== 'USD_M_PERPETUAL'
      || event.endpointClass !== 'MARKET'
      || event.stream !== '!forceOrder@arr'
      || event.sequence !== null
      || typeof event.correlationId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(event.correlationId)
      || observation?.kind !== 'USD_M_LIQUIDATION_CONTEXT'
      || observation.productFamily !== 'USD_M_PERPETUAL'
      || observation.marketSegment !== 'USD_M'
      || observation.sourceMarketType !== 1
      || !/^[A-Z0-9_]{3,64}$/.test(observation.symbol)
      || !/^[A-Z0-9_]{3,64}$/.test(observation.pair)
      || observation.sampledPerWindow !== true
      || observation.samplingSelection !== 'LATEST_PER_SYMBOL'
      || observation.sampleWindowMs !== 1_000
      || observation.completeness !== 'SAMPLED'
      || !Array.isArray(observation.missingFields)
      || observation.missingFields.length > 32
      || observation.missingFields.some((value) => typeof value !== 'string' || value.length === 0 || value.length > 128)
      || (observation.orderSide !== 'BUY' && observation.orderSide !== 'SELL')
      || (observation.liquidatedPositionSide !== 'LONG' && observation.liquidatedPositionSide !== 'SHORT')
      || (observation.orderSide === 'SELL' && observation.liquidatedPositionSide !== 'LONG')
      || (observation.orderSide === 'BUY' && observation.liquidatedPositionSide !== 'SHORT')
      || [observation.orderType, observation.timeInForce, observation.orderStatus]
        .some((value) => typeof value !== 'string' || value.length === 0 || value.length > 64)) {
      return Object.freeze({ accepted: false, reason: 'INVALID_SOURCE', fact: null });
    }
    const sourceTimeMs = event.sourceTransactionTimeMs ?? event.sourceEventTimeMs;
    const sourceTimes = [event.sourceEventTimeMs, event.sourceTransactionTimeMs];
    if (!Number.isSafeInteger(event.receiveTimeMs) || event.receiveTimeMs < 0 || event.receiveTimeMs > atMs
      || !Number.isSafeInteger(sourceTimeMs) || (sourceTimeMs as number) < 0
      || (sourceTimeMs as number) > event.receiveTimeMs + this.#config.maximumFutureSkewMs
      || sourceTimes.some((value) => !Number.isSafeInteger(value)
        || (value as number) < 0
        || (value as number) > event.receiveTimeMs + this.#config.maximumFutureSkewMs)
      || observation.receiveTimeMs !== event.receiveTimeMs
      || observation.sourceEventTimeMs !== event.sourceEventTimeMs
      || observation.sourceTransactionTimeMs !== event.sourceTransactionTimeMs) {
      return Object.freeze({ accepted: false, reason: 'INVALID_TIME', fact: null });
    }
    const numeric = [
      observation.originalQuantity,
      observation.lastFilledQuantity,
      observation.accumulatedFilledQuantity,
      observation.limitPrice,
      observation.averagePrice,
    ];
    if (numeric.some((value) => value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))) {
      return Object.freeze({ accepted: false, reason: 'INVALID_SOURCE', fact: null });
    }
    if (observation.originalQuantity <= 0
      || observation.lastFilledQuantity > observation.accumulatedFilledQuantity
      || observation.accumulatedFilledQuantity > observation.originalQuantity
      || observation.limitPrice === 0
      || observation.averagePrice === 0) {
      return Object.freeze({ accepted: false, reason: 'INVALID_SOURCE', fact: null });
    }
    if (event.connectionGeneration < this.#liquidationGeneration) {
      return Object.freeze({ accepted: false, reason: 'PRIOR_GENERATION', fact: null });
    }
    if (event.connectionGeneration > this.#liquidationGeneration) {
      this.#staleLiquidationPartition(atMs);
      this.#liquidationGeneration = event.connectionGeneration;
    }
    const key = this.#key('LIQUIDATION_CONTEXT', observation.symbol);
    const previous = this.#cache.get(key)?.fact ?? null;
    if (previous?.sourceTimeMs !== null && previous?.sourceTimeMs !== undefined
      && (sourceTimeMs as number) <= previous.sourceTimeMs) {
      return Object.freeze({ accepted: false, reason: 'OUT_OF_ORDER', fact: null });
    }
    const source = DERIVATIVES_SOURCES.LIQUIDATION_CONTEXT;
    const ttlMs = this.#config.ttlMs.LIQUIDATION_CONTEXT;
    const expiresAtMs = (sourceTimeMs as number) + ttlMs;
    if (!Number.isSafeInteger(expiresAtMs)) return Object.freeze({ accepted: false, reason: 'INVALID_TIME', fact: null });
    const stale = atMs >= expiresAtMs;
    const value = Object.freeze({
      kind: 'LIQUIDATION_CONTEXT' as const,
      pair: observation.pair,
      orderSide: observation.orderSide,
      liquidatedPositionSide: observation.liquidatedPositionSide,
      originalQuantity: observation.originalQuantity,
      lastFilledQuantity: observation.lastFilledQuantity,
      accumulatedFilledQuantity: observation.accumulatedFilledQuantity,
      limitPrice: observation.limitPrice,
      averagePrice: observation.averagePrice,
      orderType: observation.orderType,
      timeInForce: observation.timeInForce,
      orderStatus: observation.orderStatus,
      samplingWindowMs: 1_000 as const,
      samplingSelection: 'LATEST_PER_SYMBOL' as const,
    });
    const fact = freezeFact({
      kind: 'LIQUIDATION_CONTEXT', symbol: observation.symbol, source,
      sourceTimeMs: sourceTimeMs as number, receiveTimeMs: event.receiveTimeMs, evaluatedAtMs: atMs,
      ttlMs, expiresAtMs, availability: stale ? 'STALE' : 'AVAILABLE', completeness: 'SAMPLED',
      requestCost: requestCost(source, 0), value, lastError: null,
      reasonCodes: [
        'PUBLIC_STREAM_INPUT',
        'SAMPLED_LATEST_PER_SYMBOL_PER_1000MS',
        ...(stale ? ['SOURCE_TIME_STALE'] : []),
      ],
    });
    this.#store('LIQUIDATION_CONTEXT', observation.symbol, { fact, nextRefreshAtMs: expiresAtMs });
    return Object.freeze({ accepted: true, reason: 'ACCEPTED', fact });
  }

  snapshot(symbols: readonly string[], atMs = this.#now()): Readonly<DerivativesSnapshot> {
    safeNow(atMs);
    const normalized = this.#normalizeSymbols(symbols);
    const facts: DerivativesFact[] = [];
    for (const symbol of normalized.included) {
      for (const kind of DERIVATIVES_FACT_KINDS) facts.push(this.#factAt(kind, symbol, atMs));
    }
    const required = facts.filter((fact) => (REQUIRED_PUBLIC_KINDS as readonly string[]).includes(fact.kind));
    const availableFactCount = required.filter((fact) => fact.availability === 'AVAILABLE' && fact.value !== null).length;
    const staleFactCount = required.filter((fact) => fact.availability === 'STALE' && fact.value !== null).length;
    const missingFactCount = required.length - availableFactCount - staleFactCount;
    const complete = required.length > 0 && required.every((fact) => (
      fact.availability === 'AVAILABLE' && fact.completeness === 'COMPLETE' && fact.value !== null
    ));
    const state: DerivativesSnapshot['state'] = complete
      ? 'COMPLETE'
      : availableFactCount + staleFactCount > 0
        ? 'PARTIAL'
        : 'UNAVAILABLE';
    const disagreements = normalized.included.map((symbol) => this.#openInterestDisagreement(symbol, facts));
    return Object.freeze({
      snapshotTimeMs: atMs,
      requestedSymbols: Object.freeze(normalized.requested),
      includedSymbols: Object.freeze(normalized.included),
      omittedSymbols: Object.freeze(normalized.omitted),
      state,
      coverage: Object.freeze({
        requiredFactCount: required.length,
        availableFactCount,
        staleFactCount,
        missingFactCount,
      }),
      facts: Object.freeze(facts),
      disagreements: Object.freeze(disagreements),
      budget: Object.freeze({ ...this.#ports.rateBudget.snapshot(atMs) }),
    });
  }

  #task(
    kind: RefreshableDerivativesFactKind,
    symbols: readonly string[],
    atMs: number,
  ): DerivativesRefreshTask {
    const source = DERIVATIVES_SOURCES[kind];
    const symbol = kind === 'FUNDING_INFO' ? null : symbols[0] ?? null;
    const query = queryFor(kind, symbol, this.#config);
    const dueAtMs = Math.min(...symbols.map((entry) => this.#cache.get(this.#key(kind, entry))?.nextRefreshAtMs ?? atMs));
    const material = { kind, symbols: [...symbols].sort(codePointCompare), path: source.pathOrStream, query };
    return Object.freeze({
      id: stableId('derivatives-refresh-task', material),
      kind,
      symbols: Object.freeze(material.symbols),
      source,
      query,
      dueAtMs,
      priority: DERIVATIVES_REFRESH_PRIORITY[kind],
    });
  }

  async #execute(task: DerivativesRefreshTask): Promise<TaskExecution> {
    const attemptedAtMs = this.#now();
    let reservation: ReturnType<DerivativesEnricherPorts['rateBudget']['reserve']>;
    try {
      reservation = this.#ports.rateBudget.reserve(task.source.localBudgetUnits, attemptedAtMs);
    } catch {
      const failure = boundedError({
        code: 'RATE_BUDGET_BLOCKED', message: 'injected rate-budget port rejected the reservation',
        status: null, retryable: true, observedAtMs: attemptedAtMs,
      });
      this.#recordFailure(task, failure, 'RATE_LIMITED', false, null);
      return { result: this.#taskResult(task, 'RATE_LIMITED', false, failure.message) };
    }
    if (!reservation.allowed) {
      const failure = boundedError({
        code: 'RATE_BUDGET_BLOCKED', message: 'local REST budget denied the public request',
        status: null, retryable: true, observedAtMs: attemptedAtMs,
      });
      this.#recordFailure(task, failure, 'RATE_LIMITED', false, reservation.retryAtMs);
      return { result: this.#taskResult(task, 'RATE_LIMITED', false, failure.message) };
    }
    const request: PublicRestRequest = Object.freeze({
      sourceId: task.source.sourceId,
      method: 'GET',
      baseUrl: task.source.baseUrl,
      path: task.source.pathOrStream,
      query: task.query,
      timeoutMs: this.#config.requestTimeoutMs,
      maximumResponseBytes: this.#config.maximumResponseBytes,
    });
    let response: PublicRestResponse<unknown>;
    try {
      response = await this.#ports.transport.request(request);
    } catch {
      const failure = boundedError({
        code: 'TRANSPORT_UNAVAILABLE', message: 'public derivatives REST transport was unavailable',
        status: null, retryable: true, observedAtMs: this.#now(),
      });
      this.#recordFailure(task, failure, 'UNAVAILABLE', true, null);
      return { result: this.#taskResult(task, 'FAILED', true, failure.message) };
    }
    const completedAtMs = this.#now();
    if (!responseEnvelopeValid(response)) {
      const failure = boundedError({
        code: 'INVALID_RESPONSE', message: 'public REST transport returned an invalid response envelope',
        status: null, retryable: true, observedAtMs: completedAtMs,
      });
      this.#recordFailure(task, failure, 'INVALID', true, null);
      return { result: this.#taskResult(task, 'FAILED', true, failure.message) };
    }
    const previousReceiveTimeMs = this.#previousReceiveTime(task);
    if (!responseTimeValid(response, attemptedAtMs, completedAtMs, previousReceiveTimeMs)) {
      const failure = boundedError({
        code: 'TIMESTAMP_SKEW', message: 'public REST receive time was non-monotonic or outside the request interval',
        status: response.status, retryable: true, observedAtMs: completedAtMs,
      });
      this.#recordFailure(task, failure, 'INVALID', true, null);
      return { result: this.#taskResult(task, 'FAILED', true, failure.message) };
    }
    try {
      this.#ports.rateBudget.observeResponse({ status: response.status, headers: response.headers, observedAtMs: response.receiveTimeMs });
    } catch {
      // The fact still reflects the charged local reservation. A malformed budget port cannot fabricate source data.
    }
    if (response.status !== 200) {
      const rateLimited = response.status === 418 || response.status === 429;
      const accessBlocked = response.status === 401 || response.status === 403;
      const failure = boundedError({
        code: rateLimited ? 'RATE_LIMITED' : accessBlocked ? 'ACCESS_BLOCKED' : 'HTTP_ERROR',
        message: rateLimited
          ? 'public derivatives endpoint returned a rate-limit response'
          : accessBlocked
            ? 'public endpoint access was blocked; this does not imply that an API key is required'
            : `public derivatives endpoint returned HTTP ${response.status}`,
        status: response.status,
        retryable: rateLimited || response.status >= 500,
        observedAtMs: response.receiveTimeMs,
      });
      this.#recordFailure(task, failure, rateLimited ? 'RATE_LIMITED' : 'UNAVAILABLE', true, null);
      return { result: this.#taskResult(task, rateLimited ? 'RATE_LIMITED' : 'FAILED', true, failure.message) };
    }
    if (task.kind === 'FUNDING_INFO') return this.#applyFundingInfo(task, response);
    const symbol = task.symbols[0];
    const parsed = parseDerivativesRestBody({
      kind: task.kind,
      body: response.body,
      symbol,
      period: this.#config.period,
      receiveTimeMs: response.receiveTimeMs,
      maximumFutureSkewMs: this.#config.maximumFutureSkewMs,
      maximumRows: this.#config.maximumRowsPerSeries,
    });
    if (!parsed.ok || parsed.value === null) {
      const failure = boundedError({
        code: 'INVALID_RESPONSE', message: parsed.detail, status: 200, retryable: true, observedAtMs: response.receiveTimeMs,
      });
      this.#recordFailure(task, failure, 'INVALID', true, null);
      return { result: this.#taskResult(task, 'FAILED', true, parsed.detail) };
    }
    const priorSourceTimeMs = this.#cache.get(this.#key(task.kind, symbol))?.fact.sourceTimeMs ?? null;
    if (parsed.sourceTimeMs !== null && priorSourceTimeMs !== null && parsed.sourceTimeMs < priorSourceTimeMs) {
      const failure = boundedError({
        code: 'TIMESTAMP_SKEW', message: 'public derivatives source time regressed behind the retained fact',
        status: 200, retryable: true, observedAtMs: response.receiveTimeMs,
      });
      this.#recordFailure(task, failure, 'INVALID', true, null);
      return { result: this.#taskResult(task, 'FAILED', true, failure.message) };
    }
    const fact = this.#recordSuccess(task.kind, symbol, response.receiveTimeMs, parsed, task.source);
    const successful = fact.availability === 'AVAILABLE' && fact.completeness === 'COMPLETE';
    return {
      result: this.#taskResult(task, successful ? 'SUCCESS' : 'PARTIAL', true, parsed.detail),
    };
  }

  #applyFundingInfo(task: DerivativesRefreshTask, response: PublicRestResponse<unknown>): TaskExecution {
    const parsed = parseFundingInfoBody(response.body, task.symbols, this.#config.maximumFundingInfoRows);
    if (parsed === null) {
      const failure = boundedError({
        code: 'INVALID_RESPONSE', message: 'funding-info response must be an array',
        status: 200, retryable: true, observedAtMs: response.receiveTimeMs,
      });
      this.#recordFailure(task, failure, 'INVALID', true, null);
      return { result: this.#taskResult(task, 'FAILED', true, failure.message) };
    }
    let partial = false;
    for (const [index, entry] of parsed.entries()) {
      partial ||= entry.completeness === 'PARTIAL';
      this.#recordSuccess('FUNDING_INFO', entry.symbol, response.receiveTimeMs, {
        ok: true,
        value: entry.value,
        sourceTimeMs: null,
        completeness: entry.completeness,
        issueCount: entry.issueCount,
        detail: entry.detail,
      }, task.source, index === 0 ? task.source.localBudgetUnits : 0, ['SHARED_BATCH_REQUEST']);
    }
    return { result: this.#taskResult(task, partial ? 'PARTIAL' : 'SUCCESS', true, partial ? 'partial funding-info response retained' : 'complete funding-info response') };
  }

  #recordSuccess(
    kind: RefreshableDerivativesFactKind,
    symbol: string,
    receiveTimeMs: number,
    parsed: ParsedRestFact,
    source: DerivativesSourceDescriptor,
    chargedBudgetUnits = source.localBudgetUnits,
    additionalReasonCodes: readonly string[] = [],
  ): DerivativesFact {
    const ttlMs = this.#config.ttlMs[kind];
    const sourceTimeRequired = kind !== 'FUNDING_INFO';
    const expiryBasisMs = sourceTimeRequired ? parsed.sourceTimeMs : receiveTimeMs;
    const expiresAtMs = expiryBasisMs === null ? null : expiryBasisMs + ttlMs;
    if (expiresAtMs !== null && !Number.isSafeInteger(expiresAtMs)) {
      throw new RangeError('derivatives fact expiry overflow');
    }
    const partialError = parsed.completeness === 'PARTIAL'
      ? boundedError({
        code: 'INVALID_RESPONSE', message: parsed.detail, status: 200, retryable: true, observedAtMs: receiveTimeMs,
      })
      : null;
    const missingSourceTime = sourceTimeRequired && parsed.sourceTimeMs === null;
    const staleSource = expiresAtMs !== null && receiveTimeMs >= expiresAtMs;
    const freshnessError = missingSourceTime
      ? boundedError({
        code: 'TIMESTAMP_SKEW', message: 'public derivatives fact has no authoritative source time',
        status: 200, retryable: true, observedAtMs: receiveTimeMs,
      })
      : staleSource
        ? boundedError({
          code: 'STALE_SOURCE', message: 'public derivatives source time exceeded the kind-specific TTL before receipt',
          status: 200, retryable: true, observedAtMs: receiveTimeMs,
        })
        : null;
    const availability: DerivativesAvailability = missingSourceTime
      ? 'INVALID'
      : staleSource
        ? 'STALE'
        : 'AVAILABLE';
    const completeness: DerivativesCompleteness = availability === 'AVAILABLE'
      ? parsed.completeness
      : 'PARTIAL';
    const reasonCodes = [
      ...additionalReasonCodes,
      ...(availability === 'AVAILABLE' ? ['PUBLIC_NO_KEY_SUCCESS'] : []),
      ...(missingSourceTime ? ['SOURCE_TIME_UNAVAILABLE'] : []),
      ...(staleSource ? ['SOURCE_TIME_STALE'] : []),
      ...(partialError === null ? [] : ['PARTIAL_PUBLIC_RESPONSE']),
    ];
    const fact = freezeFact({
      kind, symbol, source, sourceTimeMs: parsed.sourceTimeMs, receiveTimeMs, evaluatedAtMs: receiveTimeMs,
      ttlMs, expiresAtMs, availability, completeness,
      requestCost: requestCost(source, chargedBudgetUnits), value: parsed.value,
      lastError: freshnessError ?? partialError,
      reasonCodes,
    });
    const partialRetryAtMs = receiveTimeMs + this.#config.failureRetryMs;
    if (!Number.isSafeInteger(partialRetryAtMs)) throw new RangeError('derivatives partial retry timestamp overflow');
    const normalRefreshAtMs = expiresAtMs ?? partialRetryAtMs;
    const nextRefreshAtMs = availability === 'AVAILABLE' && parsed.completeness === 'PARTIAL'
      ? Math.min(normalRefreshAtMs, partialRetryAtMs)
      : availability !== 'AVAILABLE'
        ? partialRetryAtMs
        : normalRefreshAtMs;
    this.#store(kind, symbol, {
      fact,
      nextRefreshAtMs,
    });
    return fact;
  }

  #recordFailure(
    task: DerivativesRefreshTask,
    failure: Readonly<DerivativesError>,
    availability: DerivativesAvailability,
    charged: boolean,
    retryAtMs: number | null,
  ): void {
    const fallbackRetryAtMs = failure.observedAtMs + this.#config.failureRetryMs;
    const nextRefreshAtMs = retryAtMs !== null && Number.isSafeInteger(retryAtMs) && retryAtMs > failure.observedAtMs
      ? retryAtMs
      : Number.isSafeInteger(fallbackRetryAtMs) ? fallbackRetryAtMs : Number.MAX_SAFE_INTEGER;
    for (const [index, symbol] of task.symbols.entries()) {
      const key = this.#key(task.kind, symbol);
      const prior = this.#cache.get(key)?.fact ?? null;
      const retained = prior?.value !== null && prior?.value !== undefined;
      const ttlMs = this.#config.ttlMs[task.kind];
      const chargedBudgetUnits = charged && (task.kind !== 'FUNDING_INFO' || index === 0)
        ? task.source.localBudgetUnits
        : 0;
      const retainedAvailability: DerivativesAvailability = prior?.availability === 'INVALID'
        ? 'INVALID'
        : 'STALE';
      const fact = freezeFact({
        kind: task.kind,
        symbol,
        source: task.source,
        sourceTimeMs: retained ? prior.sourceTimeMs : null,
        receiveTimeMs: retained ? prior.receiveTimeMs : null,
        evaluatedAtMs: failure.observedAtMs,
        ttlMs,
        expiresAtMs: retained ? prior.expiresAtMs : null,
        availability: retained ? retainedAvailability : availability,
        completeness: retained ? 'PARTIAL' : 'MISSING',
        requestCost: requestCost(task.source, chargedBudgetUnits),
        value: retained ? prior.value : null,
        lastError: failure,
        reasonCodes: [
          ...(retained ? prior.reasonCodes : []),
          failure.code,
          ...(task.kind === 'FUNDING_INFO' && charged ? ['SHARED_BATCH_REQUEST'] : []),
          ...(retained ? ['RETAINED_LAST_KNOWN_VALUE'] : []),
        ],
      });
      this.#store(task.kind, symbol, { fact, nextRefreshAtMs });
    }
  }

  #factAt(kind: DerivativesFactKind, symbol: string, atMs: number): DerivativesFact {
    if (kind === 'TOP_TRADER_ACCOUNT' || kind === 'TOP_TRADER_POSITION') {
      return this.#unavailableFact(kind, symbol, atMs, 'UNAVAILABLE', 'API_KEY_REQUIRED',
        'current official documentation requires X-MBX-APIKEY; no-key runtime does not request this source');
    }
    const cached = this.#cache.get(this.#key(kind, symbol))?.fact ?? null;
    if (cached === null) {
      return this.#unavailableFact(kind, symbol, atMs, 'UNAVAILABLE', 'NOT_OBSERVED',
        kind === 'LIQUIDATION_CONTEXT'
          ? 'no current public liquidation sample has been supplied'
          : 'public derivatives fact has not been refreshed');
    }
    const expired = cached.value !== null && cached.expiresAtMs !== null && atMs >= cached.expiresAtMs;
    return freezeFact({
      ...cached,
      evaluatedAtMs: atMs,
      availability: expired ? 'STALE' : cached.availability,
      completeness: expired && cached.completeness === 'COMPLETE' ? 'PARTIAL' : cached.completeness,
      reasonCodes: expired ? [...cached.reasonCodes, 'TTL_EXPIRED'] : cached.reasonCodes,
    });
  }

  #staleLiquidationPartition(atMs: number): void {
    const failure = boundedError({
      code: 'PRIOR_GENERATION',
      message: 'liquidation sample belongs to a superseded connection generation',
      status: null,
      retryable: true,
      observedAtMs: atMs,
    });
    const prefix = 'LIQUIDATION_CONTEXT:';
    for (const [key, entry] of this.#cache.entries()) {
      if (!key.startsWith(prefix)) continue;
      const fact = freezeFact({
        ...entry.fact,
        evaluatedAtMs: atMs,
        availability: 'STALE',
        lastError: failure,
        reasonCodes: [...entry.fact.reasonCodes, 'PRIOR_GENERATION'],
      });
      this.#cache.set(key, Object.freeze({ fact, nextRefreshAtMs: entry.nextRefreshAtMs }));
    }
  }

  #unavailableFact(
    kind: DerivativesFactKind,
    symbol: string,
    atMs: number,
    availability: DerivativesAvailability,
    code: DerivativesError['code'],
    message: string,
  ): DerivativesFact {
    const source = DERIVATIVES_SOURCES[kind];
    const ttlMs = kind === 'LIQUIDATION_CONTEXT'
      ? this.#config.ttlMs.LIQUIDATION_CONTEXT
      : kind === 'TOP_TRADER_ACCOUNT' || kind === 'TOP_TRADER_POSITION'
        ? this.#config.ttlMs.GLOBAL_LONG_SHORT
        : this.#config.ttlMs[kind];
    return freezeFact({
      kind, symbol, source, sourceTimeMs: null, receiveTimeMs: null, evaluatedAtMs: atMs,
      ttlMs, expiresAtMs: null, availability, completeness: 'MISSING', requestCost: requestCost(source, 0),
      value: null,
      lastError: boundedError({ code, message, status: null, retryable: code === 'NOT_OBSERVED', observedAtMs: atMs }),
      reasonCodes: [code],
    });
  }

  #openInterestDisagreement(symbol: string, facts: readonly DerivativesFact[]): DerivativesDisagreement {
    const current = facts.find((fact) => fact.symbol === symbol && fact.kind === 'OPEN_INTEREST_CURRENT');
    const history = facts.find((fact) => fact.symbol === symbol && fact.kind === 'OPEN_INTEREST_HISTORY');
    const currentValue = current?.value?.kind === 'OPEN_INTEREST_CURRENT'
      ? (current.value as OpenInterestCurrentValue).openInterest
      : null;
    const historyValue = history?.value?.kind === 'OPEN_INTEREST_HISTORY'
      ? (history.value as OpenInterestHistoryValue).rows.at(-1)?.openInterest ?? null
      : null;
    const historicalTime = history?.value?.kind === 'OPEN_INTEREST_HISTORY'
      ? (history.value as OpenInterestHistoryValue).rows.at(-1)?.timestampMs ?? null
      : null;
    if (current === undefined || history === undefined || currentValue === null || historyValue === null
      || current.sourceTimeMs === null || historicalTime === null
      || current.availability !== 'AVAILABLE' || history.availability !== 'AVAILABLE') {
      return Object.freeze({
        kind: 'OPEN_INTEREST_CURRENT_VS_HISTORY', symbol, state: 'UNKNOWN', currentValue, historicalValue: historyValue,
        absoluteDifference: null, relativeDifference: null, tolerance: this.#config.openInterestDisagreementRatio,
        reason: 'both fresh public open-interest sources are required for comparison',
      });
    }
    if (Math.abs(current.sourceTimeMs - historicalTime) > this.#config.openInterestComparisonWindowMs) {
      return Object.freeze({
        kind: 'OPEN_INTEREST_CURRENT_VS_HISTORY', symbol, state: 'UNKNOWN', currentValue, historicalValue: historyValue,
        absoluteDifference: null, relativeDifference: null, tolerance: this.#config.openInterestDisagreementRatio,
        reason: 'source times fall outside the configured comparison window',
      });
    }
    const absoluteDifference = Math.abs(currentValue - historyValue);
    const scale = Math.max(Math.abs(currentValue), Math.abs(historyValue));
    const relativeDifference = scale === 0 ? 0 : absoluteDifference / scale;
    const state = relativeDifference > this.#config.openInterestDisagreementRatio ? 'DISAGREE' as const : 'AGREE' as const;
    return Object.freeze({
      kind: 'OPEN_INTEREST_CURRENT_VS_HISTORY', symbol, state, currentValue, historicalValue: historyValue,
      absoluteDifference, relativeDifference, tolerance: this.#config.openInterestDisagreementRatio,
      reason: state === 'AGREE' ? 'fresh source values are within tolerance' : 'fresh source values exceed tolerance; neither source is substituted',
    });
  }

  #taskResult(
    task: DerivativesRefreshTask,
    status: DerivativesTaskResult['status'],
    attempted: boolean,
    detail: string,
  ): DerivativesTaskResult {
    return Object.freeze({
      taskId: task.id,
      kind: task.kind,
      symbols: Object.freeze([...task.symbols]),
      status,
      attempted,
      detail: detail.slice(0, 300),
    });
  }

  #previousReceiveTime(task: DerivativesRefreshTask): number | null {
    let latest: number | null = null;
    for (const symbol of task.symbols) {
      const value = this.#cache.get(this.#key(task.kind, symbol))?.fact.receiveTimeMs ?? null;
      if (value !== null) latest = latest === null ? value : Math.max(latest, value);
    }
    return latest;
  }

  #normalizeSymbols(symbols: readonly string[]): NormalizedSymbols {
    if (!Array.isArray(symbols)) throw new TypeError('symbols must be an array');
    const requested = [...new Set(symbols.map((symbol) => {
      if (typeof symbol !== 'string' || !/^[A-Z0-9_]{3,64}$/.test(symbol)) throw new TypeError('derivatives symbol is invalid');
      return symbol;
    }))].sort(codePointCompare);
    return {
      requested,
      included: requested.slice(0, this.#config.maximumSymbols),
      omitted: requested.slice(this.#config.maximumSymbols),
    };
  }

  #store(kind: DerivativesFactKind, symbol: string, entry: CacheEntry): void {
    const key = this.#key(kind, symbol);
    if (!this.#cache.has(key)) {
      const prefix = `${kind}:`;
      const partition = [...this.#cache.entries()]
        .map(([candidate, value], insertionOrder) => ({ candidate, value, insertionOrder }))
        .filter(({ candidate }) => candidate.startsWith(prefix));
      if (partition.length >= this.#config.maximumSymbols) {
        const victim = partition.sort((left, right) => {
          const leftTime = left.value.fact.receiveTimeMs ?? left.value.fact.evaluatedAtMs;
          const rightTime = right.value.fact.receiveTimeMs ?? right.value.fact.evaluatedAtMs;
          return leftTime - rightTime
            || left.insertionOrder - right.insertionOrder
            || codePointCompare(left.candidate, right.candidate);
        })[0];
        if (victim) this.#cache.delete(victim.candidate);
      }
    } else {
      // Map insertion order is the bounded recency tie-breaker for equal source/receive times.
      this.#cache.delete(key);
    }
    this.#cache.set(key, Object.freeze(entry));
  }

  #key(kind: DerivativesFactKind, symbol: string): string {
    return `${kind}:${symbol}`;
  }

  #now(): number {
    return safeNow(this.#ports.clock.nowMs());
  }
}
