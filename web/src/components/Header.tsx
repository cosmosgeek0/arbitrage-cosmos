import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  resolveFxRate,
  useStore,
  useResolvedTheme,
  type CompatibilityStateStatus,
  type Page,
} from '../store';
import type { LedgerEvent, MarketRow } from '../types';
import { fmtClockZone, timeAgo } from '../format';
import { eventSummary } from '../lib/eventText';
import { calVal, flag, type CalItem } from '../lib/calendar';
import { curateNotifications, groupNotifications, notificationEnabled } from '../lib/notifications';
import { fireRefresh } from '../lib/refresh';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createDelayedResetOwner, createSettledPoll, type SettledPoll } from '../lib/polling';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import { type ProductBindingContinuity, type ProductComponentProjection } from '../lib/productIntegration';
import { canonicalRefreshTargetPosture, canonicalWatchmanLauncherPresentation } from '../lib/operatorControlPosture';
import { ACCENTS, CURRENCIES, DATA_CADENCE_DEFAULTS, MARKET_PING_CHOICES, type AccentKey, type DataCadenceKey, type NotificationRuleKey } from '../lib/prefs';
import { openOverlay, useOverlay } from '../lib/overlay';
import { TokenIcon } from './TokenIcon';
import { PillSelect } from './PillSelect';
import { AWS_CONTROL_POSTURE } from './AwsRunnerControl';
import {
  BadgeCheck as LucideAdvisorClear,
  BellRing as LucideBell,
  CircleAlert as LucideAdvisorReview,
  Radar as LucideNotifOpportunity,
  ScrollText as LucideNotifLog,
  ShieldAlert as LucideNotifCritical,
  TriangleAlert as LucideAdvisorAction,
  WalletCards as LucideNotifAccount,
} from 'lucide-react';
import {
  IconAlarm,
  IconBell,
  IconBrain,
  IconCalendar,
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
  IconSearch,
  IconShield,
  IconSun,
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

const DEFAULT_PROFILE_LOGO = '/account-night-sky.png';
const TRUST_ADVISOR_MARK = '/trust-advisor-shield.png';
const NOTIFICATION_MARK = '/notification-bell.png';
const BASIS_MARK = '/basis-percent.png';
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

function AppearanceIdentityMark({ size = 31 }: { size?: number }) {
  return (
    <svg className="operator-identity-mark appearance-identity-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" shapeRendering="geometricPrecision">
      <defs>
        <linearGradient id="appearanceDisc" x1="13" y1="11" x2="36" y2="37" gradientUnits="userSpaceOnUse">
          <stop stopColor="#69a8ff" />
          <stop offset="1" stopColor="#3c82f1" />
        </linearGradient>
        <linearGradient id="appearanceCore" x1="19" y1="17" x2="31" y2="33" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1c5fc4" />
          <stop offset="1" stopColor="#10469f" />
        </linearGradient>
      </defs>
      <g className="appearance-rays" fill="none" stroke="#1468f5" strokeWidth="4.2" strokeLinecap="round">
        <path d="M24 2.8v7.1M24 38.1v7.1M2.8 24h7.1M38.1 24h7.1" />
        <path d="m8.8 8.8 5 5m20.4 20.4 5 5M8.8 39.2l5-5m20.4-20.4 5-5" />
      </g>
      <circle cx="24" cy="24" r="13.2" fill="url(#appearanceDisc)" />
      <circle cx="24" cy="24" r="8.9" fill="url(#appearanceCore)" />
      <path d="M31.7 17.5a12.9 12.9 0 0 1-1.2 15.9" fill="none" stroke="#2a70d8" strokeWidth="1.4" strokeLinecap="round" opacity=".72" />
    </svg>
  );
}

function AwsCubeIdentityMark({ size = 31 }: { size?: number }) {
  return (
    <svg className="operator-identity-mark aws-cube-identity-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" shapeRendering="geometricPrecision">
      <defs>
        <linearGradient id="awsCubeTop" x1="8" y1="6" x2="40" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffb516" />
          <stop offset="1" stopColor="#f69b00" />
        </linearGradient>
        <linearGradient id="awsCubeLeft" x1="6" y1="16" x2="23" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffb413" />
          <stop offset="1" stopColor="#f5a000" />
        </linearGradient>
      </defs>
      <path d="M24 4.6 43 11.7 24 18.8 5 11.7 24 4.6Z" fill="url(#awsCubeTop)" />
      <path d="m5 15.2 17.2 6.4v21.8L5 36.8V15.2Z" fill="url(#awsCubeLeft)" />
      <path d="m25.8 21.6 17.2-6.4v21.6l-17.2 6.6V21.6Z" fill="#f6a000" />
    </svg>
  );
}

function ApiKeyIdentityMark({ size = 31 }: { size?: number }) {
  return (
    <svg className="operator-identity-mark api-key-identity-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" shapeRendering="geometricPrecision">
      <defs>
        <linearGradient id="apiKeyGold" x1="6" y1="42" x2="42" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffd51d" />
          <stop offset="1" stopColor="#ff9f0a" />
        </linearGradient>
        <mask id="apiKeyCutout">
          <rect width="48" height="48" fill="#fff" />
          <circle cx="34.5" cy="13.5" r="5.2" fill="#000" />
        </mask>
      </defs>
      <path d="M43.6 4.4a12.9 12.9 0 0 0-18.2 0 12.8 12.8 0 0 0-2.6 14.5L2.3 39.4A4.5 4.5 0 0 0 1 42.6V47h7.5l3.7-3.7h4.5v-4.5h4.5v-4.5h4.4l4.1-4.1A12.8 12.8 0 0 0 43.6 4.4Z" fill="url(#apiKeyGold)" mask="url(#apiKeyCutout)" />
    </svg>
  );
}

function ExecutionPowerIdentityMark({ stopped, size = 31 }: { stopped: boolean; size?: number }) {
  return (
    <svg className={`operator-identity-mark execution-power-identity-mark ${stopped ? 'stopped' : 'ready'}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" shapeRendering="geometricPrecision">
      <defs>
        <linearGradient id={stopped ? 'executionGreen' : 'executionRed'} x1="9" y1="7" x2="38" y2="42" gradientUnits="userSpaceOnUse">
          {stopped ? <><stop stopColor="#77d83e" /><stop offset="1" stopColor="#45bb30" /></> : <><stop stopColor="#ff5939" /><stop offset="1" stopColor="#ff3e3e" /></>}
        </linearGradient>
      </defs>
      <path d="M14.2 14.4a17.3 17.3 0 1 0 19.6 0" fill="none" stroke={`url(#${stopped ? 'executionGreen' : 'executionRed'})`} strokeWidth="7.1" strokeLinecap="round" />
      <path d="M24 4.5v18.2" fill="none" stroke={stopped ? '#349a38' : '#ff5737'} strokeWidth="7.1" strokeLinecap="round" />
    </svg>
  );
}

function CurrencyDollarIdentityMark({ size = 31 }: { size?: number }) {
  return (
    <svg className="operator-identity-mark currency-dollar-identity-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" shapeRendering="geometricPrecision">
      <defs>
        <linearGradient id="currencyGreen" x1="8" y1="7" x2="40" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7bd13d" />
          <stop offset="1" stopColor="#55b82c" />
        </linearGradient>
      </defs>
      <path d="M22 2h5v6.1c7.4.8 12.2 4 15.2 8.4l-8.4 5.1c-2-2.9-5-4.7-8.9-4.7-3.5 0-5.7 1.2-5.7 3.2 0 2.3 2.9 3.3 8.7 5 9.8 2.7 15 6.4 15 14.1 0 7.7-6 12.5-15.9 13.4V59h-5v-6.4C12.5 51.7 6.5 47.8 3 42.4l8.9-5.5c2.7 4 6.8 6.4 12 6.4 4.1 0 6.8-1.3 6.8-3.6 0-2.5-2.6-3.6-8.8-5.4C12.5 31.7 7 28.1 7 20.5 7 13.3 12.6 8.9 22 8V2Z" transform="translate(1 -6) scale(.86)" fill="url(#currencyGreen)" />
    </svg>
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

/* Owner identity: exact supplied concentric Control Room mark. */
const BRAND_MARK = (
  <img className="brand-mark control-ring-brand-mark" src="/arbitrage-control-room-mark.svg" alt="" aria-hidden="true" />
);

const TITLES: Record<Page, string> = {
  dashboard: 'Dashboard',
  'control-room': 'Control Room',
  account: 'Account',
  wallets: 'Account',
  markets: 'Markets',
  detail: 'Token Detail',
  loans: 'Borrow / Margin',
  execution: 'Account · Execution',
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
  notifications: 'Notifications',
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
      { id: 'dashboard', label: 'Dashboard', icon: <img className="snav-dashboard-mark" src="/dashboard-blocks.png" alt="" aria-hidden="true" /> },
      { id: 'account', label: 'Account', icon: <img className="snav-account-mark" src="/account-wallet.png" alt="" aria-hidden="true" />, match: ['wallets', 'execution', 'orders', 'positions', 'fills', 'pnl'] },
      { id: 'loans', label: 'Borrow', icon: <img className="snav-borrow-mark" src="/borrow-money-bag.png" alt="" aria-hidden="true" /> },
      { id: 'markets', label: 'Markets', icon: <img className="snav-markets-mark" src="/markets-chart.png" alt="" aria-hidden="true" /> },
      { id: 'detail', label: 'Token', icon: <img className="snav-token-mark" src="/token-diamonds.png" alt="" aria-hidden="true" /> },
    ],
  },
  {
    group: 'Engine',
    items: [
      { id: 'strategies', label: 'Basis', icon: <img className="snav-basis-mark" src="/basis-percent.png" alt="" aria-hidden="true" /> },
      { id: 'volume', label: 'Volume', icon: <img className="snav-volume-mark" src="/volume-bars.png" alt="" aria-hidden="true" /> },
      { id: 'opportunities', label: 'Opportunities', icon: <img className="snav-opportunities-mark" src="/opportunities-bulb.png" alt="" aria-hidden="true" /> },
    ],
  },
  {
    group: 'Control',
    items: [
      { id: 'control-room', label: 'Control Room', icon: <IconPulse size={19} /> },
      { id: 'risk', label: 'Risk', icon: <img className="snav-risk-mark" src="/risk-gauge.png" alt="" aria-hidden="true" /> },
      { id: 'system', label: 'Health', icon: <img className="snav-health-mark" src="/health-shield.png" alt="" aria-hidden="true" /> },
    ],
  },
  {
    group: 'Utility',
    items: [
      { id: 'ledger', label: 'Logs', icon: <img className="snav-log-mark" src="/log-mark.png" alt="" aria-hidden="true" /> },
      { id: 'news', label: 'News', icon: <img className="snav-news-mark" src="/news-mark.png" alt="" aria-hidden="true" /> },
      { id: 'calendar', label: 'Calendar', icon: <img className="snav-calendar-mark" src="/calendar-check.png" alt="" aria-hidden="true" /> },
      { id: 'notifications', label: 'Notifications', icon: <img className="snav-notification-mark" src={NOTIFICATION_MARK} alt="" aria-hidden="true" /> },
    ],
  },
];

// The integration candidate deliberately does not mount private account truth.
// This sheet is provenance only: it has no credential, session, mutation, or
// signed-read path and therefore cannot become green from legacy Binance state.
function AccountSheet() {
  return (
    <div className="ops-sheet ops-account-sheet account-sheet-v3">
      <OpsSheetHeader
        className="account-v3-head"
        icon={<PopupSourceMark tone="#778292"><ApiKeyIdentityMark size={26} /></PopupSourceMark>}
        title="Account Details"
        subtitle="Private account truth is outside this candidate"
        status="Not Configured"
        tone="warn"
      />
      <div className="ops-section-label"><span>Authority Boundary</span><em>Static provenance</em></div>
      <div className="ops-list ops-control-list">
        <OpsRow title="Private Account Truth" detail="No signed account adapter is mounted" value="NOT CONFIGURED" tone="warn" />
        <OpsRow title="Credentials" detail="Owner authorization and server-side configuration required" value="OWNER GATED" tone="idle" />
        <OpsRow title="Signed Reads" detail="Balances, orders, positions, loans, and sessions are unavailable" value="NOT MOUNTED" tone="idle" />
        <OpsRow title="Money Actions" detail="Orders, borrow, repay, transfer, withdrawal, and leverage mutation stay blocked" value="BLOCKED" tone="ok" />
      </div>
      <div className="ops-account-note">
        <IconShield size={15} />
        <span>This surface does not inspect credentials or imply private exchange connectivity.</span>
      </div>
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
  marketTruth?: MarketConsumerTruth;
}
type SearchTab = 'top' | 'crypto' | 'perps' | 'settings';

export type MarketConsumerTruth = Readonly<{
  label: 'CURRENT' | 'STALE LAST-KNOWN' | 'UNAVAILABLE' | 'LOADING';
  evidenceAtMs: number | null;
  evidenceAgeMs: number | null;
  factsAvailable: boolean;
  retained: boolean;
}>;

function validMarketTimestamp(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Translate canonical market-read liveness into the only presentation states
 * consumers may assert. A source timestamp cannot make rows current without a
 * successful read, and retained rows remain explicitly stale.
 */
export function projectMarketConsumerTruth(input: Readonly<{
  status: CompatibilityStateStatus;
  lastSuccessAtMs: number | null;
  sourceUpdatedAtMs: number | null;
  nowMs: number;
}>): MarketConsumerTruth {
  const lastSuccessAtMs = validMarketTimestamp(input.lastSuccessAtMs);
  if (input.status === 'LOADING') {
    return Object.freeze({
      label: 'LOADING',
      evidenceAtMs: null,
      evidenceAgeMs: null,
      factsAvailable: false,
      retained: false,
    });
  }
  if (input.status === 'UNAVAILABLE' || lastSuccessAtMs === null) {
    return Object.freeze({
      label: 'UNAVAILABLE',
      evidenceAtMs: null,
      evidenceAgeMs: null,
      factsAvailable: false,
      retained: false,
    });
  }

  const evidenceAtMs = validMarketTimestamp(input.sourceUpdatedAtMs) ?? lastSuccessAtMs;
  const evidenceAgeMs = Number.isFinite(input.nowMs) && input.nowMs >= evidenceAtMs
    ? input.nowMs - evidenceAtMs
    : null;
  const retained = input.status === 'STALE';
  return Object.freeze({
    label: retained ? 'STALE LAST-KNOWN' : 'CURRENT',
    evidenceAtMs,
    evidenceAgeMs,
    factsAvailable: true,
    retained,
  });
}

type PerpetualSearchMarket = Pick<
  MarketRow,
  'perpMark' | 'perpLast' | 'perpVolume24h' | 'perpChange24hPct' | 'fundingRate'
>;

const finiteSearchFact = (value: number | null | undefined): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

/**
 * Project only perpetual-owned evidence into a perpetual search result. Spot
 * price/change fields are deliberately absent from this boundary so a missing
 * futures fact cannot be made to look known by borrowing another instrument.
 */
export function projectPerpetualSearchFacts(market: PerpetualSearchMarket) {
  return {
    perpMark: finiteSearchFact(market.perpMark) ?? finiteSearchFact(market.perpLast),
    volume: finiteSearchFact(market.perpVolume24h),
    changePct: finiteSearchFact(market.perpChange24hPct),
    fundingRate: finiteSearchFact(market.fundingRate),
  };
}

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
    { label: 'Execution', hint: 'Account · canonical posture', page: 'execution', keywords: 'execution posture tickets legs reconciliation controls' },
    { label: 'Orders', hint: 'Execution · open & history', page: 'orders', keywords: 'orders open history cancel execution' },
    { label: 'Positions', hint: 'Execution · holdings', page: 'positions', keywords: 'positions holdings unrealized execution' },
    { label: 'Fills', hint: 'Execution · executions', page: 'fills', keywords: 'fills executions trades execution' },
    { label: 'PnL', hint: 'Execution · profit & loss', page: 'pnl', keywords: 'pnl profit loss equity daily execution' },
    { label: 'Account & Security', hint: 'Profile · linked exchanges · devices', page: 'account', kind: 'setting', keywords: 'account security profile linked exchanges devices sessions logout sign out coinbase' },
    { label: 'Appearance', hint: 'Theme · Accent · Scale · Motion', page: 'account', kind: 'setting', keywords: 'appearance theme dark light accent color scale zoom motion reduced animation display account settings' },
    { label: 'Display Currency', hint: 'USD · INR · EUR · account values', page: 'account', kind: 'setting', keywords: 'currency fiat usd inr eur gbp jpy display money account settings' },
    { label: 'Basis Units', hint: 'Percent · Basis Points · Decimal', page: 'account', kind: 'setting', keywords: 'basis unit bps percent percentage decimal ratio account settings' },
    { label: 'Market Refresh', hint: 'Polling speed · manual refresh', page: 'system', kind: 'setting', keywords: 'market refresh polling speed custom refresh data system settings' },
    { label: 'Notifications', hint: 'Curated interventions · routing', page: 'notifications', kind: 'setting', keywords: 'notifications alerts bot execution aws telegram whatsapp routing preferences' },
    { label: 'Borrow Guard', hint: 'Loan guardrails · LTV monitor', page: 'loans', kind: 'setting', keywords: 'borrow guard loan ltv block loans margin collateral settings' },
    { label: 'API Keys', hint: 'Linked exchange permissions', page: 'account', kind: 'setting', keywords: 'api keys hmac read only linked exchange permissions binance account settings' },
  );
  return out;
}
function SidebarSearch({ placement = 'rail' }: { placement?: 'rail' | 'topbar' }) {
  const {
    setPage,
    setPaletteOpen,
    markets,
    marketStatus,
    marketsLastSuccessAtMs,
    marketsUpdatedAt,
    openDetail,
  } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<SearchTab>('top');
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const isTopbar = placement === 'topbar';
  const marketTruth = useMemo(() => projectMarketConsumerTruth({
    status: marketStatus,
    lastSuccessAtMs: marketsLastSuccessAtMs,
    sourceUpdatedAtMs: marketsUpdatedAt,
    nowMs: Date.now(),
  }), [marketStatus, marketsLastSuccessAtMs, marketsUpdatedAt]);
  // Global index: nav/settings/actions PLUS every tradable token, so typing any
  // letter finds tokens across the whole app (not just the menu).
  const index = useMemo(() => {
    const pages = buildIndex();
    const tokens: SearchEntry[] = markets.filter((m) => m.hasSpot || m.spot !== null).map((m) => ({
      label: m.base,
      hint: `${m.symbol} · Crypto`,
      symbol: m.symbol,
      base: m.base,
      spot: marketTruth.factsAvailable ? m.spot : null,
      volume: marketTruth.factsAvailable ? m.quoteVolume24h : null,
      changePct: marketTruth.factsAvailable ? m.change24hPct : null,
      kind: 'token' as const,
      marketTruth,
      keywords: `${m.base} ${m.symbol} crypto spot token asset coin`.toLowerCase(),
    }));
    const perps: SearchEntry[] = markets.filter((m) => m.hasPerp || m.perpMark !== null).map((m) => {
      const facts = marketTruth.factsAvailable
        ? projectPerpetualSearchFacts(m)
        : { perpMark: null, volume: null, changePct: null, fundingRate: null };
      return {
        label: `${m.base} Perpetual`,
        hint: `${m.symbol} · Perpetual`,
        symbol: m.symbol,
        base: m.base,
        ...facts,
        kind: 'perp' as const,
        marketTruth,
        keywords: `${m.base} ${m.symbol} perp perpetual futures funding`.toLowerCase(),
      };
    });
    return [...pages, ...tokens, ...perps];
  }, [markets, marketTruth]);
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
    if (e.symbol && e.marketTruth && !e.marketTruth.factsAvailable) return;
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
    const marketTruthNote = r.marketTruth
      ? `${r.marketTruth.label}${r.marketTruth.evidenceAtMs === null ? '' : ` · Updated ${timeAgo(r.marketTruth.evidenceAtMs)}`}`
      : null;
    return (
      <button
        key={`${r.kind}-${r.label}-${r.symbol ?? r.page ?? i}`}
        className={`ssr-row ${i === sel ? 'sel' : ''} ${isMarket ? 'market' : 'command'}`}
        disabled={Boolean(isMarket && r.marketTruth && !r.marketTruth.factsAvailable)}
        onMouseEnter={() => setSel(i)}
        onMouseDown={(e) => { e.preventDefault(); go(r); }}
      >
        {isMarket ? (
          <>
            <TokenIcon symbol={r.symbol ?? r.base ?? r.label} size={34} />
            <span className="ssr-asset">
              <span className="ssr-label">{r.label}</span>
              <span className="ssr-hint">
                {r.kind === 'perp' ? 'INTX' : r.hint.replace(' · Crypto', '')}
                {marketTruthNote ? ` · ${marketTruthNote}` : ''}
              </span>
            </span>
            <span className="ssr-mid">
              <b>{r.kind === 'perp' && r.volume == null ? 'UNKNOWN vol' : `${compactMoney(r.volume)} vol`}</b>
              <small>{r.kind === 'perp'
                ? r.fundingRate == null
                  ? 'UNKNOWN funding'
                  : `${searchPct(r.fundingRate * 100, 4).replace('↗ ', '').replace('↘ ', '')} funding`
                : r.symbol}</small>
            </span>
            <span className="ssr-price">
              <b>{r.kind === 'perp' && r.perpMark == null ? 'UNKNOWN' : searchPrice(r.kind === 'perp' ? r.perpMark : r.spot)}</b>
              <small className={change === null ? undefined : change < 0 ? 'neg' : 'pos'}>
                {r.kind === 'perp' && change === null ? 'UNKNOWN' : searchPct(change)}
              </small>
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
  const { page, setPage } = useStore();

  return (
    <aside className="snav">
      <nav className="snav-nav">
        {NAV.map((g, i) => (
          <div key={i} className="snav-group" data-nav-group={g.group?.toLowerCase() ?? 'utility'}>
            {g.group && <div className="snav-group-title">{g.group}</div>}
            {g.items.map((n) => (
              <button
                key={n.id}
                className={`snav-item ${page === n.id || n.match?.includes(page) ? 'active' : ''}`}
                data-nav-id={n.id}
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
    { key: 'critical', label: 'Needs attention', sub: 'Failures, blocks, and emergency controls' },
    { key: 'execution', label: 'Execution outcomes', sub: 'Orders, fills, loans, and risk decisions' },
    { key: 'health', label: 'Bot health', sub: 'Engine, stream, and control transitions' },
    { key: 'infrastructure', label: 'Infrastructure', sub: 'Owner-gated external-infrastructure notices' },
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
function msLabel(v: number | null | undefined): string {
  return v === null || v === undefined || !isFinite(v) ? '—' : `${Math.round(v)} ms`;
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

type Sev = 'action' | 'invest' | 'pass';

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
  className,
  icon,
  title,
  subtitle,
  status,
  action,
  tone = 'idle',
}: {
  className?: string;
  icon: ReactNode;
  title: string;
  subtitle: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
  tone?: OpsTone;
}) {
  return (
    <header className={`ops-sheet-head${className ? ` ${className}` : ''}`}>
      <span className="ops-sheet-icon">{icon}</span>
      <span className="ops-sheet-title"><b>{title}</b><em>{subtitle}</em></span>
      {action !== undefined
        ? (
          <span className="ops-sheet-trailing">
            {status !== undefined && <span className={`ops-sheet-status ${tone}`}><i />{status}</span>}
            <span className="ops-sheet-action">{action}</span>
          </span>
        )
        : status !== undefined && <span className={`ops-sheet-status ${tone}`}><i />{status}</span>}
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

type MK = 'clock' | 'shell' | 'apikey' | 'advisor' | 'notif' | 'power' | 'currency' | 'basisu' | 'appearance' | 'account';
const TOPBAR_KEYS: MK[] = ['clock', 'shell', 'apikey', 'advisor', 'notif', 'power', 'currency', 'basisu', 'appearance', 'account'];
const MENU_W: Record<MK, number> = {
  clock: 400,
  shell: 400,
  apikey: 400,
  advisor: 400,
  notif: 400,
  power: 400,
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
function PrivateAdapterSheet() {
  return (
    <div className="ops-sheet ops-key-sheet api-key-sheet-v2">
      <OpsSheetHeader
        icon={<PopupSourceMark tone="#ffb000" brand><ApiKeyIdentityMark size={40} /></PopupSourceMark>}
        title="Private Exchange Adapter"
        subtitle="Credential-bearing access is outside this candidate"
        status="Owner Gated"
        tone="warn"
      />
      <div className="ops-section-label"><span>Authority Boundary</span><em>No Credential Discovery</em></div>
      <div className="ops-list ops-control-list" aria-label="Private exchange adapter posture">
        <OpsRow title="Private Adapter" detail="A separately accepted owner must supply the audited adapter." value="NOT CONFIGURED" tone="warn" />
        <OpsRow title="Credentials" detail="The browser and assembled runtime do not discover or load exchange secrets." value="NOT LOADED" tone="idle" />
        <OpsRow title="Signed Reads" detail="Account, wallet, order, loan, and fill reads are not mounted." value="BLOCKED" tone="bad" />
        <OpsRow title="Money Actions" detail="Test orders, live orders, borrow, repay, transfer, and withdrawal remain absent." value="BLOCKED" tone="bad" />
      </div>
      <div className="aws-pop-notice neutral"><IconShield size={14} /><span>OWNER_GATED · Private access requires separate owner authorization and independent verification.</span></div>
    </div>
  );
}

function AwsOwnerGatedSheet() {
  return (
    <div className="ops-sheet ops-aws-sheet aws-control-sheet">
      <OpsSheetHeader
        icon={<span className="aws-popup-mark" aria-hidden="true"><AwsCubeIdentityMark size={42} /></span>}
        title="AWS Runner Control"
        subtitle="External infrastructure activation is outside this candidate"
        status={AWS_CONTROL_POSTURE.authority.replace('_', ' ')}
        tone="warn"
      />
      <div className="ops-section-label"><span>Infrastructure Boundary</span><em>Static Provenance</em></div>
      <div className="ops-list ops-control-list" aria-label="AWS infrastructure posture">
        <OpsRow title="Authority" detail={AWS_CONTROL_POSTURE.detail} value={AWS_CONTROL_POSTURE.authority} tone="warn" />
        <OpsRow title="Configuration" detail="No AWS target, identity, credential, or session is loaded." value={AWS_CONTROL_POSTURE.configuration} tone="idle" />
        <OpsRow title="Runtime Port" detail="No infrastructure control service is composed into the product runtime." value={AWS_CONTROL_POSTURE.runtime} tone="bad" />
      </div>
      <div className="aws-pop-notice neutral"><IconShield size={14} /><span>{AWS_CONTROL_POSTURE.boundary}</span></div>
    </div>
  );
}

function SharedTopBar() {
  const {
    state, connected, page, prefs, updatePref, setPage,
    fxTruth, fxBusy: currencyBusy, refreshFx: refreshCurrencyFx,
  } = useStore();
  const { binding: productBinding } = useProductControlRoomContext();
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
  const [seen, setSeen] = useState(() => Number(localStorage.getItem('cosmos-notif-seen') || 0));
  const [notifTab, setNotifTab] = useState<NotifTab>('all');
  const [notifLiveEvents, setNotifLiveEvents] = useState<LedgerEvent[]>([]);
  const [notificationFeedState, setNotificationFeedState] = useState<{
    status: 'LOADING' | 'CURRENT' | 'STALE' | 'UNAVAILABLE';
    lastSuccessAt: number | null;
    error: string | null;
  }>({ status: 'LOADING', lastSuccessAt: null, error: null });
  const notifLiveCursor = useRef(0);
  const [currencyNotional, setCurrencyNotional] = useState(1000);
  const [basisSamplePct, setBasisSamplePct] = useState(0.042);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 250); return () => clearInterval(t); }, []);
  useEffect(() => {
    let bootstrapped = false;
    const relevantKinds = ['risk_decision', 'error_event', 'user_stream', 'ws.closed', 'ws.open', 'connection_alert', 'connection_recovered', 'manual_action', 'order_intent', 'order_request', 'order_response', 'order_outcome_unknown', 'cancel_outcome_unknown', 'fill_event', 'loan_request', 'loan_response', 'binance.connected', 'engine.start', 'engine_started', 'basis.engine_started', 'config_change', 'aws_notification'];
    const readEventRows = async (url: string, signal: AbortSignal): Promise<LedgerEvent[]> => {
      const rows = await fetchJson<LedgerEvent[]>(url, { cache: 'no-store', signal }, 10_000);
      if (!Array.isArray(rows)) throw new Error('events payload is invalid');
      return rows;
    };
    const notificationPoll = createSettledPoll<LedgerEvent[]>({
      intervalMs: 5_000,
      timeoutMs: 15_000,
      request: async (signal) => {
        let items: LedgerEvent[] = [];
        if (!bootstrapped) {
          const head = await readEventRows('/api/events?limit=1', signal);
          const highWater = head[0]?.id ?? 0;
          const since = Date.now() - 24 * 60 * 60_000;
          const before = highWater > 0 ? `&beforeId=${highWater + 1}` : '';
          const bootstrapReads = await Promise.allSettled(relevantKinds.map((kind) => readEventRows(
            `/api/events?since=${since}&kind=${encodeURIComponent(kind)}&limit=2000${before}`,
            signal,
          )));
          const bootstrapFailure = bootstrapReads.find((result) => result.status === 'rejected');
          if (bootstrapFailure?.status === 'rejected') throw bootstrapFailure.reason;
          items = bootstrapReads.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
          notifLiveCursor.current = Math.max(notifLiveCursor.current, highWater);
          bootstrapped = true;
        } else {
          let afterId = notifLiveCursor.current;
          for (let page = 0; page < 5; page += 1) {
            const rows = await readEventRows(`/api/events?afterId=${afterId}&limit=2000`, signal);
            items.push(...rows);
            if (rows.length < 2_000) break;
            afterId = Math.max(afterId, ...rows.map((item) => item.id));
          }
        }
        return items;
      },
      onSuccess: (items) => {
        if (items.length > 0) {
          notifLiveCursor.current = Math.max(notifLiveCursor.current, ...items.map((item) => item.id));
          setNotifLiveEvents((current) => {
            const merged = new Map<number, LedgerEvent>();
            for (const item of current) merged.set(item.id, item);
            for (const item of items) merged.set(item.id, item);
            return [...merged.values()].sort((a, b) => b.ts - a.ts || b.id - a.id).slice(0, 2_000);
          });
        }
        setNotificationFeedState({ status: 'CURRENT', lastSuccessAt: Date.now(), error: null });
      },
      onError: (error) => {
        setNotificationFeedState((current) => ({
          status: current.lastSuccessAt === null ? 'UNAVAILABLE' : 'STALE',
          lastSuccessAt: current.lastSuccessAt,
          error: apiErrorMessage(error, 'Notification feed unavailable'),
        }));
      },
    });
    notificationPoll.start();
    return notificationPoll.stop;
  }, []);

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

  const cfg = state?.config;
  const accountProfile = cfg?.profile ?? { name: '', avatar: null };
  const accountAvatar = accountProfile.avatar ?? DEFAULT_PROFILE_LOGO;
  const accountTone = 'off';
  const accountSub = 'OWNER GATED · NOT CONFIGURED';
  const events = state?.events ?? [];
  const zone = ZONES.find((z) => z.id === prefs.clockZone) ?? ZONES[0];
  const activeClock = clockParts(zone.id, now);
  const activeClockOffset = clockOffset(zone.id, now);
  const cur = CURRENCIES[prefs.currency] ? prefs.currency : 'USD';
  const curInfo = CURRENCIES[cur] ?? CURRENCIES.USD;
  const curSymbol = curInfo.symbol.trim() || cur;
  const curFx = resolveFxRate(fxTruth, cur, now.getTime());
  const curRate = curFx.rate;
  const curTone = curFx.status === 'CURRENT' ? 'ok' : curFx.status === 'LOADING' ? 'warn' : 'bad';
  const curRateText = cur === 'USD'
    ? '1.0000'
    : curRate
      ? curRate.toLocaleString('en-US', { maximumFractionDigits: curRate >= 100 ? 2 : 4 })
      : curFx.status === 'STALE' ? 'Stale' : curFx.status === 'UNAVAILABLE' ? 'Unavailable' : 'Loading';
  const currencyRateText = (code: string) => {
    if (code === 'USD') return '1.0000';
    const resolved = resolveFxRate(fxTruth, code, now.getTime());
    const r = resolved.rate;
    if (!r) return resolved.status === 'STALE' ? 'STALE' : resolved.status === 'UNAVAILABLE' ? 'OFF' : 'FX';
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
  const basisIsBps = prefs.basisUnit === 'bps';
  const basisIsDecimal = prefs.basisUnit === 'decimal';
  const formatBasisPct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(Math.abs(value) < 0.1 ? 3 : 2)}%`;
  const formatBasisBp = (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(Math.abs(value * 100) < 10 ? 1 : 0)}bp`;
  const formatBasisDecimal = (value: number) => `${value >= 0 ? '+' : ''}${(value / 100).toFixed(Math.abs(value / 100) >= 0.01 ? 4 : 5)}`;
  const basisSamples = [
    { label: '1bp', value: 0.01 },
    { label: '4.2bp', value: 0.042 },
    { label: '10bp', value: 0.1 },
    { label: '-57bp', value: -0.57 },
  ];
  const basisPreview = basisIsBps
    ? formatBasisBp(basisSamplePct).replace('bp', ' bps')
    : basisIsDecimal
      ? formatBasisDecimal(basisSamplePct)
      : formatBasisPct(basisSamplePct);
  const basisCode = basisIsBps ? 'BPS' : basisIsDecimal ? 'DEC' : 'PCT';
  const basisUnitLabel = basisIsBps ? 'Basis Points' : basisIsDecimal ? 'Decimal Rate' : 'Percent';
  const activeAccent = ACCENTS[prefs.accent] ?? ACCENTS.b;
  const appearanceZoom = Math.round((prefs.zoom || 1) * 100);
  const al = prefs.alerts; const alertsOn = Object.values(al).filter(Boolean).length;
  const compactSource = notifLiveEvents.length ? notifLiveEvents : events;
  // Collapse state transitions before applying category preferences. Otherwise
  // disabling routine health notices drops a recovery while leaving its older
  // critical outage visible as if it were still active.
  const compactNotifications = groupNotifications(
    curateNotifications(compactSource),
    prefs.clockZone && prefs.clockZone !== 'local' ? prefs.clockZone : undefined,
  ).filter((item) => notificationEnabled(item, al));
  const unread = compactNotifications.filter((item) => item.id > seen).length;
  const productSnapshot = productBinding.snapshot;
  const killSwitchControl = productSnapshot?.controls.find((control) => control.backendCommandId === 'SET_KILL_SWITCH') ?? null;
  const intakeControl = productSnapshot?.controls.find((control) => control.backendCommandId === 'SET_INTAKE_PAUSED') ?? null;
  const safeModeControl = productSnapshot?.controls.find((control) => control.backendCommandId === 'SET_SAFE_MODE') ?? null;
  const killSwitchState = killSwitchControl?.currentEffectiveValue ?? 'UNKNOWN';
  const killSwitchClearProven = Boolean(
    productSnapshot
      && productBinding.continuity === 'PROVEN'
      && killSwitchControl?.wiringState === 'WIRED_LIVE'
      && killSwitchState.trim().toUpperCase() === 'CLEAR',
  );
  const convergenceKillOn = !killSwitchClearProven;
  const intakeOpen = intakeControl?.currentEffectiveValue.trim().toUpperCase() === 'OPEN';
  const intakeTone = productSnapshot && productBinding.continuity === 'PROVEN'
    && intakeControl?.wiringState === 'WIRED_LIVE' && intakeOpen ? 'ok' : 'warn';
  const convergenceModeLabel = productSnapshot?.ownerView.effectiveMode.replaceAll('_', ' ') ?? 'Unavailable';
  // The canonical Product contract deliberately withholds trade readiness.
  // Execution identity therefore remains non-green regardless of machine health.
  const convergenceTone = 'warn';
  const convergenceSub = productBinding.error
    ?? productSnapshot?.ownerView.topRootBlocker
    ?? (productSnapshot
      ? 'Canonical product supervisor truth. Live execution remains mechanically unavailable.'
      : 'Canonical product supervisor state is unavailable. Controls fail closed.');
  const markNotificationsRead = () => {
    if (!compactNotifications.length) return;
    const latest = Math.max(...compactNotifications.map((item) => item.id));
    setSeen(latest);
    localStorage.setItem('cosmos-notif-seen', String(latest));
  };
  const openNotificationCenter = () => {
    closeMenu();
    setPage('notifications');
  };
  const alertRows: { key: NotificationRuleKey; label: string; sub: string }[] = [
    { key: 'critical', label: 'Needs Attention', sub: 'Failures, blocked actions, and emergency controls' },
    { key: 'execution', label: 'Execution Outcomes', sub: 'Orders, fills, loans, and risk decisions' },
    { key: 'health', label: 'Bot Health', sub: 'Engine, stream, connection, and control transitions' },
    { key: 'infrastructure', label: 'Infrastructure', sub: 'Owner-gated external-infrastructure notices' },
  ];
  const notifTimeZone = prefs.clockZone || 'UTC';
  const notifStamp = (ts: number) => new Intl.DateTimeFormat('en-US', {
    timeZone: notifTimeZone,
    month: 'short',
    day: 'numeric',
  }).format(new Date(ts)).toUpperCase();
  const notifTabs: { id: typeof notifTab; label: string; code: string }[] = [
    { id: 'all', label: 'All Alerts', code: 'All' },
    { id: 'critical', label: 'Attention', code: 'Attention' },
    { id: 'execution', label: 'Execution', code: 'Execution' },
    { id: 'health', label: 'Bot Health', code: 'Health' },
    { id: 'infrastructure', label: 'Infrastructure', code: 'Infra' },
    { id: 'prefs', label: 'Preferences', code: 'Prefs' },
  ];
  const notifToneFor = (category: NotificationRuleKey) => category === 'critical'
    ? 'critical'
    : category === 'execution'
      ? 'account'
      : category === 'infrastructure'
        ? 'news'
        : 'logs';
  const notifIcon = (tone: string, size = 17) => {
    if (tone === 'critical') return <LucideNotifCritical size={size} strokeWidth={1.8} />;
    if (tone === 'opportunity' || tone === 'opportunities') return <LucideNotifOpportunity size={size} strokeWidth={1.8} />;
    if (tone === 'account') return <LucideNotifAccount size={size} strokeWidth={1.8} />;
    if (tone === 'news') return <IconNewspaper size={size} />;
    return <LucideNotifLog size={size} strokeWidth={1.8} />;
  };
  const filterNotifEvents = (tab: NotifTab) => compactNotifications.filter((item) => {
    if (tab === 'all') return true;
    if (tab === 'prefs') return false;
    return item.category === tab;
  });
  const filteredNotifEvents = filterNotifEvents(notifTab);
  const compactNotifEvents = compactNotifications;
  const compactNotifGroups = compactNotifications.slice(0, 7);
  const notificationFeedStatus = notificationFeedState.status === 'CURRENT'
    ? 'Current'
    : notificationFeedState.status === 'STALE'
      ? 'Stale'
      : notificationFeedState.status === 'UNAVAILABLE'
        ? 'Unavailable'
        : 'Loading';
  const notificationFeedTone: OpsTone = notificationFeedState.status === 'CURRENT'
    ? unread ? 'accent' : 'ok'
    : notificationFeedState.status === 'UNAVAILABLE'
      ? 'bad'
      : notificationFeedState.status === 'STALE'
        ? 'warn'
        : 'idle';
  const notificationTriggerTruth = notificationFeedState.status === 'CURRENT'
    ? unread ? `${unread} unread` : 'no unread events'
    : notificationFeedState.status === 'STALE'
      ? unread ? `${unread} last-known unread` : 'last-known feed'
      : notificationFeedState.status === 'UNAVAILABLE'
        ? 'feed unavailable'
        : 'feed loading';
  const notificationFeedDetail = notificationFeedState.status === 'CURRENT'
    ? `Updated ${timeAgo(notificationFeedState.lastSuccessAt ?? Date.now())}`
    : notificationFeedState.status === 'LOADING'
      ? 'Loading the bounded notification history.'
      : notificationFeedState.error ?? 'Notification feed unavailable';
  const notifTone = compactNotifications.some((item) => item.severity === 'critical') ? 'hot' : unread > 0 ? 'live' : compactNotifications.length > 0 ? 'armed' : alertsOn > 0 ? 'armed' : 'idle';
  const advisorOverallPresentation = productSnapshot && productBinding.continuity === 'PROVEN'
    ? productSnapshot.canonicalCockpit.watchmanOverall
    : { status: 'outage' as const, label: 'Supervisor Unavailable' };
  const advisorMarketFeedReadiness = productSnapshot && productBinding.continuity === 'PROVEN'
    ? productSnapshot.canonicalCockpit.marketFeedReadiness
    : {
      proven: false,
      label: 'Market Feed Readiness Unproven' as const,
      detail: 'Canonical product supervisor snapshot is unavailable.',
    };
  const advRaw: ({ sev: Sev; name: string; detail: string; page?: Page } | null)[] = [
    !productSnapshot
      ? { sev: 'action', name: 'Product supervisor unavailable', detail: 'Canonical control truth is unavailable; the cockpit remains fail-closed.', page: 'control-room' }
      : null,
    productSnapshot && productBinding.continuity !== 'PROVEN'
      ? { sev: 'action', name: 'Supervisor continuity unproven', detail: `Material continuity is ${productBinding.continuity}; last-known state cannot authorize a green posture.`, page: 'control-room' }
      : null,
    productSnapshot && productBinding.continuity === 'PROVEN'
      ? advisorOverallPresentation.status === 'operational'
        ? { sev: 'pass', name: 'Canonical operating posture', detail: `${advisorOverallPresentation.label} · ${productSnapshot.truthLabel} · revision ${productSnapshot.revision}.` }
        : advisorOverallPresentation.status === 'outage'
          ? { sev: 'action', name: 'Canonical operating posture blocked', detail: productSnapshot.ownerView.topRootBlocker ?? `${advisorOverallPresentation.label} · effective mode ${productSnapshot.ownerView.effectiveMode}.`, page: 'control-room' }
          : { sev: 'invest', name: 'Canonical operating posture limited', detail: `${advisorOverallPresentation.label} · effective mode ${productSnapshot.ownerView.effectiveMode}; non-live capability cannot authorize a green posture.`, page: 'control-room' }
      : null,
    killSwitchClearProven
      ? { sev: 'pass', name: 'Kill switch truth proven', detail: 'Canonical owner is wired live and effective posture is CLEAR.' }
      : { sev: 'invest', name: 'Kill switch fail-closed', detail: killSwitchControl?.disabledReason ?? killSwitchControl?.wiringState ?? 'Canonical kill-switch truth is unavailable.', page: 'control-room' },
    !connected ? { sev: 'invest', name: 'Cockpit socket offline', detail: 'Reconnecting.', page: 'system' } : null,
    advisorMarketFeedReadiness.proven
      ? { sev: 'pass', name: advisorMarketFeedReadiness.label, detail: advisorMarketFeedReadiness.detail }
      : { sev: 'invest', name: advisorMarketFeedReadiness.label, detail: advisorMarketFeedReadiness.detail, page: 'system' },
    { sev: 'pass', name: 'Live execution blocked', detail: 'LIVE_EXECUTION_NOT_IMPLEMENTED; no signed, test-order, or money-moving port is mounted.' },
    { sev: 'pass', name: 'Private adapter owner-gated', detail: 'Private exchange reads and credentials are NOT_CONFIGURED in this candidate.' },
  ];
  const advChecks = advRaw.filter(Boolean) as { sev: Sev; name: string; detail: string; page?: Page }[];
  const advA = advChecks.filter((c) => c.sev === 'action'); const advI = advChecks.filter((c) => c.sev === 'invest'); const advP = advChecks.filter((c) => c.sev === 'pass');
  const advAtt = [...advA, ...advI];
  const advTone = advA.length || advisorOverallPresentation.status === 'outage'
    ? 'bad'
    : advI.length || advisorOverallPresentation.status !== 'operational'
      ? 'warn'
      : 'ok';
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

  const keysBody = () => <PrivateAdapterSheet />;

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
        return <AwsOwnerGatedSheet />;
      case 'apikey': return keysBody();
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
              sub={`${compactNotifications.length} curated · ${alertsOn} rules`}
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
                  const tone = notifToneFor(e.category);
                  const rightLabel = e.needsAction ? 'Action' : e.category === 'execution' ? 'Execution' : e.category === 'infrastructure' ? 'Infra' : 'Bot';
                  return (
                  <button key={e.id} className={`ntfx-event ${tone}`} type="button" title={e.detail} aria-label={e.title} onClick={openNotificationCenter}>
                    <span className={`ntfx-row-icon ${tone}`}>{notifIcon(tone, 16)}</span>
                    <span className="ntfx-copy">
                      <strong>{e.title}</strong>
                      <small>{e.detail}</small>
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
          <div className="modex-pop warn">
            <TopPanelHeader
              className="modex-head"
              logo={<ExecutionPowerIdentityMark stopped size={31} />}
              title="Legacy Bot Controls"
              sub="Retired; canonical Product supervisor truth owns this surface."
              status="Blocked"
            />
            <div className="ops-empty-state"><IconShield size={18} /><b>No legacy money controls are mounted.</b></div>
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
            <em className={unread ? 'bad' : compactNotifications.length ? 'ok' : 'idle'}>{unread ? `${unread} New` : `${compactNotifications.length} Curated`}</em>
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
                return (
                  <button key={e.id} className="topux-row button" type="button" title={e.detail} onClick={() => { setActive(null); setPage('notifications'); }}>
                    <span>
                      <b>{e.title}</b>
                      <small>{e.detail}</small>
                    </span>
                    <em>{timeAgo(e.ts)}</em>
                  </button>
                );
              })}
            </div>
          )}
          <button className="topux-action" type="button" onClick={() => { setActive(null); setPage('notifications'); }}>
            <IconBell size={14} /> Open Notification Center
          </button>
        </div>
      );
    }

    if (k === 'power') {
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
    const statusTone = (tone: string): OpsTone => tone === 'ok' || tone === 'good'
      ? 'ok'
      : tone === 'bad'
        ? 'bad'
        : tone === 'warn'
          ? 'warn'
          : 'idle';
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
        return <AwsOwnerGatedSheet />;

      case 'apikey':
        return <PrivateAdapterSheet />;

      case 'advisor': {
        return (
          <div className="ops-sheet ops-advisor-sheet">
            <OpsSheetHeader
              icon={<PopupSourceMark tone="#24c85a" brand><img className="trust-advisor-source-image" src={TRUST_ADVISOR_MARK} alt="" /></PopupSourceMark>}
              title="Trust Advisor"
              subtitle={`${advChecks.length} canonical safety checks`}
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
            <div className="ops-section-label"><span>All Checks</span><em>{advChecks.length} Current</em></div>
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
          </div>
        );
      }

      case 'notif':
        return (
          <div className="ops-sheet ops-notification-sheet">
            <OpsSheetHeader
              icon={<PopupSourceMark tone="#f0a400" brand><img className="notification-source-image" src={NOTIFICATION_MARK} alt="" /></PopupSourceMark>}
              title="Notifications"
              subtitle="Interventions, state changes, and routed alerts"
              status={notificationFeedState.status === 'CURRENT' ? unread ? `${unread} new` : compactNotifications.length ? 'Read' : 'Clear' : notificationFeedStatus}
              tone={notificationFeedTone}
            />
            <div className="ops-inline-tools" aria-label="Notification actions">
              <span><b>Recent Alerts</b><em>{notificationFeedState.status === 'CURRENT' ? unread ? `${unread} Unread` : 'Up To Date' : notificationFeedStatus}</em></span>
              <button type="button" onClick={markNotificationsRead} disabled={!unread}>Mark Read</button>
              <button type="button" onClick={openNotificationCenter}><IconMaximize size={13} /> Open Center</button>
            </div>
            <div className="ops-list ops-notification-list">
              {compactNotifGroups.length ? compactNotifGroups.map((item) => (
                <OpsRow
                  key={item.id}
                  icon={notifIcon(item.category, 15)}
                  title={item.title}
                  detail={item.count > 1 ? `${item.detail} · ${item.count} grouped` : item.detail}
                  value={timeAgo(item.ts)}
                  tone={item.severity === 'critical' ? 'bad' : item.severity === 'resolved' ? 'ok' : 'idle'}
                  onClick={openNotificationCenter}
                />
              )) : notificationFeedState.status !== 'CURRENT' ? (
                <OpsRow
                  icon={<IconBell size={15} />}
                  title={notificationFeedState.status === 'LOADING' ? 'Feed Loading' : notificationFeedState.status === 'STALE' ? 'Last-Known Feed' : 'Notification Feed Unavailable'}
                  detail={notificationFeedDetail}
                  value={notificationFeedStatus}
                  tone={notificationFeedTone}
                />
              ) : (
                <OpsRow
                  icon={<IconBell size={15} />}
                  title="Inbox Clear"
                  detail="Only owner-relevant alerts appear here. Full telemetry stays in Logs."
                  value="Clear"
                  tone="ok"
                />
              )}
            </div>
          </div>
        );

      case 'power':
        return (
          <div className={`ops-sheet ops-bot-sheet ${convergenceTone}`}>
            <OpsSheetHeader
              icon={<PopupSourceMark tone={convergenceKillOn ? '#ff493b' : '#55c937'} brand><ExecutionPowerIdentityMark stopped={convergenceKillOn} size={40} /></PopupSourceMark>}
              title="Execution Control"
              subtitle={convergenceSub}
              status={convergenceModeLabel}
              tone={statusTone(convergenceTone)}
              action={(
                <button
                  className="ops-execution-action"
                  type="button"
                  onClick={() => {
                    closeMenu();
                    setPage('control-room');
                  }}
                  aria-label="Open Control Room"
                >
                  <ExecutionPowerIdentityMark stopped={convergenceKillOn} size={15} />
                  <span>Open Room</span>
                </button>
              )}
            />
            <div className="ops-section-label"><span>Canonical Product Registry</span><em>{productSnapshot ? `Revision ${productSnapshot.revision}` : 'Unavailable'}</em></div>
            <div className="ops-list ops-control-list" aria-label="Canonical product controls">
              <OpsRow
                title="Operator Authority"
                detail={safeModeControl?.disabledReason ?? 'Desired and effective mode come from the product supervisor.'}
                value={productSnapshot?.ownerView.effectiveMode.replaceAll('_', ' ') ?? 'UNKNOWN'}
                tone={productSnapshot?.ownerView.effectiveMode === 'BLOCKED' || !productSnapshot ? 'warn' : 'idle'}
              />
              <OpsRow title="Strategy Intake" detail={intakeControl?.disabledReason ?? intakeControl?.wiringState ?? 'Canonical state unavailable.'} value={intakeControl?.currentEffectiveValue ?? 'UNKNOWN'} tone={intakeTone} />
              <OpsRow title="Kill Switch" detail={killSwitchControl?.disabledReason ?? killSwitchControl?.wiringState ?? 'Canonical state unavailable.'} value={killSwitchState} tone={convergenceKillOn ? 'warn' : 'ok'} />
              <OpsRow title="Live Execution" detail="No signed, test-order, private, or money-moving port exists in this slice." value="Blocked" tone="bad" />
              <OpsRow title="Supervisor Continuity" detail={productSnapshot ? `${productSnapshot.truthLabel} · ${productSnapshot.ownerView.machineReady} Machine Ready` : 'Supervisor unavailable'} value={productBinding.continuity} tone={productSnapshot && productBinding.continuity === 'PROVEN' ? 'ok' : 'warn'} />
            </div>
          </div>
        );

      case 'currency':
        return (
          <div className="ops-sheet ops-currency-sheet">
            <OpsSheetHeader
              icon={<PopupSourceMark tone="#69c634" brand><CurrencyDollarIdentityMark size={40} /></PopupSourceMark>}
              title="Display Currency"
              subtitle={fxTruth.sourceTimeMs
                ? `${fxTruth.status} · source ${timeAgo(fxTruth.sourceTimeMs)}`
                : fxTruth.error ?? 'Loading FX source truth'}
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
              icon={<PopupSourceMark tone="#8c5ce7" brand><img className="basis-source-image" src={BASIS_MARK} alt="" /></PopupSourceMark>}
              title="Basis Units"
              subtitle="One rate, three equivalent views"
              status={basisCode}
              tone="accent"
            />
            <div className="ops-choice-stack" role="radiogroup" aria-label="Basis display unit">
              <button type="button" role="radio" aria-checked={!basisIsBps && !basisIsDecimal} className={!basisIsBps && !basisIsDecimal ? 'selected' : ''} onClick={() => updatePref('basisUnit', 'pct')} data-testid="basis-unit-pct">
                <span className="ops-choice-mark">%</span><span><b>Percent</b><em>Percentage-Point Display · +0.042%</em></span><span className="ops-row-value">PCT</span>{!basisIsBps && !basisIsDecimal && <IconCheck size={15} />}
              </button>
              <button type="button" role="radio" aria-checked={basisIsBps} className={basisIsBps ? 'selected' : ''} onClick={() => updatePref('basisUnit', 'bps')} data-testid="basis-unit-bps">
                <span className="ops-choice-mark">bp</span><span><b>Basis Points</b><em>Trading-Desk Display · +4.2 bps</em></span><span className="ops-row-value">BPS</span>{basisIsBps && <IconCheck size={15} />}
              </button>
              <button type="button" role="radio" aria-checked={basisIsDecimal} className={basisIsDecimal ? 'selected' : ''} onClick={() => updatePref('basisUnit', 'decimal')} data-testid="basis-unit-decimal">
                <span className="ops-choice-mark">0.0</span><span><b>Decimal Rate</b><em>Calculation Ratio · +0.00042</em></span><span className="ops-row-value">DEC</span>{basisIsDecimal && <IconCheck size={15} />}
              </button>
            </div>
            <div className="ops-section-label ops-basis-conversion-label"><span>Quick Conversion</span><em>Rate Applied To $1</em></div>
            <div className="ops-basis-conversion" role="table" aria-label="Basis point conversion examples">
              <div className="ops-basis-conversion-head" role="row"><span role="columnheader">Basis Points</span><span role="columnheader">Percent</span><span role="columnheader">Per $1</span></div>
              <div role="row"><span role="cell">1 bp</span><span role="cell">0.01%</span><span role="cell">$0.0001</span></div>
              <div role="row"><span role="cell">10 bps</span><span role="cell">0.10%</span><span role="cell">$0.0010</span></div>
              <div role="row"><span role="cell">100 bps</span><span role="cell">1.00%</span><span role="cell">$0.0100</span></div>
            </div>
            <div className="ops-note-row ops-basis-definition"><IconTicket size={15} /><span><b>1 Basis Point = 0.01%</b><em>Decimal Rate = Percent ÷ 100. This changes presentation only.</em></span></div>
          </div>
        );

      case 'account':
        return <AccountSheet />;

      case 'appearance': {
        const themeModes = [
          { id: 'system', label: 'System' },
          { id: 'light', label: 'Light' },
          { id: 'dark', label: 'Dark' },
        ] as const;
        const motionModes = [
          { id: 'system', label: 'System' },
          { id: 'full', label: 'Full' },
          { id: 'reduced', label: 'Reduced' },
        ] as const;
        const setZoom = (next: number) => updatePref('zoom', Math.min(1.5, Math.max(0.8, Math.round(next * 100) / 100)));
        return (
          <div className="ops-sheet ops-appearance-sheet" style={{ '--ops-accent': activeAccent.hex } as CSSProperties}>
            <OpsSheetHeader
              icon={<PopupSourceMark tone="#4b6cff" brand><AppearanceIdentityMark size={40} /></PopupSourceMark>}
              title="Appearance"
              subtitle={`${activeAccent.label} Accent · ${appearanceZoom}% Scale`}
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
            <div className="ops-section-label"><span>Interface Scale</span><em>80–150%</em></div>
            <div className="ops-scale-row">
              <button type="button" onClick={() => setZoom((prefs.zoom || 1) - 0.05)} aria-label="Zoom out" data-testid="appearance-zoom-out">−</button>
              <strong>{appearanceZoom}%</strong>
              <button type="button" onClick={() => setZoom((prefs.zoom || 1) + 0.05)} aria-label="Zoom in" data-testid="appearance-zoom-in">+</button>
              <button type="button" className="reset" onClick={() => updatePref('zoom', 1)} data-testid="appearance-zoom-reset">Reset 100%</button>
            </div>
            <div className="ops-section-label"><span>Motion</span><em>Animation Comfort</em></div>
            <div className="ops-segment ops-motion-segment" role="radiogroup" aria-label="Motion preference">
              {motionModes.map((mode) => (
                <button key={mode.id} type="button" role="radio" aria-checked={prefs.motion === mode.id} className={prefs.motion === mode.id ? 'selected' : ''} onClick={() => updatePref('motion', mode.id)} data-testid={`appearance-motion-${mode.id}`}>{mode.label}</button>
              ))}
            </div>
            <div className="ops-row ops-appearance-note">
              <span className="ops-row-icon idle"><IconPulse size={15} /></span>
              <span className="ops-row-copy"><b>Current Presentation</b><em>{prefs.theme} theme · {prefs.motion} motion</em></span>
              <span className="ops-row-value">{appearanceZoom}%</span>
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
      <span className="topbar-suite-divider" aria-hidden="true" />
      {trig('shell', 'hdr-ic tint-shell shell-ghost shell-premium-trigger', <>
        <span className="rail-icon-core aws-runner-trigger-core" aria-hidden="true"><AwsCubeIdentityMark size={24} /></span>
      </>, { title: 'AWS Runner Control — OWNER GATED · NOT CONFIGURED' })}
      {trig('apikey', 'hdr-ic apikey-ghost apikey-premium-trigger s-missing', <>
        <span className="rail-icon-core api-key-trigger-core s-missing"><ApiKeyIdentityMark size={24} /></span>
      </>, { title: 'Private exchange adapter — OWNER GATED · NOT CONFIGURED' })}
      {trig('advisor', `hdr-ic advisor-ghost advisor-premium-trigger grade-${advTone}`, <>
        <span className={`rail-icon-core trust-advisor-trigger-core ${advTone}`}><img className="trust-advisor-trigger-image" src={TRUST_ADVISOR_MARK} alt="" /></span>
      </>, { title: 'Trust Advisor — canonical safety checks' })}
      <span className="topbar-suite-divider" aria-hidden="true" />
      {trig('notif', `hdr-ic notif-trigger notif-ghost notif-premium-trigger ${notifTone}`, <>
        <span className={`rail-icon-core notification-trigger-core ${notifTone}`}>
          <img className="notification-trigger-image" src={NOTIFICATION_MARK} alt="" />
          {unread > 0 && <b className="ops-trigger-count">{unread > 99 ? '99+' : unread}</b>}
        </span>
      </>, { title: `Notifications — ${notificationTriggerTruth} · feed ${notificationFeedStatus}` })}
      {trig('power', `hdr-ic power-ghost power-premium-trigger ${convergenceKillOn ? 'm-halted' : 'm-manual'}`, <>
        <span className={`rail-icon-core execution-control-trigger-core ${convergenceTone}`}><ExecutionPowerIdentityMark stopped={convergenceKillOn} size={24} /></span>
      </>, { title: `Execution Control — ${convergenceModeLabel}` })}
      <span className="topbar-suite-divider" aria-hidden="true" />
      {trig('currency', `hdr-ic currency-ghost currency-premium-trigger ${curTone}`, <>
        <span className={`rail-icon-core currency-trigger-core ${curTone}`}><CurrencyDollarIdentityMark size={24} /></span>
      </>, { title: `Display currency — ${cur}` })}
      {trig('basisu', `hdr-ic basis-ghost basis-premium-trigger ${basisIsBps ? 'basis-bps' : basisIsDecimal ? 'basis-decimal' : 'basis-pct'}`, <>
        <span className={`rail-icon-core basis-trigger-core ${prefs.basisUnit}`}><img className="basis-trigger-image" src={BASIS_MARK} alt="" /></span>
      </>, { title: `Basis units — ${basisUnitLabel}` })}
      {trig('appearance', `hdr-ic appearance-ghost appearance-premium-trigger ${theme}`, <>
        <span className={`rail-icon-core appearance-trigger-core ${theme}`} style={{ '--apx-accent': activeAccent.hex } as CSSProperties}>
          <AppearanceIdentityMark size={24} />
        </span>
      </>, { title: `Appearance — ${prefs.theme === 'system' ? 'auto' : prefs.theme} · ${appearanceZoom}% · ${prefs.motion} motion` })}
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
            <div
              className="smenu-pane outgoing"
              data-pane-key={outgoingContent}
              aria-hidden="true"
              ref={(node) => { if (node) node.inert = true; }}
              key={outgoingContent}
            >
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

type ConnectionResetTarget = 'all' | 'market' | 'runtime' | 'news' | 'calendar' | 'fx';
type WatchmanStatus = 'operational' | 'degraded' | 'outage' | 'planned';
type WatchmanGroup = 'control_path' | 'binance' | 'bot' | 'sources' | 'infrastructure';
type WatchmanView = 'overview' | 'connections' | 'sources';
type BrowserHealthProbe = {
  rttMs: number;
  observationReported: boolean;
  observationError: string | null;
};
type WatchmanComponent = {
  id: string;
  label: string;
  group: WatchmanGroup;
  status: WatchmanStatus;
  statusLabel: string;
  detail: string;
  value: string;
  required: boolean;
  updatedAt: number | null;
  latencyMs?: number | null;
  resetTarget?: Exclude<ConnectionResetTarget, 'all'>;
};

function ConnectionWatchmanMark({ size = 52 }: { size?: number }) {
  return (
    <svg className="watchman-mark" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path className="wm-shield" d="M32 5.5 53 13v16.8c0 13-8.6 23.6-21 28.7C19.6 53.4 11 42.8 11 29.8V13L32 5.5Z" />
      <path className="wm-orbit wm-orbit-outer" d="M19.2 35.2a15.5 15.5 0 0 1 25.6-14.8" />
      <path className="wm-orbit wm-orbit-inner" d="M23.5 36a10.5 10.5 0 0 1 17.7-10" />
      <path className="wm-sweep" d="M32 32 44.5 19.5" />
      <circle className="wm-core" cx="32" cy="32" r="4.2" />
      <circle className="wm-node one" cx="19.4" cy="35.2" r="2.2" />
      <circle className="wm-node two" cx="44.8" cy="20.3" r="2.2" />
      <circle className="wm-node three" cx="42.3" cy="42.6" r="2.2" />
    </svg>
  );
}

const watchmanStatusLabel = (status: WatchmanStatus) => status === 'operational' ? 'Operational' : status === 'degraded' ? 'Degraded' : status === 'outage' ? 'Outage' : 'Not Configured';
const watchmanGroupLabel: Record<WatchmanGroup, string> = {
  control_path: 'Control Path',
  binance: 'Binance',
  bot: 'Bot Runtime',
  sources: 'Source Network',
  infrastructure: 'Infrastructure',
};

function watchmanGroupIcon(group: WatchmanGroup): ReactNode {
  if (group === 'control_path') return <IconWifi size={17} />;
  if (group === 'binance') return <IconExchange size={17} />;
  if (group === 'bot') return <IconBrain size={17} />;
  if (group === 'sources') return <IconNewspaper size={17} />;
  return <IconShield size={17} />;
}

function watchmanGroupForComponent(componentId: string): WatchmanGroup {
  if (componentId === 'public-spot-source' || componentId === 'public-usdm-source') return 'binance';
  if (componentId === 'market-universe' || componentId.includes('intelligence')) return 'sources';
  if (componentId === 'basis-engine' || componentId === 'volume-engine') return 'bot';
  return 'control_path';
}

function watchmanComponentFromSupervisor(component: Readonly<ProductComponentProjection>, continuity: ProductBindingContinuity): WatchmanComponent {
  const posture = continuity === 'PROVEN'
    ? component.canonicalPresentation
    : { status: 'outage' as const, statusLabel: 'Continuity Blocked' };
  return {
    id: component.componentId,
    label: component.componentId.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    group: watchmanGroupForComponent(component.componentId),
    status: posture.status,
    statusLabel: posture.statusLabel,
    detail: `${component.owner} · Lifecycle ${component.observedLifecycle} · Capability ${component.capability} · Truth ${component.truthLabel}${component.blockerCode ? ` · ${component.blockerCode}` : ''}`,
    value: component.observedLifecycle.replaceAll('_', ' '),
    required: component.capability !== 'NOT_CONFIGURED',
    updatedAt: component.lastAdvanceAtMs ?? component.heartbeatAtMs,
  };
}

export function RefreshDock() {
  const { connected, prefs, updatePref } = useStore();
  const { binding } = useProductControlRoomContext();
  const [appRtt, setAppRtt] = useState<number | null>(null);
  const [st, setSt] = useState<'idle' | 'spin' | 'ok' | 'err'>('idle');
  const [open, setOpen] = useState(false);
  const [lastRefreshTs, setLastRefreshTs] = useState<number | null>(null);
  const [lastRefreshIssues, setLastRefreshIssues] = useState<string[]>([]);
  const [targetBusy, setTargetBusy] = useState<ConnectionResetTarget | null>(null);
  const [dockView, setDockView] = useState<WatchmanView>('overview');
  const [cadenceReset, setCadenceReset] = useState(false);
  const [recoveryTarget, setRecoveryTarget] = useState<ConnectionResetTarget>('all');
  const [healthProbeError, setHealthProbeError] = useState<string | null>(null);
  const [browserObservationError, setBrowserObservationError] = useState<string | null>(null);
  const [healthProbeStatus, setHealthProbeStatus] = useState<'LOADING' | 'CURRENT' | 'UNAVAILABLE'>('LOADING');
  const busy = useRef(false);
  const healthPollRef = useRef<SettledPoll | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const recoveryStatusReset = useMemo(() => createDelayedResetOwner(), []);

  const runHealthProbe = useCallback(async (signal: AbortSignal): Promise<BrowserHealthProbe> => {
    const t0 = performance.now();
    await fetchJson<unknown>('/health/live', { cache: 'no-store', signal }, 4_000);
    const rttMs = performance.now() - t0;
    try {
      await fetchJson<unknown>('/api/connections/browser-observation', {
        method: 'POST',
        cache: 'no-store',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rttMs, socketConnected: connected }),
      }, 3_000);
      return { rttMs, observationReported: true, observationError: null };
    } catch (error) {
      if (signal.aborted) throw error;
      return {
        rttMs,
        observationReported: false,
        observationError: apiErrorMessage(error, 'Browser observation report failed'),
      };
    }
  }, [connected]);

  useEffect(() => {
    const healthPoll = createSettledPoll<BrowserHealthProbe>({
      intervalMs: 5_000,
      timeoutMs: 8_000,
      request: runHealthProbe,
      onSuccess: (probe) => {
        setHealthProbeStatus('CURRENT');
        setAppRtt(probe.rttMs);
        setHealthProbeError(null);
        setBrowserObservationError(probe.observationReported ? null : probe.observationError);
      },
      onError: (error) => {
        setHealthProbeStatus('UNAVAILABLE');
        setAppRtt(null);
        setHealthProbeError(apiErrorMessage(error, 'Watchman health probe failed'));
        setBrowserObservationError(null);
      },
    });
    healthPollRef.current = healthPoll;
    healthPoll.start();
    return () => {
      if (healthPollRef.current === healthPoll) healthPollRef.current = null;
      healthPoll.stop();
    };
  }, [runHealthProbe]);

  useEffect(() => () => recoveryStatusReset.cancel(), [recoveryStatusReset]);

  useEffect(() => {
    if (!open) return;
    healthPollRef.current?.refresh();
    void binding.refresh();
  }, [binding.refresh, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const cadenceSec = (key: DataCadenceKey) => prefs.dataCadence?.[key]
    ?? (key === 'market' ? prefs.refreshSec : key === 'news' ? 5 : 10);
  const fmtCadence = (sec: number) => sec < 1 ? '<1s' : `${sec.toFixed(0)}s`;
  const setCadence = (key: DataCadenceKey, sec: number) => {
    const next = { ...(prefs.dataCadence ?? {}), [key]: sec } as Record<DataCadenceKey, number>;
    updatePref('dataCadence', next);
    if (key === 'market') updatePref('refreshSec', sec);
    setCadenceReset(false);
  };
  const cadenceOptions = MARKET_PING_CHOICES.map((seconds) => ({ id: String(seconds), label: fmtCadence(seconds) }));
  const resetCadenceDefaults = () => {
    const next = { ...(prefs.dataCadence ?? {}) } as Record<DataCadenceKey, number>;
    for (const key of ['market', 'news', 'calendar'] as const) next[key] = DATA_CADENCE_DEFAULTS[key];
    updatePref('dataCadence', next);
    updatePref('refreshSec', DATA_CADENCE_DEFAULTS.market);
    setCadenceReset(true);
    window.setTimeout(() => setCadenceReset(false), 1800);
  };

  const productSnapshot = binding.snapshot;
  const productBindingContinuity = binding.continuity;
  const canonicalComponents = (productSnapshot?.components ?? []).map((component) => watchmanComponentFromSupervisor(component, productBindingContinuity));
  const effectiveLastResetTs = lastRefreshTs;
  const browserStatus: WatchmanStatus = !connected || appRtt === null
    ? 'outage'
    : browserObservationError
      ? 'degraded'
      : appRtt >= 800
        ? 'outage'
        : appRtt >= 350
          ? 'degraded'
          : 'operational';
  const browserComponent: WatchmanComponent = {
    id: 'browser-session',
    label: 'Browser / Website Session',
    group: 'control_path',
    status: browserStatus,
    statusLabel: watchmanStatusLabel(browserStatus),
    detail: healthProbeStatus === 'LOADING'
      ? `Cockpit state socket ${connected ? 'live' : 'reconnecting'} · liveness probe loading · browser observation unreported`
      : healthProbeError
      ? `Cockpit state socket ${connected ? 'live' : 'reconnecting'} · ${healthProbeError}`
      : browserObservationError
        ? `Cockpit state socket ${connected ? 'live' : 'reconnecting'} · browser observation stale · ${browserObservationError}`
        : `Cockpit state socket ${connected ? 'live' : 'reconnecting'} · direct /health/live liveness round trip · browser observation reported`,
    value: appRtt === null ? 'Offline' : msLabel(appRtt),
    required: false,
    updatedAt: Date.now(),
    latencyMs: appRtt,
  };
  // Private account and external infrastructure are explicit owner boundaries,
  // not runtime health. Discard any operational-looking server row for these
  // IDs and replace it with static planned provenance before all counts/paths.
  const ownerGatedComponents: WatchmanComponent[] = [
    {
      id: 'binance-account',
      label: 'Private Account Adapter',
      group: 'binance',
      status: 'planned',
      statusLabel: 'Not Configured',
      detail: 'OWNER_GATED · NOT_CONFIGURED · no signed account reads are mounted',
      value: 'OWNER GATED',
      required: false,
      updatedAt: null,
    },
    {
      id: 'aws-runner',
      label: 'AWS Runner',
      group: 'infrastructure',
      status: 'planned',
      statusLabel: 'Not Configured',
      detail: 'OWNER_GATED · NOT_CONFIGURED · no probe, command, deployment, or console path is mounted',
      value: 'OWNER GATED',
      required: false,
      updatedAt: null,
    },
  ];
  const components: WatchmanComponent[] = [browserComponent, ...canonicalComponents, ...ownerGatedComponents];
  const overallPresentation = productSnapshot && binding.continuity === 'PROVEN'
    ? productSnapshot.canonicalCockpit.watchmanOverall
    : { status: 'outage' as const, label: 'Canonical Truth Unavailable' };
  const overallStatus: WatchmanStatus = overallPresentation.status;
  const launcherPresentation = canonicalWatchmanLauncherPresentation({
    canonicalStatus: overallStatus,
    canonicalLabel: overallPresentation.label,
    actionState: st,
  });
  const sourceComponents = components.filter((component) => component.group === 'sources');
  const infrastructureComponents = components.filter((component) => component.group === 'infrastructure');
  const sourceCoverage = productSnapshot?.dashboard.summaries.sourceCoverage;
  const chainIds = ['browser-session', 'engine-supervisor', 'market-universe', 'public-usdm-source', 'binance-account', 'aws-runner'];
  const pathComponents = chainIds.map((id) => components.find((component) => component.id === id)).filter((component): component is WatchmanComponent => Boolean(component));
  const finish = (ok: boolean, issues: string[], ts: number) => {
    setLastRefreshTs(ts);
    setLastRefreshIssues(issues);
    setSt(ok ? 'ok' : 'err');
    recoveryStatusReset.schedule(ok ? 1500 : 2400, () => setSt('idle'));
  };

  const runTarget = async (target: ConnectionResetTarget) => {
    const targetPosture = canonicalRefreshTargetPosture(target);
    if (!targetPosture.actionAllowed) {
      finish(false, [`${targetPosture.statusLabel} · ${targetPosture.reason}`], Date.now());
      return;
    }
    if (busy.current) return;
    busy.current = true;
    setTargetBusy(target);
    recoveryStatusReset.cancel();
    setSt('spin');
    let ok = false;
    let issues: string[] = [];
    let ts = Date.now();
    try {
      const result = await fetchJson<{ ok?: boolean; issues?: string[]; ts?: number }>('/api/refresh', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      }, 8_000);
      ok = result.ok === true;
      issues = result.issues ?? (ok ? [] : [`${target} reset failed`]);
      ts = result.ts ?? Date.now();
      fireRefresh();
    } catch (error) {
      issues = [apiErrorMessage(error, `${target} reset failed`)];
    } finally {
      busy.current = false;
      setTargetBusy(null);
      finish(ok && issues.length === 0, issues, ts);
      healthPollRef.current?.refresh();
      void binding.refresh();
    }
  };

  const overallLabel = overallPresentation.label;
  const label = launcherPresentation.label;
  const groupedConnections = (Object.keys(watchmanGroupLabel) as WatchmanGroup[]).map((group) => ({
    group,
    rows: components.filter((component) => component.group === group),
  })).filter((section) => section.rows.length > 0);
  const resetControls = [
    { target: 'all' as const, label: 'Mounted Connections', detail: 'CONTROL_PREVIEW_REQUIRED · managed-runtime recovery requires canonical preview and receipt' },
    { target: 'market' as const, label: 'Market Network', detail: 'CONTROL_PREVIEW_REQUIRED · the compatibility route cannot rebuild market runtimes' },
    { target: 'runtime' as const, label: 'Bot Runtimes', detail: 'CONTROL_PREVIEW_REQUIRED · engine restart is owned by canonical Product controls' },
    { target: 'news', label: 'News Sources', detail: 'Refresh every configured source adapter' },
    { target: 'calendar', label: 'Calendar', detail: 'Rebuild the economic-event cache' },
    { target: 'fx', label: 'FX Rates', detail: 'Refresh display-currency references' },
  ].map((control) => ({ ...control, posture: canonicalRefreshTargetPosture(control.target as ConnectionResetTarget) }));
  const cadenceControls: Array<{ key: DataCadenceKey; target: Exclude<ConnectionResetTarget, 'all'>; label: string; detail: string }> = [
    { key: 'market', target: 'market', label: 'Market Prices', detail: 'Polling cadence only · refresh is CONTROL_PREVIEW_REQUIRED' },
    { key: 'news', target: 'news', label: 'News Context', detail: 'Feed fallback and new-item context' },
    { key: 'calendar', target: 'calendar', label: 'Calendar', detail: 'Macro releases and value changes' },
  ];
  const selectedRecovery = resetControls.find((control) => control.target === recoveryTarget) ?? resetControls[0];
  const recoveryOptions = resetControls.map((control) => ({
    id: control.target,
    label: control.posture.actionAllowed ? control.label : `${control.label} · Preview Required`,
  }));

  const renderComponentRow = (component: WatchmanComponent) => {
    const resetPosture = component.resetTarget ? canonicalRefreshTargetPosture(component.resetTarget) : null;
    return (
      <div key={component.id} className={`watchman-component status-${component.status}`}>
        <span className="watchman-component-icon">{watchmanGroupIcon(component.group)}<i /></span>
        <span className="watchman-component-copy"><b>{component.label}</b><em>{component.detail}</em></span>
        <span className="watchman-component-value"><b>{component.value}</b><em>{component.statusLabel}</em></span>
        {component.resetTarget && resetPosture ? (
          <button
            type="button"
            disabled={busy.current || component.status === 'planned' || !resetPosture.actionAllowed}
            className={targetBusy === component.resetTarget ? 'busy' : ''}
            onClick={() => void runTarget(component.resetTarget!)}
            aria-label={resetPosture.actionAllowed ? `Recover ${component.label}` : `${component.label} ${resetPosture.statusLabel}`}
            title={resetPosture.actionAllowed ? `Recover ${component.label}` : `${resetPosture.statusLabel} · ${resetPosture.reason}`}
          ><IconRefresh size={14} /></button>
        ) : <span className="watchman-component-spacer" />}
      </div>
    );
  };

  return (
    <div className={`rdock rdock-control watchman-dock ${open ? 'open' : ''}`} ref={rootRef}>
      {open && (
        <section className={`rdock-pop rdock-control-pop watchman-panel status-${overallStatus}`} aria-label="Connection Watchman">
          <header className="rdock-control-head watchman-head">
            <span className={`rdock-control-logo status-${overallStatus}`}><ConnectionWatchmanMark size={54} /></span>
            <span className="rdock-control-title"><b>Connection Watchman</b><em>Website · bot · public sources · owner-gated boundaries</em></span>
            <span className={`watchman-live-pulse status-${overallStatus}`}><i />Live Monitor</span>
            <span className={`rdock-pop-tag status-${overallStatus}`}>{overallLabel}</span>
            <button className="watchman-close" type="button" onClick={() => setOpen(false)} aria-label="Close Connection Watchman"><IconCross size={14} /></button>
          </header>

          <div className="rdock-summary watchman-summary" aria-label="Connection Summary">
            <span><em>Machine Ready</em><b>{productSnapshot?.ownerView.machineReady ?? 'UNKNOWN'}</b><small>{productSnapshot?.ownerView.topRootBlocker ?? 'Canonical owner verdict'}</small></span>
            <span><em>Browser RTT</em><b>{appRtt == null ? '—' : msLabel(appRtt)}</b><small>Direct control API probe</small></span>
            <span><em>Binding Continuity</em><b>{binding.continuity}</b><small>{binding.error ?? productSnapshot?.ownerView.dataFreshness ?? 'No freshness claim'}</small></span>
            <span><em>Ops Interlock</em><b>{productSnapshot?.opsIntakeInterlock.state ?? 'UNKNOWN'}</b><small>{productSnapshot?.opsIntakeInterlock.reasonCodes[0] ?? 'Canonical readback'}</small></span>
            <span><em>Recovery State</em><b>{productSnapshot?.opsReadback.recoveryState ?? 'UNKNOWN'}</b><small>{effectiveLastResetTs ? `Last manual recovery attempt ${timeAgo(effectiveLastResetTs)}` : 'No local recovery attempt'}</small></span>
          </div>

          <div className="rdock-view-tabs" role="tablist" aria-label="Connection Control View">
            <button type="button" role="tab" aria-selected={dockView === 'overview'} className={dockView === 'overview' ? 'on' : ''} onClick={() => setDockView('overview')}><IconPulse size={14} /> Overview</button>
            <button type="button" role="tab" aria-selected={dockView === 'connections'} className={dockView === 'connections' ? 'on' : ''} onClick={() => setDockView('connections')}><IconWifi size={14} /> Connections</button>
            <button type="button" role="tab" aria-selected={dockView === 'sources'} className={dockView === 'sources' ? 'on' : ''} onClick={() => setDockView('sources')}><IconNewspaper size={14} /> Sources</button>
          </div>

          <div className={`rdock-scroll ${dockView}-view`}>
            {dockView === 'overview' && (
              <div className="watchman-overview">
                <div className="watchman-overview-control-grid">
                  <section className="watchman-path-section">
                    <div className="watchman-section-head"><span><b>Connection Path</b><em>Current evidence by owner</em></span><strong>{productSnapshot?.evaluatedAtMs ? `Assessed ${timeAgo(productSnapshot.evaluatedAtMs)}` : 'Connecting'}</strong></div>
                    <div className="watchman-path" aria-label="Monitored connection path">
                      {pathComponents.map((component) => (
                        <div className={`watchman-path-node status-${component.status}`} key={component.id}>
                          <span className="watchman-path-icon">{watchmanGroupIcon(component.group)}<i /></span>
                          <span className="watchman-path-copy">
                            <b>{component.label.replace('Binance ', '').replace('Browser / Website Session', 'Browser')}</b>
                            <em>{component.detail}</em>
                          </span>
                          <span className="watchman-path-value"><b>{component.value}</b><em>{component.statusLabel}</em></span>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="watchman-cadence-section">
                    <div className="watchman-section-head watchman-controls-section-head">
                      <span><b>Polling Cadence</b><em>Select timing and refresh each owner inline</em></span>
                      <button className={cadenceReset ? 'ok' : ''} type="button" disabled={busy.current} onClick={resetCadenceDefaults}><IconRefresh size={13} />{cadenceReset ? 'Restored' : 'Defaults'}</button>
                    </div>
                    <div className="watchman-cadence-grid">
                      {cadenceControls.map((control, index) => (
                        <div className="rdock-cadence-row" key={control.key}>
                          <span className="watchman-cadence-copy"><b>{control.label}</b><em>{control.detail}</em></span>
                          <PillSelect
                            value={String(cadenceSec(control.key))}
                            options={cadenceOptions}
                            onChange={(value) => setCadence(control.key, Number(value))}
                            ariaLabel={`${control.label} Polling Cadence`}
                            className="rdock-cadence-select"
                            buttonClassName="rdock-cadence-trigger"
                            menuClassName={`rdock-cadence-menu ${index > 1 ? 'opens-up' : ''}`}
                          />
                          <button
                            className={`watchman-cadence-refresh ${targetBusy === control.target ? 'busy' : ''}`}
                            type="button"
                            disabled={busy.current || !canonicalRefreshTargetPosture(control.target).actionAllowed}
                            onClick={() => void runTarget(control.target)}
                            aria-label={canonicalRefreshTargetPosture(control.target).actionAllowed ? `Refresh ${control.label}` : `${control.label} CONTROL_PREVIEW_REQUIRED`}
                            title={canonicalRefreshTargetPosture(control.target).actionAllowed ? `Refresh ${control.label}` : canonicalRefreshTargetPosture(control.target).reason}
                          ><IconRefresh size={14} /></button>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            )}

            {dockView === 'connections' && (
              <>
                {groupedConnections.map((section) => (
                  <section className="watchman-connection-group" key={section.group}>
                    <div className="watchman-section-head"><span>{watchmanGroupIcon(section.group)}<b>{watchmanGroupLabel[section.group]}</b></span><strong>{section.rows.filter((row) => row.status === 'operational').length}/{section.rows.length}</strong></div>
                    <div className="watchman-component-list">{section.rows.map(renderComponentRow)}</div>
                  </section>
                ))}
              </>
            )}

            {dockView === 'sources' && (
              <div className="watchman-sources-view">
                <div className="watchman-source-hero">
                  <span><IconNewspaper size={22} /></span>
                  <span><b>{sourceComponents.length} Canonical Source Owners</b><em>Exact Product Integration owner projections; no legacy watchman aggregate.</em></span>
                  <strong>{sourceCoverage?.universeSymbols ?? 'UNKNOWN'} Symbols</strong>
                </div>
                <section>
                  <div className="watchman-section-head"><span><b>Market Intelligence Sources</b><em>Grouped upstream coverage and cache health</em></span><strong>{sourceComponents.length}</strong></div>
                  <div className="watchman-component-list">{sourceComponents.map(renderComponentRow)}</div>
                </section>
                <section>
                  <div className="watchman-section-head"><span><b>Deployment And Delivery</b><em>Honest readiness; unconfigured channels stay disabled</em></span><strong>{infrastructureComponents.length}</strong></div>
                  <div className="watchman-component-list">{infrastructureComponents.map(renderComponentRow)}</div>
                </section>
              </div>
            )}

          </div>

          {lastRefreshIssues.length > 0 && (
            <div className="rdock-issues" title={lastRefreshIssues.join(' · ')}><IconAlarm size={14} /><span>{lastRefreshIssues[0]}</span></div>
          )}
          <footer className="watchman-recovery-console watchman-recovery-dock" aria-label="Connection Recovery">
            <span className="watchman-recovery-icon"><IconRefresh size={18} /></span>
            <span className="watchman-recovery-copy"><b>{selectedRecovery.label}</b><em>{selectedRecovery.detail}</em></span>
            <PillSelect
              value={recoveryTarget}
              options={recoveryOptions}
              onChange={(value) => setRecoveryTarget(value as ConnectionResetTarget)}
              ariaLabel="Recovery Target"
              className="watchman-recovery-select"
              buttonClassName="watchman-recovery-trigger"
              menuClassName="watchman-recovery-menu opens-up"
            />
            <button
              className={targetBusy === recoveryTarget ? 'busy' : ''}
              type="button"
              disabled={busy.current || !selectedRecovery.posture.actionAllowed}
              onClick={() => void runTarget(recoveryTarget)}
              title={selectedRecovery.posture.reason}
            >
              <IconRefresh size={15} /><span>{targetBusy === recoveryTarget ? 'Refreshing' : selectedRecovery.posture.actionLabel}</span>
            </button>
          </footer>
        </section>
      )}

      <button className={`rdock-btn rdock-control-btn status-${launcherPresentation.healthStatus} ${st === 'spin' ? 'spin' : ''}`} data-action-state={st} onClick={() => setOpen((value) => !value)} title={label} aria-label={label} aria-expanded={open}>
        <span className="rdock-control-image" aria-hidden="true">
          <img className="watchman-reset-mark" src="/connection-reset-mark.svg" alt="" draggable={false} />
        </span>
        <i className={`rdock-control-state status-${launcherPresentation.healthStatus}`} />
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
