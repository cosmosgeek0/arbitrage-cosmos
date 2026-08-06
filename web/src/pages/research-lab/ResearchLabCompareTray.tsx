import { Columns2, X } from 'lucide-react';
import type { Ref } from 'react';
import type { ResearchLabExperiment } from '../../data/researchLab';
import './ResearchLabCompareTray.css';

export type ResearchLabCompareTraySelection =
  | readonly []
  | readonly [ResearchLabExperiment]
  | readonly [ResearchLabExperiment, ResearchLabExperiment];

export type ResearchLabCompareTrayProps = Readonly<{
  selection: ResearchLabCompareTraySelection;
  onOpen: () => void;
  onClear: () => void;
  onRemove: (family: string) => void;
  compareButtonRef?: Ref<HTMLButtonElement>;
  dialogId?: string;
}>;

export function ResearchLabCompareTray({
  selection,
  onOpen,
  onClear,
  onRemove,
  compareButtonRef,
  dialogId = 'research-lab-compare-dialog',
}: ResearchLabCompareTrayProps) {
  if (selection.length === 0) return null;

  const ready = selection.length === 2;
  return (
    <aside className="rlcmp-tray" aria-label="Research Family Comparison" data-count={selection.length}>
      <div className="rlcmp-tray-intro">
        <Columns2 size={19} aria-hidden="true" />
        <div>
          <strong>Compare</strong>
          <span role="status" aria-live="polite">
            {ready ? '2 Selected' : '1 Selected · Choose One More'}
          </span>
        </div>
      </div>

      <div className="rlcmp-tray-selection" aria-label="Selected Research Families">
        {selection.map((experiment, index) => (
          <div className="rlcmp-tray-family" key={experiment.family}>
            <span>Family {index + 1}</span>
            <code>{experiment.family}</code>
            <small>{experiment.verdict}</small>
            <button
              type="button"
              aria-label={`Remove ${experiment.family} From Comparison`}
              onClick={() => onRemove(experiment.family)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        ))}
        {!ready ? (
          <div className="rlcmp-tray-family rlcmp-tray-family-empty" aria-label="Second Family Not Selected">
            <span>Family 2</span>
            <strong>Not Selected</strong>
            <small>Choose Any Other Family</small>
          </div>
        ) : null}
      </div>

      <div className="rlcmp-tray-actions">
        <button type="button" className="rlcmp-tray-clear" onClick={onClear}>Clear</button>
        <button
          type="button"
          ref={compareButtonRef}
          className="rlcmp-tray-open"
          disabled={!ready}
          aria-haspopup="dialog"
          aria-controls={dialogId}
          onClick={onOpen}
        >
          Compare Families
        </button>
      </div>
    </aside>
  );
}

export default ResearchLabCompareTray;
