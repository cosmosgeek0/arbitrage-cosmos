/**
 * Priority ranking — explainable, sortable (ENGINE.md §10). Multiplicative
 * composition per the work order: freshness × volume multiple ×
 * trade-count multiple × acceleration × spread × depth × focus age.
 * Every component is exposed so the ledger/UI can show WHY a symbol ranks.
 */
import type { PriorityBreakdown, WakeupSnapshot } from './types.js';
import type { VolumeConfig } from './config.js';

/** log-scaled, saturating multiple → keeps a 500× freak from drowning everything */
function satLog(multiple: number | null | undefined, saturateAt: number): number {
  if (multiple === null || multiple === undefined || multiple <= 1) return 0;
  return Math.min(1, Math.log(multiple) / Math.log(saturateAt));
}

export function priorityOf(f: WakeupSnapshot, cfg: VolumeConfig): PriorityBreakdown {
  const freshness =
    f.signalAgeMs === Infinity ? 0 : Math.pow(0.5, f.signalAgeMs / cfg.freshnessHalfLifeMs);
  const volumeMultiple = satLog(f.volumeMultiple['5s'], cfg.vol1sMultiple * 100);
  const tradeCountMultiple = satLog(f.tradeCountMultiple['5s'], cfg.minTradeCountMultiple * 100);
  const acceleration =
    f.accelerationPctPerMin === null
      ? 0.25 // unknown ≠ zero signal; small neutral prior
      : Math.min(1, Math.abs(f.accelerationPctPerMin) / 2);
  const spreadQuality =
    f.spotSpreadBps === null ? 0.25 : Math.max(0, 1 - f.spotSpreadBps / cfg.maxSpreadBps);
  const depthQuality = f.depthScore === null ? 0.25 : f.depthScore;
  const focusAgePenalty =
    f.focusAgeMs <= cfg.focusAgePenaltyAfterMs
      ? 1
      : Math.pow(0.5, (f.focusAgeMs - cfg.focusAgePenaltyAfterMs) / cfg.focusAgePenaltyAfterMs);
  // multiplicative core (signals), with quality terms blended in softly so a
  // single 0 quality reading doesn't zero an otherwise screaming signal
  const core = freshness * (0.2 + volumeMultiple) * (0.2 + tradeCountMultiple);
  const quality = (0.3 + 0.7 * spreadQuality) * (0.3 + 0.7 * depthQuality) * (0.5 + 0.5 * acceleration);
  return {
    score: core * quality * focusAgePenalty,
    freshness,
    volumeMultiple,
    tradeCountMultiple,
    acceleration,
    spreadQuality,
    depthQuality,
    focusAgePenalty,
  };
}
