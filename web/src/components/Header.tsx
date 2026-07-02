import { useEffect, useRef, useState } from 'react';
import { useStore, type Page } from '../store';
import { fmtClockUTC } from '../format';
import {
  IconBook,
  IconBrain,
  IconCaret,
  IconChart,
  IconCoins,
  IconGear,
  IconLayers,
  IconList,
  IconMoon,
  IconPower,
  IconRadar,
  IconReceipt,
  IconSearch,
  IconShield,
  IconSun,
  IconTicket,
  IconWallet,
} from './Icons';

const BRAND_MARK = (
  <svg viewBox="0 0 32 32" width={30} height={30} className="brand-mark">
    <rect width="32" height="32" rx="9" fill="#0b0e11" />
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

interface MenuItem {
  page: Page;
  label: string;
  sub: string;
  icon: JSX.Element;
}

const PORTFOLIO: MenuItem[] = [
  { page: 'account', label: 'Account', sub: 'Balances & connection', icon: <IconWallet /> },
  { page: 'orders', label: 'Orders', sub: 'Open orders & history', icon: <IconList /> },
  { page: 'positions', label: 'Positions', sub: 'Holdings, cost, unrealized', icon: <IconLayers /> },
  { page: 'fills', label: 'Fills', sub: 'Every execution, ledgered', icon: <IconReceipt /> },
  { page: 'pnl', label: 'PnL', sub: 'Daily realized & equity curve', icon: <IconChart /> },
];

const INTEL: MenuItem[] = [
  { page: 'strategies', label: 'Strategies', sub: 'Basis monitor & history', icon: <IconBrain /> },
  { page: 'opportunities', label: 'Opportunities', sub: 'Live proposals, explained', icon: <IconRadar /> },
];

const SYSTEM: MenuItem[] = [
  { page: 'risk', label: 'Risk', sub: 'Kill switch, limits, allowlist', icon: <IconShield /> },
  { page: 'ledger', label: 'Ledger', sub: 'The full decision trail', icon: <IconBook /> },
  { page: 'settings', label: 'Settings', sub: 'Keys, scanner, about', icon: <IconGear /> },
];

function UtcClock() {
  const [now, setNow] = useState(() => fmtClockUTC());
  useEffect(() => {
    const t = setInterval(() => setNow(fmtClockUTC()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="hdr-clock num">{now}</span>;
}

function NavMenu({
  label,
  items,
  activePage,
  badge,
  open,
  onToggle,
  onGo,
}: {
  label: string;
  items: MenuItem[];
  activePage: Page;
  badge?: number;
  open: boolean;
  onToggle: () => void;
  onGo: (p: Page) => void;
}) {
  const active = items.some((i) => i.page === activePage);
  return (
    <div className="menu-wrap">
      <button className={`nav-a ${active ? 'active' : ''}`} onClick={onToggle}>
        {label}
        {badge ? <span className="nav-badge">{badge}</span> : null}
        <span className="nav-car">
          <IconCaret size={10} />
        </span>
      </button>
      {open && (
        <div className="menu-pop">
          {items.map((i) => (
            <button key={i.page} className="menu-item" onClick={() => onGo(i.page)}>
              <span className="m-ic">{i.icon}</span>
              <span>
                <div className="m-label">{i.label}</div>
                <div className="m-sub">{i.sub}</div>
              </span>
              {i.page === 'opportunities' && badge ? <span className="m-right">{badge}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { state, page, setPage, setKill, theme, setTheme, setPaletteOpen } = useStore();
  const [menu, setMenu] = useState<string | null>(null);
  const wrapRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  const go = (p: Page) => {
    setMenu(null);
    setPage(p);
  };

  const mode = state?.mode ?? 'HALTED';
  const proposals = state?.proposals.length ?? 0;

  return (
    <header className="hdr" ref={wrapRef}>
      <div className="container hdr-in">
        <div className="brand" onClick={() => go('dashboard')}>
          {BRAND_MARK}
          <span className="brand-name">
            Cosmos <b>Arbitrage</b>
          </span>
        </div>

        <nav className="nav">
          <button className={`nav-a ${page === 'dashboard' ? 'active' : ''}`} onClick={() => go('dashboard')}>
            Dashboard
          </button>
          <button className={`nav-a ${page === 'markets' ? 'active' : ''}`} onClick={() => go('markets')}>
            Markets
          </button>
          <button className={`nav-a ${page === 'trade' ? 'active' : ''}`} onClick={() => go('trade')}>
            Trade
          </button>
          <button className={`nav-a ${page === 'loans' ? 'active' : ''}`} onClick={() => go('loans')}>
            Loans
          </button>
          <NavMenu
            label="Portfolio"
            items={PORTFOLIO}
            activePage={page}
            open={menu === 'portfolio'}
            onToggle={() => setMenu(menu === 'portfolio' ? null : 'portfolio')}
            onGo={go}
          />
          <NavMenu
            label="Signals"
            items={INTEL}
            activePage={page}
            badge={proposals || undefined}
            open={menu === 'intel'}
            onToggle={() => setMenu(menu === 'intel' ? null : 'intel')}
            onGo={go}
          />
          <NavMenu
            label="System"
            items={SYSTEM}
            activePage={page}
            open={menu === 'system'}
            onToggle={() => setMenu(menu === 'system' ? null : 'system')}
            onGo={go}
          />
        </nav>

        <div className="hdr-right">
          <button className="search-btn" onClick={() => setPaletteOpen(true)} title="Search (⌘K)">
            <IconSearch size={14} />
            <span className="stxt">Search</span>
            <span className="kbd">⌘K</span>
          </button>
          <UtcClock />
          <span
            className={`mode-pill ${mode === 'HALTED' ? 'm-halted' : mode === 'LIVE_ARMED' ? 'm-live' : 'm-manual'}`}
            title="Trading mode — change on the Risk page"
          >
            <span className="dot" />
            <span className="mode-txt">{mode === 'LIVE_ARMED' ? 'LIVE ARMED' : mode === 'HALTED' ? 'HALTED' : 'MANUAL'}</span>
          </span>
          {mode === 'HALTED' ? (
            <button className="mode-pill m-halted" onClick={() => go('risk')} title="Resume on the Risk page">
              <IconPower size={13} />
              <span className="mode-txt">Resume…</span>
            </button>
          ) : (
            <button className="halt-btn" onClick={() => void setKill(true)} title="Instant kill switch">
              <IconPower size={13} />
              <span className="mode-txt">HALT</span>
            </button>
          )}
          <button
            className="icon-btn"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? 'Dark mode' : 'Light mode'}
          >
            {theme === 'light' ? <IconMoon size={16} /> : <IconSun size={16} />}
          </button>
        </div>
      </div>
    </header>
  );
}

export function BottomNav() {
  const { page, setPage } = useStore();
  const items: { id: Page; label: string; icon: JSX.Element }[] = [
    { id: 'dashboard', label: 'Home', icon: <IconWallet /> },
    { id: 'markets', label: 'Markets', icon: <IconChart /> },
    { id: 'trade', label: 'Trade', icon: <IconTicket /> },
    { id: 'loans', label: 'Loans', icon: <IconCoins /> },
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
    </nav>
  );
}
