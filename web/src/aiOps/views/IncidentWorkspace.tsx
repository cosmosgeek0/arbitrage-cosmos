import React from 'react';
import { AlertOctagon, Ban, Braces, CheckCircle2, Clock3, FileWarning, GitBranch, LockKeyhole, Network, Wrench } from 'lucide-react';
import { GRow, Group } from '../../components/ui';
import { EvidenceCanvas, FactGrid, PostureTag, ProjectionNotice, SectionHeading, SourceLine, iconForPosture, toneForPosture } from '../components';
import type { AiOpsIncidentProjection, AiOpsSnapshot } from '../types';

function ForensicTrace({ incident }: { incident: AiOpsIncidentProjection }) {
  return (
    <div className="aiox-trace" aria-label="Bounded forensic trace">
      {incident.timeline.map((event, index) => (
        <details key={event.eventId} className={`aiox-trace-event tone-${toneForPosture(event.posture)}`} open={index === incident.timeline.length - 1}>
          <summary>
            <span className="aiox-trace-index num">{String(index + 1).padStart(2, '0')}</span>
            <span className="aiox-trace-line" aria-hidden="true" />
            <span className="aiox-trace-copy">
              <strong>{event.kind}</strong>
              <small>{event.at}</small>
            </span>
            <PostureTag posture={event.posture} />
          </summary>
          <div className="aiox-trace-detail">
            <p>{event.summary}</p>
            <dl>
              <div><dt>Event</dt><dd><code>{event.eventId}</code></dd></div>
              <div><dt>Correlation</dt><dd><code>{event.correlationId}</code></dd></div>
              <div><dt>Evidence</dt><dd>{event.evidenceIds.length ? event.evidenceIds.join(', ') : 'NONE'}</dd></div>
            </dl>
          </div>
        </details>
      ))}
    </div>
  );
}

export function IncidentWorkspace({ snapshot }: { snapshot: AiOpsSnapshot }) {
  const incident = snapshot.incidents.find((row) => row.caseId === snapshot.selectedCaseId) ?? snapshot.incidents[0];
  if (!incident) {
    return <ProjectionNotice tone="bad">No fixture incident is available. This does not mean the live system has zero incidents.</ProjectionNotice>;
  }

  return (
    <div className="aiox-view aiox-incident" data-testid="aiops-incident-workspace">
      <ProjectionNotice tone="warn">
        SYNTHETIC_ONLY case projection. <code>INCIDENT_OWNER_NOT_CONFIGURED</code>; nothing here creates, groups, suppresses, acknowledges, closes, archives, or durably stores an incident.
      </ProjectionNotice>

      <section className="aiox-case-hero" aria-labelledby="aiox-case-title">
        <div className="aiox-case-severity">
          <AlertOctagon size={20} aria-hidden="true" />
          <span>{incident.severity}</span>
        </div>
        <div className="aiox-case-copy">
          <div className="aiox-case-meta">
            <code>{incident.caseId}</code>
            <PostureTag posture={incident.posture} />
            <span>{incident.state}</span>
          </div>
          <h2 id="aiox-case-title">{incident.title}</h2>
          <p>{incident.summary}</p>
        </div>
      </section>

      <section className="aiox-section" aria-labelledby="aiox-evidence-title">
        <SectionHeading id="aiox-evidence-title" eyebrow="Evidence gate" title="Expected, observed, and bounded quality" />
        <EvidenceCanvas labelledBy="aiox-evidence-title">
          <div className="aiox-expected-observed">
            <article>
              <span>Expected</span>
              <p>{incident.expectedState}</p>
            </article>
            <article>
              <span>Observed</span>
              <p>{incident.observedState}</p>
            </article>
          </div>
          <div className="aiox-affected-graph" aria-label="Affected component dependency projection">
            <span>Affected dependency path</span>
            {incident.affectedComponentIds.map((componentId, index) => (
              <React.Fragment key={componentId}>
                {index > 0 ? <i aria-hidden="true">→</i> : null}
                <code>{componentId}</code>
              </React.Fragment>
            ))}
            <small>Fixture ordering only · canonical graph owner required</small>
          </div>
          <FactGrid facts={[incident.freshness, incident.coherence, incident.completeness]} compact />
        </EvidenceCanvas>
      </section>

      <div className="aiox-two-column aiox-incident-columns">
        <section className="aiox-section" aria-labelledby="aiox-hypotheses-title">
          <SectionHeading
            id="aiox-hypotheses-title"
            eyebrow="Reasoning projection"
            title="Hypotheses and unknowns"
            detail="Confidence is fixture metadata, never proof, permission, severity, or action authority."
          />
          <div className="aiox-hypotheses">
            {incident.hypotheses.map((hypothesis) => (
              <article key={hypothesis.hypothesisId}>
                <div className="aiox-hypothesis-head">
                  <code>{hypothesis.hypothesisId}</code>
                  <span className="num">{hypothesis.confidence === null ? 'UNCALIBRATED' : `${Math.round(hypothesis.confidence * 100)}% fixture`}</span>
                </div>
                <p>{hypothesis.statement}</p>
                <div className="aiox-evidence-chips">
                  {hypothesis.evidenceIds.map((evidenceId) => <code key={evidenceId}>{evidenceId}</code>)}
                </div>
                <ul>
                  {hypothesis.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>)}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="aiox-section" aria-labelledby="aiox-actionability-title">
          <SectionHeading
            id="aiox-actionability-title"
            eyebrow="Storm control"
            title="Suppression, inhibition, actionability"
            detail="Rendered fields only; no A4 evaluator or suppression store exists."
          />
          <div className="aiox-actionability">
            <dl>
              <div><dt>Fingerprint</dt><dd><code>{incident.suppression.fingerprint}</code></dd></div>
              <div><dt>Deduplicated</dt><dd className="num">{incident.suppression.deduplicatedCount}</dd></div>
              <div><dt>Inhibited by</dt><dd>{incident.suppression.inhibitedBy ?? 'NONE'}</dd></div>
              <div><dt>Actionable</dt><dd>{incident.suppression.actionable === null ? 'UNKNOWN' : incident.suppression.actionable ? 'YES' : 'NO'}</dd></div>
            </dl>
            <ProjectionNotice tone="warn">{incident.suppression.reason}</ProjectionNotice>
            <div className="aiox-atlas-matches">
              <span>Failure Atlas projections</span>
              {incident.failureAtlasMatches.map((match) => <code key={match}>{match}</code>)}
            </div>
          </div>
        </section>
      </div>

      <section className="aiox-section" aria-labelledby="aiox-forensic-title">
        <SectionHeading
          id="aiox-forensic-title"
          eyebrow="Level 5"
          title="Forensic correlation"
          detail="Expand each bounded event for evidence identity and trace lineage. Raw logs remain with the Logs owner."
          action={<code>fixture-correlation-a4-0001</code>}
        />
        <EvidenceCanvas labelledBy="aiox-forensic-title"><ForensicTrace incident={incident} /></EvidenceCanvas>
      </section>

      <div className="aiox-two-column aiox-incident-columns">
        <section className="aiox-section" aria-labelledby="aiox-validation-title">
          <SectionHeading id="aiox-validation-title" eyebrow="Diagnostic validation" title="Schema, freshness, independence" />
          <div className="aiox-group-scope">
            <Group title="Validation readback">
              {incident.validation.map((item) => (
                <GRow
                  key={item.id}
                  icon={iconForPosture(item.posture, 14)}
                  color={`var(--aiox-${toneForPosture(item.posture)})`}
                  label={item.label}
                  sub={<span className="aiox-row-sub"><span>{item.detail}</span><SourceLine source={item.source} /></span>}
                  control={<span className="aiox-readback-pair"><strong>{item.value ?? 'UNKNOWN'}</strong><PostureTag posture={item.posture} /></span>}
                />
              ))}
            </Group>
          </div>
        </section>

        <section className="aiox-section" aria-labelledby="aiox-policy-title">
          <SectionHeading id="aiox-policy-title" eyebrow="Policy boundary" title="Proposal and decision" />
          <div className="aiox-group-scope">
            <Group title="Non-authoritative projection">
              <GRow
                icon={<Wrench size={14} aria-hidden="true" />}
                color="var(--aiox-idle)"
                label={incident.proposal.label}
                sub={incident.proposal.detail}
                control={<PostureTag posture={incident.proposal.posture} />}
              />
              <GRow
                icon={<LockKeyhole size={14} aria-hidden="true" />}
                color="var(--aiox-bad)"
                label={incident.policyDecision.label}
                sub={incident.policyDecision.detail}
                control={<PostureTag posture={incident.policyDecision.posture} />}
              />
            </Group>
          </div>
        </section>
      </div>

      <section className="aiox-section" aria-labelledby="aiox-commands-title">
        <SectionHeading
          id="aiox-commands-title"
          eyebrow="Registry-backed command projection"
          title="Visible requests do not create authority"
          detail="Every action remains disabled until the canonical handler, schema, identity, budget, lease, receipt, and independent readback are mounted."
        />
        <EvidenceCanvas labelledBy="aiox-commands-title">
          <div className="aiox-command-grid">
            {incident.commands.map((command, index) => (
              <article key={command.commandId}>
                <div className="aiox-command-icon">
                  {index % 4 === 0 ? <Braces size={16} /> : index % 4 === 1 ? <Network size={16} /> : index % 4 === 2 ? <GitBranch size={16} /> : <FileWarning size={16} />}
                </div>
                <div>
                  <strong>{command.label}</strong>
                  <code>{command.commandId}</code>
                  <p>{command.expectedEffect}</p>
                </div>
                <button type="button" disabled aria-describedby={`reason-${command.commandId}`}>NOT_WIRED</button>
                <small id={`reason-${command.commandId}`}>{command.reason}</small>
              </article>
            ))}
          </div>
        </EvidenceCanvas>
      </section>

      <ProjectionNotice>
        <Ban size={14} aria-hidden="true" /> No command was executed. <Clock3 size={14} aria-hidden="true" /> No durable case timeline was written. <CheckCircle2 size={14} aria-hidden="true" /> Authority created: false.
      </ProjectionNotice>
    </div>
  );
}
