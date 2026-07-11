import {
  SourceLifecycleTracker,
  type PublicWebSocketConnection,
  type PublicWebSocketEvent,
  type PublicWebSocketTransport,
  type RuntimeClock,
  type RuntimeError,
  type RuntimeJitterSource,
  type RuntimeMetricSink,
  type RuntimeSequence,
  type RuntimeSourceDefinition,
  type RuntimeSourceEvent,
  type RuntimeSourceSnapshot,
  type SourceEventSink,
} from '../contracts/index.js';
import {
  DeterministicBackoff,
  type DeterministicBackoffConfig,
} from './backoff.js';
import {
  BoundedProcessingLagMetrics,
  type ProcessingLagSnapshot,
} from './lagMetrics.js';
import {
  BoundedInboundQueue,
  type BoundedQueueSnapshot,
  type InboundQueueMode,
} from './queue.js';
import {
  ControlMessageThrottle,
  type ControlThrottleConfig,
  type ControlThrottleDecision,
  type ControlThrottleSnapshot,
} from './throttle.js';

export interface DecodedRuntimeMessage<T> {
  payload: T;
  stream: string | null;
  sourceEventTimeMs: number | null;
  sourceTransactionTimeMs: number | null;
  sequence: RuntimeSequence | null;
  correlationId: string;
  queueMode: InboundQueueMode;
  coalescingKey: string | null;
}

export interface RuntimeMessageDecodeContext {
  sourceId: string;
  generation: number;
  receiveTimeMs: number;
}

/** Return null for an invalid/unrecognized frame; throwing is also contained. */
export type RuntimeMessageDecoder<T> = (
  data: unknown,
  context: RuntimeMessageDecodeContext,
) => DecodedRuntimeMessage<T> | null;

export interface WebSocketSourceRunnerConfig {
  definition: RuntimeSourceDefinition;
  url: string;
  maximumMessageBytes: number;
  queueCapacity: number;
  openTimeoutMs: number;
  rotationAfterMs: number;
  stableConnectionMs: number;
  backoff: DeterministicBackoffConfig;
  controlThrottle: ControlThrottleConfig;
}

export interface WebSocketSourceRunnerPorts<T> {
  clock: RuntimeClock;
  jitter: RuntimeJitterSource;
  transport: PublicWebSocketTransport;
  decoder: RuntimeMessageDecoder<T>;
  sink?: SourceEventSink<T>;
  metricSink?: RuntimeMetricSink;
  lagMetrics?: BoundedProcessingLagMetrics;
}

export interface ControlSendResult {
  sent: boolean;
  allowed: boolean;
  requested: number;
  remaining: number;
  retryAtMs: number | null;
  reason: ControlThrottleDecision['reason'] | 'NOT_CONNECTED' | 'SEND_FAILED';
}

export interface DrainResult {
  processed: number;
  failed: number;
  remaining: number;
}

export interface WebSocketRunnerSnapshot {
  source: RuntimeSourceSnapshot;
  queue: BoundedQueueSnapshot;
  controlThrottle: ControlThrottleSnapshot;
  lag: ProcessingLagSnapshot;
  connection: {
    connected: boolean;
    lastTransportActivityMs: number | null;
    lastPingAtMs: number | null;
    lastPongAtMs: number | null;
    rotations: number;
    stableBackoffResets: number;
    metricSinkFailures: number;
  };
}

function safeInteger(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function validateConfig(config: WebSocketSourceRunnerConfig): Readonly<WebSocketSourceRunnerConfig> {
  if (config.definition.transportKind !== 'WEBSOCKET') throw new TypeError('WebSocket runner requires a WEBSOCKET source definition');
  if (typeof config.url !== 'string' || !config.url.startsWith('wss://') || config.url.length > 2_048) {
    throw new TypeError('WebSocket runner URL must be a bounded wss URL');
  }
  safeInteger(config.maximumMessageBytes, 'maximumMessageBytes', 1);
  safeInteger(config.queueCapacity, 'queueCapacity', 1);
  safeInteger(config.openTimeoutMs, 'openTimeoutMs', 1);
  safeInteger(config.rotationAfterMs, 'rotationAfterMs', 1);
  safeInteger(config.stableConnectionMs, 'stableConnectionMs', 1);
  if (config.maximumMessageBytes > 64 * 1024 * 1024) throw new RangeError('maximumMessageBytes exceeds the hard safety bound');
  if (config.openTimeoutMs > 10 * 60_000) throw new RangeError('openTimeoutMs exceeds the hard safety bound');
  if (config.rotationAfterMs > 7 * 24 * 60 * 60_000) throw new RangeError('rotationAfterMs exceeds the hard safety bound');
  if (config.backoff.retryCeiling !== config.definition.retryCeiling) {
    throw new TypeError('runner and source definition retry ceilings must match');
  }
  return Object.freeze({ ...config });
}

function error(
  code: string,
  message: string,
  observedAtMs: number,
  retryable = true,
  recommendedAction = 'Inspect the public source and allow the bounded retry policy to recover.',
): RuntimeError {
  const safeCode = /^[A-Z0-9_]{1,96}$/.test(code) ? code : 'PUBLIC_SOURCE_FAILURE';
  const safeMessage = message.replace(/[\r\n\t]+/g, ' ').slice(0, 400) || 'public source failure';
  const safeAction = recommendedAction.replace(/[\r\n\t]+/g, ' ').slice(0, 400) || 'Inspect the public source.';
  return Object.freeze({ code: safeCode, message: safeMessage, observedAtMs, retryable, recommendedAction: safeAction });
}

/**
 * Explicitly started, tick-driven WebSocket source runner. It performs no work
 * on import and owns no timer. TCP activity is recorded separately from useful
 * decoded-message arrival, so ping/pong cannot make a silent feed healthy.
 */
export class WebSocketSourceRunner<T> {
  readonly #config: Readonly<WebSocketSourceRunnerConfig>;
  readonly #clock: RuntimeClock;
  readonly #transport: PublicWebSocketTransport;
  readonly #decoder: RuntimeMessageDecoder<T>;
  readonly #sink: SourceEventSink<T> | null;
  readonly #metricSink: RuntimeMetricSink | null;
  readonly #tracker: SourceLifecycleTracker;
  readonly #backoff: DeterministicBackoff;
  readonly #queue: BoundedInboundQueue<RuntimeSourceEvent<T>>;
  readonly #throttle: ControlMessageThrottle;
  readonly #lagMetrics: BoundedProcessingLagMetrics;

  #connection: PublicWebSocketConnection | null = null;
  #activeGeneration = 0;
  #backingOff = false;
  #connectStartedAtMs: number | null = null;
  #connectedAtMs: number | null = null;
  #healthySinceMs: number | null = null;
  #lastUsefulMessageAtMs: number | null = null;
  #lastUsefulSourceTimeMs: number | null = null;
  #lastProcessedAtMs: number | null = null;
  #lastTransportEventReceiveTimeMs: number | null = null;
  #stableResetForGeneration = false;
  #generationDegraded = false;
  #lastTransportActivityMs: number | null = null;
  #lastPingAtMs: number | null = null;
  #lastPongAtMs: number | null = null;
  #rotations = 0;
  #stableBackoffResets = 0;
  #metricSinkFailures = 0;
  #pendingSinkFailure: RuntimeError | null = null;
  #sinkFailureRecovered = false;

  constructor(config: WebSocketSourceRunnerConfig, ports: WebSocketSourceRunnerPorts<T>) {
    this.#config = validateConfig(config);
    if (typeof ports.clock?.nowMs !== 'function') throw new TypeError('runtime clock is required');
    if (typeof ports.transport?.connect !== 'function') throw new TypeError('public WebSocket transport is required');
    if (typeof ports.decoder !== 'function') throw new TypeError('runtime message decoder is required');
    if (ports.sink !== undefined && typeof ports.sink?.accept !== 'function') throw new TypeError('source event sink is invalid');
    if (ports.metricSink !== undefined && typeof ports.metricSink?.record !== 'function') throw new TypeError('metric sink is invalid');
    this.#clock = ports.clock;
    this.#transport = ports.transport;
    this.#decoder = ports.decoder;
    this.#sink = ports.sink ?? null;
    this.#metricSink = ports.metricSink ?? null;
    this.#tracker = new SourceLifecycleTracker(config.definition, ports.clock);
    this.#backoff = new DeterministicBackoff(ports.clock, ports.jitter, config.backoff);
    this.#queue = new BoundedInboundQueue(config.queueCapacity);
    this.#throttle = new ControlMessageThrottle(ports.clock, config.controlThrottle);
    this.#lagMetrics = ports.lagMetrics ?? new BoundedProcessingLagMetrics(1, Math.max(32, config.queueCapacity));
  }

  start(): number {
    const current = this.#tracker.snapshot(this.#now());
    if (current.desiredState === 'RUNNING') return this.#activeGeneration;
    this.#backoff.reset();
    this.#backingOff = false;
    this.#stableResetForGeneration = false;
    this.#generationDegraded = false;
    this.#pendingSinkFailure = null;
    this.#sinkFailureRecovered = false;
    this.#activeGeneration = this.#tracker.start();
    this.#connect(this.#activeGeneration);
    return this.#activeGeneration;
  }

  stop(): void {
    const pending = this.#queue.clear(true);
    if (pending > 0) this.#tracker.count('dropped', pending);
    this.#backingOff = false;
    this.#backoff.reset();
    this.#throttle.reset();
    this.#connectStartedAtMs = null;
    this.#connectedAtMs = null;
    this.#healthySinceMs = null;
    this.#lastUsefulMessageAtMs = null;
    this.#lastUsefulSourceTimeMs = null;
    this.#lastProcessedAtMs = null;
    this.#lastTransportEventReceiveTimeMs = null;
    this.#stableResetForGeneration = false;
    this.#generationDegraded = false;
    this.#lastTransportActivityMs = null;
    this.#lastPingAtMs = null;
    this.#lastPongAtMs = null;
    this.#pendingSinkFailure = null;
    this.#sinkFailureRecovered = false;
    const connection = this.#connection;
    this.#connection = null;
    this.#tracker.stop();
    if (connection) {
      try { connection.close(1000, 'runtime source stopped'); } catch { /* generation/desired state prevents resurrection */ }
    }
  }

  tick(atMs = this.#now()): void {
    safeInteger(atMs, 'runner tick time');
    const source = this.#tracker.snapshot(atMs);
    if (source.desiredState === 'STOPPED') return;

    if (this.#backingOff) {
      const backoff = this.#backoff.snapshot();
      if (backoff.cooldownUntilMs !== null) {
        if (!this.#backoff.releaseCooldown(atMs)) return;
      } else if (!this.#backoff.consumeRetry(atMs)) {
        return;
      }
      this.#backingOff = false;
      this.#activeGeneration = this.#tracker.reconnect();
      this.#connect(this.#activeGeneration);
      return;
    }

    if (this.#connectedAtMs === null && this.#connectStartedAtMs !== null
      && atMs - this.#connectStartedAtMs >= this.#config.openTimeoutMs) {
      this.#scheduleFailure(
        this.#activeGeneration,
        error(
          'WEBSOCKET_OPEN_TIMEOUT',
          'public WebSocket transport did not emit OPEN before the explicit deadline',
          atMs,
        ),
      );
      return;
    }

    const currentGenerationHealth = this.#connectedAtMs === null
      ? null
      : this.#lastUsefulMessageAtMs === null
        ? atMs - this.#connectedAtMs >= this.#config.definition.silentAfterMs ? 'SILENT' as const : null
        : atMs - this.#lastUsefulMessageAtMs >= this.#config.definition.staleAfterMs ? 'STALE' as const : null;
    if (currentGenerationHealth !== null) {
      this.#scheduleFailure(
        this.#activeGeneration,
        error(
          currentGenerationHealth === 'SILENT' ? 'USEFUL_MESSAGES_SILENT' : 'USEFUL_MESSAGES_STALE',
          currentGenerationHealth === 'SILENT'
            ? 'socket activity continued without a useful decoded message'
            : 'the most recent useful decoded message exceeded its stale threshold',
          atMs,
        ),
      );
      return;
    }

    if (this.#connectedAtMs !== null && atMs - this.#connectedAtMs >= this.#config.rotationAfterMs) {
      this.#rotate();
      return;
    }

    if (!this.#stableResetForGeneration
      && this.#healthySinceMs !== null
      && this.#lastUsefulMessageAtMs !== null
      && this.#lastUsefulMessageAtMs - this.#healthySinceMs >= this.#config.stableConnectionMs
      && atMs >= this.#lastUsefulMessageAtMs
      && atMs - this.#lastUsefulMessageAtMs < this.#config.definition.staleAfterMs) {
      this.#backoff.reset();
      this.#stableResetForGeneration = true;
      this.#stableBackoffResets += 1;
    }
  }

  sendControl(data: string, atMs = this.#now()): Readonly<ControlSendResult> {
    safeInteger(atMs, 'control send time');
    if (typeof data !== 'string' || data.length === 0 || data.length > 64 * 1024) {
      throw new TypeError('control message must be a bounded non-empty string');
    }
    if (this.#connection === null || this.#connectedAtMs === null || this.#backingOff) {
      return Object.freeze({
        sent: false,
        allowed: false,
        requested: 1,
        remaining: this.#throttle.snapshot(atMs).remaining,
        retryAtMs: null,
        reason: 'NOT_CONNECTED',
      });
    }
    const decision = this.#throttle.acquire(1, atMs);
    if (!decision.allowed) return Object.freeze({ sent: false, ...decision });
    try {
      this.#connection.send(data);
      return Object.freeze({ sent: true, ...decision });
    } catch {
      this.#scheduleFailure(
        this.#activeGeneration,
        error('CONTROL_SEND_FAILED', 'public WebSocket control message could not be sent', atMs),
      );
      return Object.freeze({ sent: false, ...decision, reason: 'SEND_FAILED' as const });
    }
  }

  drain(maximum: number, sink: SourceEventSink<T> | null = this.#sink): Readonly<DrainResult> {
    const limit = safeInteger(maximum, 'drain maximum', 1);
    if (sink === null || typeof sink.accept !== 'function') throw new TypeError('source event sink is required to drain');
    let processed = 0;
    let failed = 0;
    while (processed < limit) {
      const entry = this.#queue.peek();
      if (entry === null) break;
      const now = this.#now();
      try {
        sink.accept(entry.value);
      } catch {
        failed += 1;
        this.#sinkFailureRecovered = false;
        this.#pendingSinkFailure = error(
          'SOURCE_EVENT_SINK_FAILED',
          'source event sink rejected a queued event; the event remains queued',
          now,
          true,
          'Repair the injected source event sink and retry the bounded drain.',
        );
        this.#tracker.fail(this.#pendingSinkFailure);
        break;
      }
      if (this.#pendingSinkFailure !== null) this.#sinkFailureRecovered = true;
      this.#pendingSinkFailure = null;
      this.#queue.shift();
      processed += 1;
      this.#tracker.processed(entry.value.connectionGeneration, now);
      this.#lastProcessedAtMs = now;
      this.#lagMetrics.record(this.#config.definition.sourceId, entry.value.receiveTimeMs, now);
      this.#recordMetric('processing_lag_ms', now - entry.value.receiveTimeMs, 'ms', now);
      this.#recordMetric('queue_depth', this.#queue.snapshot().depth, 'events', now);
    }
    return Object.freeze({ processed, failed, remaining: this.#queue.snapshot().depth });
  }

  acknowledgeSequenceResync(): void {
    this.#queue.acknowledgeResync();
  }

  snapshot(atMs = this.#now()): Readonly<WebSocketRunnerSnapshot> {
    safeInteger(atMs, 'runner snapshot time');
    const tracked = this.#tracker.snapshot(atMs);
    const backoff = this.#backoff.snapshot();
    const queue = this.#queue.snapshot();
    const coolingAfterCeiling = this.#backingOff && backoff.cooldownUntilMs !== null;
    const messageAgeMs = this.#lastUsefulMessageAtMs === null
      ? null
      : Math.max(0, atMs - this.#lastUsefulMessageAtMs);
    const processingLagMs = this.#lastUsefulMessageAtMs === null || this.#lastProcessedAtMs === null
      ? null
      : Math.max(0, this.#lastProcessedAtMs - this.#lastUsefulMessageAtMs);
    let observedState: RuntimeSourceSnapshot['observedState'];
    if (tracked.desiredState === 'STOPPED') observedState = 'STOPPED';
    else if (coolingAfterCeiling) observedState = 'FAILED';
    else if (this.#backingOff) observedState = 'BACKING_OFF';
    else if (this.#pendingSinkFailure !== null || queue.resyncRequired) observedState = 'DEGRADED';
    else if (this.#connectedAtMs === null) observedState = 'CONNECTING';
    else if (this.#lastUsefulMessageAtMs === null) {
      observedState = atMs - this.#connectedAtMs >= this.#config.definition.silentAfterMs ? 'SILENT' : 'WARMING';
    } else if (messageAgeMs !== null && messageAgeMs >= this.#config.definition.staleAfterMs) observedState = 'STALE';
    else if (this.#generationDegraded) observedState = 'DEGRADED';
    else if (tracked.observedState === 'RATE_LIMITED') observedState = 'RATE_LIMITED';
    else observedState = 'LIVE';

    const completeness: RuntimeSourceSnapshot['completeness'] = observedState === 'LIVE'
      ? 'COMPLETE'
      : observedState === 'SILENT' || observedState === 'STALE'
        || observedState === 'DEGRADED' || observedState === 'RATE_LIMITED'
        ? 'PARTIAL'
        : 'MISSING';
    const recommendedAction = observedState === 'FAILED'
      ? 'Wait for the bounded retry cooldown, then inspect the next connection attempt.'
      : observedState === 'BACKING_OFF'
        ? 'Wait for the deterministic retry time; stop explicitly if this source is no longer required.'
        : this.#pendingSinkFailure !== null
          ? this.#pendingSinkFailure.recommendedAction
          : queue.resyncRequired
            ? 'Fetch and apply an authoritative depth snapshot, then explicitly acknowledge sequence resync.'
            : observedState === 'CONNECTING'
              ? 'Wait for OPEN until the explicit connection deadline.'
              : observedState === 'WARMING'
                ? 'Require a useful decoded message before trusting the open socket.'
                : observedState === 'SILENT'
                  ? 'Reconnect on the documented routed endpoint and require useful messages.'
                  : observedState === 'STALE'
                    ? 'Refresh or reconnect the source before trusting its observations.'
                    : observedState === 'DEGRADED'
                      ? 'Inspect invalid or dropped events and require a newer valid frame before recovery.'
                      : observedState === 'RATE_LIMITED'
                        ? 'Wait for the declared rate-budget recovery window.'
                        : observedState === 'STOPPED'
                          ? 'Start explicitly when this source is required.'
                          : 'No operator action required.';
    const source = Object.freeze({
      ...tracked,
      observedState,
      connectedAtMs: this.#connectedAtMs,
      lastMessageSourceTimeMs: this.#lastUsefulSourceTimeMs,
      lastMessageReceiveTimeMs: this.#lastUsefulMessageAtMs,
      lastProcessedTimeMs: this.#lastProcessedAtMs,
      messageAgeMs,
      processingLagMs,
      completeness,
      lastError: this.#pendingSinkFailure
        ?? (this.#sinkFailureRecovered && tracked.lastError?.code === 'SOURCE_EVENT_SINK_FAILED' ? null : tracked.lastError),
      recommendedAction,
      backoff,
    });
    return Object.freeze({
      source,
      queue,
      controlThrottle: this.#throttle.snapshot(atMs),
      lag: this.#lagMetrics.snapshot(),
      connection: Object.freeze({
        connected: this.#connection !== null && this.#connectedAtMs !== null && !this.#backingOff,
        lastTransportActivityMs: this.#lastTransportActivityMs,
        lastPingAtMs: this.#lastPingAtMs,
        lastPongAtMs: this.#lastPongAtMs,
        rotations: this.#rotations,
        stableBackoffResets: this.#stableBackoffResets,
        metricSinkFailures: this.#metricSinkFailures,
      }),
    });
  }

  #connect(generation: number): void {
    const connectStartedAtMs = this.#now();
    this.#connection = null;
    this.#connectStartedAtMs = connectStartedAtMs;
    this.#connectedAtMs = null;
    this.#healthySinceMs = null;
    this.#lastUsefulMessageAtMs = null;
    this.#lastUsefulSourceTimeMs = null;
    this.#lastProcessedAtMs = null;
    this.#lastTransportEventReceiveTimeMs = null;
    this.#stableResetForGeneration = false;
    this.#generationDegraded = false;
    this.#lastTransportActivityMs = null;
    this.#lastPingAtMs = null;
    this.#lastPongAtMs = null;
    let connection: PublicWebSocketConnection;
    try {
      connection = this.#transport.connect({
        sourceId: this.#config.definition.sourceId,
        url: this.#config.url,
        generation,
        maximumMessageBytes: this.#config.maximumMessageBytes,
        onEvent: (event) => this.#onTransportEvent(generation, event),
      });
      if (!connection || typeof connection.send !== 'function' || typeof connection.close !== 'function') {
        throw new TypeError('public WebSocket transport returned an invalid connection');
      }
    } catch {
      this.#scheduleFailure(
        generation,
        error('CONNECT_FAILED', 'public WebSocket transport failed to create a connection', this.#now()),
      );
      return;
    }
    const state = this.#tracker.snapshot(this.#now());
    if (generation !== this.#activeGeneration || state.desiredState === 'STOPPED' || this.#backingOff) {
      try { connection.close(1000, 'obsolete connection generation'); } catch { /* best effort */ }
      return;
    }
    this.#connection = connection;
  }

  #onTransportEvent(generation: number, event: PublicWebSocketEvent): void {
    if (generation !== this.#activeGeneration || this.#tracker.snapshot(this.#now()).desiredState === 'STOPPED') return;
    let receiveTimeMs: number;
    try {
      receiveTimeMs = safeInteger(event.receiveTimeMs, 'transport event receive time');
    } catch {
      this.#markInvalid();
      return;
    }
    if (receiveTimeMs > this.#now() + this.#config.definition.maximumFutureSkewMs) {
      this.#markInvalid();
      return;
    }
    if ((this.#connectStartedAtMs !== null && receiveTimeMs < this.#connectStartedAtMs)
      || (this.#lastTransportEventReceiveTimeMs !== null
        && receiveTimeMs < this.#lastTransportEventReceiveTimeMs)) {
      this.#markInvalid();
      return;
    }
    this.#lastTransportEventReceiveTimeMs = receiveTimeMs;
    this.#lastTransportActivityMs = receiveTimeMs;
    if (event.kind === 'OPEN') {
      if (this.#connectedAtMs !== null) {
        this.#markInvalid();
        return;
      }
      if (this.#tracker.connected(generation, receiveTimeMs)) {
        this.#connectedAtMs = receiveTimeMs;
        this.#connectStartedAtMs = null;
      }
      return;
    }
    if ((event.kind === 'PING' || event.kind === 'PONG' || event.kind === 'MESSAGE')
      && this.#connectedAtMs === null) {
      this.#markInvalid();
      return;
    }
    if (event.kind === 'PING') {
      this.#lastPingAtMs = receiveTimeMs;
      return;
    }
    if (event.kind === 'PONG') {
      this.#lastPongAtMs = receiveTimeMs;
      return;
    }
    if (event.kind === 'MESSAGE') {
      this.#onMessage(generation, event.data, receiveTimeMs);
      return;
    }
    if (event.kind === 'ERROR') {
      const eventCode = typeof event.code === 'string' ? event.code : 'WEBSOCKET_ERROR';
      const eventMessage = typeof event.message === 'string' ? event.message : 'public WebSocket transport error';
      this.#scheduleFailure(
        generation,
        error(eventCode || 'WEBSOCKET_ERROR', eventMessage || 'public WebSocket transport error', receiveTimeMs),
      );
      return;
    }
    this.#connection = null;
    const closeCode = typeof event.code === 'number' && Number.isSafeInteger(event.code) ? event.code : null;
    const closeReason = typeof event.reason === 'string' ? event.reason : 'no reason supplied';
    this.#scheduleFailure(
      generation,
      error('WEBSOCKET_CLOSED', `public WebSocket closed (${closeCode ?? 'unknown'}): ${closeReason}`.slice(0, 400), receiveTimeMs),
    );
  }

  #onMessage(generation: number, data: unknown, receiveTimeMs: number): void {
    let decoded: DecodedRuntimeMessage<T> | null;
    try {
      decoded = this.#decoder(data, {
        sourceId: this.#config.definition.sourceId,
        generation,
        receiveTimeMs,
      });
    } catch {
      decoded = null;
    }
    if (decoded === null) {
      this.#markInvalid();
      return;
    }
    if (typeof decoded.correlationId !== 'string' || decoded.correlationId.length === 0 || decoded.correlationId.length > 256) {
      this.#markInvalid();
      return;
    }
    if (decoded.stream !== null && (typeof decoded.stream !== 'string' || decoded.stream.length === 0 || decoded.stream.length > 512)) {
      this.#markInvalid();
      return;
    }
    if (decoded.queueMode !== 'REPLACEABLE' && decoded.queueMode !== 'SEQUENCE_SENSITIVE') {
      this.#markInvalid();
      return;
    }
    if (decoded.queueMode === 'REPLACEABLE'
      && (typeof decoded.coalescingKey !== 'string'
        || decoded.coalescingKey.length === 0
        || decoded.coalescingKey.length > 512)) {
      this.#markInvalid();
      return;
    }
    for (const sourceTime of [decoded.sourceEventTimeMs, decoded.sourceTransactionTimeMs]) {
      if (sourceTime !== null && (!Number.isSafeInteger(sourceTime) || sourceTime < 0
        || sourceTime > receiveTimeMs + this.#config.definition.maximumFutureSkewMs)) {
        this.#markInvalid();
        return;
      }
    }
    const validSequenceId = (value: unknown): value is string => (
      typeof value === 'string' && value.length > 0 && value.length <= 64 && /^\d+$/.test(value)
    );
    if (decoded.sequence !== null && (
      typeof decoded.sequence !== 'object'
      || !validSequenceId(decoded.sequence.first)
      || !validSequenceId(decoded.sequence.last)
      || (decoded.sequence.previous !== null && !validSequenceId(decoded.sequence.previous))
      || BigInt(decoded.sequence.first) > BigInt(decoded.sequence.last)
    )) {
      this.#markInvalid();
      return;
    }
    const sourceTimeMs = decoded.sourceTransactionTimeMs ?? decoded.sourceEventTimeMs;
    try {
      if (!this.#tracker.message({ generation, sourceTimeMs, receiveTimeMs })) return;
    } catch {
      this.#markInvalid();
      return;
    }
    this.#generationDegraded = false;
    if (this.#lastUsefulMessageAtMs === null
      || receiveTimeMs - this.#lastUsefulMessageAtMs >= this.#config.definition.staleAfterMs) {
      this.#healthySinceMs = receiveTimeMs;
    }
    this.#lastUsefulMessageAtMs = receiveTimeMs;
    this.#lastUsefulSourceTimeMs = sourceTimeMs;
    const runtimeEvent: RuntimeSourceEvent<T> = Object.freeze({
      sourceId: this.#config.definition.sourceId,
      connectionGeneration: generation,
      productFamily: this.#config.definition.productFamily,
      endpointClass: this.#config.definition.endpointClass,
      stream: decoded.stream,
      sourceEventTimeMs: decoded.sourceEventTimeMs,
      sourceTransactionTimeMs: decoded.sourceTransactionTimeMs,
      receiveTimeMs,
      sequence: decoded.sequence === null ? null : Object.freeze({ ...decoded.sequence }),
      correlationId: decoded.correlationId,
      payload: decoded.payload,
    });
    let offered;
    try {
      offered = this.#queue.offer({
        id: decoded.correlationId,
        mode: decoded.queueMode,
        coalescingKey: decoded.coalescingKey,
        receiveTimeMs,
        value: runtimeEvent,
      });
    } catch {
      this.#markInvalid();
      return;
    }
    if (offered.coalesced > 0) this.#tracker.count('coalesced', offered.coalesced);
    if (offered.dropped > 0) {
      this.#generationDegraded = true;
      this.#tracker.count('dropped', offered.dropped);
    }
    if (!offered.accepted && offered.requiresResync && decoded.queueMode === 'SEQUENCE_SENSITIVE') {
      this.#tracker.count('sequenceGap');
    }
    this.#recordMetric('queue_depth', this.#queue.snapshot().depth, 'events', receiveTimeMs);
  }

  #scheduleFailure(generation: number, failure: RuntimeError): void {
    if (generation !== this.#activeGeneration || this.#backingOff
      || this.#tracker.snapshot(this.#now()).desiredState === 'STOPPED') return;
    this.#backingOff = true;
    this.#connectStartedAtMs = null;
    const pending = this.#queue.clear(true);
    if (pending > 0) this.#tracker.count('dropped', pending);
    const connection = this.#connection;
    this.#connection = null;
    if (connection) {
      try { connection.close(1012, 'source reconnect scheduled'); } catch { /* retry generation remains authoritative */ }
    }
    const now = this.#now();
    const decision = this.#backoff.fail(now);
    this.#tracker.backoff({
      attempt: decision.attempt,
      delayMs: decision.delayMs,
      retryAtMs: decision.retryAtMs,
      cooldownUntilMs: decision.cooldownUntilMs,
    });
    if (decision.state === 'COOLDOWN') {
      this.#tracker.fail(error(
        'RETRY_CEILING_REACHED',
        'source retry ceiling reached; deterministic cooldown is active',
        now,
        true,
        'Wait for cooldown expiry, then inspect the next bounded reconnect attempt.',
      ));
    } else {
      // Preserve the actionable failure while the observed state remains BACKING_OFF.
      this.#tracker.fail(failure);
      this.#tracker.backoff({
        attempt: decision.attempt,
        delayMs: decision.delayMs,
        retryAtMs: decision.retryAtMs,
      });
    }
  }

  #rotate(): void {
    const pending = this.#queue.clear(true);
    if (pending > 0) this.#tracker.count('dropped', pending);
    const old = this.#connection;
    this.#connection = null;
    this.#rotations += 1;
    this.#activeGeneration = this.#tracker.reconnect();
    if (old) {
      try { old.close(1000, 'scheduled connection rotation'); } catch { /* old generation is already obsolete */ }
    }
    this.#connect(this.#activeGeneration);
  }

  #recordMetric(name: string, value: number, unit: string, observedAtMs: number): void {
    if (this.#metricSink === null) return;
    try {
      this.#metricSink.record({
        sourceId: this.#config.definition.sourceId,
        name,
        value,
        unit,
        observedAtMs,
      });
    } catch {
      this.#metricSinkFailures += 1;
    }
  }

  #markInvalid(): void {
    this.#generationDegraded = true;
    this.#tracker.count('invalid');
  }

  #now(): number {
    return safeInteger(this.#clock.nowMs(), 'clock.nowMs');
  }
}
