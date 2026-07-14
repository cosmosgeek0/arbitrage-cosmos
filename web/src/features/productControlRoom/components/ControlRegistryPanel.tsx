import { useEffect, useRef, useState } from 'react';
import {
  PRODUCT_COMMAND_SCHEMA,
  SAFE_LIVE_BACKEND_COMMAND_IDS,
  type ProductCommandRequest,
  type ProductControlPreview,
  type ProductControlRegistryEntry,
  type ProductControlResult,
} from '../../../lib/productIntegration';
import { canonicalKillSwitchEngagePosture } from '../../../lib/canonicalCockpitTruth';
import { PillSelect } from '../../../components/PillSelect';

export interface ControlRegistryPanelProps {
  readonly controls: readonly Readonly<ProductControlRegistryEntry>[];
  readonly busy: boolean;
  readonly allowFixtureControls?: boolean;
  readonly onPreview: (control: Readonly<ProductControlRegistryEntry>) => Promise<ProductControlPreview>;
  readonly onSubmit: (request: Readonly<ProductCommandRequest>) => Promise<ProductControlResult>;
}

export function controlResultTruthLabel(result: Readonly<ProductControlResult> | null): 'NO_RESULT_TRUTH' | 'SYNTHETIC' | 'CANONICAL' {
  if (result === null) return 'NO_RESULT_TRUTH';
  return result.synthetic ? 'SYNTHETIC' : 'CANONICAL';
}

export function ControlRegistryPanel({ controls, busy, allowFixtureControls = false, onPreview, onSubmit }: ControlRegistryPanelProps) {
  const [pending, setPending] = useState<ProductControlPreview | null>(null);
  const [result, setResult] = useState<ProductControlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [workingMessage, setWorkingMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('ALL');
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const initiatorRef = useRef<HTMLButtonElement | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (pending) confirmRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    if (!result) return;
    const canonical = controls.find((control) => control.controlId === result.controlId)?.latestResult;
    if (canonical?.commandId === result.commandId && canonical.status !== result.status) setResult(canonical);
  }, [controls, result]);

  const restoreInitiatorFocus = () => {
    window.requestAnimationFrame(() => initiatorRef.current?.focus());
  };

  const preview = async (control: Readonly<ProductControlRegistryEntry>, initiator: HTMLButtonElement) => {
    initiatorRef.current = initiator;
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
    setWorking(true); setWorkingMessage(`Submitting ${control.label}.`); setError(null);
    try {
      const next = await onSubmit({
        schemaVersion: PRODUCT_COMMAND_SCHEMA,
        idempotencyKey: idempotencyKeyRef.current ?? `ui:${control.controlId}:${crypto.randomUUID()}`,
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
      if (control.wiringState === 'WIRED_LIVE' && next.synthetic) throw new Error('LIVE_CONTROL_RETURNED_SYNTHETIC_RESULT');
      if (control.wiringState === 'WIRED_FIXTURE' && !next.synthetic) throw new Error('FIXTURE_CONTROL_RETURNED_NON_SYNTHETIC_RESULT');
      setResult(next); setPending(null); idempotencyKeyRef.current = null; restoreInitiatorFocus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Control submission failed.'); }
    finally { setWorking(false); setWorkingMessage(null); }
  };

  const cancel = () => {
    setPending(null);
    idempotencyKeyRef.current = null;
    setError(null);
    restoreInitiatorFocus();
  };
  const groups = Array.from(new Set(controls.map((control) => control.group)));
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
            && (emergencyPosture?.actionAllowed ?? true);
          const disabledReason = workingMessage ?? emergencyPosture?.disabledReason ?? control.disabledReason ?? (!functional
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
      {result && <div className={`pcr-result result-${result.status.toLowerCase()}`}><strong>{result.status}</strong><span>{result.before} → {result.after}</span><code>{result.receiptId ?? 'NO_RECEIPT'}</code><em>{controlResultTruthLabel(result)}</em></div>}
      {error && <div className="pcr-error" role="alert">{error}</div>}
    </section>
  );
}
