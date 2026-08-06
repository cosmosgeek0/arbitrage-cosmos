/* =============================================================================
   StatusChip — THE PAGE'S ONLY STATE VOCABULARY.

   Bible: §1.5 (ink), §1.6 (semantic colour), §3.1 (StatusChip), §3.12
   (UnknownState — the four scales of absence), §3.13 (EmptyState doctrine).
   Drift adjudications this file is bound by: D16 (amber IS degraded),
   D17 (a chip label is always --ink-1), D18 (--ok is a <=12px glyph, never a
   word, never a fill), D19 (the gutter is hueless), D24 (GrayText is the OS
   DISABLED colour and must never carry a reason), D37 (never an em dash as the
   sole carrier), D38 (three scales of absence), D39 (ONE vocabulary).

   WHAT THIS FILE OWNS, AND WHY NOBODY ELSE MAY RE-IMPLEMENT IT
   -------------------------------------------------------------------------
   1. The seven rungs and their words.
   2. STALE as an ORTHOGONAL MODIFIER. A component can be READY *and* STALE;
      forcing a choice makes either answer a lie.
   3. The eight glyph topologies. They are topologies, not colours: the ladder
      survives a monochrome screenshot and protanopia because severity is FILL
      MASS (bare -> tint -> solid, 2.8x light / 4.4x dark in BT.601 luma), and
      the glyph is a distinct SHAPE per rung on top of that.
   4. The mandatory-reason RUNTIME invariant, shipped in production. A chip in
      an adverse rung with no reason renders a hatched `data-defect="true"`
      chip carrying the words `Reason missing`. A missing reason is a VISIBLE
      defect, never a silent one.
   5. The four scales of absence: SLOT (AbsenceSlot), ROW/CELL (the chip's own
      word), COLUMN (AbsenceColumnNote), PANEL (AbsencePanel).
   6. The ONLY permitted mappers from a server enum to a rung.

   WHAT THIS FILE DELIBERATELY DOES NOT OWN
   -------------------------------------------------------------------------
   There is NO mapper from `observedLifecycle`, `capability` or `truthLabel`.
   `canonicalPresentation` / `canonicalCockpit` are server-owned display
   posture (server/src/productIntegration/runtime/types.ts:76-88 — "the browser
   may render this value or fail closed on transport continuity; it may not
   derive a replacement verdict from lifecycle/capability/truth fields").
   Deriving one here is the COMPONENT_CANONICAL_PRESENTATION_FALSE_GREEN
   defect. If you want a verdict, read the one the server published.

   NOT INTERACTIVE, BY DESIGN. This atom is not focusable and is not a button.
   An atom that looked clickable and did nothing is the exact dead affordance
   this page exists to remove.
   ========================================================================== */

import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { Lane, WatchmanStatus } from './watchdogEvidence';
import './StatusChip.css';

/* -------------------------------------------------------------------------
   THE SEVEN. There is no eighth, and `MISSING` is not one of them
   (BIBLE §7 open question 7 — it is currently rendered as NOT_CONFIGURED by
   the managed-inventory caller, with its own reason string).
   ---------------------------------------------------------------------- */
export type Rung =
  | 'READY'
  | 'DEGRADED'
  | 'BLOCKED'
  | 'UNAVAILABLE'
  | 'UNKNOWN'
  | 'NOT_CONFIGURED'
  | 'OWNER_GATED';

/* `data-rung` is an ATTRIBUTE, never a class — the i00 gate greps class tokens
   for `ok` / `live` / `ready` / `pass` on the machine indicator. */
type RungTone = 'ready' | 'warn' | 'blocked' | 'gated' | 'absent';

/* The eight topologies. Eight, not seven: STALE is a shape of its own because
   it is a modifier, not a rung. */
type GlyphKind =
  | 'ready'
  | 'degraded'
  | 'blocked'
  | 'unavailable'
  | 'unknown'
  | 'not-configured'
  | 'owner-gated'
  | 'stale';

/* Exhaustive over the ladder — `satisfies` makes an added rung a build error,
   not a silent fall-through to a healthy default. */
const RUNG_TONE = {
  READY: 'ready',
  DEGRADED: 'warn',
  BLOCKED: 'blocked',
  OWNER_GATED: 'gated',
  /* Unknown / unavailable / not-configured have NO hue: --ink-3 plus a
     mandatory reason (§1.6 rule 4). Green is earned; grey is honest. */
  UNAVAILABLE: 'absent',
  UNKNOWN: 'absent',
  NOT_CONFIGURED: 'absent',
} as const satisfies Record<Rung, RungTone>;

/* Ten labels, ten phrases (§3.17). `UNAVAILABLE` ("channel unavailable") is
   not `BLOCKED` ("evidence blocked"); `UNKNOWN` ("evidence class never
   established") is not `NOT_CONFIGURED` ("never installed"). A status is a
   VALUE, not a column head — so sentence case, not uppercase. */
const RUNG_LABEL = {
  READY: 'Ready',
  DEGRADED: 'Degraded',
  BLOCKED: 'Blocked',
  UNAVAILABLE: 'Unavailable',
  UNKNOWN: 'Unknown',
  /* PARITY, and it is load-bearing: the deleted Watchman rendered the server's
     `planned` as the word "Planned", which reads as an intention rather than
     as an absence of wiring. It renders NOT CONFIGURED here, and the word
     "Planned" appears nowhere on this page. */
  NOT_CONFIGURED: 'Not configured',
  OWNER_GATED: 'Owner gated',
} as const satisfies Record<Rung, string>;

const RUNG_GLYPH = {
  READY: 'ready',
  DEGRADED: 'degraded',
  BLOCKED: 'blocked',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
  NOT_CONFIGURED: 'not-configured',
  OWNER_GATED: 'owner-gated',
} as const satisfies Record<Rung, GlyphKind>;

/* The doctrine as a runtime invariant, not a review convention (§3.1, Law 3).
   READY is the only rung that may render without a reason, because READY is
   the only rung that is not making an excuse. */
const REASON_REQUIRED: ReadonlySet<Rung> = new Set<Rung>([
  'DEGRADED',
  'BLOCKED',
  'UNAVAILABLE',
  'UNKNOWN',
  'NOT_CONFIGURED',
  'OWNER_GATED',
]);

/* An empty string, an empty fragment and an empty array are all "no reason".
   A caller that passes `reason={''}` has supplied silence, and silence is the
   most complete form of the lie on an evidence-gated surface. */
function hasReason(reason: ReactNode): boolean {
  if (reason === null || reason === undefined || reason === false || reason === true) return false;
  if (typeof reason === 'string') return reason.trim().length > 0;
  if (typeof reason === 'number') return true;
  if (Array.isArray(reason)) return reason.some((entry) => hasReason(entry as ReactNode));
  return true;
}

/* -------------------------------------------------------------------------
   THE GLYPH TOPOLOGIES
   12px, on the 12x12 grid, centre (6,6). Every one is a different SHAPE, so
   the eight are separable with hue removed entirely. `aria-hidden` because the
   label beside it is the accessible text — a glyph that also announced itself
   would double every state word for a screen-reader user.
   ---------------------------------------------------------------------- */
function ChipGlyph({ kind }: Readonly<{ kind: GlyphKind }>) {
  return (
    <svg
      className="wd-chip-glyph"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      {kind === 'ready' ? (
        /* CLOSED AND FILLED — the only complete shape in the set. */
        <circle cx="6" cy="6" r="4" fill="currentColor" />
      ) : null}

      {kind === 'degraded' ? (
        /* HALF-FILLED — proven, but only in part. */
        <>
          <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M1.75 6 A4.25 4.25 0 0 0 10.25 6 Z" fill="currentColor" />
        </>
      ) : null}

      {kind === 'blocked' ? (
        /* BARRED THROUGH — the prohibition topology. */
        <>
          <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 9 L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : null}

      {kind === 'unavailable' ? (
        /* SEVERED — two arcs with the channel missing top and bottom. */
        <>
          <path
            d="M6.74 1.81 A4.25 4.25 0 0 1 6.74 10.19"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M5.26 1.81 A4.25 4.25 0 0 0 5.26 10.19"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      ) : null}

      {kind === 'unknown' ? (
        /* SIX DOTS — the outline of a reading that was never taken. */
        <>
          <circle cx="6" cy="2" r="0.95" fill="currentColor" />
          <circle cx="9.46" cy="4" r="0.95" fill="currentColor" />
          <circle cx="9.46" cy="8" r="0.95" fill="currentColor" />
          <circle cx="6" cy="10" r="0.95" fill="currentColor" />
          <circle cx="2.54" cy="8" r="0.95" fill="currentColor" />
          <circle cx="2.54" cy="4" r="0.95" fill="currentColor" />
        </>
      ) : null}

      {kind === 'not-configured' ? (
        /* AN EMPTY SLOT — square, so it is topologically unlike every ring in
           the set even at 12px and even in greyscale. */
        <rect
          x="2.25"
          y="2.25"
          width="7.5"
          height="7.5"
          rx="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2.2 2"
        />
      ) : null}

      {kind === 'owner-gated' ? (
        /* A GATE — closed, but by a person, not by a fault. */
        <>
          <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3.1 6 L8.9 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : null}

      {kind === 'stale' ? (
        /* A CLOCK — the reading exists; the clock is what failed. */
        <>
          <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M6 6 L6 3.5 M6 6 L8.1 7.05"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
    </svg>
  );
}

/* -------------------------------------------------------------------------
   StatusChip
   ---------------------------------------------------------------------- */
export function StatusChip({
  state,
  stale = false,
  label,
  reason,
  size = 'row',
}: Readonly<{
  /** MUST originate from a server field, through one of the mappers below.
   *  `undefined` resolves to UNKNOWN — there is NO null render path, because
   *  an empty gutter is indistinguishable from a chip that failed to render. */
  state?: Rung;
  /** Orthogonal to the rung. Demotes READY only; a proven failure does not soften. */
  stale?: boolean;
  /** The server's own word, when it published one (`statusLabel`). */
  label?: string;
  /** Real DOM text, in reading order. Never a title, never a tooltip. */
  reason?: ReactNode;
  size?: 'row' | 'band';
}>): JSX.Element {
  const rung: Rung = state ?? 'UNKNOWN';

  /* THE STALE RULE, and it has exactly two branches.
     stale + READY   -> tone `absent`, glyph STALE, label "Stale", reason
                        mandatory. A frozen success cannot stay green.
     stale + ANY OTHER -> unchanged rung, unchanged word, unchanged fill; the
                        staleness rides as a dashed lower edge (no reflow, no
                        hue, no size change — Law 11) plus sr-only text. A
                        proven failure does not soften, and a stale BLOCKED is
                        still BLOCKED.

     The dashed edge on the second branch is a deliberate addition to the
     letter of "unchanged", and it is defensible on the doctrine: dropping the
     stale signal entirely for non-READY rungs would make a stale DEGRADED
     pixel-identical to a fresh one, which is a currency claim the evidence
     does not support. It softens nothing — no hue, no fill change, no word
     change — it only refuses to let an old reading pass as a new one. */
  const demoted = stale && rung === 'READY';
  const tone: RungTone = demoted ? 'absent' : RUNG_TONE[rung];
  const glyph: GlyphKind = demoted ? 'stale' : RUNG_GLYPH[rung];
  const word: string = demoted ? 'Stale' : (label ?? RUNG_LABEL[rung]);

  /* READY is the only rung exempt, and a demoted READY is no longer READY. */
  const reasonRequired = demoted || REASON_REQUIRED.has(rung);
  const reasonGiven = hasReason(reason);
  const defect = reasonRequired && !reasonGiven;

  useEffect(() => {
    if (!defect) return;
    /* Law 3: the hatched tone in production, PLUS a dev console error. The
       chip cannot repair itself; it can only refuse to look clean. */
    console.error(
      `[watchdog] StatusChip REASON_REQUIRED:${demoted ? 'STALE' : rung} rendered with no reason. `
        + `Every adverse state carries its reason as real DOM text in reading order.`,
    );
  }, [defect, demoted, rung]);

  return (
    <span className="wd-chip-slot" data-size={size}>
      <span
        className="wd-chip"
        data-rung={tone}
        data-stale={stale ? 'true' : undefined}
        data-defect={defect ? 'true' : undefined}
      >
        <ChipGlyph kind={glyph} />
        <span className="wd-chip-label">{word}</span>
        {stale && !demoted ? <span className="sr-only"> (stale)</span> : null}
      </span>

      {reasonGiven ? (
        <span className="wd-chip-reason">{reason}</span>
      ) : null}

      {defect ? (
        /* Not a placeholder and not a shrug: it names the invariant that was
           broken and the rung that broke it, in words an operator can paste
           into a ticket. It is styled as TRUTH (--ink-2), never as disabled. */
        <span className="wd-chip-reason">
          Reason missing — this chip is a defect.{' '}
          <code className="wd-id">REASON_REQUIRED:{demoted ? 'STALE' : rung}</code>
        </span>
      ) : null}
    </span>
  );
}

/* =============================================================================
   THE MAPPERS — the only permitted routes from a server enum to a rung.
   Each is total over its input union, checked by `satisfies`, so a new server
   member is a BUILD failure rather than a silent fall-through to READY.
   ========================================================================== */

/** `ProductRuntimeWatchmanStatus` (types.ts:76) -> rung.
 *  `planned` is NOT_CONFIGURED: the wiring does not exist yet, which is an
 *  absence of evidence, not a degraded reading. See RUNG_LABEL above. */
export function rungFromWatchmanStatus(status: WatchmanStatus): Rung {
  const table = {
    operational: 'READY',
    degraded: 'DEGRADED',
    outage: 'BLOCKED',
    planned: 'NOT_CONFIGURED',
  } as const satisfies Record<WatchmanStatus, Rung>;
  return table[status];
}

/** `ProductDependencyEdgeProjection.state` (model.ts:513) -> rung.
 *  There is no `NOT_CONFIGURED` edge: an edge the server did not publish is
 *  absent from the array, and absence is the caller's sentence to write. */
export function rungFromEdgeState(state: 'AVAILABLE' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN'): Rung {
  const table = {
    AVAILABLE: 'READY',
    DEGRADED: 'DEGRADED',
    BLOCKED: 'BLOCKED',
    UNKNOWN: 'UNKNOWN',
  } as const satisfies Record<typeof state, Rung>;
  return table[state];
}

/** A read lane -> the rung its EVIDENCE supports, plus the lane's own reason.
 *
 *  `proven` is what the lane's value proves when the lane is CURRENT, and it is
 *  REQUIRED. It used to be optional, defaulting to READY — which meant that on
 *  an evidence-gated page any caller who forgot the second argument received a
 *  green chip for free, at runtime, with no `satisfies` gate behind it to catch
 *  it. For a lane whose mere arrival IS the proof (the browser probe, the
 *  transport drain) the caller passes `'READY'` explicitly, which is a stated
 *  claim rather than a silent fall-through.
 *
 *  RETURNS `stale` as well as `{rung, reason}`, because the rung alone cannot
 *  carry it: a STALE lane over a READY value is still READY *and* stale, and
 *  collapsing that into one enum is the lie §3.1 names explicitly. Destructure
 *  `{ rung, reason }` and it behaves exactly as declared.
 */
export function rungFromLane<T>(
  lane: Lane<T>,
  proven: Rung,
): { readonly rung: Rung; readonly reason: string | null; readonly stale: boolean } {
  /* The Lane contract guarantees a non-null reason whenever state !== CURRENT.
     If one is missing the contract itself is broken, and the chip must say so
     rather than render a clean UNKNOWN over a broken producer. */
  const stated = (fallback: string): string => lane.reason ?? `LANE_REASON_MISSING:${fallback}`;

  if (lane.state === 'CURRENT') {
    return { rung: proven, reason: lane.reason, stale: false };
  }
  if (lane.state === 'LOADING') {
    /* Never a healthy default while a read is outstanding, and never a
       skeleton that resolves to green on arrival. */
    return { rung: 'UNKNOWN', reason: stated('LOADING'), stale: false };
  }
  if (lane.state === 'STALE') {
    /* The value is real; the clock is what failed. Rung is preserved so a
       stale BLOCKED does not soften into a stale UNKNOWN. */
    return { rung: proven, reason: stated('STALE'), stale: true };
  }
  return { rung: 'UNAVAILABLE', reason: stated('UNAVAILABLE'), stale: false };
}

/** `ProductRuntimeControlWiringState` (types.ts:593-594) -> rung.
 *
 *  The union is `'WIRED_LIVE' | 'UNAVAILABLE:${string}' | 'PENDING_BACKEND:${string}'
 *  | 'OWNER_GATED'`, so the blocker travels INSIDE the string after the colon.
 *  That suffix is the server's own words and is returned verbatim as the reason.
 *
 *  `OWNER_GATED` deliberately returns a NULL reason: the wiring state carries
 *  none, and the caller holds `control.disabledReason`. A caller that forgets
 *  to pass it gets a visibly hatched chip — which is the invariant working, not
 *  a gap. Inventing a reason here would hide exactly that.
 */
export function rungFromWiringState(
  wiringState: string,
): { readonly rung: Rung; readonly reason: string | null } {
  if (wiringState === 'WIRED_LIVE') return { rung: 'READY', reason: null };
  if (wiringState === 'OWNER_GATED') return { rung: 'OWNER_GATED', reason: null };

  const colon = wiringState.indexOf(':');
  const head = colon === -1 ? wiringState : wiringState.slice(0, colon);
  const blocker = colon === -1 ? '' : wiringState.slice(colon + 1).trim();

  if (head === 'UNAVAILABLE' || head === 'PENDING_BACKEND') {
    /* An empty suffix is a malformed wiring state, not an absent blocker —
       report the raw value rather than an empty reason line. */
    return { rung: 'UNAVAILABLE', reason: blocker.length > 0 ? blocker : `${head}:` };
  }
  return { rung: 'UNKNOWN', reason: `WIRING_STATE_UNRECOGNISED:${wiringState}` };
}

/* =============================================================================
   THE OTHER THREE SCALES OF ABSENCE (§3.12, D38)
   ROW/CELL scale is the chip above. These are SLOT, COLUMN and PANEL.
   ========================================================================== */

/** SLOT — three treatments, zero words. The words live in `srLabel`, which is
 *  mandatory: a dash alone is read by NVDA as nothing at all, and on an
 *  evidence-gated surface silence is the most complete form of the lie (D37).
 *
 *  `none` — a MEASURED EMPTY SET. A complete answer, so it takes the host's own
 *           value register with no demotion: the measured zero, at full ink.
 *  `void` — the slot exists and has not been written. 3ch dotted hairline.
 *  `na`   — NOT APPLICABLE, and the ONLY visually blank state on the page —
 *           the exact inversion of what ships everywhere else.
 *
 *  3ch is deliberately narrower than any real value, so a rule can never imply
 *  a magnitude, and it is identical in every column, so the page's blindness
 *  reads as a countable grid instead of as noise.
 */
export function AbsenceSlot({
  kind,
  srLabel,
}: Readonly<{
  kind: 'none' | 'void' | 'na';
  /** The words. MANDATORY — this is the whole point of the element: the mark
   *  carries the treatment and this carries the meaning. Pass the server's
   *  reason code or a sentence containing it, e.g. `NOT_MEASURED`,
   *  `CADENCE_NOT_PUBLISHED`, `NO_MEMBER_OBSERVATION`. */
  srLabel: string;
}>): JSX.Element {
  return (
    <span className={`wd-abs st-${kind}`} data-abs={kind}>
      {kind === 'none' ? (
        <span className="wd-num" aria-hidden="true">
          0
        </span>
      ) : null}
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}

/* The phrase a whole column earns when every one of its slots is the same kind.
   Unknown keys render verbatim rather than being coerced into a friendlier
   word — a reason code the operator can grep beats a sentence I invented. */
function absencePhrase(kind: string): string | null {
  switch (kind) {
    case 'void':
    case 'UNKNOWN':
      return 'Not measured';
    case 'na':
      return 'Not applicable';
    case 'none':
      return 'Measured zero';
    case 'UNAVAILABLE':
      return 'No proof';
    case 'NOT_CONFIGURED':
      return 'Not configured';
    case 'OWNER_GATED':
      return 'Owner gated';
    case 'DEGRADED':
      return 'Degraded';
    case 'BLOCKED':
      return 'Blocked';
    /* A column that is 100% READY is not an absence. It gets no note, because
       a note here would be a second, quieter place to claim health. */
    case 'READY':
      return null;
    default:
      return kind;
  }
}

/** COLUMN — the second line a `columnheader` grows when 100% of its primary
 *  slots are one kind: `Not measured · all 15`.
 *
 *  100% OR SILENCE. A header claiming "unavailable" while 14 of 15 rows are
 *  dark lies about the fifteenth, so the caller computes the unanimity and this
 *  renders nothing without a population to print.
 *
 *  The mechanism is why this page has no tooltip and no drawer for absence: in
 *  `role="table"` assistive tech re-announces the column header with every
 *  cell, so all N dark cells inherit their reason with zero extra DOM, zero
 *  ARIA and zero interaction.
 */
export function AbsenceColumnNote({
  kind,
  population,
}: Readonly<{ kind: string; population: number }>): JSX.Element | null {
  if (!Number.isFinite(population) || population < 1) return null;
  const phrase = absencePhrase(kind);
  if (phrase === null) return null;
  return (
    <span className="wd-abs-colnote">
      {phrase} · all <span className="wd-num">{population}</span>
    </span>
  );
}

/** PANEL — the largest scale of absence. Its subject is not the missing data
 *  but what this region promised to measure, what that costs while it cannot,
 *  and on what evidence the claim rests.
 *
 *  Reading order is fixed: KIND -> HEADLINE -> CONSEQUENCE -> EVIDENCE.
 *  `rows` declares the height in row atoms so the panel occupies the space the
 *  data would have, and the page does not reflow when the data returns.
 *
 *  `role="status"` and deliberately NOT `aria-live`: a dozen simultaneous
 *  announcements during a wide outage is a flood, and a flood is silence.
 *  No illustration, ever. Left-aligned, never centred — centring an absence
 *  turns a measurement failure into a decorative moment.
 */
export function AbsencePanel({
  kind,
  headline,
  consequence,
  evidence,
  rows,
}: Readonly<{
  kind: string;
  headline: string;
  consequence: string;
  evidence: string;
  rows: number;
}>): JSX.Element {
  const declaredRows = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 1;
  return (
    <div
      className="wd-abs-panel"
      role="status"
      data-kind={kind}
      style={{ '--wd-abs-rows': declaredRows } as CSSProperties}
    >
      <p className="wd-abs-panel-kind">{absencePhrase(kind) ?? kind}</p>
      <p className="wd-abs-panel-headline">{headline}</p>
      <p className="wd-abs-panel-consequence">{consequence}</p>
      <p className="wd-abs-panel-evidence">{evidence}</p>
    </div>
  );
}
