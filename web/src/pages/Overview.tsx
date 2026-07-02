import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { AreaChart } from '../components/AreaChart';
import { AssetDot } from '../components/AssetDot';
import { Delta } from '../components/Delta';
import { Sparkline } from '../components/Sparkline';
import { StatCard } from '../components/StatCard';
import { IconSearch } from '../components/Icons';
import { fmtCompact, fmtFunding, fmtPct, fmtPrice, countdown } from '../format';
import type { KlinePoint, SymbolRow } from '../types';

const RANGES = {
  '1H': { interval: '1m', limit: 60 },
  '1D': { interval: '5m', limit: 288 },
  '1W': { interval: '30m', limit: 336 },
  '1M': { interval: '2h', limit: 360 },
} as const;
type RangeKey = keyof typeof RANGES;

const klineCache = new Map<string, KlinePoint[]>();

type SortKey = 'quoteVolume24h' | 'basisPct' | 'fundingRate' | 'change24hPct';

export function Overview({
  heroSymbol,
  setHeroSymbol,
}: {
  heroSymbol: string;
  setHeroSymbol: (s: string) => void;
}) {
  const { snap } = useStore();
  const [range, setRange] = useState<RangeKey>('1D');
  const [klines, setKlines] = useState<KlinePoint[]>([]);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('quoteVolume24h');
  const [sortDesc, setSortDesc] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const { interval, limit } = RANGES[range];
    const key = `${heroSymbol}:${range}`;
    const cached = klineCache.get(key);
    if (cached) setKlines(cached);
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/klines?symbol=${heroSymbol}&interval=${interval}&limit=${limit}`);
        if (!res.ok) return;
        const data = (await res.json()) as KlinePoint[];
        if (alive) {
          klineCache.set(key, data);
          setKlines(data);
        }
      } catch {
        // keep whatever we have
      }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [heroSymbol, range]);

  const hero: SymbolRow | undefined = snap?.rows.find((r) => r.symbol === heroSymbol);

  const filtered = useMemo(() => {
    if (!snap) return [];
    let rows = snap.rows;
    if (search) {
      const q = search.toUpperCase();
      rows = rows.filter((r) => r.base.includes(q) || r.symbol.includes(q));
    }
    const dir = sortDesc ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = sortKey === 'basisPct' ? Math.abs(av) - Math.abs(bv) : av - bv;
      return cmp * dir;
    });
    return rows;
  }, [snap, search, sortKey, sortDesc]);

  const visible = showAll ? filtered : filtered.slice(0, 50);

  function header(label: string, key: SortKey) {
    const active = sortKey === key;
    return (
      <th
        className={`sortable ${active ? 'active' : ''}`}
        onClick={() => {
          if (active) setSortDesc(!sortDesc);
          else {
            setSortKey(key);
            setSortDesc(true);
          }
        }}
      >
        {label} {active ? (sortDesc ? '↓' : '↑') : ''}
      </th>
    );
  }

  if (!snap) return <div className="page-loading">Connecting to engine…</div>;
  const s = snap.stats;

  return (
    <>
      <div className="card hero-card">
        <div className="hero-head">
          <div className="hero-title">
            <AssetDot base={hero?.base ?? '?'} size={44} />
            <div>
              <div className="hero-name">
                {hero?.base ?? heroSymbol} <span className="chip">{heroSymbol}</span>
                <span className="chip chip-blue">Spot</span>
              </div>
              <div className="hero-price-row">
                <span className="hero-price">{fmtPrice(hero?.spot)}</span>
                <Delta value={hero?.change24hPct} />
              </div>
            </div>
          </div>
          <div className="range-chips">
            {(Object.keys(RANGES) as RangeKey[]).map((r) => (
              <button key={r} className={`range-chip ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <AreaChart data={klines} height={280} />
        <div className="hero-substats">
          <div>
            <span className="muted">Perp mark</span> {fmtPrice(hero?.perpMark)}
          </div>
          <div>
            <span className="muted">Basis</span>{' '}
            <b className={hero?.basisPct && hero.basisPct > 0 ? 'pos' : 'neg'}>{fmtPct(hero?.basisPct, 3)}</b>
          </div>
          <div>
            <span className="muted">Funding</span> {fmtFunding(hero?.fundingRate)}{' '}
            <span className="muted">in {countdown(hero?.nextFundingTime)}</span>
          </div>
          <div>
            <span className="muted">24h vol</span> {fmtCompact(hero?.quoteVolume24h)}
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Pairs tracked" value={s.pairs} sub={`${s.liquidPairs} liquid ≥ ${fmtCompact(3_000_000)} vol`} />
        <StatCard label="Avg |basis| (liquid)" value={`${s.avgAbsBasis.toFixed(3)}%`} sub={`signal threshold ${s.grossThresholdPct.toFixed(2)}%`} />
        <StatCard
          label="Active signals"
          value={s.activeSignals}
          sub={`${s.watching} watching`}
          accent={s.activeSignals > 0 ? 'green' : undefined}
        />
        <StatCard
          label="Widest basis"
          value={s.topBasis[0] ? `${fmtPct(s.topBasis[0].basisPct, 2)}` : '—'}
          sub={s.topBasis[0]?.symbol ?? ''}
          accent={s.topBasis[0] && Math.abs(s.topBasis[0].basisPct ?? 0) >= s.grossThresholdPct ? 'amber' : undefined}
        />
      </div>

      <div className="section-title">Top movers · 24h</div>
      <div className="movers-row">
        {s.topMovers.map((m) => (
          <button key={m.symbol} className="card mover-card" onClick={() => setHeroSymbol(m.symbol)}>
            <div className="mover-head">
              <AssetDot base={m.base} size={28} />
              <span className="mover-name">{m.base}</span>
            </div>
            <Sparkline points={m.spark} width={120} height={30} />
            <div className="mover-foot">
              <span className="mover-price">{fmtPrice(m.spot)}</span>
              <Delta value={m.change24hPct} digits={1} />
            </div>
          </button>
        ))}
      </div>

      <div className="card table-card">
        <div className="table-head">
          <div className="section-title" style={{ margin: 0 }}>
            Spot + perp pairs <span className="muted">({filtered.length})</span>
          </div>
          <div className="search-box">
            <IconSearch />
            <input placeholder="Search asset" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="table-scroll">
        <table className="market-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Spot</th>
              <th>Perp mark</th>
              {header('Basis', 'basisPct')}
              {header('Funding', 'fundingRate')}
              {header('24h', 'change24hPct')}
              {header('24h vol', 'quoteVolume24h')}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.symbol} className={r.symbol === heroSymbol ? 'selected' : ''} onClick={() => setHeroSymbol(r.symbol)}>
                <td>
                  <div className="asset-cell">
                    <AssetDot base={r.base} size={30} />
                    <div>
                      <div className="asset-base">{r.base}</div>
                      <div className="asset-sym muted">{r.symbol}</div>
                    </div>
                  </div>
                </td>
                <td className="num">{fmtPrice(r.spot)}</td>
                <td className="num muted">{fmtPrice(r.perpMark)}</td>
                <td className="num">
                  <span className={`basis-chip ${r.basisPct === null ? '' : r.basisPct > 0 ? 'pos-bg' : 'neg-bg'}`}>
                    {fmtPct(r.basisPct, 3)}
                  </span>
                </td>
                <td className="num muted">{fmtFunding(r.fundingRate)}</td>
                <td className="num">
                  <Delta value={r.change24hPct} />
                </td>
                <td className="num muted">{fmtCompact(r.quoteVolume24h)}</td>
                <td>
                  <span className={`status-chip status-${r.status}`}>
                    {r.status === 'signal' ? 'Signal' : r.status === 'watching' ? 'Watching' : 'Idle'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {!showAll && filtered.length > 50 && (
          <button className="show-all" onClick={() => setShowAll(true)}>
            Show all {filtered.length} pairs
          </button>
        )}
      </div>
    </>
  );
}
