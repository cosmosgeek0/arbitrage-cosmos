import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import { canonicalJson } from '../../../foundation/contracts/index.js';
import {
  VOLUME_PROTECTION_POLICY_SCHEMA,
  VOLUME_PROTECTION_REVISION_DECISION_SCHEMA,
  type VolumeProtectionPolicy,
  type VolumeProtectionRevisionDecision,
} from './types.js';

const MAX_UTC_MS = 4_102_444_800_000;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{2,255}$/u;
const REVISION = /^l11policy_[0-9a-f]{64}$/u;
const POLICY_MATERIAL_FIELDS = Object.freeze([
  'schema', 'policyId', 'revisionSequence', 'priorPolicyRevision', 'effectiveFromMs',
  'maximumHoldingMs', 'maximumLossBps', 'trailingActivationBps', 'trailingDistanceBps',
  'maximumEvidenceAgeMs', 'noRepeatWindowMs', 'probeCumulativePpm', 'confirmCumulativePpm',
  'fullCumulativePpm', 'exhaustionReductionTargetPpm', 'sourceDegradationAction',
] as const);
const POLICY_FIELDS = Object.freeze([...POLICY_MATERIAL_FIELDS, 'policyRevision'] as const);

const AUTHORITY = Object.freeze({
  lifecycleAuthority: 'ADVISORY_LIFECYCLE_PROJECTION_ONLY' as const,
  simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
  sendEligible: false as const,
  actionAuthority: 'NONE_RECORD_ONLY' as const,
  externalActionAuthorization: 'NONE' as const,
});

function digest(prefix: string, value: unknown): string {
  return `${prefix}${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function material(policy: Omit<VolumeProtectionPolicy, 'policyRevision'>): unknown {
  return policy;
}

function safeClosedRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain record`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')
    || canonicalJson((keys as string[]).sort()) !== canonicalJson([...fields].sort())) {
    throw new TypeError(`${label} fields must match the closed schema`);
  }
  const output: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label} must contain enumerable data properties`);
    }
    output[key] = descriptor.value;
  }
  return output;
}

export function deriveVolumeProtectionPolicyRevision(
  policy: Omit<VolumeProtectionPolicy, 'policyRevision'>,
): string {
  const safe = safeClosedRecord(policy, POLICY_MATERIAL_FIELDS, 'Volume protection policy material');
  return digest('l11policy_', material(safe as unknown as Omit<VolumeProtectionPolicy, 'policyRevision'>));
}

export function validateVolumeProtectionPolicy(value: unknown): Readonly<VolumeProtectionPolicy> {
  const policy = safeClosedRecord(value, POLICY_FIELDS, 'Volume protection policy');
  if (policy.schema !== VOLUME_PROTECTION_POLICY_SCHEMA
    || typeof policy.policyId !== 'string' || !ID.test(policy.policyId)
    || typeof policy.policyRevision !== 'string' || !REVISION.test(policy.policyRevision)
    || !Number.isSafeInteger(policy.revisionSequence) || (policy.revisionSequence as number) <= 0
    || (policy.priorPolicyRevision !== null
      && (typeof policy.priorPolicyRevision !== 'string' || !REVISION.test(policy.priorPolicyRevision)))) {
    throw new TypeError('Volume protection policy identity is invalid');
  }
  if ((policy.revisionSequence === 1) !== (policy.priorPolicyRevision === null)) {
    throw new TypeError('Volume protection policy predecessor binding is invalid');
  }
  const timeFields = ['effectiveFromMs', 'maximumHoldingMs', 'maximumEvidenceAgeMs', 'noRepeatWindowMs'] as const;
  for (const field of timeFields) {
    if (!Number.isSafeInteger(policy[field]) || (policy[field] as number) <= 0 || (policy[field] as number) > MAX_UTC_MS) {
      throw new TypeError(`${field} is invalid`);
    }
  }
  const bpsFields = ['maximumLossBps', 'trailingActivationBps', 'trailingDistanceBps'] as const;
  for (const field of bpsFields) {
    if (!Number.isSafeInteger(policy[field]) || (policy[field] as number) <= 0 || (policy[field] as number) >= 10_000) {
      throw new TypeError(`${field} must be an integer in [1, 9999]`);
    }
  }
  const ppmFields = [
    'probeCumulativePpm', 'confirmCumulativePpm', 'fullCumulativePpm', 'exhaustionReductionTargetPpm',
  ] as const;
  for (const field of ppmFields) {
    if (!Number.isSafeInteger(policy[field]) || (policy[field] as number) < 0 || (policy[field] as number) > 1_000_000) {
      throw new TypeError(`${field} must be an integer in [0, 1000000]`);
    }
  }
  if ((policy.probeCumulativePpm as number) <= 0
    || (policy.probeCumulativePpm as number) >= (policy.confirmCumulativePpm as number)
    || (policy.confirmCumulativePpm as number) >= (policy.fullCumulativePpm as number)
    || (policy.fullCumulativePpm as number) > 1_000_000
    || (policy.exhaustionReductionTargetPpm as number) >= 1_000_000) {
    throw new TypeError('Volume stage PPM policy must be cumulative and bounded');
  }
  if (policy.sourceDegradationAction !== 'REDUCE' && policy.sourceDegradationAction !== 'EXIT') {
    throw new TypeError('Volume source degradation action is invalid');
  }
  const cloned = JSON.parse(canonicalJson(policy)) as VolumeProtectionPolicy;
  const expected = deriveVolumeProtectionPolicyRevision({
    schema: cloned.schema,
    policyId: cloned.policyId,
    revisionSequence: cloned.revisionSequence,
    priorPolicyRevision: cloned.priorPolicyRevision,
    effectiveFromMs: cloned.effectiveFromMs,
    maximumHoldingMs: cloned.maximumHoldingMs,
    maximumLossBps: cloned.maximumLossBps,
    trailingActivationBps: cloned.trailingActivationBps,
    trailingDistanceBps: cloned.trailingDistanceBps,
    maximumEvidenceAgeMs: cloned.maximumEvidenceAgeMs,
    noRepeatWindowMs: cloned.noRepeatWindowMs,
    probeCumulativePpm: cloned.probeCumulativePpm,
    confirmCumulativePpm: cloned.confirmCumulativePpm,
    fullCumulativePpm: cloned.fullCumulativePpm,
    exhaustionReductionTargetPpm: cloned.exhaustionReductionTargetPpm,
    sourceDegradationAction: cloned.sourceDegradationAction,
  });
  if (cloned.policyRevision !== expected) throw new TypeError('Volume protection policy revision does not match content');
  return Object.freeze(cloned);
}

function decision(
  state: VolumeProtectionRevisionDecision['state'],
  reasons: readonly string[],
  current: VolumeProtectionPolicy,
  proposed: VolumeProtectionPolicy,
  evaluatedAtMs: number,
): Readonly<VolumeProtectionRevisionDecision> {
  const semantic = {
    state,
    reasonCodes: [...reasons],
    currentPolicyRevision: current.policyRevision,
    proposedPolicyRevision: proposed.policyRevision,
    evaluatedAtMs,
    favorableExtremeMustBePreserved: true as const,
  };
  return Object.freeze({
    schema: VOLUME_PROTECTION_REVISION_DECISION_SCHEMA,
    ...semantic,
    reasonCodes: Object.freeze([...reasons]),
    decisionRevision: digest('l11policydecision_', semantic),
    ...AUTHORITY,
  });
}

/**
 * Active-position policy revisions are tighten-only. A wider policy must be
 * reviewed by the canonical Capital/Risk owners before a later lifecycle can
 * consume it; this adapter never silently expands exposure or exit latency.
 */
export function evaluateVolumeProtectionRevision(input: Readonly<{
  current: unknown;
  proposed: unknown;
  evaluatedAtMs: number;
  positionActive: boolean;
}>): Readonly<VolumeProtectionRevisionDecision> {
  const safeInput = safeClosedRecord(input, ['current', 'proposed', 'evaluatedAtMs', 'positionActive'],
    'Volume protection revision input');
  const current = validateVolumeProtectionPolicy(safeInput.current);
  const proposed = validateVolumeProtectionPolicy(safeInput.proposed);
  if (!Number.isSafeInteger(safeInput.evaluatedAtMs) || (safeInput.evaluatedAtMs as number) < 0
    || (safeInput.evaluatedAtMs as number) > MAX_UTC_MS) {
    throw new TypeError('policy revision evaluation time is invalid');
  }
  if (typeof safeInput.positionActive !== 'boolean') throw new TypeError('positionActive must be boolean');
  const evaluatedAtMs = safeInput.evaluatedAtMs as number;
  const positionActive = safeInput.positionActive;
  if (proposed.policyRevision === current.policyRevision) {
    return decision('NOOP', ['POLICY_REVISION_UNCHANGED'], current, proposed, evaluatedAtMs);
  }
  const reasons: string[] = [];
  if (proposed.policyId !== current.policyId) reasons.push('POLICY_ID_CHANGED');
  if (proposed.revisionSequence !== current.revisionSequence + 1) reasons.push('POLICY_SEQUENCE_NOT_MONOTONIC');
  if (proposed.priorPolicyRevision !== current.policyRevision) reasons.push('POLICY_PREDECESSOR_MISMATCH');
  if (proposed.effectiveFromMs < current.effectiveFromMs || proposed.effectiveFromMs > evaluatedAtMs) {
    reasons.push('POLICY_EFFECTIVE_TIME_INVALID');
  }
  if (positionActive) {
    if (proposed.maximumHoldingMs > current.maximumHoldingMs) reasons.push('TIME_STOP_WIDENED');
    if (proposed.maximumLossBps > current.maximumLossBps) reasons.push('LOSS_STOP_WIDENED');
    if (proposed.trailingActivationBps > current.trailingActivationBps) reasons.push('TRAILING_ACTIVATION_WIDENED');
    if (proposed.trailingDistanceBps > current.trailingDistanceBps) reasons.push('TRAILING_DISTANCE_WIDENED');
    if (proposed.maximumEvidenceAgeMs > current.maximumEvidenceAgeMs) reasons.push('FRESHNESS_WINDOW_WIDENED');
    if (proposed.noRepeatWindowMs < current.noRepeatWindowMs) reasons.push('NO_REPEAT_WINDOW_NARROWED');
    if (proposed.probeCumulativePpm > current.probeCumulativePpm
      || proposed.confirmCumulativePpm > current.confirmCumulativePpm
      || proposed.fullCumulativePpm > current.fullCumulativePpm) reasons.push('STAGE_CAP_WIDENED');
    if (proposed.exhaustionReductionTargetPpm > current.exhaustionReductionTargetPpm) {
      reasons.push('EXHAUSTION_REDUCTION_WEAKENED');
    }
    if (current.sourceDegradationAction === 'EXIT' && proposed.sourceDegradationAction === 'REDUCE') {
      reasons.push('SOURCE_DEGRADATION_ACTION_WEAKENED');
    }
  }
  return decision(reasons.length === 0 ? 'ACCEPTED' : 'REJECTED', reasons.length === 0
    ? ['POLICY_REVISION_TIGHTEN_ONLY_ACCEPTED'] : reasons.sort(), current, proposed, evaluatedAtMs);
}
