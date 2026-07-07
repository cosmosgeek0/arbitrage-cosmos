import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
const DISK = path.resolve(process.cwd(), process.env.ICON_CACHE ?? 'data/icon_cache.json');
const RESOLVE_GAP_MS = 1300; // stay under CoinGecko keyless limits

// Ambiguous / short tickers search better by project name; still exact-symbol
// matched afterward so this only disambiguates, never mismatches.
const QUERY_ALIASES: Record<string, string> = {
  ROSE: 'oasis network', SNX: 'synthetix', ZIL: 'zilliqa', WOO: 'woo network',
  IMX: 'immutable', PORTAL: 'portal gaming', GMT: 'stepn', MEME: 'memecoin',
  ORDI: 'ordinals', NFP: 'nfprompt', PIXEL: 'pixels', KSM: 'kusama',
  MINA: 'mina protocol', TLM: 'alien worlds', BANK: 'lorenzo protocol',
  POND: 'marlin', ALLO: 'allora', BREV: 'brevis', BERA: 'berachain',
  NOM: 'onomy protocol', ME: 'magic eden', RE: 'renderevents',
};

const cache = new Map<string, { ts: number; url: string | null }>();
const pending = new Set<string>();
let queue: string[] = [];
let draining = false;

function loadDisk(): void {
  try {
    const stored = JSON.parse(readFileSync(DISK, 'utf8')) as Record<string, string>;
    const now = Date.now();
    for (const [base, url] of Object.entries(stored)) if (url) cache.set(base.toUpperCase(), { ts: now, url });
  } catch {
    // no cache yet
  }
}

function saveDisk(): void {
  try {
    mkdirSync(path.dirname(DISK), { recursive: true });
    const data: Record<string, string> = {};
    for (const [b, v] of cache) if (v.url) data[b] = v.url;
    writeFileSync(DISK, JSON.stringify(data));
  } catch {
    // non-fatal
  }
}

loadDisk();

async function searchIcon(base: string): Promise<string | null> {
  const q = QUERY_ALIASES[base] ?? base;
  const res = await fetch(`${CG}/search?query=${encodeURIComponent(q)}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { coins?: { symbol?: string; large?: string; thumb?: string }[] };
  const want = base.toUpperCase();
  const alt = want.replace(/^1000/, ''); // Binance multiplier contracts (1000SATS…)
  for (const coin of (data.coins ?? []).slice(0, 10)) {
    const sym = String(coin.symbol ?? '').toUpperCase();
    if (sym === want || sym === alt) return coin.large ?? coin.thumb ?? null;
  }
  return null;
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const b = queue.shift()!;
    let url: string | null = null;
    try {
      url = await searchIcon(b);
    } catch {
      url = null;
    }
    cache.set(b, { ts: Date.now(), url });
    pending.delete(b);
    await new Promise((r) => setTimeout(r, RESOLVE_GAP_MS));
  }
  draining = false;
  saveDisk();
}

/** Known logo URLs for the requested bases; unknown ones queue for background
 * resolution and appear on a later call. */
export function resolveIcons(bases: string[]): Record<string, string> {
  const now = Date.now();
  const out: Record<string, string> = {};
  for (const base of bases) {
    const b = base.toUpperCase();
    const hit = cache.get(b);
    const ttl = hit && hit.url ? ICON_TTL : ICON_RETRY;
    if (hit && now - hit.ts < ttl) {
      if (hit.url) out[b] = hit.url;
    } else if (!pending.has(b) && queue.length < 400) {
      pending.add(b);
      queue.push(b);
    }
  }
  if (queue.length) void drain();
  return out;
}

export function iconCacheStats(): { resolved: number; pending: number } {
  let resolved = 0;
  for (const v of cache.values()) if (v.url) resolved++;
  return { resolved, pending: pending.size };
}
