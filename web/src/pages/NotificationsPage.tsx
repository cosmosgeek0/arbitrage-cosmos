import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconBell, IconNewspaper, IconPulse, IconRadar, IconSearch, IconShield, IconWallet } from '../components/Icons';
import { PillSelect } from '../components/PillSelect';
import { liveAge } from '../format';
import { curateNotifications, groupNotifications, notificationEnabled, type CuratedNotification } from '../lib/notifications';
import { type NotificationRuleKey, type NotificationRules } from '../lib/prefs';
import { TIME_ZONE_OPTIONS, addDays, dayKey, formatKey, resolvedZoneLabel } from '../lib/time';
import { useStore } from '../store';
import type { LedgerEvent } from '../types';
import './LiveIntelligence.css';
import './NotificationsPage.css';

type NotificationFilter = 'all' | NotificationRuleKey;

const RULES: { key: NotificationRuleKey; label: string; short: string }[] = [
  { key: 'critical', label: 'Critical & Security', short: 'Failures, blocks, and emergency controls' },
  { key: 'account', label: 'Account & Execution', short: 'Orders, fills, loans, and Binance state' },
  { key: 'bot', label: 'Bot Health', short: 'Engines, streams, runner, and controls' },
  { key: 'opportunities', label: 'Opportunities', short: 'Opened strategy signals only' },
  { key: 'news', label: 'Announcements', short: 'Exchange maintenance, listings, and API notices' },
];

const FILTERS: { id: NotificationFilter; label: string }[] = [
  { id: 'all', label: 'All Alerts' },
  { id: 'critical', label: 'Critical' },
  { id: 'account', label: 'Account' },
  { id: 'bot', label: 'Bot' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'news', label: 'News' },
];

function categoryIcon(category: NotificationRuleKey, size = 15): ReactNode {
  if (category === 'critical') return <IconShield size={size} />;
  if (category === 'account') return <IconWallet size={size} />;
  if (category === 'opportunities') return <IconRadar size={size} />;
  if (category === 'news') return <IconNewspaper size={size} />;
  return <IconPulse size={size} />;
}

function notificationTime(timestamp: number, zone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
}

function statusLabel(item: CuratedNotification): string {
  if (item.count > 1) return `${item.count} Grouped`;
  if (item.severity === 'critical') return 'Action';
  if (item.severity === 'warning') return 'Review';
  return 'Notified';
}

export function NotificationsPage() {
  const { prefs, updatePref } = useStore();
  const zone = prefs.clockZone && prefs.clockZone !== 'local' ? prefs.clockZone : undefined;
  const today = dayKey(new Date(), zone);
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedDay, setSelectedDay] = useState(today);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [draftRules, setDraftRules] = useState<NotificationRules>(() => prefs.alerts);
  const [seen, setSeen] = useState(() => Number(localStorage.getItem('cosmos-notif-seen') || 0));
  const cursorRef = useRef(0);

  useEffect(() => setSelectedDay(dayKey(new Date(), zone)), [zone]);
  useEffect(() => setDraftRules(prefs.alerts), [prefs.alerts]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      const since = cursorRef.current > 0 ? cursorRef.current + 1 : Date.now() - 7 * 24 * 60 * 60_000;
      fetch(`/api/events?since=${since}&limit=20000`)
        .then((response) => response.ok ? response.json() as Promise<LedgerEvent[]> : Promise.reject(new Error('notification archive unavailable')))
        .then((incoming) => {
          if (!alive) return;
          if (incoming.length) {
            cursorRef.current = Math.max(cursorRef.current, ...incoming.map((item) => item.ts));
            setEvents((current) => {
              const merged = new Map<number, LedgerEvent>();
              current.forEach((item) => merged.set(item.id, item));
              incoming.forEach((item) => merged.set(item.id, item));
              return [...merged.values()].sort((a, b) => b.ts - a.ts || b.id - a.id).slice(0, 20000);
            });
          }
          setFetchedAt(Date.now());
          setFailed(false);
        })
        .catch(() => { if (alive) setFailed(true); });
    };
    void load();
    const timer = window.setInterval(load, 5_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  const notifications = useMemo(() => groupNotifications(curateNotifications(events)), [events]);
  const enabled = useMemo(() => notifications.filter((item) => notificationEnabled(item, draftRules)), [draftRules, notifications]);
  const dayKeys = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(today, index - 6)), [today]);
  const itemsByDay = useMemo(() => {
    const grouped = new Map<string, CuratedNotification[]>();
    enabled.forEach((item) => {
      const key = dayKey(new Date(item.ts), zone);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });
    return grouped;
  }, [enabled, zone]);
  const selectedItems = itemsByDay.get(selectedDay) ?? [];
  const deferredQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => selectedItems.filter((item) => {
    if (filter !== 'all' && item.category !== filter) return false;
    if (!deferredQuery) return true;
    return `${item.title} ${item.detail} ${item.subject} ${item.kind}`.toLowerCase().includes(deferredQuery);
  }), [deferredQuery, filter, selectedItems]);
  const categoryCounts = useMemo(() => notifications.reduce<Record<NotificationRuleKey, number>>((counts, item) => {
    counts[item.category] += item.count;
    return counts;
  }, { critical: 0, account: 0, bot: 0, opportunities: 0, news: 0 }), [notifications]);
  const selectedCritical = selectedItems.filter((item) => item.severity === 'critical').reduce((sum, item) => sum + item.count, 0);
  const selectedWarning = selectedItems.filter((item) => item.severity === 'warning').reduce((sum, item) => sum + item.count, 0);
  const selectedInfo = selectedItems.filter((item) => item.severity !== 'critical' && item.severity !== 'warning').reduce((sum, item) => sum + item.count, 0);
  const selectedTotal = selectedItems.reduce((sum, item) => sum + item.count, 0);
  const unread = enabled.filter((item) => item.id > seen).reduce((sum, item) => sum + item.count, 0);
  const rulesDirty = JSON.stringify(draftRules) !== JSON.stringify(prefs.alerts);
  const rangeLabel = `${formatKey(dayKeys[0], { month: 'short', day: 'numeric' })} — ${formatKey(dayKeys[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const status = failed ? 'Archive Unavailable' : fetchedAt ? `Live · ${liveAge(fetchedAt)}` : 'Loading';

  const markRead = () => {
    if (!enabled.length) return;
    const latest = Math.max(...enabled.map((item) => item.id));
    setSeen(latest);
    localStorage.setItem('cosmos-notif-seen', String(latest));
  };
  const saveRules = () => updatePref('alerts', draftRules);

  return <div className="container page lix-page notifx-page">
    <div className="lix-frame">
      <header className="lix-toolbar">
        <div className="lix-title"><h1>Notifications</h1><span className={`lix-live ${failed ? 'error' : 'streaming'}`}><i />{status}</span></div>
        <label className="lix-search">
          <IconSearch size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" spellCheck={false} />
          {query && <button type="button" aria-label="Clear Search" onClick={() => setQuery('')}>×</button>}
        </label>
      </header>

      <section className="calx-navigation notifx-navigation" aria-label="Notifications Navigation">
        <div className="calx-range-controls">
          <button type="button" className="calx-today" onClick={() => setSelectedDay(today)}>Today</button>
          <strong>{rangeLabel}</strong><span className="newsx-range-note">Rolling Seven Days</span>
        </div>
        <div className="notifx-navigation-actions">
          <button type="button" className="notifx-mark-read" onClick={markRead} disabled={unread === 0}><IconBell size={13} />{unread ? `Mark ${unread} Read` : 'All Read'}</button>
          <PillSelect value={prefs.clockZone} options={TIME_ZONE_OPTIONS.map((option) => ({ ...option }))} onChange={(value) => updatePref('clockZone', value)} ariaLabel="Time Zone" className="lix-select lix-zone-select" />
        </div>
      </section>

      <section className="calx-week newsx-week notifx-week" aria-label="Notification Days">
        {dayKeys.map((key) => {
          const items = itemsByDay.get(key) ?? [];
          const total = items.reduce((sum, item) => sum + item.count, 0);
          const critical = items.filter((item) => item.severity === 'critical').reduce((sum, item) => sum + item.count, 0);
          const warning = items.filter((item) => item.severity === 'warning').reduce((sum, item) => sum + item.count, 0);
          const info = total - critical - warning;
          return <button type="button" key={key} className={`${key === selectedDay ? 'selected' : ''} ${key === today ? 'today' : ''}`} onClick={() => setSelectedDay(key)}>
            <span className="calx-day-name">{formatKey(key, { weekday: 'short' })} <b>{formatKey(key, { day: 'numeric' })}</b></span>
            <span><em>Alerts</em><b>{total}</b></span>
            <span className="newsx-day-impact"><em>Severity</em><b><i className="notifx-critical">C {critical}</i><i className="notifx-warning">W {warning}</i><i className="notifx-info">I {info}</i></b></span>
          </button>;
        })}
      </section>

      <section className="lix-filters newsx-filters notifx-filters" aria-label="Notification Filters">
        <div className="newsx-filter-line notifx-filter-line">
          <div className="lix-segments newsx-category-tabs" role="group" aria-label="Category">
            {FILTERS.map((option) => <button type="button" key={option.id} className={filter === option.id ? 'selected' : ''} onClick={() => setFilter(option.id)}>{option.label}</button>)}
          </div>
          <div className="notifx-delivery"><span className="active">In-App Active</span><span>Email Planned</span><span>WhatsApp Planned</span></div>
        </div>
        <div className="newsx-filter-line notifx-rule-line">
          <div className="notifx-rule-copy"><b>Notification Rules</b><em>Select which Log events deserve an interruption.</em></div>
          <div className="notifx-rule-list" role="group" aria-label="Notification Rules">
            {RULES.map((rule) => <button type="button" key={rule.key} className={draftRules[rule.key] ? 'on' : ''} aria-pressed={draftRules[rule.key]} title={rule.short} onClick={() => setDraftRules((current) => ({ ...current, [rule.key]: !current[rule.key] }))}>
              <i>{categoryIcon(rule.key, 13)}</i><span>{rule.label}</span><b>{categoryCounts[rule.key]}</b><em><small /></em>
            </button>)}
          </div>
          <div className="notifx-rule-actions">
            <button type="button" onClick={() => setDraftRules(prefs.alerts)} disabled={!rulesDirty}>Discard</button>
            <button type="button" className="primary" onClick={saveRules} disabled={!rulesDirty}>Save</button>
          </div>
        </div>
      </section>

      <section className="notifx-tape" aria-label="Notification Feed">
        <div className="notifx-day-header">
          <strong>{formatKey(selectedDay, { weekday: 'long', month: 'long', day: 'numeric' })}</strong>
          <span>{selectedTotal} Alerts · {selectedCritical} Critical · {selectedWarning} Warning · {selectedInfo} Info · {resolvedZoneLabel(prefs.clockZone)}</span>
        </div>
        <div className="notifx-header"><span>Time</span><span>Alert</span><span>Notification</span><span>Source</span><span>Status</span></div>
        <div className="notifx-day-body" key={`${selectedDay}-${filter}`}>
          {filtered.map((item) => <article key={`${item.id}-${item.category}`} className={`notifx-row ${item.severity}`}>
            <time><b>{notificationTime(item.ts, zone)}</b><em>{formatKey(dayKey(new Date(item.ts), zone), { month: 'short', day: 'numeric' })}</em></time>
            <span className={`notifx-row-icon ${item.category}`}>{categoryIcon(item.category, 15)}</span>
            <span className="notifx-row-copy"><b>{item.title}</b><em>{item.detail}</em></span>
            <span className="notifx-row-source"><b>{item.subject}</b><em>{RULES.find((rule) => rule.key === item.category)?.label}</em></span>
            <span className={`notifx-status ${item.severity}`}>{statusLabel(item)}</span>
          </article>)}
          {!fetchedAt && !failed && <div className="lix-empty">Loading Notifications…</div>}
          {failed && !events.length && <div className="lix-empty">The Notification Archive Is Currently Unavailable.</div>}
          {fetchedAt && filtered.length === 0 && <div className="lix-empty">{query ? `Nothing Matches “${query}”.` : 'No Notifications Match This View.'}</div>}
        </div>
      </section>
    </div>
  </div>;
}
