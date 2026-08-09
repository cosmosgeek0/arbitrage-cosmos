// Client side of the server icon resolver. TokenIcon asks for a base; we batch
// the asks, hit /api/icons, and because the server resolves unknowns in the
// background, we re-poll the still-unresolved ones a few times. When a real URL
// arrives, subscribers re-render and their monogram upgrades to the logo.

import { fetchJson } from './http';

export type IconManifestOwner = 'token' | 'markets';

const remote = new Map<string, string>(); // BASE -> logo url
const requested = new Set<string>(); // asked at least once
const unresolved = new Set<string>(); // asked, not yet resolved
const subs = new Set<() => void>();
const lastQueried = new Map<string, number>();
const attempts = new Map<string, number>();
const demand = new Map<string, Record<IconManifestOwner, number>>();
const FAST_ATTEMPTS = 8;
const MAX_ATTEMPTS = 80;
const MAX_BATCH_SIZE = 200;
const OWNER_ORDER: readonly IconManifestOwner[] = ['token', 'markets'];

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let repollTimer: ReturnType<typeof setTimeout> | null = null;
let flushRunning = false;
let flushQueued = false;
let workGeneration = 0;
let activeQuery: AbortController | null = null;
const activeOwners = new Map<string, IconManifestOwner>();
const admission: Record<IconManifestOwner, { enabled: boolean; generation: number }> = {
  token: { enabled: false, generation: 0 },
  markets: { enabled: false, generation: 0 },
};

interface OwnerBatch {
  readonly owner: IconManifestOwner;
  readonly admissionGeneration: number;
  readonly bases: readonly string[];
}

function clearManifestTimers(): void {
  if (flushTimer !== null) clearTimeout(flushTimer);
  if (repollTimer !== null) clearTimeout(repollTimer);
  flushTimer = null;
  repollTimer = null;
  flushQueued = false;
}

function pauseManifestWork(): void {
  clearManifestTimers();
  workGeneration += 1;
  activeQuery?.abort();
}

function baseWorkAdmitted(base: string): boolean {
  const counts = demand.get(base);
  return counts !== undefined && (
    (admission.token.enabled && counts.token > 0)
    || (admission.markets.enabled && counts.markets > 0)
  );
}

function admittedOwner(base: string): IconManifestOwner | null {
  const counts = demand.get(base);
  if (counts === undefined) return null;
  for (const owner of OWNER_ORDER) {
    if (admission[owner].enabled && counts[owner] > 0) return owner;
  }
  return null;
}

function manifestWorkAdmitted(): boolean {
  return subs.size > 0 && [...unresolved].some(baseWorkAdmitted);
}

function manifestRetryAdmitted(): boolean {
  return manifestWorkAdmitted() && [...unresolved].some(
    (base) => baseWorkAdmitted(base) && (attempts.get(base) ?? 0) < MAX_ATTEMPTS,
  );
}

function scheduleFlush(delayMs: number): void {
  if (!manifestWorkAdmitted() || flushTimer !== null) return;
  flushTimer = setTimeout(() => void flush(), delayMs);
}

/**
 * Token and Markets own independent upstream admission. Their generations are
 * deliberately not combined: opening Markets must not admit demand registered
 * by TokenIcons elsewhere in the shell. Already-resolved URLs remain readable
 * by every TokenIcon while closing either owner only stops that owner's work.
 */
export function setIconManifestAdmission(
  owner: IconManifestOwner,
  enabled: boolean,
  generation: number,
): void {
  const canonicalGeneration = Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
  const current = admission[owner];
  if (canonicalGeneration < current.generation) return;
  if (current.enabled === enabled && current.generation === canonicalGeneration) return;
  admission[owner] = { enabled, generation: canonicalGeneration };
  if (enabled) {
    for (const [base, counts] of demand) {
      if (counts[owner] === 0 || remote.has(base)) continue;
      attempts.set(base, 0);
      lastQueried.delete(base);
    }
  }
  pauseManifestWork();
  if (manifestWorkAdmitted()) scheduleFlush(0);
}

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
  if (unresolved.size > 0) scheduleFlush(0);
  return () => {
    subs.delete(fn);
    if (subs.size === 0) pauseManifestWork();
  };
}

/**
 * Registers one subscriber's unresolved demand and returns its exact release.
 * TokenIcon uses Token ownership by default; the Markets page explicitly
 * primes its own owner-scoped set through primeIcons.
 */
export function requestIcon(base: string, owner: IconManifestOwner = 'token'): () => void {
  const b = canonicalBase(base);
  if (!b || remote.has(b)) return () => {};
  const counts = demand.get(b) ?? { token: 0, markets: 0 };
  counts[owner] += 1;
  demand.set(b, counts);
  if (!requested.has(b)) {
    requested.add(b);
    unresolved.add(b);
    attempts.set(b, 0);
  }
  scheduleFlush(250);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = demand.get(b);
    if (current === undefined) return;
    current[owner] = Math.max(0, current[owner] - 1);
    if (current.token > 0 || current.markets > 0) {
      demand.set(b, current);
    } else {
      demand.delete(b);
      unresolved.delete(b);
      requested.delete(b);
      attempts.delete(b);
      lastQueried.delete(b);
    }
    const activeOwnerChanged = activeOwners.get(b) === owner && current[owner] === 0;
    if (activeOwnerChanged || !manifestWorkAdmitted()) {
      pauseManifestWork();
      if (manifestWorkAdmitted()) scheduleFlush(0);
    }
  };
}

export function primeIcons(bases: string[]): () => void {
  const canonical = [...new Set(bases.map(canonicalBase).filter((base): base is string => base !== null))];
  const releases = canonical.map((base) => requestIcon(base, 'markets'));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const release of releases) release();
  };
}

export function iconCoverage(bases: string[]): { total: number; resolved: number; unresolved: number } {
  const unique = [...new Set(bases.map(canonicalBase).filter((base): base is string => base !== null))];
  const resolved = unique.filter((base) => remote.has(base)).length;
  return { total: unique.length, resolved, unresolved: Math.max(0, unique.length - resolved) };
}

function ownerBatchCurrent(batch: OwnerBatch, generation: number, signal: AbortSignal): boolean {
  const current = admission[batch.owner];
  return (
    !signal.aborted
    && workGeneration === generation
    && current.enabled
    && current.generation === batch.admissionGeneration
  );
}

async function query(batch: OwnerBatch, generation: number, signal: AbortSignal): Promise<boolean> {
  if (!batch.bases.length) return false;
  const requestedBases = new Set(batch.bases);
  try {
    const data = await fetchJson<Record<string, string>>(
      `/api/icons?owner=${encodeURIComponent(batch.owner)}&bases=${encodeURIComponent(batch.bases.join(','))}`,
      { cache: 'no-store', signal },
      6_000,
    );
    if (!manifestWorkAdmitted() || !ownerBatchCurrent(batch, generation, signal)) return false;
    let changed = false;
    for (const [b, url] of Object.entries(data)) {
      const base = b.toUpperCase();
      const counts = demand.get(base);
      if (
        /^https?:\/\//.test(url)
        && requestedBases.has(base)
        && unresolved.has(base)
        && counts !== undefined
        && counts[batch.owner] > 0
        && !remote.has(base)
      ) {
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

function buildOwnerBatches(): OwnerBatch[] {
  const selected = [...unresolved]
    .map((base) => ({ base, owner: admittedOwner(base) }))
    .filter(
      (entry): entry is { base: string; owner: IconManifestOwner } => (
        entry.owner !== null && (attempts.get(entry.base) ?? 0) < MAX_ATTEMPTS
      ),
    )
    .sort((a, b) => (lastQueried.get(a.base) ?? 0) - (lastQueried.get(b.base) ?? 0))
    .slice(0, MAX_BATCH_SIZE);
  return OWNER_ORDER.flatMap((owner): OwnerBatch[] => {
    const bases = selected
      .filter((entry) => entry.owner === owner)
      .map((entry) => entry.base);
    return bases.length === 0
      ? []
      : [{
          owner,
          admissionGeneration: admission[owner].generation,
          bases,
        }];
  });
}

async function flush(): Promise<void> {
  flushTimer = null;
  if (!manifestRetryAdmitted()) return;
  if (flushRunning) {
    flushQueued = true;
    return;
  }
  flushRunning = true;
  const owner = workGeneration;
  const controller = new AbortController();
  activeQuery = controller;
  const now = Date.now();
  const batches = buildOwnerBatches();
  activeOwners.clear();
  for (const batch of batches) {
    for (const base of batch.bases) {
      activeOwners.set(base, batch.owner);
      lastQueried.set(base, now);
      attempts.set(base, (attempts.get(base) ?? 0) + 1);
    }
  }
  try {
    const changed = (await Promise.all(
      batches.map((batch) => query(batch, owner, controller.signal)),
    )).some(Boolean);
    if (changed && workGeneration === owner && !controller.signal.aborted) {
      for (const fn of subs) fn();
    }
  } finally {
    if (activeQuery === controller) {
      activeQuery = null;
      activeOwners.clear();
    }
    flushRunning = false;
    if (!manifestWorkAdmitted()) return;
    if (workGeneration !== owner) {
      scheduleFlush(0);
      return;
    }
    if (flushQueued) {
      flushQueued = false;
      scheduleFlush(0);
      return;
    }
    // Each unresolved key owns its retry budget, so keys requested after an
    // earlier batch cannot be stranded by a spent process-global counter.
    const admitted = [...unresolved].filter((base) => baseWorkAdmitted(base));
    if (admitted.some((base) => (attempts.get(base) ?? 0) < MAX_ATTEMPTS) && !repollTimer) {
      const hasFastAttempt = admitted.some((base) => (attempts.get(base) ?? 0) < FAST_ATTEMPTS);
      repollTimer = setTimeout(() => {
        repollTimer = null;
        if (manifestWorkAdmitted() && workGeneration === owner) void flush();
      }, hasFastAttempt ? 2_500 : 15_000);
    }
  }
}
