import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useStore } from '../store';
import { GovernanceSection } from './Rules';
import { ConfirmModal } from '../components/Modal';
import { IconPower, IconShield, IconZapOff } from '../components/RiskIcons';
import { TokenIcon } from '../components/TokenIcon';
import { StatePill } from '../components/ui';
import {
  IconAlert,
  IconBook,
  IconClock,
  IconKeyboard,
  IconList,
  IconLock,
  IconPercent,
  IconSearch,
  IconTicket,
} from '../components/Icons';
import { fmtPrice, timeAgo } from '../format';
import type { AppConfig, PreviewResult, RiskCheck } from '../types';

type RiskTone = 'ok' | 'bad' | 'warn' | 'idle';

const LIMIT_FIELDS: { key: keyof AppConfig; label: string; help: string; unit: string; min: number; step: string }[] = [
  { key: 'maxOrderNotionalUsd', label: 'Max per order', help: 'Hard cap per single order before Binance sees it.', unit: '$', min: 0, step: '0.01' },
  { key: 'maxDailyNotionalUsd', label: 'Daily notional', help: 'Total sends allowed in a UTC day.', unit: '$', min: 0, step: '0.01' },
  { key: 'maxDailyLossUsd', label: 'Daily loss stop', help: 'Blocks sends after realized loss crosses this value.', unit: '$', min: 0, step: '0.01' },
  { key: 'maxOpenOrders', label: 'Open orders', help: 'Concurrent live orders allowed.', unit: '#', min: 0, step: '1' },
  { key: 'cooldownSec', label: 'Cooldown', help: 'Minimum seconds between live sends.', unit: 's', min: 0, step: '1' },
  { key: 'staleOrderMaxMin', label: 'Stale order flag', help: 'Orders older than this are marked stale.', unit: 'm', min: 1, step: '1' },
];

const SCANNER_FIELDS: { key: keyof AppConfig; label: string; help: string; unit: string; min: number; step: string }[] = [
  { key: 'feesPct', label: 'Est. fees', help: 'Estimated four-leg taker round trip.', unit: '%', min: 0, step: '0.01' },
  { key: 'minNetBasisPct', label: 'Min net edge', help: 'Required basis edge above fees.', unit: '%', min: 0, step: '0.01' },
  { key: 'persistTicks', label: 'Persistence', help: 'Two-second ticks before opening or closing a proposal.', unit: 'ticks', min: 1, step: '1' },
  { key: 'minQuoteVolume24h', label: '24h volume floor', help: 'Scanner ignores thinner symbols below this quote volume.', unit: '$', min: 0, step: '1' },
];

function clampPct(v: number): number {
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function cfgNum(cfg: AppConfig, draft: Record<string, number>, key: keyof AppConfig): number {
  const value = draft[key] ?? cfg[key];
  return typeof value === 'number' && isFinite(value) ? value : 0;
}

function sanitizeSymbol(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}

function uniqueSymbols(list: string[]): string[] {
  return [...new Set(list.map(sanitizeSymbol).filter((s) => s.length >= 5))];
}

function RiskMetric({ icon, label, value, sub, tone = 'idle' }: { icon: ReactNode; label: string; value: ReactNode; sub: ReactNode; tone?: RiskTone }) {
  return (
    <div className={`risk-metric ${tone}`}>
      <span className="risk-metric-icon">{icon}</span>
      <span className="risk-metric-body">
        <span className="risk-metric-label">{label}</span>
        <span className="risk-metric-value num">{value}</span>
        <span className="risk-metric-sub">{sub}</span>
      </span>
    </div>
  );
}

function GateStep({ icon, label, sub, tone }: { icon: ReactNode; label: string; sub: ReactNode; tone: RiskTone }) {
  return (
    <div className={`risk-gate-step ${tone}`}>
      <span className="risk-gate-icon">{icon}</span>
      <span>
        <b>{label}</b>
        <em>{sub}</em>
      </span>
    </div>
  );
}

function GateLamp({ icon, label, sub, tone }: { icon: ReactNode; label: string; sub: ReactNode; tone: RiskTone }) {
  return (
    <div className={`risk-lamp ${tone}`}>
      <span>{icon}</span>
      <b>{label}</b>
      <em>{sub}</em>
    </div>
  );
}

function MiniBar({ value, tone = 'ok' }: { value: number; tone?: RiskTone }) {
  return (
    <span className={`risk-mini-bar ${tone}`}>
      <span style={{ width: `${clampPct(value)}%` }} />
    </span>
  );
}

function FieldCard({
  field,
  cfg,
  draft,
  setDraft,
  setSaved,
}: {
  field: (typeof LIMIT_FIELDS)[number] | (typeof SCANNER_FIELDS)[number];
  cfg: AppConfig;
  draft: Record<string, number>;
  setDraft: (v: Record<string, number>) => void;
  setSaved: (v: boolean) => void;
}) {
  const value = cfgNum(cfg, draft, field.key);
  const dirty = draft[field.key] !== undefined;
  return (
    <label className={`risk-field ${dirty ? 'dirty' : ''}`}>
      <span className="risk-field-top">
        <span>{field.label}</span>
        <em>{field.unit}</em>
      </span>
      <input
        type="number"
        min={field.min}
        step={field.step}
        value={value}
        onChange={(e) => {
          setSaved(false);
          setDraft({ ...draft, [field.key]: Number(e.target.value) });
        }}
      />
      <span className="risk-field-help">{field.help}</span>
    </label>
  );
}

function RiskCheckRows({ checks }: { checks: RiskCheck[] }) {
  return (
    <div className="risk-probe-checks">
      {checks.map((c) => (
        <div key={c.name} className={`risk-probe-check ${c.pass ? 'pass' : 'fail'}`}>
          <span>{c.pass ? 'OK' : 'NO'}</span>
          <b>{c.name}</b>
          <em>{c.detail}</em>
        </div>
      ))}
    </div>
  );
}

export function Risk() {
  const { state, saveConfig, setKill, setLive, preview, setPage } = useStore();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [allowInput, setAllowInput] = useState('');
  const [blockInput, setBlockInput] = useState('');
  const [probeSymbol, setProbeSymbol] = useState('BTCUSDT');
  const [probeAmount, setProbeAmount] = useState('10');
  const [probeSide, setProbeSide] = useState<'BUY' | 'SELL'>('BUY');
  const [probeResult, setProbeResult] = useState<PreviewResult | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [modal, setModal] = useState<'resume' | 'arm' | null>(null);
  const [saved, setSaved] = useState(false);

  if (!state) return <div className="container page"><div className="empty-state">Connecting...</div></div>;
  const cfg = state.config;
  const mode = state.mode;
  const dailyLimit = cfgNum(cfg, draft, 'maxDailyNotionalUsd');
  const perOrderLimit = cfgNum(cfg, draft, 'maxOrderNotionalUsd');
  const usedPct = dailyLimit > 0 ? (state.risk.dailyNotionalUsedUsd / dailyLimit) * 100 : 0;
  const remainingDaily = Math.max(0, dailyLimit - state.risk.dailyNotionalUsedUsd);
  const openOrderPct = cfg.maxOpenOrders > 0 ? (state.openOrders.length / cfg.maxOpenOrders) * 100 : 0;
  const cooldownLeft =
    state.risk.lastOrderTs && cfg.cooldownSec > 0
      ? Math.max(0, Math.ceil((state.risk.lastOrderTs + cfg.cooldownSec * 1000 - Date.now()) / 1000))
      : 0;
  const grossThreshold = cfgNum(cfg, draft, 'feesPct') + cfgNum(cfg, draft, 'minNetBasisPct');
  const gateSteps = [
    { label: 'Kill switch', sub: cfg.killSwitch ? 'HALTED' : 'ready', tone: cfg.killSwitch ? 'bad' : 'ok', icon: <IconPower size={16} /> },
    { label: 'Live arm', sub: cfg.liveTradingEnabled ? 'armed' : 'manual only', tone: cfg.liveTradingEnabled ? 'ok' : 'warn', icon: <IconZapOff size={16} armed={cfg.liveTradingEnabled} /> },
    { label: 'Allowlist', sub: cfg.allowedSymbols.length ? `${cfg.allowedSymbols.length} symbols` : 'empty blocks sends', tone: cfg.allowedSymbols.length ? 'ok' : 'bad', icon: <IconList size={16} /> },
    { label: 'Daily cap', sub: `${fmtPrice(remainingDaily)} left`, tone: usedPct >= 100 ? 'bad' : usedPct > 70 ? 'warn' : 'ok', icon: <IconPercent size={16} /> },
    { label: 'Cooldown', sub: cooldownLeft > 0 ? `${cooldownLeft}s left` : 'clear', tone: cooldownLeft > 0 ? 'warn' : 'ok', icon: <IconClock size={16} /> },
    { label: 'Typed confirm', sub: 'server re-check', tone: 'ok', icon: <IconKeyboard size={16} /> },
    { label: 'Ledger', sub: 'every action', tone: 'ok', icon: <IconBook size={16} /> },
  ] as const;
  const gateVerdict = cfg.killSwitch
    ? { label: 'HALTED', tone: 'bad' as const, detail: 'Kill switch is on. Every live send is rejected before order routing.' }
    : !cfg.liveTradingEnabled
      ? { label: 'MANUAL ONLY', tone: 'warn' as const, detail: 'Preview and dry-run are available; live sends stay hidden.' }
      : cfg.allowedSymbols.length === 0
        ? { label: 'ARMED / BLOCKED', tone: 'bad' as const, detail: 'Live is armed, but an empty allowlist blocks every symbol.' }
        : { label: 'GATE READY', tone: 'ok' as const, detail: 'Live sends can only continue after all server-side checks pass.' };
  const instrumentStats = [
    { label: 'Daily used', value: fmtPrice(state.risk.dailyNotionalUsedUsd), sub: `${fmtPrice(remainingDaily)} left`, tone: usedPct >= 100 ? 'bad' : usedPct > 70 ? 'warn' : 'ok' },
    { label: 'Per order', value: fmtPrice(perOrderLimit), sub: 'hard cap', tone: perOrderLimit > 0 ? 'ok' : 'bad' },
    { label: 'Open slots', value: `${state.openOrders.length}/${cfg.maxOpenOrders}`, sub: 'live orders', tone: openOrderPct >= 100 ? 'bad' : openOrderPct > 70 ? 'warn' : 'ok' },
    { label: 'Rejects today', value: String(state.risk.rejectionsToday), sub: 'risk denials', tone: state.risk.rejectionsToday > 0 ? 'bad' : 'ok' },
  ] satisfies { label: string; value: string; sub: string; tone: RiskTone }[];

  const suggestedSymbols = useMemo(() => {
    const fromProposals = state.proposals.map((p) => p.symbol);
    const fromWatch = cfg.watchlist;
    const fromMarkets = state.proposals.length === 0 ? [] : state.proposals.slice(0, 4).map((p) => p.symbol);
    return uniqueSymbols([...fromProposals, ...fromWatch, ...fromMarkets]).filter((s) => !cfg.allowedSymbols.includes(s)).slice(0, 8);
  }, [state.proposals, cfg.watchlist, cfg.allowedSymbols]);

  const patchList = async (key: 'allowedSymbols' | 'blockedSymbols', list: string[]) => {
    await saveConfig({ [key]: uniqueSymbols(list) });
  };

  const saveDraft = async () => {
    await saveConfig(draft);
    setDraft({});
    setSaved(true);
  };

  const runProbe = async () => {
    const symbol = sanitizeSymbol(probeSymbol);
    const amount = Number(probeAmount);
    setProbeError(null);
    setProbeResult(null);
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
      setProbeError('Enter a valid Binance symbol such as BTCUSDT.');
      return;
    }
    if (!isFinite(amount) || amount <= 0) {
      setProbeError('Enter a positive USDT amount.');
      return;
    }
    setProbeBusy(true);
    const res = await preview({ symbol, side: probeSide, type: 'MARKET', quoteQty: amount });
    setProbeResult(res);
    setProbeBusy(false);
    if (!res) setProbeError('Preview request failed.');
  };

  return (
    <div className="container page risk-page">
      <section className={`card risk-instrument ${gateVerdict.tone}`}>
        <div className="risk-instrument-head">
          <div>
            <span className="risk-eyebrow">Server-side risk console</span>
            <h1 className="page-title">Risk</h1>
            <p>{gateVerdict.detail}</p>
          </div>
          <StatePill tone={gateVerdict.tone}>{gateVerdict.label}</StatePill>
        </div>

        <div className="risk-instrument-grid">
          <div className="risk-verdict-panel">
            <span className="risk-verdict-icon" style={{ '--risk-used': `${clampPct(usedPct)}%` } as CSSProperties}>
              <IconShield size={34} />
            </span>
            <div>
              <b>{gateVerdict.label}</b>
              <em>{mode}</em>
            </div>
            <div className="risk-verdict-actions">
              {cfg.killSwitch ? (
                <button className="cta-pill" onClick={() => setModal('resume')}>Resume...</button>
              ) : (
                <button className="cta-pill danger" onClick={() => void setKill(true)}>
                  <IconPower size={15} />
                  Halt now
                </button>
              )}
              <button className="mini-btn" onClick={() => setPage('trade')}>
                <IconTicket size={14} />
                Probe ticket
              </button>
              <button className="mini-btn" onClick={() => setPage('ledger')}>
                <IconBook size={14} />
                Audit trail
              </button>
            </div>
          </div>

          <div className="risk-stat-board">
            {instrumentStats.map((item) => (
              <div className={`risk-stat-line ${item.tone}`} key={item.label}>
                <span>{item.label}</span>
                <b className="num">{item.value}</b>
                <em>{item.sub}</em>
              </div>
            ))}
            <div className="risk-stat-line span">
              <span>Daily utilization</span>
              <b className="num">{clampPct(usedPct).toFixed(0)}%</b>
              <MiniBar value={usedPct} tone={usedPct >= 100 ? 'bad' : usedPct > 70 ? 'warn' : 'ok'} />
            </div>
          </div>

          <div className="risk-lamp-board">
            {gateSteps.map((s) => <GateLamp key={s.label} icon={s.icon} label={s.label} sub={s.sub} tone={s.tone} />)}
          </div>
        </div>
      </section>

      <div className="risk-grid-main">
        <section className="card risk-control-card">
          <div className="risk-section-head">
            <div>
              <h2>Safety controls</h2>
              <span>Kill is instant. Resume and live arm require typed confirmation.</span>
            </div>
          </div>
          <div className={`risk-arm-card ${cfg.killSwitch ? 'danger' : 'ready'}`}>
            <span className="risk-arm-icon"><IconPower size={18} /></span>
            <div>
              <b>Kill switch</b>
              <p>{cfg.killSwitch ? 'HALTED. The risk gate rejects every live send.' : 'Running. You can halt instantly from here or the top bar.'}</p>
            </div>
            {cfg.killSwitch ? (
              <button className="cta-pill" onClick={() => setModal('resume')}>Resume...</button>
            ) : (
              <button className="cta-pill danger" onClick={() => void setKill(true)}>HALT</button>
            )}
          </div>
          <div className={`risk-arm-card ${cfg.liveTradingEnabled ? 'ready' : 'manual'}`}>
            <span className="risk-arm-icon"><IconZapOff size={18} armed={cfg.liveTradingEnabled} /></span>
            <div>
              <b>Live trading</b>
              <p>{cfg.liveTradingEnabled ? 'Live buttons can appear, but every order still passes all gates.' : 'Live sends and loan borrowing stay blocked. Preview and dry-run remain available.'}</p>
            </div>
            {cfg.liveTradingEnabled ? (
              <button className="mini-btn" onClick={() => void setLive(false)}>Disarm</button>
            ) : (
              <button className="cta-pill" disabled={cfg.killSwitch} title={cfg.killSwitch ? 'Resume the kill switch first' : 'Requires typed ARM confirmation'} onClick={() => setModal('arm')}>Arm live...</button>
            )}
          </div>
        </section>

        <section className="card risk-probe-card">
          <div className="risk-section-head">
            <div>
              <h2>Gate probe</h2>
              <span>Dry-run a market intent through the same preview/risk path. Nothing is sent.</span>
            </div>
            <StatePill tone={probeResult ? (probeResult.risk.allowed ? 'ok' : 'bad') : 'idle'}>
              {probeResult ? (probeResult.risk.allowed ? 'Passing' : 'Blocked') : 'Idle'}
            </StatePill>
          </div>
          <div className="risk-probe-form">
            <label>
              <span>Symbol</span>
              <input value={probeSymbol} onChange={(e) => setProbeSymbol(sanitizeSymbol(e.target.value))} placeholder="BTCUSDT" spellCheck={false} />
            </label>
            <label>
              <span>Notional</span>
              <input type="number" min="0" step="0.01" value={probeAmount} onChange={(e) => setProbeAmount(e.target.value)} />
            </label>
            <span className="seg risk-side-seg">
              {(['BUY', 'SELL'] as const).map((s) => (
                <button key={s} className={probeSide === s ? 'on' : ''} onClick={() => setProbeSide(s)}>
                  {s}
                </button>
              ))}
            </span>
            <button className="cta-pill" disabled={probeBusy} onClick={runProbe}>
              <IconSearch size={14} />
              {probeBusy ? 'Checking' : 'Run check'}
            </button>
          </div>
          <div className="risk-quick-row">
            {[Math.min(5, perOrderLimit), Math.min(10, perOrderLimit), perOrderLimit].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => (
              <button key={v} className="mini-btn" onClick={() => setProbeAmount(String(v))}>
                {fmtPrice(v)}
              </button>
            ))}
          </div>
          {probeError && <div className="result-strip bad">{probeError}</div>}
          {probeResult && (
            <div className="risk-probe-result">
              <div className="risk-probe-summary">
                <span className="tok">
                  <TokenIcon symbol={probeResult.symbol} size={24} />
                  {probeResult.symbol}
                </span>
                <b className="num">{fmtPrice(probeResult.estNotionalUsd)}</b>
                <em>{probeResult.risk.allowed ? 'would pass preview' : probeResult.risk.reasons.join(' / ') || 'blocked'}</em>
              </div>
              <RiskCheckRows checks={probeResult.risk.checks} />
            </div>
          )}
        </section>
      </div>

      <section className="card risk-limits-card">
        <div className="risk-section-head">
          <div>
            <h2>Trading limits</h2>
            <span>Black values are live config. Edited fields get a golden rim until saved.</span>
          </div>
          <div className="risk-save-actions">
            <button className="mini-btn" disabled={Object.keys(draft).length === 0} onClick={() => { setDraft({}); setSaved(false); }}>
              Reset edits
            </button>
            <button className="cta-pill" disabled={Object.keys(draft).length === 0} onClick={saveDraft}>
              {saved ? 'Saved' : 'Save changes'}
            </button>
          </div>
        </div>
        <div className="risk-capacity-row">
          <div>
            <span>Daily utilization</span>
            <b className="num">{fmtPrice(state.risk.dailyNotionalUsedUsd)} / {fmtPrice(dailyLimit)}</b>
            <MiniBar value={usedPct} tone={usedPct >= 100 ? 'bad' : usedPct > 70 ? 'warn' : 'ok'} />
          </div>
          <div>
            <span>Open order slots</span>
            <b className="num">{state.openOrders.length} / {cfg.maxOpenOrders}</b>
            <MiniBar value={openOrderPct} tone={openOrderPct >= 100 ? 'bad' : openOrderPct > 70 ? 'warn' : 'ok'} />
          </div>
        </div>
        <div className="risk-field-grid">
          {LIMIT_FIELDS.map((field) => (
            <FieldCard key={field.key} field={field} cfg={cfg} draft={draft} setDraft={setDraft} setSaved={setSaved} />
          ))}
        </div>
      </section>

      <section className="card risk-scanner-card">
        <div className="risk-section-head">
          <div>
            <h2>Scanner edge policy</h2>
            <span>Proposal quality gate before anything reaches manual approval.</span>
          </div>
          <span className="risk-threshold num">{grossThreshold.toFixed(2)}% gross basis required</span>
        </div>
        <div className="risk-edge-stack">
          <div style={{ '--w': `${clampPct((cfgNum(cfg, draft, 'feesPct') / Math.max(grossThreshold, 0.01)) * 100)}%` } as CSSProperties}>
            <span>Fees</span><b>{cfgNum(cfg, draft, 'feesPct').toFixed(2)}%</b>
          </div>
          <div style={{ '--w': `${clampPct((cfgNum(cfg, draft, 'minNetBasisPct') / Math.max(grossThreshold, 0.01)) * 100)}%` } as CSSProperties}>
            <span>Net edge</span><b>{cfgNum(cfg, draft, 'minNetBasisPct').toFixed(2)}%</b>
          </div>
        </div>
        <div className="risk-field-grid scanner">
          {SCANNER_FIELDS.map((field) => (
            <FieldCard key={field.key} field={field} cfg={cfg} draft={draft} setDraft={setDraft} setSaved={setSaved} />
          ))}
        </div>
      </section>

      <div className="risk-list-grid">
        <section className="card risk-symbol-card">
          <div className="risk-section-head">
            <div>
              <h2>Symbol allowlist</h2>
              <span>{cfg.allowedSymbols.length === 0 ? 'Empty allowlist rejects every live send.' : `${cfg.allowedSymbols.length} symbols can pass the allowlist gate.`}</span>
            </div>
            <StatePill tone={cfg.allowedSymbols.length ? 'ok' : 'bad'}>{cfg.allowedSymbols.length ? 'Active' : 'Empty'}</StatePill>
          </div>
          <div className="risk-symbol-chips">
            {cfg.allowedSymbols.map((s) => (
              <button key={s} className="risk-symbol-chip" onClick={() => void patchList('allowedSymbols', cfg.allowedSymbols.filter((x) => x !== s))} title="Remove from allowlist">
                <TokenIcon symbol={s} size={20} />
                {s}
                <span>x</span>
              </button>
            ))}
          </div>
          <div className="risk-symbol-add">
            <input placeholder="Add e.g. BTCUSDT" value={allowInput} onChange={(e) => setAllowInput(sanitizeSymbol(e.target.value))} spellCheck={false} />
            <button
              className="cta-pill"
              disabled={allowInput.length < 5 || cfg.allowedSymbols.includes(allowInput)}
              onClick={async () => {
                await patchList('allowedSymbols', [...cfg.allowedSymbols, allowInput]);
                setAllowInput('');
              }}
            >
              Allow
            </button>
          </div>
          {suggestedSymbols.length > 0 && (
            <div className="risk-suggestions">
              <span>Suggested from watchlist/proposals</span>
              <div>
                {suggestedSymbols.map((s) => (
                  <button key={s} className="mini-btn" onClick={() => void patchList('allowedSymbols', [...cfg.allowedSymbols, s])}>
                    <TokenIcon symbol={s} size={16} />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="card risk-symbol-card">
          <div className="risk-section-head">
            <div>
              <h2>Blocklist</h2>
              <span>Blocklist wins even if a symbol is allowed.</span>
            </div>
            <StatePill tone={cfg.blockedSymbols.length ? 'warn' : 'idle'}>{cfg.blockedSymbols.length || 'None'}</StatePill>
          </div>
          <div className="risk-symbol-chips blocked">
            {cfg.blockedSymbols.map((s) => (
              <button key={s} className="risk-symbol-chip blocked" onClick={() => void patchList('blockedSymbols', cfg.blockedSymbols.filter((x) => x !== s))} title="Remove from blocklist">
                <TokenIcon symbol={s} size={20} />
                {s}
                <span>x</span>
              </button>
            ))}
          </div>
          <div className="risk-symbol-add">
            <input placeholder="Block e.g. DOGEUSDT" value={blockInput} onChange={(e) => setBlockInput(sanitizeSymbol(e.target.value))} spellCheck={false} />
            <button
              className="cta-pill danger"
              disabled={blockInput.length < 5 || cfg.blockedSymbols.includes(blockInput)}
              onClick={async () => {
                await patchList('blockedSymbols', [...cfg.blockedSymbols, blockInput]);
                setBlockInput('');
              }}
            >
              Block
            </button>
          </div>
        </section>
      </div>

      <section className="card risk-governance-card">
        <div className="risk-section-head">
          <div>
            <h2>Rules &amp; governance</h2>
            <span>Everything this cockpit may and may not do — platform rules plus your own. Ledgered on change.</span>
          </div>
        </div>
        <GovernanceSection />
      </section>

      {modal === 'resume' && (
        <ConfirmModal
          title="Resume from kill switch"
          requireText="RESUME"
          confirmLabel="Resume"
          onConfirm={async () => {
            await setKill(false);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        >
          <p className="muted">
            Turning the kill switch off lets the risk gate evaluate orders again. Live sends stay blocked until you also arm live trading.
          </p>
        </ConfirmModal>
      )}
      {modal === 'arm' && (
        <ConfirmModal
          title="Arm live trading"
          requireText="ARM"
          confirmLabel="Arm live trading"
          danger
          onConfirm={async () => {
            await setLive(true);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        >
          <p className="muted">
            Shows the Send live button and enables loan borrowing. Real money becomes possible, but each send still passes limits, allowlist, cooldown, typed confirmation, and server re-check.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
