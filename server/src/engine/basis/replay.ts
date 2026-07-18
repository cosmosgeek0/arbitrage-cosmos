/**
 * Basis engine — synthetic replay runner (ENGINE.md §16 Part 12 posture).
 * Drives a BasisEngine through a scripted tick sequence against a ManualClock:
 * event → feature → decision → proposal/reject → ledger, fully deterministic,
 * zero network. This is both the test harness backbone and the template for
 * the future live runner (which swaps scripted events for stream adapters).
 */
import { ManualClock } from '../v0/clock.js';
import type { Decision } from '../v0/types.js';
import { BasisEngine } from './engine.js';
import { MemoryEventSink } from './events.js';
import type { BasisConfig } from './config.js';
import type { BookTicker } from '../v0/types.js';
import type { ReplayResult, ReplayStep } from './types.js';

export interface ReplayHarness {
  engine: BasisEngine;
  clock: ManualClock;
  sink: MemoryEventSink;
  run(steps: ReplayStep[]): ReplayResult;
}

/** One explicit accepted-market step for causal tapes. */
export function spotBookReplayStep(atMs: number, tick: BookTicker, runTick = true): ReplayStep {
  return { atMs, events: [{ type: 'spotBook', tick: { ...tick } }], tick: runTick };
}

/** One explicit accepted-market step for causal tapes. */
export function perpetualBookReplayStep(atMs: number, tick: BookTicker, runTick = true): ReplayStep {
  return { atMs, events: [{ type: 'perpBook', tick: { ...tick } }], tick: runTick };
}

export function createReplayHarness(cfg?: Partial<BasisConfig>, startMs = 1_000_000): ReplayHarness {
  const clock = new ManualClock(startMs);
  const sink = new MemoryEventSink();
  const engine = new BasisEngine(clock, sink, cfg);
  engine.start();

  const run = (steps: ReplayStep[]): ReplayResult => {
    const decisions: Decision[] = [];
    let ticks = 0;
    for (const step of steps) {
      if (step.atMs < clock.now()) {
        throw new Error(`replay steps must be time-ordered: ${step.atMs} < ${clock.now()}`);
      }
      clock.set(step.atMs);
      for (const ev of step.events) {
        switch (ev.type) {
          case 'spotBook':
            engine.onSpotBook(ev.tick);
            break;
          case 'perpBook':
            engine.onPerpBook(ev.tick);
            break;
          case 'markFunding':
            engine.onMarkFunding(ev.tick);
            break;
          case 'spotDepth':
            engine.onSpotDepth(ev.ladder);
            break;
          case 'perpDepth':
            engine.onPerpDepth(ev.ladder);
            break;
          case 'borrow':
            engine.onBorrowInfo(ev.info);
            break;
          case 'fundingHistory':
            engine.seedFundingHistory(ev.symbol, ev.points);
            break;
          case 'universe':
            engine.setUniverse(ev.symbols);
            break;
          case 'killSwitch':
            engine.setKillSwitch(ev.on);
            break;
        }
      }
      if (step.tick !== false) {
        decisions.push(...engine.tick());
        ticks += 1;
      }
    }
    return { steps: steps.length, ticks, decisions, finalTs: clock.now() };
  };

  return { engine, clock, sink, run };
}
