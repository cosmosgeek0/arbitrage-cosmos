import type { JSX, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { ArrowLeftRight, Brain, Newspaper, Shield, Wifi } from 'lucide-react';
import {
  SAFE_LIVE_BACKEND_COMMAND_IDS,
  type ProductComponentProjection,
  type ProductControlRegistryEntry,
  type ProductTruthLabel,
} from '../../lib/productIntegration';
import { StatusChip, type Rung } from './StatusChip';
import { Numeric, ageParts } from './MachineValue';
import {
  knownFact,
  notApplicable,
  unknownFact,
  type Fact,
  type MaterialContinuity,
  type OwnerFact,
  type WatchmanGroup,
} from './watchdogEvidence';
import './OwnerRow.css';

/* =============================================================================
   OwnerRow — the one dense row type, used by every section of the owner ledger.

   OPERATOR QUESTION, and it is five questions in one glance:
     what is it · what state is it in · how old is that reading ·
     is it ADVANCING or merely heartbeating · can I do anything from here.

   IT DERIVES NO HEALTH VERDICT. `fact.state`, `fact.statusLabel` and
   `fact.reason` are server-owned display posture, already evidence-gated by
   watchdogEvidence (§3.17 / law L6: `READY && truthClass !== 'proven'` collapses
   to UNKNOWN upstream of the renderer, and a non-PROVEN material continuity has
   already forced every canonical owner to outage). There is no mapper here from
   lifecycle, capability or truthLabel to a tone. The ONE thing this file decides
   is whether an ACTION IS LEGAL, and every branch of that decision is a
   published server field or a published posture function — never a guess.

   COMPOSES, RE-IMPLEMENTS NOTHING (§3.0):
     StatusChip    every state word, rung, glyph, the STALE modifier and the
                   mandatory-reason runtime invariant.
     MachineValue  the character grid and the reserved numeric/age tracks, so
                   this row's two numbers land on the page's shared right edge.
     watchdogEvidence  the Fact envelope and the operator clock.

   §17 ITEM 10, THE REPAIR THIS ROW EXISTS FOR. The deleted Connection Watchman
   declared `resetTarget`, read it at four call sites, and NO PRODUCER EVER
   ASSIGNED IT — so every row in the shipped modal rendered
   `<span className="watchman-component-spacer" />`: an unstyled empty box where
   an action had been promised. Here the action cell is BOUND or it states, in
   the server's own words, why it is not. It is never both, and it is never
   blank.
   ========================================================================== */

/* ---- the OwnerFact surface this row reads --------------------------------
   Narrowed and identity-typed, the same idiom OwnerEvidence uses: if the frozen
   producer type drifts, the gap surfaces as ONE named error here instead of as
   scattered property errors through the render tree.

   `component` is the real `ProductComponentProjection`, so every register field
   below is a verified server field rather than an assumed name. It is null for
   the three locally-owned owners (browser-session, binance-account, aws-runner)
   and for any SYSTEM_COMPONENT_IDS member the supervisor did not report — and
   for exactly those rows `detail` carries the producer's own sentence. */
export interface OwnerRowFactSurface {
  readonly id: string;
  readonly label: string;
  readonly group: WatchmanGroup;
  /** True when a SYSTEM_COMPONENT_IDS member is absent from snapshot.components. */
  readonly absent: boolean;
  /** Server-owned posture, already gated. Never re-derived here. */
  readonly state: Rung;
  readonly stale: boolean;
  readonly statusLabel: string;
  /** NON-NULL for every adverse state. The chip enforces it at runtime. */
  readonly reason: string | null;
  /** The producer's own sentence for a row that has no server projection. */
  readonly detail: string;
  /** Parity `WatchmanComponent.updatedAt`: lastAdvanceAtMs ?? heartbeatAtMs. */
  readonly observedAtMs: number | null;
  /** Parity `WatchmanComponent.latencyMs` — §18: read by every old row, rendered by none. */
  readonly latencyMs: number | null;
  readonly component: Readonly<ProductComponentProjection> | null;
}

export const ownerRowFactSurface = (fact: OwnerFact): OwnerRowFactSurface => fact;

/* ---- the column contract -------------------------------------------------
   Published so the ledger renders ONE <colgroup> and ONE <thead> this row is
   guaranteed to fill.

   §4.3: the left gutters are shared by every table on the page and THE AGE
   TRACK IS LAST, so every evidence age on the page terminates on the single
   page gutter. The action track therefore sits BEFORE the two numeric tracks —
   putting it after would inset the age column and break law L18, which is the
   entire reason this page has no cards.

   §3.17's five-track CSS grid is superseded here by D33 (native <table> +
   <colgroup> + `table-layout: fixed`): `display: grid` on a <tr> gives every
   row its own formatting context, so "right-aligned on a numeric column"
   degrades to right-aligned inside N differently-sized boxes and L5 evaporates.

   INTEGRATION NOTE: the ledger currently declares six columns and no action
   column. This row needs seven — its fourth column is the action cell §9
   requires and §17 item 10 exists to repair. `columnCount` is accepted as a
   prop so the expansion's colSpan always follows the ledger's own colgroup and
   the two can never silently disagree. */
export const OWNER_ROW_COLUMNS = Object.freeze([
  Object.freeze({ id: 'mark', head: '', width: 'var(--gutter-mark)', numeric: false }),
  Object.freeze({ id: 'glyph', head: '', width: 'var(--gutter-icon)', numeric: false }),
  Object.freeze({ id: 'owner', head: 'Owner', width: 'auto', numeric: false }),
  Object.freeze({ id: 'state', head: 'State', width: '26ch', numeric: false }),
  Object.freeze({ id: 'action', head: 'Action', width: '22ch', numeric: false }),
  Object.freeze({ id: 'lag', head: 'Lag ms', width: 'var(--col-num)', numeric: true }),
  Object.freeze({ id: 'age', head: 'Proof age', width: 'var(--col-age)', numeric: true }),
] as const);

export const OWNER_ROW_COLUMN_COUNT = OWNER_ROW_COLUMNS.length;

const SUPERVISOR_SOURCE = 'GET /api/product-integration/v1/supervisor · components[]';

/* ---- the register --------------------------------------------------------
   §3.17: capability is a NOUN VALUE, truth is a PREPOSITIONAL ATTESTATION.
   `ProductCapability` and `ProductTruthLabel` share the member `LIVE_PUBLIC`,
   so without this split two adjacent cells read "Live public · Live public" and
   no column width in the world can fix it. Ten labels, ten phrases, all
   hueless — and four of them are the bible's own words: MISSING is "evidence
   expected, absent" and is NOT UNKNOWN ("evidence class never established");
   UNAVAILABLE is "channel unavailable" and is NOT BLOCKED ("evidence blocked").
   `satisfies` makes a new ProductTruthLabel member a build error rather than a
   silent blank. */
const TRUTH_ATTESTATION = {
  LIVE_PUBLIC: 'on live public evidence',
  WIRED: 'on wired evidence',
  BUILT_AND_TESTED: 'on built-and-tested evidence',
  IMPORTED: 'on imported evidence',
  SYNTHETIC_ONLY: 'on synthetic evidence only',
  BLOCKED: 'with evidence blocked',
  NOT_CONFIGURED: 'with no evidence configured',
  UNAVAILABLE: 'with the evidence channel unavailable',
  MISSING: 'with evidence expected and absent',
  UNKNOWN: 'with evidence class never established',
} satisfies Record<ProductTruthLabel, string>;

/** Parity with the deleted modal: the same five groups, the same glyph each.
 *  The gutter is `--ink-3` ALWAYS (law L19, §1.6 rule 2). Colouring it is what
 *  previously put `--ok` and `--warn` 0.3 Lc apart in dark — one state, in
 *  greyscale and under protanopia. */
const GROUP_GLYPH = {
  control_path: Wifi,
  binance: ArrowLeftRight,
  bot: Brain,
  sources: Newspaper,
  infrastructure: Shield,
} satisfies Record<WatchmanGroup, typeof Wifi>;

const GROUP_GLYPH_LABEL = {
  control_path: 'Control path',
  binance: 'Binance',
  bot: 'Bot runtime',
  sources: 'Source network',
  infrastructure: 'Infrastructure',
} satisfies Record<WatchmanGroup, string>;

/** Enum → sentence case. A pure string transform, not a verdict. */
function enumWords(value: string): string {
  const spaced = value.replaceAll('_', ' ').replaceAll('-', ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/* ---- the age, decomposed for the character grid ---------------------------
   §3.18's age law: ONE unit, INTEGER, max 3 digits. Never `1h 04m` — mixed
   units put the unit glyph at three different x positions, so the column
   right-aligns and is STILL unreadable as a column, which is the exact failure
   L5 exists to prevent.

   COLLAPSED AT INTEGRATION. This file used to carry its own copy of the ladder,
   one of four on the page (Law 5 wants one). The implementation now lives in
   MachineValue, which already owns the reserved `age` track these numbers sit
   on and which this file already imports — so there is no cycle and no second
   ladder that can drift. The named export stays, because it is this row's
   published surface and its callers should not have to care where the ladder
   moved to. */
export { ageParts };

/* ---- the advance predicate ------------------------------------------------
   §3.4 / D31. Polarity is INVERTED: the expected case renders NOTHING, so on a
   healthy wall this gutter is empty and a wedged writer is the only object in
   it. The change mark it replaced failed the other way — present on nearly
   every row every poll (wallpaper), and silent forever exactly when a writer
   wedged, which is the most urgent event on the wall.

   Every branch below is a NULL READ or a published enum. The bible's full
   predicate ("advance older than 3 × p50 of this row's own 21-sample cadence")
   needs a cadence ring this row is not the owner of; where that ring is not
   published, this file renders NO MARK AND NO CLAIM rather than inventing a
   threshold, because a designer-chosen threshold where the data can measure one
   is law L1's first sentence. `OWNER_MEANINGFUL_ADVANCE_REQUIRED`
   (model.ts:2266) is the domain invariant this renders as ink. */
/* `unflagged` is NOT a claim that the component is advancing — it is the
   absence of a wedge signal, and it deliberately renders nothing at all. Naming
   this branch `advancing` would have written a verdict into the DOM that the
   data does not support, which is law L1 with a data attribute instead of a
   pixel. */
type AdvanceKind = 'unflagged' | 'wedged' | 'clock-skewed' | 'no-projection';

function readAdvance(component: Readonly<ProductComponentProjection> | null): Readonly<{
  kind: AdvanceKind;
  sentence: string | null;
}> {
  if (component === null) return { kind: 'no-projection', sentence: null };
  if (component.freshnessState === 'CLOCK_SKEWED') {
    return { kind: 'clock-skewed', sentence: 'Clock skewed — advance not computable' };
  }
  if (component.heartbeatAtMs !== null && component.lastAdvanceAtMs === null) {
    // The heartbeat is being written and the work has never advanced. A pure
    // non-null / null read: no threshold, no window, nothing chosen here.
    return { kind: 'wedged', sentence: 'Heartbeat present, no advance ever recorded' };
  }
  return { kind: 'unflagged', sentence: null };
}

/* ---- the action decision --------------------------------------------------
   Ordered so the most fundamental precondition is reported first: a control
   read off an unproven cut cannot be trusted enough to arm, whatever the
   registry entry says about itself. */
/* DELETED: the `refresh` action kind, its `refreshTarget` input, the button it
   rendered and the `onRunRefresh` prop chain behind it. No server publishes a
   component -> canonical-refresh-target mapping, so the input was hardcoded
   `null` on every row and the branch could never be taken. A branch that cannot
   be reached is the same defect as a button that calls nothing; the honest
   removal is the branch, not a permanently-off gate. Refresh is reached through
   the recovery console, which owns POST /api/refresh and renders its reply. */
type OwnerAction =
  | Readonly<{ kind: 'control'; controlId: string; label: string }>
  | Readonly<{ kind: 'refused'; code: string; sentence: string }>
  | Readonly<{ kind: 'none' }>;

function planAction(input: Readonly<{
  control: ProductControlRegistryEntry | null;
  continuity: MaterialContinuity;
  supportedControlIds: readonly string[];
}>): OwnerAction {
  const { control, continuity, supportedControlIds } = input;

  if (control !== null) {
    if (continuity !== 'PROVEN') {
      return {
        kind: 'refused',
        code: `MATERIAL_CONTINUITY_${continuity}`,
        sentence: 'The envelope cut is not proven, so no control may be armed against it.',
      };
    }
    if (control.disabledReason !== null) {
      // The server's own words, verbatim. Never a paraphrase, never a summary.
      return { kind: 'refused', code: 'CONTROL_DISABLED', sentence: control.disabledReason };
    }
    if (control.wiringState !== 'WIRED_LIVE') {
      return {
        kind: 'refused',
        code: `CONTROL_${control.wiringState}`,
        sentence: 'No live backend command is bound to this control.',
      };
    }
    if (!SAFE_LIVE_BACKEND_COMMAND_IDS.includes(control.backendCommandId)) {
      // The server allowlist contains PIN_FOCUS and the web allowlist
      // deliberately does not. Widening it is outside this file's authority, so
      // `attention.focus.*` renders the refusal and no control.
      return {
        kind: 'refused',
        code: 'COMMAND_OUTSIDE_IP_CONTROL_NON_MONEY_ALLOWLIST',
        sentence: `${control.backendCommandId} is outside the web allowlist for live non-money commands.`,
      };
    }
    return { kind: 'control', controlId: control.controlId, label: control.label };
  }

  if (supportedControlIds.length > 0) {
    // A discrepancy, not an absence: the component declares a control the
    // published registry does not carry. Worth a sentence — an operator would
    // otherwise hunt for a control that is not there.
    return {
      kind: 'refused',
      code: 'CONTROL_NOT_IN_REGISTRY',
      sentence: `Declared control ${supportedControlIds.join(', ')} is absent from the published registry.`,
    };
  }

  return { kind: 'none' };
}

/* ---- expansion guards ----------------------------------------------------- */

const INTERACTIVE_WITHIN_ROW =
  'a,button,input,select,textarea,summary,[role="button"],[data-no-expand="true"]';

function fromInteractiveChild(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_WITHIN_ROW) !== null;
}

/** This page exists so an operator can paste evidence into an incident ticket.
 *  Collapsing the row out from under a drag-selection destroys exactly that. */
function isSelectingText(): boolean {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  return selection !== null && !selection.isCollapsed && selection.toString().trim() !== '';
}

/* ---------------------------------------------------------------- component */

export function OwnerRow(props: {
  readonly fact: OwnerFact;
  readonly nowMs: number;
  readonly continuity: MaterialContinuity;
  readonly control: ProductControlRegistryEntry | null;
  readonly expanded: boolean;
  readonly focused: boolean;
  readonly onExpand: (id: string) => void;
  readonly onFocus: (id: string) => void;
  readonly onFocusControl: (controlId: string) => void;
  /** The ledger's own colgroup width, so the expansion's colSpan cannot drift. */
  readonly columnCount?: number;
  readonly children?: ReactNode;
}): JSX.Element {
  const {
    nowMs, continuity, control, expanded, focused,
    onExpand, onFocus, onFocusControl, children,
  } = props;

  const fact = ownerRowFactSurface(props.fact);
  const component = fact.component;
  const columnCount = props.columnCount ?? OWNER_ROW_COLUMN_COUNT;

  const advance = readAdvance(component);
  const Glyph = GROUP_GLYPH[fact.group];

  const action = planAction({
    control,
    continuity,
    supportedControlIds: component?.supportedControlIds ?? [],
  });

  /* THE CLOCK. `nowMs` is the hook's single 1000ms tick. Nothing here reads
     Date.now(), and nothing here reads the snapshot's own evaluatedAtMs —
     passing the snapshot its own timestamp made every age read `0s ago`
     forever, so a wedged supervisor serving its last cut was indistinguishable
     from a live one (web/test/productControlRoom/dashboard-age-clock.test.mjs). */
  const observedAtMs = fact.observedAtMs;
  const age = observedAtMs === null ? null : ageParts(Math.max(0, nowMs - observedAtMs));
  /* The unit track is a GEOMETRIC RESERVATION, not a claim: `Numeric`'s unknown
     branch renders no unit text at all, it only sizes the track from the
     string's length. All four age units are one character, so reserving with
     any of them puts the dotted rule of an unwritten slot on exactly the same x
     as the digits of a written one — which is the whole point of §3.12's
     countable grid. Reserving 0ch instead would shift every dark age cell two
     characters right of the column it belongs to. */
  const ageUnit = age?.unit ?? 's';
  const ageFact: Fact<number> = age === null
    ? unknownFact<number>(
      fact.absent
        ? 'COMPONENT_ABSENT — the supervisor did not report this component, so nothing about it has been measured.'
        : 'NO_PROOF_INSTANT — this owner has published neither an advance nor a heartbeat.',
      `${SUPERVISOR_SOURCE} · observedAtMs`,
    )
    : knownFact(age.value, `${SUPERVISOR_SOURCE} · observedAtMs`, observedAtMs);

  const lagFact: Fact<number> = component === null
    ? (fact.absent
      ? unknownFact<number>('COMPONENT_ABSENT — no projection was reported for this component.', `${SUPERVISOR_SOURCE} · processingLagMs`)
      : notApplicable<number>(`${SUPERVISOR_SOURCE} · processingLagMs`))
    : component.processingLagMs === null
      ? unknownFact<number>('PROCESSING_LAG_UNPUBLISHED — the supervisor published no processing lag for this component.', `${SUPERVISOR_SOURCE} · processingLagMs`)
      : knownFact(component.processingLagMs, `${SUPERVISOR_SOURCE} · processingLagMs`, observedAtMs);

  /* "RTT" is a ROUND TRIP, and only the locally-owned browser row measures one
     (the hook fills its `latencyMs` from the liveness probe). For a supervisor
     component `latencyMs` IS `processingLagMs` — the identical number already
     rendered one cell to the right under the honest heading "Lag ms" — so
     printing it a second time under the word RTT put two labels on one
     measurement and got one of them wrong. The phrase is now withheld for any
     row that carries a server projection. */
  const latencyFact: Fact<number> | null = component !== null || fact.latencyMs === null
    ? null
    : knownFact(fact.latencyMs, 'browser liveness probe · round-trip time', observedAtMs);

  /* A root cause that IS this row is this row: the solid BLOCKED chip already
     says so (§3.17 root-cause deduplication — one alarm, N attributions, and
     the N are physically incapable of shouting because their tone has no fill).
     Only the downstream attribution earns a line, and it is a working control,
     not a caption. */
  const upstreamId = component !== null
    && component.rootCauseComponentId !== null
    && component.rootCauseComponentId !== fact.id
    ? component.rootCauseComponentId
    : null;

  const handleClick = (event: MouseEvent<HTMLTableRowElement>): void => {
    if (fromInteractiveChild(event.target)) return;
    if (isSelectingText()) return;
    onExpand(fact.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>): void => {
    // ArrowUp/Down/Home/End belong to the table's roving-tabindex model in
    // WatchdogSurface (§4.7: one tab stop per table, and never zero). They must
    // bubble untouched, so this handler answers only for the row itself.
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onExpand(fact.id);
      return;
    }
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      onExpand(fact.id);
    }
  };

  return (
    <>
      <tr
        role="row"
        aria-level={2}
        aria-expanded={expanded}
        className="wd-row wdorow is-clipped"
        data-owner={fact.id}
        data-advance={advance.kind}
        data-expanded={expanded}
        tabIndex={focused ? 0 : -1}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onFocus={() => onFocus(fact.id)}
      >
        {/* col 0 — the advance gutter. 8px, hueless, reserved even when empty.
            The mark's meaning is carried in words in the state cell, so the mark
            itself is decoration-free and hidden from assistive technology. */}
        <td role="gridcell" className="wdorow-mark-cell">
          <i className="wd-mark" data-advance={advance.kind} aria-hidden="true" />
        </td>

        {/* col 1 — the semantic glyph, on a fixed gutter, --ink-3 always. The
            group's NAME is printed once, on the group head above. */}
        <td role="gridcell" className="wdorow-glyph-cell">
          <Glyph className="wdorow-glyph" size={12} strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">{GROUP_GLYPH_LABEL[fact.group]}</span>
        </td>

        {/* col 2 — identity. The name is NEVER truncated: a truncated value is a
            bug, a truncated name is an incident (law L20). */}
        <th role="rowheader" scope="row" className="wdorow-id-cell">
          <span className="wd-t4 wdorow-name">{fact.label}</span>
          <span className="wd-t6 wdorow-register">
            {component !== null ? (
              <>
                <span className="wd-id wdorow-owner"><b>{component.owner}</b></span>
                <span aria-hidden="true" className="wdorow-sep">·</span>
                <span>{enumWords(component.observedLifecycle)}</span>
                <span aria-hidden="true" className="wdorow-sep">·</span>
                <span>{enumWords(component.capability)}</span>
                <span aria-hidden="true" className="wdorow-sep">·</span>
                <em className="wdorow-attest">{TRUTH_ATTESTATION[component.truthLabel]}</em>
                {component.blockerCode !== null ? (
                  <>
                    <span aria-hidden="true" className="wdorow-sep">·</span>
                    <span className="wd-id wdorow-code"><b>{component.blockerCode}</b></span>
                  </>
                ) : null}
                {component.capitalRelevance !== 'NONE' ? (
                  <>
                    <span aria-hidden="true" className="wdorow-sep">·</span>
                    <strong>Capital {component.capitalRelevance.toLowerCase()}</strong>
                  </>
                ) : null}
              </>
            ) : (
              /* No server projection: the producer's own sentence, which is the
                 only measured thing there is for this owner. Never a blank. */
              <span>{fact.detail}</span>
            )}
            {/* §18 parity: `latencyMs` was read by every old row and rendered by
                none. It is a real ROUND TRIP for exactly one owner — the browser
                row — so it earns a phrase in that row's register and NOT a 9ch
                column that would be an unwritten slot on sixteen rows out of
                seventeen. Density has to earn itself. */}
            {latencyFact !== null ? (
              <>
                <span aria-hidden="true" className="wdorow-sep">·</span>
                <span className="wdorow-rtt">
                  RTT <Numeric fact={latencyFact} unit="ms" track="auto" digits={0} />
                </span>
              </>
            ) : null}
          </span>
        </th>

        {/* col 3 — state. The chip owns the word, the rung, the fill and the
            mandatory reason; this cell owns nothing but their placement. The
            reason wrapping here is what makes an unhealthy row physically
            taller, and height is an honesty signal no configuration can
            suppress. */}
        <td role="gridcell" className="wdorow-state-cell">
          <StatusChip
            state={fact.state}
            stale={fact.stale}
            label={fact.statusLabel}
            reason={fact.reason}
          />
          {advance.sentence !== null ? (
            <span className="wd-t6 wdorow-advance">{advance.sentence}</span>
          ) : null}
          {upstreamId !== null ? (
            <span className="wd-t5 wdorow-upstream">
              {'Downstream of '}
              <button
                type="button"
                className="wdorow-linkid is-clipped"
                data-no-expand="true"
                onClick={(event) => { event.stopPropagation(); onFocus(upstreamId); onExpand(upstreamId); }}
                aria-label={`Show ${upstreamId}, the root cause for ${fact.label}`}
              >
                <span className="wd-id"><b>{upstreamId}</b></span>
              </button>
            </span>
          ) : null}
        </td>

        {/* col 4 — action. Bound, or refused in the server's own words. Present
            at all times, never hover-only: a hover-only action fails on touch
            and for the keyboard. Never the native `disabled` attribute (D29) —
            it removes the control from the tab order and takes the reason with
            it. Where no action is legal, there is NO CONTROL and a visible
            reason (law L22). */}
        <td role="gridcell" className="wdorow-action-cell">
          {action.kind === 'control' ? (
            <span className="wdorow-actbox">
              <button
                type="button"
                className="wdb wdb--sm wdorow-act is-clipped"
                data-no-expand="true"
                onClick={(event) => { event.stopPropagation(); onFocusControl(action.controlId); }}
                /* THE LABEL LAW (§3.6): the label and the accessible state both
                   describe what pressing DOES. This does not mutate anything —
                   it moves focus to the control in the ledger, where the
                   preview → confirm → commit → durable-receipt discipline
                   lives. The ellipsis is load-bearing. */
                aria-label={`Open control ${action.label} in the control ledger — preview required before any commit`}
              >
                <span className="wdb-label">Open control…</span>
              </button>
            </span>
          ) : null}

          {action.kind === 'refused' ? (
            <span className="wdorow-refusal">
              <span className="wd-t5 wdorow-refusal-why">{action.sentence}</span>
              <span className="wd-t6 wd-id wdorow-code"><b>{action.code}</b></span>
            </span>
          ) : null}

          {action.kind === 'none' ? (
            /* Column scale, D37: the literal words at --ink-3, never a dash —
               NVDA reads a dash as nothing at all, and on an evidence-gated
               surface silence is the most complete form of the lie. */
            <span className="wd-t6 wd-nodata">no control</span>
          ) : null}
        </td>

        {/* col 5 — processing lag, on the shared numeric track. */}
        <td role="gridcell" className="wdorow-lag-cell wd-col-num">
          <Numeric fact={lagFact} unit="ms" track="num" digits={0} />
        </td>

        {/* col 6 — the evidence age, terminating on the page's ONE shared right
            edge. That edge is why this page has no cards. */}
        <td role="gridcell" className="wdorow-age-cell wd-col-num">
          <Numeric fact={ageFact} unit={ageUnit} track="age" digits={0} />
        </td>
      </tr>

      {expanded ? (
        <tr role="row" aria-level={3} className="wdorow-evidence">
          <td role="gridcell" colSpan={columnCount} className="wdorow-evidence-cell">
            {children}
          </td>
        </tr>
      ) : null}
    </>
  );
}
