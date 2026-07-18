/**
 * Snapshot builders — pure data, no express (ENGINE.md §15). Implements the
 * frozen EngineSnapshots contract; route wiring is the Director's merge job.
 */
import type {
  Candidate,
  Decision,
  EngineEvent,
  EngineProposal,
  EngineSnapshots,
  EngineStatusSnapshot,
  FocusSession,
  SymbolMeta,
} from '../v0/types.js';
import type { WakeupSnapshot } from './types.js';
import type { VolumeEngine } from './engine.js';
import {
  volumeRejectVocabularySnapshot,
  type VolumeRejectVocabularySnapshot,
} from './rejectVocabulary.js';

export class VolumeSnapshots implements EngineSnapshots {
  constructor(private engine: VolumeEngine) {}

  status(): EngineStatusSnapshot {
    const now = this.engine.clock.now();
    const universe = this.engine.universe();
    const lastTickTs = this.engine.lastTick();
    return {
      running: this.engine.isRunning(),
      ts: now,
      universeSize: universe.length,
      eligibleSize: universe.filter((m) => m.eligible).length,
      watching: this.engine.focusMgr.candidateList().length,
      focused: this.engine.focusMgr.focusSessions().length,
      openProposals: this.engine.proposalStore.openProposals().length,
      lastTickTs,
      heartbeatAgeMs: lastTickTs === null ? null : now - lastTickTs,
    };
  }

  universe(): SymbolMeta[] {
    return this.engine.universe();
  }

  decisions(limit = 100): Decision[] {
    return this.engine.decisions(limit);
  }

  candidates(): Candidate[] {
    return this.engine.focusMgr.candidateList();
  }

  focus(): FocusSession[] {
    return this.engine.focusMgr.focusSessions();
  }

  proposals(): EngineProposal[] {
    return this.engine.proposalStore.all();
  }

  events(limit = 100): EngineEvent[] {
    return this.engine.memSink.recent(limit);
  }

  /** Extra beyond the frozen contract: per-symbol wakeup features for the UI. */
  featuresOf(symbol: string): WakeupSnapshot | null {
    return this.engine.featureSnapshot(symbol);
  }

  rejectVocabulary(): Readonly<VolumeRejectVocabularySnapshot> {
    return volumeRejectVocabularySnapshot();
  }
}
