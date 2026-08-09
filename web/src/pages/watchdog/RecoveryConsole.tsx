/* =============================================================================
   RecoveryConsole — §5 of the Watchdog page.

   "The committed action console that teaches the operational boundary before it
   offers the action, paired with the cadence ledger that adjusts polling
   pressure inline."

   THE OPERATOR QUESTION THIS FILE ANSWERS
     What bounded recovery am I actually permitted to run right now, why are the
     others refused, exactly what did each step of the one I ran do, and how hard
     is this cockpit polling each source?

   OWNERSHIP — write lane 1
   ------------------------
   This module is the ONLY place on the page that names `POST /api/refresh`, and
   it holds the page's single re-entrancy guard. The frozen props hand the state
   CELLS to WatchdogSurface (`busyTarget`, `lastResult`, `reconciliation` are
   declared shell-owned), so the request itself is exported from here as
   `createRecoveryRunner()` and the shell's `onRun` is a one-line delegate:

       const runner = useMemo(() => createRecoveryRunner(), []);
       const onRun  = useCallback((t: CanonicalRefreshTarget) => runner.run(t, {
         setBusyTarget: setRefreshBusyTarget,
         setLastResult: setLastRefreshResult,
       }), [runner]);

   One endpoint, one guard, one implementation, and no duplicated state. The
   guard lives in that factory's closure — never at module scope, which the
   architecture forbids.

   `Date.now()`, `performance.now()` and `fetchJson` appear below ONLY inside
   that runner and the two exported preference writers. That is write-lane
   exception 1; no render path calls them, and every rendered age comes from the
   `nowMs` prop — the hook's single 1000ms operator clock. The pinned regression
   is web/test/productControlRoom/dashboard-age-clock.test.mjs: computing an age
   from the payload's own timestamp made a wedged supervisor indistinguishable
   from a live one.

   BIBLE COMPOSITION
   -----------------
   §3.6  Button      gate model, fill-only hierarchy, reserved pending label
   §3.8  Select      the cadence reconciliation ledger, REQUESTED vs EFFECTIVE
   §3.11 InfoRow     the boundary, taught on a fixed gutter INSIDE the surface
   §3.13 EmptyState  the unmet contract, as eight obligation rows
   §3.18 CardFrame   no card; the three receipt tracks and the age law
   composed from neighbours, never re-implemented (§3.0, §5 L23/L24):
     StatusChip     every state word, tone and mandatory reason
     AbsenceSlot    §3.12 slot-scale absence, 3ch, with its sr-only reason
     AbsenceColumnNote  §3.12 column-scale absence — 100% or silence
     Numeric        the character grid, the reserved tracks, the reason render
     Identifier     middle truncation with copy

   FOUR ADJUDICATIONS, stated rather than smuggled
   -----------------------------------------------
   1. Parity §14 wants the run button to read "Refreshing" in flight. §3.6's
      Label Law says a control's label must describe what PRESSING it does. The
      bible wins on anything visible: the label is constant, the in-flight signal
      is the reserved-width spinner, and the word "Refreshing" moves to the
      console's one status sentence, where it is a statement about the machine
      rather than a lie about the button.
   2. Parity §7b wants the Defaults button to read "Restored" for 1800ms. Same
      law, same resolution — and the acknowledgement is upgraded from one word
      to the three values that were actually written.
   3. §4.7 pins ONE `role="status" aria-live="polite" aria-atomic="true"` to the
      page header. This file adds one NON-atomic `role="status"` sentence, which
      §3.12's PANEL rule explicitly licenses below the header. It utters at most
      once per operator action and never on a poll, so it cannot flood.
   4. §3.6's gate model says a refused control renders sunken + dashed with
      `aria-disabled`, while §5 L22 says where no action is legal render NO
      control and say why in a visible row. Both are honoured: the refusal
      sentence is real DOM text beside the control, AND pressing the control is
      still live — it materialises the canonical refusal in the receipt through
      the same machinery, with zero bytes on the wire. A control that silently
      does nothing is the exact defect this page exists to repair.
   ========================================================================== */

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

import { PillSelect } from '../../components/PillSelect';
import { fetchJson, ApiRequestError } from '../../lib/http';
import { fireRefresh } from '../../lib/refresh';
import {
  canonicalRefreshTargetPosture,
  type CanonicalRefreshTarget,
  type CanonicalRefreshTargetPosture,
} from '../../lib/operatorControlPosture';
/* DATA_CADENCE_DEFAULTS is imported for the WRITE only. Nothing in this file's
   render path reads it: a rendered default must come from the ledger row the
   evidence module measured, or the page would show the value it meant to write
   rather than the value the store kept. */
import { DATA_CADENCE_DEFAULTS } from '../../lib/prefs';
import { StatusChip, type Rung } from './StatusChip';
import { Identifier, Numeric, ageParts as ageLadder } from './MachineValue';
import {
  knownFact,
  unknownFact,
  type Attempt,
  type CadenceKey,
  type CadenceRow,
  type CadenceState,
  type Fact,
} from './watchdogEvidence';

import './RecoveryConsole.css';

/* =============================================================================
   1 · THE TARGET CATALOGUE — parity §13. Labels and details verbatim.
   The posture is never stored, only asked of the canonical module at render, so
   a change in `canonicalRefreshTargetPosture` can never leave a stale gate here.
   ========================================================================== */

export interface RecoveryTargetEntry {
  readonly target: CanonicalRefreshTarget;
  readonly label: string;
  readonly detail: string;
}

export const RECOVERY_TARGETS: readonly RecoveryTargetEntry[] = Object.freeze([
  {
    target: 'all',
    label: 'Mounted Connections',
    detail: 'CONTROL_PREVIEW_REQUIRED · managed-runtime recovery requires canonical preview and receipt',
  },
  {
    target: 'market',
    label: 'Market Network',
    detail: 'CONTROL_PREVIEW_REQUIRED · the compatibility route cannot rebuild market runtimes',
  },
  {
    target: 'runtime',
    label: 'Bot Runtimes',
    detail: 'CONTROL_PREVIEW_REQUIRED · engine restart is owned by canonical Product controls',
  },
  { target: 'news', label: 'News Sources', detail: 'Refresh every configured source adapter' },
  { target: 'calendar', label: 'Calendar', detail: 'Rebuild the economic-event cache' },
  { target: 'fx', label: 'FX Rates', detail: 'Refresh display-currency references' },
] as const);

/** The console OPENS BLOCKED on purpose: read the boundary, then read the button. */
export const RECOVERY_DEFAULT_TARGET: CanonicalRefreshTarget = 'all';

/* The cadence CONTRACT is the evidence module's, not this file's (§5 L24). It
   already measures four facts a local copy would have had to invent — which
   poll each row actually moves, what the store kept, whether the value survives
   a reload, and which second preference is coupled to it. Re-declaring the
   shape here would have produced a second, quieter answer. */
export type { CadenceKey, CadenceRow, CadenceState } from './watchdogEvidence';

/** Parity §7b: the per-row detail sentence, keyed by the evidence module's row. */
const CADENCE_DETAIL: Readonly<Record<CadenceKey, string>> = Object.freeze({
  market: 'Polling cadence only · refresh is CONTROL_PREVIEW_REQUIRED',
  news: 'Feed fallback and new-item context',
  calendar: 'Macro releases and value changes',
});

/** Which bounded refresh, if any, each cadence row can also trigger inline. */
const CADENCE_TARGET: Readonly<Record<CadenceKey, CanonicalRefreshTarget>> = Object.freeze({
  market: 'market',
  news: 'news',
  calendar: 'calendar',
});

/**
 * Parity §7b: the acknowledgement window. The acknowledgement is a receipt for
 * a PRESS — it is armed by the Restore-defaults click inside this console and
 * self-clears after this dwell. It used to be bound to the standing condition
 * `cadence.anyOffDefault === false`, which is true on a cold load, so a fresh
 * tab announced "written to this browser" before anything had been written and
 * then held the console's one status sentence for good.
 */
export const RECOVERY_RESTORED_MS = 1_800;

/** The bounded request lifetime the architecture pins for this lane. */
export const RECOVERY_TIMEOUT_MS = 8_000;

const REFRESH_PATH = '/api/refresh';
const SOURCE = `POST ${REFRESH_PATH}`;

/* =============================================================================
   2 · THE RESULT — the server's WHOLE answer, not the two fields the old UI kept.
   Every rendered datum is a Fact, so a field the server omitted renders its
   reason rather than a flattering default (FORBIDDEN 1, §5 L1).
   ========================================================================== */

export type RefreshOutcome =
  | 'ACCEPTED'            // HTTP 200, server ok:true, zero issues
  | 'PARTIAL'             // HTTP 200, but the server itself reported issues
  | 'REFUSED'             // the server answered and declined (400 / 409 / 503)
  | 'FAILED'              // transport, timeout, or an unreadable body
  | 'BLOCKED_BY_POSTURE'  // no request was issued at all
  | 'BLOCKED_BY_INFLIGHT';// the page's single guard held; no request was issued

export interface RefreshStepReceipt {
  readonly key: string;
  readonly ok: Fact<boolean>;
  readonly durationMs: Fact<number>;
  readonly detail: Fact<string>;
}

export interface RefreshRunResult {
  readonly target: CanonicalRefreshTarget;
  readonly outcome: RefreshOutcome;
  /** Client-measured with performance.now(); the console timed its own request. */
  readonly elapsedMs: number;
  readonly settledAtMs: number;
  /** null ⇒ no request left this browser (posture refusal, or transport failure). */
  readonly httpStatus: number | null;
  readonly serverCode: string | null;
  readonly serverTs: Fact<number>;
  /** null ⇒ the server sent no reset transcript; `stepsReason` says why. */
  readonly steps: readonly RefreshStepReceipt[] | null;
  readonly stepsReason: string | null;
  readonly serverWindowMs: Fact<number>;
  readonly issues: readonly string[];
  readonly feedsOk: Fact<boolean>;
  readonly binanceConnected: Fact<boolean>;
  readonly walletBalancesOk: Fact<boolean>;
  readonly keysPresent: Fact<boolean>;
}

/** The name WatchdogSurface imports. One type, one shape. */
export type RefreshResult = RefreshRunResult;

/* §3.8 — the two headed columns are REQUESTED (what this session asked for) and
   READBACK (what the store kept). Neither is an achieved interval, and the
   column header says so out loud rather than letting the operator assume it: an
   interval is a DIFFERENCE between two completions, and nothing on this page
   observes a poll completing.

   When a shell CAN measure one, it passes it here and the row states it as a
   third, separately-labelled fact — never in the readback column, and never
   before `observedGeneration === requestGeneration && completions >= 2`. Two,
   not one, which is why `measuring` exists as a state distinct from `accepted`.

   Verify by grep: no `requestedSeconds` or `effectiveSeconds` ever reaches
   `CadenceMeasuredInterval`. */


/* =============================================================================
   3 · THE RUNNER — write lane 1. The page's only `/api/refresh` caller.
   ========================================================================== */

interface RawStep { key?: unknown; ok?: unknown; durationMs?: unknown; detail?: unknown }
interface RawReset { target?: unknown; startedAt?: unknown; finishedAt?: unknown; steps?: unknown }
interface RawRefreshBody {
  ok?: unknown;
  issues?: unknown;
  ts?: unknown;
  feedsOk?: unknown;
  binanceConnected?: unknown;
  walletBalancesOk?: unknown;
  keysPresent?: unknown;
  reset?: RawReset;
}

const FIELD_ABSENT = 'REFRESH_RESPONSE_FIELD_ABSENT · the server did not return this field on this response';

function boolFact(raw: unknown, field: string, atMs: number | null): Fact<boolean> {
  return typeof raw === 'boolean'
    ? knownFact(raw, `${SOURCE} · ${field}`, atMs)
    : unknownFact(FIELD_ABSENT, `${SOURCE} · ${field}`);
}

function numFact(raw: unknown, field: string, atMs: number | null): Fact<number> {
  return typeof raw === 'number' && Number.isFinite(raw)
    ? knownFact(raw, `${SOURCE} · ${field}`, atMs)
    : unknownFact(FIELD_ABSENT, `${SOURCE} · ${field}`);
}

function strFact(raw: unknown, field: string, atMs: number | null): Fact<string> {
  return typeof raw === 'string' && raw.trim().length > 0
    ? knownFact(raw, `${SOURCE} · ${field}`, atMs)
    : unknownFact(FIELD_ABSENT, `${SOURCE} · ${field}`);
}

function projectSteps(raw: unknown, atMs: number | null): readonly RefreshStepReceipt[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((entry, index): RefreshStepReceipt => {
    const step = (entry ?? {}) as RawStep;
    return {
      key: typeof step.key === 'string' && step.key.trim() ? step.key : `step-${index + 1}`,
      ok: boolFact(step.ok, `reset.steps[${index}].ok`, atMs),
      durationMs: numFact(step.durationMs, `reset.steps[${index}].durationMs`, atMs),
      detail: strFact(step.detail, `reset.steps[${index}].detail`, atMs),
    };
  });
}

function stringList(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.trim().length > 0) out.push(entry);
    else if (entry !== null && entry !== undefined) out.push(JSON.stringify(entry));
  }
  return out;
}

type ReadbackFields = Pick<
  RefreshRunResult,
  'feedsOk' | 'binanceConnected' | 'walletBalancesOk' | 'keysPresent'
>;

function unreadableReadback(reason: string): ReadbackFields {
  return {
    feedsOk: unknownFact(reason, `${SOURCE} · feedsOk`),
    binanceConnected: unknownFact(reason, `${SOURCE} · binanceConnected`),
    walletBalancesOk: unknownFact(reason, `${SOURCE} · walletBalancesOk`),
    keysPresent: unknownFact(reason, `${SOURCE} · keysPresent`),
  };
}

export interface RecoveryRunDeps {
  readonly setBusyTarget: (target: CanonicalRefreshTarget | null) => void;
  readonly setLastResult: (result: RefreshRunResult) => void;
}

export interface RecoveryRunner {
  /** Resolves when the console may be pressed again. Never throws. */
  run: (target: CanonicalRefreshTarget, deps: RecoveryRunDeps) => Promise<void>;
  busy: () => boolean;
}

/**
 * Parity §14, verbatim in behaviour: the canonical posture gate runs FIRST and a
 * refused target issues no request at all; the guard is taken before any
 * mutation; `fireRefresh()` fires the moment a response exists so the rest of
 * the app re-reads; the guard is released in `finally`, so a thrown request can
 * never wedge the console.
 *
 * The one improvement on parity: the error branch no longer collapses the
 * server's answer into a single sentence. `ApiRequestError` carries `status`,
 * `code` and `details` — and `details` is literally the route's own `issues`
 * array (lib/http.ts:62) — so a 409 CONTROL_PREVIEW_REQUIRED renders the
 * server's own words instead of a paraphrase.
 */
export function createRecoveryRunner(): RecoveryRunner {
  let busyTarget: CanonicalRefreshTarget | null = null;

  const run = async (target: CanonicalRefreshTarget, deps: RecoveryRunDeps): Promise<void> => {
    const posture = canonicalRefreshTargetPosture(target);

    /* Gate first. A blocked target is a REAL result carrying the canonical
       reason — and zero bytes on the wire. */
    if (!posture.actionAllowed) {
      deps.setLastResult({
        target,
        outcome: 'BLOCKED_BY_POSTURE',
        elapsedMs: 0,
        settledAtMs: Date.now(),
        httpStatus: null,
        serverCode: posture.statusLabel,
        serverTs: unknownFact(
          'NO_REQUEST_ISSUED · the canonical posture refused this target before any transport',
          `${SOURCE} · ts`,
        ),
        steps: null,
        stepsReason: 'NO_STEP_RAN · no request was issued, so the server executed no recovery step',
        serverWindowMs: unknownFact('NO_REQUEST_ISSUED · the server was not asked to do work', `${SOURCE} · reset`),
        issues: [`${posture.statusLabel} · ${posture.reason}`],
        ...unreadableReadback('NO_REQUEST_ISSUED · the server was never asked'),
      });
      return;
    }

    /* The page's single re-entrancy guard. It refuses with a RECEIPT rather
       than a bare return: a press that produces nothing at all is the exact
       defect this page exists to repair, and "another refresh is already in
       flight" is the most useful thing the console can say at that moment. */
    if (busyTarget !== null) {
      const held = busyTarget;
      deps.setLastResult({
        target,
        outcome: 'BLOCKED_BY_INFLIGHT',
        elapsedMs: 0,
        settledAtMs: Date.now(),
        httpStatus: null,
        serverCode: 'REFRESH_ALREADY_IN_FLIGHT',
        serverTs: unknownFact(
          'NO_REQUEST_ISSUED · a refresh was already in flight, so this press issued no transport',
          `${SOURCE} · ts`,
        ),
        steps: null,
        stepsReason: 'NO_STEP_RAN · no request was issued, so the server executed no recovery step',
        serverWindowMs: unknownFact('NO_REQUEST_ISSUED · the server was not asked to do work', `${SOURCE} · reset`),
        issues: [`REFRESH_ALREADY_IN_FLIGHT · ${held} is still running in this browser`],
        ...unreadableReadback('NO_REQUEST_ISSUED · the server was never asked'),
      });
      return;
    }
    busyTarget = target;
    deps.setBusyTarget(target);

    const startedAt = performance.now();
    try {
      const body = await fetchJson<RawRefreshBody>(REFRESH_PATH, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      }, RECOVERY_TIMEOUT_MS);

      const elapsedMs = Math.round(performance.now() - startedAt);
      const settledAtMs = Date.now();
      const serverTs = numFact(body.ts, 'ts', settledAtMs);
      const observedAt = serverTs.value ?? settledAtMs;
      const issues = stringList(body.issues);
      const reset: RawReset = body.reset ?? {};
      const steps = projectSteps(reset.steps, observedAt);
      const openedAt = typeof reset.startedAt === 'number' ? reset.startedAt : null;
      const closedAt = typeof reset.finishedAt === 'number' ? reset.finishedAt : null;

      /* Exactly where the retired dock fired it: on the response, before this
         console has finished rendering, so every other reader re-reads. */
      fireRefresh();

      deps.setLastResult({
        target,
        outcome: body.ok === true && issues.length === 0 ? 'ACCEPTED' : 'PARTIAL',
        elapsedMs,
        settledAtMs,
        httpStatus: 200,
        serverCode: null,
        serverTs,
        steps,
        stepsReason: steps === null
          ? 'NO_STEP_TRANSCRIPT · the response carried no reset.steps array'
          : null,
        serverWindowMs: openedAt !== null && closedAt !== null
          ? knownFact(closedAt - openedAt, `${SOURCE} · reset.finishedAt − reset.startedAt`, observedAt)
          : unknownFact(
            'RESET_WINDOW_ABSENT · the response carried no reset.startedAt/finishedAt pair',
            `${SOURCE} · reset`,
          ),
        issues,
        feedsOk: boolFact(body.feedsOk, 'feedsOk', observedAt),
        binanceConnected: boolFact(body.binanceConnected, 'binanceConnected', observedAt),
        walletBalancesOk: boolFact(body.walletBalancesOk, 'walletBalancesOk', observedAt),
        keysPresent: boolFact(body.keysPresent, 'keysPresent', observedAt),
      });
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      const settledAtMs = Date.now();
      const api = error instanceof ApiRequestError ? error : null;
      const detailIssues = stringList(api?.details);
      const message = api !== null
        ? `${api.message} (${api.code})`
        : error instanceof Error && error.message
          ? error.message
          : 'The refresh request did not complete and the failure carried no message';
      /* 408 is this client's own timeout code (lib/http.ts): nothing was
         refused, we simply stopped listening — which is a different fact. */
      const refused = api !== null && api.status >= 400 && api.status !== 408;

      deps.setLastResult({
        target,
        outcome: refused ? 'REFUSED' : 'FAILED',
        elapsedMs,
        settledAtMs,
        httpStatus: api?.status ?? null,
        serverCode: api?.code ?? null,
        serverTs: unknownFact(
          refused
            ? 'REFUSAL_BODY_HAD_NO_TS · the server declined and this projection read no ts from the refusal'
            : 'NO_RESPONSE · nothing readable was received from the server',
          `${SOURCE} · ts`,
        ),
        steps: null,
        stepsReason: refused
          ? `NO_STEP_RAN · the server refused with ${api?.code ?? `HTTP ${api?.status ?? '???'}`} before executing any recovery step`
          : 'NO_STEP_TRANSCRIPT · the request never reached a readable response, so no step is known to have run',
        serverWindowMs: unknownFact('NO_RESET_WINDOW · the server reported no execution window', `${SOURCE} · reset`),
        issues: detailIssues.length > 0 ? detailIssues : [message],
        ...unreadableReadback(
          refused
            ? 'NOT_REPORTED_ON_REFUSAL · a refused refresh returns no connectivity readback'
            : 'NO_RESPONSE · nothing readable was received from the server',
        ),
      });
    } finally {
      busyTarget = null;
      deps.setBusyTarget(null);
    }
  };

  return { run, busy: () => busyTarget !== null };
}

/* =============================================================================
   4 · THE PREFERENCE WRITES — parity §7b, including the lockstep prefs.ts needs.
   Exported so the shell's `onSetCadence` / `onResetDefaults` are one-liners and
   the lockstep rule lives beside the ledger row that renders its readback.
   ========================================================================== */

type CadenceRecord = Record<string, number>;
type UpdatePref = (key: 'dataCadence' | 'refreshSec', value: CadenceRecord | number) => void;

/* DELETED: `applyCadencePreference()` and `restoreCadenceDefaults()`. Both were
   exported, neither had an importer, and both were duplicated VERBATIM inside
   `useWatchdogEvidence` (`setCadence` / `resetCadenceDefaults`) — which is the
   code that actually runs. The lockstep rule they existed to document (writing
   `dataCadence.market` without `refreshSec` produces a value that silently
   reverts on the next load, because prefs.ts re-derives one from the other)
   lives with the writer, in the hook, beside the `recordAttempt` that receipts
   it. Two copies of a rule is two places for it to drift. */


/* =============================================================================
   5 · FORMATTERS — one duration scale, one age law, zero unit switching.
   ========================================================================== */

/** Parity §7b `fmtCadence`, which is also §3.3 law 4: below resolution reads `<1s`. */
export function fmtCadence(seconds: number): string {
  return seconds < 1 ? '<1s' : `${seconds.toFixed(0)}s`;
}

/**
 * §3.18 age law: ONE unit, INTEGER, max three digits. Never `1h 04m` — mixed
 * units put the unit glyph at three x positions and the column stops being a
 * column. A negative age is NOT clamped to zero: a server clock ahead of this
 * browser is a real fact, and it gets said rather than hidden.
 */
/* COLLAPSED AT INTEGRATION (Law 5): the LADDER is MachineValue's, one
   implementation for the whole page. This wrapper keeps only the part that is
   this console's own contract — a non-finite or negative elapsed time is NOT an
   age of zero, it is an unreadable clock, and it returns null so the caller
   renders its reason instead of a flattering `0s`. */
export function ageParts(elapsedMs: number): Readonly<{ value: number; unit: string }> | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  return ageLadder(elapsedMs);
}

/** Composes `Numeric`'s reserved age track; never re-implements its grid. */
function AgeValue({
  elapsedMs,
  source,
  observedAtMs,
  absentReason,
}: {
  readonly elapsedMs: number | null;
  readonly source: string;
  readonly observedAtMs: number | null;
  readonly absentReason: string;
}): JSX.Element {
  if (elapsedMs === null) {
    return <Numeric fact={unknownFact<number>(absentReason, source)} track="age" />;
  }
  const parts = ageParts(elapsedMs);
  if (parts === null) {
    return (
      <Numeric
        fact={unknownFact<number>(
          'CLOCK_AHEAD_OF_BROWSER · the stamp on this evidence is later than this browser’s clock, so no age is computable',
          source,
        )}
        track="age"
      />
    );
  }
  return <Numeric fact={knownFact(parts.value, source, observedAtMs)} unit={parts.unit} track="age" />;
}

const OUTCOME_RUNG = {
  ACCEPTED: 'READY',
  PARTIAL: 'DEGRADED',
  REFUSED: 'BLOCKED',
  FAILED: 'UNAVAILABLE',
  BLOCKED_BY_POSTURE: 'BLOCKED',
  BLOCKED_BY_INFLIGHT: 'BLOCKED',
} as const satisfies Record<RefreshOutcome, Rung>;

const OUTCOME_WORD = {
  ACCEPTED: 'Accepted',
  PARTIAL: 'Answered with issues',
  REFUSED: 'Refused by the server',
  FAILED: 'Did not complete',
  BLOCKED_BY_POSTURE: 'Not issued',
  BLOCKED_BY_INFLIGHT: 'Not issued',
} as const satisfies Record<RefreshOutcome, string>;

/** The consequence, never a platitude (§5 L3). READY is the only exempt rung. */
function outcomeReason(result: RefreshRunResult): string | undefined {
  switch (result.outcome) {
    case 'ACCEPTED':
      return undefined;
    case 'PARTIAL':
      return `The server answered HTTP 200 and still reported ${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}. A completed refresh is not proof that the source recovered.`;
    case 'REFUSED':
      return `The server declined with ${result.serverCode ?? `HTTP ${result.httpStatus ?? '???'}`} and changed nothing. Nothing was retried on your behalf.`;
    case 'FAILED':
      return 'The request never reached a readable response, so it is unknown whether the server did any work. Re-running may repeat work that already happened.';
    case 'BLOCKED_BY_POSTURE':
      return 'The canonical posture refused this target in the browser. No request was issued and nothing changed.';
    case 'BLOCKED_BY_INFLIGHT':
      return 'A refresh was already in flight when this was pressed, so the page\u2019s single guard refused it. No request was issued and nothing changed; the run already running is unaffected.';
  }
}

/** The compact form for the console topline, where the sentence has no room. */
function outcomeBrief(result: RefreshRunResult): string | undefined {
  switch (result.outcome) {
    case 'ACCEPTED':
      return undefined;
    case 'PARTIAL':
      return `${result.issues.length} issue${result.issues.length === 1 ? '' : 's'} reported.`;
    case 'REFUSED':
      return `${result.serverCode ?? `HTTP ${result.httpStatus ?? '???'}`} — nothing changed.`;
    case 'FAILED':
      return 'No readable response.';
    case 'BLOCKED_BY_POSTURE':
      return 'No request was issued.';
    case 'BLOCKED_BY_INFLIGHT':
      return 'Already running — no request was issued.';
  }
}

function attemptDetail(result: RefreshRunResult): string {
  const stepPart = result.steps === null
    ? 'no step transcript'
    : `${result.steps.filter((s) => s.ok.value === true).length}/${result.steps.length} steps ok`;
  return `${result.target} · ${OUTCOME_WORD[result.outcome].toLowerCase()} · ${stepPart} · ${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}`;
}

/**
 * The parity detail string with its leading posture code removed, because the
 * gate chip beside it prints that code already. The clause that survives is the
 * one the code cannot say — why THIS target in particular is out of reach.
 */
function targetDetail(entry: RecoveryTargetEntry): string {
  const posture = canonicalRefreshTargetPosture(entry.target);
  const prefix = `${posture.statusLabel} · `;
  return entry.detail.startsWith(prefix)
    ? entry.detail.slice(prefix.length)
    : entry.detail;
}

function Glyph({ children }: { readonly children: ReactNode }): JSX.Element {
  return <span className="rcx-glyph" aria-hidden="true">{children}</span>;
}

/* =============================================================================
   6 · THE READBACK FIELDS
   §3.5 FieldPair with §3.4's honest-height mechanism doing the severity work: a
   field that answers NO, or cannot answer at all, is PHYSICALLY TALLER because
   it is carrying its consequence. Zero hue, survives a monochrome screenshot,
   and no health verdict is derived from a boolean the server owns.
   ========================================================================== */

function BooleanField({
  label,
  fact,
  consequence,
}: {
  readonly label: string;
  readonly fact: Fact<boolean>;
  readonly consequence: string;
}): JSX.Element {
  const known = fact.known && fact.value !== null;
  const yes = fact.value === true;
  return (
    <div className="wd-field rcx-field" data-answer={known ? (yes ? 'yes' : 'no') : 'unknown'}>
      <dt className="wd-field-label wd-t3">{label}</dt>
      <dd className="wd-field-body">
        <span className="wd-field-value wd-t4">{known ? (yes ? 'YES' : 'NO') : 'UNKNOWN'}</span>
        {!known && <span className="wd-field-note wd-t5 wd-nodata">{fact.reason}</span>}
        {known && !yes && <span className="wd-field-note wd-t5">{consequence}</span>}
        <span className="sr-only">{` Source: ${fact.source}.`}</span>
      </dd>
    </div>
  );
}

/* =============================================================================
   7 · THE RECEIPT — §18: reset.steps[], feedsOk, binanceConnected,
   walletBalancesOk and keysPresent, promoted from discarded to rendered.
   ========================================================================== */

function StepTranscript({ result }: { readonly result: RefreshRunResult }): JSX.Element {
  if (result.steps === null) {
    return <p className="rcx-note wd-t5 wd-nodata">{result.stepsReason}</p>;
  }
  if (result.steps.length === 0) {
    /* A measured empty set is a complete answer (§3.12 `.st-none`) — and it is
       still said out loud, because "the server ran nothing" is a real verdict
       about a request that returned 200. */
    return (
      <p className="rcx-note wd-t5 wd-nodata">
        NO_STEP_EXECUTED · the server returned a reset transcript containing zero steps for this target.
      </p>
    );
  }
  return (
    <table className="wd-table rcx-steps">
      <caption className="sr-only">
        {`Step transcript for the ${result.target} refresh, as returned in reset.steps.`}
      </caption>
      <colgroup>
        <col className="rcx-col-step" />
        <col className="rcx-col-state" />
        <col className="rcx-col-dur" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="wd-t3">Step</th>
          <th scope="col" className="wd-t3">Outcome</th>
          <th scope="col" className="wd-t3 wd-col-num">Duration</th>
        </tr>
      </thead>
      <tbody>
        {result.steps.map((step, index) => {
          const known = step.ok.known && step.ok.value !== null;
          const ok = step.ok.value === true;
          const rowId = `${step.key}-${index}`;
          return (
            /* The detail is its OWN row, never a fourth column: a three-track
               colgroup with `table-layout: fixed` is what keeps the duration
               column on the page's shared right edge (§4.3), and a row that
               cannot prove itself is taller because it is carrying its reason
               (§3.4). Two <tr>s, one logical row, one hairline underneath. */
            <Fragment key={rowId}>
              <tr className="wd-row rcx-step" data-ok={known ? String(ok) : 'unknown'}>
                <th scope="row" className="rcx-step-key">
                  <Identifier kind="ref" value={step.key} label="Recovery step key" />
                </th>
                <td className="rcx-step-state">
                  <StatusChip
                    state={known ? (ok ? 'READY' : 'BLOCKED') : 'UNKNOWN'}
                    label={known ? (ok ? 'Ran' : 'Failed') : undefined}
                    reason={known
                      ? (ok ? undefined : 'This step did not complete. The server’s own message for it is on the line below.')
                      : (step.ok.reason ?? FIELD_ABSENT)}
                  />
                </td>
                <td className="rcx-step-dur wd-col-num">
                  <Numeric fact={step.durationMs} unit="ms" track="num" />
                </td>
              </tr>
              <tr className="wd-row rcx-step-detail" data-ok={known ? String(ok) : 'unknown'}>
                <td className="rcx-step-why wd-t5" colSpan={3}>
                  {step.detail.known && step.detail.value !== null
                    ? step.detail.value
                    : <span className="wd-nodata">{step.detail.reason}</span>}
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function RunReceipt({
  result,
  nowMs,
}: {
  readonly result: RefreshRunResult;
  readonly nowMs: number;
}): JSX.Element {
  const entry = RECOVERY_TARGETS.find((t) => t.target === result.target);
  const transportMs = result.serverWindowMs.known && result.serverWindowMs.value !== null
    ? Math.max(0, result.elapsedMs - result.serverWindowMs.value)
    : null;
  const skewMs = result.serverTs.known && result.serverTs.value !== null
    ? result.settledAtMs - result.serverTs.value
    : null;

  return (
    <div className="rcx-receipt">
      <div className="rcx-receipt-head">
        <StatusChip
          state={OUTCOME_RUNG[result.outcome]}
          label={OUTCOME_WORD[result.outcome]}
          reason={outcomeReason(result)}
          size="band"
        />
        <span className="rcx-receipt-age">
          <AgeValue
            elapsedMs={nowMs - result.settledAtMs}
            source={`${SOURCE} · settled in this browser`}
            observedAtMs={result.settledAtMs}
            absentReason="NOT_SETTLED"
          />
        </span>
      </div>

      <dl className="wd-fields rcx-wire">
        <div className="wd-field">
          <dt className="wd-field-label wd-t3">Request</dt>
          <dd className="wd-field-body">
            <span className="wd-field-value wd-t4">
              <Identifier kind="path" value={`${SOURCE} · target=${result.target}`} label="Recovery request" />
            </span>
            {entry !== undefined && <span className="wd-field-note wd-t5">{entry.label}</span>}
          </dd>
        </div>

        <div className="wd-field">
          <dt className="wd-field-label wd-t3">HTTP status</dt>
          <dd className="wd-field-body">
            {result.httpStatus === null
              ? (
                <>
                  <span className="wd-field-value wd-t4">NONE</span>
                  <span className="wd-field-note wd-t5 wd-nodata">
                    No request left this browser, so there is no status to report.
                  </span>
                </>
              )
              : (
                <>
                  <span className="wd-field-value wd-t4 wd-num">{result.httpStatus}</span>
                  {result.serverCode !== null && (
                    <span className="wd-field-note wd-t5">
                      <Identifier kind="ref" value={result.serverCode} label="Server refusal code" />
                    </span>
                  )}
                </>
              )}
          </dd>
        </div>

        <div className="wd-field">
          <dt className="wd-field-label wd-t3">Browser-timed</dt>
          <dd className="wd-field-body">
            <span className="wd-field-value">
              <Numeric
                fact={knownFact(result.elapsedMs, 'performance.now() · issue to settle', result.settledAtMs)}
                unit="ms"
                track="num"
              />
            </span>
            <span className="wd-field-note wd-t5">
              Measured in this browser, from the moment the request was issued to the moment it settled.
            </span>
          </dd>
        </div>

        <div className="wd-field">
          <dt className="wd-field-label wd-t3">Server window</dt>
          <dd className="wd-field-body">
            <span className="wd-field-value">
              <Numeric fact={result.serverWindowMs} unit="ms" track="num" />
            </span>
            <span className="wd-field-note wd-t5">
              {transportMs === null
                ? 'reset.finishedAt − reset.startedAt, as the server measured its own execution.'
                : `reset.finishedAt − reset.startedAt. The ${transportMs} ms difference from the browser timing is transport and queueing, not work.`}
            </span>
          </dd>
        </div>

        <div className="wd-field">
          <dt className="wd-field-label wd-t3">Clock skew</dt>
          <dd className="wd-field-body">
            {/* The raw epoch is not the fact worth a numeric column — the OFFSET
                is. When the server stamp is unknown, the offset inherits that
                exact reason rather than inventing one of its own. */}
            <span className="wd-field-value">
              <Numeric
                fact={skewMs === null
                  ? unknownFact<number>(result.serverTs.reason ?? FIELD_ABSENT, `${SOURCE} · ts`)
                  : knownFact(skewMs, `${SOURCE} · settledAt − ts`, result.settledAtMs)}
                unit="ms"
                track="num"
              />
            </span>
            <span className="wd-field-note wd-t5">
              {skewMs === null
                ? 'No server stamp was read, so no offset between the two clocks can be stated.'
                : `The route stamped ts=${result.serverTs.value}; this browser recorded the response ${Math.abs(skewMs)} ms ${skewMs >= 0 ? 'later' : 'earlier'}. This mixes clock offset with the response’s remaining transport time, so treat it as an upper bound on either.`}
            </span>
          </dd>
        </div>
      </dl>

      <h4 className="wd-t3 rcx-sub">Step transcript</h4>
      <StepTranscript result={result} />

      <h4 className="wd-t3 rcx-sub">
        <span>Issues</span>
        <span className="rcx-sub-n wd-num">{result.issues.length}</span>
      </h4>
      {result.issues.length === 0
        ? (
          <p className="rcx-note wd-t5">
            The server returned an empty issue list. That is a complete answer about this request — it is
            not a statement about the connections the request touched.
          </p>
        )
        : (
          /* ALL of them. The retired dock rendered issues[0] and buried the rest
             in a title attribute, which is exactly the tooltip the doctrine
             forbids: a reason an operator cannot screenshot is not a reason. */
          <ol className="rcx-issues">
            {result.issues.map((issue, index) => (
              <li className="rcx-issue" key={`${index}-${issue}`}>
                <span className="rcx-issue-n wd-num" aria-hidden="true">{index + 1}</span>
                <span className="rcx-issue-say wd-t5">{issue}</span>
              </li>
            ))}
          </ol>
        )}

      <h4 className="wd-t3 rcx-sub">Connectivity readback</h4>
      <p className="rcx-note wd-t6">
        Returned alongside the refresh and describing the server as it was when it answered. It is not a
        verdict on the target you refreshed.
      </p>
      <dl className="wd-fields rcx-flags">
        <BooleanField
          label="Market feed sockets"
          fact={result.feedsOk}
          consequence="At least one configured market feed socket was not open when the server answered."
        />
        <BooleanField
          label="Binance account transport"
          fact={result.binanceConnected}
          consequence="The private Binance account transport was not connected when the server answered."
        />
        <BooleanField
          label="Wallet balances step"
          fact={result.walletBalancesOk}
          consequence="The account-data step of this refresh did not complete."
        />
        <BooleanField
          label="API keys mounted"
          fact={result.keysPresent}
          consequence="No Binance API keys are mounted on this server, so every private read is unavailable by construction."
        />
      </dl>
    </div>
  );
}

/**
 * §3.13 EmptyState. The subject is not the missing data but what this console
 * promised, over which window, on whose authority, and what is at stake while it
 * has not run. Left-aligned obligation rows in the mandatory order — never a
 * centred shrug, never an illustration.
 */
function EmptyReceipt({
  posture,
  openedAtMs,
  nowMs,
}: {
  readonly posture: CanonicalRefreshTargetPosture;
  readonly openedAtMs: number;
  readonly nowMs: number;
}): JSX.Element {
  const rows: readonly Readonly<{ id: string; label: string; value: ReactNode; note?: string }>[] = [
    {
      id: 'exposure',
      label: 'Exposure',
      value: 'NONE',
      /* Proven zero → hueless (§3.13). The only hue an empty panel may carry is
         reserved for an ACTIVE exposure, and there is none: this console has
         mutated nothing. */
      note: 'Proven zero. This console has issued no mutation in this browser session.',
    },
    {
      id: 'window',
      label: 'Window',
      value: 'THIS BROWSER SESSION',
      note: 'Nothing here is persisted. A reload starts an empty transcript, and a run from another tab is invisible to this one.',
    },
    {
      id: 'last-proof',
      label: 'Last proof',
      value: <span className="wd-nodata">NONE</span>,
      note: 'No refresh has been issued from this page.',
    },
    { id: 'source', label: 'Source', value: <Identifier kind="path" value={SOURCE} label="Recovery source" /> },
    {
      id: 'unmeasured-for',
      label: 'Unmeasured for',
      value: (
        <AgeValue
          elapsedMs={nowMs - openedAtMs}
          source="page clock · since this console mounted"
          observedAtMs={openedAtMs}
          absentReason="NOT_MOUNTED"
        />
      ),
      note: 'Since this console mounted, on the page clock.',
    },
    {
      id: 'next',
      label: 'Next',
      value: 'OPERATOR ACTION ONLY',
      note: 'This console never runs itself. Nothing below will populate on a timer, so an empty receipt is never a stale one.',
    },
    { id: 'reason', label: 'Reason', value: <Identifier kind="ref" value="NO_RUN_ISSUED_THIS_SESSION" label="Empty reason code" /> },
    posture.actionAllowed
      ? {
        id: 'action',
        label: 'Action',
        value: 'RUN PUBLIC REFRESH',
        note: 'Use the control above. A second copy here would be a second way to make the same mutation twice.',
      }
      : {
        id: 'action',
        label: 'Action',
        value: 'NONE — REQUIRES CANONICAL CONTROL PREVIEW',
        note: posture.reason,
      },
  ];

  return (
    <div className="wd-empty rcx-empty" data-flush="true">
      <dl className="wd-fields rcx-empty-rows">
        {rows.map((row) => (
          <div className="wd-field" key={row.id} data-obligation={row.id}>
            <dt className="wd-field-label wd-t3">{row.label}</dt>
            <dd className="wd-field-body">
              <span className="wd-field-value wd-t4">{row.value}</span>
              {row.note !== undefined && <span className="wd-field-note wd-t5">{row.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="wd-empty-byline">
        <span>{SOURCE}</span>
        <span>{`${RECOVERY_TIMEOUT_MS / 1000}s request budget`}</span>
        <span>canonicalRefreshTargetPosture</span>
      </p>
    </div>
  );
}

/* =============================================================================
   8 · THE CADENCE LEDGER — §3.8

   Two headed columns, not one number with a caption:

     SOURCE                  CADENCE     DEFAULT
     Market Publication        3s ▾          5s
       └ reason lines spanning cols 2..-1

   §3.8's pairing is REQUESTED against a second, independently-sourced column.
   Here the combobox's own trigger IS the store readback, so a separate
   "effective" column would print the same number twice and call the second one
   evidence. DEFAULT is the honest second column: it is independently sourced
   (the shipped constant), it never moves, and side by side the two answer the
   question the rail only hints at — am I reading harder than this app ships,
   and by how much.

   `requestedSeconds` is therefore NOT a column. It is an anomaly: it matters
   only when the store did not keep it, and it appears as a stated reason line
   on the row it happened to, which is where an anomaly belongs.
   ========================================================================== */

const READBACK_LIMIT =
  'The trigger shows what the preference store reads back — not an interval anyone timed. An interval is a difference between two completions, and nothing on this page observes a poll completing.';

/* DELETED: `RECONCILIATION_NOTE`, `CadenceMeasuredInterval`, the
   `CadenceReconciliation` / `CadenceReconciliationState` / `ReconciliationState`
   types and the optional `reconciliation` prop chain behind them.

   §3.8's measured-interval lane is real design, and its absence here IS the
   honest default — no lane on this page times a poll completing, so nothing can
   produce a `CadenceReconciliation`. But the prop was optional and no call site
   ever passed it, so `CadenceMeasuredInterval` returned null on every render
   and roughly forty lines of copy across four states could never appear. An
   unreachable branch is the same defect as a dead control; the honest form of
   "we cannot measure this" is not shipping the renderer that would show it.
   When a shell can measure a completed poll interval, this comes back with a
   producer attached. */

function CadenceLedgerRow({
  row,
  choices,
  busyTarget,
  onSetCadence,
  onRun,
  menuOpensUp,
}: {
  readonly row: CadenceRow;
  readonly choices: { id: string; label: string }[];
  readonly busyTarget: CanonicalRefreshTarget | null;
  readonly onSetCadence: (key: CadenceKey, seconds: number) => void;
  readonly onRun: (target: CanonicalRefreshTarget) => void;
  readonly menuOpensUp: boolean;
}): JSX.Element {
  const target = CADENCE_TARGET[row.key];
  const posture = canonicalRefreshTargetPosture(target);
  const pending = busyTarget === target;

  return (
    <div className="rcx-cad-row" data-changed={String(!row.atDefault)}>
      <span className="rcx-cad-rail" aria-hidden="true" />

      <span className="rcx-cad-id">
        <b className="wd-t4">{row.label}</b>
        <em className="wd-t5">{CADENCE_DETAIL[row.key]}</em>
      </span>

      <span className="rcx-cad-req">
        {/* No Save button, on §3.7's rule: a control that needs confirmation has
            already lied about being a toggle. The write lands on selection, and
            the trigger re-reading the store is the proof it landed. */}
        <PillSelect
          value={String(row.effectiveSeconds)}
          options={choices}
          onChange={(value) => onSetCadence(row.key, Number(value))}
          ariaLabel={`${row.label} polling cadence, store reads back ${fmtCadence(row.effectiveSeconds)}`}
          className="rcx-cad-select"
          buttonClassName="rcx-cad-trigger"
          menuClassName={`rcx-cad-menu${menuOpensUp ? ' opens-up' : ''}`}
        />
      </span>

      <span className="rcx-cad-def wd-col-num">
        <span className="wd-num wd-t4">{fmtCadence(row.defaultSeconds)}</span>
      </span>

      <span className="rcx-cad-why">
        {/* "Which poll this actually moves." A control whose effect cannot be
            named is decoration, so the effect is named on every row. */}
        <span className="wd-t6">{`Moves ${row.appliesTo}.`}</span>

        {row.reconciled && (
          <span className="wd-t6 rcx-cad-warn">
            {row.requestedSeconds === null
              ? `STORE_DID_NOT_KEEP_REQUEST · the preference store reconciled this row, and this session holds no record of what was asked for.`
              : `STORE_DID_NOT_KEEP_REQUEST · this session asked for ${fmtCadence(row.requestedSeconds)} and the store reads back ${fmtCadence(row.effectiveSeconds)}.`}
          </span>
        )}

        {!row.survivesReload && (
          <span className="wd-t6 rcx-cad-warn">
            {`WILL_NOT_SURVIVE_RELOAD · ${fmtCadence(row.effectiveSeconds)} is outside the canonical choice set, so the next load snaps it to the nearest permitted value. What you are reading now is not what this browser will run tomorrow.`}
          </span>
        )}

        {row.coupledPref !== null && (
          <span className="wd-t6">
            {`Coupled · writing this also writes prefs.${row.coupledPref}, because prefs.ts re-derives that value from this one on load. Writing one without the other reverts on reload.`}
          </span>
        )}


        <span className="rcx-cad-run">
          <button
            type="button"
            className={`wdb wdb--sm${pending ? ' is-pending' : ''}`}
            aria-disabled={!posture.actionAllowed || busyTarget !== null}
            onClick={() => onRun(target)}
          >
            <Glyph><RefreshCw size={12} strokeWidth={1.8} /></Glyph>
            <span className="wdb-label">{`Refresh ${row.label.toLowerCase()}`}</span>
            <span className="wdb-spin" aria-hidden="true" />
          </button>
          {!posture.actionAllowed && (
            /* §5 L22: where no action is legal, say why in a VISIBLE row.
               Pressing it is still live — it materialises the canonical refusal
               in the receipt above, with nothing on the wire. */
            <span className="wd-t6 wd-nodata rcx-cad-refusal">
              {`${posture.statusLabel} · ${posture.reason}`}
            </span>
          )}
        </span>
      </span>
    </div>
  );
}

function CadenceLedger({
  cadence,
  busyTarget,
  restored,
  onSetCadence,
  onRestoreDefaults,
  onRun,
}: {
  readonly cadence: CadenceState;
  readonly busyTarget: CanonicalRefreshTarget | null;
  /** Armed by the press below and self-clearing; never a standing condition. */
  readonly restored: boolean;
  readonly onSetCadence: (key: CadenceKey, seconds: number) => void;
  /** Writes the defaults AND arms `restored`. One press, one receipt. */
  readonly onRestoreDefaults: () => void;
  readonly onRun: (target: CanonicalRefreshTarget) => void;
}): JSX.Element {
  /* The choice set is READ from the evidence module, never imported as a local
     constant: a hard-coded list that drifts from the one prefs.ts snaps to is
     exactly how a select ends up offering a value the store will discard. */
  const choices = useMemo(
    () => cadence.choices.map((seconds) => ({ id: String(seconds), label: fmtCadence(seconds) })),
    [cadence.choices],
  );

  const population = cadence.rows.length;
  const offDefault = cadence.rows.filter((row) => !row.atDefault).length;
  const notKept = cadence.rows.filter((row) => row.reconciled).length;
  const willNotSurvive = cadence.rows.filter((row) => !row.survivesReload).length;

  return (
    <div className="rcx-cadence">
      <div className="rcx-cadence-head">
        <div className="rcx-cadence-id">
          <h3 className="wd-t3" id="rcx-cadence-head">Polling cadence</h3>
          <p className="wd-t5">
            Select timing and refresh each owner inline. Every value here is a local browser preference —
            never a server mutation, and never a claim about what the server is doing.
          </p>
        </div>
        <div className="rcx-cadence-act">
          {/* §3.6 Label Law: the label is what pressing does, in every state.
              The button stays live even when nothing diverges — restoring a
              default is idempotent, and gating it would leave the operator to
              work out for themselves whether pressing would do anything. The
              count beside it answers that instead, from the values on screen. */}
          <button type="button" className="wdb wdb--sm" onClick={onRestoreDefaults}>
            <Glyph><RefreshCw size={12} strokeWidth={1.8} /></Glyph>
            <span className="wdb-label">Restore defaults</span>
          </button>
          <span className="rcx-cadence-state wd-t6" data-diverged={String(offDefault > 0)}>
            {offDefault === 0
              ? `All ${population} at defaults`
              : `${offDefault} of ${population} off default`}
          </span>
          {restored && (
            <span className="rcx-ack wd-t6">
              {`Restored · the ledger now reads ${cadence.rows.map((row) => `${row.label} ${fmtCadence(row.effectiveSeconds)}`).join(', ')}`}
            </span>
          )}
        </div>
      </div>

      {/* §3.14 — an exhaustive partition whose visible integers sum to the
          printed population, plus the two failure counts that a ratio cannot
          say. `not kept` and `won't survive` are separate because a row can be
          either without the other, and one number for two problems is how a
          coverage counter starts to flatter. */}
      <p className="rcx-cad-coverage wd-t6">
        <span>{`${population} sources`}</span>
        <span>{`${population - offDefault} at default`}</span>
        <span>{`${offDefault} adjusted`}</span>
        <span>{`${notKept} not kept by the store`}</span>
        <span>{`${willNotSurvive} will not survive a reload`}</span>
        <span className="rcx-cad-coverage-src">{cadence.storage}</span>
      </p>

      {population === 0
        ? (
          <p className="rcx-note wd-t5 wd-nodata">
            NO_CADENCE_ROWS · the preference store published no adjustable source, so there is nothing
            here to change. This is not an empty list rendered as a shrug: it means no row exists that
            this console is permitted to write, and adjusting polling pressure is currently impossible
            from this page.
          </p>
        )
        : (
          <div className="rcx-cad-grid" role="group" aria-labelledby="rcx-cadence-head">
            <div className="rcx-cad-colhead">
              <span className="rcx-cad-rail" aria-hidden="true" />
              <span className="wd-t3">Source</span>
              <span className="rcx-cad-reqhead">
                <span className="wd-t3 wd-col-num">Cadence</span>
                <span className="wd-t6 wd-nodata">{READBACK_LIMIT}</span>
              </span>
              <span className="wd-t3 wd-col-num rcx-cad-defhead">Default</span>
            </div>

            {cadence.rows.map((row, index) => (
              <CadenceLedgerRow
                key={row.key}
                row={row}
                choices={choices}
                busyTarget={busyTarget}
                onSetCadence={onSetCadence}
                onRun={onRun}
                menuOpensUp={index > 1}
              />
            ))}
          </div>
        )}
    </div>
  );
}

/* =============================================================================
   9 · THE COMPONENT
   ========================================================================== */

export interface RecoveryConsoleProps {
  readonly target: CanonicalRefreshTarget;
  readonly onTargetChange: (t: CanonicalRefreshTarget) => void;
  readonly busyTarget: CanonicalRefreshTarget | null;
  readonly lastResult: RefreshRunResult | null;
  readonly onRun: (target: CanonicalRefreshTarget) => Promise<void>;
  readonly cadence: CadenceState;
  readonly onSetCadence: (key: CadenceKey, seconds: number) => void;
  readonly onResetDefaults: () => void;
  readonly nowMs: number;
  readonly onRefreshEvidence: () => Promise<void>;
  readonly onRecordAttempt: (a: Omit<Attempt, 'id'>) => void;
}

export function RecoveryConsole(props: RecoveryConsoleProps): JSX.Element {
  const {
    target, onTargetChange, busyTarget, lastResult,
    onRun, cadence, onSetCadence, onResetDefaults, nowMs,
    onRefreshEvidence, onRecordAttempt,
  } = props;

  const entry = RECOVERY_TARGETS.find((t) => t.target === target) ?? RECOVERY_TARGETS[0];
  const posture = canonicalRefreshTargetPosture(entry.target);
  const busy = busyTarget !== null;
  const pending = busyTarget === entry.target;

  /* The one mount timestamp this file holds. It is taken from the page clock and
     not from Date.now(), so it can never disagree with a rendered age. */
  const openedAtRef = useRef<number>(nowMs);

  /* The running-status sentence's id. It is real DOM text bound to the Run
     button by `aria-describedby`, not a second live region (§4.7 / D30). */
  const sayId = useId();

  const run = useCallback((next: CanonicalRefreshTarget) => { void onRun(next); }, [onRun]);

  /* The restore acknowledgement. It exists ONLY between a press and its dwell
     expiring; there is no standing condition that can raise it, so nothing on
     this page can claim a write that no one performed. */
  const [restoredAtMs, setRestoredAtMs] = useState<number | null>(null);
  const restored = restoredAtMs !== null;
  useEffect(() => {
    if (restoredAtMs === null) return;
    const timer = window.setTimeout(() => setRestoredAtMs(null), RECOVERY_RESTORED_MS);
    return () => window.clearTimeout(timer);
  }, [restoredAtMs]);
  const onRestorePress = useCallback(() => {
    onResetDefaults();
    setRestoredAtMs(Date.now());
  }, [onResetDefaults]);

  /* DELETED: the `requestedTarget` adoption effect and its two props. It
     existed so a neighbour could raise a refresh and have this console run it
     under the same guard — but its only producer was the owner-row refresh
     button, whose branch was unreachable, so the mechanism had zero producers
     for its whole life. This console is now the page's only producer of a
     refresh, which is what the section head already claimed in words. */

  /* The attempt ring is written from the RESULT, never from the press: an
     Attempt may not exist before a response or a caught error does. A posture
     refusal issued no request, so it records nothing. Order is fixed —
     attempt, then both observers re-read from re-read evidence. */
  const recordedRef = useRef<RefreshRunResult | null>(null);
  useEffect(() => {
    if (lastResult === null || lastResult === recordedRef.current) return;
    recordedRef.current = lastResult;
    // Neither refusal put a byte on the wire, so neither may record an attempt.
    if (lastResult.outcome === 'BLOCKED_BY_POSTURE') return;
    if (lastResult.outcome === 'BLOCKED_BY_INFLIGHT') return;
    onRecordAttempt({
      atMs: lastResult.settledAtMs,
      kind: 'refresh',
      method: 'POST',
      path: REFRESH_PATH,
      /* A status is never invented. When no response exists the server's own
         refusal code stands in, and when there is not even that, the transcript
         says NO_RESPONSE rather than borrowing a number. */
      status: lastResult.httpStatus === null
        ? (lastResult.serverCode ?? 'NO_RESPONSE')
        : String(lastResult.httpStatus),
      elapsedMs: lastResult.elapsedMs,
      detail: attemptDetail(lastResult),
    });
    void onRefreshEvidence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastResult]);

  /* Parity §13 — the boundary is legible INSIDE the menu, before the choice is
     made, not after it is refused. */
  const options = useMemo(
    () => RECOVERY_TARGETS.map((t) => {
      const p = canonicalRefreshTargetPosture(t.target);
      return { id: t.target, label: p.actionAllowed ? t.label : `${t.label} · Preview Required` };
    }),
    [],
  );

  const permitted = useMemo(
    () => RECOVERY_TARGETS.filter((t) => canonicalRefreshTargetPosture(t.target).actionAllowed),
    [],
  );
  const refusedTargets = useMemo(
    () => RECOVERY_TARGETS.filter((t) => !canonicalRefreshTargetPosture(t.target).actionAllowed),
    [],
  );

  const lastEntry = lastResult === null
    ? null
    : RECOVERY_TARGETS.find((t) => t.target === lastResult.target) ?? null;

  /* ONE sentence, ONE channel, at most one utterance per operator action, and
     silent when nothing of consequence has happened. It is a DIGEST, never a
     restatement: the topline carries the verdict, the receipt carries the
     fields, and this carries the one line neither of them can — which target,
     how many steps ran, and how many issues came back, together. */
  const say = pending
    ? `Refreshing ${entry.label}. ${SOURCE} issued with a ${RECOVERY_TIMEOUT_MS / 1000} second budget.`
    : restored
      /* Read back off the ledger's own rows, not off the constant the writer
         used: an acknowledgement sourced from the value it just wrote would
         announce success even if the store threw the write away. `restored` is
         armed by the press alone, so this can only outrank `lastResult` for the
         dwell that follows an actual click. */
      ? `Restored defaults. The ledger now reads ${cadence.rows.map((row) => `${row.label} ${fmtCadence(row.effectiveSeconds)}`).join(', ')}.`
      : lastResult !== null
        ? `${lastEntry?.label ?? lastResult.target} · ${attemptDetail(lastResult).split(' · ').slice(1).join(' · ')}.`
        : '';

  return (
    <div className="rcx" aria-label="Recovery console">
      {/* The console's own receipt: state, source, age — the three fixed tracks
          of §3.18, terminating on the page's one shared right edge. */}
      <div className="rcx-topline" data-source={lastResult !== null && lastResult.httpStatus !== null ? SOURCE : undefined}>
        <StatusChip
          state={lastResult === null ? 'UNKNOWN' : OUTCOME_RUNG[lastResult.outcome]}
          label={lastResult === null ? 'Never run' : OUTCOME_WORD[lastResult.outcome]}
          reason={lastResult === null
            ? 'No refresh has been issued from this page in this browser session.'
            : outcomeBrief(lastResult)}
        />
        <span className="rcx-topline-src">
          {lastResult !== null && lastResult.httpStatus !== null
            ? <Identifier kind="path" value={SOURCE} label="Recovery source" />
            : <span className="wd-t6 wd-nodata">no request issued</span>}
        </span>
        <span className="rcx-topline-age wd-col-num">
          <AgeValue
            elapsedMs={lastResult === null ? null : nowMs - lastResult.settledAtMs}
            source={`${SOURCE} · settled in this browser`}
            observedAtMs={lastResult?.settledAtMs ?? null}
            absentReason="NEVER_RUN · this console has issued no request in this browser session"
          />
        </span>
      </div>

      {/* NOT a live region. §4.7 / D30 pin ONE `role="status"` per page and it
          is VerdictHeader's; the one licensed exception is a transient
          per-cluster `role="alert"` on a user-initiated destructive arm, which
          this persistent running sentence is not. It stays exactly where it
          was and says exactly what it said — as real DOM text beside the
          control that produced it, bound to that control by
          `aria-describedby`, which is what the doctrine asks for. */}
      <p className="rcx-say wd-t5" id={sayId}>{say}</p>

      {/* NO `.wdf-region` here. §4.2 item 5 licenses exactly ONE bounded surface
          per page, and WatchdogSurface has already spent it on the whole CONTROL
          cluster — this console is inside it. A second one nested in the first
          would be the card grid the owner rejected, one level down. */}
      <div className="rcx-act" aria-busy={pending || undefined}>
        <div className="rcx-act-head">
          <Glyph><RefreshCw size={16} strokeWidth={1.7} /></Glyph>
          <div className="rcx-act-id">
            <b className="wd-t4">{entry.label}</b>
            {/* The parity detail strings lead with the posture code, and the chip
                below already carries it. Printing a code twice within one glance
                teaches an operator to skim both. The target-specific clause —
                the half that only this target can say — is kept in full. */}
            <em className="wd-t5">{targetDetail(entry)}</em>
          </div>
          <div className="rcx-act-controls">
            <PillSelect
              value={entry.target}
              options={options}
              onChange={(value) => onTargetChange(value)}
              ariaLabel={`Recovery target, currently ${entry.label}`}
              className="rcx-select"
              buttonClassName="rcx-trigger"
              menuClassName="rcx-menu"
            />
            <button
              type="button"
              className={`wdb${pending ? ' is-pending' : ''}`}
              aria-disabled={!posture.actionAllowed || busy}
              aria-describedby={`rcx-posture ${sayId}`}
              onClick={() => run(entry.target)}
            >
              <Glyph><RefreshCw size={13} strokeWidth={1.8} /></Glyph>
              <span className="wdb-label">{posture.actionLabel}</span>
              <span className="wdb-spin" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* The selected target's gate, and the ONLY place `posture.reason` is
            printed. The guide below enumerates the two classes; it deliberately
            does not restate this sentence, because a reason printed twice
            thirty pixels apart is decoration, not evidence. */}
        <p className="rcx-posture" id="rcx-posture">
          <StatusChip
            state={posture.actionAllowed ? 'READY' : 'BLOCKED'}
            label={posture.statusLabel}
            reason={posture.actionAllowed ? undefined : posture.reason}
          />
          {posture.actionAllowed && <span className="wd-t5">{posture.reason}</span>}
        </p>

        {/* §3.11 InfoRow — the boundary, taught inside the surface that offers
            the action, and taught in FULL regardless of what is selected: an
            operator who can only see the gate they are standing at cannot tell
            whether they picked the wrong door. Exactly two rows; the cap is
            three. Two REGISTERS distinguished by grammatical mood and ink, with
            zero hue: binding is imperative, advisory is declarative. */}
        <ul className="gdx-list rcx-guide">
          <li className="gdx-row" data-register="binding">
            <span className="gdx-glyph" aria-hidden="true"><RefreshCw size={12} strokeWidth={1.8} /></span>
            <span className="gdx-body">
              <span className="gdx-say wd-t5">
                {`Refresh only the source you named. ${permitted.map((t) => t.label).join(', ')} are the ${permitted.length} targets this route will act on.`}
              </span>
              <span className="gdx-why wd-t6">
                {`${permitted.length} of ${RECOVERY_TARGETS.length} targets · bounded, public, and safe to repeat.`}
              </span>
            </span>
            <span className="gdx-prov wd-t6">posture.ts</span>
          </li>
          <li className="gdx-row" data-register="advisory">
            <span className="gdx-glyph" aria-hidden="true"><RefreshCw size={12} strokeWidth={1.8} /></span>
            <span className="gdx-body">
              <span className="gdx-say wd-t5">
                {`${refusedTargets.map((t) => t.label).join(', ')} are answered with HTTP 409 and change nothing. Managed runtimes are recovered through the control ledger's preview-and-receipt contract, not from here.`}
              </span>
              <span className="gdx-why wd-t6">
                {`${refusedTargets.length} of ${RECOVERY_TARGETS.length} targets · refused in this browser before any request is issued.`}
              </span>
            </span>
            <span className="gdx-prov wd-t6">HTTP 409</span>
          </li>
        </ul>
      </div>

      <h3 className="wd-t3 rcx-sub rcx-sub--lead">Last run receipt</h3>
      {lastResult === null
        ? <EmptyReceipt posture={posture} openedAtMs={openedAtRef.current} nowMs={nowMs} />
        : <RunReceipt result={lastResult} nowMs={nowMs} />}

      <CadenceLedger
        cadence={cadence}
        busyTarget={busyTarget}
        restored={restored}
        onSetCadence={onSetCadence}
        onRestoreDefaults={onRestorePress}
        onRun={run}
      />
    </div>
  );
}
