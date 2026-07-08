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
// CoinGecko keyless throttles harder than its published limit — 1.3s gaps got
// 429s that looked like "no logo". 4.5s converges slower but never lies.
const RESOLVE_GAP_MS = 4500;

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
  const alt = want.replace(/^1000|^1M/, ''); // Binance multiplier contracts (1000SATS, 1MBABYDOGE…)
  const mapped = MATCH_ALIASES[want]?.toUpperCase();
  for (const coin of (data.coins ?? []).slice(0, 10)) {
    const sym = String(coin.symbol ?? '').toUpperCase();
    if (sym === want || sym === alt || (mapped && sym === mapped)) return coin.large ?? coin.thumb ?? null;
  }
  return null;
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  let sinceSave = 0;
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
    // save as we go — a restart mid-drain must never lose resolved logos
    if (url && ++sinceSave >= 5) {
      saveDisk();
      sinceSave = 0;
    }
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
    if (STOCK_TOKENS.has(b)) continue; // equities: no crypto logo exists, never queue
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
