import type { FocusExitReason } from '../v0/types.js';

export type HistoricalFocusExitReason =
  | 'signal expired'
  | 'gap closed'
  | 'volume returned to baseline'
  | 'spread/depth invalid'
  | 'risk rejected'
  | 'max focus time'
  | 'cooldown started';

/**
 * ENGINE.md's human labels are immutable historical input. Current engine
 * events use stable machine spellings; this map makes every rename explicit
 * for replay and projection instead of relying on ad-hoc string cleanup.
 */
export const FOCUS_HISTORICAL_EXIT_REASON_MAP: Readonly<Record<
  HistoricalFocusExitReason,
  FocusExitReason
>> = Object.freeze({
  'signal expired': 'signal_expired',
  'gap closed': 'gap_closed',
  'volume returned to baseline': 'volume_normalized',
  'spread/depth invalid': 'spread_depth_invalid',
  'risk rejected': 'risk_rejected',
  'max focus time': 'max_focus_time',
  'cooldown started': 'cooldown',
});
