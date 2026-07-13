// AttentionQueuePanel — DASHBOARD_TRUTH item 8: everything requiring the
// operator, ranked with exposed capital first, each with its reason and the
// control that resolves it. Resolving controls come verbatim from the
// component's supportedControls — never invented.

import type {
  SystemControlMutation,
  SystemSupervisorSnapshot,
} from '../../../lib/systemIntegration';
import { rankAttention, severityTone, words } from '../lib/presentation';
import { Band, Chip } from './bits';

export function AttentionQueuePanel({
  snapshot,
  onControl,
  busy,
}: {
  snapshot: SystemSupervisorSnapshot;
  onControl: (mutation: SystemControlMutation, reason: string) => void;
  busy: boolean;
}) {
  const ranked = rankAttention(snapshot.attentionQueue);

  return (
    <section className="sdx-section" aria-label="Attention queue">
      <Band
        title="Attention Queue"
        meta={<span>{ranked.length} item{ranked.length === 1 ? '' : 's'} · exposed capital ranks first</span>}
      />
      {ranked.length === 0 ? (
        <div className="sdx-attn-empty">Nothing requires the operator. An empty queue is a statement, not an absence.</div>
      ) : ranked.map((entry, index) => {
        const component = snapshot.components.find((c) => c.componentId === entry.componentId);
        const restartable = component?.supportedControls.includes('RESTART_COMPONENT') ?? false;
        const cascaded = entry.rootComponentId !== entry.componentId;
        return (
          <div key={`${entry.componentId}-${index}`} className="sdx-attn">
            <div className="sdx-attn-row">
              <span className="sdx-row-main">
                <strong>
                  {words(entry.componentId)}
                  {entry.capitalExposed && <span className="sdx-tag exposed">CAPITAL EXPOSED</span>}
                  {cascaded && <span className="sdx-tag attention">CASCADE OF {words(entry.rootComponentId).toUpperCase()}</span>}
                </strong>
                <small>
                  {entry.recommendedOperatorAction ?? 'No recommended action published for this entry.'}
                </small>
              </span>
              <span className="sdx-row-end">
                {entry.reasonCodes.map((code) => <span key={code} className="sdx-reason">{code}</span>)}
                <Chip tone={severityTone(entry.severity)}>{entry.severity}</Chip>
                {restartable ? (
                  <button
                    type="button"
                    className="sdx-button"
                    disabled={busy}
                    onClick={() => onControl(
                      { command: 'RESTART_COMPONENT', componentId: entry.componentId },
                      `Attention queue: ${entry.reasonCodes.join(',') || entry.severity}`,
                    )}
                  >
                    Restart {words(entry.componentId)}
                  </button>
                ) : (
                  <span className="sdx-val unk">NO MAPPED CONTROL</span>
                )}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
