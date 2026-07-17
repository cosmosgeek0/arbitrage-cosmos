import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PRODUCT_COMMAND_SCHEMA,
  PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX,
  SAFE_LIVE_BACKEND_COMMAND_IDS,
  abortActiveCommandResultRead,
  ambiguousCommandResultReconciliation,
  clearDurableCommandResultIdentity,
  emptyCommandResultReconciliation,
  prepareDurableCommandSubmission,
  readDurableCommandResultIdentity,
  reconcileDurableCommandResult,
  requiresDurableCommandResultReadback,
  uncheckedCommandResultReconciliation,
  type ProductCommandResultIdentity,
  type ProductCommandResultReadback,
  type ProductCommandResultReconciliation,
  type ProductCommandRequest,
  type ProductControlPreview,
  type ProductControlRegistryEntry,
  type ProductControlResult,
} from '../../../lib/productIntegration';
import { canonicalKillSwitchEngagePosture } from '../../../lib/operatorControlPosture';
import { PillSelect } from '../../../components/PillSelect';

export interface ControlRegistryPanelProps {
  readonly controls: readonly Readonly<ProductControlRegistryEntry>[];
  readonly busy: boolean;
  readonly allowFixtureControls?: boolean;
  readonly onPreview: (control: Readonly<ProductControlRegistryEntry>) => Promise<ProductControlPreview>;
  readonly onSubmit: (request: Readonly<ProductCommandRequest>) => Promise<ProductControlResult>;
  readonly onReadCommandResult?: (
    identity: Readonly<ProductCommandResultIdentity>,
    signal?: AbortSignal,
  ) => Promise<ProductCommandResultReadback>;
}

export function controlResultTruthLabel(result: Readonly<ProductControlResult> | null): 'NO_RESULT_TRUTH' | 'SYNTHETIC' | 'CANONICAL' {
  if (result === null) return 'NO_RESULT_TRUTH';
  return result.synthetic ? 'SYNTHETIC' : 'CANONICAL';
}

export function ControlRegistryPanel({
  controls,
  busy,
  allowFixtureControls = false,
  onPreview,
  onSubmit,
  onReadCommandResult,
}: ControlRegistryPanelProps) {
  const [pending, setPending] = useState<ProductControlPreview | null>(null);
  const [result, setResult] = useState<ProductControlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [workingMessage, setWorkingMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('ALL');
  const [reconciliation, setReconciliation] = useState<ProductCommandResultReconciliation>(() => (
    allowFixtureControls ? emptyCommandResultReconciliation() : uncheckedCommandResultReconciliation()
  ));
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const initiatorRef = useRef<HTMLButtonElement | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const reconciliationRequestRef = useRef(0);
  const reconciliationAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (pending) confirmRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    if (!result) return;
    const canonical = controls.find((control) => control.controlId === result.controlId)?.latestResult;
    if (canonical?.commandId === result.commandId && canonical.status !== result.status) setResult(canonical);
  }, [controls, result]);

  const cancelCommandResultRead = useCallback(() => {
    reconciliationRequestRef.current += 1;
    if (!abortActiveCommandResultRead(reconciliationAbortRef.current)) return;
    reconciliationAbortRef.current = null;
    setWorking(false);
    setWorkingMessage(null);
  }, []);

  const reconcileCommandResult = useCallback(async (
    identity: Readonly<ProductCommandResultIdentity>,
    priorResult: Readonly<ProductControlResult> | null,
  ) => {
    const requestId = reconciliationRequestRef.current + 1;
    reconciliationRequestRef.current = requestId;
    if (!onReadCommandResult) {
      setReconciliation(ambiguousCommandResultReconciliation(
        identity,
        priorResult,
        'COMMAND_RESULT_READBACK_NOT_CONFIGURED',
      ));
      return;
    }
    reconciliationAbortRef.current?.abort();
    const controller = new AbortController();
    reconciliationAbortRef.current = controller;
    setWorking(true);
    setWorkingMessage(`Reading durable result for ${identity.controlId}.`);
    setError(null);
    try {
      const next = await reconcileDurableCommandResult(
        identity,
        priorResult,
        async (query) => {
          let readback: ProductCommandResultReadback;
          try {
            readback = await onReadCommandResult(query, controller.signal);
          } catch (cause) {
            if (controller.signal.aborted || reconciliationRequestRef.current !== requestId) {
              throw Object.freeze({ code: 'COMMAND_RESULT_READBACK_CANCELLED' });
            }
            throw cause;
          }
          if (controller.signal.aborted || reconciliationRequestRef.current !== requestId) {
            throw Object.freeze({ code: 'COMMAND_RESULT_READBACK_CANCELLED' });
          }
          return readback;
        },
      );
      if (reconciliationRequestRef.current !== requestId) return;
      setReconciliation(next);
      if (next.result !== null) setResult(next.result);
      if (next.state === 'AMBIGUOUS') {
        setError(`Command result remains ambiguous (${next.reasonCode}).`);
      } else if (next.state === 'INVALID_DURABLE_STATE') {
        setError(`Durable command result state is unverifiable (${next.reasonCode}); another command remains blocked.`);
      }
    } finally {
      if (reconciliationRequestRef.current === requestId) {
        if (reconciliationAbortRef.current === controller) reconciliationAbortRef.current = null;
        setWorking(false);
        setWorkingMessage(null);
      }
    }
  }, [onReadCommandResult]);

  useEffect(() => {
    if (allowFixtureControls) {
      setReconciliation(emptyCommandResultReconciliation());
      return undefined;
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const restored = readDurableCommandResultIdentity();
      setReconciliation(restored);
      if (restored.state === 'PENDING') void reconcileCommandResult(restored.identity, null);
    });
    return () => {
      active = false;
      cancelCommandResultRead();
    };
  }, [allowFixtureControls, cancelCommandResultRead, reconcileCommandResult]);

  useEffect(() => {
    if (allowFixtureControls) return undefined;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX)) return;
      cancelCommandResultRead();
      const restored = readDurableCommandResultIdentity();
      setReconciliation(restored);
      if (restored.state === 'PENDING') void reconcileCommandResult(restored.identity, null);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [allowFixtureControls, cancelCommandResultRead, reconcileCommandResult]);

  const restoreInitiatorFocus = () => {
    window.requestAnimationFrame(() => initiatorRef.current?.focus());
  };

  const preview = async (control: Readonly<ProductControlRegistryEntry>, initiator: HTMLButtonElement) => {
    initiatorRef.current = initiator;
    if (control.wiringState === 'WIRED_LIVE' && !allowFixtureControls) {
      const durable = readDurableCommandResultIdentity();
      setReconciliation(durable);
      if (reconciliationBlocksCommands(durable)) {
        setError(`A durable command result is unresolved (${durable.state}). Recheck it before another command.`);
        return;
      }
    }
    setWorking(true); setWorkingMessage(`Loading preview for ${control.label}.`); setError(null); setResult(null);
    try {
      const nextPreview = await onPreview(control);
      if (control.wiringState === 'WIRED_LIVE' && nextPreview.synthetic) throw new Error('LIVE_CONTROL_RETURNED_SYNTHETIC_PREVIEW');
      if (control.wiringState === 'WIRED_FIXTURE' && !nextPreview.synthetic) throw new Error('FIXTURE_CONTROL_RETURNED_NON_SYNTHETIC_PREVIEW');
      idempotencyKeyRef.current = `ui:${control.controlId}:${crypto.randomUUID()}`;
      setPending(nextPreview);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Control preview failed.'); restoreInitiatorFocus(); }
    finally { setWorking(false); setWorkingMessage(null); }
  };
  const submit = async () => {
    if (!pending) return;
    if (pending.expiresAtMs <= Date.now()) {
      setPending(null);
      idempotencyKeyRef.current = null;
      setError('Control preview expired. Request a new preview before submitting.');
      restoreInitiatorFocus();
      return;
    }
    const control = controls.find((entry) => entry.controlId === pending.controlId);
    if (!control) { setError('The previewed control is no longer in the registry.'); return; }
    if (reconciliationBlocksCommands(reconciliation)) {
      setError(`A durable command result is unresolved (${reconciliation.state}). Recheck it before another command.`);
      return;
    }
    setWorking(true); setWorkingMessage(`Submitting ${control.label}.`); setError(null);
    let durableIdentity: Readonly<ProductCommandResultIdentity> | null = null;
    try {
      const idempotencyKey = idempotencyKeyRef.current ?? `ui:${control.controlId}:${crypto.randomUUID()}`;
      const request: Readonly<ProductCommandRequest> = Object.freeze({
        schemaVersion: PRODUCT_COMMAND_SCHEMA,
        idempotencyKey,
        controlId: control.controlId,
        backendCommandId: control.backendCommandId,
        targetType: control.targetType,
        targetId: control.targetId,
        payload: control.payload,
        currentRevision: control.currentStateRevision,
        expectedRevision: pending.expectedRevision,
        previewId: pending.previewId,
        previewDigest: pending.digest,
        expiresAtMs: pending.expiresAtMs,
        reason: `Operator confirmed ${control.controlId} from the Control Room.`,
      });
      if (control.wiringState === 'WIRED_LIVE') {
        const prepared = await prepareDurableCommandSubmission(idempotencyKey, control.controlId);
        durableIdentity = prepared.identity;
        setReconciliation(prepared.reconciliation);
        if (prepared.reconciliation.state !== 'PENDING') {
          setError(`Command was not sent because durable result identity could not be proven (${prepared.reconciliation.reasonCode}).`);
          return;
        }
      }
      const next = await onSubmit(request);
      if (control.wiringState === 'WIRED_LIVE' && next.synthetic) throw new Error('LIVE_CONTROL_RETURNED_SYNTHETIC_RESULT');
      if (control.wiringState === 'WIRED_FIXTURE' && !next.synthetic) throw new Error('FIXTURE_CONTROL_RETURNED_NON_SYNTHETIC_RESULT');
      if (durableIdentity !== null
        && (next.commandId !== durableIdentity.commandId || next.controlId !== durableIdentity.controlId)) {
        throw new Error('LIVE_CONTROL_RESULT_IDENTITY_MISMATCH');
      }
      setResult(next);
      setPending(null);
      idempotencyKeyRef.current = null;
      restoreInitiatorFocus();
      if (control.wiringState === 'WIRED_LIVE' && requiresDurableCommandResultReadback(next)) {
        await reconcileCommandResult(durableIdentity!, next);
      } else if (control.wiringState === 'WIRED_LIVE') {
        const terminal = clearDurableCommandResultIdentity(durableIdentity!, next);
        setReconciliation(terminal);
        if (terminal.state === 'INVALID_DURABLE_STATE') {
          setError(`Terminal result is proven, but durable query state could not be cleared (${terminal.reasonCode}).`);
        }
      }
    } catch (cause) {
      if (durableIdentity !== null) {
        const durable = readDurableCommandResultIdentity();
        setReconciliation(durable.state === 'PENDING'
          && durable.identity.commandId === durableIdentity.commandId
          && durable.identity.idempotencyKey === durableIdentity.idempotencyKey
          && durable.identity.controlId === durableIdentity.controlId
          ? ambiguousCommandResultReconciliation(
              durableIdentity,
              null,
              'CONTROL_SUBMIT_RESULT_AMBIGUOUS',
            )
          : durable);
        setPending(null);
        idempotencyKeyRef.current = null;
        restoreInitiatorFocus();
      }
      setError(cause instanceof Error ? cause.message : 'Control submission failed.');
    }
    finally { setWorking(false); setWorkingMessage(null); }
  };

  const cancel = () => {
    setPending(null);
    idempotencyKeyRef.current = null;
    setError(null);
    restoreInitiatorFocus();
  };
  const groups = Array.from(new Set(controls.map((control) => control.group)));
  const resultReadBlocked = reconciliationBlocksCommands(reconciliation);
  const resultReadReason = resultReadBlocked
    ? `Durable command result is ${reconciliation.state}${reconciliation.reasonCode ? ` · ${reconciliation.reasonCode}` : ''}.`
    : null;
  const filteredControls = controls.filter((control) => {
    const haystack = `${control.controlId} ${control.backendCommandId} ${control.label} ${control.owner}`.toLowerCase();
    return (group === 'ALL' || control.group === group) && haystack.includes(query.trim().toLowerCase());
  }).sort((left, right) => (left.controlId === 'global.kill-switch.engage' ? -1 : right.controlId === 'global.kill-switch.engage' ? 1 : 0));

  return (
    <section className="pcr-section" aria-label="Control Registry" aria-busy={busy || working}>
      <header className="pcr-band"><h2>Control Registry</h2><span>{controls.length} Entries · Live Route Requires WIRED_LIVE</span></header>
      <div className="pcr-control-filters">
        <label>Search Controls<input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
        <label>
          Control Family
          <PillSelect
            value={group}
            options={['ALL', ...groups].map((entry) => ({
              id: entry,
              label: entry === 'ALL' ? 'All Families' : entry,
            }))}
            onChange={setGroup}
            ariaLabel="Control Family"
            className="pcr-control-family"
          />
        </label>
        <span role="status">{filteredControls.length} Shown</span>
      </div>
      <div className="pcr-working-status" role="status" aria-live="polite">{workingMessage ?? (result ? `${result.controlId} ${result.status}` : '')}</div>
      <div className="pcr-control-list">
        {filteredControls.map((control) => {
          const safeLiveCommand = SAFE_LIVE_BACKEND_COMMAND_IDS.includes(control.backendCommandId);
          const functional = control.wiringState === 'WIRED_LIVE'
            ? safeLiveCommand
            : allowFixtureControls && control.wiringState === 'WIRED_FIXTURE';
          const emergency = control.controlId === 'global.kill-switch.engage';
          const emergencyPosture = emergency ? canonicalKillSwitchEngagePosture(control) : null;
          const emergencyEngaged = emergencyPosture?.engaged === true;
          const actionable = functional
            && control.disabledReason === null
            && !resultReadBlocked
            && (emergencyPosture?.actionAllowed ?? true);
          const disabledReason = workingMessage ?? resultReadReason ?? emergencyPosture?.disabledReason ?? control.disabledReason ?? (!functional
            ? (control.wiringState === 'WIRED_LIVE' && !safeLiveCommand ? 'COMMAND_OUTSIDE_IP_CONTROL_NON_MONEY_ALLOWLIST' : `${control.wiringState} is not functional in this route.`)
            : control.confirmationText);
          const buttonLabel = emergencyPosture?.buttonLabel ?? `Preview ${control.label}`;
          return (
            <article className={`pcr-control${emergency ? ' pcr-emergency-control' : ''}${emergencyEngaged ? ' engaged' : ''}`} key={control.controlId} aria-label={control.label}>
              <div className="pcr-control-head">
                <span><strong>{control.label}</strong><small>{control.explanation}</small></span>
                <span className={`pcr-wiring ${functional ? 'wired' : 'disabled'}`}>{control.wiringState}</span>
              </div>
              <dl className="pcr-control-facts">
                <div><dt>Control ID</dt><dd><code>{control.controlId}</code></dd></div>
                <div><dt>Backend Command</dt><dd><code>{control.backendCommandId}</code></dd></div>
                <div><dt>Target</dt><dd><code>{control.targetType}:{control.targetId}</code></dd></div>
                <div><dt>Payload</dt><dd><code>{JSON.stringify(control.payload)}</code></dd></div>
                <div><dt>Payload Schema / Enumeration</dt><dd><code>{control.payloadSchema} · {JSON.stringify(control.payloadEnumeration)}</code></dd></div>
                <div><dt>Default</dt><dd><code>{JSON.stringify(control.defaultValue)}</code></dd></div>
                <div><dt>Owner</dt><dd>{control.owner}</dd></div>
                <div><dt>Safe Bounds</dt><dd>{control.safeBounds}</dd></div>
                <div><dt>Desired / Effective</dt><dd>{control.currentDesiredValue} / {control.currentEffectiveValue}</dd></div>
                <div><dt>Authority</dt><dd>{control.authority}</dd></div>
                <div><dt>Required Posture / Expiry</dt><dd>{control.requiredPosture} · {control.expiryPolicy}</dd></div>
                <div><dt>Reversibility</dt><dd>{control.reversibility}</dd></div>
                <div><dt>Invariants</dt><dd>{control.invariants.join(' · ')}</dd></div>
                <div><dt>Effect Telemetry</dt><dd>{control.effectTelemetry.join(' · ')}</dd></div>
                <div><dt>Current Revision</dt><dd><code>{control.currentStateRevision}</code></dd></div>
                <div><dt>Effect</dt><dd>{control.effect}</dd></div>
                <div><dt>Preview / Revision</dt><dd><code>{control.preview?.digest ?? 'UNAVAILABLE'} · {control.preview?.expectedRevision ?? 'UNKNOWN'}</code></dd></div>
                <div><dt>Result / Receipt</dt><dd><code>{control.latestResult?.status ?? 'NO_RESULT'} · {control.latestResult?.receiptId ?? 'NO_RECEIPT'} · {controlResultTruthLabel(control.latestResult)}</code></dd></div>
              </dl>
              <div className="pcr-control-action">
                <span id={`reason-${control.controlId}`}>{disabledReason}</span>
                <button
                  type="button"
                  disabled={busy || working || !actionable}
                  aria-disabled={busy || working || !actionable}
                  aria-label={buttonLabel}
                  aria-describedby={`reason-${control.controlId}`}
                  onClick={(event) => void preview(control, event.currentTarget)}
                >{buttonLabel.replace('Preview ', '')}</button>
              </div>
              {pending?.controlId === control.controlId && (
                <div className="pcr-confirm" role="group" aria-labelledby={`pcr-confirm-title-${control.controlId}`} aria-describedby={`pcr-confirm-consequence-${control.controlId}`}>
                  <span><strong id={`pcr-confirm-title-${control.controlId}`}>Confirm {pending.controlId}</strong><small id={`pcr-confirm-consequence-${control.controlId}`}>{pending.consequence}</small></span>
                  <code>{pending.digest}</code><code>{pending.expectedRevision}</code><code>Expires {new Date(pending.expiresAtMs).toLocaleTimeString()}</code>
                  <button ref={confirmRef} type="button" disabled={busy || working} onClick={() => void submit()}>Confirm Revision</button>
                  <button type="button" disabled={busy || working} onClick={cancel}>Cancel</button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {reconciliation.state !== 'NONE' && (
        <div className={`pcr-command-reconciliation state-${reconciliation.state.toLowerCase()}`} role={resultReadBlocked ? 'alert' : 'status'}>
          <strong>Durable Command Result</strong>
          <span>{reconciliation.state}</span>
          {reconciliation.identity && <code>{reconciliation.identity.commandId} · {reconciliation.identity.controlId}</code>}
          {reconciliation.reasonCode && <code>{reconciliation.reasonCode}</code>}
          {reconciliation.identity && onReadCommandResult && (
            <button
              type="button"
              disabled={busy || working}
              onClick={() => void reconcileCommandResult(reconciliation.identity!, reconciliation.result)}
            >Recheck Result</button>
          )}
        </div>
      )}
      {result && <div className={`pcr-result result-${result.status.toLowerCase()}`}><strong>{result.status}</strong><span>{result.before} → {result.after}</span><code>{result.receiptId ?? 'NO_RECEIPT'}</code><em>{controlResultTruthLabel(result)}</em></div>}
      {error && <div className="pcr-error" role="alert">{error}</div>}
    </section>
  );
}

function reconciliationBlocksCommands(value: Readonly<ProductCommandResultReconciliation>): boolean {
  return value.state === 'PENDING' || value.state === 'AMBIGUOUS' || value.state === 'INVALID_DURABLE_STATE';
}
