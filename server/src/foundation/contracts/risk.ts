/**
 * Foundation contracts — risk verdict shapes (WAVE 0, frozen).
 *
 * The Lane D evaluator is a pure input-to-verdict function; this module
 * freezes its output vocabulary and the fail-closed derivation law.
 *
 * LAWS:
 *   - A blocking check that is not PASS blocks. UNKNOWN blocks exactly like
 *     FAIL — required unknowns fail closed, they are never optimistic.
 *   - `observed`/`limit`/`evidenceTimestamp` stay null when genuinely
 *     unknown; the verdict never fabricates evidence.
 *   - Risk-reducing recovery is distinguishable from risk-increasing entry
 *     via ActionRiskClass so the kill switch can block new risk without
 *     trapping an authorized recovery.
 *
 * Pure module: no I/O, no clocks (evaluatedAt comes from the caller's
 * injected clock), no env, no import-time side effects.
 */
import type { ValidationIssue } from './failures.js';
import { isValidUtcMillis } from './time.js';

// ---------- vocabulary ----------

export const RISK_CHECK_STATUSES = ['PASS', 'FAIL', 'UNKNOWN'] as const;
export type RiskCheckStatus = (typeof RISK_CHECK_STATUSES)[number];

export function isRiskCheckStatus(value: unknown): value is RiskCheckStatus {
  return typeof value === 'string' && (RISK_CHECK_STATUSES as readonly string[]).includes(value);
}

/**
 * What an evaluated action does to net risk. RISK_REDUCING covers close,
 * hedge-residual, and recovery actions; RISK_INCREASING covers new entries
 * and size additions.
 */
export const ACTION_RISK_CLASSES = ['RISK_INCREASING', 'RISK_REDUCING'] as const;
export type ActionRiskClass = (typeof ACTION_RISK_CLASSES)[number];

export function isActionRiskClass(value: unknown): value is ActionRiskClass {
  return typeof value === 'string' && (ACTION_RISK_CLASSES as readonly string[]).includes(value);
}

export const RISK_VERDICT_DECISIONS = ['APPROVED', 'REJECTED', 'NEEDS_REVIEW'] as const;
export type RiskVerdictDecision = (typeof RISK_VERDICT_DECISIONS)[number];

/**
 * Immutable evidence that actually decided the verdict. For a rejection or
 * review this is every non-PASS blocking check, in evaluator order. For an
 * approval it is every blocking PASS check, also in evaluator order.
 */
export interface RiskDecisiveInputSnapshot {
  readonly evaluatedAt: number;
  readonly checks: readonly Readonly<RiskCheck>[];
}

// ---------- check / verdict shapes ----------

export interface RiskCheck {
  /** Stable check code, UPPER_SNAKE, e.g. 'KILL_SWITCH', 'MAX_GROSS_NOTIONAL'. */
  code: string;
  status: RiskCheckStatus;
  /** True when a non-PASS status blocks the action. */
  blocking: boolean;
  detail: string;
  /** What was observed; null when genuinely unknown (never a fake 0). */
  observed: number | string | null;
  /** The limit compared against; null when the check has no scalar limit. */
  limit: number | string | null;
  /** Injected-clock time of the evidence used; null when no evidence exists. */
  evidenceTimestamp: number | null;
}

export interface RiskVerdict {
  /** Stable caller correlation, preserved through Ledger and UI projections. */
  correlationId: string;
  /** Explicit three-way outcome. NEEDS_REVIEW is never execution authority. */
  decision: RiskVerdictDecision;
  allowed: boolean;
  /** Maximum gross USD size established by the evaluator; null when unknown. */
  maxAllowedSize: number | null;
  /** True only for NEEDS_REVIEW; confirmation cannot override allowed=false. */
  requiredConfirmation: boolean;
  /** Ordered, frozen evidence that determined the explicit outcome. */
  decisiveInputSnapshot: Readonly<RiskDecisiveInputSnapshot>;
  /** From the caller's injected clock. */
  evaluatedAt: number;
  /** evaluatedAt + ttl; a verdict is never valid forever. */
  expiresAt: number;
  checks: readonly RiskCheck[];
  /** Codes of blocking checks that were not PASS, in check order. */
  blockingCodes: readonly string[];
}

// ---------- validation ----------

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Canonical owner bound inherited by every decisive-evidence projection. */
export const MAX_RISK_VERDICT_CHECKS = 512;

/** Stable plain-decimal projection for the verdict-scoped numeric authority. */
export function riskMaximumExactDecimal(value: number | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) throw new TypeError('risk maximum must be finite and non-negative');
  const rendered = String(value);
  if (!/[eE]/.test(rendered)) return rendered;
  const [coefficient, exponentText] = rendered.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const digits = coefficient.replace('.', '');
  const fractionalDigits = coefficient.includes('.') ? coefficient.length - coefficient.indexOf('.') - 1 : 0;
  const decimalOffset = exponent - fractionalDigits;
  if (decimalOffset >= 0) return `${digits}${'0'.repeat(decimalOffset)}`;
  const decimalIndex = digits.length + decimalOffset;
  return decimalIndex > 0
    ? `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`
    : `0.${'0'.repeat(-decimalIndex)}${digits}`;
}

/** Structural validation of one check. Empty array = valid. */
export function validateRiskCheck(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [{ path: '', code: 'OBJECT_REQUIRED', message: 'risk check must be a plain object' }];
  }
  const rec = input as Record<string, unknown>;
  if (typeof rec.code !== 'string' || !CODE_PATTERN.test(rec.code)) {
    issues.push({ path: 'code', code: 'CODE_FORMAT_INVALID', message: 'code must match /^[A-Z][A-Z0-9_]{0,99}$/' });
  }
  if (!isRiskCheckStatus(rec.status)) {
    issues.push({ path: 'status', code: 'STATUS_INVALID', message: "status must be 'PASS' | 'FAIL' | 'UNKNOWN'" });
  }
  if (typeof rec.blocking !== 'boolean') {
    issues.push({ path: 'blocking', code: 'BOOLEAN_REQUIRED', message: 'blocking must be a boolean' });
  }
  if (typeof rec.detail !== 'string' || rec.detail.trim().length === 0 || rec.detail.length > 1000) {
    issues.push({ path: 'detail', code: 'NON_EMPTY_STRING_REQUIRED', message: 'detail must be a non-empty string (<=1000 chars)' });
  }
  for (const field of ['observed', 'limit'] as const) {
    const v = rec[field];
    const okType =
      v === null ||
      (typeof v === 'number' && Number.isFinite(v)) ||
      (typeof v === 'string' && v.length > 0 && v.length <= 300);
    if (!okType) {
      issues.push({ path: field, code: 'OBSERVED_LIMIT_INVALID', message: `${field} must be null, a finite number, or a non-empty string` });
    }
  }
  if (rec.evidenceTimestamp !== null && !isValidUtcMillis(rec.evidenceTimestamp)) {
    issues.push({ path: 'evidenceTimestamp', code: 'UTC_MILLIS_INVALID', message: 'evidenceTimestamp must be null or valid UTC ms' });
  }
  return issues;
}

// ---------- deterministic verdict derivation ----------

export interface RiskVerdictInput {
  /** Stable caller correlation; never inferred from check evidence. */
  correlationId: string;
  checks: readonly RiskCheck[];
  /** From the caller's injected clock. */
  evaluatedAt: number;
  /** Verdict validity window, ms (> 0). */
  ttlMs: number;
  /** Evaluator-established maximum gross USD size; null/omitted = unknown. */
  maxAllowedSize?: number | null;
}

/**
 * Derive the verdict from evaluated checks — THE fail-closed law:
 * allowed only when every blocking check is PASS. Blocking FAIL blocks;
 * blocking UNKNOWN blocks identically (missing truth is not permission).
 * Non-blocking failures are preserved in `checks` but do not block.
 * Throws TypeError on malformed input; check order is preserved.
 */
export function deriveRiskVerdict(input: RiskVerdictInput): Readonly<RiskVerdict> {
  if (typeof input.correlationId !== 'string' || !CORRELATION_ID_PATTERN.test(input.correlationId)) {
    throw new TypeError('deriveRiskVerdict: correlationId is invalid');
  }
  if (!Array.isArray(input.checks)) {
    throw new TypeError('deriveRiskVerdict: checks must be an array');
  }
  if (input.checks.length > MAX_RISK_VERDICT_CHECKS) {
    throw new TypeError(`deriveRiskVerdict: checks must contain at most ${MAX_RISK_VERDICT_CHECKS} entries`);
  }
  input.checks.forEach((check, i) => {
    const issues = validateRiskCheck(check);
    if (issues.length > 0) {
      throw new TypeError(
        `deriveRiskVerdict: invalid check at index ${i} — ${issues.map((x) => `${x.path}:${x.code}`).join(', ')}`,
      );
    }
  });
  if (!isValidUtcMillis(input.evaluatedAt)) {
    throw new TypeError('deriveRiskVerdict: evaluatedAt must be a valid UTC ms from an injected clock');
  }
  if (typeof input.ttlMs !== 'number' || !Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0) {
    throw new TypeError('deriveRiskVerdict: ttlMs must be a positive safe integer');
  }
  if (input.maxAllowedSize !== undefined && input.maxAllowedSize !== null
      && (typeof input.maxAllowedSize !== 'number'
        || !Number.isFinite(input.maxAllowedSize)
        || input.maxAllowedSize < 0)) {
    throw new TypeError('deriveRiskVerdict: maxAllowedSize must be null or a finite non-negative number');
  }
  if (input.maxAllowedSize !== undefined && input.maxAllowedSize !== null
      && (riskMaximumExactDecimal(input.maxAllowedSize)?.length ?? 0) > 80) {
    throw new TypeError('deriveRiskVerdict: maxAllowedSize exceeds the exact-decimal bound');
  }

  const frozenChecks = Object.freeze(
    input.checks.map((c) =>
      Object.freeze({
        code: c.code,
        status: c.status,
        blocking: c.blocking,
        detail: c.detail,
        observed: c.observed,
        limit: c.limit,
        evidenceTimestamp: c.evidenceTimestamp,
      }),
    ),
  );
  const blockingCodes = Object.freeze(
    frozenChecks.filter((c) => c.blocking && c.status !== 'PASS').map((c) => c.code),
  );
  const hasBlockingFailure = frozenChecks.some((c) => c.blocking && c.status === 'FAIL');
  const hasBlockingUnknown = frozenChecks.some((c) => c.blocking && c.status === 'UNKNOWN');
  const decision: RiskVerdictDecision = hasBlockingFailure
    ? 'REJECTED'
    : hasBlockingUnknown
      ? 'NEEDS_REVIEW'
      : 'APPROVED';
  if (decision === 'APPROVED' && (input.maxAllowedSize === undefined || input.maxAllowedSize === null)) {
    throw new TypeError('deriveRiskVerdict: an approval requires an exact maxAllowedSize');
  }
  if (decision === 'APPROVED' && !frozenChecks.some((check) => check.blocking)) {
    throw new TypeError('deriveRiskVerdict: an approval requires decisive blocking evidence');
  }
  const decisiveChecks = Object.freeze(
    frozenChecks.filter((c) => c.blocking && (decision === 'APPROVED' || c.status !== 'PASS')),
  );
  const decisiveInputSnapshot = Object.freeze({
    evaluatedAt: input.evaluatedAt,
    checks: decisiveChecks,
  });
  const maxAllowedSize = decision === 'APPROVED'
    ? input.maxAllowedSize as number
    : decision === 'REJECTED'
      ? 0
      : null;
  return Object.freeze({
    correlationId: input.correlationId,
    decision,
    allowed: decision === 'APPROVED',
    maxAllowedSize,
    requiredConfirmation: decision === 'NEEDS_REVIEW',
    decisiveInputSnapshot,
    evaluatedAt: input.evaluatedAt,
    expiresAt: input.evaluatedAt + input.ttlMs,
    checks: frozenChecks,
    blockingCodes,
  });
}
