// Local UI preferences (Signal Lab settings pattern): persisted to
// localStorage, applied globally, never sent to the server.

export type AccentKey = 'r' | 'o' | 'y' | 'g' | 'b' | 'i' | 'v';

export interface Prefs {
  theme: 'light' | 'dark' | 'system';
  motion: 'full' | 'reduced';
  tape: boolean;
  density: 'comfortable' | 'compact';
  refreshSec: number; // markets poll
  defaultPage: string;
  timezone: 'local' | 'utc';
  basisUnit: 'pct' | 'bps';
  accent: AccentKey; // ROYGBIV accent swatch (default blue)
  clockZone: string; // top-bar clock display zone: 'local' | 'UTC' | IANA id
  currency: string; // display fiat for money values: 'USD' | 'INR' | ...
  zoom: number; // whole-UI zoom factor
  alerts: { proposals: boolean; fills: boolean; risk: boolean; news: boolean };
}

const DEFAULTS: Prefs = {
  theme: 'light',
  motion: 'full',
  tape: false,
  density: 'comfortable',
  refreshSec: 6,
  defaultPage: 'dashboard',
  timezone: 'local',
  basisUnit: 'pct',
  accent: 'b',
  clockZone: 'UTC',
  currency: 'USD',
  zoom: 1.05,
  alerts: { proposals: true, fills: true, risk: true, news: false },
};

// Supported display currencies (symbol + label). Rates come live from /api/fx.
export const CURRENCIES: Record<string, { symbol: string; label: string }> = {
  USD: { symbol: '$', label: 'US Dollar' },
  INR: { symbol: '₹', label: 'Indian Rupee' },
  EUR: { symbol: '€', label: 'Euro' },
  GBP: { symbol: '£', label: 'British Pound' },
  JPY: { symbol: '¥', label: 'Japanese Yen' },
  AED: { symbol: 'AED ', label: 'UAE Dirham' },
  SGD: { symbol: 'S$', label: 'Singapore Dollar' },
};

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
    cache = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) };
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

export function applyPrefs(): void {
  const p = getPrefs();
  document.documentElement.dataset.theme = resolvedTheme(p);
  document.documentElement.dataset.motion = p.motion;
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
  s.setProperty('--uiz', String(z));
}
