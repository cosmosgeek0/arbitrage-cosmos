import { Activity, BarChart3, Gauge, ScanLine } from 'lucide-react';
import {
  formatAge,
  formatCount,
  formatUsd,
  moneyTone,
  projectStrategyDashboard,
  type StrategyDashboardTone,
} from './model';
import { StrategyPerformanceChart } from './StrategyPerformanceChart';
import type {
  AccountPnlInput,
  StrategyEngineView,
  SupervisorRuntimeInput,
} from './types';
import './strategyDashboard.css';

function valueClass(tone: StrategyDashboardTone): string {
  return tone === 'idle' ? '' : tone;
}

function TruthTag({
  label,
  tone,
}: {
  label: string;
  tone: StrategyDashboardTone;
}) {
  return <span className={`strd-truth ${tone}`}>{label}</span>;
}

function SummaryCell({
  label,
  value,
  detail,
  tone = 'idle',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: StrategyDashboardTone;
}) {
  return (
    <div className="strd-summary-cell">
      <span>{label}</span>
      <strong className={valueClass(tone)}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function StrategyPanel({
  strategy,
  nowMs,
}: {
  strategy: Readonly<StrategyEngineView>;
  nowMs: number;
}) {
  const Icon = strategy.strategyId === 'basis' ? Gauge : ScanLine;
  const reasons = strategy.reasonCodes.length > 0
    ? strategy.reasonCodes.join(' · ')
    : 'No named runtime reason published';
  return (
    <section
      className={`strd-strategy ${strategy.strategyId}`}
      aria-labelledby={`strd-${strategy.strategyId}-title`}
    >
      <header className="strd-strategy-head">
        <span className="strd-strategy-identity">
          <i><Icon size={17} aria-hidden="true" /></i>
          <span>
            <h2 id={`strd-${strategy.strategyId}-title`}>{strategy.label}</h2>
            <small>Engine Runtime + Evidence Boundary</small>
          </span>
        </span>
        <span className="strd-tags">
          <TruthTag
            label={`${strategy.readiness} · ${strategy.truthLabel}`}
            tone={strategy.tone}
          />
          <TruthTag
            label="PnL + Outcomes UNKNOWN"
            tone="bad"
          />
        </span>
      </header>

      <div className="strd-strategy-metrics">
        <SummaryCell
          label={`${strategy.label} Realized PnL`}
          value="UNKNOWN"
          detail="No owned realized PnL or outcome evidence published"
          tone="bad"
        />
        <SummaryCell label="Candidates" value={formatCount(strategy.candidateCount)} detail="Supervisor Runtime Count" />
        <SummaryCell label="Proposals" value={formatCount(strategy.proposalCount)} detail="Supervisor Runtime Count" />
        <SummaryCell label="Rejected Decisions" value={formatCount(strategy.rejectionCount)} detail="Not Realized Outcomes" />
        <SummaryCell label="Accepted Decisions" value={formatCount(strategy.acceptedCount)} detail="Not Realized Outcomes" />
      </div>

      <dl className="strd-engine-strip">
        <div>
          <dt>Engine Phase</dt>
          <dd>{strategy.phase}</dd>
        </div>
        <div>
          <dt>Freshness</dt>
          <dd>{strategy.freshnessLabel}</dd>
        </div>
        <div>
          <dt>Heartbeat</dt>
          <dd>{formatAge(strategy.heartbeatAtMs, nowMs)}</dd>
        </div>
        <div>
          <dt>Last Decision</dt>
          <dd>{formatAge(strategy.lastDecisionAtMs, nowMs)}</dd>
        </div>
        <div className="wide">
          <dt>Named Runtime Reason</dt>
          <dd>{reasons}</dd>
        </div>
      </dl>
    </section>
  );
}

export interface StrategyDashboardProps {
  readonly runtime: Readonly<SupervisorRuntimeInput>;
  readonly pnl: Readonly<AccountPnlInput>;
  readonly nowMs: number;
}

export function StrategyDashboard({
  runtime,
  pnl,
  nowMs,
}: StrategyDashboardProps) {
  const view = projectStrategyDashboard(runtime, pnl, nowMs);

  return (
    <section className="strd-page" aria-labelledby="strd-title">
      <div className="strd-frame">
        <header className="strd-toolbar">
          <span className="strd-title">
            <BarChart3 size={20} aria-hidden="true" />
            <span>
              <h1 id="strd-title">Strategy Dashboard</h1>
              <small>Basis + Volume Runtime · Account Money Truth</small>
            </span>
          </span>
          <TruthTag label={view.overallLabel} tone={view.overallTone} />
        </header>

        <section className="strd-summary" aria-label="Account money and strategy evidence summary">
          <SummaryCell
            label="Unattributed Account Realized PnL"
            value={formatUsd(view.pnl.totalRealizedUsd, true)}
            detail={`${view.pnl.evidenceLabel} · /api/pnl Aggregate`}
            tone={moneyTone(view.pnl.totalRealizedUsd, view.pnl.tone)}
          />
          <SummaryCell
            label="Published UTC Days"
            value={view.pnl.publishable ? formatCount(view.pnl.points.length) : '—'}
            detail={view.pnl.publishable ? 'Chart / Table Parity' : 'Values Withheld'}
          />
          <SummaryCell
            label="Strategy PnL + Outcomes"
            value="UNKNOWN"
            detail="No owned strategy PnL or realized-outcome evidence published"
            tone="bad"
          />
        </section>

        <aside className="strd-boundary" aria-label="Attribution boundary">
          <Activity size={16} aria-hidden="true" />
          <span>
            <strong>Attribution Boundary</strong>
            <small>
              /api/pnl supplies account aggregate money only. Basis and Volume activity counts are runtime state, not closed or realized outcomes.
            </small>
          </span>
        </aside>

        <div className="strd-strategy-grid">
          {view.strategies.map((strategy) => (
            <StrategyPanel key={strategy.strategyId} strategy={strategy} nowMs={nowMs} />
          ))}
        </div>

        <StrategyPerformanceChart pnl={view.pnl} />
      </div>
    </section>
  );
}
