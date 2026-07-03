import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useStore } from '../store';
import { TokenIcon } from '../components/TokenIcon';
import { ConfirmModal } from '../components/Modal';
import { EmptyState, SetupChecklist, StatePill, StatTile, StatusDot } from '../components/ui';
import {
  IconAlert,
  IconBook,
  IconChart,
  IconClock,
  IconCoins,
  IconKey,
  IconList,
  IconLock,
  IconPercent,
  IconRadar,
  IconRefresh,
  IconShield,
  IconTicket,
  IconWallet,
} from '../components/Icons';
import { fmtQty, fmtPct, fmtDateTime, timeAgo, baseOf } from '../format';
import type { LoansSnapshot, Proposal, TicketPrefill } from '../types';

type Tone = 'ok' | 'warn' | 'bad' | 'idle';

async function post<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function ltvTone(v: number | null | undefined): Tone {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'idle';
  if (v >= 0.8) return 'bad';
  if (v >= 0.65) return 'warn';
  return 'ok';
}

function pctWidth(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '0%';
  return `${Math.max(0, Math.min(100, v * 100))}%`;
}

function stateText(tone: Tone): string {
  if (tone === 'ok') return 'Ready';
  if (tone === 'warn') return 'Review';
  if (tone === 'bad') return 'Blocked';
  return 'Waiting';
}

export function Loans() {
  const { state, openTicket, setPage } = useStore();
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
  const hasFlexibleData = Boolean(keysPresent && snap?.available);
  const totalDebt = hasFlexibleData ? (snap?.ongoing.reduce((s, o) => s + o.totalDebt, 0) ?? 0) : null;
  const maxLtv = hasFlexibleData ? (snap?.ongoing.reduce((s, o) => Math.max(s, o.currentLTV), 0) ?? 0) : null;
  const loanable = (snap?.loanable ?? []).filter((l) => !search || l.loanCoin.includes(search.toUpperCase()));
  const margin = snap?.margin ?? null;

  const readiness = useMemo(
    () => [
      {
        label: 'Server keys',
        sub: keysPresent ? 'Binance keys are server-side only' : 'Add read keys in .env; no key input belongs in UI',
        tone: keysPresent ? 'ok' : 'bad',
        icon: <IconKey size={16} />,
      },
      {
        label: 'Flexible loan catalog',
        sub: snap?.available ? `${snap.loanable.length} loanable assets from Binance` : 'Loanable, collateral, and ongoing orders need account scope',
        tone: keysPresent ? (snap?.available ? 'ok' : 'warn') : 'idle',
        icon: <IconCoins size={16} />,
      },
      {
        label: 'Cross-margin visibility',
        sub: margin?.available ? 'Borrow limits, liabilities, and interest records are visible' : 'Margin permission unlocks max-borrowable checks',
        tone: keysPresent ? (margin?.available ? 'ok' : 'warn') : 'idle',
        icon: <IconWallet size={16} />,
      },
      {
        label: 'Live borrow gate',
        sub: mode === 'LIVE_ARMED' ? 'Borrow buttons may open typed-confirmation modals' : 'Borrow stays disabled until live trading is armed',
        tone: mode === 'LIVE_ARMED' ? 'ok' : 'bad',
        icon: <IconShield size={16} />,
      },
    ] satisfies { label: string; sub: string; tone: Tone; icon: ReactNode }[],
    [keysPresent, margin?.available, mode, snap?.available, snap?.loanable.length],
  );

  return (
    <div className="container page loans-page">
      <section className="loan-hero card">
        <div className="loan-hero-main">
          <span className="loan-hero-icon">
            <IconCoins size={28} />
          </span>
          <div>
            <div className="loan-kicker">Borrow desk</div>
            <h1 className="page-title">Loans / Borrow</h1>
            <p className="loan-copy">
              Binance Flexible Loan and Cross Margin control surface for reverse-basis trades. No fake rates, no
              placeholder balances: every table is wired to real account endpoints and stays locked until the server can
              read Binance safely.
            </p>
            <div className="loan-hero-pills">
              <StatePill tone={keysPresent ? 'ok' : 'bad'}>{keysPresent ? 'keys present' : 'keys missing'}</StatePill>
              <StatePill tone={mode === 'LIVE_ARMED' ? 'ok' : 'bad'}>{mode.toLowerCase().replace('_', ' ')}</StatePill>
              <StatePill tone={snap?.available ? 'ok' : keysPresent ? 'warn' : 'idle'}>
                {snap?.available ? 'flexible loan online' : keysPresent ? 'loan permission pending' : 'loan data locked'}
              </StatePill>
              {snap?.fetchedAt && <span className="loan-updated">updated {timeAgo(snap.fetchedAt)}</span>}
            </div>
          </div>
        </div>

        <div className="loan-hero-side">
          <div className="loan-hero-actions">
            <button className="mini-btn strong" type="button" onClick={() => void load(true)}>
              <IconRefresh size={14} />
              Refresh
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('risk')}>
              <IconShield size={14} />
              Risk policy
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('ledger')}>
              <IconBook size={14} />
              Loan ledger
            </button>
          </div>
          <div className="loan-hero-metrics">
            <LoanMiniMetric label="Ongoing" value={hasFlexibleData ? snap!.ongoing.length : '—'} sub="flexible loans" />
            <LoanMiniMetric label="Debt" value={hasFlexibleData ? fmtQty(totalDebt) : '—'} sub="loan coin sum" />
            <LoanMiniMetric label="Max LTV" value={hasFlexibleData ? fmtPct((maxLtv ?? 0) * 100, 1, false) : '—'} sub={stateText(ltvTone(maxLtv))} tone={ltvTone(maxLtv)} />
          </div>
        </div>
      </section>

      <div className="loan-readiness card">
        {readiness.map((step) => (
          <div key={step.label} className={`loan-step ${step.tone}`}>
            <span className="loan-step-icon">{step.icon}</span>
            <span className="loan-step-copy">
              <b>{step.label}</b>
              <em>{step.sub}</em>
            </span>
            <span className={`chip-tag ${step.tone === 'ok' ? 'ok' : step.tone === 'bad' ? 'bad' : step.tone === 'warn' ? 'gold' : ''}`}>
              {stateText(step.tone)}
            </span>
          </div>
        ))}
      </div>

      <div className="loan-tabs" role="tablist" aria-label="Loans workspace">
        <button className={`loan-tab ${tab === 'flexible' ? 'on' : ''}`} type="button" onClick={() => setTab('flexible')}>
          <IconCoins size={15} />
          Flexible loans
        </button>
        <button className={`loan-tab ${tab === 'margin' ? 'on' : ''}`} type="button" onClick={() => setTab('margin')}>
          <IconWallet size={15} />
          Cross margin &amp; borrowability
        </button>
      </div>

      {tab === 'margin' ? (
        <MarginTab
          snap={snap}
          keysPresent={keysPresent}
          mode={mode}
          borrowChecks={borrowChecks}
          setBorrowChecks={setBorrowChecks}
          openTicket={openTicket}
          proposals={state?.proposals ?? []}
          setPage={setPage}
        />
      ) : (
        <FlexibleTab
          snap={snap}
          keysPresent={keysPresent}
          mode={mode}
          msg={msg}
          search={search}
          loanable={loanable}
          setSearch={setSearch}
          setBorrowFor={setBorrowFor}
          setRepayFor={setRepayFor}
          setAmount={setAmount}
          setMsg={setMsg}
          setPage={setPage}
          load={load}
        />
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
          <div className="loan-modal-grid">
            <div className="fld">
              <span>Amount ({borrowFor.coin})</span>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`min ${borrowFor.min}`} autoFocus />
            </div>
            <div className="fld">
              <span>Collateral coin</span>
              <input value={collateralCoin} onChange={(e) => setCollateralCoin(e.target.value.toUpperCase())} spellCheck={false} />
            </div>
          </div>
          <div className="loan-modal-note">
            <IconShield size={16} />
            <span>
              Real debt with hourly interest. Gate: kill switch off, live armed, typed coin confirmation, and server-side
              re-check. Every request and response is ledgered.
            </span>
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
          <div className="loan-repay-head">
            <TokenIcon symbol={`${repayFor.loanCoin}USDT`} size={34} />
            <div>
              <span>Outstanding debt</span>
              <b className="num">
                {fmtQty(repayFor.debt)} {repayFor.loanCoin}
              </b>
            </div>
          </div>
          <div className="fld" style={{ marginTop: 12 }}>
            <span>Repay amount ({repayFor.loanCoin})</span>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

function FlexibleTab({
  snap,
  keysPresent,
  mode,
  msg,
  search,
  loanable,
  setSearch,
  setBorrowFor,
  setRepayFor,
  setAmount,
  setMsg,
  setPage,
  load,
}: {
  snap: LoansSnapshot | null;
  keysPresent: boolean;
  mode: string;
  msg: { ok: boolean; text: string } | null;
  search: string;
  loanable: LoansSnapshot['loanable'];
  setSearch: Dispatch<SetStateAction<string>>;
  setBorrowFor: Dispatch<SetStateAction<{ coin: string; min: number; max: number } | null>>;
  setRepayFor: Dispatch<SetStateAction<{ loanCoin: string; collateralCoin: string; debt: number } | null>>;
  setAmount: Dispatch<SetStateAction<string>>;
  setMsg: Dispatch<SetStateAction<{ ok: boolean; text: string } | null>>;
  setPage: (p: 'risk' | 'ledger' | 'settings') => void;
  load: (force?: boolean) => Promise<unknown>;
}) {
  if (!keysPresent) {
    return <LoansLockedShell mode={mode} setPage={setPage} load={load} />;
  }

  if (snap && !snap.available) {
    return (
      <div className="loan-grid loan-grid-locked">
        <article className="loan-panel card loan-panel-span">
          <PanelHead
            icon={<IconAlert size={16} />}
            title="Loan data unavailable"
            note={snap.error ?? 'Unknown error returned by the loan service.'}
            right={<span className="chip-tag bad">permission</span>}
          />
          <p className="loan-copy tight">
            Binance loan data is account-scoped. If the error mentions permission, the API key needs loan/margin read
            access on Binance. Withdrawals must remain disabled; this UI never asks for keys in the browser.
          </p>
          <div className="loan-action-row">
            <button className="mini-btn strong" type="button" onClick={() => void load(true)}>
              <IconRefresh size={14} />
              Retry
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('settings')}>
              <IconKey size={14} />
              Setup
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('ledger')}>
              <IconBook size={14} />
              Check ledger
            </button>
          </div>
        </article>
        <LoanReadinessCard title="Fields waiting for Binance" />
      </div>
    );
  }

  return (
    <>
      {msg && <div className={`result-strip ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}

      <div className="loan-stat-grid">
        <StatTile label="Ongoing loans" value={snap?.ongoing.length ?? '—'} delta="Binance flexible loan orders" />
        <StatTile label="Total debt" value={snap ? fmtQty(snap.ongoing.reduce((s, o) => s + o.totalDebt, 0)) : '—'} delta="sum across loan coins" />
        <StatTile
          label="Highest LTV"
          value={snap ? fmtPct((snap.ongoing.reduce((s, o) => Math.max(s, o.currentLTV), 0) ?? 0) * 100, 1, false) : '—'}
          delta="repay before margin-call LTV"
        />
        <StatTile label="Loanable assets" value={snap?.loanable.length ?? '—'} delta="live hourly rates" />
      </div>

      <section className="loan-table-card card">
        <PanelHead
          icon={<IconRadar size={16} />}
          title="Ongoing loans"
          note="LTV climbs as collateral falls. Repay before margin-call or liquidation thresholds."
          right={<span className="chip-tag">live account</span>}
        />
        {(snap?.ongoing.length ?? 0) === 0 ? (
          <EmptyState title="No active flexible loans">
            Borrowed spot legs will appear here with loan coin, collateral coin, total debt, current LTV, and repay action.
          </EmptyState>
        ) : (
          <div className="active-loans">
            {snap!.ongoing.map((o, i) => (
              <article key={i} className="active-loan-card">
                <div className="active-loan-top">
                  <span className="tok">
                    <TokenIcon symbol={`${o.loanCoin}USDT`} size={34} />
                    <span className="tok-meta">
                      <span className="tok-name">{o.loanCoin}</span>
                      <span className="tok-sub">debt against {o.collateralCoin}</span>
                    </span>
                  </span>
                  <button
                    className="mini-btn"
                    type="button"
                    onClick={() => {
                      setAmount('');
                      setMsg(null);
                      setRepayFor({ loanCoin: o.loanCoin, collateralCoin: o.collateralCoin, debt: o.totalDebt });
                    }}
                  >
                    Repay
                  </button>
                </div>
                <div className="loan-card-values">
                  <LoanValue label="Debt" value={fmtQty(o.totalDebt)} />
                  <LoanValue label="Collateral" value={`${fmtQty(o.collateralAmount)} ${o.collateralCoin}`} />
                </div>
                <LtvMeter value={o.currentLTV} />
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="loan-table-card card">
        <PanelHead
          icon={<IconPercent size={16} />}
          title="Loanable assets"
          note="Live Flexible Loan catalog: hourly interest, APR, and Binance min/max limits."
          right={
            <div className="tsearch">
              <input placeholder="Search coin" value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
            </div>
          }
        />
        <div className="table-scroll">
          <table className="mkt dense loan-market-table">
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
              {loanable.slice(0, 48).map((l) => (
                <tr key={l.loanCoin}>
                  <td className="l">
                    <span className="tok">
                      <TokenIcon symbol={`${l.loanCoin}USDT`} size={28} />
                      <span className="tok-name">{l.loanCoin}</span>
                    </span>
                  </td>
                  <td>
                    <span className="num">{l.hourlyRatePct.toFixed(6)}%</span>
                  </td>
                  <td>
                    <span className="num strong">{l.yearlyRatePct.toFixed(2)}%</span>
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
                      type="button"
                      onClick={() => {
                        setAmount('');
                        setMsg(null);
                        setBorrowFor({ coin: l.loanCoin, min: l.minLimit, max: l.maxLimit });
                      }}
                    >
                      Borrow
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loanable.length === 0 && <EmptyState title="No loanable assets match" />}
      </section>

      <section className="loan-table-card card">
        <PanelHead
          icon={<IconShield size={16} />}
          title="Collateral schedule"
          note="Initial LTV, margin-call LTV, liquidation LTV, and max collateral limits from Binance."
        />
        {(snap?.collateral.length ?? 0) === 0 ? (
          <EmptyState title="No collateral schedule returned" />
        ) : (
          <div className="collateral-grid">
            {(snap?.collateral ?? []).slice(0, 30).map((c) => (
              <article key={c.collateralCoin} className="collateral-card">
                <div className="active-loan-top">
                  <span className="tok">
                    <TokenIcon symbol={`${c.collateralCoin}USDT`} size={30} />
                    <span className="tok-name">{c.collateralCoin}</span>
                  </span>
                  <span className="num muted">{fmtQty(c.maxLimit)}</span>
                </div>
                <div className="ltv-ladder">
                  <span style={{ width: pctWidth(c.initialLTV) }} />
                  <span style={{ width: pctWidth(Math.max(c.marginCallLTV - c.initialLTV, 0)) }} />
                  <span style={{ width: pctWidth(Math.max(c.liquidationLTV - c.marginCallLTV, 0)) }} />
                </div>
                <div className="collateral-stats">
                  <LoanValue label="Initial" value={`${(c.initialLTV * 100).toFixed(0)}%`} />
                  <LoanValue label="Call" value={`${(c.marginCallLTV * 100).toFixed(0)}%`} />
                  <LoanValue label="Liq." value={`${(c.liquidationLTV * 100).toFixed(0)}%`} tone="bad" />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function MarginTab({
  snap,
  keysPresent,
  mode,
  borrowChecks,
  setBorrowChecks,
  openTicket,
  proposals,
  setPage,
}: {
  snap: LoansSnapshot | null;
  keysPresent: boolean;
  mode: string;
  borrowChecks: Record<string, string>;
  setBorrowChecks: Dispatch<SetStateAction<Record<string, string>>>;
  openTicket: (t: TicketPrefill) => void;
  proposals: Proposal[];
  setPage: (p: 'risk' | 'ledger' | 'settings') => void;
}) {
  const margin = snap?.margin;
  const reverse = proposals.filter((p) => p.side === 'LONG_PERP_SHORT_SPOT');

  const checkBorrowable = async (asset: string) => {
    setBorrowChecks((c) => ({ ...c, [asset]: 'checking...' }));
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
      <div className="loan-grid loan-grid-locked">
        <article className="loan-panel card">
          <PanelHead
            icon={<IconWallet size={16} />}
            title="Cross-margin cockpit locked"
            note={
              margin?.error ??
              'Margin data needs Binance API keys with margin permission. Withdrawals stay disabled and keys never enter the frontend.'
            }
            right={<span className="chip-tag gold">{keysPresent ? 'permission' : 'setup'}</span>}
          />
          <div className="loan-state-stack">
            <LoanStateRow icon={<IconKey size={15} />} label="API key" value={keysPresent ? 'Present' : 'Missing'} tone={keysPresent ? 'ok' : 'bad'} />
            <LoanStateRow icon={<IconShield size={15} />} label="Live borrow" value={mode === 'LIVE_ARMED' ? 'Armed' : 'Blocked'} tone={mode === 'LIVE_ARMED' ? 'ok' : 'bad'} />
            <LoanStateRow icon={<IconBook size={15} />} label="Audit trail" value="Loan events route to ledger" tone="ok" />
          </div>
          {!keysPresent && <SetupChecklist />}
        </article>

        <article className="loan-panel card">
          <PanelHead
            icon={<IconRadar size={16} />}
            title="Reverse-basis borrow queue"
            note="Only scanner proposals that need a borrowed spot leg show here."
            right={<span className="chip-tag">{reverse.length}</span>}
          />
          {reverse.length === 0 ? (
            <EmptyState title="No reverse-basis proposals waiting">
              When the scanner finds Long perp / Short spot, this panel checks whether the base asset can be borrowed.
            </EmptyState>
          ) : (
            <div className="loan-proposal-list">
              {reverse.map((p) => (
                <ProposalRow key={p.id} proposal={p} status="borrow not checkable without margin visibility" />
              ))}
            </div>
          )}
        </article>

        <LoanReadinessCard title="Margin fields waiting for Binance" margin />

        <article className="loan-panel card loan-panel-span">
          <PanelHead icon={<IconList size={16} />} title="Ready once connected" note="No UI redesign should be needed after keys are added." />
          <div className="loan-slot-grid">
            <LoanSlot title="Account health" detail="margin level, total assets, liabilities, net BTC value" />
            <LoanSlot title="Per-asset liabilities" detail="free, locked, borrowed, interest, net asset" />
            <LoanSlot title="Max borrowable check" detail="asset-specific endpoint used before reverse-basis tickets" />
            <LoanSlot title="Interest and records" detail="interest accrual, borrow history, repay history" />
          </div>
        </article>
      </div>
    );
  }

  return (
    <>
      <section className="loan-margin-summary card">
        <PanelHead icon={<IconChart size={16} />} title="Cross-margin account" note="Live Binance account health and liability view." />
        <div className="loan-margin-metrics">
          <LoanMiniMetric label="Borrow enabled" value={margin.borrowEnabled ? 'Yes' : 'No'} sub="Binance account flag" tone={margin.borrowEnabled ? 'ok' : 'bad'} />
          <LoanMiniMetric
            label="Margin level"
            value={margin.marginLevel?.toFixed(2) ?? '—'}
            sub="<1.3 call / <1.1 liquidation"
            tone={margin.marginLevel !== null && margin.marginLevel < 1.5 ? 'bad' : 'ok'}
          />
          <LoanMiniMetric label="Liability BTC" value={margin.totalLiabilityBtc.toFixed(8)} sub="borrowed + interest" />
          <LoanMiniMetric label="Net BTC" value={margin.totalNetAssetBtc.toFixed(8)} sub="account net asset" />
        </div>
      </section>

      <section className="loan-table-card card">
        <PanelHead
          icon={<IconRadar size={16} />}
          title="Reverse-basis eligibility"
          note="For each Long perp / Short spot proposal, check live max-borrowable before opening a ticket."
          right={<button className="mini-btn" type="button" onClick={() => setPage('risk')}><IconShield size={14} />Risk</button>}
        />
        {reverse.length === 0 ? (
          <EmptyState title="No reverse-basis proposals right now">
            When the basis monitor proposes Long perp / Short spot, the borrow check for the base asset happens here
            before you consider the trade.
          </EmptyState>
        ) : (
          <div className="loan-proposal-list">
            {reverse.map((p) => {
              const asset = baseOf(p.symbol);
              return (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  status={borrowChecks[asset] ?? 'not checked'}
                  action={
                    <>
                      {!borrowChecks[asset] && (
                        <button className="mini-btn" type="button" onClick={() => void checkBorrowable(asset)}>
                          Check borrowable
                        </button>
                      )}
                      <button className="mini-btn" type="button" onClick={() => openTicket({ symbol: p.symbol, side: 'SELL', source: 'proposal' })}>
                        <IconTicket size={14} />
                        Ticket
                      </button>
                    </>
                  }
                />
              );
            })}
          </div>
        )}
      </section>

      <section className="loan-table-card card">
        <PanelHead icon={<IconWallet size={16} />} title="Margin balances & liabilities" note="Per-asset free balance, borrowed amount, accrued interest, and net asset." />
        {margin.assets.length === 0 ? (
          <EmptyState title="No margin balances" />
        ) : (
          <div className="table-scroll">
            <table className="mkt dense loan-market-table">
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
                        <TokenIcon symbol={`${a.asset}USDT`} size={28} />
                        <span className="tok-name">{a.asset}</span>
                      </span>
                    </td>
                    <td><span className="num">{fmtQty(a.free)}</span></td>
                    <td className={a.borrowed > 0 ? 'down' : 'muted'}><span className="num">{a.borrowed ? fmtQty(a.borrowed) : '—'}</span></td>
                    <td className={a.interest > 0 ? 'down' : 'muted'}><span className="num">{a.interest ? fmtQty(a.interest) : '—'}</span></td>
                    <td className="val-strong"><span className="num">{fmtQty(a.netAsset)}</span></td>
                    <td>
                      {!borrowChecks[a.asset] ? (
                        <button className="mini-btn" type="button" onClick={() => void checkBorrowable(a.asset)}>
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
      </section>

      <section className="loan-table-card card">
        <PanelHead icon={<IconClock size={16} />} title="Interest & borrow history" note="Last 50 interest, borrow, and repay records." />
        {margin.interestHistory.length === 0 && margin.borrowRecords.length === 0 && margin.repayRecords.length === 0 ? (
          <EmptyState title="No margin history">Interest accruals and borrow/repay records appear once margin is used.</EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="mkt dense loan-market-table">
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
      </section>
    </>
  );
}

function LoansLockedShell({
  mode,
  setPage,
  load,
}: {
  mode: string;
  setPage: (p: 'risk' | 'ledger' | 'settings') => void;
  load: (force?: boolean) => Promise<unknown>;
}) {
  return (
    <div className="loan-grid loan-grid-locked">
      <article className="loan-panel card">
        <PanelHead
          icon={<IconLock size={16} />}
          title="Flexible Loan cockpit locked"
          note="Binance loan endpoints are signed account endpoints. The UI is ready, but it will not invent loan rates or balances without keys."
          right={<span className="chip-tag bad">keys missing</span>}
        />
        <div className="loan-state-stack">
          <LoanStateRow icon={<IconKey size={15} />} label="Read API key" value="Missing" tone="bad" />
          <LoanStateRow icon={<IconShield size={15} />} label="Borrow permission" value={mode === 'LIVE_ARMED' ? 'Armed after key setup' : 'Blocked'} tone="bad" />
          <LoanStateRow icon={<IconBook size={15} />} label="Ledger" value="Loan requests will be audited" tone="ok" />
        </div>
        <div className="loan-action-row">
          <button className="mini-btn strong" type="button" onClick={() => void load(true)}>
            <IconRefresh size={14} />
            Recheck
          </button>
          <button className="mini-btn" type="button" onClick={() => setPage('settings')}>
            <IconKey size={14} />
            Setup
          </button>
          <button className="mini-btn" type="button" onClick={() => setPage('risk')}>
            <IconShield size={14} />
            Risk gates
          </button>
        </div>
      </article>

      <LoanReadinessCard title="Flexible fields waiting for Binance" />

      <article className="loan-panel card loan-panel-span">
        <PanelHead icon={<IconList size={16} />} title="What appears after keys" note="Prepared around Binance Flexible Loan response fields." />
        <div className="loan-slot-grid">
          <LoanSlot title="Ongoing loans" detail="loan coin, collateral coin, total debt, collateral amount, current LTV, repay action" />
          <LoanSlot title="Loanable catalog" detail="hourly rate, yearly rate, min borrow, max borrow, live borrow modal" />
          <LoanSlot title="Collateral schedule" detail="initial LTV, margin-call LTV, liquidation LTV, max collateral limit" />
          <LoanSlot title="Audit + gating" detail="typed confirmation, kill switch, live armed mode, ledger event for request/response" />
        </div>
      </article>

      <article className="loan-panel card loan-panel-span">
        <PanelHead icon={<IconShield size={16} />} title="Server-only setup checklist" note="No API key fields are added to the browser." />
        <SetupChecklist />
      </article>
    </div>
  );
}

function LoanReadinessCard({ title, margin = false }: { title: string; margin?: boolean }) {
  const rows = margin
    ? [
        ['Margin level', 'risk threshold health from cross-margin account'],
        ['Asset liabilities', 'free, locked, borrowed, interest, net asset'],
        ['Max borrowable', 'asset-level limit checks before reverse-basis tickets'],
        ['History', 'interest, borrow, and repay records'],
      ]
    : [
        ['Ongoing orders', 'loan coin, collateral coin, total debt, current LTV'],
        ['Loanable data', 'hourly rate, APR, min and max borrow limits'],
        ['Collateral data', 'initial, margin-call, and liquidation LTV'],
        ['Borrow / repay', 'typed-confirmation modals that call server gates'],
      ];
  return (
    <article className="loan-panel card">
      <PanelHead icon={<IconChart size={16} />} title={title} note="Real fields, empty until Binance returns them." />
      <div className="loan-preview-table">
        {rows.map(([label, detail]) => (
          <div key={label} className="loan-preview-row">
            <span>{label}</span>
            <b>{detail}</b>
          </div>
        ))}
      </div>
    </article>
  );
}

function PanelHead({ icon, title, note, right }: { icon: ReactNode; title: string; note?: string; right?: ReactNode }) {
  return (
    <div className="loan-panel-head">
      <span className="loan-panel-icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {right && <div className="loan-panel-right">{right}</div>}
    </div>
  );
}

function LoanMiniMetric({ label, value, sub, tone = 'idle' }: { label: string; value: string | number; sub: string; tone?: Tone }) {
  return (
    <div className={`loan-mini-metric ${tone}`}>
      <span>{label}</span>
      <b className="num">{value}</b>
      <em>{sub}</em>
    </div>
  );
}

function LoanValue({ label, value, tone = 'idle' }: { label: string; value: string; tone?: Tone }) {
  return (
    <span className={`loan-value ${tone}`}>
      <em>{label}</em>
      <b className="num">{value}</b>
    </span>
  );
}

function LtvMeter({ value }: { value: number }) {
  const tone = ltvTone(value);
  return (
    <div className={`loan-ltv ${tone}`}>
      <div className="loan-ltv-head">
        <span>Current LTV</span>
        <b className="num">{(value * 100).toFixed(1)}%</b>
      </div>
      <div className="loan-ltv-bar">
        <span style={{ width: pctWidth(value) }} />
      </div>
      <div className="loan-ltv-scale">
        <span>healthy</span>
        <span>margin call</span>
        <span>liquidation</span>
      </div>
    </div>
  );
}

function LoanStateRow({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: Tone }) {
  return (
    <div className={`loan-state-row ${tone}`}>
      <span>{icon}</span>
      <b>{label}</b>
      <em>{value}</em>
    </div>
  );
}

function LoanSlot({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="loan-slot">
      <span className="loan-slot-dot" />
      <b>{title}</b>
      <em>{detail}</em>
    </div>
  );
}

function ProposalRow({ proposal, status, action }: { proposal: Proposal; status: string; action?: ReactNode }) {
  const asset = baseOf(proposal.symbol);
  return (
    <div className="loan-proposal-row">
      <TokenIcon symbol={proposal.symbol} size={30} />
      <div className="loan-proposal-main">
        <b>{proposal.symbol}</b>
        <span>Long perp / Short spot requires borrowed {asset}</span>
      </div>
      <div className="loan-proposal-edge">
        <span>basis</span>
        <b className="num">{proposal.basisNow.toFixed(2)}%</b>
      </div>
      <div className="loan-proposal-edge">
        <span>net edge</span>
        <b className={`num ${proposal.netEdgePct >= 0 ? 'up' : 'down'}`}>{proposal.netEdgePct.toFixed(2)}%</b>
      </div>
      <span className="loan-proposal-status">{status}</span>
      {action && <div className="loan-proposal-actions">{action}</div>}
    </div>
  );
}
