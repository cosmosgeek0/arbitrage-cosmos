import { IconBook } from '../components/Icons';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import { TokenIcon } from '../components/TokenIcon';
import { fmtDateTime, fmtMoney, timeAgo } from '../format';
import { useStore } from '../store';
import type { AppConfig, LedgerEvent } from '../types';
import './Risk.css';

type LimitKey =
  | 'maxOrderNotionalUsd'
  | 'maxDailyNotionalUsd'
  | 'maxDailyLossUsd'
  | 'maxOpenOrders'
  | 'cooldownSec'
  | 'staleOrderMaxMin';

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
  reason: string;
}[] = [
  { key: 'maxOrderNotionalUsd', label: 'Per-Order Notional', unit: 'USD', reason: 'Validate-only advisory cap for a hypothetical order.' },
  { key: 'maxDailyNotionalUsd', label: 'Daily Notional', unit: 'USD', reason: 'Validate-only UTC-day policy input.' },
  { key: 'maxDailyLossUsd', label: 'Daily Loss Stop', unit: 'USD', reason: 'Advisory loss threshold; private PnL remains unavailable.' },
  { key: 'maxOpenOrders', label: 'Open Orders', unit: 'Count', reason: 'Advisory concurrency input; private order truth is unavailable.' },
  { key: 'cooldownSec', label: 'Order Cooldown', unit: 'Sec', reason: 'Validate-only interval between hypothetical decisions.' },
  { key: 'staleOrderMaxMin', label: 'Stale Order Age', unit: 'Min', reason: 'Advisory age threshold for supplied order evidence.' },
];

const STAGE_LABELS: Record<string, string> = {
  risk_decision: 'Risk Decision',
  preview: 'Validate Only',
  order_intent: 'Order Intent',
  order_request: 'Order Request',
  order_response: 'Order Response',
};

// F-060: an unknown limit must never coerce to 0 — on a money surface a
// fabricated $0.00 is indistinguishable from a real zero limit, and it also
// flips gate conditions. null means "could not determine"; consumers render
// the literal 'UNKNOWN' (the established pattern in Opportunities.tsx).
function configNumber(config: AppConfig, key: LimitKey): number | null {
  const value = config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

function utilization(value: number | null, limit: number | null): number {
  if (value === null || limit === null) return 0;
  if (limit <= 0) return 100;
  return Math.max(0, Math.min(100, (value / limit) * 100));
}

export function Risk() {
  const { state, stateStatus, stateLastSuccessAtMs, stateError, setPage } = useStore();

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
  const dailyRemaining = dailyUsed !== null && dailyLimit !== null && dailyLimit > 0 ? Math.max(0, dailyLimit - dailyUsed) : null;
  const dailyLossLimit = configNumber(config, 'maxDailyLossUsd');
  const realizedToday: number | null = null;
  const openOrderLimit = configNumber(config, 'maxOpenOrders');
  const openOrdersCount: number | null = null;
  const cooldownSecKnown = typeof config.cooldownSec === 'number' && Number.isFinite(config.cooldownSec);
  const cooldownLeft: number | null = !cooldownSecKnown
    ? null
    : state.risk.lastOrderTs && config.cooldownSec > 0
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
      pass: perOrderLimit !== null && perOrderLimit > 0,
      value: perOrderLimit === null ? 'UNKNOWN' : fmtMoney(perOrderLimit),
      detail: perOrderLimit === null
        ? 'Cannot evaluate: the advisory cap is unknown, which is not the same as zero.'
        : perOrderLimit > 0 ? 'Hypothetical notional is checked against this advisory cap.' : 'Set a positive validate-only cap.',
    },
    {
      id: 'daily-notional',
      label: 'Daily Notional',
      pass: dailyUsed !== null && dailyLimit !== null && dailyLimit > 0 && dailyUsed < dailyLimit,
      value: dailyRemaining !== null ? fmtMoney(dailyRemaining) + ' Left' : 'UNKNOWN',
      detail: dailyLimit === null
        ? 'Cannot evaluate: the daily cap is unknown, which is not the same as zero.'
        : dailyUsed !== null
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
      value: cooldownLeft === null ? 'UNKNOWN' : cooldownLeft > 0 ? String(cooldownLeft) + 's' : 'Ready',
      detail: cooldownLeft === null
        ? 'Cannot evaluate: the cooldown interval is unknown.'
        : cooldownLeft > 0 ? 'The validate-only interval has not elapsed.' : 'The local advisory interval has elapsed.',
    },
  ];

  const sortedConditions = [...gateConditions].sort((left, right) => Number(left.pass) - Number(right.pass));
  const failedConditions = gateConditions.filter((condition) => !condition.pass);
  const posture = 'halted';
  const postureLabel = 'Execution OWNER_GATED';

  const rejections = [...state.events]
    .filter((event) => event.kind === 'risk_decision' && riskDecisionData(event).allowed === false)
    .sort((left, right) => right.ts - left.ts)
    .slice(0, 5);

  const lastOrderText = state.risk.lastOrderTs ? timeAgo(state.risk.lastOrderTs) : 'No Order Yet';
  const lastOrderDetail = state.risk.lastOrderTs ? fmtDateTime(state.risk.lastOrderTs) : 'No order response is present in the ledger.';

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

        {stateStatus !== 'CURRENT' && (
          <div className="riskx-state-truth" role="alert">
            {stateStatus === 'STALE' ? 'STALE LAST-KNOWN' : 'UNAVAILABLE'} · Compatibility state
            {stateLastSuccessAtMs === null ? ' has no successful read.' : ` last succeeded ${timeAgo(stateLastSuccessAtMs)}.`}
            {stateError ? ` ${stateError}` : ''}
          </div>
        )}

        <div className="riskx-summary" aria-label="Risk Summary">
          <div className="riskx-summary-cell">
            <span>Daily Notional</span>
            <strong>{dailyUsed === null ? 'UNKNOWN' : fmtMoney(dailyUsed)} <em>/ {dailyLimit === null ? 'UNKNOWN' : fmtMoney(dailyLimit)}</em></strong>
            {dailyUsed !== null && dailyLimit !== null ? <div className="riskx-meter"><i style={{ width: String(utilization(dailyUsed, dailyLimit)) + '%' }} /></div> : null}
          </div>
          <div className="riskx-summary-cell">
            <span>Realized Today</span>
            <strong className={realizedToday !== null && realizedToday < 0 ? 'negative' : ''}>
              {realizedToday === null ? 'UNKNOWN' : fmtMoney(realizedToday)}
            </strong>
            <small>NOT_CONFIGURED · advisory threshold {dailyLossLimit === null ? 'UNKNOWN' : '-' + fmtMoney(dailyLossLimit)}</small>
          </div>
          <div className="riskx-summary-cell">
            <span>Open Orders</span>
            <strong>UNKNOWN <em>/ {openOrderLimit === null ? 'UNKNOWN' : openOrderLimit}</em></strong>
            <small>Private order truth is NOT_CONFIGURED</small>
          </div>
          <div className="riskx-summary-cell">
            <span>Rejections Today</span>
            <strong>{state.risk.rejectionsToday}</strong>
            <small>{lastOrderText} · {lastOrderDetail}</small>
          </div>
        </div>

        <ProductSurfaceAdapter surfaceId="risk" />

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

        {/* The former readOnly disabled spinboxes are intentionally absent:
            policy values have no authenticated page-local preview/apply flow. */}
        <section className="riskx-section">
          <header className="riskx-section-head">
            <div>
              <h2>Limits</h2>
              <p>Read-only compatibility snapshot. Canonical Product controls own every operational risk-policy change.</p>
            </div>
            <div className="riskx-section-actions">
              <span className="riskx-result blocked"><i aria-hidden="true" />CONTROL_PREVIEW_REQUIRED</span>
            </div>
          </header>
          <div className="riskx-limit-table" role="table" aria-label="Risk Limits">
            <div className="riskx-limit-head" role="row">
              <span role="columnheader">Limit</span>
              <span role="columnheader">Purpose</span>
              <span role="columnheader">Current Value</span>
            </div>
            {LIMIT_FIELDS.map((field) => {
              const value = configNumber(config, field.key);
              const displayedValue = value === null ? 'UNKNOWN' : String(value);
              return (
                <div className="riskx-limit-row" role="row" key={field.key}>
                  <strong role="cell">
                    {field.label}
                  </strong>
                  <span role="cell" className="riskx-detail">{field.reason}</span>
                  <span
                    role="cell"
                    className={'riskx-limit-fact' + (value === null ? ' unavailable' : '')}
                    aria-label={`${field.label}: ${displayedValue} ${field.unit}. Owner gated; control preview required.`}
                  >
                    <strong>{displayedValue}</strong>
                    <em>{field.unit}</em>
                    <small>OWNER_GATED</small>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="riskx-section">
          <header className="riskx-section-head">
            <div>
              <h2>Symbol Policy</h2>
              <p>Read-only advisory truth. Symbol-policy mutation is OWNER_GATED and requires the canonical control-preview protocol.</p>
            </div>
            <span className="riskx-result blocked"><i aria-hidden="true" />CONTROL_PREVIEW_REQUIRED</span>
          </header>

          <div className="riskx-policy-row">
            <div className="riskx-policy-copy">
              <strong>Allowed Symbols</strong>
              <span>{config.allowedSymbols.length ? String(config.allowedSymbols.length) + ' symbols can enter validation.' : 'No symbol can enter validation.'}</span>
            </div>
            <span className="riskx-result blocked">OWNER_GATED</span>
          </div>
          <div className="riskx-symbol-list" aria-label="Allowed Symbols">
            {config.allowedSymbols.length ? config.allowedSymbols.map((symbol) => (
              <span
                key={symbol}
                className="riskx-symbol-chip"
                title={symbol + ' is recorded in the read-only allowlist'}
              >
                <TokenIcon symbol={symbol} size={18} />
                <span>{symbol}</span>
              </span>
            )) : <span className="riskx-policy-empty">Allowlist Empty</span>}
          </div>

          <div className="riskx-policy-row">
            <div className="riskx-policy-copy">
              <strong>Blocked Symbols</strong>
              <span>{config.blockedSymbols.length ? String(config.blockedSymbols.length) + ' symbols are explicitly blocked.' : 'No symbol-specific blocks are active.'}</span>
            </div>
            <span className="riskx-result blocked">OWNER_GATED</span>
          </div>
          <div className="riskx-symbol-list" aria-label="Blocked Symbols">
            {config.blockedSymbols.length ? config.blockedSymbols.map((symbol) => (
              <span
                key={symbol}
                className="riskx-symbol-chip blocked"
                title={symbol + ' is recorded in the read-only blocklist'}
              >
                <TokenIcon symbol={symbol} size={18} />
                <span>{symbol}</span>
              </span>
            )) : <span className="riskx-policy-empty">No Blocks</span>}
          </div>
        </section>

      </section>

    </div>
  );
}
