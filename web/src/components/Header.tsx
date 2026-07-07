import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useStore, useResolvedTheme, type Page } from '../store';
import { fmtClockZone, timeAgo } from '../format';
import { eventSummary } from '../lib/eventText';
import { ACCENTS, CURRENCIES, type AccentKey } from '../lib/prefs';
import { openOverlay, useOverlay } from '../lib/overlay';
import {
  IconActivity,
  IconAlarm,
  IconBell,
  IconBook,
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
  IconLayers,
  IconList,
  IconMaximize,
  IconMoon,
  IconNewspaper,
  IconPower,
  IconPulse,
  IconRadar,
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

const CLOUD_SHELL_URL = 'https://console.aws.amazon.com/cloudshell/home';

// Small popover controller: open state + a ref that closes on outside click / Esc.
function useMenu<T extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
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
  return { open, setOpen, ref };
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
  loans: 'Loans',
  trade: 'Execution',
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
  news: 'Binance News',
  calendar: 'Economic Calendar',
  rules: 'Rules',
};

type NavItem = { id?: Page; href?: string; label: string; icon: JSX.Element };
// Three zones, top→bottom: (1) COCKPIT — the big things you monitor;
// (2) STRATEGY BRAIN — where the background scripts live and are watched;
// (3) GUARD & SYSTEM — the security/system layer (news + calendar tiles and the
// HALTED pill render just below this in the Sidebar). Small labels, no boxes.
const NAV: { group: string | null; items: NavItem[] }[] = [
  {
    group: null,
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: <IconGrid size={17} /> },
      { id: 'account', label: 'Account', icon: <IconWallet size={17} /> },
      { id: 'wallets', label: 'Wallets', icon: <IconLayers size={17} /> },
    ],
  },
  {
    group: 'Markets',
    items: [
      { id: 'markets', label: 'Markets', icon: <IconChart size={17} /> },
      { id: 'detail', label: 'Tokens', icon: <IconRadar size={17} /> },
    ],
  },
  {
    group: 'Execution',
    items: [
      { id: 'trade', label: 'Trade', icon: <IconTicket size={17} /> },
      { id: 'orders', label: 'Orders', icon: <IconList size={17} /> },
      { id: 'positions', label: 'Positions', icon: <IconLayers size={17} /> },
      { id: 'fills', label: 'Fills', icon: <IconReceipt size={17} /> },
      { id: 'pnl', label: 'PnL', icon: <IconChart size={17} /> },
    ],
  },
  {
    group: 'Strategy Brain',
    items: [
      { id: 'strategies', label: 'Strategies', icon: <IconBrain size={17} /> },
      { id: 'opportunities', label: 'Signals', icon: <IconPulse size={17} /> },
      { id: 'loans', label: 'Borrow', icon: <IconCoins size={17} /> },
      { href: CLOUD_SHELL_URL, label: 'Cloud Shell', icon: <IconTerminal size={17} /> },
    ],
  },
  {
    group: 'Guard & Security',
    items: [
      { id: 'risk', label: 'Risk', icon: <IconShield size={17} /> },
      { id: 'rules', label: 'Rules', icon: <IconBook size={17} /> },
      { id: 'ledger', label: 'Ledger', icon: <IconList size={17} /> },
      { id: 'system', label: 'System', icon: <IconWifi size={17} /> },
      { id: 'settings', label: 'Settings', icon: <IconGear size={17} /> },
    ],
  },
];

// ---- account card (Binance-style profile chip + details) --------------------
function AccountCard({ compact = false }: { compact?: boolean }) {
  const { state, saveConfig, setPage } = useStore();
  const { open, setOpen, ref } = useMenu<HTMLDivElement>();
  const fileRef = useRef<HTMLInputElement>(null);
  const profile = state?.config.profile ?? { name: '', avatar: null };
  const [preview, setPreview] = useState<string | null>(null); // instant feedback before the 2s state tick
  const [editName, setEditName] = useState<string | null>(null);
  const avatar = preview ?? profile.avatar;
  const name = profile.name || 'Operator';
  const connected = !!state?.binance.keysPresent;
  const sub = connected ? (state?.binance.connected ? 'Binance · read-only' : 'Binance · error') : 'Binance · not linked';

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
            {[
              { key: 'by', name: 'Bybit' },
              { key: 'cb', name: 'Coinbase' },
              { key: 'ok', name: 'OKX' },
            ].map((e) => (
              <div key={e.key} className="acct-ex soon">
                <span className={`acct-ex-badge ${e.key}`}>{e.name[0]}</span>
                <span className="acct-ex-info"><b>{e.name}</b><small>not yet supported</small></span>
                <span className="acct-ex-pill soon">soon</span>
              </div>
            ))}
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
    { label: 'Rule creator', hint: 'Rules · governance', page: 'rules', keywords: 'rules allowed blocked strict governance create' },
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
            {g.items.map((n) =>
              n.href ? (
                <a key={n.label} className="snav-item" href={n.href} target="_blank" rel="noreferrer noopener" title={`${n.label} — opens AWS console`}>
                  <span className="snav-ic">{n.icon}</span>
                  <span className="snav-label">{n.label}</span>
                  <IconExternal size={11} />
                </a>
              ) : (
                <button
                  key={n.id}
                  className={`snav-item ${page === n.id ? 'active' : ''}`}
                  onClick={() => setPage(n.id!)}
                  title={n.label}
                >
                  <span className="snav-ic">{n.icon}</span>
                  <span className="snav-label">{n.label}</span>
                  {n.id === 'opportunities' && proposals > 0 && <span className="nav-badge">{proposals}</span>}
                </button>
              )
            )}
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

export function Topbar() {
  const { state, page, setPage, setKill } = useStore();
  const mode = state?.mode ?? 'HALTED';
  const modeClass = mode === 'HALTED' ? 'm-halted' : mode === 'LIVE_ARMED' ? 'm-live' : 'm-manual';

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
          <ClockMenu />
          <CurrencyMenu />
          <button className="hdr-ic tint-news" onClick={() => openOverlay('news')} title="Binance news — quick view" aria-label="Binance news quick view">
            <IconNewspaper size={16} />
          </button>
          <button className="hdr-ic tint-cal" onClick={() => openOverlay('calendar')} title="Economic calendar — quick view" aria-label="Economic calendar quick view">
            <IconCalendar size={16} />
          </button>
          <a className="hdr-ic tint-shell" href={CLOUD_SHELL_URL} target="_blank" rel="noreferrer noopener" title="AWS CloudShell — opens the AWS console" aria-label="AWS CloudShell">
            <IconTerminal size={16} />
          </a>
          <NetworkStatus />
          <DataHealthMenu />
          <AlertsMenu />
          <NotificationMenu />
          {mode === 'HALTED' ? (
            <button className="hdr-ic m-halted" onClick={() => setPage('risk')} title="Halted — open Risk to resume" aria-label="Halted — resume on Risk">
              <IconPower size={15} />
              <span className="ic-dot" />
            </button>
          ) : (
            <button className={`hdr-ic ${modeClass}`} onClick={() => void setKill(true)} title="Kill switch — halt all sends now" aria-label="Kill switch — halt now">
              <IconPower size={15} />
              <span className="ic-dot" />
            </button>
          )}
          <ZoomMenu />
          <button className={`icon-btn ${page === 'settings' ? 'on' : ''}`} onClick={() => setPage('settings')} title="Settings" aria-label="Settings">
            <IconGear size={16} />
          </button>
          <ThemeMenu />
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

// Rendered once at the app root so fixed overlays escape the sidebar box.
export function Overlays() {
  const [kind, set] = useOverlay();
  if (kind === 'news') return <NewsModal onClose={() => set(null)} />;
  if (kind === 'calendar') return <CalendarModal onClose={() => set(null)} />;
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
