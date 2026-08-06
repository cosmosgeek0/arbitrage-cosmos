/* =============================================================================
   MachineValue — the rendering authority for every machine value on the page.

   Three primitives that share ONE character grid, which is why they share one
   file and one author: `Numeric` reserves the tracks, `Identifier` truncates
   inside them, `Sparkline` hangs off the same right edge. Three agents would
   drift the grid; one cannot.

   BIBLE: docs/design/watchdog/BIBLE.md §1.4 (type), §3.2 (Identifier),
          §3.3 (Numeric), §3.15 (Sparkline). Composition graph §3.0 names these
          three as owners — an element that re-implements one is wrong by
          construction, not by taste.

   THE OPERATOR QUESTION THIS FILE ANSWERS
     Can I compare this number against the one above it without moving my eye,
     copy this digest without losing a character, and see whether this value is
     near the commitment it is measured against?

   WHAT THIS FILE MAY NOT DO
     - fetch, poll, read a store, or call Date.now()  (WatchdogSurface owns reads)
     - format an unknown into 0, '', '—' or a healthy value      (§5 L1, L2)
     - choose a threshold, a band, or a precision                 (§3.3 L2, §3.15)
     - render a reason in a title attribute                       (§5 L4)
     - open a second live region                                  (§5 L23, D30)
   ========================================================================== */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { Fact } from './watchdogEvidence';
import type { Rung } from './StatusChip';

import './MachineValue.css';

/* ---------------------------------------------------------------------------
   THE ANNOUNCEMENT CONTRACT

   §3.2 requires a copy to be announced with a CHARACTER COUNT, and D30 settles
   that the page has exactly ONE role="status" region, in the header. This file
   is not that region and must not grow one. It therefore publishes the outcome
   as a bubbling DOM event; WatchdogSurface (which owns the region) subscribes
   with `onMachineValueAnnouncement` and speaks it.

   A DOM event and not a module-level subscriber registry, deliberately: the
   page's data contract forbids module-level mutable state, and an event needs
   none. If nobody subscribes nothing throws — the visual mark still carries the
   outcome — but the announcement is then genuinely missing, so the subscription
   is part of integration, not a nicety.
   ------------------------------------------------------------------------- */
export const MACHINE_VALUE_ANNOUNCE_EVENT = 'watchdog:machine-value-announce';

export interface MachineValueAnnouncement {
  /** Ready to speak. Already carries the character count §3.2 requires. */
  readonly message: string;
  readonly outcome: 'copied' | 'selected' | 'failed';
  /** Characters actually placed on the clipboard / selected. Never truncated. */
  readonly characters: number;
}

/** Subscribe the page's single live region to copy outcomes. Returns an unsubscribe. */
export function onMachineValueAnnouncement(
  target: EventTarget,
  listener: (announcement: MachineValueAnnouncement) => void,
): () => void {
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<MachineValueAnnouncement>).detail;
    if (detail) listener(detail);
  };
  target.addEventListener(MACHINE_VALUE_ANNOUNCE_EVENT, handler);
  return () => target.removeEventListener(MACHINE_VALUE_ANNOUNCE_EVENT, handler);
}

/* =============================================================================
   1 · Numeric — the character grid (§3.3)

   Five tracks and NOTHING after the unit; that is what lets every numeric
   column on the page terminate on one shared right edge (§4.3, L18):

     [sign 1ch][int minmax(N,max-content)][point max-content][frac Nch][unit Nch]
                                          ^ THE DECIMAL ANCHOR
   ========================================================================== */

export type NumericTrack = 'num' | 'age' | 'auto';

/**
 * `plain` — no verdict.
 * `warn`  — the EVIDENCE under this number is old (rule under the digits).
 * `bad`   — the SERVER published a breach of a bound (§3.3: server verdict only;
 *           a renderer never decides a number is bad).
 */
export type NumericTone = 'plain' | 'warn' | 'bad';

/** Venue precision runs to 8dp (`pair_decimals`); nothing published exceeds it. */
const MAX_DIGITS = 8;

interface Rendered {
  readonly sign: string;
  readonly int: string;
  readonly frac: string;
}

/**
 * §3.3 L4: below resolution renders `<0.1` with `<` in the SIGN track — never 0.
 * A value that rounds to zero at the column's published precision but is not
 * zero is the single most common way a formatter lies on a monitoring surface.
 *
 * `toFixed`, not `Intl.NumberFormat`: Intl's grouping separator is
 * locale-dependent and is a NARROW NO-BREAK SPACE in several locales, which
 * §3.3 L6 forbids in a value an operator pastes into an incident ticket.
 */
function renderNumber(value: number, digits: number): Rendered {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0 && value !== 0) {
    // Below the column's resolution. Show the resolution, and which side of it.
    const step = Math.pow(10, -digits).toFixed(digits);
    const [stepInt = '0', stepFrac = ''] = step.split('.');
    return value > 0
      ? { sign: '<', int: stepInt, frac: stepFrac }
      : { sign: '>', int: `-${stepInt}`, frac: stepFrac };
  }
  const fixed = value.toFixed(digits);
  const negative = fixed.startsWith('-');
  const magnitude = negative ? fixed.slice(1) : fixed;
  const [int = '0', frac = ''] = magnitude.split('.');
  return { sign: negative ? '-' : '', int, frac };
}

export function Numeric(props: {
  readonly fact: Fact<number>;
  readonly unit?: string;
  readonly digits?: number;
  readonly track?: NumericTrack;
  readonly tone?: NumericTone;
}): JSX.Element {
  const { fact, unit, track = 'num', tone = 'plain' } = props;
  // `?? 0` defaults the COLUMN'S PUBLISHED PRECISION, not a measurement: an
  // omitted budget means "this column publishes whole numbers" (wsClients,
  // queueDepth, restartCount). It cannot round a real value away to zero —
  // renderNumber's below-resolution rule catches that and prints `<1`. The one
  // thing never defaulted anywhere in this file is a VALUE.
  const digits = Math.min(MAX_DIGITS, Math.max(0, Math.trunc(props.digits ?? 0)));

  /* ABSENCE AT SLOT SCALE (§5 L2, §3.12, D37).
     Never 0, never '', never a healthy value, and never a bare em dash — NVDA
     reads a dash as nothing at all, and on an evidence-gated surface silence is
     the most complete form of the lie. The mark is a 3ch dotted rule sitting ON
     THE INT TRACK: deliberately narrower than any real value, so it can never
     imply magnitude, and identical in every column, so the page's blindness
     resolves into a countable grid instead of noise.

     THE REASON IS NOT PRINTED IN THIS CELL, AND THAT IS A DECISION, NOT AN
     OMISSION. A numeric column is 9-10ch (§4.3). A reason code —
     LOOP_LAG_RING_EMPTY, COMPONENT_ABSENT_FROM_ENVELOPE — offers no break
     opportunity of its own, so inside that track it either wraps
     character-by-character into an unreadable tower or overruns its neighbour
     and destroys the one shared right edge L18 exists to protect. Rendered,
     both are worse than the silence they were meant to cure. §3.12 settles
     where the words go instead, at the two scales this component is not: the
     ROW's own T5 reason line (OwnerRow), and the COLUMN header once every slot
     is dark — where, in `role=table`, AT re-announces the header with every
     cell, so all the dark cells get their reason with zero extra DOM. Here the
     reason travels as sr-only text in reading order, and as a `data-reason`
     attribute the row renderer, a test, or a DOM export can read without
     re-deriving it. */
  if (!fact.known || fact.value === null || !Number.isFinite(fact.value)) {
    // A Fact claiming to be known while carrying no finite value, or claiming
    // to be unknown while carrying no reason, breaks the contract frozen in
    // watchdogEvidence.ts. That is a PRODUCER defect, not a state of the
    // machine, and it is rendered as one in production rather than smoothed
    // over into an ordinary unknown.
    const defective = fact.known || fact.reason === null;
    const reason = fact.known ? 'VALUE_NOT_FINITE' : (fact.reason ?? 'REASON_MISSING');
    // The unwritten slot reserves EXACTLY what the value would have reserved —
    // same fraction budget, and the same unit element — so the dotted rule
    // lands on the integer track at the decimal anchor instead of drifting to
    // the cell edge. Otherwise a column of dark cells sits a few characters
    // right of the column of digits and the countable grid §3.12 is buying
    // stops existing. The unit is layout here, not a claim: it belongs to the
    // column, not to a measurement that was never taken, so it is hidden from
    // AT and the sr-only sentence carries the whole truth.
    const vars: CSSProperties = {
      ['--numx-frac' as string]: `${digits}ch`,
    };
    return (
      <span
        className="numx is-unknown"
        style={vars}
        data-track={track}
        data-source={fact.source}
        data-reason={reason}
        data-defect={defective ? 'true' : undefined}
      >
        <span className="numx-void" aria-hidden="true" />
        <span className="sr-only">
          {defective ? 'Producer defect. ' : 'Not measured. '}
          {`Reason: ${reason}. Source: ${fact.source}.`}
        </span>
        {unit ? <span className="numx-u" aria-hidden="true">{unit}</span> : null}
      </span>
    );
  }

  const { sign, int, frac } = renderNumber(fact.value, digits);
  // The ONLY track this component reserves from JS, because it is the only one
  // whose width is a property of THIS value: `digits` published fraction
  // digits, in tabular figures, whose advance IS the `ch`. The integer reserve
  // belongs to the column (`--numx-int`, see MachineValue.css) and the unit
  // track is measured by the browser.
  const vars: CSSProperties = { ['--numx-frac' as string]: `${digits}ch` };

  return (
    <span
      className={`numx${tone === 'bad' ? ' is-breach' : ''}${tone === 'warn' ? ' is-stale' : ''}`}
      style={vars}
      data-track={track}
      data-source={fact.source}
    >
      {/* No injected characters (§3.3 L6): selecting this cell yields exactly
          `312.4ms`. The 1ch gap before the unit is padding, never a space. */}
      <span className="numx-s">{sign}</span>
      <span className="numx-i">{int}</span>
      {digits > 0 ? <span className="numx-p">.</span> : null}
      {digits > 0 ? <span className="numx-f">{frac}</span> : null}
      {unit ? <span className="numx-u">{unit}</span> : null}
    </span>
  );
}

/* =============================================================================
   1b · Age — THE PAGE'S ONE DURATION SCALE (§5 Law 5, bible §7 open question 9)

   Added at integration. Four files had each grown their own age ladder
   (OwnerRow.ageParts, OwnerLedger.ageWord, ConnectionPathChain.ageWord,
   RecoveryConsole.ageParts) and one of the four rounded where the others
   floored, so the same instant could read `59s` in the ledger and `1m` in the
   chain. Law 5 wants one implementation; it belongs HERE because this file
   already owns the reserved `age` track those numbers sit on, and because every
   one of those four already imports this module (so nothing gains a cycle).

   FLOOR, NOT ROUND. Rounding up crosses a unit boundary before the duration
   has actually elapsed, which prints an age the clock has not reached — a value
   that was not measured (§5 L1). Floor never overstates the elapsed time.

   `at === null` renders the caller's own `never` word as real DOM text, never a
   dash and never a zero: absence is stated (§5 L3).
   ========================================================================== */

/** The ladder, decomposed into the (value, unit) pair the character grid needs
 *  — a pre-joined string cannot sit on a reserved track. */
export function ageParts(elapsedMs: number): Readonly<{ value: number; unit: string }> {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return { value: seconds, unit: 's' };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 100) return { value: minutes, unit: 'm' };
  const hours = Math.floor(minutes / 60);
  if (hours < 100) return { value: hours, unit: 'h' };
  return { value: Math.floor(hours / 24), unit: 'd' };
}

/** The same ladder joined, for the places that render an age inside a sentence
 *  rather than on a column track. One ladder, two presentations — never two
 *  ladders. */
export function ageWord(elapsedMs: number): string {
  const { value, unit } = ageParts(elapsedMs);
  return `${value}${unit}`;
}

/**
 * An elapsed age rendered inline, from a measured instant and the page's single
 * operator clock. `nowMs` is a PROP and never `Date.now()` — the pinned
 * regression `web/test/productControlRoom/dashboard-age-clock.test.mjs` exists
 * because a render-time clock made a wedged supervisor indistinguishable from a
 * live one.
 */
export function Age(props: {
  readonly at: number | null;
  readonly nowMs: number;
  readonly never: string;
}): JSX.Element {
  const { at, nowMs, never } = props;
  if (at === null || !Number.isFinite(at)) {
    // Stated absence. `wd-nodata` is the page's shared unmeasured ink; the word
    // itself comes from the caller because only the caller knows what kind of
    // nothing this is ("never", "no observation").
    return <span className="wd-nodata">{never}</span>;
  }
  const { value, unit } = ageParts(Math.max(0, nowMs - at));
  return (
    <span className="wd-num agex">
      {value}
      <span className="agex-u">{unit}</span>
    </span>
  );
}

/* =============================================================================
   2 · Identifier — middle truncation with copy (§3.2)

   The differentiating end of a hash is the collision-resistant end, so the TAIL
   is never shorter than the head (D36). The elided middle stays in DOM order
   inside a clipped span, so a drag-selection traverses it and the clipboard
   receives the complete value; the ellipsis is a generated ::before and is
   therefore never copied (D35).
   ========================================================================== */

export type IdentifierKind = 'rev' | 'digest' | 'corr' | 'addr' | 'ref' | 'path' | 'raw';

interface KindBudget {
  /** Structural prefix. Never elided. */
  readonly prefix: string;
  readonly head: number;
  readonly tail: number;
}

/** §3.2's kind table, canonical (D36). Budgets are a function of KIND ONLY —
 *  never of column width, or the same digest would truncate differently in two
 *  places and stop being comparable by eye. */
const KIND: Readonly<Record<'rev' | 'digest' | 'corr' | 'addr' | 'ref', KindBudget>> = {
  rev: { prefix: '', head: 7, tail: 8 },
  digest: { prefix: 'sha256:', head: 8, tail: 8 },
  corr: { prefix: '', head: 6, tail: 8 },
  addr: { prefix: '0x', head: 6, tail: 8 },
  ref: { prefix: '', head: 14, tail: 18 },
};

/** A path elides LEADING segments to a 36ch trailing budget, and never cuts
 *  inside a segment: a truncated value is a bug, a truncated NAME is an
 *  incident (§5 L20). Separators stay selectable — `user-select:none` on them
 *  silently turns `server/src/engine` into `serversrcengine` on copy. */
const PATH_TAIL_BUDGET = 36;

interface Split {
  readonly head: string;
  readonly mid: string;
  readonly tail: string;
}

function splitPath(value: string): Split {
  if (value.length <= PATH_TAIL_BUDGET) return { head: value, mid: '', tail: '' };
  let cut = -1;
  for (let i = value.length - 1; i >= 0; i -= 1) {
    if (value[i] !== '/') continue;
    if (value.length - i > PATH_TAIL_BUDGET) break;
    cut = i;
  }
  // No separator inside budget: the final segment alone exceeds it. Render in
  // full rather than cut a name in half.
  if (cut <= 0) return { head: value, mid: '', tail: '' };
  return { head: '', mid: value.slice(0, cut), tail: value.slice(cut) };
}

function splitIdentifier(kind: IdentifierKind, value: string): Split {
  if (kind === 'raw') return { head: value, mid: '', tail: '' };
  if (kind === 'path') return splitPath(value);
  const budget = KIND[kind];
  const prefix = value.startsWith(budget.prefix) ? budget.prefix.length : 0;
  // Elide only when it BUYS something: +4 is the shortest middle worth hiding.
  if (value.length <= prefix + budget.head + budget.tail + 4) {
    return { head: value, mid: '', tail: '' };
  }
  return {
    head: value.slice(0, prefix + budget.head),
    mid: value.slice(prefix + budget.head, value.length - budget.tail),
    tail: value.slice(value.length - budget.tail),
  };
}

type CopyOutcome = 'idle' | 'copied' | 'selected' | 'failed';

/** Long enough to outlive a glance, short enough not to become furniture.
 *  Named after --mo-seek (1200ms), the longest declared loop in §1.7. */
const COPY_FEEDBACK_DWELL_MS = 1_200;

/* ONE 12px slot holding both glyphs, stacked. The mark must never reflow the
   row it sits in (§5 L11), and reserving two slots to show one would leave 12px
   of permanent emptiness beside every identifier on the page. */
const CopyGlyph = (): JSX.Element => (
  <svg
    className="wd-id-ico"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" />
  </svg>
);

const CheckGlyph = (): JSX.Element => (
  <svg
    className="wd-id-copied"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M4 12.5 9.5 18 20 6.5" />
  </svg>
);

export function Identifier(props: {
  readonly kind: IdentifierKind;
  readonly value: string;
  readonly label: string;
}): JSX.Element {
  const { kind, value, label } = props;
  const noteId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  // `seq` increments on every copy so that copying the SAME identifier twice
  // restarts the dwell. Keyed on outcome alone, the second click would inherit
  // the first click's timer and the mark would vanish early.
  const [feedback, setFeedback] = useState<{ readonly outcome: CopyOutcome; readonly seq: number }>(
    { outcome: 'idle', seq: 0 },
  );
  const [note, setNote] = useState<string>(`${value.length} characters.`);
  const outcome = feedback.outcome;

  const { head, mid, tail } = splitIdentifier(kind, value);
  const elided = mid.length > 0;

  // Rows on this page re-render every poll and React reuses component
  // instances. Without this, a row whose identifier changed underneath it would
  // keep displaying the PREVIOUS value's copy outcome and character count — a
  // receipt for something the operator never copied.
  useEffect(() => {
    setFeedback({ outcome: 'idle', seq: 0 });
    setNote(`${value.length} characters.`);
  }, [value]);

  // The mark clears itself, and — while it is showing — listens for any OTHER
  // identifier's announcement so that exactly ONE check is on screen at a time
  // (§3.2). Zero listeners exist in the resting state; at most one ever does.
  useEffect(() => {
    if (feedback.outcome === 'idle') return undefined;
    const clear = (): void => setFeedback((f) => ({ outcome: 'idle', seq: f.seq }));
    const timer = window.setTimeout(clear, COPY_FEEDBACK_DWELL_MS);
    const onOther = (event: Event): void => {
      if (event.target !== buttonRef.current) clear();
    };
    document.addEventListener(MACHINE_VALUE_ANNOUNCE_EVENT, onOther);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener(MACHINE_VALUE_ANNOUNCE_EVENT, onOther);
    };
  }, [feedback]);

  const announce = useCallback((detail: MachineValueAnnouncement): void => {
    buttonRef.current?.dispatchEvent(
      new CustomEvent<MachineValueAnnouncement>(MACHINE_VALUE_ANNOUNCE_EVENT, {
        bubbles: true,
        detail,
      }),
    );
  }, []);

  /** No clipboard API (plain HTTP, sandboxed iframe) is not a failure of the
   *  operator's intent — select the full range instead and SAY SO (§3.2). */
  const selectFullValue = useCallback((): boolean => {
    const node = textRef.current;
    if (node === null || typeof window.getSelection !== 'function') return false;
    const selection = window.getSelection();
    if (selection === null) return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }, []);

  const onCopy = useCallback((): void => {
    // The FULL value, from the prop — never scraped from rendered text, which
    // is elided by construction.
    const full = value;
    const chars = full.length;

    const fallback = (why: string): void => {
      if (selectFullValue()) {
        const message = `Clipboard unavailable (${why}). ${label} selected in full, ${chars} characters — copy with your keyboard.`;
        setFeedback((f) => ({ outcome: 'selected', seq: f.seq + 1 }));
        setNote(message);
        announce({ message, outcome: 'selected', characters: chars });
        return;
      }
      const message = `Copy failed (${why}). ${label} is ${chars} characters and could not be placed on the clipboard or selected.`;
      setFeedback((f) => ({ outcome: 'failed', seq: f.seq + 1 }));
      setNote(message);
      announce({ message, outcome: 'failed', characters: chars });
    };

    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      fallback('no clipboard API in this context');
      return;
    }
    clipboard.writeText(full).then(
      () => {
        const message = `Copied ${label}, ${chars} characters.`;
        setFeedback((f) => ({ outcome: 'copied', seq: f.seq + 1 }));
        setNote(message);
        announce({ message, outcome: 'copied', characters: chars });
      },
      (error: unknown) => {
        fallback(error instanceof Error ? error.message : 'clipboard write rejected');
      },
    );
  }, [announce, label, selectFullValue, value]);

  return (
    <button
      type="button"
      ref={buttonRef}
      className="wd-idbtn"
      // Published contract: the complete value, explicitly, for tests and for
      // anything that needs it without re-deriving the truncation.
      data-copy={value}
      data-copied={outcome === 'copied' ? 'true' : undefined}
      // A selection fallback is not a success. The check is reserved for a
      // clipboard write that actually returned (§3.2: never a check on failure).
      data-copy-failed={outcome === 'failed' || outcome === 'selected' ? 'true' : undefined}
      aria-label={`Copy ${label}`}
      aria-describedby={noteId}
      onClick={onCopy}
    >
      <span className="wd-id" ref={textRef} data-elided={elided ? 'yes' : 'no'} data-kind={kind}>
        <b>{head}</b>
        <span className="wd-id-mid">{mid}</span>
        <i>{tail}</i>
      </span>
      <span className="wd-id-mark">
        <CopyGlyph />
        <CheckGlyph />
      </span>
      {/* Not a live region (D30 permits exactly one, in the page header) — a
          description, so the outcome survives a re-read of the control.
          user-select:none keeps it out of a drag-selection of the row. */}
      <span className="sr-only wd-idbtn-note" id={noteId}>{note}</span>
    </button>
  );
}

/* =============================================================================
   3 · Sparkline — commitment-anchored micro history (§3.15)

   It does not plot latency. It plots DISTANCE FROM A DECLARED COMMITMENT:

       ratio = (v - good) / (fuse - good)

   One geometry, both directions, no branch. A recovery lane declaring
   {good:100, fuse:90} renders 60% at ratio 4.0 — clipped, capped, unmissable.
   Plotting v/fuse would have drawn 60% recovery as a short, calm column: a
   healthy render of a broken lane.

   Commitments this page can actually cite, all of them real budgets:
     · TRANSPORT_FUSE_MS = 10_000 — `web/src/lib/http.ts:77`, fetchJson's default
       bounded request lifetime. At that instant the request is aborted and
       there is no later.
     · `stats.loopLag.maxMs` — the supervisor's own published worst.
     · a component's own `maxAgeMs`.
   NO DEFAULT BAND, NO DEFAULT THRESHOLD. `commitment: null` omits the anchor,
   and an unanchored mark may not borrow an anchored one's authority.
   ========================================================================== */

/** The mark's own unit grid. CSS sizes the box from tokens (--sp-4 column,
 *  --sp-2 gap); these are the same numbers expressed as SVG user units, which
 *  are unitless by definition and cannot be a token. */
const COL_U = 8;
const GAP_U = 4;
const BOX_U = 20;
/** 18 plot units, the fuse at 12 of them (ratio 1.00), clip at 1.5x = 18. */
const HEADROOM_U = 2;
const FUSE_FRACTION = 12 / 18;
const RATIO_CLIP = 1.5;

export function Sparkline(props: {
  readonly samples: readonly (number | null)[];
  readonly commitment: { readonly good: number; readonly fuse: number } | null;
  readonly width?: number;
  readonly height?: number;
  readonly rung?: Rung;
}): JSX.Element | null {
  const { samples, commitment, width, height, rung } = props;

  // A non-finite sample is not a measurement; it is a gap. Never plotted, never
  // interpolated across — each column is its own rect, so a gap can no more be
  // bridged here than a broken line can be drawn through one.
  const measured = samples.map((s) => (s !== null && Number.isFinite(s) ? s : null));
  const present = measured.filter((s): s is number => s !== null);

  // A one-point sparkline is decoration: it shows no trend and invites one.
  if (present.length < 2) return null;

  const n = measured.length;
  const boxU = height ?? BOX_U;
  const plotU = Math.max(1, boxU - HEADROOM_U);
  const fuseU = plotU * FUSE_FRACTION;
  const spanU = width ?? n * (COL_U + GAP_U) - GAP_U;
  const advanceU = (spanU + GAP_U) / n;
  const colU = Math.max(1, advanceU - GAP_U);

  // A degenerate commitment (fuse === good) cannot scale anything; it is not a
  // commitment, and it silently becomes the unanchored mark rather than a
  // division by zero rendered as a flat, calm row.
  const anchored = commitment !== null && commitment.fuse !== commitment.good;
  const observedMax = present.reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);

  /** Fill mass is proof (§1.6, Law 2). Solid requires BOTH: a commitment to be
   *  measured against, and a posture the server actually published. An
   *  unanchored mark is hollow no matter how healthy the lane looks — §3.15 is
   *  explicit that it "may not borrow the commitment-scaled one's authority",
   *  and a mark normalised to its own observed max is the most flattering shape
   *  in this file: it always fills the box, whatever the numbers mean. */
  /* INTEGRATION FIX. This read `rung === 'absent'`, which typechecks against
     nothing: `absent` belongs to the §3.15 TONE vocabulary, not to StatusChip's
     `Rung`, so the comparison was always false and the branch it gated was
     dead — the mark was drawing SOLID for rungs that prove nothing. Repaired
     against the real vocabulary, in the conservative direction the comment
     already asks for: solid requires a posture the server actually PUBLISHED,
     so the three rungs that assert no proven posture stay hollow. */
  const unproven = rung === 'UNKNOWN' || rung === 'NOT_CONFIGURED' || rung === 'UNAVAILABLE';
  const hollow = !anchored || rung === undefined || unproven;
  const inset = hollow ? 0.5 : 0;

  const lastMeasuredIndex = (() => {
    for (let i = n - 1; i >= 0; i -= 1) if (measured[i] !== null) return i;
    return -1;
  })();
  const evidenceEnds = lastMeasuredIndex >= 0 && lastMeasuredIndex < n - 1;

  const style: CSSProperties = {
    ['--n' as string]: String(n),
    ...(width === undefined ? {} : { inlineSize: `${width}px` }),
    ...(height === undefined ? {} : { blockSize: `${height}px` }),
  };

  return (
    <svg
      className="wdspark"
      style={style}
      viewBox={`0 0 ${spanU} ${boxU}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      data-rung={rung}
      data-scale={anchored ? 'anchored' : 'unscaled'}
      /* INTEGRATION FIX, same defect as `hollow` above: the stylesheet was
         re-deriving proof from `[data-rung="absent"]`, a value this element
         never emits, so hollow styling was reachable only through the
         no-rung/unscaled branches. The verdict is computed ONCE, in JS, and
         published — CSS no longer carries a second copy of the vocabulary. */
      data-proof={hollow ? 'hollow' : 'solid'}
      /* The mark is never the only carrier: §3.15 requires the caller to print
         the current value beside it, and this page's Numeric does. */
      aria-hidden="true"
      focusable="false"
    >
      {measured.map((value, index) => {
        const x = index * advanceU;
        if (value === null) {
          // The slot exists and is unwritten: a half-width stub on the
          // baseline. It can never be mistaken for a measured zero, which is
          // full width. (A slot that predates the retention horizon should draw
          // nothing at all — the horizon is on no type today, §7 Q5, so this
          // renderer does not pretend to know one.)
          return (
            <rect
              key={index}
              className="wdspark-slot"
              x={x + colU / 4}
              y={boxU - 2}
              width={colU / 2}
              height={2}
            />
          );
        }
        const ratio = anchored && commitment !== null
          ? (value - commitment.good) / (commitment.fuse - commitment.good)
          : observedMax > 0
            ? value / observedMax
            : 0;
        const clipped = Math.max(0, Math.min(anchored ? RATIO_CLIP : 1, ratio));
        // Both scales measure against the SAME fuse height, so an unanchored
        // mark can never reach past it into the region that means "breach"
        // everywhere else on this page. That is not a chosen threshold: it is
        // the refusal to draw a breach nobody can prove. Only an anchored mark
        // may climb into the 1.5x clip zone, because only it has a fuse.
        // A measured value always draws at least a full-width unit, so a
        // measured zero reads as an answer and not as an absence.
        const h = Math.max(1, clipped * fuseU);
        const breach = anchored && ratio >= 1;
        const latest = index === lastMeasuredIndex;
        return (
          <rect
            key={index}
            className={`wdspark-col${latest ? ' is-latest' : ''}${breach ? ' is-breach' : ''}`}
            x={x + inset}
            y={boxU - h + inset}
            width={Math.max(0.5, colU - inset * 2)}
            height={Math.max(0.5, h - inset * 2)}
          />
        );
      })}

      {/* Warn is spent HERE and nowhere else on this mark: the instant after
          which nothing was measured. --warn already means "the evidence is
          old" one cell away, so spending it on burn rate would say two things
          with one hue. */}
      {evidenceEnds ? (
        <rect
          className="wdspark-evidence-end"
          x={lastMeasuredIndex * advanceU + colU}
          y={0}
          width={1}
          height={boxU}
        />
      ) : null}

      {/* Painted LAST, so a breaching column is visibly CUT by the line it
          broke. Burn thickens this 1 -> 2 units — burn windows are not on this
          component's props, so it is never thickened on a guess. */}
      {anchored ? (
        <rect className="wdspark-fuse" x={0} y={boxU - fuseU} width={spanU} height={1} />
      ) : null}
    </svg>
  );
}
