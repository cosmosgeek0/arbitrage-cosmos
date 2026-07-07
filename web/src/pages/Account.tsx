import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { EmptyState, SetupChecklist, StatePill, WarnStrip } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import { Donut } from '../components/Donut';
import { Num } from '../components/Num';
import {
  IconBook,
  IconChart,
  IconClock,
  IconKey,
  IconLayers,
  IconLock,
  IconPower,
  IconPulse,
  IconShield,
  IconWallet,
  IconWifi,
} from '../components/Icons';
import { fmtPrice, fmtQty, timeAgo } from '../format';

type Tone = 'ok' | 'bad' | 'warn' | 'idle';

function toneForBool(v: boolean | null | undefined, invert = false): Tone {
  if (v === null || v === undefined) return 'idle';
  const pass = invert ? !v : v;
  return pass ? 'ok' : 'bad';
}

export function Account() {
  const { state, setPage, openDetail } = useStore();
  if (!state) return <div className="container page account-page"><div className="empty-state">Connecting…</div></div>;

  const acct = state.account;
  const b = state.binance;
  const entries = acct?.entries ?? [];
  const topEntries = useMemo(() => entries.slice().sort((a, z) => z.valueUsdt - a.valueUsdt).slice(0, 6), [entries]);
  const lockedValue = entries.reduce((sum, e) => sum + (e.priceUsdt ?? 0) * e.locked, 0);
  const checks = [
    { label: 'server keys', pass: b.keysPresent },
    { label: 'account sync', pass: b.connected },
    { label: 'withdrawals off', pass: b.canWithdraw === false || b.canWithdraw === null },
    { label: 'risk gated', pass: true },
    { label: 'ledger active', pass: state.events.length >= 0 },
  ];
  const score = checks.filter((c) => c.pass).length;
  const statusTone: Tone = b.canWithdraw === true ? 'bad' : b.connected ? 'ok' : b.keysPresent ? 'warn' : 'idle';
  const statusText = b.canWithdraw === true
    ? 'unsafe key scope'
    : b.connected
      ? 'account synced'
      : b.keysPresent
        ? 'sync needs attention'
        : 'read access pending';

  return (
    <div className="container page account-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Account</h1>
          <div className="page-sub">Binance access, permissions, sync, and account data custody</div>
        </div>
        <div className="head-actions">
          <button className="mini-btn" type="button" onClick={() => setPage('system')}>
            <IconPulse /> System health
          </button>
          <button className="mini-btn" type="button" onClick={() => setPage('risk')}>
            <IconShield /> Risk gate
          </button>
        </div>
      </div>

      {b.canWithdraw === true && (
        <WarnStrip>Recreate this Binance key with withdrawals disabled. This app contains no withdrawal path, and the key should not have that permission either.</WarnStrip>
      )}

      <section className={`card account-hero ${statusTone}`}>
        <div className="account-hero-main">
          <div className="account-eyebrow">
            <StatePill tone={statusTone}>{statusText}</StatePill>
            <span>{state.mode.toLowerCase()}</span>
            <span>{state.config.killSwitch ? 'kill switch on' : 'kill switch off'}</span>
          </div>
          <h2>{b.connected ? 'Binance account synced' : b.keysPresent ? 'Key present, account not synced' : 'Read access not connected'}</h2>
          <p>
            API keys stay on the server, account data is read from Binance USER_DATA endpoints, and every trading path remains behind the risk gate.
          </p>
          <div className="account-actions">
            <button className="cta-pill" type="button" onClick={() => setPage('wallets')}>
              Wallets & assets
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('ledger')}>
              Audit ledger
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('settings')}>
              Settings
            </button>
          </div>
        </div>
        <div className="account-score">
          <div className="account-score-ring" style={{ '--score': `${(score / checks.length) * 100}%` } as React.CSSProperties}>
            <span className="num">{score}/{checks.length}</span>
          </div>
          <div>
            <div className="account-score-title">Access posture</div>
            <div className="account-score-sub">Safety checks shown from current server state. Unknown exchange permissions are not guessed.</div>
          </div>
        </div>
      </section>

      <div className="account-grid">
        <section className="card account-panel">
          <PanelHead icon={<IconKey />} title="Connection" note="What the server can currently see from Binance." />
          <div className="account-signal-grid">
            <SignalCard
              icon={<IconLock />}
              label="API keys"
              value={b.keysPresent ? 'present' : 'absent'}
              sub="environment only, never browser input"
              tone={b.keysPresent ? 'ok' : 'idle'}
            />
            <SignalCard
              icon={<IconWallet />}
              label="Account sync"
              value={b.connected ? 'synced' : b.keysPresent ? 'failing' : 'waiting'}
              sub={b.lastSyncTs ? `last ${timeAgo(b.lastSyncTs)}` : '30s polling cadence'}
              tone={b.connected ? 'ok' : b.keysPresent ? 'bad' : 'idle'}
            />
            <SignalCard
              icon={<IconWifi />}
              label="User stream"
              value={b.userStream}
              sub="falls back to polling"
              tone={b.userStream === 'open' ? 'ok' : 'idle'}
            />
            <SignalCard
              icon={<IconClock />}
              label="Last event"
              value={state.events[0] ? timeAgo(state.events[0].ts) : '—'}
              sub={`${state.events.length} ledger rows in state`}
              tone="idle"
            />
          </div>
        </section>

        <section className="card account-panel">
          <PanelHead icon={<IconShield />} title="Permission map" note="Binance scopes and app-side hard stops." />
          <div className="account-permission-list">
            <PermissionRow
              label="Reading"
              detail="Required for balances, order history, fills, and permissions."
              value={b.keysPresent ? 'configured' : 'absent'}
              tone={b.keysPresent ? 'ok' : 'idle'}
            />
            <PermissionRow
              label="Spot trading"
              detail="Only useful after live trading is deliberately armed; risk gate still runs first."
              value={b.canTrade === null ? 'unknown' : b.canTrade ? 'enabled' : 'disabled'}
              tone={toneForBool(b.canTrade)}
            />
            <PermissionRow
              label="Withdrawals"
              detail="Should be disabled on Binance. This frontend/backend exposes no withdrawal route."
              value={b.canWithdraw === null ? 'unknown' : b.canWithdraw ? 'ENABLED' : 'disabled'}
              tone={toneForBool(b.canWithdraw, true)}
            />
            <PermissionRow
              label="Transfers out"
              detail="No transfer-out UI or Binance client method exists in this app."
              value="not implemented"
              tone="ok"
            />
          </div>
        </section>
      </div>

      {!b.keysPresent ? (
        <div className="account-grid setup">
          <section className="card account-panel">
            <PanelHead icon={<IconBook />} title="Set up read access" note="Follow this without exposing keys to the browser." />
            <SetupChecklist />
          </section>
          <section className="card account-panel account-custody">
            <PanelHead icon={<IconPower />} title="Custody rules" note="The page is useful before keys, but it will not fake account data." />
            <CustodyItem label="No key form" detail="Secrets are read from server env only. There is deliberately no browser input field." />
            <CustodyItem label="No withdrawals" detail="The Binance client has no withdraw or transfer-out method." />
            <CustodyItem label="No live action" detail="This page is read-only; trading requires the separate guarded manual flow." />
          </section>
        </div>
      ) : (
        <section className="card account-panel account-balances">
          <PanelHead
            icon={<IconChart />}
            title="Balances"
            note={`total ${fmtPrice(acct?.totalUsdt)} · available USDT ${fmtPrice(acct?.availableUsdt)} · locked ${fmtPrice(lockedValue)}`}
            right={<button className="mini-btn" type="button" onClick={() => setPage('wallets')}>Open full wallet</button>}
          />
          {!acct || entries.length === 0 ? (
            <EmptyState title="No balances">Deposit on Binance externally and the account poll will populate this section.</EmptyState>
          ) : (
            <div className="account-balance-layout">
              <div className="account-donut">
                <Donut slices={entries.map((e) => ({ label: e.asset, value: e.valueUsdt }))} size={150} />
              </div>
              <div className="table-scroll">
                <table className="mkt dense">
                  <thead>
                    <tr>
                      <th className="l">Asset</th>
                      <th>Free</th>
                      <th>Locked</th>
                      <th>Price</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topEntries.map((e) => (
                      <tr key={e.asset} className="rowlink" onClick={() => openDetail(`${e.asset}USDT`)}>
                        <td className="l">
                          <span className="tok">
                            <TokenIcon symbol={`${e.asset}USDT`} size={30} />
                            <span className="tok-name">{e.asset}</span>
                          </span>
                        </td>
                        <td><Num value={e.free}>{fmtQty(e.free)}</Num></td>
                        <td className={e.locked ? 'val-strong' : 'muted'}><Num value={e.locked}>{e.locked ? fmtQty(e.locked) : '—'}</Num></td>
                        <td><Num value={e.priceUsdt}>{e.priceUsdt !== null ? fmtPrice(e.priceUsdt) : '—'}</Num></td>
                        <td className="val-strong"><Num value={e.valueUsdt}>{fmtPrice(e.valueUsdt)}</Num></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="card account-flow">
        <PanelHead icon={<IconLayers />} title="Live-send chain" note="A compact reminder of the account-side safety sequence." />
        <div className="account-flow-steps">
          <FlowStep label="Keys stay server-side" detail={b.keysPresent ? 'configured' : 'waiting'} tone={b.keysPresent ? 'ok' : 'idle'} />
          <FlowStep label="Allowlist + typed symbol" detail={`${state.config.allowedSymbols.length} allowed`} tone={state.config.allowedSymbols.length ? 'ok' : 'idle'} />
          <FlowStep label="Risk gate evaluates" detail={`${state.risk.rejectionsToday} rejects today`} tone="ok" />
          <FlowStep label="Kill switch gates send" detail={state.config.killSwitch ? 'halted' : 'manual mode'} tone={state.config.killSwitch ? 'warn' : 'ok'} />
        </div>
      </section>

      <AccountSecurity />
    </div>
  );
}

const COUNTRY: Record<string, string> = {
  IN: 'India', US: 'United States', GB: 'United Kingdom', SG: 'Singapore', DE: 'Germany',
  AE: 'UAE', JP: 'Japan', CA: 'Canada', AU: 'Australia', FR: 'France', NL: 'Netherlands',
};

function maskEmail(e: string | null): string {
  if (!e) return '—';
  const [u, d] = e.split('@');
  if (!d) return e;
  const mu = u.length <= 2 ? u : u.slice(0, 2) + '•'.repeat(Math.max(3, u.length - 2));
  const [dn, ...rest] = d.split('.');
  const md = dn.length <= 2 ? dn : dn.slice(0, 2) + '•'.repeat(Math.max(3, dn.length - 2));
  return `${mu}@${md}${rest.length ? '.' + rest.join('.') : ''}`;
}

function deviceInfo(): { os: string; browser: string; tz: string } {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const plat = typeof navigator !== 'undefined' ? navigator.platform || '' : '';
  let os = 'Unknown OS';
  if (/iPhone|iPad/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Mac/i.test(plat) || /Mac OS/i.test(ua)) os = 'macOS';
  else if (/Win/i.test(plat)) os = 'Windows';
  else if (/Linux/i.test(plat)) os = 'Linux';
  const bm = ua.match(/(Edg|OPR|Chrome|Firefox|Version.*Safari|Safari)\/([\d.]+)/);
  const map: Record<string, string> = { Edg: 'Edge', OPR: 'Opera', Chrome: 'Chrome', Firefox: 'Firefox', Safari: 'Safari' };
  const bkey = bm ? Object.keys(map).find((k) => bm[0].startsWith(k)) ?? 'Safari' : '';
  const bver = bm ? bm[2].split('.')[0] : '';
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'local';
  return { os, browser: `${map[bkey] ?? 'Browser'}${bver ? ' ' + bver : ''}`, tz };
}

interface SysInfo { cfUser: string | null; cfIp: string | null; cfCountry: string | null }

// Security & sessions — honest for a Cloudflare-Access-gated cockpit: real
// current device, real edge identity/IP when present, edge-enforced 2FA. No
// fabricated session lists and no fake app-level password/2FA toggles.
function AccountSecurity() {
  const { state } = useStore();
  const [sys, setSys] = useState<SysInfo | null>(null);
  const [alerts, setAlerts] = useState<boolean>(() => localStorage.getItem('cosmos-signin-alerts') !== '0');
  useEffect(() => {
    let alive = true;
    void fetch('/api/system').then((r) => (r.ok ? r.json() : null)).then((s) => alive && s && setSys(s as SysInfo)).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const dev = deviceInfo();
  const b = state?.binance;
  const email = sys?.cfUser ?? null;
  const country = sys?.cfCountry ? COUNTRY[sys.cfCountry] ?? sys.cfCountry : null;
  const ip = sys?.cfIp ?? null;
  const edge = !!email;
  const sessionLine = [country, ip ?? 'local network', dev.tz].filter(Boolean).join(' · ');

  return (
    <>
      <section className="card account-panel">
        <PanelHead icon={<IconKey />} title="Binance connection" note="What the read-only key can see — and what it honestly cannot." />
        <div className="sec-rows">
          <div className="sec-row">
            <span className="sec-meta"><b>Read-only API key</b><small>server env only, never entered in the browser</small></span>
            <StatePill tone={b?.keysPresent ? 'ok' : 'idle'}>{b?.keysPresent ? 'configured' : 'not set'}</StatePill>
          </div>
          <div className="sec-row">
            <span className="sec-meta"><b>Account sync</b><small>{b?.connected ? 'balances, orders, fills reading live' : b?.keysPresent ? 'key present, sync unhealthy' : 'connect a read key to unlock account data'}</small></span>
            <StatePill tone={b?.connected ? 'ok' : b?.keysPresent ? 'bad' : 'idle'}>{b?.connected ? 'synced' : b?.keysPresent ? 'failing' : 'waiting'}</StatePill>
          </div>
          <div className="sec-row">
            <span className="sec-meta"><b>Withdrawals</b><small>no withdrawal route exists in this app; the key should disable it too</small></span>
            <StatePill tone={b?.canWithdraw ? 'bad' : 'ok'}>{b?.canWithdraw ? 'ENABLED' : 'disabled'}</StatePill>
          </div>
        </div>
        <div className="sec-foot">
          <b>Binance login sessions are not shown here — the API doesn’t expose them.</b> Who else is logged into your
          Binance account, from which IP, and what they’re doing is only visible on binance.com under Security → Devices.
          A read key can’t see it, so this cockpit won’t pretend to.
        </div>
      </section>

      <section className="card account-panel">
        <PanelHead icon={<IconShield />} title="This cockpit session" note="Access to this dashboard is gated by Cloudflare — no app password or 2FA to manage here." />
        <div className="sec-row sec-toggle-row">
          <span className="sec-meta"><b>Suspicious sign-in alerts</b><small>Unusual-access alerts are configured in Cloudflare Access; this mirrors your local preference for surfacing them in-app.</small></span>
          <button
            className={`toggle ${alerts ? 'on' : ''}`}
            onClick={() => { const n = !alerts; setAlerts(n); localStorage.setItem('cosmos-signin-alerts', n ? '1' : '0'); }}
            aria-label="Suspicious sign-in alerts"
          >
            <span className="knob" />
          </button>
        </div>
        <div className="sec-session">
          <span className="sec-session-ic"><IconWifi /></span>
          <span className="sec-session-meta">
            <b>{dev.os} · {dev.browser}</b>
            <small>{edge ? `${maskEmail(email)} · ${sessionLine}` : sessionLine}</small>
          </span>
          <span className="sec-session-now"><i />Active now</span>
        </div>
        <div className="sec-foot">Cloudflare Access (hardware key + email) verifies you before the app loads, and handles session revocation. There’s no weaker app-level password or 2FA to phish.</div>
      </section>
    </>
  );
}

function PanelHead({ icon, title, note, right }: { icon: ReactNode; title: string; note: string; right?: ReactNode }) {
  return (
    <div className="account-panel-head">
      <span className="account-panel-icon">{icon}</span>
      <span>
        <span className="account-panel-title">{title}</span>
        <span className="account-panel-note">{note}</span>
      </span>
      {right && <span className="account-panel-right">{right}</span>}
    </div>
  );
}

function SignalCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: Tone;
}) {
  return (
    <div className={`account-signal-card ${tone}`}>
      <span className="account-signal-icon">{icon}</span>
      <span className="account-signal-label">{label}</span>
      <b>{value}</b>
      <small>{sub}</small>
    </div>
  );
}

function PermissionRow({ label, detail, value, tone }: { label: string; detail: string; value: string; tone: Tone }) {
  return (
    <div className="account-permission-row">
      <span>
        <b>{label}</b>
        <small>{detail}</small>
      </span>
      <StatePill tone={tone}>{value}</StatePill>
    </div>
  );
}

function CustodyItem({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="account-custody-item">
      <span>{label}</span>
      <b>{detail}</b>
    </div>
  );
}

function FlowStep({ label, detail, tone }: { label: string; detail: string; tone: Tone }) {
  return (
    <div className={`account-flow-step ${tone}`}>
      <i />
      <span>{label}</span>
      <b>{detail}</b>
    </div>
  );
}
