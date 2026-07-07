import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { LiveDot, calVal, flag, type CalItem } from '../components/Header';
import { IconCalendar, IconExternal, IconRefresh } from '../components/Icons';
import { timeAgo } from '../format';

// Full-page economic calendar (TradingView feed, server-proxied). More context
// than the quick view: importance + country filters and full week grouping.
const COUNTRIES = ['US', 'EU', 'GB', 'JP', 'CN', 'IN', 'DE', 'CA', 'AU', 'FR'];

export function CalendarPage() {
  const { prefs } = useStore();
  const [items, setItems] = useState<CalItem[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [minImp, setMinImp] = useState<-1 | 0 | 1>(-1);
  const [country, setCountry] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const zone = prefs.clockZone && prefs.clockZone !== 'local' ? prefs.clockZone : undefined;

  useEffect(() => {
    let alive = true;
    setFailed(false);
    fetch('/api/calendar')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad'))))
      .then((d: { items: CalItem[]; fetchedAt?: number }) => {
        if (!alive) return;
        setItems(d.items ?? []);
        setFetchedAt(d.fetchedAt ?? null);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
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

  return (
    <div className="container page cal-page">
      <div className="page-head">
        <div>
          <div className="page-kicker">Intelligence</div>
          <h1 className="page-title">Economic calendar <LiveDot /></h1>
          <div className="page-sub">
            Next 6 days · times in {prefs.clockZone === 'local' ? 'local time' : prefs.clockZone} · cached 10 min ·{' '}
            {fetchedAt ? `fetched ${timeAgo(fetchedAt)}` : 'fetching…'}
          </div>
        </div>
        <div className="head-actions">
          <button className="ov-btn" onClick={() => setNonce((n) => n + 1)} title="Refresh"><IconRefresh size={14} /> Refresh</button>
          <a className="ov-btn" href="https://www.tradingview.com/economic-calendar/" target="_blank" rel="noreferrer noopener">
            <IconExternal size={14} /> TradingView
          </a>
        </div>
      </div>

      <div className="cal-filters">
        <div className="news-tabs">
          <button className={`news-tab ${minImp === -1 ? 'on' : ''}`} onClick={() => setMinImp(-1)}>All events</button>
          <button className={`news-tab ${minImp === 0 ? 'on' : ''}`} onClick={() => setMinImp(0)}>Medium +</button>
          <button className={`news-tab ${minImp === 1 ? 'on' : ''}`} onClick={() => setMinImp(1)}>High impact</button>
        </div>
        <div className="news-tabs">
          <button className={`news-tab ${country === null ? 'on' : ''}`} onClick={() => setCountry(null)}>🌐 All</button>
          {COUNTRIES.map((c) => (
            <button key={c} className={`news-tab ${country === c ? 'on' : ''}`} onClick={() => setCountry(country === c ? null : c)}>
              {flag(c)} {c}
            </button>
          ))}
        </div>
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
        Source: TradingView economic calendar (server-proxied). Dots mark impact: red high, accent medium, grey low.
      </p>
    </div>
  );
}
