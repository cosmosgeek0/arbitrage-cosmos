import React, { type ReactNode } from 'react';
import { AlertTriangle, CircleHelp, CircleX, ShieldCheck } from 'lucide-react';
import { StatePill } from '../components/ui';
import type { AiOpsFact, AiOpsPosture, AiOpsTone, AiOpsTrendSeries, ControlValue, ProjectedSource } from './types';

export function toneForPosture(posture: AiOpsPosture): AiOpsTone {
  if (posture === 'OK') return 'ok';
  if (posture === 'DEGRADED' || posture === 'STALE') return 'warn';
  if (posture === 'BLOCKED' || posture === 'MISSING' || posture === 'SILENT') return 'bad';
  return 'idle';
}

export function iconForPosture(posture: AiOpsPosture, size = 14) {
  const tone = toneForPosture(posture);
  if (tone === 'ok') return <ShieldCheck size={size} aria-hidden="true" />;
  if (tone === 'warn') return <AlertTriangle size={size} aria-hidden="true" />;
  if (tone === 'bad') return <CircleX size={size} aria-hidden="true" />;
  return <CircleHelp size={size} aria-hidden="true" />;
}

export function PostureTag({ posture }: { posture: AiOpsPosture }) {
  return <StatePill tone={toneForPosture(posture)}>{posture === 'READY' ? 'OWNER_REPORTED' : posture}</StatePill>;
}

export function SourceLine({ source }: { source: ProjectedSource }) {
  return (
    <span className="aiox-source">
      <span>{source.owner}</span>
      <span aria-hidden="true">·</span>
      <span>{source.sourceId}</span>
      <span aria-hidden="true">·</span>
      <span>{source.wiring}</span>
    </span>
  );
}

export function displayValue(value: ControlValue | undefined): string {
  if (value === null || value === undefined) return 'UNKNOWN';
  if (Array.isArray(value)) return value.length === 0 ? 'NONE' : value.join(', ');
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
  return String(value);
}

export function FactGrid({ facts, compact = false }: { facts: readonly AiOpsFact[]; compact?: boolean }) {
  return (
    <div className={`aiox-fact-grid ${compact ? 'compact' : ''}`}>
      {facts.map((item) => (
        <article className={`aiox-fact tone-${toneForPosture(item.posture)}`} key={item.id}>
          <div className="aiox-fact-head">
            <span>{item.label}</span>
            <PostureTag posture={item.posture} />
          </div>
          <strong className="num">
            {item.value === null ? 'UNKNOWN' : item.value}
            {item.unit ? <small>{item.unit}</small> : null}
          </strong>
          <p>{item.detail}</p>
          <SourceLine source={item.source} />
        </article>
      ))}
    </div>
  );
}

function pointSegmentsFor(samples: AiOpsTrendSeries['samples']): readonly string[] {
  const values = samples.map((sample) => sample.value).filter((value): value is number => value !== null);
  if (values.length < 2) return [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const segments: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length > 1) segments.push(current.join(' '));
    current = [];
  };

  samples.forEach((sample, index) => {
    if (sample.value === null) {
      flush();
      return;
    }

    const x = (index / Math.max(samples.length - 1, 1)) * 100;
    const y = 30 - ((sample.value - minimum) / span) * 24;
    current.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  });
  flush();

  return segments;
}

export function TrendCard({ series }: { series: AiOpsTrendSeries }) {
  const knownSamples = series.samples.filter((sample): sample is typeof sample & { value: number } => sample.value !== null);
  const latest = knownSamples.at(-1)?.value ?? null;
  const pointSegments = pointSegmentsFor(series.samples);
  const minimum = knownSamples.length ? Math.min(...knownSamples.map((sample) => sample.value)) : null;
  const maximum = knownSamples.length ? Math.max(...knownSamples.map((sample) => sample.value)) : null;
  const first = knownSamples[0];
  const last = knownSamples.at(-1);
  const trajectory = !first || !last || knownSamples.length < 2
    ? 'unknown trajectory'
    : last.value > first.value
      ? 'rising trajectory'
      : last.value < first.value
        ? 'falling trajectory'
        : 'flat trajectory';
  const range = minimum === null || maximum === null ? 'range unknown' : `range ${minimum} to ${maximum} ${series.unit}`;
  const span = first && last ? `from ${first.at} to ${last.at}` : 'time span unknown';
  const trendDescription = `${series.label} fixture trend; ${knownSamples.length} of ${series.samples.length} samples known; ${trajectory}; ${range}; ${span}; latest ${latest === null ? 'unknown' : `${latest} ${series.unit}`}; missing samples render as gaps.`;
  return (
    <article className={`aiox-trend tone-${toneForPosture(series.posture)}`}>
      <div className="aiox-trend-copy">
        <span>{series.label}</span>
        <strong className="num">{latest === null ? 'UNKNOWN' : `${latest} ${series.unit}`}</strong>
      </div>
      <svg viewBox="0 0 100 32" role="img" aria-label={trendDescription} preserveAspectRatio="none">
        <line x1="0" x2="100" y1="30" y2="30" />
        {pointSegments.map((points, index) => <polyline key={`${series.seriesId}-${index}`} points={points} />)}
      </svg>
      <PostureTag posture={series.posture} />
    </article>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  detail,
  action,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <header className="aiox-section-head">
      <div>
        {eyebrow ? <span className="aiox-eyebrow">{eyebrow}</span> : null}
        <h2 id={id}>{title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
      {action ? <div className="aiox-section-action">{action}</div> : null}
    </header>
  );
}

export function EvidenceCanvas({
  labelledBy,
  children,
  className = '',
}: {
  labelledBy: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`aiox-evidence-scroll ${className}`.trim()}
      role="group"
      aria-labelledby={labelledBy}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

export function ProjectionNotice({ children, tone = 'idle' }: { children: ReactNode; tone?: AiOpsTone }) {
  return (
    <div className={`aiox-projection-notice tone-${tone}`} role="note">
      {tone === 'bad' ? <CircleX size={15} aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}
      <span>{children}</span>
    </div>
  );
}
