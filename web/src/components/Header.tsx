import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useStore, useResolvedTheme, type Page } from '../store';
import type { LedgerEvent } from '../types';
import { fmtClockZone, timeAgo } from '../format';
import { eventSummary } from '../lib/eventText';
import { calVal, flag, type CalItem } from '../lib/calendar';
import { curateNotifications, groupNotifications, notificationEnabled } from '../lib/notifications';
import { ACCENTS, CURRENCIES, MARKET_PING_CHOICES, MARKET_PING_KEYS, type AccentKey, type DataCadenceKey, type NotificationRuleKey } from '../lib/prefs';
import { openOverlay, useOverlay } from '../lib/overlay';
import { TokenIcon } from './TokenIcon';
import {
  AWS_CONSOLE_URL,
  AWS_RUNNER_MARK,
  AwsRunnerModal,
  fetchAwsRunnerStatus,
  updateAwsRunnerGates,
  type AwsRunnerStatus,
} from './AwsRunnerControl';
import { CurrencyDollarIcon as PopupCurrencyIcon } from '@phosphor-icons/react/dist/csr/CurrencyDollar';
import { PaletteIcon as PopupPaletteIcon } from '@phosphor-icons/react/dist/csr/Palette';
import { PercentIcon as PopupPercentIcon } from '@phosphor-icons/react/dist/csr/Percent';
import { PowerIcon as PopupPowerIcon } from '@phosphor-icons/react/dist/csr/Power';
import {
  BadgeCheck as LucideAdvisorClear,
  BellRing as LucideBell,
  CircleAlert as LucideAdvisorReview,
  CircleDollarSign as LucideCurrency,
  Laptop as LucideLaptop,
  Palette as LucidePalette,
  Percent as LucideBasis,
  Power as LucidePower,
  Radar as LucideNotifOpportunity,
  ScrollText as LucideNotifLog,
  ShieldAlert as LucideNotifCritical,
  Smartphone as LucideSmartphone,
  TriangleAlert as LucideAdvisorAction,
  WalletCards as LucideNotifAccount,
} from 'lucide-react';
import {
  IconAlarm,
  IconBell,
  IconBrain,
  IconCalendar,
  IconCamera,
  IconChart,
  IconClock,
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
  IconWallet,
  IconWifi,
} from './Icons';

// Market-desk clock zones. Keep these names human and distinct; never expose
// the browser-derived `LOC` label in the operator rail.
const ZONES: { id: string; label: string; city: string; detail: string }[] = [
  { id: 'Asia/Kolkata', label: 'IST', city: 'India', detail: 'India Standard Time' },
  { id: 'UTC', label: 'UTC', city: 'UTC', detail: 'Coordinated Universal Time' },
  { id: 'America/New_York', label: 'NYC', city: 'New York', detail: 'Eastern Market Desk' },
  { id: 'Asia/Singapore', label: 'ASIA', city: 'Asia', detail: 'Singapore Market Desk' },
  { id: 'Europe/London', label: 'EUR', city: 'Europe', detail: 'London Market Desk' },
];

const ACCENT_ORDER: AccentKey[] = ['r', 'o', 'y', 'g', 'b', 'i', 'v'];

const DEFAULT_PROFILE_LOGO = '/profile-logo.png';
const API_KEY_MARK = '/api-key-mark.png';
const DATA_HEALTH_MARK = '/data-health-shield.png';
const MARKET_PING_MARK = '/market-ping.png';
const TRUST_ADVISOR_MARK = '/trust-advisor-shield.png';
const NOTIFICATION_MARK = '/notification-bell.png';
const DEPLOYED_APP_HOST = 'arbitrage.cosmosgeek.org';
const TOPBAR_POPOVER_CONTENT_HEIGHT = 486;

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
  const close = useCallback(() => setOpen(false), []);
  const openExclusive = useCallback(() => {
    window.clearTimeout(closeT.current);
    if (currentCloser && currentCloser !== close) currentCloser();
    currentCloser = close;
    setOpen(true);
  }, [close]);
  useEffect(() => {
    if (!hover) return;
    const el = ref.current;
    if (!el) return;
    const enter = () => { window.clearTimeout(closeT.current); openExclusive(); };
    const leave = () => {
      window.clearTimeout(closeT.current);
      closeT.current = window.setTimeout(() => {
        if (currentCloser === close) currentCloser = null;
        close();
      }, 240);
    };
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    return () => {
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', leave);
      window.clearTimeout(closeT.current);
    };
  }, [close, hover, openExclusive]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [close, open]);
  const setOpenExclusive = useCallback((v: boolean) => (v ? openExclusive() : close()), [close, openExclusive]);
  return { open, setOpen: setOpenExclusive, ref };
}

// A small live-pulsing dot for anything that refreshes continuously.
export function LiveDot({ ok = true, title = 'Live — refreshing' }: { ok?: boolean; title?: string }) {
  return <span className={`live-dot ${ok ? 'on' : 'off'}`} title={title} aria-hidden />;
}

function MiniMegaphone({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 14h3l8 4V6l-8 4H5z" />
      <path d="M8 14v4" />
      <path d="M19 9.5a4.5 4.5 0 0 1 0 5" />
    </svg>
  );
}

function MiniDevice({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M10 6h4M11 18h2" />
    </svg>
  );
}

function MiniMessage({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="m5 8 7 5 7-5" />
    </svg>
  );
}

function BasisUnitGlyph({ size = 31 }: { size?: number }) {
  return (
    <span className="basis-unit-logo" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 31 31" fill="none">
        <path className="rail low" d="M6 20.5h8.5c2.6 0 3.9-10 6.5-10H25" />
        <path className="rail high" d="M6 10.5h8.5c2.6 0 3.9 10 6.5 10H25" />
        <path className="zero" d="M15.5 7v17" />
        <circle className="node left" cx="6" cy="15.5" r="2" />
        <circle className="node right" cx="25" cy="15.5" r="2" />
      </svg>
    </span>
  );
}

function CurrencyUnitGlyph({ size = 31 }: { size?: number }) {
  return (
    <span className="currency-unit-logo" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 31 31" fill="none">
        <circle className="coin main" cx="12" cy="12" r="6.5" />
        <circle className="coin quote" cx="19.5" cy="19" r="5.5" />
        <path className="mark" d="M12 8.5v7M9.5 10.5h4.8M9.5 13.5h4.8" />
        <path className="arrow" d="M18 10.5h4.2m0 0-1.6-1.6m1.6 1.6-1.6 1.7M13 21h-4.2m0 0 1.6-1.7M8.8 21l1.6 1.6" />
      </svg>
    </span>
  );
}

function DataCadenceGlyph({ size = 31 }: { size?: number }) {
  return (
    <span className="cadence-unit-logo" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 31 31" fill="none">
        <path className="ring" d="M15.5 5.8a9.7 9.7 0 1 1-8.2 4.5" />
        <path className="tick" d="M15.5 9v6.7l4.4 2.5" />
        <path className="pulse" d="M6 16h3.2l1.4-3.3 2.6 6.6 1.9-3.3H25" />
        <circle className="node" cx="6.8" cy="8.5" r="2" />
      </svg>
    </span>
  );
}

function DataHealthGlyph({ size = 31 }: { size?: number }) {
  return (
    <span className="data-health-logo" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 31 31" fill="none">
        <path className="grid top" d="M6.4 9h18.2" />
        <path className="grid mid" d="M6.4 15.5h18.2" />
        <path className="grid bot" d="M6.4 22h18.2" />
        <path className="pulse" d="M6.3 15.5h4l1.8-4.7 3.2 9.6 2.3-4.9h7.1" />
        <circle className="node one" cx="8.3" cy="9" r="1.65" />
        <circle className="node two" cx="18.4" cy="15.5" r="1.65" />
        <circle className="node three" cx="23.3" cy="22" r="1.65" />
      </svg>
    </span>
  );
}

function NotificationCenterGlyph({ size = 31 }: { size?: number }) {
  return (
    <span className="notification-center-logo" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 31 31" fill="none">
        <path className="wave" d="M7 11.2c1.3-2.7 4.2-4.7 8.5-4.7 4.4 0 7.2 2 8.5 4.7" />
        <path className="bell" d="M10 17.4v-3.1c0-3.2 2.2-5.4 5.5-5.4s5.5 2.2 5.5 5.4v3.1l2.1 2.7H7.9l2.1-2.7Z" />
        <path className="clapper" d="M13.2 22.5c.5 1 1.2 1.6 2.3 1.6s1.8-.6 2.3-1.6" />
        <circle className="ping" cx="22.9" cy="8.3" r="2.2" />
      </svg>
    </span>
  );
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
  news: 'Market News',
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
// ---- account sheet ----------------------------------------------------------
// Account belongs to the same persistent topbar shell as every other operator
// surface. Keeping its real session/profile logic in a dedicated sheet lets the
// shared rail own hover, focus, motion, and dismissal without a second popover.
function AccountSheet({ open }: { open: boolean }) {
  const { state, saveConfig } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const profile = state?.config.profile ?? { name: '', avatar: null };
  const [preview, setPreview] = useState<string | null>(null); // instant feedback before the 2s state tick
  const [editName, setEditName] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AccountSessionRow[]>([]);
  const avatar = preview ?? profile.avatar ?? DEFAULT_PROFILE_LOGO;
  const usesDefaultLogo = !preview && !profile.avatar;
  const name = profile.name || 'Operator';
  const displayName = name.toLocaleUpperCase();
  const initial = name.trim().slice(0, 1).toUpperCase() || 'O';
  const connected = !!state?.binance.keysPresent;
  const accountTone = connected ? (state?.binance.connected ? 'live' : 'warn') : 'off';
  const hostLabel = typeof window !== 'undefined' ? window.location.host : 'local';
  const activeSessionCount = sessions.filter((s) => s.current || s.active).length;
  const sessionRows = sessions;
  const keyFingerprint = state?.binance.keyFingerprint ?? null;
  const withdrawalsOff = !state?.binance.canWithdraw;
  const logoutHref = typeof window !== 'undefined' && window.location.hostname === DEPLOYED_APP_HOST
    ? '/cdn-cgi/access/logout'
    : `https://${DEPLOYED_APP_HOST}/cdn-cgi/access/logout`;

  // Recent browser request telemetry is the only live data this popover owns.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => {
      void fetch('/api/sessions')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive || !d) return;
          setSessions(d.sessions ?? []);
        })
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 2000);
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
    <div className="ops-sheet ops-account-sheet account-sheet-v3">
          <header className="account-v3-head">
            <button className={`cb-profile-avatar ${usesDefaultLogo ? 'profile-logo' : ''}`} onClick={() => fileRef.current?.click()} title="Change profile image">
              {avatar ? <img src={avatar} alt="" /> : initial}
              <span className="acct-cam"><IconCamera size={11} /></span>
            </button>
            <div className="account-v3-identity">
              {editName === null ? (
                <button className="cb-profile-name" onClick={() => setEditName(profile.name || '')} title="Edit display name">{displayName}</button>
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
              <span>Control room operator</span>
            </div>
            <span className={`account-v3-state ${accountTone}`}><i />{state?.binance.connected ? 'Live' : connected ? 'Review' : 'Offline'}</span>
          </header>

          <div className="account-v3-body">
            <section className="account-v3-section" aria-label="Exchange posture">
              <div className="account-v3-section-title">
                <span>Exchange posture</span>
                <em>{state?.binance.connected ? 'Verified now' : 'Needs attention'}</em>
              </div>
              <div className="account-v3-exchange">
                <span className="account-v3-exchange-mark"><BinanceLogo size={28} /></span>
                <span className="account-v3-exchange-copy">
                  <b>Binance account</b>
                  <em>{keyFingerprint ? `Key ${keyFingerprint}` : connected ? 'Key loaded · fingerprint pending' : 'No server key loaded'}</em>
                </span>
                <span className={`account-v3-exchange-value ${state?.binance.connected ? 'ok' : connected ? 'warn' : 'idle'}`}>
                  <b>{state?.binance.connected ? 'Connected' : connected ? 'Sync error' : 'Not linked'}</b>
                  <em>{withdrawalsOff ? 'Withdrawals off' : 'Withdrawals on'}</em>
                </span>
              </div>
            </section>

            <section className="account-v3-section" aria-label="Recent browser sessions">
              <div className="account-v3-section-title">
                <span>Recent browser sessions</span>
                <em>{activeSessionCount ? `${activeSessionCount} recent` : 'None reported'}</em>
              </div>
              <div className="account-v3-session-list">
                {sessionRows.length > 0 ? sessionRows.map((s) => {
                  const ipLine = s.ip ? [s.ip, s.country].filter(Boolean).join(' · ') : 'local network';
                  const isPast = !s.current && !s.active;
                  const isMobile = /android|ios|iphone|ipad/i.test(s.system);
                  return (
                    <div className={`account-v3-session ${isPast ? 'past' : 'active'}`} key={s.id}>
                      <span className={`account-v3-device-mark ${s.active ? 'on' : 'off'}`}>
                        {isMobile ? <LucideSmartphone size={23} strokeWidth={1.7} /> : <LucideLaptop size={24} strokeWidth={1.7} />}
                        <i aria-hidden="true" />
                      </span>
                      <span className="account-v3-session-copy">
                        <b>{s.browser} on {s.system}</b>
                        <em>{ipLine} · {hostLabel}</em>
                      </span>
                      <span className="account-v3-session-time">
                        <b>{s.current ? 'This device' : isPast ? timeAgo(s.lastSeen) : 'Active'}</b>
                        {s.current ? (
                          <a href={logoutHref} title="Log out this Cloudflare Access session" aria-label={`Log out ${s.browser} on ${s.system}`}>
                            <IconPower size={13} /><span>Log out</span>
                          </a>
                        ) : (
                          <button type="button" disabled title="Remote logout needs a Cloudflare session identifier; this row is browser telemetry only" aria-label={`Remote logout unavailable for ${s.browser} on ${s.system}`}>
                            <IconPower size={13} /><span>Log out</span>
                          </button>
                        )}
                      </span>
                    </div>
                  );
                }) : (
                  <div className="account-v3-empty">No recent browser telemetry.</div>
                )}
              </div>
            </section>

            <a className="account-v3-logout" href={logoutHref} title="Sign out of the deployed Cloudflare Access session">
              <IconPower size={16} /><span>Log out of access session</span>
            </a>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
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
    { label: 'News', hint: 'Tree, RSS, Lookonchain, Binance', page: 'news', keywords: 'news tree rss lookonchain binance announcements listing delisting maintenance airdrop' },
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
    const t = setInterval(() => setNow(new Date()), 250);
    return () => clearInterval(t);
  }, []);
  const zone = ZONES.find((z) => z.id === prefs.clockZone) ?? ZONES[0];
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
    { key: 'critical', label: 'Critical & security', sub: 'Failures, blocks, and emergency controls' },
    { key: 'account', label: 'Account & execution', sub: 'Orders, fills, loans, and Binance state' },
    { key: 'bot', label: 'Bot health', sub: 'Engines, streams, and control changes' },
    { key: 'opportunities', label: 'Opportunities', sub: 'Opened basis and strategy signals' },
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
  usedWeightTs?: number | null;
  feeds?: Record<string, string>;
  dbOk?: boolean;
  lastScannerTickTs?: number | null;
  lastOrdersSyncTs?: number | null;
  cfUser?: string | null;
  cfIp?: string | null;
  cfCountry?: string | null;
  cfRay?: string | null;
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
    void probe('/api/news-context', 'news');
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

function BinanceLogo({ size = 32 }: { size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="keyx-source-logo" style={{ width: size, height: size }} aria-label="Binance">
      {!failed ? (
        <img
          src="/api/source-logo?domain=binance.com&sz=64"
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <IconExchange size={Math.max(14, size - 14)} />
      )}
    </span>
  );
}

function PanelWebLogo({ domain, label, fallback, size = 31 }: { domain: string; label: string; fallback: ReactNode; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="top-panel-web-logo" style={{ width: size, height: size }} aria-label={label}>
      {!failed ? (
        <img
          src={`/api/source-logo?domain=${encodeURIComponent(domain)}&sz=64`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : fallback}
    </span>
  );
}

function CloudflareMark({ size = 31 }: { size?: number }) {
  return (
    <span className="cloudflare-mark" style={{ width: size, height: size }} aria-label="Cloudflare">
      <svg role="img" viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <path d="M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727" />
      </svg>
    </span>
  );
}

function TopPanelHeader({
  className = '',
  logo,
  title,
  sub,
  value,
  status,
  action,
}: {
  className?: string;
  logo: ReactNode;
  title: string;
  sub?: ReactNode;
  value?: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`top-panel-head ${className}`}>
      <span className="top-panel-logo">{logo}</span>
      <span className="top-panel-copy">
        <b>{title}</b>
        {value !== undefined && <strong>{value}</strong>}
        {sub !== undefined && <em>{sub}</em>}
      </span>
      {(status !== undefined || action !== undefined) && (
        <span className="top-panel-right">
          {status !== undefined && <span className="top-panel-status">{status}</span>}
          {action}
        </span>
      )}
    </div>
  );
}

type OpsTone = 'ok' | 'warn' | 'bad' | 'idle' | 'accent';

function OpsSheetHeader({
  icon,
  title,
  subtitle,
  status,
  tone = 'idle',
}: {
  icon: ReactNode;
  title: string;
  subtitle: ReactNode;
  status?: ReactNode;
  tone?: OpsTone;
}) {
  return (
    <header className="ops-sheet-head">
      <span className="ops-sheet-icon">{icon}</span>
      <span className="ops-sheet-title"><b>{title}</b><em>{subtitle}</em></span>
      {status !== undefined && <span className={`ops-sheet-status ${tone}`}><i />{status}</span>}
    </header>
  );
}

function PopupSourceMark({
  children,
  tone,
  brand = false,
}: {
  children: ReactNode;
  tone: string;
  brand?: boolean;
}) {
  return (
    <span
      className={`popup-source-mark ${brand ? 'brand' : 'duotone'}`}
      style={{ '--popup-mark-tone': tone } as CSSProperties}
    >
      {children}
    </span>
  );
}

function HourglassMotionMark() {
  return (
    <svg className="clock-hourglass-mark" viewBox="0 0 36 36" aria-hidden="true">
      <g className="clock-hourglass-rotor">
        <rect className="clock-hourglass-cap" x="6" y="3" width="24" height="4" rx="2" />
        <rect className="clock-hourglass-cap" x="6" y="29" width="24" height="4" rx="2" />
        <path className="clock-hourglass-glass" d="M10 7h16c0 6.2-3.1 8-8 11 4.9 3 8 4.8 8 11H10c0-6.2 3.1-8 8-11-4.9-3-8-4.8-8-11Z" />
        <path className="clock-hourglass-sand" d="M12.2 9h11.6c-.7 3.2-2.7 4.8-5.8 6.8-3.1-2-5.1-3.6-5.8-6.8Zm0 18c.7-3.2 2.7-4.8 5.8-6.8 3.1 2 5.1 3.6 5.8 6.8H12.2Z" />
        <path className="clock-hourglass-stream" d="M18 15.4v5.2" />
      </g>
    </svg>
  );
}

function ClockPopupLogo({ accent }: { accent: string }) {
  return (
    <span className="clock-popup-logo" style={{ '--clock-accent': accent } as CSSProperties} aria-hidden="true">
      <svg viewBox="0 0 56 56">
        <circle className="clock-popup-ring" cx="28" cy="28" r="25" />
        <circle className="clock-popup-face" cx="28" cy="28" r="19.5" />
        <path className="clock-popup-hands" d="M28 15v13h11" />
        <circle className="clock-popup-pin" cx="28" cy="28" r="3.4" />
      </svg>
    </span>
  );
}

function OpsRow({
  icon,
  title,
  detail,
  value,
  tone = 'idle',
  selected = false,
  onClick,
  disabled = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  tone?: OpsTone | 'good';
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const body = (
    <>
      {icon !== undefined && <span className={`ops-row-icon ${tone}`}>{icon}</span>}
      <span className="ops-row-copy"><b>{title}</b>{detail !== undefined && <em>{detail}</em>}</span>
      {value !== undefined && <span className={`ops-row-value ${tone}`}>{value}</span>}
      {selected && <span className="ops-row-check"><IconCheck size={13} /></span>}
    </>
  );
  return onClick ? (
    <button className={`ops-row button ${selected ? 'selected' : ''}`} type="button" disabled={disabled} onClick={onClick}>{body}</button>
  ) : (
    <div className={`ops-row ${selected ? 'selected' : ''}`}>{body}</div>
  );
}

type MK = 'clock' | 'shell' | 'apikey' | 'data' | 'advisor' | 'notif' | 'power' | 'mrefresh' | 'currency' | 'basisu' | 'appearance' | 'account';
const TOPBAR_KEYS: MK[] = ['clock', 'data', 'mrefresh', 'shell', 'apikey', 'advisor', 'notif', 'power', 'currency', 'basisu', 'appearance', 'account'];
const MENU_W: Record<MK, number> = {
  clock: 400,
  shell: 400,
  apikey: 400,
  data: 400,
  advisor: 400,
  notif: 400,
  power: 400,
  mrefresh: 400,
  currency: 400,
  basisu: 400,
  appearance: 400,
  account: 400,
};

type NotifTab = 'all' | NotificationRuleKey | 'prefs';

const clockParts = (zoneId: string, d: Date) => {
  try {
    const opts: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    };
    if (zoneId && zoneId !== 'local') opts.timeZone = zoneId;
    const parts = new Intl.DateTimeFormat('en-GB', opts).formatToParts(d);
    const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const ss = parts.find((p) => p.type === 'second')?.value ?? '00';
    const hour = Number(hh) || 0;
    const minute = Number(mm) || 0;
    const second = (Number(ss) || 0) + d.getMilliseconds() / 1000;
    return {
      raw: `${hh}:${mm}:${ss}`,
      hm: `${hh}:${mm}`,
      ss,
      ampm: '',
      hour,
      minute,
      second,
      hourDeg: (hour % 12) * 30 + minute * 0.5 + second / 120,
      minuteDeg: minute * 6 + second * 0.1,
      secondDeg: second * 6,
    };
  } catch {
    const raw = fmtClockZone(zoneId, d);
    const [hh = '00', mm = '00', ss = '00'] = raw.split(':');
    const hour = Number(hh) || 0;
    const minute = Number(mm) || 0;
    const second = (Number(ss) || 0) + d.getMilliseconds() / 1000;
    return {
      raw: `${hh}:${mm}:${ss}`,
      hm: `${hh}:${mm}`,
      ss,
      ampm: '',
      hour,
      minute,
      second,
      hourDeg: (hour % 12) * 30 + minute * 0.5 + second / 120,
      minuteDeg: minute * 6 + second * 0.1,
      secondDeg: second * 6,
    };
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
    const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' };
    if (zoneId && zoneId !== 'local') opts.timeZone = zoneId;
    return new Intl.DateTimeFormat('en-US', opts).format(d);
  } catch {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' });
  }
};
export interface ApiKeyInfo {
  id: string; name: string; type: string; scope: string;
  status: 'live' | 'declared' | 'planned' | 'missing'; live: boolean; keysPresent?: boolean;
  prefix: string; fingerprint: string | null;
  ipRestrict: boolean; ips: string[]; ipNote: string;
  permissions: { reading: boolean; spotMargin: boolean; marginLoan: boolean; withdrawals: boolean; universalTransfer: boolean; futures: boolean };
  note: string | null;
}
// The six permissions the owner wants visible, in display order.
export const API_PERMS: { key: keyof ApiKeyInfo['permissions']; label: string }[] = [
  { key: 'reading', label: 'Reading' },
  { key: 'spotMargin', label: 'Spot / Margin' },
  { key: 'marginLoan', label: 'Loan / Repay' },
  { key: 'futures', label: 'Futures' },
  { key: 'universalTransfer', label: 'Universal Transfer' },
  { key: 'withdrawals', label: 'Withdrawals' },
];

const apiKeyRole = (ak: ApiKeyInfo) => {
  const scope = ak.scope.toLowerCase();
  if (ak.id === 'read-only' || scope.includes('read')) return 'Read-Only';
  if (ak.id === 'secrets-full' || scope.includes('automation') || scope.includes('full')) return 'AWS Automation';
  return ak.scope;
};

const apiKeyIp = (ak: ApiKeyInfo) => ak.ips[0] ?? 'IP not set';
const apiKeyStatus = (ak: ApiKeyInfo) => ak.live
  ? 'Live'
  : ak.status === 'planned'
    ? 'Planned'
    : ak.status === 'declared'
      ? 'Syncing'
      : 'Missing';

function BinanceApiKeySheet({ keys }: { keys: ApiKeyInfo[] }) {
  const visibleKeys = keys.slice(0, 2);
  const liveCount = visibleKeys.filter((ak) => ak.live).length;
  return (
    <div className="ops-sheet ops-key-sheet api-key-sheet-v2">
      <OpsSheetHeader
        icon={<PopupSourceMark tone="#f0b90b" brand><BinanceLogo size={34} /></PopupSourceMark>}
        title="Binance API Keys"
        subtitle="Two IP-bound access keys"
        status={liveCount ? `${liveCount} Live` : 'No Live Key'}
        tone={liveCount ? 'ok' : 'warn'}
      />
      {visibleKeys.length ? (
        <div className="api-key-pair" aria-label="Binance API key posture">
          {visibleKeys.map((ak) => (
            <section className={`api-key-object ${ak.status}`} key={ak.id}>
              <header>
                <span className="api-key-object-mark"><img src={API_KEY_MARK} alt="" /></span>
                <span className="api-key-object-copy">
                  <b>{apiKeyRole(ak)}</b>
                  <em>{apiKeyIp(ak)}</em>
                </span>
                <span className={`api-key-object-state ${ak.live ? 'live' : ak.status}`}><i />{apiKeyStatus(ak)}</span>
              </header>
              <div className="api-key-scope" aria-label={`${apiKeyRole(ak)} permissions`}>
                {API_PERMS.map((permission) => (
                  <span className={ak.permissions[permission.key] ? 'on' : 'off'} key={permission.key}>
                    <i />{permission.label}
                  </span>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="ops-empty-state"><IconKey size={18} /><b>No Key Inventory</b></div>
      )}
    </div>
  );
}

function SharedTopBar() {
  const { state, connected, page, prefs, updatePref, setPage, setKill, setLive, saveConfig, refresh } = useStore();
  const theme = useResolvedTheme();
  const rowRef = useRef<HTMLDivElement>(null);
  const menuContentRef = useRef<HTMLDivElement>(null);
  const incomingPaneRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Partial<Record<MK, HTMLButtonElement | null>>>({});
  const closeT = useRef<number | undefined>(undefined);
  const rafRef = useRef<number | undefined>(undefined);
  const morphT = useRef<number | undefined>(undefined);
  const [active, setActive] = useState<MK | null>(null);
  const [contentActive, setContentActive] = useState<MK | null>(null);
  const [outgoingContent, setOutgoingContent] = useState<MK | null>(null);
  const [contentDirection, setContentDirection] = useState<-1 | 1>(1);
  const contentHeight = TOPBAR_POPOVER_CONTENT_HEIGHT;
  const contentMaxHeight = TOPBAR_POPOVER_CONTENT_HEIGHT;
  const [geo, setGeo] = useState({ left: 0, width: 260, pointer: 130 });
  const geoRef = useRef(geo); geoRef.current = geo;
  const activeRef = useRef<MK | null>(null);
  const contentActiveRef = useRef<MK | null>(null);
  activeRef.current = active;
  contentActiveRef.current = contentActive;
  // Stable identity is essential: the global exclusivity controller compares
  // function references. Replacing this callback on each render made the rail
  // close itself while moving between adjacent triggers.
  const closeShared = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    window.clearTimeout(morphT.current);
    activeRef.current = null;
    contentActiveRef.current = null;
    setActive(null);
    setContentActive(null);
    setOutgoingContent(null);
  }, []);
  const [now, setNow] = useState(() => new Date());
  const [sys, setSys] = useState<SystemLite | null>(null);
  const [srv, setSrv] = useState<{ news: boolean | null; cal: boolean | null; fx: boolean | null }>({ news: null, cal: null, fx: null });
  const [seen, setSeen] = useState(() => Number(localStorage.getItem('cosmos-notif-seen') || 0));
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [notifTab, setNotifTab] = useState<NotifTab>('all');
  const [notifDetailOpen, setNotifDetailOpen] = useState(false);
  const [notifDraftAlerts, setNotifDraftAlerts] = useState(() => prefs.alerts);
  const [notifLiveEvents, setNotifLiveEvents] = useState<LedgerEvent[]>([]);
  const notifLiveCursor = useRef(0);
  const [notifArchive, setNotifArchive] = useState<LedgerEvent[]>([]);
  const [notifArchiveBusy, setNotifArchiveBusy] = useState(false);
  const [notifArchiveError, setNotifArchiveError] = useState<string | null>(null);
  const [notifDay, setNotifDay] = useState('all');
  const [cadenceTarget, setCadenceTarget] = useState<DataCadenceKey>('market');
  const [refreshCustom, setRefreshCustom] = useState(() => String(prefs.refreshSec));
  const [menuRefreshState, setMenuRefreshState] = useState<'idle' | 'spin' | 'ok' | 'err'>('idle');
  const menuRefreshBusy = useRef(false);
  const [currencyFx, setCurrencyFx] = useState<{ ok: boolean | null; rates: Record<string, number>; fetchedAt: number | null }>({ ok: null, rates: {}, fetchedAt: null });
  const [currencyBusy, setCurrencyBusy] = useState(false);
  const [currencyNotional, setCurrencyNotional] = useState(1000);
  const [basisSamplePct, setBasisSamplePct] = useState(0.042);
  const [awsStatus, setAwsStatus] = useState<AwsRunnerStatus | null>(null);
  const [awsStatusError, setAwsStatusError] = useState<string | null>(null);
  const [awsGateBusy, setAwsGateBusy] = useState(false);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 250); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (active !== 'mrefresh') return;
    const value = prefs.dataCadence?.[cadenceTarget] ?? (cadenceTarget === 'market' ? prefs.refreshSec : cadenceTarget === 'news' ? 5 : 10);
    setRefreshCustom(String(value));
  }, [active, cadenceTarget, prefs.dataCadence, prefs.refreshSec]);
  useEffect(() => {
    if (active !== 'currency') return;
    let alive = true;
    setCurrencyBusy(true);
    fetch('/api/fx')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { rates?: Record<string, number>; fetchedAt?: number } | null) => {
        if (!alive) return;
        if (d?.rates) setCurrencyFx({ ok: true, rates: d.rates, fetchedAt: d.fetchedAt ?? null });
        else setCurrencyFx((x) => ({ ...x, ok: false }));
      })
      .catch(() => { if (alive) setCurrencyFx((x) => ({ ...x, ok: false })); })
      .finally(() => { if (alive) setCurrencyBusy(false); });
    return () => { alive = false; };
  }, [active]);
  useEffect(() => {
    if (active !== 'shell') return;
    let alive = true;
    setAwsStatusError(null);
    fetchAwsRunnerStatus(true)
      .then((next) => { if (alive) setAwsStatus(next); })
      .catch((error) => { if (alive) setAwsStatusError(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; };
  }, [active]);
  useEffect(() => { let al = true; const load = () => fetch('/api/system').then((r) => (r.ok ? r.json() : null)).then((s) => al && s && setSys(s as SystemLite)).catch(() => undefined); void load(); const t = setInterval(load, 5000); return () => { al = false; clearInterval(t); }; }, []);
  useEffect(() => {
    if (notifDetailOpen) setNotifDraftAlerts(prefs.alerts);
  }, [notifDetailOpen, prefs.alerts]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      const since = notifLiveCursor.current > 0
        ? notifLiveCursor.current + 1
        : Date.now() - 24 * 60 * 60_000;
      fetch(`/api/events?since=${since}&limit=20000`)
        .then((response) => response.ok ? response.json() as Promise<LedgerEvent[]> : [])
        .then((items) => {
          if (!alive || !Array.isArray(items) || items.length === 0) return;
          const latestTs = Math.max(...items.map((item) => item.ts));
          notifLiveCursor.current = Math.max(notifLiveCursor.current, latestTs);
          setNotifLiveEvents((current) => {
            const merged = new Map<number, LedgerEvent>();
            for (const item of current) merged.set(item.id, item);
            for (const item of items) merged.set(item.id, item);
            return [...merged.values()].sort((a, b) => b.ts - a.ts || b.id - a.id).slice(0, 20000);
          });
        })
        .catch(() => undefined);
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!notifDetailOpen) return;
    const controller = new AbortController();
    const since = Date.now() - 7 * 24 * 60 * 60_000;
    setNotifArchiveBusy(true);
    setNotifArchiveError(null);
    fetch(`/api/events?since=${since}&limit=20000`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Archive request failed (${response.status})`);
        return response.json() as Promise<LedgerEvent[]>;
      })
      .then((items) => setNotifArchive(Array.isArray(items) ? items : []))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setNotifArchiveError(error instanceof Error ? error.message : 'Notification archive unavailable');
      })
      .finally(() => {
        if (!controller.signal.aborted) setNotifArchiveBusy(false);
      });
    return () => controller.abort();
  }, [notifDetailOpen]);
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
    void p('/api/news-context', 'news'); void p('/api/calendar', 'cal'); void p('/api/fx', 'fx');
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
    const viewportInset = 24;
    const minLeft = (viewportInset - rr.left) / zoom;
    const maxLeft = (window.innerWidth - viewportInset - rr.left) / zoom - w;
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
    const start = geoRef.current; const t0 = performance.now(); const dur = 200;
    const ease = (t: number) => 1 - Math.pow(1 - t, 4); // fast settle, zero bounce
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
    if (currentCloser && currentCloser !== closeShared) currentCloser();
    const previous = activeRef.current;
    const previousContent = contentActiveRef.current ?? previous;
    const wasClosed = previous === null;
    const alreadyOpen = previous === k;
    currentCloser = closeShared;
    const g = computeGeo(k);
    if (g) animateTo(g, wasClosed);
    if (alreadyOpen) return;
    window.clearTimeout(morphT.current);
    if (!wasClosed && previousContent) {
      const direction = TOPBAR_KEYS.indexOf(k) >= TOPBAR_KEYS.indexOf(previous) ? 1 : -1;
      setContentDirection(direction);
      setOutgoingContent(previousContent);
      morphT.current = window.setTimeout(() => setOutgoingContent(null), 210);
    } else {
      setOutgoingContent(null);
    }
    activeRef.current = k;
    contentActiveRef.current = k;
    setContentActive(k);
    setActive(k);
  };
  const closeMenu = useCallback(() => {
    window.clearTimeout(closeT.current);
    if (currentCloser === closeShared) currentCloser = null;
    closeShared();
  }, [closeShared]);
  const toggleAwsGate = useCallback(async (key: 'connectionEnabled' | 'executionEnabled') => {
    if (!awsStatus || awsGateBusy) return;
    setAwsGateBusy(true);
    setAwsStatusError(null);
    try {
      await updateAwsRunnerGates({ [key]: !awsStatus[key] });
      const next = await fetchAwsRunnerStatus(key === 'connectionEnabled' && !awsStatus.connectionEnabled);
      setAwsStatus(next);
    } catch (error) {
      setAwsStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setAwsGateBusy(false);
    }
  }, [awsGateBusy, awsStatus]);
  const scheduleClose = useCallback(() => {
    window.clearTimeout(closeT.current);
    closeT.current = window.setTimeout(() => {
      if (currentCloser === closeShared) currentCloser = null;
      closeShared();
    }, 320);
  }, [closeShared]);
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    window.clearTimeout(closeT.current);
    window.clearTimeout(morphT.current);
  }, []);
  const cancelClose = useCallback(() => window.clearTimeout(closeT.current), []);
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rowRef.current && !rowRef.current.contains(event.target as Node)) closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [active, closeMenu]);

  const b = state?.binance; const cfg = state?.config;
  const accountProfile = cfg?.profile ?? { name: '', avatar: null };
  const accountAvatar = accountProfile.avatar ?? DEFAULT_PROFILE_LOGO;
  const accountConnected = !!b?.keysPresent;
  const accountTone = accountConnected ? (b?.connected ? 'live' : 'warn') : 'off';
  const accountSub = accountConnected ? (b?.connected ? 'Binance connected' : 'Binance needs review') : 'Binance not linked';
  const roKey = apiKeys.find((k) => k.id === 'read-only') ?? apiKeys[0] ?? null;
  const fullKey = apiKeys.find((k) => k.id === 'secrets-full') ?? apiKeys[1] ?? null;
  const feeds = state?.feeds ?? {}; const feedList = Object.entries(feeds);
  const feedsOk = feedList.length > 0 && feedList.every(([, s]) => s === 'open');
  const lat = sys?.restLatencyMs ?? null;
  const netGrade = !connected ? 'bad' : !feedsOk || (lat !== null && lat > 900) ? 'warn' : 'ok';
  const latTone = lat === null ? '' : lat < 400 ? 'ok' : lat < 900 ? 'warn' : 'bad';
  const events = state?.events ?? [];
  const zone = ZONES.find((z) => z.id === prefs.clockZone) ?? ZONES[0];
  const activeClock = clockParts(zone.id, now);
  const activeClockOffset = clockOffset(zone.id, now);
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
  const currencyRateText = (code: string) => {
    if (code === 'USD') return '1.0000';
    const r = currencyFx.rates[code];
    if (!r) return currencyFx.ok === false ? 'OFF' : 'FX';
    return r.toLocaleString('en-US', { maximumFractionDigits: r >= 100 ? 2 : 4 });
  };
  const formatCurrencyPanelValue = (code: string, amount: number) => {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        maximumFractionDigits: code === 'JPY' ? 0 : amount >= 1000 ? 2 : 4,
      }).format(amount);
    } catch {
      const c = CURRENCIES[code] ?? CURRENCIES.USD;
      return `${c.symbol}${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }
  };
  const curLiveRate = cur === 'USD' ? 1 : curRate;
  const convertedCurrencyNotional = curLiveRate ? currencyNotional * curLiveRate : null;
  const currencyBasePreview = formatCurrencyPanelValue('USD', currencyNotional);
  const currencyConvertedPreview = convertedCurrencyNotional !== null
    ? formatCurrencyPanelValue(cur, convertedCurrencyNotional)
    : curTone === 'bad'
      ? 'Unavailable'
      : 'Loading';
  const refreshCurrencyFx = () => {
    if (currencyBusy) return;
    setCurrencyBusy(true);
    fetch('/api/fx')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { rates?: Record<string, number>; fetchedAt?: number } | null) => {
        if (d?.rates) setCurrencyFx({ ok: true, rates: d.rates, fetchedAt: d.fetchedAt ?? null });
        else setCurrencyFx((x) => ({ ...x, ok: false }));
      })
      .catch(() => setCurrencyFx((x) => ({ ...x, ok: false })))
      .finally(() => setCurrencyBusy(false));
  };
  const basisIsBps = prefs.basisUnit === 'bps';
  const basisMark = basisIsBps ? 'bp' : '%';
  const formatBasisPct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(Math.abs(value) < 0.1 ? 3 : 2)}%`;
  const formatBasisBp = (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(Math.abs(value * 100) < 10 ? 1 : 0)}bp`;
  const basisSamples = [
    { label: '1bp', value: 0.01 },
    { label: '4.2bp', value: 0.042 },
    { label: '10bp', value: 0.1 },
    { label: '-57bp', value: -0.57 },
  ];
  const basisPreview = basisIsBps ? formatBasisBp(basisSamplePct).replace('bp', ' bps') : formatBasisPct(basisSamplePct);
  const basisCode = basisIsBps ? 'BPS' : 'PCT';
  const activeAccent = ACCENTS[prefs.accent] ?? ACCENTS.b;
  const appearanceZoom = Math.round((prefs.zoom || 1) * 100);
  const al = prefs.alerts; const alertsOn = Object.values(al).filter(Boolean).length;
  const compactSource = notifLiveEvents.length ? notifLiveEvents : events;
  const compactNotifications = groupNotifications(curateNotifications(compactSource).filter((item) => notificationEnabled(item, al)));
  const unread = compactNotifications.filter((item) => item.id > seen).length;
  const mode = state?.mode ?? 'HALTED';
  const modeClass = mode === 'HALTED' ? 'm-halted' : mode === 'LIVE_ARMED' ? 'm-live' : 'm-manual';
  const killOn = !!cfg?.killSwitch;
  const fundsAllowed = !(cfg?.fundsLocked ?? true);
  const botRunning = !(cfg?.automationPaused ?? true);
  const liveOrdersAllowed = !!cfg?.liveTradingEnabled;
  const borrowGuard = cfg?.borrowGuard;
  const newLoansAllowed = !!borrowGuard?.enabled && !borrowGuard.newBorrowPaused && !borrowGuard.repayOnly;
  const allowCount = cfg?.allowedSymbols?.length ?? 0;
  const liveBlocker = killOn
    ? 'Emergency stop is active'
    : !b?.keysPresent
      ? 'Binance key is missing'
      : !b?.connected
        ? 'Binance account is not synchronized'
        : b?.canWithdraw
          ? 'Withdrawals must be disabled on the key'
          : allowCount === 0
            ? 'Symbol allowlist is empty'
            : !fundsAllowed
              ? 'Funds access is locked'
              : !botRunning
                ? 'Automation is paused'
                : null;
  const modeTone = killOn ? 'bad' : liveBlocker ? 'warn' : liveOrdersAllowed ? 'ok' : 'warn';
  const modeLabel = killOn ? 'Stopped' : liveBlocker ? 'Limited' : liveOrdersAllowed ? 'Armed' : 'Ready';
  const modeSub = killOn ? 'Every bot action is blocked.' : liveBlocker ?? (liveOrdersAllowed ? 'Live sends remain behind the risk gate.' : 'Prerequisites pass; live sends remain off.');
  const modeNet = b?.connected ? 'Synced' : 'Offline';
  const liveTitle = liveBlocker ?? 'Allow live order sends after the risk gate';
  const setFundsAccess = (on: boolean) => { void saveConfig({ fundsLocked: !on }); };
  const setBotRunning = (on: boolean) => { void saveConfig({ automationPaused: !on }); };
  const setNewLoans = (on: boolean) => {
    const cur = cfg?.borrowGuard;
    if (!cur) return;
    void saveConfig({ borrowGuard: { ...cur, enabled: true, newBorrowPaused: !on, repayOnly: !on } });
  };
  const markNotificationsRead = () => {
    if (!compactNotifications.length) return;
    const latest = Math.max(...compactNotifications.map((item) => item.id));
    setSeen(latest);
    localStorage.setItem('cosmos-notif-seen', String(latest));
  };
  const openNotificationCenter = () => {
    setNotifDraftAlerts(prefs.alerts);
    setNotifTab('all');
    setNotifDay(new Intl.DateTimeFormat('en-CA', {
      timeZone: prefs.clockZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()));
    setActive(null);
    setNotifDetailOpen(true);
  };
  const alertRows: { key: NotificationRuleKey; label: string; sub: string }[] = [
    { key: 'critical', label: 'Critical & Security', sub: 'Failures, blocked actions, and emergency controls' },
    { key: 'account', label: 'Account & Execution', sub: 'Orders, fills, loans, and Binance state' },
    { key: 'bot', label: 'Bot Health', sub: 'Engine, runner, stream, and control changes' },
    { key: 'opportunities', label: 'Opportunities', sub: 'Opened basis and strategy signals only' },
    { key: 'news', label: 'Announcements', sub: 'Exchange maintenance, listings, and API notices' },
  ];
  const alertShort: Record<NotificationRuleKey, string> = {
    critical: 'Critical',
    account: 'Account',
    bot: 'Bot',
    opportunities: 'Opportunities',
    news: 'News',
  };
  const draftAlertsOn = Object.values(notifDraftAlerts).filter(Boolean).length;
  const cancelNotificationPrefs = () => {
    setNotifDraftAlerts(al);
  };
  const saveNotificationPrefs = () => {
    updatePref('alerts', notifDraftAlerts);
  };
  const notifTimeZone = prefs.clockZone || 'UTC';
  const notifDayKey = (ts: number) => new Intl.DateTimeFormat('en-CA', {
    timeZone: notifTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
  const notifStamp = (ts: number) => new Intl.DateTimeFormat('en-US', {
    timeZone: notifTimeZone,
    month: 'short',
    day: 'numeric',
  }).format(new Date(ts)).toUpperCase();
  const notifClock = (ts: number) => new Intl.DateTimeFormat('en-GB', {
    timeZone: notifTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ts));
  const notifTabs: { id: typeof notifTab; label: string; code: string }[] = [
    { id: 'all', label: 'All Alerts', code: 'All' },
    { id: 'critical', label: 'Critical', code: 'Critical' },
    { id: 'account', label: 'Account', code: 'Account' },
    { id: 'bot', label: 'Bot', code: 'Bot' },
    { id: 'opportunities', label: 'Opportunities', code: 'Opps' },
    { id: 'news', label: 'News', code: 'News' },
  ];
  const notifMeta = (kind: string, data: Record<string, unknown> | null = null) => {
    const k = kind.toLowerCase();
    const outcome = String(data?.kind ?? '').toLowerCase();
    const rejected = outcome === 'reject' || Boolean(data?.rejectCode);
    if (rejected || k.includes('risk') || k.includes('error') || k.includes('reject') || k.includes('kill') || k.includes('block') || k.includes('fail')) {
      return { bucket: 'critical' as const, scope: 'Critical Alert', title: 'Control Room Alert', tone: 'critical', mark: '!' };
    }
    if (k.includes('candidate_opened') || k.includes('strategy') || k.includes('proposal') || k.includes('signal') || k.includes('opportunity') || k.includes('basis') || k.includes('funding')) {
      return { bucket: 'opportunities' as const, scope: 'Opportunity', title: 'Strategy Signal', tone: 'opportunity', mark: 'O' };
    }
    if (k.includes('order') || k.includes('fill') || k.includes('loan') || k.includes('account') || k.includes('binance') || k.includes('user_stream')) {
      return { bucket: 'account' as const, scope: 'Account Activity', title: 'Account Update', tone: 'account', mark: 'A' };
    }
    return { bucket: 'bot' as const, scope: 'Bot Health', title: 'Operations Event', tone: 'logs', mark: 'L' };
  };
  const notifIcon = (tone: string, size = 17) => {
    if (tone === 'critical') return <LucideNotifCritical size={size} strokeWidth={1.8} />;
    if (tone === 'opportunity' || tone === 'opportunities') return <LucideNotifOpportunity size={size} strokeWidth={1.8} />;
    if (tone === 'account') return <LucideNotifAccount size={size} strokeWidth={1.8} />;
    if (tone === 'news') return <IconNewspaper size={size} />;
    return <LucideNotifLog size={size} strokeWidth={1.8} />;
  };
  const filterNotifEvents = (tab: NotifTab) => events.filter((e) => {
    if (tab === 'all') return true;
    if (tab === 'prefs') return false;
    return notifMeta(e.kind, (e.data as Record<string, unknown> | null) ?? null).bucket === tab;
  });
  const filteredNotifEvents = filterNotifEvents(notifTab);
  const compactNotifEvents = events;
  const compactNotifGroups = compactNotifications.slice(0, 7);
  const archiveSource = notifArchive.length ? notifArchive : events;
  const allArchiveNotifications = groupNotifications(curateNotifications(archiveSource));
  const enabledArchiveNotifications = allArchiveNotifications.filter((item) => notificationEnabled(item, notifDraftAlerts));
  const filteredNotifications = enabledArchiveNotifications.filter((item) => (
    (notifTab === 'all' || notifTab === 'prefs' || item.category === notifTab)
    && (notifDay === 'all' || notifDayKey(item.ts) === notifDay)
  ));
  const notifBucketCounts = allArchiveNotifications.reduce<Record<NotificationRuleKey, number>>((acc, item) => {
    acc[item.category] += item.count;
    return acc;
  }, { critical: 0, account: 0, bot: 0, opportunities: 0, news: 0 });
  const notifDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getTime() - index * 24 * 60 * 60_000);
    const key = notifDayKey(date.getTime());
    const items = enabledArchiveNotifications.filter((item) => notifDayKey(item.ts) === key);
    return {
      key,
      day: new Intl.DateTimeFormat('en-US', { timeZone: notifTimeZone, weekday: 'short' }).format(date),
      date: new Intl.DateTimeFormat('en-US', { timeZone: notifTimeZone, month: 'short', day: 'numeric' }).format(date),
      total: items.reduce((sum, item) => sum + item.count, 0),
      critical: items.filter((item) => item.severity === 'critical').reduce((sum, item) => sum + item.count, 0),
    };
  }).reverse();
  const notifPrefsDirty = JSON.stringify(notifDraftAlerts) !== JSON.stringify(al);
  const notifTone = notifBucketCounts.critical > 0 ? 'hot' : unread > 0 ? 'live' : compactNotifications.length > 0 ? 'armed' : alertsOn > 0 ? 'armed' : 'idle';
  const cadenceKeys: DataCadenceKey[] = ['market', 'account', 'news', 'calendar', 'fx', 'health', 'token'];
  const cadenceChoices = [
    { sec: 0.5, label: '<1s' },
    { sec: 1, label: '1s' },
    { sec: 3, label: '3s' },
    { sec: 5, label: '5s' },
    { sec: 10, label: '10s' },
  ];
  const clampRefresh = (sec: number) => Math.min(300, Math.max(0.5, Math.round(sec * 10) / 10));
  const cadenceSec = (key: DataCadenceKey) => prefs.dataCadence?.[key]
    ?? (key === 'market' ? prefs.refreshSec : key === 'news' ? 5 : 10);
  const fmtCadence = (sec: number) => sec >= 60
    ? `${Number.isInteger(sec / 60) ? (sec / 60).toFixed(0) : (sec / 60).toFixed(1)}m`
    : sec < 1
      ? '<1s'
      : `${sec % 1 === 0 ? sec.toFixed(0) : sec.toFixed(1)}s`;
  const setSourceCadence = (key: DataCadenceKey, sec: number) => {
    const next = clampRefresh(sec);
    const map = { ...(prefs.dataCadence ?? {}), [key]: next } as Record<DataCadenceKey, number>;
    updatePref('dataCadence', map);
    if (key === 'market') updatePref('refreshSec', next);
    setRefreshCustom(String(next));
  };
  const applyCadence = (sec: number, key: DataCadenceKey = cadenceTarget) => {
    setCadenceTarget(key);
    setSourceCadence(key, sec);
  };
  const applyCustomRefresh = () => {
    const parsed = Number(refreshCustom);
    if (!Number.isFinite(parsed)) {
      setRefreshCustom(String(cadenceSec(cadenceTarget)));
      return;
    }
    applyCadence(parsed, cadenceTarget);
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
  const marketCadence = cadenceSec('market');
  const minCadence = Math.min(...cadenceKeys.map((key) => cadenceSec(key)));
  const maxCadence = Math.max(...cadenceKeys.map((key) => cadenceSec(key)));
  const cadenceSpread = minCadence === maxCadence ? fmtCadence(minCadence) : `${fmtCadence(minCadence)}-${fmtCadence(maxCadence)}`;
  const selectedCadence = cadenceSec(cadenceTarget);
  const cadenceLabelFor = (key: DataCadenceKey) => ({
    market: 'Market Price',
    account: 'Account Data',
    news: 'News Context',
    calendar: 'Calendar',
    fx: 'FX Rates',
    health: 'Health & Logs',
    token: 'Token Streams',
  } satisfies Record<DataCadenceKey, string>)[key];
  const selectedCadenceLabel = cadenceLabelFor(cadenceTarget);
  const refreshCode = fmtCadence(marketCadence);
  const refreshStamp = menuRefreshState === 'spin' ? 'POLL' : menuRefreshState === 'ok' ? 'SYNC' : menuRefreshState === 'err' ? 'ERR' : refreshLabel.toUpperCase();
  const refreshNetCode = menuRefreshState === 'spin' ? 'RUN' : menuRefreshState === 'ok' ? 'SYNC' : menuRefreshState === 'err' ? 'ERR' : refreshTone === 'ok' ? 'LIVE' : refreshTone === 'warn' ? 'WARN' : 'OFF';
  const refreshActionText = menuRefreshState === 'spin' ? 'Run' : menuRefreshState === 'ok' ? 'OK' : menuRefreshState === 'err' ? 'Retry' : 'Now';
  const refreshDetail = !connected
    ? 'Socket reconnecting'
    : !feedsOk
      ? 'Market feed degraded'
      : `${refreshFeedCount} streams / ${msLabel(lat)} / ${cadenceSpread}`;
  const cadenceRows: { key: DataCadenceKey; label: string; sub: string; value: string; tone: 'ok' | 'warn' | 'bad' | 'idle'; icon: ReactNode }[] = [
    { key: 'market', label: 'Market Price', sub: 'Markets table, quotes, basis rows', value: fmtCadence(cadenceSec('market')), tone: connected && feedsOk ? 'ok' : connected ? 'warn' : 'bad', icon: <IconChart size={14} /> },
    { key: 'account', label: 'Account Data', sub: 'Balances, loans, fills, PnL', value: fmtCadence(cadenceSec('account')), tone: b?.connected ? 'ok' : 'warn', icon: <IconWallet size={14} /> },
    { key: 'news', label: 'News Context', sub: 'Aggregated server feed', value: fmtCadence(cadenceSec('news')), tone: srv.news === null ? 'idle' : srv.news ? 'ok' : 'bad', icon: <IconNewspaper size={14} /> },
    { key: 'calendar', label: 'Calendar', sub: 'Macro-event endpoint', value: fmtCadence(cadenceSec('calendar')), tone: srv.cal === null ? 'idle' : srv.cal ? 'ok' : 'bad', icon: <IconCalendar size={14} /> },
    { key: 'fx', label: 'FX Rates', sub: 'Cached display-rate endpoint', value: fmtCadence(cadenceSec('fx')), tone: srv.fx === null ? 'idle' : srv.fx ? 'ok' : 'bad', icon: <IconDollar size={14} /> },
    { key: 'health', label: 'Health & Logs', sub: 'System probes and event polling', value: fmtCadence(cadenceSec('health')), tone: netGrade === 'ok' ? 'ok' : netGrade === 'warn' ? 'warn' : 'bad', icon: <IconPulse size={14} /> },
    { key: 'token', label: 'Token Streams', sub: 'Detail candles and order-book panels', value: fmtCadence(cadenceSec('token')), tone: connected ? 'ok' : 'bad', icon: <IconLayers size={14} /> },
  ];
  const marketPingRows = cadenceRows.filter((row) => MARKET_PING_KEYS.includes(row.key as (typeof MARKET_PING_KEYS)[number]));
  type DataTier = 'good' | 'warn' | 'bad' | 'idle';
  const probeTier = (ok: boolean | null): DataTier => ok === null ? 'idle' : ok ? 'good' : 'bad';
  const probeDetail = (ok: boolean | null) => ok === null ? 'Checking' : ok ? 'Reachable' : 'Down';
  const driftAbs = sys?.serverTimeDiffMs == null ? null : Math.abs(sys.serverTimeDiffMs);
  const driftTier: DataTier = driftAbs == null ? 'idle' : driftAbs < 500 ? 'good' : driftAbs < 1500 ? 'warn' : 'bad';
  const latTier: DataTier = lat === null ? 'idle' : lat < 400 ? 'good' : lat < 900 ? 'warn' : 'bad';
  const userStream = String(b?.userStream ?? 'off');
  const userStreamTier: DataTier = ['live', 'open', 'connected'].includes(userStream.toLowerCase())
    ? 'good'
    : userStream.toLowerCase() === 'failed'
      ? 'bad'
      : userStream.toLowerCase() === 'off'
        ? 'idle'
        : 'warn';
  const accountAgo = b?.lastSyncTs ? timeAgo(b.lastSyncTs) : 'No sync';
  const scannerAgo = sys?.lastScannerTickTs ?? state?.scanner.lastTickTs;
  const rateTier: DataTier = sys?.usedWeight1m == null ? 'idle' : sys.usedWeight1m < 800 ? 'good' : sys.usedWeight1m < 1050 ? 'warn' : 'bad';
  const engineTier: DataTier = sys?.dbOk === false ? 'bad' : state?.scanner.pairs ? 'good' : 'idle';
  const engineBudgetTier: DataTier = engineTier === 'bad' || rateTier === 'bad' ? 'bad' : engineTier === 'idle' || rateTier === 'idle' ? 'idle' : rateTier === 'warn' ? 'warn' : 'good';
  const streamNames = feedList
    .map(([name]) => name.replace('spot-', 'spot ').replace('futures-', 'futures ').replace(/-/g, ' '))
    .join(' · ');
  const dataRows: { name: string; sub: string; value: string; tier: DataTier }[] = [
    { name: 'Browser -> Server', sub: 'Dashboard state socket', value: connected ? 'live' : 'offline', tier: connected ? 'good' : 'bad' },
    { name: 'Market Streams', sub: streamNames || 'Spot, mark price, liquidations', value: feedList.length ? `${feedList.length} open` : 'idle', tier: connected && feedsOk ? 'good' : connected ? 'warn' : 'bad' },
    { name: 'Account Snapshot', sub: b?.keyFingerprint ? `Read key ${b.keyFingerprint}` : 'Read key missing', value: b?.connected ? accountAgo : 'failed', tier: b?.connected ? 'good' : b?.keysPresent ? 'bad' : 'idle' },
    { name: 'User Stream', sub: 'Account event socket', value: userStream, tier: userStreamTier },
    { name: 'News Context', sub: 'Aggregated server endpoint', value: probeDetail(srv.news), tier: probeTier(srv.news) },
    { name: 'Calendar', sub: 'Macro-event endpoint', value: probeDetail(srv.cal), tier: probeTier(srv.cal) },
    { name: 'FX Rates', sub: 'Cached display-rate endpoint', value: probeDetail(srv.fx), tier: probeTier(srv.fx) },
    { name: 'Timing / REST', sub: `Clock drift ${msLabel(sys?.serverTimeDiffMs)}`, value: msLabel(lat), tier: latTier === 'good' ? driftTier : latTier },
    { name: 'Engine / Budget', sub: `Scanner ${timeAgo(scannerAgo)} · ledger ${sys?.dbOk === false ? 'blocked' : 'writable'}`, value: state?.scanner.pairs ? `${state.scanner.pairs} pairs · ${sys?.usedWeight1m ?? '—'} weight` : 'idle', tier: engineBudgetTier },
  ];
  const dataGood = dataRows.filter((r) => r.tier === 'good').length;
  const dataWarn = dataRows.filter((r) => r.tier === 'warn').length;
  const dataBad = dataRows.filter((r) => r.tier === 'bad').length;
  const dataGrade = !connected || dataBad > 1 ? 'bad' : dataBad || dataWarn ? 'warn' : 'ok';
  const dataLabel = dataGrade === 'ok' ? 'Good' : dataGrade === 'bad' ? 'Down' : 'Watch';
  const dataSub = `${dataGood}/${dataRows.length} sources passing`;
  const advRaw: ({ sev: Sev; name: string; detail: string; page?: Page } | null)[] = [
    b?.canWithdraw ? { sev: 'action', name: 'Withdrawals enabled on key', detail: 'Rotate to a read-only key.', page: 'account' } : { sev: 'pass', name: 'Withdrawals disabled', detail: 'Key cannot move funds.' },
    b?.keysPresent && !b?.connected ? { sev: 'action', name: 'Account sync failing', detail: b?.lastError ?? 'Not syncing.', page: 'system' } : null,
    !connected ? { sev: 'invest', name: 'Cockpit socket offline', detail: 'Reconnecting.', page: 'system' } : null,
    !feedsOk ? { sev: 'invest', name: 'Market feed degraded', detail: 'A stream is not open.', page: 'system' } : { sev: 'pass', name: 'Market feeds live', detail: `${Object.keys(feeds).length} open.` },
    !b?.keysPresent ? { sev: 'invest', name: 'No read key set', detail: 'Account data hidden.', page: 'account' } : { sev: 'pass', name: 'Read key set', detail: 'Account data available.' },
    (cfg?.allowedSymbols?.length ?? 0) === 0 ? { sev: 'invest', name: 'Allowlist empty', detail: 'Safe default.', page: 'risk' } : { sev: 'pass', name: `Allowlist: ${cfg?.allowedSymbols.length}`, detail: 'Listed symbols only.' },
    cfg?.killSwitch
      ? { sev: 'pass', name: 'Kill switch ON', detail: 'Order, loan, and bot actions are blocked.' }
      : { sev: 'invest', name: 'Kill switch off', detail: 'Execution continues through configured risk gates.', page: 'risk' },
    typeof window !== 'undefined' && window.location.hostname === DEPLOYED_APP_HOST
      ? sys?.cfUser
        ? { sev: 'pass', name: 'Cloudflare Access verified', detail: sys.cfUser }
        : { sev: 'action', name: 'Edge identity missing', detail: 'No Cloudflare Access identity header was received.', page: 'risk' }
      : null,
  ];
  const advChecks = advRaw.filter(Boolean) as { sev: Sev; name: string; detail: string; page?: Page }[];
  const advA = advChecks.filter((c) => c.sev === 'action'); const advI = advChecks.filter((c) => c.sev === 'invest'); const advP = advChecks.filter((c) => c.sev === 'pass');
  const advAtt = [...advA, ...advI];
  const advTone = advA.length ? 'bad' : advI.length ? 'warn' : 'ok';
  const advScore = advChecks.length ? Math.round((advP.length / advChecks.length) * 100) : 100;
  const advCode = advTone === 'bad' ? 'ACT' : advTone === 'warn' ? 'REV' : 'OK';
  const openAdvisorDetail = (checks: typeof advChecks, fallback: Page) => {
    const target = checks.find((c) => c.page)?.page ?? fallback;
    setActive(null);
    setPage(target);
  };
  const advisorGroups = [
    {
      key: 'action',
      label: 'Action Recommended',
      sub: 'Fix before automated live control.',
      tone: 'bad',
      items: advA,
      fallback: 'risk' as Page,
    },
    {
      key: 'investigate',
      label: 'Investigation Recommended',
      sub: 'Review settings, feeds, and guardrails.',
      tone: 'warn',
      items: advI,
      fallback: 'system' as Page,
    },
    {
      key: 'clear',
      label: 'No Problems Detected',
      sub: 'Controls currently pass advisor checks.',
      tone: 'ok',
      items: advP,
      fallback: 'risk' as Page,
    },
  ] as const;
  const advisorFocus = advAtt.length ? advAtt.slice(0, 2) : advP.slice(0, 2);

  // Reposition only when the ACTIVE menu changes, when a trigger's width could
  // change (badges toggling, currency symbol, zone label), on zoom, or on window
  // resize — NOT every clock tick. (The clock uses tabular figures so ticking
  // seconds keep a constant width; otherwise every tick would shift the triggers
  // and restart the slide transition, leaving the box perpetually mid-flight.)
  const placeSig = `${alertsOn > 0}|${unread > 0}|${advA.length > 0}|${zone.label}|${prefs.zoom}`;
  const menuOpen = active !== null;
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const place = () => {
      const current = activeRef.current;
      if (!current) return;
      const g = computeGeo(current);
      if (g) setGeo(g);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, placeSig]);
  useLayoutEffect(() => {
    const pane = incomingPaneRef.current;
    if (!pane || !contentActive) return;
    pane.scrollTo({ top: 0, left: 0 });
  }, [contentActive]);

  const trig = (k: MK, cls: string, inner: JSX.Element, opts: { title?: string; onClick?: () => void } = {}) => (
    <button
      ref={(el) => { btnRefs.current[k] = el; }}
      data-topbar-key={k}
      className={`${cls} ${active === k ? 'on' : ''}`}
      onPointerEnter={() => openK(k)}
      onFocus={() => openK(k)}
      onClick={() => {
        if (opts.onClick) {
          closeMenu();
          opts.onClick();
          return;
        }
        if (active !== k) openK(k);
      }}
      title={opts.title ?? k}
      aria-label={opts.title ?? k}
    >
      {inner}
    </button>
  );

  const keysBody = () => {
    const visibleKeys = [roKey, fullKey].filter(Boolean) as ApiKeyInfo[];
    return <BinanceApiKeySheet keys={visibleKeys} />;
  };

  const content = (k: MK) => {
    switch (k) {
      case 'clock':
        return (
          <div className="clock-pop clock-select-pop clock-premium-pop">
            <div className="clock-premium-hero">
              <div className="clock-premium-eyebrow">
                <span>Desk time</span>
                <em>{zone.label} · {activeClockOffset}</em>
              </div>
              <div className="clock-premium-hero-time" aria-hidden="true">
                <strong>{activeClock.hm}</strong>
                <span>:{activeClock.ss}</span>
              </div>
              <div className="clock-premium-meta">
                <b>{zone.city}</b>
                <i />
                <span>{clockDate(zone.id, now)}</span>
              </div>
            </div>
            <div className="clock-premium-columns" aria-hidden="true">
              <span>World desks</span>
              <span>Live time</span>
            </div>
            <div className="clock-zone-list">
              {ZONES.map((zz) => {
                const p = clockParts(zz.id, now);
                const selected = zz.id === zone.id;
                return (
                  <button
                    key={zz.id}
                    type="button"
                    className={`clock-zone-row ${selected ? 'on' : ''}`}
                    aria-pressed={selected}
                    onClick={() => { updatePref('clockZone', zz.id); }}
                  >
                    <span className="clock-zone-mark">{zz.label}</span>
                    <span className="clock-zone-copy">
                      <b>{zz.city}</b>
                      <small>{zz.detail}</small>
                    </span>
                    <span className="clock-zone-time">
                      <span className="clock-zone-digits"><b>{p.hm}</b><small>:{p.ss}</small></span>
                      <em>{clockOffset(zz.id, now)}</em>
                    </span>
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
            <TopPanelHeader
              className="shell-head"
              logo={<img className="shell-cloud-mark" src={AWS_RUNNER_MARK} alt="" />}
              title="AWS Runner Control"
              sub="Restricted Systems Manager channel"
              status={awsStatus?.connectionEnabled ? 'Open' : 'Blocked'}
            />
            <div className="shell-status-list" aria-label="AWS CloudShell session details">
              <div><span>Target</span><b>{awsStatus?.instanceId ?? 'Not configured'}</b></div>
              <div><span>Transport</span><b>SSM</b></div>
              <div><span>Region</span><b>{awsStatus?.region ?? 'Not configured'}</b></div>
            </div>
            <div className="shell-actions">
              <button className="shell-open primary" type="button" onClick={() => { setActive(null); openOverlay('cloudshell'); }} title="Open runner workspace" aria-label="Open runner workspace">
                <IconTerminal size={15} />
                <span>Open Workspace</span>
              </button>
              <a className="shell-open icon-only" href={AWS_CONSOLE_URL} target="_blank" rel="noreferrer noopener" onClick={() => setActive(null)} title="Open AWS Console" aria-label="Open AWS Console">
                <IconExternal size={14} />
              </a>
            </div>
          </div>
        );
      case 'apikey': return keysBody();
      case 'data':
        return (
          <div className={`datax-pop datax-slim data-health-card ${dataGrade}`}>
            <TopPanelHeader
              className={`datax-hero ${dataGrade}`}
              logo={<IconDatabase size={21} />}
              title="Data Health"
              sub={`Binance · ${dataSub}`}
            />
            <div className="datax-section-head">
              <span><IconWifi size={15} />Sources</span>
              <b className="ok">{dataGood} Active</b>
            </div>
            <div className="datax-source-list" aria-label="Measured data sources">
              {dataRows.map((row) => (
                <div key={row.name} className={`datax-source-row ${row.tier}`} title={row.sub} aria-label={`${row.name}: ${row.value}. ${row.sub}`}>
                  <span className={`datax-source-dot ${row.tier}`} />
                  <span className="datax-source-copy">
                    <b>{row.name}</b>
                    <em>{row.sub}</em>
                  </span>
                  <span className="datax-source-value">
                    <em>{row.value}</em>
                  </span>
                </div>
              ))}
            </div>
            <div className="datax-foot">
              <button type="button" onClick={() => { setActive(null); setPage('system'); }} aria-label="Open Health page">
                <IconPulse size={15} />
                Open Health
              </button>
              <span>{sys?.usedWeightTs ? `Weight ${timeAgo(sys.usedWeightTs)}` : 'Live Probes'}</span>
            </div>
          </div>
        );
      case 'advisor':
        return (
          <div className={`advx-pop advisor-audit ${advTone}`}>
            <TopPanelHeader
              className="advx-audit-head"
              logo={<img className="trust-advisor-source-image" src={TRUST_ADVISOR_MARK} alt="" />}
              title="Trusted Advisor"
              sub={`Bot controls audit · ${advChecks.length} checks`}
              status={advTone === 'bad' ? 'Action' : advTone === 'warn' ? 'Review' : 'Clear'}
            />

            <div className="advx-status-stack" aria-label="Trusted Advisor status groups">
              {advisorGroups.map((g) => (
                <button key={g.key} className={`advx-status-row ${g.tone}`} type="button" onClick={() => openAdvisorDetail(g.items, g.fallback)}>
                  <span className="advx-status-icon">
                    {g.tone === 'bad' ? <IconCross size={15} /> : g.tone === 'warn' ? <IconAlarm size={15} /> : <IconCheck size={15} />}
                  </span>
                  <span className="advx-status-copy">
                    <b>{g.label}</b>
                    <em>{g.sub}</em>
                  </span>
                  <span className="advx-status-count">{g.items.length}</span>
                  <span className="advx-status-link">Details</span>
                </button>
              ))}
            </div>

            <div className="advx-focus-list" aria-label="Advisor focus checks">
              <div className="advx-focus-head">
                <b>{advAtt.length ? 'Focus Checks' : 'Passing Controls'}</b>
                <em>{advScore}%</em>
              </div>
              {advisorFocus.map((c) => (
                <button key={c.name} className={`advx-focus-row ${c.sev}`} type="button" disabled={!c.page} onClick={() => { if (c.page) { setActive(null); setPage(c.page); } }}>
                  <span className="advx-focus-copy">
                    <b>{c.name}</b>
                    <em>{c.detail}</em>
                  </span>
                  <span className={`advx-focus-pill ${c.sev === 'action' ? 'bad' : c.sev === 'invest' ? 'warn' : 'ok'}`}>
                    {c.sev === 'action' ? 'Fix' : c.sev === 'invest' ? 'Review' : 'OK'}
                  </span>
                </button>
              ))}
            </div>

            <div className="advx-footer-actions">
              <button type="button" onClick={() => { setActive(null); setPage('risk'); }}>
                <IconRadar size={14} /> Risk Controls
              </button>
              <button type="button" onClick={() => { setActive(null); setPage('system'); }}>
                <IconPulse size={14} /> Health
              </button>
            </div>
          </div>
        );
      case 'notif':
        return (
          <div className={`ntfx-pop ${notifTone}`}>
            <TopPanelHeader
              className="ntfx-head"
              logo={<NotificationCenterGlyph />}
              title="Notifications"
              sub={`${events.length} events · ${alertsOn} alerts`}
            />
            <div className="ntfx-section-head">
              <span><IconBell size={15} />Feed</span>
              <b className={unread ? 'hot' : events.length ? 'ok' : ''}>{unread ? `${unread} New` : events.length ? `${events.length} Total` : 'Clear'}</b>
            </div>

            <div className="ntfx-list">
              {compactNotifEvents.length === 0 ? (
                <div className="ntfx-empty">
                  <span className="ntfx-dot idle" />
                  <b>No notifications</b>
                  <em>Inbox clear</em>
                </div>
              ) : compactNotifEvents.slice(0, 3).map((e) => {
                const meta = notifMeta(e.kind, (e.data as Record<string, unknown> | null) ?? null);
                const summary = eventSummary(e.kind, (e.data as Record<string, unknown> | null) ?? null, e.symbol);
                const rightLabel = meta.bucket === 'opportunity' ? 'Signal' : meta.bucket === 'account' ? 'Account' : meta.bucket === 'critical' ? 'Critical' : 'System';
                return (
                  <button key={e.id} className={`ntfx-event ${meta.tone}`} type="button" title={summary} aria-label={summary} onClick={openNotificationCenter}>
                    <span className={`ntfx-row-icon ${meta.tone}`}>{notifIcon(meta.tone, 16)}</span>
                    <span className="ntfx-copy">
                      <strong>{meta.title}</strong>
                      <small>{summary}</small>
                    </span>
                    <span className="ntfx-row-right">
                      <i>{rightLabel}</i>
                      <b>{notifStamp(e.ts)}</b>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="ntfx-foot">
              <button className="ntfx-mark-read" type="button" onClick={markNotificationsRead} disabled={unread === 0} title="Mark notifications read" aria-label="Mark notifications read">
                Mark Read
              </button>
              <button className="ntfx-open-center" type="button" onClick={openNotificationCenter} title="Open notification center" aria-label="Open notification center">
                <IconMaximize size={15} />
                Open Center
              </button>
            </div>
          </div>
        );
      case 'power':
        return (
          <div className={`modex-pop ${modeTone}`}>
            <TopPanelHeader
              className="modex-head"
              logo={<CloudflareMark />}
              title="Bot Controls"
              sub={modeSub}
              status={modeLabel}
            />
            <div className="modex-rows" role="group" aria-label="Bot guardrail controls">
              <button className={`modex-row emergency ${killOn ? 'on' : ''}`} type="button" onClick={() => { void setKill(!killOn); }} aria-pressed={killOn}>
                <span><b>Emergency Stop</b><em>Stops orders, loans, and bot actions.</em></span>
                <i className="cb-switch" aria-hidden><span /></i>
              </button>
              <button className={`modex-row ${fundsAllowed ? 'on' : ''}`} type="button" onClick={() => setFundsAccess(!fundsAllowed)} aria-pressed={fundsAllowed}>
                <span><b>Funds Access</b><em>Allow the bot to use account funds.</em></span>
                <i className="cb-switch" aria-hidden><span /></i>
              </button>
              <button className={`modex-row ${newLoansAllowed ? 'on' : ''}`} type="button" onClick={() => setNewLoans(!newLoansAllowed)} aria-pressed={newLoansAllowed}>
                <span><b>New Loans</b><em>Allow margin or flexible borrow requests.</em></span>
                <i className="cb-switch" aria-hidden><span /></i>
              </button>
              <button className={`modex-row ${botRunning ? 'on' : ''}`} type="button" onClick={() => setBotRunning(!botRunning)} aria-pressed={botRunning}>
                <span><b>Bot Running</b><em>Allow strategy automation to act.</em></span>
                <i className="cb-switch" aria-hidden><span /></i>
              </button>
              <button className={`modex-row ${liveOrdersAllowed ? 'on' : ''}`} type="button" onClick={() => { void setLive(!liveOrdersAllowed); }} aria-pressed={liveOrdersAllowed} title={liveTitle}>
                <span><b>Live Orders</b><em>Allow live sends after the risk gate.</em></span>
                <i className="cb-switch" aria-hidden><span /></i>
              </button>
            </div>
          </div>
        );
      case 'mrefresh':
        return (
          <div className={`mrefx-pop cadence mrefx-slim ${refreshTone}`}>
            <TopPanelHeader
              className="mrefx-cadence-head"
              logo={<IconRefresh size={21} />}
              title="Market Ping"
              sub={refreshDetail}
              status={refreshLabel}
            />
            <div className="mrefx-source-list" aria-label="Data source cadences">
              {cadenceRows.map((row) => (
                <div key={row.key} className={`mrefx-source-row ${row.tone}`} title={row.sub} aria-label={`${row.label}: ${row.value}. ${row.sub}`}>
                  <span className={`mrefx-source-dot ${row.tone}`} />
                  <button type="button" className="mrefx-source-copy" onClick={() => { setCadenceTarget(row.key); setRefreshCustom(String(cadenceSec(row.key))); }} aria-label={`Edit ${row.label} cadence`}>
                    <b>{row.label}</b>
                    <em>{row.sub}</em>
                  </button>
                  <span className="mrefx-row-presets" role="radiogroup" aria-label={`${row.label} cadence`}>
                    {cadenceChoices.map((choice) => {
                      const on = cadenceSec(row.key) === choice.sec;
                      return (
                        <button
                          key={`${row.key}-${choice.sec}`}
                          data-testid={`mrefresh-${row.key}-${choice.sec}`}
                          className={on ? 'on' : ''}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => applyCadence(choice.sec, row.key)}
                        >
                          {choice.label}
                        </button>
                      );
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      case 'currency':
        return (
          <div className={`curfx-pop ${curTone}`}>
            <TopPanelHeader
              className={`curfx-hero ${curTone}`}
              logo={<CurrencyUnitGlyph />}
              title="Display Currency"
              sub={curRateText}
              status={cur}
              action={(
                <button
                  className={`curfx-refresh ${currencyBusy ? 'spin' : ''}`}
                  type="button"
                  onClick={refreshCurrencyFx}
                  title="Refresh FX rates"
                  aria-label="Refresh FX rates"
                  disabled={currencyBusy}
                >
                  <IconRefresh size={14} />
                </button>
              )}
            />
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
            <div className="curfx-preview-line" aria-label="Display currency conversion preview">
              <span><b>Preview</b><em>{currencyBasePreview}</em></span>
              <strong>{currencyConvertedPreview}</strong>
            </div>
            <div className="curfx-amounts" role="group" aria-label="Preview amount">
              {[100, 1000, 10000].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={currencyNotional === amount ? 'on' : ''}
                  onClick={() => setCurrencyNotional(amount)}
                >
                  {formatCurrencyPanelValue('USD', amount)}
                </button>
              ))}
            </div>
          </div>
        );
      case 'appearance':
        const themeModes = [
          { id: 'system', label: 'System' },
          { id: 'light', label: 'Light' },
          { id: 'dark', label: 'Dark' },
        ] as const;
        const setZoom = (next: number) => updatePref('zoom', Math.min(1.5, Math.max(0.8, Math.round(next * 100) / 100)));
        return (
          <div className={`apx-pop apx-premium ${theme}`} style={{ '--apx-accent': activeAccent.hex } as CSSProperties}>
            <TopPanelHeader
              className={`apx-stage ${prefs.theme}`}
              logo={theme === 'dark' ? <IconMoon size={21} /> : <IconSun size={21} />}
              title="Appearance"
              sub={`${prefs.theme === 'system' ? 'Auto' : prefs.theme} · ${activeAccent.label}`}
              status={`${appearanceZoom}%`}
            />
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
                  <b>{m.label}</b>
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
              <span className="apx-scale-label">Scale</span>
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
            <TopPanelHeader
              className={`basisx-hero ${basisIsBps ? 'bps' : 'pct'}`}
              logo={<BasisUnitGlyph />}
              title="Basis Unit"
              sub={basisPreview}
              status={basisCode}
            />
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
                <span><b>PCT</b><em>{formatBasisPct(basisSamplePct)}</em></span>
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
                <span><b>BPS</b><em>{formatBasisBp(basisSamplePct)}</em></span>
              </button>
            </div>
            <div className="basisx-preview-line" aria-label="Basis conversion preview">
              <span><b>Preview</b><em>1bp = 0.01%</em></span>
              <strong>{basisIsBps ? formatBasisBp(basisSamplePct) : formatBasisPct(basisSamplePct)}</strong>
            </div>
            <div className="basisx-samples" role="group" aria-label="Basis preview samples">
              {basisSamples.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  className={Math.abs(sample.value - basisSamplePct) < 0.0001 ? 'on' : ''}
                  onClick={() => setBasisSamplePct(sample.value)}
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>
        );
    }
  };

  const contentClean = (k: MK) => {
    if (k === 'clock' || k === 'shell') return content(k);

    if (k === 'apikey') {
      return keysBody();
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
          {notifTab === 'prefs' ? (
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
                const meta = notifMeta(e.kind, (e.data as Record<string, unknown> | null) ?? null);
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
      return content(k);
    }

    if (k === 'mrefresh') {
      return content(k);
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

  const premiumContent = (k: MK) => {
    const closeAndOpen = (overlay: 'cloudshell') => {
      closeMenu();
      openOverlay(overlay);
    };
    const statusTone = (tone: string): OpsTone => tone === 'ok' || tone === 'good'
      ? 'ok'
      : tone === 'bad'
        ? 'bad'
        : tone === 'warn'
          ? 'warn'
          : 'idle';
    const cadenceNote = (key: DataCadenceKey) => ({
      market: 'Quotes, basis, and market tables',
      account: 'Balances, fills, loans, and PnL',
      news: 'Headlines and context refresh',
      calendar: 'Economic-event refresh',
      fx: 'Upstream rates use a thirty-minute cache',
      health: 'System probes and event polling',
      token: 'Candles and order-book panels',
    } satisfies Record<DataCadenceKey, string>)[key];

    switch (k) {
      case 'clock':
        return (
          <div className="ops-sheet ops-clock-sheet" style={{ '--clock-accent': activeAccent.hex, '--ops-accent': activeAccent.hex } as CSSProperties}>
            <OpsSheetHeader
              icon={<ClockPopupLogo accent={activeAccent.hex} />}
              title="Market Clock"
              subtitle={`${zone.city} · ${activeClockOffset}`}
              status={zone.label}
              tone="accent"
            />
            <section className="ops-clock-stage" aria-label={`${activeClock.raw}, ${clockDate(zone.id, now)}`}>
              <span className="ops-clock-time"><b>{activeClock.hm}</b><em>:{activeClock.ss}</em></span>
              <span className="ops-clock-date">{clockDate(zone.id, now)}</span>
            </section>
            <div className="ops-section-label"><span>Timezone</span><em>24-hour display</em></div>
            <div className="ops-list ops-clock-zones">
              {ZONES.map((zz) => {
                const p = clockParts(zz.id, now);
                return (
                  <OpsRow
                    key={zz.id}
                    icon={<span className="ops-zone-code">{zz.label}</span>}
                    title={zz.city}
                    detail={zz.detail}
                    value={<><b>{p.hm}</b><em>:{p.ss}</em></>}
                    selected={zz.id === zone.id}
                    tone={zz.id === zone.id ? 'accent' : 'idle'}
                    onClick={() => updatePref('clockZone', zz.id)}
                  />
                );
              })}
            </div>
          </div>
        );

      case 'shell':
        return (
          <div className="ops-sheet ops-aws-sheet aws-control-sheet">
            <OpsSheetHeader
              icon={<span className="aws-popup-mark"><img src={AWS_RUNNER_MARK} alt="" /></span>}
              title="AWS Runner Control"
              subtitle="Restricted Systems Manager channel"
              status={!awsStatus ? 'Checking' : !awsStatus.configured ? 'Not configured' : !awsStatus.connectionEnabled ? 'Blocked' : awsStatus.channel === 'online' ? 'Online' : awsStatus.channel === 'offline' ? 'Offline' : 'Ready'}
              tone={!awsStatus || !awsStatus.configured || !awsStatus.connectionEnabled ? 'idle' : awsStatus.channel === 'online' ? 'ok' : awsStatus.channel === 'offline' ? 'bad' : 'warn'}
            />
            <section className="aws-pop-target" aria-label="Configured AWS runner target">
              <div><span>Region</span><b>{awsStatus?.region ?? 'Not configured'}</b></div>
              <div><span>Instance</span><b>{awsStatus?.instanceId ?? 'Not configured'}</b></div>
              <div><span>Service</span><b>{awsStatus?.serviceName ?? 'Not configured'}</b></div>
            </section>
            <div className="aws-pop-gates" aria-label="AWS connection gates">
              <button
                type="button"
                role="switch"
                aria-checked={awsStatus?.connectionEnabled === true}
                className={awsStatus?.connectionEnabled ? 'on' : ''}
                disabled={!awsStatus?.configured || !awsStatus?.operatorAuthorized || awsGateBusy}
                onClick={() => { void toggleAwsGate('connectionEnabled'); }}
              >
                <span><b>AWS Channel</b><em>Block or allow website-to-AWS control traffic.</em></span>
                <i><span /></i>
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={awsStatus?.executionEnabled === true}
                className={awsStatus?.executionEnabled ? 'on' : ''}
                disabled={!awsStatus?.connectionEnabled || !awsStatus?.operatorAuthorized || awsGateBusy}
                onClick={() => { void toggleAwsGate('executionEnabled'); }}
              >
                <span><b>Runner Changes</b><em>Write, validate, and restart the configured runner.</em></span>
                <i><span /></i>
              </button>
            </div>
            {(awsStatusError || (awsStatus && (!awsStatus.configured || !awsStatus.operatorAuthorized))) && (
              <div className="aws-pop-notice"><IconShield size={14} /><span>{awsStatusError ?? (!awsStatus?.configured ? `Set ${awsStatus?.missing.join(', ')}` : awsStatus?.authorizationReason ?? 'Verified operator access is required.')}</span></div>
            )}
            <footer className="ops-sheet-foot split">
              <button type="button" className="primary" onClick={() => closeAndOpen('cloudshell')}><IconTerminal size={14} /> Open Runner Workspace</button>
              <a href={AWS_CONSOLE_URL} target="_blank" rel="noreferrer noopener" onClick={closeMenu}><IconExternal size={14} /> AWS Console</a>
            </footer>
          </div>
        );

      case 'apikey': {
        const visibleKeys = [roKey, fullKey].filter(Boolean) as ApiKeyInfo[];
        return <BinanceApiKeySheet keys={visibleKeys} />;
      }

      case 'data':
        return (
          <div className="ops-sheet ops-data-sheet">
            <OpsSheetHeader
              icon={<PopupSourceMark tone="#50ad1d" brand><img className="data-health-source-image" src={DATA_HEALTH_MARK} alt="" /></PopupSourceMark>}
              title="Data Health"
              subtitle={`${dataGood} of ${dataRows.length} source checks passing`}
              status={dataLabel}
              tone={statusTone(dataGrade)}
            />
            <div className="ops-list ops-health-list" aria-label="Measured data checks">
              {dataRows.map((row) => (
                <OpsRow
                  key={row.name}
                  icon={<span className={`ops-health-dot ${row.tier}`} />}
                  title={row.name}
                  value={row.value}
                  tone={statusTone(row.tier)}
                />
              ))}
            </div>
            <footer className="ops-sheet-foot ops-data-foot"><button type="button" className="primary ops-data-action" onClick={() => { closeMenu(); setPage('system'); }}><IconPulse size={14} /> Open System Health</button></footer>
          </div>
        );

      case 'advisor': {
        return (
          <div className="ops-sheet ops-advisor-sheet">
            <OpsSheetHeader
              icon={<PopupSourceMark tone="#24c85a" brand><img className="trust-advisor-source-image" src={TRUST_ADVISOR_MARK} alt="" /></PopupSourceMark>}
              title="Trust Advisor"
              subtitle={`${advChecks.length} live cockpit checks`}
              status={advTone === 'bad' ? 'Action' : advTone === 'warn' ? 'Review' : 'Clear'}
              tone={statusTone(advTone)}
            />
            <div className="ops-advisor-strip" aria-label="Advisor results">
              <span className="bad">
                <i className="ops-advisor-state-icon"><LucideAdvisorAction size={17} strokeWidth={1.8} /></i>
                <span className="ops-advisor-state-copy"><b>{advA.length}</b><em>Action</em></span>
              </span>
              <span className="warn">
                <i className="ops-advisor-state-icon"><LucideAdvisorReview size={17} strokeWidth={1.8} /></i>
                <span className="ops-advisor-state-copy"><b>{advI.length}</b><em>Review</em></span>
              </span>
              <span className="ok">
                <i className="ops-advisor-state-icon"><LucideAdvisorClear size={17} strokeWidth={1.8} /></i>
                <span className="ops-advisor-state-copy"><b>{advP.length}</b><em>Clear</em></span>
              </span>
            </div>
            <div className="ops-section-label"><span>All checks</span><em>{advChecks.length} current</em></div>
            <div className="ops-list ops-advisor-list">
              {[...advA, ...advI, ...advP].map((check) => (
                <OpsRow
                  key={check.name}
                  icon={check.sev === 'action'
                    ? <LucideAdvisorAction size={15} strokeWidth={1.8} />
                    : check.sev === 'invest'
                      ? <LucideAdvisorReview size={15} strokeWidth={1.8} />
                      : <LucideAdvisorClear size={15} strokeWidth={1.8} />}
                  title={check.name}
                  detail={check.detail}
                  value={check.sev === 'action' ? 'Fix' : check.sev === 'invest' ? 'Review' : 'Clear'}
                  tone={check.sev === 'action' || check.sev === 'invest' ? 'warn' : 'ok'}
                  onClick={check.page ? () => { closeMenu(); setPage(check.page!); } : undefined}
                />
              ))}
            </div>
            <footer className="ops-sheet-foot split">
              <button type="button" className="primary" onClick={() => { closeMenu(); setPage('risk'); }}><IconRadar size={14} /> Risk controls</button>
              <button type="button" onClick={() => { closeMenu(); setPage('system'); }}><IconPulse size={14} /> Health</button>
            </footer>
          </div>
        );
      }

      case 'notif':
        return (
          <div className="ops-sheet ops-notification-sheet">
            <OpsSheetHeader
              icon={<PopupSourceMark tone="#f0a400" brand><img className="notification-source-image" src={NOTIFICATION_MARK} alt="" /></PopupSourceMark>}
              title="Notifications"
              subtitle="Curated account and bot alerts"
              status={unread ? `${unread} new` : compactNotifications.length ? 'Read' : 'Clear'}
              tone={unread ? 'accent' : 'ok'}
            />
            <div className="ops-list ops-notification-list">
              {compactNotifGroups.length ? compactNotifGroups.map((item) => (
                <OpsRow
                  key={item.id}
                  icon={notifIcon(item.severity === 'opportunity' ? 'opportunity' : item.category, 15)}
                  title={item.title}
                  detail={item.count > 1 ? `${item.detail} · ${item.count} grouped` : item.detail}
                  value={timeAgo(item.ts)}
                  tone={item.severity === 'critical' ? 'bad' : item.severity === 'opportunity' ? 'accent' : 'idle'}
                  onClick={openNotificationCenter}
                />
              )) : <div className="ops-empty-state"><IconBell size={18} /><b>Inbox clear</b><em>Only owner-relevant alerts appear here. Full telemetry stays in Logs.</em></div>}
            </div>
            <footer className="ops-sheet-foot split">
              <button type="button" onClick={markNotificationsRead} disabled={!unread}>Mark read</button>
              <button type="button" className="primary" onClick={openNotificationCenter}><IconMaximize size={14} /> Open center</button>
            </footer>
          </div>
        );

      case 'power':
        return (
          <div className={`ops-sheet ops-bot-sheet ${modeTone}`}>
            <OpsSheetHeader
              icon={<PopupSourceMark tone="#d43f4c"><PopupPowerIcon size={32} weight="duotone" /></PopupSourceMark>}
              title="Execution Control"
              subtitle={modeSub}
              status={modeLabel}
              tone={statusTone(modeTone)}
            />
            <button
              className={`ops-emergency ${killOn ? 'engaged' : ''}`}
              type="button"
              onClick={() => {
                if (!killOn || window.confirm('Resume bot actions and return control to the configured risk gates?')) void setKill(!killOn);
              }}
            >
              <span className="ops-emergency-mark"><IconPower size={20} /></span>
              <span><b>{killOn ? 'Emergency stop engaged' : 'Emergency stop ready'}</b><em>{killOn ? 'Click to resume after confirmation.' : 'Stops orders, loans, and automation immediately.'}</em></span>
              <strong>{killOn ? 'STOPPED' : 'STOP'}</strong>
            </button>
            <div className="ops-section-label"><span>Configured permissions</span><em>{modeNet}</em></div>
            <div className="ops-list ops-control-list" role="group" aria-label="Bot execution permissions">
              <button type="button" className="ops-control-row" onClick={() => setFundsAccess(!fundsAllowed)} aria-pressed={fundsAllowed}>
                <span><b>Funds access</b><em>Use balances within risk limits</em></span><i className={`ops-switch ${fundsAllowed ? 'on' : ''}`}><span /></i>
              </button>
              <button type="button" className="ops-control-row" onClick={() => setNewLoans(!newLoansAllowed)} aria-pressed={newLoansAllowed}>
                <span><b>New borrowing</b><em>Margin and flexible-loan requests</em></span><i className={`ops-switch ${newLoansAllowed ? 'on' : ''}`}><span /></i>
              </button>
              <button type="button" className="ops-control-row" onClick={() => setBotRunning(!botRunning)} aria-pressed={botRunning}>
                <span><b>Strategy automation</b><em>Allow configured strategies to act</em></span><i className={`ops-switch ${botRunning ? 'on' : ''}`}><span /></i>
              </button>
              <button type="button" className="ops-control-row" onClick={() => { void setLive(!liveOrdersAllowed); }} aria-pressed={liveOrdersAllowed} disabled={!liveOrdersAllowed && !!liveBlocker} title={liveTitle}>
                <span><b>Live order arm</b><em>{liveBlocker ?? 'Sends remain behind the risk gate'}</em></span><i className={`ops-switch ${liveOrdersAllowed ? 'on' : ''}`}><span /></i>
              </button>
            </div>
          </div>
        );

      case 'mrefresh':
        return (
          <div className="ops-sheet ops-cadence-sheet">
            <OpsSheetHeader
              icon={<PopupSourceMark tone="#208cf0" brand><img className="market-ping-source-image" src={MARKET_PING_MARK} alt="" /></PopupSourceMark>}
              title="Market Ping"
              subtitle="Live source polling"
              status={refreshCode}
              tone={statusTone(refreshTone)}
            />
            <div className="ops-list ops-cadence-list">
              {marketPingRows.map((row) => (
                  <div className="ops-cadence-row" key={row.key}>
                    <span className={`ops-row-icon ${statusTone(row.tone)}`}>{row.icon}</span>
                    <span className="ops-row-copy"><b>{row.label}</b><em>{cadenceNote(row.key)}</em></span>
                    <select className="ops-ping-select" value={cadenceSec(row.key)} onChange={(e) => applyCadence(Number(e.target.value), row.key)} aria-label={`${row.label} ping interval`}>
                      {MARKET_PING_CHOICES.map((sec) => <option key={sec} value={sec}>{fmtCadence(sec)}</option>)}
                    </select>
                  </div>
              ))}
            </div>
            <div className="ops-policy-line idle"><IconRefresh size={14} /><span>Ping timing never bypasses upstream cache windows.</span></div>
          </div>
        );

      case 'currency':
        return (
          <div className="ops-sheet ops-currency-sheet">
            <OpsSheetHeader
              icon={<PopupSourceMark tone="#315bea"><PopupCurrencyIcon size={32} weight="duotone" /></PopupSourceMark>}
              title="Display Currency"
              subtitle={currencyFx.fetchedAt ? `Rates updated ${timeAgo(currencyFx.fetchedAt)}` : 'Loading cached FX rates'}
              status={cur}
              tone={statusTone(curTone)}
            />
            <div className="ops-list">
              {Object.entries(CURRENCIES).map(([code, currency]) => (
                <OpsRow
                  key={code}
                  icon={<span className="ops-currency-symbol">{currency.symbol.trim() || code}</span>}
                  title={currency.label}
                  detail={code}
                  value={currencyRateText(code)}
                  selected={cur === code}
                  tone={cur === code ? 'accent' : 'idle'}
                  onClick={() => updatePref('currency', code)}
                />
              ))}
            </div>
            <div className="ops-policy-line idle"><IconRefresh size={14} /><span>Rates follow the server cache; changing currency updates every formatter.</span></div>
          </div>
        );

      case 'basisu':
        return (
          <div className="ops-sheet ops-basis-sheet">
            <OpsSheetHeader
              icon={<PopupSourceMark tone="#6f52c9"><PopupPercentIcon size={32} weight="duotone" /></PopupSourceMark>}
              title="Basis Units"
              subtitle="One unit across tables and charts"
              status={basisCode}
              tone="accent"
            />
            <div className="ops-choice-stack" role="radiogroup" aria-label="Basis display unit">
              <button type="button" role="radio" aria-checked={!basisIsBps} className={!basisIsBps ? 'selected' : ''} onClick={() => updatePref('basisUnit', 'pct')} data-testid="basis-unit-pct">
                <span className="ops-choice-mark">%</span><span><b>Percent</b><em>Compact decimal display · +0.042%</em></span>{!basisIsBps && <IconCheck size={15} />}
              </button>
              <button type="button" role="radio" aria-checked={basisIsBps} className={basisIsBps ? 'selected' : ''} onClick={() => updatePref('basisUnit', 'bps')} data-testid="basis-unit-bps">
                <span className="ops-choice-mark">bp</span><span><b>Basis points</b><em>Trading-desk display · +4.2 bp</em></span>{basisIsBps && <IconCheck size={15} />}
              </button>
            </div>
            <div className="ops-note-row"><IconTicket size={15} /><span><b>1 basis point = 0.01%</b><em>This changes presentation only; calculations retain full precision.</em></span></div>
          </div>
        );

      case 'account':
        return <AccountSheet open={active === 'account'} />;

      case 'appearance': {
        const themeModes = [
          { id: 'system', label: 'System' },
          { id: 'light', label: 'Light' },
          { id: 'dark', label: 'Dark' },
        ] as const;
        const setZoom = (next: number) => updatePref('zoom', Math.min(1.5, Math.max(0.8, Math.round(next * 100) / 100)));
        return (
          <div className="ops-sheet ops-appearance-sheet" style={{ '--ops-accent': activeAccent.hex } as CSSProperties}>
            <OpsSheetHeader
              icon={<PopupSourceMark tone="#9a50cf"><PopupPaletteIcon size={32} weight="duotone" /></PopupSourceMark>}
              title="Appearance"
              subtitle={`${activeAccent.label} accent · ${appearanceZoom}% scale`}
              status={prefs.theme === 'system' ? 'Auto' : prefs.theme}
              tone="accent"
            />
            <div className="ops-section-label"><span>Theme</span><em>Applied immediately</em></div>
            <div className="ops-segment" role="radiogroup" aria-label="Theme mode">
              {themeModes.map((mode) => (
                <button key={mode.id} type="button" role="radio" aria-checked={prefs.theme === mode.id} className={prefs.theme === mode.id ? 'selected' : ''} onClick={() => updatePref('theme', mode.id)} data-testid={`appearance-theme-${mode.id}`}>{mode.label}</button>
              ))}
            </div>
            <div className="ops-section-label"><span>Accent</span><em>{activeAccent.label}</em></div>
            <div className="ops-accent-row" role="radiogroup" aria-label="Accent color">
              {ACCENT_ORDER.map((key) => {
                const accent = ACCENTS[key];
                return <button key={key} type="button" role="radio" aria-checked={prefs.accent === key} className={prefs.accent === key ? 'selected' : ''} onClick={() => updatePref('accent', key)} aria-label={`${accent.label} accent`} title={accent.label} style={{ '--swatch': accent.hex } as CSSProperties}><span /></button>;
              })}
            </div>
            <div className="ops-section-label"><span>Interface scale</span><em>80–150%</em></div>
            <div className="ops-scale-row">
              <button type="button" onClick={() => setZoom((prefs.zoom || 1) - 0.05)} aria-label="Zoom out" data-testid="appearance-zoom-out">−</button>
              <strong>{appearanceZoom}%</strong>
              <button type="button" onClick={() => setZoom((prefs.zoom || 1) + 0.05)} aria-label="Zoom in" data-testid="appearance-zoom-in">+</button>
              <button type="button" className="reset" onClick={() => updatePref('zoom', 1)} data-testid="appearance-zoom-reset">Reset 100%</button>
            </div>
          </div>
        );
      }
    }
  };

  return (
    <div
      className="smenu-bar topbar-suite-v3 topbar-suite-v4"
      ref={rowRef}
      onPointerLeave={scheduleClose}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleClose();
      }}
    >
      {trig('clock', 'hdr-clock-btn clock-pro-btn clock-premium-trigger', <>
        <span className="clock-command-pill" style={{ '--clock-accent': activeAccent.hex } as CSSProperties} aria-hidden="true">
          <HourglassMotionMark />
          <span className="clock-command-time">{activeClock.hm}</span>
          <i className="clock-command-bullet" />
          <span className="clock-command-zone">{zone.label}</span>
        </span>
      </>, { title: `Market Clock — ${zone.city} · ${activeClockOffset}` })}
      {trig('data', `hdr-ic data-ghost data-pro grade-${dataGrade}`, <>
        <span className={`rail-icon-core ${dataGrade}`}><img className="data-health-trigger-image" src={DATA_HEALTH_MARK} alt="" /></span>
      </>, { title: `Data Health — ${dataLabel} · ${dataSub}` })}
      {trig('mrefresh', `hdr-ic refresh-ghost refresh-premium-trigger ${refreshTone}`, <>
        <span className={`rail-icon-core ${refreshTone}`}><img className="market-ping-trigger-image" src={MARKET_PING_MARK} alt="" /></span>
      </>, { title: `Market Ping — market every ${refreshCode}` })}
      <span className="topbar-suite-divider" aria-hidden="true" />
      {trig('shell', 'hdr-ic tint-shell shell-ghost shell-premium-trigger', <>
        <span className="rail-icon-core aws-runner-trigger-core"><img className="aws-runner-trigger-image" src={AWS_RUNNER_MARK} alt="" /></span>
      </>, { title: `AWS Runner Control — ${!awsStatus ? 'checking' : !awsStatus.configured ? 'not configured' : awsStatus.connectionEnabled ? 'channel open' : 'blocked'}` })}
      {trig('apikey', `hdr-ic apikey-ghost apikey-premium-trigger s-${roKey?.status ?? 'missing'}`, <>
        <span className={`rail-icon-core api-key-trigger-core s-${roKey?.status ?? 'missing'}`}><img className="api-key-trigger-image" src={API_KEY_MARK} alt="" /></span>
      </>, { title: `API keys — ${roKey?.live ? 'live posture' : roKey?.keysPresent ? 'permission sync pending' : 'no live key'}` })}
      {trig('advisor', `hdr-ic advisor-ghost advisor-premium-trigger grade-${advTone}`, <>
        <span className={`rail-icon-core trust-advisor-trigger-core ${advTone}`}><img className="trust-advisor-trigger-image" src={TRUST_ADVISOR_MARK} alt="" /></span>
      </>, { title: 'Trust Advisor — live cockpit checks' })}
      <span className="topbar-suite-divider" aria-hidden="true" />
      {trig('notif', `hdr-ic notif-trigger notif-ghost notif-premium-trigger ${notifTone}`, <>
        <span className={`rail-icon-core notification-trigger-core ${notifTone}`}>
          <img className="notification-trigger-image" src={NOTIFICATION_MARK} alt="" />
          {unread > 0 && <b className="ops-trigger-count">{unread > 99 ? '99+' : unread}</b>}
        </span>
      </>, { title: `Notifications — ${unread ? `${unread} unread` : 'no unread events'}` })}
      {trig('power', `hdr-ic power-ghost power-premium-trigger ${modeClass}`, <>
        <span className={`rail-icon-core ${modeTone}`}><LucidePower size={20} strokeWidth={1.7} /></span>
      </>, { title: `Execution Control — ${modeLabel}` })}
      <span className="topbar-suite-divider" aria-hidden="true" />
      {trig('currency', `hdr-ic currency-ghost currency-premium-trigger ${curTone}`, <>
        <span className={`rail-icon-core ${curTone}`}><LucideCurrency size={20} strokeWidth={1.7} /></span>
      </>, { title: `Display currency — ${cur}` })}
      {trig('basisu', `hdr-ic basis-ghost basis-premium-trigger ${basisIsBps ? 'basis-bps' : 'basis-pct'}`, <>
        <span className={`rail-icon-core ${basisIsBps ? 'bps' : 'pct'}`}><LucideBasis size={20} strokeWidth={1.7} /></span>
      </>, { title: `Basis units — ${basisIsBps ? 'basis points' : 'percent'}` })}
      {trig('appearance', `hdr-ic appearance-ghost appearance-premium-trigger ${theme}`, <>
        <span className={`rail-icon-core ${theme}`} style={{ '--apx-accent': activeAccent.hex } as CSSProperties}>
          <LucidePalette size={20} strokeWidth={1.7} />
        </span>
      </>, { title: `Appearance — ${prefs.theme === 'system' ? 'auto' : prefs.theme} · ${appearanceZoom}%` })}
      {trig('account', `hdr-ic shared-account-trigger s-${accountTone}`, <>
        <span className={`shared-account-orb s-${accountTone}`}>
          <span><img src={accountAvatar} alt="" /></span>
          <i aria-hidden="true" />
        </span>
      </>, { title: `Account Details — ${accountSub}` })}
      <div
        className={`smenu ${active ? 'open' : ''}`}
        style={{ left: geo.left, width: geo.width }}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        aria-hidden={!active}
      >
        <span className="smenu-arrow" style={{ left: geo.pointer }} />
        <div
          ref={menuContentRef}
          className={`smenu-content ${outgoingContent ? 'switching' : ''} dir-${contentDirection > 0 ? 'forward' : 'backward'}`}
          style={{
            height: contentHeight === null ? undefined : `${contentHeight}px`,
            '--smenu-max-height': `${contentMaxHeight}px`,
          } as CSSProperties}
        >
          {outgoingContent && (
            <div className="smenu-pane outgoing" data-pane-key={outgoingContent} aria-hidden="true" inert key={outgoingContent}>
              {premiumContent(outgoingContent)}
            </div>
          )}
          {contentActive && (
            <div
              ref={incomingPaneRef}
              className={`smenu-pane incoming ${outgoingContent ? 'switching' : 'first'}`}
              data-pane-key={contentActive}
              key={contentActive}
            >
              {premiumContent(contentActive)}
            </div>
          )}
        </div>
      </div>
      {notifDetailOpen && (
        <div
          className="ntf-modal-backdrop ntc-backdrop"
          role="presentation"
          onMouseDown={(e) => { if (e.currentTarget === e.target) setNotifDetailOpen(false); }}
        >
          <section className={`ntc-center ${notifTone}`} role="dialog" aria-modal="true" aria-labelledby="ntf-modal-title">
            <header className="ntc-head">
              <div className="ntc-title-mark" aria-hidden="true"><img src={NOTIFICATION_MARK} alt="" /></div>
              <div className="ntc-title-copy">
                <b id="ntf-modal-title">Notifications</b>
                <em>Curated account, execution, bot, and market alerts. Detailed evidence remains in Logs.</em>
              </div>
              <div className="ntc-head-status"><i /><span><b>In-App Active</b><em>{draftAlertsOn} of {alertRows.length} rules</em></span></div>
              <div className="ntc-head-actions">
                <button type="button" onClick={markNotificationsRead} disabled={unread === 0}>Mark Read</button>
                <button type="button" onClick={() => { setNotifDetailOpen(false); setPage('ledger'); }}><IconReceipt size={14} /> Open Logs</button>
                <button className="ntc-close" type="button" onClick={() => setNotifDetailOpen(false)} aria-label="Close notifications">
                  <IconClose size={18} />
                </button>
              </div>
            </header>

            <section className="ntc-rules" aria-labelledby="ntc-rules-title">
              <div className="ntc-rules-copy">
                <b id="ntc-rules-title">Notification Rules</b>
                <em>Select which Log events deserve an interruption.</em>
              </div>
              <div className="ntc-rule-grid">
                {alertRows.map((rule) => (
                  <button
                    key={rule.key}
                    className={`ntc-rule ${notifDraftAlerts[rule.key] ? 'on' : 'off'}`}
                    type="button"
                    aria-pressed={notifDraftAlerts[rule.key]}
                    onClick={() => setNotifDraftAlerts((current) => ({ ...current, [rule.key]: !current[rule.key] }))}
                  >
                    <span className={`ntc-rule-icon ${rule.key}`}>{notifIcon(rule.key, 16)}</span>
                    <span className="ntc-rule-copy"><b>{rule.label}</b><em>{rule.sub}</em></span>
                    <strong>{notifBucketCounts[rule.key]}</strong>
                    <i className="ntc-toggle" aria-hidden="true"><span /></i>
                  </button>
                ))}
              </div>
              <div className="ntc-delivery" aria-label="Delivery channels">
                <span className="active"><IconBell size={14} /><b>In-App</b><em>Active</em></span>
                <span><LucideLaptop size={14} /><b>Email</b><em>Planned</em></span>
                <span><LucideSmartphone size={14} /><b>WhatsApp</b><em>Planned</em></span>
              </div>
            </section>

            <section className="ntc-days" aria-label="Seven day alert history">
              {notifDays.map((day) => (
                <button key={day.key} type="button" className={notifDay === day.key ? 'on' : ''} onClick={() => setNotifDay((current) => current === day.key ? 'all' : day.key)}>
                  <span><b>{day.day}</b><em>{day.date}</em></span>
                  <strong>{day.total}</strong>
                  <small className={day.critical ? 'hot' : ''}>{day.critical ? `${day.critical} critical` : 'Clear'}</small>
                </button>
              ))}
            </section>

            <section className="ntc-feed" aria-label="Curated notification feed">
              <div className="ntc-toolbar">
                <div className="ntc-filters" role="tablist" aria-label="Notification filters">
                  {notifTabs.map((tab) => (
                    <button key={tab.id} type="button" className={notifTab === tab.id ? 'on' : ''} role="tab" aria-selected={notifTab === tab.id} onClick={() => setNotifTab(tab.id)}>
                      {tab.label}<span>{tab.id === 'all' ? enabledArchiveNotifications.reduce((sum, item) => sum + item.count, 0) : notifBucketCounts[tab.id as NotificationRuleKey]}</span>
                    </button>
                  ))}
                </div>
                <div className="ntc-context">
                  {notifDay !== 'all' && <button type="button" onClick={() => setNotifDay('all')}>All 7 Days</button>}
                  <span>{zone.city} · {notifTimeZone === 'UTC' ? 'UTC' : zone.label}</span>
                </div>
              </div>

              <div className="ntc-table-head" aria-hidden="true"><span>Time</span><span>Alert</span><span>Notification</span><span>Source</span><span>Status</span></div>
              <div className="ntc-list">
                {notifArchiveBusy && notifArchive.length === 0 ? (
                  <div className="ntc-empty"><IconRefresh size={18} /><b>Loading Notification History</b><em>Reading the last seven days from the immutable Log.</em></div>
                ) : notifArchiveError ? (
                  <div className="ntc-empty error"><IconAlarm size={18} /><b>Notification History Unavailable</b><em>{notifArchiveError}</em></div>
                ) : filteredNotifications.length === 0 ? (
                  <div className="ntc-empty"><IconBell size={18} /><b>No Alerts Match This View</b><em>Try another day or enable a rule above. Raw activity remains available in Logs.</em></div>
                ) : filteredNotifications.map((item) => (
                  <article key={`${item.id}-${item.category}`} className={`ntc-row ${item.severity}`}>
                    <time><b>{notifClock(item.ts)}</b><em>{notifStamp(item.ts)}</em></time>
                    <span className={`ntc-row-icon ${item.category}`}>{notifIcon(item.severity === 'opportunity' ? 'opportunity' : item.category, 17)}</span>
                    <span className="ntc-row-copy"><b>{item.title}</b><em>{item.detail}</em></span>
                    <span className="ntc-row-source"><b>{item.subject}</b><em>{alertShort[item.category]}</em></span>
                    <span className={`ntc-row-status ${item.severity}`}>{item.count > 1 ? `${item.count} Grouped` : item.severity === 'critical' ? 'Action' : item.severity === 'warning' ? 'Review' : 'Notified'}</span>
                  </article>
                ))}
              </div>
            </section>

            <footer className="ntc-foot">
              <span><b>{filteredNotifications.reduce((sum, item) => sum + item.count, 0)}</b> alerts in view · {allArchiveNotifications.reduce((sum, item) => sum + item.count, 0)} curated from seven days of Logs</span>
              <div>
                <button type="button" onClick={cancelNotificationPrefs} disabled={!notifPrefsDirty}>Discard Changes</button>
                <button className="primary" type="button" onClick={saveNotificationPrefs} disabled={!notifPrefsDirty}>Save Changes</button>
              </div>
            </footer>
          </section>
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
  const [lastRefreshTs, setLastRefreshTs] = useState<number | null>(null);
  const [lastRefreshIssues, setLastRefreshIssues] = useState<string[]>([]);
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

  const pingHealthNow = useCallback(async (): Promise<number | null> => {
    const t0 = performance.now();
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      const ms = performance.now() - t0;
      setAppRtt(ms);
      return ms;
    } catch {
      setAppRtt(null);
      return null;
    }
  }, []);

  const loadSystemNow = useCallback(async (): Promise<SystemLite | null> => {
    try {
      const r = await fetch('/api/system', { cache: 'no-store' });
      const s = r.ok ? ((await r.json()) as SystemLite) : null;
      if (s) setSys(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void pingHealthNow();
    const t = window.setInterval(() => void pingHealthNow(), 5000);
    return () => window.clearInterval(t);
  }, [pingHealthNow]);
  useEffect(() => {
    void loadSystemNow();
    const t = window.setInterval(() => void loadSystemNow(), 5000);
    return () => window.clearInterval(t);
  }, [loadSystemNow]);

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
    { key: 'app', label: 'Browser → Server', value: appRtt != null ? msLabel(appRtt) : 'offline', tier: latTier(appRtt, 120, 350, 800) },
    { key: 'binance', label: 'Binance REST', value: rest != null ? msLabel(rest) : '—', tier: latTier(rest, 300, 600, 1100) },
    { key: 'socket', label: 'Live Socket', value: connected ? 'live' : 'reconnecting', tier: connected ? 'good' : 'bad' },
    { key: 'feed', label: 'Market Feed', value: feedVals.length ? (feedsOk ? `${feedVals.length} open` : 'degraded') : 'idle', tier: feedVals.length ? (feedsOk ? 'good' : 'slow') : 'avg' },
    { key: 'account', label: 'Account Sync', value: b?.keysPresent ? (acctTs ? timeAgo(acctTs) : 'no sync') : 'no key', tier: b?.keysPresent ? ageTier(acctTs, 90_000) : 'avg' },
    { key: 'refresh', label: 'Last Refresh', value: lastRefreshTs ? timeAgo(lastRefreshTs) : 'not run', tier: lastRefreshTs ? (lastRefreshIssues.length ? 'slow' : 'good') : 'avg' },
    { key: 'stream', label: 'User Stream', value: String(userStream), tier: streamTier },
    { key: 'drift', label: 'Clock Drift', value: drift != null ? msLabel(drift) : '—', tier: latTier(drift != null ? Math.abs(drift) : null, 400, 1200, 2500) },
    { key: 'weight', label: 'Rate Budget · 1m', value: weight != null ? String(weight) : '—', tier: weightTier },
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
    let res: { ok: boolean; issues: string[]; ts?: number };
    try { res = await refresh(); } catch { res = { ok: false, issues: ['Refresh failed'], ts: Date.now() }; }
    const [healthPing, systemPayload] = await Promise.all([pingHealthNow(), loadSystemNow()]);
    if (healthPing == null) res.issues.push('Health probe failed');
    if (!systemPayload) res.issues.push('System probe failed');
    setLastRefreshTs(res.ts ?? Date.now());
    setLastRefreshIssues(res.issues);
    res.ok = res.issues.length === 0;
    const wait = Math.max(0, 2050 - (Date.now() - t0)); // let it spin a few smooth turns
    window.setTimeout(() => {
      if (res.ok) { setSt('ok'); window.setTimeout(() => setSt('idle'), 1500); }
      else { setSt('err'); window.setTimeout(() => setSt('idle'), 2400); }
      busy.current = false;
    }, wait);
  };

  const label = st === 'spin' ? 'Refreshing Backend State…' : st === 'ok' ? 'Backend State Refreshed' : st === 'err' ? 'Refresh Issues — Try Again' : `Connection Health: ${overall}`;

  return (
    <div className="rdock" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {open && (st === 'idle' || st === 'err') && (
        <div className="rdock-pop">
          <div className="rdock-pop-head"><span>Connection Health</span><span className={`rdock-pop-tag t-${overall}`}>{overall}</span></div>
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
          <div className="rdock-pop-foot">Click To Refresh Backend State</div>
        </div>
      )}
      <button className={`rdock-btn t-${overall} ${st}`} onClick={run} title={label} aria-label={label}>
        <span className="rdock-motion" aria-hidden="true" />
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
                      <span className="cc-num num strong">{calVal(it.actual, it.unit, it.scale)}</span>
                      <span className="cc-num num">{calVal(it.forecast, it.unit, it.scale)}</span>
                      <span className="cc-num num muted">{calVal(it.previous, it.unit, it.scale)}</span>
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

function CloudShellModal({ onClose }: { onClose: () => void }) {
  return <AwsRunnerModal onClose={onClose} />;
}

// Rendered once at the app root so fixed overlays escape the sidebar box.
export function Overlays() {
  const [kind, set] = useOverlay();
  if (kind === 'news') return <NewsModal onClose={() => set(null)} />;
  if (kind === 'calendar') return <CalendarModal onClose={() => set(null)} />;
  if (kind === 'cloudshell') return <CloudShellModal onClose={() => set(null)} />;
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
