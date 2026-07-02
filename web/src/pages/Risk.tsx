import { useState } from 'react';
import { useStore } from '../store';
import { ConfirmModal } from '../components/Modal';
import { IconPower, IconShield, IconZapOff } from '../components/RiskIcons';
import { fmtPrice, timeAgo } from '../format';
import type { AppConfig } from '../types';

const LIMIT_FIELDS: { key: keyof AppConfig; label: string; help: string }[] = [
  { key: 'maxOrderNotionalUsd', label: 'Max per order ($)', help: 'hard cap per single order' },
  { key: 'maxDailyNotionalUsd', label: 'Max daily notional ($)', help: 'all orders per UTC day' },
  { key: 'maxDailyLossUsd', label: 'Max daily loss ($)', help: 'blocks sends after realized loss' },
  { key: 'maxOpenOrders', label: 'Max open orders', help: 'concurrent open orders' },
  { key: 'cooldownSec', label: 'Cooldown (s)', help: 'min seconds between orders' },
  { key: 'staleOrderMaxMin', label: 'Stale flag (min)', help: 'older orders get flagged' },
];

const SCANNER_FIELDS: { key: keyof AppConfig; label: string; help: string }[] = [
  { key: 'feesPct', label: 'Est. fees (%)', help: '4-leg taker round trip' },
  { key: 'minNetBasisPct', label: 'Min net edge (%)', help: 'required on top of fees' },
  { key: 'persistTicks', label: 'Persistence (ticks)', help: '2s ticks before open/close' },
  { key: 'minQuoteVolume24h', label: 'Min 24h volume ($)', help: 'ignore thinner pairs' },
];

export function Risk() {
  const { state, saveConfig, setKill, setLive } = useStore();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [allowInput, setAllowInput] = useState('');
  const [blockInput, setBlockInput] = useState('');
  const [modal, setModal] = useState<'resume' | 'arm' | null>(null);
  const [saved, setSaved] = useState(false);

  if (!state) return <div className="container page"><div className="empty-state">Connecting…</div></div>;
  const cfg = state.config;

  const patchList = async (key: 'allowedSymbols' | 'blockedSymbols', list: string[]) => {
    await saveConfig({ [key]: list });
  };

  const fieldGrid = (fields: typeof LIMIT_FIELDS) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
      {fields.map((f) => (
        <div key={f.key} className="fld" style={{ marginBottom: 0 }}>
          <span>{f.label}</span>
          <input
            type="number"
            value={draft[f.key] ?? (cfg[f.key] as number)}
            onChange={(e) => {
              setSaved(false);
              setDraft({ ...draft, [f.key]: Number(e.target.value) });
            }}
          />
          <span className="faint small" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
            {f.help}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="container page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">Risk</h1>
          <div className="page-sub">
            Every limit is enforced server-side inside the risk gate — the UI cannot bypass them
          </div>
        </div>
        <div className="head-actions">
          <span className="sec-note num">
            daily used <b>{fmtPrice(state.risk.dailyNotionalUsedUsd)}</b> / ${cfg.maxDailyNotionalUsd} · last order{' '}
            {state.risk.lastOrderTs ? timeAgo(state.risk.lastOrderTs) : 'never'}
          </span>
        </div>
      </div>

      <div className="settings-sec">Safety controls</div>
      <div className="card pad-0">
        <div className={`arm-row ${cfg.killSwitch ? 'danger' : 'armed'}`}>
          <span className="a-ic">
            <IconPower size={18} />
          </span>
          <div className="arm-body">
            <div className="arm-name">
              Kill switch — {cfg.killSwitch ? <span className="down">HALTED</span> : <span className="up">running</span>}
            </div>
            <div className="arm-sub">
              {cfg.killSwitch
                ? 'Everything is halted; the risk gate rejects every send. Halting is always instant; resuming needs typed confirmation.'
                : 'Halting is instant and always available in the header. Sends still require live arming and every other check.'}
            </div>
          </div>
          {cfg.killSwitch ? (
            <button className="cta-pill" onClick={() => setModal('resume')}>
              Resume…
            </button>
          ) : (
            <button className="cta-pill danger" onClick={() => void setKill(true)}>
              HALT
            </button>
          )}
        </div>

        <div className={`arm-row ${cfg.liveTradingEnabled ? 'armed' : ''}`}>
          <span className="a-ic">
            <IconZapOff size={18} armed={cfg.liveTradingEnabled} />
          </span>
          <div className="arm-body">
            <div className="arm-name">
              Live trading — {cfg.liveTradingEnabled ? <span className="up">ARMED</span> : 'disarmed'}
            </div>
            <div className="arm-sub">
              {cfg.liveTradingEnabled
                ? 'The “Send live” button is visible on the ticket, and loan borrowing is enabled. Every action still passes the full gate + typed confirmation.'
                : 'Live sends and loan borrowing are blocked and hidden. Preview and Validate always work.'}
            </div>
          </div>
          {cfg.liveTradingEnabled ? (
            <button className="mini-btn" onClick={() => void setLive(false)}>
              Disarm
            </button>
          ) : (
            <button
              className="cta-pill"
              disabled={cfg.killSwitch}
              title={cfg.killSwitch ? 'Resume the kill switch first' : ''}
              onClick={() => setModal('arm')}
            >
              Arm live…
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="ch-title">Trading limits</span>
          <button
            className="cta-pill"
            disabled={Object.keys(draft).length === 0}
            onClick={async () => {
              await saveConfig(draft);
              setDraft({});
              setSaved(true);
            }}
          >
            {saved ? 'Saved ✓' : 'Save changes'}
          </button>
        </div>
        {fieldGrid(LIMIT_FIELDS)}
      </div>

      <div className="card">
        <div className="card-head">
          <span className="ch-title">Scanner parameters</span>
          <span className="sec-note">
            effective threshold{' '}
            {((draft.feesPct ?? cfg.feesPct) + (draft.minNetBasisPct ?? cfg.minNetBasisPct)).toFixed(2)}% gross basis
          </span>
        </div>
        {fieldGrid(SCANNER_FIELDS)}
      </div>

      <div className="card">
      <div className="card-head">
        <span className="ch-title">Symbol allowlist</span>
        <span className="sec-note">{cfg.allowedSymbols.length === 0 ? 'EMPTY — every send is rejected' : `${cfg.allowedSymbols.length} allowed`}</span>
      </div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {cfg.allowedSymbols.map((s) => (
          <button key={s} className="chip" onClick={() => void patchList('allowedSymbols', cfg.allowedSymbols.filter((x) => x !== s))} title="Click to remove">
            {s} ×
          </button>
        ))}
        <div className="tsearch">
          <input placeholder="Add e.g. BTCUSDT" value={allowInput} onChange={(e) => setAllowInput(e.target.value.toUpperCase())} spellCheck={false} />
        </div>
        <button
          className="mini-btn"
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
        <span className="ch-title">Blocklist</span>
        <span className="sec-note">blocklist beats allowlist</span>
      </div>
      <div className="chips">
        {cfg.blockedSymbols.map((s) => (
          <button key={s} className="chip active" onClick={() => void patchList('blockedSymbols', cfg.blockedSymbols.filter((x) => x !== s))} title="Click to remove">
            {s} ×
          </button>
        ))}
        <div className="tsearch">
          <input placeholder="Block e.g. DOGEUSDT" value={blockInput} onChange={(e) => setBlockInput(e.target.value.toUpperCase())} spellCheck={false} />
        </div>
        <button
          className="mini-btn"
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
          <p className="muted">
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
          <p className="muted">
            Shows the “Send live” button and enables loan borrowing. Real money becomes possible — still gated
            per-order by limits, allowlist, cooldown and typed confirmations.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
