import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useStore } from '../store';
import { TokenIcon } from '../components/TokenIcon';
import { ConfirmModal } from '../components/Modal';
import { StatTile, EmptyState, SetupChecklist, StatusDot } from '../components/ui';
import { fmtQty, fmtPct, fmtDateTime, timeAgo, baseOf } from '../format';
import type { LoansSnapshot, Proposal, TicketPrefill } from '../types';

async function post<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function Loans() {
  const { state, openTicket } = useStore();
  const [tab, setTab] = useState<'flexible' | 'margin'>('flexible');
  const [snap, setSnap] = useState<LoansSnapshot | null>(null);
  const [borrowChecks, setBorrowChecks] = useState<Record<string, string>>({});
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

      <div className="atabs">
        <button className={`atab ${tab === 'flexible' ? 'on' : ''}`} onClick={() => setTab('flexible')}>
          Flexible loans
        </button>
        <button className={`atab ${tab === 'margin' ? 'on' : ''}`} onClick={() => setTab('margin')}>
          Cross margin &amp; borrowability
        </button>
      </div>

      {tab === 'margin' ? (
        <MarginTab
          snap={snap}
          keysPresent={keysPresent}
          borrowChecks={borrowChecks}
          setBorrowChecks={setBorrowChecks}
          openTicket={openTicket}
          proposals={state?.proposals ?? []}
        />
      ) : !keysPresent ? (
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

function MarginTab({
  snap,
  keysPresent,
  borrowChecks,
  setBorrowChecks,
  openTicket,
  proposals,
}: {
  snap: LoansSnapshot | null;
  keysPresent: boolean;
  borrowChecks: Record<string, string>;
  setBorrowChecks: Dispatch<SetStateAction<Record<string, string>>>;
  openTicket: (t: TicketPrefill) => void;
  proposals: Proposal[];
}) {
  const margin = snap?.margin;
  const reverse = proposals.filter((p) => p.side === 'LONG_PERP_SHORT_SPOT');

  const checkBorrowable = async (asset: string) => {
    setBorrowChecks((c) => ({ ...c, [asset]: 'checking…' }));
    try {
      const res = await fetch(`/api/loans/max-borrowable?asset=${asset}`);
      const d = (await res.json()) as { ok: boolean; amount?: number; borrowLimit?: number; error?: string };
      setBorrowChecks((c) => ({
        ...c,
        [asset]: d.ok ? `max ${fmtQty(d.amount)} (limit ${fmtQty(d.borrowLimit)})` : `unavailable: ${d.error}`,
      }));
    } catch {
      setBorrowChecks((c) => ({ ...c, [asset]: 'network error' }));
    }
  };

  if (!keysPresent || !margin || !margin.available) {
    return (
      <>
        <div className="ghost-tile">
          <StatusDot status="none" />
          <div>
            <div className="gt-title">Cross margin not connected</div>
            <div className="gt-sub">
              {margin?.error ??
                'Margin data needs API keys with margin permission (withdrawals stay disabled). Once connected: liabilities, interest, borrow limits and per-asset max-borrowable checks appear here.'}
            </div>
            {!keysPresent && <SetupChecklist />}
          </div>
          <span className="gt-badge">{keysPresent ? 'permission' : 'setup'}</span>
        </div>
        {reverse.length > 0 && (
          <>
            <div className="sec-head">
              <h2 className="sec-title">Reverse-basis proposals waiting on borrow</h2>
              <span className="sec-note">these need a borrowed spot leg — borrowability unverifiable without keys</span>
            </div>
            {reverse.map((p) => (
              <div key={p.id} className="xrow">
                <TokenIcon symbol={p.symbol} size={26} />
                <span>
                  <div className="k">{p.symbol}</div>
                  <div className="t">basis {p.basisNow.toFixed(2)}% · Long perp · Short spot (borrow {baseOf(p.symbol)})</div>
                </span>
                <span className="v muted small">borrow not checkable</span>
              </div>
            ))}
          </>
        )}
      </>
    );
  }

  return (
    <>
      <div className="metric-strip">
        <div className="metric">
          <span className="k">Borrow enabled</span>
          <span className={`v ${margin.borrowEnabled ? 'up' : 'down'}`}>{margin.borrowEnabled ? 'yes' : 'no'}</span>
        </div>
        <div className="metric">
          <span className="k">Margin level</span>
          <span className={`v num ${margin.marginLevel !== null && margin.marginLevel < 1.5 ? 'down' : ''}`}>
            {margin.marginLevel?.toFixed(2) ?? '—'}
          </span>
          <span className="s">&lt;1.3 margin call · &lt;1.1 liquidation</span>
        </div>
        <div className="metric">
          <span className="k">Liability (BTC)</span>
          <span className="v num">{margin.totalLiabilityBtc.toFixed(8)}</span>
        </div>
        <div className="metric">
          <span className="k">Net asset (BTC)</span>
          <span className="v num">{margin.totalNetAssetBtc.toFixed(8)}</span>
        </div>
      </div>

      <div className="sec-head">
        <h2 className="sec-title">Reverse-basis eligibility</h2>
        <span className="sec-note">proposals needing a borrowed spot leg · check live max borrowable</span>
      </div>
      {reverse.length === 0 ? (
        <EmptyState title="No reverse-basis proposals right now">
          When the basis monitor proposes “Long perp · Short spot”, the borrow check for the base asset happens here
          before you consider the trade.
        </EmptyState>
      ) : (
        reverse.map((p) => {
          const asset = baseOf(p.symbol);
          return (
            <div key={p.id} className="xrow">
              <TokenIcon symbol={p.symbol} size={26} />
              <span>
                <div className="k">{p.symbol}</div>
                <div className="t">basis {p.basisNow.toFixed(2)}% · needs borrowed {asset}</div>
              </span>
              <span className="v">
                {borrowChecks[asset] ? (
                  <span className="muted small">{borrowChecks[asset]}</span>
                ) : (
                  <button className="mini-btn" onClick={() => void checkBorrowable(asset)}>
                    Check borrowable
                  </button>
                )}
                <button className="mini-btn" style={{ marginLeft: 8 }} onClick={() => openTicket({ symbol: p.symbol, side: 'SELL', source: 'proposal' })}>
                  Ticket →
                </button>
              </span>
            </div>
          );
        })
      )}

      <div className="sec-head">
        <h2 className="sec-title">Margin balances &amp; liabilities</h2>
      </div>
      {margin.assets.length === 0 ? (
        <EmptyState title="No margin balances" />
      ) : (
        <div className="table-scroll">
          <table className="mkt dense">
            <thead>
              <tr>
                <th className="l">Asset</th>
                <th>Free</th>
                <th>Borrowed</th>
                <th>Interest</th>
                <th>Net</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {margin.assets.map((a) => (
                <tr key={a.asset}>
                  <td className="l">
                    <span className="tok">
                      <TokenIcon symbol={`${a.asset}USDT`} size={26} />
                      <span className="tok-name">{a.asset}</span>
                    </span>
                  </td>
                  <td><span className="num">{fmtQty(a.free)}</span></td>
                  <td className={a.borrowed > 0 ? 'down' : 'muted'}><span className="num">{a.borrowed ? fmtQty(a.borrowed) : '—'}</span></td>
                  <td className={a.interest > 0 ? 'down' : 'muted'}><span className="num">{a.interest ? fmtQty(a.interest) : '—'}</span></td>
                  <td className="val-strong"><span className="num">{fmtQty(a.netAsset)}</span></td>
                  <td>
                    {!borrowChecks[a.asset] ? (
                      <button className="mini-btn" onClick={() => void checkBorrowable(a.asset)}>
                        Max borrowable
                      </button>
                    ) : (
                      <span className="muted small">{borrowChecks[a.asset]}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="sec-head">
        <h2 className="sec-title">Interest &amp; borrow history</h2>
        <span className="sec-note">last 50 records each</span>
      </div>
      {margin.interestHistory.length === 0 && margin.borrowRecords.length === 0 && margin.repayRecords.length === 0 ? (
        <EmptyState title="No margin history">Interest accruals and borrow/repay records appear once margin is used.</EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="mkt dense">
            <thead>
              <tr>
                <th className="l">Time</th>
                <th className="l">Type</th>
                <th className="l">Asset</th>
                <th>Amount</th>
                <th className="l">Detail</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...margin.interestHistory.map((r) => ({ ts: r.ts, type: 'interest', asset: r.asset, amount: r.interest, detail: `rate ${r.rate}` })),
                ...margin.borrowRecords.map((r) => ({ ts: r.ts, type: 'borrow', asset: r.asset, amount: r.amount, detail: r.status })),
                ...margin.repayRecords.map((r) => ({ ts: r.ts, type: 'repay', asset: r.asset, amount: r.amount, detail: r.status })),
              ]
                .sort((a, b) => b.ts - a.ts)
                .slice(0, 50)
                .map((r, i) => (
                  <tr key={i}>
                    <td className="l muted">{fmtDateTime(r.ts)}</td>
                    <td className="l">
                      <span className={`chip-tag ${r.type === 'interest' ? 'bad' : r.type === 'borrow' ? 'gold' : 'ok'}`}>{r.type}</span>
                    </td>
                    <td className="l val-strong">{r.asset}</td>
                    <td><span className="num">{fmtQty(r.amount)}</span></td>
                    <td className="l muted small">{r.detail}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
