/**
 * Engine Chassis v0 — default thresholds (Director-owned frozen contract).
 * All values overridable per-instance/test via `engineConfig(partial)`.
 * Sources: ENGINE.md §7–§11 + existing app config posture (fees 0.30%, min net 0.25%).
 */

export interface EngineConfig {
  // basis scanner
  feesPct: number; // round-trip cost estimate for the 4-leg basis trade
  minNetBasisPct: number; // required edge on top of fees
  persistTicks: number; // consecutive ticks a gap must persist before proposal
  slippagePctEstimate: number;
  maxSpreadBps: number; // wider than this on either leg → spread_too_wide
  minDepthScore: number; // 0..1, below → depth_too_thin
  staleMs: number; // book/mark older than this → data_stale

  // volume spike scanner
  vol1sMultiple: number; // 1s quote volume vs own baseline to activate
  vol5sMultiple: number; // 5s confirmation multiple
  minTradeCountMultiple: number;
  minFollowthroughPct: number; // price move confirming the spike
  maxExtendedMovePct: number; // beyond this the move is already extended
  baselineMinSamples: number; // buckets needed before baseline is trusted
  onePrintMaxTrades: number; // ≤ this many trades in the burst window = one-print suspect

  // focus manager
  focusSoftCap: number;
  focusHardCap: number;
  focusMaxAgeMs: number;
  candidateTtlMs: number;
  cooldownMs: number;

  // universe / eligibility
  minQuoteVolume24hUsd: number;

  // proposals
  proposalTtlMs: number;
  suggestedNotionalUsd: number; // conservative default sizing

  // runner
  tickMs: number;
  heartbeatMs: number;
}

export const ENGINE_DEFAULTS: EngineConfig = {
  feesPct: 0.3,
  minNetBasisPct: 0.25,
  persistTicks: 5,
  slippagePctEstimate: 0.05,
  maxSpreadBps: 25,
  minDepthScore: 0.3,
  staleMs: 5_000,

  vol1sMultiple: 8,
  vol5sMultiple: 4,
  minTradeCountMultiple: 3,
  minFollowthroughPct: 0.15,
  maxExtendedMovePct: 3.0,
  baselineMinSamples: 30,
  onePrintMaxTrades: 2,

  focusSoftCap: 10,
  focusHardCap: 25,
  focusMaxAgeMs: 15 * 60_000,
  candidateTtlMs: 5 * 60_000,
  cooldownMs: 10 * 60_000,

  minQuoteVolume24hUsd: 3_000_000,

  proposalTtlMs: 10 * 60_000,
  suggestedNotionalUsd: 10,

  tickMs: 2_000,
  heartbeatMs: 30_000,
};

export function engineConfig(partial?: Partial<EngineConfig>): EngineConfig {
  return { ...ENGINE_DEFAULTS, ...(partial ?? {}) };
}
