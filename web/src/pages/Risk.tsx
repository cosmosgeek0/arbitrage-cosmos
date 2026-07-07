import { useState, type ReactNode } from 'react';
import { ConfirmModal } from '../components/Modal';
import {
  IconActivity,
  IconAlert,
  IconBook,
  IconChart,
  IconClock,
  IconList,
  IconLock,
  IconPulse,
  IconSearch,
  IconShield as IconShieldLine,
} from '../components/Icons';
import { IconPower, IconZapOff } from '../components/RiskIcons';
import { TokenIcon } from '../components/TokenIcon';
import { StatePill } from '../components/ui';
import { fmtDateTime, fmtPrice, timeAgo } from '../format';
import { useStore } from '../store';
import type { AppConfig, LedgerEvent, PreviewResult, RiskCheck } from '../types';

type RiskTone = 'ok' | 'bad' | 'warn' | 'idle';
type LimitKey =
  | 'maxOrderNotionalUsd'
  | 'maxDailyNotionalUsd'
  | 'maxDailyLossUsd'
  | 'maxOpenOrders'
  | 'cooldownSec'
  | 'staleOrderMaxMin';
type LimitDraft = Partial<Record<LimitKey, string>>;

const LIMIT_FIELDS: {
  key: LimitKey;
  label: string;
  serverName: string;
  unit: string;
  min: number;
  step: string;
  reason: string;
}[] = [
  {
    key: 'maxOrderNotionalUsd',
    label: 'Max order notional',
    serverName: 'maxOrderNotionalUsd',
    unit: 'USD',
    min: 0,
    step: '0.01',
    reason: 'Single-order hard cap.',
  },
  {
    key: 'maxDailyNotionalUsd',
    label: 'Max daily notional',
    serverName: 'maxDailyNotionalUsd',
    unit: 'USD',
    min: 0,
    step: '0.01',
    reason: 'UTC day order cap.',
  },
  {
    key: 'maxDailyLossUsd',
    label: 'Max daily loss',
    serverName: 'maxDailyLossUsd',
    unit: 'USD',
    min: 0,
    step: '0.01',
    reason: 'Daily loss stop.',
  },
  {
    key: 'maxOpenOrders',
    label: 'Max open orders',
    serverName: 'maxOpenOrders',
    unit: 'count',
    min: 0,
    step: '1',
    reason: 'Concurrent order cap.',
  },
  {
    key: 'cooldownSec',
    label: 'Cooldown',
    serverName: 'cooldownSec',
    unit: 'sec',
    min: 0,
    step: '1',
    reason: 'Minimum time between orders.',
  },
  {
    key: 'staleOrderMaxMin',
    label: 'Stale order max age',
    serverName: 'staleOrderMaxMin',
    unit: 'min',
    min: 1,
    step: '1',
    reason: 'Stale open-order flag.',
  },
];

const UNWIRED_LIMITS = [
  { label: 'Max symbol exposure', unit: 'USD', reason: 'Server config does not expose this limit.' },
  { label: 'Max open positions', unit: 'count', reason: 'Position-count guard is not wired.' },
  { label: 'Order rate', unit: 'per min', reason: 'Order-rate throttle is not wired.' },
  { label: 'Spread guard', unit: 'pct', reason: 'Spread guard is not wired.' },
  { label: 'Slippage guard', unit: 'pct', reason: 'Depth and slippage guard is not wired.' },
  { label: 'Borrow cap', unit: 'USD', reason: 'Borrow cap is not wired.' },
];

const RISK_CHECK_LABELS: Record<string, string> = {
  kill_switch_off: 'Kill switch',
  live_trading_enabled: 'Live trading',
  symbol_allowed: 'Allowed symbols',
  symbol_blocked: 'Blocked symbols',
  max_order_notional: 'Order size',
  max_daily_notional: 'Daily notional',
  max_daily_loss: 'Daily loss',
  max_open_orders: 'Open orders',
  cooldown: 'Cooldown',
  exchange_filters: 'Exchange filters',
  stale_order: 'Stale order',
};

const STAGE_LABELS: Record<string, string> = {
  risk_decision: 'Risk decision',
  preview: 'Preview',
  order_intent: 'Order intent',
  order_request: 'Order request',
  order_response: 'Order response',
};

function sanitizeSymbol(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}

function uniqueSymbols(list: string[]): string[] {
  return [...new Set(list.map(sanitizeSymbol).filter((s) => s.length >= 4))];
}

function configNumber(cfg: AppConfig, key: LimitKey): number {
  const value = cfg[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function limitValue(cfg: AppConfig, draft: LimitDraft, key: LimitKey): string {
  return draft[key] ?? String(configNumber(cfg, key));
}

function parseLimitDraft(draft: LimitDraft): Partial<AppConfig> {
  const patch: Partial<AppConfig> = {};
  for (const field of LIMIT_FIELDS) {
    if (draft[field.key] === undefined) continue;
    const value = Number(draft[field.key]);
    if (Number.isFinite(value)) {
      (patch as Record<LimitKey, number>)[field.key] = value;
    }
  }
  return patch;
}

function checkTone(pass: boolean): RiskTone {
  return pass ? 'ok' : 'bad';
}

function sentenceCase(value: string): string {
  const text = value.trim();
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function cleanRiskText(value: string): string {
  return sentenceCase(
    value
      .replace(/_/g, ' ')
      .replace(/\bmaxOrderNotionalUsd\b/g, 'per-order limit')
      .replace(/\bmaxDailyNotionalUsd\b/g, 'daily notional limit')
      .replace(/\bmaxDailyLossUsd\b/g, 'daily loss limit')
      .replace(/\bmaxOpenOrders\b/g, 'open-order limit')
      .replace(/\bcooldownSec\b/g, 'cooldown')
      .replace(/\bstaleOrderMaxMin\b/g, 'stale order limit')
      .replace(/\border_response\b/g, 'order response')
      .replace(/\brisk_decision\b/g, 'risk decision'),
  );
}

function riskCheckLabel(name: string): string {
  return RISK_CHECK_LABELS[name] ?? sentenceCase(name.replace(/_/g, ' '));
}

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? sentenceCase(stage.replace(/_/g, ' '));
}

function dataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function riskDecisionData(ev: LedgerEvent): { allowed: boolean | null; stage: string; reasons: string[] } {
  const data = dataRecord(ev.data);
  const rawReasons = data?.reasons;
  return {
    allowed: data?.allowed === true ? true : data?.allowed === false ? false : null,
    stage: typeof data?.stage === 'string' ? data.stage : 'risk_decision',
    reasons: Array.isArray(rawReasons) ? rawReasons.filter((x): x is string => typeof x === 'string') : [],
  };
}

function StatusLine({
  label,
  detail,
  tone,
  icon,
}: {
  label: string;
  detail: ReactNode;
  tone: RiskTone;
  icon?: ReactNode;
}) {
  return (
    <li className={`risk-status-line ${tone}`}>
      <span className="risk-status-mark">{icon ?? (tone === 'ok' ? 'Pass' : tone === 'bad' ? 'Fail' : 'Wait')}</span>
      <b>{label}</b>
      <em>{detail}</em>
    </li>
  );
}

function RiskFact({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  tone: RiskTone;
}) {
  return (
    <div className={`risk-fact ${tone}`}>
      <span>{label}</span>
      <b>{value}</b>
      <em>{detail}</em>
    </div>
  );
}

function RiskCheckTable({ checks }: { checks: RiskCheck[] }) {
  if (checks.length === 0) {
    return <div className="risk-empty-inline">No risk checks returned by preview.</div>;
  }
  return (
    <div className="risk-table-wrap">
      <table className="risk-check-table">
        <thead>
          <tr>
            <th>Check</th>
            <th>Status</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.name} className={c.pass ? 'risk-row-pass' : 'risk-row-fail'}>
              <td>{riskCheckLabel(c.name)}</td>
              <td>
                <span className={`risk-check-badge ${c.pass ? 'ok' : 'bad'}`}>{c.pass ? 'Pass' : 'Fail'}</span>
              </td>
              <td>{cleanRiskText(c.detail)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Risk() {
  const { state, saveConfig, setKill, setLive, preview, setPage } = useStore();
  const [draft, setDraft] = useState<LimitDraft>({});
  const [allowInput, setAllowInput] = useState('');
  const [blockInput, setBlockInput] = useState('');
  const [probeSymbol, setProbeSymbol] = useState('BTCUSDT');
  const [probeNotional, setProbeNotional] = useState('10');
  const [probeSide, setProbeSide] = useState<'BUY' | 'SELL'>('BUY');
  const [probeResult, setProbeResult] = useState<PreviewResult | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [modal, setModal] = useState<'resume' | 'arm' | null>(null);
  const [saved, setSaved] = useState(false);

  if (!state) {
    return (
      <div className="container page risk-page">
        <div className="empty-state">Connecting...</div>
      </div>
    );
  }

  const cfg = state.config;
  const perOrderLimit = configNumber(cfg, 'maxOrderNotionalUsd');
  const dailyLimit = configNumber(cfg, 'maxDailyNotionalUsd');
  const dailyUsed = state.risk.dailyNotionalUsedUsd;
  const dailyRemaining = dailyLimit > 0 ? Math.max(0, dailyLimit - dailyUsed) : 0;
  const openOrderLimit = configNumber(cfg, 'maxOpenOrders');
  const openOrdersCount = state.openOrders.length;
  const cooldownLeft =
    state.risk.lastOrderTs && cfg.cooldownSec > 0
      ? Math.max(0, Math.ceil((state.risk.lastOrderTs + cfg.cooldownSec * 1000 - Date.now()) / 1000))
      : 0;

  const posture: 'HALTED' | 'PAPER' | 'LIVE' = cfg.killSwitch ? 'HALTED' : cfg.liveTradingEnabled ? 'LIVE' : 'PAPER';
  const postureOptions = [
    { key: 'HALTED', label: 'Halted' },
    { key: 'PAPER', label: 'Paper' },
    { key: 'LIVE', label: 'Live' },
  ] as const;
  const postureLabel = postureOptions.find((item) => item.key === posture)?.label ?? 'Paper';
  const postureTone: RiskTone = cfg.killSwitch ? 'bad' : cfg.liveTradingEnabled ? 'ok' : 'warn';

  const blockers = [
    cfg.killSwitch
      ? { label: 'kill_switch_off', detail: 'Live orders are paused before routing.' }
      : null,
    !cfg.liveTradingEnabled
      ? { label: 'live_trading_enabled', detail: 'Live trading is not armed.' }
      : null,
    cfg.allowedSymbols.length === 0
      ? { label: 'symbol_allowed', detail: 'No symbols are allowed for live orders.' }
      : null,
    perOrderLimit <= 0
      ? { label: 'max_order_notional', detail: 'Order size must be greater than $0.' }
      : null,
    dailyLimit <= 0
      ? { label: 'max_daily_notional', detail: 'Daily notional must be greater than $0.' }
      : dailyUsed >= dailyLimit
        ? { label: 'max_daily_notional', detail: `${fmtPrice(dailyUsed)} used of ${fmtPrice(dailyLimit)}.` }
        : null,
    openOrderLimit <= 0
      ? { label: 'max_open_orders', detail: 'Open-order capacity must be greater than 0.' }
      : openOrdersCount >= openOrderLimit
        ? { label: 'max_open_orders', detail: `${openOrdersCount} open orders against a limit of ${openOrderLimit}.` }
        : null,
    cooldownLeft > 0 ? { label: 'cooldown', detail: `${cooldownLeft}s remaining before another order can be submitted.` } : null,
  ].filter((b): b is { label: string; detail: string } => Boolean(b));

  const armConditions = [
    {
      label: 'Kill switch off',
      pass: !cfg.killSwitch,
      detail: cfg.killSwitch ? 'Resume live orders first.' : 'Live orders are not paused.',
    },
    {
      label: 'Allowed symbols',
      pass: cfg.allowedSymbols.length > 0,
      detail: cfg.allowedSymbols.length ? `${cfg.allowedSymbols.length} symbol${cfg.allowedSymbols.length === 1 ? '' : 's'} allowed.` : 'Add at least one symbol.',
    },
    {
      label: 'Order size limit',
      pass: perOrderLimit > 0,
      detail: perOrderLimit > 0 ? `${fmtPrice(perOrderLimit)} per order.` : 'Set a positive per-order limit.',
    },
    {
      label: 'Daily notional available',
      pass: dailyLimit > dailyUsed,
      detail: dailyLimit > dailyUsed ? `${fmtPrice(dailyRemaining)} available today.` : `${fmtPrice(dailyUsed)} used of ${fmtPrice(dailyLimit)}.`,
    },
    {
      label: 'Open-order capacity',
      pass: openOrderLimit > openOrdersCount,
      detail: openOrderLimit > openOrdersCount ? `${openOrderLimit - openOrdersCount} slots available.` : `${openOrdersCount} open orders against a limit of ${openOrderLimit}.`,
    },
    {
      label: 'Cooldown clear',
      pass: cooldownLeft === 0,
      detail: cooldownLeft > 0 ? `${cooldownLeft}s remaining.` : 'Ready now.',
    },
  ];
  const firstFailedArmCondition = armConditions.find((c) => !c.pass);
  const canArmLive = !cfg.liveTradingEnabled && !firstFailedArmCondition;

  const dirtyLimitKeys = LIMIT_FIELDS.filter((f) => draft[f.key] !== undefined);
  const invalidLimitKeys = LIMIT_FIELDS.filter((f) => {
    const raw = draft[f.key];
    if (raw === undefined) return false;
    const value = Number(raw);
    return raw.trim() === '' || !Number.isFinite(value) || value < f.min;
  });
  const canSaveLimits = dirtyLimitKeys.length > 0 && invalidLimitKeys.length === 0;

  const rejections = [...state.events]
    .filter((ev) => ev.kind === 'risk_decision' && riskDecisionData(ev).allowed === false)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 5);
  const livePathTone: RiskTone = blockers.length ? 'bad' : 'ok';
  const livePathLabel = blockers.length ? 'Blocked' : 'Ready';
  const livePathDetail = blockers.length ? blockers[0].detail : 'No global blocker is active.';
  const lastOrderText = state.risk.lastOrderTs ? timeAgo(state.risk.lastOrderTs) : 'None';
  const lastOrderDetail = state.risk.lastOrderTs ? fmtDateTime(state.risk.lastOrderTs) : 'No order response in the ledger.';

  const patchList = async (key: 'allowedSymbols' | 'blockedSymbols', list: string[]) => {
    await saveConfig({ [key]: uniqueSymbols(list) });
  };

  const saveDraft = async () => {
    if (!canSaveLimits) return;
    await saveConfig(parseLimitDraft(draft));
    setDraft({});
    setSaved(true);
  };

  const runProbe = async () => {
    const symbol = sanitizeSymbol(probeSymbol);
    const amount = Number(probeNotional);
    setProbeError(null);
    setProbeResult(null);
    if (!/^[A-Z0-9]{4,20}$/.test(symbol)) {
      setProbeError('Enter a valid Binance symbol such as BTCUSDT.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setProbeError('Enter a positive USDT notional.');
      return;
    }
    setProbeBusy(true);
    const res = await preview({ symbol, side: probeSide, type: 'MARKET', quoteQty: amount });
    setProbeBusy(false);
    if (!res) {
      setProbeError('Preview request failed.');
      return;
    }
    setProbeResult(res);
    if (res.errors.length > 0) setProbeError(res.errors.map(cleanRiskText).join(' / '));
  };

  const quickAmounts = [5, 10, perOrderLimit]
    .filter((v, index, list) => v > 0 && list.indexOf(v) === index)
    .map((v) => Math.min(v, perOrderLimit > 0 ? perOrderLimit : v));

  return (
    <div className="container page risk-page">
      <section className="risk-pref">
        <header className="risk-pref-header">
          <h1>Risk</h1>
          <p>
            {blockers.length
              ? `Live orders are blocked by ${blockers.length} item${blockers.length === 1 ? '' : 's'}. Review ${riskCheckLabel(blockers[0].label).toLowerCase()} before resuming.`
              : 'Live orders can reach the global gate. Every order is still checked before routing.'}
          </p>
        </header>

        <span className="risk-pref-caption">Control</span>
        <section className="risk-pref-group" aria-label="Control">
          <div className="risk-pref-row">
            <span className={`risk-pref-icon ${postureTone}`}>
              <IconShieldLine size={19} />
            </span>
            <div className="risk-pref-copy">
              <b>Trading mode</b>
              <span>{postureLabel} mode. Live orders also require a clear gate.</span>
            </div>
            <div className="risk-pref-segment" aria-label="Trading mode">
              {postureOptions.map((item) => (
                <span key={item.key} className={posture === item.key ? 'on' : ''}>{item.label}</span>
              ))}
            </div>
          </div>

          <div className="risk-pref-row">
            <span className={`risk-pref-icon ${livePathTone}`}>
              <IconPulse size={19} />
            </span>
            <div className="risk-pref-copy">
              <b>Order gate</b>
              <span>{livePathDetail}</span>
            </div>
            <span className={`risk-pref-token ${livePathTone}`}>{livePathLabel}</span>
          </div>

          <div className="risk-pref-row">
            <span className={`risk-pref-icon ${cfg.killSwitch ? 'bad' : 'ok'}`}>
              <IconPower size={19} />
            </span>
            <div className="risk-pref-copy">
              <b>Kill switch</b>
              <span>{cfg.killSwitch ? 'Live orders stop before routing. Preview remains available.' : 'Live orders may enter the server risk gate.'}</span>
            </div>
            {cfg.killSwitch ? (
              <button type="button" className="risk-pref-button primary" onClick={() => setModal('resume')}>
                Resume
              </button>
            ) : (
              <button type="button" className="risk-pref-button danger" onClick={() => void setKill(true)}>
                Halt
              </button>
            )}
          </div>

          <div className="risk-pref-row">
            <span className={`risk-pref-icon ${cfg.liveTradingEnabled ? 'ok' : canArmLive ? 'warn' : 'bad'}`}>
              <IconZapOff size={19} armed={canArmLive} />
            </span>
            <div className="risk-pref-copy">
              <b>Live arm</b>
              <span>{cfg.liveTradingEnabled ? 'Live trading is armed.' : canArmLive ? 'Ready to arm after confirmation.' : firstFailedArmCondition ? `${firstFailedArmCondition.label}: ${firstFailedArmCondition.detail}` : 'Locked.'}</span>
            </div>
            {cfg.liveTradingEnabled ? (
              <button type="button" className="risk-pref-button" onClick={() => void setLive(false)}>
                Disarm
              </button>
            ) : (
              <button
                type="button"
                className="risk-pref-button primary"
                disabled={!canArmLive}
                title={firstFailedArmCondition ? `${firstFailedArmCondition.label}: ${firstFailedArmCondition.detail}` : 'Ready to arm live trading'}
                onClick={() => setModal('arm')}
              >
                Arm live
              </button>
            )}
          </div>
        </section>

        <span className="risk-pref-caption">Gate status</span>
        <section className="risk-pref-group" aria-label="Gate status">
          <div className="risk-pref-row">
            <span className={`risk-pref-icon ${blockers.length ? 'bad' : 'ok'}`}>
              <IconAlert size={19} />
            </span>
            <div className="risk-pref-copy">
              <b>Blocking items</b>
              <span>The first failed condition explains why live orders cannot pass.</span>
            </div>
            <StatePill tone={blockers.length ? 'bad' : 'ok'}>{blockers.length ? 'Blocked' : 'Ready'}</StatePill>
          </div>
          <ol className="risk-pref-stack">
            {blockers.length === 0 ? (
              <li>
                <span className="ok">Ready</span>
                <b>No global blocker</b>
                <em>Symbols, blocked symbols, notional, filters, and daily loss are still checked per order.</em>
              </li>
            ) : (
              blockers.map((b, index) => (
                <li key={`${b.label}-${index}`}>
                  <span>{index + 1}</span>
                  <b>{riskCheckLabel(b.label)}</b>
                  <em>{b.detail}</em>
                </li>
              ))
            )}
          </ol>
          <div className="risk-pref-checks">
            {armConditions.map((c) => (
              <div key={c.label} className="risk-pref-check">
                <span className={c.pass ? 'ok' : 'bad'}>{c.pass ? 'Pass' : 'Fail'}</span>
                <b>{c.label}</b>
                <em>{c.detail}</em>
              </div>
            ))}
          </div>
        </section>

        <span className="risk-pref-caption">Exposure</span>
        <section className="risk-pref-group" aria-label="Exposure">
          <div className="risk-pref-row">
            <span className="risk-pref-icon ok">
              <IconChart size={19} />
            </span>
            <div className="risk-pref-copy">
              <b>Daily notional</b>
              <span>{fmtPrice(dailyRemaining)} remaining from configured daily cap.</span>
            </div>
            <span className={`risk-pref-meter ${dailyLimit > dailyUsed ? 'ok' : 'bad'}`}>
              {fmtPrice(dailyUsed)} / {fmtPrice(dailyLimit)}
            </span>
          </div>
          <div className="risk-pref-row">
            <span className="risk-pref-icon warn">
              <IconClock size={19} />
            </span>
            <div className="risk-pref-copy">
              <b>Last live order</b>
              <span>{lastOrderDetail}</span>
            </div>
            <span className="risk-pref-token idle">{lastOrderText}</span>
          </div>
        </section>

        <span className="risk-pref-caption">Limits</span>
        <section className="risk-pref-group" aria-label="Risk limits">
          <div className="risk-pref-row risk-pref-actions-row">
            <span className="risk-pref-icon warn">
              <IconLock size={19} />
            </span>
            <div className="risk-pref-copy">
              <b>Server limits</b>
              <span>Only wired server limits can be saved.</span>
            </div>
            <div className="risk-pref-actions">
              <button
                type="button"
                className="risk-pref-button"
                disabled={dirtyLimitKeys.length === 0}
                title={dirtyLimitKeys.length === 0 ? 'No edits to reset' : 'Reset local edits'}
                onClick={() => {
                  setDraft({});
                  setSaved(false);
                }}
              >
                Reset
              </button>
              <button
                type="button"
                className="risk-pref-button primary"
                disabled={!canSaveLimits}
                title={invalidLimitKeys.length ? `Invalid: ${invalidLimitKeys.map((f) => f.label).join(', ')}` : dirtyLimitKeys.length ? 'Save wired limits' : 'No edits to save'}
                onClick={saveDraft}
              >
                {saved && dirtyLimitKeys.length === 0 ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>
          <div className="risk-pref-limits">
            {LIMIT_FIELDS.map((field) => {
              const dirty = draft[field.key] !== undefined;
              const invalid = invalidLimitKeys.some((f) => f.key === field.key);
              return (
                <label
                  key={field.key}
                  className={`risk-pref-limit ${dirty ? 'dirty' : ''} ${invalid ? 'bad' : ''}`}
                  title={`Server field: ${field.serverName}`}
                >
                  <span>
                    <b>{field.label}</b>
                    <em>{field.reason}</em>
                  </span>
                  <span className="risk-pref-limit-control">
                    <input
                      type="number"
                      min={field.min}
                      step={field.step}
                      value={limitValue(cfg, draft, field.key)}
                      onChange={(e) => {
                        setSaved(false);
                        setDraft({ ...draft, [field.key]: e.target.value });
                      }}
                    />
                    <small>{field.unit}</small>
                  </span>
                </label>
              );
            })}
            {UNWIRED_LIMITS.map((field) => (
              <div key={field.label} className="risk-pref-limit unwired">
                <span>
                  <b>{field.label}</b>
                  <em>{field.reason}</em>
                </span>
                <span className="risk-pref-token idle">Not wired</span>
              </div>
            ))}
          </div>
        </section>

        <span className="risk-pref-caption">Symbols</span>
        <section className="risk-pref-group risk-pref-symbol-group" aria-label="Allowed and blocked symbols">
          <div className="risk-pref-row">
            <span className={`risk-pref-icon ${cfg.allowedSymbols.length ? 'ok' : 'bad'}`}>
              <IconList size={19} />
            </span>
            <div className="risk-pref-copy">
              <b>Allowed symbols</b>
              <span>{cfg.allowedSymbols.length ? `${cfg.allowedSymbols.length} symbol${cfg.allowedSymbols.length === 1 ? '' : 's'} allowed.` : 'Live orders need at least one allowed symbol.'}</span>
            </div>
            <div className="risk-symbol-add compact">
              <input placeholder="BTCUSDT" value={allowInput} onChange={(e) => setAllowInput(sanitizeSymbol(e.target.value))} spellCheck={false} />
              <button
                type="button"
                className="risk-pref-button primary"
                disabled={allowInput.length < 4 || cfg.allowedSymbols.includes(allowInput)}
                title={allowInput.length < 4 ? 'Enter a symbol first' : cfg.allowedSymbols.includes(allowInput) ? 'Already allowed' : `Add ${allowInput}`}
                onClick={async () => {
                  await patchList('allowedSymbols', [...cfg.allowedSymbols, allowInput]);
                  setAllowInput('');
                }}
              >
                Add
              </button>
            </div>
          </div>
          <div className="risk-pref-pills">
            {cfg.allowedSymbols.length === 0 ? (
              <span className="risk-empty-inline">No allowed symbols</span>
            ) : (
              cfg.allowedSymbols.map((s) => (
                <button
                  type="button"
                  key={s}
                  className="risk-symbol-pill"
                  title={`Remove ${s} from allowed symbols`}
                  onClick={() => void patchList('allowedSymbols', cfg.allowedSymbols.filter((x) => x !== s))}
                >
                  <TokenIcon symbol={s} size={18} />
                  {s}
                  <span>remove</span>
                </button>
              ))
            )}
          </div>
          <div className="risk-pref-row">
            <span className={`risk-pref-icon ${cfg.blockedSymbols.length ? 'bad' : 'idle'}`}>
              <IconLock size={19} />
            </span>
            <div className="risk-pref-copy">
              <b>Blocked symbols</b>
              <span>{cfg.blockedSymbols.length ? `${cfg.blockedSymbols.length} symbol${cfg.blockedSymbols.length === 1 ? '' : 's'} blocked.` : 'No symbol-specific blocks.'}</span>
            </div>
            <div className="risk-symbol-add compact">
              <input placeholder="DOGEUSDT" value={blockInput} onChange={(e) => setBlockInput(sanitizeSymbol(e.target.value))} spellCheck={false} />
              <button
                type="button"
                className="risk-pref-button danger"
                disabled={blockInput.length < 4 || cfg.blockedSymbols.includes(blockInput)}
                title={blockInput.length < 4 ? 'Enter a symbol first' : cfg.blockedSymbols.includes(blockInput) ? 'Already blocked' : `Block ${blockInput}`}
                onClick={async () => {
                  await patchList('blockedSymbols', [...cfg.blockedSymbols, blockInput]);
                  setBlockInput('');
                }}
              >
                Block
              </button>
            </div>
          </div>
          <div className="risk-pref-pills">
            {cfg.blockedSymbols.length === 0 ? (
              <span className="risk-empty-inline">No blocked symbols</span>
            ) : (
              cfg.blockedSymbols.map((s) => (
                <button
                  type="button"
                  key={s}
                  className="risk-symbol-pill blocked"
                  title={`Remove ${s} from blocked symbols`}
                  onClick={() => void patchList('blockedSymbols', cfg.blockedSymbols.filter((x) => x !== s))}
                >
                  <TokenIcon symbol={s} size={18} />
                  {s}
                  <span>remove</span>
                </button>
              ))
            )}
          </div>
        </section>

        <span className="risk-pref-caption">Preview</span>
        <section className="risk-pref-group" aria-label="Gate probe">
          <div className="risk-pref-row risk-pref-probe-row">
            <span className="risk-pref-icon warn">
              <IconSearch size={19} />
            </span>
            <div className="risk-pref-copy">
              <b>Preview an order</b>
              <span>Preview only. Nothing is sent.</span>
            </div>
            <StatePill tone={probeResult ? (probeResult.risk.allowed ? 'ok' : 'bad') : 'idle'}>
              {probeResult ? (probeResult.risk.allowed ? 'Pass' : 'Fail') : 'Idle'}
            </StatePill>
          </div>
          <div className="risk-pref-probe-form">
            <label>
              <span>Symbol</span>
              <input value={probeSymbol} onChange={(e) => setProbeSymbol(sanitizeSymbol(e.target.value))} spellCheck={false} />
            </label>
            <label>
              <span>Side</span>
              <span className="risk-side-toggle">
                {(['BUY', 'SELL'] as const).map((side) => (
                  <button
                    type="button"
                    key={side}
                    className={probeSide === side ? 'on' : ''}
                    onClick={() => setProbeSide(side)}
                  >
                    {side === 'BUY' ? 'Buy' : 'Sell'}
                  </button>
                ))}
              </span>
            </label>
            <label>
              <span>Notional USDT</span>
              <input type="number" min="0" step="0.01" value={probeNotional} onChange={(e) => setProbeNotional(e.target.value)} />
            </label>
            <button type="button" className="risk-pref-button primary" disabled={probeBusy} onClick={runProbe}>
              <IconSearch size={14} />
              {probeBusy ? 'Checking' : 'Preview'}
            </button>
          </div>
          <div className="risk-quick-row">
            {quickAmounts.map((amount) => (
              <button type="button" className="risk-pref-button" key={amount} onClick={() => setProbeNotional(String(amount))}>
                {fmtPrice(amount)}
              </button>
            ))}
          </div>
          {probeError && <div className="risk-result-strip bad">{probeError}</div>}
          {probeResult && (
            <div className="risk-probe-result">
              <div className="risk-probe-summary">
                <span>
                  <TokenIcon symbol={probeResult.symbol} size={20} />
                  {probeResult.symbol} {probeResult.side === 'BUY' ? 'Buy' : 'Sell'}
                </span>
                <b>{fmtPrice(probeResult.estNotionalUsd)}</b>
                <em>{probeResult.risk.reasons.map(cleanRiskText).join(' / ') || 'All returned checks passed.'}</em>
              </div>
              <RiskCheckTable checks={probeResult.risk.checks} />
            </div>
          )}
        </section>

        <span className="risk-pref-caption">Recent rejections</span>
        <section className="risk-pref-group" aria-label="Recent rejections">
          <div className="risk-pref-row">
            <span className="risk-pref-icon bad">
              <IconActivity size={19} />
            </span>
            <div className="risk-pref-copy">
              <b>Rejected decisions</b>
              <span>Last five risk decisions rejected by the order gate.</span>
            </div>
            <button type="button" className="risk-pref-button" onClick={() => setPage('ledger')}>
              <IconBook size={14} />
              Open logs
            </button>
          </div>
          {rejections.length === 0 ? (
            <div className="risk-empty-state">
              <IconActivity size={18} />
              <span>No recent risk rejections in the current snapshot.</span>
            </div>
          ) : (
            <div className="risk-table-wrap">
              <table className="risk-rejection-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Symbol</th>
                    <th>Stage</th>
                    <th>Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {rejections.map((ev) => {
                    const data = riskDecisionData(ev);
                    return (
                      <tr key={ev.id}>
                        <td title={fmtDateTime(ev.ts)}>{timeAgo(ev.ts)}</td>
                        <td>{ev.symbol ?? '-'}</td>
                        <td>{stageLabel(data.stage)}</td>
                        <td>{data.reasons.length ? data.reasons.map(cleanRiskText).join(' / ') : 'No reason returned.'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>

      {modal === 'resume' && (
        <ConfirmModal
          title="Resume live orders"
          requireText="RESUME"
          confirmLabel="Resume"
          onConfirm={async () => {
            await setKill(false);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        >
          <p className="muted">
            This turns the kill switch off. Live orders still need the live-arm gate and server risk checks before routing.
          </p>
        </ConfirmModal>
      )}

      {modal === 'arm' && (
        <ConfirmModal
          title="Arm live trading"
          requireText="ARM"
          confirmLabel="Arm live"
          danger
          onConfirm={async () => {
            await setLive(true);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        >
          <p className="muted">
            Live order submission becomes possible only after the server re-checks kill switch, allowed symbols, blocked symbols,
            notional, open orders, cooldown, and daily loss.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
