import { useState } from 'react';
import { useStore } from '../store';
import { fmtDateTime } from '../format';
import type { AppConfig } from '../types';

const FIELDS: { key: keyof AppConfig; label: string; step: number; help: string }[] = [
  { key: 'feesPct', label: 'Est. round-trip fees %', step: 0.05, help: '4-leg taker cost estimate' },
  { key: 'minNetBasisPct', label: 'Min net edge %', step: 0.05, help: 'required on top of fees' },
  { key: 'persistTicks', label: 'Persistence ticks', step: 1, help: '2s ticks before open/close' },
  { key: 'minQuoteVolume24h', label: 'Min 24h volume (USDT)', step: 500000, help: 'ignore thinner pairs' },
];

export function System() {
  const { snap, config, events, saveConfig, setKill } = useStore();
  const [draft, setDraft] = useState<Partial<AppConfig>>({});
  const [saved, setSaved] = useState(false);

  const feeds = snap?.stats.feeds ?? {};
  const kill = config?.killSwitch ?? true;

  return (
    <>
      <div className="two-col">
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            Kill switch
          </div>
          <div className={`kill-banner ${kill ? 'kill-on' : 'kill-off'}`}>
            <div className="kill-state">{kill ? 'HALTED' : 'ARMED'}</div>
            <p className="muted small">
              {kill
                ? 'All execution is halted. There is no executor in Phase 1 — this flag will gate every order path before one exists.'
                : 'Execution flag is armed. Nothing can trade yet (no executor), but flip this back unless you are testing.'}
            </p>
            <button className={`btn ${kill ? 'btn-green' : 'btn-red'}`} onClick={() => void setKill(!kill)}>
              {kill ? 'Arm execution flag' : 'Halt everything'}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            Data feeds
          </div>
          {Object.entries(feeds).map(([name, status]) => (
            <div key={name} className="feed-status-row">
              <span className={`dot dot-${status}`} />
              <span className="feed-name">{name}</span>
              <span className="muted small">{status}</span>
            </div>
          ))}
          <div className="feed-status-row">
            <span className={`dot ${snap ? 'dot-open' : 'dot-closed'}`} />
            <span className="feed-name">dashboard ↔ engine</span>
            <span className="muted small">{snap ? `updated ${new Date(snap.updatedAt).toLocaleTimeString()}` : 'no data'}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          Scanner configuration
        </div>
        <div className="config-grid">
          {FIELDS.map((f) => (
            <label key={f.key} className="config-field">
              <span className="stat-label">{f.label}</span>
              <input
                type="number"
                step={f.step}
                value={(draft[f.key] as number | undefined) ?? (config ? (config[f.key] as number) : '')}
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
          <span className="muted small">
            Effective signal threshold:{' '}
            <b>
              {(
                ((draft.feesPct ?? config?.feesPct ?? 0) as number) +
                ((draft.minNetBasisPct ?? config?.minNetBasisPct ?? 0) as number)
              ).toFixed(2)}
              %
            </b>{' '}
            gross basis
          </span>
          <button
            className="btn btn-blue"
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
      </div>

      <div className="section-title">Ledger — last {Math.min(events.length, 100)} events</div>
      <div className="card table-card">
        <table className="market-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Kind</th>
              <th>Symbol</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {events.slice(0, 100).map((ev) => (
              <tr key={ev.id}>
                <td className="muted small">{fmtDateTime(ev.ts)}</td>
                <td>
                  <span className={`kind-chip kind-${ev.kind.split('.')[0]}`}>{ev.kind}</span>
                </td>
                <td className="asset-base">{ev.symbol ?? '—'}</td>
                <td className="muted small mono">{ev.data != null ? JSON.stringify(ev.data).slice(0, 110) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 && <div className="empty-inline">Ledger is empty.</div>}
      </div>
    </>
  );
}
