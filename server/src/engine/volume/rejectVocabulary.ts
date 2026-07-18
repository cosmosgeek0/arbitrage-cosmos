import type { FocusExitReason, RejectCode } from '../v0/types.js';

/** Exact reject codes the Volume detector is allowed to emit. */
export const VOLUME_REJECT_CODES = Object.freeze([
  'symbol_blocked',
  'data_stale',
  'baseline_missing',
  'book_missing',
  'spread_too_wide',
  'depth_too_thin',
  'move_already_extended',
  'taker_imbalance_missing',
  'one_print_spike',
  'trade_count_too_low',
  'price_no_followthrough',
  'kill_switch_on',
] as const satisfies readonly RejectCode[]);

export type VolumeRejectCode = (typeof VOLUME_REJECT_CODES)[number];
export type HistoricalVolumeRejectCode = 'volume_not_abnormal' | 'risk_blocked';

export interface HistoricalVolumeRejectDisposition {
  readonly disposition: 'RETIRED_NON_REJECT' | 'MOVED_TO_OWNER';
  readonly successorCode: VolumeRejectCode | null;
  readonly successorOutcome: 'ignore' | 'risk_rejected';
  readonly owner: 'VOLUME' | 'FOUNDATION_RISK';
}

/**
 * A normal-volume observation is not a rejected signal, and final risk is not
 * owned by the detector. Historical consumers get an explicit, lossless map
 * without keeping either spelling in the current detector vocabulary.
 */
export const VOLUME_HISTORICAL_REJECT_CODE_MAP: Readonly<
  Record<HistoricalVolumeRejectCode, Readonly<HistoricalVolumeRejectDisposition>>
> = Object.freeze({
  volume_not_abnormal: Object.freeze({
    disposition: 'RETIRED_NON_REJECT',
    successorCode: null,
    successorOutcome: 'ignore',
    owner: 'VOLUME',
  }),
  risk_blocked: Object.freeze({
    disposition: 'MOVED_TO_OWNER',
    successorCode: null,
    successorOutcome: 'risk_rejected',
    owner: 'FOUNDATION_RISK',
  }),
});

export type VolumeRejectProjectionClassification =
  | 'CURRENT_DETECTOR'
  | 'CURRENT_ENGINE'
  | 'HISTORICAL'
  | 'INVALID';

export interface VolumeRejectProjection {
  readonly rawCode: string | null;
  readonly classification: VolumeRejectProjectionClassification;
  readonly disposition: 'CURRENT' | HistoricalVolumeRejectDisposition['disposition'] | 'INVALID';
  readonly successorCode: VolumeRejectCode | 'intake_paused' | null;
  readonly successorOutcome: 'strategy_decision' | 'ignore' | 'risk_rejected' | 'INVALID';
  readonly owner: HistoricalVolumeRejectDisposition['owner'] | 'ENGINE' | 'UNRESOLVED';
  readonly focusExitReason: Extract<
    FocusExitReason,
    'signal_expired' | 'volume_normalized' | 'risk_rejected'
  >;
}

const VOLUME_REJECT_CODE_SET: ReadonlySet<string> = new Set(VOLUME_REJECT_CODES);

/**
 * Losslessly project a persisted Volume reject spelling through the formal
 * retirement map. Replay consumers use this function rather than inventing
 * their own replacement semantics.
 */
export function projectVolumeRejectDisposition(rawCode: unknown): Readonly<VolumeRejectProjection> {
  if (typeof rawCode !== 'string') {
    return Object.freeze({
      rawCode: null,
      classification: 'INVALID',
      disposition: 'INVALID',
      successorCode: null,
      successorOutcome: 'INVALID',
      owner: 'UNRESOLVED',
      focusExitReason: 'signal_expired',
    });
  }

  if (VOLUME_REJECT_CODE_SET.has(rawCode)) {
    const code = rawCode as VolumeRejectCode;
    return Object.freeze({
      rawCode: code,
      classification: 'CURRENT_DETECTOR',
      disposition: 'CURRENT',
      successorCode: code,
      successorOutcome: 'strategy_decision',
      owner: 'VOLUME',
      focusExitReason: 'signal_expired',
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
      focusExitReason: 'signal_expired',
    });
  }

  if (Object.prototype.hasOwnProperty.call(VOLUME_HISTORICAL_REJECT_CODE_MAP, rawCode)) {
    const code = rawCode as HistoricalVolumeRejectCode;
    const mapped = VOLUME_HISTORICAL_REJECT_CODE_MAP[code];
    return Object.freeze({
      rawCode: code,
      classification: 'HISTORICAL',
      disposition: mapped.disposition,
      successorCode: mapped.successorCode,
      successorOutcome: mapped.successorOutcome,
      owner: mapped.owner,
      focusExitReason: mapped.successorOutcome === 'ignore'
        ? 'volume_normalized'
        : 'risk_rejected',
    });
  }

  return Object.freeze({
    rawCode,
    classification: 'INVALID',
    disposition: 'INVALID',
    successorCode: null,
    successorOutcome: 'INVALID',
    owner: 'UNRESOLVED',
    focusExitReason: 'signal_expired',
  });
}

export interface VolumeRejectVocabularySnapshot {
  readonly emitted: readonly VolumeRejectCode[];
  readonly historical: typeof VOLUME_HISTORICAL_REJECT_CODE_MAP;
}

export function volumeRejectVocabularySnapshot(): Readonly<VolumeRejectVocabularySnapshot> {
  return Object.freeze({
    emitted: VOLUME_REJECT_CODES,
    historical: VOLUME_HISTORICAL_REJECT_CODE_MAP,
  });
}
