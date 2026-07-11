import { stableId, validateNoSecretFields, type ValidationResult } from '../contracts/index.js';
import type {
  OutcomeMetricField,
  OutcomePolicy,
  OutcomePolicySnapshot,
} from './types.js';
import {
  compareText,
  failure,
  immutableContract,
  isFiniteNonNegative,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  nonEmpty,
} from './internal.js';

export const OUTCOME_METRIC_FIELDS: readonly OutcomeMetricField[] = [
  'forwardReturnPct',
  'maximumFavorableExcursionPct',
  'maximumAdverseExcursionPct',
  'fadeFromPeakPct',
  'timeToPeakMs',
  'liquiditySurvivalRatio',
  'depthSurvivalRatio',
  'theoreticalExecutionFeasible',
  'laterMoved',
];

function normalizedNonNegative(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

export function normalizeOutcomePolicy(policy: OutcomePolicy | OutcomePolicySnapshot): ValidationResult<OutcomePolicySnapshot> {
  if (!policy || typeof policy !== 'object') {
    return failure('INVALID_VALUE', 'outcomes.policy', 'outcome policy must be an object', 'policy');
  }
  const secret = validateNoSecretFields(policy, 'outcomes.policy');
  if (!secret.ok) return secret as ValidationResult<OutcomePolicySnapshot>;
  if (!isPositiveSafeInteger(policy.horizonMs) || !['UP', 'DOWN'].includes(policy.direction)) {
    return failure('INVALID_VALUE', 'outcomes.policy', 'invalid horizon or direction', 'policy.horizonMs');
  }
  if (!isFiniteNonNegative(policy.movedThresholdPct) || !isNonNegativeSafeInteger(policy.terminalMaxAgeMs)) {
    return failure('INVALID_VALUE', 'outcomes.policy', 'invalid movement threshold or terminal age', 'policy');
  }
  if (!nonEmpty(policy.referenceEvidenceId) || !['TRADE', 'BOOK_MID', 'MARK', 'INDEX'].includes(policy.priceBasis)) {
    return failure('INVALID_VALUE', 'outcomes.policy', 'invalid price reference policy', 'policy.referenceEvidenceId');
  }
  if (!Array.isArray(policy.requiredMetricFields)) {
    return failure('INVALID_VALUE', 'outcomes.policy', 'required metric fields must be an array', 'policy.requiredMetricFields');
  }
  const required = [...policy.requiredMetricFields].sort(compareText);
  if (required.length === 0 || new Set(required).size !== required.length || required.some((field) => !OUTCOME_METRIC_FIELDS.includes(field))) {
    return failure('INVALID_VALUE', 'outcomes.policy', 'required metric fields must be a non-empty unique supported set', 'policy.requiredMetricFields');
  }
  if (policy.liquidity && !nonEmpty(policy.liquidity.referenceEvidenceId)) {
    return failure('INVALID_VALUE', 'outcomes.policy', 'invalid liquidity reference', 'policy.liquidity.referenceEvidenceId');
  }
  if (policy.depth && !nonEmpty(policy.depth.referenceEvidenceId)) {
    return failure('INVALID_VALUE', 'outcomes.policy', 'invalid depth reference', 'policy.depth.referenceEvidenceId');
  }
  if (policy.execution && (
    !nonEmpty(policy.execution.depthEvidenceId) || !['BUY', 'SELL'].includes(policy.execution.side) ||
    typeof policy.execution.intendedBaseQuantity !== 'number' || !Number.isFinite(policy.execution.intendedBaseQuantity) || policy.execution.intendedBaseQuantity <= 0 ||
    !isFiniteNonNegative(policy.execution.maximumSlippagePct)
  )) return failure('INVALID_VALUE', 'outcomes.policy', 'invalid theoretical execution policy', 'policy.execution');

  const material = {
    horizonMs: policy.horizonMs,
    direction: policy.direction,
    movedThresholdPct: normalizedNonNegative(policy.movedThresholdPct),
    terminalMaxAgeMs: policy.terminalMaxAgeMs,
    requiredMetricFields: required,
    referenceEvidenceId: policy.referenceEvidenceId,
    priceBasis: policy.priceBasis,
    liquidity: policy.liquidity ? { referenceEvidenceId: policy.liquidity.referenceEvidenceId } : null,
    depth: policy.depth ? { referenceEvidenceId: policy.depth.referenceEvidenceId } : null,
    execution: policy.execution ? {
      depthEvidenceId: policy.execution.depthEvidenceId,
      side: policy.execution.side,
      intendedBaseQuantity: policy.execution.intendedBaseQuantity,
      maximumSlippagePct: normalizedNonNegative(policy.execution.maximumSlippagePct),
    } : null,
  };
  return {
    ok: true,
    value: immutableContract({ id: stableId('outcome_policy', material), ...material }),
  };
}
