/**
 * Volume/wakeup engine — public surface.
 * Territory: server/src/engine/volume/** (TASK_VOLUME_OVERDRIVE.md).
 * Frozen chassis contracts re-exported for consumers' convenience.
 */
export * from './types.js';
export { volumeConfig, VOLUME_DEFAULTS, type VolumeConfig } from './config.js';
export { RollingTape, type WindowExtras } from './rolling.js';
export { computeBaseline, volumeMultipleOf, tradeCountMultipleOf } from './baseline.js';
export { analyzeTape } from './tape.js';
export { BookQualityTracker } from './depth.js';
export { VolumeFeatureEngine } from './features.js';
export { WakeupDetector, type VolumeScanContext } from './detector.js';
export { priorityOf } from './priority.js';
export { FocusManager } from './focus.js';
export { ProposalStore, type IntentResult } from './proposals.js';
export { MemoryEventSink, makeEvent } from './events.js';
export { VolumeEngine } from './engine.js';
export { VolumeSnapshots } from './snapshots.js';
export {
  VOLUME_HISTORICAL_REJECT_CODE_MAP,
  VOLUME_REJECT_CODES,
  projectVolumeRejectDisposition,
  volumeRejectVocabularySnapshot,
  type HistoricalVolumeRejectCode,
  type HistoricalVolumeRejectDisposition,
  type VolumeRejectCode,
  type VolumeRejectProjection,
  type VolumeRejectProjectionClassification,
  type VolumeRejectVocabularySnapshot,
} from './rejectVocabulary.js';
export {
  SyntheticReplayRunner,
  seededRng,
  quietTape,
  burstTape,
  steadyBooks,
  type PlayOptions,
} from './runner.js';
export {
  mapAggTrade,
  mapBookTicker,
  miniTickerDelta,
  type RawAggTrade,
  type RawBookTicker,
  type RawMiniTicker,
  type TradeSource,
  type BookSource,
  type UniverseVolumeSource,
} from './adapters.js';

// frozen chassis conveniences (READ-ONLY imports, never edited here)
export { ManualClock, systemClock, newCorrelationId } from '../v0/clock.js';
export type {
  Clock,
  Decision,
  EngineEvent,
  EngineProposal,
  EngineSnapshots,
  EventSink,
  FeatureSnapshot,
  OrderIntentStub,
  SymbolMeta,
  TradeTick,
  BookTicker,
} from '../v0/types.js';
