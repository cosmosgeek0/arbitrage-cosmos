import { useEffect, useState } from 'react';
import { useStore, useResolvedTheme, type Page } from '../store';
import { fmtClockUTC } from '../format';
import { StatusDot } from './ui';
import {
  IconBook,
  IconBrain,
  IconChart,
  IconCoins,
  IconGear,
  IconGrid,
  IconLayers,
  IconList,
  IconMoon,
  IconPower,
  IconPulse,
  IconRadar,
  IconReceipt,
  IconSearch,
  IconShield,
  IconSun,
  IconTicket,
  IconWallet,
  IconWifi,
} from './Icons';

const BRAND_MARK = (
  <svg viewBox="0 0 36 36" width={32} height={32} className="brand-mark" aria-hidden>
    <defs>
      <linearGradient id="cx-mark" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#1a1d24" />
        <stop offset="1" stopColor="#05070a" />
      </linearGradient>
      <linearGradient id="cx-ring" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#f7d046" />
        <stop offset="1" stopColor="#e9ac00" />
      </linearGradient>
    </defs>
    <rect width="36" height="36" rx="10" fill="url(#cx-mark)" />
    <rect x="0.6" y="0.6" width="34.8" height="34.8" rx="9.6" fill="none" stroke="rgba(255,255,255,.08)" />
    {/* orbit ring + node — "cosmos" motif, crisp geometry */}
    <ellipse cx="18" cy="18" rx="11" ry="5.4" fill="none" stroke="url(#cx-ring)" strokeWidth="2" transform="rotate(-30 18 18)" />
    <circle cx="18" cy="18" r="3.4" fill="url(#cx-ring)" />
    <circle cx="27.4" cy="12.7" r="1.7" fill="#f7d046" />
  </svg>
);

const TITLES: Record<Page, string> = {
  dashboard: 'Dashboard',
  account: 'Account',
  wallets: 'Wallets & Assets',
  markets: 'Markets',
  detail: 'Token Detail',
  loans: 'Loans & Borrow',
  trade: 'Manual Trade',
  orders: 'Orders',
  positions: 'Positions',
  fills: 'Fills',
  pnl: 'PnL',
  strategies: 'Strategies',
  opportunities: 'Opportunities',
  risk: 'Risk',
  ledger: 'Ledger / Logs',
  system: 'System Health',
  settings: 'Settings',
};

const NAV: { group: string | null; items: { id: Page; label: string; icon: JSX.Element }[] }[] = [
  {
    group: null,
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: <IconGrid size={16} /> },
      { id: 'account', label: 'Account', icon: <IconWallet size={16} /> },
      { id: 'wallets', label: 'Wallets / Assets', icon: <IconLayers size={16} /> },
    ],
  },
  {
    group: 'Markets',
    items: [
      { id: 'markets', label: 'Markets', icon: <IconChart size={16} /> },
      { id: 'detail', label: 'Token Detail', icon: <IconSearch size={16} /> },
      { id: 'loans', label: 'Loans / Borrow', icon: <IconCoins size={16} /> },
    ],
  },
  {
    group: 'Trading',
    items: [
      { id: 'trade', label: 'Manual Trade', icon: <IconTicket size={16} /> },
      { id: 'orders', label: 'Orders', icon: <IconList size={16} /> },
      { id: 'positions', label: 'Positions', icon: <IconLayers size={16} /> },
      { id: 'fills', label: 'Fills', icon: <IconReceipt size={16} /> },
      { id: 'pnl', label: 'PnL', icon: <IconChart size={16} /> },
    ],
  },
  {
    group: 'Intelligence',
    items: [
      { id: 'strategies', label: 'Strategies', icon: <IconBrain size={16} /> },
      { id: 'opportunities', label: 'Opportunities', icon: <IconRadar size={16} /> },
    ],
  },
  {
    group: 'Control',
    items: [
      { id: 'risk', label: 'Risk', icon: <IconShield size={16} /> },
      { id: 'ledger', label: 'Ledger / Logs', icon: <IconBook size={16} /> },
      { id: 'system', label: 'System Health', icon: <IconWifi size={16} /> },
      { id: 'settings', label: 'Settings', icon: <IconGear size={16} /> },
    ],
  },
];

export function Sidebar() {
  const { state, page, setPage } = useStore();
  const mode = state?.mode ?? 'HALTED';
  const proposals = state?.proposals.length ?? 0;

  return (
    <aside className="snav">
      <div className="snav-brand" onClick={() => setPage('dashboard')}>
        {BRAND_MARK}
        <div>
          <div className="brand-name">
            Cosmos <b>Arbitrage</b>
          </div>
          <div className="brand-sub">Control Room</div>
        </div>
      </div>
      <nav className="snav-nav">
        {NAV.map((g, i) => (
          <div key={i} className="snav-group">
            {g.group && <div className="snav-group-title">{g.group}</div>}
            {g.items.map((n) => (
              <button key={n.id} className={`snav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
                {n.icon}
                <span>{n.label}</span>
                {n.id === 'opportunities' && proposals > 0 && <span className="nav-badge">{proposals}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="snav-foot">
        <span
          className={`mode-pill ${mode === 'HALTED' ? 'm-halted' : mode === 'LIVE_ARMED' ? 'm-live' : 'm-manual'}`}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          <span className="dot" />
          {mode === 'LIVE_ARMED' ? 'LIVE ARMED' : mode === 'HALTED' ? 'HALTED' : 'MANUAL'}
        </span>
        <div className="faint small" style={{ textAlign: 'center', marginTop: 8 }}>
          private · no withdrawals
        </div>
      </div>
    </aside>
  );
}

function UtcClock() {
  const [now, setNow] = useState(() => fmtClockUTC());
  useEffect(() => {
    const t = setInterval(() => setNow(fmtClockUTC()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="hdr-clock num">{now}</span>;
}

export function Topbar() {
  const { state, connected, page, setPage, setKill, setPaletteOpen, prefs, updatePref } = useStore();
  const theme = useResolvedTheme();
  const mode = state?.mode ?? 'HALTED';
  const mktOk = Object.values(state?.feeds ?? {}).every((s) => s === 'open') && connected;
  const acctState = state?.binance.keysPresent ? (state.binance.connected ? 'live' : 'closed') : 'none';
  const streamState = state?.binance.userStream === 'open' ? 'live' : 'none';

  return (
    <header className="hdr">
      <div className="hdr-in">
        <div className="tb-left">
          <h1 className="tb-title">{TITLES[page]}</h1>
          <span className="tb-crumb">{TITLES[page] === 'Dashboard' ? 'Control room' : 'Cosmos Arbitrage'}</span>
        </div>
        <div className="hdr-right">
          <div className="conn-panel col-hide-sm" title="Live data connections">
            <span className="conn-cell">
              <StatusDot status={mktOk ? 'live' : 'closed'} />
              Market
            </span>
            <span className="conn-cell">
              <StatusDot status={acctState} />
              Account
            </span>
            <span className="conn-cell">
              <StatusDot status={streamState} />
              Stream
            </span>
          </div>
          <UtcClock />
          <span className="tb-divider" />
          <span
            className={`mode-pill ${mode === 'HALTED' ? 'm-halted' : mode === 'LIVE_ARMED' ? 'm-live' : 'm-manual'}`}
            title="Trading mode — set on the Risk page"
          >
            <span className="dot" />
            <span className="mode-txt">{mode === 'LIVE_ARMED' ? 'LIVE ARMED' : mode === 'HALTED' ? 'HALTED' : 'MANUAL'}</span>
          </span>
          {mode === 'HALTED' ? (
            <button className="tb-action resume" onClick={() => setPage('risk')} title="Resume on the Risk page">
              <IconPower size={13} />
              <span className="mode-txt">Resume</span>
            </button>
          ) : (
            <button className="tb-action halt" onClick={() => void setKill(true)} title="Instant kill switch">
              <IconPower size={13} />
              <span className="mode-txt">HALT</span>
            </button>
          )}
          <span className="tb-divider" />
          <button className="icon-btn" onClick={() => setPaletteOpen(true)} title="Search (⌘K)">
            <IconSearch size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => updatePref('theme', theme === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? <IconMoon size={15} /> : <IconSun size={15} />}
          </button>
        </div>
      </div>
    </header>
  );
}

export function BottomNav() {
  const { page, setPage, setPaletteOpen } = useStore();
  const items: { id: Page; label: string; icon: JSX.Element }[] = [
    { id: 'dashboard', label: 'Home', icon: <IconGrid /> },
    { id: 'markets', label: 'Markets', icon: <IconChart /> },
    { id: 'trade', label: 'Trade', icon: <IconTicket /> },
    { id: 'risk', label: 'Risk', icon: <IconShield /> },
  ];
  return (
    <nav className="bottom-nav">
      {items.map((i) => (
        <button key={i.id} className={page === i.id ? 'active' : ''} onClick={() => setPage(i.id)}>
          {i.icon}
          <span>{i.label}</span>
        </button>
      ))}
      <button onClick={() => setPaletteOpen(true)}>
        <IconSearch size={17} />
        <span>More</span>
      </button>
    </nav>
  );
}

export { IconPulse };
