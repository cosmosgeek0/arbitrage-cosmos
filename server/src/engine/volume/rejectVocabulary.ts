import type { RejectCode } from '../v0/types.js';

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
