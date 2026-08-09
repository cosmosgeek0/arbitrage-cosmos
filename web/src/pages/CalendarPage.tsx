import { useEffect, useMemo, useRef, useState } from 'react';
import { IconSearch } from '../components/Icons';
import { PillSelect } from '../components/PillSelect';
import { CALENDAR_COUNTRIES, calVal, categoryName, countryName, flag, type CalItem } from '../lib/calendar';
import { liveAge } from '../format';
import { fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { TIME_ZONE_OPTIONS, addDays, dayBounds, dayKey, formatKey, mondayFor } from '../lib/time';
import { useStore } from '../store';
import './LiveIntelligence.css';
import './CalendarPage.css';

type CalendarSourceState = 'fresh' | 'stale';
type CalendarAvailableFeedTruth = Readonly<{
  kind: 'AVAILABLE';
  items: readonly CalItem[];
  fetchedAt: number;
  maxAgeMs: number;
  sourceState: CalendarSourceState;
}>;
type CalendarFeedTruth =
  | Readonly<{
    kind: 'LOADING';
    items: null;
    fetchedAt: null;
    maxAgeMs: null;
    sourceState: null;
  }>
  | CalendarAvailableFeedTruth
  | Readonly<{
    kind: 'FAILED';
    items: readonly CalItem[] | null;
    fetchedAt: number | null;
    maxAgeMs: number | null;
    sourceState: CalendarSourceState | null;
  }>;

export type CalendarFeedPresentation = Readonly<{
  status: 'LOADING' | 'CURRENT' | 'STALE' | 'UNAVAILABLE';
  detail: string;
}>;

export type CalendarWeekBounds = Readonly<{
  earliestWeekStart: string;
  latestWeekStart: string;
}>;

export type CalendarRangeTruth = Readonly<{
  requestedCovered: boolean;
  weekStart: string;
  selectedDay: string;
}>;

const INITIAL_CALENDAR_FEED: CalendarFeedTruth = Object.freeze({
  kind: 'LOADING',
  items: null,
  fetchedAt: null,
  maxAgeMs: null,
  sourceState: null,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function parseCalendarItem(value: unknown): CalItem {
  if (!isRecord(value)
      || typeof value.id !== 'string'
      || typeof value.title !== 'string'
      || typeof value.country !== 'string'
      || typeof value.indicator !== 'string'
      || typeof value.importance !== 'number'
      || !Number.isFinite(value.importance)
      || typeof value.period !== 'string'
      || !isNullableNumber(value.actual)
      || !isNullableNumber(value.forecast)
      || !isNullableNumber(value.previous)
      || !isNullableString(value.unit)
      || !isNullableString(value.scale)
      || !isNullableString(value.currency)
      || !isNullableString(value.category)
      || !isNullableString(value.comment)
      || !isNullableString(value.source)
      || !isNullableString(value.sourceUrl)
      || typeof value.date !== 'string'
      || !Number.isFinite(Date.parse(value.date))) {
    throw new TypeError('Calendar payload contains an invalid event.');
  }
  return {
    id: value.id,
    title: value.title,
    country: value.country,
    indicator: value.indicator,
    importance: value.importance,
    period: value.period,
    actual: value.actual,
    forecast: value.forecast,
    previous: value.previous,
    unit: value.unit,
    scale: value.scale,
    currency: value.currency,
    category: value.category,
    comment: value.comment,
    source: value.source,
    sourceUrl: value.sourceUrl,
    date: value.date,
  };
}

export function parseCalendarPayload(value: unknown, observedAtMs: number): CalendarAvailableFeedTruth {
  if (!isRecord(value)
      || !Array.isArray(value.items)
      || (value.state !== 'fresh' && value.state !== 'stale')
      || typeof value.fetchedAt !== 'number'
      || !Number.isFinite(value.fetchedAt)
      || value.fetchedAt <= 0
      || value.fetchedAt > observedAtMs
      || typeof value.maxAgeMs !== 'number'
      || !Number.isFinite(value.maxAgeMs)
      || value.maxAgeMs <= 0) {
    throw new TypeError('Calendar payload is missing authoritative freshness truth.');
  }
  const items = value.items.map(parseCalendarItem)
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
  return Object.freeze({
    kind: 'AVAILABLE',
    items: Object.freeze(items),
    fetchedAt: value.fetchedAt,
    maxAgeMs: value.maxAgeMs,
    sourceState: value.state,
  });
}

export function calendarFeedFailure(current: CalendarFeedTruth): CalendarFeedTruth {
  if (current.kind === 'LOADING') {
    return Object.freeze({
      kind: 'FAILED',
      items: null,
      fetchedAt: null,
      maxAgeMs: null,
      sourceState: null,
    });
  }
  return Object.freeze({
    kind: 'FAILED',
    items: current.items,
    fetchedAt: current.fetchedAt,
    maxAgeMs: current.maxAgeMs,
    sourceState: current.sourceState,
  });
}

export function calendarFeedPresentation(
  truth: CalendarFeedTruth,
  observedAtMs: number,
): CalendarFeedPresentation {
  if (truth.kind === 'LOADING') {
    return Object.freeze({ status: 'LOADING', detail: 'Awaiting the current calendar snapshot.' });
  }
  if (truth.kind === 'FAILED') {
    return truth.items === null
      ? Object.freeze({ status: 'UNAVAILABLE', detail: 'No calendar snapshot is available.' })
      : Object.freeze({ status: 'STALE', detail: 'Calendar refresh unavailable. Showing the last available server snapshot.' });
  }
  if (truth.sourceState === 'stale') {
    return Object.freeze({ status: 'STALE', detail: 'The server marked this calendar snapshot stale. Showing retained events.' });
  }
  if (observedAtMs < truth.fetchedAt || observedAtMs - truth.fetchedAt >= truth.maxAgeMs) {
    return Object.freeze({ status: 'STALE', detail: 'The calendar snapshot exceeded its published freshness window. Showing retained events.' });
  }
  return Object.freeze({ status: 'CURRENT', detail: 'Current calendar snapshot.' });
}

/**
 * The fetched server envelope runs from one week before its current UTC Monday
 * through the UTC Monday three weeks after it. Operator-zone weeks whose local
 * Monday-to-Monday instants cross either envelope edge are intentionally
 * hidden because they are not complete seven-day calendar views.
 */
export function calendarSupportedWeekBounds(fetchedAtMs: number, zone?: string): CalendarWeekBounds {
  const currentUtcWeekStart = mondayFor(dayKey(new Date(fetchedAtMs), 'UTC'));
  const envelopeStartMs = Date.parse(`${addDays(currentUtcWeekStart, -7)}T00:00:00Z`);
  const envelopeEndMs = Date.parse(`${addDays(currentUtcWeekStart, 21)}T00:00:00Z`);

  const firstLocalWeek = mondayFor(dayKey(new Date(envelopeStartMs), zone));
  const earliestWeekStart = dayBounds(firstLocalWeek, zone).since < envelopeStartMs
    ? addDays(firstLocalWeek, 7)
    : firstLocalWeek;

  const lastLocalWeek = mondayFor(dayKey(new Date(envelopeEndMs - 1), zone));
  const latestWeekStart = dayBounds(addDays(lastLocalWeek, 7), zone).since > envelopeEndMs
    ? addDays(lastLocalWeek, -7)
    : lastLocalWeek;

  if (earliestWeekStart > latestWeekStart) {
    throw new RangeError('Calendar server envelope has no complete operator-zone weeks.');
  }
  return Object.freeze({ earliestWeekStart, latestWeekStart });
}

export function calendarWeekNavigation(weekStart: string, bounds: CalendarWeekBounds) {
  return Object.freeze({
    previousDisabled: weekStart <= bounds.earliestWeekStart,
    nextDisabled: weekStart >= bounds.latestWeekStart,
  });
}

export function moveCalendarWeekWithinBounds(
  weekStart: string,
  delta: number,
  bounds: CalendarWeekBounds,
): string {
  const requested = addDays(weekStart, delta * 7);
  if (requested < bounds.earliestWeekStart) return bounds.earliestWeekStart;
  if (requested > bounds.latestWeekStart) return bounds.latestWeekStart;
  return requested;
}

export function calendarRangeTruth(
  weekStart: string,
  selectedDay: string,
  bounds: CalendarWeekBounds,
): CalendarRangeTruth {
  const boundedWeekStart = moveCalendarWeekWithinBounds(weekStart, 0, bounds);
  const requestedWeekCovered = boundedWeekStart === weekStart;
  const selectedDayCovered = selectedDay >= boundedWeekStart && selectedDay < addDays(boundedWeekStart, 7);
  const requestedCovered = requestedWeekCovered && selectedDayCovered;
  return Object.freeze({
    requestedCovered,
    weekStart: boundedWeekStart,
    selectedDay: requestedCovered ? selectedDay : boundedWeekStart,
  });
}

export function calendarRangePresentation(
  presentation: CalendarFeedPresentation,
  rangeCovered: boolean,
): CalendarFeedPresentation {
  if (rangeCovered || presentation.status !== 'CURRENT') return presentation;
  return Object.freeze({
    status: 'UNAVAILABLE',
    detail: 'Selected week is outside the fetched calendar envelope. Adjusting to a supported range.',
  });
}

export function calendarEmptyState(
  hasSnapshot: boolean,
  visibleCount: number,
  rangeCovered: boolean,
): 'RANGE_UNAVAILABLE' | 'NO_EVENTS' | null {
  if (!hasSnapshot) return null;
  if (!rangeCovered) return 'RANGE_UNAVAILABLE';
  return visibleCount === 0 ? 'NO_EVENTS' : null;
}

function eventFingerprint(item: CalItem): string {
  return `${item.actual ?? ''}|${item.forecast ?? ''}|${item.previous ?? ''}|${item.date}`;
}

function countdownLabel(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((timestamp - now) / 1_000));
  if (seconds >= 86_400) return `Coming In ${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3_600)}h`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours > 0) return `Coming In ${hours}:${String(minutes).padStart(2, '0')}`;
  return `Coming In ${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function ImpactBars({ importance }: { importance: number }) {
  const active = importance >= 1 ? 3 : importance === 0 ? 2 : 1;
  return <span className={`calx-impact level-${active}`} title={active === 3 ? 'High Impact' : active === 2 ? 'Medium Impact' : 'Low Impact'} aria-label={`${active === 3 ? 'High' : active === 2 ? 'Medium' : 'Low'} Impact`}>
    {[1, 2, 3].map((bar) => <i key={bar} className={bar <= active ? 'on' : ''} />)}
  </span>;
}

export function CalendarFeedStatus({
  presentation,
  fetchedAt,
}: {
  presentation: CalendarFeedPresentation;
  fetchedAt: number | null;
}) {
  const label = presentation.status === 'CURRENT' && fetchedAt !== null
    ? `Live · ${liveAge(fetchedAt)}`
    : presentation.status === 'STALE' && fetchedAt !== null
      ? `Stale · ${liveAge(fetchedAt)}`
      : presentation.status === 'UNAVAILABLE'
        ? 'Unavailable'
        : 'Loading';
  const tone = presentation.status === 'STALE'
    ? 'stale'
    : presentation.status === 'UNAVAILABLE'
      ? 'error'
      : presentation.status === 'LOADING'
        ? 'loading'
        : '';

  return <span className={`lix-live ${tone}`.trim()} role="status" title={presentation.detail}><i />{label}</span>;
}

export function CalendarPage() {
  const { prefs, updatePref } = useStore();
  const zone = prefs.clockZone && prefs.clockZone !== 'local' ? prefs.clockZone : undefined;
  const initialToday = dayKey(new Date(), zone);
  const [feed, setFeed] = useState<CalendarFeedTruth>(INITIAL_CALENDAR_FEED);
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('all');
  const [impact, setImpact] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [weekStart, setWeekStart] = useState(() => mondayFor(initialToday));
  const [selectedDay, setSelectedDay] = useState(initialToday);
  const [clock, setClock] = useState(Date.now());
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const previousRef = useRef<Map<string, string>>(new Map());
  const changeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const today = dayKey(new Date(), zone);
    setWeekStart(mondayFor(today));
    setSelectedDay(today);
  }, [zone]);

  useEffect(() => {
    const cadence = Math.min(10, Math.max(0.5, prefs.dataCadence?.calendar ?? 10));
    const poll = createSettledPoll<unknown>({
      intervalMs: cadence * 1_000,
      request: (signal) => fetchJson('/api/calendar', { signal }),
      onSuccess: (payload) => {
        const nextFeed = parseCalendarPayload(payload, Date.now());
        const next = [...nextFeed.items];
        if (previousRef.current.size) {
          const changed = next.filter((item) => previousRef.current.get(item.id) !== eventFingerprint(item)).map((item) => item.id);
          if (changed.length) {
            setChangedIds(new Set(changed));
            if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current);
            changeTimerRef.current = window.setTimeout(() => setChangedIds(new Set()), 1_600);
          }
        }
        previousRef.current = new Map(next.map((item) => [item.id, eventFingerprint(item)]));
        setFeed(nextFeed);
      },
      onError: () => setFeed(calendarFeedFailure),
    });
    poll.start();
    return () => {
      poll.stop();
      if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current);
    };
  }, [prefs.dataCadence?.calendar]);

  const envelopeUtcDay = dayKey(new Date(feed.fetchedAt ?? clock), 'UTC');
  const supportedWeeks = useMemo(
    () => calendarSupportedWeekBounds(Date.parse(`${envelopeUtcDay}T12:00:00Z`), zone),
    [envelopeUtcDay, zone],
  );
  const rangeTruth = useMemo(
    () => calendarRangeTruth(weekStart, selectedDay, supportedWeeks),
    [selectedDay, supportedWeeks, weekStart],
  );
  const rangeCovered = feed.fetchedAt === null || rangeTruth.requestedCovered;
  const weekNavigation = calendarWeekNavigation(rangeTruth.weekStart, supportedWeeks);
  const weekKeys = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(rangeTruth.weekStart, index)),
    [rangeTruth.weekStart],
  );
  const items = feed.items;
  const allItems = items ?? [];
  const itemsByDay = useMemo(() => {
    const grouped = new Map<string, CalItem[]>();
    allItems.forEach((item) => {
      const date = new Date(item.date);
      if (!Number.isFinite(date.getTime())) return;
      const key = dayKey(date, zone);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });
    return grouped;
  }, [allItems, zone]);

  const visible = useMemo(() => {
    if (!rangeCovered) return [];
    const text = query.trim().toLowerCase();
    return (itemsByDay.get(rangeTruth.selectedDay) ?? []).filter((item) => {
      const level = item.importance >= 1 ? 'high' : item.importance === 0 ? 'medium' : 'low';
      if (impact !== 'all' && level !== impact) return false;
      if (country !== 'all' && item.country !== country) return false;
      const haystack = `${item.title} ${item.indicator} ${item.period} ${item.country} ${countryName(item.country)} ${item.source ?? ''} ${item.currency ?? ''}`.toLowerCase();
      return !text || text.split(/\s+/).every((token) => haystack.includes(token));
    });
  }, [country, impact, itemsByDay, query, rangeCovered, rangeTruth.selectedDay]);

  const nextEventId = useMemo(() => allItems.find((item) => item.actual === null && Date.parse(item.date) >= clock)?.id ?? null, [allItems, clock]);
  const availableCountries = useMemo(() => {
    const present = new Set(allItems.map((item) => item.country));
    return CALENDAR_COUNTRIES.filter((code) => present.has(code));
  }, [allItems]);
  useEffect(() => {
    if (weekStart !== rangeTruth.weekStart) setWeekStart(rangeTruth.weekStart);
    if (selectedDay !== rangeTruth.selectedDay) setSelectedDay(rangeTruth.selectedDay);
  }, [rangeTruth.selectedDay, rangeTruth.weekStart, selectedDay, weekStart]);

  const feedPresentation = calendarRangePresentation(calendarFeedPresentation(feed, clock), rangeCovered);
  const emptyState = calendarEmptyState(items !== null, visible.length, rangeCovered);
  const rangeLabel = `${formatKey(rangeTruth.weekStart, { month: 'short', day: 'numeric' })} — ${formatKey(addDays(rangeTruth.weekStart, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const moveWeek = (delta: number) => {
    const next = moveCalendarWeekWithinBounds(rangeTruth.weekStart, delta, supportedWeeks);
    if (next === rangeTruth.weekStart) return;
    setWeekStart(next);
    setSelectedDay(next);
  };
  const returnToday = () => {
    const today = dayKey(new Date(), zone);
    setWeekStart(mondayFor(today));
    setSelectedDay(today);
  };

  return (
    <div className="container page lix-page calx-page">
      <div className="lix-frame">
      <header className="lix-toolbar">
        <div className="lix-title calx-title">
          <img className="calx-page-mark" src="/calendar-check.png" alt="" aria-hidden="true" />
          <h1>Economic Calendar</h1>
          <CalendarFeedStatus presentation={feedPresentation} fetchedAt={feed.fetchedAt} />
        </div>
        <div className="lix-toolbar-tools">
          <label className="lix-search">
            <IconSearch size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" spellCheck={false} />
            {query && <button type="button" aria-label="Clear Search" onClick={() => setQuery('')}>×</button>}
          </label>
        </div>
      </header>

      <section className="calx-navigation" aria-label="Calendar Navigation">
        <div className="calx-range-controls">
          <button type="button" className="calx-today" onClick={returnToday}>Today</button>
          <button type="button" className="calx-arrow" disabled={weekNavigation.previousDisabled} onClick={() => moveWeek(-1)} aria-label="Previous Week">‹</button>
          <button type="button" className="calx-arrow" disabled={weekNavigation.nextDisabled} onClick={() => moveWeek(1)} aria-label="Next Week">›</button>
          <strong>{rangeLabel}</strong>
        </div>
        <PillSelect value={prefs.clockZone} options={TIME_ZONE_OPTIONS.map((option) => ({ ...option }))} onChange={(value) => updatePref('clockZone', value)} ariaLabel="Time Zone" className="lix-select lix-zone-select" />
      </section>

      <section className="calx-week" aria-label="Week">
        {weekKeys.map((key) => {
          const rows = itemsByDay.get(key) ?? [];
          const high = rows.filter((item) => item.importance >= 1).length;
          return <button type="button" key={key} className={`${key === rangeTruth.selectedDay ? 'selected' : ''} ${key === initialToday ? 'today' : ''}`} onClick={() => setSelectedDay(key)}>
            <span className="calx-day-name">{formatKey(key, { weekday: 'short' })} <b>{formatKey(key, { day: 'numeric' })}</b></span>
            <span><em>Economic</em><b>{rows.length}</b></span>
            <span><em>High Impact</em><b>{high}</b></span>
          </button>;
        })}
      </section>

      <section className="lix-filters" aria-label="Calendar Filters">
        <div className="lix-segments" role="group" aria-label="Impact">
          <button type="button" className={impact === 'all' ? 'selected' : ''} onClick={() => setImpact('all')}>All Events</button>
          <button type="button" className={impact === 'high' ? 'selected' : ''} onClick={() => setImpact('high')}>High</button>
          <button type="button" className={impact === 'medium' ? 'selected' : ''} onClick={() => setImpact('medium')}>Medium</button>
          <button type="button" className={impact === 'low' ? 'selected' : ''} onClick={() => setImpact('low')}>Low</button>
        </div>
        <PillSelect value={country} options={[{ id: 'all', label: 'All Countries' }, ...availableCountries.map((code) => ({ id: code, label: `${flag(code)} ${countryName(code)}` }))]} onChange={setCountry} ariaLabel="Country" className="lix-select" />
      </section>

      <section className="calx-tape" aria-label="Economic Events">
        {feedPresentation.status === 'STALE' && (
          <div className="calx-truth-note stale" role="status">
            <strong>Stale Calendar Snapshot</strong>
            <span>{feedPresentation.detail}</span>
          </div>
        )}
        <div className="calx-day-header">
          <strong>{formatKey(rangeTruth.selectedDay, { weekday: 'long', month: 'long', day: 'numeric' })}</strong>
          <span className="calx-col-actual">Actual</span><span>Forecast</span><span>Prior</span>
        </div>
        <div className="calx-scroll">
          {visible.map((item, index) => {
            const timestamp = Date.parse(item.date);
            const previous = visible[index - 1];
            const repeated = previous && previous.country === item.country && previous.date === item.date;
            const time = new Date(item.date).toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
            const upcoming = item.id === nextEventId;
            const title = `${item.title}${item.period ? ` ${item.period}` : ''}`;
            return <div key={item.id} className={`calx-row ${upcoming ? 'next' : ''} ${changedIds.has(item.id) ? 'fresh' : ''}`} title={item.comment ?? title}>
              <span className="calx-time">{repeated ? '' : time}</span>
              <span className="calx-country">{repeated ? '' : <><i>{flag(item.country)}</i><b>{countryName(item.country)}</b></>}</span>
              <ImpactBars importance={item.importance} />
              <span className="calx-event"><b>{title}</b><em>{item.source || categoryName(item)}</em></span>
              <span className={`calx-number actual ${upcoming && item.actual === null ? 'upcoming' : ''}`}>{upcoming && item.actual === null ? countdownLabel(timestamp, clock) : calVal(item.actual, item.unit, item.scale)}</span>
              <span className="calx-number">{calVal(item.forecast, item.unit, item.scale)}</span>
              <span className="calx-number prior">{calVal(item.previous, item.unit, item.scale)}</span>
            </div>;
          })}
          {items === null && feedPresentation.status === 'LOADING' && <div className="lix-empty">Loading Economic Events…</div>}
          {items === null && feedPresentation.status === 'UNAVAILABLE' && <div className="lix-empty">The Calendar Feed Is Currently Unavailable.</div>}
          {emptyState === 'RANGE_UNAVAILABLE' && <div className="lix-empty">Adjusting To The Fetched Calendar Range…</div>}
          {emptyState === 'NO_EVENTS' && <div className="lix-empty">No Events Match These Filters.</div>}
        </div>
      </section>
      </div>
    </div>
  );
}
