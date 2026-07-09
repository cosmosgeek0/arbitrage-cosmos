import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pill } from '../components/px';
import { IconExternal, IconNewspaper, IconRefresh, IconSearch } from '../components/Icons';
import { liveAge } from '../format';
import { useStore } from '../store';
import './Markets.css';

type NewsTone = 'ok' | 'warn' | 'bad' | 'idle';
type ContextChannel = 'primary' | 'venue' | 'tree' | 'rss' | 'lookonchain';
type FeedChannel = ContextChannel | 'binance';
type SourceFilter = string;

interface NewsContextItem {
  id: string;
  title: string;
  summary: string | null;
  url: string | null;
  source: string;
  sourceKey?: string;
  sourceDomain?: string | null;
  channel: FeedChannel;
  ts: number | null;
  timeLabel: string;
  symbols: string[];
  tags: string[];
  tone: NewsTone;
}

interface NewsContextSource {
  key: string;
  label: string;
  status: 'live' | 'delayed' | 'error';
  detail: string;
  fetchedAt: number | null;
  count: number;
  url?: string | null;
  domain?: string | null;
}

interface NewsContextPayload {
  source: string;
  fetchedAt: number;
  items: NewsContextItem[];
  sources: NewsContextSource[];
}

interface BinanceNewsItem {
  id: number;
  title: string;
  date: string | null;
  url: string;
}

interface BinanceNewsPayload {
  catalog: number | string;
  fetchedAt?: number;
  items: BinanceNewsItem[];
}

const READ_KEY = 'cosmos-news-read-v3';
const FEED_CACHE_KEY = 'cosmos-news-feed-cache-v1';

const SOURCE_FILTERS: { id: SourceFilter; label: string }[] = [
  { id: 'all', label: 'All Sources' },
  { id: 'fed', label: 'Federal Reserve Board' },
  { id: 'bls', label: 'BLS' },
  { id: 'bea', label: 'BEA' },
  { id: 'sec', label: 'SEC' },
  { id: 'cftc', label: 'CFTC' },
  { id: 'treasury', label: 'U.S. Treasury' },
  { id: 'ofac', label: 'OFAC' },
  { id: 'ecb', label: 'ECB' },
  { id: 'boe', label: 'Bank of England' },
  { id: 'boj', label: 'Bank of Japan' },
  { id: 'japan-mof', label: 'Japan MOF' },
  { id: 'china-nbs', label: 'China NBS' },
  { id: 'pboc', label: 'PBoC' },
  { id: 'safe', label: 'SAFE' },
  { id: 'binance', label: 'Binance News / Announcements' },
  { id: 'coinbase-assets', label: 'Coinbase / Coinbase Assets' },
  { id: 'kraken', label: 'Kraken' },
  { id: 'okx', label: 'OKX' },
  { id: 'bybit', label: 'Bybit' },
  { id: 'upbit-bithumb', label: 'Upbit / Bithumb' },
  { id: 'deribit', label: 'Deribit' },
  { id: 'cme-crypto', label: 'CME Group Crypto Notices' },
  { id: 'exchange-status', label: 'Exchange Status Pages' },
  { id: 'tree', label: 'Tree Of Alpha Relay' },
  { id: 'financialjuice', label: 'FinancialJuice' },
  { id: 'wsj-markets', label: 'WSJ Markets RSS' },
  { id: 'benzinga', label: 'Benzinga' },
  { id: 'ft-alphaville', label: 'FT Alphaville' },
  { id: 'cnbc-markets', label: 'CNBC Markets' },
  { id: 'marketwatch', label: 'MarketWatch' },
  { id: 'yahoo-finance', label: 'Yahoo Finance' },
  { id: 'investing-news', label: 'Investing.com News' },
  { id: 'nasdaq-news', label: 'Nasdaq News / Market Activity' },
  { id: 'ap-business', label: 'AP Business' },
  { id: 'coindesk', label: 'CoinDesk' },
  { id: 'the-block', label: 'The Block' },
  { id: 'wublockchain', label: 'WuBlockchain / Substack' },
  { id: 'lookonchain', label: 'Lookonchain' },
  { id: 'zerohedge', label: 'ZeroHedge' },
  { id: 'watcherguru', label: 'WatcherGuru' },
  { id: 'cointelegraph', label: 'Cointelegraph' },
  { id: 'decrypt', label: 'Decrypt' },
  { id: 'cryptoslate', label: 'CryptoSlate' },
  { id: 'bitcoin-magazine', label: 'Bitcoin Magazine' },
  { id: 'crypto-briefing', label: 'Crypto Briefing' },
];
const SOURCE_PRIORITY: Record<FeedChannel, number> = {
  primary: 0,
  venue: 1,
  binance: 2,
  tree: 3,
  lookonchain: 4,
  rss: 5,
};
const PRIMARY_SOURCE_KEYS = new Set([
  'fed', 'bls', 'bea', 'sec', 'cftc', 'treasury', 'ofac', 'ecb', 'boe',
  'boj', 'japan-mof', 'china-nbs', 'pboc', 'safe',
]);
const VENUE_SOURCE_KEYS = new Set([
  'coinbase-assets', 'kraken', 'okx', 'bybit', 'upbit-bithumb', 'deribit',
  'cme-crypto', 'exchange-status',
]);
const SOURCE_DIVERSITY_WINDOW_MS = 45 * 60_000;

const SOURCE_DOMAINS: Record<string, string> = {
  fed: 'federalreserve.gov',
  'federal reserve board': 'federalreserve.gov',
  bls: 'bls.gov',
  bea: 'bea.gov',
  sec: 'sec.gov',
  cftc: 'cftc.gov',
  treasury: 'home.treasury.gov',
  'u.s. treasury': 'home.treasury.gov',
  ofac: 'ofac.treasury.gov',
  ecb: 'ecb.europa.eu',
  boe: 'bankofengland.co.uk',
  'bank of england': 'bankofengland.co.uk',
  boj: 'boj.or.jp',
  'bank of japan': 'boj.or.jp',
  'japan mof': 'mof.go.jp',
  'japan-mof': 'mof.go.jp',
  'china nbs': 'stats.gov.cn',
  'china-nbs': 'stats.gov.cn',
  pboc: 'pbc.gov.cn',
  safe: 'safe.gov.cn',
  binance: 'binance.com',
  'binance official': 'binance.com',
  'coinbase-assets': 'coinbase.com',
  'coinbase / coinbase assets': 'coinbase.com',
  'coinbase exchange': 'coinbase.com',
  kraken: 'blog.kraken.com',
  okx: 'okx.com',
  bybit: 'announcements.bybit.com',
  'upbit-bithumb': 'upbit.com',
  'upbit / bithumb': 'upbit.com',
  upbit: 'upbit.com',
  bithumb: 'bithumb.com',
  deribit: 'insights.deribit.com',
  'cme-crypto': 'cmegroup.com',
  'cme group crypto notices': 'cmegroup.com',
  'cme group press releases': 'cmegroup.com',
  'cme globex notice': 'cmegroup.com',
  'exchange-status': 'status.coinbase.com',
  'exchange status pages': 'status.coinbase.com',
  'coinbase status': 'status.coinbase.com',
  'kraken status': 'status.kraken.com',
  'okx status': 'okx.com',
  'bybit system status': 'bybit.com',
  financialjuice: 'financialjuice.com',
  'wsj markets rss': 'wsj.com',
  'ft-alphaville': 'ft.com',
  'ft alphaville': 'ft.com',
  alphaville: 'ft.com',
  'cnbc-markets': 'cnbc.com',
  'cnbc markets': 'cnbc.com',
  marketwatch: 'marketwatch.com',
  'yahoo-finance': 'finance.yahoo.com',
  'yahoo finance': 'finance.yahoo.com',
  'investing-news': 'investing.com',
  'investing.com news': 'investing.com',
  'nasdaq-news': 'nasdaq.com',
  'nasdaq news / market activity': 'nasdaq.com',
  'ap-business': 'apnews.com',
  'ap business': 'apnews.com',
  'tree of alpha relay': 'treeofalpha.com',
  'wublockchain / substack': 'wublock.substack.com',
  watcherguru: 'watcher.guru',
  'binance news / announcements': 'binance.com',
  'bitcoin magazine': 'bitcoinmagazine.com',
  'crypto briefing': 'cryptobriefing.com',
  tree: 'treeofalpha.com',
  rss: 'financialjuice.com',
  lookonchain: 'lookonchain.com',
  'wsj markets': 'wsj.com',
  benzinga: 'benzinga.com',
  'watcher guru': 'watcher.guru',
  zerohedge: 'zerohedge.com',
  coindesk: 'coindesk.com',
  cointelegraph: 'cointelegraph.com',
  'the block': 'theblock.co',
  decrypt: 'decrypt.co',
  beincrypto: 'beincrypto.com',
  newsbtc: 'newsbtc.com',
  ambcrypto: 'ambcrypto.com',
  'u.today': 'u.today',
  cryptoslate: 'cryptoslate.com',
  wublockchain: 'wublock.substack.com',
  twitter: 'x.com',
  x: 'x.com',
};

function readSet(): Set<string> {
  try {
    const ids = JSON.parse(localStorage.getItem(READ_KEY) || '[]') as string[];
    return new Set(ids.filter((id) => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

function persistRead(ids: Set<string>) {
  localStorage.setItem(READ_KEY, JSON.stringify(Array.from(ids).slice(-900)));
}

function readFeedCache(): { context: NewsContextPayload | null; binance: BinanceNewsPayload | null } {
  try {
    const parsed = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || '{}') as Partial<{
      context: NewsContextPayload;
      binance: BinanceNewsPayload;
    }>;
    return {
      context: parsed.context?.items ? parsed.context : null,
      binance: parsed.binance?.items ? parsed.binance : null,
    };
  } catch {
    return { context: null, binance: null };
  }
}

function persistFeedCache(context: NewsContextPayload | null, binance: BinanceNewsPayload | null) {
  try {
    localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ context, binance }));
  } catch {
    // Cache is only for first-paint continuity; ignore quota/privacy failures.
  }
}

function cleanDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function sourceDomain(source: string | null | undefined, channel?: FeedChannel, url?: string | null, explicitDomain?: string | null): string | null {
  if (explicitDomain) return explicitDomain;
  const fromUrl = cleanDomain(url);
  if (fromUrl) return fromUrl;
  const key = (source ?? '').trim().toLowerCase();
  return SOURCE_DOMAINS[key] ?? (channel ? SOURCE_DOMAINS[channel] : null) ?? null;
}

function logoUrl(domain: string | null): string | null {
  return domain ? `/api/source-logo?domain=${encodeURIComponent(domain)}&sz=64` : null;
}

function SourceLogo({ domain, label, size = 28 }: { domain: string | null; label: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [domain]);
  const src = !failed ? logoUrl(domain) : null;
  return (
    <span className="nwx-logo" style={{ width: size, height: size }} title={domain ?? label} aria-label={`${label} Logo`}>
      {src ? (
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <IconNewspaper size={Math.max(13, size - 10)} />
      )}
    </span>
  );
}

function channelLabel(channel: FeedChannel): string {
  if (channel === 'primary') return 'Primary';
  if (channel === 'venue') return 'Venue';
  if (channel === 'binance') return 'Official';
  if (channel === 'tree') return 'Tree';
  if (channel === 'lookonchain') return 'Lookonchain';
  return 'RSS';
}

function sourceKeyForItem(item: NewsContextItem): string {
  if (item.sourceKey) return item.sourceKey;
  if (item.channel === 'binance') return 'binance';
  if (item.channel === 'tree') return 'tree';
  if (item.channel === 'lookonchain') return 'lookonchain';
  const label = item.source.trim().toLowerCase();
  const match = SOURCE_FILTERS.find((src) => src.id !== 'all' && src.label.toLowerCase() === label);
  if (match) return match.id;
  const compact = label.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return compact || item.channel;
}

function matchesQuery(item: NewsContextItem, q: string): boolean {
  if (!q) return true;
  const haystack = `${item.title} ${item.summary ?? ''} ${item.source} ${item.tags.join(' ')} ${item.symbols.join(' ')}`.toLowerCase();
  return haystack.includes(q);
}

function displayHeadline(title: string): string {
  const compact = title.replace(/\s+/g, ' ').trim();
  if (compact.length <= 180) return compact;
  const sentence = compact.match(/^.{90,180}?[.!?](?:\s|$)/)?.[0]?.trim();
  const clipped = sentence ?? compact.slice(0, 176).replace(/[,\s;:-]+$/, '');
  return `${clipped}...`;
}

function formatDateLabel(date: string | null): string {
  if (!date) return 'Official';
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return 'Official';
  return new Date(parsed).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function extractBinanceDate(title: string, date: string | null): string | null {
  if (date) return date;
  const match = title.match(/(?:\(|[-–—]\s*)(\d{4}-\d{2}-\d{2})\)?\s*$/);
  return match?.[1] ?? null;
}

function cleanBinanceTitle(title: string): string {
  return title.replace(/\s*(?:\(|[-–—]\s*)\d{4}-\d{2}-\d{2}\)?\s*$/, '').trim();
}

function binanceSortTimestamp(date: string | null): number | null {
  if (!date) return null;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  return parsed > Date.now() ? null : parsed;
}

function mapBinanceItem(item: BinanceNewsItem): NewsContextItem {
  const date = extractBinanceDate(item.title, item.date);
  return {
    id: `binance:${item.id}`,
    title: cleanBinanceTitle(item.title),
    summary: null,
    url: item.url,
    source: 'Binance',
    sourceKey: 'binance',
    sourceDomain: 'binance.com',
    channel: 'binance',
    ts: binanceSortTimestamp(date),
    timeLabel: formatDateLabel(date),
    symbols: [],
    tags: [],
    tone: 'idle',
  };
}

function itemSortTs(item: NewsContextItem): number {
  if (!item.ts || !Number.isFinite(item.ts)) return 0;
  return item.ts > Date.now() ? 0 : item.ts;
}

function itemSortScore(item: NewsContextItem): number {
  const ts = itemSortTs(item);
  const key = sourceKeyForItem(item);
  if (item.channel === 'primary' || PRIMARY_SOURCE_KEYS.has(key)) return ts + 6 * 60 * 60_000;
  if (item.channel === 'venue' || VENUE_SOURCE_KEYS.has(key)) return ts + 5 * 60 * 60_000;
  if (item.channel === 'binance' && /\b(delist|trading pair|margin|futures|launchpool|listing|remove|suspend)\b/i.test(item.title)) {
    return ts + 5 * 60 * 60_000;
  }
  return ts;
}

function compareNewsItems(a: NewsContextItem, b: NewsContextItem): number {
  const byTime = itemSortScore(b) - itemSortScore(a);
  if (byTime !== 0) return byTime;
  const bySource = SOURCE_PRIORITY[a.channel] - SOURCE_PRIORITY[b.channel];
  if (bySource !== 0) return bySource;
  return a.id.localeCompare(b.id);
}

function canPullDiverseCandidate(reference: NewsContextItem, candidate: NewsContextItem): boolean {
  const refTs = itemSortTs(reference);
  const candidateTs = itemSortTs(candidate);
  if (!refTs || !candidateTs) return false;
  return Math.abs(refTs - candidateTs) <= SOURCE_DIVERSITY_WINDOW_MS;
}

function spreadSourceBursts(items: NewsContextItem[]): NewsContextItem[] {
  const pool = [...items];
  const ordered: NewsContextItem[] = [];
  while (pool.length) {
    let pickIndex = 0;
    const last = ordered[ordered.length - 1];
    if (last && sourceKeyForItem(pool[0]) === sourceKeyForItem(last)) {
      const alternateIndex = pool.findIndex((candidate) => sourceKeyForItem(candidate) !== sourceKeyForItem(last) && canPullDiverseCandidate(last, candidate));
      if (alternateIndex > 0) pickIndex = alternateIndex;
    }
    ordered.push(pool.splice(pickIndex, 1)[0]);
  }
  return ordered;
}

function mergeNewsItems(context: NewsContextPayload | null, binance: BinanceNewsPayload | null): NewsContextItem[] {
  const merged = [...(context?.items ?? []), ...(binance?.items ?? []).map(mapBinanceItem)];
  return spreadSourceBursts(merged.sort(compareNewsItems));
}

function NewsRow({ item, read, fresh, onRead }: { item: NewsContextItem; read: boolean; fresh: boolean; onRead: (id: string) => void }) {
  const label = item.source || channelLabel(item.channel);
  const domain = sourceDomain(item.source, item.channel, item.url, item.sourceDomain);
  const content = (
    <>
      <span className="nwx-time num">{item.timeLabel}</span>
      <span className="nwx-provider">
        <SourceLogo domain={domain} label={label} />
        <span><b>{label}</b><em>{channelLabel(item.channel)}</em></span>
      </span>
      <span className="nwx-headline-cell">
        <b title={item.title}>{displayHeadline(item.title)}</b>
      </span>
      <span className="nwx-open">{item.url ? <IconExternal size={13} /> : null}</span>
    </>
  );

  if (!item.url) {
    return <div className={`nwx-line ${read ? 'read' : 'unread'} ${fresh ? 'fresh' : ''}`} onMouseEnter={() => onRead(item.id)}>{content}</div>;
  }

  return (
    <a className={`nwx-line ${read ? 'read' : 'unread'} ${fresh ? 'fresh' : ''}`} href={item.url} target="_blank" rel="noreferrer noopener" onClick={() => onRead(item.id)}>
      {content}
    </a>
  );
}

export function News() {
  const { prefs } = useStore();
  const [initialFeed] = useState(readFeedCache);
  const [context, setContext] = useState<NewsContextPayload | null>(initialFeed.context);
  const [binance, setBinance] = useState<BinanceNewsPayload | null>(initialFeed.binance);
  const [failed, setFailed] = useState(false);
  const [binanceFailed, setBinanceFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [q, setQ] = useState('');
  const [refreshCycle, setRefreshCycle] = useState({ seq: 0, force: false });
  const [readIds, setReadIds] = useState<Set<string>>(() => readSet());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const newsCadenceSec = Math.min(10, Math.max(0.5, prefs.dataCadence?.news ?? 10));

  useEffect(() => {
    const t = window.setInterval(() => setRefreshCycle((cycle) => ({ seq: cycle.seq + 1, force: false })), newsCadenceSec * 1000);
    return () => window.clearInterval(t);
  }, [newsCadenceSec]);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const followupTimers: number[] = [];
    let freshTimer: number | null = null;
    let checkingTimer: number | null = null;
    const checkStartedAt = Date.now();
    const isRefresh = refreshCycle.seq > 0;
    const isForced = refreshCycle.force;
    const previousIds = new Set(mergeNewsItems(context, binance).map((item) => item.id));
    setFailed(false);
    setBinanceFailed(false);
    setRefreshing(isRefresh);
    setChecking(isRefresh);

    const releaseChecking = () => {
      if (!isRefresh) return;
      const delay = Math.max(0, 900 - (Date.now() - checkStartedAt));
      if (checkingTimer !== null) window.clearTimeout(checkingTimer);
      checkingTimer = window.setTimeout(() => {
        if (alive) setChecking(false);
      }, delay);
    };

    const markIncoming = (nextContext: NewsContextPayload | null, nextBinance: BinanceNewsPayload | null) => {
      if (!isRefresh) return;
      const incoming = mergeNewsItems(nextContext, nextBinance).filter((item) => !previousIds.has(item.id)).map((item) => item.id);
      if (incoming.length) {
        setFreshIds(new Set(incoming));
        if (freshTimer !== null) window.clearTimeout(freshTimer);
        freshTimer = window.setTimeout(() => setFreshIds(new Set()), 1400);
      }
    };

    const commitResults = (
      [contextResult, binanceResult]: [PromiseSettledResult<NewsContextPayload>, PromiseSettledResult<BinanceNewsPayload>],
      animate: boolean
    ) => {
      if (!alive) return;
      let nextContext = context;
      let nextBinance = binance;
      if (contextResult.status === 'fulfilled') {
        nextContext = contextResult.value;
        setContext(contextResult.value);
      }
      else setFailed(true);
      if (binanceResult.status === 'fulfilled') {
        nextBinance = binanceResult.value;
        setBinance(binanceResult.value);
      }
      else setBinanceFailed(true);
      if (animate) markIncoming(nextContext, nextBinance);
      persistFeedCache(nextContext, nextBinance);
    };

    const scheduleFollowupRead = (delay: number, releaseAfterRead = false) => {
      const timer = window.setTimeout(() => {
	        const followContextReq = fetch('/api/news-context?limit=520', { signal: ctrl.signal })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad')))) as Promise<NewsContextPayload>;
        const followBinanceReq = fetch('/api/news?catalog=all', { signal: ctrl.signal })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad')))) as Promise<BinanceNewsPayload>;
        Promise.allSettled([followContextReq, followBinanceReq]).then((followResults) => {
          commitResults(followResults, true);
          if (releaseAfterRead) releaseChecking();
        });
      }, delay);
      followupTimers.push(timer);
    };

    const forceParam = isForced ? '&refresh=1' : '';
	    const contextReq = fetch(`/api/news-context?limit=520${forceParam}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad')))) as Promise<NewsContextPayload>;
    const binanceReq = fetch(`/api/news?catalog=all${forceParam}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad')))) as Promise<BinanceNewsPayload>;

    Promise.allSettled([contextReq, binanceReq]).then((results) => {
      if (!alive) return;
      commitResults(results, isRefresh);
      setRefreshing(false);
      if (isRefresh) {
        [2200, 5200, 9200].forEach((delay, index) => scheduleFollowupRead(delay, index === 0));
      } else {
        setChecking(false);
      }
    });

    return () => {
      alive = false;
      followupTimers.forEach((timer) => window.clearTimeout(timer));
      if (freshTimer !== null) window.clearTimeout(freshTimer);
      if (checkingTimer !== null) window.clearTimeout(checkingTimer);
      ctrl.abort();
    };
  }, [refreshCycle]);

  const markRead = useCallback((id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      persistRead(next);
      return next;
    });
  }, []);

  const ql = q.trim().toLowerCase();
  const items = useMemo(() => mergeNewsItems(context, binance), [binance?.items, context?.items]);
  const filtered = useMemo(
    () => items.filter((it) => (sourceFilter === 'all' || sourceKeyForItem(it) === sourceFilter || it.channel === sourceFilter) && matchesQuery(it, ql)),
    [items, ql, sourceFilter]
  );
  const visibleUnread = filtered.filter((it) => !readIds.has(it.id)).length;
  const latestFetchedAt = Math.max(context?.fetchedAt ?? 0, binance?.fetchedAt ?? 0);
  const status = failed && binanceFailed ? 'Feed Unreachable' : latestFetchedAt ? `Live · ${liveAge(latestFetchedAt)}` : 'Fetching';
  const tone: NewsTone = failed && binanceFailed ? 'bad' : context || binance ? 'ok' : 'idle';
  const sourceStatus = useMemo(() => {
    const map = new Map<string, NewsContextSource>();
    context?.sources.forEach((src) => map.set(src.key, src));
    map.set('binance', {
      key: 'binance',
      label: 'Binance News / Announcements',
      status: binanceFailed ? 'error' : binance ? 'live' : 'error',
      detail: binanceFailed ? 'Official Binance announcements unavailable.' : binance ? 'Official Binance announcements API.' : 'Fetching Binance announcements.',
      fetchedAt: binance?.fetchedAt ?? null,
      count: binance?.items.length ?? 0,
      url: 'https://www.binance.com/en/support/announcement',
      domain: 'binance.com',
    });
    return map;
  }, [binance, binanceFailed, context?.sources]);
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) => counts.set(sourceKeyForItem(item), (counts.get(sourceKeyForItem(item)) ?? 0) + 1));
    return counts;
  }, [items]);
  const sourceOptions = SOURCE_FILTERS.map((src) => {
    const count = src.id === 'all' ? items.length : sourceCounts.get(src.id) ?? sourceStatus.get(src.id)?.count ?? 0;
    const source = sourceStatus.get(src.id);
    const suffix = src.id === 'all'
      ? `${count}`
      : source?.status === 'error'
        ? 'Unavailable'
        : `${count}`;
    return { ...src, label: `${src.label} · ${suffix}` };
  });
  const listedSources = SOURCE_FILTERS.filter((src) => src.id !== 'all');
  const liveSources = listedSources.filter((src) => sourceStatus.get(src.id)?.status === 'live').length;
  const delayedSources = listedSources.filter((src) => sourceStatus.get(src.id)?.status === 'delayed').length;
  const unavailableSources = listedSources.filter((src) => {
    const source = sourceStatus.get(src.id);
    return source ? source.status === 'error' : false;
  }).length;
  const sourceDetails = listedSources
    .map((src) => {
      const source = sourceStatus.get(src.id);
      const state = source?.status === 'delayed' ? 'Delayed' : source?.status === 'live' ? 'Live' : 'Unavailable';
      const count = sourceCounts.get(src.id) ?? source?.count ?? 0;
      return `${src.label}: ${state} · ${count}`;
    })
    .join(' / ');
  const sourceTruth = `${liveSources}/${listedSources.length} Sources Live · ${delayedSources} Delayed · ${unavailableSources} Unavailable`;

  const markVisibleRead = () => {
    setReadIds((prev) => {
      const next = new Set(prev);
      filtered.forEach((it) => next.add(it.id));
      persistRead(next);
      return next;
    });
  };

  return (
    <div className="container page mkx ux-page nwx-page nwx-calendar">
      <header className="bwx-hero bsx-hero ux-hero nwx-hero">
        <div className="bwx-hero-top">
          <div className="bwx-hero-title">
            <div className="bwx-title-row">
              <h1>News</h1>
            </div>
            <p>Primary macro, venue operations, on-chain, and market headlines in one live stack.</p>
          </div>
          <span className="tdx-head-right">
            <Pill tone={tone} className={`ux-live-status ${checking ? 'syncing' : ''}`}>{status}</Pill>
            <button className={`mkx-pill ux-refresh ${checking ? 'checking' : ''} ${refreshing ? 'refreshing' : ''}`} onClick={() => setRefreshCycle((cycle) => ({ seq: cycle.seq + 1, force: true }))} disabled={checking} title={checking ? 'Refreshing News Feed' : 'Refresh News Feed'}>
              <span className="ux-refresh-beam" aria-hidden="true" />
              <IconRefresh size={13} />
              <span>Refresh</span>
            </button>
          </span>
        </div>
      </header>

      <div className="cal-filters clx-filters ux-filters nwx-filters">
        <label className="ux-select-wrap nwx-source-control">
          <IconNewspaper size={14} />
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} aria-label="News Source Filter">
            {sourceOptions.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
          </select>
        </label>
        <label className="nwx-calendar-search">
          <IconSearch size={14} />
          <input value={q} placeholder="Search headlines, sources, symbols" onChange={(e) => setQ(e.target.value)} aria-label="Search Headlines" />
        </label>
      </div>

      <div className="nwx-cols page-cols">
        <span>Time</span>
        <span>Source</span>
        <span>Headline</span>
        <span>Link</span>
      </div>
      <div className="nwx-page-list">
        {!context && !binance && !failed && !binanceFailed && <div className="ov-empty">Loading Headlines...</div>}
        {failed && binanceFailed && <div className="ov-empty">News unavailable. Source feeds could not be reached.</div>}
        {(context || binance) && filtered.length === 0 && <div className="ov-empty">{ql ? `Nothing Matches "${q}".` : 'No Headlines Match These Filters.'}</div>}
        {filtered.map((it) => (
          <NewsRow key={it.id} item={it} read={readIds.has(it.id)} fresh={freshIds.has(it.id)} onRead={markRead} />
        ))}
      </div>

      <div className="nwx-footer-line">
        <span title={sourceDetails}>{sourceTruth}</span>
        <button type="button" onClick={markVisibleRead} disabled={filtered.length === 0 || visibleUnread === 0}>Mark Visible Read</button>
      </div>
      <p className="news-source-note">Primary and venue sources outrank media; the free headline layer adds FT Alphaville, CNBC, MarketWatch, Yahoo Finance, Investing.com, Nasdaq, AP Business, and WSJ Markets.</p>
    </div>
  );
}
