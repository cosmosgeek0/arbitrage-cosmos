/**
 * Cached account-truth projection only.
 *
 * The port deliberately exposes one synchronous cache read and no refresh,
 * credential, transport, or private-call capability. Incomplete truth remains
 * visible for supervision but can never become available for new exposure.
 */
import {
  deriveAccountCapitalProjection,
  type AccountCapitalProjection,
  type DeriveAccountCapitalProjectionInput,
} from '../../capitalFoundation/accountTruth/index.js';
import {
  createStructuredFailure,
  isValidUtcMillis,
} from '../../foundation/contracts/index.js';
import type {
  DialectTranslation,
  SafeModeContext,
} from '../contracts/types.js';

const COMPONENT = 'systemIntegration.adapters.accountTruth';

export interface CachedAccountTruthPort {
  readonly readCachedAccountTruth: () => Readonly<DeriveAccountCapitalProjectionInput> | null;
}

export interface ProjectCachedAccountTruthInput extends SafeModeContext {
  readonly port: CachedAccountTruthPort;
}

export interface CachedAccountTruthProjection {
  readonly state: 'AVAILABLE' | 'UNAVAILABLE';
  readonly evaluatedAtMs: number;
  readonly cachedCutEvaluatedAtMs: number | null;
  readonly availableForNewExposure: boolean;
  readonly projection: Readonly<AccountCapitalProjection> | null;
  readonly reasonCodes: readonly string[];
  readonly supervisionVisible: boolean;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

/** Reads the cache once. No method capable of private I/O is in scope. */
export function projectCachedAccountTruth(
  input: ProjectCachedAccountTruthInput,
): DialectTranslation<Readonly<CachedAccountTruthProjection>> {
  let cached: Readonly<DeriveAccountCapitalProjectionInput> | null;
  try {
    cached = input.port.readCachedAccountTruth();
  } catch {
    return Object.freeze({
      ok: false,
      failure: createStructuredFailure({
        component: COMPONENT,
        stage: 'read-cache',
        code: 'ACCOUNT_TRUTH_CACHE_READ_FAILED',
        message: 'Cached account truth read failed; private owner detail remains at the account boundary.',
        occurredAt: input.nowMs,
        retryable: false,
        safeCurrentState: input.safeCurrentState,
        recommendedOperatorAction: 'Restore the existing account cache before evaluating new exposure.',
        correlationId: input.correlationId,
      }),
      losses: Object.freeze([]),
    });
  }

  if (cached === null) {
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        state: 'UNAVAILABLE' as const,
        evaluatedAtMs: input.nowMs,
        cachedCutEvaluatedAtMs: null,
        availableForNewExposure: false,
        projection: null,
        reasonCodes: Object.freeze(['ACCOUNT_TRUTH_CACHE_EMPTY']),
        supervisionVisible: false,
      }),
      losses: Object.freeze([]),
    });
  }

  if (!isValidUtcMillis(cached.evaluatedAtMs)) {
    return Object.freeze({
      ok: false,
      failure: createStructuredFailure({
        component: COMPONENT,
        stage: 'project-cache',
        code: 'ACCOUNT_TRUTH_CACHE_TIME_INVALID',
        message: 'Cached account truth cut has no valid Foundation UTC evaluation time.',
        occurredAt: input.nowMs,
        retryable: false,
        safeCurrentState: input.safeCurrentState,
        recommendedOperatorAction: 'Reject the malformed cached cut and restore reconciled account truth.',
        correlationId: input.correlationId,
      }),
      losses: Object.freeze([]),
    });
  }

  try {
    const projection = deriveAccountCapitalProjection({
      ...cached,
      evaluatedAtMs: input.nowMs,
    });
    const available = projection.truth.allRequiredSourcesFreshAndComplete
      && projection.allocatable.status === 'AVAILABLE'
      && projection.allocatable.amount !== null;
    const reasonCodes = available
      ? []
      : sortedUnique([
          'ACCOUNT_TRUTH_UNAVAILABLE_FOR_NEW_EXPOSURE',
          ...projection.truth.reasons,
          ...projection.allocatable.blockingReasons,
          ...projection.allocatable.unavailableReasons,
          ...projection.allocatable.unknownReasons,
        ]);
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        state: available ? 'AVAILABLE' as const : 'UNAVAILABLE' as const,
        evaluatedAtMs: input.nowMs,
        cachedCutEvaluatedAtMs: cached.evaluatedAtMs,
        availableForNewExposure: available,
        projection,
        reasonCodes,
        supervisionVisible: projection.supervisionVisible,
      }),
      losses: Object.freeze([]),
    });
  } catch {
    return Object.freeze({
      ok: false,
      failure: createStructuredFailure({
        component: COMPONENT,
        stage: 'project-cache',
        code: 'ACCOUNT_TRUTH_PROJECTION_FAILED',
        message: 'Cached account truth projection rejected the owner cut; private values were not copied into the failure.',
        occurredAt: input.nowMs,
        retryable: false,
        safeCurrentState: input.safeCurrentState,
        recommendedOperatorAction: 'Reject the malformed cached cut and restore complete reconciled account truth.',
        correlationId: input.correlationId,
      }),
      losses: Object.freeze([]),
    });
  }
}
