import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProductControlRoomContext } from '../../features/productControlRoom/ProductControlRoomProvider';
import { useStore } from '../../store';
import { apiErrorMessage, fetchJson } from '../../lib/http';
import { createSettledPoll, type SettledPoll } from '../../lib/polling';
import {
  canonicalRefreshTargetPosture,
  type CanonicalRefreshTarget,
} from '../../lib/operatorControlPosture';
import {
  DATA_CADENCE_DEFAULTS,
  MARKET_PING_CHOICES,
  type DataCadenceKey,
} from '../../lib/prefs';
import {
  PRIVATE_READ_STALE_AFTER_MS,
  projectPrivateReadGuard,
} from '../../lib/privateRead';
import type { SystemSupervisorSnapshot } from '../../lib/systemIntegration';
import type {
  ProductCapability,
  ProductComponentProjection,
  ProductIntegrationClient,
  ProductLifecycle,
  ProductSupervisorEnvelope,
  ProductTruthLabel,
} from '../../lib/productIntegration';

/**
 * THE WATCHDOG READ SPINE.
 *
 * This module is the page's ONLY reader. Every other file under
 * `pages/watchdog/` receives plain props and calls no hook of its own — no
 * `useStore`, no `useProductControlRoomContext`, no `fetch`, no
 * `performance.getEntriesByType`, and above all no `Date.now()`. There are
 * exactly three declared write lanes (RecoveryConsole, ControlCommit,
 * OwnerEvidence); each records its outcome here through `recordAttempt` and
 * then calls `refreshAll()` so the page re-derives from re-read evidence
 * instead of trusting a 200.
 *
 * Three invariants hold everything else up.
 *
 * 1. NOTHING IS FABRICATED. Every read is a `Lane<T>` and every rendered datum
 *    is a `Fact<T>`. A `Lane` that is not CURRENT carries a non-null `reason`;
 *    a `Fact` that is not `known` carries a non-null `reason`. A bare null
 *    cannot say why it is null, and the doctrine requires the why on screen as
 *    DOM text in reading order.
 * 2. NOTHING IS CARRIED FORWARD. A failed read drops its value; it never keeps
 *    serving the last good one as if it were current. The one exception is the
 *    browser lane, which retains its last server observation *explicitly
 *    marked STALE* — that is what `LaneState.STALE` exists for, and it is the
 *    restored `WATCHMAN_HEALTH_STALE_AFTER_MS` contract, not a carry-forward.
 * 3. ONE CLOCK. `nowMs` ticks on a single 1000ms interval owned here. No
 *    component may age a timestamp against `snapshot.evaluatedAtMs`,
 *    `observation.observedAt`, `cache.ageMs` or a render-time `Date.now()`.
 *    Pinned regression: web/test/productControlRoom/dashboard-age-clock.test.mjs
 *    — ageing a snapshot against its own timestamp made every age read
 *    "0s ago" forever, so a wedged supervisor serving its last cut was
 *    indistinguishable from a live one.
 */

// ---------------------------------------------------------------------------
// §1 · THE FROZEN VOCABULARY
// ---------------------------------------------------------------------------

export type LaneState = 'LOADING' | 'CURRENT' | 'STALE' | 'UNAVAILABLE';
export type MaterialContinuity = 'UNPROVEN' | 'BACKFILL' | 'PROVEN' | 'BLOCKED';
export type WatchmanStatus = 'operational' | 'degraded' | 'outage' | 'planned';
export type WatchmanGroup = 'control_path' | 'binance' | 'bot' | 'sources' | 'infrastructure';

/**
 * StatusChip's seven states. This module is the single mapper from a SERVER
 * POSTURE to one of these words; StatusChip remains the single mapper from the
 * word to a rung, fill, glyph and reason layout. Neither re-implements the
 * other, and nothing else on the page may produce a state word.
 */
export type OwnerState =
  | 'READY' | 'DEGRADED' | 'BLOCKED' | 'UNAVAILABLE'
  | 'UNKNOWN' | 'NOT_CONFIGURED' | 'OWNER_GATED';

/** Evidence class, which gates the state BEFORE render (BIBLE §3.17). */
export type OwnerTruthClass = 'proven' | 'unproven' | 'absent';

/** The hueless advance mark. A restatement of published cadence truth only. */
export type OwnerAdvance = 'ADVANCING' | 'WEDGED' | 'CADENCE_UNKNOWN' | 'CLOCK_SKEWED';

export interface Lane<T> {
  readonly value: T | null;
  readonly state: LaneState;
  /** NON-NULL whenever `state !== 'CURRENT'`. */
  readonly reason: string | null;
  readonly observedAtMs: number | null;
  readonly lastSuccessAtMs: number | null;
}

export interface Fact<T> {
  readonly value: T | null;
  readonly known: boolean;
  /** NON-NULL whenever `known === false`. */
  readonly reason: string | null;
  /** Provenance, e.g. `GET /api/watchdog · loopLag.p95Ms`. */
  readonly source: string;
  readonly observedAtMs: number | null;
}

export const knownFact = <T,>(value: T, source: string, observedAtMs: number | null): Fact<T> =>
  Object.freeze({ value, known: true, reason: null, source, observedAtMs });

export const unknownFact = <T,>(reason: string, source: string): Fact<T> =>
  Object.freeze({ value: null, known: false, reason, source, observedAtMs: null });

/**
 * The ONLY blank state on the page. `NOT_APPLICABLE` is the reason code the
 * renderer keys on to draw §3.12's `.st-na` (visually empty, sr-only "Not
 * applicable"), which is the exact inversion of the usual em-dash habit: here
 * blank means "this slot was never promised", and every other absence is a
 * visible rule that states its cause.
 */
export const notApplicable = <T,>(source: string): Fact<T> =>
  Object.freeze({ value: null, known: false, reason: 'NOT_APPLICABLE', source, observedAtMs: null });

/** Project a nullable read into a Fact, so a null can never reach a renderer bare. */
export function factOf<T>(
  value: T | null | undefined,
  reason: string,
  source: string,
  observedAtMs: number | null,
): Fact<T> {
  return value === null || value === undefined
    ? unknownFact<T>(reason, source)
    : knownFact<T>(value, source, observedAtMs);
}

const loadingLane = <T,>(reason: string, observedAtMs: number | null, lastSuccessAtMs: number | null): Lane<T> =>
  Object.freeze({ value: null, state: 'LOADING' as const, reason, observedAtMs, lastSuccessAtMs });

const currentLane = <T,>(value: T, observedAtMs: number): Lane<T> =>
  Object.freeze({ value, state: 'CURRENT' as const, reason: null, observedAtMs, lastSuccessAtMs: observedAtMs });

const staleLane = <T,>(value: T | null, reason: string, observedAtMs: number | null, lastSuccessAtMs: number | null): Lane<T> =>
  Object.freeze({ value, state: 'STALE' as const, reason, observedAtMs, lastSuccessAtMs });

const unavailableLane = <T,>(reason: string, observedAtMs: number | null, lastSuccessAtMs: number | null): Lane<T> =>
  Object.freeze({ value: null, state: 'UNAVAILABLE' as const, reason, observedAtMs, lastSuccessAtMs });

// ---------------------------------------------------------------------------
// §2 · CADENCES — every one is a product decision, so every one is a comment.
// ---------------------------------------------------------------------------

/** The supervisor provider's own cadence (App.tsx mounts it at 5s). Never a second poll. */
export const ENVELOPE_PROVIDER_CADENCE_MS = 5_000;
/** Matches the envelope cadence: a builder-health read that lagged the envelope would libel it. */
const STATS_POLL_MS = 5_000;
/** lib/http's default request lifetime, and therefore every lane's declared fuse. */
const TRANSPORT_FUSE_MS = 10_000;
/** 80% of the fuse — the last decile before a hard timeout, not a taste threshold. */
const TRANSPORT_ALERT_MS = 8_000;
/** Bounded so a wedged owner read cannot occupy the poll past one cadence plus slack. */
const STATS_TIMEOUT_MS = 8_000;
/** The two-way liveness probe runs on the envelope cadence so its age is comparable. */
const BROWSER_POLL_MS = 5_000;
const BROWSER_PROBE_TIMEOUT_MS = 8_000;
/** GET /health/live is a liveness endpoint: if it needs 4s, that is already the answer. */
const HEALTH_LIVE_TIMEOUT_MS = 4_000;
/** The observation report is telemetry, not truth; it must never hold the probe open. */
const BROWSER_OBSERVATION_TIMEOUT_MS = 3_000;
/**
 * Restored parity constant (§15b). A frozen success cannot stay green: three
 * missed probe cadences and the liveness evidence stops proving anything.
 */
export const WATCHMAN_HEALTH_STALE_AFTER_MS = 15_000;
/** Passive only — this drains what the browser already recorded and issues nothing. */
const TRANSPORT_DRAIN_MS = 2_000;
/** 20 drains = 40s of transport history: the sparkline's declared retention horizon. */
export const TRANSPORT_RETENTION_SLOTS = 20;
const TRANSPORT_SAMPLE_LIMIT = 20;
/** The operator clock. Every age on the page is (nowMs − a published instant). */
const OPERATOR_CLOCK_MS = 1_000;
/** The attempt transcript is a working set. The server ledger is the audit log. */
export const ATTEMPT_RING_LIMIT = 40;

const WATCHDOG_ENDPOINT = '/api/watchdog';
const HEALTH_LIVE_ENDPOINT = '/health/live';
const BROWSER_OBSERVATION_ENDPOINT = '/api/connections/browser-observation';
const SUPERVISOR_ENDPOINT = '/api/product-integration/v1/supervisor';

// ---------------------------------------------------------------------------
// §3 · EXACT READERS — every projection fails closed. A value that is not an
//      exact finite number / boolean / non-empty string becomes null, and a
//      null becomes an UNKNOWN Fact carrying the reason it is unknown.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Title-case an identifier. Parity with the deleted Watchman's own labelling. */
function titleCase(value: string): string {
  return value.replaceAll('-', ' ').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** The smallest non-null instant, or null when nothing was observed at all. */
function oldestOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.min(...present);
}

// ---------------------------------------------------------------------------
// §4 · LANE `stats` — GET /api/watchdog
// ---------------------------------------------------------------------------

/**
 * The exact body `GET /api/watchdog` publishes (server/src/index.ts). The
 * server's own `ProductRuntimeWatchdogStats` type covers only two of these five
 * keys — the route adds `loopLag`, `wsClients` and `process` at the edge — so
 * naming this after it would understate the contract by three fields.
 */
export interface WatchdogOwnerStats {
  readonly loopLag: Readonly<{ currentMs: number | null; p95Ms: number | null; maxMs: number | null }>;
  readonly envelopeBuild: Readonly<{
    lastBuildDurationMs: number | null;
    lastBuildCompletedAtMs: number | null;
    lastBuildError: string | null;
    buildsStarted: number | null;
    buildsSucceeded: number | null;
    staleServedCount: number | null;
    inFlight: boolean | null;
  }>;
  readonly cache: Readonly<{ ageMs: number | null; digestPrefix8: string | null }>;
  readonly wsClients: number | null;
  readonly process: Readonly<{ rssMb: number | null; uptimeSec: number | null }>;
}

/**
 * Both the grouped and the flat publication shapes are accepted, because the
 * browser must not assert which one the owner publishes; every field it cannot
 * read exactly stays null.
 */
/** Spelling alias. The server type of this name covers only two of the five keys. */
export type ProductRuntimeWatchdogStats = WatchdogOwnerStats;

export function projectWatchdogOwnerStats(payload: unknown): WatchdogOwnerStats {
  const root = asRecord(payload) ?? {};
  const loop = asRecord(root.loopLag) ?? asRecord(root.eventLoop) ?? root;
  const build = asRecord(root.envelopeBuild) ?? asRecord(root.build) ?? root;
  const cache = asRecord(root.cache) ?? {};
  const proc = asRecord(root.process) ?? {};
  return Object.freeze({
    loopLag: Object.freeze({
      currentMs: nonNegative(loop.currentMs),
      p95Ms: nonNegative(loop.p95Ms),
      maxMs: nonNegative(loop.maxMs),
    }),
    envelopeBuild: Object.freeze({
      lastBuildDurationMs: nonNegative(build.lastBuildDurationMs),
      lastBuildCompletedAtMs: nonNegative(build.lastBuildCompletedAtMs ?? build.lastBuildAtMs),
      lastBuildError: textOrNull(build.lastBuildError),
      buildsStarted: nonNegative(build.buildsStarted),
      buildsSucceeded: nonNegative(build.buildsSucceeded),
      staleServedCount: nonNegative(build.staleServedCount),
      inFlight: boolOrNull(build.inFlight),
    }),
    cache: Object.freeze({
      ageMs: nonNegative(cache.ageMs),
      digestPrefix8: textOrNull(cache.digestPrefix8),
    }),
    wsClients: nonNegative(root.wsClients),
    process: Object.freeze({
      rssMb: nonNegative(proc.rssMb),
      uptimeSec: nonNegative(proc.uptimeSec),
    }),
  });
}

/**
 * `loopLagSnapshot()` returns a literal `{0, 0, 0}` on an EMPTY ring — a
 * perfectly healthy-looking answer meaning "I have measured nothing". The ring
 * samples at 100ms, so one second of uptime is the earliest instant at which a
 * zero can be a measurement rather than an absence.
 */
export function lagSamplesAreProven(stats: WatchdogOwnerStats | null): boolean {
  const uptimeSec = stats?.process.uptimeSec ?? null;
  return uptimeSec !== null && uptimeSec >= 1;
}

export interface LoopLagFacts {
  readonly currentMs: Fact<number>;
  readonly p95Ms: Fact<number>;
  readonly maxMs: Fact<number>;
}

/**
 * The sanctioned render path for loop lag. Read THIS, never
 * `stats.value.loopLag` — the raw read is retained for the attempt transcript
 * only, and a consumer that reaches past this helper will print 0 ms for a loop
 * that has never been sampled.
 */
function projectLoopLag(lane: Lane<WatchdogOwnerStats>, proven: boolean): LoopLagFacts {
  const source = (field: string) => `GET ${WATCHDOG_ENDPOINT} · loopLag.${field}`;
  const build = (field: string, value: number | null): Fact<number> => {
    if (lane.state === 'LOADING') {
      return unknownFact(`WATCHDOG_OWNER_LOADING · GET ${WATCHDOG_ENDPOINT} has not settled yet`, source(field));
    }
    if (lane.value === null) {
      return unknownFact(lane.reason ?? `WATCHDOG_OWNER_UNAVAILABLE · GET ${WATCHDOG_ENDPOINT} was not read`, source(field));
    }
    if (!proven) {
      return unknownFact(
        'LOOP_LAG_RING_EMPTY · the sampler publishes a literal zero until its 100ms ring holds a sample, and process uptime has not reached one second',
        source(field),
      );
    }
    return factOf(value, 'LOOP_LAG_FIELD_ABSENT · the owner did not publish this field', source(field), lane.observedAtMs);
  };
  return Object.freeze({
    currentMs: build('currentMs', lane.value?.loopLag.currentMs ?? null),
    p95Ms: build('p95Ms', lane.value?.loopLag.p95Ms ?? null),
    maxMs: build('maxMs', lane.value?.loopLag.maxMs ?? null),
  });
}

// ---------------------------------------------------------------------------
// §5 · LANE `browser` — the restored two-way liveness probe (§15a, §15b)
// ---------------------------------------------------------------------------

export interface BrowserObservationFields {
  readonly status: WatchmanStatus;
  readonly rttMs: number;
  readonly socketConnected: boolean;
  readonly observedAt: number;
}

/**
 * SPELLING ALIASES — see the block at §12. `observation` is the SAME frozen
 * object as the four flat fields beside it, not a second copy, so the two
 * spellings are incapable of disagreeing. The integrator should collapse the
 * page onto one spelling and delete the other.
 */
export interface BrowserObservation extends BrowserObservationFields {
  readonly observation: BrowserObservationFields;
}

const WATCHMAN_STATUSES: readonly WatchmanStatus[] = Object.freeze(['operational', 'degraded', 'outage', 'planned']);

/** Validate the server's echo. An unrecognised body is not an observation. */
export function projectBrowserObservation(payload: unknown): BrowserObservation | null {
  const observation = asRecord(asRecord(payload)?.observation);
  if (observation === null) return null;
  const status = observation.status;
  const rttMs = nonNegative(observation.rttMs);
  const socketConnected = boolOrNull(observation.socketConnected);
  const observedAt = nonNegative(observation.observedAt);
  if (typeof status !== 'string' || !WATCHMAN_STATUSES.includes(status as WatchmanStatus)) return null;
  if (rttMs === null || socketConnected === null || observedAt === null) return null;
  const fields: BrowserObservationFields = Object.freeze({
    status: status as WatchmanStatus, rttMs, socketConnected, observedAt,
  });
  return Object.freeze({ ...fields, observation: fields });
}

/**
 * Restored verbatim (§15b). Freshness is decided by the probe's OWN last
 * success against a bounded threshold — never by the mere presence of a value.
 */
export function resolveWatchmanHealthFreshness(input: Readonly<{
  probeStatus: 'LOADING' | 'CURRENT' | 'UNAVAILABLE';
  lastSuccessAt: number | null;
  observedAt: number;
  staleAfterMs: number;
}>): Readonly<{ status: LaneState; lastSuccessAt: number | null; ageMs: number | null }> {
  if (input.lastSuccessAt === null) {
    return Object.freeze({
      status: input.probeStatus === 'LOADING' ? 'LOADING' as const : 'UNAVAILABLE' as const,
      lastSuccessAt: null,
      ageMs: null,
    });
  }
  const ageMs = Math.max(0, input.observedAt - input.lastSuccessAt);
  const staleAfterMs = Number.isFinite(input.staleAfterMs) && input.staleAfterMs > 0
    ? input.staleAfterMs
    : WATCHMAN_HEALTH_STALE_AFTER_MS;
  return Object.freeze({
    status: input.probeStatus === 'UNAVAILABLE' || ageMs >= staleAfterMs ? 'STALE' as const : 'CURRENT' as const,
    lastSuccessAt: input.lastSuccessAt,
    ageMs,
  });
}

interface BrowserProbeResult {
  readonly rttMs: number;
  readonly observation: BrowserObservation | null;
  readonly observationError: string | null;
}

// ---------------------------------------------------------------------------
// §6 · LANE `transport` — the browser's own resource-timing buffer
// ---------------------------------------------------------------------------

export type TransportLaneId =
  | 'supervisor' | 'events' | 'state' | 'engine-basis'
  | 'engine-volume' | 'markets' | 'calendar' | 'watchdog';

/**
 * First match wins, so the two product-integration lanes precede the generic
 * prefixes they share. `probePath` is a read-only GET on that lane's own owner:
 * a probe never mutates anything, and the sample it produces is picked up from
 * the browser's own buffer rather than timed by a page clock that could be wrong.
 */
export const TRANSPORT_LANES: readonly Readonly<{
  id: TransportLaneId; label: string; prefix: string; probePath: string;
}>[] = Object.freeze([
  { id: 'supervisor', label: 'Supervisor', prefix: SUPERVISOR_ENDPOINT, probePath: SUPERVISOR_ENDPOINT },
  { id: 'events', label: 'Material Events', prefix: '/api/product-integration/v1/material-events', probePath: '/api/product-integration/v1/material-events?afterCursor=0&limit=1' },
  { id: 'state', label: 'State', prefix: '/api/state', probePath: '/api/state?view=slim' },
  { id: 'engine-basis', label: 'Engine · Basis', prefix: '/api/engine/basis', probePath: '/api/engine/basis' },
  { id: 'engine-volume', label: 'Engine · Volume', prefix: '/api/engine/volume', probePath: '/api/engine/volume' },
  { id: 'markets', label: 'Markets', prefix: '/api/markets', probePath: '/api/markets' },
  { id: 'calendar', label: 'Calendar', prefix: '/api/calendar', probePath: '/api/calendar' },
  { id: 'watchdog', label: 'Watchdog', prefix: WATCHDOG_ENDPOINT, probePath: WATCHDOG_ENDPOINT },
]);

export function classifyTransportLane(pathname: string): TransportLaneId | null {
  return TRANSPORT_LANES.find((lane) => pathname.startsWith(lane.prefix))?.id ?? null;
}

export interface TransportSample {
  readonly durationMs: number;
  readonly transferSize: number | null;
  readonly decodedBodySize: number | null;
  /** Wall clock, reconstructed from `performance.timeOrigin` — not a page guess. */
  readonly completedAtMs: number;
}

export type TransportLaneBuffer = Readonly<Record<TransportLaneId, readonly TransportSample[]>>;

export const EMPTY_TRANSPORT_BUFFER: TransportLaneBuffer = Object.freeze(
  Object.fromEntries(
    TRANSPORT_LANES.map((lane) => [lane.id, Object.freeze<TransportSample[]>([])]),
  ) as Record<TransportLaneId, readonly TransportSample[]>,
);

/**
 * Append this origin's new /api/* resource entries to their lane buffers. The
 * caller advances `afterStartTime` so an entry is never counted twice even if
 * `clearResourceTimings()` is refused by policy, and each lane retains only its
 * last `TRANSPORT_SAMPLE_LIMIT` samples. No request is issued: this reads
 * measurements the browser already recorded — including the ones a Probe click
 * produced, so a probe is measured by the browser rather than by the page.
 */
export function collectTransportSamples(
  entries: readonly PerformanceResourceTiming[],
  current: TransportLaneBuffer,
  afterStartTime: number,
  timeOriginMs: number,
): Readonly<{
  lanes: TransportLaneBuffer;
  cursor: number;
  added: number;
  latest: Readonly<Partial<Record<TransportLaneId, number>>>;
}> {
  const next: Record<TransportLaneId, TransportSample[]> = Object.fromEntries(
    TRANSPORT_LANES.map((lane) => [lane.id, [...current[lane.id]]]),
  ) as Record<TransportLaneId, TransportSample[]>;
  const latest: Partial<Record<TransportLaneId, number>> = {};
  let cursor = afterStartTime;
  let added = 0;
  for (const entry of entries) {
    if (!(entry.startTime > afterStartTime)) continue;
    if (entry.startTime > cursor) cursor = entry.startTime;
    if (entry.initiatorType !== 'fetch' && entry.initiatorType !== 'xmlhttprequest') continue;
    let pathname: string;
    try {
      const url = new URL(entry.name, window.location.href);
      if (url.origin !== window.location.origin) continue;
      pathname = url.pathname;
    } catch {
      continue;
    }
    const laneId = classifyTransportLane(pathname);
    if (laneId === null) continue;
    const durationMs = nonNegative(entry.duration);
    if (durationMs === null) continue;
    next[laneId].push(Object.freeze({
      durationMs,
      transferSize: nonNegative(entry.transferSize),
      decodedBodySize: nonNegative(entry.decodedBodySize),
      completedAtMs: Math.round(timeOriginMs + entry.startTime + durationMs),
    }));
    latest[laneId] = durationMs;
    added += 1;
  }
  return Object.freeze({
    lanes: Object.freeze(
      Object.fromEntries(
        TRANSPORT_LANES.map((lane) => [lane.id, Object.freeze(next[lane.id].slice(-TRANSPORT_SAMPLE_LIMIT))]),
      ) as Record<TransportLaneId, readonly TransportSample[]>,
    ),
    cursor,
    added,
    latest: Object.freeze(latest),
  });
}

export type TransportFuseVerdict = 'OK' | 'CLOSE' | 'BLOWN';

export function transportFuseVerdict(lastMs: number | null): TransportFuseVerdict | null {
  if (lastMs === null) return null;
  const marginMs = TRANSPORT_FUSE_MS - lastMs;
  if (marginMs <= 0) return 'BLOWN';
  return marginMs <= TRANSPORT_FUSE_MS - TRANSPORT_ALERT_MS ? 'CLOSE' : 'OK';
}

export interface TransportLaneFact {
  readonly laneId: TransportLaneId;
  readonly label: string;
  readonly prefix: string;
  readonly probePath: string;
  /** The declared commitment. §3.15: no declared fuse, no anchored scale, no chart. */
  readonly fuseMs: number;
  /** Commitment anchor for a ceiling lane; a recovery lane would invert these. */
  readonly goodMs: number;
  /**
   * One slot per 2s drain, newest last. `null` is an interval in which this
   * lane issued nothing — the mark must BREAK there rather than interpolate,
   * because "no traffic" is not "fast".
   */
  readonly samples: readonly (number | null)[];
  readonly retentionSlots: number;
  readonly sampleCount: number;
  readonly lastMs: Fact<number>;
  readonly medianMs: Fact<number>;
  readonly maxMs: Fact<number>;
  readonly wireBytes: Fact<number>;
  readonly decodedBytes: Fact<number>;
  readonly fuse: Fact<TransportFuseVerdict>;
  readonly fuseMarginMs: Fact<number>;
  readonly lastObservedAtMs: number | null;
}

export interface TransportBufferState {
  readonly state: 'DRAINED' | 'OVERFLOWED';
  readonly clearedAtMs: number | null;
}

// ---------------------------------------------------------------------------
// §7 · THE OWNER MODEL
// ---------------------------------------------------------------------------

/**
 * The canonical component census, restored from the systemIntegration contract
 * (server/src/systemIntegration/contracts/constants.ts). Any id here that the
 * envelope does not report becomes an `absent: true` OwnerFact carrying
 * COMPONENT_ABSENT — a census that silently shrinks is a census that flatters.
 */
export const SYSTEM_COMPONENT_IDS: readonly string[] = Object.freeze([
  'public-spot-source',
  'public-usdm-source',
  'market-universe',
  'intelligence-runtime',
  'market-intelligence',
  'q-inference',
  'basis-engine',
  'volume-engine',
  'capital-supervision',
  'multileg-risk',
  'execution-coordinator-validate-only',
  'reconciliation',
  'ledger-persistence',
  'engine-supervisor',
]);

/**
 * The three rows this browser owns directly. They are filtered out of the
 * envelope list FIRST, so a server row can never shadow a local one.
 */
export const LOCALLY_OWNED_WATCHMAN_IDS: ReadonlySet<string> = Object.freeze(
  new Set(['browser-session', 'binance-account', 'aws-runner']),
);

/**
 * The six-hop chain of custody, in reading order: your browser → the supervisor
 * → the universe → the public feed → the private adapter → the owner-gated
 * runner. Restored from the deleted Connection Watchman.
 */
export const CONNECTION_PATH_IDS: readonly string[] = Object.freeze([
  'browser-session',
  'engine-supervisor',
  'market-universe',
  'public-usdm-source',
  'binance-account',
  'aws-runner',
]);

/** Restored verbatim from the deleted Connection Watchman (§10a). */
export function watchmanGroupForComponent(componentId: string): WatchmanGroup {
  if (componentId === 'public-spot-source' || componentId === 'public-usdm-source') return 'binance';
  if (componentId === 'market-universe' || componentId.includes('intelligence')) return 'sources';
  if (componentId === 'basis-engine' || componentId === 'volume-engine') return 'bot';
  return 'control_path';
}

const watchmanStatusLabel = (status: WatchmanStatus): string =>
  status === 'operational' ? 'Operational'
    : status === 'degraded' ? 'Degraded'
      : status === 'outage' ? 'Outage' : 'Not Configured';

/**
 * Evidence classes that constitute proof. `IMPORTED`, `SYNTHETIC_ONLY`,
 * `MISSING`, `UNKNOWN` and the adverse labels are NOT proof, and a READY on any
 * of them is downgraded to UNKNOWN before it can reach a renderer (§3.17).
 */
const PROVEN_TRUTH_LABELS: ReadonlySet<ProductTruthLabel> = Object.freeze(
  new Set<ProductTruthLabel>(['LIVE_PUBLIC', 'WIRED', 'BUILT_AND_TESTED']),
);

/**
 * THE DOWNGRADE TAKES THE WORD WITH IT.
 *
 * `statusLabel` is the server's own display word and `StatusChip` prints it in
 * preference to the rung's word — by design, so a server that says "Outage" is
 * quoted rather than paraphrased. But when THIS module downgrades a rung, the
 * server's word is no longer a description of what the chip is saying: a row
 * demoted from READY to UNKNOWN kept printing "Operational" beside the UNKNOWN
 * glyph, which is the whole downgrade defeated at the only layer an operator
 * reads first. Every downgrade site routes its label through here, so the word
 * and the rung can never disagree again.
 *
 * The replacement word is deliberately not a mood: it names the reason class.
 */
function labelAfterDowngrade(
  rawState: OwnerState,
  state: OwnerState,
  publishedLabel: string,
): string {
  if (state === rawState) return publishedLabel;
  return state === 'UNKNOWN' ? 'Evidence Unproven' : 'Downgraded';
}

export interface OwnerFact {
  readonly id: string;
  readonly label: string;
  readonly group: WatchmanGroup;
  /** The server's posture, after the continuity downgrade. Never upgraded here. */
  readonly status: WatchmanStatus;
  readonly statusLabel: string;
  /** StatusChip's own word, produced here and nowhere else. */
  readonly state: OwnerState;
  /**
   * StatusChip's ORTHOGONAL modifier. A component can be READY *and* STALE;
   * forcing a choice between them makes either answer a lie.
   */
  readonly stale: boolean;
  /** NON-NULL for every state except READY. The reason states the consequence. */
  readonly reason: string | null;
  readonly truthClass: OwnerTruthClass;
  readonly truthLabel: ProductTruthLabel | null;
  /** A NOUN VALUE (§3.17). Null for the three locally-owned rows and for an absence. */
  readonly capability: ProductCapability | null;
  readonly lifecycle: ProductLifecycle | null;
  /** The CODEOWNERS-shaped source location this row belongs to (§3.17 grouping). */
  readonly ownerPath: string | null;
  readonly blockerCode: string | null;
  readonly rootCauseComponentId: string | null;
  readonly capitalRelevance: ProductComponentProjection['capitalRelevance'] | null;
  readonly detail: string;
  readonly value: string;
  readonly required: boolean;
  readonly absent: boolean;
  readonly latencyMs: number | null;
  /** §18's third discarded fact: `lastAdvanceAtMs ?? heartbeatAtMs`. */
  readonly updatedAtMs: number | null;
  /** When this row's PROOF was observed, which is not when its value last moved. */
  readonly observedAtMs: number | null;
  readonly advance: OwnerAdvance;
  readonly correlationId: string | null;
  readonly supportedControlIds: readonly string[];
  /** Newest last; `null` breaks the path. Empty means no series was measured. */
  readonly samples: readonly (number | null)[];
  readonly component: Readonly<ProductComponentProjection> | null;
}

/**
 * Relabel the server's posture into StatusChip's vocabulary. A relabel, never a
 * derivation: `outage` splits into BLOCKED / UNAVAILABLE on the server's OWN
 * `rootCauseComponentId`, which is what makes root-cause deduplication
 * structural (§3.17) — one alarm carries the only solid fill on the page, and
 * its downstream attributions are physically incapable of shouting.
 */
function ownerStateFromPosture(
  status: WatchmanStatus,
  componentId: string,
  rootCauseComponentId: string | null,
): OwnerState {
  if (status === 'operational') return 'READY';
  if (status === 'degraded') return 'DEGRADED';
  if (status === 'planned') return 'NOT_CONFIGURED';
  return rootCauseComponentId === null || rootCauseComponentId === componentId ? 'BLOCKED' : 'UNAVAILABLE';
}

/** A restatement of the server's published cadence truth. No threshold chosen here. */
function advanceFromFreshness(
  freshnessState: ProductComponentProjection['freshnessState'],
  lastAdvanceAtMs: number | null,
  heartbeatAtMs: number | null,
): OwnerAdvance {
  if (freshnessState === 'CLOCK_SKEWED') return 'CLOCK_SKEWED';
  if (lastAdvanceAtMs === null && heartbeatAtMs === null) return 'CADENCE_UNKNOWN';
  if (freshnessState === 'FRESH') return 'ADVANCING';
  if (freshnessState === 'STALE') return 'WEDGED';
  return 'CADENCE_UNKNOWN';
}

/**
 * Project one canonical component (§10a, restored verbatim, plus §18's three
 * facts every old row computed and then discarded: `required`, `latencyMs`,
 * `updatedAtMs`).
 *
 * The ONE permitted client-side transform is a DOWNGRADE. `canonicalPresentation`
 * is server-owned display posture; there is no mapper here from lifecycle,
 * capability or truthLabel to a tone, and there never will be.
 */
export function watchmanComponentFromSupervisor(
  component: Readonly<ProductComponentProjection>,
  continuity: MaterialContinuity,
  envelopeEvidenceProven: boolean,
): OwnerFact {
  const continuityProven = continuity === 'PROVEN';
  const posture = continuityProven
    ? component.canonicalPresentation
    : { status: 'outage' as const, statusLabel: 'Continuity Blocked' };
  const proven = continuityProven
    && envelopeEvidenceProven
    && PROVEN_TRUTH_LABELS.has(component.truthLabel);
  const rawState = ownerStateFromPosture(posture.status, component.componentId, component.rootCauseComponentId);
  const state: OwnerState = rawState === 'READY' && !proven ? 'UNKNOWN' : rawState;
  const reason = !continuityProven
    ? `MATERIAL_CONTINUITY_${continuity} · the envelope's own continuity is not proven, so this row's posture cannot be trusted`
    : state === 'UNKNOWN'
      ? `EVIDENCE_CLASS_NOT_PROVEN · the supervisor reports ready on truth label ${component.truthLabel}, which is not wired evidence`
      : state === 'BLOCKED'
        ? component.blockerCode ?? `${posture.statusLabel} · the supervisor published no blocker code for this outage`
        : state === 'UNAVAILABLE'
          ? `Downstream of ${component.rootCauseComponentId ?? 'an unnamed root cause'}${component.blockerCode ? ` · ${component.blockerCode}` : ''}`
          : state === 'DEGRADED'
            ? component.blockerCode ?? `${posture.statusLabel} · capability ${component.capability}`
            : state === 'NOT_CONFIGURED'
              ? `NOT_CONFIGURED · capability ${component.capability}; no evidence channel is mounted for this component`
              : null;
  return Object.freeze({
    id: component.componentId,
    label: titleCase(component.componentId),
    group: watchmanGroupForComponent(component.componentId),
    status: posture.status,
    statusLabel: labelAfterDowngrade(rawState, state, posture.statusLabel),
    state,
    stale: component.freshnessState === 'STALE',
    reason,
    truthClass: proven ? 'proven' as const : 'unproven' as const,
    truthLabel: component.truthLabel,
    capability: component.capability,
    lifecycle: component.observedLifecycle,
    ownerPath: component.owner,
    blockerCode: component.blockerCode,
    rootCauseComponentId: component.rootCauseComponentId,
    capitalRelevance: component.capitalRelevance,
    detail: `${component.owner} · Lifecycle ${component.observedLifecycle} · Capability ${component.capability} · Truth ${component.truthLabel}${component.blockerCode ? ` · ${component.blockerCode}` : ''}`,
    value: component.observedLifecycle.replaceAll('_', ' '),
    required: component.capability !== 'NOT_CONFIGURED',
    absent: false,
    latencyMs: component.processingLagMs,
    updatedAtMs: component.lastAdvanceAtMs ?? component.heartbeatAtMs,
    observedAtMs: component.heartbeatAtMs ?? component.lastAdvanceAtMs,
    advance: advanceFromFreshness(component.freshnessState, component.lastAdvanceAtMs, component.heartbeatAtMs),
    correlationId: component.correlationId,
    supportedControlIds: component.supportedControlIds,
    samples: Object.freeze<(number | null)[]>([]),
    component,
  });
}

/** A canonical id the supervisor did not report at all. */
function absentOwnerFact(componentId: string): OwnerFact {
  const reason = `COMPONENT_ABSENT · ${componentId} is a canonical component and the supervisor envelope did not report it, so its state cannot be observed from this browser`;
  return Object.freeze({
    id: componentId,
    label: titleCase(componentId),
    group: watchmanGroupForComponent(componentId),
    status: 'outage' as const,
    statusLabel: 'Not Reported',
    state: 'UNAVAILABLE' as const,
    stale: false,
    reason,
    truthClass: 'absent' as const,
    truthLabel: null,
    capability: null,
    lifecycle: null,
    ownerPath: null,
    blockerCode: null,
    rootCauseComponentId: null,
    capitalRelevance: null,
    detail: 'Expected in the canonical component census · absent from snapshot.components · no owner, lifecycle, capability or truth label was published',
    value: 'NOT REPORTED',
    required: true,
    absent: true,
    latencyMs: null,
    updatedAtMs: null,
    observedAtMs: null,
    advance: 'CADENCE_UNKNOWN' as const,
    correlationId: null,
    supportedControlIds: Object.freeze<string[]>([]),
    samples: Object.freeze<(number | null)[]>([]),
    component: null,
  });
}

// ---------------------------------------------------------------------------
// §8 · COVERAGE — the exhaustive partition (§3.14). A counter that cannot
//      prove its own integers renders UNKNOWN, and a section whose coverage is
//      UNKNOWN stays OPEN. Absence must never look like all-clear.
// ---------------------------------------------------------------------------

export type WatchdogSectionId = 'posture' | 'owners' | 'topology' | 'control' | 'recovery' | 'observer';

export interface SectionCoverage {
  readonly population: Fact<number>;
  readonly proven: Fact<number>;
  readonly withheld: Fact<number>;
  readonly failing: Fact<number>;
  readonly unknown: Fact<number>;
  /** The section's PUBLISHED cadence, never a guess at one. */
  readonly declaredHeartbeatMs: Fact<number>;
  /** The STALEST member's observation. */
  readonly oldestEvidenceAtMs: Fact<number>;
  readonly source: string;
}

/** VerdictHeader's plain-integer roll-up of the owner census. */
export interface CoverageTally {
  readonly population: number;
  readonly proven: number;
  readonly withheld: number;
  readonly failing: number;
  readonly unknown: number;
}

type CoverageClass = 'proven' | 'withheld' | 'failing' | 'unknown';

/**
 * The seven states partition into exactly four classes with no residue, so
 * `proven + withheld + failing + unknown === population` is an identity, not a
 * hope — which is what lets §3.14's counter claim to be exhaustive.
 *
 * In the OWNER census specifically, READY additionally implies proven, because
 * an unproven READY was already downgraded to UNKNOWN upstream (§3.17). The
 * other four sections score their own populations, where `proven` means only
 * "this member is in its good state".
 */
function coverageClassOfState(state: OwnerState): CoverageClass {
  if (state === 'READY') return 'proven';
  if (state === 'OWNER_GATED' || state === 'NOT_CONFIGURED') return 'withheld';
  if (state === 'UNKNOWN') return 'unknown';
  return 'failing';
}

function tallyOf(states: readonly OwnerState[]): CoverageTally {
  const counts = { proven: 0, withheld: 0, failing: 0, unknown: 0 };
  for (const state of states) counts[coverageClassOfState(state)] += 1;
  return Object.freeze({ population: states.length, ...counts });
}

function coverageFromTally(
  tally: CoverageTally,
  source: string,
  declaredHeartbeatMs: Fact<number>,
  oldestEvidenceAtMs: Fact<number>,
  observedAtMs: number | null,
): SectionCoverage {
  return Object.freeze({
    population: knownFact(tally.population, `${source} · population`, observedAtMs),
    proven: knownFact(tally.proven, `${source} · proven`, observedAtMs),
    withheld: knownFact(tally.withheld, `${source} · withheld`, observedAtMs),
    failing: knownFact(tally.failing, `${source} · failing`, observedAtMs),
    unknown: knownFact(tally.unknown, `${source} · unknown`, observedAtMs),
    declaredHeartbeatMs,
    oldestEvidenceAtMs,
    source,
  });
}

function unmeasuredCoverage(source: string, reason: string, declaredHeartbeatMs: Fact<number>): SectionCoverage {
  return Object.freeze({
    population: unknownFact<number>(reason, `${source} · population`),
    proven: unknownFact<number>(reason, `${source} · proven`),
    withheld: unknownFact<number>(reason, `${source} · withheld`),
    failing: unknownFact<number>(reason, `${source} · failing`),
    unknown: unknownFact<number>(reason, `${source} · unknown`),
    declaredHeartbeatMs,
    oldestEvidenceAtMs: unknownFact<number>(reason, `${source} · oldest evidence`),
    source,
  });
}

// ---------------------------------------------------------------------------
// §9 · ATTEMPTS, CADENCE, MARKET, ANNOUNCEMENT
// ---------------------------------------------------------------------------

/**
 * One recorded request. `status` is a STRING, deliberately: an HTTP code alone
 * cannot express "no response ever arrived". A timed-out, aborted or
 * transport-failed attempt records `TIMEOUT` / `ABORTED` / `NETWORK`, so the
 * transcript never has to render a null and invent a meaning for it.
 *
 * Vocabulary in use: kind ∈ REFRESH · COMMAND_PREVIEW · COMMAND_SUBMIT ·
 * COMMAND_READBACK · TRACE · BROWSER_PROBE · OWNER_STATS · ENVELOPE_REFRESH ·
 * CADENCE_WRITE. method ∈ GET · POST · LOCAL.
 */
export interface Attempt {
  readonly id: number;
  readonly atMs: number;
  readonly kind: string;
  readonly method: string;
  readonly path: string;
  readonly status: string;
  readonly elapsedMs: number;
  readonly detail: string;
}

export type CadenceKey = Extract<DataCadenceKey, 'market' | 'news' | 'calendar'>;

export interface CadenceRow {
  readonly key: CadenceKey;
  readonly label: string;
  /** Which poll this actually moves. A control whose effect cannot be named is decoration. */
  readonly appliesTo: string;
  /** What this session last asked for; `null` when untouched in this session. */
  readonly requestedSeconds: number | null;
  /** The preference readback — the value the app is running on right now. */
  readonly effectiveSeconds: number;
  readonly defaultSeconds: number;
  readonly atDefault: boolean;
  /** True when the store did not keep what was asked for. */
  readonly reconciled: boolean;
  /**
   * `setPref` persists verbatim, but `normalizePrefs` snaps market/news/calendar
   * to the nearest canonical choice on the NEXT load. A value outside the choice
   * set therefore does not survive a reload, and the ledger says so rather than
   * letting the operator discover it after a refresh.
   */
  readonly survivesReload: boolean;
  readonly coupledPref: string | null;
}

export interface CadenceState {
  readonly rows: readonly CadenceRow[];
  readonly choices: readonly number[];
  readonly storage: 'LOCAL_BROWSER_PREFERENCE';
  readonly anyReconciled: boolean;
  readonly anyOffDefault: boolean;
}

const CADENCE_ROWS: readonly Readonly<{
  key: CadenceKey; label: string; appliesTo: string; coupledPref: string | null;
}>[] = Object.freeze([
  { key: 'market', label: 'Market Publication', appliesTo: 'store.tsx market poll interval', coupledPref: 'refreshSec' },
  { key: 'news', label: 'News Sources', appliesTo: 'News page fallback cadence', coupledPref: null },
  { key: 'calendar', label: 'Calendar', appliesTo: 'Calendar page poll, clamped to ≤ 10s by its own consumer', coupledPref: null },
]);

/**
 * The page's single live-region utterance. `seq` changes ONLY when something of
 * consequence changed — a lane flipped, continuity moved, an owner became
 * blocked, the tab's cut diverged from the server's. A poll that changed
 * nothing is SILENT, because a region that speaks every five seconds is a
 * region an operator turns off.
 */
export interface Announcement {
  readonly seq: number;
  readonly text: string;
}

// ---------------------------------------------------------------------------
// §12 · THE SPELLING ALIAS REGISTER — SETTLED AT INTEGRATION
//
// Seven pairs of one value under two names shipped here as a transitional debt,
// added only to unblock neighbours already written against a different
// spelling. Law 5 wants one name per measurement, so each pair was resolved to
// the spelling its consumers actually read, and the other was DELETED rather
// than deprecated: a name that still resolves is still a name, and the next
// author binds to whichever one they read first.
//
//   OwnerFact.componentId            -> deleted; `id` survives
//   OwnerFact.evidenceAtMs           -> deleted; `observedAtMs` survives
//   OwnerFact.stateReason            -> deleted; `reason` survives
//   OwnerFact.projection             -> deleted; `component` survives
//   TransportLaneFact.id             -> deleted; `laneId` survives (the name
//                                       the architecture's props block pins)
//   TransportLaneFact.slots          -> deleted; `samples` survives
//   TransportLaneFact.observedCount  -> deleted; `sampleCount` survives
//
// TWO ENTRIES OFF THAT LIST SURVIVE ON PURPOSE, because neither was ever two
// names for one thing:
//   `BrowserObservation` is the POST response ENVELOPE `{ok, observation}` — a
//     report that failed to land still has to be able to say so — and the flat
//     projection is `.observation` inside it.
//   `WatchdogOwnerStats` is a type ALIAS of `ProductRuntimeWatchdogStats`: one
//     declaration reached under a local name, not a duplicated shape.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// §10 · THE PUBLIC SURFACE
// ---------------------------------------------------------------------------

export interface WatchdogEvidence {
  /** The page's one clock. Every age is (nowMs − a published instant). */
  readonly nowMs: number;
  readonly client: Readonly<ProductIntegrationClient>;

  readonly envelope: Lane<ProductSupervisorEnvelope<SystemSupervisorSnapshot>>;
  readonly continuity: MaterialContinuity;
  readonly continuityError: string | null;

  readonly stats: Lane<WatchdogOwnerStats>;
  readonly lagSamplesProven: boolean;
  /** Read this, never `stats.value.loopLag`. */
  readonly loopLag: LoopLagFacts;

  readonly browser: Lane<BrowserObservation>;
  /** Survives a failed report: the round trip happened whether or not the server heard. */
  readonly browserRttMs: Fact<number>;
  readonly browserDetail: string;

  readonly transport: Lane<readonly TransportLaneFact[]>;
  readonly transportBuffer: TransportBufferState;
  readonly socketConnected: boolean;

  /** Proven divergence only. `false` means "no divergence proven", never "in sync". */
  readonly staleTabCut: boolean;
  readonly staleTabCutFact: Fact<boolean>;
  readonly publishedCutPrefix: Fact<string>;
  readonly envelopeCutPrefix: Fact<string>;

  readonly owners: readonly OwnerFact[];
  readonly ownerTally: CoverageTally;
  readonly sections: Readonly<Record<WatchdogSectionId, SectionCoverage>>;
  readonly announcement: Announcement | null;


  readonly cadence: CadenceState;
  readonly setCadence: (key: CadenceKey, seconds: number) => void;
  readonly resetCadenceDefaults: () => void;

  readonly attempts: readonly Attempt[];
  readonly recordAttempt: (attempt: Omit<Attempt, 'id'> & Partial<Pick<Attempt, 'id'>>) => void;

  readonly refreshAll: () => Promise<void>;
  readonly refreshBrowserProbe: () => Promise<void>;
  /**
   * One read-only GET on the named lane's OWN `probePath`, recorded as a
   * `BROWSER_PROBE` attempt keyed on that exact path, followed by a transport
   * drain so the request the operator just caused lands in that lane's buffer
   * before the row re-renders. This is what makes the per-lane Probe button a
   * control rather than a picture of one.
   */
  readonly probeTransportLane: (laneId: TransportLaneId) => Promise<void>;
}

// ---------------------------------------------------------------------------
// §11 · THE HOOK
// ---------------------------------------------------------------------------

/**
 * Called EXACTLY ONCE, by WatchdogSurface, which then passes disjoint slices
 * down as plain props. Calling it twice would double every poll on the page.
 */
export function useWatchdogEvidence(): WatchdogEvidence {
  const {
    connected,
    privateRead,
    privateReadSource,
    privateReadError,
    prefs,
    updatePref,
  } = useStore();
  const { client, binding } = useProductControlRoomContext();

  // -- the one clock --------------------------------------------------------
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), OPERATOR_CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // -- attempt ring ---------------------------------------------------------
  const attemptIdRef = useRef(0);
  const [attempts, setAttempts] = useState<readonly Attempt[]>(() => Object.freeze<Attempt[]>([]));
  const recordAttempt = useCallback((attempt: Omit<Attempt, 'id'> & Partial<Pick<Attempt, 'id'>>) => {
    attemptIdRef.current += 1;
    const entry: Attempt = Object.freeze({ ...attempt, id: attemptIdRef.current });
    setAttempts((current) => Object.freeze([...current, entry].slice(-ATTEMPT_RING_LIMIT)));
  }, []);

  // -- lane `stats` ---------------------------------------------------------
  const [statsValue, setStatsValue] = useState<WatchdogOwnerStats | null>(null);
  const [statsState, setStatsState] = useState<'LOADING' | 'CURRENT' | 'UNAVAILABLE'>('LOADING');
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsObservedAtMs, setStatsObservedAtMs] = useState<number | null>(null);
  const [statsLastSuccessAtMs, setStatsLastSuccessAtMs] = useState<number | null>(null);
  const statsPollRef = useRef<SettledPoll | null>(null);
  const statsWaitersRef = useRef<(() => void)[]>([]);

  // -- lane `browser` -------------------------------------------------------
  const [browserProbe, setBrowserProbe] = useState<BrowserProbeResult | null>(null);
  const [browserProbeStatus, setBrowserProbeStatus] = useState<'LOADING' | 'CURRENT' | 'UNAVAILABLE'>('LOADING');
  const [browserProbeError, setBrowserProbeError] = useState<string | null>(null);
  const [browserLastSuccessAtMs, setBrowserLastSuccessAtMs] = useState<number | null>(null);
  /**
   * The browser lane's SECOND clock. Not `nowMs`: it advances on probe
   * settlement and on one scheduled expiry at `lastSuccess + 15s`, so the
   * transition to STALE happens at the instant it becomes true rather than at
   * the next whole second.
   */
  const [browserObservedAtMs, setBrowserObservedAtMs] = useState(0);
  const [browserRttSlots, setBrowserRttSlots] = useState<readonly (number | null)[]>(
    () => Object.freeze<(number | null)[]>([]),
  );
  const browserPollRef = useRef<SettledPoll | null>(null);
  const browserWaitersRef = useRef<(() => void)[]>([]);
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  // -- lane `transport` -----------------------------------------------------
  const [transportLanes, setTransportLanes] = useState<TransportLaneBuffer>(EMPTY_TRANSPORT_BUFFER);
  const [transportSlots, setTransportSlots] = useState<Readonly<Record<TransportLaneId, readonly (number | null)[]>>>(
    () => Object.freeze(
      Object.fromEntries(TRANSPORT_LANES.map((lane) => [lane.id, Object.freeze<(number | null)[]>([])])) as
        Record<TransportLaneId, readonly (number | null)[]>,
    ),
  );
  const [transportDrainedAtMs, setTransportDrainedAtMs] = useState<number | null>(null);
  const [transportOverflowed, setTransportOverflowed] = useState(false);
  const transportCursorRef = useRef(0);
  const transportLanesRef = useRef<TransportLaneBuffer>(EMPTY_TRANSPORT_BUFFER);
  const transportOverflowRef = useRef(false);
  const drainTransportRef = useRef<() => void>(() => {});

  // -- envelope observation time (when THIS browser last received a new cut) --
  const [envelopeObservedAtMs, setEnvelopeObservedAtMs] = useState<number | null>(null);
  const lastEnvelopeRef = useRef<ProductSupervisorEnvelope<SystemSupervisorSnapshot> | null>(null);
  useEffect(() => {
    if (binding.snapshot === null || binding.snapshot === lastEnvelopeRef.current) return;
    lastEnvelopeRef.current = binding.snapshot;
    setEnvelopeObservedAtMs(Date.now());
  }, [binding.snapshot]);

  // -- cadence write lane ---------------------------------------------------
  const [cadenceRequested, setCadenceRequested] = useState<Readonly<Partial<Record<CadenceKey, number>>>>(
    () => Object.freeze({}),
  );

  // === the stats poll ======================================================
  const settleStats = useCallback(() => {
    const waiters = statsWaitersRef.current;
    statsWaitersRef.current = [];
    for (const resolve of waiters) resolve();
  }, []);

  useEffect(() => {
    const poll = createSettledPoll<unknown>({
      intervalMs: STATS_POLL_MS,
      timeoutMs: STATS_TIMEOUT_MS,
      request: (signal) => fetchJson<unknown>(WATCHDOG_ENDPOINT, { cache: 'no-store', signal }, STATS_TIMEOUT_MS),
      onSuccess: (payload) => {
        const at = Date.now();
        setStatsValue(projectWatchdogOwnerStats(payload));
        setStatsState('CURRENT');
        setStatsError(null);
        setStatsObservedAtMs(at);
        setStatsLastSuccessAtMs(at);
        settleStats();
      },
      onError: (error) => {
        // Law 1: a failed read drops its value. A stale builder reading served
        // as current is exactly how a wedged process looks healthy.
        setStatsValue(null);
        setStatsState('UNAVAILABLE');
        setStatsError(apiErrorMessage(error, 'Watchdog owner read failed'));
        setStatsObservedAtMs(Date.now());
        settleStats();
      },
    });
    statsPollRef.current = poll;
    poll.start();
    return () => {
      if (statsPollRef.current === poll) statsPollRef.current = null;
      poll.stop();
      settleStats();
    };
  }, [settleStats]);

  // === the two-way liveness probe ==========================================
  const settleBrowser = useCallback(() => {
    const waiters = browserWaitersRef.current;
    browserWaitersRef.current = [];
    for (const resolve of waiters) resolve();
  }, []);

  useEffect(() => {
    const poll = createSettledPoll<BrowserProbeResult>({
      intervalMs: BROWSER_POLL_MS,
      timeoutMs: BROWSER_PROBE_TIMEOUT_MS,
      request: async (signal): Promise<BrowserProbeResult> => {
        // 1 · time the liveness round trip on the browser's own monotonic clock.
        const startedAt = performance.now();
        await fetchJson<unknown>(HEALTH_LIVE_ENDPOINT, { cache: 'no-store', signal }, HEALTH_LIVE_TIMEOUT_MS);
        const rttMs = performance.now() - startedAt;
        // 2 · report it, and keep the RTT even when only the report fails.
        try {
          const response = await fetchJson<unknown>(BROWSER_OBSERVATION_ENDPOINT, {
            method: 'POST',
            cache: 'no-store',
            signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rttMs, socketConnected: connectedRef.current }),
          }, BROWSER_OBSERVATION_TIMEOUT_MS);
          const observation = projectBrowserObservation(response);
          return Object.freeze({
            rttMs,
            observation,
            observationError: observation === null
              ? 'BROWSER_OBSERVATION_MALFORMED · the server accepted the report but did not echo a readable observation'
              : null,
          });
        } catch (error) {
          if (signal.aborted) throw error;
          return Object.freeze({
            rttMs,
            observation: null,
            observationError: apiErrorMessage(error, 'Browser observation report failed'),
          });
        }
      },
      onSuccess: (probe) => {
        const at = Date.now();
        setBrowserProbe(probe);
        setBrowserProbeStatus('CURRENT');
        setBrowserProbeError(null);
        setBrowserLastSuccessAtMs(at);
        setBrowserObservedAtMs(at);
        setBrowserRttSlots((current) => Object.freeze(
          [...current, Math.round(probe.rttMs)].slice(-TRANSPORT_RETENTION_SLOTS),
        ));
        settleBrowser();
      },
      onError: (error) => {
        setBrowserProbe(null);
        setBrowserProbeStatus('UNAVAILABLE');
        setBrowserProbeError(apiErrorMessage(error, 'Watchman liveness probe failed'));
        setBrowserObservedAtMs(Date.now());
        // A failed cadence is a HOLE in the series, never a zero.
        setBrowserRttSlots((current) => Object.freeze([...current, null].slice(-TRANSPORT_RETENTION_SLOTS)));
        settleBrowser();
      },
    });
    browserPollRef.current = poll;
    poll.start();
    return () => {
      if (browserPollRef.current === poll) browserPollRef.current = null;
      poll.stop();
      settleBrowser();
    };
  }, [settleBrowser]);

  /** The 15s self-expiry: it fires with NO new data and flips the lane to STALE. */
  useEffect(() => {
    if (browserLastSuccessAtMs === null) return;
    const staleAt = browserLastSuccessAtMs + WATCHMAN_HEALTH_STALE_AFTER_MS;
    const remainingMs = staleAt - Date.now();
    if (remainingMs <= 0) {
      setBrowserObservedAtMs(staleAt);
      return;
    }
    const timer = window.setTimeout(() => setBrowserObservedAtMs(Date.now()), remainingMs);
    return () => window.clearTimeout(timer);
  }, [browserLastSuccessAtMs]);

  // === the passive transport drain =========================================
  useEffect(() => {
    if (typeof performance?.addEventListener !== 'function') return;
    const onFull = () => { transportOverflowRef.current = true; };
    performance.addEventListener('resourcetimingbufferfull', onFull);
    return () => performance.removeEventListener('resourcetimingbufferfull', onFull);
  }, []);

  useEffect(() => {
    const drain = () => {
      if (typeof performance?.getEntriesByType !== 'function') return;
      const at = Date.now();
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const collected = collectTransportSamples(
        entries,
        transportLanesRef.current,
        transportCursorRef.current,
        performance.timeOrigin,
      );
      transportCursorRef.current = collected.cursor;
      if (collected.added > 0) {
        transportLanesRef.current = collected.lanes;
        setTransportLanes(collected.lanes);
      }
      // One slot per drain for EVERY lane: a lane that issued nothing this
      // interval records `null`, so the mark breaks instead of drawing a flat
      // line across a period in which nothing was measured.
      setTransportSlots((current) => Object.freeze(
        Object.fromEntries(TRANSPORT_LANES.map((lane) => [
          lane.id,
          Object.freeze([...current[lane.id], collected.latest[lane.id] ?? null].slice(-TRANSPORT_RETENTION_SLOTS)),
        ])) as Record<TransportLaneId, readonly (number | null)[]>,
      ));
      // Clear after EVERY drain, so the shared resource-timing buffer cannot
      // fill and start silently dropping other owners' requests.
      if (typeof performance.clearResourceTimings === 'function') performance.clearResourceTimings();
      setTransportDrainedAtMs(at);
      setTransportOverflowed(transportOverflowRef.current);
      transportOverflowRef.current = false;
    };
    drainTransportRef.current = drain;
    drain();
    const timer = window.setInterval(drain, TRANSPORT_DRAIN_MS);
    return () => window.clearInterval(timer);
  }, []);

  // === refresh =============================================================
  const refreshStatsLane = useCallback((): Promise<void> => {
    const poll = statsPollRef.current;
    if (poll === null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      statsWaitersRef.current.push(resolve);
      poll.refresh();
    });
  }, []);

  const refreshBrowserProbe = useCallback((): Promise<void> => {
    const poll = browserPollRef.current;
    if (poll === null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      browserWaitersRef.current.push(resolve);
      poll.refresh();
    });
  }, []);

  /**
   * The per-lane probe. It issues the lane's OWN declared `probePath` — the
   * path the button's label names — and nothing else, so the request the
   * operator caused is the request the drain then classifies back into that
   * same lane (`classifyTransportLane` matches `probePath` against `prefix`
   * by construction: every `probePath` starts with its own lane's prefix).
   *
   * Three things are deliberate here:
   *  - The attempt is recorded on the EXACT `probePath`, because that string is
   *    the key `ObserverEvidence.probeReadback` matches on. A different string
   *    would leave the readback slot permanently empty, which was the defect.
   *  - A failure is recorded, not swallowed. A probe that could not complete is
   *    the most informative outcome the button has, and it must reach the
   *    transcript and the row readback both.
   *  - The drain runs in `finally`, because a request that was aborted at the
   *    fuse still produced a resource-timing entry and that entry is evidence.
   */
  const probeTransportLane = useCallback(async (laneId: TransportLaneId): Promise<void> => {
    const lane = TRANSPORT_LANES.find((candidate) => candidate.id === laneId);
    if (lane === undefined) {
      recordAttempt({
        atMs: Date.now(),
        kind: 'BROWSER_PROBE',
        method: 'GET',
        path: String(laneId),
        status: 'REFUSED',
        elapsedMs: 0,
        detail: `No transport lane is declared with id ${String(laneId)}, so no path exists to probe`,
      });
      return;
    }
    const startedAt = performance.now();
    try {
      await fetchJson<unknown>(lane.probePath, { cache: 'no-store' }, TRANSPORT_FUSE_MS);
      recordAttempt({
        atMs: Date.now(),
        kind: 'BROWSER_PROBE',
        method: 'GET',
        path: lane.probePath,
        status: 'OK',
        elapsedMs: Math.round(performance.now() - startedAt),
        detail: `Read-only probe of the ${lane.label} lane · the sample is timed by the browser's own resource timing, not by this clock`,
      });
    } catch (error) {
      recordAttempt({
        atMs: Date.now(),
        kind: 'BROWSER_PROBE',
        method: 'GET',
        path: lane.probePath,
        status: 'FAILED',
        elapsedMs: Math.round(performance.now() - startedAt),
        detail: apiErrorMessage(error, `Probe of the ${lane.label} lane failed with no reason published`),
      });
    } finally {
      drainTransportRef.current();
    }
  }, [recordAttempt]);

  /**
   * §14 point 2: after every action BOTH observers are re-read rather than
   * trusting the 200. A mutation that only re-reads the surface it changed
   * cannot tell an applied command from a merely accepted one.
   */
  const refreshAll = useCallback(async (): Promise<void> => {
    drainTransportRef.current();
    await Promise.all([binding.refresh(), refreshStatsLane(), refreshBrowserProbe()]);
  }, [binding, refreshStatsLane, refreshBrowserProbe]);

  // === derived: lanes ======================================================
  //
  // The envelope lane has NO `STALE` rung, deliberately. Calling it stale would
  // need an age threshold this module would have to choose, and Law 1 forbids a
  // chosen threshold where the data can measure one. Two measured facts already
  // answer the question better: `stats.value.cache.ageMs` is the SERVER's own
  // measurement of how old the cut it is serving is, and `staleTabCutFact`
  // proves whether this tab is holding a different cut from the published one.
  const envelope = useMemo((): Lane<ProductSupervisorEnvelope<SystemSupervisorSnapshot>> => {
    if (binding.snapshot !== null) {
      /* THE RETAINED CUT IS STALE, NOT CURRENT.
         The provider's failure branch sets `error` and does NOT clear
         `snapshot`, so a supervisor that dies keeps serving its last cut out of
         this browser's memory. Reporting that as CURRENT made the whole page
         false-current: the sections kept scoring `proven` off a frozen cut, the
         `envelope.state !== 'CURRENT'` announcement branch never fired, and the
         two facts this lane's own comment nominated as substitutes
         (`cache.ageMs` and `staleTabCutFact`) both come from GET /api/watchdog,
         which is down in exactly this scenario. A retained value whose reader
         reported an error is what LaneState.STALE exists for: the value is
         still shown, and it is shown as old. */
      if (binding.error !== null) {
        return staleLane(
          binding.snapshot,
          `SUPERVISOR_READ_FAILED · ${binding.error} · this cut is the last one this browser received and is no longer being refreshed`,
          envelopeObservedAtMs,
          envelopeObservedAtMs,
        );
      }
      return currentLane(binding.snapshot, envelopeObservedAtMs ?? binding.snapshot.evaluatedAtMs);
    }
    if (binding.loading) {
      return loadingLane(
        'SUPERVISOR_READ_IN_FLIGHT · the control-room provider has not settled its first supervisor read',
        null,
        null,
      );
    }
    return unavailableLane(
      binding.error ?? 'SUPERVISOR_ENVELOPE_UNAVAILABLE · the control-room provider published no envelope and no reason',
      null,
      null,
    );
  }, [binding.snapshot, binding.loading, binding.error, envelopeObservedAtMs]);

  const stats = useMemo((): Lane<WatchdogOwnerStats> => {
    if (statsState === 'LOADING') {
      return loadingLane(
        `WATCHDOG_OWNER_LOADING · GET ${WATCHDOG_ENDPOINT} has not settled yet`,
        statsObservedAtMs,
        statsLastSuccessAtMs,
      );
    }
    if (statsState === 'UNAVAILABLE' || statsValue === null) {
      return unavailableLane(
        statsError ?? `WATCHDOG_OWNER_UNAVAILABLE · GET ${WATCHDOG_ENDPOINT} published no reason`,
        statsObservedAtMs,
        statsLastSuccessAtMs,
      );
    }
    if (statsObservedAtMs === null) {
      // Structurally unreachable (both settle callbacks stamp it), and written
      // this way so there is no `?? 0` epoch fallback to accidentally render.
      return loadingLane(
        `WATCHDOG_OWNER_UNSTAMPED · a reading arrived without an observation instant`,
        null,
        statsLastSuccessAtMs,
      );
    }
    return currentLane(statsValue, statsObservedAtMs);
  }, [statsState, statsValue, statsError, statsObservedAtMs, statsLastSuccessAtMs]);

  const lagSamplesProven = lagSamplesAreProven(stats.value);
  const loopLag = useMemo(() => projectLoopLag(stats, lagSamplesProven), [stats, lagSamplesProven]);

  const browserFreshness = useMemo(() => resolveWatchmanHealthFreshness({
    probeStatus: browserProbeStatus,
    lastSuccessAt: browserLastSuccessAtMs,
    observedAt: browserObservedAtMs,
    staleAfterMs: WATCHMAN_HEALTH_STALE_AFTER_MS,
  }), [browserProbeStatus, browserLastSuccessAtMs, browserObservedAtMs]);

  const staleSeconds = Math.round(WATCHMAN_HEALTH_STALE_AFTER_MS / 1_000);
  const socketPhrase = connected ? 'live' : 'reconnecting';

  const browser = useMemo((): Lane<BrowserObservation> => {
    if (browserFreshness.status === 'LOADING') {
      return loadingLane(
        `BROWSER_PROBE_LOADING · GET ${HEALTH_LIVE_ENDPOINT} has not completed a round trip yet`,
        browserObservedAtMs === 0 ? null : browserObservedAtMs,
        browserLastSuccessAtMs,
      );
    }
    if (browserFreshness.status === 'UNAVAILABLE') {
      return unavailableLane(
        browserProbeError ?? `BROWSER_PROBE_UNAVAILABLE · GET ${HEALTH_LIVE_ENDPOINT} failed and published no reason`,
        browserObservedAtMs,
        browserLastSuccessAtMs,
      );
    }
    if (browserFreshness.status === 'STALE') {
      return staleLane(
        browserProbe?.observation ?? null,
        `WATCHMAN_HEALTH_STALE · no successful ${HEALTH_LIVE_ENDPOINT} round trip within ${staleSeconds}s${browserProbeError ? ` · ${browserProbeError}` : ''}`,
        browserObservedAtMs,
        browserLastSuccessAtMs,
      );
    }
    if (browserProbe?.observation == null) {
      // The round trip happened; the server just never confirmed hearing about
      // it. That is an unavailable server OBSERVATION, not an unavailable RTT.
      return unavailableLane(
        `BROWSER_OBSERVATION_UNREPORTED · ${browserProbe?.observationError ?? `POST ${BROWSER_OBSERVATION_ENDPOINT} returned no observation`}`,
        browserObservedAtMs,
        browserLastSuccessAtMs,
      );
    }
    return currentLane(browserProbe.observation, browserObservedAtMs);
  }, [browserFreshness.status, browserProbe, browserProbeError, browserObservedAtMs, browserLastSuccessAtMs, staleSeconds]);

  const browserRttMs = useMemo((): Fact<number> => {
    const source = `${HEALTH_LIVE_ENDPOINT} · performance.now() round trip`;
    if (browserFreshness.status === 'LOADING') {
      return unknownFact(`BROWSER_PROBE_LOADING · GET ${HEALTH_LIVE_ENDPOINT} has not completed a round trip yet`, source);
    }
    if (browserProbe === null) {
      return unknownFact(browserProbeError ?? 'BROWSER_PROBE_UNAVAILABLE · no round trip completed', source);
    }
    return knownFact(Math.round(browserProbe.rttMs), source, browserLastSuccessAtMs);
  }, [browserFreshness.status, browserProbe, browserProbeError, browserLastSuccessAtMs]);

  const browserDetail = useMemo((): string => {
    if (browserFreshness.status === 'LOADING') {
      return `Cockpit state socket ${socketPhrase} · liveness probe loading · browser observation unreported`;
    }
    if (browserFreshness.status === 'UNAVAILABLE') {
      return `Cockpit state socket ${socketPhrase} · ${browserProbeError ?? 'liveness probe failed with no published reason'}`;
    }
    if (browserFreshness.status === 'STALE') {
      return `Cockpit state socket ${socketPhrase} · liveness evidence stale · no successful probe within ${staleSeconds}s · ${browserProbeError ?? 'stale threshold exceeded'}`;
    }
    if (browserProbe?.observation == null) {
      return `Cockpit state socket ${socketPhrase} · round trip measured but browser observation unreported · ${browserProbe?.observationError ?? 'the server returned no observation'}`;
    }
    return `Cockpit state socket ${socketPhrase} · direct ${HEALTH_LIVE_ENDPOINT} liveness round trip · browser observation reported and echoed by the server`;
  }, [browserFreshness.status, browserProbe, browserProbeError, socketPhrase, staleSeconds]);

  const transport = useMemo((): Lane<readonly TransportLaneFact[]> => {
    if (typeof performance?.getEntriesByType !== 'function') {
      return unavailableLane(
        'RESOURCE_TIMING_UNAVAILABLE · this browser exposes no resource-timing buffer, so no transport lane can be observed from here',
        null,
        null,
      );
    }
    if (transportDrainedAtMs === null) {
      return loadingLane('TRANSPORT_BUFFER_NOT_DRAINED · the first passive drain has not run yet', null, null);
    }
    const horizonMs = TRANSPORT_RETENTION_SLOTS * TRANSPORT_DRAIN_MS;
    const horizonSec = horizonMs / 1_000;
    const facts = TRANSPORT_LANES.map((lane): TransportLaneFact => {
      // The horizon is enforced here, not merely quoted. The ring evicts by
      // COUNT; without this filter a single sample taken half an hour ago kept
      // reading as the lane's last/median/max and kept the lane scoring as
      // proven coverage, while the reason string beside it claimed a 40s
      // window. Evidence outside the window it declares is not evidence.
      const samples = transportLanes[lane.id]
        .filter((sample) => transportDrainedAtMs - sample.completedAtMs <= horizonMs);
      const values = samples.map((sample) => sample.durationMs);
      const last = samples.length > 0 ? samples[samples.length - 1] : null;
      const source = `performance.getEntriesByType('resource') · ${lane.prefix}`;
      const noSample = `TRANSPORT_LANE_UNOBSERVED · this tab has issued no request on ${lane.prefix} within the ${horizonSec}s retention horizon`;
      const at = last?.completedAtMs ?? null;
      return Object.freeze({
        laneId: lane.id,
        label: lane.label,
        prefix: lane.prefix,
        probePath: lane.probePath,
        fuseMs: TRANSPORT_FUSE_MS,
        goodMs: 0,
        samples: transportSlots[lane.id],
        retentionSlots: TRANSPORT_RETENTION_SLOTS,
        sampleCount: samples.length,
        lastMs: factOf(last?.durationMs ?? null, noSample, source, at),
        medianMs: factOf(median(values), noSample, source, at),
        maxMs: factOf(values.length > 0 ? Math.max(...values) : null, noSample, source, at),
        wireBytes: last === null
          ? unknownFact<number>(noSample, source)
          : last.transferSize === null || last.transferSize === 0
            ? unknownFact<number>(
              'TRANSPORT_WIRE_SIZE_OPAQUE · transferSize reads 0, which is a cache hit or an opaque timing, not a measured wire size',
              source,
            )
            : knownFact(last.transferSize, source, last.completedAtMs),
        decodedBytes: last === null
          ? unknownFact<number>(noSample, source)
          : factOf(last.decodedBodySize, 'TRANSPORT_DECODED_SIZE_UNPUBLISHED · the entry published no decodedBodySize', source, at),
        fuse: factOf(transportFuseVerdict(last?.durationMs ?? null), noSample, `${source} · vs ${TRANSPORT_FUSE_MS}ms declared fuse`, at),
        fuseMarginMs: factOf(
          last === null ? null : TRANSPORT_FUSE_MS - last.durationMs,
          noSample,
          `${source} · ${TRANSPORT_FUSE_MS}ms fuse − last`,
          at,
        ),
        lastObservedAtMs: at,
      });
    });
    return currentLane(Object.freeze(facts), transportDrainedAtMs);
  }, [transportLanes, transportSlots, transportDrainedAtMs]);

  const transportBuffer = useMemo((): TransportBufferState => Object.freeze({
    state: transportOverflowed ? 'OVERFLOWED' as const : 'DRAINED' as const,
    clearedAtMs: transportDrainedAtMs,
  }), [transportOverflowed, transportDrainedAtMs]);

  // === derived: the published cut ==========================================
  // The server derives its prefix as `digest.replace(/^sha256:/,'').slice(0,8)`
  // (productIntegration/runtime/service.ts). Replicated EXACTLY, so a format
  // change surfaces as a mismatch rather than a silent false match.
  const envelopeCutPrefix = useMemo((): Fact<string> => {
    const digest = envelope.value?.digest ?? null;
    if (digest === null) {
      return unknownFact(
        envelope.reason ?? 'SUPERVISOR_ENVELOPE_UNAVAILABLE · no envelope digest was read',
        `GET ${SUPERVISOR_ENDPOINT} · digest`,
      );
    }
    const prefix = (digest.startsWith('sha256:') ? digest.slice(7) : digest).slice(0, 8);
    return knownFact(prefix, `GET ${SUPERVISOR_ENDPOINT} · digest`, envelope.observedAtMs);
  }, [envelope]);

  const publishedCutPrefix = useMemo((): Fact<string> => factOf(
    stats.value?.cache.digestPrefix8 ?? null,
    stats.reason ?? 'WATCHDOG_CACHE_DIGEST_UNPUBLISHED · the owner published no digest prefix for its current cut',
    `GET ${WATCHDOG_ENDPOINT} · cache.digestPrefix8`,
    stats.observedAtMs,
  ), [stats]);

  const staleTabCutFact = useMemo((): Fact<boolean> => {
    const source = `${WATCHDOG_ENDPOINT} cache.digestPrefix8 vs supervisor digest`;
    if (!publishedCutPrefix.known) return unknownFact(publishedCutPrefix.reason ?? 'CUT_COMPARISON_INCOMPLETE', source);
    if (!envelopeCutPrefix.known) return unknownFact(envelopeCutPrefix.reason ?? 'CUT_COMPARISON_INCOMPLETE', source);
    return knownFact(publishedCutPrefix.value !== envelopeCutPrefix.value, source, stats.observedAtMs);
  }, [publishedCutPrefix, envelopeCutPrefix, stats.observedAtMs]);

  /**
   * `false` means "no divergence proven", never "in sync". The Fact above is the
   * honest render path; this boolean may only ever raise an alarm.
   */
  const staleTabCut = staleTabCutFact.known && staleTabCutFact.value === true;

  // === derived: owners =====================================================
  const snapshot = binding.snapshot;
  const continuity = binding.continuity as MaterialContinuity;

  const canonicalOwners = useMemo((): readonly OwnerFact[] => {
    if (snapshot === null) return Object.freeze(SYSTEM_COMPONENT_IDS.map((id) => absentOwnerFact(id)));
    const envelopeEvidenceProven = !snapshot.persistentSyntheticLabel
      && PROVEN_TRUTH_LABELS.has(snapshot.truthLabel);
    // Locally-owned ids are removed FIRST, so a server row can never shadow one
    // of the three rows this browser owns directly.
    const reported = new Map(
      snapshot.components
        .filter((component) => !LOCALLY_OWNED_WATCHMAN_IDS.has(component.componentId))
        .map((component) => [component.componentId, component]),
    );
    const census = SYSTEM_COMPONENT_IDS.map((id) => {
      const component = reported.get(id);
      reported.delete(id);
      return component === undefined
        ? absentOwnerFact(id)
        : watchmanComponentFromSupervisor(component, continuity, envelopeEvidenceProven);
    });
    // Anything the supervisor reports that the census does not expect is shown,
    // never dropped: a widened contract must be visible on the page that audits it.
    const unexpected = [...reported.values()]
      .map((component) => watchmanComponentFromSupervisor(component, continuity, envelopeEvidenceProven));
    return Object.freeze([...census, ...unexpected]);
  }, [snapshot, continuity]);

  const browserOwner = useMemo((): OwnerFact => {
    const observation = browser.value;
    const reported = browser.state === 'CURRENT' && observation !== null;
    const status: WatchmanStatus = reported
      ? observation.status
      : browser.state === 'STALE' || browserProbe !== null ? 'degraded' : 'outage';
    const state: OwnerState = browser.state === 'LOADING'
      ? 'UNKNOWN'
      : browser.state === 'UNAVAILABLE'
        ? (browserProbe === null ? 'UNAVAILABLE' : 'DEGRADED')
        : browser.state === 'STALE'
          ? 'UNAVAILABLE'
          : observation === null
            ? 'DEGRADED'
            : ownerStateFromPosture(observation.status, 'browser-session', null);
    const reason = state === 'READY'
      ? null
      : browser.reason ?? `${watchmanStatusLabel(status)} · the server classified this round trip as ${status}`;
    return Object.freeze({
      id: 'browser-session',
      label: 'Browser / Website Session',
      group: 'control_path' as const,
      status,
      statusLabel: reported ? watchmanStatusLabel(status) : 'Liveness Unproven',
      state,
      stale: browser.state === 'STALE',
      reason,
        // Two-way proof: the RTT alone is this browser's own claim about itself.
      // Only the server's echo turns that claim into evidence.
      truthClass: reported ? 'proven' as const : 'unproven' as const,
      truthLabel: null,
      capability: null,
      lifecycle: null,
      ownerPath: null,
      blockerCode: null,
      rootCauseComponentId: null,
      capitalRelevance: null,
      detail: browserDetail,
      value: browserRttMs.known ? `${browserRttMs.value} ms` : 'UNPROVEN',
      required: false,
      absent: false,
      latencyMs: browserRttMs.value,
      updatedAtMs: browserLastSuccessAtMs,
      observedAtMs: browserLastSuccessAtMs,
      advance: browser.state === 'CURRENT'
        ? 'ADVANCING' as const
        : browser.state === 'STALE' ? 'WEDGED' as const : 'CADENCE_UNKNOWN' as const,
      correlationId: null,
      supportedControlIds: Object.freeze<string[]>([]),
      samples: browserRttSlots,
      component: null,
      });
  }, [browser, browserProbe, browserDetail, browserRttMs, browserLastSuccessAtMs, browserRttSlots]);

  const binanceOwner = useMemo((): OwnerFact => {
    const guard = projectPrivateReadGuard({
      snapshot: privateRead,
      source: privateReadSource,
      error: privateReadError,
      now: nowMs,
      staleAfterMs: PRIVATE_READ_STALE_AFTER_MS,
    });
    const status: WatchmanStatus = guard.overallTone === 'ok'
      ? 'operational'
      : guard.overallTone === 'bad'
        ? 'outage'
        : guard.overallTone === 'idle' ? 'planned' : 'degraded';
    // Proof requires the primary state channel AND an available, current read.
    // A FALLBACK source is a second-best path, and second-best is not proof.
    const freshness = guard.presentation.freshness;
    const proven = privateRead.state === 'AVAILABLE'
      && privateReadSource === 'STATE'
      && freshness.state === 'CURRENT';
    const rawState = ownerStateFromPosture(status, 'binance-account', null);
    const state: OwnerState = rawState === 'READY' && !proven ? 'UNKNOWN' : rawState;
    const reason = state === 'READY'
      ? null
      : state === 'UNKNOWN'
        ? `PRIVATE_READ_NOT_PROVEN · state ${privateRead.state} · source ${privateReadSource} · freshness ${freshness.state}`
        : privateReadError ?? `${guard.statusLabel} · ${freshness.reason}`;
    return Object.freeze({
      id: 'binance-account',
      label: 'Private Account Adapter',
      group: 'binance' as const,
      status,
      statusLabel: labelAfterDowngrade(rawState, state, guard.statusLabel),
      state,
      stale: freshness.state === 'STALE',
      reason,
        truthClass: proven ? 'proven' as const : 'unproven' as const,
      truthLabel: null,
      capability: null,
      lifecycle: null,
      ownerPath: null,
      blockerCode: null,
      rootCauseComponentId: null,
      capitalRelevance: null,
      detail: `GET-only private-read posture · Source ${privateReadSource} · no signed mutation, order, transfer, or withdrawal path is mounted`,
      value: `GET ONLY · ${privateReadSource}`,
      required: privateRead.state !== 'NOT_CONFIGURED',
      absent: false,
      latencyMs: null,
      updatedAtMs: privateRead.observedAt,
      observedAtMs: privateRead.observedAt,
      advance: freshness.state === 'CURRENT'
        ? 'ADVANCING' as const
        : freshness.state === 'STALE' ? 'WEDGED' as const : 'CADENCE_UNKNOWN' as const,
      correlationId: null,
      supportedControlIds: Object.freeze<string[]>([]),
      samples: Object.freeze<(number | null)[]>([]),
      component: null,
      });
  }, [privateRead, privateReadSource, privateReadError, nowMs]);

  const awsOwner = useMemo((): OwnerFact => {
    const inventory = snapshot?.managedInventory ?? null;
    // Bound to the canonical inventory, NOT to a hardcoded 'Not Configured'
    // literal: the old row asserted a posture the envelope is perfectly capable
    // of contradicting.
    const entries = inventory === null
      ? []
      : inventory.entries.filter((entry) => entry.identity === 'external-watchdog' || entry.identity === 'cloudflare-tunnel-access');
    if (entries.length === 0) {
      const reason = inventory === null
        ? 'MANAGED_INVENTORY_UNAVAILABLE · no supervisor envelope was read, so the runner identities could not be looked up'
        : 'MANAGED_INVENTORY_IDENTITIES_ABSENT · the inventory published neither external-watchdog nor cloudflare-tunnel-access';
      return Object.freeze({
        id: 'aws-runner',
          label: 'AWS Runner',
        group: 'infrastructure' as const,
        status: 'outage' as const,
        statusLabel: 'Inventory Unavailable',
        state: 'UNKNOWN' as const,
        stale: false,
        reason,
            truthClass: 'absent' as const,
        truthLabel: null,
        capability: null,
        lifecycle: null,
        ownerPath: null,
        blockerCode: null,
        rootCauseComponentId: null,
        capitalRelevance: null,
        detail: 'No probe, command, deployment, or console path is mounted from this browser · posture is read from the canonical managed inventory only',
        value: 'UNKNOWN',
        required: false,
        absent: true,
        latencyMs: null,
        updatedAtMs: null,
            observedAtMs: null,
        advance: 'CADENCE_UNKNOWN' as const,
        correlationId: null,
        supportedControlIds: Object.freeze<string[]>([]),
        samples: Object.freeze<(number | null)[]>([]),
        component: null,
          });
    }
    const rank: Record<string, number> = { EVIDENCE_PRESENT: 0, OWNER_GATED: 1, NOT_CONFIGURED: 2, MISSING: 3 };
    const worst = entries.reduce((acc, entry) => (rank[entry.inventoryState] > rank[acc.inventoryState] ? entry : acc), entries[0]);
    const rawState: OwnerState = worst.inventoryState === 'EVIDENCE_PRESENT'
      ? 'READY'
      : worst.inventoryState === 'OWNER_GATED'
        ? 'OWNER_GATED'
        : worst.inventoryState === 'NOT_CONFIGURED'
          ? 'NOT_CONFIGURED'
          : 'UNAVAILABLE';
    const status: WatchmanStatus = worst.inventoryState === 'EVIDENCE_PRESENT'
      ? 'operational'
      : worst.inventoryState === 'MISSING' ? 'outage' : 'planned';
    const proven = entries.every((entry) => entry.inventoryState === 'EVIDENCE_PRESENT') && continuity === 'PROVEN';
    const state: OwnerState = rawState === 'READY' && !proven ? 'UNKNOWN' : rawState;
    const codes = entries
      .map((entry) => `${entry.identity} ${entry.inventoryState}${entry.reasonCode ? ` (${entry.reasonCode})` : ''}`)
      .join(' · ');
    return Object.freeze({
      id: 'aws-runner',
      label: 'AWS Runner',
      group: 'infrastructure' as const,
      status,
      statusLabel: labelAfterDowngrade(rawState, state, titleCase(worst.inventoryState)),
      state,
      stale: false,
      reason: state === 'READY' ? null : codes,
      truthClass: proven ? 'proven' as const : 'unproven' as const,
      truthLabel: null,
      capability: null,
      lifecycle: null,
      ownerPath: worst.owner,
      blockerCode: worst.reasonCode,
      rootCauseComponentId: null,
      capitalRelevance: null,
      detail: `${codes} · owner ${worst.owner} · no probe, command, deployment, or console path is mounted from this browser`,
      value: worst.inventoryState.replaceAll('_', ' '),
      required: entries.some((entry) => entry.inventoryState !== 'NOT_CONFIGURED'),
      absent: false,
      latencyMs: null,
      updatedAtMs: null,
        observedAtMs: null,
      advance: 'CADENCE_UNKNOWN' as const,
      correlationId: null,
      supportedControlIds: Object.freeze<string[]>([]),
      samples: Object.freeze<(number | null)[]>([]),
      component: null,
      });
  }, [snapshot, continuity]);

  /** Parity order: the browser first, the machine in the middle, the gated edges last. */
  const owners = useMemo(
    (): readonly OwnerFact[] => Object.freeze([browserOwner, ...canonicalOwners, binanceOwner, awsOwner]),
    [browserOwner, canonicalOwners, binanceOwner, awsOwner],
  );

  const ownerTally = useMemo(
    (): CoverageTally => tallyOf(owners.map((owner) => owner.state)),
    [owners],
  );

  // === derived: section coverage ===========================================
  const sections = useMemo((): Readonly<Record<WatchdogSectionId, SectionCoverage>> => {
    const envelopeCadence = knownFact(
      ENVELOPE_PROVIDER_CADENCE_MS,
      'ProductControlRoomProvider · declared provider cadence',
      null,
    );
    const observedAt = envelope.observedAtMs;
    const ownerAges = owners.map((owner) => owner.observedAtMs);

    // 1 · POSTURE — the four owner verdicts the envelope publishes.
    const posture = ((): SectionCoverage => {
      const source = `GET ${SUPERVISOR_ENDPOINT} · ownerView`;
      const view = envelope.value?.ownerView ?? null;
      /* A retained cut is not a measurement. Scoring `proven` off an envelope
         whose own lane is STALE let the section head keep printing coverage for
         a supervisor that had stopped answering. */
      if (view === null || envelope.state !== 'CURRENT') {
        return unmeasuredCoverage(
          source,
          envelope.reason ?? 'SUPERVISOR_ENVELOPE_UNAVAILABLE · the owner verdicts were not read',
          envelopeCadence,
        );
      }
      // Only verdicts whose values are DECIDABLE are scored. `dataFreshness` is
      // free-form owner text, so counting a non-null string as pass would be a
      // false green of exactly the kind this page exists to remove; PostureBand
      // still renders it, it simply is not a scored verdict. `tradeReady` is the
      // literal 'NO' by type, and scoring it BLOCKED is the i00 gate made visible
      // rather than quietly excluded from the count.
      const verdicts: readonly OwnerState[] = [
        view.machineReady === 'YES' ? 'READY' : view.machineReady === 'UNKNOWN' ? 'UNKNOWN' : 'BLOCKED',
        view.topRootBlocker === null ? 'READY' : 'BLOCKED',
        view.effectiveMode === 'UNKNOWN' ? 'UNKNOWN' : view.effectiveMode === 'BLOCKED' ? 'BLOCKED' : 'READY',
        view.tradeReady === 'NO' ? 'BLOCKED' : 'UNKNOWN',
      ];
      return coverageFromTally(
        tallyOf(verdicts),
        source,
        envelopeCadence,
        factOf(envelope.value?.evaluatedAtMs ?? null, 'ENVELOPE_EVALUATION_INSTANT_UNPUBLISHED', source, observedAt),
        observedAt,
      );
    })();

    // 2 · OWNERS — fully measured; this is the census itself.
    const ownersCoverage = coverageFromTally(
      ownerTally,
      `GET ${SUPERVISOR_ENDPOINT} · components[] + three locally-owned rows`,
      envelopeCadence,
      factOf(
        oldestOf(ownerAges),
        'OWNER_EVIDENCE_INSTANTS_UNPUBLISHED · no owner in this census published an observation instant',
        `GET ${SUPERVISOR_ENDPOINT} · components[].heartbeatAtMs`,
        observedAt,
      ),
      observedAt,
    );

    // 3 · TOPOLOGY — the six fixed hops, scored by the owner behind each hop.
    const topology = ((): SectionCoverage => {
      const source = 'Connection path · six fixed hops scored by their owner';
      const byId = new Map(owners.map((owner) => [owner.id, owner]));
      const hops = CONNECTION_PATH_IDS.map((id) => byId.get(id)?.state ?? 'UNAVAILABLE' as OwnerState);
      const hopAges = CONNECTION_PATH_IDS.map((id) => byId.get(id)?.observedAtMs ?? null);
      return coverageFromTally(
        tallyOf(hops),
        source,
        envelopeCadence,
        factOf(oldestOf(hopAges), 'HOP_EVIDENCE_INSTANTS_UNPUBLISHED · no hop on the path published an observation instant', source, observedAt),
        observedAt,
      );
    })();

    // 4 · CONTROL — classified on the registry's OWN wiring state and its own
    //     disabledReason. Nothing about authority is inferred here.
    const control = ((): SectionCoverage => {
      const source = `GET ${SUPERVISOR_ENDPOINT} · controls[]`;
      const controls = envelope.value?.controls ?? null;
      /* Same gate as the posture partition: a registry read off a frozen cut
         describes what the supervisor USED to publish, not what it publishes. */
      if (controls === null || envelope.state !== 'CURRENT') {
        return unmeasuredCoverage(
          source,
          envelope.reason ?? 'SUPERVISOR_ENVELOPE_UNAVAILABLE · the control registry was not read',
          envelopeCadence,
        );
      }
      const states: OwnerState[] = controls.map((entry) => {
        if (entry.wiringState === 'WIRED_LIVE') return entry.disabledReason === null ? 'READY' : 'NOT_CONFIGURED';
        if (entry.wiringState === 'OWNER_GATED') return 'OWNER_GATED';
        if (entry.wiringState.startsWith('UNAVAILABLE:')) return 'BLOCKED';
        return 'UNKNOWN';
      });
      return coverageFromTally(
        tallyOf(states),
        source,
        envelopeCadence,
        factOf(envelope.value?.evaluatedAtMs ?? null, 'ENVELOPE_EVALUATION_INSTANT_UNPUBLISHED', source, observedAt),
        observedAt,
      );
    })();

    // 5 · RECOVERY — the canonical refresh targets, scored by the posture
    //     helper that already gates the POST. No cadence: it is operator-driven.
    const recovery = ((): SectionCoverage => {
      const source = 'canonicalRefreshTargetPosture · POST /api/refresh targets';
      const targets: readonly CanonicalRefreshTarget[] = ['all', 'market', 'runtime', 'news', 'calendar', 'fx'];
      /* A REFUSAL is measured: `canonicalRefreshTargetPosture` is the authority
         that gates the POST, so "this browser will not issue it" is a fact.
         PERMISSION is not: that this browser would issue the request is no
         evidence whatsoever that the request works, and scoring it `proven`
         made this section print `3 proven` unchanged on a dead machine, in the
         identical figure row the four genuinely measured sections use. A
         permitted target is UNKNOWN until something is actually run against it. */
      const states = targets.map((target): OwnerState =>
        canonicalRefreshTargetPosture(target).actionAllowed ? 'UNKNOWN' : 'OWNER_GATED');
      return coverageFromTally(
        tallyOf(states),
        source,
        notApplicable<number>(`${source} · cadence`),
        notApplicable<number>(`${source} · oldest evidence`),
        null,
      );
    })();

    // 6 · OBSERVER — the eight transport lanes. A lane cannot be withheld on
    //     this page, so `withheld` is a measured zero, not an omission.
    const observer = ((): SectionCoverage => {
      const source = "performance.getEntriesByType('resource') · eight declared lanes";
      const lanes = transport.value;
      if (lanes === null) {
        return unmeasuredCoverage(
          source,
          transport.reason ?? 'TRANSPORT_UNAVAILABLE · no lane could be observed',
          knownFact(TRANSPORT_DRAIN_MS, `${source} · declared drain cadence`, null),
        );
      }
      const states = lanes.map((lane): OwnerState => {
        if (!lane.lastMs.known) return 'UNKNOWN';
        if (lane.fuse.value === 'BLOWN') return 'BLOCKED';
        return lane.fuse.value === 'CLOSE' ? 'DEGRADED' : 'READY';
      });
      return coverageFromTally(
        tallyOf(states),
        source,
        knownFact(TRANSPORT_DRAIN_MS, `${source} · declared drain cadence`, null),
        factOf(
          oldestOf(lanes.map((lane) => lane.lastObservedAtMs)),
          'TRANSPORT_LANES_UNOBSERVED · no lane has produced a sample in this tab',
          source,
          transport.observedAtMs,
        ),
        transport.observedAtMs,
      );
    })();

    return Object.freeze({ posture, owners: ownersCoverage, topology, control, recovery, observer });
  }, [envelope, owners, ownerTally, transport]);

  // === derived: the single live-region utterance ===========================
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const announcementSignatureRef = useRef<string | null>(null);
  const announcementSeqRef = useRef(0);

  const blockedOwnerIds = useMemo(
    () => owners.filter((owner) => owner.state === 'BLOCKED').map((owner) => owner.id).sort().join(','),
    [owners],
  );

  /* The census's OWN adverse count, and it is not the same set as the blocked
     ids. Only BLOCKED owners were ever in the signature, so UNAVAILABLE,
     DEGRADED, UNKNOWN and NOT_CONFIGURED were invisible to the region — and the
     page's one live region could speak "All observed lanes returned to current"
     while thirteen of the fourteen canonical components were absent. */
  const unprovenOwnerCount = useMemo(
    () => owners.filter((owner) => owner.state !== 'READY').length,
    [owners],
  );

  useEffect(() => {
    // Consequence, not chatter: a poll that changed none of these is silent.
    const signature = [
      continuity,
      envelope.state,
      stats.state,
      browser.state,
      staleTabCut ? 'CUT_DIVERGED' : 'CUT_UNDIVERGED',
      blockedOwnerIds,
      `UNPROVEN_OWNERS:${unprovenOwnerCount}`,
    ].join('|');
    if (announcementSignatureRef.current === null) {
      // First paint is not a transition. The region exists from first paint and
      // says nothing until something actually changes.
      announcementSignatureRef.current = signature;
      return;
    }
    if (announcementSignatureRef.current === signature) return;
    announcementSignatureRef.current = signature;
    announcementSeqRef.current += 1;
    const parts: string[] = [];
    if (envelope.state !== 'CURRENT') parts.push(`Supervisor envelope ${envelope.state.toLowerCase()}`);
    if (continuity !== 'PROVEN') parts.push(`material continuity ${continuity.toLowerCase()}`);
    if (stats.state !== 'CURRENT') parts.push(`watchdog owner ${stats.state.toLowerCase()}`);
    if (browser.state !== 'CURRENT') parts.push(`browser liveness ${browser.state.toLowerCase()}`);
    if (staleTabCut) parts.push('this tab is holding a different cut from the one the server publishes');
    if (blockedOwnerIds !== '') parts.push(`blocked: ${blockedOwnerIds.replaceAll(',', ', ')}`);
    /* Counted separately from the blocked list, because "not blocked" is not
       "proven": an absent component is UNAVAILABLE, and thirteen of those is
       the opposite of an all-clear. */
    const notBlocked = unprovenOwnerCount - (blockedOwnerIds === '' ? 0 : blockedOwnerIds.split(',').length);
    if (notBlocked > 0) {
      parts.push(`${notBlocked} of ${owners.length} owners unproven without being blocked`);
    }
    setAnnouncement(Object.freeze({
      seq: announcementSeqRef.current,
      /* The all-clear names what it checked. An unqualified "all lanes" over a
         census this utterance never counted is the false green in audio form. */
      text: parts.length === 0
        ? `All observed lanes current and all ${owners.length} owners proven.`
        : `${parts.join('. ')}.`,
    }));
  }, [continuity, envelope.state, stats.state, browser.state, staleTabCut, blockedOwnerIds, unprovenOwnerCount, owners.length]);

  // === derived: market, cadence ============================================
  /* DELETED: the `market` lane and its `MarketEvidence` type. A whole lane was
     projected on every render and no component read it — §6 of the parity
     ledger calls that class of thing out by name, and it is the same defect as
     a control nothing is wired to, pointed at the read side. If a market lane
     earns a place on this page it comes back with a renderer attached. */

  const cadence = useMemo((): CadenceState => {
    const rows = CADENCE_ROWS.map((row): CadenceRow => {
      const effectiveSeconds = prefs.dataCadence?.[row.key] ?? DATA_CADENCE_DEFAULTS[row.key];
      const requestedSeconds = cadenceRequested[row.key] ?? null;
      return Object.freeze({
        key: row.key,
        label: row.label,
        appliesTo: row.appliesTo,
        requestedSeconds,
        effectiveSeconds,
        defaultSeconds: DATA_CADENCE_DEFAULTS[row.key],
        atDefault: effectiveSeconds === DATA_CADENCE_DEFAULTS[row.key],
        reconciled: requestedSeconds !== null && requestedSeconds !== effectiveSeconds,
        survivesReload: (MARKET_PING_CHOICES as readonly number[]).includes(effectiveSeconds),
        coupledPref: row.coupledPref,
      });
    });
    return Object.freeze({
      rows: Object.freeze(rows),
      choices: MARKET_PING_CHOICES,
      storage: 'LOCAL_BROWSER_PREFERENCE' as const,
      anyReconciled: rows.some((row) => row.reconciled),
      anyOffDefault: rows.some((row) => !row.atDefault),
    });
  }, [prefs.dataCadence, cadenceRequested]);

  const setCadence = useCallback((key: CadenceKey, seconds: number) => {
    setCadenceRequested((current) => Object.freeze({ ...current, [key]: seconds }));
    const next = { ...DATA_CADENCE_DEFAULTS, ...(prefs.dataCadence ?? {}), [key]: seconds };
    updatePref('dataCadence', next);
    // `refreshSec` is the legacy market cadence and normalizePrefs keeps the two
    // in lockstep on load; writing only one of them would be reverted silently.
    if (key === 'market') updatePref('refreshSec', seconds);
    recordAttempt({
      atMs: Date.now(),
      kind: 'CADENCE_WRITE',
      method: 'LOCAL',
      path: `localStorage · prefs.dataCadence.${key}`,
      status: 'STORED',
      elapsedMs: 0,
      detail: `Requested ${seconds}s · browser preference only, never a server mutation`,
    });
  }, [prefs.dataCadence, updatePref, recordAttempt]);

  const resetCadenceDefaults = useCallback(() => {
    setCadenceRequested(() => Object.freeze({}));
    const next = { ...DATA_CADENCE_DEFAULTS, ...(prefs.dataCadence ?? {}) };
    for (const row of CADENCE_ROWS) next[row.key] = DATA_CADENCE_DEFAULTS[row.key];
    updatePref('dataCadence', next);
    updatePref('refreshSec', DATA_CADENCE_DEFAULTS.market);
    recordAttempt({
      atMs: Date.now(),
      kind: 'CADENCE_WRITE',
      method: 'LOCAL',
      path: 'localStorage · prefs.dataCadence',
      status: 'STORED',
      elapsedMs: 0,
      detail: `Restored defaults · market ${DATA_CADENCE_DEFAULTS.market}s · news ${DATA_CADENCE_DEFAULTS.news}s · calendar ${DATA_CADENCE_DEFAULTS.calendar}s`,
    });
  }, [prefs.dataCadence, updatePref, recordAttempt]);

  return {
    nowMs,
    client,
    envelope,
    continuity,
    continuityError: binding.error,
    stats,
    lagSamplesProven,
    loopLag,
    browser,
    browserRttMs,
    /* DELETED from the public surface: `browserObservationReported` and
       `browserObservationError`. Both were published and read by nothing;
       `browserDetail` already carries the same two facts as the sentence the
       browser row actually renders. */
    browserDetail,
    transport,
    transportBuffer,
    socketConnected: connected,
    staleTabCut,
    staleTabCutFact,
    publishedCutPrefix,
    envelopeCutPrefix,
    owners,
    ownerTally,
    sections,
    announcement,
    cadence,
    setCadence,
    resetCadenceDefaults,
    attempts,
    recordAttempt,
    refreshAll,
    refreshBrowserProbe,
    probeTransportLane,
  };
}
