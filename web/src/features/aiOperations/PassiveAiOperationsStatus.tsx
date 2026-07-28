import {
  BrainCircuit,
  CircleSlash2,
  LockKeyhole,
  ShieldAlert,
} from 'lucide-react';
import type {
  AiOperationsActivityKind,
  AiOperationsPassiveStatusView,
} from './types';

const ACTIVITY_KINDS = Object.freeze([
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'FAILED',
] as const satisfies readonly AiOperationsActivityKind[]);

interface PassiveAiOperationsStatusProps {
  readonly projection: Readonly<AiOperationsPassiveStatusView>;
  readonly titleId?: string;
  readonly previewLabel?: 'LOCAL PREVIEW';
}

function stateTone(value: string): 'blocked' | 'unknown' {
  return value === 'UNKNOWN' ? 'unknown' : 'blocked';
}

function ActivityMetric({
  kind,
  projection,
}: {
  readonly kind: AiOperationsActivityKind;
  readonly projection: Readonly<AiOperationsPassiveStatusView>;
}) {
  const count = projection.caseCounts[kind];
  return (
    <div className="aiop-summary-cell">
      <dt>{kind[0]}{kind.slice(1).toLowerCase()}</dt>
      <dd className="aiop-summary-value unknown">{count === null ? 'UNKNOWN' : count}</dd>
      <dd className="aiop-summary-detail">No accepted operational case evidence</dd>
    </div>
  );
}

export function PassiveAiOperationsStatus({
  projection,
  titleId = 'ai-operations-title',
  previewLabel,
}: PassiveAiOperationsStatusProps) {
  const runtimeNotMounted = projection.mountState === 'NOT_MOUNTED';
  return (
    <section className="aiop-frame" aria-labelledby={titleId}>
      <header className="aiop-toolbar">
        <div className="aiop-toolbar-title">
          <span className="aiop-title-mark" aria-hidden="true">
            <BrainCircuit size={18} />
          </span>
          <h1 id={titleId}>AI Operations</h1>
          <span className="aiop-source-badge">SOURCE-BOUND · PASSIVE</span>
          {previewLabel && <span className="aiop-preview-badge">{previewLabel}</span>}
        </div>
        <dl className="aiop-toolbar-meta" aria-label="Projection Provenance">
          <div>
            <dt>Observed</dt>
            <dd><code>NOT_AVAILABLE</code></dd>
          </div>
          <div>
            <dt>Schema</dt>
            <dd><code>v1</code></dd>
          </div>
        </dl>
      </header>

      <div className="aiop-truth-banner">
        <ShieldAlert size={16} aria-hidden="true" />
        <div>
          <strong>
            {runtimeNotMounted
              ? 'Operational runtime evidence is not mounted.'
              : 'Operational runtime evidence is UNKNOWN.'}
          </strong>
          <span>Work-state counts are UNKNOWN, not zero. This surface does not claim that anything is resolving itself.</span>
        </div>
      </div>

      <dl className="aiop-summary" aria-label="AI Operations status summary">
        <div className="aiop-summary-cell">
          <dt>Configured</dt>
          <dd className={`aiop-summary-value ${stateTone(projection.configurationState)}`}>
            {projection.configurationState}
          </dd>
          <dd className="aiop-summary-detail">Worker identity and configuration contract</dd>
        </div>
        <div className="aiop-summary-cell">
          <dt>Mounted</dt>
          <dd className={`aiop-summary-value ${stateTone(projection.mountState)}`}>
            {projection.mountState}
          </dd>
          <dd className="aiop-summary-detail">Source contract mount state</dd>
        </div>
        {ACTIVITY_KINDS.map((kind) => (
          <ActivityMetric key={kind} kind={kind} projection={projection} />
        ))}
      </dl>

      <div className="aiop-content-grid">
        <section className="aiop-panel" aria-labelledby="aiop-evidence-title">
          <div className="aiop-band">
            <div>
              <CircleSlash2 size={14} aria-hidden="true" />
              <h2 id="aiop-evidence-title">Operational Evidence</h2>
            </div>
            <span>{runtimeNotMounted ? 'READBACK ABSENT' : 'READBACK UNKNOWN'}</span>
          </div>
          <div className="aiop-empty-evidence">
            <strong>No operational AI case evidence is accepted.</strong>
            <p>
              The existing runtime and AI Operations incident contracts are{' '}
              <code>{projection.runtimeContract.posture}</code>. They remain{' '}
              provenance only and cannot populate operational activity cards.
            </p>
            <dl>
              <div>
                <dt>Overall Activity</dt>
                <dd>{projection.activityState}</dd>
              </div>
              <div>
                <dt>Operational Runtime</dt>
                <dd>{projection.runtimeContract.operationalRuntimeEvidence}</dd>
              </div>
              <div>
                <dt>Shadow Incident Accepted</dt>
                <dd>{projection.runtimeContract.shadowIncidentAcceptedForOperationalStatus ? 'TRUE' : 'FALSE'}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="aiop-panel" aria-labelledby="aiop-authority-title">
          <div className="aiop-band">
            <div>
              <LockKeyhole size={14} aria-hidden="true" />
              <h2 id="aiop-authority-title">Authority Boundary</h2>
            </div>
            <span>NO MUTATION</span>
          </div>
          <dl className="aiop-authority-list">
            <div>
              <dt>Action Authority</dt>
              <dd>{projection.actionAuthority}</dd>
            </div>
            <div>
              <dt>Self-Healing Claim</dt>
              <dd>{projection.selfHealingClaim}</dd>
            </div>
            <div>
              <dt>Projection Provider Call</dt>
              <dd>{projection.providerCallPerformed ? 'TRUE' : 'FALSE'}</dd>
            </div>
            <div>
              <dt>Reliability Target State</dt>
              <dd>{projection.reliability.state}</dd>
            </div>
            <div>
              <dt>Reliability Authority</dt>
              <dd>{projection.reliability.authorityGranted ? 'GRANTED' : 'NONE'}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="aiop-blockers" aria-labelledby="aiop-blockers-title">
        <div className="aiop-band">
          <div>
            <ShieldAlert size={14} aria-hidden="true" />
            <h2 id="aiop-blockers-title">Blocker Truth</h2>
          </div>
          <span>{projection.blockers.length} SOURCE CONTRACTS</span>
        </div>
        {projection.blockers.length === 0 ? (
          <div className="aiop-blocker-empty">
            <strong>UNKNOWN</strong>
            <span>No blocker evidence was supplied.</span>
          </div>
        ) : (
          <ul className="aiop-blocker-list">
            {projection.blockers.map((blocker) => (
              <li key={blocker.code}>
                <span className="aiop-blocker-state">{blocker.state}</span>
                <div>
                  <code>{blocker.code}</code>
                  <p>{blocker.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
