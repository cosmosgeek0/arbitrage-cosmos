export type LocalProtocolEndpoint =
  | Readonly<{ kind: 'LOOPBACK_HTTP'; url: string; adapterPolicy: 'L_ADAPTER_POLICY_V1' }>
  | Readonly<{ kind: 'UNIX_SOCKET'; path: string; adapterPolicy: 'L_ADAPTER_POLICY_V1' }>;

export type LocalTransportState = 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED' | 'FAILED' | 'TIMED_OUT';

export interface LocalTransportObservation {
  state: Exclude<LocalTransportState, 'UNKNOWN' | 'TIMED_OUT'>;
  observedAtMs: number;
  requestStartedAtMs: number | null;
  requestCompletedAtMs: number | null;
  reasonCode: string | null;
}

export interface EffectiveTransportObservation {
  state: LocalTransportState;
  observedAtMs: number | null;
  requestStartedAtMs: number | null;
  requestCompletedAtMs: number | null;
  reasonCode: string;
}

function plainDataRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.some((key) => typeof key !== 'string')) {
    throw new TypeError(`${label} must contain only plain data fields`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of ownKeys as string[]) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(`${label} must contain only plain data fields`);
    }
  }
  return input as Record<string, unknown>;
}

function requireExactFields(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(record);
  if (actual.length !== expected.length || expected.some((key) => !Object.hasOwn(record, key))) {
    throw new TypeError(`${label} fields must match the exact adapter contract`);
  }
}

function boundedTime(value: unknown, name: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be ${nullable ? 'null or ' : ''}a non-negative safe integer`);
  }
  return value;
}

export function validateLocalProtocolEndpoint(input: LocalProtocolEndpoint): Readonly<LocalProtocolEndpoint> {
  const record = plainDataRecord(input, 'local protocol endpoint');
  if (record.kind === 'LOOPBACK_HTTP') {
    requireExactFields(record, ['kind', 'url', 'adapterPolicy'], 'loopback protocol endpoint');
  } else if (record.kind === 'UNIX_SOCKET') {
    requireExactFields(record, ['kind', 'path', 'adapterPolicy'], 'Unix socket endpoint');
  } else {
    throw new TypeError('local protocol endpoint kind is invalid');
  }
  if (record.adapterPolicy !== 'L_ADAPTER_POLICY_V1') {
    throw new TypeError('local protocol endpoint must name L_ADAPTER_POLICY_V1');
  }
  if (record.kind === 'LOOPBACK_HTTP') {
    if (typeof record.url !== 'string') throw new TypeError('loopback protocol endpoint URL is invalid');
    const literal = /^http:\/\/127\.0\.0\.1:(\d{1,5})(\/[A-Za-z0-9._\/-]{0,255})$/.exec(record.url);
    if (literal === null) {
      throw new TypeError('loopback protocol endpoint must be a literal bounded http://127.0.0.1 URL');
    }
    const literalPort = Number(literal[1]);
    const literalPath = literal[2] as string;
    if (!Number.isSafeInteger(literalPort) || literalPort < 1 || literalPort > 65_535
      || literalPath.split('/').includes('..')) {
      throw new TypeError('loopback protocol endpoint port or path is invalid');
    }
    let parsed: URL;
    try {
      parsed = new URL(record.url);
    } catch {
      throw new TypeError('loopback protocol endpoint URL is invalid');
    }
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1'
      || parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
      throw new TypeError('loopback protocol endpoint must be literal http://127.0.0.1 with no credentials/query/fragment');
    }
    if (parsed.port === '' || Number(parsed.port) !== literalPort) {
      throw new TypeError('loopback protocol endpoint requires an explicit bounded port');
    }
    if (parsed.pathname !== literalPath) {
      throw new TypeError('loopback protocol endpoint path is invalid');
    }
    return Object.freeze({ kind: 'LOOPBACK_HTTP', url: record.url, adapterPolicy: record.adapterPolicy });
  }
  if (typeof record.path !== 'string' || record.path.length < 2 || record.path.length > 100
      || !record.path.startsWith('/') || record.path.includes('\0') || record.path.split('/').includes('..')) {
      throw new TypeError('Unix socket path must be an absolute bounded path without traversal');
  }
  return Object.freeze({ kind: 'UNIX_SOCKET', path: record.path, adapterPolicy: record.adapterPolicy });
}

export function evaluateLocalTransport(
  observation: LocalTransportObservation | null,
  nowMs: number,
  requestTimeoutMs: number,
): Readonly<EffectiveTransportObservation> {
  boundedTime(nowMs, 'transport nowMs');
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 10 * 60_000) {
    throw new TypeError('requestTimeoutMs is outside the L adapter safety bound');
  }
  if (observation === null) {
    return Object.freeze({
      state: 'UNKNOWN',
      observedAtMs: null,
      requestStartedAtMs: null,
      requestCompletedAtMs: null,
      reasonCode: 'TRANSPORT_UNOBSERVED',
    });
  }
  const record = plainDataRecord(observation, 'transport observation');
  requireExactFields(
    record,
    ['state', 'observedAtMs', 'requestStartedAtMs', 'requestCompletedAtMs', 'reasonCode'],
    'transport observation',
  );
  const observedAtMs = boundedTime(record.observedAtMs, 'transport observedAtMs') as number;
  const requestStartedAtMs = boundedTime(record.requestStartedAtMs, 'requestStartedAtMs', true);
  const requestCompletedAtMs = boundedTime(record.requestCompletedAtMs, 'requestCompletedAtMs', true);
  if (record.state !== 'CONNECTED' && record.state !== 'DISCONNECTED' && record.state !== 'FAILED') {
    throw new TypeError('transport observation state is invalid');
  }
  const reasonCode = record.reasonCode === null
    ? `TRANSPORT_${record.state}`
    : record.reasonCode;
  if (typeof reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(reasonCode)) {
    throw new TypeError('transport reasonCode must be null or UPPER_SNAKE');
  }
  if (observedAtMs > nowMs) throw new RangeError('transport observation cannot be from the future');
  if (requestStartedAtMs !== null && requestStartedAtMs > nowMs) {
    throw new RangeError('transport request start cannot be from the future');
  }
  if (requestCompletedAtMs !== null && requestCompletedAtMs > nowMs) {
    throw new RangeError('transport request completion cannot be from the future');
  }
  if (requestCompletedAtMs !== null && requestStartedAtMs === null) {
    throw new TypeError('completed request requires a start time');
  }
  if (requestStartedAtMs !== null && requestCompletedAtMs !== null && requestCompletedAtMs < requestStartedAtMs) {
    throw new TypeError('transport completion cannot precede request start');
  }
  // A local observation can only report request events that had already
  // occurred: start <= completion <= observation <= injected now. Pending
  // requests use the same ordering with the completion term absent.
  if (requestStartedAtMs !== null && requestStartedAtMs > observedAtMs) {
    throw new TypeError('transport observation cannot precede request start');
  }
  if (requestCompletedAtMs !== null && requestCompletedAtMs > observedAtMs) {
    throw new TypeError('transport observation cannot precede request completion');
  }
  if (requestStartedAtMs !== null && requestCompletedAtMs === null && nowMs - requestStartedAtMs >= requestTimeoutMs) {
    return Object.freeze({
      state: 'TIMED_OUT',
      observedAtMs,
      requestStartedAtMs,
      requestCompletedAtMs,
      reasonCode: 'TRANSPORT_REQUEST_TIMEOUT',
    });
  }
  return Object.freeze({
    state: record.state,
    observedAtMs,
    requestStartedAtMs,
    requestCompletedAtMs,
    reasonCode,
  });
}
