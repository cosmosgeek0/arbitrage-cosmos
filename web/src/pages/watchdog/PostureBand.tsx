import { useId } from 'react';
import type { ReactNode } from 'react';
import type {
  CanonicalOpsIntakeInterlock,
  CanonicalSupervisorOpsReadback,
  FiveSecondOwnerView,
  ProductReadinessPolicyProjection,
} from '../../lib/productIntegration';
import type { BrowserObservation, Fact, Lane, MaterialContinuity } from './watchdogEvidence';
import type { Rung } from './StatusChip';
import {
  AbsenceSlot,
  StatusChip,
  rungFromLane,
  rungFromWatchmanStatus,
} from './StatusChip';
import { Identifier } from './MachineValue';
import './PostureBand.css';

/* ============================================================================
   PostureBand — CLUSTER 1 · SURFACE · §1

   The deleted Connection Watchman's FIVE header verdicts, re-cut as a four-cell
   MetricCell band (§3.10) plus a full-width interlock region beneath it
   (§3.5 FieldPair · §3.1 StatusChip · §3.12 UnknownState).

   Why the fifth verdict is a region and not a fifth cell: a cell has exactly one
   warrant line, so it could only ever show `reasonCodes[0]`. The modal read the
   whole array and rendered one of it; §18 lists `opsIntakeInterlock.reasonCodes[1..]`
   as headroom read by nothing. EVERY code renders here, each paired with the
   readback field that produced it and that field's CURRENT value.

   The reason-code vocabulary and every code->field pairing below are read from
   the single producer — evaluateCanonicalOpsIntakeGate() in
   server/src/systemIntegration/ops/intakeGate.ts. Nothing here is guessed, and
   the mapping is closed over what that function can emit.

   NO CONTROL IS DRAWN except the two blocker click-throughs. There is no web
   endpoint that clears an interlock: CLEAR_DEPLOYMENT_FREEZE exists on the
   system-integration control surface (contracts/constants.ts:109) but is absent
   from SAFE_LIVE_BACKEND_COMMAND_IDS (lib/productIntegration/model.ts:7) and has
   no canonical preview entry. The absence of a button is the honest rendering of
   the absence of authority, and the ACTION row states the refusal rather than
   leaving it merely absent (§3.13).

   PARITY REFUSAL: the modal hid verdict cells 4 and 5 below three columns. These
   cells WRAP (4 -> 2 -> 1 via container queries) and never hide. Hiding the
   interlock reason is the one place the old modal was wrong.
   ========================================================================== */

type ReadingKind = 'value' | 'reason' | 'absent';
type ReadingTone = 'warn' | 'bad' | undefined;

export interface PostureBandProps {
  readonly ownerView: Fact<FiveSecondOwnerView>;
  readonly browser: Lane<BrowserObservation>;
  readonly browserDetail: string;
  readonly continuity: MaterialContinuity;
  readonly continuityError: string | null;
  readonly interlock: Fact<CanonicalOpsIntakeInterlock>;
  readonly opsReadback: Fact<CanonicalSupervisorOpsReadback>;
  readonly readinessPolicy: Fact<ProductReadinessPolicyProjection>;
  /* Facts, not bare nullables. A bare `string | null` cannot tell "the
     supervisor named no blocker" apart from "the supervisor published no such
     field", and only the first of those is a measured zero. */
  readonly requiredBlocker: Fact<string | null>;
  readonly rootBlocker: Fact<string | null>;
  readonly lastRecoveryAtMs: number | null;
  readonly nowMs: number;
  readonly onFocusOwner: (id: string) => void;
}

/* ---------------------------------------------------------------------------
   Durations.

   LOCAL, and it is the one thing in this file that wants hoisting: Law 5
   mandates ONE duration scale for the page, and no module publishes one yet
   (MachineValue owns the numeric age TRACK, not the words). When it does, this
   block deletes.

   Every age is measured against the hook's 1000ms `nowMs` tick and never
   against a render-time Date.now() or a snapshot's own timestamp — pinned
   regression web/test/productControlRoom/dashboard-age-clock.test.mjs, where
   feeding a cut its own stamp made every age read `0s ago` forever and a wedged
   supervisor became indistinguishable from a live one.
   ------------------------------------------------------------------------- */
function durationLabel(ms: number): string {
  if (!Number.isFinite(ms)) return 'an unmeasured interval';
  const v = Math.abs(ms);
  if (v < 1_000) return `${Math.round(v)}ms`;
  if (v < 10_000) return `${(v / 1_000).toFixed(1)}s`;
  if (v < 60_000) return `${Math.round(v / 1_000)}s`;
  if (v < 3_600_000) return `${Math.floor(v / 60_000)}m`;
  if (v < 86_400_000) return `${Math.floor(v / 3_600_000)}h`;
  return `${Math.floor(v / 86_400_000)}d`;
}

/** A timestamp ahead of this browser is clock skew, and skew is STATED. Clamping
 *  it to `0s ago` would render a skewed clock as a fresh read — the same class
 *  of lie as defaulting an unknown to zero. */
function relAge(atMs: number, nowMs: number): string {
  const delta = nowMs - atMs;
  return delta >= 0
    ? `${durationLabel(delta)} ago`
    : `${durationLabel(delta)} ahead of this browser`;
}

function leaseLabel(untilMs: number, nowMs: number): string {
  const remaining = untilMs - nowMs;
  return remaining > 0
    ? `valid for ${durationLabel(remaining)}`
    : `expired ${durationLabel(remaining)} ago`;
}

function parseUtc(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/* ---------------------------------------------------------------------------
   Server enum -> state word.

   These are transliterations of a verdict the server ALREADY MADE, never a
   health derivation from raw signals (FORBIDDEN #2). StatusChip owns state word
   -> rung and every mapper it already publishes is used rather than restated —
   `rungFromWatchmanStatus` and `rungFromLane` are imported, not reimplemented.
   ------------------------------------------------------------------------- */
function machineReadyRung(v: FiveSecondOwnerView['machineReady']): Rung {
  const table = {
    YES: 'READY', NO: 'BLOCKED', UNKNOWN: 'UNKNOWN',
  } as const satisfies Record<FiveSecondOwnerView['machineReady'], Rung>;
  return table[v];
}

function continuityRung(v: MaterialContinuity): Rung {
  const table = {
    PROVEN: 'READY',
    BACKFILL: 'DEGRADED',
    BLOCKED: 'BLOCKED',
    UNPROVEN: 'UNKNOWN',
  } as const satisfies Record<MaterialContinuity, Rung>;
  return table[v];
}

function recoveryRung(v: CanonicalSupervisorOpsReadback['recoveryState']): Rung {
  const table = {
    NONE: 'READY',
    RECOVERY_REQUIRED: 'BLOCKED',
    UNKNOWN: 'UNKNOWN',
  } as const satisfies Record<CanonicalSupervisorOpsReadback['recoveryState'], Rung>;
  return table[v];
}

/**
 * THE CONTINUITY GATE — the same downgrade the owner rows already take
 * (`watchdogEvidence.watchmanComponentFromSupervisor`), applied to every
 * SUPERVISOR-SOURCED verdict on this band.
 *
 * Without it the band's cells and blocks read straight off whatever cut is
 * retained, so a browser holding a frozen cut whose `machineReady` is YES
 * rendered a green READY with no reason at the very top of the page, while
 * every owner row beneath it said "Continuity Blocked". A verdict computed off
 * a cut whose continuity is not proven is not a verdict about the machine — it
 * is a verdict about a memory.
 *
 * It downgrades READY only. A proven failure does not soften: a BLOCKED read
 * off an unproven cut is still worth showing as BLOCKED, and softening it would
 * be the same defect in the other direction.
 */
function gateOnContinuity(rung: Rung, continuity: MaterialContinuity): Rung {
  return rung === 'READY' && continuity !== 'PROVEN' ? 'UNKNOWN' : rung;
}

/** The reason a gated verdict must carry. READY is the only rung exempt from
 *  REASON_REQUIRED, and a gated verdict is by definition no longer READY. */
function continuityGateReason(continuity: MaterialContinuity): string {
  return `MATERIAL_CONTINUITY_${continuity} · this verdict was read off a cut whose continuity is not proven, so it describes the retained cut and not the machine`;
}

function policyRung(p: ProductReadinessPolicyProjection): Rung {
  /* MISSING is an absence of wiring, not a proven breach. Everything else that
     is not VALID is a proven mismatch and blocks. An accepted-but-not-VALID
     policy is degraded: it is in force, and it is not what was signed. */
  if (p.status === 'MISSING') return 'NOT_CONFIGURED';
  if (p.status === 'VALID') return p.accepted ? 'READY' : 'DEGRADED';
  return p.accepted ? 'DEGRADED' : 'BLOCKED';
}

/** Reading tone REINFORCES the chip's fill ladder; it never carries severity on
 *  its own. The ladder still survives a monochrome screenshot (Law 2). */
function toneFor(rung: Rung): ReadingTone {
  if (rung === 'BLOCKED') return 'bad';
  if (rung === 'DEGRADED') return 'warn';
  return undefined;
}

/* ---------------------------------------------------------------------------
   Sub-elements. Nothing here re-implements StatusChip, Identifier or Numeric.
   ------------------------------------------------------------------------- */

interface CellProps {
  readonly id: string;
  readonly name: string;
  readonly reading: ReactNode;
  readonly readingKind: ReadingKind;
  readonly tone: ReadingTone;
  readonly rung: Rung;
  readonly stale?: boolean;
  readonly warrant: ReactNode;
}

function MetricCell(p: CellProps): JSX.Element {
  return (
    <div className="mx-cell" data-cell={p.id}>
      <span className="mx-name wd-t3">{p.name}</span>
      <div className="mx-reading wd-t1" data-reading={p.readingKind} data-tone={p.tone}>
        {p.reading}
      </div>
      <div className="mx-warrant">
        <StatusChip size="band" state={p.rung} stale={p.stale === true} reason={p.warrant} />
      </div>
    </div>
  );
}

interface FieldProps {
  readonly label: ReactNode;
  readonly labelKind?: 'name' | 'code';
  readonly value: ReactNode;
  readonly trailing?: ReactNode;
  readonly note?: ReactNode;
  readonly proof?: 'direct' | 'qualified';
}

/** §3.5 FieldPair. `trailing` lands on this region's single shared right edge,
 *  which is the entire reason the region is one subgrid and not four little
 *  cards: every current field value reads as one column down the page. */
function Field(p: FieldProps): JSX.Element {
  return (
    <div className="wd-field" data-proof={p.proof ?? 'direct'}>
      <dt className="wd-field-label wd-t3" data-kind={p.labelKind ?? 'name'}>{p.label}</dt>
      <dd className="wd-field-body">
        <span className="wd-field-value wd-t4">{p.value}</span>
        {p.trailing === undefined
          ? null
          : <span className="wd-field-trail wd-t4 wd-num">{p.trailing}</span>}
        {p.note === undefined ? null : <span className="wd-field-note wd-t5">{p.note}</span>}
      </dd>
    </div>
  );
}

/** A documentation reference — a field path, a reason code, a command id. NOT a
 *  datum, which is why it is not an Identifier: there is nothing here to copy
 *  into an incident ticket that the label does not already say. */
function Ref({ children }: { children: ReactNode }): JSX.Element {
  return <code className="pbx-ref">{children}</code>;
}

/** The only control this section draws. Focuses and expands that owner's row in
 *  the ledger — a real shell action against real page state, not a route change,
 *  not a rail, and never a no-op. */
function BlockerButton(
  { id, onFocusOwner }: { id: string; onFocusOwner: (id: string) => void },
): JSX.Element {
  return (
    <button
      type="button"
      className="pbx-jump"
      onClick={() => onFocusOwner(id)}
      aria-label={`Focus component ${id} in the owner ledger`}
    >
      <span className="wd-id"><b>{id}</b></span>
    </button>
  );
}

/**
 * A named blocker slot. Three outcomes, and they are three because the field is
 * three:
 *   NAMED     — the server named a component. It is a control; press it.
 *   NONE      — the server sent the key and it was null. That is a MEASURED
 *               zero, and only here may the page say so.
 *   UNREAD    — the envelope was not read, or the key was not published at all.
 *               UNKNOWN with the Fact's own reason; never the word "None".
 * The middle and the last used to be one branch behind an `envelopeRead` guard
 * that any OTHER field being present could satisfy.
 */
function BlockerField({
  label, fact, noneSentence, noneSrLabel, note, onFocusOwner,
}: {
  readonly label: ReactNode;
  readonly fact: Fact<string | null>;
  readonly noneSentence: string;
  readonly noneSrLabel: string;
  readonly note?: ReactNode;
  readonly onFocusOwner: (id: string) => void;
}): JSX.Element {
  if (!fact.known) {
    return (
      <Field
        label={label}
        value="Unread"
        trailing={<StatusChip state="UNKNOWN" reason={fact.reason ?? `REASON_MISSING · ${fact.source}`} />}
        note={note}
      />
    );
  }
  if (fact.value === null) {
    return (
      <Field
        label={label}
        value={noneSentence}
        trailing={<AbsenceSlot kind="none" srLabel={noneSrLabel} />}
        note={note}
      />
    );
  }
  return (
    <Field
      label={label}
      value={<BlockerButton id={fact.value} onFocusOwner={onFocusOwner} />}
      note={note}
    />
  );
}

/* ---------------------------------------------------------------------------
   Reason code -> (readback field, that field's current value, what it means).

   Closed over evaluateCanonicalOpsIntakeGate()'s emissions:
     CANONICAL_OPS_READBACK_INVALID · CANONICAL_OPS_READBACK_NOT_CURRENT ·
     DEPLOYMENT_FROZEN · DEPLOYMENT_FREEZE_STATE_UNKNOWN ·
     EXPOSURE_{ACTIVE|AMBIGUOUS|RECOVERY_REQUIRED|UNKNOWN} ·
     AMBIGUITY_{AMBIGUOUS|UNKNOWN} · RECOVERY_{RECOVERY_REQUIRED|UNKNOWN} ·
     LEDGER_SCHEMA_COMPATIBILITY_UNKNOWN
   An unrecognised code renders AS unrecognised rather than being dropped: a code
   this client cannot explain is still a code that is blocking intake.
   ------------------------------------------------------------------------- */
interface CodeRow {
  readonly field: ReactNode;
  readonly value: ReactNode;
  readonly trailing: ReactNode;
  readonly note: ReactNode;
  readonly proof: 'direct' | 'qualified';
}

function explainCode(
  code: string,
  readback: Fact<CanonicalSupervisorOpsReadback>,
  nowMs: number,
): CodeRow {
  /* Without the readback we can name the field a code came from, but not its
     value. Printing "clean", a zero or an em dash here would be the exact false
     green this page exists to refuse, so the value cell gets a chip instead. */
  const rb = readback.known ? readback.value : null;
  const unread = (
    <StatusChip
      state="UNKNOWN"
      reason={<>{readback.reason ?? 'REASON_MISSING'} · <Ref>{readback.source}</Ref></>}
    />
  );

  /* When the code names a state and the field still reads that state, the row is
     `direct`. When they disagree the interlock was evaluated against a DIFFERENT
     readback than the one this page is holding, and that divergence is the most
     actionable thing on the row — so it demotes the value to `qualified` and
     says so in words (§3.5: a real number whose provenance is not clean). */
  const stateRow = (
    field: string,
    claimed: string,
    actual: string | null,
    consequence: ReactNode,
  ): CodeRow => ({
    field: <Ref>{field}</Ref>,
    value: <>Reads <b>{claimed}</b></>,
    trailing: rb === null ? unread : <>{actual}</>,
    note: actual !== null && actual !== claimed
      ? <>The code names <b>{claimed}</b>, the field now reads <b>{actual}</b> — the interlock was
        evaluated against a different readback than the one on this page.</>
      : consequence,
    proof: actual !== null && actual !== claimed ? 'qualified' : 'direct',
  });

  if (code === 'CANONICAL_OPS_READBACK_INVALID') {
    return {
      field: <Ref>opsReadback</Ref>,
      value: 'The whole object failed structural validation',
      trailing: (
        <StatusChip
          state="BLOCKED"
          reason="The gate rejected the object before it read a single field."
        />
      ),
      note: (
        <>
          The gate returned before evaluating any field, so no other field-level code below could
          have been produced. Every ops field on this page is <b>unevaluated, not clean</b>. Repair
          the readback shape before reading anything else in this region.
        </>
      ),
      proof: 'direct',
    };
  }

  if (code === 'CANONICAL_OPS_READBACK_NOT_CURRENT') {
    const observedAt = parseUtc(rb?.observedAtUtc);
    const validUntil = parseUtc(rb?.validUntilUtc);
    return {
      field: <><Ref>opsReadback.observedAtUtc</Ref> · <Ref>opsReadback.validUntilUtc</Ref></>,
      value: rb === null
        ? 'Both timestamps are unread'
        : (
          <span className="pbx-stamps">
            <Identifier kind="raw" value={rb.observedAtUtc} label="readback observedAtUtc" />
            <Identifier kind="raw" value={rb.validUntilUtc} label="readback validUntilUtc" />
          </span>
        ),
      trailing: observedAt === null ? unread : <>{relAge(observedAt, nowMs)}</>,
      note: (
        <>
          The gate refused this readback as not current and <b>does not say which</b> of its five
          conditions failed: observed in the future, observed too long ago, lease too short, lease
          too long, or already expired.
          {validUntil === null ? null : <> The lease is {leaseLabel(validUntil, nowMs)}.</>}
        </>
      ),
      proof: 'direct',
    };
  }

  if (code === 'DEPLOYMENT_FROZEN') {
    return {
      field: <Ref>opsReadback.deploymentFrozen</Ref>,
      value: <>Deployment is <b>frozen</b></>,
      trailing: rb === null ? unread : <>{String(rb.deploymentFrozen)}</>,
      note: rb !== null && rb.deploymentFrozen !== true
        ? <>The code says frozen, the field now reads <b>{String(rb.deploymentFrozen)}</b> — the
          interlock was evaluated against a different readback than the one on this page.</>
        : <>Intake stays blocked for as long as the freeze holds. No web control lifts it.</>,
      proof: rb !== null && rb.deploymentFrozen !== true ? 'qualified' : 'direct',
    };
  }

  if (code === 'DEPLOYMENT_FREEZE_STATE_UNKNOWN') {
    return {
      field: <Ref>opsReadback.deploymentFrozen</Ref>,
      value: 'The freeze state is not a boolean',
      trailing: rb === null ? unread : <>{String(rb.deploymentFrozen)}</>,
      note: <>The gate cannot prove deployment is unfrozen, so it blocks. This is doubt, not a
        proven freeze — and the gate treats them identically on purpose.</>,
      proof: 'direct',
    };
  }

  if (code.startsWith('EXPOSURE_')) {
    return stateRow(
      'opsReadback.exposureState',
      code.slice('EXPOSURE_'.length),
      rb?.exposureState ?? null,
      <>Capital is not provably flat, so the serial spine refuses new entries.</>,
    );
  }

  if (code.startsWith('AMBIGUITY_')) {
    return stateRow(
      'opsReadback.ambiguityState',
      code.slice('AMBIGUITY_'.length),
      rb?.ambiguityState ?? null,
      <>An unresolved leg cannot be netted, so intake is held until it resolves.</>,
    );
  }

  if (code.startsWith('RECOVERY_')) {
    return stateRow(
      'opsReadback.recoveryState',
      code.slice('RECOVERY_'.length),
      rb?.recoveryState ?? null,
      <>An outstanding recovery outranks new work. This is the same field the Recovery State cell
        above reads, so the two can never disagree.</>,
    );
  }

  if (code === 'LEDGER_SCHEMA_COMPATIBILITY_UNKNOWN') {
    return {
      field: <><Ref>opsReadback.currentSchemaVersion</Ref> · <Ref>opsReadback.rollbackFloor</Ref></>,
      value: 'The schema / rollback-floor pair is unavailable',
      trailing: rb === null
        ? unread
        : <>{rb.currentSchemaVersion ?? 'null'} / {rb.rollbackFloor ?? 'null'}</>,
      note: <>Both must be present for the gate to prove a rollback is survivable. Either one null
        blocks intake.</>,
      proof: 'direct',
    };
  }

  return {
    field: <Ref>unmapped</Ref>,
    value: 'This client has no field mapping for this code',
    trailing: (
      <StatusChip
        state="UNKNOWN"
        reason="The gate emitted a code added after this page was written."
      />
    ),
    note: <>It is blocking intake regardless. Read it from the supervisor, not from here.</>,
    proof: 'direct',
  };
}

/* ==========================================================================
   PostureBand
   ========================================================================== */
export function PostureBand(props: PostureBandProps): JSX.Element {
  const {
    ownerView, browser, browserDetail, continuity, continuityError,
    interlock, opsReadback, readinessPolicy,
    requiredBlocker, rootBlocker, lastRecoveryAtMs, nowMs, onFocusOwner,
  } = props;

  /* ---- shared cause (§3.10 band-level facts) ----------------------------
     `transport-failed` is NEVER derived from four coincident cell failures —
     that is `shared-cause`, a different sentence, and shared-cause is the only
     one this page can prove. It fires only when every supervisor-sourced Fact
     is unread with the SAME reason. Cell 2 is the browser lane and cell 3 is
     the provider binding, so the sentence says "supervisor-sourced" and never
     "all four". */
  const supervisorFacts = [ownerView, opsReadback, interlock, readinessPolicy] as const;
  const firstReason = supervisorFacts[0].reason;
  const sharedCause = firstReason !== null
    && supervisorFacts.every((f) => !f.known && f.reason === firstReason)
    ? firstReason
    : null;

  /* DELETED: `envelopeRead` / `envelopeUnreadReason`. They were the guard that
     decided whether a null blocker id meant "no blocker" or "unread" — but the
     guard was `supervisorFacts.some(f => f.known)`, which ANY other field being
     present satisfies, so an omitted `firstRequiredReadinessBlockerComponentId`
     rendered "None. The supervisor named no required-readiness blocker." plus
     an explicit measured-zero announcement. The blockers now arrive as Facts
     that carry their own three-way answer (see `BlockerField`). */

  /* ---- cell 1 · Machine Ready ------------------------------------------ */
  const view = ownerView.known ? ownerView.value : null;
  const c1: CellProps = view !== null
    ? {
      id: 'machine',
      name: 'Machine Ready',
      /* The server's own word, including its own 'UNKNOWN'. A published UNKNOWN
         is a measured verdict and renders at the value register; only a field
         we could not read is demoted. */
      reading: view.machineReady,
      readingKind: 'value',
      tone: toneFor(gateOnContinuity(machineReadyRung(view.machineReady), continuity)),
      rung: gateOnContinuity(machineReadyRung(view.machineReady), continuity),
      warrant: gateOnContinuity(machineReadyRung(view.machineReady), continuity)
        !== machineReadyRung(view.machineReady)
        ? <>{continuityGateReason(continuity)} · <Ref>ownerView.machineReady</Ref></>
        : view.topRootBlocker !== null
          ? <>Root blocker <b>{view.topRootBlocker}</b> · <Ref>ownerView.topRootBlocker</Ref></>
          : <>Canonical owner verdict · the supervisor named no root blocker</>,
    }
    : {
      id: 'machine',
      name: 'Machine Ready',
      reading: sharedCause !== null
        ? <AbsenceSlot kind="void" srLabel="Unread." />
        : (ownerView.reason ?? 'REASON_MISSING'),
      readingKind: sharedCause !== null ? 'absent' : 'reason',
      tone: undefined,
      rung: 'UNKNOWN',
      warrant: <>{ownerView.reason ?? 'REASON_MISSING'} · <Ref>{ownerView.source}</Ref></>,
    };

  /* ---- cell 2 · Browser Path -------------------------------------------
     The reading is the RTT; the VERDICT is the server's classification of this
     browser's path (server/src/index.ts:3726), never a local ladder re-derived
     from rttMs. `rungFromLane` then layers the lane's own freshness on top, so
     a frozen success cannot stay green: the 15s self-expiry demotes READY to
     STALE while a proven outage stays BLOCKED.

     `rungFromLane` is deliberately NOT called when there is no observation: its
     `proven` default is READY for a CURRENT lane, and a CURRENT lane with no
     server classification proves nothing at all. */
  const observation = browser.value?.observation ?? null;
  const c2: CellProps = observation !== null
    ? (() => {
      const lane = rungFromLane(browser, rungFromWatchmanStatus(observation.status));
      return {
        id: 'browser',
        name: 'Browser Path',
        reading: (
          <>
            <span className="mx-num wd-num">{Math.round(observation.rttMs)}</span>
            <span className="mx-unit">ms</span>
          </>
        ),
        readingKind: 'value' as const,
        tone: toneFor(lane.rung),
        rung: lane.rung,
        stale: lane.stale,
        warrant: (
          <>
            Server classified this path <b>{observation.status}</b> ·
            {observation.socketConnected ? ' socket connected' : ' socket not connected'}
            {browser.observedAtMs === null
              ? null
              : <> · read {relAge(browser.observedAtMs, nowMs)}</>}
            {lane.reason === null ? null : <> · <b>{lane.reason}</b></>}
            {lane.stale && browser.lastSuccessAtMs !== null
              ? <> — last classified path {relAge(browser.lastSuccessAtMs, nowMs)}</>
              : null}
          </>
        ),
      };
    })()
    : {
      id: 'browser',
      name: 'Browser Path',
      reading: browser.reason ?? browserDetail,
      readingKind: 'reason',
      tone: undefined,
      rung: browser.state === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'UNKNOWN',
      warrant: (
        <>
          {browser.reason ?? browserDetail}
          {browser.lastSuccessAtMs === null
            ? <> · this browser has never held a server-classified path</>
            : <> · last classified path {relAge(browser.lastSuccessAtMs, nowMs)}</>}
        </>
      ),
    };

  /* ---- cell 3 · Binding Continuity -------------------------------------- */
  const c3Rung = continuityRung(continuity);
  const c3: CellProps = {
    id: 'continuity',
    name: 'Binding Continuity',
    reading: continuity,
    readingKind: 'value',
    tone: toneFor(c3Rung),
    rung: c3Rung,
    warrant: continuityError !== null
      ? <>{continuityError} · <Ref>binding.error</Ref></>
      : view !== null
        ? <>{view.dataFreshness ?? 'The supervisor published no freshness claim'} · <Ref>ownerView.dataFreshness</Ref></>
        : <>Freshness claim unread · {ownerView.reason ?? 'REASON_MISSING'}</>,
  };

  /* ---- cell 4 · Recovery State ------------------------------------------ */
  const rb = opsReadback.known ? opsReadback.value : null;
  const rbObservedAt = parseUtc(rb?.observedAtUtc);
  const rbValidUntil = parseUtc(rb?.validUntilUtc);
  const c4: CellProps = rb !== null
    ? {
      id: 'recovery',
      name: 'Recovery State',
      reading: rb.recoveryState,
      readingKind: 'value',
      tone: toneFor(gateOnContinuity(recoveryRung(rb.recoveryState), continuity)),
      rung: gateOnContinuity(recoveryRung(rb.recoveryState), continuity),
      warrant: (
        <>
          {gateOnContinuity(recoveryRung(rb.recoveryState), continuity) !== recoveryRung(rb.recoveryState)
            ? <>{continuityGateReason(continuity)} · </>
            : null}
          Readback {rbObservedAt === null
            ? <>timestamp <b>did not parse</b> (<Ref>{rb.observedAtUtc}</Ref>)</>
            : <>observed {relAge(rbObservedAt, nowMs)}</>}
          {rbValidUntil === null ? null : <> · lease {leaseLabel(rbValidUntil, nowMs)}</>}
          {view?.unresolvedRecovery == null
            ? null
            : <> · owner view: <b>{view.unresolvedRecovery}</b></>}
          {lastRecoveryAtMs === null
            ? <> · no recovery request has been issued from this browser</>
            : <> · last local recovery request {relAge(lastRecoveryAtMs, nowMs)}</>}
        </>
      ),
    }
    : {
      id: 'recovery',
      name: 'Recovery State',
      reading: sharedCause !== null
        ? <AbsenceSlot kind="void" srLabel="Unread." />
        : (opsReadback.reason ?? 'REASON_MISSING'),
      readingKind: sharedCause !== null ? 'absent' : 'reason',
      tone: undefined,
      rung: 'UNKNOWN',
      warrant: (
        <>
          {opsReadback.reason ?? 'REASON_MISSING'} · <Ref>{opsReadback.source}</Ref>
          {lastRecoveryAtMs === null
            ? null
            : <> · last local recovery request {relAge(lastRecoveryAtMs, nowMs)}</>}
        </>
      ),
    };

  const cells: readonly CellProps[] = [c1, c2, c3, c4];

  /* ---- the interlock ------------------------------------------------------
     The section's POPULATION is five — these four cells plus the interlock —
     and that partition is now counted once, by the hook, and printed once, by
     WatchdogSurface's section head. The local `rungs`/`proven`/`blocking`/
     `qualified`/`unknown` tally that used to live here was DELETED at
     integration along with the duplicate head it fed: two counters for one
     population, thirty pixels apart, counting different things, is not more
     evidence — it is a second chance to be wrong (§3.14). */
  const il = interlock.known ? interlock.value : null;
  const interlockRaw: Rung = il !== null
    ? (il.blocksNewEntries ? 'BLOCKED' : 'READY')
    : 'UNKNOWN';
  const interlockRung: Rung = gateOnContinuity(interlockRaw, continuity);

  /* Block ids are generated, never literal: two PostureBands on one document
     would otherwise share a label id and silently mislabel each other. */
  const interlockHeadId = useId();
  const policyHeadId = useId();
  const blockersHeadId = useId();

  const ilEvaluatedAt = parseUtc(il?.evaluatedAtUtc);
  const ilValidUntil = parseUtc(il?.readbackValidUntilUtc);
  const policy = readinessPolicy.known ? readinessPolicy.value : null;
  const waiver = policy?.waiver ?? null;
  const waiverExpiresAt = parseUtc(waiver?.expiresAt);

  return (
    /* INTEGRATION FIX (§4.1: a section never contains a section; §3.14: one
       coverage counter per section). This file used to open with
       `<section className="wdf-section pbx">` plus its own T2 head and its own
       count. Mounted inside WatchdogSurface's `<section className="wdf-section">`
       that produced a nested section, TWO heads, and — worse — TWO coverage
       counters per section that were free to disagree, because this one counted
       rungs while the shell's counts the hook's measured partition. The shell
       owns the frame, the title, the ordinal and the counter; this file owns the
       band. The rung tallies above are still computed: they feed the shared-cause
       sentence, which is a finding, not a head ornament. */
    <div className="pbx">

      <div className="mx">
        <div className="mx-band" role="group" aria-label="Owner posture verdicts">
          {cells.map((c) => <MetricCell key={c.id} {...c} />)}
        </div>
        {sharedCause === null ? null : (
          <p className="pbx-shared wd-t5">
            <b>Shared cause.</b> Every supervisor-sourced verdict on this band is unread from one
            cause: {sharedCause}. Source <Ref>{ownerView.source}</Ref>.
            {/* The distinction §3.10 draws, and it is not decoration: a shared
                cause is one upstream read failing, a transport failure is this
                browser losing the network. Only the second is claimed, and only
                when the independently-read browser lane actually proves it. */}
            {observation !== null
              ? <> This is a shared cause and not a transport failure: the browser path was read
                independently and the server classified it <b>{observation.status}</b>.</>
              : <> Whether this browser still has a network path is <b>also</b> unread — see the
                Browser Path cell, which failed separately.</>}
          </p>
        )}
      </div>

      {/* ---- the fifth verdict, full width ------------------------------- */}
      <div className="pbx-block" role="group" aria-labelledby={interlockHeadId}>
        <div className="pbx-block-head">
          <h3 id={interlockHeadId} className="wd-t3">Ops Intake Interlock</h3>
          <StatusChip
            state={interlockRung}
            label={interlockRung === interlockRaw ? il?.state : undefined}
            reason={il !== null
              ? (
                <>
                  {interlockRung !== interlockRaw
                    ? <>{continuityGateReason(continuity)} · the supervisor's own word was <b>{il.state}</b> · </>
                    : null}
                  {il.blocksNewEntries ? 'Blocks new entries' : 'Does not block new entries'}
                  {ilEvaluatedAt === null
                    ? <> · evaluated <b>{il.evaluatedAtUtc}</b>, which did not parse</>
                    : <> · evaluated {relAge(ilEvaluatedAt, nowMs)}</>}
                  {il.readbackValidUntilUtc === null
                    ? <> · the gate recorded no readback lease, which happens only when the
                      readback itself was rejected</>
                    : ilValidUntil === null
                      ? <> · lease <b>{il.readbackValidUntilUtc}</b>, which did not parse</>
                      : <> · readback lease {leaseLabel(ilValidUntil, nowMs)}</>}
                </>
              )
              : <>{interlock.reason ?? 'REASON_MISSING'} · <Ref>{interlock.source}</Ref></>}
          />
        </div>

        <dl className="wd-fields">
          {il === null ? (
            <Field
              label="INTERLOCK"
              value="Unread"
              trailing={<StatusChip state="UNKNOWN" reason={interlock.reason ?? 'REASON_MISSING'} />}
              note={<>
                Source <Ref>{interlock.source}</Ref>. Until this reads, the page cannot tell a clear
                gate from a blocked one — and neither can you.
              </>}
            />
          ) : il.reasonCodes.length === 0 ? (
            <Field
              label="REASON CODES"
              value="None. The gate evaluated the readback and found no blocking field."
              trailing={<AbsenceSlot kind="none" srLabel="Measured zero reason codes." />}
              note={<>
                A measured empty set, not an unread one: the gate only reaches an empty result after
                the readback passes structural validation and every ops field reads clean.
              </>}
            />
          ) : (
            il.reasonCodes.map((code, index) => {
              const row = explainCode(code, opsReadback, nowMs);
              return (
                <Field
                  key={`${code}-${index}`}
                  label={code}
                  labelKind="code"
                  value={row.value}
                  trailing={row.trailing}
                  proof={row.proof}
                  note={<>{row.field} — {row.note}</>}
                />
              );
            })
          )}

          {/* Printed on EVERY render, clear or blocked. A clear interlock never
              authorises an action, and the page says so rather than letting the
              operator infer permission from the absence of a refusal. */}
          <Field
            label="EXTERNAL ACTION AUTHORIZATION"
            value={il === null
              ? 'Unread'
              : <>The interlock authorises <b>{il.externalActionAuthorization}</b>, clear or blocked</>}
            trailing={il === null
              ? <StatusChip state="UNKNOWN" reason={interlock.reason ?? 'REASON_MISSING'} />
              : <>{il.externalActionAuthorization}</>}
            note={<>
              <Ref>opsIntakeInterlock.externalActionAuthorization</Ref> — typed to the single literal
              value. A clear gate is a statement about intake, never a permission.
            </>}
          />

          <Field
            label="ACTION"
            value="NONE — NO WEB COMMAND CLEARS AN INTERLOCK"
            trailing={<AbsenceSlot kind="none" srLabel="Measured zero controls." />}
            note={<>
              <Ref>CLEAR_DEPLOYMENT_FREEZE</Ref> exists on the system-integration control surface but
              is outside <Ref>SAFE_LIVE_BACKEND_COMMAND_IDS</Ref> and has no canonical preview entry,
              so this page draws no button for it. Clear the underlying readback field at its owner.
            </>}
          />
        </dl>
      </div>

      {/* ---- service readiness policy ------------------------------------ */}
      <div className="pbx-block" role="group" aria-labelledby={policyHeadId}>
        <div className="pbx-block-head">
          <h3 id={policyHeadId} className="wd-t3">Service Readiness Policy</h3>
          <StatusChip
            state={policy !== null ? gateOnContinuity(policyRung(policy), continuity) : 'UNKNOWN'}
            /* The server's word is dropped when the client downgrades the rung:
               "VALID" beside an UNKNOWN glyph is the downgrade defeated at the
               only layer read first. */
            label={policy !== null && gateOnContinuity(policyRung(policy), continuity) === policyRung(policy)
              ? policy.status
              : undefined}
            reason={policy === null
              ? <>{readinessPolicy.reason ?? 'REASON_MISSING'} · <Ref>{readinessPolicy.source}</Ref></>
              : gateOnContinuity(policyRung(policy), continuity) !== policyRung(policy)
                ? <>{continuityGateReason(continuity)} · the supervisor's own word was <b>{policy.status}</b></>
                : <>{policy.accepted ? 'Accepted' : 'Not accepted'} · <Ref>{policy.reasonCode}</Ref></>}
          />
        </div>

        <dl className="wd-fields">
          {policy === null ? (
            <Field
              label="POLICY"
              value="Unread"
              trailing={<StatusChip state="UNKNOWN" reason={readinessPolicy.reason ?? 'REASON_MISSING'} />}
              note={<>Source <Ref>{readinessPolicy.source}</Ref>.</>}
            />
          ) : waiver === null ? (
            <Field
              label="WAIVER"
              value="No signed waiver is attached to this policy"
              trailing={(
                <StatusChip
                  state={policy.status === 'MISSING' ? 'NOT_CONFIGURED' : 'UNAVAILABLE'}
                  reason={<>waiver is null while status reads {policy.status}</>}
                />
              )}
              note={<>
                <Ref>serviceReadinessPolicy.waiver</Ref> — with no waiver, every component that
                depends on one is judged on its own evidence alone.
              </>}
            />
          ) : (
            <>
              <Field
                label="WAIVER"
                value={<Identifier kind="ref" value={waiver.id} label="readiness waiver id" />}
                trailing={waiver.status}
                proof={waiver.status === 'EXPIRED' ? 'qualified' : 'direct'}
                note={<><Ref>serviceReadinessPolicy.waiver.id</Ref> · <Ref>waiver.status</Ref></>}
              />
              <Field
                label="OWNER"
                value={waiver.owner}
                note={<><Ref>serviceReadinessPolicy.waiver.owner</Ref> — the person who has to renew it.</>}
              />
              <Field
                label="EXPIRES"
                value={<Ref>{waiver.expiresAt}</Ref>}
                trailing={waiverExpiresAt === null
                  ? <StatusChip state="UNKNOWN" reason="expiresAt did not parse as a date." />
                  : <>{leaseLabel(waiverExpiresAt, nowMs)}</>}
                proof={waiverExpiresAt !== null && waiverExpiresAt <= nowMs ? 'qualified' : 'direct'}
                note={policy.status === 'EXPIRED'
                  ? <>The policy status is <b>EXPIRED</b>. Every readiness verdict resting on this
                    waiver is now unbacked, and the waiver names <b>{waiver.owner}</b> as the owner
                    who renews it.</>
                  : <><Ref>serviceReadinessPolicy.waiver.expiresAt</Ref></>}
              />
              <Field
                label="PERMITS"
                value={<>{waiver.mode} within {waiver.scope}</>}
                note={<>Granted because <b>{waiver.reason}</b> · <Ref>waiver.mode</Ref> ·{' '}
                  <Ref>waiver.scope</Ref> · <Ref>waiver.reason</Ref></>}
              />
            </>
          )}
        </dl>
      </div>

      {/* ---- the two click-throughs -------------------------------------- */}
      <div className="pbx-block" role="group" aria-labelledby={blockersHeadId}>
        <div className="pbx-block-head">
          <h3 id={blockersHeadId} className="wd-t3">Named Blockers</h3>
        </div>
        <dl className="wd-fields">
          <BlockerField
            label="REQUIRED-READINESS BLOCKER"
            fact={requiredBlocker}
            noneSentence="None. The supervisor named no required-readiness blocker."
            noneSrLabel="Measured zero required-readiness blockers."
            onFocusOwner={onFocusOwner}
            note={<>
              <Ref>snapshot.firstRequiredReadinessBlockerComponentId</Ref>
              {requiredBlocker.known && requiredBlocker.value !== null
                && requiredBlocker.value === rootBlocker.value
                ? <> — the same component as the root blocker below, so this is one break, not two.</>
                : null}
            </>}
          />
          <BlockerField
            label="ROOT BLOCKER"
            fact={rootBlocker}
            noneSentence="None. The dashboard named no root blocker."
            noneSrLabel="Measured zero root blockers."
            onFocusOwner={onFocusOwner}
            note={<><Ref>snapshot.dashboard.firstRootBlockerComponentId</Ref></>}
          />
        </dl>
      </div>
    </div>
  );
}
