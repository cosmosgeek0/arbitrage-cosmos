import { useEffect, useState } from 'react';
import { StoreProvider, useStore, type Page } from './store';
import { Dashboard } from './pages/Dashboard';
import { Account } from './pages/Account';
import { ManualTrade } from './pages/ManualTrade';
import { Strategies } from './pages/Strategies';
import { Opportunities } from './pages/Opportunities';
import { Orders } from './pages/Orders';
import { Positions } from './pages/Positions';
import { Fills } from './pages/Fills';
import { Pnl } from './pages/Pnl';
import { Risk } from './pages/Risk';
import { LedgerPage } from './pages/LedgerPage';
import { Settings } from './pages/Settings';
import {
  IconBook,
  IconBrain,
  IconChart,
  IconGear,
  IconGrid,
  IconLayers,
  IconList,
  IconPower,
  IconRadar,
  IconReceipt,
  IconShield,
  IconTicket,
  IconWallet,
} from './components/Icons';

const NAV: { group: string | null; items: { id: Page; label: string; icon: JSX.Element }[] }[] = [
  {
    group: null,
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: <IconGrid /> },
      { id: 'account', label: 'Account', icon: <IconWallet /> },
    ],
  },
  {
    group: 'Trading',
    items: [
      { id: 'trade', label: 'Manual Trade', icon: <IconTicket /> },
      { id: 'orders', label: 'Orders', icon: <IconList /> },
      { id: 'positions', label: 'Positions', icon: <IconLayers /> },
      { id: 'fills', label: 'Fills', icon: <IconReceipt /> },
    ],
  },
  {
    group: 'Intelligence',
    items: [
      { id: 'strategies', label: 'Strategies', icon: <IconBrain /> },
      { id: 'opportunities', label: 'Opportunities', icon: <IconRadar /> },
    ],
  },
  {
    group: 'Control',
    items: [
      { id: 'pnl', label: 'PnL', icon: <IconChart /> },
      { id: 'risk', label: 'Risk', icon: <IconShield /> },
      { id: 'ledger', label: 'Ledger', icon: <IconBook /> },
      { id: 'settings', label: 'Settings', icon: <IconGear /> },
    ],
  },
];

const TITLES: Record<Page, string> = {
  dashboard: 'Dashboard',
  account: 'Account',
  trade: 'Manual Trade',
  strategies: 'Strategies',
  opportunities: 'Opportunities',
  orders: 'Orders',
  positions: 'Positions',
  fills: 'Fills',
  pnl: 'PnL',
  risk: 'Risk',
  ledger: 'Ledger',
  settings: 'Settings',
};

const MODE_LABEL: Record<string, string> = {
  HALTED: 'HALTED',
  MANUAL: 'MANUAL · live off',
  LIVE_ARMED: 'LIVE ARMED',
};

function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="utc-clock mono">{now.toISOString().slice(11, 19)} UTC</span>;
}

function Shell() {
  const { state, connected, page, setPage, setKill } = useStore();
  const mode = state?.mode ?? 'HALTED';
  const binanceOk = state?.binance.keysPresent && state.binance.connected;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo" onClick={() => setPage('dashboard')}>
          <span className="logo-mark" />
          <div>
            <div className="logo-name">COSMOS</div>
            <div className="logo-sub">Arbitrage Control Room</div>
          </div>
        </div>
        <nav>
          {NAV.map((g, i) => (
            <div key={i} className="nav-group">
              {g.group && <div className="nav-group-title">{g.group}</div>}
              {g.items.map((n) => (
                <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
                  {n.icon}
                  {n.label}
                  {n.id === 'opportunities' && (state?.proposals.length ?? 0) > 0 && (
                    <span className="nav-badge">{state!.proposals.length}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot muted small">private · one account · no withdrawals</div>
      </aside>

      <nav className="bottom-nav">
        {(['dashboard', 'trade', 'risk', 'ledger'] as Page[]).map((id) => (
          <button key={id} className={`bottom-nav-item ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}>
            {TITLES[id]}
          </button>
        ))}
      </nav>

      <div className="main">
        <header className="topbar">
          <h1>{TITLES[page]}</h1>
          <div className="topbar-right">
            <UtcClock />
            <span className={`pill mode-${mode.toLowerCase()}`}>{MODE_LABEL[mode] ?? mode}</span>
            <span
              className={`pill ${state?.binance.keysPresent ? (binanceOk ? 'pill-ok' : 'pill-bad') : 'pill-idle'}`}
              title={state?.binance.lastError ?? undefined}
            >
              Binance {state?.binance.keysPresent ? (binanceOk ? 'connected' : 'error') : 'no keys'}
            </span>
            <span className={`pill ${connected ? 'pill-ok' : 'pill-bad'}`}>
              <span className="dot-inline" /> {connected ? 'Live' : 'Reconnecting'}
            </span>
            {mode === 'HALTED' ? (
              <button className="pill pill-halted" onClick={() => setPage('risk')} title="Resume on the Risk page">
                <IconPower size={13} /> Halted
              </button>
            ) : (
              <button className="halt-btn" onClick={() => void setKill(true)} title="Instant kill switch">
                <IconPower size={13} /> HALT
              </button>
            )}
          </div>
        </header>
        <main className="content">
          {page === 'dashboard' && <Dashboard />}
          {page === 'account' && <Account />}
          {page === 'trade' && <ManualTrade />}
          {page === 'strategies' && <Strategies />}
          {page === 'opportunities' && <Opportunities />}
          {page === 'orders' && <Orders />}
          {page === 'positions' && <Positions />}
          {page === 'fills' && <Fills />}
          {page === 'pnl' && <Pnl />}
          {page === 'risk' && <Risk />}
          {page === 'ledger' && <LedgerPage />}
          {page === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
