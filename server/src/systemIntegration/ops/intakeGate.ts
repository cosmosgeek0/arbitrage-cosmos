import type { CanonicalSupervisorOpsReadback } from './types.js';

const EXACT_READBACK_KEYS = Object.freeze([
  'ambiguityState',
  'currentSchemaVersion',
  'deploymentFrozen',
  'exposureState',
  'observedAtUtc',
  'recoveryState',
  'rollbackFloor',
  'source',
  'validUntilUtc',
] as const);
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MINIMUM_LEASE_MS = 5 * 60 * 1_000;
const MAXIMUM_LEASE_MS = 60 * 60 * 1_000;
const MAXIMUM_OBSERVED_AGE_MS = 30_000;

export interface CanonicalOpsIntakeInterlock {
  readonly source: 'CANONICAL_OPS_INTAKE_INTERLOCK';
  readonly state: 'OPS_INTERLOCK_CLEAR' | 'OPS_INTERLOCK_BLOCKED';
  readonly blocksNewEntries: boolean;
  readonly externalActionAuthorization: 'NONE';
  readonly evaluatedAtUtc: string;
  readonly readbackValidUntilUtc: string | null;
  readonly reasonCodes: readonly string[];
}

function utcSeconds(value: number): string {
  return new Date(Math.floor(value / 1_000) * 1_000).toISOString().replace('.000Z', 'Z');
}

function validNow(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 8_640_000_000_000_000;
}

function exactUtcSeconds(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_SECONDS.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && utcSeconds(parsed) === value;
}

function readbackShape(value: unknown): value is Readonly<CanonicalSupervisorOpsReadback> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== EXACT_READBACK_KEYS.length
      || keys.some((key, index) => key !== EXACT_READBACK_KEYS[index])) return false;
  if (record.source !== 'CANONICAL_SUPERVISOR_READBACK') return false;
  if (!exactUtcSeconds(record.observedAtUtc) || !exactUtcSeconds(record.validUntilUtc)) return false;
  if (![true, false, 'UNKNOWN'].includes(record.deploymentFrozen as boolean | string)) return false;
  if (!['NONE', 'ACTIVE', 'AMBIGUOUS', 'RECOVERY_REQUIRED', 'UNKNOWN'].includes(String(record.exposureState))) return false;
  if (!['NONE', 'AMBIGUOUS', 'UNKNOWN'].includes(String(record.ambiguityState))) return false;
  if (!['NONE', 'RECOVERY_REQUIRED', 'UNKNOWN'].includes(String(record.recoveryState))) return false;
  const versionPairAvailable = Number.isSafeInteger(record.currentSchemaVersion)
    && (record.currentSchemaVersion as number) >= 1
    && Number.isSafeInteger(record.rollbackFloor)
    && (record.rollbackFloor as number) >= 0
    && (record.rollbackFloor as number) <= (record.currentSchemaVersion as number);
  const versionPairUnavailable = record.currentSchemaVersion === null && record.rollbackFloor === null;
  return versionPairAvailable || versionPairUnavailable;
}

/**
 * Pure serial-spine interlock. Strategy/capital owners may consume its blocker,
 * but a clear result never authorizes an entry or any external action.
 */
export function evaluateCanonicalOpsIntakeGate(
  readback: unknown,
  nowMs: number,
): Readonly<CanonicalOpsIntakeInterlock> {
  if (!validNow(nowMs)) throw new TypeError('canonical ops intake interlock requires valid UTC milliseconds');
  const reasonCodes: string[] = [];
  let validUntilUtc: string | null = null;
  if (!readbackShape(readback)) {
    reasonCodes.push('CANONICAL_OPS_READBACK_INVALID');
  } else {
    validUntilUtc = readback.validUntilUtc;
    const observedAtMs = Date.parse(readback.observedAtUtc);
    const validUntilMs = Date.parse(readback.validUntilUtc);
    const leaseMs = validUntilMs - observedAtMs;
    if (
      observedAtMs > nowMs
      || nowMs - observedAtMs > MAXIMUM_OBSERVED_AGE_MS
      || leaseMs < MINIMUM_LEASE_MS
      || leaseMs > MAXIMUM_LEASE_MS
      || validUntilMs <= nowMs
    ) reasonCodes.push('CANONICAL_OPS_READBACK_NOT_CURRENT');

    if (readback.deploymentFrozen === true) reasonCodes.push('DEPLOYMENT_FROZEN');
    else if (readback.deploymentFrozen !== false) reasonCodes.push('DEPLOYMENT_FREEZE_STATE_UNKNOWN');
    if (readback.exposureState !== 'NONE') reasonCodes.push(`EXPOSURE_${readback.exposureState}`);
    if (readback.ambiguityState !== 'NONE') reasonCodes.push(`AMBIGUITY_${readback.ambiguityState}`);
    if (readback.recoveryState !== 'NONE') reasonCodes.push(`RECOVERY_${readback.recoveryState}`);
    if (readback.currentSchemaVersion === null || readback.rollbackFloor === null) {
      reasonCodes.push('LEDGER_SCHEMA_COMPATIBILITY_UNKNOWN');
    }
  }
  const blocksNewEntries = reasonCodes.length > 0;
  return Object.freeze({
    source: 'CANONICAL_OPS_INTAKE_INTERLOCK',
    state: blocksNewEntries ? 'OPS_INTERLOCK_BLOCKED' : 'OPS_INTERLOCK_CLEAR',
    blocksNewEntries,
    externalActionAuthorization: 'NONE',
    evaluatedAtUtc: utcSeconds(nowMs),
    readbackValidUntilUtc: validUntilUtc,
    reasonCodes: Object.freeze(reasonCodes),
  });
}
