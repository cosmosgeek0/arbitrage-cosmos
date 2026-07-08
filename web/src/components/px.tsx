import type { CSSProperties, ReactNode } from 'react';

/**
 * px — precision primitives. One locked visual system for every cockpit page.
 * Rules (see styles.css "PRECISION SYSTEM"):
 *   type 11/12/13/24/28 · weights 450/500/600/680 · 4px spacing grid ·
 *   radii 8/10/12 · saturated color marks STATE ONLY · values mono+tabular.
 */

export type Tone = 'ok' | 'warn' | 'bad' | 'idle';

/** Small state dot. Color is the only signal — no halo, no glow. */
export function Dot({ tone }: { tone: Tone }) {
  return <span className={`hp-dot ${tone}`} aria-hidden="true" />;
}

/** Dot + colored 12/600 label. The single status-pill style. */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`hp-pill ${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

/** Uppercase 11px section label. */
export function Sec({ children }: { children: ReactNode }) {
  return <h2 className="hp-sec">{children}</h2>;
}

/** Panel that groups Rows (macOS settings list, quiet icons). */
export function Group({ children }: { children: ReactNode }) {
  return <section className="hp-group">{children}</section>;
}

/** 56px grouped row: quiet icon · label+sub · right-aligned end cluster. */
/** macOS-settings tile palette for Row tints. */
export const TINT = {
  blue: '#2f6bff',
  green: '#0a9b64',
  red: '#e0414b',
  orange: '#d98a25',
  purple: '#8257e0',
  teal: '#0aa5a5',
  pink: '#e0568c',
  indigo: '#4f5bd5',
  slate: '#6b7482',
} as const;

export function Row({
  icon,
  tint,
  label,
  sub,
  end,
  onClick,
}: {
  icon?: ReactNode;
  /** colored macOS-style icon tile; omit for a bare dark glyph */
  tint?: string;
  label: ReactNode;
  sub?: ReactNode;
  end?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className={`hp-row${onClick ? ' clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      {icon && <span className={`hp-ic${tint ? ' tinted' : ''}`} style={tint ? ({ '--tint': tint } as CSSProperties) : undefined}>{icon}</span>}
      <span className="hp-main">
        <span className="hp-label">{label}</span>
        {sub && <span className="hp-sub">{sub}</span>}
      </span>
      {end && <span className="hp-end">{end}</span>}
    </div>
  );
}

/** Page header: soft tinted mark · title+sub · right meta lines. */
export function PageHead({
  mark,
  tone = 'idle',
  title,
  sub,
  meta,
}: {
  mark: ReactNode;
  tone?: Tone;
  title: string;
  sub: string;
  meta?: ReactNode;
}) {
  return (
    <header className="hp-head">
      <span className={`hp-mark ${tone}`}>{mark}</span>
      <div className="hp-head-copy">
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {meta && <div className="hp-head-meta">{meta}</div>}
    </header>
  );
}

/** Honest empty state: one compact block, never a wall of dashes. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="hp-empty">
      <b>{title}</b>
      {children && <span>{children}</span>}
    </div>
  );
}

/** Segmented control (trading mode, tab strips). */
export function Seg<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`hp-seg${disabled ? ' disabled' : ''}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === value}
          className={o.id === value ? 'active' : ''}
          disabled={disabled}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
