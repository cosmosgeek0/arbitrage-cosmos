/**
 * Basis engine — public surface. Everything the runner/API layer (later
 * passes, outside this lane) needs, in one import.
 */
export { BasisEngine, type PreparedIntents } from './engine.js';
export { basisConfig, BASIS_DEFAULTS, type BasisConfig } from './config.js';
export { BasisScanner } from './scanner.js';
export { BasisMarketState } from './marketState.js';
export { BasisFeatureBuilder } from './features.js';
export { GapTracker } from './gapTracker.js';
export { LifecycleManager } from './lifecycle.js';
export { BasisProposalStore } from './proposals.js';
export { MemoryEventSink, EventEmitter } from './events.js';
export { buildSnapshots, type BasisSnapshots } from './snapshots.js';
export {
  createReplayHarness,
  perpetualBookReplayStep,
  spotBookReplayStep,
  type ReplayHarness,
} from './replay.js';
export { priorityFor, primaryDirection } from './priority.js';
export { preflightBorrow } from './borrow.js';
export { buildFundingContext, expectedHoldMs, fundingFlipRisk } from './funding.js';
export { assessLiquidity, assessDataQuality } from './liquidity.js';
export { estimateEdge } from './edge.js';
export {
  BASIS_HISTORICAL_REJECT_CODE_MAP,
  BASIS_REJECT_CODES,
  basisRejectVocabularySnapshot,
  type BasisRejectCode,
  type BasisRejectVocabularySnapshot,
  type HistoricalBasisRejectCode,
  type HistoricalBasisRejectDisposition,
} from './rejectVocabulary.js';
export * from './math.js';
export type * from './types.js';
