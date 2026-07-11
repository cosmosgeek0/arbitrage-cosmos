// Client side of the server icon resolver. TokenIcon asks for a base; we batch
// the asks, hit /api/icons, and because the server resolves unknowns in the
// background, we re-poll the still-unresolved ones a few times. When a real URL
// arrives, subscribers re-render and their monogram upgrades to the logo.

import { fetchJson } from './http';

const remote = new Map<string, string>(); // BASE -> logo url
const requested = new Set<string>(); // asked at least once
const unresolved = new Set<string>(); // asked, not yet resolved
const subs = new Set<() => void>();
const lastQueried = new Map<string, number>();
const attempts = new Map<string, number>();
const FAST_ATTEMPTS = 8;
const MAX_ATTEMPTS = 80;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let repollTimer: ReturnType<typeof setTimeout> | null = null;
let flushRunning = false;
let flushQueued = false;

export function iconUrl(base: string): string | undefined {
  const canonical = canonicalBase(base);
  return canonical ? remote.get(canonical) : undefined;
}

function canonicalBase(value: string): string | null {
  const base = value.trim().toUpperCase();
  return /^[A-Z0-9\u3400-\u9fff]{1,24}$/u.test(base) ? base : null;
}

export function onIcons(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function requestIcon(base: string): void {
  const b = canonicalBase(base);
  if (!b) return;
  if (remote.has(b) || requested.has(b)) return;
  requested.add(b);
  unresolved.add(b);
  attempts.set(b, 0);
  if (!flushTimer) flushTimer = setTimeout(flush, 250);
}

export function primeIcons(bases: string[]): void {
  for (const base of bases) requestIcon(base);
}

export function iconCoverage(bases: string[]): { total: number; resolved: number; unresolved: number } {
  const unique = [...new Set(bases.map(canonicalBase).filter((base): base is string => base !== null))];
  const resolved = unique.filter((base) => remote.has(base)).length;
  return { total: unique.length, resolved, unresolved: Math.max(0, unique.length - resolved) };
}

async function query(bases: string[]): Promise<boolean> {
  if (!bases.length) return false;
  try {
    const data = await fetchJson<Record<string, string>>(`/api/icons?bases=${encodeURIComponent(bases.join(','))}`, {}, 6_000);
    let changed = false;
    for (const [b, url] of Object.entries(data)) {
      const base = b.toUpperCase();
      if (/^https?:\/\//.test(url) && unresolved.has(base) && !remote.has(base)) {
        remote.set(base, url);
        unresolved.delete(base);
        attempts.delete(base);
        changed = true;
      }
    }
    return changed;
  } catch {
    return false;
  }
}

async function flush(): Promise<void> {
  flushTimer = null;
  if (flushRunning) {
    flushQueued = true;
    return;
  }
  flushRunning = true;
  const now = Date.now();
  const batch = [...unresolved]
    .filter((base) => (attempts.get(base) ?? 0) < MAX_ATTEMPTS)
    .sort((a, b) => (lastQueried.get(a) ?? 0) - (lastQueried.get(b) ?? 0))
    .slice(0, 200);
  for (const base of batch) {
    lastQueried.set(base, now);
    attempts.set(base, (attempts.get(base) ?? 0) + 1);
  }
  try {
    const changed = await query(batch);
    if (changed) for (const fn of subs) fn();
  } finally {
    flushRunning = false;
    if (flushQueued) {
      flushQueued = false;
      if (!flushTimer) flushTimer = setTimeout(flush, 0);
      return;
    }
    // Each unresolved key owns its retry budget, so keys requested after an
    // earlier batch cannot be stranded by a spent process-global counter.
    if ([...unresolved].some((base) => (attempts.get(base) ?? 0) < MAX_ATTEMPTS) && !repollTimer) {
      const hasFastAttempt = [...unresolved].some((base) => (attempts.get(base) ?? 0) < FAST_ATTEMPTS);
      repollTimer = setTimeout(() => {
        repollTimer = null;
        void flush();
      }, hasFastAttempt ? 2_500 : 15_000);
    }
  }
}
