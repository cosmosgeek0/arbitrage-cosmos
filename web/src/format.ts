// Formatting ported from the Signal Lab conventions: adaptive precision,
// tabular-friendly, honest em-dashes for unknowns.

const QUOTES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USD'];

export function baseOf(symbol: string | null | undefined): string {
  const s = String(symbol ?? '').toUpperCase();
  for (const q of QUOTES) if (s.endsWith(q) && s.length > q.length) return s.slice(0, -q.length);
  return s;
}

// Adaptive price precision, exchange-style. FX-converted like fmtMoney —
// the display-currency pref must move EVERY money figure, not just compacts.
export function fmtPrice(v: number | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n) || v === null || v === undefined) return '—';
  if (fxRate === null) return '—';
  if (n === 0) return fxSymbol + '0.00';
  const c = n * fxRate;
  const a = Math.abs(c);
  let d: number;
  if (a >= 1000) d = 2;
  else if (a >= 1) d = a >= 100 ? 2 : 3;
  else if (a >= 0.1) d = 4;
  else if (a >= 0.001) d = 6;
  else d = 8;
  return fxSymbol + c.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtQty(v: number | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n) || v === null || v === undefined) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

// Display currency: converts USD money values with a live rate from /api/fx.
let fxRate: number | null = 1;
let fxSymbol = '$';
export function setFxRate(rate: number | null, symbol: string, current = true): void {
  fxRate = current && rate !== null && isFinite(rate) && rate > 0 ? rate : null;
  fxSymbol = symbol || '$';
}

export function fmtMoney(v: number | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n) || v === null || v === undefined) return '—';
  if (fxRate === null) return '—';
  return fxSymbol + Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n * fxRate);
}

export function fmtPct(v: number | null | undefined, digits = 2, withSign = true): string {
  const n = Number(v);
  if (!isFinite(n) || v === null || v === undefined) return '—';
  let s = n.toFixed(digits);
  if (parseFloat(s) === 0) s = (0).toFixed(digits); // never render "-0.00%"
  return (withSign && parseFloat(s) > 0 ? '+' : '') + s + '%';
}

// Basis display unit: percent (default), basis points, or decimal rate.
type BasisUnit = 'pct' | 'bps' | 'decimal';
let basisUnit: BasisUnit = 'pct';
export function setBasisUnit(v: BasisUnit): void {
  basisUnit = v;
}

export function fmtBasis(vPct: number | null | undefined, digits = 3): string {
  const n = Number(vPct);
  if (!isFinite(n) || vPct === null || vPct === undefined) return '—';
  if (basisUnit === 'bps') {
    const b = n * 100;
    let s = b.toFixed(Math.abs(b) >= 100 ? 0 : 1);
    if (parseFloat(s) === 0) s = s.replace('-', '');
    return (parseFloat(s) > 0 ? '+' : '') + s + ' bps';
  }
  if (basisUnit === 'decimal') {
    const decimal = n / 100;
    let s = decimal.toFixed(Math.abs(decimal) >= 0.01 ? 4 : 5);
    if (parseFloat(s) === 0) s = s.replace('-', '');
    return (parseFloat(s) > 0 ? '+' : '') + s;
  }
  return fmtPct(n, digits);
}

export function fmtFunding(rate: number | null | undefined): string {
  const n = Number(rate);
  if (!isFinite(n) || rate === null || rate === undefined) return '—';
  const pct = n * 100;
  let s = pct.toFixed(4);
  if (parseFloat(s) === 0) s = s.replace('-', '');
  return (parseFloat(s) > 0 ? '+' : '') + s + '%';
}

export function signClass(v: number | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n) || n === 0) return '';
  return n > 0 ? 'up' : 'down';
}

const pad = (x: number) => String(x).padStart(2, '0');

// Display timezone: 'local' (default) or 'utc' — set from Settings.
let tzUtc = false;
export function setDisplayUtc(v: boolean): void {
  tzUtc = v;
}

export function fmtClockUTC(d = new Date()): string {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

// HH:MM:SS in any zone ('local' uses the browser zone, 'UTC' or an IANA id
// otherwise). Falls back to UTC if the runtime rejects the zone.
export function fmtClockZone(zone: string, d = new Date()): string {
  try {
    const opts: Intl.DateTimeFormatOptions = {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    };
    if (zone && zone !== 'local') opts.timeZone = zone;
    return new Intl.DateTimeFormat('en-GB', opts).format(d);
  } catch {
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
}

export function fmtTimeShort(ts: number): string {
  const d = new Date(ts);
  return tzUtc ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (tzUtc) return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  return `${MON[d.getMonth()]} ${d.getDate()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

export function liveAge(ts: number | null | undefined): string {
  if (!ts) return '—';
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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
