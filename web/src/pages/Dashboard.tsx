import { useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { TokenIcon } from '../components/TokenIcon';
import { Num } from '../components/Num';
import { Donut } from '../components/Donut';
import { EmptyState, SideTag, WarnStrip } from '../components/ui';
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

type DecisionItem = {
  tone: Tone;
  icon: ReactNode;
  title: string;
  detail: string;
  meta: string;
  action: string;
  primary?: boolean;
  onClick: () => void;
};

type CommandKpi = {
  label: string;
  value: ReactNode;
  sub: string;
  tone: Tone;
  meter?: number;
};

function statusTone(status: string): Tone {
  if (status === 'open' || status === 'live') return 'ok';
  if (status === 'closed' || status === 'failed') return 'bad';
  if (status === 'connecting') return 'warn';
  return 'idle';
}

export function Dashboard() {
  const { state, markets, marketsUpdatedAt, connected, setPage, openTicket, openDetail } = useStore();
  const [quickSymbol, setQuickSymbol] = useState('BTCUSDT');

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
  const accountLine = !state.binance.keysPresent
    ? 'Read keys absent'
    : state.binance.connected
      ? `Synced ${timeAgo(state.binance.lastSyncTs)}`
      : 'Sync failing';
  const postureLine = state.config.killSwitch
    ? 'Safe halt'
    : state.mode === 'LIVE_ARMED'
      ? 'Live armed'
      : 'Manual only';

  const readiness = [
    {
      label: 'Market stream',
      detail: connected ? `${feedLive}/${feedEntries.length} feeds` : 'reconnecting',
      tone: connected && feedLive > 0 ? 'ok' : 'warn',
      icon: <IconWifi />,
    },
    {
      label: 'Server keys',
      detail: state.binance.keysPresent ? 'env ready' : 'not set',
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
      detail: state.binance.canWithdraw === true ? 'permission on' : 'disabled',
      tone: state.binance.canWithdraw === true ? 'bad' : 'ok',
      icon: <IconPower />,
    },
    {
      label: 'Risk gate',
      detail: `${fmtPrice(state.config.maxOrderNotionalUsd)} cap`,
      tone: 'ok',
      icon: <IconShield />,
    },
    {
      label: 'Kill switch',
      detail: state.config.killSwitch ? 'blocking sends' : 'manual ready',
      tone: state.config.killSwitch ? 'warn' : 'ok',
      icon: <IconPulse />,
    },
  ] satisfies { label: string; detail: string; tone: Tone; icon: ReactNode }[];
  const readinessScore = readiness.filter((r) => r.tone === 'ok').length;
  const readinessWaiting = readiness.filter((r) => r.tone === 'idle').length;
  const readinessAttention = readiness.filter((r) => r.tone === 'warn' || r.tone === 'bad').length;

  const sortedHoldings = acct?.entries.slice().sort((a, z) => z.valueUsdt - a.valueUsdt).slice(0, 5) ?? [];
  const topProposals = state.proposals.slice(0, 5);
  const recentEvents = state.events.slice(0, 9);
  const topMover = topMarkets[0] ?? null;
  const primaryProposal = topProposals[0] ?? null;
  const decisionItems: DecisionItem[] = [
    !state.binance.keysPresent
      ? {
          tone: 'warn',
          icon: <IconKey />,
          title: 'Connect read-only Binance',
          detail: 'Unlock balances, orders, fills, and equity snapshots without any browser key form.',
          meta: 'setup first',
          action: 'Account setup',
          primary: true,
          onClick: () => setPage('account'),
        }
      : !state.binance.connected
        ? {
            tone: 'bad',
            icon: <IconWifi />,
            title: 'Fix account sync',
            detail: state.binance.lastError ?? 'Keys exist, but account polling is not healthy.',
            meta: 'attention',
            action: 'System health',
            primary: true,
            onClick: () => setPage('system'),
          }
        : {
            tone: 'ok',
            icon: <IconWallet />,
            title: 'Account sync is live',
            detail: `Balances and orders last synced ${timeAgo(state.binance.lastSyncTs)}.`,
            meta: 'ready',
            action: 'Wallets',
            primary: true,
            onClick: () => setPage('wallets'),
          },
    state.config.killSwitch
      ? {
          tone: 'warn',
          icon: <IconShield />,
          title: 'Kill switch is blocking live sends',
          detail: 'This is safe by default. Use Risk only when you intentionally want manual live mode.',
          meta: 'halted',
          action: 'Risk gate',
          onClick: () => setPage('risk'),
        }
      : {
          tone: state.mode === 'LIVE_ARMED' ? 'ok' : 'warn',
          icon: <IconTicket />,
          title: state.mode === 'LIVE_ARMED' ? 'Manual live flow armed' : 'Manual mode ready',
          detail: `Allowlist has ${state.config.allowedSymbols.length} symbols; every send still needs typed confirmation.`,
          meta: state.mode === 'LIVE_ARMED' ? 'armed' : 'manual',
          action: 'New ticket',
          onClick: () => openTicket({ symbol: quickSymbol.trim() || 'BTCUSDT', side: 'BUY', source: 'manual' }),
        },
    primaryProposal
      ? {
          tone: 'warn',
          icon: <IconRadar />,
          title: `${baseOf(primaryProposal.symbol)} basis proposal`,
          detail: `${primaryProposal.side === 'SHORT_PERP_LONG_SPOT' ? 'Short perp / long spot' : 'Long perp / short spot'} at ${fmtBasis(primaryProposal.basisNow, 2)}.`,
          meta: 'proposal',
          action: 'Review',
          onClick: () => setPage('opportunities'),
        }
      : {
          tone: 'idle',
          icon: <IconBrain />,
          title: 'No proposal needs approval',
          detail: `Scanner is watching ${state.scanner.watching} pairs; threshold ${fmtBasis(state.scanner.grossThresholdPct, 2)}.`,
          meta: 'scanning',
          action: 'Strategies',
          onClick: () => setPage('strategies'),
        },
    state.recentFills.length
      ? {
          tone: 'ok',
          icon: <IconReceipt />,
          title: 'Recent fills are ledgered',
          detail: `${state.recentFills.length} latest fills are feeding PnL and position cost basis.`,
          meta: 'audit',
          action: 'Open fills',
          onClick: () => setPage('fills'),
        }
      : {
          tone: 'idle',
          icon: <IconReceipt />,
          title: 'Fill history not loaded',
          detail: 'Import symbol history after keys are set so PnL and average cost stop showing blanks.',
          meta: 'cost basis',
          action: 'Fills',
          onClick: () => setPage('fills'),
        },
    topMover
      ? {
          tone: Math.abs(topMover.change24hPct ?? 0) > 10 ? 'warn' : 'ok',
          icon: <IconPulse />,
          title: `${topMover.base} is moving`,
          detail: `${topMover.hasPerp ? 'spot + perp' : 'spot only'} · 24h change ${fmtPct(topMover.change24hPct, 2)}.`,
          meta: 'market',
          action: 'Inspect',
          onClick: () => openDetail(topMover.symbol),
        }
      : {
          tone: 'idle',
          icon: <IconPulse />,
          title: 'Market cache warming up',
          detail: 'Public Binance rows populate here as the market engine streams.',
          meta: 'market',
          action: 'Markets',
          onClick: () => setPage('markets'),
      },
  ];
  const commandKpis: CommandKpi[] = [
    {
      label: 'Free USDT',
      value: acct ? <Num value={acct.availableUsdt}>{fmtPrice(acct.availableUsdt)}</Num> : 'read keys',
      sub: acct ? 'available balance' : 'server-side only',
      tone: acct ? 'ok' : 'idle',
    },
    {
      label: 'Day PnL',
      value: acct ? (
        <span className={signClass(acct.dayChangeUsd ?? acct.realizedTodayUsd)}>
          {acct.dayChangeUsd !== null ? fmtPrice(acct.dayChangeUsd) : fmtPrice(acct.realizedTodayUsd)}
        </span>
      ) : 'pending',
      sub: dayPct !== null ? fmtPct(dayPct, 2) : 'fills/equity needed',
      tone: acct ? ((acct.dayChangeUsd ?? acct.realizedTodayUsd) >= 0 ? 'ok' : 'bad') : 'idle',
    },
    {
      label: 'Orders',
      value: String(state.openOrders.length),
      sub: state.binance.keysPresent ? 'open account orders' : 'unloaded',
      tone: state.openOrders.length ? 'warn' : 'idle',
    },
    {
      label: 'Exposure',
      value: acct ? fmtPrice(exposure) : 'pending',
      sub: `${state.positions.length} position${state.positions.length === 1 ? '' : 's'}`,
      tone: exposure > 0 ? 'warn' : 'idle',
    },
    {
      label: 'Risk used',
      value: fmtPrice(state.risk.dailyNotionalUsedUsd),
      sub: `${Math.round(dailyRiskPct)}% of ${fmtPrice(state.config.maxDailyNotionalUsd)}`,
      tone: dailyRiskPct > 80 ? 'bad' : dailyRiskPct > 50 ? 'warn' : 'ok',
      meter: dailyRiskPct,
    },
    {
      label: 'Proposals',
      value: String(state.proposals.length),
      sub: `${state.scanner.watching} watched pairs`,
      tone: state.proposals.length > 0 ? 'warn' : 'idle',
    },
  ];

  return (
    <div className="container page dashboard-page">
      <div className="page-head dashboard-head">
        <div>
          <div className="page-kicker">Dashboard</div>
          <h1 className="page-title">Account cockpit</h1>
          <div className="page-sub">
            {state.scanner.pairs} pairs scanned · tick {scannerAge} · {accountLine}
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

      <section className={`card dash-command-center mode-${state.mode.toLowerCase()}`}>
        <div className="dash-command-top">
          <div className="dash-truth-panel">
            <div className="dash-truth-meta">
              <span className={`dash-mode-text ${modeTone}`}>{postureLine}</span>
              <span>{state.config.killSwitch ? 'kill switch on' : 'kill switch off'}</span>
              <span>{state.config.allowedSymbols.length} allowed</span>
            </div>
            <div className="dash-truth-main">
              <span>{acct ? 'Total equity' : 'Account sync'}</span>
              {acct ? (
                <b className="num"><Num value={acct.totalUsdt}>{fmtPrice(acct.totalUsdt)}</Num></b>
              ) : (
                <b className="dash-truth-empty">{accountLine}</b>
              )}
              <em>
                {acct?.dayChangeUsd !== null && acct?.dayChangeUsd !== undefined
                  ? `${acct.dayChangeUsd >= 0 ? '+' : '-'}${fmtPrice(Math.abs(acct.dayChangeUsd))}${dayPct !== null ? ` ${fmtPct(dayPct, 2)}` : ''} today`
                  : 'Public data is live; balances, orders, fills, and equity unlock only after server-side read keys.'}
              </em>
            </div>
            {!state.binance.keysPresent && (
              <div className="dash-truth-note">
                No browser key form. No withdrawals. Configure read keys only on the server.
              </div>
            )}
          </div>

          <aside className="dash-posture-panel">
            <div className="dash-posture-score">
              <span>Posture</span>
              <b className="num">{readinessScore}/{readiness.length}</b>
              <em>{readinessAttention} attention · {readinessWaiting} waiting</em>
            </div>
            <div className="dash-posture-list">
              {readiness.map((item) => (
                <ReadinessItem key={item.label} {...item} />
              ))}
            </div>
          </aside>
        </div>

        <div className="dash-kpi-strip">
          {commandKpis.map((item) => (
            <CommandKpi key={item.label} {...item} />
          ))}
        </div>

        <div className="dash-decision-stack">
          <div className="dash-decision-head">
            <div>
              <span>Decision stack</span>
              <h2>Next action</h2>
            </div>
            <button className="sec-link" type="button" onClick={() => setPage('opportunities')}>
              Open queue →
            </button>
          </div>
          <div className="dash-decision-grid">
            {decisionItems.map((item, idx) => (
              <button
                key={`${item.meta}-${item.title}`}
                className={`dash-decision-item ${item.tone} ${item.primary ? 'primary' : ''}`}
                type="button"
                onClick={item.onClick}
              >
                <span className="dash-decision-rank num">{String(idx + 1).padStart(2, '0')}</span>
                <span className="dash-decision-icon">{item.icon}</span>
                <span className="dash-decision-copy">
                  <span className="dash-decision-meta">{item.meta}</span>
                  <b>{item.title}</b>
                  <em>{item.detail}</em>
                </span>
                <span className="dash-decision-action">{item.action}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

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
              <span>Basis monitor</span>
              <b>{state.proposals.length} proposing</b>
            </div>
            <div className="dash-system-row">
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
              <div key={name} className={`dash-system-row tone-${statusTone(status)}`}>
                <span>{name}</span>
                <b>{status}</b>
              </div>
            ))}
            <div className={`dash-system-row tone-${accountTone}`}>
              <span>binance account</span>
              <b>{state.binance.keysPresent ? (state.binance.connected ? 'synced' : 'error') : 'no keys'}</b>
            </div>
            <div className={`dash-system-row tone-${state.binance.userStream === 'open' ? 'ok' : 'idle'}`}>
              <span>user stream</span>
              <b>{state.binance.userStream}</b>
            </div>
            <div className={`dash-system-row tone-${markets.length > 0 ? 'ok' : 'idle'}`}>
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

function CommandKpi({
  label,
  value,
  sub,
  tone,
  meter,
}: {
  label: string;
  value: ReactNode;
  sub: string;
  tone: Tone;
  meter?: number;
}) {
  return (
    <section className={`dash-command-kpi ${tone}`}>
      <span className="dash-kpi-label">{label}</span>
      <b className="dash-kpi-value num">{value}</b>
      <span className="dash-kpi-sub">{sub}</span>
        {meter !== undefined && (
          <span className="dash-meter"><i style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} /></span>
        )}
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
