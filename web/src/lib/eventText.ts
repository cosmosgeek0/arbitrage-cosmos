// Turn a ledger event into a short human sentence instead of dumping raw JSON.
// Used by the dashboard timeline and the ledger "summary" column. The raw JSON
// stays available as a hover title / expandable row.

import { fmtPrice } from '../format';

type Data = Record<string, unknown> | null;

function n(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}
function s(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

const SIDE_SHORT: Record<string, string> = {
  SHORT_PERP_LONG_SPOT: 'short perp / long spot',
  LONG_PERP_SHORT_SPOT: 'long perp / short spot',
};

export function eventSummary(kind: string, data: Data, symbol: string | null): string {
  const d = (data ?? {}) as Record<string, unknown>;
  const sym = symbol ?? s(d.symbol) ?? '';

  switch (kind) {
    case 'strategy_signal': {
      const action = s(d.action);
      const side = SIDE_SHORT[s(d.side) ?? ''] ?? s(d.side) ?? '';
      const basis = n(d.basisOpen) ?? n(d.basisClose) ?? n(d.basisAtDismiss);
      const b = basis !== undefined ? `${basis >= 0 ? '+' : ''}${basis.toFixed(2)}%` : '';
      if (action === 'opened') return `Proposal opened · ${side} · basis ${b}`;
      if (action === 'closed') return `Proposal closed · basis back to ${b}`;
      if (action === 'dismissed_by_user') return `Proposal dismissed by you · basis ${b}`;
      return `Strategy signal${side ? ` · ${side}` : ''}`;
    }
    case 'risk_decision': {
      const allowed = d.allowed === true;
      const stage = s(d.stage);
      const reasons = Array.isArray(d.reasons) ? (d.reasons as string[]) : [];
      const est = n(d.estNotionalUsd);
      const notional = est !== undefined ? ` (${fmtPrice(est)})` : '';
      if (allowed) return `Risk approved${stage ? ` · ${stage}` : ''}${notional}`;
      return `Risk rejected${notional} — ${reasons.slice(0, 2).join('; ') || 'see limits'}`;
    }
    case 'order_intent': {
      const intent = d.intent as Record<string, unknown> | undefined;
      const side = s(intent?.side) ?? '';
      const type = s(intent?.type) ?? '';
      return `Order preview · ${side} ${sym} ${type}`.trim();
    }
    case 'order_request': {
      const p = d.params as Record<string, unknown> | undefined;
      return `Historical legacy order request · ${s(p?.side) ?? ''} ${sym} ${s(p?.type) ?? ''}`.trim();
    }
    case 'order_response': {
      const status = s(d.status) ?? '';
      const exec = n(d.executedQuoteUsd);
      if (status === 'CANCELED') return `Order canceled · ${sym}`;
      if (status === 'ALL_CANCELED') return `All open orders canceled · ${sym}`;
      return `Order ${status.toLowerCase() || 'ack'} · ${sym}${exec ? ` · ${fmtPrice(exec)} filled` : ''}`;
    }
    case 'fill_event': {
      const side = s(d.side) ?? '';
      const price = n(d.price);
      const qty = n(d.qty);
      return `Fill · ${side} ${qty ?? ''} ${sym}${price ? ` @ ${fmtPrice(price)}` : ''}`.trim();
    }
    case 'manual_action': {
      const action = s(d.action) ?? '';
      const map: Record<string, string> = {
        kill_switch: `Historical legacy stop setting · ${d.on ? 'recorded on' : 'recorded off'} · non-authoritative`,
        live_trading: `Historical legacy execution setting · ${d.on ? 'recorded on' : 'recorded off'} · ignored by this candidate`,
        approve_proposal: `Historical legacy proposal approval · ${sym}`,
        reject_proposal: 'Historical legacy proposal rejection',
        cancel_order: `Historical legacy cancel event · ${sym}`,
        cancel_all_orders: `Historical legacy cancel-all event · ${sym}`,
        import_fills: `Historical legacy fill import · ${n(d.imported) ?? 0} records · ${sym}`,
        test_order: `Historical legacy test-order event · ${s(d.result) ?? ''} · ${sym}`,
        live_send: `Historical legacy send event · ${s(d.result) ?? ''} · ${sym}`,
        loan_borrow: `Historical legacy borrow event · ${s(d.result) ?? ''}`,
      };
      return map[action] ?? `Manual action · ${action}`;
    }
    case 'account_snapshot': {
      const t = n(d.totalUsdt);
      return `Account snapshot · equity ${t !== undefined ? fmtPrice(t) : '—'}`;
    }
    case 'config_change': {
      const keys = Object.keys(d);
      return `Config changed · ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '…' : ''}`;
    }
    case 'error_event':
      return `Error · ${s(d.message)?.slice(0, 80) ?? s(d.source) ?? 'unknown'}`;
    case 'ws.open':
      return `Market feed connected · ${s(d.feed) ?? ''}`;
    case 'ws.closed':
      return `Market feed dropped · ${s(d.feed) ?? ''} — reconnecting`;
    case 'binance.connected':
      return 'Historical legacy private-account event · not current connection evidence';
    case 'engine.start':
      return `Engine started · ${n(d.pairs) ?? 0} pairs`;
    case 'user_stream':
      return `Historical legacy private-stream event · ${s(d.status) ?? ''} · not current evidence`;
    case 'loan_request':
      return `Historical legacy loan request · ${s(d.action) ?? ''} · ${s(d.loanCoin) ?? ''}`;
    case 'loan_response':
      return `Historical legacy loan response · ${s(d.action) ?? ''}`;
    default:
      return kind.replace(/[._]/g, ' ');
  }
}
