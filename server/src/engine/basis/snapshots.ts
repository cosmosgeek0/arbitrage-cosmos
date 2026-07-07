/**
 * Basis engine — snapshot builders (ENGINE.md §15 concepts). Pure data, no
 * express: the API layer (a later pass, outside this lane) serves these
 * verbatim. Implements the v0 EngineSnapshots contract plus basis extras
 * (priorities, per-symbol feature detail).
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
import type { BasisEngine } from './engine.js';
import type { MemoryEventSink } from './events.js';
import type { BasisFeatureSnapshot, PriorityScore } from './types.js';

export interface BasisSnapshots extends EngineSnapshots {
  priorities(): PriorityScore[];
  featureDetail(symbol: string): BasisFeatureSnapshot | null;
}

/**
 * Build the snapshot facade over a BasisEngine. `sink` is optional — without a
 * readable sink (production ledger owns the events) events() returns [].
 */
export function buildSnapshots(engine: BasisEngine, sink?: MemoryEventSink): BasisSnapshots {
  return {
    status(): EngineStatusSnapshot {
      const universe = engine.market.universe();
      const lifecycles = engine.lifecycle.all();
      const lastTickTs = engine.lastTick();
      return {
        running: engine.isRunning(),
        ts: lastTickTs ?? 0,
        universeSize: universe.length,
        eligibleSize: universe.filter((s) => s.eligible).length,
        watching: lifecycles.filter((l) => l.state === 'WATCHING').length,
        focused: engine.lifecycle.activeFocusCount(),
        openProposals: engine.proposals.open().length,
        lastTickTs,
        heartbeatAgeMs: null, // runner-level concern; engine has no wall clock of its own
      };
    },

    universe(): SymbolMeta[] {
      return engine.market.universe();
    },

    decisions(limit = 100): Decision[] {
      return engine.decisions(limit);
    },

    candidates(): Candidate[] {
      return engine.lifecycle.candidateList();
    },

    focus(): FocusSession[] {
      return engine.lifecycle.focusSessions();
    },

    proposals(): EngineProposal[] {
      return engine.proposals.all();
    },

    events(limit = 200): EngineEvent[] {
      return sink ? sink.events.slice(-limit) : [];
    },

    priorities(): PriorityScore[] {
      return engine.priorities();
    },

    featureDetail(symbol: string): BasisFeatureSnapshot | null {
      return engine.featureSnapshot(symbol);
    },
  };
}
