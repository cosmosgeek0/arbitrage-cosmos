import { useState } from 'react';
import { useStore } from '../store';
import { ConfirmModal } from '../components/Modal';
import { fmtPrice, timeAgo } from '../format';
import type { AppConfig } from '../types';

const LIMIT_FIELDS: { key: keyof AppConfig; label: string; help: string }[] = [
  { key: 'maxOrderNotionalUsd', label: 'Max notional per order ($)', help: 'hard cap per single order' },
  { key: 'maxDailyNotionalUsd', label: 'Max daily notional ($)', help: 'sum of all orders per UTC day' },
  { key: 'maxDailyLossUsd', label: 'Max daily loss ($)', help: 'blocks sends after realized loss' },
  { key: 'maxOpenOrders', label: 'Max open orders', help: 'concurrent open orders' },
  { key: 'cooldownSec', label: 'Cooldown (s)', help: 'min seconds between orders' },
  { key: 'staleOrderMaxMin', label: 'Stale order flag (min)', help: 'orders older get flagged' },
];

export function Risk() {
  const { state, saveConfig, setKill, setLive } = useStore();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [allowInput, setAllowInput] = useState('');
  const [blockInput, setBlockInput] = useState('');
  const [modal, setModal] = useState<'resume' | 'arm' | null>(null);
  const [saved, setSaved] = useState(false);

  if (!state) return <div className="page-loading">Connecting…</div>;
  const cfg = state.config;

  const patchList = async (key: 'allowedSymbols' | 'blockedSymbols', list: string[]) => {
    await saveConfig({ [key]: list });
  };

  return (
    <>
      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <b>Kill switch</b>
          </div>
          <div className={`kill-banner ${cfg.killSwitch ? 'kill-on' : 'kill-off'}`}>
            <div className="kill-state">{cfg.killSwitch ? 'HALTED' : 'RUNNING'}</div>
            <p className="muted small">
              {cfg.killSwitch
                ? 'Kill switch is ON. The risk gate rejects every send. Halting is always instant; resuming requires typed confirmation.'
                : 'Kill switch is off. Sends still require live trading to be armed AND every other risk check to pass.'}
            </p>
            {cfg.killSwitch ? (
              <button className="btn btn-green" onClick={() => setModal('resume')}>
                Resume…
              </button>
            ) : (
              <button className="btn btn-red" onClick={() => void setKill(true)}>
                HALT EVERYTHING
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <b>Live trading</b>
          </div>
          <div className={`kill-banner ${cfg.liveTradingEnabled ? 'live-on' : 'kill-neutral'}`}>
            <div className="kill-state">{cfg.liveTradingEnabled ? 'ARMED' : 'DISARMED'}</div>
            <p className="muted small">
              {cfg.liveTradingEnabled
                ? 'The “Send live” button is visible on the trade ticket. Every send still passes the full risk gate + typed confirmation.'
                : 'Live sends are blocked and the send button is hidden. Preview and Validate always work.'}
            </p>
            {cfg.liveTradingEnabled ? (
              <button className="btn btn-ghost" onClick={() => void setLive(false)}>
                Disarm
              </button>
            ) : (
              <button className="btn btn-dark" disabled={cfg.killSwitch} title={cfg.killSwitch ? 'Resume the kill switch first' : ''} onClick={() => setModal('arm')}>
                Arm live trading…
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <b>Limits</b>
          <span className="muted small">
            daily notional used: <b>{fmtPrice(state.risk.dailyNotionalUsedUsd)}</b> / {fmtPrice(cfg.maxDailyNotionalUsd)} · last
            order {state.risk.lastOrderTs ? timeAgo(state.risk.lastOrderTs) : 'never'}
          </span>
        </div>
        <div className="config-grid">
          {LIMIT_FIELDS.map((f) => (
            <label key={f.key} className="config-field">
              <span className="stat-label">{f.label}</span>
              <input
                type="number"
                value={draft[f.key] ?? (cfg[f.key] as number)}
                onChange={(e) => {
                  setSaved(false);
                  setDraft({ ...draft, [f.key]: Number(e.target.value) });
                }}
              />
              <span className="muted small">{f.help}</span>
            </label>
          ))}
        </div>
        <div className="config-actions">
          <span className="muted small">Limits apply server-side inside the risk gate — the UI cannot bypass them.</span>
          <button
            className="btn btn-dark"
            disabled={Object.keys(draft).length === 0}
            onClick={async () => {
              await saveConfig(draft);
              setDraft({});
              setSaved(true);
            }}
          >
            {saved ? 'Saved ✓' : 'Save limits'}
          </button>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <b>Allowed symbols</b>
            <span className="muted small">{cfg.allowedSymbols.length === 0 ? 'EMPTY — all sends rejected' : `${cfg.allowedSymbols.length} allowed`}</span>
          </div>
          <div className="symbol-chips">
            {cfg.allowedSymbols.map((s) => (
              <span key={s} className="sym-chip">
                {s}
                <button onClick={() => void patchList('allowedSymbols', cfg.allowedSymbols.filter((x) => x !== s))}>×</button>
              </span>
            ))}
            {cfg.allowedSymbols.length === 0 && <span className="muted small">Nothing may trade until you add a symbol.</span>}
          </div>
          <div className="import-box">
            <input placeholder="e.g. BTCUSDT" value={allowInput} onChange={(e) => setAllowInput(e.target.value.toUpperCase())} spellCheck={false} />
            <button
              className="btn btn-ghost btn-sm"
              disabled={allowInput.length < 5}
              onClick={async () => {
                await patchList('allowedSymbols', [...cfg.allowedSymbols, allowInput]);
                setAllowInput('');
              }}
            >
              Allow
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <b>Blocked symbols</b>
          </div>
          <div className="symbol-chips">
            {cfg.blockedSymbols.map((s) => (
              <span key={s} className="sym-chip blocked">
                {s}
                <button onClick={() => void patchList('blockedSymbols', cfg.blockedSymbols.filter((x) => x !== s))}>×</button>
              </span>
            ))}
            {cfg.blockedSymbols.length === 0 && <span className="muted small">No blocks. Blocklist beats allowlist.</span>}
          </div>
          <div className="import-box">
            <input placeholder="e.g. DOGEUSDT" value={blockInput} onChange={(e) => setBlockInput(e.target.value.toUpperCase())} spellCheck={false} />
            <button
              className="btn btn-ghost btn-sm"
              disabled={blockInput.length < 5}
              onClick={async () => {
                await patchList('blockedSymbols', [...cfg.blockedSymbols, blockInput]);
                setBlockInput('');
              }}
            >
              Block
            </button>
          </div>
        </div>
      </div>

      {modal === 'resume' && (
        <ConfirmModal
          title="Resume from kill switch"
          requireText="RESUME"
          confirmLabel="Resume"
          onConfirm={async () => {
            await setKill(false);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        >
          <p>
            Turning the kill switch off lets the risk gate evaluate orders again. Live sends stay blocked until you
            also arm live trading.
          </p>
        </ConfirmModal>
      )}
      {modal === 'arm' && (
        <ConfirmModal
          title="Arm live trading"
          requireText="ARM"
          confirmLabel="Arm live trading"
          danger
          onConfirm={async () => {
            await setLive(true);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        >
          <p>
            This shows the “Send live” button on the trade ticket. Real orders with real funds become possible —
            still gated per-order by limits, allowlist, cooldown and a typed confirmation.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}
