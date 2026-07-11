import type { ActionRiskClass } from '../../foundation/contracts/index.js';
import type { ActionIntentId, ActivePositionId, PositionThesisId } from './identity.js';
import type { CapitalTruthState } from './truth.js';
import { compareExactDecimals, isExactDecimal, type ExactDecimal, type NonNegativeDecimal } from './decimal.js';

export const POSITION_ACTION_INTENTS = Object.freeze([
  'HOLD',
  'ADD_STAGE',
  'REDUCE',
  'REQUEST_HEDGE',
  'REQUEST_EXIT',
  'REQUEST_EMERGENCY_UNWIND',
  'FREEZE_NEW_ACTIONS',
  'NO_ACTION_UNKNOWN',
] as const);
export type PositionActionIntentKind = (typeof POSITION_ACTION_INTENTS)[number];

export const ACTION_URGENCIES = Object.freeze(['ROUTINE', 'ELEVATED', 'URGENT', 'EMERGENCY'] as const);
export type ActionUrgency = (typeof ACTION_URGENCIES)[number];

export const FUTURE_GATES = Object.freeze([
  'OPERATOR_APPROVAL',
  'MULTI_LEG_RISK',
  'EXECUTION_COORDINATOR',
  'RECONCILIATION',
  'FRESH_ACCOUNT_TRUTH',
  'FRESH_MARKET_EVIDENCE',
] as const);
export type FutureGate = (typeof FUTURE_GATES)[number];

export interface TotalExposureTarget {
  readonly kind: 'TOTAL';
  readonly valuationAsset: string;
  readonly quoteNotional: NonNegativeDecimal;
  readonly baseQuantity: ExactDecimal | null;
  readonly targetHedgeRatio: ExactDecimal | null;
}

export interface DeltaExposureTarget {
  readonly kind: 'DELTA';
  readonly valuationAsset: string;
  readonly quoteNotional: ExactDecimal;
  readonly baseQuantity: ExactDecimal | null;
  readonly targetHedgeRatio: ExactDecimal | null;
}

export interface UnknownExposureTarget {
  readonly kind: 'UNKNOWN';
  readonly valuationAsset: string;
  readonly reasonCodes: readonly string[];
}

export type ExposureTarget =
  | Readonly<TotalExposureTarget>
  | Readonly<DeltaExposureTarget>
  | Readonly<UnknownExposureTarget>;

interface PositionActionIntentBase {
  readonly id: ActionIntentId;
  readonly positionId: ActivePositionId;
  readonly sourcePositionRevision: number;
  readonly sourceThesisId: PositionThesisId;
  readonly sourceThesisRevision: number;
  readonly target: Readonly<ExposureTarget>;
  readonly urgency: ActionUrgency;
  readonly hardDeadlineMs: number | null;
  readonly why: readonly string[];
  readonly supportingEvidenceIds: readonly string[];
  readonly conflictingEvidenceIds: readonly string[];
  readonly requiredFutureGates: readonly FutureGate[];
  readonly completeness: CapitalTruthState;
  readonly blockingFacts: readonly string[];
  readonly idempotencyKey: string;
  readonly correlationKey: string;
  readonly economicCostOfWaiting: NonNegativeDecimal | null;
  readonly expectedCostOfActing: NonNegativeDecimal | null;
  readonly invalidationConditions: readonly string[];
  readonly createdAtMs: number;
}

type KnownExposureTarget = Readonly<TotalExposureTarget> | Readonly<DeltaExposureTarget>;

export type PositionActionIntent =
  | (PositionActionIntentBase & { readonly kind: 'ADD_STAGE'; readonly riskEffect: 'RISK_INCREASING'; readonly target: KnownExposureTarget })
  | (PositionActionIntentBase & { readonly kind: 'REDUCE' | 'REQUEST_HEDGE' | 'REQUEST_EXIT' | 'REQUEST_EMERGENCY_UNWIND'; readonly riskEffect: 'RISK_REDUCING'; readonly target: KnownExposureTarget })
  | (PositionActionIntentBase & { readonly kind: 'NO_ACTION_UNKNOWN'; readonly riskEffect: 'NO_CHANGE'; readonly target: Readonly<UnknownExposureTarget> })
  | (PositionActionIntentBase & { readonly kind: 'HOLD' | 'FREEZE_NEW_ACTIONS'; readonly riskEffect: 'NO_CHANGE'; readonly target: ExposureTarget });

export function actionRiskEffect(kind: PositionActionIntentKind): ActionRiskClass | 'NO_CHANGE' {
  switch (kind) {
    case 'ADD_STAGE':
      return 'RISK_INCREASING';
    case 'REDUCE':
    case 'REQUEST_HEDGE':
    case 'REQUEST_EXIT':
    case 'REQUEST_EMERGENCY_UNWIND':
      return 'RISK_REDUCING';
    case 'HOLD':
    case 'FREEZE_NEW_ACTIONS':
    case 'NO_ACTION_UNKNOWN':
      return 'NO_CHANGE';
  }
}

export function isRiskIncreasingIntent(intent: PositionActionIntent): boolean {
  return intent.riskEffect === 'RISK_INCREASING';
}

export function validatePositionActionIntent(input: unknown): readonly string[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return Object.freeze(['OBJECT_REQUIRED']);
  const record = input as Record<string, unknown>;
  const kind = record.kind;
  const target = typeof record.target === 'object' && record.target !== null && !Array.isArray(record.target)
    ? record.target as Record<string, unknown>
    : null;
  const reasons: string[] = [];
  if (!(POSITION_ACTION_INTENTS as readonly unknown[]).includes(kind)) reasons.push('ACTION_KIND_UNKNOWN');
  if (target === null || (target.kind !== 'TOTAL' && target.kind !== 'DELTA' && target.kind !== 'UNKNOWN')) {
    reasons.push('TARGET_KIND_INVALID');
  }
  if (kind === 'ADD_STAGE' && record.riskEffect !== 'RISK_INCREASING') reasons.push('RISK_EFFECT_MISMATCH');
  if (kind === 'REDUCE' || kind === 'REQUEST_HEDGE' || kind === 'REQUEST_EXIT' || kind === 'REQUEST_EMERGENCY_UNWIND') {
    if (record.riskEffect !== 'RISK_REDUCING') reasons.push('RISK_EFFECT_MISMATCH');
  }
  if (kind === 'HOLD' || kind === 'FREEZE_NEW_ACTIONS' || kind === 'NO_ACTION_UNKNOWN') {
    if (record.riskEffect !== 'NO_CHANGE') reasons.push('RISK_EFFECT_MISMATCH');
  }
  if (kind === 'NO_ACTION_UNKNOWN' && target?.kind !== 'UNKNOWN') reasons.push('UNKNOWN_ACTION_REQUIRES_UNKNOWN_TARGET');
  if ((kind === 'ADD_STAGE' || kind === 'REDUCE' || kind === 'REQUEST_HEDGE' || kind === 'REQUEST_EXIT' || kind === 'REQUEST_EMERGENCY_UNWIND') && target?.kind === 'UNKNOWN') {
    reasons.push('CAPITAL_MOVING_ACTION_REQUIRES_EXACT_TARGET');
  }
  if (target?.kind === 'TOTAL' || target?.kind === 'DELTA') {
    if (!isExactDecimal(target.quoteNotional)) {
      reasons.push('TARGET_DECIMAL_INVALID');
    } else if (target.kind === 'TOTAL' && compareExactDecimals(target.quoteNotional, '0' as ExactDecimal) < 0) {
      reasons.push('TOTAL_TARGET_MUST_BE_NON_NEGATIVE');
    }
  }
  if (target?.kind === 'UNKNOWN' && (!Array.isArray(target.reasonCodes) || target.reasonCodes.length === 0)) {
    reasons.push('UNKNOWN_TARGET_REQUIRES_REASON');
  }
  return Object.freeze([...new Set(reasons)]);
}
