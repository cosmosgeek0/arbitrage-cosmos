import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useStore, useResolvedTheme, type Page } from '../store';
import { fmtClockZone, timeAgo } from '../format';
import { eventSummary } from '../lib/eventText';
import { ACCENTS, CURRENCIES, type AccentKey } from '../lib/prefs';
import { openOverlay, useOverlay } from '../lib/overlay';
import { TokenIcon } from './TokenIcon';
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
  IconLayers,
  IconList,
  IconMaximize,
  IconMoon,
  IconNewspaper,
  IconPercent,
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
  { id: 'UTC', label: 'UTC', city: 'Universal time' },
  { id: 'Asia/Kolkata', label: 'IST', city: 'India · Mumbai' },
  { id: 'America/New_York', label: 'NY', city: 'New York' },
  { id: 'Europe/London', label: 'LDN', city: 'London' },
  { id: 'Asia/Singapore', label: 'SGT', city: 'Singapore' },
  { id: 'Asia/Tokyo', label: 'JST', city: 'Tokyo' },
];

const ACCENT_ORDER: AccentKey[] = ['r', 'o', 'y', 'g', 'b', 'i', 'v'];

const CLOUD_SHELL_URL = 'https://console.aws.amazon.com/cloudshell/home';
const DEFAULT_PROFILE_LOGO = '/profile-logo.png';
const DEPLOYED_APP_HOST = 'arbitrage.cosmosgeek.org';

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

/* Premium brand mark: three leaning market rails, no decorative status dots. */
const BRAND_MARK = (
  <svg viewBox="0 0 44 44" className="brand-mark" aria-hidden shapeRendering="geometricPrecision">
    <defs>
      <linearGradient id="brandRailA" x1="7" y1="33" x2="18" y2="9" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#6ba4ff" />
        <stop offset="1" stopColor="#2f6bff" />
      </linearGradient>
      <linearGradient id="brandRailB" x1="17" y1="35" x2="28" y2="7" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#4f7dff" />
        <stop offset="1" stopColor="#174eea" />
      </linearGradient>
      <linearGradient id="brandRailC" x1="28" y1="32" x2="37" y2="12" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#2f6bff" />
        <stop offset="1" stopColor="#0d2e9d" />
      </linearGradient>
    </defs>
    <path className="brand-rail rail-a" d="M9.1 16.4 15.1 13.7 12.6 31.2 6.6 33.9Z" fill="url(#brandRailA)" />
    <path className="brand-rail rail-b" d="M19.6 9.1 25.8 6.4 22.6 36.1 16.5 38.8Z" fill="url(#brandRailB)" />
    <path className="brand-rail rail-c" d="M30.9 14.1 36.9 11.4 34.2 28.8 28.2 31.5Z" fill="url(#brandRailC)" />
  </svg>
);

const TITLES: Record<Page, string> = {
  dashboard: 'Dashboard',
  account: 'Account',
  wallets: 'Account',
  markets: 'Markets',
  detail: 'Token Detail',
  loans: 'Borrow / Margin',
  orders: 'Account · Orders',
  positions: 'Account · Positions',
  fills: 'Account · Fills',
  pnl: 'Account · PnL',
  strategies: 'Basis',
  volume: 'Volume',
  opportunities: 'Opportunities',
  risk: 'Risk',
  ledger: 'Ledger / Logs',
  system: 'System Health',
  news: 'Binance News',
  calendar: 'Economic Calendar',
};

// `match` marks extra page ids that keep an item highlighted (Execution owns
// the trade/orders/positions/fills/pnl internal routes).
type NavItem = { id?: Page; label: string; icon: JSX.Element; match?: Page[] };
// Four zones (owner order 2026-07-08): OVERVIEW carries the money surfaces —
// Dashboard, Account, Borrow, Markets — then ENGINE / CONTROL / UTILITY.
// One sidebar item per operator surface — detail routes (Token Detail,
// Execution tabs) open from within pages, not from the sidebar.
const NAV: { group: string | null; items: NavItem[] }[] = [
  {
    group: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: <IconGrid size={17} /> },
      { id: 'account', label: 'Account', icon: <IconWallet size={17} /> },
      { id: 'loans', label: 'Borrow', icon: <IconCoins size={17} /> },
      { id: 'markets', label: 'Markets', icon: <IconChart size={17} /> },
      { id: 'detail', label: 'Token', icon: <IconLayers size={17} /> },
    ],
  },
  {
    group: 'Engine',
    items: [
      { id: 'strategies', label: 'Basis', icon: <IconBrain size={17} /> },
      { id: 'volume', label: 'Volume', icon: <IconPulse size={17} /> },
      { id: 'opportunities', label: 'Opportunities', icon: <IconRadar size={17} /> },
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
  {
    group: 'Utility',
    items: [
      { id: 'news', label: 'News', icon: <IconNewspaper size={17} /> },
      { id: 'calendar', label: 'Calendar', icon: <IconCalendar size={17} /> },
    ],
  },
];

interface AccountExchangeRow {
  id: string;
  name: string;
  type: string;
  scope: string;
  status: string;
  live: boolean;
  keysPresent: boolean;
  prefix: string;
  fingerprint: string | null;
  ipRestrict: boolean;
  permissions?: {
    reading?: boolean;
    spotMargin?: boolean;
    marginLoan?: boolean;
    withdrawals?: boolean;
    universalTransfer?: boolean;
    futures?: boolean;
  };
}
interface AccountSessionRow {
  id: string;
  ip: string | null;
  country: string | null;
  system: string;
  browser: string;
  firstSeen: number;
  lastSeen: number;
  current: boolean;
  active: boolean;
}
// ---- account card (Binance-style profile chip + details) --------------------
function AccountCard({ compact = false }: { compact?: boolean }) {
  const { state, saveConfig } = useStore();
  const { open, setOpen, ref } = useMenu<HTMLDivElement>(); // hover-open, like the rest of the bar
  const fileRef = useRef<HTMLInputElement>(null);
  const profile = state?.config.profile ?? { name: '', avatar: null };
  const [preview, setPreview] = useState<string | null>(null); // instant feedback before the 2s state tick
  const [editName, setEditName] = useState<string | null>(null);
  const [linkedKeys, setLinkedKeys] = useState<AccountExchangeRow[]>([]);
  const [sessions, setSessions] = useState<AccountSessionRow[]>([]);
  const [sessionNow, setSessionNow] = useState(Date.now());
  const avatar = preview ?? profile.avatar ?? DEFAULT_PROFILE_LOGO;
  const usesDefaultLogo = !preview && !profile.avatar;
  const name = profile.name || 'Operator';
  const initial = name.trim().slice(0, 1).toUpperCase() || 'O';
  const connected = !!state?.binance.keysPresent;
  const sub = connected ? (state?.binance.connected ? 'Binance · read-only' : 'Binance · error') : 'Binance · not linked';
  const liveKeys = linkedKeys.filter((k) => k.live || k.keysPresent || k.status === 'live');
  const accountTone = connected ? (state?.binance.connected ? 'live' : 'warn') : 'off';
  const verified = !!state?.binance.connected;
  const identityLine = connected ? (verified ? 'Binance · read-only' : 'Binance · key check') : 'Local session';
  const connectedKeys = (liveKeys.length ? liveKeys : linkedKeys.filter((k) => k.keysPresent || k.status !== 'planned')).slice(0, 4);
  const hostLabel = typeof window !== 'undefined' ? window.location.host : 'local';
  const recentSessions = sessions
    .filter((s) => s.current || s.active || sessionNow - s.lastSeen < 90_000)
    .slice(0, 10);
  const logoutHref = typeof window !== 'undefined' && window.location.hostname === DEPLOYED_APP_HOST
    ? '/cdn-cgi/access/logout'
    : `https://${DEPLOYED_APP_HOST}/cdn-cgi/access/logout`;

  // Linked-key count is polled only while the popover is open.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => {
      void fetch('/api/apikey')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d) setLinkedKeys(d.keys ?? []); })
        .catch(() => undefined);
      void fetch('/api/sessions')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive || !d) return;
          setSessions(d.sessions ?? []);
          setSessionNow(Number(d.now) || Date.now());
        })
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [open]);

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
      <button className={`acct-card ${compact ? 'top acct-pro-trigger' : ''} ${open ? 'on' : ''} s-${accountTone}`} onClick={() => setOpen(!open)} title={`Account Details — ${sub}`} aria-label="Account Details">
        {compact ? (
          <span className={`acct-top-orb ${usesDefaultLogo ? 'profile-logo' : ''} s-${accountTone}`}>
            <span className="acct-top-face">
              {avatar ? <img src={avatar} alt="" /> : <IconUser size={16} />}
            </span>
          </span>
        ) : (
          <>
            <span className={`acct-avatar ${usesDefaultLogo ? 'profile-logo' : ''}`}>
              {avatar ? <img src={avatar} alt="" /> : <IconUser size={16} />}
            </span>
            <span className="acct-meta">
              <span className="acct-name">{name}</span>
              <span className="acct-sub"><span className={`acct-dot ${connected ? (state?.binance.connected ? 'ok' : 'bad') : ''}`} />{sub}</span>
            </span>
          </>
        )}
      </button>
      {open && (
        <div className="menu-pop acct-pop cb-acct-pop">
          <div className="cb-profile-head">
            <button className={`cb-profile-avatar ${usesDefaultLogo ? 'profile-logo' : ''}`} onClick={() => fileRef.current?.click()} title="Upload profile photo">
              {avatar ? <img src={avatar} alt="" /> : initial}
              <span className="acct-cam"><IconCamera size={11} /></span>
            </button>
            <div className="cb-profile-id">
              {editName === null ? (
                <button className="cb-profile-name" onClick={() => setEditName(profile.name || '')} title="Edit display name">{name}</button>
              ) : (
                <form
                  className="cb-profile-name-form"
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
              <span className="cb-profile-sub">{identityLine}</span>
            </div>
          </div>

          <div className="cb-profile-sections">
            <section className="cb-profile-section" aria-label="Connected exchange">
              <div className="cb-profile-section-head">
                <span><IconKey size={16} />Connected Exchange</span>
                <b className={verified ? 'ok' : connected ? 'warn' : ''}>{verified ? 'Live' : connected ? 'Checking' : 'Not linked'}</b>
              </div>
              <div className="cb-link-list">
                {connectedKeys.length > 0 ? connectedKeys.map((k) => (
                  <div className="cb-exchange-row" key={k.id}>
                    <span className={`cb-exchange-mark ${k.live || k.keysPresent ? 'on' : ''}`}>{k.name.slice(0, 1).toUpperCase()}</span>
                    <span className="cb-exchange-main">
                      <b>{k.name}</b>
                      <em>{k.scope} · {k.type}{k.fingerprint ? ` · ${k.fingerprint}` : k.prefix ? ` · ${k.prefix}...` : ''}</em>
                    </span>
                    <span className={`cb-status ${k.live ? 'ok' : k.keysPresent ? 'warn' : ''}`}>
                      {k.live ? 'Live' : k.keysPresent ? 'Pending' : 'Off'}
                    </span>
                  </div>
                )) : (
                  <div className="cb-empty">No exchange key is linked to this server.</div>
                )}
              </div>
            </section>

            <section className="cb-profile-section" aria-label="Linked devices">
              <div className="cb-profile-section-head">
                <span><IconWifi size={16} />Linked Devices</span>
                <b className={recentSessions.length ? 'ok' : ''}>{recentSessions.length || 0} Active</b>
              </div>
              <div className="cb-link-list">
                {recentSessions.length > 0 ? recentSessions.map((s) => {
                  const lastSeen = timeAgo(s.lastSeen);
                  const network = s.ip ? s.ip : 'local network';
                  return (
                    <div className="cb-device-row" key={s.id}>
                      <span className={`cb-device-dot ${s.active ? 'on' : ''}`} />
                      <span className="cb-device-main">
                        <b>{s.browser} on {s.system}</b>
                        <em>{hostLabel} · {network}{s.country ? ` · ${s.country}` : ''} · first seen {timeAgo(s.firstSeen)}</em>
                      </span>
                      <span className="cb-device-right">
                        <i>{s.current ? 'This Device' : s.active ? 'Active' : 'Recent'}</i>
                        <b>{s.active ? 'Active Now' : lastSeen}</b>
                      </span>
                    </div>
                  );
                }) : (
                  <div className="cb-empty">No active device sessions reported yet.</div>
                )}
              </div>
            </section>

            <a className="cb-profile-logout-bar" href={logoutHref} title="Sign out of the deployed Cloudflare Access session">
              <IconPower size={18} /><span>Log Out</span>
            </a>
          </div>
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
  base?: string;
  spot?: number | null;
  perpMark?: number | null;
  volume?: number | null;
  changePct?: number | null;
  fundingRate?: number | null;
  keywords: string;
  kind?: 'token' | 'perp' | 'page' | 'setting';
}
type SearchTab = 'top' | 'crypto' | 'perps' | 'settings';
const compactMoney = (v: number | null | undefined) => {
  if (!Number.isFinite(v ?? NaN)) return '—';
  const n = Number(v);
  const abs = Math.abs(n);
  const body = abs >= 1e12 ? `${(n / 1e12).toFixed(abs >= 10e12 ? 1 : 2)}T`
    : abs >= 1e9 ? `${(n / 1e9).toFixed(abs >= 10e9 ? 1 : 2)}B`
      : abs >= 1e6 ? `${(n / 1e6).toFixed(abs >= 10e6 ? 1 : 2)}M`
        : abs >= 1e3 ? `${(n / 1e3).toFixed(abs >= 10e3 ? 1 : 2)}K`
          : abs >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : n.toPrecision(3);
  return `$${body}`;
};
const searchPrice = (v: number | null | undefined) => {
  if (!Number.isFinite(v ?? NaN)) return '—';
  const n = Number(v);
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: n >= 100 ? 2 : n >= 1 ? 3 : 6,
    maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 3 : 6,
  })}`;
};
const searchPct = (v: number | null | undefined, digits = 2) => {
  if (!Number.isFinite(v ?? NaN)) return '—';
  return `${Number(v) >= 0 ? '↗' : '↘'} ${Math.abs(Number(v)).toFixed(digits)}%`;
};
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
    { label: 'Kill switch', hint: 'Risk · halt everything', page: 'risk', keywords: 'kill switch halt stop emergency risk' },
    { label: 'Risk limits', hint: 'Risk · caps & allowlist', page: 'risk', keywords: 'risk limits caps notional allowlist symbols' },
    { label: 'Rules & governance', hint: 'Risk · owner rules', page: 'risk', keywords: 'rules allowed blocked strict governance create' },
    { label: 'Orders', hint: 'Execution · open & history', page: 'orders', keywords: 'orders open history cancel execution' },
    { label: 'Positions', hint: 'Execution · holdings', page: 'positions', keywords: 'positions holdings unrealized execution' },
    { label: 'Fills', hint: 'Execution · executions', page: 'fills', keywords: 'fills executions trades execution' },
    { label: 'PnL', hint: 'Execution · profit & loss', page: 'pnl', keywords: 'pnl profit loss equity daily execution' },
    { label: 'Account & Security', hint: 'Profile · linked exchanges · devices', page: 'account', kind: 'setting', keywords: 'account security profile linked exchanges devices sessions logout sign out coinbase' },
    { label: 'Appearance', hint: 'Theme · accent · scale', page: 'account', kind: 'setting', keywords: 'appearance theme dark light accent color scale zoom display account settings' },
    { label: 'Display Currency', hint: 'USD · INR · EUR · account values', page: 'account', kind: 'setting', keywords: 'currency fiat usd inr eur gbp jpy display money account settings' },
    { label: 'Basis Units', hint: 'Percent · basis points', page: 'account', kind: 'setting', keywords: 'basis unit bps percent percentage account settings' },
    { label: 'Market Refresh', hint: 'Polling speed · manual refresh', page: 'system', kind: 'setting', keywords: 'market refresh polling speed custom refresh data system settings' },
    { label: 'Notifications', hint: 'Account feed · custom alerts', page: 'ledger', kind: 'setting', keywords: 'notifications alerts account feed custom alerts ledger settings' },
    { label: 'Borrow Guard', hint: 'Loan guardrails · LTV monitor', page: 'loans', kind: 'setting', keywords: 'borrow guard loan ltv block loans margin collateral settings' },
    { label: 'API Keys', hint: 'Linked exchange permissions', page: 'account', kind: 'setting', keywords: 'api keys hmac read only linked exchange permissions binance account settings' },
  );
  return out;
}
function SidebarSearch({ placement = 'rail' }: { placement?: 'rail' | 'topbar' }) {
  const { setPage, setPaletteOpen, markets, openDetail } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<SearchTab>('top');
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const isTopbar = placement === 'topbar';
  // Global index: nav/settings/actions PLUS every tradable token, so typing any
  // letter finds tokens across the whole app (not just the menu).
  const index = useMemo(() => {
    const pages = buildIndex();
    const tokens: SearchEntry[] = markets.filter((m) => m.hasSpot || m.spot !== null).map((m) => ({
      label: m.base,
      hint: `${m.symbol} · Crypto`,
      symbol: m.symbol,
      base: m.base,
      spot: m.spot,
      volume: m.quoteVolume24h,
      changePct: m.change24hPct,
      kind: 'token' as const,
      keywords: `${m.base} ${m.symbol} crypto spot token asset coin`.toLowerCase(),
    }));
    const perps: SearchEntry[] = markets.filter((m) => m.hasPerp || m.perpMark !== null).map((m) => ({
      label: `${m.base} Perpetual`,
      hint: `${m.symbol} · Perpetual`,
      symbol: m.symbol,
      base: m.base,
      perpMark: m.perpMark ?? m.perpLast ?? m.spot,
      volume: m.perpVolume24h,
      changePct: m.perpChange24hPct ?? m.change24hPct,
      fundingRate: m.fundingRate,
      kind: 'perp' as const,
      keywords: `${m.base} ${m.symbol} perp perpetual futures funding leverage`.toLowerCase(),
    }));
    return [...pages, ...tokens, ...perps];
  }, [markets]);
  // Close on outside click even when the query is empty. The panel opens on
  // focus, so tying outside-close only to `q` leaves an empty focused search
  // stuck open.
  useEffect(() => {
    if (!focused && !q) return;
    const close = () => {
      setQ('');
      setFocused(false);
      wrapRef.current?.querySelector('input')?.blur();
    };
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [focused, q]);
  const ql = q.trim().toLowerCase();
  const results = useMemo(() => {
    const source = ql ? index : index.filter((e) => e.kind === 'token' || e.kind === 'perp' || e.kind === 'setting');
    const scoped = source.filter((e) => {
      if (tab === 'crypto') return e.kind === 'token';
      if (tab === 'perps') return e.kind === 'perp';
      if (tab === 'settings') return e.kind === 'setting' || e.kind === 'page';
      return true;
    });
    if (!ql) {
      return scoped
        .filter((e) => e.kind === 'token' || e.kind === 'perp' || e.kind === 'setting')
        .sort((a, b) => {
          if (tab === 'settings') return a.label.localeCompare(b.label);
          if (a.kind === 'setting' || b.kind === 'setting') return a.kind === 'setting' ? 1 : -1;
          return (b.volume ?? 0) - (a.volume ?? 0);
        })
        .slice(0, isTopbar ? 8 : 8);
    }
    const scored = index
      .filter((e) => {
        if (tab === 'crypto') return e.kind === 'token';
        if (tab === 'perps') return e.kind === 'perp';
        if (tab === 'settings') return e.kind === 'setting' || e.kind === 'page';
        return true;
      })
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
      .sort((a, b) => {
        const rank = (e: SearchEntry) => e.kind === 'setting' ? 0 : e.kind === 'page' ? 1 : e.kind === 'token' ? 2 : 3;
        return a.score - b.score || rank(a.e) - rank(b.e) || (b.e.volume ?? 0) - (a.e.volume ?? 0);
      })
      .slice(0, isTopbar ? 12 : 9)
      .map((x) => x.e);
    return scored;
  }, [ql, index, tab, isTopbar]);
  useEffect(() => { setSel(0); }, [tab, ql]);
  const panelOpen = isTopbar ? focused || ql.length > 0 : ql.length > 0;
  const groupedResults = useMemo(() => ({
    settings: results.filter((r) => r.kind === 'setting' || r.kind === 'page'),
    crypto: results.filter((r) => r.kind === 'token'),
    perps: results.filter((r) => r.kind === 'perp'),
  }), [results]);

  const go = (e: SearchEntry) => {
    if (e.symbol) openDetail(e.symbol);
    else if (e.overlay) openOverlay(e.overlay);
    else if (e.page) setPage(e.page);
    setQ('');
    setSel(0);
    setFocused(false);
  };
  const renderRow = (r: SearchEntry, i: number) => {
    const isMarket = r.kind === 'token' || r.kind === 'perp';
    const change = r.changePct ?? null;
    return (
      <button key={`${r.kind}-${r.label}-${r.symbol ?? r.page ?? i}`} className={`ssr-row ${i === sel ? 'sel' : ''} ${isMarket ? 'market' : 'command'}`} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); go(r); }}>
        {isMarket ? (
          <>
            <TokenIcon symbol={r.symbol ?? r.base ?? r.label} size={34} />
            <span className="ssr-asset">
              <span className="ssr-label">{r.label}{r.kind === 'perp' && <em>50X</em>}</span>
              <span className="ssr-hint">{r.kind === 'perp' ? 'INTX' : r.hint.replace(' · Crypto', '')}</span>
            </span>
            <span className="ssr-mid">
              <b>{compactMoney(r.volume)} vol</b>
              <small>{r.kind === 'perp' ? `${searchPct((r.fundingRate ?? 0) * 100, 4).replace('↗ ', '').replace('↘ ', '')}/hr funding` : r.symbol}</small>
            </span>
            <span className="ssr-price">
              <b>{searchPrice(r.kind === 'perp' ? r.perpMark : r.spot)}</b>
              <small className={change !== null && change < 0 ? 'neg' : 'pos'}>{searchPct(change)}</small>
            </span>
          </>
        ) : (
          <>
            <span className="ssr-command-mark"><IconGear size={14} /></span>
            <span className="ssr-asset">
              <span className="ssr-label">{r.label}</span>
              <span className="ssr-hint">{r.hint}</span>
            </span>
            <span className="ssr-price single">Open</span>
          </>
        )}
      </button>
    );
  };
  const renderGroup = (title: string, rows: SearchEntry[]) => rows.length > 0 && (
    <div className="ssr-group" key={title}>
      <div className="ssr-group-title">{title}</div>
      {rows.map((r) => renderRow(r, results.indexOf(r)))}
    </div>
  );

  return (
    <div className={`snav-search ${isTopbar ? 'topbar-search' : ''} ${panelOpen ? 'open' : ''}`} ref={wrapRef}>
      <div className={`snav-search-box ${ql || focused ? 'on' : ''}`} onMouseDown={() => setFocused(true)} onClick={() => setFocused(true)}>
        <IconSearch size={14} />
        <input
          value={q}
          placeholder={isTopbar ? 'Search tokens, settings, commands' : 'Search for an asset'}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter' && results[sel]) go(results[sel]);
            else if (e.key === 'Escape') { setQ(''); setFocused(false); }
          }}
          aria-label="Search tokens and account settings"
          aria-expanded={panelOpen}
        />
        <button className="snav-search-k" onClick={() => setPaletteOpen(true)} title="Full command palette (⌘K)" tabIndex={-1}>⌘K</button>
      </div>
      {isTopbar && <span className="search-beam" aria-hidden="true" />}
      {panelOpen && (
        <div className="snav-search-pop">
          {isTopbar && (
            <div className="ssr-tabs" role="tablist" aria-label="Search categories">
              {[
                ['top', 'Top'],
                ['crypto', 'Crypto'],
                ['perps', 'Perpetuals'],
                ['settings', 'Settings'],
              ].map(([id, label]) => (
                <button key={id} type="button" className={tab === id ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); setTab(id as SearchTab); }}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {results.length === 0 ? (
            <div className="ssr-empty">No matches. Try a token, page, alert, refresh, currency, or risk setting.</div>
          ) : isTopbar ? (
            <>
              {renderGroup('Settings', groupedResults.settings)}
              {renderGroup('Crypto', groupedResults.crypto)}
              {renderGroup('Perpetuals', groupedResults.perps)}
            </>
          ) : (
            results.map((r, i) => (
              renderRow(r, i)
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
                aria-current={page === n.id || n.match?.includes(page) ? 'page' : undefined}
              >
                <span className="snav-ic">{n.icon}</span>
                <span className="snav-label">{n.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
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
const TbpCheck = () => (
  <svg className="tbp-check" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconDollar = ({ size = 16 }: { size?: number }) => (
  <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden>
    <circle cx="10" cy="10" r="8.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M12.3 7.3c-.4-.8-1.2-1.2-2.3-1.2-1.3 0-2.2.7-2.2 1.7 0 2.5 5 1.1 5 3.9 0 1.1-1 1.8-2.6 1.8-1.2 0-2.1-.5-2.5-1.4M10 4.9v10.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

type MK = 'clock' | 'shell' | 'apikey' | 'data' | 'advisor' | 'notif' | 'power' | 'mrefresh' | 'currency' | 'basisu' | 'appearance';
const MENU_W: Record<MK, number> = {
  clock: 360, shell: 320, apikey: 320, data: 320, advisor: 320, notif: 340, power: 270, mrefresh: 300, currency: 280, basisu: 260, appearance: 260,
};

const clockParts = (zoneId: string, d: Date) => {
  try {
    const opts: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    };
    if (zoneId && zoneId !== 'local') opts.timeZone = zoneId;
    const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(d);
    const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const ss = parts.find((p) => p.type === 'second')?.value ?? '00';
    const ampm = (parts.find((p) => p.type === 'dayPeriod')?.value ?? '').toUpperCase();
    return { raw: `${hh}:${mm}:${ss} ${ampm}`.trim(), hm: `${hh}:${mm}`, ss, ampm };
  } catch {
    const raw = fmtClockZone(zoneId, d);
    const [hh = '00', mm = '00', ss = '00'] = raw.split(':');
    return { raw: `${hh}:${mm}:${ss}`, hm: `${hh}:${mm}`, ss, ampm: '' };
  }
};
const clockOffset = (zoneId: string, d: Date) => {
  try {
    const opts: Intl.DateTimeFormatOptions = { timeZoneName: 'shortOffset', hour: '2-digit', minute: '2-digit', hour12: false };
    if (zoneId && zoneId !== 'local') opts.timeZone = zoneId;
    const part = new Intl.DateTimeFormat('en-US', opts).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value;
    const normalized = part?.replace('GMT', 'UTC') ?? 'UTC';
    return normalized === 'UTC+0' || normalized === 'UTC-0' ? 'UTC' : normalized;
  } catch {
    return zoneId === 'UTC' ? 'UTC' : 'local';
  }
};
const clockDate = (zoneId: string, d: Date) => {
  try {
    const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: '2-digit' };
    if (zoneId && zoneId !== 'local') opts.timeZone = zoneId;
    return new Intl.DateTimeFormat('en-US', opts).format(d);
  } catch {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' });
  }
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
  const { state, connected, page, prefs, updatePref, setPage, setKill, saveConfig, refresh } = useStore();
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
  const [srv, setSrv] = useState<{ news: boolean | null; cal: boolean | null; fx: boolean | null }>({ news: null, cal: null, fx: null });
  const [seen, setSeen] = useState(() => Number(localStorage.getItem('cosmos-notif-seen') || 0));
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [notifTab, setNotifTab] = useState<'all' | 'account' | 'risk' | 'custom'>('all');
  const [refreshCustom, setRefreshCustom] = useState(() => String(prefs.refreshSec));
  const [menuRefreshState, setMenuRefreshState] = useState<'idle' | 'spin' | 'ok' | 'err'>('idle');
  const menuRefreshBusy = useRef(false);
  const [currencyFx, setCurrencyFx] = useState<{ ok: boolean | null; rates: Record<string, number>; fetchedAt: number | null }>({ ok: null, rates: {}, fetchedAt: null });

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (active === 'mrefresh') setRefreshCustom(String(prefs.refreshSec)); }, [active, prefs.refreshSec]);
  useEffect(() => {
    if (active !== 'currency') return;
    let alive = true;
    fetch('/api/fx')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { rates?: Record<string, number>; fetchedAt?: number } | null) => {
        if (!alive) return;
        if (d?.rates) setCurrencyFx({ ok: true, rates: d.rates, fetchedAt: d.fetchedAt ?? null });
        else setCurrencyFx((x) => ({ ...x, ok: false }));
      })
      .catch(() => { if (alive) setCurrencyFx((x) => ({ ...x, ok: false })); });
    return () => { alive = false; };
  }, [active]);
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
  const closeMenu = () => {
    window.clearTimeout(closeT.current);
    if (currentCloser === closerRef.current) currentCloser = null;
    closerRef.current();
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
  const activeClock = clockParts(zone.id, now);
  const activeClockOffset = clockOffset(zone.id, now);
  const utcClock = clockParts('UTC', now);
  const localClock = clockParts('local', now);
  const cur = CURRENCIES[prefs.currency] ? prefs.currency : 'USD';
  const curInfo = CURRENCIES[cur] ?? CURRENCIES.USD;
  const curSymbol = curInfo.symbol.trim() || cur;
  const curRate = cur === 'USD' ? 1 : currencyFx.rates[cur] ?? null;
  const curTone = cur === 'USD' || curRate ? 'ok' : currencyFx.ok === false ? 'bad' : 'warn';
  const curRateText = cur === 'USD'
    ? '1.0000'
    : curRate
      ? curRate.toLocaleString('en-US', { maximumFractionDigits: curRate >= 100 ? 2 : 4 })
      : currencyFx.ok === false
        ? 'Unavailable'
        : 'Loading';
  const curFxCode = cur === 'USD' ? 'BASE' : curTone === 'ok' ? 'FX' : curTone === 'bad' ? 'OFF' : 'WAIT';
  const curAgeCode = cur === 'USD' ? 'USD' : currencyFx.fetchedAt ? timeAgo(currencyFx.fetchedAt).replace(/\s+ago$/i, '') : curTone === 'bad' ? 'OFF' : '...';
  const currencyRateText = (code: string) => {
    if (code === 'USD') return '1.0000';
    const r = currencyFx.rates[code];
    if (!r) return currencyFx.ok === false ? 'OFF' : 'FX';
    return r.toLocaleString('en-US', { maximumFractionDigits: r >= 100 ? 2 : 4 });
  };
  const basisIsBps = prefs.basisUnit === 'bps';
  const basisMark = basisIsBps ? 'bp' : '%';
  const basisPreview = basisIsBps ? '+4.2 bps' : '+0.042%';
  const basisCode = basisIsBps ? 'BPS' : 'PCT';
  const basisAltPreview = basisIsBps ? '+0.042%' : '+4.2bp';
  const activeAccent = ACCENTS[prefs.accent] ?? ACCENTS.b;
  const appearanceZoom = Math.round((prefs.zoom || 1) * 100);
  const al = prefs.alerts; const alertsOn = Object.values(al).filter(Boolean).length;
  const mode = state?.mode ?? 'HALTED';
  const modeClass = mode === 'HALTED' ? 'm-halted' : mode === 'LIVE_ARMED' ? 'm-live' : 'm-manual';
  const modeTone = mode === 'HALTED' ? 'bad' : mode === 'LIVE_ARMED' ? 'ok' : 'warn';
  const allowCount = cfg?.allowedSymbols?.length ?? 0;
  const modeCode = mode === 'HALTED' ? 'OFF' : mode === 'LIVE_ARMED' ? 'LIVE' : 'MAN';
  const modeStamp = mode === 'HALTED' ? 'HALT' : mode === 'LIVE_ARMED' ? 'ARM' : 'HOLD';
  const modeSend = mode === 'HALTED' ? 'BLOCK' : mode === 'LIVE_ARMED' ? 'GATE' : 'MAN';
  const modeNet = b?.connected ? 'UP' : 'OFF';
  const liveDisabled = !b?.connected || allowCount === 0;
  const liveTitle = !b?.connected ? 'Binance account sync is required' : allowCount === 0 ? 'Add allowed symbols in Risk first' : 'Arm live trading';
  const setManualMode = () => { void saveConfig({ killSwitch: false, liveTradingEnabled: false }); };
  const setLiveMode = () => { void saveConfig({ killSwitch: false, liveTradingEnabled: true }); };
  const alertRows: { key: keyof typeof al; label: string; sub: string }[] = [
    { key: 'proposals', label: 'Strategy Proposals', sub: 'New basis and spread signals' },
    { key: 'fills', label: 'Account Fills', sub: 'Executions on your Binance account' },
    { key: 'risk', label: 'Risk Blocks', sub: 'Risk gate and kill-switch blocks' },
    { key: 'news', label: 'Binance Announcements', sub: 'Listings, delistings, maintenance' },
  ];
  const alertShort: Record<keyof typeof al, string> = {
    proposals: 'Signals',
    fills: 'Fills',
    risk: 'Risk',
    news: 'News',
  };
  const notifTabs: { id: typeof notifTab; label: string; code: string }[] = [
    { id: 'all', label: 'All', code: 'All' },
    { id: 'account', label: 'Account', code: 'A' },
    { id: 'risk', label: 'Risk', code: 'R' },
    { id: 'custom', label: 'Custom alerts', code: 'C' },
  ];
  const notifMeta = (kind: string) => {
    const k = kind.toLowerCase();
    if (k.includes('risk') || k.includes('error') || k.includes('reject') || k.includes('kill')) {
      return { bucket: 'risk' as const, scope: 'Risk Alert', title: 'Control Room Alert', tone: 'risk', mark: '!' };
    }
    if (k.includes('order') || k.includes('fill') || k.includes('loan') || k.includes('account') || k.includes('binance') || k.includes('user_stream')) {
      return { bucket: 'account' as const, scope: 'Account Activity', title: 'Account Update', tone: 'account', mark: 'A' };
    }
    if (k.includes('strategy') || k.includes('proposal') || k.includes('signal')) {
      return { bucket: 'account' as const, scope: 'Trading Insight', title: 'Strategy Update', tone: 'trading', mark: 'S' };
    }
    return { bucket: 'system' as const, scope: 'System Update', title: 'System Notice', tone: 'system', mark: 'C' };
  };
  const filteredNotifEvents = events.filter((e) => {
    if (notifTab === 'all') return true;
    if (notifTab === 'custom') return false;
    return notifMeta(e.kind).bucket === notifTab;
  });
  const notifTone = unread > 0 ? 'hot' : events.length > 0 ? 'live' : alertsOn > 0 ? 'armed' : 'idle';
  const refreshChoices = [
    { sec: 3, label: 'Fast', sub: 'Market Poll' },
    { sec: 6, label: 'Live', sub: 'Default' },
    { sec: 12, label: 'Balanced', sub: 'Lower Load' },
    { sec: 30, label: 'Light', sub: 'Quiet Mode' },
  ];
  const clampRefresh = (sec: number) => Math.min(120, Math.max(3, Math.round(sec)));
  const setMarketRefresh = (sec: number) => {
    const next = clampRefresh(sec);
    updatePref('refreshSec', next);
    setRefreshCustom(String(next));
  };
  const applyCustomRefresh = () => {
    const parsed = Number(refreshCustom);
    if (!Number.isFinite(parsed)) {
      setRefreshCustom(String(prefs.refreshSec));
      return;
    }
    setMarketRefresh(parsed);
  };
  const runMenuRefresh = async () => {
    if (menuRefreshBusy.current) return;
    menuRefreshBusy.current = true;
    setMenuRefreshState('spin');
    let ok = false;
    try {
      const res = await refresh();
      ok = res.ok;
    } catch {
      ok = false;
    }
    setMenuRefreshState(ok ? 'ok' : 'err');
    window.setTimeout(() => {
      setMenuRefreshState('idle');
      menuRefreshBusy.current = false;
    }, ok ? 1200 : 1800);
  };
  const refreshFeedCount = Object.keys(feeds).length;
  const refreshTone = menuRefreshState === 'err'
    ? 'bad'
    : menuRefreshState === 'spin'
      ? 'warn'
      : !connected
        ? 'bad'
        : !feedsOk || latTone === 'warn' || latTone === 'bad'
          ? 'warn'
          : 'ok';
  const refreshLabel = menuRefreshState === 'spin'
    ? 'Refreshing'
    : menuRefreshState === 'ok'
      ? 'Synced'
      : menuRefreshState === 'err'
        ? 'Issue'
        : refreshTone === 'ok'
          ? 'Live'
          : refreshTone === 'warn'
            ? 'Watch'
            : 'Offline';
  const refreshCode = `${prefs.refreshSec}s`;
  const refreshStamp = menuRefreshState === 'spin' ? 'POLL' : menuRefreshState === 'ok' ? 'SYNC' : menuRefreshState === 'err' ? 'ERR' : refreshLabel.toUpperCase();
  const refreshNetCode = menuRefreshState === 'spin' ? 'RUN' : menuRefreshState === 'ok' ? 'SYNC' : menuRefreshState === 'err' ? 'ERR' : refreshTone === 'ok' ? 'LIVE' : refreshTone === 'warn' ? 'WARN' : 'OFF';
  const refreshActionText = menuRefreshState === 'spin' ? 'Run' : menuRefreshState === 'ok' ? 'OK' : menuRefreshState === 'err' ? 'Retry' : 'Now';
  const refreshDetail = !connected
    ? 'Socket reconnecting'
    : !feedsOk
      ? 'Market feed degraded'
      : `${refreshFeedCount} streams / ${msLabel(lat)}`;
  type DataTier = 'good' | 'warn' | 'bad' | 'idle';
  const dataLabel = netGrade === 'ok' ? 'Good' : netGrade === 'bad' ? 'Down' : 'Watch';
  const dataSub = connected
    ? feedsOk
      ? `${feedList.length} market streams · ${msLabel(lat)}`
      : 'One or more market streams is not open'
    : 'Cockpit socket is reconnecting';
  const probeTier = (ok: boolean | null): DataTier => ok === null ? 'idle' : ok ? 'good' : 'bad';
  const probeDetail = (ok: boolean | null) => ok === null ? 'Checking' : ok ? 'Reachable' : 'Down';
  const driftAbs = sys?.serverTimeDiffMs == null ? null : Math.abs(sys.serverTimeDiffMs);
  const driftTier: DataTier = driftAbs == null ? 'idle' : driftAbs < 500 ? 'good' : driftAbs < 1500 ? 'warn' : 'bad';
  const latTier: DataTier = lat === null ? 'idle' : lat < 400 ? 'good' : lat < 900 ? 'warn' : 'bad';
  const dataRows: { name: string; sub: string; value: string; tier: DataTier }[] = [
    { name: 'Binance Market Feed', sub: feedList.length ? `${feedList.length} streams observed` : 'No streams reported', value: feedsOk ? 'Open' : feedList.length ? 'Degraded' : 'Idle', tier: connected && feedsOk ? 'good' : connected ? 'warn' : 'bad' },
    { name: 'Binance Account', sub: b?.keysPresent ? 'Read-only account sync' : 'Read key not configured', value: b?.keysPresent ? (b?.connected ? 'Synced' : 'Error') : 'No Key', tier: b?.connected ? 'good' : b?.keysPresent ? 'bad' : 'idle' },
    { name: 'Announcements', sub: 'Binance news probe', value: probeDetail(srv.news), tier: probeTier(srv.news) },
    { name: 'Economic Calendar', sub: 'Macro event probe', value: probeDetail(srv.cal), tier: probeTier(srv.cal) },
    { name: 'FX Rates', sub: 'Currency conversion probe', value: probeDetail(srv.fx), tier: probeTier(srv.fx) },
    { name: 'Clock Drift', sub: 'Server time offset', value: msLabel(sys?.serverTimeDiffMs), tier: driftTier },
    { name: 'Pairs Scanned', sub: 'Scanner universe', value: String(state?.scanner.pairs ?? '—'), tier: state?.scanner.pairs ? 'good' : 'idle' },
  ];
  const dataCode = netGrade === 'ok' ? 'OK' : netGrade === 'bad' ? 'DWN' : 'WAT';
  const dataScore = dataRows.length ? Math.round((dataRows.filter((r) => r.tier === 'good').length / dataRows.length) * 100) : 100;
  const dataShort: Record<string, string> = {
    'Binance Market Feed': 'Feed',
    'Binance Account': 'Account',
    'Announcements': 'News',
    'Economic Calendar': 'Calendar',
    'FX Rates': 'FX',
    'Clock Drift': 'Drift',
    'Pairs Scanned': 'Pairs',
  };
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
  const advTone = advA.length ? 'bad' : advI.length ? 'warn' : 'ok';
  const advScore = advChecks.length ? Math.round((advP.length / advChecks.length) * 100) : 100;
  const advCode = advTone === 'bad' ? 'ACT' : advTone === 'warn' ? 'REV' : 'OK';

  // Reposition only when the ACTIVE menu changes, when a trigger's width could
  // change (badges toggling, currency symbol, zone label), on zoom, or on window
  // resize — NOT every clock tick. (The clock uses tabular figures so ticking
  // seconds keep a constant width; otherwise every tick would shift the triggers
  // and restart the slide transition, leaving the box perpetually mid-flight.)
  const placeSig = `${alertsOn > 0}|${unread > 0}|${advA.length > 0}|${zone.label}|${prefs.zoom}`;
  useLayoutEffect(() => {
    if (!active) return;
    const place = () => { const g = computeGeo(active); if (g) setGeo(g); };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, placeSig]);

  const trig = (k: MK, cls: string, inner: JSX.Element, opts: { title?: string; onClick?: () => void } = {}) => (
    <button
      ref={(el) => { btnRefs.current[k] = el; }}
      className={`${cls} ${active === k ? 'on' : ''}`}
      onMouseEnter={() => openK(k)}
      onClick={() => {
        if (opts.onClick) {
          closeMenu();
          opts.onClick();
          return;
        }
        active === k ? closeMenu() : openK(k);
      }}
      title={opts.title ?? k}
      aria-label={opts.title ?? k}
    >
      {inner}
    </button>
  );

  // ONE panel for both keys: identity lines in the dock voice, then a single
  // permission matrix (read-only vs full) instead of two stacks of chips.
  const PERM_SHORT: Record<string, string> = {
    reading: 'Read',
    spotMargin: 'Spot',
    marginLoan: 'Loan',
    withdrawals: 'Withdraw',
    universalTransfer: 'Transfer',
    futures: 'Futures',
  };
  const keysBody = () => {
    if (!roKey && !fullKey) {
      return (
        <div className="keyx-pop keyx-empty">
          <div className="keyx-vault">
            <span className="keyx-vault-mark"><IconKey size={18} /></span>
            <span className="keyx-vault-copy"><b>API</b><em>missing</em></span>
            <button className="keyx-action" type="button" title="Open API Security" aria-label="Open API Security" onClick={() => { setActive(null); openOverlay('apikey'); }}>
              <IconShield size={15} />
            </button>
          </div>
          <div className="keyx-empty-line"><span /><span /><span /></div>
        </div>
      );
    }
    const rows = API_PERMS.map((p) => ({
      key: p.key as string,
      label: PERM_SHORT[p.key] ?? p.label,
      ro: !!roKey?.permissions[p.key],
      full: !!fullKey?.permissions[p.key],
    }));
    const visibleKeys = [roKey, fullKey].filter(Boolean) as ApiKeyInfo[];
    const liveCount = visibleKeys.filter((ak) => ak.status === 'live').length;
    const ipLocked = visibleKeys.every((ak) => ak.ipRestrict);
    const withdrawalsOpen = rows.some((r) => r.key === 'withdrawals' && (r.ro || r.full));
    return (
      <div className="keyx-pop">
        <div className="keyx-vault">
          <span className={`keyx-vault-mark ${roKey?.status ?? 'declared'}`}><IconKey size={18} /></span>
          <span className="keyx-vault-copy"><b>API</b><em>{withdrawalsOpen ? 'review' : 'locked'}</em></span>
          <span className={`keyx-vault-ring ${withdrawalsOpen ? 'warn' : 'ok'}`} aria-hidden>
            <i /><i /><i />
          </span>
          <button className="keyx-action" type="button" title="Open API Security" aria-label="Open API Security" onClick={() => { setActive(null); openOverlay('apikey'); }}>
            <IconShield size={15} />
          </button>
        </div>
        <div className="keyx-strip">
          <span><em>Keys</em><b>{visibleKeys.length}</b></span>
          <span><em>Live</em><b>{liveCount}</b></span>
          <span><em>IP</em><b>{ipLocked ? 'Lock' : 'Open'}</b></span>
        </div>
        <div className="keyx-key-stack">
          {visibleKeys.map((ak) => (
            <div key={ak.id} className={`keyx-card ${ak.status}`}>
              <span className="keyx-led" />
              <span className="keyx-main">
                <b>{ak.name}</b>
                <em>{ak.prefix ? `${ak.prefix}····${ak.fingerprint ? ` ${ak.fingerprint}` : ''}` : 'pending'}</em>
              </span>
              <span className={`keyx-side ${ak.status}`} title={ak.status} aria-label={ak.status} />
            </div>
          ))}
        </div>
        <div className="keyx-matrix">
          <div className="keyx-mhead"><span /><em>R</em><em>F</em></div>
          {rows.map((r) => (
            <div key={r.key} className={`keyx-mrow ${r.key === 'withdrawals' ? (withdrawalsOpen ? 'risk' : 'locked') : ''}`}>
              <span>{r.label}</span>
              <i className={`keyx-bit ${r.ro ? 'on' : 'off'}`} title={`Read ${r.label}: ${r.ro ? 'enabled' : 'disabled'}`} aria-label={`Read ${r.label}: ${r.ro ? 'enabled' : 'disabled'}`} />
              <i className={`keyx-bit ${r.full ? 'on' : 'off'}`} title={`Full ${r.label}: ${r.full ? 'enabled' : 'disabled'}`} aria-label={`Full ${r.label}: ${r.full ? 'enabled' : 'disabled'}`} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  const content = (k: MK) => {
    switch (k) {
      case 'clock':
        return (
          <div className="clock-pop">
            <div className="clock-pop-hero">
              <span className="clock-orbit lg"><span /></span>
              <span className="clock-hero-copy">
                <small>Execution Time</small>
                <b>{activeClock.raw}</b>
                <em>{zone.city} · {activeClockOffset} · {clockDate(zone.id, now)}</em>
              </span>
              <span className="clock-live">Live</span>
            </div>
            <div className="clock-twins">
              <span><em>UTC</em><b>{utcClock.raw}</b></span>
              <span><em>Local</em><b>{localClock.raw}</b></span>
            </div>
            <div className="clock-zone-list">
              {ZONES.map((zz) => {
                const p = clockParts(zz.id, now);
                const selected = zz.id === zone.id;
                return (
                  <button key={zz.id} className={`clock-zone-row ${selected ? 'on' : ''}`} onClick={() => { updatePref('clockZone', zz.id); }}>
                    <span className="clock-zone-mark">{zz.label}</span>
                    <span className="clock-zone-copy">
                      <b>{zz.city}</b>
                      <small>{clockOffset(zz.id, now)}</small>
                    </span>
                    <span className="clock-zone-time">{p.raw}</span>
                    {selected && <TbpCheck />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      case 'shell':
        return (
          <div className="shell-pop shell-premium">
            <div className="shell-stage" aria-hidden>
              <div className="shell-stage-bar">
                <span className="shell-leds"><i /><i /><i /></span>
                <b>AWS CLI</b>
                <em>ready</em>
              </div>
              <div className="shell-stage-body">
                <div className="shell-path"><span>ubuntu</span><b>@cg-arbitrage-01</b><i>~</i></div>
                <div className="shell-command"><em>$</em><span>aws sts get-caller-identity</span><i /></div>
                <div className="shell-rail"><span /><span /><span /></div>
              </div>
            </div>
            <div className="shell-pills" aria-hidden>
              <span><em>host</em><b>cg-arb-01</b></span>
              <span><em>path</em><b>/opt/arbitrage</b></span>
              <span><em>auth</em><b>ssm</b></span>
            </div>
            <div className="shell-actions">
              <button className="shell-open primary icon-only" type="button" onClick={() => { setActive(null); openOverlay('cloudshell'); }} title="Open in-app CloudShell" aria-label="Open in-app CloudShell">
                <IconTerminal size={15} />
              </button>
              <a className="shell-open icon-only" href={CLOUD_SHELL_URL} target="_blank" rel="noreferrer noopener" onClick={() => setActive(null)} title="Open AWS Console" aria-label="Open AWS Console">
                <IconExternal size={14} />
              </a>
            </div>
          </div>
        );
      case 'apikey': return keysBody();
      case 'data':
        return (
          <div className={`datax-pop ${netGrade}`}>
            <div className={`datax-hero ${netGrade}`}>
              <span className="datax-mark"><IconDatabase size={18} /></span>
              <span className="datax-score">
                <b>{dataScore}</b>
                <em>{dataCode}</em>
              </span>
              <span className="datax-signal" aria-hidden><i /><i /><i /></span>
            </div>
            <div className="datax-counters">
              <span><i /><b>{feedList.length || '—'}</b><em>S</em></span>
              <span className={latTier}><i /><b>{msLabel(lat)}</b><em>L</em></span>
              <span><i /><b>{sys?.usedWeight1m ?? '—'}</b><em>W</em></span>
            </div>
            <div className="datax-list">
              {dataRows.map((row) => (
                <div key={row.name} className={`datax-row ${row.tier}`}>
                  <span className={`datax-dot ${row.tier}`} />
                  <span className="datax-row-copy">
                    <b>{dataShort[row.name] ?? row.name}</b>
                    <em>{row.value}</em>
                  </span>
                  <span className={`datax-chip ${row.tier}`} />
                </div>
              ))}
            </div>
          </div>
        );
      case 'advisor':
        return (
          <div className={`advx-pop ${advTone}`}>
            <div className={`advx-hero ${advTone}`}>
              <span className="advx-seal"><IconShield size={18} /></span>
              <span className="advx-score">
                <b>{advScore}</b>
                <em>{advCode}</em>
              </span>
              <span className="advx-pulse" aria-hidden><i /><i /><i /></span>
              <button className="advx-action" type="button" title="Open Risk" aria-label="Open Risk" onClick={() => { setActive(null); setPage('risk'); }}>
                <IconRadar size={15} />
              </button>
            </div>
            <div className="advx-counters">
              <span className="bad"><i /><b>{advA.length}</b><em>A</em></span>
              <span className="warn"><i /><b>{advI.length}</b><em>R</em></span>
              <span className="ok"><i /><b>{advP.length}</b><em>P</em></span>
            </div>
            <div className="advx-list">
              {advAtt.length === 0 ? (
                <div className="advx-clean">
                  <span className="advx-dot ok" />
                  <b>Checks clean</b>
                  <em>{advP.length}/{advChecks.length}</em>
                </div>
              ) : advAtt.slice(0, 4).map((c) => (
                <button key={c.name} className={`advx-row ${c.sev}`} type="button" onClick={() => { if (c.page) { setActive(null); setPage(c.page); } }}>
                  <span className={`advx-dot ${c.sev === 'action' ? 'bad' : 'warn'}`} />
                  <span className="advx-row-copy">
                    <b>{c.name}</b>
                    <em>{c.page ?? 'scan'}</em>
                  </span>
                  <span className={`advx-chip ${c.sev === 'action' ? 'bad' : 'warn'}`} />
                </button>
              ))}
            </div>
          </div>
        );
      case 'notif':
        return (
          <div className={`ntfx-pop ${notifTone}`}>
            <div className={`ntfx-hero ${notifTone}`}>
              <span className="ntfx-mark"><IconBell size={18} /></span>
              <span className="ntfx-score">
                <b>{unread || events.length}</b>
                <em>{unread ? 'NEW' : events.length ? 'LOG' : 'CLR'}</em>
              </span>
              <span className="ntfx-signal" aria-hidden><i /><i /><i /></span>
              <button className="ntfx-action" type="button" onClick={() => { setActive(null); setPage('ledger'); }} title="Open Ledger" aria-label="Open notification ledger">
                <IconReceipt size={15} />
              </button>
            </div>
            <div className="ntfx-counters" aria-label="Notification summary">
              <span><i /><b>{events.length}</b><em>T</em></span>
              <span className={unread ? 'hot' : ''}><i /><b>{unread}</b><em>N</em></span>
              <span><i /><b>{alertsOn}</b><em>R</em></span>
            </div>
            <div className="ntfx-tabs" role="tablist" aria-label="Notification filters">
              {notifTabs.map((t) => (
                <button
                  key={t.id}
                  data-testid={`notif-tab-${t.id}`}
                  className={`ntfx-tab ${notifTab === t.id ? 'on' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={notifTab === t.id}
                  aria-label={t.label}
                  title={t.label}
                  onClick={() => setNotifTab(t.id)}
                >
                  {t.code}
                </button>
              ))}
            </div>

            {notifTab === 'custom' ? (
              <div className="ntfx-rules">
                {alertRows.map((r) => (
                  <div key={r.key} className="ntfx-rule">
                    <span className={`ntfx-dot ${al[r.key] ? 'on' : ''}`} />
                    <span className="ntfx-rule-copy">
                      <b>{alertShort[r.key]}</b>
                      <em>{al[r.key] ? 'ON' : 'OFF'}</em>
                    </span>
                    <button
                      data-testid={`notif-alert-${r.key}`}
                      className={`toggle ${al[r.key] ? 'on' : ''}`}
                      type="button"
                      onClick={() => updatePref('alerts', { ...al, [r.key]: !al[r.key] })}
                      aria-label={`Toggle ${r.label}`}
                    >
                      <span className="knob" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ntfx-list">
                {filteredNotifEvents.length === 0 ? (
                  <div className="ntfx-empty">
                    <span className="ntfx-dot idle" />
                    <b>Quiet</b>
                    <em>{notifTab === 'all' ? '0' : notifTab.toUpperCase()}</em>
                  </div>
                ) : filteredNotifEvents.slice(0, 4).map((e) => {
                  const meta = notifMeta(e.kind);
                  const summary = eventSummary(e.kind, (e.data as Record<string, unknown> | null) ?? null, e.symbol);
                  return (
                    <button key={e.id} className="ntfx-event" type="button" title={summary} aria-label={summary} onClick={() => { setActive(null); setPage('ledger'); }}>
                      <span className={`ntfx-dot ${meta.tone}`} aria-hidden="true" />
                      <span className="ntfx-copy">
                        <b>{meta.scope}</b>
                        <em>{meta.mark} · {timeAgo(e.ts)}</em>
                      </span>
                      <span className={`ntfx-chip ${meta.tone}`} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      case 'power':
        return (
          <div className={`modex-pop ${modeTone}`}>
            <div className={`modex-hero ${modeTone}`}>
              <span className="modex-mark"><IconPower size={18} /></span>
              <span className="modex-score">
                <b>{modeCode}</b>
                <em>{modeStamp}</em>
              </span>
              <span className={`modex-bars ${modeTone}`} aria-hidden="true"><i /><i /><i /></span>
            </div>
            <div className="modex-counters" aria-label="Trading mode telemetry">
              <span><i /><b>{allowCount}</b><em>SYM</em></span>
              <span className={modeTone}><i /><b>{modeSend}</b><em>ORD</em></span>
              <span className={b?.connected ? 'ok' : 'bad'}><i /><b>{modeNet}</b><em>API</em></span>
            </div>
            <div className="modex-actions" role="group" aria-label="Bot trading mode controls">
              <button
                className={`modex-action bad ${mode === 'HALTED' ? 'on' : ''}`}
                type="button"
                aria-pressed={mode === 'HALTED'}
                title="Halt trading"
                onClick={() => { void setKill(true); }}
              >
                <IconPower size={14} /><b>Halt</b>
              </button>
              <button
                className={`modex-action warn ${mode === 'MANUAL' ? 'on' : ''}`}
                type="button"
                aria-pressed={mode === 'MANUAL'}
                title="Manual only"
                onClick={setManualMode}
              >
                <IconShield size={14} /><b>Manual</b>
              </button>
              <button
                className={`modex-action ok ${mode === 'LIVE_ARMED' ? 'on' : ''}`}
                type="button"
                aria-pressed={mode === 'LIVE_ARMED'}
                disabled={liveDisabled}
                title={liveTitle}
                onClick={setLiveMode}
              >
                <IconPulse size={14} /><b>Live</b>
              </button>
            </div>
          </div>
        );
      case 'mrefresh':
        return (
          <div className={`mrefx-pop ${refreshTone}`}>
            <div className={`mrefx-hero ${refreshTone}`}>
              <span className={`mrefx-mark ${menuRefreshState === 'spin' ? 'spin' : ''}`}><IconRefresh size={18} /></span>
              <span className="mrefx-score">
                <b>{refreshCode}</b>
                <em>{refreshStamp}</em>
              </span>
              <span className={`mrefx-bars ${refreshTone}`} aria-hidden="true"><i /><i /><i /></span>
            </div>
            <div className="mrefx-counters" aria-label="Market refresh telemetry">
              <span className={feedsOk ? 'ok' : 'warn'}><i /><b>{refreshFeedCount}</b><em>STR</em></span>
              <span className={latTone || 'idle'}><i /><b>{msLabel(lat)}</b><em>LAT</em></span>
              <span className={refreshTone}><i /><b>{refreshNetCode}</b><em>NET</em></span>
            </div>
            <div className="mrefx-presets" role="radiogroup" aria-label="Market refresh interval">
              {refreshChoices.map((r) => (
                <button
                  key={r.sec}
                  data-testid={`mrefresh-${r.sec}`}
                  className={`mrefx-preset ${prefs.refreshSec === r.sec ? 'on' : ''}`}
                  type="button"
                  role="radio"
                  aria-checked={prefs.refreshSec === r.sec}
                  aria-label={`${r.label} market refresh, ${r.sec} seconds`}
                  title={`${r.label} / ${r.sub}`}
                  onClick={() => setMarketRefresh(r.sec)}
                >
                  <b>{r.sec}</b><em>s</em>
                </button>
              ))}
            </div>
            <div className="mrefx-custom" aria-label="Custom market refresh seconds">
              <button data-testid="mrefresh-decrease" type="button" onClick={() => setMarketRefresh(prefs.refreshSec - 3)} aria-label="Decrease market refresh">-</button>
              <input data-testid="mrefresh-custom-input" value={refreshCustom} inputMode="numeric" type="number" min={3} max={120} step={1} onChange={(e) => setRefreshCustom(e.currentTarget.value)} onBlur={applyCustomRefresh} onKeyDown={(e) => { if (e.key === 'Enter') applyCustomRefresh(); }} aria-label="Custom market refresh seconds" />
              <button data-testid="mrefresh-increase" type="button" onClick={() => setMarketRefresh(prefs.refreshSec + 3)} aria-label="Increase market refresh">+</button>
              <button data-testid="mrefresh-now" className={`mrefx-now ${menuRefreshState}`} type="button" disabled={menuRefreshState === 'spin'} onClick={() => { void runMenuRefresh(); }} aria-label="Refresh market data now">
                <span className={menuRefreshState === 'spin' ? 'spin' : ''}><IconRefresh size={14} /></span>
                <b>{refreshActionText}</b>
              </button>
            </div>
          </div>
        );
      case 'currency':
        return (
          <div className={`curfx-pop ${curTone}`}>
            <div className={`curfx-hero ${curTone}`}>
              <span className="curfx-mark">{curSymbol}</span>
              <span className="curfx-score">
                <b>{cur}</b>
                <em>{curFxCode}</em>
              </span>
              <span className={`curfx-bars ${curTone}`} aria-hidden="true"><i /><i /><i /></span>
            </div>
            <div className="curfx-counters" aria-label="Display currency telemetry">
              <span className={curTone}><i /><b>{curRateText}</b><em>RATE</em></span>
              <span className={curTone}><i /><b>{curFxCode}</b><em>FX</em></span>
              <span><i /><b>{curAgeCode}</b><em>AGE</em></span>
            </div>
            <div className="curfx-grid" role="radiogroup" aria-label="Display currency">
              {Object.entries(CURRENCIES).map(([code, c]) => (
                <button
                  key={code}
                  data-testid={`currency-${code}`}
                  className={`curfx-option ${cur === code ? 'on' : ''}`}
                  type="button"
                  role="radio"
                  aria-checked={cur === code}
                  aria-label={`${c.label} display currency`}
                  title={`${code} / ${currencyRateText(code)}`}
                  onClick={() => updatePref('currency', code)}
                >
                  <i>{c.symbol.trim() || code}</i>
                  <span><b>{code}</b><em>{currencyRateText(code)}</em></span>
                </button>
              ))}
            </div>
          </div>
        );
      case 'appearance':
        const themeModes = [
          { id: 'system', label: 'System', mark: 'A' },
          { id: 'light', label: 'Light', mark: '☼' },
          { id: 'dark', label: 'Dark', mark: '◐' },
        ] as const;
        const setZoom = (next: number) => updatePref('zoom', Math.min(1.5, Math.max(0.8, Math.round(next * 100) / 100)));
        return (
          <div className={`apx-pop apx-premium ${theme}`} style={{ '--apx-accent': activeAccent.hex } as CSSProperties}>
            <div className={`apx-stage ${prefs.theme}`}>
              <span className="apx-window" aria-hidden="true"><i /><i /><i /></span>
              <span className="apx-rail" aria-hidden="true"><i /><i /><i /></span>
              <span className="apx-orb" aria-hidden="true" />
              <b>{appearanceZoom}%</b>
            </div>
            <div className="apx-modes" role="radiogroup" aria-label="Theme mode">
              {themeModes.map((m) => (
                <button
                  key={m.id}
                  data-testid={`appearance-theme-${m.id}`}
                  className={`apx-mode ${prefs.theme === m.id ? 'on' : ''}`}
                  type="button"
                  role="radio"
                  aria-checked={prefs.theme === m.id}
                  aria-label={`${m.label} theme`}
                  title={m.label}
                  onClick={() => updatePref('theme', m.id)}
                >
                  <span className={`apx-mode-art ${m.id}`} aria-hidden="true"><i /><i /><i /></span>
                  <b>{m.mark}</b>
                </button>
              ))}
            </div>
            <div className="apx-dots" role="radiogroup" aria-label="Accent">
              {ACCENT_ORDER.map((kk) => {
                const a = ACCENTS[kk];
                const selected = prefs.accent === kk;
                return (
                  <button
                    key={kk}
                    data-testid={`appearance-accent-${kk}`}
                    className={`apx-dot ${selected ? 'on' : ''}`}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => updatePref('accent', kk)}
                    title={a.label}
                    aria-label={`${a.label} accent`}
                    style={{ '--dot': a.hex } as CSSProperties}
                  >
                    <span />
                    <i />
                  </button>
                );
              })}
            </div>
            <div className="apx-scale" aria-label="Interface scale">
              <button data-testid="appearance-zoom-out" type="button" onClick={() => setZoom((prefs.zoom || 1) - 0.05)} aria-label="Zoom out">−</button>
              <strong>{appearanceZoom}%</strong>
              <button data-testid="appearance-zoom-in" type="button" onClick={() => setZoom((prefs.zoom || 1) + 0.05)} aria-label="Zoom in">+</button>
              <button data-testid="appearance-zoom-reset" className="reset" type="button" onClick={() => updatePref('zoom', 1.05)} aria-label="Reset scale" title="Reset scale">↺</button>
            </div>
          </div>
        );
      case 'basisu':
        return (
          <div className={`basisx-pop ${basisIsBps ? 'bps' : 'pct'}`}>
            <div className={`basisx-hero ${basisIsBps ? 'bps' : 'pct'}`}>
              <span className="basisx-mark">{basisMark}</span>
              <span className="basisx-score">
                <b>{basisCode}</b>
                <em>{basisPreview}</em>
              </span>
              <span className={`basisx-bars ${basisIsBps ? 'bps' : 'pct'}`} aria-hidden="true"><i /><i /><i /></span>
            </div>
            <div className="basisx-counters" aria-label="Basis conversion telemetry">
              <span><i /><b>1bp</b><em>.01%</em></span>
              <span><i /><b>100</b><em>bp/%</em></span>
              <span className={basisIsBps ? 'bps' : 'pct'}><i /><b>{basisAltPreview}</b><em>ALT</em></span>
            </div>
            <div className="basisx-options" role="radiogroup" aria-label="Basis display unit">
              <button
                data-testid="basis-unit-pct"
                className={`basisx-option pct ${!basisIsBps ? 'on' : ''}`}
                type="button"
                role="radio"
                aria-checked={!basisIsBps}
                aria-label="Percent basis display"
                title="Percent"
                onClick={() => updatePref('basisUnit', 'pct')}
              >
                <i>%</i>
                <span><b>PCT</b><em>+0.042%</em></span>
              </button>
              <button
                data-testid="basis-unit-bps"
                className={`basisx-option bps ${basisIsBps ? 'on' : ''}`}
                type="button"
                role="radio"
                aria-checked={basisIsBps}
                aria-label="Basis points display"
                title="Basis points"
                onClick={() => updatePref('basisUnit', 'bps')}
              >
                <i>bp</i>
                <span><b>BPS</b><em>+4.2</em></span>
              </button>
            </div>
          </div>
        );
    }
  };

  const contentClean = (k: MK) => {
    if (k === 'clock' || k === 'shell') return content(k);

    if (k === 'apikey') {
      const visibleKeys = [roKey, fullKey].filter((ak): ak is ApiKeyInfo => !!ak);
      const liveCount = visibleKeys.filter((ak) => ak.status === 'live').length;
      const ipLocked = visibleKeys.length > 0 && visibleKeys.every((ak) => ak.ipRestrict);
      const withdrawalsOpen = visibleKeys.some((ak) => ak.permissions.withdrawals);
      return (
        <div className="topux-panel">
          <div className="topux-head">
            <span><IconKey size={16} />API Keys</span>
            <em className={withdrawalsOpen ? 'warn' : liveCount ? 'ok' : 'idle'}>{withdrawalsOpen ? 'Review' : liveCount ? 'Locked' : 'Setup'}</em>
          </div>
          {visibleKeys.length === 0 ? (
            <div className="topux-empty">No Binance API key is connected.</div>
          ) : (
            <div className="topux-list">
              {visibleKeys.map((ak) => (
                <div key={ak.id} className="topux-key-row">
                  <span>
                    <b>{ak.name}</b>
                    <small>{ak.prefix ? `${ak.prefix}...${ak.fingerprint ?? ''}` : ak.scope}</small>
                  </span>
                  <em className={ak.status === 'live' ? 'ok' : ak.status === 'planned' ? 'warn' : 'idle'}>{ak.status === 'live' ? 'Live' : ak.status === 'planned' ? 'Planned' : 'Set'}</em>
                </div>
              ))}
            </div>
          )}
          <div className="topux-perms">
            {API_PERMS.map((p) => {
              const read = !!roKey?.permissions[p.key];
              const full = !!fullKey?.permissions[p.key];
              return (
                <div key={p.key} className={`topux-perm ${p.key === 'withdrawals' && (read || full) ? 'risk' : ''}`}>
                  <span>{p.label.replace('Spot & Margin & Stock Trading', 'Spot / Margin').replace('Permits Universal Transfer', 'Universal Transfer')}</span>
                  <b>{read ? 'Read' : full ? 'Full' : 'Off'}</b>
                </div>
              );
            })}
          </div>
          <div className="topux-actions">
            <button className="topux-action primary" type="button" onClick={() => { setActive(null); openOverlay('apikey'); }}>
              <IconShield size={14} /> Open Security
            </button>
            <span className={`topux-note ${ipLocked ? 'ok' : 'warn'}`}>{ipLocked ? 'IP locked' : 'IP open'}</span>
          </div>
        </div>
      );
    }

    if (k === 'data') {
      return (
        <div className="topux-panel">
          <div className="topux-head">
            <span><IconDatabase size={16} />Data Health</span>
            <em className={netGrade === 'ok' ? 'ok' : netGrade === 'warn' ? 'warn' : 'bad'}>{dataLabel}</em>
          </div>
          <div className="topux-list compact">
            {dataRows.map((row) => (
              <div key={row.name} className="topux-row">
                <span>
                  <b>{row.name}</b>
                  <small>{row.sub}</small>
                </span>
                <em className={row.tier}>{row.value}</em>
              </div>
            ))}
          </div>
          <button className="topux-action" type="button" onClick={() => { setActive(null); setPage('system'); }}>
            <IconPulse size={14} /> Open Health
          </button>
        </div>
      );
    }

    if (k === 'advisor') {
      const rows = advAtt.length ? advAtt : advChecks.filter((c) => c.sev === 'pass').slice(0, 4);
      return (
        <div className="topux-panel">
          <div className="topux-head">
            <span><IconShield size={16} />Trust Advisor</span>
            <em className={advTone === 'ok' ? 'ok' : advTone === 'warn' ? 'warn' : 'bad'}>{advTone === 'ok' ? 'Clean' : advTone === 'warn' ? 'Review' : 'Action'}</em>
          </div>
          <div className="topux-summary">
            <span><b>{advP.length}</b><small>Passed</small></span>
            <span><b>{advI.length}</b><small>Review</small></span>
            <span><b>{advA.length}</b><small>Action</small></span>
          </div>
          <div className="topux-list">
            {rows.map((c) => (
              <button key={c.name} className="topux-row button" type="button" disabled={!c.page} onClick={() => { if (c.page) { setActive(null); setPage(c.page); } }}>
                <span>
                  <b>{c.name}</b>
                  <small>{c.detail}</small>
                </span>
                <em className={c.sev === 'pass' ? 'good' : c.sev === 'invest' ? 'warn' : 'bad'}>{c.sev === 'pass' ? 'OK' : c.sev === 'invest' ? 'Review' : 'Fix'}</em>
              </button>
            ))}
          </div>
          <button className="topux-action" type="button" onClick={() => { setActive(null); setPage('risk'); }}>
            <IconRadar size={14} /> Open Risk
          </button>
        </div>
      );
    }

    if (k === 'notif') {
      return (
        <div className="topux-panel">
          <div className="topux-head">
            <span><IconBell size={16} />Notifications</span>
            <em className={unread ? 'bad' : events.length ? 'ok' : 'idle'}>{unread ? `${unread} New` : `${events.length} Total`}</em>
          </div>
          <div className="topux-tabs" role="tablist" aria-label="Notification filters">
            {notifTabs.map((t) => (
              <button key={t.id} className={notifTab === t.id ? 'on' : ''} type="button" role="tab" aria-selected={notifTab === t.id} onClick={() => setNotifTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {notifTab === 'custom' ? (
            <div className="topux-list">
              {alertRows.map((r) => (
                <div key={r.key} className="topux-row switch">
                  <span>
                    <b>{r.label}</b>
                    <small>{r.sub}</small>
                  </span>
                  <button className={`toggle ${al[r.key] ? 'on' : ''}`} type="button" onClick={() => updatePref('alerts', { ...al, [r.key]: !al[r.key] })} aria-label={`Toggle ${r.label}`}>
                    <span className="knob" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="topux-list">
              {filteredNotifEvents.length === 0 ? (
                <div className="topux-empty">No notifications in this filter.</div>
              ) : filteredNotifEvents.slice(0, 4).map((e) => {
                const meta = notifMeta(e.kind);
                const summary = eventSummary(e.kind, (e.data as Record<string, unknown> | null) ?? null, e.symbol);
                return (
                  <button key={e.id} className="topux-row button" type="button" title={summary} onClick={() => { setActive(null); setPage('ledger'); }}>
                    <span>
                      <b>{meta.scope}</b>
                      <small>{summary}</small>
                    </span>
                    <em>{timeAgo(e.ts)}</em>
                  </button>
                );
              })}
            </div>
          )}
          <button className="topux-action" type="button" onClick={() => { setActive(null); setPage('ledger'); }}>
            <IconReceipt size={14} /> Open Ledger
          </button>
        </div>
      );
    }

    if (k === 'power') {
      return (
        <div className="topux-panel">
          <div className="topux-head">
            <span><IconPower size={16} />Trading Mode</span>
            <em className={modeTone === 'ok' ? 'ok' : modeTone === 'warn' ? 'warn' : 'bad'}>{mode === 'HALTED' ? 'Halted' : mode === 'LIVE_ARMED' ? 'Live' : 'Manual'}</em>
          </div>
          <div className="topux-summary">
            <span><b>{allowCount}</b><small>Symbols</small></span>
            <span><b>{b?.connected ? 'Online' : 'Offline'}</b><small>Binance</small></span>
            <span><b>{modeSend}</b><small>Orders</small></span>
          </div>
          <div className="topux-mode-actions">
            <button className={`bad ${mode === 'HALTED' ? 'on' : ''}`} type="button" onClick={() => { void setKill(true); }}><IconPower size={14} /><span>Halt</span></button>
            <button className={`warn ${mode === 'MANUAL' ? 'on' : ''}`} type="button" onClick={setManualMode}><IconShield size={14} /><span>Manual</span></button>
            <button className={`ok ${mode === 'LIVE_ARMED' ? 'on' : ''}`} type="button" disabled={liveDisabled} title={liveTitle} onClick={setLiveMode}><IconPulse size={14} /><span>Live</span></button>
          </div>
        </div>
      );
    }

    if (k === 'mrefresh') {
      return (
        <div className="topux-panel">
          <div className="topux-head">
            <span><IconRefresh size={16} />Market Refresh</span>
            <em className={refreshTone === 'ok' ? 'ok' : refreshTone === 'warn' ? 'warn' : 'bad'}>{refreshLabel}</em>
          </div>
          <div className="topux-subline">{refreshDetail}</div>
          <div className="topux-presets">
            {refreshChoices.map((r) => (
              <button key={r.sec} className={prefs.refreshSec === r.sec ? 'on' : ''} type="button" onClick={() => setMarketRefresh(r.sec)}>
                <b>{r.sec}s</b><span>{r.label}</span>
              </button>
            ))}
          </div>
          <div className="topux-custom">
            <button type="button" onClick={() => setMarketRefresh(prefs.refreshSec - 3)} aria-label="Decrease market refresh">−</button>
            <label><span>Custom</span><input value={refreshCustom} inputMode="numeric" type="number" min={3} max={120} step={1} onChange={(e) => setRefreshCustom(e.currentTarget.value)} onBlur={applyCustomRefresh} onKeyDown={(e) => { if (e.key === 'Enter') applyCustomRefresh(); }} /></label>
            <button type="button" onClick={() => setMarketRefresh(prefs.refreshSec + 3)} aria-label="Increase market refresh">+</button>
            <button className="topux-action mini" type="button" disabled={menuRefreshState === 'spin'} onClick={() => { void runMenuRefresh(); }}>
              <IconRefresh size={13} /> Refresh Now
            </button>
          </div>
        </div>
      );
    }

    if (k === 'currency') {
      return (
        <div className="topux-panel">
          <div className="topux-head">
            <span><IconDollar size={16} />Display Currency</span>
            <em className={curTone === 'ok' ? 'ok' : curTone === 'warn' ? 'warn' : 'bad'}>{cur}</em>
          </div>
          <div className="topux-subline">Current rate: {curRateText}</div>
          <div className="topux-list">
            {Object.entries(CURRENCIES).map(([code, c]) => (
              <button key={code} className={`topux-row button currency ${cur === code ? 'on' : ''}`} type="button" onClick={() => updatePref('currency', code)}>
                <span>
                  <b>{c.label}</b>
                  <small>{code}</small>
                </span>
                <em>{currencyRateText(code)}</em>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (k === 'basisu') {
      return (
        <div className="topux-panel">
          <div className="topux-head">
            <span><IconPercent size={16} />Basis Display</span>
            <em>{basisIsBps ? 'Basis Points' : 'Percent'}</em>
          </div>
          <div className="topux-options">
            <button className={!basisIsBps ? 'on' : ''} type="button" onClick={() => updatePref('basisUnit', 'pct')}>
              <b>Percent</b>
              <small>Example +0.042%</small>
            </button>
            <button className={basisIsBps ? 'on' : ''} type="button" onClick={() => updatePref('basisUnit', 'bps')}>
              <b>Basis Points</b>
              <small>Example +4.2 bps</small>
            </button>
          </div>
        </div>
      );
    }

    if (k === 'appearance') {
      const themeModes = [
        { id: 'system', label: 'System' },
        { id: 'light', label: 'Light' },
        { id: 'dark', label: 'Dark' },
      ] as const;
      const setZoom = (next: number) => updatePref('zoom', Math.min(1.5, Math.max(0.8, Math.round(next * 100) / 100)));
      return (
        <div className="topux-panel">
          <div className="topux-head">
            <span><IconSun size={16} />Appearance</span>
            <em>{appearanceZoom}%</em>
          </div>
          <div className="topux-tabs theme">
            {themeModes.map((m) => (
              <button key={m.id} className={prefs.theme === m.id ? 'on' : ''} type="button" onClick={() => updatePref('theme', m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="topux-dots" role="radiogroup" aria-label="Accent">
            {ACCENT_ORDER.map((kk) => {
              const a = ACCENTS[kk];
              return (
                <button key={kk} className={prefs.accent === kk ? 'on' : ''} type="button" onClick={() => updatePref('accent', kk)} title={a.label} aria-label={`${a.label} accent`} style={{ '--dot': a.hex } as CSSProperties}>
                  <span />
                </button>
              );
            })}
          </div>
          <div className="topux-scale">
            <button type="button" onClick={() => setZoom((prefs.zoom || 1) - 0.05)}>−</button>
            <strong>{appearanceZoom}%</strong>
            <button type="button" onClick={() => setZoom((prefs.zoom || 1) + 0.05)}>+</button>
            <button type="button" onClick={() => updatePref('zoom', 1.05)}>Reset</button>
          </div>
        </div>
      );
    }

    return content(k);
  };

  return (
    <div className="smenu-bar" ref={rowRef} onMouseLeave={scheduleClose}>
      {trig('clock', 'hdr-clock-btn clock-pro-btn', <>
        <span className="clock-orbit"><span /></span>
        <span className="clock-pro-time"><b>{activeClock.raw}</b><small>{zone.label}</small></span>
      </>, { title: `Clock & timezone — ${zone.city}` })}
      {trig('shell', 'hdr-ic tint-shell shell-ghost shell-premium-trigger', <>
        <span className="shell-trigger-core">
          <IconTerminal size={16} />
        </span>
      </>, { title: 'AWS CloudShell' })}
      {trig('apikey', `hdr-ic apikey-ghost apikey-premium-trigger s-${roKey?.status ?? 'declared'}`, <>
        <span className={`key-trigger-core s-${roKey?.status ?? 'declared'}`}>
          <IconKey size={16} />
        </span>
      </>, { title: 'API keys — read-only live · full planned' })}
      {trig('data', `hdr-ic data-ghost data-pro grade-${netGrade}`, <>
        <span className={`data-pro-core ${netGrade}`}>
          <IconDatabase size={16} />
        </span>
      </>, { title: `Data Health — ${dataLabel} · ${dataSub}` })}
      {trig('advisor', `hdr-ic advisor-ghost advisor-premium-trigger grade-${advTone}`, <>
        <span className={`advisor-trigger-core ${advTone}`}>
          <IconShield size={16} />
        </span>
      </>, { title: 'Trusted advisor — cockpit safety scan' })}
      {trig('notif', `hdr-ic notif-trigger notif-ghost notif-premium-trigger ${notifTone}`, <>
        <span className={`notif-trigger-core ${notifTone}`}>
          <IconBell size={16} />
        </span>
      </>, { title: 'Notifications & alerts' })}
      {trig('power', `hdr-ic power-ghost power-premium-trigger ${modeClass}`, <>
        <span className={`power-trigger-core ${modeTone}`}>
          <IconPower size={16} />
        </span>
      </>, { title: 'Kill switch & trading mode' })}
      {trig('mrefresh', `hdr-ic refresh-ghost refresh-premium-trigger ${refreshTone} ${menuRefreshState === 'spin' ? 'spinning' : ''}`, <>
        <span className={`refresh-trigger-core ${refreshTone}`}>
          <IconRefresh size={16} />
        </span>
      </>, { title: `Market refresh — every ${prefs.refreshSec}s` })}
      {trig('currency', `hdr-ic currency-ghost currency-premium-trigger ${curTone}`, <>
        <span className={`currency-trigger-core ${curTone}`}>
          <b>{curSymbol}</b>
        </span>
      </>, { title: `Display currency — ${cur}` })}
      {trig('basisu', `hdr-ic basis-ghost basis-premium-trigger ${basisIsBps ? 'basis-bps' : 'basis-pct'}`, <>
        <span className={`basis-trigger-core ${basisIsBps ? 'bps' : 'pct'}`}>
          {basisIsBps ? <b>{basisMark}</b> : <IconPercent size={19} />}
        </span>
      </>, { title: `Basis units — ${basisIsBps ? 'basis points' : 'percent'}` })}
      {trig('appearance', `hdr-ic appearance-ghost appearance-premium-trigger ${theme}`, <>
        <span className={`appearance-trigger-core ${theme}`} style={{ '--apx-accent': activeAccent.hex } as CSSProperties}>
          {theme === 'dark' ? <IconMoon size={19} /> : <IconSun size={19} />}
        </span>
      </>, { title: `Appearance — ${prefs.theme === 'system' ? 'auto' : prefs.theme} · ${appearanceZoom}%` })}
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
  const { page, setPage } = useStore();

  useEffect(() => {
    document.title = `Arbitrage Control Room · ${TITLES[page]}`;
  }, [page]);

  return (
    <header className="hdr">
      <div className="hdr-in">
        <div className="hdr-brand" onClick={() => setPage('dashboard')} title="Arbitrage Control Room" role="button" aria-label="Arbitrage Control Room home">
          {BRAND_MARK}
          <div className="brand-lockup">
            <div className="brand-name">Arbitrage</div>
            <div className="brand-sub">Control Room</div>
          </div>
        </div>
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
