import { IconLock } from '../components/Icons';

const PHASES = [
  { n: 1, label: 'Market data + basis scanner (paper)', state: 'now' },
  { n: 2, label: 'Read-only API keys → balances, positions, fills', state: 'next' },
  { n: 3, label: 'Paper brain runs for days, measured honestly', state: 'later' },
  { n: 4, label: 'Approval queue + testnet executor', state: 'later' },
  { n: 5, label: 'Tiny live orders, manual approval only', state: 'later' },
];

export function Portfolio() {
  return (
    <>
      <div className="card lock-card">
        <div className="lock-icon">
          <IconLock size={30} />
        </div>
        <h2>Portfolio unlocks in Phase 2</h2>
        <p className="muted">
          This page will show your Binance balances, open positions, fills and a daily PnL bar — powered by a{' '}
          <b>read-only</b> API key (withdrawals disabled, IP-locked to the server). No key is added until the
          paper scanner has proven itself.
        </p>
        <div className="phase-list">
          {PHASES.map((p) => (
            <div key={p.n} className={`phase-row phase-${p.state}`}>
              <span className="phase-dot">{p.state === 'now' ? '●' : p.n}</span>
              <span>{p.label}</span>
              {p.state === 'now' && <span className="chip chip-blue">current</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="card skeleton-card">
        <div className="stat-label">Preview — what lands here in Phase 2</div>
        <div className="skeleton-value" />
        <div className="skeleton-bars">
          {[38, 62, 45, 80, 55, 70, 30, 90, 65, 50, 75, 42].map((h, i) => (
            <div key={i} className="skeleton-bar" style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="skeleton-rows">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton-row" />
          ))}
        </div>
      </div>
    </>
  );
}
