import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertDataDirCachePathHeld,
  resolveDataDirAuthority,
} from '../bootstrap/environment.js';
import { noteCachePersistFailure } from './cachePersistence.js';
import { deterministicOfflinePublicSourcesEnabled } from './publicSourceMode.js';

/**
 * Server-side token-icon resolver (technique adopted from CG Signal Lab, ported
 * to TS). Real coverage for the long-tail Binance tokens that no ticker-keyed
 * CDN has: for any unknown base, hit CoinGecko /search, EXACT-match the symbol
 * (so a wrong project can never slip in), take its logo URL. Resolved URLs are
 * cached to disk so restarts never re-burn the keyless rate budget — coverage
 * accumulates instead of resetting. Background-resolved, rate-friendly.
 */

const CG = 'https://api.coingecko.com/api/v3';
const ICON_TTL = 7 * 86400 * 1000; // successes: 7 days
const ICON_RETRY = 180 * 1000; // failures: retry after 3 min
const DATA_DIR_AUTHORITY = resolveDataDirAuthority();
const { iconCache: DISK } = DATA_DIR_AUTHORITY;
// CoinGecko keyless throttles harder than its published limit — 1.3s gaps got
// 429s that looked like "no logo". 4.5s converges slower but never lies.
const RESOLVE_GAP_MS = 4500;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_SEARCH_BYTES = 512 * 1024;
const MAX_CACHE_ENTRIES = 2_048;

// Ambiguous / short tickers search better by project name; still exact-symbol
// matched afterward so this only disambiguates, never mismatches.
const QUERY_ALIASES: Record<string, string> = {
  // NOTE: verify aliases against live CG search — its index drifts (2026-07:
  // "stepn" stopped returning GMT, "ordinals" stopped returning ORDI).
  ROSE: 'oasis', SNX: 'synthetix', ZIL: 'zilliqa', WOO: 'woo',
  IMX: 'immutable', PORTAL: 'portal gaming', GMT: 'gmt', MEME: 'memecoin',
  ORDI: 'ordi', NFP: 'nfprompt', PIXEL: 'pixels', KSM: 'kusama',
  MINA: 'mina protocol', TLM: 'alien worlds', BANK: 'lorenzo protocol',
  POND: 'marlin', ALLO: 'allora', BREV: 'brevis', BERA: 'berachain',
  NOM: 'onomy protocol', ME: 'magic eden', RE: 'renderevents',
  // one-to-two-letter and rebranded tickers CoinGecko search can't find by symbol
  A: 'vaulta', ACH: 'alchemy pay', AI: 'sleepless ai', AR: 'arweave',
  BEAMX: 'beam', BROCCOLI714: 'broccoli', BTTC: 'bittorrent', C: 'chainbase',
  F: 'synfutures', G: 'gravity', ID: 'space id', IO: 'io.net', LA: 'lagrange',
  OG: 'og fan token', ONE: 'harmony', RAD: 'radworks', RONIN: 'ronin',
  S: 'sonic', STO: 'stakestone', T: 'threshold', THE: 'thena', U: 'union',
  USUAL: 'usual', VELODROME: 'velodrome finance', W: 'wormhole',
  AIGENSYN: 'gensyn', '币安人生': 'binance life',
};

// Bases whose CoinGecko listing carries a different symbol than the Binance
// base — exact-match against this too, never a fuzzy guess.
const MATCH_ALIASES: Record<string, string> = {
  BEAMX: 'BEAM', BTTC: 'BTT', RONIN: 'RON', VELODROME: 'VELO', ONE: 'ONE',
  '币安人生': '币安人生',
};

// Binance tokenized equities (…B suffix) are stocks, not crypto — CoinGecko
// will never have them and a fuzzy hit would paste the WRONG project's logo.
// Resolve them to "no logo" instantly so the client renders its stock badge.
export const STOCK_TOKENS = new Set([
  'AMDB', 'COINB', 'EWYB', 'INTCB', 'MSFTB', 'MSTRB', 'QCOMB', 'WDCB',
  'METAB', 'PLTRB', 'QQQB', 'LITEB', 'TSLAB', 'NVDAB', 'AAPLB', 'GOOGB',
  'AMZNB', 'HOODB', 'CRCLB', 'SPYB',
]);

const cache = new Map<string, { ts: number; url: string | null }>();
const pending = new Set<string>();
let queue: string[] = [];
let draining = false;
let lifecycleState: IconSourceLifecycleState = 'STOPPED';
let lifecycleGeneration = 0;
let lifecycleStartCount = 0;
let lifecycleStopCount = 0;
let lifecycleCancelled = 0;
let activeSearchController: AbortController | null = null;
let drainRun: Promise<void> | null = null;
let stopSettlement: Promise<void> | null = null;
let gapTimer: NodeJS.Timeout | null = null;
let resolveGap: (() => void) | null = null;

export type IconSourceLifecycleState = 'STARTED' | 'STOPPING' | 'STOPPED';

export interface IconSourceLifecycleStatus {
  state: IconSourceLifecycleState;
  generation: number;
  startCount: number;
  stopCount: number;
  lifecycleCancelled: number;
  queued: number;
  pending: number;
  draining: boolean;
  activeRequest: boolean;
}

function incrementBoundedCounter(value: number): number {
  return value < Number.MAX_SAFE_INTEGER ? value + 1 : value;
}

function iconSourceGenerationActive(owner: number): boolean {
  return lifecycleState === 'STARTED' && lifecycleGeneration === owner;
}

function canonicalBase(value: string): string | null {
  const base = value.trim().toUpperCase();
  return /^[A-Z0-9\u3400-\u9fff]{1,24}$/u.test(base) ? base : null;
}

function safeIconUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    const allowed = url.hostname === 'assets.coingecko.com'
      || url.hostname === 'coin-images.coingecko.com'
      || url.hostname.endsWith('.coingecko.com');
    return url.protocol === 'https:' && allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

function cacheSet(base: string, value: { ts: number; url: string | null }): void {
  if (!cache.has(base) && cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(base, value);
}

async function readBoundedJson(res: Response): Promise<{ coins?: { symbol?: string; large?: string; thumb?: string }[] }> {
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error('CoinGecko icon invalid content type');
  }
  const advertised = Number(res.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > MAX_SEARCH_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error('CoinGecko icon response too large');
  }
  if (!res.body) throw new Error('CoinGecko icon invalid JSON');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_SEARCH_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('CoinGecko icon response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as { coins?: { symbol?: string; large?: string; thumb?: string }[] };
  } catch {
    throw new Error('CoinGecko icon invalid JSON');
  }
}

function loadDisk(): void {
  try {
    if (statSync(DISK).size > 4 * 1024 * 1024) return;
    const stored = JSON.parse(readFileSync(DISK, 'utf8')) as Record<string, string>;
    const now = Date.now();
    for (const [rawBase, rawUrl] of Object.entries(stored).slice(0, MAX_CACHE_ENTRIES)) {
      const base = canonicalBase(rawBase);
      const url = safeIconUrl(rawUrl);
      if (base && url) cacheSet(base, { ts: now, url });
    }
  } catch {
    // no cache yet
  }
}

function saveDisk(): void {
  const temp = `${DISK}.${process.pid}.${Date.now()}.tmp`;
  try {
    assertDataDirCachePathHeld(DATA_DIR_AUTHORITY, DISK);
    mkdirSync(path.dirname(DISK), { recursive: true });
    const data: Record<string, string> = {};
    for (const [b, v] of [...cache.entries()].slice(-MAX_CACHE_ENTRIES)) if (v.url) data[b] = v.url;
    assertDataDirCachePathHeld(DATA_DIR_AUTHORITY, DISK);
    writeFileSync(temp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    assertDataDirCachePathHeld(DATA_DIR_AUTHORITY, DISK);
    renameSync(temp, DISK);
  } catch (error) {
    // Non-fatal by design; the count makes the failure class visible (Part 4 #14).
    noteCachePersistFailure('icons', error);
  } finally {
    try { unlinkSync(temp); } catch { /* promoted or never created */ }
  }
}

loadDisk();

async function searchIcon(base: string, controller: AbortController): Promise<string | null> {
  const q = QUERY_ALIASES[base] ?? base;
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let data: { coins?: { symbol?: string; large?: string; thumb?: string }[] };
  try {
    const res = await fetch(`${CG}/search?query=${encodeURIComponent(q)}`, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    data = await readBoundedJson(res);
  } finally {
    clearTimeout(timer);
  }
  const want = base.toUpperCase();
  const alt = want.replace(/^1000|^1M/, ''); // Binance multiplier contracts (1000SATS, 1MBABYDOGE…)
  const mapped = MATCH_ALIASES[want]?.toUpperCase();
  for (const coin of (Array.isArray(data.coins) ? data.coins : []).slice(0, 10)) {
    const sym = String(coin.symbol ?? '').toUpperCase();
    if (sym === want || sym === alt || (mapped && sym === mapped)) return safeIconUrl(coin.large) ?? safeIconUrl(coin.thumb);
  }
  return null;
}

function waitForResolveGap(owner: number): Promise<void> {
  if (!iconSourceGenerationActive(owner)) return Promise.resolve();
  return new Promise((resolve) => {
    resolveGap = resolve;
    gapTimer = setTimeout(() => {
      gapTimer = null;
      resolveGap = null;
      resolve();
    }, RESOLVE_GAP_MS);
    gapTimer.unref?.();
  });
}

function cancelResolveGap(): void {
  if (gapTimer) clearTimeout(gapTimer);
  gapTimer = null;
  const settle = resolveGap;
  resolveGap = null;
  settle?.();
}

async function drain(owner: number): Promise<void> {
  if (draining || !iconSourceGenerationActive(owner)) return;
  draining = true;
  let sinceSave = 0;
  try {
    while (queue.length && iconSourceGenerationActive(owner)) {
      const b = queue.shift()!;
      const controller = new AbortController();
      activeSearchController = controller;
      let url: string | null = null;
      try {
        url = await searchIcon(b, controller);
      } catch {
        if (!iconSourceGenerationActive(owner)) break;
        url = null;
      } finally {
        if (activeSearchController === controller) activeSearchController = null;
      }
      if (!iconSourceGenerationActive(owner)) break;
      cacheSet(b, { ts: Date.now(), url });
      pending.delete(b);
      // save as we go — a restart mid-drain must never lose resolved logos
      if (url && ++sinceSave >= 5) {
        saveDisk();
        sinceSave = 0;
      }
      await waitForResolveGap(owner);
    }
    if (iconSourceGenerationActive(owner)) saveDisk();
  } finally {
    activeSearchController = null;
    draining = false;
  }
}

function ensureDrain(): void {
  if (drainRun || !queue.length || lifecycleState !== 'STARTED') return;
  const owner = lifecycleGeneration;
  const work = drain(owner);
  drainRun = work;
  void work.finally(() => {
    if (drainRun === work) drainRun = null;
    if (iconSourceGenerationActive(owner) && queue.length) ensureDrain();
  });
}

/** Known logo URLs for the requested bases; unknown ones queue for background
 * resolution and appear on a later call. */
export function resolveIcons(bases: string[]): Record<string, string> {
  if (deterministicOfflinePublicSourcesEnabled()) return {};
  const now = Date.now();
  const out: Record<string, string> = {};
  for (const base of bases) {
    const b = canonicalBase(base);
    if (!b) continue;
    if (STOCK_TOKENS.has(b)) continue; // equities: no crypto logo exists, never queue
    const hit = cache.get(b);
    const ttl = hit && hit.url ? ICON_TTL : ICON_RETRY;
    if (hit && now - hit.ts < ttl) {
      if (hit.url) out[b] = hit.url;
    } else if (lifecycleState === 'STARTED' && !pending.has(b) && queue.length < 400) {
      pending.add(b);
      queue.push(b);
    }
  }
  ensureDrain();
  return out;
}

export function iconCacheStats(): { resolved: number; pending: number } {
  let resolved = 0;
  for (const v of cache.values()) if (v.url) resolved++;
  return { resolved, pending: pending.size };
}

export function iconSourceLifecycle(): Readonly<IconSourceLifecycleStatus> {
  return Object.freeze({
    state: lifecycleState,
    generation: lifecycleGeneration,
    startCount: lifecycleStartCount,
    stopCount: lifecycleStopCount,
    lifecycleCancelled,
    queued: queue.length,
    pending: pending.size,
    draining,
    activeRequest: activeSearchController !== null,
  });
}

export function startIconSource(): Readonly<IconSourceLifecycleStatus> {
  if (lifecycleState === 'STARTED' || stopSettlement) return iconSourceLifecycle();
  lifecycleGeneration = incrementBoundedCounter(lifecycleGeneration);
  lifecycleStartCount = incrementBoundedCounter(lifecycleStartCount);
  lifecycleState = 'STARTED';
  ensureDrain();
  return iconSourceLifecycle();
}

export function stopIconSource(): Promise<Readonly<IconSourceLifecycleStatus>> {
  if (stopSettlement) return stopSettlement.then(iconSourceLifecycle);
  if (lifecycleState === 'STOPPED') return Promise.resolve(iconSourceLifecycle());
  lifecycleGeneration = incrementBoundedCounter(lifecycleGeneration);
  const owner = lifecycleGeneration;
  lifecycleStopCount = incrementBoundedCounter(lifecycleStopCount);
  lifecycleState = 'STOPPING';
  lifecycleCancelled = Math.min(Number.MAX_SAFE_INTEGER, lifecycleCancelled + pending.size);
  queue = [];
  pending.clear();
  activeSearchController?.abort(new DOMException('icon source stopped', 'AbortError'));
  cancelResolveGap();
  const owned = drainRun;
  let settle!: () => void;
  const settlement = new Promise<void>((resolve) => {
    settle = resolve;
  });
  stopSettlement = settlement;
  void Promise.allSettled(owned ? [owned] : []).then(() => {
    if (stopSettlement === settlement) {
      if (lifecycleGeneration === owner) lifecycleState = 'STOPPED';
      stopSettlement = null;
    }
    settle();
  });
  return settlement.then(iconSourceLifecycle);
}
