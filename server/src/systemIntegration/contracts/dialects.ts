import {
  createSourcedTimestamp,
  createStructuredFailure,
  fail,
  isDataAuthority,
  isValidUtcMillis,
  ok,
  weakestAuthority,
  type Completeness,
  type ContractResult,
  type DataAuthority,
  type StructuredFailure,
} from '../../foundation/contracts/index.js';
import {
  FAILURE_CODES,
  SOURCE_AUTHORITIES,
  validateTruthMetadata,
  type CompletenessState,
  type SourceAuthorityKind,
  type StableFailure,
  type TruthMetadata as IntelligenceTruthMetadata,
} from '../../intelligenceFoundation/contracts/index.js';
import {
  RUNTIME_LIFECYCLE_STATES,
  type RuntimeAuthority,
  type RuntimeError,
  type RuntimeLifecycleState,
} from '../../intelligenceRuntime/contracts/index.js';
import {
  BLOCKED_EXECUTION_MODE_REQUESTS,
  LIVE_EXECUTION_NOT_IMPLEMENTED,
  type DialectLossCode,
  type SystemReadinessState,
  type SystemSafeMode,
} from './constants.js';
import type {
  DialectLoss,
  DialectTranslation,
  IntelligenceAuthorityContext,
  IntelligenceAuthorityProjection,
  IntelligenceTimestampProjectionContext,
  RuntimeCoverageProjection,
  RuntimeFailureTranslationContext,
  RuntimeLifecycleEvidenceProjection,
  SafeModeContext,
  SafeModeTranslation,
  StableFailureTranslationContext,
  StructuredFailureProjection,
} from './types.js';
import { isSystemSafeMode } from './validation.js';

const UPPER_CODE = /^[A-Z][A-Z0-9_]{0,99}$/;
const RUNTIME_COVERAGES = new Set<RuntimeAuthority>([
  'COMPLETE', 'PARTIAL', 'SAMPLED', 'UNAVAILABLE', 'UNKNOWN',
]);

function boundedText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || value.trim() !== value || /[\r\n\0]/.test(value)) {
    throw new TypeError(`${name} must be a bounded canonical string`);
  }
  return value;
}

function validateContext(context: SafeModeContext): void {
  if (!isValidUtcMillis(context.nowMs)) throw new TypeError('context.nowMs must be Foundation UTC ms');
  boundedText(context.correlationId, 'context.correlationId', 128);
  boundedText(context.safeCurrentState, 'context.safeCurrentState', 200);
}

function dialectLoss(
  code: DialectLossCode,
  detail: string,
  sourcePath: string | null,
  targetPath: string | null,
): Readonly<DialectLoss> {
  return Object.freeze({
    code,
    detail: boundedText(detail, 'loss detail', 500),
    sourcePath,
    targetPath,
  });
}

function freezeLosses(losses: readonly Readonly<DialectLoss>[]): readonly Readonly<DialectLoss>[] {
  return Object.freeze([...losses]);
}

function failure(
  component: string,
  stage: string,
  code: string,
  message: string,
  context: SafeModeContext,
  action: string,
): Readonly<StructuredFailure> {
  return createStructuredFailure({
    component,
    stage,
    code,
    message,
    occurredAt: context.nowMs,
    retryable: false,
    safeCurrentState: context.safeCurrentState,
    recommendedOperatorAction: action,
    correlationId: context.correlationId,
  });
}

/**
 * Resolves the only externally accepted convergence modes. It deliberately
 * does not map VALIDATE_ONLY to Foundation EXECUTION_VALIDATE_ONLY, because
 * that Control dialect requires private-key evidence. Capital observation is
 * projected, while reservation/staging stays unavailable because Capital's
 * current owner contract requires MANUAL_ARMED.
 */
export function resolveSystemSafeMode(
  requested: unknown,
  context: SafeModeContext,
): ContractResult<Readonly<SafeModeTranslation>> {
  validateContext(context);
  if (typeof requested === 'string'
      && (BLOCKED_EXECUTION_MODE_REQUESTS as readonly string[]).includes(requested)) {
    return fail(failure(
      'systemIntegration.contracts.safeMode',
      'resolve',
      LIVE_EXECUTION_NOT_IMPLEMENTED,
      `Mode ${requested} is blocked because live execution is not implemented.`,
      context,
      'Use READ_ONLY, ADVISORY, or VALIDATE_ONLY.',
    ));
  }
  if (!isSystemSafeMode(requested)) {
    return fail(failure(
      'systemIntegration.contracts.safeMode',
      'resolve',
      'INVALID_SAFE_MODE',
      'Requested convergence mode is not part of the bounded safe-mode vocabulary.',
      context,
      'Use READ_ONLY, ADVISORY, or VALIDATE_ONLY.',
    ));
  }
  const reasons = requested === 'VALIDATE_ONLY'
    ? [
        'FOUNDATION_CONTROL_REMAINS_KEYLESS_INTELLIGENCE',
        'SEALED_DRY_RUN_COORDINATOR_ONLY',
        'CAPITAL_MANUAL_ARMED_DIALECT_BLOCKED',
      ]
    : ['FOUNDATION_CONTROL_REMAINS_KEYLESS_INTELLIGENCE'];
  return ok(Object.freeze({
    safeMode: requested,
    foundationRunMode: 'INTELLIGENCE' as const,
    capitalObservationMode: requested,
    capitalReservationMode: 'UNAVAILABLE' as const,
    coordinatorMode: requested === 'VALIDATE_ONLY' ? 'VALIDATE_ONLY' as const : 'UNAVAILABLE' as const,
    authority: 'NONE' as const,
    liveExecutionPermitted: false as const,
    requiresPrivateKeys: false as const,
    translationReasons: Object.freeze(reasons),
  }));
}

/** Coverage translation only. The return type intentionally has no DataAuthority field. */
export function translateRuntimeCoverage(coverage: RuntimeAuthority): Readonly<RuntimeCoverageProjection> {
  if (!RUNTIME_COVERAGES.has(coverage)) throw new TypeError('unknown RuntimeAuthority coverage value');
  let intelligenceCompleteness: CompletenessState;
  let foundationCompleteness: Completeness;
  const losses: DialectLoss[] = [];
  switch (coverage) {
    case 'COMPLETE':
      intelligenceCompleteness = 'COMPLETE';
      foundationCompleteness = 'COMPLETE';
      break;
    case 'PARTIAL':
      intelligenceCompleteness = 'PARTIAL';
      foundationCompleteness = 'PARTIAL';
      break;
    case 'SAMPLED':
      intelligenceCompleteness = 'PARTIAL';
      foundationCompleteness = 'PARTIAL';
      losses.push(dialectLoss(
        'RUNTIME_SAMPLED_LOWER_BOUND',
        'Sampled runtime coverage remains a lower bound and cannot become complete.',
        'RuntimeAuthority',
        'Completeness',
      ));
      break;
    case 'UNAVAILABLE':
      intelligenceCompleteness = 'MISSING';
      foundationCompleteness = 'UNAVAILABLE';
      break;
    case 'UNKNOWN':
      intelligenceCompleteness = 'UNKNOWN';
      foundationCompleteness = 'UNAVAILABLE';
      losses.push(dialectLoss(
        'RUNTIME_UNKNOWN_MAPPED_UNAVAILABLE',
        'Unknown runtime coverage fails closed as unavailable at the Foundation boundary.',
        'RuntimeAuthority',
        'Completeness',
      ));
      break;
  }
  return Object.freeze({
    runtimeCoverage: coverage,
    intelligenceCompleteness,
    foundationCompleteness,
    sampled: coverage === 'SAMPLED',
    losses: freezeLosses(losses),
  });
}

export function projectRuntimeLifecycleEvidence(
  lifecycle: RuntimeLifecycleState,
): Readonly<RuntimeLifecycleEvidenceProjection> {
  if (!(RUNTIME_LIFECYCLE_STATES as readonly string[]).includes(lifecycle)) {
    throw new TypeError('unknown RuntimeLifecycleState');
  }
  let readinessEvidence: SystemReadinessState;
  switch (lifecycle) {
    case 'STOPPED': readinessEvidence = 'STOPPED'; break;
    case 'CONNECTING':
    case 'WARMING': readinessEvidence = 'WARMING'; break;
    case 'LIVE': readinessEvidence = 'READY'; break;
    case 'FAILED': readinessEvidence = 'FAILED'; break;
    case 'SILENT':
    case 'STALE':
    case 'DEGRADED':
    case 'BACKING_OFF':
    case 'RATE_LIMITED': readinessEvidence = 'DEGRADED'; break;
  }
  return Object.freeze({
    sourceLifecycle: lifecycle,
    readinessEvidence,
    machinePhase: null,
    fatalEvidence: lifecycle === 'FAILED',
  });
}

export function translateIntelligenceAuthority(
  sourceKind: SourceAuthorityKind,
  context: IntelligenceAuthorityContext,
): Readonly<IntelligenceAuthorityProjection> {
  if (!(SOURCE_AUTHORITIES as readonly string[]).includes(sourceKind)) {
    throw new TypeError('unknown SourceAuthorityKind');
  }
  if (!isDataAuthority(context.acquisitionAuthority)) throw new TypeError('invalid acquisition DataAuthority');
  const upstream = context.upstreamAuthorities ?? [];
  if (upstream.some((authority) => !isDataAuthority(authority))) throw new TypeError('invalid upstream DataAuthority');
  const losses: DialectLoss[] = [];
  let effectiveAuthority: DataAuthority = 'UNAVAILABLE';

  const acquisitionAllowed = ['LIVE_PUBLIC', 'RECORDED_REPLAY', 'SYNTHETIC_TEST', 'UNAVAILABLE']
    .includes(context.acquisitionAuthority);
  switch (sourceKind) {
    case 'EXCHANGE_PRIMARY':
      if (acquisitionAllowed) effectiveAuthority = context.acquisitionAuthority;
      else losses.push(dialectLoss(
        'AUTHORITY_CONTEXT_MISMATCH',
        'Primary public exchange truth cannot inherit private or already-derived authority.',
        'TruthMetadata.authority.kind',
        'SourcedTimestamp.authority',
      ));
      break;
    case 'EXCHANGE_DERIVED':
    case 'ENGINE_DERIVED':
    case 'CONTEXTUAL': {
      if (upstream.length === 0) {
        losses.push(dialectLoss(
          'UPSTREAM_AUTHORITY_MISSING',
          'Derived truth requires explicit upstream authority evidence.',
          'TruthMetadata.provenance.sourceSet',
          'SourcedTimestamp.authority',
        ));
        break;
      }
      const derivedBase: DataAuthority = context.acquisitionAuthority === 'RECORDED_REPLAY'
        ? 'RECORDED_REPLAY'
        : context.acquisitionAuthority === 'SYNTHETIC_TEST'
          ? 'SYNTHETIC_TEST'
          : context.acquisitionAuthority === 'LIVE_PUBLIC' || context.acquisitionAuthority === 'DERIVED_LIVE'
            ? 'DERIVED_LIVE'
            : 'UNAVAILABLE';
      effectiveAuthority = weakestAuthority(derivedBase, ...upstream);
      if (derivedBase === 'UNAVAILABLE') losses.push(dialectLoss(
        'AUTHORITY_CONTEXT_MISMATCH',
        'Derived source kind conflicts with the supplied acquisition context.',
        'TruthMetadata.authority.kind',
        'SourcedTimestamp.authority',
      ));
      break;
    }
    case 'REPLAY_SUPPLIED':
      if (context.acquisitionAuthority === 'RECORDED_REPLAY') effectiveAuthority = 'RECORDED_REPLAY';
      else losses.push(dialectLoss(
        'AUTHORITY_CONTEXT_MISMATCH',
        'Replay-supplied truth requires recorded-replay acquisition context.',
        'TruthMetadata.authority.kind',
        'SourcedTimestamp.authority',
      ));
      break;
    case 'OPERATOR_SUPPLIED':
      losses.push(dialectLoss(
        'OPERATOR_AUTHORITY_UNREPRESENTABLE',
        'Foundation DataAuthority has no operator-supplied acquisition variant.',
        'TruthMetadata.authority.kind',
        'SourcedTimestamp.authority',
      ));
      break;
    case 'UNKNOWN':
      losses.push(dialectLoss(
        'UNKNOWN_AUTHORITY',
        'Unknown source authority fails closed as unavailable.',
        'TruthMetadata.authority.kind',
        'SourcedTimestamp.authority',
      ));
      break;
  }
  return Object.freeze({ sourceKind, effectiveAuthority, losses: freezeLosses(losses) });
}

function completenessProjection(state: CompletenessState): {
  completeness: Completeness;
  losses: readonly Readonly<DialectLoss>[];
} {
  if (state === 'COMPLETE') return { completeness: 'COMPLETE', losses: Object.freeze([]) };
  if (state === 'PARTIAL') return { completeness: 'PARTIAL', losses: Object.freeze([]) };
  if (state === 'MISSING') return {
    completeness: 'UNAVAILABLE',
    losses: Object.freeze([dialectLoss(
      'MI_MISSING_MAPPED_UNAVAILABLE',
      'Missing Market Intelligence truth is unavailable at the Foundation boundary.',
      'TruthMetadata.completeness.state',
      'SourcedTimestamp.completeness',
    )]),
  };
  return {
    completeness: 'UNAVAILABLE',
    losses: Object.freeze([dialectLoss(
      'MI_UNKNOWN_MAPPED_UNAVAILABLE',
      'Unknown Market Intelligence truth fails closed as unavailable.',
      'TruthMetadata.completeness.state',
      'SourcedTimestamp.completeness',
    )]),
  };
}

export function projectIntelligenceTruthToSourcedTimestamp(
  truth: IntelligenceTruthMetadata,
  context: IntelligenceTimestampProjectionContext,
): DialectTranslation<Readonly<ReturnType<typeof createSourcedTimestamp>> | null> {
  validateContext(context);
  const validated = validateTruthMetadata(truth);
  if (!validated.ok) {
    return Object.freeze({
      ok: false as const,
      failure: failure(
        'systemIntegration.contracts.dialects',
        'projectIntelligenceTruthToSourcedTimestamp',
        'INTELLIGENCE_TRUTH_INVALID',
        'Market Intelligence truth failed its owner validator.',
        context,
        'Inspect the retained Market Intelligence failure origin.',
      ),
      losses: Object.freeze([]),
    });
  }
  const value = validated.value;
  const temporal = value.temporal;
  if (![temporal.sourceEventTimeMs, temporal.sourceTransactionTimeMs, temporal.receivedTimeMs]
    .every((time) => time === null || isValidUtcMillis(time))) {
    return Object.freeze({
      ok: false as const,
      failure: failure(
        'systemIntegration.contracts.dialects',
        'projectIntelligenceTruthToSourcedTimestamp',
        'UTC_MILLIS_INVALID',
        'Market Intelligence time does not fit the Foundation UTC range.',
        context,
        'Correct or reject the out-of-range source record.',
      ),
      losses: Object.freeze([]),
    });
  }

  const losses: DialectLoss[] = [];
  let sourceTimeMs = temporal.sourceEventTimeMs;
  if (sourceTimeMs === null && temporal.sourceTransactionTimeMs !== null) {
    sourceTimeMs = temporal.sourceTransactionTimeMs;
    losses.push(dialectLoss(
      'TRANSACTION_TIME_USED_AS_SOURCE_TIME',
      'Transaction time is the only venue-supplied source time available.',
      'TruthMetadata.temporal.sourceTransactionTimeMs',
      'SourcedTimestamp.sourceTimeMs',
    ));
  } else if (sourceTimeMs !== null && temporal.sourceTransactionTimeMs !== null) {
    losses.push(dialectLoss(
      'TRANSACTION_TIME_NOT_REPRESENTABLE',
      'Foundation SourcedTimestamp cannot retain event and transaction time together.',
      'TruthMetadata.temporal.sourceTransactionTimeMs',
      null,
    ));
  }
  if (sourceTimeMs === null) losses.push(dialectLoss(
    'SOURCE_TIME_UNAVAILABLE',
    'No venue source time exists; Foundation freshness will use receipt time.',
    'TruthMetadata.temporal',
    'SourcedTimestamp.sourceTimeMs',
  ));
  if (temporal.sequence !== null) losses.push(dialectLoss(
    'SEQUENCE_NOT_REPRESENTABLE',
    'Foundation SourcedTimestamp has no sequence field; sequence remains in the origin trace.',
    'TruthMetadata.temporal.sequence',
    null,
  ));

  const ownerMaxAge = value.freshness.maxAgeMs;
  const explicitMaxAge = context.explicitMaxAgeMs;
  const maxAgeMs = typeof ownerMaxAge === 'number' && Number.isSafeInteger(ownerMaxAge) && ownerMaxAge > 0
    ? ownerMaxAge
    : typeof explicitMaxAge === 'number' && Number.isSafeInteger(explicitMaxAge) && explicitMaxAge > 0
      ? explicitMaxAge
      : null;
  if (maxAgeMs === null) {
    losses.push(dialectLoss(
      'MAX_AGE_MISSING',
      'No validated age budget exists, so no Foundation timestamp is fabricated.',
      'TruthMetadata.freshness.maxAgeMs',
      'SourcedTimestamp.maxAgeMs',
    ));
    return Object.freeze({ ok: true as const, value: null, losses: freezeLosses(losses) });
  }

  const authority = translateIntelligenceAuthority(value.authority.kind, context);
  losses.push(...authority.losses);
  const completeness = completenessProjection(value.completeness.state);
  losses.push(...completeness.losses);
  let effectiveAuthority = authority.effectiveAuthority;
  if (value.freshness.state !== 'FRESH' || completeness.completeness === 'UNAVAILABLE') {
    effectiveAuthority = 'UNAVAILABLE';
    if (value.freshness.state === 'STALE') losses.push(dialectLoss(
      'STALE_AUTHORITY_DOWNGRADED',
      'Stale Market Intelligence truth loses cross-domain authority.',
      'TruthMetadata.freshness.state',
      'SourcedTimestamp.authority',
    ));
  }
  const timestamp = createSourcedTimestamp({
    sourceTimeMs,
    receivedAtMs: temporal.receivedTimeMs,
    maxAgeMs,
    authority: effectiveAuthority,
    completeness: completeness.completeness,
    sourceId: value.authority.sourceId,
  });
  return Object.freeze({ ok: true as const, value: timestamp, losses: freezeLosses(losses) });
}

export function translateStableFailureToStructuredFailure(
  source: StableFailure,
  context: StableFailureTranslationContext,
): Readonly<StructuredFailureProjection> {
  validateContext(context);
  boundedText(context.stage, 'context.stage', 200);
  boundedText(context.recommendedOperatorAction, 'context.recommendedOperatorAction', 500);
  if (typeof source !== 'object' || source === null
      || typeof source.id !== 'string' || source.id.length === 0
      || !(FAILURE_CODES as readonly string[]).includes(source.code)
      || !boundedStableFailure(source)) {
    throw new TypeError('source must be a valid Market Intelligence StableFailure');
  }
  const translated = createStructuredFailure({
    component: source.component,
    stage: context.stage,
    code: source.code,
    message: source.message,
    occurredAt: context.nowMs,
    retryable: source.retryable,
    safeCurrentState: context.safeCurrentState,
    recommendedOperatorAction: context.recommendedOperatorAction,
    correlationId: context.correlationId,
  });
  return Object.freeze({
    failure: translated,
    origin: Object.freeze({
      kind: 'MARKET_INTELLIGENCE' as const,
      failureId: source.id,
      field: source.field,
      evidenceIds: Object.freeze([...source.evidenceIds]),
    }),
    losses: Object.freeze([dialectLoss(
      'ORIGIN_FAILURE_FIELDS_RETAINED_IN_TRACE',
      'Origin failure identity, field, and evidence IDs remain beside the frozen nine-field failure.',
      'StableFailure',
      'StructuredFailure',
    )]),
  });
}

function boundedStableFailure(source: StableFailure): boolean {
  return boundedFailureText(source.component, 96)
    && boundedFailureText(source.message, 256)
    && typeof source.retryable === 'boolean'
    && (source.field === null || boundedFailureText(source.field, 256))
    && Array.isArray(source.evidenceIds)
    && source.evidenceIds.length <= 256
    && source.evidenceIds.every((id) => boundedFailureText(id, 512));
}

function boundedFailureText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\r\n\0]/.test(value);
}

export function translateRuntimeErrorToStructuredFailure(
  source: RuntimeError,
  context: RuntimeFailureTranslationContext,
): Readonly<StructuredFailureProjection> {
  validateContext(context);
  boundedText(context.stage, 'context.stage', 200);
  boundedText(context.recommendedOperatorAction, 'context.recommendedOperatorAction', 500);
  boundedText(context.sourceId, 'context.sourceId', 256);
  if (typeof source !== 'object' || source === null
      || typeof source.code !== 'string' || source.code.length === 0 || source.code.length > 96
      || typeof source.message !== 'string' || source.message.length === 0 || source.message.length > 400
      || typeof source.retryable !== 'boolean' || !isValidUtcMillis(source.observedAtMs)
      || typeof source.recommendedAction !== 'string' || source.recommendedAction.length === 0
      || source.recommendedAction.length > 400) {
    throw new TypeError('source must be a valid RuntimeError');
  }
  const canonicalCode = UPPER_CODE.test(source.code) ? source.code : 'RUNTIME_ERROR_CODE_INVALID';
  const translated = createStructuredFailure({
    component: 'systemIntegration.adapters.intelligenceRuntime',
    stage: context.stage,
    code: canonicalCode,
    message: `Runtime source ${context.sourceId} reported ${canonicalCode}.`,
    occurredAt: source.observedAtMs,
    retryable: source.retryable,
    safeCurrentState: context.safeCurrentState,
    recommendedOperatorAction: context.recommendedOperatorAction,
    correlationId: context.correlationId,
  });
  return Object.freeze({
    failure: translated,
    origin: Object.freeze({
      kind: 'INTELLIGENCE_RUNTIME' as const,
      sourceId: context.sourceId,
      rawCode: source.code,
      observedAtMs: source.observedAtMs,
    }),
    losses: Object.freeze([
      dialectLoss(
        'ORIGIN_FAILURE_FIELDS_RETAINED_IN_TRACE',
        'Runtime source identity and raw code remain beside the frozen nine-field failure.',
        'RuntimeError',
        'StructuredFailure',
      ),
      dialectLoss(
        'ORIGIN_FAILURE_DETAIL_REDACTED',
        'Runtime free-form message and action are not copied across the safe diagnostic boundary.',
        'RuntimeError.message',
        'StructuredFailure.message',
      ),
    ]),
  });
}
