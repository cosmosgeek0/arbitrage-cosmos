import {
  stableId,
  type JsonValue,
} from '../../intelligenceFoundation/contracts/index.js';
import {
  BASELINE_HISTORY_INTEGRATION_GAP,
  BASELINE_HISTORY_SOURCES,
  alignBaselineIntervalDown,
  alignBaselineIntervalUp,
  createBaselineBootstrapConfig,
  estimateKlineRequestWeight,
  intervalMilliseconds,
} from './config.js';
import {
  BaselineHistoryPageError,
  parseCompletedKlinePage,
} from './candles.js';
import {
  BASELINE_BOOTSTRAP_STATES,
  BASELINE_FIXED_INTERVALS,
  type BaselineBootstrapConfig,
  type BaselineBootstrapPlanInput,
  type BaselineBootstrapSchedulerOptions,
  type BaselineBootstrapState,
  type BaselineHistoryBatch,
  type BaselinePlanItemInput,
  type BaselinePlanItemSnapshot,
  type BaselineSchedulerSnapshot,
  type BaselineStateCounts,
  type BaselineTickInput,
  type HistoryFetchRequest,
  type HistoryFetchResult,
  type RestWeightReservation,
} from './types.js';

const CHECKPOINT_SCHEMA_VERSION = 2;

interface InternalPlan {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

interface InternalItem {
  readonly id: string;
  readonly symbol: string;
  readonly instrumentId: string;
  readonly productFamily: BaselinePlanItemInput['productFamily'];
  readonly feature: string;
  readonly featureVersion: string;
  readonly interval: BaselinePlanItemInput['interval'];
  readonly intervalMs: number;
  readonly requestedStartTimeMs: number;
  readonly effectiveStartTimeMs: number;
  readonly targetEndTimeMs: number;
  readonly coverageEndTimeMs: number;
  readonly listedAtMs: number | null;
  readonly delistedAtMs: number | null;
  readonly listingState: BaselinePlanItemInput['listingState'];
  readonly minimumSamples: number;
  readonly maximumPossibleSamples: number;
  state: BaselineBootstrapState;
  terminal: boolean;
  cursorTimeMs: number;
  acceptedRecordCount: number;
  excludedIncompleteCount: number;
  duplicateRecordCount: number;
  gapCount: number;
  pageCount: number;
  batchCount: number;
  dispatchCount: number;
  estimatedWeight: number;
  actualWeight: number;
  retryCount: number;
  retryAtMs: number | null;
  lastCompletedCloseTimeMs: number | null;
  lastBatchId: string | null;
  lastReasonCode: string;
  lastMessage: string;
}

type RestoredItemState = Pick<InternalItem,
  | 'state'
  | 'terminal'
  | 'cursorTimeMs'
  | 'acceptedRecordCount'
  | 'excludedIncompleteCount'
  | 'duplicateRecordCount'
  | 'gapCount'
  | 'pageCount'
  | 'batchCount'
  | 'dispatchCount'
  | 'estimatedWeight'
  | 'actualWeight'
  | 'retryCount'
  | 'retryAtMs'
  | 'lastCompletedCloseTimeMs'
  | 'lastBatchId'
  | 'lastReasonCode'
  | 'lastMessage'
>;

interface Dispatch {
  readonly item: InternalItem;
  readonly request: Readonly<HistoryFetchRequest>;
  readonly reservationId: string;
}

interface FetchOutcome {
  readonly dispatch: Dispatch;
  readonly result: Readonly<HistoryFetchResult> | null;
  readonly completionKind: 'RESULT' | 'PORT_THROW' | 'TIMEOUT';
  readonly completedAtMs: number;
}

interface CheckpointTotals {
  estimatedWeight: number;
  actualWeight: number;
  batches: number;
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function safeInteger(
  value: unknown,
  name: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function boundedString(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${name} must be a non-empty bounded printable string`);
  }
  return value;
}

function normalizeMessage(value: unknown, maximum: number, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, maximum);
}

function checkedAdd(left: number, right: number, name: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} overflow`);
  return value;
}

function checkedMultiply(left: number, right: number, name: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} overflow`);
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], name: string): void {
  const actual = Object.keys(value).sort(codePointCompare);
  const wanted = [...expected].sort(codePointCompare);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${name} has an invalid checkpoint shape`);
  }
}

function nullableInteger(value: unknown, name: string): number | null {
  return value === null ? null : safeInteger(value, name);
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
  return value;
}

function requiredState(value: unknown): BaselineBootstrapState {
  if (typeof value !== 'string' || !(BASELINE_BOOTSTRAP_STATES as readonly string[]).includes(value)) {
    throw new TypeError('checkpoint item state is invalid');
  }
  return value as BaselineBootstrapState;
}

function retryDelay(config: Readonly<BaselineBootstrapConfig>, attempt: number): number {
  const exponent = Math.min(Math.max(0, attempt - 1), 30);
  return Math.min(config.retryMaximumDelayMs, config.retryBaseDelayMs * (2 ** exponent));
}

function stateCounts(items: readonly InternalItem[]): BaselineStateCounts {
  const counts = Object.fromEntries(BASELINE_BOOTSTRAP_STATES.map((state) => [state, 0])) as Record<BaselineBootstrapState, number>;
  for (const item of items) counts[item.state] += 1;
  return Object.freeze(counts);
}

function immutableItem(item: InternalItem): BaselinePlanItemSnapshot {
  return Object.freeze({
    id: item.id,
    symbol: item.symbol,
    instrumentId: item.instrumentId,
    productFamily: item.productFamily,
    feature: item.feature,
    featureVersion: item.featureVersion,
    interval: item.interval,
    intervalMs: item.intervalMs,
    state: item.state,
    terminal: item.terminal,
    requestedStartTimeMs: item.requestedStartTimeMs,
    effectiveStartTimeMs: item.effectiveStartTimeMs,
    targetEndTimeMs: item.targetEndTimeMs,
    coverageEndTimeMs: item.coverageEndTimeMs,
    cursorTimeMs: item.cursorTimeMs,
    listedAtMs: item.listedAtMs,
    delistedAtMs: item.delistedAtMs,
    listingState: item.listingState,
    minimumSamples: item.minimumSamples,
    maximumPossibleSamples: item.maximumPossibleSamples,
    acceptedRecordCount: item.acceptedRecordCount,
    excludedIncompleteCount: item.excludedIncompleteCount,
    duplicateRecordCount: item.duplicateRecordCount,
    gapCount: item.gapCount,
    pageCount: item.pageCount,
    batchCount: item.batchCount,
    dispatchCount: item.dispatchCount,
    estimatedWeight: item.estimatedWeight,
    actualWeight: item.actualWeight,
    retryCount: item.retryCount,
    retryAtMs: item.retryAtMs,
    lastCompletedCloseTimeMs: item.lastCompletedCloseTimeMs,
    lastBatchId: item.lastBatchId,
    lastReasonCode: item.lastReasonCode,
    lastMessage: item.lastMessage,
  });
}

function itemNaturalIdentity(input: BaselinePlanItemInput): Readonly<Record<string, unknown>> {
  return {
    symbol: input.symbol,
    instrumentId: input.instrumentId,
    productFamily: input.productFamily,
    feature: input.feature,
    featureVersion: input.featureVersion,
    interval: input.interval,
    requestedStartTimeMs: input.requestedStartTimeMs,
    targetEndTimeMs: input.targetEndTimeMs,
    minimumSamples: input.minimumSamples,
    listedAtMs: input.listedAtMs,
    delistedAtMs: input.delistedAtMs,
    listingState: input.listingState,
  };
}

function validatePlanItem(
  input: BaselinePlanItemInput,
  config: Readonly<BaselineBootstrapConfig>,
): InternalItem {
  const symbol = boundedString(input?.symbol, 'symbol', config.maximumSymbolLength);
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(symbol)) throw new TypeError('symbol must use the authoritative uppercase exchange identity');
  const instrumentId = boundedString(input.instrumentId, 'instrumentId', config.maximumIdentityLength);
  const feature = boundedString(input.feature, 'feature', config.maximumIdentityLength);
  const featureVersion = boundedString(input.featureVersion, 'featureVersion', config.maximumIdentityLength);
  if (input.productFamily !== 'SPOT' && input.productFamily !== 'USD_M_PERPETUAL') {
    throw new TypeError('baseline history supports only public SPOT and USD_M_PERPETUAL products');
  }
  if (!(BASELINE_FIXED_INTERVALS as readonly string[]).includes(input.interval)) {
    throw new TypeError('baseline interval must be a supported fixed interval of at least one minute');
  }
  const intervalMs = intervalMilliseconds(input.interval);
  const requestedStartTimeMs = safeInteger(input.requestedStartTimeMs, 'requestedStartTimeMs');
  const targetEndTimeMs = safeInteger(input.targetEndTimeMs, 'targetEndTimeMs', 1);
  if (targetEndTimeMs <= requestedStartTimeMs) throw new RangeError('targetEndTimeMs must be after requestedStartTimeMs');
  const minimumSamples = safeInteger(input.minimumSamples, 'minimumSamples', 1, config.maximumRecordsPerItem);
  const listedAtMs = input.listedAtMs === null ? null : safeInteger(input.listedAtMs, 'listedAtMs');
  const delistedAtMs = input.delistedAtMs === null ? null : safeInteger(input.delistedAtMs, 'delistedAtMs');
  if (listedAtMs !== null && delistedAtMs !== null && delistedAtMs < listedAtMs) {
    throw new RangeError('delistedAtMs must not precede listedAtMs');
  }
  if (!['ACTIVE', 'DELISTED', 'UNAVAILABLE', 'UNKNOWN'].includes(input.listingState)) {
    throw new TypeError('listingState is invalid');
  }
  const effectiveStartTimeMs = alignBaselineIntervalUp(
    Math.max(requestedStartTimeMs, listedAtMs ?? 0),
    input.interval,
  );
  const coverageEndTimeMs = alignBaselineIntervalDown(targetEndTimeMs, input.interval);
  const maximumPossibleSamples = coverageEndTimeMs <= effectiveStartTimeMs
    ? 0
    : (coverageEndTimeMs - effectiveStartTimeMs) / intervalMs;
  const id = stableId('baseline-plan-item', itemNaturalIdentity(input));
  let state: BaselineBootstrapState = 'PENDING';
  let terminal = false;
  let lastReasonCode = 'BASELINE_PENDING';
  let lastMessage = 'completed public history has not been requested';
  if (input.listingState === 'DELISTED' || input.listingState === 'UNAVAILABLE' || delistedAtMs !== null) {
    state = 'UNAVAILABLE';
    terminal = true;
    lastReasonCode = input.listingState === 'DELISTED' || delistedAtMs !== null
      ? 'LISTING_DELISTED'
      : 'LISTING_UNAVAILABLE';
    lastMessage = 'authoritative listing metadata does not permit a public history bootstrap';
  } else if (maximumPossibleSamples < minimumSamples) {
    state = 'INSUFFICIENT_HISTORY';
    terminal = true;
    lastReasonCode = 'LISTING_AGE_INSUFFICIENT';
    lastMessage = 'listing age cannot satisfy the requested minimum completed sample count';
  }
  return {
    id,
    symbol,
    instrumentId,
    productFamily: input.productFamily,
    feature,
    featureVersion,
    interval: input.interval,
    intervalMs,
    requestedStartTimeMs,
    effectiveStartTimeMs,
    targetEndTimeMs,
    coverageEndTimeMs,
    listedAtMs,
    delistedAtMs,
    listingState: input.listingState,
    minimumSamples,
    maximumPossibleSamples,
    state,
    terminal,
    cursorTimeMs: effectiveStartTimeMs,
    acceptedRecordCount: 0,
    excludedIncompleteCount: 0,
    duplicateRecordCount: 0,
    gapCount: 0,
    pageCount: 0,
    batchCount: 0,
    dispatchCount: 0,
    estimatedWeight: 0,
    actualWeight: 0,
    retryCount: 0,
    retryAtMs: null,
    lastCompletedCloseTimeMs: null,
    lastBatchId: null,
    lastReasonCode,
    lastMessage,
  };
}

function buildPlan(
  input: BaselineBootstrapPlanInput,
  config: Readonly<BaselineBootstrapConfig>,
): { plan: InternalPlan; items: InternalItem[] } {
  if (!input || !Array.isArray(input.items)) throw new TypeError('baseline bootstrap plan is required');
  const name = boundedString(input.name, 'plan name', config.maximumIdentityLength);
  const version = boundedString(input.version, 'plan version', config.maximumIdentityLength);
  if (input.items.length === 0 || input.items.length > config.maximumPlanItems) {
    throw new RangeError(`plan items must contain between 1 and ${config.maximumPlanItems} entries`);
  }
  const items = input.items.map((item) => validatePlanItem(item, config))
    .sort((left, right) => codePointCompare(left.id, right.id));
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new TypeError('baseline plan contains duplicate item identities');
  const id = stableId('baseline-bootstrap-plan', {
    name,
    version,
    configurationVersion: config.configurationVersion,
    itemIds: ids,
  });
  return { plan: Object.freeze({ id, name, version }), items };
}

export class BaselineBootstrapScheduler {
  readonly #options: BaselineBootstrapSchedulerOptions;
  readonly #config: Readonly<BaselineBootstrapConfig>;
  #plan: InternalPlan | null = null;
  #items: InternalItem[] = [];
  #snapshot: BaselineSchedulerSnapshot | null = null;
  #initialization: Promise<BaselineSchedulerSnapshot> | null = null;
  #tickPromise: Promise<BaselineSchedulerSnapshot> | null = null;
  #tickFingerprint: string | null = null;
  #lastClockTimeMs: number | null = null;
  #restored = false;
  #activeFetchCount = 0;
  #focusedDispatchStreak = 0;
  #dispatchSequence = 0;
  #deadlineSequence = 0;
  #totals: CheckpointTotals = { estimatedWeight: 0, actualWeight: 0, batches: 0 };

  constructor(options: BaselineBootstrapSchedulerOptions) {
    if (typeof options?.clock?.nowMs !== 'function') throw new TypeError('runtime clock is required');
    if (typeof options?.history?.fetch !== 'function') throw new TypeError('history port is required');
    if (typeof options?.deadlineScheduler?.schedule !== 'function'
      || typeof options?.deadlineScheduler?.cancel !== 'function') {
      throw new TypeError('baseline deadline scheduler is required');
    }
    if (typeof options?.weightBudget?.reserve !== 'function' || typeof options?.weightBudget?.settle !== 'function') {
      throw new TypeError('REST weight budget port is required');
    }
    if (typeof options?.checkpoint?.load !== 'function' || typeof options?.checkpoint?.save !== 'function') {
      throw new TypeError('baseline checkpoint port is required');
    }
    if (typeof options?.sink?.write !== 'function') throw new TypeError('baseline sink is required');
    this.#options = options;
    this.#config = createBaselineBootstrapConfig(options.config);
  }

  initialize(input: BaselineBootstrapPlanInput): Promise<BaselineSchedulerSnapshot> {
    if (this.#snapshot !== null) return Promise.reject(new Error('baseline scheduler is already initialized'));
    if (this.#initialization !== null) return this.#initialization;
    const promise = this.#initialize(input).finally(() => {
      if (this.#initialization === promise) this.#initialization = null;
    });
    this.#initialization = promise;
    return promise;
  }

  snapshot(): BaselineSchedulerSnapshot | null {
    return this.#snapshot;
  }

  tick(input: BaselineTickInput = {}): Promise<BaselineSchedulerSnapshot> {
    if (this.#plan === null || this.#snapshot === null) {
      return Promise.reject(new Error('baseline scheduler must be initialized before tick'));
    }
    const focused = this.#focusedSymbols(input.focusedSymbols ?? []);
    const fingerprint = stableId('baseline-tick-focus', { symbols: [...focused].sort(codePointCompare) });
    if (this.#tickPromise !== null) {
      if (fingerprint !== this.#tickFingerprint) {
        return Promise.reject(new Error('a baseline tick with different focus input is already in flight'));
      }
      return this.#tickPromise;
    }
    const promise = this.#runTick(focused).finally(() => {
      if (this.#tickPromise === promise) {
        this.#tickPromise = null;
        this.#tickFingerprint = null;
      }
    });
    this.#tickFingerprint = fingerprint;
    this.#tickPromise = promise;
    return promise;
  }

  async #initialize(input: BaselineBootstrapPlanInput): Promise<BaselineSchedulerSnapshot> {
    const nowMs = this.#now();
    const built = buildPlan(input, this.#config);
    const loaded = await this.#options.checkpoint.load(built.plan.id);
    this.#plan = built.plan;
    this.#items = built.items;
    if (loaded !== null) {
      this.#restore(loaded, nowMs);
      this.#restored = true;
    }
    this.#render(nowMs);
    return this.#snapshot as BaselineSchedulerSnapshot;
  }

  #now(): number {
    const nowMs = safeInteger(this.#options.clock.nowMs(), 'clock.nowMs');
    if (this.#lastClockTimeMs !== null && nowMs < this.#lastClockTimeMs) {
      throw new RangeError('baseline scheduler clock regressed');
    }
    this.#lastClockTimeMs = nowMs;
    return nowMs;
  }

  #fetchWithDeadline(dispatch: Dispatch): Promise<FetchOutcome> {
    const timeoutMs = this.#config.historyRequestTimeoutMs;
    const dispatchStartedAtMs = this.#now();
    const deadlineAtMs = checkedAdd(dispatchStartedAtMs, timeoutMs, 'history request deadline');
    this.#deadlineSequence = checkedAdd(this.#deadlineSequence, 1, 'history deadline sequence');
    const deadlineId = stableId('baseline-history-deadline', {
      requestId: dispatch.request.requestId,
      sequence: this.#deadlineSequence,
    });
    const controller = new AbortController();
    return new Promise((resolve) => {
      let settled = false;
      const settle = (
        completionKind: FetchOutcome['completionKind'],
        result: Readonly<HistoryFetchResult> | null,
        completedAtMs: number,
      ): void => {
        if (settled) return;
        settled = true;
        try { this.#options.deadlineScheduler.cancel(deadlineId); } catch { /* completed outcome remains authoritative */ }
        resolve(Object.freeze({ dispatch, result, completionKind, completedAtMs }));
      };
      const expire = (): void => {
        if (settled) return;
        settled = true;
        try { this.#options.deadlineScheduler.cancel(deadlineId); } catch { /* timeout remains authoritative */ }
        controller.abort('HISTORY_FETCH_TIMEOUT');
        resolve(Object.freeze({
          dispatch,
          result: null,
          completionKind: 'TIMEOUT' as const,
          completedAtMs: this.#now(),
        }));
      };
      try {
        this.#options.deadlineScheduler.schedule(deadlineId, timeoutMs, expire);
      } catch {
        settle('PORT_THROW', null, this.#now());
        return;
      }
      let operation: Promise<Readonly<HistoryFetchResult>>;
      try {
        operation = this.#options.history.fetch(dispatch.request, {
          method: 'GET',
          signal: controller.signal,
          deadlineAtMs,
        });
      } catch {
        settle('PORT_THROW', null, this.#now());
        return;
      }
      Promise.resolve(operation).then(
        (result) => {
          if (!settled) settle('RESULT', result, this.#now());
        },
        () => {
          if (!settled) settle('PORT_THROW', null, this.#now());
        },
      );
    });
  }

  #render(nowMs: number): void {
    const plan = this.#plan;
    if (plan === null) throw new Error('baseline plan is unavailable');
    const items = this.#items.map(immutableItem);
    const totals = Object.freeze({
      items: items.length,
      acceptedRecords: items.reduce((sum, item) => checkedAdd(sum, item.acceptedRecordCount, 'accepted record total'), 0),
      excludedIncompleteRecords: items.reduce((sum, item) => checkedAdd(sum, item.excludedIncompleteCount, 'incomplete record total'), 0),
      duplicateRecords: items.reduce((sum, item) => checkedAdd(sum, item.duplicateRecordCount, 'duplicate record total'), 0),
      detectedGaps: items.reduce((sum, item) => checkedAdd(sum, item.gapCount, 'gap total'), 0),
      pages: items.reduce((sum, item) => checkedAdd(sum, item.pageCount, 'page total'), 0),
      batches: this.#totals.batches,
      estimatedWeight: this.#totals.estimatedWeight,
      actualWeight: this.#totals.actualWeight,
    });
    const material = {
      planId: plan.id,
      configurationVersion: this.#config.configurationVersion,
      snapshotTimeMs: nowMs,
      focusedDispatchStreak: this.#focusedDispatchStreak,
      dispatchSequence: this.#dispatchSequence,
      activeFetchCount: this.#activeFetchCount,
      totals,
      items,
    };
    this.#snapshot = deepFreeze({
      id: stableId('baseline-scheduler-snapshot', material),
      planId: plan.id,
      planName: plan.name,
      planVersion: plan.version,
      configurationVersion: this.#config.configurationVersion,
      snapshotTimeMs: nowMs,
      restored: this.#restored,
      activeFetchCount: this.#activeFetchCount,
      maximumParallelism: this.#config.maximumParallelism,
      focusedDispatchStreak: this.#focusedDispatchStreak,
      dispatchSequence: this.#dispatchSequence,
      integrationGap: BASELINE_HISTORY_INTEGRATION_GAP,
      stateCounts: stateCounts(this.#items),
      totals,
      items,
    });
  }

  async #runTick(focused: ReadonlySet<string>): Promise<BaselineSchedulerSnapshot> {
    const nowMs = this.#now();
    const focusedDispatchStreakBefore = this.#focusedDispatchStreak;
    const dispatchSequenceBefore = this.#dispatchSequence;
    const estimatedWeightBefore = this.#totals.estimatedWeight;
    let changed = this.#recoverOrPrepareItems(nowMs);
    const dispatches: Dispatch[] = [];
    const considered = new Set<string>();
    while (dispatches.length < this.#config.maximumParallelism) {
      const item = this.#chooseCandidate(nowMs, focused, considered);
      if (item === null) break;
      considered.add(item.id);
      const isFocused = focused.has(item.symbol);
      if (isFocused) {
        this.#focusedDispatchStreak = Math.min(
          this.#config.focusedBurstLimit,
          this.#focusedDispatchStreak + 1,
        );
      }
      else this.#focusedDispatchStreak = 0;
      const request = this.#requestFor(item, nowMs);
      let reservation: RestWeightReservation;
      try {
        reservation = await this.#options.weightBudget.reserve({
          planId: request.planId,
          planItemId: request.planItemId,
          requestId: request.requestId,
          productFamily: request.productFamily,
          estimatedWeight: request.estimatedWeight,
          observedAtMs: nowMs,
        });
      } catch {
        this.#applyRetry(item, nowMs, null, 'WEIGHT_BUDGET_PORT_FAILURE', 'REST weight budget reservation failed');
        changed = true;
        continue;
      }
      if (!isPlainRecord(reservation) || (reservation.kind !== 'GRANTED' && reservation.kind !== 'RATE_LIMITED')) {
        this.#applyRetry(item, nowMs, null, 'INVALID_WEIGHT_RESERVATION', 'REST weight budget returned an invalid reservation');
        changed = true;
        continue;
      }
      if (reservation.kind === 'RATE_LIMITED') {
        let retryAtMs: number;
        let reasonCode: string;
        try {
          retryAtMs = safeInteger(reservation.retryAtMs, 'budget retryAtMs');
          reasonCode = boundedString(reservation.reasonCode, 'budget reasonCode', this.#config.maximumMessageLength);
        } catch {
          this.#applyRetry(item, nowMs, null, 'INVALID_WEIGHT_RESERVATION', 'REST weight budget returned an invalid deferral');
          changed = true;
          continue;
        }
        item.state = 'RATE_LIMITED';
        item.terminal = false;
        item.retryAtMs = retryAtMs > nowMs ? retryAtMs : checkedAdd(nowMs, this.#config.retryBaseDelayMs, 'budget retry time');
        item.lastReasonCode = reasonCode;
        item.lastMessage = 'REST request-weight budget did not grant this page';
        changed = true;
        continue;
      }
      let reservationId: string;
      try {
        reservationId = boundedString(reservation.reservationId, 'reservationId', this.#config.maximumIdentityLength);
      } catch {
        this.#applyRetry(item, nowMs, null, 'INVALID_WEIGHT_RESERVATION', 'REST weight budget returned an invalid grant');
        changed = true;
        continue;
      }
      item.state = 'FETCHING';
      item.terminal = false;
      item.retryAtMs = null;
      item.dispatchCount = checkedAdd(item.dispatchCount, 1, 'dispatch count');
      item.estimatedWeight = checkedAdd(item.estimatedWeight, request.estimatedWeight, 'item estimated weight');
      item.lastReasonCode = 'HISTORY_FETCH_IN_FLIGHT';
      item.lastMessage = 'completed public history page is in flight';
      this.#dispatchSequence = checkedAdd(this.#dispatchSequence, 1, 'dispatch sequence');
      this.#totals.estimatedWeight = checkedAdd(this.#totals.estimatedWeight, request.estimatedWeight, 'estimated weight total');
      dispatches.push({ item, request, reservationId });
      changed = true;
    }
    this.#activeFetchCount = dispatches.length;
    this.#render(nowMs);
    if (changed) {
      try {
        await this.#persist(nowMs);
      } catch (error) {
        let releaseFailed = false;
        for (const dispatch of dispatches) {
          try {
            await this.#options.weightBudget.settle({
              reservationId: dispatch.reservationId,
              planId: dispatch.request.planId,
              planItemId: dispatch.request.planItemId,
              requestId: dispatch.request.requestId,
              estimatedWeight: dispatch.request.estimatedWeight,
              actualWeight: 0,
              outcome: 'DISPATCH_ABORTED',
              observedAtMs: nowMs,
            });
          } catch {
            releaseFailed = true;
          }
          dispatch.item.dispatchCount -= 1;
          dispatch.item.estimatedWeight -= dispatch.request.estimatedWeight;
          if (dispatch.item.dispatchCount < 0 || dispatch.item.estimatedWeight < 0) {
            throw new Error('aborted dispatch accounting underflow');
          }
          this.#applyRetry(
            dispatch.item,
            nowMs,
            null,
            releaseFailed ? 'DISPATCH_ABORT_RELEASE_FAILED' : 'DISPATCH_CHECKPOINT_FAILED',
            releaseFailed
              ? 'pre-fetch checkpoint failed and the granted weight reservation could not be released'
              : 'pre-fetch checkpoint failed; the granted weight reservation was released without network work',
          );
        }
        this.#focusedDispatchStreak = focusedDispatchStreakBefore;
        this.#dispatchSequence = dispatchSequenceBefore;
        this.#totals.estimatedWeight = estimatedWeightBefore;
        this.#activeFetchCount = 0;
        this.#render(nowMs);
        throw error;
      }
    }
    if (dispatches.length === 0) return this.#snapshot as BaselineSchedulerSnapshot;

    const outcomes = await Promise.all(dispatches.map((dispatch) => this.#fetchWithDeadline(dispatch)));
    let firstOutcomeError: unknown = null;
    let knowledgeTimeMs = nowMs;
    for (const outcome of outcomes) {
      // Promise.all preserves dispatch order, not completion order. Keep one
      // monotonic knowledge watermark so a later-completing outcome cannot be
      // followed by an earlier snapshot, checkpoint, freshness decision, or
      // retry merely because its sibling occupied an earlier array position.
      knowledgeTimeMs = Math.max(knowledgeTimeMs, outcome.completedAtMs);
      try {
        await this.#applyOutcome(outcome, knowledgeTimeMs);
      } catch (error) {
        firstOutcomeError ??= error;
      } finally {
        this.#activeFetchCount -= 1;
        this.#render(knowledgeTimeMs);
      }
      try {
        await this.#persist(knowledgeTimeMs);
      } catch (error) {
        firstOutcomeError ??= error;
      }
    }
    this.#activeFetchCount = 0;
    this.#render(knowledgeTimeMs);
    if (firstOutcomeError !== null) throw firstOutcomeError;
    return this.#snapshot as BaselineSchedulerSnapshot;
  }

  #focusedSymbols(symbols: readonly string[]): ReadonlySet<string> {
    if (!Array.isArray(symbols) || symbols.length > this.#config.maximumPlanItems) {
      throw new RangeError('focusedSymbols exceeds the bounded plan size');
    }
    const output = new Set<string>();
    for (const symbol of symbols) {
      output.add(boundedString(symbol, 'focused symbol', this.#config.maximumSymbolLength));
    }
    return output;
  }

  #recoverOrPrepareItems(nowMs: number): boolean {
    let changed = false;
    for (const item of this.#items) {
      if (item.state === 'FETCHING') {
        item.state = item.acceptedRecordCount > 0 ? 'PARTIAL' : 'PENDING';
        item.terminal = false;
        item.retryAtMs = null;
        item.lastReasonCode = 'RECOVERED_IN_FLIGHT_CHECKPOINT';
        item.lastMessage = 'an uncommitted in-flight page was requeued with its stable request identity';
        changed = true;
      }
      if (item.terminal) continue;
      if (item.acceptedRecordCount >= this.#config.maximumRecordsPerItem
        || item.pageCount >= this.#config.maximumPagesPerItem) {
        item.state = 'PARTIAL';
        item.terminal = true;
        item.retryAtMs = null;
        item.lastReasonCode = 'BASELINE_BOUND_REACHED';
        item.lastMessage = 'bounded page or record capacity was reached before the target history completed';
        changed = true;
        continue;
      }
      if (item.cursorTimeMs >= item.coverageEndTimeMs) {
        this.#finalize(item, nowMs);
        changed = true;
        continue;
      }
      const availableEndTimeMs = this.#availableEnd(item, nowMs);
      if (item.cursorTimeMs >= availableEndTimeMs) {
        const retryAtMs = checkedAdd(item.cursorTimeMs, item.intervalMs, 'next completed candle time');
        if (item.retryAtMs !== retryAtMs || (item.state !== 'PENDING' && item.state !== 'PARTIAL')) changed = true;
        item.state = item.acceptedRecordCount > 0 ? 'PARTIAL' : 'PENDING';
        item.terminal = false;
        item.retryAtMs = retryAtMs;
        item.lastReasonCode = 'WAITING_FOR_COMPLETED_CANDLE';
        item.lastMessage = 'the next target candle has not completed at the injected tick time';
      }
    }
    return changed;
  }

  #availableEnd(item: InternalItem, nowMs: number): number {
    return alignBaselineIntervalDown(Math.min(item.targetEndTimeMs, nowMs), item.interval);
  }

  #chooseCandidate(
    nowMs: number,
    focused: ReadonlySet<string>,
    considered: ReadonlySet<string>,
  ): InternalItem | null {
    const candidates = this.#items.filter((item) => (
      !item.terminal
      && item.state !== 'FETCHING'
      && !considered.has(item.id)
      && (item.retryAtMs === null || item.retryAtMs <= nowMs)
      && item.cursorTimeMs < this.#availableEnd(item, nowMs)
    ));
    candidates.sort((left, right) => (
      left.dispatchCount - right.dispatchCount
      || left.pageCount - right.pageCount
      || codePointCompare(left.id, right.id)
    ));
    const focusedCandidates = candidates.filter((item) => focused.has(item.symbol));
    const universeCandidates = candidates.filter((item) => !focused.has(item.symbol));
    if (focusedCandidates.length > 0 && universeCandidates.length > 0) {
      return this.#focusedDispatchStreak >= this.#config.focusedBurstLimit
        ? universeCandidates[0]
        : focusedCandidates[0];
    }
    return focusedCandidates[0] ?? universeCandidates[0] ?? null;
  }

  #requestFor(item: InternalItem, nowMs: number): Readonly<HistoryFetchRequest> {
    const plan = this.#plan;
    if (plan === null) throw new Error('baseline plan is unavailable');
    const availableEndTimeMs = this.#availableEnd(item, nowMs);
    if (availableEndTimeMs <= item.cursorTimeMs) throw new Error('no completed candle is currently requestable');
    const remainingCapacity = this.#config.maximumRecordsPerItem - item.acceptedRecordCount;
    const availableSamples = (availableEndTimeMs - item.cursorTimeMs) / item.intervalMs;
    // When the plan target is ahead of the injected clock, permit one extra
    // tuple so an adapter may return Binance's current candle. The parser will
    // count and exclude it strictly; it can never reach the sink.
    const potentialCurrentCandle = item.targetEndTimeMs > nowMs ? 1 : 0;
    const limit = Math.min(
      this.#config.pageLimit,
      remainingCapacity,
      availableSamples + potentialCurrentCandle,
    );
    safeInteger(limit, 'history page limit', 1, this.#config.pageLimit);
    const source = BASELINE_HISTORY_SOURCES[item.productFamily];
    const endTimeMs = Math.min(item.targetEndTimeMs - 1, nowMs);
    const estimatedWeight = estimateKlineRequestWeight(item.productFamily, limit);
    const identity = {
      planId: plan.id,
      planItemId: item.id,
      sourceId: source.sourceId,
      startTimeMs: item.cursorTimeMs,
      endTimeMs,
      limit,
      interval: item.interval,
      featureVersion: item.featureVersion,
    };
    return Object.freeze({
      requestId: stableId('baseline-history-request', identity),
      planId: plan.id,
      planItemId: item.id,
      sourceId: source.sourceId,
      productFamily: item.productFamily,
      symbol: item.symbol,
      instrumentId: item.instrumentId,
      feature: item.feature,
      featureVersion: item.featureVersion,
      interval: item.interval,
      intervalMs: item.intervalMs,
      baseUrl: source.baseUrl,
      path: source.path,
      credentials: source.credentials,
      startTimeMs: item.cursorTimeMs,
      endTimeMs,
      limit,
      estimatedWeight,
      tickNowMs: nowMs,
    });
  }

  async #applyOutcome(outcome: FetchOutcome, knowledgeTimeMs: number): Promise<void> {
    const { dispatch } = outcome;
    const rawResult = outcome.result;
    const timedOut = outcome.completionKind === 'TIMEOUT';
    const portThrew = outcome.completionKind === 'PORT_THROW';
    const validKinds = ['SUCCESS', 'RATE_LIMITED', 'TRANSIENT_FAILURE', 'UNAVAILABLE'] as const;
    const validResultShape = rawResult !== null
      && isPlainRecord(rawResult)
      && typeof rawResult.kind === 'string'
      && (validKinds as readonly string[]).includes(rawResult.kind);
    let invalidAccounting = false;
    let actualWeight = 0;
    let observedAtMs = knowledgeTimeMs;
    if (validResultShape) {
      try {
        actualWeight = safeInteger(rawResult.actualWeight, 'actualWeight', 0, 1_000_000);
        const candidateObservedAtMs = rawResult.kind === 'SUCCESS'
          ? safeInteger(rawResult.receiveTimeMs, 'receiveTimeMs')
          : safeInteger(rawResult.observedAtMs, 'observedAtMs');
        if (candidateObservedAtMs < dispatch.request.tickNowMs || candidateObservedAtMs > outcome.completedAtMs) {
          throw new RangeError('history result observation time must fall between dispatch and completion');
        }
        observedAtMs = candidateObservedAtMs;
      } catch {
        invalidAccounting = true;
        observedAtMs = knowledgeTimeMs;
      }
    }
    const settlementOutcome = timedOut
      ? 'TIMEOUT'
      : portThrew || !validResultShape || invalidAccounting
        ? 'PORT_THROW'
        : rawResult.kind as HistoryFetchResult['kind'];
    this.#totals.actualWeight = checkedAdd(this.#totals.actualWeight, actualWeight, 'actual weight total');
    dispatch.item.actualWeight = checkedAdd(dispatch.item.actualWeight, actualWeight, 'item actual weight');
    try {
      await this.#options.weightBudget.settle({
        reservationId: dispatch.reservationId,
        planId: dispatch.request.planId,
        planItemId: dispatch.request.planItemId,
        requestId: dispatch.request.requestId,
        estimatedWeight: dispatch.request.estimatedWeight,
        actualWeight,
        outcome: settlementOutcome,
        observedAtMs,
      });
    } catch {
      this.#applyRetry(dispatch.item, knowledgeTimeMs, null, 'WEIGHT_SETTLEMENT_FAILURE', 'REST weight settlement failed after the history request');
      return;
    }
    if (timedOut) {
      this.#applyRetry(
        dispatch.item,
        knowledgeTimeMs,
        null,
        'HISTORY_FETCH_TIMEOUT',
        'public history fetch exceeded its deterministic deadline',
      );
      return;
    }
    if (portThrew || rawResult === null) {
      this.#applyRetry(dispatch.item, knowledgeTimeMs, null, 'HISTORY_PORT_FAILURE', 'history port threw while fetching public completed candles');
      return;
    }
    if (!validResultShape || invalidAccounting) {
      this.#applyRetry(dispatch.item, knowledgeTimeMs, null, 'INVALID_HISTORY_RESULT', 'history port returned an invalid result');
      return;
    }
    if (rawResult.kind === 'RATE_LIMITED') {
      let retryAtMs: number;
      try {
        retryAtMs = safeInteger(rawResult.retryAtMs, 'history retryAtMs');
      } catch {
        this.#applyRetry(dispatch.item, knowledgeTimeMs, null, 'INVALID_HISTORY_RESULT', 'rate-limited history result is missing a valid retry time');
        return;
      }
      dispatch.item.state = 'RATE_LIMITED';
      dispatch.item.terminal = false;
      dispatch.item.retryAtMs = retryAtMs > knowledgeTimeMs
        ? retryAtMs
        : checkedAdd(knowledgeTimeMs, this.#config.retryBaseDelayMs, 'history rate-limit retry time');
      dispatch.item.lastReasonCode = 'HISTORY_SOURCE_RATE_LIMITED';
      dispatch.item.lastMessage = normalizeMessage(rawResult.message, this.#config.maximumMessageLength, 'history source rate limited');
      return;
    }
    if (rawResult.kind === 'TRANSIENT_FAILURE') {
      let requestedRetry: number | null;
      try {
        requestedRetry = rawResult.retryAtMs === null ? null : safeInteger(rawResult.retryAtMs, 'history transient retryAtMs');
      } catch {
        this.#applyRetry(dispatch.item, knowledgeTimeMs, null, 'INVALID_HISTORY_RESULT', 'transient history result has an invalid retry time');
        return;
      }
      this.#applyRetry(
        dispatch.item,
        knowledgeTimeMs,
        requestedRetry,
        'HISTORY_TRANSIENT_FAILURE',
        normalizeMessage(rawResult.message, this.#config.maximumMessageLength, 'transient public history failure'),
      );
      return;
    }
    if (rawResult.kind === 'UNAVAILABLE') {
      dispatch.item.state = dispatch.item.acceptedRecordCount > 0 ? 'PARTIAL' : 'UNAVAILABLE';
      dispatch.item.terminal = true;
      dispatch.item.retryAtMs = null;
      dispatch.item.lastReasonCode = 'HISTORY_UNAVAILABLE';
      dispatch.item.lastMessage = normalizeMessage(rawResult.message, this.#config.maximumMessageLength, 'public history unavailable');
      return;
    }
    await this.#applySuccess(dispatch, rawResult, knowledgeTimeMs);
  }

  async #applySuccess(
    dispatch: Dispatch,
    result: Extract<HistoryFetchResult, { kind: 'SUCCESS' }>,
    knowledgeTimeMs: number,
  ): Promise<void> {
    if (typeof result.hasMore !== 'boolean' || !Array.isArray(result.rows)) {
      this.#applyRetry(dispatch.item, knowledgeTimeMs, null, 'INVALID_HISTORY_RESULT', 'successful history result has an invalid page shape');
      return;
    }
    let page;
    try {
      page = parseCompletedKlinePage(dispatch.request, result.rows, result.receiveTimeMs);
    } catch (error) {
      const reasonCode = error instanceof BaselineHistoryPageError ? error.code : 'INVALID_HISTORY_PAGE';
      this.#applyRetry(dispatch.item, knowledgeTimeMs, null, reasonCode, 'public history page failed strict kline validation');
      return;
    }
    const item = dispatch.item;
    if (result.hasMore && page.records.length === 0) {
      if (page.excludedIncompleteCount > 0 && item.cursorTimeMs >= this.#availableEnd(item, knowledgeTimeMs)) {
        item.state = item.acceptedRecordCount > 0 ? 'PARTIAL' : 'PENDING';
        item.terminal = false;
        item.retryAtMs = checkedAdd(item.cursorTimeMs, item.intervalMs, 'next completed candle time');
        item.excludedIncompleteCount = checkedAdd(item.excludedIncompleteCount, page.excludedIncompleteCount, 'excluded incomplete count');
        item.lastReasonCode = 'INCOMPLETE_CURRENT_CANDLE_EXCLUDED';
        item.lastMessage = 'the current kline was excluded until its close time passes the injected clock';
        return;
      }
      this.#applyRetry(item, knowledgeTimeMs, null, 'HISTORY_PAGE_NO_PROGRESS', 'history source asserted more pages without a completed record');
      return;
    }

    let batch: Readonly<BaselineHistoryBatch> | null = null;
    if (page.records.length > 0) {
      const material = {
        planId: dispatch.request.planId,
        planItemId: item.id,
        requestId: dispatch.request.requestId,
        recordIds: page.records.map((record) => record.id),
        excludedIncompleteCount: page.excludedIncompleteCount,
        detectedGapCount: page.gapCount,
        sourceHasMore: result.hasMore,
        nextCursorTimeMs: page.nextCursorTimeMs,
      };
      batch = deepFreeze({
        id: stableId('baseline-history-batch', material),
        planId: dispatch.request.planId,
        planItemId: item.id,
        requestId: dispatch.request.requestId,
        sourceId: dispatch.request.sourceId,
        feature: item.feature,
        featureVersion: item.featureVersion,
        interval: item.interval,
        requestStartTimeMs: dispatch.request.startTimeMs,
        requestEndTimeMs: dispatch.request.endTimeMs,
        receiveTimeMs: result.receiveTimeMs,
        excludedIncompleteCount: page.excludedIncompleteCount,
        detectedGapCount: page.gapCount,
        sourceHasMore: result.hasMore,
        nextCursorTimeMs: page.nextCursorTimeMs,
        records: page.records,
      });
      try {
        await this.#options.sink.write(batch);
      } catch {
        this.#applyRetry(item, knowledgeTimeMs, null, 'BASELINE_SINK_FAILURE', 'idempotent baseline history sink rejected the completed-candle batch');
        return;
      }
    }

    item.pageCount = checkedAdd(item.pageCount, 1, 'page count');
    item.acceptedRecordCount = checkedAdd(item.acceptedRecordCount, page.records.length, 'accepted record count');
    item.excludedIncompleteCount = checkedAdd(item.excludedIncompleteCount, page.excludedIncompleteCount, 'excluded incomplete count');
    item.duplicateRecordCount = checkedAdd(item.duplicateRecordCount, page.duplicateRecordCount, 'duplicate record count');
    item.gapCount = checkedAdd(item.gapCount, page.gapCount, 'gap count');
    item.retryCount = 0;
    item.retryAtMs = null;
    if (batch !== null) {
      item.lastBatchId = batch.id;
      item.batchCount = checkedAdd(item.batchCount, 1, 'batch count');
      this.#totals.batches = checkedAdd(this.#totals.batches, 1, 'batch total');
    }
    if (page.records.length > 0) {
      item.lastCompletedCloseTimeMs = page.records[page.records.length - 1].closeTimeMs;
      item.cursorTimeMs = page.nextCursorTimeMs;
    }
    const availableEndTimeMs = this.#availableEnd(item, knowledgeTimeMs);
    if (!result.hasMore) {
      if (item.cursorTimeMs < availableEndTimeMs) {
        const trailingGap = (availableEndTimeMs - item.cursorTimeMs) / item.intervalMs;
        if (!Number.isSafeInteger(trailingGap)) throw new Error('history trailing gap is not interval aligned');
        item.gapCount = checkedAdd(item.gapCount, trailingGap, 'gap count');
        item.cursorTimeMs = availableEndTimeMs;
      }
    }
    if (item.acceptedRecordCount >= this.#config.maximumRecordsPerItem
      || item.pageCount >= this.#config.maximumPagesPerItem) {
      if (item.cursorTimeMs >= item.coverageEndTimeMs) this.#finalize(item, knowledgeTimeMs);
      else {
        item.state = 'PARTIAL';
        item.terminal = true;
        item.retryAtMs = null;
        item.lastReasonCode = 'BASELINE_BOUND_REACHED';
        item.lastMessage = 'bounded page or record capacity was reached before the target history completed';
      }
      return;
    }
    if (item.cursorTimeMs >= item.coverageEndTimeMs) {
      this.#finalize(item, knowledgeTimeMs);
      return;
    }
    if (!result.hasMore && availableEndTimeMs >= item.coverageEndTimeMs) {
      this.#finalize(item, knowledgeTimeMs);
      return;
    }
    if (item.cursorTimeMs >= availableEndTimeMs) {
      item.state = item.acceptedRecordCount > 0 ? 'PARTIAL' : 'PENDING';
      item.terminal = false;
      item.retryAtMs = checkedAdd(item.cursorTimeMs, item.intervalMs, 'next completed candle time');
      item.lastReasonCode = page.excludedIncompleteCount > 0
        ? 'INCOMPLETE_CURRENT_CANDLE_EXCLUDED'
        : 'WAITING_FOR_COMPLETED_CANDLE';
      item.lastMessage = page.excludedIncompleteCount > 0
        ? 'the current kline was excluded until its close time passes the injected clock'
        : 'available completed history is caught up to the injected clock';
      return;
    }
    item.state = 'PARTIAL';
    item.terminal = false;
    item.retryAtMs = null;
    item.lastReasonCode = 'HISTORY_PAGE_APPLIED';
    item.lastMessage = 'a bounded completed-candle page was stored and more target history remains';
  }

  #applyRetry(
    item: InternalItem,
    nowMs: number,
    requestedRetryAtMs: number | null,
    reasonCode: string,
    message: string,
  ): void {
    item.retryCount = checkedAdd(item.retryCount, 1, 'retry count');
    item.lastReasonCode = reasonCode;
    item.lastMessage = normalizeMessage(message, this.#config.maximumMessageLength, 'baseline history retry');
    if (item.retryCount > this.#config.retryCeiling) {
      item.state = item.acceptedRecordCount > 0 ? 'PARTIAL' : 'UNAVAILABLE';
      item.terminal = true;
      item.retryAtMs = null;
      item.lastReasonCode = `${reasonCode}_RETRY_EXHAUSTED`;
      item.lastMessage = 'deterministic retry ceiling was exhausted';
      return;
    }
    const localRetryAtMs = checkedAdd(nowMs, retryDelay(this.#config, item.retryCount), 'retry time');
    item.state = 'RETRY_WAIT';
    item.terminal = false;
    item.retryAtMs = requestedRetryAtMs === null ? localRetryAtMs : Math.max(localRetryAtMs, requestedRetryAtMs);
  }

  #finalize(item: InternalItem, nowMs: number): void {
    item.terminal = true;
    item.retryAtMs = null;
    if (item.acceptedRecordCount < item.minimumSamples) {
      item.state = 'INSUFFICIENT_HISTORY';
      item.lastReasonCode = 'COMPLETED_HISTORY_INSUFFICIENT';
      item.lastMessage = 'completed public history did not satisfy the minimum sample count';
      return;
    }
    if (item.gapCount > 0) {
      item.state = 'PARTIAL';
      item.lastReasonCode = 'COMPLETED_HISTORY_HAS_GAPS';
      item.lastMessage = 'public history reached the target with one or more explicit missing intervals';
      return;
    }
    if (item.lastCompletedCloseTimeMs === null) {
      item.state = 'INSUFFICIENT_HISTORY';
      item.lastReasonCode = 'NO_COMPLETED_HISTORY';
      item.lastMessage = 'no completed public candle was stored';
      return;
    }
    if (nowMs - item.lastCompletedCloseTimeMs > this.#config.staleAfterMs) {
      item.state = 'STALE';
      item.lastReasonCode = 'COMPLETED_HISTORY_STALE';
      item.lastMessage = 'latest completed history is older than the configured freshness threshold';
      return;
    }
    item.state = 'COMPLETE';
    item.lastReasonCode = 'BASELINE_HISTORY_COMPLETE';
    item.lastMessage = 'bounded completed public history satisfied the plan';
  }

  #checkpointValue(nowMs: number): JsonValue {
    const plan = this.#plan;
    if (plan === null) throw new Error('baseline plan is unavailable');
    return {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      planId: plan.id,
      configurationVersion: this.#config.configurationVersion,
      savedAtMs: nowMs,
      focusedDispatchStreak: this.#focusedDispatchStreak,
      dispatchSequence: this.#dispatchSequence,
      totals: {
        estimatedWeight: this.#totals.estimatedWeight,
        actualWeight: this.#totals.actualWeight,
        batches: this.#totals.batches,
      },
      items: this.#items.map((item) => ({
        id: item.id,
        state: item.state,
        terminal: item.terminal,
        cursorTimeMs: item.cursorTimeMs,
        acceptedRecordCount: item.acceptedRecordCount,
        excludedIncompleteCount: item.excludedIncompleteCount,
        duplicateRecordCount: item.duplicateRecordCount,
        gapCount: item.gapCount,
        pageCount: item.pageCount,
        batchCount: item.batchCount,
        dispatchCount: item.dispatchCount,
        estimatedWeight: item.estimatedWeight,
        actualWeight: item.actualWeight,
        retryCount: item.retryCount,
        retryAtMs: item.retryAtMs,
        lastCompletedCloseTimeMs: item.lastCompletedCloseTimeMs,
        lastBatchId: item.lastBatchId,
        lastReasonCode: item.lastReasonCode,
        lastMessage: item.lastMessage,
      })),
    };
  }

  async #persist(nowMs: number): Promise<void> {
    const plan = this.#plan;
    if (plan === null) throw new Error('baseline plan is unavailable');
    await this.#options.checkpoint.save(plan.id, this.#checkpointValue(nowMs));
  }

  #restore(value: JsonValue, nowMs: number): void {
    if (!isPlainRecord(value)) throw new TypeError('baseline checkpoint must be a JSON object');
    assertExactKeys(value, [
      'schemaVersion',
      'planId',
      'configurationVersion',
      'savedAtMs',
      'focusedDispatchStreak',
      'dispatchSequence',
      'totals',
      'items',
    ], 'baseline checkpoint');
    const plan = this.#plan;
    if (plan === null) throw new Error('baseline plan is unavailable');
    if (safeInteger(value.schemaVersion, 'checkpoint schemaVersion') !== CHECKPOINT_SCHEMA_VERSION) {
      throw new TypeError('unsupported baseline checkpoint schema version');
    }
    if (value.planId !== plan.id || value.configurationVersion !== this.#config.configurationVersion) {
      throw new TypeError('baseline checkpoint identity does not match the initialized plan');
    }
    const savedAtMs = safeInteger(value.savedAtMs, 'checkpoint savedAtMs');
    if (savedAtMs > nowMs) throw new TypeError('baseline checkpoint was saved in the future');
    const restoredFocusedDispatchStreak = safeInteger(value.focusedDispatchStreak, 'focusedDispatchStreak', 0, this.#config.focusedBurstLimit);
    const restoredDispatchSequence = safeInteger(value.dispatchSequence, 'dispatchSequence');
    if (!isPlainRecord(value.totals)) throw new TypeError('checkpoint totals must be an object');
    assertExactKeys(value.totals, ['estimatedWeight', 'actualWeight', 'batches'], 'checkpoint totals');
    const restoredTotals: CheckpointTotals = {
      estimatedWeight: safeInteger(value.totals.estimatedWeight, 'checkpoint estimatedWeight'),
      actualWeight: safeInteger(value.totals.actualWeight, 'checkpoint actualWeight'),
      batches: safeInteger(value.totals.batches, 'checkpoint batches'),
    };
    if (!Array.isArray(value.items) || value.items.length !== this.#items.length) {
      throw new TypeError('checkpoint items do not match the initialized plan');
    }
    const byId = new Map(this.#items.map((item) => [item.id, item]));
    const restoredIds = new Set<string>();
    const stagedItems: Array<{ item: InternalItem; values: RestoredItemState }> = [];
    for (const raw of value.items) {
      if (!isPlainRecord(raw)) throw new TypeError('checkpoint item must be an object');
      assertExactKeys(raw, [
        'id',
        'state',
        'terminal',
        'cursorTimeMs',
        'acceptedRecordCount',
        'excludedIncompleteCount',
        'duplicateRecordCount',
        'gapCount',
        'pageCount',
        'batchCount',
        'dispatchCount',
        'estimatedWeight',
        'actualWeight',
        'retryCount',
        'retryAtMs',
        'lastCompletedCloseTimeMs',
        'lastBatchId',
        'lastReasonCode',
        'lastMessage',
      ], 'checkpoint item');
      const id = boundedString(raw.id, 'checkpoint item id', this.#config.maximumIdentityLength);
      const item = byId.get(id);
      if (item === undefined || restoredIds.has(id)) throw new TypeError('checkpoint contains an unknown or duplicate item id');
      restoredIds.add(id);
      const state = requiredState(raw.state);
      const terminal = requiredBoolean(raw.terminal, 'checkpoint terminal');
      const cursorTimeMs = safeInteger(
        raw.cursorTimeMs,
        'checkpoint cursorTimeMs',
        item.effectiveStartTimeMs,
        Math.max(item.effectiveStartTimeMs, item.coverageEndTimeMs),
      );
      const acceptedRecordCount = safeInteger(
        raw.acceptedRecordCount,
        'checkpoint acceptedRecordCount',
        0,
        Math.min(this.#config.maximumRecordsPerItem, item.maximumPossibleSamples),
      );
      const maximumPageObservations = this.#config.maximumPagesPerItem * this.#config.pageLimit;
      const excludedIncompleteCount = safeInteger(raw.excludedIncompleteCount, 'checkpoint excludedIncompleteCount', 0, maximumPageObservations);
      const duplicateRecordCount = safeInteger(raw.duplicateRecordCount, 'checkpoint duplicateRecordCount', 0, maximumPageObservations);
      const gapCount = safeInteger(raw.gapCount, 'checkpoint gapCount', 0, item.maximumPossibleSamples);
      const pageCount = safeInteger(raw.pageCount, 'checkpoint pageCount', 0, this.#config.maximumPagesPerItem);
      const batchCount = safeInteger(raw.batchCount, 'checkpoint batchCount', 0, this.#config.maximumPagesPerItem);
      const maximumDispatchCount = checkedMultiply(
        this.#config.maximumPagesPerItem,
        checkedAdd(this.#config.retryCeiling, 1, 'checkpoint retry dispatch multiplier'),
        'checkpoint maximum dispatch count',
      );
      const dispatchCount = safeInteger(raw.dispatchCount, 'checkpoint dispatchCount', 0, maximumDispatchCount);
      const estimatedWeight = safeInteger(raw.estimatedWeight, 'checkpoint item estimatedWeight');
      const actualWeight = safeInteger(raw.actualWeight, 'checkpoint item actualWeight');
      const retryCount = safeInteger(raw.retryCount, 'checkpoint retryCount', 0, this.#config.retryCeiling + 1);
      const retryAtMs = nullableInteger(raw.retryAtMs, 'checkpoint retryAtMs');
      const lastCompletedCloseTimeMs = nullableInteger(raw.lastCompletedCloseTimeMs, 'checkpoint lastCompletedCloseTimeMs');
      const lastBatchId = raw.lastBatchId === null
        ? null
        : boundedString(raw.lastBatchId, 'checkpoint lastBatchId', this.#config.maximumIdentityLength);
      const lastReasonCode = boundedString(raw.lastReasonCode, 'checkpoint lastReasonCode', this.#config.maximumMessageLength);
      const lastMessage = boundedString(raw.lastMessage, 'checkpoint lastMessage', this.#config.maximumMessageLength);
      const normallyTerminal = ['INSUFFICIENT_HISTORY', 'STALE', 'COMPLETE', 'UNAVAILABLE'].includes(state);
      if ((normallyTerminal && !terminal) || (terminal && !normallyTerminal && state !== 'PARTIAL')) {
        throw new TypeError('checkpoint item state/terminal combination is invalid');
      }
      if ((state === 'RATE_LIMITED' || state === 'RETRY_WAIT') && retryAtMs === null) {
        throw new TypeError('checkpoint deferred item is missing retryAtMs');
      }
      if (terminal && retryAtMs !== null) throw new TypeError('terminal checkpoint item cannot have retryAtMs');
      if (lastCompletedCloseTimeMs !== null && lastCompletedCloseTimeMs >= cursorTimeMs) {
        throw new TypeError('checkpoint last completed close must precede its cursor');
      }
      if ((cursorTimeMs - item.effectiveStartTimeMs) % item.intervalMs !== 0) {
        throw new TypeError('checkpoint cursor is not aligned to the plan interval');
      }
      const coveredSamples = Math.max(0, (cursorTimeMs - item.effectiveStartTimeMs) / item.intervalMs);
      if (acceptedRecordCount + gapCount !== coveredSamples) {
        throw new TypeError('checkpoint accepted records and explicit gaps do not reconcile with its cursor');
      }
      if (acceptedRecordCount + gapCount > item.maximumPossibleSamples) {
        throw new TypeError('checkpoint history coverage exceeds the bounded plan');
      }
      if (batchCount > pageCount || pageCount > dispatchCount) {
        throw new TypeError('checkpoint batch/page/dispatch counts are inconsistent');
      }
      if ((acceptedRecordCount > 0) !== (batchCount > 0)
        || (batchCount > 0) !== (lastBatchId !== null)) {
        throw new TypeError('checkpoint accepted records, batches, and last batch identity are inconsistent');
      }
      if ((dispatchCount === 0) !== (estimatedWeight === 0) || (dispatchCount === 0 && actualWeight !== 0)) {
        throw new TypeError('checkpoint dispatch and request-weight accounting are inconsistent');
      }
      const minimumEstimatedWeight = item.productFamily === 'SPOT'
        ? checkedMultiply(dispatchCount, 2, 'checkpoint Spot estimated weight')
        : dispatchCount;
      const maximumEstimatedWeight = checkedMultiply(
        dispatchCount,
        estimateKlineRequestWeight(item.productFamily, this.#config.pageLimit),
        'checkpoint maximum estimated weight',
      );
      const maximumActualWeight = checkedMultiply(dispatchCount, 1_000_000, 'checkpoint maximum actual weight');
      if (estimatedWeight < minimumEstimatedWeight || estimatedWeight > maximumEstimatedWeight
        || actualWeight > maximumActualWeight) {
        throw new TypeError('checkpoint request-weight accounting exceeds dispatch-derived bounds');
      }
      if ((acceptedRecordCount === 0) !== (lastCompletedCloseTimeMs === null)) {
        throw new TypeError('checkpoint accepted records and last completed close are inconsistent');
      }
      if (lastCompletedCloseTimeMs !== null) {
        if (lastCompletedCloseTimeMs < item.effectiveStartTimeMs + item.intervalMs - 1
          || (lastCompletedCloseTimeMs + 1 - item.effectiveStartTimeMs) % item.intervalMs !== 0
          || lastCompletedCloseTimeMs >= savedAtMs) {
          throw new TypeError('checkpoint last completed candle boundary is invalid');
        }
        if (gapCount === 0 && lastCompletedCloseTimeMs !== cursorTimeMs - 1) {
          throw new TypeError('gap-free checkpoint last completed candle does not reach its cursor');
        }
      }
      if (state === 'COMPLETE' || state === 'STALE') {
        if (cursorTimeMs !== item.coverageEndTimeMs
          || acceptedRecordCount < item.minimumSamples
          || gapCount !== 0
          || lastCompletedCloseTimeMs === null) {
          throw new TypeError(`${state} checkpoint does not satisfy terminal history invariants`);
        }
        const staleAtSave = savedAtMs - lastCompletedCloseTimeMs > this.#config.staleAfterMs;
        if ((state === 'COMPLETE' && staleAtSave) || (state === 'STALE' && !staleAtSave)) {
          throw new TypeError(`${state} checkpoint freshness is inconsistent with its saved time`);
        }
      } else if (state === 'INSUFFICIENT_HISTORY') {
        if (acceptedRecordCount >= item.minimumSamples) {
          throw new TypeError('INSUFFICIENT_HISTORY checkpoint already satisfies its minimum sample count');
        }
        const initialInsufficient = dispatchCount === 0
          && pageCount === 0
          && cursorTimeMs === item.effectiveStartTimeMs
          && item.maximumPossibleSamples < item.minimumSamples
          && lastReasonCode === 'LISTING_AGE_INSUFFICIENT';
        const completedInsufficient = dispatchCount > 0
          && cursorTimeMs === item.coverageEndTimeMs
          && (lastReasonCode === 'COMPLETED_HISTORY_INSUFFICIENT' || lastReasonCode === 'NO_COMPLETED_HISTORY');
        if (!initialInsufficient && !completedInsufficient) {
          throw new TypeError('INSUFFICIENT_HISTORY checkpoint lacks a terminal justification');
        }
      } else if (state === 'UNAVAILABLE') {
        if (acceptedRecordCount !== 0) throw new TypeError('UNAVAILABLE checkpoint cannot contain accepted history');
        const initiallyUnavailable = dispatchCount === 0
          && pageCount === 0
          && cursorTimeMs === item.effectiveStartTimeMs
          && (item.listingState === 'DELISTED' || item.listingState === 'UNAVAILABLE' || item.delistedAtMs !== null)
          && (lastReasonCode === 'LISTING_DELISTED' || lastReasonCode === 'LISTING_UNAVAILABLE');
        const fetchedUnavailable = dispatchCount > 0 && lastReasonCode === 'HISTORY_UNAVAILABLE';
        const retryExhausted = dispatchCount > 0
          && retryCount === this.#config.retryCeiling + 1
          && lastReasonCode.endsWith('_RETRY_EXHAUSTED');
        if (!initiallyUnavailable && !fetchedUnavailable && !retryExhausted) {
          throw new TypeError('UNAVAILABLE checkpoint lacks a terminal justification');
        }
      } else if (state === 'PARTIAL') {
        if (acceptedRecordCount === 0) throw new TypeError('PARTIAL checkpoint must contain accepted history');
        if (terminal) {
          const completedWithGaps = cursorTimeMs === item.coverageEndTimeMs
            && gapCount > 0
            && lastReasonCode === 'COMPLETED_HISTORY_HAS_GAPS';
          const bounded = (pageCount >= this.#config.maximumPagesPerItem
              || acceptedRecordCount >= this.#config.maximumRecordsPerItem)
            && lastReasonCode === 'BASELINE_BOUND_REACHED';
          const fetchedUnavailable = dispatchCount > 0 && lastReasonCode === 'HISTORY_UNAVAILABLE';
          const retryExhausted = retryCount === this.#config.retryCeiling + 1
            && lastReasonCode.endsWith('_RETRY_EXHAUSTED');
          if (!completedWithGaps && !bounded && !fetchedUnavailable && !retryExhausted) {
            throw new TypeError('terminal PARTIAL checkpoint lacks a terminal justification');
          }
        }
      }
      let restoredState = state;
      let restoredTerminal = terminal;
      let restoredRetryAtMs = retryAtMs;
      let restoredLastReasonCode = lastReasonCode;
      let restoredLastMessage = lastMessage;
      if (restoredState === 'FETCHING') {
        restoredState = acceptedRecordCount > 0 ? 'PARTIAL' : 'PENDING';
        restoredTerminal = false;
        restoredRetryAtMs = null;
        restoredLastReasonCode = 'RECOVERED_IN_FLIGHT_CHECKPOINT';
        restoredLastMessage = 'an in-flight checkpoint was deterministically requeued';
      }
      if (restoredState === 'COMPLETE'
        && lastCompletedCloseTimeMs !== null
        && nowMs - lastCompletedCloseTimeMs > this.#config.staleAfterMs) {
        restoredState = 'STALE';
        restoredLastReasonCode = 'COMPLETED_HISTORY_STALE_AFTER_RESTORE';
        restoredLastMessage = 'restored completed history aged past the configured freshness threshold';
      }
      stagedItems.push({ item, values: {
        state: restoredState,
        terminal: restoredTerminal,
        cursorTimeMs,
        acceptedRecordCount,
        excludedIncompleteCount,
        duplicateRecordCount,
        gapCount,
        pageCount,
        batchCount,
        dispatchCount,
        estimatedWeight,
        actualWeight,
        retryCount,
        retryAtMs: restoredRetryAtMs,
        lastCompletedCloseTimeMs,
        lastBatchId,
        lastReasonCode: restoredLastReasonCode,
        lastMessage: restoredLastMessage,
      } });
    }
    if (restoredIds.size !== this.#items.length) throw new TypeError('checkpoint does not cover every plan item');
    const itemEstimatedWeight = stagedItems.reduce((sum, entry) => checkedAdd(sum, entry.values.estimatedWeight, 'checkpoint item estimated weight total'), 0);
    const itemActualWeight = stagedItems.reduce((sum, entry) => checkedAdd(sum, entry.values.actualWeight, 'checkpoint item actual weight total'), 0);
    const itemBatches = stagedItems.reduce((sum, entry) => checkedAdd(sum, entry.values.batchCount, 'checkpoint item batch total'), 0);
    const itemDispatches = stagedItems.reduce((sum, entry) => checkedAdd(sum, entry.values.dispatchCount, 'checkpoint item dispatch total'), 0);
    if (restoredTotals.estimatedWeight !== itemEstimatedWeight
      || restoredTotals.actualWeight !== itemActualWeight
      || restoredTotals.batches !== itemBatches
      || restoredDispatchSequence !== itemDispatches) {
      throw new TypeError('checkpoint item accounting does not reconcile with scheduler totals');
    }
    this.#focusedDispatchStreak = restoredFocusedDispatchStreak;
    this.#dispatchSequence = restoredDispatchSequence;
    this.#totals = restoredTotals;
    for (const entry of stagedItems) Object.assign(entry.item, entry.values);
  }
}
