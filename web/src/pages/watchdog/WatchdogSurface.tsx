import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import {
  useWatchdogEvidence,
  knownFact,
  unknownFact,
  type Fact,
  type OwnerFact,
  type SectionCoverage,
  type TransportLaneId,
  type WatchdogSectionId,
} from './watchdogEvidence';
import { AbsenceSlot } from './StatusChip';
import { Identifier, onMachineValueAnnouncement } from './MachineValue';
import { VerdictHeader } from './VerdictHeader';
import { PostureBand } from './PostureBand';
import { OwnerLedger, ageWord, type OwnerEvidenceContext } from './OwnerLedger';
import { OwnerEvidence, type SystemAttentionEntry, type SystemRootCause } from './OwnerEvidence';
import { ConnectionPathChain } from './ConnectionPathChain';
import { ControlLedger } from './ControlLedger';
import {
  RecoveryConsole,
  createRecoveryRunner,
  RECOVERY_DEFAULT_TARGET,
  type RefreshRunResult,
} from './RecoveryConsole';
import { ObserverEvidence } from './ObserverEvidence';

import type { CanonicalRefreshTarget } from '../../lib/operatorControlPosture';
import {
  uncheckedCommandResultReconciliation,
  type ProductCommandResultReconciliation,
} from '../../lib/productIntegration';

/* NOTE: `patterns.css` is NOT imported here. It carries the shared §3.5/§3.6/
   §3.11/§3.4/§3.10/§3.13/§3.18 blocks and it has to precede every section
   sheet, so that a section can override a pattern deliberately at higher
   specificity and can never fork one by accident. ES module evaluation is
   depth-first: the component imports above have already pulled in their own
   sheets by the time this line runs, so importing it here would put it LAST and
   invert the cascade. It is imported from main.tsx immediately after
   tokens.css, which is the only position that is unambiguously first. */
import './WatchdogSurface.css';

/* =============================================================================
   WatchdogSurface — composition, and nothing else.

   It calls useWatchdogEvidence() ONCE and passes disjoint slices down as plain
   props. It owns the page's three singletons:

     1. ONE live region. VerdictHeader renders it; this file is the only thing
        that may put words in it, via `liveMessage`, and the words come from the
        hook's `announcement` — never from a render.
     2. ONE sticky object per scroll container. `.app-main main` is the only
        scroll container on this route, so the licence is granted to exactly one
        section (the owner ledger) and structurally REVOKED everywhere else, in
        CSS, so a neighbour cannot introduce a second one.
     3. ONE roving-tabindex focus model per table, installed here over native
        table semantics (which §2 D33 already mandates) so that no child
        re-implements it, and so a table can never end a render with zero tab
        stops — the failure a naive roving index produces.

   It also owns the two shared kill switches of §3.20, and gives BOTH of them a
   real driver: a stylesheet whose attribute is never set is decoration.

   ZERO fetching. ZERO derivation. Selecting a published field off the envelope
   and wrapping it with the hook's OWN `knownFact`/`unknownFact` constructors is
   selection, not derivation — there is no mapper here from lifecycle or
   capability to a tone, and no threshold this file chose.
   ========================================================================== */

/** Shell-owned UI state. A view of the census, never a re-derivation of it. */
export type OwnerSort = 'attention' | 'group';

type SectionSpec = {
  readonly id: WatchdogSectionId;
  readonly ordinal: string;
  readonly title: string;
  /** The unit the population is counted in. Printed beside the population integer. */
  readonly unit: string;
};

/**
 * The fixed order, which is the order an operator walks during an incident and
 * is also general -> specific (§4.6). The ordinal is rendered, so the reading
 * order is stated rather than left implicit in position.
 *
 * Each section had to answer "what decision does this let the operator make" to
 * be here at all:
 *   1 posture   Is the machine allowed to act right now, and what is holding it.
 *   2 owners    Which owner is broken, and what downstream depends on it.
 *   3 topology  Which hop in the chain of custody the failure sits behind.
 *   4 control   What may I change, on whose authority, and was it changed already.
 *   5 recovery  Which public source may I re-pull, and at what cadence am I reading.
 *   6 observer  Can I trust any of the above — is this page really reading the server.
 */
const SECTIONS: Readonly<Record<WatchdogSectionId, SectionSpec>> = {
  posture: { id: 'posture', ordinal: '1', title: 'Owner posture', unit: 'verdicts' },
  owners: { id: 'owners', ordinal: '2', title: 'Owner ledger', unit: 'owners' },
  topology: { id: 'topology', ordinal: '3', title: 'Connection path', unit: 'hops' },
  control: { id: 'control', ordinal: '4', title: 'Control ledger', unit: 'controls' },
  recovery: { id: 'recovery', ordinal: '5', title: 'Recovery console', unit: 'targets' },
  observer: { id: 'observer', ordinal: '6', title: 'Observer evidence', unit: 'lanes' },
};

/* ---------------------------------------------------------------------------
   Coverage: an exhaustive partition whose visible integers sum to the printed
   population (§3.14). Nothing here is computed — every integer is a Fact the
   hook measured, and an unmeasured class renders the slot-scale absence rule,
   never a zero (§5 L1, §2 D37).
   ------------------------------------------------------------------------ */

type CoverageClass = 'proven' | 'withheld' | 'failing' | 'unknown';
const COVERAGE_CLASSES: readonly CoverageClass[] = ['proven', 'withheld', 'failing', 'unknown'];

/**
 * The contract says `reason` is non-null whenever `known` is false. If it ever
 * is null, that must render as an OBVIOUS defect rather than as a plausible
 * code — inventing `NOT_MEASURED` here would launder a broken producer into
 * something an operator reads as a real server answer (§5 L3).
 */
function reasonOf(fact: Fact<unknown>): string {
  return fact.reason ?? `REASON_MISSING · ${fact.source}`;
}

/** The first figure of the partition that was not measured, if any. */
function firstUnmeasured(coverage: SectionCoverage): Fact<number> | null {
  if (!coverage.population.known) return coverage.population;
  for (const cls of COVERAGE_CLASSES) {
    if (!coverage[cls].known) return coverage[cls];
  }
  return null;
}

function CoverageFigure({ fact, unit }: { fact: Fact<number>; unit: string }): JSX.Element {
  return (
    <span className="wdf-fig" data-measured={fact.known ? 'true' : 'false'}>
      {fact.known && fact.value !== null
        ? <b className="wd-t4 wd-num n">{fact.value}</b>
        : <span className="n"><AbsenceSlot kind="void" srLabel={reasonOf(fact)} /></span>}
      <span className="wd-t6 u">{unit}</span>
    </span>
  );
}

/**
 * One half of the vertical gate. The label sits left of the figure and the
 * figure occupies the reserved --col-age track, so the DECLARED cadence and the
 * MEASURED age of the stalest member stack as two tabular numbers on the page's
 * one right edge. The comparison — "is this section older than it promised to
 * be" — is vertical, and needs no hue.
 *
 * `ageWord` is MachineValue's. Bible §7 open question 9 was that FOUR private
 * age ladders existed in this tree and one of them rounded where the others
 * floored, so the same instant could read `1m` in a head and `59s` in the rows
 * directly beneath it. They were collapsed at integration into the module that
 * already owns the reserved age TRACK these numbers sit on, which is the only
 * home from which the head and the column it sits above cannot drift (Law 5).
 */
function GateFigure({
  className, label, fact, srUnit,
}: {
  className: string;
  label: string;
  fact: Fact<number>;
  srUnit: string;
}): JSX.Element {
  return (
    <span className={`${className} wd-t6`}>
      <span className="wdf-gate-label">{label}</span>
      <span className="wdf-gate-value wd-col-num">
        {fact.known && fact.value !== null
          ? <span className="wd-num">{ageWord(fact.value)}<span className="sr-only"> {srUnit}</span></span>
          : <AbsenceSlot kind="void" srLabel={reasonOf(fact)} />}
      </span>
    </span>
  );
}

/**
 * The derived collapse predicate, and the only predicate in this file.
 * `counts.proven === population && population > 0` — with the honest addition
 * that a coverage which cannot prove its own integers is never "all proven", so
 * a section that lost its census stays open (§3.14, §5 L1).
 */
function isAllProven(coverage: SectionCoverage): boolean {
  const { population, proven } = coverage;
  if (!population.known || population.value === null) return false;
  if (!proven.known || proven.value === null) return false;
  if (population.value <= 0) return false;
  return proven.value === population.value;
}

/* ---------------------------------------------------------------------------
   The section frame. No border, no radius, no fill, no shadow, no hover — the
   named reset lives in WatchdogSurface.css. A head, one hairline, and content
   on the page canvas.
   ------------------------------------------------------------------------ */

function WdSection({
  spec, coverage, nowMs, open, onToggle, sticky, children,
}: {
  spec: SectionSpec;
  coverage: SectionCoverage;
  nowMs: number;
  open: boolean;
  onToggle: (id: WatchdogSectionId, next: boolean) => void;
  sticky: boolean;
  children: ReactNode;
}): JSX.Element {
  const headingId = `wdf-h-${spec.id}`;
  const bodyId = `wdf-b-${spec.id}`;
  const unmeasured = firstUnmeasured(coverage);

  // THE VETO of §3.18. The gate is the WHOLE partition, not the population
  // alone: if one class was not measured, the visible integers do not sum to
  // the printed population, so the source did not fully answer and does not get
  // to be painted as though it had. The stylesheet can refuse to PAINT a claim;
  // it cannot refuse to WRITE one, which is why the words are always in the DOM
  // and only the attribute is the gate.
  const sourced = unmeasured === null;

  const ageFact: Fact<number> = coverage.oldestEvidenceAtMs.known
    && coverage.oldestEvidenceAtMs.value !== null
    ? knownFact(
      Math.max(0, nowMs - coverage.oldestEvidenceAtMs.value),
      coverage.oldestEvidenceAtMs.source,
      coverage.oldestEvidenceAtMs.observedAtMs,
    )
    : unknownFact<number>(reasonOf(coverage.oldestEvidenceAtMs), coverage.oldestEvidenceAtMs.source);

  return (
    <section
      className="wdf-section"
      id={`wdf-${spec.id}`}
      data-section={spec.id}
      data-sticky={sticky ? 'licensed' : 'revoked'}
      aria-labelledby={headingId}
    >
      <div className="wdf-head" {...(sourced ? { 'data-source': coverage.source } : {})}>
        <button
          type="button"
          className="wdf-disclose"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => onToggle(spec.id, !open)}
        >
          <svg className="wdf-caret" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
            <path d="M4.5 2.5 L8.5 6 L4.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
          </svg>
          <span className="sr-only">{open ? `Collapse ${spec.title}` : `Expand ${spec.title}`}</span>
        </button>

        <h3 className="wd-t2 wdf-title" id={headingId}>
          <span className="wdf-ord wd-t6">{spec.ordinal}</span>
          {spec.title}
        </h3>

        <div className="wdf-count" role="group" aria-label={`${spec.title} coverage`}>
          <CoverageFigure fact={coverage.population} unit={spec.unit} />
          {COVERAGE_CLASSES.map((cls) => (
            <CoverageFigure key={cls} fact={coverage[cls]} unit={cls} />
          ))}
        </div>

        <GateFigure
          className="wdf-hb"
          label="cadence"
          fact={coverage.declaredHeartbeatMs}
          srUnit="declared cadence"
        />

        {/* The reason line. At SLOT scale an unmeasured figure carries its
            reason to the screen reader only (§3.12); at HEAD scale exactly one
            reason is promoted to visible DOM text, so a partition that does not
            add up always says why, in reading order, in a screenshot. */}
        <p className="wdf-note wd-t6">
          {/* `.wdf-source` is what §3.18's veto keys on: a head that could not
              say where its integers came from paints the path it TRIED in
              --warn. The class was declared in the stylesheet and carried by no
              element, so the stated refusal painted nothing. */}
          <span className="wdf-source">
            <Identifier kind="path" value={coverage.source} label={`${spec.title} evidence source`} />
          </span>
          {unmeasured !== null ? (
            <> · <span className="wd-nodata">{reasonOf(unmeasured)}</span></>
          ) : null}
        </p>

        <GateFigure
          className="wdf-age"
          label="stalest"
          fact={ageFact}
          srUnit="since the stalest member was observed"
        />
      </div>

      <div className="wdf-body" id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/* ========================================================================== */

export function WatchdogSurface(): JSX.Element {
  const evidence = useWatchdogEvidence();
  const { nowMs, sections, announcement } = evidence;

  const rootRef = useRef<HTMLElement | null>(null);

  /* ---- shell-owned UI state, passed down as value + callback pairs -------- */
  const [expandedOwnerId, setExpandedOwnerId] = useState<string | null>(null);
  const [focusedOwnerId, setFocusedOwnerId] = useState<string | null>(null);
  const [ownerSort, setOwnerSort] = useState<OwnerSort>('attention');
  const [openTraceCorrelationId, setOpenTraceCorrelationId] = useState<string | null>(null);

  const [refreshTarget, setRefreshTarget] = useState<CanonicalRefreshTarget>(RECOVERY_DEFAULT_TARGET);
  const [refreshBusyTarget, setRefreshBusyTarget] = useState<CanonicalRefreshTarget | null>(null);
  const [lastRefreshResult, setLastRefreshResult] = useState<RefreshRunResult | null>(null);

  // Seeded UNCHECKED, never NONE. `NONE` asserts "there is no durable command
  // outstanding", and at first paint this page has not looked. The seed states
  // COMMAND_RESULT_DURABLE_STATE_NOT_CHECKED until ControlLedger reads it.
  const [reconciliation, setReconciliation] = useState<ProductCommandResultReconciliation>(
    uncheckedCommandResultReconciliation,
  );
  const [focusControlId, setFocusControlId] = useState<string | null>(null);

  const [attemptsExpanded, setAttemptsExpanded] = useState(false);
  const [probeBusyLaneId, setProbeBusyLaneId] = useState<string | null>(null);
  const [reReading, setReReading] = useState(false);

  const [focusMiss, setFocusMiss] = useState<{ componentId: string } | null>(null);
  const missRef = useRef<HTMLParagraphElement | null>(null);
  const pendingOwnerFocus = useRef<string | null>(null);

  // Explicit operator choice. `undefined` = no choice made, the derived default rules.
  const [override, setOverride] = useState<Partial<Record<WatchdogSectionId, boolean>>>({});
  // The last COMMITTED derived value. Lags the evidence while a pointer or a
  // focus is inside the section, so the page never reflows under a reading eye.
  const [settled, setSettled] = useState<Partial<Record<WatchdogSectionId, boolean>>>({});

  const openOf = useCallback(
    (id: WatchdogSectionId): boolean => override[id] ?? settled[id] ?? true,
    [override, settled],
  );

  /* ---- selection off the published envelope ------------------------------
     Field selection plus the hook's own Fact constructors. No mapper from
     lifecycle/capability/truthLabel to a tone lives here or anywhere else on
     the page: `canonicalCockpit` and `canonicalPresentation` are server-owned
     display posture (§FORBIDDEN 2). */
  const cut = evidence.envelope.value;
  const envelopeReason = evidence.envelope.reason ?? 'ENVELOPE_UNREAD';
  const ENVELOPE_SOURCE = 'GET /api/product-integration/v1/supervisor';

  /* The observation instant is the CLIENT's receipt time for the envelope, not
     the cut's own `evaluatedAtMs`. Stamping a selected field with the server's
     timestamp made every age on the page a function of the server's clock: a
     supervisor running five minutes fast rendered as the freshest possible
     evidence, and the age-clock regression
     (web/test/productControlRoom/dashboard-age-clock.test.mjs) is exactly that
     failure. `envelope.observedAtMs` advances when this browser receives a new
     cut identity, which is the only instant this page actually witnessed. */
  const envelopeObservedAtMs = evidence.envelope.observedAtMs;
  const pick = useCallback(<T,>(value: T | null | undefined, field: string): Fact<T> => (
    value === null || value === undefined
      ? unknownFact<T>(envelopeReason, `${ENVELOPE_SOURCE} · ${field}`)
      : knownFact<T>(value, `${ENVELOPE_SOURCE} · ${field}`, envelopeObservedAtMs)
  ), [envelopeObservedAtMs, envelopeReason]);

  /**
   * A NULLABLE field is three states, not two. `?? null` collapses "the server
   * sent this key and it was null" (a measured none) together with "the server
   * never sent this key at all" (ignorance) — and the renderer beneath then
   * prints "None. The supervisor named no blocker." plus an explicit
   * measured-zero announcement over a field that was never published. This
   * keeps the three apart, so an unpublished field renders UNKNOWN with the
   * reason and only a present-and-null key can claim a measured none.
   */
  const pickNullable = useCallback(<T,>(
    container: object | null | undefined,
    key: string,
    field: string,
  ): Fact<T | null> => {
    const source = `${ENVELOPE_SOURCE} · ${field}`;
    if (container === null || container === undefined) {
      return unknownFact<T | null>(envelopeReason, source);
    }
    if (!Object.prototype.hasOwnProperty.call(container, key)) {
      return unknownFact<T | null>(
        `FIELD_NOT_PUBLISHED · the envelope carried no ${field}, so "none" cannot be told apart from "not sent"`,
        source,
      );
    }
    const read = (container as Record<string, T | null | undefined>)[key];
    return knownFact<T | null>(read ?? null, source, envelopeObservedAtMs);
  }, [envelopeObservedAtMs, envelopeReason]);

  const rootCauses = cut?.dashboard.rootCauses ?? [];
  const attentionQueue = cut?.dashboard.attentionQueue ?? [];
  const controls = cut?.controls ?? [];

  /* ---- the derived collapse rule, committed only when nobody is reading ---
     Default-collapse is DERIVED, never chosen. A section flipping OUT of
     all-proven also clears the operator's collapse override — the page
     physically opens the thing that broke. That clearing is one-way: nothing in
     this file ever writes `false` into an override. */
  const derivedRef = useRef<Partial<Record<WatchdogSectionId, boolean>>>({});
  useEffect(() => {
    const next: Partial<Record<WatchdogSectionId, boolean>> = {};
    for (const id of Object.keys(SECTIONS) as WatchdogSectionId[]) {
      next[id] = !isAllProven(sections[id]);
    }
    derivedRef.current = next;
  }, [sections]);

  // Mirror of `settled`, so a commit driven by a pointerleave can read the
  // committed value without a render-phase state update.
  const settledRef = useRef<Partial<Record<WatchdogSectionId, boolean>>>({});
  useEffect(() => { settledRef.current = settled; }, [settled]);

  const commitCollapse = useCallback(() => {
    const derived = derivedRef.current;
    const root = rootRef.current;
    const current = settledRef.current;
    const next = { ...current };
    const reopened: WatchdogSectionId[] = [];
    let changed = false;

    for (const id of Object.keys(SECTIONS) as WatchdogSectionId[]) {
      const want = derived[id];
      if (want === undefined || current[id] === want) continue;
      // Deferred while a pointer hovers or focus sits inside the region: the
      // page must never reflow under a reading eye or a moving keyboard.
      const node = root?.querySelector<HTMLElement>(`[data-section="${id}"]`) ?? null;
      const held = node !== null
        && (node.matches(':hover') || node.contains(document.activeElement));
      if (held) continue;
      next[id] = want;
      if (want) reopened.push(id);
      changed = true;
    }

    if (changed) {
      settledRef.current = next;
      setSettled(next);
    }
    if (reopened.length > 0) {
      setOverride((currentOverride) => {
        let touched = false;
        const nextOverride = { ...currentOverride };
        for (const id of reopened) {
          if (nextOverride[id] === false) { delete nextOverride[id]; touched = true; }
        }
        return touched ? nextOverride : currentOverride;
      });
    }
  }, []);

  useEffect(() => { commitCollapse(); }, [sections, commitCollapse]);

  // Flush the deferred change the moment the operator stops reading the region.
  // Capture phase, because pointerleave does not bubble; coalesced to one frame,
  // because a pointer crossing a forty-row table fires it constantly.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    let queued = 0;
    const flush = (): void => {
      if (queued !== 0) return;
      queued = requestAnimationFrame(() => { queued = 0; commitCollapse(); });
    };
    root.addEventListener('pointerleave', flush, true);
    root.addEventListener('focusout', flush, true);
    return () => {
      cancelAnimationFrame(queued);
      root.removeEventListener('pointerleave', flush, true);
      root.removeEventListener('focusout', flush, true);
    };
  }, [commitCollapse]);

  const toggleSection = useCallback((id: WatchdogSectionId, next: boolean) => {
    setOverride((current) => ({ ...current, [id]: next }));
  }, []);

  const openSection = useCallback((id: WatchdogSectionId) => {
    setOverride((current) => (current[id] === true ? current : { ...current, [id]: true }));
  }, []);

  /* ---- kill switch 1 · theme swap ----------------------------------------
     A theme change repaints every colour on the page at once. Letting sixty
     rows ease between two palettes reads as a fault, not as polish. */
  useEffect(() => {
    const html = document.documentElement;
    let raf1 = 0;
    let raf2 = 0;
    const observer = new MutationObserver(() => {
      html.setAttribute('data-theme-switching', '');
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => { html.removeAttribute('data-theme-switching'); });
      });
    });
    observer.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      html.removeAttribute('data-theme-switching');
    };
  }, []);

  /* ---- kill switch 2 · slow-update displays -------------------------------
     `@media (update: slow)` kills animation in CSS; this stamps the equivalent
     attribute on the page root so the CSS half has something to key on
     (WatchdogSurface.css does the actual disabling).

     CORRECTED: the comment here used to claim that "the dwell timers in
     ControlCommit and RecoveryConsole read `[data-instant]` off this root".
     They never did, and neither has a timer that would need to — ControlCommit
     arms against the SERVER's preview TTL, not a page-chosen dwell, and the one
     dwell left on the page (the restore acknowledgement) is a receipt for a
     press rather than an animation, so shortening it on a slow display would
     remove information rather than motion. A comment describing a mechanism
     that does not exist is worse than no comment: it makes an audit stop
     looking. */
  const [instant, setInstant] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(update: slow)');
    const apply = (): void => { setInstant(query.matches); };
    apply();
    query.addEventListener('change', apply);
    return () => { query.removeEventListener('change', apply); };
  }, []);

  /* ---- the copy announcement, routed into the page's ONE live region -------
     §3.2 requires a copy to be announced WITH ITS CHARACTER COUNT — an operator
     who cannot see the elision has no other way to learn that all 71 characters
     of a digest reached the clipboard, and a truncated hash pasted into an
     incident ticket is worse than no hash. MachineValue may not open a live
     region (D30), so it publishes the outcome as a bubbling DOM event and this
     file — which owns the region — speaks it. Without this subscription the
     event fires into nothing and the announcement is genuinely missing, which
     is why it is an integration step and not a nicety.

     TWO SOURCES, ONE ORDERED STREAM. The hook's poll announcement and this
     copy outcome are merged into a single utterance with a single monotonic
     sequence, rather than two counters a renderer would have to referee. The
     sequence is what makes a REPEATED string re-announce — aria-atomic with an
     identical consecutive value says nothing, and copying the same digest twice
     must confirm twice. `null` is SILENCE, never the words "no change". */
  const [utterance, setUtterance] = useState<{ seq: number; text: string } | null>(null);
  const utteranceSeq = useRef(0);
  const speak = useCallback((text: string) => {
    utteranceSeq.current += 1;
    setUtterance({ seq: utteranceSeq.current, text });
  }, []);

  // Keyed on the hook's own seq, not on object identity: the hook may hand back
  // a fresh object every poll, and re-speaking an unchanged announcement would
  // make the region chatter on a wall display nobody is standing at.
  const spokenAnnouncementSeq = useRef<number | null>(null);
  useEffect(() => {
    if (announcement === null) return;
    if (spokenAnnouncementSeq.current === announcement.seq) return;
    spokenAnnouncementSeq.current = announcement.seq;
    speak(announcement.text);
  }, [announcement, speak]);

  useEffect(() => onMachineValueAnnouncement(document, (a) => { speak(a.message); }), [speak]);

  /* ---- re-read when the operator comes back to the tab -------------------- */
  const refreshAllRef = useRef(evidence.refreshAll);
  useEffect(() => { refreshAllRef.current = evidence.refreshAll; }, [evidence]);
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refreshAllRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  /* ---- singleton 3 · the roving tabindex ---------------------------------
     Forty rows must never be forty tab stops, and must not be ZERO — which is
     exactly what a roving index with nothing at 0 produces, and exactly what a
     table whose rows are all rendered `tabIndex={-1}` produces on every mount.

     THE DIVISION, and it is deliberate, not an overlap (§5 L23):
       · This file owns the INVARIANT — after every render, every table on the
         page has exactly one row at tabindex 0. It never moves focus on its own.
       · A table that owns its own movement (OwnerLedger does, keyed on its
         visible-id list) handles ArrowUp/Down/Home/End itself and calls
         stopPropagation, so the handler below never sees those keys there and
         two models can never move the same focus. For every other table the
         handler below is the mover.
     Deleting either half reintroduces a defect the other cannot cover. */
  const tablesOf = useCallback((): HTMLElement[] => {
    const root = rootRef.current;
    if (root === null) return [];
    return Array.from(
      root.querySelectorAll<HTMLElement>('.wdf-body table, .wdf-body [role="grid"], .wdf-body [role="treegrid"]'),
    );
  }, []);

  const rowsOf = useCallback((table: HTMLElement): HTMLElement[] => {
    const all = table.tagName === 'TABLE'
      ? Array.from(table.querySelectorAll<HTMLElement>('tbody > tr'))
      : Array.from(table.querySelectorAll<HTMLElement>('[role="row"]'));
    const visible = all.filter((row) => row.offsetParent !== null || row.getClientRects().length > 0);
    // A row that carries an owner identity is a DATA row; a table that has any
    // of them has group-header rows too (OwnerLedger's aria-level=1 section
    // rows), and stepping the keyboard onto a group header is a move the
    // operator did not ask for. Identity is the discriminator, not aria-level,
    // so this stays true for any table on the page.
    const identified = visible.filter((row) => typeof row.dataset.owner === 'string');
    return identified.length > 0 ? identified : visible;
  }, []);

  useLayoutEffect(() => {
    const active = document.activeElement;
    for (const table of tablesOf()) {
      const rows = rowsOf(table);
      if (rows.length === 0) continue;
      // FOCUS MUST SURVIVE THE POLL (§3.19). The row that actually holds focus
      // wins the tab stop, then the row that already held it, then the owner the
      // page was asked to focus, then the first row — that last branch is what
      // stops a re-render from leaving a table with ZERO tab stops.
      let holder = active !== null ? rows.find((row) => row.contains(active)) ?? null : null;
      holder ??= rows.find((row) => row.tabIndex === 0) ?? null;
      if (holder === null && focusedOwnerId !== null) {
        holder = rows.find((row) => row.dataset.owner === focusedOwnerId) ?? null;
      }
      holder ??= rows[0];
      for (const row of rows) row.tabIndex = row === holder ? 0 : -1;
    }
  });

  const moveRoving = useCallback((rows: HTMLElement[], next: HTMLElement) => {
    for (const row of rows) row.tabIndex = row === next ? 0 : -1;
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
    const ownerId = next.dataset.owner;
    if (typeof ownerId === 'string' && ownerId.length > 0) setFocusedOwnerId(ownerId);
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    // A child that already acted owns the key. ControlCommit's armed-control
    // cancel is an Escape too, and the page must never collapse an owner row
    // out from under a mutation the operator is backing out of (§3.6).
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (target === null) return;

    if (event.key === 'Escape') {
      if (expandedOwnerId !== null) {
        const row = rootRef.current?.querySelector<HTMLElement>(
          `[data-owner="${CSS.escape(expandedOwnerId)}"]`,
        ) ?? null;
        setExpandedOwnerId(null);
        row?.focus();
        event.preventDefault();
      } else if (focusMiss !== null) {
        setFocusMiss(null);
        event.preventDefault();
      }
      return;
    }

    const table = target.closest<HTMLElement>(
      '.wdf-body table, .wdf-body [role="grid"], .wdf-body [role="treegrid"]',
    );
    if (table === null) return;
    const row = target.closest<HTMLElement>(table.tagName === 'TABLE' ? 'tbody > tr' : '[role="row"]');
    if (row === null || !table.contains(row)) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      const rows = rowsOf(table);
      const index = rows.indexOf(row);
      if (index < 0) return;
      const next = event.key === 'Home' ? rows[0]
        : event.key === 'End' ? rows[rows.length - 1]
          : event.key === 'ArrowDown' ? rows[Math.min(index + 1, rows.length - 1)]
            : rows[Math.max(index - 1, 0)];
      if (next === undefined || next === row) { event.preventDefault(); return; }
      moveRoving(rows, next);
      event.preventDefault();
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      // Never steal the key from a real control inside the row.
      if (target !== row
        && target.closest('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])') !== row) return;
      const ownerId = row.dataset.owner;
      if (typeof ownerId !== 'string' || ownerId.length === 0) return;
      setExpandedOwnerId((current) => (current === ownerId ? null : ownerId));
      setFocusedOwnerId(ownerId);
      event.preventDefault();
    }
  }, [expandedOwnerId, focusMiss, moveRoving, rowsOf]);

  /* ---- every blocker component id on the page routes here ------------------
     VerdictHeader's root blocker, a PostureBand interlock reason, a chain edge's
     rootCauseComponentId, a dependencyPath entry, an incident's rootComponentId:
     all of them call this, and all of them land on the same row. */
  const focusOwner = useCallback((componentId: string) => {
    setFocusMiss(null);
    setExpandedOwnerId(componentId);
    setFocusedOwnerId(componentId);
    openSection('owners');
    pendingOwnerFocus.current = componentId;
  }, [openSection]);

  useEffect(() => {
    const componentId = pendingOwnerFocus.current;
    if (componentId === null) return;
    pendingOwnerFocus.current = null;
    const row = rootRef.current?.querySelector<HTMLElement>(
      `[data-owner="${CSS.escape(componentId)}"]`,
    ) ?? null;
    if (row === null) {
      // Never a dead control. The reference resolved to nothing and the page
      // says so, in words, in reading order.
      setFocusMiss({ componentId });
      return;
    }
    const table = row.closest<HTMLElement>(
      '.wdf-body table, .wdf-body [role="grid"], .wdf-body [role="treegrid"]',
    );
    if (table !== null) {
      for (const sibling of rowsOf(table)) sibling.tabIndex = sibling === row ? 0 : -1;
    }
    row.focus();
    row.scrollIntoView({ block: 'nearest' });
  });

  useEffect(() => {
    if (focusMiss !== null) missRef.current?.focus();
  }, [focusMiss]);

  /* ---- the page's single re-entrancy guard for POST /api/refresh ----------
     The runner is RecoveryConsole's; the GUARD is the page's, so that the
     console's own Run button and its per-cadence Refresh buttons can never be
     in flight at the same time. There is exactly one producer of a refresh on
     this page — the Recovery Console — so there is no adoption protocol: the
     `requestedTarget` / `onRequestHandled` pair was deleted along with the
     owner-row refresh button that was its only (unreachable) producer. */
  const runner = useMemo(() => createRecoveryRunner(), []);
  const runRefresh = useCallback(async (target: CanonicalRefreshTarget): Promise<void> => {
    await runner.run(target, { setBusyTarget: setRefreshBusyTarget, setLastResult: setLastRefreshResult });
    await refreshAllRef.current();
  }, [runner]);

  const onReReadAll = useCallback(() => {
    if (reReading) return;
    setReReading(true);
    void refreshAllRef.current().finally(() => { setReReading(false); });
  }, [reReading]);

  /* The probe issues the pressed lane's OWN path. It used to call
     `refreshBrowserProbe()`, which reads `/health/live` — a path that matches
     no lane prefix, so the drain classified it into nothing and the pressed row
     never changed. `probeTransportLane` GETs `lane.probePath`, records the
     attempt on that exact path (which is what the row's readback matches on)
     and drains before settling, so the row the operator pressed is the row that
     moves. */
  const onProbe = useCallback((laneId: string) => {
    if (probeBusyLaneId !== null) return;
    setProbeBusyLaneId(laneId);
    void evidence.probeTransportLane(laneId as TransportLaneId)
      .finally(() => { setProbeBusyLaneId(null); });
  }, [evidence, probeBusyLaneId]);

  const focusControl = useCallback((controlId: string) => {
    openSection('control');
    setFocusControlId(controlId);
  }, [openSection]);

  /* ---- the expanded owner region ----------------------------------------- */
  const renderOwnerEvidence = useCallback((fact: OwnerFact, ctx: OwnerEvidenceContext): ReactNode => {
    const id = fact.id;
    const rootCause = rootCauses.find((entry) => entry.componentId === id);
    const attention = attentionQueue.find((entry) => entry.componentId === id);
    return (
      <OwnerEvidence
        fact={fact}
        edges={cut?.dependencyEdges ?? []}
        rootCause={rootCause === undefined
          ? unknownFact<SystemRootCause>(
            cut === null ? envelopeReason : 'NOT_IN_ROOT_CAUSES',
            `${ENVELOPE_SOURCE} · dashboard.rootCauses[]`,
          )
          : knownFact<SystemRootCause>(rootCause, `${ENVELOPE_SOURCE} · dashboard.rootCauses[]`, cut?.evaluatedAtMs ?? null)}
        attention={attention === undefined
          ? unknownFact<SystemAttentionEntry>(
            cut === null ? envelopeReason : 'NOT_IN_ATTENTION_QUEUE',
            `${ENVELOPE_SOURCE} · dashboard.attentionQueue[]`,
          )
          : knownFact<SystemAttentionEntry>(attention, `${ENVELOPE_SOURCE} · dashboard.attentionQueue[]`, cut?.evaluatedAtMs ?? null)}
        nowMs={ctx.nowMs}
        client={ctx.client}
        openTraceCorrelationId={openTraceCorrelationId}
        onOpenTrace={setOpenTraceCorrelationId}
        onFocusOwner={ctx.onFocusOwner}
        onRecordAttempt={ctx.onRecordAttempt}
      />
    );
  }, [attentionQueue, cut, envelopeReason, openTraceCorrelationId, rootCauses]);

  /* ------------------------------------------------------------------------ */

  const section = (
    id: WatchdogSectionId,
    children: ReactNode,
    opts: { sticky?: boolean } = {},
  ): JSX.Element => (
    <WdSection
      spec={SECTIONS[id]}
      coverage={sections[id]}
      nowMs={nowMs}
      open={openOf(id)}
      onToggle={toggleSection}
      sticky={opts.sticky === true}
    >
      {children}
    </WdSection>
  );

  return (
    <main
      ref={rootRef}
      className="container page wdogx-page watchdog wdf-page"
      onKeyDown={onKeyDown}
      {...(instant ? { 'data-instant': '' } : {})}
    >
      <header className="wdf-page-head">
        {/* VerdictHeader renders the page's ONE role="status" live region. The
            monotonic sequence is what makes a repeated string re-announce:
            aria-atomic with an identical consecutive value says nothing, and
            flapping is the highest-signal behaviour on this page. `null` is
            SILENCE — never the words "no change". */}
        <VerdictHeader
          verdict={{
            status: cut?.canonicalCockpit.watchmanOverall.status ?? 'outage',
            label: cut?.canonicalCockpit.watchmanOverall.label ?? envelopeReason,
          }}
          rule="canonicalCockpit.watchmanOverall"
          continuity={evidence.continuity}
          assessedAtMs={cut?.evaluatedAtMs ?? null}
          nowMs={nowMs}
          tally={evidence.ownerTally}
          revision={pick(cut?.revision, 'revision')}
          digest={pick(cut?.digest, 'digest')}
          reReading={reReading}
          onReReadAll={onReReadAll}
          liveMessage={utterance === null ? null : `${utterance.text} Update ${utterance.seq}.`}
        />

        {focusMiss !== null ? (
          <p className="wdf-miss wd-t5" tabIndex={-1} ref={missRef}>
            <b>No ledger row for {focusMiss.componentId}.</b>{' '}
            That component id is named by the supervisor as a blocker, but it is not in the owner
            census this page can see, so there is nothing to open. Escape dismisses this line.
          </p>
        ) : null}
      </header>

      {/* ---- CLUSTER 1 · SURFACE — what is the machine doing ----------------
          DELETED: the visible `<h2>` cluster labels, all four of them. Each was
          a noun followed by the same noun paraphrased, sitting above sections
          that already carry an ordinal AND a title — three levels of naming for
          one list. The cluster tier carried no count, no age, no source, no
          evidence and nothing clickable; `.wdf-cluster-label { margin: 0 }` was
          its entire stylesheet, which is the tell. The clusters remain as
          grouping, which is what they were for. */}
      <div className="wdf-cluster">

        {section('posture', (
          <PostureBand
            ownerView={pick(cut?.ownerView, 'ownerView')}
            browser={evidence.browser}
            browserDetail={evidence.browserDetail}
            continuity={evidence.continuity}
            continuityError={evidence.continuityError}
            interlock={pick(cut?.opsIntakeInterlock, 'opsIntakeInterlock')}
            opsReadback={pick(cut?.opsReadback, 'opsReadback')}
            readinessPolicy={pick(cut?.serviceReadinessPolicy, 'serviceReadinessPolicy')}
            requiredBlocker={pickNullable<string>(cut, 'firstRequiredReadinessBlockerComponentId', 'firstRequiredReadinessBlockerComponentId')}
            rootBlocker={pickNullable<string>(cut?.dashboard, 'firstRootBlockerComponentId', 'dashboard.firstRootBlockerComponentId')}
            /* A recovery that the server REFUSED, that never left the browser,
               or that the server itself reported issues on is not a recovery.
               Only ACCEPTED sets this stamp — anything looser would let the
               posture band claim a repair the server never confirmed. */
            lastRecoveryAtMs={lastRefreshResult !== null && lastRefreshResult.outcome === 'ACCEPTED'
              ? lastRefreshResult.settledAtMs
              : null}
            nowMs={nowMs}
            onFocusOwner={focusOwner}
          />
        ))}

        {section('owners', (
          <OwnerLedger
            owners={evidence.owners}
            sourceCoverage={pick(cut?.dashboard.summaries.sourceCoverage, 'dashboard.summaries.sourceCoverage')}
            managedInventory={pick(cut?.managedInventory, 'managedInventory')}
            continuity={evidence.continuity}
            nowMs={nowMs}
            sort={ownerSort}
            onSort={setOwnerSort}
            expandedOwnerId={expandedOwnerId}
            focusedOwnerId={focusedOwnerId}
            onExpand={setExpandedOwnerId}
            onFocus={focusOwner}
            controls={controls}
            onFocusControl={focusControl}
            refreshBusyTarget={refreshBusyTarget}
            client={evidence.client}
            onRecordAttempt={evidence.recordAttempt}
            renderEvidence={renderOwnerEvidence}
          />
        ), { sticky: true /* the ONE sticky licence on this scroll container */ })}
      </div>

      {/* ---- CLUSTER 2 · TOPOLOGY — where is the break ---------------------- */}
      <div className="wdf-cluster">

        {section('topology', (
          <ConnectionPathChain
            hops={evidence.owners}
            edges={cut?.dependencyEdges ?? []}
            assessedAtMs={cut?.evaluatedAtMs ?? null}
            assessedUnreadReason={cut === null ? envelopeReason : null}
            nowMs={nowMs}
            focusedOwnerId={focusedOwnerId}
            onFocusOwner={focusOwner}
          />
        ))}
      </div>

      {/* ---- CLUSTER 3 · CONTROL — what may I change -----------------------
          The ONLY bounded surface on the page, and it marks exactly the region
          that mutates the machine. Its margin-inline and padding cancel, so its
          contents stay on the page axis and every numeric column inside it
          still terminates on the one shared right edge (§4.2 item 5). The
          registry and its audit trail are kept together (§4.6) because reading
          a control without its ledger is how you make the same mutation twice. */}
      <div className="wdf-cluster wdf-region" data-mutates="true">

        {section('control', (
          <ControlLedger
            controls={controls}
            incidents={cut?.incidents ?? []}
            incidentAvailability={pick(cut?.incidentAvailability, 'incidentAvailability')}
            continuity={evidence.continuity}
            client={evidence.client}
            reconciliation={reconciliation}
            onReconciliation={setReconciliation}
            focusControlId={focusControlId}
            onFocusHandled={() => setFocusControlId(null)}
            nowMs={nowMs}
            onRefreshEvidence={evidence.refreshAll}
            onRecordAttempt={evidence.recordAttempt}
            onFocusOwner={focusOwner}
          />
        ))}

        {section('recovery', (
          <RecoveryConsole
            target={refreshTarget}
            onTargetChange={setRefreshTarget}
            busyTarget={refreshBusyTarget}
            lastResult={lastRefreshResult}
            onRun={runRefresh}
            cadence={evidence.cadence}
            onSetCadence={evidence.setCadence}
            onResetDefaults={evidence.resetCadenceDefaults}
            nowMs={nowMs}
            onRefreshEvidence={evidence.refreshAll}
            onRecordAttempt={evidence.recordAttempt}
          />
        ))}
      </div>

      {/* ---- CLUSTER 4 · EVIDENCE — can I trust any of the above ------------
          LAST. A page that opens on its own trustworthiness has already lost
          the operator (§4.6). */}
      <div className="wdf-cluster">

        {section('observer', (
          <ObserverEvidence
            stats={evidence.stats}
            lagSamplesProven={evidence.lagSamplesProven}
            loopLag={evidence.loopLag}
            publishedCutPrefix={evidence.publishedCutPrefix}
            envelopeCutPrefix={evidence.envelopeCutPrefix}
            staleTabCutFact={evidence.staleTabCutFact}
            envelopeDigest={pick(cut?.digest, 'digest')}
            materialEvents={pick(cut?.materialEvents, 'materialEvents')}
            continuity={evidence.continuity}
            socketConnected={evidence.socketConnected}
            transport={evidence.transport}
            transportBuffer={evidence.transportBuffer}
            attempts={evidence.attempts}
            attemptsExpanded={attemptsExpanded}
            onToggleAttempts={setAttemptsExpanded}
            probeBusyLaneId={probeBusyLaneId}
            onProbe={onProbe}
            onReReadEnvelope={onReReadAll}
            nowMs={nowMs}
          />
        ))}
      </div>
    </main>
  );
}
