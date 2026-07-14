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
import { fetchJson } from '../lib/http';
import { curateNotifications, groupNotifications, notificationEnabled, type CuratedNotification } from '../lib/notifications';
import { createSettledPoll } from '../lib/polling';
import { type NotificationRuleKey, type NotificationRules } from '../lib/prefs';
import { TIME_ZONE_OPTIONS, addDays, dayKey, formatKey, resolvedZoneLabel } from '../lib/time';
import { useStore } from '../store';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
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
  { key: 'critical', label: 'Needs Attention', short: 'Failed dependencies, owner-gated boundaries, and emergency controls' },
  { key: 'execution', label: 'Legacy Execution Evidence', short: 'Historical order, fill, loan, and risk evidence; never route authority' },
  { key: 'health', label: 'Bot Health', short: 'Engine, stream, connection, and control transitions' },
  { key: 'infrastructure', label: 'Infrastructure Evidence', short: 'Unverified external events; AWS remains OWNER_GATED' },
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
    execution: { available: false, label: 'Execution Pipeline', detail: 'OWNER_GATED · LIVE_EXECUTION_NOT_IMPLEMENTED' },
    aws: { available: false, label: 'AWS Infrastructure', detail: 'OWNER_GATED · external AWS state is not verified' },
  },
  destinations: {
    inApp: { available: true, label: 'In-App', detail: 'Active in this control room' },
    email: { available: false, label: 'Email', detail: 'Delivery provider is not connected' },
    telegram: { available: false, label: 'Telegram', detail: 'Bot and chat routing are not connected' },
    whatsapp: { available: false, label: 'WhatsApp', detail: 'Cloud API is not connected' },
    awsSns: { available: false, label: 'AWS SNS', detail: 'OWNER_GATED · AWS delivery is not mounted' },
  },
  policy: { transitionsOnly: true, repeatWindowMinutes: 15, rawLogsExcluded: true },
};

function failClosedRouting(snapshot: RoutingSnapshot): RoutingSnapshot {
  return {
    ...snapshot,
    sources: {
      ...snapshot.sources,
      execution: EMPTY_ROUTING.sources.execution,
      aws: EMPTY_ROUTING.sources.aws,
    },
    destinations: {
      ...snapshot.destinations,
      awsSns: EMPTY_ROUTING.destinations.awsSns,
    },
  };
}

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
  const [routing, setRouting] = useState<RoutingSnapshot>(EMPTY_ROUTING);
  const [basisRuntime, setBasisRuntime] = useState<RuntimeSnapshot | null>(null);
  const [volumeRuntime, setVolumeRuntime] = useState<RuntimeSnapshot | null>(null);
  const [routingFailed, setRoutingFailed] = useState(false);
  const [runtimeFailed, setRuntimeFailed] = useState(false);
  const cursorRef = useRef(0);

  useEffect(() => setSelectedDay(dayKey(new Date(), zone)), [zone]);
  useEffect(() => setDraftRules(prefs.alerts), [prefs.alerts]);

  useEffect(() => {
    const merge = (incoming: LedgerEvent[]) => {
      if (incoming.length) cursorRef.current = Math.max(cursorRef.current, ...incoming.map((item) => item.id));
      const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
      setEvents((current) => {
        const merged = new Map<number, LedgerEvent>();
        current.filter((item) => item.ts >= cutoff).forEach((item) => merged.set(item.id, item));
        incoming.filter((item) => item.ts >= cutoff).forEach((item) => merged.set(item.id, item));
        return [...merged.values()].sort((a, b) => b.ts - a.ts || b.id - a.id).slice(0, 10_000);
      });
    };
    let bootstrapped = false;
    let bootstrapHighWater = 0;
    const relevantKinds = ['risk_decision', 'error_event', 'user_stream', 'ws.closed', 'ws.open', 'connection_alert', 'connection_recovered', 'manual_action', 'order_intent', 'order_request', 'order_response', 'order_outcome_unknown', 'cancel_outcome_unknown', 'fill_event', 'loan_request', 'loan_response', 'binance.connected', 'engine.start', 'engine_started', 'basis.engine_started', 'config_change', 'aws_notification'];
    const poll = createSettledPoll<LedgerEvent[]>({
      intervalMs: 5_000,
      timeoutMs: 15_000,
      request: async (signal) => {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60_000;
        if (!bootstrapped) {
          const head = await fetchJson<LedgerEvent[]>('/api/events?limit=1', { signal });
          bootstrapHighWater = head[0]?.id ?? 0;
          const before = bootstrapHighWater > 0 ? `&beforeId=${bootstrapHighWater + 1}` : '';
          return (await Promise.all(relevantKinds.map((kind) => fetchJson<LedgerEvent[]>(
            `/api/events?since=${sevenDaysAgo}&limit=2000&kind=${encodeURIComponent(kind)}${before}`,
            { signal },
          )))).flat();
        }
        // Drain oldest-first pages after the last seen ledger id. This cannot
        // skip alerts when more than one page arrives between polls.
        const incoming: LedgerEvent[] = [];
        let afterId = cursorRef.current;
        for (let page = 0; page < 10; page += 1) {
          const cursor = afterId > 0 ? `&afterId=${afterId}` : '';
          const rows = await fetchJson<LedgerEvent[]>(`/api/events?since=${sevenDaysAgo}&limit=2000${cursor}`, { signal });
          incoming.push(...rows);
          if (rows.length < 2_000) break;
          afterId = Math.max(afterId, ...rows.map((item) => item.id));
        }
        return incoming;
      },
      onSuccess: (incoming) => {
        if (!bootstrapped) cursorRef.current = Math.max(cursorRef.current, bootstrapHighWater);
        bootstrapped = true;
        merge(incoming);
        setFetchedAt(Date.now());
        setFailed(false);
      },
      onError: () => setFailed(true),
    });
    poll.start();
    return poll.stop;
  }, []);

  useEffect(() => {
    const poll = createSettledPoll<[
      PromiseSettledResult<RoutingSnapshot>,
      PromiseSettledResult<RuntimeSnapshot>,
      PromiseSettledResult<RuntimeSnapshot>,
    ]>({
      intervalMs: 10_000,
      request: (signal) => Promise.allSettled([
        fetchJson<RoutingSnapshot>('/api/notification-routing', { cache: 'no-store', signal }),
        fetchJson<RuntimeSnapshot>('/api/engine/basis', { cache: 'no-store', signal }),
        fetchJson<RuntimeSnapshot>('/api/engine/volume', { cache: 'no-store', signal }),
      ]) as Promise<[
        PromiseSettledResult<RoutingSnapshot>,
        PromiseSettledResult<RuntimeSnapshot>,
        PromiseSettledResult<RuntimeSnapshot>,
      ]>,
      onSuccess: ([routingResult, basisResult, volumeResult]) => {
        if (routingResult.status === 'fulfilled') {
          setRouting(failClosedRouting(routingResult.value));
          setRoutingFailed(false);
        } else setRoutingFailed(true);
        if (basisResult.status === 'fulfilled') setBasisRuntime(basisResult.value);
        else setBasisRuntime(null);
        if (volumeResult.status === 'fulfilled') setVolumeRuntime(volumeResult.value);
        else setVolumeRuntime(null);
        setRuntimeFailed(basisResult.status === 'rejected' || volumeResult.status === 'rejected');
      },
      onError: () => {
        setRoutingFailed(true);
        setRuntimeFailed(true);
        setBasisRuntime(null);
        setVolumeRuntime(null);
      },
    });
    poll.start();
    return poll.stop;
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

  const enginesOnline = [basisRuntime?.status?.running, volumeRuntime?.status?.running].filter(Boolean).length;
  const enginesKnown = !runtimeFailed && basisRuntime !== null && volumeRuntime !== null;
  const botState = runtimeFailed ? 'Unavailable' : enginesKnown ? 'Public Runtime' : 'UNKNOWN';
  const botTone = runtimeFailed ? 'bad' : enginesKnown ? 'good' : 'warn';
  const executionState = 'OWNER_GATED';
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
        <div><span>Bot</span><strong className={botTone}><i />{botState}</strong><em>{runtimeFailed ? 'Latest public runtime checks failed' : enginesKnown ? 'Public engine status observed' : 'Runtime status is not yet known'}</em></div>
        <div><span>Execution</span><strong>{executionState}</strong><em>LIVE_EXECUTION_NOT_IMPLEMENTED</em></div>
        <div><span>Engines</span><strong>{runtimeFailed ? 'Unavailable' : enginesKnown ? `${enginesOnline} / 2 Online` : 'Checking'}</strong><em>{!runtimeFailed && enginesOnline === 2 ? 'Basis and volume are online' : runtimeFailed ? 'Latest runtime checks failed' : 'Runtime status is being verified'}</em></div>
        <div className={latestAction ? 'attention' : ''}><span>Attention</span><strong>{latestAction ? latestAction.title : 'Incident State UNKNOWN'}</strong><em>{latestAction ? latestAction.subject : 'No current intervention was observed; this is not an all-clear'}</em></div>
      </section>

      <ProductSurfaceAdapter surfaceId="notifications" />

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
            <button type="button" className="notifx-route-summary" onClick={() => document.querySelector('.notifx-routing')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><IconShield size={13} /><span>{routingFailed ? 'Routing Unavailable' : 'In-App Active'}</span><em>Manage Sources & Delivery</em></button>
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
              <span className="notifx-alert-source"><b>{item.subject}</b><em>{item.origin === 'aws' ? 'AWS Evidence · OWNER_GATED' : item.origin === 'execution' ? 'Legacy Execution Evidence' : 'Bot Runtime'}</em></span>
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
            <header><div><span>Sources</span><h3>Signals Into The Inbox</h3></div><em>{routingFailed ? 'Status Unavailable' : `${Object.values(routing.sources).filter((item) => item.available).length} Available · gated sources excluded`}</em></header>
            {(Object.entries(routing.sources) as [keyof RoutingSnapshot['sources'], ConnectorState][]).map(([key, connector]) => <article key={key}>
              <span className="notifx-connector-icon">{connectorIcon(key)}</span>
              <span><b>{connector.label}</b><em>{connector.detail}</em>{connector.endpoint && <small>{connector.endpoint}</small>}</span>
              <strong className={!routingFailed && connector.available ? 'ready' : 'waiting'}><i />{routingFailed ? 'Unavailable' : connector.available ? 'Available' : key === 'execution' || key === 'aws' ? 'OWNER_GATED' : 'Not Configured'}</strong>
            </article>)}
          </section>

          <section className="notifx-connector-group">
            <header><div><span>Destinations</span><h3>Where Alerts Are Delivered</h3></div><em>Credentials Stay Server-Side</em></header>
            {(Object.entries(routing.destinations) as [keyof RoutingSnapshot['destinations'], ConnectorState][]).map(([key, connector]) => <article key={key}>
              <span className="notifx-connector-icon">{connectorIcon(key)}</span>
              <span><b>{connector.label}</b><em>{connector.detail}</em></span>
              <strong className={!routingFailed && connector.available ? 'ready' : 'waiting'}><i />{routingFailed ? 'Unavailable' : connector.available ? 'Active' : key === 'awsSns' ? 'OWNER_GATED' : 'Not Configured'}</strong>
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
          <div><IconPulse size={16} /><span><b>Incident Grouping</b><em>State repeats and legacy evidence bursts collapse with a real count.</em></span></div>
          <div><IconActivity size={16} /><span><b>Logs Stay Complete</b><em>No raw evidence is deleted or hidden.</em></span></div>
        </section>
      </section>
    </div>
  </div>;
}
