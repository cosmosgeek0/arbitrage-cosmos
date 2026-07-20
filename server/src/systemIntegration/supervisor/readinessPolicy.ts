import type { SystemSafeMode } from '../contracts/constants.js';

export const Q_READINESS_WAIVER_ID = 'READINESS-CLUSTER-001-Q-INFERENCE' as const;
export const Q_READINESS_WAIVER_SCOPE = 'KEYLESS_PUBLIC_DATA_VALIDATE_ONLY' as const;
export const Q_READINESS_WAIVER_REASON = 'Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED' as const;
export const Q_READINESS_WAIVER_OWNER = 'cosmosgeek' as const;
export const Q_READINESS_WAIVER_EXPIRY = '2026-10-18T00:00:00Z' as const;
export const Q_READINESS_WAIVER_EXPIRY_MS = 1_792_281_600_000 as const;

export interface QReadinessWaiver {
  readonly id: typeof Q_READINESS_WAIVER_ID;
  readonly scope: typeof Q_READINESS_WAIVER_SCOPE;
  readonly mode: 'VALIDATE_ONLY';
  readonly reason: typeof Q_READINESS_WAIVER_REASON;
  readonly owner: typeof Q_READINESS_WAIVER_OWNER;
  readonly expiresAt: typeof Q_READINESS_WAIVER_EXPIRY;
}

/**
 * Closed, source-controlled policy from the signed ruling receipt. It is not
 * constructed from process environment or ambient configuration.
 */
export const SIGNED_Q_READINESS_WAIVER: Readonly<QReadinessWaiver> = Object.freeze({
  id: Q_READINESS_WAIVER_ID,
  scope: Q_READINESS_WAIVER_SCOPE,
  mode: 'VALIDATE_ONLY',
  reason: Q_READINESS_WAIVER_REASON,
  owner: Q_READINESS_WAIVER_OWNER,
  expiresAt: Q_READINESS_WAIVER_EXPIRY,
});

export const READINESS_POLICY_STATUSES = Object.freeze([
  'VALID',
  'MISSING',
  'MALFORMED',
  'WRONG_MODE',
  'WRONG_SCOPE',
  'EXPIRED',
] as const);

export type ReadinessPolicyStatus = (typeof READINESS_POLICY_STATUSES)[number];

export interface ReadinessPolicyEvaluation {
  readonly status: ReadinessPolicyStatus;
  readonly accepted: boolean;
  readonly reasonCode:
    | 'READINESS_POLICY_VALID'
    | 'READINESS_POLICY_MISSING'
    | 'READINESS_POLICY_MALFORMED'
    | 'READINESS_POLICY_WRONG_MODE'
    | 'READINESS_POLICY_WRONG_SCOPE'
    | 'READINESS_POLICY_EXPIRED';
  /** Present only after every signed field except time has matched exactly. */
  readonly waiver: Readonly<QReadinessWaiver> | null;
}

const EXACT_FIELDS = Object.freeze([
  'id',
  'scope',
  'mode',
  'reason',
  'owner',
  'expiresAt',
] as const);

function plainDataRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.values(descriptors).every((descriptor) => (
    descriptor.enumerable === true && Object.hasOwn(descriptor, 'value')
  ));
}

function exactFields(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...EXACT_FIELDS].sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index]);
}

function result(
  status: ReadinessPolicyStatus,
  waiver: Readonly<QReadinessWaiver> | null = null,
): Readonly<ReadinessPolicyEvaluation> {
  return Object.freeze({
    status,
    accepted: status === 'VALID',
    reasonCode: `READINESS_POLICY_${status}` as ReadinessPolicyEvaluation['reasonCode'],
    waiver,
  });
}

/** Pure, injected-clock evaluation. Missing or untrusted input never defaults to the signed waiver. */
export function evaluateReadinessPolicy(
  candidate: unknown,
  nowMs: number,
  currentMode: SystemSafeMode,
): Readonly<ReadinessPolicyEvaluation> {
  if (candidate === undefined || candidate === null) return result('MISSING');
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return result('MALFORMED');
  if (!plainDataRecord(candidate) || !exactFields(candidate)) return result('MALFORMED');
  if (candidate.scope !== Q_READINESS_WAIVER_SCOPE) return result('WRONG_SCOPE');
  if (candidate.mode !== 'VALIDATE_ONLY' || currentMode !== 'VALIDATE_ONLY') return result('WRONG_MODE');
  if (
    candidate.id !== Q_READINESS_WAIVER_ID
    || candidate.reason !== Q_READINESS_WAIVER_REASON
    || candidate.owner !== Q_READINESS_WAIVER_OWNER
    || candidate.expiresAt !== Q_READINESS_WAIVER_EXPIRY
  ) return result('MALFORMED');
  if (nowMs >= Q_READINESS_WAIVER_EXPIRY_MS) return result('EXPIRED', SIGNED_Q_READINESS_WAIVER);
  return result('VALID', SIGNED_Q_READINESS_WAIVER);
}
