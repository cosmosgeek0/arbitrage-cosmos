/**
 * Lane H — deterministic health/telemetry projection.
 *
 * Semantic choices are intentionally small and explicit:
 *   - age is calculated from exported timestamps against injected `nowMs`;
 *   - a rate requires two timestamped cumulative samples from one writer;
 *   - counter reset, non-positive window, clock skew, and absence are
 *     different outcomes and never become a fabricated zero rate;
 *   - lifecycle phase is evidence, not a synonym for health;
 *   - confirmed failure outranks block, which outranks degradation; UNKNOWN
 *     is used only when no stronger confirmed condition exists.
 */
import {
  createDiagnosticEnvelope,
  downgradeAuthority,
  evaluateFreshness,
  fail,
  failureFromIssues,
  isDataAuthority,
  isDesiredRuntimeState,
  isLiveAuthority,
  isPreflightGateStatus,
  isRunMode,
  isRuntimePhase,
  isStructuredFailure,
  isValidUtcMillis,
  validateSourcedTimestamp,
  weakestAuthority,
  type DataAuthority,
  type FreshnessReport,
  type FreshnessState,
  type HealthState,
  type RuntimeStatusSnapshot,
  type SourcedTimestamp,
  type ValidationIssue,
} from '../contracts/index.js';
import {
  BASELINE_STATES,
  OBSERVABILITY_FAILURE_CODES,
  type AgeDiagnostic,
  type AuthorityLabel,
  type BaselineDiagnostic,
  type BaselineEvidence,
  type BorrowCoverageDiagnostic,
  type BorrowCoverageEvidence,
  type ComponentDiagnostic,
  type CounterWindowEvidence,
  type DiagnosticsInput,
  type DiagnosticsPolicy,
  type DiagnosticsResult,
  type DiagnosticsSnapshot,
  type FailedPreflightDiagnostic,
  type HealthReason,
  type PipelineCountsDiagnostic,
  type PipelineCountsEvidence,
  type RateDiagnostic,
  type RejectionCountEvidence,
  type SourceDiagnostic,
  type SourceDiagnosticEvidence,
  type SupervisorDiagnostic,
  type SupervisorDiagnosticEvidence,
} from './types.js';

const COMPONENT = 'foundation.observability';
const REJECTION_CODE = /^[A-Z][A-Z0-9_]{0,99}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Locale-independent UTF-16 code-unit ordering (same inputs => same bytes everywhere). */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function addIssue(
  issues: ValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

function validLabel(value: unknown, maxLength = 200): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function validNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validateNullableUtc(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== null && !isValidUtcMillis(value)) {
    addIssue(issues, path, 'UTC_MILLIS_OR_NULL_REQUIRED', `${path} must be null or valid UTC milliseconds`);
  }
}

function validateNullableCount(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== null && !validNonNegativeInteger(value)) {
    addIssue(issues, path, 'NON_NEGATIVE_INTEGER_OR_NULL_REQUIRED', `${path} must be null or a non-negative safe integer`);
  }
}

function validateTimestamp(
  value: unknown,
  path: string,
  declaredAuthority: unknown,
  nowMs: number,
  skewToleranceMs: number,
  issues: ValidationIssue[],
): void {
  if (value === null) return;
  const timestampIssues = validateSourcedTimestamp(value);
  for (const issue of timestampIssues) {
    addIssue(
      issues,
      issue.path ? `${path}.${issue.path}` : path,
      issue.code,
      issue.message,
    );
  }
  if (
    timestampIssues.length === 0 &&
    isRecord(value) &&
    isDataAuthority(declaredAuthority) &&
    value.authority !== declaredAuthority
  ) {
    addIssue(
      issues,
      `${path}.authority`,
      'AUTHORITY_MISMATCH',
      `${path}.authority must match the evidence authority label`,
    );
  }
  if (timestampIssues.length === 0 && isRecord(value)) {
    const timestamp = value as unknown as SourcedTimestamp;
    if (timestamp.sourceTimeMs !== null && timestamp.sourceTimeMs > timestamp.receivedAtMs) {
      addIssue(
        issues,
        `${path}.sourceTimeMs`,
        'SOURCE_TIME_AFTER_RECEIPT',
        'sourceTimeMs cannot be later than the local receipt time',
      );
    }
    if (timestamp.receivedAtMs - nowMs > skewToleranceMs) {
      addIssue(
        issues,
        `${path}.receivedAtMs`,
        'RECEIPT_TIME_CLOCK_SKEWED',
        'receivedAtMs cannot be beyond the injected clock skew tolerance',
      );
    }
  }
}

function validateFailure(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== null && !isStructuredFailure(value)) {
    addIssue(issues, path, 'STRUCTURED_FAILURE_OR_NULL_REQUIRED', `${path} must be null or a StructuredFailure`);
  }
}

function validateCounterWindow(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value === null) return;
  if (!isRecord(value)) {
    addIssue(issues, path, 'COUNTER_WINDOW_OR_NULL_REQUIRED', `${path} must be null or a plain counter window`);
    return;
  }
  if (!isValidUtcMillis(value.startAtMs)) {
    addIssue(issues, `${path}.startAtMs`, 'UTC_MILLIS_INVALID', 'counter startAtMs must be valid UTC milliseconds');
  }
  if (!isValidUtcMillis(value.endAtMs)) {
    addIssue(issues, `${path}.endAtMs`, 'UTC_MILLIS_INVALID', 'counter endAtMs must be valid UTC milliseconds');
  }
  if (!validNonNegativeInteger(value.startCount)) {
    addIssue(issues, `${path}.startCount`, 'NON_NEGATIVE_INTEGER_REQUIRED', 'counter startCount must be a non-negative safe integer');
  }
  if (!validNonNegativeInteger(value.endCount)) {
    addIssue(issues, `${path}.endCount`, 'NON_NEGATIVE_INTEGER_REQUIRED', 'counter endCount must be a non-negative safe integer');
  }
}

function validateSource(
  value: unknown,
  index: number,
  nowMs: number,
  skewToleranceMs: number,
  issues: ValidationIssue[],
): void {
  const path = `sources[${index}]`;
  if (!isRecord(value)) {
    addIssue(issues, path, 'OBJECT_REQUIRED', 'source evidence must be a plain object');
    return;
  }
  if (!validLabel(value.sourceId)) {
    addIssue(issues, `${path}.sourceId`, 'NON_EMPTY_STRING_REQUIRED', 'sourceId must be a non-empty string (<=200 chars)');
  }
  if (typeof value.required !== 'boolean') {
    addIssue(issues, `${path}.required`, 'BOOLEAN_REQUIRED', 'required must be boolean');
  }
  if (!isDataAuthority(value.authority)) {
    addIssue(issues, `${path}.authority`, 'AUTHORITY_INVALID', 'authority must be a DataAuthority');
  }
  validateTimestamp(value.timestamp, `${path}.timestamp`, value.authority, nowMs, skewToleranceMs, issues);
  validateNullableUtc(value.heartbeatAtMs, `${path}.heartbeatAtMs`, issues);
  validateNullableUtc(value.lastSuccessfulCycleAtMs, `${path}.lastSuccessfulCycleAtMs`, issues);
  validateFailure(value.lastError, `${path}.lastError`, issues);
  validateNullableCount(value.consecutiveFailures, `${path}.consecutiveFailures`, issues);
  validateCounterWindow(value.eventCounter, `${path}.eventCounter`, issues);
  validateCounterWindow(value.messageCounter, `${path}.messageCounter`, issues);
  validateNullableCount(value.reconnectCount, `${path}.reconnectCount`, issues);
  validateNullableCount(value.sequenceGapCount, `${path}.sequenceGapCount`, issues);
}

function validateCounts(
  value: unknown,
  nowMs: number,
  skewToleranceMs: number,
  issues: ValidationIssue[],
): void {
  const path = 'counts';
  if (value === null) return;
  if (!isRecord(value)) {
    addIssue(issues, path, 'OBJECT_OR_NULL_REQUIRED', 'counts must be null or a plain object');
    return;
  }
  if (typeof value.required !== 'boolean') {
    addIssue(issues, `${path}.required`, 'BOOLEAN_REQUIRED', 'counts.required must be boolean');
  }
  if (!isDataAuthority(value.authority)) {
    addIssue(issues, `${path}.authority`, 'AUTHORITY_INVALID', 'counts.authority must be a DataAuthority');
  }
  validateTimestamp(value.timestamp, `${path}.timestamp`, value.authority, nowMs, skewToleranceMs, issues);
  for (const key of ['universe', 'candidates', 'focus', 'proposals'] as const) {
    validateNullableCount(value[key], `${path}.${key}`, issues);
  }
  if (value.rejectionCounts === null) return;
  if (!Array.isArray(value.rejectionCounts)) {
    addIssue(issues, `${path}.rejectionCounts`, 'ARRAY_OR_NULL_REQUIRED', 'rejectionCounts must be null or an array');
    return;
  }
  const seen = new Set<string>();
  let sum = 0;
  for (let index = 0; index < value.rejectionCounts.length; index += 1) {
    const entryPath = `${path}.rejectionCounts[${index}]`;
    if (!Object.prototype.hasOwnProperty.call(value.rejectionCounts, index)) {
      addIssue(issues, entryPath, 'SPARSE_ARRAY_ELEMENT', 'rejectionCounts cannot contain sparse slots');
      continue;
    }
    const entry = value.rejectionCounts[index];
    if (!isRecord(entry)) {
      addIssue(issues, entryPath, 'OBJECT_REQUIRED', 'rejection count must be a plain object');
      continue;
    }
    if (typeof entry.code !== 'string' || !REJECTION_CODE.test(entry.code)) {
      addIssue(issues, `${entryPath}.code`, 'REJECTION_CODE_INVALID', 'rejection code must be stable UPPER_SNAKE_CASE');
    } else if (seen.has(entry.code)) {
      addIssue(issues, `${entryPath}.code`, 'DUPLICATE_REJECTION_CODE', 'rejection codes must be unique');
    } else {
      seen.add(entry.code);
    }
    if (!validNonNegativeInteger(entry.count)) {
      addIssue(issues, `${entryPath}.count`, 'NON_NEGATIVE_INTEGER_REQUIRED', 'rejection count must be a non-negative safe integer');
    } else if (Number.isSafeInteger(sum + entry.count)) {
      sum += entry.count;
    } else {
      addIssue(issues, `${path}.rejectionCounts`, 'COUNT_SUM_UNSAFE', 'total rejection count exceeds safe integer range');
    }
  }
}

function validateBaseline(
  value: unknown,
  nowMs: number,
  skewToleranceMs: number,
  issues: ValidationIssue[],
): void {
  const path = 'baseline';
  if (value === null) return;
  if (!isRecord(value)) {
    addIssue(issues, path, 'OBJECT_OR_NULL_REQUIRED', 'baseline must be null or a plain object');
    return;
  }
  if (typeof value.required !== 'boolean') {
    addIssue(issues, `${path}.required`, 'BOOLEAN_REQUIRED', 'baseline.required must be boolean');
  }
  if (!isDataAuthority(value.authority)) {
    addIssue(issues, `${path}.authority`, 'AUTHORITY_INVALID', 'baseline.authority must be a DataAuthority');
  }
  validateTimestamp(value.timestamp, `${path}.timestamp`, value.authority, nowMs, skewToleranceMs, issues);
  if (typeof value.state !== 'string' || !(BASELINE_STATES as readonly string[]).includes(value.state)) {
    addIssue(issues, `${path}.state`, 'BASELINE_STATE_INVALID', 'baseline.state must be a BaselineState');
  }
}

function validateBorrow(
  value: unknown,
  nowMs: number,
  skewToleranceMs: number,
  issues: ValidationIssue[],
): void {
  const path = 'borrow';
  if (value === null) return;
  if (!isRecord(value)) {
    addIssue(issues, path, 'OBJECT_OR_NULL_REQUIRED', 'borrow must be null or a plain object');
    return;
  }
  if (typeof value.required !== 'boolean') {
    addIssue(issues, `${path}.required`, 'BOOLEAN_REQUIRED', 'borrow.required must be boolean');
  }
  if (!isDataAuthority(value.authority)) {
    addIssue(issues, `${path}.authority`, 'AUTHORITY_INVALID', 'borrow.authority must be a DataAuthority');
  }
  validateTimestamp(value.timestamp, `${path}.timestamp`, value.authority, nowMs, skewToleranceMs, issues);
  validateNullableCount(value.requiredAssetCount, `${path}.requiredAssetCount`, issues);
  validateNullableCount(value.coveredAssetCount, `${path}.coveredAssetCount`, issues);
  if (
    validNonNegativeInteger(value.requiredAssetCount) &&
    validNonNegativeInteger(value.coveredAssetCount) &&
    value.coveredAssetCount > value.requiredAssetCount
  ) {
    addIssue(
      issues,
      `${path}.coveredAssetCount`,
      'BORROW_COVERAGE_IMPOSSIBLE',
      'coveredAssetCount cannot exceed requiredAssetCount',
    );
  }
  if (value.required === false && validNonNegativeInteger(value.requiredAssetCount) && value.requiredAssetCount > 0) {
    addIssue(
      issues,
      `${path}.requiredAssetCount`,
      'BORROW_REQUIREMENT_CONTRADICTS_OPTIONAL',
      'requiredAssetCount must be zero or null when borrow.required is false',
    );
  }
}

function validateSnapshot(snapshot: unknown, nowMs: number, issues: ValidationIssue[]): void {
  const path = 'supervisor.snapshot';
  if (!isRecord(snapshot)) {
    addIssue(issues, path, 'OBJECT_REQUIRED', 'supervisor snapshot must be a plain object');
    return;
  }
  for (const key of ['revision', 'generation'] as const) {
    if (!validNonNegativeInteger(snapshot[key])) {
      addIssue(issues, `${path}.${key}`, 'NON_NEGATIVE_INTEGER_REQUIRED', `${key} must be a non-negative safe integer`);
    }
  }
  if (!isRunMode(snapshot.runMode)) {
    addIssue(issues, `${path}.runMode`, 'RUN_MODE_INVALID', 'runMode must be a RunMode');
  }
  if (!isDesiredRuntimeState(snapshot.desiredState)) {
    addIssue(issues, `${path}.desiredState`, 'DESIRED_STATE_INVALID', 'desiredState must be a DesiredRuntimeState');
  }
  if (!isRuntimePhase(snapshot.phase)) {
    addIssue(issues, `${path}.phase`, 'RUNTIME_PHASE_INVALID', 'phase must be a RuntimePhase');
  }
  if (snapshot.commandCorrelationId !== null && !validLabel(snapshot.commandCorrelationId, 128)) {
    addIssue(issues, `${path}.commandCorrelationId`, 'STRING_OR_NULL_REQUIRED', 'commandCorrelationId must be null or a non-empty string');
  }
  validateNullableUtc(snapshot.startedAt, `${path}.startedAt`, issues);
  validateNullableUtc(snapshot.lastTransitionAt, `${path}.lastTransitionAt`, issues);
  validateNullableUtc(snapshot.heartbeatAt, `${path}.heartbeatAt`, issues);
  if (snapshot.blockedAtGate !== null && !validLabel(snapshot.blockedAtGate)) {
    addIssue(issues, `${path}.blockedAtGate`, 'STRING_OR_NULL_REQUIRED', 'blockedAtGate must be null or a non-empty string');
  }
  validateFailure(snapshot.lastError, `${path}.lastError`, issues);

  if (!Array.isArray(snapshot.components)) {
    addIssue(issues, `${path}.components`, 'ARRAY_REQUIRED', 'components must be an array');
  } else {
    const names = new Set<string>();
    for (let index = 0; index < snapshot.components.length; index += 1) {
      const componentPath = `${path}.components[${index}]`;
      if (!Object.prototype.hasOwnProperty.call(snapshot.components, index)) {
        addIssue(issues, componentPath, 'SPARSE_ARRAY_ELEMENT', 'components cannot contain sparse slots');
        continue;
      }
      const component = snapshot.components[index];
      if (!isRecord(component)) {
        addIssue(issues, componentPath, 'OBJECT_REQUIRED', 'component status must be a plain object');
        continue;
      }
      if (!validLabel(component.name)) {
        addIssue(issues, `${componentPath}.name`, 'NON_EMPTY_STRING_REQUIRED', 'component name must be non-empty');
      } else if (names.has(component.name)) {
        addIssue(issues, `${componentPath}.name`, 'DUPLICATE_COMPONENT_NAME', 'component names must be unique');
      } else {
        names.add(component.name);
      }
      if (typeof component.required !== 'boolean') {
        addIssue(issues, `${componentPath}.required`, 'BOOLEAN_REQUIRED', 'component.required must be boolean');
      }
      if (!isRuntimePhase(component.phase)) {
        addIssue(issues, `${componentPath}.phase`, 'RUNTIME_PHASE_INVALID', 'component.phase must be a RuntimePhase');
      }
      if (!isDataAuthority(component.authority)) {
        addIssue(issues, `${componentPath}.authority`, 'AUTHORITY_INVALID', 'component.authority must be a DataAuthority');
      }
      validateNullableUtc(component.heartbeatAt, `${componentPath}.heartbeatAt`, issues);
      validateFailure(component.lastError, `${componentPath}.lastError`, issues);
    }
  }

  const blockingFailures: string[] = [];
  if (!Array.isArray(snapshot.preflight)) {
    addIssue(issues, `${path}.preflight`, 'ARRAY_REQUIRED', 'preflight must be an array');
  } else {
    const gates = new Set<string>();
    for (let index = 0; index < snapshot.preflight.length; index += 1) {
      const gatePath = `${path}.preflight[${index}]`;
      if (!Object.prototype.hasOwnProperty.call(snapshot.preflight, index)) {
        addIssue(issues, gatePath, 'SPARSE_ARRAY_ELEMENT', 'preflight cannot contain sparse slots');
        continue;
      }
      const gate = snapshot.preflight[index];
      if (!isRecord(gate)) {
        addIssue(issues, gatePath, 'OBJECT_REQUIRED', 'preflight result must be a plain object');
        continue;
      }
      if (!validLabel(gate.gate)) {
        addIssue(issues, `${gatePath}.gate`, 'NON_EMPTY_STRING_REQUIRED', 'gate name must be non-empty');
      } else if (gates.has(gate.gate)) {
        addIssue(issues, `${gatePath}.gate`, 'DUPLICATE_PREFLIGHT_GATE', 'preflight gate names must be unique');
      } else {
        gates.add(gate.gate);
      }
      if (!isPreflightGateStatus(gate.status)) {
        addIssue(issues, `${gatePath}.status`, 'PREFLIGHT_STATUS_INVALID', 'gate status must be a PreflightGateStatus');
      }
      if (typeof gate.blocking !== 'boolean') {
        addIssue(issues, `${gatePath}.blocking`, 'BOOLEAN_REQUIRED', 'gate.blocking must be boolean');
      }
      if (typeof gate.detail !== 'string') {
        addIssue(issues, `${gatePath}.detail`, 'STRING_REQUIRED', 'gate.detail must be a string');
      }
      validateNullableUtc(gate.checkedAt, `${gatePath}.checkedAt`, issues);
      if (gate.status === 'SKIPPED' && gate.checkedAt !== null) {
        addIssue(issues, `${gatePath}.checkedAt`, 'SKIPPED_GATE_HAS_TIME', 'a skipped gate must have checkedAt=null');
      }
      if (gate.status !== 'SKIPPED' && gate.checkedAt === null) {
        addIssue(issues, `${gatePath}.checkedAt`, 'CHECKED_GATE_MISSING_TIME', 'a checked gate must have a checkedAt time');
      }
      if (isValidUtcMillis(gate.checkedAt) && gate.checkedAt > nowMs) {
        addIssue(issues, `${gatePath}.checkedAt`, 'PREFLIGHT_TIME_IN_FUTURE', 'preflight checkedAt cannot exceed injected nowMs');
      }
      if (
        validLabel(gate.gate) &&
        gate.blocking === true &&
        (gate.status === 'FAIL' || gate.status === 'TIMEOUT')
      ) {
        blockingFailures.push(gate.gate);
      }
    }
  }

  const phase = isRuntimePhase(snapshot.phase) ? snapshot.phase : null;
  const blockedAtGate = validLabel(snapshot.blockedAtGate) ? snapshot.blockedAtGate : null;
  if (blockingFailures.length > 1) {
    addIssue(
      issues,
      `${path}.preflight`,
      'MULTIPLE_BLOCKING_PREFLIGHT_FAILURES',
      'a deterministic preflight chain can expose at most one blocking failure',
    );
  }
  if (phase === 'BLOCKED') {
    if (blockedAtGate === null) {
      addIssue(
        issues,
        `${path}.blockedAtGate`,
        'BLOCKED_GATE_REQUIRED',
        'BLOCKED phase requires the exact failed blocking preflight gate',
      );
    } else if (!blockingFailures.includes(blockedAtGate)) {
      addIssue(
        issues,
        `${path}.blockedAtGate`,
        'BLOCKED_GATE_EVIDENCE_MISSING',
        'blockedAtGate must match a blocking FAIL or TIMEOUT preflight result',
      );
    }
  } else {
    if (blockedAtGate !== null) {
      addIssue(
        issues,
        `${path}.blockedAtGate`,
        'BLOCKED_GATE_PHASE_MISMATCH',
        'blockedAtGate must be null unless supervisor phase is BLOCKED',
      );
    }
    if (blockingFailures.length > 0) {
      addIssue(
        issues,
        `${path}.preflight`,
        'BLOCKING_PREFLIGHT_PHASE_MISMATCH',
        'a blocking preflight failure requires supervisor phase BLOCKED',
      );
    }
  }
}

function validateSupervisor(value: unknown, nowMs: number, issues: ValidationIssue[]): void {
  const path = 'supervisor';
  if (value === null) return;
  if (!isRecord(value)) {
    addIssue(issues, path, 'OBJECT_OR_NULL_REQUIRED', 'supervisor must be null or a plain object');
    return;
  }
  if (!isDataAuthority(value.authority)) {
    addIssue(issues, `${path}.authority`, 'AUTHORITY_INVALID', 'supervisor.authority must be a DataAuthority');
  }
  validateSnapshot(value.snapshot, nowMs, issues);
}

function validateEvidence(input: Record<string, unknown>, policy: DiagnosticsPolicy): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nowMs = input.nowMs as number;
  validateSupervisor(input.supervisor, nowMs, issues);
  if (!Array.isArray(input.sources)) {
    addIssue(issues, 'sources', 'ARRAY_REQUIRED', 'sources must be an array');
  } else {
    const ids = new Set<string>();
    for (let index = 0; index < input.sources.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(input.sources, index)) {
        addIssue(issues, `sources[${index}]`, 'SPARSE_ARRAY_ELEMENT', 'sources cannot contain sparse slots');
        continue;
      }
      const source = input.sources[index];
      validateSource(source, index, nowMs, policy.clockSkewToleranceMs, issues);
      if (isRecord(source) && validLabel(source.sourceId)) {
        if (ids.has(source.sourceId)) {
          addIssue(issues, `sources[${index}].sourceId`, 'DUPLICATE_SOURCE_ID', 'source IDs must be unique');
        } else {
          ids.add(source.sourceId);
        }
      }
    }
  }
  validateCounts(input.counts, nowMs, policy.clockSkewToleranceMs, issues);
  validateBaseline(input.baseline, nowMs, policy.clockSkewToleranceMs, issues);
  validateBorrow(input.borrow, nowMs, policy.clockSkewToleranceMs, issues);
  return issues;
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`deriveDiagnostics: policy.${name} must be a positive safe integer`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`deriveDiagnostics: policy.${name} must be a non-negative safe integer`);
  }
  return value;
}

function validatePolicy(value: unknown): DiagnosticsPolicy {
  if (!isRecord(value)) throw new TypeError('deriveDiagnostics: policy must be a plain object');
  const policy: DiagnosticsPolicy = {
    heartbeatMaxAgeMs: requirePositiveInteger(value.heartbeatMaxAgeMs, 'heartbeatMaxAgeMs'),
    cycleMaxAgeMs: requirePositiveInteger(value.cycleMaxAgeMs, 'cycleMaxAgeMs'),
    rateMaxAgeMs: requirePositiveInteger(value.rateMaxAgeMs, 'rateMaxAgeMs'),
    clockSkewToleranceMs: requireNonNegativeInteger(value.clockSkewToleranceMs, 'clockSkewToleranceMs'),
    consecutiveFailuresDegradedAt: requirePositiveInteger(
      value.consecutiveFailuresDegradedAt,
      'consecutiveFailuresDegradedAt',
    ),
    consecutiveFailuresFailedAt: requirePositiveInteger(
      value.consecutiveFailuresFailedAt,
      'consecutiveFailuresFailedAt',
    ),
    maxSequenceGaps: requireNonNegativeInteger(value.maxSequenceGaps, 'maxSequenceGaps'),
  };
  if (policy.consecutiveFailuresFailedAt <= policy.consecutiveFailuresDegradedAt) {
    throw new TypeError(
      'deriveDiagnostics: policy.consecutiveFailuresFailedAt must exceed consecutiveFailuresDegradedAt',
    );
  }
  return policy;
}

function unavailableFreshness(nowMs: number): FreshnessReport {
  return {
    state: 'UNAVAILABLE',
    ageMs: null,
    basis: 'NONE',
    effectiveAuthority: 'UNAVAILABLE',
    evaluatedAt: nowMs,
  };
}

function deriveFreshness(
  timestamp: SourcedTimestamp | null,
  nowMs: number,
  skewToleranceMs: number,
): Readonly<FreshnessReport> {
  return timestamp === null
    ? unavailableFreshness(nowMs)
    : evaluateFreshness(timestamp, nowMs, skewToleranceMs);
}

function deriveAge(
  atMs: number | null,
  nowMs: number,
  maxAgeMs: number,
  skewToleranceMs: number,
): AgeDiagnostic {
  if (atMs === null) return { state: 'UNKNOWN', atMs: null, ageMs: null, maxAgeMs };
  const ageMs = nowMs - atMs;
  if (ageMs < -skewToleranceMs) {
    return { state: 'CLOCK_SKEWED', atMs, ageMs, maxAgeMs };
  }
  if (ageMs > maxAgeMs) return { state: 'STALE', atMs, ageMs, maxAgeMs };
  return { state: 'KNOWN', atMs, ageMs, maxAgeMs };
}

function deriveRate(
  window: CounterWindowEvidence | null,
  nowMs: number,
  maxAgeMs: number,
  skewToleranceMs: number,
): RateDiagnostic {
  if (window === null) {
    return {
      state: 'UNKNOWN',
      perSecond: null,
      deltaCount: null,
      windowMs: null,
      startAtMs: null,
      endAtMs: null,
      ageMs: null,
      maxAgeMs,
    };
  }
  const ageMs = nowMs - window.endAtMs;
  const base = {
    startAtMs: window.startAtMs,
    endAtMs: window.endAtMs,
    ageMs,
    maxAgeMs,
  };
  const windowMs = window.endAtMs - window.startAtMs;
  if (windowMs <= 0) {
    return { state: 'INVALID_WINDOW', perSecond: null, deltaCount: null, windowMs, ...base };
  }
  if (ageMs < -skewToleranceMs) {
    return { state: 'CLOCK_SKEWED', perSecond: null, deltaCount: null, windowMs, ...base };
  }
  if (window.endCount < window.startCount) {
    return { state: 'COUNTER_RESET', perSecond: null, deltaCount: null, windowMs, ...base };
  }
  const deltaCount = window.endCount - window.startCount;
  if (ageMs > maxAgeMs) {
    return { state: 'STALE', perSecond: null, deltaCount, windowMs, ...base };
  }
  return {
    state: 'KNOWN',
    perSecond: (deltaCount * 1_000) / windowMs,
    deltaCount,
    windowMs,
    ...base,
  };
}

function freshnessStateFromAge(age: AgeDiagnostic): FreshnessState {
  if (age.state === 'KNOWN') return 'FRESH';
  if (age.state === 'STALE') return 'STALE';
  if (age.state === 'CLOCK_SKEWED') return 'CLOCK_SKEWED';
  return 'UNAVAILABLE';
}

function deriveSource(
  evidence: SourceDiagnosticEvidence,
  nowMs: number,
  policy: DiagnosticsPolicy,
): SourceDiagnostic {
  const freshness = deriveFreshness(evidence.timestamp, nowMs, policy.clockSkewToleranceMs);
  return {
    sourceId: evidence.sourceId,
    required: evidence.required,
    declaredAuthority: evidence.authority,
    effectiveAuthority: freshness.effectiveAuthority,
    freshness,
    heartbeat: deriveAge(
      evidence.heartbeatAtMs,
      nowMs,
      policy.heartbeatMaxAgeMs,
      policy.clockSkewToleranceMs,
    ),
    lastSuccessfulCycle: deriveAge(
      evidence.lastSuccessfulCycleAtMs,
      nowMs,
      policy.cycleMaxAgeMs,
      policy.clockSkewToleranceMs,
    ),
    lastError: evidence.lastError,
    consecutiveFailures: evidence.consecutiveFailures,
    eventRate: deriveRate(evidence.eventCounter, nowMs, policy.rateMaxAgeMs, policy.clockSkewToleranceMs),
    messageRate: deriveRate(evidence.messageCounter, nowMs, policy.rateMaxAgeMs, policy.clockSkewToleranceMs),
    reconnectCount: evidence.reconnectCount,
    sequenceGapCount: evidence.sequenceGapCount,
  };
}

function unknownSupervisor(policy: DiagnosticsPolicy): SupervisorDiagnostic {
  return {
    phase: 'UNKNOWN',
    declaredAuthority: 'UNAVAILABLE',
    effectiveAuthority: 'UNAVAILABLE',
    heartbeat: deriveAge(null, 0, policy.heartbeatMaxAgeMs, policy.clockSkewToleranceMs),
    blockedAtGate: null,
    failedPreflight: [],
    components: [],
    lastError: null,
  };
}

function deriveSupervisor(
  evidence: SupervisorDiagnosticEvidence | null,
  nowMs: number,
  policy: DiagnosticsPolicy,
): SupervisorDiagnostic {
  if (evidence === null) {
    const unknown = unknownSupervisor(policy);
    unknown.heartbeat = deriveAge(null, nowMs, policy.heartbeatMaxAgeMs, policy.clockSkewToleranceMs);
    return unknown;
  }
  const snapshot = evidence.snapshot;
  const heartbeat = deriveAge(
    snapshot.heartbeatAt,
    nowMs,
    policy.heartbeatMaxAgeMs,
    policy.clockSkewToleranceMs,
  );
  const state = freshnessStateFromAge(heartbeat);
  const components: ComponentDiagnostic[] = snapshot.components
    .map((component) => ({
      name: component.name,
      required: component.required,
      phase: component.phase,
      authority: component.authority,
      heartbeat: deriveAge(
        component.heartbeatAt,
        nowMs,
        policy.heartbeatMaxAgeMs,
        policy.clockSkewToleranceMs,
      ),
      lastError: component.lastError,
    }))
    .sort((a, b) => compareCodeUnits(a.name, b.name));
  const failedPreflight: FailedPreflightDiagnostic[] = snapshot.preflight
    .filter((gate): gate is typeof gate & { status: 'FAIL' | 'TIMEOUT' } =>
      gate.status === 'FAIL' || gate.status === 'TIMEOUT')
    .map((gate) => ({
      gate: gate.gate,
      status: gate.status,
      blocking: gate.blocking,
      checkedAt: gate.checkedAt,
    }))
    .sort((a, b) => compareCodeUnits(a.gate, b.gate));
  return {
    phase: snapshot.phase,
    declaredAuthority: evidence.authority,
    effectiveAuthority: downgradeAuthority(evidence.authority, state),
    heartbeat,
    blockedAtGate: snapshot.blockedAtGate,
    failedPreflight,
    components,
    lastError: snapshot.lastError,
  };
}

function deriveCounts(
  evidence: PipelineCountsEvidence | null,
  nowMs: number,
  policy: DiagnosticsPolicy,
): PipelineCountsDiagnostic {
  if (evidence === null) {
    return {
      required: null,
      declaredAuthority: 'UNAVAILABLE',
      effectiveAuthority: 'UNAVAILABLE',
      freshness: unavailableFreshness(nowMs),
      universe: null,
      candidates: null,
      focus: null,
      proposals: null,
      rejectionCounts: null,
      totalRejections: null,
    };
  }
  const freshness = deriveFreshness(evidence.timestamp, nowMs, policy.clockSkewToleranceMs);
  const rejectionCounts = evidence.rejectionCounts === null
    ? null
    : [...evidence.rejectionCounts].sort((a, b) => compareCodeUnits(a.code, b.code));
  const totalRejections = rejectionCounts === null
    ? null
    : rejectionCounts.reduce((sum, entry) => sum + entry.count, 0);
  return {
    required: evidence.required,
    declaredAuthority: evidence.authority,
    effectiveAuthority: freshness.effectiveAuthority,
    freshness,
    universe: evidence.universe,
    candidates: evidence.candidates,
    focus: evidence.focus,
    proposals: evidence.proposals,
    rejectionCounts,
    totalRejections,
  };
}

function deriveBaseline(
  evidence: BaselineEvidence | null,
  nowMs: number,
  policy: DiagnosticsPolicy,
): BaselineDiagnostic {
  if (evidence === null) {
    return {
      required: null,
      state: 'UNKNOWN',
      declaredAuthority: 'UNAVAILABLE',
      effectiveAuthority: 'UNAVAILABLE',
      freshness: unavailableFreshness(nowMs),
    };
  }
  const freshness = deriveFreshness(evidence.timestamp, nowMs, policy.clockSkewToleranceMs);
  return {
    required: evidence.required,
    state: evidence.state,
    declaredAuthority: evidence.authority,
    effectiveAuthority: freshness.effectiveAuthority,
    freshness,
  };
}

function deriveBorrow(
  evidence: BorrowCoverageEvidence | null,
  nowMs: number,
  policy: DiagnosticsPolicy,
): BorrowCoverageDiagnostic {
  if (evidence === null) {
    return {
      required: null,
      state: 'UNKNOWN',
      requiredAssetCount: null,
      coveredAssetCount: null,
      uncoveredAssetCount: null,
      coverageRatio: null,
      declaredAuthority: 'UNAVAILABLE',
      effectiveAuthority: 'UNAVAILABLE',
      freshness: unavailableFreshness(nowMs),
    };
  }
  const freshness = deriveFreshness(evidence.timestamp, nowMs, policy.clockSkewToleranceMs);
  const requiredCount = evidence.requiredAssetCount;
  const coveredCount = evidence.coveredAssetCount;
  let state: BorrowCoverageDiagnostic['state'];
  let uncoveredAssetCount: number | null = null;
  let coverageRatio: number | null = null;
  if (!evidence.required) {
    state = 'NOT_REQUIRED';
  } else if (requiredCount === null || coveredCount === null) {
    state = 'UNKNOWN';
  } else if (requiredCount === 0) {
    state = 'NOT_REQUIRED';
  } else {
    uncoveredAssetCount = requiredCount - coveredCount;
    coverageRatio = coveredCount / requiredCount;
    if (coveredCount === requiredCount) state = 'FULL';
    else if (coveredCount === 0) state = 'NONE';
    else state = 'PARTIAL';
  }
  return {
    required: evidence.required,
    state,
    requiredAssetCount: requiredCount,
    coveredAssetCount: coveredCount,
    uncoveredAssetCount,
    coverageRatio,
    declaredAuthority: evidence.authority,
    effectiveAuthority: freshness.effectiveAuthority,
    freshness,
  };
}

function authorityLabel(
  label: string,
  declaredAuthority: DataAuthority,
  freshnessState: FreshnessState,
): AuthorityLabel {
  return {
    label,
    declaredAuthority,
    effectiveAuthority: downgradeAuthority(declaredAuthority, freshnessState),
    freshnessState,
  };
}

function buildAuthorityLabels(
  supervisor: SupervisorDiagnostic,
  sources: readonly SourceDiagnostic[],
  counts: PipelineCountsDiagnostic,
  baseline: BaselineDiagnostic,
  borrow: BorrowCoverageDiagnostic,
): AuthorityLabel[] {
  const labels: AuthorityLabel[] = [
    authorityLabel(
      'supervisor',
      supervisor.declaredAuthority,
      freshnessStateFromAge(supervisor.heartbeat),
    ),
    authorityLabel('counts', counts.declaredAuthority, counts.freshness.state),
    authorityLabel('baseline', baseline.declaredAuthority, baseline.freshness.state),
    authorityLabel('borrow', borrow.declaredAuthority, borrow.freshness.state),
  ];
  for (const component of supervisor.components) {
    labels.push(
      authorityLabel(
        `component:${component.name}`,
        component.authority,
        freshnessStateFromAge(component.heartbeat),
      ),
    );
  }
  for (const source of sources) {
    labels.push(
      authorityLabel(`source:${source.sourceId}`, source.declaredAuthority, source.freshness.state),
    );
  }
  labels.sort((a, b) => compareCodeUnits(a.label, b.label));
  return labels;
}

function addReason(
  reasons: HealthReason[],
  state: HealthReason['state'],
  code: string,
  subject: string,
): void {
  if (!reasons.some((reason) => reason.state === state && reason.code === code && reason.subject === subject)) {
    reasons.push({ state, code, subject });
  }
}

function addFreshnessReason(
  reasons: HealthReason[],
  freshness: FreshnessReport,
  subject: string,
  prefix: string,
): void {
  if (freshness.state === 'UNAVAILABLE') addReason(reasons, 'UNKNOWN', `${prefix}_FRESHNESS_UNKNOWN`, subject);
  if (freshness.state === 'STALE') addReason(reasons, 'DEGRADED', `${prefix}_STALE`, subject);
  if (freshness.state === 'CLOCK_SKEWED') addReason(reasons, 'DEGRADED', `${prefix}_CLOCK_SKEWED`, subject);
}

function addAgeReason(
  reasons: HealthReason[],
  age: AgeDiagnostic,
  subject: string,
  prefix: string,
): void {
  if (age.state === 'UNKNOWN') addReason(reasons, 'UNKNOWN', `${prefix}_UNKNOWN`, subject);
  if (age.state === 'STALE') addReason(reasons, 'DEGRADED', `${prefix}_STALE`, subject);
  if (age.state === 'CLOCK_SKEWED') addReason(reasons, 'DEGRADED', `${prefix}_CLOCK_SKEWED`, subject);
}

function addRateReason(
  reasons: HealthReason[],
  rate: RateDiagnostic,
  subject: string,
  prefix: string,
): void {
  if (rate.state === 'UNKNOWN') addReason(reasons, 'UNKNOWN', `${prefix}_UNKNOWN`, subject);
  if (rate.state === 'COUNTER_RESET') addReason(reasons, 'UNKNOWN', `${prefix}_COUNTER_RESET`, subject);
  if (rate.state === 'INVALID_WINDOW') addReason(reasons, 'DEGRADED', `${prefix}_INVALID_WINDOW`, subject);
  if (rate.state === 'STALE') addReason(reasons, 'DEGRADED', `${prefix}_STALE`, subject);
  if (rate.state === 'CLOCK_SKEWED') addReason(reasons, 'DEGRADED', `${prefix}_CLOCK_SKEWED`, subject);
}

function deriveOverall(
  input: DiagnosticsInput,
  supervisor: SupervisorDiagnostic,
  sources: readonly SourceDiagnostic[],
  counts: PipelineCountsDiagnostic,
  baseline: BaselineDiagnostic,
  borrow: BorrowCoverageDiagnostic,
  policy: DiagnosticsPolicy,
): { state: HealthState; reasons: HealthReason[] } {
  const reasons: HealthReason[] = [];

  if (input.supervisor === null) {
    addReason(reasons, 'UNKNOWN', 'SUPERVISOR_UNKNOWN', 'supervisor');
  } else {
    if (supervisor.declaredAuthority === 'UNAVAILABLE') {
      addReason(reasons, 'UNKNOWN', 'SUPERVISOR_AUTHORITY_UNKNOWN', 'supervisor');
    }
    if (supervisor.phase === 'FAILED') addReason(reasons, 'FAILED', 'SUPERVISOR_FAILED', 'supervisor');
    else if (supervisor.phase === 'BLOCKED') addReason(reasons, 'BLOCKED', 'SUPERVISOR_BLOCKED', 'supervisor');
    else if (supervisor.phase === 'DEGRADED') addReason(reasons, 'DEGRADED', 'SUPERVISOR_DEGRADED', 'supervisor');
    else if (supervisor.phase !== 'RUNNING') {
      addReason(reasons, 'UNKNOWN', 'SUPERVISOR_NOT_RUNNING', 'supervisor');
    }
    if (supervisor.phase === 'RUNNING' || supervisor.phase === 'DEGRADED') {
      addAgeReason(reasons, supervisor.heartbeat, 'supervisor', 'SUPERVISOR_HEARTBEAT');
    }
    for (const gate of supervisor.failedPreflight) {
      addReason(
        reasons,
        gate.blocking ? 'BLOCKED' : 'DEGRADED',
        gate.status === 'TIMEOUT' ? 'PREFLIGHT_TIMEOUT' : 'PREFLIGHT_FAILED',
        `preflight:${gate.gate}`,
      );
    }
    for (const component of supervisor.components.filter((item) => item.required)) {
      if (component.phase === 'FAILED') addReason(reasons, 'FAILED', 'REQUIRED_COMPONENT_FAILED', `component:${component.name}`);
      else if (component.phase === 'BLOCKED') addReason(reasons, 'BLOCKED', 'REQUIRED_COMPONENT_BLOCKED', `component:${component.name}`);
      else if (component.phase === 'DEGRADED') addReason(reasons, 'DEGRADED', 'REQUIRED_COMPONENT_DEGRADED', `component:${component.name}`);
      else if (component.phase !== 'RUNNING') addReason(reasons, 'UNKNOWN', 'REQUIRED_COMPONENT_NOT_RUNNING', `component:${component.name}`);
      if (supervisor.phase === 'RUNNING' || supervisor.phase === 'DEGRADED') {
        addAgeReason(reasons, component.heartbeat, `component:${component.name}`, 'COMPONENT_HEARTBEAT');
        if (component.authority === 'UNAVAILABLE') {
          addReason(reasons, 'UNKNOWN', 'COMPONENT_AUTHORITY_UNKNOWN', `component:${component.name}`);
        }
      }
    }
  }

  if (sources.length === 0) addReason(reasons, 'UNKNOWN', 'SOURCE_EVIDENCE_EMPTY', 'sources');
  for (const source of sources.filter((item) => item.required)) {
    const subject = `source:${source.sourceId}`;
    addFreshnessReason(reasons, source.freshness, subject, 'SOURCE');
    addAgeReason(reasons, source.heartbeat, subject, 'SOURCE_HEARTBEAT');
    addAgeReason(reasons, source.lastSuccessfulCycle, subject, 'SOURCE_CYCLE');
    addRateReason(reasons, source.eventRate, subject, 'SOURCE_EVENT_RATE');
    addRateReason(reasons, source.messageRate, subject, 'SOURCE_MESSAGE_RATE');
    if (source.consecutiveFailures === null) {
      addReason(reasons, 'UNKNOWN', 'CONSECUTIVE_FAILURES_UNKNOWN', subject);
    } else if (source.consecutiveFailures >= policy.consecutiveFailuresFailedAt) {
      addReason(reasons, 'FAILED', 'CONSECUTIVE_FAILURE_LIMIT_REACHED', subject);
    } else if (source.consecutiveFailures >= policy.consecutiveFailuresDegradedAt) {
      addReason(reasons, 'DEGRADED', 'CONSECUTIVE_FAILURES_PRESENT', subject);
    }
    if (source.sequenceGapCount === null) {
      addReason(reasons, 'UNKNOWN', 'SEQUENCE_GAPS_UNKNOWN', subject);
    } else if (source.sequenceGapCount > policy.maxSequenceGaps) {
      addReason(reasons, 'DEGRADED', 'SEQUENCE_GAP_LIMIT_EXCEEDED', subject);
    }
  }

  if (input.counts === null) {
    addReason(reasons, 'UNKNOWN', 'PIPELINE_COUNTS_UNKNOWN', 'counts');
  } else if (counts.required) {
    addFreshnessReason(reasons, counts.freshness, 'counts', 'PIPELINE_COUNTS');
    if (
      counts.universe === null ||
      counts.candidates === null ||
      counts.focus === null ||
      counts.proposals === null ||
      counts.rejectionCounts === null
    ) {
      addReason(reasons, 'UNKNOWN', 'PIPELINE_COUNT_VALUE_UNKNOWN', 'counts');
    }
  }

  if (input.baseline === null) {
    addReason(reasons, 'UNKNOWN', 'BASELINE_UNKNOWN', 'baseline');
  } else if (baseline.required) {
    addFreshnessReason(reasons, baseline.freshness, 'baseline', 'BASELINE');
    if (baseline.state === 'FAILED') addReason(reasons, 'FAILED', 'BASELINE_FAILED', 'baseline');
    else if (baseline.state === 'STALE') addReason(reasons, 'DEGRADED', 'BASELINE_STATE_STALE', 'baseline');
    else if (baseline.state === 'WARMING') addReason(reasons, 'UNKNOWN', 'BASELINE_WARMING', 'baseline');
    else if (baseline.state === 'UNKNOWN') addReason(reasons, 'UNKNOWN', 'BASELINE_STATE_UNKNOWN', 'baseline');
  }

  if (input.borrow === null) {
    addReason(reasons, 'UNKNOWN', 'BORROW_COVERAGE_UNKNOWN', 'borrow');
  } else if (borrow.required) {
    addFreshnessReason(reasons, borrow.freshness, 'borrow', 'BORROW');
    if (borrow.state === 'NONE') addReason(reasons, 'BLOCKED', 'BORROW_COVERAGE_NONE', 'borrow');
    else if (borrow.state === 'PARTIAL') addReason(reasons, 'DEGRADED', 'BORROW_COVERAGE_PARTIAL', 'borrow');
    else if (borrow.state === 'UNKNOWN') addReason(reasons, 'UNKNOWN', 'BORROW_COVERAGE_UNKNOWN', 'borrow');
  }

  const rank: Record<HealthReason['state'], number> = {
    FAILED: 0,
    BLOCKED: 1,
    DEGRADED: 2,
    UNKNOWN: 3,
  };
  reasons.sort((a, b) =>
    rank[a.state] - rank[b.state] ||
    compareCodeUnits(a.code, b.code) ||
    compareCodeUnits(a.subject, b.subject));
  const state: HealthState = reasons.some((reason) => reason.state === 'FAILED')
    ? 'FAILED'
    : reasons.some((reason) => reason.state === 'BLOCKED')
      ? 'BLOCKED'
      : reasons.some((reason) => reason.state === 'DEGRADED')
        ? 'DEGRADED'
        : reasons.some((reason) => reason.state === 'UNKNOWN')
          ? 'UNKNOWN'
          : 'HEALTHY';
  return { state, reasons };
}

function provenanceAuthority(input: DiagnosticsInput): DataAuthority {
  const authorities: DataAuthority[] = [];
  if (input.supervisor !== null) authorities.push(input.supervisor.authority);
  for (const source of input.sources) authorities.push(source.authority);
  if (input.counts !== null) authorities.push(input.counts.authority);
  if (input.baseline !== null) authorities.push(input.baseline.authority);
  if (input.borrow !== null) authorities.push(input.borrow.authority);
  if (authorities.length === 0) return 'UNAVAILABLE';
  const weakest = weakestAuthority(...authorities);
  return isLiveAuthority(weakest) ? weakestAuthority(weakest, 'DERIVED_LIVE') : weakest;
}

/**
 * Build one guarded DiagnosticEnvelope from immutable input evidence.
 * Invalid adapter evidence is a named ContractResult failure; malformed
 * caller context/policy is a programming error and throws TypeError.
 */
export function deriveDiagnostics(input: DiagnosticsInput): DiagnosticsResult {
  if (!isRecord(input)) throw new TypeError('deriveDiagnostics: input must be a plain object');
  if (!isValidUtcMillis(input.nowMs)) {
    throw new TypeError('deriveDiagnostics: nowMs must be valid UTC milliseconds from an injected clock');
  }
  if (!validLabel(input.correlationId, 128)) {
    throw new TypeError('deriveDiagnostics: correlationId must be a non-empty string (<=128 chars)');
  }
  const policy = validatePolicy(input.policy);
  const issues = validateEvidence(input, policy);
  if (issues.length > 0) {
    return fail(
      failureFromIssues(issues, {
        component: COMPONENT,
        stage: 'validateEvidence',
        occurredAt: input.nowMs,
        correlationId: input.correlationId,
        code: OBSERVABILITY_FAILURE_CODES.EVIDENCE_INVALID,
        retryable: false,
        safeCurrentState: 'DIAGNOSTICS_NOT_EMITTED',
        recommendedOperatorAction: 'Fix the injected diagnostic evidence at its adapter boundary.',
      }),
    );
  }

  const typed = input as DiagnosticsInput;
  const sources = typed.sources
    .map((source) => deriveSource(source, typed.nowMs, policy))
    .sort((a, b) => compareCodeUnits(a.sourceId, b.sourceId));
  const supervisor = deriveSupervisor(typed.supervisor, typed.nowMs, policy);
  const counts = deriveCounts(typed.counts, typed.nowMs, policy);
  const baseline = deriveBaseline(typed.baseline, typed.nowMs, policy);
  const borrow = deriveBorrow(typed.borrow, typed.nowMs, policy);
  const authorityLabels = buildAuthorityLabels(supervisor, sources, counts, baseline, borrow);
  const overall = deriveOverall(typed, supervisor, sources, counts, baseline, borrow, policy);
  const snapshot: DiagnosticsSnapshot = {
    evaluatedAtMs: typed.nowMs,
    policy,
    supervisor,
    sources,
    counts,
    baseline,
    borrow,
    authorityLabels,
    overall,
  };

  return createDiagnosticEnvelope(
    {
      kind: 'foundation.observability.diagnostics',
      createdAt: typed.nowMs,
      authority: provenanceAuthority(typed),
      correlationId: typed.correlationId,
      payload: snapshot,
    },
    typed.nowMs,
  );
}
