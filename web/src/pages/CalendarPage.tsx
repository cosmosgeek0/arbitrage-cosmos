import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { calVal, flag, type CalItem } from '../components/Header';
import { Pill } from '../components/px';
import { IconCalendar, IconExternal, IconRefresh } from '../components/Icons';
import { liveAge } from '../format';
import './Markets.css';

// Full-page economic calendar (TradingView feed, server-proxied). More context
// than the quick view: importance + country filters and full week grouping.
const COUNTRIES = ['US', 'EU', 'GB', 'JP', 'CN', 'IN', 'DE', 'CA', 'AU', 'FR'];

export function CalendarPage() {
  const { prefs } = useStore();
  const [items, setItems] = useState<CalItem[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [minImp, setMinImp] = useState<-1 | 0 | 1>(-1);
  const [country, setCountry] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const zone = prefs.clockZone && prefs.clockZone !== 'local' ? prefs.clockZone : undefined;

  useEffect(() => {
    const t = window.setInterval(() => setNonce((n) => n + 1), Math.max(0.5, prefs.dataCadence?.calendar ?? 300) * 1000);
    return () => window.clearInterval(t);
  }, [prefs.dataCadence?.calendar]);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    let releaseTimer: number | null = null;
    const startedAt = Date.now();
    setFailed(false);
    setRefreshing(nonce > 0);
    const releaseRefreshing = () => {
      if (nonce <= 0) {
        setRefreshing(false);
        return;
      }
      const delay = Math.max(0, 1600 - (Date.now() - startedAt));
      releaseTimer = window.setTimeout(() => {
        if (alive) setRefreshing(false);
      }, delay);
    };
    fetch('/api/calendar', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad'))))
      .then((d: { items: CalItem[]; fetchedAt?: number }) => {
        if (!alive) return;
        setItems(d.items ?? []);
        setFetchedAt(d.fetchedAt ?? null);
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && releaseRefreshing());
    return () => {
      alive = false;
      if (releaseTimer !== null) window.clearTimeout(releaseTimer);
      ctrl.abort();
    };
  }, [nonce]);

  const filtered = useMemo(
    () => (items ?? []).filter((it) => it.importance >= minImp && (!country || it.country === country)),
    [items, minImp, country]
  );

  const days = useMemo(() => {
    const out: { key: string; label: string; rows: CalItem[] }[] = [];
    for (const it of filtered) {
      const d = new Date(it.date);
      if (isNaN(d.getTime())) continue;
      const key = d.toLocaleDateString('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
      let g = out.find((x) => x.key === key);
      if (!g) {
        g = { key, label: d.toLocaleDateString('en-US', { timeZone: zone, weekday: 'long', month: 'short', day: 'numeric' }), rows: [] };
        out.push(g);
      }
      g.rows.push(it);
    }
    return out;
  }, [filtered, zone]);

  const status = failed ? 'Feed Unreachable' : fetchedAt ? `Live · ${liveAge(fetchedAt)}` : 'Fetching';
  const timeZoneLabel = prefs.clockZone === 'local' ? 'local time' : prefs.clockZone;

  return (
    <div className="container page mkx ux-page cal-page clx-page">
      <header className="bwx-hero bsx-hero ux-hero">
        <div className="bwx-hero-top">
          <div className="bwx-hero-title">
            <div className="bwx-title-row">
              <h1>Calendar</h1>
            </div>
            <p>Economic events for the next 6 days. Times in {timeZoneLabel}. Refreshed every 10 minutes.</p>
          </div>
          <span className="tdx-head-right">
            <Pill tone={failed ? 'bad' : fetchedAt ? 'ok' : 'idle'} className={`ux-live-status ${refreshing ? 'syncing' : ''}`}>{status}</Pill>
            <button className={`mkx-pill ux-refresh ${refreshing ? 'checking refreshing' : ''}`} onClick={() => setNonce((n) => n + 1)} disabled={refreshing} title={refreshing ? 'Refreshing Calendar Feed' : 'Refresh Calendar Feed'}>
              <span className="ux-refresh-beam" aria-hidden="true" />
              <IconRefresh size={13} />
              <span>Refresh</span>
            </button>
          </span>
        </div>
      </header>

      <div className="cal-filters clx-filters ux-filters">
        <div className="news-tabs">
          <button className={`news-tab ${minImp === -1 ? 'on' : ''}`} onClick={() => setMinImp(-1)}>All Events</button>
          <button className={`news-tab ${minImp === 0 ? 'on' : ''}`} onClick={() => setMinImp(0)}>Medium +</button>
          <button className={`news-tab ${minImp === 1 ? 'on' : ''}`} onClick={() => setMinImp(1)}>High Impact</button>
        </div>
        <label className="ux-select-wrap">
          <IconCalendar size={14} />
          <select
            value={country ?? 'all'}
            onChange={(e) => {
              const next = e.target.value;
              setCountry(next === 'all' ? null : next);
            }}
            aria-label="Country Filter"
          >
            <option value="all">All countries</option>
            {COUNTRIES.map((c) => <option key={c} value={c}>{flag(c)} {c}</option>)}
          </select>
        </label>
      </div>

      <div className="cal-cols page-cols">
        <span className="cc-time">Time</span><span className="cc-evt">Event</span>
        <span className="cc-num">Actual</span><span className="cc-num">Forecast</span><span className="cc-num">Prior</span>
      </div>
      <div className="cal-page-list">
        {items === null && !failed && <div className="ov-empty">Loading…</div>}
        {failed && <div className="ov-empty">Calendar unavailable — source could not be reached. Check Data health.</div>}
        {items !== null && !failed && days.length === 0 && <div className="ov-empty">No events match these filters.</div>}
        {days.map((g) => (
          <div key={g.key} className="cal-day">
            <div className="cal-day-head lg">{g.label}<span className="cal-day-count">{g.rows.length} events</span></div>
            {g.rows.map((it) => {
              const imp = it.importance >= 1 ? 'high' : it.importance === 0 ? 'med' : 'low';
              const t = new Date(it.date).toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
              return (
                <div key={it.id} className="cal-row lg">
                  <span className="cc-time num">{t}</span>
                  <span className="cc-evt">
                    <span className="cal-flag">{flag(it.country)}</span>
                    <span className={`cal-imp ${imp}`} title={imp === 'high' ? 'High impact' : imp === 'med' ? 'Medium impact' : 'Low impact'} />
                    <span className="cal-title">
                      {it.title}
                      {it.period ? <span className="cal-period"> {it.period}</span> : null}
                      {it.indicator && it.indicator !== 'Calendar' && it.indicator !== it.title ? (
                        <span className="cal-indicator"> · {it.indicator}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="cc-num num strong">{calVal(it.actual, it.unit)}</span>
                  <span className="cc-num num">{calVal(it.forecast, it.unit)}</span>
                  <span className="cc-num num muted">{calVal(it.previous, it.unit)}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="news-source-note">
        Source: TradingView economic calendar (server-proxied). <a href="https://www.tradingview.com/economic-calendar/" target="_blank" rel="noreferrer noopener">Open TradingView <IconExternal size={12} /></a>
      </p>
    </div>
  );
}
