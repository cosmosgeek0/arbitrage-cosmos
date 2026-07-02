// Local UI preferences (Signal Lab settings pattern): persisted to
// localStorage, applied globally, never sent to the server.

export interface Prefs {
  theme: 'light' | 'dark' | 'system';
  motion: 'full' | 'reduced';
  tape: boolean;
  density: 'comfortable' | 'compact';
  refreshSec: number; // markets poll
  defaultPage: string;
  timezone: 'local' | 'utc';
}

const DEFAULTS: Prefs = {
  theme: 'light',
  motion: 'full',
  tape: false,
  density: 'comfortable',
  refreshSec: 6,
  defaultPage: 'dashboard',
  timezone: 'local',
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
}
