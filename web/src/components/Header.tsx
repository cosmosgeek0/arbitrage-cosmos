import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useStore, useResolvedTheme, type Page } from '../store';
import { fmtClockZone, timeAgo } from '../format';
import { eventSummary } from '../lib/eventText';
import { ACCENTS, CURRENCIES, type AccentKey } from '../lib/prefs';
import { openOverlay, useOverlay } from '../lib/overlay';
import {
  IconActivity,
  IconAlarm,
  IconBell,
  IconBrain,
  IconCalendar,
  IconCamera,
  IconChart,
  IconClose,
  IconCoins,
  IconDatabase,
  IconExchange,
  IconExternal,
  IconGear,
  IconGrid,
  IconKey,
  IconLock,
  IconLayers,
  IconList,
  IconMaximize,
  IconMoon,
  IconNewspaper,
  IconPower,
  IconPulse,
  IconRadar,
  IconRefresh,
  IconReceipt,
  IconSearch,
  IconShield,
  IconSun,
  IconTerminal,
  IconTicket,
  IconUser,
  IconWallet,
  IconWifi,
} from './Icons';

// Top-bar clock zones. `id` is 'local' | 'UTC' | an IANA zone.
const ZONES: { id: string; label: string; city: string }[] = [
  { id: 'local', label: 'LOC', city: 'Local time' },
  { id: 'UTC', label: 'UTC', city: 'Coordinated Universal' },
  { id: 'Asia/Kolkata', label: 'IST', city: 'India · Mumbai' },
  { id: 'America/New_York', label: 'NY', city: 'New York' },
  { id: 'Europe/London', label: 'LDN', city: 'London' },
  { id: 'Asia/Singapore', label: 'SGT', city: 'Singapore' },
  { id: 'Asia/Tokyo', label: 'JST', city: 'Tokyo' },
];

const ACCENT_ORDER: AccentKey[] = ['r', 'o', 'y', 'g', 'b', 'i', 'v'];

const CLOUD_SHELL_URL = 'https://console.aws.amazon.com/cloudshell/home';

// Binance announcement categories → real catalog IDs (shared with the News page).
export const NEWS_TABS: { id: number; label: string }[] = [
  { id: 48, label: 'Crypto listing' },
  { id: 49, label: 'Latest news' },
  { id: 93, label: 'Latest activities' },
  { id: 50, label: 'New fiat listing' },
  { id: 161, label: 'Delisting' },
  { id: 157, label: 'Maintenance' },
  { id: 51, label: 'API update' },
  { id: 128, label: 'Crypto airdrop' },
];

// Only ONE hover popover may be open at a time across the whole top bar. Opening
// any menu immediately closes the previously open one — no stacking, no overlap
// (that was the "garbage" of multiple boxes showing at once). Aave-style single
// panel: leaving triggers a short close so gliding to the next feels continuous.
let currentCloser: (() => void) | null = null;

// Popover controller: opens on HOVER (and click), closes on leave / outside / Esc.
// `hover = false` keeps a control click-only (e.g. the big account panel).
function useMenu<T extends HTMLElement>(hover = true) {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  const closeT = useRef<number | undefined>(undefined);
  const closer = useRef<() => void>(() => {});
  closer.current = () => setOpen(false);
  const openExclusive = () => {
    if (currentCloser && currentCloser !== closer.current) currentCloser();
    currentCloser = closer.current;
    setOpen(true);
  };
  useEffect(() => {
    if (!hover) return;
    const el = ref.current;
    if (!el) return;
    const enter = () => { window.clearTimeout(closeT.current); openExclusive(); };
    const leave = () => { closeT.current = window.setTimeout(() => setOpen(false), 110); };
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    return () => {
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', leave);
      window.clearTimeout(closeT.current);
    };
  }, [hover]); // openExclusive reads only refs + stable setState
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const setOpenExclusive = (v: boolean) => (v ? openExclusive() : setOpen(false));
  return { open, setOpen: setOpenExclusive, ref };
}

// A small live-pulsing dot for anything that refreshes continuously.
export function LiveDot({ ok = true, title = 'Live — refreshing' }: { ok?: boolean; title?: string }) {
  return <span className={`live-dot ${ok ? 'on' : 'off'}`} title={title} aria-hidden />;
}

// 2-letter ISO country code → flag emoji (EU included).
export function flag(cc: string): string {
  if (!cc || cc.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/* Owner-provided mark: three leaning market bars (light→dark blue) with two
   white up-arrows — the arbitrage/uptick motif. Fixed blue palette by design. */
const BRAND_MARK = (
  <svg viewBox="0 0 40 40" className="brand-mark" aria-hidden shapeRendering="geometricPrecision">
    {/* three leaning market bars, light→dark blue, with gaps */}
    <path d="M8.4 15 12.6 13.4 10.4 30.6 6.2 32.2Z" fill="#5ea0f7" />
    <path d="M27.4 14 31.6 12.4 29.4 27.6 25.2 29.2Z" fill="#2f4fca" />
    <path d="M17.9 9.6 22.1 8 19.9 33 15.7 34.6Z" fill="#4179ee" />
    {/* two white up-arrows */}
    <path d="M12.6 29.5v-6.2H9.5l4.6-5.3 4.6 5.3h-3.1v6.2z" fill="#fff" />
    <path d="M21.6 32.4v-8.1h-3.6l5.4-6.2 5.4 6.2h-3.6v8.1z" fill="#fff" />
  </svg>
);

const TITLES: Record<Page, string> = {
  dashboard: 'Dashboard',
  account: 'Account',
  wallets: 'Wallets & Assets',
  markets: 'Markets',
  detail: 'Token Detail',
  loans: 'Borrow / Margin',
  trade: 'Execution',
  orders: 'Execution · Orders',
  positions: 'Execution · Positions',
  fills: 'Execution · Fills',
  pnl: 'Execution · PnL',
  strategies: 'Basis Scanner',
  volume: 'Volume Scanner',
  opportunities: 'Opportunities',
  risk: 'Risk',
  ledger: 'Ledger / Logs',
  system: 'System Health',
  settings: 'Settings',
  news: 'Binance News',
  calendar: 'Economic Calendar',
};

// `match` marks extra page ids that keep an item highlighted (Execution owns
// the trade/orders/positions/fills/pnl internal routes).
type NavItem = { id?: Page; label: string; icon: JSX.Element; match?: Page[] };
// Six zones: OVERVIEW / CAPITAL / MARKET / ENGINE / EXECUTION / CONTROL.
// One sidebar item per operator surface — detail routes (Token Detail,
// Execution tabs) open from within pages, not from the sidebar.
const NAV: { group: string | null; items: NavItem[] }[] = [
  {
    group: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: <IconGrid size={17} /> },
    ],
  },
  {
    group: 'Capital',
    items: [
      { id: 'account', label: 'Account', icon: <IconWallet size={17} /> },
      { id: 'wallets', label: 'Wallets', icon: <IconLayers size={17} /> },
      { id: 'loans', label: 'Borrow', icon: <IconCoins size={17} /> },
    ],
  },
  {
    group: 'Market',
    items: [
      { id: 'markets', label: 'Markets', icon: <IconChart size={17} />, match: ['detail'] },
    ],
  },
  {
    group: 'Engine',
    items: [
      { id: 'strategies', label: 'Basis Scanner', icon: <IconBrain size={17} /> },
      { id: 'volume', label: 'Volume Scanner', icon: <IconPulse size={17} /> },
      { id: 'opportunities', label: 'Opportunities', icon: <IconRadar size={17} /> },
    ],
  },
  {
    group: 'Execution',
    items: [
      { id: 'trade', label: 'Execution', icon: <IconTicket size={17} />, match: ['orders', 'positions', 'fills', 'pnl'] },
    ],
  },
  {
    group: 'Control',
    items: [
      { id: 'risk', label: 'Risk', icon: <IconShield size={17} /> },
      { id: 'ledger', label: 'Logs', icon: <IconList size={17} /> },
      { id: 'system', label: 'Health', icon: <IconWifi size={17} /> },
    ],
  },
];

interface SessionRow {
  id: string; ip: string | null; country: string | null; system: string; browser: string;
  firstSeen: number; lastSeen: number; current: boolean; active: boolean;
}
const COUNTRY_NAMES: Record<string, string> = {
  IN: 'India', US: 'United States', GB: 'United Kingdom', SG: 'Singapore', DE: 'Germany',
  AE: 'UAE', JP: 'Japan', CA: 'Canada', AU: 'Australia', FR: 'France', NL: 'Netherlands',
};
function sessionPlace(s: SessionRow): string {
  return [s.country ? COUNTRY_NAMES[s.country] ?? s.country : null, s.ip ?? 'local network'].filter(Boolean).join(' · ');
}

// ---- account card (Binance-style profile chip + details) --------------------
function AccountCard({ compact = false }: { compact?: boolean }) {
  const { state, saveConfig, setPage } = useStore();
  const { open, setOpen, ref } = useMenu<HTMLDivElement>(); // hover-open, like the rest of the bar
  const fileRef = useRef<HTMLInputElement>(null);
  const profile = state?.config.profile ?? { name: '', avatar: null };
  const [preview, setPreview] = useState<string | null>(null); // instant feedback before the 2s state tick
  const [editName, setEditName] = useState<string | null>(null);
  const [sessList, setSessList] = useState<SessionRow[]>([]);
  const avatar = preview ?? profile.avatar;
  const name = profile.name || 'Operator';
  const connected = !!state?.binance.keysPresent;
  const sub = connected ? (state?.binance.connected ? 'Binance · read-only' : 'Binance · error') : 'Binance · not linked';

  // Real active-session list (server-tracked). Polled only while the popover is open.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => fetch('/api/sessions').then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d) setSessList(d.sessions ?? []); }).catch(() => undefined);
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [open]);
  const otherActive = sessList.filter((s) => s.active && !s.current).length;

  const onFile = (f: File | undefined) => {
    if (!f || !f.type.startsWith('image/')) return;
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      // Downscale to a small square so the data URL stays tiny (server caps 160KB).
      const S = 112;
      const c = document.createElement('canvas');
      c.width = S;
      c.height = S;
      const ctx = c.getContext('2d')!;
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
      const dataUrl = c.toDataURL('image/jpeg', 0.85);
      URL.revokeObjectURL(url);
      setPreview(dataUrl);
      void saveConfig({ profile: { name: profile.name, avatar: dataUrl } } as never);
    };
    img.src = url;
  };

  return (
    <div className={`acct-wrap ${compact ? 'top' : ''}`} ref={ref}>
      <button className={`acct-card ${compact ? 'top' : ''} ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Account details">
        <span className="acct-avatar">
          {avatar ? <img src={avatar} alt="" /> : <IconUser size={16} />}
        </span>
        <span className="acct-meta">
          <span className="acct-name">{name}</span>
          <span className="acct-sub"><span className={`acct-dot ${connected ? (state?.binance.connected ? 'ok' : 'bad') : ''}`} />{sub}</span>
        </span>
      </button>
      {open && (
        <div className="menu-pop acct-pop">
          <div className="acct-pop-head">
            <button className="acct-avatar lg" onClick={() => fileRef.current?.click()} title="Upload profile photo">
              {avatar ? <img src={avatar} alt="" /> : <IconUser size={22} />}
              <span className="acct-cam"><IconCamera size={11} /></span>
            </button>
            <div className="acct-pop-id">
              {editName === null ? (
                <button className="acct-pop-name" onClick={() => setEditName(profile.name || '')} title="Edit display name">{name}</button>
              ) : (
                <form
                  className="acct-name-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveConfig({ profile: { name: editName.slice(0, 40), avatar: profile.avatar } } as never);
                    setEditName(null);
                  }}
                >
                  <input autoFocus value={editName} maxLength={40} placeholder="Display name" onChange={(e) => setEditName(e.target.value)} />
                  <button type="submit">Save</button>
                </form>
              )}
              <span className="acct-pop-sub">Private cockpit owner</span>
            </div>
          </div>
          <div className="menu-head">Linked exchanges</div>
          <div className="acct-ex-list">
            <div className="acct-ex">
              <span className="acct-ex-badge bn">B</span>
              <span className="acct-ex-info">
                <b>Binance</b>
                <small>{connected ? (state?.binance.connected ? `read-only · synced ${timeAgo(state.binance.lastSyncTs)}` : 'key error') : 'read-only key not set'}</small>
              </span>
              <span className={`acct-ex-pill ${connected ? (state?.binance.connected ? 'ok' : 'bad') : 'idle'}`}>
                {connected ? (state?.binance.connected ? 'active' : 'error') : 'connect'}
              </span>
            </div>
            {[{ key: 'by', name: 'Bybit' }].map((e) => (
              <div key={e.key} className="acct-ex soon">
                <span className={`acct-ex-badge ${e.key}`}>{e.name[0]}</span>
                <span className="acct-ex-info"><b>{e.name}</b><small>not yet supported</small></span>
                <span className="acct-ex-pill soon">soon</span>
              </div>
            ))}
          </div>

          <div className="menu-head">
            Active sessions
            {otherActive > 0 && <span className="acct-sess-warn">· {otherActive} other device{otherActive > 1 ? 's' : ''} active</span>}
          </div>
          <div className="acct-sess-list">
            {sessList.length === 0 ? (
              <div className="acct-sess-empty">Checking…</div>
            ) : (
              sessList.slice(0, 5).map((s) => (
                <div key={s.id} className={`acct-sess ${s.current ? 'me' : ''}`}>
                  <span className={`acct-sess-dot ${s.active ? 'on' : ''}`} />
                  <span className="acct-sess-info">
                    <span className="acct-sess-name">{s.system} · {s.browser}</span>
                    <span className="acct-sess-place">{sessionPlace(s)}</span>
                  </span>
                  <span className="acct-sess-right">
                    <span className={`acct-sess-time ${s.active ? 'on' : ''}`}>{s.active ? 'Active now' : timeAgo(s.lastSeen)}</span>
                    {s.current && <span className="acct-sess-you">This device</span>}
                  </span>
                </div>
              ))
            )}
          </div>

          <button className="acct-ex-manage" onClick={() => { setOpen(false); setPage('account'); }}>
            Account &amp; security →
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      )}
    </div>
  );
}

// ---- sidebar search (pages, settings, actions — ranked, keyboardable) -------
interface SearchEntry {
  label: string;
  hint: string;
  page?: Page;
  overlay?: 'news' | 'calendar';
  symbol?: string;
  keywords: string;
  kind?: 'token' | 'page';
}
function buildIndex(): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const g of NAV) {
    for (const it of g.items) {
      if (it.id) out.push({ label: it.label, hint: g.group ?? 'Navigate', page: it.id, keywords: `${it.label} ${g.group ?? ''} ${TITLES[it.id]}`.toLowerCase() });
    }
  }
  out.push(
    { label: 'News', hint: 'Binance announcements', page: 'news', keywords: 'news binance announcements listing delisting maintenance airdrop' },
    { label: 'Calendar', hint: 'Economic events', page: 'calendar', keywords: 'calendar economic events cpi fomc pmi tradingview' },
    { label: 'Appearance', hint: 'Settings · theme & accent', page: 'settings', keywords: 'appearance theme dark light accent color settings' },
    { label: 'Display currency', hint: 'Settings · money units', page: 'settings', keywords: 'currency inr usd eur fiat display settings' },
    { label: 'Kill switch', hint: 'Risk · halt everything', page: 'risk', keywords: 'kill switch halt stop emergency risk' },
    { label: 'Risk limits', hint: 'Risk · caps & allowlist', page: 'risk', keywords: 'risk limits caps notional allowlist symbols' },
    { label: 'Rules & governance', hint: 'Risk · owner rules', page: 'risk', keywords: 'rules allowed blocked strict governance create' },
    { label: 'Orders', hint: 'Execution · open & history', page: 'orders', keywords: 'orders open history cancel execution' },
    { label: 'Positions', hint: 'Execution · holdings', page: 'positions', keywords: 'positions holdings unrealized execution' },
    { label: 'Fills', hint: 'Execution · executions', page: 'fills', keywords: 'fills executions trades execution' },
    { label: 'PnL', hint: 'Execution · profit & loss', page: 'pnl', keywords: 'pnl profit loss equity daily execution' },
  );
  return out;
}
function SidebarSearch({ placement = 'rail' }: { placement?: 'rail' | 'topbar' }) {
  const { setPage, setPaletteOpen, markets, openDetail } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Global index: nav/settings/actions PLUS every tradable token, so typing any
  // letter finds tokens across the whole app (not just the menu).
  const index = useMemo(() => {
    const pages = buildIndex();
    const tokens: SearchEntry[] = markets.map((m) => ({
      label: m.base,
      hint: `${m.symbol} · token`,
      symbol: m.symbol,
      kind: 'token' as const,
      keywords: `${m.base} ${m.symbol}`.toLowerCase(),
    }));
    return [...pages, ...tokens];
  }, [markets]);
  // close on outside click (more reliable than focus state)
  useEffect(() => {
    if (!q) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setQ('');
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [q]);
  const ql = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!ql) return [];
    const scored = index
      .map((e) => {
        const l = e.label.toLowerCase();
        let score = -1;
        if (l.startsWith(ql)) score = 0;
        else if (l.split(/\s+/).some((w) => w.startsWith(ql))) score = 1;
        else if (l.includes(ql)) score = 2;
        else if (e.keywords.includes(ql)) score = 3;
        return { e, score };
      })
      .filter((x) => x.score >= 0)
      // pages rank above tokens at equal score, so menu items surface first
      .sort((a, b) => a.score - b.score || (a.e.kind === 'token' ? 1 : 0) - (b.e.kind === 'token' ? 1 : 0))
      .slice(0, 9)
      .map((x) => x.e);
    return scored;
  }, [ql, index]);

  const go = (e: SearchEntry) => {
    if (e.symbol) openDetail(e.symbol);
    else if (e.overlay) openOverlay(e.overlay);
    else if (e.page) setPage(e.page);
    setQ('');
    setSel(0);
  };

  return (
    <div className={`snav-search ${placement === 'topbar' ? 'topbar-search' : ''}`} ref={wrapRef}>
      <div className={`snav-search-box ${ql ? 'on' : ''}`}>
        <IconSearch size={14} />
        <input
          value={q}
          placeholder="Search cockpit"
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter' && results[sel]) go(results[sel]);
            else if (e.key === 'Escape') setQ('');
          }}
          aria-label="Search cockpit"
        />
        <button className="snav-search-k" onClick={() => setPaletteOpen(true)} title="Full command palette (⌘K)" tabIndex={-1}>⌘K</button>
      </div>
      {ql && (
        <div className="snav-search-pop">
          {results.length === 0 ? (
            <div className="ssr-empty">No matches — try ⌘K for symbols</div>
          ) : (
            results.map((r, i) => (
              <button key={r.label + r.hint} className={`ssr-row ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); go(r); }}>
                <span className="ssr-label">{r.label}</span>
                <span className="ssr-hint">{r.hint}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { state, page, setPage } = useStore();
  const proposals = state?.proposals.length ?? 0;

  return (
    <aside className="snav">
      <div className="snav-brand" onClick={() => setPage('dashboard')} title="Arbitrage Control Room">
        {BRAND_MARK}
        <div className="brand-lockup">
          <div className="brand-name">Arbitrage</div>
          <div className="brand-sub">Control Room</div>
        </div>
      </div>
      <nav className="snav-nav">
        {NAV.map((g, i) => (
          <div key={i} className="snav-group">
            {g.group && <div className="snav-group-title">{g.group}</div>}
            {g.items.map((n) => (
              <button
                key={n.id}
                className={`snav-item ${page === n.id || n.match?.includes(page) ? 'active' : ''}`}
                onClick={() => setPage(n.id!)}
                title={n.label}
              >
                <span className="snav-ic">{n.icon}</span>
                <span className="snav-label">{n.label}</span>
                {n.id === 'opportunities' && proposals > 0 && <span className="nav-badge">{proposals}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="snav-utils">
        <button className={`snav-util ${page === 'news' ? 'active' : ''}`} onClick={() => setPage('news')} title="Binance news — full page">
          <span className="snav-ic"><IconNewspaper size={18} /></span>
          <span className="snav-label">News</span>
          <LiveDot />
        </button>
        <button className={`snav-util ${page === 'calendar' ? 'active' : ''}`} onClick={() => setPage('calendar')} title="Economic calendar — full page">
          <span className="snav-ic"><IconCalendar size={18} /></span>
          <span className="snav-label">Calendar</span>
        </button>
        <button className={`snav-util ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')} title="Local UI preferences">
          <span className="snav-ic"><IconGear size={18} /></span>
          <span className="snav-label">Settings</span>
        </button>
      </div>
    </aside>
  );
}

// ---- clock ------------------------------------------------------------------
function ClockMenu() {
  const { prefs, updatePref } = useStore();
  const { open, setOpen, ref } = useMenu<HTMLDivElement>();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const zone = ZONES.find((z) => z.id === prefs.clockZone) ?? ZONES[1];
  return (
    <div className="menu-wrap clock-menu" ref={ref}>
      <button className={`hdr-clock-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Change clock timezone" aria-label={`Clock — ${zone.city}. Change timezone`}>
        <span className="num">{fmtClockZone(zone.id, now)}</span>
        <span className="hcb-zone">{zone.label}</span>
      </button>
      {open && (
        <div className="menu-pop right zone-pop">
          <div className="menu-head">Clock timezone</div>
          {ZONES.map((z) => (
            <button key={z.id} className={`menu-item ${z.id === zone.id ? 'sel' : ''}`} onClick={() => { updatePref('clockZone', z.id); setOpen(false); }}>
              <span className="zp-code">{z.label}</span>
              <span className="zp-city">{z.city}</span>
              <span className="zp-time num">{fmtClockZone(z.id, now)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- currency ----------------------------------------------------------------
function CurrencyMenu() {
  const { prefs, updatePref } = useStore();
  const { open, setOpen, ref } = useMenu<HTMLDivElement>();
  const cur = CURRENCIES[prefs.currency] ? prefs.currency : 'USD';
  const sym = CURRENCIES[cur].symbol.trim() || cur;
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={`ic-pill cur-pill ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title={`Display currency — ${cur}`} aria-label={`Display currency — ${cur}`}>
        <span className="cur-glyph">{sym}</span>
      </button>
      {open && (
        <div className="menu-pop right cur-pop">
          <div className="menu-head">Display currency</div>
          {Object.entries(CURRENCIES).map(([code, c]) => (
            <button key={code} className={`menu-item ${code === cur ? 'sel' : ''}`} onClick={() => { updatePref('currency', code); setOpen(false); }}>
              <span className="cur-sym">{c.symbol.trim() || code}</span>
              <span className="cur-label">{c.label}</span>
              <span className="cur-code num">{code}</span>
            </button>
          ))}
          <div className="menu-foot">Rates: live, USD base · applied to money values</div>
        </div>
      )}
    </div>
  );
}

// ---- alerts -------------------------------------------------------------------
function AlertsMenu() {
  const { prefs, updatePref } = useStore();
  const { open, setOpen, ref } = useMenu<HTMLDivElement>();
  const a = prefs.alerts;
  const rows: { key: keyof typeof a; label: string; sub: string }[] = [
    { key: 'proposals', label: 'Strategy proposals', sub: 'New basis / spread signals' },
    { key: 'fills', label: 'Order fills', sub: 'Executions on your account' },
    { key: 'risk', label: 'Risk rejects', sub: 'Gate blocks & kill-switch trips' },
    { key: 'news', label: 'Binance announcements', sub: 'Listings, delistings, maintenance' },
  ];
  const on = Object.values(a).filter(Boolean).length;
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={`hdr-ic ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Alerts" aria-label="Alerts">
        <IconAlarm size={16} />
        {on > 0 && <span className="ic-dot accent" />}
      </button>
      {open && (
        <div className="menu-pop right alert-pop">
          <div className="np-head">
            <span className="np-title">Alerts</span>
            <span className="np-sub">{on} on</span>
          </div>
          {rows.map((r) => (
            <div key={r.key} className="alert-row">
              <div className="alert-meta">
                <span className="alert-label">{r.label}</span>
                <span className="alert-sub">{r.sub}</span>
              </div>
              <button className={`toggle ${a[r.key] ? 'on' : ''}`} onClick={() => updatePref('alerts', { ...a, [r.key]: !a[r.key] })} aria-label={`Toggle ${r.label}`}>
                <span className="knob" />
              </button>
            </div>
          ))}
          <div className="menu-foot">Delivery wiring lands with live mode — toggles are saved.</div>
        </div>
      )}
    </div>
  );
}

// ---- data health ---------------------------------------------------------------
interface SystemLite {
  restLatencyMs: number | null;
  serverTimeDiffMs: number | null;
  usedWeight1m: number | null;
  feeds?: Record<string, string>;
  dbOk?: boolean;
  lastScannerTickTs?: number | null;
}
function msLabel(v: number | null | undefined): string {
  return v === null || v === undefined || !isFinite(v) ? '—' : `${Math.round(v)} ms`;
}
function DataHealthMenu() {
  const { state, connected } = useStore();
  const { open, setOpen, ref } = useMenu<HTMLDivElement>();
  const [sys, setSys] = useState<SystemLite | null>(null);
  const [srv, setSrv] = useState<{ news: boolean; cal: boolean; fx: boolean }>({ news: false, cal: false, fx: false });

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetch('/api/system').then((r) => (r.ok ? r.json() : null)).then((s) => alive && s && setSys(s as SystemLite)).catch(() => undefined);
    const probe = (u: string, k: 'news' | 'cal' | 'fx') =>
      fetch(u).then((r) => alive && setSrv((p) => ({ ...p, [k]: r.ok }))).catch(() => alive && setSrv((p) => ({ ...p, [k]: false })));
    void probe('/api/news', 'news');
    void probe('/api/calendar', 'cal');
    void probe('/api/fx', 'fx');
    return () => {
      alive = false;
    };
  }, [open]);

  const feeds = state?.feeds ?? {};
  const feedsOk = Object.values(feeds).length > 0 && Object.values(feeds).every((s) => s === 'open');
  const lat = sys?.restLatencyMs ?? null;
  const grade = !connected ? 'bad' : !feedsOk ? 'warn' : 'ok';
  const sources: { name: string; ok: boolean; detail: string }[] = [
    { name: 'Binance market feed', ok: connected && feedsOk, detail: `${Object.keys(feeds).length} streams · ${msLabel(lat)}` },
    { name: 'Binance account', ok: !!state?.binance.connected, detail: state?.binance.keysPresent ? (state.binance.connected ? 'synced' : 'error') : 'no keys' },
    { name: 'Binance announcements', ok: srv.news, detail: srv.news ? 'reachable' : 'checking / down' },
    { name: 'Economic calendar', ok: srv.cal, detail: srv.cal ? 'reachable' : 'checking / down' },
    { name: 'FX rates', ok: srv.fx, detail: srv.fx ? 'reachable' : 'checking / down' },
  ];
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={`hdr-ic tint-data grade-${grade} ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Data health" aria-label="Data health">
        <IconDatabase size={18} />
      </button>
      {open && (
        <div className="menu-pop right dh-pop">
          <div className="np-head">
            <span className={`np-title ${grade}`}><LiveDot ok={grade !== 'bad'} /> Data health</span>
            <span className="np-sub">source: Binance</span>
          </div>
          {sources.map((s) => (
            <div key={s.name} className="dh-row">
              <span className={`dh-dot ${s.ok ? 'ok' : 'bad'}`} />
              <span className="dh-name">{s.name}</span>
              <span className={`dh-detail ${s.ok ? '' : 'muted'}`}>{s.detail}</span>
            </div>
          ))}
          <div className="dh-params">
            <div className="menu-head">Parameters</div>
            <div className="np-row"><span className="k">Clock drift</span><span className="v num">{msLabel(sys?.serverTimeDiffMs)}</span></div>
            <div className="np-row"><span className="k">Rate weight · 1m</span><span className="v num">{sys?.usedWeight1m ?? '—'}</span></div>
            <div className="np-row"><span className="k">Pairs scanned</span><span className="v num">{state?.scanner.pairs ?? '—'}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- network / signal -----------------------------------------------------------
// Real Wi-Fi glyph: a base dot + three arcs. When healthy, the arcs light up in
// sequence from the inner (lowest) curve out to the top curve, then repeat — the
// classic "connecting" wave. Degraded = amber, offline = only the dot.
// Global [data-motion="reduced"] freezes it fully lit.
function WifiSignal({ grade }: { grade: string }) {
  return (
    <span className={`wifi-sig ${grade}`} aria-hidden>
      <svg viewBox="0 0 22 18" width="19" height="16">
        <path className="wa a3" d="M2 6.2A15 15 0 0 1 20 6.2" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
        <path className="wa a2" d="M5 9.6A10 10 0 0 1 17 9.6" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
        <path className="wa a1" d="M8 13A5 5 0 0 1 14 13" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
        <circle className="wa a0" cx="11" cy="15.6" r="1.5" fill="currentColor" />
      </svg>
    </span>
  );
}

function NetworkStatus() {
  const { state, connected } = useStore();
  const { open, setOpen, ref } = useMenu<HTMLDivElement>();
  const [sys, setSys] = useState<SystemLite | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/system').then((r) => (r.ok ? r.json() : null)).then((s) => alive && s && setSys(s as SystemLite)).catch(() => undefined);
    void load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const feeds = state?.feeds ?? {};
  const feedList = Object.entries(feeds);
  const feedsOk = feedList.length > 0 && feedList.every(([, s]) => s === 'open');
  const lat = sys?.restLatencyMs ?? null;
  const latHigh = lat !== null && lat > 900;
  const grade = !connected ? 'bad' : !feedsOk || latHigh ? 'warn' : 'ok';
  const latTone = lat === null ? '' : lat < 400 ? 'ok' : lat < 900 ? 'warn' : 'bad';
  const brief = !connected ? 'offline' : msLabel(lat);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={`net-btn wifi ${grade} ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Network & signal" aria-label={`Network status — ${brief}`}>
        <WifiSignal grade={grade} />
      </button>
      {open && (
        <div className="menu-pop right net-pop">
          <div className="np-head">
            <span className={`np-title ${grade}`}><span className="net-dot" />{!connected ? 'Signal offline' : grade === 'ok' ? 'Signal healthy' : 'Signal degraded'}</span>
            <span className="np-lat num">{brief}</span>
          </div>
          <div className="np-row"><span className="k">Binance REST latency</span><span className={`v num ${latTone}`}>{msLabel(lat)}</span></div>
          <div className="np-row"><span className="k">Clock drift</span><span className="v num">{msLabel(sys?.serverTimeDiffMs)}</span></div>
          <div className="np-row"><span className="k">Cockpit link</span><span className={`v ${connected ? 'ok' : 'bad'}`}>{connected ? 'live' : 'reconnecting'}</span></div>
          {feedList.map(([name, s]) => (
            <div key={name} className="np-row"><span className="k">{name}</span><span className={`v ${s === 'open' ? 'ok' : 'warn'}`}>{s}</span></div>
          ))}
          <div className="np-row"><span className="k">User stream</span><span className="v">{state?.binance.userStream ?? '—'}</span></div>
          <div className="np-row"><span className="k">Rate weight · 1m</span><span className="v num">{sys?.usedWeight1m ?? '—'}</span></div>
        </div>
      )}
    </div>
  );
}

// ---- notifications (cockpit-only, from the ledger) --------------------------------
function NotificationMenu() {
  const { state, setPage } = useStore();
  const { open, setOpen, ref } = useMenu<HTMLDivElement>();
  const events = state?.events ?? [];
  const [seen, setSeen] = useState<number>(() => Number(localStorage.getItem('cosmos-notif-seen') || 0));
  const unread = events.filter((e) => e.id > seen).length;
  const toggle = () => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && events[0]) {
      setSeen(events[0].id);
      localStorage.setItem('cosmos-notif-seen', String(events[0].id));
    }
  };
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={`hdr-ic ${open ? 'on' : ''}`} onClick={toggle} title="Cockpit notifications" aria-label="Cockpit notifications">
        <IconBell size={16} />
        {unread > 0 && <span className="ic-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="menu-pop right notif-pop">
          <div className="np-head">
            <span className="np-title">Notifications</span>
            <button className="np-link" onClick={() => { setOpen(false); setPage('ledger'); }}>Ledger →</button>
          </div>
          <div className="np-sub-line">Your cockpit only — proposals, fills, risk. Not news.</div>
          {events.length === 0 ? (
            <div className="snn-empty">No events yet</div>
          ) : (
            events.slice(0, 8).map((e) => {
              const tone = e.kind.includes('error') ? 'bad' : e.kind.includes('fill') ? 'ok' : e.kind.includes('risk') ? 'warn' : '';
              return (
                <button key={e.id} className="notif-row" onClick={() => { setOpen(false); setPage('ledger'); }}>
                  <span className={`notif-dot ${tone}`} />
                  <span className="notif-text">{eventSummary(e.kind, (e.data as Record<string, unknown> | null) ?? null, e.symbol)}</span>
                  <span className="notif-time num">{timeAgo(e.ts)}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ---- zoom ------------------------------------------------------------------------
function ZoomMenu() {
  const { prefs, updatePref } = useStore();
  const { open, setOpen, ref } = useMenu<HTMLDivElement>();
  const z = prefs.zoom || 1;
  const set = (v: number) => updatePref('zoom', Math.min(1.5, Math.max(0.8, Math.round(v * 100) / 100)));
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={`hdr-ic ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Zoom" aria-label="Zoom">
        <IconMaximize size={16} />
      </button>
      {open && (
        <div className="menu-pop right zoom-pop">
          <div className="menu-head">Zoom</div>
          <div className="zoom-row">
            <button className="zoom-btn" onClick={() => set(z - 0.05)} aria-label="Zoom out">−</button>
            <span className="zoom-val num">{Math.round(z * 100)}%</span>
            <button className="zoom-btn" onClick={() => set(z + 0.05)} aria-label="Zoom in">+</button>
          </div>
          <button className="zoom-reset" onClick={() => set(1)}>Reset to 100%</button>
        </div>
      )}
    </div>
  );
}

// ---- theme + ROYGBIV --------------------------------------------------------------
function ThemeMenu() {
  const { prefs, updatePref } = useStore();
  const theme = useResolvedTheme();
  const { open, setOpen, ref } = useMenu<HTMLDivElement>();
  const modes: { id: 'light' | 'dark' | 'system'; label: string }[] = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'Auto' },
  ];
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={`icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Theme & accent" aria-label="Theme and accent color">
        {theme === 'light' ? <IconMoon size={15} /> : <IconSun size={15} />}
      </button>
      {open && (
        <div className="menu-pop right theme-pop">
          <div className="menu-head">Appearance</div>
          <div className="theme-seg">
            {modes.map((m) => (
              <button key={m.id} className={prefs.theme === m.id ? 'on' : ''} onClick={() => updatePref('theme', m.id)}>{m.label}</button>
            ))}
          </div>
          <div className="menu-head">Accent</div>
          <div className="accent-dots">
            {ACCENT_ORDER.map((k) => (
              <button
                key={k}
                className={`accent-dot ${prefs.accent === k ? 'sel' : ''}`}
                style={{ '--dot': ACCENTS[k].hex } as CSSProperties}
                onClick={() => updatePref('accent', k)}
                title={ACCENTS[k].label}
                aria-label={`${ACCENTS[k].label} accent`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Trusted Advisor: whole-cockpit safety scan (real checks, popup only) ----
type Sev = 'action' | 'invest' | 'pass';
function TrustedAdvisor() {
  const { state, connected, setPage } = useStore();
  const { open, setOpen, ref } = useMenu<HTMLDivElement>();
  const [sys, setSys] = useState<SystemLite | null>(null);
  const [scanTs, setScanTs] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);

  const scan = () => {
    setScanning(true);
    fetch('/api/system')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { setSys(s as SystemLite); setScanTs(Date.now()); })
      .catch(() => undefined)
      .finally(() => setScanning(false));
  };
  useEffect(() => { if (open && !scanTs) scan(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const b = state?.binance;
  const cfg = state?.config;
  const feeds = state?.feeds ?? {};
  const feedsOk = Object.values(feeds).length > 0 && Object.values(feeds).every((s) => s === 'open');
  const lat = sys?.restLatencyMs ?? null;

  const raw: ({ sev: Sev; name: string; detail: string; page?: Page } | null)[] = [
    b?.canWithdraw ? { sev: 'action', name: 'Withdrawals enabled on key', detail: 'Rotate to a read-only key with withdrawals OFF.', page: 'account' } : { sev: 'pass', name: 'Withdrawals disabled', detail: 'The key cannot move funds.' },
    cfg && !cfg.killSwitch && cfg.liveTradingEnabled && (cfg.allowedSymbols?.length ?? 0) === 0 ? { sev: 'action', name: 'Live armed, allowlist empty', detail: 'Nothing can trade — set an allowlist or halt.', page: 'risk' } : null,
    b?.keysPresent && !b?.connected ? { sev: 'action', name: 'Account sync failing', detail: b?.lastError ?? 'Keys present but not syncing.', page: 'system' } : null,
    !connected ? { sev: 'invest', name: 'Cockpit socket offline', detail: 'Reconnecting to the server.', page: 'system' } : null,
    !feedsOk ? { sev: 'invest', name: 'Market feed degraded', detail: 'One or more Binance streams are not open.', page: 'system' } : { sev: 'pass', name: 'Market feeds live', detail: `${Object.keys(feeds).length} streams open.` },
    lat !== null && lat > 900 ? { sev: 'invest', name: 'High Binance latency', detail: `${Math.round(lat)}ms REST round-trip.`, page: 'system' } : null,
    !b?.keysPresent ? { sev: 'invest', name: 'No read key set', detail: 'Balances, orders and fills stay hidden.', page: 'account' } : { sev: 'pass', name: 'Read key configured', detail: 'Account data is available.' },
    (cfg?.allowedSymbols?.length ?? 0) === 0 ? { sev: 'invest', name: 'Allowlist empty', detail: 'Risk gate rejects every symbol (safe default).', page: 'risk' } : { sev: 'pass', name: `Allowlist: ${cfg?.allowedSymbols.length}`, detail: 'Only listed symbols may trade.' },
    { sev: 'pass', name: cfg?.killSwitch ? 'Kill switch ON' : 'Kill switch armed', detail: cfg?.killSwitch ? 'Every send is blocked.' : 'Sends pass to the risk gate.' },
    { sev: 'pass', name: 'No browser key form', detail: 'Keys never touch the frontend.' },
    { sev: 'pass', name: 'Cloudflare-gated', detail: 'Hardware-key auth before load.' },
  ];
  const checks = raw.filter(Boolean) as { sev: Sev; name: string; detail: string; page?: Page }[];
  const actions = checks.filter((c) => c.sev === 'action');
  const invest = checks.filter((c) => c.sev === 'invest');
  const passed = checks.filter((c) => c.sev === 'pass');
  const attention = [...actions, ...invest];
  const topFix = attention[0];
  const badge = actions.length;

  return (
    <div className="menu-wrap" ref={ref}>
      <button className={`hdr-ic tint-advisor ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Trusted Advisor — safety scan" aria-label="Trusted Advisor">
        <IconShield size={16} />
        {badge > 0 && <span className="ic-badge">{badge}</span>}
      </button>
      {open && (
        <div className="menu-pop right adv-pop">
          <div className="np-head">
            <span className="np-title"><IconShield size={14} /> Trusted Advisor</span>
            <span className="np-sub">{scanTs ? `scanned ${timeAgo(scanTs)}` : 'scanning…'}</span>
          </div>
          <div className="adv-stats">
            <div className="adv-stat action"><span className="adv-ic">✕</span><b>{actions.length}</b><em>Action recommended</em></div>
            <div className="adv-stat invest"><span className="adv-ic">!</span><b>{invest.length}</b><em>Investigation recommended</em></div>
            <div className="adv-stat pass"><span className="adv-ic">✓</span><b>{passed.length}</b><em>Passed items</em></div>
          </div>
          <div className="adv-list">
            {attention.length === 0 ? (
              <div className="adv-clean">✓ All clear — nothing needs attention.</div>
            ) : (
              attention.slice(0, 5).map((c) => (
                <button key={c.name} className={`adv-row ${c.sev}`} onClick={() => { if (c.page) { setOpen(false); setPage(c.page); } }}>
                  <span className="adv-row-dot" />
                  <span className="adv-row-meta"><b>{c.name}</b><small>{c.detail}</small></span>
                </button>
              ))
            )}
          </div>
          <div className="adv-actions">
            <button className="adv-scan" onClick={scan} disabled={scanning}>{scanning ? 'Scanning…' : 'Scan again'}</button>
            <button className="adv-fix" disabled={!topFix?.page} onClick={() => { if (topFix?.page) { setOpen(false); setPage(topFix.page); } }}>Fix top issue →</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- ONE shared morphing popover for the whole top bar (Aave-style) ---------
// A single box: centered under the hovered trigger with a pointer aimed at it.
// Moving to another trigger doesn't close/reopen — the same box slides, resizes
// (via the per-key width) and the pointer re-aims; only the contents cross-fade.
type MK = 'clock' | 'shell' | 'apikey' | 'apikey2' | 'network' | 'data' | 'alerts' | 'currency' | 'advisor' | 'notif' | 'power' | 'zoom' | 'settings' | 'theme';
const MENU_W: Record<MK, number> = {
  clock: 248, shell: 276, apikey: 300, apikey2: 300, network: 288, data: 290, alerts: 302, currency: 240,
  advisor: 300, notif: 328, power: 250, zoom: 208, settings: 236, theme: 222,
};

export interface ApiKeyInfo {
  id: string; name: string; type: string; scope: string;
  status: 'live' | 'declared' | 'planned'; live: boolean; keysPresent?: boolean;
  prefix: string; fingerprint: string | null;
  ipRestrict: boolean; ips: string[]; ipNote: string;
  permissions: { reading: boolean; spotMargin: boolean; marginLoan: boolean; withdrawals: boolean; universalTransfer: boolean; futures: boolean };
  note: string | null;
}
// The six permissions the owner wants visible, in display order.
export const API_PERMS: { key: keyof ApiKeyInfo['permissions']; label: string }[] = [
  { key: 'reading', label: 'Reading' },
  { key: 'spotMargin', label: 'Spot & Margin & Stock Trading' },
  { key: 'marginLoan', label: 'Margin Loan, Repay & Transfer' },
  { key: 'withdrawals', label: 'Withdrawals' },
  { key: 'universalTransfer', label: 'Permits Universal Transfer' },
  { key: 'futures', label: 'Futures' },
];

function SharedTopBar() {
  const { state, connected, prefs, updatePref, setPage, setKill } = useStore();
  const theme = useResolvedTheme();
  const rowRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Partial<Record<MK, HTMLButtonElement | null>>>({});
  const closeT = useRef<number | undefined>(undefined);
  const rafRef = useRef<number | undefined>(undefined);
  const [active, setActive] = useState<MK | null>(null);
  const [geo, setGeo] = useState({ left: 0, width: 260, pointer: 130 });
  const geoRef = useRef(geo); geoRef.current = geo;
  // Register with the shared single-open closer so opening the box closes any
  // other popover (the account panel) and vice-versa — never two open at once.
  const closerRef = useRef<() => void>(() => {});
  closerRef.current = () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); setActive(null); };
  const [now, setNow] = useState(() => new Date());
  const [sys, setSys] = useState<SystemLite | null>(null);
  const [srv, setSrv] = useState({ news: false, cal: false, fx: false });
  const [seen, setSeen] = useState(() => Number(localStorage.getItem('cosmos-notif-seen') || 0));
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { let al = true; const load = () => fetch('/api/system').then((r) => (r.ok ? r.json() : null)).then((s) => al && s && setSys(s as SystemLite)).catch(() => undefined); void load(); const t = setInterval(load, 5000); return () => { al = false; clearInterval(t); }; }, []);
  useEffect(() => {
    let al = true;
    fetch('/api/apikey').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (al && d?.keys?.length) setApiKeys(d.keys as ApiKeyInfo[]);
    }).catch(() => undefined);
    return () => { al = false; };
  }, []);
  useEffect(() => {
    if (active !== 'data') return; let al = true;
    const p = (u: string, k: 'news' | 'cal' | 'fx') => fetch(u).then((r) => al && setSrv((x) => ({ ...x, [k]: r.ok }))).catch(() => al && setSrv((x) => ({ ...x, [k]: false })));
    void p('/api/news', 'news'); void p('/api/calendar', 'cal'); void p('/api/fx', 'fx');
    return () => { al = false; };
  }, [active]);

  // Compute the box geometry for a trigger, in the row's LOCAL (pre-zoom) space.
  const computeGeo = (k: MK) => {
    const btn = btnRefs.current[k]; const row = rowRef.current;
    if (!btn || !row) return null;
    const w = MENU_W[k];
    // The app is CSS-zoomed on :root, so getBoundingClientRect is post-zoom while
    // the box's `left`/`width` are pre-zoom. Position via offsetLeft/Width (local
    // px, same system as `left`); only the viewport clamp needs the zoom factor.
    const rr = row.getBoundingClientRect();
    const zoom = rr.width / (row.offsetWidth || 1) || 1;
    const triggerCenter = btn.offsetLeft + btn.offsetWidth / 2;
    let left = triggerCenter - w / 2;
    const minLeft = (10 - rr.left) / zoom;
    const maxLeft = (window.innerWidth - 10 - rr.left) / zoom - w;
    if (maxLeft > minLeft) left = Math.max(minLeft, Math.min(left, maxLeft));
    const pointer = Math.max(18, Math.min(w - 18, triggerCenter - left));
    return { left, width: w, pointer };
  };

  // CSS transitions on left/width freeze under the :root `zoom` (a Chrome quirk —
  // the layout stays at the old value until a reflow). So we tween the box with
  // requestAnimationFrame: each frame is a React state commit, which reflows
  // correctly and slides smoothly. Opening from closed snaps into place instantly.
  const animateTo = (target: { left: number; width: number; pointer: number }, immediate: boolean) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (immediate) { setGeo(target); return; }
    const start = geoRef.current; const t0 = performance.now(); const dur = 340;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const step = (nowT: number) => {
      const p = Math.min(1, (nowT - t0) / dur); const e = ease(p);
      setGeo({
        left: start.left + (target.left - start.left) * e,
        width: start.width + (target.width - start.width) * e,
        pointer: start.pointer + (target.pointer - start.pointer) * e,
      });
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const openK = (k: MK) => {
    window.clearTimeout(closeT.current);
    if (currentCloser && currentCloser !== closerRef.current) currentCloser(); // close account/other
    const wasClosed = active === null;
    currentCloser = closerRef.current;
    const g = computeGeo(k);
    if (g) animateTo(g, wasClosed); // snap when opening fresh, slide when morphing
    setActive(k);
    if (k === 'notif' && state?.events?.[0]) { setSeen(state.events[0].id); localStorage.setItem('cosmos-notif-seen', String(state.events[0].id)); }
  };
  const scheduleClose = () => { closeT.current = window.setTimeout(() => { if (currentCloser === closerRef.current) currentCloser = null; closerRef.current(); }, 120); };
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);
  const cancelClose = () => window.clearTimeout(closeT.current);

  const b = state?.binance; const cfg = state?.config;
  const roKey = apiKeys.find((k) => k.id === 'read-only') ?? apiKeys[0] ?? null;
  const fullKey = apiKeys.find((k) => k.id === 'secrets-full') ?? apiKeys[1] ?? null;
  const feeds = state?.feeds ?? {}; const feedList = Object.entries(feeds);
  const feedsOk = feedList.length > 0 && feedList.every(([, s]) => s === 'open');
  const lat = sys?.restLatencyMs ?? null;
  const netGrade = !connected ? 'bad' : !feedsOk || (lat !== null && lat > 900) ? 'warn' : 'ok';
  const latTone = lat === null ? '' : lat < 400 ? 'ok' : lat < 900 ? 'warn' : 'bad';
  const events = state?.events ?? []; const unread = events.filter((e) => e.id > seen).length;
  const zone = ZONES.find((z) => z.id === prefs.clockZone) ?? ZONES[1];
  const cur = CURRENCIES[prefs.currency] ? prefs.currency : 'USD'; const sym = CURRENCIES[cur].symbol.trim() || cur;
  const al = prefs.alerts; const alertsOn = Object.values(al).filter(Boolean).length;
  const zoomv = prefs.zoom || 1;
  const mode = state?.mode ?? 'HALTED';
  const modeClass = mode === 'HALTED' ? 'm-halted' : mode === 'LIVE_ARMED' ? 'm-live' : 'm-manual';
  const alertRows: { key: keyof typeof al; label: string; sub: string }[] = [
    { key: 'proposals', label: 'Strategy proposals', sub: 'New basis / spread signals' },
    { key: 'fills', label: 'Order fills', sub: 'Executions on your account' },
    { key: 'risk', label: 'Risk rejects', sub: 'Gate blocks & kill-switch trips' },
    { key: 'news', label: 'Binance announcements', sub: 'Listings, delistings, maintenance' },
  ];
  const dhSources = [
    { name: 'Binance market feed', ok: connected && feedsOk, detail: `${Object.keys(feeds).length} streams · ${msLabel(lat)}` },
    { name: 'Binance account', ok: !!b?.connected, detail: b?.keysPresent ? (b?.connected ? 'synced' : 'error') : 'no keys' },
    { name: 'Binance announcements', ok: srv.news, detail: srv.news ? 'reachable' : 'checking' },
    { name: 'Economic calendar', ok: srv.cal, detail: srv.cal ? 'reachable' : 'checking' },
    { name: 'FX rates', ok: srv.fx, detail: srv.fx ? 'reachable' : 'checking' },
  ];
  const advRaw: ({ sev: Sev; name: string; detail: string; page?: Page } | null)[] = [
    b?.canWithdraw ? { sev: 'action', name: 'Withdrawals enabled on key', detail: 'Rotate to a read-only key.', page: 'account' } : { sev: 'pass', name: 'Withdrawals disabled', detail: 'Key cannot move funds.' },
    b?.keysPresent && !b?.connected ? { sev: 'action', name: 'Account sync failing', detail: b?.lastError ?? 'Not syncing.', page: 'system' } : null,
    !connected ? { sev: 'invest', name: 'Cockpit socket offline', detail: 'Reconnecting.', page: 'system' } : null,
    !feedsOk ? { sev: 'invest', name: 'Market feed degraded', detail: 'A stream is not open.', page: 'system' } : { sev: 'pass', name: 'Market feeds live', detail: `${Object.keys(feeds).length} open.` },
    !b?.keysPresent ? { sev: 'invest', name: 'No read key set', detail: 'Account data hidden.', page: 'account' } : { sev: 'pass', name: 'Read key set', detail: 'Account data available.' },
    (cfg?.allowedSymbols?.length ?? 0) === 0 ? { sev: 'invest', name: 'Allowlist empty', detail: 'Safe default.', page: 'risk' } : { sev: 'pass', name: `Allowlist: ${cfg?.allowedSymbols.length}`, detail: 'Listed symbols only.' },
    { sev: 'pass', name: cfg?.killSwitch ? 'Kill switch ON' : 'Kill switch armed', detail: cfg?.killSwitch ? 'Sends blocked.' : 'Passes to risk gate.' },
    { sev: 'pass', name: 'Cloudflare-gated', detail: 'Hardware-key auth.' },
  ];
  const advChecks = advRaw.filter(Boolean) as { sev: Sev; name: string; detail: string; page?: Page }[];
  const advA = advChecks.filter((c) => c.sev === 'action'); const advI = advChecks.filter((c) => c.sev === 'invest'); const advP = advChecks.filter((c) => c.sev === 'pass');
  const advAtt = [...advA, ...advI];

  // Reposition only when the ACTIVE menu changes, when a trigger's width could
  // change (badges toggling, currency symbol, zone label), on zoom, or on window
  // resize — NOT every clock tick. (The clock uses tabular figures so ticking
  // seconds keep a constant width; otherwise every tick would shift the triggers
  // and restart the slide transition, leaving the box perpetually mid-flight.)
  const placeSig = `${alertsOn > 0}|${unread > 0}|${advA.length > 0}|${sym}|${zone.label}|${prefs.zoom}`;
  useLayoutEffect(() => {
    if (!active) return;
    const place = () => { const g = computeGeo(active); if (g) setGeo(g); };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, placeSig]);

  const trig = (k: MK, cls: string, inner: JSX.Element) => (
    <button ref={(el) => { btnRefs.current[k] = el; }} className={`${cls} ${active === k ? 'on' : ''}`} onMouseEnter={() => openK(k)} onClick={() => (active === k ? setActive(null) : openK(k))} aria-label={k}>
      {inner}
    </button>
  );

  const keyBody = (ak: ApiKeyInfo | null, Icon: (p: { size?: number }) => JSX.Element) => {
    if (!ak) return (<><div className="np-head"><span className="np-title"><Icon size={14} /> API key</span></div><div className="np-sub-line">No key manifest yet — check the server.</div></>);
    const statusLbl = ak.status === 'live' ? 'live' : ak.status === 'planned' ? 'planned' : 'declared';
    return (<>
      <div className="np-head"><span className="np-title"><Icon size={14} /> {ak.name}</span><span className="ak-type">{ak.type}</span></div>
      <div className="ak-idrow">
        <span className="ak-prefix num">{ak.prefix}<span className="ak-dots">••••••••••</span></span>
        <span className={`ak-live s-${ak.status}`}>{statusLbl}</span>
      </div>
      <div className="ak-ip"><IconShield size={12} />{ak.ipRestrict ? `Restricted · ${ak.ips.join(', ')}` : 'Unrestricted — any IP'}<small>{ak.ipNote}</small></div>
      <div className="menu-head">Permissions</div>
      <div className="ak-perms">{API_PERMS.map((p) => { const on = ak.permissions[p.key]; return (
        <span key={p.key} className={`ak-perm ${on ? 'on' : 'off'}`}><span className="ak-perm-ic">{on ? '✓' : '✕'}</span>{p.label}</span>); })}</div>
      {ak.note && <div className="menu-foot">{ak.note}</div>}
      <button className="ak-expand" onClick={() => { setActive(null); openOverlay('apikey'); }}>Expand ⤢</button>
    </>);
  };

  const content = (k: MK) => {
    switch (k) {
      case 'clock':
        return (<><div className="menu-head">Clock timezone</div>{ZONES.map((zz) => (
          <button key={zz.id} className={`menu-item ${zz.id === zone.id ? 'sel' : ''}`} onClick={() => { updatePref('clockZone', zz.id); }}>
            <span className="zp-code">{zz.label}</span><span className="zp-city">{zz.city}</span><span className="zp-time num">{fmtClockZone(zz.id, now)}</span>
          </button>))}</>);
      case 'shell':
        return (<><div className="np-head"><span className="np-title"><IconTerminal size={14} /> AWS CloudShell</span><span className="np-sub">cg-arbitrage-01</span></div>
          <div className="np-row"><span className="k">Instance</span><span className="v">cg-arbitrage-01</span></div>
          <div className="np-row"><span className="k">Runtime</span><span className="v">/opt/arbitrage-cosmos</span></div>
          <div className="np-row"><span className="k">Access</span><span className="v">SSM · Session Manager</span></div>
          <button className="adv-fix" style={{ width: '100%', marginTop: 10 }} onClick={() => { setActive(null); openOverlay('cloudshell'); }}>Open in-app CloudShell →</button></>);
      case 'apikey': return keyBody(roKey, IconKey);
      case 'apikey2': return keyBody(fullKey, IconLock);
      case 'network':
        return (<><div className="np-head"><span className={`np-title ${netGrade}`}><span className="net-dot" />{!connected ? 'Signal offline' : netGrade === 'ok' ? 'Signal healthy' : 'Signal degraded'}</span><span className="np-lat num">{!connected ? 'offline' : msLabel(lat)}</span></div>
          <div className="np-row"><span className="k">Binance REST latency</span><span className={`v num ${latTone}`}>{msLabel(lat)}</span></div>
          <div className="np-row"><span className="k">Clock drift</span><span className="v num">{msLabel(sys?.serverTimeDiffMs)}</span></div>
          <div className="np-row"><span className="k">Cockpit link</span><span className={`v ${connected ? 'ok' : 'bad'}`}>{connected ? 'live' : 'reconnecting'}</span></div>
          {feedList.map(([n, s]) => (<div key={n} className="np-row"><span className="k">{n}</span><span className={`v ${s === 'open' ? 'ok' : 'warn'}`}>{s}</span></div>))}
          <div className="np-row"><span className="k">Rate weight · 1m</span><span className="v num">{sys?.usedWeight1m ?? '—'}</span></div></>);
      case 'data':
        return (<><div className="np-head"><span className={`np-title ${netGrade}`}><LiveDot ok={netGrade !== 'bad'} /> Data health</span><span className="np-sub">source: Binance</span></div>
          {dhSources.map((s) => (<div key={s.name} className="dh-row"><span className={`dh-dot ${s.ok ? 'ok' : 'bad'}`} /><span className="dh-name">{s.name}</span><span className={`dh-detail ${s.ok ? '' : 'muted'}`}>{s.detail}</span></div>))}
          <div className="dh-params"><div className="menu-head">Parameters</div>
            <div className="np-row"><span className="k">Clock drift</span><span className="v num">{msLabel(sys?.serverTimeDiffMs)}</span></div>
            <div className="np-row"><span className="k">Pairs scanned</span><span className="v num">{state?.scanner.pairs ?? '—'}</span></div></div></>);
      case 'alerts':
        return (<><div className="np-head"><span className="np-title">Alerts</span><span className="np-sub">{alertsOn} on</span></div>
          {alertRows.map((r) => (<div key={r.key} className="alert-row"><div className="alert-meta"><span className="alert-label">{r.label}</span><span className="alert-sub">{r.sub}</span></div>
            <button className={`toggle ${al[r.key] ? 'on' : ''}`} onClick={() => updatePref('alerts', { ...al, [r.key]: !al[r.key] })}><span className="knob" /></button></div>))}
          <div className="menu-foot">Delivery wiring lands with live mode — toggles are saved.</div></>);
      case 'currency':
        return (<><div className="menu-head">Display currency</div>{Object.entries(CURRENCIES).map(([code, c]) => (
          <button key={code} className={`menu-item ${code === cur ? 'sel' : ''}`} onClick={() => updatePref('currency', code)}>
            <span className="cur-sym">{c.symbol.trim() || code}</span><span className="cur-label">{c.label}</span><span className="cur-code num">{code}</span></button>))}
          <div className="menu-foot">Rates: live, USD base · applied to money values</div></>);
      case 'advisor':
        return (<><div className="np-head"><span className="np-title"><IconShield size={14} /> Trusted Advisor</span></div>
          <div className="adv-stats">
            <div className="adv-stat action"><span className="adv-ic">✕</span><b>{advA.length}</b><em>Action recommended</em></div>
            <div className="adv-stat invest"><span className="adv-ic">!</span><b>{advI.length}</b><em>Investigation recommended</em></div>
            <div className="adv-stat pass"><span className="adv-ic">✓</span><b>{advP.length}</b><em>Passed items</em></div></div>
          <div className="adv-list">{advAtt.length === 0 ? <div className="adv-clean">✓ All clear.</div> : advAtt.slice(0, 4).map((c) => (
            <button key={c.name} className={`adv-row ${c.sev}`} onClick={() => { if (c.page) { setActive(null); setPage(c.page); } }}><span className="adv-row-dot" /><span className="adv-row-meta"><b>{c.name}</b><small>{c.detail}</small></span></button>))}</div>
          <div className="adv-actions"><button className="adv-scan" onClick={() => setActive(null)}>Close</button><button className="adv-fix" disabled={!advAtt[0]?.page} onClick={() => { if (advAtt[0]?.page) { setActive(null); setPage(advAtt[0].page!); } }}>Fix top issue →</button></div></>);
      case 'notif':
        return (<><div className="np-head"><span className="np-title">Notifications</span><button className="np-link" onClick={() => { setActive(null); setPage('ledger'); }}>Ledger →</button></div>
          <div className="np-sub-line">Your cockpit only — proposals, fills, risk.</div>
          {events.length === 0 ? <div className="snn-empty">No events yet</div> : events.slice(0, 7).map((e) => { const tone = e.kind.includes('error') ? 'bad' : e.kind.includes('fill') ? 'ok' : e.kind.includes('risk') ? 'warn' : '';
            return (<button key={e.id} className="notif-row" onClick={() => { setActive(null); setPage('ledger'); }}><span className={`notif-dot ${tone}`} /><span className="notif-text">{eventSummary(e.kind, (e.data as Record<string, unknown> | null) ?? null, e.symbol)}</span><span className="notif-time num">{timeAgo(e.ts)}</span></button>); })}</>);
      case 'power':
        return (<><div className="np-head"><span className={`np-title ${mode === 'HALTED' ? 'bad' : 'ok'}`}><span className="net-dot" />{mode === 'LIVE_ARMED' ? 'Live armed' : mode === 'HALTED' ? 'Halted' : 'Manual mode'}</span></div>
          <div className="np-sub-line">{mode === 'HALTED' ? 'Kill switch is ON — every send is blocked.' : 'Sends pass to the risk gate.'}</div>
          <div className="adv-actions">{mode === 'HALTED'
            ? <button className="adv-fix" style={{ width: '100%' }} onClick={() => { void setKill(false); }}>Arm manual mode</button>
            : <button className="adv-fix" style={{ width: '100%', background: 'var(--down)' }} onClick={() => { void setKill(true); }}>Kill switch — halt now</button>}</div>
          <button className="adv-scan" style={{ width: '100%', marginTop: 6 }} onClick={() => { setActive(null); setPage('risk'); }}>Open Risk →</button></>);
      case 'zoom':
        return (<><div className="menu-head">Zoom</div><div className="zoom-row"><button className="zoom-btn" onClick={() => updatePref('zoom', Math.max(0.8, Math.round((zoomv - 0.05) * 100) / 100))}>−</button><span className="zoom-val num">{Math.round(zoomv * 100)}%</span><button className="zoom-btn" onClick={() => updatePref('zoom', Math.min(1.5, Math.round((zoomv + 0.05) * 100) / 100))}>+</button></div><button className="zoom-reset" onClick={() => updatePref('zoom', 1)}>Reset to 100%</button></>);
      case 'settings':
        return (<><div className="menu-head">Settings</div>
          <button className="menu-item" onClick={() => { setActive(null); setPage('settings'); }}><span className="cur-label">Open full settings</span><span className="cur-code">→</span></button>
          <button className="menu-item" onClick={() => { setActive(null); setPage('risk'); }}><span className="cur-label">Risk & gate</span><span className="cur-code">→</span></button>
          <button className="menu-item" onClick={() => { setActive(null); setPage('system'); }}><span className="cur-label">System health</span><span className="cur-code">→</span></button></>);
      case 'theme':
        return (<><div className="menu-head">Appearance</div><div className="theme-seg">{([{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }, { id: 'system', label: 'Auto' }] as const).map((m) => (<button key={m.id} className={prefs.theme === m.id ? 'on' : ''} onClick={() => updatePref('theme', m.id)}>{m.label}</button>))}</div>
          <div className="menu-head">Accent</div><div className="accent-dots">{ACCENT_ORDER.map((kk) => (<button key={kk} className={`accent-dot ${prefs.accent === kk ? 'sel' : ''}`} style={{ '--dot': ACCENTS[kk].hex } as CSSProperties} onClick={() => updatePref('accent', kk)} />))}</div></>);
    }
  };

  return (
    <div className="smenu-bar" ref={rowRef} onMouseLeave={scheduleClose}>
      {trig('clock', 'hdr-clock-btn', <><span className="num">{fmtClockZone(zone.id, now)}</span><span className="hcb-zone">{zone.label}</span></>)}
      {trig('shell', 'hdr-ic tint-shell', <IconTerminal size={16} />)}
      {trig('apikey', 'apikey-pill ro', <><IconKey size={15} /><span className={`apikey-dot s-${roKey?.status ?? 'declared'}`} /></>)}
      {trig('apikey2', 'apikey-pill full', <><IconLock size={15} /><span className={`apikey-dot s-${fullKey?.status ?? 'planned'}`} /></>)}
      {trig('network', `net-btn wifi ${netGrade}`, <WifiSignal grade={netGrade} />)}
      {trig('data', `hdr-ic tint-data grade-${netGrade}`, <IconDatabase size={18} />)}
      {trig('alerts', 'hdr-ic', <><IconAlarm size={16} />{alertsOn > 0 && <span className="ic-dot accent" />}</>)}
      {trig('currency', 'ic-pill cur-pill', <span className="cur-glyph">{sym}</span>)}
      {trig('advisor', 'hdr-ic tint-advisor', <><IconShield size={16} />{advA.length > 0 && <span className="ic-badge">{advA.length}</span>}</>)}
      {trig('notif', 'hdr-ic', <><IconBell size={16} />{unread > 0 && <span className="ic-badge">{unread > 9 ? '9+' : unread}</span>}</>)}
      {trig('power', `hdr-ic ${modeClass}`, <><IconPower size={15} /><span className="ic-dot" /></>)}
      {trig('zoom', 'hdr-ic', <IconMaximize size={16} />)}
      {trig('settings', 'icon-btn', <IconGear size={16} />)}
      {trig('theme', 'icon-btn', theme === 'light' ? <IconMoon size={15} /> : <IconSun size={15} />)}
      {active && (
        <div className="smenu" style={{ left: geo.left, width: geo.width }} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
          <span className="smenu-arrow" style={{ left: geo.pointer }} />
          <div className="smenu-content" key={active}>{content(active)}</div>
        </div>
      )}
    </div>
  );
}

// Payment-app style success / failure marks for the refresh dock.
const IconCheck = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
);
const IconCross = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
);

type ConnTier = 'good' | 'avg' | 'slow' | 'bad';
const TIER_SCORE: Record<ConnTier, number> = { good: 3, avg: 2, slow: 1, bad: 0 };
function latTier(ms: number | null | undefined, good: number, avg: number, slow: number): ConnTier {
  if (ms === null || ms === undefined) return 'bad';
  if (ms < good) return 'good';
  if (ms < avg) return 'avg';
  if (ms < slow) return 'slow';
  return 'bad';
}

// Always-on floating dock (bottom-right). Its resting colour reflects overall
// connection health (neutral → green when strong, orange when slow, red when
// laggy/down). Hover shows a small popover listing each connection's latency.
// Click spins a few slow, smooth turns while it re-pulls + reconnects EVERYTHING
// in the background (no page reload), then draws a green tick (payment-app style)
// that fades back to the health colour — or a red cross if something failed.
export function RefreshDock() {
  const { state, connected, refresh } = useStore();
  const [sys, setSys] = useState<SystemLite | null>(null);
  const [appRtt, setAppRtt] = useState<number | null>(null);
  const [st, setSt] = useState<'idle' | 'spin' | 'ok' | 'err'>('idle');
  const [open, setOpen] = useState(false);
  const busy = useRef(false);
  const icRef = useRef<HTMLSpanElement>(null);

  // Drive the spin with the Web Animations API rather than a CSS class: under the
  // :root zoom, a CSS keyframe rotation restarts on every React re-render (the
  // dock re-renders on each WS state push), which reads as a crazy-fast jitter.
  // This animation is created ONCE per spin, so it turns steadily — one calm
  // rotation every 1.25s — regardless of the render cycle.
  useEffect(() => {
    const el = icRef.current;
    if (st !== 'spin' || !el) return;
    const anim = el.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      { duration: 1250, iterations: Infinity, easing: 'linear' }
    );
    return () => anim.cancel();
  }, [st]);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      const t0 = performance.now();
      try { const r = await fetch('/api/health', { cache: 'no-store' }); if (!r.ok) throw new Error(); if (alive) setAppRtt(performance.now() - t0); }
      catch { if (alive) setAppRtt(null); }
    };
    void ping(); const t = window.setInterval(ping, 5000); return () => { alive = false; window.clearInterval(t); };
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/system').then((r) => (r.ok ? r.json() : null)).then((s) => alive && s && setSys(s as SystemLite)).catch(() => undefined);
    void load(); const t = window.setInterval(load, 5000); return () => { alive = false; window.clearInterval(t); };
  }, []);

  const feeds = state?.feeds ?? {};
  const feedVals = Object.values(feeds);
  const feedsOk = feedVals.length > 0 && feedVals.every((s) => s === 'open');
  const rest = sys?.restLatencyMs ?? null;
  const drift = sys?.serverTimeDiffMs ?? null;
  const b = state?.binance;
  const acctTs = b?.lastSyncTs ?? null;
  const userStream = b?.userStream ?? 'unknown';
  const lastError = b?.lastError ?? null;
  const weight = sys?.usedWeight1m ?? null;
  const dbOk = sys?.dbOk;

  const ageTier = (ts: number | null, freshMs: number): ConnTier =>
    !ts ? 'bad' : Date.now() - ts <= freshMs ? 'good' : Date.now() - ts <= freshMs * 3 ? 'avg' : Date.now() - ts <= freshMs * 6 ? 'slow' : 'bad';
  const streamTier: ConnTier = userStream === 'open' ? 'good' : userStream === 'failed' ? 'slow' : 'avg';
  const weightTier: ConnTier = weight == null ? 'avg' : weight >= 4800 ? 'bad' : weight >= 3000 ? 'slow' : 'good';

  const conns: { key: string; label: string; value: string; tier: ConnTier }[] = [
    { key: 'app', label: 'Browser → server', value: appRtt != null ? msLabel(appRtt) : 'offline', tier: latTier(appRtt, 120, 350, 800) },
    { key: 'binance', label: 'Binance REST', value: rest != null ? msLabel(rest) : '—', tier: latTier(rest, 300, 600, 1100) },
    { key: 'socket', label: 'Live socket', value: connected ? 'live' : 'reconnecting', tier: connected ? 'good' : 'bad' },
    { key: 'feed', label: 'Market feed', value: feedVals.length ? (feedsOk ? `${feedVals.length} open` : 'degraded') : 'idle', tier: feedVals.length ? (feedsOk ? 'good' : 'slow') : 'avg' },
    { key: 'account', label: 'Account sync', value: b?.keysPresent ? (acctTs ? timeAgo(acctTs) : 'no sync') : 'no key', tier: b?.keysPresent ? ageTier(acctTs, 90_000) : 'avg' },
    { key: 'stream', label: 'User stream', value: String(userStream), tier: streamTier },
    { key: 'drift', label: 'Clock drift', value: drift != null ? msLabel(drift) : '—', tier: latTier(drift != null ? Math.abs(drift) : null, 400, 1200, 2500) },
    { key: 'weight', label: 'Rate budget · 1m', value: weight != null ? String(weight) : '—', tier: weightTier },
    { key: 'db', label: 'Ledger DB', value: dbOk === undefined ? '—' : dbOk ? 'writable' : 'broken', tier: dbOk === undefined ? 'avg' : dbOk ? 'good' : 'bad' },
  ];

  // Overall button colour: hard red on a real outage; otherwise average the CORE
  // connection scores. The user-data stream + rate budget are shown but excluded
  // from the average — the stream stays 'failed' on a read-only key (the server
  // polls instead), so it must not keep the button perpetually red/orange.
  let overall: ConnTier;
  if (!connected || dbOk === false || !!lastError || (b?.keysPresent && !b?.connected)) overall = 'bad';
  else {
    const core = conns.filter((c) => c.key !== 'stream' && c.key !== 'weight');
    const avg = core.reduce((s, c) => s + TIER_SCORE[c.tier], 0) / core.length;
    overall = avg >= 2.6 ? 'good' : avg >= 1.8 ? 'avg' : avg >= 0.9 ? 'slow' : 'bad';
  }

  const run = async () => {
    if (busy.current) return;
    busy.current = true; setSt('spin');
    const t0 = Date.now();
    let res: { ok: boolean; issues: string[] };
    try { res = await refresh(); } catch { res = { ok: false, issues: ['Refresh failed'] }; }
    const wait = Math.max(0, 2050 - (Date.now() - t0)); // let it spin a few smooth turns
    window.setTimeout(() => {
      if (res.ok) { setSt('ok'); window.setTimeout(() => setSt('idle'), 1500); }
      else { setSt('err'); window.setTimeout(() => setSt('idle'), 2400); }
      busy.current = false;
    }, wait);
  };

  const label = st === 'spin' ? 'Refreshing all connections…' : st === 'ok' ? 'All connections refreshed' : st === 'err' ? 'Some connections failed — try again' : `Connection health: ${overall}`;

  return (
    <div className="rdock" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {open && (st === 'idle' || st === 'err') && (
        <div className="rdock-pop">
          <div className="rdock-pop-head"><span>Connection health</span><span className={`rdock-pop-tag t-${overall}`}>{overall}</span></div>
          {conns.map((c) => (
            <div key={c.key} className="rdock-conn">
              <span className={`rdock-conn-dot t-${c.tier}`} />
              <span className="rdock-conn-name">{c.label}</span>
              <span className={`rdock-conn-val num t-${c.tier}`}>{c.value}</span>
            </div>
          ))}
          {lastError && (
            <div className="rdock-conn rdock-conn-err" title={lastError}>
              <span className="rdock-conn-dot t-bad" />
              <span className="rdock-conn-name">Last error</span>
              <span className="rdock-conn-val t-bad">{lastError}</span>
            </div>
          )}
          <div className="rdock-pop-foot">Click to refresh &amp; reconnect everything</div>
        </div>
      )}
      <button className={`rdock-btn t-${overall} ${st}`} onClick={run} title={label} aria-label={label}>
        <span className="rdock-ic" ref={icRef}>{st === 'ok' ? <IconCheck size={20} /> : st === 'err' ? <IconCross size={20} /> : <IconRefresh size={19} />}</span>
      </button>
    </div>
  );
}

export function Topbar() {
  const { page } = useStore();

  useEffect(() => {
    document.title = `Arbitrage Control · ${TITLES[page]}`;
  }, [page]);

  return (
    <header className="hdr">
      <div className="hdr-in">
        <div className="tb-left">
          <SidebarSearch placement="topbar" />
        </div>
        <div className="hdr-right">
          <SharedTopBar />
          <AccountCard compact />
        </div>
      </div>
    </header>
  );
}

// ============================ quick-view overlays ============================

export interface NewsRow {
  id: number;
  title: string;
  date: string | null;
  url: string;
}

function NewsModal({ onClose }: { onClose: () => void }) {
  const { setPage } = useStore();
  const [tab, setTab] = useState<number>(48);
  const [items, setItems] = useState<NewsRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setFailed(false);
    fetch(`/api/news?catalog=${tab}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad'))))
      .then((d: { items: NewsRow[] }) => alive && setItems(d.items ?? []))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [tab]);

  return (
    <div className="ov-backdrop" onMouseDown={onClose}>
      <div className="ov-modal news-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ov-head">
          <div className="ov-title"><IconNewspaper size={17} /> Binance news <LiveDot /></div>
          <div className="ov-actions">
            <button className="ov-btn" onClick={() => { onClose(); setPage('news'); }}>Full page →</button>
            <a className="ov-btn" href="https://www.binance.com/en/support/announcement" target="_blank" rel="noreferrer noopener"><IconExternal size={14} /> Binance</a>
            <button className="ov-close" onClick={onClose} aria-label="Close"><IconClose size={16} /></button>
          </div>
        </div>
        <div className="news-tabs">
          {NEWS_TABS.map((t) => (
            <button key={t.id} className={`news-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="news-list">
          {items && items.length > 0 ? (
            items.slice(0, 10).map((it) => (
              <a key={it.id} className="news-item" href={it.url} target="_blank" rel="noreferrer noopener">
                <span className="news-item-title">{it.title}</span>
                <span className="news-item-meta">
                  {it.date && <span className="news-item-date num">{it.date}</span>}
                  <IconExternal size={13} />
                </span>
              </a>
            ))
          ) : (
            <div className="ov-empty">{failed ? 'Feed unavailable — Binance could not be reached.' : items ? 'No announcements in this category.' : 'Loading…'}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export interface CalItem {
  id: string;
  title: string;
  country: string;
  indicator: string;
  importance: number;
  period: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  unit: string | null;
  date: string;
}
export function calVal(v: number | null, unit: string | null): string {
  if (v === null || v === undefined) return '—';
  const s = Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(v);
  return unit ? `${s}${unit}` : s;
}
function CalendarModal({ onClose }: { onClose: () => void }) {
  const { setPage, prefs } = useStore();
  const [items, setItems] = useState<CalItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const zone = prefs.clockZone && prefs.clockZone !== 'local' ? prefs.clockZone : undefined;

  useEffect(() => {
    let alive = true;
    fetch('/api/calendar')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad'))))
      .then((d: { items: CalItem[] }) => alive && setItems(d.items ?? []))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const days: { key: string; label: string; rows: CalItem[] }[] = [];
  for (const it of items ?? []) {
    const d = new Date(it.date);
    if (isNaN(d.getTime())) continue;
    const key = d.toLocaleDateString('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    let g = days.find((x) => x.key === key);
    if (!g) {
      g = { key, label: d.toLocaleDateString('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }), rows: [] };
      days.push(g);
    }
    g.rows.push(it);
  }

  return (
    <div className="ov-backdrop" onMouseDown={onClose}>
      <div className="ov-modal cal-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ov-head">
          <div className="ov-title"><IconCalendar size={17} /> Economic calendar <LiveDot /></div>
          <div className="ov-actions">
            <button className="ov-btn" onClick={() => { onClose(); setPage('calendar'); }}>Full page →</button>
            <a className="ov-btn" href="https://www.tradingview.com/economic-calendar/" target="_blank" rel="noreferrer noopener"><IconExternal size={14} /> TradingView</a>
            <button className="ov-close" onClick={onClose} aria-label="Close"><IconClose size={16} /></button>
          </div>
        </div>
        <div className="cal-cols">
          <span className="cc-time">Time</span><span className="cc-evt">Event</span>
          <span className="cc-num">Actual</span><span className="cc-num">Forecast</span><span className="cc-num">Prior</span>
        </div>
        <div className="cal-list">
          {items && items.length > 0 ? (
            days.map((g) => (
              <div key={g.key} className="cal-day">
                <div className="cal-day-head">{g.label}</div>
                {g.rows.map((it) => {
                  const imp = it.importance >= 1 ? 'high' : it.importance === 0 ? 'med' : 'low';
                  const t = new Date(it.date).toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
                  return (
                    <div key={it.id} className="cal-row">
                      <span className="cc-time num">{t}</span>
                      <span className="cc-evt">
                        <span className="cal-flag">{flag(it.country)}</span>
                        <span className={`cal-imp ${imp}`} />
                        <span className="cal-title">{it.title}{it.period ? <span className="cal-period"> {it.period}</span> : null}</span>
                      </span>
                      <span className="cc-num num strong">{calVal(it.actual, it.unit)}</span>
                      <span className="cc-num num">{calVal(it.forecast, it.unit)}</span>
                      <span className="cc-num num muted">{calVal(it.previous, it.unit)}</span>
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="ov-empty">{failed ? 'Calendar unavailable — source could not be reached.' : items ? 'No events in range.' : 'Loading…'}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// AWS CloudShell quick-view. Terminal-styled launcher — it looks like AWS
// CloudShell and is grounded in the real deploy target, but it does not fake an
// attached session: "Open in AWS" (or Enter) starts the real console session.
function CloudShellModal({ onClose }: { onClose: () => void }) {
  const [cmd, setCmd] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const launch = () => window.open(CLOUD_SHELL_URL, '_blank', 'noopener,noreferrer');

  return (
    <div className="ov-backdrop" onMouseDown={onClose}>
      <div className="ov-modal cs-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ov-head cs-head">
          <div className="ov-title"><IconTerminal size={16} /> AWS CloudShell</div>
          <div className="ov-actions">
            <span className="cs-region">cg-arbitrage-01</span>
            <button className="ov-btn" onClick={launch}><IconExternal size={14} /> Open in AWS</button>
            <button className="ov-close" onClick={onClose} aria-label="Close"><IconClose size={16} /></button>
          </div>
        </div>
        <div className="cs-term" onMouseDown={() => inputRef.current?.focus()}>
          <div className="cs-banner">AWS CloudShell</div>
          <div className="cs-line muted">Cosmos Arbitrage Control Room · deploy target (not a live session)</div>
          <div className="cs-line">&nbsp;</div>
          <div className="cs-line"><span className="cs-k">instance</span> <b>cg-arbitrage-01</b></div>
          <div className="cs-line"><span className="cs-k">runtime&nbsp;</span> <b>/opt/arbitrage-cosmos</b></div>
          <div className="cs-line"><span className="cs-k">user&nbsp;&nbsp;&nbsp;</span> <b>ubuntu</b></div>
          <div className="cs-line"><span className="cs-k">access&nbsp;</span> <b>AWS Systems Manager · Session Manager</b></div>
          <div className="cs-line">&nbsp;</div>
          <div className="cs-line muted">Commands run in the real console — press Enter to open a live session ↗</div>
          <div className="cs-promptline">
            <span className="cs-prompt">ubuntu@ip-172-31-2-134:~$</span>
            <input
              ref={inputRef}
              className="cs-input"
              autoFocus
              value={cmd}
              spellCheck={false}
              aria-label="CloudShell launcher"
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { launch(); setCmd(''); } }}
            />
          </div>
        </div>
        <div className="cs-foot">
          In-browser execution isn’t attached — this is a launcher. “Open in AWS” starts a real CloudShell session.
        </div>
      </div>
    </div>
  );
}

function ApiKeyModal({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  useEffect(() => {
    let al = true;
    fetch('/api/apikey').then((r) => (r.ok ? r.json() : null)).then((d) => { if (al && d?.keys) setKeys(d.keys as ApiKeyInfo[]); }).catch(() => undefined);
    return () => { al = false; };
  }, []);
  return (
    <div className="ov-backdrop" onMouseDown={onClose}>
      <div className="ov-modal ak-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ov-head">
          <div className="ov-title"><IconKey size={16} /> API keys</div>
          <div className="ov-actions"><button className="ov-close" onClick={onClose} aria-label="Close"><IconClose size={16} /></button></div>
        </div>
        <div className="ak-modal-body">
          <p className="ak-modal-intro">Which Binance key is wired into this deployment and what it may do. The key and secret are never shown — only the first characters, so you can confirm a rotation.</p>
          {keys.length === 0 ? <div className="ak-empty">No key manifest available.</div> : keys.map((ak) => (
            <div key={ak.id} className="ak-card">
              <div className="ak-card-head">
                <span className="ak-card-name"><IconKey size={15} /> {ak.name}</span>
                <span className="ak-badges"><span className="ak-type">{ak.type}</span><span className="ak-scope">{ak.scope}</span><span className={`ak-live s-${ak.status}`}>{ak.status}</span></span>
              </div>
              <div className="ak-card-rows">
                <div className="ak-crow"><span className="k">Key</span><span className="v num">{ak.prefix}<span className="ak-dots">••••••••••••••••</span></span></div>
                <div className="ak-crow"><span className="k">IP access</span><span className="v">{ak.ipRestrict ? `Restricted · ${ak.ips.join(', ')}` : 'Unrestricted — any IP'} <em>{ak.ipNote}</em></span></div>
              </div>
              <div className="ak-card-perms">{API_PERMS.map((p) => { const on = ak.permissions[p.key]; return (
                <span key={p.key} className={`ak-perm ${on ? 'on' : 'off'}`}><span className="ak-perm-ic">{on ? '✓' : '✕'}</span>{p.label}</span>); })}</div>
              {ak.note && <div className="ak-card-note">{ak.note}</div>}
            </div>
          ))}
        </div>
        <div className="cs-foot">Edit the manifest server-side (env: BINANCE_KEY_NAME / _TYPE / _IPS) when you rotate or add a key.</div>
      </div>
    </div>
  );
}

// Rendered once at the app root so fixed overlays escape the sidebar box.
export function Overlays() {
  const [kind, set] = useOverlay();
  if (kind === 'news') return <NewsModal onClose={() => set(null)} />;
  if (kind === 'calendar') return <CalendarModal onClose={() => set(null)} />;
  if (kind === 'cloudshell') return <CloudShellModal onClose={() => set(null)} />;
  if (kind === 'apikey') return <ApiKeyModal onClose={() => set(null)} />;
  return null;
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
