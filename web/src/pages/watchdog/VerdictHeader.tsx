import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  canonicalWatchmanLauncherPresentation,
  type WatchmanRefreshActionState,
} from '../../lib/operatorControlPosture';
import type {
  CoverageTally,
  Fact,
  MaterialContinuity,
  WatchmanStatus,
} from './watchdogEvidence';
import { AbsenceSlot, rungFromWatchmanStatus, type Rung } from './StatusChip';
import { Identifier, ageParts, type IdentifierKind } from './MachineValue';
import './VerdictHeader.css';

// VerdictHeader — the first two seconds of the Watchdog page.
//
// It answers exactly three questions and renders nothing that answers a fourth:
//   1. What is the machine's connection posture right now?      -> the verdict
//   2. By which rule was that verdict reached?                  -> the rule line
//   3. How do I force every lane on this page to re-read?       -> the two controls
// plus the receipt that proves the cut on screen is the cut the server publishes.
//
// DOCTRINE, enforced here rather than asserted:
//  * The verdict is SERVER-OWNED. It is `canonicalCockpit.watchmanOverall`,
//    already hard-downgraded upstream to {outage, 'Canonical Truth Unavailable'}
//    whenever the envelope is not CURRENT or continuity is not PROVEN. This file
//    derives no health, upgrades nothing, and never colours a verdict green.
//  * `canonicalWatchmanLauncherPresentation` is used VERBATIM, and the rung is
//    read back off its returned `healthStatus`. That is the mechanical guarantee
//    the deleted modal shipped: a successful local re-read may append a label
//    suffix and can never colour the mark.
//  * No element in this file carries the class tokens `ok`, `live`, `ready` or
//    `pass`, and no aria-label here contains LIVE, READY or HEALTHY. The verdict
//    element is the page's canonical machine indicator and the i00 `noFalseGreen`
//    check reads it. Rungs are `data-rung` ATTRIBUTES, never classes.
//  * There is no clock in this file. `nowMs` arrives as a prop from the hook's
//    single 1000ms interval. Computing an age from the snapshot's own timestamp
//    is the pinned regression in web/test/productControlRoom/dashboard-age-clock.test.mjs:
//    it made every age read `0s ago` forever, so a wedged supervisor serving its
//    last cut was indistinguishable from a live one.

/* DELETED: this file's private `VerdictRung` ladder and its `RUNG_FOR_STATUS`
   mapper. They were a SECOND state vocabulary — the only one on the page — and
   the two disagreed on live data: `planned` mapped to NOT_CONFIGURED (hueless,
   no fill) in StatusChip and to `gated` (a --held-tint fill) here, so the same
   server value painted two different tones on one page. StatusChip owns the
   vocabulary and already publishes `rungFromWatchmanStatus`; this file composes
   it. §2 D39, §3.0, §5 L23.

   The header's own `data-rung` is now the TONE StatusChip resolves, so the
   header fill and the chip inside it can never disagree again. */
const RUNG_TONE_FOR_HEADER = {
  READY: 'bare',
  DEGRADED: 'warn',
  BLOCKED: 'blocked',
  OWNER_GATED: 'gated',
  UNAVAILABLE: 'absent',
  UNKNOWN: 'absent',
  NOT_CONFIGURED: 'absent',
} as const satisfies Record<Rung, string>;

/**
 * What each continuity disposition MEANS for the page, stated as a sentence in
 * reading order. A bare enum name is silence to an operator who has not read the
 * binding source; a bare em dash is silence to a screen reader.
 */
const CONTINUITY_SENTENCE = {
  PROVEN: 'Every material event between the last two cuts was read. Nothing on this page is missing an event.',
  BACKFILL: 'A gap in the material-event stream is still being back-read, so this census can lag the machine.',
  UNPROVEN: 'The material-event stream has not been proved continuous, so a missed event cannot be ruled out.',
  BLOCKED: 'The material-event stream could not be read at all, so nothing below is proved current.',
} as const satisfies Record<MaterialContinuity, string>;

/** The page clock's own tick, published by the hook. Ages quantise to it. */
const CLOCK_TICK_MS = 1_000;
/**
 * A stamp up to two ticks in the future is clock quantisation between the lane's
 * observation and this page's 1 Hz operator clock. Beyond that it is real skew,
 * and an age computed across real skew is a fabricated number.
 */
const CLOCK_SKEW_TOLERANCE_MS = CLOCK_TICK_MS * 2;
/**
 * How long the re-read readback stays on screen. Product decision: long enough
 * to read one sentence, short enough that it is never mistaken for standing
 * evidence. The slot that holds it is reserved permanently, so its arrival and
 * departure never shove the page.
 */
const REREAD_READBACK_DWELL_MS = 4_000;

/* DELETED: this file's private `AgeParts` type and `ageParts()` ladder.
   MachineValue owns the ONE duration scale on this page — it exists precisely
   because four private ladders had already drifted and the same instant read
   `59s` in the ledger and `1m` in the chain. §5 L23, §7 Q9. Its shape is
   `{ value, unit }`, not `{ n, unit }`. */

/* DELETED: `ElidedIdentifier` and `elideIdentifier()`. MachineValue's
   `Identifier` owns every middle truncation and every copy affordance on the
   page (§3.0, §2 D35, §3.2). The local copy also silently dropped the copy
   button and the character-count announcement §3.2 makes mandatory, and its
   `prefix`/`head`/`tail` props took the budget from the CALLER — the exact
   thing §3.2 forbids, since a budget that varies by call site means the same
   digest truncates differently in two places and stops being comparable. */

/**
 * A receipt cell that cannot prove itself. The narrow value tracks are sized for
 * a revision and a 10ch age, so a sentence rendered INSIDE one of them wraps
 * into a five-line ribbon that is unreadable at a glance. Every reason on this
 * header therefore leaves its column and lands in one shared notes block
 * beneath the receipt, at full measure, each carrying the field it belongs to as
 * real text rather than by alignment. That is also §3.4's honest-height thesis
 * at header scale: the head is physically taller exactly when it is carrying
 * something it could not prove.
 */
interface ReceiptNote {
  readonly field: string;
  readonly word: string;
  readonly reason: string;
  readonly defect: boolean;
}

/** The four scales of absence, resolved for one string-valued receipt fact. */
function readFact(field: string, fact: Fact<string>): {
  readonly value: string | null;
  readonly note: ReceiptNote | null;
} {
  if (fact.known) {
    if (fact.value !== null && fact.value.length > 0) return { value: fact.value, note: null };
    return {
      value: null,
      note: {
        field,
        word: 'EMPTY',
        reason: 'FACT_VALUE_EMPTY — the lane reported this fact as known and then carried no value.',
        defect: true,
      },
    };
  }
  if (fact.reason === null || fact.reason.length === 0) {
    return {
      value: null,
      note: {
        field,
        word: 'UNKNOWN',
        reason: 'FACT_REASON_MISSING — the lane reported this fact unknown and carried no reason, so it cannot be acted on.',
        defect: true,
      },
    };
  }
  return { value: null, note: { field, word: 'UNKNOWN', reason: fact.reason, defect: false } };
}

/** A receipt identity cell. The VALUE is `Identifier`'s — this owns nothing but
 *  the label and the cell's placement on the receipt's four tracks. The budget
 *  comes from the KIND and from nowhere else (§3.2), and the copy affordance and
 *  the character-count announcement come free with it. */
function IdentifierCell({ label, kind, value, word, className }: {
  readonly label: string;
  readonly kind: IdentifierKind;
  readonly value: string | null;
  readonly word: string;
  readonly className: string;
}): JSX.Element {
  return (
    <div className={`wdvh-cell ${className}`}>
      <span className="wd-t3 wdvh-cell-label">{label}</span>
      {value === null
        ? <span className="wd-t4 wd-nodata">{word}</span>
        : (
          <span className="wd-t4 wdvh-idhost">
            <Identifier kind={kind} value={value} label={label} />
          </span>
        )}
    </div>
  );
}

interface TallyFigureProps {
  readonly n: number;
  readonly unit: string;
  readonly measured: boolean;
  /** NON-NULL whenever `measured` is false. Absence is stated, never implied. */
  readonly unmeasuredReason: string;
}

/* The unmeasured branch used to be the literal `'—'`. NVDA reads an em dash as
   nothing at all, so the page's headline owner census announced FIVE silences
   and no reason (§5 L2, §2 D37, §3.12). It is `AbsenceSlot` now — the one
   absence mark on the page — carrying the reason as sr-only text. */
function TallyFigure({ n, unit, measured, unmeasuredReason }: TallyFigureProps): JSX.Element {
  return (
    <span className="wdvh-fig" data-measured={measured ? 'true' : 'false'}>
      <span className="wd-t4 wd-num wdvh-fig-n">
        {measured ? n : <AbsenceSlot kind="void" srLabel={unmeasuredReason} />}
      </span>
      <span className="wd-t6 wdvh-fig-u">{unit}</span>
    </span>
  );
}

export function VerdictHeader(props: {
  readonly verdict: { readonly status: WatchmanStatus; readonly label: string };
  readonly rule: string;
  readonly continuity: MaterialContinuity;
  readonly assessedAtMs: number | null;
  readonly nowMs: number;
  readonly tally: CoverageTally;
  readonly revision: Fact<string>;
  readonly digest: Fact<string>;
  readonly reReading: boolean;
  readonly onReReadAll: () => void;
  readonly liveMessage: string | null;
}): JSX.Element {
  const {
    verdict, rule, continuity, assessedAtMs, nowMs, tally,
    revision, digest, reReading, onReReadAll, liveMessage,
  } = props;

  // ---- the re-read readback -------------------------------------------------
  // The only thing this page can PROVE about a completed re-read is whether the
  // assessed stamp advanced. Rendering "Completed" because the promise settled
  // would be an optimistic claim about lanes that may every one of them have
  // replied with their previous cut. So the baseline is captured on press and
  // compared on settle, and the readback states exactly which of the two
  // happened. `onReReadAll` returns void, so the settle edge is `reReading`
  // falling — the shell owns the request, this owns the observation.
  const [readback, setReadback] = useState<{ readonly advanced: boolean; readonly atMs: number } | null>(null);
  const inFlightRef = useRef(false);
  const baselineRef = useRef<number | null>(null);

  useEffect(() => {
    if (reReading && !inFlightRef.current) {
      inFlightRef.current = true;
      baselineRef.current = assessedAtMs;
      setReadback(null);
      return;
    }
    if (!reReading && inFlightRef.current) {
      inFlightRef.current = false;
      const baseline = baselineRef.current;
      setReadback({
        advanced: assessedAtMs !== null && (baseline === null || assessedAtMs > baseline),
        atMs: nowMs,
      });
    }
  }, [reReading, assessedAtMs, nowMs]);

  // Derived from the page clock, so the readback needs no second timer.
  const readbackVisible = readback !== null && nowMs - readback.atMs < REREAD_READBACK_DWELL_MS;
  const readbackNote = !readbackVisible || readback === null
    ? null
    : readback.advanced
      ? 'Re-read settled. The assessed stamp advanced, so at least one lane returned an observation newer than the one already on screen.'
      : 'Re-read settled. The assessed stamp did not advance: no lane returned an observation newer than the one already on screen.';

  const actionState: WatchmanRefreshActionState = reReading
    ? 'spin'
    : readbackVisible && readback !== null
      ? (readback.advanced ? 'ok' : 'err')
      : 'idle';

  // Used verbatim. `healthStatus` is `canonicalStatus` unchanged by contract, and
  // reading the rung back off it is what makes "a local action can never colour
  // the mark" a mechanical property rather than a review convention. The action
  // outcome reaches the operator only through `label`'s suffix and through the
  // visible readback sentence.
  const launcher = canonicalWatchmanLauncherPresentation({
    canonicalStatus: verdict.status,
    canonicalLabel: verdict.label,
    actionState,
  });
  const verdictRung: Rung = rungFromWatchmanStatus(launcher.healthStatus);
  const rung = RUNG_TONE_FOR_HEADER[verdictRung];

  // ---- the ONE live region --------------------------------------------------
  // BIBLE 4.7: one `role="status" aria-live="polite" aria-atomic="true"` per
  // page, present from first paint, silent when nothing of consequence happened,
  // carrying a visually-hidden monotonic sequence because aria-atomic with an
  // identical consecutive string does not re-announce and flapping is the
  // highest-signal behaviour on this page. Two writers, one region: the shell's
  // poll transitions, and this header's own readback — which is the one utterance
  // an operator directly asked for.
  const [utterance, setUtterance] = useState<{ readonly text: string; readonly seq: number } | null>(null);
  const say = useCallback((text: string) => {
    setUtterance((prev) => ({ text, seq: (prev?.seq ?? 0) + 1 }));
  }, []);
  // Declaration order IS the precedence: when a poll transition and a readback
  // land in the same commit, the readback speaks, because it is the one thing the
  // operator just asked for.
  useEffect(() => {
    if (liveMessage !== null && liveMessage.length > 0) say(liveMessage);
  }, [liveMessage, say]);
  useEffect(() => {
    if (readbackNote !== null) say(readbackNote);
  }, [readbackNote, say]);

  // The launcher label is an accessible DESCRIPTION, so it needs a real id that
  // cannot collide if this header is ever mounted beside another.
  const headerId = useId();
  const launcherStateId = `${headerId}-launcher-state`;

  const handleReRead = useCallback(() => {
    if (reReading) return;
    onReReadAll();
  }, [reReading, onReReadAll]);

  // ---- assessed age ---------------------------------------------------------
  const elapsedMs = assessedAtMs === null ? null : nowMs - assessedAtMs;
  const clockSkewed = elapsedMs !== null && elapsedMs < -CLOCK_SKEW_TOLERANCE_MS;
  const age = elapsedMs === null || clockSkewed ? null : ageParts(Math.max(0, elapsedMs));
  const skewAhead = clockSkewed && elapsedMs !== null ? ageParts(Math.abs(elapsedMs)) : null;

  // ---- the coverage tally ---------------------------------------------------
  // BIBLE 3.14: an exhaustive partition whose visible integers sum to the printed
  // population. A counter that cannot be audited is a counter that can flatter,
  // so the partition is checked at runtime and a broken one says so on screen.
  const partitionSum = tally.proven + tally.withheld + tally.failing + tally.unknown;
  const measured = tally.population > 0;
  const partitionBroken = measured && partitionSum !== tally.population;
  /* One sentence, carried by the five absence slots AND by the receipt note
     below, so the visual absence and the spoken absence say the same thing. */
  const tallyReason = 'The owner model assembled no rows, so nothing on this page is counted and no coverage can be claimed.';

  const ruleMissing = rule.length === 0;
  const verdictLabelMissing = verdict.label.length === 0;

  // ---- the receipt, and everything in it that cannot prove itself -----------
  const revisionRead = readFact('Revision', revision);
  const digestRead = readFact('Digest', digest);

  const notes: ReceiptNote[] = [];
  if (revisionRead.note !== null) notes.push(revisionRead.note);
  if (digestRead.note !== null) notes.push(digestRead.note);
  if (!measured) {
    notes.push({
      field: 'Owner census',
      word: 'UNKNOWN',
      reason: tallyReason,
      defect: false,
    });
  }
  if (partitionBroken) {
    notes.push({
      field: 'Owner census',
      word: 'DEFECT',
      reason: `TALLY_PARTITION_INCOMPLETE — the four classes sum to ${partitionSum} against a population of ${tally.population}. This counter is not an exhaustive partition and must not be read as coverage.`,
      defect: true,
    });
  }
  // One word, used by BOTH the receipt cell and its note, so the two can never
  // disagree about what the page is claiming.
  const ageWord = clockSkewed ? 'SKEWED' : 'NEVER';
  if (age === null) {
    notes.push({
      field: 'Assessed',
      word: ageWord,
      reason: clockSkewed && skewAhead !== null
        ? `The newest lane observation is ${skewAhead.value}${skewAhead.unit} ahead of this browser's clock, so its age is not computable and no freshness claim below can be trusted.`
        : 'No lane has produced an observation yet, so there is nothing to age.',
      defect: false,
    });
  }

  return (
    <header className="wdf-page-head wdvh" data-rung={rung}>
      {/* ---- identity: the mark, the name, the verdict, the one action ---- */}
      <div className="wdvh-identity">
        <button
          type="button"
          className={`wdb wdb--icon wdvh-mark${reReading ? ' is-pending' : ''}`}
          aria-label="Re-read all Watchdog evidence"
          aria-describedby={launcherStateId}
          aria-disabled={reReading || undefined}
          aria-busy={reReading || undefined}
          onClick={handleReRead}
        >
          <img
            className="wdvh-mark-img wdb-glyph"
            src="/connection-reset-mark.svg"
            alt=""
            draggable={false}
          />
          <span className="wdb-spin" aria-hidden="true" />
        </button>
        {/* Parity: the launcher's canonical label, verbatim, including the
            ' · Public Refresh Running|Completed|Needs Review' suffix. It is the
            control's accessible DESCRIPTION, exactly as it was the launcher's
            title in the deleted modal. Its visible carriers are richer: the
            verdict pill and the readback sentence below. */}
        <span id={launcherStateId} className="sr-only">{launcher.label}</span>

        <div className="wdvh-name">
          <h1 className="wd-t1 wdvh-title">Watchdog</h1>
          {/* DELETED: the scope line `Website · bot · public sources ·
              owner-gated boundaries`. It was a hardcoded string directly under
              the H1, derived from nothing, refuted by nothing, aging never — a
              marketing subtitle on an evidence surface. What it claimed to
              describe is measured one element below, by the owner census, which
              names the actual population and how much of it is proven. */}
        </div>

        {/* The page's canonical machine indicator. Server-owned label, fill from
            the rung, no hue outside the fill, no glyph, no `ok`/`live`/`ready`/
            `pass` token, no aria-label. Names are never truncated (L20), so it
            wraps rather than elides. */}
        <p
          className="wdvh-verdict wd-t4"
          data-rung={rung}
          data-defect={verdictLabelMissing ? 'true' : undefined}
        >
          <span className="sr-only">Machine connection verdict: </span>
          {verdictLabelMissing
            ? 'VERDICT_LABEL_MISSING'
            : verdict.label}
        </p>

        <div className="wdvh-actions">
          <button
            type="button"
            className={`wdb wdb--secondary wdvh-reread${reReading ? ' is-pending' : ''}`}
            aria-disabled={reReading || undefined}
            aria-busy={reReading || undefined}
            onClick={handleReRead}
          >
            <RefreshCw className="wdb-glyph wdvh-reread-glyph" size={12} aria-hidden="true" />
            {/* The Label Law: the label describes what pressing does, and it does
                not change while the action is in flight — the width is reserved
                and the spinner is the only in-flight evidence. */}
            <span className="wdb-label">Re-read evidence</span>
            <span className="wdb-spin" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ---- the rule, and the evidence stream it was reached over ---- */}
      <div className="wdvh-narrative">
      <dl className="wdvh-why">
        <div className="wdvh-why-item" data-defect={ruleMissing ? 'true' : undefined}>
          <dt className="wd-t3">Verdict rule</dt>
          <dd className="wd-t5">
            {ruleMissing
              ? 'VERDICT_RULE_MISSING — the verdict arrived without the predicate that produced it, so it cannot be audited.'
              : <b>{rule}</b>}
          </dd>
        </div>
        <div className="wdvh-why-item">
          <dt className="wd-t3">Evidence stream</dt>
          <dd className="wd-t5">
            {/* Parity: the literal 'Live Monitor', gated on continuity === 'PROVEN'.
                It is a WORD and an adjacent measured age, not a pulsing dot: BIBLE
                M1 forbids motion on a settled state, and a liveness indicator that
                keeps animating after the feed dies is worse than none. The assessed
                age below is the non-motion carrier, and it grows when the supervisor
                wedges. */}
            {continuity === 'PROVEN'
              ? <><b>Live Monitor</b> · material continuity PROVEN. {CONTINUITY_SENTENCE.PROVEN}</>
              : <>Monitor not live · material continuity <b>{continuity}</b>. {CONTINUITY_SENTENCE[continuity]}</>}
          </dd>
        </div>
      </dl>

      {/* Reserved permanently, deliberately empty when idle: a control's readback
          must never shove the page it is reporting on. */}
      <p className="wd-t5 wdvh-readback" data-outcome={readback === null ? 'none' : readback.advanced ? 'advanced' : 'flat'}>
        {readbackVisible ? readbackNote : null}
      </p>
      </div>

      {/* ---- the receipt: which cut is this, and how much of it is proved ----
          Four tracks, and the last one terminates on the page gutter. There is
          no padding-inline anywhere in this header, so `Assessed` lands on the
          exact x every numeric column further down the page lands on. That is
          the whole reason there are no cards. */}
      <div className="wdvh-receipt">
        <IdentifierCell
          label="Revision"
          kind="rev"
          value={revisionRead.value}
          word={revisionRead.note?.word ?? ''}
          className="wdvh-cell--rev"
        />
        <IdentifierCell
          label="Digest"
          kind="digest"
          value={digestRead.value}
          word={digestRead.note?.word ?? ''}
          className="wdvh-cell--digest"
        />

        <div className="wdvh-cell wdvh-cell--tally">
          <span className="wd-t3 wdvh-cell-label">Owner census</span>
          <span className="wdvh-figs">
            <TallyFigure n={tally.population} unit="owners" measured={measured} unmeasuredReason={tallyReason} />
            <TallyFigure n={tally.proven} unit="proven" measured={measured} unmeasuredReason={tallyReason} />
            <TallyFigure n={tally.withheld} unit="withheld" measured={measured} unmeasuredReason={tallyReason} />
            <TallyFigure n={tally.failing} unit="failing" measured={measured} unmeasuredReason={tallyReason} />
            <TallyFigure n={tally.unknown} unit="unknown" measured={measured} unmeasuredReason={tallyReason} />
          </span>
        </div>

        <div className="wdvh-cell wdvh-cell--age">
          <span className="wd-t3 wdvh-cell-label">Assessed</span>
          {age !== null ? (
            <span className="wd-t4 wd-num wdvh-age">
              {age.value}
              <span className="wdvh-age-u">{age.unit}</span>
            </span>
          ) : (
            <span className="wd-t4 wd-nodata wdvh-age">{ageWord}</span>
          )}
        </div>
      </div>

      {/* Every receipt fact that could not prove itself, at full measure, each
          naming its own field in text rather than by alignment. Rendered only
          when there is something to say — the header is physically taller
          exactly when it is carrying a reason, and never otherwise. */}
      {notes.length > 0 ? (
        <ul className="wdvh-notes" role="list" aria-label="Facts this header could not prove">
          {notes.map((note) => (
            <li
              key={`${note.field}:${note.word}`}
              className="wd-t5 wdvh-note"
              data-defect={note.defect ? 'true' : undefined}
            >
              <b className="wdvh-note-field">{note.field}</b>
              <span className="wd-t4 wd-nodata wdvh-note-word">{note.word}</span>
              <span className="wdvh-note-reason">{note.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* The page's single live region. Present from first paint. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {utterance === null ? '' : `${utterance.text} #${utterance.seq}`}
      </div>
    </header>
  );
}
