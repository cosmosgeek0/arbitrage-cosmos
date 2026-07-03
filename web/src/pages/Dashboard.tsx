import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { TokenIcon } from '../components/TokenIcon';
import { Num } from '../components/Num';
import { Donut } from '../components/Donut';
import { SparkArea } from '../components/Spark';
import { EmptyState, SetupChecklist, SideTag, StatePill, StatusDot, WarnStrip } from '../components/ui';
import { eventSummary } from '../lib/eventText';
import {
  fmtBasis,
  fmtPrice,
  fmtPct,
  fmtQty,
  fmtTimeShort,
  signClass,
  timeAgo,
  baseOf,
} from '../format';
import {
  IconBook,
  IconBrain,
  IconChart,
  IconClock,
  IconKey,
  IconLayers,
  IconList,
  IconPower,
  IconPulse,
  IconRadar,
  IconReceipt,
  IconShield,
  IconTicket,
  IconWallet,
  IconWifi,
} from '../components/Icons';

type Tone = 'ok' | 'bad' | 'warn' | 'idle';

function statusTone(status: string): Tone {
  if (status === 'open' || status === 'live') return 'ok';
  if (status === 'closed' || status === 'failed') return 'bad';
  if (status === 'connecting') return 'warn';
  return 'idle';
}

export function Dashboard() {
  const { state, markets, marketsUpdatedAt, connected, setPage, openTicket, openDetail } = useStore();
  const [quickSymbol, setQuickSymbol] = useState('BTCUSDT');
  const [equity, setEquity] = useState<number[]>([]);

  useEffect(() => {
    void fetch('/api/pnl')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setEquity((d.equitySnapshots as { totalUsdt: number }[]).map((s) => s.totalUsdt)))
      .catch(() => undefined);
  }, [state?.account?.totalUsdt]);

  const topMarkets = useMemo(
    () =>
      markets
        .filter((m) => Number.isFinite(m.change24hPct))
        .slice()
        .sort((a, z) => Math.abs(z.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0))
        .slice(0, 4),
    [markets]
  );

  if (!state) return <div className="container page"><div className="empty-state">Connecting to engine…</div></div>;

  const acct = state.account;
  const feedEntries = Object.entries(state.feeds);
  const feedLive = feedEntries.filter(([, status]) => status === 'open' || status === 'live').length;
  const exposure = state.positions.reduce((s, p) => s + p.valueUsdt, 0);
  const unrealized = state.positions.some((p) => p.unrealizedUsd !== null)
    ? state.positions.reduce((s, p) => s + (p.unrealizedUsd ?? 0), 0)
    : null;
  const dayPct =
    acct && acct.dayOpenEquity && acct.dayOpenEquity > 0 && acct.dayChangeUsd !== null
      ? (acct.dayChangeUsd / acct.dayOpenEquity) * 100
      : null;
  const dailyRiskPct = state.config.maxDailyNotionalUsd > 0
    ? Math.min(100, (state.risk.dailyNotionalUsedUsd / state.config.maxDailyNotionalUsd) * 100)
    : 0;
  const isTradeSymbolReady = quickSymbol.trim().length > 0;
  const modeTone: Tone = state.mode === 'LIVE_ARMED' ? 'ok' : state.mode === 'HALTED' ? 'bad' : 'warn';
  const accountTone: Tone = state.binance.connected ? 'ok' : state.binance.keysPresent ? 'bad' : 'idle';
  const scannerAge = state.scanner.lastTickTs ? timeAgo(state.scanner.lastTickTs) : '—';

  const readiness = [
    {
      label: 'Market stream',
      detail: connected ? `${feedLive}/${feedEntries.length} feeds open` : 'socket reconnecting',
      tone: connected && feedLive > 0 ? 'ok' : 'warn',
      icon: <IconWifi />,
    },
    {
      label: 'Server keys',
      detail: state.binance.keysPresent ? 'env configured' : 'not connected',
      tone: state.binance.keysPresent ? 'ok' : 'idle',
      icon: <IconKey />,
    },
    {
      label: 'Account sync',
      detail: state.binance.connected ? `synced ${timeAgo(state.binance.lastSyncTs)}` : state.binance.lastError ?? 'waiting',
      tone: accountTone,
      icon: <IconWallet />,
    },
    {
      label: 'Withdrawals',
      detail: state.binance.canWithdraw === true ? 'key can withdraw' : 'disabled or unavailable',
      tone: state.binance.canWithdraw === true ? 'bad' : 'ok',
      icon: <IconPower />,
    },
    {
      label: 'Risk gate',
      detail: `${fmtPrice(state.config.maxOrderNotionalUsd)} max order`,
      tone: 'ok',
      icon: <IconShield />,
    },
    {
      label: 'Kill switch',
      detail: state.config.killSwitch ? 'blocking live sends' : 'manual mode available',
      tone: state.config.killSwitch ? 'warn' : 'ok',
      icon: <IconPulse />,
    },
  ] satisfies { label: string; detail: string; tone: Tone; icon: ReactNode }[];
  const readinessScore = readiness.filter((r) => r.tone === 'ok' || r.tone === 'warn').length;

  const sortedHoldings = acct?.entries.slice().sort((a, z) => z.valueUsdt - a.valueUsdt).slice(0, 5) ?? [];
  const topProposals = state.proposals.slice(0, 5);
  const recentEvents = state.events.slice(0, 9);

  return (
    <div className="container page dashboard-page">
      <div className="page-head dashboard-head">
        <div>
          <div className="page-kicker">Private Binance cockpit</div>
          <h1 className="page-title">Control room</h1>
          <div className="page-sub">
            {state.scanner.pairs} pairs scanned · market tick {scannerAge} ·{' '}
            {state.binance.keysPresent
              ? state.binance.connected
                ? `account synced ${timeAgo(state.binance.lastSyncTs)}`
                : 'account sync failing'
              : 'server keys not set'}
          </div>
        </div>
        <div className="head-actions">
          <button className="mini-btn" type="button" onClick={() => setPage('risk')}>
            <IconShield /> Risk gate
          </button>
          <button className="cta-pill" type="button" onClick={() => setPage('trade')}>
            <IconTicket /> New order
          </button>
        </div>
      </div>

      {state.binance.canWithdraw === true && (
        <WarnStrip>
          This API key can WITHDRAW. The app has no withdrawal route, but the Binance key should be recreated with that permission disabled.
        </WarnStrip>
      )}
      {state.binance.keysPresent && !state.binance.connected && (
        <WarnStrip>Account sync failing: {state.binance.lastError ?? 'unknown error'}</WarnStrip>
      )}

      <section className={`card dashboard-hero mode-${state.mode.toLowerCase()}`}>
        <div className="dashboard-hero-main">
          <div className="dash-eyebrow">
            <StatePill tone={modeTone}>{state.mode === 'LIVE_ARMED' ? 'live armed' : state.mode.toLowerCase()}</StatePill>
            <span>{state.config.killSwitch ? 'kill switch on' : 'kill switch off'}</span>
            <span>{state.config.allowedSymbols.length} allowed symbols</span>
          </div>
          <div className="dash-equity">
            {acct ? (
              <Num value={acct.totalUsdt}>{fmtPrice(acct.totalUsdt)}</Num>
            ) : (
              <span className="dash-equity-empty">No account data</span>
            )}
          </div>
          <div className="dash-equity-sub">
            {acct?.dayChangeUsd !== null && acct?.dayChangeUsd !== undefined ? (
              <span className={`num ${signClass(acct.dayChangeUsd)}`}>
                {acct.dayChangeUsd >= 0 ? '▲' : '▼'} {fmtPrice(Math.abs(acct.dayChangeUsd))}
                {dayPct !== null ? ` ${fmtPct(dayPct, 2)}` : ''} today
              </span>
            ) : (
              <span>Public market data is live. Add server-side read keys to unlock balances, orders, fills, and equity history.</span>
            )}
          </div>
          <div className="dash-hero-actions">
            <button className="cta-pill" type="button" onClick={() => setPage('wallets')}>
              Wallets & assets
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('orders')}>
              Orders
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('ledger')}>
              Audit ledger
            </button>
          </div>
          <div className="dash-spark-shell">
            {equity.length > 3 ? (
              <SparkArea values={equity} w={760} h={86} dots endDot />
            ) : (
              <div className="dash-spark-empty">
                <span>Equity curve will draw from 15-minute snapshots after account sync.</span>
                <span>Until then, this dashboard stays honest and shows market/strategy state only.</span>
              </div>
            )}
          </div>
        </div>

        <aside className="dash-readiness">
          <div className="dash-readiness-ring" style={{ '--score': `${(readinessScore / readiness.length) * 100}%` } as React.CSSProperties}>
            <span className="num">{readinessScore}/{readiness.length}</span>
          </div>
          <div>
            <div className="dash-readiness-title">Command posture</div>
            <div className="dash-readiness-sub">Read-only by default. Live sends still require arm, allowlist, typed symbol, and risk approval.</div>
          </div>
          <div className="dash-readiness-list">
            {readiness.map((item) => (
              <ReadinessItem key={item.label} {...item} />
            ))}
          </div>
        </aside>
      </section>

      <div className="dashboard-metrics">
        <DashMetric
          icon={<IconWallet />}
          label="Available USDT"
          value={acct ? fmtPrice(acct.availableUsdt) : '—'}
          sub={acct ? 'free balance, not in orders' : 'requires read keys'}
          tone={acct ? 'ok' : 'idle'}
        />
        <DashMetric
          icon={<IconReceipt />}
          label="Realized today"
          value={acct ? fmtPrice(acct.realizedTodayUsd) : '—'}
          sub="from ledgered fills"
          tone={acct ? (acct.realizedTodayUsd >= 0 ? 'ok' : 'bad') : 'idle'}
        />
        <DashMetric
          icon={<IconLayers />}
          label="Open exposure"
          value={acct ? fmtPrice(exposure) : '—'}
          sub={`${state.openOrders.length} open order${state.openOrders.length === 1 ? '' : 's'}`}
          tone={exposure > 0 ? 'warn' : 'idle'}
        />
        <DashMetric
          icon={<IconChart />}
          label="Unrealized"
          value={unrealized !== null ? fmtPrice(unrealized) : '—'}
          sub={unrealized !== null ? 'mark-to-market positions' : 'needs fill history'}
          tone={unrealized === null ? 'idle' : unrealized >= 0 ? 'ok' : 'bad'}
        />
        <DashMetric
          icon={<IconShield />}
          label="Daily notional"
          value={fmtPrice(state.risk.dailyNotionalUsedUsd)}
          sub={`${Math.round(dailyRiskPct)}% of ${fmtPrice(state.config.maxDailyNotionalUsd)} limit`}
          tone={dailyRiskPct > 80 ? 'bad' : dailyRiskPct > 50 ? 'warn' : 'ok'}
          meter={dailyRiskPct}
        />
        <DashMetric
          icon={<IconRadar />}
          label="Basis proposals"
          value={String(state.proposals.length)}
          sub={`${state.scanner.watching} actively watched`}
          tone={state.proposals.length > 0 ? 'warn' : 'idle'}
        />
      </div>

      {!state.binance.keysPresent && (
        <section className="card dash-setup-card">
          <div className="dash-setup-icon"><IconBook /></div>
          <div>
            <div className="dash-panel-title">Connect Binance without weakening custody</div>
            <div className="dash-panel-sub">No browser key form, no withdrawals, no transfer-out path. Configure keys only on the server.</div>
            <SetupChecklist />
          </div>
          <button className="mini-btn" type="button" onClick={() => setPage('account')}>
            Account setup
          </button>
        </section>
      )}

      <div className="dashboard-grid">
        <main className="dash-main-lane">
          <section className="card dash-ops-card">
            <PanelHead
              icon={<IconList />}
              title="Orders and fills"
              sub="Live account workbench, compact enough to scan while strategies are running."
              action={<button className="sec-link" type="button" onClick={() => setPage('orders')}>Open orders →</button>}
            />
            <div className="dash-op-columns">
              <div className="dash-op-panel">
                <div className="dash-op-head">
                  <span>Open orders</span>
                  <b className="num">{state.openOrders.length}</b>
                </div>
                {state.openOrders.length === 0 ? (
                  <CompactEmpty title="No open orders" body={state.binance.keysPresent ? 'New orders appear here live within seconds.' : 'Connect Binance to manage orders.'} />
                ) : (
                  <div className="table-scroll">
                    <table className="mkt dense">
                      <thead>
                        <tr>
                          <th className="l">Symbol</th>
                          <th className="l">Side</th>
                          <th>Price</th>
                          <th>Qty</th>
                          <th>Age</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.openOrders.slice(0, 6).map((o) => (
                          <tr key={o.orderId} className="rowlink" onClick={() => setPage('orders')}>
                            <td className="l val-strong">{o.symbol}</td>
                            <td className="l"><SideTag side={o.side} /></td>
                            <td><span className="num">{fmtPrice(o.price)}</span></td>
                            <td><span className="num">{fmtQty(o.origQty)}</span></td>
                            <td className="muted">{timeAgo(o.time)} {o.stale && <span className="chip-tag gold">stale</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="dash-op-panel">
                <div className="dash-op-head">
                  <span>Recent fills</span>
                  <b className="num">{state.recentFills.length}</b>
                </div>
                {state.recentFills.length === 0 ? (
                  <CompactEmpty title="No fills recorded" body="Fills stream after Binance connects; history import lives on the Fills page." />
                ) : (
                  <div className="table-scroll">
                    <table className="mkt dense">
                      <thead>
                        <tr>
                          <th className="l">Symbol</th>
                          <th className="l">Side</th>
                          <th>Price</th>
                          <th>Value</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.recentFills.slice(0, 6).map((f) => (
                          <tr key={`${f.symbol}-${f.tradeId}`}>
                            <td className="l val-strong">{f.symbol}</td>
                            <td className="l"><SideTag side={f.side} /></td>
                            <td><span className="num">{fmtPrice(f.price)}</span></td>
                            <td><span className="num">{fmtPrice(f.quoteQty)}</span></td>
                            <td className="muted">{timeAgo(f.ts)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="card dash-stream-card">
            <PanelHead
              icon={<IconClock />}
              title="Event stream"
              sub="Human-readable ledger pulse, newest first."
              action={<button className="sec-link" type="button" onClick={() => setPage('ledger')}>Full ledger →</button>}
            />
            <div className="dash-timeline">
              {recentEvents.length === 0 ? (
                <EmptyState title="No ledger events yet">Risk checks, proposals, order intents, and config changes will appear here.</EmptyState>
              ) : (
                recentEvents.map((ev) => (
                  <button key={ev.id} className="dash-timeline-row" type="button" onClick={() => setPage('ledger')}>
                    <span className="dash-timeline-time num">{fmtTimeShort(ev.ts)}</span>
                    <span className="dash-timeline-dot" />
                    <span className="dash-timeline-copy">{eventSummary(ev.kind, ev.data as Record<string, unknown> | null, ev.symbol)}</span>
                    {ev.symbol && <span className="dash-timeline-symbol">{ev.symbol}</span>}
                  </button>
                ))
              )}
            </div>
          </section>
        </main>

        <aside className="dash-side-lane">
          <section className="card dash-ticket-card">
            <PanelHead icon={<IconTicket />} title="Manual ticket" sub="Shortcut into the guarded trade flow." />
            <label className="dash-symbol-field">
              <span>Symbol</span>
              <input value={quickSymbol} onChange={(e) => setQuickSymbol(e.target.value.toUpperCase())} spellCheck={false} />
            </label>
            <div className="dash-ticket-actions">
              <button
                className="cta-pill buy"
                type="button"
                disabled={!isTradeSymbolReady}
                onClick={() => openTicket({ symbol: quickSymbol.trim(), side: 'BUY', source: 'manual' })}
              >
                Buy
              </button>
              <button
                className="cta-pill danger"
                type="button"
                disabled={!isTradeSymbolReady}
                onClick={() => openTicket({ symbol: quickSymbol.trim(), side: 'SELL', source: 'manual' })}
              >
                Sell
              </button>
            </div>
            <div className="dash-guard-note">
              <IconShield /> Risk gate, allowlist, kill switch, and typed-symbol confirmation still apply.
            </div>
          </section>

          <section className="card dash-pulse-card">
            <PanelHead
              icon={<IconBrain />}
              title="Strategy pulse"
              sub={`${state.proposals.length} active proposals · threshold ${fmtBasis(state.scanner.grossThresholdPct, 2)}`}
              action={<button className="sec-link" type="button" onClick={() => setPage('strategies')}>Strategies →</button>}
            />
            <div className="dash-system-row">
              <StatusDot status="live" />
              <span>Basis monitor</span>
              <b>{state.proposals.length} proposing</b>
            </div>
            <div className="dash-system-row">
              <StatusDot status="none" />
              <span>Volume spike</span>
              <b>in development</b>
            </div>
            <div className="dash-proposal-list">
              {topProposals.length === 0 ? (
                <CompactEmpty title="No active proposals" body="Scanner will surface basis/funding setups here when thresholds persist." />
              ) : (
                topProposals.map((p) => (
                  <button key={p.id} className="dash-proposal-row" type="button" onClick={() => setPage('opportunities')}>
                    <TokenIcon symbol={p.symbol} size={28} />
                    <span>
                      <b>{baseOf(p.symbol)}</b>
                      <em>{p.side === 'SHORT_PERP_LONG_SPOT' ? 'short perp / long spot' : 'long perp / short spot'}</em>
                    </span>
                    <strong className={`num ${signClass(p.basisNow)}`}>{fmtBasis(p.basisNow, 2)}</strong>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="card dash-system-card">
            <PanelHead icon={<IconWifi />} title="System state" sub="Feeds, account stream, and market refresh." />
            {feedEntries.map(([name, status]) => (
              <div key={name} className="dash-system-row">
                <StatusDot status={status} />
                <span>{name}</span>
                <StatePill tone={statusTone(status)}>{status}</StatePill>
              </div>
            ))}
            <div className="dash-system-row">
              <StatusDot status={state.binance.keysPresent ? (state.binance.connected ? 'live' : 'closed') : 'none'} />
              <span>binance account</span>
              <StatePill tone={accountTone}>{state.binance.keysPresent ? (state.binance.connected ? 'synced' : 'error') : 'no keys'}</StatePill>
            </div>
            <div className="dash-system-row">
              <StatusDot status={state.binance.userStream === 'open' ? 'live' : 'none'} />
              <span>user stream</span>
              <StatePill tone={state.binance.userStream === 'open' ? 'ok' : 'idle'}>{state.binance.userStream}</StatePill>
            </div>
            <div className="dash-system-row">
              <StatusDot status={markets.length > 0 ? 'live' : 'none'} />
              <span>market cache</span>
              <b>{markets.length} rows · {marketsUpdatedAt ? timeAgo(marketsUpdatedAt) : '—'}</b>
            </div>
          </section>

          {sortedHoldings.length > 0 ? (
            <section className="card dash-holdings-card">
              <PanelHead
                icon={<IconWallet />}
                title="Holdings"
                sub={`${sortedHoldings.length} largest balances`}
                action={<button className="sec-link" type="button" onClick={() => setPage('wallets')}>Wallet →</button>}
              />
              <div className="dash-donut-line">
                <Donut slices={acct!.entries.map((e) => ({ label: e.asset, value: e.valueUsdt }))} size={104} />
              </div>
              {sortedHoldings.map((b) => (
                <button key={b.asset} className="dash-asset-row" type="button" onClick={() => openDetail(`${b.asset}USDT`)}>
                  <TokenIcon symbol={`${b.asset}USDT`} size={26} />
                  <span>
                    <b>{b.asset}</b>
                    <em>{fmtQty(b.free + b.locked)}</em>
                  </span>
                  <strong className="num">{fmtPrice(b.valueUsdt)}</strong>
                </button>
              ))}
            </section>
          ) : (
            <section className="card dash-market-card">
              <PanelHead
                icon={<IconRadar />}
                title="Market movers"
                sub="Public data while the account is disconnected."
                action={<button className="sec-link" type="button" onClick={() => setPage('markets')}>Markets →</button>}
              />
              {topMarkets.length === 0 ? (
                <CompactEmpty title="Markets loading" body="The market cache will populate once the public feed responds." />
              ) : (
                topMarkets.map((m) => (
                  <button key={m.symbol} className="dash-asset-row" type="button" onClick={() => openDetail(m.symbol)}>
                    <TokenIcon symbol={m.symbol} size={26} />
                    <span>
                      <b>{m.base}</b>
                      <em>{m.hasPerp ? 'spot + perp' : 'spot'}</em>
                    </span>
                    <strong className={`num ${signClass(m.change24hPct)}`}>{fmtPct(m.change24hPct, 2)}</strong>
                  </button>
                ))
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function PanelHead({ icon, title, sub, action }: { icon: ReactNode; title: string; sub: string; action?: ReactNode }) {
  return (
    <div className="dash-panel-head">
      <span className="dash-panel-icon">{icon}</span>
      <span className="dash-panel-copy">
        <span className="dash-panel-title">{title}</span>
        <span className="dash-panel-sub">{sub}</span>
      </span>
      {action && <span className="dash-panel-action">{action}</span>}
    </div>
  );
}

function ReadinessItem({ icon, label, detail, tone }: { icon: ReactNode; label: string; detail: string; tone: Tone }) {
  return (
    <div className={`dash-readiness-item ${tone}`}>
      <span>{icon}</span>
      <span>
        <b>{label}</b>
        <em>{detail}</em>
      </span>
    </div>
  );
}

function DashMetric({
  icon,
  label,
  value,
  sub,
  tone,
  meter,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub: string;
  tone: Tone;
  meter?: number;
}) {
  return (
    <section className={`dash-metric-card ${tone}`}>
      <span className="dash-metric-icon">{icon}</span>
      <span className="dash-metric-copy">
        <span className="dash-metric-label">{label}</span>
        <span className="dash-metric-value num">{value}</span>
        <span className="dash-metric-sub">{sub}</span>
        {meter !== undefined && (
          <span className="dash-meter"><i style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} /></span>
        )}
      </span>
    </section>
  );
}

function CompactEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="dash-compact-empty">
      <b>{title}</b>
      <span>{body}</span>
    </div>
  );
}
