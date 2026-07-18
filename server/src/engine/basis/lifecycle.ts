/**
 * Basis engine — symbol lifecycle + focus manager (ENGINE.md §5, §10).
 * Owns the per-symbol state machine (IDLE → WATCHING → FOCUS → PROPOSED →
 * REJECTED/COOLDOWN), the scarce-focus discipline (soft/hard caps, pinning,
 * score-based eviction), candidate TTLs and cooldowns. Every transition is
 * ledgered — transitions nobody can explain are forbidden.
 */
import type { Candidate, Clock, Decision, FocusExitReason, FocusReason, FocusSession } from '../v0/types.js';
import { newCorrelationId } from '../v0/clock.js';
import { EventEmitter } from './events.js';
import type { BasisConfig } from './config.js';
import type { PriorityScore, SymbolLifecycle } from './types.js';
import { projectBasisRejectDisposition } from './rejectVocabulary.js';

const FOCUS_HISTORY_KEEP = 200;

export class LifecycleManager {
  private lifecycles = new Map<string, SymbolLifecycle>();
  private candidates = new Map<string, Candidate>();
  private activeFocus = new Map<string, FocusSession>();
  private focusHistory: FocusSession[] = [];
  private pinnedSymbols = new Set<string>();

  constructor(
    private clock: Clock,
    private cfg: BasisConfig,
    private emitter: EventEmitter,
  ) {}

  // ---------- reads ----------

  get(symbol: string): SymbolLifecycle {
    let lc = this.lifecycles.get(symbol);
    if (!lc) {
      lc = {
        symbol,
        state: 'IDLE',
        correlationId: null,
        enteredStateTs: this.clock.now(),
        cooldownUntilTs: null,
        lastDecision: null,
        pinned: this.pinnedSymbols.has(symbol),
      };
      if (this.lifecycles.size < this.cfg.maxUniverseSize) this.lifecycles.set(symbol, lc);
    }
    return lc;
  }

  all(): SymbolLifecycle[] {
    return [...this.lifecycles.values()];
  }

  candidateList(): Candidate[] {
    return [...this.candidates.values()].sort((a, b) => b.score - a.score);
  }

  focusSessions(): FocusSession[] {
    return [...this.activeFocus.values(), ...this.focusHistory];
  }

  activeFocusCount(): number {
    return this.activeFocus.size;
  }

  /** Remove live state for symbols no longer present in the current universe. */
  retainSymbols(symbols: ReadonlySet<string>): void {
    for (const symbol of [...this.activeFocus.keys()]) {
      if (!symbols.has(symbol)) this.closeFocus(symbol, 'signal_expired');
    }
    for (const symbol of this.candidates.keys()) {
      if (!symbols.has(symbol)) this.candidates.delete(symbol);
    }
    for (const symbol of this.lifecycles.keys()) {
      if (!symbols.has(symbol)) this.lifecycles.delete(symbol);
    }
    for (const symbol of this.pinnedSymbols) {
      if (!symbols.has(symbol)) this.pinnedSymbols.delete(symbol);
    }
  }

  /** A config revision invalidates in-flight signal state but preserves valid pins. */
  resetSignals(): void {
    for (const symbol of [...this.activeFocus.keys()]) this.closeFocus(symbol, 'signal_expired');
    this.candidates.clear();
    this.lifecycles.clear();
  }

  inCooldown(symbol: string): boolean {
    const lc = this.lifecycles.get(symbol);
    if (!lc || lc.cooldownUntilTs === null) return false;
    return this.clock.now() < lc.cooldownUntilTs;
  }

  pin(symbol: string): void {
    if (!this.pinnedSymbols.has(symbol) && this.pinnedSymbols.size >= this.cfg.maxUniverseSize) return;
    this.pinnedSymbols.add(symbol);
    this.get(symbol).pinned = true;
  }

  unpin(symbol: string): void {
    this.pinnedSymbols.delete(symbol);
    this.get(symbol).pinned = false;
  }

  /** The correlationId for the symbol's CURRENT signal path, opening one if needed. */
  ensureCorrelation(symbol: string): string {
    const lc = this.get(symbol);
    if (!lc.correlationId) {
      lc.correlationId = newCorrelationId(this.clock, 'basis');
    }
    return lc.correlationId;
  }

  // ---------- transitions ----------

  /**
   * Fold one scanner decision into the state machine. The engine has already
   * stamped decision.correlationId with ensureCorrelation().
   */
  applyDecision(decision: Decision, priority: PriorityScore): SymbolLifecycle {
    const lc = this.get(decision.symbol);
    lc.lastDecision = decision;
    const now = this.clock.now();

    switch (decision.kind) {
      case 'ignore': {
        if (lc.state === 'FOCUS' || lc.state === 'PROPOSED') {
          this.closeFocus(decision.symbol, 'signal_expired');
        }
        this.dropCandidate(decision.symbol);
        this.toState(lc, 'IDLE', now);
        lc.correlationId = null; // signal path over
        break;
      }
      case 'watch': {
        this.openCandidate(decision, priority);
        if (lc.state === 'FOCUS' || lc.state === 'PROPOSED') {
          // signal weakened below focus grade but still alive
          this.closeFocus(decision.symbol, 'signal_expired');
        }
        this.toState(lc, 'WATCHING', now);
        break;
      }
      case 'focus': {
        this.openCandidate(decision, priority);
        if (this.tryFocus(decision, priority)) {
          this.toState(lc, 'FOCUS', now);
        } else {
          this.toState(lc, 'WATCHING', now); // capacity denied — stays a candidate
        }
        break;
      }
      case 'proposal': {
        this.openCandidate(decision, priority);
        this.tryFocus(decision, priority); // proposals hold a focus slot when available
        this.toState(lc, 'PROPOSED', now);
        break;
      }
      case 'reject': {
        const projection = projectBasisRejectDisposition(decision.rejectCode);
        const wasAdvanced = lc.state === 'FOCUS' || lc.state === 'PROPOSED';
        if (wasAdvanced) {
          this.closeFocus(decision.symbol, projection.focusExitReason);
        }
        this.dropCandidate(decision.symbol);
        this.toState(lc, 'REJECTED', now);
        if (wasAdvanced) {
          // an advanced signal died with a named reason → cool off to stop flapping
          lc.cooldownUntilTs = now + this.cfg.cooldownMs;
          this.toState(lc, 'COOLDOWN', now);
        }
        break;
      }
    }
    return lc;
  }

  /** A proposal expired (gap closed / ttl / conditions broke) → cooldown. */
  onProposalExpired(symbol: string, why: string): void {
    const lc = this.get(symbol);
    if (lc.state !== 'PROPOSED' && lc.state !== 'FOCUS') return;
    const exit: FocusExitReason = why === 'gap_closed' ? 'gap_closed' : 'signal_expired';
    this.closeFocus(symbol, exit);
    this.dropCandidate(symbol);
    lc.cooldownUntilTs = this.clock.now() + this.cfg.cooldownMs;
    this.toState(lc, 'COOLDOWN', this.clock.now());
  }

  /** Per-tick housekeeping: candidate TTL, focus max-age, cooldown expiry. */
  maintain(): void {
    const now = this.clock.now();

    for (const [symbol, cand] of this.candidates) {
      if (now - cand.openedTs > this.cfg.candidateTtlMs) {
        const lc = this.get(symbol);
        if (lc.state === 'WATCHING') {
          this.candidates.delete(symbol);
          this.emitter.emit('candidate_rejected', cand.correlationId, 'candidate expired (ttl)', {
            symbol,
            payload: { ttlMs: this.cfg.candidateTtlMs },
          });
          this.toState(lc, 'IDLE', now);
          lc.correlationId = null;
        }
      }
    }

    for (const session of [...this.activeFocus.values()]) {
      if (!session.pinned && now - session.enteredTs > this.cfg.focusMaxAgeMs) {
        this.closeFocus(session.symbol, 'max_focus_time');
        const lc = this.get(session.symbol);
        if (lc.state === 'FOCUS') this.toState(lc, 'WATCHING', now);
      }
    }

    for (const lc of this.lifecycles.values()) {
      if (lc.state === 'COOLDOWN' && lc.cooldownUntilTs !== null && now >= lc.cooldownUntilTs) {
        lc.cooldownUntilTs = null;
        lc.correlationId = null;
        this.toState(lc, 'IDLE', now);
      } else if (lc.state === 'REJECTED' && now - lc.enteredStateTs > this.cfg.tickMs * 2) {
        // a shallow reject (never focused) just returns to the pool
        lc.correlationId = null;
        this.toState(lc, 'IDLE', now);
      }
    }
  }

  // ---------- internals ----------

  private toState(lc: SymbolLifecycle, state: SymbolLifecycle['state'], now: number): void {
    if (lc.state === state) return;
    lc.state = state;
    lc.enteredStateTs = now;
  }

  private focusReasonFor(decision: Decision): FocusReason {
    const rate = decision.evidence['fundingRate'];
    if (typeof rate === 'number' && Math.abs(rate) >= this.cfg.fundingExtremeAbs) return 'funding_extreme';
    return 'basis_gap';
  }

  private openCandidate(decision: Decision, priority: PriorityScore): void {
    const existing = this.candidates.get(decision.symbol);
    if (existing) {
      existing.score = priority.score;
      return;
    }
    const cand: Candidate = {
      symbol: decision.symbol,
      openedTs: this.clock.now(),
      reason: this.focusReasonFor(decision),
      score: priority.score,
      correlationId: decision.correlationId,
    };
    this.candidates.set(decision.symbol, cand);
    this.emitter.emit('candidate_opened', decision.correlationId, `candidate: ${decision.humanReason}`, {
      symbol: decision.symbol,
      payload: { score: priority.score, reason: cand.reason },
    });
  }

  private dropCandidate(symbol: string): void {
    this.candidates.delete(symbol);
  }

  /**
   * Focus admission under caps: pinned always enters; above the soft cap only
   * scores beating the current weakest enter; the hard cap never exceeds
   * (weakest non-pinned session is evicted to make room, else denied).
   */
  private tryFocus(decision: Decision, priority: PriorityScore): boolean {
    const symbol = decision.symbol;
    if (this.activeFocus.has(symbol)) {
      const s = this.activeFocus.get(symbol)!;
      s.score = priority.score;
      return true;
    }
    const pinned = this.pinnedSymbols.has(symbol);
    const size = this.activeFocus.size;

    if (!pinned && size >= this.cfg.focusSoftCap) {
      const weakest = this.weakestUnpinned();
      const stronger = weakest !== null && priority.score > weakest.score;
      if (size >= this.cfg.focusHardCap) {
        // hard cap never exceeded: evict the weakest for a stronger signal, else deny
        if (!stronger) return false;
        this.evictForCapacity(weakest!);
      } else if (!stronger) {
        // between soft and hard cap only clearly stronger signals grow the pool
        return false;
      }
    } else if (pinned && size >= this.cfg.focusHardCap) {
      const weakest = this.weakestUnpinned();
      if (weakest) this.evictForCapacity(weakest);
      else return false; // everything pinned — cannot exceed the hard cap
    }

    const session: FocusSession = {
      symbol,
      enteredTs: this.clock.now(),
      reason: this.focusReasonFor(decision),
      score: priority.score,
      pinned,
      exitedTs: null,
      exitReason: null,
      correlationId: decision.correlationId,
    };
    this.activeFocus.set(symbol, session);
    this.emitter.emit('focus_opened', decision.correlationId, `focus: ${decision.humanReason}`, {
      symbol,
      payload: { score: priority.score, reason: session.reason, pinned },
    });
    return true;
  }

  private evictForCapacity(session: FocusSession): void {
    this.closeFocus(session.symbol, 'capacity_evicted');
    const lc = this.get(session.symbol);
    if (lc.state === 'FOCUS') this.toState(lc, 'WATCHING', this.clock.now());
  }

  private weakestUnpinned(): FocusSession | null {
    let weakest: FocusSession | null = null;
    for (const s of this.activeFocus.values()) {
      if (s.pinned) continue;
      if (!weakest || s.score < weakest.score) weakest = s;
    }
    return weakest;
  }

  private closeFocus(symbol: string, exitReason: FocusExitReason): void {
    const session = this.activeFocus.get(symbol);
    if (!session) return;
    session.exitedTs = this.clock.now();
    session.exitReason = exitReason;
    this.activeFocus.delete(symbol);
    this.focusHistory.push(session);
    if (this.focusHistory.length > FOCUS_HISTORY_KEEP) {
      this.focusHistory.splice(0, this.focusHistory.length - FOCUS_HISTORY_KEEP);
    }
    this.emitter.emit('focus_closed', session.correlationId, `focus closed (${exitReason})`, {
      symbol,
      payload: { exitReason, heldMs: session.exitedTs - session.enteredTs },
    });
  }
}
