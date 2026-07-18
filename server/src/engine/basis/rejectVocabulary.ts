import type { RejectCode } from '../v0/types.js';

/** Exact reject codes the Basis scanner is allowed to emit. */
export const BASIS_REJECT_CODES = Object.freeze([
  'data_stale',
  'spot_missing',
  'perp_missing',
  'book_missing',
  'edge_below_fees',
  'edge_below_threshold',
  'spread_too_wide',
  'depth_too_thin',
  'gap_not_persistent',
  'funding_against_trade',
  'borrow_unknown',
  'borrow_unavailable',
  'borrow_too_small',
  'borrow_cost_too_high',
  'symbol_blocked',
  'kill_switch_on',
] as const satisfies readonly RejectCode[]);

export type BasisRejectCode = (typeof BASIS_REJECT_CODES)[number];
export type HistoricalBasisRejectCode =
  | 'borrow_required'
  | 'risk_blocked'
  | 'account_not_connected';

export interface HistoricalBasisRejectDisposition {
  readonly disposition: 'RETIRED_DUPLICATE' | 'MOVED_TO_OWNER';
  readonly successorCode: BasisRejectCode | null;
  readonly successorOutcome: string;
  readonly owner: 'BASIS' | 'FOUNDATION_RISK' | 'CAPITAL_ELIGIBILITY';
}

/**
 * Historical Engine spellings remain explicit for replay/projection, but none
 * is a current Basis scanner outcome. Account and final-risk truth stay with
 * their canonical owners rather than being guessed inside strategy code.
 */
export const BASIS_HISTORICAL_REJECT_CODE_MAP: Readonly<
  Record<HistoricalBasisRejectCode, Readonly<HistoricalBasisRejectDisposition>>
> = Object.freeze({
  borrow_required: Object.freeze({
    disposition: 'RETIRED_DUPLICATE',
    successorCode: 'borrow_unknown',
    successorOutcome: 'strategy_decision',
    owner: 'BASIS',
  }),
  risk_blocked: Object.freeze({
    disposition: 'MOVED_TO_OWNER',
    successorCode: null,
    successorOutcome: 'risk_rejected',
    owner: 'FOUNDATION_RISK',
  }),
  account_not_connected: Object.freeze({
    disposition: 'MOVED_TO_OWNER',
    successorCode: null,
    successorOutcome: 'ACCOUNT_TRUTH_BLOCKED',
    owner: 'CAPITAL_ELIGIBILITY',
  }),
});

export interface BasisRejectVocabularySnapshot {
  readonly emitted: readonly BasisRejectCode[];
  readonly historical: typeof BASIS_HISTORICAL_REJECT_CODE_MAP;
}

export function basisRejectVocabularySnapshot(): Readonly<BasisRejectVocabularySnapshot> {
  return Object.freeze({
    emitted: BASIS_REJECT_CODES,
    historical: BASIS_HISTORICAL_REJECT_CODE_MAP,
  });
}
