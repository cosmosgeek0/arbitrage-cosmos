import type {
  JsonValue,
  ProductFamily,
  SourceEndpointClass,
} from '../../intelligenceFoundation/contracts/index.js';

export const RUNTIME_LIFECYCLE_STATES = Object.freeze([
  'STOPPED',
  'CONNECTING',
  'WARMING',
  'LIVE',
  'SILENT',
  'STALE',
  'DEGRADED',
  'BACKING_OFF',
  'RATE_LIMITED',
  'FAILED',
] as const);

export type RuntimeLifecycleState = (typeof RUNTIME_LIFECYCLE_STATES)[number];
export type RuntimeDesiredState = 'STOPPED' | 'RUNNING';
export type RuntimeTransportKind = 'REST' | 'WEBSOCKET' | 'INJECTED';
export type RuntimeAuthority = 'COMPLETE' | 'PARTIAL' | 'SAMPLED' | 'UNAVAILABLE' | 'UNKNOWN';

export interface RuntimeClock {
  nowMs(): number;
}

export interface RuntimeJitterSource {
  /** Returns a deterministic caller-supplied value in [0, 1]. */
  next(): number;
}

export interface RuntimeScheduler {
  schedule(id: string, delayMs: number, task: () => void): void;
  cancel(id: string): void;
}

export interface RuntimeSequence {
  first: string;
  last: string;
  previous: string | null;
}

export interface RuntimeSourceEvent<T = unknown> {
  sourceId: string;
  connectionGeneration: number;
  productFamily: ProductFamily | 'ANY';
  endpointClass: SourceEndpointClass;
  stream: string | null;
  sourceEventTimeMs: number | null;
  sourceTransactionTimeMs: number | null;
  receiveTimeMs: number;
  sequence: RuntimeSequence | null;
  correlationId: string;
  payload: T;
}

export interface RuntimeError {
  code: string;
  message: string;
  retryable: boolean;
  observedAtMs: number;
  recommendedAction: string;
}

export interface RuntimeBackoffState {
  attempt: number;
  ceiling: number;
  delayMs: number | null;
  retryAtMs: number | null;
  cooldownUntilMs: number | null;
}

export interface RuntimeRateBudgetState {
  state: 'AVAILABLE' | 'NEAR_LIMIT' | 'EXHAUSTED' | 'COOLDOWN' | 'UNKNOWN';
  usedWeight: number | null;
  limit: number | null;
  intervalMs: number | null;
  resetsAtMs: number | null;
  retryAfterMs: number | null;
  observedAtMs: number | null;
}

export interface RuntimeSourceSnapshot {
  sourceId: string;
  transportKind: RuntimeTransportKind;
  endpointClass: SourceEndpointClass;
  productFamily: ProductFamily | 'ANY';
  desiredState: RuntimeDesiredState;
  observedState: RuntimeLifecycleState;
  connectionGeneration: number;
  connectedAtMs: number | null;
  lastMessageSourceTimeMs: number | null;
  lastMessageReceiveTimeMs: number | null;
  lastProcessedTimeMs: number | null;
  messageAgeMs: number | null;
  processingLagMs: number | null;
  messageCount: number;
  invalidCount: number;
  duplicateCount: number;
  outOfOrderCount: number;
  sequenceGapCount: number;
  droppedCount: number;
  coalescedCount: number;
  reconnectCount: number;
  backoff: RuntimeBackoffState;
  rateBudget: RuntimeRateBudgetState;
  lastError: RuntimeError | null;
  recommendedAction: string;
  authority: RuntimeAuthority;
  completeness: 'COMPLETE' | 'PARTIAL' | 'MISSING' | 'UNKNOWN';
  snapshotTimeMs: number;
}

export interface RuntimeSourceDefinition {
  sourceId: string;
  transportKind: RuntimeTransportKind;
  endpointClass: SourceEndpointClass;
  productFamily: ProductFamily | 'ANY';
  silentAfterMs: number;
  staleAfterMs: number;
  maximumFutureSkewMs: number;
  retryCeiling: number;
  authority: RuntimeAuthority;
}

export interface PublicRestRequest {
  sourceId: string;
  method: 'GET';
  baseUrl: string;
  path: string;
  query: Readonly<Record<string, string | number | boolean>>;
  timeoutMs: number;
  maximumResponseBytes: number;
}

export interface PublicRestResponse<T = unknown> {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: T;
  receiveTimeMs: number;
}

export interface PublicRestTransport {
  request<T = unknown>(request: PublicRestRequest): Promise<PublicRestResponse<T>>;
}

export type PublicWebSocketEvent =
  | { kind: 'OPEN'; receiveTimeMs: number }
  | { kind: 'MESSAGE'; receiveTimeMs: number; data: unknown }
  | { kind: 'PING'; receiveTimeMs: number; payload: string | null }
  | { kind: 'PONG'; receiveTimeMs: number; payload: string | null }
  | { kind: 'CLOSE'; receiveTimeMs: number; code: number | null; reason: string }
  | { kind: 'ERROR'; receiveTimeMs: number; code: string; message: string };

export interface PublicWebSocketConnection {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface PublicWebSocketConnectRequest {
  sourceId: string;
  url: string;
  generation: number;
  maximumMessageBytes: number;
  onEvent(event: PublicWebSocketEvent): void;
}

export interface PublicWebSocketTransport {
  connect(request: PublicWebSocketConnectRequest): PublicWebSocketConnection;
}

export interface SourceEventSink<T = unknown> {
  accept(event: RuntimeSourceEvent<T>): void;
}

export interface RuntimeMetric {
  sourceId: string;
  name: string;
  value: number | string | boolean | null;
  unit: string;
  observedAtMs: number;
}

export interface RuntimeMetricSink {
  record(metric: RuntimeMetric): void;
}

export interface CaptureStoragePort {
  load(checkpointId: string): Promise<JsonValue | null>;
  save(checkpointId: string, value: JsonValue): Promise<void>;
}

export interface BaselineCheckpointPort {
  load(planId: string): Promise<JsonValue | null>;
  save(planId: string, value: JsonValue): Promise<void>;
}

export interface ProtectedSymbolPort {
  protectedSymbols(observedAtMs: number): readonly string[];
}

export interface ManualSmokeReporter {
  report(entry: {
    step: string;
    state: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNAVAILABLE';
    detail: string;
    observedAtMs: number;
  }): void;
}
