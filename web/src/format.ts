// Formatting ported from the Signal Lab conventions: adaptive precision,
// tabular-friendly, honest em-dashes for unknowns.

const QUOTES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USD'];

export function baseOf(symbol: string | null | undefined): string {
  const s = String(symbol ?? '').toUpperCase();
  for (const q of QUOTES) if (s.endsWith(q) && s.length > q.length) return s.slice(0, -q.length);
  return s;
}

// Adaptive price precision, exchange-style.
export function fmtPrice(v: number | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n) || v === null || v === undefined) return '—';
  if (n === 0) return '$0.00';
  const a = Math.abs(n);
  let d: number;
  if (a >= 1000) d = 2;
  else if (a >= 1) d = a >= 100 ? 2 : 3;
  else if (a >= 0.1) d = 4;
  else if (a >= 0.001) d = 6;
  else d = 8;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtQty(v: number | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n) || v === null || v === undefined) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

export function fmtMoney(v: number | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n) || v === null || v === undefined) return '—';
  return '$' + Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
}

export function fmtPct(v: number | null | undefined, digits = 2, withSign = true): string {
  const n = Number(v);
  if (!isFinite(n) || v === null || v === undefined) return '—';
  const s = n.toFixed(digits);
  return (withSign && n > 0 ? '+' : '') + s + '%';
}

export function fmtFunding(rate: number | null | undefined): string {
  const n = Number(rate);
  if (!isFinite(n) || rate === null || rate === undefined) return '—';
  const pct = n * 100;
  return (pct > 0 ? '+' : '') + pct.toFixed(4) + '%';
}

export function signClass(v: number | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n) || n === 0) return '';
  return n > 0 ? 'up' : 'down';
}

const pad = (x: number) => String(x).padStart(2, '0');

export function fmtClockUTC(d = new Date()): string {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

export function fmtTimeShort(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${mon} ${d.getDate()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return '—';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 5) return 'now';
  if (s < 90) return Math.round(s) + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

export function duration(fromTs: number, toTs: number): string {
  const s = Math.max(0, Math.floor((toTs - fromTs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function countdown(ts: number | null | undefined): string {
  if (!ts) return '—';
  const s = Math.floor((ts - Date.now()) / 1000);
  if (s <= 0) return 'now';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
