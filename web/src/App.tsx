import { useState } from 'react';
import { StoreProvider, useStore } from './store';
import { Overview } from './pages/Overview';
import { Opportunities } from './pages/Opportunities';
import { Portfolio } from './pages/Portfolio';
import { System } from './pages/System';
import { IconGrid, IconPulse, IconRadar, IconSliders, IconWallet } from './components/Icons';
import { fmtPrice } from './format';

type Page = 'overview' | 'opportunities' | 'portfolio' | 'system';

const NAV: { id: Page; label: string; icon: JSX.Element }[] = [
  { id: 'overview', label: 'Overview', icon: <IconGrid /> },
  { id: 'opportunities', label: 'Opportunities', icon: <IconRadar /> },
  { id: 'portfolio', label: 'Portfolio', icon: <IconWallet /> },
  { id: 'system', label: 'System', icon: <IconSliders /> },
];

const TITLES: Record<Page, string> = {
  overview: 'Market overview',
  opportunities: 'Opportunities',
  portfolio: 'Portfolio',
  system: 'System & risk',
};

function Shell() {
  const [page, setPage] = useState<Page>('overview');
  const [heroSymbol, setHeroSymbol] = useState('BTCUSDT');
  const { snap, connected, config } = useStore();

  const btc = snap?.rows.find((r) => r.symbol === 'BTCUSDT');
  const kill = config?.killSwitch ?? true;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-mark" />
          <div>
            <div className="logo-name">COSMOS</div>
            <div className="logo-sub">Arbitrage Control Room</div>
          </div>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className={`mode-card ${kill ? 'mode-halted' : 'mode-armed'}`}>
            <IconPulse size={16} />
            <div>
              <div className="mode-label">{kill ? 'Halted · Paper' : 'Armed · Paper'}</div>
              <div className="mode-sub">Phase 1 — no live trading</div>
            </div>
          </div>
        </div>
      </aside>

      <nav className="bottom-nav">
        {NAV.map((n) => (
          <button key={n.id} className={`bottom-nav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
            {n.icon}
            <span>{n.label}</span>
          </button>
        ))}
      </nav>

      <div className="main">
        <header className="topbar">
          <h1>{TITLES[page]}</h1>
          <div className="topbar-right">
            {btc && (
              <button className="btc-pill" onClick={() => { setHeroSymbol('BTCUSDT'); setPage('overview'); }}>
                <span className="btc-dot" />
                BTC {fmtPrice(btc.spot)}
              </button>
            )}
            <span className={`conn-pill ${connected ? 'ok' : 'bad'}`}>
              <span className="dot-inline" />
              {connected ? 'Live' : 'Reconnecting…'}
            </span>
          </div>
        </header>
        <main className="content">
          {page === 'overview' && (
            <Overview
              heroSymbol={heroSymbol}
              setHeroSymbol={(s) => {
                setHeroSymbol(s);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          )}
          {page === 'opportunities' && <Opportunities />}
          {page === 'portfolio' && <Portfolio />}
          {page === 'system' && <System />}
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
