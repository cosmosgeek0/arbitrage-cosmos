import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { IconExternal, IconNewspaper, IconSearch } from '../components/Icons';
import { PillSelect } from '../components/PillSelect';
import { liveAge } from '../format';
import { useStore } from '../store';
import './LiveIntelligence.css';

type NewsTone = 'ok' | 'warn' | 'bad' | 'idle';
type FeedChannel = 'primary' | 'venue' | 'protocol' | 'issuer' | 'tree' | 'rss' | 'lookonchain' | 'binance';
type NewsBucket = 'all' | 'must-know' | 'exchange' | 'macro-policy' | 'crypto-market' | 'onchain-security' | 'long-research';

interface NewsItem {
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

interface NewsSource {
  key: string;
  label: string;
  status: 'live' | 'delayed' | 'error';
  detail: string;
  fetchedAt: number | null;
  count: number;
  url?: string | null;
  domain?: string | null;
}

interface NewsPayload {
  source: string;
  fetchedAt: number;
  items: NewsItem[];
  sources: NewsSource[];
}

interface BinanceItem { id: number; title: string; date: string | null; url: string }
interface BinancePayload { catalog: number | string; fetchedAt?: number; items: BinanceItem[] }

const FEED_CACHE_KEY = 'cosmos-news-feed-cache-v2';
const READ_KEY = 'cosmos-news-read-v3';
const CONTEXT_LIMIT = 900;
const INITIAL_ROWS = 80;
const BUCKETS: { id: NewsBucket; label: string }[] = [
  { id: 'all', label: 'All News' },
  { id: 'must-know', label: 'Must Know' },
  { id: 'exchange', label: 'Exchange' },
  { id: 'macro-policy', label: 'Macro / Policy' },
  { id: 'crypto-market', label: 'Crypto' },
  { id: 'onchain-security', label: 'Security' },
  { id: 'long-research', label: 'Research' },
];
const SOURCE_PRIORITY: Record<FeedChannel, number> = {
  primary: 0, venue: 1, issuer: 2, protocol: 3, binance: 4, rss: 5, lookonchain: 6, tree: 7,
};

function readFeedCache(): { context: NewsPayload | null; binance: BinancePayload | null } {
  try {
    const parsed = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) ?? 'null') as { context?: NewsPayload; binance?: BinancePayload } | null;
    return { context: parsed?.context ?? null, binance: parsed?.binance ?? null };
  } catch { return { context: null, binance: null }; }
}

function persistFeedCache(context: NewsPayload | null, binance: BinancePayload | null): void {
  try { localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ context, binance })); } catch { /* storage is optional */ }
}

function readSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}

function persistRead(ids: Set<string>): void {
  try { localStorage.setItem(READ_KEY, JSON.stringify([...ids].slice(-2_000))); } catch { /* storage is optional */ }
}

function cleanDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

function itemDomain(item: NewsItem): string | null {
  return item.sourceDomain || cleanDomain(item.url);
}

function itemSourceKey(item: NewsItem): string {
  return item.sourceKey || item.source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || item.channel;
}

function itemTimestamp(item: NewsItem): number {
  return item.ts && Number.isFinite(item.ts) && item.ts <= Date.now() ? item.ts : 0;
}

function binanceTimestamp(date: string | null): number | null {
  if (!date) return null;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) && parsed <= Date.now() ? parsed : null;
}

function mapBinance(item: BinanceItem): NewsItem {
  const titleDate = item.title.match(/(?:\(|[-–—]\s*)(\d{4}-\d{2}-\d{2})\)?\s*$/)?.[1] ?? item.date;
  return {
    id: `binance:${item.id}`,
    title: item.title.replace(/\s*(?:\(|[-–—]\s*)\d{4}-\d{2}-\d{2}\)?\s*$/, '').trim(),
    summary: null,
    url: item.url,
    source: 'Binance',
    sourceKey: 'binance',
    sourceDomain: 'binance.com',
    channel: 'binance',
    ts: binanceTimestamp(titleDate),
    timeLabel: titleDate || 'Official',
    symbols: [],
    tags: ['Exchange'],
    tone: 'idle',
  };
}

function compareItems(a: NewsItem, b: NewsItem): number {
  const byTime = itemTimestamp(b) - itemTimestamp(a);
  if (byTime) return byTime;
  const bySource = SOURCE_PRIORITY[a.channel] - SOURCE_PRIORITY[b.channel];
  return bySource || a.id.localeCompare(b.id);
}

function canonicalTitle(title: string): string {
  return title
    .replace(/^(?:finance feeds?|decrypt|cointelegraph|the block|coindesk|blockworks|reuters|bloomberg|wsj|cnbc)\s*[:\-–—]\s*/i, '')
    .replace(/\b(?:breaking|update|exclusive)\b\s*[:\-–—]?\s*/gi, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);
}

function mergeItems(context: NewsPayload | null, binance: BinancePayload | null): NewsItem[] {
  const seen = new Set<string>();
  return [...(context?.items ?? []), ...(binance?.items ?? []).map(mapBinance)]
    .sort(compareItems)
    .filter((item) => {
      const key = canonicalTitle(item.title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function mergeContextPayload(incoming: NewsPayload, current: NewsPayload | null): NewsPayload {
  if (!current) return incoming;
  const byId = new Map<string, NewsItem>();
  [...incoming.items, ...current.items].forEach((item) => byId.set(item.id, item));
  return { ...incoming, items: [...byId.values()].sort(compareItems).slice(0, CONTEXT_LIMIT) };
}

function classification(item: NewsItem): string {
  const tags = item.tags.join(' ').toLowerCase();
  const text = `${item.title} ${item.summary ?? ''} ${tags}`.toLowerCase();
  if (/security|hack|exploit|phishing|stolen|attack|vulnerability/.test(text)) return 'Security';
  if (item.channel === 'venue' || item.channel === 'binance' || /listing|delisting|maintenance|exchange/.test(tags)) return 'Exchange';
  if (item.channel === 'primary' || /macro|policy|inflation|rates|treasury|regulation/.test(text)) return 'Macro';
  if (item.channel === 'lookonchain' || /on-chain|whale|wallet flow/.test(text)) return 'On-Chain';
  if (item.channel === 'protocol' || /release|governance/.test(tags)) return 'Protocol';
  if (item.channel === 'issuer' || /research|etf|stablecoin/.test(tags)) return 'Research';
  return 'Markets';
}

function matchesBucket(item: NewsItem, bucket: NewsBucket): boolean {
  if (bucket === 'all') return true;
  const type = classification(item);
  if (bucket === 'exchange') return type === 'Exchange';
  if (bucket === 'macro-policy') return type === 'Macro';
  if (bucket === 'crypto-market') return type === 'Markets';
  if (bucket === 'onchain-security') return type === 'Security' || type === 'On-Chain' || type === 'Protocol';
  if (bucket === 'long-research') return type === 'Research';
  const text = `${item.title} ${item.tags.join(' ')}`.toLowerCase();
  const official = ['primary', 'venue', 'issuer', 'binance'].includes(item.channel);
  return official || /hack|exploit|depeg|etf approval|legal ruling|trading suspension|delist|outage|withdrawal halt|bridge pause|hard fork/.test(text);
}

function matchesQuery(item: NewsItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${item.title} ${item.summary ?? ''} ${item.source} ${itemDomain(item) ?? ''} ${item.symbols.join(' ')} ${item.tags.join(' ')} ${classification(item)}`.toLowerCase();
  return query.split(/\s+/).every((token) => haystack.includes(token));
}

function ageLabel(item: NewsItem): string {
  const timestamp = itemTimestamp(item);
  if (!timestamp) return item.timeLabel || 'Undated';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return `${seconds}s Ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m Ago`;
  if (seconds < 172_800) return `${Math.floor(seconds / 3_600)}h Ago`;
  return `${Math.floor(seconds / 86_400)}d Ago`;
}

function publishedLabel(item: NewsItem): string {
  const timestamp = itemTimestamp(item);
  if (!timestamp) return '—';
  if (new Date(timestamp).toDateString() === new Date().toDateString()) {
    return new Date(timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const SourceLogo = memo(function SourceLogo({ domain, label }: { domain: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [domain]);
  const url = domain && !failed ? `/api/source-logo?domain=${encodeURIComponent(domain)}&sz=48` : null;
  return <span className="newsx-logo" aria-label={`${label} Logo`}>
    {url ? <img src={url} alt="" width="24" height="24" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <IconNewspaper size={13} />}
  </span>;
});

const NewsRow = memo(function NewsRow({ item, read, fresh, onRead }: { item: NewsItem; read: boolean; fresh: boolean; onRead: (id: string) => void }) {
  const domain = itemDomain(item);
  const type = classification(item);
  const detail = [...item.symbols.slice(0, 3), ...item.tags.slice(0, 2)].filter((value, index, values) => value && values.indexOf(value) === index).join(' · ');
  return <div className={`newsx-row ${read ? 'read' : ''} ${fresh ? 'fresh' : ''}`}>
    <span className="newsx-time"><b>{publishedLabel(item)}</b><em>{ageLabel(item)}</em></span>
    <span className="newsx-provider"><SourceLogo domain={domain} label={item.source} /><span><b>{item.source}</b><em>{domain || item.channel}</em></span></span>
    <span className="newsx-headline">
      {item.url ? <a href={item.url} target="_blank" rel="noreferrer noopener" onClick={() => onRead(item.id)} title={item.title}>{item.title}</a> : <b title={item.title}>{item.title}</b>}
      {detail && <em>{detail}</em>}
    </span>
    <span className="newsx-type">{type}</span>
    <span className="newsx-open">{item.url ? <IconExternal size={13} /> : null}</span>
  </div>;
});

export function News() {
  const { prefs } = useStore();
  const [initial] = useState(readFeedCache);
  const [context, setContext] = useState<NewsPayload | null>(initial.context);
  const [binance, setBinance] = useState<BinancePayload | null>(initial.binance);
  const [lastCheckedAt, setLastCheckedAt] = useState(() => Math.max(initial.context?.fetchedAt ?? 0, initial.binance?.fetchedAt ?? 0));
  const [contextFailed, setContextFailed] = useState(false);
  const [binanceFailed, setBinanceFailed] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [bucket, setBucket] = useState<NewsBucket>('must-know');
  const [provider, setProvider] = useState('all');
  const [query, setQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_ROWS);
  const [readIds, setReadIds] = useState(readSet);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const knownIdsRef = useRef(new Set(mergeItems(initial.context, initial.binance).map((item) => item.id)));
  const contextRef = useRef(context);
  const binanceRef = useRef(binance);
  const freshTimerRef = useRef<number | null>(null);
  const fallbackCadence = Math.max(5, prefs.dataCadence?.news ?? 5);

  useEffect(() => { binanceRef.current = binance; }, [binance]);
  useEffect(() => { contextRef.current = context; }, [context]);

  const applyContext = useCallback((payload: NewsPayload, animate = true, mergeExisting = false) => {
    const committed = mergeExisting ? mergeContextPayload(payload, contextRef.current) : payload;
    const next = mergeItems(committed, binanceRef.current);
    const incoming = animate ? next.slice(0, 16).filter((item) => !knownIdsRef.current.has(item.id)).map((item) => item.id) : [];
    next.forEach((item) => knownIdsRef.current.add(item.id));
    if (knownIdsRef.current.size > 2_000) knownIdsRef.current = new Set(next.slice(0, 1_800).map((item) => item.id));
    setContext(committed);
    contextRef.current = committed;
    setLastCheckedAt(committed.fetchedAt);
    setContextFailed(false);
    persistFeedCache(committed, binanceRef.current);
    if (incoming.length) {
      setFreshIds(new Set(incoming));
      if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current);
      freshTimerRef.current = window.setTimeout(() => setFreshIds(new Set()), 1_400);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const contextRequest = fetch(`/api/news-context?limit=${CONTEXT_LIMIT}`, { signal: ctrl.signal }).then((response) => response.ok ? response.json() : Promise.reject()) as Promise<NewsPayload>;
    const binanceRequest = fetch('/api/news?catalog=all', { signal: ctrl.signal }).then((response) => response.ok ? response.json() : Promise.reject()) as Promise<BinancePayload>;
    Promise.allSettled([contextRequest, binanceRequest]).then(([contextResult, binanceResult]) => {
      let nextContext = context;
      let nextBinance = binance;
      if (contextResult.status === 'fulfilled') { nextContext = contextResult.value; applyContext(contextResult.value, false); }
      else setContextFailed(true);
      if (binanceResult.status === 'fulfilled') { nextBinance = binanceResult.value; setBinance(binanceResult.value); setBinanceFailed(false); }
      else setBinanceFailed(true);
      setLastCheckedAt(Math.max(nextContext?.fetchedAt ?? 0, nextBinance?.fetchedAt ?? 0, Date.now()));
      persistFeedCache(nextContext, nextBinance);
    });
    return () => ctrl.abort();
  // Initial cache state is intentionally captured once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyContext]);

  useEffect(() => {
    const stream = new EventSource('/api/news-stream?limit=220');
    const onNews = (event: MessageEvent<string>) => {
      try { applyContext(JSON.parse(event.data) as NewsPayload, true, true); } catch { /* REST fallback remains active */ }
    };
    stream.onopen = () => setStreamConnected(true);
    stream.onerror = () => setStreamConnected(false);
    stream.addEventListener('news', onNews as EventListener);
    return () => { stream.close(); if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current); };
  }, [applyContext]);

  useEffect(() => {
    if (streamConnected) return;
    const timer = window.setInterval(() => {
      fetch(`/api/news-context?limit=${CONTEXT_LIMIT}&refresh=1`)
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((payload: NewsPayload) => applyContext(payload, true))
        .catch(() => setContextFailed(true));
    }, fallbackCadence * 1_000);
    return () => window.clearInterval(timer);
  }, [applyContext, fallbackCadence, streamConnected]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      fetch('/api/news?catalog=all&refresh=1')
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((payload: BinancePayload) => {
          setBinance(payload);
          setBinanceFailed(false);
          persistFeedCache(contextRef.current, payload);
        })
        .catch(() => setBinanceFailed(true));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const markRead = useCallback((id: string) => {
    setReadIds((current) => {
      const next = new Set(current);
      next.add(id);
      persistRead(next);
      return next;
    });
  }, []);

  const items = useMemo(() => mergeItems(context, binance), [context, binance]);
  const deferredQuery = useDeferredValue(query).trim().toLowerCase();
  const providers = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((item) => map.set(itemSourceKey(item), item.source));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);
  const filtered = useMemo(() => items.filter((item) =>
    matchesBucket(item, bucket) &&
    (provider === 'all' || itemSourceKey(item) === provider) &&
    matchesQuery(item, deferredQuery)
  ), [bucket, deferredQuery, items, provider]);
  const visible = filtered.slice(0, visibleLimit);
  const failed = contextFailed && binanceFailed;
  const status = failed ? 'Feed Unavailable' : lastCheckedAt ? `${streamConnected ? 'Streaming' : 'Live'} · ${liveAge(lastCheckedAt)}` : 'Loading';

  useEffect(() => { setVisibleLimit(INITIAL_ROWS); }, [bucket, deferredQuery, provider]);

  return <div className="container page lix-page newsx-page">
    <header className="lix-toolbar">
      <div className="lix-title"><h1>News</h1><span className={`lix-live ${failed ? 'error' : ''}`}><i />{status}</span></div>
      <label className="lix-search">
        <IconSearch size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" spellCheck={false} />
        {query && <button type="button" aria-label="Clear Search" onClick={() => setQuery('')}>×</button>}
      </label>
    </header>

    <section className="lix-filters newsx-filters" aria-label="News Filters">
      <div className="lix-segments newsx-segments" role="group" aria-label="News Category">
        {BUCKETS.map((option) => <button type="button" key={option.id} className={bucket === option.id ? 'selected' : ''} onClick={() => setBucket(option.id)}>{option.label}</button>)}
      </div>
      <PillSelect value={provider} options={[{ id: 'all', label: 'All Providers' }, ...providers.map(([id, label]) => ({ id, label }))]} onChange={setProvider} ariaLabel="Provider" className="lix-select newsx-provider-select" />
    </section>

    <section className="newsx-tape" aria-label="Live News Feed">
      <div className="newsx-header"><span>Published</span><span>Provider</span><span>Headline</span><span>Category</span><span /></div>
      {visible.map((item) => <NewsRow key={item.id} item={item} read={readIds.has(item.id)} fresh={freshIds.has(item.id)} onRead={markRead} />)}
      {!context && !binance && !failed && <div className="lix-empty">Loading Headlines…</div>}
      {failed && <div className="lix-empty">The News Feed Is Currently Unavailable.</div>}
      {(context || binance) && filtered.length === 0 && <div className="lix-empty">{deferredQuery ? `Nothing Matches “${query}”.` : 'No Headlines Match These Filters.'}</div>}
    </section>
    {visible.length < filtered.length && <div className="newsx-more"><button type="button" onClick={() => setVisibleLimit((value) => value + INITIAL_ROWS)}>Load More</button><span>{visible.length.toLocaleString('en-US')} of {filtered.length.toLocaleString('en-US')}</span></div>}
  </div>;
}
