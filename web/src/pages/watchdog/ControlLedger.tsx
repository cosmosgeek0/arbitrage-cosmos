/* =============================================================================
   ControlLedger — the canonical control registry, one acknowledgement row per
   published incident, and the durable command mutex pinned at its head.

   THE OPERATOR QUESTION THIS ANSWERS
   "What operational authority do I actually have right now, for everything I do
   not have exactly why not, and is an earlier command's outcome still unproven —
   meaning every control here is correctly refusing me?"

   WHAT THIS FILE DOES AND DOES NOT OWN
   - It issues exactly ONE request, and only when the operator presses for it:
     the durable readback behind the mutex, through ControlCommit's exported
     `recheckDurableCommandResult` so the mutex and the commit are literally one
     implementation. Every other request on a row belongs to ControlCommit.
   - It derives no health verdict. The arming predicate is copied verbatim from
     the shipped ControlRegistryPanel (:437-450) and every refusal sentence is
     either the server's own string or a fixed, stated fact about this route.
   - It renders neither `control.preview` nor `control.latestResult` as data.
     Both are always null on a live envelope; the armable row states NO PREVIEW
     and NO RESULT as absence, and the receipt ControlCommit returns is the only
     proof a command ran.
   - It does not widen SAFE_LIVE_BACKEND_COMMAND_IDS. `attention.focus.*` is
     WIRED_LIVE and deliberately off the web allowlist, so it renders refused
     with COMMAND_OUTSIDE_IP_CONTROL_NON_MONEY_ALLOWLIST. That is the output the
     design wants, not a gap to be patched.

   BIBLE §3.7 IS COMPOSED AS DOCTRINE, NOT AS THE RAIL — deliberately.
   §3.7's four silhouettes are lease-bearing: a SOLID rail asserts "live, in
   lease", and the lease is `evaluatedAtMs >= Date.parse(opsReadback.validUntilUtc)`
   — two server-stamped numbers that live in PostureBand's slice, not this one.
   Drawing a solid rail from evidence this component cannot read would violate
   Law 1 (never render a value that was not measured); drawing a dashed one
   would assert an expiry equally unproven. §3.7's actual holding — that
   `role="switch"` is unrepresentable because two facts may disagree, that
   intent is drawn only ON disagreement, and that an unreadable position gets NO
   mark — is composed in full below as a two-fact readout. The rail is refused
   for cause, not skipped.

   COMPOSES: §3.1 StatusChip · §3.6 Button (through ControlCommit) · §3.7
   readback doctrine · §3.11 InfoRow · §3.14 CoverageCounter · §3.20 (never sets
   `!important`, never animates outside a transition, so both kill switches win).
   ========================================================================== */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX,
  SAFE_LIVE_BACKEND_COMMAND_IDS,
  projectCanonicalIncidentNotifications,
  readDurableCommandResultIdentity,
  type ProductCommandResultReconciliation,
  type ProductControlRegistryEntry,
  type ProductIncidentAvailability,
  type ProductIncidentProjection,
  type ProductIntegrationClient,
} from '../../lib/productIntegration';
import {
  canonicalKillSwitchEngagePosture,
  type CanonicalKillSwitchEngagePosture,
} from '../../lib/operatorControlPosture';
import { StatusChip, rungFromWiringState, type Rung } from './StatusChip';
import { Age, Identifier } from './MachineValue';
import {
  ControlCommit,
  commandMutexBlocks,
  recheckDurableCommandResult,
} from './ControlCommit';
import type { Attempt, Fact, MaterialContinuity } from './watchdogEvidence';
import './ControlLedger.css';

/* -------------------------------------------------------------- vocabulary */

/* DELETED AT INTEGRATION: `CoverageClass` and `COVERAGE_OF_RUNG`, this file's
   own rung -> class map. It fed the duplicate coverage counter that was removed
   with this section's duplicate head; the surviving partition is the hook's,
   printed once by WatchdogSurface (§3.14). */

interface Refusal {
  /** A machine code where this route owns one; null where the server's own
   *  sentence is the whole reason and prefixing a code would invent one. */
  readonly code: string | null;
  /** Real DOM text, in reading order. Never a title, never a tooltip. */
  readonly say: string;
}

interface Verdict {
  readonly rung: Rung;
  readonly refusal: Refusal | null;
  readonly actionable: boolean;
  readonly emergencyPosture: CanonicalKillSwitchEngagePosture | null;
}

/* ------------------------------------------------------------------ helpers */

function domId(prefix: string, raw: string): string {
  return `${prefix}-${raw.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

/**
 * THE ARMING PREDICATE, copied verbatim from ControlRegistryPanel.tsx:437-450:
 *
 *   safeLive   = SAFE_LIVE_BACKEND_COMMAND_IDS.includes(backendCommandId)
 *   functional = wiringState === 'WIRED_LIVE' ? safeLive : false
 *   emergency  = controlId === 'global.kill-switch.engage'
 *                  ? canonicalKillSwitchEngagePosture(control) : null
 *   actionable = functional && disabledReason === null && !durableBlocked
 *                  && (emergency?.actionAllowed ?? true) && continuity === 'PROVEN'
 *
 * REFUSAL PRECEDENCE, and the order is the point — the operator must be told
 * the thing they can act on first:
 *   durable reconciliation -> material continuity -> emergency posture
 *   -> control.disabledReason -> web allowlist -> wiring state.
 */
function assessControl(
  control: Readonly<ProductControlRegistryEntry>,
  continuity: MaterialContinuity,
  durableSay: string | null,
): Verdict {
  const safeLive = SAFE_LIVE_BACKEND_COMMAND_IDS.includes(control.backendCommandId);
  const functional = control.wiringState === 'WIRED_LIVE' ? safeLive : false;
  const emergencyPosture = control.controlId === 'global.kill-switch.engage'
    ? canonicalKillSwitchEngagePosture(control)
    : null;
  const actionable = functional
    && control.disabledReason === null
    && durableSay === null
    && (emergencyPosture?.actionAllowed ?? true)
    && continuity === 'PROVEN';

  const refused = (rung: Rung, refusal: Refusal): Verdict => (
    { rung, refusal, actionable: false, emergencyPosture }
  );

  if (durableSay !== null) return refused('BLOCKED', { code: null, say: durableSay });

  if (continuity !== 'PROVEN') {
    return refused('BLOCKED', {
      code: 'MATERIAL_CONTINUITY_NOT_PROVEN',
      say: `Material-event continuity is ${continuity}. Commands are refused until it is PROVEN.`,
    });
  }
  if (emergencyPosture?.disabledReason != null) {
    return refused('UNAVAILABLE', { code: null, say: emergencyPosture.disabledReason });
  }
  if (control.disabledReason !== null) {
    return refused('UNAVAILABLE', { code: null, say: control.disabledReason });
  }
  if (control.wiringState === 'WIRED_LIVE' && !safeLive) {
    return refused('OWNER_GATED', {
      code: 'COMMAND_OUTSIDE_IP_CONTROL_NON_MONEY_ALLOWLIST',
      say: `${control.backendCommandId} is wired live on the server and is deliberately absent from this route's non-money command allowlist.`,
    });
  }
  if (!functional) {
    /* The server's own suffix, through the one wiring-state mapper, so this
       file never invents a word for a state StatusChip already names. */
    const mapped = rungFromWiringState(control.wiringState);
    return refused(mapped.rung, {
      code: control.wiringState,
      say: mapped.reason ?? `${control.wiringState} is not functional in this route.`,
    });
  }
  return { rung: 'READY', refusal: null, actionable, emergencyPosture };
}

/**
 * An incident row's chip carries ONE thing: your acknowledgement authority. The
 * incident's own severity and state are text in the label and mass on the mark
 * rail, so the chip never has to mean two things at once.
 */
function assessIncidentAck(
  incident: Readonly<ProductIncidentProjection>,
  control: Readonly<ProductControlRegistryEntry> | undefined,
  continuity: MaterialContinuity,
  durableSay: string | null,
): Verdict {
  const refused = (rung: Rung, refusal: Refusal): Verdict => (
    { rung, refusal, actionable: false, emergencyPosture: null }
  );

  if (control === undefined) {
    return refused('NOT_CONFIGURED', {
      code: 'ACK_CONTROL_ABSENT_FROM_REGISTRY',
      say: `The envelope published this incident but no registry entry for ${incident.acknowledgementControlId}, so there is no command to arm.`,
    });
  }
  if (incident.state !== 'OPEN') {
    return refused('UNAVAILABLE', incident.state === 'ACKNOWLEDGED'
      ? {
        code: null,
        say: `Already acknowledged by ${incident.acknowledgedByOperatorId ?? 'an operator the ledger did not name'}. Acknowledgement is immutable and is not repeatable.`,
      }
      : { code: null, say: 'Incident is RESOLVED. There is nothing left to acknowledge.' });
  }
  return assessControl(control, continuity, durableSay);
}

/* DELETED AT INTEGRATION with this section's duplicate head: `tally` and
   `incidentCoverage`, the private partition that fed a SECOND coverage counter
   thirty pixels below the shell's. §3.14 allows one counter per section, and the
   shell's is the one the hook actually measures (`sections.control`). Keeping a
   second count that is free to disagree with the first is not more evidence, it
   is an opportunity to be wrong twice. `COVERAGE_OF_RUNG` stays: it is the rung
   -> class map the evidence spine's own partition is built on. */

/* -------------------------------------------------------------------- props */

export interface ControlLedgerProps {
  readonly controls: readonly Readonly<ProductControlRegistryEntry>[];
  readonly incidents: readonly Readonly<ProductIncidentProjection>[];
  readonly incidentAvailability: Fact<ProductIncidentAvailability>;
  readonly continuity: MaterialContinuity;
  readonly client: Readonly<ProductIntegrationClient>;
  readonly reconciliation: ProductCommandResultReconciliation;
  readonly onReconciliation: (next: ProductCommandResultReconciliation) => void;
  readonly focusControlId: string | null;
  readonly onFocusHandled: () => void;
  readonly nowMs: number;
  readonly onRefreshEvidence: () => Promise<void>;
  readonly onRecordAttempt: (attempt: Omit<Attempt, 'id'>) => void;
  readonly onFocusOwner: (componentId: string) => void;
}

/* ==========================================================================
   ControlLedger
   ========================================================================== */

export function ControlLedger({
  controls,
  incidents,
  incidentAvailability,
  continuity,
  client,
  reconciliation,
  onReconciliation,
  focusControlId,
  onFocusHandled,
  nowMs,
  onRefreshEvidence,
  onRecordAttempt,
  onFocusOwner,
}: ControlLedgerProps): JSX.Element {
  const [rechecking, setRechecking] = useState(false);
  const recheckAbortRef = useRef<AbortController | null>(null);
  const recheckSeqRef = useRef(0);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  /* ---- the durable mutex -------------------------------------------------
     Read from localStorage on mount and on any cross-tab write. A PENDING
     identity is deliberately NOT auto-rechecked over the network: a monitoring
     page must not issue a command-result request the operator did not ask for,
     and the whole design of this strip is that Recheck is the one control that
     stays live while every other one is refusing. Rendering BLOCKED with an
     enabled exit is the honest arrangement, and it is also the only one that
     cannot surprise an operator who just opened the page. */

  const readDurable = useCallback(() => {
    onReconciliation(readDurableCommandResultIdentity());
  }, [onReconciliation]);

  useEffect(() => {
    let live = true;
    queueMicrotask(() => { if (live) readDurable(); });
    return () => {
      live = false;
      recheckSeqRef.current += 1;
      recheckAbortRef.current?.abort();
      recheckAbortRef.current = null;
    };
  }, [readDurable]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX)) return;
      recheckSeqRef.current += 1;
      recheckAbortRef.current?.abort();
      recheckAbortRef.current = null;
      readDurable();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [readDurable]);

  const identity = reconciliation.identity;
  const priorResult = reconciliation.result;

  const runRecheck = useCallback(async () => {
    if (identity === null) return;
    const seq = recheckSeqRef.current + 1;
    recheckSeqRef.current = seq;
    recheckAbortRef.current?.abort();
    const controller = new AbortController();
    recheckAbortRef.current = controller;
    setRechecking(true);
    try {
      // ControlCommit owns the readback and records its own Attempt, so the
      // mutex and the commit cannot drift into two different truths.
      const next = await recheckDurableCommandResult({
        client,
        identity,
        priorResult,
        signal: controller.signal,
        onRecordAttempt,
      });
      if (recheckSeqRef.current !== seq) return;
      onReconciliation(next);
      // Re-derive from re-read evidence rather than trusting the response.
      await onRefreshEvidence();
    } finally {
      if (recheckSeqRef.current === seq) {
        if (recheckAbortRef.current === controller) recheckAbortRef.current = null;
        setRechecking(false);
      }
    }
  }, [client, identity, onRecordAttempt, onReconciliation, onRefreshEvidence, priorResult]);

  const durableBlocked = commandMutexBlocks(reconciliation);
  const durableSay = durableBlocked
    ? `A durable command result is ${reconciliation.state}${reconciliation.reasonCode === null ? '' : ` · ${reconciliation.reasonCode}`}. Recheck it before issuing another command.`
    : null;

  /* ---- rows -------------------------------------------------------------- */

  /**
   * Order and availability both come from the server-side projection, which
   * returns [] whenever availability !== AVAILABLE — so an unavailable incident
   * feed can never be mistaken for a measured empty one. The projection is a
   * notification shape, so each row is mapped straight back to its incident by
   * `ledgerEventId`; nothing from the notification is rendered.
   */
  const incidentRows = useMemo(() => {
    const availability = incidentAvailability.value;
    if (!incidentAvailability.known || availability === null) return [];
    const byLedgerEvent = new Map(incidents.map((incident) => [incident.ledgerEventId, incident]));
    return projectCanonicalIncidentNotifications(availability, incidents)
      .map((notification) => byLedgerEvent.get(notification.id))
      .filter((incident): incident is Readonly<ProductIncidentProjection> => incident !== undefined);
  }, [incidentAvailability.known, incidentAvailability.value, incidents]);

  const byControlId = useMemo(
    () => new Map(controls.map((control) => [control.controlId, control])),
    [controls],
  );

  const incidentVerdicts = useMemo(() => incidentRows.map((incident) => {
    const control = byControlId.get(incident.acknowledgementControlId);
    return [incident, control, assessIncidentAck(incident, control, continuity, durableSay)] as const;
  }), [byControlId, continuity, durableSay, incidentRows]);

  /* The supervisor emits one `incident.ack.<digest>` registry entry per
     incident (server controls.ts:129). Those belong on the incident row that
     explains them, never a second time in a control family — the same command
     listed twice is how you acknowledge the same incident twice. */
  const ackControlIds = useMemo(
    () => new Set(incidents.map((incident) => incident.acknowledgementControlId)),
    [incidents],
  );

  const registryVerdicts = useMemo(
    () => controls
      .filter((control) => !ackControlIds.has(control.controlId))
      .map((control) => [control, assessControl(control, continuity, durableSay)] as const),
    [ackControlIds, continuity, controls, durableSay],
  );


  /* ---- collapse is the SHELL's, and was deleted from here at integration ----
     This file used to run a complete second copy of the derived-collapse machine
     (a settled-on-first-population default, a one-way auto-expand on the flip
     out of all-proven, a pointer/focus deferral and its own disclosure button),
     inside WatchdogSurface's, which runs exactly the same machine off the hook's
     measured `sections.control`. Two collapse owners for one region means the
     region can be open by one and hidden by the other, and it put a SECOND
     disclosure button and a SECOND coverage counter in a head thirty pixels
     below the first. §4.1 allows one section here and §3.14 allows one counter.
     The local partition (`tally`, `incidentCoverage`, `population`, `counts`,
     `allProven`) went with it — every one of them existed only to feed the
     counter and the collapse this file no longer owns. */

  /* ---- focus handoff from a blocker id elsewhere on the page -------------- */

  const rowRefCallbacks = useRef(new Map<string, (node: HTMLDivElement | null) => void>());
  const registerRow = useCallback((key: string) => {
    const cache = rowRefCallbacks.current;
    const existing = cache.get(key);
    if (existing !== undefined) return existing;
    // A fresh closure per render would detach and re-attach every row ref on
    // every poll, which is churn a 5s cadence cannot afford.
    const created = (node: HTMLDivElement | null) => {
      if (node === null) rowRefs.current.delete(key);
      else rowRefs.current.set(key, node);
    };
    cache.set(key, created);
    return created;
  }, []);

  /* Two effects, and the split is still load-bearing after the local collapse
     machine was deleted: the SHELL's `openSection('control')` does not flush
     synchronously either, so focusing in the same pass would call `.focus()` on
     a row still inside the shell's `hidden` body — which fails silently and
     leaves the operator staring at a section that did not move. The request is
     parked and the focus lands in the pass after the shell has opened. */
  const [focusRequest, setFocusRequest] = useState<{ readonly key: string } | null>(null);
  /* A jump that resolves to no rendered row is a MISS, and the page says so in
     words rather than swallowing the press. It happens for real: an
     `incident.ack.*` control is filtered out of the registry list on purpose,
     and its incident row is absent whenever the incident feed is not AVAILABLE,
     so a neighbour can legitimately hold an id this ledger cannot show. */
  const [focusMiss, setFocusMiss] = useState<string | null>(null);
  const missRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (focusControlId === null) return;
    // A fresh object every time, so two consecutive jumps to the SAME row still
    // change identity and still re-run the focus effect.
    setFocusRequest({ key: focusControlId });
    onFocusHandled();
  }, [focusControlId, onFocusHandled]);

  useEffect(() => {
    if (focusRequest === null) return;
    const row = rowRefs.current.get(focusRequest.key);
    if (row === undefined) {
      setFocusMiss(focusRequest.key);
    } else {
      setFocusMiss(null);
      row.focus();
      row.scrollIntoView({ block: 'nearest' });
    }
    setFocusRequest(null);
  }, [focusRequest]);

  useEffect(() => {
    if (focusMiss !== null) missRef.current?.focus();
  }, [focusMiss]);

  /* ---- grouping: the server's own families, in first-appearance order ----- */

  const families = useMemo(() => {
    const order: string[] = [];
    const byFamily = new Map<string, (readonly [Readonly<ProductControlRegistryEntry>, Verdict])[]>();
    for (const entry of registryVerdicts) {
      const family = entry[0].group;
      if (!byFamily.has(family)) { byFamily.set(family, []); order.push(family); }
      byFamily.get(family)!.push(entry);
    }
    // The emergency stop sorts first inside its own family, as the shipped
    // panel does. Nothing else is re-ordered: the server's order is evidence.
    for (const rows of byFamily.values()) {
      rows.sort((left, right) => (
        left[0].controlId === 'global.kill-switch.engage' ? -1
          : right[0].controlId === 'global.kill-switch.engage' ? 1 : 0
      ));
    }
    return order.map((family) => [family, byFamily.get(family)!] as const);
  }, [registryVerdicts]);

  const continuityBlocked = continuity !== 'PROVEN';
  const commitProps = { client, onRefreshEvidence, onReconciliation, onRecordAttempt };

  return (
    <div className="wdcl">
      {/* ---- the durable command mutex, pinned at the head -------------------
          Renders NOTHING at state NONE. A standing "no pending commands"
          banner is precisely the box-filling this page exists to remove. It
          draws no box either: its weight is the BLOCKED chip's solid fill,
          which is the only hierarchy mechanism that survives greyscale. */}
      {reconciliation.state !== 'NONE' && (
        <div
          className="wdcl-mutex"
          data-blocking={durableBlocked ? 'yes' : 'no'}
          role={durableBlocked ? 'alert' : 'status'}
        >
          <div className="wdcl-mutex-verdict">
            {/* No `label`: that prop carries the SERVER's own word, and there is
                no server word for a browser-durable mutex. StatusChip's own
                vocabulary is the correct one here. */}
            <StatusChip
              state={durableBlocked ? 'BLOCKED' : 'READY'}
              reason={durableBlocked
                ? (
                  <>
                    Durable command result is <b>{reconciliation.state}</b>
                    {reconciliation.reasonCode !== null && <> · <b>{reconciliation.reasonCode}</b></>}.
                    Every control below is refusing you until this is proven terminal.
                  </>
                )
                : undefined}
            />
            {!durableBlocked && (
              <p className="wdcl-mutex-note wd-t5">
                The last command this browser issued is proven terminal. Nothing is holding the ledger.
              </p>
            )}
          </div>

          <dl className="wd-fields wdcl-mutex-fields">
            {identity !== null && (
              <>
                <MutexField label="Command">
                  <Identifier kind="rev" value={identity.commandId} label="command id" />
                </MutexField>
                <MutexField label="Control">
                  <Identifier kind="raw" value={identity.controlId} label="control id" />
                </MutexField>
                <MutexField label="Idempotency">
                  <Identifier kind="rev" value={identity.idempotencyKey} label="idempotency key" />
                </MutexField>
              </>
            )}
            {priorResult !== null && (
              <>
                <MutexField label="Last status">{priorResult.status}</MutexField>
                <MutexField label="Receipt">
                  {priorResult.receiptId === null
                    /* Absence, stated: the result contract publishes a receipt
                       only for APPLIED / ACCEPTED_ASYNC / ALREADY_APPLIED. */
                    ? <span className="wd-nodata">NO RECEIPT</span>
                    : <Identifier kind="rev" value={priorResult.receiptId} label="receipt id" />}
                </MutexField>
                <MutexField label="Correlation">
                  <Identifier kind="corr" value={priorResult.correlationId} label="correlation id" />
                </MutexField>
              </>
            )}
          </dl>

          {identity === null ? (
            <p className="wdcl-mutex-note wd-t5">
              The durable query carries no command identity, so there is nothing to re-read.
              Every control below stays refused until the stored state is valid again.
            </p>
          ) : (
            /* THE ONE CONTROL THAT MUST STAY ENABLED PRECISELY WHEN EVERYTHING
               ELSE IS BLOCKED — including while continuity is not proven.
               Re-reading the receipt is the only exit from the mutex, so gating
               it on the same condition it exists to clear would be a deadlock. */
            <button
              type="button"
              className={`wdb wdb--sm wdcl-recheck${rechecking ? ' is-pending' : ''}`}
              aria-busy={rechecking}
              onClick={() => { if (!rechecking) void runRecheck(); }}
              aria-label={`Recheck durable result for command ${identity.commandId}`}
            >
              {/* §3.6 Label Law: the label never changes. In-flight is the spinner. */}
              <span className="wdb-label">Recheck durable result</span>
              <span className="wdb-spin" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {focusMiss !== null && (
        <p className="wdf-miss wd-t5" ref={missRef} tabIndex={-1}>
          <b>CONTROL NOT ON THIS LEDGER</b> · <span className="wd-id">{focusMiss}</span> was
          requested from another section, and this ledger is rendering no row with that id.
          Acknowledgement controls are carried by their incident row, which is absent whenever the
          incident feed is not AVAILABLE; nothing was focused and nothing was changed.
        </p>
      )}

      {/* NOT `role="alert"`. D30 licenses a transient per-cluster alert on a
          user-initiated destructive arm only; this fires on a DATA condition and
          would interrupt the operator on every poll that flips continuity. The
          page's one live region already speaks "material continuity <state>" on
          that transition, once, from the hook's announcement. */}
      {continuityBlocked && (
        <p className="wdcl-alert wd-t4">
          <b>BINDING BLOCKED</b> · Material-event continuity is {continuity}. Every control in this
          ledger is refused; only the durable recheck above remains available.
        </p>
      )}

      <div className="wdcl-body">
        {/* §3.11 — guidance INSIDE the surface it describes. Two rows, not
            three: a third would be filler, and §3.11 caps a host surface at
            three. Registers are grammatical mood plus ink, and zero hue. */}
        <ul className="gdx-list wdcl-guide">
          <li className="gdx-row" data-register="binding">
            <span className="gdx-glyph" aria-hidden="true"><GlyphShip /></span>
            <span className="gdx-body">
              <span className="gdx-say wd-t5">
                Ship the payload printed on the row, exactly. This page never composes a command
                body and never chooses a direction.
              </span>
              <span className="gdx-why wd-t6">
                Preview, confirm, commit and receipt are one contract; a control with no preview
                cannot be committed.
              </span>
            </span>
            <span className="gdx-prov">controls[].payload</span>
          </li>
          <li className="gdx-row" data-register="advisory">
            <span className="gdx-glyph" aria-hidden="true"><GlyphLock /></span>
            <span className="gdx-body">
              <span className="gdx-say wd-t5">
                One unproven receipt blocks every control here, in every tab, until it is re-read to
                a terminal state.
              </span>
              <span className="gdx-why wd-t6">
                The mutex is a browser-durable record, so a reload does not clear it and a second
                tab sees the same block.
              </span>
            </span>
            <span className="gdx-prov">localStorage</span>
          </li>
        </ul>

        {registryVerdicts.length === 0 ? (
          <p className="wdcl-empty wd-t5">
            The supervisor published an empty control registry.{' '}
            <code className="wd-id">snapshot.controls</code> carries no entries, so this route is
            offering no operational authority at all. This is a measured empty set, not a failed read.
          </p>
        ) : families.map(([family, rows]) => (
          <div className="wdcl-group" key={family}>
            <h3 className="wdcl-group-head">
              <span className="wd-t3">{family}</span>
              <span className="wd-t6 wd-col-num wd-num">{rows.length}</span>
            </h3>
            {rows.map(([control, verdict]) => (
              <ControlRow
                key={control.controlId}
                control={control}
                verdict={verdict}
                onFocusOwner={onFocusOwner}
                rowRef={registerRow(control.controlId)}
                {...commitProps}
              />
            ))}
          </div>
        ))}

        <div className="wdcl-group">
          <h3 className="wdcl-group-head">
            <span className="wd-t3">Incident acknowledgement</span>
            <span className="wd-t6 wd-col-num wd-num">{incidentVerdicts.length}</span>
          </h3>
          <IncidentAvailabilityNote fact={incidentAvailability} rowCount={incidentVerdicts.length} />
          {incidentVerdicts.map(([incident, control, verdict]) => (
            <IncidentRow
              key={incident.incidentId}
              incident={incident}
              control={control}
              verdict={verdict}
              nowMs={nowMs}
              onFocusOwner={onFocusOwner}
              rowRef={registerRow(incident.acknowledgementControlId)}
              {...commitProps}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ figures */

/* DELETED AT INTEGRATION: `Figure`, the renderer for the duplicate coverage
   counter above. WatchdogSurface's `CoverageFigure` is the one on the page. */

/** §3.5 FieldPair markup, so the mutex's metadata sits on the same subgrid as
 *  every other key/value pair on the page instead of a private two-column grid. */
function MutexField({ label, children }: {
  readonly label: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className="wd-field">
      <dt className="wd-field-label wd-t3">{label}</dt>
      <dd className="wd-field-body"><span className="wd-field-value wd-t4">{children}</span></dd>
    </div>
  );
}

/**
 * The server publishes `currentEffectiveValue` / `currentDesiredValue` as bare
 * strings, and it publishes the literal words UNKNOWN and UNAVAILABLE when the
 * owner could not read the control's state (server controls.ts:139 —
 * `state?.state ?? 'UNKNOWN'`). Those are rendered verbatim, because they are
 * the server's own words, but never in the value register: a non-reading must
 * not sit at the same ink as a reading. The row's chip carries the reason.
 */
function ReadbackValue({ value }: { readonly value: string }): JSX.Element {
  const unread = value === 'UNKNOWN' || value === 'UNAVAILABLE';
  return (
    <span className={`wd-field-value wd-t4${unread ? ' wd-nodata' : ''}`}>
      {value}
      {unread && <span className="sr-only"> — the control owner published no readable state.</span>}
    </span>
  );
}

/* ---------------------------------------------------------------- the rows */

interface CommitWiring {
  readonly client: Readonly<ProductIntegrationClient>;
  readonly onReconciliation: (next: ProductCommandResultReconciliation) => void;
  readonly onRecordAttempt: (attempt: Omit<Attempt, 'id'>) => void;
  readonly onRefreshEvidence: () => Promise<void>;
}

function VerdictCell({ verdict, whyId }: {
  readonly verdict: Verdict;
  readonly whyId: string;
}): JSX.Element {
  return (
    <div className="wdcl-verdict">
      <StatusChip
        state={verdict.rung}
        reason={verdict.refusal === null ? undefined : (
          <span id={whyId}>
            {verdict.refusal.code !== null && <><b>{verdict.refusal.code}</b> · </>}
            {verdict.refusal.say}
          </span>
        )}
      />
    </div>
  );
}

function ControlRow({
  control,
  verdict,
  onFocusOwner,
  rowRef,
  client,
  onReconciliation,
  onRecordAttempt,
  onRefreshEvidence,
}: CommitWiring & {
  readonly control: Readonly<ProductControlRegistryEntry>;
  readonly verdict: Verdict;
  readonly onFocusOwner: (componentId: string) => void;
  readonly rowRef: (node: HTMLDivElement | null) => void;
}): JSX.Element {
  const whyId = domId('wdcl-why', control.controlId);
  const disagrees = control.currentDesiredValue !== control.currentEffectiveValue;

  return (
    <div className="wdcl-row" data-rung={verdict.rung} ref={rowRef} tabIndex={-1}>
      {/* col 0, the mark rail. §3.8's `data-changed` semantic: a person set
          this and the machine has not caught up. It is redundant with the
          sentence below, and the sentence is the carrier — the rail only
          makes the row findable in a scan. */}
      <span className="wdcl-mark" aria-hidden="true" data-changed={disagrees ? 'yes' : 'no'} />
      {/* §1.6 rule 2: the icon gutter is --ink-3 always. Hue lives in the chip. */}
      <span className="wdcl-glyph" aria-hidden="true"><GlyphControl /></span>

      <div className="wdcl-identity">
        <p className="wd-t4 wdcl-label">{control.label}</p>
        <p className="wd-t6 wdcl-idline">
          <code className="wd-id">{control.controlId}</code>
          <span aria-hidden="true"> · </span>
          <code className="wd-id">{control.backendCommandId}</code>
          <span aria-hidden="true"> · </span>
          {control.targetType === 'COMPONENT' ? (
            <button
              type="button"
              className="wdcl-jump"
              onClick={() => onFocusOwner(control.targetId)}
              aria-label={`Focus the owner row for component ${control.targetId}`}
            >
              <code className="wd-id">{control.targetType}:{control.targetId}</code>
            </button>
          ) : (
            <code className="wd-id">{control.targetType}:{control.targetId}</code>
          )}
        </p>

        {/* The registry's own sentence for what this control is. One line, on
            every row, because "which of these is the one I want" is the first
            question a ledger has to answer. */}
        <p className="wd-t5 wdcl-say">{control.explanation}</p>

        {/* §3.7 as doctrine: two facts, never one boolean, and no role="switch".
            EFFECT is the measurement and leads; INTENT is drawn only when it
            DISAGREES, because agreement carries no information. */}
        <dl className="wd-fields wdcl-readback">
          <div className="wd-field">
            <dt className="wd-field-label wd-t3">Effect</dt>
            <dd className="wd-field-body">
              <ReadbackValue value={control.currentEffectiveValue} />
            </dd>
          </div>
          {disagrees && (
            <div className="wd-field" data-disagreement="true">
              <dt className="wd-field-label wd-t3">Intent</dt>
              <dd className="wd-field-body">
                <ReadbackValue value={control.currentDesiredValue} />
              </dd>
            </div>
          )}
          <div className="wd-field">
            <dt className="wd-field-label wd-t3">Revision</dt>
            <dd className="wd-field-body">
              <span className="wd-field-value wd-t4">
                <Identifier kind="rev" value={control.currentStateRevision} label="control revision" />
              </span>
            </dd>
          </div>
        </dl>
        {disagrees && (
          <p className="wd-t5 wdcl-disagree">
            Intent and effect disagree: the machine was asked for{' '}
            <b>{control.currentDesiredValue}</b> and is reporting{' '}
            <b>{control.currentEffectiveValue}</b>.
          </p>
        )}

        <VerdictCell verdict={verdict} whyId={whyId} />

        {/* Governance, one line. On a REFUSED row `requiredPosture` is usually
            the actionable half of the answer — it names the machine state you
            have to reach before this control can exist for you at all. */}
        <p className="wd-t6 wdcl-gov">
          {control.owner} · {control.authority} · needs <b>{control.requiredPosture}</b>
        </p>

        {/* The blast-radius dossier is NOT repeated here: ControlCommit renders
            invariants, bounds, target, payload, reversibility and expiry at the
            moment of confirmation, which is the moment they change a decision.
            What is left is the one thing it does not say — where to look
            afterwards, and the fact that the envelope carries no prior receipt. */}
        {verdict.actionable && (
          <p className="wd-t6 wdcl-proof">
            Watch <b>{control.effectTelemetry.join(' · ')}</b> to prove the effect. The envelope
            publishes <span className="wd-nodata">NO PREVIEW</span> and{' '}
            <span className="wd-nodata">NO RESULT</span> for this control, so the receipt this
            commit returns is the only proof it ran.
          </p>
        )}
      </div>

      <div className="wdcl-action">
        {/* ONE implementation of the action, armed or refused. ControlCommit
            owns the §3.6 gate model, so a refused control still renders its
            correctly-labelled button, sunken and dashed, with the reason wired
            by aria-describedby — never a title-only tooltip. */}
        <ControlCommit
          control={control}
          client={client}
          emergencyPosture={verdict.emergencyPosture}
          disabled={!verdict.actionable}
          disabledReason={verdict.refusal === null ? null : verdict.refusal.say}
          autoFocus={false}
          onRefreshEvidence={onRefreshEvidence}
          onReconciliation={onReconciliation}
          onRecordAttempt={onRecordAttempt}
        />
      </div>
    </div>
  );
}

function IncidentRow({
  incident,
  control,
  verdict,
  nowMs,
  onFocusOwner,
  rowRef,
  client,
  onReconciliation,
  onRecordAttempt,
  onRefreshEvidence,
}: CommitWiring & {
  readonly incident: Readonly<ProductIncidentProjection>;
  readonly control: Readonly<ProductControlRegistryEntry> | undefined;
  readonly verdict: Verdict;
  readonly nowMs: number;
  readonly onFocusOwner: (componentId: string) => void;
  readonly rowRef: (node: HTMLDivElement | null) => void;
}): JSX.Element {
  const whyId = domId('wdcl-why', incident.incidentId);

  return (
    <div className="wdcl-row" data-rung={verdict.rung} ref={rowRef} tabIndex={-1}>
      <span className="wdcl-mark" aria-hidden="true" data-incident={incident.state} />
      <span className="wdcl-glyph" aria-hidden="true"><GlyphIncident /></span>

      <div className="wdcl-identity">
        <p className="wd-t4 wdcl-label">
          {incident.severity} · {incident.state} ·{' '}
          <button
            type="button"
            className="wdcl-jump"
            onClick={() => onFocusOwner(incident.rootComponentId)}
            aria-label={`Focus the owner row for root component ${incident.rootComponentId}`}
          >
            <code className="wd-id">{incident.rootComponentId}</code>
          </button>
          {incident.capitalRelevant && <span className="wdcl-capital"> CAPITAL RELEVANT</span>}
        </p>
        <p className="wd-t6 wdcl-idline">
          <code className="wd-id">{incident.incidentId}</code>
          <span aria-hidden="true"> · </span>
          <code className="wd-id">{incident.reasonCode}</code>
          <span aria-hidden="true"> · </span>
          <span className="wd-num">{incident.count}</span> occurrences, first{' '}
          <Age at={incident.firstSeenAtMs} nowMs={nowMs} never="never" /> ago, last{' '}
          <Age at={incident.lastSeenAtMs} nowMs={nowMs} never="never" /> ago
        </p>

        {/* The server's own recommended operator action, verbatim. */}
        <p className="wd-t5 wdcl-say">{incident.operatorAction}</p>

        <VerdictCell verdict={verdict} whyId={whyId} />

        {/* The most decision-relevant fact on an incident row: whether anyone
            outside this browser tab was told. */}
        <p className="wd-t5 wdcl-routing">
          In-app routing is <b>{incident.routing.inApp.state}</b>, receipt{' '}
          <Identifier kind="rev" value={incident.routing.inApp.receiptId} label="in-app routing receipt" />.
          External paging is <b>{incident.routing.externalPaging.state}</b> ·{' '}
          <b>{incident.routing.externalPaging.blocker}</b> — this fired and nobody outside this tab
          was told.
        </p>
        <p className="wd-t6 wdcl-proof">
          Recovery proof is <b>{incident.recoveryProof.state}</b>
          {incident.recoveryProof.resolvedAtMs === null
            ? <>, with no resolution timestamp published.</>
            : <>, resolved <Age at={incident.recoveryProof.resolvedAtMs} nowMs={nowMs} never="never" /> ago.</>}
          {incident.acknowledgedAtMs !== null && (
            <> Acknowledged <Age at={incident.acknowledgedAtMs} nowMs={nowMs} never="never" /> ago.</>
          )}
          {' '}Correlation{' '}
          <Identifier kind="corr" value={incident.correlationId} label="incident correlation id" />.
        </p>
      </div>

      <div className="wdcl-action">
        {/* No registry entry means there is no command behind this row, and
            FUNCTIONAL OR ABSENT settles it: the chip's reason is the whole
            answer and a dashed affordance for a command that does not exist
            would be decoration. */}
        {control !== undefined && (
          <ControlCommit
            control={control}
            targetId={incident.incidentId}
            expectedRevisionOverride={String(incident.ledgerEventId)}
            client={client}
            emergencyPosture={null}
            disabled={!verdict.actionable}
            disabledReason={verdict.refusal === null ? null : verdict.refusal.say}
            autoFocus={false}
            onRefreshEvidence={onRefreshEvidence}
            onReconciliation={onReconciliation}
            onRecordAttempt={onRecordAttempt}
          />
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------- incident availability */

function IncidentAvailabilityNote({ fact, rowCount }: {
  readonly fact: Fact<ProductIncidentAvailability>;
  readonly rowCount: number;
}): JSX.Element | null {
  const said = (body: ReactNode): JSX.Element => (
    <p className="wdcl-empty wd-t5">{body}</p>
  );

  if (!fact.known || fact.value === null) {
    return said(
      <>
        <b>UNKNOWN</b> — the incident ledger was not read.{' '}
        {fact.reason ?? 'The producer published no reason, which is itself a defect.'}{' '}
        <span className="wd-t6">Source {fact.source}.</span>
      </>,
    );
  }
  if (fact.value.state !== 'AVAILABLE') {
    return said(
      <>
        <b>{fact.value.state}</b> — the supervisor is not publishing incidents on this route, so no
        acknowledgement authority exists here.{' '}
        {fact.value.blocker === null
          ? 'The envelope named no blocker.'
          : <>Blocker <b>{fact.value.blocker}</b>.</>}{' '}
        <span className="wd-t6">Truth {fact.value.truthLabel} · source {fact.source}.</span>
      </>,
    );
  }
  if (rowCount === 0) {
    return said(
      <>
        The incident ledger is <b>AVAILABLE</b> and reports no episodes. This is a measured empty
        set — nothing has fired that the supervisor durably recorded.{' '}
        <span className="wd-t6">Truth {fact.value.truthLabel} · source {fact.source}.</span>
      </>,
    );
  }
  return null;
}

/* ------------------------------------------------------------------ glyphs
   12px, distinguished by TOPOLOGY only, and always --ink-3 (§1.6 rule 2).
   Colouring the gutter is what previously put two states 0.3 Lc apart in dark. */

function GlyphControl(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" focusable="false">
      <path d="M2 3.5h8M2 8.5h8" strokeLinecap="round" />
      <circle cx="4.5" cy="3.5" r="1.4" />
      <circle cx="8" cy="8.5" r="1.4" />
    </svg>
  );
}

function GlyphIncident(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" focusable="false">
      <path d="M6 1.7 11 10.3H1z" strokeLinejoin="round" />
      <path d="M6 5v2.2" strokeLinecap="round" />
      <circle cx="6" cy="8.9" r=".6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function GlyphShip(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" focusable="false">
      <path d="M1.6 6h6.6M5.8 3.6 8.4 6 5.8 8.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.4 2.6v6.8" strokeLinecap="round" />
    </svg>
  );
}

function GlyphLock(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" focusable="false">
      <rect x="2.5" y="5.2" width="7" height="5.3" rx="1" />
      <path d="M4.2 5.2V3.9a1.8 1.8 0 0 1 3.6 0v1.3" strokeLinecap="round" />
    </svg>
  );
}
