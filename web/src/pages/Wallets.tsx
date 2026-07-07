import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { useRefreshSignal } from '../lib/refresh';
import { TokenIcon } from '../components/TokenIcon';
import { Donut } from '../components/Donut';
import { EmptyState, SetupChecklist, StatePill } from '../components/ui';
import { Num } from '../components/Num';
import {
  IconChart,
  IconClock,
  IconCoins,
  IconKey,
  IconLayers,
  IconPulse,
  IconSearch,
  IconShield,
  IconWallet,
} from '../components/Icons';
import { fmtPrice, fmtQty, fmtPct, signClass, timeAgo } from '../format';
import type { LoansSnapshot } from '../types';

type Tab = 'spot' | 'margin' | 'futures' | 'earn';
type SortKey = 'value' | 'asset' | 'free' | 'locked' | 'price' | 'change' | 'share';

const STABLE_ASSETS = new Set(['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI']);

const TAB_META: Record<Tab, { label: string; sub: string }> = {
  spot: { label: 'Spot', sub: 'Free, locked, price, value' },
  margin: { label: 'Cross Margin', sub: 'Liabilities and interest' },
  futures: { label: 'Futures', sub: 'USD-M wallet readiness' },
  earn: { label: 'Earn', sub: 'Idle yield visibility later' },
};

function pctOf(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return (value / total) * 100;
}

function sortNum(v: number | null | undefined): number {
  return Number.isFinite(Number(v)) ? Number(v) : Number.NEGATIVE_INFINITY;
}

export function Wallets() {
  const { state, markets, connected, openDetail, openTicket, setPage } = useStore();
  const [tab, setTab] = useState<Tab>('spot');
  const [loans, setLoans] = useState<LoansSnapshot | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDesc, setSortDesc] = useState(true);

  const [refreshTick, setRefreshTick] = useState(0);
  useRefreshSignal(() => setRefreshTick((n) => n + 1));
  useEffect(() => {
    if (tab !== 'margin') return;
    void fetch('/api/loans')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setLoans(d as LoansSnapshot))
      .catch(() => undefined);
  }, [tab, refreshTick]);

  const acct = state?.account;
  const keysPresent = state?.binance.keysPresent ?? false;
  const margin = loans?.margin;
  const entries = acct?.entries ?? [];
  const totalValue = acct?.totalUsdt ?? 0;
  const cashValue = entries
    .filter((e) => STABLE_ASSETS.has(e.asset))
    .reduce((sum, e) => sum + e.valueUsdt, 0);
  const exposureValue = Math.max(0, totalValue - cashValue);
  const lockedValue = entries.reduce((sum, e) => sum + (e.priceUsdt ?? 0) * e.locked, 0);
  const largest = entries.reduce<(typeof entries)[number] | null>(
    (best, e) => (!best || e.valueUsdt > best.valueUsdt ? e : best),
    null
  );
  const tradeableAssets = useMemo(
    () => new Set(markets.filter((m) => m.spot !== null).map((m) => m.base)),
    [markets]
  );

  const spotRows = useMemo(() => {
    const q = search.trim().toUpperCase();
    const rows = entries.map((e) => {
      const symbol = e.asset === 'USDT' ? null : `${e.asset}USDT`;
      const market = symbol ? markets.find((m) => m.symbol === symbol) ?? null : null;
      return {
        ...e,
        symbol,
        market,
        change: market?.change24hPct ?? null,
        share: pctOf(e.valueUsdt, totalValue),
        tradable: e.asset !== 'USDT' && tradeableAssets.has(e.asset),
      };
    });
    return rows
      .filter((r) => !q || r.asset.includes(q) || r.symbol?.includes(q))
      .sort((a, b) => {
        const av =
          sortKey === 'asset'
            ? a.asset
            : sortKey === 'free'
              ? sortNum(a.free)
              : sortKey === 'locked'
                ? sortNum(a.locked)
                : sortKey === 'price'
                  ? sortNum(a.priceUsdt)
                  : sortKey === 'change'
                    ? sortNum(a.change)
                    : sortKey === 'share'
                      ? sortNum(a.share)
                      : sortNum(a.valueUsdt);
        const bv =
          sortKey === 'asset'
            ? b.asset
            : sortKey === 'free'
              ? sortNum(b.free)
              : sortKey === 'locked'
                ? sortNum(b.locked)
                : sortKey === 'price'
                  ? sortNum(b.priceUsdt)
                  : sortKey === 'change'
                    ? sortNum(b.change)
                    : sortKey === 'share'
                      ? sortNum(b.share)
                      : sortNum(b.valueUsdt);
        const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : Number(av) - Number(bv);
        return sortDesc ? -cmp : cmp;
      });
  }, [entries, markets, search, sortDesc, sortKey, totalValue, tradeableAssets]);

  const setSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((v) => !v);
    else {
      setSortKey(key);
      setSortDesc(key !== 'asset');
    }
  };

  const SortHead = ({ label, k, align = '' }: { label: string; k: SortKey; align?: 'l' | '' }) => (
    <th className={`${align} sortable ${sortKey === k ? 'sorted' : ''}`} aria-sort={sortKey === k ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
      <button className="sort-btn" type="button" onClick={() => setSort(k)}>
        {label}
        <span className="sort-caret">{sortKey === k ? (sortDesc ? 'down' : 'up') : 'sort'}</span>
      </button>
    </th>
  );

  const syncTone = keysPresent ? (state?.binance.connected ? 'ok' : 'bad') : 'idle';
  const syncText = keysPresent ? (state?.binance.connected ? 'synced' : 'failing') : 'waiting';

  return (
    <div className="container page wallets-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Wallets &amp; Assets</h1>
          <div className="page-sub">
            Binance account allocation · {keysPresent ? `synced ${timeAgo(state?.binance.lastSyncTs ?? null)}` : 'server keys absent'}
          </div>
        </div>
        <div className="head-actions">
          <button className="mini-btn" type="button" onClick={() => setPage('account')}>
            <IconKey /> API access
          </button>
          <button className="mini-btn" type="button" onClick={() => setPage('system')}>
            <IconPulse /> System health
          </button>
        </div>
      </div>

      <section className="card wallet-hero">
        <div className="wallet-hero-main">
          <div className="wallet-eyebrow">
            <StatePill tone={syncTone}>{syncText}</StatePill>
            <span>{connected ? 'websocket live' : 'websocket offline'}</span>
            <span>{state?.binance.userStream ? `user stream ${state.binance.userStream}` : 'user stream waiting'}</span>
          </div>
          <div className={`wallet-balance ${acct ? '' : 'pending'}`}>
            {acct ? <Num value={acct.totalUsdt}>{fmtPrice(acct.totalUsdt)}</Num> : 'Read sync pending'}
          </div>
          <div className="wallet-meta">
            <span>available USDT <b className="num">{acct ? fmtPrice(acct.availableUsdt) : 'pending'}</b></span>
            <span>assets <b className="num">{entries.length}</b></span>
            <span>largest <b>{largest ? `${largest.asset} ${fmtPct(pctOf(largest.valueUsdt, totalValue), 1)}` : 'pending'}</b></span>
          </div>
          <div className="wallet-hero-actions">
            <button
              className="cta-pill"
              type="button"
              onClick={() => setPage('trade')}
              disabled={!keysPresent}
              title={keysPresent ? 'Open the guarded manual ticket' : 'Read-only API keys are required first'}
            >
              {keysPresent ? 'Open trade ticket' : 'Connect keys first'}
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('orders')}>
              Orders
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('fills')}>
              Fills
            </button>
          </div>
        </div>
        <div className="wallet-allocation">
          {entries.length > 0 ? (
            <Donut slices={entries.map((e) => ({ label: e.asset, value: e.valueUsdt }))} size={146} />
          ) : (
            <div className="wallet-allocation-empty">
              <div className="wallet-ring-placeholder">
                <span />
                <span />
                <span />
              </div>
              <div>
                <div className="wallet-mini-title">Allocation appears after read sync</div>
                <div className="wallet-mini-sub">No fake balances. Read-only Binance keys populate this panel.</div>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="wallet-scope-grid">
        <WalletScope
          active={tab === 'spot'}
          icon={<IconWallet />}
          title="Spot"
          value={acct ? fmtPrice(acct.totalUsdt) : 'setup'}
          sub={keysPresent ? `${entries.length} assets · ${fmtPrice(lockedValue)} locked` : 'read permission required'}
          tone={keysPresent ? 'ok' : 'idle'}
          onClick={() => setTab('spot')}
        />
        <WalletScope
          active={tab === 'margin'}
          icon={<IconLayers />}
          title="Cross margin"
          value={margin?.available ? margin.marginLevel?.toFixed(2) ?? '—' : 'setup'}
          sub={margin?.available ? `${margin.assets.length} assets · net ${margin.totalNetAssetBtc.toFixed(8)} BTC` : keysPresent ? 'permission check needed' : 'server keys absent'}
          tone={margin?.available ? (margin.marginLevel !== null && margin.marginLevel < 1.5 ? 'bad' : 'ok') : 'idle'}
          onClick={() => setTab('margin')}
        />
        <WalletScope
          active={tab === 'futures'}
          icon={<IconChart />}
          title="Futures"
          value={state?.positions.length ? `${state.positions.length}` : 'planned'}
          sub="USD-M wallet slot · testnet first"
          tone="idle"
          onClick={() => setTab('futures')}
        />
        <WalletScope
          active={tab === 'earn'}
          icon={<IconCoins />}
          title="Earn"
          value={acct ? fmtPrice(cashValue) : 'later'}
          sub="idle cash visibility, not trade path"
          tone="idle"
          onClick={() => setTab('earn')}
        />
      </div>

      <div className="atabs wallet-tabs">
        {(['spot', 'margin', 'futures', 'earn'] as Tab[]).map((t) => (
          <button key={t} className={`atab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            <span>{TAB_META[t].label}</span>
            <small>{TAB_META[t].sub}</small>
          </button>
        ))}
      </div>

      {tab === 'spot' &&
        (!keysPresent ? (
          <div className="wallet-empty-grid">
            <section className="card wallet-setup-card">
              <PanelHead icon={<IconShield />} title="Read-only spot wallet setup" note="Balances are server-side only. The browser never receives API keys." />
              <SetupChecklist />
            </section>
            <section className="card wallet-ready-card">
              <PanelHead icon={<IconClock />} title="What this page will show" note="The layout is ready before keys are connected; only real Binance data fills the rows." />
              <div className="wallet-readiness">
                <ReadinessRow label="Free balance" detail="asset amount available for approved spot orders" />
                <ReadinessRow label="Locked balance" detail="open-order amount, valued from live market price" />
                <ReadinessRow label="Allocation" detail="portfolio share, largest exposure, cash vs market risk" />
                <ReadinessRow label="Actions" detail="view market detail or open a sell ticket only when a USDT market exists" />
              </div>
              <div className="wallet-safe-note">
                No withdrawal, transfer-out, bridge, or cash-out controls exist here.
              </div>
            </section>
          </div>
        ) : !acct || acct.entries.length === 0 ? (
          <div className="card">
            <EmptyState title="Spot wallet has no balances">
              Fund the Binance account externally and read-only sync will populate assets within the next account poll.
            </EmptyState>
          </div>
        ) : (
          <div className="wallet-workspace">
            <section className="card wallet-primary">
              <PanelHead
                icon={<IconWallet />}
                title="Spot balances"
                note={`${spotRows.length} of ${entries.length} assets · sorted by ${sortKey} ${sortDesc ? 'high to low' : 'low to high'}`}
                right={
                  <label className="tsearch">
                    <IconSearch />
                    <input placeholder="Search asset" value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
                    {search && (
                      <button className="search-clear" type="button" onClick={() => setSearch('')} aria-label="Clear wallet search">
                        x
                      </button>
                    )}
                  </label>
                }
              />
              <div className="table-scroll">
                <table className="mkt wallet-table">
                  <thead>
                    <tr>
                      <SortHead label="Asset" k="asset" align="l" />
                      <SortHead label="Free" k="free" />
                      <SortHead label="Locked" k="locked" />
                      <SortHead label="Price" k="price" />
                      <SortHead label="24h" k="change" />
                      <SortHead label="Value" k="value" />
                      <SortHead label="Share" k="share" />
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {spotRows.map((b) => (
                      <tr
                        key={b.asset}
                        className={b.symbol ? 'rowlink' : ''}
                        onClick={() => b.symbol && openDetail(b.symbol)}
                      >
                        <td className="l">
                          <span className="tok">
                            <TokenIcon symbol={b.symbol ?? `${b.asset}USDT`} size={32} />
                            <span className="tok-meta">
                              <span className="tok-name">{b.asset}</span>
                              <span className="tok-sub">{b.tradable ? b.symbol : b.asset === 'USDT' ? 'quote cash' : 'no USDT spot market'}</span>
                            </span>
                          </span>
                        </td>
                        <td><Num value={b.free}>{fmtQty(b.free)}</Num></td>
                        <td className={b.locked ? 'val-strong' : 'muted'}><Num value={b.locked}>{b.locked ? fmtQty(b.locked) : '—'}</Num></td>
                        <td><Num value={b.priceUsdt}>{b.priceUsdt !== null ? fmtPrice(b.priceUsdt) : '—'}</Num></td>
                        <td className={signClass(b.change)}><Num value={b.change}>{fmtPct(b.change)}</Num></td>
                        <td className="val-strong"><Num value={b.valueUsdt}>{fmtPrice(b.valueUsdt)}</Num></td>
                        <td>
                          <div className="wallet-share">
                            <span className="num">{fmtPct(b.share, 1, false)}</span>
                            <i style={{ width: `${Math.min(100, Math.max(3, b.share))}%` }} />
                          </div>
                        </td>
                        <td>
                          <div className="wallet-row-actions">
                            {b.symbol && (
                              <button
                                className="mini-btn"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDetail(b.symbol!);
                                }}
                              >
                                Detail
                              </button>
                            )}
                            <button
                              className="mini-btn"
                              type="button"
                              disabled={!b.tradable}
                              title={b.tradable ? 'Open a guarded sell ticket' : 'No USDT spot market for this asset'}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (b.symbol) openTicket({ symbol: b.symbol, side: 'SELL', source: 'manual' });
                              }}
                            >
                              Sell
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {spotRows.length === 0 && <EmptyState title="No wallet assets match">Clear search or use a different asset code.</EmptyState>}
            </section>
            <aside className="wallet-rail">
              <section className="card wallet-summary-card">
                <PanelHead icon={<IconPulse />} title="Allocation health" note="Read-only account context" />
                <div className="wallet-metrics">
                  <MiniMetric label="Cash / stable" value={fmtPrice(cashValue)} sub={fmtPct(pctOf(cashValue, totalValue), 1, false)} />
                  <MiniMetric label="Market exposure" value={fmtPrice(exposureValue)} sub={fmtPct(pctOf(exposureValue, totalValue), 1, false)} />
                  <MiniMetric label="Locked in orders" value={fmtPrice(lockedValue)} sub={lockedValue > 0 ? 'open order reserve' : 'none'} />
                  <MiniMetric label="Tradable assets" value={`${entries.filter((e) => tradeableAssets.has(e.asset)).length}`} sub={`${markets.length} Binance rows`} />
                </div>
              </section>
              <section className="card wallet-summary-card">
                <PanelHead icon={<IconShield />} title="Controls" note="Safety before convenience" />
                <div className="wallet-safe-list">
                  <ReadinessRow label="Withdrawals" detail="not implemented in backend or UI" />
                  <ReadinessRow label="Live orders" detail={state?.config.liveTradingEnabled ? 'armed, still risk-gated' : 'disabled until armed'} />
                  <ReadinessRow label="Kill switch" detail={state?.config.killSwitch ? 'halts every send path' : 'off, risk gate still required'} />
                </div>
              </section>
            </aside>
          </div>
        ))}

      {tab === 'margin' &&
        (!margin || !margin.available ? (
          <section className="card wallet-state-card">
            <PanelHead icon={<IconLayers />} title="Cross margin readiness" note="Prepared for reverse-basis tickets without pretending data exists." />
            <div className="wallet-state-copy">
              <b>Cross margin is not available yet.</b>
              <span>
                {margin?.error ??
                  'Needs API keys and margin permission on the key. Once connected: assets, borrowed amounts, interest and net position appear here.'}
              </span>
            </div>
            <div className="wallet-readiness cols">
              <ReadinessRow label="Margin level" detail="health ratio and liquidation distance" />
              <ReadinessRow label="Liabilities" detail="borrowed amount and accrued interest by asset" />
              <ReadinessRow label="Borrow checks" detail="asset-level limits before any reverse-basis ticket" />
            </div>
          </section>
        ) : (
          <>
            <div className="metric-strip">
              <div className="metric">
                <span className="k">Margin level</span>
                <span className={`v num ${margin.marginLevel !== null && margin.marginLevel < 1.5 ? 'down' : ''}`}>
                  {margin.marginLevel?.toFixed(2) ?? '—'}
                </span>
                <span className="s">&lt;1.3 margin call · &lt;1.1 liquidation</span>
              </div>
              <div className="metric">
                <span className="k">Net asset (BTC)</span>
                <span className="v num">{margin.totalNetAssetBtc.toFixed(8)}</span>
              </div>
              <div className="metric">
                <span className="k">Liability (BTC)</span>
                <span className="v num">{margin.totalLiabilityBtc.toFixed(8)}</span>
              </div>
              <div className="metric">
                <span className="k">Borrow enabled</span>
                <span className={`v ${margin.borrowEnabled ? 'up' : 'down'}`}>{margin.borrowEnabled ? 'yes' : 'no'}</span>
              </div>
            </div>
            {margin.assets.length === 0 ? (
              <div className="card"><EmptyState title="No margin balances" /></div>
            ) : (
              <div className="card pad-0 table-scroll">
                <table className="mkt dense">
                  <thead>
                    <tr>
                      <th className="l">Asset</th>
                      <th>Free</th>
                      <th>Locked</th>
                      <th>Borrowed</th>
                      <th>Interest</th>
                      <th>Net</th>
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
                        <td className="muted"><span className="num">{a.locked ? fmtQty(a.locked) : '—'}</span></td>
                        <td className={a.borrowed > 0 ? 'down' : 'muted'}><span className="num">{a.borrowed ? fmtQty(a.borrowed) : '—'}</span></td>
                        <td className={a.interest > 0 ? 'down' : 'muted'}><span className="num">{a.interest ? fmtQty(a.interest) : '—'}</span></td>
                        <td className="val-strong"><span className="num">{fmtQty(a.netAsset)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ))}

      {tab === 'futures' && (
        <section className="card wallet-state-card">
          <PanelHead icon={<IconChart />} title="Futures wallet readiness" note="No live futures executor is enabled from this UI." />
          <div className="wallet-state-copy">
            <b>USD-M wallet endpoints are not wired yet.</b>
            <span>The perp leg belongs here after testnet verification: margin balance, isolated/cross mode, open perp positions, and liquidation distance.</span>
          </div>
          <div className="wallet-readiness cols">
            <ReadinessRow label="Wallet balance" detail="available, initial margin, maintenance margin" />
            <ReadinessRow label="Positions" detail="symbol, side, mark price, unrealized PnL" />
            <ReadinessRow label="Basis tickets" detail="spot/perp pair context before manual approval" />
          </div>
        </section>
      )}

      {tab === 'earn' && (
        <section className="card wallet-state-card">
          <PanelHead icon={<IconCoins />} title="Earn visibility" note="Read-only, later, and separate from trade execution." />
          <div className="wallet-state-copy">
            <b>Earn is deliberately not part of the trading loop.</b>
            <span>If idle USDT should earn while waiting, this tab will show flexible balances, APR, redeem timing, and whether funds are available for trading.</span>
          </div>
          <div className="wallet-readiness cols">
            <ReadinessRow label="Principal" detail="asset, flexible amount, estimated value" />
            <ReadinessRow label="Yield" detail="APR, daily estimate, total accrued" />
            <ReadinessRow label="Availability" detail="whether funds are free for manual strategies" />
          </div>
        </section>
      )}
    </div>
  );
}

function PanelHead({
  icon,
  title,
  note,
  right,
}: {
  icon: ReactNode;
  title: string;
  note: string;
  right?: ReactNode;
}) {
  return (
    <div className="wallet-panel-head">
      <span className="wallet-panel-icon">{icon}</span>
      <span>
        <span className="wallet-panel-title">{title}</span>
        <span className="wallet-panel-note">{note}</span>
      </span>
      {right && <span className="wallet-panel-right">{right}</span>}
    </div>
  );
}

function WalletScope({
  active,
  icon,
  title,
  value,
  sub,
  tone,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  title: string;
  value: string;
  sub: string;
  tone: 'ok' | 'bad' | 'idle';
  onClick: () => void;
}) {
  return (
    <button className={`wallet-scope-card ${active ? 'on' : ''}`} type="button" onClick={onClick}>
      <span className={`wallet-scope-icon ${tone}`}>{icon}</span>
      <span className="wallet-scope-main">
        <span className="wallet-scope-title">{title}</span>
        <span className="wallet-scope-sub">{sub}</span>
      </span>
      <span className="wallet-scope-value num">{value}</span>
    </button>
  );
}

function ReadinessRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="wallet-ready-row">
      <span>{label}</span>
      <b>{detail}</b>
    </div>
  );
}

function MiniMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="wallet-mini-metric">
      <span>{label}</span>
      <b className="num">{value}</b>
      <small>{sub}</small>
    </div>
  );
}
