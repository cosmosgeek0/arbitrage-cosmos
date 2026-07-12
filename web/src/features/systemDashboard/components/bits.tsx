// systemDashboard/components/bits.tsx — shared atoms. Every truth badge,
// tone chip, and value cell on the dashboard is one of these, so the honest
// rendering rules live in exactly one place.

import type { ReactNode } from 'react';
import type { SystemTruthLabel } from '../../../lib/systemIntegration';
import { UNKNOWN_TEXT, truthBadge, type Tone } from '../lib/presentation';

/** Tone dot + short state text. The only status chip on the surface. */
export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`sdx-chip ${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

/** Truth provenance badge — always rendered, never optional. */
export function TruthTag({ label }: { label: SystemTruthLabel }) {
  const spec = truthBadge(label);
  return <span className={`sdx-truth ${spec.klass}`}>{spec.text}</span>;
}

/** Mono value cell. UNKNOWN gets the muted letter-spaced treatment so it is
 *  visibly a stated unknown, not a formatting accident. */
export function Val({ text, tone }: { text: string; tone?: 'bad' | 'warn' | 'ok' }) {
  const unknown = text === UNKNOWN_TEXT;
  return <span className={`sdx-val${unknown ? ' unk' : ''}${tone && !unknown ? ` ${tone}` : ''}`}>{text}</span>;
}

/** 34px caps section band with optional right-side meta. */
export function Band({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <header className="sdx-band">
      <h2>{title}</h2>
      {meta && <div className="sdx-band-meta">{meta}</div>}
    </header>
  );
}

/** Honesty row for facts the owner asked for that snapshot schema v1 does not
 *  publish. Rendering a stated gap beats inventing a value. */
export function NotPublished({ children }: { children: ReactNode }) {
  return (
    <div className="sdx-not-published">
      <code>NOT IN SNAPSHOT V1</code>
      <span>{children}</span>
    </div>
  );
}

/** Generic fact row: primary + secondary on the left, cluster on the right. */
export function FactRow({ label, sub, end }: { label: ReactNode; sub?: ReactNode; end?: ReactNode }) {
  return (
    <div className="sdx-row">
      <span className="sdx-row-main">
        <strong>{label}</strong>
        {sub && <small>{sub}</small>}
      </span>
      {end && <span className="sdx-row-end">{end}</span>}
    </div>
  );
}
