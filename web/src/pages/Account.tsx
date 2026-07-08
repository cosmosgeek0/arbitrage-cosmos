/* Account v3 — the Binance wallet page, exactly:
   HERO: Est. Total Value (maskable) + ≈BTC + Today's PnL, range chips
   (1W/1M/3M/6M), full-width equity chart with date axis + hover readout.
   MY ASSETS: Account View ONLY — every Binance bucket in tight rows (bare
   glyph + name, value + ratio) — plus one big allocation donut on the right.
   ACTIVITY: live open orders + recent fills, straight from Binance sync.
   Earn value comes from /api/earn (signed Simple-Earn positions) — real
   numbers, not derived guesses. No trading affordances anywhere. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useRefreshSignal } from '../lib/refresh';
import { WarnStrip } from '../components/ui';
import { Pill } from '../components/px';
import { Donut } from '../components/Donut';
import { Num } from '../components/Num';
import {
  IconBook, IconChart, IconCoins, IconExchange, IconGrid,
  IconLayers, IconPulse, IconReceipt, IconWallet,
} from '../components/Icons';
import { fmtPct, fmtPrice, fmtQty, signClass, timeAgo } from '../format';
import type { FillRow, LoansSnapshot } from '../types';

const STABLE_ASSETS = new Set(['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI']);
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function pctOf(value: number, total: number): number {
  if (!total) return 0;
  return (value / total) * 100;
}

const EyeIcon = ({ off }: { off: boolean }) => (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
    <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    {off && <path d="M4 16L16 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
  </svg>
);

type RangeId = '1W' | '1M' | '3M' | '6M';
const RANGES: { id: RangeId; ms: number }[] = [
  { id: '1W', ms: 7 * 86_400_000 },
  { id: '1M', ms: 30 * 86_400_000 },
  { id: '3M', ms: 90 * 86_400_000 },
  { id: '6M', ms: 180 * 86_400_000 },
];

/** Full-width equity chart: accent area over the selected range with a date
 * axis and a hover readout (crosshair + value + timestamp). The line starts
 * where history starts — no invented flat prehistory. */
function EquityChart({ points, rangeMs, mask, rebuiltBefore }: { points: { ts: number; v: number }[]; rangeMs: number; mask: boolean; rebuiltBefore: number | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ frac: number; v: number; ts: number } | null>(null);

  const now = Date.now();
  // The domain CLAMPS to where history begins — a 6M ask with 30 days of data
  // draws those 30 days full-width (with a note), never a sliver at the edge.
  const requestedStart = now - rangeMs;
  const firstTs = points[0]?.ts ?? now;
  const start = Math.max(requestedStart, firstTs);
  const data = points.filter((p) => p.ts >= start);
  const clamped = firstTs > requestedStart;

  if (data.length < 2) {
    return <div className="acb-chart-empty">Equity history arms after a few snapshots (every 15 minutes).</div>;
  }

  const W = 1000;
  const H = 150;
  const vs = data.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const pad = (max - min || Math.max(1, max * 0.02)) * 0.15;
  const lo = min - pad;
  const hi = max + pad;
  const x = (ts: number) => ((ts - start) / (now - start)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * (H - 8) - 4;
  let d = `M${x(data[0].ts).toFixed(1)} ${y(data[0].v).toFixed(1)}`;
  for (let i = 1; i < data.length; i++) d += ` L${x(data[i].ts).toFixed(1)} ${y(data[i].v).toFixed(1)}`;
  const area = `${d} L${x(data[data.length - 1].ts).toFixed(1)} ${H} L${x(data[0].ts).toFixed(1)} ${H} Z`;

  const onMove = (e: { clientX: number }) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const ts = start + frac * (now - start);
    let best = data[0];
    for (const p of data) if (Math.abs(p.ts - ts) < Math.abs(best.ts - ts)) best = p;
    setHover({ frac: (best.ts - start) / (now - start), v: best.v, ts: best.ts });
  };

  const ticks = Array.from({ length: 6 }, (_, i) => start + ((i + 0.5) / 6) * (now - start));
  const fmtTick = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }).replace('/', '-');

  return (
    <div className="acb-chartwrap">
      <div className="acb-chartplot" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          <path d={area} fill="var(--accent-soft)" />
          <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {hover && (
          <>
            <span className="acb-cross" style={{ left: `${hover.frac * 100}%` }} />
            <span className={`acb-tip ${hover.frac > 0.72 ? 'flip' : ''}`} style={{ left: `${hover.frac * 100}%` }}>
              <b>{mask ? '••••••' : fmtPrice(hover.v)}</b>
              <em>{new Date(hover.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</em>
            </span>
          </>
        )}
      </div>
      <div className="acb-axis">
        {ticks.map((t) => <span key={t}>{fmtTick(t)}</span>)}
      </div>
      {rebuiltBefore !== null && start < rebuiltBefore ? (
        <div className="acb-chart-note">
          before {new Date(rebuiltBefore).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: rebuilt from your real deposit &amp; withdrawal history · after: Binance daily snapshots + live feed
        </div>
      ) : clamped ? (
        <div className="acb-chart-note">
          history begins {new Date(firstTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </div>
      ) : null}
    </div>
  );
}

export function Account() {
  const { state, markets } = useStore();
  const [loans, setLoans] = useState<LoansSnapshot | null>(null);
  const [earnRows, setEarnRows] = useState<{ asset: string; amount: number; apr: number }[]>([]);
  const [equity, setEquity] = useState<{ ts: number; v: number }[]>([]);
  const [dailyHist, setDailyHist] = useState<{ ts: number; v: number }[]>([]);
  const [rebuiltBefore, setRebuiltBefore] = useState<number | null>(null);
  const [fills, setFills] = useState<FillRow[]>([]);
  const [range, setRange] = useState<RangeId>('1W');
  const [mask, setMask] = useState(() => localStorage.getItem('cosmos-balance-mask') === '1');
  const [refreshTick, setRefreshTick] = useState(0);
  useRefreshSignal(() => setRefreshTick((n) => n + 1));

  useEffect(() => {
    let alive = true;
    const grab = <T,>(url: string, fn: (d: T) => void) =>
      fetch(url).then((r) => (r.ok ? r.json() : null)).then((d) => alive && d && fn(d as T)).catch(() => undefined);
    void grab<LoansSnapshot>('/api/loans', setLoans);
    void grab<{ rows: { asset: string; amount: number; apr: number }[] }>('/api/earn', (d) => setEarnRows(d.rows ?? []));
    void grab<{ equitySnapshots?: { ts: number; totalUsdt: number }[] }>('/api/pnl', (d) =>
      setEquity((d.equitySnapshots ?? []).filter((s) => finite(s.totalUsdt)).map((s) => ({ ts: s.ts, v: s.totalUsdt }))));
    void grab<{ rows?: { ts: number; totalUsdt: number }[]; reconstructedBefore?: number | null }>('/api/equity-history', (d) => {
      setDailyHist((d.rows ?? []).filter((r) => finite(r.totalUsdt)).map((r) => ({ ts: r.ts, v: r.totalUsdt })));
      setRebuiltBefore(d.reconstructedBefore ?? null);
    });
    void grab<FillRow[]>('/api/fills', (d) => setFills(d.slice(0, 8)));
    return () => { alive = false; };
  }, [refreshTick]);

  const toggleMask = () => {
    setMask((m) => {
      localStorage.setItem('cosmos-balance-mask', m ? '0' : '1');
      return !m;
    });
  };

  const acct = state?.account;
  const btcSpot = markets.find((m) => m.base === 'BTC')?.spot ?? null;
  const priceOf = (asset: string): number | null =>
    asset === 'USDT' || STABLE_ASSETS.has(asset) ? 1 : markets.find((m) => m.symbol === `${asset}USDT`)?.spot ?? null;

  // Earn valued from Binance's own Simple-Earn positions (authoritative).
  const earnTotal = useMemo(
    () => earnRows.reduce((sum, r) => sum + r.amount * (priceOf(r.asset) ?? 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [earnRows, markets],
  );

  // Spot rows minus LD wrappers (their value is the Earn bucket, from the API).
  const spotEntries = useMemo(
    () => (acct?.entries ?? []).filter((e) => !(e.asset.startsWith('LD') && e.asset.length > 3)),
    [acct?.entries],
  );
  const spotTotal = spotEntries.reduce((s, e) => s + e.valueUsdt, 0);
  const margin = loans?.margin ?? null;
  const marginValue = margin?.available && finite(btcSpot) ? margin.totalNetAssetBtc * btcSpot : 0;
  const grandTotal = spotTotal + earnTotal + marginValue;
  const btcEquiv = finite(btcSpot) && btcSpot > 0 ? grandTotal / btcSpot : null;
  const today = acct?.dayChangeUsd ?? null;
  const todayPct = finite(today) && grandTotal > 0 ? (today / grandTotal) * 100 : null;
  const todayFlat = !finite(today) || Math.abs(today) < 0.005;

  // Allocation = every real holding: spot entries + earn positions, merged.
  const allocation = useMemo(() => {
    const byAsset = new Map<string, number>();
    for (const e of spotEntries) byAsset.set(e.asset, (byAsset.get(e.asset) ?? 0) + e.valueUsdt);
    for (const r of earnRows) {
      const v = r.amount * (priceOf(r.asset) ?? 0);
      byAsset.set(r.asset, (byAsset.get(r.asset) ?? 0) + v);
    }
    return Array.from(byAsset.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotEntries, earnRows, markets]);

  const series = useMemo(() => {
    const firstLive = equity[0]?.ts ?? Number.POSITIVE_INFINITY;
    return [...dailyHist.filter((p) => p.ts < firstLive), ...equity];
  }, [dailyHist, equity]);

  const money = (v: number | null | undefined) => (mask ? '••••••' : fmtPrice(v));

  if (!state) {
    return (
      <div className="container page hp-page wide acb-page">
        <div className="hp-loading">
          <Pill tone="idle">Connecting</Pill>
          <b>Waiting for server state…</b>
        </div>
      </div>
    );
  }

  const b = state.binance;
  const posture = b.keyPosture;
  const syncTone = !b.keysPresent ? 'idle' : b.connected ? 'ok' : 'bad';
  const openOrders = state.openOrders ?? [];
  const earnApr = earnRows.length ? earnRows.reduce((s, r) => s + r.apr, 0) / earnRows.length : null;

  const buckets: { id: string; icon: JSX.Element; name: string; value: number | null; note?: string }[] = [
    { id: 'earn', icon: <IconCoins size={19} />, name: 'Earn', value: earnTotal, note: earnApr !== null && earnTotal > 0 ? `${(earnApr * 100).toFixed(2)}% APR` : undefined },
    { id: 'spot', icon: <IconWallet size={19} />, name: 'Spot', value: spotTotal },
    { id: 'margin', icon: <IconLayers size={19} />, name: 'Cross Margin', value: marginValue },
    { id: 'isolated', icon: <IconExchange size={19} />, name: 'Isolated Margin', value: null },
    { id: 'funding', icon: <IconReceipt size={19} />, name: 'Funding', value: null },
    { id: 'usdm', icon: <IconChart size={19} />, name: 'USDⓈ-M Futures', value: null },
    { id: 'coinm', icon: <IconPulse size={19} />, name: 'COIN-M Futures', value: null },
    { id: 'options', icon: <IconBook size={19} />, name: 'Options', value: null },
    { id: 'alpha', icon: <IconGrid size={19} />, name: 'Alpha', value: null },
  ];

  return (
    <div className="container page hp-page wide acb-page">
      {posture.level === 'unsafe' && (
        <WarnStrip>{posture.label}. This app has no withdrawal or transfer-out route regardless, but the key itself should not carry that permission — recreate it as read-only.</WarnStrip>
      )}

      {/* ---- portfolio hero --------------------------------------------- */}
      <section className="hp-group acb-hero2">
        <div className="acb-hero2-top">
          <div className="acb-hero2-id">
            <div className="acb-label-row">
              <span className="acb-label">Est. Total Value</span>
              <button className="acb-eye" onClick={toggleMask} title={mask ? 'Show balances' : 'Hide balances'} aria-label={mask ? 'Show balances' : 'Hide balances'}>
                <EyeIcon off={mask} />
              </button>
              <Pill tone={syncTone}>{b.keysPresent ? (b.connected ? `synced ${timeAgo(b.lastSyncTs)}` : 'sync failing') : 'keys absent'}</Pill>
            </div>
            <div className="acb-value">
              {acct ? <Num value={mask ? null : grandTotal}>{money(grandTotal)}</Num> : 'Read sync pending'}
            </div>
            <div className="acb-approx">{btcEquiv !== null && acct ? `≈ ${mask ? '••••' : btcEquiv.toFixed(8)} BTC` : 'BTC equivalent arrives with the market feed'}</div>
            <div className="acb-today">
              <span className="acb-today-k">Today's PnL</span>
              {finite(today) && acct ? (
                todayFlat ? (
                  <span className="acb-today-v">{mask ? '••••' : `${fmtPrice(0)} (0.00%)`}</span>
                ) : (
                  <span className={`acb-today-v ${signClass(today)}`}>
                    {mask ? '••••' : `${today >= 0 ? '+' : '−'}${fmtPrice(Math.abs(today))}${todayPct !== null ? ` (${fmtPct(Math.abs(todayPct), 2, false)})` : ''}`}
                  </span>
                )
              ) : (
                <span className="acb-today-v idle">—</span>
              )}
            </div>
          </div>
          <div className="acb-ranges" role="tablist">
            {RANGES.map((rr) => (
              <button key={rr.id} role="tab" aria-selected={range === rr.id} className={range === rr.id ? 'on' : ''} onClick={() => setRange(rr.id)}>{rr.id}</button>
            ))}
          </div>
        </div>
        <EquityChart points={series} rangeMs={RANGES.find((r) => r.id === range)!.ms} mask={mask} rebuiltBefore={rebuiltBefore} />
      </section>

      {/* ---- my assets: account view + allocation ------------------------ */}
      <section className="hp-group acb-assets2">
        <h3 className="acb-h3">My Assets</h3>
        <div className="acb-assets2-grid">
          <div className="acb-bucketlist">
            <div className="acb-bl-head">
              <span className="l">Account</span>
              <span className="r">Amount</span>
              <span className="r">Ratio</span>
            </div>
            {buckets.map((bk) => (
              <div key={bk.id} className="acb-bl-row" title={bk.value === null ? 'Not readable with this read-only spot key' : undefined}>
                <span className="acb-bl-ic">{bk.icon}</span>
                <span className="acb-bl-name">{bk.name}{bk.note && <em>{bk.note}</em>}</span>
                <span className="acb-bl-amt">
                  {bk.value === null ? <i>--</i> : (
                    <>
                      <b>{money(bk.value)}</b>
                      <small>{mask ? '••••' : finite(btcSpot) && btcSpot > 0 ? `${(bk.value / btcSpot).toFixed(8)} BTC` : '—'}</small>
                    </>
                  )}
                </span>
                <span className="acb-bl-ratio">{bk.value === null ? <i>--</i> : fmtPct(pctOf(bk.value, grandTotal || 1), 2, false)}</span>
              </div>
            ))}
          </div>
          <div className="acb-allocwrap">
            <span className="acb-alloc-title">Allocation</span>
            {allocation.length > 0 && !mask ? (
              <Donut slices={allocation} size={172} topN={5} />
            ) : mask ? (
              <div className="acb-chart-empty">Hidden</div>
            ) : (
              <div className="acb-chart-empty">Allocation appears after read sync.</div>
            )}
          </div>
        </div>
      </section>

      {/* ---- activity: live Binance truth -------------------------------- */}
      <section className="hp-group acb-activity2">
        <div className="acb-act-head">
          <h3 className="acb-h3">Activity</h3>
          <span className={`acb-act-live ${openOrders.length > 0 ? 'on' : ''}`}>
            <i />{openOrders.length > 0 ? `${openOrders.length} Open Order${openOrders.length > 1 ? 's' : ''}` : 'No Open Orders'}
          </span>
        </div>

        <span className="acb-act-sub">Open Orders</span>
        {openOrders.length === 0 ? (
          <div className="acb-act-empty">Nothing working right now — the moment a bot places an order on Binance, it appears here from account sync.</div>
        ) : (
          <table className="acb-table acb-act-table">
            <thead>
              <tr>
                <th className="l">Order</th>
                <th className="r">Price</th>
                <th className="r">Quantity</th>
                <th className="r">Filled</th>
                <th className="r">Status</th>
                <th className="r">Age</th>
              </tr>
            </thead>
            <tbody>
              {openOrders.map((o) => (
                <tr key={`${o.symbol}-${o.orderId}`}>
                  <td className="l">
                    <span className="acb-act-sym">
                      <b className={o.side === 'BUY' ? 'up' : 'down'}>{o.side === 'BUY' ? 'Buy' : 'Sell'}</b>
                      {o.symbol}
                      <em>{o.type.toLowerCase()}</em>
                    </span>
                  </td>
                  <td className="r acb-num"><span className="acb-cell-main">{fmtPrice(o.price)}</span></td>
                  <td className="r acb-num"><span className="acb-cell-main">{fmtQty(o.origQty)}</span></td>
                  <td className="r acb-num"><span className="acb-cell-main">{fmtPct(o.origQty > 0 ? (o.executedQty / o.origQty) * 100 : 0, 0, false)}</span></td>
                  <td className="r"><span className={`acb-act-status ${o.stale ? 'warn' : ''}`}>{o.stale ? 'stale' : o.status.toLowerCase()}</span></td>
                  <td className="r acb-num"><span className="acb-cell-sub">{timeAgo(o.time)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <span className="acb-act-sub">Recent Fills</span>
        {fills.length === 0 ? (
          <div className="acb-act-empty">No recorded executions yet. Fills stream in live and past Binance trades can be imported per symbol.</div>
        ) : (
          <table className="acb-table acb-act-table">
            <thead>
              <tr>
                <th className="l">Fill</th>
                <th className="r">Price</th>
                <th className="r">Quantity</th>
                <th className="r">Value</th>
                <th className="r">Time</th>
              </tr>
            </thead>
            <tbody>
              {fills.map((f) => (
                <tr key={`${f.symbol}-${f.tradeId}`}>
                  <td className="l">
                    <span className="acb-act-sym">
                      <b className={f.side === 'BUY' ? 'up' : 'down'}>{f.side === 'BUY' ? 'Buy' : 'Sell'}</b>
                      {f.symbol}
                      <em>{f.source}</em>
                    </span>
                  </td>
                  <td className="r acb-num"><span className="acb-cell-main">{fmtPrice(f.price)}</span></td>
                  <td className="r acb-num"><span className="acb-cell-main">{fmtQty(f.qty)}</span></td>
                  <td className="r acb-num"><span className="acb-cell-main">{money(f.quoteQty)}</span></td>
                  <td className="r acb-num"><span className="acb-cell-sub">{timeAgo(f.ts)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
