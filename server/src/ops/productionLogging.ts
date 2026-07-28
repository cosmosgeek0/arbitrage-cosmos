import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { format } from 'node:util';

export type ProtectedLogClass = 'audit' | 'money' | 'security';

type RoutineMethod = 'info' | 'debug';
type LogArguments = readonly unknown[];

export interface ProductionLoggingPolicy {
  readonly intervalMs: number;
  readonly burst: number;
  readonly perMessageBurst: number;
  readonly maxMessageKeys: number;
}

export interface ProductionLoggingSink {
  readonly log: (...args: unknown[]) => void;
  readonly info: (...args: unknown[]) => void;
  readonly debug: (...args: unknown[]) => void;
  readonly warn: (...args: unknown[]) => void;
  readonly error: (...args: unknown[]) => void;
  readonly protected: (...args: unknown[]) => void;
}

export interface ProductionLoggingSnapshot {
  readonly routineEmitted: number;
  readonly routineSuppressed: number;
  readonly retainedMessageKeys: number;
}

export interface ProductionLoggingOptions {
  readonly clock?: () => number;
  readonly policy?: ProductionLoggingPolicy;
  readonly sink: ProductionLoggingSink;
}

export interface ConsoleLoggingTarget {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface ProductionLoggingInstallation {
  readonly enabled: boolean;
  readonly logger: ProductionLogging | null;
  restore(): void;
}

export interface InstallProductionLoggingOptions {
  readonly environment?: string;
  readonly target?: ConsoleLoggingTarget;
  readonly clock?: () => number;
  readonly policy?: ProductionLoggingPolicy;
}

export const DEFAULT_PRODUCTION_LOGGING_POLICY: ProductionLoggingPolicy = Object.freeze({
  intervalMs: 60_000,
  burst: 30,
  perMessageBurst: 3,
  maxMessageKeys: 30,
});

export const MAX_ROUTINE_LOG_RECORD_BYTES = 2_048;

const PRIORITY = Object.freeze({
  debug: '<7>',
  info: '<6>',
  notice: '<5>',
  warning: '<4>',
  error: '<3>',
});

const PHYSICAL_LINE_SEPARATOR = /\r\n|[\n\r\u2028\u2029]/u;
const installations = new WeakMap<ConsoleLoggingTarget, ProductionLoggingInstallation>();

function assertPolicy(policy: ProductionLoggingPolicy): void {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`production logging ${name} must be a positive safe integer`);
    }
  }
  if (policy.perMessageBurst > policy.burst) {
    throw new RangeError('production logging perMessageBurst exceeds burst');
  }
  if (policy.maxMessageKeys > policy.burst) {
    throw new RangeError('production logging maxMessageKeys exceeds burst');
  }
}

function renderedArguments(args: LogArguments): string {
  return format(...args);
}

function physicalLines(args: LogArguments): readonly string[] {
  return renderedArguments(args).split(PHYSICAL_LINE_SEPARATOR);
}

function singlePhysicalLine(value: string): string {
  return value.replace(/\r\n/gu, '\\n').replace(/[\n\r\u2028\u2029]/gu, '\\n');
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const suffix = '…';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidateBytes = Buffer.byteLength(value.slice(0, middle), 'utf8') + suffixBytes;
    if (candidateBytes <= maxBytes) low = middle;
    else high = middle - 1;
  }
  while (low > 0 && /[\uD800-\uDBFF]/u.test(value.charAt(low - 1))) low -= 1;
  return `${value.slice(0, low)}${suffix}`;
}

function boundedRoutineRecord(priority: string, args: LogArguments): string {
  return truncateUtf8(
    `${priority}${singlePhysicalLine(renderedArguments(args))}`,
    MAX_ROUTINE_LOG_RECORD_BYTES,
  );
}

function routineMessageDigest(method: RoutineMethod, record: string): string {
  const digest = createHash('sha256');
  digest.update(method);
  digest.update('\0');
  digest.update(record);
  return digest.digest('hex');
}

function incrementBounded(value: number): number {
  return value >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : value + 1;
}

/**
 * Production-only routine console policy.
 *
 * console.info/debug are bounded in a timer-free routine window. console.log
 * is always a material notice and never enters the limiter. Protected audit,
 * money, and security evidence also bypasses the limiter. Warning/error
 * records are priority-tagged one physical line at a time and never suppressed.
 */
export class ProductionLogging {
  readonly #clock: () => number;
  readonly #policy: ProductionLoggingPolicy;
  readonly #sink: ProductionLoggingSink;
  readonly #messageCounts = new Map<string, number>();
  #windowStartedAtMs: number;
  #lastClockMs: number;
  #routineAttempts = 0;
  #routineEmitted = 0;
  #routineSuppressed = 0;

  constructor(options: ProductionLoggingOptions) {
    assertPolicy(options.policy ?? DEFAULT_PRODUCTION_LOGGING_POLICY);
    this.#policy = Object.freeze({ ...(options.policy ?? DEFAULT_PRODUCTION_LOGGING_POLICY) });
    this.#clock = options.clock ?? (() => performance.now());
    this.#sink = options.sink;
    this.#lastClockMs = this.#readClock(0);
    this.#windowStartedAtMs = this.#lastClockMs;
  }

  log(...args: unknown[]): void {
    this.#emitPhysicalLines('log', PRIORITY.notice, args);
  }

  info(...args: unknown[]): void {
    this.#routine('info', args);
  }

  debug(...args: unknown[]): void {
    this.#routine('debug', args);
  }

  warn(...args: unknown[]): void {
    this.#emitPhysicalLines('warn', PRIORITY.warning, args);
  }

  error(...args: unknown[]): void {
    this.#emitPhysicalLines('error', PRIORITY.error, args);
  }

  protected(kind: ProtectedLogClass, ...args: unknown[]): void {
    const priority = kind === 'security' ? PRIORITY.warning : PRIORITY.notice;
    this.#emitPhysicalLines('protected', priority, args);
  }

  snapshot(): ProductionLoggingSnapshot {
    return Object.freeze({
      routineEmitted: this.#routineEmitted,
      routineSuppressed: this.#routineSuppressed,
      retainedMessageKeys: this.#messageCounts.size,
    });
  }

  flushSuppressionSummary(): void {
    if (this.#routineSuppressed === 0) return;
    const count = this.#routineSuppressed;
    this.#routineSuppressed = 0;
    this.#sink.protected(`${PRIORITY.notice}COSMOS_ROUTINE_LOG_SUPPRESSED count=${count}`);
  }

  #readClock(fallback: number): number {
    const value = this.#clock();
    if (!Number.isFinite(value) || value < 0) return fallback;
    return value;
  }

  #rotateWindow(nowMs: number): void {
    if (nowMs < this.#windowStartedAtMs) {
      this.#windowStartedAtMs = nowMs;
      this.#messageCounts.clear();
      this.#routineAttempts = 0;
      this.#routineEmitted = 0;
      this.flushSuppressionSummary();
      return;
    }
    if (nowMs - this.#windowStartedAtMs < this.#policy.intervalMs) return;
    this.#windowStartedAtMs = nowMs;
    this.#messageCounts.clear();
    this.#routineAttempts = 0;
    this.#routineEmitted = 0;
    this.flushSuppressionSummary();
  }

  #suppress(): void {
    this.#routineSuppressed = incrementBounded(this.#routineSuppressed);
  }

  #emitPhysicalLines(
    method: 'log' | 'warn' | 'error' | 'protected',
    priority: string,
    args: LogArguments,
  ): void {
    for (const line of physicalLines(args)) this.#sink[method](`${priority}${line}`);
  }

  #routine(method: RoutineMethod, args: LogArguments): void {
    const nowMs = this.#readClock(this.#lastClockMs);
    this.#lastClockMs = nowMs;
    this.#rotateWindow(nowMs);

    if (this.#routineAttempts >= this.#policy.burst) {
      this.#suppress();
      return;
    }
    this.#routineAttempts += 1;

    if (this.#routineEmitted >= this.#policy.burst) {
      this.#suppress();
      return;
    }

    const priority = method === 'debug' ? PRIORITY.debug : PRIORITY.info;
    const record = boundedRoutineRecord(priority, args);
    const key = routineMessageDigest(method, record);
    const messageCount = this.#messageCounts.get(key);
    if (messageCount !== undefined && messageCount >= this.#policy.perMessageBurst) {
      this.#suppress();
      return;
    }
    if (messageCount === undefined && this.#messageCounts.size >= this.#policy.maxMessageKeys) {
      this.#suppress();
      return;
    }

    this.#messageCounts.set(key, (messageCount ?? 0) + 1);
    this.#routineEmitted += 1;
    this.#sink[method](record);
  }
}

export function installProductionLogging(
  options: InstallProductionLoggingOptions = {},
): ProductionLoggingInstallation {
  const target = options.target ?? console;
  if (options.environment !== 'production') {
    return Object.freeze({
      enabled: false,
      logger: null,
      restore() {},
    });
  }

  const existing = installations.get(target);
  if (existing !== undefined) return existing;

  const original = Object.freeze({
    log: target.log,
    info: target.info,
    debug: target.debug,
    warn: target.warn,
    error: target.error,
  });
  const sink: ProductionLoggingSink = Object.freeze({
    log: target.log.bind(target),
    info: target.info.bind(target),
    debug: target.debug.bind(target),
    warn: target.warn.bind(target),
    error: target.error.bind(target),
    protected: target.error.bind(target),
  });
  const logger = new ProductionLogging({
    clock: options.clock,
    policy: options.policy,
    sink,
  });
  const wrapped = Object.freeze({
    log: (...args: unknown[]) => logger.log(...args),
    info: (...args: unknown[]) => logger.info(...args),
    debug: (...args: unknown[]) => logger.debug(...args),
    warn: (...args: unknown[]) => logger.warn(...args),
    error: (...args: unknown[]) => logger.error(...args),
  });

  target.log = wrapped.log;
  target.info = wrapped.info;
  target.debug = wrapped.debug;
  target.warn = wrapped.warn;
  target.error = wrapped.error;

  let restored = false;
  const installation: ProductionLoggingInstallation = Object.freeze({
    enabled: true,
    logger,
    restore() {
      if (restored) return;
      restored = true;
      logger.flushSuppressionSummary();
      if (target.log === wrapped.log) target.log = original.log;
      if (target.info === wrapped.info) target.info = original.info;
      if (target.debug === wrapped.debug) target.debug = original.debug;
      if (target.warn === wrapped.warn) target.warn = original.warn;
      if (target.error === wrapped.error) target.error = original.error;
      installations.delete(target);
    },
  });
  installations.set(target, installation);
  return installation;
}
