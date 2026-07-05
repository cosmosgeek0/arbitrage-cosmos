import type { ReactNode } from 'react';
import { IconAlert } from './Icons';

/** Grouped settings list reusable across config pages. */
export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <>
      {title && <div className="settings-sec">{title}</div>}
      <div className="settings-group">{children}</div>
    </>
  );
}

export function GRow({
  icon,
  color,
  label,
  sub,
  control,
  onClick,
}: {
  icon?: ReactNode;
  color?: string;
  label: ReactNode;
  sub?: ReactNode;
  control?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className={`settings-row ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      {icon && (
        <span className="sr-icon" style={{ background: color ?? 'var(--muted)' }}>
          {icon}
        </span>
      )}
      <span className="sr-main">
        <span className="sr-label">{label}</span>
        {sub && <span className="sr-sub">{sub}</span>}
      </span>
      {control && <span className="sr-ctl">{control}</span>}
    </div>
  );
}

/** Small colored status pill for grouped rows (Connected / Active / Off …). */
export function StatePill({ tone, children }: { tone: 'ok' | 'bad' | 'warn' | 'idle'; children: ReactNode }) {
  return (
    <span className={`state-pill ${tone}`}>
      <span className="state-dot" />
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  delta,
  spark,
  onClick,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  spark?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button className={`stat-tile ${onClick ? 'clickable' : ''}`} onClick={onClick} disabled={!onClick}>
      <div className="stat-k">{label}</div>
      <div className="stat-v num">{value}</div>
      {delta !== undefined && <div className="stat-d">{delta}</div>}
      {spark && <div className="stat-spark">{spark}</div>}
    </button>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="e-title">{title}</div>
      {children && <div className="e-body">{children}</div>}
    </div>
  );
}

export function WarnStrip({ children }: { children: ReactNode }) {
  return (
    <div className="warn-strip">
      <IconAlert size={15} />
      <span>{children}</span>
    </div>
  );
}

export function SetupChecklist() {
  return (
    <ol className="setup-list">
      <li>Create an API key on Binance → <b>API Management</b></li>
      <li>Enable <b>Reading</b>. Leave withdrawals <b>disabled</b>. Enable spot trading only when ready for live sends.</li>
      <li>Restrict the key to this server’s IP</li>
      <li>On the server: copy <b>.env.example</b> → <b>.env</b>, fill the two key variables</li>
      <li>Restart the app — balances appear within seconds</li>
    </ol>
  );
}

export function SideTag({ side }: { side: string }) {
  return <span className={`chip-tag ${side === 'BUY' ? 'ok' : 'bad'}`}>{side}</span>;
}

export function KindChip({ kind }: { kind: string }) {
  const group = kind.includes('error')
    ? 'bad'
    : kind.startsWith('order') || kind.startsWith('fill') || kind.startsWith('loan')
      ? 'ok'
      : kind.startsWith('risk')
        ? 'gold'
        : kind.startsWith('strategy')
          ? 'purple'
          : '';
  return <span className={`chip-tag ${group}`}>{kind}</span>;
}

export function StatusDot({ status }: { status: string }) {
  const cls = status === 'open' || status === 'live' ? 'dot-live' : status === 'connecting' ? 'dot-stale' : status === 'closed' || status === 'failed' ? 'dot-off' : 'dot-none';
  return <span className={`dot ${cls}`} />;
}
