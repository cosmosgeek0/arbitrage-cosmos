import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AbsenceColumnNote,
  AbsenceSlot,
  StatusChip,
  rungFromLane,
  type Rung,
} from './StatusChip';
import { Identifier, Numeric, Sparkline } from './MachineValue';
import {
  knownFact,
  unknownFact,
  type Attempt,
  type Fact,
  type Lane,
  type LoopLagFacts,
  type MaterialContinuity,
  type ProductRuntimeWatchdogStats,
  type TransportLaneFact,
} from './watchdogEvidence';
import type { MaterialEventPage } from '../../lib/productIntegration';
import './ObserverEvidence.css';

/* =============================================================================
   ObserverEvidence — §6, cluster 4 (EVIDENCE), and the LAST thing on the page.
   -----------------------------------------------------------------------------
   This section audits the page's own ability to see. It is placed last because
   it is the meta-tier that audits the other three, and a page that opens on its
   own trustworthiness has already lost the operator.

   FOUR QUESTIONS, AND IT REFUSES TO ANSWER ANYTHING ELSE
     1. Is the server's loop keeping up?             -> loop lag
     2. Is the server's builder keeping up?          -> envelope build
     3. Am I actually receiving?                     -> delivery channel
     4. Am I holding the cut the server publishes?   -> cut identity

   plus two evidentiary sub-parts: this browser's own transport lanes, each with
   a real probe, and the transcript of every request this page has completed.

   HOW THE DOCTRINE LANDS HERE
   - Nothing is derived from a coincidence. Every chip is driven by a fact a
     server published (`lastBuildError`, `staleServedCount`, `continuity`,
     `digestPrefix8`) or a measurement this browser recorded
     (`PerformanceResourceTiming.duration`, a settled Attempt). There is
     deliberately NO band-level "transport failed" note: §3.10 forbids deriving
     one from four coincident cell failures, and this band reads two different
     lanes, so no single band-scale transport fact exists to render.
   - `loopLag {0,0,0}` is the empty-ring literal — server/src/index.ts:4521
     returns it verbatim when the ring holds no samples — so it renders UNKNOWN
     with LOOP_LAG_RING_EMPTY. It is never `0 ms`.
   - No age is computed from a server-embedded timestamp. Ages come from `nowMs`
     (the hook's single 1000ms operator clock) minus a CLIENT-recorded receipt
     time. `cache.ageMs` is printed exactly as the server stated it, labelled as
     such, and never ticked — the regression pinned by
     web/test/productControlRoom/dashboard-age-clock.test.mjs is that passing a
     snapshot its own timestamp makes every age read `0s ago` forever, so a
     wedged supervisor serving its last cut looks identical to a live one.
   - This section owns no live region: the page has exactly one and it is in
     VerdictHeader (§4.7). A probe's outcome is therefore real DOM text next to
     the button that caused it, bound with `aria-describedby`. Never a toast,
     never optimistic.
   - This section issues no request of its own. `onProbe` and `onReReadEnvelope`
     are the shell's write lanes, and the outcome is READ BACK out of
     `attempts` — the same ring the transcript renders. The result on a lane row
     and the entry in the transcript are the same record, never two.
   ========================================================================== */

/**
 * The transport fuse is not a design choice: `web/src/lib/http.ts:77` aborts
 * every request this app issues at 10 s. That is the declared commitment a lane
 * is measured against and the anchor its sparkline is scaled to (§3.15 — no
 * declared fuse, no anchored scale, no chart).
 *
 * TRANSPORT_ALERT_MS is the one page-chosen band on this surface, so it is
 * printed in the sub-part's provenance line rather than buried in a predicate:
 * an operator can see exactly where CLOSE begins.
 *
 * Ported verbatim from the retired Watchdog.tsx so the verdict survives that
 * file's rewrite, and exported so a test can pin it.
 */
export const TRANSPORT_FUSE_MS = 10_000;
export const TRANSPORT_ALERT_MS = 8_000;

/* DELETED: this file's own `FuseVerdict` type and `transportFuseVerdict()`.
   The hook publishes the verdict as `TransportLaneFact.fuse`, a Fact carrying
   its own source and reason, and this section now reads that Fact. Two
   implementations of one threshold is exactly how a row and a section head come
   to disagree about the same lane. */

/** How much of the server's `currentMs` this tab has personally witnessed. A
 *  display window, never a threshold: history begins at mount, and §3.15
 *  forbids blaming the pipeline for slots that could never have been filled,
 *  so the count is printed as `n of 24` rather than implied by empty slots. */
const LAG_RING_MAX = 24;

/** The transcript opens on the newest five and expands to the whole ring. */
const TRANSCRIPT_HEAD = 5;

const WATCHDOG_SOURCE = 'GET /api/watchdog';

// ---- the one duration scale on this surface --------------------------------
// Law 5 wants ONE duration scale for the page and nothing in the roster
// publishes a safe one: the house `timeAgo`/`liveAge` call `Date.now()`
// internally — which is exactly what the age-clock regression forbids — and
// return an em dash for null, which D37 forbids because NVDA reads a dash as
// nothing at all. Exported so the page converges on this rather than growing a
// second one.
//
// It is used in PROSE (sentences, reasons, the section's evidence age) and in
// the `--col-age` track, which §3.14 itself renders as `52m`. It is never used
// in a numeric column: those go through `Numeric`, one column one unit.

export function durationLabel(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 1_000) return `${Math.round(clamped)}ms`;
  if (clamped < 90_000) return `${Math.round(clamped / 1_000)}s`;
  if (clamped < 3_600_000) return `${Math.round(clamped / 60_000)}m`;
  if (clamped < 86_400_000) return `${Math.round(clamped / 3_600_000)}h`;
  return `${Math.round(clamped / 86_400_000)}d`;
}

/** `null` in, `null` out. An age is never defaulted to 0 and never to "now". */
function ageMs(atMs: number | null | undefined, nowMs: number): number | null {
  return typeof atMs === 'number' && Number.isFinite(atMs) ? Math.max(0, nowMs - atMs) : null;
}

/** Refuses anything that is not an exact finite number. A field that cannot be
 *  read exactly stays null, and null renders its reason — never a zero. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/* DELETED: this file's `digestPrefix8()`. The hook already mirrors the server's
   cut-identity rule once, as `envelopeCutPrefix`, and publishes the comparison
   as `staleTabCutFact` — which is what the page's live region speaks from. A
   second derivation here meant one implementation drove the utterance and
   another drove the visible cell, and the two could disagree. */

// ---- Facts -----------------------------------------------------------------
// Every rendered datum crosses into `Numeric` as a Fact, so an unread number
// arrives carrying the reason it is unread instead of arriving as a bare null
// that cannot explain itself.

function laneReasonOf(lane: Lane<unknown>, fallback: string): string {
  return lane.reason ?? `LANE_REASON_MISSING:${fallback}`;
}

function laneNumFact(lane: Lane<unknown>, value: unknown, field: string): Fact<number> {
  const source = `${WATCHDOG_SOURCE} · ${field}`;
  if (lane.state === 'LOADING') return unknownFact<number>(laneReasonOf(lane, 'LOADING'), source);
  if (lane.state === 'UNAVAILABLE') return unknownFact<number>(laneReasonOf(lane, 'UNAVAILABLE'), source);
  const exact = num(value);
  if (exact === null) return unknownFact<number>(`FIELD_NOT_FINITE:${field}`, source);
  return knownFact<number>(exact, source, lane.observedAtMs);
}

function plainNumFact(value: unknown, source: string, observedAtMs: number | null, absentReason: string): Fact<number> {
  const exact = num(value);
  return exact === null
    ? unknownFact<number>(absentReason, source)
    : knownFact<number>(exact, source, observedAtMs);
}

// ---- the state ladder ------------------------------------------------------
// StatusChip owns the vocabulary. This file owns only the ORDER, because a cell
// with several adverse facts must chip at the worst one while still printing
// every reason. Nothing is hidden behind the escalation.

const RUNG_ORDER = {
  READY: 0,
  UNKNOWN: 1,
  NOT_CONFIGURED: 1,
  OWNER_GATED: 2,
  DEGRADED: 3,
  UNAVAILABLE: 3,
  BLOCKED: 4,
} as const satisfies Record<Rung, number>;

/* DELETED AT INTEGRATION: `CoverageClass` and `COVERAGE_CLASS`, the rung -> class
   map that fed this section's own §3.14 partition. The partition is the hook's
   (`sections.observer`) and is printed once, by WatchdogSurface's section head.
   A per-file copy of the ladder is a second place for an added rung to fall
   through into a flattering class. */

interface Verdict {
  readonly rung: Rung;
  /** Orthogonal to the rung: a lane can be READY *and* stale. */
  readonly stale: boolean;
  /** Full sentences, in reading order. The band's chips carry these directly;
   *  in the lane table they are the row's own T5 reason line. */
  readonly reasons: readonly ReactNode[];
  /** The same facts as grep-able reason CODES.
   *
   *  This exists because of a real constraint, not for symmetry. StatusChip
   *  enforces REASON_REQUIRED at runtime — an adverse chip with no reason
   *  renders hatched — but the lane table's fuse column is 22ch, and a
   *  full sentence inside it either towers or destroys the shared right edge.
   *  So the chip carries the CODE (which fits, and which an operator can grep
   *  into a ticket) and the row's own reason line carries the sentence that
   *  expands it. That is §3.12's code-to-copy relation, not a duplicate. */
  readonly codes: readonly string[];
}

function verdict(
  rung: Rung,
  reasons: readonly ReactNode[] = [],
  codes: readonly string[] = [],
  stale = false,
): Verdict {
  return { rung, reasons, codes, stale };
}

/** Escalate to the worst rung, keep every reason, in discovery order. */
function worst(candidates: readonly Verdict[]): Verdict {
  let chosen = candidates[0];
  for (const candidate of candidates) {
    if (RUNG_ORDER[candidate.rung] > RUNG_ORDER[chosen.rung]) chosen = candidate;
  }
  return {
    rung: chosen.rung,
    stale: candidates.some((candidate) => candidate.stale),
    reasons: candidates.flatMap((candidate) => candidate.reasons),
    codes: candidates.flatMap((candidate) => candidate.codes),
  };
}

/**
 * Compose the lane's own read state with the cell's content verdict.
 *
 * `rungFromLane(lane, proven)` is doing the load-bearing work: passing the
 * CONTENT rung as `proven` means CURRENT yields the content verdict, STALE
 * yields it with `stale: true`, LOADING yields UNKNOWN and a failed read yields
 * UNAVAILABLE — without this file re-implementing any of those four branches.
 *
 * When the lane itself failed, the content reasons are suppressed: they are
 * statements about data this tab does not have.
 */
function readVerdict(lane: Lane<unknown>, content: Verdict, nowMs: number): Verdict {
  const read = rungFromLane(lane, content.rung);
  if (lane.state === 'LOADING' || lane.state === 'UNAVAILABLE') {
    return verdict(read.rung, [<>{read.reason}</>], [read.reason ?? 'LANE_REASON_MISSING']);
  }
  if (!read.stale) return verdict(read.rung, content.reasons, content.codes);
  const since = ageMs(lane.lastSuccessAtMs, nowMs);
  return verdict(
    read.rung,
    [
      ...content.reasons,
      <>
        {read.reason}
        {since === null
          ? ' · this lane has never succeeded'
          : ` · last success ${durationLabel(since)} ago`}
      </>,
    ],
    [...content.codes, read.reason ?? 'LANE_STALE'],
    true,
  );
}

// ---- props -----------------------------------------------------------------

export interface ObserverEvidenceProps {
  readonly stats: Lane<ProductRuntimeWatchdogStats>;
  readonly lagSamplesProven: boolean;
  /** The hook's own loop-lag Facts. Never `stats.value.loopLag` (§ its docblock). */
  readonly loopLag: LoopLagFacts;
  /** The ONE cut-divergence comparison — the same three Facts the page's live
   *  region speaks from. This section renders them; it does not recompute them. */
  readonly publishedCutPrefix: Fact<string>;
  readonly envelopeCutPrefix: Fact<string>;
  readonly staleTabCutFact: Fact<boolean>;
  readonly envelopeDigest: Fact<string>;
  readonly materialEvents: Fact<MaterialEventPage>;
  readonly continuity: MaterialContinuity;
  readonly socketConnected: boolean;
  readonly transport: Lane<readonly TransportLaneFact[]>;
  readonly transportBuffer: {
    readonly state: 'DRAINED' | 'OVERFLOWED';
    readonly clearedAtMs: number | null;
  };
  readonly attempts: readonly Attempt[];
  readonly attemptsExpanded: boolean;
  readonly onToggleAttempts: (next: boolean) => void;
  readonly probeBusyLaneId: string | null;
  readonly onProbe: (laneId: string) => void;
  readonly onReReadEnvelope: () => void;
  readonly nowMs: number;
}

// =============================================================================

export function ObserverEvidence(props: ObserverEvidenceProps): JSX.Element {
  const {
    stats,
    lagSamplesProven,
    loopLag,
    publishedCutPrefix,
    envelopeCutPrefix,
    staleTabCutFact,
    envelopeDigest,
    materialEvents,
    continuity,
    socketConnected,
    transport,
    transportBuffer,
    attempts,
    attemptsExpanded,
    onToggleAttempts,
    probeBusyLaneId,
    onProbe,
    onReReadEnvelope,
    nowMs,
  } = props;

  const uid = useId();
  const bodyId = `${uid}-body`;
  const logId = `${uid}-log`;

  // -- the local loop-lag ring ------------------------------------------------
  // Each entry is a `currentMs` the server published and this tab personally
  // received, keyed on the lane's own CLIENT-recorded receipt time so a repeat
  // render can never append the same reading twice. Nothing is synthesised and
  // nothing is carried forward: a lane that stops producing simply stops
  // extending the ring.
  const [lagRing, setLagRing] = useState<readonly number[]>([]);
  const lagRingRef = useRef<readonly number[]>([]);
  const lagAtRef = useRef<number | null>(null);

  const lagCurrentRaw = num(stats.value?.loopLag.currentMs);
  const lagObservedAt = stats.observedAtMs;

  /* No read, no claim. Every reading register below branches on this before it
     says anything about what the server did or did not publish. */
  const statsUnread = stats.state === 'LOADING' || stats.state === 'UNAVAILABLE';
  const statsUnreadSay =
    stats.state === 'LOADING'
      ? 'The first watchdog owner read is still in flight'
      : 'The watchdog owner read failed';

  useEffect(() => {
    if (!lagSamplesProven || lagCurrentRaw === null || lagObservedAt === null) return;
    if (lagAtRef.current === lagObservedAt) return;
    lagAtRef.current = lagObservedAt;
    const next = [...lagRingRef.current, lagCurrentRaw].slice(-LAG_RING_MAX);
    lagRingRef.current = next;
    setLagRing(next);
  }, [lagSamplesProven, lagCurrentRaw, lagObservedAt]);

  // ===========================================================================
  // BAND CELL 1 · LOOP LAG
  // ===========================================================================
  const lagP95Raw = num(stats.value?.loopLag.p95Ms);
  const lagMaxRaw = num(stats.value?.loopLag.maxMs);
  const uptimeSec = num(stats.value?.process.uptimeSec);

  /* The empty-ring gate is the whole point of this cell. `lagSamplesProven` is
     the hook's reading of `process.uptimeSec >= 1`; until it holds, the
     server's `{0, 0, 0}` is a literal the snapshot function returns when the
     ring is empty, not three measurements of zero. */
  /* The three Facts come from the hook's `loopLag`, which is the SANCTIONED
     reader — its own docblock says "read THIS, never `stats.value.loopLag`".
     This file used to re-implement the empty-ring gate here with a bare
     `LOOP_LAG_RING_EMPTY` reason string, so there were two implementations of
     one rule and the sanctioned one had no consumer at all. The raw reads above
     survive only as the ring sample and the verdict predicates, which are this
     section's own and are not published by the hook. */
  const lagP95 = loopLag.p95Ms;
  const lagCurrent = loopLag.currentMs;
  const lagMax = loopLag.maxMs;

  const lagVerdict: Verdict = useMemo(() => {
    if (!lagSamplesProven && !statsUnread) {
      return readVerdict(
        stats,
        verdict('UNKNOWN', [
          <>
            <b>LOOP_LAG_RING_EMPTY</b> — the sampler has published no measurement, so the
            server&apos;s <code className="wd-id">{'{0, 0, 0}'}</code> is the empty-ring literal
            and not a reading of zero.
            {uptimeSec === null
              ? ' Server uptime is unread.'
              : ` Server uptime ${Math.round(uptimeSec)}s.`}
          </>,
        ], ['LOOP_LAG_RING_EMPTY']),
        nowMs,
      );
    }
    if (lagP95Raw === null) {
      return readVerdict(
        stats,
        verdict('UNKNOWN', [<>Ring is proven but <b>p95Ms</b> did not read as a finite number.</>], ['FIELD_NOT_FINITE:loopLag.p95Ms']),
        nowMs,
      );
    }
    return readVerdict(stats, verdict('READY'), nowMs);
  }, [stats, statsUnread, lagSamplesProven, lagP95Raw, uptimeSec, nowMs]);

  // ===========================================================================
  // BAND CELL 2 · ENVELOPE BUILD
  // ===========================================================================
  const build = stats.value?.envelopeBuild ?? null;
  const buildAtRaw = num(build?.lastBuildCompletedAtMs);
  const buildError = text(build?.lastBuildError);
  const buildsStartedRaw = num(build?.buildsStarted);
  const buildsSucceededRaw = num(build?.buildsSucceeded);
  const staleServedRaw = num(build?.staleServedCount);
  const buildInFlight = typeof build?.inFlight === 'boolean' ? build.inFlight : null;

  const buildDuration = laneNumFact(stats, build?.lastBuildDurationMs, 'envelopeBuild.lastBuildDurationMs');
  const staleServed = laneNumFact(stats, build?.staleServedCount, 'envelopeBuild.staleServedCount');
  const buildsOutstanding = laneNumFact(
    stats,
    buildsStartedRaw === null || buildsSucceededRaw === null ? null : buildsStartedRaw - buildsSucceededRaw,
    'buildsStarted − buildsSucceeded',
  );

  const buildVerdict: Verdict = useMemo(() => {
    /* `projectWatchdogOwnerStats` ALWAYS constructs an `envelopeBuild` object,
       falling back to the payload root, so `build === null` was unreachable and
       the two adverse checks below were both skipped when the fields were
       simply absent — a `200 {}` therefore chipped a green READY with no reason
       beside the reading "No build duration has been recorded", and an
       unpublished `staleServedCount` read as a proven zero. READY now requires
       that the block actually carried something. */
    const buildFieldsRead = buildError !== null
      || buildAtRaw !== null
      || buildsStartedRaw !== null
      || buildsSucceededRaw !== null
      || staleServedRaw !== null
      || buildInFlight !== null
      || buildDuration.known;
    if (!buildFieldsRead) {
      return readVerdict(
        stats,
        verdict('UNKNOWN', [
          <>
            The read succeeded and its <b>envelopeBuild</b> block carried no readable field — no
            duration, no completion instant, no counters, no error and no in-flight flag. Nothing
            about the builder is proven from here, which is not the same claim as a builder that is
            idle.
          </>,
        ], ['ENVELOPE_BUILD_FIELDS_UNPUBLISHED']),
        nowMs,
      );
    }
    const found: Verdict[] = [];
    if (staleServedRaw === null) {
      /* An unpublished counter is not a zero. Without this the cell reads READY
         while the one number that would prove past-TTL serving was never sent. */
      found.push(
        verdict('UNKNOWN', [
          <>
            The block published no <b>staleServedCount</b>, so whether any past-TTL cut has been
            served since boot is unread — it is not a measured zero.
          </>,
        ], ['STALE_SERVED_COUNT_UNPUBLISHED']),
      );
    }
    if (buildError !== null) {
      found.push(
        verdict('BLOCKED', [
          <>
            The builder replays <code className="wd-id">{buildError}</code> on every read until a
            later build succeeds, so this is a standing failure and not a blip.
          </>,
        ], [buildError]),
      );
    }
    if (staleServedRaw !== null && staleServedRaw > 0) {
      found.push(
        verdict('DEGRADED', [
          <>
            <b>{staleServedRaw}</b> past-TTL cut{staleServedRaw === 1 ? ' was' : 's were'} served
            since boot — a reader asked for the envelope and got an expired one.
          </>,
        ], ['PAST_TTL_CUT_SERVED']),
      );
    }
    if (found.length === 0) found.push(verdict('READY'));
    return readVerdict(stats, worst(found), nowMs);
  }, [stats, buildError, buildAtRaw, buildsStartedRaw, buildsSucceededRaw, staleServedRaw, buildInFlight, buildDuration.known, nowMs]);

  // ===========================================================================
  // BAND CELL 3 · DELIVERY CHANNEL
  // ===========================================================================
  const wsClients = laneNumFact(stats, stats.value?.wsClients, 'wsClients');
  const page = materialEvents.known ? materialEvents.value : null;
  const pageContinuity = text(page?.continuity);
  const truncated = typeof page?.truncated === 'boolean' ? page.truncated : null;
  const backfillRequired = typeof page?.backfillRequired === 'boolean' ? page.backfillRequired : null;
  const missingRange = page?.missingRange ?? null;
  const hasMore = typeof page?.hasMore === 'boolean' ? page.hasMore : null;

  const deliveryVerdict: Verdict = useMemo(() => {
    const found: Verdict[] = [];

    // Server-owned truth about the stream. Never re-derived, only rendered.
    if (continuity === 'BLOCKED') {
      found.push(
        verdict('BLOCKED', [
          <>Binding continuity is <b>BLOCKED</b> — the material stream cannot be proven continuous.</>,
        ], ['BINDING_CONTINUITY_BLOCKED']),
      );
    } else if (continuity === 'BACKFILL') {
      found.push(
        verdict('DEGRADED', [
          <>Binding continuity is <b>BACKFILL</b> — history is being replayed to close a gap.</>,
        ], ['BINDING_CONTINUITY_BACKFILL']),
      );
    } else if (continuity === 'UNPROVEN') {
      found.push(
        verdict('UNKNOWN', [
          <>Binding continuity is <b>UNPROVEN</b> — no cursor proof has been established yet.</>,
        ], ['BINDING_CONTINUITY_UNPROVEN']),
      );
    }

    if (!materialEvents.known) {
      found.push(
        verdict('UNKNOWN', [
          <>Material event page unread: {materialEvents.reason ?? 'FACT_REASON_MISSING'}</>,
        ], [materialEvents.reason ?? 'FACT_REASON_MISSING']),
      );
    } else {
      if (backfillRequired === true) {
        found.push(
          verdict('BLOCKED', [
            <>
              The page declares <b>backfillRequired</b>: events are missing from the delivered
              range and this tab has not seen them.
            </>,
          ], ['BACKFILL_REQUIRED']),
        );
      }
      if (missingRange !== null) {
        found.push(
          verdict('BLOCKED', [
            <>
              Declared missing range <code className="wd-id">{missingRange.fromCursor}</code> to{' '}
              <code className="wd-id">{missingRange.toCursor}</code> ({missingRange.reason}).
            </>,
          ], [missingRange.reason]),
        );
      }
      if (truncated === true) {
        found.push(
          verdict('DEGRADED', [
            <>The delivered page is <b>truncated</b> — it is not the whole range that was asked for.</>,
          ], ['MATERIAL_PAGE_TRUNCATED']),
        );
      }
    }

    /* The store initialises `connected` to false, so this can never manufacture
       a green: an unproven socket reads as not connected, which is the safe
       direction, and it is stated rather than implied. */
    if (!socketConnected) {
      found.push(
        verdict('DEGRADED', [
          <>
            <b>SOCKET_NOT_CONNECTED</b> — this tab holds no delivery socket, so every value on
            this page arrived by polling and nothing is being pushed to it.
          </>,
        ], ['SOCKET_NOT_CONNECTED']),
      );
    }

    if (found.length === 0) found.push(verdict('READY'));
    return worst(found);
  }, [continuity, materialEvents, backfillRequired, missingRange, truncated, socketConnected]);

  // ===========================================================================
  // BAND CELL 4 · CUT IDENTITY
  // The page's strongest anti-stale device. "Updated 3s ago" proves the READ was
  // recent; it cannot prove the read returned the CURRENT cut. This can.
  // ===========================================================================
  /* Both prefixes come from the HOOK's Facts, which are the same two the page's
     live region announces from. They used to be re-derived here with this
     file's own `digestPrefix8`, so one comparison drove the utterance and a
     second, independent one drove the visible verdict — and two implementations
     of one measurement can disagree, which is a live region announcing a
     divergence the cell below it does not show. */
  const serverPrefix = publishedCutPrefix.known ? publishedCutPrefix.value : null;
  const heldPrefix = envelopeCutPrefix.known ? envelopeCutPrefix.value : null;
  const cacheAge = laneNumFact(stats, stats.value?.cache.ageMs, 'cache.ageMs');
  const cutMatched = staleTabCutFact.known ? staleTabCutFact.value === false : null;

  const cutVerdict: Verdict = useMemo(() => {
    if (serverPrefix === null && !statsUnread) {
      return readVerdict(
        stats,
        verdict('UNKNOWN', [
          <>
            <b>cache.digestPrefix8</b> is null — the supervisor has published no cut since boot,
            so there is nothing to compare this tab against.
          </>,
        ], ['CACHE_DIGEST_PREFIX_UNREAD']),
        nowMs,
      );
    }
    if (heldPrefix === null) {
      return readVerdict(
        stats,
        verdict('UNKNOWN', [
          <>Envelope digest unread: {envelopeDigest.reason ?? 'FACT_REASON_MISSING'}</>,
        ], [envelopeDigest.reason ?? 'FACT_REASON_MISSING']),
        nowMs,
      );
    }
    if (statsUnread || heldPrefix === null || serverPrefix === null) {
      return readVerdict(
        stats,
        verdict('UNKNOWN', [<>No cut comparison was possible on this read.</>], ['CUT_NOT_COMPARED']),
        nowMs,
      );
    }
    if (cutMatched === false) {
      return readVerdict(
        stats,
        verdict('BLOCKED', [
          <>
            The supervisor publishes <code className="wd-id">{serverPrefix}</code>; this tab is
            rendering <code className="wd-id">{heldPrefix}</code>. Every value above was computed
            from a cut the server has already replaced.
          </>,
        ], ['CUT_SUPERSEDED']),
        nowMs,
      );
    }
    return readVerdict(stats, verdict('READY'), nowMs);
  }, [stats, statsUnread, serverPrefix, heldPrefix, cutMatched, envelopeDigest.reason, nowMs]);

  // ===========================================================================
  // TRANSPORT LANES
  // ===========================================================================
  const lanes = transport.value;

  const laneRows = useMemo(
    () =>
      (lanes ?? []).map((lane) => {
        // The hook already published these as Facts, each carrying its own
        // source, instant and — when unread — its own reason. Re-deriving them
        // here is what broke them: passing a Fact OBJECT through `num()` yields
        // null for every lane, so every number rendered NO_SAMPLES_IN_BUFFER
        // even with a full buffer, and the fuse verdict became unreachable.
        // The Facts are now consumed as published; nothing is recomputed.
        const lastMsRaw = lane.lastMs.known ? lane.lastMs.value : null;
        return {
          laneId: lane.laneId,
          label: lane.label,
          probePath: lane.probePath,
          samples: lane.samples,
          sampleCount: lane.sampleCount,
          lastMsRaw,
          /** The hook's own verdict, never a second computation of it. */
          fuse: lane.fuse.known ? lane.fuse.value : null,
          fuseReason: lane.fuse.reason,
          last: lane.lastMs,
          median: lane.medianMs,
          max: lane.maxMs,
          wire: lane.wireBytes,
        };
      }),
    [lanes],
  );

  const laneVerdicts = useMemo(
    () =>
      laneRows.map((row): Verdict => {
        if (row.sampleCount === 0) {
          return readVerdict(
            transport,
            verdict('UNKNOWN', [
              <>
                <b>NO SAMPLES IN BUFFER</b> — this browser recorded no request on the lane since
                the resource-timing buffer was last cleared. Probe it to produce one.
              </>,
            ], ['NO_SAMPLES_IN_BUFFER']),
            nowMs,
          );
        }
        if (row.fuse === 'BLOWN') {
          return readVerdict(
            transport,
            verdict('BLOCKED', [
              <>
                The last read reached the {durationLabel(TRANSPORT_FUSE_MS)} request fuse
                {row.lastMsRaw === null ? '' : ` at ${Math.round(row.lastMsRaw)} ms`} — a request
                on this lane is being aborted rather than answered.
              </>,
            ], ['TRANSPORT_FUSE_BLOWN']),
            nowMs,
          );
        }
        if (row.fuse === 'CLOSE' && row.lastMsRaw !== null) {
          return readVerdict(
            transport,
            verdict('DEGRADED', [
              <>
                The last read of {Math.round(row.lastMsRaw)} ms leaves{' '}
                {Math.round(TRANSPORT_FUSE_MS - row.lastMsRaw)} ms before the{' '}
                {durationLabel(TRANSPORT_FUSE_MS)} fuse aborts it.
              </>,
            ], ['TRANSPORT_FUSE_CLOSE']),
            nowMs,
          );
        }
        if (row.fuse === null) {
          return readVerdict(
            transport,
            verdict('UNKNOWN', [
              <>
                The lane holds samples but the drain published no fuse verdict for it:{' '}
                {row.fuseReason ?? 'FUSE_VERDICT_UNPUBLISHED_WITH_NO_REASON'}.
              </>,
            ], [row.fuseReason ?? 'FUSE_VERDICT_UNPUBLISHED_WITH_NO_REASON']),
            nowMs,
          );
        }
        return readVerdict(transport, verdict('READY'), nowMs);
      }),
    [laneRows, transport, nowMs],
  );

  /** The newest settled attempt on this lane's probe path, read back out of the
   *  attempt ring rather than held locally — so a row and the transcript can
   *  never disagree, and nothing renders before a response or a caught error
   *  actually exists. */
  const probeReadback = useCallback(
    (probePath: string): Attempt | null => {
      let newest: Attempt | null = null;
      for (const attempt of attempts) {
        if (attempt.path !== probePath) continue;
        if (newest === null || attempt.atMs > newest.atMs) newest = attempt;
      }
      return newest;
    },
    [attempts],
  );

  // ===========================================================================
  // §3.14 COVERAGE COUNTER
  // An exhaustive partition whose visible integers sum to the printed
  // population. The population is this section's own measurement obligations —
  // four band checks plus one per declared transport lane — because the subject
  // of this section is precisely how much of the page's sight is intact.
  // ===========================================================================
  // DELETED AT INTEGRATION with this section's duplicate head: `bandVerdicts`,
  // `coverage` and `population` — a second §3.14 partition over this section's
  // measurement obligations, printed thirty pixels below the shell's, which
  // counts `sections.observer` as the hook measured it. One population, one
  // counter (§3.14). `laneVerdicts` survives: each lane row still wears its own
  // chip, which is a per-row verdict and not a section tally.

  // -- the section's evidence age: the STALEST member, named ------------------
  // §3.14: a section is only as fresh as its stalest member. Naming the member
  // is what makes the age actionable instead of ambient.
  const evidence = useMemo(() => {
    const members: readonly { readonly label: string; readonly atMs: number | null }[] = [
      { label: 'watchdog owner read', atMs: stats.observedAtMs },
      { label: 'transport drain', atMs: transport.observedAtMs },
      { label: 'envelope digest', atMs: envelopeDigest.observedAtMs },
      { label: 'material event page', atMs: materialEvents.observedAtMs },
    ];
    const unread = members.filter((member) => ageMs(member.atMs, nowMs) === null);
    if (unread.length > 0) {
      return { age: null, say: `${unread.length} of ${members.length} never read` };
    }
    let stalest = members[0];
    let stalestAge = ageMs(members[0].atMs, nowMs) ?? 0;
    for (const member of members) {
      const age = ageMs(member.atMs, nowMs) ?? 0;
      if (age > stalestAge) {
        stalestAge = age;
        stalest = member;
      }
    }
    return { age: durationLabel(stalestAge), say: `oldest: ${stalest.label}` };
  }, [stats.observedAtMs, transport.observedAtMs, envelopeDigest.observedAtMs, materialEvents.observedAtMs, nowMs]);

  /* -- collapse is the SHELL's, and was deleted from here at integration -----
     This file ran a complete second copy of the derived-collapse machine — an
     `allProven` default, a one-way auto-expand on the flip out of all-proven, a
     pointer/focus deferral and its own disclosure button — INSIDE
     WatchdogSurface's, which runs the same machine off the hook's measured
     `sections.observer`. Two owners of one region's visibility means it can be
     open by one and hidden by the other, and it put a second disclosure button
     and a second coverage counter thirty pixels under the first (§4.1, §3.14).
     `coverage` and `population` survive because the transport column notes and
     the band still read them. */

  // -- transcript -------------------------------------------------------------
  // Sorted, never synthesised: an entry exists only because a request settled.
  const transcript = useMemo(() => [...attempts].sort((a, b) => b.atMs - a.atMs), [attempts]);
  const shown = attemptsExpanded ? transcript : transcript.slice(0, TRANSCRIPT_HEAD);

  // -- §3.12 COLUMN scale — 100% or silence -----------------------------------
  // A head claiming "not measured" while one row has a value lies about that
  // row, so the note is only earned on unanimity, and it carries the shared
  // reason CODE rather than a friendlier sentence an operator cannot grep.
  const columnNote = (facts: readonly Fact<number>[]): string | null => {
    if (facts.length === 0) return null;
    if (facts.some((fact) => fact.known)) return null;
    const first = facts[0].reason;
    return facts.every((fact) => fact.reason === first) ? (first ?? 'void') : 'void';
  };

  const noteLast = columnNote(laneRows.map((row) => row.last));
  const noteMedian = columnNote(laneRows.map((row) => row.median));
  const noteMax = columnNote(laneRows.map((row) => row.max));
  const noteWire = columnNote(laneRows.map((row) => row.wire));

  const bufferClearedAge = ageMs(transportBuffer.clearedAtMs, nowMs);

  return (
    <div className="obsx">
      {/* The section head — title, ordinal, §3.14 partition, evidence source and
          stalest-evidence age — is WatchdogSurface's, and there is exactly one
          per section. This file's own copy was deleted at integration.

          ONE line of it was kept and moved here rather than deleted: the shell's
          head prints HOW OLD the stalest evidence in this section is, but only
          this file knows WHICH of its four reads is the stale one, and "the
          transport drain stopped" and "the envelope digest stopped" are
          different failures with different next actions. It draws no container
          and states its absence rather than implying it. */}
      <p className="wd-t6 obsx-stalest">
        {evidence.age === null
          ? <span className="wd-nodata">{evidence.say}</span>
          : <>Stalest evidence in this section: <b className="wd-num">{evidence.age}</b> · {evidence.say}</>}
      </p>
      <div className="obsx-body" id={bodyId}>
        {/* ============ PART 1 · SERVER SELF-OBSERVATION ==================== */}
        <h4 className="wd-t3 obsx-part">Server self-observation</h4>

        <div className="mx">
          <div className="mx-band">
            {/* -- cell 1 · LOOP LAG -- */}
            <div className="mx-cell" role="group" aria-labelledby={`${uid}-lag`}>
              <span className="wd-t3 mx-name" id={`${uid}-lag`}>Loop lag p95</span>
              {lagP95.known ? (
                <span className="wd-t1 mx-reading" data-reading="value">
                  <span className="mx-num wd-num">{lagP95.value}</span>
                  <span className="mx-unit">ms</span>
                </span>
              ) : (
                <span className="wd-t5 mx-reading" data-reading="reason">
                  {statsUnread
                    ? statsUnreadSay
                    : lagSamplesProven
                      ? 'Loop lag read but not finite'
                      : 'The sampler has published nothing'}
                </span>
              )}
              <div className="mx-warrant">
                <StatusChip
                  size="band"
                  state={lagVerdict.rung}
                  stale={lagVerdict.stale}
                  reason={<Reasons of={lagVerdict.reasons} />}
                />
              </div>
              <dl className="wd-fields mx-facts">
                <Field label="current">
                  <Numeric fact={lagCurrent} unit="ms" digits={2} />
                </Field>
                <Field label="max in ring">
                  <Numeric fact={lagMax} unit="ms" digits={2} />
                </Field>
                <Field label="witnessed here">
                  <LagHistory
                    ring={lagRing}
                    commitment={lagMaxRaw}
                    rung={lagVerdict.rung}
                  />
                </Field>
              </dl>
            </div>

            {/* -- cell 2 · ENVELOPE BUILD -- */}
            <div className="mx-cell" role="group" aria-labelledby={`${uid}-build`}>
              <span className="wd-t3 mx-name" id={`${uid}-build`}>Envelope build</span>
              {buildDuration.known ? (
                <span className="wd-t1 mx-reading" data-reading="value">
                  <span className="mx-num wd-num">{buildDuration.value}</span>
                  <span className="mx-unit">ms</span>
                </span>
              ) : (
                <span className="wd-t5 mx-reading" data-reading="reason">
                  {statsUnread ? statsUnreadSay : 'No build duration has been recorded'}
                </span>
              )}
              <div className="mx-warrant">
                <StatusChip
                  size="band"
                  state={buildVerdict.rung}
                  stale={buildVerdict.stale}
                  reason={<Reasons of={buildVerdict.reasons} />}
                />
              </div>
              <dl className="wd-fields mx-facts">
                <Field label="completed">
                  {buildAtRaw === null ? (
                    <span className="wd-nodata">never</span>
                  ) : (
                    <>{durationLabel(ageMs(buildAtRaw, nowMs) ?? 0)} ago</>
                  )}
                </Field>
                <Field label="in flight">
                  {buildInFlight === null ? (
                    <AbsenceSlot kind="void" srLabel="BUILD_IN_FLIGHT_UNREAD" />
                  ) : buildInFlight ? (
                    'yes — a build is running now'
                  ) : (
                    'no'
                  )}
                </Field>
                <Field label="started, not succeeded">
                  <span className="obsx-inline">
                    <Numeric fact={buildsOutstanding} />
                    {buildsOutstanding.known && buildsStartedRaw !== null ? (
                      <span className="wd-t6">
                        of {buildsStartedRaw} — failures plus any build in flight
                      </span>
                    ) : null}
                  </span>
                </Field>
                <Field label="past-TTL cuts served">
                  <Numeric fact={staleServed} />
                </Field>
              </dl>
            </div>

            {/* -- cell 3 · DELIVERY CHANNEL -- */}
            <div className="mx-cell" role="group" aria-labelledby={`${uid}-delivery`}>
              <span className="wd-t3 mx-name" id={`${uid}-delivery`}>Delivery channel</span>
              {wsClients.known ? (
                <span className="wd-t1 mx-reading" data-reading="value">
                  <span className="mx-num wd-num">{wsClients.value}</span>
                  <span className="mx-unit">clients</span>
                </span>
              ) : (
                <span className="wd-t5 mx-reading" data-reading="reason">
                  {statsUnread ? statsUnreadSay : 'The server did not report a delivery client count'}
                </span>
              )}
              <div className="mx-warrant">
                <StatusChip
                  size="band"
                  state={deliveryVerdict.rung}
                  stale={deliveryVerdict.stale}
                  reason={<Reasons of={deliveryVerdict.reasons} />}
                />
              </div>
              <dl className="wd-fields mx-facts">
                <Field label="this tab's socket">
                  {socketConnected ? 'connected' : 'not connected'}
                </Field>
                <Field label="page continuity">
                  {pageContinuity ?? <AbsenceSlot kind="void" srLabel="MATERIAL_PAGE_UNREAD" />}
                </Field>
                <Field label="binding continuity">{continuity}</Field>
                <Field label="delivered range">
                  {!materialEvents.known ? (
                    <span className="wd-nodata">no proof</span>
                  ) : missingRange === null && truncated === false && backfillRequired === false ? (
                    <>no gap declared{hasMore === true ? ' · more events are waiting' : ''}</>
                  ) : (
                    <>gap declared — the reason is above</>
                  )}
                </Field>
              </dl>
            </div>

            {/* -- cell 4 · CUT IDENTITY -- */}
            <div className="mx-cell" role="group" aria-labelledby={`${uid}-cut`}>
              <span className="wd-t3 mx-name" id={`${uid}-cut`}>Cut identity</span>
              {cutMatched === true ? (
                <span className="wd-t1 mx-reading" data-reading="value">CUT MATCHED</span>
              ) : cutMatched === false ? (
                <span className="wd-t5 mx-reading" data-reading="reason" data-tone="bad">
                  THIS TAB IS HOLDING A REPLACED CUT
                </span>
              ) : (
                <span className="wd-t5 mx-reading" data-reading="reason">
                  {statsUnread
                    ? statsUnreadSay
                    : serverPrefix === null
                      ? 'The supervisor has published no cut'
                      : 'This tab has no digest to compare'}
                </span>
              )}
              <div className="mx-warrant">
                <StatusChip
                  size="band"
                  state={cutVerdict.rung}
                  stale={cutVerdict.stale}
                  reason={<Reasons of={cutVerdict.reasons} />}
                />
              </div>
              <dl className="wd-fields mx-facts">
                <Field label="server publishes">
                  {serverPrefix === null ? (
                    <AbsenceSlot kind="void" srLabel="CACHE_DIGEST_PREFIX_UNREAD" />
                  ) : (
                    <Identifier kind="raw" value={serverPrefix} label="published cut prefix" />
                  )}
                </Field>
                <Field label="this tab holds">
                  {envelopeDigest.known && typeof envelopeDigest.value === 'string' ? (
                    <Identifier kind="digest" value={envelopeDigest.value} label="envelope digest this tab is rendering" />
                  ) : (
                    <AbsenceSlot kind="void" srLabel={envelopeDigest.reason ?? 'ENVELOPE_DIGEST_UNREAD'} />
                  )}
                </Field>
                <Field label="cache age at read">
                  <span className="obsx-inline">
                    <Numeric fact={cacheAge} unit="ms" />
                    {cacheAge.known ? (
                      <span className="wd-t6">measured by the server, not ticked here</span>
                    ) : null}
                  </span>
                </Field>
                {cutMatched === false ? (
                  <div className="wd-field obsx-field-act">
                    <dt className="wd-t3">next</dt>
                    <dd>
                      <button type="button" className="wdb wdb--sm is-clipped" onClick={onReReadEnvelope}>
                        <span className="wdb-label">Re-read envelope</span>
                      </button>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>
        </div>

        {/* ============ PART 2 · BROWSER TRANSPORT LANES ==================== */}
        <h4 className="wd-t3 obsx-part">Browser transport lanes</h4>
        <p className="wd-t6 obsx-prov">
          A passive read of this tab&apos;s own{' '}
          <code className="wd-id">PerformanceResourceTiming</code> entries, rounded to whole
          milliseconds — no lane below adds network load. The fuse is{' '}
          {durationLabel(TRANSPORT_FUSE_MS)}, the request lifetime{' '}
          <code className="wd-id">lib/http</code> aborts at, and a lane reads DEGRADED inside the
          last {durationLabel(TRANSPORT_FUSE_MS - TRANSPORT_ALERT_MS)} of it. Buffer{' '}
          {transportBuffer.state === 'OVERFLOWED' ? 'OVERFLOWED' : 'drained'}
          {bufferClearedAge === null
            ? ', never cleared'
            : `, cleared ${durationLabel(bufferClearedAge)} ago`}.
        </p>
        {transportBuffer.state === 'OVERFLOWED' ? (
          <p className="wd-t5 obsx-alarm">
            The browser&apos;s resource-timing buffer overflowed between drains. Median and max
            below omit an unknown number of samples and understate this tab&apos;s worst case.
          </p>
        ) : null}

        {laneRows.length === 0 ? (
          <p className="wd-t5 obsx-alarm" data-kind={transport.state === 'CURRENT' ? 'complete' : undefined}>
            {transport.state === 'UNAVAILABLE'
              ? `No lane can be measured: ${laneReasonOf(transport, 'UNAVAILABLE')}`
              : transport.state === 'LOADING'
                ? 'The first resource-timing drain has not completed, so no lane has been declared yet.'
                : 'The drain completed and declared no transport lanes, so there is nothing on this page to probe.'}
          </p>
        ) : (
          <div className="obsx-scroll" role="region" aria-label="Browser transport lanes" tabIndex={0}>
            <table className="wd-table obsx-lanes">
              <caption className="sr-only">
                Browser transport lanes, with last, median and maximum request duration, wire
                bytes, fuse verdict, recent history, and a per-lane probe.
              </caption>
              <colgroup>
                <col className="obsx-c-lane" />
                <col className="obsx-c-num" />
                <col className="obsx-c-num" />
                <col className="obsx-c-num" />
                <col className="obsx-c-wire" />
                <col className="obsx-c-fuse" />
                <col className="obsx-c-hist" />
                <col className="obsx-c-probe" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="wd-t3">Lane</th>
                  <ColHead label="Last" note={noteLast} population={laneRows.length} />
                  <ColHead label="Median" note={noteMedian} population={laneRows.length} />
                  <ColHead label="Max" note={noteMax} population={laneRows.length} />
                  <ColHead label="Wire" note={noteWire} population={laneRows.length} />
                  <th scope="col" className="wd-t3">Fuse</th>
                  <th scope="col" className="wd-t3">History</th>
                  <th scope="col" className="wd-t3">Probe</th>
                </tr>
              </thead>
              {laneRows.map((row, index) => {
                const state = laneVerdicts[index];
                const readback = probeReadback(row.probePath);
                const busy = probeBusyLaneId === row.laneId;
                const resultId = `${uid}-probe-${row.laneId}`;
                return (
                  <tbody className="obsx-entry" key={row.laneId}>
                    <tr className="wd-row">
                      <td>
                        <span className="wd-t4 obsx-lane-name">{row.label}</span>
                        <span className="wd-t6 obsx-lane-sub">
                          {row.probePath} · {row.sampleCount} observed
                        </span>
                      </td>
                      <td className="wd-col-num"><Numeric fact={row.last} unit="ms" /></td>
                      <td className="wd-col-num"><Numeric fact={row.median} unit="ms" /></td>
                      <td className="wd-col-num"><Numeric fact={row.max} unit="ms" /></td>
                      <td className="wd-col-num"><Numeric fact={row.wire} unit="B" /></td>
                      <td>
                        <StatusChip
                          state={state.rung}
                          stale={state.stale}
                          reason={<Codes of={state.codes} />}
                        />
                      </td>
                      <td>
                        {row.sampleCount === 0 ? (
                          <AbsenceSlot kind="void" srLabel="NO_SAMPLES_IN_BUFFER" />
                        ) : (
                          <Sparkline
                            samples={row.samples}
                            commitment={{ good: 0, fuse: TRANSPORT_FUSE_MS }}
                            rung={state.rung}
                          />
                        )}
                      </td>
                      <td className="obsx-td-probe">
                        <button
                          type="button"
                          className={`wdb wdb--sm is-clipped${busy ? ' is-pending' : ''}`}
                          aria-label={`Probe the ${row.label} lane with one read-only GET on ${row.probePath}`}
                          aria-busy={busy}
                          aria-describedby={readback === null ? undefined : resultId}
                          onClick={() => { if (!busy) onProbe(row.laneId); }}
                        >
                          <span className="wdb-label">Probe</span>
                          {busy ? <span className="wdb-spin" aria-hidden="true" /> : null}
                        </button>
                        <span className="wd-t6 obsx-probe-result" id={resultId}>
                          <span className="sr-only">Last probe: </span>
                          {readback === null ? (
                            <span className="wd-nodata">not probed from this page</span>
                          ) : (
                            <ProbeReadback attempt={readback} nowMs={nowMs} />
                          )}
                        </span>
                      </td>
                    </tr>
                    {state.reasons.length > 0 ? (
                      <tr className="obsx-why-row">
                        <td className="wd-why" colSpan={8}>
                          <Reasons of={state.reasons} />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}

        {/* ============ PART 3 · ATTEMPT TRANSCRIPT ========================= */}
        <div className="obsx-part-row">
          <h4 className="wd-t3 obsx-part" id={`${uid}-log-title`}>Attempt transcript</h4>
          {transcript.length > TRANSCRIPT_HEAD ? (
            <button
              type="button"
              className="wdb wdb--sm wdb--tertiary"
              aria-expanded={attemptsExpanded}
              aria-controls={logId}
              onClick={() => onToggleAttempts(!attemptsExpanded)}
            >
              <span className="wdb-label">
                {attemptsExpanded
                  ? `Show newest ${TRANSCRIPT_HEAD}`
                  : `Show all ${transcript.length}`}
              </span>
            </button>
          ) : null}
        </div>

        {transcript.length === 0 ? (
          <p className="wd-t5 obsx-alarm" data-kind="complete">
            No attempt has settled. This page has issued no probe and no mutation since it
            mounted, and an entry appears here only after a response or an error actually exists —
            so an empty transcript is a complete answer rather than a missing one.
          </p>
        ) : (
          <table className="wd-table obsx-log" id={logId}>
            <caption className="sr-only">
              Every request this page has completed, newest first, with the status the server
              returned, the measured elapsed time, and the age of the attempt.
            </caption>
            <colgroup>
              <col className="obsx-c-req" />
              <col className="obsx-c-status" />
              <col className="obsx-c-num" />
              <col className="obsx-c-age" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="wd-t3">Request</th>
                <th scope="col" className="wd-t3 wd-col-num">Status</th>
                <th scope="col" className="wd-t3 wd-col-num">Elapsed</th>
                <th scope="col" className="wd-t3 wd-col-num">Age</th>
              </tr>
            </thead>
            {shown.map((attempt, index) => {
              const status = num(attempt.status);
              const detail = text(attempt.detail);
              const age = ageMs(attempt.atMs, nowMs);
              const elapsed = plainNumFact(
                attempt.elapsedMs,
                `${attempt.method} ${attempt.path} · elapsedMs`,
                attempt.atMs,
                'ELAPSED_NOT_RECORDED',
              );
              return (
                <tbody className="obsx-entry" key={`${attempt.atMs}-${attempt.path}-${index}`}>
                  <tr className="wd-row">
                    <td>
                      <span className="wd-t4 obsx-req">
                        <span className="obsx-method">{attempt.method}</span>
                        <span className="wd-id obsx-path">{attempt.path}</span>
                      </span>
                      <span className="wd-t6 obsx-lane-sub">{attempt.kind}</span>
                    </td>
                    <td className="wd-col-num wd-t4 wd-num">
                      {status === null ? (
                        <span className="wd-nodata">no response</span>
                      ) : (
                        String(status)
                      )}
                    </td>
                    <td className="wd-col-num"><Numeric fact={elapsed} unit="ms" /></td>
                    <td className="wd-col-num wd-t6 wd-num">
                      {age === null ? (
                        <span className="wd-nodata">no clock</span>
                      ) : (
                        durationLabel(age)
                      )}
                    </td>
                  </tr>
                  {detail !== null ? (
                    <tr className="obsx-why-row">
                      <td className="wd-why" colSpan={4}>{detail}</td>
                    </tr>
                  ) : null}
                </tbody>
              );
            })}
          </table>
        )}
      </div>
    </div>
  );
}

/* =============================================================================
   Local presentational helpers.
   These are GEOMETRY, not vocabulary: every state word still comes from
   StatusChip and every machine value from MachineValue.
   ========================================================================== */

/** Every reason, in reading order, as real DOM text. Never a title attribute,
 *  never a tooltip, never truncated to nothing. */
function Reasons({ of }: { readonly of: readonly ReactNode[] }): JSX.Element | null {
  if (of.length === 0) return null;
  return (
    <>
      {of.map((reason, index) => (
        <span className="obsx-reason" key={index}>{reason}</span>
      ))}
    </>
  );
}

/** The same facts as codes, for the chip that has no room for the sentence.
 *  Rendered as real DOM text so StatusChip's REASON_REQUIRED invariant is
 *  satisfied by a reason an operator can actually paste into a ticket. */
function Codes({ of }: { readonly of: readonly string[] }): JSX.Element | null {
  if (of.length === 0) return null;
  return (
    <>
      {of.map((code, index) => (
        <code className="wd-id obsx-code" key={index}>{code}</code>
      ))}
    </>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }): JSX.Element {
  return (
    <div className="wd-field">
      <dt className="wd-t3">{label}</dt>
      <dd className="wd-t4">{children}</dd>
    </div>
  );
}

/* DELETED AT INTEGRATION: `CoverageFigure`, which rendered this section's own
   duplicate coverage counter. WatchdogSurface owns the one on the page. */

/** A column head that grows its own reason line once every slot beneath it is
 *  dark. In `role="table"` AT re-announces a column header with every cell, so
 *  all N dark cells inherit the reason with no extra DOM and no interaction. */
function ColHead({
  label,
  note,
  population,
}: {
  readonly label: string;
  readonly note: string | null;
  readonly population: number;
}): JSX.Element {
  return (
    <th scope="col" className="wd-t3 wd-col-num">
      {label}
      {note === null ? null : <AbsenceColumnNote kind={note} population={population} />}
    </th>
  );
}

/**
 * The loop-lag history this tab has personally witnessed.
 *
 * The commitment is `loopLag.maxMs` — the supervisor's own published worst, and
 * one of the three real budgets §3.15 licenses. There is no designer-chosen
 * band: if `maxMs` is unread there is no anchor, and an unanchored mark may not
 * borrow an anchored one's authority, so no chart is drawn and the absence says
 * why. `Sparkline` itself returns null below two measured points, so the guard
 * here is what keeps that from rendering as an empty cell.
 */
function LagHistory({
  ring,
  commitment,
  rung,
}: {
  readonly ring: readonly number[];
  readonly commitment: number | null;
  readonly rung: Rung;
}): JSX.Element {
  if (commitment === null || commitment === 0) {
    return (
      <span className="wd-nodata wd-t6">
        no anchored scale — loopLag.maxMs is unread, so no chart is drawn
      </span>
    );
  }
  if (ring.length < 2) {
    return (
      <span className="wd-nodata wd-t6">
        {ring.length} of {LAG_RING_MAX} readings witnessed since this page mounted
        {ring.length === 0
          ? ' — no history exists yet'
          : ' — one point shows no trend and invites one'}
      </span>
    );
  }
  return (
    <span className="obsx-spark">
      <Sparkline samples={ring} commitment={{ good: 0, fuse: commitment }} rung={rung} />
      <span className="wd-t6">
        {ring.length} of {LAG_RING_MAX} · scaled to the published max
      </span>
    </span>
  );
}

/**
 * A probe's outcome, read back out of the attempt ring. The server's own status
 * is what is rendered; nothing is claimed before the request settled, and a
 * request that never received a response says so rather than showing a zero.
 */
function ProbeReadback({
  attempt,
  nowMs,
}: {
  readonly attempt: Attempt;
  readonly nowMs: number;
}): JSX.Element {
  const status = num(attempt.status);
  const elapsed = num(attempt.elapsedMs);
  const age = ageMs(attempt.atMs, nowMs);
  const detail = text(attempt.detail);
  const failed = status === null || status >= 400;
  return (
    <>
      <span className="obsx-probe-line">
        {status === null ? <b className="wd-nodata">no response</b> : <b className="wd-num">{status}</b>}
        {elapsed === null ? null : <> · <span className="wd-num">{Math.round(elapsed)}</span> ms</>}
        {age === null ? null : <> · {durationLabel(age)} ago</>}
      </span>
      {failed && detail !== null ? (
        <span className="obsx-probe-line wd-t5">{detail}</span>
      ) : null}
    </>
  );
}
