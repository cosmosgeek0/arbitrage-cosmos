import type { ReactNode } from 'react';
import { IconAlert } from './Icons';

export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: 'green' | 'red' | 'amber' | 'gold';
}) {
  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${accent ?? ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function WarnBanner({ children }: { children: ReactNode }) {
  return (
    <div className="warn-banner">
      <IconAlert size={16} />
      <span>{children}</span>
    </div>
  );
}

export function SetupChecklist() {
  const steps = [
    'Create an API key on Binance (API Management)',
    'Enable Reading. Leave withdrawals DISABLED. Enable spot trading only when ready for live sends.',
    'Restrict the key to this server’s IP',
    'On the server: copy .env.example to .env, fill BINANCE_API_KEY and BINANCE_API_SECRET',
    'Restart the app — this page will show your balances',
  ];
  return (
    <ol className="setup-list">
      {steps.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ol>
  );
}

export function SideTag({ side }: { side: string }) {
  return <span className={`side-tag ${side === 'BUY' ? 'buy' : 'sell'}`}>{side}</span>;
}

export function KindChip({ kind }: { kind: string }) {
  const group = kind.includes('error')
    ? 'err'
    : kind.startsWith('order') || kind.startsWith('fill')
      ? 'order'
      : kind.startsWith('risk')
        ? 'risk'
        : kind.startsWith('strategy')
          ? 'strat'
          : kind.startsWith('manual') || kind === 'config_change'
            ? 'manual'
            : 'sys';
  return <span className={`kind-chip kind-${group}`}>{kind}</span>;
}
