/** Pure proposal-outcome record construction and identity validation. */
import {
  canonicalJson,
  fail,
  failureFromIssues,
  isStrategySource,
  isValidUtcMillis,
  ok,
  stableHash128Hex,
  type ValidationIssue,
} from '../contracts/index.js';
import {
  CALIBRATION_FAILURE_CODES,
  MAX_CALIBRATION_VALIDATION_ISSUES,
  OUTCOME_RESULT_UNITS,
  OUTCOME_STATUSES,
  PROBABILITY_PPM_SCALE,
  PROPOSAL_OUTCOME_SCHEMA,
  PROPOSAL_OUTCOME_SCHEMA_VERSION,
  type CalibrationContext,
  type ProposalOutcomeInput,
  type ProposalOutcomeRecord,
  type ProposalOutcomeRecordResult,
} from './types.js';

const COMPONENT = 'foundation.calibration';
const INPUT_KEYS = Object.freeze([
  'canonicalProposalId',
  'planId',
  'source',
  'strategySchema',
  'configVersion',
  'direction',
  'resultUnit',
  'proposalObservedAtMs',
  'observationWindow',
  'status',
  'finalizedAtMs',
  'predictedProbabilityPpm',
  'realizedSuccess',
  'grossResultMicrounits',
  'feesMicrounits',
  'slippageMicrounits',
  'otherCostsMicrounits',
  'netResultMicrounits',
  'fillRatioPpm',
] as const);
const RECORD_KEYS = Object.freeze([
  'schema',
  'schemaVersion',
  'outcomeId',
  'contentFingerprint',
  'recordedAtMs',
  ...INPUT_KEYS,
] as const);
const WINDOW_KEYS = Object.freeze(['startAtMs', 'endAtMs'] as const);
const CONTEXT_KEYS = Object.freeze(['nowMs', 'correlationId'] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function issue(issues: ValidationIssue[], path: string, code: string, message: string): void {
  if (issues.length < MAX_CALIBRATION_VALIDATION_ISSUES) issues.push({ path, code, message });
}

function label(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return safeInteger(value) && value >= 0;
}

function nullableSignedInteger(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== null && !safeInteger(value)) {
    issue(issues, path, 'SAFE_INTEGER_OR_NULL_REQUIRED', `${path} must be null or a safe integer`);
  }
}

function nullableNonNegativeInteger(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== null && !nonNegativeInteger(value)) {
    issue(issues, path, 'NON_NEGATIVE_INTEGER_OR_NULL_REQUIRED', `${path} must be null or a non-negative safe integer`);
  }
}

/** Exact enumerable data records only; reports accessors without invoking them. */
function inspectExactRecord(
  raw: unknown,
  expectedKeys: readonly string[],
  prefix: string,
  issues: ValidationIssue[],
): Record<string, unknown> | null {
  if (!isRecord(raw)) {
    issue(issues, prefix, 'OBJECT_REQUIRED', `${prefix || 'value'} must be a plain object`);
    return null;
  }
  const expected = new Set(expectedKeys);
  let safe = true;
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== 'string') {
      issue(issues, prefix, 'SYMBOL_FIELD_FORBIDDEN', 'symbol fields are not calibration evidence');
      safe = false;
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (!expected.has(key)) {
      issue(issues, path, 'UNKNOWN_FIELD', 'unexpected field is not part of calibration evidence');
      safe = false;
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      issue(issues, path, 'DATA_FIELD_REQUIRED', 'field must be an enumerable data property');
      safe = false;
    }
  }
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      issue(issues, prefix ? `${prefix}.${key}` : key, 'REQUIRED_FIELD_MISSING', 'required explicit field is missing');
      safe = false;
    }
  }
  return safe ? raw : null;
}

function validateContext(context: CalibrationContext, caller: string): void {
  const issues: ValidationIssue[] = [];
  const record = inspectExactRecord(context, CONTEXT_KEYS, 'context', issues);
  if (record === null) throw new TypeError(`${caller}: context must contain exact enumerable data fields`);
  if (!isValidUtcMillis(record.nowMs)) {
    throw new TypeError(`${caller}: context.nowMs must be UTC milliseconds from an injected clock`);
  }
  if (!label(record.correlationId, 128)) {
    throw new TypeError(`${caller}: context.correlationId must be a non-empty string (<=128 chars)`);
  }
}

function validateSemanticInput(rawInput: unknown, recordedAtMs: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const input = inspectExactRecord(rawInput, INPUT_KEYS, '', issues);
  if (input === null) return issues;

  if (!label(input.canonicalProposalId, 300) || !input.canonicalProposalId.startsWith('cprop_')) {
    issue(issues, 'canonicalProposalId', 'CANONICAL_PROPOSAL_ID_INVALID', 'canonicalProposalId must be a cprop_ identifier');
  }
  if (input.planId !== null && (!label(input.planId, 300) || !input.planId.startsWith('plan_'))) {
    issue(issues, 'planId', 'PLAN_ID_OR_NULL_REQUIRED', 'planId must be null or a plan_ identifier');
  }
  if (!isStrategySource(input.source)) {
    issue(issues, 'source', 'STRATEGY_SOURCE_INVALID', 'source must be BASIS or VOLUME');
  }
  if (!label(input.strategySchema, 200)) {
    issue(issues, 'strategySchema', 'NON_EMPTY_STRING_REQUIRED', 'strategySchema must be non-empty (<=200 chars)');
  }
  if (!label(input.configVersion, 200)) {
    issue(issues, 'configVersion', 'NON_EMPTY_STRING_REQUIRED', 'configVersion must be non-empty (<=200 chars)');
  }
  if (!label(input.direction, 128)) {
    issue(issues, 'direction', 'NON_EMPTY_STRING_REQUIRED', 'direction must be non-empty (<=128 chars)');
  }
  if (typeof input.resultUnit !== 'string' || !(OUTCOME_RESULT_UNITS as readonly string[]).includes(input.resultUnit)) {
    issue(issues, 'resultUnit', 'RESULT_UNIT_INVALID', 'resultUnit must be a supported exact integer unit');
  }
  if (!isValidUtcMillis(input.proposalObservedAtMs)) {
    issue(issues, 'proposalObservedAtMs', 'UTC_MILLIS_INVALID', 'proposalObservedAtMs must be valid UTC milliseconds');
  }

  let windowStart: number | null = null;
  let windowEnd: number | null = null;
  const observationWindow = inspectExactRecord(
    input.observationWindow,
    WINDOW_KEYS,
    'observationWindow',
    issues,
  );
  if (observationWindow !== null) {
    if (!isValidUtcMillis(observationWindow.startAtMs)) {
      issue(issues, 'observationWindow.startAtMs', 'UTC_MILLIS_INVALID', 'window start must be valid UTC milliseconds');
    } else {
      windowStart = observationWindow.startAtMs;
    }
    if (!isValidUtcMillis(observationWindow.endAtMs)) {
      issue(issues, 'observationWindow.endAtMs', 'UTC_MILLIS_INVALID', 'window end must be valid UTC milliseconds');
    } else {
      windowEnd = observationWindow.endAtMs;
    }
    if (windowStart !== null && windowEnd !== null && windowEnd <= windowStart) {
      issue(issues, 'observationWindow.endAtMs', 'WINDOW_ORDER_INVALID', 'window end must be later than window start');
    }
    if (
      windowStart !== null &&
      isValidUtcMillis(input.proposalObservedAtMs) &&
      windowStart < input.proposalObservedAtMs
    ) {
      issue(issues, 'observationWindow.startAtMs', 'WINDOW_PRECEDES_PROPOSAL', 'window cannot start before proposal observation');
    }
  }
  if (isValidUtcMillis(input.proposalObservedAtMs) && recordedAtMs < input.proposalObservedAtMs) {
    issue(issues, 'proposalObservedAtMs', 'PROPOSAL_FROM_FUTURE', 'proposal observation cannot be later than recordedAtMs');
  }

  if (typeof input.status !== 'string' || !(OUTCOME_STATUSES as readonly string[]).includes(input.status)) {
    issue(issues, 'status', 'OUTCOME_STATUS_INVALID', 'status must be COMPLETE or INCOMPLETE');
  }
  if (input.finalizedAtMs !== null && !isValidUtcMillis(input.finalizedAtMs)) {
    issue(issues, 'finalizedAtMs', 'UTC_MILLIS_OR_NULL_REQUIRED', 'finalizedAtMs must be null or valid UTC milliseconds');
  }
  if (
    input.predictedProbabilityPpm !== null &&
    (!nonNegativeInteger(input.predictedProbabilityPpm) || input.predictedProbabilityPpm > PROBABILITY_PPM_SCALE)
  ) {
    issue(issues, 'predictedProbabilityPpm', 'PROBABILITY_PPM_INVALID', 'probability must be null or an integer in [0,1000000]');
  }
  if (input.realizedSuccess !== null && typeof input.realizedSuccess !== 'boolean') {
    issue(issues, 'realizedSuccess', 'BOOLEAN_OR_NULL_REQUIRED', 'realizedSuccess must be null or boolean');
  }
  nullableSignedInteger(input.grossResultMicrounits, 'grossResultMicrounits', issues);
  nullableNonNegativeInteger(input.feesMicrounits, 'feesMicrounits', issues);
  nullableNonNegativeInteger(input.slippageMicrounits, 'slippageMicrounits', issues);
  nullableNonNegativeInteger(input.otherCostsMicrounits, 'otherCostsMicrounits', issues);
  nullableSignedInteger(input.netResultMicrounits, 'netResultMicrounits', issues);
  if (
    input.fillRatioPpm !== null &&
    (!nonNegativeInteger(input.fillRatioPpm) || input.fillRatioPpm > PROBABILITY_PPM_SCALE)
  ) {
    issue(issues, 'fillRatioPpm', 'FILL_RATIO_PPM_INVALID', 'fill ratio must be null or an integer in [0,1000000]');
  }

  if (input.status === 'COMPLETE') {
    if (typeof input.realizedSuccess !== 'boolean') {
      issue(issues, 'realizedSuccess', 'COMPLETE_SUCCESS_REQUIRED', 'COMPLETE outcome requires a realized boolean result');
    }
    if (!isValidUtcMillis(input.finalizedAtMs)) {
      issue(issues, 'finalizedAtMs', 'COMPLETE_FINALIZATION_REQUIRED', 'COMPLETE outcome requires finalizedAtMs');
    } else {
      if (windowEnd !== null && input.finalizedAtMs < windowEnd) {
        issue(issues, 'finalizedAtMs', 'FINALIZED_BEFORE_WINDOW_END', 'complete outcome cannot finalize before its window ends');
      }
      if (input.finalizedAtMs > recordedAtMs) {
        issue(issues, 'finalizedAtMs', 'FINALIZED_IN_FUTURE', 'finalizedAtMs cannot exceed recordedAtMs');
      }
    }
    if (windowEnd !== null && recordedAtMs < windowEnd) {
      issue(issues, 'status', 'COMPLETE_BEFORE_WINDOW_END', 'outcome cannot be COMPLETE before its observation window ends');
    }
  }
  if (input.status === 'INCOMPLETE') {
    if (input.realizedSuccess !== null) {
      issue(issues, 'realizedSuccess', 'INCOMPLETE_SUCCESS_CONTRADICTION', 'INCOMPLETE outcome cannot claim a realized result');
    }
    if (input.finalizedAtMs !== null) {
      issue(issues, 'finalizedAtMs', 'INCOMPLETE_FINALIZATION_CONTRADICTION', 'INCOMPLETE outcome cannot be finalized');
    }
  }

  if (
    safeInteger(input.grossResultMicrounits) &&
    nonNegativeInteger(input.feesMicrounits) &&
    nonNegativeInteger(input.slippageMicrounits) &&
    nonNegativeInteger(input.otherCostsMicrounits) &&
    safeInteger(input.netResultMicrounits)
  ) {
    const expected =
      BigInt(input.grossResultMicrounits) -
      BigInt(input.feesMicrounits) -
      BigInt(input.slippageMicrounits) -
      BigInt(input.otherCostsMicrounits);
    if (expected !== BigInt(input.netResultMicrounits)) {
      issue(issues, 'netResultMicrounits', 'NET_RESULT_CONTRADICTION', 'net result must equal gross minus every known cost');
    }
  }
  return issues;
}

function binding(input: ProposalOutcomeInput): Record<string, unknown> {
  return {
    canonicalProposalId: input.canonicalProposalId,
    planId: input.planId,
    source: input.source,
    strategySchema: input.strategySchema,
    configVersion: input.configVersion,
    direction: input.direction,
    resultUnit: input.resultUnit,
    proposalObservedAtMs: input.proposalObservedAtMs,
    observationWindow: {
      startAtMs: input.observationWindow.startAtMs,
      endAtMs: input.observationWindow.endAtMs,
    },
  };
}

function outcomeFacts(input: ProposalOutcomeInput): Record<string, unknown> {
  return {
    status: input.status,
    finalizedAtMs: input.finalizedAtMs,
    predictedProbabilityPpm: input.predictedProbabilityPpm,
    realizedSuccess: input.realizedSuccess,
    grossResultMicrounits: input.grossResultMicrounits,
    feesMicrounits: input.feesMicrounits,
    slippageMicrounits: input.slippageMicrounits,
    otherCostsMicrounits: input.otherCostsMicrounits,
    netResultMicrounits: input.netResultMicrounits,
    fillRatioPpm: input.fillRatioPpm,
  };
}

export function deriveOutcomeId(input: ProposalOutcomeInput): string {
  return `calout_${stableHash128Hex(`proposalOutcome|${canonicalJson(binding(input))}`)}`;
}

export function deriveOutcomeFingerprint(input: ProposalOutcomeInput): string {
  return `calfp_${stableHash128Hex(`proposalOutcomeContent|${canonicalJson({ binding: binding(input), outcome: outcomeFacts(input) })}`)}`;
}

function inputFromRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of INPUT_KEYS) out[key] = record[key];
  return out;
}

/** Used by aggregation to reject malformed/tampered records before metrics. */
export function validateProposalOutcomeRecord(rawRecord: unknown, evaluatedAtMs: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const record = inspectExactRecord(rawRecord, RECORD_KEYS, '', issues);
  if (record === null) return issues;
  if (record.schema !== PROPOSAL_OUTCOME_SCHEMA) {
    issue(issues, 'schema', 'OUTCOME_SCHEMA_INVALID', 'record schema is not supported');
  }
  if (record.schemaVersion !== PROPOSAL_OUTCOME_SCHEMA_VERSION) {
    issue(issues, 'schemaVersion', 'OUTCOME_SCHEMA_VERSION_INVALID', 'record schema version is not supported');
  }
  if (!label(record.outcomeId, 300) || !record.outcomeId.startsWith('calout_')) {
    issue(issues, 'outcomeId', 'OUTCOME_ID_INVALID', 'outcomeId must be a calout_ identifier');
  }
  if (!label(record.contentFingerprint, 300) || !record.contentFingerprint.startsWith('calfp_')) {
    issue(issues, 'contentFingerprint', 'CONTENT_FINGERPRINT_INVALID', 'contentFingerprint must be a calfp_ identifier');
  }
  if (!isValidUtcMillis(record.recordedAtMs)) {
    issue(issues, 'recordedAtMs', 'UTC_MILLIS_INVALID', 'recordedAtMs must be valid UTC milliseconds');
  } else if (record.recordedAtMs > evaluatedAtMs) {
    issue(issues, 'recordedAtMs', 'RECORD_FROM_FUTURE', 'recordedAtMs cannot exceed report evaluation time');
  }
  const semantic = inputFromRecord(record);
  const semanticIssues = validateSemanticInput(
    semantic,
    isValidUtcMillis(record.recordedAtMs) ? record.recordedAtMs : evaluatedAtMs,
  );
  issues.push(...semanticIssues);
  if (semanticIssues.length === 0) {
    const typed = semantic as unknown as ProposalOutcomeInput;
    if (record.outcomeId !== deriveOutcomeId(typed)) {
      issue(issues, 'outcomeId', 'OUTCOME_ID_MISMATCH', 'outcomeId does not match its bound proposal evidence');
    }
    if (record.contentFingerprint !== deriveOutcomeFingerprint(typed)) {
      issue(issues, 'contentFingerprint', 'CONTENT_FINGERPRINT_MISMATCH', 'content fingerprint does not match outcome evidence');
    }
  }
  return issues;
}

/**
 * Capture one immutable outcome snapshot. This never derives absent costs,
 * changes a strategy parameter, or upgrades INCOMPLETE to COMPLETE.
 */
export function recordProposalOutcome(
  input: ProposalOutcomeInput,
  context: CalibrationContext,
): ProposalOutcomeRecordResult {
  validateContext(context, 'recordProposalOutcome');
  const issues = validateSemanticInput(input, context.nowMs);
  if (issues.length > 0) {
    return fail(
      failureFromIssues(issues, {
        component: COMPONENT,
        stage: 'recordOutcome',
        occurredAt: context.nowMs,
        correlationId: context.correlationId,
        code: CALIBRATION_FAILURE_CODES.EVIDENCE_INVALID,
        retryable: false,
        safeCurrentState: 'OUTCOME_NOT_RECORDED',
        recommendedOperatorAction: 'Fix the injected proposal/outcome evidence; unknown values must remain null.',
      }),
    );
  }
  const typed = input as ProposalOutcomeInput;
  const record: ProposalOutcomeRecord = {
    schema: PROPOSAL_OUTCOME_SCHEMA,
    schemaVersion: PROPOSAL_OUTCOME_SCHEMA_VERSION,
    outcomeId: deriveOutcomeId(typed),
    contentFingerprint: deriveOutcomeFingerprint(typed),
    recordedAtMs: context.nowMs,
    canonicalProposalId: typed.canonicalProposalId,
    planId: typed.planId,
    source: typed.source,
    strategySchema: typed.strategySchema,
    configVersion: typed.configVersion,
    direction: typed.direction,
    resultUnit: typed.resultUnit,
    proposalObservedAtMs: typed.proposalObservedAtMs,
    observationWindow: Object.freeze({
      startAtMs: typed.observationWindow.startAtMs,
      endAtMs: typed.observationWindow.endAtMs,
    }),
    status: typed.status,
    finalizedAtMs: typed.finalizedAtMs,
    predictedProbabilityPpm: typed.predictedProbabilityPpm,
    realizedSuccess: typed.realizedSuccess,
    grossResultMicrounits: typed.grossResultMicrounits,
    feesMicrounits: typed.feesMicrounits,
    slippageMicrounits: typed.slippageMicrounits,
    otherCostsMicrounits: typed.otherCostsMicrounits,
    netResultMicrounits: typed.netResultMicrounits,
    fillRatioPpm: typed.fillRatioPpm,
  };
  return ok(Object.freeze(record));
}
