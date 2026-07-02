import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { TokenIcon } from '../components/TokenIcon';
import { ConfirmModal } from '../components/Modal';
import { StatTile, EmptyState, SetupChecklist } from '../components/ui';
import { fmtQty, fmtPct, timeAgo } from '../format';
import type { LoansSnapshot } from '../types';

async function post<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function Loans() {
  const { state } = useStore();
  const [snap, setSnap] = useState<LoansSnapshot | null>(null);
  const [borrowFor, setBorrowFor] = useState<{ coin: string; min: number; max: number } | null>(null);
  const [repayFor, setRepayFor] = useState<{ loanCoin: string; collateralCoin: string; debt: number } | null>(null);
  const [collateralCoin, setCollateralCoin] = useState('USDT');
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const load = (force = false) =>
    fetch(`/api/loans${force ? '?force=1' : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSnap(d as LoansSnapshot))
      .catch(() => undefined);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, []);

  const keysPresent = state?.binance.keysPresent ?? false;
  const mode = state?.mode ?? 'HALTED';
  const totalDebt = snap?.ongoing.reduce((s, o) => s + o.totalDebt, 0) ?? 0;
  const maxLtv = snap?.ongoing.reduce((s, o) => Math.max(s, o.currentLTV), 0) ?? 0;
  const loanable = (snap?.loanable ?? []).filter((l) => !search || l.loanCoin.includes(search.toUpperCase()));

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Loans</h1>
          <div className="page-sub">
            Binance flexible crypto loans — borrow against collateral for the reverse-basis leg (short spot needs
            borrowed coins). Borrow/repay follow the same gate as trading.
          </div>
        </div>
        <div className="head-actions">
          <button className="mini-btn" onClick={() => void load(true)}>
            Refresh
          </button>
          {snap?.fetchedAt && <span className="sec-note">updated {timeAgo(snap.fetchedAt)}</span>}
        </div>
      </div>

      {!keysPresent ? (
        <div className="ghost-tile">
          <div>
            <div className="gt-title">Loans need API keys</div>
            <div className="gt-sub">
              Loan data is account-scoped on Binance — there is no public endpoint. Connect read keys to see
              loanable assets, rates, collateral requirements and your ongoing loans.
            </div>
            <SetupChecklist />
          </div>
          <span className="gt-badge">setup</span>
        </div>
      ) : snap && !snap.available ? (
        <div className="ghost-tile">
          <div>
            <div className="gt-title">Loan data unavailable</div>
            <div className="gt-sub">
              {snap.error ?? 'Unknown error.'} If this mentions permissions, the API key may need the loan/margin
              scope enabled on Binance (withdrawals stay disabled).
            </div>
          </div>
          <span className="gt-badge">error</span>
        </div>
      ) : (
        <>
          <div className="stats">
            <StatTile label="Ongoing loans" value={snap?.ongoing.length ?? '—'} delta="flexible rate" />
            <StatTile label="Total debt" value={snap ? fmtQty(totalDebt) : '—'} delta="sum across loan coins" />
            <StatTile
              label="Highest LTV"
              value={snap ? fmtPct(maxLtv * 100, 1, false) : '—'}
              delta={maxLtv > 0.8 ? 'near liquidation!' : maxLtv > 0.65 ? 'margin-call zone' : 'healthy'}
            />
            <StatTile label="Loanable assets" value={snap?.loanable.length ?? '—'} delta="with live hourly rates" />
          </div>

          {msg && <div className={`result-strip ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}

          <div className="sec-head">
            <h2 className="sec-title">Ongoing loans</h2>
            <span className="sec-note">LTV climbs as collateral falls — repay before liquidation LTV</span>
          </div>
          {(snap?.ongoing.length ?? 0) === 0 ? (
            <EmptyState title="No active loans">Borrow below to open one. It will appear here with live LTV.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table className="mkt">
                <thead>
                  <tr>
                    <th className="l">Loan</th>
                    <th>Debt</th>
                    <th className="l">Collateral</th>
                    <th>Amount</th>
                    <th>Current LTV</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {snap!.ongoing.map((o, i) => (
                    <tr key={i}>
                      <td className="l">
                        <span className="tok">
                          <TokenIcon symbol={`${o.loanCoin}USDT`} size={26} />
                          <span className="tok-name">{o.loanCoin}</span>
                        </span>
                      </td>
                      <td className="val-strong">
                        <span className="num">{fmtQty(o.totalDebt)}</span>
                      </td>
                      <td className="l">
                        <span className="tok">
                          <TokenIcon symbol={`${o.collateralCoin}USDT`} size={22} />
                          <span className="tok-sub">{o.collateralCoin}</span>
                        </span>
                      </td>
                      <td>
                        <span className="num">{fmtQty(o.collateralAmount)}</span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                          <span className={`meter ${o.currentLTV > 0.8 ? 'bad' : o.currentLTV > 0.65 ? 'warn' : ''}`}>
                            <i style={{ width: `${Math.min(o.currentLTV * 100, 100)}%` }} />
                          </span>
                          <span className="num strong">{(o.currentLTV * 100).toFixed(1)}%</span>
                        </span>
                      </td>
                      <td>
                        <button
                          className="mini-btn"
                          onClick={() => {
                            setAmount('');
                            setMsg(null);
                            setRepayFor({ loanCoin: o.loanCoin, collateralCoin: o.collateralCoin, debt: o.totalDebt });
                          }}
                        >
                          Repay…
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="sec-head">
            <h2 className="sec-title">Loanable assets</h2>
            <div className="tsearch">
              <input placeholder="Search coin" value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
            </div>
          </div>
          <div className="table-scroll">
            <table className="mkt dense">
              <thead>
                <tr>
                  <th className="l">Coin</th>
                  <th>Hourly rate</th>
                  <th>APR</th>
                  <th>Min</th>
                  <th>Max</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loanable.slice(0, 40).map((l) => (
                  <tr key={l.loanCoin}>
                    <td className="l">
                      <span className="tok">
                        <TokenIcon symbol={`${l.loanCoin}USDT`} size={26} />
                        <span className="tok-name">{l.loanCoin}</span>
                      </span>
                    </td>
                    <td>
                      <span className="num">{l.hourlyRatePct.toFixed(6)}%</span>
                    </td>
                    <td>
                      <span className="num">{l.yearlyRatePct.toFixed(2)}%</span>
                    </td>
                    <td>
                      <span className="num muted">{fmtQty(l.minLimit)}</span>
                    </td>
                    <td>
                      <span className="num muted">{fmtQty(l.maxLimit)}</span>
                    </td>
                    <td>
                      <button
                        className="mini-btn"
                        disabled={mode !== 'LIVE_ARMED'}
                        title={mode !== 'LIVE_ARMED' ? 'Arm live trading on the Risk page first' : ''}
                        onClick={() => {
                          setAmount('');
                          setMsg(null);
                          setBorrowFor({ coin: l.loanCoin, min: l.minLimit, max: l.maxLimit });
                        }}
                      >
                        Borrow…
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {loanable.length === 0 && <EmptyState title="No loanable assets match" />}

          <div className="sec-head">
            <h2 className="sec-title">Collateral assets</h2>
            <span className="sec-note">initial → margin call → liquidation LTV</span>
          </div>
          <div className="table-scroll">
            <table className="mkt dense">
              <thead>
                <tr>
                  <th className="l">Coin</th>
                  <th>Initial LTV</th>
                  <th>Margin call</th>
                  <th>Liquidation</th>
                  <th>Max limit</th>
                </tr>
              </thead>
              <tbody>
                {(snap?.collateral ?? []).slice(0, 30).map((c) => (
                  <tr key={c.collateralCoin}>
                    <td className="l">
                      <span className="tok">
                        <TokenIcon symbol={`${c.collateralCoin}USDT`} size={26} />
                        <span className="tok-name">{c.collateralCoin}</span>
                      </span>
                    </td>
                    <td>
                      <span className="num">{(c.initialLTV * 100).toFixed(0)}%</span>
                    </td>
                    <td>
                      <span className="num">{(c.marginCallLTV * 100).toFixed(0)}%</span>
                    </td>
                    <td>
                      <span className="num down">{(c.liquidationLTV * 100).toFixed(0)}%</span>
                    </td>
                    <td>
                      <span className="num muted">{fmtQty(c.maxLimit)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {borrowFor && (
        <ConfirmModal
          title={`Borrow ${borrowFor.coin}`}
          requireText={borrowFor.coin}
          confirmLabel="Borrow live"
          danger
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            const res = await post<{ ok: boolean; error?: string }>('/api/loans/borrow', {
              loanCoin: borrowFor.coin,
              collateralCoin,
              amount: Number(amount),
              confirmCoin: borrowFor.coin,
            });
            setBusy(false);
            setBorrowFor(null);
            setMsg(res?.ok ? { ok: true, text: `Borrowed ${amount} ${borrowFor.coin}.` } : { ok: false, text: res?.error ?? 'network error' });
            void load(true);
          }}
          onClose={() => setBorrowFor(null)}
        >
          <div className="fld">
            <span>Amount ({borrowFor.coin})</span>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`min ${borrowFor.min}`} autoFocus />
          </div>
          <div className="fld">
            <span>Collateral coin</span>
            <input value={collateralCoin} onChange={(e) => setCollateralCoin(e.target.value.toUpperCase())} spellCheck={false} />
          </div>
          <div className="result-strip warn">
            Real debt with hourly interest. Gate: kill switch off + live armed + typed confirmation. Everything is
            ledgered.
          </div>
        </ConfirmModal>
      )}

      {repayFor && (
        <ConfirmModal
          title={`Repay ${repayFor.loanCoin}`}
          confirmLabel="Repay"
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            const res = await post<{ ok: boolean; error?: string }>('/api/loans/repay', {
              loanCoin: repayFor.loanCoin,
              collateralCoin: repayFor.collateralCoin,
              amount: Number(amount),
            });
            setBusy(false);
            setRepayFor(null);
            setMsg(res?.ok ? { ok: true, text: `Repaid ${amount} ${repayFor.loanCoin}.` } : { ok: false, text: res?.error ?? 'network error' });
            void load(true);
          }}
          onClose={() => setRepayFor(null)}
        >
          <div className="drow">
            <span className="k">Outstanding debt</span>
            <span className="v num">
              {fmtQty(repayFor.debt)} {repayFor.loanCoin}
            </span>
          </div>
          <div className="fld" style={{ marginTop: 10 }}>
            <span>Repay amount ({repayFor.loanCoin})</span>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}
