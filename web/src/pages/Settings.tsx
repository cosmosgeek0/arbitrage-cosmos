import { useStore } from '../store';
import { SetupChecklist, StatusDot } from '../components/ui';

export function Settings() {
  const { state, theme, setTheme } = useStore();
  if (!state) return <div className="container page"><div className="empty-state">Connecting…</div></div>;

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">Keys, appearance and how this thing is built</div>
        </div>
      </div>

      <div className="sec-head">
        <h2 className="sec-title">Appearance</h2>
      </div>
      <div className="drow">
        <span className="k">Theme</span>
        <span className="v">
          <span className="seg">
            <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>
              Light
            </button>
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>
              Dark
            </button>
          </span>
        </span>
      </div>
      <div className="drow">
        <span className="k">Keyboard</span>
        <span className="v muted small">⌘K / “/” search · Esc closes overlays</span>
      </div>

      <div className="sec-head">
        <h2 className="sec-title">Binance API keys</h2>
      </div>
      <div className="drow">
        <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot status={state.binance.keysPresent ? 'live' : 'none'} /> Status
        </span>
        <span className="v">{state.binance.keysPresent ? 'configured in server environment' : 'not configured'}</span>
      </div>
      <p className="muted small" style={{ lineHeight: 1.6, maxWidth: 720 }}>
        There is deliberately no key input in this UI. Keys live in <span className="mono">.env</span> on the server
        (see <span className="mono">.env.example</span>) and the server signs every request — the browser never sees
        key material. To rotate: update <span className="mono">.env</span>, restart the service.
      </p>
      {!state.binance.keysPresent && <SetupChecklist />}

      <div className="sec-head">
        <h2 className="sec-title">About</h2>
      </div>
      <p className="muted" style={{ lineHeight: 1.65, maxWidth: 760 }}>
        Cosmos Arbitrage Control Room — private cockpit for one Binance account, behind Cloudflare Access. Live
        execution is manual-only: strategies propose, you approve, the server-side risk gate decides, a typed
        confirmation sends. Loans follow the same gate. No withdrawal or transfer code exists anywhere in this app.
        Every decision is in the Ledger. All configuration persists in SQLite and every change is a{' '}
        <span className="mono">config_change</span> event.
      </p>
      <div className="chips">
        <span className="chip-tag gold">v1 · control room + markets + loans</span>
        <span className="chip-tag">next: two-leg basis ticket via testnet</span>
      </div>
    </div>
  );
}
