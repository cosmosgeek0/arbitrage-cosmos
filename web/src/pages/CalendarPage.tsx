import { useEffect, useMemo, useRef, useState } from 'react';
import { IconSearch } from '../components/Icons';
import { PillSelect } from '../components/PillSelect';
import { CALENDAR_COUNTRIES, calVal, categoryName, countryName, flag, type CalItem } from '../lib/calendar';
import { liveAge } from '../format';
import { TIME_ZONE_OPTIONS, addDays, dayKey, formatKey, mondayFor } from '../lib/time';
import { useStore } from '../store';
import './LiveIntelligence.css';

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

export function CalendarPage() {
  const { prefs, updatePref } = useStore();
  const zone = prefs.clockZone && prefs.clockZone !== 'local' ? prefs.clockZone : undefined;
  const initialToday = dayKey(new Date(), zone);
  const [items, setItems] = useState<CalItem[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('all');
  const [impact, setImpact] = useState<'all' | 'high'>('all');
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
    let alive = true;
    let timer: number | null = null;
    const cadence = Math.min(60, Math.max(5, prefs.dataCadence?.calendar ?? 30));
    const load = () => {
      fetch('/api/calendar')
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('calendar unavailable')))
        .then((payload: { items: CalItem[]; fetchedAt?: number }) => {
          if (!alive) return;
          const next = [...(payload.items ?? [])].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
          if (previousRef.current.size) {
            const changed = next.filter((item) => previousRef.current.get(item.id) !== eventFingerprint(item)).map((item) => item.id);
            if (changed.length) {
              setChangedIds(new Set(changed));
              if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current);
              changeTimerRef.current = window.setTimeout(() => setChangedIds(new Set()), 1_600);
            }
          }
          previousRef.current = new Map(next.map((item) => [item.id, eventFingerprint(item)]));
          setItems(next);
          setFetchedAt(payload.fetchedAt ?? Date.now());
          setFailed(false);
        })
        .catch(() => { if (alive) setFailed(true); });
    };
    load();
    timer = window.setInterval(load, cadence * 1_000);
    return () => {
      alive = false;
      if (timer !== null) window.clearInterval(timer);
      if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current);
    };
  }, [prefs.dataCadence?.calendar]);

  const weekKeys = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
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
    const text = query.trim().toLowerCase();
    return (itemsByDay.get(selectedDay) ?? []).filter((item) => {
      if (impact === 'high' && item.importance < 1) return false;
      if (country !== 'all' && item.country !== country) return false;
      const haystack = `${item.title} ${item.indicator} ${item.period} ${item.country} ${countryName(item.country)} ${item.source ?? ''} ${item.currency ?? ''}`.toLowerCase();
      return !text || text.split(/\s+/).every((token) => haystack.includes(token));
    });
  }, [country, impact, itemsByDay, query, selectedDay]);

  const nextEventId = useMemo(() => allItems.find((item) => item.actual === null && Date.parse(item.date) >= clock)?.id ?? null, [allItems, clock]);
  const availableCountries = useMemo(() => {
    const present = new Set(allItems.map((item) => item.country));
    return CALENDAR_COUNTRIES.filter((code) => present.has(code));
  }, [allItems]);
  const status = failed ? 'Feed Unavailable' : fetchedAt ? `Live · ${liveAge(fetchedAt)}` : 'Loading';
  const rangeLabel = `${formatKey(weekStart, { month: 'short', day: 'numeric' })} — ${formatKey(addDays(weekStart, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const moveWeek = (delta: number) => {
    const next = addDays(weekStart, delta * 7);
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
        <div className="lix-title"><h1>Economic Calendar</h1><span className={`lix-live ${failed ? 'error' : ''}`}><i />{status}</span></div>
        <label className="lix-search">
          <IconSearch size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" spellCheck={false} />
          {query && <button type="button" aria-label="Clear Search" onClick={() => setQuery('')}>×</button>}
        </label>
      </header>

      <section className="calx-navigation" aria-label="Calendar Navigation">
        <div className="calx-range-controls">
          <button type="button" className="calx-today" onClick={returnToday}>Today</button>
          <button type="button" className="calx-arrow" onClick={() => moveWeek(-1)} aria-label="Previous Week">‹</button>
          <button type="button" className="calx-arrow" onClick={() => moveWeek(1)} aria-label="Next Week">›</button>
          <strong>{rangeLabel}</strong>
        </div>
        <PillSelect value={prefs.clockZone} options={TIME_ZONE_OPTIONS.map((option) => ({ ...option }))} onChange={(value) => updatePref('clockZone', value)} ariaLabel="Time Zone" className="lix-select lix-zone-select" />
      </section>

      <section className="calx-week" aria-label="Week">
        {weekKeys.map((key) => {
          const rows = itemsByDay.get(key) ?? [];
          const high = rows.filter((item) => item.importance >= 1).length;
          return <button type="button" key={key} className={`${key === selectedDay ? 'selected' : ''} ${key === initialToday ? 'today' : ''}`} onClick={() => setSelectedDay(key)}>
            <span className="calx-day-name">{formatKey(key, { weekday: 'short' })} <b>{formatKey(key, { day: 'numeric' })}</b></span>
            <span><em>Economic</em><b>{rows.length}</b></span>
            <span><em>High Impact</em><b>{high}</b></span>
          </button>;
        })}
      </section>

      <section className="lix-filters" aria-label="Calendar Filters">
        <div className="lix-segments" role="group" aria-label="Impact">
          <button type="button" className={impact === 'all' ? 'selected' : ''} onClick={() => setImpact('all')}>All Events</button>
          <button type="button" className={impact === 'high' ? 'selected' : ''} onClick={() => setImpact('high')}>High Impact</button>
        </div>
        <PillSelect value={country} options={[{ id: 'all', label: 'All Countries' }, ...availableCountries.map((code) => ({ id: code, label: `${flag(code)} ${countryName(code)}` }))]} onChange={setCountry} ariaLabel="Country" className="lix-select" />
      </section>

      <section className="calx-tape" aria-label="Economic Events">
        <div className="calx-day-header">
          <strong>{formatKey(selectedDay, { weekday: 'long', month: 'long', day: 'numeric' })}</strong>
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
          {items === null && !failed && <div className="lix-empty">Loading Economic Events…</div>}
          {failed && <div className="lix-empty">The Calendar Feed Is Currently Unavailable.</div>}
          {items !== null && !failed && visible.length === 0 && <div className="lix-empty">No Events Match These Filters.</div>}
        </div>
      </section>
      </div>
    </div>
  );
}
