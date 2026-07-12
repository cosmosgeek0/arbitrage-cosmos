// BrainPanel — DASHBOARD_TRUTH item 5: the Q research brain surface.
// Snapshot schema v1 carries the intelligence summary and the two runtime
// components; EdgeBrainHealth model/dataset/drift versions are not published
// yet, so those rows are stated gaps, never invented values.

import type { SystemSupervisorSnapshot } from '../../../lib/systemIntegration';
import {
  UNKNOWN_TEXT,
  ageText,
  componentStateText,
  componentTone,
  countText,
  words,
} from '../lib/presentation';
import { Band, Chip, FactRow, NotPublished, TruthTag, Val } from './bits';

export function BrainPanel({ snapshot, nowMs }: { snapshot: SystemSupervisorSnapshot; nowMs: number }) {
  const intelligence = snapshot.summaries.intelligence;
  const runtime = snapshot.components.find((c) => c.componentId === 'intelligence-runtime');
  const foundation = snapshot.components.find((c) => c.componentId === 'market-intelligence');
  const assessments = snapshot.recentCorrelatedDecisions
    .filter((trace) => trace.componentId === 'intelligence-runtime' || trace.componentId === 'market-intelligence')
    .sort((a, b) => b.occurredAtMs - a.occurredAtMs)
    .slice(0, 4);

  return (
    <section className="sdx-section" aria-label="Q research brain">
      <Band
        title="Q Research Brain"
        meta={<>
          <span>Updated {ageText(intelligence.lastUpdateAtMs, nowMs)}</span>
          <TruthTag label={intelligence.truthLabel} />
        </>}
      />
      <div className="sdx-stats">
        <div className="sdx-stat"><span>Evidence</span><b className={intelligence.evidenceCount === null ? 'unk' : ''}>{countText(intelligence.evidenceCount)}</b></div>
        <div className="sdx-stat"><span>Attention</span><b className={intelligence.attentionCount === null ? 'unk' : ''}>{countText(intelligence.attentionCount)}</b></div>
        <div className="sdx-stat"><span>Focus Active</span><b className={intelligence.focusActiveCount === null ? 'unk' : ''}>{countText(intelligence.focusActiveCount)}</b></div>
        <div className="sdx-stat"><span>Theses</span><b className={intelligence.thesisCount === null ? 'unk' : ''}>{countText(intelligence.thesisCount)}</b></div>
        <div className="sdx-stat"><span>Abstained</span><b className={intelligence.insufficientEvidenceCount === null ? 'unk' : ''}>{countText(intelligence.insufficientEvidenceCount)}</b></div>
      </div>
      <div className="sdx-rows">
        {[{ label: 'Intelligence Runtime', component: runtime }, { label: 'Market Intelligence', component: foundation }].map(({ label, component }) => (
          component ? (
            <FactRow
              key={label}
              label={label}
              sub={`${component.desiredState} → ${component.domainObservedState ?? UNKNOWN_TEXT} · Phase ${component.phase}${component.blockerCodes.length ? ` · ${component.blockerCodes.join(' · ')}` : ''}`}
              end={<>
                <Chip tone={componentTone(component)}>{componentStateText(component)}</Chip>
                <TruthTag label={component.truthLabel} />
              </>}
            />
          ) : (
            <FactRow
              key={label}
              label={label}
              sub="Component absent from the snapshot — the brain is not integrated or not reporting."
              end={<><Val text={UNKNOWN_TEXT} /><span className="sdx-truth unknown">MISSING</span></>}
            />
          )
        ))}
        <FactRow
          label="Focus Requested"
          sub="Focus slots the brain asked for versus currently active"
          end={<Val text={`${countText(intelligence.focusRequestedCount)} → ${countText(intelligence.focusActiveCount)}`} />}
        />
        {assessments.length === 0 ? (
          <FactRow
            label="No advisory assessment in the recent trace window"
            sub="Actions (WATCH / FOCUS / PROPOSE_CONSIDERATION / ABSTAIN_UNKNOWN) appear here once the brain reports decisions."
            end={<Val text={UNKNOWN_TEXT} />}
          />
        ) : assessments.map((trace) => (
          <FactRow
            key={trace.eventId}
            label={`${words(trace.kind)}${trace.ownerId ? ` · ${trace.ownerId}` : ''}`}
            sub={`${ageText(trace.occurredAtMs, nowMs)} · ${trace.correlationId}${trace.referenceIds.length ? ` · ${trace.referenceIds.join(', ')}` : ''}`}
            end={<>
              {trace.failureCode && <span className="sdx-reason">{trace.failureCode}</span>}
              <TruthTag label={trace.truthLabel} />
            </>}
          />
        ))}
      </div>
      <NotPublished>EdgeBrainHealth model version, dataset version, and drift state — planned for the post-integration snapshot schema.</NotPublished>
    </section>
  );
}
