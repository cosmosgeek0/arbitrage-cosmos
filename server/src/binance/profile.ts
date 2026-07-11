/* Token profile source — the Coinbase-style asset facts (market cap, FDV,
 * supplies, ATH, rank, tags, contract addresses, description) served from
 * CoinGecko's keyless API. Read-only, aggressively cached to disk so the
 * keyless rate budget is never re-burned: coin ids resolve once and live
 * until an authoritative identity correction supersedes them; profiles and
 * the global dominance snapshot refresh hourly. */
import fs from 'node:fs';
import path from 'node:path';

const CG = 'https://api.coingecko.com/api/v3';
const DISK = path.resolve(process.cwd(), process.env.PROFILE_CACHE ?? 'data/profile_cache.json');
const PROFILE_TTL = 60 * 60 * 1000; // 1h
const CALL_GAP_MS = 2_500; // keyless CG throttles hard; stay polite
const FETCH_TIMEOUT_MS = 12_000;
const MAX_JSON_BYTES = 12 * 1024 * 1024;
const MAX_PROFILE_CACHE_ENTRIES = 2_048;
const MAX_PROFILE_CACHE_BYTES = 16 * 1024 * 1024;
const PROFILE_PERSIST_DEBOUNCE_MS = 250;
const NEGATIVE_ID_TTL_MS = 5 * 60_000;
const FETCH_FAILURE_TTL_MS = 15_000;

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
// Exact CoinGecko identities for collision-prone Binance bases. Symbol-only
// search cannot distinguish canonical assets from lower-ranked bridged copies
// that reuse the same ticker. Keep this list deliberately narrow and only add
// ids verified against CoinGecko's canonical /coins/:id response.
const DIRECT_IDS: Record<string, string> = {
  USDC: 'usd-coin',
  WBTC: 'wrapped-bitcoin',
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
let pacingTail: Promise<void> = Promise.resolve();
const fetchInFlight = new Map<string, Promise<unknown>>();
const fetchFailures = new Map<string, { until: number; message: string }>();
const profileInFlight = new Map<string, Promise<TokenProfile | null>>();
let persistTimer: NodeJS.Timeout | null = null;
let persistDirty = false;
let persistSequence = 0;
let persistTail: Promise<void> = Promise.resolve();

function canonicalBase(value: string): string | null {
  const base = value.trim().toUpperCase();
  return /^[A-Z0-9\u3400-\u9fff]{1,24}$/u.test(base) ? base : null;
}

function cappedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function safePublicUrl(value: unknown): string | null {
  const text = cappedString(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return null;
    url.username = '';
    url.password = '';
    return url.toString().slice(0, 2_048);
  } catch {
    return null;
  }
}

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, max = MAX_PROFILE_CACHE_ENTRIES): void {
  if (!map.has(key) && map.size >= max) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

function safeFetchMessage(err: unknown): string {
  if (err instanceof Error && /^CoinGecko (?:HTTP \d{3}|invalid content type|invalid JSON|response too large|rate limited)$/.test(err.message)) return err.message;
  return 'CoinGecko unavailable';
}

async function readBoundedBody(res: Response): Promise<string> {
  const advertised = Number(res.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > MAX_JSON_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error('CoinGecko response too large');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('CoinGecko response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

async function reserveRequestSlot(): Promise<void> {
  let release!: () => void;
  const previous = pacingTail;
  pacingTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const wait = lastCall + CALL_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();
  release();
}

async function politeJson<T>(urlValue: string): Promise<T> {
  const url = new URL(urlValue);
  if (url.protocol !== 'https:' || url.hostname !== 'api.coingecko.com' || !url.pathname.startsWith('/api/v3/')) {
    throw new Error('CoinGecko unavailable');
  }
  const key = url.toString();
  const failure = fetchFailures.get(key);
  if (failure && failure.until > Date.now()) throw new Error(failure.message);
  if (failure) fetchFailures.delete(key);
  const existing = fetchInFlight.get(key);
  if (existing) return existing as Promise<T>;

  const work = (async (): Promise<T> => {
    await reserveRequestSlot();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: ctrl.signal,
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        if (res.status === 429) throw new Error('CoinGecko rate limited');
        throw new Error(`CoinGecko HTTP ${res.status}`);
      }
      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      if (!contentType.includes('application/json') && !contentType.includes('+json')) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error('CoinGecko invalid content type');
      }
      const text = await readBoundedBody(res);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error('CoinGecko invalid JSON');
      }
    } catch (err) {
      const message = safeFetchMessage(err);
      boundedSet(fetchFailures, key, { until: Date.now() + FETCH_FAILURE_TTL_MS, message }, 512);
      throw new Error(message);
    } finally {
      clearTimeout(timer);
    }
  })();
  boundedSet(fetchInFlight, key, work, 256);
  try {
    return await work;
  } finally {
    fetchInFlight.delete(key);
  }
}

function sanitizeProfile(value: unknown, symbol: string): TokenProfile | null {
  if (!value || typeof value !== 'object') return null;
  const profile = value as Partial<TokenProfile>;
  const id = cappedString(profile.id, 128);
  if (!id || !/^[a-z0-9][a-z0-9-]{0,127}$/i.test(id)) return null;
  const platforms = Array.isArray(profile.platforms)
    ? profile.platforms.slice(0, 8).flatMap((entry) => {
      const network = cappedString(entry?.network, 80);
      const address = cappedString(entry?.address, 256);
      return network && address ? [{ network, address }] : [];
    })
    : [];
  return {
    id,
    name: cappedString(profile.name, 120) ?? symbol,
    symbol,
    rank: num(profile.rank),
    description: cappedString(profile.description, 1_200),
    homepage: safePublicUrl(profile.homepage),
    whitepaper: safePublicUrl(profile.whitepaper),
    categories: Array.isArray(profile.categories)
      ? profile.categories.map((entry) => cappedString(entry, 80)).filter((entry): entry is string => Boolean(entry)).slice(0, 6)
      : [],
    platforms,
    marketCapUsd: num(profile.marketCapUsd),
    fdvUsd: num(profile.fdvUsd),
    circSupply: num(profile.circSupply),
    totalSupply: num(profile.totalSupply),
    maxSupply: num(profile.maxSupply),
    athUsd: num(profile.athUsd),
    athDate: cappedString(profile.athDate, 64),
    athChangePct: num(profile.athChangePct),
    vol24hUsd: num(profile.vol24hUsd),
    priceChange1yPct: num(profile.priceChange1yPct),
    priceChange30dPct: num(profile.priceChange30dPct),
    priceChange7dPct: num(profile.priceChange7dPct),
    priceChange14dPct: num(profile.priceChange14dPct),
    priceChange60dPct: num(profile.priceChange60dPct),
    priceChange200dPct: num(profile.priceChange200dPct),
    dominancePct: num(profile.dominancePct),
    genesisDate: cappedString(profile.genesisDate, 64),
    hashingAlgorithm: cappedString(profile.hashingAlgorithm, 80),
    sentimentUpPct: num(profile.sentimentUpPct),
    watchlistUsers: num(profile.watchlistUsers),
    full: profile.full === true,
    fetchedAt: Number.isFinite(profile.fetchedAt) && Number(profile.fetchedAt) > 0 ? Number(profile.fetchedAt) : 0,
  };
}

function normalizeCacheEntry(value: unknown, symbol: string): CacheEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<CacheEntry>;
  const id = cappedString(entry.id, 128);
  return {
    id: id && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(id) ? id : null,
    idTs: Number.isFinite(entry.idTs) && Number(entry.idTs) > 0 ? Number(entry.idTs) : 0,
    profile: sanitizeProfile(entry.profile, symbol),
    profileTs: Number.isFinite(entry.profileTs) && Number(entry.profileTs) > 0 ? Number(entry.profileTs) : 0,
  };
}

// ---- disk persistence ------------------------------------------------------
try {
  if (fs.statSync(DISK).size > MAX_PROFILE_CACHE_BYTES) throw new Error('profile cache too large');
  const stored = JSON.parse(fs.readFileSync(DISK, 'utf8')) as unknown;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('invalid profile cache');
  for (const [rawBase, rawEntry] of Object.entries(stored).slice(0, MAX_PROFILE_CACHE_ENTRIES)) {
    const base = canonicalBase(rawBase);
    const entry = base ? normalizeCacheEntry(rawEntry, base) : null;
    if (base && entry) cache.set(base, entry);
  }
} catch {
  // no cache yet
}

function serializeProfileCache(): string {
  const parts: string[] = [];
  let bytes = 2; // opening and closing braces
  let rows = 0;
  const entries = [...cache.entries()].slice(-MAX_PROFILE_CACHE_ENTRIES).reverse();
  for (const [base, entry] of entries) {
    const fragment = `${JSON.stringify(base)}:${JSON.stringify(entry)}`;
    const fragmentBytes = Buffer.byteLength(fragment) + (parts.length ? 1 : 0);
    if (fragmentBytes + bytes > MAX_PROFILE_CACHE_BYTES) continue;
    parts.push(fragment);
    bytes += fragmentBytes;
    rows++;
    if (rows >= MAX_PROFILE_CACHE_ENTRIES) break;
  }
  return `{${parts.reverse().join(',')}}`;
}

function enqueueProfilePersist(): Promise<void> {
  if (!persistDirty) return persistTail;
  persistDirty = false;
  let payload: string;
  try {
    payload = serializeProfileCache();
  } catch {
    return persistTail;
  }

  persistTail = persistTail
    .catch(() => undefined)
    .then(async () => {
      const temp = `${DISK}.${process.pid}.${Date.now()}.${++persistSequence}.tmp`;
      try {
        await fs.promises.mkdir(path.dirname(DISK), { recursive: true });
        await fs.promises.writeFile(temp, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx', flush: true });
        await fs.promises.rename(temp, DISK);
      } finally {
        await fs.promises.unlink(temp).catch(() => undefined);
      }
    })
    .catch(() => undefined);
  return persistTail;
}

function persist(): void {
  persistDirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void enqueueProfilePersist();
  }, PROFILE_PERSIST_DEBOUNCE_MS);
  persistTimer.unref?.();
}

export async function flushProfileCache(): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  do {
    if (persistDirty) await enqueueProfilePersist();
    else await persistTail;
  } while (persistDirty);
}

async function resolveId(base: string): Promise<string | null> {
  const hit = cache.get(base);
  const directId = DIRECT_IDS[base];
  if (directId) {
    if (hit?.id !== directId || (hit.profile && hit.profile.id !== directId)) {
      boundedSet(cache, base, {
        id: directId,
        idTs: Date.now(),
        profile: hit?.profile?.id === directId ? hit.profile : null,
        profileTs: hit?.profile?.id === directId ? hit.profileTs : 0,
      });
      persist();
    }
    return directId;
  }
  if (hit?.id) return hit.id;
  if (hit && !hit.id && Date.now() - hit.idTs < NEGATIVE_ID_TTL_MS) return null;
  const q = QUERY_ALIASES[base] ?? base;
  const data = await politeJson<{ coins?: { id: string; symbol: string; market_cap_rank: number | null }[] }>(
    `${CG}/search?query=${encodeURIComponent(q)}`,
  );
  const want = (MATCH_ALIASES[base] ?? base).toUpperCase();
  let matches = (Array.isArray(data.coins) ? data.coins : [])
    .slice(0, 1_000)
    .filter((c) => typeof c?.symbol === 'string'
      && typeof c?.id === 'string'
      && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(c.id)
      && c.symbol.toUpperCase() === want);
  // Binance multiplier tickers (1000SATS, 1MBABYDOGE, BROCCOLI714): retry the bare symbol
  if (!matches.length) {
    const bare = want.replace(/^(1000|1M|10000)/, '').replace(/\d+$/, '');
    if (bare && bare !== want) {
      const d2 = await politeJson<{ coins?: { id: string; symbol: string; market_cap_rank: number | null }[] }>(
        `${CG}/search?query=${encodeURIComponent(bare)}`,
      );
      matches = (Array.isArray(d2.coins) ? d2.coins : [])
        .slice(0, 1_000)
        .filter((c) => typeof c?.symbol === 'string'
          && typeof c?.id === 'string'
          && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(c.id)
          && c.symbol.toUpperCase() === bare.toUpperCase());
    }
  }
  const best = matches.sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))[0] ?? null;
  const entry: CacheEntry = cache.get(base) ?? { id: null, idTs: 0, profile: null, profileTs: 0 };
  entry.id = cappedString(best?.id, 128);
  entry.idTs = Date.now();
  boundedSet(cache, base, entry);
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
    const data = await politeJson<{ data?: { market_cap_percentage?: Record<string, number> } }>(`${CG}/global`);
    const raw = data.data?.market_cap_percentage;
    const pct = raw && typeof raw === 'object'
      ? Object.fromEntries(Object.entries(raw).slice(0, 512).filter(([, value]) => Number.isFinite(value)))
      : {};
    globalDominance = { ts: Date.now(), pct };
    return globalDominance.pct;
  } catch {
    return globalDominance?.pct ?? {};
  }
}

export async function tokenProfile(base: string, opts?: { forceFull?: boolean }): Promise<TokenProfile | null> {
  const key = canonicalBase(base);
  if (!key) return null;
  const hit = cache.get(key);
  const directId = DIRECT_IDS[key];
  const cachedIdentityIsCanonical = !directId || hit?.profile?.id === directId;
  if (hit?.profile && cachedIdentityIsCanonical && Date.now() - hit.profileTs < PROFILE_TTL && (hit.profile.full || !opts?.forceFull)) return hit.profile;

  const flightKey = `${key}:${opts?.forceFull ? 'full' : 'any'}`;
  const existing = profileInFlight.get(flightKey);
  if (existing) return existing;
  const work = (async (): Promise<TokenProfile | null> => {
    try {
      const id = await resolveId(key);
      if (!id) return hit?.profile ?? null;
      const c = await politeJson<Record<string, any>>(
        `${CG}/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
      );
      const md = c.market_data ?? {};
      const dominance = await loadDominance();
      const desc = typeof c.description?.en === 'string' && c.description.en.trim()
        ? cappedString(firstSentences(stripHtml(c.description.en), 3), 1_200)
        : null;
      const platforms = Object.entries((c.platforms ?? {}) as Record<string, string>)
        .filter(([net, addr]) => net && typeof addr === 'string' && addr.length > 0)
        .slice(0, 8)
        .flatMap(([net, addr]) => {
          const network = cappedString(net.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()), 80);
          const address = cappedString(addr, 256);
          return network && address ? [{ network, address }] : [];
        });

      const profile: TokenProfile = {
        id: cappedString(id, 128) ?? key.toLowerCase(),
        name: cappedString(c.name, 120) ?? key,
        symbol: key,
        rank: num(c.market_cap_rank),
        description: desc,
        homepage: Array.isArray(c.links?.homepage) ? safePublicUrl(c.links.homepage[0]) : null,
        whitepaper: safePublicUrl(c.links?.whitepaper),
        categories: Array.isArray(c.categories)
          ? c.categories
            .filter((x: unknown): x is string => typeof x === 'string' && x.length > 0 && !/holdings|index|portfolio|ecosystem|alleged|treasur/i.test(x))
            .map((x: string) => cappedString(x, 80))
            .filter((x: string | null): x is string => Boolean(x))
            .slice(0, 6)
          : [],
        platforms,
        marketCapUsd: num(md.market_cap?.usd),
        fdvUsd: num(md.fully_diluted_valuation?.usd),
        circSupply: num(md.circulating_supply),
        totalSupply: num(md.total_supply),
        maxSupply: num(md.max_supply),
        athUsd: num(md.ath?.usd),
        athDate: cappedString(md.ath_date?.usd, 64),
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
        genesisDate: cappedString(c.genesis_date, 64),
        hashingAlgorithm: cappedString(c.hashing_algorithm, 80),
        sentimentUpPct: num(c.sentiment_votes_up_percentage),
        watchlistUsers: num(c.watchlist_portfolio_users),
        fetchedAt: Date.now(),
      };
      const entry: CacheEntry = cache.get(key) ?? { id, idTs: Date.now(), profile: null, profileTs: 0 };
      entry.profile = profile;
      entry.profileTs = Date.now();
      boundedSet(cache, key, entry);
      persist();
      return profile;
    } catch {
      return hit?.profile ?? null;
    }
  })();
  boundedSet(profileInFlight, flightKey, work, 512);
  try {
    return await work;
  } finally {
    profileInFlight.delete(flightKey);
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
  const listRaw = await politeJson<{ id: string; symbol: string; name: string }[]>(`${CG}/coins/list`);
  const list = Array.isArray(listRaw) ? listRaw.slice(0, 50_000) : [];
  const bySymbol = new Map<string, string[]>();
  for (const c of list) {
    if (!c || typeof c.symbol !== 'string' || typeof c.id !== 'string') continue;
    const s = c.symbol.toUpperCase();
    if (!/^[A-Z0-9\u3400-\u9fff]{1,24}$/u.test(s) || !/^[a-z0-9][a-z0-9-]{0,127}$/i.test(c.id)) continue;
    const arr = bySymbol.get(s);
    if (arr) {
      if (arr.length < 30) arr.push(c.id);
    } else {
      bySymbol.set(s, [c.id]);
    }
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
  const allIds = [...new Set([...candidates.values()].flat())].slice(0, 15_000);
  const rows = new Map<string, Record<string, any>>();
  for (let i = 0; i < allIds.length; i += 250) {
    const page = allIds.slice(i, i + 250);
    const dataRaw = await politeJson<Record<string, any>[]>(
      `${CG}/coins/markets?vs_currency=usd&ids=${page.join(',')}&per_page=250&price_change_percentage=7d,14d,30d,200d,1y`,
    );
    const data = Array.isArray(dataRaw) ? dataRaw.slice(0, 250) : [];
    for (const r of data) {
      if (typeof r?.id === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(r.id)) rows.set(r.id, r);
    }
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
      id: cappedString(best.id, 128) ?? b.toLowerCase(),
      name: cappedString(best.name, 120) ?? b,
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
      athDate: cappedString(best.ath_date, 64),
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
    entry.id = cappedString(best.id, 128);
    if (!entry.profile?.full) {
      entry.profile = lite;
      entry.profileTs = Date.now();
    }
    boundedSet(cache, b, entry);
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
  const uniq = [...new Set(bases.map(canonicalBase).filter((b): b is string => Boolean(b)))].sort().slice(0, MAX_PROFILE_CACHE_ENTRIES);
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
    } catch {
      warm.failed.push({ base: b, reason: 'Profile Fetch Failed' });
    }
    warm.done++;
  }
  warm.current = null;
  warm.running = false;
  warm.finishedAt = Date.now();
}
