/* Risk — the kill switch, the live-arm gate, and every limit before a live
   order. Markets-voice anatomy: h1 hero + kill-switch guard tile + stat
   quartet, then side-by-side working columns. Full container width, one left
   rail, two ruled dividers, borderless rows, tonal Google-style icon tiles. */
import { useState } from 'react';
import { ConfirmModal } from '../components/Modal';
import {
  IconActivity,
  IconBook,
  IconChart,
  IconClock,
  IconList,
  IconLock,
  IconPulse,
  IconSearch,
} from '../components/Icons';
import { IconZapOff } from '../components/RiskIcons';
import { TokenIcon } from '../components/TokenIcon';
import { Pill, Seg, TINT, type Tone } from '../components/px';
import { fmtDateTime, fmtPrice, timeAgo } from '../format';
import { useStore } from '../store';
import type { AppConfig, LedgerEvent, PreviewResult, RiskCheck } from '../types';
import './Markets.css';

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
  { key: 'maxOrderNotionalUsd', label: 'Max Order Notional', serverName: 'maxOrderNotionalUsd', unit: 'USD', min: 0, step: '0.01', reason: 'Single-order hard cap.' },
  { key: 'maxDailyNotionalUsd', label: 'Max Daily Notional', serverName: 'maxDailyNotionalUsd', unit: 'USD', min: 0, step: '0.01', reason: 'UTC day order cap.' },
  { key: 'maxDailyLossUsd', label: 'Max Daily Loss', serverName: 'maxDailyLossUsd', unit: 'USD', min: 0, step: '0.01', reason: 'Daily loss stop.' },
  { key: 'maxOpenOrders', label: 'Max Open Orders', serverName: 'maxOpenOrders', unit: 'Count', min: 0, step: '1', reason: 'Concurrent order cap.' },
  { key: 'cooldownSec', label: 'Cooldown', serverName: 'cooldownSec', unit: 'Sec', min: 0, step: '1', reason: 'Minimum time between orders.' },
  { key: 'staleOrderMaxMin', label: 'Stale Order Max Age', serverName: 'staleOrderMaxMin', unit: 'Min', min: 1, step: '1', reason: 'Stale open-order flag.' },
];

/** Guards the server does not expose yet — one honest line, not six placeholder rows. */
const UNWIRED_GUARDS = 'Symbol Exposure · Open Positions · Order Rate · Spread · Slippage · Borrow Cap';

const RISK_CHECK_LABELS: Record<string, string> = {
  kill_switch_off: 'Kill Switch',
  live_trading_enabled: 'Live Trading',
  symbol_allowed: 'Allowed Symbols',
  symbol_blocked: 'Blocked Symbols',
  max_order_notional: 'Order Size',
  max_daily_notional: 'Daily Notional',
  max_daily_loss: 'Daily Loss',
  max_open_orders: 'Open Orders',
  cooldown: 'Cooldown',
  exchange_filters: 'Exchange Filters',
  stale_order: 'Stale Order',
};

const STAGE_LABELS: Record<string, string> = {
  risk_decision: 'Risk Decision',
  preview: 'Preview',
  order_intent: 'Order Intent',
  order_request: 'Order Request',
  order_response: 'Order Response',
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

/** Tonal icon tile — soft wash + colored glyph, never a saturated block. */
function Ico({ tint, children }: { tint: string; children: React.ReactNode }) {
  return (
    <span className="rsx-ico" style={{ color: tint, background: `color-mix(in srgb, ${tint} 11%, transparent)` }}>
      {children}
    </span>
  );
}

function RsxRow({
  icon,
  label,
  sub,
  end,
}: {
  icon?: React.ReactNode;
  label: string;
  sub?: string;
  end?: React.ReactNode;
}) {
  return (
    <div className="rsx-row">
      {icon}
      <span className="rsx-main">
        <b>{label}</b>
        {sub ? <em title={sub}>{sub}</em> : null}
      </span>
      <span className="rsx-end">{end}</span>
    </div>
  );
}

function RiskCheckTable({ checks }: { checks: RiskCheck[] }) {
  if (checks.length === 0) {
    return <div className="rsx-empty">The preview response contained no gate checks.</div>;
  }
  return (
    <table className="rsx-table">
      <colgroup>
        <col style={{ width: 170 }} />
        <col style={{ width: 90 }} />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th>Check</th>
          <th>Status</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((c) => (
          <tr key={c.name}>
            <td className="strong">{riskCheckLabel(c.name)}</td>
            <td><Pill tone={c.pass ? 'ok' : 'bad'}>{c.pass ? 'Pass' : 'Fail'}</Pill></td>
            <td className="dim" title={cleanRiskText(c.detail)}>{cleanRiskText(c.detail)}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
      <div className="container page mkx rsx-page">
        <header className="bwx-hero">
          <div className="bwx-hero-top">
            <div className="bwx-hero-title">
              <div className="bwx-title-row">
                <h1>Risk</h1>
                <Pill tone="idle">Connecting</Pill>
              </div>
              <p>Waiting for server state…</p>
            </div>
          </div>
        </header>
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
  const postureLabel = posture === 'HALTED' ? 'Halted' : posture === 'LIVE' ? 'Live Armed' : 'Paper';
  const postureTone: Tone = cfg.killSwitch ? 'bad' : cfg.liveTradingEnabled ? 'ok' : 'warn';

  // One list of gate conditions — the single source for "why can't anything act?".
  const gateConditions = [
    {
      label: 'Kill Switch Off',
      pass: !cfg.killSwitch,
      detail: cfg.killSwitch ? 'Live orders are paused before routing.' : 'Live orders may enter the risk gate.',
    },
    {
      label: 'Live Trading Armed',
      pass: cfg.liveTradingEnabled,
      detail: cfg.liveTradingEnabled ? 'Live trading is armed.' : 'Live trading is not armed.',
    },
    {
      label: 'Allowed Symbols',
      pass: cfg.allowedSymbols.length > 0,
      detail: cfg.allowedSymbols.length
        ? `${cfg.allowedSymbols.length} symbol${cfg.allowedSymbols.length === 1 ? '' : 's'} allowed.`
        : 'Add at least one symbol.',
    },
    {
      label: 'Order Size Limit',
      pass: perOrderLimit > 0,
      detail: perOrderLimit > 0 ? `${fmtPrice(perOrderLimit)} per order.` : 'Set a positive per-order limit.',
    },
    {
      label: 'Daily Notional Available',
      pass: dailyLimit > dailyUsed,
      detail: dailyLimit > dailyUsed ? `${fmtPrice(dailyRemaining)} available today.` : `${fmtPrice(dailyUsed)} used of ${fmtPrice(dailyLimit)}.`,
    },
    {
      label: 'Open-Order Capacity',
      pass: openOrderLimit > openOrdersCount,
      detail: openOrderLimit > openOrdersCount
        ? `${openOrderLimit - openOrdersCount} slot${openOrderLimit - openOrdersCount === 1 ? '' : 's'} available.`
        : `${openOrdersCount} open orders against a limit of ${openOrderLimit}.`,
    },
    {
      label: 'Cooldown Clear',
      pass: cooldownLeft === 0,
      detail: cooldownLeft > 0 ? `${cooldownLeft}s remaining.` : 'Ready now.',
    },
  ];
  const failedConditions = gateConditions.filter((c) => !c.pass);
  // "Armable" excludes the live-arm condition itself.
  const armBlocker = failedConditions.find((c) => c.label !== 'Live Trading Armed');
  const canArmLive = !cfg.liveTradingEnabled && !armBlocker;
  const sortedConditions = [...gateConditions].sort((a, b) => Number(a.pass) - Number(b.pass));

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
  const lastOrderText = state.risk.lastOrderTs ? timeAgo(state.risk.lastOrderTs) : '—';
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
    <div className="container page mkx rsx-page">
      {/* ---- hero: posture truth + the owner's kill switch ---------------- */}
      <header className="bwx-hero">
        <div className="bwx-hero-top">
          <div className="bwx-hero-title">
            <div className="bwx-title-row">
              <h1>Risk</h1>
              <Pill tone={postureTone}>{postureLabel}</Pill>
            </div>
            <p>
              {failedConditions.length
                ? `${failedConditions.length} Condition${failedConditions.length === 1 ? '' : 's'} Block Live · Every Order Passes The Server Gate`
                : 'Gate Clear · Every Order Passes The Server Gate'}
            </p>
          </div>
          <div className="bwx-guard">
            <span className="bwx-guard-copy">
              <b>Kill Switch</b>
              <em className={cfg.killSwitch ? 'blocked' : 'open'}>{cfg.killSwitch ? 'Halted' : 'Trading Possible'}</em>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={cfg.killSwitch}
              aria-label="Kill Switch"
              className={`bwx-switch2 ${cfg.killSwitch ? 'blocked' : 'open'}`}
              onClick={() => (cfg.killSwitch ? setModal('resume') : void setKill(true))}
            >
              <span aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="bwx-hero-metrics">
          <div className="bwx-hero-metric">
            <em>Daily Notional</em>
            <b>{fmtPrice(dailyUsed)}</b>
            <small>Of {fmtPrice(dailyLimit)} · {fmtPrice(dailyRemaining)} Available</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Open Orders</em>
            <b>{openOrdersCount} Of {openOrderLimit}</b>
            <small>Concurrent Order Cap</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Cooldown</em>
            <b>{cooldownLeft > 0 ? `${cooldownLeft}s` : 'Ready'}</b>
            <small>Minimum Time Between Orders</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Last Live Order</em>
            <b>{lastOrderText}</b>
            <small>{lastOrderDetail}</small>
          </div>
        </div>
      </header>

      {/* ---- working columns: control + gate | limits + symbols ----------- */}
      <section className="rsx-band">
        <div className="rsx-cols">
          <div className="rsx-col">
            <h3>Control</h3>
            <RsxRow
              icon={<Ico tint={TINT.green}><IconZapOff size={16} armed={canArmLive} /></Ico>}
              label="Live Arm"
              sub={
                cfg.liveTradingEnabled
                  ? 'Live trading is armed.'
                  : canArmLive
                    ? 'Ready to arm after confirmation.'
                    : armBlocker
                      ? `${armBlocker.label}: ${armBlocker.detail}`
                      : 'Locked.'
              }
              end={
                cfg.liveTradingEnabled ? (
                  <button type="button" className="hp-btn" onClick={() => void setLive(false)}>Disarm</button>
                ) : (
                  <button
                    type="button"
                    className="hp-btn primary"
                    disabled={!canArmLive}
                    title={armBlocker ? `${armBlocker.label}: ${armBlocker.detail}` : 'Ready to arm live trading'}
                    onClick={() => setModal('arm')}
                  >
                    Arm Live
                  </button>
                )
              }
            />
            <RsxRow
              icon={<Ico tint={TINT.blue}><IconPulse size={16} /></Ico>}
              label="Order Gate"
              sub={failedConditions.length ? failedConditions[0].detail : 'No global blocker is active. Per-order checks still run on every send.'}
              end={<Pill tone={failedConditions.length ? 'bad' : 'ok'}>{failedConditions.length ? 'Blocked' : 'Ready'}</Pill>}
            />

            <h3>Gate Conditions</h3>
            {sortedConditions.map((c) => (
              <RsxRow
                key={c.label}
                label={c.label}
                sub={c.detail}
                end={<Pill tone={c.pass ? 'ok' : 'bad'}>{c.pass ? 'Pass' : 'Fail'}</Pill>}
              />
            ))}

            <h3>Exposure</h3>
            <RsxRow
              icon={<Ico tint={TINT.green}><IconChart size={16} /></Ico>}
              label="Daily Notional"
              sub={`${fmtPrice(dailyRemaining)} remaining from the configured daily cap.`}
              end={<span className="rsx-val">{fmtPrice(dailyUsed)} / {fmtPrice(dailyLimit)}</span>}
            />
            <RsxRow
              icon={<Ico tint={TINT.slate}><IconClock size={16} /></Ico>}
              label="Last Live Order"
              sub={lastOrderDetail}
              end={<span className="rsx-val">{lastOrderText}</span>}
            />
          </div>

          <div className="rsx-col">
            <h3>Limits</h3>
            <RsxRow
              icon={<Ico tint={TINT.orange}><IconLock size={16} /></Ico>}
              label="Server Limits"
              sub="Saved to the server risk gate. Only wired limits are editable."
              end={
                <>
                  <button
                    type="button"
                    className="hp-btn"
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
                    className="hp-btn primary"
                    disabled={!canSaveLimits}
                    title={invalidLimitKeys.length ? `Invalid: ${invalidLimitKeys.map((f) => f.label).join(', ')}` : dirtyLimitKeys.length ? 'Save wired limits' : 'No edits to save'}
                    onClick={saveDraft}
                  >
                    {saved && dirtyLimitKeys.length === 0 ? 'Saved' : 'Save'}
                  </button>
                </>
              }
            />
            {LIMIT_FIELDS.map((field) => {
              const dirty = draft[field.key] !== undefined;
              const invalid = invalidLimitKeys.some((f) => f.key === field.key);
              return (
                <div key={field.key} className={`rsx-row${dirty ? ' dirty' : ''}`} title={`Server field: ${field.serverName}`}>
                  <span className="rsx-main">
                    <b>{field.label}</b>
                    <em>{field.reason}</em>
                  </span>
                  <span className="rsx-end">
                    <input
                      className={`hp-input num${invalid ? ' bad' : ''}`}
                      type="number"
                      min={field.min}
                      step={field.step}
                      value={limitValue(cfg, draft, field.key)}
                      onChange={(e) => {
                        setSaved(false);
                        setDraft({ ...draft, [field.key]: e.target.value });
                      }}
                    />
                    <span className="rsx-unit">{field.unit}</span>
                  </span>
                </div>
              );
            })}
            <RsxRow label="Unwired Guards" sub={UNWIRED_GUARDS} end={<Pill tone="idle">Not Wired</Pill>} />

            <h3>Symbols</h3>
            <RsxRow
              icon={<Ico tint={TINT.blue}><IconList size={16} /></Ico>}
              label="Allowed Symbols"
              sub={cfg.allowedSymbols.length ? `${cfg.allowedSymbols.length} symbol${cfg.allowedSymbols.length === 1 ? '' : 's'} allowed for live orders.` : 'Live orders need at least one allowed symbol.'}
              end={
                <>
                  <input
                    className="hp-input"
                    placeholder="BTCUSDT"
                    value={allowInput}
                    onChange={(e) => setAllowInput(sanitizeSymbol(e.target.value))}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="hp-btn primary"
                    disabled={allowInput.length < 4 || cfg.allowedSymbols.includes(allowInput)}
                    title={allowInput.length < 4 ? 'Enter a symbol first' : cfg.allowedSymbols.includes(allowInput) ? 'Already allowed' : `Add ${allowInput}`}
                    onClick={async () => {
                      await patchList('allowedSymbols', [...cfg.allowedSymbols, allowInput]);
                      setAllowInput('');
                    }}
                  >
                    Add
                  </button>
                </>
              }
            />
            {cfg.allowedSymbols.length > 0 && (
              <div className="rsx-chips">
                {cfg.allowedSymbols.map((s) => (
                  <button
                    type="button"
                    key={s}
                    className="risk-chip"
                    title={`Remove ${s} from allowed symbols`}
                    onClick={() => void patchList('allowedSymbols', cfg.allowedSymbols.filter((x) => x !== s))}
                  >
                    <TokenIcon symbol={s} size={15} />
                    {s}
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            )}
            <RsxRow
              icon={<Ico tint={TINT.red}><IconLock size={16} /></Ico>}
              label="Blocked Symbols"
              sub={cfg.blockedSymbols.length ? `${cfg.blockedSymbols.length} symbol${cfg.blockedSymbols.length === 1 ? '' : 's'} blocked.` : 'No symbol-specific blocks.'}
              end={
                <>
                  <input
                    className="hp-input"
                    placeholder="DOGEUSDT"
                    value={blockInput}
                    onChange={(e) => setBlockInput(sanitizeSymbol(e.target.value))}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="hp-btn danger"
                    disabled={blockInput.length < 4 || cfg.blockedSymbols.includes(blockInput)}
                    title={blockInput.length < 4 ? 'Enter a symbol first' : cfg.blockedSymbols.includes(blockInput) ? 'Already blocked' : `Block ${blockInput}`}
                    onClick={async () => {
                      await patchList('blockedSymbols', [...cfg.blockedSymbols, blockInput]);
                      setBlockInput('');
                    }}
                  >
                    Block
                  </button>
                </>
              }
            />
            {cfg.blockedSymbols.length > 0 && (
              <div className="rsx-chips">
                {cfg.blockedSymbols.map((s) => (
                  <button
                    type="button"
                    key={s}
                    className="risk-chip blocked"
                    title={`Remove ${s} from blocked symbols`}
                    onClick={() => void patchList('blockedSymbols', cfg.blockedSymbols.filter((x) => x !== s))}
                  >
                    <TokenIcon symbol={s} size={15} />
                    {s}
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---- preview probe | recent rejections ---------------------------- */}
      <section className="rsx-band">
        <div className="rsx-cols">
          <div className="rsx-col">
            <h3>Preview</h3>
            <RsxRow
              icon={<Ico tint={TINT.slate}><IconSearch size={16} /></Ico>}
              label="Preview An Order"
              sub="Runs the full gate against a hypothetical order. Nothing is sent."
              end={
                <Pill tone={probeResult ? (probeResult.risk.allowed ? 'ok' : 'bad') : 'idle'}>
                  {probeResult ? (probeResult.risk.allowed ? 'Pass' : 'Fail') : 'Idle'}
                </Pill>
              }
            />
            <div className="rsx-probe">
              <label>
                <span>Symbol</span>
                <input className="hp-input" value={probeSymbol} onChange={(e) => setProbeSymbol(sanitizeSymbol(e.target.value))} spellCheck={false} />
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
                <span>Notional USDT</span>
                <input className="hp-input num" type="number" min="0" step="0.01" value={probeNotional} onChange={(e) => setProbeNotional(e.target.value)} />
              </label>
              <div className="rsx-probe-go">
                <button type="button" className="hp-btn primary" disabled={probeBusy} onClick={runProbe}>
                  {probeBusy ? 'Checking…' : 'Preview'}
                </button>
              </div>
            </div>
            <div className="rsx-quick">
              {quickAmounts.map((amount) => (
                <button type="button" className="hp-btn" key={amount} onClick={() => setProbeNotional(String(amount))}>
                  {fmtPrice(amount)}
                </button>
              ))}
            </div>
            {probeError && <div className="rsx-alert">{probeError}</div>}
            {probeResult && (
              <>
                <RsxRow
                  icon={<TokenIcon symbol={probeResult.symbol} size={30} />}
                  label={`${probeResult.symbol} ${probeResult.side === 'BUY' ? 'Buy' : 'Sell'}`}
                  sub={probeResult.risk.reasons.map(cleanRiskText).join(' / ') || 'All returned checks passed.'}
                  end={<span className="rsx-val">{fmtPrice(probeResult.estNotionalUsd)}</span>}
                />
                <RiskCheckTable checks={probeResult.risk.checks} />
              </>
            )}
          </div>

          <div className="rsx-col">
            <h3>Recent Rejections</h3>
            <RsxRow
              icon={<Ico tint={TINT.red}><IconActivity size={16} /></Ico>}
              label="Rejected Decisions"
              sub="Last five risk decisions rejected by the order gate."
              end={
                <button type="button" className="hp-btn" onClick={() => setPage('ledger')}>
                  <IconBook size={13} />
                  Open Logs
                </button>
              }
            />
            {rejections.length === 0 ? (
              <div className="rsx-empty">The current snapshot has no rejected risk decisions.</div>
            ) : (
              <table className="rsx-table">
                <colgroup>
                  <col style={{ width: 100 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 130 }} />
                  <col />
                </colgroup>
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
                        <td className="strong">{ev.symbol ?? '—'}</td>
                        <td>{stageLabel(data.stage)}</td>
                        <td className="dim" title={data.reasons.map(cleanRiskText).join(' / ')}>
                          {data.reasons.length ? data.reasons.map(cleanRiskText).join(' / ') : 'No reason returned.'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      {modal === 'resume' && (
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
            This turns the kill switch off. Live orders still need the live-arm gate and server risk checks before routing.
          </p>
        </ConfirmModal>
      )}

      {modal === 'arm' && (
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
            Live order submission becomes possible only after the server re-checks kill switch, allowed symbols, blocked symbols,
            notional, open orders, cooldown, and daily loss.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
