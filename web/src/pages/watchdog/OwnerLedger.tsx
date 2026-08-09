import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Brain, Newspaper, Shield, Wifi } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import type {
  ProductCapability,
  ProductControlRegistryEntry,
  ProductIntegrationClient,
  ProductManagedInventoryProjection,
} from '../../lib/productIntegration';
import type { SystemSupervisorSummaries } from '../../lib/systemIntegration';
import type { CanonicalRefreshTarget } from '../../lib/operatorControlPosture';
import { AbsenceColumnNote, AbsenceSlot, type Rung } from './StatusChip';
import { OWNER_ROW_COLUMNS, OWNER_ROW_COLUMN_COUNT, OwnerRow } from './OwnerRow';
import { ageWord } from './MachineValue';
import type {
  Attempt,
  Fact,
  MaterialContinuity,
  OwnerFact,
  WatchmanGroup,
} from './watchdogEvidence';
import './OwnerLedger.css';

/* =============================================================================
   OwnerLedger — the grouped owner census.

   THE OPERATOR QUESTION, and nothing else is on the screen:
     group by group, how many owners are GENUINELY proven out of how many, how
     many am I BLIND to, and WHICH SPECIFIC ONE is not proving itself.

   THE THESIS. The deleted Connection Watchman's connections tab printed
   `operational/total` per group and the owner still remembers those fractions
   ("0/8", "3/3"). That fraction could flatter three different ways and did:
   `planned` counted as neither numerator nor problem, a component whose reading
   had frozen an hour ago still counted operational, and a DRY_RUN component
   counted as proof of an authority the system was deliberately not exercising.
   This head is the same idea made incapable of flattering — an EXHAUSTIVE
   PARTITION whose four visible integers sum to the printed population, with two
   DEMOTIONS applied before counting and PRINTED IN WORDS when they fire.

   BIBLE: §3.14 is this file's spine. §3.12 (absence at slot and column scale),
   §3.13 (the unmet measurement contract), §3.17 (the ledger), §3.18 (the
   receipt and the age law) and §4.2/§4.3 (no card, one shared right edge) do
   the rest. Every state word, chip, glyph topology and absence rule comes from
   StatusChip; every reserved numeric track from OwnerRow's column contract.
   Nothing here re-implements a neighbour (Law 5).

   WHAT THIS FILE MAY NOT DO
   - Derive a health verdict. `fact.state` is a `Rung` that watchdogEvidence has
     already gated (§3.17: READY on a non-proven truth class collapses to
     UNKNOWN upstream; a non-PROVEN continuity has already forced canonical
     owners to outage). The two transforms here only ever DEMOTE, and they say
     so on screen.
   - Render a number it did not measure. An unmeasured figure renders
     `AbsenceSlot` plus its reason as real text in reading order — never 0,
     never a bare em dash (D37: NVDA reads a dash as nothing at all).
   - Draw a container (§4.2 / D32). This section is a head, a hairline and rows
     on the page canvas, so its age column shares the page's one right edge with
     every other section's receipt. That is the whole reason the page has no
     cards, and a card here would silently cost it.
   ========================================================================== */

/**
 * The web mirror of the server's `SystemSourceCoverageSummary`
 * (server/src/systemIntegration/supervisor/types.ts:63), reached through the
 * dashboard type the provider actually binds
 * (`ProductSupervisorEnvelope<SystemSupervisorSnapshot>`). Aliased rather than
 * re-declared, so a server field change is a compile error here instead of a
 * silently blank column.
 */
export type SystemSourceCoverageSummary = SystemSupervisorSummaries['sourceCoverage'];

const SUPERVISOR_SOURCE = 'GET /api/product-integration/v1/supervisor · components[]';

/**
 * Owner rows are addressed by ARIA LEVEL, not by a private class or a data
 * attribute: OwnerRow publishes `aria-level={2}` on the row and `3` on its
 * expansion, and a group head here is level `1`. Document order therefore
 * equals `visibleIds` order — this file rendered both — so moving focus needs
 * no naming contract negotiated across the file boundary.
 */
const ROW_SELECTOR = 'tr[aria-level="2"]';

/* ---- the OwnerFact surface this ledger reads ------------------------------
   Narrowed and identity-typed, the same idiom OwnerRow and OwnerEvidence use:
   if the frozen producer type drifts, the gap surfaces as ONE named error here
   rather than as scattered property errors through the render tree. */

interface OwnerLedgerFactSurface {
  readonly id: string;
  readonly label: string;
  readonly group: WatchmanGroup;
  /** True when a SYSTEM_COMPONENT_IDS member is absent from snapshot.components. */
  readonly absent: boolean;
  /** Server-owned posture, already evidence-gated. Never re-derived here. */
  readonly state: Rung;
  readonly stale: boolean;
  /** NON-NULL for every adverse state; the chip enforces it at runtime. */
  readonly reason: string | null;
  /** The producer's own sentence for a row with no server projection. */
  readonly detail: string;
  /** Parity `WatchmanComponent.updatedAt`: lastAdvanceAtMs ?? heartbeatAtMs. */
  readonly observedAtMs: number | null;
  /** The real `ProductComponentProjection`, narrowed to the two fields this
   *  file reads. Null for the three locally-owned owners and for any
   *  SYSTEM_COMPONENT_IDS member the supervisor did not report. */
  readonly component: Readonly<{
    readonly capability: ProductCapability;
    readonly supportedControlIds: readonly string[];
  }> | null;
}

const ledgerFact = (fact: OwnerFact): OwnerLedgerFactSurface => fact;

/* ---- group order, labels and glyphs -------------------------------------- */

/**
 * Verbatim from the deleted modal (Header.tsx:2441, commit eb3934ba). THE KEY
 * ORDER IS THE SECTION ORDER — Control Path, Binance, Bot Runtime, Source
 * Network, Infrastructure — because that is the order an operator walks outward
 * from their own browser, not an alphabet.
 */
const GROUP_LABEL = {
  control_path: 'Control Path',
  binance: 'Binance',
  bot: 'Bot Runtime',
  sources: 'Source Network',
  infrastructure: 'Infrastructure',
} satisfies Record<WatchmanGroup, string>;

/** The modal's own sub-heads. Each states the charter the counter then audits. */
const GROUP_CHARTER = {
  control_path: 'This browser, the supervisor, and the write path it answers on',
  binance: 'Public venue feeds and the GET-only private adapter',
  bot: 'Strategy runtimes and the ledger they commit to',
  sources: 'Market Intelligence Sources · grouped upstream coverage and cache health',
  infrastructure: 'Deployment And Delivery · honest readiness; unconfigured channels stay disabled',
} satisfies Record<WatchmanGroup, string>;

/**
 * The SAME five glyphs OwnerRow puts in the row gutter, so a group and its
 * members share one silhouette. `--ink-3` always (§1.6 rule 2 / D19): hue lives
 * only inside a chip, and colouring a gutter is what previously put `--ok` and
 * `--warn` 0.3 Lc apart in dark — one state, in greyscale and under protanopia.
 */
const GROUP_GLYPH = {
  control_path: Wifi,
  binance: ArrowLeftRight,
  bot: Brain,
  sources: Newspaper,
  infrastructure: Shield,
} satisfies Record<WatchmanGroup, typeof Wifi>;

const GROUP_ORDER = Object.freeze(
  Object.keys(GROUP_LABEL) as readonly WatchmanGroup[],
);

/* ---- the coverage partition (§3.14) -------------------------------------- */

export type CoverageClass = 'proven' | 'withheld' | 'failing' | 'unknown';

/**
 * A TOTAL map over the rung ladder with NO DEFAULT BRANCH. `satisfies` is the
 * gate: an eighth rung added to StatusChip without a class here is a build
 * error, not a silent fall-through into whichever bucket a default picked —
 * and on this page the bucket a default picks is always the flattering one.
 *
 * UNAVAILABLE is `unknown`, not `failing`: "channel unavailable" is a statement
 * about our sight, not about the owner. NOT_CONFIGURED and OWNER_GATED are
 * `withheld`: authority deliberately not exercised is neither proof nor fault.
 */
const CLASS_OF_RUNG = {
  READY: 'proven',
  DEGRADED: 'failing',
  BLOCKED: 'failing',
  UNAVAILABLE: 'unknown',
  UNKNOWN: 'unknown',
  NOT_CONFIGURED: 'withheld',
  OWNER_GATED: 'withheld',
} satisfies Record<Rung, CoverageClass>;

/**
 * Capabilities under which the system is deliberately NOT exercising its
 * authority. §3.14: "`unenforced` counting as proven is the worst lie
 * available — it claims an authority the system is deliberately not
 * exercising." SHADOW and DRY_RUN observe without acting; REPLAY acts on a
 * recording. None of the three is evidence that the live path works.
 */
const UNENFORCED_CAPABILITIES: ReadonlySet<ProductCapability> = new Set<ProductCapability>([
  'SHADOW',
  'DRY_RUN',
  'REPLAY',
]);

type Demotion = 'UNENFORCED_CAPABILITY' | 'STALE_EVIDENCE';

interface Classified {
  readonly fact: OwnerFact;
  readonly view: OwnerLedgerFactSurface;
  readonly klass: CoverageClass;
  /** Non-null ONLY when this owner would otherwise have counted proven. */
  readonly demotion: Demotion | null;
}

/**
 * The counter can only ever DEMOTE, never promote — the same asymmetry the
 * owner model itself is built on.
 *
 *  1. STALE evidence moves proven → unknown, and NEVER toward a failure: a
 *     frozen reading is a statement about our sight, not proof of breakage
 *     (§3.14, "staleness demotes proven → absent").
 *  2. An UNENFORCED capability moves proven → withheld.
 *
 * Both are printed in the head when they fire, so the fraction can never
 * quietly become the flattering one.
 */
function classify(fact: OwnerFact): Classified {
  const view = ledgerFact(fact);
  const base = CLASS_OF_RUNG[view.state];
  if (base !== 'proven') return { fact, view, klass: base, demotion: null };
  if (view.stale) return { fact, view, klass: 'unknown', demotion: 'STALE_EVIDENCE' };
  const capability = view.component?.capability ?? null;
  if (capability !== null && UNENFORCED_CAPABILITIES.has(capability)) {
    return { fact, view, klass: 'withheld', demotion: 'UNENFORCED_CAPABILITY' };
  }
  return { fact, view, klass: 'proven', demotion: null };
}

const DEMOTION_PHRASE = {
  UNENFORCED_CAPABILITY: 'reads proven under a capability the system does not enforce',
  STALE_EVIDENCE: 'reads proven on evidence that has gone stale',
} satisfies Record<Demotion, string>;

/** Derived, never chosen (§3.14). Module scope so it is not a new identity on
 *  every render and cannot silently fall out of an effect's dependency list. */
const allProven = (section: Section): boolean => section.proven === section.population
  && section.population > 0;

/** Attention order: failing first, then unknown, then withheld, then proven. */
const ATTENTION_RANK = {
  failing: 0,
  unknown: 1,
  withheld: 2,
  proven: 3,
} satisfies Record<CoverageClass, number>;

/* ---- the age format law (§3.18) ------------------------------------------ */

/**
 * ONE unit, INTEGER, max three digits. Never `1h 04m`: mixed units put the unit
 * glyph at three different x positions, so the column right-aligns and is STILL
 * unreadable as a column — the exact failure §3.18's L5 exists to prevent.
 *
 * OwnerRow's `ageParts` is the same ladder returning the (value, unit) pair its
 * character grid needs. Both are exported so the integrator can collapse them
 * into MachineValue's duration scale, which Law 5 wants; importing across the
 * table/row boundary in either direction would create a module cycle.
 */
/* COLLAPSED AT INTEGRATION (Law 5). The ladder is MachineValue's — one
   implementation for the whole page, so a section head can never read `1m`
   above rows that read `59s` for the same instant. The named export stays: the
   surface's own section heads import `ageWord` from here. */
export { ageWord };

/* ---- section model ------------------------------------------------------- */

interface SectionAges {
  readonly oldestMs: number | null;
  readonly newestMs: number | null;
  readonly withoutProof: number;
}

interface Section {
  readonly group: WatchmanGroup;
  readonly rows: readonly Classified[];
  readonly population: number;
  readonly proven: number;
  readonly withheld: number;
  readonly failing: number;
  readonly unknown: number;
  readonly demotions: readonly Classified[];
  readonly ages: SectionAges;
  /** The worst-ranked member that is not proven — the one the head names. */
  readonly worst: Classified | null;
  /** Runtime self-audit: the four visible integers MUST sum to the population. */
  readonly partitionSound: boolean;
}

function measureAges(rows: readonly Classified[], nowMs: number): SectionAges {
  let oldest: number | null = null;
  let newest: number | null = null;
  let withoutProof = 0;
  for (const row of rows) {
    const at = row.view.observedAtMs;
    if (at === null) { withoutProof += 1; continue; }
    const age = Math.max(0, nowMs - at);
    if (oldest === null || age > oldest) oldest = age;
    if (newest === null || age < newest) newest = age;
  }
  return { oldestMs: oldest, newestMs: newest, withoutProof };
}

function buildSection(
  group: WatchmanGroup,
  members: readonly Classified[],
  sort: 'attention' | 'group',
  nowMs: number,
): Section {
  /* Array.prototype.sort is stable, so 'group' is the producer's parity order
     untouched — `[browser-session, ...canonical, binance-account, aws-runner]` —
     and 'attention' is that same order re-ranked by class. With seventeen owners
     an alphabet forces you to read all seventeen; deliberately NO
     change-magnitude sort, because that needs a per-owner previous-window
     baseline this page has no store for and synthesising one is fabricated data. */
  const rows = sort === 'group' ? members : [...members].sort((a, b) => {
    const rank = ATTENTION_RANK[a.klass] - ATTENTION_RANK[b.klass];
    if (rank !== 0) return rank;
    // Within a class the least provable reads first: no observation at all,
    // then the oldest observation. Both are measured, neither is a guess.
    const aAt = a.view.observedAtMs;
    const bAt = b.view.observedAtMs;
    if (aAt === null && bAt !== null) return -1;
    if (bAt === null && aAt !== null) return 1;
    if (aAt !== null && bAt !== null && aAt !== bAt) return aAt - bAt;
    return 0;
  });

  let proven = 0;
  let withheld = 0;
  let failing = 0;
  let unknown = 0;
  for (const row of rows) {
    if (row.klass === 'proven') proven += 1;
    else if (row.klass === 'withheld') withheld += 1;
    else if (row.klass === 'failing') failing += 1;
    else unknown += 1;
  }

  const worst = [...rows]
    .sort((a, b) => ATTENTION_RANK[a.klass] - ATTENTION_RANK[b.klass])
    .find((row) => row.klass !== 'proven') ?? null;

  return {
    group,
    rows,
    population: rows.length,
    proven,
    withheld,
    failing,
    unknown,
    demotions: rows.filter((row) => row.demotion !== null),
    ages: measureAges(rows, nowMs),
    worst,
    partitionSound: proven + withheld + failing + unknown === rows.length,
  };
}

/* ---- props --------------------------------------------------------------- */

/** Handed to the expansion factory so the ledger hosts OwnerEvidence without
 *  owning its per-owner slices (edges, root cause, attention queue). */
export interface OwnerEvidenceContext {
  readonly nowMs: number;
  readonly client: Readonly<ProductIntegrationClient>;
  readonly onRecordAttempt: (a: Omit<Attempt, 'id'>) => void;
  readonly onFocusOwner: (id: string) => void;
}

export interface OwnerLedgerProps {
  readonly owners: readonly OwnerFact[];
  readonly sourceCoverage: Fact<SystemSourceCoverageSummary>;
  readonly managedInventory: Fact<ProductManagedInventoryProjection>;
  readonly continuity: MaterialContinuity;
  readonly nowMs: number;
  readonly sort: 'attention' | 'group';
  readonly onSort: (next: 'attention' | 'group') => void;
  readonly expandedOwnerId: string | null;
  readonly focusedOwnerId: string | null;
  readonly onExpand: (id: string | null) => void;
  readonly onFocus: (id: string) => void;
  readonly controls: readonly ProductControlRegistryEntry[];
  readonly onFocusControl: (controlId: string) => void;
  readonly refreshBusyTarget: CanonicalRefreshTarget | null;
  readonly client: Readonly<ProductIntegrationClient>;
  readonly onRecordAttempt: (a: Omit<Attempt, 'id'>) => void;
  /** The expanded region. Absent ⇒ a row expands to OwnerRow's own register
   *  only; this file never fabricates evidence it was not handed. */
  readonly renderEvidence?: (fact: OwnerFact, ctx: OwnerEvidenceContext) => ReactNode;
}

/* ========================================================================== */

export function OwnerLedger(props: OwnerLedgerProps): JSX.Element {
  const {
    owners, sourceCoverage, managedInventory, continuity, nowMs,
    sort, onSort, expandedOwnerId, focusedOwnerId, onExpand, onFocus,
    controls, onFocusControl, refreshBusyTarget,
    client, onRecordAttempt, renderEvidence,
  } = props;

  const tableRef = useRef<HTMLTableElement | null>(null);

  /* ---- sections ---------------------------------------------------------- */

  const sections = useMemo<readonly Section[]>(() => {
    const classified = owners.map(classify);
    return GROUP_ORDER
      .map((group) => buildSection(
        group,
        classified.filter((row) => row.view.group === group),
        sort,
        nowMs,
      ))
      /* Modal parity: EMPTY SECTIONS ARE DROPPED. A head with no member is not a
         claim about anything, and an empty counter reads as coverage. */
      .filter((section) => section.population > 0);
  }, [owners, sort, nowMs]);

  /* ---- derived collapse, with a one-way latch (§3.14) ---------------------
     Collapse is DERIVED, never chosen: a section is collapsed iff
     `proven === population && population > 0`. So "the page looks fine" acquires
     a precise meaning — everything you cannot see is proven, and every section
     you can see has something to say.

     `latched` is the ONE-WAY memory that keeps a section open after it recovers,
     so the page can never quietly re-hide the thing that broke while you are
     reading it. `heldClosed` is the deferral: while a pointer or focus is inside
     the ledger, a section that newly leaves all-proven does not reflow the rows
     under the operator's hand. */

  const [latched, setLatched] = useState<readonly WatchmanGroup[]>([]);
  const [heldClosed, setHeldClosed] = useState<readonly WatchmanGroup[]>([]);
  const insideRef = useRef({ pointer: false, focus: false });

  const isOpen = useCallback(
    (section: Section): boolean => latched.includes(section.group)
      || (!allProven(section) && !heldClosed.includes(section.group)),
    [latched, heldClosed],
  );

  useEffect(() => {
    const next = sections
      .filter((section) => !allProven(section)
        && !heldClosed.includes(section.group)
        && !latched.includes(section.group))
      .map((section) => section.group);
    if (next.length > 0) setLatched((prev) => [...prev, ...next]);
  }, [sections, heldClosed, latched]);

  /* A blocker id anywhere else on the page can address an owner sitting inside
     an all-proven section. Honour the address rather than dropping it: open that
     section, one-way, so the jump never lands on nothing. */
  useEffect(() => {
    const addressed = expandedOwnerId ?? focusedOwnerId;
    if (addressed === null) return;
    const host = owners.find((owner) => ledgerFact(owner).id === addressed);
    if (host === undefined) return;
    const group = ledgerFact(host).group;
    setLatched((prev) => (prev.includes(group) ? prev : [...prev, group]));
  }, [expandedOwnerId, focusedOwnerId, owners]);

  const enterRegion = useCallback((channel: 'pointer' | 'focus') => {
    const wasInside = insideRef.current.pointer || insideRef.current.focus;
    insideRef.current[channel] = true;
    if (wasInside) return;
    setHeldClosed(sections.filter((section) => !isOpen(section)).map((section) => section.group));
  }, [sections, isOpen]);

  const leaveRegion = useCallback((channel: 'pointer' | 'focus') => {
    insideRef.current[channel] = false;
    if (insideRef.current.pointer || insideRef.current.focus) return;
    setHeldClosed([]);
  }, []);

  /* ---- roving tabindex (§4.7 / L23) --------------------------------------
     ONE tab stop for the whole table. Forty rows must never be forty tab stops —
     and must not be ZERO, which is exactly what a roving index with nothing at 0
     produces, so when the shell's `focusedOwnerId` names no visible row the
     first visible row holds the stop.

     ArrowUp/Down/Home/End are handled here and the event is STOPPED, because
     OwnerRow deliberately lets them bubble and a page shell may install a second
     normaliser; two models moving the same focus is one move too many.
     Enter/Space/Escape are NOT handled here — OwnerRow already owns them for its
     own row, and re-implementing them would be Law 5's exact failure. */

  const visibleIds = useMemo<readonly string[]>(
    () => sections.flatMap((section) => (isOpen(section)
      ? section.rows.map((row) => row.view.id)
      : [])),
    [sections, isOpen],
  );

  const firstVisibleId: string | undefined = visibleIds[0];
  const activeId: string | null = focusedOwnerId !== null && visibleIds.includes(focusedOwnerId)
    ? focusedOwnerId
    : firstVisibleId ?? null;

  useEffect(() => {
    const table = tableRef.current;
    if (table === null || activeId === null) return;
    const active = document.activeElement;
    // NEVER steal focus. Only re-seat it when it is already inside this table.
    if (!(active instanceof HTMLElement) || !table.contains(active)) return;
    const index = visibleIds.indexOf(activeId);
    if (index < 0) return;
    const target = table.querySelectorAll<HTMLElement>(ROW_SELECTOR)[index];
    if (target === undefined || target === active || target.contains(active)) return;
    target.focus();
    target.scrollIntoView({ block: 'nearest' });
  }, [activeId, visibleIds]);

  const onTableKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTableElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp'
      && event.key !== 'Home' && event.key !== 'End') return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    // Only the row itself drives the roving index: a control inside an expanded
    // row keeps its own keys, and an arrow inside a text input is not ours.
    if (!target.matches(ROW_SELECTOR)) return;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR));
    const index = rows.indexOf(target);
    if (index < 0 || rows.length === 0) return;

    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? rows.length - 1
        : event.key === 'ArrowDown' ? Math.min(index + 1, rows.length - 1)
          : Math.max(index - 1, 0);
    /* Stopped as well as prevented: OwnerRow deliberately lets these bubble, and
       a page shell may install a second roving normaliser above this table.
       Two models moving the same focus is one move too many. */
    event.preventDefault();
    event.stopPropagation();
    const id = visibleIds[nextIndex];
    if (id !== undefined && nextIndex !== index) onFocus(id);
  }, [visibleIds, onFocus]);

  /* ---- ledger-wide tallies, for the section receipt ----------------------- */

  const tally = useMemo(() => {
    let population = 0;
    let proven = 0;
    let withoutProof = 0;
    let oldest: number | null = null;
    for (const section of sections) {
      population += section.population;
      proven += section.proven;
      withoutProof += section.ages.withoutProof;
      const sectionOldest = section.ages.oldestMs;
      if (sectionOldest !== null && (oldest === null || sectionOldest > oldest)) {
        oldest = sectionOldest;
      }
    }
    return { population, proven, withoutProof, oldest };
  }, [sections]);

  /* ---- the jump every blocker id on this page shares ---------------------- */

  const jumpTo = useCallback((componentId: string) => {
    onFocus(componentId);
    onExpand(componentId);
  }, [onFocus, onExpand]);

  const evidenceContext = useMemo<OwnerEvidenceContext>(
    () => ({ nowMs, client, onRecordAttempt, onFocusOwner: jumpTo }),
    [nowMs, client, onRecordAttempt, jumpTo],
  );

  /* ---- render ------------------------------------------------------------ */

  const head = (
    <LedgerHead
      sort={sort}
      onSort={onSort}
      inert={owners.length === 0}
    />
  );

  if (owners.length === 0) {
    return (
      <div className="wdl">
        {head}
        <div className="wdl-body">
          <EmptyLedger continuity={continuity} sourceCoverage={sourceCoverage} />
        </div>
      </div>
    );
  }

  return (
    <div className="wdl">
      {head}

      <div
        className="wdl-body"
        onMouseEnter={() => enterRegion('pointer')}
        onMouseLeave={() => leaveRegion('pointer')}
        onFocus={() => enterRegion('focus')}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) leaveRegion('focus');
        }}
      >
        {continuity !== 'PROVEN' && (
          <p className="wd-t5 wdl-continuity">
            <b>Every count below is derived under material continuity {continuity}.</b>{' '}
            The binding forces each canonical owner to an outage posture regardless of its own
            evidence, so a failing figure here is ONE broken binding — not {tally.population}
            {' '}broken owners. Repair the cut before reading these fractions as owner health.
          </p>
        )}

        <table
          ref={tableRef}
          className="wdl-table"
          role="treegrid"
          aria-label="Owner ledger, grouped by connection group"
          onKeyDown={onTableKeyDown}
        >
          {/* §4.3 / D34: widths come from OwnerRow's own published column
              contract, so the head, every row and the section counters are
              physically incapable of disagreeing about where a column is. */}
          <colgroup>
            {OWNER_ROW_COLUMNS.map((column) => (
              <col key={column.id} style={{ width: column.width }} />
            ))}
          </colgroup>

          {/* §4.7 / D27: the page's ONE sticky object, at `--sticky-top` (0px).
              NEVER `--header-h`: `.app-main main` is the scroll container and the
              app header is a SIBLING ABOVE it, outside the scroller, so an offset
              buys 58px of dead band instead of clearance. */}
          <thead className="wdl-thead">
            <tr>
              {OWNER_ROW_COLUMNS.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={`wdl-h-${column.id}${column.numeric ? ' wd-col-num' : ''}${column.head === '' ? '' : ' wd-t3'}`}
                >
                  {column.head === ''
                    ? <span className="sr-only">{column.id === 'mark' ? 'Advance mark' : 'Owner kind'}</span>
                    : column.head}
                  {/* §3.12 COLUMN scale, and 100% OR SILENCE: in a grid, AT
                      re-announces the column header with every cell, so one line
                      here reaches every dark slot below with zero extra DOM, zero
                      ARIA and zero interaction. A header claiming "no proof"
                      while sixteen of seventeen rows have one would lie about the
                      seventeenth, so it only appears at unanimity. */}
                  {column.id === 'age' && (
                    tally.withoutProof === tally.population && tally.population > 0
                      ? <AbsenceColumnNote kind="UNAVAILABLE" population={tally.population} />
                      : <span className="wdl-colnote wd-t6">group: oldest over newest</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          {sections.map((section) => {
            const open = isOpen(section);
            /* `data-open` below carries no styling. It makes the DERIVED
               collapse state readable by a test, a DOM export or devtools
               without re-deriving it — the same reason MachineValue stamps
               `data-reason` on an unwritten slot. */
            return (
              <tbody key={section.group} className="wdl-group" data-open={open ? 'true' : 'false'}>
                <SectionHead
                  section={section}
                  open={open}
                  nowMs={nowMs}
                  sourceCoverage={sourceCoverage}
                  managedInventory={managedInventory}
                  refreshBusyTarget={refreshBusyTarget}
                  onJump={jumpTo}
                />
                {/* No per-row refresh, and that is a decision with a reason.
                    No server on this envelope publishes a component ->
                    refresh-target mapping; the deleted modal read one from
                    `/api/system`, which this page is forbidden to poll because
                    reading it MANUFACTURES the connection_alert ledger events
                    it would then display. Inventing the mapping in the browser
                    would be a fabricated binding, so the bounded public refresh
                    lives in the Recovery Console alone and the Source Network
                    head says so in words. The props that carried the mapping
                    were deleted rather than pinned to null: a permanently-off
                    gate is a dead control wearing a justification. */}
                {open && section.rows.map((row) => {
                  const expanded = expandedOwnerId === row.view.id;
                  return (
                    <OwnerRow
                      key={row.view.id}
                      fact={row.fact}
                      nowMs={nowMs}
                      continuity={continuity}
                      control={controlFor(controls, row.fact)}
                      expanded={expanded}
                      focused={activeId === row.view.id}
                      onExpand={(id) => onExpand(expandedOwnerId === id ? null : id)}
                      onFocus={onFocus}
                      onFocusControl={onFocusControl}
                      columnCount={OWNER_ROW_COLUMN_COUNT}
                    >
                      {expanded && renderEvidence !== undefined
                        ? renderEvidence(row.fact, evidenceContext)
                        : null}
                    </OwnerRow>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}

/** An owner's control is the registry entry the SERVER says it supports. No
 *  guess and no name matching: `component.supportedControlIds` is the join key,
 *  and an owner that declares a control absent from the published registry gets
 *  null here so OwnerRow can refuse it with the registry's own words. */
function controlFor(
  controls: readonly ProductControlRegistryEntry[],
  fact: OwnerFact,
): ProductControlRegistryEntry | null {
  const supported = ledgerFact(fact).component?.supportedControlIds ?? [];
  if (supported.length === 0) return null;
  return controls.find((control) => supported.includes(control.controlId)) ?? null;
}

/* ---- the section frame head (§3.18) -------------------------------------- */

/* INTEGRATION FIX (§4.1 + §3.14). This head used to carry `.wdf-head`, its own
   T2 title, its own source line and its own proven/population + stalest-age
   receipt — all four of which WatchdogSurface's section head already renders,
   from the hook's own measured partition. Mounted inside the shell that produced
   two heads, two source lines and two coverage receipts per section, and the two
   receipts were free to disagree because they counted different things.

   What survives is the only thing in it that the shell cannot know: the ONE
   control this section owns. It reorders what is already on screen and issues no
   request — which is exactly why it earns its place: with seventeen owners a
   fixed order forces you to read all seventeen to find the one that is failing.
   `tally` is gone from the props for the same reason the receipt is: a second
   count is not evidence, it is an opportunity to disagree. */
function LedgerHead({ sort, onSort, inert }: Readonly<{
  sort: 'attention' | 'group';
  onSort: (next: 'attention' | 'group') => void;
  inert: boolean;
}>): JSX.Element {
  return (
    <div className="wdl-order">
      <div className="wdl-sort" role="group" aria-label="Owner row order">
        <button
          type="button"
          className="wdb wdb--sm wdl-sortbtn"
          aria-pressed={sort === 'attention'}
          aria-disabled={inert || undefined}
          onClick={() => { if (!inert) onSort('attention'); }}
        >
          Attention
        </button>
        <button
          type="button"
          className="wdb wdb--sm wdl-sortbtn"
          aria-pressed={sort === 'group'}
          aria-disabled={inert || undefined}
          onClick={() => { if (!inert) onSort('group'); }}
        >
          Group order
        </button>
      </div>
      <p className="wd-t6 wdl-sortnote">
        {inert
          ? 'No rows to order.'
          : sort === 'attention'
            ? 'Each group reads failing, then unknown, then withheld, then proven.'
            : 'Each group reads in the order the owner model assembles it.'}
      </p>
    </div>
  );
}

/* ---- the coverage counter (§3.14) ---------------------------------------- */

/**
 * `n` is deliberately NOT `number | null`. These five integers are derived from
 * the rows this file is already rendering, so there is no state of the world in
 * which one of them is unmeasurable — and shipping an absence branch that can
 * never fire would put a dotted rule in the codebase with nothing behind it,
 * which is the same defect as a button with nothing behind it. The figure that
 * CAN be unmeasured on this head is the age, and it says so in words.
 *
 * A measured ZERO keeps full ink: `0 failing` is a complete answer, not an
 * absence (§3.12 `.st-none` — "a measured empty set is a COMPLETE ANSWER, no
 * demotion"). Greying it would teach the operator to distrust a true negative.
 */
function Figure({ n, unit }: Readonly<{ n: number; unit: string }>): JSX.Element {
  return (
    <span className="wdl-fig">
      <span className="wdl-fig-n wd-t4 wd-num">{n}</span>
      <span className="wdl-fig-u wd-t6">{unit}</span>
    </span>
  );
}

function SectionHead({
  section, open, nowMs, sourceCoverage, managedInventory, refreshBusyTarget, onJump,
}: Readonly<{
  section: Section;
  open: boolean;
  nowMs: number;
  sourceCoverage: Fact<SystemSourceCoverageSummary>;
  managedInventory: Fact<ProductManagedInventoryProjection>;
  refreshBusyTarget: CanonicalRefreshTarget | null;
  onJump: (componentId: string) => void;
}>): JSX.Element {
  const { ages, worst } = section;
  const Glyph = GROUP_GLYPH[section.group];
  const unenforced = section.demotions.filter((d) => d.demotion === 'UNENFORCED_CAPABILITY').length;
  const staleDemoted = section.demotions.filter((d) => d.demotion === 'STALE_EVIDENCE').length;
  const worstCount = worst === null ? 0
    : worst.klass === 'failing' ? section.failing
      : worst.klass === 'unknown' ? section.unknown
        : section.withheld;

  return (
    <tr aria-level={1} tabIndex={-1}>
      <th scope="rowgroup" colSpan={OWNER_ROW_COLUMN_COUNT} className="wdl-sec-cell">
        <div className="wdl-sec-head" data-defect={section.partitionSound ? undefined : 'true'}>
          <span className="wdl-sec-glyph"><Glyph size={12} aria-hidden className="wdl-glyph" /></span>

          <span className="wdl-sec-id">
            <b className="wd-t2">{GROUP_LABEL[section.group]}</b>
            <em className="wd-t6">{GROUP_CHARTER[section.group]}</em>
          </span>

          {/* THE EXHAUSTIVE PARTITION. Four class integers that sum to the
              printed population — the fraction the modal showed could not say
              which members were missing or why, which is the same reason
              Kubernetes ships READY 3/5 WITH `UP-TO-DATE` and `AVAILABLE`.
              The TRACK is the separation, so there are no middots. */}
          <span className="wdl-sec-count">
            <Figure n={section.population} unit="owners" />
            <Figure n={section.proven} unit="proven" />
            <Figure n={section.withheld} unit="withheld" />
            <Figure n={section.failing} unit="failing" />
            <Figure n={section.unknown} unit="unknown" />
          </span>

          {/* THE VERTICAL GATE. Oldest above newest, one `--col-age` track, one
              unit, both tabular, both MEASURED — a group-wide stall reads as two
              large numbers, one wedged owner as a large number over a small one.
              The comparison is vertical and needs no hue. A section is only as
              fresh as its stalest member, so the top figure is `max(ages)`. */}
          <span className="wdl-sec-age wd-col-num">
            {/* The pair is labelled per figure, not only in the column header:
                this head is a `colspan` region, so AT does NOT re-announce the
                age column header for it the way it does for a row's cell. */}
            <span className="wd-t4 wd-num">
              <span className="sr-only">Oldest member evidence: </span>
              {ages.withoutProof > 0
                ? (
                  <span className="wd-nodata wdl-noproof">
                    no proof
                    <span className="sr-only">
                      {' — '}{ages.withoutProof} of {section.population} owners in this group
                      published no evidence timestamp, so the group has no measurable oldest age.
                    </span>
                  </span>
                )
                : ages.oldestMs === null
                  ? <AbsenceSlot kind="void" srLabel="NO_MEMBER_OBSERVATION — no member age could be measured." />
                  : ageWord(ages.oldestMs)}
            </span>
            <span className="wd-t6 wd-num">
              <span className="sr-only">Newest member evidence: </span>
              {ages.newestMs === null
                ? <AbsenceSlot kind="void" srLabel="NO_MEMBER_OBSERVATION — no member published an evidence timestamp." />
                : ageWord(ages.newestMs)}
            </span>
          </span>

          {/* THE ONE IMPAIRED LINE. It names the count, the specific member and
              THE MEMBER'S OWN REASON. It invents no tone word: the class nouns
              are the counter's vocabulary, and the state vocabulary stays inside
              StatusChip where the row renders it. */}
          <p className="wd-t5 wdl-sec-line">
            {worst === null ? (
              <>
                All <b>{section.population}</b> owners proven.
                {open
                  ? ' Held open — this group was not all-proven earlier in this session.'
                  : ' Collapsed — nothing inside it needs a decision.'}
              </>
            ) : (
              <>
                <b>{worstCount} {worst.klass}</b>
                {' · '}
                <button
                  type="button"
                  className="wdl-jump"
                  onClick={() => onJump(worst.view.id)}
                  aria-label={`Focus and expand ${worst.view.label} in the owner ledger`}
                >
                  <span className="wd-id">{worst.view.id}</span>
                </button>
                {' — '}
                {worst.view.reason ?? worst.view.detail}
              </>
            )}
            {section.demotions.length > 0 && (
              <span className="wdl-sec-demote">
                {' '}
                <b>{section.demotions.length}</b> could not be counted proven:
                {unenforced > 0 && ` ${unenforced} ${DEMOTION_PHRASE.UNENFORCED_CAPABILITY}`}
                {unenforced > 0 && staleDemoted > 0 && ';'}
                {staleDemoted > 0 && ` ${staleDemoted} ${DEMOTION_PHRASE.STALE_EVIDENCE}`}
                {'. The fraction above is the demoted one.'}
              </span>
            )}
            {!section.partitionSound && (
              <span className="wdl-sec-demote">
                {' '}PARTITION_MISMATCH — the four class figures do not sum to the printed
                population. Treat every figure in this head as unproven.
              </span>
            )}
          </p>

          {section.group === 'sources' && (
            <SourceAddendum
              coverage={sourceCoverage}
              owners={section.population}
              nowMs={nowMs}
              refreshBusyTarget={refreshBusyTarget}
            />
          )}
          {section.group === 'infrastructure' && (
            <InfrastructureAddendum inventory={managedInventory} />
          )}
        </div>
      </th>
    </tr>
  );
}

/* ---- Source Network: the six coverage fields nothing has ever rendered ---- */

/** The sr-only reason NAMES ITS OWN FIELD rather than repeating one shared
 *  sentence six times: a screen-reader user arrowing the grid must be able to
 *  tell which figure is missing, and six identical announcements cannot. */
function CoverageFigure({ label, value, truth }: Readonly<{
  label: string;
  value: number | null;
  truth: string;
}>): JSX.Element {
  return (
    <div className="wdl-add-pair">
      <dt className="wd-t3">{label}</dt>
      <dd className="wd-t4 wd-num">
        {value === null
          ? (
            <AbsenceSlot
              kind="void"
              srLabel={`SOURCE_COVERAGE_FIELD_UNPUBLISHED — ${label} was not published on this cut; supervisor truth ${truth}.`}
            />
          )
          : value}
      </dd>
    </div>
  );
}

function SourceAddendum({ coverage, owners, nowMs, refreshBusyTarget }: Readonly<{
  coverage: Fact<SystemSourceCoverageSummary>;
  owners: number;
  nowMs: number;
  refreshBusyTarget: CanonicalRefreshTarget | null;
}>): JSX.Element {
  const summary = coverage.known ? coverage.value : null;
  const universe = summary?.universeSymbols ?? null;
  const truth = summary?.truthLabel ?? 'UNKNOWN';
  const gapAt = summary?.lastMaterialGapAtMs ?? null;
  /* Two DIFFERENT absences, and conflating them is the failure this page is
     about: the LANE never read (the whole summary is unavailable, and the
     paragraph below says why), versus the lane read and the SERVER did not
     publish that field on this cut. */
  const fieldUnread = `SOURCE_COVERAGE_FIELD_UNPUBLISHED — universeSymbols was not published on this cut; supervisor truth ${truth}.`;

  return (
    <div className="wdl-add">
      {/* Modal parity, and the literal matters: the deleted Sources tab printed
          "UNKNOWN Symbols" rather than a zero, and a zero here would read as a
          proven-empty universe — the exact false green this page exists to end. */}
      <p className="wd-t5 wdl-add-hero">
        <b>{owners} Canonical Source Owners</b>
        {' · '}
        <b className="wdl-add-symbols">{universe === null ? 'UNKNOWN' : universe} Symbols</b>
        {universe === null && coverage.known && (
          <span className="wdl-add-why"> — {fieldUnread}</span>
        )}
      </p>

      {!coverage.known ? (
        <p className="wd-t5 wdl-add-why">
          Coverage figures unavailable: {coverage.reason ?? 'REASON_MISSING — the producer broke the Fact contract'}
          {' · source '}<span className="wd-id">{coverage.source}</span>
        </p>
      ) : (
        <>
          <dl className="wdl-add-grid">
            <CoverageFigure label="Universe" value={universe} truth={truth} />
            <CoverageFigure label="Spot covered" value={summary?.spotCoveredSymbols ?? null} truth={truth} />
            <CoverageFigure label="USD-M covered" value={summary?.usdMCoveredSymbols ?? null} truth={truth} />
            <CoverageFigure label="Quiet retained" value={summary?.quietSymbolsRetained ?? null} truth={truth} />
            <CoverageFigure label="Material gaps" value={summary?.materialGapCount ?? null} truth={truth} />
            <CoverageFigure label="Rate limited" value={summary?.rateLimitedSourceCount ?? null} truth={truth} />
            <div className="wdl-add-pair">
              <dt className="wd-t3">Last gap</dt>
              <dd className="wd-t4 wd-num">
                {gapAt === null
                  ? (
                    <span className="wd-nodata wdl-noproof">
                      never
                      <span className="sr-only"> — no material coverage gap is recorded on this cut</span>
                    </span>
                  )
                  : `${ageWord(Math.max(0, nowMs - gapAt))} ago`}
              </dd>
            </div>
          </dl>
          <p className="wd-t6 wdl-add-why">
            Supervisor truth {truth} · <span className="wd-id">{coverage.source}</span>. A dotted
            slot was not published on this cut and is not a zero. The bounded public refresh for
            these sources is the Recovery Console: no server on this envelope publishes a
            component-to-refresh-target mapping, so this ledger offers no per-source refresh
            rather than a button aimed at a target it guessed.
            {refreshBusyTarget !== null && (
              <>
                {' '}The console is refreshing{' '}
                <span className="wd-id">{refreshBusyTarget}</span> now, so these figures are
                mid-flight.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}

/* ---- Infrastructure: the census of the census, and this page's own role --- */

function InfrastructureAddendum({ inventory }: Readonly<{
  inventory: Fact<ProductManagedInventoryProjection>;
}>): JSX.Element {
  if (!inventory.known || inventory.value === null) {
    return (
      <div className="wdl-add">
        <p className="wd-t5 wdl-add-why">
          Managed inventory unavailable: {inventory.reason ?? 'REASON_MISSING — the producer broke the Fact contract'}
          {' · source '}<span className="wd-id">{inventory.source}</span>. This ledger cannot audit
          its own completeness on this cut, so read every count above as a census of what was
          reported, not of what exists.
        </p>
      </div>
    );
  }

  const projection = inventory.value;
  const observed = projection.observedCanonicalComponentCount;
  const expected = projection.canonicalComponentCount;
  const self = projection.entries.find((entry) => entry.identity === 'external-watchdog') ?? null;

  return (
    <div className="wdl-add">
      <p className="wd-t5 wdl-add-hero">
        <b>Canonical components observed</b>{' '}
        <span className="wd-num">{observed}</span>
        {' / '}
        <span className="wd-num">{expected}</span>
        {observed < expected && (
          <span className="wdl-add-why">
            {' '}— the supervisor did not report {expected - observed}. Every unreported id is a
            MISSING row above, never an omission from this census.
          </span>
        )}
      </p>

      {/* THE KEYSTONE. This page is a watchdog; the managed inventory states
          whether anything watches IT. Rendering that is the exact opposite of
          flattering, and it is the one fact on this page that indicts the page. */}
      <p className="wd-t5 wdl-add-self">
        <b>This page&rsquo;s own role</b>{' · '}
        <span className="wd-id">external-watchdog</span>{' — '}
        {self === null ? (
          <>absent from the managed inventory. No owner is declared for it, so nothing on this
            server attests that this page is itself being watched.</>
        ) : (
          <>
            {self.inventoryState}
            {self.reasonCode !== null && <> · <span className="wd-id">{self.reasonCode}</span></>}
            {' · owner '}<span className="wd-id">{self.owner}</span>
          </>
        )}
      </p>
    </div>
  );
}

/* ---- §3.13 the unmet measurement contract -------------------------------- */

function Obligation({ label, children }: Readonly<{
  label: string;
  children: ReactNode;
}>): JSX.Element {
  return (
    <div className="wdl-obl">
      <dt className="wd-t3">{label}</dt>
      <dd className="wd-t4">{children}</dd>
    </div>
  );
}

/**
 * The subject is not the missing data but WHAT THIS SECTION PROMISED TO MEASURE,
 * against which window, on whose authority, and what is at stake while it
 * cannot. The mandatory row set, in the fixed order §3.13 gives it.
 *
 * EXPOSURE GOES FIRST on evidence grounds: the owner query failed, but exposure
 * is renderable precisely when nothing else is. Here it is genuinely UNKNOWN —
 * capital relevance is carried per owner and there are no owners — so it stays
 * HUELESS. Only a proven ACTIVE exposure may take the one hue an empty panel is
 * allowed, and claiming it here would be the same invention this page exists to
 * remove, pointed the other way.
 */
function EmptyLedger({ continuity, sourceCoverage }: Readonly<{
  continuity: MaterialContinuity;
  sourceCoverage: Fact<SystemSourceCoverageSummary>;
}>): JSX.Element {
  return (
    /* Namespaced, not `.wd-empty`: this file owns its own geometry rather than
       racing an unrelated sheet at equal specificity for the same properties. */
    <div className="wd-empty wdl-empty" data-flush="true" role="status">
      <dl className="wdl-obls">
        <Obligation label="Exposure">
          <span className="wdl-exposure" data-exposure="unknown">UNKNOWN</span>
          <span className="wd-t5 wdl-obl-why">
            {' '}Capital relevance is carried per owner. With no owner rows this ledger cannot say
            whether anything is exposed — read it as unproven, never as safe.
          </span>
        </Obligation>
        <Obligation label="Window">
          <span className="wd-t5">Every supervisor envelope, continuously, for as long as the page is open.</span>
        </Obligation>
        <Obligation label="Last proof">
          <span className="wd-nodata wdl-noproof">
            never<span className="sr-only"> — this session has not yet rendered a populated owner census</span>
          </span>
        </Obligation>
        <Obligation label="Source">
          <span className="wd-id">{SUPERVISOR_SOURCE}</span>
        </Obligation>
        <Obligation label="Unmeasured for">
          <span className="wd-nodata wdl-noproof">
            no proof
            <span className="sr-only">
              {' — '}the first successful census has not happened, so there is no interval to
              measure from. A duration here would be invented.
            </span>
          </span>
        </Obligation>
        <Obligation label="Next">
          <span className="wd-t5">The control-room provider re-reads the envelope every 5 seconds.</span>
        </Obligation>
        <Obligation label="Reason">
          <span className="wd-t5">
            OWNER_MODEL_EMPTY — the owner producer returned no rows. Material continuity is{' '}
            <b>{continuity}</b>
            {!sourceCoverage.known && <>, and the dashboard summary is also unread ({sourceCoverage.reason})</>}.
          </span>
        </Obligation>
        {/* §3.13's control rule table: the operator can only wait on a clock, so
            this panel renders NO CONTROL and says so. Making the refusal legible
            beats leaving it merely absent. */}
        <Obligation label="Action">
          <span className="wd-t5">
            NONE — CLOCK ONLY. Nothing an operator can press repairs this; the next envelope either
            carries components or states why it does not.
          </span>
        </Obligation>
      </dl>
      <p className="wd-empty-byline">
        <span>owners[]</span>
        <span>length 0</span>
        <span>continuity {continuity}</span>
        <span>{SUPERVISOR_SOURCE}</span>
      </p>
    </div>
  );
}
