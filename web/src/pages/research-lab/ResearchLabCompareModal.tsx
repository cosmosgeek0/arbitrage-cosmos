import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { FileText, X } from 'lucide-react';
import {
  RESEARCH_LAB_DATASET_PROVENANCE,
  projectResearchLabDetail,
  type ResearchLabExperiment,
} from '../../data/researchLab';
import {
  RESEARCH_LAB_ARTIFACT_PROVENANCE,
  researchLabArtifactsForFamily,
  type ResearchLabArtifact,
} from '../../data/researchLabArtifacts';
import {
  isResearchLabRecord,
  readableResearchLabBytes,
  researchLabGateComparisonIdentity,
  researchLabGateRows,
  researchLabParameterRows,
  type ResearchLabGateRow,
  type ResearchLabKeyValue,
} from '../../data/researchLabEvidence';
import { artifactRoleLabel, loadResearchArtifact } from './researchLabArtifactClient';
import './ResearchLabCompareModal.css';

export type ResearchLabComparePair = readonly [ResearchLabExperiment, ResearchLabExperiment];

export type ResearchLabCompareCloseReason =
  | 'BACKDROP'
  | 'CLEAR'
  | 'CLOSE'
  | 'ESCAPE'
  | 'OPEN_ARTIFACT'
  | 'REMOVE';

export type ResearchLabCompareSourceStatus = 'INVALID' | 'NONE_RECORDED' | 'PARTIAL' | 'READY';

export type ResearchLabCompareGateRow = ResearchLabGateRow & Readonly<{
  sourceName: string;
  sourcePath: string;
}>;

export type ResearchLabCompareFamilyEvidence = Readonly<{
  experiment: ResearchLabExperiment;
  artifacts: readonly ResearchLabArtifact[];
  protocolArtifact: ResearchLabArtifact | null;
  protocolStatus: ResearchLabCompareSourceStatus;
  protocolError: string | null;
  parameters: readonly ResearchLabKeyValue[];
  outcomeArtifacts: readonly ResearchLabArtifact[];
  outcomeStatus: ResearchLabCompareSourceStatus;
  outcomeError: string | null;
  gates: readonly ResearchLabCompareGateRow[];
}>;

export type ResearchLabCompareEvidenceLoader = (
  experiment: ResearchLabExperiment,
  signal: AbortSignal,
) => Promise<ResearchLabCompareFamilyEvidence>;

export type ResearchLabCompareModalProps = Readonly<{
  experiments: ResearchLabComparePair;
  onRequestClose: (reason: ResearchLabCompareCloseReason) => void;
  onRestoreFocus?: (reason: ResearchLabCompareCloseReason) => void;
  onClear: () => void;
  onRemove: (family: string) => void;
  onOpenArtifact: (family: string, path: string) => void;
  loadFamilyEvidence?: ResearchLabCompareEvidenceLoader;
  dialogId?: string;
}>;

type LoadedSource<T> = Readonly<{
  artifact: ResearchLabArtifact | null;
  status: ResearchLabCompareSourceStatus;
  error: string | null;
  rows: readonly T[];
}>;

type LoadedOutcomeSources = Readonly<{
  artifacts: readonly ResearchLabArtifact[];
  status: ResearchLabCompareSourceStatus;
  error: string | null;
  rows: readonly ResearchLabCompareGateRow[];
}>;

type EvidenceState =
  | Readonly<{ status: 'LOADING'; families: null; error: null }>
  | Readonly<{ status: 'READY'; families: readonly [ResearchLabCompareFamilyEvidence, ResearchLabCompareFamilyEvidence]; error: null }>
  | Readonly<{ status: 'INVALID'; families: null; error: string }>;

type AlignedRow<T> = Readonly<{
  id: string;
  path: string;
  occurrence: number;
  repeated: boolean;
  left: T | null;
  right: T | null;
}>;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'RESEARCH_LAB_COMPARE_EVIDENCE_INVALID';
}

function protocolArtifactFor(artifacts: readonly ResearchLabArtifact[]): ResearchLabArtifact | null {
  return artifacts.find((artifact) => artifact.role === 'PROTOCOL') ?? null;
}

function outcomeArtifactsFor(artifacts: readonly ResearchLabArtifact[]): readonly ResearchLabArtifact[] {
  return Object.freeze(artifacts.filter(
    (artifact) => artifact.role === 'RESULT' || artifact.role === 'DEVELOPMENT',
  ));
}

async function loadSource<T>(
  artifact: ResearchLabArtifact | null,
  signal: AbortSignal,
  project: (payload: Readonly<Record<string, unknown>>) => readonly T[],
): Promise<LoadedSource<T>> {
  if (artifact === null) {
    return Object.freeze({ artifact: null, status: 'NONE_RECORDED', error: null, rows: Object.freeze([]) });
  }

  try {
    const loaded = await loadResearchArtifact(artifact, signal);
    if (!isResearchLabRecord(loaded.payload)) {
      throw new TypeError('RESEARCH_LAB_COMPARE_ARTIFACT_JSON_ROOT_INVALID');
    }
    return Object.freeze({
      artifact,
      status: 'READY',
      error: null,
      rows: Object.freeze([...project(loaded.payload)]),
    });
  } catch (error: unknown) {
    if (signal.aborted) throw error;
    return Object.freeze({
      artifact,
      status: 'INVALID',
      error: errorMessage(error),
      rows: Object.freeze([]),
    });
  }
}

async function loadOutcomeSources(
  artifacts: readonly ResearchLabArtifact[],
  signal: AbortSignal,
): Promise<LoadedOutcomeSources> {
  if (artifacts.length === 0) {
    return Object.freeze({
      artifacts,
      status: 'NONE_RECORDED',
      error: null,
      rows: Object.freeze([]),
    });
  }

  const loaded = await Promise.all(artifacts.map(async (artifact) => {
    try {
      const result = await loadResearchArtifact(artifact, signal);
      if (!isResearchLabRecord(result.payload)) {
        throw new TypeError('RESEARCH_LAB_COMPARE_ARTIFACT_JSON_ROOT_INVALID');
      }
      return Object.freeze({
        artifact,
        error: null,
        rows: Object.freeze(researchLabGateRows(result.payload).map((row) => Object.freeze({
          ...row,
          sourceName: artifact.name,
          sourcePath: artifact.path,
        }))),
      });
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      return Object.freeze({
        artifact,
        error: errorMessage(error),
        rows: Object.freeze([]) as readonly ResearchLabCompareGateRow[],
      });
    }
  }));

  const invalid = loaded.filter((source) => source.error !== null);
  const rows = Object.freeze(loaded.flatMap((source) => source.rows));
  return Object.freeze({
    artifacts,
    status: invalid.length === 0 ? 'READY' : invalid.length === loaded.length ? 'INVALID' : 'PARTIAL',
    error: invalid.length === 0
      ? null
      : invalid.map((source) => `${source.artifact.name}: ${source.error}`).join(' · '),
    rows,
  });
}

export const loadResearchLabCompareFamilyEvidence: ResearchLabCompareEvidenceLoader = async (
  experiment,
  signal,
) => {
  const artifacts = researchLabArtifactsForFamily(experiment.family);
  const protocolArtifact = protocolArtifactFor(artifacts);
  const outcomeArtifacts = outcomeArtifactsFor(artifacts);
  const [protocol, outcome] = await Promise.all([
    loadSource(protocolArtifact, signal, researchLabParameterRows),
    loadOutcomeSources(outcomeArtifacts, signal),
  ]);

  return Object.freeze({
    experiment,
    artifacts,
    protocolArtifact,
    protocolStatus: protocol.status,
    protocolError: protocol.error,
    parameters: protocol.rows,
    outcomeArtifacts,
    outcomeStatus: outcome.status,
    outcomeError: outcome.error,
    gates: outcome.rows,
  });
};

function groupByStablePath<T>(rows: readonly T[], pathOf: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const path = pathOf(row);
    const current = grouped.get(path);
    if (current) current.push(row);
    else grouped.set(path, [row]);
  }
  return grouped;
}

export function alignResearchLabRowsByPathOccurrence<T>(
  leftRows: readonly T[],
  rightRows: readonly T[],
  pathOf: (row: T) => string,
): readonly AlignedRow<T>[] {
  const left = groupByStablePath(leftRows, pathOf);
  const right = groupByStablePath(rightRows, pathOf);
  const orderedPaths: string[] = [];
  const seen = new Set<string>();

  for (const row of [...leftRows, ...rightRows]) {
    const path = pathOf(row);
    if (!seen.has(path)) {
      seen.add(path);
      orderedPaths.push(path);
    }
  }

  const aligned: AlignedRow<T>[] = [];
  for (const path of orderedPaths) {
    const leftAtPath = left.get(path) ?? [];
    const rightAtPath = right.get(path) ?? [];
    const occurrenceCount = Math.max(leftAtPath.length, rightAtPath.length);
    for (let index = 0; index < occurrenceCount; index += 1) {
      aligned.push(Object.freeze({
        id: `${path}\u0000${index + 1}`,
        path,
        occurrence: index + 1,
        repeated: occurrenceCount > 1,
        left: leftAtPath[index] ?? null,
        right: rightAtPath[index] ?? null,
      }));
    }
  }
  return Object.freeze(aligned);
}

function sourceStatusText(status: ResearchLabCompareSourceStatus | 'CHECKING'): string {
  if (status === 'READY') return 'Byte-Checked';
  if (status === 'PARTIAL') return 'Partially Available';
  if (status === 'INVALID') return 'Invalid';
  if (status === 'NONE_RECORDED') return 'None Recorded';
  return 'Checking';
}

function SourceCell({
  family,
  artifacts,
  status,
  error,
}: {
  family: string;
  artifacts: readonly ResearchLabArtifact[];
  status: ResearchLabCompareSourceStatus | 'CHECKING';
  error: string | null;
}) {
  return (
    <div className="rlcmp-source-cell" data-status={status}>
      <strong>{family}</strong>
      <span>{artifacts.length === 0
        ? 'No Source Artifact Recorded'
        : artifacts.length === 1
          ? artifacts[0].name
          : `${artifacts.length} Preserved Source Artifacts`}</span>
      {artifacts.length > 0 ? (
        <code>{artifacts.map((artifact) => `${artifact.path} · ${artifact.sha256.slice(0, 12)}`).join(' · ')}</code>
      ) : null}
      <small>{sourceStatusText(status)}{error ? ` · ${error}` : ''}</small>
    </div>
  );
}

function SourceStrip({
  label,
  leftFamily,
  rightFamily,
  leftArtifacts,
  rightArtifacts,
  leftStatus,
  rightStatus,
  leftError = null,
  rightError = null,
}: {
  label: string;
  leftFamily: string;
  rightFamily: string;
  leftArtifacts: readonly ResearchLabArtifact[];
  rightArtifacts: readonly ResearchLabArtifact[];
  leftStatus: ResearchLabCompareSourceStatus | 'CHECKING';
  rightStatus: ResearchLabCompareSourceStatus | 'CHECKING';
  leftError?: string | null;
  rightError?: string | null;
}) {
  return (
    <div className="rlcmp-source-strip" aria-label={`${label} Sources`}>
      <div className="rlcmp-source-label"><span>Source</span><strong>{label}</strong></div>
      <SourceCell family={leftFamily} artifacts={leftArtifacts} status={leftStatus} error={leftError} />
      <SourceCell family={rightFamily} artifacts={rightArtifacts} status={rightStatus} error={rightError} />
    </div>
  );
}

function NotComparable() {
  return <span className="rlcmp-not-comparable">NOT_COMPARABLE</span>;
}

function valueClass(label: string): string {
  return /Branch|Tip|Custody|Protocol/iu.test(label) ? 'rlcmp-value rlcmp-value-code' : 'rlcmp-value';
}

function verdictTone(value: string): string {
  if (value === 'NO_GO') return 'terracotta';
  if (value === 'UNMEASURED') return 'uncertain';
  return 'recorded';
}

function GateCell({ row }: { row: ResearchLabGateRow | null }) {
  if (row === null) return <NotComparable />;
  const failed = /FAIL|FALSE|NO_GO|REJECT/iu.test(row.status);
  return (
    <div className="rlcmp-gate-cell">
      <div><strong data-tone={failed ? 'terracotta' : 'recorded'}>{row.status}</strong><code>{row.code}</code></div>
      <small>Observed {row.observed} · Threshold {row.threshold}</small>
      <span>{row.reason}</span>
    </div>
  );
}

function ParameterCell({ row }: { row: ResearchLabKeyValue | null }) {
  if (row === null) return <NotComparable />;
  return <span className="rlcmp-parameter-value">{row.value}</span>;
}

function closeButtonLabel(reason: ResearchLabCompareCloseReason): string {
  if (reason === 'ESCAPE') return 'Close Comparison With Escape';
  if (reason === 'BACKDROP') return 'Close Comparison From Backdrop';
  return 'Close Comparison';
}

export function ResearchLabCompareModal({
  experiments,
  onRequestClose,
  onRestoreFocus,
  onClear,
  onRemove,
  onOpenArtifact,
  loadFamilyEvidence = loadResearchLabCompareFamilyEvidence,
  dialogId = 'research-lab-compare-dialog',
}: ResearchLabCompareModalProps) {
  const [leftExperiment, rightExperiment] = experiments;
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [evidenceState, setEvidenceState] = useState<EvidenceState>({
    status: 'LOADING',
    families: null,
    error: null,
  });

  const leftArtifacts = useMemo(
    () => researchLabArtifactsForFamily(leftExperiment.family),
    [leftExperiment.family],
  );
  const rightArtifacts = useMemo(
    () => researchLabArtifactsForFamily(rightExperiment.family),
    [rightExperiment.family],
  );
  const leftProtocolArtifact = protocolArtifactFor(leftArtifacts);
  const rightProtocolArtifact = protocolArtifactFor(rightArtifacts);
  const leftOutcomeArtifacts = outcomeArtifactsFor(leftArtifacts);
  const rightOutcomeArtifacts = outcomeArtifactsFor(rightArtifacts);

  useEffect(() => {
    const controller = new AbortController();
    setEvidenceState({ status: 'LOADING', families: null, error: null });
    void Promise.all([
      loadFamilyEvidence(leftExperiment, controller.signal),
      loadFamilyEvidence(rightExperiment, controller.signal),
    ])
      .then(([left, right]) => {
        if (!controller.signal.aborted) {
          setEvidenceState({
            status: 'READY',
            families: Object.freeze([left, right]),
            error: null,
          });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setEvidenceState({ status: 'INVALID', families: null, error: errorMessage(error) });
        }
      });
    return () => controller.abort();
  }, [leftExperiment, rightExperiment, loadFamilyEvidence]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingRight = body.style.paddingRight;
    const appRoot = document.getElementById('root');
    const appRootWasInert = appRoot?.inert ?? false;
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    const focusFrame = window.requestAnimationFrame(() => headingRef.current?.focus());

    const keepFocusInside = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) {
        headingRef.current?.focus({ preventScroll: true });
      }
    };

    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    if (appRoot) appRoot.inert = true;
    document.addEventListener('focusin', keepFocusInside);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('focusin', keepFocusInside);
      root.style.overflow = previousRootOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
      if (appRoot) appRoot.inert = appRootWasInert;
    };
  }, []);

  const requestClose = useCallback((reason: ResearchLabCompareCloseReason) => {
    onRequestClose(reason);
    window.requestAnimationFrame(() => onRestoreFocus?.(reason));
  }, [onRequestClose, onRestoreFocus]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      requestClose('ESCAPE');
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      .filter((element) => element.getClientRects().length > 0
        && element.getAttribute('aria-hidden') !== 'true');
    if (focusable.length === 0) {
      event.preventDefault();
      headingRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const activeIsTabbable = active instanceof HTMLElement && focusable.includes(active);
    if (!activeIsTabbable) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, [requestClose]);

  const handleBackdrop = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    requestClose('BACKDROP');
  };

  const details = [
    projectResearchLabDetail(leftExperiment),
    projectResearchLabDetail(rightExperiment),
  ] as const;
  const frozenRows = [
    ['Verdict', details[0].verdict, details[1].verdict],
    ['Recorded Reason', details[0].reason, details[1].reason],
    ['Hypothesis', details[0].hypothesis, details[1].hypothesis],
    ['Capital Record', details[0].capital, details[1].capital],
    ['Protocol ID', details[0].protocolId, details[1].protocolId],
    ['Audit Class', details[0].auditClass, details[1].auditClass],
    ['Audit Commits', details[0].auditCommits, details[1].auditCommits],
    ['Source Branch', details[0].sourceBranch, details[1].sourceBranch],
    ['Recorded Tip', details[0].recordedTip, details[1].recordedTip],
    ['Family Files', details[0].fileCount, details[1].fileCount],
    ['Exact Custody', details[0].custody, details[1].custody],
  ] as const;

  const loadedFamilies = evidenceState.status === 'READY'
    && evidenceState.families[0].experiment.family === leftExperiment.family
    && evidenceState.families[1].experiment.family === rightExperiment.family
    ? evidenceState.families
    : null;
  const parameterRows = alignResearchLabRowsByPathOccurrence(
    loadedFamilies?.[0].parameters ?? [],
    loadedFamilies?.[1].parameters ?? [],
    (row) => row.key,
  );
  const gateRows = alignResearchLabRowsByPathOccurrence(
    loadedFamilies?.[0].gates ?? [],
    loadedFamilies?.[1].gates ?? [],
    (row) => `${row.sourceName}\u0000${researchLabGateComparisonIdentity(row)}`,
  );
  const sourceStatus = evidenceState.status === 'INVALID' ? 'INVALID' : 'CHECKING';

  const removeFamily = (family: string) => {
    onRemove(family);
    requestClose('REMOVE');
  };
  const clearSelection = () => {
    onClear();
    requestClose('CLEAR');
  };
  const openArtifact = (family: string, path: string) => {
    onOpenArtifact(family, path);
    requestClose('OPEN_ARTIFACT');
  };

  const modal = (
    <div
      className="rlcmp-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onClick={handleBackdrop}
      role="presentation"
    >
      <div
        id={dialogId}
        ref={dialogRef}
        className="rlcmp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <header className="rlcmp-header">
          <div>
            <span>Read-Only · Exactly Two Families</span>
            <h2 id={titleId} ref={headingRef} tabIndex={-1}>Research Evidence Comparison</h2>
            <p>{leftExperiment.family} Compared With {rightExperiment.family}</p>
          </div>
          <button
            type="button"
            className="rlcmp-icon-button"
            aria-label={closeButtonLabel('CLOSE')}
            onClick={() => requestClose('CLOSE')}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <div className="rlcmp-body">
          <section className="rlcmp-family-band" aria-label="Compared Families">
            <div className="rlcmp-family-band-label"><span>Selected Pair</span><strong>Frozen Family Identity</strong></div>
            {[leftExperiment, rightExperiment].map((experiment, index) => (
              <div className="rlcmp-family-identity" key={experiment.family}>
                <div><span>Family {index + 1}</span><strong>{experiment.family}</strong></div>
                <button type="button" onClick={() => removeFamily(experiment.family)}>
                  <X size={15} aria-hidden="true" /> Remove
                </button>
                <code>{experiment.branch} @ {experiment.tip.slice(0, 12)}</code>
              </div>
            ))}
          </section>

          <section className="rlcmp-section" aria-labelledby={`${titleId}-index`}>
            <div className="rlcmp-section-title">
              <div><span>Immediate Truth</span><h3 id={`${titleId}-index`}>Frozen Index</h3></div>
              <code>{RESEARCH_LAB_DATASET_PROVENANCE.versionedPath} · SHA-256 {RESEARCH_LAB_DATASET_PROVENANCE.sourceSha256.slice(0, 12)}</code>
            </div>
            <div className="rlcmp-source-strip" aria-label="Frozen Research Index Sources">
              <div className="rlcmp-source-label"><span>Source</span><strong>Frozen Research Index</strong></div>
              {[leftExperiment, rightExperiment].map((experiment) => (
                <div className="rlcmp-source-cell" data-status="READY" key={experiment.family}>
                  <strong>{experiment.family}</strong>
                  <span>Frozen Index Row</span>
                  <code>{RESEARCH_LAB_DATASET_PROVENANCE.versionedPath} · SHA-256 {RESEARCH_LAB_DATASET_PROVENANCE.sourceSha256.slice(0, 12)}</code>
                  <small>Schema-Checked</small>
                </div>
              ))}
            </div>
            <div className="rlcmp-row-list">
              {frozenRows.map(([label, left, right]) => (
                <div className="rlcmp-row" key={label}>
                  <div className="rlcmp-field"><span>{label}</span></div>
                  <div className={valueClass(label)} aria-label={`${leftExperiment.family} · ${label}`}>
                    {label === 'Verdict' ? <strong data-tone={verdictTone(left)}>{left}</strong> : left}
                  </div>
                  <div className={valueClass(label)} aria-label={`${rightExperiment.family} · ${label}`}>
                    {label === 'Verdict' ? <strong data-tone={verdictTone(right)}>{right}</strong> : right}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {evidenceState.status === 'INVALID' ? (
            <div className="rlcmp-load-state" role="alert">
              Preserved Comparison Evidence Invalid: {evidenceState.error}. Frozen index truth remains available above.
            </div>
          ) : null}

          <section className="rlcmp-section" aria-labelledby={`${titleId}-parameters`}>
            <div className="rlcmp-section-title">
              <div><span>Path + Occurrence Alignment</span><h3 id={`${titleId}-parameters`}>Protocol Parameters</h3></div>
              <small>Repeated paths remain separate. Missing counterparts are NOT_COMPARABLE.</small>
            </div>
            <SourceStrip
              label="Preserved Protocol Artifact"
              leftFamily={leftExperiment.family}
              rightFamily={rightExperiment.family}
              leftArtifacts={leftProtocolArtifact ? [leftProtocolArtifact] : []}
              rightArtifacts={rightProtocolArtifact ? [rightProtocolArtifact] : []}
              leftStatus={loadedFamilies?.[0].protocolStatus ?? sourceStatus}
              rightStatus={loadedFamilies?.[1].protocolStatus ?? sourceStatus}
              leftError={loadedFamilies?.[0].protocolError}
              rightError={loadedFamilies?.[1].protocolError}
            />
            {parameterRows.length > 0 ? (
              <div className="rlcmp-row-list">
                {parameterRows.map((row) => (
                  <div className="rlcmp-row" key={row.id}>
                    <div className="rlcmp-field">
                      <code>{row.path}</code>
                      {row.repeated ? <small>Occurrence {row.occurrence}</small> : null}
                    </div>
                    <div className="rlcmp-value" aria-label={`${leftExperiment.family} · Parameter ${row.path}`}>
                      <ParameterCell row={row.left} />
                    </div>
                    <div className="rlcmp-value" aria-label={`${rightExperiment.family} · Parameter ${row.path}`}>
                      <ParameterCell row={row.right} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rlcmp-empty" role={evidenceState.status === 'LOADING' ? 'status' : undefined}>
                {evidenceState.status === 'LOADING'
                  ? 'Checking Both Preserved Protocol Artifacts…'
                  : 'Protocol Parameters: NONE_RECORDED For This Pair.'}
              </div>
            )}
          </section>

          <section className="rlcmp-section" aria-labelledby={`${titleId}-gates`}>
            <div className="rlcmp-section-title">
              <div><span>Source + Code Identity Alignment</span><h3 id={`${titleId}-gates`}>Extracted Gate And Verdict Evidence</h3></div>
              <small>Array gates align by recorded code identity. Unmatched codes stay NOT_COMPARABLE.</small>
            </div>
            <SourceStrip
              label="Preserved Outcome Artifacts"
              leftFamily={leftExperiment.family}
              rightFamily={rightExperiment.family}
              leftArtifacts={leftOutcomeArtifacts}
              rightArtifacts={rightOutcomeArtifacts}
              leftStatus={loadedFamilies?.[0].outcomeStatus ?? sourceStatus}
              rightStatus={loadedFamilies?.[1].outcomeStatus ?? sourceStatus}
              leftError={loadedFamilies?.[0].outcomeError}
              rightError={loadedFamilies?.[1].outcomeError}
            />
            {gateRows.length > 0 ? (
              <div className="rlcmp-row-list">
                {gateRows.map((row) => {
                  const gatePath = row.left?.path ?? row.right?.path ?? row.path;
                  const gateCode = row.left?.code ?? row.right?.code ?? 'UNKNOWN';
                  return (
                    <div className="rlcmp-row rlcmp-gate-row" key={row.id}>
                      <div className="rlcmp-field">
                        <code>{gatePath}</code>
                        <small>{row.left?.sourceName ?? row.right?.sourceName}</small>
                        {row.repeated ? <small>Occurrence {row.occurrence}</small> : null}
                      </div>
                      <div className="rlcmp-value" aria-label={`${leftExperiment.family} · Gate ${gateCode}`}>
                        <GateCell row={row.left} />
                      </div>
                      <div className="rlcmp-value" aria-label={`${rightExperiment.family} · Gate ${gateCode}`}>
                        <GateCell row={row.right} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rlcmp-empty" role={evidenceState.status === 'LOADING' ? 'status' : undefined}>
                {evidenceState.status === 'LOADING'
                  ? 'Checking Both Preserved Result Artifacts…'
                  : 'Gate Evaluations: NONE_RECORDED For This Pair.'}
              </div>
            )}
          </section>

          <section className="rlcmp-section rlcmp-artifact-section" aria-labelledby={`${titleId}-artifacts`}>
            <div className="rlcmp-section-title">
              <div><span>Manifest-Bound Controls</span><h3 id={`${titleId}-artifacts`}>Preserved Artifacts</h3></div>
              <code>{RESEARCH_LAB_ARTIFACT_PROVENANCE.versionedRoot} · Manifest SHA-256 {RESEARCH_LAB_ARTIFACT_PROVENANCE.manifestSha256.slice(0, 12)}</code>
            </div>
            <div className="rlcmp-artifact-columns">
              {([
                [leftExperiment, leftArtifacts],
                [rightExperiment, rightArtifacts],
              ] as const).map(([experiment, artifacts]) => (
                <div className="rlcmp-artifact-column" key={experiment.family}>
                  <header><span>Versioned Artifact Source</span><strong>{experiment.family}</strong></header>
                  {artifacts.length > 0 ? artifacts.map((artifact) => (
                    <button
                      type="button"
                      className="rlcmp-artifact-button"
                      key={artifact.path}
                      onClick={() => openArtifact(experiment.family, artifact.path)}
                    >
                      <FileText size={17} aria-hidden="true" />
                      <span><strong>{artifact.name}</strong><small>{artifactRoleLabel(artifact)} · {readableResearchLabBytes(artifact.bytes)}</small></span>
                      <code>{artifact.path} · {artifact.sha256.slice(0, 12)}</code>
                    </button>
                  )) : (
                    <p className="rlcmp-artifact-none">
                      PRESERVED_ARTIFACTS: NONE_RECORDED · {experiment.branch} @ {experiment.tip}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="rlcmp-footer">
          <button type="button" className="rlcmp-secondary-button" onClick={clearSelection}>Clear Selection</button>
          <div>
            <span>Read-Only Comparison · No Runtime Or Money Authority</span>
            <button type="button" className="rlcmp-primary-button" onClick={() => requestClose('CLOSE')}>Close Comparison</button>
          </div>
        </footer>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default ResearchLabCompareModal;
