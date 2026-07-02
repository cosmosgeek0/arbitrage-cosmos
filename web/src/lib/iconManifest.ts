// Client side of the server icon resolver. TokenIcon asks for a base; we batch
// the asks, hit /api/icons, and because the server resolves unknowns in the
// background, we re-poll the still-unresolved ones a few times. When a real URL
// arrives, subscribers re-render and their monogram upgrades to the logo.

const remote = new Map<string, string>(); // BASE -> logo url
const requested = new Set<string>(); // asked at least once
const unresolved = new Set<string>(); // asked, not yet resolved
const subs = new Set<() => void>();

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let repollTimer: ReturnType<typeof setTimeout> | null = null;
let repolls = 0;

export function iconUrl(base: string): string | undefined {
  return remote.get(base.toUpperCase());
}

export function onIcons(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function requestIcon(base: string): void {
  const b = base.toUpperCase();
  if (remote.has(b) || requested.has(b)) return;
  requested.add(b);
  unresolved.add(b);
  if (!flushTimer) flushTimer = setTimeout(flush, 250);
}

async function query(bases: string[]): Promise<boolean> {
  if (!bases.length) return false;
  try {
    const res = await fetch(`/api/icons?bases=${bases.join(',')}`);
    if (!res.ok) return false;
    const data = (await res.json()) as Record<string, string>;
    let changed = false;
    for (const [b, url] of Object.entries(data)) {
      if (url && !remote.has(b)) {
        remote.set(b, url);
        unresolved.delete(b);
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
  const batch = [...unresolved].slice(0, 200);
  const changed = await query(batch);
  if (changed) for (const fn of subs) fn();
  // the server resolves unknowns in the background — re-poll a few times so
  // late-resolved logos still upgrade in place.
  if (unresolved.size > 0 && repolls < 8 && !repollTimer) {
    repollTimer = setTimeout(() => {
      repollTimer = null;
      repolls++;
      void flush();
    }, 2500);
  }
}
