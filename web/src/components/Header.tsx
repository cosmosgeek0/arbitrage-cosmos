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
  <svg viewBox="0 0 32 32" width={28} height={28} className="brand-mark">
    <rect width="32" height="32" rx="8" fill="#0b0e11" />
    <path
      d="M6 20.5h4.2l2.6-8.4 4.4 12.6 2.8-8.8 1.8 3h4.2"
      stroke="#f0b90b"
      strokeWidth="2.3"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
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
      <div className="hdr-in" style={{ padding: '0 22px' }}>
        <h1 className="tb-title">{TITLES[page]}</h1>
        <div className="hdr-right">
          <span className="status-mini" title="Public market streams">
            <StatusDot status={mktOk ? 'live' : 'closed'} /> market
          </span>
          <span className="status-mini" title="Binance account sync">
            <StatusDot status={acctState} /> account
          </span>
          <span className="status-mini col-hide-sm" title="User data stream (30s polling fallback)">
            <StatusDot status={streamState} /> stream
          </span>
          <UtcClock />
          <span className={`mode-pill ${mode === 'HALTED' ? 'm-halted' : mode === 'LIVE_ARMED' ? 'm-live' : 'm-manual'}`}>
            <span className="dot" />
            <span className="mode-txt">{mode === 'LIVE_ARMED' ? 'LIVE' : mode === 'HALTED' ? 'HALTED' : 'MANUAL'}</span>
          </span>
          {mode === 'HALTED' ? (
            <button className="mode-pill m-halted" onClick={() => setPage('risk')} title="Resume on the Risk page">
              <IconPower size={12} />
              <span className="mode-txt">Resume…</span>
            </button>
          ) : (
            <button className="halt-btn" onClick={() => void setKill(true)} title="Instant kill switch">
              <IconPower size={12} />
              <span className="mode-txt">HALT</span>
            </button>
          )}
          <button className="icon-btn" onClick={() => setPaletteOpen(true)} title="Search (⌘K)">
            <IconSearch size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => updatePref('theme', theme === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? 'Dark mode' : 'Light mode'}
          >
            {theme === 'light' ? <IconMoon size={15} /> : <IconSun size={15} />}
          </button>
          <button className="icon-btn col-hide-sm" onClick={() => setPage('settings')} title="Settings">
            <IconGear size={15} />
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
