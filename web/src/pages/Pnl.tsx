import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useRefreshSignal } from '../lib/refresh';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { Empty, Pill, Seg } from '../components/px';
import { TokenIcon } from '../components/TokenIcon';
import { SparkArea } from '../components/Spark';
import { Num } from '../components/Num';
import { baseOf, fmtDateTime, fmtMoney, fmtPrice, fmtQty, signClass } from '../format';
import type { FillRow } from '../types';

interface PnlData {
  realizedByDay: { day: string; usd: number }[];
  realizedBySymbol: { symbol: string; usd: number }[];
  feesByAsset: { asset: string; amount: number }[];
  equitySnapshots: { ts: number; totalUsdt: number }[];
  integrity: {
    complete: boolean;
    reasons: string[];
    days: { day: string; complete: boolean; reasons: string[]; feeUsd: number; netUsd: number }[];
  };
}

type Lens = 'realized' | 'equity' | 'costs';

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
}

function feeText(fees: { asset: string; amount: number }[]): string {
  if (fees.length === 0) return 'no fees yet';
  if (fees.length === 1) return `${fmtQty(fees[0].amount)} ${fees[0].asset}`;
  return `${fees.length} assets`;
}

function cumulative(days: { day: string; usd: number }[]): number[] {
  let running = 0;
  return days.map((d) => {
    running += d.usd;
    return running;
  });
}

function DayBars({ days }: { days: { day: string; usd: number }[] }) {
  const recent = days.slice(-30);
  const maxAbs = Math.max(1e-9, ...recent.map((d) => Math.abs(d.usd)));
  if (recent.length === 0) {
    return (
      <div className="lg-empty-pad">
        <Empty title="No realized days yet">Day bars appear after the first sell fill closes inventory.</Empty>
      </div>
    );
  }
  return (
    <div className="pnl-day-bars">
      {recent.map((d) => {
        const size = Math.max(5, (Math.abs(d.usd) / maxAbs) * 100);
        return (
          <button key={d.day} className={`pnl-day-col ${d.usd >= 0 ? 'pos' : 'neg'}`} type="button" title={`${d.day}: ${fmtPrice(d.usd)}`}>
            <span className="pnl-day-value num">{fmtPrice(d.usd)}</span>
            <span className="pnl-day-track">
              <i style={{ height: `${size}%` }} />
            </span>
            <span className="pnl-day-label num">{d.day.slice(5)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Pnl() {
  const { setPage, openDetail, prefs } = useStore();
  const [data, setData] = useState<PnlData | null>(null);
  const [fills, setFills] = useState<FillRow[] | null>(null);
  const [lens, setLens] = useState<Lens>('realized');
  const [refreshTick, setRefreshTick] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  useRefreshSignal(() => setRefreshTick((n) => n + 1));

  useEffect(() => {
    const poll = createSettledPoll<[
      PromiseSettledResult<PnlData>,
      PromiseSettledResult<FillRow[]>,
    ]>({
      intervalMs: Math.max(0.5, prefs.dataCadence?.account ?? 30) * 1_000,
      request: (signal) => Promise.allSettled([
        fetchJson<PnlData>('/api/pnl', { cache: 'no-store', signal }),
        fetchJson<FillRow[]>('/api/fills', { cache: 'no-store', signal }),
      ]) as Promise<[PromiseSettledResult<PnlData>, PromiseSettledResult<FillRow[]>]>,
      onSuccess: ([pnlResult, fillsResult]) => {
        const failures: string[] = [];
        if (pnlResult.status === 'fulfilled') setData(pnlResult.value);
        else failures.push(`PnL: ${apiErrorMessage(pnlResult.reason)}`);
        if (fillsResult.status === 'fulfilled') setFills(fillsResult.value);
        else failures.push(`Fills: ${apiErrorMessage(fillsResult.reason)}`);
        setLoadError(failures.length ? failures.join(' · ') : null);
      },
    });
    poll.start();
    return poll.stop;
  }, [refreshTick, prefs.dataCadence?.account]);

  const days = data?.realizedByDay ?? [];
  const symbols = data?.realizedBySymbol ?? [];
  const fees = data?.feesByAsset ?? [];
  const fillRows = fills ?? [];
  const todayKey = new Date().toISOString().slice(0, 10);
  const realizedToday = data?.realizedByDay.find((d) => d.day === todayKey)?.usd ?? null;
  const totalRealized = data ? sum(days.map((d) => d.usd)) : null;
  const wins = days.filter((d) => d.usd > 0).length;
  const losses = days.filter((d) => d.usd < 0).length;
  const quoteTraded = fills ? sum(fillRows.map((f) => f.quoteQty)) : null;
  const curve = useMemo(() => cumulative(days), [days]);

  return (
    <>
      <div className="hp-stats exec-stats">
        <div className="hp-stat">
          <span className="k">Realized today</span>
          <span className={`v ${realizedToday === null ? '' : signClass(realizedToday)}`}>
            <Num value={realizedToday}>{realizedToday === null ? '—' : fmtPrice(realizedToday)}</Num>
          </span>
          <span className="s">{data ? 'Durable ledger evidence only' : 'Outcome truth unavailable'}</span>
        </div>
        <div className="hp-stat">
          <span className="k">{data === null ? 'Realized Evidence' : data.integrity.complete === false ? 'Partial Realized' : 'Realized All-Time'}</span>
          <span className={`v ${totalRealized === null ? '' : signClass(totalRealized)}`}>{totalRealized === null ? '—' : fmtPrice(totalRealized)}</span>
          <span className="s" title={data?.integrity.reasons.join(' · ') || undefined}>{data === null ? 'Unknown until the durable outcome read responds' : data.integrity.complete === false ? 'Incomplete cost or fee basis' : `${days.length} PnL day${days.length === 1 ? '' : 's'} · ${wins}W / ${losses}L`}</span>
        </div>
        <div className="hp-stat">
          <span className="k">Equity change</span>
          <span className="v">—</span>
          <span className="s">Private account snapshots NOT_CONFIGURED</span>
        </div>
        <div className="hp-stat">
          <span className="k">Max drawdown</span>
          <span className="v">—</span>
          <span className="s">Unknown without the canonical equity owner</span>
        </div>
      </div>

      <div className="lg-filters">
        <Seg
          value={lens}
          options={[
            { id: 'realized', label: 'Realized' },
            { id: 'equity', label: 'Equity' },
            { id: 'costs', label: 'Costs' },
          ]}
          onChange={setLens}
        />
        <span className="pnl-lens-note">
          {loadError
            ? `Unavailable or stale · ${loadError}`
            : lens === 'realized'
            ? 'avg-cost from ledgered fills'
            : lens === 'equity'
              ? 'private account equity is owner gated'
              : 'recorded commissions only; private funding and borrow are owner gated'}
        </span>
      </div>

      <section className="hp-group lg-feed" aria-label="PnL chart">
        <div className="lg-feed-head">
          <h3>{lens === 'realized' ? 'Realized PnL' : lens === 'equity' ? 'Equity curve' : 'Cost attribution'}</h3>
          <span className="hp-val">
            {lens === 'realized'
              ? fills && quoteTraded !== null ? `${fmtMoney(quoteTraded)} traded · ${fills.length} fills` : 'Local Fill Evidence Unavailable'
              : lens === 'equity'
                ? 'NOT_CONFIGURED'
                : data ? feeText(fees) : 'UNKNOWN'}
          </span>
        </div>

        {lens === 'realized' && (
          <div className="pnl-chart-pad">
            {data ? (
              <>
                {curve.length > 1 ? (
                  <div className="pnl-curve">
                    <SparkArea values={curve} color={(totalRealized ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'} dots endDot />
                  </div>
                ) : null}
                <DayBars days={days} />
              </>
            ) : (
              <Empty title="Realized Outcome Evidence Is Unavailable">
                The app does not convert an unavailable durable outcome read into a zero-PnL claim.
              </Empty>
            )}
          </div>
        )}

        {lens === 'equity' && (
          <div className="pnl-chart-pad">
            <Empty title="Private Equity Truth Is Not Configured">
              Legacy account payloads are not accepted as equity evidence. No curve or drawdown is inferred until the canonical private owner is mounted.
            </Empty>
          </div>
        )}

        {lens === 'costs' && (
          <div className="pnl-costs">
            <div>
              <span className="k">Commissions</span>
              <b>{data ? feeText(fees) : 'Unknown'}</b>
              <em>{data ? fees.length ? 'from recorded fills' : 'no commissions in the available durable evidence' : 'durable commission evidence unavailable'}</em>
            </div>
            <div>
              <span className="k">Funding</span>
              <b>Not Configured</b>
              <em>Private USD-M funding attribution requires an accepted owner.</em>
            </div>
            <div>
              <span className="k">Borrow interest</span>
              <b>Owner Gated</b>
              <em>Margin and loan attribution remains unavailable without canonical liability truth.</em>
            </div>
          </div>
        )}
      </section>

      <div className="lg-grid pnl-grid">
        <section className="hp-group lg-feed" aria-label="Symbol attribution">
          <div className="lg-feed-head">
            <h3>Symbol attribution</h3>
            <span>{symbols.length ? `${symbols.length} symbols` : 'empty'}</span>
          </div>
          {symbols.length === 0 ? (
            <div className="lg-empty-pad">
              <Empty title={data ? 'No Closed Symbol PnL' : 'Symbol Attribution Is Unavailable'}>{data ? 'No durable fill evidence currently closes inventory with a verified cost basis.' : 'The app will not infer empty attribution while the outcome read is unavailable.'}</Empty>
            </div>
          ) : (
            <div className="hp-table-wrap">
              <table className="hp-table">
                <colgroup>
                  <col />
                  <col style={{ width: 130 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="num-r">Realized</th>
                  </tr>
                </thead>
                <tbody>
                  {symbols.slice(0, 10).map((r) => (
                    <tr key={r.symbol} onClick={() => openDetail(r.symbol)}>
                      <td className="t-source">
                        <span className="exec-sym">
                          <TokenIcon symbol={r.symbol} size={16} />
                          {baseOf(r.symbol)}
                        </span>
                      </td>
                      <td className={`t-value num-r ${signClass(r.usd)}`}>{fmtPrice(r.usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="hp-group lg-feed" aria-label="Recent fills">
          <div className="lg-feed-head">
            <h3>Recent fills</h3>
            <button className="hp-btn" type="button" onClick={() => setPage('fills')}>Open fills</button>
          </div>
          {fills === null || fillRows.length === 0 ? (
            <div className="lg-empty-pad">
              <Empty title={fills ? 'No Durable Fills Recorded' : 'Fill Evidence Is Unavailable'}>{fills ? 'This view shows only fills already present in the durable ledger.' : 'No private fill source is inferred, and unavailable evidence is not reported as zero.'}</Empty>
            </div>
          ) : (
            <div className="hp-table-wrap">
              <table className="hp-table">
                <colgroup>
                  <col style={{ width: 140 }} />
                  <col />
                  <col style={{ width: 110 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Fill</th>
                    <th>Time · source</th>
                    <th className="num-r">Notional</th>
                  </tr>
                </thead>
                <tbody>
                  {fillRows.slice(0, 8).map((f) => (
                    <tr key={`${f.symbol}-${f.tradeId}`} onClick={() => openDetail(f.symbol)}>
                      <td className="t-source">
                        <span className="exec-sym">
                          <TokenIcon symbol={f.symbol} size={16} />
                          <Pill tone={f.side === 'BUY' ? 'ok' : 'bad'}>{f.side === 'BUY' ? 'Buy' : 'Sell'}</Pill>
                          {baseOf(f.symbol)}
                        </span>
                      </td>
                      <td className="t-detail">{fmtDateTime(f.ts)} · {f.source}</td>
                      <td className="t-value num-r">{fmtPrice(f.quoteQty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
