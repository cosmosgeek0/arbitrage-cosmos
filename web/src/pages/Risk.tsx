import { useRef, useState } from 'react';
import { IconBook } from '../components/Icons';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
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
  { key: 'maxOrderNotionalUsd', label: 'Per-Order Notional', unit: 'USD', min: 0, step: '0.01', reason: 'Validate-only advisory cap for a hypothetical order.' },
  { key: 'maxDailyNotionalUsd', label: 'Daily Notional', unit: 'USD', min: 0, step: '0.01', reason: 'Validate-only UTC-day policy input.' },
  { key: 'maxDailyLossUsd', label: 'Daily Loss Stop', unit: 'USD', min: 0, step: '0.01', reason: 'Advisory loss threshold; private PnL remains unavailable.' },
  { key: 'maxOpenOrders', label: 'Open Orders', unit: 'Count', min: 0, step: '1', reason: 'Advisory concurrency input; private order truth is unavailable.' },
  { key: 'cooldownSec', label: 'Order Cooldown', unit: 'Sec', min: 0, step: '1', reason: 'Validate-only interval between hypothetical decisions.' },
  { key: 'staleOrderMaxMin', label: 'Stale Order Age', unit: 'Min', min: 1, step: '1', reason: 'Advisory age threshold for supplied order evidence.' },
];

const RISK_CHECK_LABELS: Record<string, string> = {
  risk_config_valid: 'Risk Configuration',
  order_intent_valid: 'Order Intent',
  kill_switch_off: 'Kill Switch',
  funds_access_unlocked: 'Funds Access',
  automation_running: 'Automation',
  live_trading_enabled: 'Legacy Live Setting',
  symbol_allowed: 'Allowlist',
  symbol_not_blocked: 'Blocklist',
  symbol_blocked: 'Blocklist',
  notional_known: 'Order Notional',
  max_order_notional: 'Per-Order Notional',
  max_daily_notional: 'Daily Notional',
  daily_notional_state_known: 'Daily Notional State',
  daily_loss_limit: 'Daily Loss',
  daily_loss_basis_known: 'Daily Loss Basis',
  max_daily_loss: 'Daily Loss',
  max_open_orders: 'Open Orders',
  cooldown: 'Cooldown',
  exchange_filters: 'Exchange Filters',
  stale_order: 'Stale Order',
};

const STAGE_LABELS: Record<string, string> = {
  risk_decision: 'Risk Decision',
  preview: 'Validate Only',
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
  const integerKeys = new Set<LimitKey>(['maxOpenOrders', 'cooldownSec', 'staleOrderMaxMin']);
  for (const field of LIMIT_FIELDS) {
    if (draft[field.key] === undefined) continue;
    const value = Number(draft[field.key]);
    if (Number.isFinite(value) && (!integerKeys.has(field.key) || Number.isInteger(value))) {
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
  if (condition.id === 'execution-authority') return 'Owner Gated';
  return condition.pass ? 'Advisory Pass' : 'Unavailable';
}

function utilization(value: number | null, limit: number): number {
  if (value === null) return 0;
  if (limit <= 0) return 100;
  return Math.max(0, Math.min(100, (value / limit) * 100));
}

function RiskCheckTable({ checks }: { checks: RiskCheck[] }) {
  if (checks.length === 0) {
    return <div className="riskx-empty">The server returned no individual gate checks.</div>;
  }

  return (
    <div className="riskx-check-table" role="table" aria-label="Validate-Only Checks">
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
            {check.pass ? 'Advisory Pass' : 'Advisory Fail'}
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
  const { state, saveConfig, preview, setPage } = useStore();
  const [draft, setDraft] = useState<LimitDraft>({});
  const [allowInput, setAllowInput] = useState('');
  const [blockInput, setBlockInput] = useState('');
  const [probeSymbol, setProbeSymbol] = useState('BTCUSDT');
  const [probeNotional, setProbeNotional] = useState('10');
  const [probeSide, setProbeSide] = useState<'BUY' | 'SELL'>('BUY');
  const [probeResult, setProbeResult] = useState<PreviewResult | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const probeGeneration = useRef(0);

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
  const dailyUsedKnown = Number.isFinite(state.risk.dailyNotionalUsedUsd) && state.risk.dailyNotionalUsedUsd >= 0;
  const dailyUsed = dailyUsedKnown ? state.risk.dailyNotionalUsedUsd : null;
  const dailyRemaining = dailyUsed !== null && dailyLimit > 0 ? Math.max(0, dailyLimit - dailyUsed) : null;
  const dailyLossLimit = configNumber(config, 'maxDailyLossUsd');
  const realizedToday: number | null = null;
  const openOrderLimit = configNumber(config, 'maxOpenOrders');
  const openOrdersCount: number | null = null;
  const cooldownLeft =
    state.risk.lastOrderTs && config.cooldownSec > 0
      ? Math.max(0, Math.ceil((state.risk.lastOrderTs + config.cooldownSec * 1000 - Date.now()) / 1000))
      : 0;

  const gateConditions: GateCondition[] = [
    {
      id: 'execution-authority',
      label: 'Execution Authority',
      pass: false,
      value: 'OWNER_GATED',
      detail: 'LIVE_EXECUTION_NOT_IMPLEMENTED. Validation cannot dispatch, sign, borrow, transfer, or place an order.',
    },
    {
      id: 'kill-switch',
      label: 'Legacy Kill Switch',
      pass: false,
      value: config.killSwitch ? 'Stop Recorded' : 'Inactive',
      detail: config.killSwitch ? 'A local stop is recorded.' : 'An inactive legacy stop does not grant execution authority.',
    },
    {
      id: 'funds-access',
      label: 'Funds Access',
      pass: false,
      value: 'OWNER_GATED',
      detail: 'Money actions remain mechanically unavailable regardless of the legacy fundsLocked setting.',
    },
    {
      id: 'live-arm',
      label: 'Legacy Live Setting',
      pass: false,
      value: 'OWNER_GATED',
      detail: 'The legacy setting is ignored by this product and cannot arm a route.',
    },
    {
      id: 'account-source',
      label: 'Private Account',
      pass: false,
      value: 'NOT_CONFIGURED',
      detail: 'No private account endpoint or user stream is mounted.',
    },
    {
      id: 'key-posture',
      label: 'API Key Posture',
      pass: false,
      value: 'OWNER_GATED',
      detail: 'No private key capability is accepted or projected by this surface.',
    },
    {
      id: 'symbol-policy',
      label: 'Symbol Policy',
      pass: config.allowedSymbols.length > 0,
      value: config.allowedSymbols.length ? String(config.allowedSymbols.length) + ' Allowed' : 'Empty',
      detail: config.allowedSymbols.length
        ? String(config.allowedSymbols.length) + ' locally allowed · ' + String(config.blockedSymbols.length) + ' explicitly blocked for validation.'
        : 'No symbol can pass the local validate-only policy.',
    },
    {
      id: 'order-limit',
      label: 'Per-Order Limit',
      pass: perOrderLimit > 0,
      value: fmtMoney(perOrderLimit),
      detail: perOrderLimit > 0 ? 'Hypothetical notional is checked against this advisory cap.' : 'Set a positive validate-only cap.',
    },
    {
      id: 'daily-notional',
      label: 'Daily Notional',
      pass: dailyUsed !== null && dailyLimit > 0 && dailyUsed < dailyLimit,
      value: dailyRemaining !== null ? fmtMoney(dailyRemaining) + ' Left' : 'UNKNOWN',
      detail: dailyUsed !== null
        ? fmtMoney(dailyUsed) + ' observed against the ' + fmtMoney(dailyLimit) + ' validate-only UTC-day cap.'
        : 'The server did not return a valid daily-notional total.',
    },
    {
      id: 'daily-loss',
      label: 'Daily Loss',
      pass: false,
      value: 'NOT_CONFIGURED',
      detail: 'Private account PnL and cost basis are not projected; no zero is assumed.',
    },
    {
      id: 'open-orders',
      label: 'Open Orders',
      pass: false,
      value: 'UNKNOWN',
      detail: 'Private open-order truth is not mounted; absence is not interpreted as zero.',
    },
    {
      id: 'cooldown',
      label: 'Cooldown',
      pass: cooldownLeft === 0,
      value: cooldownLeft > 0 ? String(cooldownLeft) + 's' : 'Ready',
      detail: cooldownLeft > 0 ? 'The validate-only interval has not elapsed.' : 'The local advisory interval has elapsed.',
    },
  ];

  const sortedConditions = [...gateConditions].sort((left, right) => Number(left.pass) - Number(right.pass));
  const failedConditions = gateConditions.filter((condition) => !condition.pass);
  const posture = 'halted';
  const postureLabel = 'Execution OWNER_GATED';

  const dirtyLimitKeys = LIMIT_FIELDS.filter((field) => draft[field.key] !== undefined);
  const invalidLimitKeys = LIMIT_FIELDS.filter((field) => {
    const raw = draft[field.key];
    if (raw === undefined) return false;
    const value = Number(raw);
    const requiresInteger = field.key === 'maxOpenOrders' || field.key === 'cooldownSec' || field.key === 'staleOrderMaxMin';
    return raw.trim() === '' || !Number.isFinite(value) || value < field.min || (requiresInteger && !Number.isInteger(value));
  });
  const canSaveLimits = dirtyLimitKeys.length > 0 && invalidLimitKeys.length === 0;

  const rejections = [...state.events]
    .filter((event) => event.kind === 'risk_decision' && riskDecisionData(event).allowed === false)
    .sort((left, right) => right.ts - left.ts)
    .slice(0, 5);

  const lastOrderText = state.risk.lastOrderTs ? timeAgo(state.risk.lastOrderTs) : 'No Order Yet';
  const lastOrderDetail = state.risk.lastOrderTs ? fmtDateTime(state.risk.lastOrderTs) : 'No order response is present in the ledger.';

  const patchList = async (key: 'allowedSymbols' | 'blockedSymbols', list: string[]): Promise<boolean> => {
    if (policyBusy) return false;
    setPolicyBusy(true);
    setSaveError(null);
    try {
      const next = await saveConfig({ [key]: uniqueSymbols(list) });
      if (next) return true;
      setSaveError('The server did not acknowledge the symbol-policy change.');
      return false;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The symbol-policy change failed.');
      return false;
    } finally {
      setPolicyBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!canSaveLimits || saving) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const next = await saveConfig(parseLimitDraft(draft));
      if (!next) {
        setSaveError('The server did not acknowledge the risk-limit change. Your draft was kept.');
        return;
      }
      setDraft({});
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The risk-limit change failed. Your draft was kept.');
    } finally {
      setSaving(false);
    }
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

    const generation = ++probeGeneration.current;
    setProbeBusy(true);
    try {
      const result = await preview({ symbol, side: probeSide, type: 'MARKET', quoteQty: amount });
      if (generation !== probeGeneration.current) return;
      if (!result) {
        setProbeError('The server did not return a validate-only result.');
        return;
      }

      setProbeResult(result);
      if (result.errors.length > 0) setProbeError(result.errors.map(cleanRiskText).join(' / '));
    } catch (error) {
      if (generation === probeGeneration.current) {
        setProbeError(error instanceof Error ? error.message : 'The validate-only check failed.');
      }
    } finally {
      if (generation === probeGeneration.current) setProbeBusy(false);
    }
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
              {String(failedConditions.length) + ' Blocker' + (failedConditions.length === 1 ? '' : 's')}
            </span>
          </div>

        </header>

        <ProductSurfaceAdapter surfaceId="risk" />

        {saveError ? <div className="riskx-probe-error" role="alert">{saveError}</div> : null}

        <div className="riskx-summary" aria-label="Risk Summary">
          <div className="riskx-summary-cell">
            <span>Daily Notional</span>
            <strong>{dailyUsed === null ? 'UNKNOWN' : fmtMoney(dailyUsed)} <em>/ {fmtMoney(dailyLimit)}</em></strong>
            {dailyUsed !== null ? <div className="riskx-meter"><i style={{ width: String(utilization(dailyUsed, dailyLimit)) + '%' }} /></div> : null}
          </div>
          <div className="riskx-summary-cell">
            <span>Realized Today</span>
            <strong className={realizedToday !== null && realizedToday < 0 ? 'negative' : ''}>
              {realizedToday === null ? 'UNKNOWN' : fmtMoney(realizedToday)}
            </strong>
            <small>NOT_CONFIGURED · advisory threshold -{fmtMoney(dailyLossLimit)}</small>
          </div>
          <div className="riskx-summary-cell">
            <span>Open Orders</span>
            <strong>UNKNOWN <em>/ {openOrderLimit}</em></strong>
            <small>Private order truth is NOT_CONFIGURED</small>
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
              <h2>Validate-Only Policy Gate</h2>
              <p>Advisory checks for hypothetical intent. LIVE_EXECUTION_NOT_IMPLEMENTED; no result can route money.</p>
            </div>
          </header>
          <div className="riskx-gate-table" role="table" aria-label="Validate-Only Policy Gate">
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
              <p>Local validate-only policy inputs. Saving them grants no execution authority.</p>
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
                    disabled={!canSaveLimits || saving}
                    title={invalidLimitKeys.length ? 'Fix: ' + invalidLimitKeys.map((field) => field.label).join(', ') : 'Save server limits'}
                    onClick={saveDraft}
                  >
                    {saving ? 'Saving…' : 'Save Changes'}
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
              <p>Local advisory policy for validate-only intent; an explicit block always wins.</p>
            </div>
          </header>

          <div className="riskx-policy-row">
            <div className="riskx-policy-copy">
              <strong>Allowed Symbols</strong>
              <span>{config.allowedSymbols.length ? String(config.allowedSymbols.length) + ' symbols can enter validation.' : 'No symbol can enter validation.'}</span>
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
                disabled={policyBusy || allowInput.length < 4 || config.allowedSymbols.includes(allowInput)}
                onClick={async () => {
                  if (await patchList('allowedSymbols', [...config.allowedSymbols, allowInput])) setAllowInput('');
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
                disabled={policyBusy}
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
                disabled={policyBusy || blockInput.length < 4 || config.blockedSymbols.includes(blockInput)}
                onClick={async () => {
                  if (await patchList('blockedSymbols', [...config.blockedSymbols, blockInput])) setBlockInput('');
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
                disabled={policyBusy}
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
              <h2>Validate Only</h2>
              <p>Evaluates hypothetical intent. No signed call, private read, borrow, transfer, or order is possible.</p>
            </div>
            {probeResult ? (
              <span className={'riskx-probe-state ' + (probeResult.risk.allowed ? 'clear' : 'blocked')}>
                <i aria-hidden="true" />
                {probeResult.risk.allowed ? 'Advisory Pass' : 'Advisory Reject'}
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
              {probeBusy ? 'Checking…' : 'Run Validate-Only Check'}
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

    </div>
  );
}
