import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  IconActivity,
  IconAlert,
  IconBell,
  IconExternal,
  IconKey,
  IconPulse,
  IconSearch,
  IconShield,
  IconWallet,
  IconWifi,
} from '../components/Icons';
import { PillSelect } from '../components/PillSelect';
import { liveAge } from '../format';
import { curateNotifications, groupNotifications, notificationEnabled, type CuratedNotification } from '../lib/notifications';
import { type NotificationRuleKey, type NotificationRules } from '../lib/prefs';
import { TIME_ZONE_OPTIONS, addDays, dayKey, formatKey, resolvedZoneLabel } from '../lib/time';
import { useStore } from '../store';
import type { LedgerEvent } from '../types';
import './LiveIntelligence.css';
import './NotificationsPage.css';

type NotificationFilter = 'all' | 'action' | 'execution' | 'health' | 'infrastructure';
interface ConnectorState {
  available: boolean;
  label: string;
  detail: string;
  endpoint?: string;
}

interface RoutingSnapshot {
  sources: Record<'bot' | 'execution' | 'aws', ConnectorState>;
  destinations: Record<'inApp' | 'email' | 'telegram' | 'whatsapp' | 'awsSns', ConnectorState>;
  policy: { transitionsOnly: boolean; repeatWindowMinutes: number; rawLogsExcluded: boolean };
}

interface RuntimeSnapshot {
  status?: { running?: boolean; streamState?: string; bookState?: string; lastError?: string | null };
}

const RULES: { key: NotificationRuleKey; label: string; short: string }[] = [
  { key: 'critical', label: 'Needs Attention', short: 'Blocked execution, failed dependencies, and emergency controls' },
  { key: 'execution', label: 'Execution Outcomes', short: 'Orders, fills, loans, and risk decisions' },
  { key: 'health', label: 'Bot Health', short: 'Engine, stream, connection, and control transitions' },
  { key: 'infrastructure', label: 'Infrastructure', short: 'Connected AWS instance, health, and alarm transitions' },
];

const FILTERS: { id: NotificationFilter; label: string }[] = [
  { id: 'all', label: 'All Alerts' },
  { id: 'action', label: 'Needs Attention' },
  { id: 'execution', label: 'Execution' },
  { id: 'health', label: 'Bot Health' },
  { id: 'infrastructure', label: 'Infrastructure' },
];

const EMPTY_ROUTING: RoutingSnapshot = {
  sources: {
    bot: { available: true, label: 'Bot Runtime', detail: 'Engine and control transitions' },
    execution: { available: true, label: 'Execution Pipeline', detail: 'Order and risk outcomes' },
    aws: { available: false, label: 'AWS Infrastructure', detail: 'Secure connector required' },
  },
  destinations: {
    inApp: { available: true, label: 'In-App', detail: 'Active in this control room' },
    email: { available: false, label: 'Email', detail: 'Delivery provider is not connected' },
    telegram: { available: false, label: 'Telegram', detail: 'Bot and chat routing are not connected' },
    whatsapp: { available: false, label: 'WhatsApp', detail: 'Cloud API is not connected' },
    awsSns: { available: false, label: 'AWS SNS', detail: 'SNS topic and publish role are not connected' },
  },
  policy: { transitionsOnly: true, repeatWindowMinutes: 15, rawLogsExcluded: true },
};

function categoryIcon(category: NotificationRuleKey, size = 15): ReactNode {
  if (category === 'critical') return <IconAlert size={size} />;
  if (category === 'execution') return <IconWallet size={size} />;
  if (category === 'infrastructure') return <IconWifi size={size} />;
  return <IconPulse size={size} />;
}

function connectorIcon(key: string, size = 17): ReactNode {
  if (key === 'bot') return <IconActivity size={size} />;
  if (key === 'execution') return <IconWallet size={size} />;
  if (key === 'aws' || key === 'awsSns') return <IconWifi size={size} />;
  if (key === 'inApp') return <IconBell size={size} />;
  if (key === 'telegram') return <IconExternal size={size} />;
  if (key === 'whatsapp') return <IconPulse size={size} />;
  return <IconKey size={size} />;
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
  if (item.needsAction) return 'Needs Action';
  if (item.severity === 'resolved') return 'Recovered';
  if (item.count > 1) return `${item.count} Grouped`;
  return 'Update';
}

export function NotificationsPage() {
  const { state, prefs, updatePref } = useStore();
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
  const [routing, setRouting] = useState<RoutingSnapshot>(EMPTY_ROUTING);
  const [basisRuntime, setBasisRuntime] = useState<RuntimeSnapshot | null>(null);
  const [volumeRuntime, setVolumeRuntime] = useState<RuntimeSnapshot | null>(null);
  const cursorRef = useRef(0);

  useEffect(() => setSelectedDay(dayKey(new Date(), zone)), [zone]);
  useEffect(() => setDraftRules(prefs.alerts), [prefs.alerts]);

  useEffect(() => {
    let alive = true;
    let timer: number | null = null;
    const merge = (incoming: LedgerEvent[]) => {
      if (!incoming.length) return;
      cursorRef.current = Math.max(cursorRef.current, ...incoming.map((item) => item.ts));
      setEvents((current) => {
        const merged = new Map<number, LedgerEvent>();
        current.forEach((item) => merged.set(item.id, item));
        incoming.forEach((item) => merged.set(item.id, item));
        return [...merged.values()].sort((a, b) => b.ts - a.ts || b.id - a.id);
      });
    };
    const fetchKind = (since: number, kind: string) => {
      return fetch(`/api/events?since=${since}&limit=2000&kind=${encodeURIComponent(kind)}`)
        .then((response) => response.ok ? response.json() as Promise<LedgerEvent[]> : Promise.reject(new Error('notification archive unavailable')));
    };
    const loadArchive = async () => {
      const since = Date.now() - 7 * 24 * 60 * 60_000;
      const relevantKinds = ['risk_decision', 'error_event', 'user_stream', 'ws.closed', 'ws.open', 'connection_alert', 'connection_recovered', 'manual_action', 'order_intent', 'order_request', 'order_response', 'fill_event', 'loan_request', 'loan_response', 'binance.connected', 'engine.start', 'engine_started', 'basis.engine_started', 'config_change', 'aws_notification'];
      const archive = (await Promise.all(relevantKinds.map((kind) => fetchKind(since, kind)))).flat();
      if (!alive) return;
      merge(archive);
      setFetchedAt(Date.now());
      setFailed(false);
    };
    const loadIncremental = () => {
      if (!cursorRef.current) return;
      fetch(`/api/events?since=${cursorRef.current + 1}&limit=500`)
        .then((response) => response.ok ? response.json() as Promise<LedgerEvent[]> : Promise.reject(new Error('notification feed unavailable')))
        .then((incoming) => {
          if (!alive) return;
          merge(incoming);
          setFetchedAt(Date.now());
          setFailed(false);
        })
        .catch(() => { if (alive) setFailed(true); });
    };
    void loadArchive()
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) timer = window.setInterval(loadIncremental, 5_000); });
    return () => { alive = false; if (timer !== null) window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: number | null = null;
    const load = async () => {
      const [routingResponse, basisResponse, volumeResponse] = await Promise.all([
        fetch('/api/notification-routing', { cache: 'no-store' }),
        fetch('/api/engine/basis', { cache: 'no-store' }),
        fetch('/api/engine/volume', { cache: 'no-store' }),
      ]);
      if (!alive) return;
      if (routingResponse.ok) setRouting(await routingResponse.json() as RoutingSnapshot);
      if (basisResponse.ok) setBasisRuntime(await basisResponse.json() as RuntimeSnapshot);
      if (volumeResponse.ok) setVolumeRuntime(await volumeResponse.json() as RuntimeSnapshot);
    };
    void load().catch(() => undefined);
    timer = window.setInterval(() => void load().catch(() => undefined), 10_000);
    return () => { alive = false; if (timer !== null) window.clearInterval(timer); };
  }, []);

  const curatedRaw = useMemo(() => curateNotifications(events), [events]);
  const notifications = useMemo(() => groupNotifications(curatedRaw, zone), [curatedRaw, zone]);
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
    if (filter === 'action' && !item.needsAction) return false;
    if (!['all', 'action'].includes(filter) && item.category !== filter) return false;
    if (!deferredQuery) return true;
    return `${item.title} ${item.detail} ${item.subject}`.toLowerCase().includes(deferredQuery);
  }).sort((left, right) => Number(right.needsAction) - Number(left.needsAction) || right.ts - left.ts), [deferredQuery, filter, selectedItems]);
  const categoryCounts = useMemo(() => notifications.reduce<Record<NotificationRuleKey, number>>((counts, item) => {
    counts[item.category] += 1;
    return counts;
  }, { critical: 0, execution: 0, health: 0, infrastructure: 0 }), [notifications]);
  const selectedAction = selectedItems.filter((item) => item.needsAction).length;
  const selectedRecovered = selectedItems.filter((item) => item.severity === 'resolved').length;
  const selectedTotal = selectedItems.length;
  const unread = enabled.filter((item) => item.id > seen).length;
  const rulesDirty = JSON.stringify(draftRules) !== JSON.stringify(prefs.alerts);
  const rangeLabel = `${formatKey(dayKeys[0], { month: 'short', day: 'numeric' })} — ${formatKey(dayKeys[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const status = failed ? 'Archive Unavailable' : fetchedAt ? `Live · ${liveAge(fetchedAt)}` : 'Loading';
  const groupedCount = Math.max(0, curatedRaw.length - notifications.length);
  const excludedCount = Math.max(0, events.length - curatedRaw.length);

  const config = state?.config;
  const botState = config?.killSwitch ? 'Stopped' : config?.automationPaused ? 'Paused' : 'Running';
  const botTone = config?.killSwitch ? 'bad' : config?.automationPaused ? 'warn' : 'good';
  const executionState = state?.mode === 'LIVE_ARMED' ? 'Live Armed' : state?.mode === 'MANUAL' ? 'Manual' : 'Halted';
  const enginesOnline = [basisRuntime?.status?.running, volumeRuntime?.status?.running].filter(Boolean).length;
  const enginesKnown = basisRuntime !== null && volumeRuntime !== null;
  const latestAction = enabled.find((item) => item.needsAction);

  const markRead = () => {
    if (!enabled.length) return;
    const latest = Math.max(...enabled.map((item) => item.id));
    setSeen(latest);
    localStorage.setItem('cosmos-notif-seen', String(latest));
  };
  const saveRules = () => updatePref('alerts', draftRules);

  return <div className="container page lix-page notifx-page">
    <div className="lix-frame">
      <header className="lix-toolbar notifx-toolbar">
        <div className="lix-title notifx-title">
          <img className="notifx-page-mark" src="/notification-bell.png" alt="" aria-hidden="true" />
          <h1>Notifications</h1>
          <span className={`lix-live ${failed ? 'error' : 'streaming'}`}><i />{status}</span>
        </div>
        <label className="lix-search">
          <IconSearch size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" spellCheck={false} />
          {query && <button type="button" aria-label="Clear Search" onClick={() => setQuery('')}>×</button>}
        </label>
      </header>

      <section className="notifx-command" aria-label="Notification Control Summary">
        <div><span>Bot</span><strong className={botTone}><i />{botState}</strong><em>{config?.killSwitch ? 'Emergency stop is active' : config?.automationPaused ? 'Automation is not sending' : 'Automation is processing'}</em></div>
        <div><span>Execution</span><strong>{executionState}</strong><em>{config?.liveTradingEnabled ? 'Risk-gated live routing' : 'No automatic live sends'}</em></div>
        <div><span>Engines</span><strong>{enginesKnown ? `${enginesOnline} / 2 Online` : 'Checking'}</strong><em>{enginesOnline === 2 ? 'Basis and volume are online' : 'Runtime status is being verified'}</em></div>
        <div className={latestAction ? 'attention' : ''}><span>Attention</span><strong>{latestAction ? latestAction.title : 'No Active Blocker'}</strong><em>{latestAction ? latestAction.subject : 'No curated intervention is open'}</em></div>
      </section>

      <>
        <section className="calx-navigation notifx-navigation" aria-label="Notifications Navigation">
          <div className="calx-range-controls">
            <button type="button" className="calx-today" onClick={() => setSelectedDay(today)}>Today</button>
            <strong>{rangeLabel}</strong><span className="newsx-range-note">Seven-Day Inbox</span>
          </div>
          <div className="notifx-navigation-actions">
            <span className="notifx-curation"><b>{excludedCount.toLocaleString()}</b> Raw Events Excluded · <b>{groupedCount}</b> Repeats Grouped</span>
            <button type="button" className="notifx-mark-read" onClick={markRead} disabled={unread === 0}><IconBell size={13} />{unread ? `Mark ${unread} Read` : 'All Read'}</button>
            <PillSelect value={prefs.clockZone} options={TIME_ZONE_OPTIONS.map((option) => ({ ...option }))} onChange={(value) => updatePref('clockZone', value)} ariaLabel="Time Zone" className="lix-select lix-zone-select" />
          </div>
        </section>

        <section className="calx-week newsx-week notifx-week" aria-label="Notification Days">
          {dayKeys.map((key) => {
            const items = itemsByDay.get(key) ?? [];
            const total = items.length;
            const attention = items.filter((item) => item.needsAction).length;
            const recovered = items.filter((item) => item.severity === 'resolved').length;
            return <button type="button" key={key} className={`${key === selectedDay ? 'selected' : ''} ${key === today ? 'today' : ''}`} onClick={() => setSelectedDay(key)}>
              <span className="calx-day-name">{formatKey(key, { weekday: 'short' })} <b>{formatKey(key, { day: 'numeric' })}</b></span>
              <span><em>Alerts</em><b>{total}</b></span>
              <span><em>Attention</em><b className={attention ? 'notifx-count-bad' : ''}>{attention}</b></span>
              <span><em>Recovered</em><b className="notifx-count-good">{recovered}</b></span>
            </button>;
          })}
        </section>

        <section className="lix-filters newsx-filters notifx-filters" aria-label="Notification Filters">
          <div className="newsx-filter-line notifx-filter-line">
            <div className="lix-segments newsx-category-tabs" role="group" aria-label="Alert Category">
              {FILTERS.map((option) => <button type="button" key={option.id} className={filter === option.id ? 'selected' : ''} onClick={() => setFilter(option.id)}>{option.label}</button>)}
            </div>
            <button type="button" className="notifx-route-summary" onClick={() => document.querySelector('.notifx-routing')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><IconShield size={13} /><span>In-App Active</span><em>Manage Sources & Delivery</em></button>
          </div>
        </section>

        <section className="notifx-inbox" aria-label="Curated Notification Inbox">
          <div className="notifx-inbox-head">
            <div><strong>{formatKey(selectedDay, { weekday: 'long', month: 'long', day: 'numeric' })}</strong><span>{resolvedZoneLabel(prefs.clockZone)}</span></div>
            <p><b>{selectedAction}</b> Need Attention <i /> <b>{selectedTotal}</b> Curated Alerts <i /> <b>{selectedRecovered}</b> Recovered</p>
          </div>
          <div className="notifx-inbox-body" key={`${selectedDay}-${filter}`}>
            {filtered.map((item) => <article key={`${item.id}-${item.category}`} className={`notifx-alert ${item.severity} ${item.needsAction ? 'action' : ''}`}>
              <span className={`notifx-alert-icon ${item.category}`}>{categoryIcon(item.category, 16)}</span>
              <span className="notifx-alert-copy"><b>{item.title}{item.count > 1 ? ` · ${item.count} Events` : ''}</b><em>{item.detail}</em></span>
              <span className="notifx-alert-source"><b>{item.subject}</b><em>{item.origin === 'aws' ? 'AWS Infrastructure' : item.origin === 'execution' ? 'Execution Pipeline' : 'Bot Runtime'}</em></span>
              <time><b>{notificationTime(item.ts, zone)}</b><em>{formatKey(dayKey(new Date(item.ts), zone), { month: 'short', day: 'numeric' })}</em></time>
              <span className={`notifx-status ${item.severity}`}>{statusLabel(item)}</span>
            </article>)}
            {!fetchedAt && !failed && <div className="lix-empty">Loading Curated Alerts…</div>}
            {failed && !events.length && <div className="lix-empty">The Notification Inbox Is Currently Unavailable.</div>}
            {fetchedAt && filtered.length === 0 && <div className="lix-empty">{query ? `Nothing Matches “${query}”.` : 'No Curated Alerts Match This View.'}</div>}
          </div>
        </section>
      </>
      <section className="notifx-routing" aria-label="Notification Routing">
        <div className="notifx-routing-intro">
          <div><span>Routing</span><h2>Choose What Interrupts You — And Where It Goes.</h2><p>Logs keep every event. Notifications keep only transitions, interventions, and selected outcomes.</p></div>
          <span className="notifx-policy-badge"><IconShield size={14} />State Changes Only</span>
        </div>

        <div className="notifx-routing-grid">
          <section className="notifx-connector-group">
            <header><div><span>Sources</span><h3>Signals Into The Inbox</h3></div><em>{Object.values(routing.sources).filter((item) => item.available).length} Connected · 1 Optional</em></header>
            {(Object.entries(routing.sources) as [keyof RoutingSnapshot['sources'], ConnectorState][]).map(([key, connector]) => <article key={key}>
              <span className="notifx-connector-icon">{connectorIcon(key)}</span>
              <span><b>{connector.label}</b><em>{connector.detail}</em>{connector.endpoint && <small>{connector.endpoint}</small>}</span>
              <strong className={connector.available ? 'ready' : 'waiting'}><i />{connector.available ? 'Connected' : 'Connector Required'}</strong>
            </article>)}
          </section>

          <section className="notifx-connector-group">
            <header><div><span>Destinations</span><h3>Where Alerts Are Delivered</h3></div><em>Credentials Stay Server-Side</em></header>
            {(Object.entries(routing.destinations) as [keyof RoutingSnapshot['destinations'], ConnectorState][]).map(([key, connector]) => <article key={key}>
              <span className="notifx-connector-icon">{connectorIcon(key)}</span>
              <span><b>{connector.label}</b><em>{connector.detail}</em></span>
              <strong className={connector.available ? 'ready' : 'waiting'}><i />{connector.available ? 'Active' : 'Not Connected'}</strong>
            </article>)}
          </section>
        </div>

        <section className="notifx-rule-panel">
          <header><div><span>Preferences</span><h3>What Deserves An Interruption</h3><p>Disabled categories remain searchable in Logs and never disappear from the ledger.</p></div><div className="notifx-rule-actions"><button type="button" onClick={() => setDraftRules(prefs.alerts)} disabled={!rulesDirty}>Discard</button><button type="button" className="primary" onClick={saveRules} disabled={!rulesDirty}>Save Preferences</button></div></header>
          <div className="notifx-rule-list" role="group" aria-label="Notification Preferences">
            {RULES.map((rule) => <button type="button" key={rule.key} className={draftRules[rule.key] ? 'on' : ''} aria-pressed={draftRules[rule.key]} onClick={() => setDraftRules((current) => ({ ...current, [rule.key]: !current[rule.key] }))}>
              <i>{categoryIcon(rule.key, 15)}</i><span><b>{rule.label}</b><em>{rule.short}</em></span><strong>{categoryCounts[rule.key].toLocaleString()} Events</strong><small><i /></small>
            </button>)}
          </div>
        </section>

        <section className="notifx-noise-policy">
          <div><IconShield size={16} /><span><b>Transitions Only</b><em>Repeated telemetry never enters this inbox.</em></span></div>
          <div><IconPulse size={16} /><span><b>Incident Grouping</b><em>State repeats and execution bursts collapse with a real count.</em></span></div>
          <div><IconActivity size={16} /><span><b>Logs Stay Complete</b><em>No raw evidence is deleted or hidden.</em></span></div>
        </section>
      </section>
    </div>
  </div>;
}
