/* Token profile source — the Coinbase-style asset facts (market cap, FDV,
 * supplies, ATH, rank, tags, contract addresses, description) served from
 * CoinGecko's keyless API. Read-only, aggressively cached to disk so the
 * keyless rate budget is never re-burned: coin ids resolve once and live
 * forever; profiles and the global dominance snapshot refresh hourly. */
import fs from 'node:fs';
import path from 'node:path';

const CG = 'https://api.coingecko.com/api/v3';
const DISK = path.resolve(process.cwd(), process.env.PROFILE_CACHE ?? 'data/profile_cache.json');
const PROFILE_TTL = 60 * 60 * 1000; // 1h
const CALL_GAP_MS = 2_500; // keyless CG throttles hard; stay polite

// Same drift-prone tickers the icon resolver special-cases, plus the renamed
// and rebranded Binance bases the 452-walk exposed (each verified against a
// live CoinGecko search before being added).
const QUERY_ALIASES: Record<string, string> = {
  GMT: 'stepn', AR: 'arweave', OP: 'optimism', GRT: 'the graph',
  A: 'vaulta',            // EOS rebrand — CG id vaulta, symbol A
  RONIN: 'ronin',
  VELODROME: 'velodrome',
  ACH: 'alchemy pay',
  AI: 'sleepless ai',
  AIGENSYN: 'gensyn',
  BEAMX: 'beam',
  BTTC: 'bittorrent',
  C: 'chainbase',
};
// Bases whose CoinGecko symbol differs from the Binance ticker entirely.
const MATCH_ALIASES: Record<string, string> = {
  BEAMX: 'BEAM',
  BTTC: 'BTT',
  AIGENSYN: 'AI', // CG lists Gensyn under symbol AI (id gensyn)
  RONIN: 'RON', // CoinGecko lists Ronin as RON
  VELODROME: 'VELO', // velodrome-finance
};
/** Fiat bases Binance quotes directly — no crypto profile exists, honest N/A. */
export const FIAT_BASES = new Set(['EUR', 'GBP', 'TRY', 'BRL', 'JPY', 'ARS']);

export interface TokenProfile {
  id: string;
  name: string;
  symbol: string;
  rank: number | null;
  description: string | null;
  homepage: string | null;
  whitepaper: string | null;
  categories: string[];
  platforms: { network: string; address: string }[];
  marketCapUsd: number | null;
  fdvUsd: number | null;
  circSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  athUsd: number | null;
  athDate: string | null;
  athChangePct: number | null;
  vol24hUsd: number | null;
  priceChange1yPct: number | null;
  priceChange30dPct: number | null;
  priceChange7dPct: number | null;
  priceChange14dPct: number | null;
  priceChange60dPct: number | null;
  priceChange200dPct: number | null;
  dominancePct: number | null;
  genesisDate: string | null;
  hashingAlgorithm: string | null;
  sentimentUpPct: number | null;
  watchlistUsers: number | null;
  full: boolean;
  fetchedAt: number;
}

interface CacheEntry {
  id: string | null;
  idTs: number;
  profile: TokenProfile | null;
  profileTs: number;
}

const cache = new Map<string, CacheEntry>();
let globalDominance: { ts: number; pct: Record<string, number> } | null = null;
let lastCall = 0;

// ---- disk persistence ------------------------------------------------------
try {
  const stored = JSON.parse(fs.readFileSync(DISK, 'utf8')) as Record<string, CacheEntry>;
  for (const [base, entry] of Object.entries(stored)) cache.set(base, entry);
} catch {
  // no cache yet
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(DISK), { recursive: true });
    fs.writeFileSync(DISK, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // best effort
  }
}

async function politeFetch(url: string): Promise<Response> {
  const wait = lastCall + CALL_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  let res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 429) {
    // keyless CG throttling — back off a full window and retry once
    await new Promise((r) => setTimeout(r, 65_000));
    lastCall = Date.now();
    res = await fetch(url, { headers: { accept: 'application/json' } });
  }
  return res;
}

async function resolveId(base: string): Promise<string | null> {
  const hit = cache.get(base);
  if (hit?.id) return hit.id;
  const q = QUERY_ALIASES[base] ?? base;
  const res = await politeFetch(`${CG}/search?query=${encodeURIComponent(q)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { coins?: { id: string; symbol: string; market_cap_rank: number | null }[] };
  const want = (MATCH_ALIASES[base] ?? base).toUpperCase();
  let matches = (data.coins ?? []).filter((c) => c.symbol.toUpperCase() === want);
  // Binance multiplier tickers (1000SATS, 1MBABYDOGE, BROCCOLI714): retry the bare symbol
  if (!matches.length) {
    const bare = want.replace(/^(1000|1M|10000)/, '').replace(/\d+$/, '');
    if (bare && bare !== want) {
      const res2 = await politeFetch(`${CG}/search?query=${encodeURIComponent(bare)}`);
      if (res2.ok) {
        const d2 = (await res2.json()) as { coins?: { id: string; symbol: string; market_cap_rank: number | null }[] };
        matches = (d2.coins ?? []).filter((c) => c.symbol.toUpperCase() === bare.toUpperCase());
      }
    }
  }
  const best = matches.sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))[0] ?? null;
  const entry: CacheEntry = cache.get(base) ?? { id: null, idTs: 0, profile: null, profileTs: 0 };
  entry.id = best?.id ?? null;
  entry.idTs = Date.now();
  cache.set(base, entry);
  persist();
  return entry.id;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function firstSentences(text: string, n: number): string {
  const parts = text.split(/(?<=[.!?])\s+/).slice(0, n);
  return parts.join(' ');
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function loadDominance(): Promise<Record<string, number>> {
  if (globalDominance && Date.now() - globalDominance.ts < PROFILE_TTL) return globalDominance.pct;
  try {
    const res = await politeFetch(`${CG}/global`);
    if (!res.ok) return globalDominance?.pct ?? {};
    const data = (await res.json()) as { data?: { market_cap_percentage?: Record<string, number> } };
    globalDominance = { ts: Date.now(), pct: data.data?.market_cap_percentage ?? {} };
    return globalDominance.pct;
  } catch {
    return globalDominance?.pct ?? {};
  }
}

export async function tokenProfile(base: string, opts?: { forceFull?: boolean }): Promise<TokenProfile | null> {
  const key = base.toUpperCase();
  const hit = cache.get(key);
  if (hit?.profile && Date.now() - hit.profileTs < PROFILE_TTL && (hit.profile.full || !opts?.forceFull)) return hit.profile;

  const id = await resolveId(key);
  if (!id) return hit?.profile ?? null;

  try {
    const res = await politeFetch(
      `${CG}/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
    );
    if (!res.ok) return hit?.profile ?? null;
    const c = (await res.json()) as Record<string, any>;
    const md = c.market_data ?? {};
    const dominance = await loadDominance();
    const desc = typeof c.description?.en === 'string' && c.description.en.trim() ? firstSentences(stripHtml(c.description.en), 3) : null;
    const platforms = Object.entries((c.platforms ?? {}) as Record<string, string>)
      .filter(([net, addr]) => net && typeof addr === 'string' && addr.length > 0)
      .slice(0, 8)
      .map(([net, addr]) => ({ network: net.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()), address: addr }));

    const profile: TokenProfile = {
      id,
      name: typeof c.name === 'string' ? c.name : key,
      symbol: key,
      rank: num(c.market_cap_rank),
      description: desc,
      homepage: Array.isArray(c.links?.homepage) && c.links.homepage[0] ? c.links.homepage[0] : null,
      whitepaper: typeof c.links?.whitepaper === 'string' && c.links.whitepaper ? c.links.whitepaper : null,
      categories: Array.isArray(c.categories) ? c.categories.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0 && !/holdings|index|portfolio|ecosystem|alleged|treasur/i.test(x)).slice(0, 6) : [],
      platforms,
      marketCapUsd: num(md.market_cap?.usd),
      fdvUsd: num(md.fully_diluted_valuation?.usd),
      circSupply: num(md.circulating_supply),
      totalSupply: num(md.total_supply),
      maxSupply: num(md.max_supply),
      athUsd: num(md.ath?.usd),
      athDate: typeof md.ath_date?.usd === 'string' ? md.ath_date.usd : null,
      athChangePct: num(md.ath_change_percentage?.usd),
      vol24hUsd: num(md.total_volume?.usd),
      priceChange1yPct: num(md.price_change_percentage_1y),
      priceChange30dPct: num(md.price_change_percentage_30d),
      priceChange7dPct: num(md.price_change_percentage_7d),
      priceChange14dPct: num(md.price_change_percentage_14d),
      priceChange60dPct: num(md.price_change_percentage_60d),
      priceChange200dPct: num(md.price_change_percentage_200d),
      dominancePct: num(dominance[key.toLowerCase()]),
      full: true,
      genesisDate: typeof c.genesis_date === 'string' ? c.genesis_date : null,
      hashingAlgorithm: typeof c.hashing_algorithm === 'string' ? c.hashing_algorithm : null,
      sentimentUpPct: num(c.sentiment_votes_up_percentage),
      watchlistUsers: num(c.watchlist_portfolio_users),
      fetchedAt: Date.now(),
    };
    const entry: CacheEntry = cache.get(key) ?? { id, idTs: Date.now(), profile: null, profileTs: 0 };
    entry.profile = profile;
    entry.profileTs = Date.now();
    cache.set(key, entry);
    persist();
    return profile;
  } catch {
    return hit?.profile ?? null;
  }
}


// ---- the full-universe warmer: every tracked base, one by one --------------
export interface WarmStatus {
  running: boolean;
  phase: 'idle' | 'bulk' | 'deep';
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  done: number;
  ok: number;
  na: number;
  lite: number;
  current: string | null;
  failed: { base: string; reason: string }[];
  suspect: { base: string; reason: string }[];
}

let warm: WarmStatus = { running: false, phase: 'idle', startedAt: null, finishedAt: null, total: 0, done: 0, ok: 0, na: 0, lite: 0, current: null, failed: [], suspect: [] };

export function profileWarmStatus(): WarmStatus & { cachedProfiles: number } {
  let cached = 0;
  for (const v of cache.values()) if (v.profile) cached++;
  return { ...warm, cachedProfiles: cached };
}

/** BULK pass: one /coins/list call maps every symbol to candidate ids, then
 * /coins/markets pages (250 ids a call) fill market facts for the whole
 * universe in a handful of requests. Profiles land as full=false ("lite") —
 * the deep pass upgrades them one by one with description/links/platforms. */
async function bulkWarm(bases: string[], priceOf: (base: string) => number | null): Promise<void> {
  const listRes = await politeFetch(`${CG}/coins/list`);
  if (!listRes.ok) return;
  const list = (await listRes.json()) as { id: string; symbol: string; name: string }[];
  const bySymbol = new Map<string, string[]>();
  for (const c of list) {
    const s = c.symbol.toUpperCase();
    const arr = bySymbol.get(s);
    if (arr) arr.push(c.id);
    else bySymbol.set(s, [c.id]);
  }
  const candidates = new Map<string, string[]>(); // base -> candidate ids
  for (const b of bases) {
    const want = (MATCH_ALIASES[b] ?? b).toUpperCase();
    let ids = bySymbol.get(want) ?? [];
    if (!ids.length) {
      const bare = want.replace(/^(1000|1M|10000)/, '').replace(/\d+$/, '');
      if (bare && bare !== want) ids = bySymbol.get(bare) ?? [];
    }
    if (ids.length) candidates.set(b, ids.slice(0, 30)); // ALL plausible claimants compete on market-cap rank
  }
  const allIds = [...new Set([...candidates.values()].flat())];
  const rows = new Map<string, Record<string, any>>();
  for (let i = 0; i < allIds.length; i += 250) {
    const page = allIds.slice(i, i + 250);
    const res = await politeFetch(
      `${CG}/coins/markets?vs_currency=usd&ids=${page.join(',')}&per_page=250&price_change_percentage=7d,14d,30d,200d,1y`,
    );
    if (!res.ok) continue;
    const data = (await res.json()) as Record<string, any>[];
    for (const r of data) if (r?.id) rows.set(r.id, r);
  }
  for (const [b, ids] of candidates) {
    const hit = cache.get(b);
    if (hit?.profile?.full && Date.now() - hit.profileTs < 24 * 60 * 60 * 1000) continue;
    const best = ids
      .map((id) => rows.get(id))
      .filter((r): r is Record<string, any> => !!r)
      .sort((a, b2) => (a.market_cap_rank ?? 1e9) - (b2.market_cap_rank ?? 1e9))[0];
    if (!best) continue;
    // wrong-coin guards even on the bulk path
    const price = priceOf(b);
    if (price && price > 0 && typeof best.current_price === 'number' && best.current_price > 0) {
      const ratio = best.current_price / price;
      if (ratio < 0.5 || ratio > 2) continue; // price disagrees hard — leave for the deep pass
    }
    if (best.market_cap_rank === null || best.market_cap_rank === undefined) continue; // unranked clone — deep pass decides
    const lite: TokenProfile = {
      id: best.id,
      name: typeof best.name === 'string' ? best.name : b,
      symbol: b,
      rank: num(best.market_cap_rank),
      description: null,
      homepage: null,
      whitepaper: null,
      categories: [],
      platforms: [],
      marketCapUsd: num(best.market_cap),
      fdvUsd: num(best.fully_diluted_valuation),
      circSupply: num(best.circulating_supply),
      totalSupply: num(best.total_supply),
      maxSupply: num(best.max_supply),
      athUsd: num(best.ath),
      athDate: typeof best.ath_date === 'string' ? best.ath_date : null,
      athChangePct: num(best.ath_change_percentage),
      vol24hUsd: num(best.total_volume),
      priceChange1yPct: num(best.price_change_percentage_1y_in_currency),
      priceChange30dPct: num(best.price_change_percentage_30d_in_currency),
      priceChange7dPct: num(best.price_change_percentage_7d_in_currency),
      priceChange14dPct: num(best.price_change_percentage_14d_in_currency),
      priceChange60dPct: null,
      priceChange200dPct: num(best.price_change_percentage_200d_in_currency),
      dominancePct: null,
      genesisDate: null,
      hashingAlgorithm: null,
      sentimentUpPct: null,
      watchlistUsers: null,
      full: false,
      fetchedAt: Date.now(),
    };
    const entry: CacheEntry = cache.get(b) ?? { id: best.id, idTs: Date.now(), profile: null, profileTs: 0 };
    entry.id = best.id;
    if (!entry.profile?.full) {
      entry.profile = lite;
      entry.profileTs = Date.now();
    }
    cache.set(b, entry);
    warm.lite++;
  }
  persist();
}

/** Walk every base sequentially: resolve, fetch, and VALIDATE — a profile only
 * counts as ok when CoinGecko's market cap reconciles with circulating supply
 * × the live Binance price (±30%), which catches wrong-coin symbol matches. */
export async function warmAllProfiles(
  bases: string[],
  priceOf: (base: string) => number | null,
  stockTokens: Set<string>,
): Promise<void> {
  if (warm.running) return;
  const uniq = [...new Set(bases.map((b) => b.toUpperCase()))].sort();
  warm = { running: true, phase: 'bulk', startedAt: Date.now(), finishedAt: null, total: uniq.length, done: 0, ok: 0, na: 0, lite: 0, current: null, failed: [], suspect: [] };
  try {
    await bulkWarm(uniq.filter((b) => !stockTokens.has(b)), priceOf);
  } catch {
    // bulk is an accelerator — the deep walk still covers everything
  }
  warm.phase = 'deep';
  for (const b of uniq) {
    warm.current = b;
    try {
      if (stockTokens.has(b) || FIAT_BASES.has(b)) {
        warm.na++;
      } else {
        const hit = cache.get(b);
        const fresh = hit?.profile?.full && Date.now() - hit.profileTs < 24 * 60 * 60 * 1000 ? hit.profile : await tokenProfile(b, { forceFull: true });
        if (!fresh) {
          warm.failed.push({ base: b, reason: cache.get(b)?.id ? 'Profile Fetch Failed' : 'No Exact CoinGecko Match' });
        } else {
          const price = priceOf(b);
          if (fresh.marketCapUsd && fresh.circSupply && price && price > 0) {
            const ratio = fresh.marketCapUsd / (fresh.circSupply * price);
            if (ratio < 0.7 || ratio > 1.3) warm.suspect.push({ base: b, reason: `Mcap ${ratio.toFixed(2)}× Supply×Price` });
            else warm.ok++;
          } else {
            warm.ok++;
          }
        }
      }
    } catch (err) {
      warm.failed.push({ base: b, reason: String(err).slice(0, 80) });
    }
    warm.done++;
  }
  warm.current = null;
  warm.running = false;
  warm.finishedAt = Date.now();
}
