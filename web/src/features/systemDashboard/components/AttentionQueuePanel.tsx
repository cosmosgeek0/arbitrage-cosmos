// AttentionQueuePanel — DASHBOARD_TRUTH item 8: everything requiring the
// operator in canonical supervisor order, each with its reason and recommended
// action. A resolving control appears only when the caller supplies real
// mutation authority and the component publishes that control — never invented.

import type {
  SystemControlMutation,
  SystemSupervisorSnapshot,
} from '../../../lib/systemIntegration';
import { severityTone, words } from '../lib/presentation';
import { Band, Chip } from './bits';

export function AttentionQueuePanel({
  snapshot,
  onControl,
  busy,
}: {
  snapshot: SystemSupervisorSnapshot;
  onControl?: (mutation: SystemControlMutation, reason: string) => void;
  busy: boolean;
}) {
  const queue = snapshot.attentionQueue;

  return (
    <section className="sdx-section" aria-label="Attention queue">
      <Band
        title="Attention Queue"
        meta={<span>{queue.length} item{queue.length === 1 ? '' : 's'} · canonical supervisor order</span>}
      />
      {queue.length === 0 ? (
        <div className="sdx-attn-empty">Nothing requires the operator. An empty queue is a statement, not an absence.</div>
      ) : queue.map((entry, index) => {
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
                {restartable && onControl ? (
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
                ) : !restartable ? (
                  <span className="sdx-val unk">NO MAPPED CONTROL</span>
                ) : null}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
