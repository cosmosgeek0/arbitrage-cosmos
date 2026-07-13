// ControlsPanel — DASHBOARD_TRUTH item 10: every control maps to one backend
// mutation type, shows what pressing it would do, and renders the before/
// after receipt of the last fired mutation. In fixture mode the injected
// mutate() applies in memory and the receipt honestly reports FIXTURE_APPLIED
// with no ledger event. No decorative controls exist on this panel.

import { useEffect, useRef, useState } from 'react';
import type {
  SystemComponentId,
  SystemControlMutation,
  SystemControlReceipt,
  SystemSafeMode,
  SystemSupervisorSnapshot,
} from '../../../lib/systemIntegration';
import { controlConsequence, words } from '../lib/presentation';
import { Band } from './bits';

const SAFE_MODES: { mode: SystemSafeMode; klass: 'closed' | 'neutral' | 'open' }[] = [
  { mode: 'READ_ONLY', klass: 'closed' },
  { mode: 'ADVISORY', klass: 'neutral' },
  { mode: 'VALIDATE_ONLY', klass: 'open' },
];

function ComponentSelect({
  components,
  value,
  onChange,
  disabled,
}: {
  components: SystemComponentId[];
  value: SystemComponentId | null;
  onChange: (id: SystemComponentId) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="sdx-select" ref={rootRef}>
      <button
        type="button"
        className="sdx-button"
        disabled={disabled || components.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {value ? words(value) : 'Select Component'}
      </button>
      {open && (
        <div className="sdx-select-list" role="listbox">
          {components.map((id) => (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={id === value}
              className={id === value ? 'active' : ''}
              onClick={() => { onChange(id); setOpen(false); }}
            >
              {words(id)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReceiptStrip({ receipt }: { receipt: SystemControlReceipt }) {
  const { before, after } = receipt;
  const changes: string[] = [];
  if (before.safeMode !== after.safeMode) changes.push(`mode ${before.safeMode} → ${after.safeMode}`);
  if (before.killSwitchEngaged !== after.killSwitchEngaged) changes.push(`kill ${before.killSwitchEngaged ? 'ENGAGED' : 'CLEAR'} → ${after.killSwitchEngaged ? 'ENGAGED' : 'CLEAR'}`);
  if (before.intakePaused !== after.intakePaused) changes.push(`intake ${before.intakePaused ? 'PAUSED' : 'OPEN'} → ${after.intakePaused ? 'PAUSED' : 'OPEN'}`);
  if (changes.length === 0) changes.push('control state unchanged');
  return (
    <div className="sdx-receipt" role="status">
      <span>Last Mutation</span>
      <code>{receipt.code}</code>
      <code>{changes.join(' · ')}</code>
      <code>rev {before.revision} → {after.revision}</code>
      {receipt.ledgerEventId === null
        ? <em>NOT LEDGERED — FIXTURE MODE</em>
        : <code>ledger evt {receipt.ledgerEventId}</code>}
    </div>
  );
}

export function ControlsPanel({
  snapshot,
  mutate,
  lastReceipt,
  busy,
}: {
  snapshot: SystemSupervisorSnapshot;
  mutate: (mutation: SystemControlMutation, reason: string) => void;
  lastReceipt: SystemControlReceipt | null;
  busy: boolean;
}) {
  const control = snapshot.control;
  const [confirmingKill, setConfirmingKill] = useState<null | boolean>(null);
  const [previewMode, setPreviewMode] = useState<SystemSafeMode | null>(null);
  const [restartTarget, setRestartTarget] = useState<SystemComponentId | null>(null);
  const restartable = snapshot.components
    .filter((c) => c.supportedControls.includes('RESTART_COMPONENT'))
    .map((c) => c.componentId);

  const killMutation: SystemControlMutation = { command: 'SET_KILL_SWITCH', engaged: !control.killSwitchEngaged };
  const intakeMutation: SystemControlMutation = { command: 'SET_INTAKE_PAUSED', paused: !control.intakePaused };

  return (
    <section className="sdx-section" aria-label="Controls">
      <Band
        title="Controls"
        meta={<span>Every control maps to one supervisor mutation and is shown with its consequence</span>}
      />

      <div className="sdx-control-row">
        <span className="sdx-control-copy">
          <strong>Safe Mode · {control.safeMode}</strong>
          <small>
            {previewMode !== null
              ? `${previewMode}: ${controlConsequence({ command: 'SET_SAFE_MODE', safeMode: previewMode }, snapshot)}`
              : `${nextMode(control.safeMode)}: ${controlConsequence({ command: 'SET_SAFE_MODE', safeMode: nextMode(control.safeMode) }, snapshot)}`}
          </small>
        </span>
        <span className="sdx-control-end">
          <div className="sdx-seg" role="radiogroup" aria-label="Safe mode" onMouseLeave={() => setPreviewMode(null)}>
            {SAFE_MODES.map(({ mode, klass }) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={control.safeMode === mode}
                className={control.safeMode === mode ? `active ${klass}` : ''}
                disabled={busy}
                title={controlConsequence({ command: 'SET_SAFE_MODE', safeMode: mode }, snapshot)}
                onMouseEnter={() => setPreviewMode(mode)}
                onFocus={() => setPreviewMode(mode)}
                onBlur={() => setPreviewMode(null)}
                onClick={() => {
                  if (mode !== control.safeMode) mutate({ command: 'SET_SAFE_MODE', safeMode: mode }, 'Operator mode change from dashboard');
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </span>
      </div>

      <div className="sdx-control-row">
        <span className="sdx-control-copy">
          <strong>Kill Switch · {control.killSwitchEngaged ? 'Engaged' : 'Clear'}</strong>
          <small>{controlConsequence(killMutation, snapshot)}</small>
        </span>
        <span className="sdx-control-end">
          {confirmingKill !== null ? (
            <>
              <button
                type="button"
                className={`sdx-button ${confirmingKill ? 'danger' : 'safe'}`}
                disabled={busy}
                onClick={() => {
                  mutate({ command: 'SET_KILL_SWITCH', engaged: confirmingKill }, 'Operator kill-switch change from dashboard');
                  setConfirmingKill(null);
                }}
              >
                Confirm {confirmingKill ? 'Engage' : 'Release'}
              </button>
              <button type="button" className="sdx-button" disabled={busy} onClick={() => setConfirmingKill(null)}>Cancel</button>
            </>
          ) : control.killSwitchEngaged ? (
            <button type="button" className="sdx-button safe" disabled={busy} onClick={() => setConfirmingKill(false)}>
              Kill Engaged · Release
            </button>
          ) : (
            <button type="button" className="sdx-button danger" disabled={busy} onClick={() => setConfirmingKill(true)}>
              Engage Kill Switch
            </button>
          )}
        </span>
      </div>

      <div className="sdx-control-row">
        <span className="sdx-control-copy">
          <strong>Evidence Intake · {control.intakePaused ? 'Paused' : 'Open'}</strong>
          <small>{controlConsequence(intakeMutation, snapshot)}</small>
        </span>
        <span className="sdx-control-end">
          <div className="sdx-seg" role="radiogroup" aria-label="Evidence intake">
            <button
              type="button"
              role="radio"
              aria-checked={control.intakePaused}
              className={control.intakePaused ? 'active closed' : ''}
              disabled={busy}
              onClick={() => { if (!control.intakePaused) mutate({ command: 'SET_INTAKE_PAUSED', paused: true }, 'Operator paused intake from dashboard'); }}
            >
              Paused
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!control.intakePaused}
              className={!control.intakePaused ? 'active open' : ''}
              disabled={busy}
              onClick={() => { if (control.intakePaused) mutate({ command: 'SET_INTAKE_PAUSED', paused: false }, 'Operator resumed intake from dashboard'); }}
            >
              Open
            </button>
          </div>
        </span>
      </div>

      <div className="sdx-control-row">
        <span className="sdx-control-copy">
          <strong>Component Restart</strong>
          <small>
            {restartTarget
              ? controlConsequence({ command: 'RESTART_COMPONENT', componentId: restartTarget }, snapshot)
              : 'Select a component that supports RESTART_COMPONENT; the consequence is stated before the action arms.'}
          </small>
        </span>
        <span className="sdx-control-end">
          <ComponentSelect
            components={restartable}
            value={restartTarget}
            onChange={setRestartTarget}
            disabled={busy}
          />
          <button
            type="button"
            className="sdx-button danger"
            disabled={busy || restartTarget === null}
            onClick={() => {
              if (restartTarget) mutate({ command: 'RESTART_COMPONENT', componentId: restartTarget }, 'Operator restart from dashboard');
            }}
          >
            Run Restart
          </button>
        </span>
      </div>

      {lastReceipt && <ReceiptStrip receipt={lastReceipt} />}
    </section>
  );
}

function nextMode(mode: SystemSafeMode): SystemSafeMode {
  if (mode === 'READ_ONLY') return 'ADVISORY';
  if (mode === 'ADVISORY') return 'VALIDATE_ONLY';
  return 'READ_ONLY';
}
