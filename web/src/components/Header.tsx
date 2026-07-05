import { useEffect, useState } from 'react';
import { useStore, useResolvedTheme, type Page } from '../store';
import { fmtClockUTC } from '../format';
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

/* One flat glyph, no container, no gradients — the way Binance/Uniswap mark
   their brand. Cosmos = a planet on its orbit, single accent color. */
const BRAND_MARK = (
  <svg viewBox="0 0 32 32" width={26} height={26} className="brand-mark" aria-hidden>
    <ellipse
      cx="16" cy="16" rx="14.4" ry="5.4"
      fill="none" stroke="var(--accent)" strokeWidth="2"
      transform="rotate(-24 16 16)"
      opacity=".55"
    />
    <circle cx="16" cy="16" r="8.2" fill="var(--accent)" />
  </svg>
);

const TITLES: Record<Page, string> = {
  dashboard: 'Dashboard',
  account: 'Account',
  wallets: 'Wallets & Assets',
  markets: 'Markets',
  detail: 'Token Detail',
  loans: 'Borrow Preflight',
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

const QUICK_NAV: { id: Page; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'markets', label: 'Markets' },
  { id: 'trade', label: 'Trade' },
  { id: 'orders', label: 'Orders' },
  { id: 'risk', label: 'Risk' },
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
          <div className="brand-name">Cosmos Arbitrage</div>
          <div className="brand-sub">Private Binance</div>
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
  const pageInQuickNav = QUICK_NAV.some((item) => item.id === page);
  const mode = state?.mode ?? 'HALTED';
  const feedStates = Object.values(state?.feeds ?? {});
  const mktOk = connected && feedStates.length > 0 && feedStates.every((s) => s === 'open');
  const acctState = state?.binance.keysPresent ? (state.binance.connected ? 'live' : 'closed') : 'none';
  const acctLabel = !state?.binance.keysPresent ? 'keys not set' : state.binance.connected ? 'account synced' : 'account offline';
  const healthTone = !connected || !mktOk ? 'bad' : acctState !== 'live' ? 'warn' : 'ok';
  const healthLine = !connected ? 'socket offline' : `${mktOk ? 'market live' : 'market degraded'} / ${acctLabel}`;
  const healthBrief = !connected ? 'offline' : !mktOk ? 'degraded' : !state?.binance.keysPresent ? 'keys absent' : acctState === 'live' ? 'ready' : 'account offline';

  return (
    <header className="hdr">
      <div className="hdr-in">
        <div className="tb-left">
          {!pageInQuickNav && <h1 className="tb-title">{TITLES[page]}</h1>}
          <nav className="tb-tabs" aria-label="Fast navigation">
            {QUICK_NAV.map((item) => (
              <button key={item.id} className={page === item.id ? 'active' : ''} type="button" onClick={() => setPage(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="hdr-right">
          <button
            className={`hdr-status col-hide-sm ${healthTone}`}
            onClick={() => setPage('system')}
            title={`System health: ${healthLine} — open System Health`}
            aria-label={`System Health: ${healthLine}`}
          >
            <span className="dot" />
            <span>{healthBrief}</span>
          </button>
          <UtcClock />
          <span
            className={`hdr-mode ${mode === 'HALTED' ? 'm-halted' : mode === 'LIVE_ARMED' ? 'm-live' : 'm-manual'}`}
            title="Trading mode — set on the Risk page"
          >
            <span className="dot" />
            <span className="mode-txt">{mode === 'LIVE_ARMED' ? 'Live armed' : mode === 'HALTED' ? 'Halted' : 'Manual'}</span>
          </span>
          {mode === 'HALTED' ? (
            <button className="hdr-action resume" onClick={() => setPage('risk')} title="Resume on the Risk page">
              Resume
            </button>
          ) : (
            <button className="hdr-action halt" onClick={() => void setKill(true)} title="Instant kill switch">
              <IconPower size={12} />
              Halt
            </button>
          )}
          <button className="icon-btn" onClick={() => setPaletteOpen(true)} title="Search (⌘K)" aria-label="Search">
            <IconSearch size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => updatePref('theme', theme === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
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
