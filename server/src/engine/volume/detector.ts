/**
 * Wakeup detector — the volume_spike Scanner (frozen contract). A staged,
 * pure decision ladder:
 *
 *   gates → activation → confirmation → HARD environment checks →
 *   SOFT tape checks (with verification grace) → focus dwell → proposal.
 *
 * HARD checks (stale book, wide spread, thin/vanished depth, already-extended
 * move, wash tape) reject instantly — more data will not fix them. SOFT
 * checks (one-print, trade count, taker conviction, follow-through) can look
 * bad simply because the signal is seconds old, so within
 * `verificationGraceMs` of the trigger they yield `watch` instead of a
 * premature reject; past the grace they reject with their named code.
 * Every exit carries decisive numbers in evidence. Nothing here buys.
 */
import type { Decision, FeatureSnapshot, RejectCode, ScanContext, Scanner } from '../v0/types.js';
import { newCorrelationId } from '../v0/clock.js';
import type { VolumeDetailCode, WakeupSnapshot } from './types.js';
import { DETAIL_TO_V0 } from './types.js';
import type { VolumeConfig } from './config.js';

/** Structural extension — still assignable to the frozen ScanContext. */
export interface VolumeScanContext extends ScanContext {
  correlationId?: string;
}

function isWakeup(f: FeatureSnapshot): f is WakeupSnapshot {
  return 'baseline' in f && 'signalAgeMs' in f;
}

export class WakeupDetector implements Scanner {
  readonly strategy = 'volume_spike' as const;

  constructor(private cfg: VolumeConfig) {}

  evaluate(f: FeatureSnapshot, ctx: VolumeScanContext): Decision {
    const cid = ctx.correlationId ?? newCorrelationId({ now: () => ctx.nowTs }, 'vw');
    const base = {
      symbol: f.symbol,
      ts: ctx.nowTs,
      strategy: this.strategy,
      correlationId: cid,
    };
    const mk = (
      kind: Decision['kind'],
      rejectCode: RejectCode | null,
      humanReason: string,
      evidence: Decision['evidence'],
      detailCode?: VolumeDetailCode,
    ): Decision => ({
      ...base,
      kind,
      rejectCode,
      humanReason,
      evidence: detailCode ? { ...evidence, detailCode } : evidence,
    });
    const reject = (
      code: RejectCode,
      humanReason: string,
      evidence: Decision['evidence'],
      detailCode?: VolumeDetailCode,
    ) => mk('reject', code, humanReason, evidence, detailCode);

    if (!ctx.symbolAllowed) return reject('symbol_blocked', 'symbol is not allowed', {});
    if (!isWakeup(f)) {
      return reject('data_stale', 'wakeup features unavailable for this symbol', {
        note: 'plain FeatureSnapshot without wakeup extension',
      });
    }

    const w1 = f.windows['1s'];
    const w5 = f.windows['5s'];
    const w15 = f.windows['15s'];
    const m1 = f.volumeMultiple['1s'] ?? null;
    const m5 = f.volumeMultiple['5s'] ?? null;
    const m15 = f.volumeMultiple['15s'] ?? null;
    const tc5 = f.tradeCountMultiple['5s'] ?? null;
    const move15 = w15?.priceMovePct ?? 0;
    const move5m = f.windows['5m']?.priceMovePct ?? 0;
    const evidence: Decision['evidence'] = {
      m1s: m1,
      m5s: m5,
      m15s: m15,
      tcMult5s: tc5,
      vol1sQuote: w1?.quoteVolume ?? 0,
      trades5s: w5?.tradeCount ?? 0,
      move15sPct: move15,
      move5mPct: move5m,
      spreadBps: f.spotSpreadBps,
      depthScore: f.depthScore,
      accelPctPerMin: f.accelerationPctPerMin,
      baselineSamples: f.baseline.samples,
      baselineConfidence: f.baseline.confidence,
      isDeadBaseline: f.baseline.isDead,
      signalAgeMs: f.signalAgeMs === Infinity ? null : f.signalAgeMs,
      focusAgeMs: f.focusAgeMs,
    };
    /** soft check failed: reject after grace, keep watching inside it */
    const soft = (
      code: RejectCode,
      humanReason: string,
      extra: Decision['evidence'],
      detailCode?: VolumeDetailCode,
    ): Decision => {
      if (f.signalAgeMs < this.cfg.verificationGraceMs)
        return mk(
          'watch',
          null,
          `verifying (${humanReason})`,
          { ...evidence, ...extra },
          'confirmation_pending',
        );
      return reject(code, humanReason, { ...evidence, ...extra }, detailCode);
    };

    // ---- baseline gate ----
    if (!f.baseline.ready) {
      const rawBurst = (w1?.quoteVolume ?? 0) > this.cfg.deadMaxQuotePerMin;
      if (rawBurst)
        return reject(
          'baseline_missing',
          `volume burst seen but only ${f.baseline.samples}/${this.cfg.baselineMinSamples} baseline minutes — refusing to guess`,
          evidence,
        );
      return mk('ignore', null, 'baseline still building, no activity', evidence);
    }

    // ---- activation ----
    const triggerArmed = f.signalAgeMs !== Infinity;
    const q1 = w1?.quoteVolume ?? 0;
    const q5 = w5?.quoteVolume ?? 0;
    const m1Hot = m1 !== null && m1 >= this.cfg.vol1sMultiple && q1 >= this.cfg.minActivationQuote1s;
    const m1Warm =
      m1 !== null &&
      m1 >= this.cfg.vol1sMultiple * this.cfg.watchFraction &&
      q1 >= this.cfg.minActivationQuote1s * this.cfg.watchFraction;
    const m5Warm =
      m5 !== null &&
      m5 >= this.cfg.vol5sMultiple * this.cfg.watchFraction &&
      q5 >= this.cfg.minActivationQuote1s;

    if (!m1Hot && !triggerArmed) {
      if (m1Warm || m5Warm) return mk('watch', null, 'volume warming toward trigger', evidence);
      return mk('ignore', null, 'volume within own norm', evidence);
    }
    if (!(m5 !== null && m5 >= this.cfg.vol5sMultiple) || !(m15 !== null && m15 >= this.cfg.vol15sMultiple)) {
      return mk('watch', null, '1s trigger fired, awaiting 5s/15s continuation', evidence, 'confirmation_pending');
    }

    // ---- HARD environment checks: more data will not fix these ----
    if (f.spotBid === null || f.spotAsk === null)
      return reject('book_missing', 'no book ticker seen for this symbol', evidence);
    if (f.spotStalenessMs !== null && f.spotStalenessMs > this.cfg.staleMs)
      return reject('data_stale', `book is ${f.spotStalenessMs}ms old (max ${this.cfg.staleMs}ms)`, evidence);
    if (f.spotSpreadBps !== null && f.spotSpreadBps > this.cfg.maxSpreadBps)
      return reject(
        'spread_too_wide',
        `spread ${f.spotSpreadBps.toFixed(1)}bps > max ${this.cfg.maxSpreadBps}bps`,
        evidence,
      );
    if (f.depthScore !== null && f.depthScore < this.cfg.minDepthScore)
      return reject('depth_too_thin', `depth score ${f.depthScore.toFixed(2)} < min ${this.cfg.minDepthScore}`, evidence);
    if (f.book.depthVsNorm !== null && f.book.depthVsNorm < this.cfg.depthCollapseRatio)
      return reject(
        'depth_too_thin',
        `top-of-book depth collapsed to ${(f.book.depthVsNorm * 100).toFixed(0)}% of its norm during the spike`,
        { ...evidence, depthVsNorm: f.book.depthVsNorm },
        'depth_vanished',
      );
    if (Math.abs(move5m) >= this.cfg.maxExtendedMovePct)
      return reject(
        'move_already_extended',
        `already moved ${move5m.toFixed(2)}% in 5m (max ${this.cfg.maxExtendedMovePct}%) — too late`,
        evidence,
      );
    const tape = f.tape;
    if (tape && tape.washReady && tape.washScore >= this.cfg.washScoreThreshold)
      return reject(
        DETAIL_TO_V0.wash_uniformity_suspect,
        `tape is suspiciously uniform (wash score ${tape.washScore.toFixed(2)}) — no real conviction`,
        { ...evidence, washScore: tape.washScore, priceRangePct: tape.priceRangePct },
        'wash_uniformity_suspect',
      );

    // ---- SOFT tape checks: young signals get grace, old ones get named ----
    if ((w5?.tradeCount ?? 0) <= this.cfg.onePrintMaxTrades)
      return soft('one_print_spike', `only ${w5?.tradeCount ?? 0} trade(s) behind the burst`, {});
    if (tc5 !== null && tc5 < this.cfg.minTradeCountMultiple)
      return soft(
        'trade_count_too_low',
        `trade count ${tc5.toFixed(1)}× vs required ${this.cfg.minTradeCountMultiple}×`,
        {},
      );
    if (tape && tape.maxTradeDominance >= this.cfg.onePrintDominanceRatio)
      return soft(
        'one_print_spike',
        `${(tape.maxTradeDominance * 100).toFixed(0)}% of burst volume is a single trade`,
        { maxTradeDominance: tape.maxTradeDominance },
      );
    if (tape && tape.maxTradePrintCount === 1 && tape.maxTradeDominance >= 0.5)
      return soft(
        DETAIL_TO_V0.aggregate_single_print,
        'dominant trade aggregates a single raw print',
        { maxTradeDominance: tape.maxTradeDominance },
        'aggregate_single_print',
      );

    const takerRatio = tape?.takerBuyRatio ?? null;
    if (takerRatio === null)
      return soft('taker_imbalance_missing', 'not enough trades to infer taker conviction', {});
    const imbalance = takerRatio - 0.5;
    if (Math.abs(imbalance) < this.cfg.minTakerImbalance)
      return soft(
        'taker_imbalance_missing',
        `taker flow balanced (${(takerRatio * 100).toFixed(0)}% buy) — no conviction`,
        { takerBuyRatio: takerRatio },
        'imbalance_weak',
      );
    const direction: 'long' | 'short' = imbalance > 0 ? 'long' : 'short';

    const signedMove = direction === 'long' ? move15 : -move15;
    if (signedMove < this.cfg.minFollowthroughPct)
      return soft(
        'price_no_followthrough',
        `price moved ${move15.toFixed(3)}% in 15s, below required ${this.cfg.minFollowthroughPct}% with ${direction} pressure`,
        { takerBuyRatio: takerRatio, direction },
      );

    // ---- verified signal: focus dwell, then proposal ----
    const confidence = this.confidenceOf(f, takerRatio, signedMove);
    const fullEvidence = {
      ...evidence,
      takerBuyRatio: takerRatio,
      direction,
      confidence,
      washScore: tape?.washScore ?? null,
      burstClusters: tape?.burst.clusterCount ?? null,
      largeTrades60s: f.windows['60s']?.largeTradeCount ?? 0,
    };
    if (f.focusAgeMs < this.cfg.minFocusDwellMs)
      return mk(
        'focus',
        null,
        `verified wakeup (${direction}) — in verification dwell ${f.focusAgeMs}/${this.cfg.minFocusDwellMs}ms`,
        fullEvidence,
      );
    if (ctx.killSwitch)
      return reject('kill_switch_on', 'verified wakeup but kill switch is ON — no proposal', fullEvidence);
    return mk(
      'proposal',
      null,
      `sustained ${direction} wakeup: ${m5?.toFixed(1)}× 5s volume, ${(takerRatio * 100).toFixed(0)}% taker-buy, ${move15.toFixed(2)}% follow-through`,
      fullEvidence,
    );
  }

  /** 0..1 — explainable blend of the strongest verification signals. */
  private confidenceOf(f: WakeupSnapshot, takerRatio: number, signedMovePct: number): number {
    const m5 = f.volumeMultiple['5s'] ?? 0;
    const volTerm = Math.min(1, (m5 ?? 0) / (this.cfg.vol5sMultiple * 4));
    const convictionTerm = Math.min(1, Math.abs(takerRatio - 0.5) / 0.35);
    const followTerm = Math.min(1, signedMovePct / (this.cfg.minFollowthroughPct * 4));
    const cleanTapeTerm = 1 - (f.tape?.washScore ?? 0);
    const baseTerm = f.baseline.confidence;
    return Math.max(
      0,
      Math.min(1, 0.3 * volTerm + 0.25 * convictionTerm + 0.2 * followTerm + 0.15 * cleanTapeTerm + 0.1 * baseTerm),
    );
  }
}
