import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { IconExternal, IconNewspaper, IconSearch } from '../components/Icons';
import { PillSelect } from '../components/PillSelect';
import { liveAge } from '../format';
import { fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { TIME_ZONE_OPTIONS, addDays, dayKey, formatKey, resolvedZoneLabel } from '../lib/time';
import { useStore } from '../store';
import './LiveIntelligence.css';

type NewsTone = 'ok' | 'warn' | 'bad' | 'idle';
type FeedChannel = 'primary' | 'venue' | 'protocol' | 'issuer' | 'tree' | 'rss' | 'lookonchain' | 'binance';
type NewsCategory = 'Crypto' | 'Macro' | 'Markets' | 'Regulation' | 'Exchange' | 'On-Chain' | 'Security' | 'Protocol';
type NewsBucket = 'all' | 'crypto' | 'macro' | 'markets' | 'regulation' | 'exchange' | 'onchain-security';
type ImpactFilter = 'all' | 'high' | 'medium' | 'low';
export type NewsImpact = 1 | 2 | 3 | null;

export type NewsImpactSummary = Readonly<{
  high: number;
  medium: number;
  low: number;
  unknown: number;
  scored: number;
}>;

export function authoritativeNewsImpact(item: Readonly<{ impact?: unknown }>): NewsImpact {
  return item.impact === 1 || item.impact === 2 || item.impact === 3 ? item.impact : null;
}

export function summarizeNewsImpacts(items: readonly Readonly<{ impact?: unknown }>[]): NewsImpactSummary {
  let high = 0;
  let medium = 0;
  let low = 0;
  let unknown = 0;
  for (const item of items) {
    const impact = authoritativeNewsImpact(item);
    if (impact === 3) high += 1;
    else if (impact === 2) medium += 1;
    else if (impact === 1) low += 1;
    else unknown += 1;
  }
  return { high, medium, low, unknown, scored: high + medium + low };
}

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
  publishedDay?: string | null;
  timeLabel: string;
  symbols: string[];
  tags: string[];
  category?: NewsCategory;
  tone: NewsTone;
  impact?: NewsImpact;
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

interface BinanceItem { id: number; title: string; date: string | null; url: string; impact?: NewsImpact }
interface BinancePayload { catalog: number | string; fetchedAt?: number; items: BinanceItem[] }

const FEED_CACHE_KEY = 'cosmos-news-feed-cache-v4';
const CONTEXT_LIMIT = 600;
const FALLBACK_CONTEXT_LIMIT = 220;
const LOCAL_CACHE_LIMIT = 700;
const BUCKETS: { id: NewsBucket; label: string }[] = [
  { id: 'all', label: 'All News' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'macro', label: 'Macro' },
  { id: 'markets', label: 'Markets' },
  { id: 'regulation', label: 'Regulation' },
  { id: 'exchange', label: 'Exchange' },
  { id: 'onchain-security', label: 'On-Chain / Security' },
];
const IMPACTS: { id: ImpactFilter; label: string; value: 1 | 2 | 3 | null }[] = [
  { id: 'all', label: 'All Impact', value: null },
  { id: 'high', label: 'High', value: 3 },
  { id: 'medium', label: 'Medium', value: 2 },
  { id: 'low', label: 'Low', value: 1 },
];
const SOURCE_PRIORITY: Record<FeedChannel, number> = {
  primary: 0, venue: 1, issuer: 2, protocol: 3, binance: 4, rss: 5, lookonchain: 6, tree: 7,
};
const MACRO_SOURCE_KEYS = new Set([
  'fed', 'bls', 'bea', 'sec', 'cftc', 'treasury', 'ofac', 'ecb', 'boe', 'boj', 'japan-mof',
  'japan-fsa', 'china-nbs', 'pboc', 'safe', 'uk-fca', 'esma', 'bis-press', 'bis-speeches', 'bis-statistics',
]);

function discardFeedCache(storage: Pick<Storage, 'removeItem'>): void {
  try { storage.removeItem(FEED_CACHE_KEY); } catch { /* cache is optional */ }
}

export function readFeedCache(
  storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage,
): { context: NewsPayload | null; binance: BinancePayload | null } {
  try {
    const cached = storage.getItem(FEED_CACHE_KEY);
    if (cached === null) return { context: null, binance: null };
    const parsed = JSON.parse(cached) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      discardFeedCache(storage);
      return { context: null, binance: null };
    }
    const candidate = parsed as { context?: unknown; binance?: unknown };
    const context = candidate.context ?? null;
    const binance = candidate.binance ?? null;
    if (
      (context !== null && !validContextPayload(context)) ||
      (binance !== null && !validBinancePayload(binance))
    ) {
      discardFeedCache(storage);
      return { context: null, binance: null };
    }
    return { context, binance };
  } catch {
    discardFeedCache(storage);
    return { context: null, binance: null };
  }
}

function persistFeedCache(context: NewsPayload | null, binance: BinancePayload | null): void {
  try {
    const compactContext = context ? { ...context, items: context.items.slice(0, LOCAL_CACHE_LIMIT) } : null;
    localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ context: compactContext, binance }));
  } catch { /* cache is optional */ }
}

function cleanDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

function itemDomain(item: NewsItem): string | null {
  const linked = cleanDomain(item.url);
  if (item.channel === 'tree' && linked) return linked;
  return item.sourceDomain || linked;
}

function itemSourceKey(item: NewsItem): string {
  return item.sourceKey || item.source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || item.channel;
}

function itemTimestamp(item: NewsItem): number {
  return item.ts && Number.isFinite(item.ts) && item.ts <= Date.now() ? item.ts : 0;
}

function itemDay(item: NewsItem, zone?: string): string | null {
  const timestamp = itemTimestamp(item);
  if (timestamp) return dayKey(new Date(timestamp), zone);
  return item.publishedDay || null;
}

function mapBinance(item: BinanceItem): NewsItem {
  const publishedDay = item.title.match(/(?:\(|[-–—]\s*)(\d{4}-\d{2}-\d{2})\)?\s*$/)?.[1] ?? item.date;
  return {
    id: `binance:${item.id}`,
    title: item.title.replace(/\s*(?:\(|[-–—]\s*)\d{4}-\d{2}-\d{2}\)?\s*$/, '').trim(),
    summary: null,
    url: item.url,
    source: 'Binance',
    sourceKey: 'binance',
    sourceDomain: 'binance.com',
    channel: 'binance',
    ts: null,
    publishedDay,
    timeLabel: 'Date Only',
    symbols: [],
    tags: ['Exchange'],
    category: 'Exchange',
    tone: 'idle',
    impact: authoritativeNewsImpact(item),
  };
}

function compareItems(a: NewsItem, b: NewsItem): number {
  const aTime = itemTimestamp(a) || (a.publishedDay ? Date.parse(`${a.publishedDay}T00:00:00Z`) : 0);
  const bTime = itemTimestamp(b) || (b.publishedDay ? Date.parse(`${b.publishedDay}T00:00:00Z`) : 0);
  if (aTime !== bTime) return bTime - aTime;
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
  [...current.items, ...incoming.items].forEach((item) => byId.set(item.id, item));
  const metadata = incoming.fetchedAt >= current.fetchedAt ? incoming : current;
  return { ...metadata, items: [...byId.values()].sort(compareItems).slice(0, CONTEXT_LIMIT) };
}

function validContextPayload(payload: unknown): payload is NewsPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const candidate = payload as Partial<NewsPayload>;
  return Boolean(
    typeof candidate.source === 'string' &&
    Number.isFinite(candidate.fetchedAt) &&
    (candidate.fetchedAt ?? 0) > 0 &&
    Array.isArray(candidate.items) &&
    candidate.items.every((item) => (
      item &&
      typeof item.id === 'string' &&
      typeof item.title === 'string' &&
      typeof item.source === 'string' &&
      Array.isArray(item.symbols) &&
      Array.isArray(item.tags) &&
      (item.ts === null || Number.isFinite(item.ts)) &&
      authoritativeNewsImpact(item) === (item.impact ?? null)
    )) &&
    Array.isArray(candidate.sources) &&
    candidate.sources.every((source) => source && typeof source.key === 'string' && typeof source.label === 'string')
  );
}

function validBinancePayload(payload: unknown): payload is BinancePayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const candidate = payload as Partial<BinancePayload>;
  return Boolean(
    Array.isArray(candidate.items) &&
    candidate.items.every((item) => (
      item &&
      Number.isSafeInteger(item.id) &&
      typeof item.title === 'string' &&
      typeof item.url === 'string' &&
      (item.date === null || typeof item.date === 'string') &&
      authoritativeNewsImpact(item) === (item.impact ?? null)
    ))
  );
}

function classification(item: NewsItem): string {
  if (item.category) return item.category;
  const key = itemSourceKey(item);
  const tags = item.tags.join(' ').toLowerCase();
  const text = `${item.title} ${tags}`.toLowerCase();
  if (/hack|exploit|phishing|stolen|breach|drain|vulnerability/.test(text)) return 'Security';
  if (item.channel === 'venue' || item.channel === 'binance' || /listing|delisting|maintenance/.test(tags)) return 'Exchange';
  if (/policy|regulation|lawsuit|court|enforcement/.test(tags)) return 'Regulation';
  if (item.channel === 'primary' || MACRO_SOURCE_KEYS.has(key) || /macro|inflation|treasury/.test(tags)) return 'Macro';
  if (/on-chain|whale|wallet flow/.test(text)) return 'On-Chain';
  if (item.channel === 'protocol' || /release|governance/.test(tags)) return 'Protocol';
  if (item.channel === 'issuer' || /etf|stablecoin|bitcoin|ethereum|crypto/.test(text)) return 'Crypto';
  return 'Markets';
}

function matchesBucket(item: NewsItem, bucket: NewsBucket): boolean {
  if (bucket === 'all') return true;
  const type = classification(item);
  if (bucket === 'crypto') return type === 'Crypto' || type === 'Protocol';
  if (bucket === 'macro') return type === 'Macro';
  if (bucket === 'markets') return type === 'Markets';
  if (bucket === 'regulation') return type === 'Regulation';
  if (bucket === 'exchange') return type === 'Exchange';
  return type === 'Security' || type === 'On-Chain';
}

function displaySource(item: NewsItem): string {
  if (item.source.toLowerCase() === 'twitter') {
    const account = item.title.match(/^(.{2,42}?)\s*\(@[^)]+\)\s*:/)?.[1]?.trim();
    if (account) return account;
  }
  return item.source || 'Unknown Source';
}

function matchesQuery(item: NewsItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${item.title} ${item.source} ${item.symbols.join(' ')} ${item.tags.join(' ')} ${classification(item)}`.toLowerCase();
  return query.split(/\s+/).every((token) => haystack.includes(token));
}

function publishedTime(item: NewsItem, zone?: string): string {
  const timestamp = itemTimestamp(item);
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
}

const SourceLogo = memo(function SourceLogo({ domain, label, size = 24 }: { domain: string | null; label: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [domain]);
  const url = domain && !failed ? `/api/source-logo?domain=${encodeURIComponent(domain)}&sz=${Math.max(32, size * 2)}` : null;
  return <span className="newsx-logo" style={{ width: size, height: size }} title={label} aria-label={`${label} Logo`}>
    {url ? <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <IconNewspaper size={Math.max(12, size - 9)} />}
  </span>;
});

function ImpactBars({ impact }: { impact: NewsImpact }) {
  if (impact === null) {
    return <span className="newsx-impact level-unknown" title="Impact Unknown" aria-label="Impact Unknown">
      {[1, 2, 3].map((bar) => <i key={bar} />)}
    </span>;
  }
  const label = impact === 3 ? 'High Impact' : impact === 2 ? 'Medium Impact' : 'Low Impact';
  return <span className={`newsx-impact level-${impact}`} title={label} aria-label={label}>
    {[1, 2, 3].map((bar) => <i key={bar} className={bar <= impact ? 'on' : ''} />)}
  </span>;
}

const NewsRow = memo(function NewsRow({ item, fresh, zone }: { item: NewsItem; fresh: boolean; zone?: string }) {
  const type = classification(item);
  const source = displaySource(item);
  return <div className={`newsx-row ${fresh ? 'fresh' : ''}`}>
    <span className="newsx-time" title={item.timeLabel}><b>{publishedTime(item, zone)}</b></span>
    <span className="newsx-source"><SourceLogo domain={itemDomain(item)} label={source} /><b title={source}>{source}</b></span>
    <ImpactBars impact={authoritativeNewsImpact(item)} />
    <span className="newsx-headline">
      {item.url ? <a href={item.url} target="_blank" rel="noreferrer noopener" title={`${source} · ${item.title}`}>{item.title}</a> : <b title={item.title}>{item.title}</b>}
    </span>
    <span className="newsx-type">{type}</span>
    <span className="newsx-open">{item.url ? <IconExternal size={13} /> : null}</span>
  </div>;
});

function SourcePicker({ value, sources, counts, onChange }: {
  value: string;
  sources: NewsSource[];
  counts: Map<string, number>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  const selected = sources.find((source) => source.key === value);
  const visible = sources.filter((source) => source.label.toLowerCase().includes(query.trim().toLowerCase()));
  const live = sources.filter((source) => source.status === 'live').length;
  return <div className="newsx-source-picker" ref={ref}>
    <button type="button" className="newsx-source-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span>{selected?.label || 'Sources'}</span><em>{sources.length}</em><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
    </button>
    {open && <div className="newsx-source-menu" role="listbox" aria-label="Sources">
      <div className="newsx-source-menu-head"><strong>Sources</strong><span>{sources.length} Available · {live} Live</span></div>
      <label className="newsx-source-search"><IconSearch size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Sources" spellCheck={false} /></label>
      <div className="newsx-source-options">
        <button type="button" role="option" aria-selected={value === 'all'} className={value === 'all' ? 'selected' : ''} onClick={() => { onChange('all'); setOpen(false); }}>
          <span className="newsx-source-all"><IconNewspaper size={14} /></span><b>All Sources</b><em>{[...counts.values()].reduce((sum, count) => sum + count, 0)}</em>
        </button>
        {visible.map((source) => <button type="button" key={source.key} role="option" aria-selected={value === source.key} className={value === source.key ? 'selected' : ''} onClick={() => { onChange(source.key); setOpen(false); }}>
          <SourceLogo domain={source.domain || cleanDomain(source.url)} label={source.label} size={22} />
          <b>{source.label}</b>
          <span className={`newsx-source-status ${source.status}`}><i />{counts.get(source.key) ?? 0}</span>
        </button>)}
      </div>
    </div>}
  </div>;
}

export function News() {
  const { prefs, updatePref } = useStore();
  const zone = prefs.clockZone && prefs.clockZone !== 'local' ? prefs.clockZone : undefined;
  const today = dayKey(new Date(), zone);
  const [initial] = useState(readFeedCache);
  const [context, setContext] = useState<NewsPayload | null>(initial.context);
  const [binance, setBinance] = useState<BinancePayload | null>(initial.binance);
  const [lastCheckedAt, setLastCheckedAt] = useState(() => Math.max(initial.context?.fetchedAt ?? 0, initial.binance?.fetchedAt ?? 0));
  const [contextFailed, setContextFailed] = useState(false);
  const [binanceFailed, setBinanceFailed] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>('all');
  const [bucket, setBucket] = useState<NewsBucket>('all');
  const [provider, setProvider] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedDay, setSelectedDay] = useState(today);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const knownIdsRef = useRef(new Set(mergeItems(initial.context, initial.binance).map((item) => item.id)));
  const contextRef = useRef(context);
  const binanceRef = useRef(binance);
  const freshTimerRef = useRef<number | null>(null);
  const fallbackCadence = Math.max(0.5, prefs.dataCadence?.news ?? 5);

  useEffect(() => { binanceRef.current = binance; }, [binance]);
  useEffect(() => { contextRef.current = context; }, [context]);
  useEffect(() => { setSelectedDay(today); }, [today]);

  const applyContext = useCallback((payload: NewsPayload, animate = true, mergeExisting = false) => {
    if (!validContextPayload(payload)) {
      setContextFailed(true);
      return;
    }
    const committed = mergeExisting ? mergeContextPayload(payload, contextRef.current) : payload;
    const next = mergeItems(committed, binanceRef.current);
    const incoming = animate ? next.slice(0, 20).filter((item) => !knownIdsRef.current.has(item.id)).map((item) => item.id) : [];
    next.forEach((item) => knownIdsRef.current.add(item.id));
    if (knownIdsRef.current.size > 2_400) knownIdsRef.current = new Set(next.slice(0, 2_000).map((item) => item.id));
    setContext(committed);
    contextRef.current = committed;
    setLastCheckedAt((current) => Math.max(current, committed.fetchedAt));
    setContextFailed(false);
    persistFeedCache(committed, binanceRef.current);
    if (incoming.length) {
      setFreshIds(new Set(incoming));
      if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current);
      freshTimerRef.current = window.setTimeout(() => setFreshIds(new Set()), 1_200);
    }
  }, []);

  const applyBinance = useCallback((payload: BinancePayload) => {
    if (!validBinancePayload(payload)) {
      setBinanceFailed(true);
      return;
    }
    const current = binanceRef.current;
    const incomingAt = payload.fetchedAt ?? 0;
    const currentAt = current?.fetchedAt ?? 0;
    if (current && incomingAt > 0 && currentAt > incomingAt) {
      setBinanceFailed(false);
      return;
    }
    setBinance(payload);
    binanceRef.current = payload;
    setBinanceFailed(false);
    setLastCheckedAt((checkedAt) => Math.max(checkedAt, incomingAt || Date.now()));
    persistFeedCache(contextRef.current, payload);
  }, []);

  useEffect(() => {
    const stream = new EventSource('/api/news-stream?limit=220');
    const onNews = (event: MessageEvent<string>) => {
      try { applyContext(JSON.parse(event.data) as NewsPayload, true, true); } catch { setContextFailed(true); }
    };
    stream.onopen = () => setStreamConnected(true);
    stream.onerror = () => { setStreamConnected(false); setContextFailed(true); };
    stream.addEventListener('news', onNews as EventListener);
    return () => { stream.close(); if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current); };
  }, [applyContext]);

  useEffect(() => {
    if (streamConnected) return;
    const poll = createSettledPoll<NewsPayload>({
      intervalMs: fallbackCadence * 1_000,
      timeoutMs: Math.min(12_000, Math.max(4_000, fallbackCadence * 1_000)),
      request: (signal) => fetchJson(`/api/news-context?limit=${FALLBACK_CONTEXT_LIMIT}`, { signal }),
      onSuccess: (payload) => applyContext(payload, true, true),
      onError: () => setContextFailed(true),
    });
    poll.start();
    return poll.stop;
  }, [applyContext, fallbackCadence, streamConnected]);

  useEffect(() => {
    const poll = createSettledPoll<BinancePayload>({
      intervalMs: 60_000,
      request: (signal) => fetchJson('/api/news?catalog=all', { signal }),
      onSuccess: applyBinance,
      onError: () => setBinanceFailed(true),
    });
    poll.start();
    return poll.stop;
  }, [applyBinance]);

  const items = useMemo(() => mergeItems(context, binance), [context, binance]);
  const deferredQuery = useDeferredValue(query).trim().toLowerCase();
  const itemsByDay = useMemo(() => {
    const grouped = new Map<string, NewsItem[]>();
    items.forEach((item) => {
      const key = itemDay(item, zone);
      if (key) grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });
    return grouped;
  }, [items, zone]);
  const dayKeys = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(today, index - 6)), [today]);
  const selectedItems = itemsByDay.get(selectedDay) ?? [];
  const providerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    selectedItems.forEach((item) => counts.set(itemSourceKey(item), (counts.get(itemSourceKey(item)) ?? 0) + 1));
    return counts;
  }, [selectedItems]);
  const sourceDirectory = useMemo<NewsSource[]>(() => {
    const sources = [...(context?.sources ?? [])];
    sources.push({
      key: 'binance', label: 'Binance Announcements', status: binanceFailed ? 'error' : binance ? 'live' : 'delayed',
      detail: 'Official Binance announcements.', fetchedAt: binance?.fetchedAt ?? null, count: binance?.items.length ?? 0,
      url: 'https://www.binance.com/en/support/announcement', domain: 'binance.com',
    });
    return sources.sort((a, b) => a.label.localeCompare(b.label));
  }, [binance, binanceFailed, context?.sources]);
  const selectedImpact = IMPACTS.find((option) => option.id === impactFilter)?.value ?? null;
  const filtered = useMemo(() => selectedItems.filter((item) =>
    (selectedImpact === null || authoritativeNewsImpact(item) === selectedImpact) &&
    matchesBucket(item, bucket) &&
    (provider === 'all' || itemSourceKey(item) === provider) &&
    matchesQuery(item, deferredQuery)
  ), [bucket, deferredQuery, provider, selectedImpact, selectedItems]);
  const hasData = items.length > 0;
  const failed = contextFailed && binanceFailed && !hasData;
  const reconnecting = contextFailed && binanceFailed && hasData;
  const status = failed
    ? 'Feed Unavailable'
    : reconnecting
      ? `Reconnecting · ${liveAge(lastCheckedAt)}`
      : lastCheckedAt
        ? `${streamConnected ? 'Live' : 'Updating'} · ${liveAge(lastCheckedAt)}`
        : 'Loading';
  const selectedImpactSummary = summarizeNewsImpacts(selectedItems);
  const rangeLabel = `${formatKey(dayKeys[0], { month: 'short', day: 'numeric' })} — ${formatKey(dayKeys[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const returnToday = () => setSelectedDay(today);

  return <div className="container page lix-page newsx-page">
    <div className="lix-frame">
      <header className="lix-toolbar">
        <div className="lix-title newsx-title">
          <img className="newsx-page-mark" src="/news-mark.png" alt="" aria-hidden="true" />
          <h1>News</h1>
          <span className={`lix-live ${failed ? 'error' : reconnecting ? 'reconnecting' : streamConnected ? 'streaming' : ''}`}><i />{status}</span>
        </div>
        <label className="lix-search">
          <IconSearch size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" spellCheck={false} />
          {query && <button type="button" aria-label="Clear Search" onClick={() => setQuery('')}>×</button>}
        </label>
      </header>

      <section className="calx-navigation newsx-navigation" aria-label="News Navigation">
        <div className="calx-range-controls">
          <button type="button" className="calx-today" onClick={returnToday}>Today</button>
          <strong>{rangeLabel}</strong><span className="newsx-range-note">Rolling Seven Days</span>
        </div>
        <PillSelect value={prefs.clockZone} options={TIME_ZONE_OPTIONS.map((option) => ({ ...option }))} onChange={(value) => updatePref('clockZone', value)} ariaLabel="Time Zone" className="lix-select lix-zone-select" />
      </section>

      <section className="calx-week newsx-week" aria-label="News Days">
        {dayKeys.map((key) => {
          const rows = itemsByDay.get(key) ?? [];
          const impactSummary = summarizeNewsImpacts(rows);
          return <button type="button" key={key} className={`${key === selectedDay ? 'selected' : ''} ${key === today ? 'today' : ''}`} onClick={() => setSelectedDay(key)}>
            <span className="calx-day-name">{formatKey(key, { weekday: 'short' })} <b>{formatKey(key, { day: 'numeric' })}</b></span>
            <span><em>News</em><b>{rows.length}</b></span>
            <span className="newsx-day-impact"><em>Impact</em><b><i className="high">H {impactSummary.high}</i><i className="medium">M {impactSummary.medium}</i><i className="low">L {impactSummary.low}</i></b></span>
          </button>;
        })}
      </section>

      <section className="lix-filters newsx-filters" aria-label="News Filters">
        <div className="newsx-filter-line">
          <div className="lix-segments newsx-category-tabs" role="group" aria-label="Category">
            {BUCKETS.map((option) => <button type="button" key={option.id} className={bucket === option.id ? 'selected' : ''} onClick={() => setBucket(option.id)}>{option.label}</button>)}
          </div>
          <SourcePicker value={provider} sources={sourceDirectory} counts={providerCounts} onChange={setProvider} />
        </div>
        <div className="newsx-filter-line impact">
          <div className="lix-segments newsx-impact-tabs" role="group" aria-label="Impact">
            {IMPACTS.map((option) => <button type="button" key={option.id} className={impactFilter === option.id ? 'selected' : ''} onClick={() => setImpactFilter(option.id)}>{option.label}</button>)}
          </div>
        </div>
      </section>

      <section className="newsx-tape" aria-label="News Feed">
        <div className="newsx-day-header">
          <strong>{formatKey(selectedDay, { weekday: 'long', month: 'long', day: 'numeric' })}</strong>
          <span>{selectedItems.length} News · {selectedImpactSummary.high} High · {selectedImpactSummary.medium} Medium · {selectedImpactSummary.low} Low · {selectedImpactSummary.unknown} Unknown · {resolvedZoneLabel(prefs.clockZone)}</span>
        </div>
        <div className="newsx-header"><span>Time</span><span>Source</span><span>Impact</span><span>Headline</span><span>Category</span><span /></div>
        <div className="newsx-day-body" key={selectedDay}>
          {filtered.map((item) => <NewsRow key={item.id} item={item} fresh={freshIds.has(item.id)} zone={zone} />)}
          {!context && !binance && !failed && <div className="lix-empty">Loading Headlines…</div>}
          {failed && <div className="lix-empty">The News Feed Is Currently Unavailable.</div>}
          {(context || binance) && filtered.length === 0 && <div className="lix-empty">{deferredQuery ? `Nothing Matches “${query}”.` : 'No News Matches These Filters.'}</div>}
        </div>
      </section>
    </div>
  </div>;
}
