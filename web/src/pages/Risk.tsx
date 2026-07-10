import { useState } from 'react';
import { ConfirmModal } from '../components/Modal';
import { IconBook } from '../components/Icons';
import { TokenIcon } from '../components/TokenIcon';
import { Seg } from '../components/px';
import { fmtDateTime, fmtMoney, fmtPrice, timeAgo } from '../format';
import { useStore } from '../store';
import type { AppConfig, LedgerEvent, PreviewResult, RiskCheck } from '../types';
import './Risk.css';

type LimitKey =
  | 'maxOrderNotionalUsd'
  | 'maxDailyNotionalUsd'
  | 'maxDailyLossUsd'
  | 'maxOpenOrders'
  | 'cooldownSec'
  | 'staleOrderMaxMin';

type LimitDraft = Partial<Record<LimitKey, string>>;

type GateCondition = {
  id: string;
  label: string;
  pass: boolean;
  value: string;
  detail: string;
};

const LIMIT_FIELDS: {
  key: LimitKey;
  label: string;
  unit: string;
  min: number;
  step: string;
  reason: string;
}[] = [
  { key: 'maxOrderNotionalUsd', label: 'Per-Order Notional', unit: 'USD', min: 0, step: '0.01', reason: 'Rejects a single order above this value.' },
  { key: 'maxDailyNotionalUsd', label: 'Daily Notional', unit: 'USD', min: 0, step: '0.01', reason: 'Caps executed quote value during the UTC day.' },
  { key: 'maxDailyLossUsd', label: 'Daily Loss Stop', unit: 'USD', min: 0, step: '0.01', reason: 'Blocks new orders after the realized-loss threshold.' },
  { key: 'maxOpenOrders', label: 'Open Orders', unit: 'Count', min: 0, step: '1', reason: 'Limits concurrent open orders.' },
  { key: 'cooldownSec', label: 'Order Cooldown', unit: 'Sec', min: 0, step: '1', reason: 'Minimum wait after an order response.' },
  { key: 'staleOrderMaxMin', label: 'Stale Order Age', unit: 'Min', min: 1, step: '1', reason: 'Flags open orders older than this threshold.' },
];

const RISK_CHECK_LABELS: Record<string, string> = {
  kill_switch_off: 'Kill Switch',
  funds_access_unlocked: 'Funds Access',
  automation_running: 'Automation',
  live_trading_enabled: 'Live Arm',
  symbol_allowed: 'Allowlist',
  symbol_not_blocked: 'Blocklist',
  symbol_blocked: 'Blocklist',
  notional_known: 'Order Notional',
  max_order_notional: 'Per-Order Notional',
  max_daily_notional: 'Daily Notional',
  daily_loss_limit: 'Daily Loss',
  max_daily_loss: 'Daily Loss',
  max_open_orders: 'Open Orders',
  cooldown: 'Cooldown',
  exchange_filters: 'Exchange Filters',
  stale_order: 'Stale Order',
};

const STAGE_LABELS: Record<string, string> = {
  risk_decision: 'Risk Decision',
  preview: 'Dry Run',
  order_intent: 'Order Intent',
  order_request: 'Order Request',
  order_response: 'Order Response',
};

function sanitizeSymbol(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}

function uniqueSymbols(list: string[]): string[] {
  return [...new Set(list.map(sanitizeSymbol).filter((symbol) => symbol.length >= 4))];
}

function configNumber(config: AppConfig, key: LimitKey): number {
  const value = config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function limitValue(config: AppConfig, draft: LimitDraft, key: LimitKey): string {
  return draft[key] ?? String(configNumber(config, key));
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
      .replace(/\border response\b/g, 'order response')
      .replace(/\brisk decision\b/g, 'risk decision'),
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

function riskDecisionData(event: LedgerEvent): { allowed: boolean | null; stage: string; reasons: string[] } {
  const data = dataRecord(event.data);
  const rawReasons = data?.reasons;
  return {
    allowed: data?.allowed === true ? true : data?.allowed === false ? false : null,
    stage: typeof data?.stage === 'string' ? data.stage : 'risk_decision',
    reasons: Array.isArray(rawReasons) ? rawReasons.filter((reason): reason is string => typeof reason === 'string') : [],
  };
}

function statusLabel(condition: GateCondition): string {
  if (condition.id === 'live-arm') return condition.pass ? 'Armed' : 'Disarmed';
  if (condition.id === 'kill-switch') return condition.pass ? 'Clear' : 'Halted';
  return condition.pass ? 'Clear' : 'Blocked';
}

function utilization(value: number, limit: number): number {
  if (limit <= 0) return 100;
  return Math.max(0, Math.min(100, (value / limit) * 100));
}

function RiskCheckTable({ checks }: { checks: RiskCheck[] }) {
  if (checks.length === 0) {
    return <div className="riskx-empty">The server returned no individual gate checks.</div>;
  }

  return (
    <div className="riskx-check-table" role="table" aria-label="Dry Run Checks">
      <div className="riskx-check-head" role="row">
        <span role="columnheader">Check</span>
        <span role="columnheader">Result</span>
        <span role="columnheader">Server Detail</span>
      </div>
      {checks.map((check) => (
        <div className="riskx-check-row" role="row" key={check.name}>
          <strong role="cell">{riskCheckLabel(check.name)}</strong>
          <span role="cell" className={'riskx-result ' + (check.pass ? 'clear' : 'blocked')}>
            <i aria-hidden="true" />
            {check.pass ? 'Pass' : 'Fail'}
          </span>
          <span role="cell" className="riskx-detail" title={cleanRiskText(check.detail)}>
            {cleanRiskText(check.detail)}
          </span>
        </div>
      ))}
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
      <div className="container page riskx-page">
        <section className="riskx-frame">
          <header className="riskx-toolbar">
            <div className="riskx-title">
              <img className="riskx-page-mark" src="/risk-gauge.png" alt="" aria-hidden="true" />
              <h1>Risk</h1>
              <span className="riskx-posture idle"><i aria-hidden="true" />Connecting</span>
            </div>
          </header>
          <div className="riskx-empty">Waiting for server state.</div>
        </section>
      </div>
    );
  }

  const config = state.config;
  const perOrderLimit = configNumber(config, 'maxOrderNotionalUsd');
  const dailyLimit = configNumber(config, 'maxDailyNotionalUsd');
  const dailyUsed = state.risk.dailyNotionalUsedUsd;
  const dailyRemaining = dailyLimit > 0 ? Math.max(0, dailyLimit - dailyUsed) : 0;
  const dailyLossLimit = configNumber(config, 'maxDailyLossUsd');
  const realizedToday = state.account?.realizedTodayUsd ?? null;
  const realizedLoss = realizedToday === null ? dailyLossLimit : Math.max(0, -realizedToday);
  const openOrderLimit = configNumber(config, 'maxOpenOrders');
  const openOrdersCount = state.openOrders.length;
  const cooldownLeft =
    state.risk.lastOrderTs && config.cooldownSec > 0
      ? Math.max(0, Math.ceil((state.risk.lastOrderTs + config.cooldownSec * 1000 - Date.now()) / 1000))
      : 0;

  const gateConditions: GateCondition[] = [
    {
      id: 'kill-switch',
      label: 'Kill Switch',
      pass: !config.killSwitch,
      value: config.killSwitch ? 'Global Stop' : 'All Routes',
      detail: config.killSwitch ? 'Every live order path is stopped before routing.' : 'The global emergency stop is clear.',
    },
    {
      id: 'funds-access',
      label: 'Funds Access',
      pass: !config.fundsLocked,
      value: config.fundsLocked ? 'Locked' : 'Available',
      detail: config.fundsLocked ? 'Money actions are locked at the server.' : 'Server-side funds access is available.',
    },
    {
      id: 'live-arm',
      label: 'Live Arm',
      pass: config.liveTradingEnabled,
      value: config.liveTradingEnabled ? 'Live Routing' : 'Paper / Manual',
      detail: config.liveTradingEnabled ? 'Live routing is armed and still requires every order check.' : 'The system remains paper/manual-only.',
    },
    {
      id: 'symbol-policy',
      label: 'Symbol Policy',
      pass: config.allowedSymbols.length > 0,
      value: config.allowedSymbols.length ? String(config.allowedSymbols.length) + ' Allowed' : 'Empty',
      detail: config.allowedSymbols.length
        ? String(config.allowedSymbols.length) + ' allowed · ' + String(config.blockedSymbols.length) + ' explicitly blocked.'
        : 'A live order cannot pass until at least one symbol is allowed.',
    },
    {
      id: 'order-limit',
      label: 'Per-Order Limit',
      pass: perOrderLimit > 0,
      value: fmtMoney(perOrderLimit),
      detail: perOrderLimit > 0 ? 'Every estimated order notional is checked against this cap.' : 'Set a positive per-order cap.',
    },
    {
      id: 'daily-notional',
      label: 'Daily Notional',
      pass: dailyLimit > 0 && dailyUsed < dailyLimit,
      value: fmtMoney(dailyRemaining) + ' Left',
      detail: fmtMoney(dailyUsed) + ' used of the ' + fmtMoney(dailyLimit) + ' UTC-day cap.',
    },
    {
      id: 'daily-loss',
      label: 'Daily Loss',
      pass: realizedToday !== null && realizedToday > -dailyLossLimit,
      value: realizedToday === null ? 'Unavailable' : fmtMoney(realizedToday),
      detail: realizedToday === null
        ? 'Account realized PnL is unavailable.'
        : 'New orders stop at -' + fmtMoney(dailyLossLimit) + ' realized for the UTC day.',
    },
    {
      id: 'open-orders',
      label: 'Open Orders',
      pass: openOrdersCount < openOrderLimit,
      value: String(openOrdersCount) + ' / ' + String(openOrderLimit),
      detail: openOrderLimit > openOrdersCount
        ? String(openOrderLimit - openOrdersCount) + ' order slot' + (openOrderLimit - openOrdersCount === 1 ? '' : 's') + ' available.'
        : 'The configured concurrent-order limit is reached.',
    },
    {
      id: 'cooldown',
      label: 'Cooldown',
      pass: cooldownLeft === 0,
      value: cooldownLeft > 0 ? String(cooldownLeft) + 's' : 'Ready',
      detail: cooldownLeft > 0 ? 'Wait before another order can pass.' : 'The minimum interval between orders has elapsed.',
    },
  ];

  const sortedConditions = [...gateConditions].sort((left, right) => Number(left.pass) - Number(right.pass));
  const failedConditions = gateConditions.filter((condition) => !condition.pass);
  const armBlocker = failedConditions.find((condition) => condition.id !== 'live-arm');
  const canArmLive = !config.liveTradingEnabled && !armBlocker;
  const posture = config.killSwitch ? 'halted' : config.liveTradingEnabled ? 'live' : 'paper';
  const postureLabel = posture === 'halted' ? 'Halted' : posture === 'live' ? 'Live Armed' : 'Paper';

  const dirtyLimitKeys = LIMIT_FIELDS.filter((field) => draft[field.key] !== undefined);
  const invalidLimitKeys = LIMIT_FIELDS.filter((field) => {
    const raw = draft[field.key];
    if (raw === undefined) return false;
    const value = Number(raw);
    return raw.trim() === '' || !Number.isFinite(value) || value < field.min;
  });
  const canSaveLimits = dirtyLimitKeys.length > 0 && invalidLimitKeys.length === 0;

  const rejections = [...state.events]
    .filter((event) => event.kind === 'risk_decision' && riskDecisionData(event).allowed === false)
    .sort((left, right) => right.ts - left.ts)
    .slice(0, 5);

  const lastOrderText = state.risk.lastOrderTs ? timeAgo(state.risk.lastOrderTs) : 'No Order Yet';
  const lastOrderDetail = state.risk.lastOrderTs ? fmtDateTime(state.risk.lastOrderTs) : 'No order response is present in the ledger.';

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
    const result = await preview({ symbol, side: probeSide, type: 'MARKET', quoteQty: amount });
    setProbeBusy(false);
    if (!result) {
      setProbeError('The server did not return a dry-run result.');
      return;
    }

    setProbeResult(result);
    if (result.errors.length > 0) setProbeError(result.errors.map(cleanRiskText).join(' / '));
  };

  return (
    <div className="container page riskx-page">
      <section className="riskx-frame">
        <header className="riskx-toolbar">
          <div className="riskx-title">
            <img className="riskx-page-mark" src="/risk-gauge.png" alt="" aria-hidden="true" />
            <h1>Risk</h1>
            <span className={'riskx-posture ' + posture}><i aria-hidden="true" />{postureLabel}</span>
            <span className="riskx-blocker-count">
              {failedConditions.length ? String(failedConditions.length) + ' Blocker' + (failedConditions.length === 1 ? '' : 's') : 'Gate Clear'}
            </span>
          </div>

          <div className="riskx-global-controls">
            <div className="riskx-live-control">
              <span>
                <small>Execution</small>
                <strong>{config.liveTradingEnabled ? 'Live Armed' : 'Paper / Manual'}</strong>
              </span>
              {config.liveTradingEnabled ? (
                <button type="button" className="riskx-button" onClick={() => void setLive(false)}>Disarm</button>
              ) : (
                <button
                  type="button"
                  className="riskx-button primary"
                  disabled={!canArmLive}
                  title={armBlocker ? armBlocker.label + ': ' + armBlocker.detail : 'Ready to arm live trading'}
                  onClick={() => setModal('arm')}
                >
                  Arm Live
                </button>
              )}
            </div>

            <div className="riskx-kill-control">
              <span>
                <small>Kill Switch</small>
                <strong>{config.killSwitch ? 'Halted' : 'Off'}</strong>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={config.killSwitch}
                aria-label="Kill Switch"
                className={'riskx-switch ' + (config.killSwitch ? 'on' : 'off')}
                onClick={() => (config.killSwitch ? setModal('resume') : void setKill(true))}
              >
                <span aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        <div className="riskx-summary" aria-label="Risk Summary">
          <div className="riskx-summary-cell">
            <span>Daily Notional</span>
            <strong>{fmtMoney(dailyUsed)} <em>/ {fmtMoney(dailyLimit)}</em></strong>
            <div className="riskx-meter"><i style={{ width: String(utilization(dailyUsed, dailyLimit)) + '%' }} /></div>
          </div>
          <div className="riskx-summary-cell">
            <span>Realized Today</span>
            <strong className={realizedToday !== null && realizedToday < 0 ? 'negative' : ''}>
              {realizedToday === null ? 'Unavailable' : fmtMoney(realizedToday)}
            </strong>
            <small>Loss stop at -{fmtMoney(dailyLossLimit)}</small>
          </div>
          <div className="riskx-summary-cell">
            <span>Open Orders</span>
            <strong>{openOrdersCount} <em>/ {openOrderLimit}</em></strong>
            <small>{Math.max(0, openOrderLimit - openOrdersCount)} slots available</small>
          </div>
          <div className="riskx-summary-cell">
            <span>Rejections Today</span>
            <strong>{state.risk.rejectionsToday}</strong>
            <small>{lastOrderText} · {lastOrderDetail}</small>
          </div>
        </div>

        <section className="riskx-section">
          <header className="riskx-section-head">
            <div>
              <h2>Execution Gate</h2>
              <p>Server-enforced conditions that decide whether a live order may route.</p>
            </div>
          </header>
          <div className="riskx-gate-table" role="table" aria-label="Execution Gate">
            <div className="riskx-gate-head" role="row">
              <span role="columnheader">Control</span>
              <span role="columnheader">State</span>
              <span role="columnheader">Current</span>
              <span role="columnheader">Server Detail</span>
            </div>
            {sortedConditions.map((condition) => (
              <div className="riskx-gate-row" role="row" key={condition.id}>
                <strong role="cell">{condition.label}</strong>
                <span role="cell" className={'riskx-result ' + (condition.pass ? 'clear' : 'blocked')}>
                  <i aria-hidden="true" />
                  {statusLabel(condition)}
                </span>
                <b role="cell">{condition.value}</b>
                <span role="cell" className="riskx-detail">{condition.detail}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="riskx-section">
          <header className="riskx-section-head">
            <div>
              <h2>Recent Rejections</h2>
              <p>The latest named failures from the risk-decision ledger.</p>
            </div>
            <button type="button" className="riskx-button" onClick={() => setPage('ledger')}>
              <IconBook size={14} />
              Open Ledger
            </button>
          </header>
          {rejections.length === 0 ? (
            <div className="riskx-empty">No rejected decisions are present in the current ledger snapshot.</div>
          ) : (
            <div className="riskx-rejection-table" role="table" aria-label="Recent Rejections">
              <div className="riskx-rejection-head" role="row">
                <span role="columnheader">Time</span>
                <span role="columnheader">Symbol</span>
                <span role="columnheader">Stage</span>
                <span role="columnheader">Reason</span>
              </div>
              {rejections.map((event) => {
                const data = riskDecisionData(event);
                const reasons = data.reasons.length ? data.reasons.map(cleanRiskText).join(' / ') : 'No reason returned.';
                return (
                  <div className="riskx-rejection-row" role="row" key={event.id}>
                    <span role="cell" title={fmtDateTime(event.ts)}>{timeAgo(event.ts)}</span>
                    <strong role="cell">{event.symbol ?? '—'}</strong>
                    <span role="cell">{stageLabel(data.stage)}</span>
                    <span role="cell" className="riskx-detail" title={reasons}>{reasons}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="riskx-section">
          <header className="riskx-section-head">
            <div>
              <h2>Limits</h2>
              <p>Values saved directly to the deterministic server risk gate.</p>
            </div>
            <div className="riskx-section-actions">
              {saved && dirtyLimitKeys.length === 0 ? <span className="riskx-saved"><i aria-hidden="true" />Saved</span> : null}
              {dirtyLimitKeys.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="riskx-button"
                    onClick={() => {
                      setDraft({});
                      setSaved(false);
                    }}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    className="riskx-button primary"
                    disabled={!canSaveLimits}
                    title={invalidLimitKeys.length ? 'Fix: ' + invalidLimitKeys.map((field) => field.label).join(', ') : 'Save server limits'}
                    onClick={saveDraft}
                  >
                    Save Changes
                  </button>
                </>
              ) : null}
            </div>
          </header>
          <div className="riskx-limit-table" role="table" aria-label="Risk Limits">
            <div className="riskx-limit-head" role="row">
              <span role="columnheader">Limit</span>
              <span role="columnheader">Purpose</span>
              <span role="columnheader">Current Value</span>
            </div>
            {LIMIT_FIELDS.map((field) => {
              const dirty = draft[field.key] !== undefined;
              const invalid = invalidLimitKeys.some((candidate) => candidate.key === field.key);
              return (
                <label className={'riskx-limit-row' + (dirty ? ' dirty' : '')} role="row" key={field.key}>
                  <strong role="cell">
                    {field.label}
                    {dirty ? <i aria-label="Unsaved change" /> : null}
                  </strong>
                  <span role="cell" className="riskx-detail">{field.reason}</span>
                  <span role="cell" className="riskx-limit-input">
                    <input
                      className={invalid ? 'invalid' : ''}
                      aria-label={field.label}
                      type="number"
                      min={field.min}
                      step={field.step}
                      value={limitValue(config, draft, field.key)}
                      onChange={(event) => {
                        setSaved(false);
                        setDraft({ ...draft, [field.key]: event.target.value });
                      }}
                    />
                    <em>{field.unit}</em>
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        <section className="riskx-section">
          <header className="riskx-section-head">
            <div>
              <h2>Symbol Policy</h2>
              <p>Only allowed symbols can pass; an explicit block always wins.</p>
            </div>
          </header>

          <div className="riskx-policy-row">
            <div className="riskx-policy-copy">
              <strong>Allowed Symbols</strong>
              <span>{config.allowedSymbols.length ? String(config.allowedSymbols.length) + ' symbols can enter the live gate.' : 'No symbol can enter the live gate.'}</span>
            </div>
            <div className="riskx-symbol-entry">
              <input
                aria-label="Add Allowed Symbol"
                placeholder="BTCUSDT"
                value={allowInput}
                onChange={(event) => setAllowInput(sanitizeSymbol(event.target.value))}
                spellCheck={false}
              />
              <button
                type="button"
                className="riskx-button primary"
                disabled={allowInput.length < 4 || config.allowedSymbols.includes(allowInput)}
                onClick={async () => {
                  await patchList('allowedSymbols', [...config.allowedSymbols, allowInput]);
                  setAllowInput('');
                }}
              >
                Allow
              </button>
            </div>
          </div>
          <div className="riskx-symbol-list" aria-label="Allowed Symbols">
            {config.allowedSymbols.length ? config.allowedSymbols.map((symbol) => (
              <button
                type="button"
                key={symbol}
                className="riskx-symbol-chip"
                title={'Remove ' + symbol + ' from allowed symbols'}
                onClick={() => void patchList('allowedSymbols', config.allowedSymbols.filter((candidate) => candidate !== symbol))}
              >
                <TokenIcon symbol={symbol} size={18} />
                <span>{symbol}</span>
                <b aria-hidden="true">×</b>
              </button>
            )) : <span className="riskx-policy-empty">Allowlist Empty</span>}
          </div>

          <div className="riskx-policy-row">
            <div className="riskx-policy-copy">
              <strong>Blocked Symbols</strong>
              <span>{config.blockedSymbols.length ? String(config.blockedSymbols.length) + ' symbols are explicitly blocked.' : 'No symbol-specific blocks are active.'}</span>
            </div>
            <div className="riskx-symbol-entry">
              <input
                aria-label="Add Blocked Symbol"
                placeholder="DOGEUSDT"
                value={blockInput}
                onChange={(event) => setBlockInput(sanitizeSymbol(event.target.value))}
                spellCheck={false}
              />
              <button
                type="button"
                className="riskx-button danger"
                disabled={blockInput.length < 4 || config.blockedSymbols.includes(blockInput)}
                onClick={async () => {
                  await patchList('blockedSymbols', [...config.blockedSymbols, blockInput]);
                  setBlockInput('');
                }}
              >
                Block
              </button>
            </div>
          </div>
          <div className="riskx-symbol-list" aria-label="Blocked Symbols">
            {config.blockedSymbols.length ? config.blockedSymbols.map((symbol) => (
              <button
                type="button"
                key={symbol}
                className="riskx-symbol-chip blocked"
                title={'Remove ' + symbol + ' from blocked symbols'}
                onClick={() => void patchList('blockedSymbols', config.blockedSymbols.filter((candidate) => candidate !== symbol))}
              >
                <TokenIcon symbol={symbol} size={18} />
                <span>{symbol}</span>
                <b aria-hidden="true">×</b>
              </button>
            )) : <span className="riskx-policy-empty">No Blocks</span>}
          </div>
        </section>

        <section className="riskx-section riskx-probe-section">
          <header className="riskx-section-head">
            <div>
              <h2>Dry Run</h2>
              <p>Evaluates a hypothetical market order through the server gate. No order is sent.</p>
            </div>
            {probeResult ? (
              <span className={'riskx-probe-state ' + (probeResult.risk.allowed ? 'clear' : 'blocked')}>
                <i aria-hidden="true" />
                {probeResult.risk.allowed ? 'Passed' : 'Rejected'}
              </span>
            ) : null}
          </header>

          <div className="riskx-probe-form">
            <label>
              <span>Symbol</span>
              <input value={probeSymbol} onChange={(event) => setProbeSymbol(sanitizeSymbol(event.target.value))} spellCheck={false} />
            </label>
            <label>
              <span>Side</span>
              <Seg
                value={probeSide}
                options={[
                  { id: 'BUY', label: 'Buy' },
                  { id: 'SELL', label: 'Sell' },
                ]}
                onChange={setProbeSide}
              />
            </label>
            <label>
              <span>Notional</span>
              <span className="riskx-notional-input">
                <input type="number" min="0" step="0.01" value={probeNotional} onChange={(event) => setProbeNotional(event.target.value)} />
                <em>USDT</em>
              </span>
            </label>
            <button type="button" className="riskx-button primary riskx-probe-button" disabled={probeBusy} onClick={runProbe}>
              {probeBusy ? 'Checking…' : 'Run Dry Run'}
            </button>
          </div>

          {probeError ? <div className="riskx-probe-error">{probeError}</div> : null}
          {probeResult ? (
            <div className="riskx-probe-result">
              <div className="riskx-probe-summary">
                <span className="riskx-probe-asset">
                  <TokenIcon symbol={probeResult.symbol} size={28} />
                  <span>
                    <strong>{probeResult.symbol}</strong>
                    <small>{probeResult.side === 'BUY' ? 'Buy' : 'Sell'} · Market</small>
                  </span>
                </span>
                <span>
                  <small>Estimated Notional</small>
                  <strong>{fmtMoney(probeResult.estNotionalUsd)}</strong>
                </span>
                <span>
                  <small>Effective Price</small>
                  <strong>{fmtPrice(probeResult.effectivePrice)}</strong>
                </span>
                <span>
                  <small>Quantity</small>
                  <strong>{probeResult.quantity === null ? 'Unavailable' : String(probeResult.quantity)}</strong>
                </span>
              </div>
              <RiskCheckTable checks={probeResult.risk.checks} />
            </div>
          ) : null}
        </section>
      </section>

      {modal === 'resume' ? (
        <ConfirmModal
          title="Resume Live Orders"
          requireText="RESUME"
          confirmLabel="Resume"
          onConfirm={async () => {
            await setKill(false);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        >
          <p className="muted">
            This turns the kill switch off. Live orders still require the live arm and every server-side risk check.
          </p>
        </ConfirmModal>
      ) : null}

      {modal === 'arm' ? (
        <ConfirmModal
          title="Arm Live Trading"
          requireText="ARM"
          confirmLabel="Arm Live"
          danger
          onConfirm={async () => {
            await setLive(true);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        >
          <p className="muted">
            Live submission becomes possible only after the server re-checks the kill switch, funds access, symbol policy,
            notional, daily loss, open orders, and cooldown.
          </p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
