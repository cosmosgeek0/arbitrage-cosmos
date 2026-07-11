import {
  MAX_UTC_MS,
  createSourcedTimestamp,
  createStructuredFailure,
  isDataAuthority,
  isTransportOutcome,
  isValidUtcMillis,
  type TransportOutcome,
} from '../../contracts/index.js';
import {
  parseAccount,
  parseBalances,
  parseExchangeInfo,
  parseFundingRates,
  parseMarkFunding,
  parseOrder,
  parseOrders,
  parsePositions,
  parseRateLimitHeaders,
  parseServerTime,
  parseTestOrder,
  parseTrades,
  parseVenueError,
} from './parsers.js';
import { encodeForm, signEncodedForm, type FormPair } from './signing.js';
import { validateTestOrder } from './validation.js';
import {
  BINANCE_USDM_ENDPOINTS,
  type BinanceUsdMAccount,
  type BinanceUsdMBalance,
  type BinanceUsdMClientConfig,
  type BinanceUsdMCooldownState,
  type BinanceUsdMError,
  type BinanceUsdMErrorKind,
  type BinanceUsdMExchangeInfo,
  type BinanceUsdMFundingRate,
  type BinanceUsdMFundingRatesQuery,
  type BinanceUsdMMarkFunding,
  type BinanceUsdMOperation,
  type BinanceUsdMOrder,
  type BinanceUsdMOrderQuery,
  type BinanceUsdMPosition,
  type BinanceUsdMRateLimitMetadata,
  type BinanceUsdMRequestOptions,
  type BinanceUsdMResponseMetadata,
  type BinanceUsdMResult,
  type BinanceUsdMServerTime,
  type BinanceUsdMTestOrderAccepted,
  type BinanceUsdMTestOrderInput,
  type BinanceUsdMTrade,
  type BinanceUsdMTransportRequest,
  type BinanceUsdMTransportResponse,
  type BinanceUsdMUserTradesQuery,
} from './types.js';

const SYMBOL_PATTERN = /^[A-Z0-9._-]{1,40}$/;
const QUERY_CLIENT_ORDER_ID = /^[.A-Z:/a-z0-9_-]{1,36}$/;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SENSITIVE_CORRELATION_MARKER = /(?:secret|token|password|credential|api[-_]?key|signature|authorization)/i;
const DEFAULT_RECV_WINDOW_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_READ_ATTEMPTS = 2;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 1_000;

type EndpointSpec = (typeof BINANCE_USDM_ENDPOINTS)[BinanceUsdMOperation];

function positiveInteger(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new TypeError(`${label} must be an integer in [1, ${max}]`);
  }
  return value;
}

function assertSymbol(symbol: unknown, label = 'symbol'): asserts symbol is string {
  if (typeof symbol !== 'string' || !SYMBOL_PATTERN.test(symbol)) {
    throw new TypeError(`${label} must be an uppercase bounded venue symbol`);
  }
}

function optionalUtc(value: unknown, label: string): void {
  if (value !== undefined && !isValidUtcMillis(value)) {
    throw new TypeError(`${label} must be valid UTC milliseconds`);
  }
}

function assertOptions(options: BinanceUsdMRequestOptions): void {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('request options are required');
  }
  if (
    typeof options.correlationId !== 'string' ||
    !CORRELATION_ID_PATTERN.test(options.correlationId) ||
    SENSITIVE_CORRELATION_MARKER.test(options.correlationId)
  ) {
    throw new TypeError('correlationId must be a bounded non-sensitive stable identifier');
  }
  if (options.timeoutMs !== undefined) positiveInteger(options.timeoutMs, 'timeoutMs', 120_000);
  if (options.recvWindowMs !== undefined) positiveInteger(options.recvWindowMs, 'recvWindowMs', 60_000);
  if (options.signal !== undefined && typeof options.signal.aborted !== 'boolean') {
    throw new TypeError('signal must implement the injected abort-signal port');
  }
}

function signalIsAborted(signal: BinanceUsdMRequestOptions['signal']): boolean {
  return signal?.aborted === true;
}

function assertTransportResponse(value: unknown): asserts value is BinanceUsdMTransportResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('transport response must be an object');
  }
  const row = value as Record<string, unknown>;
  if (!isTransportOutcome(row.outcome)) throw new TypeError('transport outcome is invalid');
  if (
    row.status !== null &&
    (typeof row.status !== 'number' || !Number.isSafeInteger(row.status) || row.status < 100 || row.status > 599)
  ) {
    throw new TypeError('transport status is invalid');
  }
  if (row.headers !== undefined && row.headers !== null) {
    if (typeof row.headers !== 'object' || Array.isArray(row.headers)) throw new TypeError('transport headers are invalid');
    for (const [key, headerValue] of Object.entries(row.headers as Record<string, unknown>)) {
      if (key.length === 0 || typeof headerValue !== 'string') throw new TypeError('transport headers are invalid');
    }
  }
}

function freezeRate(value: BinanceUsdMRateLimitMetadata): BinanceUsdMRateLimitMetadata {
  return Object.freeze({ ...value });
}

export class BinanceUsdMClient {
  readonly #apiKey: string;
  readonly #clock: BinanceUsdMClientConfig['clock'];
  readonly #transport: BinanceUsdMClientConfig['transport'];
  readonly #signer: BinanceUsdMClientConfig['signer'];
  readonly #publicDataAuthority: BinanceUsdMClientConfig['publicDataAuthority'];
  readonly #exchangeInfoMaxAgeMs: number;
  readonly #recvWindowMs: number;
  readonly #timeoutMs: number;
  readonly #maxReadAttempts: number;
  readonly #defaultRateLimitCooldownMs: number;
  #serverOffsetMs: number | null = null;
  #cooldownUntilMs: number | null = null;
  #cooldownSource: 'VENUE_HEADER' | 'LOCAL_POLICY' | null = null;

  constructor(config: BinanceUsdMClientConfig) {
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      throw new TypeError('BinanceUsdMClient config must be an object');
    }
    if (typeof config.apiKey !== 'string' || !/^[!-~]{1,512}$/.test(config.apiKey)) {
      throw new TypeError('apiKey must be a non-empty bounded printable string');
    }
    if (typeof config.clock?.nowMs !== 'function') throw new TypeError('clock port is required');
    if (typeof config.transport?.request !== 'function') throw new TypeError('transport port is required');
    if (config.signer?.algorithm !== 'HMAC_SHA256' || typeof config.signer.sign !== 'function') {
      throw new TypeError('HMAC_SHA256 signer port is required');
    }
    if (
      !isDataAuthority(config.publicDataAuthority) ||
      !['LIVE_PUBLIC', 'RECORDED_REPLAY', 'SYNTHETIC_TEST', 'UNAVAILABLE'].includes(config.publicDataAuthority)
    ) {
      throw new TypeError('publicDataAuthority must describe an injected public/replay/test source');
    }
    this.#apiKey = config.apiKey;
    this.#clock = config.clock;
    this.#transport = config.transport;
    this.#signer = config.signer;
    this.#publicDataAuthority = config.publicDataAuthority;
    this.#exchangeInfoMaxAgeMs = positiveInteger(config.exchangeInfoMaxAgeMs, 'exchangeInfoMaxAgeMs', 604_800_000);
    this.#recvWindowMs = positiveInteger(config.recvWindowMs ?? DEFAULT_RECV_WINDOW_MS, 'recvWindowMs', 60_000);
    this.#timeoutMs = positiveInteger(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs', 120_000);
    this.#maxReadAttempts = positiveInteger(config.maxReadAttempts ?? DEFAULT_MAX_READ_ATTEMPTS, 'maxReadAttempts', 3);
    this.#defaultRateLimitCooldownMs = positiveInteger(
      config.defaultRateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS,
      'defaultRateLimitCooldownMs',
      259_200_000,
    );
  }

  getServerOffsetMs(): number | null {
    return this.#serverOffsetMs;
  }

  getCooldownState(): Readonly<BinanceUsdMCooldownState> {
    const nowMs = this.#now();
    this.#expireCooldown(nowMs);
    return Object.freeze({
      active: this.#cooldownUntilMs !== null,
      cooldownUntilMs: this.#cooldownUntilMs,
      remainingMs: this.#cooldownUntilMs === null ? null : this.#cooldownUntilMs - nowMs,
      source: this.#cooldownSource,
    });
  }

  async getServerTime(options: BinanceUsdMRequestOptions): Promise<BinanceUsdMResult<BinanceUsdMServerTime>> {
    const result = await this.#execute('SERVER_TIME', [], parseServerTime, options);
    if (!result.ok) return result;
    const roundTripMs = result.metadata.receivedAtMs - result.metadata.startedAtMs;
    const midpoint = result.metadata.startedAtMs + Math.floor(roundTripMs / 2);
    const offsetMs = result.value - midpoint;
    if (!Number.isSafeInteger(offsetMs)) {
      return this.#failureResult(
        'SERVER_TIME',
        this.#error('CLOCK', 'SERVER_OFFSET_INVALID', 'server-time offset is outside the safe integer range', false, false, 'MALFORMED', 200, null, null, result.metadata.receivedAtMs, options.correlationId, 'Inspect the injected clock and server-time adapter.'),
        result.metadata.attempts,
        result.metadata.startedAtMs,
        result.metadata.receivedAtMs,
        result.metadata.rateLimit,
      );
    }
    this.#serverOffsetMs = offsetMs;
    const metadata = this.#metadata(
      'SERVER_TIME',
      result.metadata.attempts,
      result.metadata.startedAtMs,
      result.metadata.receivedAtMs,
      result.metadata.rateLimit,
    );
    return Object.freeze({
      ok: true as const,
      value: Object.freeze({ serverTimeMs: result.value, offsetMs, roundTripMs }),
      metadata,
    });
  }

  getExchangeInfo(options: BinanceUsdMRequestOptions): Promise<BinanceUsdMResult<BinanceUsdMExchangeInfo>> {
    return this.#execute(
      'EXCHANGE_INFO',
      [],
      (body, receivedAtMs) => parseExchangeInfo(
        body,
        createSourcedTimestamp({
          sourceTimeMs: null,
          receivedAtMs,
          maxAgeMs: this.#exchangeInfoMaxAgeMs,
          authority: this.#publicDataAuthority,
          completeness: this.#publicDataAuthority === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'COMPLETE',
          sourceId: 'binance.usdm.exchangeInfo',
        }),
      ),
      options,
    );
  }

  getMarkFunding(symbol: string, options: BinanceUsdMRequestOptions): Promise<BinanceUsdMResult<BinanceUsdMMarkFunding>> {
    assertSymbol(symbol);
    return this.#execute('MARK_FUNDING', [['symbol', symbol]], (body) => parseMarkFunding(body, symbol), options);
  }

  getFundingRates(
    query: BinanceUsdMFundingRatesQuery,
    options: BinanceUsdMRequestOptions,
  ): Promise<BinanceUsdMResult<readonly BinanceUsdMFundingRate[]>> {
    if (typeof query !== 'object' || query === null || Array.isArray(query)) throw new TypeError('funding-rate query must be an object');
    if (query.symbol !== undefined) assertSymbol(query.symbol);
    optionalUtc(query.startTimeMs, 'startTimeMs');
    optionalUtc(query.endTimeMs, 'endTimeMs');
    if (query.startTimeMs !== undefined && query.endTimeMs !== undefined && query.startTimeMs > query.endTimeMs) {
      throw new TypeError('startTimeMs must be at or before endTimeMs');
    }
    if (query.limit !== undefined) positiveInteger(query.limit, 'limit', 1_000);
    const pairs: FormPair[] = [];
    if (query.symbol !== undefined) pairs.push(['symbol', query.symbol]);
    if (query.startTimeMs !== undefined) pairs.push(['startTime', query.startTimeMs]);
    if (query.endTimeMs !== undefined) pairs.push(['endTime', query.endTimeMs]);
    if (query.limit !== undefined) pairs.push(['limit', query.limit]);
    return this.#execute('FUNDING_RATE', pairs, (body) => parseFundingRates(body, query.symbol ?? null), options);
  }

  getAccount(options: BinanceUsdMRequestOptions): Promise<BinanceUsdMResult<BinanceUsdMAccount>> {
    return this.#execute('ACCOUNT', [], parseAccount, options);
  }

  getBalances(options: BinanceUsdMRequestOptions): Promise<BinanceUsdMResult<readonly BinanceUsdMBalance[]>> {
    return this.#execute('BALANCE', [], parseBalances, options);
  }

  getPositions(
    symbol: string | undefined,
    options: BinanceUsdMRequestOptions,
  ): Promise<BinanceUsdMResult<readonly BinanceUsdMPosition[]>> {
    if (symbol !== undefined) assertSymbol(symbol);
    return this.#execute(
      'POSITIONS',
      symbol === undefined ? [] : [['symbol', symbol]],
      (body) => parsePositions(body, symbol ?? null),
      options,
    );
  }

  getOrder(query: BinanceUsdMOrderQuery, options: BinanceUsdMRequestOptions): Promise<BinanceUsdMResult<BinanceUsdMOrder>> {
    if (typeof query !== 'object' || query === null || Array.isArray(query)) throw new TypeError('order query must be an object');
    assertSymbol(query.symbol);
    const hasOrderId = query.orderId !== undefined;
    const hasClientId = query.origClientOrderId !== undefined;
    if (hasOrderId === hasClientId) throw new TypeError('exactly one of orderId or origClientOrderId is required');
    if (hasOrderId) positiveInteger(query.orderId, 'orderId', Number.MAX_SAFE_INTEGER);
    if (hasClientId && !QUERY_CLIENT_ORDER_ID.test(query.origClientOrderId as string)) {
      throw new TypeError('origClientOrderId violates the official venue query constraint');
    }
    const pairs: FormPair[] = [['symbol', query.symbol]];
    if (hasOrderId) pairs.push(['orderId', query.orderId as number]);
    else pairs.push(['origClientOrderId', query.origClientOrderId as string]);
    return this.#execute('ORDER', pairs, (body) => parseOrder(body, query.symbol), options);
  }

  getOpenOrders(
    symbol: string | undefined,
    options: BinanceUsdMRequestOptions,
  ): Promise<BinanceUsdMResult<readonly BinanceUsdMOrder[]>> {
    if (symbol !== undefined) assertSymbol(symbol);
    return this.#execute(
      'OPEN_ORDERS',
      symbol === undefined ? [] : [['symbol', symbol]],
      (body) => parseOrders(body, symbol ?? null),
      options,
    );
  }

  getUserTrades(
    query: BinanceUsdMUserTradesQuery,
    options: BinanceUsdMRequestOptions,
  ): Promise<BinanceUsdMResult<readonly BinanceUsdMTrade[]>> {
    if (typeof query !== 'object' || query === null || Array.isArray(query)) throw new TypeError('user-trades query must be an object');
    assertSymbol(query.symbol);
    optionalUtc(query.startTimeMs, 'startTimeMs');
    optionalUtc(query.endTimeMs, 'endTimeMs');
    if (query.startTimeMs !== undefined && query.endTimeMs !== undefined) {
      if (query.startTimeMs > query.endTimeMs) throw new TypeError('startTimeMs must be at or before endTimeMs');
      if (query.endTimeMs - query.startTimeMs > 7 * 24 * 60 * 60 * 1_000) {
        throw new TypeError('user-trades time window cannot exceed seven days');
      }
    }
    if (query.fromId !== undefined && (query.startTimeMs !== undefined || query.endTimeMs !== undefined)) {
      throw new TypeError('fromId cannot be combined with startTimeMs or endTimeMs');
    }
    if (query.orderId !== undefined) positiveInteger(query.orderId, 'orderId', Number.MAX_SAFE_INTEGER);
    if (query.fromId !== undefined) positiveInteger(query.fromId, 'fromId', Number.MAX_SAFE_INTEGER);
    if (query.limit !== undefined) positiveInteger(query.limit, 'limit', 1_000);
    const pairs: FormPair[] = [['symbol', query.symbol]];
    if (query.orderId !== undefined) pairs.push(['orderId', query.orderId]);
    if (query.startTimeMs !== undefined) pairs.push(['startTime', query.startTimeMs]);
    if (query.endTimeMs !== undefined) pairs.push(['endTime', query.endTimeMs]);
    if (query.fromId !== undefined) pairs.push(['fromId', query.fromId]);
    if (query.limit !== undefined) pairs.push(['limit', query.limit]);
    return this.#execute('USER_TRADES', pairs, (body) => parseTrades(body, query.symbol), options);
  }

  async testOrder(
    input: BinanceUsdMTestOrderInput,
    options: BinanceUsdMRequestOptions,
  ): Promise<BinanceUsdMResult<BinanceUsdMTestOrderAccepted>> {
    assertOptions(options);
    const localNowMs = this.#now();
    const validationNowMs = localNowMs + (this.#serverOffsetMs ?? 0);
    if (!isValidUtcMillis(validationNowMs)) {
      return this.#failureResult(
        'TEST_ORDER',
        this.#error('CLOCK', 'SERVER_ADJUSTED_TIME_INVALID', 'server-adjusted validation time is invalid', false, false, 'MALFORMED', null, null, null, localNowMs, options.correlationId, 'Resynchronize server time and inspect the injected clock.'),
        0,
        localNowMs,
        localNowMs,
        this.#currentRateMetadata(localNowMs),
      );
    }
    const validation = validateTestOrder(input, validationNowMs);
    if (!validation.ok) {
      const filterFailure = validation.issues.some((item) => item.category === 'FILTER');
      return this.#failureResult(
        'TEST_ORDER',
        this.#error(
          filterFailure ? 'FILTER' : 'INPUT',
          filterFailure ? 'TEST_ORDER_FILTER_REJECTED' : 'TEST_ORDER_INPUT_INVALID',
          `test-order validation failed: ${validation.issues.map((item) => `${item.field || '(root)'}:${item.code}`).join(', ')}`,
          false,
          false,
          'REJECTED',
          null,
          null,
          null,
          localNowMs,
          options.correlationId,
          'Correct the named request or exchange-filter facts before validation.',
        ),
        0,
        localNowMs,
        localNowMs,
        this.#currentRateMetadata(localNowMs),
      );
    }
    return this.#execute('TEST_ORDER', validation.value.requestPairs, (body) => parseTestOrder(body, input.symbol), options);
  }

  async #execute<T>(
    operation: BinanceUsdMOperation,
    pairs: readonly FormPair[],
    parser: (body: unknown, receivedAtMs: number) => T,
    options: BinanceUsdMRequestOptions,
  ): Promise<BinanceUsdMResult<T>> {
    assertOptions(options);
    const spec = BINANCE_USDM_ENDPOINTS[operation] as EndpointSpec;
    let attemptStartedAtMs = this.#now();
    this.#expireCooldown(attemptStartedAtMs);
    if (options.signal?.aborted === true) {
      return this.#failureResult(
        operation,
        this.#error('ABORTED', 'REQUEST_ABORTED', 'request was aborted before transport dispatch', false, false, 'ABORTED', null, null, null, attemptStartedAtMs, options.correlationId, 'Issue a new request only if the caller still needs this read or validation.'),
        0,
        attemptStartedAtMs,
        attemptStartedAtMs,
        this.#currentRateMetadata(attemptStartedAtMs),
      );
    }
    if (this.#cooldownUntilMs !== null) {
      return this.#failureResult(
        operation,
        this.#error('COOLDOWN', 'RATE_LIMIT_COOLDOWN_ACTIVE', 'local rate-limit cooldown is active', true, false, 'REJECTED', 429, null, null, attemptStartedAtMs, options.correlationId, 'Wait until cooldownUntilMs before issuing another request.'),
        0,
        attemptStartedAtMs,
        attemptStartedAtMs,
        this.#currentRateMetadata(attemptStartedAtMs),
      );
    }
    if (spec.security === 'SIGNED' && this.#serverOffsetMs === null) {
      return this.#failureResult(
        operation,
        this.#error('CLOCK', 'SERVER_TIME_UNSYNCHRONIZED', 'signed request is blocked until server time has been synchronized', true, false, 'REJECTED', null, null, null, attemptStartedAtMs, options.correlationId, 'Call getServerTime successfully before signed reads or test-order validation.'),
        0,
        attemptStartedAtMs,
        attemptStartedAtMs,
        this.#currentRateMetadata(attemptStartedAtMs),
      );
    }

    const maxAttempts = spec.method === 'GET' ? this.#maxReadAttempts : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) {
        attemptStartedAtMs = this.#now();
        if (signalIsAborted(options.signal)) {
          return this.#failureResult(
            operation,
            this.#error('ABORTED', 'REQUEST_ABORTED_BEFORE_RETRY', 'request was aborted after the prior read attempt and before retry dispatch', false, false, 'ABORTED', null, null, null, attemptStartedAtMs, options.correlationId, 'Issue a new request only if the caller still needs this read.'),
            attempt - 1,
            attemptStartedAtMs,
            attemptStartedAtMs,
            this.#currentRateMetadata(attemptStartedAtMs),
          );
        }
      }
      let request: BinanceUsdMTransportRequest;
      try {
        request = this.#buildRequest(operation, spec, pairs, options, attemptStartedAtMs);
      } catch {
        return this.#failureResult(
          operation,
          this.#error('AUTH', 'REQUEST_SIGNING_FAILED', 'request signing failed without transport dispatch', false, false, 'MALFORMED', null, null, null, attemptStartedAtMs, options.correlationId, 'Repair or replace the injected HMAC signer.'),
          0,
          attemptStartedAtMs,
          attemptStartedAtMs,
          this.#currentRateMetadata(attemptStartedAtMs),
        );
      }

      let rawResponse: unknown;
      try {
        rawResponse = await this.#transport.request(request);
      } catch {
        const receivedAtMs = this.#now();
        const outcome: TransportOutcome = signalIsAborted(options.signal) ? 'ABORTED' : 'AMBIGUOUS';
        const error = outcome === 'ABORTED'
          ? this.#error('ABORTED', 'REQUEST_ABORTED', 'transport aborted without a usable response', false, false, outcome, null, null, null, receivedAtMs, options.correlationId, 'Retry only if the caller still needs this operation.')
          : this.#error('AMBIGUOUS', operation === 'TEST_ORDER' ? 'TEST_ORDER_TRANSPORT_AMBIGUOUS' : 'READ_TRANSPORT_AMBIGUOUS', 'transport did not produce a trustworthy response', spec.method === 'GET', true, outcome, null, null, null, receivedAtMs, options.correlationId, operation === 'TEST_ORDER' ? 'Do not resubmit automatically; record the ambiguous validation outcome.' : 'Retry the idempotent read through the bounded client policy.');
        if (this.#shouldRetry(spec, error, attempt, maxAttempts)) continue;
        return this.#failureResult(operation, error, attempt, attemptStartedAtMs, receivedAtMs, this.#currentRateMetadata(receivedAtMs));
      }

      try {
        assertTransportResponse(rawResponse);
      } catch {
        const receivedAtMs = this.#now();
        return this.#failureResult(
          operation,
          this.#error('MALFORMED', 'MALFORMED_TRANSPORT_RESPONSE', 'transport returned a malformed response envelope', false, false, 'MALFORMED', null, null, null, receivedAtMs, options.correlationId, 'Repair the injected transport adapter before retrying.'),
          attempt,
          attemptStartedAtMs,
          receivedAtMs,
          this.#currentRateMetadata(receivedAtMs),
        );
      }
      const response: BinanceUsdMTransportResponse = rawResponse;

      const receivedAtMs = this.#now();
      if (receivedAtMs < attemptStartedAtMs) {
        return this.#failureResult(
          operation,
          this.#error('CLOCK', 'CLOCK_REGRESSED', 'injected clock regressed during the request', false, false, 'MALFORMED', response.status, null, null, receivedAtMs, options.correlationId, 'Repair the injected clock before making another request.'),
          attempt,
          attemptStartedAtMs,
          receivedAtMs,
          this.#rateMetadata(response.headers, response.status, receivedAtMs),
        );
      }
      const rate = this.#rateMetadata(response.headers, response.status, receivedAtMs);
      const classified = this.#classify(operation, spec, response, receivedAtMs, options.correlationId);
      if (classified !== null) {
        if (this.#shouldRetry(spec, classified, attempt, maxAttempts)) continue;
        return this.#failureResult(operation, classified, attempt, attemptStartedAtMs, receivedAtMs, rate);
      }
      try {
        const value = parser(response.body, receivedAtMs);
        return Object.freeze({
          ok: true as const,
          value,
          metadata: this.#metadata(operation, attempt, attemptStartedAtMs, receivedAtMs, rate),
        });
      } catch {
        return this.#failureResult(
          operation,
          this.#error('MALFORMED', 'MALFORMED_RESPONSE', 'venue response failed strict schema validation', false, false, 'MALFORMED', response.status, null, null, receivedAtMs, options.correlationId, 'Inspect the adapter payload and compare it with the current official endpoint schema.'),
          attempt,
          attemptStartedAtMs,
          receivedAtMs,
          rate,
        );
      }
    }
    throw new TypeError('unreachable request loop');
  }

  #buildRequest(
    operation: BinanceUsdMOperation,
    spec: EndpointSpec,
    pairs: readonly FormPair[],
    options: BinanceUsdMRequestOptions,
    startedAtMs: number,
  ): BinanceUsdMTransportRequest {
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    let query = '';
    let body: string | null = null;
    let headers: Readonly<Record<string, string>> = Object.freeze({});
    if (spec.security === 'SIGNED') {
      const recvWindowMs = options.recvWindowMs ?? this.#recvWindowMs;
      const timestamp = startedAtMs + (this.#serverOffsetMs as number);
      if (!isValidUtcMillis(timestamp)) throw new TypeError('server-adjusted signing timestamp is invalid');
      const encoded = encodeForm([...pairs, ['recvWindow', recvWindowMs], ['timestamp', timestamp]]);
      const signed = signEncodedForm(encoded, this.#signer);
      headers = spec.method === 'POST'
        ? Object.freeze({ 'X-MBX-APIKEY': this.#apiKey, 'Content-Type': 'application/x-www-form-urlencoded' })
        : Object.freeze({ 'X-MBX-APIKEY': this.#apiKey });
      if (spec.method === 'POST') body = signed;
      else query = signed;
    } else {
      query = encodeForm(pairs);
    }
    return Object.freeze({
      operation,
      method: spec.method,
      path: spec.path,
      query,
      body,
      headers,
      timeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      idempotent: spec.idempotent,
    });
  }

  #classify(
    operation: BinanceUsdMOperation,
    spec: EndpointSpec,
    response: BinanceUsdMTransportResponse,
    occurredAtMs: number,
    correlationId: string,
  ): BinanceUsdMError | null {
    const venue = parseVenueError(response.body);
    const testOrder = operation === 'TEST_ORDER';
    if (response.outcome === 'ABORTED') {
      return this.#error('ABORTED', 'REQUEST_ABORTED', 'transport reported an aborted request', false, false, 'ABORTED', response.status, venue.code, venue.message, occurredAtMs, correlationId, 'Retry only if the caller still needs this operation.');
    }
    if (response.outcome === 'TIMEOUT') {
      return this.#error(
        testOrder ? 'AMBIGUOUS' : 'TIMEOUT',
        testOrder ? 'TEST_ORDER_TIMEOUT_AMBIGUOUS' : 'READ_TIMEOUT',
        testOrder ? 'test-order validation timed out with an ambiguous transport outcome' : 'read timed out',
        spec.method === 'GET',
        testOrder,
        'TIMEOUT',
        response.status,
        venue.code,
        venue.message,
        occurredAtMs,
        correlationId,
        testOrder ? 'Record the ambiguous test outcome; never automatically resubmit a POST.' : 'Allow the bounded idempotent-read retry policy to decide.',
      );
    }
    if (response.outcome === 'AMBIGUOUS') {
      return this.#error('AMBIGUOUS', testOrder ? 'TEST_ORDER_TRANSPORT_AMBIGUOUS' : 'READ_TRANSPORT_AMBIGUOUS', 'transport reported an ambiguous outcome', spec.method === 'GET', true, 'AMBIGUOUS', response.status, venue.code, venue.message, occurredAtMs, correlationId, testOrder ? 'Record the ambiguous test outcome and do not resubmit automatically.' : 'Allow only the bounded idempotent-read retry policy.');
    }
    if (response.outcome === 'MALFORMED' || response.status === null) {
      return this.#error('MALFORMED', 'MALFORMED_TRANSPORT_RESPONSE', 'transport response metadata is malformed', false, false, 'MALFORMED', response.status, venue.code, venue.message, occurredAtMs, correlationId, 'Repair the injected transport adapter.');
    }
    if (response.status === 418 || response.status === 429) {
      return this.#error('RATE_LIMITED', response.status === 418 ? 'IP_RATE_LIMIT_BANNED' : 'RATE_LIMITED', 'venue rate limit requires cooldown', true, false, 'REJECTED', response.status, venue.code, venue.message, occurredAtMs, correlationId, 'Honor cooldownUntilMs before another request.');
    }
    if (response.status === 408) {
      return this.#error(testOrder ? 'AMBIGUOUS' : 'TIMEOUT', testOrder ? 'TEST_ORDER_TIMEOUT_AMBIGUOUS' : 'READ_TIMEOUT', testOrder ? 'test-order HTTP timeout has an ambiguous outcome' : 'read returned HTTP timeout', spec.method === 'GET', testOrder, 'TIMEOUT', response.status, venue.code, venue.message, occurredAtMs, correlationId, testOrder ? 'Record the ambiguity and do not retry the POST.' : 'Allow only bounded idempotent-read retry.');
    }
    if (response.status === 503 && venue.message?.toLowerCase().includes('unknown error')) {
      return this.#error('AMBIGUOUS', testOrder ? 'TEST_ORDER_HTTP_503_AMBIGUOUS' : 'READ_HTTP_503_AMBIGUOUS', 'venue returned the documented unknown-execution 503 variant', spec.method === 'GET', true, 'AMBIGUOUS', response.status, venue.code, venue.message, occurredAtMs, correlationId, testOrder ? 'Record the ambiguity and do not resubmit the POST.' : 'Retry only through the bounded idempotent-read policy.');
    }
    if (response.status >= 500) {
      return this.#error('HTTP', 'VENUE_UNAVAILABLE', 'venue returned a server-side HTTP failure', spec.method === 'GET', false, 'REJECTED', response.status, venue.code, venue.message, occurredAtMs, correlationId, spec.method === 'GET' ? 'Allow only bounded idempotent-read retry.' : 'Do not automatically retry a POST.');
    }
    if (response.outcome === 'REJECTED' || response.status < 200 || response.status >= 300 || (venue.code !== null && venue.code < 0)) {
      return this.#error(venue.code === null ? 'HTTP' : 'VENUE', venue.code === null ? 'HTTP_REJECTED' : 'VENUE_REJECTED', 'venue rejected the request', false, false, 'REJECTED', response.status, venue.code, venue.message, occurredAtMs, correlationId, 'Correct the request or venue/account condition before retrying.');
    }
    return null;
  }

  #shouldRetry(spec: EndpointSpec, error: BinanceUsdMError, attempt: number, maxAttempts: number): boolean {
    return (
      spec.method === 'GET' &&
      spec.idempotent &&
      attempt < maxAttempts &&
      error.retryable &&
      (error.kind === 'TIMEOUT' || error.kind === 'AMBIGUOUS' || error.kind === 'HTTP')
    );
  }

  #rateMetadata(
    headers: Readonly<Record<string, string>> | null | undefined,
    status: number | null,
    receivedAtMs: number,
  ): BinanceUsdMRateLimitMetadata {
    const parsed = parseRateLimitHeaders(headers);
    if (status === 418 || status === 429) {
      const cooldownMs = parsed.retryAfterMs ?? this.#defaultRateLimitCooldownMs;
      const proposed = Math.min(MAX_UTC_MS, receivedAtMs + cooldownMs);
      if (this.#cooldownUntilMs === null || proposed > this.#cooldownUntilMs) {
        this.#cooldownUntilMs = proposed;
        this.#cooldownSource = parsed.retryAfterMs === null ? 'LOCAL_POLICY' : 'VENUE_HEADER';
      }
    }
    return freezeRate({
      ...parsed,
      cooldownUntilMs: this.#cooldownUntilMs,
      cooldownSource: this.#cooldownSource,
    });
  }

  #currentRateMetadata(nowMs: number): BinanceUsdMRateLimitMetadata {
    this.#expireCooldown(nowMs);
    return freezeRate({
      usedWeight1m: null,
      orderCount10s: null,
      orderCount1m: null,
      retryAfterMs: null,
      cooldownUntilMs: this.#cooldownUntilMs,
      cooldownSource: this.#cooldownSource,
    });
  }

  #expireCooldown(nowMs: number): void {
    if (this.#cooldownUntilMs !== null && nowMs >= this.#cooldownUntilMs) {
      this.#cooldownUntilMs = null;
      this.#cooldownSource = null;
    }
  }

  #metadata(
    operation: BinanceUsdMOperation,
    attempts: number,
    startedAtMs: number,
    receivedAtMs: number,
    rateLimit: BinanceUsdMRateLimitMetadata,
  ): BinanceUsdMResponseMetadata {
    const spec = BINANCE_USDM_ENDPOINTS[operation];
    return Object.freeze({
      operation,
      method: spec.method,
      path: spec.path,
      idempotent: spec.idempotent,
      attempts,
      startedAtMs,
      receivedAtMs,
      serverOffsetMs: this.#serverOffsetMs,
      rateLimit,
    });
  }

  #failureResult<T>(
    operation: BinanceUsdMOperation,
    error: BinanceUsdMError,
    attempts: number,
    startedAtMs: number,
    receivedAtMs: number,
    rateLimit: BinanceUsdMRateLimitMetadata,
  ): BinanceUsdMResult<T> {
    return Object.freeze({
      ok: false as const,
      error,
      metadata: this.#metadata(operation, attempts, startedAtMs, receivedAtMs, rateLimit),
    });
  }

  #error(
    kind: BinanceUsdMErrorKind,
    code: string,
    message: string,
    retryable: boolean,
    ambiguous: boolean,
    transportOutcome: TransportOutcome,
    httpStatus: number | null,
    venueCode: number | null,
    venueMessage: string | null,
    occurredAtMs: number,
    correlationId: string,
    recommendedOperatorAction: string,
  ): BinanceUsdMError {
    const safeVenueMessage = venueMessage === null
      ? null
      : venueMessage
          .split(this.#apiKey)
          .join('[REDACTED]')
          .replace(/\b(api[-_ ]?key|secret|signature)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
    const failure = createStructuredFailure({
      component: 'foundation.exchange.binanceUsdM',
      stage: kind.toLowerCase(),
      code,
      message,
      occurredAt: occurredAtMs,
      retryable,
      safeCurrentState: 'UNCHANGED',
      recommendedOperatorAction,
      correlationId,
    });
    return Object.freeze({
      ...failure,
      kind,
      ambiguous,
      transportOutcome,
      httpStatus,
      venueCode,
      venueMessage: safeVenueMessage,
    });
  }

  #now(): number {
    const value = this.#clock.nowMs();
    if (!isValidUtcMillis(value)) throw new TypeError('injected clock returned invalid UTC milliseconds');
    return value;
  }
}
