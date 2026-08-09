/* =============================================================================
   ControlCommit — one control's complete lifecycle machine.

   preview -> revision-drift invalidation -> confirm -> durable identity ->
   commit -> result validation -> receipt -> durable readback -> re-read.

   The operator question, and the only one this file answers:
     "If I press this, exactly what will happen — in the server's own words —
      and afterwards, did it actually land, with which receipt?"

   Composition (BIBLE):
     §1.7  motion durations / curve      §3.2  Identifier (every hash + id)
     §3.6  Button, the gate model        §3.11 InfoRow, the two registers
     §3.19 the live-data layer           §3.20 the kill-switch treatment

   Three deliberate, argued positions — each recorded here so the next author
   does not "fix" them back into a defect:

   1. NO StatusChip. §3.1 owns the *health* vocabulary
      (READY/DEGRADED/BLOCKED/…). A ControlResultStatus is a *receipt*
      vocabulary published by the server (APPLIED, REJECTED_BOUNDS,
      FAILED_ATTENTION_REQUIRED). Mapping one onto the other would be exactly
      the derived health verdict the page forbids, so the receipt renders the
      server's status word verbatim and takes its severity from the §1.6 fill
      ladder alone.  §3.1 is not in this component's compose list for that
      reason.
   2. NO extra live region. The page owns exactly one (§4.7). Every outcome
      here is user-initiated and returns focus to the initiator, so the
      initiator carries `aria-describedby` -> note + receipt. The outcome is
      announced by the focus move, once, deterministically — strictly better
      than a second polite region that fires on every poll-driven re-render.
      role="alert" appears only where §3.6 licenses it: a decision in flight
      that has just been invalidated.
   3. NO focus-out cancel. §3.6's arm window is a *local* 5s timer; this
      preview is a server-issued authority with its own TTL and digest.
      Discarding it because the pointer moved would throw away a real server
      grant. Escape cancels; the server's expiry withdraws. Nothing else.
   ========================================================================== */

import {
  useCallback, useEffect, useId, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  PRODUCT_COMMAND_SCHEMA,
  ProductBindingError,
  clearDurableCommandResultIdentity,
  prepareDurableCommandSubmission,
  readDurableCommandResultIdentity,
  reconcileDurableCommandResult,
  requiresDurableCommandResultReadback,
  type ProductCommandRequest,
  type ProductCommandResultIdentity,
  type ProductCommandResultReconciliation,
  type ProductControlPreview,
  type ProductControlRegistryEntry,
  type ProductControlResult,
  type ProductIntegrationClient,
} from '../../lib/productIntegration';
import type { CanonicalKillSwitchEngagePosture } from '../../lib/operatorControlPosture';
import type { Attempt } from './watchdogEvidence';
import { Identifier } from './MachineValue';
import './ControlCommit.css';

/* -- shared with ControlLedger's command mutex --------------------------------
   The mutex at the head of the control ledger and the commit inside a row are
   the same fact read from the same durable key. One implementation, exported,
   so a second one can never drift from it. */

export function commandMutexBlocks(
  reconciliation: Readonly<ProductCommandResultReconciliation>,
): boolean {
  return reconciliation.state === 'PENDING'
    || reconciliation.state === 'AMBIGUOUS'
    || reconciliation.state === 'INVALID_DURABLE_STATE';
}

/**
 * GET /v1/commands/:commandId/result, reconciled against the durable key.
 *
 * This is the ONE implementation of the readback. ControlLedger's mutex
 * "Recheck" and this component's post-commit readback call the same function,
 * so the mutex and the commit can never disagree about what the durable record
 * says — and the attempt lands in the transcript either way.
 */
export async function recheckDurableCommandResult({
  client,
  identity,
  priorResult,
  signal,
  onRecordAttempt,
}: {
  readonly client: Readonly<ProductIntegrationClient>;
  readonly identity: Readonly<ProductCommandResultIdentity>;
  readonly priorResult: Readonly<ProductControlResult> | null;
  readonly signal: AbortSignal;
  readonly onRecordAttempt: (attempt: Omit<Attempt, 'id'>) => void;
}): Promise<ProductCommandResultReconciliation> {
  const startedAtMs = Date.now();
  const next = await reconcileDurableCommandResult(identity, priorResult, async (query) => {
    const readback = await client.readCommandResult(query, signal);
    // A cancelled read must not be mistaken for a proven absence of result.
    if (signal.aborted) throw Object.freeze({ code: 'COMMAND_RESULT_READBACK_CANCELLED' });
    return readback;
  });
  recordAttempt(onRecordAttempt, 'control-readback', 'GET',
    `/v1/commands/${identity.commandId}/result`, next.state, startedAtMs,
    `${identity.controlId}${next.reasonCode === null ? '' : ` · ${next.reasonCode}`}`);
  return next;
}

/**
 * Every attempt this component records.
 *
 * `status` carries an OUTCOME TOKEN, not an HTTP status, and that is a
 * measurement rather than a shortcut: `ProductIntegrationClient` resolves a
 * validated body or throws a `ProductBindingError`, and never surfaces the HTTP
 * status for the preview, submit or readback routes. Writing `200` because a
 * promise resolved would be a number nobody measured (§5 law 1). So the token
 * is the strongest thing that WAS measured — the server's own result status
 * (`APPLIED`, `REJECTED_BOUNDS`), its own error codes, or the reconciliation
 * state — and `detail` carries the sentence behind it.
 */
function recordAttempt(
  sink: (attempt: Omit<Attempt, 'id'>) => void,
  kind: string,
  method: string,
  path: string,
  status: string,
  startedAtMs: number,
  detail: string,
): void {
  const atMs = Date.now();
  sink({ atMs, kind, method, path, status, elapsedMs: atMs - startedAtMs, detail });
}

/* -- local vocabulary --------------------------------------------------------- */

type CommitPhase = 'IDLE' | 'PREVIEWING' | 'ARMED' | 'SUBMITTING' | 'READING_BACK' | 'SETTLED';

/** bare -> tint -> solid. The ladder survives a monochrome screenshot (§1.6). */
type OutcomeRung = 'settled' | 'inflight' | 'refused' | 'failed';

interface Note {
  /** `steady` is a standing refusal; `adverse` interrupted a decision in flight. */
  readonly tone: 'steady' | 'adverse';
  readonly text: string;
  readonly code: string | null;
}

const REVISION_DRIFT_MESSAGE = 'Control revision changed. Request a new preview before confirming.';
const PREVIEW_EXPIRED_MESSAGE = 'Control preview expired. Request a new preview before confirming.';
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

/**
 * The server publishes the status; this maps it to a fill mass, and to nothing
 * else. Every rung is justified by the result contract itself
 * (controlResultValidation.ts), never by taste:
 *   settled  — terminal, and the ledger event exists (or is not published for it)
 *   inflight — ACCEPTED_ASYNC: the durable readback, not this render, owns truth
 *   refused  — REJECTED_* / EXPIRED / FAILED_RECOVERABLE: no state advanced
 *   failed   — FAILED_ATTENTION_REQUIRED: the machine's state is NOT proven
 */
function outcomeRung(status: ProductControlResult['status']): OutcomeRung {
  if (status === 'APPLIED' || status === 'ALREADY_APPLIED') return 'settled';
  if (status === 'ACCEPTED_ASYNC') return 'inflight';
  if (status === 'FAILED_ATTENTION_REQUIRED') return 'failed';
  return 'refused';
}

/* DELETED AT INTEGRATION: `receiptIsPublishedFor`, never called. Its intent —
   naming WHY a status carries no receipt instead of printing a bare NO_RECEIPT —
   is already discharged at the render site, which prints the server's own status
   beside the literal sentence "no ledger event is published for <status>". */

function failureCode(cause: unknown): string {
  if (cause instanceof ProductBindingError && cause.codes.length > 0) return cause.codes.join(' · ');
  if (cause instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(cause.message)) return cause.message;
  return 'CONTROL_COMMAND_FAILED';
}

function failureText(cause: unknown): string {
  if (cause instanceof ProductBindingError) {
    return `${cause.message} (${cause.codes.join(' · ') || 'NO_CODE_PUBLISHED'})`;
  }
  return cause instanceof Error ? cause.message : 'Control command failed with no message.';
}

/**
 * §3.11 has no absent case: if a sentence claims something about the system,
 * something proves it. A registry field the owner left empty is therefore
 * STATED as empty rather than rendered as a blank row.
 */
function said(value: string, absent: string): { readonly text: string; readonly proven: boolean } {
  return value.trim().length > 0
    ? { text: value.trim(), proven: true }
    : { text: absent, proven: false };
}

/** An instant, never an age: this component holds no clock, and a wrong age is
 *  worse than a right timestamp (see the dashboard-age-clock regression). */
function instant(atMs: number): string {
  return new Date(atMs).toLocaleTimeString([], { hour12: false });
}

/* -- glyphs: 12px, --ink-3 always, distinguished by topology only (§1.6 r.2) --- */

function BindingGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <rect x="1.6" y="1.6" width="8.8" height="8.8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 4v2.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="6" cy="8.4" r=".7" fill="currentColor" />
    </svg>
  );
}

function AdvisoryGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 5.4v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="6" cy="3.6" r=".7" fill="currentColor" />
    </svg>
  );
}

/* -- props -------------------------------------------------------------------- */

export interface ControlCommitProps {
  readonly control: ProductControlRegistryEntry;
  /** Overrides `control.targetId` for per-target rows (an incident ACK). */
  readonly targetId?: string;
  /** Overrides `control.currentStateRevision` (an incident's ledgerEventId). */
  readonly expectedRevisionOverride?: string;
  readonly client: Readonly<ProductIntegrationClient>;
  readonly emergencyPosture: CanonicalKillSwitchEngagePosture | null;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
  readonly autoFocus: boolean;
  readonly onRefreshEvidence: () => Promise<void>;
  readonly onReconciliation: (r: ProductCommandResultReconciliation) => void;
  readonly onRecordAttempt: (a: Omit<Attempt, 'id'>) => void;
}

export function ControlCommit({
  control,
  targetId,
  expectedRevisionOverride,
  client,
  emergencyPosture,
  disabled,
  disabledReason,
  autoFocus,
  onRefreshEvidence,
  onReconciliation,
  onRecordAttempt,
}: ControlCommitProps): JSX.Element {
  const [phase, setPhase] = useState<CommitPhase>('IDLE');
  const [preview, setPreview] = useState<ProductControlPreview | null>(null);
  const [result, setResult] = useState<ProductControlResult | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [readback, setReadback] = useState<ProductCommandResultReconciliation | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const initiatorRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const armedRevisionRef = useRef<string | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const readbackAbortRef = useRef<AbortController | null>(null);
  const expiryTimerRef = useRef<number | null>(null);
  const requestSeqRef = useRef(0);

  const ids = useId();
  const noteId = `${ids}note`;
  const refusalId = `${ids}refusal`;
  const receiptId = `${ids}receipt`;
  const regionId = `${ids}region`;
  const consequenceId = `${ids}consequence`;
  const confirmTextId = `${ids}confirmtext`;

  const revision = expectedRevisionOverride ?? control.currentStateRevision;
  const effectiveTargetId = targetId ?? control.targetId;

  /* -- what this control is allowed to be, and why not ------------------------
     Order matters: the caller's verdict first (it owns the mutex and the page
     posture), then the two facts only this component can prove. */
  const wiredLive = control.wiringState === 'WIRED_LIVE';
  const postureRefusal = emergencyPosture !== null && !emergencyPosture.actionAllowed
    ? emergencyPosture.disabledReason
    : null;
  const refusal: string | null = disabled
    ? disabledReason
    : postureRefusal
      ?? control.disabledReason
      ?? (wiredLive ? null : `Control is ${control.wiringState}; only WIRED_LIVE issues a canonical command.`);
  const armable = !disabled && postureRefusal === null && control.disabledReason === null && wiredLive;

  // Law: an adverse state with no reason is a defect, not a style. Say so, in
  // production, in the DOM — and shout once in development.
  const refusalIsUnexplained = !armable && (refusal === null || refusal.trim().length === 0);
  useEffect(() => {
    if (!refusalIsUnexplained) return;
    // Unconditional, not dev-gated: a refusal with no reason is a registry
    // defect an operator may have to explain from a console trace afterwards.
    // eslint-disable-next-line no-console
    console.error(`[ControlCommit] ${control.controlId} is refused with no reason (REFUSAL_REASON_MISSING).`);
  }, [control.controlId, refusalIsUnexplained]);

  const escalated = emergencyPosture !== null || control.effect === 'RESTART';
  const busy = phase === 'PREVIEWING' || phase === 'SUBMITTING' || phase === 'READING_BACK';

  /* -- focus ------------------------------------------------------------------
     User-initiated outcomes always return focus to the initiator. The expiry
     timer only does so when focus is still inside this component — a timer
     that yanks focus out of whatever the operator is now reading is a defect
     of its own. */
  const restoreInitiatorFocus = useCallback((onlyIfWithin = false) => {
    if (onlyIfWithin) {
      const active = document.activeElement;
      if (!(active instanceof Node) || rootRef.current === null || !rootRef.current.contains(active)) return;
    }
    window.requestAnimationFrame(() => initiatorRef.current?.focus());
  }, []);

  const clearExpiryTimer = useCallback(() => {
    if (expiryTimerRef.current !== null) window.clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = null;
  }, []);

  const dropPreview = useCallback(() => {
    clearExpiryTimer();
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    requestSeqRef.current += 1;
    idempotencyKeyRef.current = null;
    armedRevisionRef.current = null;
    setPreview(null);
  }, [clearExpiryTimer]);

  useEffect(() => () => {
    clearExpiryTimer();
    previewAbortRef.current?.abort();
    readbackAbortRef.current?.abort();
  }, [clearExpiryTimer]);

  // Confirm is auto-focused the moment the server's preview lands: the decision
  // is now the only thing on the operator's path.
  useEffect(() => {
    if (phase === 'ARMED') confirmRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (autoFocus) initiatorRef.current?.focus();
  }, [autoFocus]);

  /* -- revision drift ---------------------------------------------------------
     The envelope re-polls every 5s underneath an open preview. A preview taken
     against a revision the server has since moved past is not a preview of
     what would now happen — it is dropped, with the literal sentence. */
  useEffect(() => {
    if (armedRevisionRef.current === null || armedRevisionRef.current === revision) return;
    // Once the command has left the browser, a moving revision is the EXPECTED
    // consequence of the command itself. Invalidating an in-flight submit here
    // would report drift for the very change the operator just asked for.
    if (phase === 'SUBMITTING' || phase === 'READING_BACK') return;
    dropPreview();
    setPhase('IDLE');
    setNote({ tone: 'adverse', text: REVISION_DRIFT_MESSAGE, code: 'CONTROL_REVISION_DRIFT' });
    restoreInitiatorFocus();
  }, [dropPreview, phase, restoreInitiatorFocus, revision]);

  const record = useCallback((
    kind: string,
    method: string,
    path: string,
    status: string,
    startedAtMs: number,
    detail: string,
  ) => {
    recordAttempt(onRecordAttempt, kind, method, path, status, startedAtMs, detail);
  }, [onRecordAttempt]);

  /* -- 1 · PREVIEW ------------------------------------------------------------- */

  const requestPreview = useCallback(async (initiator: HTMLButtonElement) => {
    initiatorRef.current = initiator;
    /* A REFUSED control is `aria-disabled`, not `disabled` — deliberately, so it
       stays focusable and pressable. Pressing it therefore has to MATERIALISE
       the refusal rather than return silently: RecoveryConsole already presses
       through into a `BLOCKED_BY_POSTURE` receipt for exactly this reason, and
       two write lanes answering the same interaction two different ways is how
       an operator learns that some controls on this page just do nothing. */
    if (!armable) {
      setNote({
        tone: 'adverse',
        code: 'CONTROL_REFUSED',
        text: refusalIsUnexplained
          ? `REFUSAL_REASON_MISSING · ${control.controlId} is refused and the registry entry carries no reason. Nothing was previewed and nothing was sent.`
          : `${refusal ?? 'REFUSAL_REASON_MISSING'} No preview was requested and nothing was sent.`,
      });
      return;
    }
    if (busy) {
      setNote({
        tone: 'adverse',
        code: 'COMMAND_ALREADY_IN_FLIGHT',
        text: `This control is already in ${phase.toLowerCase().replaceAll('_', ' ')}. The press was refused so a second request cannot race the first; nothing was sent.`,
      });
      return;
    }

    // The durable mutex is read at the instant of the press, not at the last
    // render: an unresolved result from any tab blocks every new command.
    const durable = readDurableCommandResultIdentity();
    onReconciliation(durable);
    if (commandMutexBlocks(durable)) {
      setNote({
        tone: 'adverse',
        code: `COMMAND_MUTEX_${durable.state}`,
        text: `A durable command result is unresolved (${durable.state}${durable.reasonCode ? ` · ${durable.reasonCode}` : ''}). Resolve it at the command mutex before another command is sent.`,
      });
      return;
    }

    // Minted BEFORE the request: a control id this browser cannot express as a
    // canonical idempotency key can never be committed, so nothing is spent
    // discovering that after the preview.
    const idempotencyKey = `ui:${control.controlId}:${crypto.randomUUID()}`;
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      setNote({
        tone: 'adverse',
        code: 'COMMAND_RESULT_IDENTITY_INPUT_INVALID',
        text: `No preview was requested: a canonical idempotency key cannot be minted for control id ${control.controlId}.`,
      });
      return;
    }

    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;

    clearExpiryTimer();
    setPreview(null);
    setResult(null);
    setReadback(null);
    setNote(null);
    setPhase('PREVIEWING');
    const startedAtMs = Date.now();
    try {
      const next = await client.previewCommand(control.controlId, revision, effectiveTargetId, controller.signal);
      if (controller.signal.aborted || requestSeqRef.current !== seq) return;
      // The client validates the echo; this re-validates it against what THIS
      // press asked for, which is the only thing the operator saw.
      if (next.controlId !== control.controlId || next.expectedRevision !== revision) {
        throw new Error('CONTROL_PREVIEW_REVISION_MISMATCH');
      }
      if (next.synthetic) throw new Error('LIVE_CONTROL_RETURNED_SYNTHETIC_PREVIEW');

      idempotencyKeyRef.current = idempotencyKey;
      armedRevisionRef.current = revision;
      setPreview(next);
      setPhase('ARMED');
      record('control-preview', 'POST', '/v1/commands/preview', 'PREVIEW_ISSUED', startedAtMs,
        `${control.controlId} · digest ${next.digest} · expires ${instant(next.expiresAtMs)}`);

      // The server's TTL, honoured locally so a stale authority can never be
      // pressed. The withdrawal is the only thing this component eases.
      expiryTimerRef.current = window.setTimeout(() => {
        expiryTimerRef.current = null;
        dropPreview();
        setPhase('IDLE');
        setNote({ tone: 'adverse', text: PREVIEW_EXPIRED_MESSAGE, code: 'CONTROL_PREVIEW_EXPIRED' });
        restoreInitiatorFocus(true);
      }, Math.max(0, next.expiresAtMs - Date.now()));
    } catch (cause) {
      if (controller.signal.aborted || requestSeqRef.current !== seq) return;
      setPhase('IDLE');
      setNote({ tone: 'adverse', code: failureCode(cause), text: failureText(cause) });
      record('control-preview', 'POST', '/v1/commands/preview', failureCode(cause), startedAtMs,
        `${control.controlId} · ${failureText(cause)}`);
      restoreInitiatorFocus();
    } finally {
      if (previewAbortRef.current === controller) previewAbortRef.current = null;
    }
  }, [armable, busy, phase, refusal, refusalIsUnexplained, clearExpiryTimer, client, control.controlId,
    dropPreview, effectiveTargetId, onReconciliation, record, restoreInitiatorFocus, revision]);

  /* -- 3 · DURABLE READBACK ---------------------------------------------------- */

  const readDurableResult = useCallback(async (
    identity: Readonly<ProductCommandResultIdentity>,
    priorResult: Readonly<ProductControlResult> | null,
  ) => {
    readbackAbortRef.current?.abort();
    const controller = new AbortController();
    readbackAbortRef.current = controller;
    setPhase('READING_BACK');
    try {
      // recheckDurableCommandResult records the attempt itself: one readback,
      // one transcript entry, whoever asked for it.
      const next = await recheckDurableCommandResult({
        client, identity, priorResult, signal: controller.signal, onRecordAttempt,
      });
      onReconciliation(next);
      setReadback(next);
      if (next.result !== null) setResult(next.result);
      if (next.state === 'AMBIGUOUS') {
        setNote({
          tone: 'adverse',
          code: next.reasonCode,
          text: `The command was sent and its outcome is still not proven (${next.reasonCode}). Recheck it at the command mutex before issuing another.`,
        });
      } else if (next.state === 'INVALID_DURABLE_STATE') {
        setNote({
          tone: 'adverse',
          code: next.reasonCode,
          text: `Durable command-result state is unverifiable (${next.reasonCode}); every further command stays blocked until it is resolved.`,
        });
      } else if (next.state === 'PENDING') {
        setNote({
          tone: 'steady',
          code: 'COMMAND_RESULT_PENDING',
          text: 'The command was accepted and its durable result is still pending. Recheck it at the command mutex.',
        });
      }
    } finally {
      if (readbackAbortRef.current === controller) readbackAbortRef.current = null;
      setPhase('SETTLED');
    }
  }, [client, onReconciliation, onRecordAttempt]);

  /* -- 2 · CONFIRM ------------------------------------------------------------- */

  const confirm = useCallback(async () => {
    const armedPreview = preview;
    if (armedPreview === null || phase !== 'ARMED') return;

    if (armedPreview.expiresAtMs <= Date.now()) {
      dropPreview();
      setPhase('IDLE');
      setNote({ tone: 'adverse', text: PREVIEW_EXPIRED_MESSAGE, code: 'CONTROL_PREVIEW_EXPIRED' });
      restoreInitiatorFocus();
      return;
    }
    if (armedPreview.expectedRevision !== revision) {
      dropPreview();
      setPhase('IDLE');
      setNote({ tone: 'adverse', text: REVISION_DRIFT_MESSAGE, code: 'CONTROL_REVISION_DRIFT' });
      restoreInitiatorFocus();
      return;
    }
    const idempotencyKey = idempotencyKeyRef.current;
    if (idempotencyKey === null) {
      dropPreview();
      setPhase('IDLE');
      setNote({
        tone: 'adverse',
        code: 'COMMAND_IDEMPOTENCY_KEY_MISSING',
        text: 'Command was not sent: the idempotency key minted with this preview is gone. Request a new preview.',
      });
      restoreInitiatorFocus();
      return;
    }

    setPhase('SUBMITTING');
    setNote(null);
    const startedAtMs = Date.now();
    let identity: Readonly<ProductCommandResultIdentity> | null = null;
    let reachedNetwork = false;
    try {
      // Durable identity is proven BEFORE the network call. If the browser
      // cannot promise it will be able to ask "what happened?", the command is
      // not sent at all.
      const prepared = await prepareDurableCommandSubmission(idempotencyKey, control.controlId);
      identity = prepared.identity;
      onReconciliation(prepared.reconciliation);
      setReadback(prepared.reconciliation);
      if (prepared.reconciliation.state !== 'PENDING') {
        const reasonCode = prepared.reconciliation.reasonCode ?? prepared.reconciliation.state;
        identity = null;
        dropPreview();
        setPhase('IDLE');
        setNote({
          tone: 'adverse',
          code: reasonCode,
          text: `Command was not sent because durable result identity could not be proven (${reasonCode}).`,
        });
        restoreInitiatorFocus();
        return;
      }

      const request: Readonly<ProductCommandRequest> = Object.freeze({
        schemaVersion: PRODUCT_COMMAND_SCHEMA,
        idempotencyKey,
        controlId: control.controlId,
        backendCommandId: control.backendCommandId,
        targetType: control.targetType,
        targetId: effectiveTargetId,
        payload: control.payload,              // VERBATIM. Never composed here.
        currentRevision: revision,
        expectedRevision: armedPreview.expectedRevision,
        previewId: armedPreview.previewId,
        previewDigest: armedPreview.digest,
        expiresAtMs: armedPreview.expiresAtMs,
        reason: `Operator confirmed ${control.controlId} from the Watchdog control ledger.`,
      });

      reachedNetwork = true;
      // No AbortSignal: a mutation in flight is never cancelled. The durable
      // identity, not an abort, is how an unknown outcome is resolved.
      const submitted = await client.submitCommand(request);
      if (submitted.synthetic) throw new Error('LIVE_CONTROL_RETURNED_SYNTHETIC_RESULT');
      if (submitted.commandId !== identity.commandId || submitted.controlId !== identity.controlId) {
        throw new Error('LIVE_CONTROL_RESULT_IDENTITY_MISMATCH');
      }

      record('control-commit', 'POST', '/v1/commands', submitted.status, startedAtMs,
        `${control.controlId} · ${submitted.before} → ${submitted.after} · ${submitted.receiptId ?? 'NO_RECEIPT'}`);

      dropPreview();
      setResult(submitted);
      setPhase('SETTLED');
      restoreInitiatorFocus();

      if (requiresDurableCommandResultReadback(submitted)) {
        await readDurableResult(identity, submitted);
      } else {
        const cleared = clearDurableCommandResultIdentity(identity, submitted);
        onReconciliation(cleared);
        setReadback(cleared);
        if (cleared.state === 'INVALID_DURABLE_STATE') {
          setNote({
            tone: 'adverse',
            code: cleared.reasonCode,
            text: `The result is proven, but the durable query state could not be cleared (${cleared.reasonCode}); further commands stay blocked.`,
          });
        }
      }
    } catch (cause) {
      if (reachedNetwork) {
        record('control-commit', 'POST', '/v1/commands', failureCode(cause), startedAtMs,
          `${control.controlId} · ${failureText(cause)}`);
      }
      if (identity !== null) {
        // The request left this browser and the answer did not come back. That
        // is AMBIGUOUS — never "failed", and never retried automatically.
        const durable = readDurableCommandResultIdentity();
        const stillOurs = durable.state === 'PENDING'
          && durable.identity.commandId === identity.commandId
          && durable.identity.idempotencyKey === identity.idempotencyKey
          && durable.identity.controlId === identity.controlId;
        const next = stillOurs
          ? await recheckDurableCommandResult({
            client, identity, priorResult: null, signal: new AbortController().signal, onRecordAttempt,
          })
          : durable;
        onReconciliation(next);
        setReadback(next);
        if (next.result !== null) setResult(next.result);
      }
      dropPreview();
      setPhase(result === null ? 'IDLE' : 'SETTLED');
      setNote({ tone: 'adverse', code: failureCode(cause), text: failureText(cause) });
      restoreInitiatorFocus();
    } finally {
      if (reachedNetwork) {
        // Parity doctrine §14.2, without exception: after an action, re-read
        // the evidence. A 200 is a claim; the next envelope is the proof — and
        // a failed submit is exactly when re-reading matters most.
        await onRefreshEvidence();
      }
    }
  }, [client, control.backendCommandId, control.controlId, control.payload, control.targetType,
    dropPreview, effectiveTargetId, onReconciliation, onRefreshEvidence, phase, preview,
    readDurableResult, record, restoreInitiatorFocus, result, revision]);

  const cancel = useCallback(() => {
    dropPreview();
    setPhase(result === null ? 'IDLE' : 'SETTLED');
    setNote(null);
    restoreInitiatorFocus();
  }, [dropPreview, restoreInitiatorFocus, result]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    if (phase !== 'ARMED' && phase !== 'PREVIEWING') return;
    // Consumed here so the ledger row does not also collapse: cancelling the
    // open command is unambiguously what Escape means while one is armed.
    event.stopPropagation();
    event.preventDefault();
    cancel();
  }, [cancel, phase]);

  /* -- render ------------------------------------------------------------------ */

  const previewLabel = emergencyPosture?.buttonLabel ?? `Preview ${control.label}`;
  const outcomeLabel = emergencyPosture !== null
    ? emergencyPosture.buttonLabel.replace(/^Preview\s+/, '')
    : control.label;

  // The three sentences the preview region is contractually required to carry.
  // An owner who published none still gets a row — carrying that fact.
  const confirmationSay = said(control.confirmationText,
    'The control owner published no confirmation text for this command.');
  const reversibilitySay = said(control.reversibility,
    'The control owner published no reversibility statement for this command.');
  const expirySay = said(control.expiryPolicy,
    'The control owner published no expiry policy; the instant beside this row is the server\u2019s own.');

  const refusalBody = refusalIsUnexplained
    ? 'REFUSAL_REASON_MISSING · this control is refused and the refusal carries no reason. Treat the registry entry as defective.'
    : refusal;

  const describedBy = [
    refusalBody !== null ? refusalId : null,
    note !== null ? noteId : null,
    result !== null ? receiptId : null,
  ].filter((entry): entry is string => entry !== null).join(' ') || undefined;

  return (
    <div
      ref={rootRef}
      className="wdcx"
      data-phase={phase}
      onKeyDown={onKeyDown}
    >
      <div className="wdcx-cluster wdb-cluster">
        <button
          ref={initiatorRef}
          type="button"
          className={`wdb wdb--sm wdcx-initiator${phase === 'PREVIEWING' ? ' is-pending' : ''}`}
          aria-disabled={!armable || busy}
          aria-busy={phase === 'PREVIEWING'}
          aria-describedby={describedBy}
          onClick={(event) => { void requestPreview(event.currentTarget); }}
        >
          <span className="wdb-label">{previewLabel}</span>
          <span className="wdb-spin" aria-hidden="true" />
        </button>
      </div>

      {refusalBody !== null && (
        <p
          id={refusalId}
          className="wdcx-note wd-t5"
          data-tone="steady"
          data-defect={refusalIsUnexplained ? 'true' : undefined}
        >
          {refusalBody}
        </p>
      )}

      {note !== null && (
        <p
          id={noteId}
          className="wdcx-note wd-t5"
          data-tone={note.tone}
          role={note.tone === 'adverse' ? 'alert' : undefined}
        >
          {note.text}
          {note.code !== null && <span className="wdcx-note-code"> {note.code}</span>}
        </p>
      )}

      {emergencyPosture !== null && (
        <p className="wdcx-frozen wd-t5">
          <span className="wdcx-frozen-word">ENGAGE ONLY</span>
          {' '}
          {emergencyPosture.engaged
            ? 'The kill switch is ENGAGED. This candidate publishes no release command, so it cannot be cleared from this page.'
            : 'This candidate publishes an engage command and no release command. Engaging cannot be undone from this page.'}
        </p>
      )}

      {/* NOT `.wdf-region` below. §4.4 licenses exactly ONE bounded surface per
          page and WatchdogSurface has spent it on the whole CONTROL cluster,
          which this sits inside — the shell's stylesheet already revoked the
          class here at (0,3,0), so it painted nothing. A class asking for a
          surface that provably cannot exist is decoration. */}
      {(phase === 'ARMED' || phase === 'SUBMITTING') && preview !== null && (
        <div
          className="wdcx-preview"
          role="group"
          aria-labelledby={regionId}
          aria-describedby={consequenceId}
        >
          <p id={regionId} className="wdcx-eyebrow wd-t3">
            Server preview · <span className="wd-id">{control.controlId}</span>
          </p>

          <p id={consequenceId} className="wdcx-consequence wd-t4">{preview.consequence}</p>

          <ul className="gdx-list wdcx-guidance">
            <li className="gdx-row" data-register="binding">
              <span className="gdx-glyph"><BindingGlyph /></span>
              <span className="gdx-body">
                <span className="gdx-say wd-t5">{confirmationSay.text}</span>
              </span>
              <span className="gdx-prov">{confirmationSay.proven ? 'registry' : 'not stated'}</span>
            </li>
            <li className="gdx-row" data-register="binding">
              <span className="gdx-glyph"><BindingGlyph /></span>
              <span className="gdx-body">
                <span className="gdx-say wd-t5">{reversibilitySay.text}</span>
                <span className="gdx-why wd-t6">Reversibility, as published by the control owner.</span>
              </span>
              <span className="gdx-prov">{reversibilitySay.proven ? 'registry' : 'not stated'}</span>
            </li>
            <li className="gdx-row" data-register="advisory">
              <span className="gdx-glyph"><AdvisoryGlyph /></span>
              <span className="gdx-body">
                <span className="gdx-say wd-t5">{expirySay.text}</span>
              </span>
              <span className="gdx-prov">{instant(preview.expiresAtMs)}</span>
            </li>
          </ul>

          <dl className="wd-fields wdcx-fields">
            <div className="wd-field">
              <dt className="wd-field-label wd-t3">Effect</dt>
              <dd className="wd-field-body"><span className="wd-field-value wd-t4">{control.effect}</span></dd>
            </div>
            <div className="wd-field">
              <dt className="wd-field-label wd-t3">Target</dt>
              <dd className="wd-field-body">
                <span className="wd-field-value wd-t4">
                  {control.targetType} · <span className="wd-id">{effectiveTargetId}</span>
                </span>
              </dd>
            </div>
            <div className="wd-field">
              <dt className="wd-field-label wd-t3">Payload sent verbatim</dt>
              <dd className="wd-field-body">
                <span className="wd-field-value wd-t4 wdcx-payload">{JSON.stringify(control.payload)}</span>
              </dd>
            </div>
            <div className="wd-field">
              <dt className="wd-field-label wd-t3">Safe bounds</dt>
              <dd className="wd-field-body"><span className="wd-field-value wd-t4">{control.safeBounds}</span></dd>
            </div>
            <div className="wd-field">
              <dt className="wd-field-label wd-t3">Backend command</dt>
              <dd className="wd-field-body">
                <span className="wd-field-value wd-t4"><span className="wd-id">{control.backendCommandId}</span></span>
              </dd>
            </div>
            <div className="wd-field">
              <dt className="wd-field-label wd-t3">Expected revision</dt>
              <dd className="wd-field-body">
                <span className="wd-field-value wd-t4"><Identifier kind="rev" value={preview.expectedRevision} label="expected control revision" /></span>
              </dd>
            </div>
            <div className="wd-field">
              <dt className="wd-field-label wd-t3">Preview digest</dt>
              <dd className="wd-field-body">
                <span className="wd-field-value wd-t4"><Identifier kind="digest" value={preview.digest} label="preview digest" /></span>
              </dd>
            </div>
            {/* No "expires" field: the advisory guidance row above already
                carries the owner's expiry policy AND the measured instant in
                its provenance track. Printing the same instant twice is the
                box-filling this page exists to refuse. */}
          </dl>

          <div className="wdcx-invariants">
            <p className="wd-t3">Invariants the owner asserts</p>
            {control.invariants.length > 0 ? (
              <ul className="wdcx-invariant-list">
                {control.invariants.map((invariant) => (
                  <li key={invariant} className="wd-t5">{invariant}</li>
                ))}
              </ul>
            ) : (
              /* A measured empty set is a complete answer — but it is an ANSWER,
                 and it says which one it is. */
              <p className="wd-t5 wd-nodata">
                None. <code className="wd-id">controls[].invariants</code> is empty for this
                control, so the owner asserts nothing that must hold across the command.
              </p>
            )}
          </div>

          <div className="wdcx-commit wdb-cluster">
            <button
              ref={confirmRef}
              type="button"
              className={`wdb wdb--sm is-armed ${escalated ? 'wdb--destructive' : 'wdb--primary'}${phase === 'SUBMITTING' ? ' is-pending' : ''}`}
              aria-describedby={`${consequenceId} ${confirmTextId}`}
              aria-disabled={phase !== 'ARMED'}
              aria-busy={phase === 'SUBMITTING'}
              onClick={() => { void confirm(); }}
            >
              <span className="wdb-label">{outcomeLabel}</span>
              <span className="wdb-spin" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="wdb wdb--sm wdb--tertiary"
              aria-disabled={phase === 'SUBMITTING'}
              aria-describedby={phase === 'SUBMITTING' ? `${ids}inflight` : undefined}
              onClick={() => { if (phase !== 'SUBMITTING') cancel(); }}
            >
              <span className="wdb-label">Cancel</span>
            </button>
            {/* A refused control states its reason as DOM text, always — an
                aria-disabled button with a silent reason is the defect §5 L3
                exists to stop. */}
            {phase === 'SUBMITTING' && (
              <p id={`${ids}inflight`} className="wdcx-note wd-t5" data-tone="steady">
                The command has left this browser and cannot be cancelled. Its outcome is
                settled by the durable receipt, not by this page.
              </p>
            )}
            <span id={confirmTextId} className="sr-only">
              {`${control.confirmationText} Payload ${JSON.stringify(control.payload)} against revision ${preview.expectedRevision}.`}
            </span>
          </div>
        </div>
      )}

      <div id={receiptId} className="wdcx-receipt-slot">
        {result === null ? (armable && (
          /* The mutex exists because commanding the same control twice is the
             failure mode. So the resting state answers that question first. */
          <p className="wdcx-empty wd-t6 wd-nodata">
            NO RESULT · this control has not been commanded from this browser session.
          </p>
        )) : (
          <div className="wdcx-receipt" data-outcome={outcomeRung(result.status)}>
            <p className="wdcx-outcome wd-t4">{result.status}</p>
            <p className="wdcx-transition wd-t5">
              <span className="wdcx-state">{result.before}</span>
              <span className="wdcx-arrow" aria-hidden="true"> → </span>
              <span className="sr-only"> became </span>
              <span className="wdcx-state">{result.after}</span>
            </p>
            <p className="wdcx-receipt-id wd-t5">
              {result.receiptId !== null
                ? <Identifier kind="ref" value={result.receiptId} label="ledger receipt id" />
                : (
                  <span className="wd-nodata">
                    NO_RECEIPT · no ledger event is published for {result.status}.
                  </span>
                )}
            </p>
            <p className="wdcx-truth wd-t6">
              {result.synthetic ? 'SYNTHETIC' : 'CANONICAL'}
              <span className="wdcx-sep" aria-hidden="true"> · </span>
              completed <span className="wd-num">{instant(result.completedAtMs)}</span>
            </p>
            <p className="wdcx-correlation wd-t6">
              correlation <Identifier kind="corr" value={result.correlationId} label="command correlation id" />
            </p>
            {readback !== null && readback.state !== 'NONE' && (
              <p className="wdcx-durable wd-t6">
                durable readback {readback.state}
                {readback.reasonCode !== null && <> · {readback.reasonCode}</>}
              </p>
            )}
          </div>
        )}
      </div>

      {(control.preview !== null || control.latestResult !== null) && (
        <p className="wdcx-note wd-t6" data-tone="steady">
          The registry published a
          {control.preview !== null ? ' preview' : ''}
          {control.preview !== null && control.latestResult !== null ? ' and a' : ''}
          {control.latestResult !== null ? ' result' : ''}
          {' '}object on this control. This surface does not treat either as evidence: a preview
          is only valid when this browser requested it, and a result is only valid against a
          durable identity this browser minted.
        </p>
      )}
    </div>
  );
}
