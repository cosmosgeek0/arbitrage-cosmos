import { createHash } from 'node:crypto';

import {
  deepFreezePrivate,
  privateInteger,
  privateRecord,
  privateSortedUnique,
  snapshotPrivateData,
} from './bounds.js';
import { L05_BINANCE_MATRIX_SHA256 } from './contracts.js';
import {
  validateMarginRiskLifecycleState,
  type MarginRiskLifecycleState,
} from './marginLifecycle.js';
import {
  SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS,
  validateSpotSignatureLifecycleState,
  type SpotSignatureLifecycleState,
} from './spotLifecycle.js';
import {
  validateUsdmPrivateLifecycleState,
  type UsdmPrivateLifecycleState,
} from './usdmLifecycle.js';
import {
  NO_PRIVATE_ACTION_AUTHORITY,
  type NoPrivateActionAuthority,
  type PrivateProduct,
  type PrivateTruthPosture,
} from './types.js';

export const L05_PRIVATE_LIFECYCLE_WITNESS_SCHEMA =
  'L05_PRIVATE_LIFECYCLE_WITNESS_V1' as const;
export const L05_LIFECYCLE_MAXIMUM_FUTURE_SKEW_MS = 2_000 as const;

export type ValidatedPrivateLifecycleState =
  | Readonly<SpotSignatureLifecycleState>
  | Readonly<UsdmPrivateLifecycleState>
  | Readonly<MarginRiskLifecycleState>;

export type PrivateLifecycleComparisonPosture =
  | 'OWNER_COMPARISON_READY'
  | 'OWNER_COMPARISON_BLOCKED'
  | 'MARGIN_RISK_ONLY_BLOCKED';

export interface PrivateLifecycleSourceIdentity {
  readonly product: PrivateProduct;
  readonly environment: 'PRODUCTION';
  readonly realm: 'PRIVATE_USER_DATA' | 'PRIVATE_RISK_DATA';
  readonly matrixSha256: typeof L05_BINANCE_MATRIX_SHA256;
  readonly stateSchema: string;
  readonly sourceRevision: string;
  readonly contractIds: readonly string[];
}

export interface PrivateLifecycleWitness extends NoPrivateActionAuthority {
  readonly schema: typeof L05_PRIVATE_LIFECYCLE_WITNESS_SCHEMA;
  readonly matrixSha256: typeof L05_BINANCE_MATRIX_SHA256;
  readonly product: PrivateProduct;
  readonly environment: 'PRODUCTION';
  readonly realm: 'PRIVATE_USER_DATA' | 'PRIVATE_RISK_DATA';
  readonly accountRealmId: string;
  readonly sourceIdentity: Readonly<PrivateLifecycleSourceIdentity>;
  readonly state: ValidatedPrivateLifecycleState;
  readonly stateContentRevision: string;
  readonly lifecycleRevision: string;
  readonly observedAtMs: number;
  readonly evaluatedAtMs: number;
  readonly validUntilMs: number | null;
  readonly comparisonPosture: PrivateLifecycleComparisonPosture;
  readonly acceptableForOwnerComparison: boolean;
  readonly reasonCodes: readonly string[];
  readonly gapFreeSequenceProven: false;
  readonly runtimeWired: false;
}

const CREATE_FIELDS = Object.freeze(['state', 'evaluatedAtMs'] as const);
const SOURCE_FIELDS = Object.freeze([
  'product', 'environment', 'realm', 'matrixSha256', 'stateSchema',
  'sourceRevision', 'contractIds',
] as const);
const WITNESS_FIELDS = Object.freeze([
  'schema', 'matrixSha256', 'product', 'environment', 'realm', 'accountRealmId',
  'sourceIdentity', 'state', 'stateContentRevision', 'lifecycleRevision',
  'observedAtMs', 'evaluatedAtMs', 'validUntilMs', 'comparisonPosture',
  'acceptableForOwnerComparison', 'reasonCodes', 'gapFreeSequenceProven',
  'runtimeWired', 'sendEligible', 'accountReadAuthority', 'mutationAuthority',
  'reconciliationAuthority', 'capitalAuthority', 'riskAuthority',
  'externalActionAuthorization', 'actionAuthority',
] as const);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number'
    || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

function revision(prefix: string, value: unknown): string {
  return `${prefix}${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function minimumNullable(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : Math.min(...known);
}

function inclusiveDeadlineBefore(exclusiveDeadlineMs: number | null): number | null {
  return exclusiveDeadlineMs === null ? null : Math.max(0, exclusiveDeadlineMs - 1);
}

function validateState(value: unknown): ValidatedPrivateLifecycleState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('private lifecycle state must be a closed record');
  }
  const product = (value as Readonly<Record<string, unknown>>).product;
  const state = product === 'SPOT'
    ? validateSpotSignatureLifecycleState(value)
    : product === 'USD_M_PERPETUAL'
      ? validateUsdmPrivateLifecycleState(value)
      : product === 'MARGIN'
        ? validateMarginRiskLifecycleState(value)
        : null;
  if (state === null) throw new TypeError('private lifecycle state failed its canonical validator');
  return state;
}

function sourceIdentity(state: ValidatedPrivateLifecycleState): Readonly<PrivateLifecycleSourceIdentity> {
  if (state.product === 'SPOT') {
    return deepFreezePrivate({
      product: state.product,
      environment: state.environment,
      realm: state.realm,
      matrixSha256: state.matrixSha256,
      stateSchema: state.schema,
      sourceRevision: state.sourceRevision,
      contractIds: Object.freeze([state.contractId]),
    });
  }
  if (state.product === 'USD_M_PERPETUAL') {
    const contractIds = privateSortedUnique([
      ...(state.leaseObservedBy === null ? [] : [state.leaseObservedBy]),
      ...(state.routeContractId === null ? [] : [state.routeContractId]),
    ]);
    return deepFreezePrivate({
      product: state.product,
      environment: state.environment,
      realm: state.realm,
      matrixSha256: state.matrixSha256,
      stateSchema: state.schema,
      sourceRevision: `${state.schema}:v${state.version}`,
      contractIds,
    });
  }
  const contractIds = privateSortedUnique([
    ...(state.leaseObservedBy === null ? [] : [state.leaseObservedBy]),
    ...(state.routeContractId === null ? [] : [state.routeContractId]),
  ]);
  return deepFreezePrivate({
    product: state.product,
    environment: state.environment,
    realm: state.realm,
    matrixSha256: state.matrixSha256,
    stateSchema: state.schema,
    sourceRevision: state.sourceRevision,
    contractIds,
  });
}

interface Comparison {
  readonly observedAtMs: number;
  readonly validUntilMs: number | null;
  readonly posture: PrivateLifecycleComparisonPosture;
  readonly acceptable: boolean;
  readonly reasons: readonly string[];
}

function temporalReasons(
  observedAtMs: number,
  evaluatedAtMs: number,
  validUntilMs: number | null,
): string[] {
  const reasons: string[] = [];
  if (evaluatedAtMs < observedAtMs) {
    reasons.push('PRIVATE_LIFECYCLE_EVALUATION_PRECEDES_STATE');
  }
  if (observedAtMs > evaluatedAtMs + L05_LIFECYCLE_MAXIMUM_FUTURE_SKEW_MS) {
    reasons.push('PRIVATE_LIFECYCLE_CLOCK_SKEWED');
  }
  if (validUntilMs === null) reasons.push('PRIVATE_LIFECYCLE_VALIDITY_UNAVAILABLE');
  else if (evaluatedAtMs > validUntilMs) reasons.push('PRIVATE_LIFECYCLE_EXPIRED');
  return reasons;
}

function comparison(
  state: ValidatedPrivateLifecycleState,
  evaluatedAtMs: number,
): Comparison {
  if (state.product === 'SPOT') {
    const observedAtMs = state.lastObservedAtMs ?? state.connectedAtMs ?? 0;
    const validUntilMs = minimumNullable([
      state.ownerRestCut?.validUntilMs ?? null,
      inclusiveDeadlineBefore(state.reconnectPlannedAtMs),
      inclusiveDeadlineBefore(state.hardDisconnectAtMs),
    ]);
    const reasons = temporalReasons(observedAtMs, evaluatedAtMs, validUntilMs);
    if (!state.connected) reasons.push('SPOT_PRIVATE_STREAM_DISCONNECTED');
    if (!state.signatureAuthorized) reasons.push('SPOT_SIGNATURE_NOT_AUTHORIZED');
    if (!state.subscribed) reasons.push('SPOT_PRIVATE_STREAM_NOT_SUBSCRIBED');
    if (state.reconnectDue
      || (state.reconnectPlannedAtMs !== null && evaluatedAtMs >= state.reconnectPlannedAtMs)) {
      reasons.push('SPOT_PRIVATE_RECONNECT_DUE');
    }
    if (state.ownerRestCut === null) reasons.push('SPOT_OWNER_REST_CUT_REQUIRED');
    if (state.restReconciliationFreshness !== 'FRESH') reasons.push('SPOT_OWNER_REST_CUT_NOT_FRESH');
    if (state.continuityPosture !== 'OWNER_CUT_COVERS_OBSERVED_EVENTS') {
      reasons.push('SPOT_OWNER_CUT_DOES_NOT_COVER_EVENTS');
    }
    if (state.integrityPosture !== 'CLEAN') reasons.push('SPOT_PRIVATE_STREAM_DEGRADED');
    if (state.dedupeCoverageTruncated
      || state.recentEventMarkers.length >= SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS) {
      reasons.push('SPOT_PRIVATE_EVENT_RETENTION_TRUNCATED');
    }
    const ordered = privateSortedUnique(reasons);
    return {
      observedAtMs,
      validUntilMs,
      posture: ordered.length === 0 ? 'OWNER_COMPARISON_READY' : 'OWNER_COMPARISON_BLOCKED',
      acceptable: ordered.length === 0,
      reasons: ordered,
    };
  }
  if (state.product === 'USD_M_PERPETUAL') {
    const observedAtMs = state.lastEvaluatedAtMs;
    const validUntilMs = minimumNullable([
      state.ownerRestCut?.validUntilMs ?? null,
      state.leaseValidUntilMs,
      inclusiveDeadlineBefore(state.reconnectBeforeMs),
      inclusiveDeadlineBefore(state.connectionValidUntilMs),
    ]);
    const reasons = temporalReasons(observedAtMs, evaluatedAtMs, validUntilMs);
    if (!state.connected) reasons.push('USDM_PRIVATE_STREAM_DISCONNECTED');
    if (!state.authenticated) reasons.push('USDM_PRIVATE_STREAM_NOT_AUTHENTICATED');
    if (!state.subscribed) reasons.push('USDM_PRIVATE_STREAM_NOT_SUBSCRIBED');
    if (state.reconnectDue
      || (state.reconnectBeforeMs !== null && evaluatedAtMs >= state.reconnectBeforeMs)) {
      reasons.push('USDM_PRIVATE_RECONNECT_DUE');
    }
    if (state.ownerRestCut === null) reasons.push('USDM_OWNER_REST_CUT_REQUIRED');
    if (state.restReconciliationFreshness !== 'FRESH') reasons.push('USDM_OWNER_REST_CUT_NOT_FRESH');
    if (state.continuityPosture !== 'OWNER_CUT_COVERS_OBSERVED_EVENTS') {
      reasons.push('USDM_OWNER_CUT_DOES_NOT_COVER_EVENTS');
    }
    const ordered = privateSortedUnique(reasons);
    return {
      observedAtMs,
      validUntilMs,
      posture: ordered.length === 0 ? 'OWNER_COMPARISON_READY' : 'OWNER_COMPARISON_BLOCKED',
      acceptable: ordered.length === 0,
      reasons: ordered,
    };
  }
  const observedAtMs = state.lastEvaluatedAtMs;
  const validUntilMs = minimumNullable([
    state.leaseValidUntilMs,
    state.connectionValidUntilMs,
  ]);
  const reasons = privateSortedUnique([
    ...temporalReasons(observedAtMs, evaluatedAtMs, validUntilMs),
    'MARGIN_RISK_STREAM_NOT_ACCOUNT_TRUTH',
  ]);
  return {
    observedAtMs,
    validUntilMs,
    posture: 'MARGIN_RISK_ONLY_BLOCKED',
    acceptable: false,
    reasons,
  };
}

/**
 * Builds a revision-bound value witness from a fully validated lifecycle
 * state. The full canonical state remains attached so no caller-authored
 * digest can substitute for lifecycle content.
 */
export function createPrivateLifecycleWitness(
  inputValue: unknown,
): Readonly<PrivateLifecycleWitness> {
  const input = privateRecord(
    snapshotPrivateData(inputValue),
    CREATE_FIELDS,
    'private lifecycle witness input',
  );
  const evaluatedAtMs = privateInteger(input.evaluatedAtMs, 'lifecycle witness evaluatedAtMs');
  const state = validateState(input.state);
  if (state.matrixSha256 !== L05_BINANCE_MATRIX_SHA256) {
    throw new TypeError('private lifecycle state matrix mismatch');
  }
  const source = sourceIdentity(state);
  const assessment = comparison(state, evaluatedAtMs);
  const stateContentRevision = revision('l05lcstate_', state);
  const lifecycleRevision = revision('l05lifecycle_', {
    sourceIdentity: source,
    accountRealmId: state.accountRealmId,
    stateContentRevision,
    observedAtMs: assessment.observedAtMs,
    evaluatedAtMs,
    validUntilMs: assessment.validUntilMs,
    comparisonPosture: assessment.posture,
    reasonCodes: assessment.reasons,
  });
  return deepFreezePrivate({
    schema: L05_PRIVATE_LIFECYCLE_WITNESS_SCHEMA,
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    product: state.product,
    environment: state.environment,
    realm: state.realm,
    accountRealmId: state.accountRealmId,
    sourceIdentity: source,
    state,
    stateContentRevision,
    lifecycleRevision,
    observedAtMs: assessment.observedAtMs,
    evaluatedAtMs,
    validUntilMs: assessment.validUntilMs,
    comparisonPosture: assessment.posture,
    acceptableForOwnerComparison: assessment.acceptable,
    reasonCodes: assessment.reasons,
    gapFreeSequenceProven: false as const,
    runtimeWired: false as const,
    ...NO_PRIVATE_ACTION_AUTHORITY,
  });
}

/** Rebuilds every derived field and rejects forged or partial witnesses. */
export function validatePrivateLifecycleWitness(
  value: unknown,
): Readonly<PrivateLifecycleWitness> {
  const candidate = privateRecord(
    snapshotPrivateData(value),
    WITNESS_FIELDS,
    'private lifecycle witness',
  );
  privateRecord(candidate.sourceIdentity, SOURCE_FIELDS, 'private lifecycle source identity');
  const regenerated = createPrivateLifecycleWitness({
    state: candidate.state,
    evaluatedAtMs: candidate.evaluatedAtMs,
  });
  if (canonicalJson(candidate) !== canonicalJson(regenerated)) {
    throw new TypeError('private lifecycle witness is not canonically reproducible');
  }
  return regenerated;
}

export function requiredLifecycleProductsForPosture(
  posture: PrivateTruthPosture,
): readonly PrivateProduct[] {
  switch (posture) {
    case 'SPOT_NEW_EXPOSURE':
      return Object.freeze(['SPOT'] as const);
    case 'USDM_NEW_EXPOSURE':
      return Object.freeze(['USD_M_PERPETUAL'] as const);
    case 'SPOT_USDM_NEW_EXPOSURE':
      return Object.freeze(['SPOT', 'USD_M_PERPETUAL'] as const);
    case 'MARGIN_NEW_EXPOSURE':
      return Object.freeze(['MARGIN'] as const);
    case 'SUPERVISION_ONLY':
      return Object.freeze([]);
  }
}
