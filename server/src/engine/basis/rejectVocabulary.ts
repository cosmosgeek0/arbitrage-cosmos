import type { FocusExitReason, RejectCode } from '../v0/types.js';

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
  readonly successorOutcome: 'strategy_decision' | 'risk_rejected' | 'ACCOUNT_TRUTH_BLOCKED';
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

export type BasisRejectProjectionClassification =
  | 'CURRENT_SCANNER'
  | 'CURRENT_ENGINE'
  | 'HISTORICAL'
  | 'INVALID';

/**
 * Lossless operational interpretation of a raw Basis reject spelling.
 *
 * `intake_paused` is an Engine-owned runtime outcome rather than a scanner
 * outcome, so it remains deliberately outside `BASIS_REJECT_CODES`.
 */
export interface BasisRejectProjection {
  readonly rawCode: string | null;
  readonly classification: BasisRejectProjectionClassification;
  readonly disposition:
    | 'CURRENT'
    | HistoricalBasisRejectDisposition['disposition']
    | 'INVALID';
  readonly successorCode: BasisRejectCode | 'intake_paused' | null;
  readonly successorOutcome:
    | 'strategy_decision'
    | 'risk_rejected'
    | 'ACCOUNT_TRUTH_BLOCKED'
    | 'INVALID';
  readonly owner:
    | HistoricalBasisRejectDisposition['owner']
    | 'ENGINE'
    | 'UNRESOLVED';
  readonly focusExitReason: Extract<FocusExitReason, 'risk_rejected' | 'cooldown'>;
}

const BASIS_REJECT_CODE_SET: ReadonlySet<string> = new Set(BASIS_REJECT_CODES);

/**
 * Project persisted/replayed spellings through the canonical retirement map.
 * Consumers must use this instead of independently reinterpreting raw codes.
 */
export function projectBasisRejectDisposition(rawCode: unknown): Readonly<BasisRejectProjection> {
  if (typeof rawCode !== 'string') {
    return Object.freeze({
      rawCode: null,
      classification: 'INVALID',
      disposition: 'INVALID',
      successorCode: null,
      successorOutcome: 'INVALID',
      owner: 'UNRESOLVED',
      focusExitReason: 'cooldown',
    });
  }

  if (BASIS_REJECT_CODE_SET.has(rawCode)) {
    const code = rawCode as BasisRejectCode;
    return Object.freeze({
      rawCode: code,
      classification: 'CURRENT_SCANNER',
      disposition: 'CURRENT',
      successorCode: code,
      successorOutcome: 'strategy_decision',
      owner: 'BASIS',
      focusExitReason: 'cooldown',
    });
  }

  if (rawCode === 'intake_paused') {
    return Object.freeze({
      rawCode,
      classification: 'CURRENT_ENGINE',
      disposition: 'CURRENT',
      successorCode: rawCode,
      successorOutcome: 'strategy_decision',
      owner: 'ENGINE',
      focusExitReason: 'cooldown',
    });
  }

  if (Object.prototype.hasOwnProperty.call(BASIS_HISTORICAL_REJECT_CODE_MAP, rawCode)) {
    const code = rawCode as HistoricalBasisRejectCode;
    const mapped = BASIS_HISTORICAL_REJECT_CODE_MAP[code];
    return Object.freeze({
      rawCode: code,
      classification: 'HISTORICAL',
      disposition: mapped.disposition,
      successorCode: mapped.successorCode,
      successorOutcome: mapped.successorOutcome,
      owner: mapped.owner,
      focusExitReason: mapped.successorOutcome === 'risk_rejected' ? 'risk_rejected' : 'cooldown',
    });
  }

  return Object.freeze({
    rawCode,
    classification: 'INVALID',
    disposition: 'INVALID',
    successorCode: null,
    successorOutcome: 'INVALID',
    owner: 'UNRESOLVED',
    focusExitReason: 'cooldown',
  });
}

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
