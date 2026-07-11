/**
 * Foundation contracts — structured failure (WAVE 0, frozen).
 *
 * Every failure that crosses a foundation boundary is a StructuredFailure
 * carrying the exact nine fields the sprint directive requires. Free-form
 * thrown strings do not cross module boundaries; TypeError is reserved for
 * programming errors (malformed constructor input), while operational
 * failures travel as values inside ContractResult.
 *
 * Standalone module by design: it imports nothing so every other contract
 * can import it without cycles. It therefore keeps a private UTC-millis
 * check (time.ts re-exports the public one).
 *
 * Pure module: no I/O, no clocks (occurredAt is always caller-supplied from
 * an injected clock), no env, no import-time side effects.
 */

export interface StructuredFailure {
  /** Owning component, e.g. 'foundation.contracts.time'. */
  component: string;
  /** Stage inside the component, e.g. 'validate', 'preflight:borrow'. */
  stage: string;
  /** Stable machine code, UPPER_SNAKE, e.g. 'LIVE_EXECUTION_NOT_IMPLEMENTED'. */
  code: string;
  /** Human-readable explanation. Must never contain secrets. */
  message: string;
  /** UTC ms from the caller's injected clock. Never read internally. */
  occurredAt: number;
  /** True only when retrying the same action can plausibly succeed. */
  retryable: boolean;
  /** The state the system is safely in AFTER this failure, e.g. 'STOPPED'. */
  safeCurrentState: string;
  /** What the operator should do, e.g. 'Check API key permissions'. */
  recommendedOperatorAction: string;
  /** Correlation ID linking this failure to the command/plan that caused it. */
  correlationId: string;
}

/** Canonical field order — also the serialization order. */
export const STRUCTURED_FAILURE_KEYS = [
  'component',
  'stage',
  'code',
  'message',
  'occurredAt',
  'retryable',
  'safeCurrentState',
  'recommendedOperatorAction',
  'correlationId',
] as const;

/** One structural problem found while validating contract input. */
export interface ValidationIssue {
  /** Dotted path of the offending field, e.g. 'occurredAt'. */
  path: string;
  /** Stable issue code, UPPER_SNAKE. */
  code: string;
  message: string;
}

/**
 * Uniform success/failure envelope for contract operations that can fail
 * operationally (as opposed to programmer misuse, which throws TypeError).
 */
export type ContractResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: StructuredFailure };

export function ok<T>(value: T): ContractResult<T> {
  return Object.freeze({ ok: true as const, value });
}

export function fail<T = never>(failure: StructuredFailure): ContractResult<T> {
  return Object.freeze({ ok: false as const, failure: createStructuredFailure(failure) });
}

// ---------- validation ----------

/** Private UTC-ms bounds copy (public constants live in time.ts). */
const MIN_MS = 0;
const MAX_MS = 4_102_444_800_000; // 2100-01-01T00:00:00Z

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/;

function isUtcMs(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= MIN_MS && v <= MAX_MS;
}

function checkStr(
  issues: ValidationIssue[],
  path: string,
  v: unknown,
  maxLen: number,
): void {
  if (typeof v !== 'string' || v.trim().length === 0) {
    issues.push({ path, code: 'NON_EMPTY_STRING_REQUIRED', message: `${path} must be a non-empty string` });
  } else if (v.length > maxLen) {
    issues.push({ path, code: 'STRING_TOO_LONG', message: `${path} exceeds ${maxLen} characters` });
  }
}

/** Structural validation. Empty array = valid. Never throws. */
export function validateStructuredFailure(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [{ path: '', code: 'OBJECT_REQUIRED', message: 'structured failure must be a plain object' }];
  }
  const rec = input as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!(STRUCTURED_FAILURE_KEYS as readonly string[]).includes(key)) {
      issues.push({ path: key, code: 'UNKNOWN_FIELD', message: `unexpected field '${key}'` });
    }
  }
  checkStr(issues, 'component', rec.component, 200);
  checkStr(issues, 'stage', rec.stage, 200);
  if (typeof rec.code !== 'string' || !CODE_PATTERN.test(rec.code)) {
    issues.push({ path: 'code', code: 'CODE_FORMAT_INVALID', message: 'code must match /^[A-Z][A-Z0-9_]{0,99}$/' });
  }
  checkStr(issues, 'message', rec.message, 10_000);
  if (!isUtcMs(rec.occurredAt)) {
    issues.push({ path: 'occurredAt', code: 'UTC_MILLIS_INVALID', message: 'occurredAt must be a safe integer UTC ms in [0, 2100)' });
  }
  if (typeof rec.retryable !== 'boolean') {
    issues.push({ path: 'retryable', code: 'BOOLEAN_REQUIRED', message: 'retryable must be a boolean' });
  }
  checkStr(issues, 'safeCurrentState', rec.safeCurrentState, 200);
  checkStr(issues, 'recommendedOperatorAction', rec.recommendedOperatorAction, 500);
  checkStr(issues, 'correlationId', rec.correlationId, 128);
  return issues;
}

export function isStructuredFailure(value: unknown): value is StructuredFailure {
  return validateStructuredFailure(value).length === 0;
}

/**
 * Constructor: validates, strips nothing, rejects unknown fields, freezes.
 * Throws TypeError on malformed input (programmer error at the call site).
 */
export function createStructuredFailure(input: StructuredFailure): Readonly<StructuredFailure> {
  const issues = validateStructuredFailure(input);
  if (issues.length > 0) {
    throw new TypeError(
      `createStructuredFailure: invalid input — ${issues.map((i) => `${i.path}:${i.code}`).join(', ')}`,
    );
  }
  return Object.freeze({
    component: input.component,
    stage: input.stage,
    code: input.code,
    message: input.message,
    occurredAt: input.occurredAt,
    retryable: input.retryable,
    safeCurrentState: input.safeCurrentState,
    recommendedOperatorAction: input.recommendedOperatorAction,
    correlationId: input.correlationId,
  });
}

/**
 * Safe, deterministic serialization: exactly the nine contract fields, in
 * STRUCTURED_FAILURE_KEYS order, as one JSON line. Same failure => byte-
 * identical output. Throws TypeError if handed something that is not a
 * valid StructuredFailure (serialization must not launder garbage).
 */
export function serializeStructuredFailure(failure: StructuredFailure): string {
  const issues = validateStructuredFailure(failure);
  if (issues.length > 0) {
    throw new TypeError(
      `serializeStructuredFailure: not a StructuredFailure — ${issues.map((i) => `${i.path}:${i.code}`).join(', ')}`,
    );
  }
  const ordered: Record<string, unknown> = {};
  for (const key of STRUCTURED_FAILURE_KEYS) ordered[key] = failure[key];
  return JSON.stringify(ordered);
}

/** Caller-supplied context for converting ValidationIssues into a failure. */
export interface FailureContext {
  component: string;
  stage: string;
  /** From the caller's injected clock. */
  occurredAt: number;
  correlationId: string;
  code?: string;
  retryable?: boolean;
  safeCurrentState?: string;
  recommendedOperatorAction?: string;
}

/**
 * Promote validation issues to a StructuredFailure using caller context.
 * The issue list is embedded in the message so nothing is lost.
 */
export function failureFromIssues(issues: readonly ValidationIssue[], ctx: FailureContext): Readonly<StructuredFailure> {
  if (issues.length === 0) {
    throw new TypeError('failureFromIssues: issue list is empty — nothing failed');
  }
  const detail = issues.map((i) => `${i.path || '(root)'}: ${i.code} — ${i.message}`).join('; ');
  return createStructuredFailure({
    component: ctx.component,
    stage: ctx.stage,
    code: ctx.code ?? 'CONTRACT_VALIDATION_FAILED',
    message: `contract validation failed: ${detail}`,
    occurredAt: ctx.occurredAt,
    retryable: ctx.retryable ?? false,
    safeCurrentState: ctx.safeCurrentState ?? 'UNCHANGED',
    recommendedOperatorAction: ctx.recommendedOperatorAction ?? 'Fix the reported fields at the call site.',
    correlationId: ctx.correlationId,
  });
}
