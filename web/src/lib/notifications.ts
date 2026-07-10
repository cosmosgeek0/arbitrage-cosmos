import type { LedgerEvent } from '../types';
import type { NotificationRuleKey, NotificationRules } from './prefs';

export type NotificationSeverity = 'critical' | 'warning' | 'info' | 'opportunity';

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
}

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const titleCase = (value: string) => value
  .replace(/[._-]+/g, ' ')
  .replace(/\b\w/g, (character) => character.toUpperCase());

const sideLabel = (side: string) => side === 'LONG_PERP_SHORT_SPOT'
  ? 'Long Perpetual / Short Spot'
  : side === 'SHORT_PERP_LONG_SPOT'
    ? 'Short Perpetual / Long Spot'
    : titleCase(side);

const pct = (value: number | null) => value === null
  ? '—'
  : `${value >= 0 ? '+' : ''}${value.toFixed(Math.abs(value) < 1 ? 2 : 1)}%`;

function notice(
  event: LedgerEvent,
  category: NotificationRuleKey,
  severity: NotificationSeverity,
  title: string,
  detail: string,
  subject: string,
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
  };
}

/**
 * Convert the immutable ledger into the much smaller set of events an operator
 * should actually be interrupted for. Scanner decisions, snapshots, heartbeats,
 * reconnect attempts, and candidate telemetry remain available in Logs.
 */
export function curateNotification(event: LedgerEvent): CuratedNotification | null {
  const data = (event.data && typeof event.data === 'object' ? event.data : {}) as Record<string, unknown>;
  const kind = event.kind.toLowerCase();
  const symbol = event.symbol ?? text(data.symbol);
  const subject = symbol || 'Control Room';

  if (kind === 'strategy_signal') {
    if (text(data.action) !== 'opened') return null;
    const basis = num(data.basisOpen);
    const side = sideLabel(text(data.side));
    const funding = num(data.fundingOpen);
    const detail = [side, `Basis ${pct(basis)}`, funding === null ? '' : `Funding ${pct(funding * 100)}`].filter(Boolean).join(' · ');
    return notice(event, 'opportunities', 'opportunity', `${subject} Opportunity Opened`, detail, subject);
  }

  if (kind === 'risk_decision') {
    if (data.allowed === true) return null;
    const reasons = Array.isArray(data.reasons) ? data.reasons.filter((item): item is string => typeof item === 'string') : [];
    return notice(
      event,
      'critical',
      'critical',
      'Risk Gate Blocked Action',
      reasons.slice(0, 2).join(' · ') || `${titleCase(text(data.stage) || 'Order')} did not pass configured limits`,
      subject,
    );
  }

  if (kind === 'error_event') {
    const source = text(data.source);
    const message = text(data.message);
    const noise = `${source} ${message}`.toLowerCase();
    if (noise.includes('source-logo') || noise.includes('favicon') || noise.includes('logo cache')) return null;
    const accountFailure = source.toLowerCase().includes('account') || source.toLowerCase().includes('binance');
    return notice(
      event,
      'critical',
      'critical',
      accountFailure ? 'Account Sync Failed' : 'System Operation Failed',
      message || `${titleCase(source || 'System')} reported an error`,
      titleCase(source || 'System'),
    );
  }

  if (kind === 'user_stream') {
    const status = text(data.status).toLowerCase();
    if (!['failed', 'closed', 'error'].includes(status)) return null;
    return notice(
      event,
      'critical',
      'critical',
      'Binance User Stream Failed',
      text(data.detail) || 'Account events are not arriving from Binance',
      'Binance',
    );
  }

  if (kind === 'ws.closed') {
    const feed = text(data.feed) || 'Market stream';
    return notice(event, 'critical', 'critical', 'Market Stream Closed', `${feed} stopped and requires connection review`, 'Market Data');
  }

  if (kind === 'manual_action') {
    const action = text(data.action);
    if (action === 'kill_switch') {
      const engaged = data.on === true;
      return notice(
        event,
        engaged ? 'critical' : 'bot',
        engaged ? 'critical' : 'info',
        engaged ? 'Kill Switch Engaged' : 'Kill Switch Released',
        engaged ? 'Orders, loans, and automation are blocked' : 'Configured risk gates are back in control',
        'Execution Control',
      );
    }
    return notice(event, 'bot', 'info', 'Operator Control Changed', titleCase(action || 'Manual action'), 'Execution Control');
  }

  if (kind === 'order_intent') {
    const intent = data.intent && typeof data.intent === 'object' ? data.intent as Record<string, unknown> : {};
    const detail = [titleCase(text(intent.side)), symbol, titleCase(text(intent.type))].filter(Boolean).join(' · ');
    return notice(event, 'account', 'info', 'Order Intent Recorded', detail || 'A signed order preview entered the execution path', subject);
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
      failed ? 'critical' : 'account',
      failed ? 'critical' : 'info',
      failed ? `${label} Failed` : label,
      responseStatus || `${titleCase(text(data.side))}${symbol ? ` · ${symbol}` : ''}` || 'Binance execution event',
      subject,
    );
  }

  if (kind === 'binance.connected') {
    const assets = num(data.assets);
    const permissions = data.canTrade === true ? 'Trading permission confirmed' : 'Read-only connection';
    return notice(event, 'account', 'info', 'Binance Account Connected', `${assets ?? 0} assets synchronized · ${permissions}`, 'Binance');
  }

  if (kind === 'engine.start' || kind === 'engine_started' || kind === 'basis.engine_started') {
    const strategy = kind.includes('basis') ? 'Basis' : text(data.strategy) === 'volume_spike' ? 'Volume' : 'Core';
    return notice(event, 'bot', 'info', `${strategy} Engine Started`, text(data.message) || 'Runtime is online and processing configured markets', `${strategy} Engine`);
  }

  if (kind === 'config_change') {
    const keys = Object.keys(data).filter((key) => !['correlationId', 'message'].includes(key));
    return notice(event, 'bot', 'warning', 'Control Configuration Changed', keys.slice(0, 2).map(titleCase).join(' · ') || 'Runtime configuration updated', 'Execution Control');
  }

  if (kind === 'aws_runner_request') {
    return notice(event, 'bot', 'info', 'AWS Runner Command Sent', titleCase(text(data.command) || 'Command'), 'AWS Runner');
  }

  if (kind.includes('announcement') || kind.startsWith('news.')) {
    return notice(event, 'news', 'info', text(data.title) || 'Market Announcement', text(data.summary) || 'A monitored source published a new market notice', text(data.source) || 'Market News');
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

/** Group short bursts of the same operational alert without hiding later recurrences. */
export function groupNotifications(items: CuratedNotification[]): CuratedNotification[] {
  const groups = new Map<string, CuratedNotification>();
  for (const item of items) {
    const windowMs = item.category === 'bot' || item.category === 'account' ? 60 * 60_000 : 15 * 60_000;
    const window = Math.floor(item.ts / windowMs);
    const key = `${item.category}|${item.title}|${item.subject}|${window}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(key, { ...item });
  }
  return [...groups.values()].sort((a, b) => b.ts - a.ts || b.id - a.id);
}
