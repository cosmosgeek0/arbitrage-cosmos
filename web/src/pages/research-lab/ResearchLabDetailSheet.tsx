import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { GitCompareArrows, X } from 'lucide-react';
import type {
  ResearchLabDetail,
  ResearchLabExperiment,
} from '../../data/researchLab';
import type { ResearchLabArtifact } from '../../data/researchLabArtifacts';
import type { ResearchLabStory } from '../../data/researchLabEvidence';
import { ResearchLabArtifactWorkbench } from './ResearchLabArtifactWorkbench';
import { ResearchLabNarrative } from './ResearchLabNarrative';
import type { ArtifactRequest } from './researchLabArtifactClient';
import './ResearchLabDetailSheet.css';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export type ResearchLabDetailArtifactRequest = ArtifactRequest;

export type ResearchLabDetailSheetProps = Readonly<{
  experiment: ResearchLabExperiment;
  detail: ResearchLabDetail;
  story: ResearchLabStory | null;
  artifacts: readonly ResearchLabArtifact[];
  requestedArtifact: ResearchLabDetailArtifactRequest | null;
  compareSelected: boolean;
  compareDisabled: boolean;
  compareStatus: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCompareToggle: () => void;
  onOpenArtifact: (family: string, path: string) => void;
}>;

function visibleFocusableElements(container: HTMLElement): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
}

export function ResearchLabDetailSheet({
  experiment,
  detail,
  story,
  artifacts,
  requestedArtifact,
  compareSelected,
  compareDisabled,
  compareStatus,
  returnFocusRef,
  onClose,
  onCompareToggle,
  onOpenArtifact,
}: ResearchLabDetailSheetProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const fallbackReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    fallbackReturnFocusRef.current = returnFocusRef.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const previousOverflow = document.documentElement.style.overflow;
    const appRoot = document.getElementById('root');
    const appRootWasInert = appRoot?.inert ?? false;
    document.documentElement.style.overflow = 'hidden';
    if (appRoot) appRoot.inert = true;

    const focusFrame = requestAnimationFrame(() => {
      titleRef.current?.focus({ preventScroll: true });
    });

    const keepFocusInside = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) {
        titleRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('focusin', keepFocusInside);

    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('focusin', keepFocusInside);
      document.documentElement.style.overflow = previousOverflow;
      if (appRoot) appRoot.inert = appRootWasInert;

      const requestedReturnTarget = returnFocusRef.current;
      const returnTarget = requestedReturnTarget?.isConnected
        && !requestedReturnTarget.matches(':disabled, [aria-disabled="true"]')
        ? requestedReturnTarget
        : fallbackReturnFocusRef.current;
      requestAnimationFrame(() => {
        if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
      });
    };
  }, [returnFocusRef]);

  useEffect(() => {
    if (!requestedArtifact) return undefined;

    const landingFrame = requestAnimationFrame(() => {
      workbenchRef.current?.scrollIntoView({ block: 'start' });
      workbenchRef.current
        ?.querySelector<HTMLElement>('.rlaw-workbench-head h3')
        ?.focus({ preventScroll: true });
    });

    return () => cancelAnimationFrame(landingFrame);
  }, [requestedArtifact]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = visibleFocusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      titleRef.current?.focus({ preventScroll: true });
      return;
    }

    const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
    if (activeIndex === -1) {
      event.preventDefault();
      (event.shiftKey ? focusable[focusable.length - 1] : focusable[0])
        .focus({ preventScroll: true });
      return;
    }

    if (event.shiftKey && activeIndex === 0) {
      event.preventDefault();
      focusable[focusable.length - 1].focus({ preventScroll: true });
    } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
      event.preventDefault();
      focusable[0].focus({ preventScroll: true });
    }
  };

  return createPortal(
    <div
      className="research-detail-sheet__backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <aside
        ref={dialogRef}
        className="research-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-verdict={detail.verdict}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="research-detail-sheet__header">
          <div className="research-detail-sheet__heading">
            <span className="research-detail-sheet__eyebrow">
              <i aria-hidden="true" />
              Read-Only Experiment Evidence
            </span>
            <h2 id={titleId} ref={titleRef} tabIndex={-1}>{detail.family}</h2>
            <div className="research-detail-sheet__headline-facts">
              <span className="research-detail-sheet__verdict">{detail.verdict}</span>
              <span>Frozen Index Truth</span>
            </div>
          </div>

          <div className="research-detail-sheet__header-actions">
            <button
              type="button"
              className="research-detail-sheet__compare"
              aria-pressed={compareSelected}
              aria-disabled={compareDisabled && !compareSelected}
              title={compareDisabled && !compareSelected ? compareStatus : undefined}
              onClick={() => {
                if (!compareDisabled || compareSelected) onCompareToggle();
              }}
            >
              <GitCompareArrows size={17} strokeWidth={1.7} aria-hidden="true" />
              <span>
                <strong>{compareSelected ? 'Selected' : 'Add To Compare'}</strong>
                <small aria-live="polite">{compareStatus}</small>
              </span>
            </button>
            <button
              type="button"
              className="research-detail-sheet__close"
              aria-label={`Close ${detail.family} Experiment Detail`}
              onClick={onClose}
            >
              <X size={19} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="research-detail-sheet__body" tabIndex={0}>
          <div className="research-detail-sheet__narrative">
            <ResearchLabNarrative
              experiment={experiment}
              story={story}
              artifacts={artifacts}
              onOpenManifestArtifact={(artifact) => onOpenArtifact(artifact.family, artifact.path)}
            />
          </div>

          <section className="research-detail-sheet__section" aria-labelledby={`${titleId}-audit`}>
            <header>
              <span>Evidence Review</span>
              <h3 id={`${titleId}-audit`}>Audit Record</h3>
            </header>
            <dl className="research-detail-sheet__rows">
              <div>
                <dt>Audit Class</dt>
                <dd>{detail.auditClass}</dd>
              </div>
              <div>
                <dt>Audit Commits</dt>
                <dd>{detail.auditCommits}</dd>
              </div>
            </dl>
          </section>

          <section className="research-detail-sheet__section" aria-labelledby={`${titleId}-custody`}>
            <header>
              <span>Frozen Provenance</span>
              <h3 id={`${titleId}-custody`}>Exact Custody</h3>
            </header>
            <dl className="research-detail-sheet__rows research-detail-sheet__rows--custody">
              <div>
                <dt>Source Branch</dt>
                <dd><code>{detail.sourceBranch}</code></dd>
              </div>
              <div>
                <dt>Recorded Tip</dt>
                <dd><code>{detail.recordedTip}</code></dd>
              </div>
              <div>
                <dt>Family File References</dt>
                <dd>{detail.fileCount}</dd>
              </div>
              <div>
                <dt>Artifact Access</dt>
                <dd>{detail.artifactAccess}</dd>
              </div>
            </dl>
          </section>

          <div ref={workbenchRef} className="research-detail-sheet__workbench">
            <ResearchLabArtifactWorkbench
              family={detail.family}
              artifacts={artifacts}
              requestedArtifact={requestedArtifact}
            />
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
