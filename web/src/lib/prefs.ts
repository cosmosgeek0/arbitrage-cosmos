// Local UI preferences (Signal Lab settings pattern): persisted to
// localStorage, applied globally, never sent to the server.

export type AccentKey = 'r' | 'o' | 'y' | 'g' | 'b' | 'i' | 'v';
export type DataCadenceKey = 'market' | 'account' | 'news' | 'calendar' | 'fx' | 'health' | 'token';
export type DataCadence = Record<DataCadenceKey, number>;
export type MarketPingKey = 'market' | 'account' | 'news' | 'calendar';
export type NotificationRuleKey = 'critical' | 'execution' | 'health' | 'infrastructure';
export type NotificationRules = Record<NotificationRuleKey, boolean>;
export type BasisUnit = 'pct' | 'bps' | 'decimal';

export const MARKET_PING_KEYS: MarketPingKey[] = ['market', 'account', 'news', 'calendar'];
export const MARKET_PING_CHOICES = [0.5, 1, 3, 5, 10] as const;

export const DATA_CADENCE_DEFAULTS: DataCadence = {
  market: 5,
  account: 10,
  news: 5,
  calendar: 10,
  fx: 300,
  health: 10,
  token: 1,
};

export interface Prefs {
  theme: 'light' | 'dark' | 'system';
  motion: 'system' | 'full' | 'reduced';
  tape: boolean;
  density: 'comfortable' | 'compact';
  refreshSec: number; // markets poll
  dataCadence: DataCadence; // per-source data pressure controls
  defaultPage: string;
  timezone: 'local' | 'utc';
  basisUnit: BasisUnit;
  accent: AccentKey; // ROYGBIV accent swatch (default blue)
  clockZone: string; // top-bar clock display zone: UTC or a supported IANA market desk
  currency: string; // display fiat for money values: 'USD' | 'INR' | ...
  zoom: number; // whole-UI zoom factor
  alerts: NotificationRules;
}

const DEFAULTS: Prefs = {
  theme: 'light',
  motion: 'full',
  tape: false,
  density: 'comfortable',
  refreshSec: 5,
  dataCadence: DATA_CADENCE_DEFAULTS,
  defaultPage: 'dashboard',
  timezone: 'local',
  basisUnit: 'pct',
  accent: 'b',
  clockZone: 'UTC',
  currency: 'USD',
  zoom: 1,
  alerts: { critical: true, execution: true, health: true, infrastructure: true },
};

const CLOCK_ZONES = new Set(['Asia/Kolkata', 'UTC', 'America/New_York', 'Asia/Singapore', 'Europe/London']);

// Supported display currencies (symbol + label). Rates come live from /api/fx.
export const CURRENCIES: Record<string, { symbol: string; label: string }> = {
  USD: { symbol: '$', label: 'US Dollar' },
  INR: { symbol: '₹', label: 'Indian Rupee' },
  EUR: { symbol: '€', label: 'Euro' },
  GBP: { symbol: '£', label: 'British Pound' },
  JPY: { symbol: '¥', label: 'Japanese Yen' },
  SGD: { symbol: 'S$', label: 'Singapore Dollar' },
};

function normalizePrefs(raw: Partial<Prefs>): Prefs {
  const rawCadence = raw.dataCadence && typeof raw.dataCadence === 'object' ? raw.dataCadence : {};
  const legacyAlerts = raw.alerts && typeof raw.alerts === 'object'
    ? raw.alerts as Partial<NotificationRules> & {
      account?: boolean;
      bot?: boolean;
      proposals?: boolean;
      fills?: boolean;
      risk?: boolean;
    }
    : {};
  const alerts: NotificationRules = {
    critical: legacyAlerts.critical ?? legacyAlerts.risk ?? DEFAULTS.alerts.critical,
    execution: legacyAlerts.execution ?? legacyAlerts.account ?? legacyAlerts.fills ?? DEFAULTS.alerts.execution,
    health: legacyAlerts.health ?? legacyAlerts.bot ?? DEFAULTS.alerts.health,
    infrastructure: legacyAlerts.infrastructure ?? DEFAULTS.alerts.infrastructure,
  };
  const next = { ...DEFAULTS, ...raw, alerts, dataCadence: { ...DATA_CADENCE_DEFAULTS, ...rawCadence } };
  const clamp = (v: unknown, fallback: number) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(300, Math.max(0.5, Math.round(n * 10) / 10));
  };
  next.refreshSec = clamp(next.refreshSec, DEFAULTS.refreshSec);
  for (const key of Object.keys(DATA_CADENCE_DEFAULTS) as DataCadenceKey[]) {
    next.dataCadence[key] = clamp(next.dataCadence[key], DATA_CADENCE_DEFAULTS[key]);
  }
  if (!raw.dataCadence?.market) next.dataCadence.market = next.refreshSec;
  for (const key of MARKET_PING_KEYS) {
    const current = next.dataCadence[key];
    next.dataCadence[key] = MARKET_PING_CHOICES.reduce((closest, choice) => (
      Math.abs(choice - current) < Math.abs(closest - current) ? choice : closest
    ), MARKET_PING_CHOICES[0]);
  }
  next.refreshSec = next.dataCadence.market;
  if (!CURRENCIES[next.currency]) next.currency = DEFAULTS.currency;
  if (!['pct', 'bps', 'decimal'].includes(next.basisUnit)) next.basisUnit = DEFAULTS.basisUnit;
  if (!['system', 'full', 'reduced'].includes(next.motion)) next.motion = DEFAULTS.motion;
  if (!CLOCK_ZONES.has(next.clockZone)) next.clockZone = next.clockZone === 'local' ? 'Asia/Kolkata' : DEFAULTS.clockZone;
  if (next.defaultPage === 'trade' || next.defaultPage === 'settings') next.defaultPage = DEFAULTS.defaultPage; // pages removed 2026-07
  return next;
}

// ROYGBIV accent swatches. `rgb` drives the soft/line tints; `ink` is a
// readable-on-light text shade; `ctaFg` is the primary-button text color.
export const ACCENTS: Record<AccentKey, { label: string; hex: string; rgb: string; ink: string; ctaFg: string }> = {
  r: { label: 'Red',    hex: '#e5484d', rgb: '229,72,77',  ink: '#b42318', ctaFg: '#ffffff' },
  o: { label: 'Orange', hex: '#f2760c', rgb: '242,118,12', ink: '#b45309', ctaFg: '#ffffff' },
  y: { label: 'Yellow', hex: '#eab308', rgb: '234,179,8',  ink: '#8a6d00', ctaFg: '#1a1400' },
  g: { label: 'Green',  hex: '#12a150', rgb: '18,161,80',  ink: '#0a7c3d', ctaFg: '#ffffff' },
  b: { label: 'Blue',   hex: '#2f6bff', rgb: '47,107,255', ink: '#1d4ed8', ctaFg: '#ffffff' },
  i: { label: 'Indigo', hex: '#5b5bef', rgb: '91,91,239',  ink: '#4338ca', ctaFg: '#ffffff' },
  v: { label: 'Violet', hex: '#9333ea', rgb: '147,51,234', ink: '#7c22ce', ctaFg: '#ffffff' },
};

const KEY = 'cosmos-prefs';
let cache: Prefs | null = null;
const subs = new Set<(p: Prefs) => void>();

export function getPrefs(): Prefs {
  if (cache) return cache;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    cache = normalizePrefs(saved);
    const cadenceChanged = saved.refreshSec !== cache.refreshSec
      || MARKET_PING_KEYS.some((key) => saved.dataCadence?.[key] !== cache!.dataCadence[key]);
    const alertsChanged = JSON.stringify(saved.alerts ?? {}) !== JSON.stringify(cache.alerts);
    if ((saved.currency && saved.currency !== cache.currency) || (saved.clockZone && saved.clockZone !== cache.clockZone) || cadenceChanged || alertsChanged) {
      localStorage.setItem(KEY, JSON.stringify(cache));
    }
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): Prefs {
  cache = { ...getPrefs(), [key]: value };
  localStorage.setItem(KEY, JSON.stringify(cache));
  applyPrefs();
  for (const fn of subs) fn(cache);
  return cache;
}

export function onPrefs(fn: (p: Prefs) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function resolvedTheme(p = getPrefs()): 'light' | 'dark' {
  if (p.theme !== 'system') return p.theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolvedMotion(p = getPrefs()): 'full' | 'reduced' {
  if (p.motion !== 'system') return p.motion;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
}

export function applyPrefs(): void {
  const p = getPrefs();
  document.documentElement.dataset.theme = resolvedTheme(p);
  document.documentElement.dataset.motion = resolvedMotion(p);
  document.body.classList.toggle('dense-tables', p.density === 'compact');

  // Accent swatch → CSS variables (overrides the stylesheet defaults for both
  // themes). Buttons follow the accent too (cta-bg), so blue spreads across.
  const a = ACCENTS[p.accent] ?? ACCENTS.b;
  const s = document.documentElement.style;
  s.setProperty('--accent', a.hex);
  s.setProperty('--accent-ink', a.ink);
  s.setProperty('--accent-soft', `rgba(${a.rgb}, .13)`);
  s.setProperty('--accent-line', `rgba(${a.rgb}, .42)`);
  s.setProperty('--cta-bg', a.hex);
  s.setProperty('--cta-fg', a.ctaFg);

  // Whole-UI zoom. CSS `zoom` rescales layout but NOT vh/vw units, so anything
  // sized in viewport units (sticky sidebar, modals) must divide by --uiz to
  // keep fitting the real viewport — that's what was "breaking into pieces".
  const z = Math.min(1.5, Math.max(0.8, p.zoom || 1));
  (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(z);
  // vh units ignore CSS zoom — expose the factor so layout can divide it out
  document.documentElement.style.setProperty('--z', String(z));
  s.setProperty('--uiz', String(z));
}
