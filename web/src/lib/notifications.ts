import type { LedgerEvent } from '../types';
import type { NotificationRuleKey, NotificationRules } from './prefs';
import { dayKey } from './time';

export type NotificationSeverity = 'critical' | 'warning' | 'info' | 'resolved';
export type NotificationOrigin = 'bot' | 'execution' | 'aws';

export interface CuratedNotification {
  id: number;
  ts: number;
  category: NotificationRuleKey;
  severity: NotificationSeverity;
  title: string;
  detail: string;
  subject: string;
  symbol: string | null;
  kind: string;
  count: number;
  origin: NotificationOrigin;
  needsAction: boolean;
}

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const numberValue = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const titleCase = (value: string) => value
  .replace(/[._-]+/g, ' ')
  .replace(/\b\w/g, (character) => character.toUpperCase());

function notice(
  event: LedgerEvent,
  category: NotificationRuleKey,
  severity: NotificationSeverity,
  title: string,
  detail: string,
  subject: string,
  origin: NotificationOrigin,
  needsAction = false,
): CuratedNotification {
  return {
    id: event.id,
    ts: event.ts,
    category,
    severity,
    title,
    detail,
    subject,
    symbol: event.symbol,
    kind: event.kind,
    count: 1,
    origin,
    needsAction,
  };
}

/**
 * Notifications are not another ledger. Only state changes, execution outcomes,
 * intervention requests, and explicitly connected infrastructure alerts cross
 * this boundary. Scanner telemetry, candidates, opportunities, news, snapshots,
 * heartbeats, and ordinary configuration edits remain in Logs.
 */
export function curateNotification(event: LedgerEvent): CuratedNotification | null {
  const data = (event.data && typeof event.data === 'object' ? event.data : {}) as Record<string, unknown>;
  const kind = event.kind.toLowerCase();
  const symbol = event.symbol ?? text(data.symbol);
  const subject = symbol || 'Execution Control';

  if (kind === 'risk_decision') {
    if (data.allowed === true) return null;
    const reasons = Array.isArray(data.reasons)
      ? data.reasons.filter((item): item is string => typeof item === 'string')
      : [];
    return notice(
      event,
      'critical',
      'critical',
      'Execution Blocked By Risk',
      reasons.slice(0, 2).join(' · ') || `${titleCase(text(data.stage) || 'Order')} did not pass configured limits`,
      subject,
      'execution',
      true,
    );
  }

  if (kind === 'error_event') {
    const source = text(data.source);
    const message = text(data.message);
    const noise = `${source} ${message}`.toLowerCase();
    if (noise.includes('source-logo') || noise.includes('favicon') || noise.includes('logo cache')) return null;
    if (!/(engine|runtime|order|executor|risk|binance|account|user.stream|market.stream|aws)/i.test(source)) return null;
    const executionFailure = /(order|executor|risk|loan)/i.test(source);
    return notice(
      event,
      'critical',
      'critical',
      executionFailure ? 'Execution Path Failed' : 'Bot Dependency Failed',
      message || `${titleCase(source || 'Runtime')} reported an error`,
      titleCase(source || 'Bot Runtime'),
      executionFailure ? 'execution' : 'bot',
      true,
    );
  }

  if (kind === 'user_stream') {
    const status = text(data.status).toLowerCase();
    if (['failed', 'closed', 'error'].includes(status)) {
      return notice(event, 'critical', 'critical', 'Binance User Stream Failed', text(data.detail) || 'Private account events are not arriving', 'Binance', 'bot', true);
    }
    if (['open', 'opened', 'connected', 'live'].includes(status)) {
      return notice(event, 'health', 'resolved', 'Binance User Stream Recovered', 'Private account events are arriving again', 'Binance', 'bot');
    }
    return null;
  }

  if (kind === 'ws.closed') {
    const feed = text(data.feed) || 'Market stream';
    return notice(event, 'critical', 'critical', 'Market Stream Closed', `${feed} stopped and requires connection review`, 'Market Data', 'bot', true);
  }

  if (kind === 'ws.open') {
    const feed = text(data.feed) || 'Market stream';
    return notice(event, 'health', 'resolved', 'Market Stream Recovered', `${feed} is receiving live market data`, 'Market Data', 'bot');
  }

  if (kind === 'manual_action') {
    const action = text(data.action);
    if (action === 'kill_switch') {
      const engaged = data.on === true;
      return notice(
        event,
        engaged ? 'critical' : 'health',
        engaged ? 'critical' : 'resolved',
        engaged ? 'Kill Switch Engaged' : 'Kill Switch Released',
        engaged ? 'Orders, loans, and automation are blocked' : 'Configured risk gates are back in control',
        'Execution Control',
        'bot',
        engaged,
      );
    }
    if (action === 'live_trading') {
      const armed = data.on === true;
      return notice(
        event,
        'health',
        armed ? 'warning' : 'info',
        armed ? 'Live Execution Armed' : 'Live Execution Disarmed',
        armed ? 'Orders may route after every risk gate passes' : 'Live order routing is disabled',
        'Execution Control',
        'bot',
        armed,
      );
    }
    return null;
  }

  if (kind === 'order_intent') {
    const intent = data.intent && typeof data.intent === 'object' ? data.intent as Record<string, unknown> : {};
    const detail = [titleCase(text(intent.side)), symbol, titleCase(text(intent.type))].filter(Boolean).join(' · ');
    return notice(event, 'execution', 'info', 'Order Entered Execution', detail || 'A signed order preview entered the execution path', subject, 'execution');
  }

  if (['order_request', 'order_response', 'fill_event', 'loan_request', 'loan_response'].includes(kind)) {
    const responseStatus = text(data.status).toUpperCase();
    const failed = ['REJECTED', 'FAILED', 'ERROR'].includes(responseStatus) || data.ok === false;
    const label = kind === 'fill_event'
      ? 'Trade Filled'
      : kind.startsWith('loan_')
        ? `Loan ${kind.endsWith('response') ? 'Response' : 'Request'}`
        : kind.endsWith('response')
          ? 'Order Response'
          : 'Order Sent';
    return notice(
      event,
      failed ? 'critical' : 'execution',
      failed ? 'critical' : 'info',
      failed ? `${label} Failed` : label,
      responseStatus || `${titleCase(text(data.side))}${symbol ? ` · ${symbol}` : ''}` || 'Binance execution event',
      subject,
      'execution',
      failed,
    );
  }

  if (kind === 'binance.connected') {
    const assets = numberValue(data.assets);
    const permissions = data.canTrade === true ? 'Trading permission confirmed' : 'Read-only connection';
    return notice(event, 'health', 'resolved', 'Binance Connection Recovered', `${assets ?? 0} assets synchronized · ${permissions}`, 'Binance', 'bot');
  }

  if (kind === 'engine.start' || kind === 'engine_started' || kind === 'basis.engine_started') {
    const strategy = kind.includes('basis') ? 'Basis' : text(data.strategy) === 'volume_spike' ? 'Volume' : 'Core';
    return notice(event, 'health', 'resolved', `${strategy} Engine Started`, text(data.message) || 'Runtime is online and processing configured markets', `${strategy} Engine`, 'bot');
  }

  if (kind === 'config_change') {
    const controlKeys = Object.keys(data).filter((key) => ['automationPaused', 'liveTradingEnabled', 'killSwitch', 'fundsLocked', 'borrowGuard'].includes(key));
    if (!controlKeys.length) return null;
    const paused = data.automationPaused === true;
    return notice(
      event,
      paused ? 'critical' : 'health',
      paused ? 'warning' : 'info',
      paused ? 'Bot Automation Paused' : 'Execution Control Changed',
      controlKeys.map(titleCase).join(' · '),
      'Execution Control',
      'bot',
      paused,
    );
  }

  if (kind === 'aws_notification') {
    const awsState = text(data.state).toLowerCase();
    const alarm = text(data.alarmName);
    const failed = ['alarm', 'stopped', 'stopping', 'shutting-down', 'terminated', 'impaired', 'failed'].includes(awsState);
    const recovered = ['ok', 'running', 'healthy', 'resolved'].includes(awsState);
    const resource = text(data.resource) || text(data.detailType) || 'AWS Resource';
    return notice(
      event,
      'infrastructure',
      failed ? 'critical' : recovered ? 'resolved' : 'warning',
      alarm || (failed ? 'AWS Infrastructure Needs Attention' : recovered ? 'AWS Infrastructure Recovered' : 'AWS State Changed'),
      [resource, awsState ? titleCase(awsState) : '', text(data.reason)].filter(Boolean).join(' · '),
      text(data.service) || 'AWS',
      'aws',
      failed,
    );
  }

  return null;
}

export function curateNotifications(events: LedgerEvent[]): CuratedNotification[] {
  return events
    .map(curateNotification)
    .filter((item): item is CuratedNotification => item !== null)
    .sort((a, b) => b.ts - a.ts || b.id - a.id);
}

export function notificationEnabled(item: CuratedNotification, rules: NotificationRules): boolean {
  return rules[item.category] !== false;
}

/** Group bursts into one operator alert while retaining the underlying count. */
export function groupNotifications(items: CuratedNotification[], zone?: string): CuratedNotification[] {
  const groups = new Map<string, CuratedNotification>();
  for (const item of items) {
    const stateFamily = item.title
      .replace(/\s+(Failed|Recovered|Closed|Started|Engaged|Released|Paused)$/i, '')
      .replace(/^AWS Infrastructure\s+/i, 'AWS ');
    const stateChange = item.origin !== 'execution' || item.category === 'health';
    const windowMs = item.category === 'execution' ? 10 * 60_000 : 15 * 60_000;
    const window = stateChange ? dayKey(new Date(item.ts), zone) : String(Math.floor(item.ts / windowMs));
    const key = stateChange
      ? `${item.origin}|${stateFamily}|${item.subject}|${window}`
      : `${item.category}|${item.title}|${item.subject}|${window}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(key, { ...item });
  }
  return [...groups.values()].sort((a, b) => b.ts - a.ts || b.id - a.id);
}
