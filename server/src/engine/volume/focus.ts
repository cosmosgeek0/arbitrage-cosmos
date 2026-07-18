/**
 * Focus manager — ENGINE.md §10. Focus is scarce; this enforces it:
 * candidates (WATCHING) → focus (FOCUS) with soft cap 10 / hard cap 25,
 * priority replacement, pinned & open-position symbols never evicted,
 * TTL/expiry, cooldown after rejection. Every transition is ledgered.
 *
 * Capacity semantics: normal signals get slots freely up to the soft cap;
 * beyond it a newcomer must OUT-RANK the weakest evictable member (priority
 * replacement). The soft→hard band is reserve space for pinned/open-position
 * symbols, which are admitted unconditionally up to the hard cap.
 */
import type {
  Candidate,
  Clock,
  Decision,
  EventSink,
  FocusExitReason,
  FocusReason,
  FocusSession,
  SymbolState,
} from '../v0/types.js';
import type { VolumeConfig } from './config.js';
import { makeEvent } from './events.js';
import { projectVolumeRejectDisposition } from './rejectVocabulary.js';
import type { ObservedOrderFocusApplyStatus } from './observedOrderFocus.js';
import { MAX_ENGINE_SYMBOLS, isCanonicalSymbol } from './validation.js';

interface FocusEntry extends FocusSession {
  lastSignalTs: number;
}

interface ObservedOrderCut {
  observedAtMs: number;
  validUntilMs: number;
  fingerprint: string;
  expired: boolean;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface ObservedOrderCutResult {
  readonly status: Extract<
    ObservedOrderFocusApplyStatus,
    'APPLIED' | 'IDEMPOTENT' | 'REJECTED_NON_MONOTONIC' | 'REJECTED_CONFLICT'
  >;
  readonly addedSymbols: readonly string[];
  readonly removedSymbols: readonly string[];
}

export class FocusManager {
  private candidates = new Map<string, Candidate>();
  private focus = new Map<string, FocusEntry>();
  private cooldownUntil = new Map<string, number>();
  private pinnedSet = new Set<string>();
  private openPositions = new Set<string>();
  private observedOpenOrders = new Set<string>();
  private lastObservedOrderCut: ObservedOrderCut | null = null;
  private closedSessions: FocusSession[] = [];
  private proposedSet = new Set<string>();

  constructor(
    private cfg: VolumeConfig,
    private clock: Clock,
    private sink: EventSink,
  ) {}

  private candidateCap(): number {
    return Math.max(100, Math.min(1_000, this.cfg.focusHardCap * 20));
  }

  // ---- external flags ----
  pin(symbol: string, pinned = true): void {
    if (!isCanonicalSymbol(symbol)) return;
    if (pinned) {
      if (!this.pinnedSet.has(symbol) && this.pinnedSet.size >= MAX_ENGINE_SYMBOLS) return;
      this.pinnedSet.add(symbol);
    }
    else this.pinnedSet.delete(symbol);
    const f = this.focus.get(symbol);
    if (f) f.pinned = this.isProtected(symbol);
  }

  markOpenPosition(symbol: string, open: boolean): void {
    if (!isCanonicalSymbol(symbol)) return;
    if (open) {
      if (!this.openPositions.has(symbol) && this.openPositions.size >= MAX_ENGINE_SYMBOLS) return;
      this.openPositions.add(symbol);
    }
    else this.openPositions.delete(symbol);
    const f = this.focus.get(symbol);
    if (f) f.pinned = this.isProtected(symbol);
  }

  /** Apply one already-validated, complete owner cut. */
  applyObservedOpenOrderCut(
    symbols: readonly string[],
    observedAtMs: number,
    validUntilMs: number,
    fingerprint: string,
  ): Readonly<ObservedOrderCutResult> {
    const prior = this.lastObservedOrderCut;
    if (prior !== null && observedAtMs < prior.observedAtMs) {
      return Object.freeze({
        status: 'REJECTED_NON_MONOTONIC',
        addedSymbols: Object.freeze([]),
        removedSymbols: Object.freeze([]),
      });
    }
    if (prior !== null && observedAtMs === prior.observedAtMs) {
      return Object.freeze({
        status: fingerprint === prior.fingerprint ? 'IDEMPOTENT' : 'REJECTED_CONFLICT',
        addedSymbols: Object.freeze([]),
        removedSymbols: Object.freeze([]),
      });
    }

    return this.installObservedOpenOrderCut(symbols, observedAtMs, validUntilMs, fingerprint);
  }

  /**
   * Restore canonical Ledger truth. A same-time divergent in-memory fragment
   * is overwritten by the durable checkpoint; a genuinely newer memory cut
   * still rejects rollback.
   */
  restoreObservedOpenOrderCut(
    symbols: readonly string[],
    observedAtMs: number,
    validUntilMs: number,
    fingerprint: string,
  ): Readonly<ObservedOrderCutResult> {
    const prior = this.lastObservedOrderCut;
    if (prior !== null && observedAtMs < prior.observedAtMs) {
      return Object.freeze({
        status: 'REJECTED_NON_MONOTONIC',
        addedSymbols: Object.freeze([]),
        removedSymbols: Object.freeze([]),
      });
    }
    if (prior !== null && observedAtMs === prior.observedAtMs && fingerprint === prior.fingerprint) {
      return Object.freeze({
        status: 'IDEMPOTENT',
        addedSymbols: Object.freeze([]),
        removedSymbols: Object.freeze([]),
      });
    }
    return this.installObservedOpenOrderCut(symbols, observedAtMs, validUntilMs, fingerprint);
  }

  private installObservedOpenOrderCut(
    symbols: readonly string[],
    observedAtMs: number,
    validUntilMs: number,
    fingerprint: string,
  ): Readonly<ObservedOrderCutResult> {
    const next = new Set(symbols);
    const added = symbols.filter((symbol) => !this.observedOpenOrders.has(symbol));
    const removed = [...this.observedOpenOrders]
      .filter((symbol) => !next.has(symbol))
      .sort(compareText);
    this.observedOpenOrders = next;
    this.lastObservedOrderCut = { observedAtMs, validUntilMs, fingerprint, expired: false };
    for (const symbol of [...added, ...removed]) {
      const focus = this.focus.get(symbol);
      if (focus) focus.pinned = this.isProtected(symbol);
    }
    return Object.freeze({
      status: 'APPLIED',
      addedSymbols: Object.freeze([...added]),
      removedSymbols: Object.freeze(removed),
    });
  }

  /** Unknown truth never clears a still-current cut; time expiry does. */
  expireObservedOpenOrderProtection(now: number): boolean {
    if (this.lastObservedOrderCut === null || now <= this.lastObservedOrderCut.validUntilMs) return false;
    if (!this.lastObservedOrderCut.expired) {
      const prior = [...this.observedOpenOrders];
      this.observedOpenOrders.clear();
      this.lastObservedOrderCut.expired = true;
      for (const symbol of prior) {
        const focus = this.focus.get(symbol);
        if (focus) focus.pinned = this.isProtected(symbol);
      }
    }
    return true;
  }

  observedOpenOrderSymbols(): readonly string[] {
    return Object.freeze([...this.observedOpenOrders].sort(compareText));
  }

  observedOrderCut(): Readonly<{ observedAtMs: number; validUntilMs: number }> | null {
    return this.lastObservedOrderCut === null
      ? null
      : Object.freeze({
          observedAtMs: this.lastObservedOrderCut.observedAtMs,
          validUntilMs: this.lastObservedOrderCut.validUntilMs,
        });
  }

  private isProtected(symbol: string): boolean {
    return this.pinnedSet.has(symbol)
      || this.openPositions.has(symbol)
      || this.observedOpenOrders.has(symbol);
  }

  // ---- queries ----
  stateOf(symbol: string): SymbolState {
    const now = this.clock.now();
    if (this.openPositions.has(symbol)) return 'ACTIVE';
    if (this.focus.has(symbol)) return this.proposedSet.has(symbol) ? 'PROPOSED' : 'FOCUS';
    if ((this.cooldownUntil.get(symbol) ?? 0) > now) return 'COOLDOWN';
    if (this.candidates.has(symbol)) return 'WATCHING';
    return 'IDLE';
  }

  inCooldown(symbol: string): boolean {
    return (this.cooldownUntil.get(symbol) ?? 0) > this.clock.now();
  }

  isFocused(symbol: string): boolean {
    return this.focus.has(symbol);
  }

  focusAgeMs(symbol: string): number {
    const f = this.focus.get(symbol);
    return f ? this.clock.now() - f.enteredTs : 0;
  }

  candidateList(): Candidate[] {
    return [...this.candidates.values()].sort((a, b) => b.score - a.score);
  }

  focusSessions(): FocusSession[] {
    return [...this.focus.values()].sort((a, b) =>
      b.score - a.score
      || a.enteredTs - b.enteredTs
      || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0)
    );
  }

  closedFocusSessions(limit = 100): FocusSession[] {
    const safeLimit = Number.isSafeInteger(limit) ? Math.max(0, Math.min(limit, 500)) : 100;
    if (safeLimit === 0) return [];
    return this.closedSessions.slice(-safeLimit);
  }

  markProposed(symbol: string): void {
    if (this.focus.has(symbol)) this.proposedSet.add(symbol);
  }

  // ---- decision-driven transitions ----
  noteDecision(d: Decision, priority: number): void {
    const now = this.clock.now();
    const symbol = d.symbol;
    priority = Number.isFinite(priority) ? priority : 0;
    if (this.inCooldown(symbol) && !this.isProtected(symbol)) return;

    switch (d.kind) {
      case 'watch': {
        if (this.focus.has(symbol)) {
          this.touch(symbol, priority, now);
          return;
        }
        const existing = this.candidates.get(symbol);
        if (existing) {
          existing.score = priority;
          return;
        }
        if (this.candidates.size >= this.candidateCap()) {
          let weakest: Candidate | null = null;
          for (const candidate of this.candidates.values()) {
            if (!weakest || candidate.score < weakest.score || (
              candidate.score === weakest.score && candidate.openedTs < weakest.openedTs
            )) weakest = candidate;
          }
          if (weakest && weakest.score >= priority) return;
          if (weakest) {
            this.candidates.delete(weakest.symbol);
            this.sink.emit(
              makeEvent('candidate_rejected', now, weakest.correlationId, 'candidate evicted by bounded queue', {
                symbol: weakest.symbol,
                payload: { candidateCap: this.candidateCap() },
              }),
            );
          }
        }
        const cand: Candidate = {
          symbol,
          openedTs: now,
          reason: 'volume_activation',
          score: priority,
          correlationId: d.correlationId,
        };
        this.candidates.set(symbol, cand);
        this.sink.emit(
          makeEvent('candidate_opened', now, d.correlationId, `candidate: ${d.humanReason}`, {
            symbol,
            payload: { score: priority },
          }),
        );
        return;
      }
      case 'focus':
      case 'proposal': {
        this.promote(symbol, 'volume_activation', priority, d.correlationId, now);
        return;
      }
      case 'reject': {
        const projection = projectVolumeRejectDisposition(d.rejectCode);
        if (projection.successorOutcome === 'ignore') {
          this.applyIgnore(symbol, now);
          return;
        }
        // kill switch blocks EXECUTION, not observation: the signal is real,
        // keep watching it, no cooldown, no focus teardown
        if (d.rejectCode === 'kill_switch_on') {
          this.touch(symbol, priority, now);
          return;
        }
        // A configuration policy can change at runtime. Do not strand a
        // newly-allowed symbol in a ten-minute cooldown merely because it was
        // blocked on the previous tick.
        if (d.rejectCode === 'symbol_blocked') {
          if (this.focus.has(symbol)) this.close(symbol, 'risk_rejected', now);
          this.candidates.delete(symbol);
          this.cooldownUntil.delete(symbol);
          return;
        }
        // fake/blocked signal: close focus if held, cool the symbol down
        if (this.focus.has(symbol)) {
          this.close(symbol, projection.focusExitReason, now);
        }
        if (this.candidates.delete(symbol)) {
          this.sink.emit(
            makeEvent('candidate_rejected', now, d.correlationId, d.humanReason, {
              symbol,
              rejectCode: d.rejectCode,
            }),
          );
        }
        if (!this.isProtected(symbol)) this.cooldownUntil.set(symbol, now + this.cfg.cooldownMs);
        return;
      }
      case 'ignore': {
        this.applyIgnore(symbol, now);
        return;
      }
    }
  }

  private applyIgnore(symbol: string, now: number): void {
    if (this.focus.has(symbol) && !this.isProtected(symbol)) {
      this.close(symbol, 'volume_normalized', now);
      this.cooldownUntil.set(symbol, now + this.cfg.cooldownMs);
    }
  }

  /** Remove focus/candidate/cooldown state for symbols no longer configured. */
  reconcileSymbols(symbols: ReadonlySet<string>): void {
    const now = this.clock.now();
    for (const symbol of this.focus.keys()) {
      if (!symbols.has(symbol)) this.close(symbol, 'signal_expired', now);
    }
    for (const symbol of this.candidates.keys()) {
      if (!symbols.has(symbol)) this.candidates.delete(symbol);
    }
    for (const symbol of this.cooldownUntil.keys()) {
      if (!symbols.has(symbol)) this.cooldownUntil.delete(symbol);
    }
    for (const symbol of this.pinnedSet) {
      if (!symbols.has(symbol)) this.pinnedSet.delete(symbol);
    }
    for (const symbol of this.openPositions) {
      if (!symbols.has(symbol)) this.openPositions.delete(symbol);
    }
    for (const symbol of this.proposedSet) {
      if (!symbols.has(symbol)) this.proposedSet.delete(symbol);
    }
  }

  /** Admission with soft/hard caps and priority replacement. */
  promote(symbol: string, reason: FocusReason, score: number, correlationId: string, now: number): boolean {
    if (this.focus.has(symbol)) {
      this.touch(symbol, score, now);
      return true;
    }
    const isProtected = this.isProtected(symbol);
    const cap = isProtected ? this.cfg.focusHardCap : this.cfg.focusSoftCap;

    if (this.focus.size >= cap) {
      // find the weakest evictable (non-protected) member
      let weakest: FocusEntry | null = null;
      for (const f of this.focus.values()) {
        if (f.pinned) continue;
        if (!weakest || f.score < weakest.score) weakest = f;
      }
      const canReplace = weakest !== null && (isProtected || score > weakest.score);
      if (!canReplace) {
        if (this.focus.size >= this.cfg.focusHardCap || !isProtected) {
          this.sink.emit(
            makeEvent('candidate_rejected', now, correlationId, 'focus at capacity, priority too low', {
              symbol,
              payload: { score, focusSize: this.focus.size },
            }),
          );
          return false;
        }
      } else {
        this.close(weakest!.symbol, 'capacity_evicted', now);
      }
    }

    this.candidates.delete(symbol);
    const entry: FocusEntry = {
      symbol,
      enteredTs: now,
      reason: isProtected
        ? this.openPositions.has(symbol)
          ? 'open_position'
          : this.observedOpenOrders.has(symbol)
            ? 'open_order'
            : 'user_pin'
        : reason,
      score,
      pinned: isProtected,
      exitedTs: null,
      exitReason: null,
      correlationId,
      lastSignalTs: now,
    };
    this.focus.set(symbol, entry);
    this.sink.emit(
      makeEvent('focus_opened', now, correlationId, `focus opened (${entry.reason})`, {
        symbol,
        payload: { score, focusSize: this.focus.size },
      }),
    );
    return true;
  }

  private touch(symbol: string, score: number, now: number): void {
    const f = this.focus.get(symbol);
    if (!f) return;
    f.score = score;
    f.lastSignalTs = now;
  }

  private close(symbol: string, reason: FocusExitReason, now: number): void {
    const f = this.focus.get(symbol);
    if (!f) return;
    f.exitedTs = now;
    f.exitReason = reason;
    this.focus.delete(symbol);
    this.proposedSet.delete(symbol);
    this.closedSessions.push(f);
    if (this.closedSessions.length > 500) this.closedSessions.splice(0, this.closedSessions.length - 500);
    this.sink.emit(
      makeEvent('focus_closed', now, f.correlationId, `focus closed (${reason})`, {
        symbol,
        payload: { reason, heldMs: now - f.enteredTs },
      }),
    );
  }

  /** Periodic housekeeping: candidate TTL, focus max age. */
  tick(): void {
    const now = this.clock.now();
    this.expireObservedOpenOrderProtection(now);
    for (const [symbol, c] of this.candidates) {
      if (now - c.openedTs > this.cfg.candidateTtlMs) {
        this.candidates.delete(symbol);
        this.sink.emit(
          makeEvent('candidate_rejected', now, c.correlationId, 'candidate expired (TTL)', {
            symbol,
            payload: { ttlMs: this.cfg.candidateTtlMs },
          }),
        );
      }
    }
    for (const [symbol, f] of this.focus) {
      if (f.pinned) continue;
      if (now - f.enteredTs > this.cfg.focusMaxAgeMs) {
        this.close(symbol, 'max_focus_time', now);
        this.cooldownUntil.set(symbol, now + this.cfg.cooldownMs);
      }
    }
    for (const [symbol, until] of this.cooldownUntil) {
      if (until <= now) this.cooldownUntil.delete(symbol);
    }
  }
}
