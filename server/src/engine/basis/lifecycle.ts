/**
 * Basis engine — symbol lifecycle + focus manager (ENGINE.md §5, §10).
 * Owns the per-symbol state machine (IDLE → WATCHING → FOCUS → PROPOSED →
 * REJECTED/COOLDOWN), the scarce-focus discipline (soft/hard caps, pinning,
 * score-based eviction), candidate TTLs and cooldowns. Every transition is
 * ledgered — transitions nobody can explain are forbidden.
 *
 * It also owns the post-acceptance handoff lifecycle (BasisHandoffLifecycle,
 * bottom of this file): one already-accepted proposal, bound verbatim, advanced
 * only by matching terminal or cancel-confirmed feedback. Default OFF.
 */
import type { Candidate, Clock, Decision, FocusExitReason, FocusReason, FocusSession } from '../v0/types.js';
import { newCorrelationId } from '../v0/clock.js';
import {
  normalizeNonNegativeExactDecimal,
  type NonNegativeDecimal,
} from '../../capitalFoundation/contracts/decimal.js';
import { EventEmitter } from './events.js';
import type { BasisConfig } from './config.js';
import type {
  BasisAcceptanceConsumeRefusal,
  BasisAcceptanceConsumerPort,
  BasisProposalAcceptance,
} from './proposals.js';
import type { BasisDirection, PriorityScore, SymbolLifecycle } from './types.js';
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

  /** Current owner truth; a caller need not run tick() before reading it. */
  activeCooldownCount(): number {
    const now = this.clock.now();
    let count = 0;
    for (const lifecycle of this.lifecycles.values()) {
      if (lifecycle.state === 'COOLDOWN'
          && lifecycle.cooldownUntilTs !== null
          && lifecycle.cooldownUntilTs > now) count += 1;
    }
    return count;
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

// ---------------------------------------------------------------------------
// Accepted-proposal handoff lifecycle (M1-P1) — DEFAULT OFF
// ---------------------------------------------------------------------------

/**
 * The two states of one handoff. There is exactly ONE progress transition in
 * this module: AWAITING_FEEDBACK → TERMINAL. Everything else is an observation.
 */
export type BasisHandoffState = 'AWAITING_FEEDBACK' | 'TERMINAL';

export type BasisHandoffTerminalKind = 'TERMINAL_REPORTED' | 'CANCEL_CONFIRMED';

export type BasisHandoffOutcome =
  | 'WORKING'
  | 'AMBIGUOUS'
  | 'CANCEL_REQUESTED'
  | 'CANCEL_CONFIRMED'
  | 'TERMINAL';

/**
 * Exact identity every feedback must restate; anything else is not this
 * handoff. `acceptedRevisionTs` is part of that identity: feedback about a
 * different accepted revision is not feedback about this handoff.
 */
export interface BasisHandoffFeedbackIdentity {
  handoffId: string;
  proposalId: string;
  correlationId: string;
  symbol: string;
  direction: BasisDirection;
  acceptedRevisionTs: number;
  /** Producer-owned ordering: lower is stale, equal is a duplicate. */
  sequence: number;
  observedAtMs: number;
}

/**
 * Terminal feedback carries the ONLY fill fact this module records:
 * `cumulativeFilledQuantity`, a canonical non-negative exact-decimal string in
 * base units (the repository decimal contract, never IEEE-754, never USD). It
 * is always the running total, never an increment, so this module records the
 * string verbatim and never sums, scales, or price-converts it.
 */
export interface BasisTerminalFeedback extends BasisHandoffFeedbackIdentity {
  cumulativeFilledQuantity: string;
}

/**
 * Nonterminal, unknown, and unconfirmed-cancel feedback carry NO quantity field
 * at all: an unsettled quantity stays unknown rather than becoming a fabricated
 * zero or a provisional fill.
 */
export type BasisHandoffFeedback =
  | (BasisHandoffFeedbackIdentity & { outcome: 'WORKING' })
  | (BasisHandoffFeedbackIdentity & { outcome: 'AMBIGUOUS' })
  | (BasisHandoffFeedbackIdentity & { outcome: 'CANCEL_REQUESTED' })
  | (BasisTerminalFeedback & { outcome: 'CANCEL_CONFIRMED' })
  | (BasisTerminalFeedback & { outcome: 'TERMINAL' });

export type BasisHandoffRefusal =
  | 'DISABLED'
  | 'ALREADY_BOUND'
  | BasisAcceptanceConsumeRefusal
  | 'NO_ACTIVE_HANDOFF'
  | 'FEEDBACK_MALFORMED'
  | 'WRONG_IDENTITY'
  | 'REVISION_MISMATCH'
  | 'ALREADY_TERMINAL'
  | 'STALE_SEQUENCE'
  | 'DUPLICATE_SEQUENCE'
  | 'STALE_OBSERVATION'
  | 'QUANTITY_NOT_EXACT';

/**
 * Immutable view of one handoff: the frozen acceptance facts plus the single
 * terminal fact. It states what was accepted and what terminally filled — and
 * NOTHING about flatness, residual exposure, unwind, or recovery. A
 * cancel-confirmed terminal with a nonzero quantity is a first-leg terminal
 * fact; what that exposure means and what happens next is Foundation's, not
 * this record's.
 */
export interface BasisHandoffRecord {
  readonly handoffId: string;
  readonly proposalId: string;
  readonly correlationId: string;
  readonly symbol: string;
  readonly direction: BasisDirection;
  readonly acceptedBy: string;
  readonly acceptedTs: number;
  readonly acceptedRevisionTs: number;
  readonly acceptedNetEdgePct: number;
  /**
   * The USD notional the acceptance was recorded against. It is an acceptance
   * FACT only: it is never compared with `cumulativeFilledQuantity`, which is a
   * base quantity in a different unit. Converting between them needs a price
   * and belongs to whoever owns that price — never to this module.
   */
  readonly acceptedNotionalUsd: number;
  readonly boundTs: number;
  readonly state: BasisHandoffState;
  readonly terminalKind: BasisHandoffTerminalKind | null;
  readonly terminalTs: number | null;
  /**
   * Canonical non-negative exact cumulative filled base quantity, recorded once
   * at the terminal transition. `null` while unsettled — never a placeholder.
   */
  readonly cumulativeFilledQuantity: NonNegativeDecimal | null;
  readonly lastSequence: number | null;
  readonly lastObservedAtMs: number | null;
  readonly ambiguousObservations: number;
}

export interface BasisHandoffSnapshot {
  readonly enabled: boolean;
  readonly handoff: BasisHandoffRecord | null;
}

export type BasisHandoffResult =
  | { ok: true; progressed: boolean; handoff: BasisHandoffRecord }
  | { ok: false; refusal: BasisHandoffRefusal };

/** Internal mutable twin of BasisHandoffRecord; never handed to a caller. */
interface MutableHandoff {
  handoffId: string;
  proposalId: string;
  correlationId: string;
  symbol: string;
  direction: BasisDirection;
  acceptedBy: string;
  acceptedTs: number;
  acceptedRevisionTs: number;
  acceptedNetEdgePct: number;
  acceptedNotionalUsd: number;
  boundTs: number;
  state: BasisHandoffState;
  terminalKind: BasisHandoffTerminalKind | null;
  terminalTs: number | null;
  cumulativeFilledQuantity: NonNegativeDecimal | null;
  lastSequence: number | null;
  lastObservedAtMs: number | null;
  ambiguousObservations: number;
}

/** The only two progress facts. Everything else is an observation. */
const TERMINAL_OUTCOMES: readonly BasisHandoffOutcome[] = ['TERMINAL', 'CANCEL_CONFIRMED'];
const NONTERMINAL_OUTCOMES: readonly BasisHandoffOutcome[] = ['WORKING', 'AMBIGUOUS', 'CANCEL_REQUESTED'];
const KNOWN_OUTCOMES: ReadonlySet<string> = new Set<string>([...TERMINAL_OUTCOMES, ...NONTERMINAL_OUTCOMES]);

function refuse(refusal: BasisHandoffRefusal): BasisHandoffResult {
  return { ok: false, refusal };
}

/**
 * Handoff lifecycle for ONE already-accepted Basis proposal.
 *
 * What it does: claims exactly one accepted proposal from the store, binds that
 * proposal's existing identity and its frozen acceptance facts, and folds
 * feedback about it. Progress happens only on matching TERMINAL or matching
 * CANCEL_CONFIRMED feedback carrying a canonical exact cumulative filled
 * quantity; those two are the only progress facts that exist here.
 *
 * What it must never do: select a symbol, create or refresh a proposal, size or
 * authorise anything, reserve capital, order or sequence legs, plan, retry,
 * hedge, unwind, execute, persist, or claim a book is flat or recovered — and
 * never convert between a base quantity and a USD notional. Foundation owns
 * every one of those; this module is the pure boundary record between an
 * owner's acceptance and that owner-gated machinery.
 *
 * Default OFF: constructed disabled, every intake and feedback call refuses
 * with DISABLED until a later owner-gated phase constructs it enabled. It is
 * also single-use — one instance binds at most one handoff, ever — so a
 * terminal record can never be reopened or overwritten.
 */
export class BasisHandoffLifecycle {
  private handoff: MutableHandoff | null = null;
  private readonly enabledValue: boolean;

  constructor(
    private clock: Clock,
    private acceptances: BasisAcceptanceConsumerPort,
    options: { enabled?: boolean } = {},
  ) {
    this.enabledValue = options.enabled === true;
  }

  enabled(): boolean {
    return this.enabledValue;
  }

  snapshot(): BasisHandoffSnapshot {
    return Object.freeze({
      enabled: this.enabledValue,
      handoff: this.handoff === null ? null : this.freeze(this.handoff),
    });
  }

  /**
   * Claim exactly one already-accepted proposal, named by id. Atomic: either
   * the claim succeeds and the handoff is bound, or nothing at all changes —
   * the disabled and already-bound refusals both return before the store is
   * touched, so no acceptance is ever burned without producing a handoff.
   */
  consumeAccepted(proposalId: string): BasisHandoffResult {
    if (!this.enabledValue) return refuse('DISABLED');
    if (this.handoff !== null) return refuse('ALREADY_BOUND');
    if (typeof proposalId !== 'string' || proposalId.length === 0) return refuse('NOT_ACCEPTED');

    // Read the injected clock before the destructive single-shot claim. If the
    // clock fails, the acceptance remains available and no partial handoff exists.
    const boundTs = this.clock.now();
    if (!Number.isSafeInteger(boundTs) || boundTs < 0) {
      throw new RangeError('handoff clock must return a non-negative safe-integer timestamp');
    }
    const claim = this.acceptances.consumeAcceptance(proposalId, boundTs);
    if (!claim.ok) return refuse(claim.refusal);

    this.handoff = this.bind(claim.acceptance, boundTs);
    return { ok: true, progressed: false, handoff: this.freeze(this.handoff) };
  }

  /**
   * Fold one feedback observation. Only matching terminal or matching
   * cancel-confirmed feedback carrying a canonical exact cumulative quantity
   * progresses the handoff; nonterminal, ambiguous, unconfirmed-cancel, stale,
   * duplicate, stale-revision, inexact, and wrong-identity input never does.
   */
  applyFeedback(feedback: BasisHandoffFeedback): BasisHandoffResult {
    if (!this.enabledValue) return refuse('DISABLED');
    const handoff = this.handoff;
    if (handoff === null) return refuse('NO_ACTIVE_HANDOFF');
    if (!this.wellFormed(feedback)) return refuse('FEEDBACK_MALFORMED');
    if (!this.identityMatches(handoff, feedback)) return refuse('WRONG_IDENTITY');
    // feedback about another accepted revision is never feedback about this one
    if (feedback.acceptedRevisionTs !== handoff.acceptedRevisionTs) return refuse('REVISION_MISMATCH');
    // a terminal handoff is immutable: late truth changes nothing here
    if (handoff.state === 'TERMINAL') return refuse('ALREADY_TERMINAL');

    if (handoff.lastSequence !== null) {
      if (feedback.sequence < handoff.lastSequence) return refuse('STALE_SEQUENCE');
      if (feedback.sequence === handoff.lastSequence) return refuse('DUPLICATE_SEQUENCE');
    }
    if (feedback.observedAtMs < handoff.boundTs) return refuse('STALE_OBSERVATION');
    if (handoff.lastObservedAtMs !== null && feedback.observedAtMs < handoff.lastObservedAtMs) {
      return refuse('STALE_OBSERVATION');
    }

    if (feedback.outcome === 'WORKING' || feedback.outcome === 'AMBIGUOUS' || feedback.outcome === 'CANCEL_REQUESTED') {
      // no terminal fact: ordering advances; fill truth and lifecycle progress
      // do not move, because nothing here has settled
      handoff.lastSequence = feedback.sequence;
      handoff.lastObservedAtMs = feedback.observedAtMs;
      if (feedback.outcome === 'AMBIGUOUS') handoff.ambiguousObservations += 1;
      return { ok: true, progressed: false, handoff: this.freeze(handoff) };
    }

    const quantity = this.canonicalQuantity(feedback.cumulativeFilledQuantity);
    if (quantity === null) return refuse('QUANTITY_NOT_EXACT');

    // Capture and validate the local transition time before mutating the record.
    // A failing or regressing clock must leave the handoff wholly awaiting.
    const terminalTs = this.clock.now();
    if (!Number.isSafeInteger(terminalTs) || terminalTs < handoff.boundTs) {
      throw new RangeError('handoff clock must not regress at terminal transition');
    }

    handoff.lastSequence = feedback.sequence;
    handoff.lastObservedAtMs = feedback.observedAtMs;
    // recorded exactly once, at the single terminal transition, verbatim
    handoff.cumulativeFilledQuantity = quantity;
    handoff.state = 'TERMINAL';
    // a nonzero CANCEL_CONFIRMED is a first-leg terminal fact, not a flat book
    handoff.terminalKind = feedback.outcome === 'CANCEL_CONFIRMED' ? 'CANCEL_CONFIRMED' : 'TERMINAL_REPORTED';
    handoff.terminalTs = terminalTs;
    return { ok: true, progressed: true, handoff: this.freeze(handoff) };
  }

  // ---------- internals ----------

  /**
   * Bind the acceptance verbatim. The handoff id is derived from the proposal
   * id — single-shot consumption already guarantees it is unique — so nothing
   * random or wall-clocked enters this module.
   */
  private bind(acceptance: BasisProposalAcceptance, boundTs: number): MutableHandoff {
    return {
      handoffId: `bh_${acceptance.proposalId}`,
      proposalId: acceptance.proposalId,
      correlationId: acceptance.correlationId,
      symbol: acceptance.symbol,
      direction: acceptance.direction,
      acceptedBy: acceptance.acceptedBy,
      acceptedTs: acceptance.acceptedTs,
      acceptedRevisionTs: acceptance.acceptedRevisionTs,
      acceptedNetEdgePct: acceptance.acceptedNetEdgePct,
      acceptedNotionalUsd: acceptance.acceptedNotionalUsd,
      boundTs,
      state: 'AWAITING_FEEDBACK',
      terminalKind: null,
      terminalTs: null,
      cumulativeFilledQuantity: null,
      lastSequence: null,
      lastObservedAtMs: null,
      ambiguousObservations: 0,
    };
  }

  /** Structural guard for untyped callers; a bad shape is never an observation. */
  private wellFormed(feedback: unknown): boolean {
    if (typeof feedback !== 'object' || feedback === null) return false;
    const shape = feedback as {
      outcome?: unknown;
      sequence?: unknown;
      observedAtMs?: unknown;
      acceptedRevisionTs?: unknown;
    };
    if (typeof shape.outcome !== 'string' || !KNOWN_OUTCOMES.has(shape.outcome)) return false;
    if (!Number.isSafeInteger(shape.sequence) || (shape.sequence as number) < 0) return false;
    if (!Number.isSafeInteger(shape.observedAtMs) || (shape.observedAtMs as number) < 0) return false;
    if (!Number.isSafeInteger(shape.acceptedRevisionTs) || (shape.acceptedRevisionTs as number) < 0) return false;
    return true;
  }

  /**
   * Canonical non-negative exact decimal, or null. The repository decimal
   * contract owns the grammar; requiring input === canonical additionally
   * refuses padded, re-scaled, or exponent forms rather than silently
   * rewriting what a producer claimed.
   */
  private canonicalQuantity(value: string): NonNegativeDecimal | null {
    try {
      const canonical = normalizeNonNegativeExactDecimal(value);
      return canonical === value ? canonical : null;
    } catch {
      return null;
    }
  }

  private identityMatches(handoff: MutableHandoff, feedback: BasisHandoffFeedback): boolean {
    return (
      feedback.handoffId === handoff.handoffId &&
      feedback.proposalId === handoff.proposalId &&
      feedback.correlationId === handoff.correlationId &&
      feedback.symbol === handoff.symbol &&
      feedback.direction === handoff.direction
    );
  }

  /** All fields are primitives, so a frozen shallow copy is a true snapshot. */
  private freeze(handoff: MutableHandoff): BasisHandoffRecord {
    return Object.freeze({ ...handoff });
  }
}
